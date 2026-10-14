"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  bridgeHost,
  bridgePort,
  startDeskSessionBridge,
  DEFAULT_PORT,
  PATH_SESSION,
} = require("../src/desk-session-bridge");

test("bridgeHost refuses non-loopback binds", () => {
  assert.equal(bridgeHost({ BLACKFOREST_DESK_BRIDGE_HOST: "0.0.0.0" }), "127.0.0.1");
  assert.equal(bridgeHost({ BLACKFOREST_DESK_BRIDGE_HOST: "127.0.0.1" }), "127.0.0.1");
});

test("bridgePort reads env with fallback", () => {
  assert.equal(bridgePort({}), DEFAULT_PORT);
  assert.equal(bridgePort({ BLACKFOREST_DESK_BRIDGE_PORT: "8799" }), 8799);
  assert.equal(bridgePort({ BLACKFOREST_DESK_BRIDGE_PORT: "nope" }), DEFAULT_PORT);
});

test("GET /v1/widget-session returns token when session exists", async () => {
  const bridge = startDeskSessionBridge({
    port: 0,
    readSession: () => ({
      token: "desk-tok",
      expiresAt: "2099-01-01T00:00:00.000Z",
      person: "logan",
      role: "desk",
    }),
  });
  await new Promise((resolve, reject) => {
    bridge.server.once("listening", resolve);
    bridge.server.once("error", reject);
  });
  const { port } = bridge.server.address();
  try {
    const health = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(health.status, 200);
    const healthBody = await health.json();
    assert.equal(healthBody.hasSession, true);
    assert.equal(healthBody.person, "logan");

    const res = await fetch(`http://127.0.0.1:${port}${PATH_SESSION}`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.token, "desk-tok");
    assert.equal(body.person, "logan");
    assert.equal(body.source, "blackforest-tools");
  } finally {
    await bridge.close();
  }
});

test("GET /v1/widget-session is 404 without session", async () => {
  const bridge = startDeskSessionBridge({
    port: 0,
    readSession: () => null,
    peekSession: () => null,
  });
  await new Promise((resolve, reject) => {
    bridge.server.once("listening", resolve);
    bridge.server.once("error", reject);
  });
  const { port } = bridge.server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${PATH_SESSION}`);
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error, "no_session");
    assert.equal(body.hint, "bridge_up_no_session");
    assert.equal(body.sessionExpired, false);
  } finally {
    await bridge.close();
  }
});

test("GET /v1/widget-session reports expired and refreshes via onSessionMiss", async () => {
  let live = null;
  let missCalls = 0;
  const bridge = startDeskSessionBridge({
    port: 0,
    readSession: () => live,
    peekSession: () =>
      live
        ? live
        : {
            token: "stale",
            expiresAt: "2000-01-01T00:00:00.000Z",
            person: "logan",
          },
    onSessionMiss: async ({ sessionExpired }) => {
      missCalls += 1;
      assert.equal(sessionExpired, true);
      live = {
        token: "fresh",
        expiresAt: "2099-01-01T00:00:00.000Z",
        person: "logan",
        role: "desk",
      };
    },
  });
  await new Promise((resolve, reject) => {
    bridge.server.once("listening", resolve);
    bridge.server.once("error", reject);
  });
  const { port } = bridge.server.address();
  try {
    const health = await (await fetch(`http://127.0.0.1:${port}/health`)).json();
    assert.equal(health.hasSession, false);
    assert.equal(health.sessionExpired, true);
    assert.equal(health.hint, "bridge_up_session_expired");

    const res = await fetch(`http://127.0.0.1:${port}${PATH_SESSION}`);
    assert.equal(res.status, 200);
    assert.equal(missCalls, 1);
    const body = await res.json();
    assert.equal(body.token, "fresh");
  } finally {
    await bridge.close();
  }
});

test("POST /v1/widget-session publishes token into shared store", async () => {
  let written = null;
  let published = null;
  const bridge = startDeskSessionBridge({
    port: 0,
    readSession: () => written,
    writeSession: (session) => {
      written = session;
    },
    onPublished: (session) => {
      published = session;
    },
  });
  await new Promise((resolve, reject) => {
    bridge.server.once("listening", resolve);
    bridge.server.once("error", reject);
  });
  const { port } = bridge.server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${PATH_SESSION}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        widgetToken: "from-desk",
        widgetExpiresAt: "2099-01-01T00:00:00.000Z",
        person: "Logan",
        role: "desk",
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.person, "logan");
    assert.equal(written.token, "from-desk");
    assert.equal(published.token, "from-desk");

    const got = await fetch(`http://127.0.0.1:${port}${PATH_SESSION}`);
    assert.equal(got.status, 200);
    assert.equal((await got.json()).token, "from-desk");
  } finally {
    await bridge.close();
  }
});
