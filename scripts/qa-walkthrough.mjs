#!/usr/bin/env node
// Walks the REAL city client in headless Chrome and fails loudly when it
// stops behaving. Not preview.html: this is public/index.html, the page a
// visitor gets, driven through window.__city (see the comment beside it).
//
// Why this exists: `validate plots` is path-filtered to public/plots/**, so
// until now a change to the client, to lib/ or to scripts/ reached main with
// nothing but the docs check green. window.__step has been sitting in the page
// since launch with nothing driving it.
//
// Two rules the checks live by:
//   * every expectation comes from /plots/index.json, never from a constant
//     here — the city gains lots without anyone editing this file
//   * assertions are numeric or structural, never pixels. Software WebGL,
//     bloom and a running clock make image diffing permanently flaky;
//     screenshots here are evidence for a human, not a test.
//
// Usage: node scripts/qa-walkthrough.mjs [--out=qa-out] [--keep]
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { serve } from '../lib/static-server.mjs';
import { launchChrome } from '../lib/headless-chrome.mjs';
import { BUDGETS, limit } from '../lib/qa-budgets.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => (argv.find((a) => a.startsWith(`--${k}=`)) || `--${k}=${d}`).slice(k.length + 3);
const OUT = arg('out', 'qa-out');
const ROOT = join(new URL('..', import.meta.url).pathname, 'public');
// Two knobs, both so a measurement means one thing.
//   * presence points at a dead port: a peer wandering into shot changes the
//     draw-call count.
//   * ?headless=1 pins the graphics preset to high and freezes the frame-rate
//     guard. Without it the guard reads a software renderer's fps, steps the
//     preset down mid-run, and the budget becomes a fact about the machine
//     rather than about the city.
const SOLO = 'ws=ws://127.0.0.1:1&headless=1';

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const results = [];
const consoleErrors = [];
let shots = 0;

const { server, origin } = await serve(ROOT);
const page = await launchChrome({
  width: 1280,
  height: 720,
  // Nothing off this machine. Google Analytics is loaded unconditionally by
  // index.html and armLink() fires plot_board_click, so an unguarded run would
  // post fake sessions to the live property; plot live-feed panels would poll
  // third-party sites on every build too. Blocking at the resolver means the
  // page under test is the page that ships, not a doctored copy.
  args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost'],
});
page.onConsole((type, text) => {
  if (type === 'error') consoleErrors.push(text.slice(0, 200));
});

const evx = (expr, ms = 60000) => page.evaluate(expr, { timeoutMs: ms });
const call = (fn, a) => evx(`(${String(fn)})(${JSON.stringify(a === undefined ? null : a)})`);

async function shot(label) {
  shots += 1;
  const file = join(OUT, `${String(shots).padStart(2, '0')}-${label.replace(/\W+/g, '-').toLowerCase().slice(0, 48)}.png`);
  try {
    writeFileSync(file, await page.screenshot({ timeoutMs: 120000 }));
    return file;
  } catch (e) {
    // Evidence, not a test: a busy machine that cannot composite a frame in
    // two minutes must not turn a passing walk into a red build.
    console.log(`  (screenshot failed: ${String(e.message || e).slice(0, 80)})`);
    return null;
  }
}

async function check(label, fn, { picture = false } = {}) {
  let ok = false;
  let info = {};
  try {
    const r = await fn();
    ok = r && typeof r === 'object' ? r.ok === true : r === true;
    if (r && typeof r === 'object') info = r;
  } catch (e) {
    info = { error: String(e.message || e).slice(0, 300) };
  }
  const picture_ = picture || !ok ? await shot(label) : null;
  results.push({ label, ok, ...info, ...(picture_ ? { shot: picture_ } : {}) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  ${JSON.stringify(info).slice(0, 240)}`}`);
  return info;
}

// --------------------------------------------------------------- page helpers
const open = async (query = '') => {
  await page.goto(`${origin}/?${SOLO}${query ? `&${query}` : ''}`);
  const load = await evx(`(async () => {
    const t0 = Date.now();
    while (!document.getElementById('stats')?.dataset.load && Date.now() - t0 < 90000) {
      await new Promise((r) => setTimeout(r, 150));
    }
    return document.getElementById('stats').dataset.load || null;
  })()`, 120000);
  // A dispatched PointerEvent carries no real pointer, so OrbitControls'
  // setPointerCapture throws on every synthetic click. Stub it, or the console
  // fills with NotFoundError and buries the errors worth reading.
  await call(() => {
    const el = window.__city.renderer.domElement;
    el.setPointerCapture = () => {};
    el.releasePointerCapture = () => {};
    // Damping makes the camera's resting place depend on where it came from,
    // and the frustum decides what is culled — which is a draw-call count that
    // drifts with test order. The poster renderer turns it off for the same
    // reason: a measurement must not depend on the journey to it.
    window.__city.controls.enableDamping = false;
  });
  return load;
};

const teleport = (x, z, yaw, dist = 5, height = 2.2) => call((a) => {
  const p = window.__player, c = window.__city;
  p.pos.set(a.x, p.pos.y, a.z);
  p.vel.set(0, 0, 0);
  p.setStick(0, 0);
  if (a.yaw !== null) { p.yaw = a.yaw; p.avatar.group.rotation.y = a.yaw; }
  const ty = p.pos.y + 1.15;
  p.followPos.set(p.pos.x, ty, p.pos.z);
  c.controls.target.set(p.pos.x, ty, p.pos.z);
  c.camera.position.set(p.pos.x - Math.sin(p.yaw) * a.dist, ty + a.height, p.pos.z - Math.cos(p.yaw) * a.dist);
  c.controls.update();
  c.step(2, 1 / 60);
  return { x: +p.pos.x.toFixed(2), z: +p.pos.z.toFixed(2) };
}, { x, z, yaw, dist, height });

const walk = (seconds, sx = 0, sy = 1) => call((a) => {
  const p = window.__player;
  const before = { x: p.pos.x, z: p.pos.z };
  let minZ = p.pos.z, maxZ = p.pos.z, bad = 0;
  p.setStick(a.sx, a.sy);
  const frames = Math.round(a.seconds * 60);
  for (let i = 0; i < frames; i += 30) {
    window.__city.step(Math.min(30, frames - i), 1 / 60);
    minZ = Math.min(minZ, p.pos.z); maxZ = Math.max(maxZ, p.pos.z);
    if (!Number.isFinite(p.pos.x) || !Number.isFinite(p.pos.y) || !Number.isFinite(p.pos.z)) bad += 1;
  }
  p.setStick(0, 0);
  return {
    from: [+before.x.toFixed(2), +before.z.toFixed(2)],
    to: [+p.pos.x.toFixed(2), +p.pos.z.toFixed(2)],
    dx: +(p.pos.x - before.x).toFixed(2),
    zRange: [+minZ.toFixed(2), +maxZ.toFixed(2)],
    nonFinite: bad,
  };
}, { seconds, sx, sy });

const measure = () => call(() => {
  const c = window.__city;
  c.pause();                      // the animation loop is a second clock
  c.renderer.info.reset();        // autoReset is off, so counts accumulate
  c.step(1, 1 / 60);
  const i = c.renderer.info.render;
  let lights = 0;
  const kinds = {};
  c.scene.traverse((o) => {
    if (!o.isLight || !o.visible) return;
    lights += 1;
    kinds[o.type] = (kinds[o.type] || 0) + 1;
  });
  return { calls: i.calls, tris: i.triangles, lights, kinds, peers: window.__presence.count };
});

// ------------------------------------------------------------------- the walk
const load = await open();
const man = await evx('(async () => (await (await fetch("/plots/index.json")).json()))()');
const lots = man.lots;
const vacant = man.vacant || [];
const shops = lots.filter((l) => l.type === 'shop');
const east = lots.reduce((a, b) => (b.x > a.x ? b : a));
console.log(`\ncity: ${lots.length} lots (${shops.length} shops), ${vacant.length} vacant, outermost lot x=${east.x}\n`);

await check(`every plot loads (${lots.length} in the manifest)`, () =>
  ({ ok: new RegExp(`^${lots.length}/${lots.length} plots`).test(load || ''), load }), { picture: true });

await check('graphics pinned, guard frozen — so the numbers mean something', async () => {
  const p = await call(() => window.__city.stats());
  const g = await call(() => ({ quality: window.__city.perf.quality, pinned: window.__city.perf.pinned, enabled: window.__city.perf.enabled }));
  return { ok: p.quality === 'high' && g.enabled === false, quality: p.quality, guardEnabled: g.enabled, pixelRatio: p.pixelRatio };
});

await check('analytics never reached the network', async () =>
  ({ ok: (await evx('typeof window.google_tag_manager')) === 'undefined', gtm: await evx('typeof window.google_tag_manager') }));

await check('spawn is on the boulevard, on the ground', async () => {
  const s = await call(() => ({ pos: window.__player.pos.toArray().map((v) => +v.toFixed(2)) }));
  return { ok: Math.abs(s.pos[0] + 20) < 1 && Math.abs(s.pos[2]) < 1 && Math.abs(s.pos[1]) < 0.5, ...s };
});

await check('an info board for every lot and every vacant plot', async () => {
  const n = await call(() => window.__city.street.interactables.length);
  return { ok: n === lots.length + vacant.length, boards: n, expected: lots.length + vacant.length };
});

await check(`a door controller for every shop (${shops.length})`, async () => {
  const n = await call(() => window.__city.doors.count);
  return { ok: n >= shops.length, doors: n, shops: shops.length };
});

await check('the whole boulevard is walkable end to end', async () => {
  await teleport(-east.x, 0, Math.PI / 2);
  const r = await walk(20);
  return { ok: r.to[0] >= east.x && r.nonFinite === 0 && Math.abs(r.zRange[0]) < 8 && Math.abs(r.zRange[1]) < 8, ...r, outermostLot: east.x };
}, { picture: true });

await check('the stick dead zone holds, and full deflection walks', async () => {
  await teleport(0, 0, Math.PI / 2);
  const still = await walk(2, 0.05, 0);
  await teleport(0, 0, Math.PI / 2);
  const moved = await walk(2, 0, 1);
  return { ok: Math.hypot(still.dx, 0) < 0.05 && Math.abs(moved.dx) > 2, deadZone: still.dx, full: moved.dx };
});

await check('every lot is standing ground, not clamped away', async () => {
  const bad = [];
  for (const l of lots) {
    const r = await teleport(l.x, l.side * 5.5, l.side > 0 ? 0 : Math.PI);
    if (Math.abs(r.x - l.x) > 0.5) bad.push({ slug: l.slug, want: l.x, got: r.x });
  }
  return { ok: bad.length === 0, unreachable: bad };
});

const door = shops[0];
await check(`doors open on approach (${door.slug})`, async () => {
  await teleport(door.x, door.side * 5.0, door.side > 0 ? 0 : Math.PI);
  const open = await call(() => { window.__city.step(90, 1 / 60); return Math.max(...window.__city.doors.state().map((d) => d.open)); });
  return { ok: open > 0.95, open01: +open.toFixed(2) };
}, { picture: true });

await check('and close again behind you', async () => {
  await teleport(door.x, door.side * 2.0, door.side > 0 ? 0 : Math.PI);
  const shut = await call(() => { window.__city.step(120, 1 / 60); return Math.max(...window.__city.doors.state().map((d) => d.open)); });
  return { ok: shut < 0.05, open01: +shut.toFixed(2) };
});

const board = lots[Math.floor(lots.length / 2)];
await check(`clicking a board offers the link without leaving (${board.slug})`, async () => {
  await teleport(board.x + 3.4, board.side * 3.0, board.side > 0 ? 0 : Math.PI, 5, 1.6);
  return call((a) => {
    window.__opened = null;
    window.open = (...args) => { window.__opened = args; return null; };
    const c = window.__city;
    const b = c.interactables.find((o) => o.userData.link && o.userData.link.name === a.name);
    if (!b) return { ok: false, reason: 'no board for that lot' };
    const v = b.getWorldPosition(new b.position.constructor());
    v.project(c.camera);
    const x = ((v.x + 1) / 2) * window.innerWidth, y = ((1 - v.y) / 2) * window.innerHeight;
    c.renderer.domElement.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, bubbles: true }));
    const armed = window.__armed();
    return {
      ok: !!armed && armed.name === a.name && window.__opened === null,
      armed: armed && armed.name,
      navigatedEarly: window.__opened !== null,
      at: [Math.round(x), Math.round(y)],
    };
  }, { name: board.name });
}, { picture: true });

await check('a click on empty sky and Escape both put the offer away', async () => call((a) => {
  const c = window.__city;
  const b = c.interactables.find((o) => o.userData.link && o.userData.link.name === a.name);
  const aim = () => {
    const v = b.getWorldPosition(new b.position.constructor());
    v.project(c.camera);
    return [((v.x + 1) / 2) * window.innerWidth, ((1 - v.y) / 2) * window.innerHeight];
  };
  const fire = (x, y) => c.renderer.domElement.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, bubbles: true }));
  fire(...aim());
  const armedOnce = !!window.__armed();
  fire(window.innerWidth / 2, 4);                       // a patch of empty sky
  const afterSky = window.__armed();
  fire(...aim());
  const armedTwice = !!window.__armed();
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  return {
    ok: armedOnce && afterSky === null && armedTwice && window.__armed() === null,
    armedOnce, afterSky, armedTwice, afterEsc: window.__armed(),
  };
}, { name: board.name }));

await check('and the pill is the only thing that leaves', async () => call((a) => {
  const c = window.__city;
  const b = c.interactables.find((o) => o.userData.link && o.userData.link.name === a.name);
  const v = b.getWorldPosition(new b.position.constructor());
  v.project(c.camera);
  c.renderer.domElement.dispatchEvent(new PointerEvent('pointerdown', {
    clientX: ((v.x + 1) / 2) * window.innerWidth, clientY: ((1 - v.y) / 2) * window.innerHeight, bubbles: true,
  }));
  window.__opened = null;
  document.getElementById('toast').click();
  return {
    ok: Array.isArray(window.__opened) && window.__opened[0] === a.url && window.__armed() === null,
    opened: window.__opened && window.__opened[0],
    expected: a.url,
  };
}, { url: board.url, name: board.name }));

// --- the budget, at two fixed vantage points -------------------------------
for (const [name, pose] of Object.entries(BUDGETS.poses)) {
  await check(`draw budget: ${name}`, async () => {
    await teleport(pose.x, pose.z, pose.yaw, pose.dist, pose.height);
    await call(() => window.__city.step(30, 1 / 60));
    const m = await measure();
    await call(() => window.__city.resume());
    const cap = { calls: limit(pose.calls, lots.length), tris: limit(pose.tris, lots.length) };
    const lightCap = limit(BUDGETS.lights, lots.length);
    return {
      ok: m.peers === 0 && m.calls <= cap.calls && m.tris <= cap.tris
        && m.lights <= lightCap && m.lights >= BUDGETS.lights.floor,
      ...m,
      limits: { ...cap, lights: `${BUDGETS.lights.floor}..${lightCap}` },
      lots: lots.length,
    };
  }, { picture: true });
}

// --- the light pool --------------------------------------------------------
// The pool exists so the number of visible lights never changes, because that
// number is a shader define: a light switched off mid-street recompiles every
// material under the visitor's feet. Both halves of that promise are testable
// without a GPU, so they are tested.
await check('walking the street never changes the light count or recompiles', async () => {
  await teleport(-east.x, 0, Math.PI / 2);
  await walk(20);                                  // warm pass: everything compiles once
  await teleport(east.x, 0, -Math.PI / 2);
  return call(() => {
    const c = window.__city, p = window.__player;
    c.pause();
    c.step(30, 1 / 60);
    const programs = new Set([c.renderer.info.programs.length]);
    const totals = new Set();
    const points = new Set();
    p.setStick(0, 1);
    for (let i = 0; i < 80; i++) {
      c.step(15, 1 / 60);
      let all = 0, pt = 0;
      c.scene.traverse((o) => { if (o.isLight && o.visible) { all += 1; if (o.isPointLight) pt += 1; } });
      totals.add(all); points.add(pt);
      programs.add(c.renderer.info.programs.length);
    }
    p.setStick(0, 0);
    c.resume();
    return {
      // The scene total also carries the avatar's fill and anything a venue is
      // streaming; what the pool promises is that the number never MOVES.
      ok: totals.size === 1 && points.size === 1 && programs.size === 1,
      lightCounts: [...totals], pointLights: [...points], pool: c.lights.stats().pool, programs: [...programs],
    };
  });
});

await check('standing on a lot, its own fixtures hold their slots', async () => {
  const lot = lots.find((l) => l.type === 'shop') || lots[0];
  await teleport(lot.x, lot.side * 11.5, lot.side > 0 ? 0 : Math.PI);
  return call(() => {
    const c = window.__city;
    c.pause();
    c.step(90, 1 / 60);
    const st = c.lights.stats();
    c.resume();
    return { ok: st.onLot !== null && st.reserved > 0, ...st };
  });
}, { picture: true });

// --- the HUD, on the three surfaces it ships to -----------------------------
// Invariants the HUD has broken before: the movement hint must survive every
// trim (an embed with no hint is a city nobody can walk), the stick exists
// only for a coarse pointer, and nothing may scroll sideways.
await open();
await check('desktop HUD: keys shown, no stick, nothing sideways', async () => {
  const a = await call(() => window.__city.audit());
  return {
    ok: a.hud && a.controls && a.kbd && !a.touch && !a.stick && !a.overflowX && /walk/i.test(a.controlsText),
    viewport: a.viewport, controls: a.controlsText.slice(0, 60), stick: a.stick, overflowX: a.overflowX,
  };
});

await check('phone HUD: the stick is there, in view, and the hint says so', async () => {
  // Metrics AND touch AND the coarse-pointer media query — the last is what
  // actually gates the stick, so it is asserted rather than assumed.
  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, screenWidth: 390, screenHeight: 844 });
  await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }, { name: 'hover', value: 'none' }] }).catch(() => {});
  await open('phone=1');
  const a = await call(() => { window.__city.step(30, 1 / 60); return window.__city.audit(); });
  const inView = (r) => !!r && r.x >= 0 && r.y >= 0 && r.x + r.w <= a.viewport[0] + 1 && r.y + r.h <= a.viewport[1] + 1;
  return {
    ok: a.coarse && a.hud && a.controls && a.touch && !a.kbd && a.stick
      && inView(a.stickRect) && inView(a.topbar) && !a.overflowX && /stick/i.test(a.controlsText),
    coarse: a.coarse, viewport: a.viewport, stick: a.stickRect, topbar: a.topbar,
    controls: a.controlsText.slice(0, 60), overflowX: a.overflowX,
  };
}, { picture: true });

// back to the desk before anything else measures
await page.send('Emulation.setEmulatedMedia', { features: [] }).catch(() => {});
await page.send('Emulation.setTouchEmulationEnabled', { enabled: false });
await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });

// --- arrival modes ---------------------------------------------------------
const perma = lots[0];
await check(`a permalink lands you outside its plot (?plot=${perma.slug})`, async () => {
  await open(`plot=${perma.slug}`);
  const s = await call((a) => ({
    pos: window.__player.pos.toArray().map((v) => +v.toFixed(2)),
    tagline: document.getElementById('tagline').textContent,
    outlink: document.getElementById('outlink').getAttribute('href'),
    want: [a.x, a.side * 4.8],
  }), perma);
  return {
    ok: Math.abs(s.pos[0] - perma.x) < 0.5 && Math.abs(s.pos[2] - perma.side * 4.8) < 0.5
      && s.tagline.includes(perma.name) && s.outlink === `https://otra.city/s/${perma.slug}`,
    ...s,
  };
}, { picture: true });

await check('embed keeps the title and the movement hint, drops the housekeeping', async () => {
  await open(`plot=${perma.slug}&embed=1`);
  const r = await call(() => { window.__city.step(30, 1 / 60); return { a: window.__city.audit(), pos: window.__player.pos.toArray() }; });
  const a = r.a;
  const outside = Math.abs(r.pos[0] - perma.x) < 0.6 && Math.abs(r.pos[2] - perma.side * 4.8) < 0.6;
  return {
    ok: a.embed && a.hud && a.controls && /walk/i.test(a.controlsText) && !a.stats && !a.meta && !a.overflowX
      && !!a.outlink && a.outlink.href === `https://otra.city/s/${perma.slug}` && a.tagline.startsWith(perma.name) && outside,
    badge: a.outlink && a.outlink.href, tagline: a.tagline, stats: a.stats, meta: a.meta,
    overflowX: a.overflowX, spawnedOutsideTheLot: outside,
  };
}, { picture: true });

// --- media (also proves the runner's Chrome decodes H.264) -----------------
const withScreen = lots.find((l) => (l.media?.screens || []).length > 0);
if (withScreen) {
  await check(`a video screen decodes and runs (${withScreen.slug})`, async () => {
    await open();
    await teleport(withScreen.x, withScreen.side * 6.0, withScreen.side > 0 ? 0 : Math.PI);
    return call(async () => {
      // Decoding is real work on a software stack, so this waits on the clock
      // rather than on a frame count: stepping is what asks media.js to start
      // the nearest screens, but only wall time makes the video advance.
      const t0 = window.__media.state.screens.map((s) => s.t);
      const advanced = (st) => st.some((s, i) => s.playing && s.t > t0[i] + 0.01);
      const deadline = Date.now() + 25000;
      let st = window.__media.state.screens;
      while (Date.now() < deadline && !advanced(st)) {
        window.__city.step(10, 1 / 60);
        await new Promise((r) => setTimeout(r, 100));
        st = window.__media.state.screens;
      }
      return { ok: advanced(st), waitedMs: 25000 - (deadline - Date.now()), screens: st };
    });
  }, { picture: true });
} else {
  console.log('SKIP  no plot on the street declares a screen');
}

await check('the console stayed quiet for the whole walk', () =>
  ({ ok: consoleErrors.length === 0, errors: consoleErrors.slice(0, 8) }));

// ---------------------------------------------------------------------------
const failed = results.filter((r) => !r.ok);
writeFileSync(join(OUT, 'report.json'), JSON.stringify({
  city: { lots: lots.length, vacant: vacant.length, shops: shops.length, segment: man.segment },
  passed: results.length - failed.length, failed: failed.length, results, consoleErrors,
}, null, 1));

await page.close();
server.close();

console.log(`\n${results.length - failed.length}/${results.length} checks passed -> ${OUT}/report.json`);
if (failed.length) {
  console.log(`\nfailed:\n${failed.map((f) => `  - ${f.label}`).join('\n')}`);
  process.exit(1);
}
