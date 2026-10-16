import re


def edit(path, old, new):
    s = open(path, encoding="utf-8").read()
    if old not in s:
        raise SystemExit("anchor missing in " + path + ": " + old[:60])
    open(path, "w", encoding="utf-8").write(s.replace(old, new, 1))


edit("package.json", '"version": "1.5.17"', '"version": "1.5.18"')

edit(
    "README.md",
    "### Pirate combat (optional, from 1.5.17)",
    "### Pirate combat (optional, from 1.5.17; Settings launch from 1.5.18)",
)
edit(
    "README.md",
    "- **Start:** click one of the sailing ships",
    "- **Start from Settings (from 1.5.18):** **Settings → Launch pirate game** opens the overlay immediately and takes the helm of a flagship — no 5-minute idle wait. It is a menu item only (no header button); if nobody uses it, idle behavior is unchanged.\n"
    "- **Start from the screensaver:** click one of the sailing ships",
)

edit(
    "src/app-menu.js",
    " *   onCheckAppUpdates: () => void,\n",
    " *   onCheckAppUpdates: () => void,\n *   onLaunchPirateGame?: () => void,\n",
)
edit(
    "src/app-menu.js",
    "          click: handlers.onCheckAppUpdates,\n        },\n        { type: \"separator\" },\n",
    "          click: handlers.onCheckAppUpdates,\n        },\n        { type: \"separator\" },\n"
    "        {\n          label: \"Launch pirate game\",\n          click: handlers.onLaunchPirateGame,\n        },\n"
    "        { type: \"separator\" },\n",
)

edit(
    "src/main.js",
    "      onCheckAppUpdates: () => checkForShellUpdate({ interactive: true }),\n",
    "      onCheckAppUpdates: () => checkForShellUpdate({ interactive: true }),\n"
    "      onLaunchPirateGame: () => {\n"
    "        const win = mainWindow;\n"
    "        if (!win || win.isDestroyed()) return;\n"
    "        win.webContents.focus();\n"
    "        win.webContents.send(\"shell:launch-pirate\");\n"
    "      },\n",
)

edit(
    "src/preload.js",
    "  mountShellChrome({\n    idleIntervalMs: resolveIdleIntervalMs(process.env.BF_IDLE_MS),\n  });\n}",
    "  const chrome = mountShellChrome({\n    idleIntervalMs: resolveIdleIntervalMs(process.env.BF_IDLE_MS),\n  });\n"
    "  // Settings → Launch pirate game (main sends this; never fired by idle or page code).\n"
    "  ipcRenderer.on(\"shell:launch-pirate\", () => {\n"
    "    try {\n"
    "      if (chrome && typeof chrome.launchGame === \"function\") chrome.launchGame();\n"
    "    } catch {\n"
    "      // ignore\n"
    "    }\n"
    "  });\n}",
)

edit(
    "src/shell-chrome.js",
    " *   Overlay dismisses on a click on empty water only (never hover, never keys).\n",
    " *   Overlay dismisses on a click on empty water only (never hover, never keys).\n"
    " * - Settings menu launcher (launchGame) opens the overlay and takes the helm at once.\n",
)
edit(
    "src/shell-chrome.js",
    'const ROOT_ID = "bf-tools-shell-root";\n',
    'const ROOT_ID = "bf-tools-shell-root";\n\n'
    "/** Hulls on the water when the game is launched from Settings (one yours, the rest hostile). */\n"
    "const LAUNCH_FLEET = 3;\n",
)
edit(
    "src/shell-chrome.js",
    "  function takeCommand(ship) {",
    """  /**
   * Settings menu launcher: show the overlay now and start combat, skipping
   * the idle wait. Idle behavior is untouched when this is never called.
   * @returns {boolean} true when a run is active afterwards
   */
  function launchGame() {
    if (disposed || !appActive) return false;
    if (mode === "play") return true;
    const live = () => fleet.filter((s) => !(s.sinking > 0) && !(s.retire > 0));
    const wanted = Math.min(maxShips, LAUNCH_FLEET);
    if (live().length < wanted) {
      const grown = growFleet(
        fleet.map((s) => ({ style: s.style })),
        fleet.length + (wanted - live().length),
      );
      for (let i = fleet.length; i < grown.length; i++) {
        fleet.push(placeShip(grown[i].style, i));
      }
    }
    if (!live().length) fleet.push(placeShip(pickShipStyle(), fleet.length));
    lastActivity = now();
    showOverlay();
    const flagship = live()[0];
    if (!flagship) return false;
    takeCommand(flagship);
    return mode === "play";
  }

  function takeCommand(ship) {""",
)
edit("src/shell-chrome.js", "  return {\n    dispose() {", "  return {\n    launchGame,\n    dispose() {")
edit("src/shell-chrome.js", "      takeCommand,\n      standDown,", "      takeCommand,\n      launchGame,\n      standDown,")

edit("test/app-menu.test.js", "    onCheckAppUpdates() {},\n", "    onCheckAppUpdates() {},\n    onLaunchPirateGame() {},\n")
with open("test/app-menu.test.js", "a", encoding="utf-8") as f:
    f.write(
        '''
test("Settings menu exposes Launch pirate game, and only there", () => {
  let called = 0;
  const h = handlers();
  h.onLaunchPirateGame = () => {
    called += 1;
  };
  const template = buildAppMenuTemplate(h);
  const settings = template.find((item) => item.label === "Settings");
  const item = settings.submenu.find((entry) => entry.label === "Launch pirate game");
  assert.ok(item);
  item.click();
  assert.equal(called, 1);
  for (const menu of template.filter((entry) => entry.label !== "Settings")) {
    assert.ok(!menu.submenu.some((entry) => /pirate/i.test(entry.label || "")));
  }
});
'''
    )
with open("test/shell-chrome.test.js", "a", encoding="utf-8") as f:
    f.write(
        '''
test("Settings launch starts combat through preload IPC without changing idle rules", () => {
  const chrome = fs.readFileSync(path.join(__dirname, "..", "src", "shell-chrome.js"), "utf8");
  const preload = fs.readFileSync(path.join(__dirname, "..", "src", "preload.js"), "utf8");
  const main = fs.readFileSync(path.join(__dirname, "..", "src", "main.js"), "utf8");
  assert.match(chrome, /function launchGame\\(\\)/);
  assert.match(chrome, /takeCommand\\(flagship\\)/);
  assert.match(preload, /ipcRenderer\\.on\\("shell:launch-pirate"/);
  assert.match(main, /webContents\\.send\\("shell:launch-pirate"\\)/);
  // No visible in-page launcher and no change to the ambient hint / dismiss rules.
  assert.equal(/Launch pirate game/.test(chrome), false);
  assert.match(chrome, /HINT_AMBIENT = "Click to return to the shop"/);
  assert.match(chrome, /dismissEvents = \\["click", "auxclick"\\]/);
});
'''
    )
