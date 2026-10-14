import { getCategoryMeta, resolveCategoryId } from "@/lib/categories";
import { buildIcsCalendar } from "@/lib/calendar-export/ics";
import { buildFeedDataset } from "@/lib/curation/dataset";
import {
  ALL_CATEGORIES,
  DEFAULT_FILTERS,
  filterEvents,
  isImportanceLevel,
  matchesSelection,
} from "@/lib/curation/filters";
import { parseCategories } from "@/lib/url-state";
import {
  ESPORT_IDS,
  SPORT_IDS,
  esportMeta,
  parseEsportSelection,
  parseSportSelection,
  sportMeta,
  type EsportId,
  type SportId,
} from "@/lib/sports/taxonomy";
import type { CalendarCategory, ImportanceLevel } from "@/lib/curation/types";

/**
 * Public read-only iCalendar feeds.
 *
 *   /api/calendar/all.ics
 *   /api/calendar/politics.ics
 *   /api/calendar/custom.ics?categories=politics,ai&minImportance=important
 *
 * Feeds are what make the product a *calendar* rather than a website: a
 * subscriber's app re-polls this URL and the events keep themselves current.
 * That only works if UIDs stay stable, which they do — see `icsUid`.
 */

export const revalidate = 900;

function siteUrlFrom(request: Request): string {
  const url = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const host = forwardedHost ?? url.host;
  const proto = forwardedProto ?? url.protocol.replace(":", "");
  return `${proto}://${host}`;
}

function parseImportance(raw: string | null): ImportanceLevel | "all" {
  if (!raw) return "all";
  const value = raw.trim().toLowerCase();
  return isImportanceLevel(value) ? value : "all";
}

export async function GET(
  request: Request,
  context: { params: Promise<{ feed: string }> },
) {
  const { feed } = await context.params;
  const name = feed.replace(/\.ics$/i, "").toLowerCase();

  // A feed name is either "all", "custom", or a category slug. A *retired*
  // category slug resolves to whatever absorbed it rather than 404ing —
  // somebody is subscribed to that exact URL, and a feed that starts returning
  // 404 vanishes from their calendar without telling them why.
  const isCustom = name === "custom";
  const isAll = name === "all";
  const named = isAll || isCustom ? null : resolveCategoryId(name);
  if (!isAll && !isCustom && named === null) {
    return new Response("Unknown calendar feed.", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const { searchParams } = new URL(request.url);
  /*
   * A `custom` feed says which categories it wants; `all` means every one of
   * them, and a named feed means exactly one. `parseCategories` is the same
   * function the URL state uses, so `categories=none` means an empty feed here
   * too rather than quietly becoming "everything" — the divergence that turns a
   * one-category subscription into all eleven.
   */
  const categories: CalendarCategory[] = isCustom
    ? parseCategories(searchParams.get("categories"))
    : named
      ? [named]
      : ALL_CATEGORIES;

  const minImportance = parseImportance(searchParams.get("minImportance"));
  const includeSmallerMarkets = searchParams.get("includeSmaller") === "1";

  /*
   * The Sport / eSport sub-selection, read through the same allowlist the
   * website uses.
   *
   * Absent means every sport, which is what keeps every existing subscription
   * byte-identical. Anything present is filtered against `SPORT_IDS`, so the
   * only values that survive are ones we defined — nothing from this query
   * string reaches a dataset key, a label, or the generated ICS as text. A
   * value that resolves to nothing is an empty selection, not a wildcard: a
   * feed URL asking for something we cannot honour must return no sports
   * rather than silently returning all of them.
   */
  const sportsParam = searchParams.get("sports");
  const esportsParam = searchParams.get("esports");
  const sports: SportId[] =
    sportsParam === null ? [...SPORT_IDS] : parseSportSelection(sportsParam);
  const esports: EsportId[] =
    esportsParam === null ? [...ESPORT_IDS] : parseEsportSelection(esportsParam);

  /*
   * A narrowed feed needs the deeper dataset, for the same reason the website
   * does — the $500 events do not exist in a shallow build, so a tennis feed
   * built from one would be empty. Costed deliberately: this is four month
   * builds rather than one, so it runs only for a subscription that actually
   * narrowed, and the response is cached for fifteen minutes either way.
   */
  const targeted =
    (categories.includes("sports") &&
      sports.length > 0 &&
      sports.length < SPORT_IDS.length) ||
    (categories.includes("esports") &&
      esports.length > 0 &&
      esports.length < ESPORT_IDS.length);

  try {
    const dataset = await buildFeedDataset({
      includeSmallerMarkets,
      includeTargeted: targeted,
    });

    const selection = {
      ...DEFAULT_FILTERS,
      categories,
      search: "",
      minImportance,
      includeSmallerMarkets,
      sports,
      esports,
    };

    /*
     * The same pipeline the website runs, and deliberately nothing else.
     *
     * There used to be one more line here — `dateConfidence === "confirmed"` —
     * an export-only exclusion that dropped events the site was happily
     * showing, with nothing anywhere saying so. A subscriber comparing their
     * calendar against the page they subscribed from would find entries
     * missing and no way to find out why. The uncertainty is still disclosed,
     * in the place a reader can actually act on it: every VEVENT's DESCRIPTION
     * carries "Date is estimated" when it applies.
     */
    const live = filterEvents(dataset.events, selection);

    /*
     * Retracted events, republished rather than dropped.
     *
     * `filterEvents` removes anything cancelled, because a retired event is not
     * a calendar row. A *feed* is the one place it still has a job: a
     * subscriber already has this UID, and simply omitting it leaves the entry
     * sitting in their calendar forever — absence is not a signal. So each
     * cancelled event is matched against the same selection and published with
     * `STATUS:CANCELLED` under its original UID.
     *
     * `matchesSelection` rather than `filterEvents`, because the latter's whole
     * job is to reject these. One rule set, asked a slightly different question.
     */
    const tombstones = dataset.events.filter(
      (e) => e.status === "cancelled" && matchesSelection(e, selection),
    );

    const events = [...live, ...tombstones];

    /*
     * The name the subscriber sees in their calendar app, and it has to survive
     * being read at a glance in a sidebar. Listing all eleven categories when a
     * custom feed happens to select every one of them is a name nobody can
     * read; that case is just the calendar.
     */
    const everything = categories.length === ALL_CATEGORIES.length;
    /*
     * A narrowed sub-filter has to show in the calendar's *name*, because that
     * is the only thing a subscriber sees in their sidebar. Two subscriptions
     * both called "Polymarket Calendar — Sport", one of them tennis-only, is a
     * calendar list nobody can manage.
     *
     * Built from `sportMeta`/`esportMeta` — our own labels, keyed by ids that
     * already survived the allowlist — so no upstream or reader-supplied text
     * can reach the ICS `X-WR-CALNAME`. Capped at three names for the same
     * reason the sidebar summary is: a name is read at a glance.
     */
    const narrowed: string[] = [];
    if (categories.includes("sports") && sports.length < SPORT_IDS.length) {
      narrowed.push(
        sports.length === 0
          ? "no sports"
          : sports.length > 3
            ? `${sports.length} sports`
            : sports.map((id) => sportMeta(id).short).join(", "),
      );
    }
    if (categories.includes("esports") && esports.length < ESPORT_IDS.length) {
      narrowed.push(
        esports.length === 0
          ? "no games"
          : esports.length > 3
            ? `${esports.length} games`
            : esports.map((id) => esportMeta(id).short).join(", "),
      );
    }
    const suffix = narrowed.length > 0 ? ` (${narrowed.join("; ")})` : "";

    const label =
      (isAll || (isCustom && everything && minImportance === "all")) && suffix === ""
        ? "Polymarket Calendar"
        : isCustom || isAll
          ? `Polymarket Calendar${
              isAll || (everything && minImportance === "all")
                ? ""
                : ` — ${
                    categories.length === 0
                      ? "Custom"
                      : everything
                        ? `${minImportance}+`
                        : categories.map((c) => getCategoryMeta(c).label).join(", ")
                  }`
            }${suffix}`
          : `Polymarket Calendar — ${getCategoryMeta(named as CalendarCategory).label}${suffix}`;

    const siteUrl = siteUrlFrom(request);
    const ics = buildIcsCalendar(events, {
      name: label,
      description:
        "Important events with Polymarket markets attached. Independent calendar built on public "
        + "Polymarket data. Not affiliated with or endorsed by Polymarket. Built by gavelsv.",
      siteUrl,
    });

    return new Response(ics, {
      status: 200,
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": `inline; filename="${name}.ics"`,
        // Short enough that a resolved event disappears promptly, long enough
        // that a popular feed doesn't hammer Gamma.
        "Cache-Control": "public, max-age=900, s-maxage=900, stale-while-revalidate=3600",
      },
    });
  } catch (error) {
    // A feed that 500s silently disappears from the subscriber's calendar, so
    // say what went wrong in a form their client will show.
    return new Response(
      `Calendar feed temporarily unavailable: ${
        error instanceof Error ? error.message : "unknown error"
      }`,
      {
        status: 503,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
          "Retry-After": "300",
        },
      },
    );
  }
}
