"use client";

import { CalendarPlus, Check, Copy, Download } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/primitives";
import { eventIcsPath, eventIcsUrl } from "@/lib/calendar-export/event-url";
import { buildGoogleCalendarUrl } from "@/lib/calendar-export/google";
import { buildOutlookEventUrl, OUTLOOK_ACCOUNTS } from "@/lib/calendar-export/outlook";
import type { CalendarPlatform } from "@/lib/calendar-export/platform";
import type { CuratedCalendarEvent } from "@/lib/curation/types";
import { useCalendarPlatform, useOrigin } from "@/hooks/use-browser-facts";
import { useIsTouch } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";

/**
 * Add *this one event* to a personal calendar.
 *
 * Deliberately not the same control as subscribing. Subscribing is a standing
 * arrangement — a feed that keeps arriving — and it lives in its own dialog
 * with its own filters. This copies one event across once, which is what
 * somebody wants for a Fed decision they intend to watch, and conflating the
 * two is how people end up with 200 markets in their work calendar.
 */

type Destination = {
  key: string;
  label: string;
  /** What the reader gets, in their words, not ours. */
  hint: string;
  href: string;
  external?: boolean;
  download?: boolean;
  icon?: React.ReactNode;
};

/**
 * The order destinations are offered in.
 *
 * A guess at the reader's platform, and only ever a sort key — every
 * destination is present in every order. An iPhone reader who is shown Google
 * first has to read four labels to find the one that works on their phone;
 * putting Apple first costs an Android reader nothing, because their entry is
 * still on the same sheet one line down.
 */
function order(platform: CalendarPlatform, keys: string[]): string[] {
  const first = platform === "apple" ? "apple" : "google";
  return [first, ...keys.filter((k) => k !== first)];
}

export function AddToCalendarMenu({ event }: { event: CuratedCalendarEvent }) {
  const [open, setOpen] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const isTouch = useIsTouch();

  /*
   * Both of these are browser-only facts, read through a store so the server
   * snapshot is the neutral one and the markup matches on hydration without
   * paying a second render. See `use-browser-facts`.
   */
  const platform = useCalendarPlatform();
  const origin = useOrigin();

  const siteUrl = origin || undefined;
  const icsPath = eventIcsPath(event);

  const copyLink = React.useCallback(() => {
    const url = origin ? eventIcsUrl(event, origin) : icsPath;
    // `navigator.clipboard` is unavailable on insecure origins and in a few
    // in-app browsers; the button simply reports nothing rather than throwing.
    void navigator.clipboard
      ?.writeText(url)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => undefined);
  }, [event, icsPath, origin]);

  const destinations: Record<string, Destination> = {
    apple: {
      key: "apple",
      label: "Apple Calendar",
      hint: "Opens in Calendar",
      /*
       * A real URL to a real `text/calendar` response, not a blob.
       *
       * This used to build the file in memory and click an anchor at
       * `URL.createObjectURL(...)`. On a desktop that downloads; on an iPhone
       * it does nothing whatsoever, because iOS Safari will not hand a `blob:`
       * or `data:` URL to the Calendar app. So the file is served from
       * `/api/calendar/event/…` and this is an ordinary link to it — which
       * also means it works with JavaScript off, and can be long-pressed and
       * shared like any other link.
       */
      href: icsPath,
    },
    google: {
      key: "google",
      label: "Google Calendar",
      hint: "Opens a prefilled event",
      href: buildGoogleCalendarUrl(event, { siteUrl }),
      external: true,
    },
    ...Object.fromEntries(
      // Outlook is two products behind one name and the hosts differ by account
      // type, so both are listed rather than one guessed.
      OUTLOOK_ACCOUNTS.map((account) => [
        `outlook-${account.value}`,
        {
          key: `outlook-${account.value}`,
          label: account.label,
          hint: account.hint,
          href: buildOutlookEventUrl(event, account.value, { siteUrl }),
          external: true,
        } satisfies Destination,
      ]),
    ),
    download: {
      key: "download",
      label: "Download .ics",
      hint: "For any other calendar app",
      href: icsPath,
      // Only this row asks for a download. The Apple row points at the same
      // file deliberately without it, because on iOS the attribute is ignored
      // and on a desktop it would say "save" where the reader asked for "open".
      download: true,
      icon: <Download className="size-4 shrink-0 text-subtle-foreground" aria-hidden />,
    },
  };

  const keys = order(platform, Object.keys(destinations));

  const rowClass = cn(
    "flex w-full items-center gap-3 rounded-lg px-3 text-left transition-colors",
    "motion-safe:duration-(--dur-quick) hover:bg-surface-hover active:bg-surface-hover",
    // 48px on touch — a thumb target, not a pointer target. The sheet exists to
    // make this a one-tap action and a 32px row would undo that.
    "min-h-12 sm:min-h-11 sm:rounded-md sm:px-2",
  );

  const rows = keys.map((key) => {
    const destination = destinations[key];
    const body = (
      <>
        {destination.icon}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[15px] text-foreground sm:text-[13.5px]">
            {destination.label}
          </span>
          <span className="truncate text-[12.5px] text-muted-foreground sm:text-[11.5px]">
            {destination.hint}
          </span>
        </span>
      </>
    );

    return (
      <a
        key={destination.key}
        href={destination.href}
        {...(destination.external
          ? { target: "_blank", rel: "noopener noreferrer" }
          : {})}
        {...(destination.download ? { download: "" } : {})}
        data-calendar-destination={destination.key}
        onClick={() => setOpen(false)}
        className={rowClass}
      >
        {body}
      </a>
    );
  });

  const copyRow = (
    <button type="button" onClick={copyLink} className={rowClass}>
      {copied ? (
        <Check className="size-4 shrink-0 text-accent" aria-hidden />
      ) : (
        <Copy className="size-4 shrink-0 text-subtle-foreground" aria-hidden />
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[15px] text-foreground sm:text-[13.5px]">
          {copied ? "Link copied" : "Copy link to this file"}
        </span>
        <span className="truncate text-[12.5px] text-muted-foreground sm:text-[11.5px]">
          Paste into any calendar that imports by URL
        </span>
      </span>
    </button>
  );

  const trigger = (
    <Button variant="outline" size="sm" className="h-10 gap-1.5 sm:h-8">
      <CalendarPlus />
      Add to calendar
    </Button>
  );

  /*
   * A sheet on touch, a popover on a pointer.
   *
   * `(hover: none) and (pointer: coarse)` rather than a width query: the thing
   * that makes a 240px popover wrong is a thumb, not a narrow window, and a
   * narrow desktop window still has a cursor. It is a capability query, so it
   * is not the user-agent sniffing the brief rules out.
   */
  if (isTouch) {
    return (
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerTrigger asChild>{trigger}</DrawerTrigger>
        <DrawerContent
          data-testid="add-to-calendar-sheet"
          className="pb-[env(safe-area-inset-bottom)]"
        >
          <div className="px-4 pb-2 pt-3">
            <DrawerTitle className="text-[15px] font-semibold tracking-tight text-foreground">
              Add to calendar
            </DrawerTitle>
            {/* The event's own title, so the sheet is unmistakably about the
                thing that was tapped — a phone has no hover card and no
                surrounding page to fall back on. */}
            <p className="mt-0.5 line-clamp-2 text-[13px] text-muted-foreground">
              {event.title}
            </p>
          </div>
          <div className="flex flex-col gap-0.5 overflow-y-auto px-1.5 pb-3">
            {rows}
            {copyRow}
          </div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-1">
        <div className="flex flex-col gap-0.5">
          {rows}
          {copyRow}
        </div>
      </PopoverContent>
    </Popover>
  );
}
