// The goal replay as a media cut (RFL, 2026-09-27; restart_phase bundles from
// m76), in real Chrome: the actual replay player, an actual H.264 file served
// CROSS-ORIGIN with RFL's CDN headers (access-control-allow-origin: *, byte
// ranges), drawn into a 1280×720 WebGL canvas the way /broadcast draws it.
//
//   node scripts/replay-media-check.mjs
//
// The fixture is 3 s at 1920×1080/50: one second each of red, green, blue.
// A frame read off the canvas therefore says where in the file the picture is.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve, extname } from 'node:path';
import { launchChrome } from '../lib/headless-chrome.mjs';
import { MIME } from '../lib/static-server.mjs';
import { REPLAY_SYNC_TOLERANCE_S } from '../public/js/replay-media.mjs';

const video = readFileSync('scripts/fixtures/replay-rgb.mp4');
const requests = [];
function listen(handler) {
  const server = createServer(handler);
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)));
}
// The page's own origin: the modules and three.
const page = await listen((req, res) => {
  const path = new URL(req.url, 'http://local').pathname;
  if (path === '/') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<!doctype html><script type="importmap">{"imports":{"three":"/vendor/three/three.module.js"}}</script>'); }
  try {
    const file = resolve('public', `.${path}`), body = readFileSync(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404).end(); }
});
// The "CDN": another origin, RFL's headers, byte ranges, and a missing file.
const cdn = await listen((req, res) => {
  const path = new URL(req.url, 'http://local').pathname;
  requests.push(path);
  const cors = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'Content-Length,Content-Range,Accept-Ranges,ETag' };
  if (path !== '/bundle/media/replays/goal_01.mp4') return res.writeHead(404, cors).end();
  const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
  if (!m) { res.writeHead(200, { ...cors, 'content-type': 'video/mp4', 'accept-ranges': 'bytes', 'content-length': video.length }); return res.end(video); }
  const a = +m[1], b = m[2] ? Math.min(+m[2], video.length - 1) : video.length - 1;
  res.writeHead(206, { ...cors, 'content-type': 'video/mp4', 'accept-ranges': 'bytes',
    'content-range': `bytes ${a}-${b}/${video.length}`, 'content-length': b - a + 1 });
  res.end(video.subarray(a, b + 1));
});
const origin = `http://127.0.0.1:${page.address().port}`;
const cdnOrigin = `http://127.0.0.1:${cdn.address().port}`;

let chrome;
try {
  chrome = await launchChrome();
  await chrome.goto(origin);
  const result = await chrome.evaluate(`(async () => {
    const THREE = await import('three');
    const { createReplayPlayer } = await import('/js/replay-player.js');
    const W = 1280, H = 720;
    const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1); renderer.setSize(W, H);
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
    document.body.appendChild(renderer.domElement);
    const gl = renderer.getContext();
    const pixel = () => { const b = new Uint8Array(4); gl.readPixels(W / 2, H / 2, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, b); return [...b.slice(0, 3)]; };
    const colour = (p) => p[0] > 180 && p[1] < 60 && p[2] < 60 ? 'red' : p[1] > 180 && p[0] < 60 && p[2] < 60 ? 'green'
      : p[2] > 180 && p[0] < 60 && p[1] < 60 ? 'blue' : 'other:' + p.join(',');
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const src = '${cdnOrigin}/bundle/media/replays/goal_01.mp4';
    const replays = [{ t: 162.4, dur_s: 3, src, player: 'r2' }];
    const player = createReplayPlayer({ width: W, height: H });
    const out = { h264: player.state().h264 };
    // Drive it like the page: one update per frame on a moving programme clock.
    async function runTo(t0, t1, { window = true, stepMs = 20 } = {}) {
      let on = false;
      const start = performance.now();
      for (;;) {
        const t = t0 + (performance.now() - start) / 1000;
        if (t > t1) return on;
        const w = window && t >= 162.4 && t < 165.4 ? { src, t: 162.4, elapsed: t - 162.4, dur_s: 3 } : null;
        on = player.update({ replays, t, window: w });
        if (on) player.render(renderer);
        await sleep(stepMs);
      }
    }
    // 1. Fetched ahead: at the goal, fifteen seconds before the window.
    player.update({ replays, t: 147.4, window: null });
    out.preloaded = player.state().src === src;
    await sleep(400);
    out.offAirBefore = player.update({ replays, t: 147.8, window: null });
    out.offAirPrimed = await runTo(160.4, 162.39);
    // 2. Into the window: on air within a few frames, red in the first second.
    out.onRed = await runTo(162.4, 162.9);
    out.lateMs = player.state().lateMs;
    out.red = colour(pixel());
    // 3. A late join into the second second: green, by a seek if the file had
    // fallen behind. Where it stood decides whether a seek was owed: on a
    // laptop the clock jump leaves it ~0.7 s behind; a GitHub runner has
    // been seen to arrive within tolerance (seeks 0, and green all the same).
    out.atBeforeJoin = player.state().at;
    out.onGreen = await runTo(163.6, 164.1);
    out.green = colour(pixel());
    out.seeks = player.state().seeks;
    // 4. Keeps pace on its own clock into the third second.
    out.onBlue = await runTo(164.5, 165.3);
    out.blue = colour(pixel());
    // 5. The window closes: off air, paused.
    out.offAfter = !(await runTo(165.5, 165.7));
    out.state = player.state();
    // 6. A file that is not in the bundle never goes on air.
    const missing = createReplayPlayer({ width: W, height: H });
    const gone = [{ t: 10, dur_s: 3, src: '${cdnOrigin}/bundle/media/replays/goal_02.mp4' }];
    let everOn = false;
    for (let i = 0; i < 60; i++) {
      everOn ||= missing.update({ replays: gone, t: 10 + i * 0.02, window: { src: gone[0].src, t: 10, elapsed: i * 0.02, dur_s: 3 } });
      await sleep(20);
    }
    out.missing = { everOn, error: missing.state().error };
    player.dispose(); missing.dispose();
    out.disposed = player.state().src === null;
    return out;
  })()`);
  console.log(JSON.stringify(result));
  assert.ok(result.h264 === 'probably' || result.h264 === 'maybe', `this Chrome decodes H.264 (${result.h264})`);
  assert.equal(result.preloaded, true, 'fetched ahead of the window');
  assert.equal(result.offAirBefore, false, 'not on air before its window');
  assert.equal(result.offAirPrimed, false, 'primed, still not on air');
  assert.equal(result.onRed, true); assert.equal(result.red, 'red', 'first second of the file');
  // Primed just before the window, the cut lands on the file's own first frame.
  assert.ok(result.lateMs !== null && result.lateMs < 250, `first frame at the cut (${result.lateMs} ms)`);
  assert.equal(result.onGreen, true); assert.equal(result.green, 'green', 'a late join seeks');
  // a seek is owed only if the file stood further than the tolerance from
  // where the late join lands (1.2 s into the window)
  const owed = result.atBeforeJoin === null || Math.abs(result.atBeforeJoin - 1.2) > REPLAY_SYNC_TOLERANCE_S;
  assert.ok(!owed || result.seeks >= 1, `a late join that had drifted ${result.atBeforeJoin === null ? '?' : Math.abs(result.atBeforeJoin - 1.2).toFixed(2)} s seeks (seeks ${result.seeks})`);
  assert.equal(result.onBlue, true); assert.equal(result.blue, 'blue', 'plays on');
  assert.equal(result.offAfter, true, 'off air when the window closes');
  assert.equal(result.state.errors, 0);
  assert.equal(result.missing.everOn, false, 'a missing file never goes on air');
  assert.match(result.missing.error || '', /media error|no supported source/);
  assert.equal(result.disposed, true);
  assert.ok(requests.some((p) => p.endsWith('goal_01.mp4')));
  console.log(`PASS replay media cut: cross-origin H.264 into WebGL, pre-fetch at the goal, on air in ${result.lateMs} ms, late-join seek, own-clock playback, off air at window end, missing file stays live`);
} finally {
  await chrome?.close?.();
  page.close(); cdn.close();
}
