import type { CalendarCategory as CategoryId } from "./curation/types";

/**
 * Category normalization.
 *
 * Polymarket exposes ~680 distinct tag slugs across a few thousand events, with
 * a long tail of one-offs ("reza-pahlavi", "strait-of-hormuz"). We collapse them
 * onto 10 stable buckets using, in order:
 *   1. an explicit slug -> category map for the high-frequency tags,
 *   2. substring keyword rules for the tail,
 *   3. a title keyword pass as a last resort,
 *   4. "world" — the general bucket for a real-world event that fits nowhere
 *      more specific.
 *
 * There used to be an eleventh, "Other". It was a grey row in the sidebar that
 * on a live six-week window held exactly zero events, because anything that
 * reaches the calendar at all has cleared a per-category relevance floor and so
 * has already been classified. A filter that can only ever show nothing is a
 * control that teaches the reader the filters do not work.
 */

export type CategoryMeta = {
  id: CategoryId;
  label: string;
  /** Solid dot / accent bar. */
  dot: string;
  /** Chip surface used inside calendar cells. */
  chip: string;
  /** Stronger surface for filter pills in the selected state. */
  solid: string;
  /** Text-only accent, used on detail panels. */
  text: string;
  /** Left-border accent for calendar chips. */
  border: string;
};

/**
 * Class strings are written out in full — Tailwind only generates utilities it
 * can see literally in source, so these cannot be built by interpolation.
 */
export const CATEGORIES: CategoryMeta[] = [
  {
    id: "politics",
    label: "Politics",
    dot: "bg-indigo-500 dark:bg-indigo-400",
    chip: "bg-indigo-50 text-indigo-700 border-indigo-200/70 dark:bg-indigo-950/50 dark:text-indigo-300 dark:border-indigo-900/70",
    solid: "bg-indigo-600 text-white border-indigo-600 dark:bg-indigo-500 dark:border-indigo-500",
    text: "text-indigo-600 dark:text-indigo-400",
    border: "border-l-indigo-500 dark:border-l-indigo-400",
  },
  {
    id: "elections",
    label: "Elections",
    dot: "bg-violet-500 dark:bg-violet-400",
    chip: "bg-violet-50 text-violet-700 border-violet-200/70 dark:bg-violet-950/50 dark:text-violet-300 dark:border-violet-900/70",
    solid: "bg-violet-600 text-white border-violet-600 dark:bg-violet-500 dark:border-violet-500",
    text: "text-violet-600 dark:text-violet-400",
    border: "border-l-violet-500 dark:border-l-violet-400",
  },
  {
    id: "crypto",
    label: "Crypto",
    dot: "bg-amber-500 dark:bg-amber-400",
    chip: "bg-amber-50 text-amber-700 border-amber-200/70 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-900/70",
    solid: "bg-amber-500 text-white border-amber-500 dark:bg-amber-500 dark:border-amber-500",
    text: "text-amber-600 dark:text-amber-400",
    border: "border-l-amber-500 dark:border-l-amber-400",
  },
  {
    id: "sports",
    label: "Sports",
    dot: "bg-emerald-500 dark:bg-emerald-400",
    chip: "bg-emerald-50 text-emerald-700 border-emerald-200/70 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-900/70",
    solid: "bg-emerald-600 text-white border-emerald-600 dark:bg-emerald-500 dark:border-emerald-500",
    text: "text-emerald-600 dark:text-emerald-400",
    border: "border-l-emerald-500 dark:border-l-emerald-400",
  },
  {
    /*
     * Rose, and the choice is mostly about what it is *not* next to.
     *
     * The confusion this colour has to survive is esports against sports, so
     * anything in the blue-green corner was out: emerald, teal, sky and blue
     * are all spoken for and cyan sits between them. Rose is unmistakably not
     * emerald at chip size, and it is five rows from Culture's pink in the
     * list. Deliberately the muted 500/600 pair the rest of the palette uses
     * rather than anything brighter — an esports fixture is a scheduled event
     * like any other, and dressing it up in neon would make the one category
     * that needed to blend in the loudest thing on the grid.
     */
    id: "esports",
    label: "eSports",
    dot: "bg-rose-500 dark:bg-rose-400",
    chip: "bg-rose-50 text-rose-700 border-rose-200/70 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-900/70",
    solid: "bg-rose-600 text-white border-rose-600 dark:bg-rose-500 dark:border-rose-500",
    text: "text-rose-600 dark:text-rose-400",
    border: "border-l-rose-500 dark:border-l-rose-400",
  },
  {
    id: "business",
    label: "Business",
    dot: "bg-orange-500 dark:bg-orange-400",
    chip: "bg-orange-50 text-orange-700 border-orange-200/70 dark:bg-orange-950/50 dark:text-orange-300 dark:border-orange-900/70",
    solid: "bg-orange-600 text-white border-orange-600 dark:bg-orange-500 dark:border-orange-500",
    text: "text-orange-600 dark:text-orange-400",
    border: "border-l-orange-500 dark:border-l-orange-400",
  },
  {
    id: "economy",
    label: "Economy",
    dot: "bg-teal-500 dark:bg-teal-400",
    chip: "bg-teal-50 text-teal-700 border-teal-200/70 dark:bg-teal-950/50 dark:text-teal-300 dark:border-teal-900/70",
    solid: "bg-teal-600 text-white border-teal-600 dark:bg-teal-500 dark:border-teal-500",
    text: "text-teal-600 dark:text-teal-400",
    border: "border-l-teal-500 dark:border-l-teal-400",
  },
  {
    id: "technology",
    label: "Technology",
    dot: "bg-sky-500 dark:bg-sky-400",
    chip: "bg-sky-50 text-sky-700 border-sky-200/70 dark:bg-sky-950/50 dark:text-sky-300 dark:border-sky-900/70",
    solid: "bg-sky-600 text-white border-sky-600 dark:bg-sky-500 dark:border-sky-500",
    text: "text-sky-600 dark:text-sky-400",
    border: "border-l-sky-500 dark:border-l-sky-400",
  },
  {
    id: "ai",
    label: "AI",
    dot: "bg-fuchsia-500 dark:bg-fuchsia-400",
    chip: "bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200/70 dark:bg-fuchsia-950/50 dark:text-fuchsia-300 dark:border-fuchsia-900/70",
    solid: "bg-fuchsia-600 text-white border-fuchsia-600 dark:bg-fuchsia-500 dark:border-fuchsia-500",
    text: "text-fuchsia-600 dark:text-fuchsia-400",
    border: "border-l-fuchsia-500 dark:border-l-fuchsia-400",
  },
  {
    // Absorbed the former Entertainment bucket: films, music, awards and
    // celebrity now sit here alongside religion, royals and internet culture.
    // It keeps pink rather than rose — entertainment was the larger half of the
    // merge, and the calendar's colour for that supply should not move.
    id: "culture",
    label: "Culture",
    dot: "bg-pink-500 dark:bg-pink-400",
    chip: "bg-pink-50 text-pink-700 border-pink-200/70 dark:bg-pink-950/50 dark:text-pink-300 dark:border-pink-900/70",
    solid: "bg-pink-600 text-white border-pink-600 dark:bg-pink-500 dark:border-pink-500",
    text: "text-pink-600 dark:text-pink-400",
    border: "border-l-pink-500 dark:border-l-pink-400",
  },
  {
    id: "world",
    label: "World",
    dot: "bg-blue-500 dark:bg-blue-400",
    chip: "bg-blue-50 text-blue-700 border-blue-200/70 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-900/70",
    solid: "bg-blue-600 text-white border-blue-600 dark:bg-blue-500 dark:border-blue-500",
    text: "text-blue-600 dark:text-blue-400",
    border: "border-l-blue-500 dark:border-l-blue-400",
  },
];

export const CATEGORY_MAP: Record<CategoryId, CategoryMeta> = Object.fromEntries(
  CATEGORIES.map((c) => [c.id, c]),
) as Record<CategoryId, CategoryMeta>;

export function getCategoryMeta(id: CategoryId): CategoryMeta {
  return CATEGORY_MAP[id] ?? CATEGORY_MAP.world;
}

export const CATEGORY_IDS: CategoryId[] = CATEGORIES.map((c) => c.id);

export function isCategoryId(value: string): value is CategoryId {
  return (CATEGORY_IDS as string[]).includes(value);
}

/**
 * Retired ids, and where they went.
 *
 * A category that disappears takes every link and every *subscribed feed* with
 * it: `?categories=entertainment` would parse to nothing, an empty category
 * list means "show everything", and someone who had asked for one slice would
 * silently start receiving all of them. Resolving the old name instead costs a
 * line and keeps a year-old bookmark honest.
 */
const CATEGORY_ALIASES: Record<string, CategoryId> = {
  entertainment: "culture",
  // Retired. A bookmarked `?categories=other` resolves rather than being
  // dropped, because an empty list means "no filter" and would silently widen
  // the link instead of narrowing it.
  other: "world",
};

/**
 * Normalise a possibly-retired category id, or `null` if it was never one.
 *
 * `Object.hasOwn` rather than a bare lookup, because `CATEGORY_ALIASES` is an
 * object literal and therefore inherits from `Object.prototype`. A bare
 * `CATEGORY_ALIASES[key]` answered truthily for `__proto__` and `constructor`,
 * so those two strings walked straight through this allowlist: measured against
 * production, `/api/calendar/__proto__.ics` and `/api/calendar/constructor.ics`
 * both returned 200 and served a feed, while `/api/calendar/toString.ics`
 * returned 404 only because its inherited value is a function that fails later.
 * Nothing was injectable through it, but an allowlist that admits words nobody
 * put in it is not an allowlist, and it minted unlimited URLs serving
 * near-duplicate content.
 */
export function resolveCategoryId(value: string): CategoryId | null {
  const key = value.trim().toLowerCase();
  if (isCategoryId(key)) return key;
  return Object.hasOwn(CATEGORY_ALIASES, key) ? CATEGORY_ALIASES[key] : null;
}

/**
 * Operational / merchandising tags that carry no topical meaning. Excluded from
 * inference so a market isn't filed under "Other" just because it's `recurring`.
 */
const IGNORED_TAG_SLUGS = new Set([
  "hide-from-new",
  "recurring",
  "monthly",
  "weekly",
  "daily",
  "hourly",
  "parent-for-derivative",
  "multi-strikes",
  "up-or-down",
  "hit-price",
  "pre-market",
  "parlays",
  "hfc",
  "clf",
  "earn-4",
  "main-election",
  "all",
  "trending",
  "new",
  "featured",
  "breaking-news",
  "live",
  "100x",
  "watchlist",
]);

/**
 * Explicit slug -> category for the tags that actually carry volume.
 * Derived from a 1,200-event sample spanning open and resolved markets.
 */
const TAG_CATEGORY: Record<string, CategoryId> = {
  // --- Sports ---
  sports: "sports",
  games: "sports",
  soccer: "sports",
  basketball: "sports",
  baseball: "sports",
  football: "sports",
  tennis: "sports",
  golf: "sports",
  hockey: "sports",
  cricket: "sports",
  boxing: "sports",
  mma: "sports",
  ufc: "sports",
  f1: "sports",
  "formula-1": "sports",
  nba: "sports",
  nfl: "sports",
  mlb: "sports",
  nhl: "sports",
  wnba: "sports",
  mls: "sports",
  epl: "sports",
  ucl: "sports",
  uel: "sports",
  "premier-league": "sports",
  "champions-league": "sports",
  "europa-conference-league": "sports",
  laliga: "sports",
  "serie-a": "sports",
  bundesliga: "sports",
  "ligue-1": "sports",
  ncaa: "sports",
  "ncaa-basketball": "sports",
  "ncaa-football": "sports",
  "march-madness": "sports",
  "fifa-world-cup": "sports",
  "2026-fifa-world-cup": "sports",
  "world-cup": "sports",
  olympics: "sports",
  "american-league": "sports",
  "national-league": "sports",
  "nfl-playoffs": "sports",
  "nfl-next-team": "sports",
  cycling: "sports",
  "horse-racing": "sports",
  esports: "sports",
  "league-of-legends": "sports",
  "counter-strike-2": "sports",
  csgo: "sports",
  dota: "sports",
  valorant: "sports",
  lcs: "sports",
  lpl: "sports",
  lck: "sports",

  // --- Crypto ---
  crypto: "crypto",
  "crypto-prices": "crypto",
  bitcoin: "crypto",
  ethereum: "crypto",
  solana: "crypto",
  ripple: "crypto",
  xrp: "crypto",
  dogecoin: "crypto",
  memecoins: "crypto",
  defi: "crypto",
  nft: "crypto",
  stablecoins: "crypto",
  "crypto-etf": "crypto",
  binance: "crypto",
  coinbase: "crypto",
  ethena: "crypto",

  // --- Elections ---
  elections: "elections",
  "global-elections": "elections",
  "world-elections": "elections",
  "us-presidential-election": "elections",
  "deprec-us-election": "elections",
  primaries: "elections",
  "primary-elections": "elections",
  "republican-primary": "elections",
  "democratic-primary": "elections",
  "senate-primary": "elections",
  "house-primary": "elections",
  "governor-primary": "elections",
  midterms: "elections",
  "senate-midterms": "elections",
  "governor-midterms": "elections",
  "house-midterms": "elections",
  "israel-election": "elections",
  "international-election-props": "elections",
  "august-4-primaries": "elections",

  // --- AI ---
  ai: "ai",
  openai: "ai",
  anthropic: "ai",
  "ai-rankings": "ai",
  agi: "ai",
  llm: "ai",
  chatgpt: "ai",
  gemini: "ai",
  grok: "ai",
  "deepseek": "ai",

  // --- Technology ---
  tech: "technology",
  technology: "technology",
  "big-tech": "technology",
  spacex: "technology",
  tesla: "technology",
  apple: "technology",
  google: "technology",
  microsoft: "technology",
  meta: "technology",
  nvidia: "technology",
  amazon: "technology",
  "self-driving": "technology",
  robotics: "technology",
  semiconductors: "technology",
  "tweets-markets": "technology",

  // --- Former Science tags, redistributed ---
  // Science was removed as a bucket: its entire supply on Polymarket is daily
  // weather and temperature, which the exclusions delete by design, so the
  // category could never be anything but empty. The handful of genuinely
  // scientific markets are better served by the categories they border on — a
  // launch is a technology event, an outbreak is a world one.
  science: "technology",
  space: "technology",
  nasa: "technology",
  physics: "technology",
  health: "world",
  medicine: "world",
  pandemics: "world",
  covid: "world",
  climate: "world",
  "climate-science": "world",
  weather: "world",
  "daily-temperature": "world",
  "highest-temperature": "world",
  hurricane: "world",
  wildfire: "world",
  earthquake: "world",
  nobel: "culture",

  // --- Business ---
  business: "business",
  earnings: "business",
  companies: "business",
  ipo: "business",
  "mergers-acquisitions": "business",
  layoffs: "business",
  ceo: "business",
  airlines: "business",
  retail: "business",
  "product-marekt-fit": "business",

  // --- Finance ---
  finance: "economy",
  economy: "economy",
  "economic-policy": "economy",
  fed: "economy",
  "fed-rates": "economy",
  fomc: "economy",
  "jerome-powell": "economy",
  inflation: "economy",
  cpi: "economy",
  gdp: "economy",
  recession: "economy",
  stocks: "economy",
  equities: "economy",
  commodities: "economy",
  oil: "economy",
  gold: "economy",
  "interest-rates": "economy",
  "global-rates": "economy",
  "macro-indicators": "economy",
  "finance-updown": "economy",
  bonds: "economy",
  forex: "economy",
  unemployment: "economy",
  tariffs: "economy",
  jobs: "economy",
  // Pyth is a price-feed provider tag, applied to commodity/FX markets — not crypto.
  "pyth-finance": "economy",

  // --- Culture (absorbed the former Entertainment bucket) ---
  entertainment: "culture",
  movies: "culture",
  music: "culture",
  awards: "culture",
  oscars: "culture",
  grammys: "culture",
  emmys: "culture",
  tv: "culture",
  netflix: "culture",
  "box-office": "culture",
  celebrities: "culture",
  "reality-tv": "culture",
  gaming: "culture",
  culture: "culture",
  "pop-culture": "culture",
  twitter: "culture",
  religion: "culture",
  pope: "culture",
  royals: "culture",
  memes: "culture",
  epstein: "culture",
  books: "culture",
  "time-person-of-the-year": "culture",

  // --- World ---
  world: "world",
  geopolitics: "world",
  "macro-geopolitics": "world",
  war: "world",
  "foreign-policy": "world",
  diplomacy: "world",
  "diplomacy-ceasefire": "world",
  "peace-deal": "world",
  negotiations: "world",
  nato: "world",
  un: "world",
  nuclear: "world",
  "military-strikes": "world",
  immigration: "world",
  ukraine: "world",
  "ukraine-map": "world",
  "ukraine-peace-deal": "world",
  russia: "world",
  putin: "world",
  zelenskyy: "world",
  iran: "world",
  "trump-iran": "world",
  "iranian-leadership-regime": "world",
  khamenei: "world",
  "reza-pahlavi": "world",
  israel: "world",
  "israel-x-iran": "world",
  gaza: "world",
  hezbollah: "world",
  lebanon: "world",
  "middle-east": "world",
  "strait-of-hormuz": "world",
  hormuz: "world",
  china: "world",
  taiwan: "world",
  venezuela: "world",
  cuba: "world",
  brazil: "world",
  germany: "world",
  canada: "world",
  uk: "world",
  france: "world",
  india: "world",
  japan: "world",
  "south-korea": "world",
  "north-korea": "world",
  greenland: "world",
  mexico: "world",
  argentina: "world",
  syria: "world",
  yemen: "world",
  ships: "world",
  transit: "world",

  // --- Politics (US-domestic, non-election) ---
  politics: "politics",
  trump: "politics",
  "trump-presidency": "politics",
  congress: "politics",
  senate: "politics",
  "supreme-court": "politics",
  biden: "politics",
  "white-house": "politics",
  cabinet: "politics",
  impeachment: "politics",
  doge: "politics",
  "government-shutdown": "politics",
  "united-states": "politics",
  courts: "politics",
  "us-politics": "politics",
};

/**
 * Substring rules for the ~600 tail slugs. Ordered most-specific-first within
 * each category; the first hit wins after the priority pass below.
 */
const KEYWORD_RULES: Array<{ category: CategoryId; patterns: string[] }> = [
  {
    category: "sports",
    patterns: [
      "soccer", "football", "basketball", "baseball", "hockey", "tennis",
      "cricket", "rugby", "boxing", "wrestling", "olympic", "league", "-vs-",
      "esport", "nba", "nfl", "mlb", "nhl", "fifa", "uefa", "atp", "wta",
      "playoff", "champion", "tournament", "cup", "match", "game", "team",
      "golf", "racing", "sprint",
    ],
  },
  { category: "crypto", patterns: ["crypto", "bitcoin", "btc", "eth", "coin", "token", "blockchain", "onchain", "wallet", "airdrop"] },
  { category: "elections", patterns: ["election", "primary", "primaries", "midterm", "ballot", "nominee", "nomination", "electoral", "vote", "poll"] },
  { category: "ai", patterns: ["-ai", "ai-", "artificial-intelligence", "openai", "anthropic", "llm", "gpt", "claude", "model-release"] },
  { category: "technology", patterns: ["tech", "software", "startup", "chip", "semiconductor", "satellite", "rocket", "launch", "app", "device", "space", "science", "research", "physics"] },
  { category: "economy", patterns: ["rate", "fed", "inflation", "cpi", "gdp", "economy", "economic", "stock", "equit", "bond", "commodit", "oil", "gas", "gold", "market-cap", "tariff", "trade-deal", "currency", "recession", "earnings-call"] },
  { category: "business", patterns: ["company", "corporate", "ipo", "acquisition", "merger", "ceo", "revenue", "earnings", "brand", "retail"] },
  {
    category: "culture",
    patterns: [
      "movie", "film", "music", "album", "song", "award", "oscar", "grammy",
      "emmy", "netflix", "show", "series", "celebrity", "actor", "singer",
      "box-office", "culture", "meme", "twitter", "tweet", "religio", "pope",
      "royal", "viral", "internet", "person-of-the-year",
    ],
  },
  { category: "world", patterns: ["climate", "weather", "temperature", "storm", "quake", "health", "disease", "vaccine", "medical", "virus", "geopolit", "war", "ceasefire", "peace", "treaty", "diplomat", "sanction", "nato", "united-nations", "border", "invasion", "strike", "missile", "hostage", "refugee", "coup", "regime", "minister", "president-of", "chancellor", "parliament"] },
  { category: "politics", patterns: ["politic", "congress", "senate", "house-", "governor", "mayor", "court", "law", "bill", "policy", "president", "government", "federal", "state-of"] },
];

/**
 * Resolution priority. More specific / more visually useful buckets win when an
 * event carries several qualifying tags — e.g. a market tagged both `politics`
 * and `us-presidential-election` should read as Elections, and an Iran market
 * tagged `politics` + `geopolitics` should read as World.
 */
const CATEGORY_PRIORITY: CategoryId[] = [
  "sports",
  "crypto",
  "elections",
  "ai",
  "technology",
  "culture",
  "business",
  "economy",
  "world",
  "politics",
];

const PRIORITY_INDEX = new Map(CATEGORY_PRIORITY.map((c, i) => [c, i]));

/**
 * Tags that settle the category on their own, before any vote is counted.
 *
 * Most tags describe the *desk* an event sits on — `finance`, `equities`,
 * `politics` — and voting between those is the right way to resolve them. A few
 * describe *what kind of event it is*, which is strictly more informative.
 *
 * "Will eBay (EBAY) beat quarterly earnings?" carries `earnings`, `equities`,
 * `finance` and `ebay`. Two desk tags outvote the one that actually says what
 * the event is, and the company's results land under Economy next to the CPI
 * print. Earnings season is a Business calendar.
 */
const DECISIVE_TAGS: Record<string, CategoryId> = {
  earnings: "business",
  ipo: "business",
  "mergers-acquisitions": "business",
  layoffs: "business",
};

/**
 * Pick a winner by vote count, breaking ties with the priority order.
 *
 * Voting matters more than raw priority here. "Israel x Iran ceasefire continues
 * through...?" carries `iran`, `israel`, `geopolitics`, `israel-x-iran` and a
 * single stray `israel-election`; under a strict priority scan that lone tag
 * would file a Middle-East war market under Elections. Counting votes lets the
 * dominant theme win, and priority only settles genuine 2–2 splits.
 */
function bestOf(candidates: CategoryId[]): CategoryId | null {
  if (candidates.length === 0) return null;
  const votes = new Map<CategoryId, number>();
  for (const c of candidates) votes.set(c, (votes.get(c) ?? 0) + 1);

  let winner: CategoryId | null = null;
  let winnerVotes = -1;
  for (const [category, count] of votes) {
    if (count > winnerVotes) {
      winner = category;
      winnerVotes = count;
      continue;
    }
    if (count === winnerVotes && winner) {
      const a = PRIORITY_INDEX.get(category) ?? 99;
      const b = PRIORITY_INDEX.get(winner) ?? 99;
      if (a < b) winner = category;
    }
  }
  return winner;
}

/**
 * Normalize a Polymarket event's tag slugs (plus its title as a fallback) into
 * exactly one canonical category.
 */
/**
 * Tags that mean "this is an esports match", not "this is athletics".
 *
 * Structured tags rather than title matching, and that is the whole design:
 * "Counter-Strike" in a title is one coincidence away from a market about a
 * film, and Gamma tags these events itself. There are no per-match exceptions
 * here and there is no room for one — every entry names an ecosystem or a
 * league, so a new tournament in an existing game classifies on the day it
 * appears without anybody touching this file.
 */
const ESPORTS_TAG_SLUGS = new Set([
  "esports",
  "counter-strike-2",
  "csgo",
  "league-of-legends",
  "dota",
  "dota-2",
  "valorant",
  "rocket-league",
  "starcraft",
  "overwatch",
  "rainbow-six",
  /*
   * League tags, and one deliberate absence.
   *
   * `lcs` is NOT here, and that is the whole reason this comment is. On
   * Polymarket `tag_slug=lcs` is the **Leagues Cup** — MLS against Liga MX —
   * not the LoL Championship Series. Probed 2026-08-17: 100 of 100 events
   * carry `soccer`, none carries `esports`, and Gamma's own code for them is
   * `sport.sport = "lec"`. Listing it filed every Leagues Cup fixture under
   * eSports, where it was measured against the wrong relevance floor and ate
   * both of the day's two esports slots for the length of the tournament —
   * evicting exactly the CS2 and LoL matches this category exists to surface.
   *
   * `lec` as a *tag* is genuine (5 of 5 esports-tagged, "LEC: G2 vs. Movistar
   * KOI"), which is why the collision is only in one direction and why `lec`
   * must never be added to `ESPORTS_SPORT_CODES`.
   */
  "lpl",
  "lck",
  "lec",
]);

/** Gamma's own `sport.sport` codes for the esports leagues it carries. */
const ESPORTS_SPORT_CODES = new Set([
  "cs2",
  "csgo",
  "lol",
  "dota2",
  "valorant",
  "rl",
  "ow2",
]);

/**
 * Is this an esports fixture?
 *
 * Three structured signals, any of which is sufficient: Gamma's own esports
 * tag, the game-specific tag, or the `sport` object it attaches to fixtures.
 * No title regex — see `ESPORTS_TAG_SLUGS`.
 */
export function isEsports(input: {
  tagSlugs?: string[];
  sportCode?: string;
}): boolean {
  const code = input.sportCode?.toLowerCase().trim();
  if (code && ESPORTS_SPORT_CODES.has(code)) return true;
  return (input.tagSlugs ?? []).some((slug) =>
    ESPORTS_TAG_SLUGS.has(slug.toLowerCase().trim()),
  );
}

/**
 * Normalize an event into exactly one category, esports included.
 *
 * Two passes rather than one table, because they are answering different
 * questions. The vote below decides which *desk* an event sits on, and it puts
 * every match — a CS2 quarter-final and a Tuesday MLB game alike — under
 * Sports, which is correct as far as it goes. `isEsports` then asks the second
 * question the vote cannot: is this athletics or a video game? It reads Gamma's
 * own structured signals rather than the tag vote, so a single `sport.sport` of
 * "cs2" is enough even when every other tag on the event says football.
 *
 * Layering it this way keeps one classifier instead of two half-tables that
 * could disagree, and it means the general vote never has to know esports
 * exists.
 */
export function categoryFor(input: {
  tagSlugs: string[];
  title?: string;
  sportCode?: string;
}): CategoryId {
  if (isEsports({ tagSlugs: input.tagSlugs, sportCode: input.sportCode })) return "esports";
  return resolveCategory(input.tagSlugs, input.title ?? "");
}

export function resolveCategory(tagSlugs: string[], title = ""): CategoryId {
  const slugs = tagSlugs
    .map((s) => s.toLowerCase().trim())
    .filter((s) => s.length > 0 && !IGNORED_TAG_SLUGS.has(s));

  // 0. A tag that names the kind of event outranks any number of desk tags.
  for (const slug of slugs) {
    const decisive = DECISIVE_TAGS[slug];
    if (decisive) return decisive;
  }

  // 1. Exact slug matches, resolved by priority.
  const exact = slugs
    .map((s) => TAG_CATEGORY[s])
    .filter((c): c is CategoryId => Boolean(c));
  const exactWinner = bestOf(exact);
  if (exactWinner) return exactWinner;

  // 2. Keyword rules over the tail slugs.
  const keyword: CategoryId[] = [];
  for (const { category, patterns } of KEYWORD_RULES) {
    if (slugs.some((s) => patterns.some((p) => s.includes(p)))) keyword.push(category);
  }
  const keywordWinner = bestOf(keyword);
  if (keywordWinner) return keywordWinner;

  // 3. Title pass — last resort, only when the event carries no usable tags.
  const haystack = title.toLowerCase().replace(/\s+/g, "-");
  const fromTitle: CategoryId[] = [];
  for (const { category, patterns } of KEYWORD_RULES) {
    if (patterns.some((p) => haystack.includes(p))) fromTitle.push(category);
  }
  // Nothing matched. "World" rather than a bucket of its own: an event that
  // cleared a relevance floor is a real scheduled thing, and filing it under a
  // category the reader can actually reason about beats inventing a shrug.
  return bestOf(fromTitle) ?? "world";
}

/** Human-readable secondary tags kept for search and the details panel. */
export function displayTags(tags: Array<{ label?: string; slug?: string }>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of tags) {
    const slug = (t.slug ?? "").toLowerCase();
    if (!slug || IGNORED_TAG_SLUGS.has(slug) || slug.startsWith("rewards")) continue;
    const label = t.label?.trim();
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
    if (out.length >= 6) break;
  }
  return out;
}
