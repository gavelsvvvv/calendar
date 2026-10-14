import {
  DEFAULT_MAX_PER_CATEGORY_PER_DAY,
  GUARANTEED_SLOTS_PER_CATEGORY_PER_DAY,
  MAX_EVENTS_PER_CATEGORY_PER_DAY,
  MAX_EVENTS_PER_DAY,
  MAX_TARGETED_PER_SPORT_PER_DAY,
  RELAXED_CAP_FACTOR,
  TARGETED_VOLUME_FLOOR,
} from "@/config/market-exclusions";
import { categoryFor, displayTags } from "../categories";
import { MARKET_TIME_ZONE, toDayKey } from "../dates";
import type { GammaEvent, GammaMarket } from "../polymarket/gamma-types";
import {
  parseGammaInstant,
  resolveEventDate,
  resolveSettlementInstant,
  type ResolvedEventDate,
} from "./event-date";
import { findExclusionReason, meetsRelevanceFloor } from "./exclusions";
import { groupEvents, stripDerivativeSuffix, type EventGroup } from "./grouping";
import { assignImportanceLevels, computeImportanceScore } from "./importance";
import type {
  CurationOptions,
  CurationStats,
  CurationVerdict,
  CuratedCalendarEvent,
  EventStatus,
  RelatedMarket,
  TimeKind,
} from "./types";
import {
  resolveEsport,
  resolveEventKind,
  resolveLeague,
  resolveSport,
} from "../sports/taxonomy";

export const POLYMARKET_BASE_URL = "https://polymarket.com";

/* ------------------------------------------------------------------ helpers */

function num(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const n = Number.parseFloat(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/** `outcomes` / `outcomePrices` arrive as JSON-encoded strings. */
function parseJsonArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== "string" || value.trim() === "") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function isValidIso(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function yesPrice(market: GammaMarket): number | null {
  const outcomes = parseJsonArray(market.outcomes);
  const prices = parseJsonArray(market.outcomePrices);
  if (prices.length === 0) return null;
  const yesIndex = outcomes.findIndex((o) => o.trim().toLowerCase() === "yes");
  const raw = Number.parseFloat(prices[yesIndex >= 0 ? yesIndex : 0] ?? "");
  if (!Number.isFinite(raw)) return null;
  return Math.min(Math.max(raw, 0), 1);
}

function outcomeLabel(market: GammaMarket): string {
  const group = market.groupItemTitle?.trim();
  if (group) return group;
  const outcomes = parseJsonArray(market.outcomes);
  return outcomes.find((o) => o.trim().toLowerCase() === "yes") ?? outcomes[0] ?? "Yes";
}

/**
 * The number and the label to put beside it.
 *
 * A Yes/No market reads as the probability of Yes. A market between two named
 * sides does not: its outcomes are "Team Falcons" and "Team Liquid", so taking
 * the first price and captioning it with the market's own name produced
 * "0% — Match Winner" for a series Liquid had just won. Named outcomes are
 * reported as the leader and its price.
 */
function headline(market: GammaMarket): {
  probability: number;
  leadingOutcome: string;
} | null {
  const outcomes = parseJsonArray(market.outcomes).map((o) => o.trim());
  const prices = parseJsonArray(market.outcomePrices).map(Number);
  if (prices.length === 0) return null;

  const isBinary = outcomes.some((o) => o.toLowerCase() === "yes");
  if (isBinary || outcomes.length !== prices.length || outcomes.length < 2) {
    const p = yesPrice(market);
    return p === null ? null : { probability: p, leadingOutcome: outcomeLabel(market) };
  }

  let best = 0;
  for (let i = 1; i < prices.length; i++) {
    if ((prices[i] ?? 0) > (prices[best] ?? 0)) best = i;
  }
  const probability = prices[best];
  if (!Number.isFinite(probability)) return null;
  return {
    probability: Math.min(Math.max(probability, 0), 1),
    leadingOutcome: outcomes[best] || outcomeLabel(market),
  };
}

export function buildEventUrl(slug: string | undefined): string {
  return slug ? `${POLYMARKET_BASE_URL}/event/${slug}` : POLYMARKET_BASE_URL;
}

/* -------------------------------------------------------------------- dates */

/**
 * The ladder itself lives in `event-date.ts`, next to the measurements that
 * justify it. Re-exported here because it was this module's export first and
 * the tests and audit script address it by that name.
 */
export { parseGammaInstant, resolveEventDate };
export type { DateSource } from "./event-date";

const timeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: MARKET_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/**
 * The time to show, and what kind of time it is.
 *
 * Most events have no real start time to read. `startDate` is when the *market*
 * opened — the Florida governor primary market opened in November 2025 for an
 * August 2026 election — so for anything without a kickoff the only field that
 * exists is the moment trading stops. Two kinds, and the distinction is the
 * whole point:
 *
 *  - **scheduled** — Polymarket wrote a specific instant, which for a fixture
 *    tracks the real event closely enough to read as its time.
 *  - **close** — Polymarket wrote a placeholder (00:00Z, 23:59Z, 12:00Z, or
 *    04:00Z for midnight Eastern). It means "some time that day", so the only
 *    honest time is the end of that day. Rendering the placeholder itself would
 *    put a primary at 19:59 or 20:00, which is invented information.
 *
 * `hintIso` is the one exception, and it never invents anything: where the
 * chosen date is a placeholder and Gamma's own `startTime` names a real clock
 * time on that same day, the hint is shown instead. That is how Berlin's state
 * election reads 17:00 rather than sitting in the all-day band. It cannot move
 * the event — `refineTime` has already rejected any hint on a different day.
 *
 * The placeholder check runs against UTC because that is where the convention
 * lives; only the display is converted to market time.
 */
export function resolveTime(
  iso: string,
  hintIso?: string,
): {
  time: string;
  isAllDay: boolean;
  timeKind: TimeKind;
} {
  if (hintIso) {
    const hint = new Date(hintIso);
    if (!Number.isNaN(hint.getTime())) {
      return {
        time: timeFormatter.format(hint),
        isAllDay: false,
        timeKind: "scheduled",
      };
    }
  }

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return { time: END_OF_DAY, isAllDay: true, timeKind: "close" };
  }

  const uh = date.getUTCHours();
  const um = date.getUTCMinutes();
  const utcPlaceholder =
    (uh === 0 && um === 0) || (uh === 23 && um >= 58) || (uh === 12 && um === 0);

  const marketTime = timeFormatter.format(date);
  // The same convention written in Eastern time instead of UTC, which is how
  // every US macro release arrives: "July Inflation US - Annual" ends at
  // 03:59Z, midnight ET, and is no more scheduled for 23:59 than a bare date
  // is. Checking only UTC missed all of them and put five CPI markets on top of
  // each other at the bottom of the week grid. The offset moves with daylight
  // saving, so this reads the clock rather than guessing at 03:59 and 04:59.
  const marketPlaceholder =
    marketTime === "00:00" || marketTime === "23:59" || marketTime === "23:58";

  if (utcPlaceholder || marketPlaceholder) {
    return { time: END_OF_DAY, isAllDay: true, timeKind: "close" };
  }
  return { time: marketTime, isAllDay: false, timeKind: "scheduled" };
}

/**
 * What a placeholder resolves to. Trading closes when the day does, so this is
 * the true deadline as well as sorting these events to the end of their day —
 * exactly where an all-day entry belongs.
 */
const END_OF_DAY = "23:59";

/**
 * UMA has an answer on chain, which only happens once the real-world event has
 * concluded. "proposed" counts: the result is known and the dispute window is
 * simply still running.
 */
const ANSWERED_UMA = new Set(["proposed", "disputed", "resolved", "settled"]);

/** The oracle process has begun for this market. */
function isAnswered(market: GammaMarket): boolean {
  return (
    market.closed === true ||
    ANSWERED_UMA.has((market.umaResolutionStatus ?? "").trim().toLowerCase())
  );
}

/**
 * Has this happened yet?
 *
 * The obvious signal — `closed` on the Gamma event — is the wrong one. It stays
 * false until UMA's dispute window elapses and *every* leg settles, which is
 * hours after the thing itself is over. A Dota 2 playoff match that finished at
 * 13:00 still carried `closed: false` at 16:00 with an end date of 19:00, so
 * the calendar advertised a decided series as upcoming, complete with a ">99%"
 * probability presented as a forecast.
 *
 * The per-market `umaResolutionStatus` does not lag: it is unset until the
 * event concludes, then moves through proposed -> resolved. Measured on that
 * match, all 59 markets carried one (25 resolved, 34 proposed); on genuinely
 * upcoming events — "Democratic Presidential Nominee 2028" — 128 of 128 were
 * unset.
 *
 * Two conditions, because either alone gets a real case wrong:
 *
 *  - A *majority* answered, not "any". A stray proposal is normal on a large
 *    book — "Presidential Election Winner 2028" had one of 128.
 *  - And nothing still outstanding with a deadline in the future. "Iran
 *    leadership change by…?" is a ladder of dated strikes: the July and March
 *    legs have resolved and the September and 2027 ones have not, so 60% are
 *    answered while the question is very much still open. In a best-of-five the
 *    same guard keeps Game 1 resolving from settling the series.
 */
function resolveStatus(members: GammaEvent[], endIso: string, now: Date): EventStatus {
  /*
   * Retirement outranks everything, and only when the whole group agrees.
   *
   * `archived` on every source row. A closed or voided book is not cancelled —
   * the thing happened, the market simply paid nobody — and tombstoning those
   * would delete a legitimate past entry out of a subscriber's calendar.
   * Requiring *every* member keeps a group alive while any part of it is still
   * live.
   */
  if (members.length > 0 && members.every((m) => m.archived === true)) return "cancelled";

  const markets = members.flatMap((m) => m.markets ?? []);
  const end = Date.parse(endIso);
  const endPassed = Number.isFinite(end) && end < now.getTime();

  if (markets.length === 0) {
    if (members.every((m) => m.closed)) return "closed";
    return endPassed ? "live" : "upcoming";
  }

  const answered = markets.filter(isAnswered).length;
  const stillToCome = markets.some((m) => {
    if (isAnswered(m)) return false;
    const at = Date.parse(m.endDate ?? "");
    // An unanswered leg with no readable deadline is treated as outstanding.
    return !Number.isFinite(at) || at > now.getTime();
  });

  if (answered > markets.length / 2 && !stillToCome) {
    // "Proposed" is enough to say the match is over — the result is known and
    // the chain is catching up — so settled-vs-proposed changes nothing here.
    // What does matter is whether anything paid out: a book that closed with
    // every leg mid-range was voided rather than decided.
    const paidOut = markets.some((mk) =>
      parseJsonArray(mk.outcomePrices)
        .map(Number)
        .some((p) => p >= 0.999 || p <= 0.001),
    );
    return paidOut ? "resolved" : "closed";
  }

  return endPassed ? "live" : "upcoming";
}

/**
 * Descriptions run to several paragraphs and the details panel clamps them to
 * three lines, so the rest is 107KB of a range payload nobody reads.
 */
function truncateDescription(value: string | undefined): string | undefined {
  const text = value?.trim();
  if (!text) return undefined;
  if (text.length <= DESCRIPTION_LIMIT) return text;
  const slice = text.slice(0, DESCRIPTION_LIMIT);
  const lastSpace = slice.lastIndexOf(" ");
  return `${(lastSpace > DESCRIPTION_LIMIT * 0.6 ? slice.slice(0, lastSpace) : slice).trimEnd()}…`;
}

const DESCRIPTION_LIMIT = 280;

/** Chop a title to something that fits a calendar cell without losing meaning. */
export function toShortTitle(title: string, max = 42): string {
  const core = stripDerivativeSuffix(title).core;
  if (core.length <= max) return core;
  const slice = core.slice(0, max);
  const lastSpace = slice.lastIndexOf(" ");
  const base = lastSpace > max * 0.6 ? slice.slice(0, lastSpace) : slice;
  return `${base.replace(/[\s,.;:—-]+$/, "")}…`;
}

/* ----------------------------------------------------------------- assembly */

function pickImage(members: GammaEvent[]): string | undefined {
  for (const e of members) {
    for (const c of [e.image, e.icon, e.markets?.[0]?.image, e.markets?.[0]?.icon]) {
      if (typeof c === "string" && c.trim().startsWith("http")) return c.trim();
    }
  }
  return undefined;
}

/**
 * The group's biggest markets, best first.
 *
 * Capped hard, because this is by far the most expensive thing in the payload:
 * at 24 per event it was 393KB of a 608KB range response — 65% of every byte
 * the browser downloads — to populate a disclosure most visitors never open.
 * Eight is enough to show what an event is made of; `relatedMarketsCount`
 * still reports the true total.
 */
function collectRelatedMarkets(members: GammaEvent[], limit = 8): RelatedMarket[] {
  const out: RelatedMarket[] = [];
  for (const event of members) {
    for (const market of event.markets ?? []) {
      const id = market.id ?? market.conditionId;
      if (!id) continue;
      const probability = yesPrice(market) ?? undefined;
      out.push({
        id: String(id),
        title: market.groupItemTitle?.trim() || market.question?.trim() || "Market",
        url: market.slug
          ? `${POLYMARKET_BASE_URL}/event/${event.slug ?? ""}/${market.slug}`.replace("//", "/").replace("https:/", "https://")
          : buildEventUrl(event.slug),
        probability,
        volume: num(market.volumeNum ?? market.volume),
        liquidity: num(market.liquidityNum ?? market.liquidity) || undefined,
        outcome: outcomeLabel(market),
      });
    }
  }
  out.sort((a, b) => b.volume - a.volume);
  return out.slice(0, limit);
}

/**
 * Headline probability.
 *
 * The market that asks the event's own question wins outright when there is
 * one. A Dota playoff match carries 59 markets — game winners, totals,
 * handicaps — and picking the highest price among them surfaced
 * "Game Handicap: Liquid (-2.5) vs Team Falcons (+2.5)" as the headline for a
 * series. Ranking by price only makes sense across the legs of a single
 * question, such as the candidates in an election.
 *
 * Otherwise: the front-runner among still-open markets.
 */
function resolveLeading(
  canonical: GammaEvent,
  members: GammaEvent[],
  status: EventStatus,
): {
  probability?: number;
  leadingOutcome?: string;
} {
  const all = members.flatMap((m) => m.markets ?? []);
  if (all.length === 0) return {};

  /*
   * Read the canonical event's own book first.
   *
   * Grouping folds a fixture's derivatives in beside it — halftime result,
   * exact score, total corners — and those legs are not what the event is
   * about. Matching by title cannot separate them, because the normaliser
   * strips exactly the suffixes that distinguish them: "… - Total Corners"
   * reduces to the fixture's title while "Will EC Vitória win on 2026-08-06?"
   * does not, so the derivative matched and the match winner did not. The
   * canonical member is already the undecorated one, so its markets are the
   * question the calendar is showing.
   */
  const primary = canonical.markets ?? [];
  const candidates = primary.length > 0 ? primary : all;

  /*
   * Ranking among *open* markets is right while an event is still ahead — a
   * settled leg is not a forecast. Once it has happened that rule inverts and
   * surfaces whatever is slowest to resolve, so after the event everything is a
   * result and everything counts.
   */
  const open = candidates.filter((m) => !m.closed);
  const pool = status !== "upcoming" || open.length === 0 ? candidates : open;

  let best: { probability: number; leadingOutcome: string } | null = null;
  for (const m of pool) {
    const result = headline(m);
    if (!result) continue;
    if (!best || result.probability > best.probability) best = result;
  }
  return best ?? {};
}

/**
 * When Polymarket last touched any part of this event.
 *
 * The newest `updatedAt` across the group — the event rows and every market
 * inside them — because a price move, a date correction and a retitle are all
 * revisions a subscribed calendar wants to hear about, and any of the three can
 * land on a leg rather than the parent.
 *
 * Undefined when Gamma sends nothing readable, in which case the exporter omits
 * LAST-MODIFIED rather than inventing one: a fabricated revision time is worse
 * than none, because clients use it to decide what is newer.
 */
function resolveLastModified(members: GammaEvent[]): string | undefined {
  let newest = Number.NEGATIVE_INFINITY;
  const consider = (value: string | undefined) => {
    if (!value) return;
    const ms = Date.parse(value);
    if (Number.isFinite(ms) && ms > newest) newest = ms;
  };
  for (const member of members) {
    consider(member.updatedAt);
    for (const market of member.markets ?? []) consider(market.updatedAt);
  }
  return newest === Number.NEGATIVE_INFINITY ? undefined : new Date(newest).toISOString();
}

/**
 * Real market status beats future deadline metadata.
 *
 * Everything on the date ladder answers "when is this scheduled". On a settled
 * event that question has a second, better answer that the ladder cannot see:
 * `closedTime`, the instant the book actually paid out. Where the two disagree
 * the ladder is describing a deadline, not an event.
 *
 * "World Cup: Nation of Top Goalscorer" is the case this exists for. Every one
 * of its 54 markets resolved, its `closedTime` is 2026-07-20, and its `endDate`
 * is 2026-08-20 — so for a month the calendar advertised a decided question as
 * a normal upcoming event, with the details panel underneath it saying
 * "Resolved". Six events in one live window were in the same state.
 *
 * Only *earlier* settlement overrides, and that direction is the whole point.
 * Settling later than the event is the ordinary case — a match played on the
 * 13th settles on the 20th once the dispute window elapses — and re-dating on
 * that would shove every finished fixture a week into the future, which is the
 * bug rather than the fix. Settling *before* the scheduled date is the only
 * shape that says the scheduled date was never the event.
 *
 * When a settled event has no readable `closedTime`, this returns the ladder's
 * answer unchanged and the residue is caught by `filterEvents`, which refuses
 * to show a settled event on a future day. Nothing here invents a date.
 */
function settleDate(
  scheduled: ResolvedEventDate,
  status: EventStatus,
  members: GammaEvent[],
): ResolvedEventDate {
  if (status !== "resolved" && status !== "closed" && status !== "cancelled") return scheduled;

  const settled = resolveSettlementInstant(members);
  if (settled === null) return scheduled;
  if (Date.parse(settled) >= Date.parse(scheduled.iso)) return scheduled;

  return {
    iso: settled,
    confidence: "confirmed",
    source: "closedTime",
    // The scheduled day's clock-time hint belongs to a different day now.
    timeHintIso: undefined,
  };
}

function buildCuratedEvent(
  group: EventGroup,
  options: CurationOptions,
): CuratedCalendarEvent | null {
  const { canonical, members } = group;
  const now = options.now ?? new Date();

  const title = (canonical.title ?? "").trim();
  const id = String(canonical.id ?? canonical.slug ?? "");
  if (!title || !id) return null;

  const scheduled = resolveEventDate(canonical);
  if (!scheduled) return null;

  /*
   * Status is decided before the date, because on a settled event it *is* the
   * date. See `settleDate`.
   */
  const status = resolveStatus(members, scheduled.iso, now);
  const resolved = settleDate(scheduled, status, members);

  const displayDate = toDayKey(resolved.iso);
  if (!displayDate) return null;

  // Combined figures — the group is one event, so its numbers are the sum.
  const volume = members.reduce((s, m) => s + num(m.volume), 0);
  const liquidity = members.reduce((s, m) => s + num(m.liquidity), 0);
  const openInterest = members.reduce((s, m) => s + num(m.openInterest), 0);
  const relatedMarketsCount = members.reduce((s, m) => s + (m.markets?.length ?? 0), 0);

  const tagObjects = members.flatMap((m) => m.tags ?? []);
  const tagSlugs = tagObjects.map((t) => t.slug ?? "").filter(Boolean);
  const category = categoryFor({
    tagSlugs,
    title,
    sportCode: members.find((m) => m.sport?.sport)?.sport?.sport,
  });

  /*
   * Second-level classification, from the same tags the category came from.
   *
   * Resolved for every event rather than only for sports ones, because it costs
   * a map lookup and because an event can be re-categorised later without this
   * going stale. Only ever *read* when the category is sports or esports.
   */
  const sportId = category === "sports" ? resolveSport(tagSlugs) : undefined;
  const esportGameId = category === "esports" ? resolveEsport(tagSlugs) : undefined;
  const league = category === "sports" ? resolveLeague(tagSlugs) : undefined;
  const eventKind =
    category === "sports" || category === "esports"
      ? resolveEventKind(tagSlugs, title)
      : undefined;

  /*
   * Two floors, and an event only has to clear one of them.
   *
   * `broadEligible` is the floor this calendar has always used, unchanged, and
   * it alone decides what a reader sees on the general calendar, in the feeds
   * and under "All Sports".
   *
   * The second is for events reachable only by naming their sport. A tennis
   * match trading $10,000 has no business on a general calendar and is exactly
   * what someone filtering for tennis wants — see `TARGETED_VOLUME_FLOOR`. Such
   * an event is carried through the pipeline marked `targetedOnly`, and every
   * surface that is not an explicit sub-selection filters it back out.
   *
   * Requiring a *resolved* sport is what keeps this narrow. An event whose tags
   * we cannot map is not reachable by any sub-filter, so admitting it at $500
   * would only add weight to a payload nothing can ever display.
   */
  const broadEligible = meetsRelevanceFloor({
    category,
    volume,
    liquidity,
    relatedMarketsCount,
    includeSmallerMarkets: options.includeSmallerMarkets,
  });

  const targetedEligible =
    (sportId !== undefined || esportGameId !== undefined) &&
    volume >= TARGETED_VOLUME_FLOOR;

  if (!broadEligible && !targetedEligible) return null;

  const { time, isAllDay, timeKind } = resolveTime(resolved.iso, resolved.timeHintIso);
  const { probability, leadingOutcome } = resolveLeading(canonical, members, status);

  const importanceScore = computeImportanceScore({
    category,
    title,
    volume,
    liquidity,
    relatedMarketsCount,
    sourceEventCount: members.length,
    endDateIso: resolved.iso,
    featured: members.some((m) => m.featured),
    now,
  });

  const cleanTitle = stripDerivativeSuffix(title).core || title;

  // Gamma's own series row, where there is one — the first member to carry a
  // slug. Members of a group are the same real-world event, so they cannot
  // belong to two different series.
  const series = members.flatMap((m) => m.series ?? []).find((s) => s.slug);

  return {
    id,
    slug: canonical.slug ?? canonical.ticker ?? id,
    title: cleanTitle,
    shortTitle: toShortTitle(cleanTitle),
    description: truncateDescription(canonical.description),
    startDate: isValidIso(canonical.startDate) ? canonical.startDate : undefined,
    endDate: resolved.iso,
    displayDate,
    time,
    timeKind,
    timezone: MARKET_TIME_ZONE,
    isAllDay,
    dateConfidence: resolved.confidence,
    dateSource: resolved.source,
    lastModified: resolveLastModified(members),
    category,
    subcategory: canonical.sport?.sport ?? undefined,
    sportId,
    esportGameId,
    leagueId: league?.id,
    leagueName: league?.label,
    eventKind,
    // Present only on the minority that need it, so the common event pays
    // nothing for the field: `undefined` is dropped by JSON serialization.
    targetedOnly: broadEligible ? undefined : true,
    seriesSlug: series?.slug,
    seriesTitle: series?.title,
    image: pickImage(members),
    icon: canonical.icon ?? undefined,
    volume,
    liquidity,
    openInterest: openInterest > 0 ? openInterest : undefined,
    primaryMarketId: canonical.markets?.[0]?.id,
    // The parent event page whenever one exists — it shows the whole book.
    primaryMarketUrl: buildEventUrl(canonical.slug ?? canonical.ticker),
    relatedMarketsCount,
    relatedMarkets: collectRelatedMarkets(members),
    probability,
    leadingOutcome,
    importanceScore,
    importanceLevel: "standard", // replaced by the ranked pass below
    status,
    source: "polymarket",
    sourceEventIds: members.map((m) => String(m.id ?? "")).filter(Boolean),
    groupedBy: group.kind,
    tags: displayTags(tagObjects),
  };
}

export type CurationResult = {
  events: CuratedCalendarEvent[];
  stats: CurationStats;
};

/**
 * The full pipeline: normalize -> exclude -> group -> score -> select.
 *
 * Runs server-side so the browser only ever receives curated events, never the
 * raw book. Exclusion happens *before* grouping so a weather event can't drag a
 * legitimate sibling in with it.
 */
export function curateEvents(
  raw: GammaEvent[],
  options: CurationOptions = {},
): CurationResult {
  const excludedBy: Record<string, number> = {};
  /*
   * Per-event verdicts, recorded only when a caller supplies the array. The
   * aggregate counts below answer "how many were capped"; this answers "what
   * happened to *this* slug", which is the question an audit actually asks.
   */
  const diagnostics = options.diagnostics;
  const note = diagnostics
    ? (event: GammaEvent, included: boolean, reason?: string) => {
        diagnostics.push({
          slug: event.slug ?? event.ticker ?? String(event.id),
          title: event.title ?? "",
          included,
          reason,
        });
      }
    : undefined;

  const kept: GammaEvent[] = [];
  for (const event of raw) {
    const reason = findExclusionReason(event);
    if (reason) {
      excludedBy[reason] = (excludedBy[reason] ?? 0) + 1;
      note?.(event, false, reason);
      continue;
    }
    kept.push(event);
  }

  const groups = groupEvents(kept);

  const curated: CuratedCalendarEvent[] = [];
  for (const group of groups) {
    const built = buildCuratedEvent(group, options);
    if (!built) {
      excludedBy["below-relevance-floor"] = (excludedBy["below-relevance-floor"] ?? 0) + 1;
      for (const member of group.members) note?.(member, false, "below-relevance-floor");
      continue;
    }
    // A group's non-canonical members are not rejected — they are folded in,
    // and reachable in the event's related markets. Saying so is the difference
    // between "missing" and "somewhere else".
    for (const member of group.members) {
      if (member !== group.canonical) {
        note?.(member, false, `grouped-into:${group.canonical.slug ?? group.canonical.id}`);
      }
    }
    curated.push(built);
  }

  // De-duplicate by id, then rank. Paginated queries can repeat an event when
  // the underlying ordering shifts between requests.
  const seen = new Set<string>();
  const unique = curated.filter((e) => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });

  /*
   * Retired events sit out the cap entirely, in both directions.
   *
   * They are never drawn — `filterEvents` rejects them — so letting one hold
   * one of a day's two sports slots evicts a real fixture in favour of
   * something nothing will ever display. And losing the contest is worse than
   * winning it: a capped-away tombstone is a `STATUS:CANCELLED` VEVENT that
   * never gets published, which leaves the stale entry in every subscriber's
   * calendar forever. Neither direction is recoverable downstream, because the
   * cap runs before anything looks at status.
   */
  /*
   * The two tiers are capped separately, and the broad one is capped over
   * exactly the events it was capped over before.
   *
   * This ordering is the whole safety argument for the feature. If the targeted
   * events were left in the pool, a $600 tennis match would be competing for
   * one of the day's two sports slots — it would lose every time on score, but
   * "loses on score" is not a guarantee, and a day where it won would silently
   * evict a real fixture from a calendar whose owner never asked for tennis.
   * Partitioning first makes that structurally impossible rather than merely
   * unlikely: with no sub-selection in play, `broadTier` *is* `unique`, and
   * every line below reduces to what it did before.
   */
  /*
   * Drop the targeted tier outright unless this build was asked for it.
   *
   * Filtered here rather than at the point of construction so that `curateEvents`
   * has exactly one notion of what an event is: classification, floors and
   * scoring run identically in both modes, and the only difference is whether
   * these rows survive to the end. A shallow build is therefore provably the
   * same calendar it was before the feature existed — `unique` below is the
   * same array, and every line after it is the code that was already there.
   */
  const hasTargeted = unique.some((e) => e.targetedOnly);
  const broadTier = hasTargeted ? unique.filter((e) => !e.targetedOnly) : unique;
  const targetedTier =
    hasTargeted && options.includeTargeted ? unique.filter((e) => e.targetedOnly) : [];

  if (hasTargeted && !options.includeTargeted) {
    excludedBy["targeted-tier-not-requested"] = unique.length - broadTier.length;
  }

  // Everything eligible for this build, which on a shallow one is the broad
  // tier alone — so the cap accounting below counts the right denominator.
  const pool = targetedTier.length > 0 ? [...broadTier, ...targetedTier] : broadTier;

  const retired = broadTier.filter((e) => e.status === "cancelled");
  const live =
    retired.length > 0 ? broadTier.filter((e) => e.status !== "cancelled") : broadTier;
  const capped = options.skipDailyCaps
    ? pool
    : [
        ...applyPerDayCaps(live, options.includeSmallerMarkets ?? false),
        ...retired,
        ...applyTargetedCaps(targetedTier),
      ];
  excludedBy["over-daily-cap"] = pool.length - capped.length;

  if (diagnostics) {
    const survived = new Set(capped.map((e) => e.id));
    const deduped = new Set(pool.map((e) => e.id));
    for (const event of curated) {
      const verdict: CurationVerdict = {
        slug: event.slug,
        title: event.title,
        included: survived.has(event.id),
        category: event.category,
        displayDate: event.displayDate,
        volume: event.volume,
      };
      if (!verdict.included) {
        verdict.reason = deduped.has(event.id) ? "over-daily-cap" : "duplicate-id";
      }
      diagnostics.push(verdict);
    }
  }

  // Levels are ranked over what actually reaches the calendar, so the visual
  // hierarchy describes the events on screen rather than ones that were cut.
  const ranked = assignImportanceLevels(capped).sort(
    (a, b) =>
      a.displayDate.localeCompare(b.displayDate) ||
      b.importanceScore - a.importanceScore ||
      a.id.localeCompare(b.id),
  );

  return {
    events: ranked,
    stats: {
      rawEvents: raw.length,
      afterExclusions: kept.length,
      groups: groups.length,
      curated: ranked.length,
      excludedBy,
    },
  };
}

/**
 * Fit one day onto the calendar: representation first, then merit.
 *
 * Pass 1 deals every category present that day its highest-scoring event, in
 * order of how strong that best event is — so if a day has more categories than
 * slots, the strongest showings get in. Pass 2 fills whatever is left purely by
 * score, still bounded by the per-category caps.
 *
 * Without pass 1, abundant categories take everything: score ranking is a
 * volume contest, and sports and elections win it on almost every day of the
 * year. Politics would clear the relevance floor fifteen times over a month and
 * appear three times.
 *
 * Deterministic throughout — ties break on id — so the same window always
 * yields the same calendar.
 */
function applyPerDayCaps(
  events: CuratedCalendarEvent[],
  includeSmallerMarkets: boolean,
): CuratedCalendarEvent[] {
  const factor = includeSmallerMarkets ? RELAXED_CAP_FACTOR : 1;
  const dailyLimit = MAX_EVENTS_PER_DAY * factor;

  const byDay = new Map<string, CuratedCalendarEvent[]>();
  for (const event of events) {
    const list = byDay.get(event.displayDate) ?? [];
    list.push(event);
    byDay.set(event.displayDate, list);
  }

  const byScore = (a: CuratedCalendarEvent, b: CuratedCalendarEvent) =>
    b.importanceScore - a.importanceScore || a.id.localeCompare(b.id);

  const out: CuratedCalendarEvent[] = [];

  for (const list of byDay.values()) {
    const ordered = [...list].sort(byScore);

    const categoryLimit = (category: string) =>
      (MAX_EVENTS_PER_CATEGORY_PER_DAY[category] ?? DEFAULT_MAX_PER_CATEGORY_PER_DAY) *
      factor;

    // Buckets in order of their best event — `ordered` is already sorted, so
    // insertion order into the map is exactly that.
    const byCategory = new Map<string, CuratedCalendarEvent[]>();
    for (const event of ordered) {
      const key = event.category;
      const list = byCategory.get(key) ?? [];
      list.push(event);
      byCategory.set(key, list);
    }

    const taken = new Set<string>();
    const used = new Map<string, number>();

    for (const [category, candidates] of byCategory) {
      if (taken.size >= dailyLimit) break;
      const guaranteed = Math.min(
        GUARANTEED_SLOTS_PER_CATEGORY_PER_DAY * factor,
        categoryLimit(category),
        candidates.length,
      );
      for (let i = 0; i < guaranteed; i++) {
        if (taken.size >= dailyLimit) break;
        taken.add(candidates[i].id);
        used.set(category, (used.get(category) ?? 0) + 1);
      }
    }

    for (const event of ordered) {
      if (taken.size >= dailyLimit) break;
      if (taken.has(event.id)) continue;
      const count = used.get(event.category) ?? 0;
      if (count >= categoryLimit(event.category)) continue;
      taken.add(event.id);
      used.set(event.category, count + 1);
    }

    for (const event of ordered) {
      if (taken.has(event.id)) out.push(event);
    }
  }

  return out;
}

/**
 * Bound one sport's fixtures on one day, in the targeted tier only.
 *
 * Separate from `applyPerDayCaps` rather than a parameter of it, because they
 * are answering different questions. That one is arbitrating between categories
 * competing for a shared calendar — hence the guaranteed slots, the cross-
 * category ceiling, the two-pass deal. Nothing here competes with anything: a
 * reader who ticked Tennis gets tennis, and the only question left is how much
 * of a thirty-two-match qualifying day belongs in a day cell. So this is a
 * per-sport top-N and nothing more.
 *
 * Cancelled events sit out the cap, for the reason they sit out the other one:
 * a tombstone that loses a cap contest is never published, and an unpublished
 * tombstone leaves a stale entry in a subscriber's calendar permanently.
 */
function applyTargetedCaps(events: CuratedCalendarEvent[]): CuratedCalendarEvent[] {
  if (events.length === 0) return events;

  const byDayAndSport = new Map<string, CuratedCalendarEvent[]>();
  const exempt: CuratedCalendarEvent[] = [];

  for (const event of events) {
    if (event.status === "cancelled") {
      exempt.push(event);
      continue;
    }
    // A targeted event always has one of the two — that is what admitted it.
    const sport = event.sportId ?? event.esportGameId ?? "";
    const key = `${event.displayDate}|${sport}`;
    const list = byDayAndSport.get(key) ?? [];
    list.push(event);
    byDayAndSport.set(key, list);
  }

  const out: CuratedCalendarEvent[] = [...exempt];
  for (const list of byDayAndSport.values()) {
    if (list.length <= MAX_TARGETED_PER_SPORT_PER_DAY) {
      out.push(...list);
      continue;
    }
    const ordered = [...list].sort(
      (a, b) => b.importanceScore - a.importanceScore || a.id.localeCompare(b.id),
    );
    out.push(...ordered.slice(0, MAX_TARGETED_PER_SPORT_PER_DAY));
  }
  return out;
}
