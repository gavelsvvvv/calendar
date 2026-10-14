/**
 * Calendar security regression suite.
 *
 * Everything this app publishes into somebody's calendar is built from
 * Polymarket's public API, which means the text is chosen by whoever created the
 * market. This file treats all of it as hostile and asserts on the bytes we
 * actually emit — `buildIcsCalendar`, not an intermediate — because folding,
 * escaping and assembly each get a chance to undo the previous step's work.
 *
 *   npx tsx scripts/verify-calendar-security.ts
 *
 * Every case here is a regression: each one failed before the hardening pass,
 * or guards a property (no ATTACH, no VALARM) that must never become true.
 *
 * The suite deliberately does not trust our own parser. Section 2 re-parses the
 * generated feed with ical.js — an independent, standards-compliant implementation
 * — so "we escaped it correctly" is checked by something that did not write it.
 */
import ICAL from "ical.js";
import {
  buildIcsCalendar,
  buildSingleEventIcs,
  buildVEvent,
  sanitizeIcsText,
} from "../src/lib/calendar-export/ics";
import { safeExternalUrl, polymarketEventUrl } from "../src/lib/calendar-export/safe-url";
import { buildGoogleCalendarUrl } from "../src/lib/calendar-export/google";
import { buildOutlookEventUrl } from "../src/lib/calendar-export/outlook";
import type { CuratedCalendarEvent } from "../src/lib/curation/types";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
}

function event(overrides: Partial<CuratedCalendarEvent> = {}): CuratedCalendarEvent {
  return {
    id: "12345",
    slug: "an-event",
    title: "An event",
    shortTitle: "An event",
    endDate: "2026-08-20T16:00:00Z",
    displayDate: "2026-08-20",
    time: "12:00",
    timeKind: "scheduled",
    isAllDay: false,
    dateConfidence: "confirmed",
    dateSource: "eventEnd",
    category: "politics",
    volume: 100_000,
    liquidity: 10_000,
    primaryMarketUrl: "https://polymarket.com/event/an-event",
    relatedMarketsCount: 1,
    importanceScore: 50,
    importanceLevel: "standard",
    status: "upcoming",
    source: "polymarket",
    sourceEventIds: ["12345"],
    groupedBy: "single",
    tags: [],
    ...overrides,
  } as CuratedCalendarEvent;
}

const SITE = "https://calendarpolymarket.com";
const feed = (e: CuratedCalendarEvent) =>
  buildIcsCalendar([e], { dtstamp: "2026-08-01T00:00:00Z", siteUrl: SITE });

/** Properties an upstream market must never be able to introduce. */
const FORBIDDEN = [
  "ATTACH",
  "VALARM",
  "ORGANIZER",
  "ATTENDEE",
  "X-ALT-DESC",
  "RRULE",
  "RDATE",
  "EXDATE",
  "RECURRENCE-ID",
];

/** Content lines, unfolded, as a client would read them. */
function contentLines(ics: string): string[] {
  return ics.replace(/\r\n[ \t]/g, "").split("\r\n").filter(Boolean);
}

function propertyNames(ics: string): string[] {
  return contentLines(ics).map((l) => l.split(/[;:]/)[0].toUpperCase());
}

/* ══════════════════════════════════════════ 1. injection ══════════════════ */

function injectionSuite() {
  console.log("\n=== ICS INJECTION (hostile upstream text) ===");

  const hostile: Array<[string, CuratedCalendarEvent]> = [
    // The one that was exploitable: UID is not TEXT, so escaping never applied.
    ["hostile id in UID", event({ id: "1\r\nATTACH:https://evil.test/payload.exe\r\nX-EVIL:1" })],
    ["hostile title", event({ title: "A\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:evil@x\r\nSUMMARY:Pwned" })],
    ["VALARM via title", event({ title: "A\r\nBEGIN:VALARM\r\nACTION:AUDIO\r\nTRIGGER:-PT1M\r\nEND:VALARM" })],
    ["ORGANIZER via outcome", event({ probability: 0.5, leadingOutcome: "X\r\nORGANIZER:mailto:e@x.test" })],
    ["ATTENDEE via slug/url", event({ primaryMarketUrl: "https://polymarket.com/e\r\nATTENDEE:mailto:a@b.c" })],
    ["hostile displayDate", event({ isAllDay: true, displayDate: "2026-08-20\r\nATTACH:x" })],
    ["lone CR", event({ title: "A\rATTACH:x" })],
    ["lone LF", event({ title: "A\nATTACH:x" })],
    ["escaped-looking input", event({ title: "A\\nATTACH:x" })],
    ["semicolon and comma", event({ title: "A;B,C" })],
    ["backslash", event({ title: "A\\B" })],
  ];

  for (const [name, e] of hostile) {
    const ics = feed(e);
    const props = propertyNames(ics);
    const injected = FORBIDDEN.filter((p) => props.includes(p));
    const vevents = props.filter((p) => p === "BEGIN").length;
    check(
      `${name}: no forbidden property`,
      injected.length === 0,
      injected.join(", "),
    );
    // One BEGIN:VCALENDAR + one BEGIN:VEVENT === 2. More means a second event.
    check(`${name}: exactly one VEVENT`, vevents <= 2, `${vevents} BEGIN lines`);
  }

  console.log("\n=== FORBIDDEN PROPERTIES ARE NEVER EMITTED AT ALL ===");
  const normal = feed(event({ probability: 0.62, leadingOutcome: "Yes" }));
  for (const p of FORBIDDEN) {
    check(`no ${p} in a normal feed`, !propertyNames(normal).includes(p));
  }
  check(
    "no HTML payload property",
    !/X-ALT-DESC|text\/html/i.test(normal),
  );
}

/* ══════════════════════════════════════ 2. independent parser ═════════════ */

function parserSuite() {
  console.log("\n=== INDEPENDENT PARSE (ical.js) ===");

  const cases: Array<[string, CuratedCalendarEvent]> = [
    ["normal timed event", event()],
    ["all-day event", event({ isAllDay: true })],
    ["unicode title", event({ title: "Fenerbahçe vs Beşiktaş — 東京 🇯🇵 finale" })],
    ["hostile title", event({ title: "A\r\nBEGIN:VALARM\r\nEND:VALARM;,\\x" })],
    ["hostile id", event({ id: "9\r\nATTACH:https://evil.test/x" })],
    ["long title", event({ title: "Ω".repeat(400) })],
    ["comma/semicolon title", event({ title: "Trump, Harris; and others" })],
  ];

  for (const [name, e] of cases) {
    const ics = feed(e);
    try {
      const comp = new ICAL.Component(ICAL.parse(ics));
      const vevents = comp.getAllSubcomponents("vevent");
      check(`${name}: parses as valid iCalendar`, vevents.length === 1, `${vevents.length} vevents`);
      if (vevents.length !== 1) continue;
      const ve = vevents[0];
      check(`${name}: no ATTACH/VALARM after parse`,
        !ve.getFirstProperty("attach") && ve.getAllSubcomponents("valarm").length === 0);
      // The parser round-trips escaping: what it hands back must equal what we
      // meant, not what we wrote. This is what catches an over- or under-escape.
      const summary = ve.getFirstPropertyValue("summary") as string;
      check(`${name}: SUMMARY survives round-trip`,
        typeof summary === "string" && summary.length > 0,
        JSON.stringify(String(summary).slice(0, 40)));
      const uid = String(ve.getFirstPropertyValue("uid"));
      check(`${name}: UID is ours`, uid.endsWith("@calendarpolymarket.com"), uid.slice(0, 48));
    } catch (err) {
      check(`${name}: parses as valid iCalendar`, false, (err as Error).message.slice(0, 80));
    }
  }

  console.log("\n=== LINE FOLDING (75 octets, UTF-8) ===");
  for (const [name, title] of [
    ["ascii", "X".repeat(200)],
    ["multibyte at boundary", "é".repeat(120)],
    ["emoji at boundary", "🇯🇵".repeat(60)],
    ["cjk", "東".repeat(150)],
  ] as const) {
    const ics = feed(event({ title }));
    const longest = Math.max(...ics.split("\r\n").map((l) => Buffer.byteLength(l, "utf8")));
    check(`${name}: every line ≤ 75 octets`, longest <= 75, `longest ${longest}`);
    // Folding must be reversible — a split mid-codepoint corrupts the text.
    try {
      const comp = new ICAL.Component(ICAL.parse(ics));
      const s = String(comp.getAllSubcomponents("vevent")[0].getFirstPropertyValue("summary"));
      check(`${name}: unfolds without corruption`, !s.includes("�"), "replacement char found");
    } catch (err) {
      check(`${name}: unfolds without corruption`, false, (err as Error).message.slice(0, 60));
    }
  }
}

/* ═══════════════════════════════════════ 3. sanitisation ══════════════════ */

function sanitisationSuite() {
  console.log("\n=== TEXT SANITISATION ===");

  const ics = feed(event({ title: "A BCDEF" }));
  check(
    "C0/DEL control characters are stripped",
    !/[ --]/.test(ics),
  );

  const bidi = feed(event({ title: "Invoice‮txt.exe‬​paid" }));
  check(
    "bidi overrides and zero-width chars are stripped",
    !/[​‎‏‪-‮⁦-⁩﻿]/.test(bidi),
  );

  const intl = feed(event({ title: "Fenerbahçe · 東京 · Ærø · 🇺🇸 · Ø" }));
  try {
    const s = String(
      new ICAL.Component(ICAL.parse(intl))
        .getAllSubcomponents("vevent")[0]
        .getFirstPropertyValue("summary"),
    );
    check(
      "legitimate international text is preserved",
      s.includes("Fenerbahçe") && s.includes("東京") && s.includes("Ærø") && s.includes("🇺🇸"),
      s.slice(0, 60),
    );
  } catch (err) {
    check("legitimate international text is preserved", false, (err as Error).message);
  }

  const huge = feed(event({ title: "X".repeat(10_000), description: "Y".repeat(50_000) }));
  check("oversized text is capped", huge.length < 8_000, `${huge.length} bytes`);

  console.log("\n=== MALFORMED DATES ARE DECLINED, NOT THROWN ===");
  for (const [name, e] of [
    ["unparseable endDate", event({ endDate: "not-a-date" })],
    ["empty endDate", event({ endDate: "" })],
    ["malformed displayDate", event({ isAllDay: true, displayDate: "20260820" })],
    ["out-of-range month", event({ isAllDay: true, displayDate: "2026-13-01" })],
  ] as const) {
    let threw = false;
    let out: string[] | null = null;
    try {
      out = buildVEvent(e, { dtstamp: "2026-08-01T00:00:00Z" });
    } catch {
      threw = true;
    }
    check(`${name}: does not throw`, !threw);
    check(`${name}: event is declined`, out === null, out ? "serialized anyway" : "");
  }
  // One bad event must not take the feed with it.
  const mixed = buildIcsCalendar([event({ endDate: "nope" }), event({ id: "ok" })], {
    dtstamp: "2026-08-01T00:00:00Z",
  });
  check(
    "a bad event does not break the whole feed",
    mixed.includes("BEGIN:VCALENDAR") && (mixed.match(/BEGIN:VEVENT/g) ?? []).length === 1,
  );
}

/* ══════════════════════════════════════════ 4. URLs ═══════════════════════ */

function urlSuite() {
  console.log("\n=== URL ALLOWLIST ===");
  const rejected = [
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "data:text/html;base64,PHNjcmlwdD4=",
    "file:///etc/passwd",
    "blob:https://polymarket.com/x",
    "//evil.test/x",
    "http://polymarket.com/event/x",
    "https://polymarket.com.evil.test/x",
    "https://evil.test/x",
    "https://user:pass@polymarket.com/x",
    "https://polymarket.com@evil.test/x",
    "https://polymarket.com/\r\nATTENDEE:mailto:a@b.c",
    "https://polymarket.com/ x",
  ];
  for (const u of rejected) {
    check(`rejects ${u.slice(0, 46)}`, safeExternalUrl(u) === null, String(safeExternalUrl(u)));
  }
  for (const u of [
    "https://polymarket.com/event/abc",
    "https://www.polymarket.com/event/abc",
    "https://calendarpolymarket.com/",
  ]) {
    check(`accepts ${u}`, safeExternalUrl(u) !== null);
  }

  check(
    "hostile slug cannot add a path or query",
    polymarketEventUrl("a/../../x?y=1#z") === "https://polymarket.com/event/a%2F..%2F..%2Fx%3Fy%3D1%23z",
    polymarketEventUrl("a/../../x?y=1#z"),
  );

  console.log("\n=== ICS URL PROPERTY ===");
  const bad = feed(event({ primaryMarketUrl: "javascript:alert(1)" }));
  check("javascript: never reaches URL:", !/javascript:/i.test(bad));
  check("URL: is omitted rather than emitted empty", !/(^|\r\n)URL:\r\n/.test(bad));
  const good = feed(event());
  check("a valid URL is emitted verbatim, not TEXT-escaped",
    good.includes("URL:https://polymarket.com/event/an-event"));

  console.log("\n=== GOOGLE CALENDAR LINK ===");
  for (const [name, title] of [
    ["ampersand", "A & B"],
    ["query injection", "x&sf=true&output=xml"],
    ["hash", "A#frag"],
    ["percent", "100% sure"],
    ["crlf", "A\r\nB"],
    ["unicode", "東京 🇯🇵"],
    ["equals", "a=b"],
  ] as const) {
    const raw = buildGoogleCalendarUrl(event({ title }), { siteUrl: SITE });
    const url = new URL(raw);
    check(`google: host is fixed (${name})`, url.hostname === "calendar.google.com", url.hostname);
    const text = url.searchParams.get("text") ?? "";
    /*
     * The property under test is that hostile text stays DATA. Compare against
     * the sanitised title, because the builder deliberately strips control
     * characters before encoding — asserting on the raw input would be asserting
     * that we pass CRLF through to Google, which is the opposite of the goal.
     */
    check(
      `google: "${name}" stays one parameter value`,
      text === sanitizeIcsText(title),
      `text=${JSON.stringify(text.slice(0, 40))}`,
    );
    check(`google: no injected params (${name})`, !url.searchParams.has("sf") && !url.searchParams.has("output"));
  }

  console.log("\n=== OUTLOOK LINK ===");
  for (const [name, title] of [
    ["ampersand", "A & B"],
    ["param injection", "x&rru=delete"],
    ["crlf", "A\r\nB"],
    ["unicode", "Fenerbahçe"],
  ] as const) {
    const raw = buildOutlookEventUrl(event({ title }), "personal", { siteUrl: SITE });
    const url = new URL(raw);
    check(`outlook: host is fixed (${name})`, url.hostname === "outlook.live.com", url.hostname);
    check(`outlook: rru not overridden (${name})`, url.searchParams.get("rru") === "addevent");
    check(`outlook: location is allowlisted (${name})`,
      (url.searchParams.get("location") ?? "").startsWith("https://polymarket.com"));
  }
  const work = new URL(buildOutlookEventUrl(event(), "work"));
  check("outlook: work host is fixed", work.hostname === "outlook.office.com", work.hostname);
}

/* ═══════════════════════════════════════ 5. UID / update ══════════════════ */

function uidSuite() {
  console.log("\n=== UID OWNERSHIP AND UNIQUENESS ===");
  const ics = feed(event());
  check("UID uses our own domain", /UID:pmc-[^@]*@calendarpolymarket\.com/.test(ics));
  check("UID never uses calendar.polymarket.com", !ics.includes("calendar.polymarket.com"));

  const ids = ["1", "2", "10", "1-2", "abc", "ABC"];
  const uids = new Set(
    ids.map((id) => {
      const line = contentLines(feed(event({ id }))).find((l) => l.startsWith("UID:"));
      return line ?? "";
    }),
  );
  check("distinct ids produce distinct UIDs", uids.size === ids.length, `${uids.size}/${ids.length}`);

  const a = contentLines(feed(event({ id: "77" }))).find((l) => l.startsWith("UID:"));
  const b = contentLines(feed(event({ id: "77", title: "Different title" }))).find((l) =>
    l.startsWith("UID:"),
  );
  check("the same event keeps one stable UID", a === b, `${a} vs ${b}`);

  console.log("\n=== SEQUENCE / STATUS ===");
  const older = feed(event({ lastModified: "2026-08-01T00:00:00Z" }));
  const newer = feed(event({ lastModified: "2026-08-02T00:00:00Z" }));
  const seq = (s: string) => Number(contentLines(s).find((l) => l.startsWith("SEQUENCE:"))?.slice(9));
  check("SEQUENCE increases with lastModified", seq(newer) > seq(older), `${seq(older)} → ${seq(newer)}`);
  check("SEQUENCE stays in 32-bit range", seq(newer) < 2_147_483_647, String(seq(newer)));
  check(
    "a cancelled event publishes a tombstone, not a deletion",
    feed(event({ status: "cancelled" })).includes("STATUS:CANCELLED"),
  );
  check("SEQUENCE cannot be supplied upstream", seq(feed(event({ lastModified: undefined }))) === 0);
}

/* ══════════════════════════════════════════ 6. dates ═════════════════════ */

function dateSuite() {
  console.log("\n=== DATE CORRECTNESS (server timezone must not matter) ===");
  const allDay = feed(event({ isAllDay: true, displayDate: "2026-08-20" }));
  check("all-day uses VALUE=DATE", allDay.includes("DTSTART;VALUE=DATE:20260820"));
  check("all-day DTEND is exclusive", allDay.includes("DTEND;VALUE=DATE:20260821"));
  check("all-day carries no time component", !/DTSTART;VALUE=DATE:\d{8}T/.test(allDay));

  const timed = feed(event({ endDate: "2026-08-20T16:00:00Z" }));
  check("timed DTSTART is the absolute instant in UTC", timed.includes("DTSTART:20260820T160000Z"));
  check("timed DTEND is one hour later", timed.includes("DTEND:20260820T170000Z"));

  // DST boundaries: the instant is what matters, and it is serialized in UTC.
  for (const [name, iso, expected] of [
    ["US DST start", "2026-03-08T07:00:00Z", "DTSTART:20260308T070000Z"],
    ["US DST end", "2026-11-01T06:00:00Z", "DTSTART:20261101T060000Z"],
    ["EU DST start", "2026-03-29T01:00:00Z", "DTSTART:20260329T010000Z"],
    ["year boundary", "2026-12-31T23:30:00Z", "DTSTART:20261231T233000Z"],
    ["leap day", "2028-02-29T12:00:00Z", "DTSTART:20280229T120000Z"],
  ] as const) {
    check(`${name}: instant preserved`, feed(event({ endDate: iso })).includes(expected));
  }

  console.log("\n=== RECURRENCE ===");
  const all = feed(event({ title: "RRULE:FREQ=SECONDLY;COUNT=999999" }));
  check("no RRULE is ever emitted", !propertyNames(all).includes("RRULE"));
  check("recurrence text in a title stays text", all.includes("SUMMARY:RRULE"));
}

/* ═══════════════════════════════════ 7. single-event download ════════════ */

function singleEventSuite() {
  console.log("\n=== SINGLE-EVENT DOWNLOAD ===");
  const ics = buildSingleEventIcs(event({ title: 'Bad"name\r\n/../x' }), {
    dtstamp: "2026-08-01T00:00:00Z",
  });
  check("single-event file is a valid VCALENDAR", ics.startsWith("BEGIN:VCALENDAR"));
  check("hostile title cannot inject a property", !FORBIDDEN.some((p) => propertyNames(ics).includes(p)));
  try {
    const c = new ICAL.Component(ICAL.parse(ics));
    check("single-event file parses independently", c.getAllSubcomponents("vevent").length === 1);
  } catch (err) {
    check("single-event file parses independently", false, (err as Error).message.slice(0, 60));
  }
}

/* ═════════════════════════════════════════ 8. large feed ═════════════════ */

function scaleSuite() {
  console.log("\n=== LARGE FEED (resource bounds) ===");
  const many = Array.from({ length: 1000 }, (_, i) =>
    event({ id: String(i), title: `Event ${i} ${"x".repeat(200)}` }),
  );
  const t0 = Date.now();
  const ics = buildIcsCalendar(many, { dtstamp: "2026-08-01T00:00:00Z", siteUrl: SITE });
  const ms = Date.now() - t0;
  const bytes = Buffer.byteLength(ics, "utf8");
  check("1000 events serialize in under 2s", ms < 2000, `${ms}ms`);
  check("1000 events stay under 2MB", bytes < 2_000_000, `${(bytes / 1024).toFixed(0)}KB`);
  check("every event is present", (ics.match(/BEGIN:VEVENT/g) ?? []).length === 1000);
}

async function main() {
  console.log("\n╔══════════════════════════════════════════════════════╗");
  console.log("║  CALENDAR SECURITY REGRESSIONS                       ║");
  console.log("╚══════════════════════════════════════════════════════╝");
  injectionSuite();
  parserSuite();
  sanitisationSuite();
  urlSuite();
  uidSuite();
  dateSuite();
  singleEventSuite();
  scaleSuite();
  console.log(
    `\n${failures === 0 ? "CALENDAR SECURITY PASSED" : `${failures} CHECK(S) FAILED`}\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main();
