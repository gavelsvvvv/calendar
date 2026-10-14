import { buildSingleEventIcs } from "@/lib/calendar-export/ics";
import { curateEvents } from "@/lib/curation/curate";
import { fetchGammaEventByKey } from "@/lib/polymarket/client";

/**
 * One event as a real `text/calendar` resource.
 *
 *   /api/calendar/event/0x1234.ics
 *
 * This route exists because of a platform fact rather than a preference: iOS
 * Safari will not hand a `blob:` or `data:` URL to the Calendar app. The old
 * "Apple Calendar (.ics)" button built the file in memory, pointed an anchor at
 * `URL.createObjectURL(...)` and clicked it — which downloads on a desktop and
 * does *nothing at all* on an iPhone. A URL that returns `text/calendar` over
 * HTTP is the only form iOS will open natively, so the file is served from
 * here and the button is an ordinary link to it.
 *
 * Being a plain URL has three other consequences worth having: the link works
 * with JavaScript disabled, it can be long-pressed and shared, and Android and
 * desktop browsers all handle it with their normal download path.
 */

export const revalidate = 900;

/*
 * Looked up by key, never by date range — and that took two wrong turns to
 * establish, both of them measured.
 *
 * The first attempt searched a wide window on the theory that a bigger net
 * catches more. It is the opposite: every ranged fetch is paged with a fixed
 * budget ordered by volume, so a wider range spreads the same pages thinner. A
 * thirteen-month window returned 404 for an event the calendar was displaying.
 *
 * The second attempt narrowed to the event's own month grid. That failed too,
 * for a subtler reason: an MLB fixture with `endDate` 2026-07-25 was absent
 * from the July window and present in August's. Membership of a ranged result
 * is decided by ranking, not only by dates, so *no* range reliably contains a
 * given low-volume event.
 *
 * Gamma filters `/events` by slug or id directly, which sidesteps ranking
 * entirely and costs one request instead of a dozen.
 */

function siteUrlFrom(request: Request): string {
  const url = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const host = forwardedHost ?? url.host;
  const proto = forwardedProto ?? url.protocol.replace(":", "");
  return `${proto}://${host}`;
}

/** Safe for a `filename=` parameter, and still recognisable in a Downloads list. */
function safeFilename(value: string): string {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return cleaned || "event";
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const eventId = decodeURIComponent(id).replace(/\.ics$/i, "");

  if (!eventId) {
    return new Response("Missing event id.", {
      status: 400,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  try {
    const raw = await fetchGammaEventByKey(eventId);

    /*
     * Run through the same curation the calendar uses, not a shortcut.
     *
     * The `.ics` has to carry the date the grid showed, and that date is the
     * output of the date ladder in `event-date.ts` — not any single Gamma
     * field. Building the entry from the raw payload instead would put a
     * different day in the reader's calendar than the one they clicked, which
     * is the exact class of bug this pipeline exists to prevent.
     *
     * No category or importance filtering: those belong to a subscription,
     * where the question is "which events should keep arriving". Here the
     * reader has already picked this one, so the only question is whether it
     * exists.
     */
    const event = raw ? curateEvents([raw]).events[0] : undefined;

    if (!event) {
      return new Response(
        "That event is no longer on the calendar. It may have resolved, or the link may be out of date.",
        {
          status: 404,
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "public, max-age=60",
          },
        },
      );
    }

    const ics = buildSingleEventIcs(event, { siteUrl: siteUrlFrom(request) });

    return new Response(ics, {
      status: 200,
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        /*
         * `attachment`, unlike the subscription feed's `inline`.
         *
         * The two are asking for different things. A feed is subscribed to and
         * polled, so it should render in place; this is a file the reader is
         * importing once, and `attachment` with a filename is what makes
         * desktop browsers save it under a name they will recognise and iOS
         * hand it to Calendar rather than draw it as text.
         */
        "Content-Disposition": `attachment; filename="${safeFilename(event.slug || event.title || eventId)}.ics"`,
        "Cache-Control": "public, max-age=900, s-maxage=900, stale-while-revalidate=3600",
      },
    });
  } catch (error) {
    return new Response(
      `Could not build that calendar entry: ${
        error instanceof Error ? error.message : "unknown error"
      }`,
      {
        status: 503,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
          "Retry-After": "120",
        },
      },
    );
  }
}
