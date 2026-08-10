import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { syncTms } from "./tms-sync.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.join(root, "dist", "client");
const vinextCli = path.join(root, "node_modules", "vinext", "dist", "cli.js");
const appPort = 3001;
const publicPort = Number(process.env.PORT || 3000);
const cacheRoot = path.join(root,"work","source-cache");
const credentialsFile = path.join(root,"work","tms-credentials.json");
const referenceRoot = process.env.AGR_REFERENCES_DIR || path.join(root,"..","data","references");

const sourceFiles = {
  cargo: () => path.join(cacheRoot,"cargo.xlsx"),
  auto: () => path.join(cacheRoot,"auto.xlsx"),
  points: () => path.join(referenceRoot,"route-points.xlsx"),
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
function startGeneratorWorker(){
  workerBuffer="";
  generatorWorker=spawn(python,[workerScript],{cwd:path.dirname(workerScript),stdio:["pipe","pipe","inherit"],env:{...process.env,
    AGR_COMPANIES_FILE:process.env.AGR_COMPANIES_FILE||path.join(referenceRoot,"companies.xlsx"),
    AGR_EDO_FILE:process.env.AGR_EDO_FILE||path.join(referenceRoot,"counteragents.csv"),
    AGR_VEHICLES_FILE:process.env.AGR_VEHICLES_FILE||path.join(referenceRoot,"vehicles.xlsx"),
    AGR_DRIVERS_FILE:process.env.AGR_DRIVERS_FILE||path.join(referenceRoot,"drivers.xlsx"),
    AGR_POINTS_FILE:process.env.AGR_POINTS_FILE||path.join(referenceRoot,"route-points.xlsx")}});
  generatorWorker.stdout.setEncoding("utf8");
  generatorWorker.stdout.on("data",chunk=>{
    workerBuffer+=chunk; const lines=workerBuffer.split(/\r?\n/); workerBuffer=lines.pop()||"";
    for(const line of lines){if(!line.trim())continue;try{const result=JSON.parse(line);if(result.ready)continue;const item=pending.get(result.requestId);if(item){pending.delete(result.requestId);item(result);}}catch{}}
  });
}
function restartGeneratorWorker(){
  for(const [id,item] of pending){item({requestId:id,error:"Справочники обновляются, повторите формирование"});} pending.clear();
  if(generatorWorker) generatorWorker.kill(); startGeneratorWorker();
}
startGeneratorWorker();

const types = { ".css":"text/css; charset=utf-8", ".js":"text/javascript; charset=utf-8", ".map":"application/json", ".png":"image/png", ".jpg":"image/jpeg", ".svg":"image/svg+xml", ".woff2":"font/woff2" };

const server = http.createServer((request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);
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
    if (!["cargo","auto","points"].includes(kind || "")) { response.writeHead(400); response.end(); return; }
    const chunks=[]; request.on("data",chunk=>chunks.push(chunk)); request.on("end",()=>{
      const cache=cacheRoot; fs.mkdirSync(cache,{recursive:true});
      const target=path.join(cache,kind+".xlsx"); const incoming=Buffer.concat(chunks);
      const unchanged=fs.existsSync(target) && fs.readFileSync(target).equals(incoming);
      if(!unchanged) fs.writeFileSync(target,incoming);
      response.writeHead(200,{"Content-Type":"application/json"}); response.end(JSON.stringify({ok:true,unchanged}));
    }); return;
  }
  if (request.method === "POST" && url.pathname === "/api/generate") {
    let body=""; request.setEncoding("utf8"); request.on("data",chunk=>{body+=chunk;}); request.on("end",()=>{
      try {
        const payload=JSON.parse(body); const requestId=++requestSequence; payload.requestId=requestId;
        pending.set(requestId,(result)=>{response.writeHead(result.error?400:200,{"Content-Type":"application/json; charset=utf-8"});response.end(JSON.stringify(result));});
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
