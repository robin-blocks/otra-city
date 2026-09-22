// Host adapter for the locally pinned 4DGSX v1 SDK. The copied upstream code
// keeps its original attribution and is NOT presumed covered by this project's
// MIT license. See /vendor/4dgsx/broadcast-factory.js and the provenance fixture.
// No upstream JavaScript is fetched, hashed or transformed at runtime.
export const SDK_URL = 'https://4dgsx.com/sdk/v1/three.js'; // provenance / legacy config value
export const SDK_SHA256 = '18525ca0abe3b920232b6c74ab76d55de0a4d25684a31477c421131ad5027e6f';
const EXPORTS = 'export{xt as FourDGSX,Bt as cdnFallbackActive,Be as configureCdnFallback,ne as mountStage};';
const factories = new Map();

/** Immutable copy: the caller's publisher document is never modified. */
export function filterReservedVideo(ui, slot) {
  if (!slot || !Array.isArray(ui?.components)) return ui;
  const components = ui.components.filter((c) => !(c?.anchor?.type === 'dock'
    && c.anchor.slot === slot && c.content?.type === 'media'
    && (!c.content.kind || c.content.kind === 'video')));
  return components.length === ui.components.length ? ui : { ...ui, components };
}

/** One mount's exact manifest/UI URLs, including the SDK's own CDN fallback.
 * Every request is forwarded unchanged. Only .json() of the declared UI
 * response is filtered, before SDK allocation; no extra scene/UI request.
 * No broad suffix matching: other bundles and other JSON stay untouched.
 */
export function bundleFetch(bundleUrl, slot, origin, fetchImpl = globalThis.fetch.bind(globalThis)) {
  const base = String(bundleUrl).replace(/\/+$/, '');
  const site = String(origin || 'https://4dgsx.com').replace(/\/+$/, '');
  const variants = (url) => {
    const urls = [url];
    if (url.startsWith('https://cdn.4dgsx.com/')) urls.push(`${site}/cdn/${url.slice('https://cdn.4dgsx.com/'.length)}`);
    return urls;
  };
  const manifests = new Set(variants(`${base}/scene.json`));
  const uis = new Set();
  return async (input, init) => {
    const response = await fetchImpl(input, init);
    const url = typeof input === 'string' ? input : input?.url || String(input);
    if (!response.ok || (!manifests.has(url) && !uis.has(url))) return response;
    // A proxy keeps native response metadata/methods intact, without modifying
    // even the Response object handed back by the caller's fetch implementation.
    return new Proxy(response, {
      get(target, key) {
        if (key === 'json') return async () => {
          const doc = await target.json();
          if (manifests.has(url)) {
            for (const ui of variants(`${base}/${doc?.ui || 'ui.json'}`)) uis.add(ui);
            return doc;
          }
          return filterReservedVideo(doc, slot);
        };
        const value = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  };
}

// Build/test-only insertion into the audited mountStage lexical scope. `u` is
// the ALREADY loaded ArrayBuffer (not copied), me is Poser; e/n are scene/HUD.
// Only the sampler's O(body-count) output workspace is allocated, lazily. It
// never calls the live poser, seek, update, fetch, or event/audio/panel methods.
const HOST_SAMPLER = `
let hostPoser = null, hostClosed = false;
const hostMeta = JSON.parse(JSON.stringify({ bodies: e.bodies, program: e.program || null, audio: { map: e.audio?.map || null } }));
const hostFreeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(hostFreeze); Object.freeze(value); } return value; };
const hostNames = new Map(e.bodies.map((name, i) => [name, i]));
// Bounded cache of small poses, never track bytes. The director's stable 50Hz
// history grid revisits most of its 201 samples each frame. Defensive copies
// keep this observationally pure even when a caller modifies its result.
const hostCache = new Map();
const hostCopy = play => play && ({ players: play.players.map(p => p.slice()), ball: play.ball?.slice() || null,
  anchors: play.anchors.map(p => ({ id: p.id, pos: p.pos.slice() })) });
W.host = Object.freeze({
  metadata: hostFreeze(hostMeta),
  samplePlay(time) {
    if (hostClosed || !Number.isFinite(time) || S < 2 || !(v > 0) || u.byteLength < S * A * 7 * 4) return null;
    time = Math.min(M, Math.max(H, time));
    if (hostCache.has(time)) return hostCopy(hostCache.get(time));
    hostPoser ||= new me(u, A, S, v, H, !!e.meta?.goal_celebration);
    hostPoser.pose(time);
    const point = (name, offset) => {
      const i = hostNames.get(name); if (i === undefined) return null;
      const pos = new c.Vector3().fromArray(hostPoser.pos, i * 3);
      if (offset) {
        const q = i * 4, quat = hostPoser.quat;
        pos.add(new c.Vector3().fromArray(offset).applyQuaternion(new c.Quaternion(quat[q+1], quat[q+2], quat[q+3], quat[q])));
      }
      const out = [pos.x, pos.z, -pos.y]; // match Z-up -> stage-local Y-up
      return out.every(Number.isFinite) ? out : null;
    };
    const players = [], anchors = [];
    for (const player of n.players || []) {
      const body = player.anchor?.body, pos = point(body);
      if (pos) players.push(pos);
      const head = point(body, player.anchor?.offset || [0, 0, 0.6]);
      if (head) anchors.push({ id: player.id, pos: head });
    }
    const ball = point('ball');
    const play = players.length || ball ? { players, ball, anchors } : null;
    if (hostCache.size >= 512) hostCache.delete(hostCache.keys().next().value);
    hostCache.set(time, play);
    return hostCopy(play);
  },
});
const hostDispose = W.dispose;
W.dispose = function() { hostClosed = true; hostPoser = null; hostCache.clear(); return hostDispose.call(W); };
`;

/** Build-time addition, gated by publisher metadata per mount. The same
 * Poser feeds both the stage and its pure director sampler. Hidden effect
 * bodies live below the floor: those transitions (and kickoff resets) are
 * discontinuities, never flights interpolated through the pitch.
 * Pin the source hash AND exact replacement counts; fail on any drift.
 */
function celebrationPoser(body) {
  const change = (before, after) => {
    if (body.split(before).length !== 2) throw new Error('broadcast SDK poser changed: review required');
    body = body.replace(before, after);
  };
  change('var me=class{constructor(t,e,n,o,l){',
    'var me=class{constructor(t,e,n,o,l,goalJumps=false){this.goalJumps=goalJumps;');
  change('o-1.001),i=Math.floor(l)', '(this.goalJumps?o-1:o-1.001)),i=Math.floor(l)');
  change('let g=(i*n+p)*7,h=(b*n+p)*7,y=p*3;this.pos[y]',
    'let g=(i*n+p)*7,h=(b*n+p)*7,y=p*3;let u=this.goalJumps&&Math.hypot(e[h]-e[g],e[h+1]-e[g+1],e[h+2]-e[g+2])>2?0:l-i;this.pos[y]');
  change('let L=new me(u,A,S,v,H),', 'let L=new me(u,A,S,v,H,!!e.meta?.goal_celebration),');
  return body;
}

/** BUILD/TEST ONLY. Convert the exact reviewed source; runtime uses a file.
 * Regeneration must match scripts/fixtures/sdk-provenance.json, including its
 * resulting factory digest. A different upstream build requires a new review.
 */
export async function sdkFactorySource(source) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
  const hash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  if (hash !== SDK_SHA256) throw new Error('broadcast SDK changed: build-time adapter needs review');
  const imports = [];
  let body = source.replace(/import\*as [A-Za-z_$][\w$]* from"three";/g, (s) => { imports.push(s); return ''; });
  const tail = '};return W}';
  if (imports.length !== 7 || body.split(EXPORTS).length !== 2 || body.split(tail).length !== 2
      || !body.includes('async function ne(s)') || !body.includes('var me=class')) throw new Error('broadcast SDK ESM contract changed');
  body = body.replace(EXPORTS, '').replace(/\/\/# sourceMappingURL=.*$/, '');
  body = celebrationPoser(body);
  body = body.replace(tail, `};${HOST_SAMPLER}return W}`);
  // schedule() and FourDGSX.mount() both call the lexical mountStage binding.
  // Keep native mount before installing the host's isolated per-mount router.
  return `/* Vendored 4DGSX SDK v1 — https://4dgsx.com/sdk
 * Upstream authored by Robin Spottiswoode / 4DGSX. Original attribution retained below.
 * Copied upstream source, NOT assumed MIT-licensed by this host repository.
 * Provenance + SHA-256: scripts/fixtures/sdk-provenance.json.
 * Host modifications: factory/fetch isolation, read-only loaded-track sampler, metadata-gated teleport holds.
 * Regenerate only with the audited build/test helper sdkFactorySource().
 */
${imports.join('\n')}
export function createSdk(fetch, mount) {
${body}
const nativeMount = ne; if (mount) ne = mount;
return { FourDGSX: xt, mountStage: nativeMount };
}
`;
}

async function loadFactory(url) {
  // cfg.sdk test overrides are prebuilt factory ESMs served by the fixture,
  // generated from its known source BEFORE the browser starts. Never raw JS
  // fetched/transformed into a blob. The deployed upstream URL means pinned.
  const path = !url || url === SDK_URL ? '/vendor/4dgsx/broadcast-factory.js' : url;
  // A fixture may override with a local prebuilt ESM, never with upstream JS.
  const resolved = new URL(path, import.meta.url);
  if (resolved.origin !== new URL(import.meta.url).origin || !['http:', 'https:'].includes(resolved.protocol)) {
    throw new Error('SDK factory override must be same-origin prebuilt ESM');
  }
  if (!factories.has(path)) {
    factories.set(path, import(path).then((mod) => {
      if (typeof mod.createSdk !== 'function') throw new Error('SDK override must export audited createSdk factory');
      return mod.createSdk;
    }).catch((e) => { factories.delete(path); throw e; }));
  }
  return factories.get(path);
}

/** Each mount, including schedule's hidden stage, has its own fetch closure.
 * Only the local factory module is cached. No singleton bundle/policy state,
 * no global interception, no localStorage changes, no blob: requirement.
 */
export async function createBroadcastSdk({ sdkUrl = SDK_URL, origin, reservedDock } = {}) {
  const createSdk = await loadFactory(sdkUrl);
  const nativeFetch = globalThis.fetch.bind(globalThis);
  const mount = (opts) => {
    const isolated = createSdk(bundleFetch(opts.bundleUrl, reservedDock, origin, nativeFetch));
    new isolated.FourDGSX(origin ? { origin } : {});
    return isolated.mountStage(opts);
  };
  const scheduled = createSdk(nativeFetch, mount);
  return new scheduled.FourDGSX(origin ? { origin } : {});
}
