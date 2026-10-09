.pragma library

var BASE = "https://shop.blackforestautomotive.com";

function normalizePerson(person) {
    return String(person || "").trim().toLowerCase();
}

function request(method, path, opts) {
    opts = opts || {};
    return new Promise(function (resolve, reject) {
        var xhr = new XMLHttpRequest();
        xhr.open(method, BASE + path);
        xhr.timeout = opts.timeout || 15000;
        xhr.setRequestHeader("Accept", "application/json");
        if (opts.token) {
            xhr.setRequestHeader("Authorization", "Bearer " + opts.token);
        }
        if (opts.body !== undefined) {
            xhr.setRequestHeader("Content-Type", "application/json");
        }
        xhr.onreadystatechange = function () {
            if (xhr.readyState !== XMLHttpRequest.DONE) {
                return;
            }
            var body = null;
            if (xhr.responseText && xhr.responseText.length) {
                try {
                    body = JSON.parse(xhr.responseText);
                } catch (e) {
                    body = { error: "bad_json" };
                }
            }
            var retryAfter = xhr.getResponseHeader("Retry-After");
            resolve({
                status: xhr.status,
                body: body,
                retryAfter: retryAfter
            });
        };
        xhr.ontimeout = function () {
            reject(new Error("Timed out talking to the shop"));
        };
        xhr.onerror = function () {
            reject(new Error("Network error talking to the shop"));
        };
        if (opts.body !== undefined) {
            // Body may include pin — never log opts or the wire payload.
            xhr.send(JSON.stringify(opts.body));
        } else {
            xhr.send();
        }
    });
}

function login(person, pin) {
    return request("POST", "/api/widget/session", {
        body: { person: normalizePerson(person), pin: String(pin || "") }
    });
}

function refresh(token) {
    return request("POST", "/api/widget/session/refresh", { token: token });
}

function logout(token) {
    return request("POST", "/api/widget/logout", { token: token });
}

function listViews(token) {
    return request("GET", "/api/widget/views", { token: token });
}

function fetchView(token, viewId) {
    return request("GET", "/api/widget/views/" + encodeURIComponent(viewId), { token: token });
}
