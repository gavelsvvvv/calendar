"use client";

import { ArrowRight } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { CategoriesMergeArt } from "./art/categories-merge";
import { HeroCalendarArt } from "./art/hero-calendar";
import { SubscribeLinksArt } from "./art/subscribe-links";

export type OnboardingDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: () => void;
  onOpenSubscribe: () => void;
};

/**
 * Three screens, and as few words as each can survive on.
 *
 * The illustration is the sentence; the text is the caption. Every line here
 * was cut until removing another word would have lost something — a visitor
 * should be able to read all three screens in the time it takes the first
 * animation to loop once.
 */
const STEPS = [
  {
    title: "The world's calendar",
    body: "Every event Polymarket is trading, laid out as the week you actually live in.",
    Art: HeroCalendarArt,
  },
  {
    title: "Only what matters",
    body: "Politics, sports, crypto, AI and more. Ranked by what's at stake, not by what's newest.",
    Art: CategoriesMergeArt,
  },
  {
    title: "Keep it wherever you are",
    body: "Subscribe once. It stays current in Google Calendar, Apple Calendar, Outlook, or any iCal app.",
    Art: SubscribeLinksArt,
  },
] as const;

/**
 * The progress indicator, which is also a control.
 *
 * A row of dots that only reports position is decoration; these are buttons, so
 * a visitor who wants the third screen can have it. The active one widens into
 * a bar rather than swapping colour — width is legible at a glance in a way
 * that a two-tone dot is not.
 */
function Progress({
  step,
  count,
  onSelect,
}: {
  step: number;
  count: number;
  onSelect: (index: number) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      {Array.from({ length: count }, (_, i) => (
        <button
          key={i}
          type="button"
          onClick={() => onSelect(i)}
          aria-label={`Step ${i + 1} of ${count}`}
          aria-current={i === step ? "step" : undefined}
          className="group flex h-8 items-center px-0.5"
        >
          <span
            className={cn(
              "block h-1.5 rounded-full",
              "transition-all motion-safe:duration-(--dur-slow) motion-safe:ease-(--ease-out)",
              i === step
                ? "w-6 bg-accent"
                : "w-1.5 bg-border-strong group-hover:bg-muted-foreground",
            )}
          />
        </button>
      ))}
    </div>
  );
}

/** Shared by every button here, so the press feels the same wherever you land. */
const PRESS =
  "transition-[transform,opacity,background-color,border-color] motion-safe:duration-(--dur-base) motion-safe:ease-(--ease-out) motion-safe:active:scale-[0.97]";

/** Three short steps, shown once. Never a marketing page. */
export function OnboardingDialog({
  open,
  onOpenChange,
  onComplete,
  onOpenSubscribe,
}: OnboardingDialogProps) {
  const [step, setStep] = React.useState(0);
  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;
  const ctaRef = React.useRef<HTMLButtonElement>(null);

  const finish = () => {
    onComplete();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : finish())}>
      <DialogContent
        className="max-w-[520px] overflow-hidden p-0"
        /*
         * Radix focuses the first tabbable child, which is now a progress dot —
         * so the dialog opened with a focus ring around a 6px pill nobody was
         * looking at. The action gets it instead.
         */
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          ctaRef.current?.focus();
        }}
      >
        {/*
          The illustration gets the top half of the dialog and a fixed height, so
          the panel never resizes under the cursor as the steps change. The wash
          is one soft bloom from the top edge — no border between it and the
          artwork, which is what keeps it feeling like a stage rather than a
          thumbnail.
        */}
        <div className="art-wash relative flex h-[210px] items-center justify-center overflow-hidden border-b border-border bg-surface-sunken sm:h-[296px]">
          <div
            key={step}
            className="h-full w-full motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-[0.97] motion-safe:duration-(--dur-slow) motion-safe:ease-(--ease-out)"
          >
            <current.Art />
          </div>
        </div>

        <div className="flex flex-col items-center px-7 pb-6 pt-7 text-center sm:px-9 sm:pb-7 sm:pt-8">
          {/*
            A floor under the copy, so the panel stops resizing between steps.
            Measured: the block is 83px when the subtitle takes two lines and
            106px when it takes three, and which one you get depends on the step
            *and* the width — at 375px it is step 2, at 390px step 3, at 430px
            never. The result was the Next button sliding 23px down the screen
            mid-onboarding, under a thumb that was already reaching for it.

            The `sm` floor is lower because above 520px the subtitle's own
            `max-w-[380px]` fixes its wrapping, so every step measures 87px
            there and a taller floor would only be dead space.
          */}
          <div
            key={step}
            className="min-h-[106px] sm:min-h-[87px] motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 motion-safe:duration-(--dur-slow) motion-safe:ease-(--ease-out)"
          >
            <DialogTitle className="text-[23px] font-semibold leading-[1.2] tracking-[-0.02em] text-foreground sm:text-[26px]">
              {current.title}
            </DialogTitle>
            <DialogDescription className="mx-auto mt-2.5 max-w-[380px] text-balance text-[14px] leading-relaxed text-muted-foreground">
              {current.body}
            </DialogDescription>
          </div>

          {/* One row: where you are on the left, where you're going on the
              right. The back button holds its space so the CTA doesn't jump
              sideways between step one and step two. */}
          <div className="mt-7 flex w-full items-center justify-between gap-3">
            <Progress step={step} count={STEPS.length} onSelect={setStep} />

            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                onClick={() => setStep((s) => s - 1)}
                className={cn("h-11 px-3.5", PRESS, step === 0 && "pointer-events-none opacity-0")}
                tabIndex={step === 0 ? -1 : undefined}
                aria-hidden={step === 0}
              >
                Back
              </Button>

              <Button
                ref={ctaRef}
                variant="default"
                onClick={isLast ? finish : () => setStep((s) => s + 1)}
                className={cn("h-11 gap-1.5 px-5 text-[14px]", PRESS)}
              >
                {isLast ? "Open the calendar" : "Next"}
                <ArrowRight className="size-4" aria-hidden />
              </Button>
            </div>
          </div>

          {/*
            Whose calendar this is, on the first screen a visitor ever sees.

            The onboarding hero draws Polymarket's mark and the wordmark
            "Polymarket Calendar" at full size, in a modal, before any of the app
            is visible. That is the single most brand-forward moment in the
            product, and until now it was also the one place that said nothing
            about who runs it.
          */}
          <p className="mt-4 text-center text-[11px] leading-relaxed text-subtle-foreground">
            An independent calendar built on public Polymarket data. Not
            affiliated with or endorsed by Polymarket.
          </p>

          <div className="mt-3 flex items-center gap-4 text-[12px] text-muted-foreground">
            <button
              type="button"
              onClick={finish}
              className={cn(
                "rounded transition-colors motion-safe:duration-(--dur-quick) hover:text-foreground",
              )}
            >
              Don&rsquo;t show again
            </button>
            {isLast && (
              <>
                <span aria-hidden className="size-0.5 rounded-full bg-border-strong" />
                <button
                  type="button"
                  onClick={() => {
                    finish();
                    onOpenSubscribe();
                  }}
                  className="rounded font-medium text-accent transition-colors motion-safe:duration-(--dur-quick) hover:underline"
                >
                  Subscribe now
                </button>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
