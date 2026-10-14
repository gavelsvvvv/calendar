"use client";

import * as HoverCardPrimitive from "@radix-ui/react-hover-card";
import { format } from "date-fns";
import { ExternalLink, Star } from "lucide-react";
import * as React from "react";
import { useFavorites } from "@/hooks/use-favorites";
import { TimeZoneNote } from "@/components/shell/time-zone-note";
import { useIsTouch } from "@/hooks/use-media-query";
import { getCategoryMeta } from "@/lib/categories";
import { isSettled } from "@/lib/curation/types";
import type { CuratedCalendarEvent } from "@/lib/curation/types";
import { fromDayKey } from "@/lib/dates";
import { formatCompactUsd } from "@/lib/format";
import { probabilityDisplay } from "@/lib/probability";
import { cn } from "@/lib/utils";

/**
 * A read-only glance at an event, on hover.
 *
 * Radix's HoverCard rather than its Tooltip: a tooltip may not contain
 * interactive content, and this one holds a link out to Polymarket. HoverCard is
 * also pointer-driven, so it never fires from a tap — which is exactly what we
 * want, since a tap already opens the full details panel.
 *
 * `openDelay` is the whole trick. Without it, dragging the cursor across a dense
 * week fires a card per chip; with 150ms the pointer has to settle on something
 * before anything appears.
 */

export type EventHoverCardProps = {
  event: CuratedCalendarEvent;
  children: React.ReactNode;
};

/**
 * How long the pointer must settle before a card appears. Without it, dragging
 * across a dense week fires one per chip.
 */
const OPEN_DELAY = 150;
const CLOSE_DELAY = 80;

export function EventHoverCard({ event, children }: EventHoverCardProps) {
  const isTouch = useIsTouch();

  /*
   * Nothing is built until a pointer actually arrives.
   *
   * A month grid draws up to 126 chips, and every one of them used to mount a
   * Radix HoverCard — root, provider, popper, trigger, portal and presence —
   * for a card that renders nothing until you hover it. That is around 1,700
   * fibers and 250 context providers per grid, torn down and rebuilt on every
   * view switch and every month step, to support an interaction that happens to
   * at most one chip at a time.
   *
   * The wrapper below is `display: contents`, so it takes part in no layout: the
   * chip is still the grid's child for every purpose except owning this one
   * listener. Once armed it stays armed — a chip you have hovered once is a chip
   * you are likely to hover again, and unmounting it under the cursor would be
   * worse than keeping it.
   */
  const [armed, setArmed] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const timer = React.useRef<number | undefined>(undefined);

  React.useEffect(() => () => window.clearTimeout(timer.current), []);

  /*
   * The first hover is the only one this has to handle.
   *
   * Radix's trigger never saw the `pointerenter` that armed it, so it would sit
   * there until the pointer left and came back. This reproduces its own
   * `openDelay` for that one case — including the part that matters, which is
   * *not* opening if the pointer has moved on by the time the delay is up. From
   * the second hover onwards the trigger exists and owns the timing.
   */
  const onPointerEnter = (event: React.PointerEvent) => {
    if (armed) return;
    const chip = event.target as HTMLElement;
    setArmed(true);
    timer.current = window.setTimeout(() => {
      if (chip.isConnected && chip.matches(":hover")) setOpen(true);
    }, OPEN_DELAY);
  };

  // Touch devices keep the tap-to-open behaviour untouched, and skipping the
  // provider entirely means no listeners are attached on a phone at all.
  if (isTouch) return <>{children}</>;

  if (!armed) {
    return (
      <span className="contents" onPointerEnter={onPointerEnter}>
        {children}
      </span>
    );
  }

  return (
    <HoverCardPrimitive.Root
      open={open}
      onOpenChange={setOpen}
      openDelay={OPEN_DELAY}
      closeDelay={CLOSE_DELAY}
    >
      <HoverCardPrimitive.Trigger asChild>{children}</HoverCardPrimitive.Trigger>
      <HoverCardPrimitive.Portal>
        <HoverCardPrimitive.Content
          side="right"
          align="start"
          sideOffset={6}
          collisionPadding={12}
          className={cn(
            "z-50 w-[288px] rounded-lg border border-border bg-surface p-3 shadow-lg shadow-black/5 dark:shadow-black/40",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0",
            "data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95",
            "data-[side=right]:slide-in-from-left-1 data-[side=left]:slide-in-from-right-1",
            "data-[side=top]:slide-in-from-bottom-1 data-[side=bottom]:slide-in-from-top-1",
          )}
        >
          <HoverPreview event={event} />
        </HoverCardPrimitive.Content>
      </HoverCardPrimitive.Portal>
    </HoverCardPrimitive.Root>
  );
}

function HoverPreview({ event }: { event: CuratedCalendarEvent }) {
  const category = getCategoryMeta(event.category);
  const favorites = useFavorites();
  const settled = isSettled(event.status);
  const probability = probabilityDisplay(event, { includeSettled: true });

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <span className={cn("size-2 shrink-0 rounded-full", category.dot)} aria-hidden />
        <span className={cn("text-[11px] font-medium", category.text)}>{category.label}</span>
        {favorites.has(event.id) && (
          <Star className="size-3 fill-current text-accent" aria-hidden />
        )}
        <span className="ml-auto shrink-0 text-[11px] tabular-nums text-subtle-foreground">
          {event.relatedMarketsCount} market{event.relatedMarketsCount === 1 ? "" : "s"}
        </span>
      </div>

      <p className="text-[13px] font-medium leading-snug text-foreground">{event.title}</p>

      <p className="text-[11px] text-muted-foreground">
        {format(fromDayKey(event.displayDate), "EEE d MMM")}
        {" · "}
        {event.timeKind === "close" ? `closes ${event.time}` : event.time}{" "}
        <TimeZoneNote className="px-0" />
      </p>

      <dl className="flex items-baseline gap-4 border-t border-border pt-2">
        <div>
          <dt className="text-[10px] uppercase tracking-wide text-subtle-foreground">Volume</dt>
          <dd className="text-[13px] tabular-nums text-foreground">
            {formatCompactUsd(event.volume)}
          </dd>
        </div>
        {probability && (
          <div className="min-w-0">
            {/* The label names what the number is about, so a multi-outcome
                event reads "Leading outcome — Trump 58%" rather than offering
                58% as a fact about the election. */}
            <dt className="text-[10px] uppercase tracking-wide text-subtle-foreground">
              {settled ? "Result" : probability.isBinary ? "Probability" : "Leading outcome"}
            </dt>
            <dd className="truncate text-[13px] tabular-nums text-foreground">
              {probability.isBinary ? (
                probability.percent
              ) : (
                <>
                  <span className="font-normal">{probability.outcome}</span>{" "}
                  {probability.percent}
                </>
              )}
            </dd>
          </div>
        )}
      </dl>

      <a
        href={event.primaryMarketUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          "flex items-center justify-center gap-1.5 rounded-md border border-border px-2 py-1.5",
          "text-[12px] font-medium text-foreground transition-colors",
          "motion-safe:duration-(--dur-quick) hover:bg-surface-hover",
        )}
      >
        Open on Polymarket
        <ExternalLink className="size-3" aria-hidden />
      </a>
    </div>
  );
}
