"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { startDeskSessionBridge, PATH_SESSION } = require("../src/desk-session-bridge");

test("locked Tools refuses a revoked Bearer publish and reports locked on /health", async () => {
  let locked = true;
  let written = null;
  const bridge = startDeskSessionBridge({
    port: 0,
    readSession: () => written,
    peekSession: () => null,
    writeSession: (next) => {
      written = next;
    },
    acceptPublish: (next) => !locked || next.token !== "revoked-token",
    lockInfo: () => ({ locked, lockedAt: 42 }),
  });
  await new Promise((resolve, reject) => {
    bridge.server.once("listening", resolve);
    bridge.server.once("error", reject);
  });
  const { port } = bridge.server.address();
  const post = (token) =>
    fetch(`http://127.0.0.1:${port}${PATH_SESSION}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, expiresAt: "2099-01-01T00:00:00.000Z", person: "logan" }),
    });
  try {
    const health = await (await fetch(`http://127.0.0.1:${port}/health`)).json();
    assert.equal(health.locked, true);
    assert.equal(health.lockedAt, 42);
    assert.equal(health.hasSession, false);

    const refused = await post("revoked-token");
    assert.equal(refused.status, 409);
    assert.equal((await refused.json()).error, "locked");
    assert.equal(written, null);

    const accepted = await post("new-token");
    assert.equal(accepted.status, 200);
    assert.equal(written.token, "new-token");
    locked = false;
    const after = await (await fetch(`http://127.0.0.1:${port}/health`)).json();
    assert.equal(after.locked, false);
    assert.equal(after.hasSession, true);
    assert.equal(typeof after.sessionId, "string");
    assert.ok(after.sessionId.length > 0);
  } finally {
    await bridge.close();
  }
});
