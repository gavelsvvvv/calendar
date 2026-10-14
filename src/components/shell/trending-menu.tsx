"use client";

import { format } from "date-fns";
import { Flame } from "lucide-react";
import * as React from "react";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/primitives";
import { useNow } from "@/hooks/use-now";
import { getCategoryMeta } from "@/lib/categories";
import { isEventPast } from "@/lib/event-time";
import type { CuratedCalendarEvent } from "@/lib/curation/types";
import { fromDayKey } from "@/lib/dates";
import { formatCompactUsd } from "@/lib/format";
import { probabilityDisplay, probabilityLabel } from "@/lib/probability";
import { cn } from "@/lib/utils";

export type TrendingMenuProps = {
  /** Already ranked and capped by `buildCalendarIndex`. */
  events: CuratedCalendarEvent[];
  onSelectEvent: (event: CuratedCalendarEvent) => void;
};

/*
 * There is no `useTrending` here any more.
 *
 * The list is a pure function of the dataset — the next seven days, still to
 * come, by importance — so it is built once with the day buckets and the
 * heatmap in `buildCalendarIndex` and handed down ready. Computing it here meant
 * the app bar scored and sorted the whole month on every render, to fill a
 * popover that is closed.
 */

function Header() {
  return (
    <div className="flex items-center gap-1.5 border-b border-border px-3 py-2.5">
      <Flame className="size-3.5 text-accent" aria-hidden />
      <span className="text-[12px] font-semibold text-foreground">Trending this week</span>
      <span className="ml-auto text-[11px] tabular-nums text-subtle-foreground">next 7 days</span>
    </div>
  );
}

/**
 * The list itself, shared by the desktop popover and the phone sheet.
 *
 * `touch` only changes the row height and the feedback: on a phone the rows are
 * a full 52px and respond to `:active`, because there is no hover to respond to.
 */
function TrendingList({
  events,
  onSelectEvent,
  touch = false,
}: {
  events: CuratedCalendarEvent[];
  onSelectEvent: (event: CuratedCalendarEvent) => void;
  touch?: boolean;
}) {
  const now = useNow();

  if (events.length === 0) {
    return (
      <p className="px-3 py-8 text-center text-[13px] text-muted-foreground">
        Nothing major in the next seven days.
      </p>
    );
  }

  return (
    <ul
      className={cn(
        "overflow-y-auto overscroll-contain scrollbar-slim py-1",
        touch ? "max-h-[70vh]" : "max-h-[min(60vh,420px)]",
      )}
    >
      {events.map((event) => {
        const category = getCategoryMeta(event.category);
        const probability = probabilityDisplay(event);
        // Trending is ranked by the week's volume, so a fixture that has
        // already been played can absolutely be on it.
        const isPast = isEventPast(event, now);
        return (
          <li key={event.id}>
            <button
              type="button"
              data-trending-title={event.title}
              data-event-past={isPast ? "true" : "false"}
              onClick={() => onSelectEvent(event)}
              className={cn(
                isPast && "is-past",
                "flex w-full items-start gap-2.5 px-3 text-left",
                "transition-colors motion-safe:duration-(--dur-quick)",
                touch
                  ? "min-h-[56px] items-center py-2.5 active:bg-surface-hover"
                  : "py-2 hover:bg-surface-hover",
              )}
            >
              <span
                className={cn(
                  "size-2 shrink-0 rounded-full",
                  category.dot,
                  !touch && "mt-1.5",
                )}
                aria-hidden
              />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span
                  className={cn(
                    "line-clamp-2 font-medium leading-snug text-foreground",
                    touch ? "text-[14px]" : "text-[13px]",
                  )}
                >
                  {event.title}
                </span>
                <span className="truncate text-[11px] leading-tight text-muted-foreground">
                  {category.label} · {format(fromDayKey(event.displayDate), "EEE d MMM")} ·{" "}
                  {formatCompactUsd(event.volume)}
                </span>
              </span>
              {probability && (
                <span
                  className={cn(
                    "max-w-[38%] shrink-0 truncate text-right tabular-nums text-muted-foreground",
                    touch ? "text-[13px]" : "mt-0.5 text-[12px]",
                  )}
                >
                  {probabilityLabel(probability, 14)}
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The week ahead, on request.
 *
 * This used to be a panel pinned above the grid, which meant the calendar —
 * the thing people came for — started a couple of hundred pixels down the page
 * whether or not anyone wanted the list. It reads better as something you ask
 * for: a button in the bar, a popover that behaves like a notification tray,
 * and no permanent cost to the calendar's height.
 */
export function TrendingMenu({ events, onSelectEvent }: TrendingMenuProps) {
  const [open, setOpen] = React.useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Trending this week"
          className={cn(
            "flex h-9 shrink-0 items-center gap-1.5 rounded-md px-2.5",
            "text-[13px] font-medium text-muted-foreground",
            "transition-colors motion-safe:duration-(--dur-quick)",
            "hover:text-foreground",
            open && "text-foreground",
            /*
              The border is the gradient, so there is no `border-border` here to
              set or to change on hover — see `.iridescent-orange` in globals.
              The button's own background moves to that rule too, because the
              fill and the gradient are one `background` shorthand and a Tailwind
              `bg-*` class would replace both.
            */
            "iridescent-orange",
          )}
        >
          <Flame
            className={cn(
              "size-4 transition-colors motion-safe:duration-(--dur-quick)",
              open && "text-accent",
            )}
            aria-hidden
          />
          <span className="hidden xl:inline">Trending</span>
        </button>
      </PopoverTrigger>

      <PopoverContent align="end" sideOffset={8} className="w-[340px] p-0">
        <Header />
        <TrendingList
          events={events}
          onSelectEvent={(event) => {
            setOpen(false);
            onSelectEvent(event);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

/**
 * The same list as a bottom sheet, for phones — where the popover's trigger
 * lives in the overflow menu and a floating 340px card would be the wrong shape
 * anyway.
 */
export function TrendingDrawer({
  events,
  open,
  onOpenChange,
  onSelectEvent,
}: TrendingMenuProps & { open: boolean; onOpenChange: (open: boolean) => void }) {

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent aria-describedby={undefined}>
        <div className="flex items-center gap-1.5 border-b border-border px-4 pb-2.5 pt-3">
          <Flame className="size-4 text-accent" aria-hidden />
          <DrawerTitle className="text-[15px] font-semibold text-foreground">
            Trending this week
          </DrawerTitle>
          <span className="ml-auto text-[11px] tabular-nums text-subtle-foreground">
            next 7 days
          </span>
        </div>
        <div className="pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          <TrendingList
            events={events}
            touch
            onSelectEvent={(event) => {
              onOpenChange(false);
              onSelectEvent(event);
            }}
          />
        </div>
      </DrawerContent>
    </Drawer>
  );
}
