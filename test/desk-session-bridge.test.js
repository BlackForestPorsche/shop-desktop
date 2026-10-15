"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  bridgeHost,
  bridgePort,
  startDeskSessionBridge,
  DEFAULT_PORT,
  PATH_SESSION,
  PATH_LOCK,
  PATH_SHOP_GATE,
  PATH_PERSON_SETTINGS,
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

test("DELETE /v1/widget-session calls onLock with live session", async () => {
  let written = {
    token: "live",
    expiresAt: "2099-01-01T00:00:00.000Z",
    person: "logan",
  };
  let lockCalls = 0;
  let seenToken = "";
  const bridge = startDeskSessionBridge({
    port: 0,
    readSession: () => written,
    clearSession: () => {
      written = null;
    },
    onLock: async ({ source, session }) => {
      lockCalls += 1;
      assert.equal(source, "delete-session");
      seenToken = session && session.token ? session.token : "";
      written = null;
    },
  });
  await new Promise((resolve, reject) => {
    bridge.server.once("listening", resolve);
    bridge.server.once("error", reject);
  });
  const { port } = bridge.server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${PATH_SESSION}`, {
      method: "DELETE",
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.locked, true);
    assert.equal(body.hadSession, true);
    assert.equal(lockCalls, 1);
    assert.equal(seenToken, "live");
    assert.equal(written, null);

    const health = await (await fetch(`http://127.0.0.1:${port}/health`)).json();
    assert.equal(health.hasSession, false);
  } finally {
    await bridge.close();
  }
});

test("POST /v1/lock locks Tools session via alias", async () => {
  let written = {
    token: "live",
    expiresAt: "2099-01-01T00:00:00.000Z",
    person: "logan",
  };
  let lockSource = "";
  const bridge = startDeskSessionBridge({
    port: 0,
    readSession: () => written,
    clearSession: () => {
      written = null;
    },
    onLock: async ({ source }) => {
      lockSource = source;
      written = null;
    },
  });
  await new Promise((resolve, reject) => {
    bridge.server.once("listening", resolve);
    bridge.server.once("error", reject);
  });
  const { port } = bridge.server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${PATH_LOCK}`, {
      method: "POST",
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.locked, true);
    assert.equal(lockSource, "v1-lock");
    assert.equal(written, null);
  } finally {
    await bridge.close();
  }
});

test("GET /health reports hasGate when jar has bf_shop_gate", async () => {
  const bridge = startDeskSessionBridge({
    port: 0,
    readSession: () => null,
    peekSession: () => null,
    getShopGate: async () => ({
      present: true,
      gateToken: "v2.gate.value",
      person: "logan",
    }),
  });
  await new Promise((resolve, reject) => {
    bridge.server.once("listening", resolve);
    bridge.server.once("error", reject);
  });
  const { port } = bridge.server.address();
  try {
    const body = await (await fetch(`http://127.0.0.1:${port}/health`)).json();
    assert.equal(body.hasSession, false);
    assert.equal(body.hasGate, true);
    assert.equal(body.hint, "bridge_up_gate_only");
  } finally {
    await bridge.close();
  }
});

test("GET /v1/shop-gate returns Electron gate for Desk Firefox copy", async () => {
  const bridge = startDeskSessionBridge({
    port: 0,
    readSession: () => ({
      token: "desk-tok",
      expiresAt: "2099-01-01T00:00:00.000Z",
      person: "logan",
    }),
    getShopGate: async () => ({
      present: true,
      gateToken: "v2.gate.value",
      expiresAt: "2099-01-01T00:00:00.000Z",
      person: "logan",
    }),
  });
  await new Promise((resolve, reject) => {
    bridge.server.once("listening", resolve);
    bridge.server.once("error", reject);
  });
  const { port } = bridge.server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${PATH_SHOP_GATE}`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.gateToken, "v2.gate.value");
    assert.equal(body.person, "logan");
  } finally {
    await bridge.close();
  }
});

test("GET /v1/person-settings returns Tools SPA prefs for Desk", async () => {
  const bridge = startDeskSessionBridge({
    port: 0,
    getPersonSettings: async () => ({
      ok: true,
      person: "logan",
      settings: { funMode: "off", dark: false, surpriseFun: false },
      updatedAt: 1,
    }),
  });
  await new Promise((resolve, reject) => {
    bridge.server.once("listening", resolve);
    bridge.server.once("error", reject);
  });
  const { port } = bridge.server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${PATH_PERSON_SETTINGS}`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.person, "logan");
    assert.equal(body.settings.funMode, "off");
  } finally {
    await bridge.close();
  }
});

test("POST /v1/person-settings applies website prefs into Tools", async () => {
  let written = null;
  const bridge = startDeskSessionBridge({
    port: 0,
    setPersonSettings: async (payload) => {
      written = payload;
      return { ok: true, person: payload.person, funMode: payload.settings.funMode };
    },
  });
  await new Promise((resolve, reject) => {
    bridge.server.once("listening", resolve);
    bridge.server.once("error", reject);
  });
  const { port } = bridge.server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${PATH_PERSON_SETTINGS}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        person: "logan",
        settings: { funMode: "casino", surpriseFun: false },
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.funMode, "casino");
    assert.equal(written.person, "logan");
  } finally {
    await bridge.close();
  }
});

test("DELETE without onLock still clears shared file", async () => {
  let written = {
    token: "live",
    expiresAt: "2099-01-01T00:00:00.000Z",
    person: "logan",
  };
  const bridge = startDeskSessionBridge({
    port: 0,
    readSession: () => written,
    clearSession: () => {
      written = null;
    },
  });
  await new Promise((resolve, reject) => {
    bridge.server.once("listening", resolve);
    bridge.server.once("error", reject);
  });
  const { port } = bridge.server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${PATH_SESSION}`, {
      method: "DELETE",
    });
    assert.equal(res.status, 200);
    assert.equal(written, null);
  } finally {
    await bridge.close();
  }
});
