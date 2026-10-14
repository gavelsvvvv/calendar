/**
 * The public shape of a calendar event.
 *
 * `/api/events` used to serialize `CuratedCalendarEvent` directly, which meant
 * every internal field went out with it: the raw `importanceScore` the ranker
 * produces, the upstream `sourceEventIds` a group was built from, the internal
 * `primaryMarketId`, which grouping rule fired (`groupedBy`), which date field
 * won the ladder (`dateSource`), and a `stats` block naming every exclusion rule
 * and how many markets each one rejected.
 *
 * None of it is user data — it is public market data plus our own derived
 * analytics — so this is not a privacy fix. It is two other things:
 *
 *  - It stops publishing how the curation works. The exclusion taxonomy and the
 *    scoring output together describe the thing that makes this calendar
 *    different from a dump of Gamma, and there is no reason to hand it over.
 *  - It shrinks the scraping surface and the payload. Ten fields with no reader
 *    anywhere in the client were about a quarter of every response.
 *
 * The projection is explicit and total: a field reaches the browser because it
 * is named here, not because it happened to exist upstream. Adding one is a
 * deliberate act.
 */
import type { CuratedDataset as Dataset } from "../curation/dataset";
import type { CuratedCalendarEvent } from "../curation/types";

/**
 * What the calendar actually renders.
 *
 * Every field below has at least one reader in `src/components` or
 * `src/hooks` — verified by grep, not assumed. The ones deliberately absent are
 * listed in the module comment above.
 */
export type PublicCalendarEvent = {
  id: string;
  title: string;
  shortTitle: string;
  /** Absolute instant; the browser localises it. */
  endDate: string;
  displayDate: string;
  time: string;
  timeKind: CuratedCalendarEvent["timeKind"];
  isAllDay: boolean;
  dateConfidence: CuratedCalendarEvent["dateConfidence"];
  category: CuratedCalendarEvent["category"];
  subcategory?: string;
  /**
   * The second-level Sport / eSport classification.
   *
   * These four cross the wire because the sub-filter runs in the browser over
   * the month already in memory — the same reason categories do. Every one is a
   * value from a closed allowlist in `sports/taxonomy.ts`, never an upstream
   * string passed through, so nothing here can carry attacker-chosen text into
   * a URL, a cache key or an ICS file.
   *
   * `leagueName` is the one exception in kind: it is our own label for a league
   * we recognised, not Gamma's tag text.
   */
  sportId?: string;
  esportGameId?: string;
  leagueId?: string;
  leagueName?: string;
  eventKind?: string;
  /** Show only under an explicit sub-selection — see `targetedOnly` on the
   *  curated type. Present only when true. */
  targetedOnly?: true;
  volume: number;
  liquidity: number;
  primaryMarketUrl: string;
  relatedMarketsCount: number;
  relatedMarkets?: CuratedCalendarEvent["relatedMarkets"];
  probability?: number;
  leadingOutcome?: string;
  /**
   * An opaque ordering key that happens to keep the old field's name.
   *
   * The grid sorts by importance in four places (`month-view.tsx:100`,
   * `week-view.tsx:136`, `calendar-index.ts:123`, `filters.ts:284`), so the
   * browser genuinely needs an ordering. It never needs the number the ranker
   * computed, and that number *is* the output of the scoring model.
   *
   * So the name stays and the value changes: a dense rank over the range,
   * highest first. Every comparison the client already performs
   * (`b.importanceScore - a.importanceScore || a.id.localeCompare(b.id)`) yields
   * exactly the same order it did before, and nothing downstream needs editing —
   * which is the point. Renaming the field would have meant touching four
   * sorting sites and the whole client type surface to hide the same thing.
   */
  importanceScore: number;
  importanceLevel: CuratedCalendarEvent["importanceLevel"];
  status: CuratedCalendarEvent["status"];
  timezone?: string;
  image?: string;
  icon?: string;
  description?: string;
  tags: string[];
};

export type PublicDataset = {
  events: PublicCalendarEvent[];
  source: "live" | "cached";
  fetchedAt: string;
  error?: string;
};

/**
 * Project one event. Undefined optionals are dropped rather than serialized as
 * `null`, so the wire shape stays compact.
 */
function projectEvent(event: CuratedCalendarEvent, rank: number): PublicCalendarEvent {
  const out: PublicCalendarEvent = {
    id: event.id,
    title: event.title,
    shortTitle: event.shortTitle,
    endDate: event.endDate,
    displayDate: event.displayDate,
    time: event.time,
    timeKind: event.timeKind,
    isAllDay: event.isAllDay,
    dateConfidence: event.dateConfidence,
    category: event.category,
    volume: event.volume,
    liquidity: event.liquidity,
    primaryMarketUrl: event.primaryMarketUrl,
    relatedMarketsCount: event.relatedMarketsCount,
    importanceScore: rank,
    importanceLevel: event.importanceLevel,
    status: event.status,
    tags: event.tags,
  };
  if (event.timezone !== undefined) out.timezone = event.timezone;
  if (event.subcategory !== undefined) out.subcategory = event.subcategory;
  if (event.sportId !== undefined) out.sportId = event.sportId;
  if (event.esportGameId !== undefined) out.esportGameId = event.esportGameId;
  if (event.leagueId !== undefined) out.leagueId = event.leagueId;
  if (event.leagueName !== undefined) out.leagueName = event.leagueName;
  if (event.eventKind !== undefined) out.eventKind = event.eventKind;
  if (event.targetedOnly) out.targetedOnly = true;
  if (event.probability !== undefined) out.probability = event.probability;
  if (event.leadingOutcome !== undefined) out.leadingOutcome = event.leadingOutcome;
  if (event.image !== undefined) out.image = event.image;
  if (event.icon !== undefined) out.icon = event.icon;
  if (event.description !== undefined) out.description = event.description;
  if (event.relatedMarkets !== undefined) out.relatedMarkets = event.relatedMarkets;
  return out;
}

/**
 * Project a whole dataset for public consumption.
 *
 * `rank` is assigned from the descending score order, so the client's
 * `b.rank - a.rank` comparisons keep working unchanged while the score itself
 * stays on the server. Ties break on id, exactly as the components already do,
 * so the ordering is identical to what they computed before.
 */
export function toPublicDataset(dataset: Dataset): PublicDataset {
  const ordered = [...dataset.events].sort(
    (a, b) => b.importanceScore - a.importanceScore || a.id.localeCompare(b.id),
  );
  const rankById = new Map<string, number>();
  ordered.forEach((event, index) => rankById.set(event.id, ordered.length - index));

  return {
    // Emitted in the dataset's own order; the client sorts by `rank`.
    events: dataset.events.map((event) => projectEvent(event, rankById.get(event.id) ?? 0)),
    source: dataset.source,
    fetchedAt: dataset.fetchedAt,
    ...(dataset.error ? { error: dataset.error } : {}),
  };
}

/**
 * Field names that must never appear in a public response. Used by tests.
 *
 * `importanceScore` is deliberately absent from this list: the *name* survives
 * as the client's sort key, while the *value* is a rank rather than a score.
 * That distinction is asserted separately in the security suite.
 */
export const FORBIDDEN_PUBLIC_FIELDS = [
  "sourceEventIds",
  "primaryMarketId",
  "groupedBy",
  "dateSource",
  "lastModified",
  "openInterest",
  "startDate",
  "seriesSlug",
  "seriesTitle",
  "excludedBy",
  "stats",
] as const;
