"use client";

import { Star } from "lucide-react";
import Image from "next/image";
import * as React from "react";
import { useNow, useTodayKey } from "@/hooks/use-now";
import { useTimeZone } from "@/hooks/use-time-zone";
import { getCategoryMeta } from "@/lib/categories";
import type { CuratedCalendarEvent } from "@/lib/curation/types";
import { emphasisOf } from "@/lib/emphasis";
import { isEventPast } from "@/lib/event-time";
import { formatCompactUsd } from "@/lib/format";
import { probabilityDescription, probabilityDisplay } from "@/lib/probability";
import { zonedMinutes } from "@/lib/timezone";
import { cn } from "@/lib/utils";

export type DayScheduleProps = {
  /** `YYYY-MM-DD`. Decides whether the now-marker belongs on this day. */
  dayKey: string;
  events: CuratedCalendarEvent[];
  onSelectEvent: (event: CuratedCalendarEvent) => void;
  /** Classes for the board, so a dialog can cap its height. */
  className?: string;
};

/**
 * One column per hour, side by side, each running top to bottom.
 *
 * Time goes across; events inside an hour go down. An hour with nothing in it
 * has no column at all, so the board is exactly as wide as the day is busy —
 * a quiet Tuesday is three columns, a tournament day is fifteen, and the width
 * itself is the first thing the reader learns.
 *
 * This is deliberately not a proportional timeline. Polymarket gives these
 * events a start and no duration, so there is nothing to size a block against;
 * a column per occupied hour spends the space on titles and artwork instead of
 * on empty gutter between fixtures.
 *
 * **It never scrolls sideways.** The columns used to be a fixed 256px in a
 * horizontal scroller, which left two problems at once: a quiet day was three
 * columns and a wide empty band beside them, and a busy one was a scrollbar
 * along the bottom of the "+N more" dialog that hid half the evening off to the
 * right. Now each column is at least `MIN_COLUMN` wide and they share the width
 * between them — a quiet day fills the space, and a day with more hours than
 * fit wraps them onto the next row, read left to right and then down, the way
 * text is. The only scrolling is vertical.
 */
const MIN_COLUMN = 210;
const GRID_STYLE: React.CSSProperties = {
  gridTemplateColumns: `repeat(auto-fit, minmax(${MIN_COLUMN}px, 1fr))`,
  paddingBottom: "env(safe-area-inset-bottom)",
};

export function DaySchedule({
  dayKey,
  events,
  onSelectEvent,
  className,
}: DayScheduleProps) {
  const today = useTodayKey();
  const zone = useTimeZone();
  const scrollRef = React.useRef<HTMLDivElement>(null);

  const { columns, allDay } = React.useMemo(() => groupByHour(events), [events]);

  /*
   * The reader's own wall clock, and only ever the reader's.
   *
   * `null` until the browser has reported it: the server cannot know the
   * viewer's minute, and rendering a guess is a hydration error waiting on the
   * next minute boundary.
   */
  const [nowMinutes, setNowMinutes] = React.useState<number | null>(null);
  React.useEffect(() => {
    const update = () => setNowMinutes(zonedMinutes(Date.now(), zone));
    update();
    const id = window.setInterval(update, 60_000);
    return () => window.clearInterval(id);
  }, [zone]);

  const isToday = dayKey === today;
  const nowHour = nowMinutes === null ? null : Math.floor(nowMinutes / 60);

  /*
   * Open where the day is now.
   *
   * On a tournament day the current hour can sit on the second or third row of
   * columns — below the fold, with the reader looking at fixtures that finished
   * this morning. Today opens on the row holding the nearest column at or after
   * the current hour; any other day opens at the top, which is its first hour.
   */
  const scrolledFor = React.useRef<string | null>(null);
  React.useEffect(() => {
    const root = scrollRef.current;
    if (!root || !isToday || scrolledFor.current === dayKey) return;
    // The clock arrives from an effect, so the first render cannot know it.
    if (nowHour === null) return;
    const target =
      columns.find((c) => c.hour >= nowHour)?.hour ??
      columns[columns.length - 1]?.hour;
    if (target === undefined) return;
    const column = root.querySelector<HTMLElement>(`[data-hour="${target}"]`);
    if (!column) return;
    // Measured rather than `offsetTop`: the offset parent is whichever
    // ancestor happens to be positioned, which inside the month dialog is the
    // dialog itself, not this scroller.
    root.scrollTop += column.getBoundingClientRect().top - root.getBoundingClientRect().top;
    scrolledFor.current = dayKey;
  }, [dayKey, isToday, nowHour, columns]);

  return (
    <div
      ref={scrollRef}
      data-day-schedule
      data-day-board
      className={cn(
        "grid min-h-0 content-start overflow-y-auto overflow-x-hidden overscroll-contain scrollbar-slim",
        className,
      )}
      style={GRID_STYLE}
    >
      {columns.map(({ hour, events: hourEvents }) => {
        const current = isToday && hour === nowHour;
        return (
          <section
            key={hour}
            data-hour={hour}
            data-hour-current={current ? "true" : undefined}
            aria-label={`${hourLabel(hour)}, ${hourEvents.length} event${hourEvents.length === 1 ? "" : "s"}`}
            className={cn(
              "flex min-w-0 flex-col border-b border-r border-border",
              current && "bg-accent-soft/10",
            )}
          >
            {/* The hour, pinned to the top of its own column so it survives a
                column tall enough to scroll past it. */}
            <header
              className={cn(
                "sticky top-0 z-10 flex shrink-0 items-center gap-1.5 border-b border-border bg-surface px-2.5 py-1.5",
                current && "bg-accent-soft/20",
              )}
            >
              {current && (
                <span
                  className="size-1.5 shrink-0 rounded-full bg-accent"
                  aria-label="Current hour"
                />
              )}
              <span
                className={cn(
                  "text-[12px] tabular-nums",
                  current ? "font-semibold text-accent" : "font-medium text-foreground",
                )}
              >
                {hourLabel(hour)}
              </span>
              <span className="ml-auto text-[11px] tabular-nums text-subtle-foreground">
                {hourEvents.length}
              </span>
            </header>

            <ul className="flex min-h-0 flex-col gap-1.5 p-1.5">
              {hourEvents.map((event) => (
                <li key={event.id}>
                  <EventCard event={event} onSelect={onSelectEvent} />
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      {/*
        The all-day column, last and on its own.

        These events have no kickoff — Polymarket gives them none, and the
        calendar shows the day's trading deadline instead, which is 23:59 for
        every one of them. Dropping them into a 23:00 column would invent a
        late-night spike out of markets that are merely undated, so they get a
        column that says what they are and sits at the end of the day, after
        the last hour that has anything in it.
      */}
      {allDay.length > 0 && (
        <section
          data-allday-column
          aria-label="Closing at the end of the day"
          className="flex min-w-0 flex-col border-b border-r border-border bg-surface-sunken/40"
        >
          <header className="sticky top-0 z-10 flex shrink-0 items-center gap-1.5 border-b border-border bg-surface-sunken px-2.5 py-1.5">
            <span className="text-[12px] font-medium uppercase tracking-wide text-muted-foreground">
              All day
            </span>
            <span className="ml-auto text-[11px] tabular-nums text-subtle-foreground">
              {allDay.length}
            </span>
          </header>
          <ul className="flex min-h-0 flex-col gap-1.5 p-1.5">
            {allDay.map((event) => (
              <li key={event.id}>
                <EventCard event={event} onSelect={onSelectEvent} hideTime />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/* -------------------------------------------------------------- grouping */

type HourColumn = { hour: number; events: CuratedCalendarEvent[] };

/**
 * `HH:mm` -> hour, or `null` for anything that is not one.
 *
 * `time` is documented as always present, but it arrives from the wire, and an
 * event that cannot be placed on the clock must not land in hour 0 and claim
 * to be a midnight fixture. Unplaceable events join the all-day column, which
 * says only that they belong to the day.
 */
function hourOf(time: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) return null;
  const hour = Number(match[1]);
  return hour >= 0 && hour <= 23 ? hour : null;
}

function minuteOf(time: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  return match ? Number(match[2]) : 0;
}

function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

function groupByHour(events: CuratedCalendarEvent[]): {
  columns: HourColumn[];
  allDay: CuratedCalendarEvent[];
} {
  const byHour = new Map<number, CuratedCalendarEvent[]>();
  const allDay: CuratedCalendarEvent[] = [];

  for (const event of events) {
    // `isAllDay` and `timeKind: "close"` are set together by the curation
    // layer; either one alone is enough to keep an event off the clock.
    const hour = event.isAllDay || event.timeKind === "close" ? null : hourOf(event.time);
    if (hour === null) {
      allDay.push(event);
      continue;
    }
    const bucket = byHour.get(hour);
    if (bucket) bucket.push(event);
    else byHour.set(hour, [event]);
  }

  const columns = [...byHour.entries()]
    .sort(([a], [b]) => a - b)
    .map(([hour, list]) => ({
      hour,
      // Chronological within the column. Importance earns a bigger card, not
      // an earlier slot — reordering the clock to flatter a market would make
      // the column unreadable as a timetable.
      events: [...list].sort((a, b) => minuteOf(a.time) - minuteOf(b.time)),
    }));

  // Nothing about the all-day column is chronological, so volume is the only
  // ordering that tells the reader anything.
  allDay.sort((a, b) => b.importanceScore - a.importanceScore);

  return { columns, allDay };
}

/* ----------------------------------------------------------------- cards */

/**
 * One event, as a card in its hour's column.
 *
 * Two sizes, decided by the same `importanceLevel` the rest of the calendar
 * reads: a featured card gets 40px of the market's own artwork and the title
 * at 14px, because the artwork is a faster identifier than the name. Standard
 * cards stay small, so a fifteen-fixture hour is still one column and the
 * emphasis means something — if every card is large, none of them is.
 */
const EventCard = React.memo(function EventCard({
  event,
  onSelect,
  hideTime = false,
}: {
  event: CuratedCalendarEvent;
  onSelect: (event: CuratedCalendarEvent) => void;
  hideTime?: boolean;
}) {
  const category = getCategoryMeta(event.category);
  const isPast = isEventPast(event, useNow());
  const probability = probabilityDisplay(event);
  const emphasis = emphasisOf(event);
  const featured = emphasis !== null;

  const minutes = minuteOf(event.time);
  // The column header already said the hour. Repeating "14:00" on every card
  // is noise; a kickoff at 14:30 is not, and that is the only case this prints.
  const offset = !hideTime && minutes !== 0 ? event.time : null;

  return (
    <button
      type="button"
      onClick={() => onSelect(event)}
      data-event-title={event.title}
      data-event-category={event.category}
      data-event-importance={event.importanceLevel}
      data-event-past={isPast ? "true" : "false"}
      data-event-status={event.status}
      data-event-time={event.time}
      data-event-featured={featured ? "true" : "false"}
      className={cn(
        "flex w-full flex-col gap-1 rounded-md border border-border bg-surface p-2 text-left",
        "transition-colors motion-safe:duration-(--dur-quick) hover:bg-surface-hover active:bg-surface-hover",
        isPast && "is-past",
      )}
    >
      <span className="flex min-w-0 items-start gap-2">
        {event.image ? (
          <Image
            src={event.image}
            alt=""
            width={featured ? 40 : 24}
            height={featured ? 40 : 24}
            sizes={featured ? "40px" : "24px"}
            className={cn(
              "shrink-0 rounded object-cover",
              featured ? "size-10" : "mt-px size-6",
            )}
          />
        ) : (
          <span
            className={cn(
              "shrink-0 rounded opacity-70",
              featured ? "size-10" : "mt-px size-6",
              category.dot,
            )}
            aria-hidden
          />
        )}

        <span className="flex min-w-0 flex-1 items-start gap-1">
          {event.importanceLevel === "major" && (
            <Star
              className="mt-[3px] size-3 shrink-0 fill-current text-accent"
              strokeWidth={0}
              aria-hidden
            />
          )}
          <span
            className={cn(
              "min-w-0 font-medium text-foreground",
              featured
                ? "line-clamp-3 text-[14px] leading-[1.3]"
                : "line-clamp-2 text-[12.5px] leading-[1.3]",
            )}
          >
            {event.title}
          </span>
        </span>
      </span>

      {/* One meta line under the title, ordered by how much it tells you. The
          category's colour leads it as a dot, which is the only place a card
          this narrow has room for it. */}
      <span className="flex min-w-0 items-center gap-1.5">
        <span className={cn("size-1.5 shrink-0 rounded-full", category.dot)} aria-hidden />
        <span className="truncate text-[11px] leading-tight text-muted-foreground">
          {offset ? `${offset} · ` : ""}
          {emphasis ? `${emphasis.label} · ` : ""}
          {category.label}
          {` · ${formatCompactUsd(event.volume)}`}
        </span>
        {probability ? (
          <span
            className="ml-auto shrink-0 text-[12px] font-medium tabular-nums text-muted-foreground"
            title={probabilityDescription(probability)}
          >
            {probability.percent}
          </span>
        ) : (
          <span className="ml-auto shrink-0 text-[10px] capitalize text-subtle-foreground">
            {event.status === "resolved"
              ? "Resolved"
              : event.status === "closed"
                ? "Closed"
                : ""}
          </span>
        )}
      </span>
    </button>
  );
});
