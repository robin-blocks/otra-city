// Rehearse the incident's REAL scheduled M42 on the actual broadcast page,
// while site.json still says scheduled. Date.now and feed responses are replaced
// inside this QA browser only; no public schedule or fixture is ever changed.
// Requires the publisher's SDK/bundle. Offline accounting tests are separate.
// node scripts/league-first-air-browser.mjs [--gpu] [--origin https://otra.city] [--out qa-out/league/first-air-fix]
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { serve } from '../lib/static-server.mjs';
import { launchChrome } from '../lib/headless-chrome.mjs';
const args = process.argv.slice(2);
const option = (k) => args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : null;
const out = resolve(option('out') || 'qa-out/league/first-air-fix');
mkdirSync(out, { recursive: true });
const fixture = JSON.parse(readFileSync(new URL('./fixtures/league-first-air-m42.json', import.meta.url)));
const item = fixture.programme.item;
const archive = fixture.archive;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let chrome, server;
const samples = [], errors = [];
const origin = option('origin');
try {
  const hosted = origin ? { origin } : await serve(resolve('public'));
  server = hosted.server;
  chrome = await launchChrome({ width: 1280, height: 720, gpu: args.includes('--gpu') });
  chrome.onConsole((type, text) => { if (type === 'error') errors.push(text); });
  // The archive retains its original timestamp and unpublished fixture. The
  // clock simply replays the noon slot; scores/clock/ball/camera are production.
  await chrome.send('Page.addScriptToEvaluateOnNewDocument', { source: `{
    let base = ${Date.parse(item.startsAt) + 180000}, anchor = performance.now();
    window.__leagueProgramme = seconds => { base = ${Date.parse(item.startsAt)} + seconds * 1000; anchor = performance.now(); };
    Date.now = () => base + performance.now() - anchor;
    const original = window.fetch.bind(window);
    window.fetch = function(input, init) {
      const u = new URL(typeof input === 'string' ? input : input.url, location.href);
      let data;
      if (u.origin === location.origin && u.pathname === '/broadcast/now.json') data = {bundle:null,audio:false,loop:false};
      if (u.pathname === '/api/v1/programme/rfl') data = {schema:'4dgsx-programme/1',now:new Date(Date.now()).toISOString(),channel:{id:'rfl',timezone:'Europe/London',slots:['12:00','16:00','20:00']},items:[]};
      if (u.href === 'https://raw.githubusercontent.com/robot-football-league/rfl-league-data/main/site.json') data = ${JSON.stringify(archive)};
      if (data) return Promise.resolve(new Response(JSON.stringify(data), {status:200,headers:{'Content-Type':'application/json'}}));
      return original(input, init);
    };
  }` });
  await chrome.goto(`${hosted.origin}/broadcast${origin ? '' : '.html'}`);
  for (let i = 0; i < 900 && !(await chrome.evaluate('!!window.rflBroadcast')); i++) await sleep(100);
  await chrome.evaluate('window.rflBroadcast.ready.then(()=>true)', { timeoutMs: 180000 });
  const state = () => chrome.evaluate('window.rflBroadcast.state()');
  const wait = async (predicate, seconds = 120) => {
    let s; const until = Date.now() + seconds * 1000;
    do { await sleep(200); s = await state(); if (predicate(s)) return s; } while (Date.now() < until);
    throw Error(`timeout: ${JSON.stringify({bug:s?.scorebug,director:s?.director,table:s?.leagueTable,match:s?.match})}`);
  };
  assert.equal(await chrome.evaluate(`window.rflBroadcast.rehearseLive(${JSON.stringify(item)})`, { timeoutMs: 300000 }), true);
  await chrome.evaluate('window.__leagueProgramme(300)');
  const playing = await wait(s => s.match?.id === item.bundleId && s.match.bodies?.ok && s.scorebug?.inPlay && !s.scorebug.over);
  assert.equal(playing.match.source, 'schedule');
  assert.equal(playing.match.startsAt, item.startsAt);
  assert.equal(playing.leagueTable.visible, false);
  samples.push({phase:'scheduled-play',state:playing});
  // M42 scene.program.map: t=617 is programme 842; t=622 finishes
  // its final hold at programme 856.52. Start just past the full whistle.
  await chrome.evaluate('window.__leagueProgramme(842.2)');
  const dead = await wait(s => s.scorebug?.over && s.scorebug.inPlay);
  assert.equal(dead.leagueTable.visible, false);
  assert.equal(dead.director.shot, 'gantry');
  samples.push({phase:'full-time-ball-still-live',state:dead});
  // Let the real scheduled clock cross rest and cue the real director.
  const shown = await wait(s => s.leagueTable?.visible && s.leagueTable.elapsed >= 3);
  assert.equal(shown.scorebug.inPlay, false);
  assert.equal(shown.director.shot, 'heli');
  assert.equal(shown.director.settling, false);
  assert.equal(shown.leagueTable.basis, 'first-air-hud');
  assert.equal(shown.leagueTable.generatedAt, archive.generated_at);
  assert.deepEqual([shown.scorebug.a,shown.scorebug.b], [3,6]);
  assert.deepEqual(shown.leagueTable.movements, [{code:'SGU',from:6,to:3,change:3},{code:'SYA',from:4,to:5,change:-1}]);
  samples.push({phase:'first-air-table-on-heli',state:shown});
  writeFileSync(join(out, 'm42-first-air-table.png'), await chrome.screenshot());
  // Catch both the old 18s expiry and the ambient heli's ordinary 45s cut.
  // Check every sampled frame, not just a final 'complete' which might mean
  // the controller aborted early when the camera switched away.
  const cueStart = shown.t - shown.leagueTable.elapsed;
  let extended = null, lastElapsed = shown.leagueTable.elapsed;
  const complete = await wait(s => {
    if (s.leagueTable?.visible) {
      assert.equal(s.director.shot, 'heli', 'aerial continues through the full reading hold');
      assert.deepEqual(s.leagueTable.movements, shown.leagueTable.movements);
      lastElapsed = s.leagueTable.elapsed;
      if (!extended && lastElapsed >= 50) extended = s;
    } else if (s.leagueTable?.status !== 'complete') {
      assert.fail(`table interrupted during hold: ${JSON.stringify(s.leagueTable)}`);
    }
    return s.leagueTable?.status === 'complete';
  }, 240);
  assert.ok(extended, 'table is still on air after both old duration and normal camera cut');
  assert.ok(lastElapsed >= 53, `last visible sample at ${lastElapsed}s`);
  assert.ok(complete.t - cueStart >= 53.95, 'not completed before 54 seconds');
  assert.equal(complete.leagueTable.visible, false);
  samples.push({phase:'extended-hold-past-50-seconds',state:extended});
  samples.push({phase:'54-second-cue-complete',state:complete});
  const resumed = await wait(s => s.director.shot === 'screen_main');
  assert.equal(resumed.leagueTable.visible, false);
  samples.push({phase:'ambient-cut-list-resumed',state:resumed});
  await chrome.evaluate('window.__leagueProgramme(300)');
  const back = await wait(s => s.scorebug?.inPlay && !s.scorebug.over);
  assert.equal(back.leagueTable.visible, false);
  samples.push({phase:'back-to-play',state:back});
  assert.deepEqual(errors, []);
  assert.ok(samples.every(x => !x.state.errors?.length && !x.state.match?.errors?.length));
  console.log(`PASS real scheduled M42: unpublished archive, full-time dead-ball gate, settled heli, SGU 6→3 / SYA 4→5, 54-second hold/exit, ambient cut resumes, reset, zero errors; build ${shown.build}`);
} finally {
  writeFileSync(join(out, 'm42-first-air-browser.json'), JSON.stringify({origin:origin || 'local',scope:'QA browser clock/feeds only; actual publisher M42 bundle and broadcast rendering',samples,errors}, null, 2));
  if (chrome) await chrome.close();
  if (server) await new Promise(r => server.close(r));
}
