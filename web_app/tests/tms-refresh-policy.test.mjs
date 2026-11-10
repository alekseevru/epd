import test from "node:test";
import assert from "node:assert/strict";
import { needsTmsRefresh } from "../tms-refresh-policy.mjs";

const now = Date.parse("2026-11-10T12:00:00Z");
const old = {"Номера грузовых единиц":"FESU5238778","Дата создания строки":"2026-06-19T04:10:13Z","Водитель":"Степанов Владислав Александрович","Номер автомашины":"У829КР761"};
test("old TMS record is rechecked even when transport fields are filled", () => {
  assert.equal(needsTmsRefresh(old, 0, now), true);
  assert.equal(needsTmsRefresh(old, now - 60_000, now), false);
  assert.equal(needsTmsRefresh(old, now - 25 * 60 * 60_000, now), true);
});
test("missing driver or truck is rechecked within regular window", () => {
  const recent = {...old,"Дата создания строки":"2026-11-01T04:10:13Z","Водитель":""};
  assert.equal(needsTmsRefresh(recent, 0, now), true);
  assert.equal(needsTmsRefresh(recent, now - 10 * 60_000, now), false);
  assert.equal(needsTmsRefresh(recent, now - 31 * 60_000, now), true);
});
test("complete recent record is served from the regular sync", () => {
  assert.equal(needsTmsRefresh({...old,"Дата создания строки":"2026-11-01T04:10:13Z"}, 0, now), false);
});
test("record without a creation date is checked rather than assumed fresh", () => {
  assert.equal(needsTmsRefresh({...old,"Дата создания строки":""}, 0, now), true);
});
