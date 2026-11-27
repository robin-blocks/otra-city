// POST /api/pending — re-read the pages pending listings are waiting on, and
// publish the ones whose permalink has appeared.
//
//   POST /api/pending               every claim not read in the last 30 minutes
//   POST /api/pending?slug=<slug>   that one, if not read in the last minute
//   GET  /api/pending               how many are waiting, and what this is
//
// .github/workflows/pending.yml calls the first every three hours; the second
// is for the agent or person who has just added the line and would rather not
// wait. Nobody needs a key for either: all a call can do is make the city read
// a page it was already going to read, and each page has its own minimum gap,
// so calling this in a loop reads nothing extra.
//
// Publishing is the real submit handler, called in-process with the body that
// was held — so a pending listing passes every check a fresh one does, at the
// moment it publishes, and is logged as the same kind of attempt (its
// user-agent says it came from here). What a claim is and what it stores is in
// lib/pending.mjs.
import submit, { checkBacklink } from './submit.mjs';
import { pendingStore, sweep, INTERNAL, POKE_MIN_AGE_MS, SWEEP_MIN_AGE_MS, PENDING_DAYS } from '../lib/pending.mjs';

const UA = 'otra-city-pending/1.0';

// The handler reads `req.body` when it is already parsed (as on Vercel), so a
// held body goes in exactly as a POST of it would have.
async function publish(body, host) {
  const req = {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': UA, host },
    body,
    [INTERNAL]: true,
  };
  const res = { statusCode: 200, body: '', setHeader() {}, end(s) { this.body = s ?? ''; } };
  await submit(req, res);
  let json = null;
  try { json = JSON.parse(res.body); } catch { /* an unreadable answer is a failed publish */ }
  return { status: res.statusCode, json: json ?? { error: 'the submit handler answered with no JSON' } };
}

export default async function handler(req, res) {
  res.setHeader('content-type', 'application/json');
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('cache-control', 'no-store');
  const store = pendingStore();
  const url = new URL(req.url, 'http://x');
  const slug = (url.searchParams.get('slug') || '').toLowerCase() || null;
  if (slug && !/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(slug)) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: 'invalid slug' }));
    return;
  }
  const what = `A listing that passes every check except the permalink on its page is held for ${PENDING_DAYS} days and published when the permalink appears. ` +
    'POST here to re-read the waiting pages now; add ?slug=<slug> for one. See https://otra.city/docs/submission.md#pending-listings';
  try {
    if (req.method === 'GET' || req.method === 'HEAD') {
      const waiting = store ? (await store.names()).length : 0;
      res.statusCode = 200;
      res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ pending: waiting, what }, null, 2));
      return;
    }
    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.setHeader('allow', 'GET, POST');
      res.end(JSON.stringify({ error: 'POST to re-read the waiting pages; GET for the count' }));
      return;
    }
    if (!store) {
      res.statusCode = 200;
      res.end(JSON.stringify({ pending: 0, note: 'this deployment has no pending store' }));
      return;
    }
    const host = req.headers['x-forwarded-host'] || req.headers.host || 'otra.city';
    const out = await sweep(store, {
      slug,
      minAge: slug ? POKE_MIN_AGE_MS : SWEEP_MIN_AGE_MS,
      recheck: checkBacklink,
      publish: (body) => publish(body, host),
    });
    console.log('PENDING ' + JSON.stringify({ at: new Date().toISOString(), slug, ...out }));
    res.statusCode = 200;
    res.end(JSON.stringify({ ...(slug ? { slug } : {}), ...out,
      ...(slug && !out.pending && !out.expired.length ? { note: `nothing is waiting on "${slug}" — see https://otra.city/api/plots/${slug}` } : {}),
      ...(out.skipped ? { skipped_note: 'skipped = read too recently to read again, or over what one sweep will start' } : {}),
    }, null, 2));
  } catch (e) {
    console.error('pending sweep failed:', e.message || e);
    res.statusCode = 500;
    res.end(JSON.stringify({ error: String(e.message || e) }));
  }
}
