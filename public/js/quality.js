// Quality presets and hardware detection for the city client.
//
// Ported from Fable Cities (github.com/rawprogress/fable-cities,
// src/shared/quality.js, MIT — see THIRD-PARTY-NOTICES.md) and cut down to
// the knobs this client actually has. Pure: no three.js, no DOM writes, so it
// can run before the renderer exists and be exercised from node with a stub
// WebGL context.
//
// The city is cheap to draw except for two things that scale with the
// drawing buffer — bloom (five blurred mips and a full-resolution composite)
// and the light loop every MeshStandardMaterial fragment runs — and both are
// quadratic in pixel ratio. So a preset is mostly a pixel-ratio cap, plus how
// many of the street's lights are live at once (see lights.js). Detection
// guesses DOWN, never up: a slideshow is worse than a softer picture, and the
// runtime guard in perfguard.js catches what detection got wrong.

/** Cheapest first. Indexes into this array are the steps the guard walks. */
export const PRESET_ORDER = ['low', 'medium', 'high'];

export const PRESETS = {
  low: { name: 'low', pixelRatio: 1, lights: 4 },
  medium: { name: 'medium', pixelRatio: 1.5, lights: 6 },
  high: { name: 'high', pixelRatio: 2, lights: 8 },
};

/** Projected drawing-buffer pixels above which a weak GPU gets one more step down. */
export const PIXEL_BUDGET = 4.5e6;

/**
 * Renderer string → tier. Ordered: the FIRST match wins, so specific patterns
 * (`apple m3 max`) sit above general ones (`apple m3`). Strings seen in the wild:
 *   ANGLE (Apple, ANGLE Metal Renderer: Apple M5 Pro, Unspecified Version)
 *   ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x000046A8) Direct3D11 vs_5_0 ps_5_0, D3D11)
 *   ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Laptop GPU Direct3D11 vs_5_0 ps_5_0, D3D11)
 *   Apple GPU   (Safari masks everything behind this)
 *   Google SwiftShader / llvmpipe (LLVM 15.0.7, 256 bits)
 */
export const GPU_TIERS = [
  // 0: no GPU at all (this is what CI renders posters with)
  [/swiftshader|llvmpipe|softpipe|software\s*(rasteri[sz]er|adapter)|basic\s*render|microsoft\s*basic/i, 0, 'software rasteriser'],
  // 3: discrete desktop / workstation / Apple Pro-Max-Ultra
  [/apple\s*m\d+\s*(pro|max|ultra)/i, 3, 'Apple M-series Pro/Max/Ultra'],
  [/(geforce\s*)?rtx\s*[2-9]\d{3}|rtx\s*a\d|geforce\s*rtx/i, 3, 'GeForce RTX'],
  [/radeon\s*(rx|pro)\s*(vii|[6-9]\d{3})|radeon\s*rx\s*5[6-9]\d{2}/i, 3, 'Radeon RX 5600+'],
  [/arc\s*a7\d\d|arc\s*b5\d\d/i, 3, 'Intel Arc A7xx/B5xx'],
  [/quadro\s*(rtx|p[45689]\d{3})|tesla|a100|h100|l40/i, 3, 'workstation GPU'],
  // 2: good integrated / entry discrete
  [/apple\s*m\d/i, 2, 'Apple M-series (base)'],
  [/iris\(?r?\)?\s*xe|xe\s*graphics|arc\s*(a3\d\d|graphics)/i, 2, 'Intel Iris Xe / Arc'],
  [/geforce\s*(gtx\s*(9|10|16)\d\d|mx\d{3})|gtx\s*(9|10|16)\d\d/i, 2, 'GeForce GTX 9xx-16xx'],
  [/radeon\s*(rx\s*[45]\d{2,3}|vega|graphics|\d{3}m)|radeon\s*(6|7|8)\d0m|gfx10|gfx11/i, 2, 'Radeon Vega / RDNA iGPU'],
  [/adreno\s*[67]\d\d|mali-g(7[1-9]|[89]\d|\d{3})/i, 2, 'recent mobile GPU'],
  // 1: weak integrated / older mobile
  [/intel.*\b(hd|uhd)\s*graphics|hd\s*graphics\s*\d|iris\s*(plus|pro)|intel.*gma/i, 1, 'Intel HD/UHD/Iris Plus'],
  [/adreno|mali|powervr|videocore|apple\s*a\d+\s*gpu|tegra/i, 1, 'mobile GPU'],
  [/geforce\s*(gt|gtx\s*[5-8]\d\d)|radeon\s*hd|firepro/i, 1, 'legacy discrete GPU'],
];

/** The preset each tier starts at. This client is far lighter than a full
 *  city builder, so a base Apple M-series or an Iris Xe runs `high`. */
const TIER_PRESET = ['low', 'medium', 'high', 'high'];

const clampIndex = (i) => Math.max(0, Math.min(PRESET_ORDER.length - 1, i));
const indexOf = (name) => {
  const i = PRESET_ORDER.indexOf(name);
  return i < 0 ? PRESET_ORDER.indexOf('high') : i;
};

/** Strip vendor decoration — `Intel(R) Iris(R) Xe`, `AMD Radeon(TM) Graphics` — before matching. */
function normalizeRenderer(s) {
  return String(s || '').replace(/\((?:tm|r|c)\)/gi, ' ').replace(/[™®]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Classify a WebGL renderer string → { tier, label, confidence }. */
export function classifyGPU(rendererString, cores = 0) {
  const s = normalizeRenderer(rendererString);
  for (const [re, tier, label] of GPU_TIERS) {
    if (re.test(s)) return { tier, label, confidence: 'known' };
  }
  // Masked ("Apple GPU", "Mozilla") or newer than this table. Core count is
  // the only other thing that correlates: 8+ cores is a laptop-class part.
  const tier = cores >= 8 ? 2 : 1;
  return { tier, label: s ? `unrecognised (${s.slice(0, 60)})` : 'unknown', confidence: 'guessed' };
}

/**
 * Everything cheap to learn about the machine. `gl` is optional — pass the
 * live context to read the real renderer string; without one a throwaway
 * context is created and released at once (browsers cap live contexts at ~16).
 */
export function detectHardware(gl = null) {
  const nav = typeof navigator !== 'undefined' ? navigator : {};
  const win = typeof window !== 'undefined' ? window : {};
  let renderer = '';
  let vendor = '';
  let maxTextureSize = 0;
  let temp = null;
  try {
    let ctx = gl;
    if (!ctx && typeof document !== 'undefined') {
      const c = document.createElement('canvas');
      ctx = c.getContext('webgl2') || c.getContext('webgl');
      temp = ctx;
    }
    if (ctx) {
      const ext = ctx.getExtension('WEBGL_debug_renderer_info');
      renderer = String(ext ? ctx.getParameter(ext.UNMASKED_RENDERER_WEBGL) : ctx.getParameter(ctx.RENDERER) || '');
      vendor = String(ext ? ctx.getParameter(ext.UNMASKED_VENDOR_WEBGL) : ctx.getParameter(ctx.VENDOR) || '');
      maxTextureSize = ctx.getParameter(ctx.MAX_TEXTURE_SIZE) || 0;
    }
  } catch (err) {
    renderer = 'unavailable: ' + (err && err.message);
  }
  try { temp && temp.getExtension('WEBGL_lose_context')?.loseContext(); } catch { /* ignore */ }

  const cores = Number.isFinite(nav.hardwareConcurrency) ? nav.hardwareConcurrency : 0;
  const memoryGB = Number.isFinite(nav.deviceMemory) ? nav.deviceMemory : null;
  const dpr = Number.isFinite(win.devicePixelRatio) && win.devicePixelRatio > 0 ? win.devicePixelRatio : 1;
  const viewport = [win.innerWidth || 1280, win.innerHeight || 720];
  const touch = !!(nav.maxTouchPoints > 0);
  const hover = !!(win.matchMedia && win.matchMedia('(hover: hover)').matches);
  const gpu = classifyGPU(renderer, cores);
  return {
    renderer, vendor, maxTextureSize, cores, memoryGB, dpr, viewport,
    /** phone/tablet: a touch screen with no real pointer */
    mobile: touch && !hover,
    gpuTier: gpu.tier, gpuLabel: gpu.label, gpuConfidence: gpu.confidence,
  };
}

/**
 * The preset this machine should START at → { name, reasons[] }. Every rule
 * that fired is in `reasons`, so the choice can be printed and checked.
 */
export function recommendQuality(hw) {
  const reasons = [];
  const base = TIER_PRESET[hw.gpuTier] || 'low';
  let idx = indexOf(base);
  reasons.push(`GPU tier ${hw.gpuTier} (${hw.gpuLabel}${hw.gpuConfidence === 'guessed' ? ', guessed from ' + hw.cores + ' cores' : ''}) → ${base}`);
  const cap = (name, why) => {
    const c = indexOf(name);
    if (c < idx) { idx = c; reasons.push(`${why} → cap ${name}`); }
  };
  if (hw.cores > 0 && hw.cores <= 4) cap('medium', `${hw.cores} CPU cores`);
  // navigator.deviceMemory is clamped at 8 by the spec, so only the low end says anything
  if (hw.memoryGB != null && hw.memoryGB <= 2) cap('low', `${hw.memoryGB} GB device memory`);
  else if (hw.memoryGB != null && hw.memoryGB <= 4) cap('medium', `${hw.memoryGB} GB device memory`);
  // A phone's number is not its GPU's peak but the sustained, thermally
  // throttled one — and 3x panels make pixel ratio 2 a lot of pixels.
  if (hw.mobile) cap('medium', 'touch device without a pointer (phone/tablet)');
  if (hw.maxTextureSize && hw.maxTextureSize < 8192) cap('medium', `MAX_TEXTURE_SIZE ${hw.maxTextureSize}`);
  // Pixel pressure: per-frame cost follows the drawing buffer, which the panel decides.
  const pr = Math.min(hw.dpr, PRESETS[PRESET_ORDER[idx]].pixelRatio);
  const pixels = hw.viewport[0] * hw.viewport[1] * pr * pr;
  if (hw.gpuTier <= 1 && pixels > PIXEL_BUDGET) {
    idx = clampIndex(idx - 1);
    reasons.push(`${(pixels / 1e6).toFixed(1)} Mpx drawing buffer on a weak GPU → one step down`);
  }
  return { name: PRESET_ORDER[clampIndex(idx)], reasons };
}

/** One line for a console log or a HUD. */
export function describeHardware(hw) {
  return [
    hw.gpuLabel,
    `${hw.cores || '?'} cores`,
    hw.memoryGB != null ? `${hw.memoryGB} GB` : null,
    `DPR ${(+hw.dpr).toFixed(2).replace(/\.?0+$/, '')}`,
  ].filter(Boolean).join(' · ');
}

/** Step `name` down by `n` presets, floored at `low`. */
export function stepDown(name, n = 1) {
  return PRESET_ORDER[clampIndex(indexOf(name) - n)];
}

/** true when `a` is a cheaper preset than `b`. */
export function isCheaper(a, b) {
  return indexOf(a) < indexOf(b);
}
