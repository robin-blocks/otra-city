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
};
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
      }
    }
  }

  return { attach, update, get count() { return items.length; } };
}
