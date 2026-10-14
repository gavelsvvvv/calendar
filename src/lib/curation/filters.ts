import { CATEGORY_IDS } from "../categories";
import {
  ESPORT_IDS,
  SPORT_IDS,
  type EsportId,
  type SportId,
} from "../sports/taxonomy";
import { toDateKey, toDayKey } from "../dates";
import { isSettled } from "./types";
import type {
  CalendarCategory,
  CuratedCalendarEvent,
  ImportanceLevel,
} from "./types";

/**
 * The one filter pipeline.
 *
 * Every surface runs events through this module: Month, Week, Agenda, their
 * mobile counterparts, Search, Trending, Favorites, the category counts, the
 * heatmap — and the ICS feeds, which is the part that matters most. A feed that
 * filtered its own way is how a subscriber ends up with a calendar that
 * disagrees with the website they subscribed from.
 *
 * The whole visible range is already in memory, so filtering is a pure array
 * pass: day counts update in the same render as a checkbox toggle, with no
 * refetch.
 */

export type CalendarFilters = {
  /**
   * The categories to show. **Explicit, and never a shorthand.**
   *
   * This used to read "empty means every category", which is the single
   * assumption behind a whole family of bugs. Pressing Clear emptied the list
   * and the calendar carried on showing all eleven categories, so the
   * checkboxes and the grid told the reader two different stories; and any link
   * whose categories failed to resolve silently widened from one slice to
   * everything. An empty list now means exactly what it says — no categories,
   * and therefore no events — and a fresh visit starts with every id in here.
   */
  categories: CalendarCategory[];
  search: string;
  minImportance: ImportanceLevel | "all";
  includeSmallerMarkets: boolean;
  /** Narrow to the coming Saturday and Sunday. */
  weekendOnly: boolean;
  /** Narrow to starred events. */
  favoritesOnly: boolean;
  /**
   * Which sports to show inside the Sport category, and which games inside
   * eSport.
   *
   * Explicit lists, for the same reason `categories` is: "empty means
   * everything" is the assumption behind a family of bugs where a control and
   * the grid tell the reader two different stories. Here empty means *no
   * sports*, and a fresh visit holds every id.
   *
   * A full list is not merely equivalent to "no sub-filter" — it *is* the
   * no-sub-filter state, and the distinction matters because it decides which
   * of the two volume floors applies. `sportSelection` below is the only place
   * that judgement is made.
   */
  sports: SportId[];
  esports: EsportId[];
};

/** Every category, which is what a fresh visit selects. */
export const ALL_CATEGORIES: CalendarCategory[] = [...CATEGORY_IDS];

/**
 * Every sport and every game — the default, and deliberately so.
 *
 * The feature must not quietly shrink anyone's calendar. A reader who has never
 * opened the sub-filter has all of these selected, which is the "All Sports"
 * state, which is the behaviour that existed before any of this.
 */
export const ALL_SPORTS: SportId[] = [...SPORT_IDS];
export const ALL_ESPORTS: EsportId[] = [...ESPORT_IDS];

export const DEFAULT_FILTERS: CalendarFilters = {
  categories: ALL_CATEGORIES,
  search: "",
  minImportance: "all",
  includeSmallerMarkets: false,
  weekendOnly: false,
  favoritesOnly: false,
  sports: ALL_SPORTS,
  esports: ALL_ESPORTS,
};

/**
 * Everything the category controls need to know, derived in one place.
 *
 * The controls kept disagreeing because each one asked its own question of the
 * filter object, and one of those questions was subtly the wrong one: "Clear
 * all" was gated on `hasActiveFilters`, which is really "has the reader
 * narrowed anything" — and a fresh visit has *every* category selected, which
 * is the default and therefore not a narrowing. So the button that empties the
 * list was hidden in exactly the state where it had the most to empty, and
 * appeared only once you had already deselected something by hand.
 *
 * Count first, predicates from the count. "Show all" reads `allSelected`,
 * "Clear all" reads `count > 0`, and neither is defined in terms of the other.
 */
export type CategorySelection = {
  selectedCategoryCount: number;
  hasSelectedCategories: boolean;
  allCategoriesSelected: boolean;
};

export function categorySelection(filters: CalendarFilters): CategorySelection {
  const selectedCategoryCount = new Set(filters.categories).size;
  return {
    selectedCategoryCount,
    hasSelectedCategories: selectedCategoryCount > 0,
    allCategoriesSelected: selectedCategoryCount === CATEGORY_IDS.length,
  };
}

/** Are all available categories selected? */
export function allCategoriesSelected(filters: CalendarFilters): boolean {
  return categorySelection(filters).allCategoriesSelected;
}

/**
 * How a sub-selection reads, for one of the two sub-filtered categories.
 *
 * `targeted` is the load-bearing field, and it means something narrower than
 * "the reader touched the control": it means the reader named a *strict subset*
 * of the sports. That is the condition under which the $500 floor applies, so
 * the distinction between "all ten sports" and "no sub-filter" has to collapse
 * — they are the same request and must produce the same calendar, whether the
 * reader arrived by never opening the popover or by ticking every box in it.
 *
 * Empty is not targeted either. Selecting no sports is a request for no sports,
 * and it is answered by showing nothing rather than by widening a floor.
 */
export type SubSelection = {
  selectedCount: number;
  total: number;
  allSelected: boolean;
  noneSelected: boolean;
  /** A strict, non-empty subset — the state that unlocks the lower floor. */
  targeted: boolean;
};

function subSelection(selected: readonly string[], total: number): SubSelection {
  const selectedCount = new Set(selected).size;
  return {
    selectedCount,
    total,
    allSelected: selectedCount >= total,
    noneSelected: selectedCount === 0,
    targeted: selectedCount > 0 && selectedCount < total,
  };
}

export function sportSelection(filters: CalendarFilters): SubSelection {
  return subSelection(filters.sports, SPORT_IDS.length);
}

export function esportSelection(filters: CalendarFilters): SubSelection {
  return subSelection(filters.esports, ESPORT_IDS.length);
}

/**
 * Does this selection need the server to send the sub-filter tier?
 *
 * The one question the fetch layer asks, kept here so that "what counts as
 * targeted" is defined once. It has to agree exactly with the gate in
 * `matchesSubFilter`: if the fetch said no and the filter said yes, the reader
 * would tick Tennis and be shown an empty calendar built from data that was
 * never requested — a bug that would look like missing coverage rather than a
 * missing fetch, and would be debugged in the wrong file.
 */
export function needsTargetedTier(filters: CalendarFilters): boolean {
  return (
    (filters.categories.includes("sports") && sportSelection(filters).targeted) ||
    (filters.categories.includes("esports") && esportSelection(filters).targeted)
  );
}

const IMPORTANCE_RANK: Record<ImportanceLevel, number> = {
  standard: 0,
  important: 1,
  major: 2,
};

/*
 * There is deliberately no `isCalendarCategory` here any more.
 *
 * Parsing a category from a URL or a feed name has to go through
 * `resolveCategoryId`, which maps retired ids onto whatever absorbed them. A
 * bare type guard silently *drops* a retired id, and a dropped id leaves an
 * empty category list — which this module reads as "no filter", so a link
 * asking for one slice would quietly return every one of them.
 */

export function isImportanceLevel(value: string): value is ImportanceLevel {
  return value === "standard" || value === "important" || value === "major";
}

/**
 * Search across the fields a person would actually type: the title, the
 * category, the leading outcome (candidates, teams) and the event's tags
 * (countries, leagues, companies).
 */
function matchesSearch(event: CuratedCalendarEvent, needle: string): boolean {
  if (!needle) return true;
  const haystack = [
    event.title,
    event.category,
    event.subcategory ?? "",
    event.leadingOutcome ?? "",
    event.tags.join(" "),
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(needle);
}

/**
 * The coming weekend, as day keys.
 *
 * "Upcoming" reads forwards, not backwards: asked on a Saturday it means today
 * and tomorrow, not the Saturday just gone. Asked on a Sunday it still means
 * today — you are in the weekend — rather than skipping six days ahead.
 */
export function upcomingWeekend(now: Date = new Date()): { saturday: string; sunday: string } {
  const day = now.getDay(); // 0 Sun … 6 Sat
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0, 0);
  // Sunday counts as the tail of the weekend that started yesterday.
  const toSaturday = day === 0 ? -1 : 6 - day;
  const saturday = new Date(base);
  saturday.setDate(base.getDate() + toSaturday);
  const sunday = new Date(saturday);
  sunday.setDate(saturday.getDate() + 1);
  return { saturday: toDateKey(saturday), sunday: toDateKey(sunday) };
}

export type FilterContext = {
  /** Starred event ids, for `favoritesOnly`. */
  favorites?: ReadonlySet<string>;
  /** Injected so weekend filtering is testable and deterministic. */
  now?: Date;
};

/**
 * The second-level Sport / eSport rule, and the gate on the lower floor.
 *
 * Three things happen here, in this order, and the order is the design:
 *
 *  1. **Sub-selection.** An event whose sport was resolved is hidden when that
 *     sport is unticked. An event whose sport we could *not* resolve is never
 *     hidden by a sub-filter — it has no sport to match, so hiding it would
 *     make an unmapped tag look like a missing event. It disappears only when
 *     the reader empties the list entirely, which is an explicit request for
 *     nothing.
 *
 *  2. **The tier gate.** A `targetedOnly` event is admitted only when the
 *     reader has named a strict subset of the sports — see `SubSelection`.
 *     Under "All Sports", or with the sub-filter untouched, it is invisible,
 *     which is what keeps the general calendar exactly as it was.
 *
 *  3. **Nothing else.** Events outside sports and esports return early and are
 *     unaffected by any of it.
 */
function matchesSubFilter(
  event: CuratedCalendarEvent,
  filters: CalendarFilters,
): boolean {
  if (event.category === "sports") {
    const selection = sportSelection(filters);
    if (selection.noneSelected) return false;
    if (event.sportId !== undefined && !filters.sports.includes(event.sportId as SportId)) {
      return false;
    }
    return !event.targetedOnly || selection.targeted;
  }

  if (event.category === "esports") {
    const selection = esportSelection(filters);
    if (selection.noneSelected) return false;
    if (
      event.esportGameId !== undefined &&
      !filters.esports.includes(event.esportGameId as EsportId)
    ) {
      return false;
    }
    return !event.targetedOnly || selection.targeted;
  }

  /*
   * A `targetedOnly` event outside sports and esports cannot exist — the tier
   * requires a resolved sport, which requires one of those two categories — but
   * if a future change ever produced one, the safe reading is to hide it rather
   * than to leak a $500 market onto the general calendar.
   */
  return !event.targetedOnly;
}

/**
 * Does this event match the selection?
 *
 * Split out of `filterEvents` so the feed route can ask the same question about
 * a *cancelled* event — which `filterEvents` always rejects, and which a feed
 * still has to publish as a tombstone. Two callers, one rule set; the
 * alternative was a second implementation of category and importance matching
 * living in the route, which is exactly the divergence this module exists to
 * prevent.
 */
export function matchesSelection(
  event: CuratedCalendarEvent,
  filters: CalendarFilters,
  context: FilterContext = {},
): boolean {
  const categories = new Set(filters.categories);
  if (!categories.has(event.category)) return false;

  if (!matchesSubFilter(event, filters)) return false;

  const minRank =
    filters.minImportance === "all" ? -1 : IMPORTANCE_RANK[filters.minImportance];
  if (minRank >= 0 && IMPORTANCE_RANK[event.importanceLevel] < minRank) return false;

  if (filters.weekendOnly) {
    const weekend = upcomingWeekend(context.now);
    if (event.displayDate !== weekend.saturday && event.displayDate !== weekend.sunday) {
      return false;
    }
  }

  if (filters.favoritesOnly && !(context.favorites ?? EMPTY_IDS).has(event.id)) return false;

  return matchesSearch(event, filters.search.trim().toLowerCase());
}

/**
 * A settled event dated in the future is metadata, not an event.
 *
 * The date ladder has already tried to fix this at the source: a resolved
 * event with a readable `closedTime` is re-dated onto the day it actually
 * settled. This is the residue — a book that closed without Gamma recording
 * when — and the honest thing to do with it is not show it, because the one
 * date we have is provably not the event's. Presenting it anyway is how "World
 * Cup: Nation of Top Goalscorer" sat three days in the future with the word
 * "Resolved" printed inside it.
 *
 * Deliberately compares day keys rather than instants: an event that settled
 * this morning belongs on today's calendar, not nowhere.
 */
export function isMisdatedSettledEvent(event: CuratedCalendarEvent, now: Date): boolean {
  if (!isSettled(event.status)) return false;
  /*
   * `toDayKey`, not `toDateKey`, and the difference is a whole day.
   *
   * `displayDate` is bucketed in market time; `toDateKey` reads the *process*
   * clock, which on a server is UTC and four or five hours ahead of New York.
   * Between 20:00 and midnight Eastern the two disagree, and the guard either
   * published a settled event onto a future day or hid one that belonged on
   * today. Both keys are now the same zone, so the comparison is a comparison.
   */
  return event.displayDate > toDayKey(now);
}

/**
 * Should this event be kept away from every reader-facing surface?
 *
 * Two rules that have nothing to do with the reader's filters: a retired event
 * exists only so a feed can publish its tombstone, and a settled event dated in
 * the future is metadata rather than an event.
 *
 * Exported because `filterEvents` is not the only door. Search reads a
 * server-side catalog and the loaded month directly, and both were letting
 * these through — so the grid and the feed hid an event while the search box
 * offered it, dated in the future with "Resolved" printed beside it, and
 * clicking it navigated to a day whose grid did not contain it.
 */
export function isHiddenEverywhere(
  event: CuratedCalendarEvent,
  now: Date = new Date(),
): boolean {
  return event.status === "cancelled" || isMisdatedSettledEvent(event, now);
}

export function filterEvents(
  events: CuratedCalendarEvent[],
  filters: CalendarFilters,
  context: FilterContext = {},
): CuratedCalendarEvent[] {
  const now = context.now ?? new Date();
  return events.filter(
    (event) => !isHiddenEverywhere(event, now) && matchesSelection(event, filters, context),
  );
}

const EMPTY_IDS: ReadonlySet<string> = new Set();

/*
 * There is deliberately no `hasActiveFilters` / `countActiveFilters` here.
 *
 * They answered "has the reader narrowed anything", which is a real question
 * but not one any control should be drawn from — and the only remaining caller
 * was drawing a control from it. "Clear all" was gated on it, and every
 * category selected is the *default*, so it read as no narrowing: the button
 * that empties the list was hidden in exactly the state where it had eleven
 * things to empty, and appeared only after you had unticked a box by hand.
 *
 * Deleting them rather than leaving them unused is the point. A predicate whose
 * name sounds like the question you want is the one the next reader will reach
 * for. `categorySelection` above is now the only way to ask about the category
 * controls, and it answers in counts rather than in moods.
 */

/** Group curated events by their calendar day, most important first. */
export function groupByDay(
  events: CuratedCalendarEvent[],
): Record<string, CuratedCalendarEvent[]> {
  const map: Record<string, CuratedCalendarEvent[]> = {};
  for (const event of events) {
    (map[event.displayDate] ??= []).push(event);
  }
  for (const list of Object.values(map)) {
    list.sort((a, b) => {
      // Timed events first, in clock order; all-day events after them.
      if (a.isAllDay !== b.isAllDay) return a.isAllDay ? 1 : -1;
      if (!a.isAllDay && !b.isAllDay && a.time && b.time) {
        const byTime = a.time.localeCompare(b.time);
        if (byTime !== 0) return byTime;
      }
      return b.importanceScore - a.importanceScore || a.id.localeCompare(b.id);
    });
  }
  return map;
}
