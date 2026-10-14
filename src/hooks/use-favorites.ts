"use client";

import * as React from "react";

/**
 * Starred events, kept in localStorage.
 *
 * No account, no server — a star is a private note this browser makes about a
 * public calendar, so there is nothing to sync and nothing to log in for.
 *
 * One module-level store rather than state per component: the star lives in the
 * details panel while the sidebar counts favourites and the grid filters by
 * them, and all three have to agree the instant one of them changes.
 * `useSyncExternalStore` also gives a `storage` listener for free, so starring
 * something in one tab updates the others.
 */

const STORAGE_KEY = "pmc.favorites.v1";

let ids: ReadonlySet<string> = new Set();
let loaded = false;
const listeners = new Set<() => void>();

function read(): ReadonlySet<string> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.filter((v) => typeof v === "string") : []);
  } catch {
    // Private mode, a quota error, or somebody's corrupted value. Starring is a
    // convenience; it must never be able to break the calendar.
    return new Set();
  }
}

function publish(next: ReadonlySet<string>): void {
  ids = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
  } catch {
    /* see read() */
  }
  for (const listener of listeners) listener();
}

function ensureLoaded(): void {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  ids = read();
}

function subscribe(listener: () => void): () => void {
  ensureLoaded();
  listeners.add(listener);

  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== STORAGE_KEY) return;
    ids = read();
    for (const l of listeners) l();
  };
  window.addEventListener("storage", onStorage);

  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

const EMPTY: ReadonlySet<string> = new Set();

function getSnapshot(): ReadonlySet<string> {
  ensureLoaded();
  return ids;
}

/** The server has no localStorage, so nothing is starred until the client says so. */
function getServerSnapshot(): ReadonlySet<string> {
  return EMPTY;
}

export type Favorites = {
  ids: ReadonlySet<string>;
  count: number;
  has: (id: string) => boolean;
  toggle: (id: string) => void;
};

export function useFavorites(): Favorites {
  const current = React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const toggle = React.useCallback((id: string) => {
    const next = new Set(getSnapshot());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    publish(next);
  }, []);

  const has = React.useCallback((id: string) => current.has(id), [current]);

  return React.useMemo(
    () => ({ ids: current, count: current.size, has, toggle }),
    [current, has, toggle],
  );
}
