// The city's own shopfront: the building a listing gets when it sends no
// build of its own. A directory submission is a url, a name, a sentence and a
// category — the same payload PromptFrenzy's directory takes — and the city
// turns it into a walkable shop on the category's road.
//
// v2 is a return to how the first shopfronts were made (poc/blender/
// 02_build_shop.py): one texture holding both a colour palette and the art, so
// that four materials buy a lit fascia sign with the shop's NAME on it, a
// readable panel inside, a link plaque, and glass you can see through — rather
// than four flat colours and a building that cannot say what it is. v1 was
// "pure geometry, no textures, no text", and the buildings it made were mute:
// the name lived only on the kerb board, which the client draws and the poster
// renderer therefore never sees. A listing's poster is its og:image. A shop
// whose name is not in its own glb is a shop nobody can share.
//
// Deterministic: the same inputs always produce the same bytes, so a template
// build can be regenerated when the template improves (`template.version` in
// plot.json says which one a plot was built with) and a dry run's verdict is
// the verdict.
//
// Everything below is built to public/docs/plot-spec.json: the 10x10x6
// envelope with the facade inset to z = 4.75, the door standard (3 m rough
// opening at x = 0, two 1.25 m panels parked in the wall depth, sill and floor
// at 0.25 m), full 0..1 UVs on every media quad, no two same-facing faces on
// one plane, four materials, three lights or fewer, textures within 1024 px.
// It is validated by the same validator every submission meets — a template
// that failed it would be the city rejecting its own building.
import { Document, NodeIO } from '@gltf-transform/core';
import { KHRMaterialsEmissiveStrength, KHRLightsPunctual } from '@gltf-transform/extensions';
import { categoryOf, hsl, DEFAULT_CATEGORY } from '../public/js/categories.mjs';
import { buildAtlas, ATLAS_SIZE, REGIONS } from './template-atlas.mjs';
import { voxeliseLogo } from './logo-voxels.mjs';

export const TEMPLATE_ID = 'shopfront';
export const TEMPLATE_VERSION = 2;
export const VARIANTS = ['shop', 'tower', 'awning'];

// The picture quads a template build carries, in the order images fill them:
// pic_1 is the facade billboard, pic_2 the wall facing the door inside.
export const PICTURE_NODES = ['pic_1', 'pic_2'];

function fnv(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function variantFor(slug) {
  return VARIANTS[fnv(String(slug)) % VARIANTS.length];
}

// ---------------------------------------------------------------- geometry
// Axis-aligned boxes and single quads, accumulated per material into one
// primitive each, so a whole facade is one draw call. Winding is glTF's
// counter-clockwise-from-outside. Structure samples the atlas at a single
// palette cell — every vertex of every face of a box shares one UV, which is
// what lets a shop be one colour-mapped mesh with no unwrapping. Art quads get
// the full 0..1 box of their region, with v = 0 along the top edge, where glTF
// (and the client, flipY = false) expects the top of the image.
class MeshBuf {
  constructor() { this.pos = []; this.nrm = []; this.uv = []; this.idx = []; }

  get empty() { return this.idx.length === 0; }

  face(verts, n, uvs) {
    const base = this.pos.length / 3;
    for (const p of verts) this.pos.push(p[0], p[1], p[2]);
    for (let i = 0; i < 4; i++) this.nrm.push(n[0], n[1], n[2]);
    for (const t of uvs) this.uv.push(t[0], t[1]);
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /** A box whose every face samples one palette cell. */
  box([x0, y0, z0], [x1, y1, z1], uv) {
    const flat = [uv, uv, uv, uv];
    this.face([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1], flat);
    this.face([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [0, 0, -1], flat);
    this.face([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [1, 0, 0], flat);
    this.face([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0], flat);
    this.face([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], [0, 1, 0], flat);
    this.face([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [0, -1, 0], flat);
  }

  /** A quad in the plane z = z facing +z, carrying a region's UVs. */
  quadZ([x0, y0], [x1, y1], z, [u0, vTop, u1, vBot]) {
    this.face(
      [[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]], [0, 0, 1],
      [[u0, vBot], [u1, vBot], [u1, vTop], [u0, vTop]],
    );
  }
}

// ------------------------------------------------------------------ design
// One shop, three silhouettes. Dimensions in metres, glTF axes: x across the
// frontage, y up, +z toward the street. The wall is 0.25 m thick with its
// street face at z = 4.75 (the facade line); the 0.25 m in front of it is the
// signage zone, where the fascia, the neon and the awning live.
const FACADE = 4.75;
const T = 0.25;          // wall thickness
const SILL = 0.25;       // floor top / door sill
const DOOR_HALF = 1.5;   // 3 m rough opening
const DOOR_TOP = SILL + 3;
const PROUD = 0.04;      // how far lit panels stand off the wall (> 2 mm rule)

// the fascia band, sized to the sign region's aspect so type is never stretched
const SIGN_W = 5.2;
const SIGN_H = SIGN_W * (REGIONS.sign[3] / REGIONS.sign[2]);
const WIN = { y0: 1.2, y1: 3.0 };   // the shop windows

// The tower's crown sits at H + 1.0 (roof slab, parapet block, neon crest), so
// its wall height is what the 6 m envelope has room for, not what looks best
// on its own.
function design(variant) {
  const H = variant === 'tower' ? 4.9 : 4.6;
  return { H, roofTop: H + T };
}

/** The uv box of a region, as the quad helpers want it. */
const region = (atlas, name) => atlas.uv(name);

export function buildTemplate({
  slug, category, color = null, images = 0,
  name = '', tagline = '', builder = '', url = '', logo = null, primaryColor = null,
} = {}) {
  const cat = categoryOf(category) || categoryOf(DEFAULT_CATEGORY);
  const variant = variantFor(slug);
  const { H, roofTop } = design(variant);

  // The accent is the listing's colour when it sent one, else the category's;
  // the body colour is derived from it so a shop reads as one object rather
  // than a grey box with a coloured hat.
  const accentHex = color || hsl(cat.hue, 0.95, 0.6);
  const primaryHex = primaryColor || hsl(cat.hue, 0.34, 0.26);
  let host = '';
  try { host = url ? new URL(url).host.replace(/^www\./, '') : ''; } catch { host = ''; }

  const logoPixels = logo ? voxeliseLogo(logo) : null;
  const atlas = buildAtlas({
    name, tagline, builder, host, category: cat.id,
    primary: primaryHex, accent: accentHex, logoPixels,
  });
  const P = (key) => atlas.cell(key);

  const voxel = new MeshBuf();     // structure: walls, roof, floor, fittings
  const neon = new MeshBuf();      // the accent, bright
  const lintel = new MeshBuf();    // the strip over the door, its own node so it can breathe
  const logoBuf = new MeshBuf();   // the extruded mark, if we could build one
  const glass = new MeshBuf();     // the windows
  const doorL = new MeshBuf();
  const doorR = new MeshBuf();
  const sign = new MeshBuf();
  const panel = new MeshBuf();
  const link = new MeshBuf();
  const pics = [new MeshBuf(), new MeshBuf()];

  const zBack = -FACADE;
  const zFrontBack = FACADE - T;

  // ------------------------------------------------------------- structure
  // Side and back walls stop at the front wall's back face so no two boxes
  // share a plane facing the same way.
  voxel.box([-FACADE, 0, zBack], [-FACADE + T, H, zFrontBack], P('wall'));
  voxel.box([FACADE - T, 0, zBack], [FACADE, H, zFrontBack], P('wall'));
  voxel.box([-FACADE + T, 0, zBack], [FACADE - T, H, zBack + T], P('wall_dark'));
  voxel.box([-FACADE, H, zBack], [FACADE, roofTop, FACADE], P('trim'));   // roof slab

  // The front wall, with a window opening either side of the door. Each side
  // becomes a sill course, a head course and an outer pier, so the glass has
  // a hole to sit in and the frontage still reads as one plane.
  const piers = [[-FACADE, -DOOR_HALF], [DOOR_HALF, FACADE]];
  const winX = [[-4.35, -1.85], [1.85, 4.35]];
  piers.forEach(([px0, px1], i) => {
    const [wx0, wx1] = winX[i];
    voxel.box([px0, 0, zFrontBack], [wx0, H, FACADE], P('wall'));           // outer pier
    voxel.box([wx1, 0, zFrontBack], [px1, H, FACADE], P('wall'));           // inner pier
    voxel.box([wx0, 0, zFrontBack], [wx1, WIN.y0, FACADE], P('wall_dark')); // under the glass
    voxel.box([wx0, WIN.y1, zFrontBack], [wx1, H, FACADE], P('wall'));      // over the glass
    // glass sits in the middle of the wall depth: coplanar with neither face
    glass.box([wx0, WIN.y0, zFrontBack + 0.1], [wx1, WIN.y1, FACADE - 0.1], P('white'));
  });
  voxel.box([-DOOR_HALF, DOOR_TOP, zFrontBack], [DOOR_HALF, H, FACADE], P('wall'));   // over the door

  // floor inside the walls, and the sill that carries the step out to the kerb
  voxel.box([-FACADE + T, 0, zBack + T], [FACADE - T, SILL, zFrontBack], P('floor'));
  voxel.box([-DOOR_HALF, 0, zFrontBack], [DOOR_HALF, SILL, 4.99], P('floor_walk'));

  // door: two panels parked in the wall depth, meeting at x = 0
  doorL.box([-1.25, SILL, zFrontBack + 0.05], [0, DOOR_TOP, FACADE - 0.05], P('counter'));
  doorR.box([0, SILL, zFrontBack + 0.05], [1.25, DOOR_TOP, FACADE - 0.05], P('counter'));

  // ------------------------------------------------------------------ neon
  // Pilasters at both corners and a strip along the roofline.
  const zN0 = FACADE;
  const zN1 = FACADE + 0.15;
  neon.box([-FACADE, SILL, zN0], [-FACADE + 0.2, roofTop + 0.15, zN1], P('accent'));
  neon.box([FACADE - 0.2, SILL, zN0], [FACADE, roofTop + 0.15, zN1], P('accent'));
  neon.box([-FACADE + 0.2, roofTop, zN0], [FACADE - 0.2, roofTop + 0.15, zN1], P('accent'));
  // a sill course under each window, so the frontage has a lit line at waist height
  for (const [wx0, wx1] of winX) neon.box([wx0, WIN.y0 - 0.12, zN0], [wx1, WIN.y0 - 0.04, zN1], P('secondary'));
  // the lintel over the door, the one thing that pulses
  lintel.box([-DOOR_HALF, DOOR_TOP + 0.1, zN0], [DOOR_HALF, DOOR_TOP + 0.3, zN1], P('accent'));

  // ------------------------------------------------------------- the fascia
  // The name, on a backer that stands off the wall, centred over the door and
  // sized to the sign region so the type keeps its proportions.
  const signY0 = DOOR_TOP + 0.45;
  const signY1 = signY0 + SIGN_H;
  voxel.box([-SIGN_W / 2 - 0.1, signY0 - 0.1, zN0], [SIGN_W / 2 + 0.1, signY1 + 0.1, FACADE + 0.1], P('trim'));
  sign.quadZ([-SIGN_W / 2, signY0], [SIGN_W / 2, signY1], FACADE + 0.14, region(atlas, 'sign'));

  // ---------------------------------------------------------------- inside
  // A counter down one side, shelving with stock down the other, and the
  // plinth in the middle — the room reads as a shop through the windows, which
  // is the whole point of having windows.
  voxel.box([-4.5, SILL, -2.9], [-2.9, SILL + 0.95, 0.9], P('counter'));
  neon.box([-4.5, SILL + 0.95, -2.9], [-2.9, SILL + 1.0, 0.9], P('accent_dim'));
  const stock = ['stock_a', 'stock_b', 'stock_c'];
  [1.15, 2.05, 2.95].forEach((shelfY, si) => {
    voxel.box([3.05, shelfY, -3.0], [4.5, shelfY + 0.08, 1.8], P('counter'));
    for (let k = 0; k < 4; k++) {
      const z0 = -2.8 + k * 1.1;
      voxel.box([3.25, shelfY + 0.08, z0], [4.3, shelfY + 0.55, z0 + 0.72], P(stock[(si + k) % stock.length]));
    }
  });

  // The card facing the door, on the left of the back wall — what the kerb
  // board says, said again where someone who came in can read it.
  const PANEL_W = 3.2;
  const PANEL_H = PANEL_W * (REGIONS.panel[3] / REGIONS.panel[2]);
  const zWall = zBack + T + 0.02;
  panel.quadZ([-4.3, 1.3], [-4.3 + PANEL_W, 1.3 + PANEL_H], zWall, region(atlas, 'panel'));

  // The plinth stands just inside the left window rather than in the middle of
  // the room: it keeps the back wall clear, and it puts the logo where someone
  // walking past on the pavement can see it lit through the glass.
  const plinthTop = SILL + 0.55;
  const PLINTH_X = -2.6;
  const PLINTH_Z = 2.6;
  voxel.box([PLINTH_X - 0.9, SILL, PLINTH_Z - 0.9], [PLINTH_X + 0.9, plinthTop, PLINTH_Z + 0.9], P('counter'));
  neon.box([PLINTH_X - 0.95, plinthTop, PLINTH_Z - 0.95], [PLINTH_X + 0.95, plinthTop + 0.06, PLINTH_Z + 0.95], P('accent'));
  if (logoPixels) {
    // extruded from the submitted mark: runs of cells, already merged along x
    const { cols, rows, runs } = logoPixels;
    const cell = Math.min(1.7 / rows, 2.3 / cols);
    const ox = PLINTH_X - (cols * cell) / 2;
    const oy = plinthTop + 0.3 + rows * cell;     // grid rows count downward
    for (const [gx, gy, len] of runs) {
      logoBuf.box(
        [ox + gx * cell, oy - (gy + 1) * cell, PLINTH_Z - 0.15],
        [ox + (gx + len) * cell, oy - gy * cell, PLINTH_Z + 0.15],
        P('accent'),
      );
    }
  } else {
    // no logo we could build: the flat mark on a board, so the plinth still
    // carries something and the shop still has a face. The board stands ON the
    // neon cap rather than starting at the plinth top, so its underside is not
    // in the same plane, facing the same way, as the cap's.
    const s = 1.3;
    const boardY = plinthTop + 0.06;
    voxel.box([PLINTH_X - s / 2 - 0.06, boardY, PLINTH_Z - 0.02], [PLINTH_X + s / 2 + 0.06, boardY + s + 0.12, PLINTH_Z + 0.1], P('trim'));
    panel.quadZ([PLINTH_X - s / 2, boardY + 0.06], [PLINTH_X + s / 2, boardY + 0.06 + s], PLINTH_Z - 0.06, region(atlas, 'logo'));
  }

  // a neon skirting along the back wall, so the room carries the accent
  neon.box([-4.5, SILL, zBack + T], [4.5, SILL + 0.08, zBack + T + 0.06], P('accent'));
  // ceiling light
  neon.box([-3.2, H - 0.14, -1.4], [3.2, H - 0.02, 1.4], P('glow'));

  // ------------------------------------------------------------- the links
  // The plaque beside the door, at hand height — the client makes any link_*
  // node interactable and opens the plot's url.
  link.quadZ([-2.45, 0.72], [-1.75, 1.07], FACADE + PROUD, region(atlas, 'link'));

  // ---------------------------------------------------------- the pictures
  // pic_1 is the billboard over the right-hand window, pic_2 the right of the
  // back wall. A media node must carry FULL 0..1 UVs — the client maps the
  // image across the whole quad — so a picture node cannot also show a region
  // of the atlas. The two cases are therefore different geometry, not different
  // UVs: with a picture, a media node with 0..1 UVs; without one, the same
  // rectangle drawn as art showing the "a picture goes here" plate.
  const FULL_UV = [0, 0, 1, 1];
  const frames = [
    { rect: [[2.85, 3.55], [4.35, 4.34]], z: FACADE + PROUD },
    { rect: [[0.3, 1.3], [4.3, 3.405]], z: zWall },
  ];
  const plate = region(atlas, 'plate');
  frames.forEach((f, i) => {
    const target = i < images ? pics[i] : panel;
    target.quadZ(f.rect[0], f.rect[1], f.z, i < images ? FULL_UV : plate);
  });

  if (variant === 'tower') {
    voxel.box([-2.5, roofTop, 2.0], [2.5, roofTop + 0.6, FACADE], P('wall'));
    neon.box([-2.5, roofTop + 0.15, zN0], [-2.3, roofTop + 0.6, zN1], P('accent'));
    neon.box([2.3, roofTop + 0.15, zN0], [2.5, roofTop + 0.6, zN1], P('accent'));
    neon.box([-2.5, roofTop + 0.6, zN0], [2.5, roofTop + 0.75, zN1], P('accent'));
  } else if (variant === 'awning') {
    neon.box([-2.6, DOOR_TOP + 0.35, zN1], [2.6, DOOR_TOP + 0.5, 4.99], P('secondary'));
  }

  // ------------------------------------------------------------------ glTF
  const doc = new Document();
  const buffer = doc.createBuffer();
  const emis = doc.createExtension(KHRMaterialsEmissiveStrength);
  const lightsExt = doc.createExtension(KHRLightsPunctual);

  const texture = doc.createTexture('shopfront')
    .setImage(atlas.png)
    .setMimeType('image/png');

  const mapped = (name, { rough = 0.85, emissive = false, strength = 1 } = {}) => {
    const m = doc.createMaterial(name)
      .setBaseColorFactor([1, 1, 1, 1])
      .setMetallicFactor(0)
      .setRoughnessFactor(rough)
      .setBaseColorTexture(texture);
    if (emissive) {
      m.setEmissiveFactor([1, 1, 1]).setEmissiveTexture(texture);
      if (strength !== 1) {
        m.setExtension('KHR_materials_emissive_strength', emis.createEmissiveStrength().setEmissiveStrength(strength));
      }
    }
    return m;
  };
  const matVoxel = mapped('voxel');
  const matNeon = mapped('neon', { rough: 0.6, emissive: true, strength: 2.5 });
  const matArt = mapped('art', { rough: 0.7, emissive: true, strength: 0.85 });
  const matGlass = doc.createMaterial('glass')
    .setBaseColorFactor([0.70, 0.95, 1.0, 0.10])
    .setMetallicFactor(0)
    // rough enough not to mirror the street lamps: a glossy pane catches the
    // porch light across its whole face and the window display disappears
    // behind a sheen, which is exactly the failure this glass exists to avoid
    .setRoughnessFactor(0.34)
    .setAlphaMode('BLEND')
    .setDoubleSided(false);

  const scene = doc.createScene('shopfront');
  doc.getRoot().setDefaultScene(scene);
  const emit = (nodeName, buf, mat) => {
    if (buf.empty) return null;
    const prim = doc.createPrimitive()
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(buf.pos)).setBuffer(buffer))
      .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(buf.nrm)).setBuffer(buffer))
      .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(buf.uv)).setBuffer(buffer))
      .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(buf.idx)).setBuffer(buffer))
      .setMaterial(mat);
    const node = doc.createNode(nodeName).setMesh(doc.createMesh(nodeName).addPrimitive(prim));
    scene.addChild(node);
    return node;
  };
  emit('facade', voxel, matVoxel);
  emit('neon', neon, matNeon);
  emit('lintel', lintel, matNeon);
  emit('logo', logoBuf, matNeon);
  emit('glass', glass, matGlass);
  emit('door_panel_L', doorL, matVoxel);
  emit('door_panel_R', doorR, matVoxel);
  emit('sign_1', sign, matArt);
  emit('panel_1', panel, matArt);
  emit('link_1', link, matArt);
  // picture quads carry the "a picture goes here" plate until the client maps
  // an image over them; both are always there under their contract names, so a
  // listing that adds a picture later binds to a node that exists
  PICTURE_NODES.forEach((nodeName, i) => emit(nodeName, pics[i], matArt));
  const pictureNodes = PICTURE_NODES.slice(0, Math.max(0, Math.min(images, PICTURE_NODES.length)));

  // Three lights, which is both the spec's cap and exactly what the client's
  // light pool reserves per plot (RESERVED in public/js/lights.js), so a shop
  // that uses all three costs its neighbours nothing. The intensities are the
  // scale the first shopfront used: a dark interior is not atmosphere, it is a
  // shop nobody can see into.
  const light = (nodeName, pos, intensity, colour = [1, 0.92, 0.8]) => {
    const l = lightsExt.createLight().setType('point').setColor(colour).setIntensity(intensity);
    scene.addChild(doc.createNode(nodeName).setTranslation(pos).setExtension('KHR_lights_punctual', l));
  };
  light('light_room', [0, H - 0.5, -0.6], 5200);
  light('light_display', [PLINTH_X, plinthTop + 1.8, PLINTH_Z - 0.4], 1300);
  light('light_porch', [0, DOOR_TOP - 0.2, 4.2], 1400);

  return {
    variant,
    pictureNodes,
    logo: logoPixels ? { cells: logoPixels.cells, boxes: logoPixels.runs.length } : null,
    atlasBytes: atlas.png.length,
    // the strip over the door breathes; nothing else moves
    anims: [{ type: 'pulse', node: 'lintel', period: 2.6, depth: 0.35 }],
    color: accentHex,
    write: async () => {
      const io = new NodeIO().registerExtensions([KHRMaterialsEmissiveStrength, KHRLightsPunctual]);
      return Buffer.from(await io.writeBinary(doc));
    },
  };
}

export { ATLAS_SIZE };
