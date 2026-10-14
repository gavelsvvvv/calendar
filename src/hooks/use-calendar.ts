"use client";

import { addDays, addMonths, addWeeks, isSameMonth, startOfMonth } from "date-fns";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useFavorites, type Favorites } from "@/hooks/use-favorites";
import { getViewRange } from "@/lib/calendar";
import {
  ensureMonth,
  monthCacheKey,
  monthKeyForView,
  monthsVersion,
  readMonth,
  retainMonths,
  seedMonth,
  serverMonthsVersion,
  shiftMonthKey,
  subscribeToMonths,
} from "@/lib/calendar-cache";
import { buildCalendarIndex, EMPTY_INDEX, type CalendarIndex } from "@/lib/calendar-index";
import { localizeEvents } from "@/lib/localize";
import { ensureRelatedMarkets } from "@/lib/related-markets";
import { fromDayKey, toMonthKey } from "@/lib/dates";
import { useTodayKey } from "@/hooks/use-now";
import { useTimeZone } from "@/hooks/use-time-zone";
import type { CuratedDataset } from "@/lib/curation/dataset";
import {
  ALL_CATEGORIES,
  filterEvents,
  needsTargetedTier,
  type CalendarFilters,
} from "@/lib/curation/filters";
import type { CuratedCalendarEvent } from "@/lib/curation/types";
import {
  parseCalendarUrlState,
  serializeCalendarUrlState,
  type CalendarUrlState,
  type CalendarView,
} from "@/lib/url-state";

/**
 * The calendar's single source of truth.
 *
 * ## The URL is written, not read
 *
 * View, anchor, filters and selection still live in the query string, so every
 * state is shareable and survives a refresh. What changed is the direction of
 * the arrow. They used to be *read* from `useSearchParams`, which meant every
 * change went through `router.replace` — a Next.js navigation. This page is
 * dynamic, so that navigation fetched a fresh RSC payload and re-ran
 * `buildCuratedDataset` on the server, and `useSearchParams` did not report the
 * new value until it came back. Clicking "Week" waited on a server round trip
 * to be told something the client had just decided, about data it already had
 * in memory. Measured on localhost, with no network latency and every month
 * cached, that round trip was the entire cost of every interaction.
 *
 * Now the state is React state: a click renders immediately, and the URL is
 * brought into line afterwards with `history.replaceState` — the App Router's
 * supported shallow update, which re-enters no server. `popstate` is handled,
 * so Back still moves the calendar.
 */

const EMPTY_EVENTS: CuratedCalendarEvent[] = [];

/** How often a visible tab checks whether the month on screen has aged out. */
const MONTH_POLL_MS = 5 * 60 * 1000;

export type CalendarController = {
  view: CalendarView;
  anchor: Date;
  selectedDate: string | null;
  filters: CalendarFilters;

  /** Everything loaded for the month, before filtering. */
  allEvents: CuratedCalendarEvent[];
  /** What survives the active filters. */
  events: CuratedCalendarEvent[];
  eventsByDay: Record<string, CuratedCalendarEvent[]>;
  /** Derived once per dataset: day buckets, counts, density, trending. */
  index: CalendarIndex;

  /** Nothing to show for this month yet — the calendar area shows a skeleton. */
  isLoading: boolean;
  /** Something on screen, a newer copy on the way. */
  isRefreshing: boolean;
  /** True when the data on screen came from cache after a failed refresh. */
  isStale: boolean;
  error?: string;

  setView: (view: CalendarView) => void;
  setAnchor: (date: Date) => void;
  goPrevious: () => void;
  goNext: () => void;
  goToday: () => void;
  /** The logo's action: Month, this month, today selected. */
  goHome: () => void;
  setSelectedDate: (date: string | null) => void;
  setFilters: (update: Partial<CalendarFilters>) => void;
  toggleCategory: (category: CalendarFilters["categories"][number]) => void;
  /** Tick every category. */
  showAllCategories: () => void;
  /** Untick every category — the exact inverse of `showAllCategories`. */
  clearCategories: () => void;
  retry: () => void;

  /** Starred events. Lives here so the grid, the sidebar and the details panel agree. */
  favorites: Favorites;
};

/** Run `task` when the browser is idle, or soon, wherever idle isn't a thing. */
function whenIdle(task: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const request = window.requestIdleCallback;
  if (typeof request === "function") {
    const handle = request(() => task(), { timeout: 2000 });
    return () => window.cancelIdleCallback?.(handle);
  }
  const handle = window.setTimeout(task, 300);
  return () => window.clearTimeout(handle);
}

export function useCalendar(
  initialDataset: CuratedDataset,
  initialQuery: string,
): CalendarController {
  const favorites = useFavorites();
  const pathname = usePathname();
  const timeZone = useTimeZone();
  const today = useTodayKey();

  /*
   * Parsed once, from the query string the server itself rendered with, so the
   * first client render is identical to the server's markup. After that the URL
   * follows this state rather than the other way round.
   */
  const [initial] = useState(() => {
    const parsed = parseCalendarUrlState(new URLSearchParams(initialQuery));
    return {
      parsed,
      /**
       * Which month entry `initialDataset` is. Pinned: the anchor moves, this
       * doesn't.
       *
       * The tier has to match what the server actually built, which is why it
       * is derived from the same `needsTargetedTier` the server used rather
       * than hardcoded: a `?sports=tennis` link is server-rendered deep, and
       * filing that payload under the shallow key would leave it unread and
       * refetch the month the reader is already looking at.
       */
      key: monthCacheKey(
        toMonthKey(parsed.anchor),
        parsed.filters.includeSmallerMarkets,
        needsTargetedTier(parsed.filters),
      ),
    };
  });
  const [state, setState] = useState<CalendarUrlState>(initial.parsed);

  const { view, anchor, filters, selected: selectedDate } = state;
  const smaller = filters.includeSmallerMarkets;

  /*
   * Whether this month has to be fetched with the Sport/eSport sub-filter tier.
   *
   * True only while a *strict subset* of the sports or the games is ticked —
   * the state that unlocks the $500 floor. "All Sports" is not it, and neither
   * is an empty selection, so the overwhelmingly common reader never requests
   * the tier and never pays the ~350KB it costs. Flipping this refetches the
   * month under a different cache key rather than mutating the one on screen,
   * so the calendar keeps rendering the data it already has until the wider
   * response lands.
   */
  const deep = needsTargetedTier(filters);

  const monthKey = monthKeyForView(view, anchor);
  const cacheKey = monthCacheKey(monthKey, smaller, deep);

  /*
   * The month store is read during render, so React has to be subscribed to it.
   * The previous cache was a plain module-level Map read the same way, and a
   * write from an effect updated no state — so nothing re-rendered. That is
   * what left Month → Week dimmed at 60% forever with the data it was waiting
   * for already sitting in the cache, unread.
   */
  useSyncExternalStore(subscribeToMonths, monthsVersion, serverMonthsVersion);
  const entry = readMonth(cacheKey);

  // Before the seeding effect has run, the server's own dataset stands in for
  // its month — otherwise the first paint is a skeleton over data we have.
  const dataset = entry.dataset ?? (cacheKey === initial.key ? initialDataset : undefined);

  /*
   * Into the viewer's timezone, once per dataset.
   *
   * The server sends absolute instants and its own reading of them, which is
   * correct for a reader in New York and nobody else. This recomputes the clock
   * face *and the calendar day* from `endDate`, so a 00:30Z fixture sits on the
   * 11th in London and the 10th in Chicago — and every view below reads the
   * same answer, because there is only one pass.
   */
  const allEvents = useMemo(
    () => localizeEvents(dataset?.events ?? EMPTY_EVENTS, timeZone),
    [dataset, timeZone],
  );

  /* ------------------------------------------------------------ loading */

  // Declared before the loader, and effects run in order, so the loader sees
  // the seed and doesn't re-fetch what the server just sent.
  useEffect(() => {
    seedMonth(initial.key, initialDataset);
  }, [initial.key, initialDataset]);

  useEffect(() => {
    // Cancel first: three quick clicks leave two requests running for months
    // nobody is looking at, competing for connections with the one they are.
    retainMonths(
      new Set([monthKey, shiftMonthKey(monthKey, 1), shiftMonthKey(monthKey, -1)]),
      smaller,
      deep,
    );
    ensureMonth(monthKey, smaller, deep);
  }, [monthKey, smaller, deep]);

  /**
   * Refresh a month that has gone stale, when there is someone there to see it.
   *
   * The TTL alone cannot do this: a tab nobody touches never re-renders, so
   * nothing would notice the expiry. Polling only while visible keeps an
   * abandoned background tab from calling the API all night.
   */
  useEffect(() => {
    const revalidate = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      ensureMonth(monthKey, smaller, deep);
    };
    document.addEventListener("visibilitychange", revalidate);
    window.addEventListener("focus", revalidate);
    const timer = window.setInterval(revalidate, MONTH_POLL_MS);
    return () => {
      document.removeEventListener("visibilitychange", revalidate);
      window.removeEventListener("focus", revalidate);
      window.clearInterval(timer);
    };
  }, [monthKey, smaller, deep]);

  /**
   * Prefetch the neighbours: next month now, previous month when idle.
   *
   * Forward is where a reader goes. Firing both at once made the month they are
   * actually looking at queue behind two they are not, and the "instant" next
   * month took seven seconds.
   *
   * Nothing starts until the visible month has landed, and every dependency is
   * a string. The old version depended on the `anchor` *Date* — a fresh object
   * on every URL parse — so it tore itself down on every interaction and its
   * cleanup aborted both prefetches. Clicking a day killed the requests meant
   * to make the next month instant.
   */
  const hasData = dataset !== undefined;
  useEffect(() => {
    if (!hasData) return;
    ensureMonth(shiftMonthKey(monthKey, 1), smaller, deep);
    return whenIdle(() => {
      ensureMonth(shiftMonthKey(monthKey, -1), smaller, deep);
      // And the detail the calendar deliberately did not download, so the first
      // event opened in this month has it already.
      ensureRelatedMarkets(monthKey, smaller);
    });
  }, [monthKey, smaller, deep, hasData]);

  /* ------------------------------------------------------------- the URL */

  /**
   * Bring the address bar into line with the state, without a navigation.
   *
   * In an effect rather than inside the setter, so the state update stays pure
   * and a double-invoked render is harmless.
   */
  useEffect(() => {
    const query = serializeCalendarUrlState(state);
    const url = query ? `${pathname}?${query}` : pathname;
    if (`${window.location.pathname}${window.location.search}` === url) return;
    window.history.replaceState(window.history.state, "", url);
  }, [state, pathname]);

  useEffect(() => {
    const onPopState = () =>
      setState(parseCalendarUrlState(new URLSearchParams(window.location.search)));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  /* ------------------------------------------------------------- actions */

  const commit = useCallback(
    (
      update:
        | Partial<CalendarUrlState>
        | ((current: CalendarUrlState) => Partial<CalendarUrlState>),
    ) => {
      setState((current) => {
        const patch = typeof update === "function" ? update(current) : update;
        const next = { ...current, ...patch };
        // Identity is what every downstream memo compares against, so an update
        // that changes nothing must not mint a new object.
        return serializeCalendarUrlState(next) === serializeCalendarUrlState(current)
          ? current
          : next;
      });
    },
    [],
  );

  const setView = useCallback(
    (next: CalendarView) =>
      commit((current) => {
        // Month and agenda anchor on the 1st; switching straight to week would
        // otherwise open the week containing the 1st, often already past.
        const now = new Date();
        return next === "week" && isSameMonth(current.anchor, now)
          ? { view: next, anchor: now }
          : { view: next };
      }),
    [commit],
  );

  const setAnchor = useCallback((date: Date) => commit({ anchor: date }), [commit]);

  const step = useCallback(
    (direction: 1 | -1) =>
      commit((current) => ({
        anchor:
          current.view === "week"
            ? addWeeks(current.anchor, direction)
            : addMonths(startOfMonth(current.anchor), direction),
      })),
    [commit],
  );

  const goPrevious = useCallback(() => step(-1), [step]);
  const goNext = useCallback(() => step(1), [step]);

  const goToday = useCallback(
    () =>
      commit((current) => {
        const now = new Date();
        return {
          anchor: current.view === "week" ? now : startOfMonth(now),
          selected: today,
        };
      }),
    [commit, today],
  );

  /**
   * Home: the month you are in, today picked out, the full grid.
   *
   * Distinct from `goToday`, which deliberately keeps whichever view you are in
   * — pressing Today in Week means "this week". Home is the logo, and a logo
   * means the front page, so it also puts the view back to Month.
   *
   * One `commit`, not three. Each commit writes the URL through
   * `history.replaceState`, so doing this as `setView` then `setAnchor` then
   * `setSelectedDate` would be three renders and three history writes to reach
   * a state that was decided in one go.
   */
  /*
   * The logo's destination: this month, in Month view, with today selected.
   *
   * One `commit`, not three, so the whole move is a single render and a single
   * `history.replaceState` — and no RSC round trip, because none of this is
   * server state.
   *
   * The anchor is derived from `today` rather than from `new Date()`. Those are
   * not the same date: `today` is the day key in the *reader's chosen display
   * zone*, and on the last or first day of a month a reader whose zone differs
   * from the machine's would otherwise be sent to one month while the day
   * selected inside it belonged to another.
   */
  const goHome = useCallback(
    () =>
      commit({
        view: "month",
        anchor: startOfMonth(fromDayKey(today)),
        selected: today,
      }),
    [commit, today],
  );

  const setSelectedDate = useCallback(
    (date: string | null) => commit({ selected: date }),
    [commit],
  );

  const setFilters = useCallback(
    (update: Partial<CalendarFilters>) =>
      commit((current) => ({ filters: { ...current.filters, ...update } })),
    [commit],
  );

  const toggleCategory = useCallback(
    (category: CalendarFilters["categories"][number]) =>
      commit((current) => {
        const next = current.filters.categories.includes(category)
          ? current.filters.categories.filter((c) => c !== category)
          : [...current.filters.categories, category];
        return { filters: { ...current.filters, categories: next } };
      }),
    [commit],
  );

  /**
   * "Clear all" and "Show all" are one control's two directions.
   *
   * Clear used to be a *global* reset — categories, importance, both quick
   * filters and the smaller-markets switch, all at once — which made it not the
   * opposite of anything and gave it a second job nobody asked for. It sits in
   * the "My calendars" header beside Show all, so its scope is that list, and
   * it does exactly one thing: unticks every box.
   *
   * Two things fall out of narrowing it. Every other filter already has its own
   * off-switch — the importance radio has "All events", the quick filters are
   * toggles — so nothing became unreachable. And `includeSmallerMarkets` is the
   * one filter that changes the *dataset*, so a Clear that reset it could
   * trigger a refetch; this one cannot.
   */
  const clearCategories = useCallback(
    () => commit((current) => ({ filters: { ...current.filters, categories: [] } })),
    [commit],
  );

  const showAllCategories = useCallback(
    () => commit((current) => ({ filters: { ...current.filters, categories: ALL_CATEGORIES } })),
    [commit],
  );

  const retry = useCallback(
    () => ensureMonth(monthKey, smaller, deep, { force: true }),
    [monthKey, smaller, deep],
  );

  /* ------------------------------------------------------------ derived */

  /*
   * These hit now. `filters` only changes identity when a filter actually
   * changes, so switching view or stepping to a cached month reuses both
   * results — and `index.byDay` keeping its identity is what finally lets each
   * view's `React.memo` do its job.
   */
  const events = useMemo(
    () => filterEvents(allEvents, filters, { favorites: favorites.ids }),
    [allEvents, filters, favorites.ids],
  );

  const index = useMemo(
    () =>
      allEvents.length === 0
        ? EMPTY_INDEX
        : buildCalendarIndex({ allEvents, events, monthKey, today }),
    [allEvents, events, monthKey, today],
  );

  return {
    view,
    anchor,
    selectedDate,
    filters,
    allEvents,
    events,
    eventsByDay: index.byDay,
    index,
    // A month with nothing to show yet gets the calendar-level skeleton; one
    // with something to show keeps showing it while a newer copy lands.
    isLoading: dataset === undefined,
    isRefreshing: dataset !== undefined && entry.loading,
    isStale: dataset?.source === "cached",
    error: entry.error ?? dataset?.error,
    setView,
    setAnchor,
    goPrevious,
    goNext,
    goToday,
    goHome,
    setSelectedDate,
    setFilters,
    toggleCategory,
    showAllCategories,
    favorites,
    clearCategories,
    retry,
  };
}

/** Days of the week containing `anchor`, for the week view. */
export function weekDays(anchor: Date): Date[] {
  const { start } = getViewRange("week", anchor);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}
