// Actual saved M42, two production render routes, one fixed programme clock.
// Browser-only feed/Date.now overrides; never publishes or modifies SDK/RFL data.
// node scripts/stadium-programme-browser.mjs [--gpu] [--origin https://otra.city] [--out qa-out/stadium-screen]
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { serve } from '../lib/static-server.mjs';
import { launchChrome } from '../lib/headless-chrome.mjs';

const args = process.argv.slice(2);
const option = key => {
  const i = args.indexOf(`--${key}`);
  if (i < 0) return null;
  assert.ok(args[i + 1] && !args[i + 1].startsWith('--'), `--${key} needs a value`);
  return args[i + 1];
};
const out = resolve(option('out') || 'qa-out/stadium-screen');
const origin = option('origin');
const gpu = args.includes('--gpu');
const fixture = JSON.parse(readFileSync(new URL('./fixtures/league-first-air-m42.json', import.meta.url)));
const { item } = fixture.programme;
const start = Date.parse(item.startsAt);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const report = {
  origin: origin || 'local', gpu, item,
  scope: 'Actual publisher M42 bundle; browser-local feeds and frozen Date.now only. Programme/score diagnostics, not whole-world pixels.',
  samples: { visitor: [], broadcast: [] }, comparisons: [], errors: [], failures: [], audits: {}, benchmark: null,
};
mkdirSync(out, { recursive: true });
let chrome, server, route = 'setup';
const verify = (label, fn) => {
  try { fn(); } catch (e) { report.failures.push({ label, message: e.message }); }
};
const save = () => writeFileSync(join(out, 'stadium-programme-browser.json'), JSON.stringify(report, null, 2));
const wait = async (expression, predicate, label, timeoutMs = 90000) => {
  const deadline = Date.now() + timeoutMs;
  let value;
  do {
    value = await chrome.evaluate(expression, { timeoutMs: 30000 });
    if (predicate(value)) return value;
    await sleep(100);
  } while (Date.now() < deadline);
  throw Error(`${route}: timeout ${label}: ${JSON.stringify(value)}`);
};
const stateExpression = visitor => visitor ? `(() => {
  const v = __venue.venues.state().find(v => v.id === 'stadium');
  const m = __venue.venues.module('stadium', 'match-4dgsx')?.state;
  const b = __venue.venues.get('stadium')?.broadcast;
  return {now:Date.now(), programme:v?.broadcast?.programme, main:v?.broadcast,
    retained:b === window.__stadiumRetained && b?.surface.texture === window.__stadiumTexture,
    serial:v?.broadcast?.frames, module:m, bug:m?.bug, venue:v, stats:__venue.stats(), errors:__venue.errors};
})()` : `(() => {
  const s = rflBroadcast.state();
  return {now:Date.now(), programme:s.programme, main:s.feed, serial:s.renderSerial,
    module:s.match, bug:s.scorebug, broadcast:s, errors:s.errors};
})()`;
const comparable = s => ({
  phase: s.programme?.phase, priority: s.programme?.priority, shot: s.programme?.camera,
  clockSource: s.programme?.clock, programmeT: s.programme?.programmeT,
  phaseOrigin: s.programme?.phaseOrigin, phaseElapsed: s.programme?.phaseElapsed,
  clock: s.bug?.clock ?? null, matchT: s.bug?.t ?? null,
  score: s.bug ? [s.bug.a, s.bug.b] : null,
  inPlay: s.bug?.inPlay ?? null, over: s.bug?.over ?? null, replay: s.bug?.replay ?? null,
  tableVisible: s.programme?.table?.visible, overlayElapsed: s.programme?.table?.elapsed,
  slotElapsed: s.programme?.table?.slotElapsed, tableExpired: s.programme?.table?.expired,
});

// Fetch remains the real fetch for every bundle byte. The observer sees media
// requests too; instrument creation to catch detached SDK video elements.
const injection = `(() => {
  let fixed = ${start + 60000};
  window.__stadiumTime = seconds => fixed = ${start} + seconds * 1000;
  Date.now = () => fixed;
  const audit = window.__stadiumAudit = {videos:0, requests:[], writes:[]};
  const record = (url, type) => { if (/\\.mp4(?:[?#]|$)/i.test(url)) audit.requests.push({url,type}); };
  new PerformanceObserver(list => { for (const e of list.getEntries()) record(e.name,e.initiatorType); })
    .observe({type:'resource',buffered:true});
  for (const method of ['createElement','createElementNS']) {
    const original = document[method].bind(document);
    document[method] = function(...args) {
      if (String(args[method === 'createElementNS' ? 1 : 0]).toLowerCase() === 'video') audit.videos++;
      return original(...args);
    };
  }
  const original = window.fetch.bind(window);
  window.fetch = function(input, init) {
    const u = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.href);
    const method = String(init?.method || input?.method || 'GET').toUpperCase();
    if (!['GET','HEAD'].includes(method)) {
      audit.writes.push({url:u.href,method});
      return Promise.reject(new Error('QA forbids network mutations: '+method+' '+u.href));
    }
    record(u.href,'fetch');
    let data;
    if (u.origin === location.origin && u.pathname === '/broadcast/now.json') data = {bundle:null,audio:false,loop:false};
    if (u.pathname === '/api/v1/programme/rfl') data = {schema:'4dgsx-programme/1',now:new Date(Date.now()).toISOString(),channel:{id:'rfl',timezone:'Europe/London',slots:['12:00','16:00','20:00']},items:[]};
    if (u.href === 'https://raw.githubusercontent.com/robot-football-league/rfl-league-data/main/site.json') data = ${JSON.stringify(fixture.archive)};
    return data ? Promise.resolve(new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}})) : original(input,init);
  };
})()`;

async function capture(visitor, phase) {
  const expression = visitor ? `(__venue.step(1,0), ${stateExpression(true)})` : stateExpression(false);
  await chrome.evaluate(`__stadiumTime(${phase.seconds}); ${visitor ? '__venue.step(1,0);' : ''}`);
  const expected = start + phase.seconds * 1000;
  let s = await wait(expression, s => s?.now === expected && s.programme &&
    (phase.idle ? s.programme.phase === 'idle' : Math.abs(s.programme.programmeT - phase.seconds) < 0.011), phase.name);
  if (phase.table) s = await wait(expression, s => s.programme?.table?.visible, `${phase.name} table evidence`);
  const before = s.serial;
  const mainBefore = visitor ? s.main.frames : s.main.copies;
  if (visitor) await chrome.evaluate('__venue.step(1,0); __venue.step(1,0);');
  s = await wait(expression, s => s?.serial > before, `${phase.name} rendered frames`, 30000);
  // No wall-time advancement is needed to prove that the retained surface redraws.
  const mainFramesAdvanced = (visitor ? s.main.frames : s.main.copies) - mainBefore;
  const snapshot = { phase: phase.name, seconds: phase.seconds, framesAdvanced: s.serial - before, mainFramesAdvanced, state: s };
  report.samples[route].push(snapshot);
  verify(`${route}/${phase.name}`, () => {
    assert.equal(s.now, expected, 'Date.now must stay exactly frozen');
    assert.equal(s.main?.attached, true, 'main remains attached in every phase');
    assert.equal(s.main?.error, null, 'main rendering error');
    assert.ok(s.serial > before, 'frames advance at a frozen programme time');
    assert.ok(mainFramesAdvanced > 0, 'main screen receives new frames in every phase');
    assert.equal(s.programme.phase, phase.expectedPhase);
    if (phase.shot) assert.equal(s.programme.camera, phase.shot);
    assert.equal(!!s.programme.table.visible, !!phase.table);
    assert.deepEqual(s.errors, []);
    assert.deepEqual(s.module?.errors || [], []);
    if (!phase.idle) {
      const id = visitor ? s.module.match?.id : s.module.id;
      assert.equal(id, item.bundleId);
      assert.equal(s.module.source, 'schedule');
      assert.equal(s.module.bodies?.ok, true, 'real verified publisher bodies');
      assert.equal(s.module.replayCam, true);
    }
    if (phase.name === 'goal-replay') {
      assert.ok(s.module.replay, 'publisher goal hold runs as a replay');
      assert.equal(s.bug.replay, true);
    }
    if (phase.name === 'full-time-dead-ball') {
      assert.equal(s.bug.over, true);
      assert.equal(s.bug.inPlay, true, 'keep panels until the dead ball rests');
    }
    if (phase.table) {
      assert.equal(s.bug.inPlay, false);
      assert.deepEqual([s.bug.a,s.bug.b], [3,6]);
      assert.equal(s.programme.table.basis, 'first-air-hud');
      assert.equal(s.programme.table.generatedAt, fixture.archive.generated_at);
      assert.ok(Math.abs(s.programme.table.elapsed - phase.tableElapsed) < 0.011, 'absolute table elapsed');
      assert.deepEqual(s.programme.table.movements, [{code:'SGU',from:6,to:3,change:3},{code:'SYA',from:4,to:5,change:-1}]);
    }
    const docks = s.module.docks || [];
    assert.ok(!docks.some(d => d.slot === 'main' && d.attached), 'main never becomes a publisher media dock');
    const panels = !phase.idle && !s.bug.preroll && !(s.bug.over && !s.bug.inPlay);
    for (const slot of ['left','right']) assert.equal(docks.some(d => d.slot === slot && d.attached), panels, `${slot} dock policy`);
    if (!panels) {
      assert.equal(s.module.screens?.main, 'parent broadcast');
      assert.match(s.module.screens?.left || '', /^RESULTS:/);
      assert.match(s.module.screens?.right || '', /^(FIXTURES|MATCH DAYS):/);
    }
    if (visitor) {
      assert.equal(s.retained,true,'same internal broadcast and main texture retained across phases');
      assert.equal(s.module.reservedVideo, 'filtered before allocation');
    }
  });
  writeFileSync(join(out, `${route}-${phase.name}.png`), await chrome.screenshot());
  save();
  return snapshot;
}

async function benchmark() {
  // Same visitor, actual mounted match and view. No synthetic render callback,
  // FPS cap, or relaxed threshold: measure complete on/off frames with finish().
  report.benchmark = await chrome.evaluate(`(() => {
    const v = __venue, r = v.renderer, b = v.venues.get('stadium').broadcast;
    const original = b.render, gl = r.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const device = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    r.setAnimationLoop(null);
    const draw = enabled => {
      b.render = enabled ? original : () => false;
      gl.finish(); const t = performance.now();
      const stats = v.step(1,0); gl.finish();
      return {ms:performance.now()-t,calls:stats.calls,tris:stats.tris,feed:b.state()};
    };
    const samples = [];
    try {
      __stadiumTime(300);
      for (let i=0;i<8;i++) { draw(false); draw(true); }
      for (let i=0;i<60;i++) {
        let on,off;
        if (i%2) { on=draw(true); off=draw(false); } else { off=draw(false); on=draw(true); }
        samples.push({on:{ms:on.ms,calls:on.calls,tris:on.tris},off:{ms:off.ms,calls:off.calls,tris:off.tris},
          delta:{ms:on.ms-off.ms,calls:on.calls-off.calls,tris:on.tris-off.tris},
          feed:{calls:on.feed.calls,tris:on.feed.triangles,cpuMs:on.feed.cpuMs}});
      }
      return {device,now:Date.now(),programme:b.state().programme,samples};
    } finally { b.render=original; v.step(1,0); }
  })()`, { timeoutMs: 120000 });
  const b = report.benchmark;
  const summary = xs => {
    const sorted = xs.slice().sort((a,c) => a-c);
    return {min:sorted[0],median:(sorted[29]+sorted[30])/2,p95:sorted[Math.ceil(sorted.length*0.95)-1],max:sorted.at(-1),mean:xs.reduce((a,c)=>a+c,0)/xs.length};
  };
  b.summary = Object.fromEntries(['on','off','delta'].map(k => [k,Object.fromEntries(['ms','calls','tris'].map(metric => [metric,summary(b.samples.map(s => s[k][metric]))]))]));
  b.scope = '60 alternating paired complete visitor frames, same M42/time/camera; __venue.step(1,0), gl.finish; no extra crowd. Not a 32-spectator acceptance benchmark.';
  b.referenceBudgets = {medianMs:20,calls:480,tris:300000,source:'docs/stadium/PROJECT.md (50 FPS); scripts/venue-check.mjs existing match ceiling'};
  b.withinReferenceBudgets = {medianMs:b.summary.on.ms.median<=20,calls:b.summary.on.calls.max<=480,tris:b.summary.on.tris.max<=300000};
  if (Object.values(b.withinReferenceBudgets).some(ok=>!ok)) console.warn('GPU reference budget exceedance (not relaxed):', JSON.stringify({totals:b.summary.on,within:b.withinReferenceBudgets}));
  // Preserve the actual totals even when they exceed the existing scene gate;
  // this scoped benchmark is evidence, not permission to double that budget.
  verify('GPU paired benchmark', () => {
    assert.doesNotMatch(b.device, /swiftshader|llvmpipe|software/i, '--gpu must use a real GPU');
    assert.equal(b.samples.length,60);
    assert.equal(b.now,start+300000);
    assert.ok(b.samples.every(s => s.delta.calls > 0 && s.delta.tris > 0), 'feed adds real GPU draws');
  });
  save();
}

try {
  const hosted = origin ? {origin} : await serve(resolve('public'));
  server = hosted.server;
  // A single browser, one tab; navigation tears down visitor before /broadcast.
  chrome = await launchChrome({width:gpu ? 1920 : 1280,height:gpu ? 1080 : 720,gpu,sandbox:!!origin});
  chrome.onConsole((type,text) => { if (type === 'error') report.errors.push({route,text}); });
  await chrome.send('Page.addScriptToEvaluateOnNewDocument',{source:injection});
  let phases;
  for (const visitor of [true,false]) {
    route = visitor ? 'visitor' : 'broadcast';
    await chrome.goto(`${hosted.origin}${visitor ? '/venue.html?venue=stadium&tier=2&cam=screen_main' : origin ? '/broadcast' : '/broadcast.html'}`);
    await wait(visitor ? '!!window.__venue' : '!!window.rflBroadcast', Boolean, 'page API');
    if (visitor) {
      await chrome.evaluate('__venue.whenLoaded()', {timeoutMs:120000});
      await wait(`!!__venue.venues.module('stadium','match-4dgsx')`, Boolean, 'match module');
      // Controlled visitor frames retain normal update/render ordering. Automatic
      // broadcast stays automatic; only Date.now, never its director, is set.
      await chrome.evaluate('__venue.renderer.setAnimationLoop(null);');
    } else {
      // /broadcast's pre-render networkQuiet uses Date.now for its idle
      // deadline. Explicitly tick ONLY this empty-pitch boot; once ready, both
      // clients rehearse at the identical frozen timestamp. No performance.now
      // contribution ever enters the programme clock or the sampled phases.
      await chrome.evaluate(`window.__stadiumReady = false;
        rflBroadcast.ready.then(() => { __stadiumReady = true; }, e => { __stadiumReady = String(e); }); true;`);
      let ready = false;
      const bootDeadline = Date.now() + 90000;
      for (let i = 0; Date.now() < bootDeadline && !ready; i++) {
        await sleep(250);
        ready = await chrome.evaluate(`__stadiumTime(${60 + i}); __stadiumReady`);
        if (typeof ready === 'string') throw Error(ready);
      }
      assert.equal(ready,true,'broadcast boot readiness within 90 seconds');
      await chrome.evaluate('__stadiumTime(60)');
      report.broadcastBootClock = 'Explicit integer-second ticks for empty-pitch networkQuiet only; frozen to 60 before M42 rehearsal.';
    }
    const rehearsal = visitor ? `__venue.venues.module('stadium','match-4dgsx').rehearseLive` : 'rflBroadcast.rehearseLive';
    assert.equal(await chrome.evaluate(`${rehearsal}(${JSON.stringify(item)})`,{timeoutMs:300000}),true, `${route}: asynchronous rehearsal mounted M42`);
    if (visitor) {
      await chrome.evaluate('__venue.step(1,0)');
      await wait(`!!__venue.venues.get('stadium').broadcast?.state().ready`,Boolean,'internal broadcast ready');
      await chrome.evaluate(`window.__stadiumRetained = __venue.venues.get('stadium').broadcast;
        window.__stadiumTexture = __stadiumRetained.surface.texture; true;`);
      // Read the actual mounted bundle's immutable map, not an invented match.
      const m = await chrome.evaluate(`__venue.venues.module('stadium','match-4dgsx').state`);
      const map = m.programme.map;
      const at = t => {
        if (t<=map[0][0]) return map[0][1];
        for(let i=1;i<map.length;i++) if(t<=map[i][0]) {
          const [a,p]=map[i-1], [z,q]=map[i];
          return z===a ? q : p+(t-a)*(q-p)/(z-a);
        }
        throw Error('M42 time outside programme map');
      };
      const goal = m.goals.find(g => map.some((r,i) => i && r[0]===map[i-1][0] && Math.abs(r[0]-g.t)<0.05));
      assert.ok(goal,'actual M42 goal hold');
      const hold = map.findIndex((r,i) => i && r[0]===map[i-1][0] && Math.abs(r[0]-goal.t)<0.05);
      const full = m.clockPlan.buzzers.find(b=>b.kind==='full');
      const rest = at(full.play_end_t);
      phases = [
        {name:'build-up',seconds:60,expectedPhase:'preroll'},
        {name:'play',seconds:300,expectedPhase:'play',shot:'gantry'},
        {name:'goal-replay',seconds:(map[hold-1][1]+map[hold][1])/2,expectedPhase:'play',shot:'headcam'},
        {name:'full-time-dead-ball',seconds:at(full.t)+0.2,expectedPhase:'play',shot:'gantry'},
        ...[['settled-table',3],['table-late-45',45],['table-before-54',53.98]].map(([name,elapsed])=>({name,seconds:rest+0.7+elapsed,expectedPhase:'postmatch',shot:'heli',table:true,tableElapsed:elapsed})),
        {name:'table-complete-54',seconds:rest+0.7+54.02,expectedPhase:'postmatch',shot:'screen_main'},
        {name:'ambient',seconds:rest+60,expectedPhase:'postmatch'},
      ];
      report.phases = phases;
    }
    for (const phase of phases) await capture(visitor,phase);
    if (visitor && gpu) await benchmark();
    assert.equal(await chrome.evaluate(`${rehearsal}(null)`,{timeoutMs:30000}),true,`${route}: unmount`);
    // This sample checks a clear idle shot after unmount, not the newly valid
    // between-match standings slot. The dedicated league-idle browser gate
    // checks the occupied slot and late joins on these same two routes.
    const quietIdleMs = Math.ceil((start + phases.at(-1).seconds * 1000) / 281700) * 281700 + 100000;
    await capture(visitor,{name:'unmount-idle',seconds:(quietIdleMs-start)/1000,expectedPhase:'idle',idle:true});
    const audit = await chrome.evaluate(`({...__stadiumAudit,domVideos:document.querySelectorAll('video').length})`);
    report.audits[route] = audit;
    verify(`${route} no main video or writes`,()=>{
      assert.equal(audit.videos,0,'no detached or attached video allocated');
      assert.equal(audit.domVideos,0);
      assert.deepEqual(audit.requests,[],'no .mp4 requests');
      assert.deepEqual(audit.writes,[],'no network mutations');
    });
  }
  for (const v of report.samples.visitor) {
    const b = report.samples.broadcast.find(s=>s.phase===v.phase);
    const pair = {phase:v.phase,visitor:comparable(v.state),broadcast:comparable(b.state)};
    report.comparisons.push(pair);
    verify(`same programme/${v.phase}`,()=>assert.deepEqual(pair.visitor,pair.broadcast));
  }
  verify('browser console',()=>assert.deepEqual(report.errors,[]));
  assert.deepEqual(report.failures,[],`${report.failures.length} stadium programme checks failed; see ${out}`);
  report.passed = true;
  console.log(`PASS M42 stadium/broadcast: ${report.comparisons.length} frozen-clock phases, retained main, live frames, dock policy, no videos/MP4/writes${gpu ? '; 60 GPU frame pairs recorded (see unchanged reference budgets)' : '; GPU benchmark not requested'}. ${out}`);
} catch (e) {
  report.passed = false;
  report.fatal = {route,message:e.message,stack:e.stack};
  process.exitCode = 1;
  console.error(e.message);
} finally {
  try { save(); } finally {
    try { if (chrome) await chrome.close(); }
    finally { if (server) await new Promise(r=>server.close(r)); }
  }
}
