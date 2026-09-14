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
import { createPA, mapTime, unmapTime } from '/js/pa-system.js';

// The publisher ships every dynamic body twice: as indexed mesh geometry in
// `prims`/`draws`, and as a surface-sampled gaussian cloud in `points.bin`.
// Their SDK draws one or the other, and the choice is the CALLER'S — `splats`
// defaults to true, which is why the robots have been point clouds since the
// day the stadium opened, with the solid geometry loaded and switched off
// behind them. RFL measured it from the outside (179 hidden meshes against
// 178 body-bound draws) and their exporter comment calls the file "splat
// preview points for the reference viewer": it was built for their own
// player and has been driving the stadium by accident ever since.
//
// A stadium wants bodies, not a preview. So we ask for the meshes — and it is
// not free: measured on s3-m31, 292 draw calls and ~35k triangles become 420
// calls and 2.07M. The call budget is 480, so the headroom drops from 188 to
// 60. Worth it for players you can see the joints of, but a venue that cannot
// afford it can set `"splats": true` in its module config and have the clouds
// back without a code change.
const SPLATS_DEFAULT = false;
// s3-m28 arrived with twelve translucent panels standing on the arena wall:
// 1.6 m of glass above the hoardings, rgba (0.85, 0.9, 1.0, 0.08), put there
// so a lofted ball stays in play. Their physics has already happened — a
// bundle is a recording — so in the stadium the panels do one thing, which is
// render: from the gantry the near one lies across the whole lower half of the
// frame and lifts the dark stripe of the pitch from 68 to 119 red. So they are
// not drawn. `"glass": true` in the module config draws them as the
// publisher's player does, for the day they are wanted back.
//
// What counts as glass is measured, not named — their draws carry no names.
// A translucent draw (alpha under 0.99) whose vertices stand up (more than
// 0.3 m of match-space height) is a panel; the pitch markings are translucent
// too (0.9, 0.95, 0.9, 0.8) but flat, and stay, as do the team benches.
const GLASS_DEFAULT = false;
const GLASS_MIN_HEIGHT = 0.3;
// THE PITCH IS DRAWN AT THE PUBLISHER'S OWN COLOUR, AND THIS IS WHAT IT TOOK.
//
// 4DGSX's own player (4dgsx.com/watch, a hand-written WebGL2 renderer — read
// from their served chunks, 2026-09-14) runs the identical fragment shader
// their three.js SDK carries, and uploads the pitch texture as plain RGBA:
// the shader gets the texels as stored, lights them and writes the result
// straight to the canvas. Their SDK for three tags that same texture
// `SRGBColorSpace`, which three honours by decoding it to linear on the GPU,
// and nothing in their shader encodes it back. So in every three host the
// pitch is a gamma darker than in their player — measured from the gantry,
// light stripe [30,88,31] against their player's [94,166,96] — and before
// 2026-09-14 the city's ACES pass then lifted and greyed it into something
// that matched neither. The texture is retagged here so the sampler hands
// the shader what their player's does; with the stage drawn after the city's
// tone mapping (js/after-tonemap.js) the stripe reads [95,167,97].
//
// Their sprites — name plates, radio bubbles, the attribution mark — are
// built-in SpriteMaterials, which three tone maps on the way to the canvas;
// their player does not, so those are told not to be.
const RAW_TEXTURES = true;
const SDK_URL = 'https://4dgsx.com/sdk/v1/three.js';
const FEED_ORIGIN = 'https://4dgsx.com';
const BOARD_W = 1024;
// The arena's advertising boards. RFL's bundle carries them as flat dark boxes
// (their exporter keeps textured board faces behind a flag their SDK cannot
// yet draw), so the artwork is put on here: one quad per board face, from one
// atlas of their own LED-panel designs, one draw call for the whole ring.
const BOARDS_URL = '/broadcast/boards.json';
const BOARD_PROUD = 0.004;     // metres in front of the bundle's own face — five depth steps at city range
// The head cam: the scorer's own anchor, looking at the ball.
const HEADCAM_FOV = 68;
const HEADCAM_FORWARD = 0.24;  // metres in front of the head centre, along the look
const HEADCAM_UP = 0.03;
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
/**
 * The publisher's glass panels under `group`, by the rule above. Each SDK
 * draw is a Mesh whose ShaderMaterial carries its colour as `uColor`; its
 * geometry indexes a buffer shared by every draw, so the extent has to be
 * taken over the indexed vertices, not the attribute. Match space is Z-up.
 */
function findGlass(group) {
  const panels = [];
  group.traverse((o) => {
    const rgba = o.isMesh ? o.material?.uniforms?.uColor?.value : null;
    if (!rgba || rgba.w >= 0.99) return;
    const pos = o.geometry?.getAttribute('position');
    const idx = o.geometry?.getIndex();
    if (!pos || !idx) return;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < idx.count; i++) {
      const z = pos.getZ(idx.getX(i));
      if (z < lo) lo = z;
      if (z > hi) hi = z;
    }
    if (hi - lo >= GLASS_MIN_HEIGHT) panels.push(o);
  });
  return panels;
}
/**
 * Make the stage under `group` sample and write colour the way the publisher's
 * own player does (see RAW_TEXTURES). Returns what it touched.
 */
function matchPublisherLook(group) {
  const look = { textures: 0, sprites: 0 };
  const seen = new Set();
  group.traverse((o) => {
    const tex = o.isMesh ? o.material?.uniforms?.uTex?.value : null;
    if (tex && tex.colorSpace === THREE.SRGBColorSpace && !seen.has(tex)) {
      seen.add(tex);
      tex.colorSpace = THREE.NoColorSpace;
      // An image still on its way is uploaded by the loader when it lands,
      // with the colour space read then; one already here is re-uploaded.
      if (tex.image) tex.needsUpdate = true;
      look.textures += 1;
    }
    if (o.isSprite && o.material && o.material.toneMapped !== false) {
      o.material.toneMapped = false;
      o.material.needsUpdate = true;
      look.sprites += 1;
    }
  });
  return look;
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
const HALF_NAMES = ['First Half', 'Second Half', 'Third Period', 'Fourth Period'];

/**
 * Where a match is in its own programme: which half, how long is left of it,
 * and whether the whistle has gone.
 *
 * The publisher's `hud.clock` block is the whole of it. From m27:
 *
 *   { mode:"down", duration_s:600, halves:2, half_breaks:[300],
 *     buzzers:[ {kind:"half", t:300, play_end_t:305, restart_t:317},
 *               {kind:"full", t:617, …} ] }
 *
 * Two things about it are easy to get wrong, and RFL warned about both.
 *
 * The stage's own `clock` counts down across the WHOLE match — `duration_s - t`,
 * which we read out of their SDK — while a scorebug counts down within the
 * current half. So the halves are derived here rather than taken from it.
 *
 * And the clock runs on PLAYING time: it stops at the buzzer and does not move
 * again until play restarts. The break is therefore a period of its own, from
 * `buzzers[i].t` to `restart_t`, during which the clock reads nothing left.
 */
export function matchPeriod(hud, t) {
  const c = hud?.clock;
  if (!c || !Number.isFinite(t)) return null;
  const halves = Math.max(1, c.halves || 1);
  const halfLen = (c.duration_s || 0) / halves;
  // Before kick-off the clock has not started. Without this the first half
  // reads 8:00 at t = -180, because the arithmetic is happy to count a half
  // that has not begun.
  if (t < 0) return { tag: HALF_NAMES[0], remain: halfLen, half: 1, over: false, playing: false, preroll: true };
  const buzzers = Array.isArray(c.buzzers) ? c.buzzers : [];
  const breaks = buzzers.filter((b) => b.kind === 'half').sort((a, b) => a.t - b.t);
  const full = buzzers.find((b) => b.kind === 'full');

  if (full && t >= full.t) return { tag: 'Full Time', remain: 0, half: halves, over: true, playing: false };

  for (let i = 0; i < halves; i += 1) {
    const start = i === 0 ? 0 : (breaks[i - 1]?.restart_t ?? 0);
    const end = breaks[i]?.t ?? (full?.t ?? Infinity);
    if (t < end) {
      return { tag: HALF_NAMES[i] || `Period ${i + 1}`, remain: Math.max(0, halfLen - (t - start)),
               half: i + 1, over: false, playing: true };
    }
    // between the buzzer and the restart: the interval
    const restart = breaks[i]?.restart_t;
    if (restart !== undefined && t < restart) {
      return { tag: 'Half Time', remain: 0, half: i + 1, over: false, playing: false };
    }
  }
  return { tag: 'Full Time', remain: 0, half: halves, over: true, playing: false };
}

/** m:ss, the way a clock is read rather than the way a duration is written. */
export function mmss(seconds) {
  const s = Math.max(0, Math.round(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** A bundle URL from shared state is data we hand the SDK: https, or this origin. */
const httpsOnly = (u) => { try { const x = new URL(u, location.href); return x.protocol === 'https:' || x.origin === location.origin ? x.href : null; } catch { return null; } };
function londonTime(iso) {
  try { return new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)); } catch { return ''; }
}

export function create(ctx) {
  const { venue, cfg, root, nodes, camera, renderer, media, log = console } = ctx;
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const useSplats = cfg.splats === true ? true : SPLATS_DEFAULT;
  const showGlass = cfg.glass === true ? true : GLASS_DEFAULT;
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
    source: null, now: null, loadingNow: null, layers: [], splats: useSplats, bug: null, loops: 0,
    // the publisher's name plates and shouts: how many canvas sprites, and how
    // many times one had to be re-allocated because its canvas changed size
    labels: null,
    // the publisher's glass panels: how many the mounted bundle has, and how
    // many of those are not being drawn
    glass: { found: 0, hidden: 0, shown: showGlass },
    // what was changed on the stage so it renders as the publisher's player
    // does: textures sampled as stored, sprites left un-tone-mapped
    look: { textures: 0, sprites: 0 },
    // the programme, and what the big screen and side panels are showing
    upcoming: [], screens: {},
    // the arena boards we dressed, whether the bundle's bodies are reachable,
    // the goals in this match, and the replay + head cam when one is running
    boards: null, bodies: null, goals: [], replay: null, headcam: null, replayCam: false,
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
      const sc = heldScore(st);
      if (sc && st.hud?.teams) g.fillText(`${st.hud.teams[0].code}  ${sc.a} – ${sc.b}  ${st.hud.teams[1].code}`, W / 2, 440);
      text = 'GOAL';
    } else if (st && st.hud) {
      const [a, b] = st.hud.teams || [];
      const sc = heldScore(st) || { a: 0, b: 0 };
      const clock = heldClockOf(st);
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
      g.fillText(clock, W / 2, 460);
      g.fillStyle = '#8a86a0';
      fitText(state.match?.title || '', W / 2, 520, { size: 30, maxW: W - 88 });
      text = `${a?.code || ''} ${sc.a}-${sc.b} ${b?.code || ''} ${clock}`;
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
  let labels = [];
  let disposed = false;
  let programmeTimer = 0;
  let nowTimer = 0;
  let override = null;
  let overrideDoc = null;
  let mountingNow = null;
  // A replay that has run out and is waiting to be sent round again. Guarded so
  // the seek happens once per ending rather than on every frame after it.
  let loopArmed = false;
  // The publisher's match-time -> premix-time map, read from the bundle once
  // per mount. See `buildBug`.
  let audioMap = null;
  // The bundle's `program` block, and where we are in it. A replay is driven
  // through this rather than played straight: see `driveProgramme`.
  let programme = null;
  let programmeT = 0;
  const mutedIds = new Set();
  const gestureFns = [];
  let unsubMute = null;
  // The bundle's body names (from its scene.json), whether the stage's groups
  // were verified to line up with them, and this match's goals.
  let sceneBodies = null;
  let bodyOk = false;
  let goals = [];
  // Whether goal holds are run again from the scorer's head (the broadcast
  // page asks for it; a visitor's client keeps the publisher's dwell).
  let replayCam = false;
  let boardMesh = null;
  let boardsLoad = null;
  let boardsTex = null;
  let lookSmooth = null;
  const _hv = new THREE.Vector3(), _bv = new THREE.Vector3(), _fv = new THREE.Vector3();

  /** The stage's match-space root: one group per body lives directly under it, the static world first. */
  function matchRootOf(st) {
    const g = st?.group;
    return g?.getObjectByName?.('4dgsx-match-space') || g?.children?.[0] || null;
  }

  // ---------------------------------------------------------------- boards
  /**
   * Axis-aligned bounds of ONE mesh's own triangles, in match space.
   *
   * Not `computeBoundingBox`: every prim in the bundle shares one interleaved
   * vertex buffer and differs only in its index range, so three's own bounds
   * would be the whole arena for each of them.
   */
  function aabbOf(mesh) {
    const geo = mesh?.geometry;
    const idx = geo?.index?.array;
    const pos = geo?.attributes?.position;
    if (!idx || !pos) return null;
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let k = 0; k < idx.length; k++) {
      const i = idx[k];
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      if (x < min[0]) min[0] = x; if (x > max[0]) max[0] = x;
      if (y < min[1]) min[1] = y; if (y > max[1]) max[1] = y;
      if (z < min[2]) min[2] = z; if (z > max[2]) max[2] = z;
    }
    return { min, max };
  }
  /**
   * The boards, found by shape rather than by name — the SDK's meshes are
   * unnamed. A board is a thin upright panel: about a centimetre through, the
   * height of a hoarding, and at least a stride long. RFL's are 0.78 m tall
   * and 1.2 to 2.3 m wide; the walls behind them are 0.9 m tall and 0.2 m
   * thick, so nothing else in the arena passes.
   */
  function detectBoards(statics) {
    const out = [];
    for (const m of statics.children) {
      if (!m.isMesh) continue;
      const bb = aabbOf(m);
      if (!bb) continue;
      const e = [bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]];
      if (e[2] < 0.6 || e[2] > 1.0) continue;
      const thinX = e[0] <= 0.03, thinY = e[1] <= 0.03;
      if (thinX === thinY) continue;             // both or neither: not a panel
      const long = thinX ? e[1] : e[0];
      if (long < 0.8) continue;
      out.push({
        c: [(bb.min[0] + bb.max[0]) / 2, (bb.min[1] + bb.max[1]) / 2, (bb.min[2] + bb.max[2]) / 2],
        axis: thinX ? 0 : 1, thick: thinX ? e[0] : e[1], half: long / 2, hz: e[2] / 2,
      });
    }
    return out;
  }
  /**
   * Which artwork goes on which board: RFL's own ring, from their arena
   * builder. Designs alternate along each touchline, the south run offset by
   * one so no two panels meet corner to corner; the south wall's outer face
   * (the band across the bottom of every wide shot) takes the wider panels;
   * an end wall is the league mark above the goal line and the URL below it.
   */
  function assignArtwork(boards, doc) {
    const rects = doc.rects || {};
    const nearest = (design, wm) => {
      let best = null;
      for (const [k, r] of Object.entries(rects)) {
        if (!k.startsWith(`${design}_`)) continue;
        const d = Math.abs((r.w_m || 0) - wm);
        if (!best || d < best.d) best = { r, d };
      }
      return best?.r || null;
    };
    const side = boards.filter((b) => b.axis === 1);
    const innerY = side.length ? Math.min(...side.map((b) => Math.abs(b.c[1]))) : 0;
    const groups = { n: [], s: [], o: [], e: [] };
    for (const b of boards) {
      if (b.axis === 0) groups.e.push(b);
      else if (Math.abs(b.c[1]) > innerY + 0.1) groups.o.push(b);
      else groups[b.c[1] > 0 ? 'n' : 's'].push(b);
    }
    const designs = ['url', 'league'];
    for (const [key, list] of Object.entries(groups)) {
      list.sort((a, b) => a.c[0] - b.c[0] || a.c[1] - b.c[1]);
      list.forEach((b, i) => {
        b.design = key === 'e' ? (b.c[1] > 0 ? 'league' : 'url') : designs[(key === 's' ? i + 1 : i) % 2];
        b.kind = key === 'e' ? 'e' : key === 'o' ? 'o' : 'w';
        b.rect = rects[`${b.design}_${b.kind}`] || nearest(b.design, b.half * 2);
      });
    }
    return boards.filter((b) => b.rect);
  }
  /**
   * One mesh for the whole ring. Both faces of every board are dressed: the
   * one against the wall is inside it and never seen, and drawing both means
   * no rule about which way a board faces has to be right.
   */
  function buildBoardMesh(boards, tex) {
    const P = [], U = [], I = [];
    const up = [0, 0, 1];
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    let n = 0;
    for (const b of boards) {
      for (const sgn of [1, -1]) {
        const nrm = b.axis === 0 ? [sgn, 0, 0] : [0, sgn, 0];
        // The reading direction, seen from in front of this face: text runs to
        // the viewer's right, which is up x normal in a right-handed world.
        const u = cross(up, nrm);
        const o = [b.c[0] + nrm[0] * (b.thick / 2 + BOARD_PROUD), b.c[1] + nrm[1] * (b.thick / 2 + BOARD_PROUD), b.c[2]];
        const corner = (su, sz) => [o[0] + u[0] * su * b.half, o[1] + u[1] * su * b.half, o[2] + sz * b.hz];
        const TL = corner(-1, 1), TR = corner(1, 1), BL = corner(-1, -1), BR = corner(1, -1);
        P.push(...TL, ...BL, ...BR, ...TR);
        const r = b.rect;
        U.push(r.u0, r.v0, r.u0, r.v1, r.u1, r.v1, r.u1, r.v0);
        I.push(n, n + 1, n + 2, n, n + 2, n + 3);
        n += 4;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
    geo.setIndex(I);
    geo.computeVertexNormals();
    // Unlit: an LED board is its own light. The offset keeps it in front of the
    // bundle's face at any distance, on top of the 4 mm it already stands proud.
    const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.FrontSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'otra-boards';
    mesh.frustumCulled = false;
    return mesh;
  }
  function loadBoards() {
    if (boardsLoad) return boardsLoad;
    boardsLoad = (async () => {
      const url = new URL(cfg.boards_url || BOARDS_URL, location.href);
      const r = await fetch(url, { credentials: 'omit' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const doc = await r.json();
      const tex = await new Promise((res, rej) => new THREE.TextureLoader().load(new URL(doc.atlas, url).href, res, undefined, () => rej(new Error('atlas image failed'))));
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.flipY = false;                 // UV (0,0) is the top-left of the atlas, as the manifest reads
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.anisotropy = 4;
      boardsTex = tex;
      return { doc, tex };
    })();
    boardsLoad.catch(() => { boardsLoad = null; });   // a failed fetch is retried on the next mount
    return boardsLoad;
  }
  async function attachBoards(st) {
    if (cfg.boards === false) { state.boards = { off: true }; return; }
    const root = matchRootOf(st);
    const statics = root?.children?.[0];
    let found = [];
    try { found = statics ? detectBoards(statics) : []; } catch (e) { state.errors.push(`boards: ${e.message || e}`); }
    state.boards = { found: found.length, textured: 0, atlas: boardsTex ? 'ready' : 'loading' };
    if (!found.length) { state.boards.atlas = 'unused'; return; }
    let atlas;
    try { atlas = await loadBoards(); } catch (e) { state.errors.push(`boards atlas: ${e.message || e}`); state.boards.atlas = 'failed'; return; }
    if (disposed || stage !== st) return;      // the match came down while the atlas loaded
    const dressed = assignArtwork(found, atlas.doc);
    dropBoards();
    boardMesh = buildBoardMesh(dressed, atlas.tex);
    statics.add(boardMesh);
    state.boards = {
      found: found.length, textured: dressed.length, atlas: 'ready',
      kinds: dressed.reduce((m, b) => { m[b.kind] = (m[b.kind] || 0) + 1; return m; }, {}),
    };
  }
  function dropBoards() {
    if (!boardMesh) return;
    boardMesh.parent?.remove(boardMesh);
    boardMesh.geometry.dispose();
    boardMesh.material.dispose();
    boardMesh = null;
  }

  // ---------------------------------------------------------------- bodies
  /**
   * Whether the stage's groups line up with the bundle's body list.
   *
   * The SDK builds one group per body, in body order, under its match root —
   * the static world at index 0, body i at i + 1 — and hangs each player's
   * nameplate sprite on that body at the player's own anchor offset. That is
   * checkable from outside: every player's sprite must sit where their anchor
   * says, on the group their body index names. If all of them do, the layout
   * is the one we think it is, and any body — the ball included — is
   * reachable by name. If any does not, nothing here is used: a head cam on a
   * guess is worse than none.
   */
  function verifyBodies(st) {
    bodyOk = false;
    state.bodies = null;
    const root = matchRootOf(st);
    const players = st?.hud?.players || [];
    if (!root || !sceneBodies || !players.length) return;
    let checked = 0, agreed = 0;
    for (const p of players) {
      const name = p.anchor?.body;
      if (!name) continue;
      const idx = sceneBodies.indexOf(name);
      if (idx < 0) continue;
      const off = p.anchor.offset || [0, 0, 0];
      const node = root.children[idx + 1];
      checked += 1;
      const near = (a, b) => Math.abs(a - b) < 1e-4;
      if (node && node.children.some((c) => c.isSprite && near(c.position.x, off[0]) && near(c.position.y, off[1]) && near(c.position.z, off[2]))) agreed += 1;
    }
    bodyOk = checked > 0 && agreed === checked && root.children.length >= sceneBodies.length + 1;
    state.bodies = { checked, agreed, ok: bodyOk, ball: sceneBodies.includes('ball') };
  }
  /** The group that carries a body's transform, by the bundle's own name for it. Null unless verified. */
  function bodyNode(name) {
    if (!bodyOk || !stage) return null;
    const i = sceneBodies.indexOf(name);
    return i < 0 ? null : (matchRootOf(stage)?.children[i + 1] || null);
  }
  /**
   * Whether this module is driving the stage through the programme map.
   *
   * Only a replay the city put on. A scheduled fixture's clock is the
   * publisher's wall clock; `programme` is still read from its scene.json
   * (the map is useful for the offset) but `programmeT` never advances for
   * it, so reading the match time through the map there says "pre-roll" for
   * the whole match — which is what production did to m33 on 2026-09-14:
   * the bug showed the countdown, the director stayed on the ambient list
   * through the live match, and `audioOffset` read 0.
   */
  function driving() {
    return state.source === 'now' && !!programme?.map;
  }
  /** Match time as the programme has it while we drive; the stage's own otherwise. */
  function programmeMatchT() {
    return driving() ? unmapTime(programme.map, programmeT) : (stage?.time ?? 0);
  }
  /** The stage's score, except during a replay, when it is the score at the held time — the stage is rewound. */
  function heldScore(st) {
    return (st?.hud && state.replay ? scoreAtT(st.hud, programmeMatchT()) : null) || st?.score || null;
  }
  let heldClock = '';
  /** The stage's presentation clock, frozen while a replay runs. */
  function heldClockOf(st) {
    if (!state.replay) heldClock = st?.clock || '';
    return heldClock;
  }
  /** The score at match time t from the publisher's own steps — right even while the stage is rewound for a replay. */
  function scoreAtT(hud, t) {
    const steps = hud?.score;
    if (!Array.isArray(steps) || !steps.length) return null;
    let cur = null;
    for (const s of steps) { if (typeof s?.t === 'number' && s.t <= t + 1e-6) cur = s; else if (typeof s?.t === 'number') break; }
    return cur ? { t: cur.t, a: cur.a ?? 0, b: cur.b ?? 0 } : { t, a: 0, b: 0 };
  }
  /** The programme-map hold that programme time pT is inside, or null: a span of programme time mapped to ONE match instant. */
  function holdAt(map, pT) {
    for (let i = 0; i < map.length - 1; i++) {
      const [t0, p0] = map[i], [t1, p1] = map[i + 1];
      if (pT >= p0 && pT < p1 && t0 === t1 && p1 > p0) return { t: t0, p0, p1 };
    }
    return null;
  }
  /**
   * Where the head cam is this frame, in venue-local metres — the frame every
   * camera on /broadcast speaks. The scorer's anchor is head height on their
   * pelvis body (0.62 m up, RFL's own number); it looks at the ball, because
   * the ball is the story and a pelvis has no agreed forward axis. The look
   * target is smoothed a little so a bouncing ball does not shake the frame.
   */
  function poseHeadcam(dt) {
    const r = state.replay;
    if (!r || !bodyOk || !stage) { state.headcam = null; lookSmooth = null; return; }
    const p = (stage.hud?.players || []).find((x) => x.id === r.player);
    const node = p?.anchor?.body ? bodyNode(p.anchor.body) : null;
    if (!node) { state.headcam = null; return; }
    const off = p.anchor.offset || [0, 0, 0.6];
    node.updateWorldMatrix(true, false);
    _hv.set(off[0], off[1], off[2]).applyMatrix4(node.matrixWorld);
    const ball = bodyNode('ball');
    if (ball) { ball.updateWorldMatrix(true, false); _bv.setFromMatrixPosition(ball.matrixWorld); }
    else { pitch.updateWorldMatrix(true, false); _bv.setFromMatrixPosition(pitch.matrixWorld); }
    root.updateWorldMatrix(true, false);
    root.worldToLocal(_hv);
    root.worldToLocal(_bv);
    if (!lookSmooth) lookSmooth = _bv.clone();
    else lookSmooth.lerp(_bv, 1 - Math.exp(-Math.max(0, dt) / 0.12));
    // In front of the face, not inside the head: the anchor is the centre of
    // the head, and a camera there films the inside of it and the shoulders
    // below. Step out along the horizontal look direction, a little above.
    _fv.subVectors(lookSmooth, _hv); _fv.y = 0;
    if (_fv.lengthSq() > 1e-6) { _fv.normalize(); _hv.addScaledVector(_fv, HEADCAM_FORWARD); }
    _hv.y += HEADCAM_UP;
    state.headcam = {
      pos: [+_hv.x.toFixed(3), +_hv.y.toFixed(3), +_hv.z.toFixed(3)],
      lookAt: [+lookSmooth.x.toFixed(3), +lookSmooth.y.toFixed(3), +lookSmooth.z.toFixed(3)],
      fov: HEADCAM_FOV, player: r.player,
    };
  }

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
    // The scheduled path mounts inside `sdk.schedule()`, which takes no mount
    // options, so a stage that arrived that way is told here instead. Same
    // switch either way — `setSplats` is public on the stage.
    try { st.setSplats?.(useSplats); } catch (e) { state.errors.push(`splats: ${e.message}`); }
    // A live fixture always wins the pitch: if the stadium was showing a
    // replay when kick-off came round, the replay comes down first, so the
    // two can never be mounted at once.
    if (source === 'schedule' && override) dropOverride();
    stage = st;
    state.source = source;
    // The bundle's own URL, said plainly.
    //
    // RFL's audio supervisor takes the bundle base off a media element's
    // `currentSrc` — "the path the page actually fetched" — which was sound
    // reasoning about a page that attached their video dock. This one does not
    // any more: the big screen carries our live feed, so their `panels.video`
    // is never attached and that element may not exist. Rather than keep a
    // second video decoding to feed a string they need, the string is reported.
    const url = item?.bundleUrl || bundleUrl || cfg.bundle || null;
    state.matchItem = item ? { home: item.home || null, away: item.away || null } : null;
    state.match = item
      ? { id: item.bundleId, title: item.title, state: item.state, bundleUrl: url }
      : { id: bundleName(url), title: overrideDoc?.title || bundleName(url), bundleUrl: url };
    st.group.position.set(0, 0, 0);
    pitch.add(st.group);
    goals = (st.hud?.events || []).filter((e) => e?.type === 'goal');
    state.goals = goals.map((g) => ({ t: g.t, player: g.player ?? null, team: g.team ?? null, replay_s: g.replay_s ?? null }));
    state.replay = null;
    state.headcam = null;
    attachBoards(st);
    labels = collectLabels(st.group);
    state.labels = { sprites: labels.length, refits: 0 };
    // The glass, found now because the SDK has built every draw by the time
    // `mount()` resolves. `setSplats` above only ever touches dynamic bodies,
    // so nothing puts a panel back.
    try {
      const panels = findGlass(st.group);
      if (!showGlass) for (const p of panels) p.visible = false;
      state.glass = { found: panels.length, hidden: showGlass ? 0 : panels.length, shown: showGlass };
    } catch (e) { state.errors.push(`glass: ${e.message}`); }
    // The pitch texture is created by the SDK at mount and filled when its
    // image lands; retagging it now is in time, because three reads the
    // colour space when it uploads.
    if (RAW_TEXTURES) {
      try { state.look = matchPublisherLook(st.group); } catch (e) { state.errors.push(`look: ${e.message}`); }
    }
    state.docks = [];
    for (const [slotName, mesh] of Object.entries(dockMeshes)) {
      // One slot can be reserved for the venue's own live feed — the big
      // screen showing the broadcast rather than a recording of it. The
      // publisher's dock is not attached there, so nothing decodes a video
      // into a texture that would immediately be painted over.
      if (slotName === cfg.live_screen) { state.docks.push({ slot: slotName, attached: false, reason: 'live screen' }); continue; }
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
    // The map lives in the bundle's scene.json, which the SDK has already
    // fetched, so this is a cache hit rather than a download. Failure is not
    // worth an error: it costs `audioOffset` and nothing else.
    audioMap = null;
    programme = null;
    programmeT = 0;
    sceneBodies = null;
    bodyOk = false;
    state.bodies = null;
    if (url) {
      fetch(`${String(url).replace(/\/+$/, '')}/scene.json`, { credentials: 'omit' })
        .then((r) => (r.ok ? r.json() : null))
        .then((scene) => {
          if (disposed || stage !== st) return;
          audioMap = scene?.audio?.map || null;
          programme = scene?.program || null;
          // The body list is what makes a body reachable by name; checked
          // against the stage before anything trusts it.
          sceneBodies = Array.isArray(scene?.bodies) ? scene.bodies.slice() : null;
          verifyBodies(st);
        })
        .catch(() => { /* no map, no offset, no harm */ });
    }
    // A goal the replay runs across again is the same goal: no second flash.
    st.on('event', (e) => { if (e.type === 'goal' && !state.replay) { goalUntil = simTime + 4; paintBoard(); } });
    st.on('statechange', (s) => { state.stage = s; paintBoard(); });
    state.stage = st.state;
    // What the publisher's own UI offers and whether it is on. Their layer
    // list is the difference between drawing a scorebug ourselves and asking
    // for theirs, and it is not knowable from the outside without this.
    try { state.layers = (st.layers || []).map((l) => ({ ...l })); } catch { state.layers = []; }
    if (!item || item.state === 'replay') st.play();
    state.phase = 'match';
    armGesture();
    audioPolicy();
    paintBoard();
  }
  /**
   * Everything a broadcast scorebug needs, from the publisher's own truth.
   *
   * Derived here rather than in the page because this is where `stage.hud`
   * lives: the page knows the frame, the module knows the match, and neither
   * has to learn the other's job.
   */
  function buildBug() {
    if (!stage) return null;
    const hud = stage.hud;
    const teams = hud?.teams;
    if (!teams || teams.length < 2) return null;
    // WHERE THE MATCH ACTUALLY IS, which is not always where the stage is.
    //
    // The stage's clock is bounded by its dynamic track — `scene.times`, the
    // match only — so a seek into the pre-roll clamps to the first frame and
    // the bodies hold the kick-off pose. That is exactly the picture the
    // pre-roll wants, and RFL say so ("bodies: hold"), but it means
    // `stage.time` reads 0 for the whole build-up. Believing it would start the
    // match clock three minutes early, which is the bug we are here to fix.
    //
    // So when the programme is driving, the programme decides.
    const t = programmeMatchT();
    const period = matchPeriod(hud, t);
    if (!period) return null;
    // From the publisher's steps at the PROGRAMME's match time, not from the
    // stage: during a replay the stage is rewound to before the goal, and the
    // score must not go back with it.
    const sc = scoreAtT(hud, t) || stage.score || { a: 0, b: 0 };
    // A crest URL rides through from wherever RFL put one: `crest` (what we
    // asked for) or `badge` (the field their feed's own type reserves), on the
    // hud team or on the programme item. None today; the scorebug falls back.
    const item = state.matchItem || {};
    const team = (t, side) => ({
      code: t.code || '', name: t.name || '',
      color: Array.isArray(t.color) ? t.color.slice(0, 3) : [0.5, 0.5, 0.5],
      crest: t.crest || t.badge || item[side]?.crest || item[side]?.badge || null,
    });
    return {
      home: team(teams[0], 'home'), away: team(teams[1], 'away'),
      a: sc.a ?? 0, b: sc.b ?? 0,
      tag: period.tag, clock: mmss(period.remain),
      half: period.half, playing: period.playing, over: period.over,
      // Only a genuinely scheduled fixture wears LIVE. A replay the city put
      // on must not, and the publisher's own state is what distinguishes them
      // — RFL asked us to use their truth rather than fake it.
      live: stage.state === 'live',
      // a goal being run again from the scorer's head
      replay: !!state.replay,
      // WHERE THE SOUND SHOULD BE, and why this is here rather than left to
      // whoever is playing it.
      //
      // RFL play the premix themselves and used to take the offset from a
      // media element's currentTime — correct, because it accounts for the
      // goal replays that hold the match clock while the audio runs on. We
      // removed that element when the big screen stopped carrying their video,
      // and the symptom was commentary arriving three minutes late: their
      // premix opens with a 180 s pre-roll that is digital silence, so playing
      // it unseeked against a picture at kick-off sounds exactly like that.
      //
      // `t` is the match clock. `audioOffset` is where the premix should be,
      // through the publisher's own map, replay holds and all. Neither needs
      // a surface we happen to be drawing.
      t: +t.toFixed(3),
      // While the programme drives, the offset IS the programme clock: RFL's
      // `program.map` and `audio.map` are the same array, so mapping back and
      // forth would be arithmetic in a circle.
      audioOffset: driving() ? +programmeT.toFixed(3)
                 : audioMap ? +mapTime(audioMap, t).toFixed(3) : null,
      // where in the whole programme, and which of its three parts — only
      // meaningful while we drive; a live fixture is wherever its clock is
      programmeT: driving() ? +programmeT.toFixed(3) : null,
      segment: programme ? (programme.segments || []).find((g) => t >= g.t[0] && t <= g.t[1])?.id ?? null : null,
      preroll: period.preroll === true,
    };
  }

  /**
   * Send a finished replay round again.
   *
   * A match ends and the stage holds on the last frame, which for a scheduled
   * fixture is right — the programme is over. For a replay the city put on it
   * is not: the stadium stops being a broadcast and becomes a photograph of
   * one, and it stays that way until somebody notices. m27, m31 and m30 all
   * froze on Full Time before this existed.
   *
   * `seek` rather than a re-mount, which matters: a re-mount is another 320 MB
   * off the CDN for every client in the bowl, and the stage already holds the
   * whole match. Looping is opt-in per replay, because a fixture that is meant
   * to end should end.
   */
  /**
   * Put a replay where the PROGRAMME says, not where playing straight would.
   *
   * RFL pin a premiere to the stream start, so programme t = 0 is the first
   * frame to Twitch and the match kicks off 180 s later. The bundle has carried
   * the mapping all along in `program.map` — the same array as `audio.map`,
   * which we were already using for the premix — and it is the picture's copy
   * of it.
   *
   * Driving through it rather than advancing the match clock is what buys the
   * build-up and the outro, and it is also the only way the goal replays come
   * out right: a duplicated match time in the map is broadcast time inserted
   * with the match clock stopped, so the picture must DWELL there while the
   * programme runs on. Playing the match straight skips every one of them.
   */
  function driveProgramme(dt) {
    if (state.source !== 'now' || !stage || !programme?.map) return;
    const total = programme.duration_s || 0;
    programmeT += dt;
    if (total > 0 && programmeT >= total) {
      if (!state.now?.loop) { programmeT = total; }
      else { programmeT = 0; state.loops += 1; goalUntil = -1; }
    }
    let want = unmapTime(programme.map, programmeT);
    // THE GOAL REPLAY. A hold in the map is broadcast time inserted with the
    // match clock stopped, and RFL's holds sit exactly on their goals, each
    // exactly `replay_s` long (measured on m32: sixteen holds, fifteen goals,
    // every delta 0.0). Their own render showed the goal again in that span;
    // the stadium dwelled. When the broadcast page asks, the span is used for
    // what it was cut for: the stage runs the last `replay_s` seconds up to
    // the goal once more, while the programme clock — and so the scorebug's
    // clock and score — stays put. Only where this module drives time: a
    // live fixture's clock is the publisher's wall clock and cannot rewind.
    let replay = null;
    if (replayCam) {
      const hold = holdAt(programme.map, programmeT);
      const goal = hold && goals.find((g) => Math.abs(g.t - hold.t) < 0.05);
      if (goal) {
        const len = goal.replay_s || (hold.p1 - hold.p0);
        const frac = Math.min(1, Math.max(0, (programmeT - hold.p0) / (hold.p1 - hold.p0)));
        want = Math.max(stage.t0 ?? 0, hold.t - len + frac * len);
        replay = { player: goal.player ?? null, team: goal.team ?? null, goalT: hold.t, t: +want.toFixed(2), progress: +frac.toFixed(3) };
      }
    }
    state.replay = replay;
    try {
      if (typeof stage.seek === 'function') stage.seek(want); else stage.time = want;
    } catch (e) { state.errors.push(`programme: ${e.message || e}`); }
  }

  function loopReplay() {
    // `state.now` and not `overrideDoc`: the latter is captured at mount and
    // would be a stale copy of the document for as long as the replay runs,
    // so turning looping on for something already playing would do nothing.
    // The poll refreshes `state.now` every minute whether the bundle changed
    // or not, which is exactly the freshness this needs.
    // Once the programme is driving, IT owns the wrap — at the end of the
    // post-roll, not at the full-time whistle, which is 180 s earlier and
    // would cut the outro off.
    if (programme?.map) { loopArmed = false; return; }
    if (state.source !== 'now' || !state.now?.loop || !stage) { loopArmed = false; return; }
    if (!state.bug?.over) { loopArmed = false; return; }
    if (loopArmed) return;
    loopArmed = true;
    const back = stage.t0 ?? 0;
    try {
      if (typeof stage.seek === 'function') stage.seek(back); else stage.time = back;
      stage.play?.();
      state.loops += 1;
      goalUntil = -1;                 // a goal from the last time round is not news
      paintBoard();
    } catch (e) { state.errors.push(`loop: ${e.message || e}`); }
  }

  /**
   * Every canvas sprite the SDK hung on the stage: the name plates, the shouts
   * ("radio bubbles"), its attribution mark, its fixture board. Only the shouts
   * ever change size, but the list is cheap and the rule below is a no-op for
   * a canvas that stays put.
   */
  function collectLabels(group) {
    const found = [];
    group.traverse((o) => {
      const map = o.isSprite ? o.material?.map : null;
      if (map?.isCanvasTexture && map.image) found.push({ map, w: map.image.width, h: map.image.height });
    });
    return found;
  }
  /**
   * The SDK draws each shout on a canvas it RESIZES for every line — a new
   * width per message, a new height when one wraps — and hands three the same
   * CanvasTexture with needsUpdate set. Since r137 three allocates a texture's
   * storage ONCE, immutable, at the size of the first upload (texStorage2D);
   * every later upload is a sub-image into that allocation. A canvas that grew
   * is refused outright — INVALID_VALUE, nothing logged, the previous text now
   * stretched over the bigger sprite — and one that shrank lands in a corner
   * of the old pixels, so the last shout shows through beside the new one.
   * That is "got it" in forty-point letters next to a two-line ghost, and
   * it is what every bubble looked like from its second message on.
   *
   * Their API does not say when the text changed, but the canvas does. When a
   * label's canvas is not the size it was, dispose the texture: that frees the
   * GPU copy and nothing else, so the next render allocates it again, at the
   * right size, from the object the SDK still holds. Runs after the SDK's
   * update, which is the only place it sets text, and before the frame is
   * drawn.
   */
  function refitLabels() {
    for (const l of labels) {
      const img = l.map.image;
      if (img.width === l.w && img.height === l.h) continue;
      l.w = img.width;
      l.h = img.height;
      l.map.dispose();
      if (state.labels) state.labels.refits += 1;
    }
  }

  function onUnmount() {
    pa?.stop();
    dropBoards();
    if (stage) pitch.remove(stage.group);
    stage = null;
    goals = [];
    state.goals = [];
    state.replay = null;
    state.headcam = null;
    state.bodies = null;
    state.boards = null;
    bodyOk = false;
    sceneBodies = null;
    labels = [];
    state.labels = null;
    state.match = null;
    state.matchItem = null;
    state.docks = [];
    state.stage = null;
    state.source = null;
    state.bug = null;
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
        const st = await sdk.mount({ bundleUrl: cfg.bundle, autoplay: false, splats: useSplats });
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
    // `audio` is carried through because /broadcast reads it: the page is
    // silent by contract with RFL, and this is the one thing that lifts it.
    state.now = url ? { bundle: url, title: doc.title || null, audio: doc.audio === true, loop: doc.loop === true } : null;
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
      const st = await sdk.mount({ bundleUrl: url, autoplay: false, splats: useSplats });
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
        driveProgramme(dt);
        poseHeadcam(dt);
        // Read AFTER the programme has placed the stage, and held through a
        // replay: RFL's supervisor reads these, and a score that dips for five
        // seconds every goal is a fault however good the picture.
        state.score = heldScore(stage);
        state.clock = heldClockOf(stage) || null;
        state.bug = buildBug();
        loopReplay();
        refitLabels();
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
      dropBoards();
      boardsTex?.dispose();
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
    /**
     * The stage, for a page that tone maps: their shader writes display-ready
     * colour, so a composer must draw it AFTER its output pass, not through
     * it (js/after-tonemap.js). Null while nothing is mounted.
     */
    afterToneMap() { return stage?.group ?? null; },
    /**
     * Put the mounted match at `t`, in match seconds. Returns where it landed.
     *
     * For a harness. Nothing in the venue calls it: a scheduled fixture is the
     * publisher's to position and a replay plays from its own start. It exists
     * because the end of a match is seventeen minutes away and the things that
     * happen there — the loop, Full Time on the board — were otherwise beyond
     * reach of any test that could run in CI.
     */
    /**
     * Run goal holds again from the scorer's head. Off by default: a visitor
     * in the bowl sees the players wait, as the publisher's programme has it;
     * the broadcast page turns this on, because on air the hold IS the replay.
     */
    replayCam(on) {
      replayCam = on !== false;
      state.replayCam = replayCam;
      return replayCam;
    },
    seek(t) {
      if (!stage) return null;
      try {
        // While the programme drives, moving the stage is pointless — the next
        // tick puts it back. Move the programme clock instead, and let it
        // place the stage as it does every frame.
        if (programme?.map) { programmeT = mapTime(programme.map, t); return t; }
        if (typeof stage.seek === 'function') stage.seek(t); else stage.time = t;
        state.bug = buildBug();
        paintBoard();
        return stage.time ?? null;
      } catch (e) { state.errors.push(`seek: ${e.message || e}`); return null; }
    },
    get state() { return { ...state, errors: state.errors.slice(-5) }; },
  };
}
