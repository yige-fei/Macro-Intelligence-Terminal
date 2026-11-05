"""MN-1: the official-values file against expectations written here by hand from the release USDL-26-1574 (Table 1, cross-read
with Table A and the narrative). This shares no code with the application, and it pins the transcription rather than
proving it: only reading the official release can do that.
Run: python3 -m unittest tests.test_release_observations"""

import hashlib
import json
import re
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
INTEL = REPO / "web" / "public" / "intel"
PDF = "https://www.bls.gov/news.release/archives/cpi_10142026.pdf"
HTM = "https://www.bls.gov/news.release/archives/cpi_10142026.htm"
TABLE = "Table 1. Consumer Price Index for All Urban Consumers (CPI-U): U.S. city average, by expenditure category, September 2026"
SA_COLUMN = "Seasonally adjusted percent change, Aug. 2026-Sep. 2026"
NSA_COLUMN = "Unadjusted percent change, Sep. 2025-Sep. 2026"

# Observation id suffix, Table 1 row, value as printed, metric, comparison start, seasonal basis, Table 1 column.
EXPECTED = [
    ("CPIU_ALL_ITEMS.PCT_1M_SA", "All items", "0.6", "PERCENT_CHANGE_1M", "2026-08", "SEASONALLY_ADJUSTED", SA_COLUMN),
    ("CPIU_ALL_ITEMS.PCT_12M_NSA", "All items", "3.7", "PERCENT_CHANGE_12M", "2025-09", "NOT_SEASONALLY_ADJUSTED", NSA_COLUMN),
    ("CPIU_LESS_FOOD_ENERGY.PCT_1M_SA", "All items less food and energy", "0.3", "PERCENT_CHANGE_1M", "2026-08", "SEASONALLY_ADJUSTED", SA_COLUMN),
    ("CPIU_LESS_FOOD_ENERGY.PCT_12M_NSA", "All items less food and energy", "2.6", "PERCENT_CHANGE_12M", "2025-09", "NOT_SEASONALLY_ADJUSTED", NSA_COLUMN),
]


class OfficialValues(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = (INTEL / "release_observations.v1.json").read_text(encoding="utf-8")
        cls.doc = json.loads(cls.text)
        cls.release = cls.doc["releases"][0]
        cls.by_id = {o["observation_id"]: o for o in cls.release["observations"]}

    def test_envelope_says_real_and_official(self):
        self.assertEqual(self.doc["contract"], "macro_release_observations")
        self.assertEqual(self.doc["version"], "1.0.0")
        self.assertIs(self.doc["synthetic"], False)
        self.assertEqual(self.doc["data_mode"], "SOURCE_DERIVED")
        self.assertEqual(self.doc["attribution"], ["Source: U.S. Bureau of Labor Statistics"])
        self.assertEqual(len(self.doc["releases"]), 1)

    def test_exactly_the_four_authorized_observations(self):
        want = {f"BLS.CPI.2026-09.{e[0]}" for e in EXPECTED}
        self.assertEqual(set(self.by_id), want)
        self.assertEqual(len(self.release["observations"]), 4)

    def test_values_exactly_as_printed(self):
        for suffix, _, value, *_ in EXPECTED:
            self.assertEqual(self.by_id[f"BLS.CPI.2026-09.{suffix}"]["value_text"], value, suffix)

    def test_less_food_and_energy_monthly_is_the_adjusted_figure(self):
        # The release's unadjusted figure for this row is 0.4; reading the wrong column gives a wrong answer.
        self.assertNotEqual(self.by_id["BLS.CPI.2026-09.CPIU_LESS_FOOD_ENERGY.PCT_1M_SA"]["value_text"], "0.4")

    def test_basis_period_unit_and_location(self):
        for suffix, row, _, metric, start, basis, column in EXPECTED:
            o = self.by_id[f"BLS.CPI.2026-09.{suffix}"]
            self.assertEqual(o["indicator_label"], row, suffix)
            self.assertEqual(o["population"], "All Urban Consumers (CPI-U)", suffix)
            self.assertEqual(o["area"], "U.S. city average", suffix)
            self.assertEqual(o["metric"], metric, suffix)
            self.assertEqual(o["comparison_period"], {"from": start, "to": "2026-09"}, suffix)
            self.assertEqual(o["unit"], "percent", suffix)
            self.assertEqual(o["seasonal_adjustment"], basis, suffix)
            self.assertEqual(o["source_location"], {"table": TABLE, "row": row, "column": column}, suffix)
            self.assertEqual(o["value_status"], "FIRST_PUBLISHED", suffix)
            self.assertEqual(o["availability"], "PUBLISHED", suffix)

    def test_revision_notes_differ_by_basis(self):
        for suffix, _, _, _, _, basis, _ in EXPECTED:
            note = self.by_id[f"BLS.CPI.2026-09.{suffix}"]["revision_note"]
            if basis == "SEASONALLY_ADJUSTED":
                self.assertIn("subject to revision for up to 5 years", note, suffix)
            else:
                self.assertIn("final when issued", note, suffix)

    def test_reference_month_and_publication_time_are_separate_facts(self):
        self.assertEqual(self.release["reference_period"], {"kind": "month", "period": "2026-09"})
        p = self.release["published"]
        self.assertEqual((p["local_date"], p["local_time"], p["time_zone"], p["source_tz_label"]), ("2026-10-14", "08:30", "America/New_York", "ET"))
        self.assertEqual(p["utc"], "2026-10-14T12:30:00Z")  # EDT is UTC-4 in October
        self.assertEqual(p["basis"], "SOURCE_STATED_EMBARGO")
        self.assertEqual(p["excerpt"], "embargoed until 8:30 a.m. (ET) Wednesday, October 14, 2026")

    def test_provenance(self):
        r = self.release
        self.assertEqual(r["release_event_id"], "BLS.CPI.2026-09")
        self.assertEqual((r["publisher_code"], r["publisher_name"]), ("BLS", "U.S. Bureau of Labor Statistics"))
        self.assertEqual((r["document_id"], r["document_url"], r["document_pdf_url"]), ("USDL-26-1574", HTM, PDF))
        self.assertEqual(r["source_document_sha256"], "d2fe7deb0ae83a869a37553c9d3934d3d5be4969cd3ca9763a4881df878bf66a")
        pattern = r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$"
        self.assertRegex(r["retrieved_at_utc"], pattern)
        self.assertRegex(r["verification"]["verified_at_utc"], pattern)
        self.assertLess(r["published"]["utc"], r["retrieved_at_utc"])
        self.assertLessEqual(r["retrieved_at_utc"], r["verification"]["verified_at_utc"])
        self.assertTrue(r["verification"]["method"])

    def test_agent_verification_record_is_intact(self):
        r = self.release
        self.assertEqual(r["retrieved_at_utc"], "2026-11-03T12:21:13Z")
        self.assertEqual(r["retrieval_method"], "AGENT_FETCH_OF_OFFICIAL_ARCHIVE_PDF")
        self.assertEqual(r["verification"], {
            "status": "AGENT_VERIFIED_AGAINST_SOURCE",
            "verified_at_utc": "2026-11-03T16:15:37Z",
            "method": "An AI coding agent read Table 1, Table A and the narrative in the official PDF.",
        })
        self.assertNotIn("No person has confirmed", self.text)

    def test_owner_attestation_is_a_separate_record(self):
        self.assertEqual(self.release["human_verification"], {
            "status": "OWNER_ATTESTED",
            "attested_on": "2026-11-05",
            "reviewer_role": "PROJECT_OWNER",
            "scope": ["M1_NUMERICAL_VALUES", "M2_SOURCE_TERMS", "M3_CORRECTION_NOTICES", "RENDERED_INTERFACE_REVIEW"],
        })

    def test_source_notes_are_verbatim(self):
        notes = [n["text"] for n in self.release["source_notes"]]
        self.assertEqual(notes, ["NOTE: The Oct and Nov 2025 data values are not available due to the 2025 lapse in appropriations.",
                                 "NOTE: The Oct 2025 data values are not available due to the 2025 lapse in appropriations."])

    def test_links_only_the_bls_site_and_never_the_floating_page(self):
        self.assertEqual(set(re.findall(r"https?://([^/\"]+)", self.text)), {"www.bls.gov"})
        self.assertNotIn("cpi.nr0", self.text)

    def test_carries_nothing_beyond_the_four_figures(self):
        # A decimal anywhere else would be a figure nobody authorized: index levels, other rows, the unadjusted monthly values.
        decimals = set(re.findall(r"\"-?\d+\.\d+\"", self.text))
        self.assertEqual(decimals, {'"0.6"', '"3.7"', '"0.3"', '"2.6"'})

    def test_release_desk_is_untouched(self):
        body = (INTEL / "release_desk.v1.json").read_bytes()
        self.assertEqual(hashlib.sha256(body).hexdigest(), "e97eead882680da492b0e0adb8c4f3c840df752eff944f134a186e465bd18c35")
        desk = json.loads(body)
        self.assertEqual(desk["values_policy"], "NO_ECONOMIC_VALUES")
        event = next(e for e in desk["events"] if e["event_id"] == "BLS.CPI.2026-09")
        self.assertEqual(event["publication"]["status"], "CONFIRMED")
        self.assertEqual(event["publication"]["evidence"][0]["document_id"], "USDL-26-1574")

    def test_only_this_file_holds_official_values(self):
        names = sorted(p.name for p in INTEL.iterdir())
        self.assertEqual(names, ["release_desk.v1.json", "release_desk_r2_manifest.json", "release_observations.v1.json"])
        self.assertFalse(list((REPO / "demo-data").glob("*observation*")))


if __name__ == "__main__":
    unittest.main()
