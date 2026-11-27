// Pending listings — a listing that passed every check except the backlink.
//
// The backlink is the rule that rejects most submissions, and the telemetry
// says why: the agent that submits can usually not edit the site it is
// submitting. It reads "add otra.city/s/<slug> to your page", cannot, retries
// once or twice, and leaves — and the one thing its operator would have had to
// do never reaches them as a thing to do. Four live sites went that way in the
// fortnight to 2026-11-27, three of them from one operator in one batch.
//
// So a listing that fails ONLY the backlink is held instead of dropped: the
// fields that were sent are kept privately for PENDING_DAYS, the page is
// re-read every few hours, and the moment the permalink is on it the listing
// is sent through the real submit endpoint and publishes like any other. The
// rule itself does not move an inch — nothing is published, and no lot is
// allocated, until the page proves control.
//
// What a claim is NOT: a reservation. It is unverified, so it must never be
// able to keep anybody out. A submission whose own page carries the permalink
// is accepted exactly as before whether or not a claim is waiting on that
// slug, and the stale claim is dropped when it next fails to publish.
//
// Stored: the `plot` object as sent and `discovery_source` — the fields a
// listing sends in order to be published. Never a bundle (a custom build is
// not held: its files are megabytes and the telemetry contract says "never the
// bundle"), and no IP address. /claim#safety lists this; change it there in
// the same commit as here.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export const PENDING_DAYS = 14;
// One site cannot be made to answer for a pile of claims: every claim is one
// fetch of its url per sweep, and anybody can file one for a site not theirs.
export const PENDING_PER_OWNER = 3;
export const PENDING_MAX = 200;
// How long a page is left alone between two reads of it.
export const SWEEP_MIN_AGE_MS = 30 * 60e3;      // the scheduled sweep
export const POKE_MIN_AGE_MS = 60e3;            // POST /api/pending?slug=<slug>
// A sweep is one function invocation: bound what it can start.
const SWEEP_MAX_CHECKS = 60;
const SWEEP_MAX_PUBLISH = 4;
const PREFIX = 'pending/';

// The handler skips the store when the sweeper is the caller: a symbol cannot
// arrive over HTTP, so nothing a submitter sends can claim to be the sweeper.
export const INTERNAL = Symbol('otra.pending.internal');

const ownerHash = (owner) => createHash('sha256').update(String(owner)).digest('hex').slice(0, 12);
// `~` is not a slug character, so `pending/<slug>~` is a prefix that matches
// that slug and no other — and the owner is in the name, so the caps are
// counted from one listing without reading a single claim.
const pathFor = (slug, owner) => `${PREFIX}${slug}~${ownerHash(owner)}.json`;
const parsePath = (p) => {
  const m = /^pending\/([a-z0-9-]+)~([0-9a-f]{12})\.json$/.exec(p);
  return m ? { path: p, slug: m[1], owner: m[2] } : null;
};

// --- where claims live -------------------------------------------------------
// The private Blob store the telemetry already uses, when its token is set. A
// directory when PENDING_DIR is — the local harness and `npm run api:check`.
// Neither: there is no pending path, and a missing backlink is the plain
// rejection it always was.
function blobBackend() {
  let mod;
  const blob = async () => (mod ??= await import('@vercel/blob'));
  return {
    kind: 'blob',
    async names() {
      const { list } = await blob();
      const out = [];
      let cursor;
      do {
        const page = await list({ prefix: PREFIX, cursor, limit: 1000 });
        cursor = page.cursor;
        for (const b of page.blobs) out.push(b.pathname);
      } while (cursor);
      return out;
    },
    async read(path) {
      const { get } = await blob();
      const r = await get(path, { access: 'private', useCache: false });
      if (!r || r.statusCode !== 200) return null;
      return new Response(r.stream).text();
    },
    async write(path, text) {
      const { put } = await blob();
      await put(path, text, { access: 'private', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: true });
    },
    async remove(path) {
      const { del } = await blob();
      await del(path);
    },
  };
}

function dirBackend(dir) {
  const file = (p) => join(dir, p.slice(PREFIX.length));
  return {
    kind: 'dir',
    async names() {
      try { return readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => PREFIX + f); }
      catch { return []; }
    },
    async read(path) { try { return readFileSync(file(path), 'utf8'); } catch { return null; } },
    async write(path, text) { mkdirSync(dir, { recursive: true }); writeFileSync(file(path), text); },
    async remove(path) { rmSync(file(path), { force: true }); },
  };
}

export function pendingStore() {
  if (process.env.PENDING_DIR) return dirBackend(process.env.PENDING_DIR);
  if (process.env.BLOB_READ_WRITE_TOKEN) return blobBackend();
  return null;
}

const readJson = async (store, path) => {
  try { return JSON.parse(await store.read(path)); } catch { return null; }
};
const expired = (claim, now) => !claim?.expires || Date.parse(claim.expires) <= now;

/** The claim waiting on a slug, or null. An expired one is not a claim. */
export async function readClaim(store, slug, now = Date.now()) {
  const entries = (await store.names()).map(parsePath).filter((e) => e && e.slug === slug);
  for (const e of entries) {
    const claim = await readJson(store, e.path);
    if (claim && !expired(claim, now)) return claim;
  }
  return null;
}

/**
 * Hold a listing that failed only the backlink — or, with `write: false`, say
 * whether it would be held (the dry run's answer, and it writes nothing).
 *
 * Refusals, all of which leave the submission the plain rejection it was:
 *   other-owner  another site's unverified claim is already waiting on the slug
 *   owner-cap    this site already has PENDING_PER_OWNER claims waiting
 *   full         the store is at PENDING_MAX
 */
export async function fileClaim(store, { slug, owner, url, body, detail = null }, { write = true, now = Date.now() } = {}) {
  const path = pathFor(slug, owner);
  const entries = (await store.names()).map(parsePath).filter(Boolean);
  let mine = null;
  for (const e of entries.filter((x) => x.slug === slug)) {
    const claim = await readJson(store, e.path);
    if (!claim || expired(claim, now)) {
      if (write) await store.remove(e.path);
      continue;
    }
    if (e.path !== path) return { ok: false, why: 'other-owner' };
    mine = claim;
  }
  if (!mine) {
    const others = entries.filter((e) => e.slug !== slug);
    if (others.filter((e) => e.owner === ownerHash(owner)).length >= PENDING_PER_OWNER) return { ok: false, why: 'owner-cap' };
    if (others.length >= PENDING_MAX) return { ok: false, why: 'full' };
  }
  const since = mine?.since ?? new Date(now).toISOString();
  const claim = {
    slug, owner, url,
    // a resubmission replaces what is held and never extends how long: the
    // clock is the first claim's, or a claim could be kept alive for ever
    since,
    expires: mine?.expires ?? new Date(Date.parse(since) + PENDING_DAYS * 864e5).toISOString(),
    last_checked: new Date(now).toISOString(),
    checks: (mine?.checks ?? 0) + 1,
    last_detail: detail,
    stalled: null,
    body,
  };
  if (write) await store.write(path, JSON.stringify(claim, null, 2));
  return { ok: true, claim, renewed: !!mine };
}

/** Drop whatever is waiting on a slug — called when it publishes. */
export async function dropClaims(store, slug) {
  const entries = (await store.names()).map(parsePath).filter((e) => e && e.slug === slug);
  for (const e of entries) await store.remove(e.path);
  return entries.length;
}

/** What the world may see of a claim: what it is waiting for, never the body. */
export function publicView(claim) {
  return {
    since: claim.since,
    expires: claim.expires,
    last_checked: claim.last_checked ?? null,
    waiting_for: { url: claim.url, text: `otra.city/s/${claim.slug}` },
    stalled: claim.stalled ?? null,
  };
}

/**
 * Re-read every waiting page (or one, with `slug`) and publish what is ready.
 *
 *   recheck(url, slug)  -> { ok, detail }           the backlink check itself
 *   publish(body)       -> { status, json }         the real submit handler
 *
 * Both are passed in, so this file knows nothing about the endpoint and the
 * endpoint's test can drive every branch without a network.
 *
 * A claim leaves the store three ways: it published, it expired, or a newer
 * submission replaced it. One that is ready and then FAILS to publish — the
 * slug went to somebody else meanwhile, the site turned into a tunnel — is
 * marked `stalled` with the failing lines and left to expire, so the status
 * endpoint can say why instead of going quiet; it is not tried again.
 */
export async function sweep(store, { recheck, publish, slug = null, now = Date.now(), minAge = SWEEP_MIN_AGE_MS } = {}) {
  const out = { pending: 0, checked: 0, waiting: 0, skipped: 0, published: [], stalled: [], expired: [], unpublishable: [] };
  const entries = (await store.names()).map(parsePath).filter((e) => e && (!slug || e.slug === slug));
  const ready = [];
  for (const e of entries) {
    const claim = await readJson(store, e.path);
    if (!claim || expired(claim, now)) {
      await store.remove(e.path);
      out.expired.push(e.slug);
      continue;
    }
    out.pending++;
    if (claim.stalled) { out.stalled.push(e.slug); continue; }
    const age = now - Date.parse(claim.last_checked || 0);
    if (age < minAge || out.checked >= SWEEP_MAX_CHECKS) { out.skipped++; continue; }
    out.checked++;
    let seen;
    try { seen = await recheck(claim.url, claim.slug); }
    catch (err) { seen = { ok: false, detail: `could not check: ${err.name || err}` }; }
    claim.last_checked = new Date(now).toISOString();
    claim.checks = (claim.checks ?? 0) + 1;
    claim.last_detail = seen.detail ?? null;
    if (seen.ok) ready.push({ e, claim });
    else { out.waiting++; await store.write(e.path, JSON.stringify(claim, null, 2)); }
  }
  for (const { e, claim } of ready) {
    if (out.published.length >= SWEEP_MAX_PUBLISH) {          // the next sweep's
      out.skipped++;
      claim.last_checked = null;
      await store.write(e.path, JSON.stringify(claim, null, 2));
      continue;
    }
    let r;
    try { r = await publish(structuredClone(claim.body)); }
    catch (err) { r = { status: 500, json: { error: String(err.message || err) } }; }
    const j = r.json || {};
    if (j.accepted && j.pr_url) {
      await store.remove(e.path);
      out.published.push(e.slug);
    } else if (j.accepted) {
      // accepted with nowhere to publish to: a deployment with no bot token
      out.unpublishable.push(e.slug);
      await store.write(e.path, JSON.stringify(claim, null, 2));
    } else if (j.pending || r.status >= 500) {
      // the page changed its mind between the two reads, or we fell over:
      // still waiting, and the next sweep asks again
      out.waiting++;
      await store.write(e.path, JSON.stringify(claim, null, 2));
    } else {
      claim.stalled = {
        at: new Date(now).toISOString(),
        failed: String(j.report || j.error || '').split('\n').filter((l) => l.startsWith('FAIL')).map((l) => l.slice(0, 300)).slice(0, 8),
      };
      await store.write(e.path, JSON.stringify(claim, null, 2));
      out.stalled.push(e.slug);
    }
  }
  return out;
}
