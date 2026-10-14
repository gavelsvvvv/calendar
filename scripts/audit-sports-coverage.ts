/**
 * Before/after coverage for the Sport and eSport sub-filters.
 *
 * Answers the question the brief asks and refuses to accept a summary of:
 * for each sport, how many events does the calendar actually carry, broadly and
 * under a targeted sub-selection — and are they real fixtures with real times?
 *
 *   npx tsx scripts/audit-sports-coverage.ts [weeks]
 */
import { getViewRange } from "../src/lib/calendar";
import { buildCuratedDataset } from "../src/lib/curation/dataset";
import {
  DEFAULT_FILTERS,
  filterEvents,
  type CalendarFilters,
} from "../src/lib/curation/filters";
import { ESPORTS, SPORTS, type EsportId, type SportId } from "../src/lib/sports/taxonomy";

const money = (n: number) =>
  n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}k` : `$${Math.round(n)}`;

async function main() {
  const weeks = Number(process.argv[2] ?? 6);
  const now = new Date();
  const { start } = getViewRange("month", now);
  const end = new Date(start.getTime() + weeks * 7 * 86_400_000);

  console.log(`Window ${start.toISOString().slice(0, 10)} → ${end.toISOString().slice(0, 10)}\n`);

  /*
   * Both tiers, so the shallow one can be asserted unchanged rather than
   * assumed unchanged. This is the regression the brief cares about most: a
   * reader who never touches the sub-filter must get the calendar they had.
   */
  const s0 = Date.now();
  const shallow = await buildCuratedDataset({
    start: start.toISOString(),
    end: end.toISOString(),
  });
  const shallowMs = Date.now() - s0;

  const t0 = Date.now();
  const dataset = await buildCuratedDataset({
    start: start.toISOString(),
    end: end.toISOString(),
    includeTargeted: true,
  });
  const buildMs = Date.now() - t0;

  const shallowTargeted = shallow.events.filter((e) => e.targetedOnly).length;
  console.log(`Shallow build: ${(shallowMs / 1000).toFixed(1)}s, ${shallow.events.length} events, ${shallowTargeted} targeted-only (must be 0)`);

  const all = dataset.events;
  const targetedOnly = all.filter((e) => e.targetedOnly);
  console.log(`Cold build: ${(buildMs / 1000).toFixed(1)}s`);
  console.log(`Curated events: ${all.length}  (broad ${all.length - targetedOnly.length}, targeted-only ${targetedOnly.length})\n`);

  /** What the calendar shows with no sub-filter — i.e. today's behaviour. */
  const broad = filterEvents(all, DEFAULT_FILTERS, { now });

  const withOnly = (sports: SportId[], esports: EsportId[]): CalendarFilters => ({
    ...DEFAULT_FILTERS,
    sports,
    esports,
  });

  console.log("SPORTS".padEnd(20), "all-sports".padStart(11), "targeted".padStart(9), "matches".padStart(8), "timed".padStart(6), "  median   example");
  let beforeTot = 0, afterTot = 0;
  for (const sport of SPORTS) {
    const before = broad.filter((e) => e.sportId === sport.id).length;
    const after = filterEvents(all, withOnly([sport.id], []), { now }).filter(
      (e) => e.category === "sports",
    );
    const matches = after.filter((e) => e.eventKind === "match");
    const timed = after.filter((e) => !e.isAllDay);
    const vols = after.map((e) => e.volume).sort((a, b) => a - b);
    const median = vols.length ? vols[Math.floor(vols.length / 2)] : 0;
    beforeTot += before; afterTot += after.length;
    console.log(
      sport.label.padEnd(20),
      String(before).padStart(11),
      String(after.length).padStart(9),
      String(matches.length).padStart(8),
      String(timed.length).padStart(6),
      money(median).padStart(9),
      "  " + (after[0]?.title ?? "—").slice(0, 46),
    );
  }
  console.log("".padEnd(20), String(beforeTot).padStart(11), String(afterTot).padStart(9), "  <- totals\n");

  console.log("ESPORTS".padEnd(20), "all-games".padStart(11), "targeted".padStart(9), "matches".padStart(8), "timed".padStart(6), "  median   example");
  let eBefore = 0, eAfter = 0;
  for (const game of ESPORTS) {
    const before = broad.filter((e) => e.esportGameId === game.id).length;
    const after = filterEvents(all, withOnly([], [game.id]), { now }).filter(
      (e) => e.category === "esports",
    );
    const matches = after.filter((e) => e.eventKind === "match");
    const timed = after.filter((e) => !e.isAllDay);
    const vols = after.map((e) => e.volume).sort((a, b) => a - b);
    const median = vols.length ? vols[Math.floor(vols.length / 2)] : 0;
    eBefore += before; eAfter += after.length;
    console.log(
      game.label.padEnd(20),
      String(before).padStart(11),
      String(after.length).padStart(9),
      String(matches.length).padStart(8),
      String(timed.length).padStart(6),
      money(median).padStart(9),
      "  " + (after[0]?.title ?? "—").slice(0, 46),
    );
  }
  console.log("".padEnd(20), String(eBefore).padStart(11), String(eAfter).padStart(9), "  <- totals\n");

  /* The regression that matters: "All Sports" must be untouched. */
  const sportsBroad = broad.filter((e) => e.category === "sports").length;
  const esportsBroad = broad.filter((e) => e.category === "esports").length;
  const leaked = broad.filter((e) => e.targetedOnly).length;
  console.log(`All-Sports view: ${sportsBroad} sports + ${esportsBroad} esports events`);
  console.log(`Targeted-only events leaking into the broad view: ${leaked}  (must be 0)`);

  /*
   * The shallow tier, event for event. Anything in one and not the other is a
   * regression in the calendar everyone sees.
   */
  const shallowIds = new Set(shallow.events.map((e) => e.id));
  const deepBroadIds = new Set(dataset.events.filter((e) => !e.targetedOnly).map((e) => e.id));
  const lostFromShallow = [...shallowIds].filter((id) => !deepBroadIds.has(id));
  const gainedInBroad = [...deepBroadIds].filter((id) => !shallowIds.has(id));
  console.log(
    `\nShallow vs deep-broad: ${shallowIds.size} vs ${deepBroadIds.size} events; ` +
      `${lostFromShallow.length} only in shallow, ${gainedInBroad.length} only in deep`,
  );
  for (const id of gainedInBroad.slice(0, 6)) {
    const e = dataset.events.find((x) => x.id === id)!;
    console.log(`   + ${e.displayDate} ${money(e.volume).padStart(8)} [${e.category}] ${e.title.slice(0, 50)}`);
  }
  for (const id of lostFromShallow.slice(0, 6)) {
    const e = shallow.events.find((x) => x.id === id)!;
    console.log(`   - ${e.displayDate} ${money(e.volume).padStart(8)} [${e.category}] ${e.title.slice(0, 50)}`);
  }

  /* Payload cost of carrying the extra tier. */
  const bytesAll = JSON.stringify(all).length;
  const bytesBroadOnly = JSON.stringify(all.filter((e) => !e.targetedOnly)).length;
  console.log(
    `\nPayload: ${(bytesAll / 1024).toFixed(0)}KB with the targeted tier, ` +
      `${(bytesBroadOnly / 1024).toFixed(0)}KB without ` +
      `(+${(((bytesAll - bytesBroadOnly) / bytesBroadOnly) * 100).toFixed(0)}%)`,
  );

  /* Busiest single sport-day, which is what the targeted cap is sized against. */
  const perDay = new Map<string, number>();
  for (const e of targetedOnly) {
    const key = `${e.displayDate}|${e.sportId ?? e.esportGameId}`;
    perDay.set(key, (perDay.get(key) ?? 0) + 1);
  }
  const busiest = [...perDay.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  console.log(`\nBusiest targeted sport-days: ${busiest.map(([k, v]) => `${k} ${v}`).join(", ")}`);

  /*
   * §42 — worked examples, discovered rather than listed.
   *
   * Every row is picked from live data by *shape* — "the biggest tennis match",
   * "the biggest CS2 outright" — so this table describes whatever Polymarket is
   * running today and will still describe next season's schedule. There is no
   * fixture list anywhere in the implementation or in this script (§43).
   */
  const wanted: Array<{ want: string; sport?: string; game?: string; kind: string }> = [
    { want: "Tennis match", sport: "tennis", kind: "match" },
    { want: "Tennis outright", sport: "tennis", kind: "outright" },
    { want: "NFL game", sport: "american-football", kind: "match" },
    { want: "Basketball game", sport: "basketball", kind: "match" },
    { want: "Soccer match", sport: "soccer", kind: "match" },
    { want: "Baseball game", sport: "baseball", kind: "match" },
    { want: "CS2 match", game: "cs2", kind: "match" },
    { want: "CS2 outright", game: "cs2", kind: "outright" },
    { want: "Dota 2 match", game: "dota2", kind: "match" },
    { want: "LoL match", game: "lol", kind: "match" },
  ];

  console.log("\n§42 — worked examples, found by shape rather than by name\n");
  console.log(
    "kind".padEnd(18),
    "date".padEnd(11),
    "time".padEnd(6),
    "volume".padStart(8),
    "under All".padStart(10),
    "targeted".padStart(9),
    "  title",
  );
  for (const w of wanted) {
    const pool = dataset.events
      .filter(
        (e) =>
          (w.sport ? e.sportId === w.sport : e.esportGameId === w.game) &&
          e.eventKind === w.kind,
      )
      .sort((a, b) => b.volume - a.volume);
    const e = pool[0];
    if (!e) {
      console.log(w.want.padEnd(18), "— none in this window —");
      continue;
    }
    // Asked of the real filter, not asserted: does it show broadly, and under a
    // sub-selection naming only its own sport?
    const inBroad = filterEvents([e], DEFAULT_FILTERS, { now }).length > 0;
    const inTargeted =
      filterEvents(
        [e],
        withOnly(w.sport ? [w.sport as SportId] : [], w.game ? [w.game as EsportId] : []),
        { now },
      ).length > 0;
    console.log(
      w.want.padEnd(18),
      e.displayDate.padEnd(11),
      (e.isAllDay ? "all-day" : e.time).padEnd(6),
      money(e.volume).padStart(8),
      (inBroad ? "yes" : "no").padStart(10),
      (inTargeted ? "yes" : "no").padStart(9),
      "  " + e.title.slice(0, 46),
    );
  }

  /* Real examples of what the tier actually added, not hardcoded ones. */
  const examples = targetedOnly
    .filter((e) => e.eventKind === "match" && !e.isAllDay)
    .sort((a, b) => b.volume - a.volume)
    .slice(0, 8);
  console.log(`\nNewly reachable fixtures (top ${examples.length} by volume):`);
  for (const e of examples) {
    console.log(
      `  ${e.displayDate} ${e.time.padEnd(5)} ${money(e.volume).padStart(8)}  [${e.sportId ?? e.esportGameId}] ${e.title.slice(0, 52)}`,
    );
  }

  /* §40 — match vs prop, which is the shape question the brief asks. */
  const sportish = dataset.events.filter(
    (e) => e.category === "sports" || e.category === "esports",
  );
  const byKind: Record<string, number> = {};
  for (const e of sportish) byKind[e.eventKind ?? "unclassified"] = (byKind[e.eventKind ?? "unclassified"] ?? 0) + 1;
  console.log(
    `\nEvent kinds across sports+esports: ` +
      Object.entries(byKind)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k} ${v}`)
        .join(", "),
  );
  const timed = sportish.filter((e) => !e.isAllDay).length;
  console.log(
    `Dated on a real scheduled time: ${timed}/${sportish.length} ` +
      `(${Math.round((timed / Math.max(1, sportish.length)) * 100)}%)`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
