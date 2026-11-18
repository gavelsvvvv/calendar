"use client";

import { format } from "date-fns";
import { ChevronLeft, ChevronRight, Eye, EyeOff } from "lucide-react";
import * as React from "react";
import type { CuratedCalendarEvent } from "@/lib/curation/types";
import { useLocalClock, useTodayKey } from "@/hooks/use-now";
import { fromDayKey, toDateKey } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { DaySchedule } from "./day-schedule";

export type AgendaViewProps = {
  /** The day this view is about. Agenda anchors on a day, not a month. */
  anchor: Date;
  eventsByDay: Record<string, CuratedCalendarEvent[]>;
  /** Whether the lower-volume tier is in the loaded dataset. */
  includeSmallerMarkets: boolean;
  onToggleSmallerMarkets: () => void;
  /** Jump the whole calendar to another day — used by the empty-day escapes. */
  onGoToDay: (dayKey: string) => void;
  onSelectEvent: (event: CuratedCalendarEvent) => void;
};

const EMPTY: CuratedCalendarEvent[] = [];

/**
 * One day, and only one day, laid out against a vertical clock.
 *
 * This used to be a continuous month-long scroll, which is a strange shape for
 * the view a reader opens to ask "what is on today": the day you came for slid
 * out from under its own heading, and two days' rows ran together into a single
 * undifferentiated column. Paging is now explicit — the bar's arrows step a day
 * at a time — and the body is a timeline rather than a list.
 *
 * The day comes from the anchor rather than from `selectedDate`, so there is
 * exactly one source of truth for which day is on screen and the address bar
 * always names it.
 */
function AgendaViewInner({
  anchor,
  eventsByDay,
  includeSmallerMarkets,
  onToggleSmallerMarkets,
  onGoToDay,
  onSelectEvent,
}: AgendaViewProps) {
  const today = useTodayKey();
  const clock = useLocalClock();

  const dayKey = toDateKey(anchor);
  const date = fromDayKey(dayKey);
  const events = eventsByDay[dayKey] ?? EMPTY;
  const isToday = dayKey === today;

  /*
   * Where to go when this day holds nothing.
   *
   * An empty day is a legitimate answer and the view says so, but leaving the
   * reader to guess how far the next fixture is means tapping Next six times
   * through a quiet week. These are the neighbours that actually have
   * something, within the loaded month — so the escape is always truthful about
   * what it will land on, and never offers a day it cannot show.
   */
  const { previous, next } = React.useMemo(() => {
    const keys = Object.keys(eventsByDay)
      .filter((key) => (eventsByDay[key]?.length ?? 0) > 0)
      .sort();
    return {
      previous: [...keys].reverse().find((key) => key < dayKey) ?? null,
      next: keys.find((key) => key > dayKey) ?? null,
    };
  }, [eventsByDay, dayKey]);

  return (
    <div
      data-agenda-panel
      data-day={dayKey}
      className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-surface"
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2.5 short-phone:py-1.5">
        <h2 className="min-w-0 truncate text-[14px] font-semibold tracking-tight text-foreground sm:text-[15px]">
          <span className="text-muted-foreground">{format(date, "EEEE")}</span>{" "}
          {format(date, "d MMMM yyyy")}
        </h2>
        {isToday && (
          <span className="shrink-0 rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-semibold uppercase leading-tight tracking-wide text-accent-foreground">
            Today
          </span>
        )}
        <span className="ml-auto shrink-0 text-[12px] tabular-nums text-muted-foreground">
          {events.length === 0
            ? "None"
            : `${events.length} event${events.length === 1 ? "" : "s"}`}
        </span>
        {/*
          The reader's own clock, on today and nowhere else — "14:08" beside
          next Friday would be answering a question nobody asked. Absent until
          the browser has read its own clock: the server cannot know the
          reader's minute, and rendering a guess is a hydration error waiting on
          the next minute boundary.
        */}
        {isToday && clock !== null && (
          <time
            dateTime={clock}
            aria-label={`Current local time, ${clock}`}
            className="shrink-0 text-[11px] tabular-nums text-subtle-foreground"
          >
            {clock}
          </time>
        )}
      </div>

      {/*
        The calendar says out loud that it is holding something back.

        Most of what Polymarket lists on any given day sits under the volume
        floors — on 8 November, 96 events pass them and 169 exist. The switch
        for that has always been here, as "Include smaller markets" in the
        sidebar, which is exactly the problem: a reader looking at a day with
        two Counter-Strike matches on it has no way to know that five more were
        played, and nothing on the screen suggests a sidebar checkbox is the
        reason. A calendar that filters silently reads as a calendar with
        missing data. So the day view states the filter and offers the switch,
        in the one place the gap is actually felt.
      */}
      <button
        type="button"
        data-smaller-toggle
        data-smaller-on={includeSmallerMarkets ? "true" : "false"}
        onClick={onToggleSmallerMarkets}
        className="flex min-h-8 shrink-0 items-center gap-1.5 border-b border-border bg-surface-sunken/40 px-3 py-1 text-left text-[11px] text-muted-foreground transition-colors motion-safe:duration-(--dur-quick) hover:bg-surface-hover active:bg-surface-hover"
      >
        {includeSmallerMarkets ? (
          <Eye className="size-3 shrink-0" aria-hidden />
        ) : (
          <EyeOff className="size-3 shrink-0" aria-hidden />
        )}
        {includeSmallerMarkets
          ? "Showing lower-volume markets too"
          : "Lower-volume markets are hidden"}
        <span className="font-medium text-accent">
          {includeSmallerMarkets ? "Hide" : "Show all"}
        </span>
      </button>

      {events.length === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 py-10 text-center">
          {/*
            Two different emptinesses, and conflating them is how an empty state
            starts lying. `eventsByDay` is already the *filtered* map, so an
            empty one means the reader's filters match nothing anywhere in the
            loaded month — pointing them at another day would send them to one
            that is just as empty. A populated map with an empty day is the
            ordinary case: a quiet Tuesday, with somewhere to go from it.
          */}
          <p data-agenda-empty className="text-[13px] text-muted-foreground">
            {previous || next
              ? "Nothing scheduled on this day."
              : "No events match the current filters."}
          </p>
          {(previous || next) && (
            <div className="flex flex-wrap items-center justify-center gap-2">
              {previous && (
                <JumpButton
                  direction="previous"
                  dayKey={previous}
                  onClick={() => onGoToDay(previous)}
                />
              )}
              {next && (
                <JumpButton
                  direction="next"
                  dayKey={next}
                  onClick={() => onGoToDay(next)}
                />
              )}
            </div>
          )}
        </div>
      ) : (
        /*
          Keyed on the day so the timeline re-enters and re-scrolls to where the
          day starts happening — without it, stepping a day is a silent content
          swap at whatever scroll position the previous day was left at.
        */
        <DaySchedule
          key={dayKey}
          dayKey={dayKey}
          events={events}
          onSelectEvent={onSelectEvent}
          className={cn(
            "min-h-0 flex-1",
            "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-(--dur-base) motion-safe:ease-(--ease-out)",
          )}
        />
      )}
    </div>
  );
}

function JumpButton({
  direction,
  dayKey,
  onClick,
}: {
  direction: "previous" | "next";
  dayKey: string;
  onClick: () => void;
}) {
  const label = format(fromDayKey(dayKey), "EEE d MMM");
  const Icon = direction === "previous" ? ChevronLeft : ChevronRight;

  return (
    <button
      type="button"
      onClick={onClick}
      data-jump={direction}
      data-jump-day={dayKey}
      className="flex min-h-9 items-center gap-1 rounded-md border border-border px-2.5 text-[12px] font-medium text-foreground transition-colors motion-safe:duration-(--dur-quick) hover:bg-surface-hover active:bg-surface-hover"
    >
      {direction === "previous" && <Icon className="size-3.5" aria-hidden />}
      {direction === "previous" ? "Previous" : "Next"} with events · {label}
      {direction === "next" && <Icon className="size-3.5" aria-hidden />}
    </button>
  );
}

/**
 * The shell re-renders whenever a dialog opens or an event is selected — none
 * of which changes which day this is showing.
 */
export const AgendaView = React.memo(AgendaViewInner);
