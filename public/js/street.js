// City-owned street, driven by the street-segment manifest (/plots/index.json)
// which CI generates from the land registry + every accepted plot.json.
import * as THREE from 'three';

export const LOT_PITCH = 12;
export const FRONT_LINE = 6.5;

const mat = (color, opts = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.92, ...opts });
const emat = (color, intensity, base = 0x0d0a14) =>
  new THREE.MeshStandardMaterial({ color: base, emissive: color, emissiveIntensity: intensity, roughness: 0.7 });

function boardTexture({ name, tagline, by, slug, color, vacant }) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 320;
  const x = c.getContext('2d');
  x.fillStyle = '#0d0a14';
  x.fillRect(0, 0, 512, 320);
  x.strokeStyle = color;
  x.lineWidth = 6;
  x.strokeRect(9, 9, 494, 302);
  x.fillStyle = color;
  let px = 52;
  x.font = `700 ${px}px Menlo, monospace`;
  while (x.measureText(name).width > 450 && px > 24) {
    px -= 4;
    x.font = `700 ${px}px Menlo, monospace`;
  }
  x.fillText(name, 30, 88);
  x.fillStyle = '#e9edf6';
  x.font = '26px Menlo, monospace';
  const words = (tagline || '').split(' ');
  let line = '';
  let ty = 148;
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (x.measureText(test).width > 450) {
      x.fillText(line, 30, ty);
      ty += 36;
      line = w;
    } else {
      line = test;
    }
  }
  if (line) x.fillText(line, 30, ty);
  x.fillStyle = '#8a86a0';
  x.font = '22px Menlo, monospace';
  x.fillText(vacant ? 'visitors are points - points buy lots' : 'built by ' + by, 30, 250);
  x.fillStyle = '#2fe0f8';
  x.fillText(vacant ? 'otra.city/claim' : 'otra.city/s/' + slug, 30, 288);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function box(w, h, d, material, x, y, z, parent, collide) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  parent.add(m);
  if (collide) collide.push(m);
  return m;
}

function infoBoard(parent, colliders, interactables, plot, bx, bz, side) {
  const accent = new THREE.Color(plot.color || '#47f2ff');
  box(0.16, 0.95, 0.16, new THREE.MeshStandardMaterial({ color: 0x241f38 }), bx, 0.48, bz, parent, colliders);
  box(0.18, 0.18, 0.18, emat(accent, 1.8), bx, 1.0, bz, parent);
  const grp = new THREE.Group();
  grp.position.set(bx, 1.34, bz);
  grp.rotation.order = 'YXZ';
  grp.rotation.set(-0.3, side > 0 ? Math.PI : 0, 0);
  const backing = new THREE.Mesh(new THREE.BoxGeometry(1.78, 1.16, 0.06),
    new THREE.MeshStandardMaterial({ color: 0x241f38, roughness: 0.8 }));
  grp.add(backing);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.06),
    new THREE.MeshBasicMaterial({ map: boardTexture({ ...plot, by: plot.builder, color: '#' + accent.getHexString() }) }));
  face.position.z = 0.036;
  grp.add(face);
  parent.add(grp);
  face.userData.link = { name: plot.name, url: plot.vacant ? 'https://otra.city/claim' : plot.url };
  interactables.push(face);
}

export async function loadStreet(scene) {
  const manifest = await (await fetch('/plots/index.json?t=' + Date.now())).json();
  const g = new THREE.Group();
  scene.add(g);
  const colliders = [];
  const animated = [];
  const interactables = [];

  const asphalt = mat(0x17161c);
  const paving = mat(0x24222c, { roughness: 0.85 });
  const dark = mat(0x241f38);

  box(84, 0.12, 8, asphalt, 0, -0.05, 0, g, colliders);
  box(84, 0.3, 2.5, paving, 0, 0.0, 5.25, g, colliders);
  box(84, 0.3, 2.5, paving, 0, 0.0, -5.25, g, colliders);
  for (let x = -30; x <= 30; x += 4.5) {
    box(0.9, 0.03, 0.16, emat(0xffbf80, 0.5), x, 0.02, 0, g);
  }
  for (const [i, lx] of [-30, -18, -6, 6, 18, 30].entries()) {
    const lz = (i % 2 === 0 ? -1 : 1) * 6.2;
    box(0.14, 3.3, 0.14, dark, lx, 1.65, lz, g, colliders);
    box(0.34, 0.14, 0.34, emat(0xffbf80, 2.5), lx, 3.37, lz, g);
    const light = new THREE.PointLight(0xffbf80, 40, 26, 2);
    light.position.set(lx, 3.4, lz);
    g.add(light);
  }

  for (const p of manifest.lots) {
    infoBoard(g, colliders, interactables, p, p.x + 3.4, p.side * (FRONT_LINE - 0.45), p.side);
  }
  for (const v of manifest.vacant || []) {
    const vz = v.side * (FRONT_LINE + 5);
    box(10, 0.1, 10, mat(0x1b1926), v.x, 0.01, vz, g, colliders);
    const glow = emat(0x47f2ff, 1.1);
    box(10, 0.05, 0.1, glow, v.x, 0.09, vz - 5, g);
    box(10, 0.05, 0.1, glow, v.x, 0.09, vz + 5, g);
    box(0.1, 0.05, 10, glow, v.x - 5, 0.09, vz, g);
    box(0.1, 0.05, 10, glow, v.x + 5, 0.09, vz, g);
    for (const [sx, sz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
      box(0.18, 0.5, 0.18, dark, v.x + sx * 4.8, 0.3, vz + sz * 4.8, g, colliders);
    }
    const marker = box(0.45, 0.45, 0.45, emat(0x47f2ff, 1.6), v.x, 1.9, vz, g, colliders);
    animated.push(marker);
    infoBoard(g, colliders, interactables, {
      name: 'VACANT LOT', tagline: 'your project could stand here', builder: 'otra.city land office',
      slug: 'claim', color: '#47f2ff', vacant: true,
    }, v.x + 3.4, v.side * (FRONT_LINE - 0.45), v.side);
  }

  let t = 0;
  return {
    manifest,
    group: g,
    colliders,
    interactables,
    update(dt) {
      t += dt;
      for (const m of animated) {
        m.rotation.y += dt * 0.8;
        m.position.y = 1.9 + Math.sin(t * 1.4) * 0.08;
      }
    },
  };
}
