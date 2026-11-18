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

### 3. The tier is fetched on demand — per category

Carrying it always would take a month's wire payload from **302KB to 655KB** for
a feature most readers never open. So it has its own cache key and its own
`targeted=` request, costs double in the rate limiter *when it actually buys
upstream pages*, and is requested only once a strict subset is ticked. A shared
`?sports=tennis` link is server-rendered with it, so the first paint is correct.

**Two tiers, never one.** `TargetedTiers` is `{ sports: boolean; esports:
boolean }` and there is no state in which "targeted" is true without naming
which category asked for it. This replaced a single `deep` flag, and that flag
was the cause of the whole regression family documented below. Every layer
downstream reads the two fields separately: which discovery slices run, which
`targetedOnly` rows curation admits, the server's cache key, the browser's month
key, and the counts.

Upstream, an untargeted build issues the same 32 requests and moves the same
~116MB it always did. The 15 sport slices and their ~40MB are billed to the
request that wants them — and only to that one. There are currently **no
targeted esport slices** (the esport tags are already in the broad set), so a
narrowed eSport adds no upstream pages at all; `addsDiscoveryPages` derives the
rate limiter's multiplier from the slice list rather than from "any tier is
set", so narrowing eSport is not charged for pages it never fetched.

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

Measured, not assumed. On a live window an untargeted build produces **259
events, 0 of them targeted-only, and loses nothing** against the previous
behaviour.

One difference is worth stating plainly. A **sports-tier** build's *broad* tier
can differ from an untargeted one's, because the sport slices also surface
events that clear the existing $250,000 floor — they were simply never fetched.
Measured on the 2026-07-26 → 2026-09-06 window this is one extra broad event
(252 → 253), and it is a sports one: the isolation matrix compares all eleven
category rows on every case and no other category moves. On the
sampled window this added two Premier League matches ($134k and $190k, which
clear the floor after the standard breadth/liquidity discounts) and one $594k
baseball game. On 26 August the sports cap of 2 then held at 2 in both modes,
but the $594k game displaced a $493k one:

```
untargeted:  $2,013,697  Real Madrid CF vs. Real Sociedad
             $  492,713  Olympique Lyonnais vs. Fenerbahçe SK
sports tier: $2,047,029  Real Madrid CF vs. Real Sociedad
             $  594,237  Tampa Bay Rays vs. Detroit Tigers
```

The event *count* never drops — the cap is the same number, and the winner is
strictly larger. In practice this is unobservable: a targeted build is only
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

The `targeted=` parameter is the same story one level up. It carries
`tierKey`'s output and never a sport id, so the server never learns *which*
sports were ticked — the browser filters the month it already holds. The key
space is therefore exactly four values (`""`, `"sports"`, `"esports"`,
`"esports,sports"`) rather than one per subset, which is what keeps a stranger
from minting unbounded cache entries. Verified against the running build over
2026-08-01 → 2026-09-01:

| request | events |
|---|---|
| *(no parameter)* | 220 |
| `targeted=sports` | 412 |
| `targeted=esports` | 306 |
| `targeted=esports,sports` | 498 |
| `targeted=sports,esports` | 498 |
| `deep=1` *(legacy alias)* | 498 |
| `targeted=sports,bogus` | 412 — the real tier honoured, the invention discarded |
| `targeted=BOGUS` / `targeted=all` | 220 — nothing unrecognised can widen a build |
| `targeted=tennis` | 220 — a sport id is not a tier |

`deep=1` is honoured as "both tiers" because that is what it used to mean: a
browser holding the previous JS bundle keeps sending it for as long as its tab
is open, and it would otherwise lose its coverage mid-deploy.

The narrowed feed parses cleanly: 46 VEVENTs, 46 unique UIDs, 0 missing
DTSTART, 0 lines over 75 octets, CRLF endings.

None of the recent hardening was removed or bypassed — UTC-day normalisation,
the 45-day ceiling, request coalescing and cost-weighted rate limiting are all
intact, and the deep tier is charged double.

## The regression, and where it actually was

Four bugs were reported after the control shipped. They looked like four
different problems and were two, both traceable to one boolean.

| # | reported | actual cause |
|---|---|---|
| 1 | narrowing eSport emptied the whole calendar | `use-calendar.ts` read a cache key that had never been fetched |
| 2 | narrowing Sport emptied the whole calendar | the same line |
| 3 | narrowing eSport moved the **Sport** count, 43 → 266 | one `deep` flag fetched and admitted *both* categories' tiers |
| 4 | narrowing Sport moved the **eSport** count, 66 → 160 | the same flag |

### Bugs 1 and 2 — a comment that described code nobody wrote

Ticking one sport flips the tier, the tier is part of the month's cache key, and
a key that has never been fetched has no dataset. `use-calendar.ts` read that
entry, found `undefined`, and rendered `EMPTY_EVENTS` — so narrowing Sport to
Tennis emptied *every* category on the grid, politics and crypto included, until
the new response landed, and permanently if it 429'd or failed. The comment
three lines above claimed "the calendar keeps rendering the data it already has
until the wider response lands". Nothing implemented that.

`readMonthFor` does now: the wanted key if it has a dataset, otherwise the best
other tier of the same month, with `loading` and `error` still taken from the
wanted key so the spinner tracks the request in the air and a failure is still
reported. Substituting is safe in both directions because `matchesSubFilter`
gates every `targetedOnly` event on the reader's *current* selection — a
stand-in carrying a tier they have not asked for cannot show it.

### Bugs 3 and 4 — one flag, two categories

`needsTargetedTier` returned `sportsTier || esportsTier`. Every layer below it
could then only answer "targeted, but for whom?" with "both":

- **Discovery.** All fifteen targeted slices are `feeds: "sports"`. Narrowing
  eSport ran them, and the extra sport events they returned included some that
  clear the broad $250k floor — measured, the broad sports count moved 43 → 44
  because somebody touched eSport.
- **Curation.** The tier gate admitted `targetedOnly` rows for both categories
  under one flag: 314 rows in a both-tier build, 220 of them sports.
- **Counts.** `buildCalendarIndex` counted the whole loaded dataset, so those
  220 rows landed on the sidebar's **Sport** row: 43 → 266.

`TargetedTiers` makes the ambiguity unrepresentable, and `needsTargetedTier` was
deleted rather than left unused — a predicate whose name sounds like the
question you want is the one the next reader reaches for.

### Count semantics, stated

A selection has three layers, and each number says which it obeys. The table
lives on `buildCalendarIndex` in `src/lib/calendar-index.ts`; this is the same
table.

| number | category boxes | sub-filter | global (search, importance, weekend, favourites) |
|---|---|---|---|
| the grid, `byDay`, `trending` | ✔ | ✔ | ✔ |
| `countsByCategory` — the sidebar row | ✘ | ✔ | ✔ |
| `countsBySport` / `countsByEsport` — a picker tile, and its tooltip | ✘ | ✘ | ✔ |

Each row drops exactly the layer whose own control it is drawn beside, and
nothing else. A category row cannot obey the category boxes or it would read 0
for everything unticked; a tile cannot obey the sub-filter or it would read 0
for every option unticked — which is precisely what the reader opened the picker
to find out. Neither is licence to ignore the rest, and the previous code
ignored all three, which is why a search that hid an event still counted it.

**The tooltip's number** — the `N` in `Counter-Strike 2 · 20 events` — is
`countsByEsport[gameId]`, the same value the tile prints on its right-hand edge.
It is: the events of that game **that the browser has loaded for the visible
month grid**, with the reader's search and importance filters applied, and
neither the category boxes nor the picker's own selection applied. It is never a
global total, never the other category's, and never an upstream figure —
`verify-sub-filters` asserts the tooltip and the printed number are equal on
every tile, which is the pair a reader would notice disagreeing.

"What the browser has loaded" is a coverage statement, not a hedge: before the
first tick the browser holds only the broad tier, so a tile reads the broad
count and grows when the targeted response lands. That is the honest number
rather than a guess at one.

### Cache-key isolation

Sport and eSport occupy separate segments of every key. `tierKey` produces the
canonical string from the two booleans — sorted, four values, built from state
rather than from anything a caller typed — and it is the tier segment of both
the server's dataset key and the browser's month key:

```
server:   2026-08-01T00:00:00.000Z|2026-09-06T00:00:00.000Z|curated|esports,sports
browser:  2026-09|curated+esports,sports
```

A comma, not a `+`. `+` is the URL encoding of a space, so `targeted=esports+sports`
reached the server as `"esports sports"` and parsed as *neither* tier — a
narrowed reader silently served the untargeted calendar. `URLSearchParams`
escapes it on the way out, so the browser never showed this and only a
hand-written URL did; a unit test now pins the round trip through a query
string. `parseTierKey` accepts `,`, `+` or a space and recognises exactly two
words, so a hand-written URL works and nothing invented can widen a build.

### Persistence

The URL is the only place a sub-selection is persisted — there is no
`localStorage` for filters. `CalendarFilters.sports` is always an explicit array
of ids: **"All" is the full array**, never `[]`, `undefined`, `null` or the
string `"all"`, and `[]` means *no sports*. `parseSubSelection` normalises every
legacy and hostile shape into that one representation on the way in — an absent
parameter is all, `none` is empty, case and order and duplicates are collapsed,
unknown ids are dropped, and a value that filters down to nothing is an empty
selection rather than a silent widening. `serializeSelection` writes the inverse,
so an explicitly-enumerated full list round-trips back to the parameter simply
being absent.

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

## The control

None of the rules above changed when the control was rebuilt; what changed is
where the second level lives.

### What it replaced

The first version hung a summary line *underneath* the Sport and eSport rows.
It was accurate and it was the wrong shape. Two of the eleven categories stood
half a row taller than the other nine, the rail grew and shrank while you were
still using it, and the panel read as a tree with two branches rather than as
eleven calendars. It also made one gesture do two jobs: the only way to reach
the picker was through a control that looked like part of the category you were
trying to configure.

### What it is now

```
☑ ● Sports    Tennis · NFL          264  [⇄]
☑ ● eSports                         149  [⇄]
```

One row per category, at the same height as the nine that have no second level.
The right-hand end of the two that do carries a 24px tune button (36px in the
drawer, grown to a 44px target by a pseudo-element).

- **Press the row** → show or hide the category, exactly as before.
- **Press the tune button** → open the picker.

The two are independent in both directions. Opening the picker never touches
`filters.categories`; and the picker stays fully operable while the category is
switched off, which is what lets a reader set up "Tennis and the NFL" before
switching Sport on. In that state the picker carries one line saying the
category is off and the selection is being kept — a disabled control would have
claimed the opposite.

### The picker

One centred panel, at every width.

It used to be two frames — a 372px popover anchored beside the rail for
pointers, a bottom sheet for phones — and the popover was the wrong affordance
here. A panel that wide hanging off a 256px sidebar is a panel wedged into the
left margin: the calendar it is *about* sits off to one side, the thing reads as
a context menu, and the second level ends up feeling like more sidebar rather
than like a decision. The gesture is now what the brief asked for — press a
small control, the calendar softly recedes, and a focused surface arrives in the
middle of the screen.

**The frame.** A Radix dialog, 620px wide on a pointer and `100vw - 1.5rem`
below that (369px on an iPhone 15), capped at `min(78dvh, 620px)` tall with the
grid scrolling inside a fixed header. `showClose={false}` and a close button of
our own, because the stock one hovers to `--surface-hover` — an opaque token
that paints a solid square in the middle of the glass — and because on a phone
this sits over the filter drawer, whose own dismiss is already called "Close".

**The material** is two translucent layers, and the effect is the *difference*
between them rather than either alone. The scrim is a wash of the page's own
`--background` at 60% with `blur(5px) saturate(0.85)`: it dims by collapsing
contrast, never by darkening, so the grid and its density tints stay
recognisable behind it. Blacking out a calendar to ask which sports someone
wants is a modal dialog's manners, not a filter's. The panel then separates from
that pale ground on three axes at once — more opaque (78% against 60%), far more
blurred (24px against 5), and carrying a lit top edge, a hairline and three cast
shadows. Blur is what actually sells it: inside the panel the grid dissolves
into colour while the scrim outside still shows its shape, and that gap is what
the eye reads as thickness. `saturate(1.7)` is the other half — blurring alone
averages colour toward grey and reads as frosted plastic.

Every fill inside the panel is alpha, never an opaque token, or it would punch a
hole in the glass. The one exception is the logo chip, which has to be opaque
because four of the nineteen marks are black silhouettes needing a light ground
in both themes — so it gets a cast shadow, since a hole is exactly the thing
that casts none.

**The motion** is opacity 0 → 1, scale 0.96 → 1 and a 4px rise over 220ms on
`--ease-out`, reversing at 150ms on `--ease-in`. It is delivered by setting the
variables `tw-animate-css`'s own `enter`/`exit` keyframes read, from an
unlayered rule keyed on `[data-state]` — the same shape as
`.iridescent-orange[data-state="open"]`. Two things forced that:

- `DialogContent` hardcodes `data-[state=open]:zoom-in-95`, and `twMerge` does
  **not** treat that as conflicting with `zoom-in-[0.96]`. Verified: it returns
  both classes, so the winner would be Tailwind's emission order rather than the
  caller's intent. Setting the variable is unambiguous, and unlayered CSS
  outranks anything Tailwind emits into `@layer utilities`.
- There are deliberately **no keyframes of our own**. Tailwind v4 centres the
  dialog with `-translate-x-1/2`, which compiles to the separate `translate`
  property; the stock keyframes animate `transform`. The two compose, and a
  hand-written keyframe carrying its own `translate(-50%, -50%)` would double
  the centring and leave the panel resting a quarter of its own size up and to
  the left. Measured in the running app: the panel comes to rest at exactly
  (0, 0) from the viewport centre at 620px wide.

**The body.** An **All Sports** / **All Games** row pinned in the fixed header
above a hairline — it is the way out of any selection, and on a short phone,
inside the scroller, it would be the first thing to leave the screen. Then a
grid of tiles: two columns, three from 600px up, where the panel is 576px and
each tile still has 116px of label lane against the 92 that "Rocket League"
needs.

Each tile is `[logo] Name / N events`, stacked rather than strung across one
line. Stacking is what buys the label its width back on a phone — the count is
no longer competing for the same lane — and it is what let the tick move onto
the chip's corner, returning another 20px. The count is always there; it is what
a reader decides on, both before ticking ("is this sport worth it this month?")
and after ("what am I getting?").

Selected is four signals, only one of them colour: a translucent accent tint, a
1.5px accent hairline, a tick badge on the chip, and the label at medium weight
— plus `aria-checked`.

A sport with nothing this month recedes rather than disappearing, because an
empty hockey book in August is a fact about August and not about what the filter
supports. It recedes by *tone*, not by opacity: the mark is drained to grey and
the words step down one token to `--muted-foreground`. Fading the whole tile
would take the count to 1.8:1, and the count is the one thing on an empty tile
worth reading. A *picked* empty sport stays at full strength: at that point the
zero is the answer to a question the reader asked.

Changes apply immediately — there is nothing to save. It closes on the X, on
click-outside and on Escape, and a phone adds a Done button: it has no Escape
key and no click-outside distinguishable from a mis-tap, and the system back
gesture is the dangerous fallback, since filters are written with
`history.replaceState` and there is no history entry for it to consume.

**Why one frame is also safer.** The phone's nested vaul sheet is gone, and with
it two live bugs. vaul writes `document.body.style.pointerEvents = "auto"` when
any of its drawers closes, outside Radix's reference count — so dismissing the
old sheet un-locked the sidebar drawer still open behind it; and on iOS its
`position: fixed` scroll lock is a module-global that the same dismissal
restored, dropping the drawer's lock too. A Radix dialog nested over the drawer
touches neither: focus scopes, `aria-hidden` and scroll locks all stack by
reference count. `HelpDialog` already proved the arrangement — it opens from
inside that same drawer today. The `touch` prop survives the merge and it never
named the frame: it names finger-sized hit targets, and it still does.

### Narrowing is shown in the row, not under it

Once a selection is a strict subset the row says so inline — `Tennis` while one
name fits, `3 of 10` beyond that, `None` when the answer is none — and the tune
button takes an accent tint. Under "All Sports" the row says nothing extra,
because annotating the default is the panel describing the absence of a choice.

**One name, not three or two, and the number came off a ruler.** Two earlier
drafts budgeted this line by arithmetic and both were wrong. Measured in the
running app at 1440, 1280 and 393: the rail leaves the summary **59px** on the
Sport row and **52px** on eSport, whose name is a word longer. "Tennis" is 55.
"Tennis · NFL" is 64 — so at two names the row rendered `Tennis · …`, which is
worse than a count because it looks broken *and* names nothing. `2 selected` is
54 and overflowed the eSport row by two pixels; `2 of 10` is 38, fits both, and
says the denominator, so `2 of 10` and `9 of 10` read as the different things
they are.

The category name is pinned and the summary is what yields. Both truncating had
turned "Sports" into "Sp…" so that "Tennis · NF…" could fit, which is the row
losing the one word it cannot afford to lose. `verify-sub-filters.ts` now
asserts `scrollWidth <= clientWidth` on this element, so the next person to
budget it by arithmetic gets a red run rather than a shipped ellipsis.

Nothing is lost to the abbreviation: the tune button's tooltip and accessible
name carry the full list — "Choose sports — Tennis, NBA, Soccer, MLB, NHL" —
where there is no width to run out of.

### Logos

Every option in both pickers wears its own mark. The nineteen live in
`public/logos/sports/<id>.webp` at a uniform 96², built from the supplied
artwork in `assets/{sport,esport}-logos/` by `scripts/make-sport-logos.mjs`.

They replace a set of nineteen hand-drawn glyphs. Those existed because there
was no artwork and the league and studio marks are trademarks nobody had
cleared; the artwork was subsequently supplied, which settles both halves — so
CS2 now looks like CS2 rather than like a reticle standing in for it. Nothing is
fetched at runtime: `img-src 'self'` in the CSP is untouched, the whole set is
128KB, and none of it loads until a picker is opened.

**The build script is the reason it reads as one set.** What arrived was a
mixed bag, and all of it had to be normalised:

| problem | what the supplied set actually did | what the script does |
|---|---|---|
| format | PNG, JPEG, WebP and AVIF | decodes all four, emits lossless WebP |
| scale | 281px to 3840px wide | one 96² canvas with a 5px margin |
| aspect | round balls beside a 608×328 wordmark and a 1280×720 crop | squares each mark around **its own ink**, so a wordmark and a ball carry the same visual mass |
| ground | some transparent, five with a baked white background | flood-fills the backdrop out from the border |

The flood fill is a flood fill rather than "every near-white pixel is
transparent", and the difference is the golf flag: its pin is white and *inside*
the green, so a colour test would put a hole through the middle of the mark.
Only white connected to the edge is background. It is gated on all four corners
agreeing and being near-white, which is what keeps it away from `cs2` — whose
corners are its own blue-and-orange key art and would otherwise be eaten from
the outside in.

**Every mark sits on a white chip**, and that is one rule standing in for five
exceptions. A raster cannot change colour with the theme, and the supplied set
splits both ways: Soccer, Hockey, the boxing glove and Call of Duty are a pure
black silhouette, invisible on the dark theme's panel; Rainbow Six arrived as a
white negative, invisible on the light one. Drawn straight onto the panel, some
subset of the grid disappears in whichever theme you are in. The chip gives all
nineteen the light ground they were designed for, and squares the ragged ones
into the same object — which is most of why the grid reads as a shelf. Rainbow
Six is the one asset the pipeline flips (`INVERT`), because a white negative
vanishes on that chip too; inverting a monochrome mark yields the positive its
own press kit ships for light grounds.

A sport with nothing this month is drained with `grayscale`, not faded. Opacity
was the obvious choice and it is wrong here: the mark sits on a white chip, so
any opacity composites the chip toward the panel and the dark theme gets one
grey square in a column of white ones.

`verify-sub-filters.ts` asserts every `<img>` reaches `naturalWidth > 0` on both
desktop and phone. The option tables in `sport-icons.tsx` are exhaustive
`Record`s over the two id unions, so a sport added *without* artwork is a type
error — but nothing in the type system notices a file deleted from `public/`,
and a broken image is silent in a browser.

**Ten of the supplied logos are not used**, because they are sports the taxonomy
does not carry: chess, college football, cycling, lacrosse, pickleball, poker,
rugby, table tennis and volleyball, plus Mobile Legends and Honor of Kings on
the esports side. Adding any of them is ingestion work — a tag mapping in
`lib/sports/taxonomy.ts` and a discovery slice — not a UI change.

Labels in the picker are the *product* taxonomy — Tennis, NFL, NBA, Soccer, MLB,
NHL, Golf, MMA, F1, Cricket — because those are the things a reader means. The
data taxonomy underneath is unchanged and still honest: the id is
`american-football`, it still absorbs NCAAF, and "American Football" is what the
tooltip and the accessible name say.

## Verification

Everything below was run against a production build of this branch.

| suite | result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npm run lint` | clean |
| `npm run build` | succeeds |
| `npx vitest run` | 441 passed |
| `npm run verify:ui` | 578 passed, 0 failed |
| `npm run verify:sub-filters` | 95 checks, all passed — desktop + iPhone 15 |
| `npm run verify:sub-filter-isolation` | 73 checks, all passed — live data |
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
with no tier, `costOf` and the warm/cold decision are bit-identical, so nothing
here made the limiter tighter.

### The isolation matrix, against live data

`scripts/verify-sub-filter-isolation.ts` runs the reported cases through the
real pipeline — the actual two-tier build, the actual `filterEvents`, the actual
`buildCalendarIndex` — over a live six-week window. A fixture cannot catch any
of these four bugs: each needs the fifteen real discovery slices, the real
$250k/$100k/$500 floors and the real per-day caps. Nothing is asserted against a
number written by hand; every invariant is relative ("this must not move"), so
the file does not go stale as Polymarket's book changes.

Four separate builds are made, which is the point rather than an optimisation —
if they were one object the isolation claims would be vacuous:

```
Window 2026-07-26 → 2026-09-06 (6 weeks)
  tier "(none)"          252 events (broad 252, targeted   0)
  tier "sports"          473 events (broad 253, targeted 220)
  tier "esports"         346 events (broad 252, targeted  94)
  tier "esports,sports"  567 events (broad 253, targeted 314)
```

The measured before/after, which is the table the bug report asked for:

```
DEFAULT          Sport  43   eSport  66   Politics  2   Crypto  9   Economy  24
eSport = CS2     Sport  43   eSport  58   Politics  2   Crypto  9   Economy  24
Sport = Tennis   Sport  39   eSport  66   Politics  2   Crypto  9   Economy  24
both             Sport  39   eSport  58   Politics  2   Crypto  9   Economy  24
```

Before the fix the same two gestures produced `sports: 43 → 266` and
`esports: 66 → 160`. The script does not merely check those two numbers: for
every case it compares **all eleven** category rows and the whole per-option
tile map, so a leak into any category fails it.

Case coverage:

| cases | where |
|---|---|
| 1–13, 16, 17 | `verify:sub-filter-isolation`, against live data |
| 14 (reload), 15 (Month → Week → Agenda) | `verify:sub-filters`, in a real browser |
| 16 (the shell survives Clear all) | `verify:ui` |

`verify-sub-filters.ts` was rewritten around the new control and has grown from
20 checks to 95. The ones worth naming, because each pins something a screenshot
would not:

- the category list is **eleven rows**, and the Sport row is the **same height**
  as a category that has no picker — before and after narrowing, and at five
  selections. That pair is the redesign's whole premise, measured.
- **no `[data-sub-filter-option]` exists inside `#calendar-sidebar`**, open or
  closed. The tiles are `role="checkbox"`, and if they ever rendered inline
  rather than through the portal they would silently break the eleven-ticked-box
  count that six other assertions in `verify-ui.ts` ride on.
- **every logo decodes** — `naturalWidth > 0` on all nineteen `<img>`s, desktop
  and phone.
- opening the picker **does not toggle the category** (asserted on both the rail
  and the drawer), the picker is **operable while the category is off**, and
  editing it there **leaves the category off** while keeping the edit.
- the row's inline summary **is not cut off** (`scrollWidth <= clientWidth`),
  which is the guard that would have caught the two-name budget.
- the panel is **centred**: its own centre within 2px of the viewport's on both
  axes, 520–680px wide, clearing the sidebar's right edge entirely, and fitting
  the window vertically. Nothing else in the file would notice the centring
  being undone — a build that kept the anchored popover passed every other check.
- the backdrop is **translucent, blurred and light**: alpha under 0.9, a
  `blur()` in its `backdrop-filter`, and a luminance above 0.7 measured by
  painting the composited colour into a 1×1 canvas rather than by parsing a
  string, since Chromium serialises an `oklch()` author value as `lab()`.
- **exactly one picker body exists in the document.** Both sidebars are always
  mounted, so each sub-filtered category instantiates two `SubFilter`s; only
  Radix's open-gated portal keeps that from putting two live copies of the grid
  in the DOM, where `.first()` would happily drive the hidden one.
- **click-outside closes it, and the click does not reach the row underneath.**
  The interesting half is the second: the panel floats over the very sidebar row
  whose checkbox it must never toggle, so a scrim that let a click through would
  dismiss the picker and switch off Sport in one gesture.
- **Escape closes it and focus returns to the button that opened it** — the
  regression the trigger has to be a real `DialogTrigger` to avoid.
- **no label is cut off on a pointer**, at 1440 and 1280, in *both* pickers. The
  only clipping scan this file had ran on a phone and only ever opened Sport,
  whose longest name is "Cricket"; every width regression the three-column grid
  can introduce lands on eSport's "Rocket League".
- on a phone: the **same centred panel**, contained horizontally *and*
  vertically, 56px tiles, no horizontal scroll, **Escape dismisses one layer not
  two**, **Done leaves the filter drawer open and still interactive** behind it,
  and the **eSport picker opens** — which nothing on a phone had ever done.

It also adopts `verify-ui.ts`'s 429 accounting: a long local run against one
address earns rate-limit responses, which are the limiter working, so they are
counted and printed rather than reported as application errors.

### Tooling

- `npx vitest run` — 441 tests, including 33 covering scenarios A–M and the
  canonical tier string.
- `npx tsx scripts/verify-sub-filter-isolation.ts [weeks]` — the isolation
  matrix, against live data.
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
