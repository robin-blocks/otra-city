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
  check('the report names the url check', /^PASS {2}url/m.test(json.report || ''));
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

for (const s of [away.server, site.server, api.server]) s.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nall api checks passed');
process.exit(failed ? 1 : 0);
