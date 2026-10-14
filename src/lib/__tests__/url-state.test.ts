import { describe, expect, it } from "vitest";
import { toDateKey, toMonthKey } from "../dates";
import { parseCalendarUrlState, serializeCalendarUrlState } from "../url-state";

const NOW = new Date(2026, 7, 5, 12); // 5 August 2026, local

function roundTrip(query: string): string {
  const parsed = parseCalendarUrlState(new URLSearchParams(query), NOW);
  return serializeCalendarUrlState(parsed, NOW);
}

describe("URL state", () => {
  it("preserves view, month, categories, importance and search", () => {
    const parsed = parseCalendarUrlState(
      new URLSearchParams(
        "view=agenda&month=2026-09&categories=politics,ai&importance=important&q=fed&smaller=1",
      ),
      NOW,
    );
    expect(parsed.view).toBe("agenda");
    expect(toMonthKey(parsed.anchor)).toBe("2026-09");
    expect(parsed.filters.categories).toEqual(["politics", "ai"]);
    expect(parsed.filters.minImportance).toBe("important");
    expect(parsed.filters.search).toBe("fed");
    expect(parsed.filters.includeSmallerMarkets).toBe(true);
  });

  it("survives a round trip unchanged", () => {
    const query = "view=agenda&month=2026-09&categories=ai,politics&importance=major&q=fed";
    const once = roundTrip(query);
    expect(roundTrip(once)).toBe(once);

    const parsed = parseCalendarUrlState(new URLSearchParams(once), NOW);
    expect(parsed.view).toBe("agenda");
    expect(parsed.filters.categories.sort()).toEqual(["ai", "politics"]);
    expect(parsed.filters.minImportance).toBe("major");
    expect(parsed.filters.search).toBe("fed");
  });

  it("reproduces the same calendar from a shared link", () => {
    const shared = "?view=week&date=2026-08-12&categories=sports&importance=major";
    const parsed = parseCalendarUrlState(new URLSearchParams(shared), NOW);
    expect(parsed.view).toBe("week");
    expect(toDateKey(parsed.anchor)).toBe("2026-08-12");
    expect(parsed.filters.categories).toEqual(["sports"]);
  });

  it("keeps day precision in week view so navigation moves", () => {
    const state = parseCalendarUrlState(new URLSearchParams("view=week&date=2026-08-12"), NOW);
    const nextWeek = { ...state, anchor: new Date(2026, 7, 19, 12) };
    const query = serializeCalendarUrlState(nextWeek, NOW);
    expect(query).toContain("date=2026-08-19");
    expect(toDateKey(parseCalendarUrlState(new URLSearchParams(query), NOW).anchor)).toBe(
      "2026-08-19",
    );
  });

  it("writes nothing for a default view", () => {
    expect(serializeCalendarUrlState(parseCalendarUrlState(new URLSearchParams(), NOW), NOW)).toBe("");
  });

  it("sorts categories so the same selection yields the same URL", () => {
    const a = roundTrip("categories=politics,ai");
    const b = roundTrip("categories=ai,politics");
    expect(a).toBe(b);
  });

  describe("invalid input falls back safely", () => {
    it("ignores an unknown view", () => {
      expect(parseCalendarUrlState(new URLSearchParams("view=galaxy"), NOW).view).toBe("month");
    });

    it("drops unknown categories but keeps valid ones", () => {
      const parsed = parseCalendarUrlState(
        new URLSearchParams("categories=politics,dragons,,ai"),
        NOW,
      );
      expect(parsed.filters.categories).toEqual(["politics", "ai"]);
    });

    it("ignores an unknown importance level", () => {
      expect(
        parseCalendarUrlState(new URLSearchParams("importance=colossal"), NOW).filters
          .minImportance,
      ).toBe("all");
    });

    it("falls back to the current month for a malformed date", () => {
      for (const bad of ["month=2026-13", "month=banana", "month=2026-02-31", "date=nope"]) {
        const parsed = parseCalendarUrlState(new URLSearchParams(bad), NOW);
        expect(Number.isNaN(parsed.anchor.getTime())).toBe(false);
      }
      expect(toMonthKey(parseCalendarUrlState(new URLSearchParams("month=2026-13"), NOW).anchor)).toBe(
        "2026-08",
      );
    });

    it("ignores a malformed selected day", () => {
      expect(parseCalendarUrlState(new URLSearchParams("selected=5th-august"), NOW).selected).toBeNull();
      expect(parseCalendarUrlState(new URLSearchParams("selected=2026-08-11"), NOW).selected).toBe(
        "2026-08-11",
      );
    });

    it("treats an empty category list as no filter", () => {
      expect(parseCalendarUrlState(new URLSearchParams("categories="), NOW).filters.categories).toEqual([]);
    });

    /*
     * The trap this guards: a retired id that is merely *dropped* leaves an
     * empty list, and an empty list means "every category". A year-old link
     * asking for one slice would silently start showing all of them, and so
     * would every calendar already subscribed to that feed.
     */
    it("resolves a retired category onto the one that absorbed it", () => {
      const parsed = parseCalendarUrlState(
        new URLSearchParams("categories=entertainment"),
        NOW,
      );
      expect(parsed.filters.categories).toEqual(["culture"]);
      expect(parsed.filters.categories).not.toEqual([]);
    });

    it("does not duplicate when a retired id and its target are both present", () => {
      const parsed = parseCalendarUrlState(
        new URLSearchParams("categories=entertainment,culture,politics"),
        NOW,
      );
      expect(parsed.filters.categories).toEqual(["culture", "politics"]);
    });
  });

  it("keeps transient UI state out of the URL", () => {
    // Onboarding, dialogs and sheets must never be serialized.
    const query = roundTrip("view=week&date=2026-08-12&categories=sports");
    for (const key of ["onboarding", "step", "dialog", "sheet", "open"]) {
      expect(query).not.toContain(key);
    }
  });
});
