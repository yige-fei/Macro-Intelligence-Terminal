// AN-1: descriptive statistics over a sample of daily closes. Pure and deterministic: no state, clock, randomness, I/O or
// network. Nothing here predicts, scores, ranks or recommends, and nothing is annualised.
//
// Definitions, for a sample of n rows with closes C_1..C_n in date order (docs/IMPORT.md, "Price analytics"):
//  - return:             r_i = C_i / C_(i-1) - 1, for i = 2..n, between consecutive ROWS. A missing session is not filled,
//                        so a return across a gap spans the whole gap and still counts as one return.
//  - cumulative return:  C_n / C_1 - 1. Needs 2 rows. A price return: prices are used as supplied, never adjusted.
//  - standard deviation: sqrt( sum_i (r_i - mean(r))^2 / (m - 1) ), over the m = n - 1 returns (the sample form, m - 1).
//                        Per observed return, not annualised. Needs MIN_RETURNS_FOR_STDEV returns.
//  - maximum drawdown:   min_t ( C_t / max_(s<=t) C_s - 1 ), so 0 or negative, on closes only (highs and lows are not
//                        used). Needs 2 rows. Peak = earliest date of that running maximum; trough = earliest date the
//                        minimum is reached. No close below an earlier close gives 0, with no peak or trough.
//  - largest gap:        the most calendar days between consecutive rows. Descriptive only: without a verified trading
//                        calendar, holidays, exchange closures and missing observations cannot be told apart, so a gap
//                        is never classified, interpreted or filled.
//
// The input is expected to be validated already (lib/importData.ts, or the generator's validator for simulated bars).
// Anything else is refused as a whole, never repaired or skipped.

import type { Candle } from "./api";

/** Provisional UX calculation guard, NOT a validated statistical threshold. */
export const MIN_RETURNS_FOR_STDEV = 20;
export const MIN_ROWS_FOR_RETURN = 2;

export type PriceBar = Pick<Candle, "date" | "close">;
export type DatedValue = { date: string; value: number };
export type Drawdown = { value: number; peakDate: string | null; troughDate: string | null };
export type GapSummary = { largestDays: number; from: string; to: string };
export type PriceAnalytics =
  | { status: "empty" }
  | { status: "invalid"; reason: string }
  | {
      status: "ok";
      observations: number;
      first: string;
      last: string;
      returnCount: number;
      latestReturn: DatedValue | null;
      lowestReturn: DatedValue | null;
      highestReturn: DatedValue | null;
      cumulativeReturn: number | null;
      stdev: number | null;
      drawdown: Drawdown | null;
      gaps: GapSummary | null;
    };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;
/** UTC-midnight milliseconds of a real calendar date, or null. */
function dayMs(date: string): number | null {
  if (!DATE.test(date)) return null;
  const t = Date.parse(`${date}T00:00:00Z`);
  return Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== date ? null : t;
}

/** r_i = C_i / C_(i-1) - 1, dated by the later row. n rows give n - 1 returns. */
export function simpleReturns(bars: readonly PriceBar[]): DatedValue[] {
  const out: DatedValue[] = [];
  for (let i = 1; i < bars.length; i++) out.push({ date: bars[i].date, value: bars[i].close / bars[i - 1].close - 1 });
  return out;
}

/** Sample standard deviation (divisor m - 1), or null below `minCount` values (never below 2). */
export function sampleStdDev(values: readonly number[], minCount = MIN_RETURNS_FOR_STDEV): number | null {
  const m = values.length;
  if (m < Math.max(minCount, 2)) return null;
  let sum = 0;
  for (const v of values) sum += v;
  const mean = sum / m;
  let squares = 0;
  for (const v of values) squares += (v - mean) * (v - mean);
  return Math.sqrt(squares / (m - 1));
}

/** Largest fall of a close below the highest earlier close, or null below MIN_ROWS_FOR_RETURN rows. */
export function maxClosingDrawdown(bars: readonly PriceBar[]): Drawdown | null {
  if (bars.length < MIN_ROWS_FOR_RETURN) return null;
  let peak = bars[0];
  const worst: Drawdown = { value: 0, peakDate: null, troughDate: null };
  for (const bar of bars) {
    if (bar.close > peak.close) peak = bar;
    const dd = bar.close / peak.close - 1;
    if (dd < worst.value) {
      worst.value = dd;
      worst.peakDate = peak.date;
      worst.troughDate = bar.date;
    }
  }
  return worst;
}

export function analyzePrices(bars: readonly PriceBar[]): PriceAnalytics {
  if (bars.length === 0) return { status: "empty" };
  let largestGap = 0, gapFrom = "", gapTo = "";
  let prevDay: number | null = null;
  for (let i = 0; i < bars.length; i++) {
    const { date, close } = bars[i];
    const day = typeof date === "string" ? dayMs(date) : null;
    if (day === null) return { status: "invalid", reason: `row ${i + 1} does not have a real YYYY-MM-DD date` };
    if (typeof close !== "number" || !Number.isFinite(close) || close <= 0) return { status: "invalid", reason: `row ${i + 1} (${date}) does not have a positive finite close` };
    if (prevDay !== null) {
      const days = Math.round((day - prevDay) / DAY_MS);
      if (days <= 0) return { status: "invalid", reason: `row ${i + 1} (${date}) is not later than the row before it` };
      if (days > largestGap) { largestGap = days; gapFrom = bars[i - 1].date; gapTo = date; }
    }
    prevDay = day;
  }
  const returns = simpleReturns(bars);
  let lowest: DatedValue | null = null;
  let highest: DatedValue | null = null;
  for (const r of returns) {
    if (!lowest || r.value < lowest.value) lowest = r;
    if (!highest || r.value > highest.value) highest = r;
  }
  return {
    status: "ok",
    observations: bars.length,
    first: bars[0].date,
    last: bars[bars.length - 1].date,
    returnCount: returns.length,
    latestReturn: returns.at(-1) ?? null,
    lowestReturn: lowest,
    highestReturn: highest,
    cumulativeReturn: bars.length >= MIN_ROWS_FOR_RETURN ? bars[bars.length - 1].close / bars[0].close - 1 : null,
    stdev: sampleStdDev(returns.map((r) => r.value)),
    drawdown: maxClosingDrawdown(bars),
    gaps: bars.length >= 2 ? { largestDays: largestGap, from: gapFrom, to: gapTo } : null,
  };
}

/** A fraction as a percentage with two decimals: 0.0123 -> "+1.23%", -0.5 -> "−50.00%". Anything rounding to zero is "0.00%". */
export function formatPercent(fraction: number, signed = true): string {
  const body = Math.abs(fraction * 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (body === "0.00") return "0.00%";
  return `${fraction < 0 ? "−" : signed ? "+" : ""}${body}%`;
}
