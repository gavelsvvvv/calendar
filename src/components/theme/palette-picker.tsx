"use client";

import { Check, Palette } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/primitives";
import {
  DEFAULT_PALETTE,
  PALETTE_STORAGE_KEY,
  PALETTES,
  applyPalette,
  isPaletteId,
  type PaletteId,
} from "@/lib/palette";
import { cn } from "@/lib/utils";

/**
 * The calendar's colour picker, beside the light/dark toggle.
 *
 * Choosing applies at once and the popover stays open, so a reader can click
 * down the list and watch the month grid change behind it — the whole point is
 * to compare on the real calendar rather than on swatches. The choice is kept
 * per browser, like the theme, and restored before first paint by the script
 * `paletteBootScript` puts in the document head.
 *
 * Only the density tints change. Category colours, the accent and Today are
 * left alone: they carry meaning, and a palette is a matter of taste.
 */
export function PalettePicker() {
  const [current, setCurrent] = React.useState<PaletteId>(DEFAULT_PALETTE);

  // The head script has already painted the stored palette; this only teaches
  // the picker which row to tick. Read after mount, so server and client agree
  // on the first render.
  React.useEffect(() => {
    try {
      const stored = window.localStorage.getItem(PALETTE_STORAGE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (isPaletteId(stored)) setCurrent(stored);
    } catch {
      /* storage blocked — the default is what is showing anyway */
    }
  }, []);

  const choose = (id: PaletteId) => {
    setCurrent(id);
    applyPalette(id);
    try {
      if (id === DEFAULT_PALETTE) window.localStorage.removeItem(PALETTE_STORAGE_KEY);
      else window.localStorage.setItem(PALETTE_STORAGE_KEY, id);
    } catch {
      /* applied for this visit, just not remembered */
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Calendar colours"
          data-palette-picker
          className="size-11 shrink-0 md:size-9"
        >
          <Palette aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="w-72 p-1.5">
        <div className="px-2 pb-1.5 pt-1">
          <p className="text-[13px] font-medium text-foreground">Calendar colours</p>
          <p className="text-[11px] text-muted-foreground">
            How busy days are shaded on the month grid.
          </p>
        </div>
        <ul role="radiogroup" aria-label="Density palette" className="flex flex-col gap-0.5">
          {PALETTES.map((palette) => {
            const selected = current === palette.id;
            return (
              <li key={palette.id}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  data-palette-option={palette.id}
                  onClick={() => choose(palette.id)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left",
                    "transition-colors motion-safe:duration-(--dur-quick)",
                    selected ? "bg-accent-soft/40" : "hover:bg-surface-hover",
                  )}
                >
                  <span
                    aria-hidden
                    className="flex shrink-0 overflow-hidden rounded-[3px] ring-1 ring-border"
                  >
                    {palette.swatch.map((color) => (
                      <span key={color} className="h-5 w-3.5" style={{ background: color }} />
                    ))}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-[12.5px] font-medium text-foreground">
                      {palette.label}
                    </span>
                    <span className="truncate text-[11px] text-muted-foreground">
                      {palette.description}
                    </span>
                  </span>
                  <Check
                    aria-hidden
                    className={cn(
                      "size-3.5 shrink-0 text-accent",
                      selected ? "opacity-100" : "opacity-0",
                    )}
                  />
                </button>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
