"use client";

import { MARK_PATH, MARK_STROKE, MARK_VIEW_BOX } from "@/lib/polymarket-mark";
import { cn } from "@/lib/utils";

/**
 * Polymarket's own mark, beside the name — and, in the app bar, the way home.
 *
 * The geometry is the traced mark from `lib/polymarket-mark`, shared with the
 * onboarding hero so the corner of the app cannot introduce the product with a
 * different logo from the one the product just showed you. `currentColor` on
 * the stroke: the mark is monochrome and inherits its surface's foreground,
 * which is what keeps it legible in both themes without a second asset.
 *
 * **No `title` attribute.** It used to carry
 * "Polymarket Calendar — powered by Polymarket, built by gavelsv", which the
 * browser rendered as a native tooltip on every hover of the top-left corner —
 * an unstyled yellow box, after an uncontrollable delay, saying something the
 * footer already says. Attribution belongs in the footer and the help dialog,
 * both of which carry it. The accessible name comes from the button's own text
 * (and an `sr-only` copy of it at widths where the wordmark is hidden), so
 * nothing was lost by removing it.
 */
export function Brand({
  className,
  /**
   * Keep the wordmark at every width. The bar hides it below `sm` because it
   * is competing with the month title there; a panel that has nothing else in
   * its header wants the name.
   */
  alwaysShowName = false,
  /**
   * The breakpoint the wordmark appears at, when it is not always on.
   *
   * The app bar asks for `lg` — the name is 120px, and below that width it was
   * being paid for by the month title, which is the one thing the header exists
   * to say. Everywhere else `sm` is right.
   */
  nameFrom = "sm",
  /**
   * Makes the whole lockup a Home control.
   *
   * Given, the mark and the wordmark become one button; omitted, they stay
   * inert text — the sidebar drawer's header wants a heading, not a second way
   * to do what its own controls already do.
   */
  onHome,
}: {
  className?: string;
  alwaysShowName?: boolean;
  nameFrom?: "sm" | "lg";
  onHome?: () => void;
}) {
  const nameVisibility =
    nameFrom === "lg" ? "hidden lg:inline" : "hidden sm:inline";
  const srVisibility = nameFrom === "lg" ? "sr-only lg:hidden" : "sr-only sm:hidden";

  const content = (
    <>
      <svg
        viewBox={MARK_VIEW_BOX}
        // The mark is taller than it is wide, so it is sized by height and left
        // to find its own width rather than being squeezed into a square.
        className={cn(
          "h-[20px] w-auto shrink-0",
          onHome &&
            "transition-opacity motion-safe:duration-(--dur-quick) motion-safe:ease-(--ease-out) group-hover:opacity-90",
        )}
        fill="none"
        aria-hidden
        focusable="false"
      >
        <path
          d={MARK_PATH}
          stroke="currentColor"
          strokeWidth={MARK_STROKE}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
      <span
        className={cn(
          "whitespace-nowrap text-[15px] font-semibold tracking-tight",
          !alwaysShowName && nameVisibility,
        )}
      >
        Polymarket Calendar
      </span>
      {!alwaysShowName && <span className={srVisibility}>Polymarket Calendar</span>}
    </>
  );

  if (!onHome) {
    return (
      <span
        className={cn("inline-flex shrink-0 items-center gap-2 text-foreground", className)}
      >
        {content}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={onHome}
      data-brand="home"
      /*
       * The accessible name says what it *does*, because "Polymarket Calendar"
       * alone announces a heading rather than a control. Screen readers read
       * this instead of the visible text; sighted readers get no tooltip at
       * all, which is the point.
       */
      aria-label="Polymarket Calendar — go to this month"
      className={cn(
        "group inline-flex shrink-0 items-center gap-2 rounded-md text-foreground",
        // Enough padding for the hover surface to read as a target without the
        // lockup turning into a button-shaped box. Pulled back by the same
        // amount so the mark stays optically where it was in the bar.
        "-mx-1.5 px-1.5 py-1",
        /*
         * A logo is not a button, so the resting state is exactly the text and
         * the mark, and every state below is one step: a barely-there surface,
         * a slightly firmer weight of colour, and a press that moves. No
         * shadow, no gradient, no glow, no ring at rest.
         */
        "transition-[background-color,color,transform] motion-safe:duration-(--dur-quick) motion-safe:ease-(--ease-out)",
        "hover:bg-surface-hover",
        "active:scale-[0.98] active:bg-surface-hover",
        // `:focus-visible` only — a mouse press should not leave an outline
        // behind, and the shared base rule already draws the focus treatment.
        "focus-visible:outline-2",
        className,
      )}
    >
      {content}
    </button>
  );
}
