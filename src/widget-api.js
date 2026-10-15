"use strict";

const https = require("node:https");
const { SHOP_HOST } = require("./policy");
const { normalizePerson } = require("./widget-helpers");

const BASE = `https://${SHOP_HOST}`;

function request(method, apiPath, { token, body, timeoutMs = 15_000 } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(apiPath, BASE);
    const payload = body === undefined ? null : JSON.stringify(body);
    const headers = {
      Accept: "application/json",
      "User-Agent": "BlackForestShopWidget/1.0",
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (payload !== null) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(payload);
    }

    const req = https.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        path: url.pathname + url.search,
        method,
        headers,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let parsed = null;
          if (text.length) {
            try {
              parsed = JSON.parse(text);
            } catch {
              parsed = { error: "bad_json" };
            }
          }
          resolve({
            status: res.statusCode || 0,
            body: parsed,
            retryAfter: res.headers["retry-after"] || null,
          });
        });
      },
    );

    req.on("error", (error) => {
      reject(new Error(error.message || "Network error talking to the shop"));
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error("Timed out talking to the shop"));
    });

    if (payload !== null) req.write(payload);
    req.end();
  });
}

function login(person, pin) {
  return request("POST", "/api/widget/session", {
    body: { person: normalizePerson(person), pin: String(pin || "") },
  });
}

function refresh(token) {
  return request("POST", "/api/widget/session/refresh", { token });
}

function logout(token) {
  return request("POST", "/api/widget/logout", { token });
}

function listViews(token) {
  return request("GET", "/api/widget/views", { token });
}

function fetchView(token, viewId) {
  return request("GET", `/api/widget/views/${encodeURIComponent(viewId)}`, {
    token,
  });
}

function listPeople(token) {
  return request("GET", "/api/widget/people", { token });
}

function createNote(token, recipient, text) {
  return request("POST", "/api/widget/notes", {
    token,
    body: {
      recipient: normalizePerson(recipient),
      text: String(text || ""),
    },
  });
}

/** Same view ids as the Plasma plasmoid config. */
const WIDGET_VIEWS = [
  { id: "lot", label: "On the Lot" },
  { id: "book-today", label: "Book — today" },
  { id: "notes", label: "My open notes" },
];

const UNLOCK_PEOPLE = [
  "logan",
  "stephen",
  "steve",
  "carla",
  "john",
  "dwight",
  "viewer",
];

module.exports = {
  BASE,
  request,
  login,
  refresh,
  logout,
  listViews,
  fetchView,
  listPeople,
  createNote,
  WIDGET_VIEWS,
  UNLOCK_PEOPLE,
};
