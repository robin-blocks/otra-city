// Sliding doors and gates: the one controller for a plot's door_panel_L/R
// and a venue's gate panels. A pair slides apart in local X over `duration`
// when a visitor is within `open` metres and closes again beyond `close`.
// Panels keep their authored base position, so a gate authored off-centre
// (or a plot door at the identity) both work.
import * as THREE from 'three';

const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

export function createDoorSystem() {
  const doors = new Map();
  return {
    add(id, { left, right, at, slide = 1.2, open = 2.4, close = 3.1, duration = 0.7 }) {
      doors.set(id, {
        left, right, at: at.clone(), slide, open, close, duration,
        open01: 0, target: 0, baseL: left.position.x, baseR: right.position.x,
      });
    },
    remove(id) {
      const d = doors.get(id);
      if (!d) return;
      d.left.position.x = d.baseL;
      d.right.position.x = d.baseR;
      doors.delete(id);
    },
    update(dt, p) {
      for (const d of doors.values()) {
        const dist = Math.hypot(p.x - d.at.x, p.z - d.at.z);
        d.target = dist < d.open ? 1 : dist > d.close ? 0 : d.target;
        d.open01 = THREE.MathUtils.clamp(d.open01 + Math.sign(d.target - d.open01) * (dt / d.duration), 0, 1);
        const e = ease(d.open01);
        d.left.position.x = d.baseL - d.slide * e;
        d.right.position.x = d.baseR + d.slide * e;
      }
    },
    state() { return [...doors].map(([id, d]) => ({ id, open: +d.open01.toFixed(2) })); },
    get count() { return doors.size; },
  };
}
