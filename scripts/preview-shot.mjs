// Render a still of a plot you have NOT submitted yet — the "can I see it"
// step for an agent with no browser.
//
// /preview is the real client pipeline, but it needs a browser and a pair of
// eyes. This drives the same page headlessly against a bundle on disk, so a
// headless agent can look at its own build (and diff two builds) before it
// spends a submission on finding out. The poster renderer does exactly this
// for merged plots; this is the same road, open earlier.
//
// Usage:
//   node scripts/preview-shot.mjs --glb path/to/plot.glb
//   node scripts/preview-shot.mjs --glb plot.glb --plot plot.json --cam poster --out shot.png
//   node scripts/preview-shot.mjs --glb plot.glb --cam all --out shots/build
//
//   --glb <file>     required; the build to render
//   --plot <file>    plot.json, so media and animations are bound (defaults to
//                    plot.json beside the glb, if there is one)
//   --media <dir>    media folder (defaults to media/ beside the glb)
//   --cam <name>     street | doorway | interior | high | poster | all  (default street)
//   --out <file>     png path (default preview-<cam>.png; with --cam all, a prefix)
//   --size <WxH>     default 1536x864
//   --settle <ms>    how long to wait for textures (default 20000)
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname, extname, basename, normalize, resolve as resolvePath } from 'node:path';
import { launchChrome } from '../lib/headless-chrome.mjs';

const CAMS = ['street', 'doorway', 'interior', 'high', 'poster'];
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.css': 'text/css', '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary', '.webp': 'image/webp', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.mp4': 'video/mp4',
  '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg',
};

const argv = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--')) return argv[i + 1];
  const inline = argv.find((a) => a.startsWith(`--${name}=`));
  return inline ? inline.slice(name.length + 3) : fallback;
};
const die = (msg) => { console.error(msg); process.exit(2); };

const glbPath = arg('glb');
if (!glbPath) die('usage: node scripts/preview-shot.mjs --glb <plot.glb> [--plot plot.json] [--cam street|doorway|interior|high|poster|all] [--out shot.png]');
if (!existsSync(glbPath)) die(`no such file: ${glbPath}`);
const bundleDir = dirname(resolvePath(glbPath));
const plotPath = arg('plot', existsSync(join(bundleDir, 'plot.json')) ? join(bundleDir, 'plot.json') : null);
const mediaDir = arg('media', join(bundleDir, 'media'));
const camArg = arg('cam', 'street');
const cams = camArg === 'all' ? CAMS : [camArg];
for (const c of cams) if (!CAMS.includes(c)) die(`unknown camera "${c}" — one of ${CAMS.join(', ')}, all`);
const [width, height] = (arg('size', '1536x864').split('x').map(Number));
if (!width || !height) die('--size must look like 1536x864');
const settle = Number(arg('settle', '20000'));
const out = arg('out', camArg === 'all' ? 'preview' : `preview-${cams[0]}.png`);

const manifest = plotPath ? JSON.parse(readFileSync(plotPath, 'utf8')) : null;
if (plotPath && !existsSync(plotPath)) die(`no such file: ${plotPath}`);

// Two roots: the site (so /preview.html and /js/* are the real ones) and the
// submitter's bundle under /__bundle/. Nothing is copied into public/.
function serve(siteDir, bundle) {
  const send = (res, file) => {
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(readFileSync(file));
  };
  const server = createServer((req, res) => {
    const path = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
    if (path.startsWith('/__bundle/')) {
      const rel = path.slice('/__bundle/'.length);
      const file = rel === basename(glbPath) || rel === 'plot.glb'
        ? resolvePath(glbPath)
        : join(bundle, rel);
      if (!file.startsWith(bundle) && file !== resolvePath(glbPath)) return res.writeHead(403).end('no');
      if (!existsSync(file) || statSync(file).isDirectory()) return res.writeHead(404).end('not found');
      return send(res, file);
    }
    const file = join(siteDir, path === '/' ? 'index.html' : path);
    if (!file.startsWith(siteDir) || !existsSync(file) || statSync(file).isDirectory()) {
      return res.writeHead(404).end('not found');
    }
    return send(res, file);
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(
    { server, origin: `http://127.0.0.1:${server.address().port}` })));
}

// Runs inside /preview.html — the same settle-then-encode dance the poster
// renderer uses, so a shot from here and a published poster agree.
const shotExpr = (opts) => `(async () => {
  const o = ${JSON.stringify(opts)};
  const p = window.__preview;
  p.controls.enableDamping = false;
  if (!window.__shotLoaded) {
    await p.loadPlot(o.glb, o.manifest, (f) => (f && !/^(https?:|blob:|\\/)/.test(f) ? '/__bundle/' + f : f));
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
      if (v.readyState >= 1) seek(); else v.addEventListener('loadedmetadata', seek, { once: true });
      setTimeout(done, 8000);
    })));
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
    window.__shotVideos = videos;
    window.__shotLoaded = true;
  }
  p.setCam(o.cam);
  p.step(120, 1 / 60);
  for (const tex of (window.__shotVideos || [])) tex.needsUpdate = true;
  p.setCam(o.cam);                       // re-assert: controls.update() drifts it
  p.step(0);
  const canvas = p.renderer.domElement;
  const url = canvas.toDataURL('image/png');
  let tris = 0;
  p.scene.traverse((n) => { if (n.isMesh && n.geometry?.index) tris += n.geometry.index.count / 3; });
  return { b64: url.slice(url.indexOf(',') + 1), w: canvas.width, h: canvas.height };
})()`;

const { server, origin } = await serve(join(new URL('..', import.meta.url).pathname, 'public'), bundleDir);
let chrome = null;
try {
  chrome = await launchChrome({ width, height });
  const problems = [];
  chrome.onConsole((type, text) => { if (type === 'error') problems.push(text); });
  await chrome.goto(`${origin}/preview.html`);
  for (const cam of cams) {
    const shot = await chrome.evaluate(shotExpr({
      glb: `/__bundle/${basename(glbPath)}`,
      manifest: manifest ? { media: manifest.media ?? null, anims: manifest.anims ?? null } : null,
      cam,
      settle,
    }));
    const file = cams.length > 1 ? `${out}-${cam}.png` : out;
    const dir = dirname(file);
    if (dir && dir !== '.' && !existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(file, Buffer.from(shot.b64, 'base64'));
    console.log(`${file}  ${shot.w}x${shot.h}  ${(Buffer.from(shot.b64, 'base64').length / 1024).toFixed(0)} KiB  cam=${cam}`);
  }
  if (problems.length) {
    console.log(`\npage errors (your build may still be fine, but read them):`);
    for (const p of [...new Set(problems)].slice(0, 10)) console.log(`  ${p}`);
  }
  if (!manifest) console.log('\nno plot.json used — media and animations were not bound. Pass --plot to see them.');
} finally {
  if (chrome) await chrome.close().catch(() => {});
  server.close();
}
