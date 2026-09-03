#!/usr/bin/env node
// The map's deterministic check — everything about the map that can be
// asserted without a browser, in under a second. Runs in CI before anything
// renders, and locally as `npm run map:check`.
//
//   * the plat on disk is what map.json says (build-map --check)
//   * every lot has one id, one address, one place; no two lots overlap;
//     every lot's front edge lies on its road's pavement and faces the road
//   * the registry is consistent: every held lot exists, no lot is held twice,
//     the manifest agrees with it, and vacant = every lot nobody holds
//   * the WALKABLE FENCE is continuous along every road, around every
//     roundabout, and from the spawn to the standing point of every lot —
//     sampled every 25 cm, because a 1 m band belonging to no shape once
//     shipped as an invisible wall between the boulevard and the stadium
//   * nothing a visitor is placed at (the spawn, every lot's standing point)
//     is inside a lamp, a plate, a bollard or a board post; and no post the
//     map puts up stands on another post
//
// A failure prints what and where; the numbers are metres.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  LOT_HALF, LOT_SIZE, LOT_YARD, BOARD_LOCAL, lotToWorld, lotRect, rectsOverlap, rectContains, roadSegments,
  fenceShapes, fenceContains, standingPoint, allLamps, namePlates, baySigns, platLots, rankFree,
  PLATE, SIGN, postsOf, plateYaw,
} from '../public/js/city-map.mjs';

const root = new URL('..', import.meta.url).pathname;
const pub = join(root, 'public');
const J = (p) => JSON.parse(readFileSync(join(pub, p), 'utf8'));
const map = J('city/map.json');
const plat = J('city/lots.json');
const registry = J('plots/lots.json');
const manifest = J('plots/index.json');
const venues = existsSync(join(pub, 'venues', 'index.json')) ? J('venues/index.json').venues || [] : [];
const nodes = map.nodes;

let failed = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
  if (!ok) failed += 1;
};
const f1 = (v) => +v.toFixed(2);

// ---- the plat is current ----------------------------------------------------
const bm = spawnSync('node', [join(root, 'scripts', 'build-map.mjs'), '--check'], { encoding: 'utf8' });
check('plat is current (build-map --check)', bm.status === 0, bm.status === 0 ? '' : (bm.stdout + bm.stderr).trim().split('\n').pop());

// ---- lots -------------------------------------------------------------------
const lots = Object.values(plat.lots);
const ids = new Set(lots.map((l) => l.id));
const addresses = new Set(lots.map((l) => l.address));
const places = new Set(lots.map((l) => `${l.x},${l.z}`));
check(`every lot has a unique id, address and place (${lots.length} lots)`,
  ids.size === lots.length && addresses.size === lots.length && places.size === lots.length && lots.every((l) => Object.keys(plat.lots).includes(l.id)));
check('lot ids are url-safe and carry their road', lots.every((l) => /^[a-z][a-z0-9-]*-\d+$/.test(l.id) && l.id === `${l.road}-${l.n}` && plat.roads[l.road]));
{
  const bad = [];
  for (let i = 0; i < lots.length; i++) {
    for (let j = i + 1; j < lots.length; j++) {
      if (rectsOverlap(lotRect(lots[i]), lotRect(lots[j]))) bad.push(`${lots[i].id}/${lots[j].id}`);
    }
  }
  check('no two lots overlap', bad.length === 0, bad.slice(0, 5).join(' '));
}
{
  const segs = roadSegments(map);
  const bad = [];
  for (const l of lots) {
    const mine = segs.filter((s) => s.road.id === l.road);
    // distance from the lot centre to the nearest axis of its road, and which side of it
    let best = null;
    for (const s of mine) {
      const px = l.x - s.a[0];
      const pz = l.z - s.a[1];
      const t = px * s.ux + pz * s.uz;
      if (t < -1 || t > s.L + 1) continue;
      const n = -px * s.uz + pz * s.ux;
      const cand = { d: Math.abs(n), n, s };
      if (!best || cand.d < best.d) best = cand;
    }
    if (!best) { bad.push(`${l.id}: not beside its road`); continue; }
    const want = best.s.half + LOT_HALF;
    // the front (lot-local +z) must point back at the road axis
    const front = lotToWorld(l, 0, 1);
    const fx = front.x - l.x;
    const fz = front.z - l.z;
    const toRoad = -Math.sign(best.n);
    const facing = fx * best.s.lx * toRoad + fz * best.s.lz * toRoad;
    if (Math.abs(best.d - want) > 1e-3) bad.push(`${l.id}: ${f1(best.d)} m off the axis, pavement edge needs ${want}`);
    else if (facing < 0.999) bad.push(`${l.id}: faces away from its road`);
  }
  check('every lot fronts its road: front edge on the pavement, facing it', bad.length === 0, bad.slice(0, 4).join('; '));
}
{
  // the plat's own exclusions, re-derived from the map on disk
  const trace = [];
  const again = platLots(map, venues, trace);
  const same = JSON.stringify(again.lots) === JSON.stringify(plat.lots);
  check(`lots stand clear of roads, roundabouts, plazas, venues (${trace.length} slots given to junctions)`, same,
    same ? trace.map((t) => `${t.id}<-${t.why}`).join(' ') : 're-platting the map gives a different set of lots');
}

// ---- the registry and the manifest ------------------------------------------
{
  const held = Object.entries(registry.lots || {});
  const missing = held.filter(([, id]) => !plat.lots[id]);
  const counts = {};
  for (const [, id] of held) counts[id] = (counts[id] || 0) + 1;
  const twice = Object.entries(counts).filter(([, n]) => n > 1).map(([id]) => id);
  check(`registry: every held lot exists and is held once (${held.length} held)`, missing.length === 0 && twice.length === 0,
    [...missing.map(([s, id]) => `${s} holds unknown ${id}`), ...twice.map((id) => `${id} held twice`)].join('; '));
  const placed = registry.placed || {};
  const frozenOk = held.every(([, id]) => placed[id] && plat.lots[id]
    && placed[id].x === plat.lots[id].x && placed[id].z === plat.lots[id].z && placed[id].yaw === plat.lots[id].yaw);
  check('registry: every held lot is frozen where the plat puts it (a map edit cannot move a claimed lot)', frozenOk,
    frozenOk ? `${held.length} placed` : held.filter(([, id]) => !placed[id]).map(([s, id]) => `${id} (${s}) has no placed record — run npm run manifest`).join('; ')
      || held.filter(([, id]) => placed[id] && plat.lots[id] && (placed[id].x !== plat.lots[id].x || placed[id].z !== plat.lots[id].z)).map(([s, id]) => `${id} (${s}) moved`).join('; '));
  const manLots = manifest.lots || [];
  const agree = manLots.every((l) => registry.lots[l.slug] === l.lot && plat.lots[l.lot]
    && l.x === plat.lots[l.lot].x && l.z === plat.lots[l.lot].z && l.yaw === plat.lots[l.lot].yaw && l.address === plat.lots[l.lot].address);
  check('manifest lots agree with the registry and the plat', agree && manLots.length === held.length,
    agree ? `${manLots.length} of ${held.length}` : manLots.filter((l) => registry.lots[l.slug] !== l.lot).map((l) => l.slug).join(' '));
  const expectVacant = rankFree(plat, held.map(([, id]) => id), plat.centre).map((l) => l.id);
  const gotVacant = (manifest.vacant || []).map((v) => v.lot);
  check(`manifest vacant = every lot nobody holds, nearest to the centre first (${gotVacant.length})`,
    JSON.stringify(expectVacant) === JSON.stringify(gotVacant), `next unrequested claim lands on ${gotVacant[0]}`);
  check('every vacant lot carries a claim url with its id', (manifest.vacant || []).every((v) => v.claim === `https://otra.city/claim?lot=${v.lot}` && v.address));
}

// ---- the fence --------------------------------------------------------------
const shapes = fenceShapes(map, plat, venues);
const inside = (x, z) => fenceContains(shapes, x, z);
function gapsAlong(pts, step = 0.25) {
  const gaps = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / step));
    let run = null;
    for (let k = 0; k <= n; k++) {
      const x = ax + ((bx - ax) * k) / n;
      const z = az + ((bz - az) * k) / n;
      if (inside(x, z)) { if (run) { gaps.push(run); run = null; } continue; }
      if (run) run.to = [f1(x), f1(z)]; else run = { from: [f1(x), f1(z)], to: [f1(x), f1(z)] };
    }
    if (run) gaps.push(run);
  }
  return gaps;
}
const fmtGaps = (g) => g.slice(0, 3).map((q) => `[${q.from}]..[${q.to}]`).join(' ');
{
  const bad = [];
  for (const s of roadSegments(map)) {
    const a = [s.a[0] + s.ux * s.trimA, s.a[1] + s.uz * s.trimA];
    const b = [s.a[0] + s.ux * (s.L - s.trimB), s.a[1] + s.uz * (s.L - s.trimB)];
    for (const off of [0, s.half - 0.5, -(s.half - 0.5)]) {     // the axis and both pavements
      const g = gapsAlong([[a[0] + s.lx * off, a[1] + s.lz * off], [b[0] + s.lx * off, b[1] + s.lz * off]]);
      if (g.length) bad.push(`${s.id}@${off}: ${fmtGaps(g)}`);
    }
  }
  check('fence: every road is continuous end to end, axis and both pavements', bad.length === 0, bad.slice(0, 3).join('; '));
}
{
  const bad = [];
  for (const r of map.roundabouts || []) {
    const [cx, cz] = nodes[r.at];
    const rr = (r.island_r + r.outer_r) / 2;
    const pts = [];
    for (let i = 0; i <= 64; i++) pts.push([cx + rr * Math.cos((i / 64) * Math.PI * 2), cz + rr * Math.sin((i / 64) * Math.PI * 2)]);
    const g = gapsAlong(pts);
    if (g.length) bad.push(`${r.id}: ${fmtGaps(g)}`);
  }
  check('fence: every roundabout can be walked around', bad.length === 0, bad.join('; '));
}
{
  // Dijkstra over the road graph from the spawn to every lot's standing point,
  // sampling the fence along the way. Every junction is a node, so a path is
  // a sequence of road axes plus a step onto the lot's frontage.
  const segs = roadSegments(map);
  const adj = new Map();
  const link = (a, b, w) => { (adj.get(a) || adj.set(a, []).get(a)).push([b, w]); };
  for (const s of segs) { link(s.from, s.to, s.L); link(s.to, s.from, s.L); }
  const footOf = (p) => {   // nearest point on any road axis, and its segment
    let best = null;
    for (const s of segs) {
      const t = Math.max(0, Math.min(s.L, (p[0] - s.a[0]) * s.ux + (p[1] - s.a[1]) * s.uz));
      const q = [s.a[0] + s.ux * t, s.a[1] + s.uz * t];
      const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (!best || d < best.d) best = { d, q, s, t };
    }
    return best;
  };
  const dijkstra = (from) => {
    const dist = new Map([[from, 0]]);
    const prev = new Map();
    const todo = new Set([from]);
    while (todo.size) {
      let u = null;
      for (const n of todo) if (u === null || dist.get(n) < dist.get(u)) u = n;
      todo.delete(u);
      for (const [v, w] of adj.get(u) || []) {
        const d = dist.get(u) + w;
        if (!dist.has(v) || d < dist.get(v)) { dist.set(v, d); prev.set(v, u); todo.add(v); }
      }
    }
    return { dist, prev };
  };
  const spawn = [map.spawn.x, map.spawn.z];
  const sf = footOf(spawn);
  const bad = [];
  let longest = 0;
  for (const l of lots) {
    const sp = standingPoint(l);
    const lf = footOf([sp.x, sp.z]);
    // route: spawn -> its foot -> (segment end nearest the goal, via nodes) -> goal's foot -> standing point -> lot centre
    let bestRoute = null;
    if (sf.s === lf.s) bestRoute = { total: Math.abs(sf.t - lf.t), pts: [spawn, sf.q, lf.q, [sp.x, sp.z], [l.x, l.z]] };
    for (const [n0, t0] of sf.s === lf.s ? [] : [[sf.s.from, sf.t], [sf.s.to, sf.s.L - sf.t]]) {
      const { dist, prev } = dijkstra(n0);
      for (const [n1, t1] of [[lf.s.from, lf.t], [lf.s.to, lf.s.L - lf.t]]) {
        if (!dist.has(n1)) continue;
        const total = t0 + dist.get(n1) + t1;
        if (bestRoute && total >= bestRoute.total) continue;
        const chain = [n1];
        while (prev.has(chain[0])) chain.unshift(prev.get(chain[0]));
        bestRoute = { total, pts: [spawn, sf.q, ...chain.map((n) => nodes[n]), lf.q, [sp.x, sp.z], [l.x, l.z]] };
      }
    }
    if (!bestRoute) { bad.push(`${l.id}: no road route`); continue; }
    longest = Math.max(longest, bestRoute.total);
    const g = gapsAlong(bestRoute.pts);
    if (g.length) bad.push(`${l.id}: ${fmtGaps(g)}`);
  }
  check(`fence: a route from the spawn to every lot's standing point and centre (longest ${f1(longest)} m by road)`, bad.length === 0, bad.slice(0, 3).join('; '));
}

// ---- the way through --------------------------------------------------------
{
  // Two rows of buildings that back onto each other can be WALKED between.
  //
  // A lot carries a yard behind it, and the point of the yard is that a gap
  // between two buildings is a route to the next street rather than a metre of
  // alley and an invisible wall. That only pays off where two yards MEET, so
  // the test is exactly that: for every pair of lots whose backs face each
  // other close enough that their yards should overlap, and that stand
  // opposite rather than merely near, the straight line between their back
  // edges is walkable the whole way. A pair further apart than two yards is
  // not expected to meet and is not tested — how far the rows are is the map's
  // business; whether the ones that should meet do is this file's.
  // LOT_YARD, not `map.lot_yard`: this is the city's promise, and a map that
  // set its own yard shorter would otherwise mark its own homework — the pair
  // test would find no rows close enough to be expected to meet, and both
  // checks would go quiet rather than red. A map may make its yards DEEPER.
  const backOf = (l) => lotToWorld(l, 0, -LOT_HALF);
  {
    const shallow = lots.filter((l) => {
      const p = lotToWorld(l, 0, -LOT_HALF - LOT_YARD + 0.5);
      return !inside(p.x, p.z);
    });
    check(`fence: ${LOT_YARD} m of walkable yard behind every lot (${lots.length})`,
      shallow.length === 0, shallow.slice(0, 3).map((l) => l.id).join(', '));
  }
  const awayOf = (l) => { const a = lotToWorld(l, 0, -LOT_HALF); const b = lotToWorld(l, 0, -LOT_HALF - 1); return [b.x - a.x, b.z - a.z]; };
  const bad = [];
  let pairs = 0;
  for (let i = 0; i < lots.length; i++) for (let j = i + 1; j < lots.length; j++) {
    const A = lots[i];
    const B = lots[j];
    if (A.road === B.road) continue;
    const pa = backOf(A);
    const pb = backOf(B);
    const dx = pb.x - pa.x;
    const dz = pb.z - pa.z;
    const d = Math.hypot(dx, dz);
    if (d > 2 * LOT_YARD || d < 1e-6) continue;
    const na = awayOf(A);
    const nb = awayOf(B);
    if (na[0] * dx + na[1] * dz <= 0) continue;      // B is not behind A
    if (nb[0] * -dx + nb[1] * -dz <= 0) continue;    // nor A behind B
    // opposite, not merely near: the lateral offset has to be inside a lot
    if (Math.abs(-na[1] * dx + na[0] * dz) > LOT_HALF) continue;
    pairs += 1;
    const g = gapsAlong([[pa.x, pa.z], [pb.x, pb.z]]);
    if (g.length) bad.push(`${A.id} <-> ${B.id}: ${fmtGaps(g)}`);
  }
  check(`fence: rows that back onto each other can be walked between (${pairs} pairs within ${2 * LOT_YARD} m)`,
    bad.length === 0, bad.slice(0, 3).join('; '));
}

// ---- nothing stands in anyone's way ----------------------------------------
{
  // A plate or a board is its two posts AND the panel between them, at the
  // dimensions js/city-map.mjs gives the renderer; a directional sign and a
  // bay lamp are placed from map.json too, so they are counted here as well.
  // A group is skipped against itself but not against another of the same road.
  let group = 0;
  const assembly = (spec, what, at, yaw) => {
    const g = group++;
    return [
      ...postsOf(spec, at, yaw).map((q) => ({ what, group: g, x: q.x, z: q.z, r: q.r })),
      { what, group: g, x: at[0], z: at[1], r: spec.w / 2 },
    ];
  };
  const posts = [
    ...allLamps(map).map((l) => ({ what: `lamp ${l.road || l.roundabout || l.bay}`, x: l.x, z: l.z, r: 0.1 })),
    ...namePlates(map).flatMap((p) => assembly(PLATE, `plate ${p.road}`, p.at, plateYaw(p))),
    ...(map.signs || []).flatMap((s) => assembly(SIGN, `sign "${(s.lines || [])[0]}"`, s.at, s.yaw ?? 0)),
    ...baySigns(map).flatMap((s) => assembly(SIGN, `sign "${s.label}"`, s.at, s.yaw)),
    ...(map.bollards || []).map(([x, z]) => ({ what: 'bollard', x, z, r: 0.12 })),
    ...lots.map((l) => { const b = lotToWorld(l, ...BOARD_LOCAL); return { what: `board ${l.id}`, x: b.x, z: b.z, r: 0.1 }; }),
  ];
  {
    // nothing the city puts up may stand on a lot — the lot is the claimant's
    const intruders = [];
    for (const p of posts) {
      if (p.what.startsWith('board')) continue;
      const lot = lots.find((l) => rectContains(lotRect(l), p.x, p.z));
      if (lot) intruders.push(`${p.what} at ${f1(p.x)},${f1(p.z)} stands on ${lot.id}`);
    }
    check('nothing the city puts up stands on a lot', intruders.length === 0, intruders.slice(0, 3).join('; '));
  }
  const AVATAR = 0.28;
  const spots = [{ what: 'spawn', x: map.spawn.x, z: map.spawn.z }, ...lots.map((l) => ({ what: `standing point of ${l.id}`, ...standingPoint(l) }))];
  const bad = [];
  for (const s of spots) {
    for (const p of posts) {
      if (Math.hypot(s.x - p.x, s.z - p.z) < AVATAR + p.r + 0.2) bad.push(`${s.what} is ${f1(Math.hypot(s.x - p.x, s.z - p.z))} m from ${p.what}`);
    }
  }
  check(`spawn and every standing point have an avatar of clearance (${posts.length} posts)`, bad.length === 0, bad.slice(0, 3).join('; '));
  const clash = [];
  for (let i = 0; i < posts.length; i++) {
    for (let j = i + 1; j < posts.length; j++) {
      if (posts[i].group !== undefined && posts[i].group === posts[j].group) continue;   // one assembly's own parts
      const d = Math.hypot(posts[i].x - posts[j].x, posts[i].z - posts[j].z);
      if (d < posts[i].r + posts[j].r + 0.5) clash.push(`${posts[i].what} / ${posts[j].what} ${f1(d)} m`);
    }
  }
  check('no post stands on another post', clash.length === 0, clash.slice(0, 3).join('; '));
  const inFence = posts.filter((p) => !inside(p.x, p.z));
  check('every post stands on walkable ground (so nothing is fenced off behind it)', inFence.length === 0, inFence.slice(0, 3).map((p) => `${p.what} at ${f1(p.x)},${f1(p.z)}`).join('; '));
}

console.log(failed ? `\n${failed} check(s) failed` : '\nmap ok');
process.exit(failed ? 1 : 0);
