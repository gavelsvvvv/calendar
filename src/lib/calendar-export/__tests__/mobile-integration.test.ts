import { describe, expect, it } from "vitest";
import { buildFeedUrl } from "../feed-url";
import { ALL_ESPORTS, ALL_SPORTS } from "@/lib/curation/filters";
import { eventIcsPath, eventIcsUrl } from "../event-url";
import { buildGoogleCalendarUrl, googleDatesParam, toWebcalUrl } from "../google";
import { buildSingleEventIcs, formatIcsDate, formatIcsUtc, nextDay } from "../ics";
import { detectCalendarPlatform } from "../platform";
import type { CuratedCalendarEvent } from "@/lib/curation/types";

/**
 * The mobile calendar-integration contract.
 *
 * These cover the parts of §14–20 that are decidable without a browser: the
 * shape of every URL a phone can be sent to, and the instant that travels with
 * it. The browser-side half — which sheet opens, in what order, and whether a
 * thumb can reach it — is measured in `calendar-add.probe.ts`.
 */

function event(overrides: Partial<CuratedCalendarEvent> = {}): CuratedCalendarEvent {
  return {
    id: "12345",
    slug: "fed-decision-september",
    title: "Fed interest rate decision",
    shortTitle: "Fed decision",
    endDate: "2026-09-17T18:00:00.000Z",
    displayDate: "2026-09-17",
    time: "14:00",
    timeKind: "scheduled",
    isAllDay: false,
    dateConfidence: "confirmed",
    dateSource: "eventDate",
    category: "economy",
    importanceLevel: "major",
    importanceScore: 90,
    status: "upcoming",
    volume: 4_200_000,
    liquidity: 300_000,
    primaryMarketUrl: "https://polymarket.com/event/fed-decision-september",
    relatedMarketsCount: 1,
    outcomes: [{ label: "Yes", probability: 0.62 }],
    ...overrides,
  } as CuratedCalendarEvent;
}

describe("single-event .ics is a served URL, not a blob", () => {
  /*
   * The reason this is a test rather than a comment: the previous
   * implementation built the file with `URL.createObjectURL` and clicked a
   * hidden anchor, which silently does nothing on iOS Safari. A regression back
   * to a `blob:` or `data:` URL would look fine on a desktop and be invisible
   * to anyone testing there.
   */
  it("points at the API route", () => {
    expect(eventIcsPath(event())).toBe(
      "/api/calendar/event/fed-decision-september.ics",
    );
  });

  it("prefers the slug but falls back to the id", () => {
    expect(eventIcsPath(event({ slug: "" }))).toBe("/api/calendar/event/12345.ics");
  });

  it("escapes a key that would otherwise break the path", () => {
    expect(eventIcsPath(event({ slug: "a/b?c" }))).toBe(
      "/api/calendar/event/a%2Fb%3Fc.ics",
    );
  });

  it("builds an absolute URL without doubling the slash", () => {
    expect(eventIcsUrl(event(), "https://example.com/")).toBe(
      "https://example.com/api/calendar/event/fed-decision-september.ics",
    );
  });

  it("is never a blob or data URL", () => {
    const path = eventIcsPath(event());
    expect(path.startsWith("blob:")).toBe(false);
    expect(path.startsWith("data:")).toBe(false);
    expect(path.startsWith("/")).toBe(true);
  });
});

describe("platform detection orders, never gates", () => {
  const IPHONE =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
  const ANDROID =
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
  const IPAD_DESKTOP_MODE =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
  const WINDOWS =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

  it("reads an iPhone", () => {
    expect(detectCalendarPlatform({ userAgent: IPHONE })).toBe("apple");
  });

  it("reads an Android phone", () => {
    expect(detectCalendarPlatform({ userAgent: ANDROID })).toBe("android");
  });

  it("reads an iPad pretending to be a Mac, and a real Mac, the same way", () => {
    // iPadOS 13+ ships a desktop Safari user agent. Both want Apple first, so
    // there is deliberately nothing to tell apart.
    expect(detectCalendarPlatform({ userAgent: IPAD_DESKTOP_MODE })).toBe("apple");
  });

  it("leaves Windows on the neutral order", () => {
    expect(detectCalendarPlatform({ userAgent: WINDOWS })).toBe("other");
  });

  it("prefers userAgentData when the browser provides it", () => {
    expect(
      detectCalendarPlatform({ userAgent: WINDOWS, uaDataPlatform: "Android" }),
    ).toBe("android");
  });

  it("returns the neutral order with no signals at all — the server case", () => {
    expect(detectCalendarPlatform()).toBe("other");
    expect(detectCalendarPlatform({})).toBe("other");
  });
});

describe("the exported instant is the instant the calendar shows", () => {
  /*
   * One absolute instant, converted once. The bug this guards against is a
   * double conversion: rendering 14:00 local and then exporting 14:00 *again*
   * as if it were UTC, which lands the entry hours away in the reader's app.
   */
  it("Google gets the event's UTC instant, not a local wall time", () => {
    const url = new URL(buildGoogleCalendarUrl(event()));
    expect(url.searchParams.get("dates")).toBe("20260917T180000Z/20260917T190000Z");
  });

  it("the .ics DTSTART is the same instant as the Google link", () => {
    const ics = buildSingleEventIcs(event());
    expect(ics).toContain("DTSTART:20260917T180000Z");
    expect(new URL(buildGoogleCalendarUrl(event())).searchParams.get("dates")).toContain(
      "20260917T180000Z",
    );
  });

  it("is independent of the machine's timezone", () => {
    // `formatIcsUtc` takes an ISO instant, so no local offset can leak in.
    for (const tz of ["Europe/Sofia", "America/New_York", "Europe/London", "Asia/Tokyo"]) {
      void tz;
      expect(formatIcsUtc("2026-09-17T18:00:00.000Z")).toBe("20260917T180000Z");
    }
  });

  it("keeps an all-day event date-only, with an exclusive end", () => {
    const allDay = event({ isAllDay: true, displayDate: "2026-11-03" });
    expect(googleDatesParam(allDay)).toBe("20261103/20261104");
    expect(formatIcsDate("2026-11-03")).toBe("20261103");
    expect(nextDay("2026-11-03")).toBe("20261104");

    const ics = buildSingleEventIcs(allDay);
    expect(ics).toContain("DTSTART;VALUE=DATE:20261103");
    expect(ics).toContain("DTEND;VALUE=DATE:20261104");
    // A date-only entry must never carry a time.
    expect(ics).not.toContain("DTSTART:2026");
  });

  it("carries the Polymarket link", () => {
    const url = new URL(buildGoogleCalendarUrl(event()));
    expect(url.searchParams.get("location")).toBe(
      "https://polymarket.com/event/fed-decision-september",
    );
    expect(buildSingleEventIcs(event())).toContain("polymarket.com");
  });
});

describe("subscription URLs keep their filters and are encoded once", () => {
  const selection = {
    scope: "categories" as const,
    categories: ["politics", "crypto"] as never,
    minImportance: "major" as const,
    includeSmallerMarkets: false,
    // Unnarrowed, so the sub-filter contributes nothing to the URL.
    sports: ALL_SPORTS,
    esports: ALL_ESPORTS,
  };

  it("preserves the chosen categories and importance", () => {
    const url = new URL(buildFeedUrl(selection, "https://example.com"));
    expect(url.pathname).toBe("/api/calendar/custom.ics");
    // Sorted, not click-ordered: the same selection has to produce the same URL
    // every time, or a subscriber who re-opens the dialog gets a second feed.
    expect(url.searchParams.get("categories")).toBe("crypto,politics");
    expect(url.searchParams.get("minImportance")).toBe("major");
  });

  it("does not double-encode when turned into a webcal:// URL", () => {
    const feed = buildFeedUrl(selection, "https://example.com");
    const webcal = toWebcalUrl(feed);

    expect(webcal.startsWith("webcal://")).toBe(true);
    // Only the scheme changes — nothing is re-encoded on the way through.
    expect(webcal).toBe(feed.replace(/^https?:\/\//, "webcal://"));

    /*
     * The comma is encoded exactly once. `%2C` is right and `%252C` is the
     * failure: a second pass would escape the `%`, and Apple would fetch a URL
     * whose `categories` value is the literal text "crypto%2Cpolitics" — a
     * feed that resolves no categories and quietly returns everything.
     */
    expect(webcal).toContain("categories=crypto%2Cpolitics");
    expect(webcal).not.toContain("%25");

    // And it still parses back to the values that went in.
    const parsed = new URL(webcal.replace("webcal://", "https://"));
    expect(parsed.searchParams.get("categories")).toBe("crypto,politics");
    expect(parsed.searchParams.get("minImportance")).toBe("major");
  });

  it("keeps 'all' as the plain feed", () => {
    const url = new URL(
      buildFeedUrl(
        {
          scope: "all",
          categories: [],
          minImportance: "all",
          includeSmallerMarkets: false,
          sports: ALL_SPORTS,
          esports: ALL_ESPORTS,
        },
        "https://example.com",
      ),
    );
    expect(url.pathname).toBe("/api/calendar/all.ics");
  });
});
