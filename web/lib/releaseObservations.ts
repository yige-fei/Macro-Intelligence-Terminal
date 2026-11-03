// MN-1: read-only loader, validator and desk link for the first official numerical release. Reads exactly one fixed
// same-origin file, ./intel/release_observations.v1.json, kept apart from the release desk (whose export stays
// NO_ECONOMIC_VALUES). Pure apart from that one request: nothing here calculates a figure, calls a provider or writes
// browser storage. A figure is shown only if the whole file is valid and its release agrees with the desk; otherwise the
// reason is shown and no number. The approved definitions are here; the values themselves are pinned by the tests.

import type { DeskEvent, DeskLoad } from "./releaseDesk";

export const RELEASE_OBSERVATIONS_PATH = "./intel/release_observations.v1.json";

export type Seasonal = "SEASONALLY_ADJUSTED" | "NOT_SEASONALLY_ADJUSTED";
export type Metric = "PERCENT_CHANGE_1M" | "PERCENT_CHANGE_12M";
export type Observation = {
  observation_id: string; indicator_label: string; population: string; area: string; metric: Metric;
  comparison_period: { from: string; to: string }; availability: "PUBLISHED"; value_text: string; unit: "percent";
  seasonal_adjustment: Seasonal; source_location: { table: string; row: string; column: string };
  value_status: "FIRST_PUBLISHED"; revision_note: string;
};
export type ObservationRelease = {
  release_event_id: string; publisher_code: "BLS"; publisher_name: string; indicator: string;
  document_id: string; document_title: string; document_url: string; document_pdf_url: string;
  published: { local_date: string; local_time: string; time_zone: string; source_tz_label: string; utc: string; basis: "SOURCE_STATED_EMBARGO"; excerpt: string };
  reference_period: { kind: "month"; period: string }; source_notes: Array<{ text: string; location: string }>;
  source_document_sha256: string; retrieved_at_utc: string; retrieval_method: string;
  verification: { status: string; verified_at_utc: string; method: string }; observations: Observation[];
};
export type ObservationsFile = {
  contract: "macro_release_observations"; version: string; data_mode: "SOURCE_DERIVED"; synthetic: false; values_policy: string;
  prepared_at_utc: string; attribution: string[]; releases: ObservationRelease[];
};
export type ObservationsLoad = { kind: "none" } | { kind: "ok"; data: ObservationsFile } | { kind: "invalid"; reason: string };

// ------------------------------------------------------------------------------------------- approved slice
// Exactly one release and four figures. Any other event, document, metric or location is refused, never interpreted.

const EXPECTED = {
  event_id: "BLS.CPI.2026-09", family: "BLS_CPI", publisher_code: "BLS", publisher_name: "U.S. Bureau of Labor Statistics",
  indicator: "Consumer Price Index", document_id: "USDL-26-1574", document_title: "CONSUMER PRICE INDEX – SEPTEMBER 2026",
  document_url: "https://www.bls.gov/news.release/archives/cpi_10142026.htm", document_pdf_url: "https://www.bls.gov/news.release/archives/cpi_10142026.pdf",
  period: "2026-09", local_date: "2026-10-14", local_time: "08:30", time_zone: "America/New_York", source_tz_label: "ET", utc: "2026-10-14T12:30:00Z",
  excerpt: "embargoed until 8:30 a.m. (ET) Wednesday, October 14, 2026",
};
const TABLE_1 = "Table 1. Consumer Price Index for All Urban Consumers (CPI-U): U.S. city average, by expenditure category, September 2026";
const COLUMN: Record<Metric, string> = {
  PERCENT_CHANGE_1M: "Seasonally adjusted percent change, Aug. 2026-Sep. 2026",
  PERCENT_CHANGE_12M: "Unadjusted percent change, Sep. 2025-Sep. 2026",
};
const FROM: Record<Metric, string> = { PERCENT_CHANGE_1M: "2026-08", PERCENT_CHANGE_12M: "2025-09" };
const BASIS: Record<Metric, Seasonal> = { PERCENT_CHANGE_1M: "SEASONALLY_ADJUSTED", PERCENT_CHANGE_12M: "NOT_SEASONALLY_ADJUSTED" };
const REVISION_NOTE: Record<Seasonal, string> = {
  SEASONALLY_ADJUSTED: "BLS says seasonally adjusted data \"are subject to revision for up to 5 years after their original release\", so its current tables may differ from this figure.",
  NOT_SEASONALLY_ADJUSTED: "BLS's CPI FAQ says CPI-U series \"are final when issued\", apart from any correction it issues.",
};
/** In display order: each measure's 1-month figure, then its 12-month figure. */
export const APPROVED_OBSERVATIONS: ReadonlyArray<{ id: string; label: string; metric: Metric }> = [
  { id: "BLS.CPI.2026-09.CPIU_ALL_ITEMS.PCT_1M_SA", label: "All items", metric: "PERCENT_CHANGE_1M" },
  { id: "BLS.CPI.2026-09.CPIU_ALL_ITEMS.PCT_12M_NSA", label: "All items", metric: "PERCENT_CHANGE_12M" },
  { id: "BLS.CPI.2026-09.CPIU_LESS_FOOD_ENERGY.PCT_1M_SA", label: "All items less food and energy", metric: "PERCENT_CHANGE_1M" },
  { id: "BLS.CPI.2026-09.CPIU_LESS_FOOD_ENERGY.PCT_12M_NSA", label: "All items less food and energy", metric: "PERCENT_CHANGE_12M" },
];
const VERIFIED = new Set(["AGENT_VERIFIED_AGAINST_SOURCE", "MANUALLY_VERIFIED_AGAINST_SOURCE"]);
/** Whether the file records a person's confirmation. Any other status leaves human verification outstanding. */
export const humanConfirmed = (r: { verification: { status: string } }): boolean => r.verification.status === "MANUALLY_VERIFIED_AGAINST_SOURCE";

const VALUE_TEXT = /^-?\d+\.\d$/; // as printed in the release: one decimal place, a string so that it cannot drift through a float
const UTC_SECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const SHA256 = /^[0-9a-f]{64}$/;

type Rec = Record<string, unknown>;
const isRec = (x: unknown): x is Rec => typeof x === "object" && x !== null && !Array.isArray(x);
const isText = (x: unknown): x is string => typeof x === "string" && x.trim().length > 0;
const isUtc = (x: unknown): x is string => typeof x === "string" && UTC_SECONDS.test(x) && !Number.isNaN(Date.parse(x));
/** The first key that is missing or not part of the contract, or null. */
function keyProblem(o: Rec, keys: readonly string[]): string | null {
  const missing = keys.find((k) => !(k in o));
  if (missing) return `missing field ${missing}`;
  const unknown = Object.keys(o).find((k) => !keys.includes(k));
  return unknown ? `unknown field ${unknown}` : null;
}
const same = (o: unknown, want: Rec) => isRec(o) && Object.keys(want).every((k) => o[k] === want[k]);

function observationProblem(o: unknown, spec: (typeof APPROVED_OBSERVATIONS)[number]): string | null {
  if (!isRec(o)) return "not an object";
  const keys = keyProblem(o, ["observation_id", "indicator_label", "population", "area", "metric", "comparison_period", "availability", "value_text", "unit", "seasonal_adjustment", "source_location", "value_status", "revision_note"]);
  if (keys) return keys;
  if (o.indicator_label !== spec.label) return "wrong indicator label";
  if (o.population !== "All Urban Consumers (CPI-U)" || o.area !== "U.S. city average") return "wrong population or area";
  if (o.metric !== spec.metric) return "wrong metric";
  if (!isRec(o.comparison_period) || keyProblem(o.comparison_period, ["from", "to"]) || !same(o.comparison_period, { from: FROM[spec.metric], to: EXPECTED.period })) return "wrong comparison period";
  if (o.availability !== "PUBLISHED") return "unsupported availability";
  if (typeof o.value_text !== "string" || !VALUE_TEXT.test(o.value_text)) return "value is not a decimal as printed";
  if (o.unit !== "percent") return "wrong unit";
  if (o.seasonal_adjustment !== BASIS[spec.metric]) return "wrong seasonal adjustment";
  if (!isRec(o.source_location) || keyProblem(o.source_location, ["table", "row", "column"]) || !same(o.source_location, { table: TABLE_1, row: spec.label, column: COLUMN[spec.metric] })) return "wrong source table, row or column";
  if (o.value_status !== "FIRST_PUBLISHED") return "unsupported value status";
  if (o.revision_note !== REVISION_NOTE[BASIS[spec.metric]]) return "wrong revision note";
  return null;
}

function releaseProblem(r: unknown): string | null {
  if (!isRec(r)) return "release is not an object";
  const keys = keyProblem(r, ["release_event_id", "publisher_code", "publisher_name", "indicator", "document_id", "document_title", "document_url", "document_pdf_url", "published", "reference_period", "source_notes", "source_document_sha256", "retrieved_at_utc", "retrieval_method", "verification", "observations"]);
  if (keys) return keys;
  if (r.release_event_id !== EXPECTED.event_id) return `unsupported release ${String(r.release_event_id)}`;
  if (r.publisher_code !== EXPECTED.publisher_code || r.publisher_name !== EXPECTED.publisher_name || r.indicator !== EXPECTED.indicator) return "wrong publisher or indicator";
  if (r.document_id !== EXPECTED.document_id || r.document_title !== EXPECTED.document_title) return "wrong document";
  if (r.document_url !== EXPECTED.document_url || r.document_pdf_url !== EXPECTED.document_pdf_url) return "source URL is not the approved BLS archive";
  const pub = r.published;
  if (!isRec(pub) || keyProblem(pub, ["local_date", "local_time", "time_zone", "source_tz_label", "utc", "basis", "excerpt"])
    || !same(pub, { local_date: EXPECTED.local_date, local_time: EXPECTED.local_time, time_zone: EXPECTED.time_zone, source_tz_label: EXPECTED.source_tz_label, utc: EXPECTED.utc, basis: "SOURCE_STATED_EMBARGO", excerpt: EXPECTED.excerpt })) return "wrong publication date or time";
  if (!isRec(r.reference_period) || keyProblem(r.reference_period, ["kind", "period"]) || !same(r.reference_period, { kind: "month", period: EXPECTED.period })) return "wrong reference period";
  if (!Array.isArray(r.source_notes) || r.source_notes.some((n) => !isRec(n) || keyProblem(n, ["text", "location"]) || !isText(n.text) || !isText(n.location))) return "malformed source notes";
  if (typeof r.source_document_sha256 !== "string" || !SHA256.test(r.source_document_sha256)) return "malformed source document hash";
  if (!isUtc(r.retrieved_at_utc) || Date.parse(r.retrieved_at_utc) < Date.parse(EXPECTED.utc)) return "retrieval time is missing or before publication";
  if (!isText(r.retrieval_method)) return "missing retrieval method";
  const v = r.verification;
  if (!isRec(v) || keyProblem(v, ["status", "verified_at_utc", "method"]) || !VERIFIED.has(String(v.status)) || !isText(v.method)) return "not verified against the source";
  if (!isUtc(v.verified_at_utc) || Date.parse(v.verified_at_utc) < Date.parse(r.retrieved_at_utc)) return "verification time is missing or before retrieval";
  const obs = r.observations;
  if (!Array.isArray(obs)) return "observations missing";
  const ids = obs.map((o) => (isRec(o) ? o.observation_id : undefined));
  if (new Set(ids).size !== ids.length) return "duplicate observation id";
  if (obs.length !== APPROVED_OBSERVATIONS.length) return `expected ${APPROVED_OBSERVATIONS.length} observations, found ${obs.length}`;
  for (const spec of APPROVED_OBSERVATIONS) {
    const found = obs.find((o) => isRec(o) && o.observation_id === spec.id);
    if (!found) return `missing or unsupported observation ${spec.id}`;
    const problem = observationProblem(found, spec);
    if (problem) return `${spec.id}: ${problem}`;
  }
  return null;
}

/** Any fault refuses the whole file, so a partial set can't mislead. */
export function parseObservations(raw: unknown): ObservationsLoad {
  const invalid = (reason: string): ObservationsLoad => ({ kind: "invalid", reason });
  if (!isRec(raw)) return invalid("not an object");
  const keys = keyProblem(raw, ["contract", "version", "data_mode", "synthetic", "values_policy", "prepared_at_utc", "attribution", "releases"]);
  if (keys) return invalid(keys);
  if (raw.contract !== "macro_release_observations" || typeof raw.version !== "string" || !/^1\./.test(raw.version)) return invalid("unexpected contract or version");
  if (raw.data_mode !== "SOURCE_DERIVED" || raw.synthetic !== false) return invalid("not marked as source-derived, non-synthetic data");
  if (raw.values_policy !== "OFFICIAL_VALUES_FROM_CITED_RELEASE") return invalid("unexpected values policy");
  if (!isUtc(raw.prepared_at_utc)) return invalid("malformed preparation time");
  if (!Array.isArray(raw.attribution) || !raw.attribution.includes("Source: U.S. Bureau of Labor Statistics")) return invalid("missing BLS attribution");
  if (!Array.isArray(raw.releases) || raw.releases.length !== 1) return invalid("expected exactly one release");
  const problem = releaseProblem(raw.releases[0]);
  return problem ? invalid(problem) : { kind: "ok", data: raw as ObservationsFile };
}

/** Missing file -> "none". Anything malformed -> "invalid". This request is made only when the tab is opened. */
export async function loadReleaseObservations(): Promise<ObservationsLoad> {
  let res: Response;
  try {
    res = await fetch(RELEASE_OBSERVATIONS_PATH, { cache: "no-store" });
  } catch {
    return { kind: "none" };
  }
  if (res.status === 404) return { kind: "none" };
  if (!res.ok) return { kind: "invalid", reason: `HTTP ${res.status}` };
  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    return { kind: "invalid", reason: "not JSON" };
  }
  return parseObservations(raw);
}

// ------------------------------------------------------------------------------------------- desk link

export type LaterRelease =
  | { kind: "may_exist"; event_id: string; scheduled_utc: string | null }
  | { kind: "not_due"; event_id: string; scheduled_utc: string }
  | { kind: "unknown" };
export type ValuesView =
  | { kind: "shown"; release: ObservationRelease; observations: Observation[]; event: DeskEvent; later: LaterRelease; deskCheckedUtc: string | null }
  | { kind: "withheld"; reason: string };

const NOT_EVIDENCE = "This does not mean the release was not published.";

/** Whether this snapshot can still be the most recent. A first-published figure doesn't go stale, but that status does. */
export function laterRelease(events: readonly DeskEvent[], nowMs: number): LaterRelease {
  const later = events.filter((e) => e.family === EXPECTED.family && e.reference_period.period > EXPECTED.period)
    .sort((a, b) => a.reference_period.period.localeCompare(b.reference_period.period));
  if (later.length === 0) return { kind: "unknown" };
  const passed = later.find((e) => e.desk_status === "CONFIRMED" || e.publication.status === "CONFIRMED" || e.publication.status === "DUE_UNCONFIRMED"
    || (!!e.schedule.current?.utc && Date.parse(e.schedule.current.utc) <= nowMs));
  if (passed) return { kind: "may_exist", event_id: passed.event_id, scheduled_utc: passed.schedule.current?.utc ?? null };
  const next = later[0];
  return next.schedule.current?.utc && next.conflicts.every((c) => c.resolved) ? { kind: "not_due", event_id: next.event_id, scheduled_utc: next.schedule.current.utc } : { kind: "unknown" };
}

/** Why the desk and the release can't be reconciled, or null. Neither source wins a disagreement. */
function deskProblem(e: DeskEvent, r: ObservationRelease): string | null {
  const o = e.publication?.official_release_time;
  const doc = e.publication?.evidence?.find((x) => x.kind === "NEWS_RELEASE_EMBARGO_LINE")?.document_id;
  if (e.synthetic) return "The desk record is marked synthetic.";
  if (e.conflicts?.some((c) => !c.resolved)) return `The desk records an unresolved conflict on this release. ${NOT_EVIDENCE}`;
  if (e.desk_status !== "CONFIRMED" || e.publication?.status !== "CONFIRMED") return `The desk does not record this release as confirmed (status ${e.desk_status}). ${NOT_EVIDENCE}`;
  if (e.publication.verification?.state !== "MATCHED" || e.publication.verification?.page_event_id !== r.release_event_id) return `The desk's page check does not match this release. ${NOT_EVIDENCE}`;
  if (e.family !== EXPECTED.family || e.authority_code !== r.publisher_code) return "The desk's release family or publisher differs from this file's.";
  if (e.reference_period?.period !== r.reference_period.period || e.reference_period?.kind !== r.reference_period.kind) return `Reference period differs: desk ${e.reference_period?.period}, this file ${r.reference_period.period}.`;
  if (doc !== r.document_id) return `Document id differs: desk ${doc ?? "none"}, this file ${r.document_id}.`;
  if (o?.utc !== r.published.utc) return `Official time differs: desk ${o?.utc ?? "none"}, this file ${r.published.utc}.`;
  if (o?.local_date !== r.published.local_date || o?.local_time !== r.published.local_time) return `Official date or time differs: desk ${o?.local_date ?? "none"} ${o?.local_time ?? ""}, this file ${r.published.local_date} ${r.published.local_time}.`;
  return null;
}

/** `nowMs` affects only the notice about later releases, never whether a figure is shown. */
export function linkToDesk(data: ObservationsFile, desk: DeskLoad, nowMs: number): ValuesView {
  const r = data.releases[0];
  if (desk.kind === "none") return { kind: "withheld", reason: `The release-desk export is not available, so publication can't be confirmed. ${NOT_EVIDENCE}` };
  if (desk.kind === "invalid") return { kind: "withheld", reason: `The release-desk export could not be used (${desk.reason}), so publication can't be confirmed. ${NOT_EVIDENCE}` };
  if (desk.data.data_mode !== "SOURCE_DERIVED") return { kind: "withheld", reason: "The release-desk export is synthetic demonstration data, which can't confirm a real release." };
  const matching = desk.data.events.filter((e) => e.event_id === r.release_event_id);
  if (matching.length !== 1) return { kind: "withheld", reason: matching.length === 0 ? `The desk has no event ${r.release_event_id}. ${NOT_EVIDENCE}` : `The desk has more than one event ${r.release_event_id}.` };
  const e = matching[0];
  const problem = deskProblem(e, r);
  if (problem) return { kind: "withheld", reason: problem };
  const observations = APPROVED_OBSERVATIONS.map((s) => r.observations.find((o) => o.observation_id === s.id) as Observation);
  return { kind: "shown", release: r, observations, event: e, later: laterRelease(desk.data.events, nowMs), deskCheckedUtc: e.publication.verification.last_attempt_at_utc };
}
