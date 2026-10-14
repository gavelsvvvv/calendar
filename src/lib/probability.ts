/**
 * What does this percentage actually mean?
 *
 * "US Presidential Election — 58%" is not a fact about anything. The event has
 * a dozen candidates; 58% belongs to one of them, and printing it alone invites
 * the reader to attach it to the title. Every number the calendar shows has to
 * carry the outcome it belongs to, or not be shown.
 *
 * Two honest shapes, decided by the data rather than by the surface:
 *
 *  - **binary** — the market asks a yes/no question and the leading outcome is
 *    literally "Yes". "Will the Fed cut in September? 72%" is unambiguous, so
 *    the bare number is fine.
 *  - **outcome** — the leader is a named side: a candidate, a team, a nominee.
 *    The number is meaningless without the name, so the two travel together and
 *    a surface with no room for the name shows neither.
 *
 * There is no third shape. Where the leader cannot be named, this returns null
 * and the caller shows nothing — an omitted number costs a reader nothing and a
 * misattributed one costs them the point of the calendar.
 */
import { formatProbability } from "./format";
import type { CuratedCalendarEvent } from "./curation/types";

export type ProbabilityDisplay = {
  /** Already formatted, e.g. "58%", "<1%", ">99%". */
  percent: string;
  /**
   * The outcome the percentage belongs to, or undefined when the market is a
   * plain yes/no and the question itself is the subject.
   */
  outcome?: string;
  /** True when `outcome` is undefined — the only case a bare number is honest. */
  isBinary: boolean;
};

/**
 * A settled market is a result, not a forecast, and "Ended — 100%" reads as a
 * live price. Percentages belong to events that are still open questions.
 */
function isForecastable(event: CuratedCalendarEvent): boolean {
  return event.status === "upcoming" || event.status === "live";
}

/** "Yes"/"No" are the market's plumbing, not an outcome anyone is betting on. */
function isYesNoLabel(label: string): boolean {
  const l = label.trim().toLowerCase();
  return l === "yes" || l === "no" || l === "";
}

export type ProbabilityOptions = {
  /**
   * Include settled markets.
   *
   * Off by default: a percentage beside a finished event reads as a live price,
   * which is why "Ended — 100%" is worse than nothing on a chip. A surface that
   * *labels* the number — the details panel and the hover card both say
   * "Result" — is the exception, because there the final price is the answer to
   * the question being asked rather than a forecast being offered.
   */
  includeSettled?: boolean;
};

export function probabilityDisplay(
  event: CuratedCalendarEvent,
  options: ProbabilityOptions = {},
): ProbabilityDisplay | null {
  if (event.probability == null) return null;
  if (!options.includeSettled && !isForecastable(event)) return null;

  const percent = formatProbability(event.probability);
  const outcome = event.leadingOutcome?.trim() ?? "";

  if (isYesNoLabel(outcome)) {
    /*
     * A yes/no leader is only unambiguous when there is one question behind it.
     * A grouped event whose legs are each "Will <candidate> win?" also reports
     * "Yes" — the leg's own outcome array — and there the bare number is the
     * exact ambiguity this module exists to prevent. `relatedMarketsCount`
     * counts the legs folded in beside the one being shown.
     */
    if (event.relatedMarketsCount > 1) return null;
    return { percent, isBinary: true };
  }

  return { percent, outcome, isBinary: false };
}

/**
 * The compact form for a row: "Trump 58%", or "72%" when the question is its
 * own subject.
 *
 * `maxOutcome` truncates the name rather than the number — a clipped percentage
 * is unreadable, a clipped name is still identifiable. Only ever shortened at
 * the end, so "Manchester City" reads as "Manchester C…" rather than losing the
 * word that distinguishes it from Manchester United.
 */
export function probabilityLabel(
  display: ProbabilityDisplay,
  maxOutcome = 16,
): string {
  if (display.isBinary || !display.outcome) return display.percent;
  const name =
    display.outcome.length > maxOutcome
      ? `${display.outcome.slice(0, maxOutcome - 1).trimEnd()}…`
      : display.outcome;
  return `${name} ${display.percent}`;
}

/**
 * The spoken form, for `aria-label` and `title`.
 *
 * "Leading outcome" rather than a bare juxtaposition: a screen reader gets no
 * help from the visual adjacency that makes "Trump 58%" parse on screen.
 */
export function probabilityDescription(display: ProbabilityDisplay): string {
  return display.isBinary || !display.outcome
    ? `${display.percent} chance`
    : `Leading outcome ${display.outcome}, ${display.percent}`;
}
