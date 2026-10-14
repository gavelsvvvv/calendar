import { describe, expect, it } from "vitest";
import { CATEGORY_IDS } from "../../categories";
import {
  parseCalendarUrlState,
  parseCategories,
  serializeCalendarUrlState,
  serializeCategories,
  NO_CATEGORIES_TOKEN,
} from "../../url-state";
import {
  ALL_CATEGORIES,
  DEFAULT_FILTERS,
  allCategoriesSelected,
  categorySelection,
  filterEvents,
  matchesSelection,
} from "../filters";
import type { CalendarCategory, CuratedCalendarEvent } from "../types";

/**
 * Category selection is explicit, everywhere.
 *
 * The bug these exist to prevent is one assumption: "an empty category list
 * means every category". It read as a harmless shorthand and produced a family
 * of failures that all looked unrelated — pressing Clear emptied the checkboxes
 * and left the calendar full, so the two disagreed in front of the reader; a
 * link whose category ids failed to resolve silently widened from one slice to
 * all eleven; and a feed built from an emptied selection carried everything.
 *
 * Empty now means empty. A fresh visit is *all selected*, which is a different
 * state and serializes differently.
 */

const NOW = new Date("2026-08-17T12:00:00Z");

function event(overrides: Partial<CuratedCalendarEvent> = {}): CuratedCalendarEvent {
  return {
    id: "1",
    slug: "an-event",
    title: "An event",
    shortTitle: "An event",
    endDate: "2026-08-20T16:00:00Z",
    displayDate: "2026-08-20",
    time: "12:00",
    timeKind: "scheduled",
    isAllDay: false,
    dateConfidence: "confirmed",
    dateSource: "eventEnd",
    category: "politics",
    volume: 100_000,
    liquidity: 10_000,
    primaryMarketUrl: "https://polymarket.com/event/an-event",
    relatedMarketsCount: 1,
    importanceScore: 50,
    importanceLevel: "standard",
    status: "upcoming",
    source: "polymarket",
    sourceEventIds: ["1"],
    groupedBy: "single",
    tags: [],
    ...overrides,
  };
}

/** One event in every category, so a selection can be checked exactly. */
const ONE_PER_CATEGORY: CuratedCalendarEvent[] = CATEGORY_IDS.map((category, i) =>
  event({ id: String(i), slug: `event-${category}`, category }),
);

describe("a fresh visit selects every category", () => {
  it("defaults to all of them", () => {
    expect(DEFAULT_FILTERS.categories).toEqual(ALL_CATEGORIES);
    expect(DEFAULT_FILTERS.categories).toHaveLength(CATEGORY_IDS.length);
    expect(allCategoriesSelected(DEFAULT_FILTERS)).toBe(true);
  });

  it("includes eSports, which is a category like any other", () => {
    expect(DEFAULT_FILTERS.categories).toContain("esports");
  });

  it("shows every event", () => {
    expect(filterEvents(ONE_PER_CATEGORY, DEFAULT_FILTERS, { now: NOW })).toHaveLength(
      CATEGORY_IDS.length,
    );
  });

  it("has narrowed nothing, which is not the same as having nothing to clear", () => {
    // The distinction the whole next block turns on. A fresh visit has narrowed
    // nothing — and has eleven ticked boxes waiting to be cleared.
    expect(DEFAULT_FILTERS.search).toBe("");
    expect(DEFAULT_FILTERS.minImportance).toBe("all");
    expect(DEFAULT_FILTERS.includeSmallerMarkets).toBe(false);
    expect(categorySelection(DEFAULT_FILTERS).hasSelectedCategories).toBe(true);
  });
});

/**
 * What the two buttons above the category list read.
 *
 * The bug: "Clear all" was gated on `hasActiveFilters`. Every category selected
 * is the *default*, so it counts as no narrowing — and the button that empties
 * the list was hidden in precisely the state where it had eleven things to
 * empty. It appeared only once you had already unticked a box by hand, which is
 * the one state where you least need it.
 *
 * The fix is to stop deriving one control's visibility from the other's. Count
 * first; each button asks its own question of the count. `Clear all` reads
 * `selectedCategoryCount > 0`, `Show all` reads `allCategoriesSelected`, and at
 * full selection *both* are true — which is the case that used to be impossible
 * to express and is asserted below.
 */
describe("the category controls read the count, not each other", () => {
  const withCategories = (categories: CalendarCategory[]) => ({
    ...DEFAULT_FILTERS,
    categories,
  });

  it("offers Clear all on a fresh visit, with everything ticked", () => {
    const { selectedCategoryCount, hasSelectedCategories, allCategoriesSelected } =
      categorySelection(DEFAULT_FILTERS);
    expect(selectedCategoryCount).toBe(CATEGORY_IDS.length);
    // Both true at once. The old gate could not produce this, and that was the bug.
    expect(hasSelectedCategories).toBe(true);
    expect(allCategoriesSelected).toBe(true);
  });

  it("never derives Clear all from 'not everything is selected'", () => {
    // Stated as its own assertion because the wrong version passes every other
    // test in this block: at full selection the two predicates disagree, and
    // `hasSelectedCategories` is the one the button reads.
    const full = categorySelection(withCategories(ALL_CATEGORIES));
    expect(full.hasSelectedCategories).toBe(!full.allCategoriesSelected === false);
    expect(full.hasSelectedCategories).not.toBe(!full.allCategoriesSelected);
  });

  it("offers both when several are selected", () => {
    const some = categorySelection(withCategories(["sports", "crypto", "economy"]));
    expect(some.selectedCategoryCount).toBe(3);
    expect(some.hasSelectedCategories).toBe(true);
    expect(some.allCategoriesSelected).toBe(false);
  });

  it("offers both when exactly one is selected", () => {
    const one = categorySelection(withCategories(["esports"]));
    expect(one.selectedCategoryCount).toBe(1);
    expect(one.hasSelectedCategories).toBe(true);
    expect(one.allCategoriesSelected).toBe(false);
  });

  it("withdraws Clear all only at zero, where there is genuinely nothing to clear", () => {
    const none = categorySelection(withCategories([]));
    expect(none.selectedCategoryCount).toBe(0);
    expect(none.hasSelectedCategories).toBe(false);
    // And Show all is the way out, so it must not be disabled here.
    expect(none.allCategoriesSelected).toBe(false);
  });

  it("counts a duplicated id once, so a malformed URL cannot fake a full list", () => {
    const doubled = categorySelection(withCategories(["sports", "sports", "crypto"]));
    expect(doubled.selectedCategoryCount).toBe(2);
    expect(doubled.allCategoriesSelected).toBe(false);
  });

  it("agrees with the standalone predicate every other caller uses", () => {
    for (const categories of [
      ALL_CATEGORIES,
      [] as CalendarCategory[],
      ["sports"] as CalendarCategory[],
      ["sports", "crypto"] as CalendarCategory[],
    ]) {
      const filters = withCategories(categories);
      expect(allCategoriesSelected(filters)).toBe(
        categorySelection(filters).allCategoriesSelected,
      );
    }
  });
});

describe("Clear empties the calendar, not just the checkboxes", () => {
  const cleared = { ...DEFAULT_FILTERS, categories: [] };

  it("shows zero events", () => {
    expect(filterEvents(ONE_PER_CATEGORY, cleared, { now: NOW })).toHaveLength(0);
  });

  it("is a state the reader can see they are in", () => {
    const selection = categorySelection(cleared);
    expect(selection.selectedCategoryCount).toBe(0);
    expect(selection.hasSelectedCategories).toBe(false);
    expect(allCategoriesSelected(cleared)).toBe(false);
  });

  it("does not read an empty list as every list", () => {
    // The single assertion this whole file exists for.
    expect(filterEvents(ONE_PER_CATEGORY, cleared, { now: NOW }).length).not.toBe(
      ONE_PER_CATEGORY.length,
    );
  });
});

describe("Show all is the way back", () => {
  it("returns every event", () => {
    const shown = { ...DEFAULT_FILTERS, categories: ALL_CATEGORIES };
    expect(filterEvents(ONE_PER_CATEGORY, shown, { now: NOW })).toHaveLength(
      CATEGORY_IDS.length,
    );
  });
});

describe("a partial selection is exactly that selection", () => {
  it("returns one category", () => {
    const filters = { ...DEFAULT_FILTERS, categories: ["esports" as CalendarCategory] };
    const shown = filterEvents(ONE_PER_CATEGORY, filters, { now: NOW });
    expect(shown).toHaveLength(1);
    expect(shown[0].category).toBe("esports");
  });

  it("returns several", () => {
    const categories: CalendarCategory[] = ["sports", "crypto", "economy"];
    const shown = filterEvents(ONE_PER_CATEGORY, { ...DEFAULT_FILTERS, categories }, { now: NOW });
    expect(shown.map((e) => e.category).sort()).toEqual([...categories].sort());
  });

  it("keeps Sports and eSports apart", () => {
    const sports = filterEvents(
      ONE_PER_CATEGORY,
      { ...DEFAULT_FILTERS, categories: ["sports"] },
      { now: NOW },
    );
    expect(sports.map((e) => e.category)).toEqual(["sports"]);
  });
});

describe("the URL reproduces every state", () => {
  const base = {
    view: "month" as const,
    anchor: new Date("2026-08-01T12:00:00Z"),
    selected: null,
  };

  it("omits the parameter when everything is selected", () => {
    expect(serializeCategories(ALL_CATEGORIES)).toBeNull();
  });

  it("writes an explicit token when nothing is", () => {
    expect(serializeCategories([])).toBe(NO_CATEGORIES_TOKEN);
  });

  it("reads a missing parameter as a fresh visit", () => {
    expect(parseCategories(null)).toEqual(ALL_CATEGORIES);
  });

  it("reads the token as genuinely empty", () => {
    expect(parseCategories(NO_CATEGORIES_TOKEN)).toEqual([]);
  });

  it("survives a refresh after Clear", () => {
    const cleared = { ...base, filters: { ...DEFAULT_FILTERS, categories: [] } };
    const query = serializeCalendarUrlState(cleared, NOW);
    const parsed = parseCalendarUrlState(new URLSearchParams(query), NOW);
    expect(parsed.filters.categories).toEqual([]);
    expect(filterEvents(ONE_PER_CATEGORY, parsed.filters, { now: NOW })).toHaveLength(0);
  });

  it("leaves every other filter standing when Clear all empties the categories", () => {
    /*
     * Clear all is a *category* action now, and this is the assertion that
     * keeps it one. It used to be a global reset, which meant it also flipped
     * `includeSmallerMarkets` — and that is the single filter that changes
     * which dataset the month is, so clearing the checkboxes kicked off a
     * refetch and blanked the grid while it ran. Narrowing the action is what
     * makes "Clear all must not unload the month" true by construction.
     */
    const before = {
      ...base,
      filters: {
        ...DEFAULT_FILTERS,
        categories: ALL_CATEGORIES,
        minImportance: "important" as const,
        includeSmallerMarkets: true,
        weekendOnly: true,
        favoritesOnly: true,
      },
    };
    const after = { ...before, filters: { ...before.filters, categories: [] } };

    const params = new URLSearchParams(serializeCalendarUrlState(after, NOW));
    expect(params.get("categories")).toBe(NO_CATEGORIES_TOKEN);
    expect(params.get("smaller")).toBe("1");
    expect(params.get("importance")).toBe("important");
    expect(params.get("weekend")).toBe("1");
    expect(params.get("starred")).toBe("1");

    // And the month's cache identity — view, anchor, smaller — is untouched, so
    // there is nothing for the loader to go and fetch.
    const parsed = parseCalendarUrlState(params, NOW);
    expect(parsed.filters.includeSmallerMarkets).toBe(
      before.filters.includeSmallerMarkets,
    );
    expect(parsed.anchor.getTime()).toBe(before.anchor.getTime());
  });

  it("survives a refresh after Show all", () => {
    const all = { ...base, filters: { ...DEFAULT_FILTERS, categories: ALL_CATEGORIES } };
    const query = serializeCalendarUrlState(all, NOW);
    const parsed = parseCalendarUrlState(new URLSearchParams(query), NOW);
    expect(new Set(parsed.filters.categories)).toEqual(new Set(ALL_CATEGORIES));
  });

  it("survives a refresh with a partial selection", () => {
    const some = {
      ...base,
      filters: { ...DEFAULT_FILTERS, categories: ["crypto", "esports"] as CalendarCategory[] },
    };
    const query = serializeCalendarUrlState(some, NOW);
    const parsed = parseCalendarUrlState(new URLSearchParams(query), NOW);
    expect(parsed.filters.categories.sort()).toEqual(["crypto", "esports"]);
  });

  it("round-trips every state without drifting", () => {
    for (const categories of [
      ALL_CATEGORIES,
      [] as CalendarCategory[],
      ["sports"] as CalendarCategory[],
      ["sports", "esports", "world"] as CalendarCategory[],
    ]) {
      const state = { ...base, filters: { ...DEFAULT_FILTERS, categories } };
      const once = serializeCalendarUrlState(state, NOW);
      const parsed = parseCalendarUrlState(new URLSearchParams(once), NOW);
      const twice = serializeCalendarUrlState({ ...state, filters: parsed.filters }, NOW);
      expect(twice).toBe(once);
    }
  });

  it("resolves a retired id rather than dropping it and widening the link", () => {
    // `entertainment` was folded into `culture`. Dropping it would leave an
    // empty list, which now means *nothing* rather than everything — a
    // different wrong answer, and still wrong.
    expect(parseCategories("entertainment")).toEqual(["culture"]);
  });
});

describe("the same rules serve the feed", () => {
  it("matches an event the calendar would show", () => {
    const filters = { ...DEFAULT_FILTERS, categories: ["politics" as CalendarCategory] };
    expect(matchesSelection(event(), filters, { now: NOW })).toBe(true);
  });

  it("rejects one outside the selection", () => {
    const filters = { ...DEFAULT_FILTERS, categories: ["sports" as CalendarCategory] };
    expect(matchesSelection(event(), filters, { now: NOW })).toBe(false);
  });

  it("still matches a cancelled event, which is how tombstones reach a feed", () => {
    // `filterEvents` always rejects these; `matchesSelection` answers the
    // narrower question so the feed route does not need its own copy of the
    // category and importance rules.
    const retired = event({ status: "cancelled" });
    expect(filterEvents([retired], DEFAULT_FILTERS, { now: NOW })).toHaveLength(0);
    expect(matchesSelection(retired, DEFAULT_FILTERS, { now: NOW })).toBe(true);
  });

  it("publishes nothing for an empty selection", () => {
    const none = { ...DEFAULT_FILTERS, categories: [] };
    expect(matchesSelection(event(), none, { now: NOW })).toBe(false);
  });
});
