/**
 * Date helpers.
 *
 * Polymarket schedules and resolves in US Eastern time, and its `endDate` values
 * are UTC instants that frequently sit just past midnight UTC (e.g. a "July 2026"
 * oil market ends at `2026-08-01T03:59:59.999Z`, which is 23:59 ET on July 31).
 * Bucketing by UTC would file those under the wrong month, and bucketing by the
 * viewer's local zone would make the server and client disagree during hydration.
 *
 * So every calendar day key is derived in `America/New_York`, deterministically,
 * on both server and client.
 */

export const MARKET_TIME_ZONE = "America/New_York";

const dayKeyFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: MARKET_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * `Date` (or ISO string) -> `YYYY-MM-DD` in market time.
 *
 * With one exception: exactly midnight UTC is not an instant, it is how
 * Polymarket writes a bare date. Those markets have no clock time at all — the
 * event happens "on the 18th" — and running the marker through Eastern time
 * rolls it back to 20:00 the previous evening.
 *
 * That was filing every primary a day early: Tennessee's (6 August) showed on
 * the 5th, Minnesota's and Wisconsin's (11 August) on the 10th, Florida's
 * (18 August) on the 17th. Four independent elections, all off by one, all
 * carrying `00:00:00Z`.
 *
 * Only exact midnight qualifies. A market ending at `03:59:59.999Z` is a real
 * instant — 23:59 the previous evening in Eastern time — and must still be
 * bucketed there.
 */
export function toDayKey(value: Date | string): string {
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "";

  if (
    d.getUTCHours() === 0 &&
    d.getUTCMinutes() === 0 &&
    d.getUTCSeconds() === 0 &&
    d.getUTCMilliseconds() === 0
  ) {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  // en-CA formats as YYYY-MM-DD natively.
  return dayKeyFormatter.format(d);
}

/** `YYYY-MM-DD` -> a `Date` at local noon, safe for date-fns calendar math. */
export function fromDayKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1, 12, 0, 0, 0);
}

/** Today's day key in market time. */
export function todayKey(now: Date = new Date()): string {
  return toDayKey(now);
}

/** `YYYY-MM` for URL state. */
export function toMonthKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/**
 * Parse an anchor key into a Date, or null.
 *
 * Accepts both `YYYY-MM` (the first of that month) and `YYYY-MM-DD`. The week
 * view needs day precision — without it, paging to the next week would round
 * straight back to the 1st and the view would never move — while month and
 * agenda keep the shorter, friendlier form in the URL.
 */
export function fromMonthKey(key: string): Date | null {
  const match = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(key.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = match[3] === undefined ? 1 : Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(year, month - 1, day, 12, 0, 0, 0);
  // Reject dates the calendar rolled over, e.g. 2026-02-31.
  if (Number.isNaN(d.getTime()) || d.getMonth() !== month - 1 || d.getDate() !== day) {
    return null;
  }
  return d;
}

/** `YYYY-MM-DD` for a local Date — the day-precision anchor used by the week view. */
export function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
