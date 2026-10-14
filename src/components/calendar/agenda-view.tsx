"use client";

import { format } from "date-fns";
import { ArrowUp, Star } from "lucide-react";
import Image from "next/image";
import * as React from "react";
import { getCategoryMeta } from "@/lib/categories";
import type { CuratedCalendarEvent } from "@/lib/curation/types";
import { useLocalClock, useNow, useTodayKey } from "@/hooks/use-now";
import { fromDayKey } from "@/lib/dates";
import { isEventPast } from "@/lib/event-time";
import { formatCompactUsd } from "@/lib/format";
import {
  probabilityDescription,
  probabilityDisplay,
  probabilityLabel,
} from "@/lib/probability";
import { cn } from "@/lib/utils";

export type AgendaViewProps = {
  anchor: Date;
  events: CuratedCalendarEvent[];
  eventsByDay: Record<string, CuratedCalendarEvent[]>;
  selectedDate: string | null;
  onSelectDay: (dayKey: string) => void;
  onSelectEvent: (event: CuratedCalendarEvent) => void;
};

const EMPTY: CuratedCalendarEvent[] = [];

/** Days mounted on the first paint — comfortably more than a viewport holds. */
const FIRST_BATCH = 8;
/** Days added per idle callback, and per approach of the end of the list. */
const BATCH = 16;

/**
 * The agenda, built as an editorial timeline rather than a list of cards.
 *
 * Days are separated by sticky headings and rows by hairlines — whitespace and
 * typography do the work that a card would otherwise do badly.
 */
function AgendaViewInner({
  events,
  eventsByDay,
  selectedDate,
  onSelectDay,
  onSelectEvent,
}: AgendaViewProps) {
  const today = useTodayKey();
  const clock = useLocalClock();

  const days = React.useMemo(() => {
    // `YYYY-MM-DD` sorts lexicographically into chronological order.
    const keys = [...new Set(events.map((e) => e.displayDate))].sort();
    return keys.map((dayKey) => ({
      dayKey,
      date: fromDayKey(dayKey),
      events: eventsByDay[dayKey] ?? EMPTY,
    }));
  }, [events, eventsByDay]);

  // An agenda opens where you are, like a diary. Showing the whole grid range
  // meant landing two weeks in the past among already-resolved fixtures.
  const [showEarlier, setShowEarlier] = React.useState(false);
  const firstUpcoming = days.findIndex((d) => d.dayKey >= today);
  const earlierCount = firstUpcoming > 0 ? firstUpcoming : 0;
  // Memoised because its identity is load-bearing: the batching below resets on
  // it, and a fresh `slice` on every render is a fresh identity on every render.
  const visibleDays = React.useMemo(
    () => (earlierCount > 0 && !showEarlier ? days.slice(firstUpcoming) : days),
    [days, earlierCount, firstUpcoming, showEarlier],
  );

  const scrollRef = React.useRef<HTMLDivElement>(null);
  const todayHeadingRef = React.useRef<HTMLDivElement>(null);
  const [showBackToToday, setShowBackToToday] = React.useState(false);

  /*
   * The agenda arrives in batches.
   *
   * A month's worth is ~250 rows of a dozen elements each — around 2,800
   * elements and 250 `next/image` components — and the viewport shows eight of
   * them. Building all of it before the first paint is what made switching into
   * this view feel like a stall.
   *
   * The rest is not dropped, only deferred: each idle callback adds another
   * batch until the whole range is mounted, so anything that inspects the list
   * as a whole still finds it, and a fast scroll is met by the observer below
   * rather than by a gap. Nothing is removed from the dataset — this is purely
   * when the DOM is built.
   */
  const [renderedDays, setRenderedDays] = React.useState(FIRST_BATCH);
  const sentinelRef = React.useRef<HTMLDivElement>(null);

  // A new range, or the earlier days being revealed, starts the batching over.
  // Adjusted during render rather than in an effect: an effect would paint the
  // old month's tail first and then throw it away.
  const [batchedFrom, setBatchedFrom] = React.useState(visibleDays);
  if (batchedFrom !== visibleDays) {
    setBatchedFrom(visibleDays);
    setRenderedDays(FIRST_BATCH);
  }

  const pending = visibleDays.length - renderedDays;

  // Fill in the rest while the browser has nothing better to do.
  React.useEffect(() => {
    if (pending <= 0) return;
    const grow = () => setRenderedDays((n) => n + BATCH);
    const request = window.requestIdleCallback;
    if (typeof request !== "function") {
      const handle = window.setTimeout(grow, 0);
      return () => window.clearTimeout(handle);
    }
    const handle = request(grow, { timeout: 500 });
    return () => window.cancelIdleCallback?.(handle);
  }, [pending]);

  // And meet a fast scroll before it reaches the end of what exists.
  React.useEffect(() => {
    if (pending <= 0) return;
    const target = sentinelRef.current;
    const root = scrollRef.current;
    if (!target || !root) return;
    const observer = new IntersectionObserver(
      ([entry]) => entry.isIntersecting && setRenderedDays((n) => n + BATCH),
      { root, rootMargin: "800px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [pending]);

  // "Back to today" only appears once today's heading has left the viewport.
  React.useEffect(() => {
    const heading = todayHeadingRef.current;
    const root = scrollRef.current;
    if (!heading || !root) {
      setShowBackToToday(false);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => setShowBackToToday(!entry.isIntersecting),
      { root, threshold: 0 },
    );
    observer.observe(heading);
    return () => observer.disconnect();
  }, [visibleDays]);

  const scrollToToday = () => {
    todayHeadingRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    onSelectDay(today);
  };

  /*
   * Nothing to list is a state of the list, not of the application.
   *
   * Agenda is the one view with no structure of its own to preserve — no grid,
   * no timeline, just rows — so a short line where the rows would be is honest
   * here in a way it is not in Month or Week. What it must not do is return a
   * *different* container: the panel keeps its own border, radius and surface
   * so the workspace looks the same shape whether or not anything matched.
   */
  const empty = days.length === 0;

  return (
    <div
      data-agenda-panel
      className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-surface"
    >
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain scrollbar-slim"
      >
        {empty && (
          <p
            data-agenda-empty
            className="px-4 py-10 text-center text-[13px] text-muted-foreground"
          >
            No events match the current filters.
          </p>
        )}
        {earlierCount > 0 && !showEarlier && (
          <button
            type="button"
            onClick={() => setShowEarlier(true)}
            className="min-h-11 w-full border-b border-border px-3 py-2 text-left text-[13px] font-medium text-accent transition-colors motion-safe:duration-(--dur-quick) hover:bg-surface-hover active:bg-surface-hover sm:min-h-0 sm:text-[12px]"
          >
            Show {earlierCount} earlier {earlierCount === 1 ? "day" : "days"}
          </button>
        )}
        {visibleDays.slice(0, renderedDays).map((day) => {
          const isToday = day.dayKey === today;
          return (
            <section key={day.dayKey} aria-label={format(day.date, "d MMMM yyyy")}>
              <div
                ref={isToday ? todayHeadingRef : undefined}
                className="sticky top-0 z-10 flex items-baseline gap-2 border-b border-border bg-surface/95 px-3 py-2 backdrop-blur-sm"
              >
                <h2 className="text-[13px] font-semibold text-foreground">
                  <span className="text-muted-foreground">
                    {format(day.date, "EEE")}
                  </span>{" "}
                  {format(day.date, "d MMMM")}
                </h2>
                {isToday && (
                  <span className="rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-medium leading-tight text-accent-foreground">
                    Today
                  </span>
                )}
                <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">
                  {day.events.length} event{day.events.length === 1 ? "" : "s"}
                </span>
                {/*
                  The reader's own clock, on today's heading and nowhere else —
                  "14:08" beside next Friday would be answering a question
                  nobody asked. Subtle on purpose: it is orientation, not
                  content, so it sits a step below the count that sits a step
                  below the date.

                  Absent until the browser has read its own clock. The server
                  has no way to know the reader's minute, and rendering a guess
                  is a hydration error waiting on the next minute boundary.
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

              <ul className="divide-y divide-border">
                {day.events.map((event) => (
                  <li key={event.id}>
                    <AgendaRow
                      event={event}
                      onSelect={onSelectEvent}
                      isSelectedDay={day.dayKey === selectedDate}
                    />
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
        {pending > 0 && <div ref={sentinelRef} aria-hidden className="h-px" />}
      </div>

      {showBackToToday && (
        <button
          type="button"
          onClick={scrollToToday}
          className="absolute bottom-4 left-1/2 z-20 flex min-h-10 -translate-x-1/2 items-center gap-1.5 rounded-full border border-border bg-surface px-4 text-[13px] font-medium text-foreground shadow-md transition-colors motion-safe:duration-(--dur-quick) motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 hover:bg-surface-hover active:bg-surface-hover"
        >
          <ArrowUp className="size-3.5" aria-hidden />
          Back to today
        </button>
      )}
    </div>
  );
}

const AgendaRow = React.memo(function AgendaRow({
  event,
  onSelect,
  isSelectedDay,
}: {
  event: CuratedCalendarEvent;
  onSelect: (event: CuratedCalendarEvent) => void;
  isSelectedDay: boolean;
}) {
  const category = getCategoryMeta(event.category);
  const isPast = isEventPast(event, useNow());
  const probability = probabilityDisplay(event);

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
      className={cn(
        "flex min-h-[60px] w-full items-center gap-2.5 px-3 py-2.5 text-left sm:min-h-[56px] sm:gap-3 sm:py-2",
        "transition-colors motion-safe:duration-(--dur-quick) hover:bg-surface-hover active:bg-surface-hover",
        isPast && "is-past",
        isSelectedDay && "bg-accent-soft/20",
      )}
    >
      {/* Every event has a time. A "close" one is the day's trading deadline
          rather than a kickoff, so it is dimmer and says so on hover. */}
      <span
        title={
          event.timeKind === "close"
            ? "Polymarket gives no time for this event — trading closes at the end of the day"
            : undefined
        }
        className={cn(
          "w-11 shrink-0 text-[12px] tabular-nums sm:w-14",
          event.timeKind === "close" ? "text-subtle-foreground" : "text-muted-foreground",
        )}
      >
        {event.time}
      </span>

      <span className={cn("size-2 shrink-0 rounded-full", category.dot)} aria-hidden />

      {event.image ? (
        <Image
          src={event.image}
          alt=""
          width={20}
          height={20}
          sizes="20px"
          className="size-5 shrink-0 rounded object-cover"
        />
      ) : (
        <span
          className={cn("size-5 shrink-0 rounded opacity-70", category.dot)}
          aria-hidden
        />
      )}

      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-1.5">
          {event.importanceLevel === "major" && (
            <Star className="size-3 shrink-0 fill-current text-accent" strokeWidth={0} aria-hidden />
          )}
          <span className="truncate text-[14px] font-medium text-foreground sm:text-[13px]">
            {event.title}
          </span>
        </span>
        <span className="truncate text-[11px] text-muted-foreground">
          {category.label} · {formatCompactUsd(event.volume)} volume
          {event.relatedMarketsCount > 1 && ` · ${event.relatedMarketsCount} markets`}
        </span>
      </span>

      {/* The agenda row is the full width of the panel, so a named outcome fits
          beside its number and the two are shown together. */}
      {probability ? (
        <span
          className="shrink-0 text-right text-[13px] tabular-nums text-muted-foreground"
          title={probabilityDescription(probability)}
        >
          {probabilityLabel(probability, 18)}
        </span>
      ) : (
        <span className="shrink-0 text-[11px] capitalize text-subtle-foreground">
          {event.status === "resolved" ? "Resolved" : event.status === "closed" ? "Closed" : ""}
        </span>
      )}
    </button>
  );
});

/**
 * The shell re-renders whenever a dialog opens, a day expands or an event is
 * selected — none of which changes what the grid should draw. Without this the
 * whole view, and every chip in it, re-rendered on each of those.
 */
export const AgendaView = React.memo(AgendaViewInner);
