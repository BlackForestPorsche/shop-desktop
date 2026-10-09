"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { stampFromHtml } = require("../src/updates");

const PAGE_A = `
<link rel="stylesheet" href="/assets/styles-BL41MGkt.css" />
<link rel="stylesheet" href="/assets/index-Bef2EhLn.css" />
<link rel="modulepreload" href="/assets/index-Dv5-Go7-.js" />
<script type="module" src="/assets/index-Dv5-Go7-.js"></script>
`;

const PAGE_B = `
<link rel="stylesheet" href="/assets/styles-NEW.css" />
<script type="module" src="/assets/index-AFTER-DEPLOY.js"></script>
`;

test("a stamp identifies the assets the live page is serving", () => {
  const stamp = stampFromHtml(PAGE_A);
  assert.equal(
    stamp,
    [
      "/assets/index-Bef2EhLn.css",
      "/assets/index-Dv5-Go7-.js",
      "/assets/styles-BL41MGkt.css",
    ].join("|"),
  );
});

test("a newly published shop bundle changes the stamp", () => {
  assert.notEqual(stampFromHtml(PAGE_A), stampFromHtml(PAGE_B));
});

test("absolute and relative asset urls collapse to the same stamp", () => {
  const absolute = stampFromHtml(
    `<script src="https://shop.blackforestautomotive.com/assets/index-Dv5-Go7-.js"></script>`,
  );
  const relative = stampFromHtml(`<script src="/assets/index-Dv5-Go7-.js"></script>`);
  assert.equal(absolute, relative);
});

test("empty or asset-free html has an empty stamp", () => {
  assert.equal(stampFromHtml(""), "");
  assert.equal(stampFromHtml("<html><body>Unlock</body></html>"), "");
});
