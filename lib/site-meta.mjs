// What a site says about itself, read the way a link preview reads it: the
// og:image, og:title and og:description (or their twitter: and plain
// <meta name="description"> fallbacks) from the first half-megabyte of the
// page, with no JavaScript run. A template shopfront puts the og:image on the
// facade, so a listing that sends no pictures still shows the thing it sells.
//
// Everything here is best effort and returns nulls rather than throwing: a
// site with no og:image gets a shopfront with a blank lit plate, which is a
// worse building, not a rejected listing.
import { fetchAsset } from './fetch-asset.mjs';

const MAX_HTML = 512 * 1024;      // how much of the document is scanned for tags
const FETCH_MAX = 2 << 20;        // ...of a body this big; a heavier page is not read

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

// This goes through fetchAsset rather than fetch(). It used to guard itself
// with `isPrivateAddress(hostname)` — but that function takes an ADDRESS and
// returns true for anything it cannot parse, so every hostname on earth came
// back "private" and this returned null before making a request. The og:image
// path had therefore never run in production: every listing was told its page
// had no og:image, whatever its page actually had. fetchAsset applies the real
// rule (literal IPs directly, hostnames through a guarded DNS lookup that pins
// the resolved address), caps the body, and reports the post-redirect url to
// resolve a relative og:image against.
export async function fetchSiteMeta(url, { timeoutMs = 8000 } = {}) {
  try {
    const { buffer, url: finalUrl } = await fetchAsset(url, {
      maxBytes: FETCH_MAX, label: 'page', timeoutMs, withUrl: true,
    });
    return parseSiteMeta(buffer.toString('utf8').slice(0, MAX_HTML), finalUrl || url);
  } catch {
    // Best effort by contract: a site that will not load gets a shopfront with
    // a blank plate, which is a worse building, not a rejected listing.
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
