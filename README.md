# Polymarket Calendar

A calendar of **important real-world events that have Polymarket markets attached** —
elections, rate decisions, fixtures, product launches, regulatory deadlines — not a
list of every market that happens to end on a date.

> Powered by Polymarket. Built by gavelsv.

## Running it

```bash
npm install
npm run dev          # http://localhost:3000
npm run build        # production build
npm run typecheck
npm run lint
npm test             # vitest
```

No API key or environment variable is needed — the Polymarket Gamma API is public.

## Freshness

A market Polymarket lists now reaches the calendar within **five minutes**.
Four layers, deliberately expiring together:

| Layer | Lifetime |
| --- | --- |
| Gamma fetch | `no-store` — always live |
| Server dataset cache | 5 min, plus a 6-hour stale window used only if Gamma is down |
| HTTP (`/api/events`) | `s-maxage=300, stale-while-revalidate=900` |
| Browser month cache | 5 min, revalidated on tab focus |

The browser layer had no expiry at first, which meant every *other* layer
revalidated and a tab left open all day silently served whatever it loaded at
breakfast. It now expires with the rest and refreshes when the tab comes back to
the foreground — polling only while visible, so an abandoned background tab
doesn't call the API all night. The iCal feeds are cached for 15 minutes.

## The distinction that drives everything

A market list would show you *"Highest temperature in Seoul on August 5?"* and
forty lower-league fixtures. A calendar should answer **"what can I trade on
today, this week, this month?"** Getting from one to the other is the whole job,
and it happens server-side before anything reaches the browser.

```
fetch per category → normalize → exclude → group → score → fit each day → render
```

On a live August window that takes **~810 raw Gamma events down to ~260 curated
ones**, with zero weather markets, zero daily price ladders and zero duplicate
derivatives.

### 1. Fetching — `src/config/discovery.ts`

Gamma ranks by volume, and sports outvolumes everything. The top 600 events in a
six-week window are **52% sports**, and the cheapest one still carries $27,740 —
so anything below that line is never retrieved at all. Every single
*"Will &lt;company&gt; beat quarterly earnings?"* market in that window sat below
it; the largest traded $19,432.

So each under-served category gets its own ranked slice, requested by tag
alongside the global pages and de-duplicated by id. Within a slice the ordering
is still volume, so each category still leads with its most significant events —
measured against its own peers rather than against the Champions League.

### 2. Exclusions — `src/config/market-exclusions.ts`

Every rule lives in one file. Three findings from auditing live events shaped
them:

- **Volume cannot separate signal from noise.** Weather markets have a *median*
  volume of $25,921 — five times the median sports event ($5,021). Any global
  threshold deletes real fixtures and keeps the spam. Noise families are named
  explicitly instead.
- **Recurrence cannot either.** 511 of 1,000 events sit in a `daily` series, but
  most are individual esports matches — genuinely distinct events. Recurrence only
  signals noise alongside a templated title.
- **Prominence is not importance.** The largest noise family attaches to real,
  prominent names — *"What will Trump say during remarks in Las Vegas?"*,
  *"Donald Trump tie color during Las Vegas remarks?"* There is a scheduled
  speech underneath, and a dozen markets on its vocabulary will bury it.

Rules are duration- or cadence-scoped, which is what separates a milestone from
its weekly twin: *"What will Apple (AAPL) hit in August 2026?"* stays,
*"…hit Week of August 3 2026?"* goes. Explicit exceptions protect anything
mentioning an ETF, approval, upgrade, launch, ruling or regulator, so *"Will the
SEC approve a Solana ETF?"* survives a rule aimed at Solana price markets.

### 3. Has it happened yet?

The obvious signal — `closed` on the Gamma event — is the wrong one. It stays
false until UMA's dispute window elapses and *every* leg settles, hours after
the thing itself is over. A Dota 2 playoff series that Team Liquid had already
won still carried `closed: false`, so the calendar advertised a decided match as
**Upcoming**, with ">99%" presented as a forecast.

The per-market `umaResolutionStatus` does not lag: unset until the event
concludes, then `proposed` → `resolved`. On that match all 59 markets carried
one; on "Democratic Presidential Nominee 2028", 0 of 128 did.

Two conditions, because either alone gets a real case wrong. A **majority** must
be answered — a stray proposal is normal on a large book, and "Presidential
Election Winner 2028" had one of 128 — **and** nothing may be outstanding with a
deadline still in the future. That second guard is what keeps a multi-strike
ladder open: "Iran leadership change by…?" has resolved March and July legs
against pending September and 2027 ones, so 60% are answered while the question
is wide open. It also stops Game 1 of a best-of-five from settling the series.

Five states come out of that, decided once for the whole logical event rather
than per market: **upcoming**, **live** (its moment has passed, the book has
not settled), **resolved** (settled, something paid out), **closed** (settled,
nothing did — voided rather than decided) and **cancelled** (Polymarket retired
it; never a calendar row, but still published as a `STATUS:CANCELLED` tombstone
so it leaves subscribers' calendars).

**Real status outranks a future deadline.** "World Cup: Nation of Top
Goalscorer" settled on 20 July with all 54 of its markets resolved, and carried
an `endDate` of 20 August. For a month the calendar showed it as a normal
upcoming event with the details panel underneath printing *Resolved* — five more
events in the same window were in the same state. Gamma records `closedTime`,
the instant a book actually paid out, and on a settled event that beats the date
ladder whenever it is **earlier**. Only earlier: a match played on the 13th
settles on the 20th once the dispute window elapses, and re-dating on *that*
would shove every finished fixture a week into the future. Settling before the
scheduled date is the only shape that says the scheduled date was never the
event.

Where Gamma records no settlement time, nothing is invented — `filterEvents`
simply refuses to show a settled event on a future day, so Month, Week, Agenda,
Search and the feeds all agree by construction.

### 4. Grouping — `src/lib/curation/grouping.ts`

Polymarket splits one fixture across several *events*, not just several markets.
Keys are tried strongest-first:

| Key | Coverage | Catches |
| --- | --- | --- |
| `gameId` | ~22% | every event describing one fixture |
| `parentEventId` | ~5% | sports derivatives pointing at their parent |
| normalized title core + month | rest | politics, which has neither |

"CF Villarreal C vs. Levante UD", "… - Exact Score" and "… - More Markets" are
three ids sharing one `gameId`. "Clacton by-election Winner", "… : 2nd place",
"… : Turnout" and "… : Margin of Victory" share nothing structural — only the
title tells you they are one by-election.

Series is deliberately **not** used as a key: a series is the *league*
(`clf-games`), so grouping by it would collapse a whole competition into one entry.

### 5. Importance — `src/lib/curation/importance.ts`

Log-compressed volume (0.44), liquidity (0.14), market breadth (0.14), how many
Gamma events merged (0.08), proximity (0.12) and a featured flag (0.08).

Volume is normalised **per category** against a scale anchor, because the
categories are three orders of magnitude apart. Getting an anchor wrong is fatal
rather than imprecise: business was anchored at $3M when its largest event trades
$19,432, so every earnings market scored near zero on the term carrying 44% of
the weight and lost every contest it entered against a football match.

Levels (standard / important / major) are assigned by *rank within the loaded
window* with absolute floors — a fixed cutoff labelled 82% of the current month
"important" and only 11% of a month two out, because proximity lifts a whole
near-term month at once.

**The score is never rendered.** It is an arbitrary magnitude on an arbitrary
scale, and printing "812" invites a reader to compare it with something; it
exists to sort. What the interface shows is the level, and never on its own:
"Major" alone reads as a verdict on the event, so it carries the number that
earned it — **Major · $18.4M volume**, or "$2M across 12 markets" when a deep
book is the real reason. The details panel says in a sentence that this is a
ranking inside the loaded range rather than a claim about the world.

Standard is unlabelled everywhere. Most of the calendar is standard, and a badge
on every row is a badge on nothing.

### 5b. Categories

Eleven buckets. **Science** and **Other** were both retired: Science because
Polymarket has no meaningful supply of it, and Other because on a live six-week
window it held exactly zero events — anything that reaches the calendar has
already cleared a per-category relevance floor, so it has already been
classified. A filter that can only ever show nothing teaches a reader that the
filters do not work. Anything that fails every rule now falls to **World**, and
a bookmarked `?categories=other` resolves there rather than being dropped.

**eSports** is the eleventh, split out of Sports. It was a flag inside that
category for one release — enough to give it a separate daily allowance, which
was the measured problem, since a CS2 quarter-final at $166k cannot win a slot
against a Tuesday MLB game at $1.4M. It is a category in its own right now
because everything else about it wanted to be one: its own relevance floor
($100k against athletics' $250k, because its whole book is smaller), its own
discovery slices, its own feed at `/api/calendar/esports.ics`, and a checkbox a
reader can untick without losing the football. Classification is Gamma's own
tags and `sport.sport` codes — no slug exceptions, no title matching.

**An empty category list means no events, not every event.** The two are
different states and the URL distinguishes them: no `categories` parameter is a
fresh visit and selects all eleven, `categories=none` is a deliberate empty
selection and survives a refresh as one. Reading empty as "everything" is what
let Clear empty the checkboxes and leave the grid full.

### 6. Relevance floors, scaled per category

A floor answers "is this big enough to matter?", and *enough* only means
anything relative to a category's own market. Median volume after exclusions:

| | | | |
| --- | --- | --- | --- |
| sports | $1,272,812 | economy | $42,996 |
| crypto | $1,873,149 | ai | $23,637 |
| world | $166,107 | politics | $12,007 |
| elections | $90,433 | culture | $4,170 |
| | | business | $1,778 |

An even-handed-looking $20,000 floor is imperceptible to sports and annihilates
business. Each floor now sits near its own category's p25–p35. What keeps that
honest is not the number but the order of operations: noise families are named
and removed *before* the floor is consulted, so the floor judges real events
against their peers rather than taking out the rubbish.

(That culture row was measured as "entertainment". The two were separate buckets
drawing from the same supply — an awards show is a culture event whichever list
you file it under — and splitting them left both thin while asking a reader to
choose between two boxes that meant the same thing. They are one bucket now.
`resolveCategoryId` in `lib/categories.ts` maps the retired id onto it, so
`?categories=entertainment` and a calendar already subscribed to
`/api/calendar/entertainment.ics` both keep working. Dropping the id instead
would leave an empty category list, and an empty list means *no filter* — a link
asking for one slice would quietly have started returning all of them.)

Sport is held to a bar no other category comes near — **$250,000**, against
$2,000 for business. Not because sport is unimportant, but because it is the
only category with something on almost every day of the year, so on equal
footing it wins the calendar by attrition. The measured surprise was how high
the bar has to be: the sports already reaching the calendar had a *median*
volume of $1.9M, so the $50,000 that sounds like a demanding threshold would
have removed exactly one event.

### 7. Fitting a day — representation, then merit

Caps decide how much fits on one day; without them a single Tuesday carried 42
sports fixtures out of 48 events, with an election buried underneath. But a cap
filled purely by score is still a volume contest, and sports and elections win it
on almost every day of the year — politics cleared the floor fifteen times in a
month and appeared three times.

So each day is dealt in two passes. **Every category present gets its best event
first**; the remaining slots go to the highest scores regardless of category. At
most 2 sports, 6 per other category, 18 total. The sports cap matters more than
the sports floor: a floor decides *which* fixtures qualify, but there are always
more $1M fixtures to backfill with, so only the cap decides how many land. Nothing that happened is
invisible, and the day's biggest events still dominate the space. "Include
smaller markets" roughly doubles the caps.

## The interface

Google Calendar's layout hierarchy, not its branding.

**Trending this week** is a popover behind a flame button in the bar, not a
panel: up to eight of the most important events in the next seven days, fed from
the *unfiltered* set so ticking a category box doesn't change what "big this
week" means. Clicking one navigates the calendar to its day and opens it. It
started life pinned above the grid, which meant the calendar — the thing people
came for — began a couple of hundred pixels down the page whether or not anyone
wanted the list. On a phone the same list arrives as a bottom sheet from the
overflow menu.

**The view switcher** is a segmented control whose selection is one element that
slides between the three, rather than a background blinking on and off each tab.
That means measuring: the labels are hidden below `xl`, so the segments are not
equal thirds and the indicator cannot be positioned by index. It reads live
geometry through a `ResizeObserver` and stays hidden until measured, so it can
never flash at the wrong width on first paint.

**Day cells** carry a four-step density heatmap scaled to the month's own
distribution, and it is a *heat ramp* rather than four shades of one colour:
lavender, mauve, peach, coral in light; violet graphite, plum, burgundy and an
amber-brown at night. Cool to warm is the shape a reader already knows from
every other heatmap, and four steps of a single hue is a choice between too
subtle to read and too heavy to put text on — three blues was both. Nothing is a
primary, chroma never passes 0.084 in light or 0.072 in dark, and every step
stays light enough (or dark enough) to carry a day number and an event chip at
full contrast. Days with fewer than three events stay on plain surface, so the
tint means something, and the top band only exists in months with enough spread
to justify it — otherwise a four-event Tuesday becomes the loudest cell on the
grid. Empty days get a single faint dot.

**Dark is authored, not derived.** Taking the light ramp and dropping its
opacity gives four muddy greys, because what carries a tint on white is
lightness and what carries it at 0.2 lightness is chroma.

**Today is the date number, and very little else.** It used to take a lifted
surface and a 3px accent bar on top of that, which made the busiest-looking cell
on the grid the one whose date the reader already knew. What is left is the
treatment every calendar uses — the number in a filled accent disc — plus a
single inset pixel of accent on the cell's own border, enough to find in
peripheral vision and not enough to lead the page. Today no longer paints a
surface at all, so it wears whatever density tint it has earned like any other
day, and the three states stay separable because each owns a different part of
the cell: **selected** is the ring at the edge, **today** is the number and the
hairline, **density** is the surface.

The disc has no ring around it any more either. `ring-*` draws *outside* the
element box, the cell clips its overflow, and on a 390px screen that came back
as a circle with a flat top.

There used to be a second tint marking a day that held a major event; it has
gone, because two meanings competing for one surface is how a calendar starts
looking muddy, and a major event is already unmistakable inside the cell.

**Every percentage names what it belongs to.** "US Presidential Election — 58%"
is not a fact about anything: the event has a dozen candidates, 58% belongs to
one of them, and printing it alone invites the reader to attach it to the title.
One rule in `lib/probability.ts` decides, with two honest shapes:

- **binary** — the market asks a yes/no question and the leader is literally
  "Yes". "Will the Fed cut in September? 72%" is unambiguous, so the bare number
  is fine.
- **outcome** — the leader is a named side, so the name and the number travel
  together: *Trump 58%*, *New York Yankees 61%*.

There is no third shape. A grouped event whose legs each report "Yes" — which is
what an election book looks like from outside — shows **nothing**, because an
omitted number costs a reader nothing and a misattributed one costs them the
point of the calendar. Settled markets show nothing either: "Ended — 100%" reads
as a live price.

Surfaces differ only in how much room they have for the name. A month cell is
~150px of chip after the time and the dot, so it shows a percentage only when it
is binary — the one shape whose subject is the title beside it. Agenda, week,
search, trending and the hover card show the name with the number; the mobile
schedule stacks them so the percentage stays in one column down the list. Event
Details relabels its row **Leading outcome** and puts the name in it, with the
full book already underneath in Related markets.

**Hovering an event** opens a preview after 150ms — category, date and time,
volume, leading probability, market count, and a link out. Radix's HoverCard
rather than its Tooltip, because a tooltip may not contain interactive content;
it is also pointer-driven, so it never fires from a tap and the existing
tap-to-open behaviour is untouched on mobile.

**Quick filters** — *Upcoming this weekend* and *Favorites* — compose with the
category boxes rather than replacing them, so "starred, this weekend, sports
only" is a thing you can ask for. Favourites are starred from the details panel
and kept in localStorage; there is no account because there is nothing to sync.

Past events — anything whose scheduled moment has gone by — recede by **colour**,
not by opacity. Fading dark text toward a pale page composites to roughly the
same grey you would get by naming one outright, so the two mechanisms cancel:
when the palette was introduced with the old 60% fade still in place, the
measured ink moved by two values out of 255. The fade is gone and the greys are
named — a title lands near 6.4:1 on its cell against a live title's 16.4:1.
Three tokens, not one, because a chip's row has three tiers and folding the
lower two together forces one the wrong way: a "past muted" dark enough to dim
the time is *darker* than the live subtle it also replaces, which would print a
finished event's volume louder than a live one's. Every value moves toward the
page — lighter on light, dimmer on dark — so "finished" reads the same in both
themes.

Colour alone turned out not to be enough on its own either: a grey title among
black ones is a difference you find by *comparing*, not one you see. So each
finished event also sits on its own settled surface with a hairline edge —
painted with an inset box-shadow rather than a border, because a border would
add a pixel to a chip inside a fixed-height grid row and nudge every sibling
under it. Light lands at 7.07:1 against the live title's 16.2:1, dark at 4.70:1
against 12.3:1. Below `sm` the surface is suppressed: a month chip there is only
its category dot, and a grey panel behind a 5px dot is grime rather than
information.

What remains non-colour is `saturate(0.6)`, and only because it does something
the tokens cannot: it drains the category dot, the star and a major event's
tinted bar without touching their near-neutral text. Not lower than that —
below `sm` the chip *is* its dot, and a fully grey one loses its category.

Hover and keyboard focus restore it in full, and viewers who have asked their
system for more contrast never see it dimmed. Past events stay clickable
throughout; the treatment is de-emphasis, not disabling. It applies in Month,
Week, Agenda, the mobile day schedule, the "+N more" popover, Search and
Trending — the last because Trending ranks by the week's volume, so a fixture
that has already been played can absolutely appear on it. Favourites are a
filter rather than a view, so they inherit whichever view is showing them. All-day entries stay
bright until the whole day is over, because their timestamp is a Polymarket
placeholder rather than a schedule.

The tokens are redefined on `.is-past` rather than `color` being set, so one
rule reaches a subtree whose spans each name their own colour utility. It has to
be `--foreground` and not `--color-foreground`: the theme block is
`@theme inline`, which *dereferences*, so `text-foreground` compiles to
`color: var(--foreground)` and never mentions the `--color-` name at all.
Overriding the wrong one fails silently.

- **Month** — seven columns, uniform row heights (one CSS grid with
  `auto-rows-fr`), up to three events per cell then `+N more`. Cells show the
  three *most important* events in time order, so a primary is never buried
  behind three morning esports fixtures.
- **Week** — an all-day band over a scrollable hour grid with a live current-time
  indicator. Events whose Polymarket timestamp is a placeholder sit in the band
  rather than being pinned to an invented hour.
- **Agenda** — an editorial timeline with sticky date headings, opening at today
  behind a "show earlier days" control. Today's heading carries the reader's own
  wall clock on the right, ticking with the minute. It comes from the same
  module-level clock store every chip already subscribes to — read inside
  `getSnapshot`, never from a render body — so it costs one interval for the
  whole page and can hand the same string to the server pass and to hydration.
  The container runs in UTC; a server-rendered time would be right for nobody
  outside that zone, so this is resolved in the browser against the viewer's
  IANA zone like every other time in the app.
- **Sidebar** — mini month, the 11 categories as checkable calendars with counts,
  importance filter, and the "Include smaller markets" advanced setting.

**A ticked box is a category that is showing.** Nothing more clever than that,
and it took two wrong models to get there. First the boxes ticked themselves
whenever nothing was selected, on the reasoning that everything was on screen so
everything was "on" — which made **Clear** look broken, because you pressed it
to empty the filters and ten boxes filled straight back in. Then they stayed
empty and the calendar carried on showing every event anyway, so the checkboxes
and the grid told the reader two different stories and the panel had to print a
sentence explaining that the boxes did not mean what boxes mean.

A fresh visit ticks all eleven. **Show all** and **Clear all** sit above the
list and are exact opposites: one ticks every box, the other unticks every box.
Neither touches importance, the quick filters or the search — their scope is the
list they sit above, and each of those has its own off-switch anyway. Both are
always rendered and go disabled at their own extreme rather than appearing and
disappearing, because an action that vanishes once you have used it is one you
cannot find again, and a control that comes and goes also moves the heading
beside it.

**Clear all is shown whenever `selectedCategoryCount > 0`**, and nothing
cleverer. It used to be gated on "has the reader narrowed anything" — and every
category ticked is the *default*, so a fresh visit counts as no narrowing. The
button that empties the list was therefore hidden in exactly the state where it
had eleven things to empty, and appeared only once you had unticked a box by
hand. `hasActiveFilters` has been deleted rather than left unused, because a
predicate whose name sounds like the question you want is the one the next
reader reaches for. `categorySelection()` in `src/lib/curation/filters.ts` is the
single place either button asks anything, and it answers in counts.

Narrowing Clear to the category list also made "clearing must not reload the
month" true by construction: `includeSmallerMarkets` is the one filter that
decides *which dataset* the month is, and a Clear that reset it kicked off a
refetch and blanked the grid while it ran. Now neither button touches it, and
neither costs a network round trip.

**The calendar is never replaced by an empty screen.** Zero categories, a search
with no hits, a quiet month far out on the horizon — all of them keep the grid,
the dates, Today, the selected day and every navigation control. What used to
happen instead was a full-panel state with a medallion, a heading, a paragraph
and a button, and it took the whole calendar with it: nothing to navigate,
nothing to compare against, and a screen that read as broken rather than empty.
The replacement is smaller in every sense — one muted line above the grid, one
note in the sidebar beside the boxes it refers to, and in Agenda (the only view
with no structure of its own to preserve) a short line where the rows would be.

Light and dark are authored independently. Keyboard: `/` search, `t` today, `m`/`w`/`a`
views, arrows to move by day in the grid, Page Up/Down by month.

### On a phone

Not the desktop layout scaled down. A month cell on a 390px screen is about 53px
wide, and a time, a dot and a title in 53px is not a compressed chip — it is four
unreadable characters.

**Month view is a split.** The grid keeps the top of the screen at 54px rows,
where an event is a single 6px dot in its category's colour (7px and ringed if
it is major — importance is the one thing worth distinguishing at that size),
capped at three. Underneath it, taking the height the grid gave up, is the
selected day's schedule: real market names, times, categories, volume and live
probability. Tapping a date moves the schedule; the calendar never leaves the
screen.

The first attempt showed three coloured bars per cell and opened a bottom sheet
on tap. It answered neither question a month view exists to answer — the bars
carried no information and the titles needed a modal, so reading two days meant
open, read, dismiss, open, read. The grid now answers *which days matter* and
the panel answers *what is on this one*, and neither needs a tap to start.

Two mechanical notes, both load-bearing. The grid is `flex-1` on a pointer and
`max-sm:flex-none` on a phone — that one class is the split, because it stops
the grid consuming the height the schedule needs. And the shell root is `h-dvh`
below `sm`: `flex-1` can only divide a height that is *definite*, and under
`min-h-screen` alone the schedule sized itself to its own list, the root grew to
match, and the footer ended up 29px underneath the fixed toolbar with the page
quietly scrolling. Both switch at `sm`, the same breakpoint as the compact grid;
when they disagreed there was a 128px-wide band that got the tall grid *and* the
panel.

The bar had grown to eight controls, which left the month title truncated to a
few characters. It keeps the four things a title bar is for — drawer, title,
today, search — and hands the rest away: stepping and view switching to a fixed
bottom toolbar within thumb reach, and trending, subscribing, help and the theme
to an overflow menu. The view switcher used to be `hidden md:block`, which meant
a phone was stuck in whatever view the URL happened to say.

The navigation drawer is a titled panel that slides in from the left with 48px
list rows and a 36px mini-month, not the 256px rail at a different width; the
same component renders both, picking a size once and passing it down rather than
sprinkling `max-lg:` through every row. Every control a finger has to hit is at
least 40px, search input text is 16px so Safari doesn't zoom the page on focus,
and scrollable regions are `overscroll-contain` so a swipe at the end of a list
doesn't turn into a browser back-navigation.

Motion is three durations (`--dur-quick` 150ms, `--dur-base` 180ms, `--dur-slow`
220ms) and one easing pair, applied only to opacity and transform — the month
grid is `auto-rows-fr` over `display: contents` rows, and animating anything
that touches layout would reflow every cell mid-frame. The global
`prefers-reduced-motion` block still wins over all of it.

They are referenced as `duration-(--dur-quick)` — parentheses. Tailwind v3's
square-bracket form still parses in v4 but compiles to a literal
`transition-duration: --dur-quick`, which is not a value, so the browser drops
the declaration. Every motion token in the app was written that way and had been
doing nothing at all: transitions were falling through to a default of 0s. The
same mistake left the empty-day dot with no background colour. If you add a
token-valued utility, use parentheses, and check the built CSS —
`grep -oE "[a-z-]+:--[a-z-]+" .next/static/chunks/*.css` should find nothing.
(Tailwind scans this file too, so don't paste the broken form here to
illustrate it; the scanner will faithfully emit the broken rule.)

## Onboarding

Three screens, seen once, and the first thing anyone sees of the product. It is
built to be understood before it is read.

**The hero is one shape changing.** A rounded 104px tile — an app icon, with the
mark and the word *Polymarket* under it — widens and flattens into the 304px
calendar card, then furnishes itself: attribution into the header, a week strip,
five events in five category colours. It is a real morph, not a cross-fade:
SVG geometry properties (`x`, `y`, `width`, `height`, `rx`) are CSS properties,
so one `rect` interpolates the whole way. That is the difference between "the
mark becomes a calendar" and "the mark vanishes and a calendar appears".

**The mark is drawn once and used everywhere.** Its geometry lives in
`lib/polymarket-mark.ts` — one path, one stroke width, one view box — and both
the onboarding hero and the app bar's `Brand` read it from there. The bar used
to draw a generic calendar glyph of its own, so the corner of the app was
introducing the product with a different logo from the one the product had just
finished showing you. Sharing the source is what stops the two drifting apart;
`markWidth()` is exported alongside it because the mark is taller than it is
wide and every caller sizes it by height.

Both draw it with `stroke="currentColor"`, so it inherits whatever foreground
its surface has and needs no second asset for dark.

**One timeline, three illustrations.** `.art-*` in `globals.css` is a 3.4s loop
divided into named beats — three reveal beats, a five-step stagger, a stroke
draw, and a rest — and all three screens are choreographed against it, so they
move at the same tempo instead of each inventing one. Same canvas, same 1.5px
stroke, same three radii, category colours pulled from `lib/categories` through
`currentColor` so the drawings cannot drift from the calendar they depict.

Two rules the keyframes have to keep, both learned the hard way:

- **Every element's base style is its last frame.** Reduced motion collapses the
  duration to nothing and falls back to that base, so the base *is* the static
  illustration. `.art-mark` ends absent, so its base is `opacity: 0` — leaving it
  at 1 stamped the wordmark across the middle of the calendar for every viewer
  who had asked for less motion.
- **Cross-fades are `linear`.** The house easing is
  `cubic-bezier(0.16, 1, 0.3, 1)`, ~99% resolved a quarter of the way in. That is
  right for something arriving and settling and wrong for a hand-off: it turned a
  14%-wide fade into a cut and left the card sitting empty for the rest of the
  window. Only the translations keep the deceleration.

`npm run verify:ui` drives the loop directly — pausing it, seeking to 200ms,
1000ms and 2600ms and reading the rect's live geometry — because an animation
that silently does nothing is indistinguishable from a static illustration in a
screenshot, and asserting the class is present proves nothing.

## Navigation

Switching Month/Week/Agenda, stepping a month, and returning to a month you have
already seen are the three things this calendar does constantly. All three used
to go to the network, and one of them never came back.

Measured on the production build, median of three runs, click to the requested
view or month being on screen with its own content:

| Interaction | Before | After | API before → after |
| --- | --- | --- | --- |
| September → October, cold | 112ms | 95ms | 1 → 2 |
| September → October, prefetched | 101ms | 26ms | 1 → 0 |
| October → September, already visited | 97ms | 19ms | 0 → 0 |
| Month → Week | 88ms | 37ms | 0 → 0 |
| Week → Agenda | 118ms | 55ms | 0 → 0 |
| Agenda → Month | 136ms | 44ms | 2 → 0 |

At 390px: 106→39, 91→28, 88→23, 112→34, 136→59, 167→64.

**Every one of those interactions used to cost an RSC round trip. Now none of
them do.** That is the `rsc` column of `npm run bench:nav`, and it is the whole
story: view, anchor and filters were *read* from `useSearchParams`, so changing
one meant `router.replace` — a Next.js navigation into a dynamic page, which
re-ran `buildCuratedDataset` on the server, and `useSearchParams` did not report
the new value until it came back. Clicking "Week" waited on the server to be
told something the client had just decided, about data already in memory. The
state is React state now; the URL is brought into line afterwards with
`history.replaceState`, the App Router's supported shallow update, and `popstate`
is handled. The query string is still the shareable source of truth — it is
written rather than read.

The API column moves in both directions and both are deliberate. Stepping to a
prefetched month now fetches nothing for that month; the two requests on the cold
row are the *next* month being prefetched and the current month's event detail,
both after the paint.

**One cached unit: the month grid.** Every view used to fetch its own window — a
grid for month and agenda, seven days for week — so *changing view*, which
changes nothing about which events exist, missed the cache by construction. A
month grid is whole weeks covering the month, so any week containing a day of
month M lies entirely inside M's grid; that makes the grid the one window all
three views can be served from, keyed `2026-09`.

Reusing it gives the week view *more* data, not less. Gamma is queried by
resolution deadline against a fixed page budget, and a seven-day query spends
that budget on a narrower slice: across the five weeks of September 2026,
serving week from the month grid surfaced 59 events the week fetches had missed
and dropped 9 they had found. It also made month and week agree about what
exists on a day they share. They used to disagree.

**The cache is a store, not a Map.** The old one was a module-level `Map` read
during render with nothing subscribed to it, so a write from an effect updated no
state and nothing re-rendered. Month → Week left the calendar dimmed at 60%
*permanently*, waiting for data already sitting in the cache unread — the loader
saw it cached and returned, and no state had changed to trigger a paint.
Instrumented, one commit apart:

```
WEEK [RENDER]      key= …2026-09-06…  cached= false
WEEK [LOAD-EFFECT] key= …2026-09-06…  cached= true
```

**Prefetch that survives a click.** Next month as soon as the visible one lands,
previous month when the browser is idle. The old prefetch depended on the
`anchor` *Date* — a fresh object on every URL parse — so it tore itself down on
every interaction and its cleanup aborted both requests: clicking a day killed
the fetches meant to make the next month instant. Requests also shared one
promise while the first caller's signal owned the `fetch`, so one navigation
could abort another's. Each month now owns its `AbortController`, and only months
outside {current, next, previous} are aborted. Nothing stale can reach the screen
regardless — the UI reads one month by key, so a late response for another month
has nowhere to go.

**Derived once.** Day buckets, category counts, the density heatmap and Trending
are pure functions of (dataset, filters), so they are built once in
`lib/calendar-index.ts` and read by all three views. The arithmetic was never the
cost — tens of microseconds — but each recomputation minted new array identities,
and `byDay` is the prop every view's `React.memo` compares.

**Only what is visible is built.** A month cell renders at most three chips and a
`+N more`, never hidden overflow. The agenda mounts eight days on the first paint
and fills in the rest on idle, which is why its *paint* halves while its fully
mounted time does not: the view is usable in 55ms instead of 118ms, and the
remaining ~2,500 elements arrive behind it. The phone's day schedule is no longer
mounted on desktop behind `sm:hidden`, where it was building an uncapped
invisible row per event. Nothing is removed from the dataset — only *when* the
DOM is built changed.

**A chip is a chip.** All ~126 chips in a month grid each mounted a Radix
HoverCard — root, provider, popper, trigger, portal, presence — for a card that
renders nothing until hovered, and called `window.matchMedia` twice per render to
ask whether this is a touch device. The hover card is now built on the first
pointer that arrives; media queries are cached per query string. Grid cells are
also keyed by position rather than by date, so stepping a month updates 42 cells
instead of unmounting and rebuilding them.

**Event detail is fetched separately.** `relatedMarkets` was 269KB of a 462KB
month — 58% of every byte — and nothing on the calendar reads it; it fills one
collapsed disclosure in the details panel, one event at a time. The calendar
payload is 193KB now and the legs arrive on idle, or sooner if a panel opens
first.

## One viewport, no page scroll

The shell is `h-dvh` and `overflow-hidden` at every width. A calendar you scroll
the *page* to read is a document pretending to be an application, and the
failure is invisible in a screenshot — the grid looks right, it is simply half
of it. `dvh` rather than `vh` so it tracks mobile browser chrome sliding in and
out.

That definite height is also what lets the month grid **size its rows to the
space available** instead of claiming a fixed 112px each — six of those plus the
bar exceeds a 720p screen, which is exactly where the page started scrolling.
Rows now divide the workspace: ~187px at 1920×1080, 151px at 1440×900, 115px at
1280×720, and the grid still fits whole.

How many chips a cell shows follows from that, so it is **measured rather than
assumed**. A `ResizeObserver` on the grid reports the real row height and the
cell derives its capacity from it, which is the only way `+N more` can be
truthful — it is the difference between the events a day holds and the ones that
fit, and "fit" is not a constant.

Only two regions scroll, and never at the same time as each other:

| View | What scrolls |
| --- | --- |
| Month | nothing — the whole grid fits |
| Week | the hour grid, inside itself |
| Agenda | the list, inside itself |
| Sidebar | nothing, at any tested size |

The week's horizontal container needed `overflow-y-hidden` spelled out: CSS
promotes the other axis to `auto` the moment one of them stops being `visible`,
so on a narrow phone it had quietly become a second vertical scroller wrapped
around the first. The sidebar was compacted to 32px rows and a 12px section
rhythm, and its two actions were lifted out of the scrolling body and pinned
below it — so even on a screen too short for the category list, "Add to
calendar" is where it was.

Verified at 1920×1080, 1440×900, 1366×768, 1280×720, 768×1024, 430×932, 390×844
and 375×667, in all three views. `npm run verify:ui` asserts the document's own
scroll height at each of them, that every week row is on screen with nothing
clipped, and that no view has more than one scrolling region.

### Browser zoom

Ctrl+= does not scale the application, it **shrinks the CSS viewport**: at 150%
a 1920×1080 screen reports 1280×720, and at 200% a 1366×768 screen reports
683×384. So zoom is the responsive problem again at sizes nobody thought to
test, and the fix is responsive layout rather than detecting a zoom level —
which would be the wrong answer and is not something a page can reliably measure
anyway.

Measured across all three desktop resolutions at 80/90/100/110/125/150/175/200%
in all three views. Two things broke.

**The app bar had its priorities inverted.** Every control was `shrink-0` and the
month title was the only flexible thing in the row, so the whole deficit went to
the title: **0px wide** at 1280 and 1024, while the right-hand group still ran up
to 61px past the viewport. The reader lost the date — the one thing a calendar
header exists to say — and kept the theme toggle. Six controls were turning on
together at `md` (768px) when they need about 900px between them.

The tiers are explicit now, each turning on where it measurably fits:

| Tier | What appears |
| --- | --- |
| always | menu, mark, Today, the title |
| `md` 768 | step back/forward, the Month/Week/Agenda switcher |
| `lg` 1024 | wordmark, timezone, Trending, Help, Add to calendar, theme |
| `xl` 1280 | the search *field* rather than its icon |
| `2xl` 1536 | the words "Add to calendar" beside its icon |

Everything the `lg` tier hides is already in the overflow menu, so nothing is
unreachable at any width — it is one tap further away. The title is the flex
child now rather than having a spacer beside it, and the bar carries
`overflow-hidden` as a backstop so a future control is clipped at the edge
instead of painted over the calendar. At 1280 the title went 0px → 142px.

**Centred dialogs taller than the window lost their close button.** Half the
excess goes off the *top*, which is exactly where the close button is: the
subscribe dialog is 771px of content, so at 150% on a 1440×900 screen it
rendered at y = −85, dismissable only with Escape. `DialogContent` caps at
`calc(100dvh - 2rem)` and is a flex column that hands overflow to whichever child
scrolls; every panel already had one and only needed `flex-1` to claim the
height.

The month grid and week view needed no changes, and the measurements say why:
every column already carries `min-w-0`, so a long title cannot widen one —
column spread is 0px at every size tested — and the week grid already scrolls
inside its own workspace below `md` rather than at the document level.

## Dates and times

Gamma sends nine date-bearing fields between an event and its markets, and only
two of them describe the real world. `npm run data:dates` walks a live window
and prints the coverage and divergence tables the ladder below came from; the
findings are recorded in `lib/curation/event-date.ts` beside the code they
justify. Measured over 765 events on 2026-08-11:

| Rung | Field | What it is |
| --- | --- | --- |
| 1 | `markets[].gameStartTime`, **on a fixture** | The real kickoff |
| 2 | `eventDate` | The real event day, `YYYY-MM-DD` |
| 3 | reviewed unanimous `markets[].endDate` | A human at Polymarket checked it |
| 4 | `markets[].endDate` | Where the event carries none |
| 5 | `endDate` | The resolution deadline |

**Rung 1 only counts on a fixture.** `gameStartTime` means "kickoff" on a real
match and something else entirely everywhere else: 80 of the 370 events
carrying it are not fixtures, and there Polymarket reuses it to mark the start
of a *measurement window*. WTI's August market claims 31 July, "Elon Musk #
tweets August 11 – August 18" claims the 11th, every daily weather market lands
a day before the date in its own title, and a two-month US-Iran market lands
eight weeks early. Taken at face value it moves 67 of those 80 to the wrong day.
The gate is Gamma's own sports metadata and it is unambiguous: all 290
sport-tagged events with a kickoff carry `gameId`, exactly two `teams` and a
`sport` — MLB, football, tennis and esports alike — and none of the other 80
carry any of it.

On a real fixture the field is worth the whole ladder. Polymarket sets a sports
market's resolution deadline *a week after the game*, so 231 of the 300 days it
moves are exactly that: Toronto Blue Jays vs Chicago Cubs is played on 6 August
and its market ends on the 13th.

**Three fields that read like the event date are not.** `startDate` is when the
market opened — present on 100% of events, disagreeing with `endDate` on 763 of
765, and reporting 2026-05-13 for "Fed Decision in September?", four months
before the meeting. `markets[].eventStartTime` is a row timestamp: every market
of the WTI August book carries the identical `2026-07-25T04:02:24.716Z`.
`startTime` is mixed — of the 137 events carrying it without a kickoff, 78 land
on the endDate's day, 57 land *earlier* (market-open timestamps) and 2 land
later, one of them a year past its poll. It is allowed to supply a **time** for
a day already chosen and never to choose the day, which is how Berlin's state
election reads 17:00 instead of sitting in the all-day band; both sides are
checked for placeholders first, so a 23:59 endDate never becomes a fake 23:59
start.

`endDate` remains right for a great many events, and rung 5 is not a failure:
"Fed Decision in September?" has no structured real-event field at all and its
endDate *is* the FOMC day.

Every curated event carries **`dateSource`** naming the field that placed it —
`gameStartTime`, `eventDate`, `reviewedMarketEnd`, `marketEnd`, `eventEnd` or
`estimated`. It is not rendered: a reader has no use for the difference between
a kickoff and a reviewed deadline, and showing it would invite them to distrust
the dates that came from the last rung. `npm run data:audit` groups by it, per
category, and lists the real-event-field dates for spot-checking.

`parseGammaInstant` handles all three formats Gamma writes, including the one
that broke the first version of the audit script: widening a trailing `+00`
offset also matches the `-06` ending `2026-08-06`, producing `2026-08-06:00` and
silently dropping every `eventDate` on the floor.

For events with no start time to read, what every market does have is the moment
it stops trading, so that is what they show, in one of two kinds:

- **scheduled** — Polymarket wrote a specific instant, close enough to the real
  event to read as its time.
- **close** — Polymarket wrote a placeholder (`00:00Z`, `23:59Z`, `12:00Z`, or
  `04:00Z` for midnight Eastern) meaning "some time that day". The honest time
  is then the end of that day, `23:59`, rendered dimmer and labelled *Closes* in
  the details panel. Showing the placeholder itself would put a primary at 19:59.

A related trap: **midnight UTC is a date, not an instant.** Running it through
Eastern time rolls it back to 20:00 the previous evening, which was filing four
independent primaries a day early — Tennessee's (6 August) on the 5th,
Minnesota's and Wisconsin's (11 August) on the 10th, Florida's (18 August) on
the 17th. Exact midnight now keeps its UTC date; `03:59:59.999Z` is still a real
instant and still buckets to the previous evening.

## Timezones

Every timed event is an **absolute instant**. `endDate` is an ISO 8601 UTC
timestamp and it is the only canonical form; the clock face and the calendar day
are both derived, per viewer, from their own IANA zone. The same fixture is 19:00
on the 10th in Sofia and 12:00 on the 10th in New York — and `2026-08-11T00:30Z`
is the 11th in London and the **10th** in Chicago, so this is not a relabelling
of the clock: the event changes which cell it belongs to, and the grouping
follows it.

An **all-day event is not an instant at all.** Polymarket wrote a placeholder —
midnight, or 23:59 — meaning "some time that day", and the day is a civil date.
`2026-08-10` is 10 August for everybody. Converting one is how four primaries
were once filed a day early, so all-day dates are never converted. The two ideas
stay separate the whole way down: `lib/timezone.ts` handles instants,
`lib/localize.ts` leaves civil dates alone.

Conversion happens **once per dataset**, in `localizeEvents`, before filtering
and before the day index. Month, week, agenda, the hover card, search and the
phone schedule cannot disagree about an event because none of them converts
anything — there is one pass and one answer. It is also cached on the dataset's
own identity, so switching view or stepping to a cached month reuses it and the
navigation work from the previous pass is untouched.

Everything else that asks what day it is asks in the viewer's zone too: today's
cell, the mini calendar, the Today button, agenda headings, the week's day
columns and its current-time line, which used to sit at Polymarket's wall clock
seven hours behind a reader in Sofia.

**The server cannot detect a timezone, so it remembers one.** An inline script
in the document head writes the browser's IANA zone to a cookie *before the
first paint*, and every render after that — server and client — starts from the
same answer. With JavaScript switched off entirely and that cookie present, the
server's own markup is already in the reader's zone; there is nothing to patch
afterwards.

Doing it in a React effect instead, as this first did, meant waiting for the
bundle to download, parse and hydrate — measured at 435ms on a cold load, during
which the calendar showed Polymarket's timezone rather than the reader's. The
effect is still there as a backstop for a blocked inline script, and
`useSyncExternalStore` still corrects the current render via
`getServerSnapshot`, so the worst case is one render rather than a stuck
calendar. The server value arrives as a prop and lives in context, never a
module variable: module state on the server is shared by every request, and two
readers in different zones would overwrite each other.

**Module state on the server is also never refreshed.** The minute clock behind
`useNow`, `useTodayKey` and the agenda's local time is one module-level store,
polled by an interval — and nothing subscribes during SSR, so that interval
never starts. It used to fill its cache on first read and thereafter trust the
interval to move it on, which meant a server rendered the minute its process
booted, forever: an hour in, the agenda heading was serving an hour-old clock,
and a server up across local midnight would have marked the wrong cell as today.
`getSnapshot` now re-reads on every call, which inside a minute is a floor
division and a comparison.

The clock itself renders **only in the browser**. The server has no way to know
the reader's minute, and React treats a differing text node as a hydration error
rather than something to reconcile — so a server-rendered guess becomes error
#418 on the next minute boundary. `useTodayKey` still resolves on the server,
because the grid has to name a cell on the very first paint; a day key survives
the gap that a minute-precision one cannot.

All of it goes through `Intl` with an IANA name, so daylight saving is the
platform's problem. `Europe/Sofia` is UTC+2 in January and UTC+3 in July and
nothing here knows that — including the `GMT+3` beside the month title, which is
read at the current instant and tells you which clock you are looking at.

Exports were audited and needed no change, which the tests now hold in place: a
timed event exports `endDate` and comes out as the same absolute instant in
every zone; an all-day event exports its civil date as a DATE value with no UTC
stamp anywhere near it.

## Search, and the catalog behind it

The month grid loads six weeks because that is what it draws. Search has the
opposite requirement — somebody typing "Fed Decision" in August wants October's
meeting whether or not they have ever navigated to October — so the two need
different shapes, and the mistake would be to serve one from the other.
Widening the calendar's own fetch makes every Month view heavier for a dialog
most visitors never open; narrowing search to the loaded month is the bug.

So there are two datasets. `src/lib/catalog/catalog.ts` builds a broad one
spanning a month back and eight forward, kept on the server and reached only
through `/api/search`. It never enters the initial payload and the browser never
downloads it: what crosses the wire is at most two dozen matching events, and
only once the dialog is open and two characters have been typed. The dialog
searches the month already in memory on every keystroke — free, instant — and
merges the catalog's results underneath a heading, ranked by the same
`searchEvents` on both sides so the list has one ordering rather than two.

It is affordable because cost is set by the number of Gamma requests, not by the
width of the window: one ranged query spanning nine months costs the same as one
spanning six weeks. Measured cold on 2026-08-17: 977 curated events across all
eleven categories in 3.5s, cached for ten minutes with a six-hour stale
fallback. The per-day caps are skipped here — they exist because a month cell
fits three chips, and an index has no cells.

**Recurring series come from Gamma, not from string surgery.** 29 of 34
central-bank events carry a `series` row, so "Fed Decision" reaches September,
October, December and January through `fomc` — a word that appears in none of
their titles. Where Gamma has nothing, a fallback strips the month and year from
the title (`"ECB Interest Rates: October 2026"` → `ecb interest rates`), and it
is only ever a *grouping* key: August and September stay two events on two days,
which is the whole point. Ranking puts upcoming above settled structurally
rather than leaving it to volume, because a resolved market has traded for
months and would otherwise lead every search for a series that repeats.

## Calendar integration

Two distinct things:

**Add one event** — a Google Calendar template URL, an Outlook compose deep link,
or a single-event `.ics` download. All-day events use the date form; a timed event
uses a UTC instant pair. Neither ever invents a time.

**Subscribe to a live feed** — public read-only iCalendar endpoints:

```
/api/calendar/all.ics
/api/calendar/politics.ics
/api/calendar/custom.ics?categories=politics,ai&minImportance=important
```

RFC 5545: CRLF endings, lines folded at 75 **octets** (measured after UTF-8
encoding, so accented team names fold correctly), escaped commas/semicolons/
backslashes/newlines, and **UIDs derived only from the Polymarket event id** — that
is what makes a refresh update events in place instead of duplicating them. Feeds
carry confirmed dates only.

**Three properties carry the subscription, and they fail differently.** A wrong
UID adds a second copy beside the first; a wrong `SEQUENCE` leaves the client
holding the stale one; a wrong `LAST-MODIFIED` leaves it unable to order two
revisions at all. Both of the latter come from Polymarket's own `updatedAt` —
the newest across the event and every market folded into it — so they move only
when the event really has.

`SEQUENCE` is **minutes since a fixed epoch**, read off that timestamp. The
obvious stateless implementation is to hash the event's contents, and it
satisfies "changes when the event changes" while breaking the half that matters:
a hash is as likely to go down as up, and a client seeing a lower sequence is
entitled to ignore the update. Minutes-since-epoch is monotonic because time is,
and still a pure function of the event, so unchanged data still serialises
byte-for-byte identically. Minutes rather than seconds because Gamma rewrites
`updatedAt` on price moves, and a per-second counter would advertise a revision
every few seconds for a change no calendar entry reflects. Live values land
around 1.37M, well inside the 32-bit range clients assume. `LAST-MODIFIED` is
omitted rather than invented when Gamma sends nothing readable.

**Retraction.** An event Polymarket has archived is not dropped from the feed —
dropping it leaves the entry in every subscriber's calendar forever, because
absence is not a signal. It is republished under its original UID with
`STATUS:CANCELLED`, which is the documented route for a PUBLISH feed
(`METHOD:CANCEL` is an iTIP message to named attendees and means nothing in a
subscription). The higher SEQUENCE that makes the retraction stick is free:
archiving rewrites `updatedAt`. Only `archived` on every source row counts — a
closed or voided book is not cancelled, the thing happened and the market simply
paid nobody, and tombstoning those would delete legitimate past entries.

**Google gets instructions, not a button that looks like it finishes.** There is
no endpoint that adds an arbitrary feed to somebody's Google account —
`addbyurl` opens the right screen and sometimes pre-fills it, and nothing more.
So the dialog gives four numbered steps with *Copy calendar URL* as the action
that matters, and on a phone it says outright that adding a calendar by URL is a
web-only setting absent from both Google Calendar apps. Apple keeps the
one-click path it genuinely has (`webcal://`), and the two buttons under it say
how they differ: subscribing stays current, the `.ics` download is a snapshot
that never changes again.

### Outlook

Outlook is two products behind one name, and the difference is not cosmetic. A
personal Microsoft account lives on `outlook.live.com`; a work or school account
lives on `outlook.office.com`. A link to the wrong host does not degrade — it
lands on a sign-in page for an account the visitor doesn't have. So the dialog
offers both, labelled by the account rather than by the hostname
(`src/lib/calendar-export/outlook.ts`).

The subscribe shortcut posts the feed to `/calendar/0/addfromweb`, the route
Outlook's own **Add calendar → Subscribe from web** screen uses. That route is
undocumented, so it is never the only way in: the feed URL sits beside the
buttons, and pasting it into that same screen is the path that cannot break.
Adding a single event uses `/calendar/deeplink/compose`, which *is* documented,
and matches the all-day conventions of the ICS and Google exports so one event
never lands on two days in one client and one in another.

Two feed properties exist purely because Outlook reads different ones from
everybody else:

- `X-MICROSOFT-CDO-BUSYSTATUS:FREE` on every event. Outlook ignores `TRANSP`,
  so without it a subscribed month of fixtures blacks out the subscriber's
  free/busy and makes them look unavailable to their colleagues.
- `X-PUBLISHED-TTL` alongside the RFC 7986 `REFRESH-INTERVAL`. Outlook reads the
  Microsoft one, so the cadence is stated twice. It is a hint either way —
  Outlook re-polls subscribed calendars on its own schedule, up to once a day,
  which is slower than Google or Apple and worth saying out loud in the UI
  rather than leaving people to wonder why this morning's event isn't there.

`npm run verify:feed` asserts both against the live feed, per event.

## Layout

```
src/
  app/
    page.tsx                     server-rendered first range
    api/events/route.ts          curated events for a range
    api/calendar/[feed]/route.ts public iCal feeds
  components/
    calendar/   month, week, agenda, event chip, day popover
    shell/      app bar, mobile toolbar, overflow menu, trending menu,
                sidebar + drawer, mini calendar, view switcher, brand
    event/      details, related markets, add-to-calendar
    onboarding/ dialog + art/ (hero morph, category merge, subscribe links)
    subscribe/  help/  search/  states/  ui/
  config/
    market-exclusions.ts         every curation rule
    discovery.ts                 the per-category fetch slices
  lib/
    curation/   exclusions, grouping, importance, curate, dataset, filters
    timezone.ts                  IANA conversion: instants in, local days out
    localize.ts                   one pass per dataset, all-day left alone
    calendar-cache.ts            month-keyed store: load, prefetch, cancel
    calendar-index.ts            day buckets, counts, heatmap, trending
    related-markets.ts           event legs, fetched apart from the calendar
    polymarket-mark.ts           the traced mark, shared by hero and app bar
    probability.ts               one rule: name the outcome or show nothing
    emphasis.ts                  what "Major" means, in the reader's terms
    curation/event-date.ts       the date ladder, and the evidence for it
    calendar-export/  ics, google, outlook, feed-url
```

## Analytics

Google Analytics 4, through Next's own `@next/third-parties` integration, mounted
once in the root layout so it covers every public page. The measurement ID lives
in `NEXT_PUBLIC_GA_MEASUREMENT_ID`. No ID, no tag: `next dev` does not read
`.env.production`, so local development is untagged by default, and blanking the
variable on any deployment switches analytics off cleanly rather than leaving a
half-initialised `gtag`.

The ID is public. It is inlined into the client bundle and readable in page
source, which is why `.env.production` is committed — it is a destination, not a
credential, and committing it means a fresh deploy is correctly tagged with no
dashboard step. A real environment variable of the same name still overrides it.
Nothing secret belongs in that file.

**It is rendered from the server, and that is the fix for a real outage.** For a
while production carried the gtag.js `<link rel="preload">` and nothing else:
`window.dataLayer` and `window.gtag` were undefined and not one hit was ever
sent. The cause was a `"use client"` wrapper around the official component that
read the ID itself and bailed out when it was missing:

```tsx
"use client";
const gaId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
if (!gaId) return null;
```

Those two lines mean different things on each side of the wire. `NEXT_PUBLIC_`
values are substituted into the client bundle at *build* time, while the server
reads the live environment at *runtime*. A build machine without the variable
therefore produced a server render that emitted the preload — enough to make the
page look correctly tagged, and enough to fool a check that greps the HTML — and
a client bundle where the same component returned `null` and injected nothing. A
preload fetches a file; it never runs it. Every localhost check passed the whole
time, because localhost had the variable.

So the component is rendered directly from the root layout, a server component:
`gaId` travels in the RSC payload rather than being compiled into the bundle, and
the literal fallback means it cannot be empty. The served HTML now carries the
measurement ID twice — preload plus payload — which doubles as a fingerprint for
whether a deploy actually took.

**Known, unfixed: filter clicks are counted as page views.** This app keeps view,
month, selected day and every filter in the query string, written with
`history.replaceState`, and GA4's Enhanced Measurement reports each history event
as a page view. Measured: one history write on load and one per interaction, so a
visitor ticking five boxes and stepping two months is filed as eight page views
of eight different pages. Nothing there is a page; it is one page being filtered.

The fix is a second `config` call with `send_page_view: false` plus a manual page
view on real route changes, and it was in the tree for exactly one release. It
came out again because it was layered on top of a tag that was not loading, and
two problems stacked on each other are much harder to read than one. It goes back
once Realtime has shown data for a while — but as an optimisation applied to
something known to work, not as part of getting it working.

`verify:ui` and `bench:nav` abort every request to Google's hosts. A full
verification run is a few hundred page loads from a headless browser; letting
those reach the property would file a day of fake traffic into a real report
every time anyone checks the UI, and would put a third-party script's latency
inside a benchmark whose whole job is to measure this app.

## Verification

```bash
npm test                      # 375 unit tests
npm run verify:feed           # live ICS feeds against RFC 5545
npm run verify:analytics      # the deployed site really sends a page_view Google accepts
npm run verify:calendar-parity # the published feed against what the site shows
npm run verify:ui             # real Chromium: 8 viewports, 5 zoom levels
npm run bench:nav             # click-to-painted for every navigation, desktop and 390px
npm run data:audit            # what the pipeline kept and threw away, by dateSource
npm run data:dates            # which Gamma date fields exist, and where they disagree
npm run data:esports          # how much of the esports book reaches the calendar
```

`npm run verify:calendar-parity` exists because a subscribed calendar that
quietly disagrees with the website it came from is the one bug a reader cannot
diagnose. It rebuilds both sides from live data — the site month by month, the
feed through its own builder — serializes the ICS, parses it back, and reports
website events, ICS events, unique UIDs, missing and extra, per filter scenario
and per day. It also validates every VEVENT structurally: UIDs unique across the
feed, all-day `DTEND` exactly one exclusive day later, timed `DTSTART`/`DTEND` in
UTC and in order. Any divergence fails the run.

When it was first written it found nine: six events the feed's single
three-month volume-ranked query never retrieved, two cut by per-day caps applied
over a dataset the website never sees, and one dropped by an export-only
date-confidence filter nothing documented.

`npm test` covers exclusions (weather, price ladders in crypto/index/equity form,
soundbite and chart noise, and the near-miss titles beside each that must
survive), grouping (gameId, parent id, title-core, bracket qualifiers, and *not*
merging unrelated events), category resolution, deterministic scoring, the
representation-then-merit day fit, ICS validity and UID stability, Google link
fields, all-day export, URL round-trips and invalid-input fallbacks, the
civil-date vs market-time key distinction that once shifted the entire grid by a
day, and whether a given event counts as past — in the *reader's* zone, so the
same instant is behind a reader in Tokyo and ahead of one in Los Angeles.

Four files are new to the release pass:

- **`event-date.test.ts`** — one case per category shape (MLB, esports,
  election, central bank, awards, crypto, end-date-only, all-day, timed), plus
  the fields that look usable and are not, and the fixture gate that keeps
  `gameStartTime` from filing a month-long commodity market on the day its
  window opened.
- **`probability.test.ts`** — the rule that a number is only shown when the
  thing it describes is named or obvious, including the exact defect it exists
  to prevent: a twelve-leg election whose headline market still reports "Yes".
- **`feed-updates.test.ts`** — a reconciler that replays several feed
  generations the way a subscribed client would and asserts what the subscriber
  is left holding: one copy, moved rather than duplicated, retracted when
  cancelled.
- **`subscribe-urls.test.ts`** — feed URLs as *identities*, since a calendar app
  treats a changed URL as a different calendar: order stability, filters
  surviving the webcal scheme swap, and single encoding through Google's `cid`.

Timezones get their own file, across Sofia, London, New York and Tokyo: one
instant read as four different clock faces, the same instant landing on two
different calendar days, midnight rendered as `00:00` rather than `24:00`,
daylight saving handled without an offset appearing anywhere, a sports kickoff
staying one moment seen from three places, an all-day event refusing to move in
any zone, and an export that produces the same UTC instant — and the same DATE
value — whoever built the link.

`npm run verify:ui` drives a browser set to `Europe/Sofia` **with JavaScript
disabled** and checks the server's markup carries GMT+3 *and the current date*
— the latter because a cached module-level clock once had the server rendering
the day it booted on. It then compares every shared event between a Sofia
browser and a Tokyo one: not "the times differ" but one constant six-hour
difference, because a calendar wrong by a fixed amount looks completely normal
until somebody misses a fixture. All-day events must not move at all.

The agenda's clock is checked from Auckland and Los Angeles — both must show
their own wall time, and the server must render no clock at all, which is the
invariant that keeps hydration clean. The assertion brackets its read rather
than matching an instant, so a minute ticking over mid-check is not a failure;
a wrong zone is an hour out, which the bracket still catches.

It additionally asserts the balance itself: at least seven
categories represented, no category above half the calendar, and business,
technology, culture and politics all non-empty. It ends with a mobile pass
on a 390px touch context: the view switcher is reachable, switching view actually
changes the URL, the month title isn't truncated out of the bar, every control is
at least 40px in its smaller axis, the drawer arrives at the left edge with a
close control and 44px+ rows, the overflow menu carries what the bar gave up, and
the fixed toolbar doesn't cover the footer.

Six of those checks are the month split's whole contract: the grid rows are 54px
and uniform, events in a cell are dots (roughly square, ≤10px) capped at three,
the schedule below claims at least 200px, the two halves together don't make the
page scroll, the schedule carries *real market names* without a tap — that one is
the user complaint restated as an assertion — and tapping a date changes the
schedule's heading without opening a dialog.
