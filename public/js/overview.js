// The front door, and the pause map: the city from above, at night, the way a
// game shows its map. Dark water, the island the streets stand on, roads as
// warm ribbons of light, every claimed lot a lit block in its category's
// colour, names along the roads. Click a building and its card opens; Enter
// zooms the map into that building and the 3D city takes over, spawning you
// on the pavement outside it (index.html runs the camera swoop; this module
// only animates the map and says when to go).
//
// Two ways in. `mode: 'door'` is a bare "/" — the visitor has not been in the
// world yet, and "Walk in" drops them at the spawn. `mode: 'resume'` is the
// map opened FROM the world (the Map button, the M key, the browser's Back):
// it shows where the visitor is standing, Escape or "Resume walking" puts
// them back exactly there, and Enter on a card teleports them.
//
// Drawn in two layers so a phone can pan and pinch without stutter: the
// static picture (sea, island, roads, buildings, names) is rendered once per
// zoom level into an offscreen canvas with a margin, and every frame is a
// blit of that image plus the few things that move — hover, selection, the
// visitor. A gesture scales and shifts the cached image; the crisp re-render
// follows when the finger rests.
//
// Orientation: drawn the way the 3D city is seen from above (x east to the
// right, +z DOWN the screen), so the zoom into the world is a continuation
// and not a flip. /map, the plan the plat is checked against, draws z up —
// it is the mirror of this on purpose (public/city/map.json, the comment).
import { roadSegments, lotToWorld, lotRect, rectContains, allLamps, fenceShapes, shapeBounds } from '/js/city-map.mjs';
import { categoryOf, categoryColor, DEFAULT_CATEGORY } from '/js/categories.mjs';

const CSS = `
#overview { position: fixed; inset: 0; z-index: 30; background: #050816; touch-action: none; user-select: none;
  -webkit-user-select: none; -webkit-tap-highlight-color: transparent;
  font: 13px/1.5 ui-monospace, Menlo, Consolas, monospace; color: #cfd3e8; }
#overview canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; cursor: grab; }
#overview.dragging canvas { cursor: grabbing; }
#overview.over canvas { cursor: pointer; }
#overview .ov-top { position: absolute; left: 0; right: 0; top: 0; display: flex; gap: 12px; align-items: center;
  padding: max(14px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) 0 max(16px, env(safe-area-inset-left));
  pointer-events: none; }
#overview .ov-brand { pointer-events: auto; background: rgba(5, 8, 22, .72); border: 1px solid #1f2545; border-radius: 10px; padding: 10px 14px; }
#overview .ov-brand b { color: #fff; font-size: 18px; letter-spacing: -.3px; display: block; }
#overview .ov-brand span { color: #8a86a0; }
#overview .ov-actions { margin-left: auto; pointer-events: auto; display: flex; align-items: center; gap: 8px; }
/* One pill in two weights: filled pink is the way on, outlined cyan the way
   out. inline-flex with a SET height and centred content — not an inline
   anchor leaning on min-height, which applies to the content box and grew
   both of these into 62px slabs with a 13px label floating near the top.
   #mapbtn in index.html carries the same warning; this is the same trap. */
#overview .ov-btn { display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box;
  height: 40px; padding: 0 18px; border: 0; border-radius: 999px; white-space: nowrap;
  background: #ff2d95; color: #fff; text-decoration: none; cursor: pointer;
  font: 700 13px/1 ui-monospace, Menlo, Consolas, monospace;
  box-shadow: 0 4px 14px rgba(255, 45, 149, .3);
  transition: background-color .15s, border-color .15s, color .15s, box-shadow .15s, transform .1s; }
#overview .ov-btn:hover { background: #ff4da6; box-shadow: 0 6px 18px rgba(255, 45, 149, .4); }
#overview .ov-btn:active { transform: translateY(1px); box-shadow: 0 2px 8px rgba(255, 45, 149, .3); }
#overview .ov-btn:focus-visible { outline: 2px solid #2fe0f8; outline-offset: 3px; }
#overview .ov-btn.alt { background: rgba(5, 8, 22, .72); color: #2fe0f8; border: 1px solid #31234f; box-shadow: none; }
#overview .ov-btn.alt:hover { background: rgba(11, 20, 46, .86); border-color: #2fe0f8; color: #7df0ff; box-shadow: none; }
#overview .ov-legend { position: absolute; left: max(16px, env(safe-area-inset-left)); bottom: max(16px, env(safe-area-inset-bottom));
  background: rgba(5, 8, 22, .72); border: 1px solid #1f2545; border-radius: 10px; padding: 10px 12px; font-size: 12px; max-width: min(46vw, 320px); }
#overview .ov-legend i { display: inline-block; width: 9px; height: 9px; border-radius: 2px; margin: 0 6px 0 0; vertical-align: -1px; }
#overview .ov-legend span { display: inline-block; margin: 2px 10px 2px 0; white-space: nowrap; color: #b7bbd0; }
#overview .ov-hint { position: absolute; right: max(16px, env(safe-area-inset-right)); bottom: max(16px, env(safe-area-inset-bottom));
  color: #6f6b85; font-size: 12px; text-align: right; }
#overview .ov-card { position: absolute; right: max(16px, env(safe-area-inset-right)); top: calc(76px + env(safe-area-inset-top));
  width: min(360px, calc(100vw - 32px)); background: rgba(8, 10, 26, .94);
  border: 1px solid #31234f; border-radius: 12px; overflow: hidden; box-shadow: 0 18px 50px rgba(0,0,0,.55); display: none; }
#overview .ov-card.on { display: block; }
#overview .ov-card img { width: 100%; aspect-ratio: 16 / 9; max-height: 38vh; object-fit: cover; display: block; background: #0e0b1b; }
#overview .ov-card .ov-body { padding: 12px 14px 14px; }
#overview .ov-card b { color: #fff; font-size: 16px; display: block; }
#overview .ov-card .ov-tag { color: #cfd3e8; }
#overview .ov-card .ov-meta { color: #8a86a0; font-size: 12px; margin: 6px 0 8px; }
#overview .ov-card .ov-desc { color: #b7bbd0; font-size: 12.5px; margin: 0 0 10px; display: -webkit-box; -webkit-line-clamp: 3;
  -webkit-box-orient: vertical; overflow: hidden; }
#overview .ov-card .ov-row { display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: center; }
#overview .ov-card a.ov-link { color: #2fe0f8; text-decoration: none; font-size: 12.5px; padding: 6px 0; }
#overview .ov-card .ov-x { position: absolute; right: 8px; top: 6px; background: rgba(5,8,22,.7); color: #cfd3e8; border: 0; border-radius: 999px;
  width: 36px; height: 36px; font: 18px/1 sans-serif; cursor: pointer; }
#overview .ov-chip { display: inline-block; font-size: 11px; padding: 1px 8px; border-radius: 999px; border: 1px solid #31234f; color: #e9edf6; }
#overview .ov-chip i { display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 5px; }
@media (max-width: 640px) {
  #overview .ov-card { left: max(8px, env(safe-area-inset-left)); right: max(8px, env(safe-area-inset-right)); top: auto;
    bottom: max(8px, env(safe-area-inset-bottom)); width: auto; }
  #overview .ov-legend, #overview .ov-hint { display: none; }
  #overview .ov-top { padding-left: max(10px, env(safe-area-inset-left)); padding-right: max(10px, env(safe-area-inset-right)); padding-top: max(10px, env(safe-area-inset-top)); }
  #overview .ov-brand { padding: 8px 11px; }
  #overview .ov-brand b { font-size: 15px; }
  #overview .ov-brand span { display: none; }
  #overview .ov-btn { height: 38px; padding: 0 12px; font-size: 12px; }
}
@media (prefers-reduced-motion: reduce) {
  #overview, #overview .ov-btn { transition: none !important; }
  #overview .ov-btn:active { transform: none; }
}
`;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeHref = (u) => (/^https?:\/\/[^\s"'<>]+$/i.test(String(u || '')) ? String(u) : null);
const SEA = '#060a1c';
const labelFont = (px) => `700 ${px}px "Helvetica Neue", Helvetica, Arial, sans-serif`;

export function mountOverview({ world, manifest, focus = null, onEnter, onClose = null, mode = 'door', visitor = null }) {
  const map = world.map;
  const plat = world.plat;
  const venues = world.venues || [];
  const held = new Map((manifest.lots || []).map((l) => [l.lot, l]));
  const roadsMeta = new Map((manifest.roads || []).map((r) => [r.id, r]));
  const lots = Object.values(plat.lots);
  const segs = roadSegments(map);
  const lamps = allLamps(map);
  const shapes = fenceShapes(map, plat, venues).filter((s) => s.kind !== 'mask');
  const isCity = (p) => { try { return new URL(p.url).host.replace(/^www\./, '') === 'otra.city'; } catch { return false; } };
  const colorOf = (p) => (p.category ? categoryColor(p.category) : isCity(p) ? '#47f2ff' : categoryColor(DEFAULT_CATEGORY));
  const resume = mode === 'resume';

  // --- DOM -------------------------------------------------------------------
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const root = document.createElement('div');
  root.id = 'overview';
  root.innerHTML = `
    <canvas></canvas>
    <div class="ov-top">
      <div class="ov-brand"><b>otra.city</b><span>${resume ? 'you are the green arrow · tap a building to go there' : `the city agents built · ${(manifest.lots || []).length} buildings · click one`}</span></div>
      <div class="ov-actions"><a class="ov-btn alt" href="/directory">directory</a>
        ${resume ? '<button class="ov-btn" data-close>Resume walking</button>' : '<button class="ov-btn" data-walk>Walk in</button>'}</div>
    </div>
    <div class="ov-legend"></div>
    <div class="ov-hint">drag to pan · scroll or pinch to zoom<br>${resume ? 'Esc or Resume walking to go back' : 'click a building for its card'}</div>
    <div class="ov-card"><button class="ov-x" aria-label="close">×</button><div class="ov-img"></div><div class="ov-body"></div></div>`;
  document.body.appendChild(root);
  const canvas = root.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  const card = root.querySelector('.ov-card');
  const cats = new Set();
  for (const p of manifest.lots || []) if (p.category) cats.add(p.category);
  for (const r of manifest.roads || []) for (const c of r.categories || []) cats.add(c);
  root.querySelector('.ov-legend').innerHTML = [...cats].map((c) => {
    const k = categoryOf(c);
    return k ? `<span><i style="background:${categoryColor(c)}"></i>${esc(k.label)}</span>` : '';
  }).join('') + `<span><i style="background:#47f2ff"></i>the city's own</span><span><i style="background:transparent;border:1px dashed #6f7fb0"></i>vacant</span>`;

  // --- view ------------------------------------------------------------------
  const bounds = shapes.reduce((b, s) => {
    const [x0, z0, x1, z1] = shapeBounds(s);
    return { minX: Math.min(b.minX, x0), maxX: Math.max(b.maxX, x1), minZ: Math.min(b.minZ, z0), maxZ: Math.max(b.maxZ, z1) };
  }, { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity });
  const view = { cx: (bounds.minX + bounds.maxX) / 2, cz: (bounds.minZ + bounds.maxZ) / 2, s: 4 };
  let W = 0; let H = 0; let dpr = 1;
  const fit = () => {
    const pad = 36;
    view.s = Math.min((W - pad * 2) / (bounds.maxX - bounds.minX + 40), (H - pad * 2) / (bounds.maxZ - bounds.minZ + 40));
    view.s = Math.max(0.8, view.s);
    // a phone held upright cannot show the whole city at a size a finger can
    // pick a building from — open on the centre at a tappable scale instead,
    // and let the rest be a pan away
    if (W < 640 && view.s < 2.4) { view.s = 2.4; view.cx = 24; view.cz = 0; }
  };
  const P = (x, z) => [W / 2 + (x - view.cx) * view.s, H / 2 + (z - view.cz) * view.s];
  const toWorld = (px, pz) => [view.cx + (px - W / 2) / view.s, view.cz + (pz - H / 2) / view.s];

  // --- the static picture, cached per zoom level ------------------------------
  // Rendered with a margin of PAD viewports on every side, so a pan shows no
  // edge until it has travelled that far; then, and after every zoom, a crisp
  // re-render follows once the gesture rests.
  const PAD = 0.6;
  const cache = { canvas: document.createElement('canvas'), s: 0, cx: 0, cz: 0, W: 0, H: 0, valid: false };
  let staticTimer = 0;
  function renderStatic() {
    const cw = Math.ceil(W * (1 + 2 * PAD));
    const ch = Math.ceil(H * (1 + 2 * PAD));
    cache.canvas.width = Math.round(cw * dpr);
    cache.canvas.height = Math.round(ch * dpr);
    const c = cache.canvas.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const s = view.s;
    const cx = view.cx;
    const cz = view.cz;
    drawStatic(c, cw, ch, (x, z) => [cw / 2 + (x - cx) * s, ch / 2 + (z - cz) * s], s);
    Object.assign(cache, { s, cx, cz, W: cw, H: ch, valid: true });
  }
  function scheduleStatic(delay = 120) {
    clearTimeout(staticTimer);
    staticTimer = setTimeout(() => { renderStatic(); draw(); }, delay);
  }
  const staleStatic = () => !cache.valid || cache.s !== view.s ||
    Math.abs(cache.cx - view.cx) * view.s > W * PAD * 0.9 || Math.abs(cache.cz - view.cz) * view.s > H * PAD * 0.9;

  function drawStatic(c, cw, ch, Pc, s) {
    const m = (v) => v * s;
    // the sea
    const g = c.createRadialGradient(cw / 2, ch / 2, Math.min(cw, ch) * 0.15, cw / 2, ch / 2, Math.max(cw, ch) * 0.7);
    g.addColorStop(0, '#0c1236'); g.addColorStop(1, SEA);
    c.fillStyle = g; c.fillRect(0, 0, cw, ch);
    // the island: everything built, swollen into one landmass
    const land = (pad, fill) => {
      c.fillStyle = fill; c.strokeStyle = fill; c.lineCap = 'round'; c.lineJoin = 'round';
      for (const sh of shapes) {
        if (sh.a && sh.b) {
          const [a, b] = Pc(sh.a[0], sh.a[1]); const [d, e] = Pc(sh.b[0], sh.b[1]);
          c.lineWidth = m((sh.half || 6) * 2 + pad * 2); c.beginPath(); c.moveTo(a, b); c.lineTo(d, e); c.stroke();
        } else if (sh.r !== undefined && sh.c) {
          const [a, b] = Pc(sh.c[0], sh.c[1]); c.beginPath(); c.arc(a, b, m(sh.r + pad), 0, Math.PI * 2); c.fill();
        } else if (sh.c && sh.hx !== undefined) {
          const [a, b] = Pc(sh.c[0], sh.c[1]);
          c.save(); c.translate(a, b); c.rotate(Math.atan2(sh.uz, sh.ux));
          c.beginPath(); c.roundRect(-m(sh.hx + pad), -m(sh.hz + pad), m((sh.hx + pad) * 2), m((sh.hz + pad) * 2), m(pad)); c.fill();
          c.restore();
        } else if (sh.min && sh.max) {
          const [a, b] = Pc(sh.min[0], sh.min[1]);
          c.beginPath(); c.roundRect(a - m(pad), b - m(pad), m(sh.max[0] - sh.min[0] + pad * 2), m(sh.max[1] - sh.min[1] + pad * 2), m(pad)); c.fill();
        }
      }
    };
    land(14, '#0d1330');
    land(9, '#121a3a');
    land(4, '#161d40');
    // plazas, bays, venues
    const box = (min, max, fill, stroke) => {
      const [a, b] = Pc(min[0], min[1]);
      c.fillStyle = fill; c.fillRect(a, b, m(max[0] - min[0]), m(max[1] - min[1]));
      if (stroke) { c.strokeStyle = stroke; c.lineWidth = 1; c.strokeRect(a, b, m(max[0] - min[0]), m(max[1] - min[1])); }
    };
    for (const a of map.aprons || []) box(a.min, a.max, '#1b2148');
    for (const b of map.bays || []) box(b.min, b.max, '#1a1f44', '#2a3160');
    for (const v of venues) {
      if (!v.bounds) continue;
      const [a, b] = Pc(v.bounds.min[0], v.bounds.min[1]);
      const w = m(v.bounds.max[0] - v.bounds.min[0]); const h = m(v.bounds.max[1] - v.bounds.min[1]);
      c.save(); c.shadowColor = 'rgba(255, 200, 120, .55)'; c.shadowBlur = m(6);
      c.fillStyle = '#3a2d14'; c.beginPath(); c.roundRect(a, b, w, h, m(6)); c.fill(); c.restore();
      c.strokeStyle = '#ffcf8a'; c.lineWidth = Math.max(1, m(0.5)); c.beginPath(); c.roundRect(a, b, w, h, m(6)); c.stroke();
      // the ground: a dark green pitch with its lines, and floodlights at the corners
      const iw = w * 0.62; const ih = h * 0.66; const ix = a + (w - iw) / 2; const iy = b + (h - ih) / 2;
      c.fillStyle = '#16301f'; c.fillRect(ix, iy, iw, ih);
      c.strokeStyle = 'rgba(220, 255, 230, .55)'; c.lineWidth = 1; c.strokeRect(ix, iy, iw, ih);
      c.beginPath(); c.moveTo(ix + iw / 2, iy); c.lineTo(ix + iw / 2, iy + ih); c.stroke();
      c.beginPath(); c.arc(ix + iw / 2, iy + ih / 2, Math.max(2, ih * 0.14), 0, Math.PI * 2); c.stroke();
      c.save(); c.shadowColor = 'rgba(255,255,230,.9)'; c.shadowBlur = m(4); c.fillStyle = '#fff6d8';
      for (const [fx, fy] of [[a + w * 0.12, b + h * 0.12], [a + w * 0.88, b + h * 0.12], [a + w * 0.12, b + h * 0.88], [a + w * 0.88, b + h * 0.88]]) {
        c.beginPath(); c.arc(fx, fy, Math.max(1.5, m(0.7)), 0, Math.PI * 2); c.fill();
      }
      c.restore();
      c.fillStyle = 'rgba(255,230,190,.9)'; c.font = labelFont(Math.max(10, m(2.2))); c.textAlign = 'center'; c.textBaseline = 'middle';
      const vn = (v.name || 'venue').toUpperCase();
      if (c.measureText(vn).width <= w * 0.92) { c.save(); c.shadowColor = '#000'; c.shadowBlur = 6; c.fillText(vn, a + w / 2, b + h - Math.max(8, m(2.4))); c.restore(); }
    }
    // roads: a wide warm glow, then the ribbon
    const road = (width, style, blur) => {
      c.save();
      if (blur) { c.shadowColor = style; c.shadowBlur = m(blur); }
      c.strokeStyle = style; c.lineCap = 'round';
      for (const sg of segs) {
        const [a, b] = Pc(sg.a[0] + sg.ux * sg.trimA, sg.a[1] + sg.uz * sg.trimA);
        const [d, e] = Pc(sg.a[0] + sg.ux * (sg.L - sg.trimB), sg.a[1] + sg.uz * (sg.L - sg.trimB));
        c.lineWidth = Math.max(1, m(width(sg))); c.beginPath(); c.moveTo(a, b); c.lineTo(d, e); c.stroke();
      }
      c.restore();
    };
    road((sg) => sg.half * 2 + 2, 'rgba(255, 170, 80, .16)', 8);
    road((sg) => sg.half * 2, '#1c1a2c', 0);
    road((sg) => sg.width, '#2a2238', 0);
    road((sg) => Math.max(0.6, sg.width * 0.14), 'rgba(255, 196, 120, .85)', 3);
    for (const r of map.roundabouts || []) {
      const [a, b] = Pc(...map.nodes[r.at]);
      c.fillStyle = '#1c1a2c'; c.beginPath(); c.arc(a, b, m(r.outer_r + (r.pavement ?? 2.5)), 0, Math.PI * 2); c.fill();
      c.fillStyle = '#2a2238'; c.beginPath(); c.arc(a, b, m(r.outer_r), 0, Math.PI * 2); c.fill();
      c.save(); c.shadowColor = 'rgba(255,196,120,.8)'; c.shadowBlur = m(3);
      c.strokeStyle = 'rgba(255, 196, 120, .8)'; c.lineWidth = Math.max(1, m(0.7));
      c.beginPath(); c.arc(a, b, m((r.outer_r + r.island_r) / 2), 0, Math.PI * 2); c.stroke(); c.restore();
      c.fillStyle = '#1b2148'; c.beginPath(); c.arc(a, b, m(r.island_r), 0, Math.PI * 2); c.fill();
    }
    // lots: vacant as faint plots, claimed as lit blocks
    for (const lot of lots) {
      const p = held.get(lot.id);
      const corners = [[-5, -5], [5, -5], [5, 5], [-5, 5]].map(([lx, lz]) => { const w = lotToWorld(lot, lx, lz); return Pc(w.x, w.z); });
      const path = () => { c.beginPath(); corners.forEach(([a, b], i) => (i ? c.lineTo(a, b) : c.moveTo(a, b))); c.closePath(); };
      if (!p) {
        path(); c.fillStyle = 'rgba(100, 120, 190, .10)'; c.fill();
        c.setLineDash([m(0.8), m(0.8)]); c.strokeStyle = 'rgba(120, 140, 210, .45)'; c.lineWidth = 1; c.stroke(); c.setLineDash([]);
        continue;
      }
      const col = colorOf(p);
      c.save(); c.shadowColor = col; c.shadowBlur = m(3);
      path(); c.fillStyle = col + 'aa'; c.fill(); c.restore();
      path(); c.strokeStyle = col; c.lineWidth = 1; c.stroke();
      // the lit frontage: a brighter bar along the street side
      const f0 = lotToWorld(lot, -5, 5); const f1 = lotToWorld(lot, 5, 5);
      c.strokeStyle = 'rgba(255,255,255,.85)'; c.lineWidth = Math.max(1.5, m(0.7));
      c.beginPath(); c.moveTo(...Pc(f0.x, f0.z)); c.lineTo(...Pc(f1.x, f1.z)); c.stroke();
      // a few lit windows: the block reads as a building, not a swatch
      if (s > 2.2) {
        c.fillStyle = 'rgba(255, 240, 210, .75)';
        const n = 3 + (lot.n % 3);
        for (let i = 0; i < n; i++) {
          const q = lotToWorld(lot, -3 + (i * 6.5) / Math.max(1, n - 1), -1.5 + ((i * 7) % 3) - 1);
          const [qx, qy] = Pc(q.x, q.z); c.fillRect(qx - m(0.45), qy - m(0.45), m(0.9), m(0.9));
        }
      }
      if (s > 3.4) {
        const [cx, cy] = Pc(lot.x, lot.z);
        c.fillStyle = '#ffffff'; c.font = labelFont(Math.max(9, m(1.3))); c.textAlign = 'center'; c.textBaseline = 'middle';
        const name = p.name.length > 14 ? p.name.slice(0, 13) + '…' : p.name;
        c.save(); c.shadowColor = '#000'; c.shadowBlur = 4; c.fillText(name.toUpperCase(), cx, cy); c.restore();
      }
    }
    // street lamps
    if (s > 1.6) {
      for (const l of lamps) { const [a, b] = Pc(l.x, l.z); c.fillStyle = l.lit ? 'rgba(255, 220, 160, .9)' : 'rgba(120,120,140,.5)'; c.beginPath(); c.arc(a, b, Math.max(0.8, m(0.28)), 0, Math.PI * 2); c.fill(); }
    }
    // road names ride the ribbon, on a dark plate, and are dropped on a road
    // too short to carry them at this zoom
    c.textAlign = 'center'; c.textBaseline = 'middle';
    for (const rd of map.roads || []) {
      if (!rd.name) continue;
      const mine = segs.filter((q) => q.road === rd).sort((a, b) => (b.L - b.trimA - b.trimB) - (a.L - a.trimA - a.trimB));
      const sg = mine[0]; if (!sg) continue;
      const t = sg.trimA + (sg.L - sg.trimA - sg.trimB) / 2;
      const [a, b] = Pc(sg.a[0] + sg.ux * t, sg.a[1] + sg.uz * t);
      let ang = Math.atan2(sg.uz, sg.ux); if (Math.abs(ang) > Math.PI / 2) ang += Math.PI;
      const px = Math.max(9, Math.min(20, m(2.0)));
      c.save(); c.translate(a, b); c.rotate(ang);
      c.font = labelFont(px);
      if ('letterSpacing' in c) c.letterSpacing = '1.5px';
      const tw = c.measureText(rd.name.toUpperCase()).width;
      if (tw > m(sg.L - sg.trimA - sg.trimB) * 0.95) { c.restore(); continue; }
      c.fillStyle = 'rgba(8, 8, 20, .72)'; c.beginPath(); c.roundRect(-tw / 2 - px * 0.5, -px * 0.72, tw + px, px * 1.44, px * 0.4); c.fill();
      c.fillStyle = 'rgba(255,255,255,.92)'; c.fillText(rd.name.toUpperCase(), 0, 0);
      if (rd.sub && s > 2.6) { c.font = `${Math.max(9, px * 0.6)}px ui-monospace, Menlo, monospace`; c.fillStyle = 'rgba(200,205,230,.75)'; c.shadowColor = 'rgba(0,0,0,.9)'; c.shadowBlur = 5; c.fillText(rd.sub, 0, px * 1.15); }
      c.restore();
    }
    // the spawn: where "Walk in" puts you
    const [sa, sb] = Pc(map.spawn.x, map.spawn.z);
    c.fillStyle = '#7dffa8'; c.beginPath(); c.arc(sa, sb, Math.max(3, m(0.9)), 0, Math.PI * 2); c.fill();
  }

  // --- every frame: the cached picture, then what moves ------------------------
  let hover = null;
  let selected = null;
  function draw() {
    if (!W || !H) return;
    if (!cache.valid) renderStatic();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = SEA; ctx.fillRect(0, 0, W, H);
    const k = view.s / cache.s;
    const dx = W / 2 - (cache.W / 2) * k + (cache.cx - view.cx) * view.s;
    const dy = H / 2 - (cache.H / 2) * k + (cache.cz - view.cz) * view.s;
    ctx.drawImage(cache.canvas, dx, dy, cache.W * k, cache.H * k);
    const m = (v) => v * view.s;
    const outline = (lot, fill, stroke, width) => {
      const corners = [[-5, -5], [5, -5], [5, 5], [-5, 5]].map(([lx, lz]) => { const w = lotToWorld(lot, lx, lz); return P(w.x, w.z); });
      ctx.beginPath(); corners.forEach(([a, b], i) => (i ? ctx.lineTo(a, b) : ctx.moveTo(a, b))); ctx.closePath();
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
      ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.stroke();
    };
    if (hover && hover !== selected && plat.lots[hover]) outline(plat.lots[hover], 'rgba(255,255,255,.14)', 'rgba(255,255,255,.7)', 1.5);
    if (selected && plat.lots[selected]) outline(plat.lots[selected], null, '#ffffff', 2.5);
    // the visitor, when the map was opened from the world: a green arrow the
    // way they face (yaw is the client's: 0 looks down +z, which is down the screen)
    const me = resume && visitor ? visitor() : null;
    if (me) {
      const [a, b] = P(me.x, me.z);
      const r = Math.max(7, m(1.2));
      ctx.save(); ctx.translate(a, b); ctx.rotate(-me.yaw);
      ctx.shadowColor = 'rgba(125,255,168,.9)'; ctx.shadowBlur = 10;
      ctx.fillStyle = '#7dffa8'; ctx.beginPath(); ctx.moveTo(0, r * 1.3); ctx.lineTo(-r * 0.8, -r * 0.9); ctx.lineTo(0, -r * 0.45); ctx.lineTo(r * 0.8, -r * 0.9); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    if (staleStatic()) scheduleStatic();
  }

  // --- the card --------------------------------------------------------------
  function openCard(lot) {
    selected = lot.id;
    const p = held.get(lot.id);
    const rd = roadsMeta.get(lot.road);
    const img = card.querySelector('.ov-img');
    const body = card.querySelector('.ov-body');
    const go = resume ? 'Go there' : 'Enter';
    if (p) {
      const pic = p.poster || (p.media?.pictures?.[0]?.file ? `${p.base}${p.media.pictures[0].file}` : null);
      img.innerHTML = pic ? `<img src="${esc(pic)}" alt="">` : '';
      const cat = p.category ? categoryOf(p.category) : null;
      const href = safeHref(p.url);
      let host = ''; try { host = new URL(p.url).host.replace(/^www\./, ''); } catch {}
      body.innerHTML = `<b>${esc(p.name)}</b><div class="ov-tag">${esc(p.tagline || '')}</div>
        <div class="ov-meta">${cat ? `<span class="ov-chip"><i style="background:${categoryColor(cat.id)}"></i>${esc(cat.label)}</span> · ` : isCity(p) ? `<span class="ov-chip">the city's own</span> · ` : ''}${esc(lot.address)}</div>
        ${p.description ? `<div class="ov-desc">${esc(p.description)}</div>` : ''}
        <div class="ov-row"><button class="ov-btn" data-enter="${esc(lot.id)}">${go}</button>
          ${href && !isCity(p) ? `<a class="ov-link" href="${esc(href)}" target="_blank" rel="noopener">${esc(host)} ↗</a>` : ''}
          <a class="ov-link" href="/lot/${esc(lot.id)}">listing page</a></div>`;
    } else {
      img.innerHTML = '';
      const cs = (rd?.categories || []).map((c) => categoryOf(c)).filter(Boolean);
      body.innerHTML = `<b>${esc(lot.address)}</b><div class="ov-tag">vacant${rd ? ` · ${esc(rd.name)}` : ''}</div>
        <div class="ov-meta">${cs.length ? `the road for ${cs.map((c) => `<span class="ov-chip"><i style="background:${categoryColor(c.id)}"></i>${esc(c.label)}</span>`).join(' ')}` : 'placed by the city'}</div>
        <div class="ov-desc">A listing in ${cs.length ? 'one of those categories' : 'any category'} lands here. One HTTP call, no account.</div>
        <div class="ov-row"><button class="ov-btn" data-enter="${esc(lot.id)}">${resume ? 'Go there' : 'Walk there'}</button><a class="ov-link" href="/claim?lot=${esc(lot.id)}">list your project</a></div>`;
    }
    card.classList.add('on');
    draw();
  }
  function closeCard() { selected = null; card.classList.remove('on'); draw(); }

  // --- leaving -----------------------------------------------------------------
  let leaving = false;
  function enter(lotId) {
    if (leaving) return;
    leaving = true;
    const lot = lotId ? plat.lots[lotId] : null;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const from = { cx: view.cx, cz: view.cz, s: view.s };
    const to = lot ? { cx: lot.x, cz: lot.z, s: Math.max(view.s * 6, 26) } : { cx: map.spawn.x, cz: map.spawn.z, s: Math.max(view.s * 6, 26) };
    const dur = reduce ? 0 : 900;
    const t0 = performance.now();
    let told = false;
    clearTimeout(staticTimer);
    root.style.transition = `opacity ${Math.max(200, dur * 0.6)}ms ease-in ${Math.round(dur * 0.35)}ms`;
    const tick = (now) => {
      const k = dur ? Math.min(1, (now - t0) / dur) : 1;
      const e = k * k * (3 - 2 * k);
      view.cx = from.cx + (to.cx - from.cx) * e; view.cz = from.cz + (to.cz - from.cz) * e;
      view.s = from.s * Math.pow(to.s / from.s, e);
      draw();
      if (!told && k >= 0.3) { told = true; root.style.opacity = '0'; onEnter?.(lot ? { id: lot.id, lot } : null); }
      if (k < 1) requestAnimationFrame(tick);
      else setTimeout(destroy, Math.max(0, dur * 0.65));
    };
    requestAnimationFrame(tick);
  }
  // back to walking, exactly where the visitor stood — no zoom, a short fade
  function close() {
    if (leaving) return;
    leaving = true;
    root.style.transition = 'opacity 180ms ease-out';
    root.style.opacity = '0';
    onClose?.();
    setTimeout(destroy, 190);
  }
  function destroy() {
    clearTimeout(staticTimer);
    root.remove(); style.remove();
    removeEventListener('resize', resize);
    removeEventListener('keydown', onKey);
    if (window.__overview === api) delete window.__overview;
  }

  // --- input -------------------------------------------------------------------
  // A tap is a press that did not travel; a finger travels a little on its
  // own, so touch gets more slack than a mouse, and a finger that misses a
  // building by less than its own width still gets the nearest one.
  const hit = (px, py, radius = 0) => {
    const [x, z] = toWorld(px, py);
    for (const lot of lots) if (rectContains(lotRect(lot), x, z)) return lot;
    if (!radius) return null;
    let best = null; let bd = radius;
    for (const lot of lots) {
      const [a, b] = P(lot.x, lot.z);
      const d = Math.hypot(a - px, b - py) - Math.max(0, 5 * view.s * 0.7);
      if (d < bd) { bd = d; best = lot; }
    }
    return best;
  };
  const pointers = new Map();
  let drag = null; let pinch = null; let moved = 0;
  canvas.addEventListener('pointerdown', (e) => {
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    // a dispatched PointerEvent (harness, browser tooling) carries no real
    // pointer and setPointerCapture throws on it — capture is a nicety for a
    // drag that leaves the canvas, never a precondition for the click
    try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
    if (pointers.size === 1) { drag = { x: e.clientX, y: e.clientY, cx: view.cx, cz: view.cz, touch: e.pointerType === 'touch' }; moved = 0; root.classList.add('dragging'); }
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), s: view.s, cx: view.cx, cz: view.cz, mx: (a[0] + b[0]) / 2, my: (a[1] + b[1]) / 2 };
      drag = null;
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, [e.clientX, e.clientY]);
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      const ns = Math.max(0.6, Math.min(40, pinch.s * (d / pinch.d)));
      const [wx, wz] = [pinch.cx + (pinch.mx - W / 2) / pinch.s, pinch.cz + (pinch.my - H / 2) / pinch.s];
      view.s = ns; view.cx = wx - (pinch.mx - W / 2) / ns; view.cz = wz - (pinch.my - H / 2) / ns;
      moved = 99; draw(); return;
    }
    if (drag) {
      const dx = e.clientX - drag.x; const dy = e.clientY - drag.y;
      moved = Math.max(moved, Math.hypot(dx, dy));
      view.cx = drag.cx - dx / view.s; view.cz = drag.cz - dy / view.s; draw(); return;
    }
    if (e.pointerType === 'touch') return;
    const h = hit(e.clientX, e.clientY);
    const id = h ? h.id : null;
    if (id !== hover) { hover = id; root.classList.toggle('over', !!id); draw(); }
  });
  const up = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (drag && e.type === 'pointerup' && moved < (drag.touch ? 12 : 6)) {
      const h = hit(e.clientX, e.clientY, drag.touch ? 26 : 0);
      if (h) openCard(h); else closeCard();
    }
    if (!pointers.size) { drag = null; root.classList.remove('dragging'); }
    if (staleStatic()) scheduleStatic(60);
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const k = Math.exp(-e.deltaY * 0.0016);
    const ns = Math.max(0.6, Math.min(40, view.s * k));
    const [wx, wz] = toWorld(e.clientX, e.clientY);
    view.s = ns; view.cx = wx - (e.clientX - W / 2) / ns; view.cz = wz - (e.clientY - H / 2) / ns;
    draw();
  }, { passive: false });
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-enter]'); if (b) { enter(b.dataset.enter); return; }
    if (e.target.closest('[data-walk]')) { enter(null); return; }
    if (e.target.closest('[data-close]')) { close(); return; }
    if (e.target.closest('.ov-x')) closeCard();
  });
  const onKey = (e) => {
    if (e.key !== 'Escape') return;
    if (card.classList.contains('on')) closeCard();
    else if (resume) close();
  };
  addEventListener('keydown', onKey);
  // A tab can lay out at 0x0 — a background tab on a phone, a prerender, a
  // hidden pane — and a map fitted to nothing stays tiny; so the fit is
  // redone the first time the viewport has a real size.
  let fitted = false;
  const resize = () => {
    dpr = Math.min(devicePixelRatio || 1, 2);
    W = root.clientWidth; H = root.clientHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    if (!fitted && W > 0 && H > 0) { fit(); fitted = true; }
    cache.valid = false;
    draw();
  };
  addEventListener('resize', resize);
  resize(); cache.valid = false;
  if (focus && plat.lots[focus]) {
    view.cx = plat.lots[focus].x; view.cz = plat.lots[focus].z; view.s = Math.max(view.s, 6);
    cache.valid = false;
    openCard(plat.lots[focus]);
  } else if (resume && visitor) {
    // open on the visitor, close enough to read the street they are on
    const me = visitor();
    view.cx = me.x; view.cz = me.z; view.s = Math.max(view.s, 5);
    cache.valid = false;
  }
  draw();
  const api = { enter, close, openCard: (id) => plat.lots[id] && openCard(plat.lots[id]), view, draw, hit, destroy, mode };
  window.__overview = api;
  return api;
}
