// Read a venue GLB the way the plot validator reads a plot: gltf-transform
// with the Draco decoder, and report what the budgets and node contract
// need — bytes, triangles, draw calls, materials, textures, lights, node
// names, bounds, and the UV range of the media nodes the client paints.
import { NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';

let ioPromise = null;
function getIO() {
  ioPromise ??= (async () => new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'draco3d.decoder': await draco3d.createDecoderModule() }))();
  return ioPromise;
}

function meshUnder(node) {
  if (node.getMesh()) return node.getMesh();
  for (const c of node.listChildren()) { const m = meshUnder(c); if (m) return m; }
  return null;
}

export async function inspectGlb(bytes, { uvNodes = [] } = {}) {
  const io = await getIO();
  const doc = await io.readBinary(new Uint8Array(bytes));
  const root = doc.getRoot();
  let tris = 0;
  let prims = 0;
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      prims += 1;
      const idx = prim.getIndices();
      tris += (idx ? idx.getCount() : prim.getAttribute('POSITION').getCount()) / 3;
    }
  }
  const nodes = root.listNodes();
  const lightNodes = [];
  for (const n of nodes) {
    const ext = n.getExtension('KHR_lights_punctual');
    if (ext) lightNodes.push({ name: n.getName(), type: ext.getType(), intensity: ext.getIntensity() });
  }
  const scene = root.getDefaultScene() || root.listScenes()[0];
  const { min, max } = getBounds(scene);
  const uv = {};
  for (const name of uvNodes) {
    const node = nodes.find((n) => n.getName() === name);
    const mesh = node ? meshUnder(node) : null;
    const prim = mesh?.listPrimitives()[0];
    const tc = prim?.getAttribute('TEXCOORD_0');
    if (!tc) { uv[name] = node ? { missing: !mesh, noUV: !!mesh } : { absent: true }; continue; }
    const r = { umin: Infinity, umax: -Infinity, vmin: Infinity, vmax: -Infinity, verts: tc.getCount() };
    const e = [0, 0];
    for (let i = 0; i < tc.getCount(); i++) {
      tc.getElement(i, e);
      r.umin = Math.min(r.umin, e[0]); r.umax = Math.max(r.umax, e[0]);
      r.vmin = Math.min(r.vmin, e[1]); r.vmax = Math.max(r.vmax, e[1]);
    }
    uv[name] = r;
  }
  return {
    bytes: bytes.length,
    tris: Math.round(tris),
    prims,
    meshNodes: nodes.filter((n) => n.getMesh()).length,
    materials: root.listMaterials().map((m) => m.getName()),
    textures: root.listTextures().map((t) => ({ name: t.getName(), size: t.getSize() })),
    lights: lightNodes.length,
    lightNodes,
    nodes: nodes.map((n) => n.getName()),
    bbox: { min, max },
    uv,
    extensions: root.listExtensionsUsed().map((e) => e.extensionName),
  };
}
