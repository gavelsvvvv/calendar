/**
 * Drives the Sport / eSport picker in a real browser, against a real build.
 *
 *   npx tsx scripts/verify-sub-filters.ts [baseUrl]
 *
 * The unit tests prove the rules; this proves the wiring — that the tune button
 * opens the picker without toggling the category beside it, that ticking a tile
 * changes the request the browser makes, that the sidebar stays eleven rows
 * tall whatever is selected, and that none of it overflows an iPhone. Those are
 * the failures a filter-pipeline test cannot see.
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

/** The one open picker, whichever frame it is in. */
function panel(page: Page) {
  return page.locator("[data-sub-filter-all]").first();
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

  /** Every /api/events request the browser makes, with its `targeted` tiers. */
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
  check("Sport picker button is present", (await sportTrigger.count()) === 1, `${await sportTrigger.count()} found`);
  check("eSport picker button is present", (await esportTrigger.count()) === 1);

  const visibleSport = sportTrigger.locator("visible=true").first();
  check(
    "defaults to All Sports",
    (await visibleSport.getAttribute("data-sub-filter-summary")) === "All Sports",
    (await visibleSport.getAttribute("data-sub-filter-summary")) ?? "",
  );
  check(
    "and the button is not flagged as narrowed",
    (await visibleSport.getAttribute("data-sub-filter-narrowed")) === "false",
  );

  const targetedBefore = requests.filter((u) => u.includes("targeted=")).length;
  check(
    "no targeted request while unnarrowed",
    targetedBefore === 0,
    `${targetedBefore} targeted requests`,
  );

  /*
   * §UX-1: the sidebar is eleven rows and stays eleven rows.
   *
   * This is the whole point of the redesign, so it is measured rather than
   * eyeballed: the count of category rows, and the height of the Sports row
   * against a row that has no picker at all. A second level that reappears as
   * an extra line under Sport would move both numbers.
   */
  const rowGeometry = () =>
    page.evaluate(() => {
      const rows = [...document.querySelectorAll<HTMLElement>("#calendar-sidebar [data-category-row]")];
      const height = (id: string) =>
        Math.round(
          rows.find((r) => r.getAttribute("data-category-row") === id)?.getBoundingClientRect()
            .height ?? 0,
        );
      return {
        rows: rows.length,
        sports: height("sports"),
        esports: height("esports"),
        politics: height("politics"),
        /* Anything claiming to be a sub-filter that is *not* the two buttons. */
        strays: document.querySelectorAll("#calendar-sidebar [data-sub-filter-option]").length,
      };
    });

  const before = await rowGeometry();
  check("the category list is eleven rows", before.rows === 11, `${before.rows} rows`);
  check(
    "Sport is the same height as a category with no picker",
    before.sports === before.politics && before.esports === before.politics,
    `sports ${before.sports}px, esports ${before.esports}px, politics ${before.politics}px`,
  );
  check("no sport tiles are rendered in the sidebar itself", before.strays === 0, `${before.strays}`);

  /*
   * §UX-2: the two gestures are independent.
   *
   * Opening the picker must not toggle Sport, and it must stay usable when
   * Sport is off — that is what lets a reader configure a category before
   * switching it on.
   */
  const sportChecked = () =>
    page
      .locator("#calendar-sidebar [data-category-row='sports'] [role='checkbox']")
      .first()
      .getAttribute("data-state");

  const tickedBefore = await sportChecked();
  await visibleSport.click();
  await page.waitForTimeout(350);
  check("the picker opens", await panel(page).isVisible());
  check(
    "and opening it does not toggle the category",
    (await sportChecked()) === tickedBefore,
    `${tickedBefore} → ${await sportChecked()}`,
  );

  /*
   * §UX-3: it opens in the *middle of the page*, not beside the rail.
   *
   * The redesign's entire premise, and nothing else in this file would notice
   * it being undone: a build that kept the anchored popover passes every other
   * check here. Measured as the panel's own centre against the viewport's, with
   * a 2px tolerance for sub-pixel centring — and separately as clearing the
   * sidebar, which is the specific thing the old frame did wrong.
   */
  const centring = async (p: Page) =>
    p.evaluate(() => {
      const el = document.querySelector<HTMLElement>("[data-testid='sub-filter-panel']");
      const rail = document.querySelector<HTMLElement>("#calendar-sidebar");
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        dx: Math.abs((r.left + r.right) / 2 - window.innerWidth / 2),
        dy: Math.abs((r.top + r.bottom) / 2 - window.innerHeight / 2),
        left: r.left,
        top: r.top,
        bottom: r.bottom,
        width: r.width,
        vw: window.innerWidth,
        vh: window.innerHeight,
        railRight: rail?.getBoundingClientRect().right ?? 0,
      };
    });

  const centred = await centring(page);
  check(
    "and it is centred in the viewport",
    !!centred && centred.dx <= 2 && centred.dy <= 2,
    centred ? `off centre by ${centred.dx.toFixed(1)}×${centred.dy.toFixed(1)}px` : "no panel",
  );
  check(
    "and it clears the sidebar entirely",
    !!centred && centred.left > centred.railRight,
    centred ? `panel left ${centred.left.toFixed(0)}, rail right ${centred.railRight.toFixed(0)}` : "",
  );
  check(
    "and it is between 520 and 680px wide",
    !!centred && centred.width >= 520 && centred.width <= 680,
    `${centred?.width.toFixed(0)}px`,
  );
  check(
    "and it fits the window vertically",
    !!centred && centred.top >= 0 && centred.bottom <= centred.vh,
    centred ? `top ${centred.top.toFixed(0)}, bottom ${centred.bottom.toFixed(0)} of ${centred.vh}` : "",
  );

  /*
   * The calendar recedes behind a wash rather than a black curtain.
   *
   * Read off the composited pixel rather than off the class list, because the
   * requirement is about what a reader sees: the scrim has to be see-through,
   * it has to blur, and it must not be dark. `getComputedStyle` is asked for
   * the alpha and the *lightness*, and the browser is free to serialise the
   * colour however it likes — Chromium hands back `lab(98.2 … / 0.6)` for an
   * `oklch()` author value, so nothing here may pattern-match on `rgba(`.
   */
  const scrim = await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>(".glass-scrim");
    if (!el) return null;
    const cs = getComputedStyle(el);
    const bg = cs.backgroundColor;
    // The alpha, from any of the forms a browser may serialise a colour into.
    const slash = /\/\s*([0-9.]+)\s*\)/.exec(bg);
    const rgba = /^rgba?\([^)]*,\s*([0-9.]+)\s*\)$/.exec(bg);
    const alpha = slash ? Number(slash[1]) : rgba ? Number(rgba[1]) : 1;
    /*
     * And the perceived lightness — painted, not parsed.
     *
     * Reading it out of `getComputedStyle` needs a colour-space converter for
     * whatever the browser chose to serialise into; a 1×1 canvas makes the
     * browser do that conversion itself and hands back sRGB bytes. Composited
     * over opaque white first, because the alpha is the point: what a reader
     * sees is this colour *over the page*.
     */
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d");
    let lum: number | null = null;
    if (ctx) {
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, 1, 1);
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
      lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    }
    return {
      bg,
      alpha,
      lum,
      filter: cs.backdropFilter || cs.getPropertyValue("-webkit-backdrop-filter"),
    };
  });
  check(
    "the backdrop is translucent, not an opaque curtain",
    !!scrim && scrim.alpha > 0 && scrim.alpha < 0.9,
    scrim ? `alpha ${scrim.alpha}` : "no scrim",
  );
  check(
    "and it blurs what is behind it",
    !!scrim && scrim.filter.includes("blur"),
    scrim?.filter ?? "",
  );
  /* The brief is explicit: a light wash, never a dark scrim. Only asserted in
     the light theme, which is the one this suite runs in. */
  check(
    "and it is a light wash rather than a dark one",
    !!scrim && scrim.lum !== null && scrim.lum > 0.7,
    scrim ? `${scrim.bg} — luminance ${scrim.lum?.toFixed(2)}` : "",
  );

  /*
   * Exactly one picker body in the document.
   *
   * Both sidebars — the rail and the drawer's — are always mounted, so each
   * sub-filtered category instantiates two `SubFilter`s. Only Radix's
   * open-gated portal keeps that from putting two live copies of the grid in
   * the DOM, where `.first()` in this file would happily drive the hidden one.
   */
  const bodies = await page.locator("[data-sub-filter-all]").count();
  check("exactly one picker body exists", bodies === 1, `${bodies}`);

  const options = page.locator("[data-sub-filter-option]");
  check("lists every sport", (await options.count()) === 10, `${await options.count()}`);

  /*
   * Every mark is present *and decoded*.
   *
   * `naturalWidth`, not a count of `<img>` tags. The option tables in
   * `sport-icons.tsx` are exhaustive `Record`s over the id unions, so a sport
   * added without artwork is a type error — but nothing in the type system
   * notices a file deleted from `public/logos/sports`, and a broken image is
   * silent in a browser. This is the check that would catch it.
   */
  const marks = () =>
    page.evaluate(() =>
      [...document.querySelectorAll("[data-sub-filter-option]")].map((tile) => {
        const img = tile.querySelector("img");
        return {
          id: tile.getAttribute("data-sub-filter-option") ?? "?",
          src: img?.getAttribute("src") ?? "",
          loaded: !!img && img.complete && img.naturalWidth > 0,
        };
      }),
    );

  const sportMarks = await marks();
  const brokenSport = sportMarks.filter((m) => !m.loaded);
  check(
    "every option carries a logo, and every logo decodes",
    sportMarks.length === 10 && brokenSport.length === 0,
    brokenSport.length ? brokenSport.map((m) => `${m.id}→${m.src}`).join(", ") : `${sportMarks.length} logos`,
  );

  for (const [id, label] of [
    ["tennis", "Tennis"],
    ["american-football", "NFL"],
    ["basketball", "NBA"],
  ] as const) {
    const tile = page.locator(`[data-sub-filter-option='${id}']`).first();
    const text = ((await tile.textContent()) ?? "").trim();
    check(
      `${id} is offered as "${label}" with its own mark`,
      text.startsWith(label) &&
        (await tile.locator("img").getAttribute("src")) === `/logos/sports/${id}.webp`,
      `${text} · ${await tile.locator("img").getAttribute("src")}`,
    );
  }

  /*
   * The tooltip's separator and its shape.
   *
   * A middle dot, never an em dash — an em dash between a name and a number
   * reads as a sentence break rather than as a label and its value. Asserted
   * on the rendered `title` of every tile at once, so a single stray one fails.
   */
  const titles = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("[data-sub-filter-option]")].map(
      (el) => el.getAttribute("title") ?? "",
    ),
  );
  const wellFormed = titles.filter((t) => /^.+ · \d+ events?$/.test(t));
  check(
    "every tooltip reads \"Name · N events\"",
    titles.length > 0 && wellFormed.length === titles.length,
    titles.filter((t) => !/^.+ · \d+ events?$/.test(t)).join(" | ") || titles[0],
  );
  check(
    "and none of them uses an em dash",
    titles.every((t) => !t.includes("—")),
    titles.filter((t) => t.includes("—")).join(" | "),
  );

  /*
   * The number in the tooltip is the number on the tile.
   *
   * `countsBySport` feeds both, and the check is here rather than in a unit
   * test because the thing worth proving is that the two surfaces the reader
   * compares cannot disagree — not that the function returns what it returns.
   */
  const tileCounts = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("[data-sub-filter-option]")].map((el) => {
      const title = el.getAttribute("title") ?? "";
      const spans = el.querySelectorAll("span");
      return {
        id: el.getAttribute("data-sub-filter-option") ?? "?",
        fromTitle: Number(title.split(" · ")[1]?.split(" ")[0] ?? NaN),
        printed: Number(spans[spans.length - 1]?.textContent?.trim() ?? NaN),
      };
    }),
  );
  const mismatched = tileCounts.filter((t) => t.fromTitle !== t.printed);
  check(
    "and it is the same number the tile prints",
    mismatched.length === 0,
    mismatched.map((t) => `${t.id} ${t.printed}≠${t.fromTitle}`).join(", "),
  );

  /* How many events the grid is showing right now, across every category. */
  const gridCount = () =>
    page.evaluate(() => document.querySelectorAll("[data-event-title]").length);
  const eventsBefore = await gridCount();
  check("the grid has events before any narrowing", eventsBefore > 0, `${eventsBefore}`);

  // Untick "All Sports", then tick Tennis — the transition into subset mode.
  await panel(page).locator("button[role='checkbox']").click();
  await page.waitForTimeout(250);
  await page.locator("[data-sub-filter-option='tennis']").click();
  await page.waitForTimeout(300);
  await page.keyboard.press("Escape");
  await settle(page);

  const summary = await visibleSport.getAttribute("data-sub-filter-summary");
  check("the button's summary names the sport", summary === "Tennis", summary ?? "");
  check(
    "the button is flagged as narrowed",
    (await visibleSport.getAttribute("data-sub-filter-narrowed")) === "true",
  );
  /*
   * The row's own summary, and the fact that it *fits*.
   *
   * The fitting half is the regression guard. The rail leaves this text 55px
   * and two earlier drafts budgeted it by arithmetic rather than by measuring,
   * so the row shipped rendering "Tennis · …" — broken-looking and naming
   * nothing. `scrollWidth > clientWidth` is the browser saying it had to cut.
   */
  const inlineSummary = () =>
    page.evaluate(() => {
      const el = document.querySelector<HTMLElement>(
        "#calendar-sidebar [data-category-row='sports'] [data-category-sub-summary]",
      );
      if (!el) return null;
      return {
        text: el.getAttribute("data-category-sub-summary"),
        clipped: el.scrollWidth > el.clientWidth + 1,
        width: [Math.round(el.clientWidth), Math.round(el.scrollWidth)],
      };
    });

  const inlineOne = await inlineSummary();
  check("and the Sport row says so inline", inlineOne?.text === "Tennis", inlineOne?.text ?? "absent");
  check(
    "and the row's summary is not cut off",
    inlineOne?.clipped === false,
    `${inlineOne?.width?.[1]}px into ${inlineOne?.width?.[0]}px`,
  );
  check(
    "while the button's own name carries the full selection",
    (await visibleSport.getAttribute("aria-label")) === "Choose sports · Tennis",
    (await visibleSport.getAttribute("aria-label")) ?? "",
  );

  const url = new URL(page.url());
  check("URL carries the selection", url.searchParams.get("sports") === "tennis", page.url());

  /*
   * The narrowing has to buy the *sports* tier and nothing else, which is the
   * assertion the regression was hiding behind. A shared flag would have made
   * this pass while the browser fetched both.
   */
  const sportsTier = requests.filter((u) => u.includes("targeted=sports")).length;
  const esportsTier = requests.filter((u) => u.includes("targeted=esports")).length;
  check("narrowing Sport requests the sports tier", sportsTier > 0, `${sportsTier} requests`);
  check(
    "and never the esport tier",
    esportsTier === 0,
    requests.filter((u) => u.includes("targeted=")).join(" "),
  );

  /*
   * **BUG 1 / BUG 2, guarded in the browser.**
   *
   * Narrowing changes the month's cache key, and the key it changes to has
   * never been fetched. Before `readMonthFor`, the calendar read that empty
   * entry and rendered nothing — so ticking Tennis emptied politics, crypto and
   * every other category too, and permanently if the new request failed. The
   * grid must never pass through zero, whatever the network does.
   */
  const eventsAfter = await gridCount();
  check(
    "narrowing never empties the calendar",
    eventsAfter > 0,
    `${eventsBefore} → ${eventsAfter} events`,
  );

  const narrowedGeometry = await rowGeometry();
  check(
    "the Sport row does not grow when narrowed",
    narrowedGeometry.sports === before.sports && narrowedGeometry.rows === 11,
    `${before.sports}px → ${narrowedGeometry.sports}px, ${narrowedGeometry.rows} rows`,
  );

  /* Many selected must degrade to a count rather than wrap. */
  await visibleSport.click();
  await page.waitForTimeout(300);
  for (const id of ["soccer", "baseball", "basketball", "hockey"]) {
    await page.locator(`[data-sub-filter-option='${id}']`).click();
    await page.waitForTimeout(120);
  }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  const manySummary = await visibleSport.getAttribute("data-sub-filter-summary");
  check("degrades to a count when many are picked", manySummary === "5 of 10", manySummary ?? "");
  const manyGeometry = await rowGeometry();
  check(
    "and the row is still one line",
    manyGeometry.sports === before.sports,
    `${manyGeometry.sports}px vs ${before.sports}px`,
  );
  const inlineMany = await inlineSummary();
  check(
    "the count form fits too",
    inlineMany?.clipped === false,
    `${inlineMany?.text} — ${inlineMany?.width?.[1]}px into ${inlineMany?.width?.[0]}px`,
  );
  check(
    "and the button still names all five",
    (await visibleSport.getAttribute("aria-label")) ===
      "Choose sports · Tennis, NBA, Soccer, MLB, NHL",
    (await visibleSport.getAttribute("aria-label")) ?? "",
  );

  /* A picked tile un-picks. */
  await visibleSport.click();
  await page.waitForTimeout(300);
  check(
    "a picked tile reports itself as checked",
    (await page.locator("[data-sub-filter-option='tennis']").getAttribute("aria-checked")) === "true",
  );
  await page.locator("[data-sub-filter-option='tennis']").click();
  await page.waitForTimeout(300);
  check(
    "clicking it again un-picks it",
    (await page.locator("[data-sub-filter-option='tennis']").getAttribute("aria-checked")) === "false",
  );
  await page.keyboard.press("Escape");
  await settle(page);
  const afterDeselect = await visibleSport.getAttribute("data-sub-filter-summary");
  check("and the summary drops to four", afterDeselect === "4 of 10", afterDeselect ?? "");

  /* Re-ticking everything must normalise back to All Sports. */
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
  check(
    "and the row's inline summary goes away",
    (await page
      .locator("#calendar-sidebar [data-category-row='sports'] [data-category-sub-summary]")
      .count()) === 0,
  );

  await page.screenshot({ path: `${SHOTS}/desktop.png` });

  /*
   * §UX-4: the three ways out, and what each of them must not do.
   *
   * Every close in this file used to be Escape. Click-outside was untested, and
   * its interesting half is not that the panel closes — it is that the backdrop
   * *swallows* the click. The panel floats over the very sidebar row whose
   * checkbox it must never toggle, and a scrim that let a click through would
   * dismiss the picker and switch off Sport in one gesture.
   */
  await visibleSport.click();
  await page.waitForTimeout(350);
  const railBefore = await sportChecked();
  const railBox = await page
    .locator("#calendar-sidebar [data-category-row='sports']")
    .first()
    .boundingBox();
  // Aimed at the category row itself, which the scrim covers.
  await page.mouse.click((railBox?.x ?? 20) + 40, (railBox?.y ?? 20) + 8);
  await page.waitForTimeout(400);
  check("clicking outside closes the picker", (await panel(page).count()) === 0);
  check(
    "and the click does not reach the row underneath",
    (await sportChecked()) === railBefore,
    `${railBefore} → ${await sportChecked()}`,
  );

  /* Escape closes it, and focus comes back to the button that opened it. */
  await visibleSport.click();
  await page.waitForTimeout(350);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  check("Escape closes the picker", (await panel(page).count()) === 0);
  check(
    "and focus returns to the picker button",
    await page.evaluate(
      () => document.activeElement?.getAttribute("data-sub-filter") === "sport",
    ),
    (await page.evaluate(() => document.activeElement?.tagName ?? "?")) ?? "",
  );

  /* The X in the panel's own header closes it too. */
  await visibleSport.click();
  await page.waitForTimeout(350);
  await page.locator("[data-sub-filter-close]").first().click();
  await page.waitForTimeout(400);
  check("the close button closes it", (await panel(page).count()) === 0);

  /*
   * §UX-5: no label is cut off on a *pointer*, at either supported width and in
   * both pickers.
   *
   * The only clipping scan this file had ran on the phone and only ever opened
   * Sport — whose longest name is "Cricket". Every width regression the
   * three-column desktop grid can introduce lands on eSport, whose "Rocket
   * League" is the longest string either picker has to say, and none of it was
   * being looked at.
   */
  const clipScan = async (p: Page) =>
    p.evaluate(() =>
      [...document.querySelectorAll("[data-sub-filter-option]")]
        .map((tile) => {
          const label = tile.querySelector("span.truncate");
          return {
            id: tile.getAttribute("data-sub-filter-option") ?? "?",
            clipped: !!label && label.scrollWidth > label.clientWidth + 1,
          };
        })
        .filter((t) => t.clipped)
        .map((t) => t.id),
    );

  for (const width of [1440, 1280] as const) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(200);
    for (const which of ["sport", "esport"] as const) {
      await page.locator(`[data-sub-filter='${which}']`).locator("visible=true").first().click();
      await page.waitForTimeout(350);
      const clipped = await clipScan(page);
      check(`no ${which} label is cut off at ${width}`, clipped.length === 0, clipped.join(", "));
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(200);

  /*
   * The picker still works with the category switched off, and editing it there
   * leaves the category alone.
   */
  await page.goto(`${BASE}/?categories=crypto&sports=tennis`, { waitUntil: "domcontentloaded" });
  await settle(page);
  const offTrigger = sportTrigger.locator("visible=true").first();
  check("the picker button is still operable with Sport off", await offTrigger.isEnabled());
  await offTrigger.click();
  await page.waitForTimeout(350);
  check("it opens with Sport off", await panel(page).isVisible());
  check(
    "and says the category is switched off",
    (await page.locator("[data-sub-filter-parent-off]").count()) === 1,
  );
  await page.locator("[data-sub-filter-option='soccer']").click();
  await page.waitForTimeout(300);
  await page.keyboard.press("Escape");
  await settle(page);
  check(
    "editing it does not switch Sport on",
    (await sportChecked()) === "unchecked",
    (await sportChecked()) ?? "",
  );
  check(
    "and the edit is kept",
    new URL(page.url()).searchParams.get("sports") === "soccer,tennis",
    page.url(),
  );

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

  /*
   * §CASE 14/15 — the state survives a reload, and switching view cannot
   * disturb it.
   *
   * Both were live regressions rather than hypotheticals: the month key
   * carries the tier, so a view switch or a reload lands on the same key the
   * grid is already drawn from, and any drift between them shows up as a
   * changed count or an empty grid.
   */
  const rowCounts = () =>
    page.evaluate(() =>
      Object.fromEntries(
        [...document.querySelectorAll("[data-category-row]")].map((row) => [
          row.getAttribute("data-category-row") ?? "?",
          Number(row.querySelector("[data-category-count]")?.getAttribute("data-category-count") ?? -1),
        ]),
      ),
    );

  await page.goto(`${BASE}/?sports=tennis&esports=cs2`, { waitUntil: "domcontentloaded" });
  await settle(page);
  const afterLoad = { counts: await rowCounts(), events: await gridCount() };
  check(
    "CASE 14: a reload with both narrowed renders events",
    afterLoad.events > 0,
    `${afterLoad.events} events`,
  );

  await page.reload({ waitUntil: "domcontentloaded" });
  await settle(page);
  const reloaded = { counts: await rowCounts(), events: await gridCount() };
  const reloadDrift = Object.keys(afterLoad.counts)
    .filter((k) => afterLoad.counts[k] !== reloaded.counts[k])
    .map((k) => `${k} ${afterLoad.counts[k]}→${reloaded.counts[k]}`)
    .join(", ");
  check("CASE 14: and the counts survive it", reloadDrift === "", reloadDrift);
  check("CASE 14: and so does the grid", reloaded.events > 0, `${reloaded.events} events`);

  for (const view of ["week", "agenda", "month"] as const) {
    await page.goto(`${BASE}/?sports=tennis&esports=cs2&view=${view}`, {
      waitUntil: "domcontentloaded",
    });
    await settle(page);
    const counts = await rowCounts();
    const drift = Object.keys(afterLoad.counts)
      .filter((k) => afterLoad.counts[k] !== counts[k])
      .map((k) => `${k} ${afterLoad.counts[k]}→${counts[k]}`)
      .join(", ");
    check(`CASE 15: ${view} shows the same counts as month`, drift === "", drift);
    check(`CASE 15: ${view} is not empty`, (await gridCount()) > 0);
  }

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
  check("the picker button is reachable in the drawer", await mSport.isVisible());

  const box = await mSport.boundingBox();
  check("it is a usable tap target", (box?.height ?? 0) >= 32, `${box?.height ?? 0}px tall`);

  const drawerRows = await m.evaluate(() => {
    const scope = document.querySelector("[data-testid='sidebar-drawer']");
    const rows = [...(scope?.querySelectorAll<HTMLElement>("[data-category-row]") ?? [])];
    return {
      count: rows.length,
      shortest: Math.min(...rows.map((r) => Math.round(r.getBoundingClientRect().height))),
    };
  });
  check("the drawer list is eleven rows", drawerRows.count === 11, `${drawerRows.count}`);
  check(
    "and every one of them is finger-sized",
    drawerRows.shortest >= 44,
    `${drawerRows.shortest}px`,
  );

  /*
   * The phone gets the same centred panel, and the drawer behind it survives.
   *
   * This is the arrangement that replaced a nested vaul sheet, and the nesting
   * is the whole risk: a Radix dialog opening over a vaul drawer that is itself
   * a Radix dialog. Two focus scopes, two scroll locks, one Escape listener
   * stack. Everything below is that stack being asked to behave.
   */
  const mTicked = () =>
    m
      .locator("[data-testid='sidebar-drawer'] [data-category-row='sports'] [role='checkbox']")
      .first()
      .getAttribute("data-state");
  const mTickedBefore = await mTicked();

  await mSport.click();
  await m.waitForTimeout(600);
  const sheet = m.locator("[data-testid='sub-filter-panel']");
  check("a phone gets the same centred panel", await sheet.isVisible());
  check(
    "and opening it does not toggle the category in the drawer",
    (await mTicked()) === mTickedBefore,
    `${mTickedBefore} → ${await mTicked()}`,
  );
  check("the panel lists every sport", (await m.locator("[data-sub-filter-option]").count()) === 10);
  check(
    "and exactly one picker body exists",
    (await m.locator("[data-sub-filter-all]").count()) === 1,
  );

  const sheetMarks = await m.evaluate(() =>
    [...document.querySelectorAll("[data-sub-filter-option]")].map((tile) => {
      const img = tile.querySelector("img");
      const label = tile.querySelector("span.truncate");
      return {
        id: tile.getAttribute("data-sub-filter-option") ?? "?",
        loaded: !!img && img.complete && img.naturalWidth > 0,
        clipped: !!label && label.scrollWidth > label.clientWidth + 1,
      };
    }),
  );
  check(
    "its logos decode on a phone too",
    sheetMarks.every((s) => s.loaded),
    sheetMarks.filter((s) => !s.loaded).map((s) => s.id).join(", "),
  );
  check(
    "and no tile label is cut off",
    sheetMarks.every((s) => !s.clipped),
    sheetMarks.filter((s) => s.clipped).map((s) => s.id).join(", "),
  );

  const tile = await m.locator("[data-sub-filter-option='tennis']").first().boundingBox();
  check("its tiles are comfortable to hit", (tile?.height ?? 0) >= 44, `${tile?.height ?? 0}px`);

  const bounds = await m.evaluate(() => {
    const el = document.querySelector<HTMLElement>("[data-testid='sub-filter-panel']");
    const r = el?.getBoundingClientRect();
    return r
      ? {
          left: r.left,
          right: r.right,
          top: r.top,
          bottom: r.bottom,
          dx: Math.abs((r.left + r.right) / 2 - window.innerWidth / 2),
          vw: window.innerWidth,
          vh: window.innerHeight,
        }
      : null;
  });
  check(
    "the panel stays inside the viewport",
    !!bounds && bounds.left >= -1 && bounds.right <= bounds.vw + 1,
    bounds ? `left ${bounds.left.toFixed(0)}, right ${bounds.right.toFixed(0)} of ${bounds.vw}` : "not found",
  );
  /* Vertically too — the failure a bottom sheet could not have and a centred
     panel can, and the one that takes the close button off-screen with it. */
  check(
    "and it fits vertically, centred",
    !!bounds && bounds.top >= 0 && bounds.bottom <= bounds.vh && bounds.dx <= 2,
    bounds
      ? `top ${bounds.top.toFixed(0)}, bottom ${bounds.bottom.toFixed(0)} of ${bounds.vh}, off centre ${bounds.dx.toFixed(1)}px`
      : "",
  );

  const bodyScroll = await m.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  check("no horizontal page scroll", bodyScroll <= 1, `${bodyScroll}px`);

  await m.screenshot({ path: `${SHOTS}/iphone.png` });

  /*
   * Escape dismisses one layer, not two.
   *
   * The single highest-value check on the phone: if the dismissable-layer stack
   * were flat, one Escape would take the picker *and* the filter drawer with
   * it, and the reader would be looking at the calendar wondering what they
   * pressed.
   */
  await m.keyboard.press("Escape");
  await m.waitForTimeout(500);
  check("Escape closes the picker", (await sheet.count()) === 0);
  check(
    "and leaves the filter drawer open behind it",
    await m.locator("[data-testid='sidebar-drawer']").isVisible(),
  );

  // And the Done button, which is the affordance a phone actually reaches for.
  await mSport.click();
  await m.waitForTimeout(600);
  await m.getByRole("button", { name: "Done" }).click();
  await m.waitForTimeout(600);
  check("Done closes the picker", (await sheet.count()) === 0);
  check(
    "and the filter drawer is still open behind it",
    await m.locator("[data-testid='sidebar-drawer']").isVisible(),
  );
  /* vaul restored the body's own pointer-events when its nested sheet closed,
     un-locking the page behind a drawer that was still open. A Radix dialog
     leaves Radix's own reference count to do it. */
  check(
    "and the drawer is still interactive",
    await m.locator("[data-testid='sidebar-drawer'] [data-sub-filter='sport']").first().isEnabled(),
  );

  /*
   * The eSport picker on a phone, which nothing ever opened.
   *
   * "Rocket League" is the longest string either picker has to render, and the
   * centred panel is narrower than the full-bleed sheet it replaced — so this
   * is precisely where a width regression lands, and precisely where the suite
   * was blind.
   */
  const mEsport = m
    .locator("[data-testid='sidebar-drawer'] [data-sub-filter='esport']")
    .first();
  await mEsport.click();
  await m.waitForTimeout(600);
  check("the eSport picker opens on a phone", await sheet.isVisible());
  const esportClipped = await m.evaluate(() =>
    [...document.querySelectorAll("[data-sub-filter-option]")]
      .map((t) => {
        const label = t.querySelector("span.truncate");
        return {
          id: t.getAttribute("data-sub-filter-option") ?? "?",
          clipped: !!label && label.scrollWidth > label.clientWidth + 1,
        };
      })
      .filter((t) => t.clipped)
      .map((t) => t.id),
  );
  check("and no game label is cut off", esportClipped.length === 0, esportClipped.join(", "));
  await m.getByRole("button", { name: "Done" }).click();
  await m.waitForTimeout(500);

  await mobile.close();
  await browser.close();

  /*
   * The suite's own load is not an application error.
   *
   * `/api/events` is deliberately rate limited, and a run of this file plus
   * whatever else has been driving the same build in the same minute earns a
   * 429 — which is the limiter working rather than the picker breaking. Counted
   * and printed rather than dropped, exactly as `verify-ui.ts` does it, so a
   * limiter firing at *normal* rates would still be visible here.
   */
  const real = errors.filter((e) => !/favicon|DevTools|net::ERR_/i.test(e));
  const limited = real.filter((e) => /\b429\b/.test(e));
  const appErrors = real.filter((e) => !/\b429\b/.test(e));
  if (limited.length > 0) {
    console.log(`  NOTE  rate limiter engaged ${limited.length}× under this suite's own load`);
  }
  check("no console errors", appErrors.length === 0, appErrors.slice(0, 3).join(" | "));

  console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
