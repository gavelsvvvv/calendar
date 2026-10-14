"use client";

import { ChevronDown, ExternalLink } from "lucide-react";
import * as React from "react";
import type { RelatedMarket } from "@/lib/curation/types";
import { formatCompactUsd, formatProbability } from "@/lib/format";
import { cn } from "@/lib/utils";

const VISIBLE_LIMIT = 12;

/**
 * The markets folded into this event, collapsed by default.
 *
 * A grouped election can carry fifty legs; showing them up front would bury the
 * one thing the panel is for.
 */
export function RelatedMarkets({
  markets,
  totalCount,
}: {
  markets: RelatedMarket[];
  totalCount: number;
}) {
  const [open, setOpen] = React.useState(false);
  const regionId = React.useId();

  if (markets.length === 0) return null;

  const visible = markets.slice(0, VISIBLE_LIMIT);
  const hidden = totalCount - visible.length;

  return (
    <div className="border-t border-border pt-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={regionId}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-11 w-full items-center gap-1.5 rounded-lg px-1 text-left text-[13px] font-medium text-foreground transition-colors motion-safe:duration-(--dur-quick) hover:bg-surface-hover active:bg-surface-hover sm:min-h-9"
      >
        <ChevronDown
          className={cn(
            "size-4 shrink-0 transition-transform motion-safe:duration-(--dur-base) motion-safe:ease-(--ease-out)",
            open && "rotate-180",
          )}
          aria-hidden
        />
        View related markets ({totalCount})
      </button>

      {open && (
        <ul
          id={regionId}
          className="mt-1 max-h-56 overflow-y-auto overscroll-contain scrollbar-slim motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-1 motion-safe:duration-(--dur-base) motion-safe:ease-(--ease-out)"
        >
          {visible.map((market) => (
            <li key={market.id}>
              <a
                href={market.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-h-11 items-center gap-2 rounded-lg px-1 transition-colors motion-safe:duration-(--dur-quick) hover:bg-surface-hover active:bg-surface-hover sm:min-h-0 sm:rounded sm:py-1.5"
              >
                <span className="min-w-0 flex-1 truncate text-[12px] text-foreground">
                  {market.title}
                </span>
                {market.probability != null && (
                  <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground">
                    {formatProbability(market.probability)}
                  </span>
                )}
                <span className="shrink-0 text-[11px] tabular-nums text-subtle-foreground">
                  {formatCompactUsd(market.volume)}
                </span>
                <ExternalLink className="size-3 shrink-0 text-subtle-foreground" aria-hidden />
              </a>
            </li>
          ))}
          {hidden > 0 && (
            <li className="px-1 py-1.5 text-[11px] text-muted-foreground">
              +{hidden} more on Polymarket
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
