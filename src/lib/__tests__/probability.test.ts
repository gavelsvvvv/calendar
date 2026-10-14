import { describe, expect, it } from "vitest";
import type { CuratedCalendarEvent } from "../curation/types";
import { emphasisOf } from "../emphasis";
import {
  probabilityDescription,
  probabilityDisplay,
  probabilityLabel,
} from "../probability";

/**
 * The rule under test is one sentence: a number is only shown when the thing it
 * describes is named or obvious. "US Presidential Election — 58%" is the defect;
 * every case here is a way of arriving at it.
 */

function event(overrides: Partial<CuratedCalendarEvent> = {}): CuratedCalendarEvent {
  return {
    id: "1",
    slug: "e",
    title: "Will the Fed cut rates in September?",
    shortTitle: "Fed cut in September?",
    endDate: "2026-09-16T18:00:00Z",
    displayDate: "2026-09-16",
    time: "14:00",
    timeKind: "scheduled",
    isAllDay: false,
    dateConfidence: "confirmed",
    dateSource: "reviewedMarketEnd",
    category: "economy",
    volume: 1_000_000,
    liquidity: 100_000,
    primaryMarketUrl: "https://polymarket.com/event/e",
    relatedMarketsCount: 1,
    importanceScore: 500,
    importanceLevel: "standard",
    status: "upcoming",
    source: "polymarket",
    sourceEventIds: ["1"],
    groupedBy: "single",
    tags: [],
    probability: 0.72,
    leadingOutcome: "Yes",
    ...overrides,
  };
}

describe("a simple binary market may show a bare percentage", () => {
  it("shows the number alone when the question is its own subject", () => {
    const d = probabilityDisplay(event());
    expect(d).not.toBeNull();
    expect(d!.isBinary).toBe(true);
    expect(probabilityLabel(d!)).toBe("72%");
  });

  it("treats a missing leading outcome as binary", () => {
    const d = probabilityDisplay(event({ leadingOutcome: undefined }));
    expect(d!.isBinary).toBe(true);
  });
});

describe("a multi-outcome event never shows an unattributed number", () => {
  it("omits the percentage when the leader cannot be named", () => {
    // The exact defect from the brief: an election with a dozen legs whose
    // headline market still reports a bare "Yes".
    const d = probabilityDisplay(
      event({
        title: "US Presidential Election",
        leadingOutcome: "Yes",
        relatedMarketsCount: 12,
      }),
    );
    expect(d).toBeNull();
  });

  it("names the leader when there is one", () => {
    const d = probabilityDisplay(
      event({
        title: "US Presidential Election",
        leadingOutcome: "Trump",
        probability: 0.58,
        relatedMarketsCount: 12,
      }),
    );
    expect(d!.isBinary).toBe(false);
    expect(d!.outcome).toBe("Trump");
    expect(probabilityLabel(d!)).toBe("Trump 58%");
  });

  it("puts the outcome name in the label, not just the tooltip", () => {
    const d = probabilityDisplay(
      event({ leadingOutcome: "Manchester City", probability: 0.54, relatedMarketsCount: 6 }),
    );
    expect(probabilityLabel(d!)).toContain("Manchester");
    expect(probabilityLabel(d!)).toContain("54%");
  });
});

describe("a sports probability identifies the team", () => {
  it("never reports a match as a bare number", () => {
    const d = probabilityDisplay(
      event({
        title: "Boston Red Sox vs. New York Yankees",
        category: "sports",
        leadingOutcome: "New York Yankees",
        probability: 0.61,
        relatedMarketsCount: 4,
      }),
    );
    expect(d!.isBinary).toBe(false);
    expect(probabilityLabel(d!, 20)).toBe("New York Yankees 61%");
  });

  it("truncates a long team name rather than the number", () => {
    const d = probabilityDisplay(
      event({
        leadingOutcome: "Borussia Mönchengladbach",
        probability: 0.61,
        relatedMarketsCount: 4,
      }),
    );
    const label = probabilityLabel(d!, 12);
    expect(label.endsWith("61%")).toBe(true);
    expect(label).toContain("…");
    expect(label.length).toBeLessThanOrEqual(12 + " 61%".length);
  });
});

describe("settled markets are results, not forecasts", () => {
  for (const status of ["resolved", "closed"] as const) {
    it(`omits the percentage once an event is ${status}`, () => {
      expect(probabilityDisplay(event({ status }))).toBeNull();
    });
  }

  it("keeps it while an event is live", () => {
    expect(probabilityDisplay(event({ status: "live" }))).not.toBeNull();
  });
});

describe("edge cases", () => {
  it("shows nothing when there is no probability at all", () => {
    expect(probabilityDisplay(event({ probability: undefined }))).toBeNull();
  });

  it("keeps the <1% and >99% forms rather than rounding to 0 or 100", () => {
    expect(probabilityDisplay(event({ probability: 0.001 }))!.percent).toBe("<1%");
    expect(probabilityDisplay(event({ probability: 0.999 }))!.percent).toBe(">99%");
  });

  it("spells the attribution out for screen readers", () => {
    const binary = probabilityDisplay(event())!;
    expect(probabilityDescription(binary)).toBe("72% chance");
    const named = probabilityDisplay(
      event({ leadingOutcome: "Trump", probability: 0.58, relatedMarketsCount: 12 }),
    )!;
    expect(probabilityDescription(named)).toBe("Leading outcome Trump, 58%");
  });
});

describe("importance is presented as a discovery signal, never a score", () => {
  it("says nothing at all for a standard event", () => {
    expect(emphasisOf(event())).toBeNull();
  });

  it("pairs the label with the number that earned it", () => {
    const e = emphasisOf(event({ importanceLevel: "major", volume: 18_400_000 }));
    expect(e!.label).toBe("Major");
    expect(e!.note).toBe("$18M volume");
  });

  it("credits a deep book when that is the real reason", () => {
    const e = emphasisOf(
      event({ importanceLevel: "major", volume: 2_000_000, relatedMarketsCount: 12 }),
    );
    expect(e!.note).toBe("$2M across 12 markets");
  });

  it("never exposes the raw score", () => {
    const e = emphasisOf(event({ importanceLevel: "major", importanceScore: 812 }));
    const text = `${e!.label} ${e!.note} ${e!.explanation}`;
    expect(text).not.toContain("812");
  });

  it("frames the explanation as editorial rather than objective", () => {
    const e = emphasisOf(event({ importanceLevel: "major" }));
    expect(e!.explanation.toLowerCase()).toContain("highlighted for discovery");
  });
});

describe("a labelled Result may show a settled number", () => {
  // The default refuses settled markets because a bare percentage beside a
  // finished event reads as a live price. A surface that says "Result" in the
  // label is the exception: there the final price is the answer.
  it("is omitted by default once an event has settled", () => {
    expect(probabilityDisplay(event({ status: "resolved" }))).toBeNull();
  });

  it("is available to a surface that labels it", () => {
    const d = probabilityDisplay(event({ status: "resolved", probability: 0.999 }), {
      includeSettled: true,
    });
    expect(d!.percent).toBe(">99%");
  });

  it("still names the outcome when the event had several", () => {
    const d = probabilityDisplay(
      event({
        status: "resolved",
        probability: 0.999,
        leadingOutcome: "ThunderTalk Gaming",
        relatedMarketsCount: 36,
      }),
      { includeSettled: true },
    );
    expect(d!.isBinary).toBe(false);
    expect(probabilityLabel(d!, 24)).toBe("ThunderTalk Gaming >99%");
  });

  it("still shows nothing when there is no probability at all", () => {
    expect(
      probabilityDisplay(event({ status: "resolved", probability: undefined }), {
        includeSettled: true,
      }),
    ).toBeNull();
  });
});
