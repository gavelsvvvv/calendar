"use client";

import { useSyncExternalStore } from "react";
import {
  detectCalendarPlatform,
  readPlatformSignals,
  type CalendarPlatform,
} from "@/lib/calendar-export/platform";

/**
 * Two facts that exist only in a browser: the page's origin, and which calendar
 * the reader probably uses.
 *
 * Both are read through `useSyncExternalStore` rather than an effect, for the
 * reason the rest of this codebase does it: an effect that calls `setState` on
 * mount renders the component twice and trips `react-hooks/set-state-in-effect`.
 * A store with a server snapshot renders once, and the snapshot is the neutral
 * value — an empty origin, and the ordering that suits a desktop — so the
 * server's markup and the client's first pass agree.
 *
 * Neither ever changes for the life of the page, so `subscribe` is a no-op:
 * there is genuinely nothing to be notified about.
 */

const noSubscription = () => () => {};

/**
 * Computed once and kept.
 *
 * `getSnapshot` runs on every render *and* again in React's tearing check, and
 * it must return a stable value or React re-renders forever. Parsing a user
 * agent string each time would be both wasteful and — since the string never
 * changes — pointless.
 *
 * Module state on the server would be shared between requests, which is exactly
 * the bug that would make one visitor's platform leak into another's page. It
 * cannot happen here: the server snapshot is a constant and never consults this.
 */
let cachedPlatform: CalendarPlatform | null = null;

function platformSnapshot(): CalendarPlatform {
  if (cachedPlatform === null) {
    cachedPlatform = detectCalendarPlatform(readPlatformSignals());
  }
  return cachedPlatform;
}

/** The reader's likely calendar platform. Used for ordering, never for gating. */
export function useCalendarPlatform(): CalendarPlatform {
  return useSyncExternalStore(noSubscription, platformSnapshot, () => "other");
}

/** `window.location.origin`, or `""` while rendering on the server. */
export function useOrigin(): string {
  return useSyncExternalStore(
    noSubscription,
    () => window.location.origin,
    () => "",
  );
}
