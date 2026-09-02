// The one camera the city uses to thumbnail a plot.
//
// A poster is a shopfront photo, not a cityscape: the build fills the frame,
// seen from across the street at a three-quarter angle, at roughly the height
// of someone standing on the far kerb. A wide boulevard shot would read as
// "generic city" and tell a visitor nothing about the specific plot.
//
// It lives here rather than in the render script so the /preview tool and the
// pipeline frame a plot identically — a builder can press "poster" and see the
// exact image the directory will show.
import * as THREE from 'three';

export const POSTER = {
  width: 1536,
  height: 864,          // 16:9 — directory embeds are aspect-video
  fov: 50,              // the city camera's field of view
  azimuth: 26,          // degrees off the street normal: a three-quarter view
  elevation: 7,         // degrees above horizontal: standing, not droning
  fill: 0.94,           // fraction of the frame the build spans
  lift: 0.06,           // nudge the build below centre, so signage sits high
  min_distance: 6.5,    // never closer than the far kerb
  max_distance: 40,
  min_height: 1.2,      // and never underground
};

// The lot envelope, from the spec. A plot is validated to fit inside it, so
// clamping to it only ever guards against a stray vertex wrecking the framing.
const ENVELOPE = new THREE.Box3(new THREE.Vector3(-5, 0, -5), new THREE.Vector3(5, 6, 5));

// The points the frame has to contain: the corners of EVERY mesh's own box,
// not one box around the lot. A plot is mostly empty air — a lone tower, a
// dome over a low facade — and the corners of a single lot-sized box are air
// the camera would otherwise back up to include.
export function framePoints(root) {
  const pts = [];
  const box = new THREE.Box3();
  root.updateWorldMatrix(true, true);
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry || o.visible === false) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    box.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
    box.min.max(ENVELOPE.min);
    box.max.min(ENVELOPE.max);
    if (box.isEmpty()) return;
    for (const x of [box.min.x, box.max.x]) {
      for (const y of [box.min.y, box.max.y]) {
        for (const z of [box.min.z, box.max.z]) pts.push(new THREE.Vector3(x, y, z));
      }
    }
  });
  return pts;
}

// Place `camera` so the build spans `fill` of the frame and sits centred, and
// point `target` (an OrbitControls target, or any Vector3) into the middle of
// it. Framing is a lens shift, not a re-aim: the camera keeps the azimuth and
// elevation above, and slides perpendicular to its own axis to centre the
// shot, the way a photographer steps sideways rather than tilting.
export function framePoster(camera, target, points, opts = {}) {
  const o = { ...POSTER, ...opts };
  if (!points.length) return null;
  const anchor = new THREE.Box3().setFromPoints(points).getCenter(new THREE.Vector3());

  const az = THREE.MathUtils.degToRad(o.azimuth);
  const el = THREE.MathUtils.degToRad(o.elevation);
  // +Z is the street side, so the camera sits at +Z swung `azimuth` around it
  const toCamera = new THREE.Vector3(
    Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).normalize();
  const forward = toCamera.clone().negate();
  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
  const up = new THREE.Vector3().crossVectors(right, forward).normalize();

  // Every point in camera axes, relative to the anchor. Depth is p + d, so a
  // point's screen position is (q - shift) / (p + d): the distance and the
  // lens shift are the only unknowns.
  const local = points.map((p) => {
    const v = p.clone().sub(anchor);
    return { p: v.dot(forward), q: v.dot(right), r: v.dot(up) };
  });

  const tanV = Math.tan(THREE.MathUtils.degToRad(o.fov) / 2) * o.fill;
  const tanH = tanV * (o.width / o.height);

  // At distance d the shift that centres one axis is the midpoint of the range
  // it may take; the axis fits iff that range is non-empty. Both ends move
  // monotonically with d, so a bisection lands on the closest distance that
  // still contains the build.
  const span = (d, tan, key) => {
    let lo = -Infinity;
    let hi = Infinity;
    for (const l of local) {
      const half = tan * (l.p + d);
      lo = Math.max(lo, l[key] - half);
      hi = Math.min(hi, l[key] + half);
    }
    return { lo, hi, fits: lo <= hi, shift: (lo + hi) / 2 };
  };
  const fits = (d) => span(d, tanH, 'q').fits && span(d, tanV, 'r').fits;

  let lo = o.min_distance;
  let hi = o.max_distance;
  if (!fits(hi)) lo = hi;                       // bigger than the lot: back off to the cap
  else if (fits(lo)) hi = lo;                   // already contained at the kerb
  else for (let i = 0; i < 48; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) hi = mid; else lo = mid;
  }
  const d = hi;
  const shiftH = span(d, tanH, 'q').shift;
  const shiftV = span(d, tanV, 'r').shift - o.lift * tanV * d;

  camera.position.copy(anchor)
    .addScaledVector(toCamera, d)
    .addScaledVector(right, shiftH)
    .addScaledVector(up, shiftV);
  camera.position.y = Math.max(camera.position.y, o.min_height);
  if (camera.isPerspectiveCamera) {
    camera.fov = o.fov;
    camera.aspect = o.width / o.height;
    camera.updateProjectionMatrix();
  }
  const look = camera.position.clone().addScaledVector(forward, d);
  camera.lookAt(look);
  target.copy(look);
  return { distance: d, anchor, points: points.length };
}
