"use client";

import { useCallback, useSyncExternalStore } from "react";

const DEFAULT_KEY = "pmc.onboarding.v1";

/**
 * localStorage is an external store, so it's read through a subscription rather
 * than copied into state by an effect. That avoids the extra mount render and
 * keeps the server snapshot (`false`) authoritative during hydration.
 */
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Another tab completing onboarding should settle this one too.
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function hasVisited(key: string): boolean {
  try {
    return window.localStorage.getItem(key) !== null;
  } catch {
    // Safari private mode throws on access. Treating that as "already seen"
    // beats reopening the dialog on every single page load.
    return true;
  }
}

/**
 * Whether this is the visitor's first time here.
 *
 * Reports `false` during SSR and on the first client paint, then settles. Once
 * `complete()` runs the flag persists and never flips back, so onboarding opens
 * exactly once.
 */
export function useFirstVisit(storageKey: string = DEFAULT_KEY) {
  const isFirstVisit = useSyncExternalStore(
    subscribe,
    () => !hasVisited(storageKey),
    () => false,
  );

  const complete = useCallback(() => {
    try {
      window.localStorage.setItem(storageKey, new Date().toISOString());
    } catch {
      // Nothing to persist to; the dialog still closes for this session.
    }
    emit();
  }, [storageKey]);

  const reset = useCallback(() => {
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      // Ignored for the same reason as above.
    }
    emit();
  }, [storageKey]);

  return { isFirstVisit, complete, reset };
}
