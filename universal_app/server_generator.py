from pathlib import Path

from xml_generator import Generator as BaseGenerator


class Generator(BaseGenerator):
    """Server-only generator without Tkinter/desktop dependencies."""

    def __init__(self, resources: Path, catalogs):
        if not (resources / "etrn_cargo_sample.xml").exists():
            resources = resources / "resources"
        super().__init__(resources, catalogs)

    @staticmethod
    def _validate(ctx, empty=False, ezz=False):
        missing = []
        if not ctx["carrier"]["inn"]:
            missing.append("перевозчик")
        if not ctx["carrier_edo"]:
            missing.append("ID ЭДО перевозчика")
        if not ezz and not empty:
            if not ctx["consignee"]["inn"]:
                missing.append("грузополучатель")
            if not ctx["consignee_edo"]:
                missing.append("ID ЭДО грузополучателя")
        if not ctx["client"]["inn"]:
            missing.append("заказчик")
        if not ctx["client_edo"]:
            missing.append("ID ЭДО заказчика")
        if not ctx.get("user"):
            missing.append("сотрудник, осуществляющий погрузку")
        if not ctx["truck_number"]:
            missing.append("автомобиль")
        if empty and not ctx["stock"]:
            missing.append("контейнерный сток")
        if missing:
            raise ValueError("не заполнено: " + ", ".join(missing))

    @staticmethod
    def warnings(ctx, empty=False, ezz=False):
        warnings = []
        if not ezz:
            missing_driver = []
            if not ctx.get("driver_name"):
                missing_driver.append("ФИО")
            if not ctx.get("driver_phone"):
                missing_driver.append("телефон")
            if len("".join(ch for ch in ctx.get("driver_license", "") if ch.isalnum())) < 7:
                missing_driver.append("водительское удостоверение")
            if missing_driver:
                has_driver_data = bool(ctx.get("driver_name") or ctx.get("driver_phone") or ctx.get("driver_license"))
                ending = " Остальные сведения о водителе будут заполнены." if has_driver_data else " Раздел водителя не будет включён в ЭТрН."
                warnings.append("По водителю не заполнено: " + ", ".join(missing_driver) + "." + ending)
        if ezz and not ctx.get("carrier_contract"):
            warnings.append("Для перевозчика не найден договор в справочнике. В заявке будет указано, что договор не найден.")
        elif not ezz and not ctx.get("client_contract"):
            warnings.append("Для заказчика не найден договор в справочнике. Реквизиты договора не будут включены.")
        if not ezz:
            loading_found = ctx.get("delivery_point_found") if empty else ctx.get("loading_point_found")
            if not loading_found:
                warnings.append("Полный адрес погрузки не найден в справочнике точек маршрута.")
            if not (ctx.get("delivery_owner") if empty else ctx.get("loading_owner")).get("inn"):
                warnings.append("В справочнике точек маршрута не найден владелец объекта пункта погрузки.")
            if not empty and not ctx.get("delivery_point_found"):
                warnings.append("Полный адрес доставки не найден в справочнике точек маршрута.")
        return warnings

    def etrn(self, ctx, empty=False):
        self._validate(ctx, empty=empty)
        return super().etrn(ctx, empty)

    def ezz(self, ctx):
        self._validate(ctx, ezz=True)
        return super().ezz(ctx)

