import { addMonths, startOfMonth } from "date-fns";
import { getViewRange } from "./calendar";
import type { CuratedDataset } from "./curation/dataset";
import { NO_TARGETED_TIERS, tierKey } from "./curation/types";
import type { TargetedTiers } from "./curation/types";
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
 * `2026-09|curated`, or `2026-09|curated+sports`, or `2026-09|curated+esports,sports`.
 *
 * Two dimensions beyond the month, and neither is a filter. "Smaller markets"
 * is a different calendar; the tier suffix is the same calendar plus one or
 * both Sport/eSport sub-filter tiers, which is a different *response* — more
 * bytes, fetched only once a reader has named a sport. Keeping them in the key
 * is what lets a reader flip between "All Sports" and "Tennis only" without
 * either request clobbering the other's cached month.
 *
 * The tier suffix is `tierKey`'s output and never a sport id, so the key space
 * is eight values per month rather than one per subset — and, crucially, Sport
 * and eSport occupy *separate* segments of it. They used to share one `+deep`
 * flag: narrowing eSport wrote its response over the entry a narrowed Sport had
 * built, and both readers then saw the other's coverage.
 */
function kindOf(includeSmaller: boolean): string {
  return includeSmaller ? "small" : "curated";
}

export function monthCacheKey(
  monthKey: string,
  includeSmaller: boolean,
  targeted: TargetedTiers = NO_TARGETED_TIERS,
): string {
  const tier = tierKey(targeted);
  return `${monthKey}|${kindOf(includeSmaller)}${tier ? `+${tier}` : ""}`;
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

/**
 * The other tiers of the same month, richest first, as a stand-in.
 *
 * Order is "most events first" so the substitute is the least-wrong one
 * available, but any of them is safe: `matchesSubFilter` gates every
 * `targetedOnly` event on the reader's *current* selection, so a stand-in that
 * carries a tier the reader has not asked for cannot show it.
 */
const FALLBACK_TIERS = ["+esports,sports", "+sports", "+esports", ""] as const;

/**
 * This month at this tier — or, until that has landed, the best month we hold.
 *
 * **This is the fix for a blank calendar, and the bug was subtle.** Ticking one
 * sport flips the tier, which changes the cache key, and a key that has never
 * been fetched has no dataset. The hook read that entry, found `undefined`, and
 * rendered `EMPTY_EVENTS` — so narrowing Sport to Tennis emptied *every*
 * category on the grid, politics and crypto included, until the new response
 * landed, and permanently if it 429'd or failed. The comment in the hook
 * claimed the calendar "keeps rendering the data it already has"; nothing
 * implemented that, and this is it.
 *
 * `loading` and `error` are always the *wanted* key's, never the stand-in's, so
 * the spinner tracks the request actually in the air and a failure is still
 * reported rather than hidden behind older data. `fallback` says which of the
 * two is on screen, for callers that need to tell them apart.
 */
export function readMonthFor(
  monthKey: string,
  includeSmaller: boolean,
  targeted: TargetedTiers = NO_TARGETED_TIERS,
): MonthEntry & { fallback: boolean } {
  const wanted = months.get(monthCacheKey(monthKey, includeSmaller, targeted)) ?? EMPTY;
  if (wanted.dataset) {
    return {
      dataset: wanted.dataset,
      storedAt: wanted.storedAt,
      loading: wanted.loading,
      error: wanted.error,
      fallback: false,
    };
  }

  /*
   * Same kind first, then the other one.
   *
   * The second pass is the fix for "Show all" turning the page white. The
   * toggle flips `includeSmaller`, which changes the *kind* in the key, and
   * the fallback only ever searched tiers of the kind being asked for — so
   * there was never anything to stand in, `isLoading` went true, and the whole
   * calendar was swapped for a skeleton for the ten seconds a deep build takes.
   *
   * The other kind is as safe a stand-in as another tier: it is the same month,
   * the dimmed `isRefreshing` treatment says it is being replaced, and going
   * curated → small it is a subset of what is about to arrive, so nothing on
   * screen is about to be contradicted — only joined.
   */
  const kinds = [kindOf(includeSmaller), kindOf(!includeSmaller)];
  for (const kind of kinds) {
    for (const tier of FALLBACK_TIERS) {
      const candidate = months.get(`${monthKey}|${kind}${tier}`);
      if (!candidate?.dataset) continue;
      return {
        dataset: candidate.dataset,
        storedAt: candidate.storedAt,
        loading: wanted.loading,
        error: wanted.error,
        fallback: true,
      };
    }
  }

  return {
    storedAt: wanted.storedAt,
    loading: wanted.loading,
    error: wanted.error,
    fallback: false,
  };
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
  targeted: TargetedTiers,
  signal: AbortSignal,
): Promise<void> {
  const { start, end } = monthGridRange(monthKey);
  const params = new URLSearchParams({ start, end });
  if (includeSmaller) params.set("includeSmaller", "1");
  // The canonical tier string, not the selection: which sports were ticked is
  // the browser's business and never leaves it.
  const tier = tierKey(targeted);
  if (tier) params.set("targeted", tier);

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
  targeted: TargetedTiers = NO_TARGETED_TIERS,
  options: { force?: boolean } = {},
): void {
  const key = monthCacheKey(monthKey, includeSmaller, targeted);
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
  void fetchMonth(key, monthKey, includeSmaller, targeted, controller.signal);
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
  targeted: TargetedTiers = NO_TARGETED_TIERS,
): void {
  let changed = false;
  const tier = tierKey(targeted);
  const wantedKind = `${kindOf(includeSmaller)}${tier ? `+${tier}` : ""}`;
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
