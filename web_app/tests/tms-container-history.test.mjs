import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { refreshTmsContainers } from "../tms-sync.mjs";

test("container history fetches and retains old and new TTN/CMR operations", async t => {
  const cacheDir=fs.mkdtempSync(path.join(os.tmpdir(),"epd-tms-history-"));
  t.after(()=>fs.rmSync(cacheDir,{recursive:true,force:true}));
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
    const operation=(id,created,carrier)=>({ID:id,ID_OPERATION_TYPE:1,DT_CREATE:created,UNITS_NUMBERS:"FITU5573421",COMPANY_EXECUTOR_NAME:carrier,UNIT_TYPES:"1x40HC"});
    const rows=[operation(132069,"2025-09-25T06:55:05.337762Z",'ООО "РУСКОМ"'),operation(199999,"2026-11-06T12:35:46.634Z","R Cube Logistics & Consulting")];
    return Response.json({result:{status:"success",rows:rows.map(row=>payload.viewedFields.map(field=>row[field]??""))}});
  };
  const result=await refreshTmsContainers({login:"test",password:"test",cacheDir,containers:["FITU5573421"]});
  assert.equal(result.auto,2);
  const request=requests.find(item=>item.table==="OPERATION_SUB_DOC").payload;
  assert.equal(request.filters.value[1][2],"FITU5573421");
  assert.ok(request.viewedFields.includes("DT_CREATE"));
  const saved=JSON.parse(fs.readFileSync(path.join(cacheDir,"auto.json"),"utf8"));
  assert.equal(saved.length,2);
  assert.equal(saved.find(row=>row["Номер записи"]===132069)["Исполнитель"],'ООО "РУСКОМ"');
  assert.equal(saved.find(row=>row["Номер записи"]===132069)["Дата создания строки"],"2025-09-25T06:55:05.337762Z");
});

test("container history falls back to cached record ID when TMS rejects UNITS_NUMBERS filter", async t => {
  const cacheDir=fs.mkdtempSync(path.join(os.tmpdir(),"epd-tms-history-id-"));
  t.after(()=>fs.rmSync(cacheDir,{recursive:true,force:true}));
  fs.writeFileSync(path.join(cacheDir,"auto.json"),JSON.stringify([{"Номер записи":132069,"Номера грузовых единиц":"FITU5573421","Исполнитель":"R Cube Logistics & Consulting"}]));
  const originalFetch=globalThis.fetch;
  t.after(()=>{globalThis.fetch=originalFetch;});
  const requests=[];
  globalThis.fetch=async(url,options)=>{
    if(String(url).endsWith("/login")&&!options?.method)return new Response("",{headers:{"set-cookie":"token=abc; Path=/"}});
    if(String(url).endsWith("/login"))return Response.json({result:{status:"success"}});
    const payload=JSON.parse(new URLSearchParams(options.body).get("json"));
    const table=String(url).split("/").at(-1);
    if(payload.viewedFields.length===2&&payload.viewedFields[0]==="ID")return Response.json({result:{status:payload.viewedFields[1]==="UNIT_TYPES"?"success":"error",rows:[]}});
    requests.push({table,payload});
    if(table==="OPERATION_UNIT")return Response.json({result:{status:"success",rows:[]}});
    if(payload.filters?.value?.some(([field])=>field==="UNITS_NUMBERS"))return Response.json({result:{status:"error",message:"unsupported filter"}});
    const row={ID:132069,ID_OPERATION_TYPE:1,DT_CREATE:"2025-09-25T06:55:05.337762Z",UNITS_NUMBERS:"FITU5573421",COMPANY_EXECUTOR_NAME:'ООО "РУСКОМ"',UNIT_TYPES:"1x40HC"};
    return Response.json({result:{status:"success",rows:[payload.viewedFields.map(field=>row[field]??"")]}});
  };
  const result=await refreshTmsContainers({login:"test",password:"test",cacheDir,containers:["FITU5573421"]});
  assert.equal(result.auto,1);
  assert.ok(requests.some(({payload})=>payload.filters?.value?.some(([field,,value])=>field==="ID"&&value===132069)));
  const saved=JSON.parse(fs.readFileSync(path.join(cacheDir,"auto.json"),"utf8"));
  assert.equal(saved[0]["Исполнитель"],'ООО "РУСКОМ"');
});
