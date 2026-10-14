/**
 * "Has this already happened?" — the one question the calendar asks of the
 * clock rather than of the data.
 */

import type { CuratedCalendarEvent } from "./curation/types";
import { FALLBACK_TIME_ZONE, zonedDayKey } from "./timezone";

/** A moment plus the day it falls on *for this viewer*. */
export type NowSnapshot = {
  ms: number;
  /** `YYYY-MM-DD` in the viewer's own timezone. */
  dayKey: string;
};

export function nowSnapshot(
  now: Date = new Date(),
  zone: string = FALLBACK_TIME_ZONE,
): NowSnapshot {
  return { ms: now.getTime(), dayKey: zonedDayKey(now, zone) };
}

/** The fields `isEventPast` actually reads — kept narrow so tests stay small. */
export type TimedLike = Pick<
  CuratedCalendarEvent,
  "endDate" | "displayDate" | "isAllDay"
>;

/**
 * Whether an event's moment has gone by.
 *
 * Timed events are compared against their real instant, so a 13:00 fixture is
 * past at 15:30. All-day events have no clock time — Polymarket wrote a
 * placeholder and the curation layer refused to invent an hour from it — so
 * they stay current until their whole day is over. Expiring them at whatever
 * the placeholder happens to decode to would fade a day's headline event at
 * breakfast.
 *
 * `now` is null until the clock has been read in the browser, which keeps the
 * server-rendered markup and the hydrated markup identical.
 */
export function isEventPast(event: TimedLike, now: NowSnapshot | null): boolean {
  if (!now) return false;
  if (event.isAllDay) return event.displayDate < now.dayKey;

  const end = Date.parse(event.endDate);
  // An unparseable instant still has a day key; fall back to that rather than
  // treating the event as permanently upcoming.
  if (!Number.isFinite(end)) return event.displayDate < now.dayKey;
  return end < now.ms;
}
