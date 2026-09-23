// Check the SHIPPED mesh, not just the Blender source: Draco and UV export
// must preserve the board aspects, facing, and both halfway-line name boards.
//   node --test scripts/stadium-hoardings-check.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';
import { Matrix4, Vector3 } from 'three';

const file = (path) => new URL(`../${path}`, import.meta.url);
const atlas = JSON.parse(readFileSync(file('poc/stadium/hoardings_map.json')));
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'draco3d.decoder': await draco3d.createDecoderModule() });
const doc = await io.read(file('public/venues/stadium/venue.glb').pathname);
const node = doc.getRoot().listNodes().find((n) => n.getName() === 'stadium_hoardings');
const mesh = node?.getMesh();
assert.ok(mesh, 'rebuilt asset contains stadium_hoardings');
const transform = new Matrix4().fromArray(node.getWorldMatrix());
const prim = mesh.listPrimitives()[0];
const material = prim.getMaterial();
const pos = prim.getAttribute('POSITION');
const uv = prim.getAttribute('TEXCOORD_0');
const idx = prim.getIndices().getArray();
const point = (i) => new Vector3().fromArray(pos.getElement(i, [])).applyMatrix4(transform).toArray();

// Connected components of the indexed triangles: one quad per physical board,
// independent of the encoder's triangle/vertex ordering.
const parents = Array.from({ length: pos.getCount() }, (_, i) => i);
const root = (i) => parents[i] === i ? i : (parents[i] = root(parents[i]));
for (let i = 0; i < idx.length; i += 3) {
  parents[root(idx[i + 1])] = root(idx[i]);
  parents[root(idx[i + 2])] = root(idx[i]);
}
const groups = new Map();
for (let i = 0; i < pos.getCount(); i++) {
  const r = root(i);
  if (!groups.has(r)) groups.set(r, []);
  groups.get(r).push(i);
}
const boards = [...groups.values()].map((ids) => {
  const points = ids.map(point);
  const texels = ids.map((i) => uv.getElement(i, []).map((v) => v * atlas.size));
  const min = [0, 1, 2].map((axis) => Math.min(...points.map((p) => p[axis])));
  const max = [0, 1, 2].map((axis) => Math.max(...points.map((p) => p[axis])));
  const u = texels.reduce((sum, p) => sum + p[0], 0) / ids.length;
  const v = texels.reduce((sum, p) => sum + p[1], 0) / ids.length;
  const region = Object.entries(atlas.regions).find(([, [x, y, w, h]]) => u > x && u < x + w && v > y && v < y + h);
  assert.ok(region, 'board UVs belong to a known atlas region');
  return { ids, min, max, points, texels, region: region[0] };
});

test('one unlit draw call, 12 boards, and the authored atlas is embedded', () => {
  assert.equal(mesh.listPrimitives().length, 1);
  assert.equal(boards.length, 12);
  assert.equal(idx.length / 3, 24);
  assert.ok(material.getExtension('KHR_materials_unlit'));
  assert.deepEqual(Buffer.from(material.getBaseColorTexture().getImage()), readFileSync(file('poc/stadium/hoardings.png')));
});

test('every board preserves artwork aspect and generously sized lettering', () => {
  for (const b of boards) {
    assert.equal(b.ids.length, 4, b.region);
    const [x, y, w, h] = atlas.regions[b.region];
    const faceW = Math.hypot(b.max[0] - b.min[0], b.max[2] - b.min[2]);
    const faceH = b.max[1] - b.min[1];
    assert.ok(Math.abs((w / h) / (faceW / faceH) - 1) < 0.01, `${b.region}: no squeezed lettering`);
    assert.ok(atlas.designs[b.region].cap_height_px / h >= 0.5, `${b.region}: readable cap height`);
    const us = b.texels.map(([u]) => u), vs = b.texels.map(([, v]) => v);
    for (const [actual, expected] of [[Math.min(...us), x], [Math.max(...us), x + w],
      [Math.min(...vs), y], [Math.max(...vs), y + h]]) {
      assert.ok(Math.abs(actual - expected) < 0.5, `${b.region}: UVs span the full artwork`);
    }
  }
});

test('atlas regions have mipmap gutters and stay inside the texture budget', () => {
  assert.equal(atlas.size, 1024);
  const regions = Object.values(atlas.regions);
  for (const [i, [x, y, w, h]] of regions.entries()) {
    assert.ok(x >= 16 && y >= 16 && x + w <= 1008 && y + h <= 1008);
    for (const [xx, yy, ww, hh] of regions.slice(i + 1)) {
      assert.ok(x + w + 16 <= xx || xx + ww + 16 <= x || y + h + 16 <= yy || yy + hh + 16 <= y);
    }
  }
});

test('blue and yellow stands each have one correctly oriented halfway-line name board', () => {
  for (const [region, z] of [['stadium_blue', 7.84], ['stadium_gold', -7.84]]) {
    const matches = boards.filter((b) => b.region === region);
    assert.equal(matches.length, 1, region);
    const b = matches[0];
    assert.equal(atlas.designs[region].text, 'OTRA.CITY STADIUM');
    assert.ok(Math.abs(b.min[0] + b.max[0]) < 0.002, 'centred on x=0, not a panel seam');
    assert.ok(Math.abs(b.min[2] - z) < 0.002 && Math.abs(b.max[2] - z) < 0.002, 'correct stand, 10 mm clear of backing');
    const left = b.points.findIndex((p) => p[0] === b.min[0]);
    const right = b.points.findIndex((p) => p[0] === b.max[0]);
    assert.equal(Math.sign(b.texels[right][0] - b.texels[left][0]), -Math.sign(z), 'not mirrored from the pitch');
    const top = b.points.findIndex((p) => p[1] === b.max[1]);
    const bottom = b.points.findIndex((p) => p[1] === b.min[1]);
    assert.ok(b.texels[top][1] < b.texels[bottom][1], 'text upright');
    const t = Array.from(idx).findIndex((i) => b.ids.includes(i));
    const [a, c, d] = [idx[t], idx[t + 1], idx[t + 2]].map(point);
    const normalZ = (c[0] - a[0]) * (d[1] - a[1]) - (c[1] - a[1]) * (d[0] - a[0]);
    assert.equal(Math.sign(normalZ), -Math.sign(z), 'face visible from pitch');
  }
});
