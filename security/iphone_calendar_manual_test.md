# iPhone / Apple Calendar — manual test checklist

**This has not been run.** No real iOS device was available in the environment
that produced the rest of this hardening pass, so nothing below is a claim about
observed iPhone behaviour. Everything asserted about the `.ics` bytes was
verified locally and by independent parse; how iOS *renders* them was not.

Run this on a real iPhone and record the result in the right-hand column.

---

## What the app actually does on iOS (traced in code, not guessed)

| Step | Where |
| --- | --- |
| Tap **Add to calendar** on one event | `src/components/event/add-to-calendar-menu.tsx` |
| iOS is detected and offered the Apple path first | `src/lib/calendar-export/platform.ts` — user-agent sniffing that **only reorders** the menu; it changes no URL and no content |
| Single event downloads | `GET /api/calendar/event/<id>.ics`, `Content-Type: text/calendar`, `Content-Disposition: attachment` |
| Tap **Subscribe to this calendar** | `src/components/subscribe/subscribe-dialog.tsx` |
| Apple row opens a `webcal://` URL | `toWebcalUrl()` in `src/lib/calendar-export/google.ts` — scheme swap only, target validated to be our own `/api/calendar/…` path |
| iOS hands `webcal://` to Calendar, which polls it | Apple, not us. `REFRESH-INTERVAL:PT6H` is a hint. |

**No Apple credential is ever requested.** There is no Apple ID field, no iCloud
prompt, and no login screen anywhere in the app — there is no authentication at
all. The Google Calendar screenshots in onboarding are instructional images of
Google's own UI; they collect nothing and are not interactive.

---

## Checklist

| # | Step | Expected | Result |
| --- | --- | --- | --- |
| 1 | Open `https://calendarpolymarket.com` in Safari | Calendar loads. No login prompt, no app-store prompt, no redirect off-domain. | |
| 2 | Tap an event → **Add to calendar** → Apple | iOS offers to add one event. | |
| 3 | Tap **Subscribe to this calendar** → Apple | iOS shows the *Subscribe to Calendar* sheet with a `calendarpolymarket.com` URL. | |
| 4 | Read the event **title** | Matches the site. Text reads left-to-right normally — no reversed or hidden characters. | |
| 5 | Read the **date** | Matches the site's date. | |
| 6 | Read the **time** | Correct in *your* local timezone. An all-day event shows as all-day and on the right day, not the day before. | |
| 7 | Open the event **URL** | Goes to `polymarket.com`. Nowhere else. | |
| 8 | Read the **description** | Category, probability, volume, a Polymarket link, and the line *"Independent calendar built on public Polymarket data. Not affiliated with or endorsed by Polymarket."* No HTML markup. | |
| 9 | **Attachments** | None. The event shows no attachment row. | |
| 10 | **Alerts** | None. No alarm was added, and no notification fires. | |
| 11 | **Login** | At no point were you asked for an Apple ID, iCloud password, or any credential. | |
| 12 | **Redirects** | Nothing opened an unexpected domain or app. | |
| 13 | Pull to refresh the subscription | Completes without error. | |
| 14 | Find an event whose date changed upstream; refresh | The **existing** entry moves. No duplicate appears. | |
| 15 | Unsubscribe (Settings → Calendar → Accounts → the subscription → Delete) | Removes cleanly; its events disappear. | |
| 16 | Find a resolved or cancelled event; refresh | A cancelled event shows struck through or removed by iOS — not left as a misleading future event. | |

## If anything fails

Record the exact event title and what you saw. The generated `.ics` for any
event can be inspected directly:

```
curl -s "https://calendarpolymarket.com/api/calendar/event/<slug>.ics"
```

and re-checked against the regression suite with `npm run verify:calendar-security`.
