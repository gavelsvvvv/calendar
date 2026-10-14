/**
 * Which day does this event actually happen on?
 *
 * Gamma exposes nine date-bearing fields between an event and its markets, and
 * only two of them describe the real world. The rest are market lifecycle —
 * when trading opened, when the oracle may settle, when a row was last written.
 * Picking the convenient one puts a baseball game on the calendar a week after
 * it was played, which is the bug this module exists to prevent.
 *
 * The ordering below is measured, not assumed. `scripts/audit-date-fields.ts`
 * walks a live window and prints the coverage and divergence tables it came
 * from; the findings are recorded against each rung so a future reader can tell
 * which rungs are load-bearing and which are insurance.
 *
 * Measured over 765 events in a six-week window on 2026-08-11:
 *
 *   field                     present   moves the day vs endDate
 *   market.gameStartTime       370/765  300   ← real kickoff on a fixture; a
 *                                              window marker off one (80 events)
 *   event.eventDate            333/765  241   ← real event day
 *   event.startTime            506/765  362   ← MIXED, see below
 *   event.startDate            765/765  763   ← market creation. never usable
 *   market.eventStartTime       80/765   28   ← a system timestamp, identical
 *                                              across every market of an event
 *
 * `event.startDate` is the trap: it is present on every event and disagrees with
 * `endDate` on 763 of them, which looks like a rich signal until you read one.
 * "Fed Decision in September?" carries `startDate` 2026-05-13 — the day the
 * market opened, four months before the meeting.
 *
 * `market.eventStartTime` reads like exactly what this module wants and is not:
 * every market of "What will WTI Crude Oil hit in August 2026?" carries the
 * identical `2026-07-25T04:02:24.716Z`, milliseconds and all. It is a row
 * timestamp.
 */
import type { GammaEvent, GammaMarket } from "../polymarket/gamma-types";
import { toDayKey } from "../dates";

/**
 * Which field produced the calendar date.
 *
 * Debugging and audit only — deliberately absent from the calendar UI, where a
 * reader has no use for the difference between a kickoff and a reviewed
 * deadline. `scripts/audit-curation.ts` groups by it.
 */
export type DateSource =
  | "gameStartTime"
  | "eventDate"
  | "reviewedMarketEnd"
  | "marketEnd"
  | "eventEnd"
  | "closedTime"
  | "estimated";

export type DateConfidenceLevel = "confirmed" | "estimated";

export type ResolvedEventDate = {
  /** The chosen instant, always a valid ISO-8601 string. */
  iso: string;
  confidence: DateConfidenceLevel;
  source: DateSource;
  /**
   * A real clock time for the day, when a structured field supplied one that the
   * chosen date did not. Never moves the day — see `refineTime`.
   */
  timeHintIso?: string;
};

/**
 * Gamma writes instants three different ways, and one of them breaks the others.
 *
 *  - ISO-8601:            `2026-08-13T18:20:00Z`
 *  - space-separated:     `2026-08-06 18:20:00+00`   (gameStartTime)
 *  - bare calendar day:   `2026-08-06`               (eventDate, endDateIso)
 *
 * The middle form needs its two-digit offset widened to `+00:00` before
 * `Date.parse` will agree across engines. Applying that rewrite blindly is how
 * the first version of the audit script silently dropped every `eventDate`:
 * `2026-08-06` ends in `-06`, which the offset pattern matches, producing
 * `2026-08-06:00`. The bare-day case is therefore tested for first and given an
 * explicit UTC midnight.
 */
export function parseGammaInstant(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (raw === "") return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const ms = Date.parse(`${raw}T00:00:00Z`);
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
  }

  const normalised = raw.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00");
  const ms = Date.parse(normalised);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** A plain ISO check for fields that are supposed to already be ISO. */
export function isValidIso(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

/**
 * How far apart two dates may sit before the market's answer is treated as a
 * stray rather than a correction. Polymarket occasionally leaves a far-future
 * placeholder on one leg of a group; relocating an event ten months on the
 * strength of it is worse than keeping the event's own date and saying so.
 */
const DIVERGENCE_LIMIT_DAYS = 45;

/**
 * Is this a real fixture — two sides, a scheduled meeting — or something else
 * wearing a fixture's field?
 *
 * `gameStartTime` means "kickoff" only on an actual fixture. Elsewhere
 * Polymarket reuses it to mark the *start of a measurement window*, and taking
 * it as the event date files those a whole window early:
 *
 *   What will WTI Crude Oil hit in August 2026?   gameStartTime 2026-07-31, ends 2026-09-01
 *   Elon Musk # tweets August 11 - August 18?     gameStartTime 2026-08-11, ends 2026-08-18
 *   Highest temperature in London on August 11?   gameStartTime 2026-08-10, ends 2026-08-11
 *   Who will attend US-Iran peace talks by …?     gameStartTime 2026-07-03, ends 2026-08-31
 *
 * 80 of the 370 events carrying `gameStartTime` are not fixtures, and it would
 * move 67 of those to the wrong day — the weather markets land a day before the
 * date in their own title, and the peace-talks market lands eight weeks early.
 *
 * The test is Gamma's own sports metadata, and it is unambiguous: all 290
 * sport-tagged events carrying a kickoff have a `gameId`, exactly two `teams`
 * and a `sport` — MLB, football, tennis and esports alike. None of the 80
 * others have any of it.
 */
function isFixture(event: GammaEvent): boolean {
  return (
    event.gameId !== undefined ||
    event.sport !== undefined ||
    (Array.isArray(event.teams) && event.teams.length > 0)
  );
}

/**
 * The earliest kickoff among an event's markets.
 *
 * Earliest rather than first-found: the array order is Gamma's, and a group can
 * carry several legs. An event begins when its first leg does — a tournament
 * day that opens at 09:00 is a 09:00 event even if the API happens to list the
 * 14:00 match first.
 */
function earliestKickoff(markets: GammaMarket[]): string | null {
  let best: string | null = null;
  for (const market of markets) {
    const iso = parseGammaInstant(market.gameStartTime);
    if (iso === null) continue;
    if (best === null || Date.parse(iso) < Date.parse(best)) best = iso;
  }
  return best;
}

/**
 * `event.startTime`, but only where it is safe.
 *
 * The field splits three ways over the 137 events that carry it without a
 * kickoff: 78 land on the same day as `endDate`, 57 land *earlier* and 2 land
 * later. The early ones are market-open timestamps wearing a plausible name —
 * "Spider-Man: Brand New Day total domestic gross" reports 2026-07-16 against
 * an endDate of 2026-08-31 — and the late ones are worse: "Clacton by-election
 * Winner" reports 2027-06-30 for an August 2026 poll.
 *
 * So it is never allowed to choose the day. It is allowed to supply a *time*
 * for a day already chosen, which is the only way an election whose endDate is
 * a bare `00:00Z` placeholder shows "17:00" instead of sitting in the all-day
 * band. Both sides are checked for placeholders first: swapping one placeholder
 * for another gains nothing, and inventing 20:00 from 23:59 is precisely what
 * `resolveTime` refuses to do.
 */
export function refineTime(chosenIso: string, event: GammaEvent): string | undefined {
  const hint = parseGammaInstant(event.startTime);
  if (hint === null) return undefined;
  if (toDayKey(hint) !== toDayKey(chosenIso)) return undefined;
  if (isPlaceholderInstant(hint)) return undefined;
  if (!isPlaceholderInstant(chosenIso)) return undefined;
  return hint;
}

/**
 * The conventions Polymarket uses for "some time that day": midnight, one
 * minute to midnight, and noon, all in UTC. Shared with `resolveTime`, which
 * applies the same test plus a market-time one.
 */
export function isPlaceholderInstant(iso: string): boolean {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return true;
  const h = date.getUTCHours();
  const m = date.getUTCMinutes();
  return (h === 0 && m === 0) || (h === 23 && m >= 58) || (h === 12 && m === 0);
}

/**
 * When did this group actually settle?
 *
 * The latest `closedTime` across the event rows and every market inside them —
 * latest, because a group is finished when its last leg is. Gamma writes the
 * event-level field as ISO-8601 and the market-level one space-separated, so
 * both go through `parseGammaInstant`.
 *
 * This is the only field that says when a decided question was decided.
 * Everything else on a settled event describes its *deadline*: "World Cup:
 * Nation of Top Goalscorer" settled on 2026-07-20 and carries an `endDate` of
 * 2026-08-20, and it is that month of dead air the calendar was rendering as an
 * upcoming event. Returns `null` when nothing readable is present, which is the
 * signal to fall back to the guard in `filterEvents` rather than to invent one.
 */
export function resolveSettlementInstant(members: GammaEvent[]): string | null {
  let latest: string | null = null;
  const consider = (value: unknown) => {
    const iso = parseGammaInstant(value);
    if (iso === null) return;
    if (latest === null || Date.parse(iso) > Date.parse(latest)) latest = iso;
  };
  for (const member of members) {
    consider(member.closedTime);
    for (const market of member.markets ?? []) consider(market.closedTime);
  }
  return latest;
}

/**
 * Pick the day, and say which field decided it.
 *
 * The ladder, in order, with what each rung is for:
 *
 *  1. **`market.gameStartTime`, on a fixture only** — the real kickoff, and the
 *     only field that names when the thing *happens*. For sports it is nowhere
 *     near the market's end date: Polymarket sets the resolution deadline a
 *     week after the game, so 231 of the 300 day-moves it makes are exactly the
 *     4-7 day bucket. Toronto Blue Jays vs Chicago Cubs is played on 6 August
 *     and its market ends on the 13th. See `isFixture` for why the gate is not
 *     optional: off a fixture the same field marks a measurement window's start
 *     and files events a whole window early.
 *
 *  2. **`event.eventDate`** — a bare `YYYY-MM-DD` naming the real event day.
 *     This is what catches the markets rung 1 now declines: "Highest
 *     temperature in London on August 11?" has a `gameStartTime` of the 10th
 *     and an `eventDate` of the 11th, which is the date in its own title.
 *     Ranked below a kickoff deliberately: it is a fixed local day with no
 *     instant, so it cannot be re-zoned for a reader in another timezone, and
 *     the two disagree on 88 of 333 events for exactly that reason — a match at
 *     00:30Z is "tomorrow" in UTC and tonight in New York.
 *
 *  3. **A reviewed, unanimous market end date** — `hasReviewedDates` means a
 *     human at Polymarket checked it. Only trusted when every market agrees.
 *
 *  4. **The market end date**, where the event carries none of its own.
 *
 *  5. **The event end date** — the resolution deadline, and the last resort.
 *     Still the right answer for a great many events: "Fed Decision in
 *     September?" has no kickoff, no eventDate and no startTime, and its
 *     endDate of 2026-09-16 is the FOMC decision day.
 *
 * Titles are never parsed for dates.
 */
export function resolveEventDate(event: GammaEvent): ResolvedEventDate | null {
  const markets = event.markets ?? [];

  const kickoff = isFixture(event) ? earliestKickoff(markets) : null;
  if (kickoff) {
    return {
      iso: kickoff,
      confidence: "confirmed",
      source: "gameStartTime",
      timeHintIso: refineTime(kickoff, event),
    };
  }

  const eventDay = parseGammaInstant(event.eventDate);
  if (eventDay) {
    return {
      iso: eventDay,
      confidence: "confirmed",
      source: "eventDate",
      timeHintIso: refineTime(eventDay, event),
    };
  }

  const reviewed = markets
    .filter((m) => m.hasReviewedDates && isValidIso(m.endDate))
    .map((m) => m.endDate as string);

  if (reviewed.length > 0 && reviewed.length === markets.length) {
    const unique = new Set(reviewed.map((d) => toDayKey(d)));
    if (unique.size === 1) {
      const eventEnd = isValidIso(event.endDate) ? event.endDate : null;
      const withinReach =
        eventEnd === null ||
        Math.abs(Date.parse(reviewed[0]) - Date.parse(eventEnd)) <=
          DIVERGENCE_LIMIT_DAYS * 86_400_000;
      if (withinReach) {
        return {
          iso: reviewed[0],
          confidence: "confirmed",
          source: "reviewedMarketEnd",
          timeHintIso: refineTime(reviewed[0], event),
        };
      }
      return {
        iso: eventEnd,
        confidence: "estimated",
        source: "estimated",
        timeHintIso: refineTime(eventEnd, event),
      };
    }
  }

  const marketEnds = markets
    .filter((m) => isValidIso(m.endDate))
    .map((m) => m.endDate as string);
  if (marketEnds.length > 0 && !isValidIso(event.endDate)) {
    const unique = new Set(marketEnds.map((d) => toDayKey(d)));
    if (unique.size === 1) {
      return {
        iso: marketEnds[0],
        confidence: "confirmed",
        source: "marketEnd",
        timeHintIso: refineTime(marketEnds[0], event),
      };
    }
    const latest = marketEnds.reduce((a, b) => (Date.parse(a) > Date.parse(b) ? a : b));
    return {
      iso: latest,
      confidence: "estimated",
      source: "estimated",
      timeHintIso: refineTime(latest, event),
    };
  }

  if (isValidIso(event.endDate)) {
    return {
      iso: event.endDate,
      confidence: "confirmed",
      source: "eventEnd",
      timeHintIso: refineTime(event.endDate, event),
    };
  }

  return null;
}
