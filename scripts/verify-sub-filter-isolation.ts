/**
 * The Sport / eSport isolation matrix, run against live Polymarket data.
 *
 *   npx tsx scripts/verify-sub-filter-isolation.ts [weeks]
 *
 * ## What this exists to catch
 *
 * Four regressions, all of which looked like different bugs and all of which
 * were one shared `deep` boolean standing in for two independent selections:
 *
 *  1. Narrowing eSport emptied the whole calendar.
 *  2. Narrowing Sport emptied the whole calendar.
 *  3. Narrowing eSport moved the **Sports** count (43 → 266).
 *  4. Narrowing Sport moved the **eSports** count (66 → 160).
 *
 * A fixture cannot catch any of them. Each needs the real two-tier build — the
 * fifteen targeted sport discovery slices, the $250k/$100k broad floors, the
 * $500 targeted floor, the per-day caps — so this runs the actual server
 * pipeline over a real window and then the actual client pipeline over its
 * output. Nothing here is mocked and no count is asserted against a number
 * written by hand: the invariants are all *relative* ("this must not move"),
 * so the file does not go stale as Polymarket's book changes.
 *
 * ## How a case is evaluated
 *
 * Exactly the way the app would evaluate it. `targetedTiers(filters)` picks
 * which of the four builds the browser would be holding, `filterEvents` decides
 * the grid, and `buildCalendarIndex` produces the sidebar and picker counts.
 * A bug anywhere in that chain shows up here as a moved number.
 */
import { getViewRange } from "../src/lib/calendar";
import { buildCalendarIndex } from "../src/lib/calendar-index";
import { CATEGORY_IDS } from "../src/lib/categories";
import { buildCuratedDataset, type CuratedDataset } from "../src/lib/curation/dataset";
import {
  ALL_ESPORTS,
  DEFAULT_FILTERS,
  filterEvents,
  targetedTiers,
  type CalendarFilters,
} from "../src/lib/curation/filters";
import { tierKey, type CalendarCategory, type TargetedTiers } from "../src/lib/curation/types";

const WEEKS = Number(process.argv[2] ?? 6);

let failures = 0;
let checks = 0;

function check(name: string, ok: boolean, detail = ""): void {
  checks++;
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

/* ------------------------------------------------------------ the builds */

/**
 * One build per tier combination, fetched once and shared by every case.
 *
 * Four builds rather than one is the point rather than an optimisation: if the
 * four were the same object the isolation claims would be vacuous.
 */
type Builds = Map<string, CuratedDataset>;

async function buildAll(start: string, end: string): Promise<Builds> {
  const combos: TargetedTiers[] = [
    { sports: false, esports: false },
    { sports: true, esports: false },
    { sports: false, esports: true },
    { sports: true, esports: true },
  ];
  const builds: Builds = new Map();
  for (const targeted of combos) {
    const t0 = Date.now();
    const dataset = await buildCuratedDataset({ start, end, targeted });
    const key = tierKey(targeted);
    builds.set(key, dataset);
    const targetedOnly = dataset.events.filter((e) => e.targetedOnly).length;
    console.log(
      `  tier "${key || "(none)"}"`.padEnd(28) +
        `${dataset.events.length} events ` +
        `(broad ${dataset.events.length - targetedOnly}, targeted ${targetedOnly}) ` +
        `in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
    );
  }
  return builds;
}

/* -------------------------------------------------------------- one case */

/** Everything a reader could read off the screen in one state. */
type Reading = {
  /** Events on the grid, per category. */
  grid: Record<string, number>;
  /** The number beside each sidebar category row. */
  rows: Record<string, number>;
  /** The number on each picker tile. */
  sportTiles: Record<string, number>;
  esportTiles: Record<string, number>;
  /** Total events on the grid. */
  total: number;
  /** Which build the browser would be holding. */
  tier: string;
};

function read(builds: Builds, filters: CalendarFilters, monthKey: string, today: string): Reading {
  const tier = tierKey(targetedTiers(filters));
  const dataset = builds.get(tier);
  if (!dataset) throw new Error(`no build for tier "${tier}"`);
  const allEvents = dataset.events;

  const events = filterEvents(allEvents, filters);
  const index = buildCalendarIndex({ allEvents, events, monthKey, today, filters });

  const grid: Record<string, number> = {};
  for (const id of CATEGORY_IDS) grid[id] = 0;
  for (const event of events) grid[event.category] += 1;

  const rows: Record<string, number> = {};
  for (const id of CATEGORY_IDS) rows[id] = index.countsByCategory[id as CalendarCategory] ?? 0;

  return {
    grid,
    rows,
    sportTiles: { ...index.countsBySport },
    esportTiles: { ...index.countsByEsport },
    total: events.length,
    tier,
  };
}

/** Every category except the two named — the ones a gesture must not touch. */
function others(...except: string[]): string[] {
  return CATEGORY_IDS.filter((id) => !except.includes(id));
}

function diff(a: Record<string, number>, b: Record<string, number>, keys: string[]): string {
  return keys
    .filter((k) => (a[k] ?? 0) !== (b[k] ?? 0))
    .map((k) => `${k} ${a[k] ?? 0}→${b[k] ?? 0}`)
    .join(", ");
}

function unchanged(
  label: string,
  base: Reading,
  next: Reading,
  keys: string[],
): void {
  const rowDrift = diff(base.rows, next.rows, keys);
  check(`${label}: sidebar rows unchanged`, rowDrift === "", rowDrift);
  const gridDrift = diff(base.grid, next.grid, keys);
  check(`${label}: grid unchanged`, gridDrift === "", gridDrift);
}

/* ------------------------------------------------------------------ main */

async function main() {
  const now = new Date();
  const { start } = getViewRange("month", now);
  const end = new Date(start.getTime() + WEEKS * 7 * 86_400_000);
  const monthKey = start.toISOString().slice(0, 7);
  const today = now.toISOString().slice(0, 10);

  console.log(
    `Window ${start.toISOString().slice(0, 10)} → ${end.toISOString().slice(0, 10)} ` +
      `(${WEEKS} weeks)\n`,
  );

  console.log("Builds");
  const builds = await buildAll(start.toISOString(), end.toISOString());
  console.log();

  const F = (patch: Partial<CalendarFilters>): CalendarFilters => ({
    ...DEFAULT_FILTERS,
    ...patch,
  });
  const look = (filters: CalendarFilters) => read(builds, filters, monthKey, today);

  /* CASE 1 — the fresh visit everything else is measured against. */
  const base = look(DEFAULT_FILTERS);
  console.log("CASE 1 · fresh visit, Sport = All, eSport = All");
  console.log(`  tier "${base.tier || "(none)"}", ${base.total} events on the grid`);
  console.log(
    `  ${CATEGORY_IDS.map((id) => `${id} ${base.rows[id]}`).join("  ")}\n`,
  );
  check("CASE 1: the calendar is not empty", base.total > 0, `${base.total} events`);
  check("CASE 1: sports has events", base.rows.sports > 0, `${base.rows.sports}`);
  check("CASE 1: esports has events", base.rows.esports > 0, `${base.rows.esports}`);
  check("CASE 1: an unrelated category has events", base.rows.crypto + base.rows.politics > 0);
  check("CASE 1: no tier is requested", base.tier === "", `tier "${base.tier}"`);
  console.log();

  /*
   * CASES 2–5 and 10 — every eSport narrowing.
   *
   * The invariant under test is the one the brief states twice: eSport may move
   * eSport and *nothing else*, and the calendar must never fall to zero.
   */
  const esportCases: Array<[string, string[]]> = [
    ["CASE 2 · eSport = CS2", ["cs2"]],
    ["CASE 3 · eSport = Dota 2", ["dota2"]],
    ["CASE 4 · eSport = CS2 + Dota 2", ["cs2", "dota2"]],
    ["CASE 10 · Sport = All, eSport = CS2", ["cs2"]],
  ];
  for (const [label, esports] of esportCases) {
    const next = look(F({ esports: esports as CalendarFilters["esports"] }));
    console.log(`${label}  → tier "${next.tier}", ${next.total} events`);
    check(`${label}: calendar is not empty`, next.total > 0, `${next.total} events`);
    unchanged(label, base, next, others("esports"));
    const tileDrift = diff(base.sportTiles, next.sportTiles, Object.keys(base.sportTiles));
    check(`${label}: sport tiles unchanged`, tileDrift === "", tileDrift);
    check(
      `${label}: only the named games are on the grid`,
      next.grid.esports > 0 || base.grid.esports === 0,
      `esports ${base.grid.esports}→${next.grid.esports}`,
    );
    check(`${label}: the esports tier, and only it`, next.tier === "esports", next.tier);
  }
  console.log();

  /* CASE 5 — going back to All Games restores CASE 1 exactly. */
  const reset = look(F({ esports: [...ALL_ESPORTS] }));
  console.log(`CASE 5 · eSport = All (restored)  → tier "${reset.tier || "(none)"}"`);
  check("CASE 5: back to the untargeted build", reset.tier === "", reset.tier);
  const resetDrift = diff(base.rows, reset.rows, [...CATEGORY_IDS]);
  check("CASE 5: every row is back to CASE 1", resetDrift === "", resetDrift);
  check("CASE 5: the grid is back to CASE 1", reset.total === base.total,
    `${base.total} → ${reset.total}`);
  console.log();

  /* CASES 6–8 and 11 — every Sport narrowing, mirrored. */
  const sportCases: Array<[string, string[]]> = [
    ["CASE 6 · Sport = Tennis", ["tennis"]],
    ["CASE 7 · Sport = Tennis + NFL", ["tennis", "american-football"]],
    ["CASE 8 · Sport = NBA", ["basketball"]],
    ["CASE 11 · Sport = Tennis, eSport = All", ["tennis"]],
  ];
  for (const [label, sports] of sportCases) {
    const next = look(F({ sports: sports as CalendarFilters["sports"] }));
    console.log(`${label}  → tier "${next.tier}", ${next.total} events`);
    check(`${label}: calendar is not empty`, next.total > 0, `${next.total} events`);
    unchanged(label, base, next, others("sports"));
    const tileDrift = diff(base.esportTiles, next.esportTiles, Object.keys(base.esportTiles));
    check(`${label}: esport tiles unchanged`, tileDrift === "", tileDrift);
    check(`${label}: the sports tier, and only it`, next.tier === "sports", next.tier);
  }
  console.log();

  /* CASE 9 — both at once, and neither may borrow the other's coverage. */
  const both = look(F({ sports: ["tennis"], esports: ["cs2"] }));
  const sportOnly = look(F({ sports: ["tennis"] }));
  const esportOnly = look(F({ esports: ["cs2"] }));
  console.log(`CASE 9 · Sport = Tennis + eSport = CS2  → tier "${both.tier}", ${both.total} events`);
  check("CASE 9: both tiers are requested", both.tier === "esports,sports", both.tier);
  check("CASE 9: calendar is not empty", both.total > 0, `${both.total} events`);
  check(
    "CASE 9: its sports row equals Sport-alone's",
    both.rows.sports === sportOnly.rows.sports,
    `${sportOnly.rows.sports} vs ${both.rows.sports}`,
  );
  check(
    "CASE 9: its esports row equals eSport-alone's",
    both.rows.esports === esportOnly.rows.esports,
    `${esportOnly.rows.esports} vs ${both.rows.esports}`,
  );
  unchanged("CASE 9", base, both, others("sports", "esports"));
  console.log();

  /* CASE 12/13 — unticking the parent category, and coming back. */
  const sportOff = look(F({
    sports: ["tennis", "american-football"],
    categories: CATEGORY_IDS.filter((c) => c !== "sports") as CalendarCategory[],
  }));
  console.log(`CASE 12 · Sport off, subset kept  → tier "${sportOff.tier || "(none)"}"`);
  check("CASE 12: no sport events on the grid", sportOff.grid.sports === 0, `${sportOff.grid.sports}`);
  check(
    "CASE 12: an unticked category buys no tier",
    sportOff.tier === "",
    sportOff.tier,
  );
  unchanged("CASE 12", base, sportOff, others("sports"));
  const sportBack = look(F({ sports: ["tennis", "american-football"] }));
  check(
    "CASE 12: re-enabling restores the subset's calendar",
    sportBack.grid.sports > 0 && sportBack.tier === "sports",
    `${sportBack.grid.sports} events, tier "${sportBack.tier}"`,
  );

  const esportOff = look(F({
    esports: ["cs2"],
    categories: CATEGORY_IDS.filter((c) => c !== "esports") as CalendarCategory[],
  }));
  console.log(`CASE 13 · eSport off, subset kept  → tier "${esportOff.tier || "(none)"}"`);
  check("CASE 13: no esport events on the grid", esportOff.grid.esports === 0);
  check("CASE 13: an unticked category buys no tier", esportOff.tier === "", esportOff.tier);
  unchanged("CASE 13", base, esportOff, others("esports"));
  const esportBack = look(F({ esports: ["cs2"] }));
  check(
    "CASE 13: re-enabling restores the subset's calendar",
    esportBack.grid.esports > 0 && esportBack.tier === "esports",
    `${esportBack.grid.esports} events, tier "${esportBack.tier}"`,
  );
  console.log();

  /* CASE 16 — the one state that is allowed to be empty. */
  const cleared = look(F({ categories: [], sports: ["tennis"], esports: ["cs2"] }));
  console.log("CASE 16 · Clear all");
  check("CASE 16: nothing on the grid", cleared.total === 0, `${cleared.total} events`);
  check("CASE 16: and no tier is bought for it", cleared.tier === "", cleared.tier);

  /* CASE 17 — Show all, with the sub-selections still held. */
  const restored = look(F({ sports: ["tennis"], esports: ["cs2"] }));
  console.log("CASE 17 · Show all, sub-selections retained");
  check(
    "CASE 17: the sub-filters are honoured again",
    restored.total > 0 && restored.tier === "esports,sports",
    `${restored.total} events, tier "${restored.tier}"`,
  );
  unchanged("CASE 17", base, restored, others("sports", "esports"));
  console.log();

  /* ------------------------------------------------- the measured report */

  const report = (label: string, r: Reading) =>
    console.log(
      `${label.padEnd(22)} Sport ${String(r.rows.sports).padStart(4)}   ` +
        `eSport ${String(r.rows.esports).padStart(4)}   ` +
        `Politics ${String(r.rows.politics).padStart(4)}   ` +
        `Crypto ${String(r.rows.crypto).padStart(4)}   ` +
        `Economy ${String(r.rows.economy).padStart(4)}`,
    );
  console.log("Measured sidebar counts");
  report("DEFAULT", base);
  report("eSport = CS2", esportOnly);
  report("Sport = Tennis", sportOnly);
  report("both", both);
  console.log();

  console.log(`${checks - failures}/${checks} checks passed`);
  if (failures > 0) {
    console.error(`\n${failures} FAILED`);
    process.exitCode = 1;
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
