"use client";

import Image from "next/image";
import * as React from "react";
import {
  ESPORTS,
  SPORTS,
  type EsportId,
  type SportId,
} from "@/lib/sports/taxonomy";
import { cn } from "@/lib/utils";

/**
 * The marks the Sport / eSport picker is drawn with.
 *
 * ## Supplied artwork, normalised
 *
 * These replace a set of nineteen hand-drawn glyphs. The glyphs existed because
 * there was no artwork and the league and studio marks are trademarks nobody
 * had cleared; the artwork has since been supplied, which settles both halves —
 * so the picker now shows the thing a reader actually recognises, and CS2 looks
 * like CS2 rather than like a reticle standing in for it.
 *
 * Nothing here is fetched at runtime. `scripts/make-sport-logos.mjs` turns
 * `assets/{sport,esport}-logos/<id>.<ext>` into `public/logos/sports/<id>.webp`
 * at a uniform 96², which is where the consistency comes from: the supplied set
 * spanned four formats, 281px to 3840px wide, square balls beside a 608×328
 * wordmark, and three different kinds of background. The script squares each
 * mark around its own ink and keys out baked-on white, so a wordmark and a ball
 * end up with the same visual mass instead of one being scaled to nothing.
 *
 * ## Why every mark sits on a white chip
 *
 * Because a raster cannot change colour with the theme, and the supplied set
 * splits both ways. Four marks — Soccer, Hockey, the boxing glove and Call of
 * Duty — are a pure black silhouette, invisible on the dark theme's panel. One,
 * Rainbow Six, arrived as a white negative, invisible on the light one. Drawn
 * straight onto the panel, some subset of the grid disappears in either theme.
 *
 * A chip fixes all of it with one rule rather than five exceptions: every mark
 * gets the light ground it was designed for, in both themes. It also squares
 * the ragged ones — a chip is the same object whether it holds a round ball or
 * a wide wordmark — which is most of why the grid reads as a shelf. (Rainbow
 * Six is the one asset the pipeline flips, for the same reason; see `INVERT`
 * there.)
 */

/**
 * `<id>` → the built asset, stated rather than derived.
 *
 * `/logos/sports/${id}.webp` would compute the same strings and would fail
 * silently: a sport added to the taxonomy without artwork would render a broken
 * image in production. Exhaustive `Record`s over the two id unions make that a
 * type error at the point the sport is added.
 */
const SPORT_LOGOS: Record<SportId, string> = {
  tennis: "/logos/sports/tennis.webp",
  "american-football": "/logos/sports/american-football.webp",
  basketball: "/logos/sports/basketball.webp",
  soccer: "/logos/sports/soccer.webp",
  baseball: "/logos/sports/baseball.webp",
  hockey: "/logos/sports/hockey.webp",
  golf: "/logos/sports/golf.webp",
  combat: "/logos/sports/combat.webp",
  motorsport: "/logos/sports/motorsport.webp",
  cricket: "/logos/sports/cricket.webp",
};

const ESPORT_LOGOS: Record<EsportId, string> = {
  cs2: "/logos/sports/cs2.webp",
  dota2: "/logos/sports/dota2.webp",
  lol: "/logos/sports/lol.webp",
  valorant: "/logos/sports/valorant.webp",
  "rainbow-six": "/logos/sports/rainbow-six.webp",
  "call-of-duty": "/logos/sports/call-of-duty.webp",
  overwatch: "/logos/sports/overwatch.webp",
  "rocket-league": "/logos/sports/rocket-league.webp",
  starcraft: "/logos/sports/starcraft.webp",
};

/**
 * What the tile says, per option.
 *
 * `pick` is the *product* name and it is deliberately not the taxonomy's: "NFL"
 * rather than "American Football", because the reader is choosing what lands in
 * their calendar and NFL is the thing they mean. The taxonomy stays honest
 * underneath — `american-football` still absorbs NCAAF, and `label` still says
 * "American Football", which is what the tooltip and the accessible name carry.
 */
const SPORT_PICKS: Record<SportId, string> = {
  tennis: "Tennis",
  "american-football": "NFL",
  basketball: "NBA",
  soccer: "Soccer",
  baseball: "MLB",
  hockey: "NHL",
  golf: "Golf",
  combat: "MMA",
  motorsport: "F1",
  cricket: "Cricket",
};

const ESPORT_PICKS: Record<EsportId, string> = {
  cs2: "CS2",
  dota2: "Dota 2",
  lol: "LoL",
  valorant: "Valorant",
  "rainbow-six": "Rainbow Six",
  "call-of-duty": "Call of Duty",
  overwatch: "Overwatch",
  "rocket-league": "Rocket League",
  starcraft: "StarCraft",
};

export type PickerOption = {
  id: string;
  /**
   * The product name — on the tile, and in the sidebar's summary line.
   *
   * Not the taxonomy's `short`, which this deliberately does not carry. `short`
   * exists so a *feed name* can say "NFL"; here the same string is a label
   * someone reads and clicks, and keeping one field means the two can never
   * drift into meaning different things by accident.
   */
  pick: string;
  /** The taxonomy name, for the tooltip and the accessible name. */
  label: string;
  /** The built 96² mark under `public/`. */
  logo: string;
};

/*
 * Built from the taxonomy rather than restated, so the picker cannot drift out
 * of order with it — and, because the tables above are exhaustive `Record`s
 * over the id unions, a sport added without artwork or without a product name
 * is a type error rather than a blank tile discovered in production.
 */
export const SPORT_OPTIONS: readonly PickerOption[] = SPORTS.map((sport) => ({
  id: sport.id,
  label: sport.label,
  pick: SPORT_PICKS[sport.id],
  logo: SPORT_LOGOS[sport.id],
}));

export const ESPORT_OPTIONS: readonly PickerOption[] = ESPORTS.map((game) => ({
  id: game.id,
  label: game.label,
  pick: ESPORT_PICKS[game.id],
  logo: ESPORT_LOGOS[game.id],
}));

/** One mark on its chip, sized by the caller. */
export function OptionIcon({
  option,
  className,
}: {
  option: PickerOption;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-md bg-white",
        // A hairline, so the chip is the same object in both themes rather than
        // an invisible one on the light panel and a bright square on the dark.
        "ring-1 ring-black/[0.08]",
        /*
         * And a shadow under it, which only matters on glass.
         *
         * The chip is the one opaque thing on the picker's translucent panel —
         * it has to be, because four of the nineteen marks are pure black
         * silhouettes that need a light ground in both themes. An opaque square
         * with nothing but a hairline, sitting on a surface you can see through,
         * reads as a hole punched in it; a hole is exactly the thing that casts
         * no shadow, so giving it one is what puts the chip back on top. On the
         * opaque surfaces elsewhere it is a hairline of depth and nothing more.
         */
        "shadow-[0_1px_2px_-1px_var(--glass-chip-cast)]",
        className,
      )}
    >
      <Image
        src={option.logo}
        // Decorative: the tile's own `aria-label` already names the sport, and
        // a second reading of "NFL" between the label and the count is noise.
        alt=""
        width={96}
        height={96}
        /*
         * Already 96² WebP and drawn at 22px, so the optimizer has nothing to
         * do but re-encode it — the imageSizes ladder in `next.config.ts` is
         * there for Polymarket's remote market icons, not for these.
         */
        unoptimized
        className="size-full object-contain"
      />
    </span>
  );
}
