// Merge the land registry with every plot.json into the street manifest the
// client fetches. Run at merge time (CI) — agents never edit index.json.
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = join(new URL('..', import.meta.url).pathname, 'public', 'plots');
const registry = JSON.parse(readFileSync(join(root, 'lots.json')));
const lots = [];
for (const [slug, pos] of Object.entries(registry.lots)) {
  const dir = join(root, slug);
  if (!existsSync(join(dir, 'plot.json'))) {
    console.warn('lot assigned but no plot.json:', slug);
    continue;
  }
  const plot = JSON.parse(readFileSync(join(dir, 'plot.json')));
  lots.push({ ...plot, x: pos.x, side: pos.side, glb: `/plots/${slug}/plot.glb`,
    base: `/plots/${slug}/` });
}
const manifest = {
  segment: registry.segment,
  generated: new Date().toISOString(),
  lots,
  vacant: registry.vacant,
};
writeFileSync(join(root, 'index.json'), JSON.stringify(manifest, null, 2));
console.log(`manifest: ${lots.length} lots, ${registry.vacant.length} vacant`);
