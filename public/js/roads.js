// Every road in the city, rendered from /city/map.json in one box-and-
// emissive language: asphalt strips, raised pavements (0.3 m, walkable),
// centre dashes, warm lamps, roundabouts with pavement bands and an island
// totem, plazas, bays, zebra crossings, directional signs, bollards, a kerb
// block across every dead end — and a STREET NAME PLATE at every junction and
// road end: the British pattern, a white plate with black capitals on two
// black posts, low enough to read from the pavement.
//
// The boulevard is a road like any other now (street.js draws only the lots),
// so it grows, junctions and takes its lamps from the same rules as the ring
// around the stadium. WHERE things stand is decided in js/city-map.mjs, which
// the map check runs in node: a lamp cannot end up in a spawn point here
// without the check having failed first.
//
// Furniture is instanced (js/geom.js): one draw call per kind of thing,
// however long the road network gets. A lit lamp registers a light SOURCE
// with the city's light pool (js/lights.js) rather than owning a PointLight;
// the pool lights whichever sources the visitor is nearest.
import * as THREE from 'three';
import { roadSegments, roadLamps, roundaboutArcs, roundaboutLamps, bayLamps, namePlates, deadEnds } from '/js/city-map.mjs';
import { createInstancer, mergedQuads } from '/js/geom.js';

const mat = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.92, ...opts });
const emat = (color, intensity, base = 0x0d0a14) =>
  new THREE.MeshStandardMaterial({ color: base, emissive: color, emissiveIntensity: intensity, roughness: 0.7 });

const PAVE_H = 0.3;      // pavement height
const ROAD_TOP = 0.01;   // asphalt top (box at y -0.05, 0.12 thick)
// The island kerb is deliberately TALLER than the avatar's 0.35 m step: a
// 0.3 m kerb let visitors walking the centre line climb onto the island and
// jam against the planter, instead of flowing around it the way a roundabout
// is meant to be walked. Dead-end kerb blocks use the same height.
const ISLAND_H = 0.45;
const PLATE = { w: 1.6, h: 0.3, y: 0.95, post: 1.15, spread: 0.62 };

// Directional boards and the roundabout totem: the city's neon style.
function boardTexture(lines, color) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = '#0d0a14';
  x.fillRect(0, 0, 512, 256);
  x.strokeStyle = color;
  x.lineWidth = 6;
  x.strokeRect(9, 9, 494, 238);
  x.fillStyle = color;
  let px = 64;
  x.font = `700 ${px}px Menlo, monospace`;
  while (x.measureText(lines[0] || '').width > 450 && px > 24) {
    px -= 4;
    x.font = `700 ${px}px Menlo, monospace`;
  }
  x.fillText(lines[0] || '', 30, 110);
  x.fillStyle = '#e9edf6';
  x.font = '28px Menlo, monospace';
  x.fillText(lines[1] || '', 30, 190);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// A street name plate: off-white, a thin black border, the name in black
// capitals in a plain bold face. One texture per road, shared by its plates.
function plateTexture(name, sub) {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 192;
  const x = c.getContext('2d');
  x.fillStyle = '#f1f1ea';
  x.fillRect(0, 0, 1024, 192);
  x.strokeStyle = '#141414';
  x.lineWidth = 8;
  x.strokeRect(16, 16, 992, 160);
  x.fillStyle = '#141414';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  const text = String(name).toUpperCase();
  const face = (px) => `700 ${px}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
  let px = sub ? 88 : 104;
  x.font = face(px);
  while (x.measureText(text).width > 900 && px > 40) {
    px -= 4;
    x.font = face(px);
  }
  x.fillText(text, 512, sub ? 84 : 100);
  // the community the street is named for, the way a plate carries its district
  if (sub) {
    x.font = `500 34px "Helvetica Neue", Helvetica, Arial, sans-serif`;
    x.fillText(String(sub), 512, 146);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// A raised arc band (pavement around a roundabout) with a flat top and walls.
// Non-indexed so normals are flat per face; angles in the xz plane.
function bandGeometry(r0, r1, a0, a1, h) {
  const N = Math.max(4, Math.ceil(((a1 - a0) / (Math.PI * 2)) * 64));
  const P = [];
  const pt = (r, a, y) => [r * Math.cos(a), y, r * Math.sin(a)];
  const tri = (a, b, c) => P.push(...a, ...b, ...c);
  for (let i = 0; i < N; i++) {
    const s = a0 + ((a1 - a0) * i) / N;
    const e = a0 + ((a1 - a0) * (i + 1)) / N;
    const i0 = pt(r0, s, h), o0 = pt(r1, s, h), i1 = pt(r0, e, h), o1 = pt(r1, e, h);
    tri(i0, o1, o0); tri(i0, i1, o1);                                  // top (+y)
    const ob0 = pt(r1, s, 0), ob1 = pt(r1, e, 0);
    tri(ob0, o0, ob1); tri(o0, o1, ob1);                               // outer wall
    const ib0 = pt(r0, s, 0), ib1 = pt(r0, e, 0);
    tri(ib0, ib1, i0); tri(i0, ib1, i1);                               // inner wall
  }
  const cap = (a, flip) => {
    const I0 = pt(r0, a, 0), I1 = pt(r0, a, h), O0 = pt(r1, a, 0), O1 = pt(r1, a, h);
    if (flip) { tri(I0, I1, O0); tri(I1, O1, O0); } else { tri(I0, O0, I1); tri(I1, O0, O1); }
  };
  cap(a0, true);
  cap(a1, false);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.computeVertexNormals();
  return g;
}

export function buildRoads(scene, world) {
  const map = world.map;
  const g = new THREE.Group();
  g.name = 'roads';
  scene.add(g);
  const colliders = [];
  const interactables = [];
  const sources = [];   // light sources for the city's light pool (js/lights.js)
  if (!map) return { group: g, colliders, interactables, sources, lamps: 0, plates: 0 };
  const nodes = map.nodes || {};

  const M = {
    asphalt: mat(0x17161c),
    paving: mat(0x24222c, { roughness: 0.85 }),
    dark: mat(0x241f38),
    dash: emat(0xffbf80, 0.5),
    stripe: emat(0xd8dbe8, 0.25, 0x2a2a32),
    head: emat(0xffbf80, 2.5),
    band: emat(0x47f2ff, 1.4),
    totem: mat(0x1b1730, { roughness: 0.8 }),
    plate: new THREE.MeshStandardMaterial({ color: 0xf1f1ea, roughness: 0.6 }),
    post: new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.8 }),
  };
  const inst = createInstancer(g, colliders);
  const unit = new THREE.BoxGeometry(1, 1, 1);
  inst.kind('asphalt', unit, M.asphalt, { collide: true });
  inst.kind('paving', unit, M.paving, { collide: true });
  inst.kind('kerb', unit, M.paving, { collide: true });
  inst.kind('dash', unit, M.dash);
  inst.kind('stripe', unit, M.stripe);
  inst.kind('lamp_post', unit, M.dark, { collide: true });
  inst.kind('lamp_head', unit, M.head);
  inst.kind('sign_post', unit, M.dark, { collide: true });
  inst.kind('plate_post', unit, M.post, { collide: true });
  inst.kind('plate_body', unit, M.plate, { collide: true });
  inst.kind('bollard', new THREE.CylinderGeometry(1, 1, 1, 10), M.dark, { collide: true });
  inst.kind('bollard_cap', unit, M.band);

  const box = (key, x, y, z, ry, sx, sy, sz) => inst.add(key, { x, y, z, ry, sx, sy, sz });
  const yawOf = (ux, uz) => Math.atan2(-uz, ux);   // rotation.y that aligns local +x with (ux, uz)

  function lamp(l) {
    box('lamp_post', l.x, 1.65, l.z, 0, 0.14, 3.3, 0.14);
    box('lamp_head', l.x, 3.37, l.z, 0, 0.34, 0.14, 0.34);
    if (l.lit) sources.push({ position: new THREE.Vector3(l.x, 3.4, l.z), color: 0xffbf80, intensity: 40, distance: 26, decay: 2 });
  }
  function sign(at, yaw, lines, color) {
    const [x, z] = at;
    box('sign_post', x, 1.2, z, 0, 0.12, 2.4, 0.12);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.8),
      new THREE.MeshBasicMaterial({ map: boardTexture(lines, color) }));
    face.position.set(x, 2.0, z);
    face.rotation.y = yaw;
    g.add(face);
    const back = new THREE.Mesh(new THREE.BoxGeometry(1.68, 0.88, 0.06), M.dark);
    back.position.copy(face.position);
    back.rotation.y = yaw;
    back.translateZ(-0.04);
    g.add(back);
  }

  // ---- roads: every segment of every chain, trimmed at its roundabouts ---
  for (const s of roadSegments(map)) {
    const ax = s.a[0] + s.ux * s.trimA;
    const az = s.a[1] + s.uz * s.trimA;
    const L = s.L - s.trimA - s.trimB;
    if (L <= 0.1) continue;
    const cx = ax + s.ux * (L / 2);
    const cz = az + s.uz * (L / 2);
    const ry = yawOf(s.ux, s.uz);
    const w = s.width;
    const pv = s.pavement;
    box('asphalt', cx, -0.05, cz, ry, L, 0.12, w);
    for (const side of [-1, 1]) {
      const off = (w / 2 + pv / 2) * side;
      box('paving', cx + s.lx * off, PAVE_H / 2, cz + s.lz * off, ry, L, PAVE_H, pv);
    }
    if (s.road.dashes) {
      for (let t = 2.25; t < L - 1; t += 4.5) box('dash', ax + s.ux * t, 0.02, az + s.uz * t, ry, 0.9, 0.03, 0.16);
    }
  }
  const roadLampList = roadLamps(map);
  for (const l of roadLampList) lamp(l);
  // a kerb block across every dead end, taller than a step, with a lit edge:
  // the end of a road is a thing you can see at night, not an invisible wall
  // (the nearest lamp is a pitch away and the block is the pavement's colour)
  for (const e of deadEnds(map)) {
    box('kerb', e.at[0] - e.ux * 0.3, ISLAND_H / 2, e.at[1] - e.uz * 0.3, yawOf(e.ux, e.uz), 0.6, ISLAND_H, e.width);
    box('bollard_cap', e.at[0] - e.ux * 0.3, ISLAND_H + 0.02, e.at[1] - e.uz * 0.3, yawOf(e.ux, e.uz), 0.14, 0.04, e.width - 0.3);
  }

  // ---- roundabouts ---------------------------------------------------------
  let rbLamps = 0;
  for (const r of map.roundabouts || []) {
    const C = nodes[r.at];
    if (!C) continue;
    const [cx, cz] = C;
    const ri = r.island_r;
    const ro = r.outer_r;
    const pv = r.pavement ?? 2.5;
    const ring = new THREE.Mesh(new THREE.RingGeometry(ri, ro, 64), M.asphalt);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(cx, ROAD_TOP + 0.002, cz);   // 2 mm above the arms: no coplanar fight
    g.add(ring);
    colliders.push(ring);
    const island = new THREE.Mesh(new THREE.CylinderGeometry(ri, ri, ISLAND_H, 48), M.paving);
    island.position.set(cx, ISLAND_H / 2, cz);
    g.add(island);
    colliders.push(island);
    const planter = new THREE.Mesh(new THREE.CylinderGeometry(ri - 0.8, ri - 0.8, 0.5, 48), M.dark);
    planter.position.set(cx, ISLAND_H + 0.25, cz);
    g.add(planter);
    colliders.push(planter);
    // the arms cut the pavement ring; what is left are arcs between them
    for (const [a0, a1] of roundaboutArcs(map, r)) {
      const band = new THREE.Mesh(bandGeometry(ro, ro + pv, a0, a1, PAVE_H), M.paving);
      band.position.set(cx, 0, cz);
      g.add(band);
      colliders.push(band);
    }
    for (const l of roundaboutLamps(map, r)) { lamp(l); rbLamps += 1; }
    if (r.totem) {
      const t = r.totem;
      const totem = new THREE.Mesh(new THREE.BoxGeometry(1.2, 7, 1.2), M.totem);
      totem.position.set(cx, ISLAND_H + 0.5 + 3.5, cz);
      g.add(totem);
      colliders.push(totem);
      for (const [sx, sz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
        box('bollard_cap', cx + sx * 0.62, ISLAND_H + 0.5 + 3.5, cz + sz * 0.62, 0, 0.06, 6.6, 0.06);
      }
      box('bollard_cap', cx, ISLAND_H + 0.5 + 7.05, cz, 0, 1.4, 0.12, 1.4);
      // a board on the face that looks back down the boulevard
      const face = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.5),
        new THREE.MeshBasicMaterial({ map: boardTexture(t.lines || [], t.color || '#2fe0f8') }));
      face.position.set(cx - 0.61, ISLAND_H + 0.5 + 5.2, cz);
      face.rotation.y = -Math.PI / 2;
      g.add(face);
    }
  }

  // ---- plazas + bays -------------------------------------------------------
  for (const a of map.aprons || []) {
    const h = a.height ?? PAVE_H;
    box('paving', (a.min[0] + a.max[0]) / 2, h / 2, (a.min[1] + a.max[1]) / 2, 0, a.max[0] - a.min[0], h, a.max[1] - a.min[1]);
  }
  for (const b of map.bays || []) {
    const w = b.max[0] - b.min[0];
    const d = b.max[1] - b.min[1];
    const cx = (b.min[0] + b.max[0]) / 2;
    const cz = (b.min[1] + b.max[1]) / 2;
    box('asphalt', cx, -0.05, cz, 0, w, 0.12, d);
    // kerb on three sides (the side facing the road stays open)
    const openSouth = cz > 0;   // a bay north of the road opens to the south
    box('paving', b.min[0] - 0.75, PAVE_H / 2, cz, 0, 1.5, PAVE_H, d);
    box('paving', b.max[0] + 0.75, PAVE_H / 2, cz, 0, 1.5, PAVE_H, d);
    box('paving', cx, PAVE_H / 2, openSouth ? b.max[1] + 0.75 : b.min[1] - 0.75, 0, w + 3, PAVE_H, 1.5);
    for (let x = b.min[0] + 1; x < b.max[0]; x += 2) box('stripe', x, 0.02, cz, 0, 1.2, 0.03, 0.16);
    if (b.label) sign([b.min[0] - 0.75, openSouth ? b.max[1] + 0.75 : b.min[1] - 0.75], openSouth ? Math.PI : 0, [b.label, ''], '#ffbf80');
  }
  for (const l of bayLamps(map)) lamp(l);   // placed by the shared module, so the map check sees them

  // ---- crossings, directional signs, bollards ----------------------------
  for (const c of map.crossings || []) {
    const [x, z] = c.at;
    const along = c.axis === 'z';   // pedestrians walk along z, stripes run along x
    const n = Math.floor(c.span / 1.1);
    for (let i = 0; i < n; i++) {
      const off = -c.span / 2 + 0.55 + i * 1.1;
      if (along) box('stripe', x, 0.025, z + off, 0, c.width, 0.03, 0.5);
      else box('stripe', x + off, 0.025, z, 0, 0.5, 0.03, c.width);
    }
  }
  for (const s of map.signs || []) sign(s.at, s.yaw ?? 0, s.lines || [], s.color || '#2fe0f8');
  for (const [x, z] of map.bollards || []) {
    box('bollard', x, PAVE_H + 0.45, z, 0, 0.12, 0.9, 0.12);
    box('bollard_cap', x, PAVE_H + 0.8, z, 0, 0.28, 0.06, 0.28);
  }

  // ---- street name plates --------------------------------------------------
  // Two posts, one plate, the name on both faces. Faces are merged per road
  // (one texture, one draw call each); the posts and plate bodies are
  // instanced with everything else.
  const plates = namePlates(map);
  const quadsByRoad = new Map();
  const dummy = new THREE.Object3D();
  for (const p of plates) {
    const yaw = Math.atan2(p.face[0], p.face[1]);   // a plane's +z faces `face`
    const wx = Math.cos(yaw);
    const wz = -Math.sin(yaw);                       // the plate's width axis
    for (const s of [-PLATE.spread, PLATE.spread]) {
      box('plate_post', p.at[0] + wx * s, PLATE.post / 2, p.at[1] + wz * s, yaw, 0.06, PLATE.post, 0.06);
    }
    box('plate_body', p.at[0], PLATE.y, p.at[1], yaw, PLATE.w, PLATE.h, 0.03);
    const list = quadsByRoad.get(p.road) || quadsByRoad.set(p.road, []).get(p.road);
    for (const flip of [0, Math.PI]) {
      dummy.position.set(p.at[0], PLATE.y, p.at[1]);
      dummy.rotation.set(0, yaw + flip, 0);
      dummy.updateMatrix();
      list.push({ matrix: dummy.matrix.clone(), w: PLATE.w, h: PLATE.h, dz: 0.017 });
    }
  }
  for (const [roadId, quads] of quadsByRoad) {
    const road = (map.roads || []).find((r) => r.id === roadId);
    const mesh = new THREE.Mesh(mergedQuads(quads), new THREE.MeshBasicMaterial({ map: plateTexture(road?.name || roadId, road?.sub) }));
    mesh.name = `plates:${roadId}`;
    g.add(mesh);
  }

  inst.flush();
  return { group: g, colliders, interactables, sources, lamps: roadLampList.length + rbLamps, plates: plates.length };
}
