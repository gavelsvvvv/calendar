"use client";

import {
  CalendarPlus,
  Flame,
  HelpCircle,
  Monitor,
  MoreHorizontal,
  Moon,
  Sun,
  type LucideIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import * as React from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

export type OverflowMenuProps = {
  onOpenTrending: () => void;
  onOpenSubscribe: () => void;
  onOpenHelp: () => void;
};

type ThemeChoice = "light" | "dark" | "system";

const THEMES: ReadonlyArray<{ value: ThemeChoice; label: string; icon: LucideIcon }> = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

function Item({
  icon: Icon,
  label,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-[14px] text-foreground transition-colors motion-safe:duration-(--dur-quick) active:bg-surface-hover md:hover:bg-surface-hover"
    >
      <Icon className="size-[18px] shrink-0 text-muted-foreground" aria-hidden />
      {label}
    </button>
  );
}

/**
 * The "everything else" menu.
 *
 * A title bar can hold about four controls at 375px before the title it exists
 * to display starts truncating — and at 150% browser zoom a 1920px screen is a
 * 1280px viewport, so this is not only a phone problem. Trending, subscribing,
 * help and the theme are all real but none of them is a *navigation* control,
 * so below `lg` they collapse in here and the bar keeps its title. Above `lg`
 * each one gets its own button again.
 *
 * The theme is a three-way segmented row rather than the bar's cycle button:
 * inside a menu there is room to show all three states, and a menu row that
 * silently advances a cycle you cannot see is a guessing game.
 */
export function OverflowMenu({
  onOpenTrending,
  onOpenSubscribe,
  onOpenHelp,
}: OverflowMenuProps) {
  const [open, setOpen] = React.useState(false);
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    // Hydration flag: the stored theme exists only in the browser, so the
    // server cannot know which of the three is selected.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  const run = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="More options"
          className={cn(
            "flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground",
            "transition-colors motion-safe:duration-(--dur-quick) active:bg-surface-hover active:text-foreground",
            open && "bg-surface-sunken text-foreground",
          )}
        >
          <MoreHorizontal className="size-5" aria-hidden />
        </button>
      </PopoverTrigger>

      <PopoverContent align="end" sideOffset={8} className="w-[248px] p-1.5">
        <Item icon={Flame} label="Trending this week" onClick={run(onOpenTrending)} />
        <Item icon={CalendarPlus} label="Subscribe to this calendar" onClick={run(onOpenSubscribe)} />
        <Item icon={HelpCircle} label="How it works" onClick={run(onOpenHelp)} />

        <div className="mt-1.5 border-t border-border pt-1.5">
          <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Appearance
          </p>
          <div
            role="radiogroup"
            aria-label="Colour theme"
            className="flex items-center gap-1 rounded-lg bg-surface-sunken p-1"
          >
            {THEMES.map((choice) => {
              const active = mounted && (theme ?? "system") === choice.value;
              const Icon = choice.icon;
              return (
                <button
                  key={choice.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setTheme(choice.value)}
                  className={cn(
                    "flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md text-[12px] font-medium",
                    "transition-colors motion-safe:duration-(--dur-quick)",
                    active
                      ? "bg-surface text-foreground shadow-sm ring-1 ring-border/70"
                      : "text-muted-foreground",
                  )}
                >
                  <Icon className="size-3.5" aria-hidden />
                  {choice.label}
                </button>
              );
            })}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
