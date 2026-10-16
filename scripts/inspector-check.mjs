// The inspector, driven end to end against a fixture server on loopback and a
// scratch copy of the street — never the real one, never the network beyond a
// guaranteed-nonexistent .invalid name.
//
//   1. the knock: every answer the policy names, sorted into dead /
//      inconclusive / healthy
//   2. the state machine: transitions and both clocks (48 h, 14 days), with
//      `now` injected
//   3. a round of the whole street, day by day: failing, the quiet day that
//      writes nothing, the notice in the manifest, recovery, and the eviction
//      — and every file an eviction touches
//   4. the circuit breaker and the eviction cap, by replayed knocks
//
// Usage: npm run inspector:check
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { knock, advance, inspect, CLOCK, NOTICES_COMMENT } from '../lib/inspector.mjs';
import { findPoster } from '../lib/poster-paths.mjs';

const root = new URL('..', import.meta.url).pathname;
let failed = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `\n      ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
};

// --- the fixture: one server, every answer ----------------------------------
let flip = 200;   // a site that goes down and comes back
const server = createServer((req, res) => {
  const path = req.url.split('?')[0];
  const send = (status, body = 'hello', headers = {}) => { res.writeHead(status, { 'content-type': 'text/html', ...headers }); res.end(body); };
  if (path === '/ok') return send(200);
  if (path === '/flip') return send(flip);
  if (path === '/gone') return send(404, 'not found');
  if (path === '/410') return send(410);
  if (path === '/boom') return send(500);
  if (path === '/teapot') return send(418);
  if (path === '/locked') return send(403, 'forbidden');
  if (path === '/busy') return send(429);
  if (path === '/auth') return send(401);
  if (path === '/cf') return send(503, '<html>wait</html>', { 'cf-mitigated': 'challenge' });
  if (path === '/jam') return send(403, '<title>Just a moment...</title>');
  if (path === '/jam503') return send(503, '<script src="/cdn-cgi/challenge-platform/h/b/orchestrate"></script>');
  if (path === '/hop') return send(301, '', { location: '/ok' });
  if (path === '/hop-gone') return send(302, '', { location: '/gone' });
  if (path === '/away') return send(302, '', { location: `http://localhost:${port}/ok` });   // another domain
  if (path === '/loop') return send(302, '', { location: '/loop' });
  if (path === '/slow') return;                                                              // never answers
  return send(404);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const at = (p) => `http://127.0.0.1:${port}${p}`;
const closed = createServer();
await new Promise((r) => closed.listen(0, '127.0.0.1', r));
const closedPort = closed.address().port;
await new Promise((r) => closed.close(r));
const K = { allowLocal: true, timeoutMs: 800 };

// --- 1. the knock -------------------------------------------------------------
{
  const v = async (path, opts = K) => (await knock(path.startsWith('http') ? path : at(path), opts));
  const expect = async (label, path, verdict, re = null, opts = K) => {
    const r = await v(path, opts);
    check(`${label} -> ${verdict}`, r.verdict === verdict && (!re || re.test(r.reason)), r);
  };
  await expect('200', '/ok', 'healthy');
  await expect('418 (anything else)', '/teapot', 'healthy');
  await expect('a redirect within the site', '/hop', 'healthy');
  await expect('404', '/gone', 'dead', /404/);
  await expect('a redirect to a 404', '/hop-gone', 'dead', /404/);
  await expect('410', '/410', 'dead', /410/);
  await expect('500', '/boom', 'dead', /500/);
  await expect('a redirect to another registrable domain', '/away', 'dead', /moved away: ends up on localhost/);
  await expect('timeout', '/slow', 'dead', /no answer/, { ...K, timeoutMs: 300 });
  await expect('connection refused', `http://127.0.0.1:${closedPort}/`, 'dead', /refused/);
  await expect('DNS failure', 'http://no-such-shop.invalid/', 'dead', /DNS/);
  await expect('TLS error (https to a plain-http port)', `https://127.0.0.1:${port}/`, 'dead', /TLS/);
  await expect('401', '/auth', 'inconclusive');
  await expect('403', '/locked', 'inconclusive');
  await expect('429', '/busy', 'inconclusive');
  await expect('a Cloudflare 503 challenge (cf-mitigated)', '/cf', 'inconclusive', /challenge/);
  await expect('a "Just a moment..." page', '/jam', 'inconclusive', /challenge/);
  await expect('a 503 carrying the challenge platform', '/jam503', 'inconclusive', /challenge/);
  await expect('more than 5 redirects', '/loop', 'inconclusive', /redirects/);
  await expect('the street guard: a private address is never dialled', '/ok', 'dead', /not a public one/, { timeoutMs: 800 });
}

// --- 2. the state machine -------------------------------------------------------
{
  const T0 = Date.parse('2026-10-16T06:17:00Z');
  const h = (n) => T0 + n * 3600e3;
  const plot = { slug: 'x', name: 'X', url: 'https://x.example/', lot: 'east-9' };
  const D = { verdict: 'dead', reason: 'HTTP 404' };
  const OK = { verdict: 'healthy', reason: 'HTTP 200' };
  const MAYBE = { verdict: 'inconclusive', reason: 'HTTP 403' };
  const a = advance(null, D, T0, plot);
  check('healthy + dead -> failing, failing_since recorded', a.change === 'failing' && a.entry.state === 'failing' &&
    a.entry.failing_since === new Date(T0).toISOString() && a.entry.lot === 'east-9', a);
  check('healthy + inconclusive -> nothing', advance(null, MAYBE, T0, plot).change === null && advance(null, MAYBE, T0, plot).entry === null);
  check('healthy + healthy -> nothing', advance(null, OK, T0, plot).change === null);
  check('failing + dead at 47 h 59 m -> still failing', advance(a.entry, D, h(48) - 60e3, plot).change === null);
  check('failing + inconclusive past 48 h -> still failing (never counts)', advance(a.entry, MAYBE, h(72), plot).change === null);
  const n = advance(a.entry, D, h(48), plot);
  check('failing + dead at 48 h -> notice', n.change === 'notice' && n.entry.state === 'notice' &&
    n.entry.noticed === new Date(h(48)).toISOString(), n);
  check('evict_on = the notice date + 14 days', n.entry.evict_on === '2026-11-01' && CLOCK.graceDays === 14, n.entry.evict_on);
  check('failing + healthy -> cleared', advance(a.entry, OK, h(30), plot).change === 'cleared' && advance(a.entry, OK, h(30), plot).entry === null);
  check('notice + dead the day before evict_on -> still on notice',
    advance(n.entry, D, Date.parse('2026-10-31T23:59:00Z'), plot).change === null);
  check('notice + inconclusive on evict_on -> not evicted', advance(n.entry, MAYBE, Date.parse('2026-11-01T06:17:00Z'), plot).change === null);
  const e = advance(n.entry, D, Date.parse('2026-11-01T06:10:00Z'), plot);
  check('notice + dead on evict_on (even minutes early in the day) -> evict', e.change === 'evict', e);
  check('notice + dead after evict_on -> evict', advance(n.entry, D, Date.parse('2026-11-04T06:17:00Z'), plot).change === 'evict');
  check('notice + healthy -> cleared at once', advance(n.entry, OK, Date.parse('2026-10-31T06:17:00Z'), plot).change === 'cleared');
}

// --- a scratch street ---------------------------------------------------------
// The real registry, plat and plots — plot.json only, an empty plot.glb, empty
// posters with the real names — with every third-party url pointed at the
// fixture. build-manifest.mjs runs against it through OTRA_PUBLIC_DIR.
function scratchStreet(urls) {
  const pub = mkdtempSync(join(tmpdir(), 'otra-inspector-'));
  mkdirSync(join(pub, 'plots'));
  mkdirSync(join(pub, 'city'));
  mkdirSync(join(pub, 'posters'));
  copyFileSync(join(root, 'public/city/lots.json'), join(pub, 'city/lots.json'));
  copyFileSync(join(root, 'public/plots/lots.json'), join(pub, 'plots/lots.json'));
  copyFileSync(join(root, 'public/sitemap.xml'), join(pub, 'sitemap.xml'));
  for (const f of readdirSync(join(root, 'public/posters'))) if (f.endsWith('.webp')) writeFileSync(join(pub, 'posters', f), '');
  for (const slug of readdirSync(join(root, 'public/plots'))) {
    const src = join(root, 'public/plots', slug, 'plot.json');
    if (!existsSync(src)) continue;
    const plot = JSON.parse(readFileSync(src, 'utf8'));
    mkdirSync(join(pub, 'plots', slug, 'media'), { recursive: true });
    if (!/^https:\/\/otra\.city\//.test(plot.url)) plot.url = urls[slug] || at('/ok');
    writeFileSync(join(pub, 'plots', slug, 'plot.json'), JSON.stringify(plot, null, 2));
    writeFileSync(join(pub, 'plots', slug, 'plot.glb'), '');
    writeFileSync(join(pub, 'plots', slug, 'media', 'pic-1.png'), '');
  }
  return pub;
}
const J = (pub, p) => JSON.parse(readFileSync(join(pub, p), 'utf8'));
const lotOf = (pub, slug) => J(pub, 'plots/index.json').lots.find((l) => l.slug === slug);
const day = (n) => Date.parse('2026-10-16T06:17:00Z') + n * 86400e3;

// --- 3. a round of the street, day by day ------------------------------------
{
  const pub = scratchStreet({ promptops: at('/gone'), shellwire: at('/flip'), photogenerai: at('/locked') });
  const run = (n) => inspect({ pub, now: day(n), knockOpts: K });
  const lotsBefore = J(pub, 'plots/lots.json');
  const opsLot = lotsBefore.lots.promptops;

  flip = 500;
  let r = await run(0);
  check('first-party plots are never knocked on', !r.rows.some((x) => /^(city-hall|archive-9|mews-1|listing-demo)$/.test(x.slug)) &&
    r.rows.length === 10, r.rows.map((x) => x.slug));
  check('day 0: two dead -> failing, the 403 counts for nothing', J(pub, 'plots/notices.json').plots.promptops?.state === 'failing' &&
    J(pub, 'plots/notices.json').plots.shellwire?.state === 'failing' && !J(pub, 'plots/notices.json').plots.photogenerai, J(pub, 'plots/notices.json'));
  check('day 0: a transition writes', r.wrote === true);
  check('failing is not published on the manifest (notice: null)', lotOf(pub, 'promptops').notice === null);

  const quiet = readFileSync(join(pub, 'plots/notices.json'), 'utf8');
  const quietIndex = readFileSync(join(pub, 'plots/index.json'), 'utf8');
  r = await run(1);
  check('day 1: still dead, inside 48 h -> nothing written (no commit, no redeploy)', r.wrote === false &&
    readFileSync(join(pub, 'plots/notices.json'), 'utf8') === quiet && readFileSync(join(pub, 'plots/index.json'), 'utf8') === quietIndex);

  flip = 200;
  r = await run(2);
  const notices = J(pub, 'plots/notices.json').plots;
  check('day 2: dead 48 h on -> NOTICE TO QUIT, evict_on 14 days on', notices.promptops?.state === 'notice' &&
    notices.promptops.evict_on === '2026-11-01', notices.promptops);
  check('day 2: the one that came back is cleared', !notices.shellwire && r.changes.some((c) => c.slug === 'shellwire' && c.change === 'cleared'));
  const n = lotOf(pub, 'promptops').notice;
  check('the manifest carries the notice', n && n.evict_on === '2026-11-01' && n.since === '2026-10-16T06:17:00.000Z' && /404/.test(n.reason), n);
  check('every other lot carries notice: null', J(pub, 'plots/index.json').lots.filter((l) => l.slug !== 'promptops').every((l) => l.notice === null));

  r = await run(15);
  check('day 15: the day before evict_on -> still standing', existsSync(join(pub, 'plots/promptops/plot.json')) && r.evicted.length === 0);

  const poster = findPoster('promptops', readdirSync(join(pub, 'posters')));
  r = await run(16);
  check('day 16: still dead on evict_on -> evicted', r.evicted.length === 1 && r.evicted[0].slug === 'promptops', r.evicted);
  check('eviction removes the plot directory', !existsSync(join(pub, 'plots/promptops')));
  check('eviction removes its poster', poster && !existsSync(join(pub, 'posters', poster)), poster);
  check('...and no other plot\'s poster', readdirSync(join(pub, 'posters')).length === readdirSync(join(root, 'public/posters')).filter((f) => f.endsWith('.webp')).length - 1);
  const reg = J(pub, 'plots/lots.json');
  check('the land registry lets the lot go (lots and placed)', !('promptops' in reg.lots) && !(opsLot in reg.placed) &&
    Object.keys(reg.lots).length === Object.keys(lotsBefore.lots).length - 1, opsLot);
  const idx = J(pub, 'plots/index.json');
  check('the manifest drops it and the lot is back on the market', !idx.lots.some((l) => l.slug === 'promptops') &&
    idx.vacant.some((v) => v.lot === opsLot));
  check('the sitemap drops the lot page', !readFileSync(join(pub, 'sitemap.xml'), 'utf8').includes(`/lot/${opsLot}<`));
  check('notices.json forgets it', !('promptops' in J(pub, 'plots/notices.json').plots) && J(pub, 'plots/notices.json').comment === NOTICES_COMMENT);
  const rec = J(pub, 'plots/evictions.json').evictions;
  check('the public record has the eviction, every field', rec.length === 1 && rec[0].slug === 'promptops' && rec[0].name === 'PromptOps' &&
    rec[0].url === at('/gone') && rec[0].lot === opsLot && rec[0].failing_since === '2026-10-16T06:17:00.000Z' &&
    /^2026-10-18/.test(rec[0].noticed) && /^2026-11-01/.test(rec[0].evicted) && /404/.test(rec[0].reason), rec[0]);
  check('every other plot is untouched', readdirSync(join(pub, 'plots')).filter((s) => existsSync(join(pub, 'plots', s, 'plot.json'))).length ===
    readdirSync(join(root, 'public/plots')).filter((s) => existsSync(join(root, 'public/plots', s, 'plot.json'))).length - 1);
  const mc = spawnSync(process.execPath, [join(root, 'scripts/build-manifest.mjs')], { env: { ...process.env, OTRA_PUBLIC_DIR: pub }, encoding: 'utf8' });
  check('the manifest builder accepts the street the eviction left', mc.status === 0, mc.stderr);
  rmSync(pub, { recursive: true, force: true });
}

// --- 4. the breakers, by replayed knocks ---------------------------------------
{
  const pub = scratchStreet({});
  const street = (await inspect({ pub, dry: true, checks: {} })).rows.map((r) => r.slug);
  const D = { verdict: 'dead', reason: 'HTTP 404' };
  const OK = { verdict: 'healthy', reason: 'HTTP 200' };
  const snapshot = () => ['plots/notices.json', 'plots/index.json', 'plots/lots.json']
    .map((p) => (existsSync(join(pub, p)) ? readFileSync(join(pub, p), 'utf8') : '')).join('\n');

  const before = snapshot();
  const four = Object.fromEntries(street.map((s, i) => [s, i < 4 ? D : OK]));
  const t = await inspect({ pub, now: day(0), checks: four });
  check('more than 30% dead in one run -> the breaker trips', t.tripped === true && t.deadCount === 4 && t.checked === 10, t);
  check('...and nothing is recorded', snapshot() === before);
  const three = Object.fromEntries(street.map((s, i) => [s, i < 3 ? D : OK]));
  check('exactly 30% is not more than 30%', (await inspect({ pub, now: day(0), checks: three, dry: true })).tripped === false);
  const knocksFile = join(pub, 'knocks.json');
  writeFileSync(knocksFile, JSON.stringify(four));
  const cli = spawnSync(process.execPath, [join(root, 'scripts/inspector.mjs'), '--public', pub, '--checks', knocksFile], { encoding: 'utf8' });
  check('the command line exits non-zero when the breaker trips (the workflow shows red)', cli.status === 1 && /CIRCUIT BREAKER/.test(cli.stderr), cli.stdout + cli.stderr);

  // five plots whose notices have all run out, on one day: three go, two wait
  const due = street.slice(0, 5);
  writeFileSync(join(pub, 'plots/notices.json'), JSON.stringify({ comment: NOTICES_COMMENT, plots: Object.fromEntries(due.map((s, i) => [s, {
    state: 'notice', name: s, url: J(pub, `plots/${s}/plot.json`).url, lot: J(pub, 'plots/lots.json').lots[s],
    failing_since: '2026-10-01T06:17:00.000Z', reason: 'HTTP 404', noticed: '2026-10-03T06:17:00.000Z', evict_on: `2026-10-${17 - (i % 2)}`,
  }])) }, null, 2));
  // they are dead, the other five healthy: 50% would trip the breaker, so
  // widen it for this case — the cap is what is under test
  const cap = await inspect({ pub, now: day(1), checks: Object.fromEntries(street.map((s) => [s, due.includes(s) ? D : OK])), deadShare: 1 });
  check('never more than 3 evictions in one run', cap.evicted.length === 3 && cap.held.length === 2, { evicted: cap.evicted.map((e) => e.slug), held: cap.held });
  check('the longest-overdue go first', cap.evicted.every((e) => J(pub, 'plots/notices.json').plots[e.slug] === undefined) &&
    cap.held.every((s) => J(pub, 'plots/notices.json').plots[s]?.state === 'notice'));
  const firstDay = due.filter((s, i) => i % 2 === 1);   // evict_on the 16th — two of them, both evicted
  check('...by evict_on, earliest first', firstDay.every((s) => cap.evicted.some((e) => e.slug === s)), firstDay);
  const next = await inspect({ pub, now: day(2), checks: Object.fromEntries(street.map((s) => [s, due.includes(s) ? D : OK])), deadShare: 1 });
  check('the held-over notices are evicted on the next run', next.evicted.length === 2 && J(pub, 'plots/evictions.json').evictions.length === 5);
  rmSync(pub, { recursive: true, force: true });
}

// --- 5. a resubmission under a new url starts over ---------------------------
{
  const plot = { slug: 'x', name: 'X', url: 'https://x.example/new', lot: 'east-9' };
  const pub = scratchStreet({ promptops: at('/ok') });
  writeFileSync(join(pub, 'plots/notices.json'), JSON.stringify({ comment: NOTICES_COMMENT, plots: { promptops: {
    state: 'notice', name: 'PromptOps', url: 'https://old.example/', lot: 'east-3', failing_since: '2026-10-01T06:17:00.000Z',
    reason: 'HTTP 404', noticed: '2026-10-03T06:17:00.000Z', evict_on: '2026-10-17' } } }));
  const r = await inspect({ pub, now: day(5), checks: { promptops: { verdict: 'dead', reason: 'HTTP 404' } } });
  const e = J(pub, 'plots/notices.json').plots.promptops;
  check('a plot resubmitted under a different url starts over at failing, not eviction', r.evicted.length === 0 && e?.state === 'failing' &&
    e.url === at('/ok'), { e, plot });
  rmSync(pub, { recursive: true, force: true });
}

server.close();
if (failed) { console.error(`\n${failed} inspector check(s) failed`); process.exit(1); }
console.log('\ninspector ok');
