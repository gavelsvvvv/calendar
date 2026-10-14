"use client";

import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import { useTheme } from "next-themes";
import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/primitives";
import { useIsDesktop } from "@/hooks/use-media-query";

type ThemeChoice = "light" | "dark" | "system";

/** light → dark → system → light. */
const NEXT_CHOICE: Record<ThemeChoice, ThemeChoice> = {
  light: "dark",
  dark: "system",
  system: "light",
};

const ICON: Record<ThemeChoice, LucideIcon> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
};

function isThemeChoice(value: string | undefined): value is ThemeChoice {
  return value === "light" || value === "dark" || value === "system";
}

/**
 * Single button that cycles the colour scheme.
 *
 * The stored preference only exists in the browser, so the server has no idea
 * which icon is correct. Rather than guess and flip on hydration, the button
 * renders as an equally sized blank until mounted — the header never reflows and
 * React never sees a mismatch.
 */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const isDesktop = useIsDesktop();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    // The one deliberate exception to "don't setState in an effect": this is a
    // hydration flag, and running exactly once after mount is the whole point.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  if (!mounted) {
    return <span aria-hidden className="inline-block size-11 shrink-0 md:size-9" />;
  }

  const current: ThemeChoice = isThemeChoice(theme) ? theme : "system";
  const next = NEXT_CHOICE[current];
  const Icon = ICON[current];
  const label = `Switch to ${next} theme`;

  const button = (
    <Button
      variant="ghost"
      size="icon"
      aria-label={label}
      onClick={() => setTheme(next)}
      className="size-11 shrink-0 md:size-9"
    >
      <Icon aria-hidden />
    </Button>
  );

  // Touch devices get no hover, and the aria-label already carries the meaning.
  if (!isDesktop) return button;

  return (
    <TooltipProvider delayDuration={400}>
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
