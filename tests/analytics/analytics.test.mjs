// Unit tests for web/lib/analytics.ts, run directly by Node's test runner:
//   node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON tests/analytics/analytics.test.mjs
// Node >= 22.18 (or 23.6) loads the TypeScript module natively. Expected values are worked out by hand here, or come from
// tests/fixtures/analytics/expected.json, which tests/test_analytics_oracle.py recomputes without this code.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const { analyzePrices, formatPercent, maxClosingDrawdown, sampleStdDev, simpleReturns, MIN_RETURNS_FOR_STDEV } = await import(join(ROOT, "web", "lib", "analytics.ts"));
const { parseImport } = await import(join(ROOT, "web", "lib", "importData.ts"));
const FIX = join(ROOT, "tests", "fixtures");
const EXPECTED = JSON.parse(readFileSync(join(FIX, "analytics", "expected.json"), "utf8"));

/** Goes through the real importer, so every fixture is also shown to be a valid import. */
function load(name) {
  const path = join(FIX, name in { "valid_daily_250.csv": 1, "short_15.csv": 1 } ? "import" : "analytics", name);
  const r = parseImport(name, statSync(path).size, readFileSync(path, "utf8"));
  assert.equal(r.ok, true, `${name} must be a valid import`);
  return r.candles;
}
const near = (got, want, what) => assert.ok(Math.abs(got - want) <= 1e-12 * Math.max(1, Math.abs(want)), `${what}: got ${got}, want ${want}`);
const bars = (...closes) => closes.map((close, i) => ({ date: `2025-03-${String(i + 1).padStart(2, "0")}`, close }));

test("the provisional guard has the approved value", () => {
  assert.equal(MIN_RETURNS_FOR_STDEV, 20);
});

test("constant prices: every statistic is exactly zero", () => {
  const a = analyzePrices(load("constant_21.csv"));
  assert.equal(a.observations, 21);
  assert.equal(a.returnCount, 20);
  assert.equal(a.cumulativeReturn, 0);
  assert.equal(a.stdev, 0);
  assert.deepEqual(a.drawdown, { value: 0, peakDate: null, troughDate: null });
  assert.equal(a.latestReturn.value, 0);
});

test("strictly increasing prices: +100% each step, no drawdown, no dispersion", () => {
  const a = analyzePrices(load("doubling_21.csv"));
  assert.equal(a.cumulativeReturn, 2 ** 20 - 1);
  assert.equal(a.lowestReturn.value, 1);
  assert.equal(a.highestReturn.value, 1);
  assert.equal(a.stdev, 0);
  assert.equal(a.drawdown.value, 0);
  assert.equal(a.drawdown.peakDate, null);
});

test("falling prices: −50% each step; the drawdown spans the whole sample and equals the cumulative return", () => {
  const a = analyzePrices(load("halving_21.csv"));
  assert.equal(a.cumulativeReturn, 2 ** -20 - 1);
  assert.equal(a.drawdown.value, 2 ** -20 - 1);
  assert.equal(a.drawdown.peakDate, a.first);
  assert.equal(a.drawdown.troughDate, a.last);
  assert.equal(a.stdev, 0);
});

test("a drawdown followed by recovery keeps its depth and dates; a smaller later fall does not replace it", () => {
  const a = analyzePrices(load("drawdown_recovery.csv")); // 100, 120, 90, 60, 90, 120, 150
  assert.deepEqual(a.drawdown, { value: -0.5, peakDate: "2025-01-07", troughDate: "2025-01-09" });
  assert.equal(a.cumulativeReturn, 0.5);
  assert.equal(a.stdev, null, "6 returns are below the guard");
  assert.deepEqual(maxClosingDrawdown(bars(100, 50, 200, 150)), { value: -0.5, peakDate: "2025-03-01", troughDate: "2025-03-02" });
  assert.deepEqual(maxClosingDrawdown(bars(100, 90, 200, 100)), { value: -0.5, peakDate: "2025-03-03", troughDate: "2025-03-04" }, "a later, deeper fall from a higher peak replaces it");
  assert.equal(maxClosingDrawdown(bars(100, 50, 100, 50)).troughDate, "2025-03-02", "ties keep the earliest trough");
  assert.equal(maxClosingDrawdown(bars(100, 100, 50)).peakDate, "2025-03-01", "a repeated peak keeps its earliest date");
});

test("exactly 20 returns: the deviation is calculated (hand-derived value)", () => {
  // +25% and −20%, ten of each: mean 0.025, deviations ±0.225, squares sum to 20 × 0.050625 = 1.0125, divisor 19.
  const a = analyzePrices(load("alternating_21.csv"));
  assert.equal(a.returnCount, 20);
  near(a.stdev, Math.sqrt(1.0125 / 19), "stdev");
  assert.equal(a.stdev.toFixed(6), "0.230845");
  assert.notEqual(a.stdev.toFixed(6), Math.sqrt(1.0125 / 20).toFixed(6), "the population divisor would differ");
});

test("fewer than 20 returns: the deviation is withheld, the other statistics are not", () => {
  const a = analyzePrices(load("alternating_20.csv"));
  assert.equal(a.returnCount, 19);
  assert.equal(a.stdev, null);
  assert.equal(a.cumulativeReturn, 0.25);
  near(a.drawdown.value, -0.2, "drawdown"); // 100 / 125 - 1 is not exactly -0.2 in binary floating point
  assert.equal(sampleStdDev([1]), null);
  assert.equal(sampleStdDev([1, 1], 1), 0, "never below 2 values, whatever the guard");
  assert.equal(sampleStdDev([1], 1), null);
});

test("the shortest valid import (1 row): dates and count only, every other statistic withheld", () => {
  const a = analyzePrices(load("single_row.csv"));
  assert.deepEqual(a, { status: "ok", observations: 1, first: "2025-01-06", last: "2025-01-06", returnCount: 0, latestReturn: null, lowestReturn: null, highestReturn: null,
    cumulativeReturn: null, stdev: null, drawdown: null, gaps: null });
});

test("two rows: the shortest sample with a return and a drawdown", () => {
  const a = analyzePrices(load("two_rows.csv"));
  assert.equal(a.returnCount, 1);
  near(a.cumulativeReturn, 0.1, "cumulative");
  assert.equal(a.drawdown.value, 0);
  assert.equal(a.stdev, null);
});

test("missing trading sessions: no bar is fabricated; the return spans the gap and the gap is reported", () => {
  const candles = load("gap_sessions.csv"); // 2025-01-06, 07, 17, 20; closes 100, 110, 99, 99
  const a = analyzePrices(candles);
  assert.equal(a.observations, 4);
  assert.equal(a.returnCount, 3);
  const r = simpleReturns(candles);
  assert.deepEqual(r.map((x) => x.date), ["2025-01-07", "2025-01-17", "2025-01-20"]);
  near(r[0].value, 0.1, "first");
  near(r[1].value, -0.1, "across the gap");
  assert.equal(r[2].value, 0);
  assert.deepEqual(a.gaps, { largestDays: 10, from: "2025-01-07", to: "2025-01-17" });
});

test("the largest gap is plain calendar arithmetic, with no classification of its length", () => {
  const gaps = (...dates) => analyzePrices(dates.map((date) => ({ date, close: 100 }))).gaps;
  assert.deepEqual(gaps("2025-02-28", "2025-03-03"), { largestDays: 3, from: "2025-02-28", to: "2025-03-03" }, "across a month end");
  assert.equal(gaps("2024-02-28", "2024-03-01").largestDays, 2, "leap day");
  assert.equal(gaps("2025-12-31", "2026-01-02").largestDays, 2, "across a year end");
  assert.deepEqual(gaps("2025-01-02", "2025-01-12", "2025-01-22"), { largestDays: 10, from: "2025-01-02", to: "2025-01-12" }, "ties keep the earliest");
});

test("every fixture matches the independent oracle (expected.json)", () => {
  assert.ok(Object.keys(EXPECTED).length >= 11);
  for (const [name, e] of Object.entries(EXPECTED)) {
    const a = analyzePrices(load(name));
    assert.equal(a.status, "ok", name);
    assert.equal(a.observations, e.observations, name);
    assert.equal(a.first, e.first, name);
    assert.equal(a.last, e.last, name);
    assert.equal(a.returnCount, e.return_count, name);
    for (const [got, want, what] of [[a.latestReturn, e.latest, "latest"], [a.lowestReturn, e.lowest, "lowest"], [a.highestReturn, e.highest, "highest"]]) {
      if (want === null) { assert.equal(got, null, `${name} ${what}`); continue; }
      assert.equal(got.date, want.date, `${name} ${what}`);
      near(got.value, want.value, `${name} ${what}`);
    }
    for (const [got, want, what] of [[a.cumulativeReturn, e.cumulative, "cumulative"], [a.stdev, e.stdev, "stdev"]]) {
      if (want === null) assert.equal(got, null, `${name} ${what}`);
      else near(got, want, `${name} ${what}`);
    }
    if (e.drawdown === null) assert.equal(a.drawdown, null, name);
    else {
      near(a.drawdown.value, e.drawdown.value, `${name} drawdown`);
      assert.equal(a.drawdown.peakDate, e.drawdown.peak, name);
      assert.equal(a.drawdown.troughDate, e.drawdown.trough, name);
    }
    if (e.gaps === null) assert.equal(a.gaps, null, name);
    else assert.deepEqual(a.gaps, { largestDays: e.gaps.largest_days, from: e.gaps.from, to: e.gaps.to }, name);
  }
});

test("returns do not depend on the price scale", () => {
  const candles = load("valid_daily_250.csv");
  const a = analyzePrices(candles);
  const b = analyzePrices(candles.map((c) => ({ ...c, close: c.close * 8 })));
  near(b.stdev, a.stdev, "stdev");
  near(b.cumulativeReturn, a.cumulativeReturn, "cumulative");
  near(b.drawdown.value, a.drawdown.value, "drawdown");
});

test("uses the close only: other fields, including adjClose, have no effect", () => {
  const candles = load("valid_daily_250.csv");
  const changed = candles.map((c) => ({ ...c, open: 1, high: 2, low: 0.5, adjClose: 7, volume: 0 }));
  assert.deepEqual(analyzePrices(changed), analyzePrices(candles));
});

test("deterministic and pure: identical results, input not modified", () => {
  const candles = load("drawdown_recovery.csv").map((c) => Object.freeze({ ...c }));
  Object.freeze(candles);
  assert.deepEqual(analyzePrices(candles), analyzePrices(candles));
});

test("unvalidated input is refused as a whole, never repaired or skipped", () => {
  assert.deepEqual(analyzePrices([]), { status: "empty" });
  const cases = [
    [[{ date: "2025-01-02", close: 1 }, { date: "2025-01-02", close: 1 }], /row 2 .* not later/],
    [[{ date: "2025-01-03", close: 1 }, { date: "2025-01-02", close: 1 }], /row 2 .* not later/],
    [[{ date: "2025-02-30", close: 1 }], /row 1 .* real YYYY-MM-DD/],
    [[{ date: "01/02/2025", close: 1 }], /row 1 .* real YYYY-MM-DD/],
    [[{ date: "2025-01-02", close: 0 }], /row 1 .* positive finite/],
    [[{ date: "2025-01-02", close: -1 }], /row 1 .* positive finite/],
    [[{ date: "2025-01-02", close: NaN }], /row 1 .* positive finite/],
    [[{ date: "2025-01-02", close: Infinity }], /row 1 .* positive finite/],
    [[{ date: "2025-01-02", close: "100" }], /row 1 .* positive finite/],
    [[{ date: "2025-01-02", close: 1 }, { date: "2025-01-03", close: null }], /row 2 .* positive finite/],
  ];
  for (const [input, pattern] of cases) {
    const a = analyzePrices(input);
    assert.equal(a.status, "invalid", JSON.stringify(input));
    assert.match(a.reason, pattern);
    assert.deepEqual(Object.keys(a).sort(), ["reason", "status"], "no partial figures");
  }
});

test("the importer's extreme bounds stay finite", () => {
  const a = analyzePrices([{ date: "2025-01-02", close: 1e-6 }, { date: "2025-01-03", close: 1e9 }, { date: "2025-01-06", close: 1e-6 }]);
  assert.ok(Number.isFinite(a.cumulativeReturn) && Number.isFinite(a.highestReturn.value) && Number.isFinite(a.drawdown.value));
  assert.equal(a.cumulativeReturn, 0);
});

test("percent format: two decimals, explicit sign, typographic minus, no negative zero", () => {
  assert.equal(formatPercent(0.0123), "+1.23%");
  assert.equal(formatPercent(-0.5), "−50.00%");
  assert.equal(formatPercent(0), "0.00%");
  assert.equal(formatPercent(-0.00001), "0.00%");
  assert.equal(formatPercent(0.00001), "0.00%");
  assert.equal(formatPercent(0.2308451, false), "23.08%");
  assert.equal(formatPercent(12.5), "+1,250.00%");
});

test("the module and panel contain no network, storage, clock or randomness calls", () => {
  for (const file of ["web/lib/analytics.ts", "web/components/widgets/PriceAnalytics.tsx"]) {
    const src = readFileSync(join(ROOT, file), "utf8").replace(/\/\/.*$/gm, "");
    assert.doesNotMatch(src, /\b(fetch|XMLHttpRequest|WebSocket|sendBeacon|EventSource|localStorage|sessionStorage|indexedDB|document\.cookie|caches|Math\.random|Date\.now|new Date\(\))\b/, file);
    assert.doesNotMatch(src, /\bpersist\b|useQuery|useTerminal|useImported/, file);
  }
});

test("the panel's wording claims no prediction, signal or edge beyond disclaiming them", () => {
  const src = readFileSync(join(ROOT, "web", "components", "widgets", "PriceAnalytics.tsx"), "utf8").replace(/\/\/.*$/gm, "");
  assert.match(src, /not a forecast, a trading signal, a recommendation or evidence of an edge/);
  assert.match(src, /descriptive only, not a forecast or signal/);
  assert.match(src, /Holidays, exchange closures and missing observations cannot be distinguished without a verified trading calendar/);
  const rest = src.replace(/not a forecast, a trading signal, a recommendation or evidence of an edge/, "").replace(/descriptive only, not a forecast or signal/, "");
  assert.doesNotMatch(rest, /\b(buy|sell|signal|predict\w*|forecast\w*|recommend\w*|outperform\w*|alpha|edge|score|rank\w*|regime|annuali[sz]ed value)\b/i);
});
