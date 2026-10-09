"use strict";

/** Pure helpers shared by unit tests and mirrored in the Plasma QML JS. */

function normalizePerson(person) {
  return String(person || "").trim().toLowerCase();
}

function parseSessionJson(text) {
  if (!text || !String(text).trim()) {
    return null;
  }
  try {
    const data = JSON.parse(text);
    if (!data || !data.token || !data.expiresAt) {
      return null;
    }
    return {
      token: data.token,
      expiresAt: data.expiresAt,
      person: data.person || "",
      role: data.role || "",
      loginAt: data.loginAt || "",
    };
  } catch {
    return null;
  }
}

function isSessionExpired(session, nowMs = Date.now(), skewMs = 60_000) {
  if (!session || !session.expiresAt) {
    return true;
  }
  const exp = Date.parse(session.expiresAt);
  if (Number.isNaN(exp)) {
    return true;
  }
  return nowMs >= exp - skewMs;
}

function shouldRefreshToken(session, nowMs = Date.now()) {
  if (!session || !session.token || !session.expiresAt) {
    return false;
  }
  const exp = Date.parse(session.expiresAt);
  if (Number.isNaN(exp)) {
    return false;
  }
  // Refresh when under 30 minutes remain
  if (exp - nowMs > 30 * 60 * 1000) {
    return false;
  }
  // Do not refresh past ~12h from loginAt (API max)
  const loginAt = Date.parse(session.loginAt || "");
  if (!Number.isNaN(loginAt) && nowMs - loginAt > 11.5 * 60 * 60 * 1000) {
    return false;
  }
  return true;
}

/**
 * Map widget API HTTP failures to a stable error code for UI copy.
 * Never include PIN or token in the result.
 */
function classifyWidgetHttpError(status, body, retryAfter) {
  if (status === 401) {
    return { code: "unauthorized", retryAfter: null };
  }
  if (status === 403 && body && body.error === "pin_change_required") {
    return { code: "pin_change_required", retryAfter: null };
  }
  if (status === 403) {
    return { code: "forbidden", retryAfter: null };
  }
  if (status === 429) {
    const wait = retryAfter != null && String(retryAfter).length
      ? Number(retryAfter)
      : null;
    return {
      code: "rate_limited",
      retryAfter: Number.isFinite(wait) ? wait : null,
    };
  }
  if (status === 404) {
    return { code: "not_found", retryAfter: null };
  }
  return { code: "http_error", status, retryAfter: null };
}

module.exports = {
  normalizePerson,
  parseSessionJson,
  isSessionExpired,
  shouldRefreshToken,
  classifyWidgetHttpError,
};
