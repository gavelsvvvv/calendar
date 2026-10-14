/**
 * Cost-weighted rate limiting for the expensive public endpoint.
 *
 * ## Why a plain "N requests per minute" would be wrong here
 *
 * The requests this protects are not interchangeable. A warm month costs a map
 * lookup; a cold 45-day range costs an upstream aggregation measured in seconds.
 * A flat counter has to be tuned for the cheap case to avoid breaking normal
 * browsing, which leaves the expensive case wide open — an attacker simply sends
 * the allowance entirely as cold misses.
 *
 * So this is a token bucket where the *caller declares nothing* and the server
 * charges what the work actually cost. A cache hit is 1 token. A cold build is
 * 20, plus the range's width. Ordinary use never approaches the ceiling, and
 * the abusive pattern — unique ranges, every one a miss — exhausts it in a few
 * seconds.
 *
 * ## Who shares a bucket
 *
 * Keyed on client IP, which on Railway arrives in `x-forwarded-for`. That is a
 * blunt instrument and the tuning reflects it: offices, universities, VPNs and
 * carrier-grade NAT put thousands of legitimate readers behind one address, so
 * the sustained refill is set well above what a single browsing session needs.
 * The burst capacity absorbs a page load and its adjacent-month prefetches
 * (three cold months back to back) without ever touching the limit.
 *
 * ## What this does not do
 *
 * It is per-process. Railway may run several instances, and each keeps its own
 * buckets, so the effective ceiling is the limit multiplied by the instance
 * count. That is acceptable for this threat — the goal is to stop one cheap
 * script from monopolising upstream capacity, not to enforce a billing quota —
 * but it is not a substitute for edge protection against a volumetric attack,
 * which has to be solved above the application. Documented rather than papered
 * over.
 */

/**
 * Tokens a bucket holds when full — the burst allowance.
 *
 * Sized from the real worst case rather than a round number. A cold month costs
 * `COST_COLD_BUILD` plus two per week of range: 20 + 12 = 32 for a six-week
 * grid. A first page load builds the visible month and prefetches both
 * neighbours, so three cold builds — 96 tokens — before the reader has done
 * anything. 300 leaves room for that plus a long session of navigation without
 * ever approaching the limit, which is the requirement: a shared office IP must
 * not be throttled for browsing normally.
 */
const BUCKET_CAPACITY = 300;
/**
 * Tokens restored per second.
 *
 * Sustained, this is one cold month roughly every three seconds per address, or
 * 600 cache hits a minute. Comfortably above any human, and far below what makes
 * unique-range abuse worthwhile.
 */
const REFILL_PER_SECOND = 10;

/** A served-from-cache response. Cheap enough to be nearly free. */
export const COST_CACHE_HIT = 1;
/** A cold build: upstream fetch, grouping, scoring, per-day caps. */
export const COST_COLD_BUILD = 20;
/** Extra tokens per week of range, so a wide window costs more than a narrow one. */
export const COST_PER_WEEK = 2;
/**
 * Multiplier for a build that also fetches the Sport/eSport sub-filter tier.
 *
 * Measured rather than picked: a deep build issues 47 upstream pages against a
 * shallow one's 32 and moves ~156MB against ~116MB. Charging it the same as a
 * shallow build would leave the cheapest way to exhaust our upstream budget
 * sitting behind a query parameter — which is precisely the hole the
 * cost-weighting exists to close.
 */
export const COST_DEEP_MULTIPLIER = 2;

type Bucket = { tokens: number; updatedAt: number };

const buckets = new Map<string, Bucket>();

/**
 * Cap on distinct tracked clients.
 *
 * Without it the limiter is itself a memory-exhaustion vector: every spoofed
 * `x-forwarded-for` would mint a permanent entry. Eviction is oldest-first,
 * which is the right bias — a client that has not been seen recently has a full
 * bucket anyway, so forgetting it costs nothing.
 */
const MAX_TRACKED_CLIENTS = 10_000;

function bucketFor(key: string, now: number): Bucket {
  const existing = buckets.get(key);
  if (existing) {
    const elapsedSeconds = (now - existing.updatedAt) / 1000;
    existing.tokens = Math.min(
      BUCKET_CAPACITY,
      existing.tokens + elapsedSeconds * REFILL_PER_SECOND,
    );
    existing.updatedAt = now;
    // Re-insert so Map iteration order stays least-recently-used first.
    buckets.delete(key);
    buckets.set(key, existing);
    return existing;
  }

  const fresh: Bucket = { tokens: BUCKET_CAPACITY, updatedAt: now };
  buckets.set(key, fresh);
  while (buckets.size > MAX_TRACKED_CLIENTS) {
    const oldest = buckets.keys().next().value;
    if (oldest === undefined) break;
    buckets.delete(oldest);
  }
  return fresh;
}

/**
 * The client's address, as far as it can be trusted.
 *
 * Railway's edge sets `x-forwarded-for` and appends to any value the client
 * sent, so the *left-most* entry is attacker-controlled and the right-most is
 * the one the edge observed. Taking the right-most is what stops a caller from
 * minting a new identity per request by sending their own header.
 */
export function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const parts = forwarded.split(",").map((p) => p.trim()).filter(Boolean);
    const edgeObserved = parts[parts.length - 1];
    if (edgeObserved) return edgeObserved.slice(0, 64);
  }
  return request.headers.get("x-real-ip")?.slice(0, 64) ?? "unknown";
}

export type RateDecision =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

/**
 * Check whether a request may proceed, without charging for it yet.
 *
 * Split from `charge` on purpose: the cost of a request is not known until it
 * has been served — we cannot tell a cache hit from a cold build in advance —
 * so the gate runs first with a minimum cost and the true cost is settled after.
 */
export function checkLimit(key: string, now = Date.now()): RateDecision {
  const bucket = bucketFor(key, now);
  if (bucket.tokens >= COST_CACHE_HIT) return { allowed: true };
  const deficit = COST_CACHE_HIT - bucket.tokens;
  return {
    allowed: false,
    // Round up, and never advertise zero — a `Retry-After: 0` invites an
    // immediate retry, which is the behaviour we are trying to dampen.
    retryAfterSeconds: Math.max(1, Math.ceil(deficit / REFILL_PER_SECOND)),
  };
}

/**
 * Settle the true cost of a served request. Tokens may go negative, which is
 * deliberate: an expensive request the bucket could not really afford puts the
 * caller into debt they have to wait off, rather than being rounded to zero.
 */
export function charge(key: string, cost: number, now = Date.now()): void {
  const bucket = bucketFor(key, now);
  bucket.tokens = Math.max(-BUCKET_CAPACITY, bucket.tokens - cost);
}

/** Cost of a response, in tokens. */
export function costOf(options: {
  cold: boolean;
  days: number;
  deep?: boolean;
}): number {
  const base = options.cold ? COST_COLD_BUILD : COST_CACHE_HIT;
  const total = base + (options.cold ? Math.ceil(options.days / 7) * COST_PER_WEEK : 0);
  // A warm deep response is still just a map lookup, so only a cold one pays.
  return options.deep && options.cold ? total * COST_DEEP_MULTIPLIER : total;
}

/** Testing seam — the limiter is process-global state. */
export function resetRateLimiter(): void {
  buckets.clear();
}

export const RATE_LIMIT_SETTINGS = {
  BUCKET_CAPACITY,
  REFILL_PER_SECOND,
  MAX_TRACKED_CLIENTS,
} as const;
