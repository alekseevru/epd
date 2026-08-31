from __future__ import annotations

import csv
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta
from pathlib import Path
from zipfile import ZipFile

MAIN_NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
REL_NS = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
PKG_NS = "{http://schemas.openxmlformats.org/package/2006/relationships}"
CONTAINER_RE = re.compile(r"\b([A-ZА-Я]{4}\s*\d{7})\b", re.IGNORECASE)


def clean(value) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def normalize_name(value) -> str:
    text = clean(value).upper().replace("Ё", "Е")
    text = re.sub(r"[«»\"'`]", "", text)
    text = re.sub(r"\b(ООО|АО|ПАО|ЗАО|ИП|ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ)\b", "", text)
    return re.sub(r"[^A-ZА-Я0-9]+", "", text)


def normalize_container(value) -> str:
    value = clean(value).upper().replace(" ", "")
    value = value.translate(str.maketrans("АВСЕНКМОРТХУ", "ABCEHKMOPTXY"))
    match = re.fullmatch(r"([A-Z]{4})(\d{7})", value)
    return "".join(match.groups()) if match else ""


def _column_index(reference: str) -> int:
    result = 0
    for char in re.match(r"[A-Z]+", reference).group():
        result = result * 26 + ord(char) - 64
    return result - 1


def read_xlsx(path: str | Path, preferred_sheet: str | None = None) -> list[dict]:
    with ZipFile(path) as archive:
        shared = []
        if "xl/sharedStrings.xml" in archive.namelist():
            root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
            shared = ["".join(node.itertext()) for node in root.findall(f"{MAIN_NS}si")]
        date_styles = set()
        if "xl/styles.xml" in archive.namelist():
            styles = ET.fromstring(archive.read("xl/styles.xml"))
            custom = {
                int(node.attrib["numFmtId"]): node.attrib.get("formatCode", "")
                for node in styles.findall(f"{MAIN_NS}numFmts/{MAIN_NS}numFmt")
            }
            for index, node in enumerate(styles.findall(f"{MAIN_NS}cellXfs/{MAIN_NS}xf")):
                fmt = int(node.attrib.get("numFmtId", 0))
                if fmt in range(14, 23) or re.search(r"[dmyhs]", custom.get(fmt, ""), re.I):
                    date_styles.add(index)
        workbook = ET.fromstring(archive.read("xl/workbook.xml"))
        relationships = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
        targets = {node.attrib["Id"]: node.attrib["Target"] for node in relationships.findall(f"{PKG_NS}Relationship")}
        sheets = workbook.findall(f"{MAIN_NS}sheets/{MAIN_NS}sheet")
        selected = next((node for node in sheets if node.attrib.get("name") == preferred_sheet), sheets[0])
        target = targets[selected.attrib[f"{REL_NS}id"]].lstrip("/")
        if not target.startswith("xl/"):
            target = "xl/" + target
        root = ET.fromstring(archive.read(target))
        matrix = []
        for row in root.findall(f"{MAIN_NS}sheetData/{MAIN_NS}row"):
            cells = {}
            for cell in row.findall(f"{MAIN_NS}c"):
                index = _column_index(cell.attrib["r"])
                kind = cell.attrib.get("t")
                value_node = cell.find(f"{MAIN_NS}v")
                inline = cell.find(f"{MAIN_NS}is")
                if inline is not None:
                    value = "".join(inline.itertext())
                elif value_node is None:
                    value = ""
                elif kind == "s":
                    value = shared[int(value_node.text)]
                elif kind == "b":
                    value = value_node.text == "1"
                else:
                    try:
                        number = float(value_node.text)
                        style = int(cell.attrib.get("s", 0))
                        value = datetime(1899, 12, 30) + timedelta(days=number) if style in date_styles else (
                            int(number) if number.is_integer() else number
                        )
                    except (ValueError, TypeError):
                        value = value_node.text if value_node is not None else ""
                cells[index] = value
            matrix.append([cells.get(i, "") for i in range(max(cells, default=-1) + 1)])
    if not matrix:
        return []
    headers = [clean(value) for value in matrix[0]]
    return [
        {header: row[index] if index < len(row) else "" for index, header in enumerate(headers) if header}
        for row in matrix[1:]
        if any(clean(value) for value in row)
    ]


def read_counteragents(path: str | Path) -> list[dict]:
    with open(path, encoding="utf-8-sig", newline="") as stream:
        return list(csv.DictReader(stream, delimiter=";"))


class Catalogs:
    def __init__(self):
        self.companies: list[dict] = []
        self.edo: list[dict] = []
        self.vehicles: list[dict] = []
        self.drivers: list[dict] = []
        self.points: list[dict] = []

    def company(self, name: str = "", inn: str = "", kpp: str = "") -> dict | None:
        inn, kpp = clean(inn), clean(kpp)
        candidates = self.companies
        if inn:
            exact = [r for r in candidates if clean(r.get("ИНН")) == inn and (not kpp or clean(r.get("КПП")) == kpp)]
            if exact:
                return exact[0]
        key = normalize_name(name)
        exact = [
            row for row in candidates
            if key and any(
                normalize_name(row.get(field)) == key
                for field in ("Наименование", "Полное наименование", "Краткое наименование")
                if clean(row.get(field))
            )
        ]
        if exact:
            exact.sort(key=lambda row: (bool(clean(row.get("ИНН"))), bool(clean(row.get("КПП")))), reverse=True)
            return exact[0]
        return None

    def edo_id(self, company: dict | None) -> str:
        if not company:
            return ""
        inn, kpp = clean(company.get("ИНН")), clean(company.get("КПП"))
        active = [
            row for row in self.edo
            if clean(row.get("ИНН")) == inn
            and (not kpp or clean(row.get("КПП")) == kpp)
            and clean(row.get("Дата ликвидации контрагента")) == "Действующая организация"
        ]
        if len(active) == 1:
            return clean(active[0].get("Идентификатор участника ЭДО"))
        all_rows = [row for row in self.edo if clean(row.get("ИНН")) == inn and (not kpp or clean(row.get("КПП")) == kpp)]
        if len(all_rows) == 1:
            return clean(all_rows[0].get("Идентификатор участника ЭДО"))
        by_inn = [row for row in self.edo if clean(row.get("ИНН")) == inn]
        return clean(by_inn[0].get("Идентификатор участника ЭДО")) if len(by_inn) == 1 else ""

    def driver(self, full_name: str) -> dict | None:
        key = normalize_name(full_name)
        matches = [row for row in self.drivers if normalize_name(row.get("Полное имя")) == key]
        return matches[0] if len(matches) == 1 else None

    def vehicle(self, number: str) -> dict | None:
        key = re.sub(r"[^A-ZА-Я0-9]", "", clean(number).upper())
        matches = [
            row for row in self.vehicles
            if re.sub(r"[^A-ZА-Я0-9]", "", clean(row.get("Государственный номер")).upper()) == key
        ]
        return matches[0] if len(matches) == 1 else None

    def container_stocks(self) -> list[dict]:
        return [row for row in self.points if "контейнерный сток" in clean(row.get("Роли")).lower()]

    def stock(self, instruction: str) -> dict | None:
        key = normalize_name(instruction)
        if not key:
            return None
        matches = []
        for row in self.container_stocks():
            fields = (
                row.get("Номер склада и название"),
                row.get("Название"),
                row.get("Адрес"),
                row.get("Адрес на русском языке"),
            )
            normalized = [normalize_name(value) for value in fields if clean(value)]
            if key in normalized or any(key in value or value in key for value in normalized if len(value) >= 5):
                matches.append(row)
        return matches[0] if len(matches) == 1 else None


    def point(self, name: str) -> dict | None:
        key = normalize_name(name)
        if not key:
            return None
        ranked = []
        for row in self.points:
            fields = (row.get("Номер склада и название"), row.get("Название"), row.get("Название (англ)"))
            normalized = [normalize_name(item) for item in fields if clean(item)]
            if key in normalized:
                match_score = 30
            elif any(key in item or item in key for item in normalized if len(item) >= 5):
                match_score = 20
            else:
                continue
            completeness = (
                6 * bool(clean(row.get("Адрес на русском языке")))
                + 3 * bool(clean(row.get("Адрес")))
                + 2 * bool(clean(row.get("ИНН")))
                + bool(clean(row.get("Роли")))
            )
            ranked.append((match_score + completeness, row))
        if not ranked:
            return None
        ranked.sort(key=lambda item: item[0], reverse=True)
        best = [row for score, row in ranked if score == ranked[0][0]]
        if len(best) == 1:
            return best[0]
        addresses = {
            normalize_name(row.get("Адрес на русском языке") or row.get("Адрес"))
            for row in best
            if clean(row.get("Адрес на русском языке") or row.get("Адрес"))
        }
        return best[0] if len(addresses) <= 1 else None


def trip_container(row: dict) -> str:
    for field in ("Номера грузовых единиц", "Контейнер", "Номер контейнера", "Импорт"):
        match = CONTAINER_RE.search(clean(row.get(field)).upper())
        if match:
            value = normalize_container(match.group(1))
            if value:
                return value
    return ""


def value(row: dict, *names: str):
    for name in names:
        if clean(row.get(name)):
            return row.get(name)
    return ""
