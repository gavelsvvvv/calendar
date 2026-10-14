import { describe, expect, it } from "vitest";
import { getMonthGridDays } from "../calendar";
import { fromDayKey, toDateKey, toDayKey } from "../dates";

/**
 * Two different kinds of key meet in the calendar and must not be confused:
 *
 *  - `toDayKey(instant)` buckets a *moment in time* into the day it belongs to
 *    in Polymarket's operating timezone. Event timestamps use this.
 *  - `toDateKey(date)`   reads the civil day a `Date` already represents.
 *    Calendar grid cells use this.
 *
 * Pushing a grid cell through `toDayKey` shifted the entire month back a day,
 * because local midnight is the previous evening in Eastern time.
 */
describe("day keys", () => {
  it("buckets an instant into its market-time day", () => {
    expect(toDayKey("2026-08-01T03:59:59.999Z")).toBe("2026-07-31");
    expect(toDayKey("2026-08-13T16:00:00Z")).toBe("2026-08-13");
  });

  it("reads a civil date without shifting it", () => {
    expect(toDateKey(new Date(2026, 7, 6))).toBe("2026-08-06");
    // Midnight local is 20:00 the previous day in ET — the trap.
    expect(toDateKey(new Date(2026, 7, 6, 0, 0, 0))).toBe("2026-08-06");
  });

  it("round-trips a day key through a Date", () => {
    for (const key of ["2026-01-01", "2026-08-06", "2026-12-31", "2027-02-28"]) {
      expect(toDateKey(fromDayKey(key))).toBe(key);
    }
  });

  it("labels every month-grid cell with its own date", () => {
    const days = getMonthGridDays(new Date(2026, 7, 15));
    for (const day of days) {
      const key = toDateKey(day);
      const [y, m, d] = key.split("-").map(Number);
      expect(y).toBe(day.getFullYear());
      expect(m).toBe(day.getMonth() + 1);
      expect(d).toBe(day.getDate());
    }
  });

  it("gives consecutive grid cells consecutive keys", () => {
    const keys = getMonthGridDays(new Date(2026, 7, 15)).map(toDateKey);
    expect(new Set(keys).size).toBe(keys.length);
    for (let i = 1; i < keys.length; i++) {
      const prev = fromDayKey(keys[i - 1]).getTime();
      const next = fromDayKey(keys[i]).getTime();
      expect(Math.round((next - prev) / 86_400_000)).toBe(1);
    }
  });
});
