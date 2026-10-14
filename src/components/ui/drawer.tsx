"use client";

import * as React from "react";
import { Drawer as DrawerPrimitive } from "vaul";
import { cn } from "@/lib/utils";

/**
 * Bottom sheet for touch devices — filters, day details and market details all
 * arrive from the bottom on mobile rather than as centred modals, so they stay
 * within thumb reach and can be dismissed with a downward drag.
 */

export const Drawer = DrawerPrimitive.Root;
export const DrawerTrigger = DrawerPrimitive.Trigger;
export const DrawerClose = DrawerPrimitive.Close;
export const DrawerTitle = DrawerPrimitive.Title;
export const DrawerDescription = DrawerPrimitive.Description;

export function DrawerContent({
  className,
  children,
  /**
   * The drag handle only means something on a sheet that drags downwards. A
   * side panel that showed one would be advertising a gesture it doesn't have.
   */
  handle = true,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Content> & { handle?: boolean }) {
  return (
    <DrawerPrimitive.Portal>
      <DrawerPrimitive.Overlay className="fixed inset-0 z-50 bg-black/35 backdrop-blur-[1px] dark:bg-black/60" />
      <DrawerPrimitive.Content
        className={cn(
          "fixed inset-x-0 bottom-0 z-50 flex max-h-[88vh] flex-col rounded-t-2xl border-t border-border bg-surface outline-none",
          "shadow-[0_-8px_40px_-12px_rgb(0_0_0/0.25)]",
          className,
        )}
        {...props}
      >
        {handle && (
          <div className="mx-auto mt-2.5 h-1 w-9 shrink-0 rounded-full bg-border-strong" />
        )}
        {children}
      </DrawerPrimitive.Content>
    </DrawerPrimitive.Portal>
  );
}
