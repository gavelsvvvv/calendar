"use client";

import { CalendarPlus, CalendarRange, Check, HelpCircle, Star, X } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerClose, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { Checkbox } from "@/components/ui/primitives";
import { CATEGORIES } from "@/lib/categories";
import { categorySelection, type CalendarFilters } from "@/lib/curation/filters";
import { ESPORTS, SPORTS } from "@/lib/sports/taxonomy";
import { SubFilter } from "./sub-filter";
import type { CalendarCategory, ImportanceLevel } from "@/lib/curation/types";
import { cn } from "@/lib/utils";
import { Brand } from "./brand";
import { MiniCalendar } from "./mini-calendar";

export type CalendarSidebarProps = {
  /** Drawer state, small screens only. */
  open: boolean;
  /** Desktop collapse. Distinct from `open`: one is an overlay, one is layout. */
  collapsed?: boolean;
  onClose: () => void;
  anchor: Date;
  selectedDate: string | null;
  filters: CalendarFilters;
  counts: Partial<Record<CalendarCategory, number>>;
  /** Per-sport and per-game totals for the second-level pickers. */
  sportCounts: Readonly<Record<string, number>>;
  esportCounts: Readonly<Record<string, number>>;
  favoriteCount: number;
  daysWithEvents: ReadonlySet<string>;
  onSelectDay: (dayKey: string) => void;
  onNavigateMonth: (date: Date) => void;
  onToggleCategory: (category: CalendarCategory) => void;
  onFiltersChange: (update: Partial<CalendarFilters>) => void;
  onShowAllCategories: () => void;
  onClearCategories: () => void;
  /**
   * Home, from the drawer's own logo.
   *
   * The app bar hides the brand below `sm` — the month title needs the room —
   * so on a phone this header is where the lockup actually appears, and it is
   * the only place a "tap the logo to go home" instinct has to land.
   */
  onHome: () => void;
  onOpenSubscribe: () => void;
  onOpenHelp: () => void;
};

const IMPORTANCE_OPTIONS: Array<{ value: ImportanceLevel | "all"; label: string }> = [
  { value: "all", label: "All events" },
  { value: "important", label: "Important+" },
  { value: "major", label: "Major only" },
];

/**
 * Row geometry, in one place.
 *
 * The drawer is not the rail at a different width — it is the same information
 * at finger scale. Rather than sprinkle `max-lg:` through every row, each
 * surface picks a size once and passes it down: 36px rows and 13px text in the
 * rail, 48px rows and 15px text in the drawer, which is where iOS puts a list
 * item you are meant to hit without looking.
 */
type Scale = {
  touch: boolean;
  row: string;
  text: string;
  gap: string;
  section: string;
};

/*
 * Compacted so the whole rail has a chance of fitting a laptop screen.
 *
 * The shell is exactly one viewport tall now, so anything the sidebar spends
 * is height the reader has to scroll for. 32px rows and a 12px gap between
 * sections keeps eleven categories, two saved views, three importance levels
 * and the mini month inside about 1,000px — which fits a 1080p screen outright
 * and leaves the shorter ones a short scroll rather than a long one.
 */
const RAIL: Scale = {
  touch: false,
  row: "min-h-8 rounded px-2",
  text: "text-[13px]",
  gap: "gap-px",
  section: "gap-3 p-3",
};

const TOUCH: Scale = {
  touch: true,
  row: "min-h-12 rounded-lg px-3",
  text: "text-[15px]",
  gap: "gap-0.5",
  section: "gap-5 p-4",
};

/** A saved view: on or off, with the count it would show. */
function QuickFilter({
  icon,
  label,
  count,
  active,
  onClick,
  scale,
}: {
  icon: React.ReactNode;
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
  scale: Scale;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 text-left transition-colors motion-safe:duration-(--dur-quick)",
        scale.row,
        scale.text,
        active
          ? "bg-accent-soft font-medium text-foreground"
          : "text-muted-foreground hover:bg-surface-hover hover:text-foreground active:bg-surface-hover",
      )}
    >
      <span className={cn("shrink-0", active && "text-accent")}>{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined && (
        <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground">{count}</span>
      )}
    </button>
  );
}

/**
 * The rail's two actions, pinned.
 *
 * They live outside the scrolling body because they are the only things in the
 * sidebar a reader needs to be able to reach *without* having read the rest —
 * and on a 720px-tall screen the category list alone is taller than the rail.
 * The drawer keeps them in flow, where a phone's own scroll reaches them
 * naturally.
 */
function RailActions({
  onOpenSubscribe,
  onOpenHelp,
}: {
  onOpenSubscribe: () => void;
  onOpenHelp: () => void;
}) {
  return (
    <div className="flex shrink-0 flex-col gap-1.5 border-t border-border bg-surface p-3">
      {/* "Subscribe", not "Add to calendar": that phrase belongs to the button
          on a single event, and the two do different things — one copies one
          event across, this sets up a feed that keeps arriving. */}
      <Button variant="outline" size="sm" onClick={onOpenSubscribe} className="w-full">
        Subscribe
      </Button>
      <button
        type="button"
        onClick={onOpenHelp}
        className="rounded px-1 text-left text-[12px] text-muted-foreground transition-colors hover:text-foreground hover:underline"
      >
        How it works
      </button>
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </h2>
  );
}

/**
 * The left rail: a mini month, the category "calendars", and the two controls
 * that decide how much of Polymarket reaches the grid.
 */
export function CalendarSidebar(props: CalendarSidebarProps) {
  return (
    <>
      {/*
        Both shells are always mounted and CSS decides which one is visible.
        Choosing in JS meant the server rendered no sidebar at all — the media
        query has to answer `false` during SSR — and a 256px rail appeared the
        moment React hydrated, shoving the whole grid sideways. That single
        decision was most of a 0.167 cumulative layout shift.

        The drawer costs nothing while closed: vaul mounts its content on open.
      */}
      <aside
        id="calendar-sidebar"
        aria-label="Calendar filters"
        /*
         * Width, not display, so the rail slides rather than blinking out.
         * `lg:` keeps it absent below the breakpoint where the drawer takes
         * over. Overflow is clipped during the transition or the contents would
         * spill across the grid on the way out.
         */
        className={cn(
          "hidden shrink-0 overflow-hidden border-border bg-surface",
          // A column, so the actions can sit below a body that scrolls on its
          // own rather than taking the whole page with it.
          "lg:flex lg:flex-col",
          "motion-safe:transition-[width] motion-safe:duration-(--dur-slow) motion-safe:ease-(--ease-out)",
          props.collapsed ? "lg:w-0 lg:border-r-0" : "lg:w-[var(--sidebar-width)] lg:border-r",
        )}
      >
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain scrollbar-slim">
          <SidebarBody {...props} scale={RAIL} />
        </div>
        <RailActions onOpenSubscribe={props.onOpenSubscribe} onOpenHelp={props.onOpenHelp} />
      </aside>

      <div className="lg:hidden">
        <Drawer open={props.open} onOpenChange={(o) => !o && props.onClose()} direction="left">
          <DrawerContent
            aria-describedby={undefined}
            // The visible heading is the mark; the dialog still needs to
            // announce what it is for.
            aria-label="Calendar filters"
            handle={false}
            data-testid="sidebar-drawer"
            className="inset-y-0 left-0 right-auto mt-0 h-full max-h-none w-[88vw] max-w-[320px] rounded-none border-r border-t-0 shadow-[8px_0_40px_-12px_rgb(0_0_0/0.25)]"
          >
            {/*
              A header, not a floating close button. The drawer takes over the
              whole left edge on a phone, so it needs to say what it is — and
              the dismiss control belongs at the top-*right* of a left-hand
              panel, furthest from the edge you swiped from.
            */}
            <div className="flex h-[var(--app-bar-height)] shrink-0 items-center gap-2 border-b border-border px-4">
              <DrawerTitle className="min-w-0 flex-1">
                {/* The title still names the dialog for a screen reader; the
                    button inside it is the control. */}
                <Brand alwaysShowName onHome={props.onHome} />
              </DrawerTitle>
              <DrawerClose asChild>
                <button
                  type="button"
                  aria-label="Close"
                  className="-mr-2 flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors motion-safe:duration-(--dur-quick) active:bg-surface-hover active:text-foreground"
                >
                  <X className="size-5" aria-hidden />
                </button>
              </DrawerClose>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain scrollbar-slim">
              <SidebarBody {...props} scale={TOUCH} />
            </div>
          </DrawerContent>
        </Drawer>
      </div>
    </>
  );
}

function SidebarBody({
  anchor,
  selectedDate,
  filters,
  counts,
  sportCounts,
  esportCounts,
  favoriteCount,
  daysWithEvents,
  onSelectDay,
  onNavigateMonth,
  onToggleCategory,
  onFiltersChange,
  onShowAllCategories,
  onClearCategories,
  onOpenSubscribe,
  onOpenHelp,
  scale,
}: CalendarSidebarProps & { scale: Scale }) {
  /**
   * One list, and a box that means exactly what it looks like.
   *
   * These boxes have been through two wrong models. First they ticked
   * themselves when nothing was selected, on the reasoning that no filter means
   * everything is showing — which made pressing Clear look as though the app
   * had just chosen ten categories on your behalf. Then they stayed empty and
   * the calendar carried on showing everything anyway, which is worse: the
   * boxes and the grid disagreed, and the panel had to print a sentence
   * explaining that the checkboxes did not mean what checkboxes mean.
   *
   * Now a ticked box is a category that is showing and an unticked one is not.
   * A fresh visit ticks them all; Clear unticks them all and the calendar goes
   * empty, and neither state needs a footnote.
   */
  const { touch } = scale;
  /*
   * One selector, three questions, and none of them defined as the negation of
   * another. That last part is the bug this replaced: "Clear all" was shown
   * when the reader had *narrowed* something, which a fresh visit — every
   * category ticked — has not. So the button sat hidden in the one state where
   * it had the most to do, and appeared only after you had unticked a box by
   * hand, which is the opposite of helpful.
   */
  const { selectedCategoryCount, hasSelectedCategories, allCategoriesSelected } =
    categorySelection(filters);
  const noneSelected = !hasSelectedCategories;
  const allSelected = allCategoriesSelected;

  return (
    <div
      className={cn("flex flex-col", scale.section)}
      style={touch ? { paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))" } : undefined}
    >
      <section className={touch ? undefined : "pt-1"}>
        <MiniCalendar
          anchor={anchor}
          selectedDate={selectedDate}
          onSelectDay={onSelectDay}
          onNavigateMonth={onNavigateMonth}
          daysWithEvents={daysWithEvents}
          touch={touch}
        />
      </section>

      {/* Two saved views rather than filters you assemble. They compose with the
          category boxes below instead of replacing them, so "starred, this
          weekend, sports only" is a thing you can ask for. */}
      <section className={cn("border-t border-border", touch ? "pt-3" : "pt-2.5")}>
        <SectionHeading>Quick filters</SectionHeading>
        <div className={cn(touch ? "mt-1.5" : "mt-1", "flex flex-col", scale.gap)}>
          <QuickFilter
            scale={scale}
            icon={<CalendarRange className={touch ? "size-[18px]" : "size-4"} aria-hidden />}
            label="Upcoming this weekend"
            active={filters.weekendOnly}
            onClick={() => onFiltersChange({ weekendOnly: !filters.weekendOnly })}
          />
          <QuickFilter
            scale={scale}
            icon={
              <Star
                className={cn(
                  touch ? "size-[18px]" : "size-4",
                  filters.favoritesOnly && "fill-current",
                )}
                aria-hidden
              />
            }
            label="Favorites"
            count={favoriteCount}
            active={filters.favoritesOnly}
            onClick={() => onFiltersChange({ favoritesOnly: !filters.favoritesOnly })}
          />
        </div>
      </section>

      <section className={cn("border-t border-border", touch ? "pt-3" : "pt-2.5")}>
        <div className={cn("flex items-center justify-between", touch ? "mb-1.5" : "mb-1")}>
          <SectionHeading>My calendars</SectionHeading>
          {/*
            Two controls, and now genuinely opposite: one ticks every box, the
            other unticks every box. Neither touches importance, the quick
            filters or the search — their scope is the list they sit above, and
            each of those has its own off-switch anyway.

            Both are always rendered and go disabled at their own extreme,
            rather than appearing and disappearing. An action that vanishes once
            you have used it is one you cannot find again, and a control that
            comes and goes also moves the heading beside it.
          */}
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              data-action="show-all-categories"
              disabled={allSelected}
              onClick={onShowAllCategories}
              title={
                allSelected ? "Every category is already selected" : "Select every category"
              }
              className={cn(
                "flex items-center gap-1 rounded px-1 font-medium transition-colors",
                touch ? "min-h-11 px-2 text-[13px]" : "text-[11px]",
                allSelected
                  ? "cursor-default text-subtle-foreground"
                  : "text-accent hover:underline",
              )}
            >
              {allSelected && <Check className="size-3 shrink-0" aria-hidden />}
              Show all
            </button>
            {/*
              `selectedCategoryCount > 0`, and nothing cleverer.

              Not "the reader has narrowed something", which is what it used to
              ask and which is false on a fresh visit — every category ticked is
              the default, so the button that empties them was hidden exactly
              when the list was fullest.
            */}
            <button
              type="button"
              data-action="clear-categories"
              disabled={!hasSelectedCategories}
              onClick={onClearCategories}
              title={
                hasSelectedCategories
                  ? `Deselect all ${selectedCategoryCount} categories`
                  : "No categories are selected"
              }
              className={cn(
                "rounded px-1 font-medium transition-colors",
                touch ? "min-h-11 px-2 text-[13px]" : "text-[11px]",
                hasSelectedCategories
                  ? "text-accent hover:underline"
                  : "cursor-default text-subtle-foreground",
              )}
            >
              Clear all
            </button>
          </div>
        </div>

        {/*
          The calendar is empty and the reason is right here, next to the
          control that fixes it. This used to read "Showing all events", which
          was the panel apologising for a bug rather than describing a state.
        */}
        {noneSelected && (
          <p
            data-category-empty-state
            className={cn(
              "px-1 text-subtle-foreground",
              touch ? "mb-1.5 text-[12px]" : "mb-1 text-[11px]",
            )}
          >
            No categories selected. Use Show all to display events.
          </p>
        )}
        {/*
          The counts stay whatever is ticked, and that is the point of them.
          They report how much each category *has*, not how much is currently
          drawn — which is exactly what a reader needs in order to decide which
          box to tick after clearing the list. Counting the filtered set would
          print 0 against every unticked row.
        */}

        <ul className={cn("flex flex-col", scale.gap)}>
          {CATEGORIES.map((category) => {
            const count = counts[category.id] ?? 0;
            /*
             * Two categories carry a second level. Rendered inside the same
             * list item as the parent row so the summary line moves with it and
             * a screen reader reaches it immediately after the checkbox it
             * qualifies.
             */
            const sub =
              category.id === "sports"
                ? {
                    title: "Sport",
                    allLabel: "All Sports",
                    options: SPORTS,
                    selected: filters.sports,
                    counts: sportCounts,
                    onChange: (next: string[]) =>
                      onFiltersChange({ sports: next as CalendarFilters["sports"] }),
                  }
                : category.id === "esports"
                  ? {
                      title: "eSport",
                      allLabel: "All Games",
                      options: ESPORTS,
                      selected: filters.esports,
                      counts: esportCounts,
                      onChange: (next: string[]) =>
                        onFiltersChange({ esports: next as CalendarFilters["esports"] }),
                    }
                  : null;
            return (
              <li key={category.id}>
                <label
                  data-category-row={category.id}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 transition-colors motion-safe:duration-(--dur-quick) hover:bg-surface-hover active:bg-surface-hover",
                    touch ? "min-h-12 rounded-lg px-2" : "min-h-9 rounded px-1 py-1",
                    count === 0 && "opacity-55",
                  )}
                >
                  <Checkbox
                    className={touch ? "size-[22px] rounded-md" : undefined}
                    checked={filters.categories.includes(category.id)}
                    onCheckedChange={() => onToggleCategory(category.id)}
                    aria-label={`${category.label}, ${count} event${count === 1 ? "" : "s"}`}
                  />
                  <span
                    className={cn(
                      "shrink-0 rounded-full",
                      touch ? "size-2.5" : "size-2",
                      category.dot,
                    )}
                    aria-hidden
                  />
                  <span className={cn("min-w-0 flex-1 truncate text-foreground", scale.text)}>
                    {category.label}
                  </span>
                  {/* Always a number. An empty cell in week view read as the
                      counts having vanished, when the honest answer was zero. */}
                  <span
                    data-category-count={count}
                    className="shrink-0 text-[12px] tabular-nums text-muted-foreground"
                  >
                    {count}
                  </span>
                </label>
                {sub && (
                  <SubFilter
                    title={sub.title}
                    allLabel={sub.allLabel}
                    options={sub.options}
                    selected={sub.selected}
                    counts={sub.counts}
                    onChange={sub.onChange}
                    touch={touch}
                    /*
                     * Greyed out rather than hidden when the parent is
                     * unticked. The sub-selection is still remembered — that is
                     * the point of §12 — and hiding the control would make it
                     * look forgotten. Disabled says "this does nothing right
                     * now" without claiming it does not exist.
                     */
                    disabled={!filters.categories.includes(category.id)}
                  />
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section className={cn("border-t border-border", touch ? "pt-3" : "pt-2.5")}>
        <SectionHeading>Importance</SectionHeading>
        <div
          className={cn(touch ? "mt-1.5" : "mt-1", "flex flex-col", scale.gap)}
          role="radiogroup"
          aria-label="Minimum importance"
        >
          {IMPORTANCE_OPTIONS.map((option) => {
            const active = filters.minImportance === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onFiltersChange({ minImportance: option.value })}
                className={cn(
                  "flex items-center text-left transition-colors motion-safe:duration-(--dur-quick)",
                  scale.row,
                  scale.text,
                  active
                    ? "bg-accent-soft font-medium text-foreground"
                    : "text-muted-foreground hover:bg-surface-hover hover:text-foreground active:bg-surface-hover",
                )}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </section>

      <section className={cn("border-t border-border", touch ? "pt-3" : "pt-2.5")}>
        <SectionHeading>Advanced</SectionHeading>
        <label
          className={cn(
            "flex cursor-pointer items-start gap-3 transition-colors motion-safe:duration-(--dur-quick) hover:bg-surface-hover active:bg-surface-hover",
            touch ? "mt-1.5 rounded-lg px-2 py-2.5" : "mt-1 min-h-8 rounded px-1 py-1",
          )}
        >
          <Checkbox
            className={cn("mt-0.5", touch && "size-[22px] rounded-md")}
            checked={filters.includeSmallerMarkets}
            onCheckedChange={(value) => onFiltersChange({ includeSmallerMarkets: value === true })}
          />
          <span className="min-w-0 flex-1">
            <span className={cn("block text-foreground", scale.text)}>
              Include smaller markets
            </span>
            <span className="block text-[12px] leading-snug text-muted-foreground">
              Shows lower-volume events that are normally filtered out.
            </span>
          </span>
        </label>
      </section>

      {/*
        The drawer's tail. On a phone these are the "settings" rows an iOS
        navigation panel ends with — full-width list items with an icon, not a
        button and a link pretending to be one.
      */}
      {touch ? (
        <section className="flex flex-col gap-0.5 border-t border-border pt-3">
          <button
            type="button"
            onClick={onOpenSubscribe}
            className="flex min-h-12 items-center gap-3 rounded-lg px-3 text-left text-[15px] text-foreground transition-colors motion-safe:duration-(--dur-quick) active:bg-surface-hover"
          >
            <CalendarPlus className="size-[18px] shrink-0 text-muted-foreground" aria-hidden />
            Subscribe to this calendar
          </button>
          <button
            type="button"
            onClick={onOpenHelp}
            className="flex min-h-12 items-center gap-3 rounded-lg px-3 text-left text-[15px] text-foreground transition-colors motion-safe:duration-(--dur-quick) active:bg-surface-hover"
          >
            <HelpCircle className="size-[18px] shrink-0 text-muted-foreground" aria-hidden />
            How it works
          </button>
          {/*
            Independence, stated where the reader already is.

            This line used to read "Powered by Polymarket", which is an
            affiliation claim, on a domain that carries the brand name and under
            a logo that is the brand's own mark. That combination is what a
            social-engineering classifier is built to catch, and Safe Browsing
            duly caught it. The wording below is the one this file shipped with
            before commit 95978f8 replaced it.
          */}
          <p className="px-3 pt-3 text-[12px] leading-relaxed text-muted-foreground">
            Independent calendar built on public Polymarket data. Not affiliated
            with or endorsed by Polymarket. Built by gavelsv.
          </p>
        </section>
      ) : null}
    </div>
  );
}
