"use client";

import { ArtSvg, categoryColor, EventCard, RADIUS, SHOWCASE, STROKE } from "./shared";

/**
 * The loose feed, stacked down the left.
 *
 * A column, not a grid. The first version put the chips in two rows and every
 * curve from the top row had to cross the bottom row to reach the calendar,
 * which turned the one idea the picture exists to carry — these flow into that
 * — into a tangle. One column and one sink means five curves that never touch.
 */
const CHIP_H = 26;
const CHIPS = [
  { i: 0, y: 27, w: 76 },
  { i: 1, y: 65, w: 66 },
  { i: 2, y: 103, w: 66 },
  { i: 3, y: 141, w: 44 },
  { i: 4, y: 179, w: 68 },
] as const;

const CHIP_X = 16;
const CARD = { x: 196, y: 40, w: 148, h: 152 };
const SINK = { x: CARD.x, y: CARD.y + CARD.h / 2 };

export function CategoriesMergeArt() {
  return (
    <ArtSvg label="Politics, sports, crypto, AI and culture flowing into one calendar">
      <g className="art-a">
        {CHIPS.map((chip) => {
          const category = SHOWCASE[chip.i];
          return (
            <g key={category.id} className={categoryColor(category.id)}>
              <rect
                x={CHIP_X}
                y={chip.y}
                width={chip.w}
                height={CHIP_H}
                rx={9}
                fill="currentColor"
                opacity="0.12"
              />
              <rect
                x={CHIP_X}
                y={chip.y}
                width={chip.w}
                height={CHIP_H}
                rx={9}
                stroke="currentColor"
                strokeWidth={STROKE}
                opacity="0.32"
              />
              <circle cx={CHIP_X + 11} cy={chip.y + CHIP_H / 2} r="3" fill="currentColor" />
              <text
                x={CHIP_X + 21}
                y={chip.y + CHIP_H / 2 + 3.6}
                fill="currentColor"
                fontSize="10.5"
                fontWeight="500"
                letterSpacing="-0.1"
              >
                {category.label}
              </text>
            </g>
          );
        })}
      </g>

      {/* The calendar that collects them. */}
      <g className="art-b">
        <rect
          x={CARD.x}
          y={CARD.y}
          width={CARD.w}
          height={CARD.h}
          rx={RADIUS.frame}
          className="fill-surface stroke-border-strong"
          strokeWidth={STROKE}
        />
        <path
          d={`M${CARD.x} ${CARD.y + 28} H${CARD.x + CARD.w}`}
          className="stroke-border"
          strokeWidth={STROKE}
        />
        {/* A word, not four grey ticks. The ticks stood for weekday headers and
            read as placeholder furniture; "TODAY" says what the card is showing
            and gives the picture a second thing a reader can actually read. */}
        <text
          x={CARD.x + 14}
          y={CARD.y + 18}
          className="fill-muted-foreground"
          fontSize="10"
          fontWeight="600"
          letterSpacing="1.1"
        >
          TODAY
        </text>
      </g>

      {/* Drawn after the card so a curve's end tucks under its edge rather than
          stopping short of it. */}
      <g className="art-draw">
        {CHIPS.map((chip) => {
          const from = { x: CHIP_X + chip.w, y: chip.y + CHIP_H / 2 };
          const category = SHOWCASE[chip.i];
          return (
            <path
              key={category.id}
              d={`M${from.x} ${from.y} C ${from.x + 34} ${from.y}, ${SINK.x - 34} ${SINK.y}, ${SINK.x} ${SINK.y}`}
              pathLength={1}
              strokeDasharray={1}
              strokeWidth={STROKE}
              strokeLinecap="round"
              className={`${categoryColor(category.id)} stroke-current`}
              opacity="0.5"
            />
          );
        })}
      </g>

      <EventCard
        className="art-in-1"
        x={CARD.x + 14}
        y={CARD.y + 42}
        width={110}
        height={16}
        category="politics"
      />
      <EventCard
        className="art-in-2"
        x={CARD.x + 14}
        y={CARD.y + 68}
        width={120}
        height={16}
        category="sports"
      />
      <EventCard
        className="art-in-3"
        x={CARD.x + 14}
        y={CARD.y + 94}
        width={92}
        height={16}
        category="crypto"
      />
      <EventCard
        className="art-in-4"
        x={CARD.x + 14}
        y={CARD.y + 120}
        width={106}
        height={16}
        category="culture"
      />
    </ArtSvg>
  );
}
