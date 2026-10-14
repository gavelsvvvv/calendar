import { describe, expect, it } from "vitest";
import type { CuratedCalendarEvent } from "../../curation/types";
import {
  buildGoogleCalendarUrl,
  googleDatesParam,
  toWebcalUrl,
} from "../google";
import {
  buildOutlookEventUrl,
  buildOutlookSubscribeUrl,
  OUTLOOK_ACCOUNTS,
} from "../outlook";
import {
  buildIcsCalendar,
  buildSingleEventIcs,
  escapeIcsText,
  foldIcsLine,
  icsUid,
} from "../ics";

const DTSTAMP = "2026-08-05T12:00:00Z";

function event(overrides: Partial<CuratedCalendarEvent> = {}): CuratedCalendarEvent {
  return {
    id: "757862",
    slug: "clf-vil-lu-2026-08-05",
    title: "CF Villarreal C vs. Levante UD",
    shortTitle: "CF Villarreal C vs. Levante UD",
    endDate: "2026-08-05T18:10:00Z",
    displayDate: "2026-08-05",
    time: "14:10",
    timeKind: "scheduled",
    timezone: "America/New_York",
    isAllDay: false,
    dateConfidence: "confirmed",
    dateSource: "gameStartTime",
    category: "sports",
    volume: 265_000,
    liquidity: 43_000,
    primaryMarketUrl: "https://polymarket.com/event/clf-vil-lu-2026-08-05",
    relatedMarketsCount: 4,
    probability: 0.55,
    leadingOutcome: "Villarreal",
    importanceScore: 62,
    importanceLevel: "major",
    status: "upcoming",
    source: "polymarket",
    sourceEventIds: ["757862", "758277"],
    groupedBy: "game-id",
    tags: ["Soccer"],
    ...overrides,
  };
}

/** Split a folded document back into logical lines. */
function unfold(ics: string): string[] {
  return ics.replace(/\r\n[ \t]/g, "").split("\r\n");
}

describe("ICS escaping and folding", () => {
  it("escapes commas, semicolons, backslashes and newlines", () => {
    expect(escapeIcsText("a,b")).toBe("a\\,b");
    expect(escapeIcsText("a;b")).toBe("a\\;b");
    expect(escapeIcsText("a\\b")).toBe("a\\\\b");
    expect(escapeIcsText("a\nb")).toBe("a\\nb");
    expect(escapeIcsText("a\r\nb")).toBe("a\\nb");
  });

  it("escapes the backslash before the characters it introduces", () => {
    // A naive order would turn "\," into "\\\\," instead of "\\\\\\,".
    expect(escapeIcsText("a\\,b")).toBe("a\\\\\\,b");
  });

  it("folds lines to 75 octets, measured after UTF-8 encoding", () => {
    const folded = foldIcsLine(`SUMMARY:${"Fenerbahçe ".repeat(20)}`);
    for (const line of folded.split("\r\n")) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
  });

  it("leaves short lines alone", () => {
    expect(foldIcsLine("SUMMARY:Short")).toBe("SUMMARY:Short");
  });

  it("continues folded lines with a leading space", () => {
    const folded = foldIcsLine("X".repeat(200));
    expect(folded.split("\r\n").slice(1).every((l) => l.startsWith(" "))).toBe(true);
  });
});

describe("ICS documents", () => {
  it("produces a structurally valid calendar", () => {
    const ics = buildIcsCalendar([event()], { dtstamp: DTSTAMP });
    const lines = unfold(ics);

    expect(lines[0]).toBe("BEGIN:VCALENDAR");
    expect(lines).toContain("VERSION:2.0");
    expect(lines.some((l) => l.startsWith("PRODID:"))).toBe(true);
    expect(lines).toContain("BEGIN:VEVENT");
    expect(lines).toContain("END:VEVENT");
    // The document ends with END:VCALENDAR and a trailing CRLF.
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });

  it("uses CRLF line endings throughout", () => {
    const ics = buildIcsCalendar([event()], { dtstamp: DTSTAMP });
    // No bare LF anywhere.
    expect(/[^\r]\n/.test(ics)).toBe(false);
  });

  it("balances BEGIN and END blocks", () => {
    const ics = buildIcsCalendar([event({ id: "a" }), event({ id: "b" })], { dtstamp: DTSTAMP });
    const lines = unfold(ics);
    expect(lines.filter((l) => l === "BEGIN:VEVENT")).toHaveLength(2);
    expect(lines.filter((l) => l === "END:VEVENT")).toHaveLength(2);
  });

  it("carries required VEVENT properties", () => {
    const lines = unfold(buildIcsCalendar([event()], { dtstamp: DTSTAMP }));
    for (const prop of ["UID:", "DTSTAMP:", "DTSTART:", "DTEND:", "SUMMARY:", "URL:"]) {
      expect(lines.some((l) => l.startsWith(prop)), prop).toBe(true);
    }
  });

  it("keeps UIDs stable between requests", () => {
    const a = buildIcsCalendar([event()], { dtstamp: DTSTAMP });
    const b = buildIcsCalendar([event()], { dtstamp: "2026-09-09T09:09:09Z" });
    const uidOf = (ics: string) => unfold(ics).find((l) => l.startsWith("UID:"));
    expect(uidOf(a)).toBe(uidOf(b));
    expect(uidOf(a)).toBe(`UID:pmc-757862@calendarpolymarket.com`);
  });

  it("derives the UID only from the event id", () => {
    // Volume and probability move constantly; the UID must not.
    expect(icsUid(event({ volume: 1 }))).toBe(icsUid(event({ volume: 999_999 })));
  });

  it("serializes the same event set identically regardless of input order", () => {
    const a = buildIcsCalendar([event({ id: "1" }), event({ id: "2" })], { dtstamp: DTSTAMP });
    const b = buildIcsCalendar([event({ id: "2" }), event({ id: "1" })], { dtstamp: DTSTAMP });
    expect(a).toBe(b);
  });

  it("exports an event with no reliable time as all-day", () => {
    const lines = unfold(
      buildIcsCalendar([event({ isAllDay: true, time: undefined })], { dtstamp: DTSTAMP }),
    );
    expect(lines).toContain("DTSTART;VALUE=DATE:20260805");
    // All-day DTEND is exclusive: the following day.
    expect(lines).toContain("DTEND;VALUE=DATE:20260806");
    expect(lines.some((l) => /^DTSTART:\d{8}T/.test(l))).toBe(false);
  });

  it("escapes special characters inside a real title", () => {
    const ics = buildIcsCalendar(
      [event({ title: "Fed decision; rates up, down\\sideways" })],
      { dtstamp: DTSTAMP },
    );
    const summary = unfold(ics).find((l) => l.startsWith("SUMMARY:"));
    expect(summary).toBe("SUMMARY:Fed decision\\; rates up\\, down\\\\sideways");
  });

  it("builds a single-event file named after the event", () => {
    const ics = buildSingleEventIcs(event(), { dtstamp: DTSTAMP });
    expect(unfold(ics).filter((l) => l === "BEGIN:VEVENT")).toHaveLength(1);
    expect(ics).toContain("X-WR-CALNAME:CF Villarreal C vs. Levante UD");
  });

  it("advertises a refresh interval so subscribers re-poll", () => {
    const lines = unfold(buildIcsCalendar([event()], { dtstamp: DTSTAMP }));
    expect(lines.some((l) => l.startsWith("REFRESH-INTERVAL"))).toBe(true);
  });
});

describe("Google Calendar links", () => {
  it("contains every field Google needs", () => {
    const url = new URL(buildGoogleCalendarUrl(event(), { siteUrl: "https://example.com" }));
    expect(url.searchParams.get("action")).toBe("TEMPLATE");
    expect(url.searchParams.get("text")).toBe("CF Villarreal C vs. Levante UD");
    expect(url.searchParams.get("dates")).toBe("20260805T181000Z/20260805T191000Z");
    expect(url.searchParams.get("details")).toContain("https://polymarket.com/event/");
    expect(url.searchParams.get("details")).toContain("https://example.com");
    expect(url.searchParams.get("location")).toBe(
      "https://polymarket.com/event/clf-vil-lu-2026-08-05",
    );
  });

  it("uses the all-day date format when there is no reliable time", () => {
    expect(googleDatesParam(event({ isAllDay: true }))).toBe("20260805/20260806");
    // …and never invents a clock time.
    const url = new URL(buildGoogleCalendarUrl(event({ isAllDay: true })));
    expect(url.searchParams.get("dates")).not.toContain("T");
  });

  it("includes the probability and volume in the details", () => {
    const url = new URL(buildGoogleCalendarUrl(event()));
    const details = url.searchParams.get("details") ?? "";
    expect(details).toContain("55%");
    expect(details).toContain("Villarreal");
    expect(details).toContain("$265,000");
  });

  it("converts an https feed to webcal for Apple Calendar", () => {
    expect(toWebcalUrl("https://example.com/api/calendar/all.ics")).toBe(
      "webcal://example.com/api/calendar/all.ics",
    );
  });
});

describe("Outlook links", () => {
  /*
   * The account split is the whole reason these are two functions' worth of
   * care rather than one URL. Personal and work Outlook are different hosts,
   * and a link to the wrong one does not degrade — it lands the visitor on a
   * sign-in page for an account they do not have.
   */
  it("sends personal and work accounts to different hosts", () => {
    const feed = "https://example.com/api/calendar/all.ics";
    expect(buildOutlookSubscribeUrl(feed, "personal")).toContain("https://outlook.live.com/");
    expect(buildOutlookSubscribeUrl(feed, "work")).toContain("https://outlook.office.com/");
    expect(OUTLOOK_ACCOUNTS.map((a) => a.value)).toEqual(["personal", "work"]);
  });

  it("subscribes with the feed as a webcal url", () => {
    const url = new URL(
      buildOutlookSubscribeUrl("https://example.com/api/calendar/all.ics", "personal"),
    );
    expect(url.pathname).toBe("/calendar/0/addfromweb");
    expect(url.searchParams.get("url")).toBe("webcal://example.com/api/calendar/all.ics");
    expect(url.searchParams.get("name")).toBe("Polymarket Calendar");
  });

  it("builds a compose deep link for one event", () => {
    const url = new URL(buildOutlookEventUrl(event(), "personal"));
    expect(url.pathname).toBe("/calendar/deeplink/compose");
    expect(url.searchParams.get("path")).toBe("/calendar/action/compose");
    expect(url.searchParams.get("rru")).toBe("addevent");
    expect(url.searchParams.get("subject")).toBe("CF Villarreal C vs. Levante UD");
    expect(url.searchParams.get("startdt")).toBe("2026-08-05T18:10:00Z");
    expect(url.searchParams.get("enddt")).toBe("2026-08-05T19:10:00Z");
    expect(url.searchParams.get("location")).toBe(
      "https://polymarket.com/event/clf-vil-lu-2026-08-05",
    );
    expect(url.searchParams.get("allday")).toBeNull();
  });

  /*
   * An all-day event must land on the same single day in Outlook as it does in
   * the ICS export and the Google link. Outlook's end is exclusive, like both
   * of those, so a bare `enddt` equal to the start would produce a zero-length
   * event — and using the *inclusive* day would produce a two-day one.
   */
  it("uses a plain date and an exclusive end for an all-day event", () => {
    const url = new URL(buildOutlookEventUrl(event({ isAllDay: true }), "work"));
    expect(url.searchParams.get("startdt")).toBe("2026-08-05");
    expect(url.searchParams.get("enddt")).toBe("2026-08-06");
    expect(url.searchParams.get("allday")).toBe("true");
    // Never an invented clock time.
    expect(url.searchParams.get("startdt")).not.toContain("T");
  });

  it("carries the probability and volume into the body", () => {
    const url = new URL(buildOutlookEventUrl(event()));
    const body = url.searchParams.get("body") ?? "";
    expect(body).toContain("55%");
    expect(body).toContain("Villarreal");
    expect(body).toContain("$265,000");
  });
});

describe("Outlook feed compatibility", () => {
  /*
   * Outlook does not read TRANSP. Without the Microsoft extension every entry
   * in a subscribed feed lands as Busy, and a month of fixtures would black out
   * the subscriber's free/busy.
   */
  it("marks every event free in the way Outlook actually reads", () => {
    const lines = unfold(buildIcsCalendar([event(), event({ id: "b" })], { dtstamp: DTSTAMP }));
    expect(lines.filter((l) => l === "TRANSP:TRANSPARENT")).toHaveLength(2);
    expect(lines.filter((l) => l === "X-MICROSOFT-CDO-BUSYSTATUS:FREE")).toHaveLength(2);
  });

  it("advertises a refresh interval in both the standard and Outlook forms", () => {
    const lines = unfold(buildIcsCalendar([event()], { dtstamp: DTSTAMP }));
    expect(lines).toContain("REFRESH-INTERVAL;VALUE=DURATION:PT6H");
    expect(lines).toContain("X-PUBLISHED-TTL:PT6H");
  });
});
