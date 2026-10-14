import { describe, expect, it } from "vitest";
import { toDayKey } from "../dates";
import { isEventPast, nowSnapshot, type TimedLike } from "../event-time";

/** Build the three fields `isEventPast` reads, deriving the day key like curation does. */
function ev(endDate: string, isAllDay: boolean): TimedLike {
  return { endDate, displayDate: toDayKey(endDate), isAllDay };
}

/** 15:30 EDT on 5 August 2026. */
const AT_1530 = nowSnapshot(new Date("2026-08-05T19:30:00Z"));

describe("isEventPast", () => {
  it("fades nothing until the browser has read its clock", () => {
    // Server render and hydration must agree, so `null` means "don't know yet".
    expect(isEventPast(ev("2020-01-01T15:00:00Z", false), null)).toBe(false);
  });

  it("fades a timed event whose hour has gone by", () => {
    // 13:00 EDT, viewed at 15:30 EDT — the case in the request.
    expect(isEventPast(ev("2026-08-05T17:00:00Z", false), AT_1530)).toBe(true);
  });

  it("leaves a timed event later the same day alone", () => {
    // 19:00 EDT.
    expect(isEventPast(ev("2026-08-05T23:00:00Z", false), AT_1530)).toBe(false);
  });

  it("does not fade an event at its own moment", () => {
    expect(isEventPast(ev("2026-08-05T19:30:00Z", false), AT_1530)).toBe(false);
  });

  it("fades every event on an earlier day", () => {
    expect(isEventPast(ev("2026-08-04T23:00:00Z", false), AT_1530)).toBe(true);
    expect(isEventPast(ev("2026-08-05T03:59:59Z", true), AT_1530)).toBe(true);
  });

  it("leaves every event on a later day alone", () => {
    expect(isEventPast(ev("2026-08-06T14:00:00Z", false), AT_1530)).toBe(false);
    expect(isEventPast(ev("2026-08-07T04:00:00Z", true), AT_1530)).toBe(false);
  });

  /**
   * The regression this exists for: an all-day event's instant is a Polymarket
   * placeholder, not a schedule. Midnight-ET and midday-UTC placeholders have
   * both already elapsed by mid-afternoon, and comparing against them would
   * grey out the day's headline event over breakfast.
   */
  it("keeps an all-day event current until its whole day is over", () => {
    for (const placeholder of [
      "2026-08-05T04:00:00Z", // midnight ET
      "2026-08-05T12:00:00Z", // midday UTC
      "2026-08-06T03:59:59Z", // 23:59 ET, filed on the 5th
    ]) {
      const event = ev(placeholder, true);
      expect(event.displayDate).toBe("2026-08-05");
      expect(isEventPast(event, AT_1530)).toBe(false);
    }
  });

  it("fades an all-day event once the day has turned over", () => {
    const event = ev("2026-08-05T04:00:00Z", true);
    const nextDay = nowSnapshot(new Date("2026-08-06T13:00:00Z"));
    expect(isEventPast(event, nextDay)).toBe(true);
  });

  it("falls back to the day key when the instant is unparseable", () => {
    expect(isEventPast({ endDate: "n/a", displayDate: "2026-08-04", isAllDay: false }, AT_1530)).toBe(true);
    expect(isEventPast({ endDate: "n/a", displayDate: "2026-08-06", isAllDay: false }, AT_1530)).toBe(false);
  });

  it("reads the day key in market time, not UTC", () => {
    // 21:00 EDT on the 5th is already the 6th in UTC. An all-day event on the
    // 5th must still be current.
    const lateEvening = nowSnapshot(new Date("2026-08-06T01:00:00Z"));
    expect(lateEvening.dayKey).toBe("2026-08-05");
    expect(isEventPast(ev("2026-08-05T12:00:00Z", true), lateEvening)).toBe(false);
  });
});

/**
 * The reader's clock, not the server's.
 *
 * `isEventPast` compares an absolute instant against `now.ms`, and the day
 * fallback compares against `now.dayKey` — which `useNow` derives in the
 * viewer's own IANA zone. So the same event is past for a reader in Tokyo and
 * still ahead for one in Los Angeles, and neither sees the container's UTC.
 */
describe("past is decided in the reader's own timezone", () => {
  // 2026-08-11T02:00Z is 11 August in Tokyo and still 10 August in Los Angeles.
  const instant = "2026-08-11T02:00:00Z";
  const event = {
    endDate: instant,
    displayDate: "2026-08-11",
    isAllDay: false,
  } as Parameters<typeof isEventPast>[0];

  it("is past for a reader whose local day has already reached it", () => {
    const tokyoNow = { ms: Date.parse("2026-08-11T04:00:00Z"), dayKey: "2026-08-11" };
    expect(isEventPast(event, tokyoNow)).toBe(true);
  });

  it("is not past for a reader whose local clock has not", () => {
    const laNow = { ms: Date.parse("2026-08-11T01:00:00Z"), dayKey: "2026-08-10" };
    expect(isEventPast(event, laNow)).toBe(false);
  });

  it("uses the reader's day key for an all-day event, not UTC's", () => {
    const allDay = {
      endDate: instant,
      displayDate: "2026-08-11",
      isAllDay: true,
    } as Parameters<typeof isEventPast>[0];
    // Los Angeles is still on the 10th, so an event dated the 11th is ahead
    // even though the UTC instant has passed.
    expect(isEventPast(allDay, { ms: Date.parse("2026-08-11T07:00:00Z"), dayKey: "2026-08-10" })).toBe(
      false,
    );
    // Tokyo has already turned over to the 12th.
    expect(isEventPast(allDay, { ms: Date.parse("2026-08-12T01:00:00Z"), dayKey: "2026-08-12" })).toBe(
      true,
    );
  });

  it("never marks a future event past, at any hour of its own day", () => {
    for (const hour of ["00:00", "06:00", "12:00", "18:00", "23:59"]) {
      const now = { ms: Date.parse(`2026-08-11T${hour}:00Z`), dayKey: "2026-08-11" };
      const future = {
        endDate: "2026-09-20T12:00:00Z",
        displayDate: "2026-09-20",
        isAllDay: false,
      } as Parameters<typeof isEventPast>[0];
      expect(isEventPast(future, now), hour).toBe(false);
    }
  });
});
