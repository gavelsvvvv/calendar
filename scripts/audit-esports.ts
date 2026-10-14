import { startOfMonth } from "date-fns";
import { getViewRange } from "../src/lib/calendar";
import { isEsports } from "../src/lib/categories";
import { curateEvents } from "../src/lib/curation/curate";
import { fetchEventsInRange } from "../src/lib/polymarket/client";
import type { CurationVerdict } from "../src/lib/curation/types";
import type { GammaEvent } from "../src/lib/polymarket/gamma-types";

/**
 * How much of Polymarket's esports book reaches the calendar, and why the rest
 * does not.
 *
 *   npx tsx scripts/audit-esports.ts [YYYY-MM]
 *
 * Written for the coverage question behind two missing CS2 matches: the raw
 * count against the curated count is the headline, and the per-reason breakdown
 * is what tells you whether the gap is a rule working as intended or a rule
 * nobody meant to apply to esports.
 */

function esportsOf(event: GammaEvent): boolean {
  return isEsports({
    tagSlugs: (event.tags ?? []).map((t) => t.slug ?? ""),
    sportCode: event.sport?.sport,
  });
}

/** Which game, for the per-title breakdown. */
function gameOf(event: GammaEvent): string {
  const code = event.sport?.sport?.toLowerCase();
  if (code) return code;
  const known = ["counter-strike-2", "league-of-legends", "dota", "valorant", "csgo"];
  const tag = (event.tags ?? []).find((t) => known.includes((t.slug ?? "").toLowerCase()));
  return tag?.slug ?? "other";
}

async function main() {
  const month = process.argv[2];
  const anchor = month ? new Date(`${month}-01T00:00:00Z`) : startOfMonth(new Date());
  const { start, end } = getViewRange("month", anchor);

  console.log(`window ${start.toISOString().slice(0, 10)} → ${end.toISOString().slice(0, 10)}\n`);

  const raw = await fetchEventsInRange({ start: start.toISOString(), end: end.toISOString() });
  const rawEsports = raw.filter(esportsOf);

  const diagnostics: CurationVerdict[] = [];
  const result = curateEvents(raw, { diagnostics });

  const bySlug = new Map(diagnostics.map((v) => [v.slug, v]));
  const included = new Set(result.events.map((e) => e.slug));

  console.log(`raw events in window        : ${raw.length}`);
  console.log(`  of which esports          : ${rawEsports.length}`);
  console.log(`curated events              : ${result.events.length}`);
  console.log(
    `  of which esports          : ${result.events.filter((e) => e.category === "esports").length}\n`,
  );

  // Per game.
  const games = new Map<string, { raw: number; kept: number }>();
  for (const event of rawEsports) {
    const game = gameOf(event);
    const row = games.get(game) ?? { raw: 0, kept: 0 };
    row.raw += 1;
    if (included.has(event.slug ?? "")) row.kept += 1;
    games.set(game, row);
  }
  console.log("by game");
  for (const [game, row] of [...games].sort((a, b) => b[1].raw - a[1].raw)) {
    console.log(`  ${game.padEnd(20)} ${String(row.raw).padStart(4)} raw → ${row.kept} curated`);
  }

  // Why the rest went.
  const reasons = new Map<string, number>();
  const examples = new Map<string, string[]>();
  for (const event of rawEsports) {
    const slug = event.slug ?? "";
    if (included.has(slug)) continue;
    const verdict = bySlug.get(slug);
    const reason = verdict?.reason ?? "unknown";
    // `grouped-into:` is one reason with many values; collapse for the tally.
    const key = reason.startsWith("grouped-into:") ? "grouped-into" : reason;
    reasons.set(key, (reasons.get(key) ?? 0) + 1);
    const list = examples.get(key) ?? [];
    if (list.length < 3) list.push(slug);
    examples.set(key, list);
  }
  console.log("\nexcluded esports, by reason");
  for (const [reason, count] of [...reasons].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${reason.padEnd(26)} ${String(count).padStart(4)}   e.g. ${(examples.get(reason) ?? []).join(", ")}`);
  }

  // The named examples, if they are in this window.
  const watched = ["cs2-fal2-ast10-2026-08-13", "cs2-lgc-faze-2026-08-13"];
  const present = watched.filter((slug) => raw.some((e) => e.slug === slug));
  if (present.length > 0) {
    console.log("\nwatched slugs");
    for (const slug of present) {
      const verdict = bySlug.get(slug);
      console.log(
        `  ${slug}: ${
          included.has(slug)
            ? `INCLUDED on ${verdict?.displayDate} (${Math.round(verdict?.volume ?? 0)})`
            : `excluded — ${verdict?.reason ?? "unknown"}`
        }`,
      );
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
