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
// It also SEPARATES COINCIDENT SAME-FACING FACES, the other defect that makes a
// plot shimmer: voxel builds are overlapping boxes, so a trim strip or a light
// line laid on a wall routinely shares that wall's exact plane. Two faces at
// the same depth pointing the same way have no winner — the GPU picks per
// fragment and the surface fizzes as you walk. Back-face culling cannot help
// here (both faces are front-facing), so ingest nudges the smaller face 2.5 mm
// along its own normal: the detail stays in front, the fight is over, and the
// shift is far below anything a visitor can see.
//
// Usage: node scripts/normalize-plots.mjs [--write]   (all plots)
//        node scripts/normalize-plots.mjs <file.glb> [--write]
import { NodeIO, Logger } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import draco from 'draco3dgltf';
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { prune } from '@gltf-transform/functions';
import {
  collectFaces, planeGroups, facesOverlap, COINCIDENT_M, SPEC,
} from '../lib/validate-plot.mjs';

const NUDGE_M = 0.0025;   // > Draco's ~0.6 mm quantization step, < anything visible

// invert the rotation/scale part of a node matrix so a world-space direction
// can be applied to local vertex data
function invert3(m) {
  const a = [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]];
  const det = a[0] * (a[4] * a[8] - a[5] * a[7]) - a[1] * (a[3] * a[8] - a[5] * a[6]) +
    a[2] * (a[3] * a[7] - a[4] * a[6]);
  if (Math.abs(det) < 1e-12) return null;
  const inv = [
    (a[4] * a[8] - a[5] * a[7]) / det, (a[2] * a[7] - a[1] * a[8]) / det, (a[1] * a[5] - a[2] * a[4]) / det,
    (a[5] * a[6] - a[3] * a[8]) / det, (a[0] * a[8] - a[2] * a[6]) / det, (a[2] * a[3] - a[0] * a[5]) / det,
    (a[3] * a[7] - a[4] * a[6]) / det, (a[1] * a[6] - a[0] * a[7]) / det, (a[0] * a[4] - a[1] * a[3]) / det,
  ];
  return (v) => [
    inv[0] * v[0] + inv[3] * v[1] + inv[6] * v[2],
    inv[1] * v[0] + inv[4] * v[1] + inv[7] * v[2],
    inv[2] * v[0] + inv[5] * v[1] + inv[8] * v[2],
  ];
}

// Give the listed triangles their own vertices (copied to the end of every
// attribute) and displace them. Copying rather than moving in place is what
// keeps neighbouring faces that share a corner exactly where they were.
function displace(moves) {
  let moved = 0;
  for (const [prim, tris] of moves) {
    const idxAcc = prim.getIndices();
    if (!idxAcc) continue;
    // Always give this primitive private accessors before editing: Blender's
    // exporter happily shares them between primitives, and rewriting one in
    // place silently rewrites another primitive's vertices (which the Draco
    // encoder then walks off the end of).
    for (const sem of prim.listSemantics()) prim.setAttribute(sem, prim.getAttribute(sem).clone());
    prim.setIndices(idxAcc.clone());
    const attrs = prim.listSemantics().map((s) => [s, prim.getAttribute(s)]);
    const idx = Array.from(prim.getIndices().getArray());
    const arrays = new Map(attrs.map(([s, a]) => [s, Array.from(a.getArray())]));
    let vcount = attrs[0][1].getCount();
    for (const [first, disp] of tris) {
      for (let k = 0; k < 3; k++) {
        const src = idx[first + k];
        for (const [s, a] of attrs) {
          const size = a.getElementSize();
          const arr = arrays.get(s);
          for (let c = 0; c < size; c++) arr.push(arr[src * size + c]);
          if (s === 'POSITION') {
            const base = arr.length - size;
            arr[base] += disp[0];
            arr[base + 1] += disp[1];
            arr[base + 2] += disp[2];
          }
        }
        idx[first + k] = vcount;
        vcount += 1;
      }
      moved += 1;
    }
    // Compact: copying corners orphans the vertices they came from, and the
    // Draco encoder walks off the end of a buffer when a primitive carries
    // vertices no triangle references. Reindex to exactly what is used.
    const remap = new Map();
    const compactIdx = idx.map((i) => {
      if (!remap.has(i)) remap.set(i, remap.size);
      return remap.get(i);
    });
    for (const [s, a] of attrs) {
      const size = a.getElementSize();
      const src = arrays.get(s);
      const out = new (a.getArray().constructor)(remap.size * size);
      for (const [oldI, newI] of remap) {
        for (let c = 0; c < size; c++) out[newI * size + c] = src[oldI * size + c];
      }
      a.setArray(out);
    }
    prim.getIndices().setArray(remap.size > 65535 ? new Uint32Array(compactIdx) : new Uint16Array(compactIdx));
  }
  return moved;
}

// Separate every coincident same-facing face by assigning LAYERS. Faces on a
// plane are taken largest first: the wall keeps its position, and anything
// overlapping it moves 2.5 mm along its normal — onto a layer checked to be
// free first. Checking the destination is the whole trick: a blind nudge can
// land a strip exactly on the next surface 2.5 mm away and the two then
// leapfrog on every run. A face already at the lot edge is pushed inward, so
// nothing creeps out of the envelope.
function separateCoincident(doc) {
  const B = SPEC.envelope.gltf_bbox;
  const EDGE = 0.002;
  const moves = new Map();
  let moved = 0;
  for (const { faces, cells } of planeGroups(collectFaces(doc))) {
    const settled = new Map();                    // cell key -> [{ face, d }]
    const blocked = (f, d) => f.cells.some((c) => (settled.get(c) || []).some(
      (s) => Math.abs(s.d - d) <= COINCIDENT_M && facesOverlap(f, s.face)));
    for (const f of faces.slice().sort((a, b) => b.area - a.area)) {
      let d = f.d;
      let step = 0;
      if (blocked(f, d)) {
        const room = (k) => f.v.every((p) => [0, 1, 2].every((i) => {
          const q = p[i] + f.n[i] * k;
          return q <= B.max[i] - EDGE && q >= B.min[i] + EDGE;
        }));
        for (let k = 1; k <= 8 && !step; k++) {
          for (const dir of room(k * NUDGE_M) ? [1, -1] : [-1, 1]) {
            if (!blocked(f, f.d + dir * k * NUDGE_M)) {
              step = dir * k * NUDGE_M;
              d = f.d + step;
              break;
            }
          }
        }
      }
      if (step) {
        const toLocal = invert3(f.node.getWorldMatrix());
        if (toLocal) {
          const disp = toLocal(f.n).map((v) => v * step);
          if (!moves.has(f.prim)) moves.set(f.prim, new Map());
          moves.get(f.prim).set(f.first, disp);
          moved += 1;
        }
      }
      for (const c of f.cells) {
        if (!settled.has(c)) settled.set(c, []);
        settled.get(c).push({ face: f, d });
      }
    }
  }
  displace(moves);
  return { moved };
}

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
  doc.setLogger(new Logger(Logger.Verbosity.ERROR));   // prune is chatty; the summary below is the report
  const fixed = [];
  for (const mat of doc.getRoot().listMaterials()) {
    const blended = mat.getAlphaMode() !== 'OPAQUE';
    if (mat.getDoubleSided() && !blended) {
      mat.setDoubleSided(false);
      fixed.push(mat.getName() || '(unnamed)');
    }
  }
  const slug = file.split('/').slice(-2)[0];
  const { moved } = separateCoincident(doc);
  if (moved) await doc.transform(prune());   // drop the accessors we cloned away from
  if (!fixed.length && !moved) continue;
  changedFiles += 1;
  if (fixed.length) console.log(`  ${slug}: back-face culling enabled on ${fixed.join(', ')}`);
  if (moved) {
    console.log(`  ${slug}: separated ${moved} coincident face(s) by ${NUDGE_M * 1000} mm`);
  }
  if (write) await io.write(file, doc);
}
console.log(changedFiles
  ? `${changedFiles} plot(s) ${write ? 'normalized' : 'need normalizing (pass --write)'}`
  : 'all plots already normalized');
