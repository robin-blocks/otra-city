// Render the city-wide social card: public/og/city.jpg, 1200×630.
//
// Reddit, Slack, X and iMessage unfurl a link from its og:image. The static
// pages (/, /claim, /map, /about, /houses) had none, so a shared link showed
// as bare text. The card is the front door itself — the night map a bare "/"
// opens on — rendered in the real client, the same way render-posters drives
// /preview.html, so it cannot drift from what a visitor sees when they click.
//
// A card is seen at ~500 px wide in a feed, where the map's 9 px road names
// would shrink to 4 px. So the page is laid out smaller (750×394 CSS px) and
// captured at 1.6× device pixels: everything the map draws in screen pixels —
// names, the brand panel — is 1.6× bigger relative to the frame than on a
// desktop screen. Not 2×: road names scale with zoom and are dropped on a
// road too short to carry them, and at 2× all but two of them went. The DOM chrome a card has no use for
// (buttons, hints, the legend) is hidden; the brand panel stays, because it is
// the name, and says what the city is instead of "click one".
//
// JPEG, not WebP: several unfurlers (older Slack, some Reddit paths) still
// ignore a WebP og:image. Re-run after the city grows:
//
//   npm run og            # writes public/og/city.jpg
//   npm run og -- --out /tmp/og.jpg --scale 2.65 --cx 22 --cz -4 --dpr 1.6
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { launchChrome } from '../lib/headless-chrome.mjs';
import { serve } from '../lib/static-server.mjs';

const OG_WIDTH = 1200;
const OG_HEIGHT = 630;
const MAX_BYTES = 300 << 10;
const QUALITY = [88, 82, 76, 70, 64];

const root = join(new URL('..', import.meta.url).pathname);
const argv = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  if (i >= 0 && argv[i + 1] != null) return argv[i + 1];
  const inline = argv.find((a) => a.startsWith(`--${name}=`));
  return inline ? inline.slice(name.length + 3) : fallback;
};
const out = arg('out', join(root, 'public', 'og', 'city.jpg'));
// The framing, in the overview's own units: world-space centre and CSS px per
// metre. 2.65 is just over the 2.6 at which roads show their subreddit line.
// Revisit when a road is added outside this frame (map.json).
const frame = { s: Number(arg('scale', '2.65')), cx: Number(arg('cx', '22')), cz: Number(arg('cz', '-4')) };
const DPR = Number(arg('dpr', '1.6'));
const TAGLINE = ['a free directory of AI tools', 'you can walk around'];

const { server, origin } = await serve(join(root, 'public'));
const css = { width: Math.round(OG_WIDTH / DPR), height: Math.round(OG_HEIGHT / DPR) };
const chrome = await launchChrome(css);
await chrome.send('Emulation.setDeviceMetricsOverride', { ...css, deviceScaleFactor: DPR, mobile: false });
const noise = [];
chrome.onConsole((type, text) => { if (type === 'error') noise.push(text); });
try {
  // A bare "/" is the front door: the map opens on its own, no query string.
  await chrome.goto(`${origin}/`);
  await chrome.evaluate(`(async () => {
    const t0 = Date.now();
    while (!window.__overview && Date.now() - t0 < 60000) await new Promise((r) => setTimeout(r, 100));
    if (!window.__overview) throw new Error('the front-door map never mounted');
    const style = document.createElement('style');
    // at 600 CSS px the phone layout applies, which hides the brand's subtitle
    style.textContent = '#overview .ov-actions, #overview .ov-hint, #overview .ov-legend, #overview .ov-card { display: none !important; }' +
      '#overview .ov-brand span { display: block !important; }';
    document.head.appendChild(style);
    const brand = document.querySelector('#overview .ov-brand span');
    brand.replaceChildren(...${JSON.stringify(TAGLINE)}.flatMap((t, i) => (i ? [document.createElement('br'), t] : [t])));
    const v = window.__overview.view;
    Object.assign(v, ${JSON.stringify(frame)});
    // resize() drops the cached static layer and redraws without refitting
    dispatchEvent(new Event('resize'));
    // the crisp static layer is rendered on a short timer after a view change
    await new Promise((r) => setTimeout(r, 1500));
    await document.fonts.ready;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  })()`, { timeoutMs: 90000 });

  let shot = null;
  let q = QUALITY[0];
  for (q of QUALITY) {
    shot = await chrome.screenshot({ format: 'jpeg', quality: q });
    if (shot.length <= MAX_BYTES) break;
  }
  if (shot.length > MAX_BYTES) throw new Error(`card is ${(shot.length / 1024).toFixed(0)} KiB even at q${q}`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, shot);
  console.log(`og: ${out} ${OG_WIDTH}x${OG_HEIGHT} ${(shot.length / 1024).toFixed(0)} KiB q${q} ` +
    `(scale ${frame.s}, centre ${frame.cx},${frame.cz})`);
  if (noise.length) console.warn(`og: page logged ${noise.length} error(s):\n  ${noise.slice(0, 5).join('\n  ')}`);
} finally {
  await chrome.close().catch(() => {});
  server.close();
}
// The DevTools socket's close handshake can hold the event loop for most of a
// minute after the browser is gone; the card is written, so stop here.
process.exit(0);
