/**
 * Curation rules for the calendar.
 *
 * Every decision about what does *not* belong on the calendar lives here, so the
 * rules can be reviewed and tested in one place rather than being rediscovered
 * inside components.
 *
 * The rules are grounded in a live audit of the Gamma API (1,000 open events,
 * Aug–Sep 2026). Two findings shaped them:
 *
 *  1. Volume cannot separate signal from noise. "Highest temperature in …"
 *     markets have a *median* volume of $25,921 — five times the median sports
 *     event ($5,021). A global threshold would delete real fixtures and keep the
 *     weather spam. Noise families therefore have to be named explicitly.
 *
 *  2. Recurrence alone cannot either. 511 of 1,000 events sit in a `daily`
 *     series, but most of those are individual esports matches — genuinely
 *     distinct real-world events. Recurrence only indicates noise in combination
 *     with a templated title.
 */

/** A named family of markets that should never reach the calendar. */
export type ExclusionRule = {
  id: string;
  /** Shown in the "why was this excluded" help copy. */
  label: string;
  /** Case-insensitive patterns tested against the event title. */
  patterns: RegExp[];
  /**
   * When set, the rule only fires if the event also looks short-lived — this is
   * what separates "Bitcoin above ___ on August 5?" (noise) from
   * "What price will Bitcoin hit in August?" (a real monthly milestone).
   */
  maxDurationDays?: number;
};

/**
 * Weather. Polymarket runs a daily temperature market for dozens of cities;
 * none of them is an event anybody plans around.
 */
export const WEATHER_EXCLUSIONS: ExclusionRule = {
  id: "weather",
  label: "Daily weather and temperature markets",
  patterns: [
    /\bhighest\s+temperature\b/i,
    /\blowest\s+temperature\b/i,
    /\bmaximum\s+temperature\b/i,
    /\bminimum\s+temperature\b/i,
    /\bdaily\s+temperature\b/i,
    /\btemperature\s+in\b/i,
    /\bweather\s+in\b/i,
    /\bprecipitation\b/i,
    /\brainfall\b/i,
    /\bsnowfall\b/i,
    /\bwind\s+speed\b/i,
    /\bdegrees\s+(fahrenheit|celsius)\b/i,
  ],
};

/** Assets whose daily threshold markets repeat forever. */
const CRYPTO_ASSETS =
  "bitcoin|ethereum|solana|btc|eth|sol|xrp|ripple|dogecoin|doge|cardano|ada|avalanche|avax|chainlink|link|polygon|matic|litecoin|ltc|binance coin|bnb";

/**
 * Repetitive crypto price markets.
 *
 * Scoped to short-lived events so genuine milestone markets survive: a market
 * asking where Bitcoin lands *this month* runs for weeks and is a real thing to
 * watch; "Bitcoin above ___ on August 5?" opens and closes inside a day.
 */
export const CRYPTO_PRICE_EXCLUSIONS: ExclusionRule = {
  id: "crypto-price-threshold",
  label: "Repetitive short-term crypto price markets",
  maxDurationDays: 8,
  patterns: [
    new RegExp(`\\b(${CRYPTO_ASSETS})\\b[^?]*\\b(above|below|between)\\b`, "i"),
    new RegExp(`\\b(${CRYPTO_ASSETS})\\b[^?]*\\bup or down\\b`, "i"),
    new RegExp(`\\b(${CRYPTO_ASSETS})\\b[^?]*\\bprice on\\b`, "i"),
    new RegExp(`\\bwhat price will (${CRYPTO_ASSETS})\\b[^?]*\\b(hit )?(today|tomorrow|on \\w+ \\d)`, "i"),
    new RegExp(`\\b(${CRYPTO_ASSETS})\\b.*\\bdip to\\b`, "i"),
  ],
};

/** Index, commodity and FX tickers that get the same daily-threshold treatment. */
const FINANCE_ASSETS =
  "s&p\\s*500|s&p|nasdaq|dow jones|dow|russell|ftse|dax|nikkei|gold|xauusd|silver|oil|wti|brent|crude|natural gas|eur/usd|usd/jpy|gbp/usd|dxy|vix";

export const FINANCE_PRICE_EXCLUSIONS: ExclusionRule = {
  id: "finance-price-threshold",
  label: "Repetitive short-term index, commodity and FX markets",
  maxDurationDays: 8,
  patterns: [
    new RegExp(`\\b(${FINANCE_ASSETS})\\b[^?]*\\b(above|below|between)\\b`, "i"),
    new RegExp(`\\b(${FINANCE_ASSETS})\\b[^?]*\\bup or down\\b`, "i"),
    new RegExp(`\\bwhat will (${FINANCE_ASSETS})\\b[^?]*\\bhit\\b[^?]*\\b(today|week of)\\b`, "i"),
  ],
};

/**
 * Equity and ETF price ladders.
 *
 * The stock twin of the crypto rules, and the reason the `stocks` tag is not a
 * discovery slice: 97 of its 100 highest-volume events are
 * "What will Apple (AAPL) hit Week of August 3 2026?" — a fresh ladder every
 * week for every ticker.
 *
 * Duration is not the discriminator here, because the weekly and monthly
 * variants are worded identically and the monthly one runs long enough to slip
 * past any window. The cadence in the title is, so these rules read it directly
 * and leave "What will Apple (AAPL) hit in August 2026?" alone. A ticker in
 * parentheses is the tell that this is a price feed rather than a company
 * event.
 */
export const EQUITY_PRICE_EXCLUSIONS: ExclusionRule = {
  id: "equity-price-threshold",
  label: "Weekly and daily stock price ladders",
  patterns: [
    /\bwhat will\b[^?]*\([A-Z.]{1,6}\)[^?]*\bhit\b[^?]*\bweek of\b/i,
    /\bwhat will\b[^?]*\([A-Z.]{1,6}\)[^?]*\bhit\b[^?]*\b(today|tomorrow)\b/i,
    /\([A-Z.]{1,6}\)\s+up or down\b/i,
    /\b(gpu|rtx|h100|h200|b200)\b[^?]*\brental prices?\b/i,
  ],
};

/**
 * Templated "what will X say / post / mention" markets, and the counters that
 * come with them.
 *
 * These are the largest noise family outside weather and price ladders, and the
 * most damaging to a calendar: they attach to real, prominent names — Trump,
 * the White House press secretary, an earnings call — so they read as important
 * and cluster on exactly the dates real political events land on. None of them
 * describes a scheduled event; they re-open weekly with the same wording.
 *
 * "What will Trump say during remarks in Las Vegas?" is the shape to keep in
 * mind: there *is* a scheduled speech underneath, but the market is on the
 * vocabulary, and a dozen of them will bury the speech itself.
 */
export const CHATTER_EXCLUSIONS: ExclusionRule = {
  id: "chatter",
  label: "Recurring soundbite, post and follower counters",
  patterns: [
    /#\s*tweets?\b/i,
    /#\s*truth social posts\b/i,
    // "NYC Mayor # posts July 31 - August 7, 2026?" — the same counter family
    // with the platform left out. Six of them shared one slot in the week grid.
    /#\s*posts\b/i,
    /\bhow many (tweets|posts)\b/i,
    /\bmentions? of\b.*\bduring\b/i,
    /\bwill .* publicly insult\b/i,
    // "What will X say/post/mention …", including the passive "What will be said …".
    /\bwhat will\b[^?]*\b(say|says|said|post|posts|posted|mention|mentions|tweet|tweets)\b/i,
    /\bwhat will be said\b/i,
    /\bwhat (words|phrases|places|topics|names|things)\b[^?]*\bwill\b[^?]*\b(say|mention|post)/i,
    /\bwhat (words|phrases|places|topics|names)\b[^?]*\bwill\b/i,
    /\bwho will .* publicly (praise|thank|criticiz|criticis|attack)/i,
    /\bwho will .* speak to\b/i,
    // The mechanics of a press schedule, not the events on it.
    /\bhow long will\b[^?]*\b(remarks|speech|address|briefing|press conference)\b/i,
    /\bfull lid\b/i,
    // "Donald Trump tie color during Las Vegas remarks?" — there is a real
    // speech underneath, and this is a market on the wardrobe.
    /\b(tie|shirt|suit|hat|outfit|jacket|dress) colou?r\b/i,
    // Follower / subscriber / view / listener ladders. `#` is not a word
    // character, so these deliberately have no leading \b — "video? # of views"
    // has no boundary between the space and the hash, and an earlier version of
    // these patterns silently matched nothing at all.
    /\b(subscribers?|followers?|monthly listeners|views)\b[^?]*\bhits?\b/i,
    /\bhits? __+\b[^?]*\b(million|billion)\b/i,
    /#\s*of views\b/i,
  ],
};

/**
 * Markets on a named individual's private life, and on the readouts that
 * accompany them. A divorce or a net-worth figure has no scheduled date, no
 * venue and nothing to plan around — it is speculation attached to a deadline.
 */
export const PERSONAL_EXCLUSIONS: ExclusionRule = {
  id: "personal-speculation",
  label: "Private-life speculation and personal-wealth readouts",
  patterns: [
    /\bnet worth (on|end of|by)\b/i,
    /\b(divorce|divorced|engaged|breaks? up|break-?up|paternity)\b[^?]*\bby\b/i,
    /\bwho will .* (marry|date)\b/i,
  ],
};

/**
 * Recurring charts, leaderboards and eliminations.
 *
 * A new #1 single every Friday, a new best-model-today every Monday and a new
 * eviction every week are readouts on a timetable, not events. The occasions
 * they feed into — the Grammys, a model launch, a series finale — are real, are
 * worded nothing like this, and survive.
 *
 * Note the absent `\b` before each `#`: a hash is not a word character, so
 * `\b#` only matches when the preceding character *is* one. After a space it
 * never fires, which is how "Billboard Hot 100 #1 Song Week of August 15" got
 * through an earlier version of this rule.
 */
export const CHART_EXCLUSIONS: ExclusionRule = {
  id: "recurring-chart",
  label: "Weekly charts, leaderboards and eliminations",
  patterns: [
    /\b(billboard hot 100|billboard|spotify|apple music|itunes)\b[^?]*(#\s*\d+|top \d+|number \d+)/i,
    /(#\s*\d+)\s+(spotify|billboard|itunes|apple music)\b/i,
    /\bsong (of the week|this week)\b/i,
    /\b(song|single|track|album)\b[^?]*\bthis week\b/i,
    // "Third-best Text Arena Math AI Lab end of August?" — a leaderboard
    // standing wearing a monthly date.
    /((#\s*\d+)|\b(\d+(st|nd|rd|th)-?\s*(best|place)|second-best|third-best))[^?]*\b(arena|leaderboard|lab|ranking)\b/i,
    // "Best AI model on August 10?" reruns every week. "Best AI model end of
    // August?" is a monthly milestone and stays — the same line drawn between a
    // daily crypto ladder and a monthly one.
    /\bbest\b[^?]*\bon \w+ \d{1,2}\??\s*$/i,
    // "Who will be evicted from Big Brother? (Week 4)". The week marker sits
    // *after* the question mark, so this one has to be allowed to cross it.
    /\b(evicted|eliminated|voted off|sent home)\b.*\bweek \d+/i,
  ],
};

export const EXCLUSION_RULES: ExclusionRule[] = [
  WEATHER_EXCLUSIONS,
  CRYPTO_PRICE_EXCLUSIONS,
  FINANCE_PRICE_EXCLUSIONS,
  EQUITY_PRICE_EXCLUSIONS,
  CHATTER_EXCLUSIONS,
  CHART_EXCLUSIONS,
  PERSONAL_EXCLUSIONS,
];

/**
 * Titles matching these keep their place regardless of the rules above — the
 * escape hatch for genuinely significant events that happen to mention a
 * excluded asset. An ETF approval is not a daily price market.
 */
export const EXCLUSION_EXCEPTIONS: RegExp[] = [
  /\betf\b/i,
  /\bapprov(al|e[sd]?)\b/i,
  /\bsec\b/i,
  /\bregulat/i,
  /\bhalving\b/i,
  /\bupgrade\b/i,
  /\bhard ?fork\b/i,
  /\bmainnet\b/i,
  /\bunlock\b/i,
  /\bairdrop\b/i,
  /\blaunch(es|ed|ing)?\b/i,
  /\blisting\b/i,
  /\bstrategic reserve\b/i,
  /\btreasury\b/i,
  /\bbankrupt/i,
  /\blawsuit\b/i,
  /\bruling\b/i,
  /\bindict/i,
  /\bacquisition\b/i,
  /\bmerger\b/i,
  /\bipo\b/i,
];

/**
 * Tag slugs that mark an event as operational rather than topical. An event
 * carrying only these is scaffolding, not something to put on a calendar.
 */
export const IGNORED_TAG_SLUGS = new Set([
  "hide-from-new",
  "parent-for-derivative",
  "multi-strikes",
  "up-or-down",
  "hit-price",
  "pre-market",
  "daily-temperature",
  "highest-temperature",
  "lowest-temperature",
]);

/**
 * Tags that on their own are enough to drop an event, because the entire tag is
 * a noise family.
 */
export const EXCLUDED_TAG_SLUGS = new Set([
  "daily-temperature",
  "highest-temperature",
  "lowest-temperature",
  "weather",
]);

/**
 * Title suffixes that mark an event as a *derivative* of another one. Grouping
 * strips these to find the real-world event underneath, and the canonical
 * member of a group is the one that needed no stripping.
 *
 * Ordered longest-first so "Margin of Victory" wins over "Victory".
 */
export const DERIVATIVE_SUFFIXES: string[] = [
  "margin of victory",
  "first team to score",
  "which team scores first",
  "total corners",
  "total goals",
  "total points",
  "total runs",
  "halftime result",
  "half time result",
  "half-time result",
  "double chance",
  "both teams to score",
  "correct score",
  "exact score",
  "more markets",
  "player props",
  "vote share",
  "second place",
  "third place",
  "2nd place",
  "3rd place",
  "turnout",
  "spread",
  "moneyline",
  "over/under",
  "winner",
  "first round",
  "second round",
];

/**
 * Category-aware relevance floors.
 *
 * A floor answers "is this big enough to matter?", and *enough* is only ever
 * meaningful relative to the category's own market. The first version of this
 * table set every category within a factor of three of $25,000, which sounds
 * even-handed and is not: measured across a six-week window (2026-08-05, after
 * named exclusions), the median event by category runs
 *
 *     sports    $1,272,812      economy       $42,996
 *     crypto    $1,873,149      ai            $23,637
 *     world       $166,107      politics      $12,007
 *     elections    $90,433      culture        $4,170
 *                               technology     $4,244
 *                               business       $1,778
 *
 * (That culture figure was measured as "entertainment", before the two were
 * merged; the supply is the same, the label moved.)
 *
 * Three orders of magnitude. A $20,000 floor is barely perceptible to sports
 * and total annihilation for business — the largest business event Polymarket
 * listed in that window traded $19,432, so the floor removed the category
 * entirely. Politics lost 70% of its supply, technology 60%.
 *
 * Each floor now sits near its own category's p25–p35, keeping roughly the
 * meaningful two thirds. What keeps that honest is not the number: it is that
 * the noise families above are named and removed *before* the floor is
 * consulted. The floor is for judging real events against their peers, not for
 * taking out the rubbish.
 */
export const CATEGORY_VOLUME_FLOORS: Record<string, number> = {
  /**
   * Sports is held to a bar no other category comes near, on purpose.
   *
   * This is not a calendar for sport. Sport is simply the only category with
   * something on almost every day of the year, so left on the same footing as
   * everything else it wins by attrition rather than by mattering.
   *
   * $250,000 rather than the $50,000 that first seemed high: measured on a live
   * six-week window, the sports already reaching the calendar had a *median*
   * volume of $1.9M and a minimum of $48k, so a $50k bar would have removed a
   * single event. This one removes the tail that isn't really an occasion — a
   * PGA Tour placeholder, "Will Valve add Cobblestone to the map pool?", a
   * fourth-tier fixture — and leaves finals, playoffs and derbies.
   */
  sports: 250_000,
  /**
   * Esports is held high too, but not as high, because its whole book is
   * smaller.
   *
   * While esports *was* Sports it inherited the $250,000 bar, and that bar is
   * calibrated against a book whose median is $1.9M. An Esports World Cup
   * quarter-final trades ~$166k, so the discounts a broad, liquid match earns
   * were the only thing keeping it on the calendar at all. $100,000 is the
   * same idea applied to the right scale: it clears the tail of qualifiers and
   * group-stage filler and keeps the matches an audience actually schedules
   * around. The per-day cap of two does the rest of the work.
   */
  esports: 100_000,
  crypto: 25_000,
  world: 30_000,
  elections: 25_000,

  // Mid-scale.
  economy: 8_000,
  ai: 5_000,
  politics: 6_000,

  // Thin by nature. An earnings market or a model-release market carries a
  // fraction of a football match's volume and is a far better calendar entry.
  technology: 3_000,
  culture: 3_000,
  business: 2_000,
};

/** Applied when a category has no explicit floor. */
export const DEFAULT_VOLUME_FLOOR = 15_000;

/**
 * With "Include smaller markets" turned on, floors drop to this fraction rather
 * than disappearing — even then, a $200 market is not an event.
 */
export const RELAXED_FLOOR_FACTOR = 0.08;

/**
 * Nothing below this reaches the calendar, in any mode — not with "Include
 * smaller markets" on, not in a thin category, not with every breadth discount
 * applied. Below four figures a market has no price discovery worth reading and
 * is noise whatever it is about.
 */
export const ABSOLUTE_VOLUME_FLOOR = 1_000;

/**
 * Per-day caps.
 *
 * Relevance floors decide what is worth showing; these decide how much of it
 * fits on one day. Without them a single Tuesday carried 42 sports fixtures out
 * of 48 events — technically all above the floor, but a calendar nobody can
 * read, and one where an election is buried under lower-league football.
 *
 * Sports is capped hardest because Polymarket lists an order of magnitude more
 * of it than anything else; the cap keeps the day's *biggest* fixtures and drops
 * the tail.
 */
export const MAX_EVENTS_PER_CATEGORY_PER_DAY: Partial<Record<string, number>> = {
  // Three, not five. Sports is the only category with something on almost every
  // day of the year — 28 days out of 37, against 3 for politics — so its cap
  // alone decides how sport-heavy the calendar reads. At five it was 40% of the
  // calendar, and of those, three events were knockout matches and eighty-nine
  // were regular season or group stage. A Tuesday MLB game trades $1.4M, more
  // than the Fed decision that week, and is still not something anyone puts in
  // a diary.
  //
  // Two, with a $250,000 floor beneath it: the floor decides *which* fixtures
  // qualify, but only the cap decides how many of them land on a given day, and
  // there are always more $1M fixtures available to backfill with.
  sports: 2,

  /*
   * Esports competes for its own two slots rather than the athletics pair.
   *
   * Not a user-facing category — a reader still filters on "Sports" and gets
   * both — but a separate allowance, because sharing one made esports
   * structurally invisible. Measured on a live August window: 156 esports
   * events reached the daily cap and 30 survived it, since the cap is settled
   * on a volume-driven score and a Tuesday MLB game trades $1.4M against a CS2
   * Esports World Cup quarter-final's $125k. Two whole days of the Esports
   * World Cup were absent from the calendar.
   *
   * Two, matching athletics, for the same reason athletics is two: it is
   * enough for the day's biggest fixtures and not enough to turn a Tuesday
   * into a match list. Raising the shared `sports` cap to four instead would
   * simply have been four baseball games.
   */
  esports: 2,

  world: 6,
};

/**
 * The floor for an event reachable only through a Sport/eSport sub-filter.
 *
 * ## Why there are two floors rather than one
 *
 * The broad Sports floor is $250,000, and it is right. Sport is the only
 * category with something on almost every day of the year, so on a shared
 * calendar it wins by attrition unless it is held to a bar the occasion has to
 * clear. Nothing here changes that: a reader who has not touched the sub-filter
 * sees exactly the calendar they saw before.
 *
 * But that bar is answering "does this belong on a general calendar", and a
 * reader who has explicitly asked for *tennis only* is asking a different
 * question. Measured on a live 45-day window, the median tennis match on
 * Polymarket trades $10,000 and the median individual fixture across all sports
 * trades $2,074 — against a $250,000 floor. 92 of 104 fixtures were below it.
 * A tennis filter over that dataset is a filter over an empty set, which is the
 * reported problem: "we currently miss too many sports events, especially
 * tennis."
 *
 * $500 is deliberately near the absolute floor rather than a compromise
 * between the two. Once a reader has named the sport, volume is no longer
 * standing in for "is this worth a general audience's attention" — the reader
 * has answered that — and its only remaining job is to separate a real fixture
 * from an untraded stub. $500 does that: on the measured window it admits 434
 * events and excludes the 38 hockey rows that carry a dollar or less between
 * them.
 *
 * This floor is reachable *only* through an explicit sub-selection. An event
 * that clears it without clearing its category's broad floor is marked
 * `targetedOnly` and is invisible everywhere else — the month grid, the feeds,
 * search, and "All Sports" alike.
 */
export const TARGETED_VOLUME_FLOOR = 500;

/**
 * Most events of one sport on one day, in the targeted tier.
 *
 * A cap is still needed even though the reader asked for the sport. US Open
 * qualifying runs two sessions of thirty-two matches on a single day, and a
 * day cell listing forty tennis rows is a market list rather than a calendar —
 * the same failure the broad per-day caps exist to prevent, arrived at from the
 * other direction.
 *
 * Twelve rather than two, because the reader's intent is different: they named
 * the sport, so the day's fixtures are the content, not an intrusion. Ordering
 * is by the same importance score used everywhere else, so a cut day keeps its
 * biggest matches.
 */
export const MAX_TARGETED_PER_SPORT_PER_DAY = 12;

export const DEFAULT_MAX_PER_CATEGORY_PER_DAY = 6;

/**
 * Slots reserved for representation before the rest of the day is filled on
 * merit.
 *
 * A cap alone is not enough. Filling a day purely by score means the categories
 * with the most events and the most volume take every slot, and the ones with
 * the fewest take none: measured on a live August window, 15 political events
 * cleared the relevance floor and 3 reached the calendar, while a single
 * Tuesday ran sports 5, business 5, elections 3, economy 1 — and no politics,
 * world, technology or AI at all, on a day when all four had something.
 *
 * So the day is dealt in two passes. Every category with an event that day gets
 * its best one first; whatever slots remain go to the highest scores regardless
 * of category. Nothing that happened is invisible, and the biggest events of
 * the day still dominate the space.
 */
export const GUARANTEED_SLOTS_PER_CATEGORY_PER_DAY = 1;

/**
 * Ceiling for one day across all categories.
 *
 * Raised from 14 once representation was guaranteed. The old number was set
 * when a single Tuesday could be 42 lower-league fixtures and the cap was the
 * only thing standing between the reader and a market list. Named exclusions
 * and per-category caps now do that work, and the binding constraint had become
 * the last day of the month — every "end of August" market lands on the 31st,
 * and a $324k political market was being cut to make room for a fourth AI
 * leaderboard.
 *
 * The month grid still shows three per cell behind "+N more", so this governs
 * the day popover and the agenda rather than the density of the grid.
 */
export const MAX_EVENTS_PER_DAY = 18;

/** With "Include smaller markets" on, the caps roughly double. */
export const RELAXED_CAP_FACTOR = 2;
