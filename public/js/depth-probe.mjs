// "Do two surfaces share a depth in this frame?" — the one measure for the
// defect that makes a build fizz as you walk past it.
//
// Two front faces at the same depth pointing the same way have no winner: the
// GPU picks per fragment, the pick changes with the camera, and the surface
// crawls. It is the most common defect in a voxel city, because voxel builds
// are overlapping boxes, and it arrives by two roads that look nothing alike:
//
//   * geometry — a box laid on another box so that a face lands in a face,
//     which is how the stadium's bottom terrace row sat in its own front wall
//     for the full length of all four stands; and
//   * the ENCODER — Draco quantizes positions over each mesh's bounding box,
//     so a 2 mm offset in a 52 m mesh at 14 bits (a 3.2 mm grid) rounds to
//     nothing and an authored gap becomes an exact tie on the way out.
//
// Both end up as the same thing on screen, so this measures the thing on
// screen and not either cause. Raycasting, not a frame diff: a diff cannot
// tell a depth tie from the text on a screen aliasing under a camera nudge,
// and it was reporting the stadium's scoreboards as broken when they were 11
// mm apart and perfectly ordered.
//
// It is a WARNING with a budget, not a rejection. A build is allowed to be
// odd; it is not allowed to shimmer, and the builder cannot see their own
// work, so the number has to be somebody's job.
import * as THREE from 'three';

export const DEPTH = {
  // Sample every Nth pixel each way. 12 is a deliberate coarseness: the whole
  // sweep of the stadium's thirteen cameras costs 148 s at 10 and 74 s at 14
  // on a software renderer, and the worst reading is the same to three
  // decimals — a defect worth catching covers percent of a frame, not pixels
  // of it. Finer only buys resolution on the residue, which is noise.
  step: 12,
  gap: 0.0008,      // metres: under one depth step at the range a city is seen
  far: 400,
  // What the city read the day this landed, once the four defects it found in
  // the stadium were out: 0.000% from the spawn and from outside eleven of the
  // twelve lots, 0.010% outside archive-9, and 0.030% from the venue's worst
  // camera. What it read on the defects themselves, all of which had shipped:
  // 2.57% on the stand fronts, 2.06% on the floodlight mast collars, 1.99% on
  // the outer wall corners.
  //
  // 0.12% sits eight times over the worst clean reading and sixteen times
  // under the smallest real defect, which is as much daylight as a measure
  // ever gets. The residue is not noise to be tuned away: it is a handful of
  // rays landing exactly along an edge where two faces really are parallel and
  // really are at one depth, and a city that grows more edges will read a
  // little higher. Raise this when a reading is explained, never to make a
  // build green.
  budget: 0.12,
};

const _ndc = new THREE.Vector2();
const _nm = new THREE.Matrix3();
const _na = new THREE.Vector3();
const _nb = new THREE.Vector3();

/** A hit's face normal in world space. */
function worldNormal(hit, out) {
  const n = hit.normal || hit.face?.normal;
  if (!n) return null;
  return out.copy(n).applyMatrix3(_nm.getNormalMatrix(hit.object.matrixWorld)).normalize();
}

/** Every mesh the camera could draw: visible, and visible all the way up. */
function drawnMeshes(scene) {
  const out = [];
  scene.traverse((o) => {
    if (!o.isMesh) return;
    for (let p = o; p; p = p.parent) if (!p.visible) return;
    out.push(o);
  });
  return out;
}

/**
 * Sample a grid over the frame and report the share of it where the two
 * nearest surfaces are within `gap` of each other.
 *
 * → { sampled, tied, percent, budget, ok, worst: [{ at, who }] }
 * `sampled` counts only rays that hit something, so an empty sky does not
 * flatter the number.
 */
export function probeCoplanar(scene, camera, opts = {}) {
  const o = { ...DEPTH, ...opts };
  const w = o.width || 1280;
  const h = o.height || 720;
  const meshes = o.meshes || drawnMeshes(scene);
  const ray = new THREE.Raycaster();
  ray.far = o.far;
  const path = (m) => { const n = []; for (let p = m; p; p = p.parent) if (p.name) n.unshift(p.name); return n.join('/'); };
  let sampled = 0;
  let tied = 0;
  const worst = [];
  camera.updateMatrixWorld();
  for (let y = (o.step >> 1); y < h; y += o.step) {
    for (let x = (o.step >> 1); x < w; x += o.step) {
      _ndc.set((x / w) * 2 - 1, -(y / h) * 2 + 1);
      ray.setFromCamera(_ndc, camera);
      ray.far = o.far;
      const hits = ray.intersectObjects(meshes, false);
      if (!hits.length) continue;
      sampled += 1;
      const d0 = hits[0].distance;
      if (hits.length < 2 || hits[1].distance - d0 >= o.gap) continue;
      // Same DEPTH is not enough: a ray grazing the edge of a box hits two of
      // its own faces within a hair of each other, and that is a silhouette,
      // not a fight. Two faces the GPU cannot order point the same way.
      const na = worldNormal(hits[0], _na);
      const nb = worldNormal(hits[1], _nb);
      if (na && nb && na.dot(nb) < 0.99) continue;
      tied += 1;
      if (worst.length < 12) {
        worst.push({
          at: hits[0].point.toArray().map((v) => +v.toFixed(2)),
          m: +d0.toFixed(1),
          who: hits.filter((q) => q.distance - d0 < o.gap).map((q) => path(q.object)),
        });
      }
    }
  }
  const percent = sampled ? +((tied / sampled) * 100).toFixed(3) : 0;
  return { sampled, tied, percent, budget: o.budget, ok: percent <= o.budget, worst };
}

/** One line a human or a build log can read. */
export function describeCoplanar(r) {
  if (!r.sampled) return 'nothing in frame';
  const head = `${r.percent}% of the frame is two surfaces at one depth (budget ${r.budget}%)`;
  if (r.ok) return head;
  const where = r.worst.slice(0, 3)
    .map((p) => `${p.who.join(' + ')} at ${p.at.join(',')}`)
    .join('; ');
  return `${head} — this shimmers as you walk past it. Pull the overlapping ` +
    `surface at least 10 mm off the one behind it, and check the exporter's ` +
    `position quantization is finer than that over the whole mesh. ${where}`;
}
