"use client";

import { addDays, addMonths, format, startOfMonth } from "date-fns";
import * as React from "react";
import {
  chunkIntoWeeks,
  getMonthGridDays,
  WEEKDAY_LABELS,
  WEEKDAY_LABELS_SHORT,
} from "@/lib/calendar";
import type { Density } from "@/lib/calendar-index";
import type { CuratedCalendarEvent } from "@/lib/curation/types";
import { useIsPhone } from "@/hooks/use-media-query";
import { useTodayKey } from "@/hooks/use-now";
import { toDateKey } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { EventChip } from "./event-chip";

export type MonthViewProps = {
  anchor: Date;
  eventsByDay: Record<string, CuratedCalendarEvent[]>;
  /** How busy each day is, computed once per dataset alongside the day buckets. */
  densityByDay: ReadonlyMap<string, Density>;
  selectedDate: string | null;
  onSelectDay: (dayKey: string) => void;
  onSelectEvent: (event: CuratedCalendarEvent) => void;
  onNavigateMonth: (date: Date) => void;
  onShowMore: (dayKey: string) => void;
};

const EMPTY: CuratedCalendarEvent[] = [];

/** Most a cell will ever show, however tall the row gets. */
const MAX_VISIBLE = 3;

/*
 * What one cell spends its height on, in pixels.
 *
 * The grid divides the workspace between its rows rather than claiming a fixed
 * 112px each, so a row is ~140px on a 1080p monitor and ~95px at 1280x720. How
 * many chips fit is therefore a property of the viewport, not a constant — and
 * getting it wrong in either direction is visible: too many and the cell clips
 * events with no "+N more" to admit it, too few and a tall screen wastes space
 * it has.
 */
const DATE_ROW = 28;
const CHIP_STEP = 21;
const MORE_ROW = 15;

/** How many chips a row of `height` can show without clipping. */
function capacity(height: number): number {
  if (height <= 0) return MAX_VISIBLE;
  const room = Math.floor((height - DATE_ROW - MORE_ROW) / CHIP_STEP);
  return Math.max(1, Math.min(MAX_VISIBLE, room));
}

/**
 * Everything about a cell that depends only on which month is on screen.
 *
 * Both strings used to be produced by `date-fns` `format` inside the 42-cell
 * map — measured at 7.6µs and 4.0µs a call, so ~485µs of a grid paint went on
 * 84 strings that change only when the month does. They are built once per
 * anchor here instead, and the day number is `getDate()`, which is what the
 * formatter was being asked for the long way round.
 */
type Cell = {
  date: Date;
  key: string;
  /** `1`…`31`. */
  number: string;
  /** "Tuesday 15 September 2026", for the gridcell's accessible name. */
  spoken: string;
  inMonth: boolean;
};

function buildCells(anchor: Date): Cell[][] {
  const month = anchor.getMonth();
  return chunkIntoWeeks(getMonthGridDays(anchor)).map((week) =>
    week.map((date) => ({
      date,
      key: toDateKey(date),
      number: String(date.getDate()),
      spoken: format(date, "EEEE d MMMM yyyy"),
      inMonth: date.getMonth() === month,
    })),
  );
}

/**
 * Which events a cell shows, and in what order.
 *
 * A cell has room for three, and a calendar of *important* events has to spend
 * them on the important ones — taking the first three by clock time buried a
 * primary under three morning esports fixtures. So the three are chosen by
 * importance and then displayed in time order, which is what a reader expects.
 */
function pickVisible(events: CuratedCalendarEvent[], limit: number): CuratedCalendarEvent[] {
  if (events.length <= limit) return events;
  return [...events]
    .sort((a, b) => b.importanceScore - a.importanceScore || a.id.localeCompare(b.id))
    .slice(0, limit)
    .sort((a, b) => {
      if (a.isAllDay !== b.isAllDay) return a.isAllDay ? 1 : -1;
      if (a.time && b.time) return a.time.localeCompare(b.time);
      return 0;
    });
}

/**
 * Memoised on the day's list itself.
 *
 * The choice is a pure function of that array, and the day buckets now keep
 * their identity across a view switch, a day click and an arrow-key move — so
 * on all of those this is a lookup rather than 30-odd copy-sort-slice-sort
 * cycles. A WeakMap so a month that scrolls out of reach takes its entries with
 * it.
 */
const visibleCache = new WeakMap<
  CuratedCalendarEvent[],
  { limit: number; picked: CuratedCalendarEvent[] }
>();

function visibleEvents(events: CuratedCalendarEvent[], limit: number): CuratedCalendarEvent[] {
  const cached = visibleCache.get(events);
  if (cached && cached.limit === limit) return cached.picked;
  const picked = pickVisible(events, limit);
  visibleCache.set(events, { limit, picked });
  return picked;
}

/**
 * The month grid.
 *
 * One CSS grid for the whole month with `auto-rows-fr`, rather than a stack of
 * per-week grids: that is what guarantees every week row is exactly the same
 * height, so a day holding nine events can't stretch its row. Cells clip their
 * overflow and surface the remainder behind "+N more".
 */
function MonthViewInner({
  anchor,
  eventsByDay,
  densityByDay,
  selectedDate,
  onSelectDay,
  onSelectEvent,
  onNavigateMonth,
  onShowMore,
}: MonthViewProps) {
  const weeks = React.useMemo(() => buildCells(anchor), [anchor]);
  const dayKeys = React.useMemo(
    () => new Set(weeks.flatMap((week) => week.map((cell) => cell.key))),
    [weeks],
  );
  const today = useTodayKey();
  const isPhone = useIsPhone();

  const [focusedKey, setFocusedKey] = React.useState<string | null>(null);
  const gridRef = React.useRef<HTMLDivElement>(null);
  const pendingFocus = React.useRef<string | null>(null);

  /**
   * Exactly one cell carries the grid's tab stop.
   *
   * The membership tests are set lookups now. They used to be three
   * `days.some(d => toDateKey(d) === …)` scans — up to 126 key rebuilds — re-run
   * on every day click, an interaction whose only real effect is a ring on one
   * cell.
   */
  const focusTarget = React.useMemo(() => {
    if (focusedKey && dayKeys.has(focusedKey)) return focusedKey;
    if (selectedDate && dayKeys.has(selectedDate)) return selectedDate;
    if (dayKeys.has(today)) return today;
    const first = weeks.flat().find((cell) => cell.date.getDate() === 1 && cell.inMonth);
    return (first ?? weeks[0][0]).key;
  }, [dayKeys, focusedKey, selectedDate, today, weeks]);

  /*
   * How tall a week row actually is, measured rather than assumed.
   *
   * The grid takes whatever height the shell has left, so the answer changes
   * with the window and with how many weeks the month spans. Measuring is the
   * only way "+N more" can be truthful: it is the difference between the events
   * a day holds and the ones that fit, and "fit" is not a constant.
   *
   * A phone is exempt — there the chips are dots in a single row, so a 54px
   * cell shows three of them side by side and the vertical arithmetic does not
   * apply.
   */
  const [rowHeight, setRowHeight] = React.useState(0);
  React.useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const measure = () => setRowHeight(grid.clientHeight / weeks.length);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(grid);
    return () => observer.disconnect();
  }, [weeks.length]);

  const perCell = isPhone ? MAX_VISIBLE : capacity(rowHeight);

  // Restore DOM focus after an arrow key changes which cell is tabbable —
  // including when the move crossed into a newly rendered month.
  React.useEffect(() => {
    const key = pendingFocus.current;
    if (!key) return;
    const cell = gridRef.current?.querySelector<HTMLElement>(`[data-day="${key}"]`);
    if (cell) {
      cell.focus();
      pendingFocus.current = null;
    }
  });

  const moveFocus = React.useCallback(
    (from: Date, deltaDays: number) => {
      const next = addDays(from, deltaDays);
      const key = toDateKey(next);
      setFocusedKey(key);
      pendingFocus.current = key;
      if (!dayKeys.has(key)) onNavigateMonth(startOfMonth(next));
    },
    [dayKeys, onNavigateMonth],
  );

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const dayAttr = target.getAttribute?.("data-day");
    if (!dayAttr) return;
    const current = weeks.flat().find((cell) => cell.key === dayAttr)?.date;
    if (!current) return;

    const moves: Record<string, number> = {
      ArrowRight: 1,
      ArrowLeft: -1,
      ArrowDown: 7,
      ArrowUp: -7,
    };

    if (event.key in moves) {
      event.preventDefault();
      moveFocus(current, moves[event.key]);
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const weekday = current.getDay();
      moveFocus(current, event.key === "Home" ? -weekday : 6 - weekday);
      return;
    }
    if (event.key === "PageUp" || event.key === "PageDown") {
      event.preventDefault();
      const next = addMonths(current, event.key === "PageDown" ? 1 : -1);
      setFocusedKey(toDateKey(next));
      pendingFocus.current = toDateKey(next);
      onNavigateMonth(startOfMonth(next));
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      if (event.target !== event.currentTarget && target.getAttribute("role") !== "gridcell") {
        return;
      }
      event.preventDefault();
      onSelectDay(dayAttr);
    }
  };

  return (
    /*
     * `max-sm:flex-none` is the whole split.
     *
     * On a pointer the grid grows to fill the page, which is what makes a
     * 112px cell. On a phone it sizes to its own content instead — six rows of
     * 46px — and the space it gives up goes to the day schedule beneath it.
     *
     * 46 rather than 54, which is 48px of height handed to the schedule. On a
     * phone the grid is a *navigator*: it has to say which days are busy and
     * let you pick one, and a row of dots plus a date number does that in 46px.
     * The titles are the thing worth height, and they are all downstairs.
     * `auto-rows-fr` still equalises the rows; in an auto-height container an
     * `fr` row resolves to max-content, which here is the cell's min-height.
     */
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-surface max-sm:flex-none">
      <div className="grid shrink-0 grid-cols-7 border-b border-border">
        {WEEKDAY_LABELS.map((label, i) => (
          <div
            key={label + i}
            className="px-1 py-1.5 text-center text-[10px] font-medium uppercase tracking-wide text-muted-foreground short-phone:py-0.5 sm:px-2 sm:text-[11px]"
          >
            {/* Three letters need about 30px; a phone gives each column 50 and
                has to fit a date under it, so it gets the initial instead. */}
            <span className="sm:hidden">{WEEKDAY_LABELS_SHORT[i]}</span>
            <span className="hidden sm:inline">{label}</span>
          </div>
        ))}
      </div>

      <div
        ref={gridRef}
        role="grid"
        aria-label={`Events in ${format(anchor, "MMMM yyyy")}`}
        aria-rowcount={weeks.length}
        onKeyDown={handleKeyDown}
        className="-mb-px -mr-px grid min-h-0 flex-1 auto-rows-fr grid-cols-7"
      >
        {weeks.map((week, weekIndex) => (
          // `display: contents` keeps the ARIA row while letting its cells sit
          // directly in the month grid, so `auto-rows-fr` can equalise them.
          <div role="row" key={weekIndex} className="contents">
            {week.map((cell, dayIndex) => {
              const { key, inMonth } = cell;
              const events = eventsByDay[key] ?? EMPTY;
              const isToday = key === today;
              const isSelected = key === selectedDate;
              const level = inMonth ? densityByDay.get(key) : undefined;
              const isEmpty = inMonth && events.length === 0;
              const hidden = events.length - perCell;

              return (
                <div
                  /*
                   * Keyed by position, not by date.
                   *
                   * Every date key changes when the month does, so keying on it
                   * told React that all 42 cells and every chip in them were
                   * new — a full unmount and remount of the grid to move from
                   * September to October, including the days the two grids
                   * share. A month grid is a fixed 7-column table and a cell's
                   * identity is where it sits, so React updates them in place.
                   */
                  key={dayIndex}
                  role="gridcell"
                  data-day={key}
                  tabIndex={key === focusTarget ? 0 : -1}
                  aria-current={isToday ? "date" : isSelected ? "true" : undefined}
                  aria-label={`${cell.spoken}, ${
                    events.length === 0
                      ? "no events"
                      : `${events.length} event${events.length === 1 ? "" : "s"}`
                  }`}
                  /*
                   * Anywhere in the cell that isn't a control counts as a tap
                   * on the day — the date number and the padding around it
                   * included. Testing `target === currentTarget` instead meant
                   * the top ~24px of every cell, where the date sits, silently
                   * did nothing; on a 62px phone cell that is a third of it.
                   */
                  onClick={(e) => {
                    const el = e.target as HTMLElement;
                    if (el !== e.currentTarget && el.closest("a,button")) return;
                    /*
                     * The second click of a double-click does nothing.
                     *
                     * On a pointer `onSelectDay` *toggles*, so the pair
                     * selected the day and then deselected it — the panel
                     * opened over a grid with no selection ring, no
                     * `aria-current`, and no `?selected=` in the URL, and if
                     * another day had been selected it was destroyed with
                     * nothing put in its place. `detail` is the browser's own
                     * click counter, so this needs no timer and delays the
                     * first click by nothing.
                     */
                    if (e.detail > 1) return;
                    setFocusedKey(key);
                    onSelectDay(key);
                  }}
                  /*
                   * Double-click opens the whole day, and it is the same panel
                   * "+N more" opens — the one that lists every event with its
                   * time, not the three that happened to fit.
                   *
                   * Two things make it safe to layer on top of the single
                   * click. The guard is the same one above: a double-click that
                   * landed on a chip or the "+N more" button is that control's
                   * business, so the day panel does not open over the market
                   * the reader just asked for. And single-click still selects,
                   * because the browser fires `click` twice before `dblclick`
                   * and selecting a day twice is idempotent — there is no
                   * flicker to suppress and no timer to wait out, which is why
                   * this is not implemented as a delayed click.
                   *
                   * Deliberately not gated on `hidden > 0`: a day with two
                   * events has a full-day panel too, and a reader who has
                   * learned the gesture should not find it silently missing on
                   * the quiet days. Phones get nothing from this — `dblclick`
                   * is not a reliable touch primitive — and lose nothing
                   * either, because the selected-day schedule below the grid is
                   * already the full list.
                   */
                  onDoubleClick={(e) => {
                    const el = e.target as HTMLElement;
                    if (el !== e.currentTarget && el.closest("a,button")) return;
                    onShowMore(key);
                  }}
                  /*
                   * Exactly one background statement per cell, in a fixed order
                   * of precedence: today, then outside-month, then density.
                   *
                   * There used to be a second tint marking a day that held a
                   * major event, which meant two different meanings competing
                   * for one surface. It has gone: a major event is already
                   * unmistakable inside the cell — star, tinted chip, accent
                   * left border — and the day did not need to shout as well.
                   *
                   * Today outranks both: it keeps its own gradient, border and
                   * glow whatever the day's density happens to be, because the
                   * one cell a reader looks for first should not change
                   * appearance with how busy it is. Selection is a ring, so it
                   * layers over any of them.
                   */
                  className={cn(
                    // 46px on a phone. The grid no longer stretches to fill the
                    // screen there — it takes the top half and hands the rest to
                    // the day schedule — so this height is the row height, and
                    // it is what six weeks plus a readable list has room for.
                    // `select-none` because the cell answers to double-click:
                    // without it the second click highlights the date number
                    // and the day opens behind a blue smear of selected text.
                    "relative flex min-h-[46px] cursor-pointer select-none flex-col gap-px overflow-hidden border-b border-r border-border p-0.5 sm:min-h-[56px] sm:p-1",
                    /*
                     * A short phone buys its day list back out of the grid's
                     * padding: a point of cell padding, the date row's own two,
                     * and 2px off the date disc. 8px a row, 48px over six rows,
                     * which is one more readable event in the list below.
                     *
                     * These are floors that actually bind — the cell measures
                     * ~40px of content on a phone and ~32px here, so `min-h`
                     * is what sets the row rather than being decorative.
                     */
                    "short-phone:min-h-[38px] short-phone:p-px",
                    "transition-colors motion-safe:duration-(--dur-quick) hover:bg-surface-hover focus-visible:z-10",
                    !inMonth && "bg-outside-month",
                    level === "low" && "day-density-low",
                    level === "medium" && "day-density-medium",
                    level === "high" && "day-density-high",
                    level === "extreme" && "day-density-extreme",
                    // Today outranks density, selection outranks both — and all
                    // three stay readable together, because they are a surface,
                    // a bar and a ring rather than three competing washes.
                    isToday && "day-today",
                    isSelected && "z-10 ring-2 ring-inset ring-accent",
                  )}
                >
                  <div className="flex shrink-0 items-center justify-center px-0.5 pb-0.5 pt-0.5 short-phone:py-0 sm:justify-between">
                    {/* Today's number is set a little larger and tighter, in
                        the same filled disc Google Calendar uses — the tint,
                        border and glow place the *cell*, and this places the
                        date within it. Tabular figures everywhere so the
                        column of numbers stays a column. */}
                    <span
                      className={cn(
                        "flex items-center justify-center rounded-full tabular-nums transition-colors",
                        "motion-safe:duration-(--dur-quick)",
                        isToday
                          // The whole of today, more or less: the number in a
                          // filled disc, the way every calendar does it. No
                          // ring — a ring is drawn outside the element's box and
                          // a day cell clips its overflow, which sliced a flat
                          // side onto the circle at phone padding.
                          ? "size-[22px] bg-accent text-[12px] font-semibold leading-none tracking-[-0.01em] text-accent-foreground short-phone:size-5 short-phone:text-[11.5px] sm:size-[24px] sm:text-[13px]"
                          : "size-[22px] text-[12px] font-medium short-phone:size-5 short-phone:text-[11.5px] sm:size-6",
                        !isToday && inMonth && "text-foreground",
                        !isToday && !inMonth && "text-subtle-foreground",
                      )}
                    >
                      {cell.number}
                    </span>
                  </div>

                  {/* A day with nothing on it gets a single faint dot. It costs
                      the grid nothing to read past and stops a quiet week
                      looking like a rendering failure.

                      `bg-(--empty-mark)` with parentheses: Tailwind v3's
                      square-bracket form compiles in v4 to the literal
                      `background-color: --empty-mark`, which is not a value, so
                      the browser dropped the declaration and this dot rendered
                      with no colour at all. */}
                  {isEmpty && (
                    <span
                      aria-hidden
                      data-empty-day=""
                      className="pointer-events-none absolute inset-x-0 top-1/2 mx-auto size-[3px] -translate-y-1/2 rounded-full bg-(--empty-mark)"
                    />
                  )}

                  {/* Stacked rows on a pointer, a centred row of dots on a
                      phone. `min-h-0` so the dots sit under the date rather
                      than pushing the cell taller than its row. */}
                  <div
                    className={cn(
                      "flex min-h-0 flex-1 flex-col gap-px",
                      "max-sm:flex-row max-sm:items-center max-sm:justify-center max-sm:gap-[3px]",
                    )}
                  >
                    {visibleEvents(events, perCell).map((event) => (
                      <EventChip key={event.id} event={event} onSelect={onSelectEvent} />
                    ))}

                    {/* On a phone the count belongs *on* the row of dots, not
                        under it. It is the same sentence — "three dots, and
                        four more" — and as its own line it was spending 10px of
                        every cell, 60px of the grid, to say it twice as tall.
                        Three dots means "three or more", so a reader scanning
                        for the busy days still needs the number: the density
                        tint says "a lot", this says how many. */}
                    {hidden > 0 && (
                      <span
                        aria-hidden
                        data-more-count={hidden}
                        className="pointer-events-none shrink-0 text-[9px] font-medium leading-none tabular-nums text-muted-foreground sm:hidden"
                      >
                        +{hidden}
                      </span>
                    )}
                  </div>

                  {/* On a pointer this opens the day; on a phone the count is
                      printed on the dot row above instead, without being its
                      own target, because the cell is already the target and
                      every event is listed in the schedule below. */}
                  {hidden > 0 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onShowMore(key);
                      }}
                      className="hidden shrink-0 rounded px-1 text-left text-[11px] leading-tight text-muted-foreground transition-colors motion-safe:duration-(--dur-quick) hover:text-foreground hover:underline sm:block"
                    >
                      +{hidden} more
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <p className="sr-only">
        Use the arrow keys to move between days, Page Up and Page Down to change
        month, and Enter to open a day.
      </p>
    </div>
  );
}

/**
 * The shell re-renders whenever a dialog opens, a day expands or an event is
 * selected — none of which changes what the grid should draw. Without this the
 * whole view, and every chip in it, re-rendered on each of those.
 */
export const MonthView = React.memo(MonthViewInner);
