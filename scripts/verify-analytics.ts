/**
 * Production analytics verification.
 *
 * Answers one question that no amount of reading the source can: does a real
 * browser, loading the real deployed site, actually send a `page_view` that
 * Google accepts?
 *
 * Reading `dataLayer` is not that question. `dataLayer` is a queue of
 * *intentions*; it looks identical whether `gtag.js` loaded and shipped the hit
 * or was blocked, failed, or never ran. So this asserts on the network: the
 * request to `googletagmanager.com`, the POST to `/g/collect`, its `tid`, its
 * `en=page_view`, and the status Google returned.
 *
 *   npx tsx scripts/verify-analytics.ts [url]
 *
 * ## The bridge
 *
 * Some sandboxes (including the one this was written in) give Chromium no
 * outbound network at all, while Node can still reach the internet. When the
 * first navigation fails at the connection level, every request is re-issued
 * through Playwright's Node-side stack and handed back to the page. The browser
 * still parses, executes, schedules and fires everything itself — only the
 * transport changes — and the run says loudly when it is in that mode, because
 * a verification that quietly changes what it is testing is worse than none.
 */
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { existsSync, readdirSync } from "node:fs";

const SITE = (process.argv[2] ?? "https://calendarpolymarket.com").replace(/\/$/, "");
const EXPECTED_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID ?? "G-FC9TGS890K";

const GOOGLE = /googletagmanager\.com|google-analytics\.com|analytics\.google\.com/;

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
}

function resolveChromium(): string | undefined {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!root || !existsSync(root)) return undefined;
  const dir = readdirSync(root).find((d) => /^chromium-\d+$/.test(d));
  if (!dir) return undefined;
  const candidate = `${root}/${dir}/chrome-linux/chrome`;
  return existsSync(candidate) ? candidate : undefined;
}

type Hit = { method: string; url: string; status?: number };

/** Everything the page did that touched Google, in order. */
function watch(page: Page) {
  const requests: Hit[] = [];
  const errors: string[] = [];
  page.on("request", (r) => {
    if (GOOGLE.test(r.url())) requests.push({ method: r.method(), url: r.url() });
  });
  page.on("response", (r) => {
    if (!GOOGLE.test(r.url())) return;
    const hit = requests.find((h) => h.url === r.url() && h.status === undefined);
    if (hit) hit.status = r.status();
  });
  page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 160)));
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message.slice(0, 160)}`));
  return { requests, errors };
}

const collects = (hits: Hit[]) => hits.filter((h) => h.url.includes("/g/collect"));
const eventName = (url: string) => new URL(url).searchParams.get("en") ?? "";
const pageViews = (hits: Hit[]) => collects(hits).filter((h) => eventName(h.url) === "page_view");

async function open(browser: Browser, bridged: boolean): Promise<BrowserContext> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  if (bridged) {
    await context.route("**/*", async (route) => {
      try {
        await route.fulfill({ response: await route.fetch({ timeout: 45_000 }) });
      } catch {
        await route.abort();
      }
    });
  }
  // Onboarding is a dialog over the calendar; it does not gate the tag, but it
  // does sit in front of the controls the second half of this run clicks.
  await context.addInitScript(() => {
    try {
      localStorage.setItem("pmc.onboarding.v1", "verified");
    } catch {
      /* private mode */
    }
  });
  return context;
}

async function main() {
  console.log(`\n=== ANALYTICS IN PRODUCTION (${SITE}) ===`);

  /* ------------------------------------------------- served HTML and headers */

  const res = await fetch(SITE);
  const html = await res.text();
  check("the site responds 200", res.status === 200, String(res.status));
  check(
    "the measurement ID is in the served HTML",
    html.includes(EXPECTED_ID),
    html.includes(EXPECTED_ID) ? EXPECTED_ID : "absent",
  );
  check(
    "the gtag.js tag is in the served HTML",
    html.includes(`googletagmanager.com/gtag/js?id=${EXPECTED_ID}`),
  );
  /*
   * A CSP without `googletagmanager.com` in `script-src`, or without Google's
   * collect endpoints in `connect-src`, silently kills the tag in the browser
   * while leaving the markup looking perfect.
   */
  const csp =
    res.headers.get("content-security-policy") ??
    res.headers.get("content-security-policy-report-only");
  check(
    "no Content-Security-Policy blocks the tag",
    !csp || (csp.includes("googletagmanager.com") && csp.includes("google-analytics.com")),
    csp ? csp.slice(0, 120) : "no CSP header",
  );

  /* ------------------------------------------------------- the actual request */

  const browser = await chromium.launch({
    executablePath: resolveChromium(),
    /*
     * `bypass` is not optional. Playwright's proxy setting ignores the NO_PROXY
     * environment variable, so without it a run against a local build sends
     * `http://127.0.0.1:3000` to the proxy as a plain-HTTP request, gets 405 back
     * for every asset, and reports the app as broken when the harness is.
     */
    proxy: process.env.HTTPS_PROXY
      ? { server: process.env.HTTPS_PROXY, bypass: "localhost,127.0.0.1,::1" }
      : undefined,
  });

  let bridged = false;
  let context = await open(browser, false);
  let page = await context.newPage();
  let seen = watch(page);
  try {
    await page.goto(SITE, { waitUntil: "domcontentloaded", timeout: 60_000 });
  } catch (error) {
    const message = String((error as Error).message);
    if (!/ERR_CONNECTION|ERR_NAME_NOT_RESOLVED|ERR_PROXY/.test(message)) throw error;
    console.log(
      "  NOTE  this browser has no outbound network; re-running with every\n" +
        "        request bridged through Node. The page still executes normally.",
    );
    bridged = true;
    await context.close();
    context = await open(browser, true);
    page = await context.newPage();
    seen = watch(page);
    await page.goto(SITE, { waitUntil: "domcontentloaded", timeout: 120_000 });
  }
  await page.waitForTimeout(15_000);

  const gtag = seen.requests.find((h) => h.url.includes("googletagmanager.com/gtag/js"));
  check("gtag.js is requested from googletagmanager.com", Boolean(gtag), gtag?.url ?? "never requested");
  check("gtag.js loads", gtag?.status === 200, gtag ? `HTTP ${gtag.status}` : "no response");

  const loaded = await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    return {
      gtag: typeof w.gtag,
      dataLayerIsArray: Array.isArray(w.dataLayer),
      dataLayerLength: Array.isArray(w.dataLayer) ? (w.dataLayer as unknown[]).length : -1,
      tagData: typeof w.google_tag_data,
    };
  });
  /*
   * These two are the difference between "the tag is on the page" and "the tag
   * is running". The inline init script defines both, so if either is missing
   * the component never rendered on the client — which is exactly how this
   * broke: a `"use client"` wrapper compiled against a build environment with no
   * measurement ID returned `null`, while the server still emitted the preload.
   */
  check(
    'typeof window.gtag === "function"',
    loaded.gtag === "function",
    `typeof window.gtag = ${loaded.gtag}`,
  );
  check(
    "Array.isArray(window.dataLayer) === true",
    loaded.dataLayerIsArray,
    `Array.isArray = ${loaded.dataLayerIsArray}, length = ${loaded.dataLayerLength}`,
  );
  // `google_tag_data` is created by gtag.js itself, so it separates "the inline
  // stub ran" from "the real library is up".
  check(
    "gtag.js actually initialised, not just the inline stub",
    loaded.tagData === "object",
    `google_tag_data=${loaded.tagData}`,
  );

  const views = pageViews(seen.requests);
  check(
    "a page_view is actually sent on initial load",
    views.length >= 1,
    `${views.length} page_view of ${collects(seen.requests).length} collect hit(s)`,
  );
  if (views[0]) {
    const params = new URL(views[0].url).searchParams;
    check(
      "the page_view carries the right measurement ID",
      params.get("tid") === EXPECTED_ID,
      `tid=${params.get("tid")}`,
    );
    check(
      "the page_view names this site as its location",
      (params.get("dl") ?? "").startsWith(SITE),
      `dl=${params.get("dl")}`,
    );
    // 2xx is Google accepting the hit. Anything else and it never lands.
    check(
      "Google accepts the hit",
      views[0].status !== undefined && views[0].status >= 200 && views[0].status < 300,
      `HTTP ${views[0].status}`,
    );
  }
  check("no console errors on load", seen.errors.length === 0, seen.errors.slice(0, 2).join(" | "));

  /* --------------------------------------------- what filtering does, reported */

  /*
   * Not an assertion, on purpose.
   *
   * This app keeps view, month, selected day and every filter in the query
   * string, written with `history.replaceState`, and GA4's "page changes based
   * on browser history events" reports each of those as its own page view. That
   * inflates the numbers — six page views for one visitor ticking five boxes —
   * and it is worth fixing. But suppressing it while basic collection was broken
   * is what made the real fault hard to see, so this now only measures and says.
   */
  const before = collects(seen.requests).length;
  try {
    for (const id of ["sports", "crypto", "ai"]) {
      await page
        .locator(`#calendar-sidebar [data-category-row='${id}'] [role='checkbox']`)
        .first()
        .click({ timeout: 30_000 });
      await page.waitForTimeout(1200);
    }
    await page.waitForTimeout(6000);
    const extra = collects(seen.requests).slice(before);
    const extraViews = extra.filter((h) => eventName(h.url) === "page_view").length;
    console.log(
      `  NOTE  three filter clicks produced ${extraViews} further page_view(s)` +
        ` and ${extra.length - extraViews} other hit(s). Each filter click rewrites` +
        `\n        the URL, so GA counts it as a page. Worth optimising once` +
        ` collection is confirmed.`,
    );
  } catch {
    console.log("  NOTE  filter-click observation skipped (controls not reachable)");
  }

  await browser.close();

  console.log(
    `\n${failures === 0 ? "ANALYTICS VERIFIED" : `${failures} CHECK(S) FAILED`}` +
      `${bridged ? " (browser transport bridged through Node)" : ""}\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main();
