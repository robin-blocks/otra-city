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
// Between matches the scoreboard shows the next fixture and the pitch is
// empty. A bundle is downloaded while a match is live — and, since 2026-09-11,
// when the city itself puts one on: `cfg.now` is a document on our own origin
// naming a replay to show, so that what is in the stadium is shared state
// rather than one browser's query string. The 2026-09-02 rule it replaces was
// "no replays on the live site"; what stands now is that nobody downloads a
// bundle unless the city as a whole is showing it.
import * as THREE from 'three';
import { createPA } from '/js/pa-system.js';

const SDK_URL = 'https://4dgsx.com/sdk/v1/three.js';
const FEED_ORIGIN = 'https://4dgsx.com';
const BOARD_W = 1024;
const BOARD_H = 576;
let sdkPromise = null;
// A rejected import must not be cached: the module retries the SDK on the
// next activation, which it cannot do if the failure is remembered forever.
const loadSdk = (url) => (sdkPromise ??= import(url).catch((e) => { sdkPromise = null; throw e; }));

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
/** The last path segment of a bundle URL — what a fixture's board shows in place of a programme title. */
function bundleName(url) {
  try { return new URL(url).pathname.split('/').filter(Boolean).pop() || String(url); } catch { return String(url || ''); }
}
/** A bundle URL from shared state is data we hand the SDK: https, or this origin. */
const httpsOnly = (u) => { try { const x = new URL(u, location.href); return x.protocol === 'https:' || x.origin === location.origin ? x.href : null; } catch { return null; } };
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
    pa: null, sdkAudio: null,
    // where what is on the pitch came from: the channel's schedule, a bundle
    // named in the venue's own config, or the city's shared override
    source: null, now: null, loadingNow: null,
    // the programme, and what the big screen and side panels are showing
    upcoming: [], screens: {},
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

  // One line of text no wider than `maxW`: the font shrinks until the line
  // fits, and past `minSize` the text is cut with an ellipsis instead. The
  // board never measured what it drew — a season-4 title ("RFL S4 · Microduck
  // · Match 12: Singularity United vs Synthetic Athletic") is half again as
  // long as a season-3 one and ran 350 px off the board's edge, and the two
  // longest club names already ran past the edge and into the score.
  function fitTextOn(ctx, text, x, y, { weight = 500, size = 30, maxW, minSize = Math.round(size * 0.6) }) {
    let s = size;
    let t = String(text ?? '');
    const font = (px) => `${weight} ${px}px Menlo, monospace`;
    ctx.font = font(s);
    while (ctx.measureText(t).width > maxW && s > minSize) { s -= 1; ctx.font = font(s); }
    while (ctx.measureText(t).width > maxW && t.length > 1) t = `${t.slice(0, -2)}…`;
    ctx.fillText(t, x, y);
  }
  const fitText = (text, x, y, opts) => fitTextOn(g, text, x, y, opts);

  // The venue's tannoy, if it declared one. Built here rather than per match
  // so the speakers keep their places across mounts; it only carries sound
  // while a match is up.
  const pa = cfg.pa && media?.listener ? createPA({ listener: media.listener, root, cfg: cfg.pa, log }) : null;

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
      for (const [team, x] of [[a, 150], [b, W - 150]]) {
        if (!team) continue;
        g.fillStyle = rgb(team.color);
        g.fillRect(x - 105, 172, 210, 14);
        g.fillStyle = '#e9edf6';
        g.font = '900 84px Menlo, monospace';
        g.fillText(team.code || '', x, 300);
        g.fillStyle = '#b9bcd6';
        fitText(team.name || '', x, 350, { size: 32, maxW: 280 });
      }
      g.fillStyle = '#e9edf6';
      g.font = '900 118px Menlo, monospace';
      g.fillText(`${sc.a} – ${sc.b}`, W / 2, 316);
      g.fillStyle = '#47f2ff';
      g.font = '700 64px Menlo, monospace';
      g.fillText(st.clock || '', W / 2, 460);
      g.fillStyle = '#8a86a0';
      fitText(state.match?.title || '', W / 2, 520, { size: 30, maxW: W - 88 });
      text = `${a?.code || ''} ${sc.a}-${sc.b} ${b?.code || ''} ${st.clock || ''}`;
    } else if (state.sdk === 'failed') {
      g.textAlign = 'center';
      g.fillStyle = '#8a86a0';
      g.font = '900 96px Menlo, monospace';
      g.fillText('NO SIGNAL', W / 2, 300);
      g.font = '500 34px Menlo, monospace';
      g.fillText('4dgsx.com is not answering — the pitch waits', W / 2, 380);
      text = 'NO SIGNAL';
    } else {
      const nx = state.next;
      g.textAlign = 'center';
      g.fillStyle = '#ffd479';
      g.font = '700 34px Menlo, monospace';
      // Not "NEXT KICK-OFF": the feed's startsAt is when the programme
      // reaches the pitch, and the build-up runs before the whistle. The
      // board counts down to the thing it can actually see arrive.
      g.fillText(nx ? 'NEXT MATCH' : state.live ? 'MATCH LOADING' : 'NO MATCH SCHEDULED', W / 2, 140);
      if (nx) {
        const ms = Date.parse(nx.startsAt) - now();
        g.fillStyle = '#e9edf6';
        g.font = '900 150px Menlo, monospace';
        g.fillText(countdown(ms), W / 2, 300);
        g.fillStyle = '#47f2ff';
        g.font = '700 40px Menlo, monospace';
        g.fillText(`${nx.home?.code || '?'}  v  ${nx.away?.code || '?'}`, W / 2, 372);
        g.fillStyle = '#b9bcd6';
        fitText(`${nx.home?.name || ''} v ${nx.away?.name || ''} · on at ${londonTime(nx.startsAt)} London`, W / 2, 416, { size: 32, maxW: W - 88 });
        text = `next ${nx.home?.code}-${nx.away?.code} in ${countdown(ms)}`;
      } else {
        g.fillStyle = '#8a86a0';
        g.font = '500 34px Menlo, monospace';
        g.fillText(state.sdk === 'loading' ? 'reading the programme…' : 'the programme is empty', W / 2, 300);
        text = 'idle';
      }
      const r = state.recent[0];
      if (r) {
        g.fillStyle = '#8a86a0';
        fitText(`LAST RESULT  ${r.home?.code} ${r.score?.[0] ?? '–'} – ${r.score?.[1] ?? '–'} ${r.away?.code}`, W / 2, 500, { size: 32, maxW: W - 88 });
      }
    }
    if (coarse && !st) {
      g.fillStyle = '#8a86a0';
      g.font = '500 28px Menlo, monospace';
      g.textAlign = 'center';
      g.fillText('matches play on desktop browsers', W / 2, 540);
    }
    state.board = text;
    boardTex.needsUpdate = true;
    if (scoreMesh && scoreMesh.material.map !== boardTex) { scoreMesh.material.map = boardTex; scoreMesh.material.needsUpdate = true; }
  }

  // ---- the screens between matches -------------------------------------------
  //
  // For roughly twenty-two hours a day there is no match, and for all of those
  // hours the big screen and the two side panels were showing the plates they
  // were painted with in Blender. That is fine as scenery and useless as a
  // broadcast: the one thing a viewer arriving between matches wants is when
  // the next one is, and it was on the scoreboard alone, behind them.
  //
  // So the docks carry the programme when nothing is mounted — the big screen
  // a "coming up" card, the left panel the fixtures, the right panel the
  // results. The `screen_main` camera frames all three at once, which is what
  // makes it worth cutting to.
  //
  // The SDK takes the docks over on mount and hands back the AUTHORED plate on
  // unmount, not ours — so re-applying is part of the paint, not a one-off.
  const IDLE_SIZE = { main: [1024, 576], left: [696, 1024], right: [696, 1024] };
  const idleScreens = {};
  for (const slot of Object.keys(dockMeshes)) {
    const [w, h] = IDLE_SIZE[slot] || [1024, 576];
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.flipY = false;            // glTF UVs, like every media node in the city
    tex.anisotropy = 4;
    idleScreens[slot] = { canvas: c, g: c.getContext('2d'), tex };
  }

  /** The common furniture: ground, border, heading, rule. Returns the first baseline. */
  function cardFrame(ctx, W, H, heading) {
    ctx.fillStyle = '#0b0714';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#ffd479';
    ctx.lineWidth = Math.round(W / 128);
    ctx.strokeRect(10, 10, W - 20, H - 20);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffd479';
    ctx.font = `700 ${Math.round(W / 18)}px Menlo, monospace`;
    ctx.fillText(heading, 40, 72);
    ctx.fillStyle = '#31234f';
    ctx.fillRect(40, 92, W - 80, 3);
    return 150;
  }

  /** A column of fixtures or results, one row each. */
  function paintList(slot, heading, rows) {
    const s = idleScreens[slot];
    if (!s) return '';
    const ctx = s.g;
    const W = s.canvas.width;
    const H = s.canvas.height;
    let y = cardFrame(ctx, W, H, heading);
    if (!rows.length) {
      ctx.fillStyle = '#8a86a0';
      ctx.font = '500 30px Menlo, monospace';
      ctx.fillText('nothing listed', 40, y);
    }
    // Sized from the frame, not from the canvas. A side panel is about a tenth
    // of the width of the `screen_main` shot, so a row set at a comfortable
    // reading size for someone standing in the bowl is six pixels on air. Four
    // big rows beat six small ones on both.
    for (const row of rows) {
      if (y > H - 90) break;
      ctx.fillStyle = '#e9edf6';
      fitTextOn(ctx, row.a, 40, y, { weight: 900, size: 62, maxW: W - 80 });
      ctx.fillStyle = row.tone || '#8a86a0';
      fitTextOn(ctx, row.b, 40, y + 48, { size: 38, maxW: W - 80 });
      y += 150;
    }
    s.tex.needsUpdate = true;
    return `${heading}: ${rows.length}`;
  }

  /** The big screen: what is coming, in the largest type that fits. */
  function paintComingUp() {
    const s = idleScreens.main;
    if (!s) return '';
    const ctx = s.g;
    const W = s.canvas.width;
    const H = s.canvas.height;
    cardFrame(ctx, W, H, (state.channelTitle || 'RFL').toUpperCase());
    const nx = state.next;
    ctx.textAlign = 'center';
    if (nx) {
      ctx.fillStyle = '#47f2ff';
      ctx.font = '700 32px Menlo, monospace';
      ctx.fillText('COMING UP', W / 2, 190);
      ctx.fillStyle = '#e9edf6';
      fitTextOn(ctx, `${nx.home?.code || '?'}  v  ${nx.away?.code || '?'}`, W / 2, 300,
        { weight: 900, size: 96, maxW: W - 120 });
      ctx.fillStyle = '#b9bcd6';
      fitTextOn(ctx, `${nx.home?.name || ''} v ${nx.away?.name || ''}`, W / 2, 360,
        { size: 34, maxW: W - 120 });
      ctx.fillStyle = '#ffd479';
      ctx.font = '700 56px Menlo, monospace';
      ctx.fillText(countdown(Date.parse(nx.startsAt) - now()), W / 2, 448);
      ctx.fillStyle = '#8a86a0';
      fitTextOn(ctx, `on at ${londonTime(nx.startsAt)} London`, W / 2, 508, { size: 30, maxW: W - 120 });
    } else {
      ctx.fillStyle = '#8a86a0';
      ctx.font = '500 40px Menlo, monospace';
      ctx.fillText(state.sdk === 'loading' ? 'reading the programme…' : 'no match scheduled', W / 2, 300);
    }
    ctx.textAlign = 'left';
    s.tex.needsUpdate = true;
    return nx ? `coming up ${nx.home?.code}-${nx.away?.code}` : 'idle';
  }

  /**
   * Paint the docks, and make sure they are still ours.
   *
   * Does nothing while a match is mounted: the SDK owns those surfaces then,
   * and painting under it would be a fight nobody wins.
   */
  function paintIdleScreens() {
    if (stage || !Object.keys(idleScreens).length) return;
    const screens = {};
    screens.main = paintComingUp();
    // The slot named `right` is the one that reads on the LEFT of the
    // `screen_main` shot — the camera looks up the +z axis, which puts +x to
    // port. Checked against a render, not reasoned about: fixtures come before
    // results left to right, which is the way round a viewer reads them.
    screens.right = paintList('right', 'FIXTURES', (state.upcoming || []).slice(0, 4).map((i) => ({
      a: `${i.home?.code || '?'}  v  ${i.away?.code || '?'}`,
      b: londonTime(i.startsAt),
    })));
    screens.left = paintList('left', 'RESULTS', (state.recent || []).slice(0, 4).map((i) => ({
      a: `${i.home?.code || '?'} ${i.score?.[0] ?? '–'} – ${i.score?.[1] ?? '–'} ${i.away?.code || '?'}`,
      b: londonTime(i.startsAt),
      tone: '#8a86a0',
    })));
    for (const [slot, mesh] of Object.entries(dockMeshes)) {
      const s = idleScreens[slot];
      if (s && mesh.material.map !== s.tex) { mesh.material.map = s.tex; mesh.material.needsUpdate = true; }
    }
    state.screens = screens;
  }

  // ---- the SDK -----------------------------------------------------------------------
  let gsx = null;
  let slot = null;
  let stage = null;
  let disposed = false;
  let programmeTimer = 0;
  let nowTimer = 0;
  let override = null;
  let overrideDoc = null;
  let mountingNow = null;
  const mutedIds = new Set();
  const gestureFns = [];
  let unsubMute = null;

  function onProgramme(p) {
    if (!p?.items) return;
    skewMs = Date.now() - Date.parse(p.now || new Date().toISOString());
    state.channelTitle = p.channel?.title || null;
    state.live = p.items.find((i) => i.state === 'live') || null;
    // Enough for the screens, not just the scoreboard's one line: between
    // matches the big screen and the two side panels carry the programme, and
    // a panel with a single fixture on it is a panel nobody reads.
    state.upcoming = p.items.filter((i) => i.state === 'upcoming' && i.startsAt)
      .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt)).slice(0, 6)
      .map((i) => ({ home: i.home, away: i.away, startsAt: i.startsAt, title: i.title }));
    state.next = p.items.filter((i) => i.state === 'upcoming' && i.startsAt)
      .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0] || null;
    state.recent = p.items.filter((i) => i.state === 'replay' && i.startsAt)
      .sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt)).slice(0, 6)
      .map((i) => ({ home: i.home, away: i.away, score: i.score, title: i.title, startsAt: i.startsAt }));
    paintBoard();
    paintIdleScreens();
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
      // Which of the publisher's own sources are still sounding. When the PA
      // has taken the commentary over, its source must read off here, or the
      // venue is playing the same voice twice.
      state.sdkAudio = stage.audio.sources.map((x) => ({ id: x.id, on: x.on }));
      pa?.setEnabled(wantOn && state.audio === 'on');
      if (!wantOn) pa?.stop();
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

  function onMount(st, item, source = 'schedule', bundleUrl = null) {
    // A live fixture always wins the pitch: if the stadium was showing a
    // replay when kick-off came round, the replay comes down first, so the
    // two can never be mounted at once.
    if (source === 'schedule' && override) dropOverride();
    stage = st;
    state.source = source;
    state.match = item
      ? { id: item.bundleId, title: item.title, state: item.state }
      : { id: bundleName(bundleUrl || cfg.bundle), title: overrideDoc?.title || bundleName(bundleUrl || cfg.bundle) };
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
    // The PA plays the publisher's own commentary stem through the venue's
    // speakers. The SDK's copy is silenced only once ours is actually playing,
    // so a PA that fails to load leaves commentary audible rather than gone.
    // `item` is absent when a bundle is mounted directly (the fixture's
    // ?bundle=), so the URL has to come from whichever path mounted us.
    const stemFrom = item?.bundleUrl || bundleUrl || cfg.bundle;
    if (pa && stemFrom) {
      pa.load(stemFrom).then((ok) => {
        if (!ok || disposed) return;
        try { st.audio.setOn(pa.state.source, false); } catch (e) { state.errors.push(`pa mute: ${e.message}`); }
        audioPolicy();
      });
    }
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
    pa?.stop();
    if (stage) pitch.remove(stage.group);
    stage = null;
    state.match = null;
    state.docks = [];
    state.stage = null;
    state.source = null;
    state.phase = state.next ? 'countdown' : 'idle';
    paintBoard();
    // The SDK hands back the authored plate, not ours; take the docks back.
    paintIdleScreens();
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
        onMount(st, null, 'bundle', cfg.bundle);
        slot = { dispose() { onUnmount(); st.dispose(); } };
      } catch (e) {
        state.errors.push(`mount: ${e.message || e}`);
        state.phase = 'idle';
        paintBoard();
      }
      return;
    }
    slot = sdk.schedule(cfg.channel || 'rfl', {
      mount: (st, item) => onMount(st, item, 'schedule'),
      unmount: () => onUnmount(),
      onProgramme,
      // The SDK offers a countdown board to stand on the pitch. We decline
      // it: a panel hanging in the air over the turf is a thing that could
      // not be there, and the venue already answers the question it answers —
      // `screen_score` shows the next kick-off, from the same schedule, on a
      // scoreboard that is really mounted on a stand.
      showFixture: () => { if (!stage) state.phase = 'countdown'; },
      hideFixture: () => {},
      pollS: cfg.poll_s || 60,
    });
  }
  // ---- what the CITY says is on ---------------------------------------------
  //
  // A URL parameter can only ever change one browser. RFL's Twitch channel is
  // a dumb capture of this page — whatever the stadium shows, they stream —
  // so the one thing that must not live in a query string is which match is
  // on: a parameter would make their stream and otra.city disagree, which is
  // the split the whole arrangement exists to avoid.
  //
  // `cfg.now` names a small document on our own origin: the city's answer to
  // "what is playing in the stadium right now". Every client that is inside
  // the bowl polls it on the same clock — the module only runs at Tier 2 —
  // so changing that one file puts a match in front of everyone who could
  // see the pitch at all, the broadcast camera among them.
  //
  // The channel's own live fixtures always outrank it. This is for the other
  // twenty-two hours: a replay we chose to put on.
  async function pollNow() {
    if (!cfg.now || disposed) return;
    let doc = null;
    try {
      const r = await fetch(cfg.now, { credentials: 'omit', cache: 'no-store' });
      if (r.ok) doc = await r.json();
    } catch { return; }              // a poll that fails changes nothing
    if (disposed) return;
    const url = typeof doc?.bundle === 'string' ? httpsOnly(doc.bundle) : null;
    if (doc?.bundle && !url) state.errors.push('now: bundle must be an https URL');
    state.now = url ? { bundle: url, title: doc.title || null } : null;
    // A mount is a ~320 MB download that outlives several polls. Without this
    // the next tick would find no `override` yet, conclude nothing was on, and
    // start the download again — and again every sixty seconds until the first
    // one landed. Whatever the document says is reconciled by the poll after
    // the mount finishes, which is soon enough for a thing that takes minutes.
    if (mountingNow) return;
    if (!url) { dropOverride(); return; }
    if (override?.url === url) return;   // already showing it
    dropOverride();
    if (stage) return;                   // a live fixture has the pitch
    overrideDoc = doc;
    await mountOverride(url);
  }

  async function mountOverride(url) {
    const sdk = await ensureSdk();
    if (!sdk || disposed || stage) return;
    state.phase = 'loading';
    mountingNow = url;
    state.loadingNow = url;
    paintBoard();
    try {
      const st = await sdk.mount({ bundleUrl: url, autoplay: false });
      // The download takes minutes; kick-off may have arrived while it ran.
      if (disposed || stage) { st.dispose(); return; }
      override = { url, st };
      onMount(st, null, 'now', url);
    } catch (e) {
      state.errors.push(`now: ${e.message || e}`);
      state.phase = state.next ? 'countdown' : 'idle';
      overrideDoc = null;
      paintBoard();
    } finally {
      mountingNow = null;
      state.loadingNow = null;
    }
  }

  function dropOverride() {
    if (!override) return;
    const { st } = override;
    override = null;
    overrideDoc = null;
    onUnmount();
    try { st.dispose(); } catch (e) { log.warn('match-4dgsx: override dispose', e); }
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
      paintIdleScreens();
      if (coarse) { pollProgrammeOnly(); programmeTimer = setInterval(pollProgrammeOnly, 60000); }
      else {
        startSchedule();
        // A venue pinned to one bundle answers to nobody's schedule, its own
        // included; everywhere else, ask the city what is on.
        if (cfg.now && !cfg.bundle) { pollNow(); nowTimer = setInterval(pollNow, (cfg.poll_s || 60) * 1000); }
      }
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
        if (pa) {
          // reported whether or not it is ready: a PA that failed to load is
          // exactly the thing worth seeing in the state
          state.pa = pa.state;
          if (pa.state.ready) {
            const t = stage.score?.t ?? 0;
            if (!pa.state.playing && state.audio === 'on') pa.start(t);
            pa.sync(t);
            pa.update();            // arrival delays follow the visitor
          }
        }
      }
      boardTimer -= dt;
      if (boardTimer <= 0 || (goalUntil > 0 && goalUntil <= simTime && goalUntil > simTime - dt)) {
        boardTimer = stage ? 0.25 : 1.0;
        paintBoard();
        // Once a second while the pitch is empty: the countdown on the big
        // screen has to tick, and the docks have to stay ours.
        paintIdleScreens();
      }
    },
    dispose() {
      disposed = true;
      clearInterval(programmeTimer);
      clearInterval(nowTimer);
      dropOverride();
      for (const [ev, fn] of gestureFns) removeEventListener(ev, fn);
      gestureFns.length = 0;
      if (unsubMute) unsubMute();
      try { slot?.dispose(); } catch (e) { log.warn('match-4dgsx: dispose', e); }
      slot = null;
      if (stage) { pitch.remove(stage.group); stage = null; }
      pa?.dispose();
      boardTex.dispose();
      for (const s of Object.values(idleScreens)) s.tex.dispose();
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
