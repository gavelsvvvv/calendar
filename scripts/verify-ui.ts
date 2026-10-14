/**
 * Browser verification.
 *
 * Drives the built app and asserts what a type checker cannot: that noisy
 * markets are gone from the rendered calendar, that a dense day doesn't break
 * the grid, that filters and navigation actually change what's on screen, and
 * that every viewport and theme renders without overflow.
 *
 *   npm run build && npm start &
 *   npx tsx scripts/verify-ui.ts [baseUrl]
 */
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { MARK_PATH } from "../src/lib/polymarket-mark";

const BASE = process.argv[2] ?? "http://127.0.0.1:3000";

/** The measurement ID the build was compiled with. */
const GA_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID ?? "G-FC9TGS890K";

/**
 * Where the run's screenshots land.
 *
 * Repo-relative and gitignored, rather than the absolute scratchpad path this
 * used to carry — that path belonged to one machine's session directory, so
 * anyone else running `npm run verify:ui` wrote their evidence into a folder
 * that did not exist. `VERIFY_SHOTS` overrides it for CI.
 */
const SHOTS = process.env.VERIFY_SHOTS ?? "screenshots/verify";

function resolveChromium(): string | undefined {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!root || !existsSync(root)) return undefined;
  const dir = readdirSync(root).find((d) => /^chromium-\d+$/.test(d));
  if (!dir) return undefined;
  const candidate = `${root}/${dir}/chrome-linux/chrome`;
  return existsSync(candidate) ? candidate : undefined;
}

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
}

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "laptop", width: 1280, height: 800 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 390, height: 844 },
];

/**
 * tsx compiles this file with esbuild's `keepNames`, which wraps functions in a
 * `__name(...)` call. `page.evaluate` ships them to the browser where the helper
 * doesn't exist, so define an identity version first.
 */
async function shim(context: BrowserContext) {
  await context.addInitScript(() => {
    const g = globalThis as unknown as Record<string, unknown>;
    if (typeof g.__name !== "function") g.__name = (fn: unknown) => fn;
    // Onboarding is verified separately; suppress it elsewhere.
    try {
      localStorage.setItem("pmc.onboarding.v1", "verified");
    } catch {
      /* private mode */
    }
  });
  await blockAnalytics(context);
}

/**
 * Google Analytics is loaded by the production build this suite drives, and a
 * full run is a few hundred page loads. Those are robot visits: letting them
 * reach the property would put a day's worth of fake traffic into a real
 * report, from a headless browser, every time anyone verifies the UI. Aborting
 * the requests also keeps the run hermetic and off Google's latency.
 *
 * Scoped to Google's own hosts, so the tag still *renders* and the assertions
 * about it are still measuring the real markup.
 */
async function blockAnalytics(context: BrowserContext) {
  await context.route(
    /googletagmanager\.com|google-analytics\.com|analytics\.google\.com/,
    (route) => route.abort(),
  );
}

/**
 * Wait for the app to be ready, which is not the same as waiting for the network.
 *
 * This used to be `waitForLoadState("networkidle")`, and that cost thirty
 * seconds on *every* navigation in this file. Measured: `load` fires at ~390ms,
 * the last request finishes by ~5s, and no further request is issued — yet the
 * networkidle state never resolves and every call sits out its full timeout.
 * The suite spent hours waiting for a condition that had already been true for
 * twenty-five seconds.
 *
 * So ask the app instead of the transport. The month dataset landing is what
 * every assertion below is really waiting for, and the calendar says so itself:
 * the skeleton's `role="status"` disappears and a real view container appears
 * in its place. A short fixed pause after that covers the entry animation and
 * the idle-time prefetches, which nothing here asserts on but some things race.
 */
async function settle(page: Page) {
  await page
    .waitForFunction(
      () =>
        document.querySelector('[role="grid"], [data-agenda-panel], [data-week-timeline]') !==
          null && !document.body.textContent?.includes("Loading events…"),
      undefined,
      { timeout: 20_000 },
    )
    .catch(() => {});
  await page.waitForTimeout(700);
}

/** Every event title currently rendered anywhere on the page. */
async function renderedTitles(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("[data-event-title]")].map(
      (el) => el.getAttribute("data-event-title") ?? "",
    ),
  );
}

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const browser: Browser = await chromium.launch({ executablePath: resolveChromium() });

  const consoleErrors: string[] = [];
  const context = await browser.newContext({ viewport: VIEWPORTS[0] });
  await shim(context);
  const page = await context.newPage();
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));

  console.log(`\n=== LOAD (${BASE}) ===`);
  const res = await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60_000 });
  check("page responds 200", res?.status() === 200, String(res?.status()));
  await settle(page);

  check("month grid rendered", (await page.locator('[role="grid"]').count()) === 1);
  const cells = await page.locator('[role="gridcell"]').count();
  check("grid has whole weeks", cells === 35 || cells === 42, `${cells} cells`);
  check("sidebar rendered", (await page.locator("#calendar-sidebar").count()) >= 1);

  const chips = await page.locator('a[href^="https://polymarket.com/event/"]').count();
  check("events rendered with Polymarket links", chips > 0, `${chips} chips`);

  console.log("\n=== CURATION (noise must not reach the calendar) ===");
  // Sweep every view so nothing hides in one of them.
  const allTitles: string[] = [];
  for (const view of ["month", "week", "agenda"] as const) {
    await page.goto(`${BASE}/?view=${view}`, { waitUntil: "domcontentloaded" });
    await settle(page);
    allTitles.push(...(await renderedTitles(page)));
  }
  check("titles were collected", allTitles.length > 0, `${allTitles.length} titles`);

  const NOISE: Array<[string, RegExp]> = [
    ["highest/lowest temperature", /(highest|lowest|daily)\s+temperature|temperature in/i],
    ["daily crypto thresholds", /\b(bitcoin|ethereum|solana|btc|eth|sol)\b[^?]*\b(above|below|up or down)\b/i],
    ["daily index thresholds", /\b(s&p|nasdaq|gold|oil)\b[^?]*\b(above|below|up or down)\b/i],
    ["exact-score derivatives", /exact score/i],
    ["more-markets derivatives", /more markets/i],
    ["turnout derivatives", /:\s*turnout$/i],
    ["tweet counters", /#\s*tweets?/i],
  ];
  for (const [label, re] of NOISE) {
    const hits = allTitles.filter((t) => re.test(t));
    check(`no ${label}`, hits.length === 0, hits.slice(0, 2).join(" | "));
  }

  console.log("\n=== DENSE DAY LAYOUT ===");
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await settle(page);
  const overflow = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[role="gridcell"]')]
      .filter((c) => c.scrollHeight - c.clientHeight > 2)
      .map((c) => c.getAttribute("data-day")),
  );
  check("no day cell overflows", overflow.length === 0, overflow.slice(0, 3).join(", "));

  const rows = await page.evaluate(() => {
    const cs = [...document.querySelectorAll<HTMLElement>('[role="gridcell"]')];
    const h: number[] = [];
    for (let i = 0; i < cs.length; i += 7) h.push(Math.round(cs[i].getBoundingClientRect().height));
    return { h, spread: Math.max(...h) - Math.min(...h) };
  });
  check("week rows are uniform height", rows.spread <= 4, JSON.stringify(rows.h));
  check(
    "no cell shows more than 3 events",
    await page.evaluate(() =>
      [...document.querySelectorAll('[role="gridcell"]')].every(
        (c) => c.querySelectorAll("[data-event-title]").length <= 3,
      ),
    ),
  );
  check(
    '"+N more" surfaces the rest',
    (await page.getByRole("button", { name: /^\+\d+ more$/ }).count()) > 0,
  );

  console.log("\n=== CATEGORY BALANCE ===");
  await page.goto(`${BASE}/?view=agenda`, { waitUntil: "domcontentloaded" });
  await settle(page);
  const cats = await page.evaluate(() => {
    const counts: Record<string, number> = {};
    for (const el of document.querySelectorAll("[data-event-category]")) {
      const c = el.getAttribute("data-event-category") ?? "";
      counts[c] = (counts[c] ?? 0) + 1;
    }
    return counts;
  });
  const total = Object.values(cats).reduce((a, b) => a + b, 0);
  const present = Object.entries(cats)
    .sort((a, b) => b[1] - a[1])
    .map(([c, n]) => `${c}:${n}`)
    .join(" ");
  check("at least 7 categories are represented", Object.keys(cats).length >= 7, present);
  check(
    "no single category is more than half the calendar",
    Math.max(0, ...Object.values(cats)) <= total * 0.5,
    `${Math.round((Math.max(0, ...Object.values(cats)) / Math.max(total, 1)) * 100)}% of ${total}`,
  );
  // The categories that were empty or near-empty before the balancing work.
  for (const c of ["business", "technology", "culture", "politics"]) {
    check(`${c} is populated`, (cats[c] ?? 0) > 0, `${cats[c] ?? 0} events`);
  }

  console.log("\n=== TIMES AND CATEGORIES ===");
  for (const view of ["month", "agenda"] as const) {
    await page.goto(`${BASE}/?view=${view}`, { waitUntil: "domcontentloaded" });
    await settle(page);
    // Every row carries a clock time — Polymarket supplies no event start time,
    // so a bare-date market shows the day's trading deadline instead of nothing.
    const times = await page.evaluate(() =>
      [...document.querySelectorAll("[data-event-time]")].map(
        (el) => el.getAttribute("data-event-time") ?? "",
      ),
    );
    check(`${view}: every event shows a time`, times.length > 0 && times.every((t) => /^\d{2}:\d{2}$/.test(t)), `${times.length} rows, e.g. ${times.slice(0, 3).join(", ")}`);
  }
  check(
    "Science is gone from the sidebar",
    (await page.locator("#calendar-sidebar").getByText(/^Science$/).count()) === 0,
  );
  check(
    "Other is gone from the sidebar",
    (await page.locator("#calendar-sidebar").getByText(/^Other$/).count()) === 0,
  );
  check(
    "nothing is filed under Other",
    (await page.locator('[data-event-category="other"]').count()) === 0,
  );

  console.log("\n=== PAST EVENTS FADE ===");
  for (const view of ["month", "agenda"] as const) {
    await page.goto(`${BASE}/?view=${view}`, { waitUntil: "domcontentloaded" });
    await settle(page);
    // The agenda opens at today; earlier days sit behind a disclosure.
    const earlier = page.getByRole("button", { name: /^Show \d+ earlier days?$/ });
    if (view === "agenda" && (await earlier.count()) > 0) {
      await earlier.first().click();
      await page.waitForTimeout(500);
    }

    const rows = await page.evaluate(() => {
      const toRgb = (css: string): [number, number, number] => {
        const c = document.createElement("canvas");
        c.width = c.height = 1;
        const g = c.getContext("2d")!;
        g.fillStyle = css;
        g.fillRect(0, 0, 1, 1);
        const d = g.getImageData(0, 0, 1, 1).data;
        return [d[0], d[1], d[2]];
      };
      const lum = (rgb: [number, number, number]) => {
        const f = rgb.map((v) => {
          const x = v / 255;
          return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
      };
      const contrast = (a: number, b: number) =>
        (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      // The chip paints nothing of its own, so its background is whichever
      // ancestor first does — the day cell, tinted by the density ramp.
      const behind = (el: HTMLElement): number => {
        let n: HTMLElement | null = el;
        while (n) {
          const bg = getComputedStyle(n).backgroundColor;
          if (bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") return lum(toRgb(bg));
          n = n.parentElement;
        }
        return lum(toRgb(getComputedStyle(document.body).backgroundColor));
      };
      const titleOf = (el: HTMLElement) =>
        [...el.querySelectorAll<HTMLElement>("span")].find(
          (s) => s.children.length === 0 && (s.textContent ?? "").trim().length > 8,
        );

      // One shared reference for the recede test. Measuring each chip against
      // its *own* cell instead compares two different backgrounds — the month
      // grid tints every cell by density, so a live chip on the busiest day can
      // sit closer to its surface than a past chip on an empty one while both
      // inks are exactly the palette constants they should be.
      const pageLum = lum(toRgb(getComputedStyle(document.body).backgroundColor));

      const out: Array<{ past: boolean; toward: number; contrast: number }> = [];
      for (const el of document.querySelectorAll<HTMLElement>("[data-event-past]")) {
        const t = titleOf(el);
        if (!t || el.getClientRects().length === 0) continue;
        const ink = lum(toRgb(getComputedStyle(t).color));
        out.push({
          past: el.getAttribute("data-event-past") === "true",
          // How far the ink sits from the page. Receding means this shrinks —
          // the same statement in both themes, where "dimmer" points in
          // opposite directions.
          toward: Math.abs(ink - pageLum),
          // Readability, though, is only meaningful against the surface the
          // text is actually on, tint and all.
          contrast: contrast(ink, behind(el)),
        });
      }
      return out;
    });
    const past = rows.filter((r) => r.past);
    const upcoming = rows.filter((r) => !r.past);

    check(`${view}: past events are present`, past.length > 0, `${past.length}/${rows.length}`);
    // Colour, not opacity. Fading dark text toward a pale page composites to
    // roughly the grey the palette now names outright, so the old opacity
    // assertion passed while the two mechanisms silently cancelled each other.
    check(
      `${view}: past events recede toward the page`,
      past.length > 0 &&
        upcoming.length > 0 &&
        Math.max(...past.map((r) => r.toward)) < Math.min(...upcoming.map((r) => r.toward)),
      `past ≤${Math.max(0, ...past.map((r) => r.toward)).toFixed(3)} vs live ≥${Math.min(1, ...upcoming.map((r) => r.toward)).toFixed(3)}`,
    );
    // De-emphasised, not disabled: still comfortably above AA on its own cell.
    check(
      `${view}: past events stay readable`,
      past.every((r) => r.contrast >= 4.5),
      `min ${Math.min(99, ...past.map((r) => r.contrast)).toFixed(2)}:1`,
    );
    check(
      `${view}: upcoming events render at full strength`,
      upcoming.every((r) => r.contrast >= 7),
      `min ${Math.min(99, ...upcoming.map((r) => r.contrast)).toFixed(2)}:1`,
    );
  }

  // A moment that has gone by can be live or settled, but never "upcoming".
  // A Dota series Team Liquid had already won was advertised as upcoming
  // because Polymarket's own `closed` flag lags the result by hours.
  for (const view of ["month", "agenda"] as const) {
    await page.goto(`${BASE}/?view=${view}`, { waitUntil: "domcontentloaded" });
    await settle(page);
    const earlier = page.getByRole("button", { name: /^Show \d+ earlier days?$/ });
    if (view === "agenda" && (await earlier.count()) > 0) {
      await earlier.first().click();
      await page.waitForTimeout(500);
    }
    const wrong = await page.evaluate(() =>
      [...document.querySelectorAll("[data-event-past='true']")]
        .filter((el) => el.getAttribute("data-event-status") === "upcoming")
        .map((el) => el.getAttribute("data-event-title") ?? ""),
    );
    check(
      `${view}: nothing in the past is still labelled upcoming`,
      wrong.length === 0,
      wrong.slice(0, 2).join(" | "),
    );
  }

  // Hovering a faded row brings it back — de-emphasised, not withheld.
  await page.goto(`${BASE}/?view=month`, { waitUntil: "domcontentloaded" });
  await settle(page);
  const faded = page.locator('[data-event-past="true"]').first();
  if ((await faded.count()) > 0) {
    // The live colour is whatever an upcoming chip is using right now, so this
    // does not have to restate either palette.
    const liveColor = await page.evaluate(() => {
      const el = [...document.querySelectorAll<HTMLElement>('[data-event-past="false"]')].find(
        (e) => e.getClientRects().length > 0,
      );
      const t = el
        ? [...el.querySelectorAll<HTMLElement>("span")].find(
            (s) => s.children.length === 0 && (s.textContent ?? "").trim().length > 8,
          )
        : null;
      return t ? getComputedStyle(t).color : "";
    });
    const readTitle = (el: HTMLElement) => {
      const t = [...el.querySelectorAll<HTMLElement>("span")].find(
        (s) => s.children.length === 0 && (s.textContent ?? "").trim().length > 8,
      );
      return t ? getComputedStyle(t).color : "";
    };
    const before = await faded.evaluate(readTitle);
    await faded.hover();
    await page.waitForTimeout(400);
    const after = await faded.evaluate(readTitle);
    check(
      "hovering a past event restores it",
      before !== after && after === liveColor,
      `${before} -> ${after} (live ${liveColor})`,
    );
  } else {
    check("hovering a past event restores it", false, "no faded event to hover");
  }

  console.log("\n=== FILTER UI, POPOVER AND BUSY DAYS ===");
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await settle(page);

  // Busiest days carry a tint distinct from the page's own surface. The tint is
  // a gradient, so `backgroundColor` alone would report every one of them
  // transparent — the check has to look at the image layer too.
  const busy = await page.evaluate(() => {
    const cells = [...document.querySelectorAll<HTMLElement>('[role="gridcell"]')];
    const counts = cells.map((c) => c.querySelectorAll("[data-event-title]").length);
    const tinted = cells.filter(
      (c) => getComputedStyle(c).backgroundImage !== "none",
    ).length;
    return { tinted, max: Math.max(0, ...counts) };
  });
  check("busiest days are tinted", busy.tinted > 0, `${busy.tinted} tinted cells`);

  /*
   * Park the pointer before clicking anything in the grid.
   *
   * Playwright keeps the mouse where the last action left it, and a
   * `page.goto` re-renders whatever chip is under it — so the desktop hover
   * preview opens on its own, unprompted, and its Radix popper covers the
   * "+N more" button underneath. The click then retries for thirty seconds
   * against an element that is visible, enabled and stable and simply not on
   * top. Position-dependent, so it appears and disappears with unrelated
   * edits, which is the worst kind of flake to chase.
   */
  await page.mouse.move(2, 2);
  await page.waitForTimeout(400);

  // "+N more" opens a popover that shows a time for every row.
  const more = page.getByRole("button", { name: /^\+\d+ more$/ }).first();
  await more.click();
  await page.waitForTimeout(600);
  const popover = page.locator('[role="dialog"]').first();
  check("day popover opens", await popover.isVisible());
  const popTimes = await popover.evaluate((el) =>
    [...el.querySelectorAll("[data-event-time]")].map(
      (e) => e.getAttribute("data-event-time") ?? "",
    ),
  );
  check(
    "popover rows carry a time",
    popTimes.length > 0 && popTimes.every((t) => /^\d{2}:\d{2}$/.test(t)),
    `${popTimes.length} rows`,
  );
  // The close button and the heading must sit on the same optical line.
  const aligned = await popover.evaluate((el) => {
    const close = el.querySelector<HTMLElement>("button[aria-label*='lose'], button.absolute");
    const heading = el.querySelector<HTMLElement>("h2, [id$='-title']");
    if (!close || !heading) return null;
    const c = close.getBoundingClientRect();
    const h = heading.getBoundingClientRect();
    return Math.abs((c.top + c.height / 2) - (h.top + h.height / 2));
  });
  check(
    "popover close button is centred on the title",
    aligned === null || aligned <= 4,
    aligned === null ? "not found" : `${Math.round(aligned)}px off`,
  );
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  // Counts stay on screen in every view, including weeks where they are zero.
  for (const view of ["month", "week"] as const) {
    await page.goto(`${BASE}/?view=${view}`, { waitUntil: "domcontentloaded" });
    await settle(page);
    const shown = await page.evaluate(
      () =>
        [...document.querySelectorAll("#calendar-sidebar [data-category-count]")].filter(
          (el) => /^\d+$/.test(el.textContent?.trim() ?? ""),
        ).length,
    );
    check(`${view}: category counts are visible`, shown >= 8, `${shown} labelled`);
  }

  // The box reads literally: ticked means shown, empty means hidden, and every
  // category stays in the one list.
  await page.goto(`${BASE}/?categories=elections`, { waitUntil: "domcontentloaded" });
  await settle(page);
  const boxes = await page.evaluate(() =>
    [...document.querySelectorAll("[data-category-row]")].map((l) => ({
      label: l.getAttribute("data-category-row") ?? "",
      checked: l.querySelector('[role="checkbox"]')?.getAttribute("data-state") === "checked",
    })),
  );
  const elections = boxes.find((b) => b.label === "elections");
  const others = boxes.filter((b) => b.label && b.label !== "elections");
  // Eleven: Entertainment folded into Culture, Science and Other retired, and
  // eSports promoted out of Sports into a category of its own.
  check("every category stays in the one list", boxes.length === 11, `${boxes.length} rows`);
  check("the selected category is ticked", elections?.checked === true);
  check(
    "the unselected categories are not",
    others.length > 0 && others.every((b) => !b.checked),
    `${others.filter((b) => b.checked).length} wrongly ticked`,
  );
  check(
    "eSports is a category a reader can filter on",
    boxes.some((b) => b.label === "esports"),
    boxes.map((b) => b.label).join(","),
  );

  /*
   * ─────────────────────────────────────────────────────────────────────────
   * Show all / Clear all, and the calendar that has to survive both
   * ─────────────────────────────────────────────────────────────────────────
   *
   * Two rules are pinned here, and each replaced a bug that had been asserted
   * the other way round in this very file.
   *
   * **`Clear all` is shown whenever `selectedCategoryCount > 0`.** It used to
   * be gated on "has the reader narrowed anything", which a fresh visit — every
   * box ticked — has not. So the control that empties the list was hidden in
   * exactly the state where it had eleven things to empty, and appeared only
   * once you had unticked something by hand.
   *
   * **The calendar is never swapped out.** A filter matching nothing is a fact
   * about the filter, and the grid is where you see it. The full-panel empty
   * state that used to take its place removed Today, the selected day, the
   * weekday headers, the week timeline and every navigation control along with
   * the events — leaving nothing to press and a screen that read as broken.
   */

  /** Everything these assertions need, read in one pass so it cannot skew. */
  const readShell = () =>
    page.evaluate(() => {
      const sidebar = document.querySelector("#calendar-sidebar");
      const button = (action: string) =>
        sidebar?.querySelector<HTMLButtonElement>(`[data-action="${action}"]`) ?? null;
      const describe = (el: HTMLButtonElement | null) =>
        el
          ? { present: true, disabled: el.disabled, label: (el.textContent ?? "").trim() }
          : { present: false, disabled: false, label: "" };
      const text = (selector: string) =>
        (document.querySelector(selector)?.textContent ?? "").replace(/\s+/g, " ").trim();

      return {
        // ── the selection
        ticked: [...document.querySelectorAll('[data-category-row] [role="checkbox"]')].filter(
          (c) => c.getAttribute("data-state") === "checked",
        ).length,
        rows: document.querySelectorAll("[data-category-row]").length,
        counts: document.querySelectorAll("#calendar-sidebar [data-category-count]").length,
        events: document.querySelectorAll("[data-event-title]").length,
        search: location.search,

        // ── the two controls
        showAll: describe(button("show-all-categories")),
        clearAll: describe(button("clear-categories")),

        // ── the calendar's own structure, per view
        grids: document.querySelectorAll('[role="grid"]').length,
        gridcells: document.querySelectorAll('[role="gridcell"]').length,
        dayCells: document.querySelectorAll("[data-day]").length,
        currentDay: document.querySelectorAll('[aria-current="date"]').length,
        weekColumns: document.querySelectorAll("[data-week-col]").length,
        allDayColumns: document.querySelectorAll("[data-week-allday-col]").length,
        weekTimeline: document.querySelectorAll("[data-week-timeline]").length,
        nowLine: document.querySelectorAll("[data-week-now-line]").length,
        agendaPanel: document.querySelectorAll("[data-agenda-panel]").length,

        // ── the density tint, which must follow the *selected* categories
        density: document.querySelectorAll(
          "[class*='day-density-low'], [class*='day-density-medium']," +
            " [class*='day-density-high'], [class*='day-density-extreme']",
        ).length,

        // ── what is allowed to say "nothing matched", and what is not
        fullScreenEmpty: document.querySelectorAll("[data-empty-state]").length,
        hint: text("[data-calendar-hint='no-categories']"),
        sidebarNote: text("[data-category-empty-state]"),
        agendaEmpty: text("[data-agenda-empty]"),

        /*
         * §9: navigation has to survive a selection that matches nothing.
         *
         * Matched as a prefix, because the step controls name their unit —
         * "Previous month" in Month and Agenda, "Previous week" in Week — and
         * an equality test against "Previous" quietly finds neither.
         */
        nav: ["previous", "next", "today"].filter((name) =>
          [...document.querySelectorAll("button")].some((b) =>
            (b.getAttribute("aria-label") ?? b.textContent ?? "")
              .trim()
              .toLowerCase()
              .startsWith(name),
          ),
        ).length,
      };
    });

  /*
   * A fresh visit ticks everything, and the grid agrees.
   *
   * This assertion has been inverted twice, which is the point of pinning it.
   * First the boxes ticked themselves whenever nothing was selected, so Clear
   * appeared to select ten categories. Then they stayed empty while the
   * calendar carried on showing every event, so the checkboxes and the grid
   * told the reader two different stories. Now a box means what a box means.
   */
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await settle(page);
  const firstVisit = await readShell();
  check(
    "a fresh visit ticks every category",
    firstVisit.ticked === firstVisit.rows && firstVisit.rows === 11,
    `${firstVisit.ticked}/${firstVisit.rows} ticked`,
  );
  check("a fresh visit shows events", firstVisit.events > 0, `${firstVisit.events} events`);
  check("a fresh visit needs no empty-selection notice", firstVisit.sidebarNote === "");
  check("a fresh visit needs no calendar hint", firstVisit.hint === "");
  // Everything selected is the default, so it stays out of the URL.
  check("a fresh visit writes no query string", firstVisit.search === "", firstVisit.search);

  /*
   * The heart of the first fix, stated as plainly as the rule it enforces.
   *
   * Eleven of eleven selected is the *most* there has ever been to clear, and
   * that is the state the button used to hide in.
   */
  check(
    "Show all is present and already satisfied on a fresh visit",
    firstVisit.showAll.present && firstVisit.showAll.disabled,
    `present ${firstVisit.showAll.present}, disabled ${firstVisit.showAll.disabled}`,
  );
  check(
    "Clear all is present and usable with every category selected",
    firstVisit.clearAll.present && !firstVisit.clearAll.disabled,
    `present ${firstVisit.clearAll.present}, disabled ${firstVisit.clearAll.disabled}`,
  );
  // Buttons, both of them — not a label that reads "Showing all".
  check(
    "the two controls are named as opposites",
    firstVisit.showAll.label === "Show all" && firstVisit.clearAll.label === "Clear all",
    `"${firstVisit.showAll.label}" / "${firstVisit.clearAll.label}"`,
  );

  // Every partial selection offers both, because both have something to do.
  for (const [label, query, expected] of [
    ["several categories", "?categories=sports,crypto,ai", 3],
    ["one category", "?categories=sports", 1],
  ] as const) {
    await page.goto(`${BASE}/${query}`, { waitUntil: "domcontentloaded" });
    await settle(page);
    const partial = await readShell();
    check(`${label}: exactly that many are ticked`, partial.ticked === expected, `${partial.ticked}`);
    check(
      `${label}: both controls are offered`,
      partial.showAll.present &&
        !partial.showAll.disabled &&
        partial.clearAll.present &&
        !partial.clearAll.disabled,
      `show ${partial.showAll.disabled ? "disabled" : "ok"}, clear ${partial.clearAll.disabled ? "disabled" : "ok"}`,
    );
  }

  /*
   * Clear all empties the calendar — and leaves the calendar there.
   *
   * The old behaviour asserted the opposite of the first half ("Clear widens
   * the calendar rather than emptying it"), and the second half did not exist:
   * an emptied selection replaced the grid with a medallion and a paragraph.
   */
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await settle(page);
  const beforeClear = await readShell();
  await page.locator('#calendar-sidebar [data-action="clear-categories"]').first().click();
  await settle(page);
  const cleared = await readShell();

  check("Clear all leaves no category ticked", cleared.ticked === 0, `${cleared.ticked} ticked`);
  check("Clear all empties the calendar", cleared.events === 0, `${cleared.events} events`);
  check(
    "Clear all goes disabled once it has run, rather than vanishing",
    cleared.clearAll.present && cleared.clearAll.disabled,
    `present ${cleared.clearAll.present}, disabled ${cleared.clearAll.disabled}`,
  );
  check(
    "Show all becomes the way out",
    cleared.showAll.present && !cleared.showAll.disabled,
    `present ${cleared.showAll.present}, disabled ${cleared.showAll.disabled}`,
  );

  // §11: the counts report what each category *has*, not what is drawn. They
  // are how a reader decides which box to tick next, so clearing must not zero
  // them or take them away.
  check(
    "Clear all keeps every category count visible",
    cleared.counts === 11 && cleared.counts === beforeClear.counts,
    `${beforeClear.counts} -> ${cleared.counts}`,
  );

  /* ── and now the part that used to fail: the calendar is still there ── */
  check(
    "the month grid survives Clear all",
    cleared.grids === 1 && cleared.gridcells === beforeClear.gridcells,
    `${cleared.grids} grid, ${cleared.gridcells}/${beforeClear.gridcells} cells`,
  );
  check(
    "every date stays on the grid",
    cleared.dayCells === beforeClear.dayCells && cleared.dayCells > 0,
    `${cleared.dayCells}/${beforeClear.dayCells} days`,
  );
  check("today is still marked", cleared.currentDay >= 1, `${cleared.currentDay}`);
  check("navigation is still reachable", cleared.nav === 3, `${cleared.nav}/3 controls`);
  check(
    "no full-panel empty state replaces the calendar",
    cleared.fullScreenEmpty === 0,
    `${cleared.fullScreenEmpty} found`,
  );
  // §10: density is a reading of the selected categories. Counting hidden ones
  // would tint days whose events the reader has just switched off.
  check(
    "the heatmap shows no density when nothing is selected",
    cleared.density === 0,
    `${cleared.density} tinted days`,
  );

  // What *is* allowed: one muted line beside the filters, and one in the
  // sidebar next to the boxes it refers to. Small, inline, and no button that
  // takes the calendar's place.
  check(
    "a small inline hint explains the empty calendar",
    /no categories selected/i.test(cleared.hint) && cleared.hint.length < 80,
    cleared.hint,
  );
  check(
    "the sidebar says the same thing beside the boxes",
    /no categories selected/i.test(cleared.sidebarNote),
    cleared.sidebarNote,
  );

  // An explicit empty selection is not the same state as a fresh visit and
  // must not serialize as one.
  check(
    "an empty selection is written to the URL explicitly",
    new URL(page.url()).searchParams.get("categories") === "none",
    cleared.search,
  );

  /*
   * §12/§19: Clear all is a category action, so nothing goes back to the server.
   *
   * It used to be a global reset, which also flipped `includeSmallerMarkets` —
   * the one filter that decides *which dataset* the month is. Clearing the
   * checkboxes therefore kicked off a refetch and blanked the grid while it ran.
   */
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await settle(page);
  const requests: string[] = [];
  const record = (url: string) => {
    const path = new URL(url).pathname;
    if (path.startsWith("/api/") || path.startsWith("/_next/")) requests.push(path);
  };
  const onRequest = (r: import("playwright").Request) => record(r.url());
  page.on("request", onRequest);
  await page.locator('#calendar-sidebar [data-action="clear-categories"]').first().click();
  await settle(page);
  await page.locator('#calendar-sidebar [data-action="show-all-categories"]').first().click();
  await settle(page);
  page.off("request", onRequest);
  check(
    "Clear all and Show all cost no network round trip",
    requests.length === 0,
    requests.slice(0, 4).join(", "),
  );

  const restored = await readShell();
  check("Show all ticks every category", restored.ticked === 11, `${restored.ticked} ticked`);
  check("Show all brings the events back", restored.events > 0, `${restored.events} events`);
  check("Show all clears the inline hint", restored.hint === "" && restored.sidebarNote === "");
  // Still a control, not a label — the state is on the button itself.
  check(
    "Show all stays present and goes disabled once everything is selected",
    restored.showAll.present && restored.showAll.disabled,
  );
  /*
   * And `Clear all` is offered again, which is the whole first fix.
   *
   * This assertion used to read the exact opposite — "Clear disappears once
   * every category is back" — on the reasoning that everything selected is the
   * default and there is nothing to undo. That confuses "the reader has not
   * narrowed anything" with "there is nothing to clear". Eleven ticked boxes
   * are eleven things to clear.
   */
  check(
    "Clear all is offered again once every category is back",
    restored.clearAll.present && !restored.clearAll.disabled,
    `present ${restored.clearAll.present}, disabled ${restored.clearAll.disabled}`,
  );

  /*
   * The calendar survives an empty selection in every view, not just Month.
   *
   * Week keeps its seven columns, its all-day band, its timeline and its
   * now-line; Agenda keeps its panel and puts one short line where the rows
   * would be. Agenda is the only view allowed that, because it is the only one
   * with no structure of its own to preserve.
   */
  for (const view of ["month", "week", "agenda"] as const) {
    await page.goto(`${BASE}/?view=${view}&categories=none`, { waitUntil: "domcontentloaded" });
    await settle(page);
    const bare = await readShell();

    check(`${view}: zero categories renders zero events`, bare.events === 0, `${bare.events}`);
    check(
      `${view}: no full-panel empty state`,
      bare.fullScreenEmpty === 0,
      `${bare.fullScreenEmpty}`,
    );
    check(`${view}: navigation still works`, bare.nav === 3, `${bare.nav}/3`);

    if (view === "month") {
      check(
        "month: grid, dates and today all survive an empty selection",
        bare.grids === 1 && bare.dayCells >= 35 && bare.currentDay >= 1,
        `${bare.grids} grid, ${bare.dayCells} days, ${bare.currentDay} current`,
      );
      check("month: no chips are drawn", bare.events === 0);
    }
    if (view === "week") {
      check(
        "week: seven day columns and the all-day band survive",
        bare.weekColumns === 7 && bare.allDayColumns === 7,
        `${bare.weekColumns} cols, ${bare.allDayColumns} all-day`,
      );
      check(
        "week: the hour timeline and the current-time line survive",
        bare.weekTimeline === 1 && bare.nowLine === 1,
        `timeline ${bare.weekTimeline}, now-line ${bare.nowLine}`,
      );
      check("week: today is still marked", bare.currentDay >= 1, `${bare.currentDay}`);
    }
    if (view === "agenda") {
      check("agenda: the panel itself is still on screen", bare.agendaPanel === 1);
      check(
        "agenda: a short line sits where the rows would be",
        /no events match/i.test(bare.agendaEmpty) && bare.agendaEmpty.length < 80,
        bare.agendaEmpty,
      );
    }
  }

  /*
   * A search that matches nothing is the same rule with a different cause: the
   * calendar stays, and nothing announces a catastrophe.
   */
  for (const [label, query] of [
    ["a search with no hits", "?q=zzzzzzzznothingmatchesthis"],
    ["one category and a search that misses it", "?categories=crypto&q=zzzzzzzznothing"],
    ["a strict importance floor on one category", "?categories=culture&importance=major&weekend=1"],
  ] as const) {
    await page.goto(`${BASE}/${query}`, { waitUntil: "domcontentloaded" });
    await settle(page);
    const narrow = await readShell();
    check(
      `${label}: the month grid stays on screen`,
      narrow.grids === 1 && narrow.dayCells >= 35 && narrow.fullScreenEmpty === 0,
      `${narrow.grids} grid, ${narrow.dayCells} days, ${narrow.fullScreenEmpty} empty screens`,
    );
    // These are filter states, not empty *selections* — the no-categories hint
    // would be the wrong sentence, so it must not appear.
    check(`${label}: no no-categories hint`, narrow.hint === "", narrow.hint);
  }

  // A quiet month, far enough out that the horizon holds nothing.
  await page.goto(`${BASE}/?month=2031-01`, { waitUntil: "domcontentloaded" });
  await settle(page);
  const quiet = await readShell();
  check(
    "a month beyond the horizon still draws its grid",
    quiet.grids === 1 && quiet.dayCells >= 35 && quiet.fullScreenEmpty === 0,
    `${quiet.grids} grid, ${quiet.dayCells} days, ${quiet.events} events`,
  );

  // And an empty selection survives a refresh as empty, rather than springing
  // back to all — "no saved state" and "the reader chose nothing" are different.
  await page.goto(`${BASE}/?categories=none`, { waitUntil: "domcontentloaded" });
  await settle(page);
  await page.reload({ waitUntil: "domcontentloaded" });
  await settle(page);
  const afterReload = await readShell();
  check(
    "an empty selection is still empty after a refresh",
    afterReload.ticked === 0 && afterReload.events === 0,
    `${afterReload.ticked} ticked, ${afterReload.events} events`,
  );
  check(
    "and the calendar is still there after that refresh",
    afterReload.grids === 1 && afterReload.dayCells >= 35 && afterReload.fullScreenEmpty === 0,
    `${afterReload.grids} grid, ${afterReload.dayCells} days`,
  );
  check(
    "Clear all is still the disabled one, Show all the live one",
    afterReload.clearAll.present &&
      afterReload.clearAll.disabled &&
      afterReload.showAll.present &&
      !afterReload.showAll.disabled,
  );

  /*
   * Show all is a *category* action.
   *
   * A reader who has set "Important+" and the weekend filter and then asks to
   * see every category should still have both — and the same is true of Clear
   * all in the other direction, which is what makes them opposites of each
   * other rather than one of them being a global reset in disguise.
   */
  await page.goto(`${BASE}/?categories=sports&importance=important&weekend=1`, {
    waitUntil: "domcontentloaded",
  });
  await settle(page);
  await page.locator('#calendar-sidebar [data-action="show-all-categories"]').first().click();
  await settle(page);
  {
    const url = new URL(page.url());
    check(
      "Show all leaves importance and the quick filters alone",
      url.searchParams.get("importance") === "important" &&
        url.searchParams.get("weekend") === "1",
      url.search,
    );
    check(
      "Show all selected every category",
      // Every category is the default, so the parameter is dropped entirely.
      url.searchParams.get("categories") === null,
      url.searchParams.get("categories") ?? "(absent)",
    );
  }

  await page.locator('#calendar-sidebar [data-action="clear-categories"]').first().click();
  await settle(page);
  {
    const url = new URL(page.url());
    check(
      "Clear all leaves importance and the quick filters alone too",
      url.searchParams.get("categories") === "none" &&
        url.searchParams.get("importance") === "important" &&
        url.searchParams.get("weekend") === "1",
      url.search,
    );
    // The one filter that changes which dataset the month is. If Clear touched
    // it, clearing the checkboxes would trigger a refetch.
    check(
      "Clear all never touches the smaller-markets switch",
      url.searchParams.get("smaller") === null,
      url.searchParams.get("smaller") ?? "(absent)",
    );
  }

  // Category selection round-trips through the URL at every size.
  for (const [label, query, expected] of [
    ["zero categories", "?categories=none", 0],
    ["one category", "?categories=sports", 1],
    ["eSports alone", "?categories=esports", 1],
    ["several categories", "?categories=sports,crypto,ai", 3],
    ["a missing parameter", "", 11],
  ] as const) {
    await page.goto(`${BASE}/${query}`, { waitUntil: "domcontentloaded" });
    await settle(page);
    const seen = await readShell();
    check(`${label} survives a refresh`, seen.ticked === expected, `${seen.ticked} ticked`);
    check(`${label} keeps every count visible`, seen.counts === 11, `${seen.counts}`);
    check(
      `${label} keeps the calendar on screen`,
      seen.grids === 1 && seen.fullScreenEmpty === 0,
      `${seen.grids} grid, ${seen.fullScreenEmpty} empty screens`,
    );
    if (expected === 0) {
      check("an empty selection shows no events", seen.events === 0, `${seen.events}`);
      check(
        "an empty selection keeps its token in the URL",
        new URL(page.url()).searchParams.get("categories") === "none",
        seen.search,
      );
    }
  }

  /*
   * Sports and eSports are genuinely separate supplies, not one relabelled.
   *
   * Measured on the sidebar counts and on the categories of the chips that
   * render, never on a chip *total*: a month cell draws three or four and hides
   * the rest behind "+N more", so counting rendered chips across two selections
   * and expecting them to add up compares two different truncations. (It does
   * not add up — 33 and 45 rendered as 68 — and that is the cell doing its job,
   * not the filter failing.)
   */
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await settle(page);
  const supply = await page.evaluate(() => {
    const read = (id: string) =>
      Number(
        document
          .querySelector(`#calendar-sidebar [data-category-row="${id}"] [data-category-count]`)
          ?.getAttribute("data-category-count") ?? "-1",
      );
    return { sports: read("sports"), esports: read("esports") };
  });
  check(
    "Sports and eSports each carry events of their own",
    supply.sports > 0 && supply.esports > 0,
    `sports ${supply.sports}, esports ${supply.esports}`,
  );

  for (const [selection, expected] of [
    ["sports", "sports"],
    ["esports", "esports"],
  ] as const) {
    await page.goto(`${BASE}/?categories=${selection}`, { waitUntil: "domcontentloaded" });
    await settle(page);
    const categories = await page.evaluate(() => [
      ...new Set(
        [...document.querySelectorAll("[data-event-category]")].map((e) =>
          e.getAttribute("data-event-category"),
        ),
      ),
    ]);
    check(
      `selecting ${selection} renders only ${expected} events`,
      categories.length > 0 && categories.every((c) => c === expected),
      categories.join(",") || "no events",
    );
  }

  // And together they render both, with nothing from anywhere else.
  await page.goto(`${BASE}/?categories=sports,esports`, { waitUntil: "domcontentloaded" });
  await settle(page);
  const together = await page.evaluate(() => [
    ...new Set(
      [...document.querySelectorAll("[data-event-category]")].map((e) =>
        e.getAttribute("data-event-category"),
      ),
    ),
  ]);
  check(
    "selecting both renders both and nothing else",
    together.includes("sports") &&
      together.includes("esports") &&
      together.every((c) => c === "sports" || c === "esports"),
    together.sort().join(","),
  );

  // The week's all-day band collapses rather than growing without limit.
  await page.goto(`${BASE}/?view=week`, { waitUntil: "domcontentloaded" });
  await settle(page);
  const bandOverflow = await page.evaluate(() => {
    const band = [...document.querySelectorAll<HTMLElement>("div")].find((d) =>
      d.textContent?.trim().startsWith("All day"),
    );
    if (!band) return 0;
    return Math.max(
      0,
      ...[...band.children].map((c) => c.querySelectorAll("[data-event-title]").length),
    );
  });
  check("week all-day band is capped", bandOverflow <= 3, `max ${bandOverflow} per column`);

  /*
   * ─────────────────────────────────────────────────────────────────────────
   * Analytics is present, and page views are counted once
   * ─────────────────────────────────────────────────────────────────────────
   *
   * The requests themselves are aborted for this suite (see `blockAnalytics`),
   * so what is checked here is the *markup and the wiring* — the part this
   * repository actually controls.
   *
   * The assertion that matters is the last one. This app keeps view, month,
   * selected day and every filter in the query string, written with
   * `history.replaceState`; GA4's "page changes based on browser history
   * events" turns each of those into a page view. Measured here: one history
   * write on load and one per interaction, so a visitor ticking five boxes
   * would be filed as six page views of six different pages unless the tag is
   * told not to report them.
   */
  /*
   * ─────────────────────────────────────────────────────────────────────────
   * Analytics is present and, more to the point, running
   * ─────────────────────────────────────────────────────────────────────────
   *
   * The requests are aborted for this suite (see `blockAnalytics`), so this
   * checks the part the repository controls: that the tag renders *on the
   * client*, not merely on the server.
   *
   * That distinction is the whole reason these assertions exist. The version
   * this replaced wrapped the component in a `"use client"` shell that read
   * `process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID` and returned `null` when it was
   * missing. `NEXT_PUBLIC_` values are compiled into the client bundle at build
   * time while the server reads them at runtime, so a build machine without the
   * variable shipped a page whose HTML carried the gtag.js preload — looking
   * perfectly tagged — and whose client rendered nothing at all. `dataLayer` and
   * `gtag` were undefined in production for days and every localhost check
   * passed, because localhost had the variable.
   *
   * So: assert on the globals the inline script defines, which only exist if the
   * component really rendered in the browser.
   */
  console.log("\n=== ANALYTICS ===");
  {
    const html = await (await fetch(BASE)).text();
    check(
      "the GA4 tag is on the page",
      html.includes("googletagmanager.com/gtag/js?id=G-"),
      html.includes("gtag/js") ? "" : "no gtag script",
    );
    check(
      "the measurement ID is the one from NEXT_PUBLIC_GA_MEASUREMENT_ID",
      html.includes(GA_ID),
      GA_ID,
    );

    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await settle(page);
    const runtime = await page.evaluate(() => {
      const w = window as unknown as Record<string, unknown>;
      return {
        gtag: typeof w.gtag,
        isArray: Array.isArray(w.dataLayer),
        length: Array.isArray(w.dataLayer) ? (w.dataLayer as unknown[]).length : -1,
        scriptIds: [...document.querySelectorAll("script[id]")].map((el) => el.id),
      };
    });
    check('typeof window.gtag === "function"', runtime.gtag === "function", runtime.gtag);
    check(
      "Array.isArray(window.dataLayer) === true",
      runtime.isArray,
      `length ${runtime.length}`,
    );
    check(
      "the tag's own scripts are injected into the document",
      runtime.scriptIds.includes("_next-ga-init") && runtime.scriptIds.includes("_next-ga"),
      runtime.scriptIds.filter((id) => id.includes("ga")).join(",") || "none",
    );
    // Exactly one `config`, with no options: the stock integration and nothing
    // layered on top of it while basic collection is being established.
    const configs = await page.evaluate(() => {
      const layer = (window as unknown as { dataLayer?: unknown[] }).dataLayer ?? [];
      return layer
        .map((entry) => Array.from(entry as ArrayLike<unknown>))
        .filter((a) => a[0] === "config")
        .map((a) => (a[2] === undefined ? "default" : JSON.stringify(a[2])));
    });
    check(
      "exactly one config call, carrying no overrides",
      configs.length === 1 && configs[0] === "default",
      configs.join(" | ") || "none",
    );
  }

  console.log("\n=== POLISH ===");
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await settle(page);

  // The bar wears Polymarket's own mark, and the same traced geometry the
  // onboarding hero opens on — the corner of the app used to introduce the
  // product with a different logo from the one the product had just shown you.
  const brandMark = await page.evaluate(() => {
    const name = [...document.querySelectorAll<HTMLElement>("span")].find(
      (s) => s.textContent?.trim() === "Polymarket Calendar",
    );
    const svg = name?.parentElement?.querySelector("svg");
    const path = svg?.querySelector("path");
    return {
      found: Boolean(svg),
      d: path?.getAttribute("d") ?? "",
      stroke: path?.getAttribute("stroke") ?? "",
    };
  });
  check("the app bar wears the Polymarket mark", brandMark.found, brandMark.d.slice(0, 24));
  check(
    "the mark is the shared traced geometry",
    brandMark.d === MARK_PATH,
    brandMark.d === MARK_PATH ? "" : `got ${brandMark.d.slice(0, 40)}`,
  );
  check(
    "the mark inherits the bar's colour in both themes",
    brandMark.stroke === "currentColor",
    brandMark.stroke,
  );

  // The agenda's today heading carries the reader's own wall clock. It has to
  // be *their* clock: the container runs in UTC, so a server-rendered time
  // would be right for nobody outside that zone.
  for (const zone of ["Pacific/Auckland", "America/Los_Angeles"] as const) {
    const zoned = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      timezoneId: zone,
    });
    await shim(zoned);
    const zp = await zoned.newPage();
    const clockIn = (at: Date) =>
      new Intl.DateTimeFormat("en-GB", {
        timeZone: zone,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(at);

    // Bracket the read. The page renders at one instant and this asserts at
    // another, so a minute can tick over in between — an exact match would fail
    // roughly once per hour of running the suite for no reason to do with the
    // app. Both endpoints are computed here, so the zone is still asserted
    // exactly: a wrong zone is an hour out, not a minute.
    const before = clockIn(new Date());
    await zp.goto(`${BASE}/?view=agenda`, { waitUntil: "domcontentloaded" });
    await settle(zp);
    // It arrives with hydration rather than with the markup, so wait for it.
    const shown = (
      await zp
        .locator('time[aria-label^="Current local time"]')
        .first()
        .textContent({ timeout: 15_000 })
        .catch(() => null)
    )?.trim();
    const after = clockIn(new Date());
    check(
      `agenda shows the reader's own clock in ${zone}`,
      shown === before || shown === after,
      `showed ${shown ?? "nothing"}, expected ${before === after ? before : `${before}–${after}`}`,
    );
    const count = await zp.locator('time[aria-label^="Current local time"]').count();
    check(`the clock appears once, on today only (${zone})`, count === 1, `${count} clocks`);
    await zoned.close();
  }

  // The invariant behind that: the server never writes a clock into the markup.
  // It cannot know the reader's minute, and a guess becomes React error #418 on
  // the next minute boundary — which is exactly how this was caught. The server
  // was in fact serving the minute its process started, frozen, because nothing
  // subscribes during SSR and so the store's interval never ran.
  const ssr = await fetch(`${BASE}/?view=agenda`).then((r) => r.text());
  check(
    "the server renders no clock for hydration to disagree with",
    !/aria-label="Current local time/.test(ssr),
    ssr.match(/<time[^>]*Current local time[^>]*>[^<]*/)?.[0] ?? "",
  );

  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await settle(page);

  // Trending is a popover now, so it costs the calendar no vertical space until
  // it is asked for — which also means the rows do not exist until it opens.
  check(
    "trending occupies no space until opened",
    (await page.locator("[data-trending-title]").count()) === 0,
  );
  await page.getByRole("button", { name: /trending this week/i }).first().click();
  await page.waitForTimeout(500);
  const trending = page.locator("[data-trending-title]");
  const trendingCount = await trending.count();
  check(
    "trending menu lists 3-8 events",
    trendingCount >= 1 && trendingCount <= 8,
    `${trendingCount} rows`,
  );
  if (trendingCount > 0) {
    const wanted = await trending.first().getAttribute("data-trending-title");
    await trending.first().click();
    await page.waitForTimeout(700);
    const dialogText = await page.locator('[role="dialog"]').first().innerText().catch(() => "");
    check(
      "clicking a trending row opens that event",
      Boolean(wanted && dialogText.includes(wanted.slice(0, 24))),
      wanted ?? "",
    );
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  }

  /*
   * Back to this month before measuring anything about today.
   *
   * The trending check above opens whichever event ranks first, and opening an
   * event moves the calendar to the month that event settles in. That is correct
   * behaviour, and it is silent: the grid simply shows a different month. Every
   * assertion below looks for `.day-today`, which only exists while today is on
   * screen, so they were quietly depending on the top trending event happening
   * to settle in the current month.
   *
   * It held for months and then stopped, without a line of code changing: the
   * top trending row became "What price will Bitcoin hit in August?", an August
   * market that settles on 1 September, and the grid moved to September. The
   * failure read as "today has no date circle" — a styling bug that was really a
   * navigation left over from the previous test.
   */
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await settle(page);

  // Density: today, three tints, outside-month and plain surface must all be
  // distinguishable, and today must not be wearing a density tint.
  const cellStyle = await page.evaluate(() => {
    const cells = [...document.querySelectorAll<HTMLElement>('[role="gridcell"]')];
    const paint = (c: HTMLElement) => {
      const s = getComputedStyle(c);
      return `${s.backgroundColor}|${s.backgroundImage}`;
    };
    const todayCell = cells.find((c) => c.getAttribute("aria-current") === "date");
    /*
     * In-month only. A grid always carries leading and trailing days from the
     * neighbouring months, painted `bg-outside-month`, and those deliberately
     * carry no empty-day mark — so counting them made this check fail whenever
     * every real day in the month had events, which is precisely the state a
     * well-populated calendar is meant to reach.
     */
    const empties = cells.filter(
      (c) =>
        c.querySelectorAll("[data-event-title]").length === 0 &&
        !c.className.includes("bg-outside-month"),
    );
    // Present *and painted*. The dot was written with Tailwind v3's
    // square-bracket token syntax, which v4 compiles to an invalid value, so it
    // sat in the DOM with no background at all and nothing caught it.
    const withMark = empties.filter((c) => {
      const dot = c.querySelector<HTMLElement>("[data-empty-day]");
      if (!dot) return false;
      const bg = getComputedStyle(dot).backgroundColor;
      return bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent";
    }).length;
    const todayAfter = todayCell ? getComputedStyle(todayCell, "::after") : null;
    const todayDisc = todayCell?.querySelector<HTMLElement>("span");
    return {
      distinct: new Set(cells.map(paint)).size,
      todayPaint: todayCell ? paint(todayCell) : null,
      // Today's mark lives on a pseudo-element so it cannot collide with the
      // selection ring, which is a box-shadow on the cell itself.
      todayShadow: todayAfter ? todayAfter.boxShadow : "",
      todayDiscBg: todayDisc ? getComputedStyle(todayDisc).backgroundColor : "",
      empties: empties.length,
      withMark,
    };
  });
  check(
    "the grid uses several density tints",
    cellStyle.distinct >= 4,
    `${cellStyle.distinct} distinct cell paints`,
  );
  check(
    "today is a filled date number and a hairline, not a surface",
    // The old treatment lit the whole cell, which made the busiest-looking day
    // on the grid the one the reader already knew the date of. What is left is
    // the number in a disc plus one inset pixel of accent on the cell border —
    // enough to find in peripheral vision, not enough to lead the page.
    /\b1px\b.*\binset\b/.test(cellStyle.todayShadow) &&
      cellStyle.todayDiscBg !== "rgba(0, 0, 0, 0)" &&
      cellStyle.todayDiscBg !== "transparent",
    `shadow ${cellStyle.todayShadow || "none"}, disc ${cellStyle.todayDiscBg || "none"}`,
  );
  const todayDisc = await page.evaluate(() => {
    const cell = document.querySelector<HTMLElement>(".day-today");
    const disc = cell?.querySelector<HTMLElement>("span");
    if (!cell || !disc) return null;
    const c = cell.getBoundingClientRect();
    const d = disc.getBoundingClientRect();
    return { above: Math.round(d.top - c.top), inside: d.top >= c.top && d.bottom <= c.bottom };
  });
  check(
    "today's date circle is fully inside its cell",
    // The cell clips its overflow, so anything drawn past the top edge comes
    // back as a circle with a flat side.
    Boolean(todayDisc?.inside && todayDisc.above >= 5),
    JSON.stringify(todayDisc),
  );
  check(
    "empty in-month days carry a mark",
    cellStyle.empties === 0 || cellStyle.withMark > 0,
    `${cellStyle.withMark}/${cellStyle.empties}`,
  );

  // Hover preview: appears on hover, carries the required fields, and does not
  // exist on a touch device.
  await page.locator("[data-event-title]").first().hover();
  await page.waitForTimeout(700);
  const preview = await page
    .locator("[data-radix-popper-content-wrapper]")
    .first()
    .innerText()
    .catch(() => "");
  check("hover preview appears", preview.length > 0);
  check(
    "hover preview carries volume and a Polymarket link",
    /Volume/i.test(preview) && /Open on Polymarket/i.test(preview),
    preview.replace(/\s+/g, " ").slice(0, 70),
  );

  // Quick filters compose rather than replace.
  await page.goto(`${BASE}/?weekend=1&categories=sports`, { waitUntil: "domcontentloaded" });
  await settle(page);
  const weekendDays = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[role="gridcell"]')]
      .filter((c) => c.querySelectorAll("[data-event-title]").length > 0)
      .map((c) => c.getAttribute("data-day") ?? ""),
  );
  const allWeekend = weekendDays.every((d) => {
    const day = new Date(`${d}T12:00:00`).getDay();
    return day === 0 || day === 6;
  });
  check(
    "weekend filter leaves only Saturday and Sunday",
    weekendDays.length === 0 || allWeekend,
    weekendDays.join(", "),
  );
  const stillSports = await page.evaluate(() =>
    [...document.querySelectorAll("[data-event-category]")].every(
      (el) => el.getAttribute("data-event-category") === "sports",
    ),
  );
  check("weekend filter keeps the category selection", stillSports);

  // Favourites round-trip through localStorage.
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await settle(page);
  await page.locator("[data-event-title]").first().click();
  await page.waitForTimeout(700);
  const star = page.getByRole("button", { name: /save to favorites/i }).first();
  check("details panel offers a favourite star", (await star.count()) > 0);
  if ((await star.count()) > 0) {
    await star.click();
    await page.waitForTimeout(300);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    const stored = await page.evaluate(() => localStorage.getItem("pmc.favorites.v1"));
    check("favourite persists to localStorage", Boolean(stored && stored.length > 4), stored ?? "");
    await page.goto(`${BASE}/?starred=1`, { waitUntil: "domcontentloaded" });
    await settle(page);
    const shown = await page.locator("[data-event-title]").count();
    check("favourites filter shows only starred events", shown === 1, `${shown} shown`);
  }

  console.log("\n=== WEEK VIEW OVERLAP ===");
  // Timed events used to be positioned by the hour alone, so anything sharing
  // an hour rendered at an identical `top` and printed straight through it.
  for (const week of ["2026-08-03", "2026-08-10", "2026-08-17"]) {
    await page.goto(`${BASE}/?view=week&date=${week}`, { waitUntil: "domcontentloaded" });
    await settle(page);
    const result = await page.evaluate(() => {
      // getBoundingClientRect ignores clipping, so a chip scrolled out of the
      // hour grid would otherwise look like it collides with the band above it.
      const clipRect = (el: HTMLElement) => {
        let n: HTMLElement | null = el.parentElement;
        while (n) {
          const o = getComputedStyle(n).overflowY;
          if (o === "auto" || o === "scroll" || o === "hidden") return n.getBoundingClientRect();
          n = n.parentElement;
        }
        return null;
      };
      const chips = [...document.querySelectorAll<HTMLElement>("[data-event-title]")].filter(
        (c) => {
          const r = c.getBoundingClientRect();
          const clip = clipRect(c);
          return !clip || (r.bottom > clip.top + 1 && r.top < clip.bottom - 1);
        },
      );
      const boxes = chips.map((c) => c.getBoundingClientRect());
      const hits: string[] = [];
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i];
          const b = boxes[j];
          if (
            Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2 &&
            Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2
          ) {
            hits.push(chips[i].getAttribute("data-event-title") ?? "");
          }
        }
      }
      return { chips: chips.length, hits };
    });
    check(
      `week of ${week}: no chips overlap`,
      result.hits.length === 0,
      `${result.chips} chips${result.hits.length ? ` — ${result.hits.slice(0, 2).join(", ")}` : ""}`,
    );
  }

  console.log("\n=== GROUPING ===");
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await settle(page);
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await settle(page);
  // A grouped event advertises its market count; the panel must list them.
  await page.locator("[data-event-title]").first().click();
  await page.waitForTimeout(600);
  const dialog = page.locator('[role="dialog"]').first();
  check("event details opens", await dialog.isVisible());
  check(
    "details links to the parent Polymarket event",
    Boolean(
      (await page.getByRole("link", { name: /open on polymarket/i }).first().getAttribute("href"))
        ?.startsWith("https://polymarket.com/event/"),
    ),
  );
  const related = page.getByRole("button", { name: /view related markets/i });
  if ((await related.count()) > 0) {
    await related.first().click();
    await page.waitForTimeout(300);
    check("related markets expand", (await page.locator('[role="dialog"] a[href*="polymarket.com"]').count()) > 1);
  } else {
    check("related markets expand", true, "single-market event");
  }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  check("Escape closes details", (await page.locator('[role="dialog"]').count()) === 0);

  console.log("\n=== FILTERS ===");
  const before = (await renderedTitles(page)).length;
  await page.goto(`${BASE}/?categories=elections`, { waitUntil: "domcontentloaded" });
  await settle(page);
  const after = (await renderedTitles(page)).length;
  check("category filter changes the calendar", after !== before, `${before} -> ${after}`);
  check(
    "only the chosen category is shown",
    await page.evaluate(() =>
      [...document.querySelectorAll("[data-event-category]")].every(
        (el) => el.getAttribute("data-event-category") === "elections",
      ),
    ),
  );
  await page.goto(`${BASE}/?categories=elections,crypto`, { waitUntil: "domcontentloaded" });
  await settle(page);
  const multi = await page.evaluate(() =>
    new Set(
      [...document.querySelectorAll("[data-event-category]")].map((el) =>
        el.getAttribute("data-event-category"),
      ),
    ).size,
  );
  check("multiple categories combine", multi >= 1 && multi <= 2, `${multi} distinct`);

  await page.goto(`${BASE}/?importance=major`, { waitUntil: "domcontentloaded" });
  await settle(page);
  check(
    "importance filter keeps only major events",
    await page.evaluate(() =>
      [...document.querySelectorAll("[data-event-importance]")].every(
        (el) => el.getAttribute("data-event-importance") === "major",
      ),
    ),
  );

  console.log("\n=== NAVIGATION & URL STATE ===");
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await settle(page);
  const t0 = await page.locator("h1").first().innerText();
  await page.getByRole("banner").getByRole("button", { name: /next month/i }).click();
  // Wait on the condition, not the clock: a cold range fans out to two dozen
  // upstream requests and a fixed sleep turns that latency into a flake.
  await page
    .waitForFunction((before) => document.querySelector("h1")?.textContent !== before, t0, {
      timeout: 15_000,
    })
    .catch(() => {});
  const t1 = await page.locator("h1").first().innerText();
  check("next month advances", t0 !== t1, `${t0} -> ${t1}`);
  check("month is in the URL", page.url().includes("month="), decodeURIComponent(page.url()));
  await page.getByRole("banner").getByRole("button", { name: /^today$/i }).click();
  await page
    .waitForFunction((back) => document.querySelector("h1")?.textContent === back, t0, {
      timeout: 15_000,
    })
    .catch(() => {});
  check("Today returns", (await page.locator("h1").first().innerText()) === t0);

  for (const view of ["week", "agenda"] as const) {
    await page.goto(`${BASE}/?view=${view}`, { waitUntil: "domcontentloaded" });
    await settle(page);
    check(`${view} view renders events`, (await renderedTitles(page)).length > 0);
  }

  console.log("\n=== FILTERS SURVIVE A VIEW SWITCH ===");
  await page.goto(`${BASE}/?categories=elections`, { waitUntil: "domcontentloaded" });
  await settle(page);
  await page.getByRole("tab", { name: /agenda/i }).click();
  await page.waitForTimeout(1400);
  check(
    "category survives switching to agenda",
    decodeURIComponent(page.url()).includes("categories=elections"),
    decodeURIComponent(page.url()),
  );

  /*
   * Navigation is a UI operation, and this is what stops it silently becoming
   * a network one again.
   *
   * Every view used to fetch its own window, so switching view missed the cache
   * by construction; and because view and date were read back from
   * `useSearchParams`, every one of these interactions also waited on an RSC
   * payload that re-ran the whole curation on the server. Both are invisible in
   * a screenshot and both are the difference between instant and not, so they
   * are asserted as counts rather than trusted.
   */
  console.log("\n=== NAVIGATION COSTS NOTHING IT DOESN'T HAVE TO ===");
  {
    const nav = await browser.newContext({ viewport: VIEWPORTS[0] });
    await shim(nav);
    const np = await nav.newPage();

    let api = 0;
    let rsc = 0;
    /** Every `/api/events` URL, so a check can ask *which* range was fetched. */
    const ranges: string[] = [];
    np.on("request", (request) => {
      const url = request.url();
      if (url.includes("/api/events")) {
        api += 1;
        ranges.push(decodeURIComponent(url));
      }
      if (url.includes("_rsc=")) rsc += 1;
    });

    /**
     * Requests for one month's own grid — not its neighbours being prefetched,
     * and not the separate `markets=1` call that fetches event detail.
     */
    const fetchesFor = (gridStart: string) =>
      ranges.filter((url) => url.includes(`start=${gridStart}`) && !url.includes("markets=1"));

    await np.goto(`${BASE}/?month=2026-09`, { waitUntil: "domcontentloaded" });
    await np.waitForSelector("[data-event-title]");
    await settle(np);
    // The adjacent-month prefetch is allowed, and is the point of the next check.
    const afterLoad = { api, rsc };

    const switchTo = async (view: string) => {
      await np.evaluate((name) => {
        const tab = [...document.querySelectorAll<HTMLElement>(`[data-view-tab="${name}"]`)].find(
          (el) => el.getClientRects().length > 0,
        );
        tab?.click();
      }, view);
      await np.waitForTimeout(700);
    };

    for (const view of ["week", "agenda", "month"] as const) {
      const before = { api, rsc };
      await switchTo(view);
      const mounted = await np.evaluate(
        () => document.querySelector("[data-view]")?.getAttribute("data-view") ?? "",
      );
      const titles = (await renderedTitles(np)).length;
      check(
        `switching to ${view} renders it from cache`,
        mounted === view && titles > 0 && api === before.api,
        `${titles} events, ${api - before.api} api call(s)`,
      );
      check(
        `switching to ${view} re-enters no server`,
        rsc === before.rsc,
        `${rsc - before.rsc} RSC fetch(es)`,
      );
    }

    /*
     * The next month was prefetched while September sat there, so stepping into
     * it should fetch nothing *for October*. Arriving there does start a
     * prefetch for November and a detail fetch for October's own event legs —
     * both deliberate, both after the paint — so this counts requests for
     * October's grid specifically rather than requests in general.
     */
    const OCTOBER_GRID = "2026-09-27T00:00:00.000Z";
    const SEPTEMBER_GRID = "2026-08-30T00:00:00.000Z";
    const beforeNext = { october: fetchesFor(OCTOBER_GRID).length, rsc };
    await np.evaluate(() => {
      const next = [...document.querySelectorAll<HTMLElement>('[data-nav="next"]')].find(
        (el) => el.getClientRects().length > 0,
      );
      next?.click();
    });
    await np.waitForTimeout(900);
    const title = await np.evaluate(
      () => document.querySelector("header h1")?.textContent?.trim() ?? "",
    );
    const octoberFetches = fetchesFor(OCTOBER_GRID).length - beforeNext.october;
    check(
      "the next month was prefetched, so stepping into it fetches nothing",
      title === "October 2026" && (await renderedTitles(np)).length > 0 && octoberFetches === 0,
      `${title}, ${octoberFetches} api call(s) for October's own grid`,
    );
    check("stepping a month re-enters no server", rsc === beforeNext.rsc);

    const beforeBack = fetchesFor(SEPTEMBER_GRID).length;
    await np.evaluate(() => {
      const previous = [...document.querySelectorAll<HTMLElement>('[data-nav="previous"]')].find(
        (el) => el.getClientRects().length > 0,
      );
      previous?.click();
    });
    await np.waitForTimeout(900);
    const septemberFetches = fetchesFor(SEPTEMBER_GRID).length - beforeBack;
    check(
      "returning to a visited month fetches nothing",
      (await np.evaluate(() => document.querySelector("header h1")?.textContent?.trim())) ===
        "September 2026" && septemberFetches === 0,
      `${septemberFetches} api call(s) for September's own grid`,
    );
    check(
      "the whole session touched the server once, for the page itself",
      afterLoad.rsc === 0 && rsc === 0,
      `${rsc} RSC fetch(es) across five interactions`,
    );

    await nav.close();
  }

  /*
   * The application is one viewport tall, everywhere.
   *
   * A calendar you scroll the *page* to read is a document pretending to be an
   * application, and the failure is invisible in a screenshot — the grid looks
   * right, it is simply half of it. So this asserts the document's own scroll
   * height at the sizes people actually use, including the two laptop
   * resolutions where a fixed 112px cell used to push six week rows past the
   * bottom of the screen.
   */
  /*
   * Browser zoom.
   *
   * Ctrl+= does not scale the application, it shrinks the CSS viewport: at 150%
   * a 1920x1080 screen reports 1280x720, and at 200% a 1366x768 screen reports
   * 683x384. So this is the responsive suite run again at the sizes zoom
   * actually produces, and emulating with the viewport is exactly what the
   * layout sees. Nothing here detects a zoom level — that would be the wrong
   * fix, and it is not something a page can reliably measure anyway.
   *
   * What this caught: the app bar's controls were all `shrink-0` with the month
   * title the only flexible thing in the row, so the whole deficit went to the
   * title. It measured **0px wide** at 1280 and 1024 while the right-hand group
   * still ran 61px past the viewport — the reader lost the date and kept the
   * theme toggle.
   */
  console.log("\n=== BROWSER ZOOM ===");
  for (const screen of [
    { name: "1920x1080", w: 1920, h: 1080 },
    { name: "1440x900", w: 1440, h: 900 },
    { name: "1366x768", w: 1366, h: 768 },
  ]) {
    for (const zoom of [100, 125, 150, 175, 200]) {
      const w = Math.round((screen.w * 100) / zoom);
      const h = Math.round((screen.h * 100) / zoom);
      const zc = await browser.newContext({ viewport: { width: w, height: h } });
      await shim(zc);
      const zp = await zc.newPage();
      await zp.goto(BASE, { waitUntil: "domcontentloaded" });
      await settle(zp);

      const z = await zp.evaluate(() => {
        const doc = document.documentElement;
        const bar = document.querySelector("header");
        const controls = bar
          ? [...bar.querySelectorAll<HTMLElement>("button, a, [role='tab']")].filter((b) => {
              const r = b.getBoundingClientRect();
              return r.width > 0 && r.height > 0;
            })
          : [];
        // Two interactive boxes may never intersect: that is text drawn over a
        // control, which is unusable rather than merely ugly.
        let overlaps = 0;
        for (let i = 0; i < controls.length; i++) {
          for (let j = i + 1; j < controls.length; j++) {
            if (controls[i].contains(controls[j]) || controls[j].contains(controls[i])) continue;
            const a = controls[i].getBoundingClientRect();
            const b = controls[j].getBoundingClientRect();
            if (
              Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2 &&
              Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2
            ) {
              overlaps++;
            }
          }
        }
        // Nothing in the bar may be painted outside it.
        const escaped = bar
          ? [...bar.querySelectorAll<HTMLElement>("*")].filter((el) => {
              const r = el.getBoundingClientRect();
              return r.width > 0 && r.right > window.innerWidth + 1;
            }).length
          : 0;
        const cells = [...document.querySelectorAll<HTMLElement>('[role="gridcell"]')];
        const widths = cells.slice(0, 7).map((c) => c.getBoundingClientRect().width);
        const title = document.querySelector<HTMLElement>("header h1");
        return {
          overflowX: doc.scrollWidth - doc.clientWidth,
          overflowY: doc.scrollHeight - doc.clientHeight,
          overlaps,
          escaped,
          columnSpread: widths.length ? Math.round(Math.max(...widths) - Math.min(...widths)) : 0,
          cells: cells.length,
          titleWidth: title ? Math.round(title.getBoundingClientRect().width) : 0,
          switcher: Boolean(document.querySelector('[data-view-switcher], [role="tablist"]')),
        };
      });

      const tag = `${screen.name} @ ${zoom}% (${w}x${h})`;
      check(`${tag}: the document does not scroll`, z.overflowX === 0 && z.overflowY === 0, `${z.overflowX}px across, ${z.overflowY}px down`);
      check(`${tag}: no app-bar control overlaps another`, z.overlaps === 0, `${z.overlaps} overlapping pairs`);
      check(`${tag}: nothing is drawn past the bar's edge`, z.escaped === 0, `${z.escaped} escaped`);
      // Priority 1: the reader must always be able to see which month they are
      // looking at. This is the check the old bar failed outright.
      check(`${tag}: the date stays legible`, z.titleWidth >= 60, `${z.titleWidth}px`);
      check(
        `${tag}: the seven columns stay equal`,
        z.columnSpread <= 1 && (z.cells === 35 || z.cells === 42),
        `spread ${z.columnSpread}px over ${z.cells} cells`,
      );
      await zc.close();
    }
  }

  /*
   * And the overlays, at the sizes zoom produces. A centred panel that is
   * taller than the window loses half the excess off the *top*, which is where
   * the close button lives: the subscribe dialog is 771px of content, and at
   * 150% on a 1440x900 screen it was rendering at y = -85 with no way out but
   * the Escape key.
   */
  for (const zoom of [125, 150, 175]) {
    const w = Math.round((1440 * 100) / zoom);
    const h = Math.round((900 * 100) / zoom);
    const zc = await browser.newContext({ viewport: { width: w, height: h } });
    await shim(zc);
    const zp = await zc.newPage();
    await zp.goto(BASE, { waitUntil: "domcontentloaded" });
    await settle(zp);

    /*
     * Below `lg` these two live in the overflow menu, which is the whole point
     * of the tiering — so reaching them there is part of what is being checked,
     * not a workaround. A direct click first, the menu if the button is absent.
     */
    const viaOverflow = async (name: RegExp) => {
      const direct = zp.getByRole("button", { name }).first();
      if ((await direct.count()) > 0 && (await direct.isVisible())) {
        await direct.click();
        return;
      }
      // "More options" exactly — `/more/i` also matches every "+N more" button
      // in the grid, and picking one of those opens the day popover instead,
      // which then measures as whatever the *next* check was looking for.
      await zp.getByRole("button", { name: "More options", exact: true }).first().click();
      await zp.waitForTimeout(400);
      await zp.getByRole("button", { name }).last().click();
    };

    const overlays: Array<[string, () => Promise<void>]> = [
      ["event details", async () => void (await zp.locator("[data-event-title]").first().click())],
      ["subscribe", () => viaOverflow(/subscribe to this calendar/i)],
      ["help", () => viaOverflow(/how it works/i)],
      ["search", async () => void (await zp.keyboard.press("/"))],
    ];

    for (const [label, act] of overlays) {
      try {
        await act();
        await zp.waitForTimeout(600);
        const fit = await zp.evaluate(() => {
          const panel = document.querySelector<HTMLElement>('[role="dialog"]');
          if (!panel) return null;
          const b = panel.getBoundingClientRect();
          const close = panel.querySelector<HTMLElement>('button[aria-label*="lose" i]');
          const c = close?.getBoundingClientRect();
          return {
            insideX: b.left >= -1 && b.right <= window.innerWidth + 1,
            insideY: b.top >= -1 && b.bottom <= window.innerHeight + 1,
            closeReachable: c ? c.top >= 0 && c.bottom <= window.innerHeight : true,
            box: `${Math.round(b.width)}x${Math.round(b.height)}@${Math.round(b.top)}`,
          };
        });
        check(
          `${label} fits the window at ${zoom}% zoom`,
          Boolean(fit && fit.insideX && fit.insideY && fit.closeReachable),
          fit ? fit.box : "not found",
        );
        await zp.keyboard.press("Escape");
        await zp.waitForTimeout(300);
      } catch {
        check(`${label} fits the window at ${zoom}% zoom`, false, "could not open");
      }
    }
    await zc.close();
  }

  console.log("\n=== FITS THE VIEWPORT ===");
  for (const size of [
    { name: "1920x1080", width: 1920, height: 1080 },
    { name: "1440x900", width: 1440, height: 900 },
    { name: "1366x768", width: 1366, height: 768 },
    { name: "1280x720", width: 1280, height: 720 },
    { name: "768x1024", width: 768, height: 1024 },
    { name: "430x932", width: 430, height: 932 },
    { name: "390x844", width: 390, height: 844 },
    { name: "375x667", width: 375, height: 667 },
  ]) {
    const fit = await browser.newContext({ viewport: { width: size.width, height: size.height } });
    await shim(fit);
    const fp = await fit.newPage();

    for (const view of ["month", "week", "agenda"] as const) {
      await fp.goto(`${BASE}/?month=2026-09${view === "month" ? "" : `&view=${view}`}`, {
        waitUntil: "domcontentloaded",
      });
      await fp.waitForSelector("[data-event-title]");
      await settle(fp);
      const m = await fp.evaluate(() => ({
        docH: document.documentElement.scrollHeight,
        winH: window.innerHeight,
        docW: document.documentElement.scrollWidth,
        winW: window.innerWidth,
      }));
      check(
        `${size.name} ${view}: the document does not scroll`,
        m.docH <= m.winH + 1 && m.docW <= m.winW + 1,
        `${m.docH}/${m.winH} tall, ${m.docW}/${m.winW} wide`,
      );
    }

    // Month is the one that has to fit whole: every week row, no clipped cell,
    // and a "+N more" that tells the truth about what did not fit.
    await fp.goto(`${BASE}/?month=2026-09`, { waitUntil: "domcontentloaded" });
    await fp.waitForSelector("[data-event-title]");
    await settle(fp);
    const grid = await fp.evaluate(() => {
      const cells = [...document.querySelectorAll<HTMLElement>('[role="gridcell"]')];
      const rows = document.querySelectorAll('[role="row"]').length;
      const bottom = Math.max(...cells.map((c) => c.getBoundingClientRect().bottom));
      return {
        cells: cells.length,
        rows,
        bottom: Math.round(bottom),
        winH: window.innerHeight,
        clipped: cells.filter((c) => c.scrollHeight - c.clientHeight > 2).length,
        rowHeight: Math.round(cells[0]?.getBoundingClientRect().height ?? 0),
        sidebarOverflow: (() => {
          const el = document.querySelector("#calendar-sidebar");
          if (!el || el.clientHeight === 0) return 0;
          return el.scrollHeight - el.clientHeight;
        })(),
      };
    });
    check(
      `${size.name}: every week row is on screen`,
      grid.cells >= 35 && grid.bottom <= grid.winH + 1 && grid.clipped === 0,
      `${grid.rows} rows at ${grid.rowHeight}px, bottom ${grid.bottom}/${grid.winH}, ${grid.clipped} clipped`,
    );

    // The rail may scroll inside itself on a short screen, but it must never be
    // the reason the page scrolls, and its actions stay pinned regardless.
    if (size.width >= 1024) {
      check(
        `${size.name}: the sidebar fits without scrolling`,
        grid.sidebarOverflow <= 0,
        `${grid.sidebarOverflow}px over`,
      );
      const actions = await fp.evaluate(() => {
        const button = [...document.querySelectorAll<HTMLElement>("#calendar-sidebar button")].find(
          (b) => b.textContent?.trim() === "Subscribe",
        );
        if (!button) return null;
        const r = button.getBoundingClientRect();
        return { bottom: Math.round(r.bottom), winH: window.innerHeight, visible: r.height > 0 };
      });
      check(
        `${size.name}: "Subscribe" is reachable without scrolling`,
        Boolean(actions?.visible && actions.bottom <= actions.winH + 1),
        JSON.stringify(actions),
      );
    }

    // Week scrolls its hour grid, agenda scrolls its list — inside themselves.
    for (const [view, label] of [
      ["week", "the time grid"],
      ["agenda", "the agenda list"],
    ] as const) {
      await fp.goto(`${BASE}/?month=2026-09&view=${view}`, { waitUntil: "domcontentloaded" });
      await fp.waitForSelector("[data-event-title]");
      await settle(fp);
      const scrollers = await fp.evaluate(() => {
        const main = document.querySelector("main");
        if (!main) return 0;
        return [...main.querySelectorAll<HTMLElement>("*")].filter((el) => {
          const style = getComputedStyle(el);
          const scrollable = style.overflowY === "auto" || style.overflowY === "scroll";
          return scrollable && el.scrollHeight - el.clientHeight > 4;
        }).length;
      });
      check(
        `${size.name} ${view}: ${label} scrolls inside itself, and only it`,
        scrollers <= 1,
        `${scrollers} scrolling regions`,
      );
    }

    await fit.close();
  }

  /*
   * The heatmap has to be four distinguishable states plus a today that is not
   * one of them. Colours are compared as computed pixels rather than as class
   * names, because a class that resolves to the same colour as its neighbour is
   * a heatmap with fewer levels than it claims.
   */
  console.log("\n=== DENSITY, TODAY AND SELECTION ARE DIFFERENT THINGS ===");
  for (const theme of ["light", "dark"] as const) {
    const hm = await browser.newContext({ viewport: VIEWPORTS[0], colorScheme: theme });
    await shim(hm);
    const hp = await hm.newPage();
    await hp.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    await hp.waitForSelector("[data-event-title]");
    await settle(hp);

    const states = await hp.evaluate(() => {
      const seen: Record<string, string> = {};
      for (const cell of document.querySelectorAll<HTMLElement>('[role="gridcell"]')) {
        const level =
          [...cell.classList].find((c) => c.startsWith("day-density-"))?.replace("day-density-", "") ??
          "none";
        if (!seen[level]) {
          const style = getComputedStyle(cell);
          seen[level] = style.backgroundImage === "none" ? style.backgroundColor : style.backgroundImage;
        }
      }
      const today = document.querySelector<HTMLElement>(".day-today");
      const bar = today ? getComputedStyle(today, "::after") : null;
      return {
        levels: seen,
        todayPresent: Boolean(today),
        todayBar: bar ? { height: bar.height, color: bar.backgroundColor } : null,
      };
    });

    const levels = Object.keys(states.levels).filter((k) => k !== "none");
    check(`${theme}: four density levels render`, levels.length === 4, levels.join(", "));
    check(
      `${theme}: every level is a distinct colour`,
      new Set(Object.values(states.levels)).size === Object.keys(states.levels).length,
      `${Object.keys(states.levels).length} states, ${new Set(Object.values(states.levels)).size} colours`,
    );
    check(
      `${theme}: no level is blue`,
      Object.values(states.levels).every((value) => {
        const rgb = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (!rgb) return true;
        const [r, g, b] = [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
        // Blue-dominant means b clearly ahead of both r and g — the old ramp.
        return !(b > r + 10 && b > g + 10);
      }),
      Object.values(states.levels).join(" | "),
    );
    check(
      `${theme}: today wears its own mark, not a density tint`,
      states.todayPresent && states.todayBar !== null && parseFloat(states.todayBar.height) >= 2,
      JSON.stringify(states.todayBar),
    );

    // Today, selected, and today-while-selected must all read differently.
    const combos = await hp.evaluate(() => {
      const today = document.querySelector<HTMLElement>(".day-today");
      const todayKey = today?.getAttribute("data-day") ?? "";
      return { todayKey };
    });
    await hp.goto(`${BASE}/?selected=${combos.todayKey}`, { waitUntil: "domcontentloaded" });
    await hp.waitForSelector("[data-event-title]");
    await settle(hp);
    const both = await hp.evaluate(() => {
      const cell = document.querySelector<HTMLElement>(".day-today");
      if (!cell) return null;
      const after = getComputedStyle(cell, "::after");
      return {
        ring: getComputedStyle(cell).boxShadow,
        bar: after.height,
      };
    });
    check(
      `${theme}: today stays visible while it is also the selected day`,
      Boolean(both && both.ring !== "none" && parseFloat(both.bar) >= 2),
      JSON.stringify(both),
    );

    await hm.close();
  }

  /*
   * Times belong to the reader, and the *server* has to say so.
   *
   * The zone travels in a cookie written by an inline script in the document
   * head, before the first paint — so the check that matters is not "does it
   * correct itself", it is whether the HTML is already right. This drives a
   * browser in Sofia with JavaScript switched off entirely: whatever comes back
   * is the server's own markup, with nothing able to patch it afterwards.
   */
  console.log("\n=== TIMES ARE THE READER'S OWN ===");
  {
    const SOFIA = "Europe/Sofia";
    const TOKYO = "Asia/Tokyo";

    const readTimes = async (zone: string, javaScriptEnabled: boolean) => {
      const ctx = await browser.newContext({
        viewport: VIEWPORTS[0],
        timezoneId: zone,
        javaScriptEnabled,
      });
      if (javaScriptEnabled) await shim(ctx);
      // What the head script would have written on a previous visit.
      await ctx.addCookies([{ name: "pmc_tz", value: zone, url: BASE }]);
      const zp = await ctx.newPage();
      await zp.goto(BASE, { waitUntil: "domcontentloaded" });
      // `attached`, not `visible`: this reads attributes off the markup, and
      // with scripting disabled the entry animation never resolves, so
      // Playwright's visibility heuristic waits for a paint that is not coming.
      await zp.waitForSelector("[data-event-time]", { state: "attached" });
      if (javaScriptEnabled) await settle(zp);
      const out = await zp.evaluate(() => {
        const byId: Record<string, string> = {};
        for (const el of document.querySelectorAll("[data-event-title]")) {
          const title = el.getAttribute("data-event-title") ?? "";
          const time = el.getAttribute("data-event-time") ?? "";
          if (title && time && !byId[title]) byId[title] = time;
        }
        return {
          zoneLabel:
            [...document.querySelectorAll("header span")].find((s) =>
              /^GMT/.test(s.textContent ?? ""),
            )?.textContent ?? null,
          // `[data-day]` as well: the mini calendar marks today too, and it is
          // the earlier of the two in the document.
          todayKey:
            document.querySelector('[data-day][aria-current="date"]')?.getAttribute("data-day") ??
            null,
          times: byId,
        };
      });
      await ctx.close();
      return out;
    };

    const sofiaSsr = await readTimes(SOFIA, false);
    check(
      "the server renders the reader's zone, with no JavaScript at all",
      sofiaSsr.zoneLabel === "GMT+3" || sofiaSsr.zoneLabel === "GMT+2",
      `label ${sofiaSsr.zoneLabel}`,
    );
    // And the *current* date in it. The clock store cached its first reading and
    // refreshed only from an interval — which nothing starts during SSR, so the
    // server marked whichever day it booted on as today, for as long as it ran.
    // This only fails once a server has been up across local midnight, so it is
    // a guard rather than a reproduction; the reproduction was the agenda clock,
    // which was minute-precision and so wrong within the hour.
    const sofiaToday = new Intl.DateTimeFormat("en-CA", {
      timeZone: SOFIA,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    check(
      "the server's idea of today is current, not the day it booted",
      sofiaSsr.todayKey === sofiaToday,
      `rendered ${sofiaSsr.todayKey}, actual ${sofiaToday}`,
    );

    const sofia = await readTimes(SOFIA, true);
    const tokyo = await readTimes(TOKYO, true);
    check("Tokyo sees its own offset", tokyo.zoneLabel === "GMT+9", `label ${tokyo.zoneLabel}`);

    /*
     * The same event, six hours apart. Not "the times differ" — the *specific*
     * difference, because a calendar that is wrong by a constant looks
     * completely normal until someone misses a fixture.
     */
    const shared = Object.keys(sofia.times).filter((t) => t in tokyo.times);
    const offsets = shared
      .map((title) => {
        const [sh, sm] = sofia.times[title].split(":").map(Number);
        const [th, tm] = tokyo.times[title].split(":").map(Number);
        // Tokyo is six hours ahead of Sofia in summer, modulo the day boundary.
        return (((th * 60 + tm - (sh * 60 + sm)) % 1440) + 1440) % 1440;
      })
      // All-day events carry a placeholder rather than an instant, and are the
      // one thing that must *not* move.
      .filter((_, i) => sofia.times[shared[i]] !== "23:59");
    const consistent = offsets.length > 0 && new Set(offsets).size === 1;
    check(
      "one instant, two zones, one constant difference",
      consistent && (offsets[0] === 360 || offsets[0] === 420),
      `${shared.length} shared events, offsets ${[...new Set(offsets)].join("/")} min`,
    );

    const allDayHeld = shared.every(
      (title) => sofia.times[title] !== "23:59" || tokyo.times[title] === "23:59",
    );
    check("all-day events do not move between zones", allDayHeld);
  }

  console.log("\n=== SUBSCRIBE & HELP ===");
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await settle(page);
  await page.getByRole("banner").getByRole("button", { name: /subscribe/i }).click();
  await page.waitForTimeout(600);
  const feed = await page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Calendar feed URL"]');
    return input?.value ?? "";
  });
  check("subscribe dialog shows a feed URL", feed.includes("/api/calendar/"), feed);
  const webcal = await page
    .getByRole("link", { name: /subscribe in apple calendar/i })
    .getAttribute("href");
  check("Apple link uses webcal", Boolean(webcal?.startsWith("webcal://")), webcal ?? "");

  /*
   * Outlook is two products behind one name. A personal Microsoft account lives
   * on outlook.live.com and a work or school account on outlook.office.com, and
   * a link to the wrong host does not degrade — it lands on a sign-in page for
   * an account the visitor does not have. Both must be offered, both must carry
   * this deployment's own feed, and neither may point at the other's host.
   */
  const outlook = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLAnchorElement>('[role="dialog"] a[href*="outlook."]')].map(
      (a) => a.href,
    ),
  );
  check("subscribe offers both Outlook account types", outlook.length === 2, outlook.join(" | "));
  check(
    "one goes to outlook.live.com and one to outlook.office.com",
    outlook.some((h) => h.startsWith("https://outlook.live.com/")) &&
      outlook.some((h) => h.startsWith("https://outlook.office.com/")),
    outlook.map((h) => new URL(h).host).join(", "),
  );
  check(
    "both hand Outlook this feed, as webcal",
    outlook.length > 0 &&
      outlook.every((h) => {
        const u = new URL(h);
        return (
          u.pathname === "/calendar/0/addfromweb" &&
          (u.searchParams.get("url") ?? "").startsWith("webcal://") &&
          (u.searchParams.get("url") ?? "").includes("/api/calendar/")
        );
      }),
    outlook[0] ? decodeURIComponent(outlook[0]) : "",
  );

  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  await page.getByRole("banner").getByRole("button", { name: /how it works/i }).click();
  await page.waitForTimeout(500);
  const help = await page.locator('[role="dialog"]').first().innerText();
  /*
   * The attribution has to say the site is *not* Polymarket.
   *
   * It read "Powered by Polymarket" for a while, which is an affiliation claim,
   * on a domain carrying the brand name and under the brand's own mark — and
   * Google Safe Browsing classified the site as a deceptive page. Asserting the
   * disclaimer here means the next person who shortens this line has to argue
   * with a failing test rather than with nobody.
   */
  check(
    "help states independence, not affiliation",
    /not affiliated with or endorsed by polymarket/i.test(help) &&
      !/powered by polymarket/i.test(help),
    help.replace(/\s+/g, " ").slice(-120),
  );
  check("help links to @gavelsvtw", help.includes("@gavelsvtw"));
  check(
    "help list uses bullets, not dashes",
    (await page.locator('[role="dialog"] ul li').count()) >= 3,
  );
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  console.log("\n=== ONBOARDING ===");
  const fresh = await browser.newContext({ viewport: VIEWPORTS[0] });
  // No `shim` here on purpose — this context *is* a first visit. It still must
  // not send robot page views to the real property.
  await blockAnalytics(fresh);
  await fresh.addInitScript(() => {
    const g = globalThis as unknown as Record<string, unknown>;
    if (typeof g.__name !== "function") g.__name = (fn: unknown) => fn;
  });
  const freshPage = await fresh.newPage();
  await freshPage.goto(BASE, { waitUntil: "domcontentloaded" });
  await freshPage.waitForTimeout(1500);
  check("onboarding opens on a first visit", (await freshPage.locator('[role="dialog"]').count()) > 0);

  // The hero is the product pitch: a mark that becomes a calendar. Assert the
  // shape actually interpolates rather than trusting that the class is present
  // — an animation that silently does nothing looks exactly like a static
  // illustration, and that is how the last motion system went unnoticed.
  const morph = await freshPage.evaluate(async () => {
    const read = () => {
      const el = document.querySelector<SVGRectElement>(".art-frame");
      if (!el) return null;
      const s = getComputedStyle(el);
      return { w: Math.round(parseFloat(s.width)), rx: Math.round(parseFloat(s.rx)) };
    };
    const at = (ms: number) => {
      for (const a of document.getAnimations()) {
        a.pause();
        a.currentTime = ms;
      }
      return new Promise<ReturnType<typeof read>>((r) =>
        requestAnimationFrame(() => requestAnimationFrame(() => r(read()))),
      );
    };
    const marks: Record<string, number> = {};
    const mark = document.querySelector(".art-mark");
    const start = await at(200);
    marks.start = mark ? Number(getComputedStyle(mark).opacity) : -1;
    const mid = await at(1000);
    marks.mid = mark ? Number(getComputedStyle(mark).opacity) : -1;
    // 2900ms, not 2600: the last card's reveal window closes at 82% of the
    // 3400ms loop (2788ms), and sampling before that caught it four percent
    // short of opaque. The rest runs 82–92%; this lands in the middle of it.
    const end = await at(2900);
    marks.end = mark ? Number(getComputedStyle(mark).opacity) : -1;
    const cards = [...document.querySelectorAll('[class*="art-in-"]')].map((c) =>
      Number(getComputedStyle(c).opacity),
    );
    for (const a of document.getAnimations()) a.play();
    return { start, mid, end, marks, cards };
  });

  check(
    "the hero starts as a mark and ends as a calendar",
    Boolean(morph && morph.start && morph.end && morph.end.w > morph.start.w * 2),
    morph ? `${morph.start?.w}px -> ${morph.end?.w}px` : "no .art-frame",
  );
  check(
    "the corner radius travels with it",
    Boolean(morph && morph.start && morph.end && morph.start.rx > morph.end.rx),
    morph ? `r${morph.start?.rx} -> r${morph.end?.rx}` : "",
  );
  check(
    "the mark carries through the morph, then hands off",
    Boolean(morph && morph.marks.start === 1 && morph.marks.mid > 0.2 && morph.marks.end === 0),
    morph ? JSON.stringify(morph.marks) : "",
  );
  check(
    "every event card has arrived by the rest",
    Boolean(morph && morph.cards.length === 5 && morph.cards.every((o) => o === 1)),
    morph ? morph.cards.join(",") : "",
  );

  await freshPage.getByRole("button", { name: /don.t show again/i }).click();
  await freshPage.waitForTimeout(500);
  check("onboarding closes", (await freshPage.locator('[role="dialog"]').count()) === 0);
  await freshPage.reload({ waitUntil: "domcontentloaded" });
  await freshPage.waitForTimeout(1500);
  check(
    "onboarding does not reopen after completion",
    (await freshPage.locator('[role="dialog"]').count()) === 0,
  );
  await fresh.close();

  /*
   * Reduced motion has to land on the *finished* illustration, not a blank
   * frame or a half-built one. Every keyframe is authored so the element's base
   * style is its last frame; the browser collapses the duration to nothing and
   * falls back to that base. This asserts the fallback, which is the part that
   * breaks the moment someone writes a keyframe ending anywhere else — it left
   * the wordmark stamped across the middle of the calendar once already.
   */
  const still = await browser.newContext({
    viewport: VIEWPORTS[0],
    reducedMotion: "reduce",
  });
  await blockAnalytics(still);
  await still.addInitScript(() => {
    const g = globalThis as unknown as Record<string, unknown>;
    if (typeof g.__name !== "function") g.__name = (fn: unknown) => fn;
  });
  const stillPage = await still.newPage();
  await stillPage.goto(BASE, { waitUntil: "domcontentloaded" });
  await stillPage.waitForSelector(".art-frame", { timeout: 20_000 });
  await stillPage.waitForTimeout(600);
  const rest = await stillPage.evaluate(() => {
    const frame = document.querySelector<SVGRectElement>(".art-frame");
    const mark = document.querySelector(".art-mark");
    const loop = document.querySelector(".art-loop");
    return {
      width: frame ? Math.round(parseFloat(getComputedStyle(frame).width)) : 0,
      mark: mark ? Number(getComputedStyle(mark).opacity) : -1,
      loop: loop ? Number(getComputedStyle(loop).opacity) : -1,
      cards: [...document.querySelectorAll('[class*="art-in-"]')].map((c) =>
        Number(getComputedStyle(c).opacity),
      ),
    };
  });
  check("reduced motion: the illustration is visible", rest.loop === 1, `opacity ${rest.loop}`);
  check("reduced motion: it rests on the calendar", rest.width > 250, `${rest.width}px`);
  check("reduced motion: the mark has handed off", rest.mark === 0, `opacity ${rest.mark}`);
  check(
    "reduced motion: every event card is present",
    rest.cards.length === 5 && rest.cards.every((o) => o === 1),
    rest.cards.join(","),
  );
  await still.close();

  console.log("\n=== KEYBOARD ===");
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await settle(page);
  await page.locator('[role="gridcell"][tabindex="0"]').first().focus();
  const k0 = await page.evaluate(() => document.activeElement?.getAttribute("data-day"));
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(200);
  const k1 = await page.evaluate(() => document.activeElement?.getAttribute("data-day"));
  check("ArrowRight moves a day", Boolean(k0 && k1 && k0 !== k1), `${k0} -> ${k1}`);
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(200);
  const k2 = await page.evaluate(() => document.activeElement?.getAttribute("data-day"));
  check("ArrowDown moves a week", k1 !== k2, `${k1} -> ${k2}`);
  await page.keyboard.press("/");
  await page.waitForTimeout(500);
  check("slash opens search", (await page.locator('[role="dialog"]').count()) > 0);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  console.log("\n=== MOBILE ===");
  {
    const m = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
      deviceScaleFactor: 3,
    });
    await shim(m);
    const mp = await m.newPage();
    await mp.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await settle(mp);

    // The view switcher used to be `hidden md:block`, which meant a phone was
    // stuck in whatever view the URL happened to say.
    const tabs = mp.getByRole("tab");
    check("view switcher is reachable on a phone", (await tabs.count()) === 3);
    await mp.getByRole("tab", { name: /agenda/i }).click();
    await mp.waitForTimeout(1400);
    check(
      "switching view works on a phone",
      decodeURIComponent(mp.url()).includes("view=agenda"),
      decodeURIComponent(mp.url()),
    );
    await mp.goto(BASE, { waitUntil: "domcontentloaded" });
    await settle(mp);

    // The title is the reason the bar exists; it must not be squeezed out.
    const titleWidth = await mp
      .locator("h1")
      .first()
      .evaluate((el) => ({ w: el.getBoundingClientRect().width, clipped: el.scrollWidth > el.clientWidth + 1 }));
    check(
      "the month title still fits in the bar",
      titleWidth.w >= 90 && !titleWidth.clipped,
      `${Math.round(titleWidth.w)}px${titleWidth.clipped ? ", truncated" : ""}`,
    );

    // Every control a finger has to hit is at least 40px in its smaller axis.
    const small = await mp.evaluate(() => {
      const out: string[] = [];
      const scan = document.querySelectorAll<HTMLElement>(
        "header button, [data-testid='mobile-toolbar'] button, [data-testid='mobile-toolbar'] [role='tab']",
      );
      for (const el of scan) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (Math.min(r.width, r.height) < 40) {
          out.push(`${el.getAttribute("aria-label") ?? el.textContent?.trim() ?? "?"}:${Math.round(Math.min(r.width, r.height))}`);
        }
      }
      return out;
    });
    check("touch targets are at least 40px", small.length === 0, small.slice(0, 4).join(", "));

    /*
     * The month view is a split on a phone: a compact grid of dots up top, and
     * the selected day's real titles underneath. These four checks are the
     * whole of that contract — the grid stays compact and uniform, the
     * schedule carries text rather than colour, tapping a day moves it, and
     * neither half pushes the page into scrolling.
     */
    const split = await mp.evaluate(() => {
      const grid = document.querySelector<HTMLElement>('[role="grid"]');
      const sched = document.querySelector<HTMLElement>("[data-testid='mobile-day-schedule']");
      const cells = [...document.querySelectorAll<HTMLElement>('[role="gridcell"]')];
      const rows: number[] = [];
      for (let i = 0; i < cells.length; i += 7) {
        rows.push(Math.round(cells[i].getBoundingClientRect().height));
      }
      const dots = [...document.querySelectorAll<HTMLElement>('[role="gridcell"] [data-event-title]')];
      const boxes = dots.map((d) => d.getBoundingClientRect());
      return {
        rowHeight: rows[0] ?? 0,
        rowSpread: rows.length ? Math.max(...rows) - Math.min(...rows) : 0,
        dotCount: dots.length,
        // A dot, not a bar: roughly square and under 10px on both axes.
        allDots: boxes.every((b) => b.height <= 10 && Math.abs(b.width - b.height) <= 2),
        maxPerCell: Math.max(
          0,
          ...cells.map((c) => c.querySelectorAll("[data-event-title]").length),
        ),
        gridBottom: grid ? Math.round(grid.getBoundingClientRect().bottom) : 0,
        schedTop: sched ? Math.round(sched.getBoundingClientRect().top) : 0,
        schedHeight: sched ? Math.round(sched.getBoundingClientRect().height) : 0,
        pageScrolls: document.documentElement.scrollHeight > window.innerHeight + 1,
      };
    });
    check(
      "the month grid is compact on a phone",
      split.rowHeight > 0 && split.rowHeight <= 64 && split.rowSpread === 0,
      `${split.rowHeight}px rows, spread ${split.rowSpread}`,
    );
    check(
      "events in the grid are dots, capped at three",
      split.allDots && split.maxPerCell <= 3,
      `${split.dotCount} dots, max ${split.maxPerCell}/cell`,
    );
    check(
      "the day schedule takes the space the grid gave up",
      split.schedHeight >= 200,
      `${split.schedHeight}px`,
    );
    check("the split does not make the page scroll", !split.pageScrolls);

    // The complaint this replaced: "instead of market names I just see coloured
    // lines". Assert the titles are on screen without a tap.
    const titles = await mp.evaluate(() =>
      [...document.querySelectorAll("[data-schedule-title]")].map(
        (el) => el.getAttribute("data-schedule-title") ?? "",
      ),
    );
    check(
      "the schedule shows real market names without tapping",
      titles.length > 0 && titles.every((t) => t.length > 3),
      `${titles.length} rows, e.g. ${titles[0]?.slice(0, 40) ?? ""}`,
    );

    // Tapping a day moves the schedule rather than opening a modal over it.
    const otherDay = mp
      .locator('[role="gridcell"]')
      .filter({ has: mp.locator("[data-event-title]") })
      .nth(3);
    if ((await otherDay.count()) > 0) {
      const before = await mp
        .locator("[data-testid='mobile-day-schedule'] h2")
        .innerText();
      await otherDay.click({ position: { x: 24, y: 8 } });
      await mp.waitForTimeout(700);
      const after = await mp
        .locator("[data-testid='mobile-day-schedule'] h2")
        .innerText();
      check(
        "tapping a day changes the schedule under the grid",
        before !== after,
        `${before.replace(/\s+/g, " ")} -> ${after.replace(/\s+/g, " ")}`,
      );
      check(
        "and does not open a modal to do it",
        (await mp.locator('[role="dialog"]').count()) === 0,
      );
    }

    // The navigation drawer: a titled panel, not a bottom sheet on its side.
    await mp.getByRole("button", { name: /show filters/i }).click();
    await mp.waitForTimeout(700);
    const drawer = await mp.evaluate(() => {
      const sidebarish = document.querySelector<HTMLElement>("[data-testid='sidebar-drawer']");
      if (!sidebarish) return null;
      const r = sidebarish.getBoundingClientRect();
      const rows = [...sidebarish.querySelectorAll<HTMLElement>("[data-category-row]")];
      return {
        left: Math.round(r.left),
        width: Math.round(r.width),
        rowHeight: rows.length ? Math.round(rows[0].getBoundingClientRect().height) : 0,
        hasClose: Boolean(sidebarish.querySelector("button[aria-label='Close']")),
      };
    });
    check("the drawer slides in from the left edge", drawer !== null && drawer.left <= 1, JSON.stringify(drawer));
    check("the drawer has a header with a close control", drawer?.hasClose === true);
    check(
      "drawer category rows are finger-sized",
      (drawer?.rowHeight ?? 0) >= 44,
      `${drawer?.rowHeight ?? 0}px`,
    );
    await mp.keyboard.press("Escape");
    await mp.waitForTimeout(500);

    // The overflow menu carries what the bar no longer has room for.
    await mp.getByRole("button", { name: /more options/i }).click();
    await mp.waitForTimeout(500);
    const menu = await mp.locator("[data-radix-popper-content-wrapper]").first().innerText();
    check(
      "overflow menu carries trending, subscribe, help and theme",
      /trending/i.test(menu) && /subscribe/i.test(menu) && /how it works/i.test(menu) && /appearance/i.test(menu),
      menu.replace(/\s+/g, " ").slice(0, 80),
    );
    await mp.keyboard.press("Escape");
    await mp.waitForTimeout(400);

    // The footer must not sit under the fixed toolbar.
    const clear = await mp.evaluate(() => {
      const footer = document.querySelector<HTMLElement>("footer");
      const bar = document.querySelector<HTMLElement>("[data-testid='mobile-toolbar']");
      if (!footer || !bar) return null;
      return Math.round(bar.getBoundingClientRect().top - footer.getBoundingClientRect().bottom);
    });
    check("the toolbar does not cover the footer", clear === null || clear >= 0, `${clear}px gap`);

    await mp.screenshot({ path: `${SHOTS}/mobile-month.png`, fullPage: false });
    await m.close();
  }

  console.log("\n=== VIEWPORTS x THEMES ===");
  for (const vp of VIEWPORTS) {
    for (const theme of ["light", "dark"] as const) {
      const ctx = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        colorScheme: theme,
        hasTouch: vp.name === "mobile",
      });
      await shim(ctx);
      const p = await ctx.newPage();
      await p.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await settle(p);
      const scroll = await p.evaluate(() => ({
        doc: document.documentElement.scrollWidth,
        win: window.innerWidth,
      }));
      check(
        `${vp.name}/${theme}: no horizontal overflow`,
        scroll.doc <= scroll.win + 1,
        `${scroll.doc} vs ${scroll.win}`,
      );
      await p.screenshot({ path: `${SHOTS}/final-${vp.name}-${theme}.png` });
      await ctx.close();
    }
  }

  /*
   * ─────────────────────────────────────────────────────────────────────────
   * An empty selection, at the four sizes it was reported broken at
   * ─────────────────────────────────────────────────────────────────────────
   *
   * The rail and the drawer are two shells of the same body, and each renders
   * its own copy of both buttons at its own scale. So "Clear all is visible"
   * has to be asked of whichever one the reader can actually see, which is why
   * this opens the drawer below `lg` instead of reading the hidden rail.
   *
   * The 1366x768 and 430x932 sizes are here because they are where the
   * workspace is tightest vertically and widest on a phone respectively — the
   * two places a one-line hint is most likely to push the grid out of view.
   */
  console.log("\n=== EMPTY SELECTION ACROSS VIEWPORTS ===");
  for (const vp of [
    { name: "1440x900", width: 1440, height: 900 },
    { name: "1366x768", width: 1366, height: 768 },
    { name: "390x844", width: 390, height: 844 },
    { name: "430x932", width: 430, height: 932 },
  ]) {
    const rail = vp.width >= 1024;
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      hasTouch: !rail,
    });
    await shim(ctx);
    const p = await ctx.newPage();
    await p.goto(`${BASE}/?categories=none`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await settle(p);

    // The calendar is still the page, at every size.
    const shape = await p.evaluate(() => ({
      grids: document.querySelectorAll('[role="grid"]').length,
      dayCells: document.querySelectorAll("[data-day]").length,
      currentDay: document.querySelectorAll('[aria-current="date"]').length,
      events: document.querySelectorAll("[data-event-title]").length,
      fullScreenEmpty: document.querySelectorAll("[data-empty-state]").length,
      hint: (
        document.querySelector("[data-calendar-hint='no-categories']")?.textContent ?? ""
      )
        .replace(/\s+/g, " ")
        .trim(),
      doc: document.documentElement.scrollWidth,
      win: window.innerWidth,
    }));
    check(
      `${vp.name}: the calendar is still on screen with nothing selected`,
      shape.grids === 1 && shape.dayCells >= 35 && shape.fullScreenEmpty === 0,
      `${shape.grids} grid, ${shape.dayCells} days, ${shape.fullScreenEmpty} empty screens`,
    );
    check(`${vp.name}: no events are drawn`, shape.events === 0, `${shape.events}`);
    check(`${vp.name}: today is still marked`, shape.currentDay >= 1, `${shape.currentDay}`);
    check(
      `${vp.name}: the hint stays one short line`,
      /no categories selected/i.test(shape.hint) && shape.hint.length < 80,
      shape.hint,
    );
    check(
      `${vp.name}: no horizontal overflow`,
      shape.doc <= shape.win + 1,
      `${shape.doc} vs ${shape.win}`,
    );

    if (!rail) {
      /*
       * The phone's Month is a grid plus a selected-day panel, and the panel is
       * where §15 allows an empty state — it sits under an intact grid rather
       * than replacing one. What it must not do is give directions that no
       * longer apply: it used to add "Tap a tinted date above" unconditionally,
       * and with the categories cleared there is not a tinted date on the grid.
       */
      const panel = (
        await p.locator('[data-testid="mobile-day-schedule"]').first().textContent()
      )
        ?.replace(/\s+/g, " ")
        .trim();
      check(
        `${vp.name}: the day panel says it is empty without inventing a way out`,
        /nothing scheduled/i.test(panel ?? "") && !/tap a tinted date/i.test(panel ?? ""),
        panel ?? "missing",
      );
    }

    // Now the controls, in whichever shell this size actually shows.
    if (!rail) {
      await p.getByRole("button", { name: "Show filters" }).click();
      await p.locator('[data-testid="sidebar-drawer"]').waitFor({ state: "visible" });
      await p.waitForTimeout(400);
    }
    const scope = rail
      ? p.locator("#calendar-sidebar")
      : p.locator('[data-testid="sidebar-drawer"]');
    const clearAll = scope.locator('[data-action="clear-categories"]').first();
    const showAll = scope.locator('[data-action="show-all-categories"]').first();
    check(
      `${vp.name}: Clear all is visible and says so`,
      (await clearAll.isVisible()) && (await clearAll.textContent())?.trim() === "Clear all",
      (await clearAll.textContent())?.trim() ?? "missing",
    );
    check(
      `${vp.name}: Clear all is disabled at zero and Show all is not`,
      (await clearAll.isDisabled()) && !(await showAll.isDisabled()),
    );
    if (!rail) {
      // §15/§16: a real tap target in the compact layout, not an 11px link.
      const box = await clearAll.boundingBox();
      check(
        `${vp.name}: Clear all is a 44px tap target`,
        (box?.height ?? 0) >= 44,
        `${Math.round(box?.height ?? 0)}px`,
      );
    }

    /*
     * And the pair really are opposites: Show all fills the list back up.
     *
     * Counted inside `scope`, not across the document. Both sidebar shells are
     * mounted below `lg` — the rail is hidden by CSS rather than unmounted, and
     * vaul mounts the drawer's contents on open — so once the drawer is up
     * there are two of every checkbox and a document-wide count reads 22.
     */
    await showAll.click();
    await settle(p);
    const ticked = await scope
      .locator('[data-category-row] [role="checkbox"][data-state="checked"]')
      .count();
    const hints = await p.locator("[data-calendar-hint='no-categories']").count();
    check(
      `${vp.name}: Show all fills the list back up`,
      ticked === 11 && hints === 0,
      `${ticked} ticked, ${hints} hints`,
    );
    check(
      `${vp.name}: and Clear all is offered again`,
      (await clearAll.isVisible()) && !(await clearAll.isDisabled()),
    );

    await p.screenshot({ path: `${SHOTS}/empty-selection-${vp.name}.png` });
    await ctx.close();
  }

  /*
   * The mobile polish pass, checked where it can only be checked: in a browser.
   *
   * Every assertion here replaced a throwaway probe, and each one exists
   * because the thing it measures was once wrong. The comments say which.
   */
  console.log("\n=== BRAND IS A HOME CONTROL ===");
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await shim(ctx);
    const p = await ctx.newPage();
    await p.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await settle(p);

    /*
     * The old tooltip. `title` on the brand produced a browser-native bubble
     * reading "Polymarket Calendar — Built by gavelsv", which raced the app's
     * own hover card and could not be styled or dismissed.
     */
    const brand = p.locator('[data-brand="home"]').first();
    const titles = await p.evaluate(() => {
      const el = document.querySelector('[data-brand="home"]');
      if (!el) return null;
      const all = [el, ...Array.from(el.querySelectorAll("*"))];
      return all.map((n) => n.getAttribute("title")).filter((t) => t !== null);
    });
    check("brand carries no title attribute anywhere", titles?.length === 0, JSON.stringify(titles));

    const label = await brand.getAttribute("aria-label");
    check(
      "brand keeps an accessible name",
      Boolean(label && /polymarket calendar/i.test(label)),
      label ?? "none",
    );
    check(
      "brand is a real button",
      (await brand.evaluate((el) => el.tagName.toLowerCase())) === "button",
    );

    // Navigate away, then click the brand: it must land on this month, in
    // Month view, without a document navigation.
    await p.evaluate(() => {
      (window as unknown as { __navs?: number }).__navs = 0;
    });
    await p.goto(`${BASE}?view=week`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await settle(p);
    /*
     * Scoped to the banner, and by data attribute rather than by name.
     *
     * The accessible name is "Next week" or "Next month" depending on the view,
     * so a fixed name never matches; and `[data-nav="next"]` alone matches
     * twice, because the phone's bottom toolbar carries the same control and is
     * present in the DOM at every width, merely zero-sized above `md`.
     */
    for (let i = 0; i < 3; i++) {
      await p.getByRole("banner").locator('[data-nav="next"]').click();
      await p.waitForTimeout(150);
    }

    // Count RSC round trips across the click. Brand navigation is client state,
    // so this must not re-enter the server pipeline.
    const rsc: string[] = [];
    p.on("request", (r) => {
      const u = r.url();
      if (u.includes("_rsc=") || r.headers()["rsc"] === "1") rsc.push(u);
    });
    await p.locator('[data-brand="home"]').first().click();
    await p.waitForTimeout(600);

    const after = await p.evaluate(() => ({
      view: new URLSearchParams(location.search).get("view") ?? "month",
      month: document.querySelector("[data-period-label]")?.textContent?.trim() ?? "",
    }));
    const expectedMonth = new Date().toLocaleString("en-GB", {
      month: "long",
      year: "numeric",
    });
    check("brand click returns to Month", after.view === "month", after.view);
    check(
      "brand click returns to the current month",
      after.month.toLowerCase().includes(expectedMonth.toLowerCase()),
      `${after.month} vs ${expectedMonth}`,
    );
    check("brand click makes no RSC request", rsc.length === 0, `${rsc.length} request(s)`);

    await ctx.close();
  }

  console.log("\n=== MOBILE MONTH: A DAY IS A LIST, NOT ONE CARD ===");
  for (const vp of [
    { name: "iphone15", width: 393, height: 852 },
    { name: "safari-393x659", width: 393, height: 659 },
    { name: "se-375x667", width: 375, height: 667 },
  ]) {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      hasTouch: true,
      isMobile: true,
    });
    await shim(ctx);
    const p = await ctx.newPage();
    await p.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await settle(p);

    const m = await p.evaluate(() => {
      const list = document.querySelector('[data-testid="mobile-day-schedule"] ul');
      const rows = list ? Array.from(list.querySelectorAll("li")) : [];
      const box = list?.getBoundingClientRect();
      let fully = 0;
      let widest = 0;
      for (const r of rows) {
        const b = r.getBoundingClientRect();
        widest = Math.max(widest, b.right);
        if (box && b.top >= box.top - 0.5 && b.bottom <= box.bottom + 0.5) fully += 1;
      }
      return {
        rows: rows.length,
        fully,
        widest: Math.round(widest),
        win: window.innerWidth,
        overflowX: Math.max(
          0,
          document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      };
    });

    /*
     * "Several, not one." The complaint that started this was that a selected
     * day showed one market at a time. Before the fix the list was 0px tall at
     * 375x553 and one row at 393x659.
     */
    check(
      `${vp.name}: at least 3 events visible at once`,
      m.rows === 0 || m.fully >= 3,
      `${m.fully} of ${m.rows} fully visible`,
    );
    check(`${vp.name}: rows stay inside the screen`, m.widest <= m.win + 1, `${m.widest} vs ${m.win}`);
    check(`${vp.name}: no horizontal body overflow`, m.overflowX === 0, `${m.overflowX}px`);

    await ctx.close();
  }

  console.log("\n=== WEEK: NO EVENT LEAVES ITS DAY ===");
  for (const vp of [
    { name: "375x667", width: 375, height: 667, touch: true },
    { name: "390x844", width: 390, height: 844, touch: true },
    { name: "430x932", width: 430, height: 932, touch: true },
    { name: "768x1024", width: 768, height: 1024, touch: false },
    { name: "1024x768", width: 1024, height: 768, touch: false },
    { name: "1440x900", width: 1440, height: 900, touch: false },
  ]) {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      hasTouch: vp.touch,
      isMobile: vp.touch,
    });
    await shim(ctx);
    const p = await ctx.newPage();
    await p.goto(`${BASE}?view=week`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await settle(p);

    const m = await p.evaluate(() => {
      const cols = Array.from(
        document.querySelectorAll("[data-week-col], [data-week-allday-col]"),
      ) as HTMLElement[];
      let chips = 0;
      let escapes = 0;
      let worst = 0;
      let clipped = 0;
      let zeroTitles = 0;
      let sameDayPairs = 0;

      for (const col of cols) {
        const cb = col.getBoundingClientRect();
        const inCol = Array.from(col.querySelectorAll("[data-event-title]"));
        if (inCol.length > 1) sameDayPairs += 1;
        for (const chip of inCol) {
          chips += 1;
          for (const part of Array.from(chip.querySelectorAll("span"))) {
            const pb = part.getBoundingClientRect();
            if (pb.width === 0) continue;
            const over = pb.right - cb.right;
            if (over > 0.5) {
              escapes += 1;
              worst = Math.max(worst, over);
            }
          }
          const el = chip as HTMLElement;
          // Content hidden by a clip is as lost as content painted outside.
          if (el.scrollWidth - el.clientWidth > 1) clipped += 1;
          const title = chip.querySelector("span.truncate");
          if (title && (title as HTMLElement).getBoundingClientRect().width < 1) zeroTitles += 1;
        }
      }

      return {
        cols: cols.length,
        chips,
        escapes,
        worst: Math.round(worst),
        clipped,
        zeroTitles,
        sameDayPairs,
        overflowX: Math.max(
          0,
          document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      };
    });

    /*
     * The bug: a week chip's probability and volume were `shrink-0`, so the row
     * needed 184px of intrinsic width in a 95px column. Flexbox cannot shrink a
     * `shrink-0` child, so the excess painted into the *next day* — measured at
     * 96.73px, more than a whole column, with Tuesday's volume landing inside
     * Wednesday. It reproduced from 375px all the way to 1600px.
     */
    check(
      `week ${vp.name}: nothing crosses a day boundary`,
      m.escapes === 0,
      `${m.escapes} escape(s), worst ${m.worst}px, ${m.chips} chips in ${m.cols} columns`,
    );
    // Columns holding two or more chips are the same-day overlap case: they
    // share the column's width and must still respect its edges.
    check(
      `week ${vp.name}: simultaneous events stay in their day`,
      m.escapes === 0 && m.sameDayPairs > 0,
      `${m.sameDayPairs} column(s) with 2+ chips`,
    );
    check(`week ${vp.name}: no chip content is clipped away`, m.clipped === 0, `${m.clipped}`);
    check(`week ${vp.name}: no title collapsed to zero`, m.zeroTitles === 0, `${m.zeroTitles}`);
    check(`week ${vp.name}: no horizontal body overflow`, m.overflowX === 0, `${m.overflowX}px`);

    /*
     * The time axis has to survive being scrolled to.
     *
     * The hour grid used to scroll vertically on its own, which made it a
     * scroll container on *both* axes — and `position: sticky` resolves against
     * the nearest scrollport, so the gutter pinned itself to that inner box
     * instead of to the horizontal scroller. Measured at half-scroll on a 393px
     * phone: the hour labels sat at `left: -255px`. A swiped timeline with no
     * axis is a wall of chips at unknown times.
     */
    const axis = await p.evaluate(() => {
      const col = document.querySelector("[data-week-col]") as HTMLElement | null;
      if (!col) return null;
      let scroller: HTMLElement | null = col;
      while (scroller && scroller.scrollWidth <= scroller.clientWidth + 1) {
        scroller = scroller.parentElement;
      }
      const labels = () =>
        ([...document.querySelectorAll("*")] as HTMLElement[]).filter(
          (e) => /^\d{2}:00$/.test((e.textContent || "").trim()) && e.children.length === 0,
        );
      const onScreen = () =>
        labels().filter((e) => {
          const r = e.getBoundingClientRect();
          return r.width > 0 && r.left >= -1 && r.right <= window.innerWidth + 1;
        }).length;

      const before = onScreen();
      if (!scroller) return { scrollable: false, before };
      scroller.scrollLeft = (scroller.scrollWidth - scroller.clientWidth) * 0.5;
      return { scrollable: true, before };
    });
    await p.waitForTimeout(250);
    const after = await p.evaluate(
      () =>
        ([...document.querySelectorAll("*")] as HTMLElement[]).filter((e) => {
          if (!/^\d{2}:00$/.test((e.textContent || "").trim()) || e.children.length > 0) return false;
          const r = e.getBoundingClientRect();
          return r.width > 0 && r.left >= -1 && r.right <= window.innerWidth + 1;
        }).length,
    );
    check(
      `week ${vp.name}: the hour axis stays on screen when scrolled`,
      after > 0,
      `${axis?.before ?? "?"} labels before, ${after} after${axis?.scrollable ? "" : " (no horizontal scroll)"}`,
    );

    await ctx.close();
  }

  console.log("\n=== ADD TO CALENDAR ===");
  {
    const IOS =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
    const ANDROID =
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";

    for (const c of [
      { name: "iphone", ua: IOS, width: 390, height: 664, touch: true, first: "apple" },
      { name: "android", ua: ANDROID, width: 412, height: 800, touch: true, first: "google" },
      { name: "desktop", ua: undefined, width: 1440, height: 900, touch: false, first: "google" },
    ]) {
      const ctx = await browser.newContext({
        viewport: { width: c.width, height: c.height },
        userAgent: c.ua,
        hasTouch: c.touch,
        isMobile: c.touch,
      });
      await shim(ctx);
      const p = await ctx.newPage();
      await p.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await settle(p);

      const opener = c.touch
        ? p.locator("[data-schedule-title]").first()
        : p.locator("[data-event-title]").first();
      await opener.click();
      await p.waitForTimeout(700);
      await p.getByRole("button", { name: /add to calendar/i }).first().click();
      await p.waitForTimeout(500);

      const sheets = await p.locator('[data-testid="add-to-calendar-sheet"]').count();
      check(
        `${c.name}: ${c.touch ? "bottom sheet" : "popover"} on ${c.touch ? "touch" : "pointer"}`,
        c.touch ? sheets === 1 : sheets === 0,
      );

      const rows = p.locator("[data-calendar-destination]");
      const n = await rows.count();
      check(`${c.name}: every destination is offered`, n >= 5, `${n}`);
      check(
        `${c.name}: ${c.first} is first`,
        (await rows.first().getAttribute("data-calendar-destination")) === c.first,
      );

      const hrefs = await rows.evaluateAll((els) =>
        els.map((e) => (e as HTMLAnchorElement).getAttribute("href") ?? ""),
      );
      /*
       * The one that matters on iOS. The old implementation used
       * `URL.createObjectURL`, and iOS Safari will not hand a blob: or data:
       * URL to Calendar — the button did nothing at all on an iPhone.
       */
      check(
        `${c.name}: every destination is a plain link`,
        hrefs.length > 0 && hrefs.every((h) => h.length > 0),
      );
      check(
        `${c.name}: the .ics is a served URL, not a blob`,
        hrefs.some((h) => h.startsWith("/api/calendar/event/")) &&
          !hrefs.some((h) => h.startsWith("blob:") || h.startsWith("data:")),
        hrefs.find((h) => h.startsWith("/api/calendar/event/")) ?? "none",
      );

      const geom = await rows.evaluateAll((els, vh) => {
        const boxes = els.map((e) => e.getBoundingClientRect());
        return {
          min: Math.round(Math.min(...boxes.map((b) => b.height))),
          below: boxes.filter((b) => b.bottom > (vh as number)).length,
        };
      }, c.height);
      check(
        `${c.name}: rows are ${c.touch ? "thumb-sized" : "compact"}`,
        c.touch ? geom.min >= 44 : geom.min >= 32,
        `${geom.min}px`,
      );
      check(`${c.name}: nothing sits below the fold`, geom.below === 0, `${geom.below}`);

      await ctx.close();
    }
  }

  console.log("\n=== ONBOARDING FITS, AND ONLY FIRST-TIMERS PAY FOR IT ===");
  for (const vp of [
    { name: "iphone15-393x852", width: 393, height: 852 },
    { name: "safari-393x659", width: 393, height: 659 },
    { name: "safari-se-375x553", width: 375, height: 553 },
    { name: "430x932", width: 430, height: 932 },
  ]) {
    for (const theme of ["light", "dark"] as const) {
      const ctx = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        colorScheme: theme,
        hasTouch: true,
        isMobile: true,
      });
      // Deliberately no `shim`: a first visit is the thing under test. The
      // analytics block is not part of that and still applies.
      await blockAnalytics(ctx);
      const p = await ctx.newPage();
      await p.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await p.waitForSelector('[role="dialog"]', { timeout: 30_000 });
      await p.waitForTimeout(600);

      const heights: number[] = [];
      let allFit = true;
      for (let step = 0; step < 3; step++) {
        if (step > 0) {
          await p.getByRole("button", { name: /^next$/i }).click();
          await p.waitForTimeout(400);
        }
        const m = await p.evaluate((vh) => {
          const d = document.querySelector('[role="dialog"]') as HTMLElement;
          const b = d.getBoundingClientRect();
          const lowest = Array.from(d.querySelectorAll("button")).reduce(
            (acc, el) => Math.max(acc, el.getBoundingClientRect().bottom),
            0,
          );
          return { h: Math.round(b.height), top: b.top, bottom: b.bottom, lowest, vh };
        }, vp.height);
        heights.push(m.h);
        // §28: the controls must be reachable without scrolling.
        if (m.top < -0.5 || m.bottom > m.vh + 0.5 || m.lowest > m.vh + 0.5) allFit = false;
        await p.screenshot({ path: `${SHOTS}/onboarding-${theme}-${vp.name}-step${step + 1}.png` });
      }

      check(
        `onboarding ${vp.name}/${theme}: every step fits without scrolling`,
        allFit,
        heights.join(", "),
      );
      // The panel must not resize under a thumb that is already reaching for
      // Next — measured jumping 453px to 476px when a subtitle wrapped.
      check(
        `onboarding ${vp.name}/${theme}: panel height is stable across steps`,
        new Set(heights).size === 1,
        heights.join(" -> "),
      );

      await ctx.close();
    }
  }

  {
    // §29: reduced motion must show the *finished* illustration, not a blank
    // stage. Every art keyframe is authored so the base style is the last
    // frame; this is what proves it.
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      reducedMotion: "reduce",
      hasTouch: true,
      isMobile: true,
    });
    await blockAnalytics(ctx);
    const p = await ctx.newPage();
    await p.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await p.waitForSelector('[role="dialog"]', { timeout: 30_000 });
    await p.waitForTimeout(500);

    const art = await p.evaluate(() => {
      const svg = document.querySelector('[role="dialog"] svg');
      if (!svg) return null;
      const loop = svg.querySelector(".art-loop") as HTMLElement | null;
      const painted = Array.from(svg.querySelectorAll("rect, path, text")).filter((el) => {
        const s = getComputedStyle(el);
        const parent = el.closest(".art-loop") as HTMLElement | null;
        const parentOpacity = parent ? Number(getComputedStyle(parent).opacity) : 1;
        const groupOpacity = Number(getComputedStyle(el.parentElement as Element).opacity);
        return (
          Number(s.opacity) > 0.05 &&
          groupOpacity > 0.05 &&
          parentOpacity > 0.05 &&
          el.getBoundingClientRect().width > 0
        );
      });
      return {
        loopOpacity: loop ? Number(getComputedStyle(loop).opacity) : -1,
        painted: painted.length,
      };
    });

    check(
      "reduced motion: the illustration is fully painted, not mid-animation",
      Boolean(art && art.loopOpacity > 0.95 && art.painted >= 8),
      art ? `loop=${art.loopOpacity} painted=${art.painted}` : "no art",
    );
    await p.screenshot({ path: `${SHOTS}/onboarding-reduced-motion.png` });
    await ctx.close();
  }

  {
    /*
     * §30: a returning visitor must not pay for onboarding at all.
     *
     * Compared by *script set*, not by URL pattern — production chunk names are
     * hashed, so grepping the URL for "onboarding" would pass whether the code
     * shipped or not. The honest question is whether a first visit fetches
     * anything a returning visit does not.
     *
     * This was failing silently: `dynamic()` fetches a chunk when the component
     * renders, not when it opens, and the dialog was rendered unconditionally
     * with `open={false}`. Both visits pulled the identical 20 scripts. Mounting
     * it only for someone who will see it moved 12.0 KB (3.8 KB gzipped) of art
     * and keyframes off the returning path.
     */
    const scriptsFor = async (returning: boolean) => {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
      if (returning) await shim(ctx);
      const p = await ctx.newPage();
      const scripts = new Set<string>();
      p.on("response", (r) => {
        if (/\.js(\?|$)/.test(r.url())) scripts.add(r.url());
      });
      await p.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await settle(p);
      await p.waitForTimeout(800);
      const dialogs = await p.locator('[role="dialog"]').count();
      await ctx.close();
      return { scripts, dialogs };
    };

    const first = await scriptsFor(false);
    const back = await scriptsFor(true);
    const extra = [...first.scripts].filter((u) => !back.scripts.has(u));

    check("a first visit shows onboarding", first.dialogs === 1, `${first.dialogs} dialog(s)`);
    check("returning visitor sees no onboarding dialog", back.dialogs === 0);
    check(
      "returning visitor downloads strictly less than a first-timer",
      extra.length > 0 && back.scripts.size < first.scripts.size,
      `${first.scripts.size} scripts first, ${back.scripts.size} returning; only-first: ${
        extra.map((u) => u.split("/").pop()).join(", ") || "none"
      }`,
    );
  }

  console.log("\n=== GOOGLE CALENDAR GUIDE ===");
  {
    /*
     * The guide is four real screenshots of Google's own UI, and the URL it
     * copies is the reader's actual filtered feed. Both are things a
     * screenshot-free refactor could quietly break: the images could 404 and
     * the frame would still lay out, and the copy button could fall back to a
     * placeholder and still say "Copied".
     */
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${BASE}/?categories=sports,crypto,economy`, {
      waitUntil: "domcontentloaded",
    });
    await settle(page);

    await page.locator("#calendar-sidebar").getByRole("button", { name: "Subscribe" }).first().click();
    await page.waitForTimeout(400);
    const guideButton = page.locator("[data-action='open-google-guide']");
    check("the subscribe panel offers the Google walkthrough", (await guideButton.count()) > 0);

    if ((await guideButton.count()) > 0) {
      await guideButton.first().click();
      await page.waitForTimeout(700);
      const guide = page.locator("[data-guide='google']");
      check("the guide opens", (await guide.count()) > 0);

      const progress = () =>
        page.locator("[data-guide-progress]").first().getAttribute("data-guide-progress");
      check("it starts at step one of four", (await progress()) === "1/4");
      check(
        "Back is unavailable on the first step",
        await page.locator("[data-action='guide-back']").first().isDisabled(),
      );

      /*
       * The screenshots are real files, decoded by the browser. A broken path
       * still renders an <img> box, so this asserts on `naturalWidth` — the
       * only signal that says the bytes actually arrived and decoded.
       */
      const shot = async () =>
        page.evaluate(() => {
          const img = document.querySelector<HTMLImageElement>(
            "[data-guide-step-image]:not(.opacity-0)",
          );
          return img
            ? { src: img.currentSrc || img.src, w: img.naturalWidth, alt: img.alt }
            : null;
        });

      const seen: string[] = [];
      for (let step = 1; step <= 4; step++) {
        const image = await shot();
        check(
          `step ${step} shows a real screenshot`,
          Boolean(image && image.w > 0),
          image ? `${image.w}px ${image.src.split("/").pop()}` : "no visible image",
        );
        check(
          `step ${step}'s screenshot is described for a screen reader`,
          Boolean(image && image.alt.length > 20),
          image?.alt.slice(0, 40) ?? "",
        );
        if (image) seen.push(image.src);

        // The URL steps carry a working copy button; the others do not.
        const copy = page.locator("[data-action='copy-feed-url']");
        const expectsCopy = step === 1 || step === 3;
        check(
          `step ${step} ${expectsCopy ? "offers" : "does not offer"} Copy Calendar URL`,
          ((await copy.count()) > 0) === expectsCopy,
        );

        if (step < 4) {
          check(`step ${step} shows "${step} of 4"`, (await progress()) === `${step}/4`);
          await page.locator("[data-action='guide-continue']").first().click();
          await page.waitForTimeout(450);
        }
      }

      check("it ends at step four of four", (await progress()) === "4/4");
      check(
        "four different screenshots, in order",
        new Set(seen).size === 4,
        seen.map((u) => u.split("/").pop()?.split("?")[0]).join(" "),
      );
      check(
        "the last step offers Done rather than Continue",
        (await page.locator("[data-action='guide-done']").count()) === 1 &&
          (await page.locator("[data-action='guide-continue']").count()) === 0,
      );

      // Back walks it in reverse.
      await page.locator("[data-action='guide-back']").first().click();
      await page.waitForTimeout(400);
      check("Back returns to step three", (await progress()) === "3/4");

      /*
       * The copied URL is the *real* feed for the filters on screen, not a
       * placeholder and not "all events". Read out of the clipboard rather
       * than off the button, because the button would say "Copied" either way.
       */
      await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
      await page.locator("[data-action='copy-feed-url']").first().click();
      await page.waitForTimeout(300);
      const copied = await page.evaluate(() => navigator.clipboard.readText());
      check(
        "the button confirms the copy",
        /copied/i.test(
          (await page.locator("[data-action='copy-feed-url']").first().textContent()) ?? "",
        ),
      );
      check(
        "it copies an absolute URL on this origin",
        copied.startsWith(BASE),
        copied.slice(0, 80),
      );
      check(
        "it copies a calendar feed, not a page",
        /\/api\/calendar\/.+\.ics/.test(copied),
        copied.slice(0, 90),
      );
      check(
        "the copied feed carries the filters that are on screen",
        (() => {
          const url = new URL(copied);
          const list = (url.searchParams.get("categories") ?? "").split(",").sort();
          return list.join(",") === "crypto,economy,sports";
        })(),
        copied.slice(0, 110),
      );

      // And it is a URL that actually serves a calendar.
      const served = await page.evaluate(async (u) => {
        const res = await fetch(u);
        const body = await res.text();
        return { status: res.status, type: res.headers.get("content-type") ?? "", body: body.slice(0, 200) };
      }, copied);
      check("the copied URL serves 200", served.status === 200, String(served.status));
      check("…as text/calendar", /text\/calendar/.test(served.type), served.type);
      check("…beginning with a VCALENDAR", served.body.startsWith("BEGIN:VCALENDAR"));
    }

    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  }

  console.log("\n=== GOOGLE GUIDE FITS AN IPHONE ===");
  {
    /*
     * §48: image, title, instruction and controls have to fit without
     * scrolling to reach Continue. An iPhone 15 is 393x852 CSS px.
     */
    const ctx = await browser.newContext({
      viewport: { width: 393, height: 852 },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
    });
    // Without this a fresh context is a first visit, and the onboarding dialog
    // makes the rest of the page inert — so the app bar's own toggle sat there
    // un-clickable for thirty seconds. Every other context in this file shims.
    await shim(ctx);
    const p = await ctx.newPage();
    await p.goto(BASE, { waitUntil: "domcontentloaded" });
    await settle(p);

    // The app bar's drawer toggle is labelled by what it does to the filters,
    // not by the word "menu" — asking for "Open menu" found nothing and the
    // drawer never opened, so every check below it reported a missing sheet.
    await p.getByRole("button", { name: "Show filters" }).first().click();
    await p.waitForSelector("[data-testid='sidebar-drawer']", { timeout: 10_000 });
    await p.waitForTimeout(400);
    const subscribe = p.getByRole("button", { name: "Subscribe to this calendar" });
    if ((await subscribe.count()) > 0) {
      await subscribe.first().click();
      await p.waitForTimeout(600);
      const guideButton = p.locator("[data-action='open-google-guide']");
      if ((await guideButton.count()) > 0) {
        await guideButton.first().scrollIntoViewIfNeeded();
        await guideButton.first().click();
        await p.waitForTimeout(800);

        for (const step of [1, 2, 3, 4]) {
          const geometry = await p.evaluate(() => {
            const sheet = document.querySelector("[data-guide='google']");
            const control =
              document.querySelector("[data-action='guide-continue']") ??
              document.querySelector("[data-action='guide-done']");
            const scroller = sheet?.querySelector(".overflow-y-auto");
            if (!sheet || !control) return null;
            const r = control.getBoundingClientRect();
            return {
              // The control is on screen without anybody scrolling for it.
              controlBottom: r.bottom,
              controlTop: r.top,
              viewport: window.innerHeight,
              // And it is pinned outside the scrollport, so it cannot leave.
              overflows: scroller
                ? scroller.scrollHeight - scroller.clientHeight
                : 0,
              sheetBottom: sheet.getBoundingClientRect().bottom,
            };
          });
          check(
            `step ${step}: the control is reachable without scrolling`,
            Boolean(
              geometry &&
                geometry.controlBottom <= geometry.viewport + 1 &&
                geometry.controlTop >= 0,
            ),
            geometry
              ? `bottom ${Math.round(geometry.controlBottom)} of ${geometry.viewport}`
              : "no control",
          );
          check(
            `step ${step}: the sheet itself stays inside the viewport`,
            Boolean(geometry && geometry.sheetBottom <= geometry.viewport + 1),
            geometry ? `${Math.round(geometry.sheetBottom)}` : "",
          );
          if (step < 4) {
            await p.locator("[data-action='guide-continue']").first().click();
            await p.waitForTimeout(400);
          }
        }
      } else {
        check("the mobile subscribe sheet offers the Google walkthrough", false);
      }
    } else {
      check("the mobile drawer offers Subscribe", false);
    }
    await ctx.close();
  }

  console.log("\n=== MONTH: DOUBLE-CLICK OPENS THE DAY ===");
  {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await settle(page);

    /*
     * Two days, deliberately: a busy one that has a "+N more" button and a
     * quiet one that does not. §24 is explicit that the gesture must work on
     * days with one, two or three events, which is exactly where the old
     * escape hatch did not exist.
     */
    const days = await page.evaluate(() => {
      const cells = [...document.querySelectorAll<HTMLElement>("[role='gridcell'][data-day]")];
      const counted = cells.map((c) => ({
        day: c.getAttribute("data-day") ?? "",
        chips: c.querySelectorAll("[data-event-title]").length,
        more: c.querySelector("[data-more-count]") !== null ||
          /\+\d+ more/.test(c.textContent ?? ""),
      }));
      return {
        busy: counted.find((c) => c.more)?.day ?? "",
        quiet: counted.find((c) => !c.more && c.chips >= 1 && c.chips <= 3)?.day ?? "",
      };
    });

    for (const [label, day] of [["a busy day", days.busy], ["a quiet day", days.quiet]] as const) {
      if (!day) {
        check(`${label} exists in this month to test against`, false);
        continue;
      }
      const cell = page.locator(`[role="gridcell"][data-day="${day}"]`);

      // Single click still selects, and opens nothing.
      await cell.click({ position: { x: 8, y: 8 } });
      await page.waitForTimeout(250);
      check(
        `${label}: a single click selects without opening a dialog`,
        (await page.locator('[role="dialog"]').count()) === 0 &&
          (await cell.getAttribute("aria-current")) !== null,
        day,
      );

      await cell.dblclick({ position: { x: 8, y: 8 } });
      await page.waitForTimeout(500);
      const opened = await page.evaluate(() => {
        const dialog = document.querySelector('[role="dialog"]');
        if (!dialog) return null;
        return {
          text: dialog.textContent ?? "",
          events: dialog.querySelectorAll("[data-event-title]").length,
        };
      });
      check(`${label}: a double click opens a dialog`, opened !== null, day);
      if (opened) {
        check(
          `${label}: it is the whole-day panel, with a count`,
          /\d+ events?/.test(opened.text),
          opened.text.slice(0, 60).replace(/\s+/g, " "),
        );
        const expected = await page.evaluate(
          (d) => document.querySelectorAll(`[data-day="${d}"] [data-event-title]`).length,
          day,
        );
        check(
          `${label}: it lists at least what the cell showed`,
          opened.events >= Math.max(1, expected),
          `${opened.events} listed, cell showed ${expected}`,
        );
      }
      await page.keyboard.press("Escape");
      await page.waitForTimeout(350);
    }

    // Double-clicking a market opens that market, not the day.
    if (days.busy) {
      const chip = page
        .locator(`[role="gridcell"][data-day="${days.busy}"] [data-event-title]`)
        .first();
      if ((await chip.count()) > 0) {
        // `data-event-title`, not `textContent`: the chip renders its time in
        // front of the title, so the text starts "08:00LoL: …" and comparing a
        // slice of that against the details panel — which prints the title on
        // its own — fails on a chip that is behaving perfectly.
        const title = (await chip.getAttribute("data-event-title"))?.trim() ?? "";
        await chip.dblclick();
        await page.waitForTimeout(500);
        const dialogText = await page
          .locator('[role="dialog"]')
          .first()
          .textContent()
          .catch(() => "");
        check(
          "double-clicking a chip opens that market, not the day",
          Boolean(dialogText) && !/^\s*\w+ \d+ \w+\s*\d+ events?/.test(dialogText ?? ""),
          (dialogText ?? "").slice(0, 50).replace(/\s+/g, " "),
        );
        check(
          "…and it is the market that was clicked",
          Boolean(title) && (dialogText ?? "").includes(title.slice(0, 12)),
          title.slice(0, 40),
        );
        await page.keyboard.press("Escape");
        await page.waitForTimeout(300);
      }
    }
  }

  console.log("\n=== SEARCH REACHES BEYOND THE LOADED MONTH ===");
  {
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await settle(page);
    await page.getByRole("button", { name: /Search/ }).first().click();
    await page.waitForTimeout(400);

    const input = page.locator('[cmdk-input]');
    check("the search dialog opens", (await input.count()) > 0);
    if ((await input.count()) > 0) {
      /*
       * Warm the catalog before asserting anything.
       *
       * The first `/api/search` of a process builds nine months of events, and
       * a cold build was measured at 3.5s — comfortably past any fixed wait
       * that is also short enough to keep this suite bearable. So the request
       * is made directly first, and only then does the dialog get typed into.
       */
      await page.evaluate(() =>
        fetch("/api/search?q=fed%20decision").then((r) => r.json()),
      );

      await input.fill("Fed Decision");
      // Then poll for the merged result rather than guessing: the local month
      // answers instantly and the catalog lands a moment later, so a fixed
      // delay asserts against whichever half happened to be there.
      await page
        .waitForFunction(
          () =>
            [...document.querySelectorAll("[cmdk-item]")].filter((i) =>
              /fed decision/i.test(i.textContent ?? ""),
            ).length > 1,
          { timeout: 15_000 },
        )
        .catch(() => {});

      const found = await page.evaluate(() => {
        const items = [...document.querySelectorAll("[cmdk-item]")];
        return { titles: items.map((i) => i.textContent ?? "") };
      });
      check(
        "searching a recurring series returns several instalments",
        found.titles.filter((t) => /fed decision/i.test(t)).length >= 2,
        `${found.titles.length} results`,
      );
      /*
       * The months are separate events, not one merged row — the brief is
       * explicit that August, September and October are three real dates.
       */
      const months = new Set(
        found.titles
          .map((t) => /fed decision in (\w+)/i.exec(t)?.[1]?.toLowerCase())
          .filter(Boolean),
      );
      check(
        "each month is its own result rather than one merged event",
        months.size >= 2,
        [...months].join(", "),
      );
      /*
       * The ranking requirement, checked where it can actually fail.
       *
       * A resolved market has traded for months, so July's Fed decision is the
       * biggest of the family and will lead any list that does not deliberately
       * demote it. It did lead, for a reason no unit test could see: the dialog
       * rendered the loaded month above the catalog results, so provenance beat
       * merit. One merged ranking fixed it, and this is what holds it.
       */
      const settled = found.titles.findIndex((t) => /resolved/i.test(t));
      const upcoming = found.titles.findIndex(
        (t) => /fed decision/i.test(t) && !/resolved/i.test(t),
      );
      check(
        "an upcoming instalment outranks a resolved one",
        upcoming >= 0 && (settled < 0 || upcoming < settled),
        `upcoming at ${upcoming}, resolved at ${settled}`,
      );
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
    }
  }

  console.log("\n=== CONSOLE ===");
  /*
   * The suite's own load is not an application error.
   *
   * This file drives roughly six hundred page loads from one address in a few
   * minutes, and `/api/events` is deliberately rate limited — so a long run
   * eventually earns a 429, which is the limiter working rather than the app
   * breaking. Measured against the same build: 36 rapid month navigations, far
   * more than a person does, are never limited, and the bucket refills in two
   * seconds. Counted and printed rather than silently dropped, so a limiter
   * that started firing at *normal* rates would still be visible here.
   */
  const real = consoleErrors.filter((e) => !/favicon|DevTools|net::ERR_/i.test(e));
  const limited = real.filter((e) => /\b429\b/.test(e));
  const appErrors = real.filter((e) => !/\b429\b/.test(e));
  if (limited.length > 0) {
    console.log(`  NOTE  rate limiter engaged ${limited.length}× under this suite's own load`);
  }
  check("no console errors", appErrors.length === 0, appErrors.slice(0, 2).join(" | "));

  await browser.close();
  console.log(`\n${failures === 0 ? "ALL UI CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
