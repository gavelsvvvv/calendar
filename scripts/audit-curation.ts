/**
 * Runs the curation pipeline over live data and reports what it kept and threw
 * away — the check that the calendar now contains events, not markets.
 */
import { curateEvents } from "../src/lib/curation/curate";
import { fetchGammaPage } from "../src/lib/polymarket/client";
import type { GammaEvent } from "../src/lib/polymarket/gamma-types";

async function main() {
  const raw: GammaEvent[] = [];
  for (const offset of [0, 100, 200, 300, 400, 500, 600, 700]) {
    raw.push(
      ...(await fetchGammaPage({
        limit: 100, offset, closed: false,
        endDateMin: "2026-08-01T00:00:00Z", endDateMax: "2026-09-01T00:00:00Z",
      })),
    );
  }
  const { events, stats } = curateEvents(raw);
  console.log("STATS", JSON.stringify(stats, null, 2));

  console.log("\n=== NOISE CHECK (must all be 0) ===");
  const probes: Array<[string, RegExp]> = [
    ["highest/lowest temperature", /(highest|lowest|daily) temperature|temperature in/i],
    ["daily crypto thresholds", /\b(bitcoin|ethereum|solana)\b.*\b(above|below|up or down)\b/i],
    ["exact score", /exact score/i],
    ["more markets", /more markets/i],
    ["tweet counters", /# ?tweets?/i],
  ];
  for (const [label, re] of probes) {
    const hits = events.filter((e) => re.test(e.title));
    console.log(`  ${hits.length === 0 ? "OK  " : "BAD "} ${label.padEnd(28)} ${hits.length}`);
    for (const h of hits.slice(0, 3)) console.log(`        ${h.title.slice(0, 70)}`);
  }

  console.log("\n=== GROUPING ===");
  const grouped = events.filter((e) => e.sourceEventIds.length > 1);
  console.log(`  events built from >1 Gamma event: ${grouped.length}`);
  for (const g of grouped.slice(0, 6)) {
    console.log(`    [${g.groupedBy}] ${g.title.slice(0, 52)} — ${g.sourceEventIds.length} events, ${g.relatedMarketsCount} markets`);
  }

  console.log("\n=== CATEGORY MIX ===");
  const byCat = new Map<string, number>();
  for (const e of events) byCat.set(e.category, (byCat.get(e.category) ?? 0) + 1);
  for (const [c, n] of [...byCat].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${c.padEnd(14)} ${n}`);
  }

  console.log("\n=== IMPORTANCE MIX ===");
  const byLvl = new Map<string, number>();
  for (const e of events) byLvl.set(e.importanceLevel, (byLvl.get(e.importanceLevel) ?? 0) + 1);
  for (const [l, n] of byLvl) console.log(`    ${l.padEnd(10)} ${n}`);

  console.log("\n=== ALL-DAY vs TIMED ===");
  console.log(`    all-day: ${events.filter((e) => e.isAllDay).length}, timed: ${events.filter((e) => !e.isAllDay).length}`);

  // Why is each event on the day it is on? The whole point of `dateSource` is
  // that this question has an answer instead of a shrug.
  console.log("\n=== DATE SOURCE ===");
  const bySource = new Map<string, number>();
  for (const e of events) bySource.set(e.dateSource, (bySource.get(e.dateSource) ?? 0) + 1);
  for (const [s, n] of [...bySource.entries()].sort((a, b) => b[1] - a[1])) {
    const pct = Math.round((n / Math.max(1, events.length)) * 100);
    console.log(`    ${s.padEnd(20)} ${String(n).padStart(4)}  ${String(pct).padStart(3)}%`);
  }

  console.log("\n    per category:");
  const perCat = new Map<string, Map<string, number>>();
  for (const e of events) {
    const row = perCat.get(e.category) ?? new Map<string, number>();
    row.set(e.dateSource, (row.get(e.dateSource) ?? 0) + 1);
    perCat.set(e.category, row);
  }
  for (const [cat, row] of [...perCat.entries()].sort()) {
    const parts = [...row.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([s, n]) => `${s}:${n}`)
      .join(" ");
    console.log(`      ${cat.padEnd(12)} ${parts}`);
  }

  // The events whose date came from a real-world field rather than a trading
  // deadline — read a few and check they land where the title says they should.
  console.log("\n    sample: dates taken from a real-event field");
  const real = events.filter(
    (e) => e.dateSource === "gameStartTime" || e.dateSource === "eventDate",
  );
  console.log(`      ${real.length}/${events.length} events`);
  for (const e of real.slice(0, 10)) {
    console.log(
      `      ${e.displayDate} ${String(e.isAllDay ? "all-day" : e.time).padStart(7)} [${e.dateSource}] ${e.title.slice(0, 48)}`,
    );
  }

  const estimated = events.filter((e) => e.dateConfidence === "estimated");
  if (estimated.length > 0) {
    console.log(`\n    estimated dates: ${estimated.length}`);
    for (const e of estimated.slice(0, 6)) {
      console.log(`      ${e.displayDate} ${e.title.slice(0, 56)}`);
    }
  }

  console.log("\n=== TOP 20 CURATED EVENTS ===");
  for (const e of [...events].sort((a, b) => b.importanceScore - a.importanceScore).slice(0, 20)) {
    const t = e.isAllDay ? "all-day" : e.time;
    console.log(`  ${String(e.importanceScore).padStart(5)} ${e.importanceLevel.padEnd(9)} ${e.displayDate} ${String(t).padStart(7)} ${e.dateSource.padEnd(18)} ${e.category.padEnd(12)} $${Math.round(e.volume).toLocaleString().padStart(11)} ${String(e.relatedMarketsCount).padStart(3)}mk  ${e.title.slice(0, 40)}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
