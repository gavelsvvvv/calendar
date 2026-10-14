"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Media query hook.
 *
 * Uses `useSyncExternalStore` rather than `useState` + `useEffect`: a media query
 * *is* an external store, so this subscribes to it directly instead of copying
 * its value into React state and triggering a second render on mount. The server
 * snapshot is always `false`, so SSR and the first client render agree and layout
 * decisions that depend on width settle without a hydration mismatch.
 */
/**
 * One MediaQueryList per query, for the life of the page.
 *
 * `window.matchMedia(query)` parses the query and allocates a live object every
 * time it is called, and `getSnapshot` runs on every render *and* again in
 * React's post-commit tearing check. A month grid asks the same question once
 * per event chip, so a single grid paint was making 250-odd of these for one
 * boolean that is the same in all of them. The query strings are a fixed set of
 * three, so caching them is free and total.
 */
const lists = new Map<string, MediaQueryList>();

function listFor(query: string): MediaQueryList {
  let list = lists.get(query);
  if (!list) {
    list = window.matchMedia(query);
    lists.set(query, list);
  }
  return list;
}

export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = listFor(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );

  const getSnapshot = useCallback(() => listFor(query).matches, [query]);

  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

/** Tailwind's `md` breakpoint — the point where the month grid becomes readable. */
export const useIsDesktop = () => useMediaQuery("(min-width: 768px)");

/**
 * Tailwind's `lg` breakpoint — where a static sidebar stops costing the grid too
 * much. At 768px the sidebar would eat a third of the width, so tablets get the
 * drawer instead.
 */
export const useIsLargeScreen = () => useMediaQuery("(min-width: 1024px)");

/**
 * Below Tailwind's `sm` — where the month grid splits into a compact grid and
 * a day schedule beneath it, and where a chip becomes a dot.
 */
export const useIsPhone = () => !useMediaQuery("(min-width: 640px)");

/** Distinguishes real touch input from a narrow desktop window. */
export const useIsTouch = () => useMediaQuery("(hover: none) and (pointer: coarse)");
