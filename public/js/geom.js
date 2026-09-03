// Two small geometry helpers the city's renderers share.
//
// createInstancer: one InstancedMesh per KIND of thing (every dash, every lamp
// post, every vacant-lot pad) instead of a Mesh per thing. A district of
// three hundred metres of road is a few hundred boxes, and a draw call each
// was the largest fixed cost in the scene. Unit geometries are scaled per
// instance, so one kind serves every length of asphalt.
//
// mergedQuads: many textured planes as ONE non-indexed geometry, two triangles
// per quad in order, so a raycast's faceIndex >> 1 is the quad that was hit —
// which is how one draw call's worth of vacant-lot boards can still each
// offer their own link.
import * as THREE from 'three';

export function createInstancer(group, colliders) {
  const kinds = new Map();
  const dummy = new THREE.Object3D();
  dummy.rotation.order = 'YXZ';
  return {
    kind(key, geometry, material, { collide = false, dynamic = false } = {}) {
      kinds.set(key, { geometry, material, collide, dynamic, items: [] });
    },
    add(key, { x = 0, y = 0, z = 0, ry = 0, rx = 0, sx = 1, sy = 1, sz = 1 } = {}) {
      const k = kinds.get(key);
      if (!k) throw new Error(`instancer: unknown kind "${key}"`);
      dummy.position.set(x, y, z);
      dummy.rotation.set(rx, ry, 0);
      dummy.scale.set(sx, sy, sz);
      dummy.updateMatrix();
      k.items.push(dummy.matrix.clone());
      return k.items.length - 1;
    },
    // Build the meshes. Returns { key: InstancedMesh } for anything that
    // wants to animate its instances afterwards.
    flush() {
      const out = {};
      for (const [key, k] of kinds) {
        if (!k.items.length) continue;
        const mesh = new THREE.InstancedMesh(k.geometry, k.material, k.items.length);
        mesh.name = `inst:${key}`;
        for (let i = 0; i < k.items.length; i++) mesh.setMatrixAt(i, k.items[i]);
        mesh.instanceMatrix.setUsage(k.dynamic ? THREE.DynamicDrawUsage : THREE.StaticDrawUsage);
        mesh.computeBoundingSphere();
        group.add(mesh);
        if (k.collide) colliders.push(mesh);
        out[key] = mesh;
      }
      return out;
    },
  };
}

// quads: [{ matrix: Matrix4, w, h, dz = 0, uv = [u0, v0, u1, v1] }] — a
// w x h plane facing local +z, pushed dz along it, transformed by matrix.
export function mergedQuads(quads) {
  const pos = new Float32Array(quads.length * 18);
  const uvs = new Float32Array(quads.length * 12);
  const v = new THREE.Vector3();
  let p = 0;
  let u = 0;
  for (const q of quads) {
    const [u0, v0, u1, v1] = q.uv || [0, 0, 1, 1];
    const hw = q.w / 2;
    const hh = q.h / 2;
    const dz = q.dz || 0;
    // TL, BL, BR, TL, BR, TR — counter-clockwise seen from +z
    const corners = [[-hw, hh, u0, v1], [-hw, -hh, u0, v0], [hw, -hh, u1, v0], [-hw, hh, u0, v1], [hw, -hh, u1, v0], [hw, hh, u1, v1]];
    for (const [x, y, cu, cv] of corners) {
      v.set(x, y, dz).applyMatrix4(q.matrix);
      pos[p++] = v.x; pos[p++] = v.y; pos[p++] = v.z;
      uvs[u++] = cu; uvs[u++] = cv;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  g.computeBoundingSphere();
  return g;
}
