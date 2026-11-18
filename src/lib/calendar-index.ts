import {
  groupByDay,
  isHiddenEverywhere,
  matchesGlobalFilters,
  matchesSubFilter,
  type CalendarFilters,
  type FilterContext,
} from "./curation/filters";
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
  /**
   * What ticking this category row would put on the calendar.
   *
   * Everything the reader has narrowed *except* the category boxes themselves —
   * see `COUNT SEMANTICS` on `buildCalendarIndex`. So Sport's number answers
   * "how much Sport would I get", which is the question the row is asking, and
   * it moves when the reader changes Sport's own sub-filter and at no other
   * time.
   */
  countsByCategory: Partial<Record<CalendarCategory, number>>;
  /**
   * Totals per sport and per game, for the picker's tiles and their tooltips.
   *
   * One layer wider than the row above: these ignore the sub-selection as well,
   * because a tile has to say what *it* holds while unticked. Applying the
   * sub-selection would print "0 events" on every option the reader has not
   * chosen, which is precisely the information they opened the picker to get.
   *
   * They include events only a sub-selection could reach, once those have been
   * loaded — ticking Tennis is the act that fetches them, so the figure grows
   * when the wider response arrives. It is always the honest count of what the
   * browser is holding, never an estimate of what it might hold.
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

/**
 * ## COUNT SEMANTICS
 *
 * There are three layers to a selection — the **category** boxes, the
 * **sub-filter** inside Sport and eSport, and the **global** controls (search,
 * importance, weekend, favourites) — and each number on screen states exactly
 * which of them it obeys. Stating it is the point: every count bug in this
 * feature was two surfaces quietly answering slightly different questions.
 *
 * | number | category | sub-filter | global |
 * |---|---|---|---|
 * | the grid, `byDay`, `trending`, `daysWithEvents` | ✔ | ✔ | ✔ |
 * | `countsByCategory` — the sidebar row | ✘ | ✔ | ✔ |
 * | `countsBySport` / `countsByEsport` — a picker tile | ✘ | ✘ | ✔ |
 *
 * Each row drops exactly the layer whose own control it is drawn beside, and
 * nothing else. A category row cannot obey the category boxes or it would read
 * 0 for everything unticked; a tile cannot obey the sub-filter or it would read
 * 0 for every option unticked. Neither is licence to ignore the rest.
 *
 * **The isolation guarantee falls out of the table.** `matchesSubFilter` reads
 * `filters.sports` for a sports event and `filters.esports` for an esports one
 * and neither for anything else, so no gesture inside eSport can move the Sport
 * row, or any other category's, by any path through this function. The other
 * half of that guarantee is upstream, in `TargetedTiers`: `allEvents` itself
 * must not gain the other category's targeted rows. Both halves are needed —
 * with one shared `deep` flag, this function was fed 222 extra sport rows and
 * printed 266 beside Sport because a reader had touched eSport.
 *
 * `allEvents` is what the browser has loaded, which is a coverage question, not
 * a filter one: before the first tick it holds only the broad tier, so a tile
 * reads the broad count and grows when the targeted response lands. That is the
 * honest number rather than a guess, and it is why the counts are described as
 * "what is loaded" rather than "what exists".
 */
export function buildCalendarIndex(input: {
  /** Everything loaded for the month, before filtering. */
  allEvents: CuratedCalendarEvent[];
  /** What survives the active filters. */
  events: CuratedCalendarEvent[];
  /** `YYYY-MM` — which month the density scale belongs to. */
  monthKey: string;
  /** Today in the *viewer's* timezone. Trending is "the next seven days" for them. */
  today: string;
  /** The active selection, for the count layers above. */
  filters: CalendarFilters;
  /** The same context `filterEvents` was given, so the two agree. */
  context?: FilterContext;
}): CalendarIndex {
  const { allEvents, events, monthKey, today, filters, context = {} } = input;

  const byDay = groupByDay(events);

  const countsByCategory: Partial<Record<CalendarCategory, number>> = {};
  const countsBySport: Record<string, number> = {};
  const countsByEsport: Record<string, number> = {};
  const now = context.now ?? new Date();
  for (const event of allEvents) {
    // A cancelled event, or a settled one dated in the future, is not on any
    // surface — so it is in no count either. Counting it would advertise a row
    // that cannot produce it.
    if (isHiddenEverywhere(event, now)) continue;
    if (!matchesGlobalFilters(event, filters, context)) continue;

    if (event.sportId) countsBySport[event.sportId] = (countsBySport[event.sportId] ?? 0) + 1;
    if (event.esportGameId) {
      countsByEsport[event.esportGameId] = (countsByEsport[event.esportGameId] ?? 0) + 1;
    }

    if (!matchesSubFilter(event, filters)) continue;
    countsByCategory[event.category] = (countsByCategory[event.category] ?? 0) + 1;
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
