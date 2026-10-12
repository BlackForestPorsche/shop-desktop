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
- Shop person + PIN unlock is shared with the Plasma widgets via `~/.local/share/blackforest-tools/widget-session.json` (mode `700` / `0600`). **Shop → Lock shop (widgets + this window)** clears both.
- When the site ships exchange/handoff, Black Forest Tools calls `POST /api/widget/session/exchange` so the Electron window gets `bf_shop_gate`, and **Shop → Open in Firefox signed in** (or `npm run firefox-signed-in` / menu entry **Shop in Firefox (signed in)**) opens a one-time handoff URL in Firefox. Until those routes exist, both paths fail quietly (404) without weakening PIN unlock.
- Display size and the Chromium profile for this window still live under `~/.config/Black Forest Tools`.

Parts-catalog links open in the normal browser. Google sign-in stays in this window so Connect Google can finish back on the shop server.

## Shortcuts

| Shortcut | Action |
| --- | --- |
| Ctrl+R | Reload |
| Ctrl+Shift+R | Reload and pick up site updates |
| Alt+Left / Alt+Right | Back / forward |
| Alt+Home | Shop home |
| Ctrl+Q | Quit |
| Alt | Show the menu |

## Update the window itself

Shop publishes do not require an update of this project — the window reloads the live site.

**Desktop-app** changes (menus, shortcuts, offline page, this updater) come from this repo:

- **Manjaro (git install):** the app checks GitHub on a schedule and can **Update and restart** for you (`git pull` + `npm install`). You can also use **Shop → Check for desktop app updates**.
- **Windows portable:** the app checks the latest GitHub Release and offers the new `.exe` download when `package.json` version is newer.

Manual update on Manjaro still works:

```bash
cd ~/shop-desktop
git pull
npm install
```

## Windows

GitHub Actions builds a portable Windows `.exe` on every push to `main`.

1. Open [shop-desktop Releases](https://github.com/BlackForestPorsche/shop-desktop/releases)
2. Download **Black Forest Tools-Portable-…exe**
3. Run it. Windows may warn about an unknown publisher — choose More info → Run anyway

Same live shop site as Manjaro. Unlock with your PIN.

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

Live shop views on the desktop or a panel. Uses the shop widget API (`/api/widget/…`, beta). Unlock once with your person + PIN; every widget instance **and Black Forest Tools** on that computer share the session file.

- **On the Lot** and **Book — today** stay read-only.
- **My open notes** lists notes (`GET /api/widget/views/notes`) and, for desk/bot unlocks, can leave a note for a desk person (`POST /api/widget/notes`, shop beta 0.1.18+). Author comes from the session; pick a recipient, write the text, send.
- Use the **folder-sync** tool button on the widget to pull `shop-desktop` and reinstall the plasmoid on demand (same path as the update script). No extra background timer.

Requires **Plasma 6** (Manjaro KDE current).

```bash
cd ~/shop-desktop
git pull
npm run install-plasma
```

That installs:

- the plasmoid to `~/.local/share/plasma/plasmoids/com.blackforestautomotive.shop`
- `blackforest-widget-session` / `blackforest-refresh-widget` to `~/.local/bin`
- `~/.local/share/blackforest-tools` at mode `700`
- a **30-minute** user systemd timer (`blackforest-shop-widget-update.timer`) that fast-forwards this git checkout and reinstalls the plasmoid when `main` moves — same idea as Pro Circuit
- login oneshots: `blackforest-desk-wake.service` (agent worker / widget helper / Pro Circuit timer check) and `blackforest-morning-glance.service` (one notify-send of book · lot · notes)

Then:

1. Right-click the desktop or a panel → **Add Widgets…**
2. Search for **Black Forest Shop** and add it (add more than once for multiple views)
3. Open the widget, unlock with your shop person and PIN
4. Configure each copy: right-click the widget → **Configure…** → pick **On the Lot**, **Book — today**, or **My open notes**, and the refresh interval

Lock from any widget instance or **Shop → Lock shop** in the desktop app clears the shared session for all copies. PIN and token are not logged. Notes creates use the same Bearer session; viewers can read notes but cannot create.

If the widget does not show up after install, log out of Plasma once, or run `plasmashell --replace &`. `~/.local/bin` must be on `PATH` so the widget can call the session helper.

Manual / on-demand widget shell refresh:

```bash
cd ~/shop-desktop
npm run refresh-plasma
# or: blackforest-refresh-widget --force
```

Test login oneshots without logging out:

```bash
systemctl --user start blackforest-desk-wake.service
systemctl --user start blackforest-morning-glance.service
```
