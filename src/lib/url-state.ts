import { CATEGORY_IDS, resolveCategoryId } from "./categories";
import {
  ALL_CATEGORIES,
  isImportanceLevel,
  DEFAULT_FILTERS,
  type CalendarFilters,
} from "./curation/filters";
import type { CalendarCategory } from "./curation/types";
import {
  ESPORT_IDS,
  SPORT_IDS,
  parseEsportSelection,
  parseSportSelection,
  serializeSelection,
  type EsportId,
  type SportId,
} from "./sports/taxonomy";
import { fromMonthKey, toDateKey, toMonthKey } from "./dates";

/**
 * URL query-parameter state.
 *
 * A filtered calendar is shareable and survives a refresh:
 *   ?view=month&month=2026-08
 *   ?view=agenda&categories=politics,ai
 *   ?view=week&date=2026-08-10
 *   ?categories=sports&importance=major
 *   ?categories=sports&sports=tennis,soccer
 *   ?weekend=1&starred=1
 *
 * Only non-default values are written, so the common case stays a clean URL, and
 * anything invalid falls back to a working default rather than erroring.
 *
 * Transient UI state — which onboarding step is open, whether a sheet is
 * expanded — deliberately stays out of the URL.
 */

export type CalendarView = "month" | "week" | "agenda";

export type CalendarUrlState = {
  view: CalendarView;
  /** Month anchor for month/agenda; day anchor for week. */
  anchor: Date;
  filters: CalendarFilters;
  /** `YYYY-MM-DD` of an explicitly selected day. */
  selected: string | null;
};

const VIEWS: CalendarView[] = ["month", "week", "agenda"];

function parseView(value: string | null): CalendarView {
  return VIEWS.includes(value as CalendarView) ? (value as CalendarView) : "month";
}

function startOfMonthLocal(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1, 12, 0, 0, 0);
}

/**
 * The token for "the reader deliberately selected nothing".
 *
 * A missing `categories` parameter and an empty selection are different states
 * and have to serialize differently. Without a token for the second one, Clear
 * would produce a URL indistinguishable from a fresh visit, and a refresh would
 * hand back all eleven categories — the exact bug where an empty selection is
 * quietly read as "everything". `none` is not a category id, so it can never
 * collide with a real one.
 */
export const NO_CATEGORIES_TOKEN = "none";

/**
 * Read a category selection, distinguishing all three states.
 *
 *  - parameter absent      → every category (a fresh visit)
 *  - `categories=none`     → an explicit empty selection
 *  - anything else         → exactly what it lists
 *
 * Ids are *resolved* rather than filtered, so a retired id like `entertainment`
 * maps to whatever absorbed it. Dropping it instead would silently widen a
 * year-old bookmark, which is the same failure in a different costume.
 */
export function parseCategories(raw: string | null): CalendarCategory[] {
  if (raw === null) return ALL_CATEGORIES;
  const value = raw.trim();
  if (value === "" || value.toLowerCase() === NO_CATEGORIES_TOKEN) return [];
  const resolved = value
    .split(",")
    .map((c) => resolveCategoryId(c))
    .filter((c): c is CalendarCategory => c !== null);
  return [...new Set(resolved)];
}

/** The inverse of `parseCategories`; `null` means "omit the parameter". */
export function serializeCategories(categories: CalendarCategory[]): string | null {
  const unique = [...new Set(categories)];
  if (unique.length === CATEGORY_IDS.length) return null;
  if (unique.length === 0) return NO_CATEGORIES_TOKEN;
  return unique.sort().join(",");
}

/**
 * Read a sub-selection, distinguishing the same three states as `parseCategories`.
 *
 *  - parameter absent → every sport (a fresh visit, and "All Sports")
 *  - `sports=none`    → an explicit empty selection
 *  - anything else    → the ids from it that are real
 *
 * Unknown ids are *dropped* here rather than resolved, which is the opposite of
 * what `parseCategories` does and is right for the opposite reason. A category
 * id can be retired and absorbed, so dropping one silently widens a bookmark; a
 * sport id has no such history, and the value arriving here is an untrusted
 * query string. Filtering against the allowlist is what guarantees nothing
 * arbitrary reaches a filter, a feed name or a cache key — an id we do not
 * recognise is not a sport, it is input.
 *
 * A list that filters down to nothing becomes an empty selection rather than
 * every sport: `?sports=<garbage>` asked for something we cannot honour, and
 * showing everything would be the widening bug in a different costume.
 */
function parseSubSelection<T extends string>(
  raw: string | null,
  parse: (value: string | null | undefined) => T[],
  all: readonly T[],
): T[] {
  if (raw === null) return [...all];
  return parse(raw);
}

export function parseCalendarUrlState(
  params: URLSearchParams,
  now: Date = new Date(),
): CalendarUrlState {
  const view = parseView(params.get("view"));

  // `date` is the week view's day anchor; `month` is the month anchor. Either
  // may appear, and an unparseable value falls back to today.
  const explicitDate = fromMonthKey(params.get("date") ?? "");
  const explicitMonth = fromMonthKey(params.get("month") ?? "");
  const fallback = view === "week" ? now : startOfMonthLocal(now);
  const anchor = explicitDate ?? explicitMonth ?? fallback;

  const categories = parseCategories(params.get("categories"));
  const sports = parseSubSelection<SportId>(
    params.get("sports"),
    parseSportSelection,
    SPORT_IDS,
  );
  const esports = parseSubSelection<EsportId>(
    params.get("esports"),
    parseEsportSelection,
    ESPORT_IDS,
  );

  const importanceRaw = (params.get("importance") ?? "").trim().toLowerCase();
  const minImportance = isImportanceLevel(importanceRaw) ? importanceRaw : "all";

  const selected = params.get("selected");

  return {
    view,
    anchor,
    selected: selected && /^\d{4}-\d{2}-\d{2}$/.test(selected) ? selected : null,
    filters: {
      ...DEFAULT_FILTERS,
      categories,
      search: params.get("q") ?? "",
      minImportance,
      includeSmallerMarkets: params.get("smaller") === "1",
      weekendOnly: params.get("weekend") === "1",
      favoritesOnly: params.get("starred") === "1",
      sports,
      esports,
    },
  };
}

export function serializeCalendarUrlState(
  state: CalendarUrlState,
  now: Date = new Date(),
): string {
  const params = new URLSearchParams();

  if (state.view !== "month") params.set("view", state.view);

  // The week view anchors on a day; serializing only `YYYY-MM` would round every
  // "next week" back to the 1st and the view would never move.
  if (state.view === "week") {
    const key = toDateKey(state.anchor);
    if (key !== toDateKey(now)) params.set("date", key);
  } else {
    const key = toMonthKey(state.anchor);
    if (key !== toMonthKey(startOfMonthLocal(now))) params.set("month", key);
  }

  if (state.selected) params.set("selected", state.selected);

  const { filters } = state;
  // Omitted when everything is selected, so the common case stays a clean URL;
  // written as `none` when nothing is, so a refresh reproduces the choice.
  const categories = serializeCategories(filters.categories);
  if (categories !== null) params.set("categories", categories);
  if (filters.search.trim()) params.set("q", filters.search.trim());
  if (filters.minImportance !== "all") params.set("importance", filters.minImportance);
  if (filters.includeSmallerMarkets) params.set("smaller", "1");
  if (filters.weekendOnly) params.set("weekend", "1");
  if (filters.favoritesOnly) params.set("starred", "1");

  /*
   * Omitted when every sport is ticked, so "All Sports" — the default and the
   * overwhelmingly common state — keeps the URL clean and, more importantly,
   * keeps a shared link from pinning a selection the sharer never made.
   * `serializeSelection` writes `none` for a deliberate empty one.
   */
  const sports = serializeSelection(filters.sports, SPORT_IDS.length);
  if (sports !== null) params.set("sports", sports);
  const esports = serializeSelection(filters.esports, ESPORT_IDS.length);
  if (esports !== null) params.set("esports", esports);

  return params.toString();
}
