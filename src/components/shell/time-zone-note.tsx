"use client";

import * as React from "react";
import { useTimeZone } from "@/hooks/use-time-zone";
import { zoneCityLabel, zoneOffsetLabel } from "@/lib/timezone";
import { cn } from "@/lib/utils";

/**
 * Which timezone the times on screen are in.
 *
 * A calendar that quietly converts is a calendar you have to take on trust, and
 * the one thing worse than showing the wrong time is showing the right one
 * while the reader assumes it is the wrong one. So the zone is stated — once,
 * quietly, where a reader would look for it rather than where they cannot miss
 * it.
 *
 * The offset rather than the zone name, because `GMT+3` is four characters and
 * `Europe/Sofia` is twelve; the full name is in the tooltip. The offset is read
 * *now*, so it follows daylight saving without anything here knowing the rules.
 */
export function useTimeZoneCaption(): { short: string; full: string } {
  const zone = useTimeZone();
  return React.useMemo(
    () => ({
      short: zoneOffsetLabel(zone),
      full: `Event times are shown in your local timezone: ${zone} (${zoneOffsetLabel(zone)})`,
    }),
    [zone],
  );
}

export function TimeZoneNote({ className }: { className?: string }) {
  const { short, full } = useTimeZoneCaption();
  if (!short) return null;

  return (
    <span
      title={full}
      className={cn(
        "shrink-0 cursor-default rounded px-1 text-[11px] tabular-nums text-subtle-foreground",
        "transition-colors motion-safe:duration-(--dur-quick) hover:text-muted-foreground",
        className,
      )}
    >
      {short}
    </span>
  );
}

/** "Local time · GMT+3" — for a panel that has room to say it properly. */
export function TimeZoneCaption({ className }: { className?: string }) {
  const zone = useTimeZone();
  const { short, full } = useTimeZoneCaption();
  if (!short) return null;

  return (
    <span title={full} className={cn("cursor-default text-subtle-foreground", className)}>
      {zoneCityLabel(zone)} · {short}
    </span>
  );
}
