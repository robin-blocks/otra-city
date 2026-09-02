// The city's light budget: a fixed pool of point lights that follows the visitor.
//
// Every MeshStandardMaterial fragment loops over EVERY point light in the
// scene — a 14 m `distance` does not skip the loop — so a street that keeps all
// its lights live costs 27 lights per fragment today (6 lamps, 20 plot lights,
// the avatar fill) and passes 100 at thirty lots. Audio (nearest 3) and video
// screens (nearest 2) already follow the visitor; this makes lights do the
// same. Lamps and plots register light SOURCES — plain records — and a pool of
// N real lights is re-targeted to the N nearest sources as the visitor walks.
// The cost is then bounded by proximity, not by the size of the city.
//
// Two rules borrowed from Fable Cities' engine contract, where they were
// learned the hard way (60 → 9.5 fps): never add or remove lights and never
// toggle `light.visible` at runtime, because three re-derives NUM_POINT_LIGHTS
// and recompiles every material in the scene. So the pool is allocated ONCE,
// before the first frame, an idle slot simply sits at intensity 0, and
// lowering the budget parks slots rather than shrinking the pool.
//
// Venues are the one thing still outside this. A stadium streaming to tier 1
// adds its own floodlights to the scene and disposes them again on the way
// out — measured on the current build, walking to the stadium takes the scene
// from 9 point / 2 spot to 11 point / 6 spot and the program count from 40 to
// 55 as materials recompile against the new counts. Folding them in needs a
// spot-light pool as well, and belongs to the venue system rather than here.
import * as THREE from 'three';

const RETARGET_S = 0.4;   // how often the nearest-N set is recomputed
const FADE_S = 0.35;      // a slot fades in and out instead of popping

export function createLightPool(scene, size) {
  const sources = [];
  const slots = [];
  for (let i = 0; i < size; i++) {
    const light = new THREE.PointLight(0xffffff, 0, 14, 2);
    light.name = `pool_light_${i}`;
    scene.add(light);
    slots.push({ light, source: null, gain: 0, target: 0 });
  }
  let budget = size;
  let timer = RETARGET_S;   // first update assigns immediately
  let dirty = true;

  // { position: Vector3 (world), color, intensity, distance?, decay? }
  function add(src) {
    const s = {
      position: src.position.clone(),
      color: new THREE.Color(src.color),
      intensity: src.intensity,
      distance: src.distance ?? 14,
      decay: src.decay ?? 2,
    };
    sources.push(s);
    dirty = true;
    return s;
  }

  function assign(slot, src) {
    slot.source = src;
    slot.gain = 0;
    slot.target = 1;
    slot.light.position.copy(src.position);
    slot.light.color.copy(src.color);
    slot.light.distance = src.distance;
    slot.light.decay = src.decay;
    slot.light.intensity = 0;
  }

  function retarget(p) {
    const wanted = new Set(sources
      .map((s) => ({ s, d: Math.hypot(s.position.x - p.x, s.position.z - p.z) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, budget)
      .map((x) => x.s));
    // slots whose source is still wanted keep it; everything else fades out
    for (const slot of slots) {
      if (slot.source && wanted.has(slot.source)) { wanted.delete(slot.source); slot.target = 1; }
      else slot.target = 0;
    }
    // newly wanted sources take a slot that is empty or has faded to silence;
    // a slot still fading out is left alone and picked up next round
    for (const src of wanted) {
      const free = slots.find((sl) => !sl.source || (sl.target === 0 && sl.gain === 0));
      if (!free) break;
      assign(free, src);
    }
  }

  function update(p, dt) {
    timer += dt;
    if (dirty || timer >= RETARGET_S) {
      timer = 0;
      dirty = false;
      retarget(p);
    }
    for (const slot of slots) {
      if (!slot.source) continue;
      const next = THREE.MathUtils.clamp(slot.gain + Math.sign(slot.target - slot.gain) * (dt / FADE_S), 0, 1);
      if (next !== slot.gain) {
        slot.gain = next;
        slot.light.intensity = slot.source.intensity * next;
      }
    }
  }

  return {
    add,
    update,
    get size() { return size; },
    get budget() { return budget; },
    /** How many slots may be lit. Never grows the pool; parks the rest. */
    setBudget(k) {
      budget = THREE.MathUtils.clamp(k | 0, 0, size);
      dirty = true;
    },
    get sources() { return sources; },
    get lights() { return slots.map((s) => s.light); },
    stats() {
      return {
        pool: size,
        budget,
        sources: sources.length,
        lit: slots.filter((s) => s.light.intensity > 0).length,
      };
    },
  };
}
