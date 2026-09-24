// Offline regression gate; no publisher/venue bundles, git history or network.
// node scripts/broadcast-output-check.mjs
// Pixel oracle: ordinary scorebug rendering versus the optional separated pass.
// This deliberately does NOT prove parity with historical commit 9436234; that
// remains a separate legacy check. All test harness files live in a temp dir.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { serve } from '../lib/static-server.mjs';
import { launchChrome } from '../lib/headless-chrome.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'public/broadcast.html'), 'utf8');
// Extract the complete real function, not a second implementation of its order.
// Fail loudly if its surrounding declarations change rather than silently skip.
const begin = html.indexOf('\nfunction draw() {');
const end = html.indexOf('\nconst ready = boot()', begin);
assert.ok(begin >= 0 && end > begin, 'find the actual broadcast draw()');
const drawSource = html.slice(begin, end).trim();
assert.match(html, /createCleanOutput\(\{\s*source:\s*renderer\.domElement/, 'clean output uses the programme canvas');
assert.match(html, /webglcontextlost[^\n]*cleanOutput\.stop/, 'context loss stops the output');
assert.match(html, /pagehide[^\n]*cleanOutput\.stop/, 'page exit stops the output');
assert.match(html, /renderer\.toneMapping = THREE\.ACESFilmicToneMapping/, 'harness matches broadcast tone mapping');
assert.match(html, /renderer\.toneMappingExposure = 1\.15/, 'harness matches broadcast exposure');

// `withLook`: the broadcast camera (js/broadcast-look.js) composes offscreen
// and finishes onto the canvas BEFORE the scorebug. Both paths must keep one
// camera/match/scene evaluation per draw and every graphic after the scene;
// ?look=0 must keep exactly the order it always had.
function checkDrawOrdering(withLook = false) {
  const events = [];
  const stage = { traverse() {} };
  const look = withLook ? {
    target: { isTarget: true },
    beforeRoots() {},
    update(args) { event('look-update'); assert.equal(args.frame, 271); assert.equal(args.stage, stage); assert.equal(args.focus, 12.5); },
    finish() { event('look-finish'); },
  } : null;
  let enabled = false, current = null, cue = null, snapshot;
  const event = (name) => events.push(name);
  const feed = {};
  const context = vm.createContext({
    frame: 271, simT: 5.42, FPS: 50, wantCam: 'heli', settleUntil: 0,
    renderSerial: 0, leagueAerial: null,
    cameraAt(name, frame) { event('camera'); assert.equal(name, 'heli'); assert.equal(frame, 271); return { camera: 'heli' }; },
    aim() { event('aim'); },
    crowd: { update(t) { event('crowd'); assert.equal(t, 5.42); } },
    renderer: {
      info: { reset() { event('reset'); }, render: {} },
      copyFramebufferToTexture(texture) { assert.equal(texture, feed); event('feed'); },
      getContext: () => ({ getError: () => 0, finish() { event('finish'); } }),
    },
    venues: { afterToneMap() { event('match-stage'); return [stage]; }, module: () => ({ afterToneMap: () => stage }) },
    after: { render(items, options) {
      event('scene'); assert.equal(items.length, 1); assert.equal(items[0], stage);
      if (withLook) { assert.equal(options?.target, look.target); assert.equal(options?.beforeRoots, look.beforeRoots); }
      else assert.equal(options, undefined);
    } },
    look, night: withLook ? { update(lights) { event('night'); assert.equal(lights.length, 0); } } : null,
    scene: { traverse() {} }, camera: {}, floodlights: [], floodlightsAt: -1, focusM: 12.5, wantVenue: 'stadium',
    matchState() { event('match'); return current; },
    postMatchTable: { update(args) { event('table'); assert.equal(args.match, current); assert.equal(args.time, 5.42); return cue; } },
    scorebug: {
      draw(bug, options) { event('bug-draw'); assert.equal(bug, current?.bug ?? null); assert.equal(options.separateLive, enabled); assert.equal(options.compactOnly, !!cue); },
      render() { event('bug-render'); }, renderLive() { event('LIVE'); },
    },
    leagueOverlay: { draw(p) { event('league-draw'); assert.equal(p, cue?.presentation ?? null); }, render() { event('league-render'); } },
    cleanOutput: { get enabled() { return enabled; }, copy(frame) { event('copy'); snapshot = frame; return false; } },
    feedTex: feed, feedMesh: { material: { map: feed } }, feedStat: { copies: 0 },
    errors: ['skip diagnostic text'], fail() { assert.fail('unexpected feed failure'); },
  });
  vm.runInContext(`${drawSource}\nglobalThis.runDraw = draw;`, context, { timeout: 1000 });
  for (const [i, mode] of ['default', 'LIVE', 'REPLAY', 'LIVE', 'null'].entries()) {
    enabled = i > 0;
    current = mode === 'null' ? null : { match: { id: 'offline-match' }, bug: { live: true, replay: mode === 'REPLAY', clock: `12:0${i}`, audioOffset: 0.125 } };
    cue = mode === 'REPLAY' ? { presentation: {}, elapsed: 4 } : null;
    events.length = 0;
    context.runDraw();
    assert.deepEqual(events, [
      'camera', 'aim', 'crowd', 'reset', 'match-stage', ...(withLook ? ['night', 'look-update', 'scene', 'look-finish'] : ['scene']), 'match', 'table',
      'bug-draw', 'bug-render', 'league-draw', ...(cue ? ['league-render'] : []),
      ...(enabled ? ['copy', 'LIVE'] : []), 'feed', 'finish',
    ], `${withLook ? 'look ' : ''}${mode}: one camera/match/scene evaluation, copy before LIVE before feed (even on copy failure)`);
    assert.equal(context.renderSerial, i + 1);
    if (enabled) assert.deepEqual(JSON.parse(JSON.stringify(snapshot)), {
      serial: i + 1, frame: 271, t: 5.42, camera: 'heli', matchId: current?.match?.id ?? null,
      clock: current?.bug.clock ?? null, audioOffset: current?.bug.audioOffset ?? null,
    }, 'copy snapshot uses this draw, not a second clock/match lookup');
  }
  const cleanMethod = html.match(/  cleanOutput\(\) \{[\s\S]*?\n  \},/);
  const frameMethod = html.match(/  frame\(\) \{[^\n]+\},/);
  assert.ok(cleanMethod && frameMethod, 'find actual public output/frame methods');
  let starts = 0;
  const outputHandle = {};
  const apiContext = vm.createContext({
    live: true,
    cleanOutput: { start() { starts++; return outputHandle; } },
    renderer: { domElement: { toDataURL(format) { assert.equal(format, 'image/png'); return 'live-programme'; } } },
  });
  const api = vm.runInContext(`({${cleanMethod[0]}${frameMethod[0]}})`, apiContext, { timeout: 1000 });
  assert.equal(api.cleanOutput(), outputHandle, 'public cleanOutput forwards the actual handle');
  assert.equal(api.frame(), 'live-programme', 'legacy frame API still reads the LIVE-bearing renderer');
  apiContext.live = false;
  assert.throws(() => api.cleanOutput(), /live.*capture=1/, 'capture-mode page cannot opt into live output');
  assert.equal(starts, 1, 'capture-mode guard prevents allocation');
  console.log(`PASS broadcast draw VM${withLook ? ' (broadcast look: offscreen compose, finish before graphics)' : ''}: actual source ordering, one scene/camera/match, serial/clock, copy-failure continuation, public API`);
}

// Runs in Chrome. Its scope also hosts the unmodified broadcast draw function.
async function browserChecks(drawSource) {
  const THREE = await import('three');
  const { createScorebug } = await import('/js/scorebug.js');
  const { createCleanOutput } = await import('/js/broadcast-output.mjs');
  const { createLeagueOverlay } = await import('/js/league-overlay.js');
  const W = 1280, H = 720, FPS = 50;
  const results = [];
  const ok = (value, message) => { if (!value) throw new Error(message); };
  const eq = (a, b, message) => ok(JSON.stringify(a) === JSON.stringify(b), `${message}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
  const throws = (fn, pattern, message) => {
    let error;
    try { fn(); } catch (e) { error = e; }
    ok(error && pattern.test(String(error)), `${message}: ${error || 'did not throw'}`);
  };
  const reject = async (promise, pattern, message) => {
    let error;
    try { await promise; } catch (e) { error = e; }
    ok(error && pattern.test(String(error)), `${message}: ${error || 'did not reject'}`);
  };
  const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.info.autoReset = false;
  document.body.appendChild(renderer.domElement);
  const background = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  // Spatial detail under the LIVE panel catches a black/solid replacement patch.
  const bgGeometry = new THREE.PlaneGeometry(2, 2);
  const bgMaterial = new THREE.ShaderMaterial({
    uniforms: { phase: { value: 0 } },
    vertexShader: 'varying vec2 uvTest; void main(){uvTest=uv;gl_Position=vec4(position.xy,0.,1.);}',
    fragmentShader: `uniform float phase; varying vec2 uvTest;
      void main(){vec2 p=uvTest; gl_FragColor=vec4(.15+.7*p.x,.1+.5*p.y,.3+.2*sin(p.x*180.+p.y*120.+phase),1.);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      }`,
    depthTest: false, depthWrite: false,
  });
  background.add(new THREE.Mesh(bgGeometry, bgMaterial));
  const scorebug = createScorebug({ width: W, height: H, crests: null });
  const ordinary = createScorebug({ width: W, height: H, crests: null });
  const leagueOverlay = createLeagueOverlay({ width: W, height: H, crestFor: () => null });
  const home = { code: 'SYA', name: 'Synthetic Athletic', color: [.8, .1, .2] };
  const away = { code: 'SGU', name: 'Singularity United', color: [.3, .7, .9] };
  const presentation = {
    matchId: 'offline-match', season: 3, label: 'OFFLINE TEST', home, away, score: [3, 1],
    rows: [home, away].map((team, i) => ({ ...team, position: i + 1, previousPosition: 2 - i,
      played: 8, previousPlayed: 7, gd: 3 - i * 5, previousGd: 1 - i,
      points: 18 - i * 3, previousPoints: 15 - i * 3 })),
  };
  const baseBug = { home, away, a: 3, b: 1, clock: '67:42', tag: '2nd Half', live: true, replay: false, audioOffset: .125 };
  const failures = [], nativeCaptures = [];
  let canvasAllocations = 0, sourceCopies = 0, captures = 0, wrongSourceCopies = 0, failContext = null;
  const createElement = document.createElement;
  const drawImage = CanvasRenderingContext2D.prototype.drawImage;
  const captureStream = HTMLCanvasElement.prototype.captureStream;
  ok(typeof captureStream === 'function', 'native canvas captureStream is supported');
  document.createElement = function (tag, ...args) {
    if (String(tag).toLowerCase() === 'canvas') canvasAllocations++;
    return createElement.call(this, tag, ...args);
  };
  CanvasRenderingContext2D.prototype.drawImage = function (source, ...args) {
    if (this === failContext) throw new Error('injected copy error');
    if (source === renderer.domElement) sourceCopies++;
    else wrongSourceCopies++;
    return drawImage.call(this, source, ...args);
  };
  HTMLCanvasElement.prototype.captureStream = function (...args) {
    captures++;
    nativeCaptures.push({ canvas: this, fps: args[0] });
    return captureStream.apply(this, args);
  };
  const cleanOutput = createCleanOutput({ source: renderer.domElement, onError: (message) => failures.push(message) });
  let frame = 0, simT = 0, renderSerial = 0, leagueAerial = null, currentBug = baseBug, tableCue = null;
  const wantCam = 'heli', settleUntil = 0, crowd = null, feedTex = null, feedMesh = null;
  const errors = ['skip diagnostic text'];
  const fail = (where, message) => failures.push(`${where}: ${message}`);
  const after = { render() { bgMaterial.uniforms.phase.value = frame * .13; renderer.render(background, camera); } };
  const venues = { afterToneMap: () => [] };
  // The canvas-direct path: this pixel oracle is about the graphics drawn
  // AFTER the scene, which both paths share (see checkDrawOrdering(true)).
  const look = null;
  const cameraAt = () => ({ camera: 'heli' });
  const aim = () => {};
  const matchState = () => currentBug ? { match: { id: 'offline-match' }, bug: currentBug } : null;
  const postMatchTable = { update: () => tableCue };
  // Direct eval deliberately binds the REAL draw to real WebGL/scorebug/output
  // objects and small deterministic world stubs. No publisher boot/network.
  const programmeDraw = eval(`(${drawSource})`);
  const pixels = () => {
    const gl = renderer.getContext(), raw = new Uint8Array(W * H * 4), top = new Uint8Array(raw.length);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, raw);
    for (let y = 0; y < H; y++) top.set(raw.subarray((H - y - 1) * W * 4, (H - y) * W * 4), y * W * 4);
    return top;
  };
  const cleanPixels = (handle) => handle.canvas.getContext('2d').getImageData(0, 0, W, H).data;
  // Includes a two-pixel linear-filter/antialias fringe; top-left coordinates.
  const liveBounds = { x0: Math.floor((854 - 12 - 66) * W / 854) - 2, x1: Math.ceil((854 - 12) * W / 854) + 2,
    y0: Math.floor(8 * W / 854) - 2, y1: Math.ceil(34 * W / 854) + 2 };
  const compare = (a, b, message, allowLive = false) => {
    eq(a.length, b.length, `${message} lengths`);
    let differences = 0;
    for (let i = 0; i < a.length; i++) {
      if (a[i] === b[i]) continue;
      const p = Math.floor(i / 4), x = p % W, y = Math.floor(p / W);
      if (!allowLive || x < liveBounds.x0 || x >= liveBounds.x1 || y < liveBounds.y0 || y >= liveBounds.y1) {
        throw new Error(`${message}: byte (${x},${y},${i % 4}) ${a[i]} != ${b[i]}`);
      }
      differences++;
    }
    return differences;
  };
  const regionDiffers = (a, b, [x0, y0, x1, y1]) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) for (let c = 0; c < 3; c++) {
      const i = (y * W + x) * 4 + c;
      if (a[i] !== b[i]) return true;
    }
    return false;
  };
  const reference = (bug) => {
    after.render(); ordinary.draw(bug, { compactOnly: !!tableCue }); ordinary.render(renderer);
    leagueOverlay.draw(tableCue?.presentation ?? null, tableCue?.elapsed ?? 0);
    if (tableCue) leagueOverlay.render(renderer);
    return pixels();
  };
  let handle;
  try {
    eq(canvasAllocations, 0, 'constructing disabled output allocates nothing');
    eq(cleanOutput.enabled, false, 'output disabled by default');
    eq(cleanOutput.copy({ serial: -1 }), false, 'disabled copy is a no-op');
    for (const bug of [baseBug, { ...baseBug, replay: true }, baseBug, null]) {
      currentBug = bug; programmeDraw();
    }
    eq([canvasAllocations, sourceCopies, captures], [0, 0, 0], 'default draw has no clean canvas, extra graphics, copies or streams');
    const staleFrame = pixels();
    handle = cleanOutput.start();
    eq(canvasAllocations, 1, 'start allocates only the detached clean canvas');
    ok(handle.canvas !== renderer.domElement && !handle.canvas.isConnected, 'output is a detached second surface, not another renderer');
    ok(cleanOutput.start() === handle, 'repeated start returns the same handle');
    eq([handle.canvas.width, handle.canvas.height], [W, H], 'native drawing-buffer dimensions');
    eq([handle.state().copies, handle.state().frame, sourceCopies, captures], [0, null, 0, 0], 'start does not copy/render/capture a stale frame');
    let readyResolved = false;
    handle.ready.then(() => { readyResolved = true; });
    await Promise.resolve();
    ok(!readyResolved, 'ready waits for the first programme draw');
    throws(() => handle.captureStream(), /ready/i, 'cannot capture before ready');
    eq(captures, 0, 'unready capture never calls native captureStream');

    const cases = [
      ['LIVE', baseBug, null], ['REPLAY', { ...baseBug, replay: true }, null],
      ['LIVE again', baseBug, null], ['null', null, null],
      ['not live', { ...baseBug, live: false, clock: '90:00', tag: 'Full Time' }, null],
      ['goal banner', { ...baseBug, a: 4, clock: '68:03', tag: 'GOAL!' }, null],
      ['compact + league', { ...baseBug, clock: '90:00', tag: 'Full Time' }, { presentation, elapsed: 5 }],
      ['replay + league', { ...baseBug, replay: true }, { presentation, elapsed: 2.4 }],
      ['LIVE + fading league', baseBug, { presentation, elapsed: 53.7 }],
      ['null after league', null, null],
    ];
    for (const [name, bug, cue] of cases) {
      currentBug = bug; tableCue = cue; frame += 17; simT = frame / FPS;
      programmeDraw();
      const live = pixels(), clean = cleanPixels(handle);
      const isLive = !!(bug?.live && !bug.replay);
      const differences = compare(live, clean, `${name}: output bytes outside LIVE`, isLive);
      if (isLive) ok(differences > 100, `${name}: live badge actually present and excluded from clean`);
      compare(live, reference(bug), `${name}: optional output preserves ordinary live framebuffer`);
      compare(clean, reference(bug ? { ...bug, live: false } : null), `${name}: clean is the real background, not a patch`);
      if (!bug && !cue) {
        // Independent oracle: null must not replay an old scorebug texture.
        // Linux's accelerated cleared-canvas upload retained old pixels here.
        after.render();
        compare(live, pixels(), `${name}: no bug means exactly the world framebuffer`);
      }
      const status = handle.state();
      eq(status.frame, { serial: renderSerial, frame, t: simT, camera: 'heli', matchId: bug ? 'offline-match' : null,
        clock: bug?.clock ?? null, audioOffset: bug?.audioOffset ?? null }, `${name}: same draw metadata`);
      eq(status.copies, sourceCopies, 'exactly one native drawImage of the programme canvas per draw');
      eq(renderer.autoClear, true, 'renderer autoClear restored');
      eq(renderer.getContext().getError(), 0, `${name}: no WebGL error`);
      if (name === 'LIVE') {
        const first = await handle.ready;
        eq(first.frame, status.frame, 'ready resolves with first copied frame metadata');
        eq(first.copies, 1, 'ready is first normal draw, not prior frame');
        ok(regionDiffers(staleFrame, clean, [0, 0, W, H]), 'first output is not the stale pre-start frame');
      }
    }
    eq(wrongSourceCopies, 0, 'no duplicate draw canvas or alternate source is copied');
    eq(canvasAllocations, 1, 'only clean surface allocated; both scorebug passes share the original canvas');
    results.push('10 byte-exact WebGL cases: LIVE→REPLAY→LIVE→null, score/clock/banners, compact/league/fade, nonuniform background');

    // Keep the background and time fixed, so these changes cannot be attributed
    // to the synthetic world instead of the shared score graphics.
    tableCue = null; currentBug = baseBug; programmeDraw();
    const before = cleanPixels(handle);
    for (const [name, patch, region] of [
      ['score', { a: 8, b: 7 }, [15, 12, 576, 57]],
      ['clock', { clock: '88:59' }, [15, 12, 576, 57]],
      ['banner', { tag: 'GOAL!' }, [15, 12, 576, 57]],
      ['lower scores', { a: 8, b: 7 }, [320, 650, 960, 710]],
    ]) {
      currentBug = { ...baseBug, ...patch }; programmeDraw();
      ok(regionDiffers(before, cleanPixels(handle), region), `${name} updates reach clean graphic`);
    }
    eq(captures, 0, 'draws and readiness do not auto-start streams');
    for (const fps of [0, -1, 61, NaN, Infinity, '50', null]) {
      throws(() => handle.captureStream(fps), /fps/i, `invalid fps ${fps}`);
    }
    eq(captures, 0, 'invalid fps never reaches native capture');
    const streams = [handle.captureStream(), handle.captureStream(24), handle.captureStream(60)];
    for (const stream of streams) {
      ok(stream instanceof MediaStream, 'capture returns native MediaStream');
      eq([stream.getVideoTracks().length, stream.getAudioTracks().length], [1, 0], 'video only, no implicit microphone');
      eq(stream.getVideoTracks()[0].readyState, 'live', 'native track is live');
    }
    eq(captures, 3, 'explicit captures alone call native captureStream');
    ok(nativeCaptures.every((c) => c.canvas === handle.canvas), 'native capture samples only the clean canvas');
    eq(nativeCaptures.map((c) => c.fps), [50, 24, 60], 'native capture fps/default passed through unchanged');
    // A live track alone is not proof that an encoder can receive frames.
    // Consume the actual detached canvas stream through a native video decoder.
    const video = document.createElement('video');
    video.muted = true; video.srcObject = streams[0];
    let delivered = 0, timer, timeout;
    try {
      const frames = new Promise((resolve, reject) => {
        timeout = setTimeout(() => reject(new Error('clean stream delivered no video frames')), 10000);
        const next = () => video.requestVideoFrameCallback(() => {
          if (++delivered >= 3) resolve(); else next();
        });
        next();
      });
      timer = setInterval(() => { frame++; simT = frame / FPS; programmeDraw(); }, 40);
      await video.play(); await frames;
      eq([video.videoWidth, video.videoHeight], [W, H], 'native stream delivers full-size video frames');
    } finally { clearInterval(timer); clearTimeout(timeout); video.pause(); video.srcObject = null; }
    results.push('native clean captureStream delivers three video frames at 1280×720');
    const snapshot = handle.state(); snapshot.frame.serial = -100; snapshot.copies = -100;
    ok(handle.state().frame.serial !== -100 && handle.state().copies > 0, 'state returns defensive frame snapshots');
    const old = handle;
    const texturesBeforeStop = renderer.info.memory.textures;
    old.stop(); old.stop();
    eq(renderer.info.memory.textures, texturesBeforeStop, 'stop does not dispose the shared scorebug texture');
    eq([old.canvas.width, old.canvas.height, old.state().active, cleanOutput.enabled], [0, 0, false, false], 'stop is idempotent and releases backing store');
    for (const stream of streams) for (const track of stream.getTracks()) eq(track.readyState, 'ended', 'stop ends every native track');
    throws(() => old.captureStream(), /stopped/i, 'stopped output cannot capture');
    programmeDraw();
    eq(renderer.info.memory.textures, texturesBeforeStop, 'stop and ordinary draw retain the same scorebug texture');
    handle = cleanOutput.start();
    ok(handle !== old && handle.canvas !== old.canvas, 'restart creates a fresh handle and canvas');
    old.stop();
    ok(handle.state().active && cleanOutput.enabled, 'old handle stop cannot stop the restarted output');
    eq(handle.state().copies, 0, 'restart does not inherit readiness');
    programmeDraw(); await handle.ready;
    compare(cleanPixels(handle), reference({ ...currentBug, live: false }), 'restarted first frame is current');
    handle.stop();
    handle = cleanOutput.start(); handle.stop();
    await reject(handle.ready, /stopped before.*first frame/i, 'stop before first frame rejects readiness');
    results.push('lazy allocation, same source, readiness, native video-only streams/fps validation, stop/restart/old handles');

    // Inject a failure in the optional 2D copy, not in scene rendering.
    handle = cleanOutput.start(); programmeDraw(); await handle.ready;
    const failedStream = handle.captureStream(30);
    failContext = handle.canvas.getContext('2d');
    const previousSerial = renderSerial;
    programmeDraw();
    failContext = null;
    eq(renderSerial, previousSerial + 1, 'copy exception does not interrupt programme draw');
    eq([cleanOutput.enabled, handle.state().active, handle.canvas.width, handle.canvas.height], [false, false, 0, 0], 'copy failure closes and releases output');
    eq(failedStream.getVideoTracks()[0].readyState, 'ended', 'copy failure stops tracks');
    ok(/injected copy error/.test(handle.state().error), 'copy error is exposed in state');
    compare(pixels(), reference(currentBug), 'copy failure still renders the ordinary LIVE programme');
    programmeDraw();
    compare(pixels(), reference(currentBug), 'next frame renders normally with failed output disabled');
    handle = cleanOutput.start();
    failContext = handle.canvas.getContext('2d'); programmeDraw(); failContext = null;
    await reject(handle.ready, /injected copy error/, 'first-frame failure rejects readiness');
    handle = cleanOutput.start(); handle.canvas.width -= 1; programmeDraw();
    await reject(handle.ready, /dimensions changed/, 'size mismatch fails closed, never rescales silently');
    eq(failures.length, 3, 'one error report per failed output');
    eq(renderer.getContext().getError(), 0, 'copy failures do not poison WebGL');

    // A failed clean-canvas allocation throws before activation. It must not
    // mutate the original combined scorebug or interrupt subsequent draws.
    programmeDraw();
    const beforeFailedStart = pixels(), stateBeforeFailedStart = cleanOutput.state();
    const nativeContext = HTMLCanvasElement.prototype.getContext;
    try {
      HTMLCanvasElement.prototype.getContext = function(type, ...args) {
        if (type === '2d') return null;
        return nativeContext.call(this, type, ...args);
      };
      throws(() => cleanOutput.start(), /requires.*2D canvas context/i, 'failed clean allocation throws synchronously');
    } finally { HTMLCanvasElement.prototype.getContext = nativeContext; }
    eq(cleanOutput.enabled, false, 'failed clean allocation never activates output');
    eq(cleanOutput.state(), stateBeforeFailedStart, 'failed clean allocation leaves output state unchanged');
    compare(pixels(), beforeFailedStart, 'failed clean allocation leaves main framebuffer untouched');
    programmeDraw();
    compare(pixels(), reference(currentBug), 'failed clean allocation preserves ordinary LIVE on next draw');
    eq(failures.length, 3, 'synchronous allocation failure does not report an active-output copy failure');

    // Opting in/out only changes pass selection, not the combined canvas/key.
    currentBug = baseBug; scorebug.draw(currentBug);
    eq(scorebug.draw(currentBug, { separateLive: true }), false, 'separating LIVE does not repaint the original combined texture');
    eq(scorebug.draw(currentBug), false, 'recombining LIVE does not repaint the original combined texture');
    scorebug.draw(currentBug, { separateLive: true });
    // Check successful real draws with both enabled and disabled preexisting
    // scissors, including rectangles that partly intersect or exclude LIVE.
    const scissorBoxes = [[7, 9, W - 14, H - 18], [W - 140, H - 60, 100, 50], [11, 12, 150, 100]];
    for (const scissorTest of [false, true]) for (const box of scissorBoxes) {
      renderer.setScissorTest(false); after.render();
      renderer.setScissor(...box); renderer.setScissorTest(scissorTest);
      for (const method of ['render', 'renderLive']) {
        scorebug[method](renderer);
        eq(renderer.getScissor(new THREE.Vector4()).toArray(), box, `${method}: real preexisting scissor box restored`);
        eq(renderer.getScissorTest(), scissorTest, `${method}: real preexisting scissor enable restored`);
        eq(renderer.autoClear, true, `${method}: real autoClear restored`);
      }
      const separated = pixels();
      renderer.setScissorTest(false); after.render();
      renderer.setScissor(...box); renderer.setScissorTest(scissorTest);
      ordinary.draw(currentBug); ordinary.render(renderer);
      compare(separated, pixels(), `preexisting scissor ${scissorTest}/${box}: byte-exact ordinary parity`);
      eq(renderer.getContext().getError(), 0, 'preexisting scissor draws do not poison WebGL');
    }
    renderer.setScissorTest(false); renderer.setScissor(0, 0, W, H);

    for (const autoClear of [true, false]) for (const scissorTest of [true, false]) for (const method of ['render', 'renderLive']) {
      const initialScissor = new THREE.Vector4(3, 5, W - 6, H - 10);
      const scissor = initialScissor.clone();
      let enabled = scissorTest;
      const r = {
        autoClear,
        getScissor(target) { return target.copy(scissor); },
        getScissorTest() { return enabled; },
        setScissor(x, y, width, height) {
          if (x?.isVector4) scissor.copy(x); else scissor.set(x, y, width, height);
        },
        setScissorTest(value) { enabled = value; },
        render() {
          eq(this.autoClear, false, `${method}: does not clear before overlay`);
          eq(enabled, true, `${method}: scissor active during overlay`);
          throw new Error('injected render error');
        },
      };
      throws(() => scorebug[method](r), /injected render error/, `${method}: exception propagated`);
      eq(r.autoClear, autoClear, `${method}: renderer autoClear restored on throw`);
      eq(scissor.toArray(), initialScissor.toArray(), `${method}: preexisting scissor box restored on throw`);
      eq(enabled, scissorTest, `${method}: preexisting scissor enable restored on throw`);
    }
    leagueOverlay.draw(presentation, 5);
    for (const autoClear of [true, false]) {
      const r = { autoClear, render() { throw new Error('injected league render'); } };
      throws(() => leagueOverlay.render(r), /injected league render/, 'league exception propagated');
      eq(r.autoClear, autoClear, 'league renderer flags restored on throw');
    }
    // Observe real Three disposal: both passes share the original texture,
    // material and geometry, without replacing the renderer itself.
    const disposed = { textures: new Set(), materials: new Set(), geometries: new Set() };
    const prototypes = [[THREE.Texture.prototype, 'textures'], [THREE.Material.prototype, 'materials'], [THREE.BufferGeometry.prototype, 'geometries']];
    const originals = prototypes.map(([p]) => p.dispose);
    try {
      prototypes.forEach(([p, key], i) => { p.dispose = function () { disposed[key].add(this.uuid); return originals[i].call(this); }; });
      scorebug.dispose();
      eq([disposed.textures.size, disposed.materials.size, disposed.geometries.size], [1, 1, 1], 'dispose releases the single shared texture, material and geometry');
    } finally { prototypes.forEach(([p], i) => { p.dispose = originals[i]; }); }
    eq(scorebug.crests.manifest, 'off', 'scorebugs never fetch crests');
    eq(ordinary.crests.manifest, 'off', 'reference scorebug never fetches crests');
    results.push('copy/resize/allocation failures preserve renderer; byte-exact preexisting scissor parity and thrown-state restoration; single-graphic disposal');
    return { results, width: W, height: H, toneMapping: 'ACESFilmic 1.15', cases: cases.length };
  } finally {
    failContext = null;
    cleanOutput.stop();
    document.createElement = createElement;
    CanvasRenderingContext2D.prototype.drawImage = drawImage;
    HTMLCanvasElement.prototype.captureStream = captureStream;
    scorebug.dispose(); ordinary.dispose(); leagueOverlay.dispose();
    bgGeometry.dispose(); bgMaterial.dispose(); renderer.dispose(); renderer.forceContextLoss();
  }
}

checkDrawOrdering();
checkDrawOrdering(true);
const temp = mkdtempSync(join(tmpdir(), 'otra-broadcast-output-'));
let chrome, server;
const cleanupTemp = () => rmSync(temp, { recursive: true, force: true });
// launchChrome handles Chrome profiles/processes on signals; this covers our
// separate temp harness too, including process.exit from its signal handlers.
process.once('exit', cleanupTemp);
try {
  writeFileSync(join(temp, 'index.html'), `<!doctype html><html><head><meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; connect-src 'self'; img-src 'self' data:; style-src 'unsafe-inline'">
    <link rel="icon" href="data:,">
    <script type="importmap">{"imports":{"three":"/vendor/three/three.module.js"}}</script>
    </head><body><script type="module">
    window.checkPromise = (${browserChecks.toString()})(${JSON.stringify(drawSource)});
    window.checkPromise.catch(() => {});
    </script></body></html>`);
  let origin;
  ({ server, origin } = await serve(join(root, 'public'), {
    mounts: { '/__broadcast_output/': (rel) => rel === 'index.html' ? join(temp, rel) : null },
  }));
  chrome = await launchChrome({ width: 1280, height: 720, args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'] });
  const errors = [];
  chrome.onConsole((type, text) => { if (type === 'error') errors.push(text); });
  await chrome.send('Network.enable');
  await chrome.send('Network.setBlockedURLs', { urls: ['https://*', 'http://*.rfl.*'] });
  await chrome.goto(`${origin}/__broadcast_output/index.html`);
  assert.equal(await chrome.evaluate('!!window.checkPromise'), true, 'offline module harness initialized');
  const result = await chrome.evaluate('window.checkPromise', { timeoutMs: 120000 });
  assert.deepEqual(errors, [], 'no browser exceptions, asset or network errors');
  for (const message of result.results) console.log(`PASS ${message}`);
  console.log(`PASS broadcast clean output: ${result.width}×${result.height}, ${result.toneMapping}; temporary harness cleaned on exit`);
  console.log('NOTE: ordinary-vs-separated parity only; historical 9436234 parity and publisher/audio integration are separate checks.');
} finally {
  try { if (chrome) await chrome.close(); }
  finally {
    try { if (server) await new Promise((r) => server.close(r)); }
    finally { cleanupTemp(); process.off('exit', cleanupTemp); }
  }
}
