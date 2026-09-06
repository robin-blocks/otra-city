// What a site says about itself, read the way a link preview reads it: the
// og:image, og:title and og:description (or their twitter: and plain
// <meta name="description"> fallbacks) from the first half-megabyte of the
// page, with no JavaScript run. A template shopfront puts the og:image on the
// facade, so a listing that sends no pictures still shows the thing it sells.
//
// Everything here is best effort and returns nulls rather than throwing: a
// site with no og:image gets a shopfront with a blank lit plate, which is a
// worse building, not a rejected listing.
import { isPrivateAddress } from './fetch-asset.mjs';

const UA = 'otra-city-bot/1.0 (+https://otra.city/claim)';
const MAX_HTML = 512 * 1024;

// <meta ...> tags with their attributes, whatever order the attributes come in
function metaTags(html) {
  const out = [];
  const re = /<meta\b([^>]*)>/gi;
  let m;
  while ((m = re.exec(html))) {
    const attrs = {};
    const ar = /([a-zA-Z_:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
    let a;
    while ((a = ar.exec(m[1]))) attrs[a[1].toLowerCase()] = a[2] ?? a[3] ?? a[4] ?? '';
    out.push(attrs);
  }
  return out;
}

const decode = (s) => String(s || '')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
  .replace(/\s+/g, ' ').trim();

export function parseSiteMeta(html, baseUrl) {
  const tags = metaTags(html);
  const pick = (...keys) => {
    for (const key of keys) {
      const t = tags.find((a) => (a.property || a.name || '').toLowerCase() === key && a.content);
      if (t) return decode(t.content);
    }
    return null;
  };
  const abs = (u) => {
    if (!u) return null;
    try {
      const url = new URL(u, baseUrl);
      return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
    } catch { return null; }
  };
  const titleTag = /<title[^>]*>([^<]*)<\/title>/i.exec(html);
  return {
    title: pick('og:title', 'twitter:title') || (titleTag ? decode(titleTag[1]) : null),
    description: pick('og:description', 'twitter:description', 'description'),
    image: abs(pick('og:image', 'og:image:url', 'og:image:secure_url', 'twitter:image', 'twitter:image:src')),
  };
}

export async function fetchSiteMeta(url, { timeoutMs = 8000 } = {}) {
  try {
    const host = new URL(url).hostname;
    if (isPrivateAddress(host)) return null;
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    const r = await fetch(url, { signal: ctl.signal, redirect: 'follow', headers: { 'user-agent': UA, accept: 'text/html,*/*;q=0.5' } });
    clearTimeout(t);
    if (!r.ok) return null;
    const html = (await r.text()).slice(0, MAX_HTML);
    return parseSiteMeta(html, r.url || url);
  } catch {
    return null;
  }
}

// Which picture format a buffer really is, by its magic bytes — the client
// decodes these three and nothing else, so an og:image that is a GIF or an
// SVG is left off the building rather than bound to a quad that stays blank.
export function imageKind(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}
