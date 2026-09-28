// A goal in a restart_phase bundle (RFL, 2026-09-27; m76 on), on the real
// /broadcast page: explosion framing, the gantry following the scorer, the
// scorebug clock standing still through the walk-back, RFL's replay file cut
// in over it and out again, then the live wide before the kick-off whistle.
//
//   node scripts/restart-phase-browser.mjs                 # m62, reshaped (below)
//   node scripts/restart-phase-browser.mjs --bundle <url>  # a real restart_phase bundle, as shipped
//       [--goal <t>]   which goal (default: the first with a restart stoppage)
//       [--gpu]        use the machine's GPU (default: software GL, like CI)
//
// With no --bundle there is no restart_phase bundle yet, so a real one is
// reshaped: s3-m62's goal at 82.6 is given the m76 events and clock block
// (a celebration to 87.6, a replay at 88.0 playing the test file
// scripts/fixtures/replay-rgb.mp4, a stoppage to 94.0), its programme hold is
// taken out and `meta.restart_phase` set. Its TRACK is unchanged: those robots
// do not walk back, so this proves the page, not RFL's physics. The bundle is
// proxied from RFL's CDN through the page's own origin and cached under
// poc/out/restart-phase/. Frames land there too.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve, extname, join } from 'node:path';
import { launchChrome } from '../lib/headless-chrome.mjs';
import { MIME } from '../lib/static-server.mjs';

const arg = (name) => { const i = process.argv.indexOf(name); return i < 0 ? null : process.argv[i + 1]; };
const M62 = 'https://cdn.4dgsx.com/channels/rfl/bundles/s3-m62_frontier_gemini_frontier_glm-386a709826fadc4fe0fbe209';
const real = arg('--bundle');
const CDN = (real || M62).replace(/\/+$/, '');
const out = resolve('poc/out/restart-phase');
const cache = join(out, 'bundles', CDN.split('/').pop());
mkdirSync(cache, { recursive: true });

async function cdnFile(f) {
  const p = join(cache, f.replace(/\//g, '__'));
  if (!existsSync(p)) {
    const r = await fetch(`${CDN}/${f}`);
    if (!r.ok) return null;
    writeFileSync(p, Buffer.from(await r.arrayBuffer()));
  }
  return readFileSync(p);
}

// The reshaping, for m62 only. A real bundle is served exactly as shipped.
const G = 82.6, EXPLOSION_S = 1.6, CEL_END = 87.6, REPLAY_T = 88.0, REPLAY_S = 3, RESTART = 94.0;
const fixture = readFileSync('scripts/fixtures/replay-rgb.mp4');
function reshapeScene(s) {
  s.meta.restart_phase = 1;
  const map = s.program.map;
  const i = map.findIndex(([t], k) => t === G && map[k + 1]?.[0] === G);
  const hold = map[i + 1][1] - map[i][1];
  map.splice(i + 1, 1);
  for (let k = i + 1; k < map.length; k++) map[k][1] -= hold;
  s.program.duration_s -= hold;
  return s;
}
function reshapeHud(h) {
  const g = h.events.find((e) => e.type === 'goal' && e.t === G);
  g.replay_s = 0; g.celebration_s = EXPLOSION_S;
  h.events.push(
    { t: G, type: 'celebration', player: g.player, kind: 'to_the_gaffer', t_end: CEL_END, shout: 'FOR THE GAFFER' },
    { t: G, type: 'radio', player: g.player, text: 'FOR THE GAFFER' },
    { t: REPLAY_T, type: 'replay', goal_t: G, player: g.player, dur_s: REPLAY_S, src: 'media/replays/goal_02.mp4', source: [G - 5, G + 0.2] });
  h.events.sort((a, b) => a.t - b.t);
  h.clock.stoppages = [{ kind: 'restart', goal_t: G, t: G, restart_t: RESTART }];
  for (const b of h.clock.buzzers) for (const k of ['t', 'play_end_t', 'restart_t']) if (b[k] != null) b[k] += RESTART - G;
  return h;
}

function sendRange(req, res, body, type) {
  const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
  if (!m) { res.writeHead(200, { 'content-type': type, 'accept-ranges': 'bytes', 'content-length': body.length }); return res.end(body); }
  const a = +m[1], b = m[2] ? Math.min(+m[2], body.length - 1) : body.length - 1;
  res.writeHead(206, { 'content-type': type, 'accept-ranges': 'bytes', 'content-range': `bytes ${a}-${b}/${body.length}`, 'content-length': b - a + 1 });
  res.end(body.subarray(a, b + 1));
}
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://local').pathname);
  try {
    if (path.startsWith('/b/')) {
      const f = path.slice(3);
      if (!real && f === 'media/replays/goal_02.mp4') return sendRange(req, res, fixture, 'video/mp4');
      const body = await cdnFile(f);
      if (!body) return res.writeHead(404).end();
      if (!real && f === 'scene.json') return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(reshapeScene(JSON.parse(body))));
      if (!real && f === 'hud.json') return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(reshapeHud(JSON.parse(body))));
      return sendRange(req, res, body, MIME[extname(f)] || 'application/octet-stream');
    }
    const file = resolve('public', `.${path === '/' ? '/index.html' : path}`);
    if (!file.startsWith(resolve('public')) || !existsSync(file) || statSync(file).isDirectory()) return res.writeHead(404).end();
    const body = readFileSync(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' }).end(body);
  } catch (e) { console.error(path, e.message); res.writeHead(500).end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

// The goal under test and its windows, from the bundle as the page will see it.
const scene = real ? JSON.parse(await cdnFile('scene.json')) : reshapeScene(JSON.parse(await cdnFile('scene.json')));
const hud = real ? JSON.parse(await cdnFile('hud.json')) : reshapeHud(JSON.parse(await cdnFile('hud.json')));
assert.ok(scene.meta?.restart_phase, 'a restart_phase bundle');
const stoppages = hud.clock?.stoppages || [];
const want = arg('--goal') === null ? null : +arg('--goal');
const stop = stoppages.find((s) => want === null ? s.kind === 'restart' : Math.abs(s.goal_t - want) < 0.05);
assert.ok(stop, `a restart stoppage${want === null ? '' : ` at ${want}`}`);
const goal = hud.events.find((e) => e.type === 'goal' && Math.abs(e.t - stop.goal_t) < 0.05);
const cel = hud.events.find((e) => e.type === 'celebration' && Math.abs(e.t - goal.t) < 0.05);
const rep = hud.events.find((e) => e.type === 'replay' && Math.abs(e.goal_t - goal.t) < 0.05);
const explosionEnd = goal.t + (goal.celebration_s || 0);
console.log(`goal ${goal.t} (${goal.player}); explosion to ${explosionEnd}; celebration ${cel ? `${cel.kind} to ${cel.t_end}` : 'none'}; `
  + `replay ${rep ? `${rep.t}+${rep.dur_s}${rep.src ? '' : ' (no file)'}` : 'none'}; restart ${stop.restart_t}`);
// Programme seconds at a match time: through the bundle's own map.
const mapAt = (t) => {
  const m = scene.program.map;
  if (t <= m[0][0]) return m[0][1];
  for (let i = 1; i < m.length; i++) {
    const [t0, p0] = m[i - 1], [t1, p1] = m[i];
    if (t <= t1) return t1 === t0 ? p0 : p0 + (t - t0) * (p1 - p0) / (t1 - t0);
  }
  return m.at(-1)[1];
};

const chrome = await launchChrome({ gpu: process.argv.includes('--gpu'), width: 1280, height: 720 });
const log = [];
try {
  await chrome.goto(`${origin}/broadcast.html`);
  await chrome.evaluate('rflBroadcast.ready');
  const lead = 4;
  const startsAt = new Date(Date.now() - mapAt(goal.t - lead) * 1000).toISOString();
  assert.equal(await chrome.evaluate(`rflBroadcast.rehearseLive({ bundleUrl: location.origin + '/b', startsAt: ${JSON.stringify(startsAt)} })`), true);
  const shots = [[explosionEnd - 0.6, 'explosion'], [cel ? (explosionEnd + cel.t_end) / 2 : null, 'follow'],
    [rep?.src ? rep.t + rep.dur_s / 2 : null, 'replay'], [stop.restart_t - 1, 'wide-before-whistle']].filter(([t]) => t !== null);
  const taken = new Set();
  const until = Date.now() + (stop.restart_t - goal.t + lead + 60) * 1000;
  while (Date.now() < until) {
    const s = await chrome.evaluate(`(() => { const s = rflBroadcast.state(), p = s.programme || {}; return {
      t: s.scorebug?.t ?? null, clock: s.scorebug?.clock ?? null, stoppage: s.scorebug?.stoppage ?? null, replayTag: !!s.scorebug?.replay,
      priority: p.priority ?? null, camera: p.camera ?? null, follow: p.follow?.player ?? null, window: !!p.replay,
      onAir: !!s.replayMedia?.onAir, lateMs: s.replayMedia?.lateMs ?? null, mediaError: s.replayMedia?.error ?? null,
      h264: s.replayMedia?.h264 ?? null, errors: s.errors.length }; })()`);
    if (s.t !== null && s.t >= goal.t - lead + 0.5) log.push(s);
    if (s.t !== null && s.t > stop.restart_t + 1) break;
    for (const [at, name] of shots) {
      if (taken.has(name) || s.t === null || s.t < at) continue;
      taken.add(name);
      const png = await chrome.evaluate('rflBroadcast.frame()');
      writeFileSync(join(out, `${name}.png`), Buffer.from(png.split(',')[1], 'base64'));
    }
    await new Promise((r) => setTimeout(r, 100));
  }
} finally {
  await chrome.close?.();
  server.close();
}

let last = '';
for (const s of log) {
  const key = JSON.stringify({ ...s, t: 0, lateMs: 0 });
  if (key !== last) console.log(JSON.stringify(s));
  last = key;
}
// Sampled at ~10 Hz on a live clock, so each window is checked inside its
// edges by a margin of one drawn frame (software GL paints a few a second).
const ts = [...new Set(log.map((s) => s.t))];
const gaps = ts.slice(1).map((t, i) => t - ts[i]).sort((a, b) => a - b);
const margin = Math.max(0.3, (gaps[Math.floor(gaps.length * 0.9)] ?? 0) + 0.1);
const inside = (a, b) => log.filter((s) => s.t > a + margin && s.t < b - margin);
assert.ok(log.length > 20 && log.at(-1).t > stop.restart_t, 'observed through the restart');
assert.ok(log.every((s) => s.errors === 0), 'no page errors');
const held = inside(goal.t, stop.restart_t);
assert.ok(held.length && held.every((s) => s.clock === held[0].clock && s.stoppage === 'restart'), 'the scorebug clock stands still through the walk-back');
assert.ok(log.some((s) => s.t > stop.restart_t + 0.3 && s.stoppage === null), 'and runs again after the whistle');
assert.ok(inside(goal.t, explosionEnd).every((s) => s.priority === 'celebration'), 'the explosion framing for its burst');
if (cel) assert.ok(inside(explosionEnd, cel.t_end).every((s) => s.priority === 'follow' && s.follow === cel.player), 'then the gantry follows the scorer');
if (rep?.src) {
  const on = inside(rep.t, rep.t + rep.dur_s);
  assert.ok(on.length && on.every((s) => s.window), 'the director opens the replay window');
  assert.ok(on.every((s) => s.onAir && s.replayTag), `RFL's file is the picture, wearing REPLAY (h264 ${log[0].h264}, error ${log.at(-1).mediaError})`);
}
const after = inside(rep ? rep.t + rep.dur_s : cel?.t_end ?? explosionEnd, stop.restart_t);
assert.ok(after.every((s) => !s.onAir && !s.window && s.priority === 'play'), 'the live stadium before the whistle');
console.log(`PASS restart_phase goal on /broadcast${real ? '' : ' (m62 reshaped)'}: explosion, follow ${cel?.player ?? '-'}, clock held ${held[0].clock}, `
  + `replay ${rep?.src ? `on air (first frame ${log.find((s) => s.lateMs !== null)?.lateMs ?? '?'} ms)` : 'absent'}, live before the whistle; `
  + `frame spacing p90 ${(margin - 0.1).toFixed(2)} s; frames in ${out}`);
