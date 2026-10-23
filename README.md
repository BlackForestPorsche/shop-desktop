# Black Forest Tools

A desktop window for [shop.blackforestautomotive.com](https://shop.blackforestautomotive.com). It is another way to open the shop tools, on Manjaro, in their own window.

The window loads the live site. The book, the lot, notes, parts, crew, invoices, and the service calendar stay on the site. Publishing the site updates this window. This project does not keep a copy of the shop, and it does not need a new API.

## Install on Manjaro

```bash
sudo pacman -S nodejs npm git
cd ~
git clone https://github.com/BlackForestPorsche/shop-desktop.git
cd ~/shop-desktop
npm install
npm run install-menu
```

`install-menu` also arms **start at login** (systemd --user + XDG). Shop desks want that on. Skip with `npm run install-menu -- --no-autostart`. Turn it off later with `npm run disable-autostart` (or `bash scripts/disable-tools-autostart.sh`).

If zsh asks `correct 'npm' to 'nm'?`, answer `n`. After `pacman` finishes, open a new terminal so `npm` is on your PATH.

Open **Black Forest Tools** from the application menu, or run `blackforest-tools`.

If the window opens and closes right away, the Electron binary may not have downloaded. Fix it from a terminal:

```bash
cd ~/shop-desktop
bash scripts/ensure-electron.sh
npm start
```

`~/.local/bin` needs to be on `PATH` for the command. The menu entry does not depend on that. A new login picks up the path on Manjaro. Launch errors are written to `~/.local/state/blackforest-tools/launch.log`.

To run it without installing the menu entry:

```bash
cd ~/shop-desktop
npm start
```

## What stays in sync

- Shop records come from the site as you use them, including `/_serverFn/`, `/api/google/start`, and `/api/shop-archive`.
- The first document load skips the HTTP cache, and the window asks to reload when a publish changes the site's scripts.
- **Shop → Reload and pick up site updates** (Ctrl+Shift+R) forces that immediately.
- This computer remembers the unlock, theme, and offline write queue for this window. That saved session lives in `~/.config/Black Forest Tools`. A browser on the same machine has its own. After you unlock here, you are on the same shop data.

Parts-catalog links open in the normal browser. Google sign-in stays in this window so Connect Google can finish back on the shop server.

## Shortcuts

| Shortcut | Action |
| --- | --- |
| Ctrl+R | Reload |
| Ctrl+Shift+R | Reload and pick up site updates |
| Alt+Left / Alt+Right | Back / forward |
| Alt+Home | Shop home |
| Ctrl+Q | Quit |

## Menus

The window keeps a normal Electron menu bar: **Shop**, **Labels**, **Settings**, **Edit**, **View**, **Help**.

- **Shop** — home, back/forward, reload, site-update check, quit
- **Labels** — thin service controls only: **Labels service status…** / **Restart Labels service** (also under Settings). Not a second Labels app; print buttons live on the shop site.
- **Settings → Check for updates** — desktop app updater (git pull in place on Manjaro and Windows Setup; Portable download only when there is no shop-desktop git checkout)
- **Help → About** — version info; About dialog also offers **Check for updates**

There is no in-page **Check for updates** button next to the avatar/header.


## Labels service (LabelWriter 550)

From **1.5.9**, Black Forest Tools **owns the Labels print service** (no day-to-day separate Labels desktop app):

- Vendored under [`labels/`](labels/) (synced from [label-connect](https://github.com/BlackForestPorsche/label-connect)).
- On Tools start: probe `127.0.0.1:8080`; if empty, spawn `node labels/server.mjs` (system Node, CUPS / Windows PrintTo unchanged). **Adopts** an already-running server (e.g. Manjaro `labels.service`).
- Desk extension keeps `POST /api/print-ro` to localhost — unchanged API.
- Print / settings **buttons** belong on the shop site — Tools does not embed Labels UI chrome.
- Thin menu: **Labels → status / restart** only.
- Not mixed into the pirate idle overlay.

```bash
npm run ensure-labels
npm run sync-labels -- ~/label-connect
```

## Update the window itself

Shop publishes do not require an update of this project — the window reloads the live site.

**Desktop-app** changes (menus, shortcuts, offline page, this updater) come from this repo:

- **Manjaro and Windows Setup (git install):** the app checks GitHub on a schedule and can **Update and restart** for you (`git pull` + `npm install`) in place — never a Portable download for routine updates.
- **Check for updates:** **Settings → Check for updates** (or **Help → About → Check for updates**). Same updater path. If a `%USERPROFILE%\shop-desktop` / `~/shop-desktop` checkout with an `origin` remote exists, that wins even when the running binary is a leftover Portable.
- **Windows portable (bootstrap only):** only when there is no usable shop-desktop git checkout does Check for updates offer the latest Portable `.exe` from GitHub Releases.

## Pirate idle overlay

After **5 minutes** with no mouse, keyboard, scroll, or touch activity in this window, a small pirate fleet starts sailing over the shop UI (Electron shell only — the hosted site is unchanged). Every additional 5 minutes of idle adds one more ship (capped). Each new ship lottery-picks one of four looks (pixel arcade, desk silhouette with brand blue, ink cartoon, night harbor neon). Ships **sail** across the water, trade cannon fire, can **ram and sink** each other, and respawn toward the idle target so the fight stays alive. **Click on empty water** dismisses the overlay (mousemove / hover / keys do not). Soft activity still resets the idle clock while the overlay is off. The idle clock keeps running while the window is visible (including unfocused / second monitor). While the pirate overlay is showing, Windows Page Visibility flaps (occlusion / multi-monitor) do not pause it. For QA, launch with `BF_IDLE_MS=10000` to use a 10s interval (production default stays 5 minutes).

### Pirate combat (optional, from 1.5.17; Settings launch from 1.5.18)

Idle-only people get the screensaver above, forever: no prompts, no HUD, no pressure to play. Combat is opt-in.

- **Start from Settings (from 1.5.18):** **Settings → Launch pirate game** opens the overlay immediately and takes the helm of a flagship — no 5-minute idle wait. It is a menu item only (no header button); if nobody uses it, idle behavior is unchanged. From **1.5.22**, a failed launch shows a dialog and writes `pirate:` lines to `%LOCALAPPDATA%\blackforest-tools\tools.log`. From **1.5.23**, every menu click logs immediately; if the in-page overlay cannot show, Tools opens a dedicated Pirate window so Launch always does something visible.
- **Start from the screensaver:** click one of the sailing ships (hover shows a small "Take the helm" tag). That ship becomes your flagship (brand-blue ring and pennant); the other ships on screen turn hostile. Clicking empty water still dismisses the whole overlay.
- **Sail:** **WASD / arrow keys** (A = left, D = right on screen).
- **Fire:** **click** (or hold) to land a cannonball where you click; clicking near an enemy leads the shot. **Space** fires at the nearest ship. Enemy shots show a red landing ring so you can sail out of the way.
- **Waves:** sloops, then brigs, then galleons. Sunk ships chain a combo (up to x4); some drop repair barrels, galleons and rare gilded ships drop chests. Between waves pick one of three refits (hull, reload, heavy shot, speed, twin guns, repair).
- **Leave:** **Esc** / **Stand down** returns to the screensaver (the fleet stays afloat). If you are sunk, **Sail again** or **Back to the sea**.
- **Progress:** best score / wave / ships sunk are kept in `localStorage` key `bf-tools-pirate-v1` (the shell window only; nothing is sent anywhere).
- Flavor only: ship names and pennants use fictional names and tiny generic pixel car silhouettes (coupe, SUV, wedge, sedan). No official badges or logos. Labels / DYMO printing is untouched.

Code: `src/idle-fleet.js` (idle fleet rules), `src/idle-combat.js` (combat rules, pure), `src/idle-fx.js` (particles), `src/idle-art.js` (canvas drawing), `src/shell-chrome.js` (overlay, HUD, input).

Manual update on Manjaro still works:

```bash
cd ~/shop-desktop
git pull
npm install
```

## Windows

**Setup is the Windows desk.** It is a git checkout of this repo at `%USERPROFILE%\shop-desktop` — the same shape as the Manjaro install — so it behaves like Linux: git auto-update, login autostart, Tools-owned Labels, shared widget session.

Run `scripts\bootstrap-windows.ps1` (or the compiled `Black.Forest.Tools-Setup.exe`, built by `npm run setup-windows`). It needs Git and Node on PATH (it tries `winget` when they are missing), then:

- clones / fast-forwards the checkout and runs `npm install` (this also installs the Labels print server dependencies);
- creates Start Menu + Desktop shortcuts for **Black Forest Tools** and **Black Forest Shop Widget**. They launch `electron.exe` directly (no npm window); `--widget` selects the widget process through `src/entry.js`;
- registers the `BlackForestShopDesktopUpdate` scheduled task (every 30 minutes, hidden) that fast-forwards `main`, plus Shop → Check for desktop updates inside the app;
- turns on **start at login** (Startup folder + `HKCU\...\Run`). Opt out with `install-windows.ps1 -NoAutostart` or `scripts\disable-tools-autostart.ps1`.

What Tools does on Windows, matching Manjaro:

- **Login / lock bridge:** the shared session lives in `%LOCALAPPDATA%\blackforest-tools\` (`widget-session.json`, `lock-latch.json`; Linux uses `$XDG_DATA_HOME/blackforest-tools`). Desk imports it from Tools' loopback bridge on `http://127.0.0.1:8788` — gate / lock never goes through Labels `:8080`. Writes retry on `EPERM`/`EBUSY` so a widget reading the file does not break a save.
- **Labels (Create RO print):** Tools starts the vendored `labels/` server on `127.0.0.1:8080` (or adopts one already running). It uses system Node, or falls back to Electron-as-Node when the desk has none. Print history is kept in `%LOCALAPPDATA%\blackforest-tools\labels`. Printing goes through Windows.Data.Pdf + `PrintDocument` to the LabelWriter/DYMO queue, then SumatraPDF, then shell `PrintTo` (details in label-connect's README; override with `LABELS_PRINTER`, `LABELS_WIN_ROTATE`, `LABELS_WIN_DPI`, `LABELS_WIN_PRINT`, `LABELS_SUMATRA`).
- **Shop Widget:** `npm run widget` / the Shop Widget shortcut (lot, book-today, notes) shares the same session file.
- **Open in Firefox signed in:** uses `firefox.exe` from Program Files when installed, otherwise the default browser.
- **Crash log / reports (1.5.20):** Tools writes `%LOCALAPPDATA%\blackforest-tools\tools.log` (rotates to `tools.log.1`; Help → Open logs folder) and Crashpad minidumps to `%LOCALAPPDATA%\blackforest-tools\crashes\`. Uncaught errors, rejected promises, dead renderers and GPU process exits are logged instead of ending the app; a dead renderer reloads (3 per 2 minutes, then the offline page). If the GPU process fails twice in 10 minutes Tools relaunches once with hardware acceleration off (`gpu-fallback.json` in the same folder; delete it to retry). Force it with `BF_TOOLS_DISABLE_GPU=1` / `--bf-disable-gpu`, or ignore the saved fallback with `BF_TOOLS_ENABLE_GPU=1`. Labels failures, the Desk bridge and the pirate screensaver are isolated: each logs and stays off rather than closing the window. Labels' own output is in `labels-server.log` beside it.
- **Windows flicker (1.5.21):** Tools disables Chromium `CalculateNativeWinOcclusion` (same switch Shop Widget already used) so partial cover / taskbar peek does not stop and restart painting. The pirate idle overlay also caps ambient redraw at 30fps and promotes its layer so translucent canvas compositing is less likely to tear.
- **Pirate launch on Windows (1.5.22–1.5.23):** Settings → Launch pirate recovers from a prior canvas fault, ignores `document.hidden` flaps while the overlay is up, and logs `pirate: menu-click` / `pirate: launch-requested` / `pirate: launch-ok` / `pirate: launch-aborted <reason>` to `tools.log` (via `console.log`/`warn`, which are always teed). If the shop-page overlay fails or is not visible, a dedicated Pirate BrowserWindow opens. A true failure of both paths shows a dialog.

**Portable (secondary):** GitHub Actions also builds a portable `.exe`. It is only a bootstrap for a machine that cannot run Setup yet — it has no git auto-update, no login autostart and no widget shortcut. Do not treat it as the day-to-day desk; run Setup.

To build the Windows packages yourself (on Windows):

```bash
npm install
npm run dist:win        # NSIS + Portable, labels/ shipped under resources/
npm run setup-windows   # dist/Black.Forest.Tools-Setup.exe (git Setup)
```

Outputs land in `dist/`.

## AppImage (Linux)

`npm run dist` builds a Linux AppImage with electron-builder. On Manjaro, an AppImage needs `fuse2`:

```bash
sudo pacman -S fuse2
```

The Manjaro source install above is the straightforward Linux setup.

## Shared login (Tools ↔ Plasma ↔ Firefox ↔ Desk)

One desk unlock covers Plasma widgets, Black Forest Tools, Firefox on the shop site, and the Black Forest Desk extension.

1. Unlock **Black Forest Tools** or a Plasma shop widget (person + PIN).
2. Tools writes `~/.local/share/blackforest-tools/widget-session.json` and, while running, serves the Bearer on loopback `http://127.0.0.1:8788/v1/widget-session` for Desk.
3. If Tools still has a shop gate cookie but the session file is missing/expired (window looks unlocked, Desk said “no shared session”), Tools **1.5.4+** re-mints the Bearer via `POST /api/widget/session/from-gate` on launch and after unlock.
4. Tools **1.5.5+** always `POST /api/widget/session/exchange` after unlock (and when a shared Bearer appears) so the Tools window SPA gets `bf_shop_gate` in the Electron jar — even when TanStack unlock Set-Cookie does not stick.
5. **Shop → Open in Firefox signed in** (or `npm run firefox-signed-in` / `blackforest-firefox-signed-in`) mints a one-time shop handoff URL and opens it in your **default** Firefox profile (`firefox --new-tab` — never a new profile).
6. Desk popup **Use Tools session** (or auto-import on open) pulls that Bearer — no PIN retype when Tools is already unlocked.

Requires shop site beta **0.1.25+** for `/api/widget/session/exchange` and `/api/widget/session/handoff`, and **0.1.34+** for `/api/widget/session/from-gate`.

## KDE Plasma widget (Manjaro)

Live shop views on the desktop or a panel. Uses the shop widget API (`/api/widget/…`, beta). Unlock once with your person + PIN; every widget instance on that computer shares the session.

- **On the Lot** and **Book — today** stay read-only.
- **My open notes** lists notes (`GET /api/widget/views/notes`) and, for desk/bot unlocks, can leave a note for a desk person (`POST /api/widget/notes`, shop beta 0.1.18+). Author comes from the session; pick a recipient, write the text, send.

Requires **Plasma 6** (Manjaro KDE current).

```bash
cd ~/shop-desktop
git pull
npm run install-plasma
```

That installs:

- the plasmoid to `~/.local/share/plasma/plasmoids/com.blackforestautomotive.shop`
- `blackforest-widget-session` to `~/.local/bin` (keeps the token file mode `0600`)
- `~/.local/share/blackforest-tools` at mode `700`
- a **30-minute** user systemd timer (`blackforest-shop-widget-update.timer`) that fast-forwards this git checkout and reinstalls the plasmoid when `main` moves — same idea as Pro Circuit. Lot and notes copies pick up new QML after that reinstall (plasmashell restarts when HEAD changed).

Then:

1. Right-click the desktop or a panel → **Add Widgets…**
2. Search for **Black Forest Shop** and add it (add more than once for multiple views)
3. Open the widget, unlock with your shop person and PIN
4. Configure each copy: right-click the widget → **Configure…** → pick **On the Lot**, **Book — today**, or **My open notes**, and the refresh interval

Lock from any instance clears the shared session for all copies. PIN and token are not logged. Notes creates use the same Bearer session; viewers can read notes but cannot create.

If the widget does not show up after install, log out of Plasma once, or run `plasmashell --replace &`. `~/.local/bin` must be on `PATH` so the widget can call the session helper.

Manual widget refresh (same as the timer):

```bash
cd ~/shop-desktop
bash scripts/update-plasma-widget.sh
```
