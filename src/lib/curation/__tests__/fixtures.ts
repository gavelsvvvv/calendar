import type { GammaEvent } from "../../polymarket/gamma-types";

/**
 * Fixtures copied from real Gamma API responses (Aug 2026), trimmed to the
 * fields the pipeline reads. Shapes — including the JSON-encoded `outcomes` and
 * `outcomePrices` strings and the numeric-as-string `volume` — are preserved
 * exactly, because those quirks are what the code has to survive.
 */

export function gammaEvent(overrides: Partial<GammaEvent> = {}): GammaEvent {
  const endDate = overrides.endDate ?? "2026-08-15T16:00:00Z";
  return {
    id: "100",
    title: "Test event",
    slug: "test-event",
    startDate: "2026-07-01T00:00:00Z",
    volume: 500_000,
    liquidity: 50_000,
    // Default the market date to the event's, so overriding `endDate` alone
    // behaves the way a reader expects. Real markets carry reviewed dates, and
    // those legitimately take priority over the event date in the pipeline.
    markets: [
      {
        id: "m1",
        question: "Test market",
        slug: "test-market",
        endDate,
        hasReviewedDates: true,
        outcomes: '["Yes", "No"]',
        outcomePrices: '["0.62", "0.38"]',
        volume: "500000",
        liquidity: "50000",
      },
    ],
    tags: [{ id: "1", label: "Politics", slug: "politics" }],
    ...overrides,
    endDate,
  };
}

/**
 * The real Villarreal fixture: three separate Gamma events describing one match,
 * tied together by `gameId` with the derivatives pointing at the parent.
 */
export const SPORTS_FAMILY: GammaEvent[] = [
  gammaEvent({
    id: "757862",
    title: "CF Villarreal C vs. Levante UD",
    slug: "clf-vil-lu-2026-08-05",
    ticker: "clf-vil-lu-2026-08-05",
    endDate: "2026-08-05T08:00:00Z",
    gameId: 72728824,
    volume: 200_000,
    liquidity: 30_000,
    tags: [{ slug: "sports", label: "Sports" }, { slug: "soccer", label: "Soccer" }],
    series: [{ id: "12410", slug: "clf-games", ticker: "clf-games" }],
    markets: [
      { id: "a1", question: "Will Villarreal win?", outcomes: '["Yes","No"]', outcomePrices: '["0.55","0.45"]', volume: "120000", endDate: "2026-08-05T08:00:00Z", hasReviewedDates: true },
      { id: "a2", question: "Will Levante win?", outcomes: '["Yes","No"]', outcomePrices: '["0.30","0.70"]', volume: "80000", endDate: "2026-08-05T08:00:00Z", hasReviewedDates: true },
    ],
  }),
  gammaEvent({
    id: "758277",
    title: "CF Villarreal C vs. Levante UD - Exact Score",
    slug: "clf-vil-lu-2026-08-05-exact-score",
    endDate: "2026-08-05T08:00:00Z",
    gameId: 72728824,
    parentEventId: 757862,
    volume: 40_000,
    liquidity: 8_000,
    tags: [{ slug: "sports", label: "Sports" }],
    markets: [
      { id: "b1", question: "1-0", outcomes: '["Yes","No"]', outcomePrices: '["0.12","0.88"]', volume: "20000", endDate: "2026-08-05T08:00:00Z", hasReviewedDates: true },
    ],
  }),
  gammaEvent({
    id: "765286",
    title: "CF Villarreal C vs. Levante UD - More Markets",
    slug: "clf-vil-lu-2026-08-05-more-markets",
    endDate: "2026-08-05T08:00:00Z",
    gameId: 72728824,
    parentEventId: 757862,
    volume: 25_000,
    liquidity: 5_000,
    tags: [{ slug: "sports", label: "Sports" }],
    markets: [
      { id: "c1", question: "Total corners over 9.5", outcomes: '["Yes","No"]', outcomePrices: '["0.48","0.52"]', volume: "15000", endDate: "2026-08-05T08:00:00Z", hasReviewedDates: true },
    ],
  }),
];

/**
 * The real Clacton family: four political events for one by-election, with no
 * `gameId` and no `parentEventId` — only the title tells you they belong together.
 */
export const POLITICS_FAMILY: GammaEvent[] = [
  gammaEvent({
    id: "900001",
    title: "Clacton by-election Winner",
    slug: "clacton-by-election-winner",
    endDate: "2026-08-13T16:00:00Z",
    volume: 3_000_000,
    liquidity: 200_000,
    tags: [{ slug: "elections", label: "Elections" }, { slug: "politics", label: "Politics" }],
    markets: [
      { id: "d1", groupItemTitle: "Nigel Farage", question: "Will Nigel Farage win?", outcomes: '["Yes","No"]', outcomePrices: '["0.74","0.26"]', volume: "1500000", endDate: "2026-08-13T16:00:00Z", hasReviewedDates: true },
      { id: "d2", groupItemTitle: "Giles Watling", question: "Will Giles Watling win?", outcomes: '["Yes","No"]', outcomePrices: '["0.11","0.89"]', volume: "500000", endDate: "2026-08-13T16:00:00Z", hasReviewedDates: true },
    ],
  }),
  gammaEvent({
    id: "900002",
    title: "Clacton by-election: 2nd place",
    slug: "clacton-by-election-2nd-place",
    endDate: "2026-08-13T16:00:00Z",
    volume: 400_000,
    liquidity: 40_000,
    tags: [{ slug: "elections", label: "Elections" }],
    markets: [
      { id: "e1", groupItemTitle: "Labour", question: "Will Labour finish 2nd?", outcomes: '["Yes","No"]', outcomePrices: '["0.40","0.60"]', volume: "200000", endDate: "2026-08-13T16:00:00Z", hasReviewedDates: true },
    ],
  }),
  gammaEvent({
    id: "900003",
    title: "Clacton by-election: Turnout",
    slug: "clacton-by-election-turnout",
    // A sibling closing a day later — the real data does this constantly.
    endDate: "2026-08-14T16:00:00Z",
    volume: 90_000,
    liquidity: 9_000,
    tags: [{ slug: "elections", label: "Elections" }],
    markets: [
      { id: "f1", question: "Turnout above 50%?", outcomes: '["Yes","No"]', outcomePrices: '["0.35","0.65"]', volume: "90000", endDate: "2026-08-14T16:00:00Z", hasReviewedDates: true },
    ],
  }),
  gammaEvent({
    id: "900004",
    title: "Clacton by-election: Margin of Victory",
    slug: "clacton-by-election-margin-of-victory",
    endDate: "2026-08-13T16:00:00Z",
    volume: 60_000,
    liquidity: 6_000,
    tags: [{ slug: "elections", label: "Elections" }],
    markets: [
      { id: "g1", question: "Margin above 20 points?", outcomes: '["Yes","No"]', outcomePrices: '["0.55","0.45"]', volume: "60000", endDate: "2026-08-13T16:00:00Z", hasReviewedDates: true },
    ],
  }),
];

/** Daily noise families, verbatim from the live API. */
export const WEATHER_NOISE: GammaEvent[] = [
  "Highest temperature in Hong Kong on August 5?",
  "Highest temperature in Wellington on August 5?",
  "Lowest temperature in London on August 5?",
].map((title, i) =>
  gammaEvent({
    id: `w${i}`,
    title,
    startDate: "2026-08-04T00:00:00Z",
    endDate: "2026-08-05T23:59:00Z",
    volume: 40_000,
    tags: [{ slug: "weather", label: "Weather" }, { slug: "daily-temperature", label: "Daily Temperature" }],
  }),
);

export const CRYPTO_NOISE: GammaEvent[] = [
  "Bitcoin above ___ on August 5?",
  "Ethereum above ___ on August 5?",
  "Solana above ___ on August 5?",
  "Bitcoin Up or Down on August 5?",
  "Solana Up or Down on August 5?",
  "Ethereum between $3,000 and $4,000 on August 5?",
].map((title, i) =>
  gammaEvent({
    id: `c${i}`,
    title,
    startDate: "2026-08-04T00:00:00Z",
    endDate: "2026-08-05T23:59:00Z",
    volume: 200_000,
    tags: [{ slug: "crypto", label: "Crypto" }, { slug: "crypto-prices", label: "Crypto Prices" }],
  }),
);

export const FINANCE_NOISE: GammaEvent[] = [
  "S&P 500 Up or Down on August 5?",
  "Nasdaq Up or Down on August 5?",
  "Gold above $3,500 on August 5?",
].map((title, i) =>
  gammaEvent({
    id: `f${i}`,
    title,
    startDate: "2026-08-04T00:00:00Z",
    endDate: "2026-08-05T23:59:00Z",
    volume: 150_000,
    tags: [{ slug: "economy", label: "Economy" }],
  }),
);

/** Crypto events that must survive the crypto exclusion rules. */
export const MEANINGFUL_CRYPTO: GammaEvent[] = [
  "Will the SEC approve a Solana ETF by December 31?",
  "Ethereum Pectra upgrade activated by...?",
  "Monad mainnet launch by September?",
  "Will Coinbase list Monad in 2026?",
].map((title, i) =>
  gammaEvent({
    id: `mc${i}`,
    title,
    startDate: "2026-05-01T00:00:00Z",
    endDate: "2026-08-20T16:00:00Z",
    volume: 800_000,
    liquidity: 90_000,
    tags: [{ slug: "crypto", label: "Crypto" }],
  }),
);
