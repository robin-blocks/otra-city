// A submitted logo, turned into a solid object you can walk around.
//
// The first shopfronts had a logo sculpture inside — PromptFrenzy's bolt is a
// 12x12 ASCII bitmap extruded into boxes (poc/blender/02_build_shop.py). This
// does the same thing to whatever logo a listing sends: decode it, knock it
// down to a coarse grid, and extrude the cells that survive.
//
// The cost is deliberately bounded at both ends. The grid is capped at
// GRID_MAX, so an intricate logo becomes a chunky one rather than an expensive
// one; and each row of live cells is merged into runs before it becomes
// geometry, which takes a typical mark from ~250 boxes to ~60. A logo costs
// single-digit milliseconds and a couple of thousand triangles against a
// 50,000 budget.
//
// PNG only, and that is a decision rather than a limitation: a logo worth
// extruding has an alpha channel, alpha means PNG, and PNG is the one format
// that decodes here without a dependency or a browser. Anything else still
// gets used — flat, on the sign — and the report says why it was not built in
// three dimensions, which is the cheapest possible way to teach an agent to
// send the better asset next time.
import { inflateSync } from 'node:zlib';

export const GRID_MAX = 22;      // cells across the logo's bounding box
const ALPHA_ON = 128;            // a pixel counts as ink at or above this alpha
const LUMA_ON = 0.62;            // ...or, for an opaque logo, this far from the
                                 // background corner colour
const MIN_CELLS = 6;             // fewer live cells than this is not a logo
const MAX_RUNS = 420;            // hard ceiling on emitted boxes

// ------------------------------------------------------------- png decode
// Enough of the format for real logos: 8- and 16-bit, greyscale, truecolour,
// palette and either with alpha. Adam7 interlacing is refused — it is vanishing
// rare outside of the 1990s and supporting it would double this function.

const BYTES_PER_PIXEL = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

function unfilter(data, width, height, bpp, stride) {
  const out = Buffer.alloc(height * stride);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = data[pos++];
    const row = out.subarray(y * stride, (y + 1) * stride);
    const prev = y ? out.subarray((y - 1) * stride, y * stride) : null;
    data.copy(row, 0, pos, pos + stride);
    pos += stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? row[i - bpp] : 0;
      const b = prev ? prev[i] : 0;
      const c = prev && i >= bpp ? prev[i - bpp] : 0;
      switch (filter) {
        case 1: row[i] = (row[i] + a) & 255; break;
        case 2: row[i] = (row[i] + b) & 255; break;
        case 3: row[i] = (row[i] + ((a + b) >> 1)) & 255; break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          row[i] = (row[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
          break;
        }
        default: break;   // 0: none
      }
    }
  }
  return out;
}

/** Decode a PNG buffer to { width, height, px } with px as RGBA bytes.
 *  Returns null for anything it cannot read — never throws. */
export function decodePNG(buf) {
  try {
    if (!buf || buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) return null;
    let pos = 8;
    let hdr = null;
    let palette = null;
    let trns = null;
    const idat = [];
    while (pos + 8 <= buf.length) {
      const len = buf.readUInt32BE(pos);
      const tag = buf.toString('ascii', pos + 4, pos + 8);
      const body = buf.subarray(pos + 8, pos + 8 + len);
      if (tag === 'IHDR') {
        hdr = {
          width: body.readUInt32BE(0),
          height: body.readUInt32BE(4),
          depth: body[8],
          colour: body[9],
          interlace: body[12],
        };
      } else if (tag === 'PLTE') palette = Buffer.from(body);
      else if (tag === 'tRNS') trns = Buffer.from(body);
      else if (tag === 'IDAT') idat.push(Buffer.from(body));
      else if (tag === 'IEND') break;
      pos += 12 + len;
    }
    if (!hdr || !idat.length || hdr.interlace) return null;
    const { width, height, depth, colour } = hdr;
    if (!width || !height || width * height > 8e6) return null;
    if (depth !== 8 && depth !== 16) return null;   // sub-byte depths are palette art, not logos
    const channels = BYTES_PER_PIXEL[colour];
    if (!channels) return null;

    const sample = depth / 8;
    const bpp = channels * sample;
    const stride = width * bpp;
    const raw = unfilter(inflateSync(Buffer.concat(idat)), width, height, bpp, stride);

    const px = Buffer.alloc(width * height * 4);
    const at = (row, i) => raw[row * stride + i * sample];   // high byte of 16-bit
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const o = (y * width + x) * 4;
        const i = x * channels;
        let r; let g; let b; let a = 255;
        if (colour === 3) {
          const idx = at(y, i);
          if (!palette || idx * 3 + 2 >= palette.length) return null;
          [r, g, b] = [palette[idx * 3], palette[idx * 3 + 1], palette[idx * 3 + 2]];
          if (trns && idx < trns.length) a = trns[idx];
        } else if (colour === 0 || colour === 4) {
          r = g = b = at(y, i);
          if (colour === 4) a = at(y, i + 1);
        } else {
          r = at(y, i);
          g = at(y, i + 1);
          b = at(y, i + 2);
          if (colour === 6) a = at(y, i + 3);
        }
        px[o] = r; px[o + 1] = g; px[o + 2] = b; px[o + 3] = a;
      }
    }
    return { width, height, px };
  } catch {
    return null;
  }
}

// --------------------------------------------------------------- voxelise

const luma = (r, g, b) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

/** Which pixels are "ink". A logo with transparency is read by its alpha; a
 *  logo on a solid background is read by distance from that background, taken
 *  from the corners so a dark mark on white and a white mark on dark both
 *  work. */
function inkMask(img) {
  const { width: w, height: h, px } = img;
  const alphaAt = (x, y) => px[(y * w + x) * 4 + 3];
  let transparent = 0;
  for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) if (alphaAt(x, y) < ALPHA_ON) transparent++;
  const sampled = Math.ceil(h / 2) * Math.ceil(w / 2);
  const hasAlpha = transparent > sampled * 0.04;

  const mask = new Uint8Array(w * h);
  if (hasAlpha) {
    for (let i = 0; i < w * h; i++) mask[i] = px[i * 4 + 3] >= ALPHA_ON ? 1 : 0;
    return mask;
  }
  const corners = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]]
    .map(([x, y]) => luma(px[(y * w + x) * 4], px[(y * w + x) * 4 + 1], px[(y * w + x) * 4 + 2]));
  const bg = corners.reduce((a, b) => a + b, 0) / corners.length;
  for (let i = 0; i < w * h; i++) {
    const l = luma(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]);
    mask[i] = Math.abs(l - bg) >= (1 - LUMA_ON) ? 1 : 0;
  }
  return mask;
}

/**
 * Turn a logo image into merged unit cells on a grid.
 *
 * Returns null when there is nothing worth building — an image we cannot read,
 * a mark too sparse to be a logo, or one so busy that thresholding it fills the
 * whole square (a photo, or a screenshot sent by mistake).
 *
 * `runs` are [x, y, length] in grid cells with y counted downward from the top,
 * already merged along x. `cols`/`rows` give the grid the runs live on.
 */
export function voxeliseLogo(buf, { grid = GRID_MAX } = {}) {
  const img = decodePNG(buf);
  if (!img) return null;
  const mask = inkMask(img);
  const { width: w, height: h } = img;

  // crop to the ink, so a logo with generous padding still fills its grid
  let x0 = w; let y0 = h; let x1 = -1; let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < x0 || y1 < y0) return null;
  const cw = x1 - x0 + 1;
  const ch = y1 - y0 + 1;

  // the longer side gets `grid` cells; the shorter keeps the aspect ratio
  const cols = cw >= ch ? grid : Math.max(3, Math.round((cw / ch) * grid));
  const rows = ch > cw ? grid : Math.max(3, Math.round((ch / cw) * grid));

  // a cell is ink if enough of the source pixels under it are
  const cells = new Uint8Array(cols * rows);
  let live = 0;
  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      const sx0 = x0 + Math.floor((gx * cw) / cols);
      const sx1 = x0 + Math.max(Math.floor(((gx + 1) * cw) / cols), Math.floor((gx * cw) / cols) + 1);
      const sy0 = y0 + Math.floor((gy * ch) / rows);
      const sy1 = y0 + Math.max(Math.floor(((gy + 1) * ch) / rows), Math.floor((gy * ch) / rows) + 1);
      let on = 0; let total = 0;
      for (let y = sy0; y < Math.min(sy1, h); y++) {
        for (let x = sx0; x < Math.min(sx1, w); x++) { total++; on += mask[y * w + x]; }
      }
      if (total && on / total >= 0.45) { cells[gy * cols + gx] = 1; live++; }
    }
  }
  const area = cols * rows;
  if (live < MIN_CELLS || live > area * 0.93) return null;   // nothing, or a solid block

  // merge each row into runs — the whole reason this stays cheap
  const runs = [];
  for (let gy = 0; gy < rows && runs.length < MAX_RUNS; gy++) {
    let gx = 0;
    while (gx < cols) {
      if (!cells[gy * cols + gx]) { gx++; continue; }
      let len = 1;
      while (gx + len < cols && cells[gy * cols + gx + len]) len++;
      runs.push([gx, gy, len]);
      gx += len;
    }
  }
  if (runs.length > MAX_RUNS) return null;
  return { cols, rows, runs, cells: live, aspect: cols / rows };
}
