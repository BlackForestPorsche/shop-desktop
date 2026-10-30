"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  parseSemver,
  compareSemver,
  versionFromReleaseAssetName,
  pickPortableAsset,
  cleanUpdateEnv,
  markPendingNpmInstall,
  clearPendingNpmInstall,
  hasPendingNpmInstall,
  pendingNpmFlagPath,
  linuxRelaunchSpec,
  defaultDeskCheckoutRoots,
  isShopDesktopRemoteUrl,
  resolveGitUpdateRoot,
  relaunchAfterGitUpdate,
  checkoutElectronPath,
  checkShellUpdate,
  pickInstallerAsset,
  gitConfigArgs,
  resolveGitBin,
  PENDING_NPM_FLAG,
} = require("../src/shell-update");

test("parseSemver reads dotted versions from free text", () => {
  assert.equal(parseSemver("1.2.3").raw, "1.2.3");
  assert.equal(parseSemver("Black Forest Tools-Portable-1.1.0.exe").raw, "1.1.0");
  assert.equal(parseSemver("no version here"), null);
});

test("compareSemver orders versions", () => {
  assert.equal(compareSemver("1.1.0", "1.0.0"), 1);
  assert.equal(compareSemver("1.0.0", "1.1.0"), -1);
  assert.equal(compareSemver("1.0.0", "1.0.0"), 0);
});

test("versionFromReleaseAssetName prefers the portable build version", () => {
  assert.equal(
    versionFromReleaseAssetName("Black.Forest.Tools-Portable-1.1.0.exe"),
    "1.1.0",
  );
});

test("pickPortableAsset prefers a portable exe over other assets", () => {
  const asset = pickPortableAsset([
    { name: "notes.txt", browser_download_url: "https://example/notes" },
    {
      name: "Black.Forest.Tools-Portable-1.1.0.exe",
      browser_download_url: "https://example/portable",
    },
    {
      name: "Black.Forest.Tools-Setup-1.1.0.exe",
      browser_download_url: "https://example/setup",
    },
  ]);
  assert.equal(asset.browser_download_url, "https://example/portable");
});

test("cleanUpdateEnv drops skip-download and platform overrides", () => {
  const cleaned = cleanUpdateEnv({
    PATH: "/usr/bin",
    ELECTRON_SKIP_BINARY_DOWNLOAD: "1",
    ELECTRON_RUN_AS_NODE: "1",
    npm_config_platform: "win32",
    npm_config_arch: "x64",
    KEEP_ME: "yes",
  });
  assert.equal(cleaned.KEEP_ME, "yes");
  assert.equal(cleaned.PATH, "/usr/bin");
  assert.equal(cleaned.ELECTRON_SKIP_BINARY_DOWNLOAD, undefined);
  assert.equal(cleaned.ELECTRON_RUN_AS_NODE, undefined);
  assert.equal(cleaned.npm_config_platform, undefined);
  assert.equal(cleaned.npm_config_arch, undefined);
  assert.equal(cleaned.npm_config_ignore_scripts, "false");
});

test("pending npm flag marks deferred post-update install", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bf-shell-update-"));
  try {
    assert.equal(hasPendingNpmInstall(root), false);
    markPendingNpmInstall(root);
    assert.equal(hasPendingNpmInstall(root), true);
    assert.equal(path.basename(pendingNpmFlagPath(root)), PENDING_NPM_FLAG);
    clearPendingNpmInstall(root);
    assert.equal(hasPendingNpmInstall(root), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("linuxRelaunchSpec points at the menu launcher", () => {
  const root = path.join(__dirname, "..");
  const spec = linuxRelaunchSpec(root);
  assert.ok(spec);
  assert.equal(spec.execPath, "/bin/bash");
  assert.match(spec.args[0], /blackforest-tools\.sh$/);
});

test("isShopDesktopRemoteUrl accepts github clone URLs", () => {
  assert.equal(
    isShopDesktopRemoteUrl("https://github.com/BlackForestPorsche/shop-desktop.git"),
    true,
  );
  assert.equal(
    isShopDesktopRemoteUrl("git@github.com:BlackForestPorsche/shop-desktop.git"),
    true,
  );
  assert.equal(
    isShopDesktopRemoteUrl("https://github.com/BlackForestPorsche/other.git"),
    false,
  );
});

test("defaultDeskCheckoutRoots prefers BF_SHOP_DESKTOP_ROOT then ~/shop-desktop", () => {
  const roots = defaultDeskCheckoutRoots({
    home: "/home/logan",
    envRoot: "/custom/shop-desktop",
  });
  assert.deepEqual(roots, ["/custom/shop-desktop", path.join("/home/logan", "shop-desktop")]);
});

test("resolveGitUpdateRoot prefers the running root when it has a shop-desktop remote", () => {
  const running = "/desk/shop-desktop";
  const other = "/home/logan/shop-desktop";
  const chosen = resolveGitUpdateRoot(running, {
    deskRoots: [other],
    hasRemote: (root) => root === running,
  });
  assert.equal(chosen, path.resolve(running));
});

test("resolveGitUpdateRoot falls back to the Setup desk checkout", () => {
  const portableAsar = "/tmp/portable-app";
  const desk = "/home/logan/shop-desktop";
  const chosen = resolveGitUpdateRoot(portableAsar, {
    deskRoots: [desk],
    hasRemote: (root) => root === path.resolve(desk),
  });
  assert.equal(chosen, path.resolve(desk));
});

test("resolveGitUpdateRoot returns null when no git remote exists (true portable)", () => {
  assert.equal(
    resolveGitUpdateRoot("/tmp/portable", {
      deskRoots: ["/tmp/missing-desk"],
      hasRemote: () => false,
    }),
    null,
  );
});

test("relaunchAfterGitUpdate uses the Linux launcher", () => {
  const root = path.join(__dirname, "..");
  let seen = null;
  const mode = relaunchAfterGitUpdate(root, {
    runningRoot: root,
    packaged: false,
    platform: "linux",
    relaunchApp: (opts) => {
      seen = opts;
    },
  });
  assert.equal(mode, "linux-launcher");
  assert.equal(seen.execPath, "/bin/bash");
  assert.match(seen.args[0], /blackforest-tools\.sh$/);
});

test("relaunchAfterGitUpdate spawns checkout electron when leaving Portable", () => {
  const gitRoot = "/Users/desk/shop-desktop";
  const electronBin = checkoutElectronPath(gitRoot, "win32");
  let spawned = null;
  const mode = relaunchAfterGitUpdate(gitRoot, {
    runningRoot: "/tmp/portable-asar",
    packaged: true,
    platform: "win32",
    exists: (p) => p === electronBin,
    spawnDetached: (execPath, args, opts) => {
      spawned = { execPath, args, opts };
    },
    relaunchApp: () => {
      throw new Error("should not app.relaunch Portable");
    },
  });
  assert.equal(mode, "checkout-electron");
  assert.equal(spawned.execPath, electronBin);
  assert.deepEqual(spawned.args, [gitRoot]);
});

test("checkShellUpdate prefers git in place even when packaged=true", async () => {
  const root = path.join(__dirname, "..");
  const info = await checkShellUpdate({
    root,
    // Newer than any published release, so a current checkout stays on git
    // instead of being replaced by the Windows installer download.
    currentVersion: "99.0.0",
    packaged: true,
    deskRoots: [],
  });
  assert.equal(info.mode, "git");
  assert.equal(path.resolve(info.root), path.resolve(root));
  assert.equal(typeof info.available, "boolean");
});

test("checkShellUpdate offers Portable release only without a git remote", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bf-portable-only-"));
  try {
    const info = await checkShellUpdate({
      root: tmp,
      currentVersion: "0.0.1",
      packaged: true,
      deskRoots: [],
    });
    assert.equal(info.mode, "release");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("gitConfigArgs clears a stale GitHub token and trusts the checkout", () => {
  const args = gitConfigArgs("/tmp/shop desktop");
  assert.ok(args.includes("safe.directory=*"));
  assert.ok(args.includes("credential.helper="));
  assert.ok(args.includes("http.https://github.com/.extraheader="));
  assert.ok(args.some((arg) => arg.startsWith("safe.directory=/tmp/shop desktop")));
});

test("resolveGitBin finds Git for Windows when PATH is stale", () => {
  const exe = "C:\\Program Files\\Git\\cmd\\git.exe";
  assert.equal(
    resolveGitBin({
      platform: "win32",
      env: { ProgramFiles: "C:\\Program Files", Path: "" },
      exists: (candidate) => candidate === exe,
    }),
    exe,
  );
  assert.equal(resolveGitBin({ platform: "linux" }), "git");
});

test("pickInstallerAsset prefers the packaged installer exe", () => {
  const asset = pickInstallerAsset([
    { name: "Black.Forest.Tools-Portable-1.5.32.exe" },
    { name: "Black.Forest.Tools-Setup.exe" },
    { name: "Black.Forest.Tools-Packaged-Installer-1.5.32.exe" },
  ]);
  assert.equal(asset.name, "Black.Forest.Tools-Packaged-Installer-1.5.32.exe");
});

test("checkShellUpdate asks for a restart when the folder moved after launch", async () => {
  const launched = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const next = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const info = await checkShellUpdate({
    root: "/tmp/desk-tools",
    currentVersion: "1.5.31",
    deskRoots: [],
    launchedSha: launched,
    hasRemote: () => true,
    checkGit: async () => ({
      mode: "git",
      available: false,
      current: next,
      upstream: next,
    }),
  });
  assert.equal(info.mode, "git");
  assert.equal(info.available, true);
  assert.equal(info.restartOnly, true);
});

test("checkShellUpdate reports the published release when git fetch throws", async () => {
  const info = await checkShellUpdate({
    root: "/tmp/desk-tools",
    currentVersion: "1.5.31",
    packaged: true,
    deskRoots: [],
    hasRemote: () => true,
    checkGit: async () => {
      throw new Error("Authentication failed for https://github.com/BlackForestPorsche/shop-desktop.git");
    },
    checkRelease: async (version, opts) => {
      assert.equal(version, "1.5.31");
      assert.equal(opts.preferInstaller, true);
      return {
        mode: "release",
        available: true,
        currentVersion: version,
        remoteVersion: "1.5.33",
        assetName: "Black.Forest.Tools-Packaged-Installer-1.5.33.exe",
      };
    },
  });
  assert.equal(info.mode, "release");
  assert.equal(info.available, true);
  assert.equal(info.remoteVersion, "1.5.33");
  assert.match(info.gitError, /Authentication failed/);
});

test("packaged Windows install sees a newer release when the git folder is already current", async () => {
  const info = await checkShellUpdate({
    root: "/tmp/desk-tools",
    currentVersion: "1.5.31",
    packaged: true,
    deskRoots: [],
    hasRemote: () => true,
    checkGit: async () => ({
      mode: "git",
      available: false,
      current: "cccccccccccccccccccccccccccccccccccccccc",
      upstream: "cccccccccccccccccccccccccccccccccccccccc",
    }),
    checkRelease: async (_version, opts) => {
      assert.equal(opts.preferInstaller, true);
      return {
        mode: "release",
        available: true,
        remoteVersion: "1.5.33",
        assetName: "Black.Forest.Tools-Packaged-Installer-1.5.33.exe",
      };
    },
  });
  assert.equal(info.mode, "release");
  assert.equal(info.available, true);
  assert.equal(info.remoteVersion, "1.5.33");
});

test("a stale GitHub extraheader no longer hides the published release", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bf-stale-token-"));
  try {
    const git = (args) => {
      const result = spawnSync("git", ["-C", tmp, ...args], {
        encoding: "utf8",
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      });
      assert.equal(result.status, 0, result.stderr || result.stdout);
    };
    git(["init"]);
    git(["config", "user.email", "desk@example.com"]);
    git(["config", "user.name", "Desk"]);
    fs.writeFileSync(path.join(tmp, "README"), "x\n");
    git(["add", "README"]);
    git(["commit", "-m", "init"]);
    git(["remote", "add", "origin", "https://github.com/BlackForestPorsche/shop-desktop.git"]);
    const token = Buffer.from("x:badtoken").toString("base64");
    git(["config", "--local", "http.https://github.com/.extraheader", `AUTHORIZATION: basic ${token}`]);
    const info = await checkShellUpdate({
      root: tmp,
      currentVersion: "1.5.31",
      packaged: false,
      deskRoots: [],
    });
    // Without the header clear, fetch throws and the check never sees main.
    assert.equal(info.available, true);
    if (info.mode === "git") {
      assert.notEqual(info.current, info.upstream);
    } else {
      assert.equal(info.mode, "release");
      assert.equal(compareSemver(info.remoteVersion, "1.5.31") > 0, true);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("hasShopDesktopRemote accepts a real origin remote", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bf-git-remote-"));
  try {
    const git = (args) => {
      const result = spawnSync("git", ["-C", tmp, ...args], {
        encoding: "utf8",
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      });
      assert.equal(result.status, 0, result.stderr || result.stdout);
    };
    git(["init"]);
    git(["remote", "add", "origin", "https://github.com/BlackForestPorsche/shop-desktop.git"]);
    const { hasShopDesktopRemote } = require("../src/shell-update");
    assert.equal(hasShopDesktopRemote(tmp), true);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
