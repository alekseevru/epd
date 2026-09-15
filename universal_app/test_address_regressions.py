import unittest
import xml.etree.ElementTree as ET
from datetime import date
from pathlib import Path
from address_xml import known_gar, complete_gar
from data_sources import Catalogs
from server_generator import Generator as ServerGenerator
from xml_generator import Generator, TAGLEX, address_attributes, _set_address, _set_contract, cargo_packaging, known_point_phone, party


class AddressRegressions(unittest.TestCase):
    def test_nbi_address(self):
        attrs = address_attributes('173008, Новгородская обл, Великий Новгород г, Магистральная ул, дом № 11/13')
        self.assertEqual((attrs['Индекс'], attrs['КодРегион'], attrs['Дом']), ('173008', '53', '11/13'))
        self.assertEqual(attrs['Улица'], 'Магистральная ул')

    def test_region_not_street(self):
        attrs = address_attributes('196006, г. Санкт-Петербург, Московский пр-кт, д. 120А, стр. 1')
        self.assertEqual(attrs['КодРегион'], '78')
        self.assertEqual(attrs['Корпус'], 'стр. 1')

    def test_full_gar(self):
        for text in (TAGLEX['address'], 'СПб, Шушары, ул. Автозаводская, д. 2, лит А'):
            gar = known_gar(text)
            self.assertTrue(complete_gar(text, gar))
            wrapper = ET.Element('Адрес')
            _set_address(wrapper, text, gar=gar)
            self.assertEqual(len(wrapper.findall('АдрФИАС/Здание')), 2)
            self.assertIsNotNone(wrapper.find('АдрФИАС/ЭлУлДорСети'))

    def test_incomplete_gar_fallback(self):
        text = '173008, Новгородская обл, Великий Новгород г, Магистральная ул, дом № 11/13'
        wrapper = ET.Element('Адрес')
        _set_address(wrapper, text, gar={'FiasId': 'incomplete', 'RegionCode': '53'})
        self.assertEqual(wrapper.find('АдрРФ').get('Дом'), '11/13')

    def test_selected_edo_kpp_only(self):
        catalogs = Catalogs()
        catalogs.edo = [{'ИНН': '5321027613', 'КПП': '532101001', 'Идентификатор участника ЭДО': 'selected'}]
        self.assertEqual(catalogs.kpp_for_edo('5321027613', 'selected'), '532101001')
        self.assertEqual(catalogs.kpp_for_edo('5321027613', ''), '')
        generator = Generator(Path(__file__).parent / 'resources', catalogs)
        ctx = {'carrier': {'inn': '5321027613', 'kpp': ''}, 'carrier_edo': 'selected'}
        generator.fill_missing_kpp(ctx)
        self.assertEqual(ctx['carrier']['kpp'], '532101001')
        ctx['carrier']['kpp'] = '123456789'
        generator.fill_missing_kpp(ctx)
        self.assertEqual(ctx['carrier']['kpp'], '123456789')
        catalogs.edo.append({**catalogs.edo[0], 'КПП': '987654321'})
        self.assertEqual(catalogs.kpp_for_edo('5321027613', 'selected'), '')

    def test_contract_parties_are_replaced(self):
        customer = ET.fromstring(
            '<СвЗак><ДогУслПер><ИдРекСост><ИННЮЛ>5047295775</ИННЮЛ></ИдРекСост></ДогУслПер></СвЗак>'
        )
        _set_contract(
            customer,
            {'title': 'Договор', 'number': 'KC&TAGLEX', 'date': '2024-08-01'},
            (TAGLEX['inn'], '7709222373'),
        )
        contract = customer.find('ДогУслПер')
        self.assertEqual(contract.get('НомерДок'), 'KC&TAGLEX')
        self.assertEqual(contract.get('ДатаДок'), '01.08.2024')
        self.assertEqual(
            [item.text for item in contract.findall('ИдРекСост/ИННЮЛ')],
            ['7734515704', '7709222373'],
        )

    def test_cargo_packaging_rules(self):
        self.assertEqual(cargo_packaging({"name": 'ООО "СК Трейд"'}), ("короба", "00"))
        self.assertEqual(cargo_packaging({"name": 'ООО "Другой клиент"'}), ("-", "00"))

    def test_known_reference_fallbacks(self):
        self.assertEqual(known_point_phone({"Название": "Силикатная"}), "+74991879088")
        self.assertEqual(known_point_phone({"Название": "ТК Усады"}), "+74955653350")
        self.assertEqual(party({"Наименование": 'ООО "ТЛК КЕДР"'})["phone"], "+73433790858")
        tander = party({"Наименование": 'АО "ТАНДЕР"'})
        self.assertEqual(tander["inn"], "2310031475")
        self.assertEqual(tander["phone"], "+78612774654")
        self.assertTrue(tander["address"].startswith("350072"))

    def test_forwarding_order_uses_valid_container_structure_and_services(self):
        party_data = {
            "name": 'ООО "Тест"',
            "inn": "7700000000",
            "kpp": "770001001",
            "address": "г. Москва",
        }
        context = {
            "planned_departure_datetime": date(2026, 9, 15),
            "container": "XYZU4002173",
            "weight": "1000",
            "cargo_name": "Груз",
            "shipper": party_data,
            "consignee": party_data,
            "loading": "г. Москва",
            "delivery": "г. Санкт-Петербург",
            "services": ["Организация перевозки", "Погрузочные" + chr(0xDC98) + " работы"],
            "seals": "123456, ABC-7",
            "seal_numbers": ["123456", "ABC-7"],
            "cargo_name": "Абсорбент",
            "order_shipper": {"name": "Shandong Nuoer Biological Technology Co.", "foreign": True},
            "client": party_data,
            "client_edo": "client-edo",
            "client_contract": {"title": "Договор", "number": "1", "date": "2026-09-01"},
            "order_date": "15.09.2026",
            "order_number": "28384",
        }
        xml = ServerGenerator.forwarding_order_userdata([context], "Иванов Иван Иванович")
        self.assertNotIn(chr(0xDC98), xml)
        root = ET.fromstring(xml)
        self.assertEqual(root.findtext(".//CargoNumber"), "1")
        self.assertEqual(root.findtext(".//CargoOriginCountryInfo/Country"), "643")
        container = root.find(".//TransportContainer")
        self.assertEqual(container.get("ContainerOrderNumber"), "1")
        self.assertEqual(container.get("IsContainerProvided"), "1")
        self.assertEqual(container.get("TotalGrossWeight"), "1000")
        self.assertEqual(container.get("SealCount"), "1")
        self.assertEqual(container.findtext("IntContainerId"), "XYZU4002173")
        self.assertEqual(container.findtext("SealNumbers/SealNumber"), "123456")
        self.assertEqual(root.find(".//Shipper/OrganizationDetails").get("OrgType"), "4")
        self.assertEqual(root.find(".//Shipper/OrganizationDetails").get("StatusId"), "LegalEntity")
        self.assertEqual(root.find(".//ItemDescription").get("Name"), "Абсорбент")
        self.assertEqual(root.find(".//ForwarderInfo/OrganizationDetails/Address/RussianAddress").get("OtherInfo"), TAGLEX["address"])
        self.assertEqual(
            [node.get("ServiceName") for node in root.findall(".//LogisticsServiceInfo")],
            ["Организация перевозки", "Погрузочные работы"],
        )
        self.assertIsNotNone(root.find(".//DestinationAddress/CargoDeliveryAddress/Address"))

    def test_forwarding_route_prefers_dedicated_tms_fields(self):
        generator = ServerGenerator(Path(__file__).parent / "resources", Catalogs())
        context = generator.context({
            "_container": "TEST1234567",
            "Клиент": "Тестовый клиент",
            "Исполнитель": "Тестовый перевозчик",
            "Место забора груза (Маршрут)": "Склад отправления",
            "Место доставки груза (Маршрут)": "Склад доставки",
            "Маршрут": "Неверное начало -> Неверный конец",
        }, date(2026, 9, 15), "Тест", None)
        self.assertIn("Склад отправления", context["loading"])
        self.assertIn("Склад доставки", context["delivery"])


if __name__ == '__main__':
    unittest.main()
