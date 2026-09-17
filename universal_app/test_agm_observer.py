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

    def make_xml(self, client, consignee):
        ctx = self.generator.context({
            "_container": "FITU5701625",
            "Клиент": client,
            "Грузополучатель": consignee,
            "Исполнитель": "Тестовый перевозчик",
            "Номер автомашины": "А123АА77",
        }, date(2026, 9, 17), "Иванов Иван Иванович", None)
        _, content = self.generator.etrn(ctx)
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


if __name__ == "__main__":
    unittest.main()
