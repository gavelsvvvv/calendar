"use client";

import { Command } from "cmdk";
import { format } from "date-fns";
import { Loader2, Search } from "lucide-react";
import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { useNow } from "@/hooks/use-now";
import { getCategoryMeta } from "@/lib/categories";
import { searchEvents } from "@/lib/catalog/search";
import { isEventPast, type NowSnapshot } from "@/lib/event-time";
import { isHiddenEverywhere } from "@/lib/curation/filters";
import { isSettled } from "@/lib/curation/types";
import type { CalendarCategory, CuratedCalendarEvent } from "@/lib/curation/types";
import { fromDayKey } from "@/lib/dates";
import { formatCompactUsd } from "@/lib/format";
import { probabilityDisplay, probabilityLabel } from "@/lib/probability";
import { serializeCategories } from "@/lib/url-state";
import { cn } from "@/lib/utils";

export type SearchDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The loaded month, searched locally and instantly. */
  events: CuratedCalendarEvent[];
  /** The reader's category selection. Search obeys the same filters as the grid. */
  categories: CalendarCategory[];
  onSelectEvent: (event: CuratedCalendarEvent) => void;
  onNavigateToDate: (dayKey: string) => void;
};

const MAX_RESULTS = 25;

/**
 * Long enough that typing "fed decision" is one request rather than twelve,
 * short enough that it still feels like it is keeping up. Measured against the
 * usual 40–60ms between keystrokes.
 */
const DEBOUNCE_MS = 220;

/** Below this a query matches too much to be worth a round trip. */
const MIN_REMOTE_QUERY = 2;

type RemoteState = {
  results: CuratedCalendarEvent[];
  /**
   * Which query these results answer.
   *
   * Both a guard and the loading flag. A slow response for "fed" landing after
   * a fast one for "fed decision" is stamped with the wrong query and ignored;
   * and "the stamp does not match what is typed" is exactly what "still
   * loading" means, so there is no second piece of state to keep in sync with
   * it — and nothing to reset when the reader deletes back to one character.
   */
  query: string;
};

/**
 * Search the loaded month instantly, and the wider catalog a moment later.
 *
 * Two sources, and the split is deliberate. The month in memory can be searched
 * on every keystroke for free, so it is — results appear as fast as the reader
 * types. Everything beyond it lives in a server-side catalog covering nine
 * months, which is queried on a debounce and merged in underneath. Nothing of
 * that catalog is downloaded at page load; the request does not happen until
 * this dialog is open and somebody has typed two characters.
 *
 * The ranking is the same function on both sides — `searchEvents` — so the two
 * halves of the list are ordered by one set of rules rather than by whichever
 * source they came from.
 */
export function SearchDialog({
  open,
  onOpenChange,
  events,
  categories,
  onSelectEvent,
  onNavigateToDate,
}: SearchDialogProps) {
  const [query, setQuery] = React.useState("");
  const [remote, setRemote] = React.useState<RemoteState>({ results: [], query: "" });
  const now = useNow();

  const trimmed = query.trim();
  const categoryParam = React.useMemo(
    () => serializeCategories(categories),
    [categories],
  );

  /*
   * The catalog query.
   *
   * Debounced, aborted on every change, and gated on the dialog being open —
   * all three matter. Without the abort, a slow response for "fed" can land
   * after a fast one for "fed decision" and replace it; the `query` stamp on
   * the state is the second line of defence for exactly that.
   */
  const searching = open && trimmed.length >= MIN_REMOTE_QUERY && remote.query !== trimmed;

  React.useEffect(() => {
    if (!open || trimmed.length < MIN_REMOTE_QUERY) return;

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q: trimmed });
        if (categoryParam !== null) params.set("categories", categoryParam);
        const res = await fetch(`/api/search?${params}`, { signal: controller.signal });
        const json: { results?: CuratedCalendarEvent[] } = await res.json();
        setRemote({ results: json.results ?? [], query: trimmed });
      } catch {
        // An aborted or failed catalog query is not an error the reader needs
        // to see: the local results are still on screen and still correct.
        // Stamping the query anyway is what clears the spinner.
        if (!controller.signal.aborted) setRemote({ results: [], query: trimmed });
      }
    }, DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [open, trimmed, categoryParam]);

  /*
   * One list, ranked once.
   *
   * The two sources are merged *before* ranking rather than rendered one after
   * the other, and that ordering is the whole point. Rendering the loaded month
   * first put "Fed Decision in July?" — resolved three weeks ago, and the
   * biggest of the family because a finished market has traded for months — at
   * the top of a search for "Fed Decision", above September's. Provenance is
   * not worth that: every row already prints its date, which says where it is
   * far better than a section heading did, and `searchEvents` already knows to
   * rank upcoming above settled.
   */
  const results = React.useMemo(() => {
    /*
     * The loaded month arrives unfiltered — it has to, because the sidebar's
     * category counts are computed from the same array — so the two rules the
     * grid applies for reasons unrelated to the reader's filters are applied
     * here instead. Without them a retired event, or one that settled with a
     * future deadline, was searchable while being undrawable.
     */
    const now = new Date();
    const visible = events.filter((e) => !isHiddenEverywhere(e, now));
    const merged = [...visible];
    const seen = new Set(visible.map((e) => e.id));
    if (remote.query === trimmed) {
      for (const event of remote.results) {
        if (seen.has(event.id)) continue;
        seen.add(event.id);
        merged.push(event);
      }
    }
    return searchEvents(merged, trimmed, { categories, limit: MAX_RESULTS }).map((h) => h.event);
  }, [events, trimmed, categories, remote]);

  const choose = (event: CuratedCalendarEvent) => {
    onNavigateToDate(event.displayDate);
    onSelectEvent(event);
    setQuery("");
    onOpenChange(false);
  };

  const nothing = results.length === 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Reset on the way out, so reopening starts clean without an effect.
        if (!next) setQuery("");
        onOpenChange(next);
      }}
    >
      <DialogContent
        showClose={false}
        aria-describedby={undefined}
        className="top-[8vh] max-w-lg translate-y-0 overflow-hidden p-0 sm:top-[10vh]"
      >
        <DialogTitle className="sr-only">Search events</DialogTitle>
        <DialogDescription className="sr-only">
          Search by event title, person, team, country, company or category.
        </DialogDescription>

        <Command shouldFilter={false} className="flex flex-col">
          <div className="flex items-center gap-2 border-b border-border px-3">
            <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <Command.Input
              value={query}
              onValueChange={setQuery}
              autoFocus
              placeholder="Search events, people, teams…"
              /* 16px below `sm` on purpose: Safari zooms the whole page in
                 when a focused input's text is smaller than that. */
              className="h-12 min-w-0 flex-1 bg-transparent text-[16px] text-foreground outline-none placeholder:text-subtle-foreground sm:h-11 sm:text-[14px]"
            />
            {searching && (
              <Loader2
                className="size-4 shrink-0 animate-spin text-subtle-foreground motion-reduce:animate-none"
                aria-label="Searching all events"
              />
            )}
          </div>

          <Command.List className="max-h-[54vh] overflow-y-auto overscroll-contain scrollbar-slim p-1">
            {categories.length === 0 ? (
              <p className="px-3 py-8 text-center text-[13px] text-muted-foreground">
                No categories selected. Use Show all to search events.
              </p>
            ) : nothing ? (
              <p className="px-3 py-8 text-center text-[13px] text-muted-foreground">
                {searching ? "Searching…" : "No events match that search."}
              </p>
            ) : (
              results.map((event) => (
                <Result key={event.id} event={event} now={now} onChoose={choose} />
              ))
            )}
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

function Result({
  event,
  now,
  onChoose,
}: {
  event: CuratedCalendarEvent;
  now: NowSnapshot | null;
  onChoose: (event: CuratedCalendarEvent) => void;
}) {
  const category = getCategoryMeta(event.category);
  const probability = probabilityDisplay(event);
  const isPast = isEventPast(event, now);
  const settled = isSettled(event.status);

  return (
    <Command.Item
      value={event.id}
      onSelect={() => onChoose(event)}
      data-event-past={isPast ? "true" : "false"}
      className={cn(
        isPast && "is-past",
        "flex min-h-12 cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 sm:min-h-0 sm:rounded",
        "transition-colors motion-safe:duration-(--dur-quick)",
        "data-[selected=true]:bg-surface-hover",
      )}
    >
      <span className={cn("size-2 shrink-0 rounded-full", category.dot)} aria-hidden />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[14px] text-foreground sm:text-[13px]">{event.title}</span>
        <span className="truncate text-[11px] text-muted-foreground">
          {category.label} · {format(fromDayKey(event.displayDate), "d MMM")} ·{" "}
          {formatCompactUsd(event.volume)}
        </span>
      </span>
      {/* Status, where it changes what the number means. A price on a settled
          market is a result, not a forecast, and saying so is cheaper than
          hoping the reader infers it from the date. */}
      {settled ? (
        <span className="shrink-0 text-[11px] capitalize text-subtle-foreground">
          {event.status === "resolved" ? "Resolved" : "Closed"}
        </span>
      ) : event.status === "live" ? (
        <span className="shrink-0 text-[11px] text-subtle-foreground">Live</span>
      ) : null}
      {probability && (
        <span className="max-w-[38%] shrink-0 truncate text-right text-[12px] tabular-nums text-muted-foreground">
          {probabilityLabel(probability, 14)}
        </span>
      )}
    </Command.Item>
  );
}
