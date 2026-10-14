"use client";

import { Star } from "lucide-react";
import * as React from "react";
import { EventHoverCard } from "@/components/event/event-hover-card";
import { useNow } from "@/hooks/use-now";
import { getCategoryMeta } from "@/lib/categories";
import { isEventPast } from "@/lib/event-time";
import { formatCompactUsd } from "@/lib/format";
import {
  probabilityDescription,
  probabilityDisplay,
  probabilityLabel,
} from "@/lib/probability";
import type { CuratedCalendarEvent } from "@/lib/curation/types";
import { cn } from "@/lib/utils";

export type EventChipProps = {
  event: CuratedCalendarEvent;
  onSelect: (event: CuratedCalendarEvent) => void;
  variant?: "month" | "agenda" | "week";
  className?: string;
};

function isMajorLevel(level: CuratedCalendarEvent["importanceLevel"]): boolean {
  return level === "major";
}

const STATUS_WORD: Record<CuratedCalendarEvent["status"], string> = {
  upcoming: "Upcoming",
  live: "Live",
  resolved: "Resolved",
  closed: "Closed",
  cancelled: "Cancelled",
};

/**
 * One event, the way Google Calendar draws one: a time, a colour, a title.
 *
 * No thumbnail, no card, no border box — a month cell holds three of these and
 * has to stay scannable. The probability is a secondary number and only appears
 * when it is both meaningful and the event is notable enough to warrant it.
 */
export const EventChip = React.memo(function EventChip({
  event,
  onSelect,
  variant = "month",
  className,
}: EventChipProps) {
  const category = getCategoryMeta(event.category);
  const isMajor = event.importanceLevel === "major";
  const isImportant = event.importanceLevel === "important";
  const isPast = isEventPast(event, useNow());

  /*
   * A number only when it means something on its own.
   *
   * `probabilityDisplay` already refuses to hand back a figure it cannot
   * attribute. What is decided here is narrower: a month cell is ~150px of
   * chip after the time and the dot, and "Manchester City 54%" does not fit
   * beside a title in that. So the month variant shows a percentage only when
   * it is a plain yes/no — the one shape whose subject is the title already
   * next to it. Named outcomes keep their number in agenda, week and the hover
   * card, where the name fits beside it.
   */
  const probability = probabilityDisplay(event);
  const showProbability =
    probability !== null &&
    (variant === "month"
      ? probability.isBinary && isMajorLevel(event.importanceLevel)
      : event.importanceLevel !== "standard");

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    // Leave modified clicks to the browser so "open in new tab" keeps working.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    onSelect(event);
  };

  const spokenTime =
    event.timeKind === "close" ? `closes ${event.time}` : event.time;
  const label = [
    event.title,
    category.label,
    spokenTime,
    event.importanceLevel !== "standard" ? `${event.importanceLevel} event` : "",
    STATUS_WORD[event.status],
  ]
    .filter(Boolean)
    .join(". ");

  return (
    <EventHoverCard event={event}>
      <a
        href={event.primaryMarketUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={handleClick}
        // No `title`: the browser's own tooltip would race the hover card and
        // arrive later, leaving two overlapping descriptions of one chip.
        aria-label={`${label}. Open details.`}
        data-event-title={event.title}
        data-event-category={event.category}
        data-event-importance={event.importanceLevel}
        data-event-past={isPast ? "true" : "false"}
        data-event-status={event.status}
        data-event-time={event.time}
        className={cn(
          // transform, not size or margin: a chip lives inside a fixed-height
          // grid cell and anything that touches layout would nudge its siblings.
          /*
            `overflow-hidden` is the containment backstop, and it is the fix for
            a real bug rather than tidiness. A week chip's fixed-width parts —
            the probability and the volume, both `shrink-0` — add up to about
            149px, and a seven-column week on a 390px phone gave each chip ~83px
            to put them in. Flexbox cannot shrink a `shrink-0` child, so the
            excess was simply painted outside the element, which in a week grid
            means on top of the following day. Tuesday's volume was landing in
            Wednesday.
          */
          "group flex w-full items-center gap-1.5 overflow-hidden rounded px-1 text-left",
          "transition-[background-color,color,transform] motion-safe:duration-(--dur-quick) motion-safe:ease-(--ease-out)",
          "motion-safe:hover:-translate-y-px",
          isPast && "is-past",
          variant === "month"
            ? cn(
                "h-[21px]",
                // On a phone the chip is a dot in a row, not a row in a stack:
                // no width, no padding, and inert, because the *cell* is the
                // target and a 7px anchor is a lottery for a thumb.
                "max-sm:pointer-events-none max-sm:h-auto max-sm:w-auto max-sm:gap-0 max-sm:p-0",
              )
            : "min-h-[28px] py-1",
          isMajor && cn("border-l-2 pl-1", category.chip, category.border),
          isImportant && !isMajor && "bg-surface-sunken font-medium",
          !isMajor && !isImportant && "hover:bg-surface-hover",
          isMajor && "font-medium",
          // Every surface treatment above is a desktop one; below `sm` the chip
          // is only its dot and a tinted background behind it reads as grime.
          variant === "month" && "max-sm:border-0 max-sm:bg-transparent",
          className,
        )}
      >
        {/*
          A phone's month cell is ~53px wide. A time, a dot and a title in 53px
          is not a compressed chip, it is four unreadable characters — so below
          `sm` an event is a dot, the way every native calendar resolves the
          same arithmetic, and the titles live in the day schedule underneath
          the grid where there is room to read them.

          A major event gets a bigger dot — importance is the one thing worth
          distinguishing at this size. Size rather than a ring: a ring has to be
          drawn in *some* colour, and the only honest one is the cell's
          background, which is a different tint on every density level.
        */}
        {variant === "month" && (
          <span
            aria-hidden
            className={cn(
              "hidden shrink-0 rounded-full max-sm:block",
              category.dot,
              isMajor ? "size-[8px]" : "size-[5px]",
            )}
          />
        )}

        <span
          className={cn(
            "flex min-w-0 flex-1 items-center gap-1.5",
            variant === "month" && "max-sm:hidden",
          )}
        >
          {/* A deadline is dimmer than a scheduled time — same column, less
              insistence, so a row of primaries all reading 23:59 recedes behind
              the fixtures that really do start when they say. */}
          {variant === "month" && (
            <span
              className={cn(
                "shrink-0 text-[11px] tabular-nums",
                event.timeKind === "close" ? "text-subtle-foreground" : "text-muted-foreground",
              )}
            >
              {event.time}
            </span>
          )}

          {isMajor && (
            <Star className="size-2.5 shrink-0 fill-current" aria-hidden strokeWidth={0} />
          )}

          <span className={cn("size-1.5 shrink-0 rounded-full", category.dot)} aria-hidden />

          <span className="min-w-0 flex-1 truncate text-[12px] leading-none text-foreground">
            {variant === "month" ? event.shortTitle : event.title}
          </span>

          {/*
            Detail earns its place by width, and a week column has almost none.
            The arithmetic, measured: the star, dot, probability and volume are
            all `shrink-0`, so only the title can give ground. At a named
            outcome — "Paris Saint-G… 56%" — the probability alone is 109px and
            the row needs 184px of intrinsic width. A week column is 95px at
            390px of viewport and still only 98px at 1024, so the title was
            being squeezed to *zero* and the two fixed spans painted 97px past
            the column's right edge: Tuesday's volume rendered inside
            Wednesday, on top of Wednesday's own chips.

            So in a week the probability drops its outcome name and shows the
            bare percent (~28px), and the volume steps out entirely — it is on
            the hover card and in the detail sheet, and it is the first thing
            worth losing. Below `md`, where the column is 132px and the title
            is the whole point, both go. Month and agenda rows are the width of
            the panel and keep everything.
          */}
          {showProbability && probability && (
            <span
              className={cn(
                "shrink-0 text-[11px] tabular-nums text-muted-foreground",
                variant === "week" && "max-md:hidden",
              )}
              title={probabilityDescription(probability)}
            >
              {variant === "week" ? probability.percent : probabilityLabel(probability, 14)}
            </span>
          )}

          {variant === "agenda" && (
            <span className="shrink-0 text-[11px] tabular-nums text-subtle-foreground">
              {formatCompactUsd(event.volume)}
            </span>
          )}
        </span>
      </a>
    </EventHoverCard>
  );
});
