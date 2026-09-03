// City-owned roads beyond the boulevard, rendered from /city/roads.json in
// the same box-and-emissive language as street.js: asphalt strips, raised
// pavements (0.3 m, walkable), centre dashes, warm lamps, a roundabout with
// an island totem, pedestrian aprons, drop-off bays, zebra crossings,
// freestanding signs and bollards. Static and always resident — it is small.
//
// A lit lamp registers a light SOURCE with the city's light pool (js/lights.js)
// rather than owning a PointLight. The pool lights whichever sources the
// visitor is nearest, so the roads cannot spend the scene's light budget by
// themselves and `light_budget` in roads.json is no longer a hard cap — it is
// the number of lamps that offer to light, and the pool decides which of them
// actually do as you walk. Same contract as the boulevard's own lamps.
import * as THREE from 'three';

const mat = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.92, ...opts });
const emat = (color, intensity, base = 0x0d0a14) =>
  new THREE.MeshStandardMaterial({ color: base, emissive: color, emissiveIntensity: intensity, roughness: 0.7 });

const PAVE_H = 0.3;      // pavement height, same as the boulevard's
const ROAD_TOP = 0.01;   // asphalt top (box at y -0.05, 0.12 thick)

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
  const data = world.roads;
  const g = new THREE.Group();
  g.name = 'roads';
  scene.add(g);
  const colliders = [];
  const interactables = [];
  let lights = 0;
  const sources = [];   // light sources for the city's light pool (js/lights.js)
  if (!data) return { group: g, colliders, interactables, lights, sources };

  const M = {
    asphalt: mat(0x17161c),
    paving: mat(0x24222c, { roughness: 0.85 }),
    dark: mat(0x241f38),
    dash: emat(0xffbf80, 0.5),
    stripe: emat(0xd8dbe8, 0.25, 0x2a2a32),
    head: emat(0xffbf80, 2.5),
    band: emat(0x47f2ff, 1.4),
    totem: mat(0x1b1730, { roughness: 0.8 }),
  };
  let budget = data.light_budget ?? 6;
  const nodes = data.nodes || {};
  const rbs = new Map((data.roundabouts || []).map((r) => [r.at, r]));

  function box(w, h, d, m, x, y, z, ry = 0, collide = false) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    b.position.set(x, y, z);
    b.rotation.y = ry;
    g.add(b);
    if (collide) colliders.push(b);
    return b;
  }
  function lamp(x, z, lit) {
    box(0.14, 3.3, 0.14, M.dark, x, 1.65, z, 0, true);
    box(0.34, 0.14, 0.34, M.head, x, 3.37, z);
    if (lit && budget > 0) {
      sources.push({ position: new THREE.Vector3(x, 3.4, z), color: 0xffbf80, intensity: 40, distance: 26, decay: 2 });
      budget -= 1;
      lights += 1;
    }
  }
  function sign(at, yaw, lines, color) {
    const [x, z] = at;
    box(0.12, 2.4, 0.12, M.dark, x, 1.2, z, 0, true);
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

  // ---- segments ------------------------------------------------------------
  for (const s of data.segments || []) {
    const A = nodes[s.from];
    const B = nodes[s.to];
    if (!A || !B) continue;
    let [ax, az] = A;
    let [bx, bz] = B;
    const L0 = Math.hypot(bx - ax, bz - az) || 1;
    const ux = (bx - ax) / L0;
    const uz = (bz - az) / L0;
    // a segment meeting a roundabout starts at its outer edge, not its centre
    const ra = rbs.get(s.from);
    const rb = rbs.get(s.to);
    if (ra) { ax += ux * ra.outer_r; az += uz * ra.outer_r; }
    if (rb) { bx -= ux * rb.outer_r; bz -= uz * rb.outer_r; }
    const L = Math.hypot(bx - ax, bz - az);
    if (L <= 0.1) continue;
    const cx = (ax + bx) / 2;
    const cz = (az + bz) / 2;
    const ry = Math.atan2(-uz, ux);
    const w = s.width ?? 8;
    const pv = s.pavement ?? 2.5;
    const nx = -uz;
    const nz = ux;
    box(L, 0.12, w, M.asphalt, cx, -0.05, cz, ry, true);
    for (const side of [-1, 1]) {
      const off = (w / 2 + pv / 2) * side;
      box(L, PAVE_H, pv, M.paving, cx + nx * off, 0, cz + nz * off, ry, true);
    }
    if (s.dashes) {
      for (let t = 2.25; t < L - 1; t += 4.5) box(0.9, 0.03, 0.16, M.dash, ax + ux * t, 0.02, az + uz * t, ry);
    }
    if (s.lamps_every) {
      let i = 0;
      for (let t = s.lamps_every / 2; t < L; t += s.lamps_every, i++) {
        const side = i % 2 ? 1 : -1;
        const off = (w / 2 + pv - 0.3) * side;
        lamp(ax + ux * t + nx * off, az + uz * t + nz * off, s.lit);
      }
    }
  }

  // ---- roundabouts ---------------------------------------------------------
  for (const r of data.roundabouts || []) {
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
    const island = new THREE.Mesh(new THREE.CylinderGeometry(ri, ri, PAVE_H, 48), M.paving);
    island.position.set(cx, PAVE_H / 2, cz);
    g.add(island);
    colliders.push(island);
    const planter = new THREE.Mesh(new THREE.CylinderGeometry(ri - 0.8, ri - 0.8, 0.5, 48), M.dark);
    planter.position.set(cx, PAVE_H + 0.25, cz);
    g.add(planter);
    colliders.push(planter);
    // the arms cut the pavement ring; what is left are arcs between them
    const arms = (data.segments || [])
      .filter((s) => s.from === r.at || s.to === r.at)
      .map((s) => {
        const O = nodes[s.from === r.at ? s.to : s.from];
        return {
          ang: Math.atan2(O[1] - cz, O[0] - cx),
          half: Math.asin(Math.min(0.99, ((s.width ?? 8) / 2 + (s.pavement ?? 2.5)) / ro)),
        };
      })
      .sort((a, b) => a.ang - b.ang);
    const arcs = [];
    if (!arms.length) arcs.push([0, Math.PI * 2]);
    for (let i = 0; i < arms.length; i++) {
      const a = arms[i];
      const b = arms[(i + 1) % arms.length];
      const a0 = a.ang + a.half;
      let a1 = b.ang - b.half;
      if (i === arms.length - 1) a1 += Math.PI * 2;
      if (a1 - a0 > 0.05) arcs.push([a0, a1]);
    }
    for (const [a0, a1] of arcs) {
      const band = new THREE.Mesh(bandGeometry(ro, ro + pv, a0, a1, PAVE_H), M.paving);
      band.position.set(cx, 0, cz);
      g.add(band);
      colliders.push(band);
    }
    // Lamps on the pavement ring. A WIDE arc gets two, at thirds, rather than
    // one at its midpoint: the widest arc is the one facing whatever the
    // roundabout serves, so a midpoint lamp lands exactly on the line people
    // walk — a post in the doorway, and at the stadium it was in the spawn.
    const rr = ro + pv - 0.3;
    for (const [a0, a1] of arcs.slice(0, r.lamps ?? 4)) {
      // 1.2 rad ~ 69 deg. Three arms make three ~87 deg arcs here, so a
      // threshold set by eye at 100 deg missed every one of them and put a
      // post back on the axis.
      const angles = a1 - a0 > 1.2 ? [a0 + (a1 - a0) / 3, a1 - (a1 - a0) / 3] : [(a0 + a1) / 2];
      for (const a of angles) lamp(cx + rr * Math.cos(a), cz + rr * Math.sin(a), r.lit);
    }
    if (r.totem) {
      const t = r.totem;
      box(1.2, 7, 1.2, M.totem, cx, PAVE_H + 0.5 + 3.5, cz, 0, true);
      for (const [sx, sz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
        box(0.06, 6.6, 0.06, M.band, cx + sx * 0.62, PAVE_H + 0.5 + 3.5, cz + sz * 0.62);
      }
      box(1.4, 0.12, 1.4, M.band, cx, PAVE_H + 0.5 + 7.05, cz);
      // a board on the face that looks back down the boulevard
      const face = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.5),
        new THREE.MeshBasicMaterial({ map: boardTexture(t.lines || [], t.color || '#2fe0f8') }));
      face.position.set(cx - 0.61, PAVE_H + 0.5 + 5.2, cz);
      face.rotation.y = -Math.PI / 2;
      g.add(face);
    }
  }

  // ---- aprons + bays -------------------------------------------------------
  for (const a of data.aprons || []) {
    const h = a.height ?? PAVE_H;
    box(a.max[0] - a.min[0], h, a.max[1] - a.min[1], M.paving,
      (a.min[0] + a.max[0]) / 2, h / 2, (a.min[1] + a.max[1]) / 2, 0, true);
  }
  for (const b of data.bays || []) {
    const w = b.max[0] - b.min[0];
    const d = b.max[1] - b.min[1];
    const cx = (b.min[0] + b.max[0]) / 2;
    const cz = (b.min[1] + b.max[1]) / 2;
    box(w, 0.12, d, M.asphalt, cx, -0.05, cz, 0, true);
    // kerb on three sides (the side facing the road stays open)
    const openSouth = cz > 0;   // a bay north of the road opens to the south
    box(1.5, PAVE_H, d, M.paving, b.min[0] - 0.75, 0, cz, 0, true);
    box(1.5, PAVE_H, d, M.paving, b.max[0] + 0.75, 0, cz, 0, true);
    box(w + 3, PAVE_H, 1.5, M.paving, cx, 0, openSouth ? b.max[1] + 0.75 : b.min[1] - 0.75, 0, true);
    for (let x = b.min[0] + 1; x < b.max[0]; x += 2) box(1.2, 0.03, 0.16, M.stripe, x, 0.02, cz);
    if (b.label) sign([b.min[0] - 0.75, openSouth ? b.max[1] + 0.75 : b.min[1] - 0.75], openSouth ? Math.PI : 0, [b.label, ''], '#ffbf80');
    lamp(b.max[0] + 0.75, openSouth ? b.max[1] + 0.75 : b.min[1] - 0.75, false);
  }

  // ---- crossings, signs, bollards -----------------------------------------
  for (const c of data.crossings || []) {
    const [x, z] = c.at;
    const along = c.axis === 'z';   // pedestrians walk along z, stripes run along x
    const n = Math.floor(c.span / 1.1);
    for (let i = 0; i < n; i++) {
      const off = -c.span / 2 + 0.55 + i * 1.1;
      if (along) box(c.width, 0.03, 0.5, M.stripe, x, 0.025, z + off);
      else box(0.5, 0.03, c.width, M.stripe, x + off, 0.025, z);
    }
  }
  for (const s of data.signs || []) sign(s.at, s.yaw ?? 0, s.lines || [], s.color || '#2fe0f8');
  for (const [x, z] of data.bollards || []) {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.9, 10), M.dark);
    b.position.set(x, PAVE_H + 0.45, z);
    g.add(b);
    colliders.push(b);
    box(0.28, 0.06, 0.28, M.band, x, PAVE_H + 0.8, z);
  }

  return { group: g, colliders, interactables, lights, sources };
}
