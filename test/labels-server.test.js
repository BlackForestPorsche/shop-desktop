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
  readOwnerRecord,
  writeOwnerRecord,
  findOwnedLabels,
} = require("../src/labels-server");

function tmpOwnerFile() {
  const fs = require("node:fs");
  const os = require("node:os");
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bft-labels-owner-")), "labels-server.json");
}

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
    ownerFile: tmpOwnerFile(),
    probeFn: async () => true,
    spawnFn: () => {
      throw new Error("should not spawn when adopted");
    },
  });
  assert.equal(handle.ok, true);
  assert.equal(handle.adopted, true);
  assert.equal(handle.owned, false);
  assert.equal(handle.child, null);
  assert.equal(handle.ours, null);
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
  const ownerFile = tmpOwnerFile();
  const handle = await startLabelsServer({
    appRoot,
    ownerFile,
    version: "1.5.34",
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
  const record = readOwnerRecord(ownerFile);
  assert.equal(record.pid, 4242);
  assert.equal(record.port, 8080);
  assert.equal(record.version, "1.5.34");
  assert.ok(record.entry.endsWith(`${path.sep}server.mjs`));
});

test("a Labels server an earlier Tools started is recognized by its command line", async () => {
  const file = tmpOwnerFile();
  const entry = path.join("/home/desk/shop-desktop", "labels", "server.mjs");
  writeOwnerRecord({ pid: 5151, port: 8080, entry, version: "1.5.33" }, file);

  const ours = await findOwnedLabels({
    port: 8080,
    file,
    commandLineFn: async (pid) => (pid === 5151 ? `/usr/bin/node ${entry}` : ""),
  });
  assert.equal(ours.pid, 5151);
  assert.equal(ours.version, "1.5.33");

  // The same process id, reused by something else after a reboot, is not ours.
  const reused = await findOwnedLabels({
    port: 8080,
    file,
    commandLineFn: async () => "/usr/bin/firefox --new-tab",
  });
  assert.equal(reused, null);

  // The process is gone.
  assert.equal(await findOwnedLabels({ port: 8080, file, commandLineFn: async () => "" }), null);
  // A record for another port is not the server answering here.
  assert.equal(
    await findOwnedLabels({ port: 8099, file, commandLineFn: async () => `/usr/bin/node ${entry}` }),
    null,
  );
});

test("a Labels server left by a Tools from before the record is found by its entry", async () => {
  const file = tmpOwnerFile();
  const entry = path.join("/home/desk/shop-desktop", "labels", "server.mjs");
  const ours = await findOwnedLabels({
    port: 8080,
    file,
    entry,
    commandLineFn: async () => "",
    listProcessesFn: async () => [
      { pid: 10, commandLine: "/usr/bin/firefox" },
      { pid: 4321, commandLine: `/usr/bin/node ${entry}` },
    ],
  });
  assert.equal(ours.pid, 4321);
  assert.equal(ours.version, "");

  // A Labels server run from somewhere else (Desk, a second checkout) is not ours.
  const other = await findOwnedLabels({
    port: 8080,
    file,
    entry,
    listProcessesFn: async () => [{ pid: 77, commandLine: "/usr/bin/node /opt/label-connect/server.mjs" }],
  });
  assert.equal(other, null);
});

test("a Windows command line with backslashes and quotes still matches the record", async () => {
  const file = tmpOwnerFile();
  const entry = "C:\\Users\\Desk\\shop-desktop\\labels\\server.mjs";
  writeOwnerRecord({ pid: 777, port: 8080, entry, version: "1.5.34" }, file);
  const ours = await findOwnedLabels({
    port: 8080,
    file,
    commandLineFn: async () => `"C:\\Program Files\\nodejs\\node.exe" c:/users/desk/shop-desktop/labels/server.mjs`,
  });
  assert.equal(ours.pid, 777);
});

test("startLabelsServer marks an adopted server as ours when the record matches", async () => {
  const file = tmpOwnerFile();
  const handle = await startLabelsServer({
    appRoot: "/tmp/unused",
    ownerFile: file,
    probeFn: async () => true,
    findOwnedFn: async ({ port, file: seen, entry }) => {
      assert.equal(port, 8080);
      assert.equal(seen, file);
      assert.ok(entry.endsWith(`${path.sep}server.mjs`));
      return { pid: 6001, port: 8080, entry: "/x/labels/server.mjs", version: "1.5.33" };
    },
    spawnFn: () => {
      throw new Error("should not spawn when adopted");
    },
  });
  assert.equal(handle.adopted, true);
  assert.equal(handle.owned, false);
  assert.equal(handle.ours.pid, 6001);
  assert.equal(handle.ownerFile, file);
});

test("stopLabelsServer never touches a server Tools did not start", () => {
  const result = stopLabelsServer({ ok: true, owned: false, adopted: true, ours: null, child: null }, { force: true });
  assert.equal(result.stopped, false);
});

test("stopLabelsServer stops a server an earlier Tools started and drops the record", () => {
  const fs = require("node:fs");
  const { spawn } = require("node:child_process");
  const file = tmpOwnerFile();
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { detached: true, stdio: "ignore" });
  writeOwnerRecord({ pid: child.pid, port: 8080, entry: "/x/labels/server.mjs", version: "1.5.33" }, file);
  return new Promise((resolve, reject) => {
    child.on("exit", () => {
      try {
        assert.equal(fs.existsSync(file), false);
        resolve();
      } catch (error) {
        reject(error);
      }
    });
    const result = stopLabelsServer(
      { ok: true, owned: false, adopted: true, child: null, ownerFile: file, ours: readOwnerRecord(file) },
      { force: true },
    );
    assert.equal(result.stopped, true);
  });
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
