import test from "node:test";
import assert from "node:assert/strict";
import { loadMonthlyDocuments } from "../statistics-pagination.mjs";

test("reads more than 20 pages without dropping older documents",async()=>{
  const calls=[];
  const documents=await loadMonthlyDocuments("2026-09","2026-09",async ({fromDocumentDate,toDocumentDate,afterIndexKey})=>{
    calls.push({fromDocumentDate,toDocumentDate,afterIndexKey});
    const offset=afterIndexKey?Number(afterIndexKey):0;
    return {TotalCount:2501,Documents:Array.from({length:Math.min(100,2501-offset)},(_,index)=>({IndexKey:String(offset+index+1)}))};
  });
  assert.equal(documents.length,2501);
  assert.equal(calls.length,26);
  assert.deepEqual([calls[0].fromDocumentDate,calls[0].toDocumentDate],["01.09.2026","30.09.2026"]);
});

test("requests each report month with its own date boundaries",async()=>{
  const ranges=[];
  await loadMonthlyDocuments("2026-09","2026-10",async ({fromDocumentDate,toDocumentDate})=>{
    ranges.push([fromDocumentDate,toDocumentDate]);
    return {Documents:[]};
  });
  assert.deepEqual(ranges,[["01.09.2026","30.09.2026"],["01.10.2026","31.10.2026"]]);
});

test("fails instead of returning incomplete data when pagination stops",async()=>{
  await assert.rejects(
    loadMonthlyDocuments("2026-09","2026-09",async()=>({Documents:Array.from({length:100},()=>({}))})),
    /Не удалось дочитать ЭТрН за 2026-09/
  );
});
