import { CATEGORY_IDS } from "../categories";
import {
  ALL_CATEGORIES,
  ALL_ESPORTS,
  ALL_SPORTS,
  type CalendarFilters,
} from "../curation/filters";
import { NO_CATEGORIES_TOKEN } from "../url-state";
import {
  ESPORT_IDS,
  SPORT_IDS,
  serializeSelection,
  type EsportId,
  type SportId,
} from "../sports/taxonomy";
import type { CalendarCategory, ImportanceLevel } from "../curation/types";

/**
 * Which events a subscription should carry.
 *
 * Kept separate from React so the URL rules can be unit-tested and so the same
 * function serves the subscribe dialog, the Google setup guide and any future
 * share affordance.
 */
export type FeedSelection = {
  scope: "all" | "filters" | "categories";
  /** Explicit, exactly as in `CalendarFilters` — empty means no events. */
  categories: CalendarCategory[];
  minImportance: ImportanceLevel | "all";
  includeSmallerMarkets: boolean;
  /**
   * The Sport / eSport sub-selection this subscription carries.
   *
   * A feed that filtered differently from the page it was subscribed from is
   * the failure this whole module exists to prevent, and a sub-filter is no
   * different: a reader narrowed to Tennis who presses Subscribe expects a
   * tennis calendar, not every sport.
   *
   * Serialized only when narrowed, which keeps the common URL unchanged — an
   * existing `all.ics` subscriber's URL must not move, because a calendar app
   * treats a changed URL as a different calendar and would strand the old one.
   */
  sports: SportId[];
  esports: EsportId[];
};

export const DEFAULT_FEED_SELECTION: FeedSelection = {
  scope: "all",
  categories: ALL_CATEGORIES,
  minImportance: "all",
  includeSmallerMarkets: false,
  sports: ALL_SPORTS,
  esports: ALL_ESPORTS,
};

/**
 * The subscription that matches what is on screen right now.
 *
 * The dialog opens on this rather than on "everything", so a reader who has
 * narrowed to Sports, Crypto and Economy and presses Subscribe gets those three
 * — the state they can see, not a default they cannot. It reads from the live
 * filter controller, so there is no route by which a stale copy from
 * `localStorage` or a back-button URL could reach the generated feed.
 */
export function feedSelectionFromFilters(filters: CalendarFilters): FeedSelection {
  return {
    scope: "filters",
    categories: filters.categories,
    minImportance: filters.minImportance,
    includeSmallerMarkets: filters.includeSmallerMarkets,
    sports: filters.sports,
    esports: filters.esports,
  };
}

/**
 * Turn a selection into a feed URL.
 *
 * Prefers the pretty per-category route when the selection is simple enough to
 * fit one, so a subscriber pasting the URL into Google sees
 * `/api/calendar/politics.ics` rather than a query string. Categories are sorted
 * so the same selection always yields the same URL — which matters, because a
 * calendar app treats a changed URL as a different calendar.
 *
 * Note which case is which now that a category list is explicit: *every*
 * category is `all.ics`, and *no* categories is a custom feed carrying the
 * `none` token. Those were the same branch while an empty list meant
 * "everything", which is how a reader who had deselected every category could
 * subscribe to a feed containing all of them.
 */
export function buildFeedUrl(selection: FeedSelection, origin: string): string {
  const base = origin.replace(/\/+$/, "");
  const categories = [...new Set(selection.categories)].sort();
  /*
   * A narrowed sub-filter makes a feed "refined" for the same reason a raised
   * importance floor does: the pretty per-category route carries no query
   * string, so `/api/calendar/sports.ics` cannot express "tennis only" and
   * would silently hand back every sport.
   */
  const narrowedSports = serializeSelection(selection.sports, SPORT_IDS.length) !== null;
  const narrowedEsports = serializeSelection(selection.esports, ESPORT_IDS.length) !== null;
  const refined =
    selection.minImportance !== "all" ||
    selection.includeSmallerMarkets ||
    narrowedSports ||
    narrowedEsports;
  const everything = selection.scope === "all" || categories.length === CATEGORY_IDS.length;

  if (everything) {
    if (!refined) return `${base}/api/calendar/all.ics`;
    return withParams(`${base}/api/calendar/custom.ics`, null, selection);
  }

  if (categories.length === 1 && !refined) {
    return `${base}/api/calendar/${categories[0]}.ics`;
  }

  return withParams(
    `${base}/api/calendar/custom.ics`,
    categories.length === 0 ? NO_CATEGORIES_TOKEN : categories.join(","),
    selection,
  );
}

function withParams(
  url: string,
  categories: string | null,
  selection: FeedSelection,
): string {
  const params = new URLSearchParams();
  if (categories !== null) params.set("categories", categories);
  if (selection.minImportance !== "all") {
    params.set("minImportance", selection.minImportance);
  }
  if (selection.includeSmallerMarkets) params.set("includeSmaller", "1");
  /*
   * Written only when narrowed, and always from the allowlist.
   *
   * `serializeSelection` emits ids it was given; every one of them originates
   * in `SPORT_IDS`/`ESPORT_IDS` because that is the only thing the filter type
   * admits and the only thing `parseSportSelection` returns. No upstream string
   * and no reader-supplied string can reach this URL — which matters more here
   * than anywhere else in the app, since this string is handed to a calendar
   * client that will poll it indefinitely.
   */
  const sports = serializeSelection(selection.sports, SPORT_IDS.length);
  if (sports !== null) params.set("sports", sports);
  const esports = serializeSelection(selection.esports, ESPORT_IDS.length);
  if (esports !== null) params.set("esports", esports);
  const query = params.toString();
  return query ? `${url}?${query}` : url;
}
