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

async function getRows(session, table, fields, filters) {
  const keys = Object.keys(fields);
  const all = [];
  const pageSize = 4000;
  const maxRows = ({OPERATION_UNIT:16000,OPERATION_SUB_DOC:24000,LIST_COMPANY:50000,LIST_AUTO:50000,LIST_DRIVERS:50000,LIST_WAREHOUSE:50000})[table] || 50000;
  for (let offset = 0; offset < maxRows; offset += pageSize) {
    const data = { viewedFields: keys, offset, limit: pageSize, sort: [{ ID: -1 }], ...(filters ? { filters } : {}) };
    const body = new URLSearchParams({ json: JSON.stringify(data) });
    const response = await fetch(`${BASE}/api/table/get/${table}`, {
      method: "POST", body,
      headers: { Cookie: session.cookie, Autorization: session.token, "TableApi2-method": "get" },
    });
    if (!response.ok) throw new Error(`TMS вернула ошибку ${response.status} для ${table}`);
    const json = await response.json();
    if (json?.result?.status !== "success" || !Array.isArray(json?.result?.rows)) throw new Error(`Не удалось прочитать ${table}`);
    for (const values of json.result.rows) {
      const row = {};
      keys.forEach((key, index) => { row[fields[key]] = values[index] ?? ""; });
      if (table === "OPERATION_SUB_DOC" && String(row["Тип операции"]) !== "1") continue;
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

export async function syncTms({ login: loginName, password, cacheDir, referenceDir, onStatus = () => {} }) {
  onStatus("login","working","Входим в TMS…");
  let session;
  try { session = await login(loginName, password); onStatus("login","saved","Вход выполнен"); }
  catch(error) { onStatus("login","error","TMS недоступна или не приняла данные входа"); throw error; }
  const fourMonthsAgo = new Date();
  fourMonthsAgo.setMonth(fourMonthsAgo.getMonth() - 4);
  const createdSince = fourMonthsAgo.toISOString().slice(0, 10);
  const cargoFilter = { tryNewFilterFormat: true, value: [["CREATE_DATE", ">=", createdSince]] };
  const autoFilter = { tryNewFilterFormat: true, value: [["ID_OPERATION_TYPE", "=", 1], ["CREATE_DATE", ">=", createdSince]] };
  const tasks = [
    ["cargo","OPERATION_UNIT",cargoFields,cargoFilter,cacheDir,"cargo.xlsx"],
    ["auto","OPERATION_SUB_DOC",autoFields,autoFilter,cacheDir,"auto.xlsx"],
    ["companies","LIST_COMPANY",companyFields,null,referenceDir,"companies.xlsx"],
    ["vehicles","LIST_AUTO",vehicleFields,null,referenceDir,"vehicles.xlsx"],
    ["drivers","LIST_DRIVERS",driverFields,null,referenceDir,"drivers.xlsx"],
    ["points","LIST_WAREHOUSE",warehouseFields,null,referenceDir,"route-points.xlsx"],
  ];
  const counts = {};
  for (const [key,table,fields,filter,targetDir,filename] of tasks) {
    onStatus(key,"working","Получаем данные…");
    try {
      const rows=await getRows(session,table,fields,filter);
      if(!rows.length) throw new Error("реестр пуст");
      writeWorkbook(path.join(targetDir,filename),table,rows);
      counts[key]=rows.length; onStatus(key,"saved",rows.length.toLocaleString("ru-RU")+" строк");
    } catch(error) { onStatus(key,"error",error.message||"Ошибка"); throw error; }
  }
  return { ...counts, updatedAt: new Date().toISOString() };
}
