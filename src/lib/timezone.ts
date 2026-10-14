/**
 * One timezone layer for the whole application.
 *
 * ## The rule
 *
 * A **timed** event is an absolute instant. `endDate` is an ISO 8601 UTC
 * timestamp and that is the only canonical form; the clock face and the
 * calendar day it lands on are both *derived*, per viewer, from their own IANA
 * zone. The same fixture is 19:00 on the 10th in Sofia and 12:00 on the 10th in
 * New York, and it can be a different date entirely — `2026-08-11T00:30:00Z` is
 * the 11th in London and the 10th in Chicago.
 *
 * An **all-day** event is not an instant at all. Polymarket wrote a placeholder
 * — midnight or 23:59 — meaning "some time that day", and the day is a civil
 * date. `2026-08-10` is 10 August for everybody. Running it through a zone
 * conversion is how you file an election a day early, which this codebase has
 * done before. All-day dates are never converted.
 *
 * Those two ideas stay separate everywhere below.
 *
 * ## Why Intl and not offsets
 *
 * Every conversion goes through `Intl.DateTimeFormat` with an IANA zone, so
 * daylight saving is the platform's problem rather than ours. `Europe/Sofia` is
 * UTC+2 in January and UTC+3 in July; nothing here needs to know that.
 */

/**
 * What the server assumes before it has heard from the browser.
 *
 * Polymarket's own operating timezone, which is also what the curation layer
 * uses to decide which day a market's deadline belongs to. It is a starting
 * point for the first paint of a first-ever visit, never an answer.
 */
export const FALLBACK_TIME_ZONE = "America/New_York";

/** The cookie the browser's detected zone is remembered in. */
export const TIME_ZONE_COOKIE = "pmc_tz";

export function isValidTimeZone(zone: string): boolean {
  if (!zone || typeof zone !== "string" || zone.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/*
 * Formatters are expensive to construct and there are only ever one or two
 * zones in play, so they are built once per zone and kept.
 */
const dayFormatters = new Map<string, Intl.DateTimeFormat>();
const timeFormatters = new Map<string, Intl.DateTimeFormat>();
const labelFormatters = new Map<string, Intl.DateTimeFormat>();

function dayFormatter(zone: string): Intl.DateTimeFormat {
  let formatter = dayFormatters.get(zone);
  if (!formatter) {
    // en-CA formats as YYYY-MM-DD natively.
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    dayFormatters.set(zone, formatter);
  }
  return formatter;
}

function timeFormatter(zone: string): Intl.DateTimeFormat {
  let formatter = timeFormatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    timeFormatters.set(zone, formatter);
  }
  return formatter;
}

function toDate(value: Date | string | number): Date | null {
  const date =
    value instanceof Date ? value : new Date(typeof value === "number" ? value : String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** An absolute instant -> `YYYY-MM-DD` in `zone`. */
export function zonedDayKey(value: Date | string | number, zone: string): string {
  const date = toDate(value);
  return date ? dayFormatter(zone).format(date) : "";
}

/**
 * An absolute instant -> `HH:MM` in `zone`, 24-hour.
 *
 * `en-GB` with `hour12: false` renders midnight as `00:00`; some locales render
 * it as `24:00`, which sorts after everything and reads as tomorrow.
 */
export function zonedTime(value: Date | string | number, zone: string): string {
  const date = toDate(value);
  if (!date) return "";
  const formatted = timeFormatter(zone).format(date);
  return formatted === "24:00" ? "00:00" : formatted;
}

/** Minutes past local midnight in `zone` — what the week grid positions against. */
export function zonedMinutes(value: Date | string | number, zone: string): number | null {
  const time = zonedTime(value, zone);
  if (!time) return null;
  const [hours, minutes] = time.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}

/**
 * `GMT+3`, as the zone stands *at that moment* — so a Sofia user sees GMT+2 in
 * January and GMT+3 in July without anything here knowing why.
 */
export function zoneOffsetLabel(zone: string, at: Date = new Date()): string {
  let formatter = labelFormatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-GB", { timeZone: zone, timeZoneName: "shortOffset" });
    labelFormatters.set(zone, formatter);
  }
  const part = formatter.formatToParts(at).find((p) => p.type === "timeZoneName");
  // `shortOffset` gives a bare "GMT" at zero rather than "GMT+0".
  return part?.value === "GMT" ? "GMT+0" : (part?.value ?? "");
}

/** `Europe/Sofia` -> `Sofia`, for a label that has to stay short. */
export function zoneCityLabel(zone: string): string {
  const city = zone.split("/").pop() ?? zone;
  return city.replace(/_/g, " ");
}

/* --------------------------------------------------------------- the store */

/**
 * The browser's own zone, read once.
 *
 * `resolvedOptions().timeZone` is what the OS reports, and it is an IANA name
 * on every browser this app supports. If it ever isn't — an old engine, a
 * locked-down environment — the fallback keeps the calendar working rather than
 * throwing during render.
 */
let browserZone: string | null = null;

export function detectTimeZone(): string {
  if (browserZone) return browserZone;
  try {
    const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone;
    browserZone = resolved && isValidTimeZone(resolved) ? resolved : FALLBACK_TIME_ZONE;
  } catch {
    browserZone = FALLBACK_TIME_ZONE;
  }
  return browserZone;
}

/**
 * A zone does not change while a tab is open — an IANA name survives the DST
 * transitions inside it — so there is nothing to subscribe to. The store exists
 * so React can move from the server's guess to the browser's answer *once*,
 * through `useSyncExternalStore`, without a hydration mismatch.
 */
export function subscribeToTimeZone(): () => void {
  return () => {};
}

/** Test seam. Never called by the app. */
export function resetDetectedTimeZone(): void {
  browserZone = null;
}
