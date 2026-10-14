"use client";

import { ArrowLeft, ArrowRight, Check, Copy } from "lucide-react";
import Image from "next/image";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { useCopy } from "@/hooks/use-copy";
import { useIsDesktop } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";

/**
 * How to put the whole Polymarket Calendar into Google Calendar, in four steps.
 *
 * Not a help page. Google has no endpoint that adds an arbitrary feed to
 * somebody's account — `addbyurl` opens the right screen and sometimes pre-fills
 * it, and nothing more — so the honest product for this job is a guide that
 * walks the reader through Google's own UI. The screenshots are real captures of
 * that UI rather than illustrations, because the thing a reader is actually
 * doing is hunting for a specific control on a crowded screen, and a drawing of
 * approximately that control is no help at all.
 *
 * Distinct from "Add to calendar" on a single event, which copies one event
 * across once. This sets up a feed that keeps arriving.
 */

type Step = {
  /** Screenshot, already sized for the web — see `public/onboarding/google`. */
  image: string;
  /** Intrinsic dimensions, so the frame reserves its space before the file lands. */
  width: number;
  height: number;
  alt: string;
  title: string;
  body: React.ReactNode;
  /** Does this step need the real feed URL on a button? */
  copy?: boolean;
};

const STEPS: Step[] = [
  {
    image: "/onboarding/google/step-1.webp",
    width: 1600,
    height: 915,
    alt: "The Polymarket Calendar subscribe panel, with the Copy calendar URL button highlighted.",
    title: "Copy your calendar link",
    body: "Your current Polymarket Calendar filters are included automatically.",
    copy: true,
  },
  {
    image: "/onboarding/google/step-2.webp",
    width: 1600,
    height: 915,
    alt: "Google Calendar on the web, with the Other calendars menu open and From URL visible.",
    title: "Open Google Calendar",
    body: (
      <>
        On a computer, find <Term>Other calendars</Term> in the left sidebar and click{" "}
        <Term>+</Term>.
      </>
    ),
  },
  {
    image: "/onboarding/google/step-3.webp",
    width: 1600,
    height: 921,
    alt: "Google Calendar settings, From URL, with a Polymarket Calendar feed URL pasted in.",
    title: "Choose From URL",
    body: (
      <>
        Paste the copied link and click <Term>Add calendar</Term>.
      </>
    ),
    copy: true,
  },
  {
    image: "/onboarding/google/step-4.webp",
    width: 1600,
    height: 900,
    alt: "Google Calendar on an iPhone, with Polymarket Calendar ticked in the menu and its events showing in the month grid.",
    title: "Open Google Calendar on iPhone",
    body: "Sign in with the same Google account, open the menu and tick Polymarket Calendar.",
  },
];

/** A control the reader has to find by name in somebody else's UI. */
function Term({ children }: { children: React.ReactNode }) {
  return <span className="font-medium text-foreground">{children}</span>;
}

export type GoogleGuideProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The real feed URL for the filters currently on screen. Never a placeholder. */
  feedUrl: string;
};

export function GoogleCalendarGuide({ open, onOpenChange, feedUrl }: GoogleGuideProps) {
  const isDesktop = useIsDesktop();

  /*
   * Which step we are on lives inside `GuideBody`, not here, and that is what
   * makes reopening start at step one. Both shells mount their content only
   * while open, so the body is a fresh component each time — no effect, no
   * reset, nothing to keep in sync. Hoisting the state up here and clearing it
   * from an effect was the same behaviour with a cascading render attached.
   */
  const body = (
    <GuideBody onDone={() => onOpenChange(false)} feedUrl={feedUrl} isDesktop={isDesktop} />
  );

  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          aria-describedby={undefined}
          className="max-w-xl overflow-hidden p-0"
          data-guide="google"
        >
          {body}
        </DialogContent>
      </Dialog>
    );
  }
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent aria-describedby={undefined} data-guide="google">
        {body}
      </DrawerContent>
    </Drawer>
  );
}

function GuideBody({
  onDone,
  feedUrl,
  isDesktop,
}: {
  onDone: () => void;
  feedUrl: string;
  isDesktop: boolean;
}) {
  const [step, setStep] = React.useState(0);
  const { copied, copy } = useCopy();
  const current = STEPS[step];
  const last = step === STEPS.length - 1;
  const Title = isDesktop ? DialogTitle : DrawerTitle;

  return (
    /*
     * Three bands: a header, a body that may scroll, and a footer that never
     * does. On an iPhone 15 the whole sheet is about 600px of usable height and
     * the screenshot alone wants most of it, so pinning the controls outside the
     * scrollport is the only way "Continue" is reachable without scrolling —
     * which the brief asks for by name. `min-h-0` is what lets the middle band
     * give up height instead of pushing the footer off the bottom.
     */
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-border px-5 py-3.5 pr-12">
        <Title className="text-[16px] font-semibold text-foreground">
          Add to Google Calendar
        </Title>
        {isDesktop ? (
          <DialogDescription className="mt-0.5 text-[12px] text-muted-foreground">
            Subscribe to the whole calendar, so new events keep arriving.
          </DialogDescription>
        ) : (
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            Subscribe to the whole calendar, so new events keep arriving.
          </p>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain scrollbar-slim px-5 py-4">
        {/*
          A viewport-aware frame. The screenshots are 16:9 desktop captures and
          a phone is the opposite shape, so the height is capped in `vh` and the
          image is contained inside it rather than allowed to set the layout.
          The aspect ratio holds the space before the file arrives, so stepping
          forward doesn't shift the text under the reader's thumb.
        */}
        <div className="overflow-hidden rounded-lg border border-border bg-surface-sunken">
          <div className="relative mx-auto aspect-[16/9] max-h-[34vh] w-full sm:max-h-none">
            {STEPS.map((s, i) => (
              /*
                The current step and the next one, and nothing else.
                Rendering all four costs 206KB on open for three images nobody
                may reach; rendering only the current one means every Continue
                waits on a fetch and flashes an empty frame. One step of
                lookahead is the whole difference and costs one image.
              */
              i === step || i === step + 1 ? (
                <Image
                  key={s.image}
                  src={s.image}
                  alt={s.alt}
                  fill
                  sizes="(max-width: 640px) 92vw, 560px"
                  className={cn(
                    "object-contain transition-opacity motion-safe:duration-(--dur-base)",
                    i === step ? "opacity-100" : "pointer-events-none opacity-0",
                  )}
                  // The visible one is what the reader is waiting for; the
                  // lookahead is genuinely idle work.
                  priority={i === step && step === 0}
                  loading={i === step ? undefined : "lazy"}
                  data-guide-step-image={i + 1}
                />
              ) : null
            ))}
          </div>
        </div>

        <p className="mt-3.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Step {step + 1}
        </p>
        <h3 className="mt-0.5 text-[15px] font-semibold tracking-tight text-foreground">
          {current.title}
        </h3>
        <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{current.body}</p>

        {current.copy && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => copy(feedUrl)}
            disabled={!feedUrl}
            data-action="copy-feed-url"
            className="mt-3 h-10 gap-1.5 sm:h-9"
          >
            {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
            {copied ? "Copied ✓" : "Copy Calendar URL"}
          </Button>
        )}

        {last && (
          <p className="mt-3 rounded-md bg-surface-sunken px-3 py-2 text-[12px] leading-relaxed text-muted-foreground">
            Your events will sync automatically. Google controls refresh timing.
          </p>
        )}
      </div>

      <div
        className="flex shrink-0 items-center gap-2 border-t border-border px-5 py-3"
        style={
          isDesktop ? undefined : { paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }
        }
      >
        <span
          className="text-[12px] tabular-nums text-muted-foreground"
          data-guide-progress={`${step + 1}/${STEPS.length}`}
          aria-live="polite"
        >
          {step + 1} of {STEPS.length}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setStep(step - 1)}
            disabled={step === 0}
            data-action="guide-back"
            className="h-10 gap-1.5 sm:h-9"
          >
            <ArrowLeft aria-hidden />
            Back
          </Button>
          {last ? (
            <Button size="sm" onClick={onDone} data-action="guide-done" className="h-10 sm:h-9">
              Done
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={() => setStep(step + 1)}
              data-action="guide-continue"
              className="h-10 gap-1.5 sm:h-9"
            >
              Continue
              <ArrowRight aria-hidden />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
