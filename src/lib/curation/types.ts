/**
 * The shape the calendar renders. One `CuratedCalendarEvent` is one real-world
 * event, not one Polymarket market — the whole point of the curation layer is
 * that "AC Milan vs Inter Milan" appears once, with its exact-score, halftime
 * and more-markets siblings folded in behind it.
 */

/**
 * Eleven buckets. There was a twelfth, "entertainment", and it has been folded
 * into "culture": the two were drawing from the same supply — an awards show is
 * a culture event whichever list you file it under — and splitting them left
 * both thin and made a reader choose between two boxes that meant the same
 * thing. `CATEGORY_ALIASES` keeps old links and existing calendar
 * subscriptions pointing at the right one.
 */
export type CalendarCategory =
  | "politics"
  | "elections"
  | "sports"
  | "esports"
  | "crypto"
  | "economy"
  | "business"
  | "technology"
  | "ai"
  | "world"
  | "culture";

export type ImportanceLevel = "standard" | "important" | "major";

/**
 * Where an event sits in its own lifecycle, decided at the *logical* event
 * level — one status for the whole group, not one per market.
 *
 *  - **upcoming** — ahead of us, still trading.
 *  - **live** — its moment has passed but the book has not settled: the match
 *    is being played, the votes are being counted.
 *  - **resolved** — settled, and something paid out. The question has an answer.
 *  - **closed** — settled with nothing paying out. The book was voided rather
 *    than decided, which is a different thing to tell a reader.
 *  - **cancelled** — Polymarket retired the event. Never a calendar row; it
 *    exists so a subscribed feed can publish a tombstone under the original UID.
 *
 * The distinction that matters most is between the last three and the first
 * two, because a settled event must never be presented as an upcoming one —
 * see `isSettled` and the date override in `buildCuratedEvent`.
 */
export type EventStatus = "upcoming" | "live" | "resolved" | "closed" | "cancelled";

/** Has this event's question been answered, one way or another? */
export function isSettled(status: EventStatus): boolean {
  return status === "resolved" || status === "closed" || status === "cancelled";
}

export type DateConfidence = "confirmed" | "estimated";

import type { DateSource } from "./event-date";
export type { DateSource };

/**
 * Where an event's clock time came from.
 *
 * Gamma has no event start time, so every time on the calendar is derived from
 * when the market stops trading. "scheduled" means Polymarket wrote a specific
 * instant; "close" means it wrote a bare date and the time shown is the day's
 * trading deadline rather than when the thing happens.
 */
export type TimeKind = "scheduled" | "close";

/** One tradeable market inside a curated event, shown in the details panel. */
export type RelatedMarket = {
  id: string;
  title: string;
  url: string;
  probability?: number;
  volume: number;
  liquidity?: number;
  outcome?: string;
};

export type CuratedCalendarEvent = {
  id: string;
  slug: string;
  title: string;
  /** Trimmed for calendar cells, where roughly 30 characters fit. */
  shortTitle: string;
  description?: string;

  startDate?: string;
  endDate: string;
  /** Calendar day key, `YYYY-MM-DD`, bucketed in Polymarket's operating timezone. */
  displayDate: string;
  /** `HH:mm` in market time. Always present; read `timeKind` for what it means. */
  time: string;
  timeKind: TimeKind;
  timezone?: string;
  isAllDay: boolean;
  dateConfidence: DateConfidence;
  /**
   * Which Gamma field put this event on this day.
   *
   * Provenance, not content: it exists so `npm run data:audit` can answer "this
   * is on 14 September because of eventDate" instead of leaving the choice
   * opaque. Deliberately not rendered in the calendar — a reader has no use for
   * the difference between a kickoff and a reviewed deadline, and showing it
   * would invite them to distrust the dates that came from the last rung.
   */
  dateSource: DateSource;
  /**
   * When Polymarket last changed anything about this event, as an ISO instant.
   *
   * The newest `updatedAt` across the event and every market folded into it.
   * Exported as `LAST-MODIFIED`, and the basis of `SEQUENCE` — a subscribed
   * calendar needs to know a revision happened, and a stateless publisher has
   * nothing else to tell it with.
   */
  lastModified?: string;

  category: CalendarCategory;
  subcategory?: string;

  /*
   * Sport / esport classification, for the second-level filters.
   *
   * All optional and all derived from the event's own tags via
   * `lib/sports/taxonomy.ts` — never from a title regex, and never invented.
   * An event whose sport we cannot resolve keeps `sportId: undefined` and stays
   * in the broad category: it is simply not reachable by a targeted filter,
   * which is the safe failure. Misfiling it would be worse than omitting it.
   *
   * `leagueId` is retained but not yet filtered on. The brief asks for a model
   * that can grow a third level (Basketball → NBA / WNBA / NCAA) without
   * re-deriving anything, and this is the cheapest way to be ready for that.
   */
  sportId?: string;
  leagueId?: string;
  leagueName?: string;
  esportGameId?: string;
  /** `match` | `tournament` | `outright` | `prop` — see `resolveEventKind`. */
  eventKind?: string;
  /**
   * This event exists only for a Sport/eSport sub-filter that names its sport.
   *
   * It cleared `TARGETED_VOLUME_FLOOR` ($500) but not its category's broad
   * floor ($250,000 for sports, $100,000 for esports), so it must not appear on
   * the general calendar, in a feed, in search, or under "All Sports" — see
   * `matchesSelection`, which is the single place that rule is enforced.
   *
   * A boolean rather than a numeric tier because it is a *visibility* fact, not
   * a scoring one, and the client needs it in order to filter locally without a
   * refetch. It is deliberately the only piece of curation reasoning that
   * crosses the wire; the score behind it does not.
   *
   * Optional and only ever `true`: the overwhelming majority of events omit it,
   * and an omitted key costs nothing to serialize.
   */
  targetedOnly?: true;

  /**
   * Polymarket's own identifier for a repeating series, e.g. `fomc` for every
   * "Fed Decision in <month>?".
   *
   * The honest way to answer "show me the other Fed decisions": a reader
   * searching "Fed Decision" wants August, September and October, and those are
   * three different real-world dates that must stay three separate events.
   * Grouping them by normalised title would be guesswork — "Fed rate hike in
   * 2026?" reduces to almost the same string and is a different question — so
   * the series comes from Gamma, which carries one on 29 of 34 central-bank
   * events measured on 2026-08-17. `seriesKey` falls back to a normalised title
   * only where Gamma has nothing.
   */
  seriesSlug?: string;
  seriesTitle?: string;

  image?: string;
  icon?: string;

  volume: number;
  liquidity: number;
  openInterest?: number;

  primaryMarketId?: string;
  /** Parent Polymarket event URL when one exists, else the best single market. */
  primaryMarketUrl: string;

  relatedMarketsCount: number;
  relatedMarkets?: RelatedMarket[];

  probability?: number;
  /** Label the probability refers to, e.g. "Yes" or a candidate's name. */
  leadingOutcome?: string;

  importanceScore: number;
  importanceLevel: ImportanceLevel;

  /**
   * Where the whole logical event sits in its lifecycle.
   *
   * `cancelled` events stay in the pipeline rather than being dropped, so a
   * subscribed feed can publish a `STATUS:CANCELLED` tombstone under the
   * original UID and the entry leaves subscribers' calendars. Every calendar
   * view filters them out.
   */
  status: EventStatus;

  source: "polymarket";

  // ---- Provenance, kept for transparency and debugging ----
  /** Gamma event ids folded into this curated event. */
  sourceEventIds: string[];
  /** Which key did the grouping: gameId, parentEventId, negRisk, title, or none. */
  groupedBy: GroupingKind;
  tags: string[];
};

export type GroupingKind =
  | "game-id"
  | "parent-event-id"
  | "neg-risk"
  | "title-core"
  | "single";

/** Why an event never made it onto the calendar. Surfaced in the help copy. */
export type ExclusionReason =
  | "weather"
  | "crypto-price-threshold"
  | "finance-price-threshold"
  | "chatter"
  | "excluded-tag"
  | "below-relevance-floor"
  | "no-usable-date"
  | "no-markets";

export type CurationStats = {
  rawEvents: number;
  afterExclusions: number;
  groups: number;
  curated: number;
  excludedBy: Record<string, number>;
};

/**
 * What became of one raw event, and why.
 *
 * The aggregate `excludedBy` counts tell you that 233 events hit the daily cap;
 * they cannot tell you whether *the one you are looking for* was among them.
 * That question came up as "two CS2 matches are missing and I cannot find out
 * where", and answering it took a throwaway script rebuilding the pipeline by
 * hand. This makes it a first-class output instead.
 *
 * Collected only when a caller asks — see `CurationOptions.diagnostics` — so
 * the calendar's own build pays nothing for it.
 */
export type CurationVerdict = {
  slug: string;
  title: string;
  included: boolean;
  /**
   * Why it was dropped, as a stable machine-readable token: an exclusion rule's
   * own name, `below-relevance-floor`, `duplicate-id`, `over-daily-cap`, or
   * `grouped-into:<slug>` when it was folded into another event rather than
   * rejected.
   */
  reason?: string;
  category?: CalendarCategory;
  displayDate?: string;
  volume?: number;
};

export type CurationOptions = {
  /** Reference "now", injected so scoring and status stay deterministic. */
  now?: Date;
  /** The "Include smaller markets" advanced setting. Off by default. */
  includeSmallerMarkets?: boolean;
  /**
   * Skip the per-day caps.
   *
   * The caps exist because a month cell fits three chips, which is a
   * *presentation* constraint. The search catalog is an index rather than a
   * grid: an event that lost a day's last slot to a bigger one is still an
   * event somebody may search for by name, and hiding it there would make the
   * search worse for no reason anybody could see. Only the catalog passes this.
   */
  skipDailyCaps?: boolean;
  /**
   * Keep events that only a Sport/eSport sub-filter can reach.
   *
   * Off by default, and the default is the important case: those events more
   * than double a month's wire payload (302KB → 655KB, measured on a live
   * September grid), so a reader who never opens the sub-filter must not be
   * carrying them. Curation still *classifies* every event either way — only
   * the final keep/drop differs — so turning this on never changes what an
   * event is, just whether it survives.
   */
  includeTargeted?: boolean;
  /**
   * Pass an array to have curation record a verdict per raw event into it.
   * Absent by default, and the only cost when absent is one undefined check.
   */
  diagnostics?: CurationVerdict[];
};
