// Voxel robot avatar — the default otra.city citizen. Built from boxes to
// match the city aesthetic; parts are pivoted so the walk cycle can swing them.
import * as THREE from 'three';

const C = {
  shell: 0xe9edf6,
  dark: 0x241f38,
  accent: 0xff2d95,
  visor: 0x47f2ff,
  antenna: 0xffdf4d,
};

function part(w, h, d, color, { pivotTop = false, emissive = null, glow = 2.2 } = {}) {
  const geo = new THREE.BoxGeometry(w, h, d);
  if (pivotTop) geo.translate(0, -h / 2, 0); // origin at the joint
  const mat = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.8,
    metalness: 0.05,
    ...(emissive ? { emissive, emissiveIntensity: glow } : {}),
  });
  return new THREE.Mesh(geo, mat);
}

export function createAvatar(accent = null) {
  // accent: optional hex tint for visor/chest — gives each session-anonymous
  // citizen a distinct look without accounts
  const C2 = { ...C };
  if (accent !== null) {
    C2.visor = accent;
    C2.accent = accent;
  }
  const group = new THREE.Group(); // world position = feet, rotation.y = facing
  const body = new THREE.Group(); // bobs + leans while walking
  group.add(body);

  const legL = part(0.16, 0.42, 0.2, C.dark, { pivotTop: true });
  const legR = legL.clone();
  legL.position.set(-0.11, 0.42, 0);
  legR.position.set(0.11, 0.42, 0);

  const torso = part(0.44, 0.5, 0.26, C.shell);
  torso.position.y = 0.67;
  const chest = part(0.1, 0.1, 0.03, C.dark, { emissive: C2.accent });
  chest.position.set(0, 0.72, 0.14);

  const armL = part(0.13, 0.44, 0.17, C.dark, { pivotTop: true });
  const armR = armL.clone();
  armL.position.set(-0.3, 0.9, 0);
  armR.position.set(0.3, 0.9, 0);

  const head = part(0.34, 0.3, 0.3, C.shell);
  head.position.y = 1.08;
  const visor = part(0.24, 0.09, 0.03, C.dark, { emissive: C2.visor });
  visor.position.set(0, 1.1, 0.16);

  const antenna = new THREE.Group();
  const stem = part(0.03, 0.14, 0.03, C.dark);
  stem.position.y = 0.07;
  const tip = part(0.08, 0.08, 0.08, C.dark, { emissive: C.antenna, glow: 1.6 });
  tip.position.y = 0.18;
  antenna.add(stem, tip);
  antenna.position.y = 1.23;

  body.add(legL, legR, torso, chest, armL, armR, head, visor, antenna);

  let phase = 0;
  function update(dt, speed, time) {
    const amp = Math.min(speed / 3.2, 1.4);
    phase += dt * speed * 3.4;
    const s = Math.sin(phase);
    legL.rotation.x = s * 0.62 * amp;
    legR.rotation.x = -s * 0.62 * amp;
    armL.rotation.x = -s * 0.42 * amp;
    armR.rotation.x = s * 0.42 * amp;
    body.position.y = Math.abs(Math.cos(phase)) * 0.045 * amp;
    body.rotation.x = 0.07 * amp;
    antenna.rotation.z = Math.sin(time * 2.2) * 0.07 + s * 0.1 * amp;
  }

  return { group, update };
}
