"use client";

import { format } from "date-fns";
import * as React from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { useIsDesktop } from "@/hooks/use-media-query";
import { useTodayKey } from "@/hooks/use-now";
import type { CuratedCalendarEvent } from "@/lib/curation/types";
import { fromDayKey } from "@/lib/dates";
import { DaySchedule } from "./day-schedule";

export type DayEventsPopoverProps = {
  dayKey: string | null;
  events: CuratedCalendarEvent[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectEvent: (event: CuratedCalendarEvent) => void;
};

const HEADING = "text-[15px] font-semibold leading-tight text-foreground";

/**
 * Everything on one day — the escape hatch from a cell that shows only three.
 *
 * It renders the same clock the day view does, rather than a flat list. A month
 * cell can say *that* Tuesday is busy; the only useful next question is how that
 * day is shaped, and "six things, four of them in the evening" is an answer a
 * list cannot give. Opening this from "+N more" is now the same gesture as
 * switching to the day view, without losing the month behind it.
 */
export function DayEventsPopover({
  dayKey,
  events,
  open,
  onOpenChange,
  onSelectEvent,
}: DayEventsPopoverProps) {
  const isDesktop = useIsDesktop();
  const today = useTodayKey();
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
      <div className="flex min-h-14 shrink-0 items-center gap-2 border-b border-border px-4 py-2 pr-11">
        <DialogTitleSlot isDesktop={isDesktop}>{label}</DialogTitleSlot>
        {dayKey === today && (
          <span className="shrink-0 rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-semibold uppercase leading-tight tracking-wide text-accent-foreground">
            Today
          </span>
        )}
        <span className="ml-auto shrink-0 text-[12px] tabular-nums text-muted-foreground">
          {events.length} event{events.length === 1 ? "" : "s"}
        </span>
      </div>

      <DaySchedule
        key={dayKey}
        dayKey={dayKey ?? ""}
        events={events}
        onSelectEvent={onSelectEvent}
        // The dialog's own cap, less its 56px header. The board inside never
        // scrolls sideways, so this is the only scrolling the dialog does.
        className="max-h-[calc(90vh-3.5rem)] min-h-0 flex-1"
      />
    </div>
  ) : null;

  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        {/*
          Nearly the whole viewport. The body is a board of hour columns that
          share the width and wrap rather than scroll sideways, so the dialog's
          size decides how much of the day is on screen at once — at 896px a
          busy evening still ran off to the right behind a scrollbar.
        */}
        <DialogContent
          aria-describedby={undefined}
          className="flex max-h-[90vh] w-[calc(100vw-2rem)] max-w-[1400px] flex-col overflow-hidden p-0"
        >
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
