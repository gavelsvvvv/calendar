# Sport and eSport sub-filters

Second-level filtering for the Sport and eSport categories, and the ingestion
work that made it worth having.

## The problem was not filtering

The report was that the calendar misses too many sports events, especially
tennis. It is worth being precise about why, because it changes what the fix
has to be.

Gamma ranks events by volume. The calendar fetched four ranked pages of open
events plus two of resolved ones, and on a live 45-day window the *cheapest*
event in that set carried **$62,000** of volume. The median tennis match on
Polymarket carries **$10,000**. The median individual fixture across all sports
carries **$2,074**.

So those events were never retrieved. No filter over the existing dataset could
have shown them, at any threshold, because they were not in it.

On top of that the broad sports floor is $250,000 — deliberately, since sport is
the only category with something on nearly every day of the year and would win a
general calendar by attrition. 92 of 104 fixtures in the sampled window were
below it.

## What changed

### 1. Fifteen per-sport discovery slices

Measured against everything the previous fetch already retrieved, on
2026-08-25 → 2026-10-19:

| slice | new events ≥ $500 | with a kickoff time |
|---|---|---|
| tennis | 78 | 69 |
| soccer | 57 | 66 |
| nfl | 36 | 30 |
| premier-league | 26 | 26 |
| la-liga | 26 | 25 |
| baseball | 25 | 16 |
| basketball | 14 | 8 |
| mls | 13 | 14 |
| ligue-1 | 12 | 10 |
| ufc | 11 | 11 |
| bundesliga | 9 | 11 |
| cricket | 9 | 9 |
| f1 | 5 | 5 |
| golf | 3 | 3 |
| boxing | 2 | 2 |

**326 events** the pipeline could not previously see.

Eight further candidates were probed and rejected for adding nothing once these
are in — `mlb` (a subset of `baseball`), `wnba` (a subset of `basketball`),
`dota-2` (covered by `esports`), `nhl`, `atp`, `wta`, `serie-a`,
`champions-league`. `nhl`/`hockey` are the interesting rejects: 38 events, every
one under $500, so there is no hockey supply to find rather than a slice missing
to find it. A further sixteen slugs return nothing at all.

Per-slice row limits are cut lines, not samples: the slice is volume-ordered, so
`limit: 15` on `bundesliga` means "the fifteen biggest", and the sixteenth was
measured below $500. Golf is capped at 5 because a golf tournament carries a
market per player and is the worst byte-per-event ratio on the board.

### 2. Two floors, and the broad one is untouched

- **Broad**: $250,000 sports / $100,000 esports, unchanged. Decides the general
  calendar, the feeds, search, and "All Sports".
- **Targeted**: $500, reachable *only* by naming the sport. Such an event is
  marked `targetedOnly` and is filtered out of every other surface.

An event must resolve to a known sport to enter the targeted tier — an unmapped
tag means no sub-filter could ever reach it, so admitting it would only add
weight to a payload nothing can display.

The two tiers are capped **separately**. If the $500 events shared a pool with
the broad ones, a $600 tennis match would be competing for one of the day's two
sports slots; it would lose on score nearly every time, and "nearly every time"
is not a guarantee. Partitioning makes it structurally impossible.

### 3. The tier is fetched on demand

Carrying it always would take a month's wire payload from **302KB to 655KB** for
a feature most readers never open. So it has its own cache key and its own
`deep=1` request, costs double in the rate limiter, and is requested only once a
strict subset of sports is ticked. A shared `?sports=tennis` link is
server-rendered with it, so the first paint is correct.

Upstream, a shallow build issues the same 32 requests and moves the same ~116MB
it always did. The 15 sport slices and their ~40MB are billed to the request
that wants them.

### 4. The fan-out is bounded

`fetchEventsInRange` was a single `Promise.allSettled` over every page, which
held every response in memory simultaneously — fine at 32 pages, and the thing
most likely to end a container at 47. It now runs at most 8 concurrently.

## Coverage, before and after

Live six-week window, "before" = what the calendar shows with no sub-filter
(unchanged behaviour), "after" = what a targeted selection for that sport shows.

| Sport | before | after | matches | timed |
|---|---|---|---|---|
| Tennis | 11 | **37** | 26 | 26 |
| American Football | 6 | **43** | 28 | 24 |
| Basketball | 1 | **12** | 11 | 9 |
| Soccer | 15 | **93** | 84 | 83 |
| Baseball | 13 | **51** | 51 | 51 |
| Hockey | 0 | 0 | 0 | 0 |
| Golf | 1 | 4 | 0 | 2 |
| Combat Sports | 1 | **16** | 16 | 15 |
| Motorsport | 0 | 3 | 3 | 3 |
| Cricket | 0 | **12** | 12 | 12 |
| **Total** | **48** | **271** | | |

| Game | before | after | matches | timed |
|---|---|---|---|---|
| Counter-Strike 2 | 19 | **52** | 47 | 47 |
| Dota 2 | 11 | **19** | 19 | 17 |
| League of Legends | 34 | **70** | 69 | 69 |
| Valorant | 0 | **5** | 5 | 4 |
| **Total** | **64** | **146** | | |

Hockey is 0 → 0 and that is the correct answer, not a gap: the supply does not
exist above $500 in this window. Rainbow Six, Call of Duty, Overwatch, Rocket
League and StarCraft are the same — their tags return nothing at all.

**Where the new events come from:** all of them from Gamma's `/events` endpoint,
via per-tag ranked slices. No new data source, no scraping, no invented
endpoint. `sports.polymarket.com` was checked and is blocked by this
environment's egress proxy, so it was reported rather than routed around.

## Dates

Fixtures are dated on kickoff, never on the resolution deadline. Verified
against the new supply: **356 of 356** fixtures carry a `gameStartTime` and are
dated on it. 139 of them have a deadline **1 to 7.5 days later** — a US Open
qualifier played on 26 August carries an end date of 2 September — so without
this rule the entire qualifying draw would land in the wrong week.

Across sports and esports, 362 of 417 events (87%) are dated on a real scheduled
time. The remainder are outrights and props, which correctly have no kickoff.

## Regression: is the existing calendar unchanged?

Measured, not assumed. On a live window a shallow build produces **259 events,
0 of them targeted-only, and loses nothing** against the previous behaviour.

One difference is worth stating plainly. A **deep** build's *broad* tier can
differ from a shallow one's, because the sport slices also surface events that
clear the existing $250,000 floor — they were simply never fetched. On the
sampled window this added two Premier League matches ($134k and $190k, which
clear the floor after the standard breadth/liquidity discounts) and one $594k
baseball game. On 26 August the sports cap of 2 then held at 2 in both modes,
but the $594k game displaced a $493k one:

```
shallow:  $2,013,697  Real Madrid CF vs. Real Sociedad
          $  492,713  Olympique Lyonnais vs. Fenerbahçe SK
deep:     $2,047,029  Real Madrid CF vs. Real Sociedad
          $  594,237  Tampa Bay Rays vs. Detroit Tigers
```

The event *count* never drops — the cap is the same number, and the winner is
strictly larger. In practice this is unobservable: a deep build is only
requested by a reader who has narrowed, and a narrowed reader sees only the
sports they ticked, where they also get the $500 tier. It is recorded here
because it is a real difference, not because it has a visible effect.

## Security

Sport ids are a closed allowlist (`SPORT_IDS`, `ESPORT_IDS`). Every path that
could carry one — the URL, the feed route, the cache key, the ICS calendar name
— parses through `parseSportSelection` / `parseEsportSelection`, which filter
against that list. A value that resolves to nothing becomes an *empty*
selection, never a wildcard: `?sports=<garbage>` must not silently widen to
every sport.

Verified against the running production build:

| input | result |
|---|---|
| `sports=tennis,../../etc/passwd` | Tennis only, 46 events, 0 echoes of the input |
| `sports=<script>alert(1)</script>` | empty selection, 0 events, 0 echoes |
| `sports=__proto__` | empty selection, 0 events, 0 echoes |
| `sports=tennis%0D%0ABEGIN%3AVEVENT` | empty selection, BEGIN/END balanced 0/0 |
| `sports=nonsense` | empty selection, not "everything" |

The narrowed feed parses cleanly: 46 VEVENTs, 46 unique UIDs, 0 missing
DTSTART, 0 lines over 75 octets, CRLF endings.

None of the recent hardening was removed or bypassed — UTC-day normalisation,
the 45-day ceiling, request coalescing and cost-weighted rate limiting are all
intact, and the deep tier is charged double.

## Interaction rules

- Default is All Sports / All Games, for existing and new readers alike.
- The parent category still gates everything: Sport off means no sport events
  regardless of the sub-selection.
- All Sports and "every box ticked by hand" are one canonical state — ticking
  the last box normalises back, and the URL parameter disappears.
- Zero sports selected means zero sport events, and the calendar stays visible.
  No large empty-state replacement.
- The sub-selection is a separate field from `categories`, so unticking Sport
  cannot clear it; it survives disable/re-enable, refresh, and view changes.
- Feeds mirror it only under "match my filters". "Everything" and hand-picked
  categories reset it, since neither offers a control for it and a hidden
  narrowing would be a trap.
- An existing feed URL never moves: an unnarrowed selection still produces
  `/api/calendar/all.ics`.

## Verification

Everything below was run against a production build of this branch.

| suite | result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npx eslint src scripts` | clean |
| `npm run build` | succeeds |
| `npx vitest run` | 436 passed |
| `npm run verify:ui` | 577 passed, 0 failed |
| `npm run verify:sub-filters` | all passed, desktop + iPhone 15 |
| `npm run verify:feed` | passed |
| `npm run verify:calendar-security` | passed |
| `npm run verify:calendar-parity` | all scenarios in parity |
| `npm run verify:security` | passed |

Two `verify-ui` checks were corrected in the process, and both were harness
faults rather than application ones — verified before changing them:

- *"empty in-month days carry a mark"* counted **out-of-month** cells, which
  deliberately carry no mark. The one genuinely empty in-month day did carry
  its mark. The check now excludes `bg-outside-month` cells. It began failing
  because the added coverage filled every other day in the month.
- *"no console errors"* reported the suite's own `429`s. Six hundred page loads
  from one address in a few minutes is the pattern the limiter exists to
  dampen; measured on the same build, 36 rapid month navigations are never
  limited and the bucket refills in two seconds. 429s are now counted and
  printed separately, so a limiter firing at *normal* rates would still show.

The rate-limiter diff was checked against the pre-feature commit: for a request
without `deep=1`, `costOf` and the warm/cold decision are bit-identical, so
nothing here made the limiter tighter.

### Tooling

- `npx vitest run` — 436 tests, including 28 covering scenarios A–M.
- `npx tsx scripts/audit-sports-coverage.ts [weeks]` — the tables above, from
  live data.
- `npx tsx scripts/verify-sub-filters.ts [baseUrl]` — the UI in a real browser
  at desktop and iPhone 15 width.

Scenario tests were mutation-checked: disabling the tier gate fails scenario B,
and treating an empty selection as targeted fails the §33 case.

No fixture, match, team or tournament is hardcoded anywhere. The worked-example
table in the audit script selects rows by *shape* ("the biggest tennis match",
"the biggest CS2 outright"), so it describes whatever Polymarket is running on
the day it is run.
