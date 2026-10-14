import { NextResponse } from "next/server";
import { getEventCatalog } from "@/lib/catalog/catalog";
import { searchEvents } from "@/lib/catalog/search";
import { parseCategories } from "@/lib/url-state";

/**
 * Search across the broad event catalog.
 *
 *   /api/search?q=fed+decision&categories=economy,world
 *
 * Deliberately a separate endpoint from `/api/events`. The calendar's range
 * endpoint answers "what is on screen"; this answers "does an event by roughly
 * this name exist anywhere in the next nine months", and serving the second
 * from the first would mean shipping nine months of events to every visitor to
 * populate a dialog most of them never open.
 *
 * Nothing here reaches the browser until somebody has typed — see the debounced
 * fetch in the search dialog — so the initial calendar render pays nothing for
 * it, and the catalog itself never crosses the wire at all.
 */

export const revalidate = 300;

/** Trimmed for the wire: the search list renders a title, a date and a number. */
const FIELDS = [
  "id",
  "slug",
  "title",
  "shortTitle",
  "displayDate",
  "time",
  "timeKind",
  "isAllDay",
  "endDate",
  "category",
  "status",
  "volume",
  // `liquidity` and `relatedMarketsCount` are read by the details panel and by
  // `probabilityDisplay`, which suppresses a bare percentage on a grouped
  // event by testing `relatedMarketsCount > 1`. Absent, that test is
  // `undefined > 1` — false — so a catalog result rendered an unattributed
  // number where the identical event in the loaded month correctly rendered
  // none, and opening one showed Liquidity as an em dash.
  "liquidity",
  "relatedMarketsCount",
  "probability",
  "leadingOutcome",
  "importanceLevel",
  "importanceScore",
  "primaryMarketUrl",
  "seriesSlug",
  "seriesTitle",
  // Ranking reads tags, so they have to survive the trim. Without them a
  // catalog result could not match by tag while a local one could, and the two
  // halves of one list would be ordered by different rules.
  "tags",
] as const;

const MAX_RESULTS = 25;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = (searchParams.get("q") ?? "").trim();

  // The same parser the URL state and the feeds use, so `categories=none`
  // means an empty result here too rather than quietly becoming everything.
  const categories = parseCategories(searchParams.get("categories"));

  if (categories.length === 0) {
    return NextResponse.json({ results: [], total: 0 }, { headers: HEADERS });
  }

  try {
    const catalog = await getEventCatalog();
    const hits = searchEvents(catalog.events, query, { categories, limit: MAX_RESULTS });

    const results = hits.map(({ event }) => {
      const trimmed: Record<string, unknown> = {};
      for (const field of FIELDS) {
        const value = event[field];
        if (value !== undefined) trimmed[field] = value;
      }
      return trimmed;
    });

    return NextResponse.json(
      { results, total: results.length, catalogRange: catalog.range },
      { headers: HEADERS },
    );
  } catch (error) {
    /*
     * A search that cannot reach the catalog is not a broken page. The dialog
     * still has the loaded month to search locally, so this returns an empty
     * remote result with a reason rather than a status the client has to
     * special-case.
     */
    return NextResponse.json(
      {
        results: [],
        total: 0,
        error: error instanceof Error ? error.message : "Could not reach Polymarket.",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

const HEADERS = { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=900" };
