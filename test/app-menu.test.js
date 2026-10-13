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
    onOpenFirefoxSignedIn() {},
    onLockShop() {},
    onOpenInBrowser() {},
    onAbout() {},
  };
}

test("application menu top-level labels are Shop / Settings / Edit / View / Help", () => {
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

test("Shop menu keeps navigation and site updates, not the desktop updater label", () => {
  const template = buildAppMenuTemplate(handlers());
  const shop = template.find((item) => item.label === "Shop");
  const labels = shop.submenu.map((item) => item.label).filter(Boolean);
  assert.ok(labels.includes("Shop home"));
  assert.ok(labels.includes("Open in Firefox signed in"));
  assert.ok(labels.includes("Lock shop (widgets + this window)"));
  assert.ok(labels.includes("Reload and pick up site updates"));
  assert.ok(labels.includes("Check for site updates"));
  assert.ok(labels.includes("Quit"));
  assert.ok(!labels.includes("Check for updates"));
  assert.ok(!labels.includes("Check for desktop app updates"));
});

test("Help menu keeps About Black Forest Tools", () => {
  const template = buildAppMenuTemplate(handlers());
  const help = template.find((item) => item.label === "Help");
  const labels = help.submenu.map((item) => item.label);
  assert.ok(labels.includes("About Black Forest Tools"));
  assert.ok(labels.includes("Open this page in Firefox signed in"));
});
