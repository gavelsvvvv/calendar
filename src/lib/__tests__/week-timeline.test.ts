import { describe, expect, it } from "vitest";
import {
  FIRST_HOUR,
  HOURS,
  HOUR_HEIGHT,
  LAST_HOUR,
  offsetFor,
} from "@/components/calendar/week-view";

/**
 * The Week timeline's coordinate system.
 *
 * It began at 06:00, and that was not a scroll position — it was the origin.
 * `offsetFor` measured from `FIRST_HOUR * 60` and clamped anything earlier to
 * zero, so 00:30 and 06:00 were drawn on the same pixel at the very top of the
 * grid. Overnight fixtures did not merely require scrolling to find; they were
 * piled on the first row.
 *
 * These are unit tests rather than browser checks on purpose: the failure was
 * arithmetic, and arithmetic is cheaper to pin here than in a screenshot.
 */

describe("the timeline spans the whole local day", () => {
  it("starts at midnight, not 06:00 and not 01:00", () => {
    expect(FIRST_HOUR).toBe(0);
    expect(HOURS[0]).toBe(0);
  });

  it("ends at 23:00, for twenty-four rows", () => {
    expect(LAST_HOUR).toBe(23);
    expect(HOURS[HOURS.length - 1]).toBe(23);
    expect(HOURS).toHaveLength(24);
  });

  it("lists every hour once, in order", () => {
    expect(HOURS).toEqual(Array.from({ length: 24 }, (_, i) => i));
  });
});

describe("positions are measured from midnight", () => {
  it("puts midnight at the top", () => {
    expect(offsetFor("00:00")).toBe(0);
  });

  it("puts 00:30 halfway between 00:00 and 01:00", () => {
    expect(offsetFor("00:30")).toBe(HOUR_HEIGHT / 2);
    expect(offsetFor("00:30")).toBeGreaterThan(offsetFor("00:00"));
    expect(offsetFor("00:30")).toBeLessThan(offsetFor("01:00"));
  });

  it("puts 01:00 one row down", () => {
    expect(offsetFor("01:00")).toBe(HOUR_HEIGHT);
  });

  it("keeps 05:30 visible and distinct, rather than clamped to the top", () => {
    // The old origin collapsed everything before 06:00 onto offset 0.
    expect(offsetFor("05:30")).toBe(5.5 * HOUR_HEIGHT);
    expect(offsetFor("05:30")).toBeGreaterThan(0);
  });

  it("no longer treats 06:00 as the origin", () => {
    expect(offsetFor("06:00")).toBe(6 * HOUR_HEIGHT);
    expect(offsetFor("06:00")).not.toBe(0);
  });

  it("keeps noon at noon", () => {
    expect(offsetFor("12:00")).toBe(12 * HOUR_HEIGHT);
  });

  it("keeps 23:30 near the bottom, inside the grid", () => {
    const gridHeight = HOURS.length * HOUR_HEIGHT;
    expect(offsetFor("23:30")).toBe(23.5 * HOUR_HEIGHT);
    expect(offsetFor("23:30")).toBeLessThan(gridHeight);
  });

  it("clamps 23:59 to the last minute rather than past the end", () => {
    const gridHeight = HOURS.length * HOUR_HEIGHT;
    expect(offsetFor("23:59")).toBeLessThan(gridHeight);
    expect(offsetFor("23:59")).toBeGreaterThan(offsetFor("23:30"));
  });

  it("is strictly increasing across the day", () => {
    const times = ["00:00", "00:30", "03:15", "06:00", "09:45", "12:00", "18:20", "23:30"];
    const offsets = times.map(offsetFor);
    for (let i = 1; i < offsets.length; i++) {
      expect(offsets[i]).toBeGreaterThan(offsets[i - 1]);
    }
  });

  it("is one model, not one per device — the maths has no breakpoint in it", () => {
    // `offsetFor` takes a time and nothing else: there is no viewport, no
    // media query and no device flag it could consult, which is what makes
    // mobile and desktop agree by construction.
    expect(offsetFor.length).toBe(1);
    expect(offsetFor("12:00")).toBe(offsetFor("12:00"));
  });

  it("treats a missing time as the top rather than throwing", () => {
    // All-day events never reach the hour grid — they render in the band above
    // it — but the guard is what keeps a malformed time from breaking a column.
    expect(offsetFor(undefined)).toBe(0);
    expect(offsetFor("not-a-time")).toBe(0);
  });
});
