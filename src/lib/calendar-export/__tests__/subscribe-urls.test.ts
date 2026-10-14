import { describe, expect, it } from "vitest";
import { buildFeedUrl, DEFAULT_FEED_SELECTION } from "../feed-url";
import { buildGoogleSubscribeUrl, toWebcalUrl } from "../google";

/**
 * Subscription URLs.
 *
 * A feed URL is an identity, not just an address: a calendar app treats a
 * changed URL as a *different calendar*, so the same selection has to produce
 * the same string every time, and the filters a reader chose have to survive
 * the trip through webcal and through Google's own encoding.
 */

const ORIGIN = "https://calendar.example.com";
const sel = (o: Partial<typeof DEFAULT_FEED_SELECTION> = {}) => ({
  ...DEFAULT_FEED_SELECTION,
  ...o,
});

describe("feed URLs", () => {
  it("uses the plain route when there is nothing to qualify", () => {
    expect(buildFeedUrl(sel(), ORIGIN)).toBe(`${ORIGIN}/api/calendar/all.ics`);
  });

  it("uses the pretty per-category route for a single category", () => {
    expect(buildFeedUrl(sel({ scope: "categories", categories: ["politics"] }), ORIGIN)).toBe(
      `${ORIGIN}/api/calendar/politics.ics`,
    );
  });

  it("is stable regardless of the order categories were ticked in", () => {
    // A calendar app treats a changed URL as a different calendar, so this is
    // the difference between updating a subscription and creating a second one.
    const a = buildFeedUrl(sel({ scope: "categories", categories: ["politics", "ai"] }), ORIGIN);
    const b = buildFeedUrl(sel({ scope: "categories", categories: ["ai", "politics"] }), ORIGIN);
    expect(a).toBe(b);
  });

  it("keeps every filter in the query string", () => {
    const url = new URL(
      buildFeedUrl(
        sel({
          scope: "categories",
          categories: ["politics", "ai"],
          minImportance: "important",
          includeSmallerMarkets: true,
        }),
        ORIGIN,
      ),
    );
    expect(url.pathname).toBe("/api/calendar/custom.ics");
    expect(url.searchParams.get("categories")).toBe("ai,politics");
    expect(url.searchParams.get("minImportance")).toBe("important");
    expect(url.searchParams.get("includeSmaller")).toBe("1");
  });

  it("encodes the category list exactly once", () => {
    // The separator arrives as `%2C`, which is a comma encoded once and is what
    // the route decodes back. Double encoding would send `%252C` and the route
    // would see one category literally named "ai,politics", returning nothing.
    const url = buildFeedUrl(
      sel({ scope: "categories", categories: ["politics", "ai"] }),
      ORIGIN,
    );
    expect(url).not.toContain("%252C");
    expect(new URL(url).searchParams.get("categories")).toBe("ai,politics");
  });

  it("tolerates a trailing slash on the origin", () => {
    expect(buildFeedUrl(sel(), "https://calendar.example.com/")).toBe(
      `${ORIGIN}/api/calendar/all.ics`,
    );
  });
});

describe("webcal conversion", () => {
  it("swaps the scheme and nothing else", () => {
    expect(toWebcalUrl(`${ORIGIN}/api/calendar/all.ics`)).toBe(
      "webcal://calendar.example.com/api/calendar/all.ics",
    );
  });

  it("converts http as well as https", () => {
    expect(toWebcalUrl("http://localhost:3000/api/calendar/all.ics")).toBe(
      "webcal://localhost:3000/api/calendar/all.ics",
    );
  });

  it("preserves the query string exactly", () => {
    const feed = buildFeedUrl(
      sel({
        scope: "categories",
        categories: ["politics", "ai"],
        minImportance: "important",
        includeSmallerMarkets: true,
      }),
      ORIGIN,
    );
    const webcal = toWebcalUrl(feed);
    expect(webcal.startsWith("webcal://")).toBe(true);
    // Same string after the scheme — no re-encoding on the way through.
    expect(webcal.slice("webcal://".length)).toBe(feed.slice("https://".length));
    // Read back the way a client will: the scheme swap must not touch the query.
    const asHttps = new URL(webcal.replace(/^webcal:/, "https:"));
    expect(asHttps.searchParams.get("categories")).toBe("ai,politics");
    expect(asHttps.searchParams.get("minImportance")).toBe("important");
    expect(asHttps.searchParams.get("includeSmaller")).toBe("1");
  });

  it("leaves a URL that is already webcal alone", () => {
    const already = "webcal://calendar.example.com/api/calendar/all.ics";
    expect(toWebcalUrl(already)).toBe(already);
  });
});

describe("the Google subscribe link", () => {
  it("encodes the feed exactly once", () => {
    const feed = buildFeedUrl(
      sel({ scope: "categories", categories: ["politics", "ai"], minImportance: "major" }),
      ORIGIN,
    );
    const link = buildGoogleSubscribeUrl(feed);
    const cid = new URL(link).searchParams.get("cid");
    // `URL` decodes once. Getting the original back means it went in once.
    expect(cid).toBe(feed);
  });

  it("points at Google's add-by-URL screen", () => {
    const link = new URL(buildGoogleSubscribeUrl(`${ORIGIN}/api/calendar/all.ics`));
    expect(link.hostname).toBe("calendar.google.com");
    expect(link.pathname).toContain("addbyurl");
  });

  it("survives a feed URL whose query would break an unencoded parameter", () => {
    const feed = `${ORIGIN}/api/calendar/custom.ics?categories=a,b&minImportance=major`;
    const cid = new URL(buildGoogleSubscribeUrl(feed)).searchParams.get("cid");
    // Without encoding, `&minImportance=major` would become a parameter of the
    // *Google* URL and the feed would arrive truncated at the ampersand.
    expect(cid).toBe(feed);
  });
});
