import { addMonths, startOfMonth } from "date-fns";
import { getViewRange } from "../src/lib/calendar";
import { buildIcsCalendar } from "../src/lib/calendar-export/ics";
import {
  buildCuratedDataset,
  buildFeedDataset,
  FEED_MONTHS_AHEAD,
  FEED_MONTHS_BEHIND,
} from "../src/lib/curation/dataset";
import {
  ALL_CATEGORIES,
  DEFAULT_FILTERS,
  filterEvents,
  type CalendarFilters,
} from "../src/lib/curation/filters";
import { toDayKey, toMonthKey } from "../src/lib/dates";
import type { CuratedCalendarEvent } from "../src/lib/curation/types";

/**
 * Does the published feed contain exactly what the website shows?
 *
 *   npm run verify:calendar-parity
 *
 * The question behind this script was reported as "September 2 shows three
 * events on the site and one in Google Calendar", and the first job was to stop
 * guessing about it. Measured on 2026-08-17, before the fix: nine events the
 * website showed were absent from the feed — six never fetched at all because
 * the feed issued one volume-ranked query spanning three months while the site
 * queries six weeks at a time, two cut by per-day caps applied over that
 * different dataset, and one dropped by an export-only `dateConfidence` filter
 * nothing documented.
 *
 * All three were the same underlying fault: the feed had its own idea of what
 * the dataset was. It now builds month by month through `buildFeedDataset`,
 * using the ranges the calendar itself asks for, so parity is structural. This
 * script is what keeps it that way — it rebuilds both sides from live data and
 * fails the run if they ever diverge again.
 *
 * Nothing here is stubbed and no number is asserted in advance. Every figure it
 * prints is counted from the two datasets it just built.
 */

/* ------------------------------------------------------------------ parsing */

type VEvent = {
  uid?: string;
  dtstart?: string;
  dtstartIsDate: boolean;
  dtend?: string;
  dtendIsDate: boolean;
  summary?: string;
  status?: string;
  sequence?: string;
};

/**
 * Unfold and parse a VCALENDAR into its VEVENTs.
 *
 * Deliberately a real parser rather than a regex over the raw text: RFC 5545
 * folds any line past 75 octets onto a continuation beginning with a space, so
 * a regex would silently truncate exactly the long titles most likely to
 * collide.
 */
function parseIcs(ics: string): VEvent[] {
  const unfolded: string[] = [];
  for (const raw of ics.split("\r\n")) {
    if ((raw.startsWith(" ") || raw.startsWith("\t")) && unfolded.length > 0) {
      unfolded[unfolded.length - 1] += raw.slice(1);
      continue;
    }
    unfolded.push(raw);
  }

  const events: VEvent[] = [];
  let current: VEvent | null = null;
  for (const line of unfolded) {
    if (line === "BEGIN:VEVENT") {
      current = { dtstartIsDate: false, dtendIsDate: false };
      continue;
    }
    if (line === "END:VEVENT") {
      if (current) events.push(current);
      current = null;
      continue;
    }
    if (!current) continue;

    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const name = line.slice(0, colon);
    const value = line.slice(colon + 1);
    const property = name.split(";")[0];

    if (property === "UID") current.uid = value;
    else if (property === "SUMMARY") current.summary = value;
    else if (property === "STATUS") current.status = value;
    else if (property === "SEQUENCE") current.sequence = value;
    else if (property === "DTSTART") {
      current.dtstart = value;
      current.dtstartIsDate = name.includes("VALUE=DATE");
    } else if (property === "DTEND") {
      current.dtend = value;
      current.dtendIsDate = name.includes("VALUE=DATE");
    }
  }
  return events;
}

/**
 * Which calendar day a VEVENT lands on, read the way the website reads it.
 *
 * The two forms need different handling and getting this wrong looks exactly
 * like a real bug. An all-day DTSTART is already a calendar day. A *timed*
 * DTSTART is a UTC instant, and slicing the date out of it buckets the event in
 * UTC — so a fixture at 01:00Z on the 5th, which the site correctly shows on the
 * 4th in market time, reads as a day's disagreement that does not exist. The
 * first run of this script reported eight such days before the totals proved
 * the two sides held identical events.
 */
function dayOf(vevent: VEvent): string {
  const value = vevent.dtstart ?? "";
  const date = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  if (vevent.dtstartIsDate) return date;
  const iso = `${date}T${value.slice(9, 11)}:${value.slice(11, 13)}:${value.slice(13, 15)}Z`;
  return toDayKey(iso) || date;
}

/* ------------------------------------------------------------------ website */

/**
 * What the website shows over the feed's horizon.
 *
 * Rebuilt independently of `buildFeedDataset` — one month grid at a time,
 * exactly as a reader navigating month to month would load them. Sharing the
 * feed's own helper would make the comparison circular and it would pass
 * whatever the feed did.
 */
async function websiteEvents(
  filters: CalendarFilters,
  now: Date,
  monthCount: number,
): Promise<CuratedCalendarEvent[]> {
  const first = addMonths(startOfMonth(now), -FEED_MONTHS_BEHIND);
  const out: CuratedCalendarEvent[] = [];

  for (let i = 0; i < monthCount; i++) {
    const anchor = addMonths(first, i);
    const { start, end } = getViewRange("month", anchor);
    const dataset = await buildCuratedDataset({
      start: start.toISOString(),
      end: end.toISOString(),
      includeSmallerMarkets: filters.includeSmallerMarkets,
      now,
    });
    out.push(...dataset.events);
  }

  /*
   * Bound by the horizon, deduped, first month wins — the same rule
   * `buildFeedDataset` follows, and reimplemented here rather than shared so
   * the comparison stays independent.
   *
   * The earlier version kept only the days each month "owned", by month key.
   * That is what the feed used to do too, and both had the same hole: Gamma is
   * queried on `end_date` while a settled event is displayed on `closedTime`,
   * so an event re-dated backwards across a month boundary is fetched by one
   * month and claimed by neither.
   */
  const firstMonth = toMonthKey(addMonths(startOfMonth(now), -FEED_MONTHS_BEHIND));
  const afterLastMonth = toMonthKey(
    addMonths(startOfMonth(now), monthCount - FEED_MONTHS_BEHIND),
  );

  const seen = new Set<string>();
  const deduped = out.filter((event) => {
    if (seen.has(event.id)) return false;
    const key = event.displayDate.slice(0, 7);
    if (key < firstMonth || key >= afterLastMonth) return false;
    seen.add(event.id);
    return true;
  });

  /*
   * Dedupe first, filter second — and the order is not cosmetic.
   *
   * `importanceLevel` is ranked *within* a dataset, so the two months whose
   * grids both cover a boundary day can disagree about whether the same event
   * is "major". Filtering before deduping lets that decide which copy survives:
   * a "Major only" feed kept month A's copy while the website kept month B's,
   * and three events went missing from a comparison of two correct datasets.
   * Choosing one canonical copy and then filtering it is the order that makes
   * an event's inclusion depend on the event.
   */
  return filterEvents(deduped, filters, { now });
}

/* --------------------------------------------------------------- validation */

type Problem = { kind: string; detail: string };

/** Every structural rule a subscriber's client relies on. */
function validate(vevents: VEvent[]): Problem[] {
  const problems: Problem[] = [];
  const seen = new Map<string, string>();

  for (const v of vevents) {
    const name = v.summary?.slice(0, 50) ?? "(no summary)";

    if (!v.uid) {
      problems.push({ kind: "missing-uid", detail: name });
    } else if (seen.has(v.uid)) {
      /*
       * The collision that would explain the reported symptom exactly. Google
       * treats one UID as one event, so a second VEVENT carrying a UID it has
       * already seen updates the first rather than appearing beside it — three
       * events on a day would arrive as one.
       */
      problems.push({
        kind: "duplicate-uid",
        detail: `${v.uid} — "${seen.get(v.uid)}" and "${name}"`,
      });
    } else {
      seen.set(v.uid, name);
    }

    if (!v.dtstart) {
      problems.push({ kind: "missing-dtstart", detail: name });
      continue;
    }

    if (v.dtstartIsDate) {
      // All-day: DTEND is exclusive and must be the following day. A same-day
      // DTEND is a zero-duration event, which Google is entitled to skip.
      if (!v.dtend || !v.dtendIsDate) {
        problems.push({ kind: "all-day-without-date-dtend", detail: name });
        continue;
      }
      const startMs = Date.parse(`${dayOf(v)}T00:00:00Z`);
      const endDay = `${v.dtend.slice(0, 4)}-${v.dtend.slice(4, 6)}-${v.dtend.slice(6, 8)}`;
      const endMs = Date.parse(`${endDay}T00:00:00Z`);
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
        problems.push({ kind: "unparseable-all-day", detail: `${name} ${v.dtstart}/${v.dtend}` });
      } else if (endMs - startMs !== 86_400_000) {
        problems.push({
          kind: "all-day-dtend-not-exclusive",
          detail: `${name} ${v.dtstart} → ${v.dtend}`,
        });
      }
      continue;
    }

    // Timed: a UTC instant, not a floating local time. A DTSTART without a
    // zone lands at whatever the subscriber's clock says, which is how the
    // same event shows at two different times in two calendars.
    if (!/^\d{8}T\d{6}Z$/.test(v.dtstart)) {
      problems.push({ kind: "timed-dtstart-not-utc", detail: `${name} ${v.dtstart}` });
    }
    if (!v.dtend || !/^\d{8}T\d{6}Z$/.test(v.dtend)) {
      problems.push({ kind: "timed-dtend-not-utc", detail: `${name} ${v.dtend ?? "(none)"}` });
    } else if (v.dtend <= v.dtstart) {
      problems.push({ kind: "dtend-before-dtstart", detail: `${name} ${v.dtstart}/${v.dtend}` });
    }
  }

  return problems;
}

/* --------------------------------------------------------------------- main */

type Scenario = { name: string; filters: CalendarFilters };

const SCENARIOS: Scenario[] = [
  { name: "Show all", filters: { ...DEFAULT_FILTERS, categories: ALL_CATEGORIES } },
  { name: "eSports only", filters: { ...DEFAULT_FILTERS, categories: ["esports"] } },
  {
    name: "Sports + Crypto + Economy",
    filters: { ...DEFAULT_FILTERS, categories: ["sports", "crypto", "economy"] },
  },
  { name: "Major only", filters: { ...DEFAULT_FILTERS, minImportance: "major" } },
  // The state the "Clear" button produces. A feed for no categories is an
  // empty feed, not a feed for all of them.
  { name: "No categories", filters: { ...DEFAULT_FILTERS, categories: [] } },
];

async function main() {
  const now = new Date();
  const monthsAhead = FEED_MONTHS_AHEAD;
  const monthCount = FEED_MONTHS_BEHIND + monthsAhead;
  const first = addMonths(startOfMonth(now), -FEED_MONTHS_BEHIND);
  let failures = 0;

  console.log(
    `horizon ${toMonthKey(first)} → ${toMonthKey(addMonths(first, monthCount - 1))}\n`,
  );

  for (const scenario of SCENARIOS) {
    const [site, feedDataset] = await Promise.all([
      websiteEvents(scenario.filters, now, monthCount),
      buildFeedDataset({
        monthsAhead,
        includeSmallerMarkets: scenario.filters.includeSmallerMarkets,
        now,
      }),
    ]);

    const published = filterEvents(feedDataset.events, scenario.filters, { now });
    const ics = buildIcsCalendar(published, { dtstamp: now.toISOString() });
    const vevents = parseIcs(ics);

    const siteIds = new Set(site.map((e) => e.id));
    const icsUids = vevents.map((v) => v.uid ?? "");
    const uniqueUids = new Set(icsUids);

    // Compare on the identity both sides agree on: the UID is derived from the
    // event id, so this checks logical events rather than titles.
    const icsIds = new Set(icsUids.map((uid) => uid.replace(/^pmc-/, "").split("@")[0]));
    const missing = site.filter((e) => !icsIds.has(e.id));
    const extra = [...icsIds].filter((id) => !siteIds.has(id));

    const problems = validate(vevents);

    console.log(`── ${scenario.name}`);
    console.log(`   Website events: ${site.length}`);
    console.log(`   ICS events:     ${vevents.length}`);
    console.log(`   Unique UIDs:    ${uniqueUids.size}`);
    console.log(`   Missing:        ${missing.length}`);
    console.log(`   Extra:          ${extra.length}`);

    if (missing.length > 0) {
      for (const e of missing.slice(0, 10)) {
        console.log(`     missing  ${e.displayDate}  ${e.title.slice(0, 60)}`);
      }
    }
    if (extra.length > 0) {
      for (const id of extra.slice(0, 10)) {
        const v = vevents.find((x) => (x.uid ?? "").includes(id));
        console.log(`     extra    ${v ? dayOf(v) : "?"}  ${v?.summary?.slice(0, 60) ?? id}`);
      }
    }
    if (problems.length > 0) {
      console.log(`   Structural problems: ${problems.length}`);
      for (const p of problems.slice(0, 10)) console.log(`     ${p.kind}: ${p.detail}`);
    }

    // Per-day counts, which is the shape the report arrived in.
    const byDay = new Map<string, { site: number; ics: number }>();
    for (const e of site) {
      const row = byDay.get(e.displayDate) ?? { site: 0, ics: 0 };
      row.site += 1;
      byDay.set(e.displayDate, row);
    }
    for (const v of vevents) {
      const day = dayOf(v);
      const row = byDay.get(day) ?? { site: 0, ics: 0 };
      row.ics += 1;
      byDay.set(day, row);
    }
    const disagreeing = [...byDay].filter(([, r]) => r.site !== r.ics).sort();
    console.log(`   Days where counts disagree: ${disagreeing.length} of ${byDay.size}`);
    for (const [day, r] of disagreeing.slice(0, 10)) {
      console.log(`     ${day}  site ${r.site}  ics ${r.ics}`);
    }

    const ok =
      missing.length === 0 &&
      extra.length === 0 &&
      problems.length === 0 &&
      uniqueUids.size === vevents.length &&
      disagreeing.length === 0;
    console.log(`   ${ok ? "PASS" : "FAIL"}\n`);
    if (!ok) failures += 1;
  }

  /*
   * One named day, printed in full, because that is how the problem was
   * reported and it is the cheapest thing to eyeball. The day itself is not
   * asserted on — it is a window into the run, not a fixture.
   */
  const spotlight = process.env.PARITY_DAY ?? `${toMonthKey(addMonths(startOfMonth(now), 1))}-02`;
  const all = { ...DEFAULT_FILTERS, categories: ALL_CATEGORIES };
  const site = await websiteEvents(all, now, monthCount);
  const feed = await buildFeedDataset({ monthsAhead, now });
  const published = filterEvents(feed.events, all, { now });
  const vevents = parseIcs(buildIcsCalendar(published, { dtstamp: now.toISOString() }));

  console.log(`── ${spotlight}, in detail`);
  const siteDay = site.filter((e) => e.displayDate === spotlight);
  const icsDay = vevents.filter((v) => dayOf(v) === spotlight);
  console.log(`   website: ${siteDay.length}`);
  for (const e of siteDay) console.log(`     ${e.category.padEnd(11)} ${e.title.slice(0, 62)}`);
  console.log(`   ICS:     ${icsDay.length}`);
  for (const v of icsDay) console.log(`     ${(v.uid ?? "").padEnd(28)} ${(v.summary ?? "").slice(0, 46)}`);

  if (failures > 0) {
    console.error(`\n${failures} scenario(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll scenarios in parity.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
