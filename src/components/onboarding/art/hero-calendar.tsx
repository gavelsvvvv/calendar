"use client";

import {
  ArtSvg,
  EventCard,
  PolymarketMark,
  RADIUS,
  SHOWCASE,
  STROKE,
} from "./shared";
import { markWidth } from "@/lib/polymarket-mark";

/** Content column, shared by the header, the weekday strip and the cards. */
const LEFT = 48;
const RIGHT = 312;
const COL = (RIGHT - LEFT - 16) / 2; // two columns with a 16px gutter

/** The mark's height inside the tile, and in the finished card's header. */
const MARK_HERO = 46;
const MARK_HEADER = 15;

/**
 * The hero: a mark that becomes the calendar.
 *
 * The whole point is that it is one object throughout. A rounded 104px tile —
 * an app icon — widens and flattens into the 304px calendar card, and it does
 * so by interpolating the rect's own geometry rather than by fading one shape
 * out under another. The wordmark beneath it doesn't disappear so much as get
 * out of the way, handing off to the line that settles into the card's header.
 * Then the week arrives, then the events.
 *
 * The mark is Polymarket's own, traced from the supplied asset — see
 * `PolymarketMark`. It appears twice and at two sizes, which is the point of
 * the sequence: the thing that was the app icon is still there, smaller, once
 * the calendar has opened around it.
 */
export function HeroCalendarArt() {
  return (
    <ArtSvg label="The Polymarket Calendar mark opening into a calendar of upcoming events">
      {/* The one shape that morphs. Its attributes are the *calendar*: that is
          the resting state, and therefore what a reduced-motion viewer sees. */}
      <rect
        className="art-frame fill-surface stroke-border-strong"
        x={28}
        y={18}
        width={304}
        height={196}
        rx={RADIUS.frame}
        strokeWidth={STROKE}
      />

      {/* The lockup, while the tile is still a tile: mark centred in the 104px
          tile, name beneath it. */}
      <g className="art-mark">
        <PolymarketMark x={180 - markWidth(MARK_HERO) / 2} y={116 - MARK_HERO / 2} size={MARK_HERO} />
        <text
          x={180}
          y={200}
          textAnchor="middle"
          className="fill-foreground"
          fontSize="18"
          fontWeight="600"
          letterSpacing="-0.45"
        >
          Polymarket Calendar
        </text>
      </g>

      {/* The card's own chrome: the same mark and name, now a header. */}
      <g className="art-c">
        <PolymarketMark x={46} y={36 - MARK_HEADER / 2} size={MARK_HEADER} />
        <text
          x={46 + markWidth(MARK_HEADER) + 9}
          y={40.5}
          className="fill-foreground"
          fontSize="11"
          fontWeight="600"
          letterSpacing="-0.15"
        >
          Polymarket Calendar
        </text>
        <path
          d={`M28 54 H332`}
          className="stroke-border"
          strokeWidth={STROKE}
        />
        {Array.from({ length: 7 }, (_, i) => (
          <rect
            key={i}
            x={LEFT + i * 40.6}
            y={64}
            width={20}
            height={3}
            rx={1.5}
            className="fill-muted-foreground"
            opacity="0.4"
          />
        ))}
      </g>

      {/* Five events, five categories, in the calendar's own colours. */}
      <EventCard
        className="art-in-1"
        x={LEFT}
        y={88}
        width={COL}
        category={SHOWCASE[0].id}
        label={SHOWCASE[0].label}
      />
      <EventCard
        className="art-in-2"
        x={LEFT + COL + 16}
        y={88}
        width={COL}
        category={SHOWCASE[1].id}
        label={SHOWCASE[1].label}
      />
      <EventCard
        className="art-in-3"
        x={LEFT}
        y={126}
        width={COL}
        category={SHOWCASE[2].id}
        label={SHOWCASE[2].label}
      />
      <EventCard
        className="art-in-4"
        x={LEFT + COL + 16}
        y={126}
        width={COL}
        category={SHOWCASE[3].id}
        label={SHOWCASE[3].label}
      />
      <EventCard
        className="art-in-5"
        x={LEFT}
        y={164}
        width={RIGHT - LEFT}
        category={SHOWCASE[4].id}
        label={SHOWCASE[4].label}
      />
    </ArtSvg>
  );
}
