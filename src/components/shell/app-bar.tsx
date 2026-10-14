"use client";

import { endOfWeek, format, isSameMonth, startOfWeek } from "date-fns";
import { CalendarPlus, ChevronLeft, ChevronRight, HelpCircle, Menu, Search } from "lucide-react";
import * as React from "react";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Button } from "@/components/ui/button";
import { WEEK_STARTS_ON } from "@/lib/calendar";
import type { CalendarView } from "@/lib/url-state";
import type { CuratedCalendarEvent } from "@/lib/curation/types";
import { Brand } from "./brand";
import { OverflowMenu } from "./overflow-menu";
import { TimeZoneNote } from "./time-zone-note";
import { TrendingMenu } from "./trending-menu";
import { ViewSwitcher } from "./view-switcher";

export type AppBarProps = {
  view: CalendarView;
  anchor: Date;
  /** Unfiltered, so "big this week" doesn't change with the category boxes. */
  trendingEvents: CuratedCalendarEvent[];
  onSelectTrending: (event: CuratedCalendarEvent) => void;
  /** Phones reach trending through the overflow menu, as a sheet. */
  onOpenTrending: () => void;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onPrevious: () => void;
  onNext: () => void;
  /** The logo: Month view, this month, today selected, overlays closed. */
  onHome: () => void;
  onToday: () => void;
  onViewChange: (view: CalendarView) => void;
  onOpenSearch: () => void;
  onOpenHelp: () => void;
  onOpenSubscribe: () => void;
};

function periodTitle(view: CalendarView, anchor: Date): string {
  if (view !== "week") return format(anchor, "MMMM yyyy");
  const start = startOfWeek(anchor, { weekStartsOn: WEEK_STARTS_ON });
  const end = endOfWeek(anchor, { weekStartsOn: WEEK_STARTS_ON });
  return isSameMonth(start, end)
    ? `${format(start, "d")} – ${format(end, "d MMMM yyyy")}`
    : `${format(start, "d MMM")} – ${format(end, "d MMM yyyy")}`;
}

/**
 * The one fixed thing on the page: where you are and how to move.
 *
 * Two arrangements, chosen by CSS rather than by JavaScript so there is no
 * hydration flash. On a phone the bar keeps only what a title bar is for — the
 * drawer, the title, today, search — and hands stepping and view switching to
 * the bottom toolbar and everything else to the overflow menu. It had grown to
 * eight controls, which at 375px left the title truncated to a few characters.
 */
export function AppBar({
  view,
  anchor,
  trendingEvents,
  onSelectTrending,
  onOpenTrending,
  sidebarOpen,
  onToggleSidebar,
  onPrevious,
  onNext,
  onHome,
  onToday,
  onViewChange,
  onOpenSearch,
  onOpenHelp,
  onOpenSubscribe,
}: AppBarProps) {
  const title = React.useMemo(() => periodTitle(view, anchor), [view, anchor]);
  const unit = view === "week" ? "week" : "month";

  return (
    /*
     * The bar's priority order, top to bottom, and what gives way first.
     *
     * Browser zoom is the reason this matters: at 150% a 1920px screen reports
     * a 1280px viewport, and the bar has to survive that the same way it
     * survives a small laptop. It did not. Every control was `shrink-0` and the
     * month title was the only flexible thing in the row, so the deficit went
     * entirely to the title — measured at **0px wide** at 1280 and 1024, with
     * the right-hand group still overflowing the viewport by up to 61px. The
     * reader lost the date, which is the one thing a calendar header exists to
     * say, and kept the theme toggle.
     *
     * So the tiers are explicit now, and each turns on only where it measurably
     * fits rather than at whichever breakpoint looked plausible:
     *
     *   always      menu, mark, Today, the title
     *   md (768)    step back/forward, the Month/Week/Agenda switcher
     *   lg (1024)   wordmark, timezone, Trending, Help, Subscribe, theme
     *   xl (1280)   the search *field* rather than its icon
     *   2xl (1536)  the word "Subscribe" beside its icon
     *
     * Everything in the lg tier lives in the overflow menu below it, so nothing
     * is unreachable at any width — it is one tap further away.
     *
     * `overflow-hidden` is the backstop: if some future control still does not
     * fit, it gets clipped at the bar's edge instead of being painted over the
     * calendar or pushing the document sideways.
     */
    <header className="sticky top-0 z-40 flex h-[var(--app-bar-height)] shrink-0 items-center gap-1 overflow-hidden border-b border-border bg-surface px-1.5 sm:gap-2 sm:px-3">
      <Button
        variant="ghost"
        size="icon"
        onClick={onToggleSidebar}
        aria-expanded={sidebarOpen}
        aria-controls="calendar-sidebar"
        aria-label={sidebarOpen ? "Hide filters" : "Show filters"}
        className="size-11 shrink-0 md:size-9"
      >
        <Menu className="size-5 md:size-4" />
      </Button>

      {/* The mark shows from `sm`; the wordmark costs 120px and only earns it
          once the bar is wide enough that the title is not paying for it. */}
      <Brand className="mr-1 hidden sm:inline-flex" nameFrom="lg" onHome={onHome} />

      <Button
        variant="outline"
        size="sm"
        onClick={onToday}
        className="h-10 shrink-0 px-3 sm:ml-1 md:h-8 md:px-2.5"
      >
        Today
      </Button>

      {/* Stepping is a bottom-toolbar job on phones, where a thumb can reach it. */}
      <div className="hidden shrink-0 items-center md:flex">
        <Button
          variant="ghost"
          size="icon"
          onClick={onPrevious}
          data-nav="previous"
          aria-label={`Previous ${unit}`}
        >
          <ChevronLeft />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={onNext}
          data-nav="next"
          aria-label={`Next ${unit}`}
        >
          <ChevronRight />
        </Button>
      </div>

      {/* `flex-1` on the title itself rather than a spacer beside it: the
          title is what should absorb the slack, and making it the flex child
          means it also keeps a share of the space instead of being the only
          thing squeezed out of the row. */}
      <h1
        aria-live="polite"
        data-period-label
        className="min-w-0 flex-1 truncate px-1 text-[15px] font-semibold tracking-tight text-foreground sm:px-0 sm:font-medium sm:text-[17px]"
      >
        {title}
      </h1>

      {/* Which clock these times are on. Stated once, quietly, beside the date
          it qualifies — a calendar that converts silently is one you have to
          take on trust. The full zone name is in the tooltip. */}
      <TimeZoneNote className="hidden lg:inline-block" />

      <div className="flex shrink-0 items-center gap-1 sm:gap-2">
        {/* Looks like a search field where there's room, an icon where there isn't. */}
        <button
          type="button"
          onClick={onOpenSearch}
          aria-label="Search events"
          className="hidden h-9 w-44 items-center gap-2 rounded-md border border-border bg-surface-sunken px-2.5 text-left text-[13px] text-muted-foreground transition-colors motion-safe:duration-(--dur-quick) hover:border-border-strong xl:flex 2xl:w-56"
        >
          <Search className="size-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 truncate">Search events</span>
          <kbd className="shrink-0 rounded border border-border bg-surface px-1 text-[10px] text-subtle-foreground">
            /
          </kbd>
        </button>
        <Button
          variant="ghost"
          size="icon"
          onClick={onOpenSearch}
          aria-label="Search events"
          className="size-11 shrink-0 md:size-9 xl:hidden"
        >
          <Search className="size-5 md:size-4" />
        </Button>

        <div className="hidden lg:block">
          <TrendingMenu events={trendingEvents} onSelectEvent={onSelectTrending} />
        </div>

        <Button
          variant="ghost"
          size="icon"
          onClick={onOpenHelp}
          aria-label="How it works"
          className="hidden lg:inline-flex"
        >
          <HelpCircle />
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={onOpenSubscribe}
          className="hidden gap-1.5 lg:inline-flex"
        >
          <CalendarPlus />
          {/* The label is 110px and `xl` is exactly where the search field
              arrives too; taking both at once left the title at 37px. It waits
              for `2xl`, where there is room for all three. */}
          <span className="hidden 2xl:inline">Subscribe</span>
          <span className="sr-only 2xl:hidden">Subscribe to this calendar</span>
        </Button>

        <div className="hidden md:block">
          <ViewSwitcher view={view} onChange={onViewChange} />
        </div>

        <div className="hidden lg:block">
          <ThemeToggle />
        </div>

        {/* Everything the lg tier hides is in here, so nothing is unreachable
            at any width — only one tap further away. */}
        <div className="lg:hidden">
          <OverflowMenu
            onOpenTrending={onOpenTrending}
            onOpenSubscribe={onOpenSubscribe}
            onOpenHelp={onOpenHelp}
          />
        </div>
      </div>
    </header>
  );
}
