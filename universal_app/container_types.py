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
