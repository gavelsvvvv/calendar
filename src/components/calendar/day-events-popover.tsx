"use client";

import { format } from "date-fns";
import * as React from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { useIsDesktop } from "@/hooks/use-media-query";
import { useNow } from "@/hooks/use-now";
import type { CuratedCalendarEvent } from "@/lib/curation/types";
import { fromDayKey } from "@/lib/dates";
import { isEventPast } from "@/lib/event-time";
import { cn } from "@/lib/utils";
import { EventChip } from "./event-chip";

export type DayEventsPopoverProps = {
  dayKey: string | null;
  events: CuratedCalendarEvent[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectEvent: (event: CuratedCalendarEvent) => void;
};

const HEADING = "text-[15px] font-semibold leading-tight text-foreground";

/** Everything on one day — the escape hatch from a cell that shows only three. */
export function DayEventsPopover({
  dayKey,
  events,
  open,
  onOpenChange,
  onSelectEvent,
}: DayEventsPopoverProps) {
  const isDesktop = useIsDesktop();
  const now = useNow();
  const label = dayKey ? format(fromDayKey(dayKey), "EEEE d MMMM") : null;

  const body = label ? (
    <div className="flex min-h-0 flex-1 flex-col">
      {/*
        `items-center`, not `items-baseline` — the close button is a square, and
        aligning text to a baseline left the title sitting below its centre.
        The height is deliberate too: the shared dialog close sits at `top-3`
        and is `size-8`, so its centre is 28px down. A 56px header centres its
        content on exactly that. Anything shorter and the two are visibly off.
      */}
      <div className="flex min-h-14 items-center gap-2 border-b border-border px-4 py-2 pr-11">
        <DialogTitleSlot isDesktop={isDesktop}>{label}</DialogTitleSlot>
        <span className="ml-auto shrink-0 text-[12px] tabular-nums text-muted-foreground">
          {events.length} event{events.length === 1 ? "" : "s"}
        </span>
      </div>
      {events.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-muted-foreground">
          Nothing scheduled on this day.
        </p>
      ) : (
        <ul
          className="max-h-[60vh] overflow-y-auto overscroll-contain scrollbar-slim p-2"
          style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
        >
          {events.map((event) => (
            <li key={event.id} className="flex min-h-11 items-center gap-2">
              {/* The time the cell had no room for. A close time is dimmer —
                  it is the day's trading deadline, not when the thing starts.

                  `is-past` here as well as on the chip beside it, because the
                  two are siblings rather than nested: without it the column of
                  times stayed at full strength beside a row of finished events
                  and undid the distinction the chip was drawing. */}
              <span
                className={cn(
                  "w-11 shrink-0 pl-1 text-[11px] tabular-nums",
                  isEventPast(event, now) && "is-past",
                  event.timeKind === "close"
                    ? "text-subtle-foreground"
                    : "text-muted-foreground",
                )}
              >
                {event.time}
              </span>
              <EventChip
                event={event}
                onSelect={onSelectEvent}
                variant="agenda"
                className="min-w-0 flex-1"
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  ) : null;

  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent aria-describedby={undefined} className="max-w-sm overflow-hidden p-0">
          {body ?? <DialogTitle className="sr-only">Day events</DialogTitle>}
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent aria-describedby={undefined}>
        {body ?? <DrawerTitle className="sr-only">Day events</DrawerTitle>}
      </DrawerContent>
    </Drawer>
  );
}

/** The accessible name has to come from the right primitive for each shell. */
function DialogTitleSlot({
  isDesktop,
  children,
}: {
  isDesktop: boolean;
  children: React.ReactNode;
}) {
  return isDesktop ? (
    <DialogTitle className={HEADING}>{children}</DialogTitle>
  ) : (
    <DrawerTitle className={HEADING}>{children}</DrawerTitle>
  );
}
