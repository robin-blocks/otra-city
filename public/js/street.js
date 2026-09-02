// City-owned street, driven by the street-segment manifest (/plots/index.json)
// which CI generates from the land registry + every accepted plot.json.
import * as THREE from 'three';

export const LOT_PITCH = 12;
export const FRONT_LINE = 6.5;

const LOT_HALF = 5;           // plots are a 10 x 10 m envelope (plot-spec size_m)
const ROAD_MARGIN = 1;        // kerb beyond the outermost lot
const LAMP_INSET = 12;        // lamps and lane dashes stop short of the road ends
const LAUNCH_HALF_LOTS = 36;  // never shrink below the street the city launched with
const SEGMENT_WARN = 120;     // ~40 plots: past here the boulevard wants segmenting

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
  const sources = [];   // light sources for the city's light pool (js/lights.js)

  const asphalt = mat(0x17161c);
  const paving = mat(0x24222c, { roughness: 0.85 });
  const dark = mat(0x241f38);
  // One material per fixture kind, not one per fixture: the dash and lamp-head
  // counts grow with the street, and a material each would grow with them.
  const dashGlow = emat(0xffbf80, 0.5);
  const lampGlow = emat(0xffbf80, 2.5);

  // The land registry hands out lots from an ENDLESS ring (the positions()
  // generator in build-manifest.mjs), so the road, the lamp run and the
  // walkable bounds are all DERIVED from how far the city has actually been
  // claimed. Hardcoding them is how a plot ends up on a lot with no road under
  // it that nobody can walk to. With today's outermost lot at x = 36 this
  // reproduces the original 84 m street exactly, lamp for lamp.
  const xs = [...manifest.lots, ...(manifest.vacant || [])].map((l) => Math.abs(l.x));
  const halfLen = Math.max(...xs, LAUNCH_HALF_LOTS) + LOT_HALF + ROAD_MARGIN;
  if (halfLen > SEGMENT_WARN) {
    console.warn(`otra.city: the boulevard is ${(halfLen * 2).toFixed(0)} m long — time to split it into segments`);
  }

  box(halfLen * 2, 0.12, 8, asphalt, 0, -0.05, 0, g, colliders);
  box(halfLen * 2, 0.3, 2.5, paving, 0, 0.0, 5.25, g, colliders);
  box(halfLen * 2, 0.3, 2.5, paving, 0, 0.0, -5.25, g, colliders);
  const lampMax = halfLen - LAMP_INSET;
  for (let x = -lampMax; x <= lampMax + 1e-6; x += 4.5) {
    box(0.9, 0.03, 0.16, dashGlow, x, 0.02, 0, g);
  }
  // A lamp's kerb is derived from its own x, never from its index in the run:
  // extending the street westward would otherwise flip every lamp in the city
  // to the opposite side of the road.
  for (let x = -lampMax; x <= lampMax + 1e-6; x += LOT_PITCH) {
    const lz = (Math.round((x - LOT_PITCH / 2) / LOT_PITCH) % 2 === 0 ? 1 : -1) * 6.2;
    box(0.14, 3.3, 0.14, dark, x, 1.65, lz, g, colliders);
    box(0.34, 0.14, 0.34, lampGlow, x, 3.37, lz, g);
    // A lamp registers a light SOURCE rather than owning a PointLight: there is
    // now one lamp per lot pitch, so the run grows with the city, and every
    // MeshStandardMaterial fragment loops over every point light in the scene.
    // The pool (js/lights.js) lights whichever lamps the visitor is nearest.
    sources.push({ position: new THREE.Vector3(x, 3.4, lz), color: 0xffbf80, intensity: 40, distance: 26, decay: 2 });
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
    // How far a visitor may walk: the road's own extent, less a 2 m kerb.
    bounds: { x: halfLen - 2, z: 40 },
    sources,
    update(dt) {
      t += dt;
      for (const m of animated) {
        m.rotation.y += dt * 0.8;
        m.position.y = 1.9 + Math.sin(t * 1.4) * 0.08;
      }
    },
  };
}
