"use client";

import { addMonths, format, isSameMonth, startOfMonth } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import * as React from "react";
import { chunkIntoWeeks, getMonthGridDays, WEEKDAY_LABELS_SHORT } from "@/lib/calendar";
import { useTodayKey } from "@/hooks/use-now";
import { toDateKey } from "@/lib/dates";
import { cn } from "@/lib/utils";

export type MiniCalendarProps = {
  anchor: Date;
  selectedDate: string | null;
  onSelectDay: (dayKey: string) => void;
  onNavigateMonth: (date: Date) => void;
  daysWithEvents?: ReadonlySet<string>;
  /** Finger-sized cells for the drawer. A 28px date is a miss on a phone. */
  touch?: boolean;
};

/** The sidebar's compact month, for jumping around without leaving the view. */
export function MiniCalendar({
  anchor,
  selectedDate,
  onSelectDay,
  onNavigateMonth,
  daysWithEvents,
  touch = false,
}: MiniCalendarProps) {
  const weeks = React.useMemo(
    () => chunkIntoWeeks(getMonthGridDays(anchor)),
    [anchor],
  );
  const today = useTodayKey();

  return (
    <div className={touch ? undefined : "px-1"}>
      <div className={cn("flex items-center justify-between", touch ? "mb-2" : "mb-1")}>
        <span
          className={cn(
            "px-1 font-medium text-foreground",
            touch ? "text-[15px]" : "text-[13px]",
          )}
        >
          {format(anchor, "MMMM yyyy")}
        </span>
        <div className="flex items-center">
          <button
            type="button"
            aria-label="Previous month"
            onClick={() => onNavigateMonth(startOfMonth(addMonths(anchor, -1)))}
            className={cn(
              "flex items-center justify-center rounded-lg text-muted-foreground transition-colors motion-safe:duration-(--dur-quick) hover:bg-surface-hover hover:text-foreground active:bg-surface-hover",
              touch ? "size-11" : "size-6",
            )}
          >
            <ChevronLeft className={touch ? "size-5" : "size-4"} aria-hidden />
          </button>
          <button
            type="button"
            aria-label="Next month"
            onClick={() => onNavigateMonth(startOfMonth(addMonths(anchor, 1)))}
            className={cn(
              "flex items-center justify-center rounded-lg text-muted-foreground transition-colors motion-safe:duration-(--dur-quick) hover:bg-surface-hover hover:text-foreground active:bg-surface-hover",
              touch ? "size-11" : "size-6",
            )}
          >
            <ChevronRight className={touch ? "size-5" : "size-4"} aria-hidden />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7">
        {WEEKDAY_LABELS_SHORT.map((label, i) => (
          <div
            key={i}
            aria-hidden
            className={cn(
              "flex items-center justify-center font-medium text-subtle-foreground",
              touch ? "h-7 text-[11px]" : "h-6 text-[10px]",
            )}
          >
            {label}
          </div>
        ))}
      </div>

      {weeks.map((week, weekIndex) => (
        <div key={weekIndex} className="grid grid-cols-7">
          {week.map((date) => {
            const key = toDateKey(date);
            const isToday = key === today;
            const isSelected = key === selectedDate;
            const inMonth = isSameMonth(date, anchor);
            const hasEvents = daysWithEvents?.has(key) ?? false;

            return (
              <button
                key={key}
                type="button"
                onClick={() => onSelectDay(key)}
                aria-current={isToday ? "date" : isSelected ? "true" : undefined}
                aria-label={`${format(date, "d MMMM yyyy")}${hasEvents ? ", has events" : ""}`}
                className={cn(
                  "relative flex items-center justify-center",
                  touch ? "h-11" : "h-7",
                )}
              >
                <span
                  className={cn(
                    "flex items-center justify-center rounded-full tabular-nums transition-colors motion-safe:duration-(--dur-quick)",
                    touch ? "size-9 text-[14px]" : "size-7 text-[11px]",
                    isToday && "bg-accent font-semibold text-accent-foreground",
                    !isToday && isSelected && "bg-accent-soft font-medium text-foreground",
                    !isToday && !isSelected && inMonth && "text-foreground hover:bg-surface-hover",
                    !isToday && !isSelected && !inMonth && "text-subtle-foreground hover:bg-surface-hover",
                  )}
                >
                  {format(date, "d")}
                </span>
                {hasEvents && !isToday && (
                  <span
                    className={cn(
                      "absolute size-[3px] rounded-full bg-accent",
                      touch ? "bottom-1" : "bottom-0",
                    )}
                    aria-hidden
                  />
                )}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
