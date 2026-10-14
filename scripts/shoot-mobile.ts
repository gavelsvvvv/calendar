import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { chromium, type Browser, type Page } from "playwright";

/**
 * The screenshot pass for the mobile polish work.
 *
 * Separate from `verify:ui` on purpose: that suite asserts, this one only
 * looks. Every scene below is one the brief asks to see with human eyes —
 * a quiet day, a busy day, a week of long titles, the add-to-calendar sheet —
 * in both themes, at an iPhone 15 viewport.
 *
 *   npx tsx scripts/shoot-mobile.ts
 */

const BASE = process.env.PROBE_URL ?? "http://127.0.0.1:3000";
const OUT = "screenshots/mobile";

function resolveChromium(): string | undefined {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!root || !existsSync(root)) return undefined;
  const dir = readdirSync(root).find((d) => /^chromium-\d+$/.test(d));
  if (!dir) return undefined;
  const candidate = `${root}/${dir}/chrome-linux/chrome`;
  return existsSync(candidate) ? candidate : undefined;
}

/** iPhone 15 in CSS pixels, and the height Safari actually leaves a page. */
const PHONE = { width: 393, height: 852 };

async function settle(page: Page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(500);
}

/**
 * Which day to select, asked of the data rather than of the pixels.
 *
 * Counting dots in a cell does not work: the date number is itself a
 * `rounded-full` span, a busy day collapses its events into "+N", and an
 * outside-month cell can look occupied while its list is empty. The first
 * attempt at this picked a day with *zero* events for the "quiet day" shot.
 *
 * The API answers the question exactly, so the shot is of the day it claims.
 */
async function selectDay(page: Page, want: "quiet" | "busy"): Promise<{ key: string; rows: number }> {
  const key = await page.evaluate(async (mode) => {
    const grid = [...document.querySelectorAll<HTMLElement>("[data-day]")]
      .map((c) => c.getAttribute("data-day") ?? "")
      .filter(Boolean);
    if (grid.length === 0) return null;

    const res = await fetch(
      `/api/events?start=${grid[0]}T00:00:00.000Z&end=${grid[grid.length - 1]}T23:59:59.000Z`,
    );
    const data = (await res.json()) as { events?: Array<{ displayDate: string }> };
    const counts = new Map<string, number>();
    for (const e of data.events ?? []) {
      counts.set(e.displayDate, (counts.get(e.displayDate) ?? 0) + 1);
    }

    const onGrid = [...counts.entries()].filter(([day]) => grid.includes(day));
    if (onGrid.length === 0) return null;
    onGrid.sort((a, b) => a[1] - b[1]);
    // "Quiet" means the smallest day that still has something on it — ideally
    // exactly one — and "busy" means the fullest.
    return mode === "quiet" ? onGrid[0][0] : onGrid[onGrid.length - 1][0];
  }, want);

  if (!key) return { key: "", rows: 0 };
  await page.locator(`[data-day="${key}"]`).click();
  await page.waitForTimeout(600);
  return { key, rows: await page.locator('[data-testid="mobile-day-schedule"] li').count() };
}

async function shoot(browser: Browser, theme: "light" | "dark") {
  const context = await browser.newContext({
    viewport: PHONE,
    colorScheme: theme,
    hasTouch: true,
    isMobile: true,
    timezoneId: "Europe/Sofia",
  });
  await context.addInitScript(() => {
    try {
      localStorage.setItem("pmc.onboarding.v1", "shot");
    } catch {
      /* private mode */
    }
  });
  const page = await context.newPage();

  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await settle(page);

  const quiet = await selectDay(page, "quiet");
  await page.screenshot({ path: `${OUT}/month-quiet-day-${theme}.png` });
  console.log(`  month-quiet-day-${theme}: ${quiet.key} -> ${quiet.rows} event(s) listed`);

  const busy = await selectDay(page, "busy");
  await page.screenshot({ path: `${OUT}/month-busy-day-${theme}.png` });
  console.log(`  month-busy-day-${theme}: ${busy.key} -> ${busy.rows} event(s) listed`);

  // The add-to-calendar sheet, opened from a schedule row.
  await page.locator("[data-schedule-title]").first().click();
  await page.waitForTimeout(700);
  await page.getByRole("button", { name: /add to calendar/i }).first().click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/add-to-calendar-sheet-${theme}.png` });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  // Week: the view where events used to cross into the next day.
  await page.goto(`${BASE}?view=week`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await settle(page);
  await page.screenshot({ path: `${OUT}/week-${theme}.png` });

  /*
   * The same week, scrolled halfway — which is the state that used to be
   * broken twice over: chips spilling into the next day, and the hour axis
   * leaving the screen entirely.
   *
   * The scroller is found by walking up until something actually overflows,
   * not by counting `parentElement` hops. The hop count was right for one
   * layout and silently wrong the moment the week's scroll containers moved.
   */
  const scrolled = await page.evaluate(() => {
    let node = document.querySelector("[data-week-col]") as HTMLElement | null;
    while (node && node.scrollWidth <= node.clientWidth + 1) node = node.parentElement;
    if (!node) return false;
    node.scrollLeft = (node.scrollWidth - node.clientWidth) * 0.5;
    return true;
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/week-scrolled-${theme}.png` });
  console.log(`  week-scrolled-${theme}: ${scrolled ? "scrolled" : "no scroller found"}`);

  await context.close();
}

async function shootOnboarding(browser: Browser, theme: "light" | "dark") {
  const context = await browser.newContext({
    viewport: PHONE,
    colorScheme: theme,
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForSelector('[role="dialog"]', { timeout: 30_000 });
  // Let the 3.4s loop reach its resting frame rather than catching it mid-morph.
  await page.waitForTimeout(2600);

  for (let step = 1; step <= 3; step++) {
    if (step > 1) {
      await page.getByRole("button", { name: /^next$/i }).click();
      await page.waitForTimeout(2600);
    }
    await page.screenshot({ path: `${OUT}/onboarding-step${step}-${theme}.png` });
  }
  await context.close();
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    executablePath: resolveChromium(),
    // The sandbox proxies outbound traffic and 403s some local chunk URLs.
    args: ["--proxy-bypass-list=127.0.0.1;localhost"],
  });

  for (const theme of ["light", "dark"] as const) {
    console.log(`\n${theme}`);
    await shoot(browser, theme);
    await shootOnboarding(browser, theme);
  }

  await browser.close();
  console.log(`\nWrote screenshots to ${OUT}/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
