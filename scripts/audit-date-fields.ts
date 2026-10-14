/**
 * What date fields does Gamma actually send, and where do they disagree?
 *
 * The calendar's whole job is putting an event on the day it happens, and every
 * candidate field is a guess until it has been counted against live data. This
 * walks a live window, tallies which date-bearing keys are present at event and
 * market level, and — the part that matters — measures how far each one sits
 * from `endDate`, which is the field it would be replacing.
 *
 *   npx tsx scripts/audit-date-fields.ts [weeks]
 *
 * Read the divergence table, not the coverage table: a field present on 90% of
 * events that never disagrees with `endDate` buys nothing.
 */
import { fetchEventsInRange } from "../src/lib/polymarket/client";
import { DISCOVERY_SLICES } from "../src/config/discovery";
import type { GammaMarket } from "../src/lib/polymarket/gamma-types";

const WEEKS = Number(process.argv[2] ?? 6);

/** Every key on the object whose name suggests a date, with its raw value. */
function dateishKeys(obj: Record<string, unknown>): Array<[string, unknown]> {
  return Object.entries(obj).filter(
    ([k, v]) =>
      /date|time/i.test(k) &&
      v !== null &&
      v !== undefined &&
      (typeof v === "string" || typeof v === "number") &&
      String(v).length > 0,
  );
}

/** Gamma writes `gameStartTime` as `2026-08-06 18:20:00+00` — not ISO-8601. */
function parseLoose(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const normalised = value
    .trim()
    .replace(" ", "T")
    .replace(/([+-]\d{2})$/, "$1:00");
  const ms = Date.parse(normalised);
  return Number.isFinite(ms) ? ms : null;
}

function pct(n: number, total: number): string {
  return total === 0 ? "  0%" : `${String(Math.round((n / total) * 100)).padStart(3)}%`;
}

function tally(label: string, counts: Map<string, number>, total: number) {
  console.log(`\n=== ${label} (n=${total}) ===`);
  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  for (const [key, n] of rows) {
    console.log(`  ${key.padEnd(24)} ${String(n).padStart(5)}  ${pct(n, total)}`);
  }
}

async function main() {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start.getTime() + WEEKS * 7 * 86_400_000);

  console.log(
    `window ${start.toISOString().slice(0, 10)} → ${end.toISOString().slice(0, 10)}`,
  );

  const events = await fetchEventsInRange({
    start: start.toISOString(),
    end: end.toISOString(),
    openPages: 4,
    closedPages: 2,
  });
  console.log(`fetched ${events.length} events`);

  const eventKeys = new Map<string, number>();
  const marketKeys = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);

  // Divergence: for each candidate field, how many events would it MOVE, and by
  // how much? Bucketed, because "differs by 3 minutes" and "differs by 7 days"
  // are completely different findings.
  type Div = { present: number; sameDay: number; buckets: Map<string, number>; maxDays: number };
  const divergence = new Map<string, Div>();
  const div = (k: string): Div => {
    let d = divergence.get(k);
    if (!d) {
      d = { present: 0, sameDay: 0, buckets: new Map(), maxDays: 0 };
      divergence.set(k, d);
    }
    return d;
  };

  const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const bucketOf = (days: number): string => {
    const a = Math.abs(days);
    if (a < 1) return "<1d";
    if (a < 2) return "1d";
    if (a < 4) return "2-3d";
    if (a < 8) return "4-7d";
    if (a < 31) return "8-30d";
    return "31d+";
  };

  const samples: Array<{ field: string; title: string; from: string; to: string }> = [];

  for (const event of events) {
    const evEnd = parseLoose(event.endDate);

    for (const [k] of dateishKeys(event as unknown as Record<string, unknown>)) {
      bump(eventKeys, k);
    }
    for (const market of event.markets ?? []) {
      for (const [k] of dateishKeys(market as unknown as Record<string, unknown>)) {
        bump(marketKeys, k);
      }
    }

    if (evEnd === null) continue;

    // Event-level candidates.
    const candidates: Array<[string, unknown]> = [
      ["event.startTime", event.startTime],
      ["event.startDate", event.startDate],
    ];
    // Market-level candidates: take the first market that carries each.
    const markets: GammaMarket[] = event.markets ?? [];
    const firstWith = (pick: (m: GammaMarket) => unknown): unknown => {
      for (const m of markets) {
        const v = pick(m);
        if (v !== undefined && v !== null && String(v).length > 0) return v;
      }
      return undefined;
    };
    candidates.push(["market.gameStartTime", firstWith((m) => m.gameStartTime)]);
    candidates.push(["market.startDateIso", firstWith((m) => m.startDateIso)]);
    candidates.push(["market.endDateIso", firstWith((m) => m.endDateIso)]);

    for (const [field, raw] of candidates) {
      const ms = parseLoose(raw);
      if (ms === null) continue;
      const d = div(field);
      d.present += 1;
      const days = (ms - evEnd) / 86_400_000;
      if (dayKey(ms) === dayKey(evEnd)) {
        d.sameDay += 1;
      } else {
        bump(d.buckets, bucketOf(days));
        d.maxDays = Math.max(d.maxDays, Math.abs(days));
        if (samples.length < 400) {
          samples.push({
            field,
            title: (event.title ?? "").slice(0, 52),
            from: dayKey(evEnd),
            to: dayKey(ms),
          });
        }
      }
    }
  }

  tally("date-ish keys on GammaEvent", eventKeys, events.length);
  const marketCount = events.reduce((n, e) => n + (e.markets?.length ?? 0), 0);
  tally("date-ish keys on GammaMarket", marketKeys, marketCount);

  console.log(`\n=== divergence from event.endDate (n=${events.length}) ===`);
  console.log(
    `  ${"field".padEnd(22)} ${"present".padStart(7)} ${"moves".padStart(6)}  buckets`,
  );
  for (const [field, d] of [...divergence.entries()].sort(
    (a, b) => b[1].present - a[1].present,
  )) {
    const moves = d.present - d.sameDay;
    const buckets = [...d.buckets.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([b, n]) => `${b}:${n}`)
      .join(" ");
    console.log(
      `  ${field.padEnd(22)} ${String(d.present).padStart(7)} ${String(moves).padStart(6)}  ${buckets || "—"}`,
    );
  }

  // Which categories would move, by tag. The point of the pass is that this is
  // not only sports.
  console.log(`\n=== events a non-endDate field would move, by tag ===`);
  const sliceSlugs = new Set(DISCOVERY_SLICES.map((s) => s.slug));
  const byTag = new Map<string, { moved: number; total: number }>();
  for (const event of events) {
    const evEnd = parseLoose(event.endDate);
    if (evEnd === null) continue;
    const tags = (event.tags ?? [])
      .map((t) => t.slug ?? "")
      .filter((s) => sliceSlugs.has(s));
    const better =
      parseLoose(
        (event.markets ?? []).find((m) => m.gameStartTime)?.gameStartTime,
      ) ?? parseLoose(event.startTime);
    const moved = better !== null && dayKey(better) !== dayKey(evEnd);
    for (const tag of tags.length ? tags : ["(untagged)"]) {
      const row = byTag.get(tag) ?? { moved: 0, total: 0 };
      row.total += 1;
      if (moved) row.moved += 1;
      byTag.set(tag, row);
    }
  }
  for (const [tag, row] of [...byTag.entries()].sort((a, b) => b[1].moved - a[1].moved)) {
    console.log(
      `  ${tag.padEnd(18)} ${String(row.moved).padStart(4)}/${String(row.total).padEnd(5)} ${pct(row.moved, row.total)}`,
    );
  }

  console.log(`\n=== sample moves ===`);
  const seen = new Set<string>();
  for (const s of samples) {
    if (seen.has(s.field) && seen.size > 0 && [...seen].filter((f) => f === s.field).length > 6)
      continue;
    seen.add(s.field);
  }
  for (const field of new Set(samples.map((s) => s.field))) {
    console.log(`\n  -- ${field}`);
    for (const s of samples.filter((x) => x.field === field).slice(0, 8)) {
      console.log(`     ${s.from} → ${s.to}  ${s.title}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
