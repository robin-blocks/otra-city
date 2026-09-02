// Venue streamer: large city-owned lots (a stadium, later parks and markets)
// that exist at three tiers so the boulevard never pays for them —
//   tier 0  an impostor only (far.glb, a few hundred tris, no lights)
//   tier 1  the full asset, colliders, gates, anims — loaded on approach
//   tier 2  the venue's modules run (a match, live screens, its audio)
// and are fully disposed again after a grace period once the visitor has
// gone. Contract and numbers: docs/venues/ARCHITECTURE.md.
import * as THREE from 'three';
import { distanceToBox, insideBox } from '/js/world.js';

const LIGHT_SCALE = 0.0055;   // the same glTF -> client light normalisation plots get
const EMISSIVE_PEAK = 1.2;    // and the same bloom ceiling
const MODULES = {
  'match-4dgsx': () => import('/js/venue-modules/match-4dgsx.js'),
};
const TEX_SLOTS = ['map', 'emissiveMap', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'alphaMap'];

// Dispose everything a loaded glTF owns. Returns counts so a test can assert
// the GPU actually gave the memory back.
export function disposeTree(root) {
  const geos = new Set();
  const mats = new Set();
  const texs = new Set();
  root.traverse((o) => {
    if (o.geometry) geos.add(o.geometry);
    for (const m of [].concat(o.material || [])) {
      if (!m) continue;
      mats.add(m);
      for (const k of TEX_SLOTS) if (m[k]) texs.add(m[k]);
    }
  });
  for (const t of texs) t.dispose();
  for (const m of mats) m.dispose();
  for (const g of geos) g.dispose();
  return { geometries: geos.size, materials: mats.size, textures: texs.size };
}

export function createVenues(scene, world, deps) {
  const { loader, player, doors, anims, media, camera, renderer, log = console } = deps;
  const list = [];
  const byId = new Map();
  const listeners = new Set();
  const emit = (ev) => { for (const fn of listeners) { try { fn(ev); } catch (e) { log.warn('venue listener threw', e); } } };

  function fallbackImpostor(def) {
    const fp = def.footprint;
    const w = fp.max[0] - fp.min[0];
    const d = fp.max[1] - fp.min[1];
    const h = fp.height || 10;
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({ color: 0x15121f, roughness: 0.95 }));
    m.position.set((fp.min[0] + fp.max[0]) / 2, h / 2, (fp.min[1] + fp.max[1]) / 2);
    m.name = 'impostor_fallback';
    return m;
  }
  // An impostor is seen through the boulevard's fog, so its glowing parts opt
  // out of it — floodlights read through haze in a real city too.
  function prepImpostor(obj) {
    obj.traverse((o) => {
      if (o.isMesh) {
        o.frustumCulled = true;
        for (const m of [].concat(o.material)) if (m.emissive && m.emissiveIntensity > 0) m.fog = false;
      }
      if (o.isLight) o.intensity = 0;
    });
  }
  function loadFar(V) {
    const { def } = V;
    const done = (obj) => {
      obj.name = 'impostor';
      prepImpostor(obj);
      obj.visible = !V.near;
      V.far = obj;
      V.root.add(obj);
    };
    if (!def.assets?.far) { done(fallbackImpostor(def)); return; }
    loader.load(def.base + def.assets.far, (gltf) => done(gltf.scene), undefined, () => {
      log.warn(`venue ${def.id}: impostor ${def.assets.far} unavailable, using a box`);
      done(fallbackImpostor(def));
    });
  }

  function makeVenue(def) {
    const root = new THREE.Group();
    root.name = `venue:${def.id}`;
    root.position.set(def.placement.x, 0, def.placement.z);
    root.rotation.y = def.placement.yaw || 0;
    scene.add(root);
    root.updateMatrixWorld(true);
    const V = {
      def, root, tier: 0, want: 0, force: null, far: null, near: null, nodes: {},
      colliders: [], gateIds: [], modules: [], loading: null, error: null, quiet: false,
      lightCount: 0, grace: def.tiers.unload_after_s, stats: { loads: 0, unloads: 0, lastDispose: null },
    };
    loadFar(V);
    return V;
  }
  for (const def of world.venues || []) {
    const V = makeVenue(def);
    list.push(V);
    byId.set(def.id, V);
  }

  function normalise(V, obj) {
    const cap = V.def.lights?.cap ?? 30;
    const lights = [];
    obj.traverse((o) => { if (o.isLight) lights.push(o); });
    let total = 0;
    for (const l of lights) {
      l.intensity *= LIGHT_SCALE;
      if (l.isPointLight || l.isSpotLight) {
        // a venue lights a bowl, not a 10 m lot: a floodlight must reach the
        // far touchline before it fades
        if (!l.distance) l.distance = l.isSpotLight ? 80 : 40;
        l.decay = 2;
      }
      total += l.intensity;
    }
    if (total > cap) for (const l of lights) l.intensity *= cap / total;
    obj.traverse((o) => {
      for (const m of [].concat(o.material || [])) {
        if (m.emissiveIntensity && m.emissive) {
          const peak = m.emissiveIntensity * Math.max(m.emissive.r, m.emissive.g, m.emissive.b);
          if (peak > EMISSIVE_PEAK) m.emissiveIntensity *= EMISSIVE_PEAK / peak;
        }
      }
    });
    return lights.length;
  }

  // venue-local box -> world AABB (a 90° yaw keeps it a box; other yaws get
  // the bounding box of the rotated corners)
  function worldBox(V, box) {
    const pts = [[box.min[0], box.min[1]], [box.max[0], box.min[1]], [box.min[0], box.max[1]], [box.max[0], box.max[1]]]
      .map(([x, z]) => new THREE.Vector3(x, 0, z).applyMatrix4(V.root.matrixWorld));
    return {
      min: [Math.min(...pts.map((p) => p.x)), Math.min(...pts.map((p) => p.z))],
      max: [Math.max(...pts.map((p) => p.x)), Math.max(...pts.map((p) => p.z))],
    };
  }

  function wantTier(V, p) {
    if (V.force !== null) return V.force;
    const { bounds: b, tiers: t } = V.def;
    // the line you cross to come in sits further out than the one you cross
    // to leave, so pacing at an edge cannot flap a tier
    const margin = V.tier >= 2 ? t.inside_margin_m + 3 : t.inside_margin_m;
    if (insideBox(b, p.x, p.z, margin)) return 2;
    const nearR = V.tier >= 1 ? t.near_m + t.hysteresis_m : t.near_m;
    return distanceToBox(b, p.x, p.z) <= nearR ? 1 : 0;
  }

  function ensureNear(V) {
    if (V.near || V.loading || V.error) return;
    const { def } = V;
    V.loading = new Promise((resolve) => {
      loader.load(def.base + def.assets.near, (gltf) => {
        V.loading = null;
        if (V.want === 0) {            // walked away while it was downloading
          disposeTree(gltf.scene);
          resolve(false);
          return;
        }
        mountNear(V, gltf);
        resolve(true);
      }, undefined, (e) => {
        V.loading = null;
        V.error = `near asset failed: ${def.assets.near}`;
        log.warn(`venue ${def.id}: ${V.error}`, e);
        resolve(false);
      });
    });
    return V.loading;
  }

  function mountNear(V, gltf) {
    const { def } = V;
    const obj = gltf.scene;
    obj.name = 'near';
    V.lightCount = normalise(V, obj);
    const prefix = def.collision_prefix || 'col_';
    const nodes = {};
    const cols = [];
    obj.traverse((o) => {
      if (o.name) nodes[o.name] = o;
      if (!o.isMesh) return;
      o.frustumCulled = true;
      // collision proxies: invisible, and the ONLY meshes the player raycasts
      if (o.name.startsWith(prefix) || (o.parent && o.parent.name.startsWith(prefix))) {
        o.visible = false;
        cols.push(o);
      }
    });
    V.root.add(obj);
    V.near = obj;
    V.nodes = nodes;
    V.root.updateMatrixWorld(true);
    for (const gcfg of def.gates || []) {
      const left = nodes[gcfg.left];
      const right = nodes[gcfg.right];
      if (!left || !right) { log.warn(`venue ${def.id}: gate ${gcfg.id} nodes missing`); continue; }
      // a closed gate is a wall: the panels themselves collide
      left.traverse((o) => { if (o.isMesh) cols.push(o); });
      right.traverse((o) => { if (o.isMesh) cols.push(o); });
      const at = new THREE.Vector3(...gcfg.at).applyMatrix4(V.root.matrixWorld);
      const id = `${def.id}:${gcfg.id}`;
      doors.add(id, { left, right, at, slide: gcfg.slide_m ?? 1.2, open: gcfg.open_m ?? 2.4, close: gcfg.close_m ?? 3.1 });
      V.gateIds.push(id);
    }
    V.colliders = cols;
    player.addColliders(cols);
    if (def.anims?.length) anims.attach(V.root, obj, def.anims);
    if (V.far) V.far.visible = false;
    V.modules = [];
    for (const cfg of def.modules || []) createModule(V, cfg);
    V.stats.loads += 1;
    setTier(V, 1);
  }

  async function createModule(V, cfg) {
    const factory = MODULES[cfg.type];
    if (!factory) { log.warn(`venue ${V.def.id}: unknown module "${cfg.type}"`); return; }
    const entry = { cfg, inst: null, active: false, failed: false };
    V.modules.push(entry);
    try {
      const mod = await factory();
      if (!V.near || !V.modules.includes(entry)) return;   // unloaded meanwhile
      entry.inst = mod.create({ venue: V.def, cfg, root: V.root, nodes: V.nodes, scene, camera, renderer, media, world, log });
      if (V.tier === 2) activateModule(V, entry);
    } catch (e) {
      entry.failed = true;
      log.warn(`venue ${V.def.id}: module ${cfg.type} failed to load`, e);
    }
  }
  function activateModule(V, entry) {
    if (!entry.inst || entry.active || entry.failed) return;
    try { entry.inst.activate(); entry.active = true; } catch (e) {
      entry.failed = true;
      log.warn(`venue ${V.def.id}: module ${entry.cfg.type} failed to activate`, e);
    }
  }
  function deactivateModule(V, entry) {
    if (!entry.inst || !entry.active) return;
    try { entry.inst.deactivate(); } catch (e) { log.warn(`venue ${V.def.id}: module ${entry.cfg.type} failed to deactivate`, e); }
    entry.active = false;
  }
  function setTier(V, tier) {
    if (V.tier === tier) return;
    const from = V.tier;
    V.tier = tier;
    emit({ id: V.def.id, tier, from });
  }
  function enter2(V) {
    for (const m of V.modules) activateModule(V, m);
    if (V.def.audio_zone && media?.addQuietZone) {
      media.addQuietZone(`venue:${V.def.id}`, worldBox(V, V.def.audio_zone));
      V.quiet = true;
    }
    setTier(V, 2);
  }
  function exit2(V) {
    for (const m of V.modules) deactivateModule(V, m);
    if (V.quiet) { media.removeQuietZone(`venue:${V.def.id}`); V.quiet = false; }
    setTier(V, 1);
  }
  function unload(V) {
    if (V.tier === 2) exit2(V);
    for (const m of V.modules) {
      if (m.inst) { try { m.inst.dispose(); } catch (e) { log.warn(`venue ${V.def.id}: module ${m.cfg.type} failed to dispose`, e); } }
    }
    V.modules = [];
    if (V.near) {
      if (anims.detach) anims.detach(V.root);
      for (const id of V.gateIds) doors.remove(id);
      V.gateIds = [];
      player.removeColliders(V.colliders);
      V.colliders = [];
      V.root.remove(V.near);
      V.stats.lastDispose = disposeTree(V.near);
      V.near = null;
      V.nodes = {};
      V.stats.unloads += 1;
    }
    if (V.far) V.far.visible = true;
    setTier(V, 0);
  }

  function update(dt, p, time = 0) {
    for (const V of list) {
      const want = wantTier(V, p);
      V.want = want;
      if (want >= 1 && !V.near) ensureNear(V);
      if (V.near) {
        if (want === 2 && V.tier === 1) enter2(V);
        else if (want < 2 && V.tier === 2) exit2(V);
      }
      if (want === 0 && (V.near || V.loading)) {
        V.grace -= dt;
        if (V.grace <= 0 && V.near) unload(V);
      } else {
        V.grace = V.def.tiers.unload_after_s;
      }
      if (V.tier === 2) {
        for (const m of V.modules) {
          if (!m.active) continue;
          try { m.inst.update(dt, p, time); } catch (e) {
            m.failed = true;
            m.active = false;
            log.warn(`venue ${V.def.id}: module ${m.cfg.type} crashed in update and was deactivated`, e);
          }
        }
      }
    }
  }

  return {
    update,
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    get(id) { return byId.get(id) || null; },
    forceTier(id, tier) { const V = byId.get(id); if (V) V.force = tier; },
    // for fixtures: wait until the near asset for `id` is resident (or failed)
    async whenLoaded(id) { const V = byId.get(id); if (!V) return false; if (V.near) return true; if (V.loading) return V.loading; return false; },
    hudText() {
      let best = null;
      for (const V of list) if (V.tier > 0 && (!best || V.tier > best.tier)) best = V;
      return best ? ` · ${best.def.name} T${best.tier}` : '';
    },
    state() {
      return list.map((V) => ({
        id: V.def.id, tier: V.tier, want: V.want, forced: V.force, loaded: !!V.near, loading: !!V.loading,
        error: V.error, colliders: V.colliders.length, lights: V.lightCount, gates: V.gateIds.length,
        modules: V.modules.map((m) => ({ type: m.cfg.type, ready: !!m.inst, active: m.active, failed: m.failed, state: m.inst?.state ?? null })),
        stats: V.stats,
      }));
    },
  };
}
