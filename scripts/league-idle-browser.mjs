// Actual automatic /venue and /broadcast, archived published standings only.
// Browser-local Date.now/feed overrides: no rehearsal, bundle, invented result,
// recording, remote write, or implementation mutation. Node 22:
// PATH=/opt/homebrew/bin:$PATH node scripts/league-idle-browser.mjs [--gpu]
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { serve } from '../lib/static-server.mjs';
import { launchChrome } from '../lib/headless-chrome.mjs';

const args = process.argv.slice(2);
assert.ok(args.every(a => a === '--gpu'), 'Only --gpu is supported; runs use an isolated local server.');
const out = resolve('qa-out/league-idle/integration');
const fixture = JSON.parse(readFileSync(new URL('./fixtures/league-first-air-m42.json', import.meta.url)));
const archive = fixture.archive;
const PERIOD = 281.7, PERIOD_MS = 281700;
const generated = Date.parse(archive.generated_at);
const base = Math.ceil((generated + 1) / PERIOD_MS) * PERIOD_MS;
assert.ok(base > generated && base + 2 * PERIOD_MS < generated + 6 * 3600000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const report = { scope: 'Actual automatic pages and createBroadcastProgramme; original archived published results, no mounted match. Browser-only fixed Date.now and empty programme/now/archive feeds; presence transport suppressed to guarantee no writes. No performance clock drives programme time.',
  gpu: args.includes('--gpu'), generatedAt: archive.generated_at, base, baseISO: new Date(base).toISOString(), period: PERIOD,
  samples: { visitor: [], broadcast: [] }, comparisons: [], audits: {}, errors: [], failures: [], core: null, clean: null };
mkdirSync(out, { recursive: true });
let chrome, server, route = 'setup', injectionId;
const save = () => writeFileSync(join(out, 'league-idle-browser.json'), JSON.stringify(report, null, 2));
const check = (label, fn) => { try { fn(); } catch (e) { report.failures.push({ label, message: e.message }); } };
const near = (a, b, label) => assert.ok(Number.isFinite(a) && Math.abs(a - b) < 0.0001, `${label}: ${a} vs ${b}`);
async function wait(expression, predicate, label, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  let value;
  do {
    value = await chrome.evaluate(expression, { timeoutMs: 30000 });
    if (predicate(value)) return value;
    await sleep(120);
  } while (Date.now() < deadline);
  throw Error(`${route}: timeout ${label}: ${JSON.stringify(value)}`);
}
function injection(seconds) {
  return `(() => {
    let fixed = ${base} + ${seconds} * 1000;
    window.__idleTime = seconds => fixed = ${base} + Math.round(seconds * 1000);
    Date.now = () => fixed;
    const audit = window.__idleAudit = {videos:0, mp4:[], bundles:[], writes:[], feeds:[], socketsSuppressed:[]};
    const record = (url,type) => {
      if (/\\.mp4(?:[?#]|$)/i.test(url)) audit.mp4.push({url,type});
      if (/\\/bundles\\//i.test(url)) audit.bundles.push({url,type});
    };
    new PerformanceObserver(list => { for (const e of list.getEntries()) record(e.name,e.initiatorType); }).observe({type:'resource',buffered:true});
    for (const method of ['createElement','createElementNS']) {
      const original = document[method].bind(document);
      document[method] = function(...a) {
        if (String(a[method === 'createElementNS' ? 1 : 0]).toLowerCase() === 'video') audit.videos++;
        return original(...a);
      };
    }
    // A local programme test must not register even an observer position.
    // Closed, never-connected presence is the existing production solo path.
    window.WebSocket = class extends EventTarget {
      static CONNECTING=0; static OPEN=1; static CLOSING=2; static CLOSED=3;
      constructor(url) { super(); this.readyState=3; audit.socketsSuppressed.push(String(url)); }
      close() {} send() { audit.writes.push({method:'WebSocket.send'}); throw Error('QA forbids writes'); }
    };
    const forbidden = (url,method) => { audit.writes.push({url:String(url),method}); throw Error('QA forbids network mutations'); };
    navigator.sendBeacon = url => forbidden(url,'BEACON');
    const open = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method,url,...rest) {
      if (!['GET','HEAD'].includes(String(method).toUpperCase())) return forbidden(url,method);
      record(String(url),'xhr'); return open.call(this,method,url,...rest);
    };
    const original = window.fetch.bind(window);
    window.fetch = function(input,init) {
      const u = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.href);
      const method = String(init?.method || input?.method || 'GET').toUpperCase();
      if (!['GET','HEAD'].includes(method)) return Promise.reject(forbidden(u.href,method));
      record(u.href,'fetch');
      let data;
      if (u.origin === location.origin && u.pathname === '/broadcast/now.json') data = {bundle:null,audio:false,loop:false};
      if (u.pathname === '/api/v1/programme/rfl') data = {schema:'4dgsx-programme/1',now:new Date(Date.now()).toISOString(),channel:{id:'rfl',timezone:'Europe/London',slots:['12:00','16:00','20:00']},items:[]};
      if (u.href === 'https://raw.githubusercontent.com/robot-football-league/rfl-league-data/main/site.json') data = ${JSON.stringify(archive)};
      if (data) { audit.feeds.push(u.href); return Promise.resolve(new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}})); }
      if (/\\/bundles\\//i.test(u.href)) return Promise.reject(Error('QA forbids bundle loading during idle'));
      return original(input,init);
    };
    // Observe text actually painted by the real overlay, without replacing draw.
    const contexts = window.__idleContexts = new Map();
    const p = CanvasRenderingContext2D.prototype, fill = p.fillText, clear = p.clearRect;
    p.fillText = function(text,...a) {
      if (!contexts.has(this)) contexts.set(this,[]);
      contexts.get(this).push(String(text));
      return fill.call(this,text,...a);
    };
    p.clearRect = function(...a) { if (contexts.has(this)) contexts.set(this,[]); return clear.apply(this,a); };
    window.__idlePaint = () => [...contexts.values()].filter(text => text.includes('CURRENT STANDINGS'));
  })()`;
}
const stateExpression = visitor => visitor ? `(() => {
  const main = __venue.venues.get('stadium')?.broadcast?.state();
  const module = __venue.venues.module('stadium','match-4dgsx')?.state;
  return {now:Date.now(),programme:main?.programme,main,module,serial:main?.frames,graphics:main?.graphics,
    paint:__idlePaint(),errors:__venue.errors};
})()` : `(() => {
  const s = rflBroadcast.state();
  return {now:Date.now(),programme:s.programme,main:s.feed,module:s.match,serial:s.renderSerial,
    diagnostics:s,paint:__idlePaint(),errors:s.errors};
})()`;
const comparable = s => ({ phase:s.programme.phase, priority:s.programme.priority, camera:s.programme.camera,
  clock:s.programme.clock, programmeT:s.programme.programmeT, phaseOrigin:s.programme.phaseOrigin,
  phaseElapsed:s.programme.phaseElapsed, table:s.programme.table, paint:s.paint });
async function audit(label) {
  const a = await chrome.evaluate('({...__idleAudit,domVideos:document.querySelectorAll("video").length})');
  report.audits[label] = a;
  check(`${label}/no-media-or-writes`, () => {
    assert.equal(a.videos,0); assert.equal(a.domVideos,0);
    assert.deepEqual(a.mp4,[]); assert.deepEqual(a.bundles,[]); assert.deepEqual(a.writes,[]);
    assert.ok(a.feeds.some(u => u.endsWith('/api/v1/programme/rfl')), 'actual programme feed used');
    assert.ok(a.feeds.some(u => u.endsWith('/site.json')), 'actual archive fetch used');
  });
}
async function boot(visitor, seconds) {
  if (injectionId) await chrome.send('Page.removeScriptToEvaluateOnNewDocument',{identifier:injectionId});
  injectionId = (await chrome.send('Page.addScriptToEvaluateOnNewDocument',{source:injection(seconds)})).identifier;
  await chrome.goto(`${report.origin}${visitor ? '/venue.html?venue=stadium&tier=2&fast=1&street=0' : '/broadcast.html'}`);
  await wait(visitor ? '!!window.__venue' : '!!window.rflBroadcast', Boolean, 'page API');
  if (visitor) {
    await chrome.evaluate('__venue.whenLoaded()', {timeoutMs:120000});
    await wait(`!!__venue.venues.module('stadium','match-4dgsx')`,Boolean,'match module');
    await chrome.evaluate(`__venue.renderer.setAnimationLoop(null); __venue.setCam('screen_main'); __venue.step(1,0);`);
    await wait(`(__venue.step(1,0), __venue.venues.get('stadium').broadcast?.state().ready)`,Boolean,'internal broadcast ready');
  } else {
    await chrome.evaluate('window.__idleReady=false; rflBroadcast.ready.then(()=>__idleReady=true,e=>__idleReady=String(e)); true');
    // networkQuiet uses Date.now before the automatic loop starts. Advance
    // ONLY empty-pitch boot in integer seconds, then restore the exact sample.
    const deadline = Date.now() + 90000;
    let ready = false;
    for (let i=0; Date.now()<deadline && !ready; i++) {
      await sleep(250);
      ready = await chrome.evaluate(`__idleTime(${seconds}+${i}); __idleReady`);
      if (typeof ready === 'string') throw Error(ready);
    }
    assert.equal(ready,true,'broadcast ready');
    await chrome.evaluate(`__idleTime(${seconds})`);
    report.bootClock = 'Integer-second ticks solely during broadcast networkQuiet; exact frozen slot time restored before every sample.';
  }
  await wait(visitor ? `(__venue.step(1,0),${stateExpression(true)})` : stateExpression(false),
    s => s?.programme?.phase === 'idle' && ['idle','countdown'].includes(s.module?.phase), 'real idle programme/module');
}
async function capture(visitor, phase) {
  await chrome.evaluate(`__idleTime(${phase.seconds}); ${visitor ? '__venue.step(1,0);' : ''}`);
  const expression = visitor ? `(__venue.step(1,0),${stateExpression(true)})` : stateExpression(false);
  let s = await wait(expression,s => s?.now === base + Math.round(phase.seconds*1000) && s.programme &&
    Math.abs(s.programme.programmeT - s.now / 1000) < 0.0001 && !!s.programme.table.visible === phase.visible, phase.name);
  if (phase.visible && phase.seconds % PERIOD > 1) s = await wait(expression,s => s.paint?.length === 1 && (!visitor || s.graphics?.visible), `${phase.name} actual overlay paint`);
  const serial = s.serial;
  s = await wait(expression,s => s.serial > serial,`${phase.name} new frozen frame`,30000);
  report.samples[route].push({name:phase.name,seconds:phase.seconds,state:s});
  check(`${route}/${phase.name}`,() => {
    assert.equal(s.now,base+Math.round(phase.seconds*1000));
    assert.equal(s.programme.phase,'idle'); assert.equal(s.programme.clock,'idle-epoch');
    assert.ok(['idle','countdown'].includes(s.module.phase));
    assert.equal(s.module.match?.id ?? s.module.id ?? null,null,'no mounted/invented match');
    assert.equal(s.programme.matchKey,null); assert.equal(s.main.attached,true); assert.equal(s.main.error,null);
    assert.deepEqual(s.errors,[]); assert.deepEqual(s.module.errors || [],[]);
    assert.equal(s.programme.camera,phase.camera); assert.equal(s.programme.table.visible,phase.visible);
    near(s.programme.table.idlePeriod,PERIOD,'period');
    assert.equal(s.programme.table.duration,54); assert.equal(s.programme.table.held,!!phase.held);
    if (phase.visible) {
      const elapsed = phase.seconds % PERIOD - 0.7;
      near(s.programme.table.elapsed,elapsed,'absolute elapsed');
      assert.equal(s.programme.table.mode,'idle'); assert.equal(s.programme.table.basis,'published-standings');
      assert.equal(s.programme.table.generatedAt,archive.generated_at); assert.equal(s.programme.table.season,archive.current_season);
      assert.equal(s.programme.table.matchId,null); assert.deepEqual(s.programme.table.movements,[]);
      if (elapsed > 1) {
        assert.equal(s.paint.length,1); assert.ok(s.paint[0].includes('BETWEEN GAMES'));
        assert.ok(!s.paint[0].includes('AFTER THE MATCH')); assert.ok(!s.paint[0].includes('BEFORE THE MATCH'));
        if (visitor) {
          assert.equal(s.graphics.mode,'idle','visitor renderer must expose idle mode');
          assert.equal(s.graphics.visible,true); near(s.graphics.elapsedSeconds,elapsed,'renderer elapsed');
          assert.equal(s.graphics.matchId,null);
        }
      }
    } else {
      assert.deepEqual(s.paint,[],'hidden overlay clears painted content');
      if (visitor) assert.equal(s.graphics.visible,false);
    }
    if (!visitor) {
      assert.equal(s.diagnostics.director.shot,phase.camera); assert.ok(s.diagnostics.live,'automatic page, not capture');
      assert.deepEqual(s.diagnostics.leagueTable,s.programme.table);
    }
  });
  if (phase.screenshot) writeFileSync(join(out,`${route}-${phase.name}.png`),await chrome.screenshot());
  save();
  return s;
}
async function coreChecks() {
  report.core = await chrome.evaluate(`(async () => {
    const {createBroadcastProgramme} = await import('/js/broadcast-programme.js');
    const {buildIdleTable} = await import('/js/league-table-data.mjs');
    const doc = ${JSON.stringify(archive)};
    const programme = await createBroadcastProgramme({venue:__venue.def});
    const nowMs = ${base}+5000;
    const run = match => programme.evaluate({match,nowMs});
    run({phase:'idle',live:null}); await new Promise(r=>setTimeout(r,20));
    const cases = [
      ['idle',{phase:'idle',live:null}],
      ['countdown',{phase:'countdown',live:null,next:{startsAt:new Date(${base}+114700).toISOString()}}],
      ['too-soon',{phase:'countdown',live:null,next:{startsAt:new Date(${base}+114699).toISOString()}}],
      ['bad-next',{phase:'countdown',live:null,next:{startsAt:'invalid'}}],
      ['loading',{phase:'loading',live:null}],
      ['live-unmounted',{phase:'idle',live:{bundleId:'not-mounted'}}],
    ].map(([name,match])=>{const r=run(match);return {name,state:r.state,presentation:r.tableCue?.presentation??null};});
    programme.dispose();
    const good = buildIdleTable(doc,{nowMs});
    const stale = buildIdleTable(doc,{nowMs:Date.parse(doc.generated_at)+21600001});
    const incomplete = structuredClone(doc);
    incomplete.seasons.find(s=>s.season===doc.current_season).matches.pop();
    const rejected = buildIdleTable(incomplete,{nowMs});
    return {cases,good,stale,incomplete:rejected};
  })()`);
  check('real createBroadcastProgramme/idle-countdown-gates-and-data',() => {
    for (const c of report.core.cases) {
      const allowed = ['idle','countdown'].includes(c.name);
      assert.equal(c.state.table.visible,allowed,c.name);
      if (allowed) { assert.equal(c.presentation.mode,'idle'); assert.equal(c.presentation.basis,'published-standings'); near(c.state.table.elapsed,4.3,c.name); }
      else assert.ok(c.state.table.idleBlocked,c.name);
    }
    assert.ok(report.core.good.table); assert.equal(report.core.stale.table,null); assert.equal(report.core.incomplete.table,null);
    const p = report.core.good.table;
    assert.equal(p.season,archive.current_season);
    assert.ok(!['home','away','score','matchId'].some(k=>k in p));
    assert.ok(p.rows.every(r=>r.position===r.previousPosition && r.played===r.previousPlayed && r.points===r.previousPoints && r.gd===r.previousGd));
    assert.deepEqual(report.core.cases[0].presentation,p);
  });
}
async function cleanCheck() {
  await chrome.evaluate('(async()=>{window.__idleClean=rflBroadcast.cleanOutput();await __idleClean.ready;})()');
  report.clean = await chrome.evaluate(`(() => {
    const s=rflBroadcast.state(), clean=__idleClean.state(), w=rflBroadcast.width,h=rflBroadcast.height;
    const live=rflBroadcast.pixels(), pixels=__idleClean.canvas.getContext('2d').getImageData(0,0,w,h).data;
    let different=0,nonzero=0;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++) {
      const a=(y*w+x)*4,z=((h-1-y)*w+x)*4;
      if([0,1,2,3].some(k=>pixels[a+k]!==live[z+k]))different++;
      if(live[z]||live[z+1]||live[z+2])nonzero++;
    }
    return {different,nonzero,width:w,height:h,clean,serial:s.renderSerial,scorebug:s.scorebug,
      shot:s.director.shot,table:s.leagueTable,errors:s.errors};
  })()`);
  check('clean output/same idle framebuffer',()=>{
    assert.equal(report.clean.different,0,'entire frame identical when no LIVE badge');
    assert.ok(report.clean.nonzero>10000,'not comparing empty buffers');
    assert.equal(report.clean.clean.frame.serial,report.clean.serial);
    assert.equal(report.clean.clean.frame.camera,report.clean.shot);
    assert.equal(report.clean.clean.frame.matchId,null);
    assert.ok(!report.clean.scorebug?.live); assert.equal(report.clean.table.visible,true);
    assert.deepEqual(report.clean.errors,[]);
  });
  await chrome.evaluate('__idleClean.stop()');
  report.clean.stopped = await chrome.evaluate('__idleClean.state()');
  check('clean output stopped',()=>assert.equal(report.clean.stopped.active,false));
}
try {
  const hosted = await serve(resolve('public')); server = hosted.server; report.origin = hosted.origin;
  chrome = await launchChrome({width:1280,height:720,gpu:report.gpu});
  chrome.onConsole((type,text)=>{if(type==='error')report.errors.push({route,text});});
  const phases = [
    {name:'before-cue',seconds:.699,visible:false,camera:'heli'},
    {name:'cue-boundary',seconds:.7,visible:true,camera:'heli'},
    {name:'standings-5s',seconds:5,visible:true,camera:'heli',screenshot:true},
    {name:'held-aerial-50s',seconds:50,visible:true,camera:'heli',held:true},
    {name:'closed-54.7s',seconds:54.7,visible:false,camera:'screen_main'},
    {name:'alternate-lap-150s',seconds:150,visible:false,camera:'heli'},
    {name:'next-period-5s',seconds:PERIOD+5,visible:true,camera:'heli'},
  ];
  for (const visitor of [true,false]) {
    route=visitor?'visitor':'broadcast';
    await boot(visitor,.699);
    for (const phase of phases) await capture(visitor,phase);
    if (visitor) await coreChecks(); else await cleanCheck();
    await audit(route);
    // New document, new real programme/controller: a late arrival must NOT
    // restart the read. Frozen time is already +50 on its first document tick.
    await boot(visitor,50);
    await capture(visitor,{name:'late-join-50s',seconds:50,visible:true,camera:'heli',held:true,screenshot:true});
    await audit(`${route}-late-join`);
  }
  for (const v of report.samples.visitor) {
    const b=report.samples.broadcast.find(s=>s.name===v.name);
    const pair={name:v.name,visitor:comparable(v.state),broadcast:comparable(b.state)};
    report.comparisons.push(pair);
    check(`route parity/${v.name}`,()=>assert.deepEqual(pair.visitor,pair.broadcast));
  }
  for (const r of ['visitor','broadcast']) check(`${r}/late join does not restart`,()=>{
    const samples=report.samples[r];
    assert.deepEqual(comparable(samples.find(s=>s.name==='held-aerial-50s').state),comparable(samples.find(s=>s.name==='late-join-50s').state));
    for(const s of samples.filter(s=>s.state.paint.length)) {
      for(const row of report.core.good.table.rows) assert.ok(s.state.paint[0].includes(row.name),`published club ${row.name} actually painted`);
    }
  });
  check('console errors',()=>assert.deepEqual(report.errors,[]));
  assert.deepEqual(report.failures,[],`${report.failures.length} checks failed; see ${out}`);
  report.passed=true;
  console.log(`PASS idle standings: ${report.comparisons.length} automatic route pairs, late join, next-stream boundary, published-data checks, same clean framebuffer; zero MP4/video/bundle/write/console errors. ${out}`);
} catch(e) {
  report.passed=false;report.fatal={route,message:e.message,stack:e.stack};process.exitCode=1;console.error(e.message);
} finally {
  try { save(); } finally { try {if(chrome)await chrome.close();} finally {if(server)await new Promise(r=>server.close(r));} }
}
