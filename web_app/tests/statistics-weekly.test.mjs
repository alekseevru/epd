import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {hasWeeklySnapshot,mondayKey,previousMondayKey,recordWeeklyStatistics} from "../statistics-weekly.mjs";

test("Monday boundary is calculated in Moscow time", () => {
  assert.equal(mondayKey(new Date("2026-11-01T20:59:59Z")), "2026-10-26");
  assert.equal(mondayKey(new Date("2026-11-01T21:00:00Z")), "2026-11-02");
  assert.equal(previousMondayKey("2026-11-02"), "2026-10-26");
});

test("weekly comparison freezes the first successful snapshot of each week", () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"etrn-weekly-"));
  try{
    const file=path.join(dir,"snapshots.json");
    const first=recordWeeklyStatistics(file,{items:[{number:"A"}],tmsTrips:[]},new Date("2026-10-29T09:00:00Z"));
    assert.equal(first.previous,null);
    const second=recordWeeklyStatistics(file,{items:[{number:"B"}],tmsTrips:[]},new Date("2026-11-02T09:00:00Z"));
    assert.equal(second.previous.items[0].number,"A");
    assert.equal(hasWeeklySnapshot(file,new Date("2026-11-02T09:00:00Z")),true);
    const third=recordWeeklyStatistics(file,{items:[{number:"C"}],tmsTrips:[]},new Date("2026-11-05T09:00:00Z"));
    assert.equal(third.previous.items[0].number,"A");
    assert.equal(third.current.items[0].number,"B");
    assert.equal(JSON.parse(fs.readFileSync(file,"utf8"))["2026-11-02"].items[0].number,"B");
    assert.equal(hasWeeklySnapshot(file,new Date("2026-11-09T09:00:00Z")),false);
    const fourth=recordWeeklyStatistics(file,{items:[{number:"D"}],tmsTrips:[]},new Date("2026-11-09T09:00:00Z"));
    assert.equal(fourth.previous.items[0].number,"B");
    assert.equal(fourth.current.items[0].number,"D");
    assert.equal(Object.keys(JSON.parse(fs.readFileSync(file,"utf8"))).length,3);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
