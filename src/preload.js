"use strict";

const { contextBridge, ipcRenderer } = require("electron");
const { mountShellChrome } = require("./shell-chrome");
const { resolveIdleIntervalMs } = require("./idle-fleet");
const { looksLikeLockRequest } = require("./lock-detect");

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
  try {
    if (looksLikeLockRequest(url, method, bodyText(body))) {
      ipcRenderer.send("shop-lock");
      return;
    }
  } catch {
    // ignore
  }
  const text = bodyText(body);
  if (!text || text.indexOf("pin") === -1 || text.indexOf("person") === -1) {
    return;
  }
  ipcRenderer.send("shop-unlock-creds", text);
}

/**
 * Capture unlock / widget-session JSON so main writes
 * ~/.local/share/blackforest-tools/widget-session.json and force-exchanges
 * bf_shop_gate into the Electron jar (Tools SPA unlock).
 * Desk roles include widgetToken; also accept token+expiresAt and unlock-ok shapes.
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
  // unlockShop success without widgetToken (mint failed) still needs SPA/Desk sync.
  const hasUnlockOk =
    (text.indexOf('"ok":true') !== -1 || text.indexOf('"ok": true') !== -1) &&
    text.indexOf("person") !== -1 &&
    (text.indexOf("until") !== -1 || text.indexOf("kind") !== -1 || text.indexOf("mustChange") !== -1);
  if (!hasWidget && !hasToken && !hasUnlockOk) {
    return;
  }
  ipcRenderer.send("shop-unlock-json", text);
}

function maybeReportLockResponse(url, method, text) {
  if (String(method || "GET").toUpperCase() !== "POST" || !isShopUrl(url)) {
    return;
  }
  if (looksLikeLockRequest(url, method, "")) {
    ipcRenderer.send("shop-lock");
    return;
  }
  // URL alone may not carry lockShop when body was empty — check response shape.
  const bareOk =
    typeof text === "string" &&
    (/^\s*\{\s*"ok"\s*:\s*true\s*\}\s*$/.test(text) ||
      /^\s*\{\s*"ok"\s*:\s*true\s*,\s*"result"\s*:\s*\{\s*"ok"\s*:\s*true\s*\}\s*\}\s*$/.test(text));
  if (bareOk && /lockShop/i.test(String(url || ""))) {
    ipcRenderer.send("shop-lock");
  }
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
      clone
        .text()
        .then((text) => {
          try {
            maybeReportLockResponse(url, method, text);
          } catch {
            // ignore
          }
          maybeReportUnlock(text);
        })
        .catch(() => {});
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
      maybeReportLockResponse(this.__bfUrl, this.__bfMethod, this.responseText);
    } catch {
      // ignore
    }
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
  const chrome = mountShellChrome({
    idleIntervalMs: resolveIdleIntervalMs(process.env.BF_IDLE_MS),
  });
  // Settings → Launch pirate game (main sends this; never fired by idle or page code).
  ipcRenderer.on("shell:launch-pirate", () => {
    try {
      if (chrome && typeof chrome.launchGame === "function") chrome.launchGame();
    } catch {
      // ignore
    }
  });
}

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
