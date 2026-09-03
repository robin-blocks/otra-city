// The city's punctual-light budget.
//
// Every plot may ship three lights and the street carries a lamp every 12 m,
// so the number of live lights grows with the city. In three.js the count of
// visible lights is a shader define, which means both letting it grow AND the
// obvious fix — switching distant lights off — are expensive: the second
// recompiles programs as you walk, mid-stride.
//
// So the city owns a FIXED pool and re-aims it. Plot and lamp lights are
// harvested at load, their originals removed from the scene, and each slot is
// retargeted to whichever record matters where you are standing. The light
// count never changes, so nothing ever recompiles, and the cost is bounded by
// proximity rather than by how many lots have been claimed — the same bargain
// media.js already strikes, where only the three nearest ambient sources play
// and only the two nearest screens decode.
//
// One rule on top of that, matching the audio invariant: STANDING ON A LOT,
// ITS OWN LIGHTS ARE RESERVED. Inside someone's build their lighting is the
// lighting, and a bright street lamp outside can never take a slot from the
// fixtures in the room you are standing in.
import * as THREE from 'three';

const POOL = 8;           // slots: a whole lot's worth, plus the street around it
const RESERVED = 3;       // the per-plot light cap in plot-spec — one lot fits exactly
const SELECT_S = 0.3;     // how often winners are re-chosen; the fades run every frame
const FADE_S = 0.35;      // a slot ramps out, re-aims, and ramps back in
const KEEP_BONUS = 1.35;  // an incumbent must be beaten by this much to be evicted
const LOT_HALF = 5;       // plots are a 10 x 10 m envelope (plot-spec size_m)
const LOT_MARGIN = 0.6;   // the same hysteresis band the soundtrack duck uses

export function createLightSystem(scene) {
  const recs = [];
  const slots = [];
  let onLot = null;
  let acc = SELECT_S;     // choose on the very first update
  let spots = 0;
  let warned = false;

  for (let i = 0; i < POOL; i++) {
    // Created once, never added or removed, never hidden. An invisible light
    // changes the define exactly as a deleted one does; a dark light does not.
    const light = new THREE.PointLight(0xffffff, 0, 14, 2);
    scene.add(light);
    slots.push({ light, rec: null, pending: null, k: 0, want: 0 });
  }

  function adopt(s, r) {
    s.rec = r;
    s.light.position.copy(r.pos);
    s.light.color.copy(r.color);
    s.light.distance = r.distance;
    s.light.decay = r.decay;
  }

  /** Take every point light under `root` into the pool and remove the originals.
   *  `lot` is the plot's centre in world space, or null for the city's own
   *  fixtures (street lamps), which belong to nobody and are never reserved.
   *  For a plot this must run AFTER the client's intensity normalization, or
   *  the records carry Blender's raw watts. */
  function harvest(root, lot = null) {
    root.updateMatrixWorld(true);
    const found = [];
    // Collect first, remove after: mutating the tree mid-traverse skips nodes.
    root.traverse((o) => {
      if (o.isPointLight) found.push(o);
      else if (o.isSpotLight) spots += 1;
    });
    for (const l of found) {
      recs.push({
        pos: l.getWorldPosition(new THREE.Vector3()),
        color: l.color.clone(),
        intensity: l.intensity,
        distance: l.distance || 14,
        decay: l.decay,
        lot: lot && { x: lot.x, z: lot.z },
        lit: false,
      });
      l.removeFromParent();
    }
    // Spot lights are left where they are: only one plot on the street has any,
    // and two unpooled spots cost exactly what a two-slot spot pool would. Past
    // that the same trick is worth extending to them.
    if (spots > 2 && !warned) {
      warned = true;
      console.warn(`otra.city: ${spots} spot lights on the street — time to pool those too`);
    }
    return found.length;
  }

  // Irradiance, not raw distance: a lamp at 40 outshines a 2-intensity fixture
  // from much further away, and the eye agrees. A record beyond its own falloff
  // contributes literally nothing, so it can never be worth a slot.
  const score = (r, p) => {
    const dx = r.pos.x - p.x, dz = r.pos.z - p.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > r.distance * r.distance) return 0;
    return (r.intensity / (d2 + 1)) * (r.lit ? KEEP_BONUS : 1);
  };

  function select(p) {
    const half = LOT_HALF + (onLot ? LOT_MARGIN : -LOT_MARGIN);
    let here = null;
    for (const r of recs) {
      if (!r.lot) continue;
      if (Math.abs(p.x - r.lot.x) <= half && Math.abs(p.z - r.lot.z) <= half) { here = r.lot; break; }
    }
    onLot = here;

    const scored = recs.map((r) => ({ r, s: score(r, p) })).filter((e) => e.s > 0).sort((a, b) => b.s - a.s);
    const winners = [];
    if (here) {
      for (const e of scored) {
        if (winners.length >= RESERVED) break;
        if (e.r.lot && e.r.lot.x === here.x && e.r.lot.z === here.z) winners.push(e.r);
      }
    }
    for (const e of scored) {
      if (winners.length >= POOL) break;
      if (!winners.includes(e.r)) winners.push(e.r);
    }
    for (const r of recs) r.lit = false;
    for (const r of winners) r.lit = true;

    const queue = new Set(winners);
    const freed = [];
    for (const s of slots) {
      if (s.rec && queue.has(s.rec)) { s.want = 1; queue.delete(s.rec); continue; }
      s.want = 0;
      freed.push(s);
    }
    const waiting = [...queue];
    for (const s of freed) {
      s.pending = waiting.shift() || null;
      // A slot that was already dark has nothing to fade out of: aim it now.
      if (!s.rec && s.pending) { adopt(s, s.pending); s.pending = null; s.want = 1; }
    }
  }

  function update(playerPos, dt = 1 / 60) {
    acc += dt;
    if (acc >= SELECT_S) { acc = 0; select(playerPos); }
    const step = dt / FADE_S;
    for (const s of slots) {
      if (s.k !== s.want) s.k = THREE.MathUtils.clamp(s.k + Math.sign(s.want - s.k) * step, 0, 1);
      // Fade out, re-aim, fade back in. A slot never jumps across the street.
      if (s.k === 0 && s.pending) { adopt(s, s.pending); s.pending = null; s.want = 1; }
      s.light.intensity = s.rec ? s.rec.intensity * s.k : 0;
    }
  }

  /** Choose and light immediately, with no ramp — for the spawn and for the
   *  establishing shot a permalink arrives on, which must not fade up. */
  function seed(playerPos) {
    select(playerPos);
    for (const s of slots) {
      if (s.pending) { adopt(s, s.pending); s.pending = null; }
      s.want = s.rec ? 1 : 0;
      s.k = s.want;
      s.light.intensity = s.rec ? s.rec.intensity * s.k : 0;
    }
    acc = 0;
  }

  return {
    harvest,
    update,
    seed,
    get count() { return recs.length; },
    get state() {
      return {
        records: recs.length,
        pool: POOL,
        spotsLeftInPlace: spots,
        onLot: onLot ? [+onLot.x.toFixed(1), +onLot.z.toFixed(1)] : null,
        slots: slots.map((s) => ({
          at: s.rec ? [+s.rec.pos.x.toFixed(1), +s.rec.pos.z.toFixed(1)] : null,
          of: s.rec ? (s.rec.lot ? `lot ${s.rec.lot.x}` : 'street') : null,
          k: +s.k.toFixed(3),
          intensity: +s.light.intensity.toFixed(3),
        })),
      };
    },
  };
}
