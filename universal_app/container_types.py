"""Container ISO code and nominal tare from the TMS ТТН/CMR unit-type column."""

import re


def container_iso_from_ttn(row, container_number):
    unit_types = str(row.get("Типы грузовых единиц") or "").strip()
    iso_types = {"".join(parts) for parts in re.findall(
        r"(?<!\d)(20|40)\s*(GP|HC|HQ|DC|DV|RF|RE|OT|FR|FT)(?![A-Z])",
        unit_types.upper(),
    )}
    if len(iso_types) != 1:
        detail = f" («{unit_types}»)" if unit_types else ""
        raise ValueError(
            f"для контейнера {container_number} не определён однозначный тип 20/40 футов в ТТН/CMR, "
            f"столбец «Типы грузовых единиц»{detail}. Обновите данные TMS"
        )
    return iso_types.pop()


def container_tare_from_ttn(row, container_number):
    return "2200" if container_iso_from_ttn(row, container_number).startswith("20") else "3700"


NON_CONTAINER_BODIES = (
    (r"тент", "Тент"),
    (r"рефрижератор|реффура|реф\s*фура", "Рефрижератор"),
    (r"изотерм", "Изотермический фургон"),
    (r"открытый\s+борт", "Бортовой"),
    (r"цельнометаллическ|фургон", "Фургон"),
    (r"автомашин|автомобил|фура|трак", "Автомобиль"),
)


def transport_mode_from_ttn(row):
    """Return a safe automatic choice, or None for missing/mixed unit types."""
    text = str(row.get("Типы грузовых единиц") or "").strip()
    upper = text.upper()
    iso = re.search(r"(?<!\d)(?:20|40)\s*(?:GP|HC|HQ|DC|DV|RF|RE|OT|FR|FT)(?![A-Z])", upper)
    bodies = [body for pattern, body in NON_CONTAINER_BODIES if re.search(pattern, text, re.IGNORECASE)]
    if iso and bodies:
        return None
    if iso:
        return "container"
    if bodies:
        return "non_container"
    return None


def body_type_from_ttn(row):
    text = str(row.get("Типы грузовых единиц") or "")
    for pattern, body in NON_CONTAINER_BODIES:
        if re.search(pattern, text, re.IGNORECASE):
            return body
    return "Автомобиль"
