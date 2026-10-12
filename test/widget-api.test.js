"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { WIDGET_VIEWS, UNLOCK_PEOPLE, BASE } = require("../src/widget-api");

test("widget views match Plasma lot / book-today / notes", () => {
  assert.deepEqual(
    WIDGET_VIEWS.map((v) => v.id),
    ["lot", "book-today", "notes"],
  );
  assert.match(BASE, /shop\.blackforestautomotive\.com/);
});

test("unlock people include desk and viewer", () => {
  assert.ok(UNLOCK_PEOPLE.includes("logan"));
  assert.ok(UNLOCK_PEOPLE.includes("viewer"));
});
