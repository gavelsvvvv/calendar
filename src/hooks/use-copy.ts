"use client";

import * as React from "react";

/**
 * Copy to the clipboard, with a transient confirmation and a fallback.
 *
 * Shared by the subscribe dialog and the Google setup guide, which both offer a
 * "Copy calendar URL" button for the same URL — two copies of this drifted
 * apart once already, and the one in the guide is the one a reader is most
 * likely to press.
 *
 * The fallback matters more than it looks. `navigator.clipboard` is undefined on
 * an insecure origin and can reject outright when the document is not focused,
 * and in either case a button that silently does nothing is worse than no
 * button. Selecting the text lets the reader finish the job themselves.
 */
export function useCopy(resetAfterMs = 1500) {
  const [copied, setCopied] = React.useState(false);
  const timeout = React.useRef<number | null>(null);

  React.useEffect(
    () => () => {
      if (timeout.current !== null) window.clearTimeout(timeout.current);
    },
    [],
  );

  const copy = React.useCallback(
    async (value: string, fallback?: HTMLInputElement | null) => {
      try {
        if (!navigator.clipboard) throw new Error("clipboard unavailable");
        await navigator.clipboard.writeText(value);
        setCopied(true);
        if (timeout.current !== null) window.clearTimeout(timeout.current);
        timeout.current = window.setTimeout(() => setCopied(false), resetAfterMs);
      } catch {
        fallback?.select();
      }
    },
    [resetAfterMs],
  );

  return { copied, copy };
}
