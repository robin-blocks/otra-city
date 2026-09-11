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
  check('every shot in the match cut-list is a static, authored camera',
    moving.length === 0,
    moving.length ? `these move or are not authored: ${[...new Set(moving)].join(', ')}`
                  : `${matchList.segments.length} shots, all from venue.json`);

  lv = await openBroadcast({ liveMode: true });
  const sL = await lv.state();
  report.live = sL;
  // The bug this whole change exists to fix: /broadcast dropped the venue's
  // match module unless a bundle was named in the URL, so the one page RFL
  // capture from could never show a scheduled match — while every visitor
  // standing in the same bowl could.
  check('the live feed keeps the stadium\'s match module',
    sL.match !== null, sL.match ? `phase "${sL.match.phase}", sdk "${sL.match.sdk}"` : 'no match module — the pitch can never fill');
  // RFL play the premix into the bus that also captures this browser.
  check('the live feed is silent', sL.silent === true, sL.silent ? 'listener muted' : 'THE PAGE CAN MAKE SOUND');
  check('the director is running', !!sL.director, sL.director ? `${sL.director.list} list, shot ${sL.director.shot}` : 'no director — a locked-off frame');
  const cutErrors = (sL.errors || []).filter((e) => String(e).includes('cutlist'));
  check('both cut-lists loaded', cutErrors.length === 0, cutErrors.join(' | ') || 'ambient and match');
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
