"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Centred modal, used for day details on desktop.
 * Radix handles focus trapping and Escape-to-close for us.
 */

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;
export const DialogTitle = DialogPrimitive.Title;
export const DialogDescription = DialogPrimitive.Description;

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      className={cn(
        "fixed inset-0 z-50 bg-black/25 backdrop-blur-[2px] dark:bg-black/55",
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
        "duration-(--dur-base) ease-(--ease-out)",
        className,
      )}
      {...props}
    />
  );
}

export function DialogContent({
  className,
  children,
  showClose = true,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & { showClose?: boolean }) {
  return (
    <DialogPrimitive.Portal>
      <DialogOverlay />
      <DialogPrimitive.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2",
          /*
           * A dialog may never be taller than the window it is centred in.
           *
           * Centring is what makes this bite: a panel 100px too tall loses
           * 50px off the *top*, which is exactly where the close button is.
           * The subscribe dialog is 771px of content and at 150% browser zoom
           * the viewport is 600px, so it was rendering at y = -85 with no way
           * to dismiss it but the Escape key.
           *
           * `dvh` rather than `vh` so mobile browser chrome sliding in and out
           * is accounted for, and `flex` + `min-h-0` so a panel that hits the
           * ceiling hands the overflow to whichever child scrolls rather than
           * clipping it. Every panel here already has one.
           */
          "flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden",
          "rounded-2xl border border-border bg-surface shadow-2xl shadow-black/10 outline-none dark:shadow-black/60",
          "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
          "duration-(--dur-base) ease-(--ease-out)",
          className,
        )}
        {...props}
      >
        {children}
        {showClose && (
          <DialogPrimitive.Close
            /*
             * 32px of visible button, 48px of target. The pseudo-element grows
             * the hit area for a finger without moving the box — headers below
             * are aligned to this button's centre, and nudging it would knock
             * their titles off-axis.
             */
            className={cn(
              "absolute right-3 top-3 flex size-8 items-center justify-center rounded-md text-muted-foreground",
              "transition-colors motion-safe:duration-(--dur-quick) hover:bg-surface-hover hover:text-foreground",
              "before:absolute before:-inset-2 before:content-['']",
            )}
            aria-label="Close"
          >
            <X className="size-4" />
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
