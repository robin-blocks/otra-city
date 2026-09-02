// The client check: load the real page headless, walk the street, and fail
// loudly on anything a visitor would hit — a console error, a plot that never
// loaded, a shop door that does not open, an avatar that sinks through a floor
// or is stuck on a threshold, a HUD that lost its movement hint on a phone or
// in an embed, a frame that blew the draw-call / triangle budget.
//
// Modelled on Fable Cities' tools/check.mjs and tools/uishot.mjs (MIT — their
// rule: nothing counts until the machine has looked at it), rebuilt over
// lib/headless-chrome.mjs, the driver the poster renderer already uses, so CI
// needs nothing new. One rule of the road, learned by the poster renderer: a
// headless tab gets no reliable requestAnimationFrame, so every frame here is
// stepped by hand through window.__city.step() and never waited for.
//
// Usage:
//   node scripts/check-client.mjs                       # serves public/ itself
//   node scripts/check-client.mjs --url https://otra.city
//   node scripts/check-client.mjs --shots shots/client   # PNG per step + report.json
//   --calls N  --tris N   draw-call / triangle budgets (defaults scale with the lot count)
//   --json <file>         where to write the report (default <shots>/report.json)
//   --quiet               print failures and the summary only
// Exit 1 when any check fails. Warnings (a tap target under 44 px) never fail.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { serve } from '../lib/static-server.mjs';
import { launchChrome } from '../lib/headless-chrome.mjs';

const argv = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--')) return argv[i + 1];
  const inline = argv.find((a) => a.startsWith(`--${name}=`));
  return inline ? inline.slice(name.length + 3) : fallback;
};
const quiet = argv.includes('--quiet');
const shots = arg('shots');
const jsonOut = arg('json', shots ? join(shots, 'report.json') : null);
const root = new URL('..', import.meta.url).pathname;

// Walk-in tolerances. The avatar spawns on the pavement 1.7 m outside the
// front line; every plot must leave >= 1 m of reachable depth behind it, and a
// shop's door (2.5 m clear) is centred on the front — so a WALK straight ahead
// (a half-pushed stick: the rim would run at 5.6 m/s, straight through a shop
// and out of its door's radius) must get a visitor at least this far, and the
// feet must never go under the floor. There is no ceiling on foot height
// beyond sanity: a raised floor reached by steps is a legal build.
const WALK_STICK = 0.55;
const WALK_FRAMES = 90;        // 1.5 s at 3.2 m/s = 4.8 m: through the door, into the lot
const MIN_PROGRESS_M = 1.0;
const FOOT_MIN_Y = -0.05;
const FOOT_MAX_Y = 2.0;
const PHONE = { width: 390, height: 844, deviceScaleFactor: 2 };
const TAP_MIN_PX = 44;

const site = arg('url') ? null : await serve(join(root, 'public'));
const origin = (arg('url') || site.origin).replace(/\/$/, '');

const report = { url: origin, when: new Date().toISOString(), checks: [], warnings: [], console: [], stats: {} };
let failed = 0;
const check = (name, ok, detail = '', extra = {}) => {
  report.checks.push({ name, ok: !!ok, detail, ...extra });
  if (!ok) failed += 1;
  if (!quiet || !ok) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
const warn = (name, detail) => {
  report.warnings.push({ name, detail });
  if (!quiet) console.log(`warn  ${name} — ${detail}`);
};
const skip = (name, detail) => {
  report.checks.push({ name, ok: true, skipped: true, detail });
  console.log(`skip  ${name} — ${detail}`);
};
const fmt = (v) => (typeof v === 'number' ? +v.toFixed(2) : v);

const consoleErrors = [];
let chrome = null;
try {
  chrome = await launchChrome({
    width: 1280,
    height: 720,
    // Nothing off this machine when the page under test is our own copy:
    // index.html loads Google Analytics unconditionally and a run would post a
    // real session to the live property; live-feed panels would poll third
    // parties on every build. Blocking at the resolver leaves the page itself
    // exactly as it ships. Against --url the site is somebody's real deploy,
    // so the world stays reachable.
    args: site ? ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost'] : [],
  });
  chrome.onConsole((type, text) => {
    report.console.push({ type, text: text.slice(0, 300) });
    if (type === 'error') consoleErrors.push(text.slice(0, 300));
  });

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const ev = (expr) => chrome.evaluate(expr, { timeoutMs: 120000 });
  // Presence is pointed at a dead port: a peer wandering into shot would move
  // the draw-call count, and a budget has to mean one thing.
  async function open(query = '') {
    await chrome.goto(`${origin}/index.html?headless=1&q=high&ws=ws://127.0.0.1:1${query ? '&' + query : ''}`);
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      if (await ev('!!(window.__city && window.__city.ready)')) return true;
      await sleep(250);
    }
    return false;
  }
  let shotN = 0;
  async function shot(name) {
    if (!shots) return null;
    mkdirSync(shots, { recursive: true });
    const file = join(shots, `${String(++shotN).padStart(2, '0')}-${name}.png`);
    writeFileSync(file, await chrome.screenshot());
    return file;
  }

  // ---------------------------------------------------------------- 1. boot
  const t0 = Date.now();
  const loaded = await open();
  check('client ready', loaded, `${((Date.now() - t0) / 1000).toFixed(1)} s`);
  if (!loaded) throw new Error('the client never reported ready — see the console lines in the report');
  const boot = await ev('(window.__city.step(60), window.__city.stats())');
  report.stats.boot = boot;
  report.perf = await ev('window.__city.perf.status()');
  const lots = await ev('window.__city.lots.map((l) => ({ slug: l.slug, name: l.name, x: l.x, side: l.side, type: l.type }))');
  check('plots loaded', boot.plots.loaded === boot.plots.total, `${boot.plots.loaded}/${boot.plots.total}`);
  check('no boot errors', consoleErrors.length === 0 && boot.errors === 0,
    consoleErrors.length ? consoleErrors.slice(0, 3).join(' | ') : `0 console errors, 0 uncaught`);
  check('graphics pinned for tooling', boot.quality === 'high' && report.perf.pinned && !report.perf.enabled,
    `${boot.quality}, guard ${report.perf.enabled ? 'ON' : 'off'} · ${report.perf.hardware.renderer.slice(0, 60)}`);
  // The light pool is the scaling story: however long the boulevard grows and
  // however many plots claim it, a fragment sees the pool plus the avatar's
  // fill light — never one light per lamp and per plot. Asserted at spawn,
  // where every venue is still an impostor; a venue that streams in adds its
  // own floodlights on top (see the note in js/lights.js).
  check('light pool bounds the city', boot.lights.point === boot.lights.pool + 1,
    `${boot.lights.point} point lights at spawn = pool ${boot.lights.pool} + 1 fill · ${boot.lights.sources} sources registered (lamps, roads, plots) · ${boot.lights.spot} spot(s) authored`);
  await shot('spawn');

  // ------------------------------------------------------------ 2. every lot
  const walkErrorsBefore = consoleErrors.length;
  for (const lot of lots) {
    const r = await ev(`(() => {
      const c = window.__city;
      c.teleport(${JSON.stringify(lot.slug)});
      c.step(10);
      const start = c.stats().pos;
      c.walk(0, ${WALK_STICK});
      const ys = [];
      let door = c.door(${JSON.stringify(lot.slug)});
      for (let i = 0; i < ${WALK_FRAMES} / 15; i++) {
        ys.push(JSON.parse(c.step(15)).pos[1]);
        const d = c.door(${JSON.stringify(lot.slug)});   // the widest it opened on the way in
        if (d !== null && (door === null || d > door)) door = d;
      }
      c.walk(0, 0);
      c.step(10);
      const end = c.stats().pos;
      return { start, end, ys, door, progress: Math.hypot(end[0] - start[0], end[2] - start[2]) };
    })()`);
    const file = await shot(`lot-${lot.slug}`);
    const yMin = Math.min(...r.ys);
    const yMax = Math.max(...r.ys);
    const grounded = yMin >= FOOT_MIN_Y && yMax <= FOOT_MAX_Y;
    const moved = r.progress >= MIN_PROGRESS_M;
    const doorOk = lot.type !== 'shop' || (r.door !== null && r.door > 0.5);
    check(`walk into ${lot.slug}`, grounded && moved && doorOk,
      `${fmt(r.progress)} m in ${WALK_FRAMES / 60} s · feet y ${fmt(yMin)}..${fmt(yMax)}` +
      (lot.type === 'shop' ? ` · door ${r.door === null ? 'MISSING' : fmt(r.door)}` : ' · free-form'),
      { lot: lot.slug, type: lot.type, ...r, shot: file });
  }
  check('no errors while walking the lots', consoleErrors.length === walkErrorsBefore,
    consoleErrors.slice(walkErrorsBefore, walkErrorsBefore + 3).join(' | ') || 'clean');

  // ------------------------------------------------------- 3. the boulevard
  const track = await ev(`(() => {
    const c = window.__city;
    c.teleport({ x: -38, z: 0, yaw: Math.PI / 2 });
    c.step(10);
    c.walk(0, 1);
    const track = [];
    for (let i = 0; i < 8; i++) track.push(JSON.parse(c.step(240)).pos);
    c.walk(0, 0);
    return track;
  })()`);
  const last = track[track.length - 1];
  const bY = track.map((p) => p[1]);
  check('walk the boulevard end to end', last[0] >= 30 && Math.min(...bY) >= FOOT_MIN_Y && Math.max(...bY) <= FOOT_MAX_Y,
    `x -38 → ${fmt(last[0])} in 32 s · feet y ${fmt(Math.min(...bY))}..${fmt(Math.max(...bY))}`, { track });
  await shot('boulevard-east-end');

  // ---------------------------------------------------------------- 4. perf
  // Frame time means nothing on a software rasteriser; draw calls and
  // triangles are the reliable delta, so those are what the budget is on.
  const samples = [];
  for (const x of [-30, 0, 30]) {
    samples.push(await ev(`(() => { const c = window.__city; c.teleport({ x: ${x}, z: 0, yaw: Math.PI / 2 }); c.step(2); return { x: ${x}, ...c.stats() }; })()`));
  }
  const worst = samples.reduce((a, b) => (b.calls > a.calls ? b : a));
  const worstTris = samples.reduce((a, b) => (b.triangles > a.triangles ? b : a));
  const callsBudget = Number(arg('calls')) || 80 + 30 * lots.length;
  const trisBudget = Number(arg('tris')) || 200000 + 60000 * lots.length;
  report.stats.samples = samples.map((s) => ({ x: s.x, calls: s.calls, triangles: s.triangles, programs: s.programs, lit: s.lights.lit }));
  report.budget = { calls: callsBudget, triangles: trisBudget };
  check('draw calls within budget', worst.calls <= callsBudget, `${worst.calls} at x=${worst.x} (budget ${callsBudget} for ${lots.length} lots)`);
  check('triangles within budget', worstTris.triangles <= trisBudget, `${worstTris.triangles} at x=${worstTris.x} (budget ${trisBudget})`);
  if (!quiet) console.log(`      programs ${worst.programs} · lights lit ${samples.map((s) => s.lights.lit).join('/')} of pool ${worst.lights.pool}`);

  // ------------------------------------------------------------- 5. the HUD
  // The invariants the HUD has broken before: the movement hint must survive
  // every trim, the stick exists only for a coarse pointer, nothing runs
  // under the embed badge, nothing scrolls sideways.
  const desk = await ev('window.__city.audit()');
  report.stats.hudDesktop = desk;
  check('desktop HUD', desk.hud && desk.controls && desk.kbd && !desk.touch && !desk.stick && !desk.overflowX && /walk/i.test(desk.controlsText),
    `${desk.viewport.join('x')} · controls "${desk.controlsText.slice(0, 40)}…" · stick ${desk.stick ? 'SHOWN' : 'hidden'}`);

  // A phone: metrics + touch emulation; the coarse-pointer media query is what
  // actually gates the stick, so it is asserted, not assumed.
  await chrome.send('Emulation.setDeviceMetricsOverride', { ...PHONE, mobile: true, screenWidth: PHONE.width, screenHeight: PHONE.height });
  await chrome.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await chrome.send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }, { name: 'hover', value: 'none' }] }).catch(() => {});
  const phoneReady = await open('phone=1');
  const phone = phoneReady ? await ev('(window.__city.step(30), window.__city.audit())') : null;
  report.stats.hudPhone = phone;
  if (!phone) check('phone HUD', false, 'client never became ready under phone emulation');
  else if (!phone.coarse) skip('phone HUD', 'this Chrome does not emulate a coarse pointer, so the stick could not be exercised');
  else {
    const inView = (r) => r && r.x >= 0 && r.y >= 0 && r.x + r.w <= phone.viewport[0] + 1 && r.y + r.h <= phone.viewport[1] + 1;
    check('phone HUD', phone.hud && phone.controls && phone.touch && !phone.kbd && phone.stick && inView(phone.stickRect) && inView(phone.topbar) && !phone.overflowX && /stick/i.test(phone.controlsText),
      `${phone.viewport.join('x')} coarse · stick ${phone.stick ? 'shown' : 'MISSING'} at ${phone.stickRect ? `${phone.stickRect.x},${phone.stickRect.y}` : '?'} · "${phone.controlsText.slice(0, 44)}…"`);
    for (const [name, r] of [['mute button', phone.mute], ['panel close', phone.close]]) {
      if (r && (r.w < TAP_MIN_PX || r.h < TAP_MIN_PX)) warn(`${name} tap target`, `${r.w}x${r.h} px on a phone (44 px is the usual minimum)`);
    }
  }
  await shot('phone');
  await chrome.send('Emulation.setEmulatedMedia', { features: [] }).catch(() => {});
  await chrome.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await chrome.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });

  // An embed on someone else's page: title + movement hint only, the badge
  // pointing back at the permalink, spawned on that lot's pavement.
  const first = lots[0];
  const embedReady = await open(`embed=1&plot=${encodeURIComponent(first.slug)}`);
  const emb = embedReady ? await ev('(window.__city.step(30), { audit: window.__city.audit(), pos: window.__city.stats().pos })') : null;
  report.stats.hudEmbed = emb;
  if (!emb) check('embed HUD', false, 'client never became ready in embed mode');
  else {
    const a = emb.audit;
    const spawnedOutside = Math.abs(emb.pos[0] - first.x) < 0.6 && Math.abs(emb.pos[2] - first.side * 4.8) < 0.6;
    check('embed HUD', a.embed && a.hud && a.controls && /walk/i.test(a.controlsText) && !a.stats && !a.meta && !a.overflowX &&
      a.outlink && a.outlink.href === `https://otra.city/s/${first.slug}` && a.tagline.startsWith(first.name) && spawnedOutside,
      `plot=${first.slug} · badge → ${a.outlink ? a.outlink.href : 'MISSING'} · stats ${a.stats ? 'SHOWN' : 'hidden'} · spawned ${spawnedOutside ? 'outside the lot' : `at ${emb.pos}`}`);
  }
  await shot('embed');
} catch (e) {
  check('run completed', false, e.message);
} finally {
  if (chrome) await chrome.close().catch(() => {});
  if (site) site.server.close();
}

report.failed = failed;
report.consoleErrors = consoleErrors;
if (jsonOut) {
  mkdirSync(join(jsonOut, '..'), { recursive: true });
  writeFileSync(jsonOut, JSON.stringify(report, null, 2));
}
const n = report.checks.length;
console.log(`\n${failed ? `${failed} of ${n} checks FAILED` : `all ${n} checks passed`}` +
  `${report.warnings.length ? ` · ${report.warnings.length} warning(s)` : ''}` +
  `${jsonOut ? ` · report ${jsonOut}` : ''}`);
process.exit(failed ? 1 : 0);
