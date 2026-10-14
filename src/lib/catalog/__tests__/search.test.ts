import { describe, expect, it } from "vitest";
import { searchEvents, seriesKey, seriesKeyFromTitle } from "../search";
import type { CalendarCategory, CuratedCalendarEvent } from "../../curation/types";

/**
 * Search: recurring-series discovery and ranking.
 *
 * The requirement in one sentence: somebody typing "Fed Decision" should find
 * the September, October and December meetings, in that order, and should not
 * be led with July's — which resolved three weeks ago and, being finished,
 * out-trades all of them.
 *
 * Three separate rules have to hold together for that. The events must stay
 * three separate events; a query has to reach the ones whose titles do not
 * literally contain it; and upcoming has to beat settled even when settled has
 * the bigger number.
 */

const FED_SERIES = "fomc";

function event(overrides: Partial<CuratedCalendarEvent> = {}): CuratedCalendarEvent {
  return {
    id: "1",
    slug: "an-event",
    title: "An event",
    shortTitle: "An event",
    endDate: "2026-09-16T18:00:00Z",
    displayDate: "2026-09-16",
    time: "14:00",
    timeKind: "scheduled",
    isAllDay: false,
    dateConfidence: "confirmed",
    dateSource: "eventEnd",
    category: "economy",
    volume: 1_000_000,
    liquidity: 100_000,
    primaryMarketUrl: "https://polymarket.com/event/an-event",
    relatedMarketsCount: 1,
    importanceScore: 60,
    importanceLevel: "important",
    status: "upcoming",
    source: "polymarket",
    sourceEventIds: ["1"],
    groupedBy: "single",
    tags: [],
    ...overrides,
  };
}

/** The real shape: one Gamma series, several months, one already resolved. */
const FED_FAMILY: CuratedCalendarEvent[] = [
  event({
    id: "f-jul",
    slug: "fed-decision-in-july",
    title: "Fed Decision in July?",
    displayDate: "2026-07-29",
    status: "resolved",
    // Deliberately the biggest of the four: a finished market has traded for
    // months, so volume alone would put it first.
    volume: 9_000_000,
    importanceLevel: "major",
    seriesSlug: FED_SERIES,
    seriesTitle: "Fed decisions",
  }),
  event({
    id: "f-sep",
    slug: "fed-decision-in-september",
    title: "Fed Decision in September?",
    displayDate: "2026-09-16",
    volume: 3_000_000,
    importanceLevel: "major",
    seriesSlug: FED_SERIES,
    seriesTitle: "Fed decisions",
  }),
  event({
    id: "f-oct",
    slug: "fed-decision-in-october",
    title: "Fed Decision in October?",
    displayDate: "2026-10-28",
    volume: 1_200_000,
    seriesSlug: FED_SERIES,
    seriesTitle: "Fed decisions",
  }),
  event({
    id: "f-dec",
    slug: "fed-decision-in-december",
    title: "Fed Decision in December?",
    displayDate: "2026-12-09",
    volume: 600_000,
    seriesSlug: FED_SERIES,
    seriesTitle: "Fed decisions",
  }),
];

const NOISE: CuratedCalendarEvent[] = [
  event({
    id: "boc",
    slug: "bank-of-canada-decision-in-september",
    title: "Bank of Canada Decision in September?",
    displayDate: "2026-09-02",
    volume: 400_000,
    seriesSlug: "bank-of-canada-decision",
  }),
  event({
    id: "cs2",
    slug: "cs2-legacy-vs-faze",
    title: "Counter-Strike: Legacy vs FaZe (BO3) - Esports World Cup",
    displayDate: "2026-08-13",
    category: "esports",
    volume: 166_000,
  }),
  event({
    id: "mlb",
    slug: "mlb-yankees-vs-red-sox",
    title: "Yankees vs Red Sox",
    displayDate: "2026-08-13",
    category: "sports",
    volume: 1_400_000,
  }),
];

const ALL = [...FED_FAMILY, ...NOISE];
const EVERY_CATEGORY: CalendarCategory[] = [
  "politics", "elections", "sports", "esports", "crypto",
  "economy", "business", "technology", "ai", "world", "culture",
];

function titles(query: string, categories: CalendarCategory[] = EVERY_CATEGORY): string[] {
  return searchEvents(ALL, query, { categories }).map((h) => h.event.title);
}

describe("a series identity, without merging anything", () => {
  it("strips the month and year from a title", () => {
    expect(seriesKeyFromTitle("Fed Decision in September?")).toBe("fed decision");
    expect(seriesKeyFromTitle("ECB Interest Rates: October 2026")).toBe("ecb interest rates");
    expect(seriesKeyFromTitle("Bank of Canada Decision in September?")).toBe(
      "bank of canada decision",
    );
  });

  it("does not collapse two different questions about the same body", () => {
    // The reason the fallback is only a fallback: these normalise close
    // together and are not the same series at all.
    expect(seriesKeyFromTitle("Fed Decision in September?")).not.toBe(
      seriesKeyFromTitle("How many Fed rate hikes in 2026?"),
    );
  });

  it("prefers Gamma's own slug over the guess", () => {
    expect(seriesKey(FED_FAMILY[1])).toBe(FED_SERIES);
    expect(seriesKey(NOISE[2])).toBe("yankees vs red sox");
  });

  it("keeps every instalment a separate event", () => {
    const found = titles("Fed Decision");
    expect(new Set(found).size).toBe(found.length);
    expect(found.length).toBeGreaterThanOrEqual(4);
  });
});

describe("searching a series finds all of it", () => {
  it("returns September, October and December for `Fed Decision`", () => {
    const found = titles("Fed Decision");
    expect(found).toContain("Fed Decision in September?");
    expect(found).toContain("Fed Decision in October?");
    expect(found).toContain("Fed Decision in December?");
  });

  it("reaches them by series slug, which no title contains", () => {
    // Gamma calls this series `fomc` and not one of the four titles says so.
    const found = titles("fomc");
    expect(found).toContain("Fed Decision in September?");
    expect(found).toContain("Fed Decision in October?");
    expect(found).toContain("Fed Decision in December?");
  });

  it("brings in siblings a more specific query cannot match by title", () => {
    /*
     * The series rung doing the work it exists for. "Fed Decision in
     * September" matches September's title outright; October's title does not
     * contain that string and could only be reached through the series they
     * share. Without it, asking about one month's meeting hides the next one.
     */
    const found = titles("Fed Decision in September");
    expect(found[0]).toBe("Fed Decision in September?");
    expect(found).toContain("Fed Decision in October?");
    expect(found).not.toContain("Bank of Canada Decision in September?");
  });

  it("does not drag in an unrelated central bank", () => {
    expect(titles("Fed Decision")).not.toContain("Bank of Canada Decision in September?");
  });

  it("finds one bank without the others", () => {
    expect(titles("bank of canada")).toEqual(["Bank of Canada Decision in September?"]);
  });
});

describe("upcoming outranks resolved", () => {
  it("does not lead with July, whatever its volume", () => {
    const found = titles("Fed Decision");
    expect(found[0]).not.toBe("Fed Decision in July?");
    expect(found[0]).toBe("Fed Decision in September?");
  });

  it("still returns July, below the live ones", () => {
    const found = titles("Fed Decision");
    expect(found).toContain("Fed Decision in July?");
    expect(found.indexOf("Fed Decision in July?")).toBeGreaterThan(
      found.indexOf("Fed Decision in December?"),
    );
  });

  it("orders the upcoming ones by date once merit ties", () => {
    const found = titles("Fed Decision").filter((t) => t !== "Fed Decision in July?");
    expect(found).toEqual([
      "Fed Decision in September?",
      "Fed Decision in October?",
      "Fed Decision in December?",
    ]);
  });
});

describe("text match beats merit", () => {
  it("an exact title wins outright", () => {
    const hits = searchEvents(ALL, "Yankees vs Red Sox", { categories: EVERY_CATEGORY });
    expect(hits[0].event.title).toBe("Yankees vs Red Sox");
  });

  it("a title match beats a bigger event that only matches its tags", () => {
    const found = titles("counter-strike");
    expect(found[0]).toBe("Counter-Strike: Legacy vs FaZe (BO3) - Esports World Cup");
  });

  it("volume cannot lift an event out of a weaker match band", () => {
    // The MLB game out-trades the CS2 match eight to one and does not match.
    expect(titles("counter-strike")).not.toContain("Yankees vs Red Sox");
  });
});

describe("search obeys the category filter", () => {
  it("returns nothing when no categories are selected", () => {
    expect(titles("Fed Decision", [])).toEqual([]);
  });

  it("narrows to the selected categories", () => {
    expect(titles("", ["esports"])).toEqual([
      "Counter-Strike: Legacy vs FaZe (BO3) - Esports World Cup",
    ]);
  });

  it("keeps eSports out of a Sports-only search", () => {
    const found = titles("", ["sports"]);
    expect(found).toEqual(["Yankees vs Red Sox"]);
  });
});

describe("an empty query is a sensible starting list", () => {
  it("ranks by merit rather than returning nothing", () => {
    const found = titles("");
    expect(found.length).toBeGreaterThan(0);
    // The resolved one is not the headline suggestion.
    expect(found[0]).not.toBe("Fed Decision in July?");
  });

  it("respects the limit", () => {
    expect(searchEvents(ALL, "", { categories: EVERY_CATEGORY, limit: 3 })).toHaveLength(3);
  });
});

describe("merging two sources cannot reorder the result", () => {
  /*
   * The bug this pins was invisible to every test above, because it was not in
   * the ranking at all — it was in how the dialog *rendered* two sources.
   *
   * The search box has the loaded month in memory and the wider catalog behind
   * a fetch. Rendering the local half first and the remote half underneath put
   * July's resolved decision at the top of a search for "Fed Decision": it sits
   * in the loaded grid, and no amount of correct ranking inside each half could
   * fix an ordering imposed between them. Ranking the union once is the fix,
   * and this is the shape of the assertion that holds it.
   */
  it("ranks the union, not each half", () => {
    const loadedMonth = [FED_FAMILY[0]]; // July, resolved, and the biggest
    const catalog = FED_FAMILY.slice(1); // September onward, upcoming

    const merged = searchEvents([...loadedMonth, ...catalog], "Fed Decision", {
      categories: EVERY_CATEGORY,
    }).map((h) => h.event.title);

    expect(merged[0]).toBe("Fed Decision in September?");
    expect(merged.indexOf("Fed Decision in July?")).toBeGreaterThan(0);
  });

  it("gives the same answer whichever order the halves arrive in", () => {
    const a = searchEvents(FED_FAMILY, "Fed Decision", { categories: EVERY_CATEGORY });
    const b = searchEvents([...FED_FAMILY].reverse(), "Fed Decision", {
      categories: EVERY_CATEGORY,
    });
    expect(a.map((h) => h.event.id)).toEqual(b.map((h) => h.event.id));
  });

  it("survives an event whose tags did not survive the wire", () => {
    // `/api/search` sends a trimmed projection. `tags` used to be absent from
    // it, so a query that fell through to the secondary rung threw on a
    // catalog result and returned nothing at all.
    const trimmed = { ...FED_FAMILY[1] } as Partial<CuratedCalendarEvent>;
    delete trimmed.tags;
    expect(() =>
      searchEvents([trimmed as CuratedCalendarEvent], "economy", {
        categories: EVERY_CATEGORY,
      }),
    ).not.toThrow();
  });
});

describe("ordering is stable", () => {
  it("returns the same order for the same query", () => {
    expect(titles("Fed Decision")).toEqual(titles("Fed Decision"));
  });

  it("ignores case and punctuation", () => {
    expect(titles("fed decision")).toEqual(titles("FED  DECISION!"));
  });
});
