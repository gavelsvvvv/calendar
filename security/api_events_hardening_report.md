# `/api/events` hardening report

## The finding

`GET /api/events?start=<ISO>&end=<ISO>` performs an upstream aggregation on a
cache miss. The independent audit reported no meaningful rate limiting, that
unique ranges bypass cache reuse, and cold requests of 2–4 s (one September case
~12 s).

Reproduced and refined. The audit was right about the effect and partly wrong
about the cause:

- **Wrong:** "no request coalescing". `dataset.ts` has had an `inFlight` map all
  along, and `client.ts` has had a 15 s upstream timeout, a 25 s whole-build
  deadline and a 6 h stale fallback.
- **Right, and this is the real bug:** those protections are keyed on the raw
  `start`/`end` strings. `2026-09-01T00:00:00.000Z` and
  `2026-09-01T00:00:00.001Z` are two different keys for the same calendar
  window. So the cache could never hit and the coalescing could never coalesce
  for a caller who varied the milliseconds. The defences existed; the key
  defeated them.

## What the expensive stage is

A cache miss runs: upstream Gamma fetch → adaptation → grouping → scoring →
per-day caps → serialization. The upstream fetch dominates — a single Gamma page
carrying every market of every event runs 8–14 MB, which is why it is
deliberately not put through Next's data cache (it would exceed the 2 MB entry
ceiling, log an error, and still pay the transfer). Caching happens one level up,
on the adapted payload.

## Mitigations, in layers

### 1. Cache-key normalisation — `src/lib/api/range.ts`

Both ends snap to UTC day boundaries before the key is formed. The end rounds
*up*, so a mid-day end still covers its last day; rounding both down would
silently drop a day's events.

Measured: four inputs spanning the same days but differing in sub-day precision
now collapse to **one** cache key. Previously four.

The product only ever asks for day-granularity ranges — `monthGridRange()` in
`calendar-cache.ts` is the sole caller — so no precision that anything uses is
being discarded.

### 2. Range ceiling: 120 → 45 days

The browser requests six-week month grids. Nothing ever requested more, so the
old ceiling only widened the most expensive question a stranger could ask —
roughly tripling the upstream work available per call. A six-week grid still
passes; a 12-month range is now a `400`.

Ranges more than ten years from now are rejected outright: each distinct one is
a guaranteed cold build for a window the calendar does not show.

### 3. Single flight

Already present, and normalisation is what finally makes it effective: twenty
concurrent requests for one cold month now share one build because they finally
share one key.

### 4. Cost-weighted rate limiting — `src/lib/api/rate-limit.ts`

A flat "N per minute" would be wrong here, because the requests are not
interchangeable. Tuned for the cheap case it leaves the expensive case open;
tuned for the expensive case it breaks normal browsing.

So the caller declares nothing and the server charges what the work cost:

| Response | Cost |
| --- | --- |
| Cache hit | 1 token |
| Cold build | 20 + 2 per week of range (32 for a six-week grid) |
| Rejected input | 1 token |
| Upstream failure | full cold cost — it consumed capacity regardless |

Bucket capacity 300, refill 10/s, keyed on the **edge-observed** client address
(the right-most `x-forwarded-for` entry, so a caller cannot mint identities by
sending their own header). Tracked clients capped at 10 000 with LRU eviction,
so the limiter is not itself a memory-exhaustion vector.

Measured:

| Scenario | Result |
| --- | --- |
| Normal session: 3 cold months + 30 warm requests | **0 blocked** |
| Abuse: unique cold ranges back to back | **429 after 10** |
| After 60 s | allowed again |
| One client exhausted | another client unaffected |

`429` carries `Retry-After` and no information about the limiter's state — a
rate limiter that reports its own configuration is one you can tune an attack
against.

### 5. Caching policy

`Cache-Control: public, s-maxage=300, stale-while-revalidate=3600`. The stale
window is the part that matters under load: for an hour past expiry the edge
serves the last good copy and refreshes in the background, so a burst against a
just-expired month is absorbed by one revalidation rather than a herd. In-process
TTL 5 min, stale fallback 6 h when Gamma is unreachable.

### 6. Method and error handling

`POST`/`PUT`/`PATCH`/`DELETE` → `405` with `Allow`, refused before any work.
`OPTIONS` → `204`. Upstream error text is no longer reflected — it could carry an
upstream URL or a timeout's internals — and is logged server-side only.

## Before / after

| | Before | After |
| --- | --- | --- |
| Distinct cache keys per calendar window | unbounded | 1 |
| Max range | 120 days | 45 days |
| Rate limiting | none | cost-weighted token bucket |
| Coalescing effective? | no (key defeated it) | yes |
| Stale-while-revalidate | 900 s | 3600 s |
| Error body | upstream message | fixed string |
| Non-GET methods | 200 | 405 |

## Limitations, stated honestly

- **Per-process.** Railway may run several instances; each keeps its own
  buckets, so the effective ceiling is limit × instances. This stops one cheap
  script from monopolising upstream capacity. It is **not** protection against a
  volumetric DDoS, which must be solved at the edge (Railway/Cloudflare).
- **IP-keyed.** CGNAT, VPNs and offices share addresses, which is why capacity
  is set well above any single session's needs. The trade is deliberate: a false
  negative for an abuser behind a busy IP is better than throttling a school.
- **No distributed store.** A shared limiter (Redis) would fix both points and is
  the obvious next step if this ever runs at scale.

## CSP: why `unsafe-inline` is still there

Not removed, and not for lack of trying. The app emits inline scripts it cannot
currently drop: the timezone-cookie writer in `<head>` (which must run before
first paint), next-themes' pre-paint class setter, and the `gtag` bootstrap
injected by `@next/third-parties`. Next.js 16 does not thread a nonce through
third-party script components, so a nonce-based policy would silently kill
analytics and risk a theme flash.

What the policy still buys, and it is not nothing: script *hosts* are pinned to
this origin plus Google's tag server, `connect-src` bounds where the page may
talk, and `frame-ancestors 'none'` forbids framing outright.

`unsafe-eval` is **not** present and must never be added.
