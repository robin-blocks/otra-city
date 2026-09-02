// Venue module: Robot Football League matches on the venue's pitch, mounted
// by the 4DGSX three.js SDK (https://4dgsx.com/sdk) from its public
// programme feed. The SDK owns the match (animation, data, layers, its own
// attribution mark); this module owns where things land in the venue —
// the stage on `pitch`, the broadcast and panel docks on named screens, the
// crowd and commentary at named positions, and a scoreboard of our own,
// painted from hud truth, on `scoreboard`.
//
// Lifecycle (venues.js): create → activate (tier 2) → update per frame →
// deactivate (tier 1, the match stays mounted but silent) → dispose (tier 0).
// Between matches the SDK's countdown board stands on the pitch and the
// scoreboard shows the next kick-off; there are no replays on the live site
// (decided 2026-09-02) — a bundle is downloaded only while a match is live.
import * as THREE from 'three';

const SDK_URL = 'https://4dgsx.com/sdk/v1/three.js';
const FEED_ORIGIN = 'https://4dgsx.com';
const BOARD_W = 1024;
const BOARD_H = 576;
let sdkPromise = null;
const loadSdk = (url) => (sdkPromise ??= import(url));

function findMesh(node) {
  if (!node) return null;
  let m = null;
  node.traverse((o) => { if (!m && o.isMesh) m = o; });
  return m;
}
const rgb = (c) => (Array.isArray(c) ? `rgb(${c.slice(0, 3).map((v) => Math.round(v * 255)).join(',')})` : '#8a86a0');
const pad2 = (n) => String(n).padStart(2, '0');
function countdown(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  return `${h}:${pad2(m)}:${pad2(s % 60)}`;
}
function londonTime(iso) {
  try { return new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)); } catch { return ''; }
}

export function create(ctx) {
  const { venue, cfg, root, nodes, camera, renderer, media, log = console } = ctx;
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const pitch = nodes[cfg.pitch] || root;
  const scoreMesh = findMesh(nodes[cfg.scoreboard]);
  const dockMeshes = {};
  for (const [slot, name] of Object.entries(cfg.docks || {})) {
    const mesh = findMesh(nodes[name]);
    if (mesh) dockMeshes[slot] = mesh; else log.warn(`match-4dgsx: dock ${slot} → ${name} not in the venue`);
  }
  const state = {
    phase: 'idle', sdk: 'unloaded', coarse, active: false, match: null, docks: [], stage: null,
    score: null, clock: null, next: null, live: null, recent: [], audio: 'off', board: '', errors: [], updates: 0,
  };

  // Screens get unlit materials that keep the authored plate as their map:
  // the SDK's attach() swaps `material.map` and detach() puts the plate back.
  // The material we displace is kept and RESTORED on dispose, never dropped:
  // once the scoreboard paints over its map, the venue's own plate texture is
  // reachable only through that material, and the venue's disposal walks the
  // scene graph — so a dropped material is a texture nobody ever frees.
  const swapped = [];
  for (const mesh of [scoreMesh, ...Object.values(dockMeshes)]) {
    if (!mesh) continue;
    const original = mesh.material;
    const mat = new THREE.MeshBasicMaterial({ map: original.map || original.emissiveMap || null });
    mesh.material = mat;
    swapped.push({ mesh, mat, original });
  }

  // ---- the scoreboard --------------------------------------------------------
  const canvas = document.createElement('canvas');
  canvas.width = BOARD_W;
  canvas.height = BOARD_H;
  const g = canvas.getContext('2d');
  const boardTex = new THREE.CanvasTexture(canvas);
  boardTex.colorSpace = THREE.SRGBColorSpace;
  boardTex.flipY = false;   // glTF UV convention, like every media node in the city
  boardTex.anisotropy = 4;
  let goalUntil = -1;
  let boardTimer = 0;
  let simTime = 0;
  let skewMs = 0;
  const now = () => Date.now() - skewMs;

  function paintBoard() {
    const W = BOARD_W;
    const H = BOARD_H;
    g.fillStyle = '#0b0714';
    g.fillRect(0, 0, W, H);
    g.strokeStyle = '#ffd479';
    g.lineWidth = 8;
    g.strokeRect(10, 10, W - 20, H - 20);
    g.fillStyle = '#e9edf6';
    g.font = '700 30px Menlo, monospace';
    g.textAlign = 'left';
    g.fillText(venue.name.toUpperCase(), 44, 66);
    g.textAlign = 'right';
    g.fillStyle = '#ffd479';
    g.fillText(state.channelTitle || 'RFL', W - 44, 66);
    g.fillStyle = '#31234f';
    g.fillRect(44, 84, W - 88, 3);
    let text = '';
    const st = stage;
    if (goalUntil > simTime) {
      g.textAlign = 'center';
      g.fillStyle = '#ff2d95';
      g.font = '900 190px Menlo, monospace';
      g.fillText('GOAL', W / 2, 330);
      g.fillStyle = '#e9edf6';
      g.font = '700 44px Menlo, monospace';
      const sc = st?.score;
      if (sc && st.hud?.teams) g.fillText(`${st.hud.teams[0].code}  ${sc.a} – ${sc.b}  ${st.hud.teams[1].code}`, W / 2, 440);
      text = 'GOAL';
    } else if (st && st.hud) {
      const [a, b] = st.hud.teams || [];
      const sc = st.score || { a: 0, b: 0 };
      const live = st.state === 'live';
      g.textAlign = 'center';
      g.fillStyle = live ? '#ff3b30' : '#ffd479';
      g.font = '700 34px Menlo, monospace';
      g.fillText(live ? '● LIVE' : (st.state || 'match').toUpperCase(), W / 2, 140);
      for (const [team, x] of [[a, 160], [b, W - 160]]) {
        if (!team) continue;
        g.fillStyle = rgb(team.color);
        g.fillRect(x - 110, 172, 220, 14);
        g.fillStyle = '#e9edf6';
        g.font = '900 84px Menlo, monospace';
        g.fillText(team.code || '', x, 300);
        g.font = '500 24px Menlo, monospace';
        g.fillStyle = '#b9bcd6';
        g.fillText((team.name || '').slice(0, 20), x, 350);
      }
      g.fillStyle = '#e9edf6';
      g.font = '900 140px Menlo, monospace';
      g.fillText(`${sc.a} – ${sc.b}`, W / 2, 320);
      g.fillStyle = '#47f2ff';
      g.font = '700 64px Menlo, monospace';
      g.fillText(st.clock || '', W / 2, 460);
      g.fillStyle = '#8a86a0';
      g.font = '500 22px Menlo, monospace';
      g.fillText(state.match?.title || '', W / 2, 520);
      text = `${a?.code || ''} ${sc.a}-${sc.b} ${b?.code || ''} ${st.clock || ''}`;
    } else if (state.sdk === 'failed') {
      g.textAlign = 'center';
      g.fillStyle = '#8a86a0';
      g.font = '900 96px Menlo, monospace';
      g.fillText('NO SIGNAL', W / 2, 300);
      g.font = '500 28px Menlo, monospace';
      g.fillText('4dgsx.com is not answering — the pitch waits', W / 2, 380);
      text = 'NO SIGNAL';
    } else {
      const nx = state.next;
      g.textAlign = 'center';
      g.fillStyle = '#ffd479';
      g.font = '700 34px Menlo, monospace';
      g.fillText(nx ? 'NEXT KICK-OFF' : state.live ? 'MATCH LOADING' : 'NO MATCH SCHEDULED', W / 2, 140);
      if (nx) {
        const ms = Date.parse(nx.startsAt) - now();
        g.fillStyle = '#e9edf6';
        g.font = '900 150px Menlo, monospace';
        g.fillText(countdown(ms), W / 2, 300);
        g.fillStyle = '#47f2ff';
        g.font = '700 40px Menlo, monospace';
        g.fillText(`${nx.home?.code || '?'}  v  ${nx.away?.code || '?'}`, W / 2, 372);
        g.fillStyle = '#b9bcd6';
        g.font = '500 24px Menlo, monospace';
        g.fillText(`${nx.home?.name || ''} v ${nx.away?.name || ''} · ${londonTime(nx.startsAt)} London`, W / 2, 416);
        text = `next ${nx.home?.code}-${nx.away?.code} in ${countdown(ms)}`;
      } else {
        g.fillStyle = '#8a86a0';
        g.font = '500 28px Menlo, monospace';
        g.fillText(state.sdk === 'loading' ? 'reading the programme…' : 'the programme is empty', W / 2, 300);
        text = 'idle';
      }
      const r = state.recent[0];
      if (r) {
        g.fillStyle = '#8a86a0';
        g.font = '500 24px Menlo, monospace';
        g.fillText(`LAST RESULT  ${r.home?.code} ${r.score?.[0] ?? '–'} – ${r.score?.[1] ?? '–'} ${r.away?.code}`, W / 2, 500);
      }
    }
    if (coarse && !st) {
      g.fillStyle = '#8a86a0';
      g.font = '500 20px Menlo, monospace';
      g.textAlign = 'center';
      g.fillText('matches play on desktop browsers', W / 2, 540);
    }
    state.board = text;
    boardTex.needsUpdate = true;
    if (scoreMesh && scoreMesh.material.map !== boardTex) { scoreMesh.material.map = boardTex; scoreMesh.material.needsUpdate = true; }
  }

  // ---- the SDK -----------------------------------------------------------------------
  let gsx = null;
  let slot = null;
  let stage = null;
  let fixture = null;
  let disposed = false;
  let programmeTimer = 0;
  const mutedIds = new Set();
  const gestureFns = [];
  let unsubMute = null;

  function onProgramme(p) {
    if (!p?.items) return;
    skewMs = Date.now() - Date.parse(p.now || new Date().toISOString());
    state.channelTitle = p.channel?.title || null;
    state.live = p.items.find((i) => i.state === 'live') || null;
    state.next = p.items.filter((i) => i.state === 'upcoming' && i.startsAt)
      .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0] || null;
    state.recent = p.items.filter((i) => i.state === 'replay' && i.startsAt)
      .sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt)).slice(0, 2)
      .map((i) => ({ home: i.home, away: i.away, score: i.score, title: i.title }));
    paintBoard();
  }

  function audioPolicy() {
    if (!stage) return;
    const wantOn = state.active && !(media?.muted);
    try {
      if (!wantOn) {
        for (const s of stage.audio.sources) { if (s.on) { mutedIds.add(s.id); stage.audio.setOn(s.id, false); } }
      } else {
        for (const id of mutedIds) stage.audio.setOn(id, true);
        mutedIds.clear();
      }
      state.audio = !wantOn ? (media?.muted ? 'muted' : 'off') : stage.audio.enabled ? 'on' : 'pending gesture';
    } catch (e) { state.errors.push(`audio: ${e.message}`); }
  }
  function enableAudio() {
    if (!stage) return;
    try { stage.audio.enable(); } catch (e) { state.errors.push(`enable: ${e.message}`); }
    audioPolicy();
  }
  function armGesture() {
    if (media?.state?.unlocked) { enableAudio(); return; }
    const once = () => { for (const [ev, fn] of gestureFns) removeEventListener(ev, fn); gestureFns.length = 0; enableAudio(); };
    for (const ev of ['pointerdown', 'keydown']) { addEventListener(ev, once); gestureFns.push([ev, once]); }
  }

  function onMount(st, item) {
    stage = st;
    state.match = item ? { id: item.bundleId, title: item.title, state: item.state } : { id: 'bundle', title: cfg.bundle || '' };
    st.group.position.set(0, 0, 0);
    pitch.add(st.group);
    state.docks = [];
    for (const [slotName, mesh] of Object.entries(dockMeshes)) {
      let ok = false;
      try { ok = st.docks.attach(slotName, mesh); } catch (e) { state.errors.push(`dock ${slotName}: ${e.message}`); }
      state.docks.push({ slot: slotName, attached: ok });
    }
    const anchor = nodes[cfg.attribution || 'attribution_anchor'];
    if (anchor && st.attribution) st.attribution.position.copy(anchor.position);
    try {
      st.audio.attachListener(camera);
      for (const [id, spec] of Object.entries(cfg.audio || {})) {
        const v = root.localToWorld(new THREE.Vector3(...spec.at));
        st.audio.place(id, { position: [v.x, v.y, v.z], ref: spec.ref, max: spec.max });
      }
    } catch (e) { state.errors.push(`audio place: ${e.message}`); }
    st.on('event', (e) => { if (e.type === 'goal') { goalUntil = simTime + 4; paintBoard(); } });
    st.on('statechange', (s) => { state.stage = s; paintBoard(); });
    state.stage = st.state;
    if (!item || item.state === 'replay') st.play();
    state.phase = 'match';
    armGesture();
    audioPolicy();
    paintBoard();
  }
  function onUnmount() {
    if (stage) pitch.remove(stage.group);
    stage = null;
    state.match = null;
    state.docks = [];
    state.stage = null;
    state.phase = state.next ? 'countdown' : 'idle';
    paintBoard();
  }

  async function ensureSdk() {
    if (gsx || state.sdk === 'loading') return gsx;
    state.sdk = 'loading';
    paintBoard();
    try {
      const mod = await loadSdk(cfg.sdk || SDK_URL);
      if (disposed) return null;
      gsx = new mod.FourDGSX(cfg.origin ? { origin: cfg.origin } : {});
      state.sdk = 'ready';
      return gsx;
    } catch (e) {
      state.sdk = 'failed';
      state.errors.push(`sdk: ${e.message || e}`);
      log.warn('match-4dgsx: the SDK did not load; the pitch stays empty', e);
      paintBoard();
      return null;
    }
  }
  async function startSchedule() {
    const sdk = await ensureSdk();
    if (!sdk || slot || disposed) return;
    if (cfg.bundle) {
      // fixture path: one bundle, on demand, no feed
      state.phase = 'loading';
      paintBoard();
      try {
        const st = await sdk.mount({ bundleUrl: cfg.bundle, autoplay: false });
        if (disposed) { st.dispose(); return; }
        onMount(st, null);
        slot = { dispose() { onUnmount(); st.dispose(); } };
      } catch (e) {
        state.errors.push(`mount: ${e.message || e}`);
        state.phase = 'idle';
        paintBoard();
      }
      return;
    }
    slot = sdk.schedule(cfg.channel || 'rfl', {
      mount: (st, item) => onMount(st, item),
      unmount: () => onUnmount(),
      onProgramme,
      showFixture: (board) => { fixture = board; board.position.set(0, 2.2, 0); pitch.add(board); if (!stage) state.phase = 'countdown'; },
      hideFixture: (board) => { pitch.remove(board); fixture = null; },
      pollS: cfg.poll_s || 60,
    });
  }
  // Phones only get the board: the match core is a ~39 MB download and the
  // SDK's stage is a desktop-class scene. The programme still tells them when.
  async function pollProgrammeOnly() {
    const origin = (cfg.origin || FEED_ORIGIN).replace(/\/+$/, '');
    try {
      const r = await fetch(`${origin}/api/v1/programme/${encodeURIComponent(cfg.channel || 'rfl')}`, { credentials: 'omit' });
      if (r.ok) onProgramme(await r.json());
    } catch { /* keep the last board */ }
    state.phase = state.next ? 'countdown' : 'idle';
  }

  return {
    activate() {
      if (disposed) return;
      state.active = true;
      paintBoard();
      if (coarse) { pollProgrammeOnly(); programmeTimer = setInterval(pollProgrammeOnly, 60000); }
      else startSchedule();
      if (!unsubMute && media?.subscribeMute) unsubMute = media.subscribeMute(() => audioPolicy());
      audioPolicy();
    },
    deactivate() {
      state.active = false;
      audioPolicy();   // silent from outside the bowl; the match stays mounted
    },
    update(dt, playerPos, time) {
      simTime = time ?? simTime + dt;
      if (!state.active) return;
      state.updates += 1;
      if (stage) {
        stage.update(dt, camera, renderer.domElement.clientHeight || 720);
        state.score = stage.score || null;
        state.clock = stage.clock || null;
        // The SDK paints textures with three's default orientation; our screens
        // carry glTF UVs (v = 0 at the top), so its maps must not flip.
        for (const mesh of Object.values(dockMeshes)) {
          const map = mesh.material.map;
          if (map && map.flipY !== false) { map.flipY = false; map.needsUpdate = true; }
        }
      }
      boardTimer -= dt;
      if (boardTimer <= 0 || (goalUntil > 0 && goalUntil <= simTime && goalUntil > simTime - dt)) {
        boardTimer = stage ? 0.25 : 1.0;
        paintBoard();
      }
    },
    dispose() {
      disposed = true;
      clearInterval(programmeTimer);
      for (const [ev, fn] of gestureFns) removeEventListener(ev, fn);
      gestureFns.length = 0;
      if (unsubMute) unsubMute();
      try { slot?.dispose(); } catch (e) { log.warn('match-4dgsx: dispose', e); }
      slot = null;
      if (fixture) { pitch.remove(fixture); fixture = null; }
      if (stage) { pitch.remove(stage.group); stage = null; }
      boardTex.dispose();
      // hand every screen back the material it had, then drop ours: the venue
      // disposes what the scene graph holds, so what it holds must be the
      // venue's own again
      for (const { mesh, mat, original } of swapped) {
        mesh.material = original;
        mat.map = null;
        mat.dispose();
      }
      state.phase = 'disposed';
      state.active = false;
    },
    get state() { return { ...state, errors: state.errors.slice(-5) }; },
  };
}
