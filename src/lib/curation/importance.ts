import type { CalendarCategory, ImportanceLevel } from "./types";

/**
 * Importance scoring.
 *
 * Deterministic and pure: the same inputs always produce the same score, so the
 * result can be cached, tested and compared across requests.
 *
 * Polymarket's volume distribution is brutally skewed — in one month the median
 * event traded ~$5k while the largest traded ~$21M — so every magnitude input is
 * log-compressed before being blended. Volume is also normalised *per category*,
 * because a $200k sports fixture is a big deal while a $200k political market is
 * ordinary.
 */

export type ImportanceInput = {
  category: CalendarCategory;
  /** Read for the competitive stage — a final outranks a regular-season fixture. */
  title?: string;
  volume: number;
  liquidity: number;
  /** Markets folded into the curated event. Breadth signals a real occasion. */
  relatedMarketsCount: number;
  /** Distinct Gamma events merged — three siblings means a big fixture. */
  sourceEventCount: number;
  endDateIso: string;
  featured?: boolean;
  now?: Date;
};

/**
 * The volume, per category, that counts as a "major" event.
 *
 * These are scale anchors, not precise statistics — the scale is logarithmic,
 * so what matters is being within roughly a factor of three of a category's
 * real top end. Being wrong by an order of magnitude, however, is fatal, and
 * these were: business was anchored at $3M when the largest business event
 * Polymarket lists in a six-week window trades $19,432. Every earnings market
 * scored near zero on the term that carries 44% of the weight, and lost every
 * per-day contest it entered against a football match.
 *
 * Re-anchored against measured maxima (2026-08-05, six-week window). The
 * spread between categories is three orders of magnitude, which is exactly why
 * a single global ceiling cannot work.
 */
const CATEGORY_VOLUME_CEILING: Record<CalendarCategory, number> = {
  elections: 10_000_000,
  world: 10_000_000,
  economy: 5_000_000,
  politics: 5_000_000,
  crypto: 3_000_000,
  sports: 2_000_000,
  technology: 2_000_000,
  /*
   * An order of magnitude below athletics, measured rather than assumed: an
   * Esports World Cup quarter-final trades in the low hundreds of thousands
   * where a Tuesday MLB game trades $1.4M. Anchoring esports on the sports
   * ceiling would score every match near zero on the term that carries 44% of
   * the weight, which is the same mistake business was making at $3M.
   */
  esports: 1_000_000,
  ai: 1_000_000,
  culture: 1_000_000,
  // Earnings, IPOs and M&A trade in the low tens of thousands, full stop.
  business: 100_000,
};

/**
 * Bottom of the log window. Below this a market is indistinguishable from any
 * other tiny one, so they all score zero on volume and are separated by
 * breadth, liquidity and proximity instead.
 */
const FLOOR = 500;

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/** Normalise a magnitude onto 0..1 across a log window. */
function logScale(value: number, min: number, max: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  const lo = Math.log10(Math.max(min, 1));
  const hi = Math.log10(Math.max(max, min * 10));
  return clamp01((Math.log10(value) - lo) / (hi - lo));
}

/**
 * How much of an *occasion* the title describes.
 *
 * The counterweight to volume. A regular-season baseball game trades $1.4M —
 * more than that week's Fed decision — and belongs in a fixture list, not a
 * diary; a cup final trading a tenth of that is the thing people plan around.
 * Volume measures interest, and this measures whether anything is actually
 * being settled.
 *
 * It reads the title because that is where Polymarket puts the stage
 * ("… - LCS Regular Season", "… - KeSPA Cup Last Chance Qualifier"). The
 * non-sports tiers matter just as much: a decision, a deadline or a release is
 * a date, while a "by August 31?" market is an open question wearing one.
 */
const OCCASION_TIERS: Array<{ score: number; pattern: RegExp }> = [
  {
    score: 1,
    pattern:
      /\b(grand final|finals?|championship|title (match|fight)|super bowl|world cup|main event)\b/i,
  },
  {
    score: 0.85,
    pattern:
      /\b(semi-?finals?|quarter-?finals?|playoffs?|knockout|elimination|decider|last chance)\b/i,
  },
  {
    score: 0.8,
    pattern:
      /\b(decision|deadline|ruling|verdict|approval|approve[sd]?|inauguration|summit|hearing|vote on)\b/i,
  },
  {
    score: 0.7,
    pattern: /\b(released?|launch(es|ed|ing)?|premiere|opening weekend|debut|earnings)\b/i,
  },
  { score: 0.35, pattern: /\b(group stage|group ascend|qualifier|round \d|matchday)\b/i },
  { score: 0.15, pattern: /\bregular season\b/i },
];

/** Titles that mark no stage at all sit in the middle, neither helped nor hurt. */
const DEFAULT_OCCASION = 0.45;

function occasionScore(title: string): number {
  for (const tier of OCCASION_TIERS) {
    if (tier.pattern.test(title)) return tier.score;
  }
  return DEFAULT_OCCASION;
}

/**
 * Volume gives up eight points and the `featured` merchandising flag two, so
 * that what an event *is* carries weight against how much money is on it.
 *
 * A counterweight, not an override: at this weight a final outranks a
 * regular-season fixture worth up to roughly twice as much, and loses beyond
 * that. Volume stays the dominant signal, because a market with five times the
 * money on it genuinely does have more people watching.
 */
const WEIGHTS = {
  volume: 0.36,
  liquidity: 0.14,
  breadth: 0.14,
  grouping: 0.08,
  proximity: 0.12,
  occasion: 0.10,
  featured: 0.06,
} as const;

export function computeImportanceScore(input: ImportanceInput): number {
  const {
    category,
    volume,
    liquidity,
    relatedMarketsCount,
    sourceEventCount,
    endDateIso,
    featured = false,
  } = input;
  const now = input.now ?? new Date();

  const ceiling = CATEGORY_VOLUME_CEILING[category] ?? 3_000_000;
  const volumeScore = logScale(volume, FLOOR, ceiling);
  const liquidityScore = logScale(liquidity, 100, ceiling / 10);
  const breadthScore = clamp01(
    Math.log10(Math.max(relatedMarketsCount, 1)) / Math.log10(40),
  );
  // Several Gamma events folding into one means Polymarket itself built a whole
  // book around the occasion.
  const groupingScore = clamp01((sourceEventCount - 1) / 4);

  const ts = Date.parse(endDateIso);
  let proximityScore = 0;
  if (Number.isFinite(ts)) {
    const days = Math.abs(ts - now.getTime()) / 86_400_000;
    proximityScore = days <= 7 ? 1 : clamp01(1 - (days - 7) / 173);
  }

  const raw =
    WEIGHTS.volume * volumeScore +
    WEIGHTS.liquidity * liquidityScore +
    WEIGHTS.breadth * breadthScore +
    WEIGHTS.grouping * groupingScore +
    WEIGHTS.proximity * proximityScore +
    WEIGHTS.occasion * occasionScore(input.title ?? "") +
    WEIGHTS.featured * (featured ? 1 : 0);

  return Math.round(clamp01(raw) * 1000) / 10;
}

/** Absolute floors, so a quiet month can't promote a small market to "major". */
export const IMPORTANCE_FLOORS = { major: 48, important: 32 } as const;

/** Share of a window allowed into each level, highest score first. */
export const IMPORTANCE_QUANTILES = { major: 0.06, important: 0.24 } as const;

export function importanceLevelFromScore(score: number): ImportanceLevel {
  if (score >= IMPORTANCE_FLOORS.major) return "major";
  if (score >= IMPORTANCE_FLOORS.important) return "important";
  return "standard";
}

/**
 * Assign levels by rank within the loaded window.
 *
 * The raw score is absolute and comparable over time, which is what sorting
 * needs — but the proximity term lifts an entire near-term month at once, so a
 * fixed cutoff labelled 82% of the current month "important" and only 11% of a
 * month two ahead. Ranking keeps the hierarchy stable wherever the user
 * navigates; the floors above keep it honest.
 *
 * Ties are broken by score then id so the result is fully deterministic.
 */
export function assignImportanceLevels<
  T extends { id: string; importanceScore: number },
>(events: T[]): Array<T & { importanceLevel: ImportanceLevel }> {
  const ranked = [...events].sort(
    (a, b) => b.importanceScore - a.importanceScore || a.id.localeCompare(b.id),
  );

  const majorCut = Math.max(1, Math.round(ranked.length * IMPORTANCE_QUANTILES.major));
  const importantCut = Math.max(
    majorCut,
    Math.round(ranked.length * IMPORTANCE_QUANTILES.important),
  );

  const levels = new Map<string, ImportanceLevel>();
  ranked.forEach((event, index) => {
    let level: ImportanceLevel = "standard";
    if (index < majorCut && event.importanceScore >= IMPORTANCE_FLOORS.major) {
      level = "major";
    } else if (
      index < importantCut &&
      event.importanceScore >= IMPORTANCE_FLOORS.important
    ) {
      level = "important";
    }
    levels.set(event.id, level);
  });

  return events.map((e) => ({
    ...e,
    importanceLevel: levels.get(e.id) ?? "standard",
  }));
}
