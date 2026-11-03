// Unit tests for web/lib/releaseObservations.ts, run directly by Node's test runner:
//   node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON tests/observations/observations.test.mjs
// Node >= 22.18 (or 23.6) loads the TypeScript module natively. Negative cases change one thing in a copy of the real file
// or desk, and use "NOT_A_NUMBER" or nulls rather than plausible figures. Exact values are pinned separately, without
// this code, in tests/test_release_observations.py.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const { APPROVED_OBSERVATIONS, humanConfirmed, laterRelease, linkToDesk, parseObservations, loadReleaseObservations } = await import(join(ROOT, "web", "lib", "releaseObservations.ts"));
const INTEL = join(ROOT, "web", "public", "intel");
const read = (f) => JSON.parse(readFileSync(join(INTEL, f), "utf8"));
const FILE = read("release_observations.v1.json");
const DESK = read("release_desk.v1.json");
const clone = (x) => structuredClone(x);
const NOW = Date.parse("2026-11-04T00:00:00Z");
const NEXT_DUE = Date.parse("2026-11-10T13:30:00Z");

/** A copy of the real file after `change`; its parse result. */
const parsed = (change) => { const f = clone(FILE); change(f); return parseObservations(f); };
const rejects = (change, pattern) => { const r = parsed(change); assert.equal(r.kind, "invalid"); assert.match(r.reason, pattern); };
const release = (f) => f.releases[0];
const obs = (f, i = 0) => f.releases[0].observations[i];
/** The real file linked with a copy of the real desk after `change`. */
const linked = (change = () => {}, nowMs = NOW) => {
  const desk = clone(DESK); change(desk, desk.events.find((e) => e.event_id === "BLS.CPI.2026-09"));
  return linkToDesk(FILE, { kind: "ok", data: desk }, nowMs);
};
const withheld = (change, pattern) => { const v = linked(change); assert.equal(v.kind, "withheld"); assert.match(v.reason, pattern); assert.equal(v.observations, undefined); };

test("the shipped file is valid and links to the shipped desk", () => {
  assert.equal(parseObservations(FILE).kind, "ok");
  const v = linked();
  assert.equal(v.kind, "shown");
  assert.deepEqual(v.observations.map((o) => o.observation_id), APPROVED_OBSERVATIONS.map((s) => s.id));
  assert.equal(v.event.event_id, "BLS.CPI.2026-09");
});

test("display order is fixed by the approved list, not the file", () => {
  const f = clone(FILE);
  release(f).observations.reverse();
  assert.equal(parseObservations(f).kind, "ok");
  const v = linkToDesk(f, { kind: "ok", data: DESK }, NOW);
  assert.deepEqual(v.observations.map((o) => o.observation_id), APPROVED_OBSERVATIONS.map((s) => s.id));
});

test("not an object, wrong contract, version or markers: refused", () => {
  for (const raw of [null, [], "x", 1]) assert.equal(parseObservations(raw).kind, "invalid");
  rejects((f) => { f.contract = "release_desk_export"; }, /contract or version/);
  rejects((f) => { f.version = "2.0.0"; }, /contract or version/);
  rejects((f) => { f.synthetic = true; }, /non-synthetic/);
  rejects((f) => { f.data_mode = "SYNTHETIC_DEMO"; }, /non-synthetic/);
  rejects((f) => { f.values_policy = "NO_ECONOMIC_VALUES"; }, /values policy/);
  rejects((f) => { f.attribution = []; }, /attribution/);
});

test("missing and unknown fields: refused", () => {
  rejects((f) => { delete f.prepared_at_utc; }, /missing field prepared_at_utc/);
  rejects((f) => { f.extra = 1; }, /unknown field extra/);
  rejects((f) => { delete release(f).document_id; }, /missing field document_id/);
  rejects((f) => { release(f).extra = 1; }, /unknown field extra/);
  rejects((f) => { delete obs(f).value_text; }, /missing field value_text/);
  rejects((f) => { obs(f).index_level = null; }, /unknown field index_level/);
  rejects((f) => { release(f).published.extra = 1; }, /publication date or time/);
});

test("duplicate, extra, too few or unsupported observations: refused", () => {
  rejects((f) => { release(f).observations[1] = clone(obs(f, 0)); }, /duplicate observation id/);
  rejects((f) => { release(f).observations.pop(); }, /expected 4 observations, found 3/);
  rejects((f) => { release(f).observations.push({ ...clone(obs(f, 0)), observation_id: "BLS.CPI.2026-09.CPIU_FOOD.PCT_1M_SA" }); }, /expected 4 observations, found 5/);
  rejects((f) => { obs(f).observation_id = "BLS.CPI.2026-09.CPIU_FOOD.PCT_1M_SA"; }, /missing or unsupported observation/);
  rejects((f) => { release(f).observations[0] = null; }, /missing or unsupported observation/);
  rejects((f) => { f.releases.push(clone(release(f))); }, /exactly one release/);
  rejects((f) => { f.releases = []; }, /exactly one release/);
});

test("malformed values: refused, and any bad figure refuses the whole file", () => {
  for (const bad of ["NOT_A_NUMBER", "", null, "1", "1.23", "+1.0", " 1.0", 1.5, "1.0%"]) rejects((f) => { obs(f, 2).value_text = bad; }, /value is not a decimal as printed/);
  assert.equal(parsed((f) => { obs(f, 2).value_text = "NOT_A_NUMBER"; }).data, undefined);
});

test("adjustment and basis can't be swapped", () => {
  rejects((f) => { obs(f, 0).seasonal_adjustment = "NOT_SEASONALLY_ADJUSTED"; }, /wrong seasonal adjustment/);
  rejects((f) => { obs(f, 1).seasonal_adjustment = "SEASONALLY_ADJUSTED"; }, /wrong seasonal adjustment/);
  rejects((f) => { obs(f, 0).metric = "PERCENT_CHANGE_12M"; }, /wrong metric/);
  rejects((f) => { obs(f, 0).comparison_period.from = "2025-09"; }, /comparison period/);
  rejects((f) => { obs(f, 1).comparison_period.to = "2026-10"; }, /comparison period/);
  rejects((f) => { obs(f, 0).unit = "index"; }, /wrong unit/);
  rejects((f) => { obs(f, 0).indicator_label = "All items less food and energy"; }, /wrong indicator label/);
  rejects((f) => { obs(f, 0).revision_note = obs(f, 1).revision_note; }, /wrong revision note/);
});

test("source table, row and column are required exactly", () => {
  rejects((f) => { obs(f).source_location.table = "Table 2"; }, /source table, row or column/);
  rejects((f) => { obs(f).source_location.row = "All items less food and energy"; }, /source table, row or column/);
  rejects((f) => { obs(f, 0).source_location.column = "Unadjusted percent change, Aug. 2026-Sep. 2026"; }, /source table, row or column/);
  rejects((f) => { delete obs(f).source_location.column; }, /source table, row or column/);
});

test("reference month and publication time can't be confused or shifted", () => {
  rejects((f) => { release(f).reference_period.period = "2026-10"; }, /wrong reference period/);
  rejects((f) => { release(f).published.local_date = "2026-09-30"; }, /publication date or time/);
  rejects((f) => { release(f).published.utc = "2026-10-14T13:30:00Z"; }, /publication date or time/);
  rejects((f) => { release(f).published.basis = "FILE_METADATA"; }, /publication date or time/);
});

test("invalid source URLs: refused", () => {
  for (const url of ["http://www.bls.gov/news.release/archives/cpi_10142026.htm", "https://www.bls.gov/news.release/cpi.nr0.htm", "https://bls.example/news.release/archives/cpi_10142026.htm", "https://www.bls.gov.example/news.release/archives/cpi_10142026.htm", null])
    rejects((f) => { release(f).document_url = url; }, /approved BLS archive/);
  rejects((f) => { release(f).document_pdf_url = "https://www.bls.gov/news.release/cpi.nr0.pdf"; }, /approved BLS archive/);
});

test("wrong event, document or publisher in the file: refused", () => {
  rejects((f) => { release(f).release_event_id = "BLS.CPI.2026-10"; }, /unsupported release/);
  rejects((f) => { release(f).document_id = "USDL-26-0000"; }, /wrong document/);
  rejects((f) => { release(f).publisher_code = "BEA"; }, /publisher or indicator/);
});

test("provenance and status: refused unless complete and supported", () => {
  rejects((f) => { obs(f).value_status = "REVISED"; }, /unsupported value status/);
  rejects((f) => { obs(f).availability = "NOT_PUBLISHED_BY_SOURCE"; }, /unsupported availability/);
  rejects((f) => { release(f).verification.status = "UNVERIFIED"; }, /not verified against the source/);
  rejects((f) => { release(f).verification.method = ""; }, /not verified against the source/);
  rejects((f) => { release(f).retrieved_at_utc = "2026-10-14T12:00:00Z"; }, /before publication/);
  rejects((f) => { release(f).verification.verified_at_utc = "2026-10-20T00:00:00Z"; }, /before retrieval/);
  rejects((f) => { release(f).source_document_sha256 = "abc"; }, /source document hash/);
  rejects((f) => { release(f).source_notes = [{ text: "" , location: "x" }]; }, /source notes/);
});

test("desk missing or invalid: withheld, and absence is not evidence of non-publication", () => {
  const none = linkToDesk(FILE, { kind: "none" }, NOW);
  assert.equal(none.kind, "withheld");
  assert.match(none.reason, /can't be confirmed\. This does not mean the release was not published/);
  const invalid = linkToDesk(FILE, { kind: "invalid", reason: "not JSON" }, NOW);
  assert.equal(invalid.kind, "withheld");
  assert.match(invalid.reason, /\(not JSON\)/);
  withheld((d) => { d.data_mode = "SYNTHETIC_DEMO"; }, /synthetic/);
});

test("incorrect desk event, period or document: withheld, naming both sides", () => {
  withheld((d) => { d.events = d.events.filter((e) => e.event_id !== "BLS.CPI.2026-09"); }, /no event BLS\.CPI\.2026-09/);
  withheld((d, e) => { d.events.push(clone(e)); }, /more than one event/);
  withheld((d, e) => { e.reference_period.period = "2026-08"; }, /desk 2026-08, this file 2026-09/);
  withheld((d, e) => { e.publication.evidence[0].document_id = "USDL-26-0000"; }, /desk USDL-26-0000, this file USDL-26-1574/);
  withheld((d, e) => { e.publication.evidence = []; }, /desk none, this file USDL-26-1574/);
  withheld((d, e) => { e.family = "BLS_EMPSIT"; }, /family or publisher/);
  withheld((d, e) => { e.authority_code = "BEA"; }, /family or publisher/);
  withheld((d, e) => { e.synthetic = true; }, /marked synthetic/);
});

test("unconfirmed or conflicting publication: withheld", () => {
  for (const status of ["SCHEDULED_UNVERIFIED", "VERIFICATION_FAILED", "SOURCE_UNAVAILABLE", "CONFLICTING", "CANCELLED"])
    withheld((d, e) => { e.desk_status = status; }, new RegExp(`status ${status}.*does not mean the release was not published`));
  withheld((d, e) => { e.publication.status = "DUE_UNCONFIRMED"; }, /not record this release as confirmed/);
  withheld((d, e) => { e.publication.verification.state = "MISMATCH"; }, /page check does not match/);
  withheld((d, e) => { e.publication.verification.page_event_id = "BLS.CPI.2026-08"; }, /page check does not match/);
  withheld((d, e) => { e.conflicts = [{ field: "schedule.date", first_seen_at_utc: "2026-10-17T00:00:00Z", resolved: false, claims: [] }]; }, /unresolved conflict/);
  assert.equal(linked((d, e) => { e.conflicts = [{ field: "schedule.date", first_seen_at_utc: "2026-10-17T00:00:00Z", resolved: true, claims: [] }]; }).kind, "shown");
});

test("desk's official time differs: withheld, and neither source wins", () => {
  withheld((d, e) => { e.publication.official_release_time.utc = "2026-10-14T13:30:00Z"; }, /desk 2026-10-14T13:30:00Z, this file 2026-10-14T12:30:00Z/);
  withheld((d, e) => { e.publication.official_release_time = null; }, /desk none, this file/);
  withheld((d, e) => { e.publication.official_release_time.local_date = "2026-10-15"; }, /Official date or time differs/);
  withheld((d, e) => { e.publication.official_release_time.local_time = "09:30"; }, /Official date or time differs/);
});

test("stale desk metadata never withholds a confirmed release or reads as non-publication", () => {
  const FAR = Date.parse("2031-01-01T00:00:00Z");
  const v = linked((d, e) => { e.retrieval.state = "STALE"; e.retrieval.last_success_at_utc = "2026-10-17T14:15:08Z"; }, FAR);
  assert.equal(v.kind, "shown");
  assert.equal(v.observations.length, 4);
  assert.equal(v.deskCheckedUtc, "2026-10-17T14:15:08Z");
  assert.doesNotMatch(JSON.stringify(v.later), /unpublished|not published/i);
  assert.equal(linked((d, e) => { e.retrieval.state = "NEVER_RETRIEVED"; e.retrieval.last_success_at_utc = null; }).kind, "shown");
});

test("the clock changes only the later-release notice, never the figures", () => {
  const before = linked(() => {}, NEXT_DUE - 60_000), at = linked(() => {}, NEXT_DUE), after = linked(() => {}, NEXT_DUE + 60_000);
  assert.deepEqual(before.later, { kind: "not_due", event_id: "BLS.CPI.2026-10", scheduled_utc: "2026-11-10T13:30:00Z" });
  assert.deepEqual(at.later, { kind: "may_exist", event_id: "BLS.CPI.2026-10", scheduled_utc: "2026-11-10T13:30:00Z" });
  assert.deepEqual(after.later, at.later);
  for (const v of [before, at, after]) assert.deepEqual(v.observations, before.observations);
});

test("later-release notice: a confirmed later release, or no way to tell", () => {
  const cpi = (d) => d.events.filter((e) => e.family === "BLS_CPI" && e.reference_period.period > "2026-09");
  const confirmed = linked((d) => { cpi(d)[0].desk_status = "CONFIRMED"; cpi(d)[0].publication.status = "CONFIRMED"; });
  assert.equal(confirmed.later.kind, "may_exist");
  assert.equal(linked((d) => { d.events = d.events.filter((e) => !(e.family === "BLS_CPI" && e.reference_period.period > "2026-09")); }).later.kind, "unknown");
  assert.equal(linked((d) => { for (const e of cpi(d)) e.schedule.current = null; }).later.kind, "unknown");
  assert.equal(linked((d) => { cpi(d)[0].conflicts = [{ field: "schedule.date", first_seen_at_utc: "2026-10-17T00:00:00Z", resolved: false, claims: [] }]; }).later.kind, "unknown");
  assert.deepEqual(laterRelease([], NOW), { kind: "unknown" });
});

test("loader: a missing file is 'none'; other failures are 'invalid'; the only URL is the fixed same-origin file", async () => {
  const realFetch = globalThis.fetch;
  const seen = [];
  const respond = (r) => { globalThis.fetch = async (url, init) => { seen.push([url, init]); if (r instanceof Error) throw r; return r; }; };
  try {
    respond(new Response("", { status: 404 }));
    assert.deepEqual(await loadReleaseObservations(), { kind: "none" });
    respond(new Error("offline"));
    assert.deepEqual(await loadReleaseObservations(), { kind: "none" });
    respond(new Response("", { status: 500 }));
    assert.deepEqual(await loadReleaseObservations(), { kind: "invalid", reason: "HTTP 500" });
    respond(new Response("<html>", { status: 200 }));
    assert.deepEqual(await loadReleaseObservations(), { kind: "invalid", reason: "not JSON" });
    respond(new Response(JSON.stringify(FILE), { status: 200 }));
    assert.equal((await loadReleaseObservations()).kind, "ok");
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.ok(seen.every(([url, init]) => url === "./intel/release_observations.v1.json" && init.cache === "no-store" && init.method === undefined && init.body === undefined));
});

test("human verification stays outstanding unless the file records a person's confirmation", () => {
  assert.equal(humanConfirmed(release(FILE)), false);
  assert.equal(humanConfirmed({ verification: { status: "UNKNOWN_STATUS" } }), false);
  assert.equal(humanConfirmed({ verification: { status: "MANUALLY_VERIFIED_AGAINST_SOURCE" } }), true);
});

test("the library holds no figures: values live only in the data file", () => {
  const source = readFileSync(join(ROOT, "web", "lib", "releaseObservations.ts"), "utf8");
  for (const value of ['"0.6"', '"3.7"', '"0.3"', '"2.6"']) assert.ok(!source.includes(value), value);
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|api\.bls/);
});
