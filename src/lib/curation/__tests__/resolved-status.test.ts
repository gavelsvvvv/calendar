import { describe, expect, it } from "vitest";
import { curateEvents } from "../curate";
import { resolveSettlementInstant } from "../event-date";
import { ALL_CATEGORIES, DEFAULT_FILTERS, filterEvents } from "../filters";
import { isSettled } from "../types";
import { gammaEvent } from "./fixtures";
import type { GammaEvent } from "../../polymarket/gamma-types";

/**
 * Resolved markets must not appear as future events.
 *
 * The case these are built from is real and was reported by name: "World Cup:
 * Nation of Top Goalscorer" settled on 2026-07-20 — all 54 markets closed, every
 * one of them `resolved` at UMA — and carried an `endDate` of 2026-08-20. For a
 * month the calendar showed it as a normal upcoming event three days out, with
 * the details panel underneath printing "Resolved". Five more events in the same
 * live window were in the same state, so this was never one market.
 *
 * The fixtures below reproduce the *shape*, not the slug. Nothing here is
 * hardcoded to that event, and the rules they pin are the ones that would have
 * to break for it to come back.
 */

const NOW = new Date("2026-08-17T12:00:00Z");

/**
 * A market group that has already paid out, with a deadline still in the future.
 *
 * `closedTime` on both the event and its markets, because Gamma writes it in two
 * different formats — ISO on the event, space-separated on the market — and the
 * settlement reader has to survive both.
 */
function settledWithFutureDeadline(
  overrides: Partial<GammaEvent> = {},
  /** Strip every settlement timestamp, leaving only the deadline. */
  withoutSettlementTime = false,
): GammaEvent {
  return gammaEvent({
    id: "839000",
    slug: "world-cup-top-scorer-nation",
    title: "World Cup: Nation of Top Goalscorer",
    // A month after it actually settled.
    endDate: "2026-09-20T00:00:00Z",
    closed: true,
    closedTime: "2026-07-20T00:35:45Z",
    volume: 4_000_000,
    liquidity: 400_000,
    tags: [
      { id: "1", label: "Sports", slug: "sports" },
      { id: "2", label: "World Cup", slug: "world-cup" },
    ],
    markets: Array.from({ length: 6 }, (_, i) => ({
      id: `m${i}`,
      question: `Nation ${i}`,
      slug: `nation-${i}`,
      endDate: "2026-09-20T00:00:00Z",
      closedTime: "2026-07-06 05:11:50+00",
      closed: true,
      umaResolutionStatus: "resolved",
      hasReviewedDates: true,
      outcomes: '["Yes", "No"]',
      // One nation paid out; the rest went to zero. That is what makes this
      // "resolved" rather than "closed".
      outcomePrices: i === 0 ? '["1", "0"]' : '["0", "1"]',
      volume: "700000",
      liquidity: "70000",
      // Removed rather than the whole `markets` array: an event with no markets
      // is excluded by a different rule entirely, and the fixture would prove
      // nothing about the one under test.
      ...(withoutSettlementTime ? { closedTime: undefined } : {}),
    })),
    ...(withoutSettlementTime ? { closedTime: undefined } : {}),
    ...overrides,
  } as Partial<GammaEvent>);
}

describe("settlement is read from Gamma's own closedTime", () => {
  it("takes the latest across the event and every market", () => {
    const instant = resolveSettlementInstant([settledWithFutureDeadline()]);
    // The event says 2026-07-20; its markets say 2026-07-06. A group is
    // finished when its last leg is.
    expect(instant).toBe("2026-07-20T00:35:45.000Z");
  });

  it("parses the space-separated form Gamma writes on markets", () => {
    const instant = resolveSettlementInstant([settledWithFutureDeadline({ closedTime: undefined })]);
    expect(instant).toBe("2026-07-06T05:11:50.000Z");
  });

  it("is null when nothing readable is present, rather than a guess", () => {
    const event = gammaEvent({ closed: true });
    expect(resolveSettlementInstant([event])).toBeNull();
  });
});

describe("a resolved event is dated when it resolved", () => {
  it("does not sit on its future deadline", () => {
    const { events } = curateEvents([settledWithFutureDeadline()], { now: NOW });
    expect(events).toHaveLength(1);
    expect(events[0].status).toBe("resolved");
    expect(events[0].displayDate).not.toBe("2026-09-20");
  });

  it("is dated from closedTime, and says so", () => {
    const { events } = curateEvents([settledWithFutureDeadline()], { now: NOW });
    // 00:35Z on the 20th is 20:35 on the 19th in market time.
    expect(events[0].displayDate).toBe("2026-07-19");
    expect(events[0].dateSource).toBe("closedTime");
  });

  it("lands in the past, which is the whole point", () => {
    const { events } = curateEvents([settledWithFutureDeadline()], { now: NOW });
    expect(events[0].displayDate < "2026-08-17").toBe(true);
  });

  it("stays browsable in history rather than being deleted", () => {
    // §8: a resolved event may remain when browsing past dates. It is only
    // being *upcoming* that is wrong.
    const { events } = curateEvents([settledWithFutureDeadline()], { now: NOW });
    const shown = filterEvents(events, DEFAULT_FILTERS, { now: NOW });
    expect(shown).toHaveLength(1);
    expect(shown[0].displayDate).toBe("2026-07-19");
  });
});

describe("settling later than the event does not move it", () => {
  it("keeps a played fixture on the day it was played", () => {
    /*
     * The direction that must not be symmetric. A match played on the 13th
     * settles on the 20th once UMA's dispute window elapses — that is the
     * ordinary case, and re-dating on it would shove every finished fixture a
     * week into the future, which is a worse bug than the one being fixed.
     */
    const played = gammaEvent({
      id: "555",
      slug: "team-a-vs-team-b",
      title: "Team A vs Team B",
      endDate: "2026-08-13T23:00:00Z",
      closed: true,
      closedTime: "2026-08-20T10:00:00Z",
      volume: 2_000_000,
      liquidity: 200_000,
      tags: [{ id: "1", label: "Sports", slug: "sports" }],
      markets: [
        {
          id: "m1",
          question: "Match winner",
          slug: "match-winner",
          endDate: "2026-08-13T23:00:00Z",
          closedTime: "2026-08-20 10:00:00+00",
          closed: true,
          umaResolutionStatus: "resolved",
          hasReviewedDates: true,
          outcomes: '["A", "B"]',
          outcomePrices: '["1", "0"]',
          volume: "2000000",
          liquidity: "200000",
        },
      ],
    } as Partial<GammaEvent>);

    const { events } = curateEvents([played], { now: NOW });
    expect(events[0].status).toBe("resolved");
    expect(events[0].displayDate).toBe("2026-08-13");
    expect(events[0].dateSource).not.toBe("closedTime");
  });
});

describe("the residue is filtered, never invented", () => {
  it("hides a settled event still dated in the future", () => {
    // No `closedTime` anywhere, so the date ladder has nothing better than the
    // deadline. The one date available is provably not the event's, so the
    // honest thing is not to show it.
    const { events } = curateEvents(
      [settledWithFutureDeadline({}, true)],
      { now: NOW },
    );
    // It survives curation — history and the tombstone path both need it.
    expect(events).toHaveLength(1);
    expect(isSettled(events[0].status)).toBe(true);
    expect(events[0].displayDate).toBe("2026-09-20");
    // But no calendar shows it.
    expect(filterEvents(events, DEFAULT_FILTERS, { now: NOW })).toHaveLength(0);
  });

  it("still shows an upcoming event on the same future day", () => {
    const upcoming = gammaEvent({
      id: "999",
      slug: "still-open",
      title: "Something that has not happened",
      endDate: "2026-09-20T16:00:00Z",
      volume: 800_000,
    });
    const { events } = curateEvents(
      [settledWithFutureDeadline({}, true), upcoming],
      { now: NOW },
    );
    const shown = filterEvents(events, DEFAULT_FILTERS, { now: NOW });
    expect(shown.map((e) => e.slug)).toEqual(["still-open"]);
  });

  it("does not hide a settled event that landed on today", () => {
    // An event that settled this morning belongs on today's calendar, not
    // nowhere. The guard compares day keys for exactly this reason.
    const today = gammaEvent({
      id: "111",
      slug: "settled-today",
      title: "Settled this morning",
      endDate: "2026-08-17T14:00:00Z",
      closed: true,
      volume: 900_000,
      markets: [
        {
          id: "m1",
          question: "Did it?",
          slug: "did-it",
          endDate: "2026-08-17T14:00:00Z",
          closed: true,
          umaResolutionStatus: "resolved",
          hasReviewedDates: true,
          outcomes: '["Yes", "No"]',
          outcomePrices: '["1", "0"]',
          volume: "900000",
        },
      ],
    } as Partial<GammaEvent>);
    const { events } = curateEvents([today], { now: NOW });
    expect(filterEvents(events, DEFAULT_FILTERS, { now: NOW })).toHaveLength(1);
  });
});

describe("status is decided for the whole logical event", () => {
  /** One match, several legs, and only some of them settled. */
  function partlySettled(): GammaEvent {
    return gammaEvent({
      id: "777",
      slug: "iran-leadership-change",
      title: "Iran leadership change by…?",
      endDate: "2027-03-31T00:00:00Z",
      volume: 3_000_000,
      liquidity: 300_000,
      tags: [{ id: "1", label: "World", slug: "world" }],
      markets: [
        // The dated legs that have come and gone.
        {
          id: "m1", question: "By March 2026?", slug: "by-march",
          endDate: "2026-03-31T00:00:00Z", closed: true, umaResolutionStatus: "resolved",
          hasReviewedDates: true, outcomes: '["Yes","No"]', outcomePrices: '["0","1"]',
          volume: "1000000",
        },
        {
          id: "m2", question: "By July 2026?", slug: "by-july",
          endDate: "2026-07-31T00:00:00Z", closed: true, umaResolutionStatus: "resolved",
          hasReviewedDates: true, outcomes: '["Yes","No"]', outcomePrices: '["0","1"]',
          volume: "1000000",
        },
        // And the one that has not.
        {
          id: "m3", question: "By March 2027?", slug: "by-march-2027",
          endDate: "2027-03-31T00:00:00Z", closed: false,
          hasReviewedDates: true, outcomes: '["Yes","No"]', outcomePrices: '["0.3","0.7"]',
          volume: "1000000",
        },
      ],
    } as Partial<GammaEvent>);
  }

  it("does not resolve a group because some children closed", () => {
    const { events } = curateEvents([partlySettled()], { now: NOW });
    expect(events[0].status).toBe("upcoming");
    expect(isSettled(events[0].status)).toBe(false);
  });

  it("keeps a partly-settled group on the calendar", () => {
    const { events } = curateEvents([partlySettled()], { now: NOW });
    expect(filterEvents(events, DEFAULT_FILTERS, { now: NOW })).toHaveLength(1);
  });

  it("resolves once every child has, and re-dates with them", () => {
    const base = partlySettled();
    const all = {
      ...base,
      closedTime: "2026-08-01T12:00:00Z",
      markets: (base.markets ?? []).map((m) => ({
        ...m,
        closed: true,
        umaResolutionStatus: "resolved",
        outcomePrices: '["1","0"]',
      })),
    };
    const { events } = curateEvents([all], { now: NOW });
    expect(events[0].status).toBe("resolved");
    expect(events[0].displayDate).toBe("2026-08-01");
  });
});

describe("closed is not resolved, and cancelled is neither", () => {
  it("calls a settled book that paid nobody `closed`", () => {
    const voided = gammaEvent({
      id: "222",
      slug: "voided",
      title: "A question nobody could answer",
      endDate: "2026-08-10T00:00:00Z",
      volume: 600_000,
      markets: [
        {
          id: "m1", question: "Well?", slug: "well",
          endDate: "2026-08-10T00:00:00Z", closed: true, umaResolutionStatus: "resolved",
          hasReviewedDates: true, outcomes: '["Yes","No"]',
          // Nothing at either extreme: the book closed mid-range, so it was
          // voided rather than decided.
          outcomePrices: '["0.5","0.5"]', volume: "600000",
        },
      ],
    } as Partial<GammaEvent>);
    const { events } = curateEvents([voided], { now: NOW });
    expect(events[0].status).toBe("closed");
    expect(isSettled(events[0].status)).toBe(true);
  });

  it("marks a retired event cancelled and keeps it out of every view", () => {
    const retired = gammaEvent({
      id: "333",
      slug: "retired",
      title: "Withdrawn",
      endDate: "2026-09-01T00:00:00Z",
      archived: true,
      volume: 600_000,
    });
    const { events } = curateEvents([retired], { now: NOW });
    expect(events[0].status).toBe("cancelled");
    expect(filterEvents(events, DEFAULT_FILTERS, { now: NOW })).toHaveLength(0);
  });

  it("does not cancel a group while any member is still live", () => {
    const alive = gammaEvent({ id: "444", slug: "alive", archived: false, volume: 600_000 });
    const { events } = curateEvents([alive], { now: NOW });
    expect(events[0].status).not.toBe("cancelled");
  });
});

describe("the day-key comparison happens in one zone", () => {
  /*
   * `displayDate` is bucketed in market time. The guard used to compare it
   * against `toDateKey(now)`, which reads the *process* clock — UTC on a
   * server, four or five hours ahead of New York. Between 20:00 and midnight
   * Eastern the two disagreed, and a settled event either leaked onto a future
   * day in the published feed or vanished from the day it belonged on.
   *
   * The existing cases all use 12:00Z, where every zone agrees on the date,
   * which is exactly why they never caught it.
   */
  /*
   * Its own fixture rather than an override on the one above: that one pins
   * its markets to a hardcoded end date, and `resolveEventDate` prefers a
   * unanimous reviewed market end, so overriding only the event's date moves
   * nothing. No `closedTime` anywhere, so the ladder's answer stands and the
   * guard is the only thing deciding.
   */
  const settledOn = (day: string) =>
    curateEvents(
      [
        gammaEvent({
          id: "zone",
          slug: "settled-somewhere",
          title: "Something already decided",
          endDate: `${day}T16:00:00Z`,
          closed: true,
          volume: 900_000,
          markets: [
            {
              id: "m1",
              question: "Well?",
              slug: "well",
              endDate: `${day}T16:00:00Z`,
              closed: true,
              umaResolutionStatus: "resolved",
              hasReviewedDates: true,
              outcomes: '["Yes", "No"]',
              outcomePrices: '["1", "0"]',
              volume: "900000",
            },
          ],
        } as Partial<GammaEvent>),
      ],
      { now: NOW },
    ).events;

  it("does not leak a settled event when the server clock has rolled over", () => {
    // 02:00Z on the 16th is 22:00 ET on the 15th: market-today is the 15th, so
    // an event on the 16th is still in the future and must stay hidden.
    const evening = new Date("2026-08-16T02:00:00Z");
    const events = settledOn("2026-08-16");
    expect(events[0].displayDate).toBe("2026-08-16");
    expect(filterEvents(events, DEFAULT_FILTERS, { now: evening })).toHaveLength(0);
  });

  it("shows a settled event once market time reaches its day", () => {
    // 16:00Z on the 16th is midday ET on the 16th — the event's own day.
    const midday = new Date("2026-08-16T16:00:00Z");
    expect(
      filterEvents(settledOn("2026-08-16"), DEFAULT_FILTERS, { now: midday }),
    ).toHaveLength(1);
  });

  it("still shows yesterday's settled event, whatever the process clock says", () => {
    const evening = new Date("2026-08-16T02:00:00Z");
    expect(
      filterEvents(settledOn("2026-08-14"), DEFAULT_FILTERS, { now: evening }),
    ).toHaveLength(1);
  });
});

describe("a retired event never competes for a day's slots", () => {
  /*
   * Cancelled events flow through the pipeline on purpose — the feed needs them
   * to publish a tombstone — and they used to reach `applyPerDayCaps`, where
   * they could both take a slot from a real event and lose one themselves. The
   * second is worse: a capped-away tombstone is never published, so the stale
   * entry never leaves a subscriber's calendar.
   */
  function retired(id: string, volume: number): GammaEvent {
    return gammaEvent({
      id,
      slug: `retired-${id}`,
      title: `Withdrawn ${id}`,
      endDate: "2026-08-20T16:00:00Z",
      archived: true,
      volume,
      liquidity: volume / 4,
      tags: [{ id: "1", label: "Sports", slug: "sports" }],
    });
  }
  function liveSports(id: string, volume: number): GammaEvent {
    return gammaEvent({
      id,
      slug: `live-${id}`,
      title: `Fixture ${id}`,
      endDate: "2026-08-20T16:00:00Z",
      volume,
      liquidity: volume / 4,
      tags: [{ id: "1", label: "Sports", slug: "sports" }],
    });
  }

  it("does not evict a real event", () => {
    // Sports allows two a day. Three retired giants and two real fixtures.
    const { events } = curateEvents(
      [
        retired("r1", 9_000_000),
        retired("r2", 8_000_000),
        retired("r3", 7_000_000),
        liveSports("a", 1_000_000),
        liveSports("b", 900_000),
      ],
      { now: NOW },
    );
    const shown = filterEvents(events, DEFAULT_FILTERS, { now: NOW });
    expect(shown.map((e) => e.slug).sort()).toEqual(["live-a", "live-b"]);
  });

  it("keeps every tombstone, however far down it would have ranked", () => {
    const { events } = curateEvents(
      [
        liveSports("a", 9_000_000),
        liveSports("b", 8_000_000),
        liveSports("c", 7_000_000),
        // Above the sports relevance floor, so the cap is genuinely what it
        // would have lost to — a $1,000 event never reaches the cap at all.
        retired("r1", 300_000),
      ],
      { now: NOW },
    );
    // The retired one is worth less than everything on the day and still
    // survives, because the feed route can only publish what it can see.
    expect(events.some((e) => e.slug === "retired-r1" && e.status === "cancelled")).toBe(true);
  });
});

describe("every view agrees, because they share one filter", () => {
  it("hides the misdated event under any category selection that includes it", () => {
    const { events } = curateEvents(
      [settledWithFutureDeadline({}, true)],
      { now: NOW },
    );
    for (const categories of [ALL_CATEGORIES, ["sports" as const]]) {
      expect(
        filterEvents(events, { ...DEFAULT_FILTERS, categories }, { now: NOW }),
      ).toHaveLength(0);
    }
  });
});
