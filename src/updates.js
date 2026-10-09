"use strict";

const https = require("node:https");
const { SHOP_HOME } = require("./policy");

// Entry bundles only. Lazy route chunks change as you move around the shop,
// and must not look like a new publish.
const ENTRY_ASSET = /\/assets\/(?:index|styles)-[A-Za-z0-9_-]+\.(?:js|css)/g;

function stampFromHtml(html) {
  if (typeof html !== "string" || html.length === 0) return "";
  const paths = new Set();
  for (const match of html.matchAll(ENTRY_ASSET)) {
    paths.add(match[0]);
  }
  return [...paths].sort().join("|");
}

function fetchShopHtml(url = SHOP_HOME, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) {
      reject(new Error("Too many redirects while checking the shop site"));
      return;
    }

    const request = https.get(
      url,
      {
        headers: {
          Accept: "text/html",
          "Cache-Control": "no-cache",
          Pragma: "no-cache",
          "User-Agent": "BlackForestTools/1.0 (site-update-check)",
        },
      },
      (response) => {
        const status = response.statusCode || 0;
        if (status >= 300 && status < 400 && response.headers.location) {
          response.resume();
          const next = new URL(response.headers.location, url).href;
          resolve(fetchShopHtml(next, redirects + 1));
          return;
        }

        if (status !== 200) {
          response.resume();
          reject(new Error(`Shop site answered ${status}`));
          return;
        }

        const chunks = [];
        let size = 0;
        response.on("data", (chunk) => {
          size += chunk.length;
          if (size <= 300_000) chunks.push(chunk);
        });
        response.on("end", () => {
          resolve(Buffer.concat(chunks).toString("utf8"));
        });
      },
    );

    request.on("error", reject);
    request.setTimeout(12_000, () => {
      request.destroy(new Error("Timed out checking the shop site"));
    });
  });
}

async function fetchShopStamp() {
  const html = await fetchShopHtml();
  return stampFromHtml(html);
}

module.exports = {
  stampFromHtml,
  fetchShopHtml,
  fetchShopStamp,
};
