// Post-match standings, painted INTO the broadcast frame, not onto the page.
// All coordinates are in a title-safe 1280 x 720 design space. The caller owns
// the presentation, the clock, and hiding the scorebug's bottom scoreboard.
import * as THREE from 'three';

const W = 1280;
const H = 720;
const WHITE = '#f4f6fa';
const MUTED = '#9eacc0';
const LIME = '#d9ec8a';
const UP = '#8be0b0';
const DOWN = '#f29b99';
const FONT = 'Arial, Helvetica, sans-serif';
const clamp = (n, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n));
const smooth = (n) => { const x = clamp(n); return x * x * (3 - 2 * x); };
const mix = (a, b, t) => a + (b - a) * t;
const signed = (n) => n > 0 ? `+${n}` : String(n);
const ordinal = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'TH' : ({ 1: 'ST', 2: 'ND', 3: 'RD' }[n % 10] || 'TH')}`;

function colour(value) {
  if (typeof value === 'string' && /^#(?:[\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/i.test(value)) return value;
  if (Array.isArray(value) && value.length >= 3 && value.slice(0, 3).every(Number.isFinite)) {
    const scale = value.slice(0, 3).every((v) => v >= 0 && v <= 1) ? 255 : 1;
    return `rgb(${value.slice(0, 3).map((v) => Math.round(clamp(v * scale, 0, 255))).join(',')})`;
  }
  return '#8b9db9';
}

function validPresentation(p) {
  if (!p || !Array.isArray(p.rows) || p.rows.length < 2 || p.rows.length > 12) return false;
  if (!p.home?.code || !p.away?.code || p.home.code === p.away.code) return false;
  if (!Array.isArray(p.score) || p.score.length !== 2 || !p.score.every((v) => Number.isInteger(v) && v >= 0)) return false;
  const codes = new Set();
  const positions = new Set();
  const previous = new Set();
  for (const row of p.rows) {
    if (!row || !row.code || codes.has(row.code)) return false;
    if (!['position', 'previousPosition', 'played', 'previousPlayed', 'gd', 'previousGd', 'points', 'previousPoints'].every((key) => Number.isFinite(row[key]))) return false;
    for (const key of ['position', 'previousPosition']) {
      if (!Number.isInteger(row[key]) || row[key] < 1 || row[key] > p.rows.length) return false;
    }
    codes.add(row.code);
    positions.add(row.position);
    previous.add(row.previousPosition);
  }
  return codes.has(p.home.code) && codes.has(p.away.code) && positions.size === p.rows.length && previous.size === p.rows.length;
}

/**
 * @param {{width?: number, height?: number, crestFor?: (team: object) => string|null}} options
 * draw(presentation, elapsedSeconds): an absolute, caller-controlled clock.
 * 0–.55 intro; old standings to 1.8; reorder to 3; hold to 17.4; out at 18.
 * draw(null, ...) clears stale pixels. Invalid/incomplete tables also hide;
 * in particular, this renderer NEVER truncates tables with more than 12 clubs.
 * render(renderer) must follow the world/composer render, before frame capture.
 */
export function createLeagueOverlay({ width = W, height = H, crestFor } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(Number.isFinite(width) ? width : W));
  canvas.height = Math.max(1, Math.round(Number.isFinite(height) ? height : H));
  const g = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  const material = new THREE.MeshBasicMaterial({
    map: texture, transparent: true, depthTest: false, depthWrite: false,
    toneMapped: false, opacity: 0,
  });
  const geometry = new THREE.PlaneGeometry(2, 2);
  const quad = new THREE.Mesh(geometry, material);
  quad.frustumCulled = false;
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  scene.add(quad);
  const scale = Math.min(canvas.width / W, canvas.height / H);
  const originX = (canvas.width - W * scale) / 2;
  const originY = (canvas.height - H * scale) / 2;
  const images = new Map();
  let imageRevision = 0;
  let paintedKey = null;
  let hasPixels = false;
  let disposed = false;
  let uploads = 0;
  let status = { visible: false, phase: 'hidden', elapsedSeconds: 0, matchId: null, rowCount: 0 };

  function text(value, x, y, size = 16, weight = 700, fill = WHITE, align = 'left', maxWidth = Infinity, minSize = size * .8) {
    let str = String(value ?? '');
    let s = size;
    g.textBaseline = 'middle';
    g.textAlign = align;
    g.fillStyle = fill;
    g.font = `${weight} ${s}px ${FONT}`;
    while (s > minSize && g.measureText(str).width > maxWidth) {
      s = Math.max(minSize, s - 1);
      g.font = `${weight} ${s}px ${FONT}`;
    }
    if (g.measureText(str).width > maxWidth) {
      while (str.length && g.measureText(`${str}…`).width > maxWidth) str = str.slice(0, -1);
      str = str ? `${str}…` : '';
    }
    g.fillText(str, x, y);
  }

  function rect(x, y, w, h, fill) {
    g.fillStyle = fill;
    g.fillRect(x, y, w, h);
  }

  // Vector arrows: no dependence on a font's arrow glyph or emoji rendering.
  function arrow(x, y, size, direction, fill) {
    if (!direction) { rect(x - size * .4, y - 1, size * .8, 2, fill); return; }
    g.save();
    g.translate(x, y);
    if (direction < 0) g.rotate(Math.PI);
    g.fillStyle = fill;
    g.beginPath();
    g.moveTo(0, -size * .55);
    g.lineTo(size * .52, size * .02);
    g.lineTo(size * .2, size * .02);
    g.lineTo(size * .2, size * .55);
    g.lineTo(-size * .2, size * .55);
    g.lineTo(-size * .2, size * .02);
    g.lineTo(-size * .52, size * .02);
    g.closePath();
    g.fill();
    g.restore();
  }

  function requestCrest(team) {
    let url = team.crest;
    if (!url && typeof crestFor === 'function') {
      try { url = crestFor(team); } catch { /* An unavailable crest never hides a club. */ }
    }
    if (!url || typeof url !== 'string') return null;
    if (!images.has(url)) {
      const img = new Image();
      const entry = { img, ready: false, failed: false };
      images.set(url, entry);
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        if (disposed) return;
        entry.ready = img.naturalWidth > 0 && img.naturalHeight > 0;
        entry.failed = !entry.ready;
        imageRevision += 1;
      };
      img.onerror = () => { if (!disposed) { entry.failed = true; imageRevision += 1; } };
      img.src = url;
    }
    return url;
  }

  function crest(team, url, x, y, size) {
    const entry = images.get(url);
    if (entry?.ready) {
      const ratio = Math.min(size / entry.img.naturalWidth, size / entry.img.naturalHeight);
      const w = entry.img.naturalWidth * ratio;
      const h = entry.img.naturalHeight * ratio;
      g.drawImage(entry.img, x + (size - w) / 2, y + (size - h) / 2, w, h);
      return;
    }
    // A small shirt-shaped kit chip, rather than an invented club badge.
    g.save();
    g.translate(x, y);
    g.scale(size / 32, size / 32);
    g.fillStyle = colour(team.color);
    g.beginPath();
    g.moveTo(10, 5); g.lineTo(3, 9); g.lineTo(0, 17); g.lineTo(7, 20);
    g.lineTo(9, 16); g.lineTo(9, 29); g.lineTo(23, 29); g.lineTo(23, 16);
    g.lineTo(25, 20); g.lineTo(32, 17); g.lineTo(29, 9); g.lineTo(22, 5);
    g.lineTo(19, 9); g.lineTo(13, 9); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(255,255,255,.5)'; g.lineWidth = .8; g.stroke();
    g.restore();
  }

  function card(team, row, url, y, progress, role) {
    const x = 866;
    const w = 328;
    const movement = row.previousPosition - row.position;
    const reveal = smooth(progress * 2);
    const movementColour = movement > 0 ? UP : movement < 0 ? DOWN : MUTED;
    rect(x, y, w, 170, '#152236');
    rect(x, y, 4, 170, colour(team.color));
    rect(x + 4, y, w - 4, 1, 'rgba(255,255,255,.09)');
    crest(team, url, x + 20, y + 17, 42);
    text(team.name || team.code, x + 77, y + 31, 20, 700, WHITE, 'left', 232, 16);
    text(role, x + 77, y + 53, 10, 700, MUTED);
    const position = progress < .5 ? row.previousPosition : row.position;
    text(position, x + 24, y + 107, 55, 800, WHITE);
    text('POSITION', x + 25, y + 146, 10, 700, MUTED);
    rect(x + 123, y + 85, 1, 65, 'rgba(255,255,255,.09)');
    if (reveal < 1) {
      g.save(); g.globalAlpha = 1 - reveal;
      arrow(x + 155, y + 103, 22, 0, MUTED);
      text('BEFORE THIS MATCH', x + 145, y + 135, 10, 700, MUTED);
      g.restore();
    }
    if (reveal > 0) {
      g.save(); g.globalAlpha = reveal;
      arrow(x + 156, y + 102, 22, Math.sign(movement), movementColour);
      if (movement) text(Math.abs(movement), x + 181, y + 103, 34, 700, movementColour);
      const places = Math.abs(movement) === 1 ? 'PLACE' : 'PLACES';
      text(movement > 0 ? `${places} GAINED` : movement < 0 ? `${places} LOST` : 'NO CHANGE', x + 145, y + 135, 11, 700, movementColour);
      text(`FROM ${ordinal(row.previousPosition)}`, x + 145, y + 153, 10, 400, MUTED);
      g.restore();
    }
  }

  function paint(p, rows, teams, urls, progress) {
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.setTransform(scale, 0, 0, scale, originX, originY);
    g.globalAlpha = 1;

    // The compact scorebug lives above y=60; this slab begins well below it.
    g.shadowColor = 'rgba(0,0,0,.35)'; g.shadowBlur = 22 * scale; g.shadowOffsetY = 6 * scale;
    rect(64, 106, 1152, 558, 'rgba(6,13,24,.94)');
    g.shadowColor = 'transparent'; g.shadowBlur = 0; g.shadowOffsetY = 0;
    const header = g.createLinearGradient(64, 106, 1216, 210);
    header.addColorStop(0, '#1c2e43'); header.addColorStop(1, '#101d2e');
    rect(64, 106, 1152, 103, header);
    rect(64, 106, 1152, 3, LIME);
    rect(86, 126, 49, 24, LIME);
    text('RFL', 110.5, 139, 17, 900, '#101923', 'center');
    text(p.label || `SEASON ${p.season}`, 151, 139, 13, 700, '#c4cfdd', 'left', 580);
    text('LEAGUE TABLE', 85, 181, 36, 800, WHITE, 'left', 710);
    text(progress === 0 ? 'BEFORE THE MATCH' : 'AFTER THE MATCH', 1194, 181, 17, 700, LIME, 'right');
    text(p.sourceLabel || 'FULL TIME', 1194, 139, 11, 700, MUTED, 'right', 392);
    rect(84, 209, 1110, 1, 'rgba(255,255,255,.13)');

    const tableX = 84;
    const tableW = 758;
    const tableTop = 253;
    const rowH = Math.min(56, 336 / rows.length);
    text('POS', 113, 233, 11, 700, MUTED, 'center');
    text('CLUB', 228, 233, 11, 700, MUTED);
    text('P', 615, 233, 11, 700, MUTED, 'center');
    text('GD', 691, 233, 11, 700, MUTED, 'center');
    text('PTS', 788, 233, 11, 700, LIME, 'center');
    rect(755, 249, 78, rows.length * rowH + 4, 'rgba(217,236,138,.035)');

    // Alternating lanes stay in place; club strips travel between those lanes.
    for (let i = 0; i < rows.length; i += 1) {
      if (i % 2 === 0) rect(tableX, tableTop + i * rowH, tableW, rowH - 1, 'rgba(255,255,255,.018)');
      rect(tableX, tableTop + (i + 1) * rowH - 1, tableW, 1, 'rgba(255,255,255,.055)');
    }
    const selected = (r) => r.code === p.home.code || r.code === p.away.code;
    const ordered = [...rows].sort((a, b) => Number(selected(a)) - Number(selected(b)) || a.position - b.position);
    g.save();
    g.beginPath(); g.rect(tableX, tableTop, tableW, rows.length * rowH); g.clip();
    for (const row of ordered) {
      const index = rows.indexOf(row);
      const team = teams[index];
      const active = selected(row);
      const y = tableTop + (mix(row.previousPosition, row.position, progress) - 1) * rowH;
      const cy = y + (rowH - 1) / 2;
      const movement = row.previousPosition - row.position;
      if (active) {
        rect(tableX, y, tableW, rowH - 1, '#24364b');
        rect(tableX, y, 3, rowH - 1, LIME);
        rect(755, y, 78, rowH - 1, 'rgba(217,236,138,.09)');
      } else if (progress > 0 && progress < 1) {
        // An opaque moving strip keeps crossing rows readable during the sort.
        rect(tableX + 4, y, tableW - 4, rowH - 1, '#111d2c');
      }
      text(progress < .5 ? row.previousPosition : row.position, 113, cy, 18, 700, active ? WHITE : '#bec9d7', 'center');
      const reveal = smooth(progress * 2);
      if (reveal > 0) {
        g.save(); g.globalAlpha = reveal;
        const tint = active ? (movement > 0 ? UP : movement < 0 ? DOWN : MUTED) : '#8b9eaf';
        arrow(151, cy, 10, Math.sign(movement), tint);
        if (movement) text(Math.abs(movement), 164, cy, 11, 700, tint);
        g.restore();
      }
      const crestSize = Math.min(29, rowH - 6);
      crest(team, urls[index], 192, cy - crestSize / 2, crestSize);
      text(row.name || team.name || row.code, 228, cy, rowH > 36 ? 21 : 17, active ? 700 : 500, active ? WHITE : '#c9d3df', 'left', 345, rowH > 36 ? 17 : 14);
      const value = (oldKey, newKey) => Math.round(mix(row[oldKey], row[newKey], progress));
      text(value('previousPlayed', 'played'), 615, cy, 18, 500, '#c9d3df', 'center', 54);
      text(signed(value('previousGd', 'gd')), 691, cy, 18, 500, '#c9d3df', 'center', 62);
      text(value('previousPoints', 'points'), 788, cy, 20, 800, active ? LIME : WHITE, 'center', 67);
    }
    g.restore();
    if (rows.length <= 5) {
      text(`${rows.length} CLUBS`, 88, 580, 11, 700, MUTED);
      text(progress === 0 ? 'STANDINGS BEFORE THIS MATCH' : 'STANDINGS AFTER THIS MATCH', 832, 580, 11, 700, MUTED, 'right');
    }
    const homeIndex = rows.findIndex((r) => r.code === p.home.code);
    const awayIndex = rows.findIndex((r) => r.code === p.away.code);
    card(teams[homeIndex], rows[homeIndex], urls[homeIndex], 225, progress, 'HOME');
    card(teams[awayIndex], rows[awayIndex], urls[awayIndex], 411, progress, 'AWAY');

    rect(84, 611, 1110, 1, 'rgba(255,255,255,.16)');
    rect(86, 622, 32, 22, LIME);
    text('FT', 102, 634, 12, 800, '#101923', 'center');
    text(p.home.name || p.home.code, 552, 634, 19, 700, WHITE, 'right', 410, 15);
    text(`${p.score[0]}  -  ${p.score[1]}`, 640, 634, 25, 800, LIME, 'center', 145);
    text(p.away.name || p.away.code, 728, 634, 19, 700, WHITE, 'left', 462, 15);
    text('Movement from before this match', 86, 653, 10, 400, MUTED);
    text('RFL  /  FULL-TIME STANDINGS', 1194, 653, 10, 400, MUTED, 'right');
    g.setTransform(1, 0, 0, 1, 0, 0);
    texture.needsUpdate = true;
    uploads += 1;
    hasPixels = true;
  }

  function hide(phase, elapsedSeconds = 0) {
    const changed = hasPixels || material.opacity !== 0;
    material.opacity = 0;
    quad.position.y = 0;
    status = { visible: false, phase, elapsedSeconds, matchId: null, rowCount: 0 };
    if (hasPixels) {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, canvas.width, canvas.height);
      texture.needsUpdate = true;
      uploads += 1;
    }
    hasPixels = false;
    paintedKey = null;
    return changed;
  }

  function draw(presentation, elapsedSeconds = 0) {
    if (disposed) return false;
    const elapsed = Number.isFinite(elapsedSeconds) ? Math.max(0, elapsedSeconds) : 0;
    if (!presentation) return hide('hidden', elapsed);
    if (!validPresentation(presentation)) return hide('unsupported', elapsed);
    if (elapsed >= 18) return hide('finished', elapsed);
    const p = presentation;
    const progress = smooth((elapsed - 1.8) / 1.2);
    const intro = smooth(elapsed / .55);
    const outro = smooth((elapsed - 17.4) / .6);
    const opacity = intro * (1 - outro);
    const slide = 18 * (1 - intro) + 8 * outro;
    const y = -slide * scale * 2 / canvas.height;
    const changed = material.opacity !== opacity || quad.position.y !== y;
    material.opacity = opacity;
    quad.position.y = y;
    const rows = [...p.rows].sort((a, b) => a.position - b.position);
    const teams = rows.map((r) => ({ ...r, ...(r.code === p.home.code ? p.home : r.code === p.away.code ? p.away : {}) }));
    // Resolve again on held frames: scorebug's crest manifest can arrive later.
    // Images themselves load once per URL, and only a new image invalidates paint.
    const urls = teams.map(requestCrest);
    const key = JSON.stringify([p, urls, imageRevision, progress]);
    status = {
      visible: opacity > 0, phase: elapsed < .55 ? 'entering' : elapsed < 1.8 ? 'before' : elapsed < 3 ? 'moving' : elapsed < 17.4 ? 'held' : 'leaving',
      elapsedSeconds: elapsed, matchId: p.matchId ?? null, rowCount: rows.length,
    };
    if (key === paintedKey) return changed;
    paint(p, rows, teams, urls, progress);
    paintedKey = key;
    return true;
  }

  return {
    draw,
    render(renderer) {
      if (disposed || !hasPixels || material.opacity <= 0) return false;
      const wasAutoClear = renderer.autoClear;
      try {
        renderer.autoClear = false;
        renderer.render(scene, camera);
      } finally {
        renderer.autoClear = wasAutoClear;
      }
      return true;
    },
    state() {
      return {
        ...status, disposed, opacity: material.opacity, uploads,
        crests: { requested: images.size, loaded: [...images.values()].filter((r) => r.ready).length, failed: [...images.values()].filter((r) => r.failed).length },
      };
    },
    dispose() {
      if (disposed) return;
      hide('disposed');
      disposed = true;
      for (const { img } of images.values()) {
        img.onload = null;
        img.onerror = null;
        img.src = '';
      }
      images.clear();
      texture.dispose();
      material.dispose();
      geometry.dispose();
      scene.clear();
      canvas.width = 1;
      canvas.height = 1;
    },
  };
}
