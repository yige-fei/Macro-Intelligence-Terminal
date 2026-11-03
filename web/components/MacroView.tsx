"use client";

// T3-I v1: Macro workspace. The Release Schedule is a new read-only subview; the historical point-in-time macro
// explorer stays where it was (the macro panel inside Market) and is one click away, unchanged.
// MN-1: the Official Values tab sits beside it. The choice is component state, so the schedule stays the default view,
// and a metadata-only build does not offer the tab.

import { useState } from "react";
import ShellHeader from "./ShellHeader";
import OfficialValues from "./OfficialValues";
import ReleaseSchedule from "./ReleaseSchedule";
import { HISTORICAL_DATA } from "../lib/api";
import { hrefFor, navigate } from "../lib/nav";

const TAB = "px-2 py-[1px] border cursor-pointer";
const ACTIVE = "border-[var(--amber)] text-[var(--amber)]";
const IDLE = "border-[var(--border)] hover:border-[var(--amber)] hover:text-[var(--amber)]";

export default function MacroView() {
  const [tab, setTab] = useState<"schedule" | "values">("schedule");
  const offerValues = HISTORICAL_DATA !== "excluded";
  return (
    <div className="flex flex-col h-screen">
      <ShellHeader current="macro" badge={tab === "values" ? "OFFICIAL VALUES · SNAPSHOT · NOT LIVE" : "REAL OFFICIAL METADATA · SCHEDULE & STATUS ONLY · NO VALUES · NOT LIVE"} />
      <main className="flex-1 overflow-auto">
        <div className="max-w-[1400px] mx-auto px-4 py-4 flex flex-col gap-3">
          <nav className="flex gap-1 text-[11px]" aria-label="Macro views">
            <button type="button" data-testid="tab-schedule" aria-current={tab === "schedule" ? "page" : undefined} className={`${TAB} ${tab === "schedule" ? ACTIVE : IDLE}`} onClick={() => setTab("schedule")}>RELEASE SCHEDULE</button>
            {offerValues && <button type="button" data-testid="tab-values" aria-current={tab === "values" ? "page" : undefined} className={`${TAB} ${tab === "values" ? ACTIVE : IDLE}`} onClick={() => setTab("values")}>OFFICIAL VALUES</button>}
            <a
              href={hrefFor("market")}
              data-testid="open-historical-explorer"
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                e.preventDefault();
                navigate("market", "focus-macro");
              }}
              className="px-2 py-[1px] border border-[var(--border)] hover:border-[var(--amber)] hover:text-[var(--amber)]"
            >
              {"HISTORICAL EXPLORER (dataset not included) →"}
            </a>
          </nav>
          {tab === "values" ? <OfficialValues /> : <ReleaseSchedule />}
        </div>
      </main>
    </div>
  );
}
