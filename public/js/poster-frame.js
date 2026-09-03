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

// How much of a poster a visitor can actually SEE.
//
// A plot is validated on budgets — triangles, materials, texture size, lights
// — and passes all of them while rendering as a black rectangle. In a city
// that is night permanently, and where the docs tell builders "emissive
// surfaces carry your design", that is the failure mode budgets cannot catch:
// nothing is over any limit, there is simply nothing to look at.
//
// The measure is the share of the poster's CENTRE that carries visible light.
// Three things about that definition were chosen against the ten plots on the
// street, not guessed:
//
//   * the CENTRE, because a thumbnail is judged by its middle. The poster
//     camera fills 94% of the frame with the build, so the outer band is sky
//     and pavement on every plot and only adds noise.
//   * VISIBLE light rather than darkness. Counting near-black pixels does not
//     work: PromptFrenzy's poster is 74% near-black and perfectly legible,
//     because what is lit is a sign you can read. Archive-9's is 94% and
//     unreadable. Sorting by darkness puts them side by side; sorting by lit
//     centre separates them by 4x.
//   * LINEAR luminance, because that is the space the light actually adds up
//     in — the same Rec.709 weights the renderer tone-maps from.
//
// Measured over the street the day this landed: readable plots run 11% to 49%
// (Fernseed 49, City Hall 30, Museverse 19, Halberd 17, PromptFrenzy 13, 4DGSX
// 12, Signal 12, Lattice 11), and the two that read as an empty frame sit at
// 3% (Glow Garden 3.0, Archive-9 3.2). FLOOR is set between them with roughly
// 2x of margin on both sides, so it takes a real regression to trip it and a
// genuinely dark plot to fail it.
//
// It is a WARNING everywhere it is used, never a rejection. A plot that means
// to be dark is a legitimate plot, and the city does not get to dictate what a
// build looks like. What it does get to do is make sure the builder — who
// cannot see their own work, and gets one render to judge it by — is told.
export const READABILITY = {
  centre: 0.15,     // crop this much off each edge before measuring
  visible: 0.02,    // linear luminance at which a pixel counts as lit
  floor: 6,         // percent: below this a poster reads as an empty frame
  street: [11, 49], // what the plots a visitor can read measured, for context
};

// sRGB -> linear, one entry per byte: the alternative is a pow() per channel
// per pixel, and a 1536x864 poster is 1.3 M of them.
const TO_LINEAR = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  TO_LINEAR[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/**
 * Measure a rendered poster. Pass the renderer's canvas — it must have been
 * created with `preserveDrawingBuffer`, or the pixels are gone by the time we
 * read them (/preview does; the city client only under ?headless=1).
 *
 * → { centreLit, meanY, reads, floor, street } with centreLit as a percentage.
 */
export function measureReadability(canvas, opts = {}) {
  const o = { ...READABILITY, ...opts };
  const w = canvas.width;
  const h = canvas.height;
  const x0 = Math.floor(w * o.centre);
  const y0 = Math.floor(h * o.centre);
  const cw = Math.max(1, Math.ceil(w * (1 - o.centre)) - x0);
  const ch = Math.max(1, Math.ceil(h * (1 - o.centre)) - y0);
  // A WebGL canvas cannot be read with getImageData, so the centre is copied
  // into a 2D canvas at 1:1 — scaling here would average a bright pixel into
  // its dark neighbours and quietly change the answer.
  const flat = document.createElement('canvas');
  flat.width = cw;
  flat.height = ch;
  const ctx = flat.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(canvas, x0, y0, cw, ch, 0, 0, cw, ch);
  const px = ctx.getImageData(0, 0, cw, ch).data;
  let lit = 0;
  let sum = 0;
  for (let i = 0; i < px.length; i += 4) {
    const y = 0.2126 * TO_LINEAR[px[i]] + 0.7152 * TO_LINEAR[px[i + 1]] + 0.0722 * TO_LINEAR[px[i + 2]];
    sum += y;
    if (y > o.visible) lit += 1;
  }
  const n = cw * ch;
  const centreLit = +((lit / n) * 100).toFixed(1);
  return {
    centreLit,
    meanY: +(sum / n).toFixed(4),
    reads: centreLit >= o.floor,
    floor: o.floor,
    street: o.street,
    region: [cw, ch],
  };
}

/** One line a human or a build log can read. */
export function describeReadability(r) {
  const pct = r.centreLit.toFixed(1);
  return r.reads
    ? `${pct}% of the frame is lit (the street runs ${r.street[0]}-${r.street[1]}%)`
    : `only ${pct}% of the frame is lit, under the ${r.floor}% floor — ` +
      `from the street this plot reads as an empty frame. Plots a visitor can read ` +
      `run ${r.street[0]}-${r.street[1]}%. Outline your dark masses with emissive ` +
      `edges, or raise the emissive strength on what you want seen.`;
}

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
