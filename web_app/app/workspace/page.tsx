"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import styles from "./workspace.module.css";

type Row = Record<string, unknown>;
type DirectoryHandle = { name:string; getDirectoryHandle:(name:string,options:{create:boolean})=>Promise<DirectoryHandle>; getFileHandle:(name:string,options:{create:boolean})=>Promise<{createWritable:()=>Promise<{write:(data:Blob)=>Promise<void>;close:()=>Promise<void>}>}> };

const openSourceDb = () => new Promise<IDBDatabase>((resolve,reject) => {
  const request=indexedDB.open("agr-local-sources",1);
  request.onupgradeneeded=()=>{ if(!request.result.objectStoreNames.contains("files")) request.result.createObjectStore("files"); };
  request.onsuccess=()=>resolve(request.result); request.onerror=()=>reject(request.error);
});
const saveSourceFile=async(key:string,file:File)=>{const db=await openSourceDb();await new Promise<void>((resolve,reject)=>{const tx=db.transaction("files","readwrite");tx.objectStore("files").put(file,key);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});db.close();};
const getSourceFile=async(key:string)=>{const db=await openSourceDb();const file=await new Promise<File|undefined>((resolve,reject)=>{const request=db.transaction("files").objectStore("files").get(key);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});db.close();return file;};
const clearSourceFiles=async()=>{const db=await openSourceDb();await new Promise<void>((resolve,reject)=>{const tx=db.transaction("files","readwrite");tx.objectStore("files").clear();tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});db.close();};
type Source = { name: string; count: number };
type Trip = Row & { _container: string; _cargo?: Row; _auto?: Row; _missingCargo?: boolean; _missingAuto?: boolean };

const value = (row: Row | undefined, ...keys: string[]) => {
  for (const key of keys) { const result = String(row?.[key] ?? "").trim(); if (result) return result; }
  return "";
};

const normalizeContainer = (input: unknown) => {
  const raw = String(input ?? "").toUpperCase().replace(/\s+/g, "");
  const match = raw.match(/[A-ZА-Я]{4}\d{7}/);
  if (!match) return "";
  const letters: Record<string, string> = { А:"A",В:"B",С:"C",Е:"E",Н:"H",К:"K",М:"M",О:"O",Р:"P",Т:"T",Х:"X",У:"Y" };
  return match[0].replace(/[АВСЕНКМОРТХУ]/g, (letter) => letters[letter] ?? letter);
};

const rowContainer = (row: Row) => {
  for (const key of ["Грузовая единица", "Номера грузовых единиц", "Номер грузовой единицы по заказу", "Контейнер", "Номер контейнера", "Импорт"]) {
    const found = normalizeContainer(row[key]); if (found) return found;
  }
  return "";
};

const cleanPoint = (text: string) => text.replace(/^\(RU\)\s*/i, "").replace(/\s+/g, " ").trim();
const routeStart = (row: Row | undefined) => cleanPoint(value(row, "Маршрут").split(/\s*(?:->|→|—>)\s*/)[0] || "");
const comparable = (text: string) => text.toLowerCase().replace(/[«»"'()]/g, "").replace(/\b(ооо|ао|пао|зао|инн|ru)\b/g, "").replace(/\d{10,12}/g, "").replace(/[^a-zа-я0-9]+/g, " ").trim();

function readWorkbook(file: File, expected: string) {
  return file.arrayBuffer().then((buffer) => {
    const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
    const sheetName = workbook.SheetNames.includes(expected) ? expected : workbook.SheetNames[0];
    return XLSX.utils.sheet_to_json<Row>(workbook.Sheets[sheetName], { defval: "" });
  });
}

export default function Workspace() {
  const cargoRef = useRef<HTMLInputElement>(null);
  const autoRef = useRef<HTMLInputElement>(null);
  const pointsRef = useRef<HTMLInputElement>(null);
  const outputRef = useRef<DirectoryHandle | null>(null);
  const containerFoldersRef = useRef<Record<string,DirectoryHandle>>({});
  const [cargoRows, setCargoRows] = useState<Row[]>([]);
  const [autoRows, setAutoRows] = useState<Row[]>([]);
  const [points, setPoints] = useState<Row[]>([]);
  const [cargoSource, setCargoSource] = useState<Source | null>(null);
  const [autoSource, setAutoSource] = useState<Source | null>(null);
  const [pointsSource, setPointsSource] = useState<Source | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Trip[]>([]);
  const [message, setMessage] = useState("Для начала подключите два реестра");
  const [busy, setBusy] = useState(false);
  const [tmsBusy, setTmsBusy] = useState(false);
  const [tmsLogin, setTmsLogin] = useState("");
  const [tmsPassword, setTmsPassword] = useState("");
  const [tmsModalOpen, setTmsModalOpen] = useState(false);
  const [tmsStatuses, setTmsStatuses] = useState<Record<string,{state:"queued"|"working"|"saved"|"error";message:string}>>({});
  const [generating, setGenerating] = useState("");
  const [outputFolder, setOutputFolder] = useState("");
  const [bulkProgress, setBulkProgress] = useState("");
  const [statusModalOpen, setStatusModalOpen] = useState(false);
  const [docStatuses, setDocStatuses] = useState<Record<string,{state:"queued"|"working"|"saved"|"error";text:string}>>({});
  const restoredRef = useRef(false);

  useEffect(() => {
    if(restoredRef.current) return; restoredRef.current=true;
    void (async()=>{
      try {
        const [cargo,auto,routePoints]=await Promise.all([getSourceFile("cargo"),getSourceFile("auto"),getSourceFile("points")]);
        if(cargo||auto) setMessage("Восстанавливаем ранее подключённые реестры…");
        if(cargo) await load("cargo",cargo); if(auto) await load("auto",auto); if(routePoints) await load("points",routePoints);
        if(cargo&&auto) setMessage("Реестры восстановлены автоматически. Можно продолжать поиск.");
      } catch { setMessage("Не удалось восстановить сохранённые реестры. Выберите файлы заново."); }
    })();
  }, []);

  const resetSources=async()=>{await clearSourceFiles();setCargoRows([]);setAutoRows([]);setPoints([]);setCargoSource(null);setAutoSource(null);setPointsSource(null);setResults([]);setQuery("");setMessage("Сохранённые реестры удалены. Подключите актуальные файлы.");};

  const ready = Boolean(cargoSource && autoSource);
  const cargoIndex = useMemo(() => new Map(cargoRows.map((row) => [rowContainer(row), row]).filter(([key]) => key)), [cargoRows]);
  const autoIndex = useMemo(() => {
    const map = new Map<string, Row>();
    autoRows.forEach((row) => { const key = rowContainer(row); if (key) map.set(key, row); });
    return map;
  }, [autoRows]);

  const resolveDeparture = (auto: Row | undefined) => {
    const direct = value(auto, "Адрес места отправления", "Адрес отправления");
    if (direct) return direct;
    const start = routeStart(auto);
    if (points.length && start) {
      const needle = comparable(start);
      const match = points.find((row) => {
        const names = [value(row,"Название"), value(row,"Номер склада и название")].map(comparable).filter(Boolean);
        return names.some((name) => name === needle || name.includes(needle) || needle.includes(name));
      });
      const address = value(match, "Адрес на русском языке", "Адрес");
      if (address) return address;
    }
    return value(auto, "Место отправления") || start || "Адрес отправления не найден";
  };

  async function load(kind: "cargo" | "auto" | "points", file: File) {
    setBusy(true);
    try {
      const expected = kind === "cargo" ? "OPERATION_UNIT" : kind === "auto" ? "OPERATION_SUB_DOC" : "LIST_WAREHOUSE";
      const rows = await readWorkbook(file, expected);
      if (!rows.length) throw new Error("В выбранном файле нет строк");
      if (kind === "cargo") { setCargoRows(rows); setCargoSource({name:file.name,count:rows.length}); }
      if (kind === "auto") { setAutoRows(rows); setAutoSource({name:file.name,count:rows.length}); }
      if (kind === "points") { setPoints(rows); setPointsSource({name:file.name,count:rows.length}); }
      await saveSourceFile(kind,file);
      const cached=await fetch("/api/cache-source?kind="+kind,{method:"POST",body:file});
      if(!cached.ok) throw new Error("Не удалось передать реестр локальному генератору");
      setMessage(kind === "points" ? "Справочник точек маршрута подключён" : "Файл подключён. Добавьте второй обязательный реестр.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Не удалось прочитать файл"); }
    finally { setBusy(false); }
  }

  const updateFromTms = async () => {
    const stageKeys=["login","cargo","auto","companies","vehicles","drivers","points","apply"];
    const initial:Record<string,{state:"queued";message:string}>={}; stageKeys.forEach(key=>initial[key]={state:"queued",message:"Ожидает"});
    setTmsStatuses(initial); setTmsModalOpen(true); setTmsBusy(true); setMessage("Обновляем данные из TMS…");
    try {
      const response=await fetch("/api/tms-update",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(tmsLogin && tmsPassword ? {login:tmsLogin,password:tmsPassword} : {})});
      if(!response.ok||!response.body) throw new Error("Не удалось запустить обновление TMS");
      const reader=response.body.getReader(); const decoder=new TextDecoder(); let buffer=""; let completeResult:Record<string,number>|null=null;
      const processLine=(line:string)=>{if(!line.trim())return;const event=JSON.parse(line);if(event.type==="status")setTmsStatuses(current=>({...current,[event.key]:{state:event.state,message:event.message}}));if(event.type==="fatal")throw new Error(event.error);if(event.type==="complete")completeResult=event.result;};
      while(true){const {done,value}=await reader.read();buffer+=decoder.decode(value||new Uint8Array(),{stream:!done});const lines=buffer.split(/\r?\n/);buffer=lines.pop()||"";for(const line of lines)processLine(line);if(done)break;} if(buffer)processLine(buffer);
      if(!completeResult) throw new Error("TMS не подтвердила завершение обновления");
      const [cargoResponse,autoResponse]=await Promise.all([fetch("/api/source-cache?kind=cargo"),fetch("/api/source-cache?kind=auto")]);
      if(!cargoResponse.ok||!autoResponse.ok) throw new Error("Данные получены, но локальные реестры не открылись");
      const stamp=new Date().toLocaleString("ru-RU");
      await load("cargo",new File([await cargoResponse.blob()],"TMS Грузы текущие · "+stamp+".xlsx"));
      await load("auto",new File([await autoResponse.blob()],"TMS ТТН-CMR · "+stamp+".xlsx"));
      setMessage("Данные и справочники TMS успешно обновлены");
    } catch(error) { const message=error instanceof Error?error.message:"Ошибка обновления TMS";setMessage(message);setTmsStatuses(current=>({...current,apply:{state:"error",message}})); }
    finally { setTmsBusy(false); }
  };

  const handleFile = (kind: "cargo" | "auto" | "points") => (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; if (file) void load(kind, file);
  };

  const search = () => {
    if (!ready) return setMessage("Сначала подключите оба обязательных реестра");
    const containers = Array.from(new Set(query.split(/[\s,;]+/).map(normalizeContainer).filter(Boolean)));
    if (!containers.length) return setMessage("Вставьте номера контейнеров в формате ABCD1234567");
    const found = containers.map((container) => {
      const cargo = cargoIndex.get(container); const auto = autoIndex.get(container);
      return { ...(cargo ?? {}), ...(auto ?? {}), _container: container, _cargo: cargo, _auto: auto, _missingCargo: !cargo, _missingAuto: !auto } as Trip;
    });
    setResults(found);
    setMessage('Найдено в обоих реестрах: ' + found.filter((item) => !item._missingCargo && !item._missingAuto).length + ' из ' + containers.length);
  };

  const chooseOutputFolder = async () => {
    const picker = (window as unknown as {showDirectoryPicker?:()=>Promise<DirectoryHandle>}).showDirectoryPicker;
    if (!picker) return setMessage("Выбор папки поддерживается в Chrome и Edge");
    try { const handle = await picker(); outputRef.current = handle; setOutputFolder(handle.name); setMessage("Папка выбрана: " + handle.name); } catch { /* окно закрыто */ }
  };

  const generateDocument = async (trip: Trip, kind: "cargo" | "empty" | "order", quiet = false) => {
    const key = trip._container + kind;
    setDocStatuses((current)=>({...current,[key]:{state:"working",text:"Формируется…"}}));
    if (!quiet) { setGenerating(key); setMessage("Формируем документ для " + trip._container + "…"); }
    try {
      const row = { ...(trip._cargo ?? {}), ...(trip._auto ?? {}) };
      const response = await fetch("/api/generate", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({kind,container:trip._container,row,date:new Date().toISOString().slice(0,10),user:"Алексеев Михаил Геннадьевич"}) });
      const result = await response.json();
      if (!response.ok || result.error) throw new Error(result.error || "Не удалось сформировать документ");
      const bytes = Uint8Array.from(atob(result.content), (char) => char.charCodeAt(0));
      const blob = new Blob([bytes], {type:"application/xml"});
      if (outputRef.current) {
        const containerFolder = containerFoldersRef.current[trip._container] ?? await outputRef.current.getDirectoryHandle(trip._container, {create:true});
        const file = await containerFolder.getFileHandle(result.filename, {create:true});
        const writable = await file.createWritable(); await writable.write(blob); await writable.close();
      } else {
        const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = result.filename; link.click(); URL.revokeObjectURL(link.href);
      }
      setDocStatuses((current)=>({...current,[key]:{state:"saved",text:"Сохранён"}}));
      if (!quiet) setMessage("Документ создан: " + result.filename);
      return true;
    } catch (error) { const errorText=error instanceof Error ? error.message : "Ошибка формирования документа"; setDocStatuses((current)=>({...current,[key]:{state:"error",text:errorText}})); if (!quiet) setMessage(errorText); return false; }
    finally { if (!quiet) setGenerating(""); }
  };

  const generateAll = async () => {
    const readyTrips = results.filter((trip) => !trip._missingCargo && !trip._missingAuto);
    if (!readyTrips.length) return setMessage("Нет готовых перевозок для формирования");
    if (!outputRef.current) { await chooseOutputFolder(); if (!outputRef.current) return; }
    setStatusModalOpen(true);
    containerFoldersRef.current={};
    try { for(const trip of readyTrips) containerFoldersRef.current[trip._container]=await outputRef.current!.getDirectoryHandle(trip._container,{create:true}); } catch(error) { const text=error instanceof Error?error.message:"Не удалось создать папки контейнеров"; setMessage(text); setGenerating(""); return; }
    const initial:Record<string,{state:"queued";text:string}>={}; readyTrips.forEach((trip)=>["cargo","order","empty"].forEach((kind)=>{initial[trip._container+kind]={state:"queued",text:"В очереди"};})); setDocStatuses(initial);
    setGenerating("all"); let done = 0; let failed = 0; const total = readyTrips.length * 3;
    for (const trip of readyTrips) for (const kind of ["cargo","order","empty"] as const) {
      setBulkProgress((done + failed) + " из " + total + " · " + trip._container + " · " + (kind === "cargo" ? "ЭТрН груз" : kind === "order" ? "Заявка" : "ЭТрН порожний"));
      (await generateDocument(trip, kind, true)) ? done++ : failed++;
    }
    setBulkProgress(""); setGenerating(""); setMessage("Готово: создано " + done + " документов" + (failed ? ", ошибок: " + failed : "") + ". Папка: " + outputFolder);
  };


  const kindTitle=(key:string)=>key.endsWith("cargo")?"ЭТрН груз":key.endsWith("order")?"Заявка перевозчику":"ЭТрН порожний";
  const keyContainer=(key:string)=>key.replace(/(cargo|order|empty)$/,"");

  return <main className={styles.shell}>
    <header className={styles.topbar}><div className={styles.logo}>А</div><div><strong>Создание ЭПД</strong><span>локальная версия</span></div><i/><b>{ready ? "База подключена" : "Нужны 2 файла"}</b></header>
    <section className={styles.content}>
      <div className={styles.notice}>{busy ? "Читаем файл…" : message}</div>
      <section className={styles.tmsPanel}><div className={styles.tmsBar}><div><strong>Загрузить актуальные данные из TMS</strong><small>«Грузы → Текущие» и «ТТН / CMR»</small></div><button disabled={tmsBusy || busy} onClick={updateFromTms}>{tmsBusy ? "Обновляем…" : "Обновить реестры из TMS"}</button></div><details className={styles.tmsCredentials}><summary>Данные входа TMS</summary><p>Заполняйте, только если доступ не настроен администратором сервера. Пароль не сохраняется в браузере.</p><div><label><span>Логин</span><input autoComplete="username" value={tmsLogin} onChange={event=>setTmsLogin(event.target.value)} placeholder="Логин TMS"/></label><label><span>Пароль</span><input type="password" autoComplete="current-password" value={tmsPassword} onChange={event=>setTmsPassword(event.target.value)} placeholder="Пароль TMS"/></label></div></details></section>
      <details className={styles.manualPanel}><summary>Ручная загрузка и восстановление</summary><p>Используйте этот раздел, только если TMS временно недоступна или нужно проверить отдельную выгрузку.</p><div><button onClick={() => cargoRef.current?.click()}><strong>Реестр грузов</strong><small>{cargoSource?.name ?? "Выбрать OPERATION_UNIT"}</small></button><button onClick={() => autoRef.current?.click()}><strong>ТТН / CMR</strong><small>{autoSource?.name ?? "Выбрать OPERATION_SUB_DOC"}</small></button><button onClick={() => pointsRef.current?.click()}><strong>Точки маршрута</strong><small>{pointsSource?.name ?? "Выбрать LIST_WAREHOUSE"}</small></button><button className={styles.resetButton} onClick={resetSources}>Сбросить локальную базу</button></div><input ref={cargoRef} hidden type="file" accept=".xlsx,.xls" onChange={handleFile("cargo")}/><input ref={autoRef} hidden type="file" accept=".xlsx,.xls" onChange={handleFile("auto")}/><input ref={pointsRef} hidden type="file" accept=".xlsx,.xls" onChange={handleFile("points")}/></details>

      {!ready && <section className={styles.startPanel}><div className={styles.startTitle}><small>ШАГ 1</small><h2>Обновите данные из TMS</h2><p>Нажмите кнопку выше. После получения грузов и ТТН/CMR автоматически откроется поиск перевозок.</p></div></section>}

      {ready && <>
        <section className={styles.search}><label><strong>Номера контейнеров</strong><textarea value={query} onChange={(event) => setQuery(event.target.value)} placeholder={'WEDU8636223\nTGBU5962912'}/></label><button onClick={search}>Найти перевозки →</button></section>
        {results.length > 0 && <><section className={styles.bulkBar}><div><strong>Формирование документов</strong><small>{outputFolder ? "Папка: " + outputFolder : "Сначала выберите папку для XML"}</small></div><button className={styles.folderButton} onClick={chooseOutputFolder}>Выбрать папку</button><button className={styles.bulkButton} disabled={Boolean(generating)} onClick={generateAll}>{generating === "all" ? (bulkProgress || "Формируем…") : "Создать все документы"}</button></section><section className={styles.results}><div className={styles.tableWrap}><table><thead><tr><th>Контейнер</th><th>Клиент</th><th>Перевозчик</th><th>Маршрут</th><th>Адрес отправления</th><th>Склад клиента</th><th>Контейнерный сток</th><th>Водитель и ТС</th><th>Документы</th><th>Статус</th></tr></thead><tbody>{results.map((trip) => {
          const cargo = trip._cargo; const auto = trip._auto;
          const warehouse = value(cargo,"Место доставки на склад","Место доставки груза (Маршрут заказа)","Адрес доставки","Место прибытия") || value(auto,"Место прибытия");
          const stock = value(cargo,"Контейнерный сток","Инструкция на сдачу порожнего","Перенаправление сдачи порожнего") || value(auto,"Контейнерный сток","Инструкция на сдачу порожнего","Перенаправление сдачи порожнего");
          const ok = !trip._missingCargo && !trip._missingAuto;
          return <tr key={trip._container}><td><strong>{trip._container}</strong></td><td>{value(cargo,"Клиент") || value(auto,"Клиент") || '—'}</td><td><strong>{value(auto,"Исполнитель","Партнер","Перевозчик") || '—'}</strong></td><td>{value(auto,"Маршрут") || '—'}</td><td>{resolveDeparture(auto)}</td><td>{warehouse || '—'}</td><td>{stock || 'Нужно заполнить'}</td><td><strong>{value(auto,"Водитель") || '—'}</strong><small>{value(auto,"Номер автомашины","Транспортное средство")}</small></td><td><div className={styles.docActions}><button disabled={!ok || Boolean(generating)} onClick={() => generateDocument(trip,"cargo")}><span>ЭТрН груз</span><small className={styles[docStatuses[trip._container+"cargo"]?.state]}>{docStatuses[trip._container+"cargo"]?.text ?? "Не запускался"}</small></button><button disabled={!ok || Boolean(generating)} onClick={() => generateDocument(trip,"order")}><span>Заявка</span><small className={styles[docStatuses[trip._container+"order"]?.state]}>{docStatuses[trip._container+"order"]?.text ?? "Не запускалась"}</small></button><button disabled={!ok || Boolean(generating)} onClick={() => generateDocument(trip,"empty")}><span>ЭТрН порожний</span><small className={styles[docStatuses[trip._container+"empty"]?.state]}>{docStatuses[trip._container+"empty"]?.text ?? "Не запускался"}</small></button><button className={styles.konturButton} disabled title="Будет доступно после подключения API Контур.Логистики">Черновик в Контур</button></div></td><td><span className={ok ? styles.ok : styles.warning}>{ok ? 'Готово' : trip._missingCargo ? 'Нет груза' : 'Нет автоперевозки'}</span></td></tr>;
        })}</tbody></table></div></section></>}
      </>}
    </section>
    {tmsModalOpen && <div className={styles.modalBackdrop}><section className={styles.statusModal} role="dialog" aria-modal="true" aria-label="Статус обновления TMS"><header><div><small>ОБНОВЛЕНИЕ ИЗ TMS</small><h2>{tmsBusy?"Получаем актуальные данные":"Обновление завершено"}</h2><p>{tmsBusy?"Статусы меняются автоматически.":message}</p></div><button onClick={()=>setTmsModalOpen(false)} disabled={tmsBusy}>×</button></header><div className={styles.statusList}>{Object.entries(tmsStatuses).map(([key,status])=><article key={key} className={styles[status.state]}><b>{status.state==="saved"?"✓":status.state==="error"?"!":status.state==="working"?"…":"•"}</b><span><strong>{{login:"Вход в TMS",cargo:"Грузы → Текущие",auto:"ТТН / CMR",companies:"Контрагенты",vehicles:"Автомашины",drivers:"Водители",points:"Географические объекты",apply:"Применение справочников"}[key]||key}</strong><small>{status.state==="queued"?"В очереди":status.state==="working"?"Выполняется":status.state==="saved"?"Готово":"Ошибка"}</small></span><em>{status.message}</em></article>)}</div><footer><span>{Object.values(tmsStatuses).filter(item=>item.state==="saved").length} из {Object.keys(tmsStatuses).length} этапов завершено</span><button onClick={()=>setTmsModalOpen(false)} disabled={tmsBusy}>{tmsBusy?"Идёт обновление":"Закрыть"}</button></footer></section></div>}
    {statusModalOpen && <div className={styles.modalBackdrop}><section className={styles.statusModal} role="dialog" aria-modal="true" aria-label="Статус формирования документов"><header><div><small>ФОРМИРОВАНИЕ ДОКУМЕНТОВ</small><h2>{generating==="all" ? "Документы формируются" : "Результат формирования"}</h2><p>{bulkProgress || message}</p></div><button onClick={()=>setStatusModalOpen(false)} disabled={generating==="all"}>×</button></header><div className={styles.statusList}>{Object.entries(docStatuses).map(([key,status])=><article key={key} className={styles[status.state]}><b>{status.state==="saved"?"✓":status.state==="error"?"!":status.state==="working"?"…":"•"}</b><span><strong>{keyContainer(key)}</strong><small>{kindTitle(key)}</small></span><em title={status.text}>{status.text}</em></article>)}</div><footer><span>{Object.values(docStatuses).filter(item=>item.state==="saved").length} сохранено · {Object.values(docStatuses).filter(item=>item.state==="error").length} ошибок</span><button onClick={()=>setStatusModalOpen(false)} disabled={generating==="all"}>{generating==="all"?"Дождитесь завершения":"Закрыть"}</button></footer></section></div>}
  </main>;
}
