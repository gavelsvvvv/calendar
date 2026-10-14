import {
  BROAD_DISCOVERY_SLICES,
  DISCOVERY_SLICES,
  DISCOVERY_SLICE_LIMIT,
} from "@/config/discovery";
import type { GammaEvent } from "./gamma-types";

/**
 * Polymarket Gamma API client.
 *
 * Constraints verified against the live API on 2026-08-04:
 *  - `limit` is hard-capped at 100 (larger values are silently clamped)
 *  - `offset` beyond 2100 returns HTTP 422
 *  - `order=volume&ascending=false` sorts correctly and is stable enough to page
 *  - the default `Python-urllib` UA is rejected, so we always send our own
 *
 * A single month can contain 2,000+ open events, the vast majority of them
 * low-volume sports noise, so we deliberately fetch a *ranked slice* (highest
 * volume first) rather than attempting to page the whole month.
 */

export const GAMMA_BASE_URL = "https://gamma-api.polymarket.com";

/** Gamma's hard limits. */
const MAX_LIMIT = 100;
const MAX_OFFSET = 2000;

export type GammaPageParams = {
  limit?: number;
  offset?: number;
  /** `false` = open only, `true` = resolved only, `undefined` = both. */
  closed?: boolean;
  endDateMin?: string;
  endDateMax?: string;
  order?: string;
  ascending?: boolean;
  tagSlug?: string;
  signal?: AbortSignal;
};

export class GammaError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "GammaError";
  }
}

function buildUrl(params: GammaPageParams): string {
  const url = new URL("/events", GAMMA_BASE_URL);
  const q = url.searchParams;
  q.set("limit", String(Math.min(params.limit ?? MAX_LIMIT, MAX_LIMIT)));
  q.set("offset", String(Math.min(Math.max(params.offset ?? 0, 0), MAX_OFFSET)));
  q.set("order", params.order ?? "volume");
  q.set("ascending", String(params.ascending ?? false));
  if (params.closed !== undefined) q.set("closed", String(params.closed));
  if (params.endDateMin) q.set("end_date_min", params.endDateMin);
  if (params.endDateMax) q.set("end_date_max", params.endDateMax);
  if (params.tagSlug) q.set("tag_slug", params.tagSlug);
  return url.toString();
}

/**
 * How long a built dataset stays fresh, in seconds. Shared by the server-side
 * dataset cache and the `Cache-Control` header on the range endpoint so both
 * layers expire together.
 */
export const GAMMA_REVALIDATE_SECONDS = 300;

/**
 * In-flight request de-duplication. Several calendar cells or a re-render can
 * ask for the same page in the same tick; they should share one network call.
 */
const inFlight = new Map<string, Promise<GammaEvent[]>>();

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Fetch one page of Gamma events, with retry, timeout and de-duplication. */
export async function fetchGammaPage(params: GammaPageParams): Promise<GammaEvent[]> {
  return fetchGammaUrl(buildUrl(params), params.signal);
}

/**
 * One `/events` request, with retry, timeout and in-flight de-duplication.
 *
 * Split out of `fetchGammaPage` so the by-key lookup gets the same handling
 * rather than a second, subtly different fetch beside it.
 */
async function fetchGammaUrl(url: string, paramsSignal?: AbortSignal): Promise<GammaEvent[]> {
  const params = { signal: paramsSignal };

  const existing = inFlight.get(url);
  if (existing) return existing;

  const task = (async (): Promise<GammaEvent[]> => {
    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
      const signal = params.signal
        ? AbortSignal.any([params.signal, timeout])
        : timeout;

      try {
        const res = await fetch(url, {
          signal,
          headers: {
            Accept: "application/json",
            "User-Agent": "PolymarketCalendar/1.0 (+https://calendarpolymarket.com)",
          },
          // Deliberately uncached at this layer. A single Gamma page carries
          // every market of every event with full descriptions and runs 8–14MB,
          // far past Next's 2MB data-cache ceiling — it would reject each entry
          // and log an error while still paying the full transfer. Caching
          // happens one level up in `dataset.ts`, on the adapted payload, which
          // is roughly two orders of magnitude smaller.
          cache: "no-store",
        });

        if (!res.ok) {
          // 4xx other than 429 is a request bug — retrying will not help.
          if (res.status >= 400 && res.status < 500 && res.status !== 429) {
            throw new GammaError(`Gamma responded ${res.status}`, res.status);
          }
          throw new GammaError(`Gamma responded ${res.status}`, res.status);
        }

        const json: unknown = await res.json();
        if (!Array.isArray(json)) {
          throw new GammaError("Gamma returned an unexpected payload shape");
        }
        return json as GammaEvent[];
      } catch (err) {
        lastError = err;
        const status = err instanceof GammaError ? err.status : undefined;
        const retryable = status === undefined || status >= 500 || status === 429;
        if (!retryable || attempt === MAX_ATTEMPTS) break;
        await sleep(250 * 2 ** (attempt - 1));
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new GammaError("Unknown Gamma failure");
  })().finally(() => {
    inFlight.delete(url);
  });

  inFlight.set(url, task);
  return task;
}

/**
 * One event, fetched by slug or numeric id.
 *
 * Deliberately not expressed as a narrow range query, because a range query
 * cannot answer this question. Every ranged fetch above is paged with a fixed
 * budget ordered by volume, so whether a given event comes back depends on how
 * it ranks against everything else closing in that window — an MLB fixture
 * measured as absent from its own month's window while sitting in the next
 * one's. For "give me *this* event" that is the wrong shape entirely: Gamma
 * filters `/events` by slug directly, and ranking never enters into it.
 *
 * Returns `null` for anything Gamma does not know, so a caller can render an
 * honest 404 rather than an exception.
 */
export async function fetchGammaEventByKey(
  key: string,
  signal?: AbortSignal,
): Promise<GammaEvent | null> {
  const url = new URL("/events", GAMMA_BASE_URL);
  // A numeric key is an event id; anything else is a slug. Both are exact
  // filters, so at most one event comes back either way.
  if (/^\d+$/.test(key)) url.searchParams.set("id", key);
  else url.searchParams.set("slug", key);
  url.searchParams.set("limit", "1");

  const events = await fetchGammaUrl(url.toString(), signal);
  return events[0] ?? null;
}

export type RangeQuery = {
  /** Inclusive ISO start of the calendar window. */
  start: string;
  /** Exclusive ISO end of the calendar window. */
  end: string;
  /** How many highest-volume open events to pull. */
  openPages?: number;
  /** How many highest-volume resolved events to pull (populates past days). */
  closedPages?: number;
  /** Per-category tag slices. Off only for tests that want the global pages alone. */
  discovery?: boolean;
  /**
   * Also run the per-sport slices, for a request that wants the Sport/eSport
   * sub-filter tier. Costs ~15 extra pages and ~40MB, so it is off by default
   * and paid for only by the request that asked.
   */
  deep?: boolean;
  signal?: AbortSignal;
};

/**
 * How many Gamma pages may be in flight at once.
 *
 * The fan-out used to be a single `Promise.allSettled` over every request, which
 * was fine at 32 pages and stopped being fine at 47. These responses are not
 * small — a Gamma event carries its entire market book, so one page of tennis is
 * 7.6MB and one of golf is 3MB for twenty rows — and an unbounded fan-out holds
 * every one of them in memory simultaneously, as a raw string *and* as a parsed
 * object graph several times its size. That peak is the thing most likely to end
 * a container, and it grows every time a slice is added.
 *
 * Eight keeps the peak roughly where it was before the sports slices arrived
 * while leaving the request pipeline full: these are latency-bound calls to one
 * upstream host, so the marginal page beyond eight buys throughput measured in
 * noise and costs memory measured in megabytes. It is also politer to Gamma,
 * which is a third party doing us a favour.
 */
const MAX_CONCURRENT_PAGES = 8;

/**
 * `Promise.allSettled` with a ceiling on how many run at once.
 *
 * Results keep the input order, and — like `allSettled` — a rejection is a
 * result rather than an abort, because one dead slug must never blank the
 * calendar.
 */
async function settleWithConcurrency<T>(
  jobs: Array<() => Promise<T>>,
  limit: number,
): Promise<Array<PromiseSettledResult<T>>> {
  const results = new Array<PromiseSettledResult<T>>(jobs.length);
  let next = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      if (index >= jobs.length) return;
      try {
        results[index] = { status: "fulfilled", value: await jobs[index]() };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(limit, jobs.length) }, () => worker()),
  );
  return results;
}

/**
 * Fetch the events whose end date falls inside `[start, end)`.
 *
 * Two kinds of request, run together:
 *
 *  - **Global ranked pages**, highest volume first. These get the events that
 *    are big by any measure — the Champions League final, the Fed decision.
 *  - **Per-category discovery slices**, one ranked page per tag. Global ranking
 *    is a volume contest that sports wins outright: the top 600 events in a
 *    six-week window are 52% sports and stop at $27,740, which is above every
 *    single earnings market Polymarket lists. Without the slices those
 *    categories aren't merely ranked low, they are never retrieved.
 *
 * Open and resolved events are fetched separately because one unfiltered query
 * lets the far more numerous resolved events crowd out upcoming ones. Results
 * overlap heavily and are de-duplicated by id before returning.
 */
export async function fetchEventsInRange(query: RangeQuery): Promise<GammaEvent[]> {
  const {
    start,
    end,
    openPages = 4,
    closedPages = 2,
    discovery = true,
    deep = false,
    signal,
  } = query;

  const jobs: Array<() => Promise<GammaEvent[]>> = [];

  for (let i = 0; i < openPages; i++) {
    jobs.push(() =>
      fetchGammaPage({
        limit: MAX_LIMIT,
        offset: i * MAX_LIMIT,
        closed: false,
        endDateMin: start,
        endDateMax: end,
        signal,
      }),
    );
  }

  for (let i = 0; i < closedPages; i++) {
    jobs.push(() =>
      fetchGammaPage({
        limit: MAX_LIMIT,
        offset: i * MAX_LIMIT,
        closed: true,
        endDateMin: start,
        endDateMax: end,
        signal,
      }),
    );
  }

  if (discovery) {
    const slices = deep ? DISCOVERY_SLICES : BROAD_DISCOVERY_SLICES;
    for (const { slug, limit } of slices) {
      jobs.push(() =>
        fetchGammaPage({
          limit: limit ?? DISCOVERY_SLICE_LIMIT,
          offset: 0,
          closed: false,
          endDateMin: start,
          endDateMax: end,
          tagSlug: slug,
          signal,
        }),
      );
    }
  }

  // A single failed page shouldn't blank the calendar — keep what succeeded.
  const settled = await settleWithConcurrency(jobs, MAX_CONCURRENT_PAGES);
  const ok = settled.filter(
    (r): r is PromiseFulfilledResult<GammaEvent[]> => r.status === "fulfilled",
  );

  if (ok.length === 0) {
    const firstRejection = settled.find(
      (r): r is PromiseRejectedResult => r.status === "rejected",
    );
    throw firstRejection?.reason instanceof Error
      ? firstRejection.reason
      : new GammaError("All Gamma requests failed");
  }

  return dedupeById(ok.flatMap((r) => r.value));
}

/**
 * Collapse the overlap between slices.
 *
 * A big AI event appears in the global pages, in `ai` and in `tech`. Keeping
 * all three copies would inflate a group's summed volume threefold and hand it
 * an importance score it hasn't earned.
 */
function dedupeById(events: GammaEvent[]): GammaEvent[] {
  const byId = new Map<string, GammaEvent>();
  const anonymous: GammaEvent[] = [];
  for (const event of events) {
    const id = event.id === undefined ? "" : String(event.id);
    if (!id) {
      anonymous.push(event);
      continue;
    }
    if (!byId.has(id)) byId.set(id, event);
  }
  return [...byId.values(), ...anonymous];
}
