import { NextResponse } from "next/server";
import { isRangeError, normalizeRange } from "@/lib/api/range";
import { toPublicDataset } from "@/lib/api/public-event";
import { charge, checkLimit, clientKey, costOf } from "@/lib/api/rate-limit";
import { buildCuratedDataset, isRangeWarm, withoutRelatedMarkets } from "@/lib/curation/dataset";

/**
 * Curated events for one visible range, used when the client navigates to a
 * month the server didn't render. Only curated events cross the wire — the raw
 * Gamma book stays on the server, and so does everything about how curation
 * works (see `toPublicDataset`).
 *
 * ## This is the expensive endpoint, and it is defended in four layers
 *
 * A cache miss here is an upstream aggregation over a whole month of markets,
 * measured in seconds. Anonymous, unauthenticated, and one HTTP request away —
 * so the protection cannot be a single check.
 *
 *  1. **Normalisation** (`normalizeRange`). The cache and the single-flight map
 *     are keyed on the range, so before this, `…T00:00:00.000Z` and
 *     `…T00:00:00.001Z` were two keys for the same calendar window: neither the
 *     cache nor the coalescing could ever hit, and every request bought a fresh
 *     build. Snapping to UTC days collapses that to a bounded key space.
 *  2. **Range ceiling**, cut from 120 days to 45. Nothing in the product ever
 *     asked for more — the browser requests month grids — so the old limit only
 *     widened the most expensive question a stranger could ask.
 *  3. **Single flight**, already inside `buildCuratedDataset`: twenty concurrent
 *     requests for one cold range share one build. Normalisation is what finally
 *     lets that work, because it is keyed the same way.
 *  4. **Cost-weighted rate limiting**, charged after the fact so a cold build
 *     costs ~20× a cache hit. Ordinary browsing never approaches it; a walk
 *     through unique ranges exhausts it in seconds.
 *
 * Layer 4 is per-process and Railway may run several instances — see
 * `rate-limit.ts` for what that does and does not buy.
 */

export const revalidate = 300;

/** Only reading is supported; everything else is refused before any work. */
const ALLOWED_METHODS = "GET, HEAD, OPTIONS";

function methodNotAllowed() {
  return NextResponse.json(
    { error: "Method not allowed." },
    { status: 405, headers: { Allow: ALLOWED_METHODS } },
  );
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  /*
   * Gate before validating, so a flood of malformed requests is also cheap to
   * refuse. The charge is settled below once the real cost is known.
   */
  const client = clientKey(request);
  const decision = checkLimit(client);
  if (!decision.allowed) {
    // Deliberately says nothing about limits, windows or remaining budget: a
    // rate limiter that reports its own state is a rate limiter you can tune an
    // attack against.
    return NextResponse.json(
      { error: "Too many requests." },
      {
        status: 429,
        headers: {
          "Retry-After": String(decision.retryAfterSeconds),
          "Cache-Control": "no-store",
        },
      },
    );
  }

  const range = normalizeRange(searchParams.get("start"), searchParams.get("end"));
  if (isRangeError(range)) {
    charge(client, 1);
    return NextResponse.json({ error: range.error }, { status: range.status });
  }

  const includeSmallerMarkets = searchParams.get("includeSmaller") === "1";
  /*
   * The Sport/eSport sub-filter tier, requested only by a client that has one
   * active. A boolean flag rather than the selection itself: the server does
   * not need to know *which* sports were ticked — the browser filters the month
   * it already holds — so no sport name from the query string ever reaches a
   * cache key, an upstream request or a response. The one thing this parameter
   * can do is make the request more expensive, which is what the cost below is
   * for.
   */
  const includeTargeted = searchParams.get("deep") === "1";
  const warm = isRangeWarm(range.start, range.end, includeSmallerMarkets, includeTargeted);

  try {
    const dataset = await buildCuratedDataset({
      start: range.start,
      end: range.end,
      includeSmallerMarkets,
      includeTargeted,
    });
    charge(client, costOf({ cold: !warm, days: range.days, deep: includeTargeted }));

    /*
     * A long shared cache life with a longer stale window.
     *
     * `s-maxage=300` matches the in-process TTL. `stale-while-revalidate=3600`
     * is the part that matters under load: for an hour past expiry the edge
     * keeps serving the last good copy and refreshes it in the background, so a
     * traffic burst against a just-expired month is absorbed by one revalidation
     * rather than by a thundering herd. Public market data that is five minutes
     * old is a better answer than a slow one.
     */
    const headers = {
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600",
      // The response varies by nothing a proxy would guess wrong, but be explicit.
      Vary: "Accept-Encoding",
    };

    /*
     * The legs of each event, on request only.
     *
     * Measured on a September grid: 269KB of a 462KB response — 58% of every
     * byte a month costs — is `relatedMarkets`, and the only thing that reads
     * them is the disclosure inside the details panel, for one event at a time.
     * So the calendar gets a payload without them and asks for this map when
     * the browser is idle, or when a panel opens, whichever comes first.
     *
     * Both branches share the same server-side dataset cache, so this second
     * request is a lookup rather than a second curation.
     */
    if (searchParams.get("markets") === "1") {
      const markets: Record<string, unknown> = {};
      for (const event of dataset.events) {
        if (event.relatedMarkets?.length) markets[event.id] = event.relatedMarkets;
      }
      return NextResponse.json({ markets }, { headers });
    }

    return NextResponse.json(toPublicDataset(withoutRelatedMarkets(dataset)), { headers });
  } catch (error) {
    // A failed build still consumed upstream capacity, so it still costs.
    charge(client, costOf({ cold: true, days: range.days, deep: includeTargeted }));
    /*
     * Never reflect the thrown message. It can carry an upstream URL, a
     * timeout's internals or a stack-derived string, and none of that is the
     * caller's business — the previous version returned `error.message`
     * verbatim.
     */
    if (process.env.NODE_ENV !== "production") console.error("[/api/events]", error);
    return NextResponse.json(
      { error: "Could not reach Polymarket." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function POST() {
  return methodNotAllowed();
}
export async function PUT() {
  return methodNotAllowed();
}
export async function PATCH() {
  return methodNotAllowed();
}
export async function DELETE() {
  return methodNotAllowed();
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: { Allow: ALLOWED_METHODS, "Cache-Control": "no-store" },
  });
}
