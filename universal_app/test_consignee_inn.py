import unittest
from datetime import date
from pathlib import Path

from data_sources import Catalogs
from xml_generator import Generator


class ConsigneeInnTests(unittest.TestCase):
    def test_tms_inn_disambiguates_namesake_and_selects_edo_id(self):
        catalogs = Catalogs()
        catalogs.companies = [
            {"Наименование": "ООО КАСКАД", "ИНН": "2508114805", "КПП": "250801001"},
            {"Наименование": "ООО КАСКАД", "ИНН": "5020062220", "КПП": "502001001"},
        ]
        catalogs.edo = [{"ИНН": "5020062220", "КПП": "502001001", "Идентификатор участника ЭДО": "2BM-5020062220-502001001-201603100118565286574"}]
        self.assertIsNone(catalogs.company("ООО КАСКАД"))
        generator = Generator(Path(__file__).parent / "resources", catalogs)
        ctx = generator.context({
            "_container": "CIMU3116618",
            "Грузополучатель": "ООО КАСКАД",
            "ИНН грузополучателя": "5020062220",
            "КПП грузополучателя": "502001001",
        }, date(2026, 9, 29), "", None)
        self.assertEqual(ctx["consignee"]["inn"], "5020062220")
        self.assertEqual(ctx["consignee_edo"], "2BM-5020062220-502001001-201603100118565286574")


if __name__ == "__main__":
    unittest.main()
