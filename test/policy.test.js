"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { classifyUrl, SHOP_HOME } = require("../src/policy");

test("shop pages stay in the window, including the shop APIs", () => {
  for (const href of [
    SHOP_HOME,
    "https://shop.blackforestautomotive.com/book",
    "https://shop.blackforestautomotive.com/lot?day=2026-10-09",
    "https://shop.blackforestautomotive.com/api/google/start",
    "https://shop.blackforestautomotive.com/api/shop-archive",
    "https://shop.blackforestautomotive.com/_serverFn/abc",
  ]) {
    const decision = classifyUrl(href);
    assert.equal(decision.kind, "shop");
    assert.equal(decision.href, href);
  }
});

test("plain http to the shop is upgraded to https", () => {
  const decision = classifyUrl("http://shop.blackforestautomotive.com/notes");
  assert.equal(decision.kind, "shop");
  assert.equal(decision.href, "https://shop.blackforestautomotive.com/notes");
});

test("Google sign-in stays in the window so the shop can finish Connect Google", () => {
  for (const href of [
    "https://accounts.google.com/o/oauth2/v2/auth?client_id=shop",
    "https://accounts.google.com/ServiceLogin",
    "https://oauth2.googleapis.com/token",
    "https://www.gstatic.com/checklist/foo",
  ]) {
    assert.equal(classifyUrl(href).kind, "auth", href);
  }
});

test("parts catalogs and other sites open outside the window", () => {
  const samples = [
    "https://www.pelicanparts.com/More_Info/0PB115466.htm?pn=0PB-115-466-M67",
    "https://www.suncoastparts.com/product/PK991POL.html",
    "https://blackforestautomotive.com/",
    "https://shop.blackforestautomotive.com.evil.example/book",
    "https://evil.example/shop.blackforestautomotive.com",
  ];
  for (const href of samples) {
    const decision = classifyUrl(href);
    assert.equal(decision.kind, "external", href);
    assert.equal(decision.href, href);
  }
});

test("mail and phone links open outside, and odd schemes are ignored", () => {
  assert.equal(classifyUrl("mailto:service@blackforestautomotive.com").kind, "external");
  assert.equal(classifyUrl("tel:+18585551212").kind, "external");
  assert.equal(classifyUrl("javascript:alert(1)").kind, "ignore");
  assert.equal(classifyUrl("file:///etc/passwd").kind, "ignore");
  assert.equal(classifyUrl("about:blank").kind, "ignore");
  assert.equal(classifyUrl("not a url").kind, "ignore");
});

test("a userinfo trick does not count as the shop", () => {
  const decision = classifyUrl("https://shop.blackforestautomotive.com@evil.example/book");
  assert.equal(decision.kind, "external");
  assert.equal(new URL(decision.href).hostname, "evil.example");
});
