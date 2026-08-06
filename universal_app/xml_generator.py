from __future__ import annotations

import copy
import json
import re
import uuid
import xml.etree.ElementTree as ET
from datetime import date, datetime, time, timedelta
from pathlib import Path

from data_sources import Catalogs, clean, normalize_name, value

TAGLEX = {
    "name": 'ООО "ТАГЛЕКС"', "inn": "7734515704", "kpp": "772601001",
    "phone": "+74957750739",
    "address": "115191, Москва, переулок Гамсоновский, дом 5, корпус 2, квартира V",
    "edo": "2BM-7734515704-771001001-201411210937449434253",
}


def party(company: dict | None, fallback_name: str = "") -> dict:
    company = company or {}
    return {
        "name": clean(company.get("Полное наименование") or company.get("Наименование") or fallback_name),
        "inn": clean(company.get("ИНН")),
        "kpp": clean(company.get("КПП")),
        "phone": clean(company.get("Телефон") or company.get("Телефон (раб.)")),
        "address": clean(company.get("Фактический адрес") or company.get("Юридический адрес")),
    }


def address_attributes(text: str) -> dict:
    text = clean(text)
    attrs = {}
    postal = re.search(r"\b\d{6}\b", text)
    if postal:
        attrs["Индекс"] = postal.group()
    lowered = text.lower()
    region = "78" if "санкт-петербург" in lowered or "спб" in lowered else (
        "77" if "москва" in lowered and "московск" not in lowered else
        "50" if "московск" in lowered else
        "47" if "ленинградск" in lowered else "78"
    )
    attrs["КодРегион"] = region
    attrs["Улица"] = text[:128] or "Адрес уточняется"
    return attrs


def _set_address(wrapper: ET.Element | None, text: str, child_name: str = "АдрРФ"):
    if wrapper is None:
        return
    for child in list(wrapper):
        wrapper.remove(child)
    ET.SubElement(wrapper, child_name, address_attributes(text))


def _set_legal(node: ET.Element | None, data: dict):
    if node is None:
        return
    legal = node.find(".//СвЮЛУч")
    if legal is not None:
        legal.attrib = {"НаимОрг": data["name"] or "Не указано", "ИННЮЛ": data["inn"] or "0000000000"}
        if data.get("kpp"):
            legal.set("КПП", data["kpp"])
    address = node.find(".//Адрес")
    if address is not None:
        _set_address(address, data.get("address", ""))
    phone = node.find(".//Тлф")
    if phone is not None:
        phone.text = data.get("phone") or "+70000000000"


def _as_datetime(value, fallback: datetime) -> datetime:
    if isinstance(value, datetime):
        return value
    if isinstance(value, date):
        return datetime.combine(value, time(9))
    text = clean(value)
    if not text:
        return fallback
    for parser in (
        lambda: datetime.fromisoformat(text.replace("Z", "+00:00")).replace(tzinfo=None),
        lambda: datetime.strptime(text, "%d.%m.%Y %H:%M"),
        lambda: datetime.strptime(text, "%d.%m.%Y"),
    ):
        try:
            return parser()
        except ValueError:
            pass
    return fallback


def _fio(full_name: str) -> dict:
    parts = clean(full_name).split()
    return {
        "Фамилия": parts[0] if parts else "Неуказано",
        "Имя": parts[1] if len(parts) > 1 else "Неуказано",
        "Отчество": parts[2] if len(parts) > 2 else "Неуказано",
    }


def _serialize(root: ET.Element) -> bytes:
    ET.indent(root, space="  ")
    return ET.tostring(root, encoding="windows-1251", xml_declaration=True)


class Generator:
    def __init__(self, resources: Path, catalogs: Catalogs):
        self.catalogs = catalogs
        self.etrn_template = ET.fromstring((resources / "etrn_cargo_sample.xml").read_bytes().decode("windows-1251"))
        self.ezz_template = ET.fromstring((resources / "ezz_sample.xml").read_bytes().decode("windows-1251"))
        contracts_file = resources / "contracts.json"
        self.contracts = json.loads(contracts_file.read_text("utf-8")) if contracts_file.exists() else []

    def _contract_for(self, client_name: str) -> dict | None:
        key = normalize_name(client_name)
        matches = [item for item in self.contracts if normalize_name(item.get("client")) == key and "нет номера договора" not in clean(item.get("number")).lower()]
        if not matches:
            return None
        matches.sort(key=lambda item: (clean(item.get("last_invoice")), int(item.get("invoice_count") or 0), clean(item.get("date"))), reverse=True)
        return matches[0]

    def context(self, row: dict, trip_date: date, user: str, stock: dict | None = None) -> dict:
        container = clean(row["_container"])
        client_name = clean(value(row, "Клиент", "Заказчик"))
        consignee_name = clean(value(row, "Грузополучатель", "Клиент"))
        carrier_name = clean(value(row, "Исполнитель", "Партнер", "Перевозчик"))
        client_company = self.catalogs.company(client_name)
        consignee_company = self.catalogs.company(consignee_name)
        carrier_company = self.catalogs.company(carrier_name)
        driver_name = clean(value(row, "Водитель", "ФИО водителя"))
        driver = self.catalogs.driver(driver_name) or {}
        truck_number = clean(value(row, "Номер автомашины", "Транспортное средство"))
        truck = self.catalogs.vehicle(truck_number) or {}
        return {
            "container": container,
            "date": trip_date,
            "user": user,
            "client": party(client_company, client_name),
            "client_edo": self.catalogs.edo_id(client_company),
            "contract": self._contract_for(client_name),
            "consignee": party(consignee_company, consignee_name),
            "consignee_edo": self.catalogs.edo_id(consignee_company),
            "carrier": party(carrier_company, carrier_name),
            "carrier_edo": self.catalogs.edo_id(carrier_company),
            "driver_name": driver_name or clean(driver.get("Полное имя")),
            "driver_phone": clean(value(row, "Телефон водителя") or driver.get("Телефон 1")),
            "driver_license": clean(driver.get("Серия водительского удостоверения")) + clean(driver.get("Номер водительского удостоверения")),
            "truck_number": truck_number or clean(truck.get("Государственный номер")),
            "truck_brand": clean(truck.get("Марка")) or "Тягач",
            "trailer": clean(value(row, "Номер прицепа")),
            "weight": clean(value(row, "Вес брутто")) or "0",
            "seals": ", ".join(dict.fromkeys(filter(None, [clean(value(row, "Номер пломбы")), clean(value(row, "Номер пломбы 2"))]))),
            "loading": clean(value(row, "Место отправления", "Последняя точка прибытия")),
            "delivery": clean(value(row, "Место прибытия", "Последняя точка прибытия", "Места дислокации грузовых единиц")),
            "delivery_datetime": _as_datetime(value(row, "Плановая дата прибытия", "Последняя план дата прибытия", "ETA (план дата прибытия)"), datetime.combine(trip_date, time(9))),
            "empty_delivery_datetime": _as_datetime(value(row, "Дата сдачи порожнего"), _as_datetime(value(row, "Плановая дата прибытия", "Последняя план дата прибытия", "ETA (план дата прибытия)"), datetime.combine(trip_date, time(9)))),
            "planned_departure_datetime": _as_datetime(value(row, "Плановая дата отправления"), datetime.combine(trip_date, time(9))),
            "actual_departure_datetime": _as_datetime(value(row, "Фактическая дата отправления"), _as_datetime(value(row, "Плановая дата отправления"), datetime.combine(trip_date, time(9)))),
            "stock": stock,
        }

    def etrn(self, ctx: dict, empty: bool = False) -> tuple[str, bytes]:
        root = copy.deepcopy(self.etrn_template)
        now = datetime.now()
        consignee = TAGLEX if empty else ctx["consignee"]
        consignee_edo = TAGLEX["edo"] if empty else ctx["consignee_edo"]
        file_id = (
            f"ON_TRNACLGROT_{ctx['carrier_edo']}_{consignee_edo}_{TAGLEX['edo']}_0_"
            f"{ctx['date']:%Y%m%d}_{uuid.uuid4()}"
        )
        root.set("ИдФайл", file_id)
        root.set("ВерсПрог", "AGR Universal ETRN 1.0")
        doc = root.find("Документ")
        doc.set("ДатИнфГО", now.strftime("%d.%m.%Y"))
        doc.set("ВрИнфГО", now.strftime("%H:%M:%S"))
        info = doc.find("СодИнфГО")
        info.set("НомерТрН", f"{ctx['date']:%Y%m%d}-{ctx['container']}-{'EMPTY' if empty else 'CARGO'}")
        info.set("ДатаТрН", ctx["date"].strftime("%d.%m.%Y"))
        info.set("НомЗак", f"{ctx['date']:%Y%m%d}-{ctx['container']}")
        info.set("ДатаЗак", ctx["date"].strftime("%d.%m.%Y"))
        _set_legal(info.find("СвГО"), TAGLEX)
        _set_legal(info.find("СвЗак"), ctx["client"])
        _set_legal(info.find("СвГП"), consignee)
        delivery = (
            clean((ctx["stock"] or {}).get("Адрес на русском языке") or (ctx["stock"] or {}).get("Адрес"))
            if empty else ctx["delivery"]
        )
        _set_address(info.find("СвГП/АдресДостГр"), delivery, "АдресРФ")
        delivery_time = ctx["empty_delivery_datetime"] if empty else ctx["delivery_datetime"]
        instructions = info.find("УказГО")
        if instructions is not None:
            instructions.set("ДатВрДостГр", delivery_time.isoformat() + "+03:00")
            if not empty and ctx.get("seals"):
                instructions.set("СвПломба", ctx["seals"])
            else:
                instructions.attrib.pop("СвПломба", None)
        cargo = info.find("СвГруз/ОпГруз")
        cargo.set("НаимГруз", f"Порожний контейнер {ctx['container']}" if empty else f"Контейнер {ctx['container']}")
        cargo.find("СвКонтейн/ИдКонтейн").text = ctx["container"]
        cargo.find("ПлМасГруз").set("МасБрутЗнач", "0" if empty else ctx["weight"])
        _set_legal(info.find("СвПер"), ctx["carrier"])
        driver = info.find("СвВодит")
        license_value = re.sub(r"\W", "", ctx["driver_license"])
        driver.set("СерВУ", license_value[:-6] or "БН")
        driver.set("НомВУ", license_value[-6:] or "БН")
        driver.attrib.pop("ДатаВыдВУ", None)
        driver.find("Тлф").text = ctx["driver_phone"] or "+70000000000"
        driver.find("ФИО").attrib = _fio(ctx["driver_name"])
        truck = info.find("СвТС/ТС")
        truck.set("РегНомер", ctx["truck_number"] or "НЕУКАЗАН")
        truck.find("ПарТС").set("Марка", ctx["truck_brand"])
        trailer = info.find("СвТС/Прицеп")
        trailer.set("РегНомер", ctx["trailer"] or "ОТСУТСТВУЕТ")
        planned_departure = ctx["planned_departure_datetime"]
        actual_departure = ctx["actual_departure_datetime"]
        loading = info.find("СвПогруз")
        loading.set("ЗаявПогр", planned_departure.isoformat() + "+03:00")
        loading.set("ФДатВрПриб", actual_departure.isoformat() + "+03:00")
        loading.set("ФДатВрУбыт", actual_departure.isoformat() + "+03:00")
        loading.set("МасБрутОтгр", "0" if empty else ctx["weight"])
        physical_loading = ctx["delivery"] if empty else ctx["loading"]
        _set_address(loading.find("ФАдресПогр"), physical_loading, "АдресРФ")
        if empty:
            owner = loading.find("ВладИнфр")
            if owner is not None:
                owner.set("СовпГОВ", "2")
                _set_legal(owner, ctx["consignee"])
        signer = doc.find("Подписант")
        signer.set("СтатПодп", "1")
        signer.set("Должн", "Сотрудник")
        signer.attrib.pop("ИдСистХран", None)
        signer.find("ФИО").attrib = _fio(ctx["user"])
        for child in list(signer):
            if child.tag != "ФИО":
                signer.remove(child)
        return file_id + ".xml", _serialize(root)

    def ezz(self, ctx: dict) -> tuple[str, bytes]:
        root = copy.deepcopy(self.ezz_template)
        now = datetime.now()
        file_id = f"ON_ZAKZVGO_{ctx['carrier_edo']}_{TAGLEX['edo']}_0_{ctx['date']:%Y%m%d}_{uuid.uuid4()}"
        root.set("ИдФайл", file_id)
        root.set("ВерсПрог", "AGR Universal EZZ 1.0")
        doc = root.find("Документ")
        doc.set("ДатИнфГО", now.strftime("%d.%m.%Y"))
        doc.set("ВрИнфГО", now.strftime("%H:%M:%S"))
        info = doc.find("СодИнфГО")
        contract = root.find(".//ДогОргПрвз")
        selected_contract = ctx.get("contract")
        if contract is not None:
            if selected_contract:
                contract.set("НомерДок", clean(selected_contract.get("number")))
                contract_date = clean(selected_contract.get("date"))
                if contract_date:
                    contract.set("ДатаДок", datetime.strptime(contract_date, "%Y-%m-%d").strftime("%d.%m.%Y"))
                else:
                    contract.attrib.pop("ДатаДок", None)
            else:
                contract.set("НомерДок", "Не найден в справочнике договоров")
                contract.attrib.pop("ДатаДок", None)
        info.set("НомЗак", f"{ctx['date']:%Y%m%d}-{ctx['container']}")
        info.set("ДатаЗак", ctx["date"].strftime("%d.%m.%Y"))
        _set_legal(info.find("СвГО"), TAGLEX)
        _set_legal(info.find("СвПрв"), ctx["carrier"])
        start = datetime.combine(ctx["date"], time(9))
        point = info.find("ПунктПод")
        point.set("ДатВрПод", start.isoformat() + "+03:00")
        _set_address(point.find("АдрПунктПод/Адрес"), ctx["loading"])
        route_points = info.findall("АдрПункт")
        route_points[0].set("ДатВрОпер", start.isoformat() + "+03:00")
        route_points[1].set("ДатВрОпер", (start + timedelta(hours=8)).isoformat() + "+03:00")
        _set_address(route_points[0].find("АдресПункт/Адрес"), ctx["loading"])
        _set_address(route_points[1].find("АдресПункт/Адрес"), ctx["delivery"])
        cargo = info.find("ОпГруз")
        cargo.set("НаимГруз", f"Контейнер {ctx['container']}")
        cargo.find("МасГруз").set("МасБрутЗнач", ctx["weight"])
        signer = doc.find("ПодпИнфГО")
        signer.set("СпосПодтПолном", "1")
        signer.find("ФИО").attrib = _fio(ctx["user"])
        return file_id + ".xml", _serialize(root)
