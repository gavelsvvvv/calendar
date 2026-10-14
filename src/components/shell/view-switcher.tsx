"use client";

import { CalendarDays, Columns3, List, type LucideIcon } from "lucide-react";
import * as React from "react";
import type { CalendarView } from "@/lib/url-state";
import { cn } from "@/lib/utils";

const VIEWS: ReadonlyArray<{ id: CalendarView; label: string; icon: LucideIcon }> = [
  { id: "month", label: "Month", icon: CalendarDays },
  { id: "week", label: "Week", icon: Columns3 },
  { id: "agenda", label: "Agenda", icon: List },
];

/**
 * Month / Week / Agenda. Purely a change of presentation — it reports the new
 * view and nothing else, so filters and the anchor date survive the switch.
 *
 * The selection is one element that slides between the three, rather than a
 * background that blinks on and off each tab. That means measuring: the labels
 * are hidden below `xl`, so the segments are not equal thirds and the indicator
 * cannot be positioned by index alone. It reads the live geometry and follows a
 * resize, which is also what keeps it correct when the breakpoint changes the
 * labels out from under it.
 */
export function ViewSwitcher({
  view,
  onChange,
  /** Segments share the available width instead of hugging their labels. */
  fill = false,
  /** Show labels at every width. The bar hides them below `xl` for room. */
  alwaysShowLabels = false,
  className,
}: {
  view: CalendarView;
  onChange: (view: CalendarView) => void;
  fill?: boolean;
  alwaysShowLabels?: boolean;
  className?: string;
}) {
  const refs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const listRef = React.useRef<HTMLDivElement>(null);
  const found = VIEWS.findIndex((v) => v.id === view);
  const activeIndex = found === -1 ? 0 : found;

  const [indicator, setIndicator] = React.useState<{ left: number; width: number } | null>(
    null,
  );

  React.useEffect(() => {
    const list = listRef.current;
    const active = refs.current[activeIndex];
    if (!list || !active) return;

    const measure = () => {
      const a = active.getBoundingClientRect();
      const l = list.getBoundingClientRect();
      setIndicator({ left: a.left - l.left, width: a.width });
    };
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(list);
    for (const el of refs.current) if (el) observer.observe(el);
    return () => observer.disconnect();
  }, [activeIndex]);

  const select = (index: number) => {
    const target = VIEWS[index];
    if (!target) return;
    refs.current[index]?.focus();
    if (target.id !== view) onChange(target.id);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    let next: number | null = null;
    if (event.key === "ArrowRight") next = (activeIndex + 1) % VIEWS.length;
    else if (event.key === "ArrowLeft") next = (activeIndex - 1 + VIEWS.length) % VIEWS.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = VIEWS.length - 1;
    if (next === null) return;
    event.preventDefault();
    select(next);
  };

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label="Calendar view"
      className={cn(
        "relative flex items-center rounded-lg border border-border bg-surface-sunken p-[3px]",
        fill ? "w-full" : "shrink-0",
        className,
      )}
    >
      {/* Hidden until measured, so it can never flash at the wrong width on
          first paint. `left`/`width` rather than a transform because the
          segments differ in size and a scaled pill would distort its corners. */}
      <span
        aria-hidden
        style={indicator ? { left: indicator.left, width: indicator.width } : undefined}
        className={cn(
          "pointer-events-none absolute inset-y-[3px] rounded-[6px] bg-surface shadow-sm ring-1 ring-border/70",
          "motion-safe:transition-[left,width] motion-safe:duration-(--dur-slow) motion-safe:ease-(--ease-out)",
          indicator ? "opacity-100" : "opacity-0",
        )}
      />

      {VIEWS.map((entry, index) => {
        const Icon = entry.icon;
        const isActive = entry.id === view;
        return (
          <button
            key={entry.id}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            role="tab"
            /* A stable handle for the browser suite and the navigation
               benchmark. Both switchers render tabs, so tests need to name a
               view rather than an index into whichever one is visible. */
            data-view-tab={entry.id}
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            onClick={() => select(index)}
            onKeyDown={onKeyDown}
            className={cn(
              "relative z-10 flex items-center justify-center gap-1.5 rounded-[6px] px-2.5 text-[13px] font-medium",
              "transition-colors motion-safe:duration-(--dur-base)",
              // 40px, not 36: this variant is the phone's only view control and
              // it has to be hittable without aiming.
              fill ? "h-10 flex-1" : "py-1",
              isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon
              className={cn(
                "size-3.5 transition-transform motion-safe:duration-(--dur-base) motion-safe:ease-(--ease-out)",
                isActive && "motion-safe:scale-110",
              )}
              aria-hidden
            />
            <span className={alwaysShowLabels ? "inline" : "hidden xl:inline"}>
              {entry.label}
            </span>
            {!alwaysShowLabels && <span className="sr-only xl:hidden">{entry.label}</span>}
          </button>
        );
      })}
    </div>
  );
}
