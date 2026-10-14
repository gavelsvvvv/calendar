import { describe, expect, it } from "vitest";
import { buildFeedUrl, feedSelectionFromFilters } from "@/lib/calendar-export/feed-url";
import {
  ALL_ESPORTS,
  ALL_SPORTS,
  DEFAULT_FILTERS,
  esportSelection,
  filterEvents,
  needsTargetedTier,
  sportSelection,
  type CalendarFilters,
} from "../filters";
import type { CuratedCalendarEvent } from "../types";
import { parseCalendarUrlState, serializeCalendarUrlState } from "@/lib/url-state";
import { ESPORT_IDS, SPORT_IDS } from "@/lib/sports/taxonomy";
import { MAX_TARGETED_PER_SPORT_PER_DAY } from "@/config/market-exclusions";
import { curateEvents } from "../curate";
import { gammaEvent } from "./fixtures";

/**
 * The scenarios the brief asks for by name (§39 A–M).
 *
 * Written against the filter pipeline rather than against React, because that
 * is where the rules actually live: every surface — grid, week, agenda, search,
 * feeds — runs through `filterEvents`, so a rule proven here is proven for all
 * of them. The two that are genuinely about wiring (K, L) are asserted through
 * URL round-tripping, which is the mechanism that actually carries the state.
 */

let seq = 0;
function event(over: Partial<CuratedCalendarEvent> = {}): CuratedCalendarEvent {
  seq += 1;
  return {
    id: `e${seq}`,
    slug: `e${seq}`,
    title: `Event ${seq}`,
    shortTitle: `Event ${seq}`,
    endDate: "2026-09-10T18:00:00.000Z",
    displayDate: "2026-09-10",
    time: "14:00",
    timeKind: "scheduled",
    timezone: "America/New_York",
    isAllDay: false,
    dateConfidence: "confirmed",
    dateSource: "gameStartTime",
    category: "sports",
    volume: 900_000,
    liquidity: 10_000,
    primaryMarketUrl: "https://polymarket.com/event/x",
    relatedMarketsCount: 1,
    importanceScore: 10,
    importanceLevel: "standard",
    status: "upcoming",
    tags: [],
    ...over,
  } as CuratedCalendarEvent;
}

const now = new Date("2026-09-08T12:00:00.000Z");
const show = (events: CuratedCalendarEvent[], filters: CalendarFilters) =>
  filterEvents(events, filters, { now }).map((e) => e.id);

/** A broad tennis event, a targeted-only tennis event, and an NFL one. */
const tennisBroad = event({ id: "tennis-broad", sportId: "tennis" });
const tennisTargeted = event({
  id: "tennis-targeted",
  sportId: "tennis",
  volume: 900,
  targetedOnly: true,
});
const nflBroad = event({ id: "nfl-broad", sportId: "american-football" });
const cs2Broad = event({ id: "cs2-broad", category: "esports", esportGameId: "cs2" });
const cs2Targeted = event({
  id: "cs2-targeted",
  category: "esports",
  esportGameId: "cs2",
  volume: 700,
  targetedOnly: true,
});
const dotaBroad = event({ id: "dota-broad", category: "esports", esportGameId: "dota2" });
const politics = event({ id: "politics", category: "politics", sportId: undefined });

const ALL = [
  tennisBroad,
  tennisTargeted,
  nflBroad,
  cs2Broad,
  cs2Targeted,
  dotaBroad,
  politics,
];

describe("§39 A–E · sport sub-filter", () => {
  it("A) Sport off → no sport events", () => {
    const shown = show(ALL, {
      ...DEFAULT_FILTERS,
      categories: DEFAULT_FILTERS.categories.filter((c) => c !== "sports"),
    });
    expect(shown).not.toContain("tennis-broad");
    expect(shown).not.toContain("nfl-broad");
    expect(shown).not.toContain("tennis-targeted");
    // Everything else is untouched.
    expect(shown).toContain("politics");
    expect(shown).toContain("cs2-broad");
  });

  it("B) Sport on + All Sports → the existing behaviour, and nothing extra", () => {
    const shown = show(ALL, DEFAULT_FILTERS);
    expect(shown).toContain("tennis-broad");
    expect(shown).toContain("nfl-broad");
    // The whole safety property of the feature, in one assertion.
    expect(shown).not.toContain("tennis-targeted");
    expect(shown).not.toContain("cs2-targeted");
  });

  it("C) Sport on + Tennis → only tennis, and the $500 tier is unlocked", () => {
    const filters: CalendarFilters = { ...DEFAULT_FILTERS, sports: ["tennis"] };
    const shown = show(ALL, filters);
    expect(shown).toContain("tennis-broad");
    expect(shown).toContain("tennis-targeted");
    expect(shown).not.toContain("nfl-broad");
    expect(sportSelection(filters).targeted).toBe(true);
    expect(needsTargetedTier(filters)).toBe(true);
  });

  it("D) Sport on + three sports → those three, still targeted", () => {
    const filters: CalendarFilters = {
      ...DEFAULT_FILTERS,
      sports: ["tennis", "american-football", "basketball"],
    };
    const shown = show(ALL, filters);
    expect(shown).toEqual(expect.arrayContaining(["tennis-broad", "tennis-targeted", "nfl-broad"]));
    expect(needsTargetedTier(filters)).toBe(true);
  });

  it("E) Sport on + All Sports → NOT the targeted tier", () => {
    expect(sportSelection(DEFAULT_FILTERS).targeted).toBe(false);
    expect(needsTargetedTier(DEFAULT_FILTERS)).toBe(false);
    // And ticking every box by hand is the same state as never touching it.
    const everyBoxTicked: CalendarFilters = { ...DEFAULT_FILTERS, sports: [...SPORT_IDS] };
    expect(needsTargetedTier(everyBoxTicked)).toBe(false);
    expect(show(ALL, everyBoxTicked)).toEqual(show(ALL, DEFAULT_FILTERS));
  });
});

describe("§39 F–H · esport sub-filter", () => {
  it("F) eSport on + All Games → the existing behaviour", () => {
    const shown = show(ALL, DEFAULT_FILTERS);
    expect(shown).toContain("cs2-broad");
    expect(shown).toContain("dota-broad");
    expect(shown).not.toContain("cs2-targeted");
  });

  it("G) eSport on + CS2 → only CS2, targeted", () => {
    const filters: CalendarFilters = { ...DEFAULT_FILTERS, esports: ["cs2"] };
    const shown = show(ALL, filters);
    expect(shown).toContain("cs2-broad");
    expect(shown).toContain("cs2-targeted");
    expect(shown).not.toContain("dota-broad");
    expect(esportSelection(filters).targeted).toBe(true);
  });

  it("H) eSport on + CS2 + Dota 2 + LoL → those games only", () => {
    const shown = show(ALL, { ...DEFAULT_FILTERS, esports: ["cs2", "dota2", "lol"] });
    expect(shown).toEqual(expect.arrayContaining(["cs2-broad", "cs2-targeted", "dota-broad"]));
    // Sports are a separate axis and must be unaffected.
    expect(shown).toContain("tennis-broad");
  });
});

describe("§39 I–J · clearing and remembering", () => {
  it("I) global Clear all → nothing from Sport or eSport, whatever the sub-selection", () => {
    const shown = show(ALL, { ...DEFAULT_FILTERS, categories: [], sports: ["tennis"] });
    expect(shown).toEqual([]);
  });

  it("J) disabling and re-enabling Sport restores the sub-selection", () => {
    const narrowed: CalendarFilters = { ...DEFAULT_FILTERS, sports: ["tennis"] };
    // Unticking the parent category cannot touch the sub-selection: they are
    // different fields, which is what makes this work rather than a re-entry.
    const off: CalendarFilters = {
      ...narrowed,
      categories: narrowed.categories.filter((c) => c !== "sports"),
    };
    expect(off.sports).toEqual(["tennis"]);
    expect(show(ALL, off)).not.toContain("tennis-broad");

    const backOn: CalendarFilters = { ...off, categories: DEFAULT_FILTERS.categories };
    expect(show(ALL, backOn)).toContain("tennis-targeted");
  });

  it("§33) Sport on with zero sports selected shows no sport events", () => {
    const shown = show(ALL, { ...DEFAULT_FILTERS, sports: [] });
    expect(shown).not.toContain("tennis-broad");
    expect(shown).not.toContain("tennis-targeted");
    // The rest of the calendar is still there — no giant empty state.
    expect(shown).toContain("politics");
    expect(shown).toContain("cs2-broad");
    // An empty selection is not a targeted one, so it must not widen the floor.
    expect(needsTargetedTier({ ...DEFAULT_FILTERS, sports: [] })).toBe(false);
  });

  it("an unresolved sport is never hidden by a sub-filter", () => {
    // A sport we could not map has no id to match, so narrowing must not make
    // it vanish — that would look like missing data rather than a missing tag.
    const unmapped = event({ id: "unmapped", sportId: undefined });
    expect(show([unmapped], { ...DEFAULT_FILTERS, sports: ["tennis"] })).toEqual(["unmapped"]);
    // But an explicit empty selection still means no sports at all.
    expect(show([unmapped], { ...DEFAULT_FILTERS, sports: [] })).toEqual([]);
  });
});

describe("§39 K–L · the selection survives a refresh and a view change", () => {
  it("K) round-trips through the URL", () => {
    const filters: CalendarFilters = {
      ...DEFAULT_FILTERS,
      sports: ["tennis", "soccer"],
      esports: ["cs2"],
    };
    const query = serializeCalendarUrlState({
      view: "month",
      anchor: now,
      selected: null,
      filters,
    }, now);
    const back = parseCalendarUrlState(new URLSearchParams(query), now);
    expect(back.filters.sports).toEqual(["soccer", "tennis"]);
    expect(back.filters.esports).toEqual(["cs2"]);
  });

  it("K) an untouched selection leaves the URL clean", () => {
    const query = serializeCalendarUrlState(
      { view: "month", anchor: now, selected: null, filters: DEFAULT_FILTERS },
      now,
    );
    expect(query).not.toContain("sports=");
    expect(query).not.toContain("esports=");
    // And an absent parameter reads back as every sport.
    const back = parseCalendarUrlState(new URLSearchParams(query), now);
    expect(back.filters.sports).toEqual(ALL_SPORTS);
    expect(back.filters.esports).toEqual(ALL_ESPORTS);
  });

  it("K) an explicitly empty selection survives, rather than widening", () => {
    const query = serializeCalendarUrlState(
      { view: "month", anchor: now, selected: null, filters: { ...DEFAULT_FILTERS, sports: [] } },
      now,
    );
    expect(query).toContain("sports=none");
    expect(parseCalendarUrlState(new URLSearchParams(query), now).filters.sports).toEqual([]);
  });

  it("L) the selection is independent of the view", () => {
    for (const view of ["month", "week", "agenda"] as const) {
      const query = serializeCalendarUrlState(
        {
          view,
          anchor: now,
          selected: null,
          filters: { ...DEFAULT_FILTERS, sports: ["tennis"] },
        },
        now,
      );
      expect(parseCalendarUrlState(new URLSearchParams(query), now).filters.sports).toEqual([
        "tennis",
      ]);
    }
  });

  it("refuses anything that is not a real id", () => {
    const hostile = new URLSearchParams(
      "sports=tennis,../../etc/passwd,%3Cscript%3E,__proto__&esports=DROP+TABLE",
    );
    const parsed = parseCalendarUrlState(hostile, now);
    expect(parsed.filters.sports).toEqual(["tennis"]);
    expect(parsed.filters.esports).toEqual([]);
  });

  it("a selection that resolves to nothing does not silently widen", () => {
    const parsed = parseCalendarUrlState(new URLSearchParams("sports=nonsense"), now);
    expect(parsed.filters.sports).toEqual([]);
    expect(parsed.filters.sports).not.toEqual(ALL_SPORTS);
  });
});

describe("§39 M · feeds carry the same semantics", () => {
  const origin = "https://calendarpolymarket.com";

  it("M) a narrowed selection reaches the feed URL, allowlisted", () => {
    const url = new URL(
      buildFeedUrl(
        feedSelectionFromFilters({ ...DEFAULT_FILTERS, sports: ["tennis", "soccer"] }),
        origin,
      ),
    );
    expect(url.pathname).toBe("/api/calendar/custom.ics");
    expect(url.searchParams.get("sports")).toBe("soccer,tennis");
    expect(url.searchParams.get("esports")).toBeNull();
  });

  it("M) an unnarrowed selection leaves every existing feed URL exactly as it was", () => {
    // The compatibility requirement: a calendar app treats a changed URL as a
    // different calendar, so an existing subscriber's URL must not move.
    expect(buildFeedUrl(feedSelectionFromFilters(DEFAULT_FILTERS), origin)).toBe(
      `${origin}/api/calendar/all.ics`,
    );
    expect(
      buildFeedUrl(
        { ...feedSelectionFromFilters(DEFAULT_FILTERS), scope: "categories", categories: ["sports"] },
        origin,
      ),
    ).toBe(`${origin}/api/calendar/sports.ics`);
  });

  it("M) a narrowed sport feed cannot use the pretty single-category route", () => {
    // `/api/calendar/sports.ics` has nowhere to put "tennis only", so a
    // narrowed feed has to fall through to the custom route or it would hand
    // back every sport under a URL that claims otherwise.
    const url = new URL(
      buildFeedUrl(
        {
          ...feedSelectionFromFilters({ ...DEFAULT_FILTERS, sports: ["tennis"] }),
          scope: "categories",
          categories: ["sports"],
        },
        origin,
      ),
    );
    expect(url.pathname).toBe("/api/calendar/custom.ics");
    expect(url.searchParams.get("sports")).toBe("tennis");
  });

  it("M) every id in a feed URL comes from the allowlist", () => {
    const url = buildFeedUrl(
      feedSelectionFromFilters({ ...DEFAULT_FILTERS, esports: ["cs2", "lol"] }),
      origin,
    );
    const value = new URL(url).searchParams.get("esports") ?? "";
    for (const id of value.split(",")) {
      expect(ESPORT_IDS as readonly string[]).toContain(id);
    }
  });
});

/* ------------------------------------------------- the two tiers, end to end */

describe("curation builds two tiers without disturbing the first", () => {
  const NOW = new Date("2026-09-08T12:00:00.000Z");

  /** A tennis fixture at a chosen volume, on a chosen day. */
  const match = (id: string, volume: number, day = "10") =>
    gammaEvent({
      id,
      slug: `tennis-${id}`,
      title: `Tennis: Player ${id} vs Player Z`,
      volume,
      liquidity: 0,
      tags: [{ id: "t", label: "Tennis", slug: "tennis" }],
      endDate: `2026-09-${day}T16:00:00Z`,
      markets: [
        {
          id: `m${id}`,
          question: "Winner?",
          slug: `m-${id}`,
          endDate: `2026-09-${day}T16:00:00Z`,
          hasReviewedDates: true,
          outcomes: '["Yes", "No"]',
          outcomePrices: '["0.5", "0.5"]',
          volume: String(volume),
          liquidity: "0",
        },
      ],
    });

  it("drops the targeted tier entirely unless it was asked for", () => {
    const raw = [match("1", 900_000), match("2", 900), match("3", 800)];

    const shallow = curateEvents(raw, { now: NOW });
    expect(shallow.events.filter((e) => e.targetedOnly)).toHaveLength(0);
    expect(shallow.events.map((e) => e.id)).toEqual(["1"]);
    expect(shallow.stats.excludedBy["targeted-tier-not-requested"]).toBe(2);

    const deep = curateEvents(raw, { now: NOW, includeTargeted: true });
    expect(deep.events.filter((e) => e.targetedOnly).map((e) => e.id).sort()).toEqual(["2", "3"]);
  });

  it("leaves the broad tier byte-identical when the targeted one is added", () => {
    const broadOnly = [match("1", 900_000), match("4", 800_000)];
    const withTargeted = [...broadOnly, match("2", 900), match("3", 700), match("5", 600)];

    const before = curateEvents(broadOnly, { now: NOW });
    const after = curateEvents(withTargeted, { now: NOW, includeTargeted: true });

    // The two events the broad calendar showed are the same two, in the same
    // order, with the same levels — the $500 rows cannot displace them, which
    // is the whole reason the caps are applied to the tiers separately.
    expect(after.events.filter((e) => !e.targetedOnly).map((e) => e.id)).toEqual(
      before.events.map((e) => e.id),
    );
    expect(after.events.filter((e) => !e.targetedOnly).map((e) => e.importanceLevel)).toEqual(
      before.events.map((e) => e.importanceLevel),
    );
  });

  it("excludes anything under the targeted floor even in a deep build", () => {
    const raw = [match("1", 499), match("2", 501)];
    const deep = curateEvents(raw, { now: NOW, includeTargeted: true });
    expect(deep.events.map((e) => e.id)).toEqual(["2"]);
  });

  it("caps one sport on one day, keeping the biggest matches", () => {
    // Twenty tennis matches on a single day — a qualifying session.
    const raw = Array.from({ length: 20 }, (_, i) => match(String(i + 10), 1000 + i * 10));
    const deep = curateEvents(raw, { now: NOW, includeTargeted: true });
    const targeted = deep.events.filter((e) => e.targetedOnly);
    expect(targeted).toHaveLength(MAX_TARGETED_PER_SPORT_PER_DAY);
    // Volume-ranked, so the survivors are the top of the session.
    const kept = targeted.map((e) => e.volume).sort((a, b) => b - a);
    expect(Math.min(...kept)).toBeGreaterThan(1000);
  });

  it("does not cap across different days", () => {
    const raw = [
      ...Array.from({ length: 8 }, (_, i) => match(`a${i}`, 1000 + i, "10")),
      ...Array.from({ length: 8 }, (_, i) => match(`b${i}`, 1000 + i, "11")),
    ];
    const deep = curateEvents(raw, { now: NOW, includeTargeted: true });
    expect(deep.events.filter((e) => e.targetedOnly)).toHaveLength(16);
  });

  it("never admits an event whose sport it could not resolve", () => {
    // No sport id means no sub-filter can reach it, so admitting it at $500
    // would only add weight to a payload nothing can ever display.
    const unmapped = gammaEvent({
      id: "u1",
      title: "Sepak Takraw: Team A vs Team B",
      volume: 900,
      liquidity: 0,
      tags: [{ id: "s", label: "Sports", slug: "sports" }],
    });
    const deep = curateEvents([unmapped], { now: NOW, includeTargeted: true });
    expect(deep.events).toHaveLength(0);
  });
});
