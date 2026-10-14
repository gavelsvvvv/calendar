/**
 * Normalised sport, league and esport-title taxonomy.
 *
 * ## Why this exists rather than string matching
 *
 * Upstream tags are a vocabulary we do not control and cannot rely on being
 * consistent. Measured against a live 45-day window (2026-08-25 → 2026-10-10),
 * the sports/esports events carried, among others: `soccer` (50), `tennis` (20),
 * `nfl` (17), `mlb` (15), `baseball` (15), `league-of-legends` (9),
 * `counter-strike-2` (8), `basketball` (8), `wnba` (7), `EPL` (4, capitalised),
 * `atp` (1), `wta` (2), `lcs` (2). Some are sports, some are leagues, some are
 * competitions, one is upper-case, and `football` appears meaning *soccer*.
 *
 * That last one is the trap the brief calls out. `football` on Polymarket sits
 * beside `premier-league` and `la-liga`, so it means association football — and
 * mapping it to American football would silently merge the NFL into the same
 * bucket as Bundesliga. Every alias below was checked against the tags that
 * actually co-occur, not against what the word means in isolation.
 *
 * ## Sport vs league
 *
 * Kept separate deliberately. `nfl` is a league of `american-football`; `wnba`
 * and `nba` are both `basketball`. The UI filters on *sport* today, which is the
 * granularity a reader thinks in, but league is retained on the event so a
 * three-level filter can be added later without re-deriving anything.
 *
 * ## Extending it
 *
 * Add an alias, not a special case. A sport nobody has tagged yet resolves to
 * `undefined` and the event stays in the broad Sports category — it is simply
 * not reachable by a targeted filter until someone maps its tag. That is the
 * safe failure: an unmapped sport is invisible to the sub-filter, never
 * misfiled into the wrong one.
 */

/** Canonical sport ids. Stable — they are serialized into URLs and feed routes. */
export const SPORT_IDS = [
  "tennis",
  "american-football",
  "basketball",
  "soccer",
  "baseball",
  "hockey",
  "golf",
  "combat",
  "motorsport",
  "cricket",
] as const;

export type SportId = (typeof SPORT_IDS)[number];

/** Canonical esport title ids. */
export const ESPORT_IDS = [
  "cs2",
  "dota2",
  "lol",
  "valorant",
  "rainbow-six",
  "call-of-duty",
  "overwatch",
  "rocket-league",
  "starcraft",
] as const;

export type EsportId = (typeof ESPORT_IDS)[number];

export type SportMeta = { id: SportId; label: string; short: string };
export type EsportMeta = { id: EsportId; label: string; short: string };

export const SPORTS: readonly SportMeta[] = [
  { id: "tennis", label: "Tennis", short: "Tennis" },
  { id: "american-football", label: "American Football", short: "NFL" },
  { id: "basketball", label: "Basketball", short: "NBA" },
  { id: "soccer", label: "Soccer", short: "Soccer" },
  { id: "baseball", label: "Baseball", short: "MLB" },
  { id: "hockey", label: "Hockey", short: "NHL" },
  { id: "golf", label: "Golf", short: "Golf" },
  { id: "combat", label: "Combat Sports", short: "MMA" },
  { id: "motorsport", label: "Motorsport", short: "F1" },
  { id: "cricket", label: "Cricket", short: "Cricket" },
];

export const ESPORTS: readonly EsportMeta[] = [
  { id: "cs2", label: "Counter-Strike 2", short: "CS2" },
  { id: "dota2", label: "Dota 2", short: "Dota 2" },
  { id: "lol", label: "League of Legends", short: "LoL" },
  { id: "valorant", label: "Valorant", short: "Valorant" },
  { id: "rainbow-six", label: "Rainbow Six", short: "R6" },
  { id: "call-of-duty", label: "Call of Duty", short: "CoD" },
  { id: "overwatch", label: "Overwatch", short: "OW" },
  { id: "rocket-league", label: "Rocket League", short: "RL" },
  { id: "starcraft", label: "StarCraft", short: "SC" },
];

/**
 * Tag slug → sport. Lower-cased before lookup, so `EPL` and `epl` both resolve.
 *
 * League tags map to their sport *and* record the league separately (see
 * `LEAGUE_OF`), which is what keeps `nfl` and `nba` from collapsing into one
 * "ball sports" bucket while still letting a reader filter on "Basketball".
 */
const SPORT_BY_TAG: Record<string, SportId> = {
  // Tennis. `atp`/`wta` are tours; `us-open` is ambiguous (tennis and golf both
  // have one) so it is deliberately absent — the co-occurring `tennis` tag
  // resolves those events anyway.
  tennis: "tennis",
  atp: "tennis",
  wta: "tennis",
  "roland-garros": "tennis",
  wimbledon: "tennis",
  "australian-open": "tennis",

  // American football.
  nfl: "american-football",
  "american-football": "american-football",
  "college-football": "american-football",
  "college-football-playoffs": "american-football",
  ncaaf: "american-football",
  "super-bowl": "american-football",

  // Basketball.
  nba: "basketball",
  wnba: "basketball",
  basketball: "basketball",
  ncaab: "basketball",
  euroleague: "basketball",

  /*
   * Soccer — including the bare `football` tag.
   *
   * Verified rather than assumed: in the sampled window `football` co-occurs
   * with `premier-league`, `la-liga` and `ligue-1`, never with `nfl`. On
   * Polymarket, American football is always tagged `nfl`.
   */
  soccer: "soccer",
  football: "soccer",
  "premier-league": "soccer",
  epl: "soccer",
  "la-liga": "soccer",
  "serie-a": "soccer",
  bundesliga: "soccer",
  "ligue-1": "soccer",
  ucl: "soccer",
  uel: "soccer",
  "champions-league": "soccer",
  "europa-league": "soccer",
  "europa-conference-league": "soccer",
  "uefa-conference-league": "soccer",
  "womens-champions-league": "soccer",
  mls: "soccer",
  "world-cup": "soccer",

  // Baseball.
  mlb: "baseball",
  baseball: "baseball",

  // Hockey.
  nhl: "hockey",
  hockey: "hockey",

  // Golf.
  golf: "golf",
  pga: "golf",
  "pga-tour": "golf",
  masters: "golf",
  "ryder-cup": "golf",

  // Combat.
  ufc: "combat",
  mma: "combat",
  boxing: "combat",

  // Motorsport.
  f1: "motorsport",
  "formula-1": "motorsport",
  nascar: "motorsport",
  motogp: "motorsport",

  // Cricket.
  cricket: "cricket",
  "major-league-cricket": "cricket",
  ipl: "cricket",
};

/**
 * Tag slug → esport title.
 *
 * `lcs` is deliberately absent. It looks like the LoL Championship Series and
 * is not: probed against the live API, `tag_slug=lcs` returns 100/100 *soccer*
 * events (Leagues Cup fixtures such as "CF Monterrey vs. Nashville SC"). It is
 * mapped to soccer below instead, and this comment is here so nobody
 * "fixes" it back.
 */
const ESPORT_BY_TAG: Record<string, EsportId> = {
  cs2: "cs2",
  csgo: "cs2",
  "counter-strike": "cs2",
  "counter-strike-2": "cs2",
  "counter-strike-go": "cs2",
  blast: "cs2",
  iem: "cs2",

  dota: "dota2",
  dota2: "dota2",
  "dota-2": "dota2",
  "the-international": "dota2",

  lol: "lol",
  "league-of-legends": "lol",
  worlds: "lol",
  lec: "lol",
  lpl: "lol",
  lck: "lol",

  valorant: "valorant",
  vct: "valorant",

  "rainbow-six": "rainbow-six",
  r6: "rainbow-six",

  "call-of-duty": "call-of-duty",
  cod: "call-of-duty",
  cdl: "call-of-duty",

  overwatch: "overwatch",
  owl: "overwatch",

  "rocket-league": "rocket-league",
  rlcs: "rocket-league",

  starcraft: "starcraft",
  sc2: "starcraft",
};

// `lcs` is Leagues Cup soccer — see the comment on ESPORT_BY_TAG.
SPORT_BY_TAG.lcs = "soccer";
SPORT_BY_TAG["leagues-cup"] = "soccer";

/** League slugs worth retaining, mapped to a display label. */
const LEAGUE_LABELS: Record<string, string> = {
  nfl: "NFL",
  nba: "NBA",
  wnba: "WNBA",
  mlb: "MLB",
  nhl: "NHL",
  ncaaf: "NCAA Football",
  ncaab: "NCAA Basketball",
  epl: "Premier League",
  "premier-league": "Premier League",
  "la-liga": "La Liga",
  "serie-a": "Serie A",
  bundesliga: "Bundesliga",
  "ligue-1": "Ligue 1",
  ucl: "Champions League",
  uel: "Europa League",
  mls: "MLS",
  atp: "ATP",
  wta: "WTA",
  "pga-tour": "PGA Tour",
  ufc: "UFC",
  f1: "Formula 1",
  ipl: "IPL",
};

const SPORT_BY_ID = new Map(SPORTS.map((s) => [s.id, s]));
const ESPORT_BY_ID = new Map(ESPORTS.map((s) => [s.id, s]));

export function isSportId(value: string): value is SportId {
  return SPORT_BY_ID.has(value as SportId);
}
export function isEsportId(value: string): value is EsportId {
  return ESPORT_BY_ID.has(value as EsportId);
}
export function sportMeta(id: SportId): SportMeta {
  return SPORT_BY_ID.get(id)!;
}
export function esportMeta(id: EsportId): EsportMeta {
  return ESPORT_BY_ID.get(id)!;
}

/**
 * Resolve a sport from an event's tags.
 *
 * First match wins over the ordered tag list, which is why the caller passes
 * tags in upstream order: Polymarket puts the specific tag (`nfl`) before the
 * generic one (`sports`), so the specific one is seen first.
 */
export function resolveSport(tags: readonly string[]): SportId | undefined {
  for (const tag of tags) {
    const hit = SPORT_BY_TAG[tag.trim().toLowerCase()];
    if (hit) return hit;
  }
  return undefined;
}

export function resolveEsport(tags: readonly string[]): EsportId | undefined {
  for (const tag of tags) {
    const hit = ESPORT_BY_TAG[tag.trim().toLowerCase()];
    if (hit) return hit;
  }
  return undefined;
}

/** The league, where the tags name one worth keeping. */
export function resolveLeague(
  tags: readonly string[],
): { id: string; label: string } | undefined {
  for (const tag of tags) {
    const key = tag.trim().toLowerCase();
    const label = LEAGUE_LABELS[key];
    if (label) return { id: key, label };
  }
  return undefined;
}

/**
 * What kind of real-world thing this event is.
 *
 * `match` is the head-to-head fixture; everything else is a season-long or
 * tournament-wide question. The distinction drives the coverage rules: a match
 * has a real kickoff time and belongs on a day, while an outright resolves
 * whenever the competition ends.
 *
 * Polymarket tags fixtures `games`, which is the reliable signal — 104 of 136
 * sports events in the sampled window carried it, and 105 carried a
 * `gameStartTime`. The title check is a fallback for the handful that do not.
 */
export type EventKind = "match" | "tournament" | "outright" | "prop";

const VS = /\bvs\.?\b|\bv\.\s|\@\s/i;
const OUTRIGHT = /\bwinner\b|\bwin the\b|\bchampion\b|\bmvp\b|\bto win\b/i;

export function resolveEventKind(
  tags: readonly string[],
  title: string,
): EventKind {
  const lower = tags.map((t) => t.toLowerCase());
  if (lower.includes("games") || VS.test(title)) return "match";
  if (OUTRIGHT.test(title)) return "outright";
  if (lower.includes("tournament") || lower.includes("playoffs")) return "tournament";
  return "prop";
}

/**
 * Parse a selection from a URL or feed parameter.
 *
 * Allowlisted by construction: anything not a known id is dropped, so an
 * arbitrary string can never reach a cache key, a feed route or an ICS file.
 * The result is sorted and de-duplicated so `tennis,nfl` and `nfl,tennis`
 * produce one canonical key — which is what keeps the DoS hardening's bounded
 * key space bounded.
 */
export function parseSportSelection(raw: string | null | undefined): SportId[] {
  if (!raw) return [];
  return [...new Set(raw.split(",").map((s) => s.trim().toLowerCase()).filter(isSportId))].sort();
}

export function parseEsportSelection(raw: string | null | undefined): EsportId[] {
  if (!raw) return [];
  return [...new Set(raw.split(",").map((s) => s.trim().toLowerCase()).filter(isEsportId))].sort();
}

/** The inverse. `null` means "all", which is the default and stays out of URLs. */
export function serializeSelection(
  selected: readonly string[],
  total: number,
): string | null {
  const unique = [...new Set(selected)].sort();
  if (unique.length === 0) return "none";
  if (unique.length === total) return null;
  return unique.join(",");
}
