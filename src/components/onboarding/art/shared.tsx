"use client";

import * as React from "react";
import { getCategoryMeta } from "@/lib/categories";
import type { CalendarCategory } from "@/lib/curation/types";
import { MARK_BOX, MARK_PATH, MARK_STROKE } from "@/lib/polymarket-mark";
import { cn } from "@/lib/utils";

/**
 * One canvas, one grammar.
 *
 * All three onboarding illustrations are drawn on the same 360×232 viewBox with
 * the same stroke width, the same three corner radii and the same motion beats
 * (see `.art-*` in globals.css). That is what makes them read as one set rather
 * than three drawings that happen to share a dialog.
 *
 * Colour is not invented here either: every category swatch comes from
 * `lib/categories`, the same table the calendar itself uses, through a `text-*`
 * class on a wrapping group and `currentColor` beneath it. Pick a colour by
 * hand and the illustration starts lying about what the product looks like.
 */

export const ART_VIEWBOX = "0 0 360 232";

/** Stroke weight for every line in every illustration. */
export const STROKE = 1.5;

/** Corner radii: cards, tiles, the main frame. */
export const RADIUS = { card: 8, tile: 14, frame: 18 } as const;

/**
 * The five categories the illustrations speak in.
 *
 * Chosen to span the calendar rather than to be the five biggest: politics and
 * sports because they are the poles most people arrive with, crypto because it
 * is what Polymarket is known for, AI and culture because they are the proof
 * that this is not only a politics site.
 */
export const SHOWCASE: ReadonlyArray<{ id: CalendarCategory; label: string }> = [
  { id: "politics", label: "Politics" },
  { id: "sports", label: "Sports" },
  { id: "crypto", label: "Crypto" },
  { id: "ai", label: "AI" },
  { id: "culture", label: "Culture" },
];

/** The `text-*` class that carries a category's colour into `currentColor`. */
export function categoryColor(id: CalendarCategory): string {
  return getCategoryMeta(id).text;
}

export function ArtSvg({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <svg
      viewBox={ART_VIEWBOX}
      role="img"
      aria-label={label}
      fill="none"
      // `meet` rather than a fixed size: the panel is shorter on a phone and the
      // drawing should letterbox rather than crop or stretch.
      preserveAspectRatio="xMidYMid meet"
      className="h-full w-full"
    >
      {/*
        The loop's fade lives on this group, so the moment where the geometry
        snaps back to its first frame happens at zero opacity. Without it the
        restart is a visible cut, which is exactly the kind of thing that makes
        a looping animation feel cheap.
      */}
      <g className="art-loop">{children}</g>
    </svg>
  );
}

/*
 * The Polymarket mark.
 *
 * Traced from the supplied 512px asset rather than embedded as a bitmap: it is
 * a straight-edged figure, so a path costs a few hundred bytes, stays crisp at
 * any size, takes its colour from `currentColor` in both themes — the asset
 * ships as separate black and white files precisely because a bitmap cannot —
 * and, most of the way that matters here, it lives inside an SVG that morphs.
 *
 * The trace was fitted numerically rather than by eye: the vertices and stroke
 * width below are the argmax of intersection-over-union against the original's
 * ink mask, at 0.93. Below ~0.90 the difference is visible at hero size.
 */

/**
 * Draws the mark with its *ink* — not its canvas — filling a box `size` tall at
 * (x, y). Sizing on the raw viewBox would leave uneven optical margins, because
 * the asset is not centred in its own 512 square.
 */
export function PolymarketMark({
  x,
  y,
  size,
  className,
}: {
  x: number;
  y: number;
  size: number;
  className?: string;
}) {
  const s = size / MARK_BOX.h;
  return (
    <g transform={`translate(${x - MARK_BOX.x * s}, ${y - MARK_BOX.y * s}) scale(${s})`}>
      <path
        d={MARK_PATH}
        fill="none"
        stroke="currentColor"
        strokeWidth={MARK_STROKE}
        strokeLinejoin="round"
        strokeLinecap="round"
        className={className ?? "text-foreground"}
      />
    </g>
  );
}

/** Width the mark occupies for a given height. */


/**
 * An event, the way the calendar draws one: a colour cap, a label, a tinted
 * surface. Same object in all three illustrations.
 */
export function EventCard({
  x,
  y,
  width,
  height = 28,
  category,
  label,
  className,
}: {
  x: number;
  y: number;
  width: number;
  height?: number;
  category: CalendarCategory;
  label?: string;
  className?: string;
}) {
  return (
    <g className={cn(categoryColor(category), className)}>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={RADIUS.card}
        fill="currentColor"
        opacity="0.11"
      />
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={RADIUS.card}
        stroke="currentColor"
        strokeWidth={STROKE}
        opacity="0.28"
      />
      <rect
        x={x + 10}
        y={y + (height - 12) / 2}
        width="3"
        height="12"
        rx="1.5"
        fill="currentColor"
      />
      {label && (
        <text
          x={x + 21}
          y={y + height / 2 + 3.8}
          fill="currentColor"
          fontSize="11"
          fontWeight="500"
          letterSpacing="-0.1"
        >
          {label}
        </text>
      )}
    </g>
  );
}
