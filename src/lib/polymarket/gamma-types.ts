/**
 * Raw response shapes from the Polymarket Gamma API.
 *
 * Deliberately loose: Gamma adds and removes fields without notice, and several
 * numeric fields arrive as strings depending on the endpoint. Everything here is
 * optional so a shape drift degrades a single field instead of throwing.
 *
 * Verified against https://gamma-api.polymarket.com/events on 2026-08-04.
 */

export type GammaTag = {
  id?: string;
  label?: string;
  slug?: string;
  forceHide?: boolean;
  forceShow?: boolean;
};

export type GammaMarket = {
  id?: string;
  question?: string;
  conditionId?: string;
  slug?: string;
  /** ISO timestamp. */
  endDate?: string;
  /** `YYYY-MM-DD`. Present once Polymarket has reviewed the dates. */
  endDateIso?: string;
  startDateIso?: string;
  hasReviewedDates?: boolean;
  image?: string;
  icon?: string;
  /** JSON-encoded string array, e.g. `"[\"Yes\", \"No\"]"`. */
  outcomes?: string;
  /** JSON-encoded string array, e.g. `"[\"0.1845\", \"0.8155\"]"`. */
  outcomePrices?: string;
  /** Arrives as a string on /events, as a number on some other endpoints. */
  volume?: string | number;
  volumeNum?: number;
  liquidity?: string | number;
  liquidityNum?: number;
  volume24hr?: number;
  active?: boolean;
  closed?: boolean;
  archived?: boolean;
  /** Label of this leg inside a multi-outcome event, e.g. "Gavin Newsom". */
  groupItemTitle?: string;
  lastTradePrice?: number;
  bestBid?: number;
  bestAsk?: number;
  oneDayPriceChange?: number;
  umaResolutionStatuses?: string;
  /** When Gamma last wrote this row. Drives LAST-MODIFIED and SEQUENCE. */
  updatedAt?: string;
  /**
   * When the underlying real-world event starts — a kickoff, a first serve, a
   * match start. Written as `YYYY-MM-DD HH:mm:ss+00`, not ISO-8601.
   *
   * The authoritative date for anything that has one, and frequently *not* the
   * market's end date: Polymarket sets a sports market's resolution deadline a
   * week after the game.
   */
  gameStartTime?: string;
  /**
   * Where this market sits in UMA's oracle process: unset until the real-world
   * event concludes, then "proposed" -> ("disputed") -> "resolved"/"settled".
   *
   * The most reliable "has this happened yet?" signal Gamma exposes. The
   * `closed` flag on the parent event lags it by hours — Polymarket keeps an
   * event open until the dispute window elapses and every leg settles.
   */
  umaResolutionStatus?: string;
  /**
   * When this market actually settled. Written as `YYYY-MM-DD HH:mm:ss+00`.
   *
   * The only field that says when a decided question was *decided*, and the
   * antidote to a resolution deadline sitting a month past the event. See
   * `resolveSettlementInstant`.
   */
  closedTime?: string;
  /**
   * Reads like the real event start and is not. Present on 5% of markets, and
   * every market of one event carries the identical value down to the
   * millisecond — `2026-07-25T04:02:24.716Z` across the whole WTI August book.
   * A row timestamp. Typed so it is documented rather than rediscovered.
   */
  eventStartTime?: string;
  /** The oracle's own deadline. Close to the real event but not it. */
  umaEndDate?: string;
};

export type GammaSeries = {
  id?: string;
  slug?: string;
  ticker?: string;
  title?: string;
  /** "daily" | "weekly" | "monthly" | "annual" | "hourly" | "15m" | ... */
  recurrence?: string;
  seriesType?: string;
};

/** Sports metadata, present on roughly a quarter of events. */
export type GammaTeam = {
  id?: number;
  name?: string;
  league?: string;
  record?: string;
  logo?: string;
  alias?: string;
};

export type GammaSport = {
  id?: number;
  sport?: string;
  image?: string;
};

export type GammaEvent = {
  id?: string;
  ticker?: string;
  slug?: string;
  title?: string;
  description?: string;
  /**
   * When the *market* opened, never when the event happens. Present on 100% of
   * events and disagreeing with `endDate` on 763 of 765 — which looks like a
   * strong signal until you read one: "Fed Decision in September?" reports
   * 2026-05-13, four months before the meeting. Never a calendar date.
   */
  startDate?: string;
  creationDate?: string;
  /** ISO timestamp — the resolution deadline, and the calendar's last resort. */
  endDate?: string;
  /**
   * Mixed. For a fixture it mirrors `markets[].gameStartTime`; elsewhere it is
   * as likely to be the market's own opening moment, and twice in a measured
   * window it was a year past the event. Allowed to supply a *time* for a day
   * already chosen, never to choose the day — see `curation/event-date.ts`.
   */
  startTime?: string;
  /**
   * `YYYY-MM-DD`, naming the real event day. The only event-level field that
   * describes the real world. 44% coverage, and in the measured window it never
   * appeared without a `gameStartTime` alongside it.
   */
  eventDate?: string;
  image?: string;
  icon?: string;
  active?: boolean;
  closed?: boolean;
  /**
   * When this event settled, ISO-8601. Present once `closed` is true.
   *
   * Measured on "World Cup: Nation of Top Goalscorer": `closedTime`
   * 2026-07-20T00:35:45Z against an `endDate` of 2026-08-20 — a month of dead
   * air in which the calendar was advertising a decided question as upcoming.
   */
  closedTime?: string;
  archived?: boolean;
  new?: boolean;
  featured?: boolean;
  restricted?: boolean;
  liquidity?: number;
  volume?: number;
  openInterest?: number;
  volume24hr?: number;
  volume1wk?: number;
  volume1mo?: number;
  volume1yr?: number;
  competitive?: number;
  commentCount?: number;
  negRisk?: boolean;
  enableOrderBook?: boolean;
  countryName?: string;
  electionType?: string;
  tags?: GammaTag[];
  markets?: GammaMarket[];
  series?: GammaSeries[];
  eventMetadata?: Record<string, unknown>;
  /**
   * When Gamma last wrote this row. Present on 100% of events and markets, and
   * the only honest source for LAST-MODIFIED in a stateless publisher.
   */
  updatedAt?: string;

  // ---- Grouping keys, verified against live data on 2026-08-05 ----
  /**
   * Set on derivative events ("… - Exact Score", "… - More Markets") and points
   * at the canonical event. Only ~5% of events carry it — sports derivatives —
   * so it's a strong signal where present but not a general solution.
   */
  parentEventId?: number | string;
  /**
   * Shared by every event describing the same fixture, including the canonical
   * one. ~22% coverage, and the most reliable sports grouping key there is.
   */
  gameId?: number | string;
  /** Shared across the legs of one neg-risk market group (~56% coverage). */
  negRiskMarketID?: string;
  enableNegRisk?: boolean;
  /** Convenience copy of `series[0].slug` (~64% coverage). */
  seriesSlug?: string;
  teams?: GammaTeam[];
  sport?: GammaSport;
};
