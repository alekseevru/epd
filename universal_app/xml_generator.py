from __future__ import annotations

import copy
import json
import os
import re
import uuid
import xml.etree.ElementTree as ET
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path

from data_sources import Catalogs, clean, normalize_name, value

TAGLEX = {
    "name": 'ООО "ТАГЛЕКС"', "inn": "7734515704", "kpp": "772601001",
    "phone": "+74957750739",
    "address": "115191, Москва, переулок Гамсоновский, дом 5, корпус 2, квартира V",
    "edo": "2BM-7734515704-771001001-201411210937449434253",
}

ADDRESS_PART_PATTERNS = {
    "Индекс": r"(?<!\d)(\d{6})(?!\d)",
    "Дом": r"(?:^|[,;]\s*|\s)(?:д(?:ом)?\.?)(?!\w)\s*([\w/-]+)",
    "Корпус": r"(?:^|[,;]\s*|\s)(?:корп(?:ус)?\.?|к\.?|стр(?:оение)?\.?)(?!\w)\s*([\w.\-/ ]+?)(?=\s*[,;]|$)",
    "Кварт": r"(?:^|[,;]\s*|\s)(?:кв(?:артира)?\.?)(?!\w)\s*([\w\-/]+)",
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
    attrs: dict[str, str] = {}
    for key, pattern in ADDRESS_PART_PATTERNS.items():
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            attrs[key] = clean(match.group(1))
    lowered = text.lower()
    region = "78" if "санкт-петербург" in lowered or "спб" in lowered else (
        "77" if "москва" in lowered and "московск" not in lowered else
        "50" if "московск" in lowered else
        "47" if "ленинградск" in lowered else "78"
    )
    attrs["КодРегион"] = region
    street_match = re.search(
        r"((?:ул(?:ица)?\.?|пер(?:еулок)?\.?|наб(?:ережная)?\.?|ш(?:оссе)?\.?|пр(?:оспект|оезд)?\.?|пл(?:ощадь)?\.?)\s+.+?)(?=\s*[,;]\s*(?:д(?:ом)?\.?|корп(?:ус)?\.?|стр(?:оение)?\.?|кв(?:артира)?\.?)\s|$)",
        text,
        re.IGNORECASE,
    )
    if street_match:
        attrs["Улица"] = clean(street_match.group(1))[:128]
    else:
        remainder = re.sub(r"(?<!\d)\d{6}(?!\d)", "", text)
        remainder = re.sub(r"^(?:Россия\s*,?\s*)", "", remainder, flags=re.IGNORECASE)
        attrs["Улица"] = clean(remainder).strip(" ,")[:128] or "Адрес уточняется"
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
    contact = node.find(".//Контакт")
    contact_tag = "Контакт"
    if contact is None:
        contact = node.find(".//Конт")
        contact_tag = "Конт"
    phone_value = clean(data.get("phone"))
    if not phone_value:
        if contact is not None:
            parent = next((item for item in node.iter() if contact in list(item)), None)
            if parent is not None:
                parent.remove(contact)
        return
    if contact is None:
        requisites = node.find(".//РекИдентГО")
        if requisites is None:
            requisites = node.find(".//РекИдентЗак")
        if requisites is None:
            requisites = node.find(".//РекИдентГП")
        if requisites is None and node.find("ИдСв") is not None:
            contact_tag = "Конт"
        contact = ET.SubElement(requisites if requisites is not None else node, contact_tag)
    phone = contact.find("Тлф")
    if phone is None:
        phone = ET.SubElement(contact, "Тлф")
    phone.text = phone_value


def _set_ezz_shipper_phone(node: ET.Element | None, phone_value: str):
    """Write the EZZ shipper phone to the exact schema node used by Kontur."""
    if node is None:
        return
    for legacy in node.findall("Контакт"):
        node.remove(legacy)
    contact = node.find("Конт")
    if contact is None:
        contact = ET.SubElement(node, "Конт")
    phone = contact.find("Тлф")
    if phone is None:
        phone = ET.SubElement(contact, "Тлф")
    phone.text = clean(phone_value)


def _set_contract(node: ET.Element | None, contract: dict | None):
    if node is None:
        return
    existing = node.find("ДогУслПер")
    if not contract:
        if existing is not None:
            node.remove(existing)
        return
    if existing is None:
        existing = ET.SubElement(node, "ДогУслПер")
    existing.set("НаимДок", clean(contract.get("title")) or "Договор")
    existing.set("НомерДок", clean(contract.get("number")))
    raw_date = clean(contract.get("date"))
    if raw_date:
        try:
            existing.set("ДатаДок", datetime.strptime(raw_date, "%Y-%m-%d").strftime("%d.%m.%Y"))
        except ValueError:
            existing.set("ДатаДок", raw_date)
    else:
        existing.attrib.pop("ДатаДок", None)


def _as_datetime(value, fallback: datetime) -> datetime:
    if isinstance(value, datetime):
        return value
    if isinstance(value, date):
        return datetime.combine(value, time(9))
    text = clean(value)
    if not text:
        return fallback
    def parse_iso():
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        if parsed.tzinfo is not None:
            parsed = parsed.astimezone(timezone(timedelta(hours=3))).replace(tzinfo=None)
        return parsed

    for parser in (
        parse_iso,
        lambda: datetime.strptime(text, "%d.%m.%Y %H:%M"),
        lambda: datetime.strptime(text, "%d.%m.%Y"),
    ):
        try:
            return parser()
        except ValueError:
            pass
    return fallback


def _epd_datetime(value: datetime) -> str:
    return value.strftime("%d.%m.%YT%H:%M:%S+03:00")


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
        embedded_file = resources / "contracts.json"
        self.contracts = json.loads(embedded_file.read_text("utf-8-sig")) if embedded_file.exists() else []
        configured_contracts = clean(os.getenv("AGR_CONTRACTS_FILE"))
        configured_file = Path(configured_contracts) if configured_contracts else None
        if configured_file and configured_file.exists() and configured_file.resolve() != embedded_file.resolve():
            self.contracts.extend(json.loads(configured_file.read_text("utf-8-sig")))

    def _contract_for(self, party_name: str, role: str = "client") -> dict | None:
        key = normalize_name(party_name)

        def contract_parties(item):
            aliases = item.get("aliases") if isinstance(item.get("aliases"), list) else []
            if role == "carrier":
                primary = item.get("carrier") or item.get("counterparty") or (
                    item.get("client") if clean(item.get("role")).lower() == "carrier" else ""
                )
            else:
                primary = item.get("client") or item.get("counterparty")
            return [primary, *aliases]

        matches = [
            item for item in self.contracts
            if any(normalize_name(name) == key for name in contract_parties(item) if clean(name))
            and "нет номера договора" not in clean(item.get("number")).lower()
        ]
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
        route = clean(value(row, "Маршрут"))
        route_names = [
            clean(re.sub(r"^\(RU\)\s*", "", item, flags=re.IGNORECASE))
            for item in re.split(r"\s*(?:->|→|—>)\s*", route)
            if clean(item)
        ]
        loading_name = route_names[0] if route_names else clean(value(row, "Место отправления", "Последняя точка прибытия"))
        delivery_name = route_names[-1] if len(route_names) > 1 else clean(value(row, "Место прибытия", "Последняя точка прибытия", "Места дислокации грузовых единиц"))
        loading_point = self.catalogs.point(loading_name)
        delivery_point = self.catalogs.point(delivery_name)

        def point_address(point, fallback):
            return clean((point or {}).get("Адрес на русском языке") or (point or {}).get("Адрес") or fallback)

        def point_owner(point):
            inn = clean((point or {}).get("ИНН"))
            company = self.catalogs.company(inn=inn) if inn else None
            result = party(company, clean((point or {}).get("Название")))
            if point:
                result["address"] = point_address(point, result.get("address"))
                result["phone"] = clean(point.get("Номер телефона")) or result.get("phone", "")
            return result

        return {
            "container": container,
            "date": trip_date,
            "user": user,
            "client": party(client_company, client_name),
            "client_edo": self.catalogs.edo_id(client_company),
            "order_number": f"{trip_date:%Y%m%d}-{container}",
            "order_date": trip_date.strftime("%d.%m.%Y"),
            "client_contract": self._contract_for(client_name),
            "carrier_contract": self._contract_for(carrier_name, role="carrier"),
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
            "loading": point_address(loading_point, loading_name),
            "delivery": point_address(delivery_point, delivery_name),
            "loading_owner": point_owner(loading_point),
            "delivery_owner": point_owner(delivery_point),
            "loading_point_found": bool(loading_point),
            "delivery_point_found": bool(delivery_point),
            "delivery_datetime": _as_datetime(value(row, "Планируемая дата доставки на склад", "Плановая дата доставки на склад", "Плановая дата прибытия", "Последняя план дата прибытия", "ETA (план дата прибытия)"), datetime.combine(trip_date, time(9))),
            "planned_arrival_datetime": _as_datetime(value(row, "Плановая дата прибытия", "Последняя план дата прибытия", "ETA (план дата прибытия)"), _as_datetime(value(row, "Планируемая дата доставки на склад", "Плановая дата доставки на склад"), datetime.combine(trip_date, time(17)))),
            "empty_delivery_datetime": _as_datetime(value(row, "Дата сдачи порожнего"), _as_datetime(value(row, "Плановая дата прибытия", "Последняя план дата прибытия", "ETA (план дата прибытия)"), datetime.combine(trip_date, time(9)))),
            "planned_departure_datetime": _as_datetime(value(row, "Плановая дата отправления"), datetime.combine(trip_date, time(9))),
            # По согласованной логике ЭТрН фактическое прибытие на погрузку
            # совпадает с заявленной подачей; фактическое убытие ставится на час позже.
            "actual_departure_datetime": _as_datetime(value(row, "Плановая дата отправления"), datetime.combine(trip_date, time(9))),
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
        info.set("НомЗак", ctx["order_number"])
        info.set("ДатаЗак", ctx["order_date"])
        _set_legal(info.find("СвГО"), TAGLEX)
        _set_legal(info.find("СвЗак"), ctx["client"])
        _set_contract(info.find("СвЗак"), ctx.get("client_contract"))
        _set_legal(info.find("СвГП"), consignee)
        delivery = (
            clean((ctx["stock"] or {}).get("Адрес на русском языке") or (ctx["stock"] or {}).get("Адрес"))
            if empty else ctx["delivery"]
        )
        _set_address(info.find("СвГП/АдресДостГр"), delivery, "АдресРФ")
        delivery_time = ctx["empty_delivery_datetime"] if empty else ctx["delivery_datetime"]
        instructions = info.find("УказГО")
        if instructions is not None:
            instructions.set("ДатВрДостГр", _epd_datetime(delivery_time))
            if not empty and ctx.get("seals"):
                instructions.set("СвПломба", ctx["seals"])
            else:
                instructions.attrib.pop("СвПломба", None)
        cargo = info.find("СвГруз/ОпГруз")
        cargo.set("НаимГруз", f"Порожний контейнер {ctx['container']}" if empty else f"Контейнер {ctx['container']}")
        if empty:
            cargo.set("СпУпак", "Отсутствует")
        container_info = cargo.find("СвКонтейн")
        if container_info is not None:
            cargo.remove(container_info)
        cargo.find("ПлМасГруз").set("МасБрутЗнач", "0" if empty else ctx["weight"])
        _set_legal(info.find("СвПер"), ctx["carrier"])
        driver = info.find("СвВодит")
        license_value = re.sub(r"\W", "", ctx["driver_license"])
        has_driver_data = bool(ctx["driver_name"] or ctx["driver_phone"] or license_value)
        if driver is not None and has_driver_data:
            if len(license_value) >= 7:
                driver.set("СерВУ", license_value[:-6])
                driver.set("НомВУ", license_value[-6:])
            else:
                driver.attrib.pop("СерВУ", None)
                driver.attrib.pop("НомВУ", None)
            driver.attrib.pop("ДатаВыдВУ", None)
            phone = driver.find("Тлф")
            if ctx["driver_phone"]:
                if phone is None:
                    phone = ET.SubElement(driver, "Тлф")
                phone.text = ctx["driver_phone"]
            elif phone is not None:
                driver.remove(phone)
            driver_name = driver.find("ФИО")
            if ctx["driver_name"]:
                if driver_name is None:
                    driver_name = ET.SubElement(driver, "ФИО")
                driver_name.attrib = _fio(ctx["driver_name"])
            elif driver_name is not None:
                driver.remove(driver_name)
        elif driver is not None:
            info.remove(driver)
        truck = info.find("СвТС/ТС")
        truck.set("РегНомер", ctx["truck_number"] or "НЕУКАЗАН")
        truck.find("ПарТС").set("Марка", ctx["truck_brand"])
        trailer = info.find("СвТС/Прицеп")
        trailer.set("РегНомер", ctx["trailer"] or "ОТСУТСТВУЕТ")
        planned_departure = ctx["planned_departure_datetime"]
        actual_departure = ctx["actual_departure_datetime"]
        loading = info.find("СвПогруз")
        loading.set("ЗаявПогр", _epd_datetime(planned_departure))
        loading.set("ФДатВрПриб", _epd_datetime(actual_departure))
        loading.set("ФДатВрУбыт", _epd_datetime(actual_departure + timedelta(hours=1)))
        loading.set("МасБрутОтгр", "0" if empty else ctx["weight"])
        physical_loading = ctx["delivery"] if empty else ctx["loading"]
        _set_address(loading.find("ФАдресПогр"), physical_loading, "АдресРФ")
        loading_person = loading.find("СвЛицПогрГр/РабЛицПогрГр")
        if loading_person is not None:
            loading_person.set("Должность", "Сотрудник")
            loading_person.find("ФИО").attrib = _fio(ctx["user"])
        owner = loading.find("ВладИнфр")
        # Для порожней перевозки погрузка выполняется на складе, куда был
        # доставлен груз. Владельцем этого объекта является грузополучатель
        # грузовой перевозки (клиент), а не грузоотправитель порожней ЭТрН.
        owner_data = ctx["consignee"] if empty else ctx["loading_owner"]
        if owner is not None and owner_data.get("inn"):
            owner.set("СовпГОВ", "2")
            _set_legal(owner, owner_data)
        elif owner is not None:
            loading.remove(owner)
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
        selected_contract = ctx.get("carrier_contract")
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
        info.set("НомЗак", ctx["order_number"])
        info.set("ДатаЗак", ctx["order_date"])
        shipper = info.find("СвГО")
        _set_legal(shipper, TAGLEX)
        _set_ezz_shipper_phone(shipper, TAGLEX["phone"])
        _set_legal(info.find("СвПрв"), ctx["carrier"])
        start = ctx["planned_departure_datetime"]
        finish = ctx["planned_arrival_datetime"]
        point = info.find("ПунктПод")
        point.set("ДатВрПод", _epd_datetime(start))
        _set_address(point.find("АдрПунктПод/Адрес"), ctx["loading"])
        route_points = info.findall("АдрПункт")
        route_points[0].set("ДатВрОпер", _epd_datetime(start))
        route_points[1].set("ДатВрОпер", _epd_datetime(finish))
        _set_address(route_points[0].find("АдресПункт/Адрес"), ctx["loading"])
        _set_address(route_points[1].find("АдресПункт/Адрес"), ctx["delivery"])
        cargo = info.find("ОпГруз")
        cargo.set("НаимГруз", f"Контейнер {ctx['container']}")
        cargo.find("МасГруз").set("МасБрутЗнач", ctx["weight"])
        signer = doc.find("ПодпИнфГО")
        signer.set("СпосПодтПолном", "1")
        signer.find("ФИО").attrib = _fio(ctx["user"])
        return file_id + ".xml", _serialize(root)
