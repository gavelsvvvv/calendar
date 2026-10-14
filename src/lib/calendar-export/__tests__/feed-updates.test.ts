import { describe, expect, it } from "vitest";
import type { CuratedCalendarEvent } from "../../curation/types";
import { buildIcsCalendar, icsSequence, icsUid } from "../ics";

/**
 * The subscription contract.
 *
 * A subscribed calendar re-fetches this feed on a schedule and reconciles it
 * against what it already holds. Everything below is a way of asking the same
 * question: after that reconciliation, does the subscriber have one copy of the
 * event, in the right place?
 *
 * Three properties carry it, and they fail differently:
 *
 *   UID            wrong → a second copy appears beside the first
 *   SEQUENCE       wrong → the client keeps the stale copy
 *   LAST-MODIFIED  wrong → the client cannot order two revisions
 */

function event(overrides: Partial<CuratedCalendarEvent> = {}): CuratedCalendarEvent {
  return {
    id: "757862",
    slug: "clf-vil-lu",
    title: "CF Villarreal C vs. Levante UD",
    shortTitle: "CF Villarreal C vs. Levante UD",
    endDate: "2026-08-05T18:10:00Z",
    displayDate: "2026-08-05",
    time: "14:10",
    timeKind: "scheduled",
    isAllDay: false,
    dateConfidence: "confirmed",
    dateSource: "gameStartTime",
    lastModified: "2026-08-01T09:00:00Z",
    category: "sports",
    volume: 265_000,
    liquidity: 43_000,
    primaryMarketUrl: "https://polymarket.com/event/clf-vil-lu",
    relatedMarketsCount: 4,
    importanceScore: 62,
    importanceLevel: "major",
    status: "upcoming",
    source: "polymarket",
    sourceEventIds: ["757862"],
    groupedBy: "single",
    tags: [],
    ...overrides,
  };
}

const DTSTAMP = "2026-08-05T12:00:00Z";

function unfold(ics: string): string[] {
  return ics.replace(/\r\n[ \t]/g, "").split("\r\n");
}

function propsOf(ics: string, prefix: string): string[] {
  return unfold(ics).filter((l) => l.startsWith(prefix));
}

/** What a client would end up holding: one entry per UID, newest wins. */
function reconcile(feeds: string[]): Map<string, { sequence: number; lines: string[] }> {
  const held = new Map<string, { sequence: number; lines: string[] }>();
  for (const feed of feeds) {
    const lines = unfold(feed);
    let current: string[] | null = null;
    for (const line of lines) {
      if (line === "BEGIN:VEVENT") current = [];
      else if (line === "END:VEVENT" && current) {
        const uid = current.find((l) => l.startsWith("UID:"))?.slice(4) ?? "";
        const seq = Number(current.find((l) => l.startsWith("SEQUENCE:"))?.slice(9) ?? 0);
        const existing = held.get(uid);
        // A client keeps what it has unless the incoming revision is newer.
        if (!existing || seq >= existing.sequence) {
          held.set(uid, { sequence: seq, lines: current });
        }
        current = null;
      } else if (current) current.push(line);
    }
  }
  return held;
}

describe("a refresh does not duplicate", () => {
  it("publishes event A exactly once on first subscription", () => {
    const feed = buildIcsCalendar([event()], { dtstamp: DTSTAMP });
    expect(propsOf(feed, "UID:")).toHaveLength(1);
  });

  it("still holds exactly one copy after an unchanged refresh", () => {
    const first = buildIcsCalendar([event()], { dtstamp: DTSTAMP });
    const second = buildIcsCalendar([event()], { dtstamp: "2026-08-05T18:00:00Z" });
    expect(reconcile([first, second]).size).toBe(1);
  });

  it("produces byte-identical output for unchanged data at the same dtstamp", () => {
    expect(buildIcsCalendar([event()], { dtstamp: DTSTAMP })).toBe(
      buildIcsCalendar([event()], { dtstamp: DTSTAMP }),
    );
  });

  it("survives many refreshes without accumulating entries", () => {
    const feeds = Array.from({ length: 10 }, (_, i) =>
      buildIcsCalendar([event()], { dtstamp: `2026-08-0${(i % 9) + 1}T12:00:00Z` }),
    );
    expect(reconcile(feeds).size).toBe(1);
  });
});

describe("a changed event updates in place", () => {
  const original = event();

  it("keeps the same UID when the time moves", () => {
    const moved = event({
      endDate: "2026-08-05T20:10:00Z",
      time: "16:10",
      lastModified: "2026-08-02T09:00:00Z",
    });
    expect(icsUid(moved)).toBe(icsUid(original));
  });

  it("keeps the same UID when the date moves", () => {
    const moved = event({
      endDate: "2026-08-09T18:10:00Z",
      displayDate: "2026-08-09",
      lastModified: "2026-08-02T09:00:00Z",
    });
    expect(icsUid(moved)).toBe(icsUid(original));
  });

  it("moves the event rather than adding a second one", () => {
    const before = buildIcsCalendar([original], { dtstamp: DTSTAMP });
    const after = buildIcsCalendar(
      [
        event({
          endDate: "2026-08-09T18:10:00Z",
          displayDate: "2026-08-09",
          lastModified: "2026-08-02T09:00:00Z",
        }),
      ],
      { dtstamp: "2026-08-06T12:00:00Z" },
    );
    const held = reconcile([before, after]);
    expect(held.size).toBe(1);
    const entry = [...held.values()][0];
    expect(entry.lines.some((l) => l === "DTSTART:20260809T181000Z")).toBe(true);
  });

  it("raises SEQUENCE so the client accepts the newer copy", () => {
    const before = icsSequence(original);
    const after = icsSequence(event({ lastModified: "2026-08-02T09:00:00Z" }));
    expect(after).toBeGreaterThan(before);
  });

  it("keeps SEQUENCE identical when nothing changed", () => {
    expect(icsSequence(event())).toBe(icsSequence(event({ volume: 999 })));
  });

  it("reports LAST-MODIFIED as the moment Polymarket changed the event", () => {
    const lines = unfold(buildIcsCalendar([original], { dtstamp: DTSTAMP }));
    expect(lines).toContain("LAST-MODIFIED:20260801T090000Z");
  });

  it("omits LAST-MODIFIED rather than inventing one", () => {
    // A fabricated revision time is worse than none: clients order revisions by
    // it, so a made-up value can make a stale copy look newer than a real one.
    const lines = unfold(
      buildIcsCalendar([event({ lastModified: undefined })], { dtstamp: DTSTAMP }),
    );
    expect(lines.some((l) => l.startsWith("LAST-MODIFIED:"))).toBe(false);
    expect(lines).toContain("SEQUENCE:0");
  });

  it("never emits a SEQUENCE that could overflow a 32-bit client", () => {
    expect(icsSequence(event({ lastModified: "2099-12-31T23:59:00Z" }))).toBeLessThan(
      2_147_483_647,
    );
  });

  it("never emits a negative SEQUENCE for data older than the epoch", () => {
    expect(icsSequence(event({ lastModified: "1999-01-01T00:00:00Z" }))).toBe(0);
  });

  it("ignores sub-minute churn so price ticks do not advertise revisions", () => {
    const a = icsSequence(event({ lastModified: "2026-08-01T09:00:10Z" }));
    const b = icsSequence(event({ lastModified: "2026-08-01T09:00:50Z" }));
    expect(a).toBe(b);
  });
});

describe("a cancelled event is retracted, not abandoned", () => {
  it("publishes STATUS:CANCELLED under the original UID", () => {
    const feed = buildIcsCalendar(
      [event({ status: "cancelled", lastModified: "2026-08-03T09:00:00Z" })],
      { dtstamp: DTSTAMP },
    );
    const lines = unfold(feed);
    expect(lines).toContain("STATUS:CANCELLED");
    expect(lines).toContain(`UID:${icsUid(event())}`);
  });

  it("outranks the copy it replaces, so the retraction sticks", () => {
    const live = buildIcsCalendar([event()], { dtstamp: DTSTAMP });
    const dead = buildIcsCalendar(
      [event({ status: "cancelled", lastModified: "2026-08-03T09:00:00Z" })],
      { dtstamp: "2026-08-03T12:00:00Z" },
    );
    const held = reconcile([live, dead]);
    expect(held.size).toBe(1);
    expect([...held.values()][0].lines).toContain("STATUS:CANCELLED");
  });

  it("marks a live event TENTATIVE and a settled one CONFIRMED", () => {
    expect(unfold(buildIcsCalendar([event()], { dtstamp: DTSTAMP }))).toContain(
      "STATUS:TENTATIVE",
    );
    expect(
      unfold(buildIcsCalendar([event({ status: "resolved" })], { dtstamp: DTSTAMP })),
    ).toContain("STATUS:CONFIRMED");
  });

  it("does not cancel an event that merely ended without paying out", () => {
    // A voided book is not a cancelled event: the thing happened, the market
    // simply paid nobody. Tombstoning it would delete a legitimate past entry.
    const lines = unfold(
      buildIcsCalendar([event({ status: "closed" })], { dtstamp: DTSTAMP }),
    );
    expect(lines).not.toContain("STATUS:CANCELLED");
  });
});

describe("the export keeps its promises about time", () => {
  it("keeps an all-day event all-day across a revision", () => {
    const lines = unfold(
      buildIcsCalendar(
        [event({ isAllDay: true, lastModified: "2026-08-04T09:00:00Z" })],
        { dtstamp: DTSTAMP },
      ),
    );
    expect(lines).toContain("DTSTART;VALUE=DATE:20260805");
    expect(lines).toContain("DTEND;VALUE=DATE:20260806");
    expect(lines.some((l) => /^DTSTART:\d{8}T/.test(l))).toBe(false);
  });

  it("keeps a timed event on its exact instant", () => {
    const lines = unfold(buildIcsCalendar([event()], { dtstamp: DTSTAMP }));
    expect(lines).toContain("DTSTART:20260805T181000Z");
    expect(lines).toContain("DTEND:20260805T191000Z");
  });

  it("does not let a revision turn a timed event all-day", () => {
    const lines = unfold(
      buildIcsCalendar([event({ lastModified: "2026-08-04T09:00:00Z" })], {
        dtstamp: DTSTAMP,
      }),
    );
    expect(lines.some((l) => l.startsWith("DTSTART;VALUE=DATE"))).toBe(false);
  });
});
