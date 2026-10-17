// How the city grows: when a district runs short of lots, plan the road that
// gives it more, without moving a single address.
//
// The map is authored by hand (public/city/map.json) and the plat is derived
// from it (scripts/build-map.mjs). This module is the one place that EDITS the
// map, and it only ever adds: a road continued from its own far end, or a new
// road out of a roundabout on (or next to) the district that needs room. Every
// candidate is re-platted with the same platLots the city uses and kept only
// if every lot the map already affords comes out at exactly the same place —
// held or vacant — so a growth plan cannot break an address by construction,
// and build-map's own guard is a second lock, not the only one.
//
// A DISTRICT here is a set of categories that land on the same roads, as a
// template listing sees them (custom-only roads excluded): today Gemini Gate
// for the four generative-media categories, Claude Terrace for agents, and so
// on. Its HEADROOM is the free lots on those roads. Districts are emergent: a
// road grown for one takes the same categories as its parent, so "the
// image/video district" is Gemini Gate plus whatever grew out of it.
//
// What it does NOT decide: names are display only (map.json says so), picked
// from `growth.names` and renamed freely in the PR; and nothing here merges —
// .github/workflows/city-growth.yml opens a pull request for a person to look
// at. Auto-merging is a switch to flip once a few proposals have landed
// unchanged.
import {
  roadSegments, platLots, rectsOverlap, discRectOverlap, lotRect, boxRect,
  rankForCategory, servingRoads, LOT_HALF,
} from '../public/js/city-map.mjs';
import { CATEGORIES, categoryOf } from '../public/js/categories.mjs';

export const GROWTH_DEFAULTS = {
  headroom: 2,            // propose a road when a district has this many free lots or fewer
  min_lots: 6,            // a new road worth building gives at least this many
  target_lots: 10,        // ...and more than this buys nothing in the ranking
  lengths: [48, 60, 72, 96],
  clearance: 2,           // metres a new road keeps from anything that is not its junction
  arm_gap_deg: 60,        // a new arm leaves a roundabout at least this far from the others
  stubs: [0, 12, 18],     // how far past a dead end a new roundabout may stand
};

const DIRS = [
  { name: 'east', v: [1, 0] }, { name: 'north', v: [0, 1] },
  { name: 'west', v: [-1, 0] }, { name: 'south', v: [0, -1] },
];

const clone = (o) => JSON.parse(JSON.stringify(o));
const r4 = (v) => Math.round(v * 1e4) / 1e4;
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Growth settings: the defaults, overridden by map.json `growth`. */
export function settings(map) {
  const g = map.growth || {};
  return { ...GROWTH_DEFAULTS, ...Object.fromEntries(Object.entries(g).filter(([k]) => k in GROWTH_DEFAULTS)) };
}

/**
 * The districts as a template listing sees them, with their headroom.
 * `plots` is the manifest's lots (anything with `category` and `lot`);
 * `takenIds` the lot ids held. A category no road serves at all, that nobody
 * has listed under, is left out: there is no demand to plan for, and the first
 * listing in one lands on the nearest free lot and makes it count. Categories
 * with a custom-only road and no template road travel as one district (the
 * boulevard's four), whether or not each has a listing yet.
 */
export function districts(plat, takenIds, plots = []) {
  const taken = new Set(takenIds);
  const demand = {};
  for (const p of plots) if (p.category) demand[p.category] = (demand[p.category] || 0) + 1;
  const groups = new Map();
  for (const c of CATEGORIES) {
    const roads = servingRoads(plat, c.id, { template: true }).sort();
    if (!roads.length && !servingRoads(plat, c.id).length && !demand[c.id]) continue;
    const key = roads.join(',') || `(no road) ${unroutedKey(plat, c.id)}`;
    if (!groups.has(key)) groups.set(key, { roads, categories: [], demand: 0 });
    const g = groups.get(key);
    g.categories.push(c.id);
    g.demand += demand[c.id] || 0;
  }
  return [...groups.values()].filter((g) => g.roads.length || g.demand > 0).map((g) => {
    const free = g.roads.length ? rankForCategory(plat, taken, g.categories[0], [0, 0], { template: true }).length : 0;
    const total = g.roads.reduce((n, r) => n + (plat.roads[r]?.lots.length || 0), 0);
    return { ...g, free, total, held: total - free };
  });
}
// categories with no template road group by the roads that serve them for a
// custom build (the boulevard's four), so they grow as one district
const unroutedKey = (plat, c) => servingRoads(plat, c).sort().join(',');

/** Districts at or under the headroom line, most urgent first. */
export function needs(plat, takenIds, plots, map) {
  const { headroom } = settings(map);
  return districts(plat, takenIds, plots)
    .filter((d) => d.free <= headroom && (d.roads.length || d.demand > 0))
    .sort((a, b) => a.free - b.free || b.demand - a.demand || a.categories[0].localeCompare(b.categories[0]));
}

// ---- candidates -------------------------------------------------------------

const roundaboutAt = (map, node) => (map.roundabouts || []).find((r) => r.at === node);
const isDeadEnd = (map, node) => !roundaboutAt(map, node)
  && (map.roads || []).filter((r) => r.nodes.includes(node)).length === 1
  && (map.roads || []).some((r) => r.nodes.at(-1) === node);

/** The angles (radians) at which existing roads leave a node. */
function armsAt(map, node) {
  return roadSegments(map)
    .filter((s) => s.from === node || s.to === node)
    .map((s) => { const O = s.from === node ? s.b : s.a; const P = map.nodes[node]; return Math.atan2(O[1] - P[1], O[0] - P[0]); });
}
const angGap = (a, b) => { const d = Math.abs(a - b) % (2 * Math.PI); return Math.min(d, 2 * Math.PI - d); };

function newNodeId(map, base) {
  let id = base;
  for (let i = 2; map.nodes[id]; i++) id = `${base}_${i}`;
  return id;
}

/**
 * Every road the district could grow, before anything is checked:
 *   extend   — a serving road continued straight on from its dead end
 *   branch   — a new road out of a roundabout on a serving (or related) road
 *   junction — a roundabout placed on a serving road's dead end, and a road out of it
 */
export function candidates(map, need) {
  const S = settings(map);
  const related = need.roads.length ? need.roads
    : [...new Set(need.categories.flatMap((c) => (map.roads || []).filter((r) => r.categories?.includes(c)).map((r) => r.id)))];
  const roads = (map.roads || []).filter((r) => related.includes(r.id));
  const out = [];
  const anchors = new Set(roads.flatMap((r) => r.nodes));
  for (const node of anchors) {
    const P = map.nodes[node];
    if (roundaboutAt(map, node)) {
      const arms = armsAt(map, node);
      for (const d of DIRS) {
        const a = Math.atan2(d.v[1], d.v[0]);
        if (arms.some((x) => angGap(x, a) < (S.arm_gap_deg * Math.PI) / 180)) continue;
        for (const L of S.lengths) {
          out.push({ kind: 'branch', anchor: node, hub: node, dir: d.name,
            to: [r4(P[0] + d.v[0] * L), r4(P[1] + d.v[1] * L)], L });
        }
      }
    } else if (isDeadEnd(map, node)) {
      // a roundabout at the road's end — or a short stub further on, with no
      // lots on it, when one at the end itself would swallow the last lots
      const road = (map.roads || []).find((r) => r.nodes.at(-1) === node);
      const A = map.nodes[road.nodes.at(-2)];
      const len = Math.hypot(P[0] - A[0], P[1] - A[1]);
      const u = [(P[0] - A[0]) / len, (P[1] - A[1]) / len];
      const back = Math.atan2(-u[1], -u[0]);
      for (const stub of S.stubs) {
        const H = [r4(P[0] + u[0] * stub), r4(P[1] + u[1] * stub)];
        for (const d of DIRS) {
          const a = Math.atan2(d.v[1], d.v[0]);
          if (angGap(back, a) < (S.arm_gap_deg * Math.PI) / 180) continue;
          for (const L of S.lengths) {
            out.push({ kind: 'junction', anchor: node, road: road.id, stub, hubAt: H, dir: d.name,
              to: [r4(H[0] + d.v[0] * L), r4(H[1] + d.v[1] * L)], L });
          }
        }
      }
    }
  }
  // straight on from a serving road's own far end (a custom-only road would not help)
  for (const r of roads) {
    if (!need.roads.includes(r.id)) continue;
    const end = r.nodes.at(-1);
    if (!isDeadEnd(map, end)) continue;
    const A = map.nodes[r.nodes.at(-2)];
    const B = map.nodes[end];
    const len = Math.hypot(B[0] - A[0], B[1] - A[1]);
    const u = [(B[0] - A[0]) / len, (B[1] - A[1]) / len];
    for (const L of S.lengths) {
      out.push({ kind: 'extend', road: r.id, anchor: end, dir: 'on', to: [r4(B[0] + u[0] * L), r4(B[1] + u[1] * L)], L });
    }
  }
  return out;
}

// ---- trial and judgement ----------------------------------------------------

function pickName(map, need, plots) {
  const pool = map.growth?.names || {};
  const used = new Set((map.roads || []).map((r) => r.name));
  const counts = {};
  for (const p of plots) counts[p.category] = (counts[p.category] || 0) + 1;
  const order = need.categories.slice().sort((a, b) => (counts[b] || 0) - (counts[a] || 0) || a.localeCompare(b));
  for (const c of order) {
    for (const entry of pool[c] || []) {
      const [name, sub] = Array.isArray(entry) ? entry : [entry.name, entry.sub];
      if (!used.has(name)) return { name, sub: sub || null };
    }
  }
  const label = categoryOf(order[0])?.label || 'New';
  let name = `${label} Street`;
  for (let i = 2; used.has(name); i++) name = `${label} Street ${i}`;
  return { name, sub: null };
}

/** The map with the candidate built, or null when it cannot be written. */
export function applyCandidate(map, need, c, { name, sub, from_m, date }) {
  const m = clone(map);
  const why = `grown by lib/city-growth.mjs${date ? ` on ${date}` : ''} for ${need.categories.join(', ')} (${need.free} free lot${need.free === 1 ? '' : 's'} left)`;
  if (c.kind === 'extend') {
    const road = m.roads.find((r) => r.id === c.road);
    const id = newNodeId(m, `${c.road}_end`);
    m.nodes[id] = c.to;
    road.nodes.push(id);
    const segs = road.nodes.length - 1;
    const f = road.lots.from_m;
    road.lots.from_m = Array.from({ length: segs }, (_, i) => (Array.isArray(f) ? f[i] : f) ?? from_m);
    road.lots.from_m[segs - 1] = from_m;
    road.comment = `${road.comment ? road.comment + ' ' : ''}Continued ${c.L} m from ${c.anchor}: ${why}.`;
    return { map: m, roadId: road.id, hub: c.anchor };
  }
  let hub = c.anchor;
  if (c.kind === 'junction') {
    const road = m.roads.find((r) => r.id === c.road);
    if (c.stub) {
      hub = newNodeId(m, `${c.road}_end`);
      m.nodes[hub] = c.hubAt;
      road.nodes.push(hub);
      const segs = road.nodes.length - 1;
      const f = road.lots?.from_m;
      if (road.lots) {
        road.lots.from_m = Array.from({ length: segs }, (_, i) => (Array.isArray(f) ? f[i] : f));
        road.lots.from_m[segs - 1] = c.stub + LOT_HALF + 1;   // past its own end: the stub bears no lots
      }
      road.comment = `${road.comment ? road.comment + ' ' : ''}Continued ${c.stub} m to the roundabout at ${hub}: ${why}.`;
    }
    m.roundabouts.push({ id: hub, at: hub, island_r: 3, outer_r: 8, pavement: 2.5, lamps: 4, lit: true });
  }
  const id = newNodeId(m, `${hub}_${c.dir}`);
  m.nodes[id] = c.to;
  const roadId = slug(`${hub}-${c.dir}`);
  if (m.roads.some((r) => r.id === roadId)) return null;
  m.roads.push({
    id: roadId, name, ...(sub ? { sub } : {}), categories: need.categories.slice(),
    kind: 'street', nodes: [hub, id], width: 8, pavement: 2.5, dashes: true, lamps_every: 12, lit: true,
    lots: { sides: ['left', 'right'], from_m },
    comment: `${why}. Its id is positional (it leaves ${hub} heading ${c.dir}) and permanent; rename it freely.`,
  });
  return { map: m, roadId, hub };
}

/**
 * Is the built map sound, and what did it gain? Sound means: the plat still
 * affords every lot it afforded, at the same place; the new road keeps its
 * clearance from every lot, venue, bay, apron, reserved box, sign, bollard,
 * crossing, road and roundabout except the junction it leaves from.
 */
export function judge(base, built, roadId, c, venues, S) {
  let segs;
  try { segs = roadSegments(built.map); } catch (e) { return { ok: false, why: e.message }; }
  const basePlat = platLots(base, venues);
  const plat = platLots(built.map, venues);
  for (const [id, L] of Object.entries(basePlat.lots)) {
    const now = plat.lots[id];
    if (!now) return { ok: false, why: `${id} would disappear` };
    if (now.x !== L.x || now.z !== L.z || now.yaw !== L.yaw) return { ok: false, why: `${id} would move` };
  }
  const hub = built.hub;
  const fresh = segs.filter((s) => s.road.id === roadId && (c.kind !== 'extend' || s.index === s.road.nodes.length - 2));
  const others = roadSegments(base).filter((s) => !(s.from === c.anchor || s.to === c.anchor));
  const nodes = built.map.nodes;
  const discs = (built.map.roundabouts || []).filter((r) => r.at !== hub && r.at !== c.anchor)
    .map((r) => ({ id: r.id, c: nodes[r.at], r: r.outer_r + (r.pavement ?? 2.5) }));
  const boxes = [
    ...(base.aprons || []).map((a) => ({ id: `apron ${a.id}`, ...boxRect(a.min, a.max) })),
    ...(base.bays || []).map((b) => ({ id: `bay ${b.id}`, ...boxRect(b.min, b.max) })),
    ...(base.reserved || []).map((b) => ({ id: `reserved ${b.id || ''}`, ...boxRect(b.min, b.max) })),
    ...venues.map((v) => ({ id: `venue ${v.id}`, ...boxRect(v.bounds.min, v.bounds.max) })),
    ...Object.values(basePlat.lots).map((l) => ({ id: `lot ${l.id}`, ...lotRect(l) })),
  ];
  const points = [
    ...(base.signs || []).map((s) => ({ id: 'a sign', c: s.at })),
    ...(base.bollards || []).map((p) => ({ id: 'a bollard', c: p })),
    ...(base.crossings || []).map((x) => ({ id: 'a crossing', c: x.at })),
  ];
  if (c.kind === 'junction') {
    // the new roundabout itself keeps clear of everything but its own road
    const q = { c: nodes[hub], r: 8 + 2.5 };
    for (const b of boxes) if (!b.id.startsWith('lot ') && discRectOverlap(q.c, q.r, b, S.clearance)) return { ok: false, why: `its roundabout runs into ${b.id}` };
    for (const o of discs) if (Math.hypot(o.c[0] - q.c[0], o.c[1] - q.c[1]) < o.r + q.r + S.clearance) return { ok: false, why: `its roundabout runs into roundabout ${o.id}` };
  }
  for (const s of fresh) {
    // the corridor from the junction's edge to the road's end, widened by the clearance
    const t0 = c.kind === 'extend' ? 0 : s.trimA;
    const len = s.L - t0;
    const R = { c: [s.a[0] + s.ux * (t0 + len / 2), s.a[1] + s.uz * (t0 + len / 2)], ux: s.ux, uz: s.uz, hx: len / 2, hz: s.half };
    for (const o of others) {
      const O = { c: [(o.a[0] + o.b[0]) / 2, (o.a[1] + o.b[1]) / 2], ux: o.ux, uz: o.uz, hx: o.L / 2, hz: o.half };
      if (rectsOverlap(R, O, S.clearance)) return { ok: false, why: `crosses road ${o.road.id}` };
    }
    for (const q of discs) if (discRectOverlap(q.c, q.r, R, S.clearance)) return { ok: false, why: `runs into roundabout ${q.id}` };
    for (const b of boxes) if (rectsOverlap(b, R, S.clearance)) return { ok: false, why: `runs into ${b.id}` };
    for (const p of points) if (discRectOverlap(p.c, 0.5, R, S.clearance)) return { ok: false, why: `runs into ${p.id}` };
  }
  const gained = Object.keys(plat.lots).filter((id) => !basePlat.lots[id]);
  if (gained.length < S.min_lots) return { ok: false, why: `only ${gained.length} lot(s)` };
  return { ok: true, gained, plat };
}

// How many other dead ends this road would stand in front of: a dead end is
// where a road grows next (straight on — the cheapest move there is), so a
// new road across that line takes a district's future to give this one its
// present. Measured as the ray `reach` metres on from each other dead end.
function blocks(map, built, c, reach = 120) {
  const mine = roadSegments(built.map).filter((s) => s.road.id === built.roadId).at(-1);
  if (!mine) return 0;
  const R = { c: [(mine.a[0] + mine.b[0]) / 2, (mine.a[1] + mine.b[1]) / 2], ux: mine.ux, uz: mine.uz, hx: mine.L / 2, hz: mine.half };
  let n = 0;
  for (const road of map.roads || []) {
    const end = road.nodes.at(-1);
    if (end === c.anchor || !isDeadEnd(map, end)) continue;
    const A = map.nodes[road.nodes.at(-2)];
    const B = map.nodes[end];
    const len = Math.hypot(B[0] - A[0], B[1] - A[1]);
    const u = [(B[0] - A[0]) / len, (B[1] - A[1]) / len];
    const ray = { c: [B[0] + u[0] * reach / 2, B[1] + u[1] * reach / 2], ux: u[0], uz: u[1], hx: reach / 2, hz: (road.width ?? 8) / 2 + (road.pavement ?? 2.5) + LOT_HALF * 2 };
    if (rectsOverlap(R, ray, 0)) n += 1;
  }
  return n;
}

/**
 * The best road to grow for one district, or null with the reasons every
 * candidate failed. Ranked: continue a serving road before branching, in
 * nobody else's way before across another road's growth line, nearest
 * to the district before further, enough lots before more lots, shorter before
 * longer, nearer the centre before further — so the same map always gets the
 * same answer.
 */
export function plan(map, need, { venues = [], plots = [], date = null } = {}) {
  const S = settings(map);
  const basePlat = platLots(map, venues);
  const district = Object.values(basePlat.lots).filter((l) => need.roads.includes(l.road));
  const near = district.length ? district
    : Object.values(basePlat.lots).filter((l) => (map.roads || []).some((r) => r.id === l.road && need.categories.some((c) => r.categories?.includes(c))));
  const { name, sub } = pickName(map, need, plots);
  const rejected = [];
  const ok = [];
  const kindRank = { extend: 0, branch: 1, junction: 2 };
  for (const c of candidates(map, need)) {
    let best = null;
    // the first slot's phase: as close to the junction as the plat allows
    for (let f = 12; f <= 32; f += 2) {
      const built = applyCandidate(map, need, c, { name, sub, from_m: f, date });
      if (!built) break;
      const j = judge(map, built, built.roadId, c, venues, S);
      if (!j.ok) { if (!best) best = { ok: false, why: j.why }; if (/crosses|runs into/.test(j.why)) break; continue; }
      if (!best?.ok || j.gained.length > best.gained.length) best = { ...j, built, from_m: f };
    }
    if (!best?.ok) { rejected.push({ ...c, why: best?.why || 'no plat' }); continue; }
    const first = best.gained.map((id) => best.plat.lots[id]);
    const attach = near.length
      ? Math.min(...first.flatMap((a) => near.map((b) => Math.hypot(a.x - b.x, a.z - b.z))))
      : 0;
    const centre = map.centre || [0, 0];
    const from = c.hubAt || map.nodes[c.anchor];
    const mid = [(from[0] + c.to[0]) / 2, (from[1] + c.to[1]) / 2];
    ok.push({ ...c, map: best.built.map, roadId: best.built.roadId, from_m: best.from_m, gained: best.gained,
      blocks: blocks(map, best.built, c),
      attach: Math.round(attach / 10) * 10, centreD: Math.hypot(mid[0] - centre[0], mid[1] - centre[1]), name, sub });
  }
  ok.sort((a, b) => kindRank[a.kind] - kindRank[b.kind] || a.blocks - b.blocks || a.attach - b.attach
    || Math.min(b.gained.length, S.target_lots) - Math.min(a.gained.length, S.target_lots)
    || a.L - b.L || a.centreD - b.centreD || `${a.anchor}${a.dir}`.localeCompare(`${b.anchor}${b.dir}`));
  return { need, best: ok[0] || null, options: ok, rejected };
}

/** One line a person can read about a plan. */
export function describe(p) {
  const n = p.need;
  const where = n.roads.length ? n.roads.join(' + ') : 'no road for a template shop';
  if (!p.best) return `${n.categories.join(', ')} [${where}]: ${n.free} free — NO PLAN (${p.rejected.length} candidates rejected)`;
  const b = p.best;
  const how = b.kind === 'extend' ? `continue ${b.road} ${b.L} m past ${b.anchor}`
    : `${b.kind === 'junction' ? `a roundabout ${b.stub ? b.stub + ' m past ' : 'at '}${b.anchor}'s end and ` : ''}"${b.name}" (${b.roadId}) ${b.L} m ${b.dir}`;
  return `${n.categories.join(', ')} [${where}]: ${n.free} free → ${how}: +${b.gained.length} lots (${b.gained[0]} .. ${b.gained.at(-1)})`;
}

export { LOT_HALF };
