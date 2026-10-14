import { addMonths, startOfMonth } from "date-fns";
import { getViewRange } from "./calendar";
import type { CuratedDataset } from "./curation/dataset";
import { fromMonthKey, toMonthKey } from "./dates";
import type { CalendarView } from "./url-state";

/**
 * The client's calendar cache, keyed by month.
 *
 * ## Why a month and not a range
 *
 * Every view used to fetch its own window: a month grid for month and agenda, a
 * seven-day window for week. Three windows, three cache keys, so *switching
 * view* — which changes nothing about which events exist — missed the cache and
 * went to the network. Month → Week could not be anything but slow, by
 * construction.
 *
 * A month grid is whole weeks covering the month, so any week containing a day
 * of month M lies entirely inside M's grid. That makes the month grid the one
 * window every view can be served from: month, agenda and week for the same
 * month all read one entry, and switching between them is arithmetic.
 *
 * It is also *more* data, not less. Gamma is queried by resolution deadline
 * with a fixed page budget, and a seven-day query spends that budget on a
 * narrower slice — measured over the five weeks of September 2026, serving the
 * week view from the month grid surfaced 59 events the week fetches missed and
 * dropped 9 they had found, and made the week agree with the month about what
 * exists on a shared day. They used to disagree.
 *
 * ## Why a store rather than a Map
 *
 * The previous cache was a module-level Map read during render with nothing
 * subscribed to it. A write from an effect changed no React state, so nothing
 * re-rendered: switching Month → Week left the calendar showing
 * `isRefreshing` forever, dimmed at 60%, with the data sitting in the cache
 * unread. Anything read during render has to be a store React can subscribe
 * to, and that is what this is.
 */

export type MonthEntry = {
  /** The last dataset successfully loaded for this month, if any. */
  dataset?: CuratedDataset;
  /** When `dataset` was stored. */
  storedAt: number;
  /** A request is in the air. */
  loading: boolean;
  /** The last load failed. Cleared by a successful one. */
  error?: string;
};

/**
 * How long a month stays fresh in the browser.
 *
 * Matches the server's own dataset TTL, so the two layers expire together and a
 * market Polymarket lists now reaches the calendar within five minutes rather
 * than never.
 */
export const MONTH_TTL_MS = 5 * 60 * 1000;

/**
 * `2026-09|curated`, or `2026-09|curated+deep`.
 *
 * Two dimensions beyond the month, and neither is a filter. "Smaller markets"
 * is a different calendar; `deep` is the same calendar plus the Sport/eSport
 * sub-filter tier, which is a different *response* — roughly twice the bytes,
 * fetched only once a reader has named a sport. Keeping them in the key is what
 * lets a reader flip between "All Sports" and "Tennis only" without either
 * request clobbering the other's cached month.
 */
export function monthCacheKey(
  monthKey: string,
  includeSmaller: boolean,
  deep = false,
): string {
  return `${monthKey}|${includeSmaller ? "small" : "curated"}${deep ? "+deep" : ""}`;
}

/**
 * The month whose grid can serve this view.
 *
 * Week included: the week containing a day is inside that day's month grid,
 * always, because the grid is built from whole weeks.
 */
export function monthKeyForView(_view: CalendarView, anchor: Date): string {
  return toMonthKey(anchor);
}

/** The fetch window for a month key: its full grid, leading and trailing days included. */
export function monthGridRange(monthKey: string): { start: string; end: string } {
  const anchor = fromMonthKey(monthKey) ?? new Date();
  const { start, end } = getViewRange("month", anchor);
  return { start: start.toISOString(), end: end.toISOString() };
}

/** The month key `offset` months from this one. */
export function shiftMonthKey(monthKey: string, offset: number): string {
  const anchor = fromMonthKey(monthKey) ?? new Date();
  return toMonthKey(addMonths(startOfMonth(anchor), offset));
}

type Record_ = MonthEntry & { controller?: AbortController };

const months = new Map<string, Record_>();
const listeners = new Set<() => void>();
let version = 0;

function publish(): void {
  version += 1;
  for (const listener of listeners) listener();
}

export function subscribeToMonths(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The snapshot React compares. Any mutation bumps it; nothing else does. */
export function monthsVersion(): number {
  return version;
}

/** The server has no cache to read, and must not invent one. */
export function serverMonthsVersion(): number {
  return 0;
}

const EMPTY: MonthEntry = { storedAt: 0, loading: false };

export function readMonth(key: string): MonthEntry {
  return months.get(key) ?? EMPTY;
}

export function isFresh(entry: MonthEntry, now = Date.now()): boolean {
  return entry.dataset !== undefined && now - entry.storedAt <= MONTH_TTL_MS;
}

/**
 * Store the range the server rendered.
 *
 * Timestamped when the *server* fetched it rather than when this tab loaded —
 * a page served from a CDN edge is already part-way through its five minutes.
 */
export function seedMonth(key: string, dataset: CuratedDataset): void {
  const existing = months.get(key);
  if (existing?.dataset) return;
  const fetchedAt = Date.parse(dataset.fetchedAt);
  months.set(key, {
    dataset,
    storedAt: Number.isFinite(fetchedAt) ? fetchedAt : Date.now(),
    loading: false,
  });
  publish();
}

async function fetchMonth(
  key: string,
  monthKey: string,
  includeSmaller: boolean,
  deep: boolean,
  signal: AbortSignal,
): Promise<void> {
  const { start, end } = monthGridRange(monthKey);
  const params = new URLSearchParams({ start, end });
  if (includeSmaller) params.set("includeSmaller", "1");
  if (deep) params.set("deep", "1");

  try {
    const response = await fetch(`/api/events?${params.toString()}`, { signal });
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null);
      throw new Error(
        body && typeof body === "object" && "error" in body
          ? String((body as { error: unknown }).error)
          : `Request failed (${response.status})`,
      );
    }
    const dataset = (await response.json()) as CuratedDataset;
    months.set(key, { dataset, storedAt: Date.now(), loading: false });
    publish();
  } catch (error) {
    if (signal.aborted) {
      /*
       * Abandoned on purpose — the reader moved on. Drop the record entirely
       * rather than recording a failure: a cancelled request is not a broken
       * month, and leaving an error behind would make coming back to it show a
       * retry button for something that never went wrong.
       */
      const current = months.get(key);
      if (current?.dataset) months.set(key, { ...current, loading: false, controller: undefined });
      else months.delete(key);
      publish();
      return;
    }
    const current = months.get(key);
    months.set(key, {
      dataset: current?.dataset,
      storedAt: current?.storedAt ?? 0,
      loading: false,
      error: error instanceof Error ? error.message : "Could not load this month.",
    });
    publish();
  }
}

/**
 * Load a month unless it is already fresh or already in flight.
 *
 * Each month owns its own AbortController. The previous design shared one
 * promise between callers and let the *first* caller's signal own the fetch, so
 * a navigation away could abort a request another caller was still waiting on —
 * and the aborted month cached nothing, so arriving there next started from
 * cold.
 */
export function ensureMonth(
  monthKey: string,
  includeSmaller: boolean,
  deep = false,
  options: { force?: boolean } = {},
): void {
  const key = monthCacheKey(monthKey, includeSmaller, deep);
  const entry = months.get(key);
  if (entry?.loading) return;
  if (!options.force && entry && isFresh(entry)) return;

  const controller = new AbortController();
  months.set(key, {
    dataset: entry?.dataset,
    storedAt: entry?.storedAt ?? 0,
    loading: true,
    controller,
  });
  publish();
  void fetchMonth(key, monthKey, includeSmaller, deep, controller.signal);
}

/**
 * Abort everything in flight that nobody is waiting for any more.
 *
 * Clicking September → October → November leaves two requests running for
 * months that are no longer on screen and no longer worth prefetching. The UI
 * was already safe from them — it reads one month by key, so a late response
 * for another cannot overwrite it — but they still occupy connections the month
 * the reader is actually looking at needs.
 */
export function retainMonths(
  wanted: ReadonlySet<string>,
  includeSmaller: boolean,
  deep = false,
): void {
  let changed = false;
  const wantedKind = `${includeSmaller ? "small" : "curated"}${deep ? "+deep" : ""}`;
  for (const [key, entry] of months) {
    if (!entry.loading || !entry.controller) continue;
    const [monthKey, kind] = key.split("|");
    if (kind !== wantedKind) continue;
    if (wanted.has(monthKey)) continue;
    entry.controller.abort();
    changed = true;
  }
  if (changed) publish();
}

/** Test seam. Never called by the app. */
export function resetMonthCache(): void {
  for (const entry of months.values()) entry.controller?.abort();
  months.clear();
  version = 0;
  publish();
}
