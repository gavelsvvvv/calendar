import { isSettled } from "../curation/types";
import type { CalendarCategory, CuratedCalendarEvent } from "../curation/types";

/**
 * Ranking for the event search.
 *
 * Pure and separate from both the catalog that feeds it and the dialog that
 * renders it, so the ordering rules can be tested against fixtures rather than
 * eyeballed against live data.
 *
 * The ordering the brief asks for, in priority order:
 *
 *   1. an exact title match on a current or upcoming event
 *   2. upcoming events over settled ones
 *   3. higher volume
 *   4. major and important events
 *   5. matches in the same recurring series
 *   6. historical results
 *
 * Those are not six independent sorts — 1, 5 and 6 are about *what matched*
 * and 2, 3, 4 are about *which event*. So a match produces a text score and a
 * merit score, and the text score dominates: somebody typing "Fed Decision"
 * has told us what they want, and no amount of volume should let a bigger
 * event that merely mentions the Fed outrank it.
 */

/* --------------------------------------------------------------- normalising */

/**
 * Fold a title into something two spellings of the same thing agree on.
 *
 * Punctuation and case only. Deliberately not stemming or removing stop words:
 * "Fed rate hike in 2026?" and "Fed Decision in September?" must stay
 * distinguishable, and an aggressive normaliser collapses exactly the words
 * that separate them.
 */
export function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const MONTHS =
  "january|february|march|april|may|june|july|august|september|october|november|december";

/**
 * A stable identity for a repeating series, from the title alone.
 *
 * The fallback for the events Gamma has no `series` row for — 5 of 34
 * central-bank events measured on 2026-08-17. It strips the parts that make one
 * instalment different from the next: a trailing month, a year, and the
 * connecting words left behind.
 *
 *   "Fed Decision in September?"        → "fed decision"
 *   "ECB Interest Rates: October 2026"  → "ecb interest rates"
 *   "Bank of Canada Decision in September?" → "bank of canada decision"
 *
 * This is only ever a *grouping* key. It never merges two events — August and
 * September remain two rows on two days, which is the point — it only lets a
 * search for one surface the others.
 */
export function seriesKeyFromTitle(title: string): string {
  let key = normalize(title);
  key = key.replace(new RegExp(`\\b(${MONTHS})\\b`, "g"), " ");
  key = key.replace(/\b(19|20)\d{2}\b/g, " ");
  key = key.replace(/\b(in|on|by|for|of the|the)\s*$/g, " ");
  key = key.replace(/\s+/g, " ").trim();
  // A title made entirely of a month and a year normalises to nothing; there is
  // no series there, and returning "" would group every such event together.
  return key;
}

/** Gamma's series slug when there is one, else the normalised title. */
export function seriesKey(event: CuratedCalendarEvent): string {
  return event.seriesSlug ?? seriesKeyFromTitle(event.title);
}

/* ------------------------------------------------------------------ scoring */

/**
 * How well the text matches. Lower is better; `null` is no match at all.
 *
 * The bands are wide apart on purpose — merit is added inside a band and can
 * never lift an event out of one — so the ordering between bands is decided by
 * the match and only the ordering within a band is decided by the event.
 */
const TEXT = {
  exactTitle: 0,
  titlePrefix: 100,
  wordStart: 200,
  titleSubstring: 300,
  series: 400,
  secondary: 500,
} as const;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function textScore(
  event: CuratedCalendarEvent,
  needle: string,
  seriesNeedles: ReadonlySet<string>,
): number | null {
  const title = normalize(event.title);
  const query = normalize(needle);
  if (!query) return TEXT.secondary;

  if (title === query) return TEXT.exactTitle;
  if (title.startsWith(query)) return TEXT.titlePrefix;
  if (new RegExp(`\\b${escapeRegExp(query)}`).test(title)) return TEXT.wordStart;
  if (title.includes(query)) return TEXT.titleSubstring;

  /*
   * The recurring-series rung, and the reason the whole index carries a series
   * key. "Fed Decision" matches September's event by title; October's is
   * titled "Fed Decision in October?" so it matches too — but a query like
   * "FOMC" matches neither title and should still return all of them, because
   * the series they share is called exactly that.
   */
  if (seriesNeedles.has(seriesKey(event))) return TEXT.series;

  /*
   * The slug is in here as well as the title, and it earns its place: Gamma
   * calls the Fed's series `fomc`, which is a word people type and which
   * appears in none of the four titles it covers. Hyphens normalise to spaces,
   * so `bank-of-canada-decision` is reachable as "bank of canada" too.
   */
  const secondary = normalize(
    [
      event.category,
      event.subcategory ?? "",
      event.leadingOutcome ?? "",
      event.seriesSlug ?? "",
      event.seriesTitle ?? "",
      // Optional-chained even though the type says it is required: results that
      // came back from `/api/search` are a trimmed projection of this shape,
      // and a query that reached this rung on one would have thrown.
      event.tags?.join(" ") ?? "",
    ].join(" "),
  );
  return secondary.includes(query) ? TEXT.secondary : null;
}

/**
 * How much this event deserves the top of its band. Lower is better, 0–99, so
 * it orders *within* a text band and can never cross one.
 *
 * Upcoming first, because a resolved market is a result and a reader searching
 * a recurring series wants the next one — the brief's "do not let old resolved
 * markets dominate search when upcoming equivalents exist", made structural
 * rather than left to volume. Importance next, then volume on a log scale so a
 * $10M event beats a $1M one without a $50M event flattening everything below.
 */
export function meritScore(event: CuratedCalendarEvent): number {
  const settled = isSettled(event.status) ? 40 : 0;
  const importance =
    event.importanceLevel === "major" ? 0 : event.importanceLevel === "important" ? 8 : 16;
  // log10 of volume, 0 at $100M and up, 30 at nothing.
  const magnitude = Math.log10(Math.max(event.volume, 1));
  const volume = Math.round(Math.max(0, Math.min(30, (8 - magnitude) * 4)));
  return Math.min(99, settled + importance + volume);
}

export type SearchOptions = {
  /** Only these categories, so search obeys the same filters as the calendar. */
  categories?: readonly CalendarCategory[];
  limit?: number;
};

export type SearchHit = {
  event: CuratedCalendarEvent;
  score: number;
};

/**
 * Rank a set of events against a query.
 *
 * The two-pass shape exists for the series rung: the series a query matches can
 * only be known once something has matched by title, so the first pass collects
 * the series keys of every title hit and the second lets their siblings in.
 * That is what turns a search for "Fed Decision" into August, September *and*
 * October when only one of them happens to be phrased the way you typed it.
 */
export function searchEvents(
  events: readonly CuratedCalendarEvent[],
  query: string,
  options: SearchOptions = {},
): SearchHit[] {
  const { categories, limit = 25 } = options;
  const allowed = categories ? new Set(categories) : null;
  const pool = allowed ? events.filter((e) => allowed.has(e.category)) : events;

  const needle = normalize(query);

  if (!needle) {
    return [...pool]
      .sort((a, b) => meritScore(a) - meritScore(b) || b.importanceScore - a.importanceScore)
      .slice(0, limit)
      .map((event) => ({ event, score: TEXT.secondary + meritScore(event) }));
  }

  const empty: ReadonlySet<string> = new Set();
  const seriesNeedles = new Set<string>();
  for (const event of pool) {
    const score = textScore(event, needle, empty);
    if (score !== null && score <= TEXT.titleSubstring) seriesNeedles.add(seriesKey(event));
  }

  const hits: SearchHit[] = [];
  for (const event of pool) {
    const text = textScore(event, needle, seriesNeedles);
    if (text === null) continue;
    hits.push({ event, score: text + meritScore(event) });
  }

  return hits
    .sort(
      (a, b) =>
        a.score - b.score ||
        // Ties break on the calendar, soonest first, then on id so the same
        // query always returns the same order.
        a.event.displayDate.localeCompare(b.event.displayDate) ||
        a.event.id.localeCompare(b.event.id),
    )
    .slice(0, limit);
}
