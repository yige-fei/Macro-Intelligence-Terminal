"""Independent oracle for web/lib/analytics.ts: recomputes every expected value from the fictional fixture files in exact
rational arithmetic (Python fractions), sharing no code with the implementation, and compares with the committed
tests/fixtures/analytics/expected.json. The Node and browser tests compare the implementation with the same file.
Run: python3 -m unittest discover -s tests     Rewrite the file, after reviewing a deliberate change: python3 tests/test_analytics_oracle.py --write"""

import csv
import datetime
import json
import math
import sys
import unittest
from fractions import Fraction
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
FIX = REPO / "tests" / "fixtures"
EXPECTED = FIX / "analytics" / "expected.json"
SOURCES = sorted(FIX.joinpath("analytics").glob("*.csv")) + [FIX / "import" / "valid_daily_250.csv", FIX / "import" / "short_15.csv"]
MIN_RETURNS_FOR_STDEV = 20


def analyse(path):
    with path.open(newline="") as f:
        rows = [(r["date"], Fraction(r["close"])) for r in csv.DictReader(f)]
    dates = [d for d, _ in rows]
    closes = [c for _, c in rows]
    returns = [(dates[i], closes[i] / closes[i - 1] - 1) for i in range(1, len(rows))]
    out = {"observations": len(rows), "first": dates[0], "last": dates[-1], "return_count": len(returns)}
    for key, pick in (("latest", returns[-1:]), ("lowest", [min(returns, key=lambda r: r[1])] if returns else []),
                      ("highest", [max(returns, key=lambda r: r[1])] if returns else [])):
        out[key] = {"date": pick[0][0], "value": float(pick[0][1])} if pick else None
    out["cumulative"] = float(closes[-1] / closes[0] - 1) if len(rows) >= 2 else None
    out["stdev"] = None
    if len(returns) >= MIN_RETURNS_FOR_STDEV:
        values = [v for _, v in returns]
        mean = sum(values) / len(values)
        out["stdev"] = math.sqrt(sum((v - mean) ** 2 for v in values) / (len(values) - 1))
    out["drawdown"] = None
    if len(rows) >= 2:
        worst, peak_date, trough_date = Fraction(0), None, None
        for i, close in enumerate(closes):
            top = max(closes[: i + 1])
            fall = close / top - 1
            if fall < worst:
                worst, peak_date, trough_date = fall, dates[closes.index(top)], dates[i]
        out["drawdown"] = {"value": float(worst), "peak": peak_date, "trough": trough_date}
    days = [datetime.date.fromisoformat(d) for d in dates]
    spans = [((days[i] - days[i - 1]).days, dates[i - 1], dates[i]) for i in range(1, len(days))]
    out["gaps"] = None
    if spans:
        largest = max(spans, key=lambda s: s[0])
        out["gaps"] = {"largest_days": largest[0], "from": largest[1], "to": largest[2]}
    return out


def compute_all():
    return {p.name: analyse(p) for p in SOURCES}


class AnalyticsOracle(unittest.TestCase):
    def assert_close(self, got, want, where):
        if isinstance(want, dict):
            self.assertEqual(sorted(got), sorted(want), where)
            for k in want:
                self.assert_close(got[k], want[k], f"{where}.{k}")
        elif isinstance(want, float):
            self.assertAlmostEqual(got, want, delta=1e-12 * max(1, abs(want)), msg=where)
        else:
            self.assertEqual(got, want, where)

    def test_expected_file_matches_exact_arithmetic(self):
        self.assert_close(compute_all(), json.loads(EXPECTED.read_text()), "expected")

    def test_hand_derived_values(self):
        # Worked by hand, without the oracle or the implementation.
        got = compute_all()
        self.assertEqual(got["constant_21.csv"]["stdev"], 0)
        self.assertEqual(got["doubling_21.csv"]["cumulative"], 2 ** 20 - 1)
        self.assertEqual(got["halving_21.csv"]["drawdown"]["value"], 2 ** -20 - 1)
        self.assertEqual(got["drawdown_recovery.csv"]["drawdown"], {"value": -0.5, "peak": "2025-01-07", "trough": "2025-01-09"})
        self.assertAlmostEqual(got["alternating_21.csv"]["stdev"], math.sqrt(1.0125 / 19), delta=1e-15)
        self.assertIsNone(got["alternating_20.csv"]["stdev"])
        self.assertEqual(got["gap_sessions.csv"]["return_count"], 3)
        self.assertEqual(got["gap_sessions.csv"]["gaps"], {"largest_days": 10, "from": "2025-01-07", "to": "2025-01-17"})

    def test_fixtures_are_fictional_and_valid_shape(self):
        for path in FIX.joinpath("analytics").glob("*.csv"):
            with path.open(newline="") as f:
                for r in csv.DictReader(f):
                    self.assertEqual(r["open"], r["close"], path.name)
                    self.assertEqual(r["high"], r["close"], path.name)
                    self.assertEqual(r["low"], r["close"], path.name)
                    self.assertEqual(r["volume"], "1000", path.name)


if __name__ == "__main__":
    if "--write" in sys.argv:
        EXPECTED.write_text(json.dumps(compute_all(), indent=2, sort_keys=True) + "\n")
    else:
        unittest.main()
