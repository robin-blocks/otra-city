// otra.city ingest validator prototype — deterministic budget checks for a
// submitted plot .glb, driven by poc/plot-spec.json (single source of truth).
// Usage: node poc/validate/validate-shop.mjs <file.glb> [--require-door]
//   --require-door  enforce the shop door-node contract (shops only;
//                   free-form plots — sculpture/garden/building — omit it)
import { NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';
import { readFileSync, statSync } from 'node:fs';

const SPEC = JSON.parse(readFileSync(new URL('../plot-spec.json', import.meta.url)));
const B = SPEC.budgets;
const requireDoor = process.argv.includes('--require-door');
const file = process.argv.filter((a) => !a.startsWith('--'))[2];
if (!file) {
  console.error('usage: validate-shop.mjs <file.glb> [--require-door]');
  process.exit(2);
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.decoder': await draco3d.createDecoderModule(),
});
const doc = await io.read(file);
const root = doc.getRoot();

const checks = [];
const check = (name, ok, detail) => checks.push({ name, ok, detail });

// size
const bytes = statSync(file).size;
check('file size', bytes <= B.max_glb_bytes, `${(bytes / 1024).toFixed(1)} KiB (max ${B.max_glb_bytes / 1024 / 1024} MiB)`);

// triangles + draw calls
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
check('triangles', tris <= B.max_triangles, `${tris} (max ${B.max_triangles}), ${prims} primitives/draw calls`);

// materials
const nMats = root.listMaterials().length;
check('materials', nMats <= B.max_materials, `${nMats} (max ${B.max_materials}): ${root.listMaterials().map((m) => m.getName()).join(', ')}`);

// emissive strength cap
let emisOk = true;
let emisMax = 0;
for (const m of root.listMaterials()) {
  const ext = m.getExtension('KHR_materials_emissive_strength');
  const s = ext ? ext.getEmissiveStrength() : 1;
  emisMax = Math.max(emisMax, s);
  if (s > B.max_emissive_strength) emisOk = false;
}
check('emissive', emisOk, `max strength ${emisMax} (cap ${B.max_emissive_strength})`);

// textures
let texOk = true;
const texDetails = [];
for (const tex of root.listTextures()) {
  const size = tex.getSize();
  const px = size ? Math.max(...size) : Infinity;
  if (px > B.max_texture_px) texOk = false;
  texDetails.push(`${tex.getName() || 'tex'} ${size ? size.join('x') : '??'} ${tex.getMimeType()}`);
}
check('textures', texOk, `${texDetails.join('; ') || 'none'} (max ${B.max_texture_px}px)`);

// external references (must be fully self-contained)
const externalTex = root.listTextures().filter((t) => t.getURI());
const externalBuf = root.listBuffers().filter((b) => b.getURI() && !b.getURI().startsWith('data:'));
check('self-contained', externalTex.length === 0 && externalBuf.length === 0,
  externalTex.length + externalBuf.length === 0 ? 'no external URIs' : 'HAS EXTERNAL URIS');

// extensions whitelist
const used = root.listExtensionsUsed().map((e) => e.extensionName);
const rogue = used.filter((e) => !B.allowed_extensions.includes(e));
check('extensions', rogue.length === 0, used.join(', ') || 'none');

// lights
let nLights = 0;
if (used.includes('KHR_lights_punctual')) {
  for (const node of root.listNodes()) {
    if (node.getExtension('KHR_lights_punctual')) nLights += 1;
  }
}
check('lights', nLights <= B.max_lights, `${nLights} punctual (max ${B.max_lights})`);

// bounding box vs lot envelope
const env = SPEC.envelope;
const scene = root.getDefaultScene() || root.listScenes()[0];
const { min, max } = getBounds(scene);
const e = env.epsilon_m;
const inBox = min.every((v, i) => v >= env.gltf_bbox.min[i] - e) &&
  max.every((v, i) => v <= env.gltf_bbox.max[i] + e);
check('footprint', inBox,
  `min [${min.map((v) => v.toFixed(2))}] max [${max.map((v) => v.toFixed(2))}] within [${env.gltf_bbox.min}]..[${env.gltf_bbox.max}]`);

// door nodes (shop contract; informational for free-form plots)
const names = root.listNodes().map((n) => n.getName());
const hasDoors = SPEC.door_standard.nodes.every((n) => names.includes(n));
check('door nodes', requireDoor ? hasDoors : true,
  hasDoors ? 'door_panel_L/R present' : requireDoor ? `MISSING (nodes: ${names.join(', ')})` : 'absent (free-form plot)');

// report
let failed = 0;
for (const c of checks) {
  if (!c.ok) failed += 1;
  console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name.padEnd(14)} ${c.detail}`);
}
console.log(failed === 0 ? '\nVERDICT: ACCEPTED' : `\nVERDICT: REJECTED (${failed} check(s) failed)`);
process.exit(failed === 0 ? 0 : 1);
