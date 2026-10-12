"use strict";

/**
 * Capture desk unlock JSON that includes widgetToken + widgetExpiresAt (shop beta 0.1.25+)
 * so main can write ~/.local/share/blackforest-tools/widget-session.json without re-PIN mint.
 */
const { ipcRenderer } = require("electron");

function maybeReport(text) {
  if (typeof text !== "string" || text.indexOf("widgetToken") === -1) {
    return;
  }
  ipcRenderer.send("shop-unlock-json", text);
}

const originalFetch = window.fetch.bind(window);
window.fetch = async (...args) => {
  const response = await originalFetch(...args);
  try {
    const clone = response.clone();
    const contentType = clone.headers.get("content-type") || "";
    if (contentType.includes("json") || contentType.includes("text") || !contentType) {
      clone.text().then(maybeReport).catch(() => {});
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
  this.addEventListener("load", function onLoad() {
    try {
      maybeReport(this.responseText);
    } catch {
      // ignore
    }
  });
  return xhrSend.apply(this, args);
};
