// POST /api/log-drain — Vercel's runtime logs, filtered down to the submission
// telemetry and KEPT.
//
// api/submit.mjs already prints one structured line per attempt, but a log line
// lives only as long as the platform's log retention, so the dataset that makes
// this city interesting — what an agent gets done end to end with no human —
// was evaporating a day at a time. A drain is what turns it into something you
// still have in six months.
//
// The other half of the reason is the denominator, and it is the half a
// self-logging endpoint CANNOT cover: a request body over 4.5 MB is rejected by
// the platform BEFORE the function runs, so an agent that tried to send too
// large a bundle never reaches a single line of our code. A timeout and a crash
// are the same. Those attempts are real and they are invisible from inside; the
// drain sees them because it sees the request, not the handler.
//
// Setup is three env vars and one dashboard entry — see docs/telemetry.md.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { put } from '@vercel/blob';

// Our own marker from api/submit.mjs. Everything else the project logs —
// every static asset, every /api/plots read — is dropped unread.
const MARKER = 'SUBMIT ';
const SUBMIT_PATH = '/api/plots/submit';

const eq = (a, b) => {
  const x = Buffer.from(String(a ?? ''));
  const y = Buffer.from(String(b ?? ''));
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * Which of a drained batch's entries are worth keeping, normalized.
 *
 * Two kinds, and the second is the point of draining at all:
 *   - our own telemetry line, re-parsed so what lands is structured data
 *     rather than a string somebody has to re-parse later;
 *   - any failed request to the submit route that carries no telemetry line,
 *     which is exactly the attempt our own handler never saw.
 *
 * Exported so the checks can exercise it without a network or a store.
 */
export function selectRecords(entries) {
  const out = [];
  for (const e of entries) {
    if (!e || typeof e !== 'object') continue;
    const message = typeof e.message === 'string' ? e.message : '';
    const at = e.timestamp ? new Date(e.timestamp).toISOString() : new Date().toISOString();
    const request = {
      request_id: e.requestId ?? null,
      status: e.statusCode ?? null,
      path: e.path ?? null,
      host: e.host ?? null,
      deployment: e.deploymentId ?? null,
      region: e.executionRegion ?? e.region ?? null,
    };
    const i = message.indexOf(MARKER);
    if (i !== -1) {
      let attempt = null;
      try { attempt = JSON.parse(message.slice(i + MARKER.length)); } catch { /* keep the raw line below */ }
      out.push(attempt
        ? { kind: 'attempt', ...attempt, request }
        : { kind: 'attempt-unparsed', at, raw: message.slice(i, i + 2000), request });
      continue;
    }
    // The attempts that never reached our code. `level` catches a crash or a
    // timeout, which the platform reports with no status of its own.
    const failed = typeof e.statusCode === 'number' && e.statusCode >= 400;
    if ((e.path || '').startsWith(SUBMIT_PATH) && (failed || e.level === 'error' || e.level === 'fatal')) {
      out.push({ kind: 'platform', at, level: e.level ?? null,
        detail: message.slice(0, 500) || null, request });
    }
  }
  return out;
}

/** NDJSON or a JSON array — a drain can be configured either way. */
export function parseBatch(raw) {
  const text = raw.trim();
  if (!text) return [];
  if (text.startsWith('[')) {
    const arr = JSON.parse(text);
    return Array.isArray(arr) ? arr : [];
  }
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* one bad line must not lose the batch */ }
  }
  return out;
}

// The raw bytes, because the signature is over them. `req.body` means the
// platform already parsed and drained the stream, and re-serializing an object
// cannot reproduce the bytes it came from — so the header key is what
// authenticates that case, and the signature is checked only when it can be.
async function readRaw(req) {
  if (req.body !== undefined && req.body !== null) {
    return { raw: null, parsed: typeof req.body === 'string' ? parseBatch(req.body) : req.body };
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return { raw: Buffer.concat(chunks).toString('utf8'), parsed: null };
}

export default async function handler(req, res) {
  const secret = process.env.LOG_DRAIN_SECRET;
  const verify = process.env.LOG_DRAIN_VERIFY;

  // Vercel will not create a drain until the endpoint echoes the verification
  // value it hands you, so this branch is what makes registration possible.
  if (req.method === 'GET' || req.method === 'HEAD') {
    if (verify) res.setHeader('x-vercel-verify', verify);
    res.statusCode = verify ? 200 : 503;
    res.end(verify ? 'otra.city log drain\n' : 'LOG_DRAIN_VERIFY is not set on this deployment\n');
    return;
  }
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.end('POST\n');
    return;
  }
  // Fail closed. An unconfigured deployment must not accept anything, or this
  // is an open endpoint that writes whatever it is handed into our store.
  if (!secret) {
    console.error('log-drain: LOG_DRAIN_SECRET is not set — refusing');
    res.statusCode = 503;
    res.end('not configured\n');
    return;
  }

  try {
    const { raw, parsed } = await readRaw(req);
    const signature = req.headers['x-vercel-signature'];
    const keyed = eq(req.headers['x-otra-drain-key'], secret);
    const signed = raw != null && typeof signature === 'string' &&
      eq(signature, createHmac('sha1', secret).update(raw).digest('hex'));
    if (!keyed && !signed) {
      // Say which wall was hit. A drain configured for JSON rather than NDJSON
      // arrives with a content-type the platform parses, which drains the
      // stream — and a signature over bytes we no longer have cannot be
      // checked. That is a real configuration, so it gets a real message
      // instead of a bare 403 somebody has to guess at.
      const why = raw == null
        ? 'the body arrived pre-parsed, so the signature could not be checked over the raw bytes — ' +
          'set the drain to NDJSON delivery, or add the header x-otra-drain-key with the same value as LOG_DRAIN_SECRET'
        : 'no valid x-vercel-signature and no matching x-otra-drain-key';
      console.error(`log-drain: refused — ${why}`);
      res.statusCode = 403;
      res.end(`${why}\n`);
      return;
    }

    const records = selectRecords(parsed ?? parseBatch(raw));
    if (!records.length) {                    // the overwhelming majority of batches
      res.statusCode = 200;
      res.end('0\n');
      return;
    }

    // One object per batch, never read-modify-write: two batches arriving at
    // once cannot then lose one another's records, and nothing has to be
    // rewritten as the dataset grows.
    const now = new Date();
    const stamp = now.toISOString().replace(/[:.]/g, '-');
    const path = `submissions/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${stamp}.jsonl`;
    await put(path, records.map((r) => JSON.stringify(r)).join('\n') + '\n', {
      access: 'private',
      contentType: 'application/x-ndjson',
      addRandomSuffix: true,
    });
    console.log(`log-drain: kept ${records.length} record(s) -> ${path}`);
    res.statusCode = 200;
    res.end(`${records.length}\n`);
  } catch (e) {
    // 500 so the drain retries: at-least-once with the odd duplicate is the
    // right trade against losing the attempt outright. Duplicates are
    // detectable — every record carries the request id.
    console.error('log-drain failed:', e.message || e);
    res.statusCode = 500;
    res.end('retry\n');
  }
}
