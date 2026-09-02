// Render one still image per plot — the thumbnail directories show before a
// visitor spends 4 MB and a WebGL context on the real thing.
//
// The poster is DERIVED FROM THE MERGED BUILD, never supplied by the
// submitter: an agent-chosen image served from otra.city under otra.city's
// brand, with no relationship to the geometry it claims to depict, is a
// moderation surface the city does not want and a way for a plot to advertise
// itself as something it is not. Rendering it ourselves makes the poster
// correct by construction and regenerates it whenever the builder rebuilds.
//
// It renders in the real client: scripts/render-posters.mjs serves public/ to
// a headless Chrome and drives /preview.html, so the poster gets the city's
// night lighting, tone mapping, bloom, light and emissive caps, and its media
// bindings — the same pixels a visitor would see standing on the far kerb.
//
// Output is content-addressed (public/posters/<slug>-<hash>.webp): a plot that
// hasn't changed is skipped, so posters don't churn on every unrelated PR, and
// a plot that has changed can never keep a stale image. Read the path from the
// manifest — never construct it.
//
// Usage: node scripts/render-posters.mjs [--force] [--only=slug,slug] [--quiet]
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync, statSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { launchChrome } from '../lib/headless-chrome.mjs';
import { POSTER_HASH_VERSION, posterName, posterPattern } from '../lib/poster-paths.mjs';

const MAX_BYTES = 120 << 10;                 // directories budget ~120 KB per poster
const QUALITY = [0.86, 0.8, 0.74, 0.68, 0.6];
const FALLBACK = { width: 1280, height: 720 };
const SETTLE_MS = 20000;
const ATTEMPTS = 2;                          // a crashed renderer is a flaky machine, not a bad plot

const root = join(new URL('..', import.meta.url).pathname);
const plotsDir = join(root, 'public', 'plots');
const outDir = join(root, 'public', 'posters');

const args = process.argv.slice(2);
const force = args.includes('--force');
const quiet = args.includes('--quiet');
const only = (args.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
const log = (...a) => { if (!quiet) console.log(...a); };

// ---------------------------------------------------------------- static host
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.css': 'text/css', '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary', '.webp': 'image/webp', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.mp4': 'video/mp4',
  '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg',
};
function serve(dir) {
  const server = createServer((req, res) => {
    const rel = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
    const file = join(dir, rel === '/' ? 'index.html' : rel);
    if (!file.startsWith(dir) || !existsSync(file) || statSync(file).isDirectory()) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(
    { server, origin: `http://127.0.0.1:${server.address().port}` })));
}

// ------------------------------------------------------------------ plot list
// Hash exactly what the picture depends on — geometry, media bytes, media and
// animation bindings — so editing a tagline doesn't reshoot the poster, and
// bumping the renderer (POSTER_HASH_VERSION) reshoots every one.
function sourceHash(dir, plot) {
  const h = createHash('sha256').update(POSTER_HASH_VERSION);
  h.update(readFileSync(join(dir, 'plot.glb')));
  h.update(JSON.stringify({ media: plot.media ?? null, anims: plot.anims ?? null }));
  const media = join(dir, 'media');
  if (existsSync(media)) {
    for (const name of readdirSync(media).sort()) {
      h.update(name);
      h.update(readFileSync(join(media, name)));
    }
  }
  return h.digest('hex').slice(0, 12);
}

const plots = readdirSync(plotsDir)
  .filter((slug) => existsSync(join(plotsDir, slug, 'plot.json')) && existsSync(join(plotsDir, slug, 'plot.glb')))
  .filter((slug) => !only.length || only.includes(slug))
  .sort()
  .map((slug) => {
    const dir = join(plotsDir, slug);
    const plot = JSON.parse(readFileSync(join(dir, 'plot.json')));
    return { slug, dir, plot, file: posterName(slug, sourceHash(dir, plot)) };
  });

if (!plots.length) {
  console.log('posters: no plots to render');
  process.exit(0);
}
mkdirSync(outDir, { recursive: true });

// ------------------------------------------------------------- in-page render
// Runs inside /preview.html. Everything the poster needs is already there —
// the city pipeline, the media system, the shared poster framing — so this
// only has to load the plot, settle it, and encode.
function renderExpr(opts) {
  return `(async () => {
  const o = ${JSON.stringify(opts)};
  const p = window.__preview;
  p.controls.enableDamping = false;          // a poster must not drift while it settles
  await p.loadPlot(o.glb, o.manifest, o.base);
  p.setCam('poster');

  // Videos: a screen frozen on frame 0 is usually a fade-in. Seek every screen
  // to the same early moment so the poster shows content and shows it the same
  // way on every run.
  const videos = [];
  p.scene.traverse((n) => {
    for (const m of [].concat(n.material || [])) if (m.map && m.map.isVideoTexture) videos.push(m.map);
  });
  await Promise.all(videos.map((tex) => new Promise((done) => {
    const v = tex.image;
    const seek = () => {
      const t = Math.min(1.2, (v.duration || 0) * 0.35);
      if (!isFinite(t)) return done();
      v.addEventListener('seeked', () => { tex.needsUpdate = true; done(); }, { once: true });
      v.currentTime = t;
    };
    if (v.readyState >= 1) seek();
    else v.addEventListener('loadedmetadata', seek, { once: true });
    setTimeout(done, 8000);
  })));

  // Textures still in flight would render as untextured walls.
  const pending = () => {
    let n = 0;
    p.scene.traverse((x) => {
      for (const m of [].concat(x.material || [])) {
        if (m.map && !m.map.isVideoTexture && !m.map.isCanvasTexture && !m.map.image) n++;
      }
    });
    return n;
  };
  const deadline = performance.now() + o.settle;
  while (pending() && performance.now() < deadline) await new Promise((r) => setTimeout(r, 100));

  // Advance the animation clock a fixed amount: tickers and pulses look dead
  // at t=0, and a fixed advance keeps the frame reproducible.
  p.step(120, 1 / 60);
  for (const tex of videos) tex.needsUpdate = true;
  p.setCam('poster');                        // re-assert after controls.update()
  p.step(0);

  const canvas = p.renderer.domElement;
  const encode = (source, q) => {
    const url = source.toDataURL('image/webp', q);
    const b64 = url.slice(url.indexOf(',') + 1);
    return { b64, bytes: atob(b64).length, q, w: source.width, h: source.height };
  };
  let best = null;
  for (const q of o.quality) {
    best = encode(canvas, q);
    if (best.bytes <= o.maxBytes) return { ...best, downscaled: false, canvas: [canvas.width, canvas.height] };
  }
  // Still too heavy at the lowest quality: shrink rather than blur further.
  const small = document.createElement('canvas');
  small.width = o.fallback.width;
  small.height = o.fallback.height;
  small.getContext('2d').drawImage(canvas, 0, 0, small.width, small.height);
  for (const q of o.quality) {
    const shot = encode(small, q);
    if (shot.bytes <= o.maxBytes || q === o.quality[o.quality.length - 1]) {
      return { ...shot, downscaled: true, canvas: [canvas.width, canvas.height] };
    }
  }
})()`;
}

// ------------------------------------------------------------------- pipeline
const todo = plots.filter((p) => force || !existsSync(join(outDir, p.file)));
log(`posters: ${plots.length} plot(s), ${todo.length} to render` + (todo.length ? '' : ' (all current)'));

let failed = 0;
if (todo.length) {
  const { server, origin } = await serve(join(root, 'public'));
  const noise = [];
  let chrome = null;
  const browser = async () => {
    if (chrome) return chrome;
    chrome = await launchChrome({ width: 1536, height: 864 });
    chrome.onConsole((type, text) => { if (type === 'error' || type === 'warning') noise.push(`${type}: ${text}`); });
    return chrome;
  };
  const drop = async () => {
    const dying = chrome;
    chrome = null;
    if (dying) await dying.close().catch(() => {});
  };
  try {
    await browser();
  } catch (e) {
    server.close();
    console.error(`posters: ${e.message}`);
    process.exit(1);
  }

  for (const { slug, plot, file } of todo) {
    const t0 = Date.now();
    // Software WebGL under a big Draco'd plot occasionally takes the renderer
    // process with it. That is a flaky machine, not a bad plot, so a second
    // attempt gets a fresh browser before the plot is called broken.
    for (let attempt = 1; ; attempt++) {
      noise.length = 0;
      try {
        const page = await browser();
        await page.goto(`${origin}/preview.html`);
        const shot = await page.evaluate(renderExpr({
          glb: `/plots/${slug}/plot.glb`,
          base: `/plots/${slug}/`,
          manifest: { media: plot.media ?? null, anims: plot.anims ?? null },
          quality: QUALITY,
          maxBytes: MAX_BYTES,
          fallback: FALLBACK,
          settle: SETTLE_MS,
        }), { timeoutMs: 120000 });
        if (!shot) throw new Error('renderer returned nothing');
        writeFileSync(join(outDir, file), Buffer.from(shot.b64, 'base64'));
        log(`  ${slug}: ${shot.w}x${shot.h} ${(shot.bytes / 1024).toFixed(0)} KiB q${shot.q}` +
          `${shot.downscaled ? ' (downscaled to fit)' : ''} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
        break;
      } catch (e) {
        await drop();
        if (attempt < ATTEMPTS) {
          log(`  ${slug}: ${e.message} — retrying with a fresh browser`);
          continue;
        }
        failed += 1;
        console.error(`  ${slug}: FAILED — ${e.message}`);
        for (const line of noise.slice(0, 5)) console.error(`      ${line}`);
        break;
      }
    }
  }
  await drop();
  server.close();
}

// Prune: a poster whose plot changed, or whose plot is gone, and anything else
// wearing the poster naming. The manifest publishes what it finds in here, so
// this directory holds exactly what the pipeline rendered and nothing else.
if (!only.length) {
  const current = new Set(plots.map((p) => p.file));
  for (const name of readdirSync(outDir)) {
    if (current.has(name) || !posterPattern.test(name)) continue;
    unlinkSync(join(outDir, name));
    log(`  pruned ${name}`);
  }
}

if (failed) {
  console.error(`\n${failed} poster(s) failed to render`);
  process.exit(1);
}
