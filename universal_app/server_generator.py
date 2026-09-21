from pathlib import Path
import re
import uuid
import xml.etree.ElementTree as ET

from xml_generator import Generator as BaseGenerator, TAGLEX, address_attributes


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
        if not ezz and not ctx["truck_number"]:
            missing.append("автомобиль")
        if empty and not ctx["stock"]:
            missing.append("контейнерный сток")
        if empty and ctx["stock"] and not ctx.get("stock_party", {}).get("inn"):
            missing.append("ИНН контейнерного стока")
        if missing:
            raise ValueError("не заполнено: " + ", ".join(missing))

    @staticmethod
    def warnings(ctx, empty=False, ezz=False):
        warnings = []
        if ezz and (not ctx.get("loading_owner", {}).get("inn") or not ctx.get("loading_owner", {}).get("name")):
            warnings.append("В справочнике не заполнены название или ИНН владельца точки погрузки. Заполните сведения о владельце вручную в заявке перед подписанием.")
        if not ezz:
            if not ctx.get("client", {}).get("phone"):
                warnings.append("В справочнике организаций не заполнен телефон заказчика.")
            if not empty and not ctx.get("consignee", {}).get("phone"):
                warnings.append("В справочнике организаций не заполнен телефон грузополучателя.")
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
            if not (ctx.get("consignee") if empty else ctx.get("loading_owner")).get("inn"):
                warnings.append("В справочнике точек маршрута не найден владелец объекта пункта погрузки.")
            if not (ctx.get("consignee") if empty else ctx.get("loading_owner")).get("phone"):
                warnings.append("Для владельца объекта пункта погрузки не заполнен телефон в справочнике.")
            if not empty and not ctx.get("delivery_point_found"):
                warnings.append("Полный адрес доставки не найден в справочнике точек маршрута.")
        return warnings

    def etrn(self, ctx, empty=False):
        self._validate(ctx, empty=empty)
        return super().etrn(ctx, empty)

    def ezz(self, ctx):
        self._validate(ctx, ezz=True)
        return super().ezz(ctx)

    @staticmethod
    def forwarding_order_userdata(contexts, signer_name):
        if isinstance(contexts, dict):
            contexts = [contexts]
        ctx = contexts[0]
        def russian_address(parent, text, include_other_info=False):
            attrs = address_attributes(text or "")
            region = attrs.get("КодРегион")
            if not region:
                return False
            mapped = {"Индекс":"ZipCode","КодРегион":"Region","Город":"City","НаселПункт":"Locality","Улица":"Street","Дом":"Building","Корпус":"Block"}
            values = {mapped[key]:value for key,value in attrs.items() if key in mapped and value}
            if include_other_info and text:
                values["OtherInfo"] = str(text)[:1000]
            ET.SubElement(parent, "RussianAddress", values)
            return True

        def org(parent, data, edo="", address_as_other_info=False):
            foreign = bool(data.get("foreign"))
            details = ET.SubElement(parent, "OrganizationDetails", {
                "OrgType":"4" if foreign else "2", "OrgName":data.get("name") or "Не указано",
                **({"Inn":data.get("inn")} if data.get("inn") and not foreign else {}),
                **({"Kpp":data.get("kpp")} if data.get("kpp") and not foreign else {}),
                **({"FnsParticipantId":edo} if edo and not foreign else {}),
                **({"StatusId":"LegalEntity","OrganizationOrPersonInfo":data.get("name") or "Не указано"} if foreign else {}),
            })
            address = ET.Element("Address")
            if russian_address(address, data.get("address") or "", address_as_other_info):
                details.append(address)

        parts = signer_name.split()
        if len(parts) < 2:
            raise ValueError("укажите фамилию и имя подписанта клиента")
        contract = ctx.get("client_contract")
        if not contract:
            raise ValueError("для клиента не найден договор транспортной экспедиции")
        if not ctx["client"].get("inn") or not ctx.get("client_edo"):
            raise ValueError("для клиента не заполнены ИНН или ID ЭДО")
        root = ET.Element("LogisticsForwardingOrderClientTitle", {
            "ForwardingOrderId":str(uuid.uuid4()), "Number":ctx["order_number"], "Date":ctx["order_date"], "HasCargoDocs":"0",
        })
        order = ET.SubElement(root, "ClientForwarderOrder")
        cargo_infos = ET.SubElement(order, "CargoInfos")
        for cargo_index, cargo_ctx in enumerate(contexts, start=1):
            cargo = ET.SubElement(cargo_infos, "CargoInfo", {
                "ReadyFromDate":cargo_ctx["planned_departure_datetime"].strftime("%d.%m.%Y"),
                "ReadyToDate":cargo_ctx["planned_departure_datetime"].strftime("%d.%m.%Y"),
                "TransportationIndicator":"1", "CargoBatchId":str(uuid.uuid4()), "ShipmentCargoSpaceQuantity":"1", "NotifyReq":"0",
            })
            org(ET.SubElement(cargo,"Consignee"),cargo_ctx["consignee"],cargo_ctx.get("consignee_edo",""))
            shipper = cargo_ctx.get("order_shipper") or (cargo_ctx.get("loading_owner") if (cargo_ctx.get("loading_owner") or {}).get("inn") else cargo_ctx["client"])
            org(ET.SubElement(cargo,"Shipper"),shipper)
            ET.SubElement(ET.SubElement(cargo,"TransportInfos"),"TransportInfo",{"TransportType":"1","BodyType":"Контейнеровоз"})
            weight = cargo_ctx.get("weight") or "0"
            ET.SubElement(cargo,"BatchWeight",{"NetWeight":weight,"GrossWeight":weight})
            descriptions=ET.SubElement(cargo,"ItemDescriptions")
            item=ET.SubElement(descriptions,"ItemDescription",{"Name":cargo_ctx.get("cargo_name") or f"Контейнер {cargo_ctx['container']}","CargoSpaceQuantity":"1","HasDangerous":"0","HasRestrictedItems":"0","CanSpecifyVolume":"0","IsForStateSystemRegistration":"0","HasPackaging":"0","HasCommodityCode":"0"})
            ET.SubElement(ET.SubElement(item,"Marks"),"Mark").text=cargo_ctx["container"]
            ET.SubElement(ET.SubElement(item,"CargoNumbers"),"CargoNumber").text=str(cargo_index)
            origin=ET.SubElement(item,"CargoOriginCountryInfo")
            ET.SubElement(origin,"Country").text="643"
            ET.SubElement(item,"CargoWeight",{"NetWeight":weight,"GrossWeight":weight})
            containers=ET.SubElement(cargo,"TransportContainers")
            seals=[seal for seal in cargo_ctx.get("seal_numbers",[]) if re.fullmatch(r"\d{1,10}",str(seal))]
            container=ET.SubElement(containers,"TransportContainer",{"ContainerOrderNumber":str(cargo_index),"IsContainerProvided":"1","TotalGrossWeight":weight,**({"SealCount":str(len(seals))} if seals else {})})
            if seals:
                seal_numbers=ET.SubElement(container,"SealNumbers")
                for seal in seals:
                    ET.SubElement(seal_numbers,"SealNumber").text=str(seal)
            ET.SubElement(container,"IntContainerId").text=cargo_ctx["container"]
            address=ET.Element("Address")
            if russian_address(address,cargo_ctx["loading"]) or russian_address(address,shipper.get("address")):
                wrapper=ET.SubElement(cargo,"CargoLocationAddress",{"CargoPickupLocation":"1"}); delivery=ET.SubElement(wrapper,"CargoDeliveryAddress"); delivery.append(address)
            services=[str(service).strip() for service in cargo_ctx.get("services",[]) if str(service).strip()]
            if services:
                service_infos=ET.SubElement(cargo,"LogisticsServiceInfos")
                for service in services:
                    ET.SubElement(service_infos,"LogisticsServiceInfo",{"ServiceName":service})
            address=ET.Element("Address")
            if russian_address(address,cargo_ctx["delivery"]) or russian_address(address,cargo_ctx["consignee"].get("address")):
                wrapper=ET.SubElement(cargo,"DestinationAddress",{"CargoDeliveryPoint":"1"}); delivery=ET.SubElement(wrapper,"CargoDeliveryAddress"); delivery.append(address)
        org(ET.SubElement(order,"ClientInfo"),ctx["client"],ctx["client_edo"])
        org(ET.SubElement(order,"ForwarderInfo"),TAGLEX,TAGLEX["edo"],True)
        contract_date = str(contract.get("date") or "").split("T")[0].split(" ")[0]
        if len(contract_date) == 10 and contract_date[4] == "-":
            contract_date = f"{contract_date[8:10]}.{contract_date[5:7]}.{contract_date[:4]}"
        contract_node=ET.SubElement(order,"ForwardingContractRequisites",{"DocumentName":contract.get("title") or "Договор транспортной экспедиции","DocumentNumber":contract.get("number") or "","DocumentDate":contract_date})
        ET.SubElement(contract_node,"IdentificationDetails",{"Inn":TAGLEX["inn"]})
        signers=ET.SubElement(root,"Signers"); signer=ET.SubElement(signers,"Signer",{"SignerPowersConfirmationMethod":"1"})
        ET.SubElement(signer,"Fio",{"LastName":parts[0],"FirstName":parts[1],**({"MiddleName":" ".join(parts[2:])} if len(parts)>2 else {})})
        def xml_safe(value):
            return "".join(char for char in str(value) if char in "\t\n\r" or 0x20 <= ord(char) <= 0xD7FF or 0xE000 <= ord(char) <= 0xFFFD)
        for element in root.iter():
            element.attrib.update({key:xml_safe(value) for key,value in element.attrib.items()})
            if element.text:
                element.text=xml_safe(element.text)
            if element.tail:
                element.tail=xml_safe(element.tail)
        return ET.tostring(root,encoding="utf-8",xml_declaration=True).decode("utf-8")

