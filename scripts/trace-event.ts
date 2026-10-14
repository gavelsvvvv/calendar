import { addMonths, startOfMonth } from "date-fns";
import { getViewRange } from "../src/lib/calendar";
import { curateEvents } from "../src/lib/curation/curate";
import { findExclusionReason } from "../src/lib/curation/exclusions";
import { groupEvents } from "../src/lib/curation/grouping";
import { fetchEventsInRange, fetchGammaEventByKey } from "../src/lib/polymarket/client";
import type { GammaEvent } from "../src/lib/polymarket/gamma-types";

/**
 * Follow one event, by slug, through every stage of the pipeline.
 *
 *   npx tsx scripts/trace-event.ts <slug> [<slug> ...]
 *
 * The point is to answer "where does it disappear" with a stage name rather
 * than a theory. Each stage is run against the *real* record fetched from
 * Gamma, in the order `curateEvents` runs them, and the first one that drops
 * the event is reported.
 *
 * The range check is separate and deliberately last: an event can survive every
 * curation rule and still never reach the calendar because the ranked, paged
 * fetch for the visible window did not return it.
 */

function fmt(value: unknown): string {
  if (value === undefined) return "—";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

async function trace(slug: string) {
  console.log(`\n${"=".repeat(72)}\n${slug}\n${"=".repeat(72)}`);

  const raw = await fetchGammaEventByKey(slug);
  if (!raw) {
    console.log("  RAW GAMMA        : not found — Gamma does not know this slug");
    return;
  }

  const markets = raw.markets ?? [];
  const marketVolume = markets.reduce((sum, m) => sum + Number(m.volume ?? 0), 0);
  console.log("  RAW GAMMA        : found");
  console.log(`    id=${raw.id} active=${fmt(raw.active)} closed=${fmt(raw.closed)} restricted=${fmt((raw as unknown as Record<string, unknown>).restricted)}`);
  console.log(`    endDate=${fmt(raw.endDate)} eventDate=${fmt((raw as unknown as Record<string, unknown>).eventDate)} startTime=${fmt((raw as unknown as Record<string, unknown>).startTime)} gameStartTime=${fmt((raw as unknown as Record<string, unknown>).gameStartTime)}`);
  console.log(`    event volume=${fmt(raw.volume)}  sum(markets)=${Math.round(marketVolume)}  markets=${markets.length}`);
  console.log(`    sport=${fmt((raw as unknown as Record<string, unknown>).sport ? ((raw as unknown as { sport: { sport?: string } }).sport.sport ?? "yes") : undefined)} gameId=${fmt(raw.gameId)} teams=${markets.length ? fmt((raw.teams ?? []).map((t) => t.name)) : "—"}`);
  console.log(`    tags=${fmt((raw.tags ?? []).map((t) => t.slug))}`);

  // 1. Exclusions run before anything else in `curateEvents`.
  const reason = findExclusionReason(raw);
  console.log(`  EXCLUSIONS       : ${reason ? `DROPPED — ${reason}` : "kept"}`);
  if (reason) return;

  // 2. Grouping.
  const groups = groupEvents([raw]);
  console.log(`  GROUPING         : ${groups.length} group(s)`);

  // 3. The rest of the pipeline, in isolation: relevance floor, per-day caps,
  //    importance. Running it on one event tells us whether the event can pass
  //    the rules *at all*, independent of its competition for a day's slots.
  for (const smaller of [false, true]) {
    const result = curateEvents([raw], { includeSmallerMarkets: smaller });
    const kept = result.events[0];
    console.log(
      `  CURATE (smaller=${smaller ? "1" : "0"}): ${
        kept
          ? `kept — ${kept.displayDate} ${kept.time} (${kept.timeKind}, via ${kept.dateSource}) cat=${kept.category} vol=${Math.round(kept.volume)}`
          : `DROPPED — ${fmt(result.stats.excludedBy)}`
      }`,
    );
  }
}

/** Is the event in the ranked page set the calendar actually asks for? */
async function rangeCheck(slugs: string[]) {
  const anchor = startOfMonth(new Date());
  const { start, end } = getViewRange("month", anchor);
  console.log(`\n${"=".repeat(72)}\nFETCH WINDOW ${start.toISOString()} → ${end.toISOString()}\n${"=".repeat(72)}`);

  const raw: GammaEvent[] = await fetchEventsInRange({
    start: start.toISOString(),
    end: end.toISOString(),
  });
  const bySlug = new Set(raw.map((e) => e.slug));
  console.log(`  the window returned ${raw.length} raw events`);
  for (const slug of slugs) {
    console.log(`  ${slug}: ${bySlug.has(slug) ? "PRESENT in the fetch" : "ABSENT from the fetch"}`);
  }

  const curated = curateEvents(raw);
  const curatedSlugs = new Set(curated.events.map((e) => e.slug));
  console.log(`  curation kept ${curated.events.length} of ${raw.length}`);
  for (const slug of slugs) {
    console.log(`  ${slug}: ${curatedSlugs.has(slug) ? "PRESENT after curation" : "ABSENT after curation"}`);
  }
  console.log(`  excludedBy: ${JSON.stringify(curated.stats.excludedBy)}`);

  // How much esports survives overall, which is the coverage question behind
  // the two examples.
  const esportsRaw = raw.filter((e) =>
    (e.tags ?? []).some((t) => t.slug === "esports"),
  );
  const esportsKept = curated.events.filter((e) =>
    esportsRaw.some((r) => r.slug === e.slug),
  );
  console.log(`  esports in window: ${esportsRaw.length} raw -> ${esportsKept.length} curated`);
}

async function main() {
  const slugs = process.argv.slice(2);
  if (slugs.length === 0) {
    console.error("usage: npx tsx scripts/trace-event.ts <slug> [<slug> ...]");
    process.exit(1);
  }
  for (const slug of slugs) await trace(slug);
  await rangeCheck(slugs);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

void addMonths;
