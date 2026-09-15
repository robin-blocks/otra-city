// A seated crowd for a venue — deterministic, instanced, and alive enough to
// stand a close-up.
//
// RFL's brief (docs/broadcast/REPLY.md §6) asks for fans in the stands with
// density and seed parameters, idle behaviour on seeded timers, and no static
// mannequins at 5 m. Three constraints shaped this:
//
//   Deterministic     every fan's seat, colour, pose and idle timing is a pure
//                     function of (seed, index, simulated time). Nothing here
//                     reads a clock or calls Math.random, so two runs of the
//                     same capture agree pixel for pixel.
//   Instanced         a citizen from avatar.js is 10 meshes with 10 materials,
//                     so 150 of them is ~1,500 draw calls. The same 150 fans
//                     are 10 InstancedMesh draws here, because the crowd is
//                     the one thing in the venue that scales with capacity.
//   Poses, not rigs   fans sit, shift, lean and occasionally stand. There is
//                     no walk cycle and no skeleton: each part's world matrix
//                     is composed directly from the pose, which is what makes
//                     the instanced form possible at all.
//
// The look deliberately reuses avatar.js's proportions and palette — a fan is
// the same citizen as the one walking the boulevard, sitting down.
import * as THREE from 'three';

// avatar.js's palette, so the stands and the street are populated by one city
const SHELL = 0xe9edf6;
const DARK = 0x241f38;
const ACCENTS = [0x47f2ff, 0xff2d95, 0xffd23e, 0x7dffa8, 0xa78bff, 0xff8c5a, 0x9fd8ff, 0xff5d8f];
// A stand of identical shells reads as mannequins however well it moves, so
// fans wear something. Muted enough not to fight the pitch, varied enough that
// the eye stops resolving individuals and sees a crowd.
const CLOTHES = [0xd8dbe6, 0x8f9ab5, 0x4a5570, 0xb5495c, 0x2f6f7d, 0xc9a35b,
                 0x6d5b8f, 0x3f7a56, 0xa8a2a0, 0x2c3350, 0xbf7048, 0x5d6b7f];

/** Small, fast, seedable. The same generator the rest of the crowd's numbers come from. */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Part dimensions from avatar.js. Order matters only for readability.
const PARTS = [
  ['thighL', 0.16, 0.42, 0.20, DARK],
  ['thighR', 0.16, 0.42, 0.20, DARK],
  ['shinL', 0.16, 0.42, 0.20, DARK],
  ['shinR', 0.16, 0.42, 0.20, DARK],
  ['torso', 0.44, 0.50, 0.26, SHELL],
  ['armL', 0.13, 0.44, 0.17, DARK],
  ['armR', 0.13, 0.44, 0.17, DARK],
  ['head', 0.34, 0.30, 0.30, SHELL],
];
// Unlit parts carry the accent and bloom; they are what reads as a person at
// distance, long after the boxes have blurred into the seat colour.
const GLOW = [
  ['chest', 0.10, 0.10, 0.03],
  ['visor', 0.24, 0.09, 0.03],
];

/**
 * @param {THREE.Object3D} parent   the venue root; the crowd is added to it
 * @param {object} opts
 *   seats     [[x, y, z], …] in the same space as `parent` — the tread the
 *             fan's seat stands on, straight from the venue manifest
 *   density   0..1 of the seats that are occupied
 *   seed      integer; the same seed always fills the same seats
 *   facing    [x, z] the fans turn towards (the pitch centre, in `parent` space)
 *   cap       hard ceiling on fans regardless of density
 */
export function createCrowd(parent, { seats = [], density = 0.6, seed = 1, facing = [0, 0], cap = 400 } = {}) {
  const rand = mulberry32(seed >>> 0);
  const wanted = Math.min(cap, Math.round(Math.max(0, Math.min(1, density)) * seats.length));

  // Which seats are taken: a seeded partial shuffle, so density 0.3 and 0.6
  // agree on the first 30% rather than reshuffling the whole stand.
  const order = seats.map((s, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const chosen = order.slice(0, wanted);

  // Per-fan constants, all drawn once from the seeded stream.
  const fans = chosen.map((seatIndex) => {
    const [x, y, z] = seats[seatIndex];
    return {
      x, y, z,
      yaw: Math.atan2(facing[0] - x, facing[1] - z),   // square on to the pitch
      accent: ACCENTS[Math.floor(rand() * ACCENTS.length)],
      clothes: CLOTHES[Math.floor(rand() * CLOTHES.length)],
      phase: rand() * Math.PI * 2,        // where in its idle cycle this fan is
      rate: 0.5 + rand() * 0.7,           // how fast it breathes and shifts
      lean: 0.05 + rand() * 0.16,         // how far forward it leans at the top of a shift
      slouch: (rand() - 0.5) * 0.10,      // a constant tilt, so a still crowd is not a grid
      turn: (rand() - 0.5) * 0.5,         // resting head/body offset from square-on
      standPeriod: 22 + rand() * 40,      // seconds between this fan standing up
      standAt: rand(),                    // where in that period it happens
      standFor: 0.06 + rand() * 0.10,     // fraction of the period spent up
    };
  });

  const n = fans.length;
  const meshes = new Map();
  const dummy = new THREE.Object3D();
  const colour = new THREE.Color();

  function makeInstanced(name, w, h, d, material) {
    const m = new THREE.InstancedMesh(new THREE.BoxGeometry(w, h, d), material, Math.max(n, 1));
    m.name = `crowd_${name}`;
    m.count = n;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false;   // one mesh spans four stands; its bounds are the bowl
    m.castShadow = false;
    parent.add(m);
    meshes.set(name, m);
    return m;
  }

  for (const [name, w, h, d, col] of PARTS) {
    // white base: per-instance colour multiplies the material colour, so a
    // tinted material would darken every fan's clothing toward the same hue
    const tinted = name !== 'head';
    makeInstanced(name, w, h, d, new THREE.MeshStandardMaterial({
      color: tinted ? 0xffffff : col, roughness: 0.8, metalness: 0.05 }));
  }
  for (const [name, w, h, d] of GLOW) {
    const m = makeInstanced(name, w, h, d, new THREE.MeshBasicMaterial({ toneMapped: false }));
    for (let i = 0; i < n; i++) m.setColorAt(i, colour.setHex(fans[i].accent));
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }
  // Clothing on the torso and arms; the head keeps the citizen's shell so a
  // fan is recognisably the same robot that walks the boulevard.
  for (const name of ['torso', 'armL', 'armR']) {
    const m = meshes.get(name);
    for (let i = 0; i < n; i++) m.setColorAt(i, colour.setHex(fans[i].clothes));
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }
  // Legs stay dark — trousers, and the half of a seated fan that is mostly
  // hidden behind the row in front anyway. A little variety so the lower
  // terrace is not one flat band.
  for (const name of ['thighL', 'thighR', 'shinL', 'shinR']) {
    const m = meshes.get(name);
    for (let i = 0; i < n; i++) {
      const g = 0.10 + (i % 5) * 0.035;
      m.setColorAt(i, colour.setRGB(g, g, g * 1.25));
    }
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }

  /** Write one part's matrix for fan `f`, in the fan's own frame (+z faces the pitch). */
  function place(name, i, fan, lx, ly, lz, rx = 0) {
    const s = Math.sin(fan.yaw + fan.turnNow), c = Math.cos(fan.yaw + fan.turnNow);
    dummy.position.set(fan.x + lx * c + lz * s, fan.y + ly, fan.z - lx * s + lz * c);
    dummy.rotation.set(rx, fan.yaw + fan.turnNow, 0);
    dummy.updateMatrix();
    meshes.get(name).setMatrixAt(i, dummy.matrix);
  }

  const state = { fans: n, seatsOffered: seats.length, cap, standing: 0 };

  /**
   * Pose every fan for simulated time `t`. Pure in (t, seed): no dt is
   * accumulated and no clock is read, so seeking to a frame and stepping to it
   * produce the same crowd.
   */
  function update(t) {
    let standing = 0;
    for (let i = 0; i < n; i++) {
      const f = fans[i];
      // Is this fan on its feet right now? A seeded window inside a seeded
      // period — no timers, so it is correct at any t including a seek.
      const cycle = ((t / f.standPeriod) + f.standAt) % 1;
      const up = cycle < f.standFor;
      // ease in and out of standing rather than snapping upright
      const k = up ? Math.min(1, Math.min(cycle, f.standFor - cycle) / (f.standFor * 0.35)) : 0;
      if (up) standing += 1;

      const breathe = Math.sin(t * f.rate + f.phase) * 0.012;
      const shift = Math.sin(t * f.rate * 0.37 + f.phase * 1.7);
      const leanX = f.slouch + shift * f.lean * (1 - k);
      f.turnNow = f.turn * 0.5 + Math.sin(t * f.rate * 0.23 + f.phase) * 0.18;

      // Seat geometry, not guesswork: the squab in poc/stadium/build.py spans
      // the tread to +0.12, so a seated fan's hips rest at 0.14 and its head
      // clears the 0.45 seat back by about a third of a metre. Standing lifts
      // the hips to 0.42, which is where avatar.js puts them.
      const hip = 0.14 + k * 0.28;
      const thighRot = (1 - k) * (Math.PI / 2);           // forward → vertical
      const thighY = hip - k * 0.21;
      // Legs are tucked, and the budget is exact rather than eyeballed. A seat
      // cell sits 0.3 m behind the front face of its row (d0 + 0.3 in
      // poc/stadium/build.py), a horizontal thigh reaches 0.21 m forward of its
      // own centre and a shin 0.10 m, so anything beyond 0.09 and 0.20 pushes
      // through the terrace wall — which on the front row is open air over the
      // gangway, and looks exactly like it sounds.
      const thighZ = (1 - k) * 0.08;
      const shinY = hip - 0.21;
      const shinZ = (1 - k) * 0.16;
      place('thighL', i, f, -0.11, thighY + breathe, thighZ, thighRot);
      place('thighR', i, f, 0.11, thighY + breathe, thighZ, thighRot);
      place('shinL', i, f, -0.11, shinY, shinZ, 0);
      place('shinR', i, f, 0.11, shinY, shinZ, 0);

      const torsoY = hip + 0.25 + breathe;
      place('torso', i, f, 0, torsoY, 0.02, leanX);
      place('chest', i, f, 0, torsoY + 0.05, 0.15, leanX);
      place('armL', i, f, -0.29, torsoY + 0.02, 0.03, leanX * 0.6);
      place('armR', i, f, 0.29, torsoY + 0.02, 0.03, leanX * 0.6);
      const headY = torsoY + 0.41;
      place('head', i, f, 0, headY, 0.02, leanX * 1.2);
      place('visor', i, f, 0, headY + 0.02, 0.17, leanX * 1.2);
    }
    for (const m of meshes.values()) m.instanceMatrix.needsUpdate = true;
    state.standing = standing;
  }

  update(0);

  return {
    update,
    state,
    get count() { return n; },
    dispose() {
      for (const m of meshes.values()) {
        parent.remove(m);
        m.geometry.dispose();
        m.material.dispose();
        m.dispose();
      }
      meshes.clear();
    },
  };
}
