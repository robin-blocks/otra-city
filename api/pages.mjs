// The directory's readable pages — server-rendered, so a crawler, a language
// model or an agent verifying its listing sees the same thing a person does:
//
//   /directory      every listing, grouped by road, with the categories
//   /road/<id>      one road: the categories it serves and what stands on it
//   /lot/<id>       one lot: the listing (or a vacant lot and how to take it)
//
// vercel.json rewrites those paths here with ?page=&id=. The 3D client keeps
// its spawn-outside-the-lot behaviour at /lot/<id>/walk and /s/<slug>.
//
// Everything on these pages comes from the deployed manifest, which is the
// city's word on what stands where; nothing here is fetched at request time.
// Every string a submitter wrote is escaped on the way out — a listing's
// name, description, tags and builder are exactly the strings an attacker
// would put markup in, and a plain link is the one thing a listing is for.
import { readFileSync } from 'node:fs';
import { CATEGORIES, categoryOf, categoryColor, DEFAULT_CATEGORY } from '../public/js/categories.mjs';

const MANIFEST = () => JSON.parse(readFileSync(new URL('../public/plots/index.json', import.meta.url), 'utf8'));
const PLAT = () => JSON.parse(readFileSync(new URL('../public/city/lots.json', import.meta.url), 'utf8'));
const ORIGIN = 'https://otra.city';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// only an http(s) url goes into an href; anything else is shown, never linked
const safeHref = (u) => (/^https?:\/\/[^\s"'<>]+$/i.test(String(u || '')) ? String(u) : null);
const hostOf = (u) => { try { return new URL(u).host.replace(/^www\./, ''); } catch { return ''; } };
const isCity = (p) => hostOf(p.url) === 'otra.city';

const CSS = `
  :root { color-scheme: dark; }
  html, body { margin: 0; background: #0a0817; color: #cfd3e8;
    font: 15px/1.65 ui-monospace, Menlo, Consolas, monospace; }
  main { max-width: 760px; margin: 0 auto; padding: 48px 22px 96px; }
  h1 { font-size: 30px; margin: 0 0 6px; color: #fff; letter-spacing: -.5px; }
  h2 { font-size: 15px; margin: 40px 0 10px; color: #2fe0f8; text-transform: uppercase; letter-spacing: 1.4px; }
  a { color: #2fe0f8; }
  .sub { color: #8a86a0; margin: 0 0 24px; }
  .crumbs { font-size: 13px; color: #6f6b85; margin-bottom: 26px; }
  .crumbs a { color: #8a86a0; }
  .chip { display: inline-block; font-size: 12px; padding: 2px 9px; border-radius: 999px; border: 1px solid #31234f;
    color: #e9edf6; margin: 0 6px 6px 0; text-decoration: none; }
  .chip .sw { display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 6px; vertical-align: 0; }
  .cta { display: inline-block; margin: 10px 8px 0 0; background: #ff2d95; color: #fff; text-decoration: none;
    font-weight: 700; padding: 11px 20px; border-radius: 999px; }
  .cta.alt { background: transparent; color: #2fe0f8; border: 1px solid #31234f; }
  .poster { width: 100%; aspect-ratio: 16 / 9; object-fit: cover; border-radius: 10px; border: 1px solid #31234f;
    background: #0e0b1b; display: block; margin: 18px 0; }
  .meta { color: #8a86a0; font-size: 13px; margin: 4px 0; }
  .meta b { color: #cfd3e8; font-weight: 500; }
  code, pre { background: #150f26; border: 1px solid #31234f; border-radius: 7px; }
  code { padding: 2px 6px; font-size: 13px; }
  pre { padding: 14px 16px; overflow-x: auto; font-size: 12.5px; color: #e9edf6; }
  .cards { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); margin: 12px 0 0; padding: 0; list-style: none; }
  .card { border: 1px solid #31234f; border-radius: 10px; background: #0e0b1b; overflow: hidden; }
  .card img { width: 100%; aspect-ratio: 16 / 9; object-fit: cover; display: block; background: #150f26; }
  .card .blank { width: 100%; aspect-ratio: 16 / 9; display: block; }
  .card .body { padding: 11px 13px 13px; }
  .card b { color: #e9edf6; display: block; }
  .card b a { color: #e9edf6; text-decoration: none; }
  .card span { color: #8a86a0; font-size: 13px; display: block; }
  .card .addr { color: #6f6b85; font-size: 12px; margin-top: 6px; }
  .roads { list-style: none; padding: 0; margin: 0; }
  .roads li { border-top: 1px solid #241f38; padding: 10px 0; }
  .roads li:first-child { border-top: 0; }
  .roads .n { color: #8a86a0; font-size: 13px; }
  #q { width: 100%; box-sizing: border-box; font: inherit; color: #e9edf6; background: #150f26;
    border: 1px solid #31234f; border-radius: 9px; padding: 10px 13px; margin: 6px 0 4px; }
  footer { margin-top: 52px; color: #6f6b85; font-size: 13px; border-top: 1px solid #241f38; padding-top: 18px; }
  footer a { color: #8a86a0; }
`;

const GA = `<script async src="https://www.googletagmanager.com/gtag/js?id=G-ZTVR4HWLHL"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-ZTVR4HWLHL',{anonymize_ip:true});</script>`;

function page({ title, description, canonical, body, jsonld = null, image = null }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:type" content="website">
${image ? `<meta property="og:image" content="${esc(image)}">\n<meta name="twitter:card" content="summary_large_image">` : ''}
${GA}
<style>${CSS}</style>
${jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld).replace(/</g, '\\u003c')}</script>` : ''}
</head>
<body>
<main>
${body}
<footer>
  <a href="/">otra.city</a> · <a href="/directory">directory</a> · <a href="/map">map</a> ·
  <a href="/claim">list your project</a> · <a href="/about">about</a>
</footer>
</main>
</body>
</html>
`;
}

const chip = (catId, { link = true } = {}) => {
  const c = categoryOf(catId) || categoryOf(DEFAULT_CATEGORY);
  const road = roadFor(c.id);
  const inner = `<span class="sw" style="background:${categoryColor(c.id)}"></span>${esc(c.label)}`;
  return link && road ? `<a class="chip" href="/road/${esc(road.id)}">${inner}</a>` : `<span class="chip">${inner}</span>`;
};

let roadsCache = null;
function roads() { return roadsCache; }
function roadFor(catId) { return roads().find((r) => (r.categories || []).includes(catId)) || null; }
function roadById(id) { return roads().find((r) => r.id === id) || null; }

// A listing's picture: the poster the city rendered, else the first picture
// the listing bound, else nothing. Root-relative in the manifest.
function pictureOf(p) {
  if (p.poster) return p.poster;
  const pic = p.media?.pictures?.[0]?.file;
  return pic ? `${p.base}${pic}` : null;
}

function card(p) {
  const img = pictureOf(p);
  const cat = p.category || (isCity(p) ? null : DEFAULT_CATEGORY);
  return `<li class="card">
  <a href="/lot/${esc(p.lot)}">${img ? `<img src="${esc(img)}" alt="${esc(p.name)} in otra.city" loading="lazy">` : '<span class="blank"></span>'}</a>
  <div class="body">
    <b><a href="/lot/${esc(p.lot)}">${esc(p.name)}</a></b>
    <span>${esc(p.tagline || p.description || '')}</span>
    <div class="addr">${esc(p.address)}${cat ? ` · ${esc((categoryOf(cat) || {}).label || cat)}` : ' · the city\u2019s own'}</div>
  </div>
</li>`;
}

function listingLd(p) {
  const ld = {
    '@context': 'https://schema.org',
    '@type': isCity(p) ? 'Place' : 'SoftwareApplication',
    name: p.name,
    description: p.description || p.tagline || undefined,
    url: safeHref(p.url) || undefined,
    image: pictureOf(p) ? `${ORIGIN}${pictureOf(p)}` : undefined,
  };
  if (!isCity(p)) {
    ld.applicationCategory = (categoryOf(p.category) || categoryOf(DEFAULT_CATEGORY)).label;
    if (p.pricing === 'free') ld.offers = { '@type': 'Offer', price: '0', priceCurrency: 'USD' };
    ld.keywords = Array.isArray(p.tags) && p.tags.length ? p.tags.join(', ') : undefined;
    ld.license = typeof p.license === 'string' && p.license ? p.license : undefined;
  }
  return ld;
}

export function renderLot(id, manifest, plat) {
  roadsCache = manifest.roads || [];
  const lot = plat.lots?.[id];
  if (!lot) return null;
  const p = (manifest.lots || []).find((l) => l.lot === id);
  const road = roadById(lot.road);
  const walk = `/lot/${esc(id)}/walk`;
  if (!p) {
    const cats = road?.categories || [];
    const claim = `curl -X POST ${ORIGIN}/api/plots/submit -H 'content-type: application/json' -d '{
  "plot": { "slug": "your-project", "name": "Your Project", "url": "https://your-project.dev",
            "description": "One sentence about it.", "category": "${esc(cats[0] || DEFAULT_CATEGORY)}",
            "builder": "which agent is submitting this" },
  "dry": true }'`;
    const body = `<div class="crumbs"><a href="/directory">directory</a> › <a href="/road/${esc(lot.road)}">${esc(road?.name || lot.road)}</a></div>
<h1>${esc(lot.address)}</h1>
<p class="sub">A vacant lot on ${esc(road?.name || lot.road)}${cats.length ? `, the road for ${cats.map((c) => esc((categoryOf(c) || {}).label || c)).join(', ')}` : ''}. Nobody stands here yet.</p>
<div>${cats.map((c) => chip(c)).join('')}</div>
<a class="cta" href="${walk}">Walk there</a>
<h2>Take it</h2>
<p>A listing in ${cats.length ? 'one of those categories' : 'any category'} lands on this road, on the first free lot nearest the centre — this one, or the one beside it. One HTTP call, no account: <a href="/claim">how to list your project</a>.</p>
<pre>${esc(claim)}</pre>`;
    return page({ title: `${lot.address} — vacant · otra.city`, canonical: `${ORIGIN}/lot/${id}`,
      description: `${lot.address} is a vacant lot in otra.city${cats.length ? ` on the road for ${cats.join(', ')}` : ''}. List your project and stand here.`, body });
  }
  const href = safeHref(p.url);
  const host = hostOf(p.url);
  const cat = p.category || (isCity(p) ? null : DEFAULT_CATEGORY);
  const img = pictureOf(p);
  const embed = `<iframe src="${ORIGIN}/embed?plot=${p.slug}" width="100%" height="420" style="border:0;border-radius:12px" loading="lazy" allow="autoplay" title="${p.name} in otra.city"></iframe>`;
  const body = `<div class="crumbs"><a href="/directory">directory</a> › <a href="/road/${esc(lot.road)}">${esc(road?.name || lot.road)}</a> › ${esc(lot.address)}</div>
<h1>${esc(p.name)}</h1>
<p class="sub">${esc(p.tagline || '')}</p>
<div>${cat ? chip(cat) : '<span class="chip">the city\u2019s own</span>'}${p.pricing ? `<span class="chip">${esc(p.pricing)}</span>` : ''}${(Array.isArray(p.tags) ? p.tags : []).map((t) => `<span class="chip">#${esc(t)}</span>`).join('')}</div>
${img ? `<img class="poster" src="${esc(img)}" alt="${esc(p.name)} — ${esc(lot.address)}, otra.city">` : ''}
${p.description ? `<p>${esc(p.description)}</p>` : ''}
<p class="meta"><b>Website</b> ${href ? `<a href="${esc(href)}">${esc(host || href)} ↗</a>` : esc(p.url || '')}</p>
<p class="meta"><b>Address</b> ${esc(lot.address)}, otra.city · <a href="/s/${esc(p.slug)}">otra.city/s/${esc(p.slug)}</a></p>
<p class="meta"><b>Built by</b> ${esc(p.builder || 'unknown')}${p.template ? ` · shopfront by the city (${esc(p.template.id)}/${esc(p.template.variant)} v${esc(p.template.version)})` : ''}</p>
<p class="meta"><b>Licence</b> ${p.license ? `${esc(p.license)} — the submitter's terms for these files` : 'all rights reserved by the submitter'} · otra.city hosts and displays them, it does not own them (<a href="/docs/submission.md">terms</a>)</p>
<a class="cta" href="${walk}">Walk there</a> <a class="cta alt" href="/embed?plot=${esc(p.slug)}">Frontage only</a>
<h2>Embed this shopfront</h2>
<pre>${esc(embed)}</pre>
<h2>For agents</h2>
<p class="meta"><code>GET ${ORIGIN}/api/plots/${esc(p.slug)}</code> — this listing as JSON: position, permalink, poster, the plot as published. Resubmit the same slug from ${esc(host || 'the same host')} to update it; <a href="/claim#build">send a .glb</a> to replace the city's building with your own.</p>`;
  return page({ title: `${p.name} — ${lot.address} · otra.city`, canonical: `${ORIGIN}/lot/${id}`,
    description: p.description || p.tagline || `${p.name} in otra.city`, body, jsonld: listingLd(p),
    image: img ? `${ORIGIN}${img}` : null });
}

export function renderRoad(id, manifest, plat) {
  roadsCache = manifest.roads || [];
  const road = roadById(id);
  if (!road) return null;
  const lots = (manifest.lots || []).filter((l) => l.road === id).sort((a, b) => a.n - b.n);
  const vacant = (manifest.vacant || []).filter((v) => v.road === id);
  const cats = road.categories || [];
  const mapRoad = (plat.roads || {})[id] || {};
  const body = `<div class="crumbs"><a href="/directory">directory</a> › ${esc(road.name)}</div>
<h1>${esc(road.name)}</h1>
<p class="sub">${cats.length ? `The road for ${cats.map((c) => esc((categoryOf(c) || {}).label || c)).join(', ')}` : 'A road the city places by hand'} · ${lots.length} listed, ${vacant.length} free of ${(mapRoad.lots || []).length}</p>
<div>${cats.map((c) => chip(c, { link: false })).join('')}</div>
${lots.length ? `<ul class="cards">${lots.map(card).join('')}</ul>` : '<p class="meta">Nothing stands here yet.</p>'}
${vacant.length ? `<h2>Free lots</h2><p class="meta">${vacant.map((v) => `<a href="/lot/${esc(v.lot)}">${esc(v.address)}</a>`).join(' · ')}</p>
<p>${cats.length ? `A listing in ${cats.map((c) => esc(c)).join(', ')} lands here. ` : ''}<a href="/claim">List your project</a> — one HTTP call, no account.</p>` : ''}`;
  const ld = { '@context': 'https://schema.org', '@type': 'ItemList', name: `${road.name} — otra.city`,
    itemListElement: lots.map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: `${ORIGIN}/lot/${p.lot}`, name: p.name })) };
  return page({ title: `${road.name} · otra.city`, canonical: `${ORIGIN}/road/${id}`,
    description: `${road.name} in otra.city${cats.length ? `: the road for ${cats.join(', ')}` : ''}. ${lots.length} listed, ${vacant.length} lots free.`, body, jsonld: ld });
}

export function renderDirectory(manifest, plat) {
  roadsCache = manifest.roads || [];
  const listed = (manifest.lots || []).filter((p) => !isCity(p));
  const city = (manifest.lots || []).filter(isCity);
  const byRoad = roads().map((r) => ({ r, lots: listed.filter((l) => l.road === r.id).sort((a, b) => a.n - b.n),
    free: (manifest.vacant || []).filter((v) => v.road === r.id).length }));
  const catRows = CATEGORIES.map((c) => {
    const road = roadFor(c.id);
    const n = listed.filter((p) => (p.category || DEFAULT_CATEGORY) === c.id).length;
    return `<li>${chip(c.id)} <span class="n">${n} listed${road ? ` · <a href="/road/${esc(road.id)}">${esc(road.name)}</a>` : ' · no road yet'}</span></li>`;
  }).join('');
  const body = `<h1>The directory</h1>
<p class="sub">${listed.length} AI tools and projects, each with a page, a link and a shopfront in the city. Roads are categories: walk one and you see one kind of thing. <a href="/claim">List yours</a> — one HTTP call, no account, live in about two minutes.</p>
<input id="q" type="search" placeholder="filter by name, tag or category…" aria-label="filter listings" hidden>
<h2>Categories</h2>
<ul class="roads">${catRows}</ul>
${byRoad.filter((x) => x.lots.length).map(({ r, lots, free }) => `<h2><a href="/road/${esc(r.id)}">${esc(r.name)}</a> <span class="n">· ${lots.length} listed, ${free} free</span></h2>
<ul class="cards">${lots.map(card).join('')}</ul>`).join('')}
${city.length ? `<h2>The city's own</h2><ul class="cards">${city.map(card).join('')}</ul>` : ''}
<h2>For agents</h2>
<p class="meta"><code>GET ${ORIGIN}/api/plots</code> is this page as JSON — every listing with its category, road, address, poster and url, every road with the categories it serves, and every free lot. <a href="/llms.txt">llms.txt</a> has the rest.</p>
<script>
(function () {
  var q = document.getElementById('q'); q.hidden = false;
  var cards = Array.prototype.slice.call(document.querySelectorAll('.card'));
  q.addEventListener('input', function () {
    var s = q.value.trim().toLowerCase();
    cards.forEach(function (c) { c.style.display = !s || c.textContent.toLowerCase().indexOf(s) >= 0 ? '' : 'none'; });
  });
})();
</script>`;
  const ld = { '@context': 'https://schema.org', '@type': 'ItemList', name: 'otra.city directory',
    itemListElement: listed.map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: `${ORIGIN}/lot/${p.lot}`, name: p.name })) };
  return page({ title: 'Directory · otra.city', canonical: `${ORIGIN}/directory`,
    description: `A free directory of ${listed.length} AI tools and projects, brought to life as a city. Roads are categories; every listing has a page, a link and a shopfront.`, body, jsonld: ld });
}

function notFound(what) {
  return page({ title: 'Not here · otra.city', canonical: `${ORIGIN}/directory`, description: 'No such page in otra.city.',
    body: `<h1>Not here</h1><p class="sub">${esc(what)} is not on the map. <a href="/directory">The directory</a> has everything that is.</p>` });
}

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  const which = url.searchParams.get('page');
  const id = url.searchParams.get('id') || '';
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.setHeader('cache-control', 'public, s-maxage=300, stale-while-revalidate=3600');
  try {
    const manifest = MANIFEST();
    const plat = PLAT();
    let html = null;
    if (which === 'directory') html = renderDirectory(manifest, plat);
    else if (which === 'road' && /^[a-z][a-z0-9-]*$/.test(id)) html = renderRoad(id, manifest, plat);
    else if (which === 'lot' && /^[a-z][a-z0-9-]*-\d+$/.test(id)) html = renderLot(id, manifest, plat);
    if (!html) {
      res.statusCode = 404;
      res.end(notFound(id ? `"${id}"` : 'that'));
      return;
    }
    res.statusCode = 200;
    res.end(html);
  } catch (e) {
    console.error('pages failed:', e.message || e);
    res.statusCode = 500;
    res.end(page({ title: 'Error · otra.city', canonical: `${ORIGIN}/directory`, description: 'The page could not be built.',
      body: '<h1>Something broke</h1><p class="sub">The page could not be built. <a href="/directory">Try the directory.</a></p>' }));
  }
}
