// Offline browser/WebGL gate for the actual on-air renderer. --archive uses a
// locally saved public site.json for a real-result design preview, never as
// a live fallback. --background can be a saved helicopter frame; --stadium
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
const bug = createScorebug({width:1280,height:720});
const overlay = createLeagueOverlay({width:1280,height:720,crestFor:t=>bug.crestFor(t)});
const score = {home:p.home,away:p.away,a:p.score[0],b:p.score[1],clock:'00:00',tag:'Full Time'};
const hash = () => {const gl=renderer.getContext(), pixels=new Uint8Array(1280*720*4);gl.readPixels(0,0,1280,720,gl.RGBA,gl.UNSIGNED_BYTE,pixels); let h=2166136261;for(const n of pixels)h=Math.imul(h^n,16777619);return h>>>0;};
window.test = {
  draw(t, show=true, compact=true) {
    renderer.render(bg,camera); bug.draw(score,{compactOnly:compact});bug.render(renderer);
    overlay.draw(show?p:null,t);overlay.render(renderer);
    return {hash:hash(),overlay:overlay.state(),autoClear:renderer.autoClear,gl:renderer.getContext().getError()};
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
  for (const t of [18, 25.01, 45, 50, 53.399]) {
    const extended = await draw(t);
    assert.equal(extended.overlay.phase, 'held', `54-second table held at ${t}s`);
    assert.equal(extended.hash, held.hash, 'extended hold keeps the approved frame');
    assert.equal(extended.overlay.uploads, held.overlay.uploads, 'no extra uploads during extended hold');
  }
  const fade = await draw(53.7);
  assert.equal(fade.overlay.phase, 'leaving');
  assert.ok(fade.overlay.opacity > 0 && fade.overlay.opacity < 1);
  assert.equal((await draw(54)).hash, base.hash, 'exit leaves no stale pixels');
  await draw(5);
  assert.equal((await draw(0, false)).hash, base.hash, 'null clears the graphic');
  assert.notEqual((await draw(0, false, false)).hash, base.hash, 'ordinary lower score bar returns');
  assert.equal((await chrome.evaluate('test.invalid()')).phase, 'unsupported', 'unsupported table hides, never truncates');
  assert.equal((await chrome.evaluate('test.dispose()')).disposed, true);
  assert.deepEqual(errors, [], 'no browser errors');
  console.log('PASS league overlay: framebuffer, animated positions, local crests, hold caching, fade, reset, scorebar, disposal');
  if (shots) console.log(`Screenshots: ${resolve(shots)}/league-{before,moving,after}.png`);
} finally {
  if (chrome) await chrome.close();
  if (server) await new Promise((r) => server.close(r));
  rmSync(temp, { recursive: true, force: true });
}
