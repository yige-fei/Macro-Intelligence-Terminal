"use client";

// MN-1: read-only Official Values tab. Four CPI figures exactly as first published in one archived BLS release, shown only
// when the file is valid and its release agrees with the separately loaded release desk. Otherwise it gives the reason
// and no number, and the Release Schedule tab is unaffected. Its only new request is the fixed same-origin data file, made
// when this tab opens. Figures use neutral text: no market colours, no comparison with expectations, no commentary.

import { useQuery } from "@tanstack/react-query";
import { fmtEastern, fmtSingapore, fmtUtcShort, loadReleaseDesk, periodLabel, type DeskLoad } from "../lib/releaseDesk";
import { humanConfirmed, linkToDesk, loadReleaseObservations, type LaterRelease, type Observation, type ObservationsFile } from "../lib/releaseObservations";

const BLS_TERMS_URL = "https://www.bls.gov/developers/termsOfService.htm";
const BLS_DISCLAIMER = "BLS.gov cannot vouch for the data or analyses derived from these data after the data have been retrieved from BLS.gov.";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const longMonth = (period: string) => `${MONTHS[Number(period.slice(5, 7)) - 1]} ${period.slice(0, 4)}`;
const longDay = (date: string) => `${Number(date.slice(8))} ${longMonth(date)}`;
const shortMonth = (period: string) => periodLabel({ kind: "month", period });

const ROW: Record<Observation["seasonal_adjustment"], { basis: string; mark: string }> = {
  SEASONALLY_ADJUSTED: { basis: "Seasonally adjusted", mark: "*" },
  NOT_SEASONALLY_ADJUSTED: { basis: "Not seasonally adjusted", mark: "†" },
};

function daysAgo(utc: string, nowMs: number): string {
  const days = Math.floor((nowMs - Date.parse(utc)) / 86_400_000);
  return days <= 0 ? "today" : days === 1 ? "1 day ago" : `${days} days ago`;
}

function Link({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="underline decoration-dotted hover:text-[var(--amber)]">
      {children}
    </a>
  );
}

function State({ state, title, children }: { state: string; title: string; children: React.ReactNode }) {
  return (
    <div className="note text-[12px]" role={state === "none" ? "status" : "alert"} data-testid="values-state" data-state={state}>
      <b className={state === "none" ? "amber" : "text-[var(--down)]"}>{title}</b> {children} The Release Schedule tab is not affected.
    </div>
  );
}

function LaterNotice({ later }: { later: LaterRelease }) {
  const month = (id: string) => shortMonth(id.slice(-7));
  const when = (utc: string | null) => (utc ? `, scheduled for ${fmtEastern(utc)}` : "");
  return (
    <div className="mt-1" data-testid="later-notice" data-later={later.kind}>
      {later.kind === "may_exist" && <b className="amber">A later CPI release may exist; this snapshot does not include it. The release desk lists {month(later.event_id)} CPI{when(later.scheduled_utc)}.</b>}
      {later.kind === "not_due" && <>The release desk&apos;s dated schedule lists {month(later.event_id)} CPI{when(later.scheduled_utc)}. This snapshot will not include it.</>}
      {later.kind === "unknown" && <b className="amber">Whether a later CPI release exists cannot be determined from the release desk; this snapshot would not include one.</b>}
    </div>
  );
}

function Values({ data, desk, nowMs }: { data: ObservationsFile; desk: DeskLoad; nowMs: number }) {
  const view = linkToDesk(data, desk, nowMs);
  if (view.kind === "withheld") return <State state="withheld" title="These figures are withheld.">{view.reason}</State>;
  const r = view.release;
  const notes = [...new Map(view.observations.map((o) => [o.seasonal_adjustment, o.revision_note])).entries()];
  return (
    <div className="flex flex-col gap-3" data-testid="official-values" data-state="shown">
      <div className="border border-[var(--amber)] px-3 py-2 text-[12px]" role="status" data-testid="values-banner">
        <b className="amber">OFFICIAL VALUES · ORIGINAL RELEASE · HISTORICAL SNAPSHOT · NOT LIVE</b>
        <div className="mt-1">
          These four figures are as first published in one archived BLS release. They are not updated, and they are not presented as the current rate of inflation.
          The release schedule&apos;s other events have no figures here.
        </div>
        <LaterNotice later={view.later} />
      </div>
      <section className="terminal-panel !h-auto" aria-label={`${r.indicator}, ${longMonth(r.reference_period.period)}`} data-testid="values-panel">
        <div className="panel-title !cursor-default">
          <span>{r.indicator} · {longMonth(r.reference_period.period)}</span>
          <span className="dim font-normal">{r.publisher_code} · {view.observations.length} figures</span>
        </div>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5 text-[11px] px-3 py-2" data-testid="values-facts">
          <dt className="dim">Reference month</dt>
          <dd data-testid="values-reference">{longMonth(r.reference_period.period)} (the month measured, not the publication date)</dd>
          <dt className="dim">Original release</dt>
          <dd data-testid="values-published">{fmtEastern(r.published.utc)} · {fmtSingapore(r.published.utc)} · official time per the release&apos;s embargo line</dd>
          <dt className="dim">Document</dt>
          <dd data-testid="values-document">{r.document_id} · {r.document_title}</dd>
          <dt className="dim">Official source</dt>
          <dd data-testid="values-source"><Link href={r.document_url}>BLS archived release ↗</Link> · <Link href={r.document_pdf_url}>PDF ↗</Link></dd>
        </dl>
        <div className="overflow-x-auto">
          <table className="data-table" data-testid="values-table">
            <thead>
              <tr>
                <th className="!text-left">Measure (CPI-U, U.S. city average)</th><th className="!text-left">Change</th><th className="!text-left">Period</th><th>Value</th>
                <th className="!text-left">Seasonal basis</th><th className="!text-left">Status</th><th className="!text-left">Location in release</th>
              </tr>
            </thead>
            <tbody>
              {view.observations.map((o) => (
                <tr key={o.observation_id} className="align-top" data-testid="value-row" data-observation={o.observation_id}>
                  <td className="!text-left !whitespace-normal min-w-[140px]">{o.indicator_label}</td>
                  <td className="!text-left" data-testid="value-change">{o.metric === "PERCENT_CHANGE_1M" ? "1-month" : "12-month"}</td>
                  <td className="!text-left" data-testid="value-period">{shortMonth(o.comparison_period.from)} → {shortMonth(o.comparison_period.to)}</td>
                  <td data-testid="value-number"><b className="text-[13px] text-[var(--text)]">{o.value_text}%</b></td>
                  <td className="!text-left" data-testid="value-basis">{ROW[o.seasonal_adjustment].basis}</td>
                  <td className="!text-left" data-testid="value-status">First published{ROW[o.seasonal_adjustment].mark}</td>
                  <td className="!text-left !whitespace-normal min-w-[210px] dim" data-testid="value-location">Table 1 · row “{o.source_location.row}” · column “{o.source_location.column}”</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-3 py-2 text-[11px] flex flex-col gap-0.5" data-testid="values-revision">
          {notes.map(([basis, note]) => <div key={basis}>{ROW[basis].mark} {note}</div>)}
          <div className="dim" data-testid="values-table-name">Full table title: “{view.observations[0].source_location.table}”</div>
        </div>
      </section>
      <section className="terminal-panel !h-auto" aria-label="How to read these figures" data-testid="values-definitions">
        <div className="panel-title !cursor-default"><span>How to read these figures</span></div>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5 text-[11px] px-3 py-2">
          <dt className="dim">1-month change</dt><dd>Percent change from the previous month. Reported here on a seasonally adjusted basis.</dd>
          <dt className="dim">12-month change</dt><dd>Percent change from the same month a year earlier. Reported here before seasonal adjustment. It is not the 1-month figure annualised.</dd>
          <dt className="dim">Seasonally adjusted</dt><dd>BLS has adjusted the data for the usual seasonal pattern.</dd>
          <dt className="dim">Not seasonally adjusted</dt><dd>BLS has made no such adjustment.</dd>
          <dt className="dim">All items less food and energy</dt><dd>BLS&apos;s name for this measure, which is often called “core” inflation.</dd>
        </dl>
      </section>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5 text-[11px] border border-[var(--border)] px-3 py-2" data-testid="values-provenance">
        <dt className="dim">Archived copy retrieved</dt>
        <dd data-testid="values-retrieved">
          {fmtUtcShort(r.retrieved_at_utc)} · {daysAgo(r.retrieved_at_utc, nowMs)} · PDF SHA-256 {r.source_document_sha256.slice(0, 12)}…{" "}
          <span data-testid="values-copy-limit">This copy was retrieved after the original release. Nothing here shows it is byte-identical to the file BLS posted that day; “first published” rests on BLS&apos;s dated archive.</span>
        </dd>
        <dt className="dim">Agent verification</dt>
        <dd data-testid="values-verified">{fmtUtcShort(r.verification.verified_at_utc)} · {daysAgo(r.verification.verified_at_utc, nowMs)}. {r.verification.method} Not continuously checked.</dd>
        <dt className="dim">Human verification</dt>
        <dd data-testid="values-human" data-human={humanConfirmed(r) ? "owner-attested" : "outstanding"}>
          {humanConfirmed(r)
            ? <><b>Project owner attested — {longDay(r.human_verification.attested_on)}.</b> Covers the four figures, BLS source terms, correction notices and this page as rendered. This is the attestation date, not the release date or the time of each check. It is not BLS, auditor, legal or regulatory approval, and it does not cover later corrections.</>
            : <b className="amber">Outstanding. An agent&apos;s check is not a person&apos;s confirmation.</b>}
        </dd>
        <dt className="dim">Release desk link</dt>
        <dd data-testid="values-desk-link">{view.event.event_id} is confirmed in the desk; its reference month, document id and official time match this release.</dd>
        <dt className="dim">Desk&apos;s last page check</dt>
        <dd data-testid="values-desk-age">{fmtUtcShort(view.deskCheckedUtc)}{view.deskCheckedUtc ? ` · ${daysAgo(view.deskCheckedUtc, nowMs)}` : ""}. This shows how old the check is. It says nothing about whether this release was published.</dd>
      </dl>
      <div className="dim text-[11px] flex flex-col gap-1" data-testid="values-footer">
        {r.source_notes.map((n) => <p key={n.location} data-testid="values-source-note">{n.location}, as printed: “{n.text}”</p>)}
        <p className="text-[var(--text)]" data-testid="values-disclaimer">
          “{BLS_DISCLAIMER}” (<Link href={BLS_TERMS_URL}>BLS terms of service ↗</Link>). This project took the release from BLS&apos;s website archive, not through the BLS API.
        </p>
        <p data-testid="values-attribution">
          {data.attribution.join(" · ")}. Copied by this project from the cited release; BLS has not reviewed this page. Not affiliated with or endorsed by BLS.
        </p>
      </div>
    </div>
  );
}

export default function OfficialValues() {
  const obs = useQuery({ queryKey: ["release-observations"], queryFn: loadReleaseObservations, staleTime: Infinity, retry: false });
  const desk = useQuery({ queryKey: ["release-desk"], queryFn: loadReleaseDesk, staleTime: Infinity, retry: false });
  if (obs.isLoading || desk.isLoading) return <div className="dim p-3">Loading local official values…</div>;
  if (!obs.data || obs.data.kind === "invalid")
    return <State state="invalid" title={`The official-values file could not be used (${obs.data?.kind === "invalid" ? obs.data.reason : "unreadable"}).`}>No figure is shown rather than an unverified one.</State>;
  if (obs.data.kind === "none") return <State state="none" title="No official values are included in this build.">No figure is shown.</State>;
  return <Values data={obs.data.data} desk={desk.data ?? { kind: "invalid", reason: "unreadable" }} nowMs={Date.now()} />;
}
