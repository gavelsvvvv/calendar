"use client";

import { ArtSvg, EventCard, RADIUS, STROKE } from "./shared";

/* Same margins and same card as step two, mirrored. */
const CARD = { x: 20, y: 40, w: 164, h: 152 };
const TILE = { x: 252, w: 92, h: 54 };
const TILES = [
  { y: 24, label: "Google", logo: "/logos/google-calendar.png" },
  { y: 89, label: "Apple", logo: "/logos/apple-calendar.png" },
  // The supplied asset is Outlook's own calendar icon, so the tile says
  // Outlook. It said "iCal" while wearing Microsoft's mark, which was
  // wrong before Outlook was supported and is wrong twice over now.
  { y: 154, label: "Outlook", logo: "/logos/outlook-calendar.png" },
] as const;

/** Where the connectors leave the calendar. */
const PORT = { x: CARD.x + CARD.w, y: CARD.y + CARD.h / 2 };

const LOGO = 24;

/*
 * The destinations wear their own marks.
 *
 * These are the only bitmaps in the three illustrations, and they earn it: a
 * traced approximation of somebody else's app icon is worse than no icon, and
 * these three are the whole reason the screen is legible without reading — you
 * recognise where your calendar lives before you read the word next to it.
 * Served from `public/logos` at 96px (≈3.7× the drawn size) rather than inlined,
 * so they cost nothing until this step renders.
 */

/**
 * One calendar, three places to keep it.
 *
 * The connectors run *outward* here — the mirror of step two, where everything
 * ran in. Same curve grammar, same stroke, opposite direction, which is the
 * whole story of the product in two frames: the world collects into a calendar,
 * the calendar goes wherever you already are.
 */
export function SubscribeLinksArt() {
  return (
    <ArtSvg label="The calendar syncing to Google Calendar, Apple Calendar and Outlook">
      {/* The calendar itself. */}
      <g className="art-a">
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
        {Array.from({ length: 4 }, (_, i) => (
          <rect
            key={i}
            x={CARD.x + 14 + i * 36}
            y={CARD.y + 12}
            width={18}
            height={3}
            rx={1.5}
            className="fill-muted-foreground"
            opacity="0.4"
          />
        ))}
      </g>

      <EventCard
        className="art-in-1"
        x={CARD.x + 14}
        y={CARD.y + 42}
        width={124}
        height={16}
        category="politics"
      />
      <EventCard
        className="art-in-2"
        x={CARD.x + 14}
        y={CARD.y + 68}
        width={136}
        height={16}
        category="sports"
      />
      <EventCard
        className="art-in-3"
        x={CARD.x + 14}
        y={CARD.y + 94}
        width={100}
        height={16}
        category="crypto"
      />
      <EventCard
        className="art-in-4"
        x={CARD.x + 14}
        y={CARD.y + 120}
        width={118}
        height={16}
        category="ai"
      />

      {/* Out to wherever you already keep your week. */}
      <g className="art-draw">
        {TILES.map((tile) => {
          const to = { x: TILE.x, y: tile.y + TILE.h / 2 };
          return (
            <path
              key={tile.label}
              d={`M${PORT.x} ${PORT.y} C ${PORT.x + 34} ${PORT.y}, ${to.x - 34} ${to.y}, ${to.x} ${to.y}`}
              pathLength={1}
              strokeDasharray={1}
              strokeWidth={STROKE}
              strokeLinecap="round"
              className="stroke-accent"
              opacity="0.5"
            />
          );
        })}
      </g>

      <g className="art-b">
        {TILES.map((tile) => (
          <g key={tile.label}>
            <rect
              x={TILE.x}
              y={tile.y}
              width={TILE.w}
              height={TILE.h}
              rx={RADIUS.tile}
              className="fill-surface stroke-border"
              strokeWidth={STROKE}
            />
            <image
              href={tile.logo}
              x={TILE.x + 13}
              y={tile.y + (TILE.h - LOGO) / 2}
              width={LOGO}
              height={LOGO}
              preserveAspectRatio="xMidYMid meet"
            />
            <text
              x={TILE.x + 13 + LOGO + 9}
              y={tile.y + TILE.h / 2 + 3.8}
              className="fill-foreground"
              fontSize="11"
              fontWeight="500"
              letterSpacing="-0.1"
            >
              {tile.label}
            </text>
          </g>
        ))}
      </g>

      {/* The dot on the port reads as "one source", drawn last so it sits over
          the three curves rather than between them. */}
      <g className="art-c">
        <circle cx={PORT.x} cy={PORT.y} r={4} className="fill-accent" />
        <circle cx={PORT.x} cy={PORT.y} r={8} className="fill-accent" opacity="0.16" />
      </g>
    </ArtSvg>
  );
}
