/**
 * Drives the Sport / eSport sub-filter in a real browser, against a real build.
 *
 *   npx tsx scripts/verify-sub-filters.ts [baseUrl]
 *
 * The unit tests prove the rules; this proves the wiring — that the popover
 * opens, that ticking a box changes the request the browser makes, that the
 * summary line degrades instead of wrapping, and that none of it overflows an
 * iPhone. Those are the failures a filter-pipeline test cannot see.
 */
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

const BASE = process.argv[2] ?? "http://127.0.0.1:3210";
const SHOTS = "artifacts/sub-filters";

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

async function shim(context: BrowserContext) {
  await context.addInitScript(() => {
    const g = globalThis as unknown as Record<string, unknown>;
    if (typeof g.__name !== "function") g.__name = (fn: unknown) => fn;
    try {
      localStorage.setItem("pmc.onboarding.v1", "verified");
    } catch {
      /* private mode */
    }
  });
  /*
   * Robot visits must never reach the real analytics property — a full run is
   * a few hundred page loads, and letting them through would put a day of fake
   * traffic into a real report.
   *
   * Fulfilled empty rather than aborted. An aborted request surfaces as
   * `net::ERR_FAILED` in the console, which this script then reports as a page
   * error — the harness manufacturing the failure it is looking for. Verified
   * against an unblocked run: the page makes zero failed requests.
   */
  const swallow = (r: import("playwright").Route) =>
    r.fulfill({ status: 204, body: "" });
  await context.route("**://*.google-analytics.com/**", swallow);
  await context.route("**://*.googletagmanager.com/**", swallow);
}

async function settle(page: Page) {
  await page
    .waitForFunction(() => !document.body.textContent?.includes("Loading events…"), undefined, {
      timeout: 20_000,
    })
    .catch(() => {});
  await page.waitForTimeout(600);
}

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const browser: Browser = await chromium.launch({ executablePath: resolveChromium() });

  /* ------------------------------------------------------------- desktop */

  console.log(`\n=== DESKTOP (${BASE}) ===`);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await shim(context);
  const page = await context.newPage();

  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

  /** Every /api/events request the browser makes, with its `deep` flag. */
  const requests: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/events")) requests.push(r.url());
  });

  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await settle(page);

  const sportTrigger = page.locator("[data-sub-filter='sport']");
  const esportTrigger = page.locator("[data-sub-filter='esport']");
  /*
   * One, not two. Both sidebar shells are always in the tree, but vaul mounts
   * the drawer's *content* only when it opens, so at desktop width only the
   * rail's copy exists. The mobile one is asserted separately below, after the
   * drawer is opened.
   */
  check("Sport sub-filter is present", (await sportTrigger.count()) === 1, `${await sportTrigger.count()} found`);
  check("eSport sub-filter is present", (await esportTrigger.count()) === 1);

  const visibleSport = sportTrigger.locator("visible=true").first();
  check(
    "defaults to All Sports",
    (await visibleSport.getAttribute("data-sub-filter-summary")) === "All Sports",
    (await visibleSport.getAttribute("data-sub-filter-summary")) ?? "",
  );

  const deepBefore = requests.filter((u) => u.includes("deep=1")).length;
  check("no deep request while unnarrowed", deepBefore === 0, `${deepBefore} deep requests`);

  /* The summary must never make the row taller than a single line. */
  const oneLine = await visibleSport.evaluate((el) => el.getBoundingClientRect().height);

  await visibleSport.click();
  await page.waitForTimeout(350);
  const popover = page.locator("[data-sub-filter-all]").first();
  check("popover opens", await popover.isVisible());

  const options = page.locator("[data-sub-filter-option]");
  check("lists every sport", (await options.count()) === 10, `${await options.count()}`);

  // Untick "All Sports", then tick Tennis — the §32 transition into subset mode.
  await popover.locator("button[role='checkbox']").click();
  await page.waitForTimeout(250);
  await page.locator("[data-sub-filter-option='tennis'] button[role='checkbox']").click();
  await page.waitForTimeout(300);
  await page.keyboard.press("Escape");
  await settle(page);

  const summary = await visibleSport.getAttribute("data-sub-filter-summary");
  check("summary names the sport", summary === "Tennis", summary ?? "");

  const url = new URL(page.url());
  check("URL carries the selection", url.searchParams.get("sports") === "tennis", page.url());

  const deepAfter = requests.filter((u) => u.includes("deep=1")).length;
  check("narrowing triggers a deep request", deepAfter > 0, `${deepAfter} deep requests`);

  const afterHeight = await visibleSport.evaluate((el) => el.getBoundingClientRect().height);
  check("summary row does not grow", Math.abs(afterHeight - oneLine) < 2, `${oneLine}px → ${afterHeight}px`);

  /* Many selected must degrade to a count rather than wrap. */
  await visibleSport.click();
  await page.waitForTimeout(300);
  for (const id of ["soccer", "baseball", "basketball", "hockey"]) {
    await page.locator(`[data-sub-filter-option='${id}'] button[role='checkbox']`).click();
    await page.waitForTimeout(120);
  }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  const manySummary = await visibleSport.getAttribute("data-sub-filter-summary");
  check("degrades to a count when many are picked", manySummary === "5 selected", manySummary ?? "");
  const manyHeight = await visibleSport.evaluate((el) => el.getBoundingClientRect().height);
  check("still one line", Math.abs(manyHeight - oneLine) < 2, `${manyHeight}px`);

  /* Re-ticking everything must normalise back to All Sports (§32). */
  await visibleSport.click();
  await page.waitForTimeout(300);
  await page.locator("[data-sub-filter-all] button[role='checkbox']").click();
  await page.waitForTimeout(300);
  await page.keyboard.press("Escape");
  await settle(page);
  const normalised = await visibleSport.getAttribute("data-sub-filter-summary");
  check("All normalises back", normalised === "All Sports", normalised ?? "");
  check(
    "and the URL goes clean again",
    new URL(page.url()).searchParams.get("sports") === null,
    page.url(),
  );

  await page.screenshot({ path: `${SHOTS}/desktop.png` });

  /* A shared narrowed link must be correct on first paint. */
  await page.goto(`${BASE}/?categories=sports&sports=tennis`, { waitUntil: "domcontentloaded" });
  await settle(page);
  const linkSummary = await sportTrigger
    .locator("visible=true")
    .first()
    .getAttribute("data-sub-filter-summary");
  check("a shared link restores the selection", linkSummary === "Tennis", linkSummary ?? "");
  const shownTennis = await page.locator("[data-event-title]").count();
  check("and renders events", shownTennis > 0, `${shownTennis} events`);

  await context.close();

  /* -------------------------------------------------------------- iPhone */

  console.log("\n=== iPhone 15 (393×852) ===");
  const mobile = await browser.newContext({
    viewport: { width: 393, height: 852 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });
  await shim(mobile);
  const m = await mobile.newPage();
  m.on("pageerror", (e) => errors.push(`mobile pageerror: ${e.message}`));
  await m.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await settle(m);

  // Open the filter drawer.
  await m.locator("[aria-controls='calendar-sidebar']").first().click();
  await m.waitForTimeout(600);
  const mSport = m.locator("[data-testid='sidebar-drawer'] [data-sub-filter='sport']").first();
  check("sub-filter reachable in the drawer", await mSport.isVisible());

  const box = await mSport.boundingBox();
  check("trigger is a usable tap target", (box?.height ?? 0) >= 32, `${box?.height ?? 0}px tall`);

  await mSport.click();
  await m.waitForTimeout(500);
  const mPop = m.locator("[data-sub-filter-all]").first();
  check("popover opens on a phone", await mPop.isVisible());

  const overflow = await m.evaluate(() => {
    const el = document.querySelector("[data-sub-filter-all]")?.closest("[role='dialog'],[data-radix-popper-content-wrapper]") as HTMLElement | null;
    const r = el?.getBoundingClientRect();
    return r ? { left: r.left, right: r.right, width: r.width, vw: window.innerWidth } : null;
  });
  check(
    "popover stays inside the viewport",
    !!overflow && overflow.left >= -1 && overflow.right <= overflow.vw + 1,
    overflow ? `left ${overflow.left.toFixed(0)}, right ${overflow.right.toFixed(0)} of ${overflow.vw}` : "not found",
  );

  const bodyScroll = await m.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  check("no horizontal page scroll", bodyScroll <= 1, `${bodyScroll}px`);

  await m.screenshot({ path: `${SHOTS}/iphone.png` });
  await mobile.close();
  await browser.close();

  check("no console errors", errors.length === 0, errors.slice(0, 3).join(" | "));

  console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
