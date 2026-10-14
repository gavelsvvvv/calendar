import {
  ABSOLUTE_VOLUME_FLOOR,
  CATEGORY_VOLUME_FLOORS,
  DEFAULT_VOLUME_FLOOR,
  EXCLUDED_TAG_SLUGS,
  EXCLUSION_EXCEPTIONS,
  EXCLUSION_RULES,
  RELAXED_FLOOR_FACTOR,
} from "@/config/market-exclusions";
import type { GammaEvent } from "../polymarket/gamma-types";
import type { CalendarCategory, ExclusionReason } from "./types";

/** How long the event ran, in days; `Infinity` when it can't be determined. */
export function eventDurationDays(event: GammaEvent): number {
  const start = event.startDate ? Date.parse(event.startDate) : NaN;
  const end = event.endDate ? Date.parse(event.endDate) : NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return Infinity;
  return Math.max(0, (end - start) / 86_400_000);
}

/**
 * Does an explicit exception protect this title?
 *
 * Checked before the noise rules so that "Will the SEC approve a Solana ETF?"
 * survives a rule aimed at "Solana above ___ on August 5?".
 */
export function isProtected(title: string): boolean {
  return EXCLUSION_EXCEPTIONS.some((re) => re.test(title));
}

/**
 * Decide whether one raw Gamma event is noise.
 *
 * Returns the reason when it is, or `null` when the event should stay. Title
 * matching is deliberately pattern-based rather than a single exact string, and
 * the duration-scoped rules keep monthly milestone markets while dropping the
 * daily churn that shares their vocabulary.
 */
export function findExclusionReason(event: GammaEvent): ExclusionReason | null {
  const title = (event.title ?? "").trim();
  if (!title) return "no-markets";
  if ((event.markets?.length ?? 0) === 0) return "no-markets";

  const tagSlugs = (event.tags ?? []).map((t) => (t.slug ?? "").toLowerCase());
  if (tagSlugs.some((slug) => EXCLUDED_TAG_SLUGS.has(slug))) {
    return "weather";
  }

  if (isProtected(title)) return null;

  const duration = eventDurationDays(event);

  for (const rule of EXCLUSION_RULES) {
    if (!rule.patterns.some((re) => re.test(title))) continue;
    // A duration-scoped rule only fires for genuinely short-lived events.
    if (rule.maxDurationDays !== undefined && duration > rule.maxDurationDays) {
      continue;
    }
    return rule.id as ExclusionReason;
  }

  return null;
}

/**
 * The volume an event must clear for its category.
 *
 * Category-aware because the categories are not comparable: the median sports
 * event trades $5k while the median political one trades $36k, so a single
 * global floor would empty the sports calendar and barely touch politics.
 */
export function relevanceFloor(
  category: CalendarCategory,
  includeSmallerMarkets = false,
): number {
  const base = CATEGORY_VOLUME_FLOORS[category] ?? DEFAULT_VOLUME_FLOOR;
  if (!includeSmallerMarkets) return base;
  return Math.max(ABSOLUTE_VOLUME_FLOOR, Math.round(base * RELAXED_FLOOR_FACTOR));
}

/**
 * Whether a grouped event clears its floor.
 *
 * Volume is the primary input, but breadth and liquidity buy an event some
 * slack: a fixture bundling twenty markets is a real event even when each leg is
 * thin, and that is exactly the shape of a lower-league football match.
 */
export function meetsRelevanceFloor(args: {
  category: CalendarCategory;
  volume: number;
  liquidity: number;
  relatedMarketsCount: number;
  includeSmallerMarkets?: boolean;
}): boolean {
  const { category, volume, liquidity, relatedMarketsCount } = args;
  const floor = relevanceFloor(category, args.includeSmallerMarkets);

  if (volume < ABSOLUTE_VOLUME_FLOOR) return false;

  // Breadth and depth each discount the floor, to a combined maximum of 50%.
  const breadthDiscount = Math.min(0.3, Math.max(0, relatedMarketsCount - 1) * 0.03);
  const liquidityDiscount = liquidity >= floor ? 0.2 : 0;
  const effectiveFloor = floor * (1 - Math.min(0.5, breadthDiscount + liquidityDiscount));

  return volume >= effectiveFloor;
}
