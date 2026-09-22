// Real WebGL regression gate for the visitor's INTERNAL stadium television.
// node scripts/stadium-screen-check.mjs [--smoke]
// No SDK, match bundle, public file mutation, or golden image from this code.
// Readbacks below are TEST ORACLES ONLY, never a production screen transport.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '../lib/static-server.mjs';
import { launchChrome } from '../lib/headless-chrome.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'qa-out/stadium-screen');
const temp = mkdtempSync(join(tmpdir(), 'otra-stadium-screen-'));
const results = [], notes = [];
let chrome, server;

async function browserChecks() {
  const THREE = await import('three');
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const { DRACOLoader } = await import('three/addons/loaders/DRACOLoader.js');
  const { RenderPass } = await import('three/addons/postprocessing/RenderPass.js');
  const { UnrealBloomPass } = await import('three/addons/postprocessing/UnrealBloomPass.js');
  const { OutputPass } = await import('three/addons/postprocessing/OutputPass.js');
  const { createStadiumBroadcast, screenMesh, aimBroadcastCamera } = await import('/js/broadcast-screen.js');
  const { createAfterToneMap } = await import('/js/after-tonemap.js');
  const { createBroadcastProgramme } = await import('/js/broadcast-programme.js');
  const { createScorebug } = await import('/js/scorebug.js');
  const { createLeagueOverlay } = await import('/js/league-overlay.js');
  const rows = [], evidence = [];
  const check = (name, ok, detail = '') => rows.push({ name, ok: !!ok, detail });
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const nativeFetch = window.fetch.bind(window);
  const requests = [];
  // A complete, independently hand-calculated two-club season. No relaxed
  // validator, fake tableController, or production fallback is involved.
  const teams = [{ slug: 'alpha', code: 'ALP', name: 'Alpha FC', color: '#bf2030' },
    { slug: 'beta', code: 'BET', name: 'Beta FC', color: '#207fdf' }];
  const archive = { generated_at: '2026-01-02T00:00:00Z', current_season: 9, seasons: [{
    season: 9, preseason: false, teams, total_matches: 1, aired_count: 1, skipped_count: 0,
    matches: [{ n: 1, home: 'alpha', away: 'beta', home_code: 'ALP', away_code: 'BET', score: [3, 1], status: 'aired',
      aired_at: '2026-01-01T12:00:00Z', watch: { id: 's9-m1_alpha_beta' } }],
    table: [{ ...teams[0], P: 1, W: 1, D: 0, L: 0, GF: 3, GA: 1, GD: 2, Pts: 3, pos: 1 },
      { ...teams[1], P: 1, W: 0, D: 0, L: 1, GF: 1, GA: 3, GD: -2, Pts: 0, pos: 2 }],
  }] };
  // The real director still parses/resolves its fetched JSON. This fixed heli
  // cut also exercises the real post-match slot rather than injecting a cue.
  const cut = { fps: 50, loop: true, segments: [{ frames: [0, 2250], camera: 'heli', seed: 11,
    params: { radius_m: 10, height_m: 2, period_s: 1e15, turbulence: 0, bank: 0, vfov_deg: 50 } }] };
  let failTracks = false, holdTracks = false, releaseTracks = [];
  window.fetch = async (input, options) => {
    const u = new URL(typeof input === 'string' ? input : input.url, location.href);
    requests.push(u.href);
    if (/\/broadcast\/(live|match|preroll)-cutlist\.json$/.test(u.pathname)) {
      if (holdTracks) await new Promise(r => releaseTracks.push(r));
      return new Response(JSON.stringify(cut), { status: failTracks ? 503 : 200 });
    }
    if (u.hostname === 'raw.githubusercontent.com' && u.pathname.endsWith('/site.json')) return Response.json(archive);
    if (u.pathname === '/broadcast/crests.json') return Response.json({ crests: {} });
    if (u.origin !== location.origin) throw Error(`unexpected external request: ${u.href}`);
    return nativeFetch(input, options);
  };
  const decoder = new DRACOLoader().setDecoderPath('/vendor/three/jsm/libs/draco/gltf/');
  const gltf = await new GLTFLoader().setDRACOLoader(decoder).loadAsync('/venues/stadium/venue.glb');
  const authored = screenMesh(gltf.scene.getObjectByName('screen_main'));
  if (!authored) throw Error('actual stadium screen_main mesh missing');
  const vertex = 'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}';
  const vs = new THREE.Vector2();
  function pixels(renderer, w, h) {
    const gl = renderer.getContext(), data = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, data);
    return data;
  }
  function diff(a, b, w, h, flip = false, region = [0, 0, 1, 1]) {
    let sum = 0, max = 0, changed = 0, count = 0;
    const [x0, y0, x1, y1] = region;
    for (let y = Math.ceil(y0 * h); y < Math.floor(y1 * h); y++) for (let x = Math.ceil(x0 * w); x < Math.floor(x1 * w); x++) {
      const i = (y * w + x) * 4, j = ((flip ? h - y - 1 : y) * w + x) * 4;
      for (let c = 0; c < 3; c++) { const d = Math.abs(a[i + c] - b[j + c]); sum += d; max = Math.max(max, d); changed += d > 2 ? 1 : 0; count++; }
    }
    return { mean: +(sum / count).toFixed(4), max, changed: +(changed / count).toFixed(6) };
  }
  const disposeAfter = a => { for (const p of a.composer.passes) p.dispose?.(); a.dispose(); };
  function pipeline(renderer, scene, camera, width, height) {
    const a = createAfterToneMap({ renderer, camera });
    a.composer.setPixelRatio(1); a.composer.setSize(width, height);
    a.composer.addPass(new RenderPass(scene, camera));
    a.composer.addPass(new UnrealBloomPass(new THREE.Vector2(width, height), .12, .3, 1));
    a.composer.addPass(new OutputPass());
    return a;
  }
  for (const cfg of [{ dpr: 1, css: [1280, 720] }, { dpr: 2, css: [800, 500] }, { dpr: 1, css: [512, 320] }, { dpr: 2, css: [256, 160] }]) {
    const label = `DPR${cfg.dpr} ${cfg.css.join('x')}`;
    const test = (name, ok, detail) => check(`${label}: ${name}`, ok, detail);
    const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
    renderer.setPixelRatio(cfg.dpr); renderer.setSize(...cfg.css);
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15; renderer.info.autoReset = false;
    document.body.appendChild(renderer.domElement);
    const gl = renderer.getContext();
    const size = renderer.getDrawingBufferSize(vs).clone(), scale = Math.min(1, size.x / 1280, size.y / 720);
    const w = Math.max(1, Math.floor(1280 * scale)), h = Math.max(1, Math.floor(720 * scale));
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#25405b');
    const venueRoot = new THREE.Group(); venueRoot.position.set(13, 4, -7); venueRoot.rotation.y = .23; scene.add(venueRoot);
    const mesh = new THREE.Mesh(authored.geometry.clone(), new THREE.MeshBasicMaterial({ color: 'magenta' }));
    mesh.name = 'actual-authored-screen'; venueRoot.add(mesh);
    const original = mesh.material;
    const refCamera = new THREE.PerspectiveCamera(50, 16 / 9, .1, 220);
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, 220);
    const programme = await createBroadcastProgramme({ venue: {} });
    let current = { state: null }, fault = null, moduleCalls = 0, rootsCalls = 0;
    const bug = { home: { ...teams[0], color: [.75, .12, .19] }, away: { ...teams[1], color: [.12, .5, .87] },
      a: 3, b: 1, clock: '45:00', tag: '2H', live: true, inPlay: true, t: 100 };
    const now = Date.parse('2026-01-02T00:00:00Z');
    aimBroadcastCamera(refCamera, venueRoot, programme.evaluate({ nowMs: now }).camera);
    // One existing synthetic display-referred stage, with unmistakable corners,
    // a gradient and narrow edge stripes to detect clipping, flipping and black.
    const stage = new THREE.Group(); stage.name = 'existing-match-stage'; scene.add(stage);
    const pattern = new THREE.Mesh(new THREE.PlaneGeometry(30, 20), new THREE.ShaderMaterial({ vertexShader: vertex,
      fragmentShader: 'varying vec2 vUv;void main(){vec2 p=vUv;vec3 c=p.y>.5?(p.x<.5?vec3(.88,.08,.12):vec3(.12,.78,.21)):(p.x<.5?vec3(.09,.21,.91):vec3(.9,.73,.06));c*=.75+.25*p.x;gl_FragColor=vec4(c,1.);}', toneMapped: false }));
    pattern.position.copy(refCamera.position).add(refCamera.getWorldDirection(new THREE.Vector3()).multiplyScalar(7));
    pattern.quaternion.copy(refCamera.quaternion); stage.add(pattern);
    const avatar = new THREE.Group(), head = new THREE.Mesh(new THREE.BoxGeometry(.5, .5, .5), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
    const body = head.clone(); avatar.add(head, body); scene.add(avatar);
    avatar.position.copy(refCamera.position).add(refCamera.getWorldDirection(new THREE.Vector3()).multiplyScalar(5));
    avatar.visible = false; head.visible = false; body.visible = true;
    const player = { avatar: { group: avatar, firstPersonParts: [head, body] } };
    let avatarDuring = null;
    head.onBeforeRender = () => { avatarDuring = [avatar.visible, head.visible, body.visible]; };
    const module = () => { moduleCalls++; if (fault === 'module') throw Error('injected module failure'); return current; };
    const roots = () => { rootsCalls++; if (fault === 'roots') throw Error('injected roots failure'); return [stage, mesh]; };
    const nativeRender = renderer.render.bind(renderer), nativeCopy = renderer.copyFramebufferToTexture.bind(renderer);
    const nativeRAF = window.requestAnimationFrame, nativeInterval = window.setInterval, nativeTimeout = window.setTimeout;
    let rafCalls = 0, intervalCalls = 0, loopCalls = 0, copies = 0, capture = null, copyCamera = null;
    const timeouts = [];
    window.setTimeout = (fn, delay, ...a) => { timeouts.push(delay); return nativeTimeout(fn, delay, ...a); };
    window.requestAnimationFrame = (...a) => { rafCalls++; return nativeRAF(...a); };
    window.setInterval = (...a) => { intervalCalls++; return nativeInterval(...a); };
    const nativeLoop = renderer.setAnimationLoop.bind(renderer);
    renderer.setAnimationLoop = (...a) => { loopCalls++; return nativeLoop(...a); };
    const draws = [];
    renderer.render = (s, c) => { draws.push({ scene: s === scene, stage: s === stage, main: c === camera });
      if (s === scene && c !== camera) copyCamera = c;
      if (fault === 'render') throw Error('injected render failure'); return nativeRender(s, c); };
    renderer.copyFramebufferToTexture = (...a) => { copies++; capture = pixels(renderer, w, h);
      if (fault === 'copy') throw Error('injected copy failure'); return nativeCopy(...a); };
    const create = () => createStadiumBroadcast({ renderer, scene, venue: {}, root: venueRoot, mesh, module, roots, player, log: { warn() {} } });
    const archiveRequestsBefore = requests.filter(u => u.endsWith('/site.json')).length;
    const feed = create();
    test('not-ready render does no work', feed.render(0, now) === false && copies === 0 && moduleCalls === 0);
    await feed.ready;
    test('ready and bounded texture size', feed.state().ready && feed.state().width === w && feed.state().height === h, feed.state());
    test('idle programme never fetches archive', requests.filter(u => u.endsWith('/site.json')).length === archiveRequestsBefore);
    const oracle = pipeline(renderer, scene, refCamera, w, h), score = createScorebug({ width: 1280, height: 720 });
    const league = createLeagueOverlay({ width: 1280, height: 720, crestFor: t => score.crestFor(t) });
    const main = pipeline(renderer, scene, camera, w, h);
    // A camera square-on to the AUTHORED GLB geometry, not a surrogate Plane
    // whose UV convention could hide an upside-down real stadium screen.
    mesh.geometry.computeBoundingBox(); venueRoot.updateMatrixWorld(true);
    const box = mesh.geometry.boundingBox, centre = box.getCenter(new THREE.Vector3()).applyMatrix4(mesh.matrixWorld);
    const normal = new THREE.Vector3().fromBufferAttribute(mesh.geometry.attributes.normal, 0).transformDirection(mesh.matrixWorld);
    camera.position.copy(centre).addScaledVector(normal, 10); camera.lookAt(centre); camera.updateMatrixWorld(true);
    const projected = [];
    for (let i = 0; i < mesh.geometry.attributes.position.count; i++) projected.push(new THREE.Vector3().fromBufferAttribute(mesh.geometry.attributes.position, i).applyMatrix4(mesh.matrixWorld).applyMatrix4(camera.matrixWorldInverse));
    const minX = Math.min(...projected.map(p => p.x)), maxX = Math.max(...projected.map(p => p.x));
    const minY = Math.min(...projected.map(p => p.y)), maxY = Math.max(...projected.map(p => p.y));
    camera.left = minX; camera.right = maxX; camera.bottom = minY; camera.top = maxY; camera.updateProjectionMatrix();
    const cameraState = () => [camera.position.toArray(), camera.quaternion.toArray(), camera.projectionMatrix.toArray(), camera.matrixWorld.toArray()];
    const beforeCamera = cameraState();
    const sentinel = new THREE.WebGLRenderTarget(71, 53);
    const savedState = () => ({ target: renderer.getRenderTarget()?.uuid ?? null, viewport: renderer.getViewport(new THREE.Vector4()).toArray(),
      scissor: renderer.getScissor(new THREE.Vector4()).toArray(), scissorTest: renderer.getScissorTest(), autoClear: renderer.autoClear, size: renderer.getDrawingBufferSize(new THREE.Vector2()).toArray(), camera: cameraState() });
    const seedState = () => { renderer.setRenderTarget(sentinel); renderer.setViewport(3, 5, 37, 23); renderer.setScissor(7, 9, 19, 11); renderer.setScissorTest(true); renderer.autoClear = false; };
    const canvasState = () => { renderer.setRenderTarget(null); renderer.setViewport(0, 0, w / cfg.dpr, h / cfg.dpr); renderer.setScissorTest(false); renderer.autoClear = true; };
    const readTexture = () => {
      const s = new THREE.Scene(), c = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      const m = new THREE.ShaderMaterial({ uniforms: { frame: { value: feed.surface.texture } }, vertexShader: vertex,
        fragmentShader: 'uniform sampler2D frame;varying vec2 vUv;void main(){gl_FragColor=texture2D(frame,vUv);}', toneMapped: false });
      const g = new THREE.PlaneGeometry(2, 2); s.add(new THREE.Mesh(g, m)); canvasState(); renderer.render(s, c);
      const p = pixels(renderer, w, h); g.dispose(); m.dispose(); return p;
    };
    // Independent public-broadcast pipeline, using the same modules but not the
    // screen module or its framebuffer-copy shader as the image oracle.
    const reference = () => {
      const result = programme.evaluate({ match: current.state, nowMs: now, dt: .02 });
      aimBroadcastCamera(refCamera, venueRoot, result.camera); canvasState();
      avatar.visible = head.visible = body.visible = true;
      try { oracle.render([stage, mesh]); score.draw(current.state?.bug ?? null, { compactOnly: !!result.tableCue }); score.render(renderer);
        league.draw(result.tableCue?.presentation ?? null, result.tableCue?.elapsed ?? 0); if (result.tableCue) league.render(renderer);
        return { picture: pixels(renderer, w, h), result }; }
      finally { avatar.visible = false; head.visible = false; body.visible = true; }
    };
    let idlePixels;
    for (const mode of ['idle', 'match', 'league']) {
      current.state = mode === 'idle' ? null : { phase: 'match', match: { id: 's9-m1_alpha_beta' }, loops: 0, bug: { ...bug }, ball: { speed: 0, measured: true } };
      if (mode === 'league') { current.state.bug = { ...bug, t: 105.7, inPlay: false, over: true, tag: 'Full Time' };
        current.state.clockPlan = { buzzers: [{ kind: 'full', t: 100, play_end_t: 100 }] }; }
      // Warm the real async archive in both controllers, then let its promises
      // settle. Fixed nowMs/match time means warmup cannot advance the programme.
      feed.render(.02, now); reference(); await sleep(0);
      draws.length = 0; const beforeCopies = copies, beforeModule = moduleCalls, beforeRoots = rootsCalls;
      seedState(); const saved = savedState(); renderer.info.reset();
      let ok = false, thrown = null;
      try { ok = feed.render(.02, now); } catch (e) { thrown = e.message; }
      const got = capture?.slice(), state = feed.state();
      test(`${mode} render succeeds`, ok && !thrown, thrown || state.error);
      test(`${mode} fixed programme clock and independent camera`, state.programme?.programmeT === (current.state?.bug?.t ?? now / 1000) && copyCamera !== camera && copyCamera?.aspect === 16 / 9);
      test(`${mode} renderer/camera state restored`, same(savedState(), saved) && same(cameraState(), beforeCamera));
      test(`${mode} own first-person avatar restored`, !avatar.visible && !head.visible && body.visible && same(avatarDuring, [true, true, true]), avatarDuring);
      test(`${mode} one feed scene/stage/copy and evaluation`, draws.filter(d => d.scene).length === 1 && draws.filter(d => d.stage).length === 1 && copies === beforeCopies + 1 && moduleCalls === beforeModule + 1 && rootsCalls === beforeRoots + 1, { draws: draws.length, copies: copies - beforeCopies });
      test(`${mode} public draw diagnostics count real calls`, state.calls === renderer.info.render.calls && state.calls > 0 && state.triangles > 0, { state: state.calls, actual: renderer.info.render.calls });
      if (!got) continue;
      const sample = readTexture(), copyDiff = diff(got, sample, w, h);
      test(`${mode} GPU copy equals source bytes (no black/flip)`, copyDiff.max <= 1, copyDiff);
      const ref = reference(), parity = diff(got, ref.picture, w, h);
      test(`${mode} parity with ordinary broadcast canvas`, parity.max <= 2 && parity.mean < .1, parity);
      if (mode === 'idle') idlePixels = got;
      else test(`${mode} graphic is in copied framebuffer`, diff(got, idlePixels, w, h, false, [0, .9, .4, 1]).mean > 2);
      if (mode === 'league') test('validated league cue really on air', state.programme?.table?.visible && state.graphics?.rowCount === 2 && ref.result.tableCue, { programme: state.programme?.table, graphics: state.graphics });
      canvasState(); const n = draws.length; main.render([stage, mesh]); const shown = pixels(renderer, w, h);
      const direct = diff(got, shown, w, h, false, [.01, .01, .99, .99]), flipped = diff(got, shown, w, h, true, [.01, .01, .99, .99]);
      test(`${mode} actual 3D screen orientation/crop/colour`, direct.mean < .35 && direct.changed < .01 && flipped.mean > 15, { direct, flipped });
      test(`${mode} main view renders last exactly once`, draws.slice(n).filter(d => d.scene && d.main).length === 1 && draws.slice(n).every(d => d.main || !d.scene));
      test(`${mode} WebGL has no error`, gl.getError() === gl.NO_ERROR);
      evidence.push({ label, mode, size: [w, h], calls: state.calls, copyDiff, parity, screen: direct });
    }
    // Failure isolation is deliberately tested outside a catching owner loop:
    // a module callback throwing must not prevent the walking frame from running.
    for (const type of ['roots', 'render', 'copy', 'module', 'clock', 'graphics']) {
      const home = current.state.bug.home; if (type === 'graphics') current.state.bug.home = null;
      seedState(); const saved = savedState(), frames = feed.state().frames; fault = type;
      let returned, thrown = null, mainRan = false;
      try { returned = feed.render(.02, type === 'clock' ? NaN : now); fault = null; canvasState(); main.render([stage, mesh]); mainRan = true; }
      catch (e) { thrown = e.message; }
      // State snapshot must be observed before the caller's canvasState changes.
      fault = type; seedState(); let secondThrown = null;
      try { feed.render(.02, type === 'clock' ? NaN : now); } catch (e) { secondThrown = e.message; }
      const restored = same(savedState(), saved); fault = null;
      test(`${type} failure isolated; caller main draw survives`, returned === false && mainRan && !thrown, thrown);
      test(`${type} failure restores renderer/avatar`, restored && !avatar.visible && !head.visible && body.visible && stage.visible && mesh.visible, secondThrown);
      test(`${type} failure does not publish a frame`, feed.state().frames === frames);
      current.state.bug.home = home;
      const count = copies; canvasState(); test(`${type} next frame recovers`, feed.render(.02, now) && copies === count + 1);
    }
    test('no owned render/animation/timer loop', rafCalls === 0 && intervalCalls === 0 && loopCalls === 0 && timeouts.every(ms => ms === 0 || ms === 10000), { rafCalls, intervalCalls, loopCalls, timeouts });
    test('same scene and stage, no mounted clone', scene.children.filter(x => x.name === 'existing-match-stage').length === 1 && stage.children.length === 1 && copyCamera !== camera);
    // A later stage's docking pass may replace the mesh material. The next
    // internal draw must reclaim its screen, without allocating another feed.
    const replacement = new THREE.MeshBasicMaterial({color:'cyan'});
    mesh.material = replacement; canvasState(); const reattachFrame = feed.state().frames;
    test('external dock replacement reattaches without new feed', feed.render(.02, now) && mesh.material === feed.surface.material && feed.state().frames === reattachFrame + 1);
    replacement.dispose();
    const frameCount = feed.state().frames, copyCount = copies;
    let textureDisposes = 0, materialDisposes = 0;
    feed.surface.texture.addEventListener('dispose', () => textureDisposes++);
    feed.surface.material.addEventListener('dispose', () => materialDisposes++);
    feed.dispose(); feed.dispose();
    test('dispose is idempotent and restores authored material', mesh.material === original && textureDisposes === 1 && materialDisposes === 1);
    test('disposed feed cannot draw or reattach', feed.render(.02, now) === false && feed.state().frames === frameCount && copies === copyCount);
    failTracks = true; const broken = create(); await broken.ready;
    test('failed initial programme is inert and diagnosed', !broken.state().ready && /503/.test(broken.state().error) && broken.render(.02, now) === false); broken.dispose(); failTracks = false;
    holdTracks = true; const late = create(); late.dispose(); holdTracks = false; releaseTracks.splice(0).forEach(r => r()); await late.ready;
    test('dispose before ready cannot resurrect feed', !late.state().ready && late.render(.02, now) === false && mesh.material === original);
    const silentBefore = draws.length; await sleep(30);
    test('ready/disposed objects never render autonomously', silentBefore === draws.length && rafCalls === 0 && intervalCalls === 0);
    window.requestAnimationFrame = nativeRAF; window.setInterval = nativeInterval; window.setTimeout = nativeTimeout;
    renderer.render = nativeRender; renderer.copyFramebufferToTexture = nativeCopy; renderer.setAnimationLoop = nativeLoop;
    score.dispose(); league.dispose(); disposeAfter(oracle); disposeAfter(main); sentinel.dispose();
    scene.traverse(o => { o.geometry?.dispose(); for (const m of [].concat(o.material || [])) m.dispose(); });
    renderer.dispose(); renderer.domElement.remove();
  }
  decoder.dispose(); gltf.scene.traverse(o => { o.geometry?.dispose(); for (const m of [].concat(o.material || [])) m.dispose(); });
  window.fetch = nativeFetch;
  return { rows, evidence, requests: [...new Set(requests)].map(u => u.replace(location.origin, '')) };
}

async function integrationSmoke(origin) {
  // Real pages on their supported automation handles. Coarse-pointer idle is
  // intentional: it avoids even importing the remote SDK, not a fake SDK.
  await chrome.send('Emulation.setDeviceMetricsOverride', { width: 640, height: 360, deviceScaleFactor: 1, mobile: false });
  await chrome.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  const { identifier } = await chrome.send('Page.addScriptToEvaluateOnNewDocument', { source: `
    const original = window.fetch.bind(window); window.fetch = (input, options) => {
      const url = new URL(typeof input === 'string' ? input : input.url, location.href);
      if (url.pathname.includes('/api/v1/programme/')) return Promise.resolve(Response.json({channel:'rfl',programme:[],fixtures:[]}));
      if (url.origin !== location.origin) return Promise.reject(new Error('offline smoke blocked external fetch'));
      return original(input, options);
    };` });
  for (const page of ['venue', 'index']) {
    try {
      await chrome.goto(`${origin}/${page}.html${page === 'venue' ? '?venue=stadium&tier=2&street=0&cam=screen_main&fast=1' : '?intro=0'}`);
      const handle = page === 'venue' ? '__venue' : '__city';
      for (let i = 0; i < 120; i++) { if (await chrome.evaluate(`!!window.${handle}`)) break; await new Promise(r => setTimeout(r, 50)); }
      const state = await chrome.evaluate(`(async()=>{
        const p=window.${handle}; if(!p) throw Error('page automation handle unavailable');
        p.renderer.setAnimationLoop(null);
        const V=p.venues.get('stadium');
        if(${JSON.stringify(page)}==='index') { const s=V.def.spawn, v=p.world.toWorld(V.def,s); p.teleport({x:v.x,z:v.z}); p.venues.forceTier('stadium',2); }
        p.step(1); await p.venues.whenLoaded('stadium');
        for(let i=0;i<100 && !V.broadcast;i++) { p.step(1); await new Promise(r=>setTimeout(r,50)); }
        await V.broadcast?.ready; p.step(1);
        const b=p.venues.state().find(v=>v.id==='stadium'), previous=b.broadcast?.frames;
        const render=p.renderer.render.bind(p.renderer), draws=[];
        p.renderer.render=(s,c)=>{draws.push({scene:s===p.scene,main:c===p.camera}); return render(s,c);};
        p.step(1); p.renderer.render=render;
        const after=p.venues.state().find(v=>v.id==='stadium');
        const ownership=draws.filter(d=>d.scene&&!d.main).length===1&&draws.filter(d=>d.scene&&d.main).length===1&&draws.findIndex(d=>d.scene&&!d.main)<draws.findIndex(d=>d.scene&&d.main);
        const calls=p.renderer.info.render.calls;
        p.venues.forceTier('stadium',1); p.step(1); const stopped=V.broadcast.state().frames;
        p.step(1); const suspended=V.broadcast.state().frames===stopped;
        p.venues.forceTier('stadium',2); p.step(1); const resumed=V.broadcast.state().frames===stopped+1;
        const old=V.broadcast, oldFrames=old.state().frames;
        p.renderer.setSize(512,320); p.step(1); await V.broadcast?.ready; p.step(1);
        const resized=V.broadcast!==old&&old.render(0)===false&&old.state().frames===oldFrames&&V.broadcast.state().width===Math.min(1280,512*p.renderer.getPixelRatio());
        p.venues.forceTier('stadium',0); p.step(1,30); p.step(1,30);
        const unloaded=V.broadcast===null;
        p.venues.forceTier('stadium',2); p.step(1); await p.venues.whenLoaded('stadium');
        for(let i=0;i<100 && !V.broadcast;i++){p.step(1);await new Promise(r=>setTimeout(r,25));}
        await V.broadcast?.ready; p.step(1); const reentered=!!V.broadcast?.state().ready;

        return {ownership,suspended,resumed,resized,unloaded,reentered,tier:after.tier,modules:after.modules.map(m=>({active:m.active,failed:m.failed,ready:m.ready})),coarse:matchMedia('(pointer: coarse)').matches,before:previous,after:after.broadcast,phase:after.modules[0]?.state?.phase,sdk:after.modules[0]?.state?.sdk,stage:after.modules[0]?.state?.stage,calls,gl:p.renderer.getContext().getError(),errors:p.errors.slice(0,5)};
      })()`, { timeoutMs: 90000 });
      results.push({ name: `${page} real idle integration`, ok: state.coarse && state.after?.ready && state.after.frames === state.before + 1 && state.calls > state.after.calls && state.gl === 0 && !state.stage && state.sdk === 'unloaded' && state.phase === 'idle' && state.errors.length === 0 && state.ownership && state.suspended && state.resumed && state.resized && state.unloaded && state.reentered, detail: state });
    } catch (e) { results.push({ name: `${page} real idle integration`, ok: false, detail: e.message }); }
  }
  await chrome.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
}

try {
  mkdirSync(out, { recursive: true });
  writeFileSync(join(temp, 'index.html'), `<!doctype html><meta charset="utf-8"><style>body{margin:0}</style><script type="importmap">{"imports":{"three":"/vendor/three/three.module.js","three/addons/":"/vendor/three/jsm/"}}</script><script type="module">window.runChecks=${browserChecks.toString()};</script>`);
  const served = await serve(join(root, 'public'), { mounts: { '/__stadium/': rel => join(temp, rel || 'index.html') } }); server = served.server;
  chrome = await launchChrome({ width: 1280, height: 800 });
  await chrome.send('Network.enable');
  await chrome.send('Network.setBlockedURLs', { urls: ['https://*', 'wss://*'] });
  const errors = [];
  chrome.onConsole((type, text) => { if (type === 'error' && errors.length < 12) errors.push(text.slice(0, 800)); });
  await chrome.goto(`${served.origin}/__stadium/index.html`);
  const report = await chrome.evaluate('window.runChecks()', { timeoutMs: 180000 });
  results.push(...report.rows);
  writeFileSync(join(out, 'metrics.json'), JSON.stringify(report, null, 2));
  results.push({ name: 'browser has no unexpected WebGL/JS errors', ok: errors.length === 0, detail: errors });
  if (process.argv.includes('--smoke')) await integrationSmoke(served.origin);
  else notes.push('Real /venue and /index smoke not requested; run with --smoke. Synthetic tests use the actual screen_main GLB geometry and no network SDK.');
} catch (e) {
  results.push({ name: 'harness completes', ok: false, detail: e.stack || e.message });
} finally {
  if (chrome) await chrome.close();
  if (server) await new Promise(r => server.close(r));
  rmSync(temp, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const failed = results.filter(r => !r.ok);
  writeFileSync(join(out, 'results.json'), JSON.stringify({ results, notes }, null, 2));
  const report = ['# Stadium screen regression findings', '', `${results.length - failed.length}/${results.length} checks passed.`, '',
    ...failed.flatMap(r => [`## FAIL: ${r.name}`, '```json', JSON.stringify(r.detail ?? null, null, 2), '```', '']),
    '## Scope / notes', ...notes.map(n => `- ${n}`),
    '- Pixel checks are real WebGL readbacks in test code only. Source module is imported unmodified.',
    '- The offline synthetic archive must reconcile through the real league validator; scorebug and league rendering are not mocked.',
    '- Results and exact pixel-error summaries: metrics.json.',
    '- Initial run found module() outside the render guard (four failure-isolation failures). Parent subsequently fixed it; the current run below is authoritative. A throwing owner accessor must never abort the walking draw.', '',
    '## Passing checks', ...results.filter(r => r.ok).map(r => `- ${r.name}`), ''].join('\n');
  writeFileSync(join(out, 'test-findings.md'), report);
  console.log(`stadium-screen: ${results.length - failed.length}/${results.length} passed; ${failed.length} failed. Details: qa-out/stadium-screen/test-findings.md`);
  for (const r of failed.slice(0, 12)) console.error(`FAIL ${r.name}: ${JSON.stringify(r.detail ?? '').slice(0, 350)}`);
  process.exitCode = failed.length ? 1 : 0;
}
