import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";

const BASE = "https://bln-log02.ylrus.com";

const cargoFields = {
  ID: "Номер записи",
  CREATE_DATE: "Дата создания строки",
  UNIT_NUMBER: "Грузовая единица",
  ORDER_COMPANY_CLIENT_NAME: "Клиент",
  ORDER_COMPANY_PARTNER_NAME: "Партнер",
  CONTAINER_STOCK_NAME: "Контейнерный сток",
  EMPTY_RETURN_INSTRUCTION: "Инструкция на сдачу порожнего",
  EMPTY_RETURN_REDIRECTION: "Перенаправление сдачи порожнего",
  EMPTY_RETURN_INSTRUCTION_VALIDITY_DATE: "Срок действия инструкции на сдачу порожнего",
  EMPTY_RETURN_DATE: "Дата сдачи порожнего",
  SEAL_NUMBER: "Номер пломбы",
  SEAL_NUMBER2: "Номер пломбы 2",
  GROUP_UNIT_TOTAL_GROSS_WEIGHT: "Вес брутто (кг)",
  LAST_AUTO_END_WAREHOUSE_NAME: "Место доставки на склад",
  LAST_AUTO_POINT_END_EXPECTED_DATETIME: "Планируемая дата доставки на склад",
  LAST_AUTO_DOC_COMPANY_EXECUTOR_NAME: "Перевозчик",
  LAST_AUTO_DOC_DRIVER_FULL_NAME: "Водитель",
  LAST_AUTO_DOC_DRIVER_PHONES_COMMA: "Телефон водителя",
  LAST_AUTO_DOC_AUTO_GOS_NUMBER: "Номер автомашины",
  LAST_AUTO_DOC_HOOK_GOS_NUMBER: "Номер прицепа",
  LAST_STATUS_ROUTE: "Маршрут груза",
};

const companyFields = {
  ID:"Номер записи", LIST_COMPANY_NAME:"Наименование", LIST_COMPANY_NAME_LARGE:"Полное наименование",
  LIST_COMPANY_NAME_SMALL:"Краткое наименование", INN:"ИНН", KPP:"КПП", EMAIL:"E-mail", PHONE:"Телефон",
  PHONE2:"Телефон (раб.)", ROLES_NAMES:"Роли", FIRST_UR_COMPANY_ADDRESS_ADDRESS_TEXT:"Юридический адрес",
  FIRST_ACTUAL_COMPANY_ADDRESS_ADDRESS_TEXT:"Фактический адрес",
};
const vehicleFields = {
  ID:"Номер записи", GOS_NUMBER_AUTO:"Государственный номер", LIST_COMPANY_NAME:"Автоперевозчик",
  LIST_TYPE_MODEL_AUTO_NAME:"Марка", LIST_TYPE_VAN_NAME:"Тип кузова", CHASSIS_NUMBER_AUTO:"Номер шасси",
  VIN_NUMBER_AUTO:"VIN номер", NOTE:"Примечание",
};
const driverFields = {
  ID:"Номер записи", FULL_NAME:"Полное имя", DRIVER_NAME:"Имя", SURNAME:"Фамилия", PATRONYMIC:"Отчество",
  LIST_COMPANY_NAME:"Автоперевозчик", PHONE1:"Телефон 1", PHONE2:"Телефон 2", DOC_DATE:"Дата выдачи паспорта",
  DOC_INFO:"Кем выдан паспорт", DOC_NUMBER:"Номер паспорта", DOC_SERIAL:"Серия паспорта",
  TRADE_DRIVERS_DOC_NUMBER:"Номер водительского удостоверения", TRADE_DRIVERS_DOC_SERIAL:"Серия водительского удостоверения",
};
const warehouseFields = {
  ID:"Номер записи", WAREHOUSE_NUMBER_AND_NAME:"Номер склада и название", LIST_CITY_NAME:"Город",
  LIST_COUNTRY_NAME:"Страна", LIST_REGION_NAME:"Регион", COORDS_ADDRESS:"Адрес", LIST_WAREHOUSE_NAME:"Название",
  ROLE_NAMES:"Роли", LIST_WAREHOUSE_NAME_ENG:"Название (англ)", ADDRESS_RUS:"Адрес на русском языке",
  ADDRESS_ENG:"Адрес на английском языке", PERSON_PHONE:"Номер телефона", UNLOCODE:"UN/LOCODE", ITN:"ИНН",
};

const autoFields = {
  ID: "Номер записи",
  CREATE_DATE: "Дата создания строки",
  ID_OPERATION_TYPE: "Тип операции",
  UNITS_NUMBERS: "Номера грузовых единиц",
  DOC_PARENT_ORDER_COMPANY_CLIENT_NAME: "Клиент",
  DOC_PARENT_ORDER_COMPANY_PARTNER_NAME: "Партнер",
  COMPANY_EXECUTOR_NAME: "Исполнитель",
  ARRIVAL_POINT_NAMES: "Маршрут",
  DRIVER_FULL_NAME: "Водитель",
  DRIVER_PHONE: "Телефон водителя",
  AUTO_GOS_NUMBER_AUTO: "Номер автомашины",
  HOOK_GOS_NUMBER_HOOK: "Номер прицепа",
  EXPECTED_DATE_START: "Плановая дата отправления",
  ACTUAL_DEPARTURE_DATE_START: "Фактическая дата отправления",
  EXPECTED_DATE_END: "Плановая дата прибытия",
  ACTUAL_DATE_END: "Фактическая дата прибытия",
  CONTAINER_STOCK_NAME: "Контейнерный сток",
  EMPTY_RETURN_INSTRUCTION: "Инструкция на сдачу порожнего",
  EMPTY_RETURN_REDIRECTION: "Перенаправление сдачи порожнего",
  EMPTY_RETURN_DATE: "Дата сдачи порожнего",
  UNITS_GROSS_WEIGHT: "Вес брутто",
  STOCK_NAME: "Место прибытия",
};

function cookiesFrom(headers) {
  const values = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [headers.get("set-cookie") || ""];
  return values.map((value) => value.split(";", 1)[0]).filter(Boolean).join("; ");
}

async function login(loginName, password) {
  const first = await fetch(`${BASE}/login`, { redirect: "manual" });
  let cookie = cookiesFrom(first.headers);
  const body = new URLSearchParams({ deviceType: "desktop", login: loginName, password });
  const response = await fetch(`${BASE}/login`, { method: "POST", body, headers: { Cookie: cookie }, redirect: "manual" });
  cookie = [cookie, cookiesFrom(response.headers)].filter(Boolean).join("; ");
  const result = await response.json().catch(() => ({}));
  if (!cookie.includes("token=") || result?.result?.status === "error") throw new Error("TMS не приняла логин или пароль");
  const token = /(?:^|;\s*)token=([^;]+)/.exec(cookie)?.[1] || "";
  return { cookie, token };
}

function tmsDateTimestamp(value) {
  const text = String(value || "").trim();
  if (!text) return NaN;
  const russian = /^(\d{1,2})[.](\d{1,2})[.](\d{4})/.exec(text);
  if (russian) return Date.UTC(Number(russian[3]), Number(russian[2]) - 1, Number(russian[1]));
  const timestamp = Date.parse(text);
  return Number.isFinite(timestamp) ? timestamp : NaN;
}

const wait = (milliseconds) => new Promise(resolve=>setTimeout(resolve,milliseconds));
async function fetchTmsTable(url,options) {
  let response;
  for(let attempt=0;attempt<4;attempt+=1) {
    response=await fetch(url,options);
    if(![429,502,503,504].includes(response.status)) return response;
    if(attempt<3) {
      try { await response.body?.cancel(); } catch {}
      await wait(750*(2**attempt));
    }
  }
  return response;
}

async function getRows(session, table, fields, filters, createdSince = "") {
  const keys = Object.keys(fields);
  const minimumCreatedAt = createdSince ? Date.parse(createdSince + "T00:00:00Z") : NaN;
  const all = [];
  const pageSize = table === "OPERATION_SUB_DOC" ? 1000 : table === "OPERATION_UNIT" ? 2000 : 4000;
  const maxRows = ({OPERATION_UNIT:16000,OPERATION_SUB_DOC:24000,LIST_COMPANY:50000,LIST_AUTO:50000,LIST_DRIVERS:50000,LIST_WAREHOUSE:50000})[table] || 50000;
  for (let offset = 0; offset < maxRows; offset += pageSize) {
    const data = { viewedFields: keys, offset, limit: pageSize, sort: [{ ID: -1 }], ...(filters ? { filters } : {}) };
    const body = new URLSearchParams({ json: JSON.stringify(data) });
    const response = await fetchTmsTable(`${BASE}/api/table/get/${table}`, {
      method: "POST", body,
      headers: { Cookie: session.cookie, Autorization: session.token, "TableApi2-method": "get" },
    });
    if (!response.ok) {
      if (offset === 0 && Object.hasOwn(fields, "CREATE_DATE")) {
        const compatibleFields = { ...fields };
        delete compatibleFields.CREATE_DATE;
        return getRows(session, table, compatibleFields, filters, "");
      }
      throw new Error(`TMS вернула ошибку ${response.status} для ${table}`);
    }
    const json = await response.json();
    if (json?.result?.status !== "success" || !Array.isArray(json?.result?.rows)) {
      // Some TMS installations do not expose CREATE_DATE in these registries.
      // Retry without that optional field so an update is not blocked completely.
      if (offset === 0 && Object.hasOwn(fields, "CREATE_DATE")) {
        const compatibleFields = { ...fields };
        delete compatibleFields.CREATE_DATE;
        return getRows(session, table, compatibleFields, filters, "");
      }
      const details = json?.result?.message || json?.result?.error || json?.message || "";
      throw new Error(`Не удалось прочитать ${table}${details ? `: ${details}` : ""}`);
    }
    for (const values of json.result.rows) {
      const row = {};
      keys.forEach((key, index) => { row[fields[key]] = values[index] ?? ""; });
      if (table === "OPERATION_SUB_DOC" && String(row["Тип операции"]) !== "1") continue;
      const createdAt = tmsDateTimestamp(row["Дата создания строки"]);
      if (Number.isFinite(minimumCreatedAt) && Number.isFinite(createdAt) && createdAt < minimumCreatedAt) continue;
      const route = String(row["Маршрут"] || "");
      const points = route.split(/\s*(?:->|→|—>)\s*/);
      row["Место отправления"] = points[0] || "";
      row["Место прибытия"] ||= points.at(-1) || "";
      all.push(row);
    }
    if (json.result.rows.length < pageSize) break;
  }
  return all;
}

function writeWorkbook(target, sheetName, rows) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), sheetName);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  XLSX.writeFile(workbook, target, { compression: true });
}
function writeGeneratorCache(target,rows) {
  fs.writeFileSync(target,JSON.stringify(rows));
}

export async function syncTms({ login: loginName, password, cacheDir, referenceDir, onStatus = () => {} }) {
  onStatus("login","working","Входим в TMS…");
  let session;
  try { session = await login(loginName, password); onStatus("login","saved","Вход выполнен"); }
  catch(error) { onStatus("login","error","TMS недоступна или не приняла данные входа"); throw error; }
  const fourMonthsAgo = new Date();
  fourMonthsAgo.setMonth(fourMonthsAgo.getMonth() - 4);
  const createdSince = fourMonthsAgo.toISOString().slice(0, 10);
  // CREATE_DATE is not accepted as a server-side filter by every TMS table.
  // Keep the API request compatible and apply the four-month limit locally.
  const autoFilter = { tryNewFilterFormat: true, value: [["ID_OPERATION_TYPE", "=", 1]] };
  const tasks = [
    ["cargo","OPERATION_UNIT",cargoFields,null,cacheDir,"cargo.xlsx",createdSince],
    ["auto","OPERATION_SUB_DOC",autoFields,autoFilter,cacheDir,"auto.xlsx",createdSince],
    ["companies","LIST_COMPANY",companyFields,null,referenceDir,"companies.xlsx",""],
    ["vehicles","LIST_AUTO",vehicleFields,null,referenceDir,"vehicles.xlsx",""],
    ["drivers","LIST_DRIVERS",driverFields,null,referenceDir,"drivers.xlsx",""],
    ["points","LIST_WAREHOUSE",warehouseFields,null,referenceDir,"route-points.xlsx",""],
  ];
  const counts = {};
  const runTask = async ([key,table,fields,filter,targetDir,filename,minimumDate]) => {
    onStatus(key,"working","Получаем данные…");
    try {
      const rows=await getRows(session,table,fields,filter,minimumDate);
      if(!rows.length) throw new Error("реестр пуст");
      const target=path.join(targetDir,filename);
      writeWorkbook(target,table,rows);
      writeGeneratorCache(target.replace(/\.xlsx$/i,".json"),rows);
      counts[key]=rows.length; onStatus(key,"saved",rows.length.toLocaleString("ru-RU")+" строк");
    } catch(error) { onStatus(key,"error",error.message||"Ошибка"); throw error; }
  };
  // The two transport registries are the heaviest TMS queries. Run them one
  // after another to avoid temporary 503 responses from the shared server.
  for(const task of tasks.slice(0,2)) await runTask(task);
  await Promise.all(tasks.slice(2).map(runTask));
  return { ...counts, updatedAt: new Date().toISOString() };
}
