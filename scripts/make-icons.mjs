import { writeFileSync } from "node:fs";
import sharp from "sharp";

/**
 * Build the browser icons from one source image.
 *
 *   node scripts/make-icons.mjs <source.png>
 *
 * Writes `src/app/icon.png`, `src/app/apple-icon.png` and `src/app/favicon.ico`
 * — Next's file conventions, which is why there is no `icons` entry in the
 * layout's metadata.
 *
 * Kept in the repo because swapping the logo has twice now run into the same
 * two traps, and neither is guessable:
 *
 *  1. The PNGs *inside* an ICO must be RGBA. `next build` decodes
 *     `app/favicon.ico` and fails the whole build with "The PNG is not in RGBA
 *     format!" if they are not — and a source photo saved without alpha
 *     produces exactly that. Hence `ensureAlpha`.
 *  2. Supplied art is usually a mock-up: the icon sits on a backdrop, off
 *     centre, with a drop shadow. `sharp.trim()` cannot crop that unless the
 *     border is a flat colour, so the ink bounds are measured instead.
 */

const SRC = process.argv[2];
if (!SRC) {
  console.error("usage: node scripts/make-icons.mjs <source.png>");
  process.exit(1);
}
const OUT = "src/app";

/** The bounding box of everything that is not the backdrop. */
async function inkBounds() {
  const { data, info } = await sharp(SRC).raw().toBuffer({ resolveWithObject: true });
  const ch = info.channels;
  let minX = info.width;
  let minY = info.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * ch;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const alpha = ch > 3 ? data[i + 3] : 255;
      const sat = Math.max(r, g, b) - Math.min(r, g, b);
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      /*
       * Ink is anything the eye would call part of the icon: transparent
       * pixels are never ink, and on an opaque backdrop it is whatever is
       * coloured, dark, or brighter than the ground — which catches a white
       * card and its tabs as well as an orange gradient.
       */
      const ink = alpha > 16 && (sat > 20 || lum < 200 || lum > 250);
      if (!ink) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < 0) throw new Error("found no ink in the source image");
  return { minX, minY, maxX, maxY };
}

const ink = await inkBounds();
const cx = Math.round((ink.minX + ink.maxX) / 2);
const cy = Math.round((ink.minY + ink.maxY) / 2);
/** A square around the ink, sized by its longer axis so nothing is cut off. */
const side = Math.max(ink.maxX - ink.minX + 1, ink.maxY - ink.minY + 1);
const meta = await sharp(SRC).metadata();

const square = await sharp(SRC)
  .extract({
    left: Math.max(0, Math.min(cx - Math.round(side / 2), meta.width - side)),
    top: Math.max(0, Math.min(cy - Math.round(side / 2), meta.height - side)),
    width: Math.min(side, meta.width),
    height: Math.min(side, meta.height),
  })
  .toBuffer();

async function at(size) {
  /*
   * A one-pixel transparent frame, and it is load-bearing rather than tidy.
   *
   * `next build` decodes `app/favicon.ico` and rejects it with "The PNG is not
   * in RGBA format!" unless every payload inside carries an alpha channel — and
   * sharp drops an alpha channel that is uniformly opaque, so `ensureAlpha()`
   * on opaque art is silently undone at encode time. Nudging a single pixel to
   * alpha 254 was kept at 16px and optimised away again at 32 and 48.
   *
   * A genuinely transparent border cannot be optimised away, because it is
   * information. The icon is rendered two pixels smaller and centred inside the
   * frame, so nothing is cropped to buy it.
   */
  const inner = await sharp(square)
    .resize(size - 2, size - 2, { fit: "cover" })
    .toBuffer();

  return sharp(inner)
    .ensureAlpha()
    .extend({
      top: 1,
      bottom: 1,
      left: 1,
      right: 1,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    // `effort: 10` rather than the default 4: gradient-heavy art encodes badly
    // at the default and this costs nothing at build time.
    .png({ compressionLevel: 9, effort: 10 })
    .toBuffer();
}

writeFileSync(`${OUT}/icon.png`, await at(512));
writeFileSync(`${OUT}/apple-icon.png`, await at(180));

/*
 * A real `/favicon.ico`: browsers request that path directly whatever the
 * markup says, and sharp cannot write ICO. PNG payloads inside an ICO are
 * accepted by everything since IE11 — a 6-byte ICONDIR, one 16-byte entry per
 * image, then the PNG bytes.
 */
const sizes = [16, 32, 48];
const pngs = await Promise.all(sizes.map(at));

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // 1 = icon
header.writeUInt16LE(pngs.length, 4);

let offset = 6 + 16 * pngs.length;
const entries = pngs.map((png, i) => {
  const e = Buffer.alloc(16);
  e.writeUInt8(sizes[i] >= 256 ? 0 : sizes[i], 0); // 0 means 256
  e.writeUInt8(sizes[i] >= 256 ? 0 : sizes[i], 1);
  e.writeUInt8(0, 2); // palette size
  e.writeUInt8(0, 3); // reserved
  e.writeUInt16LE(1, 4); // colour planes
  e.writeUInt16LE(32, 6); // bits per pixel
  e.writeUInt32LE(png.length, 8);
  e.writeUInt32LE(offset, 12);
  offset += png.length;
  return e;
});

writeFileSync(`${OUT}/favicon.ico`, Buffer.concat([header, ...entries, ...pngs]));

console.log(
  `ink ${ink.minX},${ink.minY}–${ink.maxX},${ink.maxY} → ${side}² crop at (${cx},${cy}); ` +
    `wrote icon.png, apple-icon.png, favicon.ico`,
);
