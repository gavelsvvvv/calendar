/**
 * Display formatting helpers.
 *
 * Calendar cells are narrow, so money is abbreviated aggressively; detail panels
 * get the fuller form.
 */

/** `$1.2M`, `$530K`, `$8.4B` — for chips and dense summaries. */
export function formatCompactUsd(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "$0";
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `$${trim(value / 1_000_000_000)}B`;
  if (abs >= 1_000_000) return `$${trim(value / 1_000_000)}M`;
  if (abs >= 1_000) return `$${trim(value / 1_000)}K`;
  return `$${Math.round(value)}`;
}

function trim(n: number): string {
  // One decimal below 10 ("$1.2M"), none above ("$530K").
  return n >= 10 ? String(Math.round(n)) : String(Math.round(n * 10) / 10);
}

/** `$1,234,567` — for detail panels where the exact figure matters. */
export function formatFullUsd(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

/** 0.4237 -> `42%`. Sub-1% probabilities keep a decimal so they don't read as 0. */
export function formatProbability(probability: number): string {
  const pct = probability * 100;
  if (pct > 0 && pct < 1) return "<1%";
  if (pct < 100 && pct > 99) return ">99%";
  return `${Math.round(pct)}%`;
}

/** Truncate on a word boundary where possible, for chip titles. */
export function truncateTitle(title: string, max: number): string {
  if (title.length <= max) return title;

  const slice = title.slice(0, max);
  // If the cut already lands cleanly between words, keep the whole slice —
  // stepping back to the previous space would throw away a complete word.
  const endsOnBoundary = /\s/.test(title[max] ?? "");

  let base = slice;
  if (!endsOnBoundary) {
    const lastSpace = slice.lastIndexOf(" ");
    if (lastSpace > max * 0.6) base = slice.slice(0, lastSpace);
  }

  return `${base.replace(/[\s,.;:—-]+$/, "")}…`;
}

const STATUS_LABELS: Record<string, string> = {
  active: "Trading",
  closed: "Closed",
  resolved: "Resolved",
};

export function formatStatus(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

/** "in 3 days" / "today" / "2 weeks ago" — relative to the market timezone day. */
export function formatRelativeDays(days: number): string {
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  if (days > 0) {
    if (days < 7) return `in ${days} days`;
    if (days < 30) return `in ${Math.round(days / 7)} weeks`;
    return `in ${Math.round(days / 30)} months`;
  }
  const ago = Math.abs(days);
  if (ago < 7) return `${ago} days ago`;
  if (ago < 30) return `${Math.round(ago / 7)} weeks ago`;
  return `${Math.round(ago / 30)} months ago`;
}
