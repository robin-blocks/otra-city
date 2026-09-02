// Shared plot validation — the ONE implementation the API endpoint, CI, and
// the local CLI all call, so "passes locally" always means "passes remotely".
import { NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';
import { readFileSync } from 'node:fs';

export const SPEC = JSON.parse(
  readFileSync(new URL('../public/docs/plot-spec.json', import.meta.url)));

let ioPromise = null;
function getIO() {
  ioPromise ??= (async () => new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'draco3d.decoder': await draco3d.createDecoderModule() }))();
  return ioPromise;
}

export function validateIdentity(plot) {
  const checks = [];
  const check = (name, ok, detail) => checks.push({ name, ok, detail });
  check('slug', typeof plot.slug === 'string' && /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(plot.slug),
    plot.slug ? `"${plot.slug}"` : 'missing (lowercase letters/digits/hyphens, 3-40 chars)');
  check('name', typeof plot.name === 'string' && plot.name.length > 0 && plot.name.length <= 24,
    plot.name ? `"${plot.name}" (${plot.name.length}/24)` : 'missing');
  check('tagline', typeof plot.tagline === 'string' && plot.tagline.length <= 80,
    `${(plot.tagline || '').length}/80 chars`);
  const urlOk = typeof plot.url === 'string' &&
    (/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}([/?#].*)?$/i.test(plot.url) ||
      /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?([/?#].*)?$/i.test(plot.url)); // local test rigs only
  check('url', urlOk, plot.url || 'missing (https URL required)');
  check('type', plot.type === 'shop' || plot.type === 'freeform', String(plot.type));
  check('builder', typeof plot.builder === 'string' && plot.builder.length <= 60, plot.builder || 'missing');
  const anims = plot.anims || [];
  check('anims', Array.isArray(anims) && anims.length <= SPEC.animations.max_per_plot &&
    anims.every((a) => ['spinner', 'bobber', 'blinker', 'pulse', 'ticker'].includes(a.type) && typeof a.node === 'string'),
    `${anims.length}/${SPEC.animations.max_per_plot} declared`);
  return { checks, ok: checks.every((c) => c.ok) };
}

// Manifest media declarations — shape-checked so a typo'd binding fails at
// submission instead of silently doing nothing in the client.
export function validateMediaDecl(plot, bundledNames = []) {
  const checks = [];
  const check = (n, ok, d) => checks.push({ name: n, ok, detail: d });
  const m = plot.media || {};
  const rel = (f) => typeof f === 'string' && /^media\/[a-z0-9._-]+$/i.test(f);
  const bundled = (f) => bundledNames.includes((f || '').split('/').pop());
  const fileOk = (f) => rel(f) && bundled(f);

  if (m.audio !== undefined) {
    check('media.audio', fileOk(m.audio?.file),
      fileOk(m.audio?.file) ? m.audio.file : `file must be "media/<name>" and included in the bundle (got ${m.audio?.file})`);
  }
  const screens = m.screens || [];
  check('media.screens', Array.isArray(screens) && screens.length <= 2 &&
    screens.every((s) => /^screen_[12]$/.test(s?.node) && fileOk(s?.file) && s.file.endsWith('.mp4')),
    `${screens.length}/2 — nodes screen_1/screen_2, bundled .mp4`);
  const pictures = m.pictures || [];
  check('media.pictures', Array.isArray(pictures) && pictures.length <= 6 &&
    pictures.every((p) => /^pic_[1-6]$/.test(p?.node) && fileOk(p?.file) &&
      /\.(png|jpe?g|webp)$/i.test(p.file)),
    `${pictures.length}/6 — nodes pic_1..pic_6, bundled png/jpg/webp`);
  if (m.feed !== undefined) {
    const f = m.feed || {};
    const src = [f.url, f.file].filter(Boolean).length;
    const ok = f.node === 'panel_live' && src === 1 &&
      (!f.url || /^https:\/\//.test(f.url)) &&
      (!f.file || fileOk(f.file)) &&
      (f.interval_s === undefined || f.interval_s >= 60);
    check('media.feed', ok,
      ok ? (f.url || f.file) : 'needs node "panel_live", exactly one of url (https) | file (bundled json), interval_s >= 60');
  }
  return { checks, ok: checks.every((c) => c.ok) };
}

export async function validateGlb(bytes, { requireDoor = false } = {}) {
  const B = SPEC.budgets;
  const io = await getIO();
  const doc = await io.readBinary(new Uint8Array(bytes));
  const root = doc.getRoot();
  const checks = [];
  const check = (name, ok, detail) => checks.push({ name, ok, detail });

  check('file size', bytes.length <= B.max_glb_bytes,
    `${(bytes.length / 1024).toFixed(1)} KiB (max ${B.max_glb_bytes / 1024 / 1024} MiB)`);

  let tris = 0;
  let prims = 0;
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      prims += 1;
      const idx = prim.getIndices();
      const count = idx ? idx.getCount() : prim.getAttribute('POSITION').getCount();
      tris += count / 3;
    }
  }
  check('triangles', tris <= B.max_triangles, `${tris} (max ${B.max_triangles}), ${prims} draw calls`);

  const nMats = root.listMaterials().length;
  check('materials', nMats <= B.max_materials,
    `${nMats} (max ${B.max_materials}): ${root.listMaterials().map((m) => m.getName()).join(', ')}`);

  let emisMax = 0;
  for (const m of root.listMaterials()) {
    const ext = m.getExtension('KHR_materials_emissive_strength');
    emisMax = Math.max(emisMax, ext ? ext.getEmissiveStrength() : 1);
  }
  check('emissive', emisMax <= B.max_emissive_strength, `max strength ${emisMax} (cap ${B.max_emissive_strength})`);

  let texOk = true;
  const texDetails = [];
  for (const tex of root.listTextures()) {
    const size = tex.getSize();
    const px = size ? Math.max(...size) : Infinity;
    if (px > B.max_texture_px) texOk = false;
    texDetails.push(`${tex.getName() || 'tex'} ${size ? size.join('x') : '??'}`);
  }
  check('textures', texOk, `${texDetails.join('; ') || 'none'} (max ${B.max_texture_px}px)`);

  const externalTex = root.listTextures().filter((t) => t.getURI());
  const externalBuf = root.listBuffers().filter((b) => b.getURI() && !b.getURI().startsWith('data:'));
  check('self-contained', externalTex.length + externalBuf.length === 0,
    externalTex.length + externalBuf.length === 0 ? 'no external URIs' : 'HAS EXTERNAL URIS');

  const used = root.listExtensionsUsed().map((e) => e.extensionName);
  const rogue = used.filter((e) => !B.allowed_extensions.includes(e));
  check('extensions', rogue.length === 0, rogue.length ? `banned: ${rogue.join(', ')}` : used.join(', ') || 'none');

  let nLights = 0;
  for (const node of root.listNodes()) {
    if (node.getExtension('KHR_lights_punctual')) nLights += 1;
  }
  check('lights', nLights <= B.max_lights, `${nLights} punctual (max ${B.max_lights})`);

  const env = SPEC.envelope;
  const scene = root.getDefaultScene() || root.listScenes()[0];
  const { min, max } = getBounds(scene);
  const e = env.epsilon_m;
  const inBox = min.every((v, i) => v >= env.gltf_bbox.min[i] - e) &&
    max.every((v, i) => v <= env.gltf_bbox.max[i] + e);
  check('footprint', inBox,
    `min [${min.map((v) => v.toFixed(2))}] max [${max.map((v) => v.toFixed(2))}]`);

  const names = root.listNodes().map((n) => n.getName());
  const hasDoors = SPEC.door_standard.nodes.every((n) => names.includes(n));
  check('door nodes', requireDoor ? hasDoors : true,
    hasDoors ? 'door_panel_L/R present' : requireDoor ? 'MISSING' : 'absent (free-form plot)');

  return { checks, ok: checks.every((c) => c.ok), tris, doc };
}

// Walkability probe: voxelized flood-fill from the street edge.
export async function probeWalkability(bytes, { door = false } = {}) {
  const A = SPEC.avatar;
  const CELL = 0.25;
  const N = 40;
  const BAND_LO = A.max_step_height_m + 0.05;
  const BAND_HI = A.min_headroom_m - 0.2;
  const io = await getIO();
  const doc = await io.readBinary(new Uint8Array(bytes));
  const root = doc.getRoot();
  const isDoorPanel = (name) => SPEC.door_standard.nodes.includes(name);
  const xf = (m, p) => [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
  const tris = [];
  for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (!mesh || isDoorPanel(node.getName())) continue;
    const m = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      if (!pos) continue;
      const idxAcc = prim.getIndices();
      const count = idxAcc ? idxAcc.getCount() : pos.getCount();
      const get = (i) => xf(m, pos.getElement(idxAcc ? idxAcc.getScalar(i) : i, [0, 0, 0]));
      for (let i = 0; i + 2 < count; i += 3) tris.push([get(i), get(i + 1), get(i + 2)]);
    }
  }
  const blocked = new Uint8Array(N * N);
  const floor = new Uint8Array(N * N);
  const ix = (v) => Math.floor((v + 5) / CELL);
  for (const t of tris) {
    const lo = [0, 1, 2].map((a) => Math.min(...t.map((p) => p[a])));
    const hi = [0, 1, 2].map((a) => Math.max(...t.map((p) => p[a])));
    const inBand = hi[1] > BAND_LO && lo[1] < BAND_HI;
    const inFloor = lo[1] <= A.max_step_height_m + 0.02;
    if (!inBand && !inFloor) continue;
    for (let x = Math.max(0, ix(lo[0])); x <= Math.min(N - 1, ix(hi[0])); x++) {
      for (let z = Math.max(0, ix(lo[2])); z <= Math.min(N - 1, ix(hi[2])); z++) {
        if (inBand) blocked[z * N + x] = 1;
        if (inFloor) floor[z * N + x] = 1;
      }
    }
  }
  const seen = new Uint8Array(N * N);
  const queue = [];
  const doorHalf = SPEC.door_standard.clear_opening_m[0] / 2;
  for (let x = 0; x < N; x++) {
    const wx = -5 + (x + 0.5) * CELL;
    if (door && Math.abs(wx) > doorHalf) continue;
    const k = (N - 1) * N + x;
    if (!blocked[k]) {
      seen[k] = 1;
      queue.push(k);
    }
  }
  const seeded = queue.length;
  while (queue.length) {
    const k = queue.pop();
    const x = k % N;
    const z = (k - x) / N;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const nz = z + dz;
      if (nx < 0 || nx >= N || nz < 0 || nz >= N) continue;
      const nk = nz * N + nx;
      if (!seen[nk] && !blocked[nk]) {
        seen[nk] = 1;
        queue.push(nk);
      }
    }
  }
  let deepest = 0;
  let supported = 0;
  for (let k = 0; k < N * N; k++) {
    if (!seen[k]) continue;
    if (floor[k]) supported += 1;
    deepest = Math.max(deepest, (N - 1 - Math.floor(k / N)) * CELL);
  }
  const area = supported * CELL * CELL;
  const checks = [
    { name: 'entry', ok: seeded > 0, detail: `${seeded} open cells at the street edge` },
    { name: 'depth', ok: deepest >= (door ? 3.0 : 1.0), detail: `${deepest.toFixed(2)} m reachable (min ${door ? 3 : 1} m)` },
    { name: 'area', ok: area >= (door ? 8 : 4), detail: `${area.toFixed(1)} m² walkable (min ${door ? 8 : 4} m²)` },
  ];
  return { checks, ok: checks.every((c) => c.ok) };
}

// ---------------------------------------------------------------- surfaces
// Two defects that make a plot look broken but that no other check catches:
//
//   1. COINCIDENT SAME-FACING FACES. Voxel plots are built from overlapping
//      boxes, so a trim strip laid on a wall often shares that wall's exact
//      plane. Two faces at the same depth pointing the same way have no
//      winner: the GPU picks per fragment and the surface shimmers as the
//      camera moves. (Opposite-facing coincident faces are fine — back-face
//      culling hides one of them, which is what normalize-plots enforces.)
//   2. MEDIA NODES WITHOUT FULL UVs. The client swaps a video/canvas/image
//      texture onto pic_*/screen_*/panel_live, so a quad UV-mapped to an
//      atlas cell shows one magnified corner of the feed instead of the feed.
//      A node carrying a `ticker` animation is exempt in u: a marquee is
//      deliberately a moving window onto a wide strip.
const SURF = { coincidentM: 0.001, minAreaM2: 1e-4, minPenetrationM: 0.0005 };

const vsub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const vcross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const vdot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const vlen = (a) => Math.hypot(a[0], a[1], a[2]);
const xform = (m, p) => [
  m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
  m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
  m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
];

// every triangle in world space, with a back-reference for anything that wants
// to edit it (the ingest normalizer does)
export function collectFaces(doc) {
  const faces = [];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const m = node.getWorldMatrix();
    const name = node.getName();
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      if (!pos) continue;
      const blended = prim.getMaterial()?.getAlphaMode() !== 'OPAQUE';
      const idx = prim.getIndices();
      const count = idx ? idx.getCount() : pos.getCount();
      for (let i = 0; i + 2 < count; i += 3) {
        const v = [0, 1, 2].map((k) =>
          xform(m, pos.getElement(idx ? idx.getScalar(i + k) : i + k, [0, 0, 0])));
        const c = vcross(vsub(v[1], v[0]), vsub(v[2], v[0]));
        const l = vlen(c);
        if (l < 1e-12) continue;
        const n = [c[0] / l, c[1] / l, c[2] / l];
        faces.push({ node, prim, first: i, v, n, area: l / 2, name, blended, uid: faces.length });
      }
    }
  }
  return faces;
}

// exact intersection area of two convex polygons (Sutherland-Hodgman)
function clipArea(A, B) {
  let poly = A.slice();
  const s = ((B[1][0] - B[0][0]) * (B[2][1] - B[0][1]) -
    (B[1][1] - B[0][1]) * (B[2][0] - B[0][0])) >= 0 ? 1 : -1;
  for (let i = 0; i < 3 && poly.length; i++) {
    const p0 = B[i];
    const p1 = B[(i + 1) % 3];
    const ex = p1[0] - p0[0];
    const ey = p1[1] - p0[1];
    const inside = (q) => s * ((q[0] - p0[0]) * ey - (q[1] - p0[1]) * ex) <= 0;
    const out = [];
    for (let j = 0; j < poly.length; j++) {
      const cur = poly[j];
      const prev = poly[(j + poly.length - 1) % poly.length];
      if (inside(cur) !== inside(prev)) {
        const d1 = (prev[0] - p0[0]) * ey - (prev[1] - p0[1]) * ex;
        const d2 = (cur[0] - p0[0]) * ey - (cur[1] - p0[1]) * ex;
        const t = d1 / (d1 - d2);
        out.push([prev[0] + t * (cur[0] - prev[0]), prev[1] + t * (cur[1] - prev[1])]);
      }
      if (inside(cur)) out.push(cur);
    }
    poly = out;
  }
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const q = poly[i];
    const r = poly[(i + 1) % poly.length];
    a += q[0] * r[1] - r[0] * q[1];
  }
  return Math.abs(a) / 2;
}

// separating-axis test that requires real penetration, so triangles merely
// sharing an edge (every quad, every voxel seam) are not reported
function penetrates(A, B) {
  for (const T of [A, B]) {
    for (let i = 0; i < 3; i++) {
      const p = T[i];
      const q = T[(i + 1) % 3];
      let ax = [-(q[1] - p[1]), q[0] - p[0]];
      const l = Math.hypot(ax[0], ax[1]);
      if (l < 1e-9) continue;
      ax = [ax[0] / l, ax[1] / l];
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
      for (const v of A) { const s = v[0] * ax[0] + v[1] * ax[1]; a0 = Math.min(a0, s); a1 = Math.max(a1, s); }
      for (const v of B) { const s = v[0] * ax[0] + v[1] * ax[1]; b0 = Math.min(b0, s); b1 = Math.max(b1, s); }
      if (Math.min(a1, b1) - Math.max(a0, b0) < SURF.minPenetrationM) return false;
    }
  }
  return true;
}

// The plane a face lies on: its normal direction, and how far along that normal
// it sits. Faces are "the same plane" when those offsets are within
// COINCIDENT_M — a distance test, not a bucket: Draco's ~0.3 mm position
// rounding would otherwise shuffle faces across bucket edges on every export,
// so a plot could never settle.
export const normalKey = (n) =>
  `${Math.round(n[0] * 1000)},${Math.round(n[1] * 1000)},${Math.round(n[2] * 1000)}`;
export const planeOffset = (f) => vdot(f.n, f.v[0]);
export const COINCIDENT_M = SURF.coincidentM;
export const MIN_FACE_AREA_M2 = SURF.minAreaM2;

// Project same-normal faces into that plane's 2D basis, so overlap is a flat
// polygon question. Sets p2 (corners), bb2 (bounds) and d (offset) per face.
export function projectFaces(list, n) {
  const up = Math.abs(n[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  let e1 = vcross(n, up);
  const l1 = vlen(e1);
  e1 = [e1[0] / l1, e1[1] / l1, e1[2] / l1];
  const e2 = vcross(n, e1);
  for (const f of list) {
    f.p2 = f.v.map((p) => [vdot(p, e1), vdot(p, e2)]);
    f.bb2 = [Math.min(...f.p2.map((q) => q[0])), Math.min(...f.p2.map((q) => q[1])),
      Math.max(...f.p2.map((q) => q[0])), Math.max(...f.p2.map((q) => q[1]))];
    f.d = planeOffset(f);
  }
  return list;
}

// Do two projected faces cover common ground? (Touching along an edge does not
// count — every quad and every voxel seam does that.)
export function facesOverlap(a, b) {
  if (a.bb2[2] < b.bb2[0] || b.bb2[2] < a.bb2[0] ||
    a.bb2[3] < b.bb2[1] || b.bb2[3] < a.bb2[1]) return 0;
  if (!penetrates(a.p2, b.p2)) return 0;
  const area = clipArea(a.p2, b.p2);
  return area < SURF.minAreaM2 ? 0 : area;
}

// Faces sharing a normal, bucketed into a coarse 2D grid so overlap tests stay
// local. Both the check below and the ingest normalizer walk these groups.
export function planeGroups(faces) {
  const CELL = 0.5;
  const byNormal = new Map();
  for (const f of faces) {
    if (f.area < SURF.minAreaM2) continue;
    const k = normalKey(f.n);
    if (!byNormal.has(k)) byNormal.set(k, []);
    byNormal.get(k).push(f);
  }
  const groups = [];
  for (const list of byNormal.values()) {
    if (list.length < 2) continue;
    projectFaces(list, list[0].n);
    const cells = new Map();
    for (const f of list) {
      f.cells = [];
      for (let cx = Math.floor(f.bb2[0] / CELL); cx <= Math.floor(f.bb2[2] / CELL); cx++) {
        for (let cy = Math.floor(f.bb2[1] / CELL); cy <= Math.floor(f.bb2[3] / CELL); cy++) {
          const k = `${cx}:${cy}`;
          if (!cells.has(k)) cells.set(k, []);
          cells.get(k).push(f);
          f.cells.push(k);
        }
      }
    }
    groups.push({ faces: list, cells });
  }
  return groups;
}

// pairs of faces on the same plane, pointing the same way, that actually
// overlap — the geometry that shimmers
export function findCoincidentFaces(doc, faces = null) {
  const all = (faces || collectFaces(doc));
  const pairs = [];
  const seen = new Set();
  for (const { cells } of planeGroups(all)) {
    for (const bucket of cells.values()) {
      const list = bucket.slice().sort((a, b) => a.d - b.d);
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length && list[j].d - list[i].d <= SURF.coincidentM; j++) {
          const A = list[i];
          const B = list[j];
          const pk = A.uid < B.uid ? `${A.uid}_${B.uid}` : `${B.uid}_${A.uid}`;
          if (seen.has(pk)) continue;
          seen.add(pk);
          const area = facesOverlap(A, B);
          if (!area) continue;
          pairs.push({ a: A, b: B, area });
        }
      }
    }
  }
  return pairs;
}

const MEDIA_NODE = /^(pic_[1-6]|screen_[12]|panel_live)$/;

export async function probeSurfaces(bytes, { plot = null } = {}) {
  const io = await getIO();
  const doc = await io.readBinary(new Uint8Array(bytes));
  const pairs = findCoincidentFaces(doc);
  const checks = [];
  const area = pairs.reduce((s, p) => s + p.area, 0);
  const worst = new Map();
  for (const p of pairs) {
    const k = [p.a.name, p.b.name].sort().join(' + ');
    worst.set(k, (worst.get(k) || 0) + p.area);
  }
  const top = [...worst].sort((x, y) => y[1] - x[1]).slice(0, 3)
    .map(([k, v]) => `${k} ${v.toFixed(2)} m²`).join('; ');
  checks.push({
    name: 'coplanar faces',
    ok: pairs.length === 0,
    detail: pairs.length
      ? `${pairs.length} coincident same-facing pairs, ${area.toFixed(2)} m² — these shimmer (${top})`
      : 'none — no surface fights for the same depth',
  });

  const tickers = new Set((plot?.anims || [])
    .filter((a) => a.type === 'ticker').map((a) => a.node));
  const bad = [];
  const seen = [];
  for (const node of doc.getRoot().listNodes()) {
    const name = node.getName();
    const mesh = node.getMesh();
    if (!mesh || !MEDIA_NODE.test(name)) continue;
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const prim of mesh.listPrimitives()) {
      const uv = prim.getAttribute('TEXCOORD_0');
      if (!uv) continue;
      for (let i = 0; i < uv.getCount(); i++) {
        const e = uv.getElement(i, [0, 0]);
        u0 = Math.min(u0, e[0]); u1 = Math.max(u1, e[0]);
        v0 = Math.min(v0, e[1]); v1 = Math.max(v1, e[1]);
      }
    }
    if (!Number.isFinite(u0)) {
      bad.push(`${name} has no UVs`);
      continue;
    }
    seen.push(name);
    const fullV = v0 <= 0.002 && v1 >= 0.998;
    const fullU = u0 <= 0.002 && u1 >= 0.998;
    if (tickers.has(name)) {
      // marquee: a window onto a wide strip, but it must start at u=0 and use
      // the full height, or the scroll reveals letterboxing
      if (!fullV || u0 > 0.002 || u1 - u0 < 0.02) {
        bad.push(`${name} (ticker) u ${u0.toFixed(3)}..${u1.toFixed(3)} v ${v0.toFixed(3)}..${v1.toFixed(3)}`);
      }
    } else if (!fullU || !fullV) {
      bad.push(`${name} u ${u0.toFixed(3)}..${u1.toFixed(3)} v ${v0.toFixed(3)}..${v1.toFixed(3)}`);
    }
  }
  checks.push({
    name: 'media uvs',
    ok: bad.length === 0,
    detail: bad.length
      ? `not full 0..1 (the client maps video/feed/pictures over the whole quad): ${bad.join(', ')}`
      : `${seen.length} media node(s) carry full 0..1 UVs`,
  });

  return { checks, ok: checks.every((c) => c.ok), pairs: pairs.length, area };
}
