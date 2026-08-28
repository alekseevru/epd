import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { syncTms } from "./tms-sync.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const localEnvFile = path.join(root,"..",".env");
if (fs.existsSync(localEnvFile) && typeof process.loadEnvFile === "function") process.loadEnvFile(localEnvFile);
const clientRoot = path.join(root, "dist", "client");
const vinextCli = path.join(root, "node_modules", "vinext", "dist", "cli.js");
const appPort = 3001;
const publicPort = Number(process.env.PORT || 3000);
const cacheRoot = path.join(root,"work","source-cache");
const credentialsFile = path.join(root,"work","tms-credentials.json");
const konturTokenFile = path.join(root,"work","kontur-tokens.json");
const referenceRoot = process.env.AGR_REFERENCES_DIR || path.join(root,"..","data","references");
const konturIdentityUrl = "https://identity.kontur.ru";
const diadocApiUrl = process.env.KONTUR_DIADOC_API_URL || "https://diadoc-api.kontur.ru";
const konturScopes = process.env.KONTUR_SCOPES || "openid profile email offline_access kl.public.api kl.transportations.orders.public.api Diadoc.PublicAPI";

const konturConfig = () => ({
  clientId: process.env.KONTUR_CLIENT_ID || "",
  clientSecret: process.env.KONTUR_CLIENT_SECRET || "",
  redirectUri: process.env.KONTUR_REDIRECT_URI || "",
  boxId: process.env.KONTUR_LOGISTICS_BOX_ID || "",
});
const requestCookies = (request) => Object.fromEntries(String(request.headers.cookie||"").split(";").map(item=>item.trim().split(/=(.*)/s)).filter(([key])=>key).map(([key,value])=>[key,decodeURIComponent(value||"")]));
const konturStateCookie = (state,maxAge=600) => {
  const secure=konturConfig().redirectUri.startsWith("https://")?"; Secure":"";
  return `kontur_oauth_state=${encodeURIComponent(state)}; Path=/api/kontur; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
};
function loadKonturTokens() {
  if (!fs.existsSync(konturTokenFile)) return null;
  try { return JSON.parse(fs.readFileSync(konturTokenFile,"utf8")); } catch { return null; }
}
function saveKonturTokens(tokens) {
  fs.mkdirSync(path.dirname(konturTokenFile),{recursive:true});
  fs.writeFileSync(konturTokenFile,JSON.stringify(tokens),{encoding:"utf8",mode:0o600});
  try { fs.chmodSync(konturTokenFile,0o600); } catch { /* Windows does not support POSIX modes */ }
}
async function exchangeKonturToken(parameters) {
  const config=konturConfig();
  const response=await fetch(`${konturIdentityUrl}/connect/token`,{
    method:"POST",
    headers:{"Content-Type":"application/x-www-form-urlencoded","Accept":"application/json"},
    body:new URLSearchParams({...parameters,client_id:config.clientId,client_secret:config.clientSecret}),
  });
  const text=await response.text();
  let result; try { result=JSON.parse(text); } catch { result={error_description:text}; }
  if(!response.ok||!result.access_token) throw new Error(result.error_description||result.error||`Контур вернул HTTP ${response.status}`);
  const previous=loadKonturTokens()||{};
  const tokens={...previous,...result,expires_at:Date.now()+Number(result.expires_in||3600)*1000};
  saveKonturTokens(tokens); return tokens;
}
async function getKonturAccessToken() {
  const tokens=loadKonturTokens();
  if(!tokens?.access_token) throw new Error("Сначала подключите учётную запись Контур");
  if(Number(tokens.expires_at||0)>Date.now()+60_000) return tokens.access_token;
  if(!tokens.refresh_token) throw new Error("Сеанс Контур истёк. Выполните вход повторно");
  const refreshed=await exchangeKonturToken({grant_type:"refresh_token",refresh_token:tokens.refresh_token});
  return refreshed.access_token;
}
async function verifyKonturBox(accessToken) {
  const config=konturConfig();
  const response=await fetch(`${diadocApiUrl}/GetMyOrganizations`,{headers:{Authorization:`Bearer ${accessToken}`,"Accept":"application/json"}});
  const text=await response.text(); let result; try{result=JSON.parse(text);}catch{result={};}
  if(!response.ok) throw new Error(result.message||`Не удалось проверить ящик Контур: HTTP ${response.status}`);
  const boxes=(result.Organizations||[]).flatMap(organization=>organization.Boxes||[]);
  const expected=config.boxId.toLowerCase().replace(/@diadoc\.ru$/,"").replaceAll("-","");
  const hasAccess=boxes.some(box=>[box.BoxIdGuid,box.BoxId].some(value=>String(value||"").toLowerCase().replace(/@diadoc\.ru$/,"").replaceAll("-","")===expected));
  if(!hasAccess) throw new Error("У пользователя нет доступа к указанному ящику Таглекс");
}
const konturDocumentFormat = (kind) => kind === "order"
  ? {TypeNamedId:"LogisticsOrderRequest",Function:"default",Version:"zakzvper_05_01_01",EditingSettingId:"8AAFF7BA-FD5E-4346-B615-B1F96455968B"}
  : {TypeNamedId:"LogisticsWaybill",Function:"reception",Version:"kl_trn_mt_05_01",EditingSettingId:"9D2B3E4A-7F1C-4E55-A6D0-1E8C5F2B9A37"};

const sourceFiles = {
  cargo: () => path.join(cacheRoot,"cargo.xlsx"),
  auto: () => path.join(cacheRoot,"auto.xlsx"),
  points: () => path.join(referenceRoot,"route-points.xlsx"),
  contracts: () => path.join(referenceRoot,"contracts.json"),
};
function sourceStatus() {
  return Object.fromEntries(Object.entries(sourceFiles).map(([kind,getFile])=>{
    const file=getFile();
    if(!fs.existsSync(file)) return [kind,null];
    const stat=fs.statSync(file);
    return [kind,{available:true,updatedAt:stat.mtime.toISOString(),size:stat.size}];
  }));
}

function readTmsCredentials() {
  if (process.env.TMS_LOGIN && process.env.TMS_PASSWORD) return {login:process.env.TMS_LOGIN,password:process.env.TMS_PASSWORD};
  if (!fs.existsSync(credentialsFile)) return null;
  const config = JSON.parse(fs.readFileSync(credentialsFile,"utf8").replace(/^\uFEFF/,""));
  const command = "$c=Get-Content -Raw $env:TMS_CREDENTIALS|ConvertFrom-Json;$s=ConvertTo-SecureString $c.password;$b=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s);try{[Runtime.InteropServices.Marshal]::PtrToStringBSTR($b)}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b)}";
  const result = spawnSync("powershell.exe",["-NoProfile","-Command",command],{encoding:"utf8",env:{...process.env,TMS_CREDENTIALS:credentialsFile},windowsHide:true});
  if (result.status !== 0) throw new Error("Не удалось прочитать сохранённый пароль TMS");
  return {login:config.login,password:result.stdout.trim()};
}

const app = spawn(process.execPath, [vinextCli, "start", "--hostname", "127.0.0.1", "--port", String(appPort)], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, PORT: String(appPort) },
});

const python = process.env.PYTHON_BIN || (process.platform === "win32" ? "C:/Users/alekseev/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe" : "python3");
const workerScript = path.join(root,"..","universal_app","web_worker.py");
let generatorWorker, workerBuffer="", requestSequence=0;
const pending=new Map();
function failPendingDocuments(message){
  for(const [id,item] of pending){pending.delete(id);item({requestId:id,error:message});}
}
function startGeneratorWorker(){
  workerBuffer="";
  generatorWorker=spawn(python,[workerScript],{cwd:path.dirname(workerScript),stdio:["pipe","pipe","inherit"],env:{...process.env,
    AGR_COMPANIES_FILE:process.env.AGR_COMPANIES_FILE||path.join(referenceRoot,"companies.xlsx"),
    AGR_EDO_FILE:process.env.AGR_EDO_FILE||path.join(referenceRoot,"counteragents.csv"),
    AGR_VEHICLES_FILE:process.env.AGR_VEHICLES_FILE||path.join(referenceRoot,"vehicles.xlsx"),
    AGR_DRIVERS_FILE:process.env.AGR_DRIVERS_FILE||path.join(referenceRoot,"drivers.xlsx"),
    AGR_POINTS_FILE:process.env.AGR_POINTS_FILE||path.join(referenceRoot,"route-points.xlsx"),
    AGR_CONTRACTS_FILE:process.env.AGR_CONTRACTS_FILE||path.join(referenceRoot,"contracts.json")}});
  generatorWorker.stdout.setEncoding("utf8");
  generatorWorker.stdout.on("data",chunk=>{
    workerBuffer+=chunk; const lines=workerBuffer.split(/\r?\n/); workerBuffer=lines.pop()||"";
    for(const line of lines){if(!line.trim())continue;try{const result=JSON.parse(line);if(result.ready)continue;const item=pending.get(result.requestId);if(item){pending.delete(result.requestId);item(result);}}catch{}}
  });
  generatorWorker.on("error",error=>failPendingDocuments("Не удалось запустить генератор XML: "+error.message));
  generatorWorker.on("exit",code=>{if(code)failPendingDocuments("Генератор XML остановился с кодом "+code);});
}
function restartGeneratorWorker(){
  failPendingDocuments("Справочники обновляются, повторите формирование");
  if(generatorWorker) generatorWorker.kill(); startGeneratorWorker();
}
startGeneratorWorker();

const types = { ".css":"text/css; charset=utf-8", ".js":"text/javascript; charset=utf-8", ".map":"application/json", ".png":"image/png", ".jpg":"image/jpeg", ".svg":"image/svg+xml", ".woff2":"font/woff2" };

const server = http.createServer((request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);
  if (request.method === "GET" && url.pathname === "/api/kontur/status") {
    const config=konturConfig(); const tokens=loadKonturTokens();
    response.writeHead(200,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"});
    response.end(JSON.stringify({configured:Boolean(config.clientId&&config.clientSecret&&config.redirectUri&&config.boxId),connected:Boolean(tokens?.access_token),boxId:config.boxId||null})); return;
  }
  if (request.method === "GET" && url.pathname === "/api/kontur/login") {
    const config=konturConfig();
    if(!config.clientId||!config.clientSecret||!config.redirectUri||!config.boxId){response.writeHead(503,{"Content-Type":"text/plain; charset=utf-8"});response.end("Интеграция Контур не настроена на сервере");return;}
    const state=randomBytes(24).toString("hex"); const nonce=randomBytes(24).toString("hex");
    const target=new URL(`${konturIdentityUrl}/connect/authorize`);
    target.search=new URLSearchParams({response_type:"code",client_id:config.clientId,scope:konturScopes,redirect_uri:config.redirectUri,state,nonce}).toString();
    response.writeHead(302,{Location:target.toString(),"Set-Cookie":konturStateCookie(state),"Cache-Control":"no-store"}); response.end(); return;
  }
  if (request.method === "GET" && url.pathname === "/api/kontur/callback") {
    void (async()=>{
      const state=url.searchParams.get("state")||""; const expectedState=requestCookies(request).kontur_oauth_state||"";
      let receivedNewTokens=false;
      try {
        if(url.searchParams.get("error")) throw new Error(url.searchParams.get("error_description")||url.searchParams.get("error"));
        if(!state||!expectedState||state!==expectedState) throw new Error("Проверка state не пройдена или время входа истекло");
        const code=url.searchParams.get("code"); if(!code) throw new Error("Контур не вернул код авторизации");
        const tokens=await exchangeKonturToken({grant_type:"authorization_code",code,redirect_uri:konturConfig().redirectUri});
        receivedNewTokens=true;
        await verifyKonturBox(tokens.access_token);
        response.writeHead(302,{Location:"/workspace?kontur=connected","Set-Cookie":konturStateCookie("",0),"Cache-Control":"no-store"}); response.end();
      } catch(error){if(receivedNewTokens)try{fs.unlinkSync(konturTokenFile);}catch{}response.writeHead(302,{Location:"/workspace?kontur=error&message="+encodeURIComponent(error.message||"Ошибка авторизации"),"Set-Cookie":konturStateCookie("",0),"Cache-Control":"no-store"});response.end();}
    })(); return;
  }
  if (request.method === "POST" && url.pathname === "/api/kontur/draft") {
    let body=""; request.setEncoding("utf8"); request.on("data",chunk=>{body+=chunk;if(body.length>15_000_000)request.destroy();}); request.on("end",()=>void(async()=>{
      try {
        const payload=JSON.parse(body); const config=konturConfig();
        if(!["cargo","empty","order"].includes(payload.kind)) throw new Error("Неизвестный вид документа");
        if(!payload.content||typeof payload.content!=="string") throw new Error("XML документа не передан");
        const accessToken=await getKonturAccessToken(); const format=konturDocumentFormat(payload.kind);
        const apiResponse=await fetch(`${diadocApiUrl}/V3/PostMessage`,{
          method:"POST",headers:{Authorization:`Bearer ${accessToken}`,"Content-Type":"application/json; charset=utf-8","Accept":"application/json"},
          body:JSON.stringify({FromBoxId:config.boxId,IsDraft:true,StrictDraftValidation:true,DocumentAttachments:[{SignedContent:{Content:payload.content},...format}]})
        });
        const text=await apiResponse.text(); let result; try{result=JSON.parse(text);}catch{result={message:text};}
        if(!apiResponse.ok) throw new Error(result.message||result.error_description||result.error||`Диадок вернул HTTP ${apiResponse.status}`);
        const document=result.Entities?.find(item=>item.EntityType==="Attachment")||result.Entities?.[0];
        response.writeHead(200,{"Content-Type":"application/json; charset=utf-8"});response.end(JSON.stringify({ok:true,messageId:result.MessageId||null,entityId:document?.EntityId||null}));
      }catch(error){response.writeHead(400,{"Content-Type":"application/json; charset=utf-8"});response.end(JSON.stringify({error:error.message||"Не удалось создать черновик в Контуре"}));}
    })); return;
  }
  if (request.method === "GET" && url.pathname === "/api/tms-status") {
    const configured=Boolean((process.env.TMS_LOGIN&&process.env.TMS_PASSWORD)||fs.existsSync(credentialsFile));
    response.writeHead(200,{"Content-Type":"application/json; charset=utf-8"});
    response.end(JSON.stringify({configured,sources:sourceStatus()})); return;
  }
  if (request.method === "GET" && url.pathname === "/api/source-cache") {
    const kind=url.searchParams.get("kind");
    const getFile=sourceFiles[kind||""];
    const file=getFile?.();
    if(!file||!fs.existsSync(file)){response.writeHead(404);response.end();return;}
    response.writeHead(200,{"Content-Type":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","Content-Disposition":`attachment; filename="${kind}.xlsx"`}); fs.createReadStream(file).pipe(response); return;
  }
  if (request.method === "POST" && url.pathname === "/api/tms-update") {
    let body=""; request.setEncoding("utf8"); request.on("data",chunk=>body+=chunk); request.on("end",async()=>{
      response.writeHead(200,{"Content-Type":"application/x-ndjson; charset=utf-8","Cache-Control":"no-cache"});
      const send=(payload)=>response.write(JSON.stringify(payload)+"\n");
      try {
        const supplied=body?JSON.parse(body):{}; const credentials=supplied.login&&supplied.password?supplied:readTmsCredentials();
        if(!credentials) throw new Error("Укажите логин и пароль TMS");
        fs.mkdirSync(referenceRoot,{recursive:true});
        const result=await syncTms({...credentials,cacheDir:cacheRoot,referenceDir:referenceRoot,onStatus:(key,state,message)=>send({type:"status",key,state,message})});
        send({type:"status",key:"apply",state:"working",message:"Перезагружаем справочники…"}); restartGeneratorWorker();
        send({type:"status",key:"apply",state:"saved",message:"Справочники применены"}); send({type:"complete",result}); response.end();
      } catch(error){send({type:"fatal",error:error.message||"Не удалось обновить данные из TMS"});response.end();}
    }); return;
  }
  if (request.method === "POST" && url.pathname === "/api/cache-source") {
    const kind = url.searchParams.get("kind");
    if (!["cargo","auto","points","contracts"].includes(kind || "")) { response.writeHead(400); response.end(); return; }
    const chunks=[]; request.on("data",chunk=>chunks.push(chunk)); request.on("end",()=>{
      try {
        const cache=cacheRoot; fs.mkdirSync(cache,{recursive:true}); fs.mkdirSync(referenceRoot,{recursive:true});
        const target=kind==="contracts"?path.join(referenceRoot,"contracts.json"):path.join(cache,kind+".xlsx");
        const incoming=Buffer.concat(chunks);
        if(kind==="contracts"){
          const parsed=JSON.parse(incoming.toString("utf8").replace(/^\uFEFF/,""));
          if(!Array.isArray(parsed)||parsed.some(item=>!(item.client||item.carrier||item.counterparty)||!item.number)) throw new Error("Некорректный справочник договоров");
        }
        const unchanged=fs.existsSync(target) && fs.readFileSync(target).equals(incoming);
        if(!unchanged) fs.writeFileSync(target,incoming);
        if(kind==="contracts"&&!unchanged) restartGeneratorWorker();
        response.writeHead(200,{"Content-Type":"application/json"}); response.end(JSON.stringify({ok:true,unchanged}));
      } catch(error){response.writeHead(400,{"Content-Type":"application/json; charset=utf-8"});response.end(JSON.stringify({error:error.message||"Не удалось сохранить справочник"}));}
    }); return;
  }
  if (request.method === "POST" && url.pathname === "/api/generate") {
    let body=""; request.setEncoding("utf8"); request.on("data",chunk=>{body+=chunk;}); request.on("end",()=>{
      try {
        const payload=JSON.parse(body); const requestId=++requestSequence; payload.requestId=requestId;
        if(!generatorWorker||generatorWorker.exitCode!==null||generatorWorker.killed) startGeneratorWorker();
        const timeout=setTimeout(()=>{const item=pending.get(requestId);if(item){pending.delete(requestId);item({requestId,error:"Генератор XML не ответил за 60 секунд"});}},60_000);
        pending.set(requestId,(result)=>{clearTimeout(timeout);response.writeHead(result.error?400:200,{"Content-Type":"application/json; charset=utf-8"});response.end(JSON.stringify(result));});
        generatorWorker.stdin.write(JSON.stringify(payload)+"\n");
      } catch(error){response.writeHead(400,{"Content-Type":"application/json; charset=utf-8"});response.end(JSON.stringify({error:error.message||"Некорректный запрос"}));}
    }); return;
  }
  const relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, "");
  const staticFile = path.join(clientRoot, relativePath);
  if (relativePath && staticFile.startsWith(clientRoot) && fs.existsSync(staticFile) && fs.statSync(staticFile).isFile()) {
    response.writeHead(200, { "Content-Type": types[path.extname(staticFile)] || "application/octet-stream", "Cache-Control":"no-cache" });
    fs.createReadStream(staticFile).pipe(response);
    return;
  }
  const proxy = http.request({ hostname:"127.0.0.1", port:appPort, path:request.url, method:request.method, headers:request.headers }, (upstream) => {
    const headers = { ...upstream.headers };
    if (headers.location) {
      headers.location = headers.location.replace(`127.0.0.1:${appPort}`, request.headers.host || `127.0.0.1:${publicPort}`);
    }
    response.writeHead(upstream.statusCode || 502, headers);
    upstream.pipe(response);
  });
  proxy.on("error", () => { response.writeHead(503, {"Content-Type":"text/plain; charset=utf-8"}); response.end("AGR is starting. Refresh the page in a few seconds."); });
  request.pipe(proxy);
});

server.listen(publicPort, "0.0.0.0", () => console.log(`AGR local website: http://127.0.0.1:${publicPort}`));
const stop = () => { server.close(); app.kill(); if(generatorWorker) generatorWorker.kill(); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
app.on("exit", (code) => { if (code) process.exitCode = code; server.close(); });
