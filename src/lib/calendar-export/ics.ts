import { getCategoryMeta } from "../categories";
import { safeExternalUrl } from "./safe-url";
import type { CuratedCalendarEvent } from "../curation/types";

/**
 * iCalendar (RFC 5545) generation.
 *
 * Used for both single-event downloads and the public subscription feeds, so the
 * escaping, folding and UID rules live in one place. Everything here is pure —
 * given the same events and the same `dtstamp`, the output is byte-identical,
 * which is what stops a subscribed calendar from duplicating events on refresh.
 */

const CRLF = "\r\n";
const PRODID = "-//Polymarket Calendar//EN";

/**
 * The domain this calendar is actually published from.
 *
 * Stable across every rebuild of the feed, because a UID that changes makes a
 * subscribed calendar duplicate every event on the next refresh.
 *
 * It used to read `calendar.polymarket.com` — a subdomain of Polymarket's own
 * apex that this project does not own and that does not resolve. RFC 5545 §3.8.4.7
 * is explicit that the right-hand side of a UID should be a domain the publisher
 * controls, precisely so a UID identifies who issued it. Asserting someone
 * else's domain is an origin claim, and unlike page copy it travels: the value
 * is written into Google, Apple and Outlook calendars and re-shared from there,
 * telling every downstream client these events were published by Polymarket.
 *
 * Correcting it re-identifies every event, so existing subscribers will receive
 * one duplicate set on their next refresh. That is a real cost and it is worth
 * paying once: the alternative is continuing to publish a false origin.
 */
export const CALENDAR_DOMAIN = "calendarpolymarket.com";

/**
 * Characters RFC 5545 §3.1 forbids in a content line, minus the two we fold
 * into `\n` ourselves.
 *
 * CR and LF are handled by the escape below, so what is left here is the set a
 * naive escaper misses: NUL, BEL, VT, FF, the C0 range and DEL. They are not
 * cosmetic. A calendar client parsing a line containing a raw NUL may truncate
 * it, and different clients truncate differently — which is precisely the gap
 * an injected property hides in. Strip them rather than escape them: no
 * legitimate market title has ever contained one.
 */
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/**
 * Unicode that changes what text *appears* to say without changing what it is.
 *
 * The bidirectional overrides are the dangerous ones: `U+202E` reverses the
 * render order, so `Invoice\u202Etxt.exe` displays as `Invoice exe.txt` in a
 * calendar entry while remaining an executable name underneath. Zero-width
 * characters hide separators inside a word. Neither belongs in a market title,
 * and both are standard spoofing primitives, so they come out.
 *
 * Deliberately narrow: this removes seven specific code points and touches
 * nothing else, so Fenerbahçe, Ærø, 東京 and 🇺🇸 all survive intact. Over-broad
 * sanitising of international titles is its own bug.
 */
const DECEPTIVE_UNICODE = /[\u200B\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;

/** Longest text we will put in any single ICS property. */
export const MAX_TEXT_LENGTH = 300;
/** Longest DESCRIPTION, which is assembled from several fields. */
export const MAX_DESCRIPTION_LENGTH = 1200;

/**
 * Reduce untrusted upstream text to something safe to serialize.
 *
 * Every string that reaches an ICS property passes through here first. Titles,
 * outcome names and descriptions all originate in Polymarket's API, which means
 * they are attacker-influenced for our purposes: anyone who can create a market
 * can choose the text.
 */
export function sanitizeIcsText(value: string, maxLength = MAX_TEXT_LENGTH): string {
  const cleaned = value.replace(CONTROL_CHARS, "").replace(DECEPTIVE_UNICODE, "");
  if (cleaned.length <= maxLength) return cleaned;
  // Cut on a code point boundary; a lone surrogate would corrupt the UTF-8 the
  // folding step then measures.
  return `${Array.from(cleaned).slice(0, maxLength - 1).join("")}\u2026`;
}

/**
 * Escape a text value per RFC 5545 §3.3.11.
 *
 * Backslash first — otherwise the backslashes introduced by the later
 * replacements would themselves be escaped.
 *
 * Sanitising happens here rather than at the call sites, so a property added
 * later cannot forget it. This is the only function that may produce an ICS
 * TEXT value, and it is the reason a hostile title cannot terminate its own
 * property: CR and LF become the two-character sequence `\n`, so
 * `Match\r\nBEGIN:VALARM` serializes as one SUMMARY line, not as an alarm.
 */
export function escapeIcsText(value: string, maxLength = MAX_TEXT_LENGTH): string {
  return sanitizeIcsText(value, maxLength)
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/**
 * A value safe to place after a property name where escaping does not apply.
 *
 * UID, and the DATE/DATE-TIME forms, are not TEXT: RFC 5545 gives them their
 * own grammars and `\n` means nothing in them. So they cannot be escaped, only
 * constrained — anything outside the expected alphabet is dropped.
 *
 * This exists because it was exploitable. `UID:` was built as
 * `pmc-${event.id}@…` with the id coming straight from Gamma and no escaping at
 * all, so an id containing a CRLF injected whole properties into the VEVENT.
 * A fixture carrying `1\r\nATTACH:https://evil.test/x.exe` produced a real
 * ATTACH line in the generated calendar.
 */
export function safeToken(value: string, allowed = /[^A-Za-z0-9._@:+-]/g): string {
  return value.replace(CONTROL_CHARS, "").replace(allowed, "").slice(0, 128);
}

/**
 * Fold a content line to 75 octets per RFC 5545 §3.1.
 *
 * Folding counts octets, not characters, so the width is measured after UTF-8
 * encoding — a naive character count would emit over-long lines for any title
 * containing an accent, and Polymarket has plenty ("Fenerbahçe").
 */
export function foldIcsLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;

  const out: string[] = [];
  let current = "";
  let currentBytes = 0;
  // Continuation lines start with a space, which costs one of the 75 octets.
  let limit = 75;

  for (const char of line) {
    const size = encoder.encode(char).length;
    if (currentBytes + size > limit) {
      out.push(current);
      current = "";
      currentBytes = 0;
      limit = 74;
    }
    current += char;
    currentBytes += size;
  }
  if (current) out.push(current);

  return out.join(`${CRLF} `);
}

/**
 * `20260805T140000Z`, or `null` if the instant is not a real one.
 *
 * Returning `null` rather than throwing is the whole point. This used to build
 * a `Date` and call `.toISOString()` on it unguarded, so a single unparseable
 * `endDate` anywhere in the book threw `RangeError: Invalid time value` out of
 * the serializer and took the entire feed with it — a 500 for every subscriber
 * because one market had a bad date. Callers now skip the event instead.
 */
export function formatIcsUtc(iso: string): string | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

/**
 * `20260805` — the DATE form used by all-day events — or `null`.
 *
 * The shape is asserted rather than assumed. This used to be
 * `dayKey.replace(/-/g, "")`, which passes anything through: a `displayDate` of
 * `2026-08-20\r\nATTACH:x` became a DTSTART line followed by an injected
 * ATTACH property. DATE is a fixed grammar, so anything that is not eight
 * digits in a valid civil date is not a date.
 */
export function formatIcsDate(dayKey: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
  if (!match) return null;
  const [, y, m, d] = match;
  const month = Number(m);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${y}${m}${d}`;
}

/**
 * The day after `dayKey`; all-day DTEND is exclusive. `null` on a bad key.
 *
 * Computed in UTC deliberately. A civil date has no timezone, so running it
 * through the server's local zone is what makes an all-day event land a day
 * early for half the world — see the timezone regression tests.
 */
export function nextDay(dayKey: string): string | null {
  if (formatIcsDate(dayKey) === null) return null;
  const [y, m, d] = dayKey.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + 1));
  if (!Number.isFinite(date.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`;
}

/**
 * A UID that never changes for a given event.
 *
 * Derived only from the Polymarket event id, so a refreshed feed updates the
 * existing entry in the subscriber's calendar instead of adding a second copy.
 */
export function icsUid(event: Pick<CuratedCalendarEvent, "id">): string {
  /*
   * `safeToken`, not the raw id.
   *
   * UID is not a TEXT value, so RFC 5545 escaping does not apply to it and
   * `escapeIcsText` would be the wrong tool even if it were used. The id comes
   * from Gamma, and this line used to interpolate it directly: a fixture with
   * `id = "1\r\nATTACH:https://evil.test/x.exe"` produced a real ATTACH
   * property in the generated VEVENT — an upstream market choosing its own id
   * could put an attachment on a subscriber's phone.
   *
   * An empty result still yields a well-formed UID (`pmc-@domain`), which is
   * wrong but inert; ids are numeric in practice, so this only fires on input
   * that was already hostile.
   */
  return `pmc-${safeToken(String(event.id))}@${CALENDAR_DOMAIN}`;
}

/**
 * The epoch `SEQUENCE` counts from. Fixed forever — moving it would renumber
 * every event in every subscriber's calendar downwards, which is the one thing
 * a revision counter must never do.
 */
const SEQUENCE_EPOCH_MS = Date.UTC(2024, 0, 1);

/**
 * A revision number that increases when the event changes, without a database.
 *
 * RFC 5545 §3.8.7.4 wants `SEQUENCE` to climb with each revision the organizer
 * publishes, and clients use it to decide which copy of a UID is newer. The
 * obvious stateless implementation — hash the event's contents — satisfies
 * "changes when the event changes" and breaks the part that matters, because a
 * hash is as likely to go down as up and a client seeing a lower sequence is
 * entitled to ignore the update.
 *
 * Minutes since a fixed epoch, read off `lastModified`, satisfies both: it is
 * derived purely from the event so the same input always serializes identically,
 * and it is monotonic because time is. A 2026 event lands around 1.1 million,
 * comfortably inside the 32-bit range clients assume.
 *
 * Minutes rather than seconds because Gamma rewrites `updatedAt` on price
 * moves; a per-second counter would advertise a revision every few seconds to
 * every subscriber for a change no calendar entry reflects.
 */
export function icsSequence(
  event: Pick<CuratedCalendarEvent, "lastModified">,
): number {
  if (!event.lastModified) return 0;
  const ms = Date.parse(event.lastModified);
  if (!Number.isFinite(ms)) return 0;
  return Math.max(0, Math.floor((ms - SEQUENCE_EPOCH_MS) / 60_000));
}

export type IcsEventOptions = {
  /** Absolute base URL of this deployment, used for the back-link. */
  siteUrl?: string;
  /** Injected so output is deterministic in tests. */
  dtstamp?: string;
};

function buildDescription(
  event: CuratedCalendarEvent,
  siteUrl: string | undefined,
): string {
  const lines: string[] = [];
  lines.push(`Category: ${getCategoryMeta(event.category).label}`);
  if (event.probability !== undefined) {
    const pct = Math.round(event.probability * 100);
    lines.push(
      `Current probability: ${pct}%${event.leadingOutcome ? ` (${event.leadingOutcome})` : ""}`,
    );
  }
  lines.push(`Volume: $${Math.round(event.volume).toLocaleString("en-US")}`);
  if (event.relatedMarketsCount > 1) {
    lines.push(`Related markets: ${event.relatedMarketsCount}`);
  }
  if (event.dateConfidence === "estimated") {
    lines.push("Date is estimated — Polymarket's market and event dates disagree.");
  }
  lines.push("");
  /*
   * Only links that survive the allowlist reach a subscriber's calendar.
   *
   * The description is rendered as tappable text by Apple Calendar, so a
   * `javascript:` or lookalike-domain URL here is a phishing link on a lock
   * screen. `safeExternalUrl` returns null for anything that is not https on a
   * host we publish, and a missing line is better than a hostile one.
   */
  const marketUrl = safeExternalUrl(event.primaryMarketUrl);
  if (marketUrl) lines.push(`Open on Polymarket: ${marketUrl}`);
  const backLink = safeExternalUrl(siteUrl);
  if (backLink) lines.push(`View in Polymarket Calendar: ${backLink}`);
  lines.push("");
  lines.push("Independent calendar built on public Polymarket data.");
  lines.push("Not affiliated with or endorsed by Polymarket.");
  return lines.join("\n");
}

/**
 * The VEVENT block for one curated event, or `null` if the event cannot be
 * serialized safely.
 *
 * Declining is a feature. Everything reaching this function originates upstream,
 * and the honest response to a market whose dates do not parse is to leave it
 * out of the feed — not to emit `DTSTART:NaNNaNNaN`, and certainly not to throw
 * and fail the whole calendar for every other event in it.
 */
export function buildVEvent(
  event: CuratedCalendarEvent,
  options: IcsEventOptions = {},
): string[] | null {
  const dtstamp =
    formatIcsUtc(options.dtstamp ?? new Date().toISOString()) ??
    formatIcsUtc(new Date().toISOString())!;
  const lines: string[] = ["BEGIN:VEVENT"];

  lines.push(`UID:${icsUid(event)}`);
  lines.push(`DTSTAMP:${dtstamp}`);
  /*
   * The two properties that turn a re-published feed into an *update*.
   *
   * A stable UID is what stops a refresh adding a second copy, and that has
   * always been here. What was missing is any way for a client to tell that the
   * copy it already has is out of date: with no SEQUENCE and no LAST-MODIFIED,
   * a moved fixture is a UID it has seen before carrying a DTSTART it has no
   * particular reason to believe. Both are derived from Polymarket's own
   * `updatedAt`, so they only move when the event really has.
   */
  lines.push(`SEQUENCE:${icsSequence(event)}`);
  if (event.lastModified) {
    const lastModified = formatIcsUtc(event.lastModified);
    if (lastModified) lines.push(`LAST-MODIFIED:${lastModified}`);
  }

  if (event.isAllDay) {
    // An event with no reliable clock time is exported as all-day rather than
    // being pinned to an invented hour. DTEND is exclusive.
    const start = formatIcsDate(event.displayDate);
    const end = nextDay(event.displayDate);
    if (start === null || end === null) return null;
    lines.push(`DTSTART;VALUE=DATE:${start}`);
    lines.push(`DTEND;VALUE=DATE:${end}`);
  } else {
    const startMs = Date.parse(event.endDate);
    if (!Number.isFinite(startMs)) return null;
    const start = formatIcsUtc(event.endDate);
    const end = formatIcsUtc(new Date(startMs + 60 * 60 * 1000).toISOString());
    if (start === null || end === null) return null;
    lines.push(`DTSTART:${start}`);
    lines.push(`DTEND:${end}`);
  }

  lines.push(`SUMMARY:${escapeIcsText(event.title)}`);
  lines.push(
    `DESCRIPTION:${escapeIcsText(buildDescription(event, options.siteUrl), MAX_DESCRIPTION_LENGTH)}`,
  );
  /*
   * URL is a URI value, not TEXT, so it is allowlisted rather than escaped —
   * and omitted entirely when it fails. Escaping it as TEXT (which is what this
   * line used to do) is doubly wrong: it corrupts legitimate URLs by
   * backslash-escaping their commas and semicolons, and it implies a hostile
   * URL is something that can be made safe by quoting. It cannot; it can only
   * be refused.
   */
  const eventUrl = safeExternalUrl(event.primaryMarketUrl);
  if (eventUrl) lines.push(`URL:${eventUrl}`);
  // The label the UI uses, not a capitalised id: "eSports", not "Esports".
  lines.push(`CATEGORIES:${escapeIcsText(getCategoryMeta(event.category).label)}`);
  /*
   * CANCELLED is how a published feed retracts something.
   *
   * `METHOD:CANCEL` is an iTIP message sent to named attendees and means
   * nothing in a subscription; the documented route for a PUBLISH feed is to
   * keep publishing the UID with `STATUS:CANCELLED`, which Google and Apple
   * both honour by striking the entry. The alternative — dropping the event
   * from the feed — leaves it in every subscriber's calendar forever, because
   * absence is not a signal.
   *
   * The higher SEQUENCE that makes the retraction stick comes for free:
   * archiving an event rewrites its `updatedAt`, so the tombstone always
   * outranks the copy it replaces.
   */
  lines.push(
    `STATUS:${
      event.status === "cancelled"
        ? "CANCELLED"
        : event.status === "resolved" || event.status === "closed"
          ? "CONFIRMED"
          : "TENTATIVE"
    }`,
  );
  // Subscribed feeds should never ring an alarm on somebody's phone.
  lines.push("TRANSP:TRANSPARENT");
  /*
   * Outlook does not read TRANSP.
   *
   * It reads this Microsoft extension instead, and without it every entry in a
   * subscribed feed lands as *Busy* — a month of fixtures would black out the
   * subscriber's free/busy and make them look unavailable to their colleagues.
   * The two say the same thing; Outlook only listens to one of them.
   */
  lines.push("X-MICROSOFT-CDO-BUSYSTATUS:FREE");
  lines.push("END:VEVENT");

  return lines;
}

export type IcsCalendarOptions = IcsEventOptions & {
  /** Shown as the calendar's name in the subscriber's app. */
  name?: string;
  description?: string;
  /** How often clients are asked to refresh. */
  refreshInterval?: string;
};

/**
 * A complete VCALENDAR document.
 *
 * Lines are CRLF-terminated and folded at 75 octets, and the document ends with
 * a trailing CRLF — several clients reject a feed without one.
 */
export function buildIcsCalendar(
  events: CuratedCalendarEvent[],
  options: IcsCalendarOptions = {},
): string {
  const {
    name = "Polymarket Calendar",
    description = "Important events with Polymarket markets attached.",
    refreshInterval = "PT6H",
  } = options;

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${PRODID}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcsText(name)}`,
    `NAME:${escapeIcsText(name)}`,
    `X-WR-CALDESC:${escapeIcsText(description)}`,
    `DESCRIPTION:${escapeIcsText(description)}`,
    `REFRESH-INTERVAL;VALUE=DURATION:${refreshInterval}`,
    `X-PUBLISHED-TTL:${refreshInterval}`,
    "X-WR-TIMEZONE:America/New_York",
  ];

  // Sorted by UID so the same set of events always serializes identically.
  const ordered = [...events].sort((a, b) => icsUid(a).localeCompare(icsUid(b)));
  for (const event of ordered) {
    const vevent = buildVEvent(event, options);
    if (vevent) lines.push(...vevent);
  }

  lines.push("END:VCALENDAR");

  return lines.map(foldIcsLine).join(CRLF) + CRLF;
}

/** A single-event .ics file, for the "Add to Apple Calendar" download. */
export function buildSingleEventIcs(
  event: CuratedCalendarEvent,
  options: IcsEventOptions = {},
): string {
  return buildIcsCalendar([event], { ...options, name: event.title });
}
