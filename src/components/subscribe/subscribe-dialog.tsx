"use client";

import { Check, Copy, Download, ExternalLink, Images } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { Checkbox, Input, Separator } from "@/components/ui/primitives";
import { useCalendarPlatform, useOrigin } from "@/hooks/use-browser-facts";
import { useCopy } from "@/hooks/use-copy";
import { useIsDesktop } from "@/hooks/use-media-query";
import {
  buildFeedUrl,
  feedSelectionFromFilters,
  type FeedSelection,
} from "@/lib/calendar-export/feed-url";
import { buildGoogleSubscribeUrl, toWebcalUrl } from "@/lib/calendar-export/google";
import { buildOutlookSubscribeUrl, OUTLOOK_ACCOUNTS } from "@/lib/calendar-export/outlook";
import { CATEGORIES } from "@/lib/categories";
import {
  ALL_CATEGORIES,
  ALL_ESPORTS,
  ALL_SPORTS,
  allCategoriesSelected,
  type CalendarFilters,
} from "@/lib/curation/filters";
import type { CalendarCategory, ImportanceLevel } from "@/lib/curation/types";
import { cn } from "@/lib/utils";
import { GoogleCalendarGuide } from "./google-guide";

export type SubscribeDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentFilters: CalendarFilters;
};

const SCOPES: Array<{ value: FeedSelection["scope"]; label: string }> = [
  { value: "all", label: "All events" },
  { value: "filters", label: "My current filters" },
  { value: "categories", label: "Choose categories" },
];

const IMPORTANCE: Array<{ value: ImportanceLevel | "all"; label: string }> = [
  { value: "all", label: "All" },
  { value: "important", label: "Important+" },
  { value: "major", label: "Major only" },
];

/**
 * Shared geometry for the two rows of choice pills, and for the action buttons.
 *
 * This panel is a bottom sheet on a phone, so every one of its controls is
 * something a thumb has to land on — the pills were 26px tall, which is a coin
 * flip. They grow to 40 below `sm` and stay compact for a pointer.
 */
const PILL =
  "inline-flex min-h-10 items-center rounded-md border text-[12px] transition-colors motion-safe:duration-(--dur-quick) sm:min-h-8";

const ACTION = "h-10 sm:h-8";

type ProviderId = "google" | "apple" | "outlook";

export function SubscribeDialog({ open, onOpenChange, currentFilters }: SubscribeDialogProps) {
  const isDesktop = useIsDesktop();

  const body = <SubscribeBody currentFilters={currentFilters} isDesktop={isDesktop} />;

  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent aria-describedby={undefined} className="max-w-lg overflow-hidden p-0">
          {body}
        </DialogContent>
      </Dialog>
    );
  }
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent aria-describedby={undefined}>{body}</DrawerContent>
    </Drawer>
  );
}

function SubscribeBody({
  currentFilters,
  isDesktop,
}: {
  currentFilters: CalendarFilters;
  isDesktop: boolean;
}) {
  /*
   * Opens on what is on screen, not on a default.
   *
   * A reader who has narrowed to Sports, Crypto and Economy and presses
   * Subscribe means those three; opening on "All events" would hand them a feed
   * of everything and rely on them noticing. The initializer reads the live
   * filter controller — the same object the sidebar checkboxes render from — so
   * there is no path by which a stale copy from `localStorage` or a
   * back-button URL could reach the generated feed.
   */
  const [selection, setSelection] = React.useState<FeedSelection>(() =>
    feedSelectionFromFilters(currentFilters),
  );

  // The origin is only known in the browser. Reading it through a store keeps
  // the server snapshot empty — so markup matches on hydration — without paying
  // an extra render.
  const origin = useOrigin();

  const feedUrl = origin ? buildFeedUrl(selection, origin) : "";
  const inputRef = React.useRef<HTMLInputElement>(null);
  const { copied, copy } = useCopy();

  /*
   * The platform guess, read after mount so the server and the first client
   * render produce the same markup. Until then the order is the neutral one.
   */
  const platform = useCalendarPlatform();

  /*
   * The guide is mounted only once it has been asked for.
   *
   * `dynamic()` fetches a chunk on *render*, not on open, so an unconditional
   * `<GoogleCalendarGuide open={false} />` would download the component and
   * start Next's image pipeline for every visitor who opened Subscribe. The
   * condition is what makes the split real.
   */
  const [guideOpen, setGuideOpen] = React.useState(false);
  /*
   * Once opened it stays mounted, so closing plays its exit animation instead
   * of vanishing. There is nothing left to save by then — the chunk and the
   * first screenshot are already downloaded.
   */
  const [guideSeen, setGuideSeen] = React.useState(false);
  const openGuide = React.useCallback(() => {
    setGuideSeen(true);
    setGuideOpen(true);
  }, []);

  const providers = useProviderBlocks({
    feedUrl,
    copied,
    copy,
    inputRef,
    isDesktop,
    onOpenGuide: openGuide,
  });
  const providerOrder: ProviderId[] =
    platform === "apple"
      ? ["apple", "google", "outlook"]
      : ["google", "apple", "outlook"];

  const chooseScope = (scope: FeedSelection["scope"]) => {
    if (scope === "filters") {
      setSelection(feedSelectionFromFilters(currentFilters));
      return;
    }
    /*
     * Only "match my filters" carries a Sport/eSport sub-selection.
     *
     * The other two scopes offer no control for it, so inheriting one would
     * mean a reader picking "Everything" silently subscribing to a tennis-only
     * sports section — a narrowing they cannot see in this dialog and would not
     * discover until their calendar looked wrong. Resetting is the honest
     * reading of both: "Everything" means everything, and hand-picked
     * categories means whole categories.
     */
    setSelection((s) => ({
      ...s,
      scope,
      categories: scope === "all" ? ALL_CATEGORIES : s.categories,
      sports: ALL_SPORTS,
      esports: ALL_ESPORTS,
    }));
  };

  const toggleCategory = (id: CalendarCategory) => {
    setSelection((s) => ({
      ...s,
      scope: "categories",
      // Hand-picking categories is a whole-category choice — see `chooseScope`.
      sports: ALL_SPORTS,
      esports: ALL_ESPORTS,
      categories: s.categories.includes(id)
        ? s.categories.filter((c) => c !== id)
        : [...s.categories, id],
    }));
  };

  const Title = isDesktop ? DialogTitle : DrawerTitle;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/*
        "Subscribe", not "Add to calendar".

        Those were the same four words as the button on a single event, for two
        genuinely different things: that one copies one event across once, this
        one sets up a feed that keeps arriving. Sharing a name is how a reader
        ends up with two hundred markets in their work calendar when they meant
        to save one Fed decision. The subtitle says which is which on every
        screen size, not only where there was room for a `DialogDescription`.
      */}
      <div className="shrink-0 border-b border-border px-5 py-4 pr-12">
        <Title className="text-[16px] font-semibold text-foreground">
          Subscribe to this calendar
        </Title>
        {isDesktop ? (
          <DialogDescription className="mt-0.5 text-[12px] text-muted-foreground">
            A feed that keeps itself up to date. To save a single event instead,
            use “Add to calendar” on the event.
          </DialogDescription>
        ) : (
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            A feed that keeps itself up to date. To save a single event instead,
            use “Add to calendar” on the event.
          </p>
        )}
      </div>

      <div
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain scrollbar-slim px-5 py-4"
        style={
          isDesktop ? undefined : { paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }
        }
      >
        {/* 1. What to include */}
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          What to include
        </h3>

        <div className="mt-2 flex flex-wrap gap-1" role="radiogroup" aria-label="Feed scope">
          {SCOPES.map((scope) => (
            <button
              key={scope.value}
              type="button"
              role="radio"
              aria-checked={selection.scope === scope.value}
              onClick={() => chooseScope(scope.value)}
              className={cn(
                PILL,
                "px-3 font-medium",
                selection.scope === scope.value
                  ? "border-accent bg-accent-soft text-foreground"
                  : "border-border text-muted-foreground hover:bg-surface-hover hover:text-foreground",
              )}
            >
              {scope.label}
            </button>
          ))}
        </div>

        {selection.scope === "filters" && (
          <p className="mt-2 text-[12px] text-muted-foreground">
            {allCategoriesSelected(currentFilters)
              ? "All categories"
              : currentFilters.categories.length === 0
                ? "No categories selected"
                : `${currentFilters.categories.length} categories`}
            {currentFilters.minImportance !== "all" && `, ${currentFilters.minImportance}+ only`}
            {currentFilters.includeSmallerMarkets && ", including smaller markets"}
            {/*
              A feed is a URL, and three of the filters on screen cannot be
              written into one: favourites live in this browser's storage, the
              weekend is a moving target, and a feed has no search box. Saying
              so is the difference between a subscription that quietly ignores
              them and one the reader knows the shape of — this pill now reads
              "My current filters", so the claim has to be qualified where it
              is not true.
            */}
            {(currentFilters.favoritesOnly ||
              currentFilters.weekendOnly ||
              currentFilters.search.trim()) && (
              <span className="mt-1 block text-subtle-foreground">
                {[
                  currentFilters.favoritesOnly && "favorites",
                  currentFilters.weekendOnly && "the weekend filter",
                  currentFilters.search.trim() && "your search",
                ]
                  .filter(Boolean)
                  .join(" and ")}{" "}
                {currentFilters.favoritesOnly && currentFilters.weekendOnly ? "are" : "is"} not
                carried into a subscription.
              </span>
            )}
          </p>
        )}

        {selection.scope === "categories" && (
          <div className="mt-2 grid grid-cols-2 gap-x-3">
            {CATEGORIES.map((category) => (
              <label
                key={category.id}
                className="flex min-h-11 cursor-pointer items-center gap-2 rounded px-1 transition-colors motion-safe:duration-(--dur-quick) hover:bg-surface-hover sm:min-h-9"
              >
                <Checkbox
                  checked={selection.categories.includes(category.id)}
                  onCheckedChange={() => toggleCategory(category.id)}
                  aria-label={category.label}
                />
                <span className={cn("size-2 shrink-0 rounded-full", category.dot)} aria-hidden />
                <span className="truncate text-[13px] text-foreground">{category.label}</span>
              </label>
            ))}
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-[12px] text-muted-foreground">Minimum importance</span>
          <div className="flex gap-1" role="radiogroup" aria-label="Minimum importance">
            {IMPORTANCE.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={selection.minImportance === option.value}
                onClick={() => setSelection((s) => ({ ...s, minImportance: option.value }))}
                className={cn(
                  PILL,
                  "px-2.5",
                  selection.minImportance === option.value
                    ? "border-accent bg-accent-soft text-foreground"
                    : "border-border text-muted-foreground hover:bg-surface-hover hover:text-foreground",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <label className="mt-2 flex min-h-11 cursor-pointer items-center gap-2 rounded px-1 transition-colors motion-safe:duration-(--dur-quick) hover:bg-surface-hover sm:min-h-9">
          <Checkbox
            checked={selection.includeSmallerMarkets}
            onCheckedChange={(v) =>
              setSelection((s) => ({ ...s, includeSmallerMarkets: v === true }))
            }
          />
          <span className="text-[13px] text-foreground">Include smaller markets</span>
        </label>

        <Separator className="my-4" />

        {/*
          2. Subscribe, in the order this reader is likely to need.

          The three provider blocks below are built as values and then rendered
          in `providerOrder`, because the reading order matters most exactly
          where there is least room. An iPhone was being led with the Google
          block — whose own copy says the thing cannot be finished on a phone —
          and had to scroll past it to reach `webcal://`, which on that device
          is a single tap that completes the job.

          The guess only ever reorders. All three blocks render on every
          platform, so being wrong costs a scroll, not a feature.
        */}
        {providerOrder.map((id, index) => (
          <React.Fragment key={id}>
            {index > 0 && <Separator className="my-4" />}
            {providers[id]}
          </React.Fragment>
        ))}

        <Separator className="my-4" />

        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Other apps
        </h3>
        <div className="mt-2 flex items-center gap-2">
          <Input
            ref={inputRef}
            readOnly
            value={feedUrl}
            aria-label="Calendar feed URL"
            onFocus={(e) => e.currentTarget.select()}
            className="h-10 min-w-0 flex-1 font-mono text-[11px] sm:h-9"
          />
          <Button
            variant="outline"
            size="icon"
            aria-label="Copy calendar URL"
            className="size-10 shrink-0 sm:size-9"
            onClick={() => copy(feedUrl, inputRef.current)}
          >
            {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
          </Button>
        </div>

        <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
          Calendar subscriptions update automatically, but refresh timing is
          controlled by your calendar provider.
        </p>
      </div>

      {guideSeen && (
        <GoogleCalendarGuide open={guideOpen} onOpenChange={setGuideOpen} feedUrl={feedUrl} />
      )}
    </div>
  );
}

/** The three provider blocks, so `SubscribeBody` can order them. */
function useProviderBlocks({
  feedUrl,
  copied,
  copy,
  inputRef,
  isDesktop,
  onOpenGuide,
}: {
  feedUrl: string;
  copied: boolean;
  copy: (value: string, fallback?: HTMLInputElement | null) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  isDesktop: boolean;
  onOpenGuide: () => void;
}): Record<ProviderId, React.ReactNode> {
  return {
    google: (
      <section data-subscribe-provider="google">
        {/*
          Google gets instructions rather than a button that looks like it
          finishes the job. There is no endpoint that adds an arbitrary feed to
          somebody's Google account — `addbyurl` opens the right screen and
          sometimes pre-fills it, and nothing more — so presenting it as
          "Subscribe" would be a button that appears to work and doesn't. Four
          numbered steps say exactly what will happen instead.
        */}
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Google Calendar
        </h3>
        <ol className="mt-2 space-y-1 text-[12px] leading-relaxed text-muted-foreground">
          <li>1. Copy the calendar URL.</li>
          <li>2. Open Google Calendar on a computer.</li>
          <li>
            3. Go to <span className="text-foreground">Other calendars → From URL</span>.
          </li>
          <li>4. Paste the URL and add it.</li>
        </ol>
        <div className="mt-2 flex flex-wrap gap-2">
          {/* The illustrated walkthrough leads, because the four lines above
              are a reminder for somebody who has done this before and the
              screenshots are for everybody who hasn't. Finding "Other
              calendars" in Google's sidebar is the step people actually get
              stuck on, and no amount of prose substitutes for a picture of it. */}
          <Button
            variant="outline"
            size="sm"
            onClick={onOpenGuide}
            data-action="open-google-guide"
            className={cn("gap-1.5", ACTION)}
          >
            <Images aria-hidden />
            Show me how
          </Button>
          <Button variant="ghost" size="sm" onClick={() => copy(feedUrl, inputRef.current)} className={cn("gap-1.5", ACTION)}>
            {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
            {copied ? "Copied" : "Copy calendar URL"}
          </Button>
          <Button asChild variant="ghost" size="sm" className={cn("gap-1.5", ACTION)}>
            <a href={buildGoogleSubscribeUrl(feedUrl)} target="_blank" rel="noopener noreferrer">
              Open Google Calendar
              <ExternalLink aria-hidden />
            </a>
          </Button>
        </div>
        {/* The Google Calendar apps have no "add by URL" screen at all — it is
            a web-only setting. Saying so here saves a reader hunting for a
            control that does not exist on their phone. */}
        <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
          {isDesktop
            ? "Google creates the subscription once you paste the URL; it isn’t added automatically."
            : "Adding a calendar by URL is only available in Google Calendar on the web — copy the URL here and finish on a computer."}
        </p>
      </section>
    ),

    apple: (
      <section data-subscribe-provider="apple">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Apple Calendar
        </h3>
        <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
          The one-tap option: <span className="text-foreground">webcal://</span> hands
          the feed straight to Calendar on iOS and macOS.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm" className={ACTION}>
            <a href={toWebcalUrl(feedUrl)} data-subscribe-action="apple-webcal">
              Subscribe in Apple Calendar
            </a>
          </Button>
          <Button asChild variant="ghost" size="sm" className={cn("gap-1.5", ACTION)}>
            <a href={feedUrl} download="polymarket-calendar.ics">
              <Download aria-hidden />
              Download .ics
            </a>
          </Button>
        </div>
        {/* The two buttons above look alike and do completely different things,
            which is worth one line: a download is today's events frozen, a
            subscription keeps itself current. Nothing in a downloaded file ever
            updates, and a reader who picks it expecting a live calendar finds
            out weeks later. */}
        <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
          Subscribing keeps the calendar up to date. The download is a one-off
          snapshot that never changes again.
        </p>
      </section>
    ),

    outlook: (
      <section data-subscribe-provider="outlook">
        {/*
          Two buttons, because Outlook is two products behind one name: a
          personal Microsoft account lives on outlook.live.com and a work or
          school account on outlook.office.com, and the wrong link does not
          fall back — it lands you on a sign-in page for an account you do not
          have. Guessing would be wrong half the time.
        */}
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Outlook
        </h3>
        <div className="mt-2 flex flex-wrap gap-2">
          {OUTLOOK_ACCOUNTS.map((account) => (
            <Button
              key={account.value}
              asChild
              variant={account.value === "personal" ? "outline" : "ghost"}
              size="sm"
              className={cn("gap-1.5", ACTION)}
            >
              <a
                href={buildOutlookSubscribeUrl(feedUrl, account.value)}
                target="_blank"
                rel="noopener noreferrer"
                title={account.hint}
              >
                {account.label}
                <ExternalLink aria-hidden />
              </a>
            </Button>
          ))}
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
          Opens Outlook&rsquo;s “Subscribe from web” screen. If it doesn&rsquo;t,
          paste the URL below there yourself, under Add calendar → Subscribe from
          web. Outlook refreshes subscribed calendars on its own schedule, up to
          once a day.
        </p>
      </section>
    ),
  };
}
