// Agent-declared animations — declarative capabilities, never agent code.
// A plot's manifest binds a capability to a named node; the client ticks them
// all in one pass with hard caps, so cost is identical for every plot and
// nothing can strobe, fling geometry out of the lot, or run scripts.
// The automated shop door is the same idea as a platform preset ("slider").
import * as THREE from 'three';

const CAPS = {
  spinner: { maxRpm: 12 },
  bobber: { maxAmp: 0.5, minPeriod: 1.5 },
  blinker: { minPeriod: 1.0 },   // no strobes
  pulse: { minPeriod: 1.2, maxDepth: 0.7 },   // emissive breathes, never strobes
  ticker: { maxSpeed: 0.25 },                 // UV scroll, texture-widths/sec
};

// pulse/ticker mutate materials, so the node gets private clones — a shared
// material must never animate for every mesh that happens to use it.
function privateMaterials(node, cloneMap = false) {
  const mats = [];
  node.traverse((o) => {
    if (!o.isMesh) return;
    const list = Array.isArray(o.material) ? o.material : [o.material];
    const clones = list.map((m) => {
      const c = m.clone();
      if (cloneMap && c.map) {
        c.map = c.map.clone();
        c.map.wrapS = THREE.RepeatWrapping;
        c.map.needsUpdate = true;
      }
      return c;
    });
    o.material = Array.isArray(o.material) ? clones : clones[0];
    mats.push(...clones);
  });
  return mats;
}
const MAX_ANIMS_PER_PLOT = 8;
const TICK_RADIUS = 45;          // animations sleep beyond this

export function createAnimSystem() {
  const items = [];

  function attach(container, gltfScene, anims = []) {
    container.updateMatrixWorld(true);
    const origin = container.getWorldPosition(new THREE.Vector3());
    for (const a of anims.slice(0, MAX_ANIMS_PER_PLOT)) {
      const node = gltfScene.getObjectByName(a.node);
      if (!node) {
        console.warn('anim node missing:', a.node);
        continue;
      }
      const it = { type: a.type, node, origin, base: node.position.clone() };
      if (a.type === 'spinner') {
        const rpm = THREE.MathUtils.clamp(a.rpm ?? 3, -CAPS.spinner.maxRpm, CAPS.spinner.maxRpm);
        it.rate = (rpm / 60) * Math.PI * 2;
      } else if (a.type === 'bobber') {
        it.amp = Math.min(Math.abs(a.amp ?? 0.2), CAPS.bobber.maxAmp);
        it.period = Math.max(a.period ?? 3, CAPS.bobber.minPeriod);
      } else if (a.type === 'blinker') {
        it.on = Math.max(a.on ?? 0.8, 0.3);
        it.off = Math.max(a.off ?? 0.8, CAPS.blinker.minPeriod - it.on, 0.2);
      } else if (a.type === 'pulse') {
        it.period = Math.max(a.period ?? 2.4, CAPS.pulse.minPeriod);
        it.depth = Math.min(Math.abs(a.depth ?? 0.4), CAPS.pulse.maxDepth);
        it.mats = privateMaterials(node)
          .filter((m) => m.emissiveIntensity > 0)
          .map((m) => ({ m, base: m.emissiveIntensity }));
        if (!it.mats.length) continue;
      } else if (a.type === 'ticker') {
        it.speed = Math.max(-CAPS.ticker.maxSpeed,
          Math.min(a.speed ?? 0.08, CAPS.ticker.maxSpeed));
        it.maps = privateMaterials(node, true).filter((m) => m.map).map((m) => m.map);
        if (!it.maps.length) continue;
      } else {
        continue;
      }
      items.push(it);
    }
  }

  function update(dt, time, playerPos) {
    for (const it of items) {
      const d = Math.hypot(it.origin.x - playerPos.x, it.origin.z - playerPos.z);
      if (d > TICK_RADIUS) continue;
      if (it.type === 'spinner') {
        it.node.rotation.y += it.rate * dt;
      } else if (it.type === 'bobber') {
        it.node.position.y = it.base.y + Math.sin((time / it.period) * Math.PI * 2) * it.amp;
      } else if (it.type === 'blinker') {
        it.node.visible = (time % (it.on + it.off)) < it.on;
      } else if (it.type === 'pulse') {
        const k = 1 - it.depth / 2 + (it.depth / 2) * Math.sin((time / it.period) * Math.PI * 2);
        for (const { m, base } of it.mats) m.emissiveIntensity = base * k;
      } else if (it.type === 'ticker') {
        for (const map of it.maps) map.offset.x = (time * it.speed) % 1;
      }
    }
  }

  return { attach, update, get count() { return items.length; } };
}
