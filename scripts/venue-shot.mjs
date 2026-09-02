// Screenshots of a venue from its fixed cameras — the visual evidence a
// critic scores and the set a visual-regression diff compares.
//   node scripts/venue-shot.mjs [--venue <id> | --all] [--cam <name>|all] [--tier 2]
//                               [--out dir] [--size 1536x864] [--bundle <url>]
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openFixture, PUBLIC_DIR } from '../lib/venue-harness.mjs';

const argv = process.argv.slice(2);
const arg = (name, fallback = null) => { const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback; };
const ids = argv.includes('--all') || !arg('venue')
  ? JSON.parse(readFileSync(join(PUBLIC_DIR, 'venues', 'index.json'), 'utf8')).venues.map((v) => v.id)
  : [arg('venue')];
const tier = Number(arg('tier', '2'));
const out = arg('out', 'poc/out/shots');
const [width, height] = arg('size', '1536x864').split('x').map(Number);
mkdirSync(out, { recursive: true });

for (const id of ids) {
  const fx = await openFixture({ venue: id, tier, fast: true, width, height, bundle: arg('bundle') });
  try {
    const def = await fx.def();
    if (tier >= 1) { await fx.step(1); await fx.waitLoaded(); }
    const cams = arg('cam', 'all') === 'all' ? Object.keys(def.cameras) : [arg('cam')];
    for (const cam of cams) {
      if (!(await fx.setCam(cam))) { console.log(`skip unknown camera ${cam}`); continue; }
      await fx.step(90);            // let anims and doors settle
      const png = await fx.shot();
      const file = join(out, `${id}-${cam}.png`);
      writeFileSync(file, png);
      const s = await fx.stats();
      console.log(`${file}  ${width}x${height}  ${(png.length / 1024).toFixed(0)} KiB  tier ${s.tier}  ${s.calls} calls  ${s.tris} tris`);
    }
    if (fx.problems.length) console.log(`page errors: ${[...new Set(fx.problems)].slice(0, 5).join(' | ')}`);
  } finally {
    await fx.close();
  }
}
