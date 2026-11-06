import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { getRows, refreshTmsContainers } from "../tms-sync.mjs";

test("TTN/CMR changed in November is retained even when created in September", async t => {
  const originalFetch=globalThis.fetch;
  t.after(()=>{globalThis.fetch=originalFetch;});
  globalThis.fetch=async(_url,options)=>{
    const request=JSON.parse(new URLSearchParams(options.body).get("json"));
    const values={ID:132069,ID_OPERATION_TYPE:1,DT_CREATE:"2025-09-25T06:55:05.337762Z",DT_UPDATE:"2026-11-06T12:35:46.634Z",UNITS_NUMBERS:"FITU5573421",COMPANY_EXECUTOR_NAME:'ООО "РУСКОМ"'};
    return Response.json({result:{status:"success",rows:[request.viewedFields.map(field=>values[field]??"")]}});
  };
  const fields={ID:"Номер записи",ID_OPERATION_TYPE:"Тип операции",DT_CREATE:"Дата создания строки",DT_UPDATE:"Дата обновления строки",UNITS_NUMBERS:"Номера грузовых единиц",COMPANY_EXECUTOR_NAME:"Исполнитель"};
  const rows=await getRows({cookie:"",token:""},"OPERATION_SUB_DOC",fields,null,"2026-07-06");
  assert.equal(rows.length,1);
  assert.equal(rows[0]["Исполнитель"],'ООО "РУСКОМ"');
});

test("addressed TMS refresh replaces a cached TTN/CMR record with its current executor", async t => {
  const cacheDir=fs.mkdtempSync(path.join(os.tmpdir(),"epd-tms-refresh-"));
  t.after(()=>fs.rmSync(cacheDir,{recursive:true,force:true}));
  fs.writeFileSync(path.join(cacheDir,"auto.json"),JSON.stringify([{
    "Номер записи":"132069","Номера грузовых единиц":"FITU5573421","Исполнитель":"",
  }]));
  const originalFetch=globalThis.fetch;
  t.after(()=>{globalThis.fetch=originalFetch;});
  const requests=[];
  globalThis.fetch=async(url,options)=>{
    if(String(url).endsWith("/login")&&!options?.method)return new Response("",{headers:{"set-cookie":"token=abc; Path=/"}});
    if(String(url).endsWith("/login"))return Response.json({result:{status:"success"}});
    const payload=JSON.parse(new URLSearchParams(options.body).get("json"));
    const table=String(url).split("/").at(-1);
    if(payload.viewedFields.length===2&&payload.viewedFields[0]==="ID"){
      return Response.json({result:{status:payload.viewedFields[1]==="UNIT_TYPES"?"success":"error",rows:[]}});
    }
    requests.push({table,payload});
    if(table==="OPERATION_UNIT")return Response.json({result:{status:"success",rows:[]}});
    const values={ID:132069,ID_OPERATION_TYPE:1,UNITS_NUMBERS:"FITU5573421",COMPANY_EXECUTOR_NAME:'ООО "РУСКОМ"',UNIT_TYPES:"1x40HC"};
    return Response.json({result:{status:"success",rows:[payload.viewedFields.map(field=>values[field]??"")]}});
  };
  const result=await refreshTmsContainers({login:"test",password:"test",cacheDir,containers:["FITU5573421"]});
  assert.equal(result.auto,1);
  assert.equal(result.records[0].carrier,'ООО "РУСКОМ"');
  assert.equal(requests.find(request=>request.table==="OPERATION_SUB_DOC").payload.filters.value[1][2],"FITU5573421");
  const saved=JSON.parse(fs.readFileSync(path.join(cacheDir,"auto.json"),"utf8"));
  assert.equal(saved.length,1);
  assert.equal(saved[0]["Исполнитель"],'ООО "РУСКОМ"');
});
