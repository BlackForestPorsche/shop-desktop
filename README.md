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

The window keeps a normal Electron menu bar: **Shop**, **Settings**, **Edit**, **View**, **Help**.

- **Shop** — home, back/forward, reload, site-update check, quit
- **Settings → Check for updates** — desktop app updater (git pull on Manjaro; portable download on Windows)
- **Help → About** — version info; About dialog also offers **Check for updates**

There is no in-page **Check for updates** button next to the avatar/header.

## Update the window itself

Shop publishes do not require an update of this project — the window reloads the live site.

**Desktop-app** changes (menus, shortcuts, offline page, this updater) come from this repo:

- **Manjaro (git install):** the app checks GitHub on a schedule and can **Update and restart** for you (`git pull` + `npm install`).
- **Check for updates:** **Settings → Check for updates** (or **Help → About → Check for updates**). Same updater path.
- **Windows portable:** the app checks the latest GitHub Release and offers the new `.exe` download when `package.json` version is newer.

## Pirate idle overlay

After **5 minutes** with no mouse, keyboard, scroll, or touch activity in this window, a small pirate fleet starts sailing over the shop UI (Electron shell only — the hosted site is unchanged). Every additional 5 minutes of idle adds one more ship (capped). Each new ship lottery-picks one of four looks (pixel arcade, desk silhouette with brand blue, ink cartoon, night harbor neon). When two or more ships are out they trade cannon fire. Any input dismisses the overlay and resets the idle clock. The idle clock keeps running while the window is visible (including unfocused / second monitor); it pauses only when the page is hidden. For QA, launch with `BF_IDLE_MS=10000` to use a 10s interval (production default stays 5 minutes).

Manual update on Manjaro still works:

```bash
cd ~/shop-desktop
git pull
npm install
```

## Windows

**Setup (preferred on shop desks):** run `scripts/bootstrap-windows.ps1` (or the compiled Setup.exe from Releases when published). That clones `%USERPROFILE%\shop-desktop`, installs shortcuts, arms the 30-minute git update task, **starts Tools at login** (Startup folder + Run key), and launches Tools. Opt out of login start: `install-windows.ps1 -NoAutostart`, or later `scripts/disable-tools-autostart.ps1`.

GitHub Actions also builds a portable Windows `.exe` on every push to `main`.

1. Open [shop-desktop Releases](https://github.com/BlackForestPorsche/shop-desktop/releases)
2. Download **Black Forest Tools-Portable-…exe**
3. Run it. Windows may warn about an unknown publisher — choose More info → Run anyway

Same live shop site as Manjaro. Unlock with your PIN. Portable builds do not register login autostart; use Setup / `install-windows.ps1` for that.

To build the Windows app yourself (on Windows):

```bash
npm install
npm run dist:win
```

Outputs land in `dist/`.

## AppImage (Linux)

`npm run dist` builds a Linux AppImage with electron-builder. On Manjaro, an AppImage needs `fuse2`:

```bash
sudo pacman -S fuse2
```

The Manjaro source install above is the straightforward Linux setup.

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
