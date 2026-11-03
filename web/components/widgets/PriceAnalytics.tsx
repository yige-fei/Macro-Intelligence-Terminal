"use client";

// AN-1: the Price Analytics section of a chart panel: descriptive figures for the bars of the selected range, from
// lib/analytics.ts. It receives bars already held in memory, and whether it is open is the chart panel's component state, so
// it adds no request, no storage and no saved setting. Every figure carries the provenance of its dataset (simulated or
// user-imported); that line stays pinned while the chart panel scrolls. While it is open, the chart keeps a usable height and the panel scrolls (ChartWidget).

import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { analyzePrices, formatPercent, MIN_RETURNS_FOR_STDEV, MIN_ROWS_FOR_RETURN, type DatedValue, type PriceBar } from "../../lib/analytics";

export type AnalyticsProvenance = "imported" | "simulated";

const PROVENANCE: Record<AnalyticsProvenance, { tag: string; note: string; className: string }> = {
  imported: { tag: "USER-IMPORTED DATA", note: "Calculated from the closes in your file, as supplied. Their source and accuracy are unverified.", className: "text-[#4fc3f7]" },
  simulated: { tag: "SIMULATED DATA", note: "Calculated from simulated bars. These figures are not observed market performance.", className: "amber" },
};

const dated = (d: DatedValue | null) => (d ? `${formatPercent(d.value)} (${d.date})` : "—");

function Row({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <>
      <dt className="dim">{label}</dt>
      <dd data-testid={`analytics-${id}`}>{children}</dd>
    </>
  );
}

export default function PriceAnalytics({ bars, provenance, rangeName, overlay, open, onOpenChange }: {
  bars: readonly PriceBar[]; provenance: AnalyticsProvenance; rangeName: string; overlay: boolean; open: boolean; onOpenChange: (open: boolean) => void;
}) {
  const a = useMemo(() => analyzePrices(bars), [bars]);
  const p = PROVENANCE[provenance];
  const panelRef = useRef<HTMLDetailsElement>(null);
  const wasOpen = useRef(open); // starts true when remounted after a dataset loads, so only a user's opening scrolls
  useEffect(() => {
    if (open && !wasOpen.current) (panelRef.current?.querySelector("dl") ?? panelRef.current)?.scrollIntoView({ block: "nearest" });
    wasOpen.current = open;
  }, [open]);
  return (
    <details ref={panelRef} className="mx-1 mb-1 px-2 pb-0.5 border border-[#262626] text-[10px] leading-tight shrink-0" data-testid="analytics-panel" data-source={provenance} data-status={a.status}
      open={open} onToggle={(e) => onOpenChange(e.currentTarget.open)}>
      <summary className="cursor-pointer sticky top-0 py-0.5 bg-[var(--panel)]" data-testid="analytics-summary">
        <b>PRICE ANALYTICS</b> · <b className={p.className}>{p.tag}</b> <span className="dim">· descriptive only, not a forecast or signal · range {rangeName}</span>
      </summary>
      <div className="mt-1 flex flex-col gap-1">
        {a.status === "empty" && <div className="dim" role="status" data-testid="analytics-empty">No bars in this range, so nothing is calculated.</div>}
        {a.status === "invalid" && <div className="down" role="alert" data-testid="analytics-invalid">Not calculated: {a.reason}. Nothing is repaired or skipped.</div>}
        {a.status === "ok" && (
          <>
            <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-px">
              <Row id="observations" label="Observations (rows)">{a.observations}</Row>
              <Row id="first" label="First date">{a.first}</Row>
              <Row id="last" label="Last date">{a.last}</Row>
              <Row id="returns" label="Close-to-close returns">
                {a.returnCount === 0
                  ? `Insufficient data: a return needs at least ${MIN_ROWS_FOR_RETURN} rows; this sample has ${a.observations}.`
                  : `${a.returnCount} · latest ${dated(a.latestReturn)} · lowest ${dated(a.lowestReturn)} · highest ${dated(a.highestReturn)}`}
              </Row>
              <Row id="cumulative" label="Cumulative price return">
                {a.cumulativeReturn === null
                  ? `Insufficient data: needs at least ${MIN_ROWS_FOR_RETURN} rows; this sample has ${a.observations}.`
                  : `${formatPercent(a.cumulativeReturn)} (last close ÷ first close − 1)`}
              </Row>
              <Row id="stdev" label="Std deviation of returns">
                {a.stdev === null
                  ? `Insufficient data: needs at least ${MIN_RETURNS_FOR_STDEV} returns; this sample has ${a.returnCount}.`
                  : `${formatPercent(a.stdev, false)} per observed return (sample, n−1; not annualised)`}
              </Row>
              <Row id="drawdown" label="Max closing drawdown">
                {a.drawdown === null
                  ? `Insufficient data: needs at least ${MIN_ROWS_FOR_RETURN} rows; this sample has ${a.observations}.`
                  : a.drawdown.peakDate === null
                  ? "0.00%: no close is below an earlier close in this sample"
                  : `${formatPercent(a.drawdown.value)} (peak ${a.drawdown.peakDate}, trough ${a.drawdown.troughDate})`}
              </Row>
              <Row id="largest-gap" label="Largest gap between rows">
                {a.gaps === null
                  ? `Insufficient data: needs at least ${MIN_ROWS_FOR_RETURN} rows; this sample has ${a.observations}.`
                  : `${a.gaps.largestDays} calendar ${a.gaps.largestDays === 1 ? "day" : "days"} (${a.gaps.from} to ${a.gaps.to})`}
              </Row>
            </dl>
            <div className="dim" data-testid="analytics-sample">
              Sample: the selected range ({rangeName}). Zooming or panning the chart does not change it.
            </div>
            <div className="dim" data-testid="analytics-gaps">
              Returns run between consecutive rows and nothing is filled in, so a return across a gap covers all of it and counts once. Holidays, exchange closures and missing observations cannot be distinguished without a verified trading calendar, so a gap does not by itself show that sessions are missing.
            </div>
          </>
        )}
        <div data-testid="analytics-source-note">
          <b className={p.className}>{p.tag}.</b> {p.note}{overlay ? " They do not measure any release event." : ""}
        </div>
        <div className="dim" data-testid="analytics-adjustment">Prices are not adjusted here and may or may not already reflect splits or dividends. An unadjusted split appears as a large return.</div>
        <div className="dim" data-testid="analytics-disclaimer">Arithmetic on this sample only: not a forecast, a trading signal, a recommendation or evidence of an edge.</div>
      </div>
    </details>
  );
}
