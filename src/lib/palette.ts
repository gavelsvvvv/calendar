/**
 * The month grid's density palettes, as data.
 *
 * Shared by the header's colour picker (which writes the choice) and the inline
 * script in the document head (which restores it before first paint), so the
 * two can never disagree about what a valid palette is. The colours themselves
 * live in `globals.css`; this file only names them.
 */

export type PaletteId = "aurora" | "ocean" | "emerald" | "violet" | "graphite" | "ember";

/** What a reader gets before choosing anything. Has no CSS block of its own. */
export const DEFAULT_PALETTE: PaletteId = "violet";

/** Where the choice is kept. Per browser, like the light/dark preference. */
export const PALETTE_STORAGE_KEY = "calendar-palette";

export const PALETTES: ReadonlyArray<{
  id: PaletteId;
  label: string;
  description: string;
  /**
   * Four representative stops, low to extreme, for the swatch strip.
   *
   * Not the cell colours themselves: those sit at 0.9+ lightness by day and
   * 0.2–0.3 by night, and a 12px chip of either is indistinguishable from its
   * neighbour. These are the same hues at a saturation a swatch can show.
   */
  swatch: readonly [string, string, string, string];
}> = [
  {
    id: "violet",
    label: "Violet",
    description: "Indigo-violet, deepening. The default.",
    swatch: ["oklch(0.64 0.06 292)", "oklch(0.60 0.10 290)", "oklch(0.57 0.14 288)", "oklch(0.54 0.17 285)"],
  },
  {
    id: "aurora",
    label: "Aurora",
    description: "Teal to indigo, all on the cool side.",
    swatch: ["oklch(0.68 0.08 190)", "oklch(0.64 0.10 210)", "oklch(0.60 0.13 238)", "oklch(0.56 0.15 270)"],
  },
  {
    id: "ocean",
    label: "Ocean",
    description: "One blue, deepening. Matches the accent.",
    swatch: ["oklch(0.66 0.05 250)", "oklch(0.62 0.09 250)", "oklch(0.58 0.13 252)", "oklch(0.54 0.17 254)"],
  },
  {
    id: "emerald",
    label: "Emerald",
    description: "Green-teal, like an activity graph.",
    swatch: ["oklch(0.70 0.06 165)", "oklch(0.66 0.10 163)", "oklch(0.62 0.13 160)", "oklch(0.58 0.15 158)"],
  },
  {
    id: "graphite",
    label: "Graphite",
    description: "Grey, turning blue only on the busiest days.",
    swatch: ["oklch(0.62 0.005 260)", "oklch(0.57 0.01 260)", "oklch(0.56 0.05 256)", "oklch(0.56 0.15 254)"],
  },
  {
    id: "ember",
    label: "Ember",
    description: "The original warm ramp — violet to coral.",
    swatch: ["oklch(0.62 0.08 300)", "oklch(0.62 0.10 340)", "oklch(0.64 0.13 45)", "oklch(0.66 0.15 38)"],
  },
];

export function isPaletteId(value: unknown): value is PaletteId {
  return typeof value === "string" && PALETTES.some((p) => p.id === value);
}

/**
 * Put a palette on the page. The default is the *absence* of the attribute,
 * so a stored "aurora" and no stored value render identically.
 */
export function applyPalette(id: PaletteId): void {
  const root = document.documentElement;
  if (id === DEFAULT_PALETTE) root.removeAttribute("data-palette");
  else root.setAttribute("data-palette", id);
}

/**
 * The head script, as a string. Runs before first paint and before React, so
 * it must be self-contained: no imports, and every failure swallowed — blocked
 * storage must cost a returning reader their colours, never the page.
 *
 * The stored value is checked against the real list before it reaches the
 * DOM. It only ever becomes an attribute value, so nothing could execute
 * either way, but an unknown palette would otherwise sit on <html> selecting
 * nothing and quietly look like the default.
 */
export function paletteBootScript(): string {
  const allowed = PALETTES.map((p) => p.id).filter((id) => id !== DEFAULT_PALETTE);
  return `try{var p=localStorage.getItem(${JSON.stringify(PALETTE_STORAGE_KEY)});if(${JSON.stringify(allowed)}.indexOf(p)>-1)document.documentElement.setAttribute("data-palette",p)}catch(e){}`;
}
