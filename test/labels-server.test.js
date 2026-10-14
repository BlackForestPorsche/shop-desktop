"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const {
  labelsPort,
  labelsUrl,
  labelsRootFromAppRoot,
  labelsServerEntry,
  startLabelsServer,
  stopLabelsServer,
  ensureLabelsDeps,
} = require("../src/labels-server");

test("labelsPort defaults to 8080 and honors LABELS_PORT", () => {
  assert.equal(labelsPort({}), 8080);
  assert.equal(labelsPort({ LABELS_PORT: "8099" }), 8099);
  assert.equal(labelsPort({ BF_LABELS_PORT: "8100" }), 8100);
  assert.equal(labelsPort({ LABELS_PORT: "nope" }), 8080);
});

test("labelsUrl and vendored paths resolve under app root", () => {
  assert.equal(labelsUrl(8080), "http://127.0.0.1:8080/");
  const root = "/tmp/shop-desktop-fake";
  assert.equal(labelsRootFromAppRoot(root), path.join(root, "labels"));
  assert.equal(
    labelsServerEntry(path.join(root, "labels")),
    path.join(root, "labels", "server.mjs"),
  );
});

test("startLabelsServer adopts an already-healthy Labels endpoint", async () => {
  const handle = await startLabelsServer({
    appRoot: "/tmp/unused",
    probeFn: async () => true,
    spawnFn: () => {
      throw new Error("should not spawn when adopted");
    },
  });
  assert.equal(handle.ok, true);
  assert.equal(handle.adopted, true);
  assert.equal(handle.owned, false);
  assert.equal(handle.child, null);
  assert.match(handle.reason, /adopted/i);
});

test("startLabelsServer reports missing vendor tree", async () => {
  const handle = await startLabelsServer({
    appRoot: path.join(__dirname, "no-such-app-root"),
    probeFn: async () => false,
    ensureDepsFn: () => ({ ok: true }),
  });
  assert.equal(handle.ok, false);
  assert.match(handle.reason, /missing/i);
});

test("startLabelsServer spawns vendored server when probe is cold then hot", async () => {
  const appRoot = path.join(__dirname, "..");
  let spawned = null;
  let probes = 0;
  const handle = await startLabelsServer({
    appRoot,
    probeFn: async () => {
      probes += 1;
      return false;
    },
    waitFn: async () => true,
    ensureDepsFn: () => ({ ok: true, installed: false }),
    spawnFn: (bin, args, opts) => {
      spawned = { bin, args, opts };
      return {
        pid: 4242,
        unref() {},
        on() {},
        kill() {},
      };
    },
  });
  assert.equal(handle.ok, true);
  assert.equal(handle.owned, true);
  assert.equal(handle.adopted, false);
  assert.ok(spawned);
  assert.ok(String(spawned.args[0]).endsWith(`${path.sep}server.mjs`));
  assert.equal(spawned.opts.cwd, path.join(appRoot, "labels"));
  assert.equal(spawned.opts.env.PORT, "8080");
  assert.equal(spawned.opts.detached, true);
  assert.ok(probes >= 1);
});

test("stopLabelsServer leaves detached Labels running by default", () => {
  const fake = {
    owned: true,
    child: {
      kill() {
        throw new Error("should not kill by default");
      },
    },
  };
  const result = stopLabelsServer(fake, { force: false });
  assert.equal(result.stopped, false);
  assert.match(result.reason, /Desk print/i);
});

test("ensureLabelsDeps skips npm when pdf-lib marker exists", () => {
  const fs = require("node:fs");
  const os = require("node:os");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bft-labels-"));
  fs.mkdirSync(path.join(tmp, "node_modules", "pdf-lib"), { recursive: true });
  let npmCalls = 0;
  const result = ensureLabelsDeps(tmp, {
    spawnSyncFn: () => {
      npmCalls += 1;
      return { status: 0, stdout: "", stderr: "" };
    },
  });
  assert.deepEqual(result, { ok: true, installed: false });
  assert.equal(npmCalls, 0);
});
