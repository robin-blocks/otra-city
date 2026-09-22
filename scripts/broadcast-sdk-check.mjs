// Pinned SDK + synthetic moving bundle; offline default, optional audited source regeneration.
// node scripts/broadcast-sdk-check.mjs [--sdk-file /path/to/reviewed/three.js]
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { resolve, extname } from 'node:path';
import { filterReservedVideo, bundleFetch, sdkFactorySource } from '../public/js/venue-modules/broadcast-sdk.mjs';
import { launchChrome } from '../lib/headless-chrome.mjs';
import { MIME } from '../lib/static-server.mjs';

const video = (slot, kind = 'video') => ({ id: slot, layer: 'panels', anchor: { type: 'dock', slot }, content: { type: 'media', kind, src: `${slot}.mp4` } });
const html = (slot) => ({ id: slot, layer: 'panels', anchor: { type: 'dock', slot }, content: { type: 'html', src: `${slot}.html` } });
const ui = { layers: [{ id: 'panels', default: true }], components: [video('main'), video('aux'), html('left'), html('right')] };
const original = JSON.stringify(ui);
const filtered = filterReservedVideo(ui, 'main');
assert.equal(JSON.stringify(ui), original);
assert.deepEqual(filtered.components, ui.components.slice(1));
assert.equal(filtered.layers, ui.layers);
assert.equal(filterReservedVideo(ui, null), ui);
assert.equal(filterReservedVideo({ components: [html('main'), video('main', 'audio'), { ...video('main'), anchor: { type: 'world' } }] }, 'main').components.length, 3);
assert.equal(filterReservedVideo({ components: [video('main', undefined)] }, 'main').components.length, 0);
const fetchBefore = globalThis.fetch;
const base = 'https://cdn.4dgsx.com/test/a';
const sent = [];
const fetchImpl = async (url, opts) => {
  sent.push([url, opts]);
  return new Response(JSON.stringify(url.endsWith('scene.json') ? { ui: 'custom/presentation.json', audio: { file: 'sound.m4a' } } : ui), { headers: { 'x-test': 'kept' } });
};
const one = bundleFetch(base, 'main', 'https://4dgsx.com', fetchImpl);
const two = bundleFetch(base, 'aux', 'https://4dgsx.com', fetchImpl);
await Promise.all([one(`${base}/scene.json`).then(r => r.json()), two(`${base}/scene.json`).then(r => r.json())]);
const options = { credentials: 'omit', headers: { 'x-test': 'unchanged' } };
const results = await Promise.all([one(`${base}/custom/presentation.json`, options).then(r => r.json()), two(`${base}/custom/presentation.json`).then(r => r.json())]);
assert.deepEqual(results[0].components.map(c => c.id), ['aux', 'left', 'right']);
assert.deepEqual(results[1].components.map(c => c.id), ['main', 'left', 'right']);
assert.equal(sent[2][1], options);
assert.deepEqual(await (await one(`${base}/ui.json`)).json(), ui, 'undeclared UI path not filtered');
assert.deepEqual(await (await one(`${base}/../b/custom/presentation.json`)).json(), ui, 'other bundle not filtered');
assert.equal((await one('https://4dgsx.com/cdn/test/a/custom/presentation.json')).headers.get('x-test'), 'kept');
assert.equal((await (await one('https://4dgsx.com/cdn/test/a/custom/presentation.json')).json()).components.length, 3);
assert.equal(globalThis.fetch, fetchBefore);
await assert.rejects(sdkFactorySource('unreviewed SDK'), /changed/);
console.log('PASS immutable/exact-URL filtering, concurrent policies, proxy paths, forwarding, no global fetch change, unknown SDK rejection');

const fileArg = process.argv.indexOf('--sdk-file');
const source = fileArg < 0 ? null : readFileSync(process.argv[fileArg + 1], 'utf8');
const pinned = readFileSync('public/vendor/4dgsx/broadcast-factory.js', 'utf8');
const provenance = JSON.parse(readFileSync('scripts/fixtures/sdk-provenance.json', 'utf8'));
assert.equal(createHash('sha256').update(pinned).digest('hex'), provenance.factorySha256, 'pinned artifact matches provenance');
const factory = source ? await sdkFactorySource(source) : pinned;
assert.equal(factory, pinned, 'reviewed-source regeneration exactly reproduces pin');
console.log('PASS local SDK provenance digest (no upstream network)' + (source ? ', source regeneration' : ''));

const program = { duration_s: 8.5, map: [[-1, 0], [0, 1], [1, 2], [1, 2.5], [2, 3.5], [7, 8.5]], segments: [{ id: 'pre', t: [-1, 0] }, { id: 'play', t: [0, 2] }, { id: 'post', t: [2, 3] }] };
const scene = { meta: { hz: 1, nframes: 3 }, bodies: ['pelvis', 'ball'], times: [0, 2], buffers: { vertexCount: 3, vertexBytes: 72, indexCount: 3, indexBytes: 12 }, prims: [{ vo: 0, vc: 3, io: 0, ic: 3 }], draws: [{ p: 0, b: 0, rgba: [0, 1, 0, 1], checker: 0 }], program, audio: { sources: [{ id: 'crowd', file: 'sound.wav', default: false }] } };
const geo = Buffer.concat([Buffer.from(new Float32Array([-1,-1,0,0,0,1, 1,-1,0,0,0,1, 0,1,0,0,0,1]).buffer), Buffer.from(new Uint32Array([0,1,2]).buffer)]);
const hud = { teams: [{ id: 'a', name: 'A', code: 'A', color: [1,0,0] }, { id: 'b', name: 'B', code: 'B', color: [0,0,1] }], players: [{ id: 'p', team: 'a', name: 'Player', anchor: { body: 'pelvis', offset: [0.2, 0, 0.6] } }], score: [{ t: 0, a: 0, b: 0 }, { t: 1, a: 1, b: 0 }], events: [{ t: 1, type: 'goal', player: 'p', team: 'a', replay_s: 0.5 }], clock: { duration_s: 2 } };
const track = Buffer.from(new Float32Array([
  0,2,0.5, 1,0,0,0,  0,0,0.2, 1,0,0,0,
  1,2,0.5, Math.SQRT1_2,0,0,Math.SQRT1_2,  2,1,0.4, 1,0,0,0,
  2,2,0.5, 0,0,0,1,  4,2,0.2, 1,0,0,0,
]).buffer);
const requests = [];
let origin;
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://local').pathname;
  requests.push(path);
  const send = (type, data) => { res.writeHead(200, { 'content-type': type }); res.end(data); };
  if (path === '/') return send('text/html', '<!doctype html><script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js"}}</script>');
  if (path === '/sdk.js') return send('text/javascript', factory);
  if (path === '/raw-sdk.js' && source) return send('text/javascript', source);
  if (path === '/requests.json') return send('application/json', JSON.stringify(requests));
  if (path === '/api/v1/programme/test') return send('application/json', JSON.stringify({ schema: '4dgsx-programme/1', now: new Date().toISOString(), items: [{ bundleId: 'test', bundleUrl: `${origin}/bundle`, state: 'live', startsAt: new Date(Date.now()-1000).toISOString(), endsAt: new Date(Date.now()+60000).toISOString() }] }));
  if (path.startsWith('/bundle/')) {
    const file = path.slice('/bundle/'.length);
    if (file === 'scene.json') return send('application/json', JSON.stringify(scene));
    if (file === 'ui.json') return send('application/json', JSON.stringify(ui));
    if (file === 'hud.json') return send('application/json', JSON.stringify(hud));
    if (file === 'geometry.bin') return send('application/octet-stream', geo);
    if (file === 'track.bin') return send('application/octet-stream', track);
    if (file === 'points.bin') return send('application/octet-stream', Buffer.alloc(0));
    if (file.endsWith('.html')) return send('text/html', '<!doctype html><body>panel</body>');
    return res.writeHead(404).end();
  }
  try {
    const file = resolve(path.startsWith('/node_modules/') ? '.' : 'public', `.${path}`);
    send(MIME[extname(file)] || 'application/octet-stream', readFileSync(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
origin = `http://127.0.0.1:${server.address().port}`;
let chrome;
try {
  chrome = await launchChrome();
  await chrome.goto(origin);
  const result = await chrome.evaluate(`(async () => {
    const assert = (ok, label) => { if (!ok) throw new Error(label); };
    const before = { fetch: window.fetch, createElement: document.createElement, storage: JSON.stringify(localStorage) };
    const { createBroadcastSdk } = await import('/js/venue-modules/broadcast-sdk.mjs');
    let rejectedRemote = false;
    try { await createBroadcastSdk({ sdkUrl: 'https://example.invalid/changed-sdk.js' }); } catch (e) { rejectedRemote = /same-origin/.test(e.message); }
    assert(rejectedRemote, 'remote override rejected without network/transform');
    const sdk = await createBroadcastSdk({ sdkUrl: '/sdk.js', origin: location.origin, reservedDock: 'main' });
    const st = await sdk.mount({ bundleUrl: location.origin + '/bundle', autoplay: false });
    assert(document.querySelectorAll('video').length === 1, 'only aux video allocated');
    assert(document.querySelector('video').src.endsWith('/aux.mp4'), 'main absent before attach');
    assert(st.docks.slots.map(s => s.slot).join() === 'aux,left,right', 'panels preserved');
    assert(st.audio.sources.length === 1 && st.audio.sources[0].id === 'crowd', 'audio preserved');
    assert(st.hud.events[0].type === 'goal' && st.layers[0].id === 'panels', 'HUD/layers preserved');
    assert(Object.isFrozen(st.host.metadata.program.map[0]), 'metadata frozen');
    const treeSnapshot = () => { const nodes = []; st.group.traverse(n => nodes.push(n.matrix.toArray())); return JSON.stringify(nodes); };
    const liveTime = st.time;
    const countRequests = async () => (await (await fetch('/requests.json')).json()).filter(p => /(?:scene[.]json|track[.]bin|geometry[.]bin|hud[.]json)$/.test(p)).length;
    const beforeSamples = await countRequests();
    const sampled = st.host.samplePlay(0.5);
    assert(Math.abs(sampled.ball[0] - 1) < 1e-6 && Math.abs(sampled.ball[1] - 0.3) < 1e-6 && sampled.ball[2] === -0.5, 'known interpolated stage-local ball');
    assert(sampled.players[0].join() === '0.5,0.5,-2', 'known player position');
    assert(Math.abs(sampled.anchors[0].pos[0] - (0.5 + Math.SQRT1_2 * 0.2)) < 1e-6, 'anchor quaternion interpolation');
    st.seek(0.5);
    const matchRoot = st.group.getObjectByName('4dgsx-match-space');
    matchRoot.updateMatrix();
    const nativeBall = new (await import('three')).Vector3().setFromMatrixPosition(matchRoot.children[2].matrix).applyMatrix4(matchRoot.matrix);
    assert(nativeBall.distanceTo(new (await import('three')).Vector3(...sampled.ball)) < 1e-6, 'sampler agrees with native posed body');
    st.seek(liveTime);
    const matrices = treeSnapshot();
    const golden = JSON.stringify(sampled);
    sampled.ball[0] = 900;
    for (let i = 1200; i >= 0; i--) st.host.samplePlay(i / 600);
    assert(JSON.stringify(st.host.samplePlay(0.5)) === golden, 'sample independent of call order and caller mutation');
    assert(st.host.samplePlay(NaN) === null && st.host.samplePlay(Infinity) === null, 'invalid times rejected');
    assert(st.time === liveTime && treeSnapshot() === matrices, 'sampling never moves live stage');
    assert(await countRequests() === beforeSamples, 'sampling no network');
    const detachedSampler = st.host.samplePlay;
    st.dispose(); assert(detachedSampler(0.5) === null, 'disposed sampler cannot retain/use workspace');
    // Default and legacy upstream config load the local pin, not remote code.
    const local = await createBroadcastSdk({ origin: location.origin, reservedDock: 'main' });
    const localStage = await local.mount({ bundleUrl: location.origin + '/bundle' });
    assert(JSON.stringify(localStage.host.samplePlay(0.5)) === golden, 'default pinned and fixture override equivalent'); localStage.dispose();
    const other = await createBroadcastSdk({ sdkUrl: '/sdk.js', origin: location.origin, reservedDock: 'aux' });
    const stages = await Promise.all([sdk.mount({ bundleUrl: location.origin + '/bundle' }), other.mount({ bundleUrl: location.origin + '/bundle' })]);
    assert([...document.querySelectorAll('video')].map(v => v.src.split('/').pop()).sort().join() === 'aux.mp4,main.mp4', 'concurrent per-mount policies');
    stages.forEach(s => s.dispose());
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('schedule mount timeout')), 5000);
      let slot;
      slot = sdk.schedule('test', { mount(s) {
        try { assert(document.querySelectorAll('video').length === 1 && document.querySelector('video').src.endsWith('/aux.mp4'), 'scheduled allocation filtered'); clearTimeout(timer); slot.dispose(); resolve(); } catch (e) { reject(e); }
      } });
    });
    assert(window.fetch === before.fetch && document.createElement === before.createElement && JSON.stringify(localStorage) === before.storage, 'no global effects');
    // Unadapted SDK remains unfiltered in the very same page.
    if (${!!source}) {
    const native = await import('/raw-sdk.js');
    const raw = await new native.FourDGSX().mount({ bundleUrl: location.origin + '/bundle' });
    assert(document.querySelectorAll('video').length === 2, 'native SDK unaffected'); raw.dispose();
    }

    const THREE = await import('three');
    const { create } = await import('/js/venue-modules/match-4dgsx.js');
    const root = new THREE.Group(), pitch = new THREE.Group(); root.add(pitch);
    root.position.set(10,3,-2); root.rotation.y = 0.3; pitch.position.set(3,1,-2); pitch.rotation.y = 0.7; pitch.scale.setScalar(1.5);
    const mesh = () => new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial());
    const main = mesh(), left = mesh(), right = mesh(); root.add(main, left, right);
    const material = main.material, map = new THREE.Texture(); map.flipY = true; main.material.map = map;
    const leftMaterial = left.material;
    const mod = create({ venue: { name: 'Test' }, cfg: { sdk: '/sdk.js', origin: location.origin, bundle: location.origin + '/bundle', pitch: 'pitch', docks: { main: 'main', left: 'left', right: 'right' }, live_screen: 'main', boards: false }, root, nodes: { pitch, main, left, right }, camera: new THREE.PerspectiveCamera(), renderer: { domElement: { clientHeight: 720 } }, media: {} });
    assert(mod.samplePlay(0) === null, 'unmounted sampler null');
    const owned = (label) => assert(main.material === material && main.material.map === map && map.flipY === true, label);
    owned('create ownership'); mod.replayCam(true); mod.activate(); owned('idle ownership');
    const until = async (fn) => { const end = performance.now() + 5000; while (!fn()) { if (performance.now() > end) throw new Error('module timeout: ' + JSON.stringify(mod.state)); await new Promise(r => setTimeout(r, 20)); } };
    await until(() => mod.state.phase === 'match' && mod.state.programme);
    mod.update(0.01); owned('match attach and orientation ownership');
    assert(Object.isFrozen(mod.state.programme) && Object.isFrozen(mod.state.programme.map[0]), 'programme deeply read-only');
    assert(left.material !== leftMaterial, 'other screen remains module owned');
    const expected = new THREE.Vector3(1, 0.3, -0.5).applyMatrix4(pitch.matrix);
    assert(expected.distanceTo(new THREE.Vector3(...mod.samplePlay(0.5).ball)) < 1e-6, 'module sampler transforms to venue-local, not world');
    const oldNow = Date.now, epoch = oldNow();
    let wall = epoch;
    Date.now = () => wall;
    try {
      const run = async (fps) => {
        wall = epoch + 1600;
        await mod.rehearseLive({ bundleUrl: location.origin + '/bundle', startsAt: new Date(epoch).toISOString() });
        if (fps) for (let i = 0; i < Math.round(fps * 0.7); i++) {
          wall = epoch + 1600 + i * 1000 / fps; mod.update(1 / fps);
        }
        wall = epoch + 2300; mod.update(fps ? 1 / fps : 0.01);
        assert(mod.state.headcam?.sampling === 'bounded-track-60hz', 'headcam from loaded track');
        assert(mod.state.board === 'GOAL' && Math.abs(mod.state.goal?.elapsed - 0.3) < 1e-9, 'GOAL uses programme time');
        return JSON.stringify({ head: mod.state.headcam, ball: mod.state.ball, play: mod.state.play, goal: mod.state.goal });
      };
      const a = await run(30), b = await run(60), late = await run(0);
      assert(a === b && b === late, '30/60fps/late arrival identical headcam, bodies, ball speed and GOAL');
      wall = epoch + 6100; mod.update(0.01);
      assert(mod.state.goal === null && mod.state.board !== 'GOAL', 'GOAL expires on programme boundary not local timer');
      wall = epoch + 2300; mod.update(0.01);
      assert(mod.state.board === 'GOAL', 'GOAL deterministic after rewind');
    } finally { Date.now = oldNow; }

    await mod.rehearseLive({ bundleUrl: location.origin + '/bundle', startsAt: new Date(Date.now()-200).toISOString() });
    await until(() => !!mod.state.programme); mod.update(0.01); owned('preroll ownership');
    await mod.rehearseLive({ bundleUrl: location.origin + '/bundle', startsAt: new Date(Date.now()-2100).toISOString() });
    await until(() => !!mod.state.programme); mod.update(0.01); owned('replay ownership');
    assert(mod.state.replayCam && mod.state.replay && mod.state.replay.t < 1, 'visitor replay rewinds pitch');
    await mod.rehearseLive({ bundleUrl: location.origin + '/bundle', startsAt: new Date(Date.now()-4100).toISOString() });
    await until(() => !!mod.state.programme); mod.update(0.01); owned('postroll ownership');
    await mod.rehearseLive(null); mod.update(1); owned('unmount idle ownership');
    assert(mod.state.programme === null && mod.samplePlay(0.5) === null, 'programme/sampler cleared on unmount');
    mod.dispose(); owned('dispose ownership'); assert(left.material === leftMaterial, 'other material restored');
    assert(document.querySelectorAll('video').length === 0, 'stage videos released');
    assert(window.fetch === before.fetch && document.createElement === before.createElement, 'still no global interception');
    return 'PASS deterministic pure body/anchor sampler, no seeks/network, 30/60fps/late headcam/GOAL/speed, pinned SDK direct/scheduled/concurrent allocation, unchanged audio/panels, main ownership create/live/pre/post/idle/dispose, visitor replay, read-only programme';
  })()`);
  console.log(result);
  assert.equal(requests.filter(p => p === '/bundle/scene.json').length, requests.filter(p => p === '/bundle/track.bin').length, 'one manifest per mount, no sampling metadata refetch');
  assert(requests.includes('/bundle/left.html') && requests.includes('/bundle/right.html'));
  assert(requests.includes('/bundle/sound.wav'));
  console.log('PASS original panel/audio asset URLs requested');
} finally {
  await chrome?.close();
  await new Promise(r => server.close(r));
}
