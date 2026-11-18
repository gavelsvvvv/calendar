"use client";

import { Check, SlidersHorizontal, X } from "lucide-react";
import * as React from "react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { OptionIcon, type PickerOption } from "./sport-icons";

/**
 * The second-level Sport / eSport picker.
 *
 * ## The shape this replaced
 *
 * The first version hung a summary line *underneath* the Sport and eSport rows.
 * It was honest about the selection and it was the wrong shape: two of the
 * eleven categories were half a row taller than the other nine, the rail grew
 * and shrank as you used it, and — the part that actually mattered — the panel
 * looked like it had sprouted extra filters. A category list where two entries
 * have children reads as a tree, and this is not a tree; it is eleven
 * calendars, two of which can be narrowed.
 *
 * So the second level moved off the list entirely. Sport is one row, eSport is
 * one row, and the narrowing lives behind a control at the right-hand end of
 * each — which also splits the two things the reader was previously asked to
 * express with one gesture:
 *
 *   - pressing the row  → show / hide the category
 *   - pressing the tune → choose which sports are in it
 *
 * They are genuinely independent. The picker opens, edits and closes without
 * ever touching `filters.categories`, which is what lets a reader set up
 * "Tennis and the NFL" while Sport is switched off and have it waiting for them
 * when they switch it back on.
 *
 * ## Centred, and why it stopped being anchored
 *
 * The picker used to be a popover pinned beside the row it came from, and on
 * paper that is the correct affordance: the panel points at the control that
 * opened it. In this rail it was the wrong one. A 372px panel hanging off a
 * 256px sidebar is a panel wedged into the left margin — the calendar it is
 * about is off to one side, the thing looks like a context menu, and the second
 * level ends up feeling like *more sidebar* rather than like a decision.
 *
 * It is now one centred surface at every width: the calendar recedes behind a
 * pale wash and the choice arrives in the middle of the screen. Nothing about
 * the reader's data moves — this is a frame swap and the filtering underneath
 * is untouched — but the gesture reads as "configure this" instead of "expand
 * that".
 *
 * ## One frame, two sizes
 *
 * There used to be two frames: a popover for pointers, a bottom sheet for
 * phones. Both are gone, and the phone gets the same centred panel — full-width
 * bar a 12px margin, but the same object.
 *
 * That is not merely tidier, it removes two live bugs. vaul writes
 * `document.body.style.pointerEvents = 'auto'` when *any* of its drawers
 * closes, outside Radix's own reference count, so dismissing the old sheet
 * un-locked the sidebar drawer still open behind it; and on iOS its
 * `position: fixed` scroll lock is module-global and unconditionally restored,
 * so the same dismissal dropped the sidebar's lock too. A Radix dialog nested
 * over the drawer touches neither: focus scopes, `aria-hidden` and scroll locks
 * all stack by reference count. `HelpDialog` already proves the arrangement —
 * it opens from inside that same drawer today.
 *
 * `touch` survives the merge, and it is worth being clear that it never named
 * the *frame*: it names finger-sized hit targets, and it still does.
 *
 * ## Why a grid of tiles rather than a list of checkboxes
 *
 * Because the reader is picking things they recognise by sight. Ten labelled
 * checkboxes is a form; ten drawn tiles is a shelf, and a shelf is scanned at
 * about the speed the eye moves.
 */

export type SubFilterProps = {
  /** "Sport" or "eSport" — the singular, as the category row says it. */
  title: string;
  /** The picker's own heading: "Sports" / "eSports". */
  heading: string;
  /** The all-selected wording: "All Sports" / "All Games". */
  allLabel: string;
  options: readonly PickerOption[];
  selected: readonly string[];
  /** How many events each option has in the loaded range. */
  counts: Readonly<Record<string, number>>;
  onChange: (next: string[]) => void;
  /**
   * Finger-sized hit targets.
   *
   * Deliberately not a frame selector — the frame is the same centred panel at
   * every width. This is the sizing switch, and it is a prop rather than a
   * breakpoint because it is set by which sidebar rendered the trigger: the
   * rail is a pointer surface at any window size, the drawer is a touch one.
   */
  touch?: boolean;
  /**
   * The parent category is unticked.
   *
   * Note what this is *not*: it is not `disabled`. The picker stays fully
   * operable while Sport is off — configuring a category you have not switched
   * on yet is a perfectly ordinary thing to do, and the selection is stored in
   * its own field precisely so that it survives the category being toggled. All
   * this does is put one line inside the picker saying the calendar will not
   * change yet, so the reader is not left wondering why nothing happened.
   */
  parentOff?: boolean;
};

/**
 * How many names the sidebar's inline summary carries before it becomes a count.
 *
 * One, and the number came off a ruler rather than an estimate. The summary
 * shares its line with the category name, the category count and the tune
 * button, and what the 256px rail actually leaves it — measured in the running
 * app at 1440, 1280 and 393 — is 59px on the Sport row and 52 on eSport, whose
 * name is a word longer. "Tennis" is 55. "Tennis · NFL" is 64, and at two names
 * the row rendered "Tennis · …", which is worse than a count: it looks broken
 * *and* it names nothing.
 *
 * Two earlier values were wrong in the same way, and both were arithmetic
 * rather than measurement. A long single name — "Rocket League" — still
 * ellipsises here, and that is the acceptable case: an elided name still names
 * the thing. The full list is never lost either way; it is on the button's
 * accessible name and tooltip, where there is no width to run out of.
 */
const MAX_NAMED = 1;

/** Ordered by the option list, so the text is stable whatever the click order. */
function names(
  selected: readonly string[],
  options: readonly PickerOption[],
): string[] {
  return options.filter((o) => selected.includes(o.id)).map((o) => o.pick);
}

/** The compact form: what fits on the sidebar row. */
function summarise(
  selected: readonly string[],
  options: readonly PickerOption[],
  allLabel: string,
): string {
  if (selected.length >= options.length) return allLabel;
  if (selected.length === 0) return "None";
  const picked = names(selected, options);
  /*
   * "2 of 10", not "2 selected". Shorter — 38px against 54 — which is what got
   * the eSports row inside its 52px budget, "eSports" being a longer word than
   * "Sports"; and it says the denominator, so "2 of 10" and "9 of 10" read as
   * the different things they are.
   */
  if (picked.length > MAX_NAMED) return `${picked.length} of ${options.length}`;
  return picked.join(" · ");
}

/**
 * The full form: what the button's accessible name and tooltip say.
 *
 * No width limit here, so nothing is abbreviated. This is the difference
 * between a screen-reader user hearing "Choose sports, 3 selected" — accurate
 * and useless — and hearing which three.
 */
function describe(
  selected: readonly string[],
  options: readonly PickerOption[],
  allLabel: string,
): string {
  if (selected.length >= options.length) return allLabel;
  if (selected.length === 0) return "None";
  return names(selected, options).join(", ");
}

/**
 * The one-line summary the *sidebar row* shows, or `null` for the default.
 *
 * Nothing is printed under "All Sports", which is the state every reader who
 * has never opened the picker is in. A sidebar that annotated the default would
 * be adding noise to describe the absence of a choice.
 */
export function inlineSummary(
  selected: readonly string[],
  options: readonly PickerOption[],
  allLabel: string,
): string | null {
  if (selected.length >= options.length) return null;
  return summarise(selected, options, allLabel);
}

/* ---------------------------------------------------------------- one tile */

function OptionTile({
  option,
  count,
  isSelected,
  touch,
  onToggle,
}: {
  option: PickerOption;
  count: number;
  isSelected: boolean;
  touch: boolean;
  onToggle: () => void;
}) {
  const events = `${count} event${count === 1 ? "" : "s"}`;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={isSelected}
      data-sub-filter-option={option.id}
      data-selected={isSelected ? "true" : "false"}
      /* The taxonomy's own name, where the tile shows the product one: the tile
         says NFL, the tooltip and the accessible name say American Football.
         Said once where the two agree — "Tennis, Tennis, 10 events" is a screen
         reader stuttering.

         A middle dot, not an em dash. An em dash between a name and a number
         reads as a sentence break, so "Counter-Strike 2 — 20 events" parses for
         a beat as prose about Counter-Strike rather than as a label and its
         value; "Counter-Strike 2 · 20 events" is unambiguously two fields. The
         count is `countsBySport` / `countsByEsport` from `buildCalendarIndex` —
         the events of this sport that the browser has loaded for the visible
         month, with the reader's search and importance filters applied but not
         the category boxes and not this picker's own selection. See
         `COUNT SEMANTICS` there; it is the same number the tile prints. */
      title={`${option.label} · ${events}`}
      aria-label={`${
        option.pick === option.label ? option.label : `${option.pick}, ${option.label}`
      }, ${events}`}
      onClick={onToggle}
      className={cn(
        "flex items-center gap-2.5 rounded-xl p-2 text-left",
        "transition-[background-color,box-shadow] motion-safe:duration-(--dur-quick)",
        /*
         * No `focus-visible:outline-*` here: `@layer base` already gives every
         * focusable element a 2px accent outline at 2px offset. Restating it
         * ten times is three classes that can only ever drift from the global.
         */
        touch ? "min-h-14" : "min-h-[52px]",
        isSelected
          ? "bg-(--glass-tile-on) shadow-[inset_0_0_0_1.5px_var(--glass-tile-on-edge)]"
          : "bg-(--glass-tile) shadow-[inset_0_0_0_1px_var(--glass-tile-edge)] hover:bg-(--glass-tile-hover)",
      )}
    >
      {/*
        The mark, and the tick sitting in its corner when picked.

        The tick used to be a fourth column, and on a centred panel that is the
        one thing the row cannot afford: at 393px each tile has about 110px of
        label lane and "Rocket League" needs 92 of it, so a 14px glyph plus its
        gap is the difference between a name and "Rocket Leagu…". Landing it on
        the chip costs nothing — the chip has a corner going spare — and it is
        *closer* to the thing it qualifies than a right-aligned tick ever was.

        `relative` on a wrapper rather than on the icon itself, because
        `OptionIcon` is `overflow-hidden` (it has to be: the marks are squared
        to its radius) and would clip its own badge.
      */}
      <span className="relative shrink-0">
        <OptionIcon
          option={option}
          className={cn(
            "size-8",
            /*
             * An empty sport recedes, but its text does not fade.
             *
             * Recede, never disappear: Polymarket's hockey book is empty in
             * August and busy in October, and removing the tile would make the
             * grid appear to change size for reasons the reader cannot see.
             * `grayscale` rather than opacity, because the mark sits on an
             * opaque chip and *any* opacity composites that chip toward the
             * panel — on dark the result is a grey square where the other nine
             * rows have a white one. A *picked* empty sport stays at full
             * strength: at that point the zero is the answer to a question the
             * reader asked.
             */
            count === 0 && !isSelected && "grayscale",
          )}
        />
        {isSelected && (
          <span
            /*
             * Six pixels clear of the chip, not four. At four the badge ate a
             * 12px square of a 32px mark and the corner of Rocket League's car
             * went with it; at six it overlaps by nine and reads as pinned to
             * the corner rather than dropped on top of it.
             */
            className="absolute -bottom-1.5 -right-1.5 flex size-4 items-center justify-center rounded-full bg-accent"
            aria-hidden
          >
            <Check className="size-2.5 text-accent-foreground" strokeWidth={3.5} />
          </span>
        )}
      </span>

      {/*
        Name over count, rather than name beside count.

        Stacking is what buys the label its width back — the count is no longer
        competing for the same line — and it also stops the number reading as
        part of the name. `min-w-0` on the column so `truncate` on the label has
        something to truncate against.
      */}
      <span className="flex min-w-0 flex-col">
        <span
          className={cn(
            "truncate",
            touch ? "text-[14px]" : "text-[13px]",
            isSelected ? "font-medium text-foreground" : "text-foreground",
            count === 0 && !isSelected && "text-muted-foreground",
          )}
        >
          {option.pick}
        </span>
        {/*
          The bare number is the innermost span, deliberately. It is what the
          reader compares tiles on, and `tabular-nums` is what keeps a column of
          them aligned; it also means a test can read the printed count without
          parsing the word off the end of it.
        */}
        <span className="truncate text-[11px] leading-[15px] text-muted-foreground">
          <span className="tabular-nums">{count}</span> event{count === 1 ? "" : "s"}
        </span>
      </span>
    </button>
  );
}

/* --------------------------------------------------------------- the panel */

function PickerBody({
  heading,
  allLabel,
  options,
  selected,
  counts,
  onChange,
  touch,
  parentOff,
}: {
  heading: string;
  allLabel: string;
  options: readonly PickerOption[];
  selected: readonly string[];
  counts: Readonly<Record<string, number>>;
  onChange: (next: string[]) => void;
  touch: boolean;
  parentOff: boolean;
}) {
  const allSelected = selected.length >= options.length;

  const toggle = (id: string) => {
    /*
     * Deselecting from "All" drops into an explicit subset of everything else,
     * and selecting the last missing one normalises back to All. Both fall out
     * of storing the plain list rather than a separate "all" flag — there is
     * one canonical state, and "all" is simply what a full list is called.
     */
    const next = selected.includes(id)
      ? selected.filter((s) => s !== id)
      : [...selected, id];
    // Emitted in option order so the value is canonical regardless of click order.
    onChange(options.filter((o) => next.includes(o.id)).map((o) => o.id));
  };

  return (
    <>
      {/*
        Header and All row are one fixed block; only the grid scrolls.

        The All row is the way out of any selection, and a short phone — the
        553px case `globals.css` already carries a variant for — is exactly
        where a reader who has over-picked wants it. Inside the scroller it is
        the first thing to leave the screen.
      */}
      <div className={cn("shrink-0", touch ? "px-3 pt-3.5" : "px-4 pt-4")}>
        <div className="flex items-start justify-between gap-3">
          <DialogTitle
            className={cn(
              "font-semibold tracking-[-0.01em] text-foreground",
              touch ? "text-[17px]" : "text-[16px]",
            )}
          >
            {heading}
          </DialogTitle>
          {/*
            Our own close, not the primitive's.

            Two reasons. The stock button hovers to `--surface-hover`, an opaque
            token, which paints a solid square in the middle of the glass; and
            on a phone this dialog sits over the sidebar drawer, whose own
            dismiss is already called "Close" — two buttons with one accessible
            name, one of which closes the thing behind the other.
          */}
          <DialogClose
            data-sub-filter-close
            aria-label={`Close ${heading.toLowerCase()} picker`}
            className={cn(
              "relative -mr-1 -mt-0.5 flex shrink-0 items-center justify-center rounded-lg text-muted-foreground",
              "transition-colors motion-safe:duration-(--dur-quick) hover:bg-foreground/[0.06] hover:text-foreground",
              "before:absolute before:-inset-2 before:content-['']",
              touch ? "size-8" : "size-7",
            )}
          >
            <X className={touch ? "size-[18px]" : "size-4"} aria-hidden />
          </DialogClose>
        </div>

        <label
          data-sub-filter-all
          className={cn(
            "mt-3 flex cursor-pointer items-center gap-3 rounded-xl px-3",
            "transition-[background-color,box-shadow] motion-safe:duration-(--dur-quick)",
            touch ? "min-h-12" : "min-h-11",
            allSelected
              ? "bg-(--glass-tile-on) shadow-[inset_0_0_0_1.5px_var(--glass-tile-on-edge)]"
              : "bg-(--glass-tile) shadow-[inset_0_0_0_1px_var(--glass-tile-edge)] hover:bg-(--glass-tile-hover)",
          )}
        >
          <Checkbox
            className={touch ? "size-[22px] rounded-md" : undefined}
            checked={allSelected}
            /*
             * Ticking All selects everything; unticking it clears to nothing.
             * Clearing rather than "restoring the previous subset" because the
             * reader has one obvious way to express "no sports" and this is it —
             * and because a hidden remembered subset reappearing on a second
             * click is the kind of state nobody predicts.
             */
            onCheckedChange={(checked) => onChange(checked ? options.map((o) => o.id) : [])}
            aria-label={allLabel}
          />
          <span
            className={cn(
              "flex-1 font-medium text-foreground",
              touch ? "text-[15px]" : "text-[14px]",
            )}
          >
            {allLabel}
          </span>
          {/*
            A plain span, never a second checkbox. The count says which of the
            two "not all" states you are in — 9 of 10 and 1 of 10 look identical
            from the row behind — and it stays inert so the row keeps exactly
            one control in it.
          */}
          <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground">
            {selected.length} of {options.length}
          </span>
        </label>

        <div className="mt-3.5 h-px bg-(--glass-panel-edge)" />
      </div>

      {/*
        Two columns, three once the panel is wide enough to hold them.

        `min-[600px]` is the *viewport*, and the panel follows it: below 620 the
        panel is `100vw - 1.5rem`, so at 600 it is 576 wide, which after 32px of
        padding and two 8px gaps leaves 174px a tile — 32 of chip, 10 of gap, 16
        of padding and 116 of label lane against the 92 that "Rocket League"
        needs. The phone case is the tight one and it still clears: 393 gives
        345 of content, 168 a tile, 110 of lane.

        The scroller is here rather than on the dialog, because `DialogContent`
        is `overflow-hidden` and provides none — every panel it hosts brings its
        own.
      */}
      <div
        role="group"
        aria-label={heading}
        className={cn(
          "grid min-h-0 flex-1 grid-cols-2 gap-2 overflow-y-auto scrollbar-slim min-[600px]:grid-cols-3",
          touch ? "px-3 py-3" : "px-4 py-3.5",
        )}
      >
        {options.map((option) => (
          <OptionTile
            key={option.id}
            option={option}
            count={counts[option.id] ?? 0}
            isSelected={selected.includes(option.id)}
            touch={touch}
            onToggle={() => toggle(option.id)}
          />
        ))}
      </div>

      {(parentOff || touch) && (
        <div
          className={cn(
            "flex shrink-0 items-center gap-3 border-t border-(--glass-panel-edge)",
            touch ? "px-3 py-2.5" : "px-4 py-2.5",
            /*
             * With nothing but Done in it, the whole strip goes when Done does.
             * Otherwise a 768px tablet — `touch` is true there, it is holding
             * the drawer — would render an empty bordered bar under the grid.
             */
            !parentOff && "sm:hidden",
          )}
        >
          {parentOff && (
            <p
              data-sub-filter-parent-off
              /*
               * `--muted-foreground`, not `--subtle-foreground`. The subtle tier
               * is ~3.8:1 on an opaque surface and worse on a translucent one,
               * and this line is the explanation for why the calendar did not
               * move — the one sentence in the panel that must be readable.
               */
              className="min-w-0 flex-1 text-[11px] leading-snug text-muted-foreground"
            >
              {heading} is switched off. This selection is saved for when you turn it
              back on.
            </p>
          )}
          {/*
            Done on touch, and it is not an inconsistency with the pointer case.

            Changes apply immediately in both — this closes the panel, it commits
            nothing — but a phone has no Escape key and no click-outside that is
            distinguishable from a mis-tap, so without it the only exits are a
            7mm X and the system back gesture. The gesture is the dangerous one:
            filters are written with `history.replaceState`, so there is no
            history entry for it to consume and it leaves the site.

            `sm:hidden` as well as the `touch` prop, so a 768px tablet holding
            the drawer never renders a Done button inside a desktop-shaped panel.
          */}
          {touch && (
            <DialogClose
              className="ml-auto h-10 shrink-0 rounded-xl bg-(--glass-tile-on) px-5 text-[14px] font-medium text-accent shadow-[inset_0_0_0_1.5px_var(--glass-tile-on-edge)] transition-opacity active:opacity-80 sm:hidden"
            >
              Done
            </DialogClose>
          )}
        </div>
      )}
    </>
  );
}

/* -------------------------------------------------------------- the control */

export function SubFilter({
  title,
  heading,
  allLabel,
  options,
  selected,
  counts,
  onChange,
  touch = false,
  parentOff = false,
}: SubFilterProps) {
  const [open, setOpen] = React.useState(false);
  const summary = summarise(selected, options, allLabel);
  const spoken = describe(selected, options, allLabel);
  const narrowed = selected.length < options.length;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {/*
        A real `DialogTrigger`, and it is load-bearing rather than stylistic.

        `DialogContentModal`'s `onCloseAutoFocus` calls `preventDefault()` and
        then focuses `context.triggerRef` — so with a bare `<button>` driving
        `open` itself that ref is null, the `preventDefault` cancels FocusScope's
        own restore, and closing the panel drops focus on `<body>`. The previous
        frame hit exactly this and fixed it the same way.

        And it is a *sibling* of the category label, never inside it, so a press
        here can never fall through to the checkbox that shows or hides the
        category. Opening the picker changes no filter state at all.
      */}
      <DialogTrigger asChild>
        <button
          type="button"
          data-sub-filter={title.toLowerCase()}
          data-sub-filter-summary={summary}
          data-sub-filter-narrowed={narrowed ? "true" : "false"}
          /*
           * The accessible name says both halves: what the button does, and what
           * the current selection is — in full, where the row beside it has to
           * abbreviate past one name. A screen reader arriving here hears the
           * category checkbox, then "Choose sports · Tennis, NFL", which is more
           * than the sighted reader gets from the row and exactly what the
           * tooltip shows on hover.
           *
           * The same middle dot as the tiles, for the same reason: what follows
           * it is a value, not the second half of a sentence.
           */
          aria-label={`Choose ${heading.toLowerCase()} · ${spoken}`}
          title={`Choose ${heading.toLowerCase()} · ${spoken}`}
          className={cn(
            "relative flex shrink-0 items-center justify-center rounded-md transition-colors motion-safe:duration-(--dur-quick)",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
            /*
             * 36px of button in the drawer, grown to 44 by a pseudo-element so
             * the finger target clears the iOS floor without the box itself
             * pushing the row taller than the other nine.
             */
            touch ? "size-9 before:absolute before:-inset-1 before:content-['']" : "size-6",
            narrowed
              ? "bg-accent-soft text-accent hover:bg-accent hover:text-accent-foreground"
              : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
          )}
        >
          <SlidersHorizontal className={touch ? "size-[18px]" : "size-3.5"} aria-hidden />
        </button>
      </DialogTrigger>

      <DialogContent
        data-testid="sub-filter-panel"
        /* No description: the grid is the explanation, and a sentence telling a
           reader that these are the sports would be the panel narrating itself. */
        aria-describedby={undefined}
        showClose={false}
        overlayClassName="glass-scrim bg-transparent backdrop-blur-none dark:bg-transparent"
        className={cn(
          "glass-panel",
          /*
           * 620px, inside the 520–680 the brief asks for, and the number is the
           * three-column grid: 620 less 32 of padding and 16 of gaps is 572,
           * 190 a tile, against the 148 the widest tile actually needs. Below
           * that it is the viewport less a 12px margin either side — 369 on an
           * iPhone 15, which is a panel that reads as floating rather than as a
           * sheet welded to the edges.
           */
          "w-[calc(100vw-1.5rem)] max-w-[620px] gap-0 rounded-2xl border-transparent bg-transparent p-0 shadow-none",
          /* The panel's own ceiling, tighter than the dialog's: a picker that
             reaches the top and bottom of the window has stopped being a
             floating object. */
          "max-h-[min(78dvh,620px)]",
        )}
      >
        <PickerBody
          heading={heading}
          allLabel={allLabel}
          options={options}
          selected={selected}
          counts={counts}
          onChange={onChange}
          touch={touch}
          parentOff={parentOff}
        />
      </DialogContent>
    </Dialog>
  );
}
