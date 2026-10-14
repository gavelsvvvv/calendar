import type { CuratedCalendarEvent } from "../curation/types";
import { CANONICAL_FEED_URL, safeExternalUrl, safeFeedUrl } from "./safe-url";
import { formatIcsDate, formatIcsUtc, MAX_DESCRIPTION_LENGTH, nextDay, sanitizeIcsText } from "./ics";

/**
 * Google Calendar "add event" links.
 *
 * Google's template URL takes a `dates` parameter in one of two shapes: a UTC
 * instant pair for timed events, or a plain date pair for all-day ones. Using
 * the timed form for an event that has no reliable clock time would invent
 * information, so events flagged all-day get the date form.
 */

const GOOGLE_TEMPLATE = "https://calendar.google.com/calendar/render";

export type GoogleEventOptions = {
  /** Absolute base URL of this deployment, included in the details. */
  siteUrl?: string;
};

function buildDetails(event: CuratedCalendarEvent, siteUrl?: string): string {
  const parts: string[] = [];
  parts.push(`Category: ${event.category.charAt(0).toUpperCase()}${event.category.slice(1)}`);
  if (event.probability !== undefined) {
    const pct = Math.round(event.probability * 100);
    parts.push(
      `Current probability: ${pct}%${event.leadingOutcome ? ` (${event.leadingOutcome})` : ""}`,
    );
  }
  parts.push(`Volume: $${Math.round(event.volume).toLocaleString("en-US")}`);
  if (event.relatedMarketsCount > 1) {
    parts.push(`Related markets: ${event.relatedMarketsCount}`);
  }
  parts.push("");
  parts.push(`Open on Polymarket: ${event.primaryMarketUrl}`);
  if (siteUrl) parts.push(`View in Polymarket Calendar: ${siteUrl}`);
  parts.push("");
  parts.push("Added from Polymarket Calendar — an independent interface using public Polymarket data.");
  return parts.join("\n");
}

/** The `dates` parameter: `YYYYMMDD/YYYYMMDD` or `…T…Z/…T…Z`. */
export function googleDatesParam(event: CuratedCalendarEvent): string {
  if (event.isAllDay) {
    // Google treats the end date as exclusive for all-day events.
    return `${formatIcsDate(event.displayDate)}/${nextDay(event.displayDate)}`;
  }
  const start = formatIcsUtc(event.endDate);
  const end = formatIcsUtc(new Date(Date.parse(event.endDate) + 3_600_000).toISOString());
  return `${start}/${end}`;
}

/** A ready-to-open Google Calendar event URL. */
export function buildGoogleCalendarUrl(
  event: CuratedCalendarEvent,
  options: GoogleEventOptions = {},
): string {
  /*
   * `URLSearchParams` is what stops a title like `x&sf=true` from becoming a
   * second parameter — it percent-encodes the whole value — and the template
   * host is a literal, so there is no destination to redirect. Sanitising on top
   * of that is about what lands in the user's calendar rather than about URL
   * parsing: control characters and bidi overrides have no business in an event
   * title, whether or not they are safely encoded on the way there.
   */
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: sanitizeIcsText(event.title),
    dates: googleDatesParam(event),
    details: sanitizeIcsText(buildDetails(event, options.siteUrl), MAX_DESCRIPTION_LENGTH),
    // Not a physical location — the link is the useful thing to put here, and
    // it is allowlisted because Google renders it as a link.
    location: safeExternalUrl(event.primaryMarketUrl) ?? "",
    trp: "false",
  });
  return `${GOOGLE_TEMPLATE}?${params.toString()}`;
}

/**
 * The URL that adds a *subscription* (not a single event) in Google Calendar.
 *
 * Google has no reliable one-click subscribe endpoint for arbitrary feeds, so
 * this opens the "add by URL" screen with the feed pre-filled where Google
 * honours it; the subscription modal also shows the raw URL to paste, because
 * that is the path that always works.
 */
export function buildGoogleSubscribeUrl(feedUrl: string): string {
  // Only ever our own feed. `cid` is the URL Google will subscribe the user to,
  // so an unvalidated value here would let a crafted link enrol somebody in a
  // third party's calendar from a page that looks like ours.
  const safe = safeFeedUrl(feedUrl) ?? CANONICAL_FEED_URL;
  return `https://calendar.google.com/calendar/r/settings/addbyurl?cid=${encodeURIComponent(safe)}`;
}

/**
 * Apple Calendar and most desktop clients subscribe via the webcal scheme.
 *
 * The input is allowlisted first, and that is the whole security property here.
 * `webcal://` is a *subscription* instruction: iOS hands it to Calendar, which
 * then polls that URL indefinitely. A user-controlled value reaching this
 * function would let a crafted link silently subscribe somebody to an attacker's
 * feed — a persistent foothold on their phone's calendar, refreshed forever.
 *
 * Falling back to the canonical feed rather than returning null keeps the button
 * working; there is no case where the right answer is a webcal link to something
 * we did not publish.
 */
export function toWebcalUrl(feedUrl: string): string {
  const safe = safeFeedUrl(feedUrl) ?? CANONICAL_FEED_URL;
  // Scheme swap only — the path and query are passed through byte-for-byte,
  // because re-encoding a query that is already encoded is how a filtered feed
  // silently becomes a different feed.
  return safe.replace(/^https?:\/\//i, "webcal://");
}
