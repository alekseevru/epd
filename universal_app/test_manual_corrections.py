import unittest

from manual_corrections import prepare_manual_fields
from xml_generator import vehicle_ownership_details


def context(note="", client_phone=""):
    return {
        "container": "MODU0025866", "truck_number": "Х917ХК152",
        "truck_vehicle": {"Тип владения": "Лизинг", "Примечание": note},
        "client": {"inn": "7734515704", "phone": client_phone},
        "consignee": {"inn": "7814858496", "phone": "+78126039299"},
        "driver_name": "Иванов Иван Иванович", "driver_phone": "+79001234567",
        "driver_license": "1234567890", "driver_license_series": "1234", "driver_license_number": "567890",
        "loading_point_found": True, "delivery_point_found": True,
        "loading_owner": {"name": "Терминал", "inn": "7814858496", "phone": "+78126039299"},
    }


class ManualCorrectionsTests(unittest.TestCase):
    def test_saved_values_fill_missing_lease_details(self):
        ctx = context()
        stored = {"vehicle:Х917ХК152": {"contract_number": "б/н", "contract_date": "14.01.2026", "owner_inn": "781133069839"}}
        fields, applied = prepare_manual_fields(ctx, "cargo", stored)
        self.assertEqual([], applied)
        self.assertFalse(any(field["id"].startswith("vehicle.") for field in fields))
        details = vehicle_ownership_details(ctx["truck_vehicle"])
        self.assertEqual(("4", "б/н", "14.01.2026", "781133069839"),
                         (details["ownership_code"], details["number"], details["date"], details["owner_inn"]))

    def test_tms_values_override_saved_and_submitted_values(self):
        ctx = context("№TMS-1 от 02.02.2026 ИНН 781133069839", "+79999999999")
        stored = {"vehicle:Х917ХК152": {"contract_number": "old", "contract_date": "14.01.2026", "owner_inn": "1234567890"},
                  "party:7734515704": {"phone": "+78888888888"}}
        fields, applied = prepare_manual_fields(ctx, "cargo", stored, {"vehicle.contract_number": "manual", "client.phone": "+77777777777"})
        self.assertEqual([], applied)
        self.assertEqual("TMS-1", vehicle_ownership_details(ctx["truck_vehicle"])["number"])
        self.assertEqual("+79999999999", ctx["client"]["phone"])
        self.assertFalse(any(field["id"] in {"vehicle.contract_number", "client.phone"} for field in fields))

    def test_partial_tms_contract_uses_saved_inn_only(self):
        ctx = context("№TMS-1 от 02.02.2026")
        stored = {"vehicle:Х917ХК152": {"contract_number": "old", "contract_date": "14.01.2026", "owner_inn": "781133069839"}}
        prepare_manual_fields(ctx, "empty", stored)
        details = vehicle_ownership_details(ctx["truck_vehicle"])
        self.assertEqual(("TMS-1", "02.02.2026", "781133069839"),
                         (details["number"], details["date"], details["owner_inn"]))

    def test_invalid_manual_inn_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "ИНН"):
            prepare_manual_fields(context(), "cargo", submitted={"vehicle.owner_inn": "123"})

    def test_missing_customer_contract_can_be_saved_and_reused(self):
        ctx = context()
        fields, applied = prepare_manual_fields(ctx, "cargo", submitted={"client.contract_number": "17/26", "client.contract_date": "01.09.2026"})
        self.assertFalse(any(field["id"].startswith("client.contract") for field in fields))
        self.assertEqual({"number": "17/26", "date": "2026-09-01"}, ctx["client_contract"])
        self.assertEqual(2, len([entry for entry in applied if entry["scope"].endswith(":client:contract")]))

    def test_tms_customer_contract_has_priority(self):
        ctx = context()
        ctx["client_contract"] = {"number": "TMS", "date": "2026-09-02"}
        fields, applied = prepare_manual_fields(ctx, "cargo", submitted={"client.contract_number": "manual", "client.contract_date": "01.09.2026"})
        self.assertEqual("TMS", ctx["client_contract"]["number"])
        self.assertFalse(any(entry["scope"].endswith(":client:contract") for entry in applied))
        self.assertFalse(any(field["id"].startswith("client.contract") for field in fields))


if __name__ == "__main__":
    unittest.main()
