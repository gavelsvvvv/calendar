/**
 * Application security regressions — API surface, DoS controls, routing.
 *
 *   npx tsx scripts/verify-security.ts [baseUrl]
 *
 * Runs against a local production build by default. Every request it makes is
 * cheap and same-origin: it never touches Polymarket, Google, Apple or Microsoft,
 * and it never runs a volumetric test. The burst section deliberately uses the
 * *cheapest possible* requests (malformed ranges, rejected before any work) to
 * prove the limiter engages without generating real load.
 *
 * Calendar serialization has its own suite — `verify:calendar-security` — which
 * is pure and needs no server.
 */
import {
  charge,
  checkLimit,
  costOf,
  clientKey,
  resetRateLimiter,
  RATE_LIMIT_SETTINGS,
} from "../src/lib/api/rate-limit";
import { isRangeError, normalizeRange, MAX_RANGE_DAYS } from "../src/lib/api/range";
import { FORBIDDEN_PUBLIC_FIELDS } from "../src/lib/api/public-event";

const BASE = (process.argv[2] ?? "http://127.0.0.1:3000").replace(/\/$/, "");

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
}

const day = (d: string) => `${d}T00:00:00.000Z`;

/* ═════════════════════════════════ 1. range normalisation ════════════════ */

function rangeSuite() {
  console.log("\n=== RANGE NORMALISATION (the cache-key DoS) ===");

  /*
   * The finding this closes: the dataset cache and the single-flight map are
   * keyed on the range, so two requests describing the same days but written
   * with different sub-day precision were two keys — no cache hit, no
   * coalescing, a fresh upstream build every time.
   */
  const variants = [
    ["2026-09-01T00:00:00.000Z", "2026-09-30T00:00:00.000Z"],
    ["2026-09-01T00:00:00.001Z", "2026-09-30T00:00:00.000Z"],
    ["2026-09-01T13:45:12.987Z", "2026-09-30T00:00:00.000Z"],
    ["2026-09-01T23:59:59.999Z", "2026-09-30T00:00:00.000Z"],
  ];
  const keys = new Set(
    variants.map((v) => {
      const r = normalizeRange(v[0], v[1]);
      return isRangeError(r) ? "err" : `${r.start}|${r.end}`;
    }),
  );
  check(
    "a day's worth of timestamps collapses to one cache key",
    keys.size === 1,
    `${keys.size} distinct keys from ${variants.length} inputs`,
  );

  const r = normalizeRange(day("2026-09-01"), day("2026-09-30"));
  check("normalised start is a UTC day boundary", !isRangeError(r) && r.start.endsWith("T00:00:00.000Z"));
  check("normalised end is a UTC day boundary", !isRangeError(r) && r.end.endsWith("T00:00:00.000Z"));

  // Rounding the end *up* matters: rounding down would silently drop a day.
  const partial = normalizeRange(day("2026-09-01"), "2026-09-30T11:00:00Z");
  check(
    "a mid-day end still covers its last day",
    !isRangeError(partial) && partial.end === "2026-10-01T00:00:00.000Z",
    isRangeError(partial) ? partial.error : partial.end,
  );

  console.log("\n=== RANGE VALIDATION ===");
  const rejected: Array<[string, string | null, string | null]> = [
    ["missing both", null, null],
    ["missing end", day("2026-09-01"), null],
    ["not a date", "banana", day("2026-09-30")],
    ["end before start", day("2026-09-30"), day("2026-09-01")],
    ["equal", day("2026-09-01"), day("2026-09-01")],
    ["over the ceiling", day("2026-01-01"), day("2026-12-31")],
    ["absurdly far future", day("2200-01-01"), day("2200-01-10")],
    ["absurdly far past", day("1800-01-01"), day("1800-01-10")],
    ["giant string", "x".repeat(5000), day("2026-09-30")],
    ["NaN", "NaN", "NaN"],
    ["infinity", "Infinity", "Infinity"],
  ];
  for (const [name, a, b] of rejected) {
    check(`rejects ${name}`, isRangeError(normalizeRange(a, b)));
  }
  const wide = normalizeRange(day("2026-09-01"), day("2026-10-20"));
  check(
    `ceiling is ${MAX_RANGE_DAYS} days, not 120`,
    MAX_RANGE_DAYS === 45 && isRangeError(wide),
    `MAX_RANGE_DAYS=${MAX_RANGE_DAYS}`,
  );
  // A month grid is six weeks — the widest thing the product legitimately asks for.
  const grid = normalizeRange(day("2026-08-30"), day("2026-10-11"));
  check("a six-week month grid is still allowed", !isRangeError(grid), isRangeError(grid) ? grid.error : `${grid.days}d`);
}

/* ═════════════════════════════════════ 2. rate limiting ══════════════════ */

function rateLimitSuite() {
  console.log("\n=== RATE LIMITING (cost-weighted) ===");
  resetRateLimiter();

  check(
    "a cold build costs far more than a cache hit",
    costOf({ cold: true, days: 42 }) > costOf({ cold: false, days: 42 }) * 15,
    `${costOf({ cold: false, days: 42 })} vs ${costOf({ cold: true, days: 42 })}`,
  );
  check(
    "a wider cold range costs more than a narrow one",
    costOf({ cold: true, days: 42 }) > costOf({ cold: true, days: 7 }),
    `${costOf({ cold: true, days: 7 })} vs ${costOf({ cold: true, days: 42 })}`,
  );

  /*
   * Normal browsing must never be limited. A page load plus its adjacent-month
   * prefetches is three cold months; then the reader navigates. Simulated at
   * the real cost, this has to stay comfortably inside the bucket.
   */
  resetRateLimiter();
  const browsing = "198.51.100.7";
  let blocked = 0;
  for (let i = 0; i < 3; i++) {
    if (!checkLimit(browsing).allowed) blocked++;
    charge(browsing, costOf({ cold: true, days: 42 }));
  }
  for (let i = 0; i < 30; i++) {
    if (!checkLimit(browsing).allowed) blocked++;
    charge(browsing, costOf({ cold: false, days: 42 }));
  }
  check("a normal session (3 cold months + 30 warm) is never limited", blocked === 0, `${blocked} blocked`);

  // The abusive pattern: every request a unique cold range.
  resetRateLimiter();
  const abuser = "203.0.113.9";
  let allowedColdBuilds = 0;
  for (let i = 0; i < 200; i++) {
    if (!checkLimit(abuser).allowed) break;
    allowedColdBuilds++;
    charge(abuser, costOf({ cold: true, days: 42 }));
  }
  check(
    "unique cold ranges are cut off quickly",
    allowedColdBuilds > 0 && allowedColdBuilds < 15,
    `${allowedColdBuilds} cold builds before 429`,
  );

  const decision = checkLimit(abuser);
  check("an exhausted bucket is refused", !decision.allowed);
  check(
    "the refusal carries a positive Retry-After",
    !decision.allowed && decision.retryAfterSeconds >= 1,
    !decision.allowed ? `${decision.retryAfterSeconds}s` : "",
  );

  // Refill is real, not a permanent ban.
  const later = Date.now() + 60_000;
  check("the bucket refills over time", checkLimit(abuser, later).allowed);

  // Buckets are per client.
  resetRateLimiter();
  charge("192.0.2.1", 1000);
  check("one client's debt does not affect another", checkLimit("192.0.2.2").allowed);

  console.log("\n=== CLIENT IDENTIFICATION ===");
  const spoofed = new Request("https://x.test/", {
    headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8, 203.0.113.99" },
  });
  check(
    "the edge-observed address wins over client-supplied ones",
    clientKey(spoofed) === "203.0.113.99",
    clientKey(spoofed),
  );
  check(
    "a huge header cannot bloat the key",
    clientKey(new Request("https://x.test/", { headers: { "x-forwarded-for": "9".repeat(5000) } })).length <= 64,
  );
  check(
    "tracked clients are capped",
    RATE_LIMIT_SETTINGS.MAX_TRACKED_CLIENTS <= 50_000,
    String(RATE_LIMIT_SETTINGS.MAX_TRACKED_CLIENTS),
  );
}

/* ══════════════════════════════ 3. live endpoint behaviour ═══════════════ */

async function endpointSuite() {
  console.log(`\n=== LIVE ENDPOINTS (${BASE}) ===`);

  const reachable = await fetch(BASE, { method: "HEAD" }).then(
    (r) => r.ok,
    () => false,
  );
  if (!reachable) {
    console.log("  SKIP  no server at this address — start one with `npm run start`");
    return;
  }

  console.log("\n--- method constraints ---");
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    const res = await fetch(`${BASE}/api/events?start=${day("2026-09-01")}&end=${day("2026-09-10")}`, {
      method,
    });
    check(`/api/events refuses ${method}`, res.status === 405, `HTTP ${res.status}`);
  }
  const opts = await fetch(`${BASE}/api/events`, { method: "OPTIONS" });
  check("/api/events answers OPTIONS", opts.status === 204 || opts.status === 200, `HTTP ${opts.status}`);

  console.log("\n--- malformed input ---");
  for (const [name, qs] of [
    ["no params", ""],
    ["garbage dates", "?start=x&end=y"],
    ["reversed", `?start=${day("2026-09-30")}&end=${day("2026-09-01")}`],
    ["over the ceiling", `?start=${day("2026-01-01")}&end=${day("2026-12-31")}`],
    ["null byte", "?start=%00&end=%00"],
    ["array params", "?start[]=a&end[]=b"],
  ] as const) {
    const res = await fetch(`${BASE}/api/events${qs}`);
    check(`/api/events rejects ${name}`, res.status === 400, `HTTP ${res.status}`);
    const body = await res.text();
    check(`${name}: no stack trace leaked`, !/\bat \/|node_modules|\.ts:\d+/.test(body));
  }

  console.log("\n--- public field minimisation ---");
  const res = await fetch(`${BASE}/api/events?start=${day("2026-09-01")}&end=${day("2026-09-20")}`);
  check("/api/events answers 200", res.ok, `HTTP ${res.status}`);
  if (res.ok) {
    const text = await res.text();
    for (const field of FORBIDDEN_PUBLIC_FIELDS) {
      check(`"${field}" is absent from the public response`, !text.includes(`"${field}"`));
    }
    const body = JSON.parse(text) as { events?: Array<Record<string, unknown>> };
    const first = body.events?.[0];
    if (first) {
      check("events still carry what the UI needs",
        typeof first.id === "string" && typeof first.title === "string" && "importanceLevel" in first);
      check("importanceScore is a small ordering rank, not a score",
        typeof first.importanceScore === "number" &&
          Number.isInteger(first.importanceScore) &&
          (first.importanceScore as number) <= (body.events?.length ?? 0),
        `importanceScore=${String(first.importanceScore)}`);
    }
  }

  console.log("\n--- RSC / initial HTML payload ---");
  const html = await (await fetch(BASE)).text();
  for (const field of FORBIDDEN_PUBLIC_FIELDS) {
    check(`"${field}" is absent from the rendered HTML`, !html.includes(`\\"${field}\\"`) && !html.includes(`"${field}"`));
  }

  console.log("\n--- security headers ---");
  const head = await fetch(BASE);
  for (const [header, expect] of [
    ["content-security-policy", "frame-ancestors 'none'"],
    ["x-frame-options", "DENY"],
    ["x-content-type-options", "nosniff"],
    ["referrer-policy", "strict-origin"],
    ["permissions-policy", "camera=()"],
    ["strict-transport-security", "max-age="],
  ] as const) {
    const value = head.headers.get(header) ?? "";
    check(`${header} is set`, value.includes(expect), value.slice(0, 60) || "absent");
  }
  check("x-powered-by is not advertised", !head.headers.get("x-powered-by"));
  check("CSP has no unsafe-eval",
    !(head.headers.get("content-security-policy") ?? "").includes("unsafe-eval"));

  console.log("\n--- feed identifier fuzzing ---");
  const hostile = [
    "__proto__", "constructor", "prototype", "toString", "valueOf", "hasOwnProperty",
    "%2e%2e", "%2f", "%5c", "%252f", "%00", "%0d%0a", "..%2f..%2fetc%2fpasswd",
    "....//", "%E2%88%95", "%EF%BC%8F", "politics.", "x".repeat(2000),
    "nonexistent", "POLITICS", "PoLiTiCs",
  ];
  for (const id of hostile) {
    const r = await fetch(`${BASE}/api/calendar/${id}.ics`);
    const body = r.status === 200 ? await r.text() : "";
    // Mixed case is a legitimate spelling of a real category; everything else 404s.
    const legitimate = id.toLowerCase() === "politics";
    check(
      `feed "${id.slice(0, 24)}" → ${legitimate ? "200" : "404"}`,
      legitimate ? r.status === 200 : r.status === 404,
      `HTTP ${r.status}`,
    );
    check(`feed "${id.slice(0, 24)}" leaks no stack`, !/node_modules|\.ts:\d+/.test(body));
  }

  console.log("\n--- calendar response headers ---");
  const feed = await fetch(`${BASE}/api/calendar/all.ics`);
  check("feed Content-Type is text/calendar", (feed.headers.get("content-type") ?? "").includes("text/calendar"));
  check("feed declares charset", (feed.headers.get("content-type") ?? "").toLowerCase().includes("utf-8"));
  check("feed is nosniff", (feed.headers.get("x-content-type-options") ?? "") === "nosniff");
  const disp = feed.headers.get("content-disposition") ?? "";
  check("subscription feed is not a forced download", !disp.startsWith("attachment"), disp || "none");
  check("no analytics on the feed", !(await feed.text()).includes("googletagmanager"));

  console.log("\n--- well-known files ---");
  for (const [path, expect] of [
    ["/.well-known/security.txt", "Contact:"],
    ["/robots.txt", "Disallow: /api/"],
    ["/sitemap.xml", "calendarpolymarket.com"],
  ] as const) {
    const r = await fetch(`${BASE}${path}`);
    const body = r.ok ? await r.text() : "";
    check(`${path} is served`, r.ok, `HTTP ${r.status}`);
    check(`${path} has expected content`, body.includes(expect), body.slice(0, 50).replace(/\n/g, " "));
  }
}

async function main() {
  console.log("\n╔══════════════════════════════════════════════════════╗");
  console.log("║  APPLICATION SECURITY REGRESSIONS                    ║");
  console.log("╚══════════════════════════════════════════════════════╝");
  rangeSuite();
  rateLimitSuite();
  await endpointSuite();
  console.log(`\n${failures === 0 ? "SECURITY CHECKS PASSED" : `${failures} CHECK(S) FAILED`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
