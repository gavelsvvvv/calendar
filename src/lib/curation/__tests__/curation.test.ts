import { describe, expect, it } from "vitest";
import { CATEGORY_IDS, resolveCategory } from "../../categories";
import { curateEvents } from "../curate";
import { findExclusionReason, relevanceFloor } from "../exclusions";
import { groupEvents, normalizeTitleCore, stripDerivativeSuffix } from "../grouping";
import { assignImportanceLevels, computeImportanceScore } from "../importance";
import {
  CRYPTO_NOISE,
  FINANCE_NOISE,
  MEANINGFUL_CRYPTO,
  POLITICS_FAMILY,
  SPORTS_FAMILY,
  WEATHER_NOISE,
  gammaEvent,
} from "./fixtures";

const NOW = new Date("2026-08-05T12:00:00Z");

describe("exclusions", () => {
  it("removes every weather market", () => {
    for (const event of WEATHER_NOISE) {
      expect(findExclusionReason(event), event.title).toBe("weather");
    }
  });

  it("removes daily Bitcoin and Ethereum threshold markets", () => {
    const btcEth = CRYPTO_NOISE.filter((e) => /bitcoin|ethereum/i.test(e.title ?? ""));
    expect(btcEth.length).toBeGreaterThan(0);
    for (const event of btcEth) {
      expect(findExclusionReason(event), event.title).toBe("crypto-price-threshold");
    }
  });

  it("removes the equivalent daily Solana threshold markets", () => {
    const sol = CRYPTO_NOISE.filter((e) => /solana/i.test(e.title ?? ""));
    expect(sol.length).toBeGreaterThan(0);
    for (const event of sol) {
      expect(findExclusionReason(event), event.title).toBe("crypto-price-threshold");
    }
  });

  it("removes daily index, commodity and FX threshold markets", () => {
    for (const event of FINANCE_NOISE) {
      expect(findExclusionReason(event), event.title).toBe("finance-price-threshold");
    }
  });

  it("keeps meaningful crypto events", () => {
    for (const event of MEANINGFUL_CRYPTO) {
      expect(findExclusionReason(event), event.title).toBeNull();
    }
  });

  it("keeps a monthly milestone market but drops its daily twin", () => {
    const monthly = gammaEvent({
      title: "What price will Bitcoin hit in August?",
      startDate: "2026-08-01T00:00:00Z",
      endDate: "2026-08-31T23:59:00Z",
    });
    const daily = gammaEvent({
      title: "Bitcoin above ___ on August 5?",
      startDate: "2026-08-04T00:00:00Z",
      endDate: "2026-08-05T23:59:00Z",
    });
    expect(findExclusionReason(monthly)).toBeNull();
    expect(findExclusionReason(daily)).toBe("crypto-price-threshold");
  });

  /**
   * Floors are relative to each category's own market, and the categories are
   * three orders of magnitude apart. Sports and crypto are deep — we already
   * fetch only their top and want to keep only the biggest — while business,
   * technology and culture are thin by nature: the largest business event
   * in a six-week window traded $19,432, so a sports-scale floor removed the
   * category outright.
   */
  it("scales relevance floors to each category's own market", () => {
    expect(relevanceFloor("business")).toBeLessThan(relevanceFloor("sports"));
    expect(relevanceFloor("technology")).toBeLessThan(relevanceFloor("sports"));
    expect(relevanceFloor("politics")).toBeLessThan(relevanceFloor("elections"));
    // A real earnings market must clear its floor; a sports market that size
    // must not clear its own.
    expect(relevanceFloor("business")).toBeLessThan(12_000);
    expect(relevanceFloor("sports")).toBeGreaterThan(12_000);
  });

  it("relaxes every floor when smaller markets are requested", () => {
    for (const category of ["sports", "business", "politics"] as const) {
      expect(relevanceFloor(category, true)).toBeLessThan(relevanceFloor(category));
    }
  });
});

describe("grouping", () => {
  it("strips derivative suffixes without breaking hyphenated words", () => {
    expect(stripDerivativeSuffix("Clacton by-election Winner").core).toBe(
      "Clacton by-election",
    );
    expect(stripDerivativeSuffix("Clacton by-election: Turnout").core).toBe(
      "Clacton by-election",
    );
    expect(stripDerivativeSuffix("AC Milan vs. Inter Milano - Exact Score").core).toBe(
      "AC Milan vs. Inter Milano",
    );
    // A dash that is part of a name must survive.
    expect(stripDerivativeSuffix("Sachsen-Anhalt Parliamentary Election").core).toBe(
      "Sachsen-Anhalt Parliamentary Election",
    );
  });

  it("groups related sports markets into one event", () => {
    const groups = groupEvents(SPORTS_FAMILY);
    expect(groups).toHaveLength(1);
    expect(groups[0].members).toHaveLength(3);
  });

  it("uses the stable gameId as the grouping key", () => {
    const groups = groupEvents(SPORTS_FAMILY);
    expect(groups[0].kind).toBe("game-id");
    expect(groups[0].key).toBe("game:72728824");
  });

  it("picks the undecorated event as the group's canonical member", () => {
    const groups = groupEvents(SPORTS_FAMILY);
    expect(groups[0].canonical.title).toBe("CF Villarreal C vs. Levante UD");
    expect(groups[0].canonical.id).toBe("757862");
  });

  it("groups political outcomes that share no structural id", () => {
    const groups = groupEvents(POLITICS_FAMILY);
    expect(groups).toHaveLength(1);
    expect(groups[0].kind).toBe("title-core");
    // Includes the sibling whose end date is a day later.
    expect(groups[0].members).toHaveLength(4);
  });

  it("does not merge unrelated events that share vocabulary", () => {
    const groups = groupEvents([
      gammaEvent({ id: "1", title: "Michigan Democratic Senate Primary Winner", endDate: "2026-08-03T16:00:00Z" }),
      gammaEvent({ id: "2", title: "Minnesota Democratic Senate Primary Winner", endDate: "2026-08-03T16:00:00Z" }),
    ]);
    expect(groups).toHaveLength(2);
  });

  it("keeps separate election cycles apart", () => {
    const groups = groupEvents([
      gammaEvent({ id: "1", title: "Clacton by-election Winner", endDate: "2026-08-13T16:00:00Z" }),
      gammaEvent({ id: "2", title: "Clacton by-election Winner", endDate: "2027-05-13T16:00:00Z" }),
    ]);
    expect(groups).toHaveLength(2);
  });

  it("normalizes titles for comparison only", () => {
    expect(normalizeTitleCore("AC Milan vs. Inter Milano - More Markets")).toBe(
      "ac milan vs inter milano",
    );
  });
});

describe("importance scoring", () => {
  it("is deterministic", () => {
    const input = {
      category: "politics" as const,
      volume: 4_000_000,
      liquidity: 300_000,
      relatedMarketsCount: 20,
      sourceEventCount: 3,
      endDateIso: "2026-08-10T16:00:00Z",
      now: NOW,
    };
    const a = computeImportanceScore(input);
    const b = computeImportanceScore(input);
    expect(a).toBe(b);
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThanOrEqual(100);
  });

  it("ranks a bigger, broader event above a small one", () => {
    const base = {
      category: "sports" as const,
      endDateIso: "2026-08-10T16:00:00Z",
      now: NOW,
    };
    const big = computeImportanceScore({ ...base, volume: 3_000_000, liquidity: 200_000, relatedMarketsCount: 30, sourceEventCount: 3 });
    const small = computeImportanceScore({ ...base, volume: 30_000, liquidity: 3_000, relatedMarketsCount: 2, sourceEventCount: 1 });
    expect(big).toBeGreaterThan(small);
  });

  it("normalizes volume per category", () => {
    const shared = { volume: 500_000, liquidity: 50_000, relatedMarketsCount: 5, sourceEventCount: 1, endDateIso: "2026-08-10T16:00:00Z", now: NOW };
    // The same volume is a bigger deal in sports than in politics.
    expect(computeImportanceScore({ ...shared, category: "sports" })).toBeGreaterThan(
      computeImportanceScore({ ...shared, category: "politics" }),
    );
  });

  it("assigns levels by rank, with deterministic tie-breaking", () => {
    const events = Array.from({ length: 100 }, (_, i) => ({
      id: `e${i}`,
      importanceScore: i,
    }));
    const ranked = assignImportanceLevels(events);
    expect(ranked.filter((e) => e.importanceLevel === "major")).toHaveLength(6);
    // Same input, same output.
    expect(assignImportanceLevels(events)).toEqual(ranked);
  });

  it("does not promote a low-scoring dataset", () => {
    const quiet = Array.from({ length: 40 }, (_, i) => ({ id: `q${i}`, importanceScore: 4 }));
    expect(assignImportanceLevels(quiet).every((e) => e.importanceLevel === "standard")).toBe(true);
  });
});

describe("curateEvents", () => {
  const raw = [
    ...SPORTS_FAMILY,
    ...POLITICS_FAMILY,
    ...WEATHER_NOISE,
    ...CRYPTO_NOISE,
    ...FINANCE_NOISE,
    ...MEANINGFUL_CRYPTO,
  ];

  it("produces one calendar event per real-world event", () => {
    const { events } = curateEvents(raw, { now: NOW });
    const titles = events.map((e) => e.title);

    expect(titles).toContain("CF Villarreal C vs. Levante UD");
    expect(titles).toContain("Clacton by-election");

    // No derivative leaks through as its own entry.
    expect(titles.some((t) => /exact score|more markets|2nd place|turnout|margin of victory/i.test(t))).toBe(false);
    // No noise at all.
    expect(titles.some((t) => /temperature/i.test(t))).toBe(false);
    expect(titles.some((t) => /(bitcoin|ethereum|solana) (above|up or down|between)/i.test(t))).toBe(false);
  });

  it("combines volume and market counts across the group", () => {
    const { events } = curateEvents(raw, { now: NOW });
    const match = events.find((e) => e.title === "CF Villarreal C vs. Levante UD");
    expect(match).toBeDefined();
    expect(match!.volume).toBe(200_000 + 40_000 + 25_000);
    expect(match!.relatedMarketsCount).toBe(4);
    expect(match!.sourceEventIds).toHaveLength(3);
  });

  it("links a grouped event to its parent Polymarket event", () => {
    const { events } = curateEvents(raw, { now: NOW });
    const match = events.find((e) => e.title === "CF Villarreal C vs. Levante UD");
    // The canonical slug, not one of the derivative slugs.
    expect(match!.primaryMarketUrl).toBe(
      "https://polymarket.com/event/clf-vil-lu-2026-08-05",
    );
  });

  it("keeps meaningful crypto events on the calendar", () => {
    const { events } = curateEvents(raw, { now: NOW });
    expect(events.some((e) => /SEC approve a Solana ETF/i.test(e.title))).toBe(true);
    expect(events.some((e) => /Pectra upgrade/i.test(e.title))).toBe(true);
  });

  it("reports why events were dropped", () => {
    const { stats } = curateEvents(raw, { now: NOW });
    expect(stats.excludedBy.weather).toBe(WEATHER_NOISE.length);
    expect(stats.excludedBy["crypto-price-threshold"]).toBe(CRYPTO_NOISE.length);
    expect(stats.curated).toBeLessThan(stats.rawEvents);
  });

  it("shows a placeholder timestamp as the day's close, never as a kickoff", () => {
    const { events } = curateEvents(
      [gammaEvent({ id: "ad", title: "Some deadline", endDate: "2026-08-20T23:59:00Z", volume: 2_000_000 })],
      { now: NOW },
    );
    expect(events[0].isAllDay).toBe(true);
    expect(events[0].timeKind).toBe("close");
    // 23:59Z is 19:59 in market time, and rendering that would invent an hour.
    expect(events[0].time).toBe("23:59");
  });

  it("keeps a real kickoff time", () => {
    const { events } = curateEvents(
      [gammaEvent({ id: "kt", title: "Some match", endDate: "2026-08-20T18:10:00Z", volume: 2_000_000 })],
      { now: NOW },
    );
    expect(events[0].isAllDay).toBe(false);
    expect(events[0].time).toBe("14:10"); // 18:10Z rendered in market time
  });

  it("is deterministic across runs", () => {
    const a = curateEvents(raw, { now: NOW });
    const b = curateEvents(raw, { now: NOW });
    expect(a.events.map((e) => e.id)).toEqual(b.events.map((e) => e.id));
    expect(a.events.map((e) => e.importanceScore)).toEqual(
      b.events.map((e) => e.importanceScore),
    );
  });

  it("caps how many events one day can hold", () => {
    // 40 sports fixtures on one day is above the floor but unreadable — and it
    // buries everything else. The cap keeps the biggest and drops the tail.
    const crowd = Array.from({ length: 40 }, (_, i) =>
      gammaEvent({
        id: `s${i}`,
        title: `Some FC vs Other FC ${i}`,
        slug: `match-${i}`,
        gameId: 5_000 + i,
        endDate: "2026-08-20T18:00:00Z",
        volume: 100_000 + i * 1_000,
        liquidity: 20_000,
        tags: [{ slug: "sports", label: "Sports" }],
      }),
    );
    const { events } = curateEvents(crowd, { now: NOW });
    expect(events.length).toBeLessThanOrEqual(6);
    // What survives is the highest-volume end of the list.
    expect(events.every((e) => e.volume >= 130_000)).toBe(true);
  });

  it("lets a crowded category leave room for the others", () => {
    const sports = Array.from({ length: 30 }, (_, i) =>
      gammaEvent({
        id: `x${i}`, title: `Club ${i} vs Rival ${i}`, slug: `m${i}`, gameId: 9_000 + i,
        endDate: "2026-08-21T18:00:00Z", volume: 400_000, liquidity: 40_000,
        tags: [{ slug: "sports", label: "Sports" }],
      }),
    );
    const election = gammaEvent({
      id: "elect", title: "Someplace Senate Primary", slug: "primary",
      endDate: "2026-08-21T18:00:00Z", volume: 900_000, liquidity: 80_000,
      tags: [{ slug: "elections", label: "Elections" }],
    });
    const { events } = curateEvents([...sports, election], { now: NOW });
    expect(events.some((e) => e.category === "elections")).toBe(true);
    expect(events.filter((e) => e.category === "sports").length).toBeLessThanOrEqual(5);
  });

  it("raises the caps when smaller markets are requested", () => {
    const crowd = Array.from({ length: 40 }, (_, i) =>
      gammaEvent({
        id: `c${i}`, title: `Team ${i} vs Team ${i + 1}`, slug: `g${i}`, gameId: 7_000 + i,
        endDate: "2026-08-22T18:00:00Z", volume: 100_000 + i * 1_000, liquidity: 20_000,
        tags: [{ slug: "sports", label: "Sports" }],
      }),
    );
    const normal = curateEvents(crowd, { now: NOW }).events.length;
    const relaxed = curateEvents(crowd, { now: NOW, includeSmallerMarkets: true }).events.length;
    expect(relaxed).toBeGreaterThan(normal);
  });

  it("reveals smaller markets only when asked", () => {
    const small = gammaEvent({
      id: "tiny",
      title: "A very small political market",
      volume: 1_500,
      liquidity: 200,
      tags: [{ slug: "politics", label: "Politics" }],
    });
    expect(curateEvents([small], { now: NOW }).events).toHaveLength(0);
    expect(
      curateEvents([small], { now: NOW, includeSmallerMarkets: true }).events,
    ).toHaveLength(1);
  });
});

/**
 * Category balance.
 *
 * The calendar was 52% sports before curation and 50% after it, with politics
 * showing one event a month, business none at all and technology two. Three
 * separate mechanisms were each removing the same categories: the fetch never
 * retrieved them, the floors cut them to a sports-scale threshold, and the
 * per-day caps handed every slot to whoever had the most volume.
 */
describe("category balance", () => {
  /** One busy day: lots of sports, one of everything else. */
  function crowdedDay() {
    const sports = Array.from({ length: 20 }, (_, i) =>
      gammaEvent({
        id: `s${i}`,
        title: `Team ${i} vs Team ${i + 1}`,
        slug: `s${i}`,
        gameId: 8_000 + i,
        endDate: "2026-08-22T18:00:00Z",
        volume: 2_000_000 - i * 1_000,
        liquidity: 200_000,
        tags: [{ slug: "sports", label: "Sports" }],
      }),
    );
    const scarce = [
      { slug: "politics", title: "Will the Senate vote on the CLARITY Act?", volume: 17_000 },
      { slug: "earnings", title: "Will Datadog (DDOG) beat quarterly earnings?", volume: 12_000 },
      { slug: "tech", title: "Largest Company end of August?", volume: 40_000 },
      { slug: "movies", title: '"The Odyssey" Opening Weekend Box Office', volume: 20_000 },
    ].map((s, i) =>
      gammaEvent({
        id: `x${i}`,
        title: s.title,
        slug: `x${i}`,
        endDate: "2026-08-22T18:00:00Z",
        volume: s.volume,
        liquidity: s.volume / 4,
        tags: [{ slug: s.slug, label: s.slug }],
      }),
    );
    return [...sports, ...scarce];
  }

  it("gives every category present a slot before filling the day on merit", () => {
    const { events } = curateEvents(crowdedDay(), { now: NOW });
    const categories = new Set(events.map((e) => e.category));

    // Each scarce category appears despite being outscored by 20 football
    // matches. Under pure score ranking every one of these was dropped.
    for (const category of ["politics", "business", "technology", "culture"]) {
      expect(categories).toContain(category);
    }
  });

  it("still lets the biggest events take their full share of the day", () => {
    const { events } = curateEvents(crowdedDay(), { now: NOW });
    const sports = events.filter((e) => e.category === "sports");

    // Representation is one slot, not an equal share: sports still fills its
    // whole per-category cap on a day it dominates, and keeps the biggest.
    expect(sports).toHaveLength(2);
    expect(sports[0].volume).toBe(2_000_000);
  });

  it("files a company's results under Business, not Economy", () => {
    // `earnings` says what kind of event it is; `finance` and `equities` only
    // say which desk it sits on, and two desk tags used to outvote it.
    const earnings = gammaEvent({
      id: "e1",
      title: "Will eBay (EBAY) beat quarterly earnings?",
      volume: 19_432,
      liquidity: 4_000,
      tags: [
        { slug: "earnings", label: "Earnings" },
        { slug: "equities", label: "Equities" },
        { slug: "finance", label: "Finance" },
        { slug: "ebay", label: "eBay" },
      ],
    });
    const [event] = curateEvents([earnings], { now: NOW }).events;
    expect(event.category).toBe("business");
  });

  it("keeps a real earnings market that a sports-scale floor would delete", () => {
    const earnings = gammaEvent({
      id: "e2",
      title: "Will Datadog (DDOG) beat quarterly earnings?",
      volume: 12_494,
      liquidity: 2_000,
      tags: [{ slug: "earnings", label: "Earnings" }],
    });
    expect(curateEvents([earnings], { now: NOW }).events).toHaveLength(1);
  });
});

describe("noise families found in the per-category slices", () => {
  const noise: Array<[string, string]> = [
    ["equity-price-threshold", "What will Apple (AAPL) hit Week of August 3 2026?"],
    ["equity-price-threshold", "GPU rental prices (B200) end of August?"],
    ["chatter", "What will Trump say during remarks in Las Vegas?"],
    ["chatter", "What will be said on the first Joe Rogan Experience episode of the week?"],
    ["chatter", "Who will Trump publicly praise in August?"],
    ["chatter", "What places will Trump mention in August?"],
    ["chatter", "How long will Trump’s Las Vegas remarks be?"],
    ["chatter", "Will the White House call a full lid by 6:30 PM?"],
    ["chatter", "Donald Trump tie color during Las Vegas remarks?"],
    ["chatter", "Justin Bieber monthly listeners hits __ by August 31?"],
    ["chatter", "# of views of MrBeast video week 1?"],
    ["recurring-chart", "Billboard Hot 100 #1 Song Week of August 15"],
    ["recurring-chart", "#1 Spotify song in the US this week? (August 7)"],
    ["recurring-chart", "Best AI model on August 10?"],
    ["recurring-chart", "Third-best Text Arena Math AI Lab end of August?"],
    ["recurring-chart", "Who will be evicted from Big Brother? (Week 4)"],
    ["personal-speculation", "Kristi Noem divorce by August 31?"],
    ["personal-speculation", "Elon Musk Net Worth on August 31?"],
  ];

  it.each(noise)("excludes as %s: %s", (reason, title) => {
    expect(findExclusionReason(gammaEvent({ title }))).toBe(reason);
  });

  /**
   * The other half of every exclusion rule. Each of these sits one word away
   * from something above and is exactly what the calendar exists to show.
   */
  const keep = [
    "What will Apple (AAPL) hit in August 2026?",
    "Will Datadog (DDOG) beat quarterly earnings?",
    "Which company has best AI model end of August?",
    "Gemini 4.0 released by...?",
    "Ariana Grande 'Petal' First Week Album Sales?",
    '"The Odyssey" Opening Weekend Box Office',
    "Will the Senate vote on the CLARITY Act before the August recess?",
    "Fed Decision in August?",
    "Bank of Mexico Decision in August?",
    "How many jobs added in July?",
  ];

  it.each(keep)("keeps: %s", (title) => {
    expect(findExclusionReason(gammaEvent({ title }))).toBeNull();
  });
});

describe("derivative suffixes with bracket qualifiers", () => {
  it("strips a suffix carrying a parenthetical qualifier", () => {
    // This one sat on the calendar as its own by-election, a day away from the
    // real one, because the qualifier stopped the suffix matching.
    expect(
      stripDerivativeSuffix("Clacton by-election: Margin of Victory (Lower Farage brackets)")
        .core,
    ).toBe("Clacton by-election");
    expect(stripDerivativeSuffix("Clacton by-election Winner (Higher Strikes)").core).toBe(
      "Clacton by-election",
    );
  });

  it("leaves a qualifier that is not attached to a suffix alone", () => {
    expect(stripDerivativeSuffix('"The Odyssey" total gross (Higher Strikes)').core).toBe(
      '"The Odyssey" total gross (Higher Strikes)',
    );
  });
});

/**
 * The counterweight to volume.
 *
 * A regular-season baseball game traded $1.4M in the sample window — more than
 * that week's Fed decision — and of the 104 sports events reaching the calendar
 * before this term existed, three were knockout matches and eighty-nine were
 * regular season or group stage. Volume measures interest; this measures
 * whether anything is being settled.
 */
describe("occasion scoring", () => {
  const base = {
    category: "sports" as const,
    volume: 1_000_000,
    liquidity: 100_000,
    relatedMarketsCount: 4,
    sourceEventCount: 1,
    endDateIso: "2026-08-12T18:00:00Z",
    now: NOW,
  };

  it("ranks a final above a regular-season fixture of the same size", () => {
    expect(
      computeImportanceScore({ ...base, title: "LoL: T1 vs Gen.G (BO5) - LCK Final" }),
    ).toBeGreaterThan(
      computeImportanceScore({
        ...base,
        title: "LoL: FlyQuest vs LYON (BO3) - LCS Regular Season",
      }),
    );
  });

  it("ranks a knockout above a group stage", () => {
    expect(
      computeImportanceScore({ ...base, title: "Team A vs Team B - Semi-Final" }),
    ).toBeGreaterThan(
      computeImportanceScore({ ...base, title: "Team A vs Team B - Group Stage" }),
    );
  });

  /**
   * A counterweight, not an override. Volume stays the dominant term, so the
   * question is how far the occasion carries a smaller event — and the answer
   * should be "about a factor of two", not "always" and not "never".
   */
  it("lets a cup final beat a regular-season game worth twice as much", () => {
    const final = computeImportanceScore({
      ...base,
      volume: 700_000,
      title: "Champions League Final",
    });
    const league = computeImportanceScore({
      ...base,
      volume: 1_400_000,
      title: "Tampa Bay Rays vs. Colorado Rockies",
    });
    expect(final).toBeGreaterThan(league);
  });

  it("does not let it beat one worth five times as much", () => {
    const final = computeImportanceScore({
      ...base,
      volume: 280_000,
      title: "Champions League Final",
    });
    const league = computeImportanceScore({
      ...base,
      volume: 1_400_000,
      title: "Tampa Bay Rays vs. Colorado Rockies",
    });
    expect(final).toBeLessThan(league);
  });

  it("applies outside sports, where a decision is a date and a question is not", () => {
    const decision = computeImportanceScore({
      ...base,
      category: "economy",
      title: "Fed Decision in August?",
    });
    const openQuestion = computeImportanceScore({
      ...base,
      category: "economy",
      title: "Will inflation stay high through August?",
    });
    expect(decision).toBeGreaterThan(openQuestion);
  });

  it("is neutral for a title that marks no stage", () => {
    const unmarked = computeImportanceScore({ ...base, title: "Some Event" });
    const noTitle = computeImportanceScore({ ...base });
    expect(unmarked).toBe(noTitle);
  });
});

/**
 * Sport is held to a bar no other category comes near.
 *
 * Not because sport is unimportant, but because it is the only category with
 * something on almost every day of the year: on equal footing it wins the
 * calendar by attrition. The measured surprise was how high the bar has to be —
 * the sports already reaching the calendar had a median volume of $1.9M, so the
 * $50,000 that sounds like a high threshold would have removed one event.
 */
describe("sports threshold", () => {
  const fixture = (volume: number, title = "Team A vs Team B") =>
    gammaEvent({
      id: `f${volume}`,
      title,
      slug: `f${volume}`,
      volume,
      liquidity: volume / 20,
      tags: [{ slug: "sports", label: "Sports" }],
    });

  it("drops a sports market that any other category would keep", () => {
    expect(curateEvents([fixture(60_000)], { now: NOW }).events).toHaveLength(0);
    // The same size in a thin category is a real event.
    const business = gammaEvent({
      id: "b1",
      title: "Will Datadog (DDOG) beat quarterly earnings?",
      volume: 60_000,
      liquidity: 3_000,
      tags: [{ slug: "earnings", label: "Earnings" }],
    });
    expect(curateEvents([business], { now: NOW }).events).toHaveLength(1);
  });

  it("keeps a genuinely large fixture", () => {
    expect(curateEvents([fixture(2_000_000)], { now: NOW }).events).toHaveLength(1);
  });

  it("applies the same bar to esports", () => {
    const small = fixture(60_000, "LoL: Team A vs Team B (BO3) - LCS Regular Season");
    const big = fixture(3_000_000, "LoL: T1 vs Gen.G (BO5) - LCK Final");
    expect(curateEvents([small], { now: NOW }).events).toHaveLength(0);
    expect(curateEvents([big], { now: NOW }).events).toHaveLength(1);
  });
});

/**
 * "Has this happened yet?"
 *
 * Reported from the live site: a Dota 2 playoff series that Team Liquid had
 * already won was showing as *Upcoming*, with ">99%" presented as a forecast.
 * The event carried `closed: false` because UMA's dispute window had not
 * elapsed — Polymarket's own flag lags the real world by hours.
 */
describe("event status", () => {
  const NOON = new Date("2026-08-05T16:00:00Z");

  /** A market, described by how far through the oracle process it is. */
  function market(
    id: string,
    uma: string | undefined,
    endDate: string,
    extra: Record<string, unknown> = {},
  ) {
    return {
      id,
      question: `Leg ${id}`,
      slug: `leg-${id}`,
      endDate,
      outcomes: '["Yes", "No"]',
      outcomePrices: uma ? '["0.0005", "0.9995"]' : '["0.55", "0.45"]',
      closed: uma === "resolved",
      umaResolutionStatus: uma,
      volume: "100000",
      liquidity: "10000",
      ...extra,
    };
  }

  it("resolves a finished match whose event has not closed yet", () => {
    // The reported shape: every leg answered, the event still open, and the
    // end date three hours away.
    const event = gammaEvent({
      id: "801542",
      title: "Dota 2: Team Falcons vs Team Liquid (BO5) - 1win Essence Playoffs",
      closed: false,
      endDate: "2026-08-05T23:00:00Z",
      volume: 6_934_786,
      liquidity: 5_853_738,
      tags: [{ slug: "esports", label: "Esports" }],
      markets: [
        market("1", "resolved", "2026-08-05T23:00:00Z"),
        market("2", "resolved", "2026-08-05T23:00:00Z"),
        market("3", "proposed", "2026-08-05T23:00:00Z"),
        market("4", "proposed", "2026-08-05T23:00:00Z"),
      ],
    });
    const [curated] = curateEvents([event], { now: NOON }).events;
    expect(curated.status).toBe("resolved");
  });

  it("leaves a genuinely upcoming event alone", () => {
    const event = gammaEvent({
      id: "u1",
      title: "Democratic Presidential Nominee 2028",
      endDate: "2026-09-30T23:00:00Z",
      markets: [
        market("1", undefined, "2026-09-30T23:00:00Z"),
        market("2", undefined, "2026-09-30T23:00:00Z"),
        market("3", undefined, "2026-09-30T23:00:00Z"),
      ],
    });
    expect(curateEvents([event], { now: NOON }).events[0].status).toBe("upcoming");
  });

  it("ignores a single stray proposal on a large book", () => {
    // "Presidential Election Winner 2028" carried one proposed leg of 128.
    const legs = Array.from({ length: 10 }, (_, i) =>
      market(String(i), i === 0 ? "proposed" : undefined, "2026-11-30T23:00:00Z"),
    );
    const event = gammaEvent({
      id: "u2",
      title: "Presidential Election Winner 2028",
      endDate: "2026-11-30T23:00:00Z",
      markets: legs,
    });
    expect(curateEvents([event], { now: NOON }).events[0].status).toBe("upcoming");
  });

  /**
   * The guard that a bare majority test gets wrong. "Iran leadership change
   * by…?" is a ladder of dated strikes: the March and July legs have resolved
   * and the September and 2027 legs have not, so 60% are answered while the
   * question is entirely open.
   */
  it("keeps a multi-strike ladder open while later strikes are pending", () => {
    const event = gammaEvent({
      id: "u3",
      title: "Iran leadership change by...?",
      endDate: "2027-06-30T23:00:00Z",
      volume: 500_000,
      tags: [{ slug: "geopolitics", label: "Geopolitics" }],
      markets: [
        market("mar", "resolved", "2026-03-13T23:00:00Z"),
        market("jul", "resolved", "2026-07-31T23:00:00Z"),
        market("aug", "resolved", "2026-08-31T23:00:00Z"),
        market("sep", undefined, "2026-09-30T23:00:00Z"),
        market("jun", undefined, "2027-06-30T23:00:00Z"),
      ],
    });
    expect(curateEvents([event], { now: NOON }).events[0].status).toBe("upcoming");
  });

  it("does not settle a series because game one has", () => {
    const legs = [
      market("g1", "resolved", "2026-08-05T23:00:00Z"),
      ...Array.from({ length: 8 }, (_, i) =>
        market(`x${i}`, undefined, "2026-08-05T23:00:00Z"),
      ),
    ];
    const event = gammaEvent({
      id: "s1",
      title: "Team A vs Team B (BO5)",
      endDate: "2026-08-05T23:00:00Z",
      volume: 2_000_000,
      tags: [{ slug: "esports", label: "Esports" }],
      markets: legs,
    });
    expect(curateEvents([event], { now: NOON }).events[0].status).toBe("upcoming");
  });

  it("reports a two-sided market as its leader, not as outcome one", () => {
    // Outcomes are the two teams, so there is no "Yes" to read. Taking the
    // first price captioned it "0% — Match Winner" for a series Liquid won.
    const event = gammaEvent({
      id: "h1",
      title: "Team Falcons vs Team Liquid",
      endDate: "2026-08-05T23:00:00Z",
      volume: 2_000_000,
      tags: [{ slug: "esports", label: "Esports" }],
      markets: [
        {
          id: "m",
          question: "Team Falcons vs Team Liquid",
          slug: "m",
          endDate: "2026-08-05T23:00:00Z",
          groupItemTitle: "Match Winner",
          outcomes: '["Team Falcons", "Team Liquid"]',
          outcomePrices: '["0.0005", "0.9995"]',
          volume: "2000000",
          liquidity: "100000",
        },
      ],
    });
    const [curated] = curateEvents([event], { now: NOON }).events;
    expect(curated.leadingOutcome).toBe("Team Liquid");
    expect(curated.probability).toBeCloseTo(0.9995, 4);
  });
});

/**
 * Dates and times for events Polymarket gives neither for.
 *
 * Gamma has no event start time — `startDate` is when the *market* opened, and
 * the Florida governor primary market opened in November 2025 for an August
 * 2026 election.
 */
describe("bare-date markets", () => {
  const NOW_ = new Date("2026-08-01T12:00:00Z");

  /**
   * Midnight UTC is a date, not an instant. Reading it as one and converting to
   * Eastern time rolls it back to 20:00 the previous evening, which filed four
   * independent primaries a day early: Tennessee's (6 August) on the 5th,
   * Minnesota's and Wisconsin's (11 August) on the 10th, Florida's (18 August)
   * on the 17th.
   */
  it("files a midnight-UTC date marker on its own date", () => {
    const cases: Array<[string, string]> = [
      ["2026-08-06T00:00:00Z", "2026-08-06"],
      ["2026-08-11T00:00:00Z", "2026-08-11"],
      ["2026-08-18T00:00:00Z", "2026-08-18"],
    ];
    for (const [endDate, expected] of cases) {
      const { events } = curateEvents(
        [gammaEvent({ id: endDate, title: "Governor Primary", endDate, volume: 2_000_000 })],
        { now: NOW_ },
      );
      expect(events[0].displayDate, endDate).toBe(expected);
    }
  });

  it("still buckets a real instant by market time", () => {
    // 03:59:59.999Z is 23:59 the previous evening in Eastern time, and that is
    // where a July market ending "at the end of July" belongs.
    const { events } = curateEvents(
      [
        gammaEvent({
          id: "inst",
          title: "Some monthly market",
          endDate: "2026-08-01T03:59:59.999Z",
          volume: 2_000_000,
        }),
      ],
      { now: NOW_ },
    );
    expect(events[0].displayDate).toBe("2026-07-31");
  });

  it("gives every event a time", () => {
    const events = curateEvents(
      [
        gammaEvent({ id: "a", title: "Bare date", endDate: "2026-08-11T00:00:00Z", volume: 2_000_000 }),
        gammaEvent({ id: "b", title: "End of day", endDate: "2026-08-12T23:59:00Z", volume: 2_000_000 }),
        gammaEvent({ id: "c", title: "Midday marker", endDate: "2026-08-13T12:00:00Z", volume: 2_000_000 }),
        gammaEvent({ id: "d", title: "Real kickoff", endDate: "2026-08-14T18:10:00Z", volume: 2_000_000 }),
      ],
      { now: NOW_ },
    ).events;
    for (const e of events) {
      expect(e.time, e.title).toMatch(/^\d{2}:\d{2}$/);
    }
    expect(events.find((e) => e.title === "Real kickoff")?.timeKind).toBe("scheduled");
    for (const title of ["Bare date", "End of day", "Midday marker"]) {
      const e = events.find((x) => x.title === title);
      expect(e?.timeKind, title).toBe("close");
      expect(e?.time, title).toBe("23:59");
    }
  });
});

describe("science removal", () => {
  it("has no science category", () => {
    expect(CATEGORY_IDS).not.toContain("science");
  });

  it("files what used to be science under its nearest neighbour", () => {
    const cases: Array<[string, string]> = [
      ["space", "technology"],
      ["nasa", "technology"],
      ["health", "world"],
      ["pandemics", "world"],
      ["climate", "world"],
    ];
    for (const [slug, expected] of cases) {
      expect(resolveCategory([slug], "Some event"), slug).toBe(expected);
    }
  });
});

/**
 * Kickoff times.
 *
 * Reported as "MLB games are missing". They were not missing, they were a week
 * late: Polymarket sets a sports market's resolution deadline seven days after
 * the game, and the calendar was reading that deadline as the date. Blue Jays
 * vs Cubs, played 6 August, sat on the 13th. Measured on a live window, 29 of
 * the 61 events carrying a gameStartTime had an endDate exactly seven days on.
 */
describe("gameStartTime", () => {
  const NOW_ = new Date("2026-08-01T12:00:00Z");

  function fixture(gameStartTime: string | undefined, endDate: string) {
    return gammaEvent({
      id: "597594",
      title: "Toronto Blue Jays vs. Chicago Cubs",
      slug: "mlb-tor-chc-2026-06-21",
      gameId: 10078438,
      endDate,
      volume: 1_353_066,
      liquidity: 784_980,
      tags: [{ slug: "mlb", label: "MLB" }],
      markets: [
        {
          id: "m1",
          question: "Toronto Blue Jays vs. Chicago Cubs",
          slug: "m1",
          endDate,
          gameStartTime,
          outcomes: '["Toronto Blue Jays", "Chicago Cubs"]',
          outcomePrices: '["0.44", "0.56"]',
          volume: "1022989",
          liquidity: "500000",
        },
      ],
    });
  }

  it("dates a fixture by kickoff, not by the resolution deadline", () => {
    const { events } = curateEvents(
      [fixture("2026-08-06 18:20:00+00", "2026-08-13T18:20:00Z")],
      { now: NOW_ },
    );
    expect(events[0].displayDate).toBe("2026-08-06");
    expect(events[0].time).toBe("14:20");
    expect(events[0].timeKind).toBe("scheduled");
  });

  it("parses the non-ISO format Gamma writes it in", () => {
    // "2026-08-06 18:20:00+00" — a space instead of a T, and a two-digit offset.
    const { events } = curateEvents(
      [fixture("2026-08-06 10:15:00+00", "2026-08-13T10:15:00Z")],
      { now: NOW_ },
    );
    expect(events[0].displayDate).toBe("2026-08-06");
    expect(events[0].time).toBe("06:15");
  });

  it("falls back to the end date when there is no kickoff", () => {
    const { events } = curateEvents([fixture(undefined, "2026-08-13T18:20:00Z")], {
      now: NOW_,
    });
    expect(events[0].displayDate).toBe("2026-08-13");
  });
});

describe("absolute volume floor", () => {
  it("drops anything under $1,000, even with smaller markets requested", () => {
    const tiny = gammaEvent({
      id: "tiny",
      title: "A market nobody traded",
      volume: 900,
      liquidity: 50,
      tags: [{ slug: "earnings", label: "Earnings" }],
    });
    expect(curateEvents([tiny], { now: NOW }).events).toHaveLength(0);
    expect(
      curateEvents([tiny], { now: NOW, includeSmallerMarkets: true }).events,
    ).toHaveLength(0);
  });
});

/**
 * Placeholder times written in Eastern rather than UTC.
 *
 * Every US macro release ends at midnight ET, which is 03:59Z in summer and
 * 04:59Z in winter — neither of which the UTC-only check recognised. Five CPI
 * markets were therefore treated as scheduled for 23:59 and drawn on top of one
 * another at the bottom of the week grid.
 */
describe("market-time placeholders", () => {
  const NOW_ = new Date("2026-08-01T12:00:00Z");

  it("treats midnight Eastern as a bare date, whatever it is in UTC", () => {
    for (const endDate of ["2026-08-12T03:59:00Z", "2026-08-14T03:59:00Z"]) {
      const { events } = curateEvents(
        [gammaEvent({ id: endDate, title: "July Inflation US - Annual", endDate, volume: 500_000 })],
        { now: NOW_ },
      );
      expect(events[0].isAllDay, endDate).toBe(true);
      expect(events[0].timeKind, endDate).toBe("close");
    }
  });

  it("still keeps a real afternoon kickoff", () => {
    const { events } = curateEvents(
      [
        gammaEvent({
          id: "k",
          title: "Some match",
          endDate: "2026-08-12T18:20:00Z",
          volume: 500_000,
        }),
      ],
      { now: NOW_ },
    );
    expect(events[0].isAllDay).toBe(false);
    expect(events[0].time).toBe("14:20");
  });

  it("excludes bare '# posts' counters", () => {
    expect(
      findExclusionReason(
        gammaEvent({ title: "NYC Mayor # posts July 31 - August 7, 2026?" }),
      ),
    ).toBe("chatter");
    expect(
      findExclusionReason(gammaEvent({ title: "Khamenei # posts July 31 - August 7, 2026?" })),
    ).toBe("chatter");
  });
});

/**
 * The headline number on an event that has already happened.
 *
 * Ranking among *open* markets is right while an event is ahead — a settled leg
 * is not a forecast. Once it has happened that rule inverts and picks whatever
 * is slowest to resolve. A finished fixture headlined "Both Teams to Score,
 * 0.5%" because the match winner had paid out and the side bet had not.
 */
describe("headline probability after the event", () => {
  const NOW_ = new Date("2026-08-06T20:00:00Z");

  function leg(
    id: string,
    groupItemTitle: string,
    yes: string,
    closed: boolean,
    uma?: string,
  ) {
    return {
      id,
      question: `Leg ${id}`,
      slug: id,
      endDate: "2026-08-06T18:00:00Z",
      groupItemTitle,
      outcomes: '["Yes", "No"]',
      outcomePrices: `["${yes}", "${(1 - Number(yes)).toFixed(4)}"]`,
      closed,
      umaResolutionStatus: uma,
      volume: "50000",
      liquidity: "5000",
    };
  }

  it("reads the whole book once the event is over, not just what is unresolved", () => {
    const event = gammaEvent({
      id: "fx",
      title: "EC Vitória vs. CA Paranaense",
      endDate: "2026-08-06T18:00:00Z",
      volume: 400_000,
      liquidity: 60_000,
      tags: [{ slug: "soccer", label: "Soccer" }],
      markets: [
        leg("w1", "EC Vitória", "0.9995", true, "resolved"),
        leg("w2", "CA Paranaense", "0.0005", true, "resolved"),
        // The straggler: still open, and worth almost nothing.
        leg("bts", "Both Teams to Score", "0.005", false, "proposed"),
      ],
    });
    const [curated] = curateEvents([event], { now: NOW_ }).events;
    expect(curated.status).not.toBe("upcoming");
    expect(curated.leadingOutcome).toBe("EC Vitória");
    expect(curated.probability).toBeCloseTo(0.9995, 4);
  });

  it("still ignores settled legs while the event is ahead", () => {
    const event = gammaEvent({
      id: "fx2",
      title: "Some Future Fixture",
      endDate: "2026-09-20T18:00:00Z",
      volume: 400_000,
      tags: [{ slug: "soccer", label: "Soccer" }],
      markets: [
        { ...leg("old", "Already settled", "0.9995", true, "resolved"), endDate: "2026-09-20T18:00:00Z" },
        { ...leg("live", "Team A", "0.62", false), endDate: "2026-09-20T18:00:00Z" },
      ],
    });
    const [curated] = curateEvents([event], { now: NOW_ }).events;
    expect(curated.status).toBe("upcoming");
    expect(curated.leadingOutcome).toBe("Team A");
  });

  /**
   * Grouping folds a fixture's derivatives in beside it, and those legs are not
   * what the event is about.
   *
   * Matching them off by title cannot work, because the normaliser strips
   * exactly the suffixes that distinguish them: "… - Total Corners" reduces to
   * the fixture's own title while "Will EC Vitória win on 2026-08-06?" does
   * not — so the derivative matched and the match winner did not, and a decided
   * match headlined "Over, 90%". The canonical member of the group is the
   * undecorated one, so its book is the question being asked.
   */
  it("reads the canonical event's book, not its derivatives", () => {
    const leg = (id: string, question: string, groupItemTitle: string, yes: string) => ({
      id,
      question,
      slug: id,
      endDate: "2026-08-06T18:00:00Z",
      groupItemTitle,
      outcomes: '["Yes", "No"]',
      outcomePrices: `["${yes}", "${(1 - Number(yes)).toFixed(4)}"]`,
      closed: false,
      volume: "50000",
      liquidity: "5000",
    });

    const fixture = gammaEvent({
      id: "743195",
      title: "EC Vitória vs. CA Paranaense",
      slug: "fixture",
      gameId: 90110432,
      endDate: "2026-08-06T18:00:00Z",
      volume: 400_000,
      tags: [{ slug: "soccer", label: "Soccer" }],
      markets: [
        leg("w1", "Will EC Vitória win on 2026-08-06?", "EC Vitória", "0.71"),
        leg("d", "Will EC Vitória vs. CA Paranaense end in a draw?", "Draw", "0.14"),
        leg("w2", "Will CA Paranaense win on 2026-08-06?", "CA Paranaense", "0.15"),
      ],
    });
    // A derivative whose title normalises to the fixture's, carrying a leg that
    // outranks the real winner.
    const corners = gammaEvent({
      id: "743325",
      title: "EC Vitória vs. CA Paranaense - Total Corners",
      slug: "corners",
      gameId: 90110432,
      endDate: "2026-08-06T18:00:00Z",
      volume: 20_000,
      tags: [{ slug: "soccer", label: "Soccer" }],
      markets: [leg("o", "EC Vitória vs. CA Paranaense - Total Corners", "Over", "0.9")],
    });

    const [curated] = curateEvents([fixture, corners], {
      now: new Date("2026-08-01T12:00:00Z"),
    }).events;
    expect(curated.sourceEventIds).toHaveLength(2);
    expect(curated.leadingOutcome).toBe("EC Vitória");
    expect(curated.probability).toBeCloseTo(0.71, 4);
  });
});
