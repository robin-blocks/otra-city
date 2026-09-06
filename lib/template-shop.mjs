// The city's own shopfront: the building a listing gets when it sends no
// build of its own. A directory submission is a url, a name, a sentence and a
// category — the same payload PromptFrenzy's directory takes — and the city
// turns it into a walkable shop on the category's road, with the site's own
// og:image on the facade and again inside, the standard door, a link plaque,
// and the category's colour in neon.
//
// Deterministic: the same slug + category + inputs always produce the same
// bytes, so a template build can be regenerated when the template improves
// (`template.version` in plot.json says which one a plot was built with) and
// a dry run's verdict is the verdict. Pure geometry, no textures, no text:
// the info board the city places at the kerb carries the name, tagline,
// builder and link, exactly as it does for a hand-built plot.
//
// Everything below is built to public/docs/plot-spec.json: the 10x10x6
// envelope with the facade inset to z = 4.75, the door standard (3 m rough
// opening at x = 0, two 1.25 m panels parked in the wall depth, sill and floor
// at 0.25 m), full 0..1 UVs on every media quad, no two same-facing faces on
// one plane, four materials, three lights or fewer. It is validated by the
// same validator every submission meets — a template that failed it would be
// the city rejecting its own building.
import { Document, NodeIO } from '@gltf-transform/core';
import { KHRMaterialsEmissiveStrength, KHRLightsPunctual } from '@gltf-transform/extensions';
import { categoryOf, hsl, DEFAULT_CATEGORY } from '../public/js/categories.mjs';

export const TEMPLATE_ID = 'shopfront';
export const TEMPLATE_VERSION = 1;
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

const hexToRgb = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
};

// ---------------------------------------------------------------- geometry
// Axis-aligned boxes and single quads, accumulated per material into one
// primitive each, so a whole facade is one draw call. Winding is glTF's
// counter-clockwise-from-outside; UVs on picture quads put v = 0 along the
// top edge, which is where glTF (and the client, flipY = false) expects the
// top of the image.
class MeshBuf {
  constructor() { this.pos = []; this.nrm = []; this.uv = []; this.idx = []; }
  get empty() { return this.idx.length === 0; }
  face(verts, n, uvs = [[0, 1], [1, 1], [1, 0], [0, 0]]) {
    const base = this.pos.length / 3;
    for (const p of verts) this.pos.push(p[0], p[1], p[2]);
    for (let i = 0; i < 4; i++) this.nrm.push(n[0], n[1], n[2]);
    for (const t of uvs) this.uv.push(t[0], t[1]);
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  box([x0, y0, z0], [x1, y1, z1]) {
    this.face([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1]);
    this.face([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [0, 0, -1]);
    this.face([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [1, 0, 0]);
    this.face([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0]);
    this.face([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], [0, 1, 0]);
    this.face([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [0, -1, 0]);
  }
  // a quad in the plane z = z facing +z (toward the street when z > 0)
  quadZ([x0, y0], [x1, y1], z) {
    this.face([[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]], [0, 0, 1]);
  }
}

// ------------------------------------------------------------------ design
// One shop, three silhouettes. Dimensions in metres, glTF axes: x across the
// frontage, y up, +z toward the street. The wall is 0.25 m thick with its
// street face at z = 4.75 (the facade line); the 0.25 m in front of it is the
// signage zone, where the neon and the awning live.
const FACADE = 4.75;
const T = 0.25;          // wall thickness
const SILL = 0.25;       // floor top / door sill
const DOOR_HALF = 1.5;   // 3 m rough opening
const DOOR_TOP = SILL + 3;
const PROUD = 0.04;      // how far lit panels stand off the wall (> 2 mm rule)

function design(variant) {
  const H = variant === 'tower' ? 4.75 : 4.0;
  return { H, roofTop: H + T };
}

export function buildTemplate({ slug, category, color = null, images = 0 } = {}) {
  const cat = categoryOf(category) || categoryOf(DEFAULT_CATEGORY);
  const variant = variantFor(slug);
  const { H, roofTop } = design(variant);
  const accent = hexToRgb(color) || hexToRgb(hsl(cat.hue, 0.95, 0.6));
  const facadeRgb = hexToRgb(hsl(cat.hue, 0.3, 0.17));

  const facade = new MeshBuf();   // walls, roof, parapet — the dark mass
  const interior = new MeshBuf(); // floor, counter — darker still
  const neon = new MeshBuf();     // the category's colour, bright
  const glow = new MeshBuf();     // warm light panels: windows, ceiling
  const lintel = new MeshBuf();   // the strip over the door, on its own node so it can breathe
  const doorL = new MeshBuf();
  const doorR = new MeshBuf();
  const link = new MeshBuf();
  const pics = [new MeshBuf(), new MeshBuf()];

  // walls: side walls stop at the front wall's back face so no two boxes
  // share a plane facing the same way
  const zBack = -FACADE;
  const zFrontBack = FACADE - T;
  facade.box([-FACADE, 0, zBack], [-FACADE + T, H, zFrontBack]);          // left wall
  facade.box([FACADE - T, 0, zBack], [FACADE, H, zFrontBack]);            // right wall
  facade.box([-FACADE + T, 0, zBack], [FACADE - T, H, zBack + T]);        // back wall
  facade.box([-FACADE, 0, zFrontBack], [-DOOR_HALF, H, FACADE]);         // front wall, left of the door
  facade.box([DOOR_HALF, 0, zFrontBack], [FACADE, H, FACADE]);           // front wall, right of the door
  facade.box([-DOOR_HALF, DOOR_TOP, zFrontBack], [DOOR_HALF, H, FACADE]); // header over the door
  facade.box([-FACADE, H, zBack], [FACADE, roofTop, FACADE]);            // roof slab

  // floor inside the walls, and the sill that carries the step out to the kerb
  interior.box([-FACADE + T, 0, zBack + T], [FACADE - T, SILL, zFrontBack]);
  interior.box([-DOOR_HALF, 0, zFrontBack], [DOOR_HALF, SILL, 4.99]);
  interior.box([-2.5, SILL, -3.75], [2.5, SILL + 0.95, -3.0]);           // counter

  // door: two panels parked in the wall depth, meeting at x = 0
  doorL.box([-1.25, SILL, zFrontBack + 0.05], [0, DOOR_TOP, FACADE - 0.05]);
  doorR.box([0, SILL, zFrontBack + 0.05], [1.25, DOOR_TOP, FACADE - 0.05]);

  // the neon frame: pilasters at both corners and a strip along the roofline
  const zN0 = FACADE;
  const zN1 = FACADE + 0.15;
  neon.box([-FACADE, SILL, zN0], [-FACADE + 0.2, roofTop + 0.15, zN1]);
  neon.box([FACADE - 0.2, SILL, zN0], [FACADE, roofTop + 0.15, zN1]);
  neon.box([-FACADE + 0.2, roofTop, zN0], [FACADE - 0.2, roofTop + 0.15, zN1]);   // between the pilasters, never on them
  // the lintel over the door, the one thing that pulses
  lintel.box([-DOOR_HALF, DOOR_TOP + 0.1, zN0], [DOOR_HALF, DOOR_TOP + 0.3, zN1]);

  // a window on the left, a billboard on the right
  glow.box([-4.3, 1.3, FACADE], [-2.0, 3.0, FACADE + PROUD]);
  const picFront = [[1.75, 1.35], [4.5, 2.8]];                            // 2.75 x 1.45 ≈ og:image's 1.9:1
  pics[0].quadZ(picFront[0], picFront[1], FACADE + PROUD);
  // the same picture again on the wall facing the door, 4 m wide
  pics[1].quadZ([-2.0, 1.5], [2.0, 3.6], zBack + T + 0.01);
  // a neon skirting along the back wall, so the room carries the category's colour
  neon.box([-4.5, SILL, zBack + T], [4.5, SILL + 0.08, zBack + T + 0.06]);
  // ceiling light
  glow.box([-3.0, H - 0.06, -0.5], [3.0, H, 0.5]);
  // the link plaque beside the door, at hand height
  link.quadZ([-2.4, 0.7], [-1.7, 1.05], FACADE + PROUD);

  if (variant === 'tower') {
    // a parapet block above the roof with its own neon crown
    facade.box([-2.5, roofTop, 2.0], [2.5, roofTop + 0.6, FACADE]);
    neon.box([-2.5, roofTop + 0.15, zN0], [-2.3, roofTop + 0.6, zN1]);
    neon.box([2.3, roofTop + 0.15, zN0], [2.5, roofTop + 0.6, zN1]);
    neon.box([-2.5, roofTop + 0.6, zN0], [2.5, roofTop + 0.75, zN1]);
  } else if (variant === 'awning') {
    // an awning the depth of the signage zone, lit from the category's colour
    neon.box([-2.25, DOOR_TOP + 0.35, zN1], [2.25, DOOR_TOP + 0.5, 4.99]);
  }

  // ------------------------------------------------------------ the glTF
  const doc = new Document();
  const buffer = doc.createBuffer();
  const emis = doc.createExtension(KHRMaterialsEmissiveStrength);
  const lightsExt = doc.createExtension(KHRLightsPunctual);
  const material = (name, rgb, { rough = 0.85, emissive = null, strength = 1 } = {}) => {
    const m = doc.createMaterial(name).setBaseColorFactor([...rgb, 1]).setMetallicFactor(0).setRoughnessFactor(rough);
    if (emissive) {
      m.setEmissiveFactor(emissive);
      if (strength !== 1) m.setExtension('KHR_materials_emissive_strength', emis.createEmissiveStrength().setEmissiveStrength(strength));
    }
    return m;
  };
  const matFacade = material('facade', facadeRgb);
  const matDark = material('dark', [0.05, 0.04, 0.08], { rough: 0.9 });
  const matNeon = material('neon', accent.map((v) => v * 0.6), { rough: 0.6, emissive: accent, strength: 2.5 });
  const matGlow = material('glow', [0.2, 0.17, 0.12], { rough: 0.7, emissive: [0.82, 0.66, 0.42], strength: 0.75 });

  const scene = doc.createScene('shopfront');
  doc.getRoot().setDefaultScene(scene);
  const emit = (name, buf, mat) => {
    if (buf.empty) return null;
    const prim = doc.createPrimitive()
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(buf.pos)).setBuffer(buffer))
      .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(buf.nrm)).setBuffer(buffer))
      .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(buf.uv)).setBuffer(buffer))
      .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(buf.idx)).setBuffer(buffer))
      .setMaterial(mat);
    const node = doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(prim));
    scene.addChild(node);
    return node;
  };
  emit('facade', facade, matFacade);
  emit('interior', interior, matDark);
  emit('neon', neon, matNeon);
  emit('lintel', lintel, matNeon);
  emit('glow', glow, matGlow);
  emit('door_panel_L', doorL, matFacade);
  emit('door_panel_R', doorR, matFacade);
  emit('link_1', link, matNeon);
  // picture quads carry the warm plate until the client maps the image over
  // them; both are always there under their contract names, so a listing that
  // adds a picture later binds to a node that exists, and one with none simply
  // keeps its lit blank plates
  PICTURE_NODES.forEach((name, i) => emit(name, pics[i], matGlow));
  const pictureNodes = PICTURE_NODES.slice(0, Math.max(0, Math.min(images, PICTURE_NODES.length)));

  // two modest lights: the room, and the porch — the pool lights whichever is nearest
  const light = (name, pos, intensity) => {
    const l = lightsExt.createLight().setType('point').setColor([1, 0.92, 0.8]).setIntensity(intensity);
    scene.addChild(doc.createNode(name).setTranslation(pos).setExtension('KHR_lights_punctual', l));
  };
  light('light_room', [0, H - 0.4, -0.5], 600);
  light('light_porch', [0, DOOR_TOP - 0.2, 4.2], 320);

  return {
    variant,
    pictureNodes,
    // the strip over the door breathes; nothing else moves
    anims: [{ type: 'pulse', node: 'lintel', period: 2.6, depth: 0.35 }],
    color: hsl(cat.hue, 0.95, 0.6),
    write: async () => {
      const io = new NodeIO().registerExtensions([KHRMaterialsEmissiveStrength, KHRLightsPunctual]);
      return Buffer.from(await io.writeBinary(doc));
    },
  };
}
