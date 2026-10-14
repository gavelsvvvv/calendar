"use client";

import { monthGridRange } from "./calendar-cache";
import type { RelatedMarket } from "./curation/types";

/**
 * The legs of an event, fetched separately from the calendar.
 *
 * `relatedMarkets` was 58% of a month's payload — 269KB of 462KB, measured on a
 * September grid — and nothing on the calendar reads it. It fills one collapsed
 * disclosure inside the details panel, for one event at a time. So the calendar
 * asks for a month without it, and this fills in behind: on idle once the month
 * has painted, and immediately if a panel opens first.
 *
 * Keyed by event id rather than by month, because ids are unique and an event
 * opened from search may belong to a month that is not on screen.
 */

const byEvent = new Map<string, RelatedMarket[]>();
const loaded = new Set<string>();
const inFlight = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;

function publish(): void {
  version += 1;
  for (const listener of listeners) listener();
}

export function subscribeToRelatedMarkets(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function relatedMarketsVersion(): number {
  return version;
}

export function serverRelatedMarketsVersion(): number {
  return 0;
}

/** The event's legs, or undefined while its month is still on its way. */
export function readRelatedMarkets(eventId: string): RelatedMarket[] | undefined {
  return byEvent.get(eventId);
}

function slot(monthKey: string, includeSmaller: boolean): string {
  return `${monthKey}|${includeSmaller ? "small" : "curated"}`;
}

/** Fetch a whole month's legs at once, once. */
export function ensureRelatedMarkets(monthKey: string, includeSmaller: boolean): void {
  const key = slot(monthKey, includeSmaller);
  if (loaded.has(key) || inFlight.has(key)) return;
  inFlight.add(key);

  const { start, end } = monthGridRange(monthKey);
  const params = new URLSearchParams({ start, end, markets: "1" });
  if (includeSmaller) params.set("includeSmaller", "1");

  void fetch(`/api/events?${params.toString()}`)
    .then((response) => (response.ok ? response.json() : Promise.reject(new Error("failed"))))
    .then((body: { markets?: Record<string, RelatedMarket[]> }) => {
      for (const [id, markets] of Object.entries(body.markets ?? {})) byEvent.set(id, markets);
      loaded.add(key);
      publish();
    })
    .catch(() => {
      // The disclosure simply stays closed. It is supplementary detail, and a
      // panel that still shows the date, the volume and the link out is not
      // broken by its absence — so this never surfaces an error.
    })
    .finally(() => inFlight.delete(key));
}

/** Test seam. Never called by the app. */
export function resetRelatedMarkets(): void {
  byEvent.clear();
  loaded.clear();
  inFlight.clear();
  version = 0;
}
