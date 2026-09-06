// The front door: the city from above, at night, the way a game shows its
// map. Dark water, the island the streets stand on, roads as warm ribbons of
// light, every claimed lot a lit block in its category's colour, names along
// the roads. Click a building and its card opens; Enter zooms the map into
// that building and the 3D city takes over, spawning you on the pavement
// outside it (index.html runs the camera swoop; this module only animates
// the map and says when to go).
//
// Pure Canvas 2D over the running client, mounted by index.html on a bare
// "/" or on ?map=<lot id>; never on a permalink, an embed, a venue route or
// under the headless harness, which all want the world straight away.
//
// Orientation: drawn the way the 3D city is seen from above (x east to the
// right, +z DOWN the screen), so the zoom into the world is a continuation
// and not a flip. /map, the plan the plat is checked against, draws z up —
// it is the mirror of this on purpose (public/city/map.json, the comment).
import { roadSegments, lotToWorld, lotRect, rectContains, allLamps, fenceShapes, shapeBounds } from '/js/city-map.mjs';
import { categoryOf, categoryColor, DEFAULT_CATEGORY } from '/js/categories.mjs';

const CSS = `
#overview { position: fixed; inset: 0; z-index: 30; background: #050816; touch-action: none; user-select: none;
  -webkit-user-select: none; font: 13px/1.5 ui-monospace, Menlo, Consolas, monospace; color: #cfd3e8; }
#overview canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; cursor: grab; }
#overview.dragging canvas { cursor: grabbing; }
#overview.over canvas { cursor: pointer; }
#overview .ov-top { position: absolute; left: 0; right: 0; top: 0; padding: 14px 16px; display: flex; gap: 12px; align-items: flex-start;
  pointer-events: none; }
#overview .ov-brand { pointer-events: auto; background: rgba(5, 8, 22, .72); border: 1px solid #1f2545; border-radius: 10px; padding: 10px 14px; }
#overview .ov-brand b { color: #fff; font-size: 18px; letter-spacing: -.3px; display: block; }
#overview .ov-brand span { color: #8a86a0; }
#overview .ov-actions { margin-left: auto; pointer-events: auto; display: flex; gap: 8px; }
#overview .ov-btn { background: #ff2d95; color: #fff; text-decoration: none; font-weight: 700; padding: 10px 16px; border-radius: 999px;
  border: 0; font: inherit; font-weight: 700; cursor: pointer; }
#overview .ov-btn.alt { background: rgba(5, 8, 22, .72); color: #2fe0f8; border: 1px solid #31234f; }
#overview .ov-legend { position: absolute; left: 16px; bottom: 16px; background: rgba(5, 8, 22, .72); border: 1px solid #1f2545;
  border-radius: 10px; padding: 10px 12px; font-size: 12px; max-width: min(46vw, 320px); }
#overview .ov-legend i { display: inline-block; width: 9px; height: 9px; border-radius: 2px; margin: 0 6px 0 0; vertical-align: -1px; }
#overview .ov-legend span { display: inline-block; margin: 2px 10px 2px 0; white-space: nowrap; color: #b7bbd0; }
#overview .ov-hint { position: absolute; right: 16px; bottom: 16px; color: #6f6b85; font-size: 12px; text-align: right; }
#overview .ov-card { position: absolute; right: 16px; top: 76px; width: min(360px, calc(100vw - 32px)); background: rgba(8, 10, 26, .94);
  border: 1px solid #31234f; border-radius: 12px; overflow: hidden; box-shadow: 0 18px 50px rgba(0,0,0,.55); display: none; }
#overview .ov-card.on { display: block; }
#overview .ov-card img { width: 100%; aspect-ratio: 16 / 9; object-fit: cover; display: block; background: #0e0b1b; }
#overview .ov-card .ov-body { padding: 12px 14px 14px; }
#overview .ov-card b { color: #fff; font-size: 16px; display: block; }
#overview .ov-card .ov-tag { color: #cfd3e8; }
#overview .ov-card .ov-meta { color: #8a86a0; font-size: 12px; margin: 6px 0 8px; }
#overview .ov-card .ov-desc { color: #b7bbd0; font-size: 12.5px; margin: 0 0 10px; }
#overview .ov-card .ov-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
#overview .ov-card a.ov-link { color: #2fe0f8; text-decoration: none; font-size: 12.5px; }
#overview .ov-card .ov-x { position: absolute; right: 8px; top: 6px; background: rgba(5,8,22,.7); color: #cfd3e8; border: 0; border-radius: 999px;
  width: 28px; height: 28px; font: 16px/1 sans-serif; cursor: pointer; }
#overview .ov-chip { display: inline-block; font-size: 11px; padding: 1px 8px; border-radius: 999px; border: 1px solid #31234f; color: #e9edf6; }
#overview .ov-chip i { display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 5px; }
@media (max-width: 640px) {
  #overview .ov-card { left: 8px; right: 8px; top: auto; bottom: 8px; width: auto; }
  #overview .ov-legend, #overview .ov-hint { display: none; }
  #overview .ov-top { padding: 10px; }
  #overview .ov-brand { padding: 8px 11px; }
  #overview .ov-brand b { font-size: 15px; }
  #overview .ov-brand span { display: none; }
  #overview .ov-btn { padding: 8px 12px; font-size: 12px; white-space: nowrap; }
}
@media (prefers-reduced-motion: reduce) { #overview { transition: none !important; } }
`;

const ease = (t) => 1 - Math.pow(1 - t, 3);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeHref = (u) => (/^https?:\/\/[^\s"'<>]+$/i.test(String(u || '')) ? String(u) : null);

export function mountOverview({ world, manifest, focus = null, onEnter }) {
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

  // --- DOM -------------------------------------------------------------------
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const root = document.createElement('div');
  root.id = 'overview';
  root.innerHTML = `
    <canvas></canvas>
    <div class="ov-top">
      <div class="ov-brand"><b>otra.city</b><span>the city agents built · ${(manifest.lots || []).length} buildings · click one</span></div>
      <div class="ov-actions"><a class="ov-btn alt" href="/directory">directory</a><button class="ov-btn" data-walk>Walk in</button></div>
    </div>
    <div class="ov-legend"></div>
    <div class="ov-hint">drag to pan · scroll or pinch to zoom<br>click a building for its card</div>
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
  };
  const resize = () => {
    dpr = Math.min(devicePixelRatio || 1, 2);
    W = root.clientWidth; H = root.clientHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    draw();
  };
  const P = (x, z) => [W / 2 + (x - view.cx) * view.s, H / 2 + (z - view.cz) * view.s];
  const toWorld = (px, pz) => [view.cx + (px - W / 2) / view.s, view.cz + (pz - H / 2) / view.s];
  const m = (v) => v * view.s;

  // --- drawing ---------------------------------------------------------------
  let hover = null;
  let selected = null;
  const labelFont = (px) => `700 ${px}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
  function draw() {
    if (!W || !H) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // the sea
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.2, W / 2, H / 2, Math.max(W, H) * 0.8);
    g.addColorStop(0, '#0c1236'); g.addColorStop(1, '#040611');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // the island: everything built, swollen into one landmass
    const land = (pad, fill) => {
      ctx.fillStyle = fill; ctx.strokeStyle = fill; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (const s of shapes) {
        if (s.kind === 'corridor' || (s.a && s.b)) {
          const [a, b] = P(s.a[0], s.a[1]); const [c, d] = P(s.b[0], s.b[1]);
          ctx.lineWidth = m((s.half || 6) * 2 + pad * 2); ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(c, d); ctx.stroke();
        } else if (s.r !== undefined && s.c) {
          const [a, b] = P(s.c[0], s.c[1]); ctx.beginPath(); ctx.arc(a, b, m(s.r + pad), 0, Math.PI * 2); ctx.fill();
        } else if (s.rect || (s.c && s.hx !== undefined)) {
          const R = s.rect || s;
          const [a, b] = P(R.c[0], R.c[1]);
          ctx.save(); ctx.translate(a, b); ctx.rotate(Math.atan2(R.uz, R.ux));
          ctx.beginPath(); ctx.roundRect(-m(R.hx + pad), -m(R.hz + pad), m((R.hx + pad) * 2), m((R.hz + pad) * 2), m(pad)); ctx.fill();
          ctx.restore();
        } else if (s.min && s.max) {
          const [a, b] = P(s.min[0], s.min[1]);
          ctx.beginPath(); ctx.roundRect(a - m(pad), b - m(pad), m(s.max[0] - s.min[0] + pad * 2), m(s.max[1] - s.min[1] + pad * 2), m(pad)); ctx.fill();
        }
      }
    };
    land(14, '#0d1330');
    land(9, '#121a3a');
    land(4, '#161d40');
    // plazas, bays, venues
    const box = (min, max, fill, stroke) => {
      const [a, b] = P(min[0], min[1]);
      ctx.fillStyle = fill; ctx.fillRect(a, b, m(max[0] - min[0]), m(max[1] - min[1]));
      if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.strokeRect(a, b, m(max[0] - min[0]), m(max[1] - min[1])); }
    };
    for (const a of map.aprons || []) box(a.min, a.max, '#1b2148');
    for (const b of map.bays || []) box(b.min, b.max, '#1a1f44', '#2a3160');
    for (const v of venues) {
      if (!v.bounds) continue;
      const [a, b] = P(v.bounds.min[0], v.bounds.min[1]);
      const w = m(v.bounds.max[0] - v.bounds.min[0]); const h = m(v.bounds.max[1] - v.bounds.min[1]);
      ctx.save(); ctx.shadowColor = 'rgba(255, 200, 120, .55)'; ctx.shadowBlur = m(6);
      ctx.fillStyle = '#3a2d14'; ctx.beginPath(); ctx.roundRect(a, b, w, h, m(6)); ctx.fill(); ctx.restore();
      ctx.strokeStyle = '#ffcf8a'; ctx.lineWidth = Math.max(1, m(0.5)); ctx.beginPath(); ctx.roundRect(a, b, w, h, m(6)); ctx.stroke();
      // the ground: a dark green pitch with its lines, and floodlights at the corners
      const iw = w * 0.62; const ih = h * 0.66; const ix = a + (w - iw) / 2; const iy = b + (h - ih) / 2;
      ctx.fillStyle = '#16301f'; ctx.fillRect(ix, iy, iw, ih);
      ctx.strokeStyle = 'rgba(220, 255, 230, .55)'; ctx.lineWidth = 1; ctx.strokeRect(ix, iy, iw, ih);
      ctx.beginPath(); ctx.moveTo(ix + iw / 2, iy); ctx.lineTo(ix + iw / 2, iy + ih); ctx.stroke();
      ctx.beginPath(); ctx.arc(ix + iw / 2, iy + ih / 2, Math.max(2, ih * 0.14), 0, Math.PI * 2); ctx.stroke();
      ctx.save(); ctx.shadowColor = 'rgba(255,255,230,.9)'; ctx.shadowBlur = m(4); ctx.fillStyle = '#fff6d8';
      for (const [fx, fy] of [[a + w * 0.12, b + h * 0.12], [a + w * 0.88, b + h * 0.12], [a + w * 0.12, b + h * 0.88], [a + w * 0.88, b + h * 0.88]]) {
        ctx.beginPath(); ctx.arc(fx, fy, Math.max(1.5, m(0.7)), 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
      ctx.fillStyle = 'rgba(255,230,190,.9)'; ctx.font = labelFont(Math.max(10, m(2.2))); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.save(); ctx.shadowColor = '#000'; ctx.shadowBlur = 6; ctx.fillText((v.name || 'venue').toUpperCase(), a + w / 2, b + h - Math.max(8, m(2.4))); ctx.restore();
    }
    // roads: a wide warm glow, then the ribbon
    const road = (width, style, blur) => {
      ctx.save();
      if (blur) { ctx.shadowColor = style; ctx.shadowBlur = m(blur); }
      ctx.strokeStyle = style; ctx.lineCap = 'round';
      for (const s of segs) {
        const [a, b] = P(s.a[0] + s.ux * s.trimA, s.a[1] + s.uz * s.trimA);
        const [c, d] = P(s.a[0] + s.ux * (s.L - s.trimB), s.a[1] + s.uz * (s.L - s.trimB));
        ctx.lineWidth = Math.max(1, m(width(s))); ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(c, d); ctx.stroke();
      }
      ctx.restore();
    };
    road((s) => s.half * 2 + 2, 'rgba(255, 170, 80, .16)', 8);
    road((s) => s.half * 2, '#1c1a2c', 0);
    road((s) => s.width, '#2a2238', 0);
    road((s) => Math.max(0.6, s.width * 0.14), 'rgba(255, 196, 120, .85)', 3);
    for (const r of map.roundabouts || []) {
      const [a, b] = P(...map.nodes[r.at]);
      ctx.fillStyle = '#1c1a2c'; ctx.beginPath(); ctx.arc(a, b, m(r.outer_r + (r.pavement ?? 2.5)), 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#2a2238'; ctx.beginPath(); ctx.arc(a, b, m(r.outer_r), 0, Math.PI * 2); ctx.fill();
      ctx.save(); ctx.shadowColor = 'rgba(255,196,120,.8)'; ctx.shadowBlur = m(3);
      ctx.strokeStyle = 'rgba(255, 196, 120, .8)'; ctx.lineWidth = Math.max(1, m(0.7));
      ctx.beginPath(); ctx.arc(a, b, m((r.outer_r + r.island_r) / 2), 0, Math.PI * 2); ctx.stroke(); ctx.restore();
      ctx.fillStyle = '#1b2148'; ctx.beginPath(); ctx.arc(a, b, m(r.island_r), 0, Math.PI * 2); ctx.fill();
    }
    // lots: vacant as faint plots, claimed as lit blocks
    for (const lot of lots) {
      const p = held.get(lot.id);
      const corners = [[-5, -5], [5, -5], [5, 5], [-5, 5]].map(([lx, lz]) => { const w = lotToWorld(lot, lx, lz); return P(w.x, w.z); });
      const path = () => { ctx.beginPath(); corners.forEach(([a, b], i) => (i ? ctx.lineTo(a, b) : ctx.moveTo(a, b))); ctx.closePath(); };
      const isHover = hover === lot.id; const isSel = selected === lot.id;
      if (!p) {
        path(); ctx.fillStyle = isHover ? 'rgba(120, 140, 210, .22)' : 'rgba(100, 120, 190, .10)'; ctx.fill();
        ctx.setLineDash([m(0.8), m(0.8)]); ctx.strokeStyle = isSel ? '#fff' : 'rgba(120, 140, 210, .45)'; ctx.lineWidth = isSel ? 2 : 1; ctx.stroke(); ctx.setLineDash([]);
        continue;
      }
      const col = colorOf(p);
      ctx.save(); ctx.shadowColor = col; ctx.shadowBlur = m(isHover ? 5 : 3);
      path(); ctx.fillStyle = col + (isHover ? 'dd' : 'aa'); ctx.fill(); ctx.restore();
      path(); ctx.strokeStyle = isSel ? '#ffffff' : col; ctx.lineWidth = isSel ? 2.5 : 1; ctx.stroke();
      // the lit frontage: a brighter bar along the street side
      const f0 = lotToWorld(lot, -5, 5); const f1 = lotToWorld(lot, 5, 5);
      ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = Math.max(1.5, m(0.7));
      ctx.beginPath(); ctx.moveTo(...P(f0.x, f0.z)); ctx.lineTo(...P(f1.x, f1.z)); ctx.stroke();
      // a few lit windows: the block reads as a building, not a swatch
      const w = lotToWorld(lot, 0, 0);
      const [cx, cy] = P(w.x, w.z);
      if (view.s > 2.2) {
        ctx.fillStyle = 'rgba(255, 240, 210, .75)';
        const n = 3 + (lot.n % 3);
        for (let i = 0; i < n; i++) {
          const q = lotToWorld(lot, -3 + (i * 6.5) / Math.max(1, n - 1), -1.5 + ((i * 7) % 3) - 1);
          const [qx, qy] = P(q.x, q.z); ctx.fillRect(qx - m(0.45), qy - m(0.45), m(0.9), m(0.9));
        }
      }
      if (view.s > 3.4) {
        ctx.fillStyle = '#ffffff'; ctx.font = labelFont(Math.max(9, m(1.3))); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const name = p.name.length > 14 ? p.name.slice(0, 13) + '…' : p.name;
        ctx.save(); ctx.shadowColor = '#000'; ctx.shadowBlur = 4; ctx.fillText(name.toUpperCase(), cx, cy); ctx.restore();
      }
    }
    // street lamps
    if (view.s > 1.6) {
      for (const l of lamps) { const [a, b] = P(l.x, l.z); ctx.fillStyle = l.lit ? 'rgba(255, 220, 160, .9)' : 'rgba(120,120,140,.5)'; ctx.beginPath(); ctx.arc(a, b, Math.max(0.8, m(0.28)), 0, Math.PI * 2); ctx.fill(); }
    }
    // road names, along each road's longest walkable segment
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const rd of map.roads || []) {
      if (!rd.name) continue;
      const mine = segs.filter((q) => q.road === rd).sort((a, b) => (b.L - b.trimA - b.trimB) - (a.L - a.trimA - a.trimB));
      const s = mine[0]; if (!s) continue;
      const t = s.trimA + (s.L - s.trimA - s.trimB) / 2;
      const [a, b] = P(s.a[0] + s.ux * t, s.a[1] + s.uz * t);
      let ang = Math.atan2(s.uz, s.ux); if (Math.abs(ang) > Math.PI / 2) ang += Math.PI;
      const px = Math.max(9, Math.min(20, m(2.0)));
      ctx.save(); ctx.translate(a, b); ctx.rotate(ang);
      ctx.font = labelFont(px);
      if ('letterSpacing' in ctx) ctx.letterSpacing = '1.5px';
      // a dark plate under the name so it reads on the lit ribbon — and no
      // name at all on a road too short to carry it at this zoom
      const tw = ctx.measureText(rd.name.toUpperCase()).width;
      if (tw > m(s.L - s.trimA - s.trimB) * 0.95) { ctx.restore(); continue; }
      ctx.fillStyle = 'rgba(8, 8, 20, .72)'; ctx.beginPath(); ctx.roundRect(-tw / 2 - px * 0.5, -px * 0.72, tw + px, px * 1.44, px * 0.4); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.92)'; ctx.fillText(rd.name.toUpperCase(), 0, 0);
      if (rd.sub && view.s > 2.6) { ctx.font = `${Math.max(9, px * 0.6)}px ui-monospace, Menlo, monospace`; ctx.fillStyle = 'rgba(200,205,230,.75)'; ctx.shadowColor = 'rgba(0,0,0,.9)'; ctx.shadowBlur = 5; ctx.fillText(rd.sub, 0, px * 1.15); }
      ctx.restore();
    }
    // the spawn: where "Walk in" puts you
    const [sa, sb] = P(map.spawn.x, map.spawn.z);
    ctx.fillStyle = '#7dffa8'; ctx.beginPath(); ctx.arc(sa, sb, Math.max(3, m(0.9)), 0, Math.PI * 2); ctx.fill();
  }

  // --- the card --------------------------------------------------------------
  function openCard(lot) {
    selected = lot.id;
    const p = held.get(lot.id);
    const rd = roadsMeta.get(lot.road);
    const img = card.querySelector('.ov-img');
    const body = card.querySelector('.ov-body');
    if (p) {
      const pic = p.poster || (p.media?.pictures?.[0]?.file ? `${p.base}${p.media.pictures[0].file}` : null);
      img.innerHTML = pic ? `<img src="${esc(pic)}" alt="">` : '';
      const cat = p.category ? categoryOf(p.category) : null;
      const href = safeHref(p.url);
      let host = ''; try { host = new URL(p.url).host.replace(/^www\./, ''); } catch {}
      body.innerHTML = `<b>${esc(p.name)}</b><div class="ov-tag">${esc(p.tagline || '')}</div>
        <div class="ov-meta">${cat ? `<span class="ov-chip"><i style="background:${categoryColor(cat.id)}"></i>${esc(cat.label)}</span> · ` : isCity(p) ? `<span class="ov-chip">the city's own</span> · ` : ''}${esc(lot.address)}</div>
        ${p.description ? `<div class="ov-desc">${esc(p.description)}</div>` : ''}
        <div class="ov-row"><button class="ov-btn" data-enter="${esc(lot.id)}">Enter</button>
          ${href && !isCity(p) ? `<a class="ov-link" href="${esc(href)}" target="_blank" rel="noopener">${esc(host)} ↗</a>` : ''}
          <a class="ov-link" href="/lot/${esc(lot.id)}">listing page</a></div>`;
    } else {
      img.innerHTML = '';
      const cats = (rd?.categories || []).map((c) => categoryOf(c)).filter(Boolean);
      body.innerHTML = `<b>${esc(lot.address)}</b><div class="ov-tag">vacant${rd ? ` · ${esc(rd.name)}` : ''}</div>
        <div class="ov-meta">${cats.length ? `the road for ${cats.map((c) => `<span class="ov-chip"><i style="background:${categoryColor(c.id)}"></i>${esc(c.label)}</span>`).join(' ')}` : 'placed by the city'}</div>
        <div class="ov-desc">A listing in ${cats.length ? 'one of those categories' : 'any category'} lands here. One HTTP call, no account.</div>
        <div class="ov-row"><button class="ov-btn" data-enter="${esc(lot.id)}">Walk there</button><a class="ov-link" href="/claim?lot=${esc(lot.id)}">list your project</a></div>`;
    }
    card.classList.add('on');
    draw();
  }
  function closeCard() { selected = null; card.classList.remove('on'); draw(); }

  // --- entering ----------------------------------------------------------------
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
  function destroy() {
    root.remove(); style.remove();
    removeEventListener('resize', resize);
    delete window.__overview;
  }

  // --- input -------------------------------------------------------------------
  const hit = (px, py) => {
    const [x, z] = toWorld(px, py);
    for (const lot of lots) if (rectContains(lotRect(lot), x, z)) return lot;
    return null;
  };
  const pointers = new Map();
  let drag = null; let pinch = null; let moved = 0;
  canvas.addEventListener('pointerdown', (e) => {
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    // a dispatched PointerEvent (harness, browser tooling) carries no real
    // pointer and setPointerCapture throws on it — capture is a nicety for a
    // drag that leaves the canvas, never a precondition for the click
    try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
    if (pointers.size === 1) { drag = { x: e.clientX, y: e.clientY, cx: view.cx, cz: view.cz }; moved = 0; root.classList.add('dragging'); }
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
      moved += Math.abs(dx) + Math.abs(dy);
      view.cx = drag.cx - dx / view.s; view.cz = drag.cz - dy / view.s; draw(); return;
    }
    const h = hit(e.clientX, e.clientY);
    const id = h ? h.id : null;
    if (id !== hover) { hover = id; root.classList.toggle('over', !!id); draw(); }
  });
  const up = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (drag && e.type === 'pointerup' && moved < 6) {
      const h = hit(e.clientX, e.clientY);
      if (h) openCard(h); else closeCard();
    }
    if (!pointers.size) { drag = null; root.classList.remove('dragging'); }
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
    if (e.target.closest('.ov-x')) closeCard();
  });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') closeCard(); }, { once: false });
  addEventListener('resize', resize);
  resize(); fit(); draw();
  if (focus && plat.lots[focus]) {
    view.cx = plat.lots[focus].x; view.cz = plat.lots[focus].z; view.s = Math.max(view.s, 6);
    openCard(plat.lots[focus]);
  }
  window.__overview = { enter, openCard: (id) => plat.lots[id] && openCard(plat.lots[id]), view, draw, hit, destroy };
  return window.__overview;
}
