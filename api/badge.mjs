// GET /badge/<slug>.svg — the badge a listing pastes on its own site
// (lib/badge.mjs has the why). vercel.json rewrites /badge/:file here.
//
// Always an image, never an error page: a README that embeds a slug which is
// not live yet, was mistyped, or was taken down still shows the generic badge
// instead of a broken-image icon. The address appears once the slug is on the
// street, read from the manifest deployed alongside this function — so the
// CDN copy is only ever as stale as the deployment it belongs to.
import { readFileSync } from 'node:fs';
import { renderBadge, SLUG_RE } from '../lib/badge.mjs';

const MANIFEST = () => JSON.parse(readFileSync(new URL('../public/plots/index.json', import.meta.url), 'utf8'));

export function addressFor(slug, manifest) {
  if (!SLUG_RE.test(slug)) return null;
  return (manifest.lots || []).find((l) => l.slug === slug)?.address || null;
}

export default function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  const slug = (url.searchParams.get('file') || '').toLowerCase().replace(/\.svg$/, '');
  let address = null;
  try { address = slug ? addressFor(slug, MANIFEST()) : null; } catch (e) { console.error('badge manifest:', e.message || e); }
  res.statusCode = 200;
  res.setHeader('content-type', 'image/svg+xml; charset=utf-8');
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('access-control-allow-origin', '*');
  // short for viewers and image proxies (GitHub's camo honours it), so a
  // badge pasted before going live picks up its address within minutes
  res.setHeader('cache-control', 'public, max-age=300, s-maxage=86400, stale-while-revalidate=604800');
  res.end(renderBadge(address));
}
