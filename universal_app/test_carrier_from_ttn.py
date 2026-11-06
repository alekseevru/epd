import unittest
from datetime import date
from pathlib import Path

from data_sources import Catalogs
from xml_generator import Generator


class CarrierFromTtnTests(unittest.TestCase):
    def setUp(self):
        self.generator = Generator(Path(__file__).parent / "resources", Catalogs())

    def context(self, executor):
        return self.generator.context(
            {
                "_container": "FITU5573421",
                "Клиент": 'ООО "РЕ Трэйдинг"',
                "Исполнитель": executor,
                "Партнер": "R Cube Logistics & Consulting",
            },
            date(2026, 11, 6),
            "Иванов Иван Иванович",
        )

    def test_executor_from_ttn_is_carrier_even_when_partner_differs(self):
        self.assertEqual(self.context('ООО "РУСКОМ"')["carrier"]["name"], 'ООО "РУСКОМ"')

    def test_partner_does_not_replace_missing_executor(self):
        self.assertEqual(self.context("")["carrier"]["name"], "")


if __name__ == "__main__":
    unittest.main()
