// One texture per shopfront: every colour the building uses and every word it
// says, in a single 512px image.
//
// This is the trick the first shopfronts used and the new template dropped.
// The plot spec allows four materials, and a building that spends them on four
// flat colours has none left for art — which is why the current template says
// "pure geometry, no textures, no text" and why its buildings cannot say their
// own name. Put the colours in a palette *inside* the art texture and the
// budget reads very differently: voxel, neon and art all sample this one image,
// glass takes the fourth slot, and the shop gets a lit fascia sign, a readable
// interior panel and a link plaque for nothing.
//
// Regions are pixel rects; `uv()` converts one to the 0..1 box a quad needs.
// Palette entries are single cells sampled at their centre, so a whole wall of
// boxes can point at one colour without any UV unwrapping.
import { Canvas, rgba, mix, wrapText, fitScale, textWidth, GLYPH } from './pixel-canvas.mjs';

export const ATLAS_SIZE = 512;

// x, y, w, h — top-left origin, matching the image. Each region's aspect ratio
// is the aspect of the quad that carries it, so type is never stretched: the
// geometry derives its dimensions from these numbers rather than the other way
// round (see SIGN_H and PANEL_H in template-shop.mjs).
export const REGIONS = {
  sign: [0, 0, 512, 84],        // 6.1:1 — a shop fascia
  panel: [0, 84, 320, 240],     // 4:3   — the card facing the door
  plate: [320, 84, 192, 101],   // 1.9:1 — an og:image's shape
  link: [320, 185, 192, 96],    // 2:1   — the plaque by the door
  logo: [0, 324, 160, 160],     // 1:1
};

const PAL_ORIGIN = [170, 330];
const PAL_CELL = 16;
const PAL_COLS = 20;

// The palette cells the geometry asks for by name. Values are filled per
// listing from the brand colours; the keys are the contract.
export const PALETTE_KEYS = [
  'wall', 'wall_dark', 'trim', 'floor', 'floor_walk', 'counter',
  'accent', 'accent_dim', 'secondary', 'glow', 'stock_a', 'stock_b', 'stock_c', 'white',
];

const hexOf = (c) => `#${c.slice(0, 3).map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('')}`;

/** Nudge a colour toward black (t < 0) or white (t > 0). */
const shade = (c, t) => (t < 0 ? mix(c, [0, 0, 0, 255], -t) : mix(c, [255, 255, 255, 255], t));

/** A readable ink colour for text sitting on `bg`. */
const inkFor = (bg) => ((0.2126 * bg[0] + 0.7152 * bg[1] + 0.0722 * bg[2]) / 255 > 0.55
  ? [12, 10, 20, 255] : [255, 252, 245, 255]);

/**
 * Build the shopfront's texture.
 *
 * `primary` is the building's body colour and `accent` its neon. Both come
 * from the listing when it sends them and from the category hue when it does
 * not, so a shop that tells us nothing still looks like it belongs on its road.
 */
export function buildAtlas({
  name = '', tagline = '', builder = '', host = '', category = '',
  primary = '#2a1e4a', accent = '#47f2ff', secondary = null, logoPixels = null,
} = {}) {
  const pri = rgba(primary);
  const acc = rgba(accent);
  const sec = secondary ? rgba(secondary) : mix(acc, [255, 255, 255, 255], 0.35);

  // Night lighting is unforgiving: a base colour that looks like a rich dark
  // blue in a swatch renders as pure black under one point light, and a room
  // of them reads as a void with panels floating in it. So the interior
  // surfaces sit well above the body colour, and only the trim goes truly
  // dark — the shop should look occupied from the pavement.
  const palette = {
    wall: shade(pri, 0.08),
    wall_dark: shade(pri, -0.12),
    trim: shade(pri, -0.62),
    floor: shade(pri, -0.05),
    floor_walk: shade(pri, 0.12),
    counter: shade(pri, 0.16),
    accent: acc,
    accent_dim: shade(acc, -0.45),
    secondary: sec,
    glow: [255, 244, 214, 255],
    stock_a: acc,
    stock_b: sec,
    stock_c: shade(pri, 0.42),
    white: [244, 242, 250, 255],
  };

  const cv = new Canvas(ATLAS_SIZE, ATLAS_SIZE, palette.trim);

  // ------------------------------------------------------------- palette
  const index = {};
  PALETTE_KEYS.forEach((key, i) => {
    const col = i % PAL_COLS;
    const row = Math.floor(i / PAL_COLS);
    const x = PAL_ORIGIN[0] + col * PAL_CELL;
    const y = PAL_ORIGIN[1] + row * PAL_CELL;
    cv.rect(x, y, PAL_CELL, PAL_CELL, palette[key]);
    index[key] = [x + PAL_CELL / 2, y + PAL_CELL / 2];
  });

  // ---------------------------------------------------------------- sign
  // The fascia: the name in the largest type that fits, on a dark ground with
  // an accent rule under it, so it reads from across the road at night.
  {
    const [x, y, w, h] = REGIONS.sign;
    cv.vgrad(x, y, w, h, shade(pri, -0.62), shade(pri, -0.82));
    cv.frame(x, y, w, h, 4, palette.accent_dim);
    const label = (name || 'UNNAMED').toUpperCase();
    const pad = 26;
    const scale = Math.min(fitScale(label, w - pad * 2, 12), 8);
    if (scale >= 1) {
      cv.text(
        x + Math.floor((w - textWidth(label, scale)) / 2),
        y + Math.max(8, Math.floor((h - 16 - GLYPH.h * scale) / 2)),
        label, scale, palette.white, { shadow: shade(acc, -0.6) },
      );
    }
    cv.rect(x + pad, y + h - 15, w - pad * 2, 4, palette.accent);
  }

  // --------------------------------------------------------------- panel
  // The card on the wall facing the door: what the kerb board says, said again
  // where a visitor who walked in can read it.
  {
    const [x, y, w, h] = REGIONS.panel;
    cv.rect(x, y, w, h, shade(pri, -0.7));
    cv.frame(x, y, w, h, 3, palette.accent);
    cv.rect(x + 3, y + 3, w - 6, 40, palette.accent);
    const head = (name || 'UNNAMED').toUpperCase();
    cv.textCentred(x + 8, y + 6, w - 16, 34, head, inkFor(palette.accent), { max: 5 });

    let ty = y + 62;
    for (const line of wrapText(tagline || '', w - 28, 2, 5)) {
      cv.text(x + 14, ty, line, 2, palette.white);
      ty += GLYPH.h * 2 + 6;
    }
    ty += 6;
    if (builder) {
      for (const line of wrapText(`BUILT BY ${builder}`, w - 28, 1, 2)) {
        cv.text(x + 14, ty, line, 1, shade(palette.white, -0.35));
        ty += GLYPH.h + 4;
      }
    }
    if (category) {
      cv.text(x + 14, ty, category.toUpperCase().replace(/-/g, ' '), 1, palette.secondary);
      ty += GLYPH.h + 8;
    }
    // the link, at the foot, in the accent — the one thing to take away
    const foot = y + h - 34;
    cv.rect(x + 10, foot, w - 20, 24, palette.accent_dim);
    cv.textCentred(x + 12, foot + 2, w - 24, 20, host || '', palette.white, { max: 2 });
  }

  // ---------------------------------------------------------------- link
  {
    const [x, y, w, h] = REGIONS.link;
    cv.vgrad(x, y, w, h, shade(acc, -0.25), shade(acc, -0.55));
    cv.frame(x, y, w, h, 3, palette.white);
    cv.textCentred(x, y + 6, w, 18, 'VISIT', palette.white, { max: 3 });
    cv.textCentred(x + 6, y + 30, w - 12, 22, host || '', palette.white, { max: 2 });
  }

  // --------------------------------------------------------------- plate
  // What a picture node shows before a picture is bound to it. The client
  // replaces this material wholesale when there is an image, so this is only
  // ever seen by a listing that sent none — it should look like a frame
  // waiting for art, not like a fault.
  {
    const [x, y, w, h] = REGIONS.plate;
    cv.vgrad(x, y, w, h, shade(pri, -0.35), shade(pri, -0.6));
    cv.frame(x, y, w, h, 3, palette.accent_dim);
    cv.textCentred(x, y + h / 2 - 16, w, 14, name.toUpperCase(), shade(palette.white, -0.5), { max: 3 });
    cv.textCentred(x, y + h / 2 + 6, w, 10, host || '', shade(palette.white, -0.62), { max: 1 });
  }

  // ---------------------------------------------------------------- logo
  // A flat mark, used on the door mat and — when the logo could not be
  // extruded — on the plinth panel inside. Drawn from the voxel grid when we
  // have one, so the flat and solid versions agree, else the initials.
  {
    const [x, y, w, h] = REGIONS.logo;
    cv.rect(x, y, w, h, shade(pri, -0.66));
    cv.frame(x, y, w, h, 3, palette.accent_dim);
    if (logoPixels) {
      const { cols, rows, runs } = logoPixels;
      const cell = Math.max(1, Math.floor(Math.min((w - 24) / cols, (h - 24) / rows)));
      const ox = x + Math.floor((w - cols * cell) / 2);
      const oy = y + Math.floor((h - rows * cell) / 2);
      for (const [gx, gy, len] of runs) cv.rect(ox + gx * cell, oy + gy * cell, len * cell, cell, palette.accent);
    } else {
      const initials = (name || '?').split(/\s+/).filter(Boolean).map((s) => s[0]).join('').slice(0, 3);
      cv.textCentred(x, y, w, h, initials.toUpperCase() || '?', palette.accent, { max: 12 });
    }
  }

  return {
    png: cv.toPNG(),
    palette,
    hex: Object.fromEntries(Object.entries(palette).map(([k, v]) => [k, hexOf(v)])),
    /** The 0..1 UV box of a named region, as [u0, v0, u1, v1] with v down. */
    uv(regionName) {
      const [x, y, w, h] = REGIONS[regionName];
      return [x / ATLAS_SIZE, y / ATLAS_SIZE, (x + w) / ATLAS_SIZE, (y + h) / ATLAS_SIZE];
    },
    /** The single UV coordinate that samples a palette colour. */
    cell(key) {
      const p = index[key] || index.wall;
      return [p[0] / ATLAS_SIZE, p[1] / ATLAS_SIZE];
    },
  };
}
