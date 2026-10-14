import type { CuratedCalendarEvent } from "../curation/types";
import { formatIcsDate, nextDay, sanitizeIcsText } from "./ics";
import { safeExternalUrl } from "./safe-url";
import { toWebcalUrl } from "./google";

/**
 * Outlook links.
 *
 * Outlook is two products behind one name, and the difference is not cosmetic:
 * a personal Microsoft account lives on `outlook.live.com` and a work or school
 * account on `outlook.office.com`. A link to the wrong one does not fall back —
 * it lands the visitor on a sign-in page for an account they do not have. So
 * every builder here takes the account kind, and the UI offers both rather than
 * guessing.
 */

export type OutlookAccount = "personal" | "work";

const HOST: Record<OutlookAccount, string> = {
  personal: "https://outlook.live.com",
  work: "https://outlook.office.com",
};

export const OUTLOOK_ACCOUNTS: ReadonlyArray<{
  value: OutlookAccount;
  label: string;
  hint: string;
}> = [
  { value: "personal", label: "Outlook.com", hint: "Personal Microsoft account" },
  { value: "work", label: "Microsoft 365", hint: "Work or school account" },
];

/**
 * Subscribe to the feed in Outlook on the web.
 *
 * `addfromweb` is not in Microsoft's published documentation — it is the route
 * Outlook's own "Add calendar → Subscribe from web" screen uses, and the one
 * every calendar service links to. It is therefore offered as a shortcut, never
 * as the only way in: the dialog shows the feed URL beside it, because pasting
 * that into that same screen is the path that cannot break.
 *
 * The feed goes in as `webcal://`, matching the form the working examples use.
 * Outlook accepts `https://` in the field you type into, but this parameter is
 * undocumented and there is no reason to differ from what is known to work.
 */
export function buildOutlookSubscribeUrl(
  feedUrl: string,
  account: OutlookAccount,
  name = "Polymarket Calendar",
): string {
  const params = new URLSearchParams({ url: toWebcalUrl(feedUrl), name });
  return `${HOST[account]}/calendar/0/addfromweb?${params.toString()}`;
}

/** `2026-08-05T18:10:00Z`, the shape the compose deep link wants. */
function outlookInstant(iso: string): string {
  return new Date(iso).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** `2026-08-05`, for an all-day event. */
function outlookDate(dayKey: string): string {
  return dayKey;
}

/** `20260806` -> `2026-08-06`. */
function hyphenate(compact: string): string {
  return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
}

function buildBody(event: CuratedCalendarEvent, siteUrl?: string): string {
  const parts: string[] = [];
  parts.push(`Category: ${event.category.charAt(0).toUpperCase()}${event.category.slice(1)}`);
  if (event.probability !== undefined && event.probability !== null) {
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
  return parts.join("\n");
}

/**
 * Add one event to Outlook.
 *
 * Unlike the subscribe route above, this one *is* documented, and it is the
 * counterpart of the Google template link the details panel already offers.
 * All-day events use a plain date and an exclusive end, the same convention the
 * ICS export and the Google link use, so one event never lands on two days in
 * one client and one in another.
 */
export function buildOutlookEventUrl(
  event: CuratedCalendarEvent,
  account: OutlookAccount = "personal",
  options: { siteUrl?: string } = {},
): string {
  const allday = event.isAllDay;
  /*
   * `nextDay` can now decline a malformed civil date rather than producing
   * nonsense, so the all-day end falls back to the start day. Outlook treats a
   * same-day range as a single all-day event, which is the right degradation:
   * an event on the correct day beats an event on `NaN`.
   */
  const endDay = nextDay(event.displayDate);
  const params = new URLSearchParams({
    path: "/calendar/action/compose",
    rru: "addevent",
    // Sanitised, not merely encoded. `URLSearchParams` already stops hostile
    // text from creating a second parameter; this stops it from carrying
    // control characters or bidi overrides into someone's calendar.
    subject: sanitizeIcsText(event.title),
    startdt: allday ? outlookDate(event.displayDate) : outlookInstant(event.endDate),
    enddt: allday
      ? hyphenate(endDay ?? formatIcsDate(event.displayDate) ?? "")
      : outlookInstant(new Date(Date.parse(event.endDate) + 3_600_000).toISOString()),
    body: buildBody(event, options.siteUrl),
    // Allowlisted: the location field is rendered as a link by Outlook.
    location: safeExternalUrl(event.primaryMarketUrl) ?? "",
  });
  if (allday) params.set("allday", "true");
  return `${HOST[account]}/calendar/deeplink/compose?${params.toString()}`;
}
