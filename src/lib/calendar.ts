import {
  addDays,
  differenceInCalendarDays,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { toDayKey } from "./dates";
import type { CalendarView } from "./url-state";

/** Weeks start on Sunday, matching Google Calendar's US default. */
export const WEEK_STARTS_ON = 0 as const;

export const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const WEEKDAY_LABELS_SHORT = ["S", "M", "T", "W", "T", "F", "S"];

/**
 * The date window a view needs loaded.
 *
 * A month grid shows leading/trailing days from the neighbouring months, so the
 * fetch window is the full grid, not the calendar month — otherwise the first and
 * last rows would render permanently empty.
 */
export function getViewRange(view: CalendarView, anchor: Date): { start: Date; end: Date } {
  if (view === "week") {
    const start = startOfDay(startOfWeek(anchor, { weekStartsOn: WEEK_STARTS_ON }));
    return { start, end: addDays(start, 7) };
  }

  // Month and agenda share a window so switching between them never drops
  // events or triggers a refetch — the filters and data stay put.
  const start = startOfDay(startOfWeek(startOfMonth(anchor), { weekStartsOn: WEEK_STARTS_ON }));
  const lastRenderedDay = startOfDay(endOfWeek(endOfMonth(anchor), { weekStartsOn: WEEK_STARTS_ON }));
  // Exclusive end: midnight following the last day the grid renders.
  return { start, end: addDays(lastRenderedDay, 1) };
}

/** Every day in the month grid, always whole weeks (35 or 42 cells). */
export function getMonthGridDays(anchor: Date): Date[] {
  const { start, end } = getViewRange("month", anchor);
  return eachDayOfInterval({ start, end: addDays(end, -1) });
}

/** The seven days of the week containing `anchor`. */
export function getWeekDays(anchor: Date): Date[] {
  const start = startOfWeek(anchor, { weekStartsOn: WEEK_STARTS_ON });
  return eachDayOfInterval({ start, end: addDays(start, 6) });
}

/** Split a flat day list into rows of seven. */
export function chunkIntoWeeks(days: Date[]): Date[][] {
  const weeks: Date[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  return weeks;
}

/** Days offset from today, in market time; negative means past. */
export function daysFromToday(dayKey: string, now: Date = new Date()): number {
  const todayParts = toDayKey(now).split("-").map(Number);
  const parts = dayKey.split("-").map(Number);
  if (parts.length !== 3 || todayParts.length !== 3) return 0;
  const target = new Date(parts[0], parts[1] - 1, parts[2]);
  const today = new Date(todayParts[0], todayParts[1] - 1, todayParts[2]);
  return differenceInCalendarDays(target, today);
}

/**
 * How many event chips fit in a month cell at a given breakpoint.
 * Mobile month cells show density rather than content — there is no room for
 * a readable title at that width.
 */
export const EVENTS_PER_CELL = {
  mobile: 1,
  tablet: 3,
  desktop: 4,
} as const;
