"use client";

import { format } from "date-fns";
import * as React from "react";
import { weekDays } from "@/hooks/use-calendar";
import { WEEKDAY_LABELS } from "@/lib/calendar";
import type { CuratedCalendarEvent } from "@/lib/curation/types";
import { useTodayKey } from "@/hooks/use-now";
import { useTimeZone } from "@/hooks/use-time-zone";
import { toDateKey } from "@/lib/dates";
import { zonedMinutes } from "@/lib/timezone";
import { cn } from "@/lib/utils";
import { EventChip } from "./event-chip";

export type WeekViewProps = {
  anchor: Date;
  eventsByDay: Record<string, CuratedCalendarEvent[]>;
  selectedDate: string | null;
  onSelectDay: (dayKey: string) => void;
  onSelectEvent: (event: CuratedCalendarEvent) => void;
  /** Opens the day popover, the same escape hatch the month grid uses. */
  onShowMore: (dayKey: string) => void;
};

const EMPTY: CuratedCalendarEvent[] = [];

/*
 * The timeline is the whole local day, 00:00 through 23:59.
 *
 * It used to begin at 06:00, which was not a display window over a full day —
 * it was the origin of the coordinate system. `offsetFor` measured from
 * `FIRST_HOUR * 60`, so anything before it clamped to offset 0: a 00:30 match
 * and a 06:00 match were drawn on the same pixel, at the very top, and four
 * of the CS2 fixtures in an Asian evening slot stacked into one illegible pile
 * there. Nothing was scrolled out of view; the hours simply did not exist.
 *
 * Because every position is derived from these two constants rather than
 * written down anywhere, moving the origin to midnight is the whole fix: the
 * hour rows, the chip offsets, the now-line and the opening scroll all follow.
 */
export const FIRST_HOUR = 0;
export const LAST_HOUR = 23;
export const HOUR_HEIGHT = 48;
export const HOURS = Array.from({ length: LAST_HOUR - FIRST_HOUR + 1 }, (_, i) => FIRST_HOUR + i);

/**
 * All-day entries a column shows before collapsing into "+N more".
 *
 * The band grows to fit whatever it is given, so a primary-season day — 7
 * August carried a dozen — pushed the hour grid off the bottom of the screen
 * and left the week unreadable. Three keeps the band a fixed, predictable
 * height.
 */
const MAX_ALL_DAY = 3;

/**
 * One day column, in all three rows that have to agree about where a day is.
 *
 * Below `md` a day is a fixed 132px inside a horizontal scroller rather than a
 * seventh of the viewport. Seven columns in 390px is 47px each, and 47px of
 * chip after its padding and category dot is about four characters — so the
 * titles were not merely tight, their fixed-width parts (the probability and
 * the volume, neither of which can shrink) added up to more than the column and
 * spilled out of it. The measured content width of a week chip is ~149px
 * against ~83px of available space, and the excess was landing on the next day.
 *
 * 132px shows two and a half days at 390px, which is the readable unit for a
 * timeline you swipe through, and the full week is still one flick away. At
 * `md` and up the original behaviour returns: seven equal columns filling the
 * width, no horizontal scroll.
 *
 * `max-md:` / `md:` rather than `shrink-0` plus `md:flex-1` — those two set the
 * same longhand from different shorthands, and which one wins is a question
 * about stylesheet order rather than about intent.
 */
const DAY_COLUMN = "max-md:w-[132px] max-md:shrink-0 max-md:snap-start md:min-w-0 md:flex-1";

/**
 * The hour labels, pinned to the left edge while the days scroll past.
 *
 * A timeline you scroll sideways is unreadable without its axis: two days in,
 * every chip is at an unknown time. Sticky costs nothing on desktop, where
 * there is no horizontal scrolling to stick against.
 */
const TIME_GUTTER = "w-14 shrink-0 border-r border-border bg-surface max-md:sticky max-md:left-0 max-md:z-20";

/** 56px of gutter plus seven 132px columns. */
const MOBILE_GRID_WIDTH = "max-md:min-w-[980px]";



/**
 * Offset in pixels from the top of the hour grid, to the minute.
 *
 * Exported for the timeline tests: the origin of this coordinate system is the
 * thing that was wrong, and it is worth pinning down in a unit test rather than
 * only in a browser.
 */
export function offsetFor(time: string | undefined): number {
  if (!time) return 0;
  const [h, m] = time.split(":").map(Number);
  if (!Number.isFinite(h)) return 0;
  const minutes = h * 60 + (Number.isFinite(m) ? m : 0);
  const clamped = Math.min(LAST_HOUR * 60 + 59, Math.max(FIRST_HOUR * 60, minutes));
  return ((clamped - FIRST_HOUR * 60) / 60) * HOUR_HEIGHT;
}

/** Rendered height of one chip in the grid, plus the gap beneath it. */
const CHIP_STEP = 22;
/** Chips a single cluster shows before collapsing into "+N more". */
const MAX_PER_CLUSTER = 2;

type Placed = {
  top: number;
  events: CuratedCalendarEvent[];
};

/**
 * Group events that would land on top of each other, and stack them.
 *
 * Positions used to come from the hour alone, so everything sharing an hour got
 * an identical `top` and rendered as one illegible pile — six macro releases at
 * the same minute, drawn over each other.
 *
 * These events are moments, not spans: Polymarket gives a start, never a
 * duration. So there is nothing to lay out side by side in the Google Calendar
 * sense, and splitting a ~160px column into six lanes would leave nothing
 * readable in any of them. Colliding events stack downwards instead, and the
 * cluster is capped so a busy slot can never push into the next hour by more
 * than a chip.
 */
function placeEvents(events: CuratedCalendarEvent[]): Placed[] {
  const sorted = [...events].sort(
    (a, b) =>
      offsetFor(a.time) - offsetFor(b.time) ||
      b.importanceScore - a.importanceScore ||
      a.id.localeCompare(b.id),
  );

  const clusters: Placed[] = [];
  for (const event of sorted) {
    const top = offsetFor(event.time);
    const last = clusters[clusters.length - 1];
    // Would this chip overlap the last one drawn in the open cluster?
    const lastBottom = last
      ? last.top + Math.min(last.events.length, MAX_PER_CLUSTER + 1) * CHIP_STEP
      : -Infinity;
    if (last && top < lastBottom) last.events.push(event);
    else clusters.push({ top, events: [event] });
  }
  return clusters;
}

/**
 * A real week view: an all-day band above a scrollable hour grid.
 *
 * Events whose timestamp was a Polymarket placeholder are flagged `isAllDay` by
 * the data layer and land in the band — the grid never invents a clock time for
 * them.
 */
function WeekViewInner({
  anchor,
  eventsByDay,
  selectedDate,
  onSelectDay,
  onSelectEvent,
  onShowMore,
}: WeekViewProps) {
  const days = React.useMemo(() => weekDays(anchor), [anchor]);
  const today = useTodayKey();
  const zone = useTimeZone();
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const headerRef = React.useRef<HTMLDivElement>(null);

  /*
   * The now-line sits at the viewer's own wall clock.
   *
   * It used to be drawn in Polymarket's operating timezone, so a reader in
   * Sofia watched a line seven hours behind their afternoon — and the chips it
   * was supposed to sit among were in that timezone too, so the whole grid was
   * internally consistent and wrong. Both are the viewer's now.
   */
  const [nowMinutes, setNowMinutes] = React.useState<number | null>(null);
  React.useEffect(() => {
    const update = () => setNowMinutes(zonedMinutes(Date.now(), zone));
    update();
    const id = window.setInterval(update, 60_000);
    return () => window.clearInterval(id);
  }, [zone]);

  /*
   * The week opens at the top of the day, which is now midnight.
   *
   * It used to scroll to 08:00 on mount — reasonable when the grid began at
   * 06:00 and that was only two hours of empty gutter. Against a midnight
   * origin the same scroll hides eight hours, and the row directly under the
   * all-day band reads 08:00, which is the exact thing that made the old grid
   * look like it started at 06:00. A timeline that claims to be the whole day
   * should show the whole day's beginning when you open it.
   *
   * Nothing is lost: the now-line still marks the current hour, and a week of
   * fixtures is a scroll away rather than a guess.
   */

  const weekHasToday = days.some((d) => toDateKey(d) === today);
  const indicatorTop =
    nowMinutes === null
      ? null
      : ((Math.min(LAST_HOUR * 60 + 59, Math.max(FIRST_HOUR * 60, nowMinutes)) -
          FIRST_HOUR * 60) /
          60) *
        HOUR_HEIGHT;

  /*
   * The whole week's layout, computed once per dataset rather than per render.
   *
   * `placeEvents` is the most expensive thing in this view — measured at ~190µs
   * across seven columns, more than filtering and grouping the entire month put
   * together, because `offsetFor` splits and re-parses a `HH:MM` string twice
   * per sort comparison. It was running in the render body, so it re-ran when a
   * day was selected, when a dialog opened, on every tick of the now-indicator's
   * minute timer. None of those change where a chip sits.
   */
  const byDay = React.useMemo(
    () =>
      days.map((date) => {
        const key = toDateKey(date);
        const all = eventsByDay[key] ?? EMPTY;
        return {
          date,
          key,
          allDay: all.filter((e) => e.isAllDay),
          clusters: placeEvents(all.filter((e) => !e.isAllDay)),
        };
      }),
    [days, eventsByDay],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-surface">
      {/*
        One scrollport for the whole grid, both axes — and that is the fix for a
        bug, not a tidy-up.

        The hour grid used to do the vertical scrolling itself. CSS promotes the
        other axis to `auto` the moment one stops being `visible`, so that inner
        element was a *horizontal* scroll container too — and `position: sticky`
        resolves against the nearest scrollport. The hour gutter's `left-0`
        therefore stuck to the inner box, whose `scrollLeft` is permanently 0,
        so it rode along with the horizontal scroll instead of staying put.
        Measured: at half-scroll on a 393px phone the hour labels sat at
        `left: -255px` — the time axis simply left the screen, while the all-day
        band's gutter, one level further out, stayed pinned correctly.

        With both axes here, every sticky inside resolves against this one box:
        the gutter pins left, the day headers and all-day band pin top.
      */}
      <div
        ref={scrollRef}
        /*
         * `scroll-pl-14` is not decoration: snap points align to the
         * *scrollport's* start edge, which is behind the sticky hour gutter.
         * Without it the browser settled at `scrollLeft: 56` — exactly the
         * gutter's width — and Sunday spent its life underneath it, its chips
         * clipped mid-word. The padding moves the alignment line to the gutter's
         * right edge, where the days actually begin.
         */
        className="flex min-h-0 flex-1 overflow-auto overscroll-contain scrollbar-slim max-md:snap-x max-md:snap-proximity max-md:scroll-pl-14"
      >
        <div className={cn("flex flex-1 flex-col md:min-w-0", MOBILE_GRID_WIDTH)}>
          {/* The header block: the two rows that must stay put while the hours
              scroll under them. Sticky as one unit rather than two, so the
              all-day band needs no hard-coded offset for the row above it. */}
          <div ref={headerRef} className="sticky top-0 z-30 shrink-0 bg-surface">
          {/* Day headers */}
          <div className="flex shrink-0 border-b border-border">
            <div className={TIME_GUTTER} />
            {byDay.map(({ date, key }, i) => {
              const isToday = key === today;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => onSelectDay(key)}
                  aria-current={isToday ? "date" : key === selectedDate ? "true" : undefined}
                  className={cn(
                    DAY_COLUMN,
                    "flex min-h-12 flex-col items-center justify-center gap-0.5 border-r border-border px-1 py-2",
                    "transition-colors motion-safe:duration-(--dur-quick) hover:bg-surface-hover active:bg-surface-hover",
                    key === selectedDate && "bg-accent-soft/20",
                  )}
                >
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    {WEEKDAY_LABELS[i]}
                  </span>
                  <span
                    className={cn(
                      "flex size-7 items-center justify-center rounded-full text-[13px] font-medium tabular-nums",
                      isToday
                        ? "bg-accent font-semibold text-accent-foreground"
                        : "text-foreground",
                    )}
                  >
                    {format(date, "d")}
                  </span>
                </button>
              );
            })}
          </div>

          {/* All-day band */}
          <div className="flex shrink-0 border-b border-border bg-surface-sunken/50">
            <div className={cn(TIME_GUTTER, "flex items-start justify-end px-1.5 py-1.5 text-[10px] uppercase tracking-wide text-muted-foreground")}>
              All day
            </div>
            {byDay.map(({ key, allDay }) => {
              const hidden = allDay.length - MAX_ALL_DAY;
              return (
                <div
                  key={key}
                  data-week-allday-col={key}
                  className={cn(
                    DAY_COLUMN,
                    "flex min-h-[38px] flex-col gap-px border-r border-border p-0.5",
                    key === selectedDate && "bg-accent-soft/20",
                  )}
                >
                  {allDay.slice(0, MAX_ALL_DAY).map((event) => (
                    <EventChip
                      key={event.id}
                      event={event}
                      onSelect={onSelectEvent}
                      variant="week"
                      // `shrink-0` matters: these are flex children, and
                      // `min-h-0` lets flexbox compress them below their own
                      // content height. Three in a column and the band squashed
                      // each to ~10px while the text kept its 21px, so the rows
                      // printed through one another.
                      className="min-h-0 shrink-0 py-0.5"
                    />
                  ))}
                  {hidden > 0 && (
                    <button
                      type="button"
                      onClick={() => onShowMore(key)}
                      className="shrink-0 rounded px-1 text-left text-[11px] text-muted-foreground transition-colors hover:text-foreground hover:underline"
                    >
                      +{hidden} more
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          </div>

          {/* Hour grid. No longer a scroller of its own — see the container
              above — so it is simply as tall as its hours and the one
              scrollport handles it. */}
          <div data-week-timeline className="relative shrink-0">
            <div className="relative flex">
              <div className={TIME_GUTTER}>
                {HOURS.map((hour) => (
                  <div
                    key={hour}
                    style={{ height: HOUR_HEIGHT }}
                    /*
                     * Each label is lifted 8px so it straddles the line at the
                     * top of its own row — except the first, whose line is the
                     * grid's top edge. Lifting that one pushed "00:00" under
                     * the sticky header and sliced it in half.
                     */
                    className={cn(
                      "relative pr-1.5 text-right text-[10px] tabular-nums text-muted-foreground",
                      hour === FIRST_HOUR ? "top-0" : "-top-2",
                    )}
                  >
                    {String(hour).padStart(2, "0")}:00
                  </div>
                ))}
              </div>

              {byDay.map(({ key, clusters }) => (
                <div
                  key={key}
                  // Named so a test can assert that nothing inside a day is
                  // painted outside it — the property this view kept breaking.
                  data-week-col={key}
                  className={cn(
                    DAY_COLUMN,
                    "relative border-r border-border",
                    key === selectedDate && "bg-accent-soft/20",
                  )}
                >
                  {HOURS.map((hour) => (
                    <div
                      key={hour}
                      style={{ height: HOUR_HEIGHT }}
                      className="border-b border-border/60"
                    />
                  ))}

                  {clusters.map((cluster) => {
                    const shown = cluster.events.slice(0, MAX_PER_CLUSTER);
                    const hidden = cluster.events.length - shown.length;
                    return (
                      <React.Fragment key={`${key}-${cluster.top}`}>
                        {shown.map((event, i) => (
                          <div
                            key={event.id}
                            style={{ top: cluster.top + i * CHIP_STEP + 2 }}
                            className="absolute inset-x-0.5"
                          >
                            <EventChip
                              event={event}
                              onSelect={onSelectEvent}
                              variant="week"
                              className="min-h-0 bg-surface py-0.5"
                            />
                          </div>
                        ))}
                        {hidden > 0 && (
                          <button
                            type="button"
                            onClick={() => onShowMore(key)}
                            style={{ top: cluster.top + shown.length * CHIP_STEP + 2 }}
                            className="absolute inset-x-0.5 rounded bg-surface px-1 text-left text-[11px] text-muted-foreground transition-colors hover:text-foreground hover:underline"
                          >
                            +{hidden} more
                          </button>
                        )}
                      </React.Fragment>
                    );
                  })}
                </div>
              ))}

              {weekHasToday && indicatorTop !== null && (
                <div
                  data-week-now-line
                  style={{ top: indicatorTop }}
                  className="pointer-events-none absolute inset-x-0 left-14 z-10 flex items-center"
                  aria-hidden
                >
                  <span className="size-2 shrink-0 rounded-full bg-accent" />
                  <span className="h-px flex-1 bg-accent" />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The shell re-renders whenever a dialog opens, a day expands or an event is
 * selected — none of which changes what the grid should draw. Without this the
 * whole view, and every chip in it, re-rendered on each of those.
 */
export const WeekView = React.memo(WeekViewInner);
