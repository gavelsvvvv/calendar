# Calendar / ICS security report

Everything published into a subscriber's calendar is built from Polymarket's
public API. Anyone who can create a market chooses that text, so all of it is
treated as attacker-influenced.

Regression suite: `npm run verify:calendar-security` (pure, no server needed).

---

## 1. Calendar surfaces

| Surface | Input | Output | MIME | Disposition | Cache | External data used |
| --- | --- | --- | --- | --- | --- | --- |
| `GET /api/calendar/[feed].ics` | `feed` ∈ allowlist (`all`, `custom`, category ids) + filter query | VCALENDAR | `text/calendar; charset=utf-8` | `inline` | `s-maxage`, 6h refresh hint | title, outcome, volume, slug |
| `GET /api/calendar/event/[id].ics` | `id` = Gamma event id/slug | VCALENDAR, one VEVENT | `text/calendar; charset=utf-8` | `attachment` | none | same |
| Google Calendar link | event | `calendar.google.com` template URL | — | — | — | title, description |
| Outlook link | event | `outlook.live.com` / `outlook.office.com` deeplink | — | — | — | title, description |
| `webcal://` subscribe | our feed URL | scheme-swapped feed URL | — | — | — | none |

## 2. Injection — tested, closed

Hostile fixtures are built for every field that reaches a property, the generated
feed is inspected, and then **re-parsed with `ical.js`** — an independent
standards-compliant implementation — so the escaping is judged by something that
did not write it.

| Vector | Before | After |
| --- | --- | --- |
| CRLF in `event.id` → UID | **`ATTACH` + `X-EVIL` injected** | sanitised token |
| CRLF in title → SUMMARY | blocked (escaped) | blocked |
| `BEGIN:VALARM` in title | blocked | blocked |
| CRLF in `leadingOutcome` → DESCRIPTION | blocked | blocked |
| CRLF in URL | blocked (but mis-escaped) | allowlisted, omitted if bad |
| CRLF in `displayDate` → DTSTART | **`ATTACH` injected** | event declined |
| Lone CR / lone LF | blocked | blocked |
| Second `VEVENT` | blocked | blocked |

Asserted absent from every generated feed: `ATTACH`, `VALARM`, `ORGANIZER`,
`ATTENDEE`, `X-ALT-DESC`, `RRULE`, `RDATE`, `EXDATE`, `RECURRENCE-ID`, and any
`text/html` payload.

## 3. Escaping and folding

Per RFC 5545 §3.3.11: backslash first, then `;`, `,`, and CR/LF → `\n`.
Folding counts **octets after UTF-8 encoding**, not characters.

Verified by independent parse, with no replacement characters, for: ASCII at
200 chars, `é`×120, 🇯🇵×60 (surrogate pairs at the boundary), 東×150. Every line
≤ 75 octets.

## 4. Minimal schema

A VEVENT contains exactly: `UID`, `DTSTAMP`, `SEQUENCE`, `LAST-MODIFIED`,
`DTSTART`, `DTEND`, `SUMMARY`, `DESCRIPTION`, `URL`, `CATEGORIES`, `STATUS`,
`TRANSP`, `X-MICROSOFT-CDO-BUSYSTATUS`.

The last is justified: Outlook ignores `TRANSP`, so without it every entry in a
subscribed feed lands as *Busy* and blacks out the subscriber's free/busy.

**No `ATTACH`. No `VALARM`.** Neither is ever emitted, and no upstream value can
introduce one — asserted directly.

## 5. Description template

Assembled from our own fields, never copied from an upstream description:
category label, probability, volume, related-market count, an allowlisted
Polymarket link, an allowlisted back-link, and the independence statement.
Capped at 1200 characters. No HTML.

## 6. Unicode policy

**Stripped:** C0 control characters and DEL (`U+0000`–`U+0008`, `U+000B`,
`U+000C`, `U+000E`–`U+001F`, `U+007F`); bidi overrides and zero-width characters
(`U+200B`, `U+200E`, `U+200F`, `U+202A`–`U+202E`, `U+2066`–`U+2069`, `U+FEFF`).

Rationale: `U+202E` reverses render order, so `Invoice\u202Etxt.exe` displays as
`Invoice exe.txt` in a calendar entry while remaining an executable name. No
legitimate market title contains one.

**Preserved:** everything else. Deliberately narrow — seven code points — so
international titles are untouched. Asserted: `Fenerbahçe · 東京 · Ærø · 🇺🇸`
survives a round-trip intact.

## 7. UID, SEQUENCE, updates

- UID = `pmc-<sanitised id>@calendarpolymarket.com`. Our domain. Not
  `calendar.polymarket.com`, which we do not own — asserted negatively.
- Stable: the same event yields the same UID regardless of title changes, so a
  refresh updates in place rather than duplicating.
- Distinct ids yield distinct UIDs (tested across numeric, hyphenated and
  case-varying ids).
- `SEQUENCE` = minutes since a fixed epoch, from `lastModified` — monotonic, and
  never supplied upstream. Absent `lastModified` → 0.
- Cancellation publishes `STATUS:CANCELLED` (a tombstone), because dropping an
  event from a feed leaves it in the subscriber's calendar forever.

## 8. Dates

- All-day: `VALUE=DATE`, exclusive `DTEND`, computed in UTC so the civil date
  cannot shift with the server's zone.
- Timed: the absolute instant, serialized in UTC. Verified across US/EU DST
  boundaries, a year boundary and a leap day.
- No `RRULE` is ever emitted; recurrence text in a title stays text.

## 9. URL construction

`safe-url.ts` rejects, by parse: `javascript:`, `JavaScript:`, `data:`, `file:`,
`blob:`, protocol-relative `//host`, plain `http:`, non-allowlisted hosts,
lookalikes (`polymarket.com.evil.test`), embedded credentials
(`https://polymarket.com@evil.test`), and any URL containing control characters
or spaces.

Google and Outlook links are built with `URLSearchParams` against hardcoded
hosts. Adversarial titles (`x&sf=true&output=xml`, `x&rru=delete`, `#`, `%`,
`=`, CRLF, emoji) were re-parsed with `new URL()`: the text stayed in a single
parameter value and created no new parameters.

`webcal://` targets are validated by **shape** — scheme in {http, https, webcal},
no credentials, path must begin `/api/calendar/`. A host allowlist would be
wrong here because feed URLs are composed from the request origin, which
legitimately varies (localhost, preview domains, production). What matters is
that a user-controlled value can never become a subscription target: `webcal://`
is a standing instruction to poll an address forever.

## 10. Scale

1000 events with 200-character titles: 530 ms, 780 KB, all present. Per-property
caps bound the worst case regardless of upstream input.
