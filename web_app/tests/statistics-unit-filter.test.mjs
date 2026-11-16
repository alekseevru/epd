import test from "node:test";
import assert from "node:assert/strict";
import { isExpeditionOnlyTrip, isInternationalTruckUnit } from "../statistics-unit-filter.mjs";

test("excludes TMS rows only when both truck and driver are missing", () => {
  assert.equal(isExpeditionOnlyTrip({ "Клиент": "АГС" }), true);
  assert.equal(isExpeditionOnlyTrip({ "Номер автомашины": " ", "Водитель": null }), true);
  assert.equal(isExpeditionOnlyTrip({ "Клиент": "АГМ", "Номер автомашины": "Р737УХ198" }), false);
  assert.equal(isExpeditionOnlyTrip({ "Водитель": "Иванов Иван" }), false);
});

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
