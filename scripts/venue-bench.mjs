// Frame-time benchmark on a real GPU: opens the fixture in headless Chrome
// WITHOUT SwiftShader and without the frame-rate cap, parks the camera at
// each named view and samples requestAnimationFrame for a few seconds.
// Numbers from CI's software renderer are meaningless, so this runs locally.
//   node scripts/venue-bench.mjs [--venue <id>] [--tier 2] [--cams a,b] [--seconds 6]
//                                [--size 1920x1080] [--bundle <url>] [--out report.json]
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { openFixture } from '../lib/venue-harness.mjs';

const argv = process.argv.slice(2);
const arg = (name, fallback = null) => { const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback; };
const id = arg('venue', 'stadium');
const tier = Number(arg('tier', '2'));
const seconds = Number(arg('seconds', '6'));
const [width, height] = arg('size', '1920x1080').split('x').map(Number);

const fx = await openFixture({ venue: id, tier, fast: true, width, height, gpu: true, bundle: arg('bundle') });
const rows = [];
try {
  const def = await fx.def();
  if (tier >= 1) { await fx.step(1); await fx.waitLoaded(); }
  const cams = arg('cams') ? arg('cams').split(',') : Object.keys(def.cameras);
  const gl = await fx.evaluate(`(() => { const g = window.__venue.renderer.getContext(); const d = g.getExtension('WEBGL_debug_renderer_info'); return d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER); })()`);
  console.log(`renderer: ${gl}\nvenue ${id} tier ${tier} at ${width}x${height}, ${seconds}s per camera\n`);
  for (const cam of cams) {
    await fx.setCam(cam);
    await fx.step(30);
    const r = await fx.evaluate(`new Promise((done) => {
      const ts = []; const t0 = performance.now();
      (function f(t) { ts.push(t); if (t - t0 < ${seconds * 1000}) requestAnimationFrame(f); else done(ts); })(t0);
    }).then((ts) => {
      const d = []; for (let i = 1; i < ts.length; i++) d.push(ts[i] - ts[i - 1]);
      d.sort((a, b) => a - b);
      const q = (p) => d[Math.min(d.length - 1, Math.floor(p * d.length))];
      const s = window.__venue.stats();
      return { frames: d.length, median_ms: q(0.5), p95_ms: q(0.95), worst_ms: d[d.length - 1], calls: s.calls, tris: s.tris };
    })`);
    const fps = (ms) => (ms > 0 ? 1000 / ms : 0);
    rows.push({ cam, ...r, median_fps: fps(r.median_ms), p95_fps: fps(r.p95_ms) });
    console.log(`${cam.padEnd(14)} median ${r.median_ms.toFixed(2)} ms (${fps(r.median_ms).toFixed(0)} fps)  p95 ${r.p95_ms.toFixed(2)} ms (${fps(r.p95_ms).toFixed(0)} fps)  ${r.calls} calls  ${r.tris} tris`);
  }
  if (fx.problems.length) console.log(`\npage errors: ${[...new Set(fx.problems)].slice(0, 5).join(' | ')}`);
  const out = arg('out');
  if (out) { mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), renderer: gl, venue: id, tier, size: [width, height], rows }, null, 2) + '\n'); }
} finally {
  await fx.close();
}
