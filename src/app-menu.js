"use strict";

/**
 * Native application menu template for Black Forest Tools.
 * Shop / Settings / Help are the product menus; Edit + View stay for standard roles.
 * Labels is a thin service menu (status / restart) — print UX lives on the shop site.
 *
 * @param {{
 *   onShopHome: () => void,
 *   onBack: () => void,
 *   onForward: () => void,
 *   onReload: () => void,
 *   onHardReload: () => void,
 *   onCheckSiteUpdates: () => void,
 *   onCheckAppUpdates: () => void,
 *   onOpenFirefoxSignedIn: () => void,
 *   onLabelsStatus: () => void,
 *   onRestartLabels: () => void,
 *   onLockShop: () => void,
 *   onOpenInBrowser: () => void,
 *   onAbout: () => void,
 * }} handlers
 */
function buildAppMenuTemplate(handlers) {
  return [
    {
      label: "Shop",
      submenu: [
        { label: "Shop home", accelerator: "Alt+Home", click: handlers.onShopHome },
        { label: "Back", accelerator: "Alt+Left", click: handlers.onBack },
        { label: "Forward", accelerator: "Alt+Right", click: handlers.onForward },
        { type: "separator" },
        {
          label: "Open in Firefox signed in",
          accelerator: "CmdOrCtrl+Shift+F",
          click: handlers.onOpenFirefoxSignedIn,
        },
        { type: "separator" },
        { label: "Reload", accelerator: "CmdOrCtrl+R", click: handlers.onReload },
        {
          label: "Reload and pick up site updates",
          accelerator: "CmdOrCtrl+Shift+R",
          click: handlers.onHardReload,
        },
        { type: "separator" },
        { label: "Check for site updates", click: handlers.onCheckSiteUpdates },
        { type: "separator" },
        {
          label: "Lock shop (widgets + this window)",
          click: handlers.onLockShop,
        },
        { type: "separator" },
        { label: "Quit", accelerator: "CmdOrCtrl+Q", role: "quit" },
      ],
    },
    {
      label: "Labels",
      submenu: [
        {
          label: "Labels service status…",
          click: handlers.onLabelsStatus,
        },
        {
          label: "Restart Labels service",
          click: handlers.onRestartLabels,
        },
      ],
    },
    {
      label: "Settings",
      submenu: [
        {
          label: "Check for updates",
          click: handlers.onCheckAppUpdates,
        },
        { type: "separator" },
        {
          label: "Labels service status…",
          click: handlers.onLabelsStatus,
        },
        {
          label: "Restart Labels service",
          click: handlers.onRestartLabels,
        },
        { type: "separator" },
        {
          label: "Open in Firefox signed in",
          click: handlers.onOpenFirefoxSignedIn,
        },
        {
          label: "Lock shop (widgets + this window)",
          click: handlers.onLockShop,
        },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "Open this page in Firefox signed in",
          click: handlers.onOpenInBrowser,
        },
        {
          label: "About Black Forest Tools",
          click: handlers.onAbout,
        },
      ],
    },
  ];
}

/** Top-level menu labels in display order (for tests / docs). */
const APP_MENU_LABELS = ["Shop", "Labels", "Settings", "Edit", "View", "Help"];

module.exports = {
  buildAppMenuTemplate,
  APP_MENU_LABELS,
};
