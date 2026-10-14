/**
 * Which calendar the reader most likely uses — a guess, and only ever a guess.
 *
 * This decides *order*, never availability. Every destination stays on the
 * sheet whatever this returns, every one is a plain link or a plain button, and
 * a wrong answer costs a reader one extra glance rather than a broken button.
 * That is the whole reason it is safe to sniff at all: the brief's rule is that
 * user-agent strings must not carry core functionality, and here they carry
 * nothing but the sort key.
 *
 * The alternative — asking every reader to pick a platform we could have
 * guessed — is worse for the ~95% of them we would guess right.
 */

export type CalendarPlatform = "apple" | "android" | "other";

export type PlatformSignals = {
  userAgent?: string;
  /** `navigator.userAgentData.platform`, when the browser has it. */
  uaDataPlatform?: string;
};

/**
 * Pure, so it can be tested without a browser and called from either side.
 *
 * Returns `"other"` for anything unrecognised *and* for the server, where there
 * is no user agent to read. `"other"` is not a failure mode — it is the
 * neutral order, Google first, which is what the desktop web mostly wants.
 */
export function detectCalendarPlatform(signals: PlatformSignals = {}): CalendarPlatform {
  const { userAgent = "", uaDataPlatform = "" } = signals;

  const hint = uaDataPlatform.toLowerCase();
  if (hint === "android") return "android";
  if (hint === "ios") return "apple";
  // A Mac with a trackpad is not an Apple *calendar* phone case, but a Mac
  // reports "macos" here and still has Calendar.app, so it counts.
  if (hint === "macos") return "apple";

  if (/android/i.test(userAgent)) return "android";
  // A Mac is included deliberately, and iPadOS 13+ lands here rather than in
  // the line above because it impersonates desktop Safari. Both want the same
  // answer, so there is nothing to tell apart.
  if (/iphone|ipad|ipod|macintosh|mac os x/i.test(userAgent)) return "apple";

  return "other";
}

/** Reads the signals off the current browser. Safe to call during render. */
export function readPlatformSignals(): PlatformSignals {
  if (typeof navigator === "undefined") return {};
  const uaData = (navigator as Navigator & { userAgentData?: { platform?: string } })
    .userAgentData;
  return { userAgent: navigator.userAgent, uaDataPlatform: uaData?.platform };
}
