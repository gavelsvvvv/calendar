/**
 * How the calendar explains its own emphasis.
 *
 * Importance here is a *discovery* signal, not a claim about the world. It is a
 * composite score — volume, liquidity, how many markets an event carries,
 * whether Polymarket featured it, how close it is — ranked within whatever
 * range is loaded, with the top slice called Major and the next Important. An
 * event is Major because it is near the top of this list, which is a fact about
 * the list.
 *
 * So the label never travels alone. It is shown beside the number that mostly
 * earned it, and the details panel says in words that it is an editorial cue.
 * The raw score is never rendered anywhere: it is an arbitrary magnitude on an
 * arbitrary scale, and printing "score 812" invites a reader to compare it with
 * something.
 *
 * "Standard" is never labelled at all. Most of the calendar is standard, and a
 * badge on every row is a badge on nothing.
 */
import { formatCompactUsd } from "./format";
import type { CuratedCalendarEvent } from "./curation/types";

export type Emphasis = {
  /** "Major" or "Important" — already capitalised for display. */
  label: string;
  /** The strongest fact behind the label, e.g. "$18.4M volume". */
  note: string;
  /** One sentence for the details panel. */
  explanation: string;
};

export function emphasisOf(event: CuratedCalendarEvent): Emphasis | null {
  if (event.importanceLevel === "standard") return null;

  const label = event.importanceLevel === "major" ? "Major" : "Important";
  const volume = formatCompactUsd(event.volume);

  /*
   * Which fact to show. Volume is the headline for almost everything, but a
   * deep book is the more honest reason when an event is carrying a lot of
   * markets — a twelve-candidate election is prominent because there is a lot
   * to trade on it, not because any one leg is large.
   */
  const note =
    event.relatedMarketsCount >= 8
      ? `${volume} across ${event.relatedMarketsCount} markets`
      : `${volume} volume`;

  const explanation =
    event.importanceLevel === "major"
      ? `Highlighted for discovery: one of the highest-volume events on the calendar right now, at ${volume}.`
      : `Given some emphasis: above-average trading interest for this range, at ${volume}.`;

  return { label, note, explanation };
}
