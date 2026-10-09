"use strict";

const SHOP_HOST = "shop.blackforestautomotive.com";
const SHOP_HOME = `https://${SHOP_HOST}/`;

function isAuthHost(hostname) {
  const host = hostname.toLowerCase();
  if (host === "accounts.youtube.com") return true;
  if (host === "google.com" || host.endsWith(".google.com")) return true;
  if (host === "googleapis.com" || host.endsWith(".googleapis.com")) return true;
  if (host === "gstatic.com" || host.endsWith(".gstatic.com")) return true;
  if (host === "googleusercontent.com" || host.endsWith(".googleusercontent.com")) return true;
  return false;
}

function classifyUrl(raw) {
  if (typeof raw !== "string" || raw.length === 0 || raw === "about:blank") {
    return { kind: "ignore", href: null };
  }

  let url;
  try {
    url = new URL(raw);
  } catch {
    return { kind: "ignore", href: null };
  }

  if (url.protocol === "mailto:" || url.protocol === "tel:") {
    return { kind: "external", href: url.href };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { kind: "ignore", href: null };
  }

  const host = url.hostname.toLowerCase();
  if (host === SHOP_HOST) {
    if (url.protocol === "http:") url.protocol = "https:";
    return { kind: "shop", href: url.href };
  }

  if (isAuthHost(host)) {
    return { kind: "auth", href: url.href };
  }

  return { kind: "external", href: url.href };
}

module.exports = {
  SHOP_HOST,
  SHOP_HOME,
  classifyUrl,
};
