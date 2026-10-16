// The inspector: once a day it walks the street and knocks on every listed
// shop's door — fetches the plot's `url` — to find the ones whose site has
// died. A shop whose site stays dead is served a NOTICE TO QUIT, and if the
// site still has not come back when the notice runs out, the plot is EVICTED:
// its files come down and its lot goes back on the market.
//
// The policy, written once here and described in docs/submission.md,
// /claim#safety, llms.txt and plot-spec.json `terms`:
//
//   * Third-party plots only. A plot whose url is on otra.city is the city's
//     own (exhibitions, demos, utilities) and is never knocked on.
//   * A knock is one GET of the listed url, following up to 5 redirects, 15 s
//     in all. Its verdict is one of three:
//       dead          DNS failure, connection refused, timeout, TLS error,
//                     HTTP 404/410, any 5xx, or a final url on a different
//                     registrable domain from the listed one
//       inconclusive  401/403/429 or a bot-challenge page. Never counts either
//                     way: the runner is a datacenter IP, and Cloudflare and
//                     friends challenge those as a matter of course
//       healthy       anything else
//   * healthy -> failing: the first dead knock records `failing_since`.
//     failing -> notice: a dead knock at least 48 h after `failing_since`
//     posts the notice; `evict_on` is the notice date + 14 days.
//     notice -> evicted: still dead on or after `evict_on`.
//     ANY healthy knock clears failing or notice at once, and the notice
//     comes down.
//   * Circuit breakers: more than 30% of the street dead in one run is the
//     runner's network, not the street — nothing is recorded and the run fails
//     red. And never more than 3 evictions in one run; the rest wait a day.
//   * The backlink is NOT part of this. The contract says the permalink is
//     read once, as proof, and that taking the badge down has no consequence;
//     a knock only asks whether the site answers.
//
// State lives in public/plots/notices.json and is written only when a plot
// changes state, so a quiet day commits nothing and production does not
// redeploy. Evictions are appended to public/plots/evictions.json, the public
// record.
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import { lookup as dnsLookup } from 'node:dns';
import { readFileSync, writeFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { isIP } from 'node:net';
import { guardedLookup, isPrivateAddress } from './fetch-asset.mjs';
import { apexHost, sameSite, hostOf } from './submitter-host.mjs';
import { POSTER_DIR, posterPattern } from './poster-paths.mjs';

export const KNOCK = { timeoutMs: 15000, maxRedirects: 5, bodyBytes: 64 * 1024 };
export const CLOCK = { confirmMs: 48 * 3600e3, graceDays: 14 };
export const BREAKER = { deadShare: 0.3, maxEvictions: 3 };
const UA = 'otra-city-bot/1.0 (+https://otra.city/claim#safety)';

// Error codes, sorted into the policy's words. Anything not listed here is an
// error we cannot name (a reset, an unreachable host) and is inconclusive —
// a firewall that drops datacenter traffic looks exactly like that.
const DNS_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'EAI_NODATA', 'EAI_NONAME', 'ENODATA', 'ESERVFAIL', 'EPRIVATE']);
const TLS_CODE = /^(ERR_TLS_|ERR_SSL_|ERR_OSSL_|CERT_|UNABLE_TO_|DEPTH_ZERO_|SELF_SIGNED_|HOSTNAME_MISMATCH|EPROTO$)/;

// What a bot wall looks like from the inside. Checked on every non-2xx answer
// before its status is read, so a Cloudflare 503 challenge is inconclusive,
// not a dead 5xx.
const CHALLENGE = /Just a moment\.\.\.|cf-chl-|challenge-platform|Attention Required! \| Cloudflare|Vercel Security Checkpoint|captcha-delivery\.com|DDoS-Guard|_Incapsula_Resource|px-captcha|Checking your browser/i;

const dead = (reason, extra = {}) => ({ verdict: 'dead', reason, ...extra });
const inconclusive = (reason, extra = {}) => ({ verdict: 'inconclusive', reason, ...extra });
const healthy = (reason, extra = {}) => ({ verdict: 'healthy', reason, ...extra });

function classifyError(e) {
  const code = e.code || '';
  if (code === 'ETIMEDOUT_KNOCK') return dead('no answer within the time allowed');
  if (DNS_CODES.has(code)) return dead(code === 'EPRIVATE' ? 'the name resolves to a non-public address' : `DNS: ${code}`);
  if (code === 'ECONNREFUSED') return dead('connection refused');
  if (TLS_CODE.test(code)) return dead(`TLS: ${code}`);
  return inconclusive(`network: ${code || e.message}`);
}

// One GET against a deadline, reading at most `bodyBytes` of the answer (a
// challenge page says what it is in the first few KiB).
function get(url, { deadline, allowLocal, bodyBytes }) {
  return new Promise((resolve, reject) => {
    const left = deadline - Date.now();
    if (left <= 0) { const e = new Error('timed out'); e.code = 'ETIMEDOUT_KNOCK'; reject(e); return; }
    const lookup = allowLocal ? dnsLookup : (host, opts, cb) => guardedLookup(host, opts, (err, ...rest) => {
      if (err && !err.code) err.code = 'EPRIVATE';   // guardedLookup's refusal carries no code of its own
      cb(err, ...rest);
    });
    const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
    let settled = false;
    const timer = setTimeout(() => {
      const e = new Error('timed out'); e.code = 'ETIMEDOUT_KNOCK';
      req.destroy(e);
    }, left);
    const done = (fn, v) => { if (!settled) { settled = true; clearTimeout(timer); fn(v); } };
    const req = send(url, {
      method: 'GET',
      headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,*/*;q=0.8' },
      lookup,
    }, (res) => {
      const chunks = [];
      let total = 0;
      const finish = () => {
        res.destroy();
        done(resolve, { status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') });
      };
      // headers are the answer; a body that stalls after them must not turn a
      // live site into a timeout, so the deadline here resolves, not rejects
      clearTimeout(timer);
      const bodyTimer = setTimeout(finish, Math.max(0, deadline - Date.now()));
      res.on('data', (c) => {
        chunks.push(c);
        total += c.length;
        if (total >= bodyBytes) { clearTimeout(bodyTimer); finish(); }
      });
      res.on('end', () => { clearTimeout(bodyTimer); finish(); });
      res.on('error', () => { clearTimeout(bodyTimer); finish(); });
    });
    req.on('error', (e) => done(reject, e));
    req.end();
  });
}

/**
 * Knock on one door. -> { verdict: 'dead'|'inconclusive'|'healthy', reason,
 * status?, final? }. `allowLocal` lifts the public-address guard and allows
 * plain http to a loopback host — for the fixture server in the check, never
 * for the street.
 */
export async function knock(listed, { timeoutMs = KNOCK.timeoutMs, maxRedirects = KNOCK.maxRedirects,
  bodyBytes = KNOCK.bodyBytes, allowLocal = false } = {}) {
  let url;
  try { url = new URL(listed); } catch { return inconclusive('the listed url does not parse'); }
  const deadline = Date.now() + timeoutMs;
  for (let hop = 0; ; hop++) {
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return inconclusive(`a redirect to ${url.protocol} is not something a knock can follow`);
    // a literal IP never reaches `lookup`, so the guard is applied to it here
    const literal = url.hostname.replace(/^\[|\]$/g, '');
    if (!allowLocal && isIP(literal) && isPrivateAddress(literal)) return dead('the address is not a public one', { final: url.href });
    let res;
    try {
      res = await get(url, { deadline, allowLocal, bodyBytes });
    } catch (e) {
      return { ...classifyError(e), final: url.href };
    }
    const { status, headers, body } = res;
    if (status >= 300 && status < 400 && headers.location) {
      if (hop >= maxRedirects) return inconclusive(`more than ${maxRedirects} redirects`, { status, final: url.href });
      try { url = new URL(headers.location, url); } catch { return inconclusive('a redirect to an unusable location', { status }); }
      continue;
    }
    const at = { status, final: url.href };
    const ok = status >= 200 && status < 300;
    if (!ok && (String(headers['cf-mitigated'] || '').toLowerCase() === 'challenge' || CHALLENGE.test(body))) {
      return inconclusive(`HTTP ${status}: a bot-challenge page`, at);
    }
    if (status === 401 || status === 403 || status === 429) return inconclusive(`HTTP ${status}`, at);
    if (!sameSite(listed, url.href)) return dead(`moved away: ends up on ${hostOf(url.href)}`, at);
    if (status === 404 || status === 410) return dead(`HTTP ${status}`, at);
    if (status >= 500) return dead(`HTTP ${status}`, at);
    return healthy(`HTTP ${status}`, at);
  }
}

// --- the state machine -------------------------------------------------------

const day = (iso) => String(iso).slice(0, 10);
const addDays = (iso, n) => new Date(Date.parse(day(iso)) + n * 86400e3).toISOString().slice(0, 10);

/**
 * One plot's next state, given its entry in notices.json (or null for a
 * healthy plot), today's knock and the time. Pure.
 * -> { entry, change } — `entry` null means healthy; `change` is null, or
 * 'failing' | 'notice' | 'evict' | 'cleared'.
 */
export function advance(entry, result, now, plot) {
  const nowIso = new Date(now).toISOString();
  const verdict = result?.verdict;
  if (verdict === 'healthy') return { entry: null, change: entry ? 'cleared' : null };
  if (verdict !== 'dead') return { entry, change: null };                 // inconclusive: nothing moves
  if (!entry) {
    return { change: 'failing', entry: { state: 'failing', name: plot.name, url: plot.url, lot: plot.lot ?? null,
      failing_since: nowIso, reason: result.reason, noticed: null, evict_on: null } };
  }
  if (entry.state === 'failing') {
    if (Date.parse(nowIso) - Date.parse(entry.failing_since) < CLOCK.confirmMs) return { entry, change: null };
    return { change: 'notice', entry: { ...entry, state: 'notice', reason: result.reason,
      noticed: nowIso, evict_on: addDays(nowIso, CLOCK.graceDays) } };
  }
  if (entry.state === 'notice' && day(nowIso) >= entry.evict_on) {
    return { change: 'evict', entry: { ...entry, reason: result.reason } };
  }
  return { entry, change: null };
}

// --- reading and writing the street ----------------------------------------

const readJson = (p, fallback) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : fallback);
const writeJson = (p, v) => writeFileSync(p, JSON.stringify(v, null, 2) + '\n');

export const NOTICES_COMMENT = 'GENERATED by scripts/inspector.mjs — never hand-edit. Every third-party plot whose site has failed the daily knock: `failing` since the first dead answer, `notice` once it has stayed dead for 48 h (evicted on `evict_on` unless it comes back). A healthy answer removes the entry. Policy: docs/submission.md, "When your site stops answering".';
export const EVICTIONS_COMMENT = 'The public record of plots evicted because their site stopped answering. Appended by scripts/inspector.mjs; the slug and the lot are free again, and the owner can resubmit at any time.';

/** Every plot on disk that the inspector knocks on: third-party, with a lot. */
export function streetOf(pub) {
  const plotsDir = join(pub, 'plots');
  const registry = readJson(join(plotsDir, 'lots.json'), { lots: {} });
  return readdirSync(plotsDir)
    .filter((s) => existsSync(join(plotsDir, s, 'plot.json')))
    .sort()
    .map((slug) => ({ ...JSON.parse(readFileSync(join(plotsDir, slug, 'plot.json'), 'utf8')), slug, lot: registry.lots?.[slug] ?? null }))
    .filter((p) => p.url && apexHost(p.url) !== 'otra.city');
}

/**
 * Take one plot off the street: its directory, its posters, its line in the
 * land registry (`lots` and the frozen `placed` record, so the lot can be
 * re-platted and handed out again), and a line in the public record. The
 * manifest and sitemap are rebuilt by the caller, once, after every eviction.
 */
export function evict(pub, slug, entry, nowIso) {
  const touched = [];
  const plotDir = join(pub, 'plots', slug);
  if (existsSync(plotDir)) { rmSync(plotDir, { recursive: true, force: true }); touched.push(`plots/${slug}/`); }
  const posterDir = join(pub, POSTER_DIR);
  if (existsSync(posterDir)) {
    for (const f of readdirSync(posterDir)) {
      if (posterPattern.test(f) && f.startsWith(`${slug}-`) && f.length === slug.length + 1 + 17) {
        rmSync(join(posterDir, f));
        touched.push(`${POSTER_DIR}/${f}`);
      }
    }
  }
  const regPath = join(pub, 'plots', 'lots.json');
  const reg = readJson(regPath, { lots: {}, placed: {} });
  const lot = reg.lots?.[slug] ?? entry.lot ?? null;
  if (reg.lots && slug in reg.lots) delete reg.lots[slug];
  if (lot && reg.placed && lot in reg.placed) delete reg.placed[lot];
  writeJson(regPath, reg);
  touched.push('plots/lots.json');
  const recPath = join(pub, 'plots', 'evictions.json');
  const rec = readJson(recPath, { comment: EVICTIONS_COMMENT, evictions: [] });
  rec.evictions.push({ slug, name: entry.name, url: entry.url, lot, failing_since: entry.failing_since,
    noticed: entry.noticed, evicted: nowIso, reason: entry.reason });
  writeJson(recPath, rec);
  touched.push('plots/evictions.json');
  return { lot, touched };
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}

/**
 * One inspection of the whole street.
 *
 *   pub       the public/ directory to read and write
 *   now       ms or ISO — injected by the check, the wall clock otherwise
 *   dry       knock and report; write nothing
 *   checks    a previous run's knocks ({slug: result}) to apply instead of
 *             knocking again — the workflow replays them after a push race
 *   knockOpts passed to knock()
 *
 * -> { tripped, rows, changes, evicted, held, wrote, checks }
 */
export async function inspect({ pub, now = Date.now(), dry = false, checks = null, knockOpts = {},
  maxEvictions = BREAKER.maxEvictions, deadShare = BREAKER.deadShare, rebuild = true } = {}) {
  const nowIso = new Date(now).toISOString();
  const street = streetOf(pub);
  const noticesPath = join(pub, 'plots', 'notices.json');
  const notices = readJson(noticesPath, { comment: NOTICES_COMMENT, plots: {} });
  const before = notices.plots || {};

  const results = checks || Object.fromEntries(await pool(street, 6, async (p) => [p.slug, await knock(p.url, knockOpts)]));
  const deadCount = street.filter((p) => results[p.slug]?.verdict === 'dead').length;
  const share = street.length ? deadCount / street.length : 0;
  const rows = street.map((p) => ({ slug: p.slug, lot: p.lot, url: p.url, ...(results[p.slug] || inconclusive('not knocked')),
    was: before[p.slug]?.state || 'healthy' }));
  if (share > deadShare) {
    return { tripped: true, share, deadCount, checked: street.length, rows, changes: [], evicted: [], held: [], wrote: false, checks: results };
  }

  const after = {};
  const changes = [];
  const due = [];
  for (const p of street) {
    let entry = before[p.slug] || null;
    // a resubmission under a different url is the owner coming back: start over
    if (entry && entry.url !== p.url) { changes.push({ slug: p.slug, change: 'cleared', why: 'url changed' }); entry = null; }
    const { entry: next, change } = advance(entry, results[p.slug], nowIso, p);
    if (change === 'evict') due.push({ slug: p.slug, entry: next });
    else if (change) changes.push({ slug: p.slug, change, entry: next });
    if (next) after[p.slug] = next;
  }
  // an entry for a plot no longer on the street (taken down, or evicted by a
  // run that lost a race) is dropped
  for (const slug of Object.keys(before)) {
    if (!street.some((p) => p.slug === slug)) changes.push({ slug, change: 'cleared', why: 'no longer on the street' });
  }
  due.sort((a, b) => a.entry.evict_on.localeCompare(b.entry.evict_on) || a.slug.localeCompare(b.slug));
  const evicting = due.slice(0, maxEvictions);
  const held = due.slice(maxEvictions);
  for (const d of evicting) delete after[d.slug];
  for (const r of rows) {
    const c = changes.find((x) => x.slug === r.slug);
    r.now = evicting.some((d) => d.slug === r.slug) ? 'evicted'
      : held.some((d) => d.slug === r.slug) ? 'notice (eviction held over: cap)'
        : after[r.slug]?.state || 'healthy';
    if (c?.why) r.now += ` (${c.why})`;
  }

  const moved = changes.length > 0 || evicting.length > 0;
  const evicted = [];
  if (!dry && moved) {
    writeJson(noticesPath, { comment: NOTICES_COMMENT, plots: Object.fromEntries(Object.keys(after).sort().map((s) => [s, after[s]])) });
    for (const d of evicting) evicted.push({ slug: d.slug, ...evict(pub, d.slug, d.entry, nowIso) });
    if (rebuild) {
      // the manifest carries each notice, and an eviction frees a lot: both
      // are the manifest builder's to publish, along with the sitemap
      const r = spawnSync(process.execPath, [new URL('../scripts/build-manifest.mjs', import.meta.url).pathname],
        { env: { ...process.env, OTRA_PUBLIC_DIR: pub }, encoding: 'utf8' });
      if (r.status !== 0) throw new Error(`build-manifest failed:\n${r.stdout}${r.stderr}`);
    }
  } else {
    for (const d of evicting) evicted.push({ slug: d.slug, lot: d.entry.lot, touched: [] });
  }
  return { tripped: false, share, deadCount, checked: street.length, rows, changes, evicted, held: held.map((h) => h.slug),
    wrote: !dry && moved, checks: results };
}
