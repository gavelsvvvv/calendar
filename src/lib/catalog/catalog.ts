import { addMonths, startOfMonth } from "date-fns";
import { curateEvents } from "../curation/curate";
import { isHiddenEverywhere } from "../curation/filters";
import { fetchEventsInRange } from "../polymarket/client";
import type { CuratedCalendarEvent } from "../curation/types";

/**
 * The broad event catalog: what Search looks through.
 *
 * ## Why this is not the calendar's dataset
 *
 * The month grid loads a six-week window because that is what it draws. Search
 * has the opposite requirement — a reader typing "Fed Decision" wants October's
 * meeting whether or not they have ever navigated to October — so the two need
 * different shapes, and the mistake would be to serve one from the other.
 * Widening the calendar's own fetch would make every Month view heavier for a
 * dialog most visitors never open; narrowing search to the loaded month is the
 * bug being fixed.
 *
 * So: one wide, *shallow* build, kept on the server, queried through
 * `/api/search`. The browser never downloads it. What crosses the wire is at
 * most a couple of dozen matching events, and only once somebody has typed.
 *
 * ## Why it is affordable
 *
 * Cost is set by the number of Gamma requests, not by the width of the window —
 * one ranged query spanning nine months costs the same as one spanning six
 * weeks. This is a single `fetchEventsInRange` (a handful of ranked pages plus
 * the per-category discovery slices), which is roughly what *one* month grid
 * already costs, and it is cached for the whole process rather than per reader.
 *
 * The trade is depth: ranked pages over nine months return each month's
 * headline events rather than all of them. That is the right trade for an index
 * whose job is "does an event by roughly this name exist, and when" — and the
 * discovery slices are what stop it from being nine months of football, because
 * they retrieve each starved category, the recurring central-bank series
 * included, on its own terms.
 *
 * The per-day caps are skipped here. They exist because a month cell fits three
 * chips; an index has no cells.
 */

export type EventCatalog = {
  events: CuratedCalendarEvent[];
  builtAt: string;
  range: { start: string; end: string };
};

/** How far back a search reaches. Enough for "what happened last month". */
const MONTHS_BEHIND = 1;
/** And how far forward. Nine months covers a full central-bank cycle. */
const MONTHS_AHEAD = 8;

/**
 * Ranked pages, deeper than a month grid takes because the window is wider.
 * Six is where the marginal page stopped adding curated events in measurement.
 */
const OPEN_PAGES = 6;
const CLOSED_PAGES = 1;

const TTL_MS = 10 * 60 * 1000;
/** Serve a stale catalog rather than none when Gamma is unreachable. */
const STALE_TTL_MS = 6 * 60 * 60 * 1000;

let cached: { catalog: EventCatalog; storedAt: number } | null = null;
let inFlight: Promise<EventCatalog> | null = null;

export type CatalogOptions = {
  now?: Date;
  signal?: AbortSignal;
  /** Rebuild even if a fresh copy is cached. Verification scripts only. */
  force?: boolean;
};

export async function getEventCatalog(options: CatalogOptions = {}): Promise<EventCatalog> {
  const { now = new Date(), signal, force = false } = options;

  const age = cached ? Date.now() - cached.storedAt : Number.POSITIVE_INFINITY;
  if (!force && cached && age < TTL_MS) return cached.catalog;

  // One build at a time. Search is bursty by nature — a reader types five
  // characters and the debounce still lets two requests through — and without
  // this the first visit after expiry would fan out into several full builds.
  if (inFlight) return inFlight;

  const task = (async (): Promise<EventCatalog> => {
    const start = addMonths(startOfMonth(now), -MONTHS_BEHIND);
    const end = addMonths(startOfMonth(now), MONTHS_AHEAD);

    try {
      const raw = await fetchEventsInRange({
        start: start.toISOString(),
        end: end.toISOString(),
        openPages: OPEN_PAGES,
        closedPages: CLOSED_PAGES,
        signal,
      });

      const { events } = curateEvents(raw, { now, skipDailyCaps: true });

      const catalog: EventCatalog = {
        /*
         * The same two rules every calendar surface applies.
         *
         * Retired events exist for feed tombstones and have no business in a
         * search box; neither does a settled event still carrying a future
         * deadline, which the grid and the feed both refuse to draw. Filtering
         * only the first left Search advertising an event dated next month with
         * "Resolved" beside it, and clicking it landed the reader on a day that
         * did not contain it.
         */
        events: events.filter((e) => !isHiddenEverywhere(e, now)),
        builtAt: new Date().toISOString(),
        range: { start: start.toISOString(), end: end.toISOString() },
      };
      cached = { catalog, storedAt: Date.now() };
      return catalog;
    } catch (error) {
      if (cached && Date.now() - cached.storedAt < STALE_TTL_MS) return cached.catalog;
      throw error;
    }
  })().finally(() => {
    inFlight = null;
  });

  inFlight = task;
  return task;
}

/** Drop the cached catalog. For tests and the verification scripts. */
export function resetEventCatalog(): void {
  cached = null;
  inFlight = null;
}
