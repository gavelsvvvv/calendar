import { describe, expect, it } from "vitest";
import type { GammaEvent } from "../../polymarket/gamma-types";
import { toDayKey } from "../../dates";
import { parseGammaInstant, refineTime, resolveEventDate } from "../event-date";
import { resolveTime } from "../curate";

/**
 * Date-quality regressions, one per category shape.
 *
 * Every case here is built from a real Gamma response, because the failures
 * this guards against were all shaped by fields that look usable and are not:
 * a `startDate` four months before the Fed meeting, a `startTime` a year past a
 * by-election, an `eventStartTime` that is a row timestamp. The assertions are
 * about which field *wins*, which is the only thing a reader ever sees.
 */

function ev(overrides: Partial<GammaEvent> = {}): GammaEvent {
  return {
    id: "1",
    title: "Event",
    slug: "event",
    // Every real event carries this and it is never the answer.
    startDate: "2026-05-13T21:23:09.737806Z",
    endDate: "2026-09-16T00:00:00Z",
    markets: [{ id: "m1", endDate: "2026-09-16T00:00:00Z", hasReviewedDates: true }],
    ...overrides,
  };
}

/** A fixture carries Gamma's sports metadata; all 290 live ones do. */
function fixture(overrides: Partial<GammaEvent> = {}): GammaEvent {
  return ev({
    gameId: 10_078_438,
    sport: { id: 1, sport: "baseball" },
    teams: [{ id: 1, name: "Home" }, { id: 2, name: "Away" }],
    ...overrides,
  });
}

describe("parseGammaInstant", () => {
  it("reads Gamma's space-separated kickoff format", () => {
    expect(parseGammaInstant("2026-08-06 18:20:00+00")).toBe("2026-08-06T18:20:00.000Z");
  });

  it("reads a bare calendar day as UTC midnight", () => {
    // The regression this exists for: the offset-widening rewrite that fixes
    // `+00` also matches the `-06` ending `2026-08-06`, producing
    // `2026-08-06:00` and silently dropping every eventDate on the floor.
    expect(parseGammaInstant("2026-08-06")).toBe("2026-08-06T00:00:00.000Z");
  });

  it("reads plain ISO", () => {
    expect(parseGammaInstant("2026-09-16T00:00:00Z")).toBe("2026-09-16T00:00:00.000Z");
  });

  it("rejects junk rather than inventing a date", () => {
    expect(parseGammaInstant("")).toBeNull();
    expect(parseGammaInstant("soon")).toBeNull();
    expect(parseGammaInstant(undefined)).toBeNull();
    expect(parseGammaInstant(12345)).toBeNull();
  });
});

describe("gameStartTime wins for sports", () => {
  it("puts an MLB game on the day it is played, not a week later", () => {
    // Toronto Blue Jays vs. Chicago Cubs, verbatim: played 6 August, market
    // resolves the 13th. 231 of the 300 day-moves in a six-week window are
    // exactly this shape.
    const resolved = resolveEventDate(
      fixture({
        title: "Toronto Blue Jays vs. Chicago Cubs",
        endDate: "2026-08-13T18:20:00Z",
        eventDate: "2026-08-06",
        startTime: "2026-08-06T18:20:00Z",
        markets: [
          {
            id: "m1",
            endDate: "2026-08-13T18:20:00Z",
            endDateIso: "2026-08-13",
            hasReviewedDates: true,
            gameStartTime: "2026-08-06 18:20:00+00",
          },
        ],
      }),
    );
    expect(resolved?.source).toBe("gameStartTime");
    expect(toDayKey(resolved!.iso)).toBe("2026-08-06");
  });

  it("keeps the kickoff instant, so the time is real rather than a deadline", () => {
    const resolved = resolveEventDate(
      fixture({
        markets: [{ id: "m1", gameStartTime: "2026-08-06 18:20:00+00" }],
      }),
    );
    const { time, isAllDay, timeKind } = resolveTime(resolved!.iso, resolved!.timeHintIso);
    expect(isAllDay).toBe(false);
    expect(timeKind).toBe("scheduled");
    expect(time).toBe("14:20"); // 18:20Z in America/New_York
  });

  it("takes the earliest leg when a group carries several kickoffs", () => {
    // Array order is Gamma's. An event begins when its first leg does.
    const resolved = resolveEventDate(
      fixture({
        markets: [
          { id: "late", gameStartTime: "2026-08-06 21:00:00+00" },
          { id: "early", gameStartTime: "2026-08-06 09:00:00+00" },
        ],
      }),
    );
    expect(resolved?.iso).toBe("2026-08-06T09:00:00.000Z");
  });

  it("puts an esports fixture on its own start time", () => {
    const resolved = resolveEventDate(
      fixture({
        title: "LoL: Hanwha Life Esports vs DN SOOPers (BO5)",
        sport: { id: 2, sport: "lol" },
        endDate: "2026-08-11T23:59:00Z",
        eventDate: "2026-08-11",
        markets: [{ id: "m1", gameStartTime: "2026-08-11 09:00:00+00" }],
      }),
    );
    expect(resolved?.source).toBe("gameStartTime");
    expect(resolved?.iso).toBe("2026-08-11T09:00:00.000Z");
  });
});

describe("gameStartTime is only a kickoff on a fixture", () => {
  // 80 of the 370 live events carrying `gameStartTime` are not fixtures, and
  // there the field marks the start of a *measurement window*. Taking it as the
  // event date files all of them a whole window early.

  it("does not file a month-long commodity market on the day the window opened", () => {
    const resolved = resolveEventDate(
      ev({
        title: "What will WTI Crude Oil (WTI) hit in August 2026?",
        endDate: "2026-09-01T00:00:00Z",
        markets: [
          {
            id: "m1",
            endDate: "2026-09-01T00:00:00Z",
            hasReviewedDates: true,
            gameStartTime: "2026-07-31 21:00:00+00",
          },
        ],
      }),
    );
    expect(resolved?.source).not.toBe("gameStartTime");
    expect(toDayKey(resolved!.iso)).toBe("2026-09-01");
  });

  it("does not file a weekly tweet-count market on the Monday it started", () => {
    const resolved = resolveEventDate(
      ev({
        title: "Elon Musk # tweets August 11 - August 18, 2026?",
        endDate: "2026-08-18T00:00:00Z",
        markets: [
          {
            id: "m1",
            endDate: "2026-08-18T00:00:00Z",
            hasReviewedDates: true,
            gameStartTime: "2026-08-11 12:00:00+00",
          },
        ],
      }),
    );
    expect(toDayKey(resolved!.iso)).toBe("2026-08-18");
  });

  it("puts a daily weather market on the date in its own title", () => {
    // gameStartTime says the 10th, eventDate says the 11th, and the title
    // agrees with eventDate. Rung 2 is what catches this.
    const resolved = resolveEventDate(
      ev({
        title: "Highest temperature in London on August 11?",
        endDate: "2026-08-11T00:00:00Z",
        eventDate: "2026-08-11",
        markets: [
          {
            id: "m1",
            endDate: "2026-08-11T00:00:00Z",
            hasReviewedDates: true,
            gameStartTime: "2026-08-10 22:00:00+00",
          },
        ],
      }),
    );
    expect(resolved?.source).toBe("eventDate");
    expect(toDayKey(resolved!.iso)).toBe("2026-08-11");
  });

  it("does not file a two-month geopolitical market eight weeks early", () => {
    const resolved = resolveEventDate(
      ev({
        title: "Who will attend a round of US-Iran peace talks by...?",
        endDate: "2026-08-31T00:00:00Z",
        markets: [
          {
            id: "m1",
            endDate: "2026-08-31T00:00:00Z",
            hasReviewedDates: true,
            gameStartTime: "2026-07-03 19:30:00+00",
          },
        ],
      }),
    );
    expect(toDayKey(resolved!.iso)).toBe("2026-08-31");
  });

  it("still trusts the kickoff when any one sports marker is present", () => {
    // All 290 live fixtures carry gameId, teams and sport together; accepting
    // any of them keeps the rung working if Gamma drops one.
    for (const marker of [
      { gameId: 10_078_438 },
      { sport: { id: 1, sport: "baseball" } },
      { teams: [{ id: 1, name: "Home" }, { id: 2, name: "Away" }] },
    ] as Array<Partial<GammaEvent>>) {
      const resolved = resolveEventDate(
        ev({
          ...marker,
          endDate: "2026-08-13T18:20:00Z",
          markets: [{ id: "m1", gameStartTime: "2026-08-06 18:20:00+00" }],
        }),
      );
      expect(resolved?.source).toBe("gameStartTime");
      expect(toDayKey(resolved!.iso)).toBe("2026-08-06");
    }
  });
});

describe("a structured real-event date beats a later resolution deadline", () => {
  it("uses eventDate when no kickoff exists", () => {
    const resolved = resolveEventDate(
      ev({
        endDate: "2026-09-21T00:00:00Z",
        eventDate: "2026-09-14",
        markets: [{ id: "m1", endDate: "2026-09-21T00:00:00Z" }],
      }),
    );
    expect(resolved?.source).toBe("eventDate");
    expect(toDayKey(resolved!.iso)).toBe("2026-09-14");
  });

  it("ranks eventDate below a kickoff, because only the kickoff can be re-zoned", () => {
    // A match at 00:30Z is "tomorrow" in UTC and tonight in New York. eventDate
    // is one fixed local day with no instant behind it, so the calendar cannot
    // move it for a reader elsewhere. The two disagree on 88 of 333 events.
    const resolved = resolveEventDate(
      fixture({
        eventDate: "2026-08-11",
        markets: [{ id: "m1", gameStartTime: "2026-08-12 00:30:00+00" }],
      }),
    );
    expect(resolved?.source).toBe("gameStartTime");
    expect(resolved?.iso).toBe("2026-08-12T00:30:00.000Z");
  });
});

describe("endDate remains the fallback", () => {
  it("keeps a central-bank decision on its endDate, which is the decision day", () => {
    // "Fed Decision in September?" carries no kickoff, no eventDate and no
    // startTime. Its endDate of 2026-09-16 *is* the FOMC day — the fallback is
    // the right answer here, not a failure of the ladder.
    const resolved = resolveEventDate(
      ev({
        title: "Fed Decision in September?",
        endDate: "2026-09-16T00:00:00Z",
        markets: [
          {
            id: "m1",
            endDate: "2026-09-16T00:00:00Z",
            endDateIso: "2026-09-16",
            hasReviewedDates: true,
          },
        ],
      }),
    );
    expect(resolved?.source).toBe("reviewedMarketEnd");
    expect(toDayKey(resolved!.iso)).toBe("2026-09-16");
  });

  it("falls all the way to the event's own end date", () => {
    const resolved = resolveEventDate(
      ev({ endDate: "2026-09-14T20:00:00Z", markets: [{ id: "m1" }] }),
    );
    expect(resolved?.source).toBe("eventEnd");
    expect(resolved?.iso).toBe("2026-09-14T20:00:00Z");
  });

  it("returns null rather than guessing when there is no usable date at all", () => {
    expect(resolveEventDate({ id: "1", title: "x", markets: [] })).toBeNull();
  });
});

describe("fields that look usable and are not", () => {
  it("never takes startDate, which is when the market opened", () => {
    // Present on 100% of events, disagreeing with endDate on 763 of 765.
    const resolved = resolveEventDate(
      ev({
        title: "Fed Decision in September?",
        startDate: "2026-05-13T21:23:09.737806Z",
        endDate: "2026-09-16T00:00:00Z",
      }),
    );
    expect(toDayKey(resolved!.iso)).toBe("2026-09-16");
    expect(resolved?.source).not.toBe("startDate");
  });

  it("never lets startTime move the day earlier", () => {
    // "Spider-Man: Brand New Day total domestic gross" reports a startTime six
    // weeks before its endDate — the market's opening moment, not a premiere.
    const resolved = resolveEventDate(
      ev({
        title: '"Spider-Man: Brand New Day" total domestic gross',
        endDate: "2026-08-31T23:59:00Z",
        startTime: "2026-07-16T20:04:00Z",
        markets: [{ id: "m1", endDate: "2026-08-31T23:59:00Z", hasReviewedDates: true }],
      }),
    );
    expect(toDayKey(resolved!.iso)).toBe("2026-08-31");
  });

  it("never lets startTime move the day later", () => {
    // "Clacton by-election Winner": an August 2026 poll reporting 2027-06-30.
    const resolved = resolveEventDate(
      ev({
        title: "Clacton by-election Winner",
        endDate: "2026-08-13T16:00:00Z",
        startTime: "2027-06-30T23:59:00Z",
        markets: [{ id: "m1", endDate: "2026-08-13T16:00:00Z", hasReviewedDates: true }],
      }),
    );
    expect(toDayKey(resolved!.iso)).toBe("2026-08-13");
    expect(resolved?.timeHintIso).toBeUndefined();
  });

  it("ignores eventStartTime, which is a row timestamp", () => {
    // Every market of the WTI August book carries the identical
    // `2026-07-25T04:02:24.716Z`, milliseconds and all.
    const resolved = resolveEventDate(
      ev({
        title: "What will WTI Crude Oil (WTI) hit in August 2026?",
        endDate: "2026-09-01T00:00:00Z",
        markets: [
          {
            id: "m1",
            endDate: "2026-09-01T00:00:00Z",
            hasReviewedDates: true,
            eventStartTime: "2026-07-25T04:02:24.716Z",
          },
        ],
      }),
    );
    expect(toDayKey(resolved!.iso)).toBe("2026-09-01");
  });
});

describe("startTime may refine the time, never the day", () => {
  it("gives an election a real time in place of an all-day placeholder", () => {
    // Berlin State Election: endDate 00:00Z is "some time that day"; Gamma's own
    // startTime names 17:00Z on the same day.
    const resolved = resolveEventDate(
      ev({
        title: "Berlin State Election Winner",
        endDate: "2026-09-20T00:00:00Z",
        startTime: "2026-09-20T17:00:00Z",
        markets: [{ id: "m1", endDate: "2026-09-20T00:00:00Z", hasReviewedDates: true }],
      }),
    );
    expect(toDayKey(resolved!.iso)).toBe("2026-09-20");
    const { time, isAllDay, timeKind } = resolveTime(resolved!.iso, resolved!.timeHintIso);
    expect(isAllDay).toBe(false);
    expect(timeKind).toBe("scheduled");
    expect(time).toBe("13:00"); // 17:00Z in America/New_York
  });

  it("refuses a hint that is itself a placeholder", () => {
    // Florida Governor Republican Primary: 00:00Z endDate, 23:59Z startTime.
    // Swapping one placeholder for another buys nothing and would print a
    // primary as scheduled for 19:59.
    expect(
      refineTime("2026-08-18T00:00:00Z", {
        startTime: "2026-08-18T23:59:00Z",
      } as GammaEvent),
    ).toBeUndefined();
  });

  it("refuses a hint when the chosen date already has a real time", () => {
    expect(
      refineTime("2026-08-06T18:20:00Z", {
        startTime: "2026-08-06T09:00:00Z",
      } as GammaEvent),
    ).toBeUndefined();
  });

  it("refuses a hint on a different day", () => {
    expect(
      refineTime("2026-08-18T00:00:00Z", {
        startTime: "2026-08-17T17:00:00Z",
      } as GammaEvent),
    ).toBeUndefined();
  });
});

describe("all-day and timed events", () => {
  it("keeps a bare-date event all-day", () => {
    const resolved = resolveEventDate(
      ev({
        title: "Minnesota Governor Republican Primary Winner",
        endDate: "2026-08-11T00:00:00Z",
        markets: [{ id: "m1", endDate: "2026-08-11T00:00:00Z", hasReviewedDates: true }],
      }),
    );
    const { isAllDay, timeKind } = resolveTime(resolved!.iso, resolved!.timeHintIso);
    expect(isAllDay).toBe(true);
    expect(timeKind).toBe("close");
  });

  it("treats midnight Eastern as a placeholder too", () => {
    // "July Inflation US - Annual" ends at 03:59Z, which is midnight ET and no
    // more a scheduled time than a bare date is.
    const { isAllDay, timeKind } = resolveTime("2026-08-12T03:59:00Z");
    expect(isAllDay).toBe(true);
    expect(timeKind).toBe("close");
  });

  it("keeps a genuinely timed event timed", () => {
    const { isAllDay, timeKind, time } = resolveTime("2026-08-05T18:10:00Z");
    expect(isAllDay).toBe(false);
    expect(timeKind).toBe("scheduled");
    expect(time).toBe("14:10");
  });
});

describe("dateSource is deterministic", () => {
  const cases: Array<[string, GammaEvent, string]> = [
    [
      "kickoff",
      fixture({ markets: [{ id: "m1", gameStartTime: "2026-08-06 18:20:00+00" }] }),
      "gameStartTime",
    ],
    [
      "event day",
      ev({ eventDate: "2026-09-14", markets: [{ id: "m1", endDate: "2026-09-21T00:00:00Z" }] }),
      "eventDate",
    ],
    [
      "reviewed unanimous",
      ev({
        endDate: "2026-09-16T00:00:00Z",
        markets: [
          { id: "m1", endDate: "2026-09-16T00:00:00Z", hasReviewedDates: true },
          { id: "m2", endDate: "2026-09-16T12:00:00Z", hasReviewedDates: true },
        ],
      }),
      "reviewedMarketEnd",
    ],
    ["event end", ev({ markets: [{ id: "m1" }] }), "eventEnd"],
  ];

  for (const [label, event, expected] of cases) {
    it(`${label} → ${expected}`, () => {
      expect(resolveEventDate(event)?.source).toBe(expected);
    });
  }

  it("returns the same answer every time for the same input", () => {
    const event = fixture({
      eventDate: "2026-09-14",
      startTime: "2026-09-14T17:00:00Z",
      markets: [{ id: "m1", gameStartTime: "2026-08-06 18:20:00+00" }],
    });
    const runs = Array.from({ length: 5 }, () => resolveEventDate(event));
    for (const run of runs) {
      expect(run).toEqual(runs[0]);
    }
  });
});
