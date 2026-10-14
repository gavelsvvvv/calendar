/**
 * Request range normalisation for the public events API.
 *
 * The reason this file exists is a cache-key problem that reads as a DoS. The
 * server keeps a small LRU of built datasets and coalesces identical in-flight
 * builds, but both are keyed on the raw `start`/`end` strings the caller sent.
 * So `…T00:00:00.000Z` and `…T00:00:00.001Z` are two different keys describing
 * the same calendar window: the cache never hits, the single-flight never
 * coalesces, and every request pays for a fresh upstream aggregation. One
 * client walking the millisecond can push unbounded cold builds through a cache
 * that is working exactly as designed.
 *
 * Normalising fixes it at the root. The product asks for month grids and
 * nothing else — `monthGridRange` in `calendar-cache.ts` is the only caller —
 * so sub-day precision carries no meaning here and is discarded. Two requests
 * describing the same days now share one key, one cache entry and one build.
 */

/**
 * The widest window the browser ever asks for.
 *
 * A month grid is six weeks; 45 days is that plus headroom for a month that
 * starts on a Saturday. The previous ceiling was 120 days, which nothing in the
 * product ever requested — it only widened the most expensive request a
 * stranger could ask for, roughly tripling the upstream work available per call.
 */
export const MAX_RANGE_DAYS = 45;

const DAY_MS = 86_400_000;

export type NormalizedRange = {
  /** Day-aligned UTC start, as an ISO string. */
  start: string;
  /** Day-aligned UTC end, as an ISO string. */
  end: string;
  /** Whole days spanned — the cost signal the rate limiter weighs. */
  days: number;
};

export type RangeError = { error: string; status: 400 };

function startOfUtcDay(ms: number): number {
  return Math.floor(ms / DAY_MS) * DAY_MS;
}

/**
 * Validate and normalise a requested range, or explain why it is not one.
 *
 * `Date.parse` accepts a wide grammar, including things nobody means to send
 * (`"2026"`, `"Aug 20 2026"`). That latitude is fine — the value is immediately
 * snapped to a UTC day boundary and re-serialised, so whatever shape arrived,
 * what leaves is one of a bounded set of canonical strings.
 */
export function normalizeRange(
  rawStart: string | null,
  rawEnd: string | null,
): NormalizedRange | RangeError {
  if (!rawStart || !rawEnd) {
    return { error: "`start` and `end` are required ISO-8601 timestamps.", status: 400 };
  }
  // Bound the input before parsing: `Date.parse` on a megabyte of text is work
  // we should never do on behalf of an anonymous caller.
  if (rawStart.length > 40 || rawEnd.length > 40) {
    return { error: "`start` and `end` must be ISO-8601 timestamps.", status: 400 };
  }

  const startMs = Date.parse(rawStart);
  const endMs = Date.parse(rawEnd);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return { error: "`start` and `end` must be ISO-8601 timestamps.", status: 400 };
  }
  if (endMs <= startMs) {
    return { error: "`end` must be after `start`.", status: 400 };
  }

  const start = startOfUtcDay(startMs);
  // Round the end *up* to the next day boundary, so a range that already ends
  // at midnight keeps its length and one that ends mid-day still covers its
  // last day. Rounding both ends down would silently drop that day's events.
  const end = endMs % DAY_MS === 0 ? endMs : startOfUtcDay(endMs) + DAY_MS;

  const days = Math.round((end - start) / DAY_MS);
  if (days > MAX_RANGE_DAYS) {
    return { error: `Range must be ${MAX_RANGE_DAYS} days or fewer.`, status: 400 };
  }

  /*
   * A window far outside anything the calendar shows is not a real request, and
   * each distinct one is a fresh cold build. Ten years either side is generous
   * for a product whose horizon is a few months.
   */
  const now = Date.now();
  if (start < now - 3650 * DAY_MS || start > now + 3650 * DAY_MS) {
    return { error: "Range is outside the supported window.", status: 400 };
  }

  return {
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString(),
    days,
  };
}

export function isRangeError(value: NormalizedRange | RangeError): value is RangeError {
  return "error" in value;
}
