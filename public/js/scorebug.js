// The broadcast scorebug: the graphics a television feed wears.
//
// RFL asked us to take this over (their note of 2026-09-14, §2) and sent the
// spec their own renderer used. Three reasons it belongs here rather than in
// their encoder, all of them theirs and all of them right: the data is already
// in the bundle they send us; `/broadcast` is not the page visitors walk
// around, so an overlay here reaches the stream and nobody else; and we know
// the frame — they had already watched us catch a panel whose type was "about
// six pixels on air".
//
// Their SDK does carry a `match.scorebug` layer, and it is on. It reports
// `scene: false`: it draws into their own HTML viewer and cannot reach a frame
// we composite. So this is not a duplicate of something we could have switched
// on — it is the thing that was missing.
//
// EVERYTHING IS IN AN 854 x 480 LAYOUT SPACE, scaled to the real frame. That
// is how theirs worked and it is why the spec talks in proportions: the same
// numbers land correctly at 1280 x 720 or anywhere else.
//
// CRESTS. The spec draws a club's crest at 26 x 26 at both ends of the bottom
// bar and falls back to a kit chip. A `crest` URL on the team object (RFL's
// data, when they publish one) is used first; otherwise the city's own copy,
// keyed by the club CODE the feed and hud.json both carry, from
// `/broadcast/crests.json`. Images arrive after the first paint, so a load
// invalidates the last-drawn key and the next frame repaints.
import * as THREE from 'three';

const LAYOUT_W = 854;
const LAYOUT_H = 480;
const PANEL = 'rgba(12,12,18,0.84)';
const PANEL_SOLID = 'rgba(12,12,18,0.89)';
const YELLOW = 'rgb(255,235,160)';
const CLOCK_BLUE = 'rgb(170,200,255)';
const TAG_GREY = 'rgb(150,160,190)';
const DIVIDER = 'rgb(255,200,60)';
const CENTRE_BLOCK = 'rgb(26,28,44)';
const LIVE_RED = 'rgb(235,55,45)';
const REPLAY_AMBER = 'rgb(255,190,60)';
const CRESTS_URL = '/broadcast/crests.json';

const rgb = (c) => `rgb(${c.slice(0, 3).map((v) => Math.round(v * 255)).join(',')})`;

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
  g.fill();
}

/** One line, shrunk to fit `maxW` and then ellipsised if it still will not. */
function fitTextOn(ctx, text, x, y, { weight = 500, size, maxW, minSize = Math.round(size * 0.66) }) {
  let s = size;
  let t = String(text ?? '');
  const font = (n) => `${weight} ${Math.round(n)}px Menlo, monospace`;
  ctx.font = font(s);
  while (ctx.measureText(t).width > maxW && s > minSize) { s -= 1; ctx.font = font(s); }
  while (ctx.measureText(t).width > maxW && t.length > 1) t = `${t.slice(0, -2)}…`;
  ctx.fillText(t, x, y);
}

/**
 * @param {object} o
 * @param {number} o.width   the real frame, in pixels
 * @param {number} o.height
 */
export function createScorebug({ width, height, crests = CRESTS_URL } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;

  // A quad in front of an orthographic camera, drawn over the composited frame
  // without clearing it. Cheaper and more predictable than a post pass, and it
  // leaves the composer's chain alone.
  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false });
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));

  const S = width / LAYOUT_W;          // one scale for both axes: the spec is 16:9
  const px = (v) => v * S;
  const font = (weight, size) => `${weight} ${Math.round(px(size))}px Menlo, monospace`;
  let painted = null;

  // ---- crests -------------------------------------------------------------
  // code -> url, from the city's manifest; a publisher URL on the team wins.
  let manifest = null;               // null until fetched; {} if it failed
  const images = new Map();          // url -> { img, ok }
  const crestStat = { manifest: 'loading', loaded: 0, failed: 0 };
  if (crests) {
    fetch(crests, { credentials: 'omit' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((doc) => {
        const base = new URL(crests, location.href);
        manifest = {};
        for (const [code, file] of Object.entries(doc?.crests || {})) manifest[code] = new URL(file, base).href;
        crestStat.manifest = 'ready';
        painted = null;              // whatever is up gets its crests next frame
      })
      .catch(() => { manifest = {}; crestStat.manifest = 'failed'; });
  } else { manifest = {}; crestStat.manifest = 'off'; }
  const crestUrlFor = (team) => team?.crest || team?.badge || (manifest && team?.code ? manifest[team.code] : null) || null;
  /** The image for a URL if it has arrived; starts the load the first time. */
  function crestImage(url) {
    if (!url) return null;
    let rec = images.get(url);
    if (!rec) {
      const img = new Image();
      // Same-origin for the city's copies; a publisher's CDN must send CORS
      // headers, or a tainted canvas could never become a texture.
      img.crossOrigin = 'anonymous';
      rec = { img, ok: false };
      images.set(url, rec);
      img.onload = () => { rec.ok = true; crestStat.loaded += 1; painted = null; };
      img.onerror = () => { rec.ok = false; rec.failed = true; crestStat.failed += 1; };
      img.src = url;
    }
    return rec.ok ? rec.img : null;
  }

  /** Draw one state. Returns false when nothing changed and the canvas was left alone. */
  function draw(bug) {
    const key = bug && JSON.stringify(bug);
    if (key === painted) return false;
    painted = key;
    g.clearRect(0, 0, width, height);
    if (!bug) { tex.needsUpdate = true; return true; }

    const W = LAYOUT_W;

    // ---- a. the compact bug, top left ------------------------------------
    g.fillStyle = PANEL;
    roundRect(g, px(10), px(8), px(374), px(30), px(7));
    const midY = px(23);
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    let x = px(20);
    const chip = (colour) => { g.fillStyle = colour; g.fillRect(x, midY - px(8), px(14), px(16)); x += px(14) + px(6); };
    const word = (text, colour, weight = 700) => {
      g.fillStyle = colour; g.font = font(weight, 15);
      g.fillText(text, x, midY); x += g.measureText(text).width + px(8);
    };
    chip(rgb(bug.home.color));
    word(bug.home.code, '#ffffff');
    word(`${bug.a} - ${bug.b}`, YELLOW, 900);
    word(bug.away.code, '#ffffff');
    chip(rgb(bug.away.color));

    g.textAlign = 'right';
    g.fillStyle = CLOCK_BLUE;
    g.font = font(700, 15);
    g.fillText(bug.clock, px(372), midY);
    const clockW = g.measureText(bug.clock).width;
    g.fillStyle = TAG_GREY;
    g.font = font(500, 15);
    g.fillText(bug.tag, px(372) - clockW - px(10), midY);

    // ---- b. LIVE, top right — only when it really is ---------------------
    // ...and REPLAY while a goal is being run again from the scorer's head,
    // which outranks LIVE for those seconds: a live match's replay is still a
    // replay, and a viewer must never take a second look for the goal itself.
    const tag = bug.replay ? { text: 'REPLAY', colour: REPLAY_AMBER, w: 92 }
              : bug.live ? { text: 'LIVE', colour: LIVE_RED, w: 66 } : null;
    if (tag) {
      const x0 = W - 12 - tag.w;
      g.fillStyle = PANEL;
      roundRect(g, px(x0), px(8), px(tag.w), px(26), px(7));
      g.fillStyle = tag.colour;
      g.beginPath();
      g.arc(px(x0 + 15), px(21), px(5), 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#ffffff';
      g.font = font(700, 14);
      g.textAlign = 'left';
      g.fillText(tag.text, px(x0 + 26), px(21));
    }

    // ---- c. the full scoreboard, bottom centre ---------------------------
    const cx = px(W / 2);
    const top = height - px(46);
    const barH = px(34);
    const half = px(210);        // the spec fixes the inner geometry, not the width
    g.fillStyle = PANEL_SOLID;
    roundRect(g, cx - half, top, half * 2, barH, px(9));
    g.fillStyle = CENTRE_BLOCK;
    g.fillRect(cx - px(46), top, px(92), barH);
    const midBar = top + barH / 2;

    g.textAlign = 'center';
    g.fillStyle = '#ffffff';
    g.font = font(900, 22);
    g.fillText(String(bug.a), cx - px(16), midBar);
    g.fillText(String(bug.b), cx + px(16), midBar);

    g.fillStyle = DIVIDER;
    g.fillRect(cx - px(1), top + px(6), px(2), barH - px(12));

    // Fitted to the space, not clipped at a character count. "Synthetic
    // Athletic" is eighteen characters and ran under the away kit chip: a
    // 26-character limit is a guess about width made in units that are not
    // width. The gap is from the name's inner edge to the chip, less a margin.
    const nameW = px(210 - 58 - 40);
    g.fillStyle = '#e9edf6';
    g.textAlign = 'right';
    // Both in REAL pixels: `fitTextOn` measures against the canvas, and
    // everything else in this function speaks layout units through px().
    fitTextOn(g, bug.home.name, cx - px(58), midBar, { size: px(15), maxW: nameW });
    g.textAlign = 'left';
    fitTextOn(g, bug.away.name, cx + px(58), midBar, { size: px(15), maxW: nameW });

    // The crest at 26 x 26 where the spec puts it; the kit chip until one has
    // loaded, and for good if the club has none.
    const crest = (team, x) => {
      const img = crestImage(crestUrlFor(team));
      if (img) { g.drawImage(img, x, midBar - px(13), px(26), px(26)); return; }
      g.fillStyle = rgb(team.color);
      g.fillRect(x + px(6), midBar - px(7), px(14), px(14));
    };
    crest(bug.home, cx - half + px(8));
    crest(bug.away, cx + half - px(8) - px(26));

    tex.needsUpdate = true;
    return true;
  }

  return {
    draw,
    /** Lay it over whatever is already in the buffer. */
    render(renderer) {
      const wasAutoClear = renderer.autoClear;
      renderer.autoClear = false;
      renderer.render(scene, cam);
      renderer.autoClear = wasAutoClear;
    },
    /** Whether the crests are there: the manifest, and how many images landed. */
    get crests() { return { ...crestStat }; },
    crestFor: (team) => crestUrlFor(team),
    dispose() { tex.dispose(); mat.dispose(); for (const r of images.values()) r.img.src = ''; images.clear(); },
  };
}
