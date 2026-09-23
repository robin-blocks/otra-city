// Offline browser/WebGL gate for the actual on-air renderer. --archive uses a
// locally saved public site.json for a real-result design preview, never as
// a live fallback. Idle always uses an explicitly labelled offline fixture,
// independent of the selected archive match. --background can be a saved helicopter frame; --stadium
// captures one from the real deterministic broadcast (requires venue assets).
// node scripts/league-overlay-check.mjs [--shots qa-out/league] [--archive file] [--match 28] [--background image.png]
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { serve } from '../lib/static-server.mjs';
import { launchChrome } from '../lib/headless-chrome.mjs';
import { buildMatchTable } from '../public/js/league-table-data.mjs';

const args = process.argv.slice(2);
const arg = (key) => args[args.indexOf(`--${key}`) + 1];
const option = (key) => args.includes(`--${key}`) ? arg(key) : null;
const shots = option('shots');
const temp = mkdtempSync(join(tmpdir(), 'otra-league-'));
let chrome, server, origin;
let background = option('background') ? resolve(option('background')) : null;
if (args.includes('--stadium')) background = join(temp, 'background.png');
const names = [['GEM', 'Gemini Flash FC'], ['RMA', 'Real Machina'], ['SYA', 'Synthetic Athletic'], ['SGU', 'Singularity United'], ['DYD', 'Dynamo Datacenter'], ['FAB', 'AFC Fable'], ['CDX', 'Codex City'], ['MNS', 'Manus FC'], ['MSP', 'Muse Spark FC'], ['GLM', 'GLM United']];
let presentation = {
  matchId: 'offline-renderer-test', season: 3, label: 'DESIGN TEST',
  home: { code: 'SYA', name: 'Synthetic Athletic', color: [0.8, 0.1, 0.2] },
  away: { code: 'SGU', name: 'Singularity United', color: [0.3, 0.7, 0.9] }, score: [3, 1],
  rows: names.map(([code, name], i) => ({ code, name, position: i + 1, previousPosition: i === 2 ? 4 : i === 3 ? 3 : i + 1,
    played: 8, previousPlayed: i === 2 || i === 3 ? 7 : 8, gd: 20 - i * 4, previousGd: 20 - i * 4,
    points: 24 - i * 2, previousPoints: i === 2 ? 17 : 24 - i * 2 })),
};
// Deliberately not built from presentation/home/away: idle has no match at all.
// This fixture checks renderer shape, not publisher-data validity or freshness.
const idlePresentation = {
  mode: 'idle', season: 3, label: 'OFFLINE DESIGN TEST · SEASON 3',
  basis: 'published-standings', generatedAt: '2026-09-23T12:34:56Z',
  sourceLabel: 'OFFLINE FIXTURE · Published-standings shape',
  rows: names.map(([code, name], i) => ({
    code, name, color: ['#537ad1', '#dfbe64', '#ce4055', '#57badb'][i % 4],
    position: i + 1, previousPosition: i + 1, played: 8 + i % 2, previousPlayed: 8 + i % 2,
    gd: 20 - i * 4, previousGd: 20 - i * 4, points: 24 - i * 2, previousPoints: 24 - i * 2,
  })),
};
if (option('archive')) {
  const doc = JSON.parse(readFileSync(option('archive'), 'utf8'));
  const s = doc.seasons.find((s) => s.season === doc.current_season);
  const m = s.matches.find((m) => m.n === Number(option('match') || 28));
  const colour = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const team = (code) => { const t = s.teams.find((t) => t.code === code); return { ...t, color: colour(t.color) }; };
  const result = buildMatchTable(doc, { matchId: m.watch.id, home: team(m.home_code), away: team(m.away_code), score: m.score });
  assert.ok(result.table, result.reason);
  presentation = result.table;
}
try {
  writeFileSync(join(temp, 'presentation.json'), JSON.stringify(presentation));
  writeFileSync(join(temp, 'idle.json'), JSON.stringify(idlePresentation));
  writeFileSync(join(temp, 'index.html'), `<!doctype html><html><head><style>body{margin:0;background:#111}canvas{display:block}</style>
<script type="importmap">{"imports":{"three":"/vendor/three/three.module.js"}}</script></head><body>
<script type="module">
import * as THREE from 'three';
import {createScorebug} from '/js/scorebug.js';
import {createLeagueOverlay} from '/js/league-overlay.js';
const renderer = new THREE.WebGLRenderer({preserveDrawingBuffer:true});
renderer.setSize(1280,720); renderer.setPixelRatio(1);
document.body.appendChild(renderer.domElement);
const bg = new THREE.Scene(); bg.background = new THREE.Color('#233f3a');
const camera = new THREE.OrthographicCamera(-1,1,1,-1,0,1);
${background ? "bg.background = await new THREE.TextureLoader().loadAsync('/__league/background.png'); bg.background.colorSpace = THREE.SRGBColorSpace;" : ''}
const p = await (await fetch('/__league/presentation.json')).json();
const idle = await (await fetch('/__league/idle.json')).json();
// Canvas text is baked into WebGL, so instrument the actual paint calls rather
// than searching a DOM which contains no overlay text. Geometry catches arrows
// (including their no-change dash) and accidental match-row highlights.
let painted = {text:[],rects:[],moves:[]};
for (const [method, key] of [['fillText','text'],['fillRect','rects'],['moveTo','moves']]) {
  const original = CanvasRenderingContext2D.prototype[method];
  CanvasRenderingContext2D.prototype[method] = function(...args) {
    painted[key].push(args);
    return original.apply(this,args);
  };
}

const bug = createScorebug({width:1280,height:720});
const overlay = createLeagueOverlay({width:1280,height:720,crestFor:t=>bug.crestFor(t)});
const score = {home:p.home,away:p.away,a:p.score[0],b:p.score[1],clock:'00:00',tag:'Full Time'};
const hash = () => {const gl=renderer.getContext(), pixels=new Uint8Array(1280*720*4);gl.readPixels(0,0,1280,720,gl.RGBA,gl.UNSIGNED_BYTE,pixels); let h=2166136261;for(const n of pixels)h=Math.imul(h^n,16777619);return h>>>0;};
window.test = {
  draw(t, show=true, compact=true) {
    renderer.render(bg,camera); bug.draw(score,{compactOnly:compact});bug.render(renderer);
    painted = {text:[],rects:[],moves:[]};
    overlay.draw(show?p:null,t);overlay.render(renderer);
    return {hash:hash(),overlay:overlay.state(),painted,autoClear:renderer.autoClear,gl:renderer.getContext().getError()};
  },
  idle(t, show=true, value=idle) {
    painted = {text:[],rects:[],moves:[]};
    renderer.render(bg,camera); bug.draw(null); bug.render(renderer);
    overlay.draw(show?value:null,t); overlay.render(renderer);
    return {hash:hash(),overlay:overlay.state(),painted,autoClear:renderer.autoClear,gl:renderer.getContext().getError()};
  },
  idleVariant(value) {return this.idle(5,true,{...idle,...value});},
  invalidIdle() {
    const cases = [
      ['missing mode', {mode:undefined}], ['unknown mode', {mode:'current'}],
      ['match id', {matchId:'not-an-idle-match'}], ['home', {home:{code:'GEM'}}],
      ['away', {away:{code:'RMA'}}], ['score', {score:[0,0]}],
      ['missing basis', {basis:undefined}], ['result basis', {basis:'published-result'}],
      ['season', {season:-1}], ['label', {label:''}], ['source', {sourceLabel:''}],
      ['timestamp', {generatedAt:'not-a-date'}], ['missing rows', {rows:undefined}],
      ['too few rows', {rows:idle.rows.slice(0,1)}], ['too many rows', {rows:[...idle.rows,...idle.rows]}],
      ['duplicate code', {rows:idle.rows.map((r,i)=>i===1?{...r,code:idle.rows[0].code}:r)}],
      ['duplicate position', {rows:idle.rows.map((r,i)=>i===1?{...r,position:1,previousPosition:1}:r)}],
      ['old positions', {rows:idle.rows.map((r,i)=>({...r,previousPosition:i===0?2:i===1?1:r.position}))}],
      ...['previousPlayed','previousGd','previousPoints'].map(key=>[key,{rows:idle.rows.map((r,i)=>i===0?{...r,[key]:r[key]+1}:r)}]),
      ['negative played', {rows:idle.rows.map((r,i)=>i===0?{...r,played:-1,previousPlayed:-1}:r)}],
      ['fractional points', {rows:idle.rows.map((r,i)=>i===0?{...r,points:1.5,previousPoints:1.5}:r)}],
      ['non-finite gd', {rows:idle.rows.map((r,i)=>i===0?{...r,gd:NaN,previousGd:NaN}:r)}],
    ];
    return cases.map(([name, patch])=>{
      this.idle(5); // Each rejection must actively clear a previously visible graphic.
      const result=this.idleVariant(patch);
      return {name,hash:result.hash,overlay:result.overlay};
    });
  },
  setRows(n) { const original=p.rows;p.rows=p.rows.slice(0,n); const changed=overlay.draw(p,5); p.rows=original; return {changed,state:overlay.state()}; },
  invalid() { return overlay.draw({...p,rows:[...p.rows,...p.rows]},5),overlay.state(); },
  throwRender() {const r={autoClear:true,render(){throw Error('test');}};try{overlay.render(r);}catch{}return r.autoClear;},
  png:()=>renderer.domElement.toDataURL('image/png'),
  dispose() {overlay.dispose();overlay.dispose();return overlay.state();},
};
window.done=true;
</script></body></html>`);
  const mounts = { '/__league': (rel) => rel === 'background.png' && background ? background : join(temp, rel || 'index.html') };
  ({ server, origin } = await serve(resolve('public'), { mounts }));
  chrome = await launchChrome({ width: 1280, height: 720 });
  if (args.includes('--stadium')) {
    await chrome.goto(`${origin}/broadcast.html?capture=1&camera=heli`);
    for (let i = 0; i < 500 && !(await chrome.evaluate('!!window.rflBroadcast')); i++) await new Promise((r) => setTimeout(r, 100));
    await chrome.evaluate('window.rflBroadcast.ready', { timeoutMs: 120000 });
    await chrome.evaluate('window.rflBroadcast.step(350)');
    const frame = await chrome.evaluate('window.rflBroadcast.frame()');
    writeFileSync(background, Buffer.from(frame.split(',')[1], 'base64'));
  }
  const errors = [];
  chrome.onConsole((type, text) => { if (type === 'error') errors.push(text); });
  await chrome.goto(`${origin}/__league/index.html`);
  for (let i = 0; i < 100 && !(await chrome.evaluate('window.done === true')); i++) await new Promise((r) => setTimeout(r, 50));
  assert.equal(await chrome.evaluate('window.done'), true, 'renderer initialized');
  const draw = (t, show = true, compact = true) => chrome.evaluate(`test.draw(${t},${show},${compact})`);
  const base = await draw(0, false);
  const before = await draw(1);
  assert.notEqual(before.hash, base.hash, 'overlay is inside the WebGL framebuffer');
  assert.equal(before.overlay.phase, 'before');
  const moving = await draw(2.4);
  assert.equal(moving.overlay.phase, 'moving');
  assert.notEqual(moving.hash, before.hash, 'row animation changes captured pixels');
  for (let i = 0; i < 100; i++) {
    const x = await draw(4);
    if (x.overlay.crests.loaded === x.overlay.crests.requested && x.overlay.crests.loaded >= presentation.rows.length) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  const held = await draw(5), heldAgain = await draw(12);
  assert.equal(held.hash, heldAgain.hash, 'held table is pixel-stable');
  assert.equal(held.overlay.uploads, heldAgain.overlay.uploads, 'held frames reuse texture');
  assert.equal(held.overlay.crests.loaded, presentation.rows.length, 'all local crests load');
  assert.equal(held.autoClear, true, 'render flags restored');
  assert.equal(held.gl, 0, 'no WebGL errors');
  assert.equal(await chrome.evaluate('test.throwRender()'), true, 'render flags restored on an exception');
  if (shots) {
    mkdirSync(shots, { recursive: true });
    for (const [name, t] of [['before', 1], ['moving', 2.4], ['after', 5]]) {
      await draw(t);
      const uri = await chrome.evaluate('test.png()');
      writeFileSync(join(shots, `league-${name}.png`), Buffer.from(uri.split(',')[1], 'base64'));
    }
  }
  // Screenshots may have repainted animation states: start a fresh cache count.
  const holdUploads = (await draw(5)).overlay.uploads;
  for (const t of [18, 25.01, 45, 50, 53.399]) {
    const extended = await draw(t);
    assert.equal(extended.overlay.phase, 'held', `54-second table held at ${t}s`);
    assert.equal(extended.hash, held.hash, 'extended hold keeps the approved frame');
    assert.equal(extended.overlay.uploads, holdUploads, 'no extra uploads during extended hold');
  }
  const fade = await draw(53.7);
  assert.equal(fade.overlay.phase, 'leaving');
  assert.ok(fade.overlay.opacity > 0 && fade.overlay.opacity < 1);
  assert.equal((await draw(54)).hash, base.hash, 'exit leaves no stale pixels');
  await draw(5);
  assert.equal((await draw(0, false)).hash, base.hash, 'null clears the graphic');
  assert.notEqual((await draw(0, false, false)).hash, base.hash, 'ordinary lower score bar returns');
  assert.equal((await chrome.evaluate('test.invalid()')).phase, 'unsupported', 'unsupported table hides, never truncates');
  const idleDraw = (t, show = true) => chrome.evaluate(`test.idle(${t},${show})`);
  const idleBase = await idleDraw(0, false);
  const idleIntro = await idleDraw(.275);
  assert.equal(idleIntro.overlay.phase, 'entering');
  assert.ok(idleIntro.overlay.opacity > 0 && idleIntro.overlay.opacity < 1);
  assert.equal(idleIntro.overlay.matchId, null, 'idle does not invent a match id');
  const texts = idleIntro.painted.text.map(([text]) => text);
  for (const text of ['CURRENT STANDINGS', 'BETWEEN GAMES', 'TABLE LEADER', 'SEASON SNAPSHOT',
    'POS', 'CLUB', 'P', 'GD', 'PTS', 'PLAYED PER CLUB', 'PUBLISHED STANDINGS', 'UPDATED 2026-09-23  12:34 UTC']) {
    assert.ok(texts.includes(text), `idle paints ${text}`);
  }
  assert.ok(texts.includes(idlePresentation.sourceLabel), 'idle displays honest offline provenance');
  assert.ok(!texts.some((s) => /before|after|match|home|away|full.?time|^FT$|gained|lost|no change|movement|^from /i.test(s)),
    'idle has no match, score, or movement copy');
  assert.ok(!texts.some((s) => /^\d+\s+-\s+\d+$/.test(s)), 'idle has no FT score');
  const at = (x,y) => idleIntro.painted.text.find(([,tx,ty]) => tx===x && ty===y)?.[0];
  assert.equal(at(943,256), idlePresentation.rows[0].name, 'leader comes from published position one');
  assert.equal(at(1011,332), String(idlePresentation.rows[0].points), 'leader points come from row');
  assert.equal(at(890,491), String(idlePresentation.rows.length), 'club count comes from rows');
  assert.equal(at(1011,491), '8–9', 'played range comes from rows, not a fictional match total');
  const tableRows = idleIntro.painted.text.filter(([,x,y]) => x===228 && y>=253 && y<589);
  assert.deepEqual(tableRows.map(([name])=>name), idlePresentation.rows.map((r)=>r.name), 'static published order');
  assert.ok(!idleIntro.painted.moves.some(([x,y]) => x===0 && y<0), 'no vector movement arrows');
  assert.ok(!idleIntro.painted.rects.some(([x,,w,h]) => x===147 && w===8 && h===2), 'no no-change dashes');
  assert.ok(!idleIntro.painted.rects.some(([x,,w]) => x===84 && w===3), 'no match-specific highlighted clubs');
  // The idle fixture and an optional archive can have different crest sets.
  for (let i = 0; i < 100; i++) {
    const x = await idleDraw(.55);
    if (x.overlay.crests.loaded === x.overlay.crests.requested) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  const idleHeld = await idleDraw(.55);
  assert.equal(idleHeld.overlay.phase, 'held', 'idle skips before/moving phases');
  assert.equal(idleHeld.overlay.visible, true, 'idle visible with no match mounted');
  assert.equal(idleHeld.overlay.rowCount, idlePresentation.rows.length);
  assert.notEqual(idleHeld.hash, idleBase.hash, 'idle is captured in WebGL');
  assert.equal(idleHeld.gl, 0);
  assert.equal(idleHeld.autoClear, true);
  for (const t of [1, 1.8, 2.4, 3, 5, 18, 25.01, 45, 50, 53.399]) {
    const x = await idleDraw(t);
    assert.equal(x.overlay.phase, 'held', `idle held at ${t}s`);
    assert.equal(x.hash, idleHeld.hash, `idle pixels static at ${t}s`);
    assert.equal(x.overlay.uploads, idleHeld.overlay.uploads, 'idle reuses cached texture after intro');
    assert.equal(x.painted.text.length, 0, 'idle does not repaint cached text');
  }
  if (shots) {
    const uri = await chrome.evaluate('test.png()');
    writeFileSync(join(shots, 'idle.png'), Buffer.from(uri.split(',')[1], 'base64'));
  }
  const idleFade = await idleDraw(53.7);
  assert.equal(idleFade.overlay.phase, 'leaving');
  assert.equal(idleFade.overlay.opacity, fade.overlay.opacity, 'same 54-second fade as post-match');
  assert.notEqual(idleFade.hash, idleHeld.hash);
  assert.equal(idleFade.overlay.uploads, idleHeld.overlay.uploads, 'fade changes quad, not texture');
  const idleFinished = await idleDraw(54);
  assert.equal(idleFinished.overlay.phase, 'finished');
  assert.equal(idleFinished.overlay.visible, false);
  assert.equal(idleFinished.hash, idleBase.hash, 'idle expires at 54 without stale pixels');
  await idleDraw(5);
  assert.equal((await idleDraw(0,false)).hash, idleBase.hash, 'null clears idle');
  for (const result of await chrome.evaluate('test.invalidIdle()')) {
    assert.equal(result.overlay.phase, 'unsupported', `reject invalid idle: ${result.name}`);
    assert.equal(result.overlay.visible, false);
    assert.equal(result.hash, idleBase.hash, `invalid idle clears pixels: ${result.name}`);
  }
  const variant = (patch) => chrome.evaluate(`test.idleVariant(${JSON.stringify(patch)})`);
  const small = await variant({rows:idlePresentation.rows.slice(0,4)});
  assert.equal(small.overlay.rowCount, 4, 'small idle table remains supported');
  assert.ok(!small.painted.text.some(([s]) => /before|after|match/i.test(s)), 'small-table footer is match-free');
  const shuffled = await variant({rows:[...idlePresentation.rows].reverse()});
  assert.deepEqual(shuffled.painted.text.filter(([,x,y]) => x===228 && y>=253 && y<589).map(([name])=>name),
    idlePresentation.rows.map((r)=>r.name), 'published positions, not input array order, determine table');
  assert.equal(shuffled.painted.text.find(([,x,y])=>x===943 && y===256)?.[0], idlePresentation.rows[0].name,
    'leader follows published position even with shuffled input');
  const zero = await variant({rows:idlePresentation.rows.map((r)=>({...r,played:0,previousPlayed:0,gd:0,previousGd:0,points:0,previousPoints:0}))});
  assert.equal(zero.overlay.visible, true, 'zero-game season is valid idle');
  assert.equal(zero.painted.text.find(([,x,y])=>x===1011 && y===491)?.[0], '0', 'equal games played uses one value, including zero');
  assert.equal((await idleDraw(5)).overlay.visible, true, 'valid idle recovers after invalid input');
  const returned = await draw(5);
  assert.equal(returned.overlay.visible, true, 'post-match returns after idle');
  assert.equal(returned.overlay.matchId, presentation.matchId);
  assert.notEqual(returned.hash, idleHeld.hash, 'post-match replaces idle pixels');
  for (const text of ['LEAGUE TABLE', 'AFTER THE MATCH', 'HOME', 'AWAY', 'FT', `${presentation.score[0]}  -  ${presentation.score[1]}`]) {
    assert.ok(returned.painted.text.some(([s]) => s===text), `post-match restores ${text}`);
  }
  assert.ok(!returned.painted.text.some(([s]) => s==='CURRENT STANDINGS' || s==='BETWEEN GAMES'), 'idle copy is gone');
  const returnedAgain = await draw(12);
  assert.equal(returnedAgain.hash, returned.hash, 'returned post-match frame is cached');
  assert.equal(returnedAgain.overlay.uploads, returned.overlay.uploads);
  assert.equal((await draw(1)).overlay.phase, 'before', 'post-match before phase returns');
  assert.equal((await draw(2.4)).overlay.phase, 'moving', 'post-match reorder returns');
  assert.equal((await draw(5)).overlay.phase, 'held', 'post-match held phase returns');
  assert.equal((await chrome.evaluate('test.dispose()')).disposed, true);
  assert.deepEqual(errors, [], 'no browser errors');
  console.log('PASS league overlay: framebuffer, animated positions, local crests, hold caching, fade, reset, scorebar; idle no-match text/cards, static order/pixels/cache, 54s fade, invalid rejection, post-match return, disposal');
  if (shots) console.log(`Screenshots: ${resolve(shots)}/league-{before,moving,after}.png and idle.png`);
} finally {
  if (chrome) await chrome.close();
  if (server) await new Promise((r) => server.close(r));
  rmSync(temp, { recursive: true, force: true });
}
