"use client";

import { ChevronDown } from "lucide-react";
import * as React from "react";
import { Checkbox, Popover, PopoverContent, PopoverTrigger } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

/**
 * The second-level Sport / eSport picker.
 *
 * ## What it has to say in one line
 *
 * The parent row is a checkbox in a narrow rail, and the sub-selection has to
 * summarise itself underneath it without ever wrapping to a third line — a
 * filter list that grows vertically as you tick boxes pushes the rest of the
 * sidebar around while you are still using it. So the summary degrades in three
 * steps: "All Sports" when nothing is narrowed, then the actual names while
 * they fit, then "N selected" once they don't.
 *
 * Naming them while they fit matters more than it looks. "3 selected" is
 * accurate and useless — it makes the reader open the popover to find out what
 * they picked — so the names are kept for as long as the rail can hold them.
 *
 * ## Why a popover rather than an inline list
 *
 * Ten sports and nine games inline would be nineteen extra rows in a sidebar
 * that already holds eleven categories, a mini calendar and the importance
 * radio group, and they would be there permanently for the benefit of a control
 * most readers never touch. The popover keeps the rail at its current height
 * and costs one click for the readers who want it.
 */

export type SubFilterOption = {
  id: string;
  label: string;
  /** The compact form used in the summary line — "NFL" rather than "American Football". */
  short: string;
};

export type SubFilterProps = {
  /** "Sport" or "eSport" — used in labels and announcements. */
  title: string;
  /** The all-selected wording: "All Sports" / "All Games". */
  allLabel: string;
  options: readonly SubFilterOption[];
  selected: readonly string[];
  /** How many events each option has in the loaded range. */
  counts: Readonly<Record<string, number>>;
  onChange: (next: string[]) => void;
  /** Larger hit targets inside the mobile drawer. */
  touch?: boolean;
  /** The parent category is unticked, so this narrows nothing. */
  disabled?: boolean;
};

/**
 * How many names fit on the summary line before it becomes a count.
 *
 * Three, measured against the rail: `--sidebar-width` is 256px, the summary is
 * indented past the parent checkbox, and three short labels with separators
 * ("Tennis · NFL · NBA") is what fits at the smallest supported width without
 * truncating. A fourth is what pushed it to two lines on an iPhone.
 */
const MAX_NAMED = 3;

function summarise(
  selected: readonly string[],
  options: readonly SubFilterOption[],
  allLabel: string,
): string {
  if (selected.length >= options.length) return allLabel;
  if (selected.length === 0) return "None";
  // Ordered by the option list rather than by click order, so the summary is
  // stable: ticking Tennis then NFL reads the same as NFL then Tennis.
  const names = options.filter((o) => selected.includes(o.id)).map((o) => o.short);
  if (names.length > MAX_NAMED) return `${names.length} selected`;
  return names.join(" · ");
}

export function SubFilter({
  title,
  allLabel,
  options,
  selected,
  counts,
  onChange,
  touch = false,
  disabled = false,
}: SubFilterProps) {
  const allSelected = selected.length >= options.length;
  const summary = summarise(selected, options, allLabel);

  const toggle = (id: string) => {
    /*
     * Deselecting from "All" drops into an explicit subset of everything else,
     * and selecting the last missing one normalises back to All. Both fall out
     * of storing the plain list rather than a separate "all" flag — there is
     * one canonical state, and "all" is simply what a full list is called.
     */
    const next = selected.includes(id)
      ? selected.filter((s) => s !== id)
      : [...selected, id];
    // Emitted in option order so the value is canonical regardless of click order.
    onChange(options.filter((o) => next.includes(o.id)).map((o) => o.id));
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-sub-filter={title.toLowerCase()}
          data-sub-filter-summary={summary}
          disabled={disabled}
          aria-label={`${title} selection: ${summary}`}
          className={cn(
            "flex w-full items-center gap-1 rounded text-left text-muted-foreground transition-colors motion-safe:duration-(--dur-quick)",
            "hover:bg-surface-hover hover:text-foreground active:bg-surface-hover",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
            // Indented to sit under the parent label rather than under its
            // checkbox, so it reads as belonging to the row above.
            touch ? "min-h-9 px-2 pl-[52px] text-[12px]" : "min-h-7 px-1 pl-[34px] text-[11px]",
            disabled && "pointer-events-none opacity-40",
          )}
        >
          <span className="min-w-0 flex-1 truncate">{summary}</span>
          <ChevronDown className="size-3 shrink-0 opacity-60" aria-hidden />
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        // Never wider than a small phone's viewport, and allowed to scroll
        // rather than to grow past the bottom of the screen.
        className="max-h-[min(60vh,380px)] w-[240px] max-w-[calc(100vw-2rem)] overflow-y-auto p-1.5 scrollbar-slim"
      >
        <p className="px-2 pb-1 pt-0.5 text-[11px] font-medium uppercase tracking-wide text-subtle-foreground">
          {title}
        </p>

        <label
          data-sub-filter-all
          className={cn(
            "flex cursor-pointer items-center gap-2.5 rounded px-2 transition-colors motion-safe:duration-(--dur-quick) hover:bg-surface-hover",
            touch ? "min-h-10" : "min-h-8",
          )}
        >
          <Checkbox
            checked={allSelected}
            /*
             * Ticking All selects everything; unticking it clears to nothing.
             * Clearing rather than "restoring the previous subset" because the
             * reader has one obvious way to express "no sports" and this is it —
             * and because a hidden remembered subset reappearing on a second
             * click is the kind of state nobody predicts.
             */
            onCheckedChange={(checked) =>
              onChange(checked ? options.map((o) => o.id) : [])
            }
            aria-label={allLabel}
          />
          <span className="flex-1 text-[13px] font-medium text-foreground">{allLabel}</span>
        </label>

        <div className="my-1 h-px bg-border" />

        <ul className="flex flex-col">
          {options.map((option) => {
            const count = counts[option.id] ?? 0;
            return (
              <li key={option.id}>
                <label
                  data-sub-filter-option={option.id}
                  className={cn(
                    "flex cursor-pointer items-center gap-2.5 rounded px-2 transition-colors motion-safe:duration-(--dur-quick) hover:bg-surface-hover",
                    touch ? "min-h-10" : "min-h-8",
                    /*
                     * Dimmed, never hidden. A sport with nothing this month is
                     * not a sport we do not support — Polymarket's hockey book
                     * is empty in August and busy in October — and removing the
                     * row would make the list appear to change size for reasons
                     * the reader cannot see. Same treatment as a zero-count
                     * category row above it.
                     */
                    count === 0 && "opacity-55",
                  )}
                >
                  <Checkbox
                    checked={selected.includes(option.id)}
                    onCheckedChange={() => toggle(option.id)}
                    aria-label={`${option.label}, ${count} event${count === 1 ? "" : "s"}`}
                  />
                  <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">
                    {option.label}
                  </span>
                  <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                    {count}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
