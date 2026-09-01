// otra.city walkability probe — is a submitted plot actually navigable?
// Budget checks prove a plot is cheap; this proves it is enterable.
//
// Method: voxelize the triangle soup into 0.25 m columns over the lot, mark a
// column blocked if anything solid sits in the avatar's body band (above step
// height, below head height), then flood-fill inward from the street edge.
// Reports reachable floor area and, for shops, whether the doorway passes.
//
// Usage: node poc/validate/walkability.mjs <file.glb> [--door]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';
import { readFileSync } from 'node:fs';

const SPEC = JSON.parse(readFileSync(new URL('../plot-spec.json', import.meta.url)));
const A = SPEC.avatar;
const CELL = 0.25;
const N = 40; // 10 m / 0.25
const BAND_LO = A.max_step_height_m + 0.05; // above what you can step onto
const BAND_HI = A.min_headroom_m - 0.2;     // body band, below headroom
const isShop = process.argv.includes('--door');
const file = process.argv.filter((a) => !a.startsWith('--'))[2];
if (!file) {
  console.error('usage: walkability.mjs <file.glb> [--door]');
  process.exit(2);
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.decoder': await draco3d.createDecoderModule(),
});
const doc = await io.read(file);
const root = doc.getRoot();

// --- gather world-space triangles
const xf = (m, p) => [
  m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
  m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
  m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
];

// Door panels are authored closed and slid open by the client at runtime, so
// they must not count as obstacles when probing whether a shop is enterable.
const isDoorPanel = (name) => SPEC.door_standard.nodes.includes(name);

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
    const get = (i) => {
      const j = idxAcc ? idxAcc.getScalar(i) : i;
      return xf(m, pos.getElement(j, [0, 0, 0]));
    };
    for (let i = 0; i + 2 < count; i += 3) tris.push([get(i), get(i + 1), get(i + 2)]);
  }
}

// --- occupancy: conservative AABB rasterization per triangle
const blocked = new Uint8Array(N * N);   // solid in the avatar body band
const floor = new Uint8Array(N * N);     // any solid at/below step height (standable)
const ix = (v) => Math.floor((v + 5) / CELL);
for (const t of tris) {
  const xs = t.map((p) => p[0]);
  const ys = t.map((p) => p[1]);
  const zs = t.map((p) => p[2]);
  const lo = [Math.min(...xs), Math.min(...ys), Math.min(...zs)];
  const hi = [Math.max(...xs), Math.max(...ys), Math.max(...zs)];
  const inBand = hi[1] > BAND_LO && lo[1] < BAND_HI;
  const inFloor = lo[1] <= A.max_step_height_m + 0.02;
  if (!inBand && !inFloor) continue;
  const x0 = Math.max(0, ix(lo[0]));
  const x1 = Math.min(N - 1, ix(hi[0]));
  const z0 = Math.max(0, ix(lo[2]));
  const z1 = Math.min(N - 1, ix(hi[2]));
  for (let x = x0; x <= x1; x++) {
    for (let z = z0; z <= z1; z++) {
      const k = z * N + x;
      if (inBand) blocked[k] = 1;
      if (inFloor) floor[k] = 1;
    }
  }
}

// --- flood fill inward from the street edge (+Z face; door span only for shops)
const seen = new Uint8Array(N * N);
const queue = [];
const doorHalf = SPEC.door_standard.clear_opening_m[0] / 2;
for (let x = 0; x < N; x++) {
  const wx = -5 + (x + 0.5) * CELL;
  if (isShop && Math.abs(wx) > doorHalf) continue;
  const k = (N - 1) * N + x;
  if (!blocked[k]) {
    seen[k] = 1;
    queue.push(k);
  }
}
const seeded = queue.length;
let reached = 0;
while (queue.length) {
  const k = queue.pop();
  reached += 1;
  const x = k % N;
  const z = (k - x) / N;
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = x + dx;
    const nz = z + dz;
    if (nx < 0 || nx >= N || nz < 0 || nz >= N) continue;
    const nk = nz * N + nx;
    if (seen[nk] || blocked[nk]) continue;
    seen[nk] = 1;
    queue.push(nk);
  }
}

// --- deepest penetration from the street, and reachable area that has floor
let deepest = 0;
let supported = 0;
for (let k = 0; k < N * N; k++) {
  if (!seen[k]) continue;
  if (floor[k]) supported += 1;
  const z = Math.floor(k / N);
  deepest = Math.max(deepest, (N - 1 - z) * CELL);
}
const area = supported * CELL * CELL;

const checks = [];
const check = (n, ok, d) => checks.push({ n, ok, d });
check('entry', seeded > 0,
  seeded > 0 ? `${seeded} open cell(s) at the street edge${isShop ? ' within the door span' : ''}`
    : isShop ? 'DOORWAY BLOCKED — nothing can enter' : 'street frontage fully walled off');
check('depth', deepest >= (isShop ? 3.0 : 1.0),
  `reachable ${deepest.toFixed(2)} m in from the street (min ${isShop ? 3.0 : 1.0} m)`);
check('area', area >= (isShop ? 8 : 4),
  `${area.toFixed(1)} m² of supported walkable floor (min ${isShop ? 8 : 4} m²)`);

let failed = 0;
for (const c of checks) {
  if (!c.ok) failed += 1;
  console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.n.padEnd(8)} ${c.d}`);
}

// ASCII map: '.' reachable, '#' blocked, ' ' unreached open space. Street at bottom.
console.log('\nplan view (street at bottom):');
for (let z = 0; z < N; z += 1) {
  let line = '';
  for (let x = 0; x < N; x++) {
    const k = z * N + x;
    line += blocked[k] ? '#' : seen[k] ? '.' : ' ';
  }
  console.log('  ' + line);
}
console.log(failed === 0 ? '\nWALKABILITY: OK' : `\nWALKABILITY: ${failed} issue(s)`);
process.exit(failed === 0 ? 0 : 1);
