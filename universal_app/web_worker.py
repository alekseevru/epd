from __future__ import annotations

import base64
import json
import os
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
from data_sources import Catalogs, clean, read_counteragents, read_xlsx, value
from server_generator import Generator


def load_catalogs():
    catalogs = Catalogs()
    files = {
        "companies": Path(os.getenv("AGR_COMPANIES_FILE", r"C:\Users\alekseev\Downloads\2026-07-31_060611_LIST_COMPANY.xlsx")),
        "edo": Path(os.getenv("AGR_EDO_FILE", r"C:\Users\alekseev\Downloads\counteragents.csv")),
        "vehicles": Path(os.getenv("AGR_VEHICLES_FILE", r"G:\Common\SCI\AB Cargo\Справочники logos\Справочник автомашины.xlsx")),
        "drivers": Path(os.getenv("AGR_DRIVERS_FILE", r"G:\Common\SCI\AB Cargo\Справочники logos\Справочник водители.xlsx")),
        "points": Path(os.getenv("AGR_POINTS_FILE", r"G:\Common\SCI\AB Cargo\Справочники logos\Справочник Точки маршрута.xlsx")),
    }
    if files["companies"].exists(): catalogs.companies = read_xlsx(files["companies"], "LIST_COMPANY")
    if files["edo"].exists(): catalogs.edo = read_counteragents(files["edo"])
    if files["vehicles"].exists(): catalogs.vehicles = read_xlsx(files["vehicles"], "LIST_AUTO")
    if files["drivers"].exists(): catalogs.drivers = read_xlsx(files["drivers"], "LIST_DRIVERS")
    if files["points"].exists(): catalogs.points = read_xlsx(files["points"], "LIST_WAREHOUSE")
    return catalogs


catalogs = load_catalogs()
generator = Generator(ROOT / "resources", catalogs)
cache_dir = ROOT.parent / "web_app" / "work" / "source-cache"
source_stamp = None
cargo_index, auto_index = {}, {}


def refresh_sources():
    global source_stamp, cargo_index, auto_index
    cargo_file, auto_file = cache_dir / "cargo.xlsx", cache_dir / "auto.xlsx"
    stamp = (cargo_file.stat().st_mtime_ns, auto_file.stat().st_mtime_ns)
    if stamp == source_stamp: return
    cargo_index = {}
    for row in read_xlsx(cargo_file, "OPERATION_UNIT"):
        for cell in row.values():
            text = clean(cell)
            if len(text) >= 11:
                import re
                match = re.search(r"[A-ZА-Я]{4}\d{7}", text.upper())
                if match: cargo_index[match.group()] = row; break
    auto_index = {}
    for row in read_xlsx(auto_file, "OPERATION_SUB_DOC"):
        import re
        match = re.search(r"[A-ZА-Я]{4}\d{7}", clean(row.get("Номера грузовых единиц")).upper())
        if match: auto_index[match.group()] = row
    source_stamp = stamp


def handle(request):
    refresh_sources()
    container = request["container"]
    cargo, auto = cargo_index.get(container), auto_index.get(container)
    if not cargo or not auto: raise ValueError("Контейнер не найден в обоих локальных реестрах")
    row = {**cargo, **auto, "_container": container}
    instruction = clean(value(row, "Перенаправление сдачи порожнего", "Инструкция на сдачу порожнего", "Контейнерный сток"))
    stock = catalogs.stock(instruction)
    if not stock and instruction: stock = {"Название":instruction,"Адрес":instruction,"Адрес на русском языке":instruction}
    ctx = generator.context(row, date.fromisoformat(request.get("date") or date.today().isoformat()), request.get("user") or "Алексеев Михаил Геннадьевич", stock)
    kind = request["kind"]
    warnings = generator.warnings(ctx, empty=kind == "empty", ezz=kind == "order")
    if warnings and not request.get("confirmWarnings"):
        return {"requiresConfirmation": True, "warnings": warnings}
    if kind == "cargo": filename, content = generator.etrn(ctx, False)
    elif kind == "empty": filename, content = generator.etrn(ctx, True)
    elif kind == "order": filename, content = generator.ezz(ctx)
    else: raise ValueError("Неизвестный тип документа")
    return {"filename":filename,"content":base64.b64encode(content).decode("ascii")}


try:
    refresh_sources()
    warmup_error = None
except Exception as error:
    warmup_error = str(error)
print(json.dumps({"ready":True, "error":warmup_error}, ensure_ascii=True), flush=True)
for line in sys.stdin:
    try:
        request=json.loads(line); result=handle(request); result["requestId"]=request.get("requestId")
    except Exception as error:
        result={"requestId":request.get("requestId") if "request" in locals() else None,"error":str(error)}
    print(json.dumps(result,ensure_ascii=True),flush=True)
