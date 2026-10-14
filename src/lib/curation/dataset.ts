import { addMonths, startOfMonth } from "date-fns";
import { getViewRange } from "../calendar";
import { toMonthKey } from "../dates";
import { fetchEventsInRange } from "../polymarket/client";
import type { GammaEvent } from "../polymarket/gamma-types";
import { curateEvents } from "./curate";
import type { CuratedCalendarEvent, CurationStats } from "./types";

/**
 * Server-side assembly of the curated calendar.
 *
 * Curation runs here, never in the browser: one Gamma page is 8–14MB of raw
 * market data, and the curated result for a whole month is a few hundred KB. The
 * browser only ever receives events.
 */

export type CuratedDataset = {
  events: CuratedCalendarEvent[];
  source: "live" | "cached";
  fetchedAt: string;
  range: { start: string; end: string };
  stats: CurationStats;
  error?: string;
};

/**
 * The same dataset without each event's legs.
 *
 * `relatedMarkets` was 58% of a month's payload — 269KB of 462KB on a September
 * grid — and the calendar never reads it: it fills one collapsed disclosure in
 * the details panel, for one event at a time. Both the API route and the
 * server-rendered first range send this shape, and the detail is fetched
 * separately when the browser is idle or a panel opens.
 *
 * `relatedMarketsCount` survives, because that is the number actually on screen.
 */
export function withoutRelatedMarkets(dataset: CuratedDataset): CuratedDataset {
  return {
    ...dataset,
    events: dataset.events.map((event) => {
      if (!event.relatedMarkets) return event;
      const trimmed = { ...event };
      delete trimmed.relatedMarkets;
      return trimmed;
    }),
  };
}

/**
 * Longest a single range build may take before it is abandoned. Comfortably
 * above a cold build measured at ~2s, and far below any reader's patience.
 */
const BUILD_TIMEOUT_MS = 25_000;

const CACHE_TTL_MS = 5 * 60 * 1000;
/** Serve a stale entry rather than nothing when Gamma is down. */
const STALE_TTL_MS = 6 * 60 * 60 * 1000;
/**
 * Raised from 24 alongside the second fetch tier.
 *
 * A range can now occupy up to four entries — shallow/deep × curated/smaller —
 * so the old ceiling held six ranges rather than the two dozen it was chosen
 * for. Deep entries are the expensive ones to rebuild, and evicting the shallow
 * neighbours a reader is about to navigate back to defeats the point of the
 * cache. Entries are bounded by the range ceiling and expire on the same
 * timers, so the memory this costs is bounded too.
 */
const MAX_CACHED_RANGES = 48;

type CacheEntry = { dataset: CuratedDataset; storedAt: number };

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<CuratedDataset>>();

function cacheKey(
  start: string,
  end: string,
  includeSmaller: boolean,
  includeTargeted: boolean,
): string {
  return `${start}|${end}|${includeSmaller ? "small" : "curated"}|${
    includeTargeted ? "deep" : "shallow"
  }`;
}

function read(key: string): { dataset: CuratedDataset; stale: boolean } | null {
  const entry = cache.get(key);
  if (!entry) return null;
  const age = Date.now() - entry.storedAt;
  if (age > STALE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  // Refresh recency so eviction drops genuinely cold ranges.
  cache.delete(key);
  cache.set(key, entry);
  return { dataset: entry.dataset, stale: age > CACHE_TTL_MS };
}

function write(key: string, dataset: CuratedDataset): void {
  cache.set(key, { dataset, storedAt: Date.now() });
  while (cache.size > MAX_CACHED_RANGES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

const ONE_DAY_MS = 86_400_000;

/**
 * Widen the fetch window: a day back, and well over a week forward.
 *
 * Gamma filters on `end_date`, which is not when the event happens. A sports
 * market's resolution deadline sits a week after the game, so a fixture played
 * on the last day of the grid carries an end date in the *following* week and
 * is simply absent from a query bounded at the grid's edge. Every MLB game in
 * the closing days of a month went missing this way.
 *
 * The day at the start is the older, smaller problem: Gamma filters on UTC
 * instants while the calendar buckets days in Eastern time, so an event
 * belonging on the grid's first day can carry a timestamp just before the
 * requested minimum.
 */
const DEADLINE_LAG_DAYS = 9;

function padRange(start: string, end: string): { start: string; end: string } {
  return {
    start: new Date(Date.parse(start) - ONE_DAY_MS).toISOString(),
    end: new Date(Date.parse(end) + DEADLINE_LAG_DAYS * ONE_DAY_MS).toISOString(),
  };
}

export type BuildCuratedOptions = {
  start: string;
  end: string;
  includeSmallerMarkets?: boolean;
  /**
   * Fetch and keep the Sport/eSport sub-filter tier.
   *
   * Costs 15 extra upstream pages (~40MB) and roughly doubles the response, so
   * it is opt-in per request rather than a property of the calendar. Cached
   * under its own key, so a deep build never displaces the shallow one a
   * different reader is using.
   */
  includeTargeted?: boolean;
  signal?: AbortSignal;
  now?: Date;
  /** Extra pages for wide ranges such as a calendar feed. */
  openPages?: number;
  closedPages?: number;
};

/**
 * Would this range be served from memory, or does it need a build?
 *
 * The rate limiter charges by what a request actually cost, and it cannot tell
 * a lookup from an upstream aggregation after the fact. Asking beforehand is
 * the cheapest way to know: a `Map.get` and a timestamp comparison, with no
 * effect on LRU order.
 *
 * Racy by nature — another request may populate the cache between this call and
 * the build — but the failure mode is only ever charging a cold price for a
 * warm request under concurrency, which errs in the safe direction.
 */
export function isRangeWarm(
  start: string,
  end: string,
  includeSmallerMarkets = false,
  includeTargeted = false,
): boolean {
  const entry = cache.get(cacheKey(start, end, includeSmallerMarkets, includeTargeted));
  if (!entry) return false;
  return Date.now() - entry.storedAt <= CACHE_TTL_MS;
}

export async function buildCuratedDataset(
  options: BuildCuratedOptions,
): Promise<CuratedDataset> {
  const {
    start,
    end,
    includeSmallerMarkets = false,
    includeTargeted = false,
    signal,
    now,
    openPages,
    closedPages,
  } = options;

  const key = cacheKey(start, end, includeSmallerMarkets, includeTargeted);

  const cached = read(key);
  if (cached && !cached.stale) return cached.dataset;

  const existing = inFlight.get(key);
  if (existing) return existing;

  /*
   * A hard deadline on the whole build, and the reason it exists.
   *
   * Requests for the same range share one promise so a burst of readers cannot
   * fan out into a burst of upstream fetches. That de-duplication has a failure
   * mode: if the build never settles, every later reader joins the same pending
   * promise and the range is wedged for the lifetime of the process. It
   * happened — one week's page stopped responding entirely while its API route,
   * on a different key, stayed healthy.
   *
   * The per-request timeouts inside the Gamma client are not enough on their
   * own: this build fans out to two dozen of them, and it only takes one to
   * stall somewhere they don't cover. The deadline is the backstop, and it
   * aborts the underlying requests rather than merely abandoning them.
   */
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), BUILD_TIMEOUT_MS);

  const task = (async (): Promise<CuratedDataset> => {
    try {
      const padded = padRange(start, end);
      const raw: GammaEvent[] = await fetchEventsInRange({
        ...padded,
        signal: signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal,
        openPages,
        closedPages,
        deep: includeTargeted,
      });

      const { events, stats } = curateEvents(raw, {
        now,
        includeSmallerMarkets,
        includeTargeted,
      });

      const dataset: CuratedDataset = {
        events,
        source: "live",
        fetchedAt: new Date().toISOString(),
        range: { start, end },
        stats,
      };
      write(key, dataset);
      return dataset;
    } catch (error) {
      // A stale entry beats an empty calendar, but it must be labelled.
      if (cached) {
        return {
          ...cached.dataset,
          source: "cached",
          error:
            error instanceof Error ? error.message : "Could not reach Polymarket.",
        };
      }
      throw error;
    }
  })().finally(() => {
    clearTimeout(timer);
    inFlight.delete(key);
  });

  inFlight.set(key, task);
  return task;
}

/* -------------------------------------------------------------------- feeds */

/** How far ahead a subscription reaches. Subscribers want the future, not the archive. */
export const FEED_MONTHS_AHEAD = 3;

/**
 * And one month behind, which is not about the archive at all.
 *
 * It is about events that *move backwards*. A market whose deadline sat a month
 * past the thing it measured is re-dated onto the day it actually settled, and
 * that date is in the past — "World Cup: Nation of Top Goalscorer" went from
 * 20 August to 19 July the moment the settlement rule landed. A subscriber
 * already has that UID on 20 August, and simply dropping it from the feed
 * leaves it there forever, because absence is not a signal. Publishing the
 * month behind lets the entry *move* instead: same UID, earlier DTSTART, a
 * higher SEQUENCE, and every client relocates it.
 */
export const FEED_MONTHS_BEHIND = 1;

export type BuildFeedOptions = {
  monthsAhead?: number;
  monthsBehind?: number;
  includeSmallerMarkets?: boolean;
  /** Carry the Sport/eSport sub-filter tier — see `BuildCuratedOptions`. */
  includeTargeted?: boolean;
  signal?: AbortSignal;
  now?: Date;
};

/**
 * The events a subscription should carry — built the way the website builds
 * them, one month at a time.
 *
 * This is the fix for a measured divergence, and the shape of it matters more
 * than it looks. The feed used to issue *one* query spanning three months. Every
 * ranged Gamma fetch is a fixed page budget ordered by volume, so widening the
 * window does not widen the result: the same ~600 slots now have three months of
 * supply competing for them, and mid-tier events the website retrieves for a
 * six-week grid simply never come back. Measured against a live September grid,
 * nine events on the website were absent from the feed — six never fetched at
 * all, two cut by per-day caps applied over a different dataset, one dropped by
 * an export-only date-confidence filter that no longer exists.
 *
 * Building per month makes the two identical by construction rather than by
 * coincidence: each call uses `getViewRange("month", …)`, which is the exact
 * range the calendar asks for when a reader navigates to that month, so it hits
 * the same `buildCuratedDataset` cache entry and returns the same events. Each
 * month then contributes only the days it owns, so a day covered by two grids is
 * published once, from the month a reader would navigate to in order to see it.
 *
 * It costs more requests on a cold server and nothing at all on a warm one,
 * because the website has already paid for those months.
 */
export async function buildFeedDataset(
  options: BuildFeedOptions = {},
): Promise<CuratedDataset> {
  const {
    monthsAhead = FEED_MONTHS_AHEAD,
    monthsBehind = FEED_MONTHS_BEHIND,
    includeSmallerMarkets = false,
    includeTargeted = false,
    signal,
    now = new Date(),
  } = options;

  const first = addMonths(startOfMonth(now), -monthsBehind);
  const monthCount = monthsBehind + monthsAhead;
  const anchors = Array.from({ length: monthCount }, (_, i) => addMonths(first, i));

  const months = await Promise.all(
    anchors.map(async (anchor) => {
      const { start, end } = getViewRange("month", anchor);
      const dataset = await buildCuratedDataset({
        start: start.toISOString(),
        end: end.toISOString(),
        includeSmallerMarkets,
        includeTargeted,
        signal,
        now,
      });
      return { dataset };
    }),
  );

  /*
   * Everything each month retrieved that lands inside the horizon, deduped.
   *
   * This used to keep only the days a month "owned" — `displayDate` starting
   * with that month's key — which sounded tidy and opened a hole. Gamma is
   * queried on `end_date`, but a settled event is *displayed* on its
   * `closedTime`, and those can be a month apart. The World Cup top-goalscorer
   * event has an end date of 20 August and settled on 19 July: August's query
   * fetched it and then rejected it for not starting with "2026-08", while
   * July's query never reached an end date that far out. No month published it
   * at all — the exact stranding `FEED_MONTHS_BEHIND` exists to prevent, and
   * worse for a *cancelled* event, whose tombstone is the only way a stale
   * entry ever leaves a subscriber's calendar.
   *
   * The horizon bound is the honest test, and the id set already collapses the
   * overlap between adjacent grids. Months are walked in order, so where two
   * grids both hold a day the earlier month's reading wins — arbitrary, but
   * deterministic, which is what a stable DTSTART needs.
   */
  const firstMonth = toMonthKey(anchors[0]);
  const afterLastMonth = toMonthKey(addMonths(anchors[anchors.length - 1], 1));

  const seen = new Set<string>();
  const events: CuratedCalendarEvent[] = [];
  for (const month of months) {
    for (const event of month.dataset.events) {
      if (seen.has(event.id)) continue;
      const key = event.displayDate.slice(0, 7);
      if (key < firstMonth || key >= afterLastMonth) continue;
      seen.add(event.id);
      events.push(event);
    }
  }

  const stats: CurationStats = {
    rawEvents: 0,
    afterExclusions: 0,
    groups: 0,
    curated: events.length,
    excludedBy: {},
  };
  for (const { dataset } of months) {
    stats.rawEvents += dataset.stats.rawEvents;
    stats.afterExclusions += dataset.stats.afterExclusions;
    stats.groups += dataset.stats.groups;
    for (const [reason, count] of Object.entries(dataset.stats.excludedBy)) {
      stats.excludedBy[reason] = (stats.excludedBy[reason] ?? 0) + count;
    }
  }

  const last = addMonths(first, monthCount);
  return {
    events,
    source: months.some((m) => m.dataset.source === "cached") ? "cached" : "live",
    fetchedAt: new Date().toISOString(),
    range: { start: first.toISOString(), end: last.toISOString() },
    stats,
    error: months.find((m) => m.dataset.error)?.dataset.error,
  };
}
