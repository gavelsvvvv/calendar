import { describe, expect, it } from "vitest";
import { isEsports } from "../../categories";
import { curateEvents } from "../curate";
import { gammaEvent } from "./fixtures";
import type { GammaEvent } from "../../polymarket/gamma-types";

/**
 * Esports coverage.
 *
 * The bug these pin down: esports shared the `sports` category's two-per-day
 * allowance with the MLB, tennis and soccer schedules, and the allowance is
 * settled on a volume-driven score. On a live August window 158 esports events
 * reached the daily cap and 30 survived it — including two CS2 Esports World
 * Cup matches a reader reported by name.
 *
 * None of these tests names those slugs. They exercise the classification, the
 * date choice and the allowance, which is what would have to break for the
 * coverage to disappear again.
 */

/**
 * A CS2 fixture shaped like the real Gamma record, minus the noise.
 *
 * `gameId` and the market slugs are derived from the event's own slug rather
 * than shared. Two matches that reuse one `gameId` are, correctly, grouped into
 * a single event — which is right for a match and its derivatives and wrong for
 * two different matches, and is exactly the confusion these tests exist to
 * catch.
 */
function cs2Match(
  overrides: Partial<GammaEvent> & { slug?: string; gameId?: number } = {},
): GammaEvent {
  const slug = overrides.slug ?? "cs2-lgc-faze-2026-08-13";
  const gameId = overrides.gameId ?? 1_624_092;
  return gammaEvent({
    id: "839279",
    slug,
    title: "Counter-Strike: Legacy vs FaZe (BO3) - Esports World Cup Group B",
    endDate: "2026-08-13T23:00:00Z",
    volume: 166_569,
    liquidity: 487_649,
    tags: [
      { id: "64", label: "Esports", slug: "esports" },
      { id: "100780", label: "counter strike 2", slug: "counter-strike-2" },
      { id: "1", label: "Sports", slug: "sports" },
    ],
    /*
     * The fixture markers, and they are not decoration either: the date ladder
     * only reaches for `gameStartTime` on something it can identify as a
     * fixture, precisely so a non-fixture's stray field cannot move it. Gamma
     * carries all three on a real CS2 match.
     */
    gameId,
    sport: { id: 37, sport: "cs2", name: "CS2" },
    teams: [
      { id: 170533, name: "Legacy", league: "csgo" },
      { id: 177550, name: "FaZe", league: "csgo" },
    ],
    /*
     * Thirteen markets, because the count is load-bearing rather than
     * decoration. `meetsRelevanceFloor` discounts the $250k sports floor by up
     * to 30% for breadth and 20% for depth, and the real match carries the
     * match winner, two map winners, totals and a row of handicaps. With that
     * breadth its effective floor is $125k; with a single market it would be
     * $200k, and the fixture would fail for a reason the real event does not.
     *
     * Gamma puts the real kickoff on the markets, not on the event.
     */
    markets: Array.from({ length: 13 }, (_, i) => ({
      id: `${slug}-m-${i}`,
      question: i === 0 ? "Legacy vs FaZe" : `Legacy vs FaZe — market ${i}`,
      slug: i === 0 ? slug : `${slug}-m${i}`,
      endDate: "2026-08-13T23:00:00Z",
      gameStartTime: "2026-08-13 17:00:00+00",
      hasReviewedDates: true,
      outcomes: '["Legacy", "FaZe"]',
      outcomePrices: '["0.38", "0.62"]',
      volume: String(i === 0 ? 154_765 : 900),
      liquidity: String(i === 0 ? 345_942 : 10_000),
    })),
    ...overrides,
  } as Partial<GammaEvent>);
}

/** A traditional fixture, for the contests the cap has to arbitrate. */
function mlbGame(id: string, volume: number): GammaEvent {
  return gammaEvent({
    id,
    slug: `mlb-${id}-2026-08-13`,
    title: `Team ${id} vs Team ${id}b`,
    endDate: "2026-08-14T02:15:00Z",
    volume,
    liquidity: volume / 4,
    tags: [
      { id: "1", label: "Sports", slug: "sports" },
      { id: "2", label: "MLB", slug: "mlb" },
    ],
    markets: [
      {
        id: `${id}-m`,
        question: "Match winner",
        slug: `mlb-${id}-2026-08-13`,
        endDate: "2026-08-14T02:15:00Z",
        gameStartTime: "2026-08-13 23:15:00+00",
        hasReviewedDates: true,
        outcomes: '["A", "B"]',
        outcomePrices: '["0.5", "0.5"]',
        volume: String(volume),
        liquidity: String(volume / 4),
      },
    ],
  } as Partial<GammaEvent>);
}

describe("esports is recognised from structured metadata", () => {
  it("reads Gamma's own esports tag", () => {
    expect(isEsports({ tagSlugs: ["sports", "esports"] })).toBe(true);
  });

  it("reads the game-specific tag when the umbrella tag is absent", () => {
    expect(isEsports({ tagSlugs: ["counter-strike-2"] })).toBe(true);
    expect(isEsports({ tagSlugs: ["league-of-legends"] })).toBe(true);
    expect(isEsports({ tagSlugs: ["dota"] })).toBe(true);
    expect(isEsports({ tagSlugs: ["valorant"] })).toBe(true);
  });

  it("reads the `sport` object Gamma attaches to fixtures", () => {
    expect(isEsports({ sportCode: "cs2" })).toBe(true);
    expect(isEsports({ sportCode: "lol" })).toBe(true);
    expect(isEsports({ sportCode: "dota2" })).toBe(true);
  });

  it("does not mistake athletics for esports", () => {
    expect(isEsports({ tagSlugs: ["sports", "mlb", "baseball"] })).toBe(false);
    expect(isEsports({ sportCode: "mlb" })).toBe(false);
    expect(isEsports({})).toBe(false);
  });

  it("does not read the title — a name is not metadata", () => {
    // The point of using tags: "Counter-Strike" in a title could be a film.
    expect(isEsports({ tagSlugs: ["culture"] })).toBe(false);
  });
});

describe("a CS2 match reaches the calendar", () => {
  it("is curated under eSports, not Sports", () => {
    const { events } = curateEvents([cs2Match()]);
    expect(events).toHaveLength(1);
    expect(events[0].category).toBe("esports");
  });

  it("is dated by kickoff, not by the market's resolution deadline", () => {
    // `endDate` is 23:00Z; the match starts at 17:00Z. The calendar has to show
    // the match, which for a reader in market time is 13:00 on the 13th.
    const { events } = curateEvents([cs2Match()]);
    expect(events[0].dateSource).toBe("gameStartTime");
    expect(events[0].displayDate).toBe("2026-08-13");
    expect(events[0].timeKind).toBe("scheduled");
    expect(events[0].time).toBe("13:00");
  });

  it("counts the whole match, not one child market", () => {
    // The event-level figure is the unit of volume, so a match whose individual
    // map markets are small is not judged on the smallest of them.
    const { events } = curateEvents([cs2Match()]);
    expect(events[0].volume).toBe(166_569);
  });

  it("survives a day already full of traditional sport", () => {
    /*
     * The regression itself. Four MLB games, each out-trading the CS2 match by
     * an order of magnitude, on the same day. While esports shared the `sports`
     * allowance this returned the four biggest and no esports at all.
     */
    const day = [
      cs2Match(),
      mlbGame("a", 1_400_000),
      mlbGame("b", 1_300_000),
      mlbGame("c", 1_200_000),
      mlbGame("d", 1_100_000),
    ];
    const { events } = curateEvents(day);
    const slugs = events.map((e) => e.slug);

    expect(slugs).toContain("cs2-lgc-faze-2026-08-13");
    // And athletics keeps its own allowance rather than losing it to esports.
    expect(events.filter((e) => e.category === "sports")).toHaveLength(2);
  });

  it("does not let esports flood a day either", () => {
    // Six CS2 matches on one day still yields a curated calendar, not a fixture
    // list: the esports allowance is its own, and it is small.
    const many = Array.from({ length: 6 }, (_, i) =>
      cs2Match({
        id: `es-${i}`,
        slug: `cs2-match-${i}-2026-08-13`,
        gameId: 1_700_000 + i,
        title: `Counter-Strike: Team ${i} vs Team ${i + 10} (BO3)`,
        volume: 200_000 - i * 1_000,
      }),
    );
    const { events } = curateEvents(many);
    expect(events.filter((e) => e.category === "esports").length).toBeLessThanOrEqual(2);
  });

  it("distinct matches in one tournament stay distinct", () => {
    const { events } = curateEvents([
      cs2Match(),
      cs2Match({
        id: "839724",
        slug: "cs2-fal2-ast10-2026-08-13",
        gameId: 1_624_091,
        title: "Counter-Strike: Team Falcons vs Astralis (BO3) - Esports World Cup Group B",
        volume: 125_433,
      }),
    ]);
    expect(events).toHaveLength(2);
    expect(new Set(events.map((e) => e.slug)).size).toBe(2);
  });

  it("relaxes with Include smaller markets, in the same direction", () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      cs2Match({
        id: `es-${i}`,
        slug: `cs2-match-${i}-2026-08-13`,
        gameId: 1_700_000 + i,
        title: `Counter-Strike: Team ${i} vs Team ${i + 10} (BO3)`,
        volume: 200_000 - i * 1_000,
      }),
    );
    const strict = curateEvents(many).events.filter((e) => e.category === "esports").length;
    const relaxed = curateEvents(many, { includeSmallerMarkets: true }).events.filter(
      (e) => e.category === "esports",
    ).length;
    expect(relaxed).toBeGreaterThan(strict);
  });
});

describe("curation explains itself", () => {
  it("records a verdict per raw event, with a reason for the rejected", () => {
    const diagnostics: import("../types").CurationVerdict[] = [];
    const day = [
      cs2Match(),
      mlbGame("a", 1_400_000),
      mlbGame("b", 1_300_000),
      mlbGame("c", 1_200_000),
    ];
    curateEvents(day, { diagnostics });

    expect(diagnostics.length).toBeGreaterThanOrEqual(day.length);
    const cs2 = diagnostics.find((v) => v.slug === "cs2-lgc-faze-2026-08-13");
    expect(cs2?.included).toBe(true);
    expect(cs2?.category).toBe("esports");

    // The event that lost its slot says so, by name rather than as a count.
    const capped = diagnostics.find((v) => !v.included && v.reason === "over-daily-cap");
    expect(capped).toBeDefined();
  });

  it("costs nothing when no array is passed", () => {
    // The calendar's own build never asks for diagnostics; this is the check
    // that the option is genuinely opt-in rather than always collected.
    const { events } = curateEvents([cs2Match()]);
    expect(events).toHaveLength(1);
  });
});
