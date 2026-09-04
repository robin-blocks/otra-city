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

// Draw one board into a context at (ox, oy), 512 x 320.
//
// The layout is a table rather than a stack of guessed baselines: a header
// strip carrying the ADDRESS, a hairline, the name, the tagline, then two
// footer lines. Every row auto-fits its own width, so a long road name or a
// long builder shrinks instead of running under the border — the address used
// to be squeezed into the top-right corner against the name, which is what it
// looked like: squeezed.
//
// The tagline gets a BOX rather than a row: `y` is its first baseline and
// `bottom` the last one it may use, and `drawBlock` picks the largest size
// that fits the wrap inside it. Two fixed lines at one fixed size held about
// 62 characters while the spec lets a tagline be 80, so the board was cutting
// sentences the city had accepted — the two numbers now agree by construction.
const ROW = {
  padX: 30, right: 482,
  address: { y: 44, px: 20, min: 13 },
  rule: 62,
  title: { y: 116, px: 46, min: 22 },
  subtitle: { y: 158, bottom: 224, px: 24, min: 16, lead: 1.34 },
  foot1: { y: 250, px: 20, min: 14 },
  foot2: { y: 288, px: 22, min: 15 },
};

// Greedy word wrap at the context's current font. A word too long for a line
// of its own is broken rather than allowed to run off the board: a tagline is
// free text, and one 90-character url would otherwise overhang the border.
function wrapText(x, text, W) {
  const lines = [];
  let cur = '';
  for (let word of String(text || '').trim().split(/\s+/).filter(Boolean)) {
    while (x.measureText(word).width > W) {
      let cut = word.length;
      while (cut > 1 && x.measureText(word.slice(0, cut)).width > W) cut -= 1;
      if (cur) { lines.push(cur); cur = ''; }
      lines.push(word.slice(0, cut));
      word = word.slice(cut);
    }
    const test = cur ? `${cur} ${word}` : word;
    if (cur && x.measureText(test).width > W) { lines.push(cur); cur = word; }
    else cur = test;
  }
  if (cur) lines.push(cur);
  return lines;
}

// Fit `text` into the block `spec` describes: the largest size at or below
// `px` whose wrap fits between the first baseline and `bottom`. Smaller type
// buys lines as well as width, so the search is over both at once. Only if
// even `min` overruns is the last line cut with an ellipsis — for a tagline
// inside the spec's 80-character cap that never happens.
function drawBlock(x, text, spec, W, fill) {
  let px = spec.px;
  let lead = 0;
  let max = 1;
  let lines = [];
  for (;;) {
    x.font = `${px}px Menlo, monospace`;
    lead = Math.round(px * spec.lead);
    max = 1 + Math.max(0, Math.floor((spec.bottom - spec.y) / lead));
    lines = wrapText(x, text, W);
    if (lines.length <= max || px <= spec.min) break;
    px -= 2;
  }
  if (lines.length > max) {
    lines = lines.slice(0, max);
    let last = lines[max - 1];
    while (last && x.measureText(`${last}…`).width > W) last = last.slice(0, -1);
    lines[max - 1] = `${last}…`;
  }
  x.fillStyle = fill;
  lines.forEach((t, i) => x.fillText(t, ROW.padX, spec.y + i * lead));
}

function drawBoard(x, ox, oy, { address, title, subtitle, foot1, foot2, color }) {
  const W = ROW.right - ROW.padX;
  // shrink-to-fit: the widest size at or below `px` that holds `text` in W
  const fit = (text, weight, spec) => {
    let px = spec.px;
    x.font = `${weight}${px}px Menlo, monospace`;
    while (px > spec.min && x.measureText(text).width > W) {
      px -= 2;
      x.font = `${weight}${px}px Menlo, monospace`;
    }
    return px;
  };
  const line = (text, weight, spec, fill, y = spec.y) => {
    if (!text) return;
    fit(text, weight, spec);
    x.fillStyle = fill;
    x.fillText(text, ROW.padX, y);
  };
  x.save();
  x.translate(ox, oy);
  x.textAlign = 'left';
  x.textBaseline = 'alphabetic';
  x.fillStyle = '#0d0a14';
  x.fillRect(0, 0, BOARD_W, BOARD_H);
  x.strokeStyle = color;
  x.lineWidth = 6;
  x.strokeRect(9, 9, 494, 302);

  line(address, '', ROW.address, '#8a86a0');
  x.strokeStyle = color;
  x.globalAlpha = 0.45;
  x.lineWidth = 2;
  x.beginPath();
  x.moveTo(ROW.padX, ROW.rule);
  x.lineTo(ROW.right, ROW.rule);
  x.stroke();
  x.globalAlpha = 1;

  line(title, '700 ', ROW.title, color);

  // the tagline fills its box and stops at `bottom`, so the footer never
  // moves and never collides with it
  drawBlock(x, subtitle, ROW.subtitle, W, '#e9edf6');

  line(foot1, '', ROW.foot1, '#8a86a0');
  line(foot2, '', ROW.foot2, '#2fe0f8');
  x.restore();
}

// what a claimed lot's board says
const claimedFields = (plot, color) => ({
  address: (plot.address || '').toUpperCase(),
  title: plot.name,
  subtitle: plot.tagline,
  foot1: `built by ${plot.builder || 'unknown'}`,
  foot2: `otra.city/s/${plot.slug}`,
  color,
});
// and what a free one says: the id an agent types, and where to type it
const vacantFields = (v) => ({
  address: (v.address || '').toUpperCase(),
  title: 'VACANT LOT',
  subtitle: 'your project could stand here',
  foot1: `lot ${v.lot}`,
  foot2: `otra.city/claim?lot=${v.lot}`,
  color: '#47f2ff',
});

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
    new THREE.MeshBasicMaterial({ map: boardTexture(claimedFields(plot, '#' + accent.getHexString())) }));
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
      drawBoard(x, col * BOARD_W, row * BOARD_H, vacantFields(v));
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
