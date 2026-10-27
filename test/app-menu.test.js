"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildAppMenuTemplate, APP_MENU_LABELS } = require("../src/app-menu");

function handlers() {
  return {
    onShopHome() {},
    onBack() {},
    onForward() {},
    onReload() {},
    onHardReload() {},
    onCheckSiteUpdates() {},
    onCheckAppUpdates() {},
    onLaunchPirateGame() {},
    onPirateLeaderboard() {},
    onLabelsStatus() {},
    onRestartLabels() {},
    onOpenFirefoxSignedIn() {},
    onLockShop() {},
    onOpenInBrowser() {},
    onAbout() {},
  };
}

test("application menu top-level labels are Shop / Labels / Settings / Edit / View / Help", () => {
  const template = buildAppMenuTemplate(handlers());
  assert.deepEqual(
    template.map((item) => item.label),
    APP_MENU_LABELS,
  );
});

test("Settings menu exposes Check for updates and wires the app updater", () => {
  let called = 0;
  const h = handlers();
  h.onCheckAppUpdates = () => {
    called += 1;
  };
  const template = buildAppMenuTemplate(h);
  const settings = template.find((item) => item.label === "Settings");
  assert.ok(settings);
  const updateItem = settings.submenu.find((item) => item.label === "Check for updates");
  assert.ok(updateItem);
  assert.equal(typeof updateItem.click, "function");
  updateItem.click();
  assert.equal(called, 1);
});

test("Shop and Settings expose Open in Firefox signed in", () => {
  let shopCalls = 0;
  let settingsCalls = 0;
  const h = handlers();
  h.onOpenFirefoxSignedIn = () => {
    shopCalls += 1;
    settingsCalls += 1;
  };
  const template = buildAppMenuTemplate(h);
  const shop = template.find((item) => item.label === "Shop");
  const settings = template.find((item) => item.label === "Settings");
  const shopItem = shop.submenu.find((item) => item.label === "Open in Firefox signed in");
  const settingsItem = settings.submenu.find((item) => item.label === "Open in Firefox signed in");
  assert.ok(shopItem);
  assert.ok(settingsItem);
  assert.equal(shopItem.accelerator, "CmdOrCtrl+Shift+F");
  shopItem.click();
  settingsItem.click();
  assert.equal(shopCalls, 2);
});

test("Labels menu is status/restart only — no full Labels app chrome", () => {
  let statusCalls = 0;
  let restartCalls = 0;
  const h = handlers();
  h.onLabelsStatus = () => {
    statusCalls += 1;
  };
  h.onRestartLabels = () => {
    restartCalls += 1;
  };
  const template = buildAppMenuTemplate(h);
  const labelsMenu = template.find((item) => item.label === "Labels");
  const settings = template.find((item) => item.label === "Settings");
  assert.ok(labelsMenu);
  const labelsLabels = labelsMenu.submenu.map((item) => item.label).filter(Boolean);
  assert.deepEqual(labelsLabels, ["Labels service status…", "Restart Labels service"]);
  assert.ok(!labelsLabels.some((label) => /open labels|bench/i.test(label)));
  labelsMenu.submenu.find((item) => item.label === "Labels service status…").click();
  labelsMenu.submenu.find((item) => item.label === "Restart Labels service").click();
  settings.submenu.find((item) => item.label === "Labels service status…").click();
  settings.submenu.find((item) => item.label === "Restart Labels service").click();
  assert.equal(statusCalls, 2);
  assert.equal(restartCalls, 2);
});

test("Shop menu keeps navigation and site updates, not the desktop updater label", () => {
  const template = buildAppMenuTemplate(handlers());
  const shop = template.find((item) => item.label === "Shop");
  const labels = shop.submenu.map((item) => item.label).filter(Boolean);
  assert.ok(labels.includes("Shop home"));
  assert.ok(!labels.includes("Open Labels"));
  assert.ok(labels.includes("Open in Firefox signed in"));
  assert.ok(labels.includes("Lock shop (widgets + this window)"));
  assert.ok(labels.includes("Reload and pick up site updates"));
  assert.ok(labels.includes("Check for site updates"));
  assert.ok(labels.includes("Quit"));
  assert.ok(!labels.includes("Check for updates"));
  assert.ok(!labels.includes("Check for desktop app updates"));
});

test("Help menu opens Firefox signed in and keeps About", () => {
  const template = buildAppMenuTemplate(handlers());
  const help = template.find((item) => item.label === "Help");
  const labels = help.submenu.map((item) => item.label);
  assert.ok(labels.includes("About Black Forest Tools"));
  assert.ok(labels.includes("Open this page in Firefox signed in"));
});

test("Settings menu leads with a disabled installed-revision line when given", () => {
  const h = { ...handlers(), revisionLabel: "Version 1.5.13 (abc1234)" };
  const settings = buildAppMenuTemplate(h).find((item) => item.label === "Settings");
  assert.equal(settings.submenu[0].label, "Version 1.5.13 (abc1234)");
  assert.equal(settings.submenu[0].enabled, false);
  assert.equal(settings.submenu[1].type, "separator");
});

test("Settings menu has no revision line when none is given", () => {
  const h = { ...handlers(), revisionLabel: null };
  const settings = buildAppMenuTemplate(h).find((item) => item.label === "Settings");
  assert.equal(settings.submenu[0].label, "Check for updates");
});

test("Settings menu defaults to this install's package.json version", () => {
  const { version } = require("../package.json");
  const settings = buildAppMenuTemplate(handlers()).find((item) => item.label === "Settings");
  assert.match(settings.submenu[0].label, new RegExp(`^Version ${version.replace(/\./g, "\\.")}`));
  assert.equal(settings.submenu[0].enabled, false);
});

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
  const board = settings.submenu.find((entry) => entry.label === "Pirate leaderboard");
  assert.ok(board);
  for (const menu of template.filter((entry) => entry.label !== "Settings")) {
    assert.ok(!menu.submenu.some((entry) => /pirate/i.test(entry.label || "")));
  }
});
