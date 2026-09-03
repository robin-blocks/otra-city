// Lot furniture, driven by the street manifest (/plots/index.json) which CI
// generates from the plat, the land registry and every accepted plot.json:
// an information board at every claimed lot, and a pad, a marker and a board
// at every VACANT lot, each board naming the lot and linking to the claim
// page for exactly that lot. The roads themselves are js/roads.js; where a
// lot stands is the manifest's word (x, z, yaw), decided by the plat.
//
// A claimed lot's board is its own mesh with its own texture — there are as
// many as plots, and they are inside the per-plot budget. Vacant lots are
// unbounded, so theirs are instanced (pads, strips, posts, markers, board
// hardware) and their board faces share one atlas texture per 64 lots,
// merged into one mesh: a district of thirty vacant lots costs about ten
// draw calls, and a click still resolves to the one board that was hit.
import * as THREE from 'three';
import { lotToWorld, BOARD_LOCAL, LOT_HALF } from '/js/city-map.mjs';
import { createInstancer, mergedQuads } from '/js/geom.js';

export { LOT_HALF };

const BOARD_W = 512;
const BOARD_H = 320;
const ATLAS_COLS = 8;   // 8 x 8 boards of 512 x 320 = 4096 x 2560, inside every GPU's texture cap

const mat = (color, opts = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.92, ...opts });
const emat = (color, intensity, base = 0x0d0a14) =>
  new THREE.MeshStandardMaterial({ color: base, emissive: color, emissiveIntensity: intensity, roughness: 0.7 });

// Draw one board into a context at (ox, oy). A claimed board carries the
// plot's name, tagline, builder, permalink and its address; a vacant board
// carries the address, the lot id and the claim url — the id is what an agent
// types, the address is what a visitor remembers.
function drawBoard(x, ox, oy, { name, tagline, by, slug, color, vacant, address, lot }) {
  x.save();
  x.translate(ox, oy);
  x.textAlign = 'left';
  x.textBaseline = 'alphabetic';
  x.fillStyle = '#0d0a14';
  x.fillRect(0, 0, BOARD_W, BOARD_H);
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
  x.font = '22px Menlo, monospace';
  if (vacant) {
    x.fillStyle = '#8a86a0';
    x.fillText('your project could stand here', 30, 214);
    x.fillStyle = '#e9edf6';
    x.fillText(`lot ${lot}`, 30, 250);
    x.fillStyle = '#2fe0f8';
    x.fillText(`otra.city/claim?lot=${lot}`, 30, 288);
  } else {
    x.fillStyle = '#8a86a0';
    x.fillText('built by ' + by, 30, 250);
    x.fillStyle = '#2fe0f8';
    x.fillText('otra.city/s/' + slug, 30, 288);
    if (address) {
      x.fillStyle = '#8a86a0';
      x.font = '18px Menlo, monospace';
      x.textAlign = 'right';
      x.fillText(address, 478, 38);
    }
  }
  x.restore();
}

function boardTexture(fields) {
  const c = document.createElement('canvas');
  c.width = BOARD_W;
  c.height = BOARD_H;
  drawBoard(c.getContext('2d'), 0, 0, fields);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// The board's frame in world space: on the pavement beside the frontage,
// tilted back a little, facing the road like the plot does.
function boardFrame(lot) {
  const p = lotToWorld(lot, ...BOARD_LOCAL);
  const o = new THREE.Object3D();
  o.rotation.order = 'YXZ';
  o.position.set(p.x, 1.34, p.z);
  o.rotation.set(-0.3, lot.yaw, 0);
  o.updateMatrix();
  return { x: p.x, z: p.z, matrix: o.matrix.clone() };
}

function claimedBoard(parent, colliders, interactables, plot) {
  const accent = new THREE.Color(plot.color || '#47f2ff');
  const f = boardFrame(plot);
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.95, 0.16), new THREE.MeshStandardMaterial({ color: 0x241f38 }));
  post.position.set(f.x, 0.48, f.z);
  parent.add(post);
  colliders.push(post);
  const cube = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.18), emat(accent, 1.8));
  cube.position.set(f.x, 1.0, f.z);
  parent.add(cube);
  const grp = new THREE.Group();
  grp.matrixAutoUpdate = false;
  grp.matrix.copy(f.matrix);
  const backing = new THREE.Mesh(new THREE.BoxGeometry(1.78, 1.16, 0.06),
    new THREE.MeshStandardMaterial({ color: 0x241f38, roughness: 0.8 }));
  grp.add(backing);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.06),
    new THREE.MeshBasicMaterial({ map: boardTexture({ ...plot, by: plot.builder, color: '#' + accent.getHexString() }) }));
  face.position.z = 0.036;
  grp.add(face);
  parent.add(grp);
  face.userData.link = { name: plot.name, url: plot.url };
  interactables.push(face);
}

// Everything a vacant lot shows, for every vacant lot at once.
function vacantLots(parent, colliders, interactables, vacant) {
  const animated = [];
  if (!vacant.length) return { animated, marker: null };
  const inst = createInstancer(parent, colliders);
  const unit = new THREE.BoxGeometry(1, 1, 1);
  const cyan = 0x47f2ff;
  inst.kind('pad', unit, mat(0x1b1926), { collide: true });
  inst.kind('strip', unit, emat(cyan, 1.1));
  inst.kind('post', unit, mat(0x241f38), { collide: true });
  inst.kind('marker', unit, emat(cyan, 1.6), { collide: true, dynamic: true });
  inst.kind('board_post', unit, mat(0x241f38), { collide: true });
  inst.kind('board_cube', unit, emat(cyan, 1.8));
  inst.kind('backing', unit, mat(0x241f38, { roughness: 0.8 }));
  const at = (lot, lx, ly, lz, extra = {}) => {
    const p = lotToWorld(lot, lx, lz);
    return { x: p.x, y: ly, z: p.z, ry: lot.yaw, ...extra };
  };
  const quads = [];
  const links = [];
  for (const v of vacant) {
    inst.add('pad', at(v, 0, 0.01, 0, { sx: 10, sy: 0.1, sz: 10 }));
    for (const lz of [-5, 5]) inst.add('strip', at(v, 0, 0.09, lz, { sx: 10, sy: 0.05, sz: 0.1 }));
    for (const lx of [-5, 5]) inst.add('strip', at(v, lx, 0.09, 0, { sx: 0.1, sy: 0.05, sz: 10 }));
    for (const [sx, sz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
      inst.add('post', at(v, sx * 4.8, 0.3, sz * 4.8, { sx: 0.18, sy: 0.5, sz: 0.18 }));
    }
    const mi = inst.add('marker', at(v, 0, 1.9, 0, { sx: 0.45, sy: 0.45, sz: 0.45 }));
    animated.push({ index: mi, lot: v });
    const f = boardFrame(v);
    inst.add('board_post', { x: f.x, y: 0.48, z: f.z, ry: v.yaw, sx: 0.16, sy: 0.95, sz: 0.16 });
    inst.add('board_cube', { x: f.x, y: 1.0, z: f.z, ry: v.yaw, sx: 0.18, sy: 0.18, sz: 0.18 });
    inst.add('backing', { x: f.x, y: 1.34, z: f.z, ry: v.yaw, rx: -0.3, sx: 1.78, sy: 1.16, sz: 0.06 });
    quads.push({ matrix: f.matrix, w: 1.7, h: 1.06, dz: 0.036 });
    links.push({ name: `vacant lot ${v.lot}`, url: v.claim });
  }
  const meshes = inst.flush();
  // board faces: one atlas per 64 lots, one mesh per atlas
  const per = ATLAS_COLS * ATLAS_COLS;
  for (let start = 0; start < vacant.length; start += per) {
    const chunk = vacant.slice(start, start + per);
    const cols = Math.min(ATLAS_COLS, chunk.length);
    const rows = Math.ceil(chunk.length / cols);
    const c = document.createElement('canvas');
    c.width = cols * BOARD_W;
    c.height = rows * BOARD_H;
    const x = c.getContext('2d');
    const chunkQuads = [];
    chunk.forEach((v, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      drawBoard(x, col * BOARD_W, row * BOARD_H, {
        name: 'VACANT LOT', tagline: v.address, color: '#47f2ff', vacant: true, lot: v.lot, address: v.address,
      });
      // atlas cell -> uv; v = 1 is the canvas top
      chunkQuads.push({ ...quads[start + i], uv: [col / cols, 1 - (row + 1) / rows, (col + 1) / cols, 1 - row / rows] });
    });
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const faces = new THREE.Mesh(mergedQuads(chunkQuads), new THREE.MeshBasicMaterial({ map: tex }));
    faces.name = `vacant_boards:${start / per}`;
    const chunkLinks = links.slice(start, start + per);
    // the link for whichever quad a ray hit: two triangles per quad, in order
    faces.userData.linkAt = (faceIndex) => chunkLinks[Math.floor(faceIndex / 2)] || null;
    parent.add(faces);
    interactables.push(faces);
  }
  return { animated, marker: meshes.marker };
}

export async function loadStreet(scene) {
  const manifest = await (await fetch('/plots/index.json?t=' + Date.now())).json();
  const g = new THREE.Group();
  g.name = 'street';
  scene.add(g);
  const colliders = [];
  const animated = [];
  const interactables = [];
  const sources = [];   // lamps are the roads' now; kept so callers need not care

  for (const p of manifest.lots) claimedBoard(g, colliders, interactables, p);
  const vac = vacantLots(g, colliders, interactables, manifest.vacant || []);
  const dummy = new THREE.Object3D();

  let t = 0;
  return {
    manifest,
    group: g,
    colliders,
    interactables,
    sources,
    get vacant() { return manifest.vacant || []; },
    update(dt) {
      t += dt;
      if (!vac.marker) return;
      for (const m of vac.animated) {
        dummy.position.set(m.lot.x, 1.9 + Math.sin(t * 1.4) * 0.08, m.lot.z);
        dummy.rotation.set(0, t * 0.8, 0);
        dummy.scale.setScalar(0.45);
        dummy.updateMatrix();
        vac.marker.setMatrixAt(m.index, dummy.matrix);
      }
      vac.marker.instanceMatrix.needsUpdate = true;
    },
  };
}
