"use client";

import { CloudOff, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/*
 * There is deliberately no `EmptyState` here any more.
 *
 * It rendered a medallion, a heading, a line of explanation and a button, and
 * the shell swapped it in for the whole calendar whenever the active filters
 * matched nothing — no categories selected, a search with no hits, a quiet
 * month. That is the wrong trade in every one of those cases. The grid *is* the
 * answer to "what did my filters just do", so removing it to explain itself
 * leaves the reader nothing to navigate, nothing to compare against, and a
 * screen that reads as broken rather than empty. It also took Today, the
 * selected day, the weekday headers and the whole week timeline with it.
 *
 * What replaced it is smaller in every sense: the calendar always renders, the
 * sidebar keeps a one-line note beside the boxes it refers to, the shell prints
 * one muted line above the grid, and Agenda — the only view with no structure
 * of its own to preserve — puts a short line where its rows would be.
 *
 * `ErrorState` stays. A failed fetch is not a filter state: there is genuinely
 * no calendar to draw, and the reader needs somewhere to press Try again.
 */

/** Centred column for the one state that really does own the whole panel. */
const SHELL =
  "mx-auto flex max-w-sm flex-col items-center px-6 py-14 text-center motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:duration-(--dur-slow) motion-safe:ease-(--ease-out)";

const MEDALLION =
  "mb-4 flex size-12 items-center justify-center rounded-2xl bg-surface-sunken ring-1 ring-border/60";

export function ErrorState({
  message,
  onRetry,
}: {
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div className={SHELL}>
      <span className={MEDALLION}>
        <CloudOff className="size-5 text-muted-foreground" aria-hidden />
      </span>
      <p className="text-[15px] font-semibold tracking-tight text-foreground">
        Couldn&rsquo;t load events
      </p>
      {message && (
        <p className="mt-1.5 text-[12px] leading-relaxed text-subtle-foreground">{message}</p>
      )}
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry} className="mt-5 h-10 sm:h-8">
          Try again
        </Button>
      )}
    </div>
  );
}

/**
 * Fallback data must never pass for live data — this says so plainly, inline,
 * without hijacking the page with a modal or a toast.
 */
export function StaleDataNotice({ className }: { className?: string }) {
  return (
    <p
      role="status"
      className={cn(
        "flex items-start gap-2 rounded-lg border border-border bg-surface-sunken px-3 py-2.5 text-[12px] leading-relaxed text-muted-foreground",
        "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-1 motion-safe:duration-(--dur-slow) motion-safe:ease-(--ease-out)",
        className,
      )}
    >
      <WifiOff className="mt-px size-3.5 shrink-0" aria-hidden />
      <span>
        <span className="font-medium text-foreground">Showing cached calendar data.</span>{" "}
        Polymarket couldn&rsquo;t be reached, so these events may be out of date.
      </span>
    </p>
  );
}
