import unittest
import xml.etree.ElementTree as ET
from datetime import date
from pathlib import Path

from data_sources import Catalogs
from server_generator import Generator
from xml_generator import AGRL_OBSERVER_EDO_ID


class AgmObserverTests(unittest.TestCase):
    def setUp(self):
        catalogs = Catalogs()
        catalogs.vehicles = [{"Государственный номер": "А123АА77", "Тип владения": "Собственность"}]
        catalogs.companies = [
            {"Наименование": "АГМ", "ИНН": "7817137260", "КПП": "781701001"},
            {"Наименование": "АГС", "ИНН": "7814858496", "КПП": "781401001"},
            {"Наименование": "АГРЛ", "ИНН": "5047295775", "КПП": "770301001"},
            {"Наименование": "Другой клиент", "ИНН": "7700000000", "КПП": "770001001"},
            {"Наименование": "Тестовый перевозчик", "ИНН": "7800000000", "КПП": "780001001"},
        ]
        catalogs.edo = [
            {"ИНН": "7817137260", "КПП": "781701001", "Идентификатор участника ЭДО": "2BM-7817137260-781701001-202406170842309738017"},
            {"ИНН": "7814858496", "КПП": "781401001", "Идентификатор участника ЭДО": "2BM-7814858496-781401001-202512091009276715884"},
            {"ИНН": "5047295775", "КПП": "770301001", "Идентификатор участника ЭДО": AGRL_OBSERVER_EDO_ID},
            {"ИНН": "7700000000", "КПП": "770001001", "Идентификатор участника ЭДО": "2BM-7700000000-770001001-000000000000000000001"},
            {"ИНН": "7800000000", "КПП": "780001001", "Идентификатор участника ЭДО": "2BM-7800000000-780001001-000000000000000000001"},
        ]
        self.generator = Generator(Path(__file__).parent / "resources", catalogs)

    def make_xml(self, client, consignee, contractor=False):
        ctx = self.generator.context({
            "_container": "TEST1234567",
            "Клиент": client,
            "Грузополучатель": consignee,
            "Исполнитель": "Тестовый перевозчик",
            "Номер автомашины": "А123АА77",
        }, date(2026, 9, 17), "Иванов Иван Иванович", None)
        _, content = self.generator.contractor_etrn(ctx) if contractor else self.generator.etrn(ctx)
        return ET.fromstring(content)

    def test_agm_client_has_agrl_observer(self):
        root = self.make_xml("АГМ", "Другой клиент")
        self.assertEqual([node.text for node in root.findall("ИдПолИной")], [AGRL_OBSERVER_EDO_ID])
        self.assertEqual(root[0].tag, "ИдПолИной")

    def test_agm_consignee_has_one_agrl_observer(self):
        root = self.make_xml("Другой клиент", "АГМ")
        self.assertEqual([node.text for node in root.findall("ИдПолИной")], [AGRL_OBSERVER_EDO_ID])

    def test_ags_client_has_agrl_observer(self):
        root = self.make_xml("АГС", "Другой клиент")
        self.assertEqual([node.text for node in root.findall("ИдПолИной")], [AGRL_OBSERVER_EDO_ID])

    def test_ags_consignee_has_agrl_observer(self):
        root = self.make_xml("Другой клиент", "АГС")
        self.assertEqual([node.text for node in root.findall("ИдПолИной")], [AGRL_OBSERVER_EDO_ID])

    def test_agrl_id_is_available_without_catalog_entry(self):
        self.generator.catalogs.edo = [
            row for row in self.generator.catalogs.edo if row["ИНН"] != "5047295775"
        ]
        root = self.make_xml("АГМ", "АГМ")
        self.assertEqual([node.text for node in root.findall("ИдПолИной")], [AGRL_OBSERVER_EDO_ID])

    def test_unrelated_waybill_has_no_observer(self):
        root = self.make_xml("Другой клиент", "Другой клиент")
        self.assertEqual(root.findall("ИдПолИной"), [])
        self.assertEqual(root.find(".//СвГруз/ОпГруз").get("СостГруз"), "Отсутствие повреждений")

    def test_different_client_is_observer(self):
        self.generator.catalogs.companies.append({"Наименование": "Получатель", "ИНН": "7700000001"})
        self.generator.catalogs.edo.append({"ИНН": "7700000001", "Идентификатор участника ЭДО": "recipient-box"})
        root = self.make_xml("Другой клиент", "Получатель")
        self.assertEqual(root.findtext("ИдПолИной"), "2BM-7700000000-770001001-000000000000000000001")
        self.assertEqual(root.get("ИдФайл").rsplit("_", 3)[-3], "1")

    def test_agrl_client_does_not_get_generic_observer(self):
        root = self.make_xml("АГРЛ", "Другой клиент")
        self.assertEqual(root.findall("ИдПолИной"), [])

    def test_contractor_roles_and_observers(self):
        from xml_generator import TAGLEX
        root = self.make_xml("Другой клиент", "Другой клиент", contractor=True)
        info = root.find("Документ/СодИнфГО")
        self.assertEqual(info.find("СвГО//СвЮЛУч").get("ИННЮЛ"), "7800000000")
        self.assertEqual(info.find("СвЗак//СвЮЛУч").get("ИННЮЛ"), TAGLEX["inn"])
        self.assertEqual(len(info.find("СвПер")), 0)
        self.assertEqual(set(n.text for n in root.findall("ИдПолИной")), {TAGLEX["edo"],"2BM-7700000000-770001001-000000000000000000001"})
        self.assertIsNone(info.find("СвЗак/ДогУслПер"))

    def test_contractor_keeps_agm_observer(self):
        root = self.make_xml("АГМ", "Другой клиент", contractor=True)
        self.assertEqual([n.text for n in root.findall("ИдПолИной")],[AGRL_OBSERVER_EDO_ID])


if __name__ == "__main__":
    unittest.main()
