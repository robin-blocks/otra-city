// Merge the plat (city/lots.json), the land registry (plots/lots.json) and
// every accepted plot.json into the street manifest the client fetches
// (plots/index.json), ASSIGNING A LOT to any plot that does not have one.
// Without this a submitted plot would merge into the repo and never appear
// in the city.
//
// Allocation rules:
//   * an assignment in the registry is never moved — a plot keeps its address
//     forever, whatever a later plot.json asks for
//   * a new plot lands on a road that serves its `category` (map.json gives
//     every listing road its categories), nearest the centre first — so the
//     streets read as the directory's categories and a visitor walking one
//     sees one kind of thing. A category with no road, or a full one, falls
//     through to the nearest free lot anywhere, and the log says so: that is
//     the signal to give the category a road at the far end of the network
//   * the city's own plots (a url on otra.city — exhibitions, venues, demos)
//     may ask for a lot with `lot` in plot.json and get it when the map
//     affords it and nobody holds it; a listing's request is ignored, because
//     its place is its category — the dry run says so before it commits
//   * the rule itself is ONE function, pickLot in city-map.mjs, shared with the
//     submit API's dry run, so what the report predicted is what happens here
//   * assignments are written back to the registry, stable and reviewable in
//     git rather than recomputed each build
//   * EVERY unclaimed lot is published as vacant, in default-allocation order:
//     vacant[0] is where the next unrequested claim lands
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { POSTER_DIR, posterUrl, findPoster } from '../lib/poster-paths.mjs';
import { rankFree, pickLot } from '../public/js/city-map.mjs';
import { apexHost } from '../lib/submitter-host.mjs';
import { DEFAULT_CATEGORY } from '../public/js/categories.mjs';

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
  const plot = readPlot(slug);
  const want = plot.lot;
  const category = plot.category || DEFAULT_CATEGORY;
  const mayRequest = apexHost(plot.url || '') === 'otra.city';
  const pick = pickLot(plat, holder.keys(), { category, requested: want, mayRequest, centre });
  if (!pick) throw new Error('no free lot left — extend the map (public/city/map.json)');
  const id = pick.id;
  const why = {
    requested: 'as requested',
    category: `${category}: the first free lot on a road serving it`,
    'category-full': `every lot on the roads serving ${category} is held; nearest free lot instead — time to add a road for it`,
    'category-unrouted': `no road serves ${category}; nearest free lot instead — give it a road in map.json`,
    nearest: 'nearest free lot to the centre',
  }[pick.why];
  const ignored = want && pick.why !== 'requested'
    ? (mayRequest ? ` (requested ${want}: ${!plat.lots[want] ? 'not a lot this map affords' : `held by ${holder.get(want)}`})`
      : ` (requested ${want} ignored: a listing is placed by its category)`)
    : '';
  notes.push(`${slug}: ${id} (${plat.lots[id].address}) — ${why}${ignored}`);
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
  version: '0.8',
  spawn: plat.spawn,
  roads: Object.values(plat.roads).map((r) => ({ id: r.id, name: r.name, lots: r.lots,
    ...(r.categories ? { categories: r.categories } : {}) })),
  lots,
  vacant,
}, null, 2) + '\n');
for (const n of notes) console.log(`lot: ${n}`);
console.log(`manifest: ${lots.length} lots (${notes.length} newly assigned), ${vacant.length} vacant of ${Object.keys(plat.lots).length} on ${Object.keys(plat.roads).length} roads`);
