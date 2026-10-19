#!/usr/bin/env node
// Every page someone might paste into Reddit, Slack or X carries a full social
// card — `npm run og:check`.
//
// The static pages shipped with no og: tags at all, so a shared link to the
// front door unfurled as bare text while /directory and /lot/<id> (built by
// api/pages.mjs) had cards. This sweeps every public/*.html that is not
// noindex, so a new page cannot quietly ship without one, and checks the card
// image is really there at the size the tags declare — an og:image that 404s
// or lies about its size is dropped by most unfurlers without a word.
//
// stdlib only: the JPEG/PNG headers are read by hand.
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ORIGIN = 'https://otra.city';
const MAX_IMAGE_BYTES = 300 << 10;
const root = new URL('..', import.meta.url).pathname;
const pub = join(root, 'public');

let failed = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(58)}${detail}`);
  if (!ok) failed++;
};

const decode = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>').replace(/&amp;/g, '&');
// Attribute order varies by hand; match the tag, then read its content.
const meta = (html, attr, key) => {
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    if (new RegExp(`\\b${attr}="${key}"`, 'i').test(tag)) {
      const c = tag.match(/\bcontent="([^"]*)"/i);
      return c ? decode(c[1]) : '';
    }
  }
  return null;
};
const canonicalOf = (html) => {
  const tag = html.match(/<link\b[^>]*\brel="canonical"[^>]*>/i);
  return tag ? decode(tag[0].match(/\bhref="([^"]*)"/i)?.[1] || '') : null;
};

// Width and height from the file itself: PNG's IHDR, or a JPEG's first
// start-of-frame marker.
function imageSize(buf) {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) {
    return { type: 'image/png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { type: 'image/jpeg', width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
      }
      i += 2 + len;
    }
  }
  return null;
}

const pages = readdirSync(pub).filter((f) => f.endsWith('.html')).sort();
const images = new Map();
for (const file of pages) {
  const html = readFileSync(join(pub, file), 'utf8');
  if (/<meta\s+name="robots"\s+content="[^"]*noindex/i.test(html)) {
    console.log(`skip  ${file.padEnd(58)}noindex`);
    continue;
  }
  const title = decode(html.match(/<title>([^<]*)<\/title>/i)?.[1] || '');
  const description = meta(html, 'name', 'description');
  const canonical = canonicalOf(html);
  const og = (k) => meta(html, 'property', `og:${k}`);
  const missing = ['title', 'description', 'url', 'type', 'image', 'image:width', 'image:height']
    .filter((k) => !og(k)).map((k) => `og:${k}`);
  if (!canonical) missing.push('canonical');
  if (meta(html, 'name', 'twitter:card') !== 'summary_large_image') missing.push('twitter:card=summary_large_image');
  check(`${file}: full card tag set`, !missing.length, missing.length ? `missing ${missing.join(', ')}` : '');
  if (missing.length) continue;

  check(`${file}: canonical is an absolute ${ORIGIN} url`, canonical.startsWith(`${ORIGIN}/`), canonical);
  check(`${file}: og:url matches the canonical`, og('url') === canonical, og('url'));
  check(`${file}: og:title matches <title>`, og('title') === title, og('title'));
  check(`${file}: og:description matches the meta description`, og('description') === description);
  const img = og('image');
  check(`${file}: og:image is absolute on ${ORIGIN}`, img.startsWith(`${ORIGIN}/`), img);
  const entry = images.get(img) || { declared: new Set(), pages: [] };
  entry.declared.add(`${og('image:width')}x${og('image:height')}${og('image:type') ? ` ${og('image:type')}` : ''}`);
  entry.pages.push(file);
  images.set(img, entry);
}

for (const [url, { declared, pages: on }] of images) {
  const rel = new URL(url).pathname;
  const file = join(pub, rel);
  const where = `${rel} (${on.length} page${on.length > 1 ? 's' : ''})`;
  if (!existsSync(file)) { check(`${where} exists`, false, `no file at public${rel}`); continue; }
  const buf = readFileSync(file);
  const got = imageSize(buf);
  check(`${where} is a JPEG or PNG`, !!got, got ? got.type : 'unreadable header (WebP is not accepted everywhere)');
  if (!got) continue;
  check(`${where} is under ${MAX_IMAGE_BYTES >> 10} KiB`, statSync(file).size <= MAX_IMAGE_BYTES,
    `${(statSync(file).size / 1024).toFixed(0)} KiB`);
  check(`${where} has one declared size across pages`, declared.size === 1, [...declared].join(' | '));
  const [want] = declared;
  const [, w, h, type] = want.match(/^(\d+)x(\d+)(?: (\S+))?$/) || [];
  check(`${where} is really ${w}x${h}`, got.width === +w && got.height === +h, `${got.width}x${got.height}`);
  if (type) check(`${where} og:image:type matches the file`, type === got.type, `${type} vs ${got.type}`);
}

console.log(failed ? `\n${failed} check(s) failed` : '\nall social card checks passed');
process.exit(failed ? 1 : 0);
