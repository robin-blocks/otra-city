// Drive public/venue.html headless: serve public/ through the site's one
// static host (lib/static-server.mjs), open the fixture for one venue, and
// expose the page's __venue API as awaitable helpers. venue-check, venue-shot
// and venue-bench all use it, so what they measure is exactly what a
// visitor's browser runs.
import { join } from 'node:path';
import { serve } from './static-server.mjs';
import { launchChrome } from './headless-chrome.mjs';

export const PUBLIC_DIR = join(new URL('..', import.meta.url).pathname, 'public');

export async function openFixture({ venue, tier = null, fast = true, street = true, bundle = null, cam = null,
  width = 1536, height = 864, gpu = false, timeoutMs = 60000 } = {}) {
  const { server, origin } = await serve(PUBLIC_DIR);
  const chrome = await launchChrome({ width, height, gpu });
  const problems = [];
  chrome.onConsole((type, text) => { if (type === 'error') problems.push(text); });
  const q = new URLSearchParams();
  if (venue) q.set('venue', venue);
  if (tier !== null) q.set('tier', String(tier));
  if (fast) q.set('fast', '1');
  if (!street) q.set('street', '0');
  if (bundle) q.set('bundle', bundle);
  if (cam) q.set('cam', cam);
  await chrome.goto(`${origin}/venue.html?${q}`);
  // module scripts with top-level await may still be running after `load`
  const deadline = Date.now() + timeoutMs;
  while (!(await chrome.evaluate('!!window.__venue && !!window.__venue.def'))) {
    if (Date.now() > deadline) throw new Error('fixture did not initialise (no window.__venue)');
    await new Promise((r) => setTimeout(r, 200));
  }
  const ev = (expr) => chrome.evaluate(expr);
  const api = {
    chrome, origin, server, problems,
    evaluate: ev,
    def: () => ev('JSON.stringify(window.__venue.def)').then(JSON.parse),
    setTier: (t) => ev(`window.__venue.setTier(${t === null ? 'null' : t})`),
    setCam: (name) => ev(`window.__venue.setCam(${JSON.stringify(name)})`),
    setPos: (x, z) => ev(`window.__venue.setPos(${x}, ${z})`),
    setLocal: (x, z) => ev(`window.__venue.setLocal(${x}, ${z})`),
    step: (frames = 30, dt = 1 / 60) => ev(`JSON.stringify(window.__venue.step(${frames}, ${dt}))`).then(JSON.parse),
    stats: () => ev('JSON.stringify(window.__venue.stats())').then(JSON.parse),
    state: () => ev('JSON.stringify(window.__venue.state())').then(JSON.parse),
    walkability: (opts = {}) => ev(`JSON.stringify(window.__venue.walkability(${JSON.stringify(opts)}))`).then(JSON.parse),
    async waitLoaded(ms = 90000) {
      const until = Date.now() + ms;
      for (;;) {
        const s = await api.state();
        const v = s.venues.find((x) => x.id === venue) || s.venues[0];
        if (v?.loaded) return v;
        if (v?.error) throw new Error(v.error);
        if (Date.now() > until) throw new Error('venue did not load in time');
        await ev('window.__venue.step(1)');
        await new Promise((r) => setTimeout(r, 250));
      }
    },
    async shot() {
      const b64 = await ev(`(() => { const u = window.__venue.renderer.domElement.toDataURL('image/png'); return u.slice(u.indexOf(',') + 1); })()`);
      return Buffer.from(b64, 'base64');
    },
    async close() {
      await chrome.close().catch(() => {});
      server.close();
    },
  };
  return api;
}
