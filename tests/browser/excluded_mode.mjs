// MN-1: browser checks of a metadata-only build, which has no official figures to show (headless Chrome over CDP; no npm packages).
//
//   cd web && TERMINAL_DATA_MODE=excluded npm run build && cd ..
//   node tests/browser/excluded_mode.mjs [--out <dir>]
//
// Exit code 0 only if every check passes; 2 if no browser; 3 if web/out is not a metadata-only build. Rebuild afterwards
// with plain `npm run build` before running smoke.mjs.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { external, findChrome, launch, save, sleep } from "./cdp_lib.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const outArg = process.argv.indexOf("--out");
const OUT = outArg > 0 ? resolve(process.argv[outArg + 1]) : mkdtempSync(join(tmpdir(), "mit-excluded-"));
mkdirSync(OUT, { recursive: true });
if (!findChrome()) {
  console.error("SKIPPED: no Chrome/Chromium found; set CHROME_PATH. No browser check was run.");
  process.exit(2);
}
const WEB_OUT = join(REPO, "web", "out");
const TMP = mkdtempSync(join(tmpdir(), "mit-excluded-data-"));

const freePort = () => new Promise((res) => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); });
const results = [];
const check = (id, name, ok, info = null) => {
  results.push({ id, name, ok: !!ok, info });
  console.log(`${ok ? "PASS" : "FAIL"} ${id} ${name}${ok || info === null ? "" : " :: " + JSON.stringify(info).slice(0, 300)}`);
};

let chrome = null, proc = null;
try {
  const port = await freePort();
  proc = spawn(process.env.PYTHON ?? "python3", ["-B", "-m", "terminal_demo.serve", "--port", String(port)], { cwd: REPO, stdio: ["ignore", "pipe", "pipe"] });
  let started = "";
  proc.stdout.on("data", (b) => (started += b));
  for (let i = 0; i < 50 && !started.includes("serving"); i++) await sleep(100);
  if (!started.includes("serving")) throw new Error("demo server did not start: " + started.trim());
  const O = `http://127.0.0.1:${port}/`;
  chrome = await launch({ profileDir: join(TMP, "profile"), port: await freePort() });
  const page = chrome;

  await page.goto(O + "?ws=settings", 3000);
  const mode = await page.evaluate(`document.querySelector('[data-testid="settings-data-mode"]')?.innerText ?? ""`);
  if (!/^Metadata only/.test(mode)) { console.error(`NOT RUN: web/out is not a metadata-only build (data mode: ${mode})`); process.exitCode = 3; throw null; }
  const row = await page.evaluate(`[...document.querySelectorAll('[data-testid="data-row-observations"] td')].map((td) => td.innerText)`);
  const settingsText = await page.evaluate("document.body.innerText");
  check("Y1", "Settings says no official figures are included and doesn't list them as a capability", row[2] === "NOT INCLUDED" && /No official figures are included/.test(row[3] ?? "") && !/Official Values:|official CPI figures:/.test(settingsText), { row });

  await page.goto(O + "?ws=macro", 3000);
  const macro = await page.evaluate(`({ tabs: [...document.querySelectorAll('nav[aria-label="Macro views"] > *')].map((e) => e.innerText.trim()), rows: document.querySelectorAll('[data-testid^="family-"] tbody tr').length, badge: document.querySelector(".hist-badge")?.innerText })`);
  check("Y2", "Macro has the Release Schedule and no Official Values tab", JSON.stringify(macro.tabs) === JSON.stringify(["RELEASE SCHEDULE", "HISTORICAL EXPLORER (dataset not included) →"]) && macro.rows === 38 && /NO VALUES/.test(macro.badge ?? ""), macro);

  await page.goto(O, 2500);
  const home = await page.evaluate("document.body.innerText");
  check("Y3", "Home describes metadata only, with no figures mentioned", /official release-desk metadata only/.test(home) && /No economic values, live feed or news/.test(home) && !/four (CPI )?figures/i.test(home));

  const asked = page.log.requests.filter((u) => u.includes("release_observations")).length;
  const file = await page.evaluate(`fetch("./intel/release_observations.v1.json", { cache: "no-store" }).then((r) => r.status)`);
  check("Y4", "The app never requested the figures file, and this build doesn't contain it", asked === 0 && file === 404 && !existsSync(join(WEB_OUT, "intel", "release_observations.v1.json")), { asked, file });
  check("Y5", "No external requests and no exceptions", external(page.log.requests, O).length === 0 && page.log.exceptions.length === 0, { ext: external(page.log.requests, O), exceptions: page.log.exceptions });
  await page.shot(join(OUT, "01_excluded_home.png"));
} catch (e) {
  if (e !== null) check("E0", "Harness completed without an internal error", false, String(e?.stack ?? e));
} finally {
  proc?.kill("SIGTERM");
  if (chrome) await chrome.close();
  rmSync(TMP, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok);
save(join(OUT, "excluded_mode.json"), { results });
console.log(`\n${results.length - failed.length}/${results.length} checks passed; results in ${OUT}`);
process.exit(process.exitCode ?? (failed.length || results.length === 0 ? 1 : 0));
