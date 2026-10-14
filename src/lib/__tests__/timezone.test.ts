import { describe, expect, it } from "vitest";
/**
 * `buildVEvent` may now decline an event it cannot serialize safely, so tests
 * that assert on its output say so explicitly rather than silently passing on a
 * null.
 */
function mustBuild(...args: Parameters<typeof buildVEvent>): string[] {
  const lines = buildVEvent(...args);
  if (!lines) throw new Error("buildVEvent declined a fixture the test expects to serialize");
  return lines;
}

import { buildVEvent } from "../calendar-export/ics";
import { googleDatesParam } from "../calendar-export/google";
import { localizeEvent, localizeEvents } from "../localize";
import type { CuratedCalendarEvent } from "../curation/types";
import {
  isValidTimeZone,
  zonedDayKey,
  zonedMinutes,
  zonedTime,
  zoneOffsetLabel,
} from "../timezone";

/**
 * Four zones on four continents, chosen so every one of them disagrees with the
 * others about at least one of these cases: Sofia is UTC+2/+3, London is
 * UTC+0/+1 with its DST on a different schedule from the US, New York is the
 * zone the data is authored in, and Tokyo is UTC+9 with no DST at all.
 */
const SOFIA = "Europe/Sofia";
const LONDON = "Europe/London";
const NEW_YORK = "America/New_York";
const TOKYO = "Asia/Tokyo";

function timed(endDate: string, overrides: Partial<CuratedCalendarEvent> = {}) {
  return {
    id: "e1",
    endDate,
    // What the server computed, in its own zone. Localizing must overwrite it.
    displayDate: "1970-01-01",
    time: "00:00",
    timezone: NEW_YORK,
    isAllDay: false,
    ...overrides,
  } as CuratedCalendarEvent;
}

describe("zone conversion", () => {
  it("shows one instant as a different clock time in every zone", () => {
    // 19:00 UTC on 10 August 2026 — summer, so Sofia is +3 and London +1.
    const iso = "2026-08-10T19:00:00Z";
    expect(zonedTime(iso, SOFIA)).toBe("22:00");
    expect(zonedTime(iso, LONDON)).toBe("20:00");
    expect(zonedTime(iso, NEW_YORK)).toBe("15:00");
    expect(zonedTime(iso, TOKYO)).toBe("04:00");
  });

  it("moves the event onto a different calendar day where the zone says so", () => {
    // The case from the brief: 00:30 UTC is already the 11th in London and
    // still the 10th in New York.
    const iso = "2026-08-11T00:30:00Z";
    expect(zonedDayKey(iso, LONDON)).toBe("2026-08-11");
    expect(zonedDayKey(iso, SOFIA)).toBe("2026-08-11");
    expect(zonedDayKey(iso, NEW_YORK)).toBe("2026-08-10");
    expect(zonedDayKey(iso, TOKYO)).toBe("2026-08-11");
  });

  it("crosses midnight forwards in the east and backwards in the west", () => {
    // 23:00 UTC: Tokyo is already tomorrow morning, New York is still evening.
    const iso = "2026-08-10T23:00:00Z";
    expect(zonedDayKey(iso, TOKYO)).toBe("2026-08-11");
    expect(zonedTime(iso, TOKYO)).toBe("08:00");
    expect(zonedDayKey(iso, NEW_YORK)).toBe("2026-08-10");
    expect(zonedTime(iso, NEW_YORK)).toBe("19:00");
  });

  it("renders midnight as 00:00 rather than 24:00", () => {
    // Some locales write the end of the day instead of the start of it, which
    // sorts after everything and reads as tomorrow.
    expect(zonedTime("2026-08-10T21:00:00Z", SOFIA)).toBe("00:00");
    expect(zonedDayKey("2026-08-10T21:00:00Z", SOFIA)).toBe("2026-08-11");
  });

  it("follows daylight saving without being told the offset", () => {
    // Same wall-clock question, six months apart. Sofia is +2 in winter, +3 in
    // summer; London +0 and +1. Nothing here knows those numbers.
    expect(zonedTime("2026-01-10T19:00:00Z", SOFIA)).toBe("21:00");
    expect(zonedTime("2026-07-10T19:00:00Z", SOFIA)).toBe("22:00");
    expect(zonedTime("2026-01-10T19:00:00Z", LONDON)).toBe("19:00");
    expect(zonedTime("2026-07-10T19:00:00Z", LONDON)).toBe("20:00");
    // Tokyo has no daylight saving at all.
    expect(zonedTime("2026-01-10T19:00:00Z", TOKYO)).toBe("04:00");
    expect(zonedTime("2026-07-10T19:00:00Z", TOKYO)).toBe("04:00");
  });

  it("reports the offset as it stands at that moment", () => {
    expect(zoneOffsetLabel(SOFIA, new Date("2026-01-10T12:00:00Z"))).toBe("GMT+2");
    expect(zoneOffsetLabel(SOFIA, new Date("2026-07-10T12:00:00Z"))).toBe("GMT+3");
    expect(zoneOffsetLabel(TOKYO, new Date("2026-07-10T12:00:00Z"))).toBe("GMT+9");
  });

  it("positions the week grid against local minutes past midnight", () => {
    expect(zonedMinutes("2026-08-10T19:00:00Z", SOFIA)).toBe(22 * 60);
    expect(zonedMinutes("2026-08-10T19:00:00Z", NEW_YORK)).toBe(15 * 60);
  });

  it("rejects a zone it cannot resolve", () => {
    expect(isValidTimeZone(SOFIA)).toBe(true);
    expect(isValidTimeZone("Mars/Olympus_Mons")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });
});

describe("localizing a dataset", () => {
  it("rewrites both the clock time and the calendar day of a timed event", () => {
    const event = timed("2026-08-10T19:00:00Z");
    const sofia = localizeEvent(event, SOFIA);
    expect(sofia.time).toBe("22:00");
    expect(sofia.displayDate).toBe("2026-08-10");
    expect(sofia.timezone).toBe(SOFIA);

    const tokyo = localizeEvent(event, TOKYO);
    expect(tokyo.time).toBe("04:00");
    // Same instant, next day.
    expect(tokyo.displayDate).toBe("2026-08-11");
  });

  it("keeps a sports kickoff as one instant seen from two places", () => {
    // `gameStartTime` is the real moment the game starts. It is not display
    // text that happens to be in Eastern time, and treating it as such is how a
    // 20:10 first pitch became a 20:10 kickoff for a reader in Tokyo.
    const firstPitch = timed("2026-08-06T18:20:00Z");
    expect(localizeEvent(firstPitch, NEW_YORK).time).toBe("14:20");
    expect(localizeEvent(firstPitch, SOFIA).time).toBe("21:20");
    expect(localizeEvent(firstPitch, TOKYO).time).toBe("03:20");
    // And the same absolute instant throughout.
    expect(localizeEvent(firstPitch, TOKYO).endDate).toBe(firstPitch.endDate);
  });

  it("never moves an all-day event, in any zone", () => {
    // A civil date. Polymarket wrote a placeholder meaning "some time that
    // day"; converting it is how four primaries were once filed a day early.
    const allDay = timed("2026-08-10T04:00:00Z", {
      isAllDay: true,
      displayDate: "2026-08-10",
      time: "23:59",
    });
    for (const zone of [SOFIA, LONDON, NEW_YORK, TOKYO]) {
      const localized = localizeEvent(allDay, zone);
      expect(localized.displayDate).toBe("2026-08-10");
      expect(localized.time).toBe("23:59");
      // Untouched, so identity survives and the memos downstream hold.
      expect(localized).toBe(allDay);
    }
  });

  it("hands back the same array when nothing moved", () => {
    const events = [
      timed("2026-08-10T19:00:00Z", { displayDate: "2026-08-10", time: "15:00" }),
    ];
    const once = localizeEvents(events, NEW_YORK);
    // Already correct for New York, so no new identities anywhere.
    expect(once).toBe(events);
    expect(localizeEvents(events, NEW_YORK)).toBe(once);
  });

  it("re-localizes when the zone changes", () => {
    const events = [timed("2026-08-10T19:00:00Z")];
    const sofia = localizeEvents(events, SOFIA);
    const tokyo = localizeEvents(events, TOKYO);
    expect(sofia[0].time).toBe("22:00");
    expect(tokyo[0].time).toBe("04:00");
  });

  it("gives month, week and agenda the same answer, because there is one pass", () => {
    // Every view reads `displayDate` and `time` off the localized event, so
    // agreement is structural rather than a property three components each have
    // to get right.
    const events = [timed("2026-08-11T00:30:00Z")];
    const [london] = localizeEvents(events, LONDON);
    const [newYork] = localizeEvents(events, NEW_YORK);
    expect(london.displayDate).toBe("2026-08-11");
    expect(london.time).toBe("01:30");
    expect(newYork.displayDate).toBe("2026-08-10");
    expect(newYork.time).toBe("20:30");
  });
});

describe("calendar export is not converted twice", () => {
  it("exports a timed event as the same instant whatever zone the reader is in", () => {
    // The panel that builds these links holds a *localized* event, so its
    // `time` and `displayDate` differ per reader. The export must ignore both
    // and use `endDate`, or a Sofia reader would add a fixture three hours late.
    const event = timed("2026-08-10T19:00:00Z", {
      title: "Fixture",
      primaryMarketUrl: "https://polymarket.com/event/x",
      relatedMarketsCount: 1,
      volume: 1000,
      category: "sports",
      status: "upcoming",
      importanceLevel: "standard",
    });

    const dates = [SOFIA, LONDON, NEW_YORK, TOKYO].map((zone) =>
      googleDatesParam(localizeEvent(event, zone)),
    );
    expect(new Set(dates).size).toBe(1);
    expect(dates[0]).toBe("20260810T190000Z/20260810T200000Z");

    const ics = [SOFIA, TOKYO].map((zone) =>
      buildVEvent(localizeEvent(event, zone), { dtstamp: "2026-01-01T00:00:00Z" }),
    );
    expect(ics[0]).toContain("DTSTART:20260810T190000Z");
    expect(ics[1]).toContain("DTSTART:20260810T190000Z");
  });

  it("keeps an all-day event on its civil date, as a DATE value", () => {
    const allDay = timed("2026-08-10T04:00:00Z", {
      isAllDay: true,
      displayDate: "2026-08-10",
      time: "23:59",
      title: "Primary",
      primaryMarketUrl: "https://polymarket.com/event/y",
      relatedMarketsCount: 1,
      volume: 1000,
      category: "elections",
      status: "upcoming",
      importanceLevel: "standard",
    });

    for (const zone of [SOFIA, TOKYO]) {
      const lines = mustBuild(localizeEvent(allDay, zone), { dtstamp: "2026-01-01T00:00:00Z" });
      expect(lines).toContain("DTSTART;VALUE=DATE:20260810");
      expect(lines).toContain("DTEND;VALUE=DATE:20260811");
      // No instant form anywhere — a DATE-VALUE event that also carries a UTC
      // stamp is exactly the double conversion this guards against.
      expect(lines.some((l) => /^DTSTART:\d{8}T/.test(l))).toBe(false);
    }
    expect(googleDatesParam(localizeEvent(allDay, TOKYO))).toBe("20260810/20260811");
  });
});
