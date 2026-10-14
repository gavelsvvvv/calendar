import { cookies } from "next/headers";
import { Suspense } from "react";
import { CalendarShell } from "@/components/calendar-shell";
import { CalendarSkeleton } from "@/components/states/calendar-skeleton";
import { monthGridRange } from "@/lib/calendar-cache";
import {
  buildCuratedDataset,
  withoutRelatedMarkets,
  type CuratedDataset,
} from "@/lib/curation/dataset";
import { toPublicDataset, type PublicDataset } from "@/lib/api/public-event";
import { needsTargetedTier } from "@/lib/curation/filters";
import { toMonthKey } from "@/lib/dates";
import { FALLBACK_TIME_ZONE, isValidTimeZone, TIME_ZONE_COOKIE } from "@/lib/timezone";
import { parseCalendarUrlState } from "@/lib/url-state";

/**
 * The calendar is server-rendered with its first range already curated, so the
 * first paint is a populated grid. Curation runs here and only curated events
 * cross the wire — the raw Gamma book (8–14MB per page) never leaves the server.
 */

export const revalidate = 300;

export default async function Page({ searchParams }: PageProps<"/">) {
  const resolved = await searchParams;

  /*
   * The zone the browser told us about last time.
   *
   * The server cannot detect a timezone and must not guess one per request, so
   * it renders from what this browser reported on its previous visit. A
   * first-ever visit falls back to Polymarket's own zone and is corrected by
   * the client within a frame — without a hydration mismatch, because the store
   * behind `useTimeZone` hands React the server value during hydration and the
   * real one immediately after.
   */
  const remembered = (await cookies()).get(TIME_ZONE_COOKIE)?.value ?? "";
  const timeZone = isValidTimeZone(remembered) ? remembered : FALLBACK_TIME_ZONE;

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(resolved)) {
    if (typeof value === "string") params.set(key, value);
    else if (Array.isArray(value) && value.length > 0) params.set(key, value[0]);
  }

  const urlState = parseCalendarUrlState(params);
  /*
   * Always the month grid, whichever view was asked for.
   *
   * The client caches one entry per month and serves month, week and agenda
   * from it, so building a seven-day window here for `?view=week` would hand
   * the browser something it cannot file — and it would then fetch the grid
   * anyway. Building the grid also means a week link and a month link share one
   * server cache entry instead of competing for two.
   */
  const { start, end } = monthGridRange(toMonthKey(urlState.anchor));

  /*
   * The same projection the public API uses.
   *
   * This payload is serialized into the HTML, so anything left on it is
   * published just as surely as an API response — and it used to carry the whole
   * internal shape: per-event `importanceScore`, `sourceEventIds`, `groupedBy`,
   * `dateSource`, plus a `stats` block naming every exclusion rule and its hit
   * count. Routing the RSC handoff through `toPublicDataset` means the two
   * surfaces cannot drift: a field is either public on both or neither.
   */
  let dataset: PublicDataset;
  try {
    dataset = toPublicDataset(
      withoutRelatedMarkets(
        await buildCuratedDataset({
          start,
          end,
          includeSmallerMarkets: urlState.filters.includeSmallerMarkets,
          /*
           * Honour a sub-filter that arrived in the link.
           *
           * A shared `?categories=sports&sports=tennis` URL is the one case
           * where the server can know the reader wants the sub-filter tier, and
           * building it here is what makes that link correct on first paint
           * instead of showing an empty calendar for the moment it takes the
           * browser to notice and refetch. It costs a deep build only for
           * requests that carry the parameter — the default page never does.
           */
          includeTargeted: needsTargetedTier(urlState.filters),
        }),
      ),
    );
  } catch (error) {
    // Render the shell with an empty, clearly-labelled dataset rather than a
    // 500 — the client can retry without a full page load. The upstream
    // message is logged, never rendered: it can carry a URL or a timeout's
    // internals, and the reader needs none of it.
    if (process.env.NODE_ENV !== "production") console.error("[page]", error);
    dataset = {
      events: [],
      source: "cached",
      fetchedAt: new Date().toISOString(),
      error: "Could not reach Polymarket.",
    };
  }

  return (
    <Suspense fallback={<BootFallback />}>
      {/* The query string goes across as text: the client parses it once, with
          the same parser, so its first render matches this markup exactly — and
          then never reads the URL again. */}
      <CalendarShell
        /*
          Cast, and it is load-bearing rather than lazy.

          `dataset` is the projected public shape: the ten internal fields and
          the `stats` block are simply not on it at runtime. The client is still
          typed on `CuratedDataset` because retyping it would mean touching every
          component that names `CuratedCalendarEvent`, to hide fields none of
          them read — verified by grep, zero readers for all ten.

          The security property is therefore enforced by a test rather than by
          the type system: `verify:security` asserts that no forbidden field name
          appears in the rendered HTML or in an API response. That check does not
          care what the types claim, which is exactly why it is the right one.
        */
        initialDataset={dataset as unknown as CuratedDataset}
        initialQuery={params.toString()}
        initialTimeZone={timeZone}
      />
    </Suspense>
  );
}

/** Shown only while the calendar's client bundle resolves. */
function BootFallback() {
  return (
    <div className="p-3">
      <CalendarSkeleton view="month" />
    </div>
  );
}
