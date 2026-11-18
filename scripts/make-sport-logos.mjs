import { mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

/**
 * Build the Sport / eSport picker's logos from the supplied artwork.
 *
 *   node scripts/make-sport-logos.mjs
 *
 * Reads `assets/{sport,esport}-logos/<id>.<ext>` — one file per taxonomy id,
 * in whatever format it arrived as — and writes `public/logos/sports/<id>.webp`
 * at a uniform 96×96.
 *
 * Committed rather than run once and forgotten, because the supplied set was a
 * mixed bag and the normalisation below is the whole reason the grid reads as
 * one set rather than nineteen screenshots:
 *
 *  - **Formats**: PNG, JPEG, WebP and AVIF, 281px to 3840px wide.
 *  - **Aspect**: square balls next to a 608×328 wordmark and a 1280×720 crop.
 *  - **Grounds**: some transparent, some with a baked white background, one
 *    (`cs2`) whose background *is* the artwork.
 *  - **Ink**: mostly colour, but four are a pure black silhouette and one
 *    (`rainbow-six`) is pure white — which is why they are drawn on a chip in
 *    the UI rather than straight onto the panel.
 *
 * Re-run it after replacing anything in `assets/`. The output is deterministic.
 */

const SIZE = 96;
/** Transparent margin inside the square, so nothing touches the chip's edge. */
const MARGIN = 5;

const GROUPS = [
  { dir: "assets/sport-logos", label: "sport" },
  { dir: "assets/esport-logos", label: "esport" },
];
const OUT = "public/logos/sports";

/**
 * Marks supplied as a white-ink negative, which have to be flipped.
 *
 * Every logo in the picker is drawn on a white chip, for reasons the UI's own
 * comment explains — four of the nineteen are a pure black silhouette and would
 * disappear on the dark theme's panel. Rainbow Six is the one that arrived the
 * other way round: a white "6" on transparent, which is invisible on exactly
 * that chip. Inverting the channels and keeping alpha yields the positive of a
 * monochrome mark, which is the version its own press kit ships for light
 * grounds; it is not a recolour of anything with a brand hue.
 */
const INVERT = new Set(["rainbow-six"]);

/**
 * The bounding box of everything that is not the backdrop.
 *
 * Lifted from `make-icons.mjs`, which had to solve the same problem for the
 * favicon: `sharp.trim()` only crops a flat border, and half of this artwork
 * arrives as ink floating on a white JPEG. Ink is anything the eye would call
 * part of the mark — never a transparent pixel, and on an opaque backdrop
 * whatever is coloured, dark, or brighter than the ground.
 */
function inkBounds(data, info) {
  const ch = info.channels;
  let minX = info.width;
  let minY = info.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * ch;
      const alpha = ch > 3 ? data[i + 3] : 255;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const sat = Math.max(r, g, b) - Math.min(r, g, b);
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (!(alpha > 16 && (sat > 20 || lum < 200 || lum > 250))) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < 0) throw new Error("found no ink");
  return { minX, minY, maxX, maxY };
}

/**
 * Punch out a baked-on background, flooding inward from the border.
 *
 * A flood fill rather than "every near-white pixel is transparent", and the
 * difference is the golf flag: its pin is white and *inside* the green, so a
 * colour test would put a hole in the middle of the mark. Only white connected
 * to the edge is the ground.
 *
 * Gated on all four corners agreeing and being near-white, which is what keeps
 * it away from `cs2` — whose corners are its own blue-and-orange key art, not a
 * backdrop, and which would otherwise be eaten from the outside in.
 */
function keyOutBackdrop(data, info) {
  const ch = info.channels;
  const { width: w, height: h } = info;
  const at = (x, y) => (y * w + x) * ch;
  const near = (i) => {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const sat = Math.max(r, g, b) - Math.min(r, g, b);
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return sat < 24 && lum > 232;
  };

  const corners = [at(0, 0), at(w - 1, 0), at(0, h - 1), at(w - 1, h - 1)];
  if (!corners.every(near)) return false;

  const seen = new Uint8Array(w * h);
  const stack = [];
  for (let x = 0; x < w; x++) {
    stack.push([x, 0], [x, h - 1]);
  }
  for (let y = 0; y < h; y++) {
    stack.push([0, y], [w - 1, y]);
  }

  while (stack.length) {
    const [x, y] = stack.pop();
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    const p = y * w + x;
    if (seen[p]) continue;
    const i = p * ch;
    if (!near(i)) continue;
    seen[p] = 1;
    data[i + 3] = 0;
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  return true;
}

mkdirSync(OUT, { recursive: true });

let total = 0;
for (const { dir, label } of GROUPS) {
  for (const file of readdirSync(dir).sort()) {
    const id = file.replace(/\.[^.]+$/, "");
    const src = join(dir, file);

    // Decoded once, with alpha guaranteed, so the two passes below can both
    // work on the same buffer.
    const { data, info } = await sharp(src)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const keyed = keyOutBackdrop(data, info);
    if (INVERT.has(id)) {
      for (let i = 0; i < data.length; i += 4) {
        data[i] = 255 - data[i];
        data[i + 1] = 255 - data[i + 1];
        data[i + 2] = 255 - data[i + 2];
      }
    }
    const ink = inkBounds(data, info);

    /*
     * A square around the ink, sized by its longer axis.
     *
     * Squaring here rather than letting `fit: contain` do it is what makes a
     * 608×328 wordmark and a round ball occupy the same visual mass in the
     * grid: both end up centred in a box of their own longest side, so the
     * wordmark gets the vertical air it needs instead of being scaled until
     * its width fits and its height vanishes.
     */
    const iw = ink.maxX - ink.minX + 1;
    const ih = ink.maxY - ink.minY + 1;
    const side = Math.max(iw, ih);
    const pad = (n) => Math.round((side - n) / 2);

    const squared = await sharp(data, { raw: { ...info, channels: 4 } })
      .extract({ left: ink.minX, top: ink.minY, width: iw, height: ih })
      .extend({
        top: pad(ih),
        bottom: side - ih - pad(ih),
        left: pad(iw),
        right: side - iw - pad(iw),
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      // Encoded, not raw: a raw-in/raw-out pipeline returns pixels with no
      // header, and the next `sharp()` cannot infer a format from those.
      .png()
      .toBuffer();

    const inner = SIZE - MARGIN * 2;
    await sharp(squared)
      .resize(inner, inner, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .extend({
        top: MARGIN,
        bottom: MARGIN,
        left: MARGIN,
        right: MARGIN,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      // Lossless: these are flat-colour marks with hard edges, where lossy
      // WebP costs more in fringing than it saves in bytes at this size.
      .webp({ lossless: true, effort: 6 })
      .toFile(join(OUT, `${id}.webp`));

    total++;
    console.log(
      `${label}/${id}`.padEnd(28) +
        `${info.width}×${info.height} → ink ${iw}×${ih}` +
        (keyed ? "  (backdrop keyed out)" : "") +
        (INVERT.has(id) ? "  (inverted)" : ""),
    );
  }
}

console.log(`\nwrote ${total} logos to ${OUT}/ at ${SIZE}²`);
