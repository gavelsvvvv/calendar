import type { CalendarCategory } from "@/lib/curation/types";

/**
 * Category discovery slices.
 *
 * Gamma ranks events by volume, and sports outvolumes everything else by an
 * enormous margin. Measured on a six-week window (2026-08-05): the top 600
 * events are 52% sports, and the *cheapest* one still carries $27,740 of
 * volume. Anything below that line is never fetched at all.
 *
 * A great many events worth putting on a calendar live below it. Every single
 * "Will <company> beat quarterly earnings?" market in that window did — the
 * largest was $19,432. So did 39 of 59 technology events and 26 of 42 AI ones.
 * Ranking globally by volume doesn't just bury those categories, it never
 * retrieves them.
 *
 * Each starved category therefore gets its own ranked slice, requested by tag
 * alongside the global pages. Within a slice the ordering is still volume, so
 * we still get each category's most significant events first — just measured
 * against its own peers rather than against the Champions League.
 *
 * Slugs were probed against the live API on 2026-08-05. Roughly 40% of the
 * plausible-looking ones (`space`, `nasa`, `supreme-court`, `oscars`,
 * `culture`, `war`, `fed`…) return nothing — Polymarket's tag vocabulary is
 * narrower than its topic coverage — so only the ones that actually returned
 * events are listed. A dead slug costs a round trip and yields nothing.
 */

export type DiscoverySlice = {
  slug: string;
  /** The category this slice is here to feed. Documentation, not a constraint —
   *  categories are still resolved from each event's own tags. */
  feeds: CalendarCategory;
  /**
   * Rows to request, when a full page is the wrong size.
   *
   * Every slice is ordered by volume, so a limit is a cut line rather than a
   * sample: `limit: 15` on `bundesliga` means "the fifteen biggest Bundesliga
   * events", and the sixteenth was measured at under $500. Tuned per slice
   * because the pages are wildly different sizes — a Gamma event carries its
   * whole market book, so twenty golf tournaments (150 player markets each)
   * cost 3MB while a hundred cricket events cost 200KB. Left unset, a slice
   * takes `DISCOVERY_SLICE_LIMIT`.
   */
  limit?: number;
  /**
   * Which fetch tier this slice belongs to.
   *
   * `"broad"` slices run on every build — they feed the calendar everyone sees.
   * `"targeted"` slices run only when a request has actually asked for the
   * sub-filter tier, because they exist solely to supply events that are
   * invisible without one.
   *
   * This is what keeps the feature free for readers who never use it: a default
   * build issues the same 32 requests and moves the same ~116MB it always did.
   * The 15 sport slices and the ~40MB they cost are billed to the request that
   * wants them. Defaults to `"broad"`.
   */
  tier?: "broad" | "targeted";
};

/**
 * Deliberately absent:
 *
 * - `crypto`, `elections`, `world` — already abundant in the global ranked
 *   pages; a slice would only re-fetch what we have.
 * - `sports` as a single umbrella slice — its own page bottoms out at $62,000,
 *   which is above the median event in every individual sport. It is replaced
 *   by the per-sport slices below, which are the only route to that supply.
 * - `stocks` — 97 of 100 are "What will Apple (AAPL) hit Week of August 3?",
 *   the equity twin of the crypto price ladders we already exclude. Fetching
 *   the slice would mean fetching a page of noise.
 * - `science` — there is no Science category any more, and this is why. Its
 *   supply is real but almost entirely weather and daily temperature, which the
 *   exclusions remove by design; the bucket could never be anything but empty.
 *   Its few genuine markets now sit under Technology (launches, research) and
 *   World (outbreaks, climate).
 */
const BROAD_SLICES: DiscoverySlice[] = [
  // Politics — the `politics` tag is ~64% election markets, so the US-domestic
  // supply has to be reached through the people and institutions instead.
  { slug: "politics", feeds: "politics" },
  { slug: "trump", feeds: "politics" },
  { slug: "congress", feeds: "politics" },
  { slug: "us-politics", feeds: "politics" },

  // Business — earnings is the densest calendar-shaped category on Polymarket
  // and the single worst served by volume ranking.
  { slug: "earnings", feeds: "business" },
  { slug: "business", feeds: "business" },
  { slug: "ipo", feeds: "business" },

  // Economy — the macro releases the brief asks for by name.
  { slug: "macro-indicators", feeds: "economy" },
  { slug: "inflation", feeds: "economy" },
  { slug: "cpi", feeds: "economy" },
  { slug: "commodities", feeds: "economy" },
  /*
   * The central-bank calendar, and the one slice that reaches all of it.
   *
   * Probed 2026-08-17: `global-rates` returns 27 forward-dated decisions
   * covering the Fed, the ECB, the Bank of Japan, the Bank of Canada, the Bank
   * of England and the RBNZ — the recurring series a reader searches for by
   * name. `fed-rates` (9) and `fomc` (6) are subsets kept because the Fed's own
   * meetings are the most-asked-for series and a single slice ordered by volume
   * can still bury October behind September. `central-bank` returns nothing.
   */
  { slug: "global-rates", feeds: "economy" },
  { slug: "fed-rates", feeds: "economy" },

  // Technology and AI — model releases, launches, "best model end of month".
  { slug: "tech", feeds: "technology" },
  { slug: "big-tech", feeds: "technology" },
  { slug: "ai", feeds: "ai" },
  { slug: "ai-rankings", feeds: "ai" },

  /*
   * eSports — abundant on Polymarket and invisible in a global volume ranking.
   *
   * It used to ride in on the `sports` supply, which was the problem: the top
   * 600 events by volume are half athletics, and an Esports World Cup
   * quarter-final at $166k does not out-trade a Tuesday baseball game at $1.4M.
   * Now that eSports is a category of its own it gets the same treatment as
   * every other starved one — its own ranked slice, measured against its peers.
   *
   * Probed 2026-08-17: `esports` returns a full page across LoL, CS2, Dota and
   * Valorant. `league-of-legends` (73), `counter-strike-2` (52) and `valorant`
   * (20) are kept because the umbrella tag's single page is ordered by volume
   * and one busy game can fill it; `dota` and `csgo` return nothing at all
   * despite appearing in the tag vocabulary.
   */
  { slug: "esports", feeds: "esports" },
  { slug: "league-of-legends", feeds: "esports" },
  { slug: "counter-strike-2", feeds: "esports" },
  { slug: "valorant", feeds: "esports" },

  // Culture — box office, album sales, awards, internet and royals.
  { slug: "pop-culture", feeds: "culture" },
  { slug: "movies", feeds: "culture" },
  { slug: "music", feeds: "culture" },
  { slug: "celebrities", feeds: "culture" },
  { slug: "box-office", feeds: "culture" },
];

/* ------------------------------------------------------------------- sports */

/**
 * Per-sport slices, and why they exist despite the note above.
 *
 * "`sports` is already abundant in the global ranked pages" was true and
 * misleading. Abundant, yes — 52% of the top 600 — but abundance at the *top*
 * of a volume ranking says nothing about what sits below it, and everything a
 * targeted sub-filter wants sits below it.
 *
 * Measured on a live 45-day window (2026-08-25 → 2026-10-19), against
 * everything the previous fetch retrieved:
 *
 * | slice          | new events ≥ $500 | with a real kickoff time |
 * |----------------|-------------------|--------------------------|
 * | tennis         | 78                | 69                       |
 * | soccer         | 57                | 66                       |
 * | nfl            | 36                | 30                       |
 * | premier-league | 26                | 26                       |
 * | la-liga        | 26                | 25                       |
 * | baseball       | 25                | 16                       |
 * | basketball     | 14                | 8                        |
 * | mls            | 13                | 14                       |
 * | ligue-1        | 12                | 10                       |
 * | ufc            | 11                | 11                       |
 * | bundesliga     |  9                | 11                       |
 * | cricket        |  9                |  9                       |
 * | f1             |  5                |  5                       |
 * | golf           |  3                |  3                       |
 * | boxing         |  2                |  2                       |
 *
 * 326 events the calendar could not previously see at any threshold, because
 * the cheapest event in the global ranked pages carried $62,000 of volume and
 * the *median* tennis match carries $10,000. This is the measured answer to
 * "we miss too many sports events, especially tennis": they were never fetched,
 * so no filter could have shown them.
 *
 * Tennis is the headline. Seventy-eight new events, sixty-nine of them
 * individual matches with a scheduled start time — first-round US Open
 * qualifiers, Challenger draws — none of which existed in the dataset before.
 *
 * ### What was probed and rejected
 *
 * Eight plausible slices are deliberately absent because they were measured to
 * add *nothing at all* once the ones above are in: `mlb` (a subset of
 * `baseball`), `wnba` (a subset of `basketball`), `dota-2` (covered by
 * `esports`), `nhl`, `atp`, `wta`, `serie-a`, `champions-league`. `nhl` and
 * `hockey` are the interesting rejects — 38 events, every one of them under
 * $500 of volume, so there is no hockey supply to find rather than a slice
 * missing to find it.
 *
 * A further sixteen returned nothing at all: `us-open-tennis`, `wimbledon`,
 * `roland-garros`, `australian-open`, `college-football`, `ncaaf`, `ncaab`,
 * `euroleague`, `uefa`, `liv-golf`, `ryder-cup`, `mma`, `combat-sports`,
 * `formula-1`, `motogp`, `motorsport`, `ipl`. Polymarket's tag vocabulary is
 * narrower than its topic coverage, and a dead slug costs a round trip.
 *
 * ### The cost, stated plainly
 *
 * These fifteen add ~40MB to a cold build's upstream transfer, on top of the
 * ~116MB it already moved. Gamma has no lighter response shape — `fields`,
 * `include_markets`, `lite` and four other spellings were probed and every one
 * returned the identical 1.6MB — so the only lever is the row count, which is
 * what the per-slice limits are. `fetchEventsInRange` now bounds how many of
 * these are in flight at once so peak memory does not scale with the list.
 */
const SPORT_SLICES: DiscoverySlice[] = [
  { slug: "tennis", feeds: "sports", limit: 100, tier: "targeted" },
  { slug: "soccer", feeds: "sports", limit: 100, tier: "targeted" },
  { slug: "baseball", feeds: "sports", limit: 60, tier: "targeted" },
  { slug: "nfl", feeds: "sports", limit: 50, tier: "targeted" },
  { slug: "premier-league", feeds: "sports", limit: 35, tier: "targeted" },
  { slug: "la-liga", feeds: "sports", limit: 35, tier: "targeted" },
  { slug: "basketball", feeds: "sports", limit: 30, tier: "targeted" },
  { slug: "mls", feeds: "sports", limit: 20, tier: "targeted" },
  { slug: "ligue-1", feeds: "sports", limit: 20, tier: "targeted" },
  { slug: "ufc", feeds: "sports", limit: 20, tier: "targeted" },
  { slug: "bundesliga", feeds: "sports", limit: 15, tier: "targeted" },
  { slug: "cricket", feeds: "sports", limit: 15, tier: "targeted" },
  { slug: "f1", feeds: "sports", limit: 10, tier: "targeted" },
  { slug: "boxing", feeds: "sports", limit: 10, tier: "targeted" },
  // Golf is the worst byte-per-event ratio on the board — a tournament carries
  // a market per player — so it is cut to the five that clear the floor.
  { slug: "golf", feeds: "sports", limit: 5, tier: "targeted" },
];

export const DISCOVERY_SLICES: DiscoverySlice[] = [
  ...BROAD_SLICES,
  ...SPORT_SLICES,
];

/** The slices a build runs when nothing has asked for the sub-filter tier. */
export const BROAD_DISCOVERY_SLICES: DiscoverySlice[] = DISCOVERY_SLICES.filter(
  (slice) => slice.tier !== "targeted",
);


/**
 * How many events to pull per discovery slice.
 *
 * Full pages: the slices are the only route to these categories, and a tagged
 * page is far smaller than a global one (`earnings` is 0.9MB against the global
 * 8.5MB) because the events carry one market each rather than fifty.
 */
export const DISCOVERY_SLICE_LIMIT = 100;
