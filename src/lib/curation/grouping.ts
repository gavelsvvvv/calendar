import { DERIVATIVE_SUFFIXES } from "@/config/market-exclusions";
import { toDayKey } from "../dates";
import type { GammaEvent } from "../polymarket/gamma-types";
import type { GroupingKind } from "./types";

/**
 * Grouping related Gamma events into one real-world event.
 *
 * Polymarket splits a single fixture across several *events*, not just several
 * markets: "CF Villarreal C vs. Levante UD", "… - Exact Score" and
 * "… - More Markets" are three separate ids. Politics does the same thing with
 * "Clacton by-election Winner", "… : 2nd place", "… : Turnout" and
 * "… : Margin of Victory".
 *
 * Keys are tried strongest-first:
 *   1. `gameId`        — shared by every event describing one fixture (~22%)
 *   2. `parentEventId` — set on sports derivatives, pointing at the canonical id
 *   3. `negRiskMarketID` — the legs of one neg-risk group
 *   4. normalized title core + day — the only thing that catches politics
 *
 * Series is deliberately *not* used: a series is the league ("clf-games"), so
 * grouping by it would collapse an entire competition into one calendar entry.
 */

export type EventGroup = {
  key: string;
  kind: GroupingKind;
  /** The event that best represents the group. */
  canonical: GammaEvent;
  members: GammaEvent[];
};

/**
 * Dashes must be surrounded by whitespace; colons need not be.
 *
 * A tight dash is part of a word — splitting on it turned
 * "Clacton by-election Winner" into "Clacton by".
 */
const SUFFIX_SEPARATOR = /\s+[-–—]\s+|\s*:\s+/;

/**
 * Strip a known derivative suffix from a title.
 *
 * Returns the core plus whether anything was removed — an event that needed no
 * stripping is a better candidate to represent the group than one that did.
 */
/**
 * A bracket qualifier appended to a derivative leg — "(Lower Farage brackets)",
 * "(Higher Strikes)". It narrows the leg, not the event, so it is dropped
 * before the suffix is matched. Without this, "Clacton by-election: Margin of
 * Victory (Lower Farage brackets)" failed to strip and sat on the calendar as
 * its own by-election, a day away from the real one.
 */
const TRAILING_QUALIFIER = /\s*\([^()]*\)\s*$/;

export function stripDerivativeSuffix(title: string): {
  core: string;
  suffix?: string;
} {
  const trimmed = title.trim();

  // Walk the separators from the right, removing recognised suffixes. Titles can
  // stack them ("… - More Markets"), and legitimate names contain dashes too, so
  // only known suffixes are ever removed.
  let core = trimmed;
  let removed: string | undefined;

  for (;;) {
    const parts = core.split(SUFFIX_SEPARATOR);
    if (parts.length < 2) break;

    const tail = parts[parts.length - 1]
      .trim()
      .replace(TRAILING_QUALIFIER, "")
      .toLowerCase();
    const match = DERIVATIVE_SUFFIXES.find(
      (s) => tail === s || tail.endsWith(` ${s}`),
    );
    if (!match) break;

    removed = parts[parts.length - 1].trim();
    core = parts.slice(0, -1).join(" - ").trim();
  }

  // Some titles end with the suffix but no separator ("… Winner", "… Second Place"),
  // optionally carrying a bracket qualifier of their own.
  for (;;) {
    const bare = core.replace(TRAILING_QUALIFIER, "");
    const lower = bare.toLowerCase();
    const match = DERIVATIVE_SUFFIXES.find((s) => lower.endsWith(` ${s}`));
    if (!match) break;
    removed = bare.slice(bare.length - match.length);
    core = bare.slice(0, bare.length - match.length - 1).trim();
  }

  return { core: core || trimmed, suffix: removed };
}

/** Lowercase, strip punctuation and collapse whitespace, for comparison only. */
export function normalizeTitleCore(title: string): string {
  return stripDerivativeSuffix(title)
    .core.toLowerCase()
    .replace(/[.,'"“”’]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function groupKeyFor(event: GammaEvent): { key: string; kind: GroupingKind } {
  if (event.gameId !== undefined && event.gameId !== null && event.gameId !== "") {
    return { key: `game:${event.gameId}`, kind: "game-id" };
  }

  if (
    event.parentEventId !== undefined &&
    event.parentEventId !== null &&
    event.parentEventId !== ""
  ) {
    return { key: `parent:${event.parentEventId}`, kind: "parent-event-id" };
  }

  // Title core plus month. The date matters — "Michigan Democratic Senate
  // Primary Winner" recurs across cycles and two different elections must never
  // merge — but siblings of one event routinely carry end dates a day or two
  // apart, so bucketing by exact day split the same primary in half. The month
  // is coarse enough to hold a family together and fine enough to keep separate
  // cycles apart; `mergeNearbyTitleGroups` then stitches month boundaries.
  const core = normalizeTitleCore(event.title ?? "");
  const month = event.endDate ? toDayKey(event.endDate).slice(0, 7) : "";
  if (core && month) return { key: `title:${core}|${month}`, kind: "title-core" };

  return { key: `id:${event.id ?? event.slug ?? Math.random()}`, kind: "single" };
}

/** Earliest end date in a group, as milliseconds. */
function groupTime(members: GammaEvent[]): number {
  const times = members
    .map((m) => (m.endDate ? Date.parse(m.endDate) : NaN))
    .filter((t) => Number.isFinite(t));
  return times.length > 0 ? Math.min(...times) : NaN;
}

/** How far apart two title-core groups may sit and still be the same event. */
const MERGE_WINDOW_DAYS = 4;

/**
 * Stitch together title-core groups that share a core but landed in different
 * month buckets — a primary closing on the 31st and its turnout market closing
 * on the 1st are one event, not two.
 */
function mergeNearbyTitleGroups(groups: EventGroup[]): EventGroup[] {
  const byCore = new Map<string, EventGroup[]>();
  const out: EventGroup[] = [];

  for (const group of groups) {
    if (!group.key.startsWith("title:")) {
      out.push(group);
      continue;
    }
    const core = group.key.slice("title:".length).split("|")[0];
    const list = byCore.get(core) ?? [];
    list.push(group);
    byCore.set(core, list);
  }

  for (const list of byCore.values()) {
    if (list.length === 1) {
      out.push(list[0]);
      continue;
    }
    const sorted = [...list].sort((a, b) => groupTime(a.members) - groupTime(b.members));
    let current = sorted[0];
    for (const next of sorted.slice(1)) {
      const gap = Math.abs(groupTime(next.members) - groupTime(current.members));
      if (Number.isFinite(gap) && gap <= MERGE_WINDOW_DAYS * 86_400_000) {
        const members = [...current.members, ...next.members];
        current = { ...current, members, canonical: pickCanonical(members) };
      } else {
        out.push(current);
        current = next;
      }
    }
    out.push(current);
  }

  return out;
}

/**
 * A group's canonical event: the one a user would name if asked what is
 * happening. Prefers an event with no derivative suffix, then the one other
 * members point at, then the biggest by volume.
 */
function pickCanonical(members: GammaEvent[]): GammaEvent {
  if (members.length === 1) return members[0];

  const referenced = new Set(
    members
      .map((m) => (m.parentEventId === undefined ? null : String(m.parentEventId)))
      .filter((v): v is string => Boolean(v)),
  );

  const scored = members.map((m) => {
    const { suffix } = stripDerivativeSuffix(m.title ?? "");
    let score = 0;
    if (!suffix) score += 100; // an undecorated title is the event itself
    if (referenced.has(String(m.id))) score += 80; // siblings point here
    score += Math.min(50, Math.log10(Math.max(1, m.volume ?? 0)) * 6);
    score += Math.min(10, (m.markets?.length ?? 0) * 0.2);
    return { event: m, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0].event;
}

/**
 * Fold raw Gamma events into groups.
 *
 * `parentEventId` is resolved transitively where the parent is present in the
 * same batch, so a derivative keyed by `parent:757862` lands in the same bucket
 * as the parent's own `game:72728824` key rather than forming its own group.
 */
export function groupEvents(events: GammaEvent[]): EventGroup[] {
  // First pass: give every event a provisional key.
  const provisional = new Map<string, { key: string; kind: GroupingKind }>();
  const byId = new Map<string, GammaEvent>();
  for (const event of events) {
    const id = String(event.id ?? "");
    if (id) byId.set(id, event);
    provisional.set(id, groupKeyFor(event));
  }

  // Second pass: a derivative whose parent is in this batch adopts the parent's
  // key, which merges the two buckets that would otherwise stay separate.
  const resolved = new Map<string, { key: string; kind: GroupingKind }>();
  for (const event of events) {
    const id = String(event.id ?? "");
    const own = provisional.get(id) ?? { key: `id:${id}`, kind: "single" as const };

    const parentId =
      event.parentEventId === undefined ? null : String(event.parentEventId);
    if (parentId && byId.has(parentId)) {
      const parentKey = provisional.get(parentId);
      if (parentKey) {
        resolved.set(id, { key: parentKey.key, kind: parentKey.kind });
        continue;
      }
    }
    resolved.set(id, own);
  }

  const buckets = new Map<string, { kind: GroupingKind; members: GammaEvent[] }>();
  for (const event of events) {
    const id = String(event.id ?? "");
    const { key, kind } = resolved.get(id) ?? { key: `id:${id}`, kind: "single" as const };
    const bucket = buckets.get(key) ?? { kind, members: [] };
    bucket.members.push(event);
    buckets.set(key, bucket);
  }

  const initial: EventGroup[] = [...buckets.entries()].map(([key, { kind, members }]) => ({
    key,
    kind,
    canonical: pickCanonical(members),
    members,
  }));

  return mergeNearbyTitleGroups(initial).map((g) => ({
    ...g,
    kind: g.members.length === 1 ? ("single" as GroupingKind) : g.kind,
  }));
}
