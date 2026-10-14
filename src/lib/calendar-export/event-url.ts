import type { CuratedCalendarEvent } from "@/lib/curation/types";

/**
 * Where a single event's `.ics` lives.
 *
 * A path rather than a blob, because iOS Safari will not open a `blob:` or
 * `data:` URL in Calendar — see `app/api/calendar/event/[id]/route.ts`. Kept in
 * one place so the route and every caller cannot drift apart.
 */

/**
 * Prefer the slug: it survives in a Downloads list and reads as a name, and the
 * route accepts either. No date or range travels with it — the route looks the
 * event up from Gamma by this key alone, so the link stays short, stable and
 * shareable, and keeps working after the event has moved months.
 */
export function eventIcsPath(event: Pick<CuratedCalendarEvent, "id" | "slug">): string {
  return `/api/calendar/event/${encodeURIComponent(event.slug || event.id)}.ics`;
}

/**
 * The same path as an absolute URL.
 *
 * `webcal:` and Google's `cid=` parameter both need one, and so does anything
 * the reader might paste somewhere else.
 */
export function eventIcsUrl(
  event: Pick<CuratedCalendarEvent, "id" | "slug">,
  origin: string,
): string {
  return `${origin.replace(/\/+$/, "")}${eventIcsPath(event)}`;
}
