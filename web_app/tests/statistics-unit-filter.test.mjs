import test from "node:test";
import assert from "node:assert/strict";
import { isInternationalTruckUnit } from "../statistics-unit-filter.mjs";

test("excludes international truck identifiers from statistics", () => {
  assert.equal(isInternationalTruckUnit("HM6065/H038Y"), true);
  assert.equal(isInternationalTruckUnit("ki8624/a901r"), true);
  assert.equal(isInternationalTruckUnit("  OJ2813/C349J  "), true);
});

test("retains ISO containers and other cargo identifiers", () => {
  assert.equal(isInternationalTruckUnit("TEMU7742835"), false);
  assert.equal(isInternationalTruckUnit("HM6065"), false);
  assert.equal(isInternationalTruckUnit(""), false);
});
