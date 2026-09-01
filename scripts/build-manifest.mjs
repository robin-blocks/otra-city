// Merge the land registry with every accepted plot.json into the street
// manifest the client fetches, ASSIGNING A LOT to any plot that doesn't have
// one yet. Without this a submitted plot would merge into the repo and never
// appear in the city.
//
// Allocation rules:
//   * existing assignments in lots.json are never moved (a shop keeps its
//     address forever)
//   * new plots take the nearest free lot to the central spawn, so the street
//     stays dense and distance-from-spawn keeps its meaning
//   * assignments are written back to lots.json, so they are stable and
//     reviewable in git rather than recomputed each build
//   * the boulevard extends itself as it fills, always leaving vacant lots on
//     show for the claim boards
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = join(new URL('..', import.meta.url).pathname, 'public', 'plots');
const registryPath = join(root, 'lots.json');
const registry = JSON.parse(readFileSync(registryPath));
const PITCH = registry.lot_pitch || 12;
const KEEP_VACANT = registry.keep_vacant ?? 2;

// every lot position, ordered by walking distance from the central spawn
function* positions() {
  for (let ring = 0; ; ring++) {
    const xs = ring === 0 ? [0] : [-ring * PITCH, ring * PITCH];
    for (const x of xs) {
      for (const side of [-1, 1]) yield { x, side };
    }
  }
}
const key = (p) => `${p.x}:${p.side}`;

// plots present on disk, deterministic order
const slugs = readdirSync(root)
  .filter((s) => existsSync(join(root, s, 'plot.json')) && existsSync(join(root, s, 'plot.glb')))
  .sort();

const assigned = { ...registry.lots };
for (const slug of Object.keys(assigned)) {
  if (!slugs.includes(slug)) delete assigned[slug]; // plot removed -> free the lot
}
const taken = new Set(Object.values(assigned).map(key));

// hand out lots to anything unassigned, nearest-to-spawn first
const unassigned = slugs.filter((s) => !assigned[s]);
if (unassigned.length) {
  const gen = positions();
  for (const slug of unassigned) {
    let spot;
    do { spot = gen.next().value; } while (taken.has(key(spot)));
    assigned[slug] = spot;
    taken.add(key(spot));
  }
}

// show the next few free lots as vacant, so the street always advertises space
const vacant = [];
const gen = positions();
while (vacant.length < KEEP_VACANT) {
  const spot = gen.next().value;
  if (!taken.has(key(spot))) {
    vacant.push(spot);
    taken.add(key(spot));
  }
}

const lots = slugs.map((slug) => {
  const plot = JSON.parse(readFileSync(join(root, slug, 'plot.json')));
  const pos = assigned[slug];
  return { ...plot, x: pos.x, side: pos.side, glb: `/plots/${slug}/plot.glb`, base: `/plots/${slug}/` };
});

// persist assignments (deterministic key order) so lots never shuffle
const nextRegistry = {
  ...registry,
  lots: Object.fromEntries(Object.keys(assigned).sort().map((s) => [s, assigned[s]])),
  vacant,
};
writeFileSync(registryPath, JSON.stringify(nextRegistry, null, 2) + '\n');

writeFileSync(join(root, 'index.json'),
  JSON.stringify({ segment: registry.segment, lots, vacant }, null, 2) + '\n');
console.log(`manifest: ${lots.length} lots (${unassigned.length} newly assigned), ${vacant.length} vacant`);
