"use client";

import { format, isSameMonth } from "date-fns";
import { CalendarClock, Star } from "lucide-react";
import * as React from "react";
import { useNow } from "@/hooks/use-now";
import { getCategoryMeta } from "@/lib/categories";
import type { CuratedCalendarEvent } from "@/lib/curation/types";
import { useTodayKey } from "@/hooks/use-now";
import { fromDayKey, toDateKey } from "@/lib/dates";
import { isEventPast } from "@/lib/event-time";
import { formatCompactUsd } from "@/lib/format";
import { emphasisOf } from "@/lib/emphasis";
import { probabilityDisplay, probabilityLabel } from "@/lib/probability";
import { cn } from "@/lib/utils";

export type MobileDayScheduleProps = {
  anchor: Date;
  eventsByDay: Record<string, CuratedCalendarEvent[]>;
  selectedDate: string | null;
  onSelectEvent: (event: CuratedCalendarEvent) => void;
};

const EMPTY: CuratedCalendarEvent[] = [];

/**
 * Which day the schedule is about when nobody has picked one.
 *
 * Today if today is on screen — that is what a person opening a calendar wants
 * to know first. Otherwise the month's first day that has anything on it, so
 * paging to September lands on content rather than on an empty panel that makes
 * the whole feature look broken.
 */
function defaultDay(
  anchor: Date,
  eventsByDay: Record<string, CuratedCalendarEvent[]>,
  today: string,
): string {
  if (isSameMonth(fromDayKey(today), anchor)) return today;
  const first = Object.keys(eventsByDay)
    .filter((key) => isSameMonth(fromDayKey(key), anchor))
    .sort()[0];
  return first ?? toDateKey(anchor);
}

/**
 * The phone's month view, second half.
 *
 * The grid above can show *that* a day has something on it; at 53px per column
 * it can never show *what*. Rather than pretend otherwise with truncated text,
 * the grid stays a grid and the titles live down here, for whichever day is
 * selected — which is how every native calendar on a phone resolves the same
 * problem, and the direct answer to "instead of market names I just see
 * coloured lines".
 *
 * It replaces a modal. Tapping a day used to open a bottom sheet over the
 * calendar, so reading two days meant open, read, dismiss, open, read. Here the
 * list simply changes under the grid and the calendar never goes away.
 */
function MobileDayScheduleInner({
  anchor,
  eventsByDay,
  selectedDate,
  onSelectEvent,
}: MobileDayScheduleProps) {
  const today = useTodayKey();
  const dayKey = selectedDate ?? defaultDay(anchor, eventsByDay, today);
  const events = eventsByDay[dayKey] ?? EMPTY;
  const date = fromDayKey(dayKey);
  const isToday = dayKey === today;

  /*
   * Is there anything else in this month to send the reader to?
   *
   * The empty panel used to say "Tap a tinted date above" unconditionally, and
   * with the categories cleared there are no tinted dates — it was pointing at
   * a grid it had not looked at. `eventsByDay` is already the *filtered* map, so
   * an empty one means the whole month is empty under the current filters and
   * the only honest thing to say is the first line.
   */
  const monthHasEvents = Object.keys(eventsByDay).length > 0;

  return (
    <section
      aria-label="Selected day"
      data-testid="mobile-day-schedule"
      /*
       * `sm:hidden`, not `md:hidden`. The grid switches to its compact,
       * dot-per-event form at `sm`, and the two have to agree: at `md` there
       * was a 128px-wide band where a reader got the *tall* 112px grid and this
       * panel underneath it, which is more height than the viewport has.
       */
      className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-surface sm:hidden"
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3.5 py-2.5 short-phone:py-1.5">
        <h2 className="min-w-0 truncate text-[14px] font-semibold tracking-tight text-foreground">
          <span className="text-muted-foreground">{format(date, "EEEE")}</span>{" "}
          {format(date, "d MMMM")}
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
      </div>

      {/*
        Keyed on the day so the list re-enters rather than mutating in place —
        without it, changing days is a silent content swap and the eye misses
        that anything happened.
      */}
      {events.length === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 py-8 text-center">
          <CalendarClock className="size-5 text-subtle-foreground" aria-hidden />
          <p className="text-[13px] text-muted-foreground">
            Nothing scheduled on this day.
          </p>
          {monthHasEvents && (
            <p className="text-[12px] text-subtle-foreground">
              Tap a tinted date above to see what it holds.
            </p>
          )}
        </div>
      ) : (
        <ul
          key={dayKey}
          className={cn(
            "min-h-0 flex-1 divide-y divide-border overflow-y-auto overscroll-contain scrollbar-slim",
            "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1",
            "motion-safe:duration-(--dur-base) motion-safe:ease-(--ease-out)",
          )}
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          {events.map((event) => (
            <li key={event.id}>
              <ScheduleRow event={event} onSelect={onSelectEvent} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ScheduleRow({
  event,
  onSelect,
}: {
  event: CuratedCalendarEvent;
  onSelect: (event: CuratedCalendarEvent) => void;
}) {
  const category = getCategoryMeta(event.category);
  const isPast = isEventPast(event, useNow());
  const probability = probabilityDisplay(event);
  const emphasis = emphasisOf(event);

  return (
    <button
      type="button"
      onClick={() => onSelect(event)}
      data-schedule-title={event.title}
      data-event-past={isPast ? "true" : "false"}
      /*
       * A calendar row, not a card.
       *
       * This was 62px of minimum and measured 71px in practice, which on a
       * 667px-tall phone left **under two rows** visible under the grid — the
       * reader had to scroll to find out that Tuesday had anything else on it,
       * which is the complaint that "it shows one market at a time". Two things
       * were spending the height: a three-line right-hand column for the
       * probability (outcome, number, the word "odds"), and a meta line the
       * probability had been kept out of.
       *
       * Folding the probability into the meta line costs nothing — it is
       * already written as "Trump 58%", so the name and the number stay
       * together — and takes the row to ~52px, which is four to five rows in
       * the same space.
       */
      className={cn(
        "flex min-h-[52px] w-full items-start gap-2.5 px-3 py-2 text-left",
        "transition-colors motion-safe:duration-(--dur-quick) active:bg-surface-hover",
        isPast && "is-past",
      )}
    >
      {/* A deadline is dimmer than a kickoff — same column, less insistence.
          `pt-px` optically centres it on the first line of the title rather
          than on the whole two-line block. */}
      <span
        className={cn(
          "w-[38px] shrink-0 pt-px text-[11.5px] font-medium tabular-nums",
          event.timeKind === "close" ? "text-subtle-foreground" : "text-muted-foreground",
        )}
      >
        {event.time}
      </span>

      <span
        className={cn("mt-0.5 h-8 w-[3px] shrink-0 rounded-full", category.dot)}
        aria-hidden
      />

      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-start gap-1.5">
          {/* Importance as one filled star and nothing else. A word would cost
              a line of the row, and "Standard" on every other event is a badge
              on nothing — so only Major is marked, where the star is doing the
              same job it does in the desktop chip. */}
          {event.importanceLevel === "major" && (
            <Star
              className="mt-[3px] size-3 shrink-0 fill-current text-subtle-foreground"
              aria-hidden
              strokeWidth={0}
            />
          )}
          {/* Two lines, because a market name is a sentence and one line of
              390px cuts most of them mid-question. */}
          <span className="line-clamp-2 min-w-0 text-[13.5px] font-medium leading-[1.3] text-foreground">
            {event.title}
          </span>
        </span>
        {/*
          One meta line, ordered by how much it tells you: the emphasis, the
          category, the leading outcome, then the volume — which is last
          because it is the first thing worth losing when the line truncates.
        */}
        <span className="truncate text-[11px] leading-tight text-muted-foreground">
          {emphasis ? `${emphasis.label} · ` : ""}
          {category.label}
          {probability ? ` · ${probabilityLabel(probability, 18)}` : ""}
          {` · ${formatCompactUsd(event.volume)}`}
        </span>
      </span>
    </button>
  );
}

/**
 * Memoised for the same reason the grid above it is: the shell re-renders
 * whenever a dialog opens or an event is selected, and none of that changes
 * which day this is showing.
 */
export const MobileDaySchedule = React.memo(MobileDayScheduleInner);
