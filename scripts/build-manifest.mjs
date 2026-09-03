// Merge the plat (city/lots.json), the land registry (plots/lots.json) and
// every accepted plot.json into the street manifest the client fetches
// (plots/index.json), ASSIGNING A LOT to any plot that does not have one.
// Without this a submitted plot would merge into the repo and never appear
// in the city.
//
// Allocation rules:
//   * an assignment in the registry is never moved — a plot keeps its address
//     forever, whatever a later plot.json asks for
//   * a new plot that asks for a lot (`lot` in plot.json) gets it when the map
//     affords it and nobody holds it; otherwise it gets the default and the
//     log says so — the dry run told the submitter this rule, and the status
//     endpoint reports the lot it actually got
//   * the default is the nearest free lot to the city centre (map.json
//     `centre`), ties broken by address, so the district fills densely from
//     the middle and distance from the centre keeps its meaning
//   * assignments are written back to the registry, stable and reviewable in
//     git rather than recomputed each build
//   * EVERY unclaimed lot is published as vacant, in default-allocation order:
//     vacant[0] is where the next unrequested claim lands
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { POSTER_DIR, posterUrl, findPoster } from '../lib/poster-paths.mjs';
import { rankFree } from '../public/js/city-map.mjs';

const base = join(new URL('..', import.meta.url).pathname, 'public');
const root = join(base, 'plots');
const registryPath = join(root, 'lots.json');
const registry = JSON.parse(readFileSync(registryPath));
const plat = JSON.parse(readFileSync(join(base, 'city', 'lots.json')));
const centre = plat.centre || [0, 0];

// plots present on disk, deterministic order
const slugs = readdirSync(root)
  .filter((s) => existsSync(join(root, s, 'plot.json')) && existsSync(join(root, s, 'plot.glb')))
  .sort();
const readPlot = (slug) => JSON.parse(readFileSync(join(root, slug, 'plot.json')));

const assigned = { ...(registry.lots || {}) };
for (const slug of Object.keys(assigned)) {
  if (!slugs.includes(slug)) delete assigned[slug]; // plot removed -> free the lot
}
// The registry also FREEZES where each held lot stands (`placed`): the plat
// is regenerated from the map, so a map edit that moved a claimed lot would
// regenerate a plat that agrees with itself — only a record made at the moment
// of assignment can say the lot used to be somewhere else.
const frozen = { ...(registry.placed || {}) };
const same = (a, b) => a && b && a.x === b.x && a.z === b.z && a.yaw === b.yaw;
for (const [slug, id] of Object.entries(assigned)) {
  if (!plat.lots[id]) {
    throw new Error(`registry: ${slug} holds "${id}", which city/lots.json does not afford. ` +
      'A claimed lot never leaves the map: fix map.json (or run `npm run map` if the plat is stale).');
  }
  if (frozen[id] && !same(frozen[id], plat.lots[id])) {
    throw new Error(`registry: ${id} (${slug}) was placed at (${frozen[id].x}, ${frozen[id].z}) and the map now puts it at ` +
      `(${plat.lots[id].x}, ${plat.lots[id].z}). A claimed address never moves: revert the map edit.`);
  }
}
const holder = new Map(Object.entries(assigned).map(([s, id]) => [id, s]));
const dup = [...holder.entries()].filter(([id]) => Object.values(assigned).filter((v) => v === id).length > 1);
if (dup.length) throw new Error(`registry: lot ${dup[0][0]} is held by more than one plot`);

// hand out lots to anything unassigned: what it asked for if it can have it,
// otherwise the nearest free lot to the centre
const notes = [];
for (const slug of slugs.filter((s) => !assigned[s])) {
  const want = readPlot(slug).lot;
  let id;
  if (want && plat.lots[want] && !holder.has(want)) {
    id = want;
    notes.push(`${slug}: ${id} (${plat.lots[id].address}), as requested`);
  } else {
    id = rankFree(plat, holder.keys(), centre)[0]?.id;
    if (!id) throw new Error('no free lot left — extend the map (public/city/map.json)');
    const why = !want ? 'nearest free lot to the centre'
      : !plat.lots[want] ? `requested "${want}" is not a lot this map affords; nearest free lot instead`
        : `requested ${want} is held by ${holder.get(want)}; nearest free lot instead`;
    notes.push(`${slug}: ${id} (${plat.lots[id].address}) — ${why}`);
  }
  assigned[slug] = id;
  holder.set(id, slug);
}

// Posters are rendered from the merged build by scripts/render-posters.mjs
// and published here so a directory can show a plot without downloading it.
// The key is ALWAYS present: null says "this plot has no poster", which a
// consumer can tell apart from a manifest that predates posters entirely.
const posters = existsSync(join(base, POSTER_DIR)) ? readdirSync(join(base, POSTER_DIR)) : [];

const placed = (id) => {
  const L = plat.lots[id];
  return { lot: L.id, address: L.address, road: L.road, n: L.n, x: L.x, z: L.z, yaw: L.yaw };
};
const lots = slugs.map((slug) => {
  const poster = findPoster(slug, posters);
  return {
    ...readPlot(slug),
    ...placed(assigned[slug]),          // the registry's word, whatever plot.json says
    glb: `/plots/${slug}/plot.glb`,
    base: `/plots/${slug}/`,
    poster: poster ? posterUrl(poster) : null,
  };
});
const vacant = rankFree(plat, holder.keys(), centre)
  .map((l) => ({ ...placed(l.id), claim: `https://otra.city/claim?lot=${l.id}` }));

// persist assignments (deterministic key order) so lots never shuffle, and
// freeze the place of every held lot
for (const id of Object.values(assigned)) {
  const L = plat.lots[id];
  frozen[id] = { x: L.x, z: L.z, yaw: L.yaw };
}
for (const id of Object.keys(frozen)) if (!holder.has(id)) delete frozen[id];   // a freed lot may move again
writeFileSync(registryPath, JSON.stringify({
  comment: registry.comment,
  lots: Object.fromEntries(Object.keys(assigned).sort().map((s) => [s, assigned[s]])),
  placed: Object.fromEntries(Object.keys(frozen).sort().map((id) => [id, frozen[id]])),
}, null, 2) + '\n');

writeFileSync(join(root, 'index.json'), JSON.stringify({
  version: '0.6',
  spawn: plat.spawn,
  roads: Object.values(plat.roads).map((r) => ({ id: r.id, name: r.name, lots: r.lots })),
  lots,
  vacant,
}, null, 2) + '\n');
for (const n of notes) console.log(`lot: ${n}`);
console.log(`manifest: ${lots.length} lots (${notes.length} newly assigned), ${vacant.length} vacant of ${Object.keys(plat.lots).length} on ${Object.keys(plat.roads).length} roads`);
