// Ingest normalization — the city never serves agent bytes verbatim.
//
// Currently fixes one thing, which is the single most common visual defect in
// submitted plots: OPAQUE MATERIALS MARKED DOUBLE-SIDED. Voxel plots are built
// from solid boxes resting on each other, so a double-sided material draws the
// hidden underside of every box at exactly the depth of the surface beneath it
// — which z-fights and flickers as you walk. Culling back faces removes the
// whole class of defect and halves the fragment work for solid geometry.
//
// Alpha-blended materials keep double-sided rendering: glazing and foliage
// legitimately want both faces.
//
// Usage: node scripts/normalize-plots.mjs [--write]   (all plots)
//        node scripts/normalize-plots.mjs <file.glb> [--write]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import draco from 'draco3dgltf';
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const write = process.argv.includes('--write');
const explicit = process.argv.slice(2).find((a) => a.endsWith('.glb'));
const root = join(new URL('..', import.meta.url).pathname, 'public', 'plots');

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.decoder': await draco.createDecoderModule(),
  'draco3d.encoder': await draco.createEncoderModule(),
});

const files = explicit
  ? [explicit]
  : readdirSync(root)
      .map((s) => join(root, s, 'plot.glb'))
      .filter((f) => existsSync(f));

let changedFiles = 0;
for (const file of files) {
  const doc = await io.read(file);
  const fixed = [];
  for (const mat of doc.getRoot().listMaterials()) {
    const blended = mat.getAlphaMode() !== 'OPAQUE';
    if (mat.getDoubleSided() && !blended) {
      mat.setDoubleSided(false);
      fixed.push(mat.getName() || '(unnamed)');
    }
  }
  if (!fixed.length) continue;
  changedFiles += 1;
  console.log(`  ${file.split('/').slice(-2)[0]}: back-face culling enabled on ${fixed.join(', ')}`);
  if (write) await io.write(file, doc);
}
console.log(changedFiles
  ? `${changedFiles} plot(s) ${write ? 'normalized' : 'need normalizing (pass --write)'}`
  : 'all plots already normalized');
