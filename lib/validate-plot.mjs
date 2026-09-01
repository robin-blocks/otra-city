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
    anims.every((a) => ['spinner', 'bobber', 'blinker'].includes(a.type) && typeof a.node === 'string'),
    `${anims.length}/${SPEC.animations.max_per_plot} declared`);
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
