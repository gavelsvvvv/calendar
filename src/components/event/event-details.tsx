"use client";

import { format } from "date-fns";
import { Check, ExternalLink, Info, Link2, Star } from "lucide-react";
import Image from "next/image";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { useFavorites } from "@/hooks/use-favorites";
import { TimeZoneNote } from "@/components/shell/time-zone-note";
import { useIsDesktop } from "@/hooks/use-media-query";
import { getCategoryMeta } from "@/lib/categories";
import { isSettled } from "@/lib/curation/types";
import type { CuratedCalendarEvent, EventStatus, RelatedMarket } from "@/lib/curation/types";
import { fromDayKey } from "@/lib/dates";
import { formatFullUsd } from "@/lib/format";
import { emphasisOf } from "@/lib/emphasis";
import { probabilityDisplay } from "@/lib/probability";
import {
  ensureRelatedMarkets,
  readRelatedMarkets,
  relatedMarketsVersion,
  serverRelatedMarketsVersion,
  subscribeToRelatedMarkets,
} from "@/lib/related-markets";
import { cn } from "@/lib/utils";
import { AddToCalendarMenu } from "./add-to-calendar-menu";
import { RelatedMarkets } from "./related-markets";

export type EventDetailsProps = {
  event: CuratedCalendarEvent | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Which calendar the event came from — the legs are fetched per month. */
  includeSmallerMarkets?: boolean;
};

/**
 * The event's legs, which the calendar payload deliberately leaves out.
 *
 * Usually already here: the month prefetches them on idle once it has painted.
 * When a panel opens sooner than that, this asks for them and the disclosure
 * appears when they land.
 */
function useRelatedMarkets(
  event: CuratedCalendarEvent | null,
  includeSmallerMarkets: boolean,
) {
  React.useSyncExternalStore(
    subscribeToRelatedMarkets,
    relatedMarketsVersion,
    serverRelatedMarketsVersion,
  );

  const monthKey = event?.displayDate.slice(0, 7);
  React.useEffect(() => {
    if (monthKey) ensureRelatedMarkets(monthKey, includeSmallerMarkets);
  }, [monthKey, includeSmallerMarkets]);

  if (!event) return EMPTY_MARKETS;
  // An event that arrived with its legs attached — from a payload built before
  // this split, or a test fixture — keeps them.
  return event.relatedMarkets ?? readRelatedMarkets(event.id) ?? EMPTY_MARKETS;
}

const EMPTY_MARKETS: RelatedMarket[] = [];

const HEADING = "text-[17px] font-semibold leading-snug text-foreground";

const STATUS_LABEL: Record<EventStatus, string> = {
  upcoming: "Upcoming",
  live: "Live",
  resolved: "Resolved",
  // Settled with nothing paying out: the book was voided rather than decided,
  // which is a different thing to tell a reader than "Resolved".
  closed: "Closed",
  cancelled: "Cancelled",
};

/** Everything about one event, without becoming a dashboard. */
export function EventDetails({
  event,
  open,
  onOpenChange,
  includeSmallerMarkets = false,
}: EventDetailsProps) {
  const isDesktop = useIsDesktop();
  const relatedMarkets = useRelatedMarkets(event, includeSmallerMarkets);

  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent aria-describedby={undefined} className="max-w-md overflow-hidden p-0">
          {event ? (
            <Body
              event={event}
              relatedMarkets={relatedMarkets}
              heading={<DialogTitle className={HEADING}>{event.title}</DialogTitle>}
            />
          ) : (
            <DialogTitle className="sr-only">Event details</DialogTitle>
          )}
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent aria-describedby={undefined}>
        {event ? (
          <Body
            event={event}
            relatedMarkets={relatedMarkets}
            heading={<DrawerTitle className={HEADING}>{event.title}</DrawerTitle>}
          />
        ) : (
          <DrawerTitle className="sr-only">Event details</DrawerTitle>
        )}
      </DrawerContent>
    </Drawer>
  );
}

function Body({
  event,
  relatedMarkets,
  heading,
}: {
  relatedMarkets: RelatedMarket[];
  event: CuratedCalendarEvent;
  heading: React.ReactNode;
}) {
  const category = getCategoryMeta(event.category);
  // The row is labelled Result once an event is settled, so the number is
  // the answer rather than a forecast and belongs there.
  const probability = probabilityDisplay(event, { includeSettled: true });
  const emphasis = emphasisOf(event);
  const favorites = useFavorites();
  const starred = favorites.has(event.id);
  const [copied, setCopied] = React.useState(false);
  const timeoutRef = React.useRef<number | null>(null);

  React.useEffect(
    () => () => {
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    },
    [],
  );

  const copyLink = async () => {
    if (typeof window === "undefined" || !navigator.clipboard) return;
    const url = `${window.location.origin}/?selected=${event.displayDate}&q=${encodeURIComponent(event.title)}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
      timeoutRef.current = window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be blocked by permissions; failing quietly is fine here.
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain scrollbar-slim px-4 pb-4 pt-4">
        <div className="flex items-center gap-2.5 pr-9">
          {event.image ? (
            <Image
              src={event.image}
              alt=""
              width={40}
              height={40}
              sizes="40px"
              className="size-10 shrink-0 rounded-md border border-border object-cover"
            />
          ) : (
            <span className={cn("size-10 shrink-0 rounded-md opacity-75", category.dot)} aria-hidden />
          )}
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className={cn("text-[12px] font-medium", category.text)}>
              {category.label}
            </span>
            {/* The label carries the number that earned it. "Major" alone
                reads as a verdict on the event; "Major · $18.4M volume" reads
                as what it is — a note about how much is being traded. */}
            {emphasis && (
              <span
                className="rounded bg-surface-sunken px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground"
                title={emphasis.explanation}
              >
                {emphasis.label}
                <span className="font-normal"> · {emphasis.note}</span>
              </span>
            )}
            <span className="rounded bg-surface-sunken px-1.5 py-0.5 text-[11px] text-muted-foreground">
              {STATUS_LABEL[event.status]}
            </span>
          </div>

          {/* Icon only, and pulled to the end of the metadata row: the dialog
              already owns the top-right corner for its close button. */}
          <button
            type="button"
            aria-pressed={starred}
            aria-label={starred ? "Remove from favorites" : "Save to favorites"}
            title={starred ? "Remove from favorites" : "Save to favorites"}
            onClick={() => favorites.toggle(event.id)}
            className={cn(
              "ml-auto flex size-10 shrink-0 items-center justify-center rounded-md sm:size-8",
              "transition-colors motion-safe:duration-(--dur-quick)",
              starred
                ? "text-accent hover:bg-accent-soft/60"
                : "text-subtle-foreground hover:bg-surface-hover hover:text-foreground",
            )}
          >
            <Star className={cn("size-5 sm:size-[18px]", starred && "fill-current")} aria-hidden />
          </button>
        </div>

        <div className="mt-3">{heading}</div>

        <p className="mt-1.5 text-[13px] text-muted-foreground">
          {format(fromDayKey(event.displayDate), "EEEE d MMMM yyyy")}
          {" · "}
          {event.timeKind === "close" ? `Closes ${event.time}` : event.time}{" "}
          <TimeZoneNote className="px-0" />
        </p>

        {event.dateConfidence === "estimated" && (
          <p className="mt-1.5 flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
            <Info className="mt-0.5 size-3 shrink-0" aria-hidden />
            <span>
              Date is estimated — Polymarket&rsquo;s market and event dates disagree.
            </span>
          </p>
        )}

        <dl className="mt-3 divide-y divide-border border-y border-border">
          <Row label="Volume">{formatFullUsd(event.volume)}</Row>
          <Row label="Liquidity">
            {event.liquidity > 0 ? formatFullUsd(event.liquidity) : "—"}
          </Row>
          {/*
            Once the outcome is known the number is a result, not a forecast:
            labelling a settled 100% "Probability" reads as a prediction.

            And for anything with more than one outcome the row is titled
            "Leading outcome", with the name carrying the number. The details
            panel is the one surface with room to be explicit, and the whole
            point is that 58% is never offered as a property of the *event* —
            the election does not have a probability, its front-runner does.
            The full book is listed underneath in Related markets.
          */}
          {/* Settled wins over shape: once the answer is known the row is the
              Result whether one outcome was on offer or twelve, and calling a
              decided match's winner the "leading outcome" reads as though it
              were still in play. */}
          <Row
            label={
              isSettled(event.status)
                ? "Result"
                : probability && !probability.isBinary
                  ? "Leading outcome"
                  : "Probability"
            }
          >
            {probability ? (
              probability.isBinary ? (
                probability.percent
              ) : (
                <>
                  <span className="font-normal">{probability.outcome}</span>
                  <span className="ml-1.5 tabular-nums">{probability.percent}</span>
                </>
              )
            ) : (
              "—"
            )}
          </Row>
          <Row label="Related markets">{event.relatedMarketsCount}</Row>
        </dl>

        {/* Why this one is emphasised, in a sentence, and honest about what the
            emphasis is: a ranking inside the loaded range, not a claim that the
            event matters more than the ones without a badge. */}
        {emphasis && (
          <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-relaxed text-subtle-foreground">
            <Info className="mt-px size-3 shrink-0" aria-hidden />
            <span>{emphasis.explanation}</span>
          </p>
        )}

        {event.description && (
          <p className="mt-3 line-clamp-3 text-[12px] leading-relaxed text-muted-foreground">
            {event.description}
          </p>
        )}

        <div className="mt-3">
          <RelatedMarkets
            markets={relatedMarkets}
            totalCount={event.relatedMarketsCount}
          />
        </div>
      </div>

      <div className="shrink-0 border-t border-border px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <Button asChild variant="default" size="touch" className="w-full">
          <a href={event.primaryMarketUrl} target="_blank" rel="noopener noreferrer">
            Open on Polymarket
            <ExternalLink aria-hidden />
          </a>
        </Button>
        <div className="mt-2 flex items-center gap-2">
          <AddToCalendarMenu event={event} />
          <Button
            variant="ghost"
            size="sm"
            onClick={copyLink}
            className="h-10 gap-1.5 sm:h-8"
          >
            {copied ? <Check aria-hidden /> : <Link2 aria-hidden />}
            {copied ? "Copied" : "Copy link"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-6 py-2">
      <dt className="shrink-0 text-[12px] text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right text-[12px] font-medium text-foreground">{children}</dd>
    </div>
  );
}
