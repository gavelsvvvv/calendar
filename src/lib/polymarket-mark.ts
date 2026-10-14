/**
 * Polymarket's mark, as geometry.
 *
 * One traced path, shared by the app bar and by the onboarding illustration, so
 * the logo in the corner and the logo in the hero are the same object rather
 * than two drawings that happen to look alike.
 *
 * The path was fitted numerically against the supplied artwork — argmax of
 * intersection-over-union against its ink mask, 0.9322 — rather than eyeballed,
 * because a mark that is nearly right is worse than one that is obviously a
 * placeholder.
 */

export const MARK_PATH = "M362 110 L125 178 L362 255.5 L125 333 L362 401 Z M125 178 L125 333";

export const MARK_STROKE = 30;

/** Ink bounds of the *stroked* path — the vertices inset by half the stroke. */
export const MARK_BOX = { x: 110, y: 95, w: 267, h: 321 } as const;

/** How wide the mark is when drawn `size` tall. */
export function markWidth(size: number): number {
  return (size * MARK_BOX.w) / MARK_BOX.h;
}

/** A `viewBox` that crops to the ink, for drawing the mark on its own. */
export const MARK_VIEW_BOX = `${MARK_BOX.x} ${MARK_BOX.y} ${MARK_BOX.w} ${MARK_BOX.h}`;
