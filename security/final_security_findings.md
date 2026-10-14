# Final security findings — calendarpolymarket.com

Defensive hardening pass. Scope: our own code, our own production build, our own
API handlers, our own generated `.ics`. No third-party system was fuzzed or
load-tested.

Two prior audits are referenced but not re-litigated: the Safe Browsing pass
(branding/identity) and the independent audit that raised `/api/events` DoS,
public-field exposure and CSP `unsafe-inline`. Every claim below was
re-established against the current tree — the earlier audits were not assumed
still correct.

---

## A. Confirmed vulnerabilities

### A1 — ICS property injection through the event UID  *(critical, fixed)*

**Route/file** `src/lib/calendar-export/ics.ts` → `icsUid()`, reached by
`/api/calendar/[feed].ics` and `/api/calendar/event/[id].ics`.

**Attack surface** `event.id` originates in Polymarket's Gamma API. `UID` is not
an RFC 5545 TEXT value, so `escapeIcsText` never applied to it — the id was
interpolated raw.

**Evidence** — fixture `id = "1\r\nATTACH:https://evil.test/payload.exe\r\nX-EVIL:1"`
produced, in the generated VEVENT:

```
UID:pmc-1
ATTACH:https://evil.test/payload.exe
X-EVIL:1@calendarpolymarket.com
```

A real `ATTACH` property, from upstream data, in a feed people subscribe to on
their phones.

**Impact** Anyone able to influence a market id could add an attachment,
organizer, attendee or alarm to a subscriber's calendar entry.

**Fix** `safeToken()` restricts the UID local part to `[A-Za-z0-9._@:+-]`, caps
length, and strips control characters. Regression: *"hostile id in UID: no
forbidden property"* in `verify:calendar-security`.

### A2 — ICS property injection through the all-day date  *(critical, fixed)*

**File** `ics.ts` → `formatIcsDate()`, previously `dayKey.replace(/-/g, "")`.

**Evidence** `displayDate = "2026-08-20\r\nATTACH:x"` emitted a `DTSTART` line
followed by an injected `ATTACH`, plus `NaN` in the derived `DTEND`.

**Fix** The DATE grammar is now asserted (`^\d{4}-\d{2}-\d{2}$` plus range
checks). A value that is not a civil date returns `null` and the event is
declined.

### A3 — Unvalidated URL reaches the calendar `URL:` property  *(high, fixed)*

**File** `ics.ts`, previously `URL:${escapeIcsText(event.primaryMarketUrl)}`.

**Evidence** `primaryMarketUrl = "javascript:alert(1)"` was serialized into the
`URL:` property verbatim. Escaping a URI as TEXT is doubly wrong: it corrupts
legitimate URLs (backslash-escaping their commas and semicolons) and implies a
hostile URL can be made safe by quoting.

**Impact** A calendar client renders `URL` as a tappable link, including on a
phone lock screen.

**Fix** New `src/lib/calendar-export/safe-url.ts`. `safeExternalUrl()` parses
with `new URL`, requires `https:`, rejects embedded credentials, and allowlists
`polymarket.com` / `calendarpolymarket.com` and their subdomains. A URL that
fails is omitted, never emitted.

### A4 — One malformed upstream date fails the entire feed  *(high, fixed)*

**File** `ics.ts` → `buildVEvent`, `new Date(...).toISOString()` unguarded.

**Evidence** `endDate = "not-a-date"` threw `RangeError: Invalid time value` out
of the serializer.

**Impact** Availability. A single bad market date 500s the feed for every
subscriber, not just that event.

**Fix** `formatIcsUtc` returns `null` instead of throwing; `buildVEvent` returns
`null`; `buildIcsCalendar` skips it. Regression asserts a feed containing one bad
event still serializes the good one.

### A5 — Cache-key explosion on `/api/events`  *(high, fixed)*

**Route** `GET /api/events?start&end`.

**Attack surface** The dataset cache *and* the single-flight coalescing map are
both keyed on the raw `start`/`end` strings. `…T00:00:00.000Z` and
`…T00:00:00.001Z` are two keys for the same calendar window.

**Impact** Neither the cache nor the coalescing could ever hit for a caller
walking the millisecond: every request bought a fresh upstream aggregation.
Confirms the independent audit's finding, and identifies the mechanism — the
protections existed, the key defeated them.

**Fix** `src/lib/api/range.ts` snaps both ends to UTC day boundaries before the
key is formed, so semantically identical ranges share one cache entry and one
build. Range ceiling cut 120 → 45 days (the browser only ever asks for six-week
month grids). Absurd windows (>10 years out) rejected.

---

## B. High-risk weaknesses

### B1 — No application rate limiting  *(fixed)*

Confirmed absent. Added `src/lib/api/rate-limit.ts`: a cost-weighted token
bucket keyed on the edge-observed client address. A cache hit costs 1 token; a
cold build costs 20 plus 2 per week of range. Capacity 300, refill 10/s.

Measured: a normal session (3 cold months + 30 warm requests) is never limited;
unique cold ranges are cut off after 10. Returns `429` with `Retry-After` and no
information about the limiter's own state.

**Limitation, stated plainly:** per-process. Railway may run several instances,
so the effective ceiling is the limit × instance count. This stops one cheap
script from monopolising upstream capacity. It is not, and cannot be, protection
against a volumetric DDoS — that has to be solved at the edge.

### B2 — Upstream error text reflected to clients  *(fixed)*

`/api/events` returned `error.message` verbatim; `page.tsx` serialized it into
the RSC payload. Both now return a fixed string and log server-side only.

### B3 — Internal curation data published  *(fixed)*

`/api/events` serialized `CuratedCalendarEvent` directly. Removed via an explicit
projection (`src/lib/api/public-event.ts`): `sourceEventIds`, `primaryMarketId`,
`groupedBy`, `dateSource`, `lastModified`, `openInterest`, `startDate`,
`seriesSlug`, `seriesTitle`, and the whole `stats` block (which named every
exclusion rule and its hit count). All ten had **zero** readers in the client —
verified by grep, not assumed.

`importanceScore` keeps its name (four client sort sites depend on it) but now
carries a dense **rank** rather than the scoring model's output.

The same projection is applied to the RSC handoff in `page.tsx`, so the two
surfaces cannot drift.

---

## C. Defense-in-depth opportunities

- **C1 (done)** Text sanitisation: C0/DEL control characters and bidi/zero-width
  Unicode stripped from all ICS text. Narrow by design — seven code points —
  so `Fenerbahçe`, `東京`, `Ærø` and emoji survive intact.
- **C2 (done)** Length caps: 300 chars per property, 1200 for DESCRIPTION.
- **C3 (done)** Method constraints on `/api/events` (405 + `Allow`).
- **C4 (done)** `robots.txt` disallowing `/api/`, minimal `sitemap.xml`,
  `/.well-known/security.txt`.
- **C5 (open)** CSP still needs `unsafe-inline` — see
  `security/api_events_hardening_report.md` §CSP for exactly why.
- **C6 (open)** `icon` duplicates `image` byte-for-byte on every event. Cosmetic
  payload waste, not a security issue.

---

## D. Verified-safe behaviour

Each re-established against the current tree.

| Claim | Evidence |
| --- | --- |
| No credential collection of any kind | No `<form>`, no `type="password"`, no auth/wallet/OAuth dependency. Two `<input>` elements exist: a `readOnly` feed-URL display and a same-origin search box. |
| No SSRF | One user-controlled param reaches `fetch()` (`/api/calendar/event/[id]`), attached as a query *value* to the hardcoded `https://gamma-api.polymarket.com`. |
| No open redirect | `grep -rn "redirect("` over `src/` returns nothing. No `window.location` assignment, no meta refresh. |
| No path traversal | Feed ids resolve through an allowlist; no `fs` or `path.join` sink exists in any route. |
| Prototype-chain bypass stays closed | `__proto__`, `constructor`, `prototype`, `valueOf`, `hasOwnProperty` all 404. Re-tested. |
| Security headers still present | CSP, HSTS, nosniff, `frame-ancestors 'none'`, X-Frame-Options DENY, Referrer-Policy, Permissions-Policy — asserted per-route in `verify:security`. |
| No service worker, no PWA manifest | Absent from source, build output, live origin and git history. |
| Single flight already existed | `inFlight` map in `dataset.ts` — the independent audit was wrong that coalescing was missing; the *cache key* was what defeated it. |
| Upstream timeouts already existed | `REQUEST_TIMEOUT_MS = 15_000` with `AbortSignal.timeout`, plus a 25s whole-build deadline and a 6h stale fallback. |
| No analytics on `.ics` | Feed responses are `text/calendar` from a route handler; the analytics tag lives in the HTML layout only. |

---

## E. Requires real-device validation

Cannot be established from this environment. See
`security/iphone_calendar_manual_test.md`.

1. iOS Calendar's rendering of a subscribed event (title, local time, URL).
2. That no attachment or alarm appears on a real device.
3. Subscription refresh and update-in-place behaviour over time.
4. Unsubscribe.
5. Behaviour of a resolved/cancelled event after a refresh.
