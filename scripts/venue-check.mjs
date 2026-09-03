// The venue gate. For each venue: manifest and index, GLB budgets and node
// contract (static, from the bytes), then the fixture in headless Chrome —
// tier 0 impostor cost, tier 1 load with colliders and lights, tier 2 with
// modules, walkability from the forecourt to the seats, and the unload with
// GPU memory back to its tier-0 level. Every completion claim about a venue
// points at this report. Exit 1 on any FAIL.
//
//   node scripts/venue-check.mjs [--venue <id> | --all] [--out report.json]
//                                [--no-browser] [--match] [--bundle <url>]
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { validateVenue } from '../lib/venue-schema.mjs';
import { inspectGlb } from '../lib/venue-glb.mjs';
import { openFixture, PUBLIC_DIR } from '../lib/venue-harness.mjs';
import { DEPTH } from '../public/js/depth-probe.mjs';

const argv = process.argv.slice(2);
const arg = (name, fallback = null) => { const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback; };
const flag = (name) => argv.includes(`--${name}`);
const SCENE_CALLS = 400;   // scene-wide budgets from docs/stadium/PROJECT.md §4
const SCENE_TRIS = 300000;
const SCENE_LIGHTS = 40;
// With a match on the pitch the 4DGSX stage alone is ~390 draws (one per
// draw record plus one per splat body — the SDK's design, not ours), so the
// tier-2 ceiling sits above the 400 the empty city is held to.
const MATCH_CALLS = 480;
const DEFAULT_BUNDLE = 'https://cdn.4dgsx.com/channels/rfl/bundles/s3-m1_real_machina_singularity_united-a25b3e6dff2af7c1cff8ff48';
const DOM_EXPR = `JSON.stringify({ iframes: document.querySelectorAll('iframe').length, videos: document.querySelectorAll('video').length, maps: Object.entries(window.__venue.venues.get(window.__venue.id)?.nodes || {}).filter(([n]) => /^(screen_|panel_)/.test(n)).map(([n, o]) => { let m = null; o.traverse((x) => { if (!m && x.isMesh) m = x; }); const map = m && m.material.map; return [n, map ? (map.isVideoTexture ? 'video' : map.isCanvasTexture ? 'canvas' : 'texture') + (map.flipY ? '/flipY' : '') : 'none']; }) })`;

const venuesDir = join(PUBLIC_DIR, 'venues');
const ids = flag('all') || !arg('venue')
  ? JSON.parse(readFileSync(join(venuesDir, 'index.json'), 'utf8')).venues.map((v) => v.id)
  : [arg('venue')];

const report = { at: new Date().toISOString(), venues: [] };
let failed = 0;

// 0. index in sync (one run for all)
const sync = spawnSync('node', [join(PUBLIC_DIR, '..', 'scripts', 'build-venues.mjs'), '--check', '--strict'], { encoding: 'utf8' });
const indexOk = sync.status === 0;
if (!indexOk) { console.log(sync.stdout); failed += 1; }
console.log(`${indexOk ? 'PASS' : 'FAIL'}  venues index in sync (build-venues --check --strict)`);

for (const id of ids) {
  const checks = [];
  const check = (name, ok, detail = '') => { checks.push({ name, ok, detail }); console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };
  console.log(`\n${id}`);
  const dir = join(venuesDir, id);
  const def = JSON.parse(readFileSync(join(dir, 'venue.json'), 'utf8'));
  const B = def.budgets;
  const schemaErrors = validateVenue(def);
  check('manifest schema', schemaErrors.length === 0, schemaErrors.join('; ') || 'valid');

  // 1. static: near asset
  const mediaNodes = [];
  for (const m of def.modules || []) {
    for (const n of Object.values(m.docks || {})) mediaNodes.push(n);
    if (m.scoreboard) mediaNodes.push(m.scoreboard);
  }
  const nearPath = join(dir, def.assets.near);
  let near = null;
  if (!existsSync(nearPath)) {
    check('near asset present', false, `${def.assets.near} missing`);
  } else {
    near = await inspectGlb(readFileSync(nearPath), { uvNodes: mediaNodes });
    check('near bytes', near.bytes <= B.glb_bytes, `${(near.bytes / 1048576).toFixed(2)} MiB (max ${(B.glb_bytes / 1048576).toFixed(1)})`);
    check('near triangles', near.tris <= B.tris, `${near.tris} (max ${B.tris})`);
    check('near draw calls', near.prims <= B.meshes, `${near.prims} primitives (max ${B.meshes})`);
    check('near materials', near.materials.length <= B.materials, `${near.materials.length} (max ${B.materials}): ${near.materials.join(', ')}`);
    const px = Math.max(0, ...near.textures.map((t) => (t.size ? Math.max(...t.size) : Infinity)));
    check('near textures', px <= B.texture_px, `${near.textures.length} textures, largest ${px}px (max ${B.texture_px})`);
    check('near lights', near.lights <= (B.lights ?? 8), `${near.lights} punctual (max ${B.lights ?? 8}): ${near.lightNodes.map((l) => `${l.name}:${l.type}`).join(', ') || 'none'}`);
    const f = def.footprint;
    const inFoot = near.bbox.min[0] >= f.min[0] - 0.1 && near.bbox.max[0] <= f.max[0] + 0.1 &&
      near.bbox.min[2] >= f.min[1] - 0.1 && near.bbox.max[2] <= f.max[1] + 0.1 && near.bbox.min[1] >= -0.06;
    check('near footprint', inFoot, `x ${near.bbox.min[0].toFixed(2)}..${near.bbox.max[0].toFixed(2)} y ${near.bbox.min[1].toFixed(2)}..${near.bbox.max[1].toFixed(2)} z ${near.bbox.min[2].toFixed(2)}..${near.bbox.max[2].toFixed(2)}`);
    const prefix = def.collision_prefix || 'col_';
    const cols = near.nodes.filter((n) => n.startsWith(prefix));
    check('collision proxies', cols.length >= 1 && cols.length <= 80, `${cols.length} ${prefix}* nodes`);
    const wanted = [];
    for (const g of def.gates || []) wanted.push(g.left, g.right);
    for (const m of def.modules || []) { if (m.pitch) wanted.push(m.pitch); wanted.push(...Object.values(m.docks || {})); if (m.scoreboard) wanted.push(m.scoreboard); }
    for (const a of def.anims || []) wanted.push(a.node);
    const missing = [...new Set(wanted)].filter((n) => !near.nodes.includes(n));
    check('named nodes', missing.length === 0, missing.length ? `missing: ${missing.join(', ')}` : `${new Set(wanted).size} present`);
    const badUv = Object.entries(near.uv).filter(([, r]) => !r || r.absent || r.missing || r.noUV ||
      r.umin > 0.02 || r.umax < 0.98 || r.vmin > 0.02 || r.vmax < 0.98).map(([n, r]) => `${n}${r && r.umin !== undefined ? ` u ${r.umin.toFixed(2)}..${r.umax.toFixed(2)} v ${r.vmin.toFixed(2)}..${r.vmax.toFixed(2)}` : ''}`);
    check('media node UVs', badUv.length === 0, badUv.length ? `not full 0..1: ${badUv.join('; ')}` : `${mediaNodes.length} nodes span 0..1`);
  }
  // 2. static: impostor
  if (def.assets.far) {
    const farPath = join(dir, def.assets.far);
    if (!existsSync(farPath)) check('impostor present', false, `${def.assets.far} missing`);
    else {
      const far = await inspectGlb(readFileSync(farPath));
      check('impostor triangles', far.tris <= (B.far_tris ?? 600), `${far.tris} (max ${B.far_tris ?? 600})`);
      check('impostor bytes', far.bytes <= (B.far_bytes ?? 61440), `${(far.bytes / 1024).toFixed(1)} KiB (max ${((B.far_bytes ?? 61440) / 1024).toFixed(0)})`);
      check('impostor draw calls', far.prims <= 3, `${far.prims} primitives (max 3)`);
      check('impostor lights', far.lights === 0, `${far.lights}`);
    }
  }
  if (def.capacity) check('seat positions', (def.seats || []).length >= def.capacity, `${(def.seats || []).length} seats (capacity ${def.capacity})`);

  // 3. the fixture
  if (!flag('no-browser') && near) {
    let fx = null;
    try {
      fx = await openFixture({ venue: id, tier: 0, fast: true });
      const cams = Object.keys(def.cameras);
      // the impostor loads asynchronously; the tier-0 baseline must include it
      for (let i = 0; i < 100 && (await fx.stats()).impostor.meshes === 0; i++) await new Promise((r) => setTimeout(r, 100));
      // GPU memory only fills as things are first drawn, so both memory
      // readings follow the same sweep of every camera
      const sweepOn = async (f) => { for (const cam of cams) { await f.setCam(cam); await f.step(3); } await f.setCam(cams[0]); return f.step(30); };
      const sweep = () => sweepOn(fx);
      const s0 = await sweep();
      check('tier 0 renders clean', s0.errors.length === 0 && fx.problems.length === 0, [...s0.errors, ...fx.problems].slice(0, 3).join(' | ') || `${s0.calls} calls, ${s0.tris} tris`);
      check('tier 0 impostor cost', s0.impostor.tris <= (B.far_tris ?? 600) && s0.impostor.meshes <= 3, `${s0.impostor.meshes} meshes, ${s0.impostor.tris} tris, ${s0.lights} scene lights`);
      await fx.setTier(1);
      await fx.step(1);
      const v1 = await fx.waitLoaded();
      const s1 = await fx.step(30);
      check('tier 1 loaded', v1.loaded && v1.tier === 1, `${s1.near.meshes} meshes, ${s1.near.tris} tris, ${s1.colliders} colliders, ${v1.gates} gates, ${v1.lights} lights`);
      check('tier 1 colliders registered', s1.colliders >= 1, `${s1.colliders}`);
      check('tier 1 scene lights', s1.lights <= SCENE_LIGHTS, `${s1.lights} (max ${SCENE_LIGHTS})`);
      // the camera set is the visual contract: the worst view must fit the budget
      let worst = { calls: 0, tris: 0, cam: null };
      for (const cam of cams) {
        await fx.setCam(cam);
        const s = await fx.step(5);
        if (s.calls > worst.calls) worst = { calls: s.calls, tris: s.tris, cam };
      }
      check('tier 1 draw calls (worst camera)', worst.calls <= SCENE_CALLS, `${worst.calls} at ${worst.cam} (max ${SCENE_CALLS})`);
      check('tier 1 triangles (worst camera)', worst.tris <= SCENE_TRIS, `${worst.tris} at ${worst.cam} (max ${SCENE_TRIS})`);
      // Nothing shimmers, from every camera the venue names. Two front faces
      // at one depth have no winner and the surface crawls as you walk past
      // it — it arrives from geometry (a box laid on a box) and from the
      // EXPORTER (Draco quantizes over a mesh's bounding box, so a small
      // authored offset in a large mesh rounds to nothing), and both look the
      // same on screen, so the screen is what is measured. See
      // public/js/depth-probe.mjs.
      let fizz = { percent: 0, cam: null, worst: [] };
      for (const cam of cams) {
        await fx.setCam(cam);
        await fx.step(5);
        const r = await fx.coplanar({ step: 10 });
        if (r.percent > fizz.percent) fizz = { percent: r.percent, cam, budget: r.budget, worst: r.worst.slice(0, 2) };
      }
      check('nothing shimmers (worst camera)', fizz.percent <= DEPTH.budget,
        `${fizz.percent}% at ${fizz.cam || cams[0]} (budget ${DEPTH.budget}%)` +
        (fizz.percent > DEPTH.budget ? ` — ${fizz.worst.map((w) => `${w.who.join(' + ')} at ${w.at}`).join('; ')}` : ''));
      await fx.setTier(2);
      const s2 = await fx.step(30);
      const st2 = (await fx.state()).venues.find((v) => v.id === id);
      const mods = st2.modules || [];
      check('tier 2 modules active', st2.tier === 2 && mods.every((m) => m.active || m.failed === false), mods.map((m) => `${m.type}:${m.active ? 'active' : m.failed ? 'FAILED' : 'idle'}`).join(', ') || 'no modules');
      check('tier 2 renders clean', s2.errors.length === 0 && fx.problems.length === 0, [...s2.errors, ...fx.problems].slice(0, 3).join(' | ') || 'no errors');
      const w = await fx.walkability({ cell: 0.25 });   // half-steps are 0.25 m deep
      const rt = await fx.routeFromCity();
      check('reachable from the city spawn', rt.ok, rt.ok ? `${rt.samples} samples from [${rt.from}] to [${rt.to}], no gap in the walkable fence`
        : `fence gap: ${rt.gaps.map((g) => `[${g.from}]..[${g.to}]`).join(', ')}`);
      const sc = await fx.spawnClearance();
      check('spawn is clear of geometry', sc.ok, sc.ok ? `avatar radius ${sc.radius} m free at [${sc.at}]` : `blocked at [${sc.at}]: ${sc.blocked.map((b) => `${b.what} ${b.d} m`).join(', ')}`);
      check('walkability: spawn stands on ground', !!w.ok && w.reachable <= w.walkable, w.reason || `${w.reachable} of ${w.walkable} walkable cells reachable (${w.nodes} surfaces, cell ${w.cell} m)`);
      check('walkability: gates passable', (w.gates || []).every((g) => g.reachable), (w.gates || []).map((g) => `${g.id}:${g.reachable ? 'ok' : 'BLOCKED'}`).join(', ') || 'no gates');
      check('walkability: seats reachable', w.seatsReachable >= (def.capacity || 0) && w.seatsReachable === w.seatsTotal, `${w.seatsReachable}/${w.seatsTotal} (capacity ${def.capacity || 0})`);
      // Getting in is half of it. A terrace a visitor can walk down into and
      // never climb out of passed every check here for a week: the fill only
      // ever went downhill, so it never met the step it could not take.
      check('walkability: and every seat can be left again', w.seatsReturnable === w.seatsTotal,
        `${w.seatsReturnable}/${w.seatsTotal} can walk back to the spawn (body radius ${w.bodyRadius} m)`);
      if (flag('match') && (def.modules || []).some((m) => m.type === 'match-4dgsx')) {
        // a second fixture: a real replay bundle mounted through the SDK, from
        // tier 0 (memory baseline) to tier 2 (match) and back to tier 0 (clean)
        const mcfg = def.modules.find((m) => m.type === 'match-4dgsx');
        let mx = null;
        try {
          mx = await openFixture({ venue: id, tier: 0, fast: true, bundle: arg('bundle', DEFAULT_BUNDLE) });
          for (let i = 0; i < 100 && (await mx.stats()).impostor.meshes === 0; i++) await new Promise((r) => setTimeout(r, 100));
          const m0 = await sweepOn(mx);
          await mx.setTier(2);
          await mx.step(1);
          await mx.waitLoaded();
          const t0 = Date.now();
          let ms = null;
          for (;;) {
            const v = (await mx.state()).venues.find((x) => x.id === id);
            ms = v.modules[0]?.state || null;
            if (ms?.phase === 'match' || ms?.sdk === 'failed' || (ms?.errors || []).length || v.modules[0]?.failed) break;
            if (Date.now() - t0 > 180000) break;
            await mx.step(10);
            await new Promise((r) => setTimeout(r, 500));
          }
          check('match: SDK loaded and bundle mounted', ms?.phase === 'match' && ms?.sdk === 'ready', `phase ${ms?.phase}, sdk ${ms?.sdk}, ${((Date.now() - t0) / 1000).toFixed(0)} s, errors ${JSON.stringify(ms?.errors || [])}`);
          const want = Object.keys(mcfg.docks || {});
          check('match: docks attached', want.every((d) => ms?.docks?.find((x) => x.slot === d)?.attached), JSON.stringify(ms?.docks || []));
          await mx.step(120);
          const dom = JSON.parse(await mx.evaluate(DOM_EXPR));
          const maps = Object.fromEntries(dom.maps);
          const mainOk = maps[mcfg.docks?.main] === 'video';
          const scoreOk = maps[mcfg.scoreboard] === 'canvas';
          check('match: screens carry the SDK textures, glTF-oriented', mainOk && scoreOk && dom.maps.every(([, t]) => !t.endsWith('/flipY')), dom.maps.map((m) => m.join('=')).join(', '));
          const ms2 = (await mx.state()).venues.find((x) => x.id === id).modules[0]?.state;
          check('match: scoreboard paints hud truth', /[A-Z]{2,4} \d+-\d+ [A-Z]{2,4} \d+:\d\d/.test(ms2?.board || ''), `board "${ms2?.board}", clock ${ms2?.clock}, stage ${ms2?.stage}`);
          const sm = await mx.stats();
          check('match: draw calls with a match on', sm.calls <= MATCH_CALLS, `${sm.calls} (max ${MATCH_CALLS}), ${sm.tris} tris`);
          // A distributed PA is only a PA if the arrival delay follows the
          // visitor. Standing at the centre of a symmetric bowl every horn is
          // equidistant (spread ~0); in a corner one is close and one is far.
          // If those two readings match, the delays are constants and the
          // effect is not there, however good it sounds.
          const paCfg = (def.modules || []).find((m) => m.pa)?.pa;
          if (paCfg) {
            // the stem is a few MB and streams: wait for it rather than
            // sampling the frame after the match mounted
            const until = Date.now() + 60000;
            for (;;) {
              const st = (await mx.state()).venues.find((v) => v.id === id).modules[0].state;
              if (st.pa?.ready || st.pa?.error || Date.now() > until) break;
              await mx.step(10);
              await new Promise((r) => setTimeout(r, 500));
            }
          }
          const msA = (await mx.state()).venues.find((v) => v.id === id).modules[0].state;
          if (paCfg) {
            const listen = async (x, z) => {
              await mx.evaluate(`(() => { const v = window.__venue; const w = v.world.toWorld(v.def, { x: ${x}, z: ${z} });
                v.camera.position.set(w.x, 2.2, w.z); v.controls.target.set(w.x + 1, 2.2, w.z);
                v.media.listener.updateMatrixWorld(true); return 1; })()`);
              await mx.step(20);
              const st = (await mx.state()).venues.find((v) => v.id === id).modules[0].state;
              return st.pa || {};
            };
            const mid = await listen(0, 0);
            const corner = await listen(18, -16);
            check('match: PA is streaming the publisher stem', !!mid.ready && mid.speakers === paCfg.speakers.length,
              mid.ready ? `${mid.speakers} speakers, source "${mid.source}"` : `not ready: ${mid.error}`);
            check('match: the venue does not play commentary twice',
              (msA?.sdkAudio || []).some((x) => x.id === (paCfg.source || 'commentary') && x.on === false),
              JSON.stringify(msA?.sdkAudio));
            check('match: PA arrival delay follows the listener',
              corner.spreadMs - mid.spreadMs >= 25,
              `spread ${mid.spreadMs} ms at the centre circle vs ${corner.spreadMs} ms in a corner (near ${corner.nearestMs} / far ${corner.farthestMs} ms)`);
          }
          check('match: renders clean', sm.errors.length === 0 && mx.problems.length === 0, [...sm.errors, ...mx.problems].slice(0, 3).join(' | ') || 'no errors');
          await mx.evaluate('window.__venue.media.setMuted(true)');
          await mx.step(5);
          const ms3 = (await mx.state()).venues.find((x) => x.id === id).modules[0]?.state;
          check('match: mute silences the stage', ms3?.audio === 'muted', `audio ${ms3?.audio}`);
          await mx.setTier(0);
          await mx.step(120);
          const m3 = await sweepOn(mx);
          const dom3 = JSON.parse(await mx.evaluate(DOM_EXPR));
          check('match: dispose leaves no iframes or videos', dom3.iframes === 0 && dom3.videos === 0, `${dom3.iframes} iframes, ${dom3.videos} videos`);
          // second cycle: mount the (now cached) bundle again and unload again
          await mx.setTier(2);
          await mx.step(1);
          await mx.waitLoaded();
          for (let i = 0; i < 360; i++) { const v = (await mx.state()).venues.find((x) => x.id === id); if (v.modules[0]?.state?.phase === 'match') break; await mx.step(10); await new Promise((r) => setTimeout(r, 500)); }
          await mx.step(60);
          await mx.setTier(0);
          await mx.step(120);
          const m4 = await sweepOn(mx);
          check('match: GPU memory steady over two match cycles', m4.memory.geometries <= m3.memory.geometries && m4.memory.textures <= m3.memory.textures && m3.memory.geometries <= m0.memory.geometries + 1, `geometries ${m0.memory.geometries} → ${m3.memory.geometries} → ${m4.memory.geometries}, textures ${m0.memory.textures} → ${m3.memory.textures} → ${m4.memory.textures}`);
        } catch (e) {
          check('match contract', false, e.message);
        } finally {
          if (mx) await mx.close();
        }
      }
      await fx.setTier(0);
      await fx.step(120);
      const s3 = await sweep();
      const st3 = (await fx.state()).venues.find((v) => v.id === id);
      check('tier 0 unload', !st3.loaded && st3.tier === 0 && st3.stats.unloads >= 1, `unloads ${st3.stats.unloads}, disposed ${JSON.stringify(st3.stats.lastDispose)}`);
      // three.js allocates one shared Sprite geometry the first time anything
      // draws a label, so the honest test is no growth across a SECOND cycle
      await fx.setTier(1);
      await fx.step(1);
      await fx.waitLoaded();
      await fx.setTier(2);
      await fx.step(60);
      await fx.setTier(0);
      await fx.step(120);
      const s4 = await sweep();
      check('GPU memory steady over two load/unload cycles', s4.memory.geometries <= s3.memory.geometries && s4.memory.textures <= s3.memory.textures && s3.memory.geometries <= s0.memory.geometries + 1, `geometries ${s0.memory.geometries} → ${s3.memory.geometries} → ${s4.memory.geometries}, textures ${s0.memory.textures} → ${s3.memory.textures} → ${s4.memory.textures}`);
      check('colliders removed', s3.colliders === 0 && s3.doors === (await fx.state()).doors.length, `${s3.colliders} venue colliders, ${s3.doors} doors`);
      check('no page errors overall', s3.errors.length === 0 && fx.problems.length === 0, [...new Set([...s3.errors, ...fx.problems])].slice(0, 5).join(' | ') || 'clean');
    } catch (e) {
      check('fixture run', false, e.message);
    } finally {
      if (fx) await fx.close();
    }
  } else if (!near) {
    console.log('  skip  fixture (no near asset)');
  }

  const ok = checks.every((c) => c.ok);
  if (!ok) failed += 1;
  report.venues.push({ id, ok, checks, near: near && { bytes: near.bytes, tris: near.tris, prims: near.prims, materials: near.materials.length, lights: near.lights } });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}`);
}

const out = arg('out');
if (out) { mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, JSON.stringify(report, null, 2) + '\n'); console.log(`\nreport: ${out}`); }
if (failed) { console.error(`\n${failed} failure(s)`); process.exit(1); }
console.log('\nall venue checks passed');
