"use client";

import * as React from "react";
import { useTimeZone } from "@/hooks/use-time-zone";
import { zonedDayKey, zonedTime } from "@/lib/timezone";
import type { NowSnapshot } from "@/lib/event-time";

/**
 * One clock for the whole calendar.
 *
 * Every event row needs to know whether its moment has gone by, and a busy
 * month renders well over a hundred of them — a timer each would be absurd. A
 * single module-level interval publishes the current minute instead and
 * `useSyncExternalStore` fans it out.
 *
 * The store publishes only a number. Which *day* that number is depends on the
 * viewer's timezone, so the day key is derived here rather than stored — it is
 * the same instant for everyone and a different date for some of them.
 */

const POLL_MS = 15_000;

let minuteMs: number | null = null;
let minuteBucket = -1;
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function refresh(notify: boolean): void {
  const now = Date.now();
  const bucket = Math.floor(now / 60_000);
  if (bucket === minuteBucket && minuteMs !== null) return;
  minuteBucket = bucket;
  minuteMs = now;
  if (notify) for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (timer === null) timer = setInterval(() => refresh(true), POLL_MS);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/**
 * Always re-reads the clock; `refresh` returns immediately inside the same
 * minute, so this is a floor division and a comparison.
 *
 * It used to refresh only when the cache was empty and otherwise trust the
 * interval to move it on. That holds in a browser and is wrong on the server,
 * where nothing subscribes and so no interval is ever started: the first render
 * the process handled filled the cache and every render afterwards was served
 * that same instant. A server up for an hour was rendering an hour-old clock —
 * and, worse, the wrong day for anyone whose SSR happened to land after the
 * process crossed local midnight.
 */
function getSnapshot(): number {
  refresh(false);
  return minuteMs as number;
}

/** Null on the server, so the server's markup and the hydrating client agree. */
function getServerSnapshot(): null {
  return null;
}

/** The current moment, or null until the browser has read its clock. */
export function useNow(): NowSnapshot | null {
  const zone = useTimeZone();
  const ms = React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return React.useMemo(
    () => (ms === null ? null : { ms, dayKey: zonedDayKey(ms, zone) }),
    [ms, zone],
  );
}

/**
 * Today, in the viewer's timezone.
 *
 * Unlike `useNow` this is never null: the grid has to mark a cell as today on
 * the very first paint, server included. It follows the minute clock once that
 * exists, so a calendar left open overnight moves the highlight at local
 * midnight rather than at the server's.
 */
export function useTodayKey(): string {
  const zone = useTimeZone();
  // Reading the clock is the store's job, not the render's — which is also why
  // this can hand the same value to the server pass and to hydration.
  const read = React.useCallback(() => zonedDayKey(getSnapshot(), zone), [zone]);
  return React.useSyncExternalStore(subscribe, read, read);
}

/**
 * The reader's own wall clock, `HH:MM`, ticking with the minute. Null until the
 * browser has read it.
 *
 * Null on the server deliberately, and unlike `useTodayKey` — which has to name
 * a cell on the very first paint and so accepts the midnight-boundary risk.
 * Nothing depends on a clock existing before hydration, and rendering one there
 * cannot be made safe: the server's minute and the browser's straddle a
 * boundary sooner or later, and React treats a differing text node as a
 * hydration error rather than something to reconcile. Rendering nothing has no
 * text to disagree about.
 */
export function useLocalClock(): string | null {
  const zone = useTimeZone();
  const read = React.useCallback(() => zonedTime(getSnapshot(), zone), [zone]);
  return React.useSyncExternalStore(subscribe, read, getServerSnapshot);
}
