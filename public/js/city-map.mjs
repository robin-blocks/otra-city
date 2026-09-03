// The geometry of the map, shared by the browser and by node.
//
// One module answers every "where is it?" question so the two sides cannot
// disagree: the road renderer (js/roads.js) and the walkable fence (js/world.js)
// import it in the browser; the plat (scripts/build-map.mjs), the manifest
// builder (scripts/build-manifest.mjs) and the submit API import the same file
// in node. It depends on nothing — not even three.
//
// Coordinates: metres, x east, z north ON THE PLAN (map.html draws z up),
// y up. The rendered city is that plan's mirror image — three.js's +z points
// at the viewer — so walking east down the boulevard, the +z lots are on your
// right. "Left" and "right" below are the plan's: the sides of a walk drawn
// with z up. A road is a chain of named nodes walked from its first node to
// its last. Every junction is a roundabout, which trims the roads
// that meet it by its outer radius. A LOT is a 10 x 10 m envelope whose
// centre sits one pavement plus five metres off the road axis and whose front
// (+z in the plot's own frame) faces the road; its yaw is the rotation.y the
// client gives the plot container. Lot numbers are ADDRESSES: slot k along
// the chain is number 2k+1 on the left and 2k+2 on the right (or k+1 when only
// one side bears lots), and a slot a junction swallows leaves a gap rather
// than renumbering everything after it. The chain origin is the end that
// never moves — the stadium roundabout for the boulevard — so a road that
// grows at its far end keeps every address it has already handed out.
export const LOT_SIZE = 10;
export const LOT_HALF = LOT_SIZE / 2;
export const LOT_PITCH = 12;
export const BOARD_LOCAL = [3.4, 5.45];   // the info board, in lot metres: beside the frontage, on the pavement

const round = (v) => Math.round(v * 1e4) / 1e4;
// Yaw stays exact: an axis-aligned road gives an exact multiple of PI/2, and a
// rounded yaw tilts the lot by microradians, which was enough for a lot that
// exactly touches its own pavement to count as standing on the road.
const snapYaw = (v) => {
  const q = Math.round(v / (Math.PI / 2));
  const s = q * (Math.PI / 2);
  const y = Math.abs(v - s) < 1e-9 ? s : v;
  return y <= -Math.PI + 1e-9 ? Math.PI : y + 0;   // -PI and -0 read as PI and 0
};
// Two things a millimetre apart are apart: nothing on the map is placed finer.
const EPS = 1e-3;

// Lot-local (lx, lz) -> world, the rotation three.js applies for rotation.y.
export function lotToWorld(lot, lx, lz) {
  const c = Math.cos(lot.yaw);
  const s = Math.sin(lot.yaw);
  return { x: lot.x + lx * c + lz * s, z: lot.z - lx * s + lz * c };
}
// The point `d` metres in front of a lot's centre (positive = toward the road).
export const lotFront = (lot, d) => lotToWorld(lot, 0, d);
// Where a visitor stands to face a lot from the pavement, and the yaw they face.
export function standingPoint(lot, d = 6.7) {
  const p = lotFront(lot, d);
  return { x: p.x, z: p.z, yaw: lot.yaw + Math.PI };
}

// Every road segment: consecutive node pairs of every chain, with the trims
// the roundabouts at either end impose, the chain offset (t0) so a lamp or a
// lot can be indexed along the whole road, and the left normal.
export function roadSegments(map, roadId = null) {
  const nodes = map.nodes || {};
  const rbs = new Map((map.roundabouts || []).map((r) => [r.at, r]));
  const out = [];
  for (const road of map.roads || []) {
    if (roadId && road.id !== roadId) continue;
    const chain = road.nodes || [];
    let t0 = 0;
    for (let i = 0; i + 1 < chain.length; i++) {
      const A = nodes[chain[i]];
      const B = nodes[chain[i + 1]];
      if (!A || !B) throw new Error(`road ${road.id}: unknown node "${A ? chain[i + 1] : chain[i]}"`);
      const L = Math.hypot(B[0] - A[0], B[1] - A[1]);
      if (L < 1) throw new Error(`road ${road.id}: nodes ${chain[i]} and ${chain[i + 1]} coincide`);
      const ux = (B[0] - A[0]) / L;
      const uz = (B[1] - A[1]) / L;
      const ra = rbs.get(chain[i]);
      const rb = rbs.get(chain[i + 1]);
      const width = road.width ?? 8;
      const pavement = road.pavement ?? 2.5;
      const from = road.lots?.from_m;
      out.push({
        road, index: i, id: `${road.id}:${i}`, from: chain[i], to: chain[i + 1],
        a: A, b: B, L, ux, uz, lx: -uz, lz: ux, t0,
        width, pavement, half: width / 2 + pavement,
        trimA: ra ? ra.outer_r : 0, trimB: rb ? rb.outer_r : 0,
        endA: ra ? 'roundabout' : 'end', endB: rb ? 'roundabout' : 'end',
        lotsFrom: Array.isArray(from) ? from[i] : from,
      });
      t0 += L;
    }
  }
  return out;
}

// ---- overlap tests -------------------------------------------------------
// A rect is { c: [x, z], ux, uz, hx, hz }: centre, unit axis, half extents
// along the axis (hx) and along its left normal (hz).
export const boxRect = (min, max) => ({
  c: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2], ux: 1, uz: 0,
  hx: (max[0] - min[0]) / 2, hz: (max[1] - min[1]) / 2,
});
export function rectsOverlap(A, B, margin = 0) {
  const dx = B.c[0] - A.c[0];
  const dz = B.c[1] - A.c[1];
  for (const [ax, az] of [[A.ux, A.uz], [-A.uz, A.ux], [B.ux, B.uz], [-B.uz, B.ux]]) {
    const dist = Math.abs(dx * ax + dz * az);
    const ra = A.hx * Math.abs(A.ux * ax + A.uz * az) + A.hz * Math.abs(-A.uz * ax + A.ux * az);
    const rb = B.hx * Math.abs(B.ux * ax + B.uz * az) + B.hz * Math.abs(-B.uz * ax + B.ux * az);
    if (dist >= ra + rb + margin - EPS) return false;   // a separating axis: touching counts as apart
  }
  return true;
}
export function discRectOverlap(c, r, R, margin = 0) {
  const dx = c[0] - R.c[0];
  const dz = c[1] - R.c[1];
  const t = Math.max(-R.hx, Math.min(R.hx, dx * R.ux + dz * R.uz));
  const n = Math.max(-R.hz, Math.min(R.hz, -dx * R.uz + dz * R.ux));
  const px = R.c[0] + R.ux * t - R.uz * n;
  const pz = R.c[1] + R.uz * t + R.ux * n;
  return Math.hypot(c[0] - px, c[1] - pz) < r + margin - EPS;
}

export function rectContains(R, x, z) {
  const dx = x - R.c[0];
  const dz = z - R.c[1];
  return Math.abs(dx * R.ux + dz * R.uz) <= R.hx && Math.abs(-dx * R.uz + dz * R.ux) <= R.hz;
}
export const lotRect = (lot, margin = 0) => {
  const c = Math.cos(lot.yaw);
  const s = Math.sin(lot.yaw);
  // lot-local x axis in world: (cos, -sin); its left normal is then (sin, cos), the front
  return { c: [lot.x, lot.z], ux: c, uz: -s, hx: LOT_HALF + margin, hz: LOT_HALF + margin };
};

// ---- the plat ------------------------------------------------------------
// Every lot the map affords, deterministically: walk each lot-bearing road,
// lay a slot every pitch from the segment's own phase, put a lot on each
// declared side, and drop any lot that would stand on a road, a roundabout,
// a plaza, a venue, a reserved box or an earlier lot. Corridors are tested
// without margin (a lot's front edge IS the pavement's outer edge); everything
// else keeps `lot_margin` clear.
export function platLots(map, venues = [], trace = null) {
  const nodes = map.nodes || {};
  const M = map.lot_margin ?? 1;
  const segs = roadSegments(map);
  const corridors = segs.map((s) => ({
    c: [(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2], ux: s.ux, uz: s.uz, hx: s.L / 2, hz: s.half,
  }));
  const discs = (map.roundabouts || []).map((r) => ({ c: nodes[r.at], r: r.outer_r + (r.pavement ?? 2.5) }));
  const boxes = [
    ...(map.aprons || []).map((a) => ({ id: `apron ${a.id}`, ...boxRect(a.min, a.max) })),
    ...(map.bays || []).map((b) => ({ id: `bay ${b.id}`, ...boxRect([b.min[0] - 1.5, b.min[1] - 1.5], [b.max[0] + 1.5, b.max[1] + 1.5]) })),
    ...(map.reserved || []).map((b) => ({ id: `reserved ${b.id || b.reason || ''}`, ...boxRect(b.min, b.max) })),
    ...venues.map((v) => ({ id: `venue ${v.id}`, ...boxRect(v.bounds.min, v.bounds.max) })),
  ];
  const lots = {};
  const taken = [];
  // the first thing in the way, or null — `trace` collects them per dropped slot
  const blockedBy = (R) => {
    const i = corridors.findIndex((c) => rectsOverlap(c, R, 0));
    if (i >= 0) return `road ${segs[i].id}`;
    const d = discs.findIndex((q) => discRectOverlap(q.c, q.r, R, M));
    if (d >= 0) return `roundabout ${map.roundabouts[d].id}`;
    const b = boxes.findIndex((q) => rectsOverlap(q, R, M));
    if (b >= 0) return `${boxes[b].id}`;
    const t = taken.findIndex((q) => rectsOverlap(q, R, M));
    if (t >= 0) return `lot ${taken[t].id}`;
    return null;
  };
  const roads = {};
  for (const road of map.roads || []) {
    if (!road.lots) continue;
    const sides = road.lots.sides || ['left', 'right'];
    const pitch = road.lots.pitch ?? map.lot_pitch ?? LOT_PITCH;
    const two = sides.length === 2;
    const ids = [];
    let k = 0;
    for (const s of segs.filter((q) => q.road === road)) {
      const f = s.lotsFrom ?? pitch / 2;
      for (let t = f; t + LOT_HALF <= s.L + 1e-6; t += pitch, k++) {
        for (const side of sides) {
          const sgn = side === 'left' ? 1 : -1;
          const nx = s.lx * sgn;
          const nz = s.lz * sgn;
          const d = s.half + LOT_HALF;
          const cx = s.a[0] + s.ux * t + nx * d;
          const cz = s.a[1] + s.uz * t + nz * d;
          const yaw = Math.atan2(-nx, -nz);   // the front looks back at the road
          const lot = { x: round(cx), z: round(cz), yaw: snapYaw(yaw) };
          const n = two ? (side === 'left' ? 2 * k + 1 : 2 * k + 2) : k + 1;
          const id = `${road.id}-${n}`;
          const R = { id, ...lotRect(lot) };
          const why = blockedBy(R);
          if (why) { if (trace) trace.push({ id, x: lot.x, z: lot.z, why }); continue; }
          lots[id] = { id, road: road.id, n, address: `${n} ${road.name}`, x: lot.x, z: lot.z, yaw: lot.yaw };
          ids.push(id);
          taken.push(R);
        }
      }
    }
    roads[road.id] = { id: road.id, name: road.name, lots: ids,
      ...(road.lots.by_request ? { byRequest: true } : {}) };
  }
  return { roads, lots };
}

// The next lot an unrequested claim gets: nearest free lot to the city's
// centre, ties broken by address so the answer is the same on every machine.
// A road marked `by_request` in the map is still listed and still claimable —
// by asking for one of its lot ids — but it sorts behind every other street,
// so a set-aside road is not what an agent lands on by saying nothing.
export function rankFree(plat, takenIds, centre = [0, 0]) {
  const taken = new Set(takenIds);
  const last = (l) => (plat.roads?.[l.road]?.byRequest ? 1 : 0);
  return Object.values(plat.lots)
    .filter((l) => !taken.has(l.id))
    .map((l) => ({ l, d: Math.hypot(l.x - centre[0], l.z - centre[1]) }))
    .sort((a, b) => last(a.l) - last(b.l) || a.d - b.d
      || a.l.road.localeCompare(b.l.road) || a.l.n - b.l.n)
    .map((e) => e.l);
}

// ---- the walkable fence --------------------------------------------------
// The union of shapes a visitor may stand in. Every shape that joins another
// OVERLAPS it (a corridor runs 3 m into the roundabout it meets, a lot's box
// reaches 1 m past its envelope onto the pavement); two shapes that merely
// meet at a line leave an invisible wall, which is how a 1 m band between the
// boulevard and the stadium road shipped once already. A dead end is walkable
// to the end of its asphalt, where a kerb block (deadEnds) stops you visibly —
// an invisible wall 2 m short of the end of a road is a wall all the same.
export function fenceShapes(map, plat, venues = []) {
  const nodes = map.nodes || {};
  const shapes = [];
  for (const s of roadSegments(map)) {
    shapes.push({ kind: 'obb', id: s.id, a: s.a, b: s.b, half: s.half + 0.5,
      ja: s.endA === 'roundabout' ? 3 : 0, jb: s.endB === 'roundabout' ? 3 : 0 });
  }
  for (const r of map.roundabouts || []) {
    if (nodes[r.at]) shapes.push({ kind: 'disc', id: r.id, c: nodes[r.at], r: r.outer_r + (r.pavement ?? 2.5) + 0.5 });
  }
  for (const a of map.aprons || []) {
    shapes.push({ kind: 'box', id: a.id, min: [a.min[0] - 0.5, a.min[1] - 0.5], max: [a.max[0] + 0.5, a.max[1] + 0.5] });
  }
  // a bay's 1.5 m kerbs are pavement: walkable, and where its lamp stands
  for (const b of map.bays || []) {
    shapes.push({ kind: 'box', id: b.id, min: [b.min[0] - 2, b.min[1] - 2], max: [b.max[0] + 2, b.max[1] + 2] });
  }
  for (const lot of Object.values(plat?.lots || {})) {
    const A = lotToWorld(lot, -LOT_HALF, 0);
    const B = lotToWorld(lot, LOT_HALF, 0);
    shapes.push({ kind: 'obb', id: `lot:${lot.id}`, a: [A.x, A.z], b: [B.x, B.z], half: LOT_HALF + 1, ja: 1, jb: 1 });
  }
  for (const v of venues) shapes.push({ kind: 'box', id: `venue:${v.id}`, min: v.bounds.min, max: v.bounds.max });
  return shapes;
}

export function shapeContains(s, x, z) {
  if (s.kind === 'box') return x >= s.min[0] && x <= s.max[0] && z >= s.min[1] && z <= s.max[1];
  if (s.kind === 'disc') return Math.hypot(x - s.c[0], z - s.c[1]) <= s.r;
  const dx = s.b[0] - s.a[0];
  const dz = s.b[1] - s.a[1];
  const L = Math.hypot(dx, dz) || 1;
  const ux = dx / L;
  const uz = dz / L;
  const px = x - s.a[0];
  const pz = z - s.a[1];
  const t = px * ux + pz * uz;
  const n = -px * uz + pz * ux;
  return t >= -(s.ja ?? 0.5) && t <= L + (s.jb ?? 0.5) && Math.abs(n) <= s.half;
}
export const fenceContains = (shapes, x, z) => shapes.some((s) => shapeContains(s, x, z));

// How far the world reaches from the origin, over every shape — sizes the
// ground plane and the far plane.
export function fenceReach(shapes) {
  return shapes.reduce((m, s) => Math.max(m,
    s.kind === 'disc' ? Math.hypot(s.c[0], s.c[1]) + s.r
      : s.kind === 'obb' ? Math.max(Math.hypot(...s.a), Math.hypot(...s.b)) + s.half + Math.max(s.ja ?? 0, s.jb ?? 0)
        : Math.max(Math.abs(s.min[0]), Math.abs(s.max[0]), Math.abs(s.min[1]), Math.abs(s.max[1]))), 0);
}

// ---- furniture placement -------------------------------------------------
// Where lamps and name plates stand is decided HERE, not in the renderer, so
// the map check can assert nothing spawns inside a post without a browser.
//
// A lamp stands MIDWAY BETWEEN LOT SLOTS, so the lot boards (3.4 m off a
// lot's centre) are always 2.6 m from the nearest post, and a road without
// lots spaces them from half a pitch in. Kerbs alternate by the lamp's index
// along the whole ROAD, counting every candidate position including the ones
// a junction swallows: alternating from a trimmed start, or from the placed
// lamps only, would flip every lamp downstream to the other kerb the day a
// roundabout grows or the road is extended. Even k is the right kerb, which
// reproduces the boulevard's launch lamps post for post. A lamp keeps 4 m
// clear of a trimmed end so it never stands in a junction or on a road end.
export function roadLamps(map) {
  const out = [];
  let road = null;
  let k = 0;
  for (const s of roadSegments(map)) {
    if (s.road !== road) { road = s.road; k = 0; }
    const every = road.lamps_every;
    if (!every) continue;
    const pitch = road.lots?.pitch ?? map.lot_pitch ?? LOT_PITCH;
    const phase = ((s.lotsFrom ?? pitch / 2) + pitch / 2) % every;
    for (let t = phase; t <= s.L + 1e-6; t += every, k++) {
      if (t < s.trimA + 4 || t > s.L - s.trimB - 4) continue;
      const off = (s.half - 0.3) * (k % 2 ? 1 : -1);   // + is the left kerb
      out.push({ road: road.id, k, x: s.a[0] + s.ux * t + s.lx * off, z: s.a[1] + s.uz * t + s.lz * off, lit: !!road.lit });
    }
  }
  return out;
}

// The arms a roundabout's roads cut out of its pavement ring, and what is left.
export function roundaboutArms(map, r) {
  const [cx, cz] = map.nodes[r.at];
  return roadSegments(map)
    .filter((s) => s.from === r.at || s.to === r.at)
    .map((s) => {
      const O = s.from === r.at ? s.b : s.a;
      return { ang: Math.atan2(O[1] - cz, O[0] - cx), half: Math.asin(Math.min(0.99, s.half / r.outer_r)), road: s.road.id };
    })
    .sort((a, b) => a.ang - b.ang);
}
export function roundaboutArcs(map, r) {
  const arms = roundaboutArms(map, r);
  if (!arms.length) return [[0, Math.PI * 2]];
  const arcs = [];
  for (let i = 0; i < arms.length; i++) {
    const a = arms[i];
    const b = arms[(i + 1) % arms.length];
    const a0 = a.ang + a.half;
    let a1 = b.ang - b.half;
    if (i === arms.length - 1) a1 += Math.PI * 2;
    if (a1 - a0 > 0.05) arcs.push([a0, a1]);
  }
  return arcs;
}
// Lamps on the pavement ring. A WIDE arc gets two, at thirds, rather than one
// at its midpoint: the widest arc faces whatever the roundabout serves, so a
// midpoint lamp lands exactly on the line people walk — at the stadium it
// stood in the spawn. 1.2 rad ~ 69 deg.
export function roundaboutLamps(map, r) {
  const [cx, cz] = map.nodes[r.at];
  const rr = r.outer_r + (r.pavement ?? 2.5) - 0.3;
  const out = [];
  for (const [a0, a1] of roundaboutArcs(map, r).slice(0, r.lamps ?? 4)) {
    const angles = a1 - a0 > 1.2 ? [a0 + (a1 - a0) / 3, a1 - (a1 - a0) / 3] : [(a0 + a1) / 2];
    for (const a of angles) out.push({ roundabout: r.id, x: cx + rr * Math.cos(a), z: cz + rr * Math.sin(a), lit: !!r.lit });
  }
  return out;
}
// A bay opens toward the road it hangs off: `open` in map.json ('n' | 's'),
// or, unsaid, toward z = 0. Its label and its unlit lamp stand on the far
// kerb. One decision, used by the renderer and the check alike.
export const bayOpensSouth = (b) => (b.open ? b.open === 's' : (b.min[1] + b.max[1]) / 2 > 0);
export const bayFarZ = (b) => (bayOpensSouth(b) ? b.max[1] + 0.75 : b.min[1] - 0.75);
export const bayLamps = (map) => (map.bays || []).map((b) => ({ bay: b.id, x: b.max[0] + 0.75, z: bayFarZ(b), lit: false }));
export const baySigns = (map) => (map.bays || []).filter((b) => b.label)
  .map((b) => ({ bay: b.id, label: b.label, at: [b.min[0] - 0.75, bayFarZ(b)], yaw: bayOpensSouth(b) ? Math.PI : 0 }));
export const allLamps = (map) => [...roadLamps(map), ...(map.roundabouts || []).flatMap((r) => roundaboutLamps(map, r)), ...bayLamps(map)];

// A name plate at both ends of every segment of a named road, on the left
// pavement just inside the trim, facing whoever is arriving: the roundabout
// it meets, or, at a dead end, back down the road. A short stub (a close
// with a bay at its end) gets one, at the junction. A LONG segment also gets
// repeaters, so a visitor between the ends can read where they are — the
// boulevard's two end plates were 30 m from the spawn. A repeater stands
// where a lamp stands on the OTHER kerb (the even-k lamps are all on the
// right), so the two never share a pavement, and it is on a lot boundary,
// never in front of a lot's centre where /lot/<id> puts a visitor.
export function namePlates(map) {
  const out = [];
  const lamps = roadLamps(map);
  for (const s of roadSegments(map)) {
    if (!s.road.name) continue;
    const at = (t) => [s.a[0] + s.ux * t + s.lx * (s.half - 0.9), s.a[1] + s.uz * t + s.lz * (s.half - 0.9)];
    const u = [s.ux, s.uz];
    const back = [-s.ux, -s.uz];
    const tA = s.trimA + (s.endA === 'roundabout' ? 1.5 : 2);
    const tB = s.L - s.trimB - (s.endB === 'roundabout' ? 1.5 : 2);
    out.push({ road: s.road.id, segment: s.id, kind: 'end', at: at(tA), face: s.endA === 'roundabout' ? back : u });
    if (tB - tA < 20) continue;
    out.push({ road: s.road.id, segment: s.id, kind: 'end', at: at(tB), face: s.endB === 'roundabout' ? u : back });
    if (tB - tA <= 70) continue;
    for (const l of lamps) {
      if (l.road !== s.road.id || l.k % 2) continue;                       // right-kerb lamps only
      const t = (l.x - s.a[0]) * s.ux + (l.z - s.a[1]) * s.uz;
      const n = -(l.x - s.a[0]) * s.uz + (l.z - s.a[1]) * s.ux;
      if (t < 0 || t > s.L || Math.abs(n + (s.half - 0.3)) > 0.05) continue;   // this segment's lamp
      if (t - tA < 20 || tB - t < 20) continue;
      out.push({ road: s.road.id, segment: s.id, kind: 'repeater', at: at(t), face: u });
    }
  }
  return out;
}

// A road end that is not a junction and does not run into a bay or a plaza:
// the renderer closes it with a kerb block taller than an avatar's step.
export function deadEnds(map) {
  const boxes = [...(map.bays || []), ...(map.aprons || [])];
  const covered = (p) => boxes.some((b) => p[0] >= b.min[0] - 0.5 && p[0] <= b.max[0] + 0.5 && p[1] >= b.min[1] - 0.5 && p[1] <= b.max[1] + 0.5);
  const out = [];
  for (const s of roadSegments(map)) {
    if (s.endA === 'end' && !covered(s.a)) out.push({ segment: s.id, at: s.a, ux: -s.ux, uz: -s.uz, width: s.width + 2 * s.pavement });
    if (s.endB === 'end' && !covered(s.b)) out.push({ segment: s.id, at: s.b, ux: s.ux, uz: s.uz, width: s.width + 2 * s.pavement });
  }
  return out;
}
