#!/usr/bin/env node
// The submission endpoint's test suite — `npm run api:check`.
//
// api/ was the last lane with no gate on it: a change to the endpoint that
// decides who gets into the city reached main with nothing exercising it, and
// the only way to find out it broke was somebody else's submission failing.
// This drives the REAL handler (the same module Vercel loads) over a loopback
// server, so every case below is the answer a submitting agent would get.
//
// Hermetic on purpose: no GITHUB_TOKEN (so the handler is in dry mode), the
// backlink pages are served from a temp dir, the registry is this checkout,
// and the one case that must leave the machine points at a host that does not
// resolve — the assertion is about the url check, which runs either way.
//
// Two origins are needed, not one: `localhost` and `127.0.0.1` are the same
// machine but different hosts, which is exactly the shape of a redirect that
// leaves the domain it claimed.
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdtempSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import handler, { buildListing, deriveTagline, submissionContract } from '../api/submit.mjs';
import { CATEGORY_IDS } from '../public/js/categories.mjs';
import { parseSiteMeta, imageKind } from '../lib/site-meta.mjs';
import { renderLot, renderRoad, renderDirectory, esc } from '../api/pages.mjs';
import { pickLot, platLots } from '../public/js/city-map.mjs';
import { needs, plan, districts } from '../lib/city-growth.mjs';
import drain, { selectRecords, parseBatch } from '../api/log-drain.mjs';
import { apexHost, sameSite, ownerKey, classifyUrl } from '../lib/submitter-host.mjs';
import badgeHandler, { addressFor } from '../api/badge.mjs';
import { freeSlug, heldSlug } from '../api/plot-status.mjs';
import pendingHandler from '../api/pending.mjs';
import { pendingStore, fileClaim, readClaim, sweep, PENDING_DAYS, PENDING_PER_OWNER } from '../lib/pending.mjs';
import { badgeSnippets, renderBadge } from '../lib/badge.mjs';

const root = new URL('..', import.meta.url).pathname;
const GLB = readFileSync(join(root, 'public/plots/archive-9/plot.glb')).toString('base64');

let failed = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(46)}${detail}`);
  if (!ok) failed++;
};

// --- the two fixture origins ---------------------------------------------
const pages = mkdtempSync(join(tmpdir(), 'otra-api-'));
const listen = (host, onReq) => new Promise((r) => {
  const s = createServer(onReq);
  s.listen(0, host, () => r({ server: s, origin: `http://${host}:${s.address().port}` }));
});
const serveFile = (dir) => (req, res) => {
  const name = req.url.split('?')[0].replace(/^\//, '') || 'index.html';
  if (name === 'offsite') {                       // redirects away from the domain it claims
    res.writeHead(302, { location: `${away.origin}/backlink.html` });
    return res.end();
  }
  if (name === 'moved') {                         // redirects WITHIN the domain: legitimate
    res.writeHead(302, { location: '/backlink.html' });
    return res.end();
  }
  try { res.writeHead(200, { 'content-type': 'text/html' }).end(readFileSync(join(dir, name))); }
  catch { res.writeHead(404).end('no'); }
};

// `away` is a second origin standing in for somebody else's site: it carries a
// perfectly good permalink, which is the point — the redirect must fail even
// though the page it lands on would have passed.
const away = await listen('127.0.0.1', serveFile(pages));
const site = await listen('localhost', serveFile(pages));
const api = await listen('localhost', (req, res) => handler(req, res));

const SLUG = 'api-check-fixture';
writeFileSync(join(pages, 'backlink.html'), `<!doctype html><a href="https://otra.city/s/${SLUG}">my plot</a>`);
writeFileSync(join(pages, 'bare.html'), '<!doctype html><p>nothing here</p>');
// the badge snippet, pasted as-is, and nothing else: it has to be the proof too
writeFileSync(join(pages, 'badge.html'), `<!doctype html><p>${badgeSnippets(SLUG).html}</p>`);
// a listing's page: the permalink for proof, and an og:image the way a site
// declares one (the fixture host is http, so the fetch of it fails honestly)
writeFileSync(join(pages, 'listing.html'), `<!doctype html><head><meta property="og:image" content="/og.png"></head>` +
  `<a href="https://otra.city/s/${SLUG}">my plot</a>`);
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ff9f000200fe01fc3aa1660c0000000049454e44ae426082', 'hex');

const post = async (body) => {
  const r = await fetch(`${api.origin}/api/plots/submit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'otra-city-api-check/1.0' },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: await r.json() };
};
const bundle = (over = {}) => ({
  plot: { slug: SLUG, name: 'API CHECK', tagline: 'the endpoint, under test',
    url: `${site.origin}/backlink.html`, builder: 'api-check', type: 'freeform', ...over },
  glb_base64: GLB, dry: true,
});

// --- host classification, at the unit it is decided ------------------------
check('apexHost keeps a country registry', apexHost('https://blog.a.co.uk/x') === 'a.co.uk');
check('apexHost keeps a publish subdomain', apexHost('https://alice.github.io') === 'alice.github.io');
check('two github.io users are not one site', !sameSite('https://a.github.io', 'https://b.github.io'));
check('www is the same site', sameSite('https://a.com', 'https://www.a.com/x'));
check('a publish domain is listed, its homepage is not',
  apexHost('https://x.bolt.host') === 'x.bolt.host' && apexHost('https://x.bolt.new') === 'bolt.new');
check('a shared host carries its tenant', ownerKey('https://github.com/alice/p') === 'github.com/alice');
check('your own domain is your whole identity', ownerKey('https://4dgsx.com/x') === '4dgsx.com');
check('a tunnel is not a permanent address', classifyUrl('https://x.ngrok-free.app').tier === 'ephemeral');
check('a shortener is not a permanent address', classifyUrl('https://bit.ly/x').tier === 'ephemeral');
check('a bare IP is not an identity', classifyUrl('https://93.184.216.34/').tier === 'invalid');
check('a real domain passes', classifyUrl('https://4dgsx.com').ok);

// --- the endpoint ----------------------------------------------------------
{
  const { status, json } = await post(bundle());
  check('a clean bundle is accepted', json.accepted === true && status === 200,
    json.accepted ? '' : (json.report || json.error || '').split('\n').filter((l) => l.startsWith('FAIL')).join(' | '));
  check('the dry run says it is a dry run', json.dry === true);
  // Two checks answer questions about the url and they must not share a label:
  // identity's `url` (well-formed https) and `url host` (an address that lasts).
  const urlLines = (json.report || '').split('\n').filter((l) => /^(PASS|FAIL) {2}url/.test(l));
  check('the report names both url checks, distinctly',
    urlLines.length === 2 && new Set(urlLines.map((l) => l.slice(6).trim().split(/ {2,}/)[0])).size === 2,
    urlLines.map((l) => l.slice(0, 22)).join(' / '));
  check('it hands back a permalink and a status url',
    json.permalink === `https://otra.city/s/${SLUG}` && !!json.status_url);
  check('it hands back the badge, linking to that permalink',
    json.badge?.svg === `https://otra.city/badge/${SLUG}.svg` &&
    json.badge.markdown.endsWith(`](${json.permalink})`) && json.badge.html.includes(`href="${json.permalink}"`));
}
// --- the wrapper and the wire format ----------------------------------------
// The two shapes production saw fail with no explanation: listing fields sent
// at the top level without `plot`, and a form post (curl -d's default type).
const postRaw = async (body, type) => {
  const r = await fetch(`${api.origin}/api/plots/submit`, {
    method: 'POST', headers: { 'content-type': type, 'user-agent': 'otra-city-api-check/1.0' }, body,
  });
  return { status: r.status, json: await r.json() };
};
{
  const { plot, ...rest } = bundle();
  const { status, json } = await post({ ...plot, ...rest });
  check('a flat body (no `plot`) is rejected', json.accepted === false && status === 422);
  check('...with a hint naming the `plot` wrapper and the docs',
    /`plot` object/.test(json.hint || '') && /otra\.city\/docs\/submission\.md/.test(json.hint || ''));
  check('...and the report says which fields belong under it',
    /^FAIL {2}plot .*slug, name, url, tagline, builder were sent at the top level/m.test(json.report || ''),
    (json.report || '').split('\n')[0]);
}
{
  const { json } = await post(bundle());
  check('a wrapped bundle carries no hint', json.accepted === true && !('hint' in json));
}
{
  const form = new URLSearchParams({ slug: SLUG, name: 'API CHECK', url: `${site.origin}/backlink.html` });
  const { status, json } = await postRaw(form.toString(), 'application/x-www-form-urlencoded');
  check('a form-encoded body is a 415 naming the content-type',
    status === 415 && /application\/json/.test(json.error || ''), json.error);
  check('...with the same `plot` hint', /`plot` object/.test(json.hint || ''));
}
{
  // curl -d '{...}' without -H: JSON on the wire, labelled as a form
  const { status } = await postRaw(JSON.stringify(bundle()), 'application/x-www-form-urlencoded');
  check('JSON labelled as a form is still a 415, not a guess', status === 415);
}
{
  const { status, json } = await postRaw('{"plot": {', 'application/json');
  check('malformed JSON is a 400 that says so, with the hint',
    status === 400 && /not valid JSON/.test(json.error || '') && !!json.hint, json.error);
}
{
  const { status, json } = await post([bundle()]);
  check('a JSON array is a 400, not a crash', status === 400 && /JSON object/.test(json.error || ''), json.error);
}
{
  // text/plain carrying JSON has always worked; the content-type gate must not break it
  const { json } = await postRaw(JSON.stringify(bundle()), 'text/plain');
  check('JSON sent as text/plain is still read', json.accepted === true,
    json.error || (json.report || '').split('\n').filter((l) => l.startsWith('FAIL')).join(' | '));
}
{
  const { json } = await post(bundle({ url: `${site.origin}/bare.html` }));
  check('no permalink on the page is a rejection', json.accepted === false && json.result.backlink.ok === false);
  check('...and the rejection points at the badge snippet', /badge/.test(json.result.backlink.detail));
}
{
  const { json } = await post(bundle({ url: `${site.origin}/badge.html` }));
  check('the badge snippet alone is the backlink proof', json.accepted === true && json.result.backlink.ok === true,
    json.result?.backlink?.detail);
}
{
  const { json } = await post(bundle({ url: `${site.origin}/moved` }));
  check('a redirect within the site still passes', json.accepted === true,
    json.accepted ? '' : json.result?.backlink?.detail);
}
{
  // The spoof the same-site guard exists for: the page it lands on carries a
  // valid permalink, so without the guard this is indistinguishable from proof.
  const { json } = await post(bundle({ url: `${site.origin}/offsite` }));
  check('a redirect off the domain is a rejection',
    json.accepted === false && json.result.backlink.mode === 'redirected', json.result?.backlink?.mode);
}
{
  // The city republishes every live permalink itself (GET /api/plots/<slug>
  // answers with one), so its own pages prove nothing — and a frozen
  // exhibition card must not be routable-around via the API. Rejected before
  // any fetch, so this case never leaves the machine.
  const { json } = await post(bundle({ url: 'https://otra.city/api/plots/anything' }));
  check('a city page other than /houses cannot vouch',
    json.accepted === false && json.result.backlink.mode === 'city-host' &&
    /houses/.test(json.result.backlink.detail), json.result?.backlink?.mode);
}
{
  const { json } = await post(bundle({ url: 'https://otra-city-api-check.bore.pub/' }));
  check('a tunnel url cannot hold a lot',
    json.accepted === false && json.result.url.ok === false && json.result.url.tier === 'ephemeral');
}
{
  // archive-9 is on file as otra.city; a stranger claiming that slug is denied.
  const { json } = await post({ ...bundle(), plot: { ...bundle().plot, slug: 'archive-9' } });
  check('another owner cannot take an existing slug',
    json.accepted === false && json.result.ownership.ok === false, json.result?.ownership?.mode);
}
{
  // The city's own lots share otra.city, so the manifest always has a pair to
  // find — which is why this is a warning and never a rejection.
  const { json } = await post(bundle({ url: 'https://otra.city/claim', slug: 'api-check-dupe' }));
  check('a second lot for one owner warns, never rejects',
    !!json.result.duplicate && json.result.duplicate.ok === true && /WARN {2}duplicate/.test(json.report));
}
// --- a listing: no build of its own -------------------------------------------
const listing = (over = {}) => ({
  plot: { slug: SLUG, name: 'API CHECK', url: `${site.origin}/listing.html`, builder: 'api-check',
    description: 'A directory listing under test: one sentence about what it does, long enough that the board needs a shorter line than this one.',
    category: 'code-assist', ...over },
  dry: true,
});
{
  const { status, json } = await post(listing());
  check('a listing with no build is accepted and built', status === 200 && json.accepted === true && json.build === 'template',
    json.accepted ? '' : (json.report || json.error || '').split('\n').filter((l) => l.startsWith('FAIL')).join(' | '));
  // The board line is cut at a CLAUSE, not a word: a tagline that stops at a
  // word leaves a sentence severed mid-thought, which is how PasteGuard's
  // shopfront ended up saying "…and PII before pasting…" and stopping one word
  // before the half that said what it was for. A clause cut needs no ellipsis
  // because nothing is left dangling.
  check('the board line is cut at a clause, and reads as a whole phrase',
    typeof json.plot?.tagline === 'string' && json.plot.tagline.length <= 80
    && !json.plot.tagline.endsWith('…') && json.plot.tagline.endsWith('does'), json.plot?.tagline);
  check('the stored plot records the template it was built with',
    json.plot?.template?.id === 'shopfront' && typeof json.plot.template.variant === 'string' && json.plot.type === 'shop');
  check('a listing lands on the road for its category',
    /^west-/.test(json.lot || '') && json.result.lot.mode === 'category', `${json.lot} ${json.result?.lot?.mode}`);
  check('an og:image the city cannot fetch is a warning, never a rejection',
    json.accepted === true && /WARN {2}shopfront/.test(json.report) && json.result.shopfront.pictures === 0);
  // Everything the city builds is a floor. The report is the only place a
  // submitting agent finds out how to raise it, so the offer is a checked
  // property of the response rather than a line somebody hopes stays put.
  check('the report tells a listing how to get a better building',
    /images/.test(json.report) && /logo/.test(json.report) && /colors/.test(json.report));
  check('a shop with no logo says so and names the format that would work',
    json.result.shopfront.logo === null && /monogram/.test(json.report) && /png/.test(json.report));
  check('the name goes on the building, not just the kerb board',
    new RegExp(`the sign over the door says "${json.plot.name}"`).test(json.report));
  check('the report says the city built it', /PASS {2}shopfront {6}built by the city/.test(json.report));
  check('it hands back the listing page', json.lot_url === `https://otra.city/lot/${json.lot}`);
}
{
  const { json } = await post(listing({ category: 'agents', lot: 'boulevard-2' }));
  check('a listing cannot pick its lot — its category places it',
    json.accepted === true && /^north-/.test(json.lot || '') && /ignored/.test(json.result.lot.detail), `${json.lot}`);
}
{
  // A near miss is mapped, never refused: "AI Music" was a real rejection
  // (musci.io, Oct 2026) from a submitter who then gave up. The published
  // plot holds the id, the report says what was done, the log keeps both.
  const orig = console.log;
  let line = null;
  console.log = (...a) => { if (String(a[0]).startsWith('SUBMIT ')) line = JSON.parse(String(a[0]).slice(7)); orig(...a); };
  const { json } = await post(listing({ category: 'AI Music' }));
  console.log = orig;
  check('a near-miss category is mapped to the id it meant, not rejected',
    json.accepted === true && json.plot.category === 'audio-generation' &&
    json.result.category?.sent === 'AI Music' && json.result.category?.placed_as === 'audio-generation',
    json.accepted ? json.plot?.category : (json.report || '').split('\n').filter((l) => l.startsWith('FAIL')).join(' | '));
  check('the mapping is a warning that names the real ids',
    /WARN {2}category {7}"AI Music" is not a category, so the city read it as "audio-generation"/.test(json.report) &&
    /image-generation/.test(json.report));
  check('the log keeps what was sent beside what was placed',
    line?.category === 'audio-generation' && line?.category_sent === '"AI Music"', JSON.stringify(line?.category_sent));
}
{
  const { json } = await post(listing({ category: 'nope' }));
  check('a category nothing matches is placed as other, with the same warning',
    json.accepted === true && json.plot.category === 'other' && /WARN {2}category .*nothing closer matched/.test(json.report));
}
{
  const { json } = await post(listing({ category: 42 }));
  const c = json.result.identity.checks.find((x) => x.name === 'category');
  check('a category that is not text is still a rejection that lists the real ones',
    json.accepted === false && c.ok === false && /image-generation/.test(c.detail));
}
{
  const { json } = await post(listing());
  check('an exact category says nothing extra', !/WARN {2}category/.test(json.report) && json.result.category === undefined);
}
{
  // sent inside the plot AND at the top level: only the top-level one is
  // read, and neither reaches the published plot
  const orig = console.log;
  let line = null;
  console.log = (...a) => { if (String(a[0]).startsWith('SUBMIT ')) line = JSON.parse(String(a[0]).slice(7)); orig(...a); };
  const { json } = await post({ ...listing({ discovery_source: 'smuggled' }), discovery_source: 'api-check suite' });
  console.log = orig;
  check('discovery_source is logged, capped, and never published',
    line?.discovery_source === 'api-check suite' && line?.transport === 'template' && line?.category === 'code-assist' &&
    json.plot.discovery_source === undefined, JSON.stringify({ logged: line?.discovery_source, published: json.plot?.discovery_source }));
}
{
  // the picture path, with a fetcher the suite controls: one image goes on the
  // facade AND the wall inside; a non-image is skipped with a note
  const plot = { slug: SLUG, name: 'X', url: 'https://example.com', builder: 'x', category: 'agents', description: 'd',
    images: ['https://example.com/a.png', 'https://example.com/not-an-image'] };
  const built = await buildListing(plot, { fetchMeta: false, fetchImage: async (u) => (u.endsWith('.png') ? PNG : Buffer.from('<svg/>')) });
  check('a listing\'s own images go on the building', built.pictures === 1 && built.source === 'images' &&
    plot.media.pictures.map((p) => p.node).join(',') === 'pic_1,pic_2' && Object.keys(built.media)[0] === 'pic-1.png');
  check('a non-image url is skipped with a note, not an error', built.notes.length === 1 && /not a png/.test(built.notes[0]));
  check('images[] is consumed, not published', plot.images === undefined);
}
// --- the badge --------------------------------------------------------------
{
  const manifest = JSON.parse(readFileSync(join(root, 'public/plots/index.json')));
  const demo = manifest.lots.find((l) => l.slug === 'listing-demo');
  const b = await listen('localhost', (req, res) => badgeHandler(req, res));
  const get = async (file) => {
    const r = await fetch(`${b.origin}/api/badge${file === null ? '' : `?file=${encodeURIComponent(file)}`}`);
    return { status: r.status, type: r.headers.get('content-type'), cache: r.headers.get('cache-control'), body: await r.text() };
  };
  const live = await get(`${demo.slug}.svg`);
  check('a live listing\'s badge shows its address',
    live.status === 200 && /^image\/svg\+xml/.test(live.type) && live.body.includes(demo.address), live.type);
  check('the badge is cached briefly downstream, long at the CDN', /max-age=300/.test(live.cache) && /s-maxage/.test(live.cache));
  const unknown = await get('not-a-listing-yet.svg');
  check('an unknown slug is the generic badge, never an error',
    unknown.status === 200 && unknown.body.includes('AI directory') && !unknown.body.includes('Boulevard'));
  const odd = await get('../../etc/passwd');
  check('a malformed name is the generic badge too', odd.status === 200 && odd.body.includes('AI directory'));
  const bare = await get(null);
  check('/badge.svg is the generic badge', bare.status === 200 && bare.body.startsWith('<svg'));
  b.server.close();
  check('addressFor reads only the manifest', addressFor(demo.slug, manifest) === demo.address &&
    addressFor('Listing-Demo', manifest) === null);
  const svg = renderBadge('1 <Odd> & "Road"');
  check('whatever the address, it is text in the svg, never markup',
    svg.includes('&lt;Odd&gt; &amp; &quot;Road&quot;') && !svg.includes('<Odd>'));
  const free = freeSlug('not-taken-yet');
  check('a free slug hands over the badge before the dry run needs it',
    free.available === true && free.permalink === 'https://otra.city/s/not-taken-yet' &&
    free.badge.html.includes('href="https://otra.city/s/not-taken-yet"'));
  const sn = badgeSnippets('a-b-c');
  check('snippets carry only the slug, never a submitter\'s words',
    sn.markdown === '[![a-b-c on otra.city](https://otra.city/badge/a-b-c.svg)](https://otra.city/s/a-b-c)');
}
// --- the readable pages -------------------------------------------------------
{
  const manifest = JSON.parse(readFileSync(join(root, 'public/plots/index.json')));
  const plat = JSON.parse(readFileSync(join(root, 'public/city/lots.json')));
  const demo = manifest.lots.find((l) => l.slug === 'listing-demo');
  const html = renderLot(demo.lot, manifest, plat);
  check('a listing page carries a plain link to the site',
    html.includes(`<a href="${esc(demo.url)}">`) && html.includes('application/ld+json'), demo.url);
  check('the page names the address and the walk path',
    html.includes(demo.address) && html.includes(`/lot/${demo.lot}/walk`));
  check('the page offers the badge, ready to paste',
    html.includes(`src="/badge/${demo.slug}.svg"`) && html.includes(esc(badgeSnippets(demo.slug).markdown)));
  // what an attacker would send as a name: it must come out as text
  const hostile = { ...manifest, lots: manifest.lots.map((l) => (l.slug === 'listing-demo'
    ? { ...l, name: '<script>alert(1)</script>', description: '"><img src=x onerror=alert(1)>', url: 'javascript:alert(1)', tags: ['<b>'] } : l)) };
  const h2 = renderLot(demo.lot, hostile, plat);
  check('a hostile listing is text on the page, never markup',
    !h2.includes('<script>alert') && !h2.includes('<img src=x') && !h2.includes('href="javascript:') && h2.includes('&lt;script&gt;'));
  const vacant = manifest.vacant[0];
  const hv = renderLot(vacant.lot, manifest, plat);
  check('a vacant lot page says which categories land there and how',
    hv.includes(vacant.address) && /vacant/i.test(hv) && hv.includes('/api/plots/submit'));
  const road = manifest.roads.find((r) => r.id === demo.road);
  const hr = renderRoad(road.id, manifest, plat);
  check('a road page lists what stands on it', hr.includes(road.name) && hr.includes(`/lot/${demo.lot}`) && hr.includes('ItemList'));
  const hd = renderDirectory(manifest, plat);
  check('the directory lists every road with a listing and every category',
    hd.includes(`/road/${demo.road}`) && hd.includes('image-generation') === false /* labels, not ids */ && hd.includes('Image generation'));
  check('an unknown lot is nobody\'s page', renderLot('boulevard-999', manifest, plat) === null && renderRoad('nowhere', manifest, plat) === null);
  // a notice to quit (lib/inspector.mjs): on the lot page and the cards,
  // escaped like everything else, and absent when there is none
  check('every lot in the manifest says whether it has a notice', manifest.lots.every((l) => 'notice' in l));
  check('no notice, no banner', !html.includes('NOTICE TO QUIT'));
  const served = { ...manifest, lots: manifest.lots.map((l) => (l.slug === 'listing-demo'
    ? { ...l, notice: { posted: '2026-10-18T06:17:00.000Z', since: '2026-10-16T06:17:00.000Z', evict_on: '2026-11-01', reason: 'HTTP 404 <b>' } } : l)) };
  const hn = renderLot(demo.lot, served, plat);
  check('a lot on notice says so, with both dates', hn.includes('NOTICE TO QUIT') && hn.includes('has not answered since 16 Oct 2026') &&
    hn.includes('eviction on 1 Nov 2026 unless it comes back') && hn.includes('HTTP 404 &lt;b&gt;') && !hn.includes('404 <b>'));
  check('its card on the road says so too', renderRoad(demo.road, served, plat).includes('notice to quit'));
}
check('the tagline is cut at a word', deriveTagline('word '.repeat(30)).length <= 80 && !/\s…$/.test(deriveTagline('word '.repeat(30))));
check('a short description is the tagline as is', deriveTagline('Short and sweet.') === 'Short and sweet.');
check('og:image is read whatever the attribute order',
  parseSiteMeta('<meta content="/x.png" property="og:image">', 'https://a.com/p/').image === 'https://a.com/x.png');
check('twitter:image is the fallback', parseSiteMeta('<meta name="twitter:image" content="https://c.dn/t.jpg">', 'https://a.com').image === 'https://c.dn/t.jpg');
check('a picture is known by its bytes, not its name', imageKind(PNG) === 'png' && imageKind(Buffer.from('<svg/>')) === null);
{
  const plat = JSON.parse(readFileSync(join(root, 'public/city/lots.json')));
  check('the city may still ask for a lot', pickLot(plat, [], { category: 'agents', requested: 'boulevard-1', mayRequest: true }).why === 'requested');
  check('a listing\'s request is not honoured', pickLot(plat, [], { category: 'agents', requested: 'boulevard-1' }).why === 'category');
  check('a category with no road falls through, and says so', pickLot(plat, [], { category: 'nope' }).why === 'category-unrouted');
  // the high street keeps its lots for buildings somebody built
  const custom = Object.values(plat.roads).filter((r) => r.customOnly).map((r) => r.id);
  check('the boulevard takes custom builds only', custom.includes('boulevard'));
  const tpl = pickLot(plat, [], { category: 'other', template: true });
  check('a template listing never lands on a custom-only road', tpl && !custom.includes(plat.lots[tpl.id].road) && tpl.why === 'category');
  check('a custom build of the same category still may', plat.lots[pickLot(plat, [], { category: 'productivity' }).id].road === 'boulevard');
  const allBut = (keep) => Object.keys(plat.lots).filter((id) => !keep(plat.lots[id]));
  const full = pickLot(plat, allBut((l) => custom.includes(l.road) || l.road === 'west'), { category: 'other', template: true });
  check('...not even when its own district is full', full && plat.lots[full.id].road === 'west' && full.why === 'category-full');
}
{
  // growth: plan a road for a district that has run out, and prove nothing moved
  const map = JSON.parse(readFileSync(join(root, 'public/city/map.json')));
  const venues = JSON.parse(readFileSync(join(root, 'public/venues/index.json'))).venues || [];
  const base = platLots(map, venues);
  check('growth: today every district has room', needs(base, [], [], map).length === 0);
  const media = (l) => (map.roads.find((r) => r.id === l.road)?.categories || []).includes('image-generation');
  const held = Object.values(base.lots).filter(media).map((l) => l.id);
  const n = needs(base, held, [{ category: 'image-generation' }], map);
  check('growth: a district with no free lot needs a road', n.length === 1 && n[0].categories.includes('video-generation') && n[0].free === 0);
  const p = plan(map, n[0], { venues, plots: [{ category: 'image-generation' }] });
  check('growth: it finds one', !!p.best && p.best.gained.length >= 6, p.best ? `${p.best.roadId} +${p.best.gained.length}` : `${p.rejected.length} rejected`);
  const after = platLots(p.best.map, venues);
  check('growth: every lot the map afforded stands where it stood',
    Object.values(base.lots).every((l) => after.lots[l.id] && after.lots[l.id].x === l.x && after.lots[l.id].z === l.z && after.lots[l.id].yaw === l.yaw));
  check('growth: the new road serves the district', (p.best.map.roads.find((r) => r.id === p.best.roadId)?.categories || []).join() === n[0].categories.join()
    || p.best.kind === 'extend');
  const again = plan(map, n[0], { venues, plots: [{ category: 'image-generation' }] });
  check('growth: the same map gets the same answer', again.best.roadId === p.best.roadId && again.best.L === p.best.L && again.best.from_m === p.best.from_m);
  check('growth: a template listing of the district now lands on it',
    after.lots[pickLot(after, held, { category: 'image-generation', template: true }).id].road === p.best.roadId);
  const d = districts(base, [], [], map);
  check('growth: no district counts a custom-only road as room', d.every((g) => !g.roads.some((r) => base.roads[r].customOnly)));
}
// --- first contact: what an agent sees before it posts ---------------------
// 86 of the 93 GETs on this endpoint (Sep–Nov 2026) never posted. A GET is
// the contract now, and an agent in a browser on another origin gets past
// its preflight.
{
  const r = await fetch(`${api.origin}/api/plots/submit`);
  const c = await r.json();
  check('GET answers with the contract, not a 405', r.status === 200 && c.submit?.method === 'POST' &&
    c.submit.url === 'https://otra.city/api/plots/submit');
  check('the contract\'s category ids are the ones the checks use',
    JSON.stringify(c.body?.plot?.optional?.category) === JSON.stringify(CATEGORY_IDS));
  check('the contract names the backlink rule up front', /otra\.city\/s\/<slug>/.test(c.steps?.[0] || ''));
  check('the contract points at the OpenAPI file and the guide',
    c.links?.openapi === 'https://otra.city/openapi.json' && /service-desc/.test(r.headers.get('link') || ''));
  // the example is a body an agent will copy, so it must clear identity as written
  const { json } = await post({ ...c.example, plot: { ...c.example.plot, slug: SLUG } });
  check('the contract\'s example body passes the identity checks as written', json.result?.identity?.ok === true,
    (json.report || '').split('\n').filter((l) => /^FAIL {2}(slug|name|url|builder|category|tagline|description)/.test(l)).join(' | '));
}
{
  const r = await fetch(`${api.origin}/api/plots/submit`, { method: 'HEAD' });
  check('HEAD answers 200 with no body', r.status === 200 && (await r.text()) === '');
}
{
  const orig = console.log;
  let line = null;
  console.log = (...a) => { if (String(a[0]).startsWith('SUBMIT ')) line = JSON.parse(String(a[0]).slice(7)); orig(...a); };
  const r = await fetch(`${api.origin}/api/plots/submit`, { method: 'OPTIONS',
    headers: { origin: 'https://agent.example', 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' } });
  console.log = orig;
  check('a CORS preflight is answered, for any origin',
    r.status === 204 && r.headers.get('access-control-allow-origin') === '*' &&
    /POST/.test(r.headers.get('access-control-allow-methods') || '') &&
    /content-type/i.test(r.headers.get('access-control-allow-headers') || ''));
  check('a preflight is logged as one, not as a wrong method', line?.outcome === 'preflight');
}
{
  const r = await fetch(`${api.origin}/api/plots/submit`, { method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://agent.example' }, body: JSON.stringify(listing()) });
  check('a POST from another origin is readable by its page', r.headers.get('access-control-allow-origin') === '*');
}
{
  const r = await fetch(`${api.origin}/api/plots/submit`, { method: 'PUT' });
  check('any other method is a 405 that says what is allowed', r.status === 405 && /POST/.test(r.headers.get('allow') || ''));
}
{
  const o = JSON.parse(readFileSync(join(root, 'public/openapi.json')));
  const L = o.components?.schemas?.Listing;
  check('openapi.json lists the categories the checks use', JSON.stringify(L?.properties?.category?.enum) === JSON.stringify(CATEGORY_IDS));
  check('openapi.json requires what the validator requires',
    JSON.stringify(L?.required) === JSON.stringify(['slug', 'name', 'url', 'builder']));
  check('openapi.json has the submit operation agents import', o.paths?.['/api/plots/submit']?.post?.operationId === 'submitListing');
  check('openapi.json and the contract agree on the example',
    JSON.stringify(o.paths['/api/plots/submit'].post.requestBody.content['application/json'].example.plot) ===
      JSON.stringify(submissionContract().example.plot));
}

// --- pending listings: held for the backlink ---------------------------------
// The agent that submits can usually not edit the site it submits. A listing
// that fails ONLY the backlink is held and published when the permalink
// appears (lib/pending.mjs). What must stay true: nothing is published until
// the page proves control, a dry run holds nothing, a custom build is never
// held, and with no store the answer is the rejection it always was.
{
  const PSLUG = 'api-check-pending';
  const page = join(pages, 'pending.html');
  writeFileSync(page, '<!doctype html><p>no permalink yet</p>');
  const held = (over = {}, top = {}) => {
    const b = listing({ slug: PSLUG, url: `${site.origin}/pending.html`, ...over });
    delete b.dry;
    return { ...b, discovery_source: 'api-check', ...top };
  };

  const none = await post(held());
  check('with no store, a missing backlink is the rejection it always was',
    none.status === 422 && none.json.pending === false && /VERDICT: REJECTED/.test(none.json.report));

  const dir = mkdtempSync(join(tmpdir(), 'otra-pending-'));
  process.env.PENDING_DIR = dir;
  const files = () => readdirSync(dir);
  const logged = async (fn) => {
    const orig = console.log;
    let line = null;
    console.log = (...a) => { if (String(a[0]).startsWith('SUBMIT ')) line = JSON.parse(String(a[0]).slice(7)); };
    try { return { r: await fn(), line }; } finally { console.log = orig; }
  };

  const dry = await post(held({}, { dry: true }));
  check('a dry run says it would be held, and holds nothing',
    dry.status === 202 && dry.json.pending === true && dry.json.pending_listing === null && files().length === 0 &&
    /VERDICT: PENDING/.test(dry.json.report) && /without "dry"/.test(dry.json.report), `${dry.status} ${files().length} file(s)`);

  const { r: first, line } = await logged(() => post(held()));
  const pl = first.json.pending_listing;
  check('a listing that fails only the backlink is held, not rejected',
    first.status === 202 && first.json.accepted === false && first.json.pending === true && files().length === 1,
    (first.json.report || first.json.error || '').split('\n').filter((l) => l.startsWith('FAIL')).join(' | '));
  check('the answer says what it is waiting for, and until when',
    pl?.waiting_for?.text === `otra.city/s/${PSLUG}` && pl.waiting_for.url === `${site.origin}/pending.html` &&
    Math.round((Date.parse(pl.expires) - Date.parse(pl.since)) / 864e5) === PENDING_DAYS && /HELD until/.test(first.json.report));
  check('the note is written for whoever can edit the site', /whoever can edit/.test(pl?.note || '') && !!first.json.badge?.html);
  check('nothing is published by holding it', first.json.pr_url === null && /FAIL {2}backlink/.test(first.json.report));
  check('a held attempt is logged as pending, with what failed', line?.outcome === 'pending' && line.failed.join() === 'backlink');
  const store = pendingStore();
  const claim = await readClaim(store, PSLUG);
  check('what is held is the listing as it was sent — nothing the city derived',
    claim?.body?.plot?.slug === PSLUG && !('template' in claim.body.plot) && !('tagline' in claim.body.plot) &&
    claim.body.discovery_source === 'api-check' && !('dry' in claim.body));

  const again = await post(held({ name: 'API CHECK 2' }));
  check('a resubmission replaces what is held and never extends it',
    again.json.pending_listing?.since === pl.since && again.json.pending_listing.expires === pl.expires &&
    files().length === 1 && (await readClaim(store, PSLUG)).body.plot.name === 'API CHECK 2');

  const custom = await post({ ...bundle({ slug: PSLUG, url: `${site.origin}/pending.html` }), dry: undefined });
  check('a custom build is never held: that would mean keeping the bundle',
    custom.status === 422 && custom.json.pending === false && files().length === 1);

  const other = await fileClaim(store, { slug: PSLUG, owner: 'somebody-else.example', url: 'https://somebody-else.example', body: {} });
  check('a second site cannot queue behind an unverified claim on the same slug', other.ok === false && other.why === 'other-owner');
  for (let i = 0; i < PENDING_PER_OWNER; i++) {
    await fileClaim(store, { slug: `cap-${i}-x`, owner: 'greedy.example', url: 'https://greedy.example', body: {} });
  }
  const capped = await fileClaim(store, { slug: 'cap-one-more', owner: 'greedy.example', url: 'https://greedy.example', body: {} });
  check('one site holds a few claims at most', capped.ok === false && capped.why === 'owner-cap');

  const status = heldSlug(PSLUG, await readClaim(store, PSLUG));
  check('the status answer for a held slug reads like the in-flight one',
    status.pending === true && status.stage === 'awaiting-backlink' && status.exists === false &&
    status.waiting_for.text === `otra.city/s/${PSLUG}` && !('body' in status) && /reserves nothing/.test(status.note));

  // the sweep, through the endpoint: the real backlink check and the real
  // submit handler, in-process
  const p = await listen('localhost', (req, res) => pendingHandler(req, res));
  const poke = async (q = '') => (await fetch(`${p.origin}/api/pending${q}`, { method: 'POST' })).json();
  const count = await (await fetch(`${p.origin}/api/pending`)).json();
  check('GET /api/pending counts what is waiting and reads nothing', count.pending === files().length && /held/.test(count.what));
  const tooSoon = await poke(`?slug=${PSLUG}`);
  check('a page just read is not read again', tooSoon.pending === 1 && tooSoon.checked === 0 && tooSoon.skipped === 1);
  const rewind = async (slug, patch = {}) => {
    const f = join(dir, files().find((n) => n.startsWith(`${slug}~`)));
    writeFileSync(f, JSON.stringify({ ...JSON.parse(readFileSync(f, 'utf8')), last_checked: new Date(Date.now() - 36e5).toISOString(), ...patch }));
  };
  await rewind(PSLUG);
  const still = await poke(`?slug=${PSLUG}`);
  check('a page still without the permalink stays waiting', still.checked === 1 && still.waiting === 1 && still.published.length === 0);
  writeFileSync(page, `<!doctype html><p>listed at otra.city/s/${PSLUG}</p>`);
  await rewind(PSLUG);
  const { r: ready, line: pub } = await logged(() => poke(`?slug=${PSLUG}`));
  // no bot token here, so the handler accepts and has nowhere to publish to —
  // which is the proof it went through the real handler and passed every check
  check('once the permalink is on the page the held listing passes the real endpoint',
    ready.checked === 1 && ready.unpublishable.join() === PSLUG && pub?.outcome === 'accepted-dry' &&
    pub.caller['user-agent'] === 'otra-city-pending/1.0' && pub.discovery_source === 'api-check',
    JSON.stringify(ready).slice(0, 160));
  p.server.close();

  // the three ways out, with the publisher stubbed
  const yes = { recheck: async () => ({ ok: true, detail: 'found' }), now: Date.now() + 36e5 };
  const published = await sweep(store, { ...yes, slug: PSLUG, publish: async () => ({ status: 200, json: { accepted: true, pr_url: 'https://github.com/x/y/pull/1' } }) });
  check('a published claim is gone', published.published.join() === PSLUG && (await readClaim(store, PSLUG)) === null);
  let tried = 0;
  const refuse = async () => { tried++; return { status: 422, json: { accepted: false, pending: false, report: 'PASS  slug\nFAIL  ownership      slug belongs to somebody else\nVERDICT: REJECTED' } }; };
  const stalled = await sweep(store, { ...yes, slug: 'cap-0-x', publish: refuse });
  const after = await sweep(store, { ...yes, now: yes.now + 36e5, slug: 'cap-0-x', publish: refuse });
  const st = await readClaim(store, 'cap-0-x');
  check('a claim that is ready and then fails to publish stalls, says why, and is not retried',
    stalled.stalled.join() === 'cap-0-x' && /ownership/.test(st.stalled.failed[0]) && tried === 1 && after.checked === 0 &&
    heldSlug('cap-0-x', st).stage === 'stalled');
  const late = await sweep(store, { recheck: async () => ({ ok: false }), publish: refuse, now: Date.now() + (PENDING_DAYS + 1) * 864e5 });
  check('a claim nobody completes is deleted when it expires', late.expired.length === PENDING_PER_OWNER && files().length === 0, `${files().length} left`);

  // the page and the endpoint must describe what the code holds
  const claimPage = readFileSync(join(root, 'public/claim.html'), 'utf8');
  check('/claim#safety says what a held listing stores', new RegExp(`${PENDING_DAYS} days`).test(claimPage) && /pending/i.test(claimPage));
  check('the contract tells an agent that cannot edit the site what to do',
    submissionContract().steps.some((x) => /Cannot edit that page/.test(x)) && /pending/.test(submissionContract().responses[202]));
  const o = JSON.parse(readFileSync(join(root, 'public/openapi.json')));
  check('openapi.json has the 202 a held listing answers with',
    !!o.paths?.['/api/plots/submit']?.post?.responses?.['202'] && !!o.paths?.['/api/pending']?.post);
  delete process.env.PENDING_DIR;
}

// --- the log drain ---------------------------------------------------------
// Everything here except the Blob write itself, which needs a real store and a
// real token and so is verified by hand against the store, not in CI.
{
  const BATCH = [
    { id: '1', timestamp: 1756900000000, path: '/api/plots', statusCode: 200, message: 'GET /api/plots' },
    { id: '2', timestamp: 1756900001000, path: '/api/plots/submit', statusCode: 422, requestId: 'req-a',
      message: 'SUBMIT {"outcome":"rejected","slug":"x","failed":["backlink"]}' },
    { id: '3', timestamp: 1756900002000, path: '/api/plots/submit', statusCode: 413, requestId: 'req-b',
      message: 'Request Entity Too Large' },
  ];
  const picked = selectRecords(BATCH);
  check('the drain drops everything it was not asked to keep', picked.length === 2, `kept ${picked.length}/3`);
  check('a telemetry line is kept as structured data',
    picked[0].kind === 'attempt' && picked[0].failed[0] === 'backlink' && picked[0].request.request_id === 'req-a');
  check('an attempt the code never saw is kept too',
    picked[1].kind === 'platform' && picked[1].request.status === 413,
    'the 4.5 MB body the platform rejects before the function runs');
  check('ndjson and json arrays both parse',
    parseBatch(BATCH.map((e) => JSON.stringify(e)).join('\n')).length === 3 &&
    parseBatch(JSON.stringify(BATCH)).length === 3);
  check('one unreadable line does not lose the batch',
    parseBatch('{"a":1}\nnot json\n{"b":2}').length === 2);

  process.env.LOG_DRAIN_VERIFY = 'verify-token-abc';
  process.env.LOG_DRAIN_SECRET = 'shhh';
  const d = await listen('localhost', (req, res) => drain(req, res));
  const post = (body, headers) => fetch(`${d.origin}/api/log-drain`,
    { method: 'POST', headers: { 'content-type': 'application/x-ndjson', ...headers }, body });

  const v = await fetch(`${d.origin}/api/log-drain`);
  check('every response carries the value Vercel verifies against',
    v.headers.get('x-vercel-verify') === 'verify-token-abc' && v.status === 200);
  const badKey = await post('{}', { 'x-otra-drain-key': 'nope' });
  check('a wrong key is refused', badKey.status === 403);
  check('even a refusal carries the verify header',
    badKey.headers.get('x-vercel-verify') === 'verify-token-abc');
  check('an unsigned, unkeyed post is refused', (await post('{}')).status === 403);
  const empty = await post(JSON.stringify([BATCH[0]]), { 'x-otra-drain-key': 'shhh' });
  check('a batch with nothing to keep writes nothing',
    empty.status === 200 && (await empty.text()).trim() === '0');

  // The bootstrap window. Vercel will not create a drain until the endpoint
  // answers its test POST with a 2xx, and does not reveal the secret until the
  // drain exists — so demanding the secret first deadlocks setup. It must
  // answer 2xx, and it must still store nothing.
  delete process.env.LOG_DRAIN_SECRET;
  const boot = await post(BATCH.map((e) => JSON.stringify(e)).join('\n'));
  const bootBody = await boot.text();
  check('an unconfigured endpoint answers 2xx so the drain can be created',
    boot.status === 200, "Vercel's Test button demands it");
  check('...and discards every record rather than storing them',
    /discarded 2 record\(s\)/.test(bootBody) && /LOG_DRAIN_SECRET/.test(bootBody),
    'never an open write path, in either state');
  process.env.LOG_DRAIN_SECRET = 'shhh';
  d.server.close();
}

// The setup script is the only way anyone turns the drain on, and CI cannot
// exercise it without a Vercel account — but it can refuse to ship one that
// will not parse.
{
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync('bash', ['-n', join(root, 'scripts/setup-log-drain.sh')], { encoding: 'utf8' });
  check('the log-drain setup script parses', r.status === 0, (r.stderr || '').trim().split('\n')[0] || '');
}

for (const s of [away.server, site.server, api.server]) s.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nall api checks passed');
process.exit(failed ? 1 : 0);
