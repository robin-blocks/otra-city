// Keep the city's own shopfronts current — the step that runs after a listing
// merges, before the posters are rendered.
//
// It does two jobs, both of which exist because the submit endpoint cannot:
//
//   1. PHOTOGRAPH THE SITE. A listing whose page has no og:image and which
//      sent no images[] used to get lit blank plates and a warning nobody came
//      back for. The submit endpoint runs in a serverless function with no
//      browser, so it cannot take the picture itself; CI has Chrome already,
//      for the posters. So the city photographs the page and puts that on the
//      building. The submitter can always override it by resubmitting with
//      images[] — this is the floor, not the ceiling.
//
//   2. REBUILD WHAT THE TEMPLATE OUTGREW. plot.json records
//      `template.version`; when lib/template-shop.mjs moves past it, the shop
//      is rebuilt from the same inputs. This is the promise the submission
//      docs already make ("regenerated when the template improves"), and it is
//      why a listing gets better over time without its owner doing anything.
//
// The screenshot browser is SANDBOXED and the poster browser is not, which is
// the important difference between them: this one loads a page written by a
// stranger, on a runner holding a token that can write to this repository. If
// the sandboxed browser will not start, this script takes no screenshots and
// says so. It never retries without the sandbox.
//
// Usage: node scripts/rebuild-shopfronts.mjs [--force] [--only=slug,slug]
//                                            [--no-shots] [--quiet]
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildTemplate, TEMPLATE_ID, TEMPLATE_VERSION, PICTURE_NODES } from '../lib/template-shop.mjs';
import { launchChrome } from '../lib/headless-chrome.mjs';
import { fetchAsset, resolvesPublicly } from '../lib/fetch-asset.mjs';
import { imageKind } from '../lib/site-meta.mjs';
import { deriveTagline } from '../api/submit.mjs';

const SHOT = { width: 1200, height: 630 };   // the og:image shape the plates expect
const SETTLE_MS = 3500;                      // after load: webfonts, hero images, the fold
const NAV_TIMEOUT = 25000;
const LOGO_MAX = 2 << 20;

const root = join(new URL('..', import.meta.url).pathname);
const plotsDir = join(root, 'public', 'plots');

const args = process.argv.slice(2);
const force = args.includes('--force');
const quiet = args.includes('--quiet');
const noShots = args.includes('--no-shots');
const only = (args.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
const log = (...a) => { if (!quiet) console.log(...a); };

// ------------------------------------------------------------------ the list
const candidates = readdirSync(plotsDir)
  .filter((slug) => existsSync(join(plotsDir, slug, 'plot.json')))
  .filter((slug) => !only.length || only.includes(slug))
  .sort()
  .map((slug) => ({ slug, dir: join(plotsDir, slug), plot: JSON.parse(readFileSync(join(plotsDir, slug, 'plot.json'))) }))
  .filter((p) => p.plot.template?.id === TEMPLATE_ID)
  .map((p) => {
    const stale = (p.plot.template.version ?? 0) < TEMPLATE_VERSION;
    const wantsShot = !noShots && p.plot.template.pictures === 'none';
    return { ...p, stale, wantsShot, why: [stale && `v${p.plot.template.version ?? 0}→v${TEMPLATE_VERSION}`, wantsShot && 'no picture'].filter(Boolean) };
  })
  .filter((p) => force || p.stale || p.wantsShot);

if (!candidates.length) {
  log('shopfronts: nothing to rebuild');
  process.exit(0);
}
log(`shopfronts: ${candidates.length} to rebuild — ${candidates.map((c) => `${c.slug} (${c.why.join(', ') || 'forced'})`).join(', ')}`);

// -------------------------------------------------------------- screenshots
// One browser for every page, opened only if some plot actually needs one.
let chrome = null;
let chromeFailed = null;
async function browser() {
  if (chrome || chromeFailed) return chrome;
  try {
    chrome = await launchChrome({ ...SHOT, sandbox: true });
  } catch (e) {
    chromeFailed = e;
    console.warn(`shopfronts: no sandboxed browser (${e.message}) — taking no screenshots this run`);
  }
  return chrome;
}

/** A picture of the submitter's own page, or null with the reason logged. */
async function screenshotSite(url, slug) {
  let host;
  try { host = new URL(url).hostname; } catch { return null; }
  // A listing must not be able to point the city's browser at something only
  // the runner can reach. Chrome does its own DNS, so this cannot pin the
  // address the way fetchAsset does — it resolves first and refuses anything
  // private, which leaves a name that changes answers in between. The sandbox
  // is the second half of this pair, and the reason it is not optional.
  if (!(await resolvesPublicly(host))) {
    log(`  ${slug}: ${host} does not resolve to a public address — no screenshot`);
    return null;
  }
  const page = await browser();
  if (!page) return null;
  try {
    await page.goto(url, { timeoutMs: NAV_TIMEOUT });
    await new Promise((r) => setTimeout(r, SETTLE_MS));
    const buf = await page.screenshot({
      format: 'png',
      clip: { x: 0, y: 0, width: SHOT.width, height: SHOT.height, scale: 1 },
    });
    return imageKind(buf) === 'png' ? buf : null;
  } catch (e) {
    log(`  ${slug}: could not photograph ${url} — ${String(e.message || e).slice(0, 90)}`);
    return null;
  }
}

// ------------------------------------------------------------------ rebuild
let changed = 0;
for (const { slug, dir, plot, wantsShot } of candidates) {
  const mediaDir = join(dir, 'media');
  const pictures = [];

  // Pictures already in the bundle stay: a listing that sent its own images
  // keeps them, and only a shop with none gets photographed.
  const existing = Array.isArray(plot.media?.pictures) ? plot.media.pictures : [];
  for (const p of existing) {
    const file = String(p.file || '').replace(/^media\//, '');
    if (file && existsSync(join(mediaDir, file)) && !pictures.includes(file)) pictures.push(file);
  }

  let source = plot.template.pictures;
  if (wantsShot && !pictures.length && plot.url) {
    const shot = await screenshotSite(plot.url, slug);
    if (shot) {
      mkdirSync(mediaDir, { recursive: true });
      writeFileSync(join(mediaDir, 'pic-1.png'), shot);
      pictures.push('pic-1.png');
      source = 'screenshot';
      log(`  ${slug}: photographed ${plot.url} (${(shot.length / 1024).toFixed(0)} KiB)`);
    }
  }

  // A logo is re-fetched rather than stored: the mark is baked into the glb as
  // geometry, so the url in plot.json is the only way a rebuild can have it.
  let logo = null;
  if (plot.template.logo_url) {
    try {
      const buf = await fetchAsset(plot.template.logo_url, { maxBytes: LOGO_MAX, label: 'logo' });
      if (imageKind(buf) === 'png') logo = buf;
    } catch { /* a logo that has gone away is not a reason to fail a rebuild */ }
  }

  // A tagline the city truncated is the city's to improve. deriveTagline now
  // cuts at a clause rather than a word, so a rebuild replaces "…and PII
  // before pasting…" with a phrase that ends where a phrase should. Only
  // ellipsed taglines are touched: one the submitter wrote is theirs.
  if (plot.description && typeof plot.tagline === 'string' && plot.tagline.endsWith('…')) {
    const better = deriveTagline(plot.description);
    if (better && better !== plot.tagline) {
      log(`  ${slug}: tagline "${plot.tagline}" -> "${better}"`);
      plot.tagline = better;
    }
  }

  const bound = pictures.length === 1 ? [pictures[0], pictures[0]] : pictures.slice(0, PICTURE_NODES.length);
  const t = buildTemplate({
    slug,
    category: plot.category,
    color: plot.color,
    primaryColor: plot.template.primary || null,
    images: bound.length,
    name: plot.name || '',
    tagline: plot.tagline || '',
    builder: plot.builder || '',
    url: plot.url || '',
    logo,
  });
  writeFileSync(join(dir, 'plot.glb'), await t.write());

  plot.media = { ...(plot.media || {}) };
  plot.media.pictures = bound.map((file, i) => ({ node: PICTURE_NODES[i], file: `media/${file}` }));
  if (!plot.media.pictures.length) delete plot.media.pictures;
  if (!Object.keys(plot.media).length) delete plot.media;
  plot.anims = t.anims;
  plot.template = {
    ...plot.template,
    version: TEMPLATE_VERSION,
    variant: t.variant,
    pictures: source,
    logo: t.logo ? 'voxel' : 'monogram',
  };
  writeFileSync(join(dir, 'plot.json'), `${JSON.stringify(plot, null, 2)}\n`);
  changed += 1;
  log(`  ${slug}: rebuilt ${t.variant}, ${bound.length} picture(s), logo ${t.logo ? `${t.logo.boxes} boxes` : 'monogram'}`);
}

if (chrome) await chrome.close().catch(() => {});
log(`shopfronts: ${changed} rebuilt`);
