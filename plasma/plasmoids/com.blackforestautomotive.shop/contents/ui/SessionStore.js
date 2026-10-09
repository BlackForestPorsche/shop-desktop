.pragma library

/**
 * Session path helpers and expiry checks.
 * Disk I/O goes through the `blackforest-widget-session` executable helper
 * (see main.qml) so the token file stays mode 0600.
 */

var DIR_NAME = "blackforest-tools";
var FILE_NAME = "widget-session.json";

function sessionRelativePath() {
    return DIR_NAME + "/" + FILE_NAME;
}

function parseSessionJson(text) {
    if (!text || !String(text).trim().length) {
        return null;
    }
    try {
        var data = JSON.parse(text);
        if (!data || !data.token || !data.expiresAt) {
            return null;
        }
        return {
            token: data.token,
            expiresAt: data.expiresAt,
            person: data.person || "",
            role: data.role || "",
            loginAt: data.loginAt || ""
        };
    } catch (e) {
        return null;
    }
}

function isExpired(session, skewMs) {
    if (!session || !session.expiresAt) {
        return true;
    }
    if (skewMs === undefined) {
        skewMs = 60000;
    }
    var exp = Date.parse(session.expiresAt);
    if (isNaN(exp)) {
        return true;
    }
    return Date.now() >= (exp - skewMs);
}

function shouldRefresh(session) {
    if (!session || !session.token || !session.expiresAt) {
        return false;
    }
    var exp = Date.parse(session.expiresAt);
    if (isNaN(exp)) {
        return false;
    }
    if (exp - Date.now() > 30 * 60 * 1000) {
        return false;
    }
    var loginAt = Date.parse(session.loginAt || "");
    if (!isNaN(loginAt) && (Date.now() - loginAt) > 11.5 * 60 * 60 * 1000) {
        return false;
    }
    return true;
}
