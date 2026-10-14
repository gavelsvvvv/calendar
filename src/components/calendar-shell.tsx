"use client";

import { startOfMonth } from "date-fns";
import dynamic from "next/dynamic";
import * as React from "react";
import { AgendaView } from "@/components/calendar/agenda-view";
import { MobileDaySchedule } from "@/components/calendar/mobile-day-schedule";
import { MonthView } from "@/components/calendar/month-view";
import { WeekView } from "@/components/calendar/week-view";
import { AppBar } from "@/components/shell/app-bar";
import { MobileToolbar } from "@/components/shell/mobile-toolbar";
import { CalendarSidebar } from "@/components/shell/sidebar";
import { CalendarSkeleton } from "@/components/states/calendar-skeleton";
import { ErrorState, StaleDataNotice } from "@/components/states/empty-states";
import { useCalendar } from "@/hooks/use-calendar";
import { TimeZoneProvider } from "@/hooks/use-time-zone";
import { useFirstVisit } from "@/hooks/use-first-visit";
import { useIsDesktop, useIsLargeScreen, useIsPhone } from "@/hooks/use-media-query";
import type { CuratedDataset } from "@/lib/curation/dataset";
import { categorySelection } from "@/lib/curation/filters";
import type { CuratedCalendarEvent } from "@/lib/curation/types";
import { fromDayKey } from "@/lib/dates";
import { cn } from "@/lib/utils";

/**
 * Every overlay is loaded on demand.
 *
 * None of them is needed to paint a calendar, and together they pull in Radix
 * dialogs, vaul drawers and cmdk — a large slice of the bundle to render
 * nothing. `ssr: false` is right here too: an overlay that is closed has no
 * server markup worth sending.
 */
const EventDetails = dynamic(
  () => import("@/components/event/event-details").then((m) => m.EventDetails),
  { ssr: false },
);
const HelpDialog = dynamic(
  () => import("@/components/help/help-dialog").then((m) => m.HelpDialog),
  { ssr: false },
);
const OnboardingDialog = dynamic(
  () => import("@/components/onboarding/onboarding-dialog").then((m) => m.OnboardingDialog),
  { ssr: false },
);
const SearchDialog = dynamic(
  () => import("@/components/search/search-dialog").then((m) => m.SearchDialog),
  { ssr: false },
);
const SubscribeDialog = dynamic(
  () => import("@/components/subscribe/subscribe-dialog").then((m) => m.SubscribeDialog),
  { ssr: false },
);
const DayEventsPopover = dynamic(
  () => import("@/components/calendar/day-events-popover").then((m) => m.DayEventsPopover),
  { ssr: false },
);
const TrendingDrawer = dynamic(
  () => import("@/components/shell/trending-menu").then((m) => m.TrendingDrawer),
  { ssr: false },
);

/**
 * The application shell.
 *
 * Owns only what is genuinely shared between surfaces: which dialog is open and
 * which event is selected. View, date and filters all live in the URL via
 * `useCalendar`, so every state is shareable and survives a refresh.
 */
export function CalendarShell({
  initialDataset,
  initialQuery,
  initialTimeZone,
}: {
  initialDataset: CuratedDataset;
  initialQuery: string;
  initialTimeZone: string;
}) {
  return (
    <TimeZoneProvider value={initialTimeZone}>
      <Calendar initialDataset={initialDataset} initialQuery={initialQuery} />
    </TimeZoneProvider>
  );
}

/**
 * Everything below here reads the viewer's timezone, so it all sits inside the
 * provider — including `useCalendar`, which decides on which calendar day each
 * timed event belongs.
 */
function Calendar({
  initialDataset,
  initialQuery,
}: {
  initialDataset: CuratedDataset;
  initialQuery: string;
}) {
  const calendar = useCalendar(initialDataset, initialQuery);
  const hasStaticSidebar = useIsLargeScreen();
  const isDesktop = useIsDesktop();
  const isPhone = useIsPhone();
  const firstVisit = useFirstVisit();

  /**
   * Two different things that used to share one flag.
   *
   * `sidebarCollapsed` is layout — the desktop rail. It starts expanded so the
   * server renders it, which is the whole point: choosing in JS meant no
   * sidebar in the SSR HTML and a 256px column slamming in at hydration.
   *
   * `drawerOpen` is an overlay, on small screens only. Conflating them left a
   * vaul drawer open on desktop, and because vaul portals its backdrop to
   * document.body, no amount of `lg:hidden` on the wrapper contained it — it
   * swallowed every click on the page.
   */
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [activeEvent, setActiveEvent] = React.useState<CuratedCalendarEvent | null>(null);
  const [expandedDay, setExpandedDay] = React.useState<string | null>(null);
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [helpOpen, setHelpOpen] = React.useState(false);
  const [subscribeOpen, setSubscribeOpen] = React.useState(false);
  const [trendingOpen, setTrendingOpen] = React.useState(false);
  const [onboardingDismissed, setOnboardingDismissed] = React.useState(false);

  // Derived rather than synced: onboarding is open exactly while this is a first
  // visit the user hasn't dismissed yet.
  const onboardingOpen = firstVisit.isFirstVisit && !onboardingDismissed;

  const { setView, goToday, setSelectedDate } = calendar;

  /**
   * Global shortcuts. Deliberately inert while the user is typing, and while a
   * dialog owns the keyboard.
   */
  React.useEffect(() => {
    const isTyping = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      if (target.isContentEditable) return true;
      return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) {
        // Cmd/Ctrl+K still opens search, matching the convention.
        if ((event.key === "k" || event.key === "K") && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          setSearchOpen(true);
        }
        return;
      }
      if (isTyping(event.target)) return;
      if (searchOpen || helpOpen || subscribeOpen || onboardingOpen) return;

      switch (event.key) {
        case "/":
          event.preventDefault();
          setSearchOpen(true);
          break;
        case "t":
          goToday();
          break;
        case "m":
          setView("month");
          break;
        case "w":
          setView("week");
          break;
        case "a":
          setView("agenda");
          break;
        default:
          break;
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [goToday, setView, searchOpen, helpOpen, subscribeOpen, onboardingOpen]);

  /**
   * The logo's action, and the only control that resets more than one thing.
   *
   * Everything a reader can have open is an overlay over the calendar, and
   * "take me home" means the calendar — so the overlays close first and the
   * view, month and selection move together in one `goHome` commit. No router
   * call anywhere in here: `goHome` writes the URL with `history.replaceState`
   * like every other state change, so the server is never re-entered for what
   * is a change of view over data already in memory.
   */
  const goHome = React.useCallback(() => {
    setActiveEvent(null);
    setExpandedDay(null);
    setSearchOpen(false);
    setHelpOpen(false);
    setSubscribeOpen(false);
    setTrendingOpen(false);
    setDrawerOpen(false);
    calendar.goHome();
  }, [calendar]);

  const openEvent = React.useCallback((event: CuratedCalendarEvent) => {
    setActiveEvent(event);
  }, []);

  const selectDay = React.useCallback(
    (dayKey: string) => {
      setSelectedDate(dayKey === calendar.selectedDate ? null : dayKey);
    },
    [calendar.selectedDate, setSelectedDate],
  );

  /**
   * Tapping a month cell on a phone drives the schedule below the grid.
   *
   * It used to open a bottom sheet, which meant reading two days was open,
   * read, dismiss, open, read — a modal for the single most ordinary action in
   * the view. Now the selection just moves and the list under the calendar
   * changes, so the grid never leaves the screen.
   *
   * Selection does not toggle on a phone, because the schedule is always about
   * *some* day: deselecting would silently throw the reader back to today while
   * they were looking at the 14th.
   */
  const selectMonthDay = React.useCallback(
    (dayKey: string) => {
      if (!isDesktop) {
        setSelectedDate(dayKey);
        return;
      }
      setSelectedDate(dayKey === calendar.selectedDate ? null : dayKey);
    },
    [calendar.selectedDate, isDesktop, setSelectedDate],
  );

  const navigateToDate = React.useCallback(
    (dayKey: string) => {
      calendar.setAnchor(
        calendar.view === "week" ? fromDayKey(dayKey) : startOfMonth(fromDayKey(dayKey)),
      );
      setSelectedDate(dayKey);
    },
    [calendar, setSelectedDate],
  );

  /**
   * Trending jumps the calendar to the event's day before opening it, so
   * dismissing the panel leaves you looking at the right part of the calendar
   * rather than back where you started.
   */
  const openTrending = React.useCallback(
    (event: CuratedCalendarEvent) => {
      navigateToDate(event.displayDate);
      setActiveEvent(event);
    },
    [navigateToDate],
  );

  // Counts, day markers, heatmap and trending all come from one index built
  // once per dataset — the shell used to rebuild two of them itself on every
  // render, including renders caused by opening a dialog.
  const {
    countsByCategory: counts,
    countsBySport,
    countsByEsport,
    daysWithEvents,
  } = calendar.index;

  const expandedDayEvents = React.useMemo(
    () => (expandedDay ? (calendar.eventsByDay[expandedDay] ?? []) : []),
    [expandedDay, calendar.eventsByDay],
  );

  // Derived from the one selector every category control reads, so the hint
  // below and the two buttons in the sidebar can never disagree about how many
  // categories are ticked.
  const { hasSelectedCategories } = categorySelection(calendar.filters);
  const noCategories = !hasSelectedCategories;

  return (
    /*
     * The application is exactly one viewport tall, at every width.
     *
     * `h-dvh` rather than `h-screen` so it tracks mobile browser chrome sliding
     * in and out, and `overflow-hidden` so nothing inside can push the document
     * itself into scrolling — a calendar you have to scroll the *page* to read
     * is a document pretending to be an application. Every region that
     * genuinely needs to scroll does so inside itself, and there are only ever
     * two of them: the sidebar when a viewport is too short for it, and the
     * active view.
     *
     * This also gives `flex-1` something definite to divide, which is what lets
     * the month grid size its rows to the space available instead of to a fixed
     * number of pixels.
     */
    <div className="flex h-dvh flex-col overflow-hidden bg-background">
      <AppBar
        view={calendar.view}
        anchor={calendar.anchor}
        trendingEvents={calendar.index.trending}
        onSelectTrending={openTrending}
        onOpenTrending={() => setTrendingOpen(true)}
        sidebarOpen={hasStaticSidebar ? !sidebarCollapsed : drawerOpen}
        onToggleSidebar={() =>
          // Reading the breakpoint inside a handler is free — it is a decision
          // about which control the button drives, not about what to render.
          hasStaticSidebar
            ? setSidebarCollapsed((collapsed) => !collapsed)
            : setDrawerOpen((open) => !open)
        }
        onPrevious={calendar.goPrevious}
        onNext={calendar.goNext}
        onHome={goHome}
        onToday={calendar.goToday}
        onViewChange={calendar.setView}
        onOpenSearch={() => setSearchOpen(true)}
        onOpenHelp={() => setHelpOpen(true)}
        onOpenSubscribe={() => setSubscribeOpen(true)}
      />

      <div className="flex min-h-0 flex-1">
        {/* One instance. CSS decides whether the rail is visible; the drawer
            opens only on the screens that have no rail. */}
        <CalendarSidebar
          open={drawerOpen && !hasStaticSidebar}
          collapsed={sidebarCollapsed}
          onClose={() => setDrawerOpen(false)}
          anchor={calendar.anchor}
          selectedDate={calendar.selectedDate}
          filters={calendar.filters}
          counts={counts}
          sportCounts={countsBySport}
          esportCounts={countsByEsport}
          favoriteCount={calendar.favorites.count}
          daysWithEvents={daysWithEvents}
          onSelectDay={(day) => {
            navigateToDate(day);
            setDrawerOpen(false);
          }}
          onNavigateMonth={calendar.setAnchor}
          onToggleCategory={calendar.toggleCategory}
          onFiltersChange={calendar.setFilters}
          onShowAllCategories={calendar.showAllCategories}
          onClearCategories={calendar.clearCategories}
          onHome={goHome}
          onOpenSubscribe={() => setSubscribeOpen(true)}
          onOpenHelp={() => setHelpOpen(true)}
        />

        {/* The bottom padding clears the fixed mobile toolbar (and the home
            indicator beneath it) so the footer is never trapped under it. That
            72px is not negotiable, which is why a short phone takes its margin
            out of the gaps above instead: `short-phone` halves the workspace
            gap and the top padding, and each of those is a third of a row in
            the day list underneath. */}
        <main className="flex min-w-0 flex-1 flex-col gap-2 overflow-hidden p-2 pb-[calc(4.5rem+env(safe-area-inset-bottom))] short-phone:gap-1 short-phone:pt-1 sm:p-3 md:pb-3">
          {calendar.isStale && <StaleDataNotice />}

          {/*
            One line, and only when the reader has emptied the list.

            This replaced a full-panel empty state — medallion, heading,
            paragraph, button — that took the calendar off the screen entirely
            whenever the filters matched nothing. That is the wrong trade: the
            grid *is* the answer to "what did my filters do", and removing it
            to explain itself leaves nowhere to see the effect, nothing to
            navigate, and a screen that reads as broken rather than empty.

            So the calendar always renders and this says what happened in
            eleven words. It exists mainly for a phone, where the sidebar is a
            drawer and its own note is out of sight; on a desktop the unticked
            boxes are already visible next to it.
          */}
          {noCategories && (
            <p
              data-calendar-hint="no-categories"
              className="flex shrink-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 px-1 text-[11px] text-muted-foreground"
            >
              No categories selected, so no events are shown.
              <button
                type="button"
                data-action="hint-show-all"
                onClick={calendar.showAllCategories}
                className="rounded font-medium text-accent transition-colors hover:underline"
              >
                Show all
              </button>
            </p>
          )}

          {/*
            Keyed on the view so switching replaces the subtree and the entry
            animation runs. Only opacity and a 2px lift are animated — the grid
            is an auto-rows-fr layout with display:contents rows, and animating
            anything that touches layout would make every cell reflow mid-frame.

            One container, never each event: 250 individually animated rows is
            250 composited layers for a transition nobody asked to watch. And
            the animation runs *over* the new view rather than before it — the
            switch is committed on the click, and this is what it looks like
            arriving, not something it waits for.
          */}
          <div
            key={calendar.view}
            /* Probes, not decoration: the browser suite and the navigation
               benchmark both need to know which view is mounted and whether
               what's on screen is the requested range or the previous one held
               over while a fetch lands. Sniffing the opacity class for that was
               reading an implementation detail. */
            data-view={calendar.view}
            data-refreshing={calendar.isRefreshing ? "true" : "false"}
            className={cn(
              // `gap-2` so the month grid and the schedule under it read as two
              // cards. Every other view renders a single child, where it is inert.
              "flex min-h-0 flex-1 flex-col gap-2 transition-opacity",
              "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:duration-(--dur-base) motion-safe:ease-(--ease-out)",
              calendar.isRefreshing && "opacity-60",
            )}
          >
            {calendar.isLoading ? (
              <CalendarSkeleton view={calendar.view} />
            ) : calendar.error && calendar.allEvents.length === 0 ? (
              <div className="flex flex-1 items-center justify-center rounded-lg border border-border bg-surface">
                <ErrorState message={calendar.error} onRetry={calendar.retry} />
              </div>
            ) : calendar.view === "month" ? (
              <>
                <MonthView
                  anchor={calendar.anchor}
                  eventsByDay={calendar.eventsByDay}
                  densityByDay={calendar.index.densityByDay}
                  selectedDate={calendar.selectedDate}
                  onSelectDay={selectMonthDay}
                  onSelectEvent={openEvent}
                  onNavigateMonth={calendar.setAnchor}
                  onShowMore={setExpandedDay}
                />
                {/* The other half of the phone's month view.
                    CSS hides it from `sm` up, but hiding is not the same as not
                    building: on a desktop it was still mounting an uncapped row
                    per event of the selected day — around 110 invisible
                    elements on a busy day, rebuilt on every render. The server
                    snapshot is "phone", so the markup a phone needs is still
                    server-rendered; a desktop drops it after hydration, where
                    it was never visible anyway. */}
                {isPhone && (
                  <MobileDaySchedule
                    anchor={calendar.anchor}
                    eventsByDay={calendar.eventsByDay}
                    selectedDate={calendar.selectedDate}
                    onSelectEvent={openEvent}
                  />
                )}
              </>
            ) : calendar.view === "week" ? (
              <WeekView
                anchor={calendar.anchor}
                eventsByDay={calendar.eventsByDay}
                selectedDate={calendar.selectedDate}
                onSelectDay={selectDay}
                onSelectEvent={openEvent}
                onShowMore={setExpandedDay}
              />
            ) : (
              <AgendaView
                anchor={calendar.anchor}
                events={calendar.events}
                eventsByDay={calendar.eventsByDay}
                selectedDate={calendar.selectedDate}
                onSelectDay={selectDay}
                onSelectEvent={openEvent}
              />
            )}
          </div>

          {/*
            Attribution appears exactly once, and which surface carries it
            depends on which sidebar is on screen.

            Below `lg` the sidebar is the drawer, whose tail already ends with
            this line, so printing it here as well spent ~26px of a phone's
            height — border, padding and all — to say a second time what the
            drawer says. Above `lg` the sidebar is the rail, and `RailActions`
            carries only Subscribe and How it works, so this footer is the only
            place it appears and has to stay.

            `hidden lg:block` is the same breakpoint the drawer/rail swap uses,
            which is what keeps the two from ever both showing or both hiding.
          */}
          <footer className="hidden shrink-0 border-t border-border px-1 pt-2 text-[11px] leading-relaxed text-muted-foreground lg:block">
            Independent calendar built on public Polymarket data. Not affiliated
            with or endorsed by Polymarket. Built by gavelsv.
          </footer>
        </main>
      </div>

      <MobileToolbar
        view={calendar.view}
        onViewChange={calendar.setView}
        onPrevious={calendar.goPrevious}
        onNext={calendar.goNext}
      />

      <TrendingDrawer
        events={calendar.index.trending}
        open={trendingOpen}
        onOpenChange={setTrendingOpen}
        onSelectEvent={openTrending}
      />

      <DayEventsPopover
        dayKey={expandedDay}
        events={expandedDayEvents}
        open={expandedDay !== null}
        onOpenChange={(open) => !open && setExpandedDay(null)}
        onSelectEvent={(event) => {
          setExpandedDay(null);
          openEvent(event);
        }}
      />

      <EventDetails
        event={activeEvent}
        includeSmallerMarkets={calendar.filters.includeSmallerMarkets}
        open={activeEvent !== null}
        onOpenChange={(open) => !open && setActiveEvent(null)}
      />

      <SearchDialog
        open={searchOpen}
        onOpenChange={setSearchOpen}
        // The whole loaded month, not the filtered set: the dialog applies the
        // category filter itself, using the same `searchEvents` the server
        // does, so passing the pre-filtered list would filter twice.
        events={calendar.allEvents}
        categories={calendar.filters.categories}
        onSelectEvent={openEvent}
        onNavigateToDate={navigateToDate}
      />

      <HelpDialog open={helpOpen} onOpenChange={setHelpOpen} />

      <SubscribeDialog
        open={subscribeOpen}
        onOpenChange={setSubscribeOpen}
        currentFilters={calendar.filters}
      />

      {/*
        Mounted only for someone who is actually going to see it.
        `dynamic()` fetches a chunk when the component *renders*, not when it
        opens — so rendering this unconditionally with `open={false}` shipped
        the whole onboarding bundle, art and keyframes included, to every
        returning visitor on every visit. Measured before this: a first visit
        and a returning visit fetched an identical set of scripts.

        `|| onboardingDismissed` keeps it mounted through the closing
        animation, and is false for a returning visitor, who therefore never
        mounts it at all.
      */}
      {(onboardingOpen || onboardingDismissed) && (
        <OnboardingDialog
          open={onboardingOpen}
          onOpenChange={(next) => !next && setOnboardingDismissed(true)}
          onComplete={firstVisit.complete}
          onOpenSubscribe={() => setSubscribeOpen(true)}
        />
      )}
    </div>
  );
}
