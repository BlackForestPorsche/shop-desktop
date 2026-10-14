"use strict";

const { contextBridge, ipcRenderer } = require("electron");
const { mountShellChrome } = require("./shell-chrome");
const { resolveIdleIntervalMs } = require("./idle-fleet");

contextBridge.exposeInMainWorld("blackForestTools", {
  checkForDesktopUpdates: () => ipcRenderer.invoke("shell:check-updates"),
});

function requestUrl(input) {
  if (typeof input === "string") return input;
  if (input && typeof input.url === "string") return input.url;
  try {
    return String(input);
  } catch {
    return "";
  }
}

function isShopUrl(url) {
  return /shop\.blackforestautomotive\.com/i.test(String(url || ""));
}

function bodyText(body) {
  if (body == null) return "";
  if (typeof body === "string") return body;
  if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) {
    return body.toString();
  }
  return "";
}

/** Capture person+PIN from unlock POST so main can mint widget-session.json. */
function maybeReportUnlockCreds(url, method, body) {
  if (String(method || "GET").toUpperCase() !== "POST" || !isShopUrl(url)) {
    return;
  }
  const text = bodyText(body);
  if (!text || text.indexOf("pin") === -1 || text.indexOf("person") === -1) {
    return;
  }
  ipcRenderer.send("shop-unlock-creds", text);
}

/**
 * Capture unlock / widget-session JSON so main writes
 * ~/.local/share/blackforest-tools/widget-session.json.
 * Desk roles include widgetToken; also accept token+expiresAt shapes.
 */
function maybeReportUnlock(text) {
  if (typeof text !== "string" || !text) {
    return;
  }
  const hasWidget = text.indexOf("widgetToken") !== -1 && text.indexOf("widgetExpiresAt") !== -1;
  const hasToken =
    text.indexOf('"token"') !== -1 &&
    text.indexOf("expiresAt") !== -1 &&
    (text.indexOf("person") !== -1 || text.indexOf("role") !== -1);
  if (!hasWidget && !hasToken) {
    return;
  }
  ipcRenderer.send("shop-unlock-json", text);
}

const originalFetch = window.fetch.bind(window);
window.fetch = async (...args) => {
  const input = args[0];
  const init = args[1] || {};
  const url = requestUrl(input);
  const method = init.method || (input && input.method) || "GET";
  try {
    maybeReportUnlockCreds(url, method, init.body);
  } catch {
    // ignore
  }
  const response = await originalFetch(...args);
  try {
    const clone = response.clone();
    const contentType = clone.headers.get("content-type") || "";
    if (contentType.includes("json") || contentType.includes("text") || !contentType) {
      clone.text().then(maybeReportUnlock).catch(() => {});
    }
  } catch {
    // ignore
  }
  return response;
};

const xhrOpen = XMLHttpRequest.prototype.open;
const xhrSend = XMLHttpRequest.prototype.send;
XMLHttpRequest.prototype.open = function openPatched(method, url, ...rest) {
  this.__bfMethod = method;
  this.__bfUrl = url;
  return xhrOpen.call(this, method, url, ...rest);
};
XMLHttpRequest.prototype.send = function sendPatched(...args) {
  try {
    maybeReportUnlockCreds(this.__bfUrl, this.__bfMethod, args[0]);
  } catch {
    // ignore
  }
  this.addEventListener("load", function onLoad() {
    try {
      maybeReportUnlock(this.responseText);
    } catch {
      // ignore
    }
  });
  return xhrSend.apply(this, args);
};

function boot() {
  // Idle fleet only — Check for updates lives in Settings → Check for updates.
  // BF_IDLE_MS (ms) shortens the interval for QA; unset → 5 minutes.
  mountShellChrome({
    idleIntervalMs: resolveIdleIntervalMs(process.env.BF_IDLE_MS),
  });
}

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
