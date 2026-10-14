"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import * as React from "react";
import type { CalendarView } from "@/lib/url-state";
import { ViewSwitcher } from "./view-switcher";

export type MobileToolbarProps = {
  view: CalendarView;
  onViewChange: (view: CalendarView) => void;
  onPrevious: () => void;
  onNext: () => void;
};

/**
 * The bottom toolbar, phones only.
 *
 * Two things drove this. The view switcher lived in a `hidden md:block`, which
 * meant that on a phone there was no way to change view at all — you got
 * whatever the URL said and stayed there. And the top bar had accumulated eight
 * controls, so at 375px the month title was being truncated to nothing.
 *
 * Moving stepping and view switching down here fixes both: it is the half of the
 * screen a thumb actually reaches, the targets can be a full 44px without
 * fighting for room, and the top bar is left with the four things that belong in
 * a title bar.
 */
export function MobileToolbar({
  view,
  onViewChange,
  onPrevious,
  onNext,
}: MobileToolbarProps) {
  const unit = view === "week" ? "week" : "month";

  return (
    <div
      data-testid="mobile-toolbar"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 backdrop-blur-sm md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={onPrevious}
          data-nav="previous"
          aria-label={`Previous ${unit}`}
          className="flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors motion-safe:duration-(--dur-quick) active:bg-surface-hover active:text-foreground"
        >
          <ChevronLeft className="size-5" aria-hidden />
        </button>

        <ViewSwitcher view={view} onChange={onViewChange} fill alwaysShowLabels />

        <button
          type="button"
          onClick={onNext}
          data-nav="next"
          aria-label={`Next ${unit}`}
          className="flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors motion-safe:duration-(--dur-quick) active:bg-surface-hover active:text-foreground"
        >
          <ChevronRight className="size-5" aria-hidden />
        </button>
      </div>
    </div>
  );
}
