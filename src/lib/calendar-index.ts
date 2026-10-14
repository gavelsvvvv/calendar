import { groupByDay } from "./curation/filters";
import type { CalendarCategory, CuratedCalendarEvent } from "./curation/types";

/**
 * Everything the three views need, derived once.
 *
 * Month, week and agenda each used to build their own answers to the same
 * questions — which events fall on this day, how busy is this day, how many
 * events does each category have, what is worth showing in Trending — and each
 * rebuilt them whenever anything about the URL changed, including a day click
 * that cannot affect any of them.
 *
 * They are all pure functions of (dataset, filters), so they are computed here
 * once per dataset and read by every view. The costly part was never the
 * arithmetic — it is that each recomputation minted new array and object
 * identities, and `byDay` is the prop every view's `React.memo` compares
 * against, so a new one re-rendered the entire grid.
 */

export type Density = "low" | "medium" | "high" | "extreme";

/**
 * Below this a day carries no density tint at all, however quiet the rest of
 * the month is. Most days have one or two things on them; if those were tinted
 * the heatmap would just be a second way of drawing the grid.
 */
const MIN_DENSITY_EVENTS = 3;

/** How many events Trending shows. */
const TRENDING_LIMIT = 8;

export type CalendarIndex = {
  /** Filtered events bucketed by day, each bucket in reading order. */
  byDay: Record<string, CuratedCalendarEvent[]>;
  /** Which days have anything on them, for the mini calendar's dots. */
  daysWithEvents: ReadonlySet<string>;
  /** Totals per category, *before* filtering — the sidebar shows what exists. */
  countsByCategory: Partial<Record<CalendarCategory, number>>;
  /**
   * Totals per sport and per game, on the same "what exists" basis.
   *
   * Includes events only a sub-selection could reach, because that is what the
   * number is for: ticking Tennis is exactly the act that makes them visible,
   * so a count that excluded them would understate the very thing the reader is
   * about to do. Before that first tick the browser holds only the broad tier,
   * so the figure is the honest count of what is loaded — it grows when the
   * wider response arrives, and never shrinks.
   */
  countsBySport: Record<string, number>;
  countsByEsport: Record<string, number>;
  /** How busy each day of the anchor month is, judged against that month. */
  densityByDay: ReadonlyMap<string, Density>;
  /** The most important things still to come in the next seven days. */
  trending: CuratedCalendarEvent[];
};

/**
 * How busy each day is, judged against its own month.
 *
 * A quiet February and a primary-season August have completely different ideas
 * of "a lot", so the thresholds come from the month's own distribution rather
 * than from fixed numbers. Only days at or above MIN_DENSITY_EVENTS enter the
 * ranking, which keeps the ordinary one- and two-event days on plain surface
 * and leaves the tint meaning something.
 *
 * Days are matched by string prefix rather than by `isSameMonth`: a day key is
 * `YYYY-MM-DD` and a month key is `YYYY-MM`, so this is the same test without
 * 42 Date allocations.
 */
function buildDensity(
  byDay: Record<string, CuratedCalendarEvent[]>,
  monthKey: string,
): Map<string, Density> {
  const levels = new Map<string, Density>();
  const counts: Array<{ key: string; n: number }> = [];

  for (const key in byDay) {
    if (!key.startsWith(monthKey)) continue;
    const n = byDay[key].length;
    if (n >= MIN_DENSITY_EVENTS) counts.push({ key, n });
  }
  if (counts.length === 0) return levels;

  const sorted = counts.map((c) => c.n).sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];

  /*
   * The top band only exists when there is enough spread to justify it.
   *
   * With four or five qualifying days, splitting an "extreme" out of them
   * promotes a four-event Tuesday to the loudest tint on the grid and the ramp
   * stops meaning anything. Below that threshold the month gets three bands and
   * its busiest days sit at `high`, which is the honest answer for a quiet
   * month.
   */
  const banded = counts.length >= 6;
  const mediumFrom = at(banded ? 0.45 : 0.5);
  const highFrom = at(banded ? 0.75 : 0.85);
  const extremeFrom = banded ? at(0.92) : Number.POSITIVE_INFINITY;

  for (const { key, n } of counts) {
    levels.set(
      key,
      n >= extremeFrom && n > highFrom
        ? "extreme"
        : n >= highFrom
          ? "high"
          : n >= mediumFrom
            ? "medium"
            : "low",
    );
  }
  return levels;
}

/** `days` after a `YYYY-MM-DD`, staying on civil dates. */
function dayKeyAhead(dayKey: string, days: number): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  const ahead = new Date(y, (m ?? 1) - 1, (d ?? 1) + days, 12, 0, 0, 0);
  const month = String(ahead.getMonth() + 1).padStart(2, "0");
  const day = String(ahead.getDate()).padStart(2, "0");
  return `${ahead.getFullYear()}-${month}-${day}`;
}

function buildTrending(events: CuratedCalendarEvent[], today: string): CuratedCalendarEvent[] {
  const from = today;
  const to = dayKeyAhead(today, 7);
  return events
    .filter(
      (event) =>
        event.displayDate >= from &&
        event.displayDate <= to &&
        (event.status === "upcoming" || event.status === "live"),
    )
    .sort((a, b) => b.importanceScore - a.importanceScore || a.id.localeCompare(b.id))
    .slice(0, TRENDING_LIMIT);
}

export function buildCalendarIndex(input: {
  /** Everything loaded for the month, before filtering. */
  allEvents: CuratedCalendarEvent[];
  /** What survives the active filters. */
  events: CuratedCalendarEvent[];
  /** `YYYY-MM` — which month the density scale belongs to. */
  monthKey: string;
  /** Today in the *viewer's* timezone. Trending is "the next seven days" for them. */
  today: string;
}): CalendarIndex {
  const { allEvents, events, monthKey, today } = input;

  const byDay = groupByDay(events);

  /*
   * Counts are over *everything* loaded, and that is the one deliberate
   * exception to "the filters control every surface".
   *
   * The number beside a category row answers "how much is there", which is what
   * a reader needs in order to decide whether to tick it. Counting the filtered
   * set instead would print 0 against every unticked row — the list would say
   * there was nothing in the categories you had not chosen, which is both false
   * and exactly backwards from what the control is for.
   */
  const countsByCategory: Partial<Record<CalendarCategory, number>> = {};
  const countsBySport: Record<string, number> = {};
  const countsByEsport: Record<string, number> = {};
  for (const event of allEvents) {
    countsByCategory[event.category] = (countsByCategory[event.category] ?? 0) + 1;
    if (event.sportId) countsBySport[event.sportId] = (countsBySport[event.sportId] ?? 0) + 1;
    if (event.esportGameId) {
      countsByEsport[event.esportGameId] = (countsByEsport[event.esportGameId] ?? 0) + 1;
    }
  }

  return {
    byDay,
    daysWithEvents: new Set(Object.keys(byDay)),
    countsByCategory,
    countsBySport,
    countsByEsport,
    densityByDay: buildDensity(byDay, monthKey),
    /*
     * Trending obeys the filters, like every other surface.
     *
     * It used to read from `allEvents`, on the reasoning that a panel whose job
     * is "what is coming" should not empty out when you narrow to Politics.
     * That reasoning does not survive Clear: with no categories selected the
     * grid goes empty and a Trending panel offering eight events is the same
     * contradiction the whole filter pass exists to remove — the reader would
     * be looking at the one screen still disagreeing with their checkboxes.
     * Narrowing to Politics now gives Politics's trending events, which is a
     * smaller panel and an honest one.
     */
    trending: buildTrending(events, today),
  };
}

/** An index over nothing, for the first render of a range that has not loaded. */
export const EMPTY_INDEX: CalendarIndex = {
  byDay: {},
  daysWithEvents: new Set(),
  countsByCategory: {},
  countsBySport: {},
  countsByEsport: {},
  densityByDay: new Map(),
  trending: [],
};
