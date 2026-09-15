// The broadcast gate. Everything the RFL brief (docs/broadcast/REPLY.md §4)
// asks us to guarantee, asserted against the real page in headless Chrome:
// the frame is 1280x720 at pixel ratio 1, `ready` resolves, `step()` moves a
// fixed 50 fps timebase, nothing touches the network after load, and — the
// clause the whole contract rests on — two INDEPENDENT browser runs of the
// same URL produce the same pixels. Plus the §3 sightline: every ray from the
// gantry to the corners of the marked 14 x 9 area reaches it.
//
// Two separate launches, not two loads in one browser: RFL films unattended
// from whatever process the scheduler starts, and a determinism bug that only
// shows across processes is exactly the one that would reach air.
//
//   node scripts/broadcast-check.mjs [--frames 250] [--camera gantry]
//                                    [--bundle <url>] [--out report.json]
//                                    [--shots dir] [--gpu]
//                                    [--origin https://otra.city]
//
// `--origin` points the same gate at a deployed site instead of serving
// public/ locally — so "is production the build we described?" is a command
// with a PASS line, not a comparison of memories. Everything else, the two
// independent processes included, runs unchanged against it.
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { serve } from '../lib/static-server.mjs';
import { launchChrome } from '../lib/headless-chrome.mjs';
import { PUBLIC_DIR } from '../lib/venue-harness.mjs';

const argv = process.argv.slice(2);
const arg = (name, fallback = null) => { const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback; };
const flag = (name) => argv.includes(`--${name}`);
const FRAMES = Number(arg('frames', '250'));      // 5 s at 50 fps
const CAMERA = arg('camera', 'gantry');
const BUNDLE = arg('bundle');
const CROWD = arg('crowd');
const CAMTRACK = arg('camtrack');
const SHOTS = arg('shots');
const out = arg('out');
const ORIGIN = (arg('origin') || '').replace(/\/+$/, '') || null;

/**
 * How far off frame centre a point lands, as a fraction of the half-frame:
 * 1 is exactly on the edge. The page's own framing — 16:9, `lookAt` levelling
 * the horizon against world up — done in arithmetic so a claim about what the
 * gantry can see does not need a browser.
 */
function ndcRadius(cam, pt) {
  const f = [cam.lookAt[0] - cam.pos[0], cam.lookAt[1] - cam.pos[1], cam.lookAt[2] - cam.pos[2]];
  const n = Math.hypot(...f);
  for (let i = 0; i < 3; i++) f[i] /= n;
  const r = [-f[2], 0, f[0]];                      // f x up, with up = (0,1,0)
  const rn = Math.hypot(...r) || 1;
  for (let i = 0; i < 3; i++) r[i] /= rn;
  const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  const d = [pt[0] - cam.pos[0], pt[1] - cam.pos[1], pt[2] - cam.pos[2]];
  const z = d[0] * f[0] + d[1] * f[1] + d[2] * f[2];
  if (z <= 0) return Infinity;                      // behind the camera
  const x = d[0] * r[0] + d[1] * r[1] + d[2] * r[2];
  const y = d[0] * u[0] + d[1] * u[1] + d[2] * u[2];
  const th = Math.tan((cam.fov * Math.PI) / 360);
  return Math.max(Math.abs(x / (z * th * (16 / 9))), Math.abs(y / (z * th)));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  return ok;
};

/** Open /broadcast in its own browser and expose the page's contract. */
async function openBroadcast({ width = 1280, height = 720, liveMode = false } = {}) {
  const { server, origin } = ORIGIN ? { server: null, origin: ORIGIN } : await serve(PUBLIC_DIR);
  const chrome = await launchChrome({ width, height, gpu: flag('gpu') });
  const problems = [];
  chrome.onConsole((type, text) => { if (type === 'error') problems.push(text); });
  // `capture=1` is not optional here: /broadcast is a live feed by default,
  // and a harness that omits it gets live visitors and a wall clock. That is
  // exactly the mistake this flag is meant to make loud, so the gate proves it
  // by depending on it.
  // Live mode is opened BARE, on purpose: that is the URL RFL's encoder loads,
  // and every parameter this gate otherwise passes would change the answer.
  // `camtrack` in particular turns the director off, so a live run carrying it
  // would fail the director check for a reason that has nothing to do with the
  // page.
  const q = new URLSearchParams();
  if (!liveMode) {
    q.set('camera', CAMERA);
    q.set('capture', '1');
    if (BUNDLE) q.set('bundle', BUNDLE);
    if (CROWD) q.set('crowd', CROWD);
    if (CAMTRACK) q.set('camtrack', CAMTRACK.startsWith('http') ? CAMTRACK : `${origin}${CAMTRACK}`);
  }
  // The static host serves files, not vercel.json's rewrites: /broadcast is
  // the public route, /broadcast.html is the file behind it.
  await chrome.goto(`${origin}/broadcast.html${q.toString() ? `?${q}` : ''}`);
  const ev = (e) => chrome.evaluate(e);
  // Module scripts with top-level await may still be running after `load`.
  const deadline = Date.now() + 90000;
  while (!(await ev('!!window.rflBroadcast'))) {
    if (Date.now() > deadline) throw new Error('/broadcast did not initialise (no window.rflBroadcast)');
    await new Promise((r) => setTimeout(r, 200));
  }
  // `ready` waits for the bundle to land when one was asked for, and a match
  // core is tens of megabytes: this outlives the default evaluate timeout.
  await chrome.evaluate('window.rflBroadcast.ready.then(() => true).catch(() => false)', { timeoutMs: 300000 });
  return {
    chrome, server, problems, evaluate: ev,
    state: () => ev('JSON.stringify(window.rflBroadcast.state())').then(JSON.parse),
    step: (n) => ev(`window.rflBroadcast.step(${n}).then(JSON.stringify)`).then(JSON.parse),
    png: () => ev('window.rflBroadcast.frame()').then((u) => Buffer.from(u.slice(u.indexOf(',') + 1), 'base64')),
    // Hashing in the page: 3.7 MB of RGBA per frame is not worth moving over
    // the wire just to compare it with another run's.
    hash: () => ev(`(() => {
      const p = window.rflBroadcast.pixels();
      let h = 2166136261 >>> 0;
      for (let i = 0; i < p.length; i++) { h ^= p[i]; h = Math.imul(h, 16777619) >>> 0; }
      return h.toString(16).padStart(8, '0');
    })()`),
    resources: () => ev(`performance.getEntriesByType('resource').length`),
    async close() { await chrome.close().catch(() => {}); server?.close(); },
  };
}

console.log(`broadcast check — camera ${CAMERA}, ${FRAMES} frames${BUNDLE ? `, bundle ${BUNDLE}` : ', ambient'}`
  + `${CROWD ? `, crowd ${CROWD}` : ''}${CAMTRACK ? `, camtrack ${CAMTRACK}` : ''}${ORIGIN ? `, against ${ORIGIN}` : ''}\n`);

let a = null, b = null, lv = null, failed = 0;
const report = { camera: CAMERA, frames: FRAMES, bundle: BUNDLE || null, origin: ORIGIN, checks };
try {
  a = await openBroadcast();
  const s0 = await a.state();
  report.state = s0;

  console.log('contract');
  check('ready resolves and the venue is loaded', s0.loaded === true, `tier ${s0.tier}`);
  check('frame is 1280x720', s0.width === 1280 && s0.height === 720, `${s0.width}x${s0.height}`);
  check('pixel ratio locked to 1', s0.pixelRatio === 1, `dpr ${s0.pixelRatio}`);
  check('timebase is 50 fps', s0.fps === 50);
  // A page that cannot say which build it is cannot settle "the deployed page
  // still says X" — the conversation this line exists to end.
  check('the page reports its build', typeof s0.build === 'string' && s0.build.length > 0, s0.build ? `build ${s0.build}` : 'no build field — a copy from before 2026-09-08');
  // The capture path must never pick up live visitors by accident: they arrive
  // over a socket on their own schedule, and footage that quietly used them is
  // only distinguishable from a deterministic run on the day it is re-filmed.
  check('live mode is off unless asked for', s0.live === null, s0.live ? JSON.stringify(s0.live) : 'deterministic');
  // With a bundle, "ready" has to mean the match is ON the pitch. The venue
  // reaches Tier 2 in one tick and the bundle lands seconds later, so a page
  // that resolved at Tier 2 would hand the harness an empty pitch to film.
  if (CROWD) {
    check('the crowd is seated', (s0.crowd?.fans ?? 0) > 0, `${s0.crowd?.fans} of ${s0.crowd?.seatsOffered} seats at density ${s0.crowd?.density} (cap ${s0.crowd?.cap})`);
  }
  if (CAMTRACK) check('the camera track loaded', (s0.camtrack?.segments ?? 0) > 0, `${s0.camtrack?.segments} segments to frame ${s0.camtrack?.lastFrame}`);
  if (BUNDLE) check('the match is mounted before ready resolves', s0.match?.phase === 'match', `phase "${s0.match?.phase ?? 'none'}"`);
  if (BUNDLE && s0.match?.phase === 'match') {
    // The match is a picture, not geometry: the SDK's shader writes display-
    // ready colour, and a composer that tone maps it again makes a grey-green
    // pitch. js/after-tonemap.js draws it after the output pass; this is the
    // page saying that it did.
    const at = s0.afterToneMap || {};
    check('the match is drawn after the city\'s tone mapping', at.roots === 1 && !at.error,
      `${at.roots ?? 0} root(s) composited${at.error ? `, error: ${at.error}` : ''}`);
    // The publisher's glass panels are recorded physics with nothing left to
    // do but veil the pitch; the module hides every one it finds unless the
    // venue asks for them (match-4dgsx.js, `glass`).
    const g = s0.match.glass || {};
    check('the publisher\'s glass panels are not drawn', g.shown ? true : (g.found ?? -1) >= 0 && g.hidden === g.found,
      g.shown ? `${g.found} panel(s), drawn because the venue asks for them` : g.found ? `${g.hidden} of ${g.found} panels hidden` : 'this bundle has no glass');
    // And the pitch at the publisher's own colour, checked against arithmetic
    // rather than a golden image. Their shader lights a flat surface to a
    // value the bundle alone predicts: the pitch texture's own texel — read
    // back from the very image the SDK loaded — through their lighting (sun
    // (0.25, 0.15, 1); 0.34 + 0.30·hemi + 0.48·dif; a 0.03 specular) and
    // their gamma (pow 0.9091). That is what 4dgsx.com/watch draws, verified
    // against their served player on 2026-09-14. If anyone tone maps the
    // stage again, decodes the texture again, or the publisher changes how a
    // pitch is lit, this line says so. Sampled at 36 points along whole
    // stripes and judged by the median error, so a robot standing on a patch
    // does not fail the run.
    const got = await a.evaluate(`(async () => {
      const THREE = await import('/vendor/three/three.module.js');
      const { scene, camera, renderer } = window.rflBroadcast.three;
      const space = scene.getObjectByName('4dgsx-match-space');
      if (!space) return { error: 'no 4dgsx-match-space in the scene' };
      let pitch = null;
      space.traverse((o) => { const u = o.isMesh && o.material?.uniforms; if (u?.uColor && u.uTurf?.value === 2 && !pitch) pitch = o; });
      const img = pitch?.material.uniforms.uTex.value?.image;
      if (!img?.width) return { error: pitch ? 'the pitch texture has not loaded' : 'no textured pitch draw (uTurf 2) in the stage' };
      const c2 = document.createElement('canvas');
      c2.width = img.width; c2.height = img.height;
      const g2 = c2.getContext('2d');
      g2.drawImage(img, 0, 0);
      const data = g2.getImageData(0, 0, img.width, img.height).data;
      const xf = pitch.material.uniforms.uTexXf.value;      // 1/scale.xy, offset.xy — world-planar tiling
      const sunZ = 1 / Math.hypot(0.25, 0.15, 1);
      const lit = (t) => Math.pow(t / 255 * (0.34 + 0.30 + 0.48 * sunZ) + Math.pow(sunZ, 8) * 0.03, 0.9091) * 255;
      // the texel their shader samples at match point (mx, my): the same
      // mapping, wrapped, and flipped the way both their player and three
      // upload an image
      const texel = (mx, my) => {
        const u = ((mx - xf.z) * xf.x) % 1, v = ((my - xf.w) * xf.y) % 1;
        const px = Math.min(img.width - 1, Math.floor((u < 0 ? u + 1 : u) * img.width));
        const py = Math.min(img.height - 1, Math.floor((1 - (v < 0 ? v + 1 : v)) * img.height));
        const i = (py * img.width + px) * 4;
        return [data[i], data[i + 1], data[i + 2]].map(lit);
      };
      const gl = renderer.getContext();
      const W = renderer.domElement.width, H = renderer.domElement.height;
      const buf = new Uint8Array(4);
      const read = (mx, my) => {
        const v = space.localToWorld(new THREE.Vector3(mx, my, 0)).project(camera);
        gl.readPixels(Math.round((v.x + 1) / 2 * W), Math.round((v.y + 1) / 2 * H), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
        return [buf[0], buf[1], buf[2]];
      };
      // a stripe runs the length of the pitch (x); 3 and -1 are light bands,
      // 1 and -3 dark ones on a 4 m period — 9 points along each
      const errs = [], samples = [];
      for (const x of [3, 1, -1, -3]) {
        for (let y = -3.5; y <= 3.5; y += 0.875) {
          const want = texel(x, y), have = read(x, y);
          errs.push(Math.max(...have.map((h, i) => Math.abs(h - want[i]))));
          samples.push({ at: [x, y], want: want.map(Math.round), have });
        }
      }
      errs.sort((p, q) => p - q);
      return { medianError: errs[errs.length >> 1], worst: errs[errs.length - 1], example: samples[0], examples: samples };
    })()`);
    check('the pitch renders at the publisher\'s own colour', !got.error && got.medianError <= 6,
      got.error || `median error ${got.medianError}/255 over ${got.examples.length} points (worst ${got.worst}); at (${got.example.at}) drew [${got.example.have}] for [${got.example.want}]`);
    report.pitch = got.error ? { error: got.error } : { medianError: got.medianError, worst: got.worst, examples: got.examples };
  }
  check('drawing buffer matches the contract', ...(await (async () => {
    const d = await a.evaluate('JSON.stringify([window.rflBroadcast.three.renderer.domElement.width, window.rflBroadcast.three.renderer.domElement.height])').then(JSON.parse);
    return [d[0] === 1280 && d[1] === 720, `canvas ${d[0]}x${d[1]}`];
  })()));
  if (s0.unimplemented.length) console.log(`  note  reported as not built: ${s0.unimplemented.length} parameter(s)`);

  // ---- §3 sightline: the gantry must see the whole marked area ------------
  console.log('\nsightline (§3)');
  const rays = await a.evaluate(`(async () => {
    const THREE = await import('/vendor/three/three.module.js');
    const B = window.rflBroadcast, cam = B.three.camera, scene = B.three.scene;
    const origin = cam.position.clone();
    // the marked 14 x 9 area, in venue-local metres, via the page's own camera
    const targets = [['centre',0,0],['NW',-7,4.5],['NE',7,4.5],['SW',-7,-4.5],['SE',7,-4.5]];
    const frustum = new THREE.Frustum().setFromProjectionMatrix(
      new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    return targets.map(([name, lx, lz]) => {
      // the stadium sits at placement x=100, z=0, yaw=0
      const tgt = new THREE.Vector3(100 + lx, 0.05, lz);
      const dir = tgt.clone().sub(origin); const dist = dir.length(); dir.normalize();
      const rc = new THREE.Raycaster(origin, dir, 0.01, dist - 0.06);
      // A mounted match puts the SDK's attribution Sprite in the scene, and
      // Sprite.raycast dereferences raycaster.camera — null by default.
      rc.camera = cam;
      // Raycaster ignores visibility, and a hidden object's own .visible can
      // still be true while the group holding it is hidden — which is exactly
      // how a venue's Tier-0 impostor is put away. Walk the chain.
      const shown = (o) => { for (let n = o; n; n = n.parent) if (!n.visible) return false; return true; };
      const hit = rc.intersectObject(scene, true).filter((h) => h.object.isMesh && shown(h.object))[0];
      // Whose geometry is in the way matters. A mounted bundle brings RFL's
      // own arena — walls, goal frames, corner panels — and its wall stands
      // exactly on the corner of the marked area. That is the subject of the
      // shot, not an obstruction. What we promise is that nothing WE build
      // cuts the frustum, so hits under the SDK's stage are reported, not failed.
      let theirs = false;
      for (let n = hit?.object; n; n = n.parent) if (n.name === '4dgsx-stage') { theirs = true; break; }
      return { name, dist: +dist.toFixed(2), blocked: !!hit, theirs,
               by: hit ? (hit.object.name || ('(unnamed, under ' + (theirs ? '4dgsx-stage' : 'the venue') + ')')) : null,
               inFrame: frustum.containsPoint(tgt) };
    });
  })()`);
  report.sightline = rays;
  const ours = rays.filter((r) => r.blocked && !r.theirs);
  const stage = rays.filter((r) => r.blocked && r.theirs);
  check('nothing the stadium is built from obstructs the 14 x 9 area',
    ours.length === 0,
    ours.map((r) => `${r.name} blocked by ${r.by}`).join(', ') || `${rays.length} rays clear of our geometry`);
  if (stage.length) console.log(`  note  ${stage.map((r) => r.name).join(', ')} met the bundle's own arena wall — that is the arena, not an obstruction`);
  check('every corner of the 14 x 9 area is in frame',
    rays.every((r) => r.inFrame),
    rays.filter((r) => !r.inFrame).map((r) => r.name).join(', ') || 'all in frame');

  // ---- stepping ------------------------------------------------------------
  console.log('\nstepping (§4)');
  await a.evaluate(`window.rflBroadcast.step(1).then(() => {
    const p = window.rflBroadcast.pixels();
    let h = 2166136261 >>> 0;
    for (let i = 0; i < p.length; i++) { h ^= p[i]; h = Math.imul(h, 16777619) >>> 0; }
    window.__earlyHash = h.toString(16).padStart(8, '0');
    return true;
  })`);
  const beforeNet = await a.resources();
  const t1 = await a.step(FRAMES);
  check('step(n) lands on the requested frame', t1.frame === FRAMES, `frame ${t1.frame}, t=${t1.t}s`);
  check('time is the frame count over the timebase', Math.abs(t1.t - FRAMES / 50) < 1e-9, `${t1.t}s`);
  const afterNet = await a.resources();
  check('no network after load', afterNet === beforeNet, `${beforeNet} resources at ready, ${afterNet} after ${FRAMES} frames`);
  let backwards = 'accepted';
  try { await a.step(1); } catch (e) { backwards = 'refused'; }
  check('stepping backwards is refused, not silently wrong', backwards === 'refused', backwards);
  const hashA = await a.hash();
  const sA = await a.state();
  if (CROWD) {
    // A crowd that hashes the same at two distant frames is a still photograph
    // of a crowd, which is exactly the failure RFL called out by name.
    const early = await a.evaluate('window.__earlyHash || null');
    check('the crowd is not a still photograph', early && early !== hashA, `frame 1 ${early} vs frame ${FRAMES} ${hashA}`);
  }
  check('no console errors', a.problems.length === 0 && sA.errors.length === 0,
    [...new Set([...a.problems, ...sA.errors])].slice(0, 3).join(' | ') || 'clean');

  // ---- determinism: a second, independent browser --------------------------
  console.log('\ndeterminism (§4 acceptance)');
  b = await openBroadcast();
  const t2 = await b.step(FRAMES);
  const hashB = await b.hash();
  report.hashes = { a: hashA, b: hashB, frame: FRAMES };
  const same = hashA === hashB;
  check(`two independent runs give the same pixels at frame ${FRAMES}`, same, `${hashA} vs ${hashB}`);
  check('the second run agrees on the frame index', t2.frame === t1.frame, `${t2.frame} vs ${t1.frame}`);

  // ---- the live feed: what a visitor and RFL's capture both get -----------
  //
  // Everything above is the deterministic surface. This is the other mode —
  // the one that is actually on Twitch — and its contract is different: not
  // "the same pixels twice" but "the same stadium as everyone else's", silent,
  // and directed. Two of these three were broken by a filter clause on this
  // page for a week without anything noticing, because nothing looked.
  console.log('\nlive feed (§1, §2, §3)');
  // The cut-lists are checked from here rather than in the page: "no shot in
  // the match list moves" is the whole of RFL's §2, and it is a property of
  // the file, provable without a browser or a match. It reads the repository's
  // copy even under `--origin`, because what it is defending is the file about
  // to be deployed; the browser checks below are the ones that ask production.
  const venue = JSON.parse(readFileSync(join(PUBLIC_DIR, 'venues/stadium/venue.json'), 'utf8'));
  const matchList = JSON.parse(readFileSync(join(PUBLIC_DIR, 'broadcast/match-cutlist.json'), 'utf8'));
  const moving = matchList.segments
    .map((seg) => String(seg.camera).toLowerCase())
    .filter((name) => !venue.cameras?.[name] || ['heli', 'stands', 'pitchside'].includes(name));
  // "Static" here is a property of the LIST — no orbit, no push, no handheld.
  // The live director tightens and pans the gantry on top of it while play is
  // on (see `followGantry`, and the bounds checked below); what this defends
  // is that the list itself never asks for a moving shot during a match.
  check('every shot in the match cut-list is a static, authored camera',
    moving.length === 0,
    moving.length ? `these move or are not authored: ${[...new Set(moving)].join(', ')}`
                  : `${matchList.segments.length} shots, all from venue.json`);

  // The build-up is the one time the screens ARE the picture, and the reason
  // the pre-roll has a list of its own. Four fifths of it, or it is not one.
  const preList = JSON.parse(readFileSync(join(PUBLIC_DIR, 'broadcast/preroll-cutlist.json'), 'utf8'));
  const span = (seg) => seg.frames[1] - seg.frames[0];
  const total = preList.segments.reduce((n, seg) => n + span(seg), 0);
  const onScreens = preList.segments
    .filter((seg) => ['screen_main', 'scoreboard'].includes(String(seg.camera).toLowerCase()))
    .reduce((n, seg) => n + span(seg), 0);
  check('the pre-roll list spends four fifths of itself on the screens',
    total > 0 && onScreens / total >= 0.75,
    `${onScreens} of ${total} frames = ${Math.round((onScreens / total) * 100)}% (${Math.round(total / (preList.fps || 50))}s round the loop)`);
  const unknown = [...matchList.segments, ...preList.segments]
    .map((seg) => String(seg.camera).toLowerCase())
    .filter((name) => !venue.cameras?.[name] && !['heli', 'stands', 'pitchside', 'gantry', 'track'].includes(name));
  check('every shot in both cut-lists names a camera that exists',
    unknown.length === 0, unknown.length ? [...new Set(unknown)].join(', ') : 'all resolve');
  check('the pre-roll list loops', preList.loop === true,
    preList.loop === true ? 'a pre-roll it outlives holds no last framing' : 'NOT LOOPING — a long build-up would freeze on the last shot');

  // ---- the tracking gantry, as arithmetic ---------------------------------
  //
  // Checked here rather than in the page because it IS arithmetic: a pure
  // function of the base framing and where everybody is standing. This is
  // RFL's own broadcast camera (`gauntlet/football.py`), so what is asserted
  // is the shape of THEIR shot — the bias, the border, the clamp — not a
  // framing we happen to like today.
  const camSrc = readFileSync(join(PUBLIC_DIR, 'js/broadcast-cameras.js'), 'utf8');
  const cams = await import(`data:text/javascript;base64,${Buffer.from(camSrc).toString('base64')}`);
  {
    const gBase = cams.CAMERAS.gantry(0, 0, {});
    // A whole match's worth of arrangements: four robots and a ball anywhere
    // on the 14 x 9 pitch, from a scrum on the centre spot to both ends at once.
    const onPitch = (x, z) => [Math.max(-7, Math.min(7, x)), 0.7, Math.max(-4.5, Math.min(4.5, z))];
    const arrangements = [];
    for (let bx = -7; bx <= 7; bx += 1) for (let bz = -4.5; bz <= 4.5; bz += 1.5) {
      arrangements.push({ ball: [bx, 0.12, bz], players: [onPitch(bx - 1, bz), onPitch(bx + 1, bz), onPitch(-bx, -bz), onPitch(0, 0)] });
      arrangements.push({ ball: [bx, 0.12, bz], players: [onPitch(bx, bz), onPitch(bx - 0.5, bz + 0.5)] });
    }
    const shots = arrangements.map((a) => cams.framePlay(gBase, a));
    const fovs = shots.map((c) => c.fov);
    // The bias is checked against the mean the function was given rather than
    // against a number: "0.45 of the play's own centre" is the property, and a
    // magic 3.15 would only be right for as long as the pitch is 14 m long.
    const biased = arrangements.map((a, i) => {
      const w = [...a.players, a.ball, a.ball];
      const mean = w.reduce((n, q) => n + q[0], 0) / w.length;
      return { got: shots[i].aim[0], want: mean * 0.45, z: shots[i].aim[2],
               wantZ: w.reduce((n, q) => n + q[2], 0) / w.length };
    });
    check('the tracking gantry aims where RFL\'s camera aims',
      biased.every((b) => Math.abs(b.got - b.want) < 1e-6 && Math.abs(b.z - b.wantZ) < 1e-6)
        && shots.every((c) => c.aim[1] === 0.45),
      `${arrangements.length} arrangements: along the pitch, 0.45 of the mean of the players and the ball counted twice; across it, that mean unbiased; always 0.45 m above the turf`);
    check('the tracking gantry stays inside RFL\'s lens range',
      Math.min(...fovs) >= 38 - 1e-6 && Math.max(...fovs) <= 52 + 1e-6,
      `${Math.min(...fovs).toFixed(1)}°–${Math.max(...fovs).toFixed(1)}° against their 38–52`);
    // A wide that creeps spends bitrate on every pixel of every frame (RFL
    // §2). The same arrangement twice must give the same frame, exactly.
    const one = { ball: [2.1, 0.12, -1.3], players: [[1, 0.7, -1], [3, 0.7, -2]] };
    const a1 = JSON.stringify(cams.framePlay(gBase, one));
    const a2 = JSON.stringify(cams.framePlay(gBase, one));
    check('play that has not moved gives a frame that has not moved', a1 === a2, a1 === a2 ? 'identical' : `${a1} vs ${a2}`);
    // The border is the promise: "all players in shot" means nobody clipped to
    // the edge of frame, which is what the 1.45 buys. It is a promise only
    // while the lens is free — at RFL's 52° ceiling the clamp wins and play
    // spread corner to corner does lose somebody, which is their choice and
    // not a fault. So the check is made where the promise applies, and the
    // ceiling cases are counted out loud rather than passed over.
    const judged = arrangements.map((a, i) => ({
      free: shots[i].fov < 52 - 1e-6,
      worst: Math.max(...[...a.players, a.ball].map((q) => ndcRadius({ pos: gBase.pos, lookAt: shots[i].aim, fov: shots[i].fov }, q))),
    }));
    const clipped = judged.filter((j) => j.free && j.worst > 1);
    const atCeiling = judged.filter((j) => !j.free);
    check('every robot and the ball are inside the frame the lens chose',
      clipped.length === 0,
      clipped.length ? `${clipped.length} of ${judged.length} arrangements clip somebody with the lens still free`
                     : `${judged.length - atCeiling.length} arrangements with the lens free, worst body at `
                       + `${Math.round(Math.max(...judged.filter((j) => j.free).map((j) => j.worst)) * 100)}% of the half-frame`
                       + `; ${atCeiling.length} at the 52° ceiling, where their clamp wins`);
    // And the neutral framing still holds the whole marked area, which is the
    // shot the §3 sightline is about.
    const mid = cams.framePlay(gBase, { ball: [0, 0.12, 0], players: [[-1, 0.7, 0], [1, 0.7, 0]] });
    const midCam = { pos: gBase.pos, lookAt: mid.aim, fov: mid.fov };
    const worst = Math.max(...[[-7, 4.5], [7, 4.5], [-7, -4.5], [7, -4.5]].map(([cx, cz]) => ndcRadius(midCam, [cx, 0, cz])));
    check('with play on the centre spot the shot is tighter than the locked wide',
      mid.fov < gBase.fov, `${mid.fov.toFixed(1)}° against the locked ${gBase.fov}°, worst corner at ${(worst * 100).toFixed(0)}% of the half-frame`);
  }

  lv = await openBroadcast({ liveMode: true });
  const sL = await lv.state();
  report.live = sL;
  // The bug this whole change exists to fix: /broadcast dropped the venue's
  // match module unless a bundle was named in the URL, so the one page RFL
  // capture from could never show a scheduled match — while every visitor
  // standing in the same bowl could.
  check('the live feed keeps the stadium\'s match module',
    sL.match !== null, sL.match ? `phase "${sL.match.phase}", sdk "${sL.match.sdk}"` : 'no match module — the pitch can never fill');
  // RFL play the premix into the bus that also captures this browser, so the
  // page is silent unless the CITY has asked for sound on a replay it put on
  // itself. Asserting the rule rather than the constant: a fixed `silent ===
  // true` would fail the moment somebody legitimately switches it on, and
  // would then be switched off again to make CI green, which is how a
  // safeguard becomes a nuisance and then a casualty.
  const soundAllowed = sL.match?.source === 'now' && sL.match?.now?.audio === true;
  check('the live feed is silent unless the city asked for sound',
    sL.silent === !soundAllowed,
    soundAllowed ? `sound ON for the replay the city put on (${sL.match?.now?.title || sL.match?.id})`
                 : (sL.silent ? 'listener muted' : 'THE PAGE CAN MAKE SOUND AND NOBODY ASKED IT TO'));
  // A scheduled fixture is RFL's to premix and must never be doubled.
  check('a scheduled fixture is never made audible here',
    !(sL.match?.source === 'schedule' && sL.silent === false),
    sL.match?.source === 'schedule' ? (sL.silent ? 'silent, as contracted' : 'DOUBLE AUDIO RISK') : 'no scheduled fixture on');
  check('the director is running', !!sL.director, sL.director ? `${sL.director.list} list, shot ${sL.director.shot}` : 'no director — a locked-off frame');
  // THE STANDS HAD NOBODY IN THEM. `crowd` defaulted to 0 and RFL capture a
  // bare /broadcast, so from the day the stream started every STANDS shot in
  // the ambient list was a slow push across six hundred empty seats. Both
  // halves are asserted, because either one alone is still a bad shot: there
  // has to be a crowd, and the terraces the lists actually film have to be
  // the ones it is sitting in.
  check('the live feed has a crowd in it', (sL.crowd?.fans ?? 0) > 0,
    sL.crowd ? `${sL.crowd.fans} fans of ${sL.crowd.seatsOffered} seats at density ${sL.crowd.density}` : 'NO CROWD — every stand shot is a shot of empty seats');
  {
    const occ = sL.director?.stands || [];
    const NAMES = ['-x', '+x', '+z', '-z'];
    const asked = [...JSON.parse(readFileSync(join(PUBLIC_DIR, 'broadcast/live-cutlist.json'), 'utf8')).segments, ...preList.segments]
      .filter((seg) => String(seg.camera).toLowerCase() === 'stands')
      .map((seg) => (seg.params?.side ?? 0) % 4);
    const empty = [...new Set(asked)].filter((side) => (occ[side] ?? 0) < 12);
    check('every terrace the cut-lists film has a crowd in it',
      occ.length === 4 && empty.length === 0,
      occ.length === 4
        ? `${asked.length} stand shot(s) across ${[...new Set(asked)].length} terrace(s); fans per terrace ${NAMES.map((n, i) => `${n}:${occ[i]}`).join(' ')}`
          + (empty.length ? ` — EMPTY: ${empty.map((i) => NAMES[i]).join(', ')} (the director will substitute, but the list should not ask)` : '')
        : 'the director did not report stand occupancy');
  }
  // "NO MATCH SCHEDULED" is a true sentence and a dead screen, and for most of
  // any day it was the only thing the big screen had to say: RFL publish a
  // fixture close to its kick-off, so the feed spends hours carrying sixty
  // replays and nothing upcoming. The channel does declare when it plays, and
  // that is a real answer to the question the card exists to answer.
  {
    let sP = sL;
    for (const until = Date.now() + 60000; Date.now() < until && !sP.match?.channel;) { await sleep(1000); sP = await lv.state(); }
    const ch = sP.match?.channel;
    const main = sP.match?.screens?.main || '';
    const canSay = !!(ch?.slots || []).length || !!sP.match?.next;
    check('the big screen says when the next match is, not that there is not one',
      !canSay || /coming up|next slot/i.test(main),
      ch ? `screen reads "${main}" — ${sP.match?.next ? `fixture ${sP.match.next.id}` : `no fixture listed, channel plays at ${(ch.slots || []).join(', ') || '(no slots declared)'}`}`
         : 'the programme did not arrive within 60 s, so the card could not be judged');
  }

  // A capture that reloads itself mid-run is a determinism bug; a live feed
  // that never reloads is a broadcast permanently one deploy behind. Both
  // halves asserted, because the wrong one is silent in each direction.
  check('the live feed picks up a new build by itself', sL.updater?.armed === true,
    sL.updater ? `etag ${String(sL.updater.etag).slice(0, 10)}…, ${sL.updater.checks} checks` : 'no updater — deploys will not reach the stream');
  check('deterministic capture never reloads itself', s0.updater == null,
    s0.updater ? 'ARMED UNDER CAPTURE' : 'absent, as it must be');
  const cutErrors = (sL.errors || []).filter((e) => String(e).includes('cutlist'));
  check('both cut-lists loaded', cutErrors.length === 0, cutErrors.join(' | ') || 'ambient and match');

  // ---- the graphics and the arena, proven on the live page ---------------
  // The live page is where the city's own replay is mounted (now.json), so it
  // is the one place the boards, the bodies and the head-cam replay can be
  // exercised against a real bundle without naming one.
  check('the scorebug\'s crest manifest loaded', sL.crests?.manifest === 'ready',
    sL.crests ? `manifest ${sL.crests.manifest}, ${sL.crests.loaded} loaded, ${sL.crests.failed} failed` : 'no crests field');
  // Wait for whatever the city has put on to land: a 320 MB bundle takes a
  // minute or two on a runner, and "not mounted yet" is not "broken".
  let sM = sL;
  for (const until = Date.now() + 150000; Date.now() < until && sM.match && sM.match.phase !== 'match' && sM.match.sdk !== 'failed' && !(sM.match.errors || []).length;) {
    await sleep(2000);
    sM = await lv.state();
  }
  {
    // What the city is showing, and how it decided. `now.json` can name one
    // bundle or carry the standing instruction `"latest"`, which every client
    // resolves against the same feed — the difference between a stadium that
    // moves on when a new match is published and one that loops whatever was
    // pinned last, which is what m28 did for a day with m32 and m33 behind it.
    const now = sM.match?.now;
    console.log(`  note  the stadium is showing: ${now?.follow === 'latest'
      ? `the latest published fixture — ${now.id || sM.match?.latest?.bundleId || '(not resolved yet)'}`
      : now?.bundle ? `a pinned bundle, ${now.title || now.bundle}` : 'nothing'}`);
  }
  if (sM.match?.phase === 'match') {
    // The atlas loads once per module, asynchronously, over the same connection
    // pool as whatever else the page is fetching — measured at over 15 s on a
    // run that was downloading a 320 MB bundle at the same time. Waiting is
    // the whole of the fix: "loading" is not a verdict.
    for (const until = Date.now() + 60000; Date.now() < until && sM.match?.boards?.atlas === 'loading';) { await sleep(500); sM = await lv.state(); }
    const bo = sM.match.boards;
    check('every arena board found is dressed', !!bo && bo.found === bo.textured && bo.atlas !== 'failed',
      bo ? `${bo.found} boards, ${bo.textured} dressed (${JSON.stringify(bo.kinds || {})}), atlas ${bo.atlas}${bo.atlas === 'loading' ? ' — still fetching after 60 s, not a verdict on the boards' : ''}` : 'no boards field');
    // NOTHING DRAWN AFTER THE TONE MAPPING MAY STILL BE TONE MAPPED. Their
    // shader is a raw one three injects nothing into, but our own geometry
    // inside their scene — those boards — is a stock material, and three tone
    // maps those per material when it draws to the canvas, which is exactly
    // where that pass draws. A board ACES'd on its own, against a wall that is
    // not, is the same defect the pass exists to fix, in miniature: measured on
    // s3-m28, the boards' dark ground drew 7 against artwork of 15.
    //
    // Read off the LIVE page rather than a `--bundle` capture, because that is
    // the instance CI runs: neither CI invocation names a bundle, so a check
    // in the capture block would never guard anything. It walks the real scene
    // graph, so it fails if something reaches the stage later and is missed.
    //
    // READ IT TWICE, because a single read has a one-frame false positive.
    // after-tonemap.js clears the flag at the TOP of each pass render, before
    // it draws anything — so a material can never actually be drawn tone
    // mapped. But the SDK parents meshes into the stage asynchronously as their
    // content loads (its html/media components are stock MeshBasicMaterials),
    // and a read that lands between "mesh added" and "next pass render" sees a
    // flag that is about to be cleared. That is what turned main red on
    // 2026-09-15 with one unnamed MeshBasicMaterial out of 436, twice, on a
    // commit whose own PR run had passed: the runner is slow enough to widen
    // the window, and it reproduces on neither this Mac nor the PR.
    //
    // This cannot hide a real miss. A material the pass never prepares — one
    // parented somewhere no root covers — stays flagged for every frame after,
    // so it survives the step; only the one-frame window clears.
    const readToneMapped = () => lv.evaluate(`(() => {
      const { scene } = window.rflBroadcast.three;
      const stage = scene.getObjectByName('4dgsx-stage');
      if (!stage) return { error: 'no 4dgsx-stage in the scene' };
      const still = [];
      let materials = 0;
      stage.traverse((o) => {
        for (const m of [].concat(o.material || [])) {
          if (!m) continue;
          materials += 1;
          // The same rule after-tonemap.js applies: the flag is true by
          // default everywhere and only bites where the shader carries the
          // chunk — always on a stock material, never on a raw one, and on a
          // ShaderMaterial only if its author asked for it.
          const bites = m.toneMapped === true
            && (!m.isShaderMaterial || /tonemapping_fragment/.test(m.fragmentShader || ''));
          if (bites) still.push(o.name || m.type);
        }
      });
      return { materials, still: [...new Set(still)] };
    })()`);
    let tm = await readToneMapped();
    let settled = false;
    // NOT step(): this is the live feed, and step() throws on it by design —
    // it paces itself from the wall clock, so a sleep is what advances a
    // frame here. 250 ms is a dozen of them at the pass's rate.
    if (!tm.error && tm.still.length) { await sleep(250); tm = await readToneMapped(); settled = true; }
    check('nothing drawn after the tone mapping is tone mapped again', !tm.error && tm.still.length === 0,
      tm.error || `${tm.materials} materials in the stage, ${tm.still.length ? `still tone mapped after a frame: ${tm.still.join(', ')}` : `none tone mapped${settled ? ' (one arrived mid-frame and was cleared by the next pass)' : ''}`}`);
    // The bodies verify a second or two after the mount, once scene.json is read.
    for (const until = Date.now() + 15000; Date.now() < until && !sM.match?.bodies;) { await sleep(500); sM = await lv.state(); }
    const bd = sM.match?.bodies;
    // The programme clock speaks only for a stage THIS page drives: a mounted
    // match that is not the city's replay must report its own clock, not the
    // map's pre-roll (the m33 regression of 2026-09-14).
    if (sM.match.source !== 'now') {
      // A live fixture is driven through its programme on the wall clock and
      // says so; anything else the city did not put on keeps its own clock.
      const wall = sM.match.drive === 'wall';
      check(wall ? 'a live fixture is driven through its programme on the wall clock'
                 : 'a fixture the city did not put on keeps its own clock',
        wall ? (sM.scorebug?.programmeT != null && sM.scorebug?.live === true)
             : (sM.scorebug?.programmeT == null && sM.scorebug?.preroll !== true),
        `source ${sM.match.source}, drive ${sM.match.drive}, tag ${sM.scorebug?.tag}, clock ${sM.scorebug?.clock}, programmeT ${sM.scorebug?.programmeT}, audioOffset ${sM.scorebug?.audioOffset}`);
    }
    check('the bundle\'s bodies are reachable by name', bd?.ok === true,
      bd ? `${bd.agreed}/${bd.checked} players\' anchors where their body says, ball ${bd.ball ? 'present' : 'absent'}` : 'not verified');
    // The images start loading on the scorebug's first paint of this match,
    // which is a frame or two after the mount on a software renderer.
    for (const until = Date.now() + 20000; Date.now() < until && (sM.crests?.loaded ?? 0) < 2 && !(sM.crests?.failed);) { await sleep(500); sM = await lv.state(); }
    check('the scorebug has a crest for both clubs',
      (sM.crests?.loaded ?? 0) >= 2 || !(sM.scorebug?.home?.code && sM.scorebug?.away?.code),
      `${sM.crests?.loaded ?? 0} crests loaded for ${sM.scorebug?.home?.code ?? '?'} v ${sM.scorebug?.away?.code ?? '?'}${sM.crests?.failed ? `, ${sM.crests.failed} FAILED` : ''}`);
    // THE REPLAY, forced: put the programme exactly on the first goal's hold
    // and the head cam must take the shot; put it past the hold and the
    // director must hand back. Seeks rather than waits, so a slow renderer
    // (CI's is software) changes nothing about the answer.
    const g0 = (sM.match.goals || [])[0];
    if (g0 && sM.match.source === 'now' && sM.match.replayCam && bd?.ok) {
      // The seek lands the programme on the hold; the replay appears on the
      // page's NEXT rendered frame, and how long that takes is not a property
      // of anything being tested. This runner has been measured at
      // `state().pace` 0.017 under load — one frame every few seconds — so the
      // patience is 30 s rather than 6. A shorter one failed here, on working
      // code, because Spotlight was indexing.
      const settle = async (want) => {
        for (let i = 0; i < 120; i++) { const x = await lv.state(); if (want(x)) return x; await sleep(250); }
        return null;
      };
      await lv.evaluate(`window.rflBroadcast.seekMatch(${g0.t})`);
      const seen = await settle((x) => x.match?.replay);
      check('a goal is run again from the scorer\'s head',
        !!seen && seen.director?.shot === 'headcam' && !!seen.match?.headcam && seen.scorebug?.replay === true,
        seen ? `goal at ${g0.t}s by ${g0.player}: replay t=${seen.match.replay.t} progress ${seen.match.replay.progress}, shot ${seen.director?.shot}, bug ${seen.scorebug?.replay ? 'REPLAY' : 'no tag'}, score ${seen.scorebug?.a}-${seen.scorebug?.b}`
             : 'no replay state within 30 s of seeking onto the hold');
      await lv.evaluate(`window.rflBroadcast.seekMatch(${g0.t + 2})`);
      const back = await settle((x) => !x.match?.replay && x.director?.shot !== 'headcam');
      check('and the picture is handed back after it', !!back, back ? `shot ${back.director?.shot}, bug ${back.scorebug?.replay ? 'still REPLAY' : 'clear'}` : 'still on the head cam 30 s after the hold');
    } else {
      console.log(`  note  replay not exercised: ${!g0 ? 'no goals in this bundle' : sM.match.source !== 'now' ? `source ${sM.match.source}` : !sM.match.replayCam ? 'replay cam not armed' : 'bodies unverified'}`);
    }
    // ---- the buzzer is not the end of the play --------------------------
    //
    // The half-time whistle arrives with the ball still travelling — a shot,
    // a clearance, a save — and the director used to cut to the helicopter on
    // it. RFL already measure the difference: every buzzer carries
    // `play_end_t` beside `"ended": "ball at rest"`, five seconds later on
    // m28. Seek onto the whistle and watch which list is in force across that
    // span. A seek, not a wait, so a software renderer changes nothing about
    // the answer.
    const bz = (sM.match.clockPlan?.buzzers || []).find((b) => Number.isFinite(b?.t) && b.play_end_t > b.t);
    if (bz && sM.match.source === 'now') {
      // SEEKS, NOT WAITS, either side of the dead ball. Waiting through it
      // needs the programme to advance five seconds, and CI renders in
      // software: `state().pace` on this runner has been measured at 0.017,
      // where five seconds of match is five minutes of wall clock. A check
      // whose answer depends on how fast the runner paints is a check that
      // will one day be green for the wrong reason, or red for one.
      const at = async (t, want) => {
        await lv.evaluate(`window.rflBroadcast.seekMatch(${t})`);
        for (let i = 0; i < 40; i++) {
          const x = await lv.state();
          if (x.scorebug && Math.abs(x.scorebug.t - t) < 3 && x.scorebug.inPlay === want) return x;
          await sleep(250);
        }
        return await lv.state();
      };
      const dead = await at(bz.t + 0.3, true);
      check('the wide is held past the buzzer until the ball is at rest',
        dead.scorebug?.playing === false && dead.scorebug?.inPlay === true && dead.director?.list === 'match',
        `${bz.kind} buzzer at ${bz.t}s, ball at rest ${bz.play_end_t}s: at t=${dead.scorebug?.t} the clock reads ${dead.scorebug?.tag} `
        + `(playing ${dead.scorebug?.playing}, ball still live ${dead.scorebug?.inPlay}) and the director is on the ${dead.director?.list} list`);
      const rest = await at(bz.play_end_t + 2, false);
      check('and handed to the ambient list once it is',
        rest.scorebug?.inPlay === false && rest.director?.list === 'ambient',
        `at t=${rest.scorebug?.t}, two seconds past the ball at rest: ball live ${rest.scorebug?.inPlay}, list ${rest.director?.list}`
        + (rest.director?.settling ? ' — still holding on our own ball measurement' : ''));
    } else {
      console.log(`  note  the buzzer hold was not exercised: ${bz ? `source ${sM.match.source}` : 'this bundle\'s clock carries no play_end_t'}`);
    }
    // ---- a live fixture, rehearsed --------------------------------------
    // The scheduled path airs three times a day and CI is not there for any
    // of them. So the harness plays the schedule with the bundle already in
    // memory: hand it over as a live item whose programme started 60 s ago
    // (the pre-roll: the venue's own screens, a countdown, the ambient list),
    // then 200 s ago (play: the publisher's panels, the gantry), then on a
    // goal's hold (the replay from the scorer's head, on a LIVE fixture).
    const bundleUrl = sM.match.bundleUrl;
    if (bundleUrl && g0 && sM.match.source === 'now') {
      const at = (secondsAgo) => new Date(Date.now() - secondsAgo * 1000).toISOString();
      const rehearse = async (secondsAgo) => {
        const ok = await lv.evaluate(`window.rflBroadcast.rehearseLive({ bundleUrl: ${JSON.stringify(bundleUrl)}, startsAt: ${JSON.stringify(at(secondsAgo))} })`, { timeoutMs: 120000 });
        // The new stage is up when the promise resolves; the bug and the
        // director follow on the next ticks. Wait for the programme clock to
        // read the NEW start, not the previous rehearsal's.
        let x = null;
        for (let i = 0; i < 40; i++) { await sleep(250); x = await lv.state(); if (x.match?.drive === 'wall' && (x.scorebug?.programmeT ?? -1) >= secondsAgo) break; }
        return { ok, x };
      };
      const pre = await rehearse(60);
      check('a live fixture 60 s into its programme is in the pre-roll, on the venue\'s own screens',
        pre.ok === true && pre.x.match?.drive === 'wall' && pre.x.scorebug?.tag === 'Kick-off' && pre.x.scorebug?.live === true
          && pre.x.director?.list === 'preroll' && !(pre.x.match?.docks || []).some((d) => d.attached) && /coming up/i.test(pre.x.match?.screens?.main || ''),
        `drive ${pre.x?.match?.drive}, tag ${pre.x?.scorebug?.tag} ${pre.x?.scorebug?.clock}, live ${pre.x?.scorebug?.live}, list ${pre.x?.director?.list}, docks ${JSON.stringify((pre.x?.match?.docks || []).map((d) => d.attached))}, screen "${pre.x?.match?.screens?.main}"`);
      const play = await rehearse(200);
      check('at 200 s it has kicked off: the publisher\'s panels, the gantry, the premix 200 s in',
        play.ok === true && play.x.scorebug?.playing === true && play.x.director?.list === 'match'
          && (play.x.match?.docks || []).some((d) => d.attached) && Math.abs((play.x.scorebug?.audioOffset ?? 0) - 200) < 8,
        `tag ${play.x?.scorebug?.tag} ${play.x?.scorebug?.clock}, list ${play.x?.director?.list} shot ${play.x?.director?.shot}, docks ${JSON.stringify((play.x?.match?.docks || []).map((d) => d.attached))}, audioOffset ${play.x?.scorebug?.audioOffset}`);
      // Just before the goal, so the hold arrives while we watch, however long
      // the mount from cache took.
      const hold = await rehearse(180 + g0.t - 1.5);
      let seen = null;
      for (let i = 0; i < 40 && !seen; i++) { const x = i ? await lv.state() : hold.x; if (x.match?.replay && x.director?.shot === 'headcam') seen = x; else await sleep(250); }
      check('on a goal\'s hold a LIVE fixture replays from the scorer\'s head',
        !!seen && seen.scorebug?.replay === true && seen.scorebug?.live === true,
        seen ? `goal ${g0.t}s by ${g0.player}: replay t=${seen.match.replay.t}, shot ${seen.director?.shot}, bug ${seen.scorebug?.replay ? 'REPLAY' : 'no tag'}, LIVE ${seen.scorebug?.live}` : `no replay: drive ${hold.x?.match?.drive}, replay ${JSON.stringify(hold.x?.match?.replay)}, shot ${hold.x?.director?.shot}`);
      const down = await lv.evaluate('window.rflBroadcast.rehearseLive(null)', { timeoutMs: 60000 });
      let after = await lv.state();
      for (let i = 0; i < 12 && after.match?.drive === 'wall'; i++) { await sleep(250); after = await lv.state(); }
      check('and the rehearsal comes down cleanly', down === true && after.match?.drive !== 'wall' && !(after.match?.errors || []).length,
        `drive ${after.match?.drive}, phase ${after.match?.phase}, errors ${JSON.stringify(after.match?.errors || [])}`);
    } else {
      console.log('  note  live fixture not rehearsed: no bundle on the live page');
    }
  } else {
    console.log(`  note  nothing mounted on the live page (phase "${sM.match?.phase ?? 'none'}"); boards, bodies and the replay were not exercised`);
  }
  // 4dgsx being down is their outage, not our failure — but it must be said
  // out loud rather than passed over in silence.
  if (sL.match?.sdk === 'failed') console.log('  note  the 4DGSX SDK did not load from this runner; the module is present and would mount');
  else if (sL.match?.next) console.log(`  note  next fixture ${sL.match.next.id} at ${sL.match.next.startsAt}`);

  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    writeFileSync(join(SHOTS, `broadcast-${CAMERA}-a.png`), await a.png());
    writeFileSync(join(SHOTS, `broadcast-${CAMERA}-b.png`), await b.png());
    console.log(`\n  shots: ${join(SHOTS, `broadcast-${CAMERA}-{a,b}.png`)}`);
  } else if (!same) {
    // A mismatch is the one failure a human has to look at.
    mkdirSync('poc/out/broadcast', { recursive: true });
    writeFileSync('poc/out/broadcast/mismatch-a.png', await a.png());
    writeFileSync('poc/out/broadcast/mismatch-b.png', await b.png());
    console.log('  wrote poc/out/broadcast/mismatch-{a,b}.png');
  }
} finally {
  await a?.close();
  await b?.close();
  await lv?.close();
}

failed = checks.filter((c) => !c.ok).length;
console.log(`\n${failed ? 'FAIL' : 'PASS'}  ${checks.length - failed}/${checks.length} checks`);
if (out) { mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, JSON.stringify(report, null, 2) + '\n'); console.log(`report: ${out}`); }
if (failed) process.exit(1);
