"use client";

import { Skeleton } from "@/components/ui/primitives";
import { WEEKDAY_LABELS, WEEKDAY_LABELS_SHORT } from "@/lib/calendar";
import type { CalendarView } from "@/lib/url-state";
import { cn } from "@/lib/utils";

/**
 * Skeletons shaped like the view they stand in for.
 *
 * Per-cell counts are derived from the cell index rather than randomly, so the
 * server and client render the same thing and the grid doesn't flicker on
 * hydration.
 */
export function CalendarSkeleton({ view }: { view: CalendarView }) {
  return (
    <>
      <span className="sr-only" role="status">
        Loading events…
      </span>
      <div aria-hidden className="flex min-h-0 flex-1 flex-col">
        {view === "month" && <MonthSkeleton />}
        {view === "week" && <WeekSkeleton />}
        {view === "agenda" && <AgendaSkeleton />}
      </div>
    </>
  );
}

function MonthSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-surface">
      {/* Every measurement here mirrors MonthView's, at both breakpoints. A
          skeleton whose cells are a different height than the grid it precedes
          is a layout shift with extra steps. */}
      <div className="grid shrink-0 grid-cols-7 border-b border-border">
        {WEEKDAY_LABELS.map((label, i) => (
          <div
            key={i}
            className="px-1 py-1.5 text-center text-[10px] uppercase text-muted-foreground sm:px-2 sm:text-[11px]"
          >
            <span className="sm:hidden">{WEEKDAY_LABELS_SHORT[i]}</span>
            <span className="hidden sm:inline">{label}</span>
          </div>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 auto-rows-fr grid-cols-7">
        {Array.from({ length: 42 }, (_, i) => (
          <div
            key={i}
            className="flex min-h-[62px] flex-col gap-px border-b border-r border-border p-0.5 sm:min-h-[112px] sm:gap-1 sm:p-1"
          >
            <Skeleton className="mx-auto size-[22px] rounded-full sm:mx-0 sm:size-6" />
            {/* 0–3 chips, cycling deterministically so density looks uneven. */}
            {Array.from({ length: [2, 0, 3, 1, 2, 1, 0][i % 7] }, (_, j) => (
              <Skeleton key={j} className="h-2.5 w-full rounded sm:h-[18px]" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function WeekSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-surface">
      <div className="flex shrink-0 border-b border-border">
        <div className="w-14 shrink-0 border-r border-border" />
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className="flex flex-1 flex-col items-center gap-1 border-r border-border py-2">
            <Skeleton className="h-3 w-6" />
            <Skeleton className="size-7 rounded-full" />
          </div>
        ))}
      </div>
      <div className="flex shrink-0 border-b border-border bg-surface-sunken/50">
        <div className="w-14 shrink-0 border-r border-border" />
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className="min-h-[38px] flex-1 border-r border-border p-1">
            {i % 3 === 0 && <Skeleton className="h-[18px] w-full rounded" />}
          </div>
        ))}
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="w-14 shrink-0 border-r border-border">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="flex h-12 justify-end pr-1.5">
              <Skeleton className="h-3 w-8" />
            </div>
          ))}
        </div>
        {Array.from({ length: 7 }, (_, col) => (
          <div key={col} className="flex-1 border-r border-border">
            {Array.from({ length: 8 }, (_, row) => (
              <div key={row} className="h-12 border-b border-border/60 p-0.5">
                {(col + row) % 5 === 0 && <Skeleton className="h-[18px] w-full rounded" />}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * One day as a board of hour columns — the same shape the loaded view has, so
 * the swap is a change of content rather than of layout. A skeleton that
 * guesses a different structure makes the real view look like it jumped on
 * arrival.
 */
function AgendaSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-surface">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2.5">
        <Skeleton className="h-4 w-44" />
        <Skeleton className="ml-auto h-3 w-14" />
      </div>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Uneven on purpose: a real day is one busy hour and several quiet
            ones, and a row of identical columns reads as a table. */}
        {[2, 1, 3, 1, 2].map((cards, column) => (
          <div
            key={column}
            className="flex w-[232px] shrink-0 flex-col border-r border-border sm:w-[256px]"
          >
            <div className="flex shrink-0 items-center gap-1.5 border-b border-border px-2.5 py-1.5">
              <Skeleton className="h-3 w-10" />
              <Skeleton className="ml-auto h-2.5 w-3" />
            </div>
            <div className="flex flex-col gap-1.5 p-1.5">
              {Array.from({ length: cards }, (_, card) => {
                // The first card of a column stands in for a featured event.
                const featured = card === 0 && cards > 1;
                return (
                  <div
                    key={card}
                    className="flex flex-col gap-1 rounded-md border border-border p-2"
                  >
                    <div className="flex items-start gap-2">
                      <Skeleton
                        className={cn("shrink-0 rounded", featured ? "size-10" : "size-6")}
                      />
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <Skeleton className="h-3 w-full" />
                        <Skeleton className={cn("h-3", featured ? "w-4/5" : "w-2/3")} />
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Skeleton className="size-1.5 shrink-0 rounded-full" />
                      <Skeleton className="h-2.5 w-2/3" />
                      <Skeleton className="ml-auto h-2.5 w-6" />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
