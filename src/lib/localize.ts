import type { CuratedCalendarEvent } from "./curation/types";
import { zonedDayKey, zonedTime } from "./timezone";

/**
 * Move a dataset into the viewer's timezone.
 *
 * The server sends absolute instants. `endDate` is the canonical time of a
 * timed event and the only field that means anything without a zone attached;
 * `displayDate` and `time` as they arrive are the server's own reading of it,
 * in Polymarket's operating timezone, and are correct for nobody but a reader
 * in New York.
 *
 * This recomputes both from the instant, once per dataset, so every component
 * downstream keeps reading `event.displayDate` and `event.time` exactly as
 * before and every one of them agrees. A month grid, a week column, an agenda
 * heading and a hover card cannot disagree about an event, because there is one
 * pass and one answer.
 *
 * **The day can move.** `2026-08-11T00:30:00Z` is the 11th in London and the
 * 10th in Chicago, so this is not a relabelling of the clock face — the event
 * changes which cell it belongs to, and the grouping downstream follows it.
 *
 * **All-day events are left alone.** They are civil dates, not instants: a
 * placeholder timestamp means "some time that day", and converting it is how an
 * election ends up filed a day early. `2026-08-10` is the 10th everywhere.
 */

type Cached = { zone: string; events: CuratedCalendarEvent[] };

/*
 * Keyed on the dataset array itself. A month is fetched once and its identity
 * is stable, so switching view, stepping to a cached month or clicking a day
 * all reuse this — which is what keeps `byDay` and every `React.memo` below it
 * intact. A WeakMap so a month that ages out takes its localized copy with it.
 */
const cache = new WeakMap<CuratedCalendarEvent[], Cached>();

export function localizeEvent(
  event: CuratedCalendarEvent,
  zone: string,
): CuratedCalendarEvent {
  if (event.isAllDay) return event;

  const displayDate = zonedDayKey(event.endDate, zone);
  const time = zonedTime(event.endDate, zone);
  // An unreadable instant keeps whatever the server decided rather than
  // becoming an event with no date at all.
  if (!displayDate || !time) return event;
  if (displayDate === event.displayDate && time === event.time && event.timezone === zone) {
    return event;
  }

  return { ...event, displayDate, time, timezone: zone };
}

export function localizeEvents(
  events: CuratedCalendarEvent[],
  zone: string,
): CuratedCalendarEvent[] {
  const cached = cache.get(events);
  if (cached && cached.zone === zone) return cached.events;

  let changed = false;
  const localized = events.map((event) => {
    const next = localizeEvent(event, zone);
    if (next !== event) changed = true;
    return next;
  });

  // Identity matters more than the allocation: handing back the same array when
  // nothing moved lets every downstream memo hold.
  const result = changed ? localized : events;
  cache.set(events, { zone, events: result });
  return result;
}
