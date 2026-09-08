// A tiny raster canvas and PNG encoder, with no dependencies at all.
//
// The city builds a listing's textures inside the submit request, which runs
// in a serverless function: no Chrome, no canvas binding, no native module.
// So text is drawn the way the first shopfronts drew it (poc/assets/
// gen_textures.py) — a 5x7 bitmap font blitted as rectangles into an RGBA
// buffer, deflated into a PNG by hand.
//
// Why bake text at all, when the client can draw a canvas texture over a node?
// Because the poster is the og:image of the listing page, and the poster
// renderer renders the *build*, not the world around it: anything the client
// draws as street furniture (the kerb board) is absent from the poster, the
// embed and the directory card. A name that only exists client-side is a name
// that never travels. So it goes in the glb.
//
// The pixel look is deliberate, not a limitation: it matches the voxel city,
// it survives being scaled onto a 3 m sign, and a whole shop's signage costs
// a few kilobytes.
import { deflateSync } from 'node:zlib';

// ------------------------------------------------------------------- png

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(tag, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(tag, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** Encode an RGBA byte buffer as a PNG. Filter 0 on every row: the images are
 *  flat colour and deflate handles them well without prediction. */
export function encodePNG(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy ? rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
      : Buffer.from(rgba).copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 6;    // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ------------------------------------------------------------- 5x7 font
// Seven rows of five bits, MSB leftmost. Uppercase only — the shop signs are
// set in capitals, and a lowercase set would double the table for nothing.

export const FONT = {
  A: [0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  B: [0x1e, 0x11, 0x11, 0x1e, 0x11, 0x11, 0x1e],
  C: [0x0e, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0e],
  D: [0x1e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x1e],
  E: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x1f],
  F: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x10],
  G: [0x0e, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0e],
  H: [0x11, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  I: [0x0e, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0e],
  J: [0x07, 0x02, 0x02, 0x02, 0x02, 0x12, 0x0c],
  K: [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11],
  L: [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1f],
  M: [0x11, 0x1b, 0x15, 0x15, 0x11, 0x11, 0x11],
  N: [0x11, 0x19, 0x15, 0x13, 0x11, 0x11, 0x11],
  O: [0x0e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  P: [0x1e, 0x11, 0x11, 0x1e, 0x10, 0x10, 0x10],
  Q: [0x0e, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0d],
  R: [0x1e, 0x11, 0x11, 0x1e, 0x14, 0x12, 0x11],
  S: [0x0f, 0x10, 0x10, 0x0e, 0x01, 0x01, 0x1e],
  T: [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
  U: [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  V: [0x11, 0x11, 0x11, 0x11, 0x11, 0x0a, 0x04],
  W: [0x11, 0x11, 0x11, 0x15, 0x15, 0x1b, 0x11],
  X: [0x11, 0x11, 0x0a, 0x04, 0x0a, 0x11, 0x11],
  Y: [0x11, 0x11, 0x0a, 0x04, 0x04, 0x04, 0x04],
  Z: [0x1f, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1f],
  0: [0x0e, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0e],
  1: [0x04, 0x0c, 0x04, 0x04, 0x04, 0x04, 0x0e],
  2: [0x0e, 0x11, 0x01, 0x06, 0x08, 0x10, 0x1f],
  3: [0x0e, 0x11, 0x01, 0x06, 0x01, 0x11, 0x0e],
  4: [0x02, 0x06, 0x0a, 0x12, 0x1f, 0x02, 0x02],
  5: [0x1f, 0x10, 0x1e, 0x01, 0x01, 0x11, 0x0e],
  6: [0x06, 0x08, 0x10, 0x1e, 0x11, 0x11, 0x0e],
  7: [0x1f, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
  8: [0x0e, 0x11, 0x11, 0x0e, 0x11, 0x11, 0x0e],
  9: [0x0e, 0x11, 0x11, 0x0f, 0x01, 0x02, 0x0c],
  ' ': [0, 0, 0, 0, 0, 0, 0],
  '.': [0, 0, 0, 0, 0, 0x0c, 0x0c],
  ',': [0, 0, 0, 0, 0, 0x0c, 0x08],
  ':': [0, 0x0c, 0x0c, 0, 0x0c, 0x0c, 0],
  '!': [0x04, 0x04, 0x04, 0x04, 0x04, 0, 0x04],
  '?': [0x0e, 0x11, 0x01, 0x06, 0x04, 0, 0x04],
  '-': [0, 0, 0, 0x1f, 0, 0, 0],
  '+': [0, 0x04, 0x04, 0x1f, 0x04, 0x04, 0],
  '/': [0x01, 0x01, 0x02, 0x04, 0x08, 0x10, 0x10],
  '&': [0x0c, 0x12, 0x14, 0x08, 0x15, 0x12, 0x0d],
  '%': [0x19, 0x1a, 0x02, 0x04, 0x08, 0x0b, 0x13],
  '>': [0x08, 0x04, 0x02, 0x01, 0x02, 0x04, 0x08],
  "'": [0x04, 0x04, 0x08, 0, 0, 0, 0],
  '"': [0x0a, 0x0a, 0x14, 0, 0, 0, 0],
  '(': [0x02, 0x04, 0x08, 0x08, 0x08, 0x04, 0x02],
  ')': [0x08, 0x04, 0x02, 0x02, 0x02, 0x04, 0x08],
  '#': [0x0a, 0x1f, 0x0a, 0x0a, 0x0a, 0x1f, 0x0a],
  '@': [0x0e, 0x11, 0x17, 0x15, 0x17, 0x10, 0x0e],
  _: [0, 0, 0, 0, 0, 0, 0x1f],
  '=': [0, 0, 0x1f, 0, 0x1f, 0, 0],
  // the city truncates taglines with a real ellipsis, so the sign needs one
  '…': [0, 0, 0, 0, 0, 0, 0x15],
};

const GLYPH_W = 5;
const GLYPH_H = 7;
const ADVANCE = 6;   // one blank column between glyphs

/** Width in pixels of `s` at `scale`, with no trailing gap. */
export const textWidth = (s, scale = 1) => Math.max(0, String(s).length * ADVANCE - 1) * scale;

/** The largest integer scale at which `s` fits `maxW` (0 if it never does). */
export function fitScale(s, maxW, maxScale = 16) {
  for (let k = maxScale; k >= 1; k--) if (textWidth(s, k) <= maxW) return k;
  return 0;
}

/** Break `s` into lines that each fit `maxW` at `scale`, on word boundaries.
 *  A single word longer than the line is hard-cut rather than dropped. */
export function wrapText(s, maxW, scale, maxLines = 99) {
  const chars = Math.max(1, Math.floor((maxW / scale + 1) / ADVANCE));
  const lines = [];
  for (const word of String(s).replace(/\s+/g, ' ').trim().split(' ')) {
    if (!word) continue;
    const last = lines[lines.length - 1];
    if (last !== undefined && last.length + 1 + word.length <= chars) {
      lines[lines.length - 1] = `${last} ${word}`;
    } else if (word.length <= chars) {
      lines.push(word);
    } else {
      for (let i = 0; i < word.length; i += chars) lines.push(word.slice(i, i + chars));
    }
    if (lines.length > maxLines) break;
  }
  if (lines.length > maxLines) {
    lines.length = maxLines;
    const last = lines[maxLines - 1];
    lines[maxLines - 1] = last.length > 1 ? `${last.slice(0, -1)}.` : last;
  }
  return lines;
}

// ----------------------------------------------------------------- canvas

/** #rrggbb (or #rgb) to an [r,g,b,a] byte tuple. */
export function rgba(hex, a = 255) {
  const s = String(hex || '').replace('#', '');
  const full = s.length === 3 ? s.split('').map((c) => c + c).join('') : s;
  const n = parseInt(full, 16);
  if (full.length !== 6 || Number.isNaN(n)) return [255, 0, 255, a];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, a];
}

/** Mix two [r,g,b,a] tuples; t = 0 is `a`, t = 1 is `b`. */
export const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

export class Canvas {
  constructor(width, height, bg = [0, 0, 0, 255]) {
    this.width = width;
    this.height = height;
    this.px = Buffer.alloc(width * height * 4);
    this.rect(0, 0, width, height, bg);
  }

  set(x, y, c) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = (y * this.width + x) * 4;
    this.px[i] = c[0];
    this.px[i + 1] = c[1];
    this.px[i + 2] = c[2];
    this.px[i + 3] = c[3] ?? 255;
  }

  rect(x, y, w, h, c) {
    const x0 = Math.max(0, x | 0);
    const y0 = Math.max(0, y | 0);
    const x1 = Math.min(this.width, (x | 0) + (w | 0));
    const y1 = Math.min(this.height, (y | 0) + (h | 0));
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) this.set(xx, yy, c);
    return this;
  }

  /** A hollow rectangle `t` pixels thick, drawn inside the given bounds. */
  frame(x, y, w, h, t, c) {
    this.rect(x, y, w, t, c);
    this.rect(x, y + h - t, w, t, c);
    this.rect(x, y, t, h, c);
    this.rect(x + w - t, y, t, h, c);
    return this;
  }

  /** A vertical gradient, so a flat panel has some depth to it. */
  vgrad(x, y, w, h, top, bottom) {
    for (let yy = 0; yy < h; yy++) {
      this.rect(x, y + yy, w, 1, mix(top, bottom, h < 2 ? 0 : yy / (h - 1)));
    }
    return this;
  }

  text(x, y, s, scale, c, { shadow = null } = {}) {
    if (shadow) this.text(x + scale, y + scale, s, scale, shadow);
    let cx = x;
    for (const ch of String(s).toUpperCase()) {
      const rows = FONT[ch] || FONT[' '];
      for (let ry = 0; ry < GLYPH_H; ry++) {
        const bits = rows[ry];
        for (let rx = 0; rx < GLYPH_W; rx++) {
          if (bits & (1 << (GLYPH_W - 1 - rx))) this.rect(cx + rx * scale, y + ry * scale, scale, scale, c);
        }
      }
      cx += ADVANCE * scale;
    }
    return this;
  }

  /** Draw `s` centred in the box, at the largest scale that fits both axes. */
  textCentred(x, y, w, h, s, c, { max = 16, shadow = null } = {}) {
    const scale = Math.min(fitScale(s, w, max), Math.floor(h / GLYPH_H) || 0);
    if (scale < 1) return this;
    return this.text(
      x + Math.floor((w - textWidth(s, scale)) / 2),
      y + Math.floor((h - GLYPH_H * scale) / 2),
      s, scale, c, { shadow },
    );
  }

  toPNG() {
    return encodePNG(this.width, this.height, this.px);
  }
}

export const GLYPH = { w: GLYPH_W, h: GLYPH_H, advance: ADVANCE };
