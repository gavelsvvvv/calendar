/**
 * Navigation benchmark.
 *
 * Measures the three interactions that decide whether this calendar feels
 * alive: switching view, paging to the next month, and coming back to a month
 * already visited. Run against the production build — `next dev` measures the
 * compiler, not the app.
 *
 *   npm run build && npm start &
 *   npx tsx scripts/bench-navigation.ts [baseUrl] [runs]
 *
 * What a row means:
 *   paint    click to the requested view or month being on screen with content.
 *            This is the number a person experiences as "it happened".
 *   settled  ...and it has stopped changing, with nothing left in the air. The
 *            agenda fills in behind its first screenful, so the two differ
 *            there; everywhere else they are the same frame.
 *   block    total time the main thread spent in long tasks during that
 *            window. This is the number a finger feels: a 300ms interaction
 *            that blocks for 5ms is smooth, one that blocks for 200ms is not.
 *   api      requests to /api/events during the window.
 *   rsc      React Server Component payload fetches — a URL change that
 *            re-enters the server. Should be zero for a pure UI switch.
 */
import { existsSync, readdirSync } from "node:fs";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

const BASE = process.argv[2] ?? "http://127.0.0.1:3000";
const RUNS = Number(process.argv[3] ?? 3);

function resolveChromium(): string | undefined {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!root || !existsSync(root)) return undefined;
  const dir = readdirSync(root).find((d) => /^chromium-\d+$/.test(d));
  if (!dir) return undefined;
  const candidate = `${root}/${dir}/chrome-linux/chrome`;
  return existsSync(candidate) ? candidate : undefined;
}

type Sample = { paint: number; ms: number; block: number; api: number; rsc: number };
type Row = { name: string; samples: Sample[] };

/** The anchor month every scenario starts from, so runs are comparable. */
const MONTH = "2026-09";
const NEXT_LABEL = "October 2026";
const BACK_LABEL = "September 2026";

/*
 * The first day each month's grid covers — the `start` its fetch carries.
 *
 * September's grid runs 30 Aug – 3 Oct and October's 27 Sep – 31 Oct, both whole
 * weeks. A week inside September shares September's grid start, which is exactly
 * why one entry per month can serve all three views.
 */
const SEPTEMBER = "2026-08-30T00:00:00.000Z";
const OCTOBER = "2026-09-27T00:00:00.000Z";

async function shim(context: BrowserContext) {
  /*
   * The production build carries Google Analytics, and this file exists to
   * measure the *app*. A third-party tag fetching over the real network would
   * add its own main-thread work and its own latency to every sample, and would
   * file a few hundred robot page views against a live property while doing it.
   */
  await context.route(
    /googletagmanager\.com|google-analytics\.com|analytics\.google\.com/,
    (route) => route.abort(),
  );
  await context.addInitScript(() => {
    const g = globalThis as unknown as Record<string, unknown>;
    if (typeof g.__name !== "function") g.__name = (fn: unknown) => fn;
    try {
      localStorage.setItem("pmc.onboarding.v1", "bench");
    } catch {
      /* private mode */
    }

    /*
     * In-flight requests, by the range they ask for.
     *
     * The DOM alone cannot say when a month has arrived: the calendar paints
     * the heading of a month it is still fetching, over the previous month's
     * leftovers, so a naive "the title says October" settles early. But a bare
     * request count is no good either — arriving somewhere immediately kicks
     * off a prefetch of the month *after* it, and waiting for that would charge
     * the interaction for work done on its behalf afterwards.
     *
     * So this counts only requests for a given range's own start, and never the
     * separate `markets=1` call that fetches event detail.
     */
    const pending = new Set<string>();
    (g as { __inflightFor?: (start: string) => number }).__inflightFor = (start) => {
      let n = 0;
      for (const url of pending) {
        if (url.includes(`start=${encodeURIComponent(start)}`) && !url.includes("markets=1")) n += 1;
      }
      return n;
    };
    const original = globalThis.fetch;
    globalThis.fetch = (...args: Parameters<typeof fetch>) => {
      const url = String(typeof args[0] === "string" ? args[0] : (args[0] as Request).url);
      const token = `${url}#${pending.size}`;
      pending.add(token);
      return original(...args).finally(() => pending.delete(token));
    };
  });
}

/**
 * Click something and time how long until the calendar has actually arrived.
 *
 * "Arrived" is three conditions at once, because no single one is enough:
 *
 *   1. `signature` reports the state the interaction was asking for — the right
 *      view mounted, or the right month in the heading — and returns null until
 *      then.
 *   2. That signature holds still across consecutive frames. A view can paint
 *      the previous range's events and then swap them a moment later; the first
 *      paint is not the answer.
 *   3. Nothing is in the air. The calendar renders perfectly happily while
 *      still waiting on data, so the DOM alone will call a half-loaded month
 *      finished.
 *
 * Click and wait both run inside the page, so the number never includes a CDP
 * round trip. Floor is about three frames, ~50ms — an interaction reported at
 * that value is at the measurement floor, not merely fast.
 */
async function timeInteraction(
  page: Page,
  click: string,
  signature: string,
  /** The grid start of the range this interaction needs, ISO. */
  needs: string,
): Promise<{ paint: number; ms: number; block: number }> {
  return page.evaluate(
    async ({ click, signature, needs }) => {
      // The app bar and the mobile toolbar both render a view switcher and both
      // render prev/next, so a selector matches twice. Take the one actually on
      // screen — CSS, not the benchmark, decides which that is.
      const target = [...document.querySelectorAll<HTMLElement>(click)].find(
        (el) => el.getClientRects().length > 0,
      );
      if (!target) throw new Error(`no visible element for ${click}`);
      const read = new Function(`return (${signature})`)() as () => string | null;
      const STABLE_FRAMES = 3;
      const inflightFor = (globalThis as unknown as { __inflightFor?: (s: string) => number })
        .__inflightFor;
      const waiting = () => (inflightFor ? inflightFor(needs) > 0 : false);

      let blocked = 0;
      let observer: PerformanceObserver | undefined;
      try {
        observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) blocked += entry.duration;
        });
        observer.observe({ entryTypes: ["longtask"] });
      } catch {
        /* longtask unsupported */
      }

      const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
      const t0 = performance.now();
      target.click();

      const deadline = t0 + 30_000;
      let last: string | null = null;
      let held = 0;
      let settledAt = 0;
      let paintedAt = 0;
      for (;;) {
        const current = read();
        if (current !== null && paintedAt === 0) paintedAt = performance.now();
        if (current !== null && current === last && !waiting()) {
          held += 1;
          if (held === 1) settledAt = performance.now();
          if (held >= STABLE_FRAMES) break;
        } else {
          held = 0;
        }
        last = current;
        if (performance.now() > deadline) throw new Error(`timeout: ${signature}`);
        await frame();
      }

      observer?.disconnect();
      // Two numbers, because they answer different questions. `paint` is when
      // the thing you asked for is on screen and usable; `settled` is when it
      // has stopped changing and nothing is in the air. For a view that fills
      // in behind its first screenful they differ, and quoting only the second
      // would call a usable view unfinished.
      return { paint: paintedAt - t0, ms: settledAt - t0, block: blocked };
    },
    { click, signature, needs },
  );
}

/** Counts requests until `stop()` is called. */
function watch(page: Page) {
  let api = 0;
  let rsc = 0;
  const onRequest = (request: { url(): string }) => {
    const url = request.url();
    if (url.includes("/api/events")) api += 1;
    if (url.includes("_rsc=")) rsc += 1;
  };
  page.on("request", onRequest);
  return {
    stop() {
      page.off("request", onRequest);
      return { api, rsc };
    },
  };
}

const TAB = (name: string) => `[data-view-tab="${name}"]`;
/*
 * `data-nav`, not the aria-label. Matching `[aria-label^="Next "]` also matched
 * event chips — "Next President of Estonia?…" — and on a phone, where the bar's
 * own arrows are hidden and the toolbar's come after the grid in the DOM, the
 * first *visible* match was a 5px dot. The benchmark was opening an event and
 * waiting for a month that was never asked for.
 */
const NEXT = '[data-nav="next"]';
const PREV = '[data-nav="previous"]';

/**
 * Signatures. Each returns null until the asked-for state is on screen, then a
 * string that only changes if the picture changes.
 */
const READY =
  "const el = document.querySelector('[data-view]'); if (!el) return null; " +
  "const n = document.querySelectorAll('[data-event-title]').length; if (n === 0) return null;";

const settledView = (view: string) =>
  `() => { ${READY} return el.getAttribute('data-view') === '${view}' ? '${view}:' + n : null; }`;

const settledMonth = (title: string) =>
  `() => { ${READY} const h = document.querySelector('header h1'); return h && h.textContent.trim() === ${JSON.stringify(title)} ? 'm:' + n : null; }`;

/**
 * Wait for React to take over.
 *
 * The whole bar is server-rendered, so a button exists — and swallows a click —
 * before any handler is attached to it. The view switcher's sliding indicator is
 * positioned by an effect, so a `left` in its inline style is proof that client
 * effects have run. Without this the mobile runs clicked into dead HTML and sat
 * there until the timeout.
 */
async function hydrated(page: Page) {
  await page.waitForFunction(() => {
    const indicator = document.querySelector('[role="tablist"] > span[aria-hidden]');
    return Boolean(indicator?.getAttribute("style")?.includes("left"));
  });
}

async function boot(page: Page, query: string, waitIdle = true) {
  await page.goto(`${BASE}/${query}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-event-title]");
  await hydrated(page);
  if (waitIdle) {
    // Let the adjacent-month prefetch finish, so "cached" scenarios really are.
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(600);
  }
}

type Scenario = {
  name: string;
  run: (page: Page) => Promise<{ paint: number; ms: number; block: number }>;
  setup: (page: Page) => Promise<void>;
};

const SCENARIOS: Scenario[] = [
  {
    name: "September → October (cold: prefetch still in flight)",
    setup: (page) => boot(page, `?month=${MONTH}`, false),
    run: (page) => timeInteraction(page, NEXT, settledMonth(NEXT_LABEL), OCTOBER),
  },
  {
    name: "September → October (warm: prefetched)",
    setup: (page) => boot(page, `?month=${MONTH}`),
    run: (page) => timeInteraction(page, NEXT, settledMonth(NEXT_LABEL), OCTOBER),
  },
  {
    name: "October → September (cached, already visited)",
    setup: async (page) => {
      await boot(page, `?month=${MONTH}`);
      await timeInteraction(page, NEXT, settledMonth(NEXT_LABEL), OCTOBER);
      await page.waitForLoadState("networkidle").catch(() => {});
      await page.waitForTimeout(400);
    },
    run: (page) => timeInteraction(page, PREV, settledMonth(BACK_LABEL), SEPTEMBER),
  },
  {
    name: "Month → Week",
    setup: (page) => boot(page, `?month=${MONTH}`),
    run: (page) => timeInteraction(page, TAB("week"), settledView("week"), SEPTEMBER),
  },
  {
    name: "Week → Agenda",
    setup: async (page) => {
      await boot(page, `?month=${MONTH}`);
      await timeInteraction(page, TAB("week"), settledView("week"), SEPTEMBER);
      await page.waitForLoadState("networkidle").catch(() => {});
      await page.waitForTimeout(400);
    },
    run: (page) => timeInteraction(page, TAB("agenda"), settledView("agenda"), SEPTEMBER),
  },
  {
    name: "Agenda → Month",
    setup: async (page) => {
      await boot(page, `?month=${MONTH}&view=agenda`);
    },
    run: (page) => timeInteraction(page, TAB("month"), settledView("month"), SEPTEMBER),
  },
];

async function bench(browser: Browser, viewport: { width: number; height: number }) {
  const rows: Row[] = [];

  for (const scenario of SCENARIOS) {
    const samples: Sample[] = [];
    for (let i = 0; i < RUNS; i++) {
      // A fresh context per sample so the module-level range cache starts empty.
      const context = await browser.newContext({ viewport });
      await shim(context);
      const page = await context.newPage();
      try {
        await scenario.setup(page);
        const w = watch(page);
        const { paint, ms, block } = await scenario.run(page);
        await page.waitForTimeout(250);
        const { api, rsc } = w.stop();
        samples.push({ paint, ms, block, api, rsc });
      } finally {
        await context.close();
      }
    }
    rows.push({ name: scenario.name, samples });
  }

  return rows;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function report(label: string, rows: Row[]) {
  console.log(`\n=== ${label} ===`);
  console.log(
    `${"Interaction".padEnd(52)} ${"paint".padStart(7)} ${"settled".padStart(8)} ${"block".padStart(7)} ${"api".padStart(5)} ${"rsc".padStart(5)}`,
  );
  for (const row of rows) {
    const at = (pick: (s: Sample) => number) => median(row.samples.map(pick));
    console.log(
      `${row.name.padEnd(52)} ${at((s) => s.paint).toFixed(0).padStart(7)} ${at((s) => s.ms).toFixed(0).padStart(8)} ${at((s) => s.block).toFixed(0).padStart(7)} ${String(at((s) => s.api)).padStart(5)} ${String(at((s) => s.rsc)).padStart(5)}`,
    );
  }
}

async function main() {
  const browser = await chromium.launch({ executablePath: resolveChromium() });
  try {
    report("DESKTOP 1440x900", await bench(browser, { width: 1440, height: 900 }));
    report("MOBILE 390x844", await bench(browser, { width: 390, height: 844 }));
  } finally {
    await browser.close();
  }
  console.log(`\n(median of ${RUNS} runs, production build at ${BASE})`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
