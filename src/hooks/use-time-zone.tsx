"use client";

import * as React from "react";
import {
  detectTimeZone,
  FALLBACK_TIME_ZONE,
  subscribeToTimeZone,
  TIME_ZONE_COOKIE,
} from "@/lib/timezone";

/**
 * The viewer's timezone, without a hydration mismatch.
 *
 * The server cannot know it. What it can do is remember: the browser writes its
 * IANA zone to a cookie on the first visit, and every render after that — server
 * and client — starts from the same answer. Only a genuinely first-ever visit
 * pays anything, and it pays one re-render rather than a flash of wrong markup,
 * because `useSyncExternalStore` renders `getServerSnapshot` during hydration
 * and switches to the real value immediately afterwards. That is the whole
 * reason this is a store and not `useEffect` + `useState`.
 *
 * The server value arrives through context rather than a module variable: module
 * state on the server is shared by every request in the process, so two readers
 * in different zones would overwrite each other.
 */
const ServerTimeZone = React.createContext<string>(FALLBACK_TIME_ZONE);

export function TimeZoneProvider({
  value,
  children,
}: {
  value: string;
  children: React.ReactNode;
}) {
  /*
   * A backstop. The cookie is written by an inline script in the document head,
   * before the first paint and long before this runs — but that script is the
   * kind of thing an extension or a strict CSP can suppress, and a calendar
   * quietly stuck in the wrong timezone is worse than a redundant write.
   *
   * A year is long enough to be useful and `Lax` keeps it off cross-site
   * requests; it is a display preference, not a credential.
   */
  React.useEffect(() => {
    const zone = detectTimeZone();
    document.cookie = `${TIME_ZONE_COOKIE}=${encodeURIComponent(zone)}; path=/; max-age=31536000; samesite=lax`;
  }, []);

  return <ServerTimeZone.Provider value={value}>{children}</ServerTimeZone.Provider>;
}

/** The IANA zone every displayed time and calendar day is derived in. */
export function useTimeZone(): string {
  const serverZone = React.useContext(ServerTimeZone);
  return React.useSyncExternalStore(
    subscribeToTimeZone,
    detectTimeZone,
    React.useCallback(() => serverZone, [serverZone]),
  );
}
