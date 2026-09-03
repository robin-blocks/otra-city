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
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import handler from '../api/submit.mjs';
import drain, { selectRecords, parseBatch } from '../api/log-drain.mjs';
import { apexHost, sameSite, ownerKey, classifyUrl } from '../lib/submitter-host.mjs';

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
}
{
  const { json } = await post(bundle({ url: `${site.origin}/bare.html` }));
  check('no permalink on the page is a rejection', json.accepted === false && json.result.backlink.ok === false);
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
{
  const { status, json } = await post({ plot: { slug: SLUG }, dry: true });
  check('a bundle with no build is an error, not a crash', status === 400 && /glb_base64|glb_url/.test(json.error));
}
{
  const r = await fetch(`${api.origin}/api/plots/submit`);
  check('GET is refused with a pointer to the docs', r.status === 405);
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
