// Fetching a submitter's files by URL, safely.
//
// Why this exists: everything in an API submission travels as base64 inside
// one JSON body, and the platform rejects a body over 4.5 MB before the
// function runs — so the documented media budgets (8 MiB glb + 16 MiB screens
// + 2 MiB audio + 6x2 MiB pictures) were unreachable through the endpoint that
// advertises them. Agents almost always have their assets on a host already,
// so the fix is to fetch them.
//
// Fetching URLs an anonymous caller chose is a server-side request forgery
// engine if it is done casually. Three things keep it honest:
//
//   1. https only, and every redirect re-checked (3 hops, then it stops).
//   2. The DNS result is validated AND PINNED: `lookup` hands the socket the
//      exact address it just approved, so a name that resolves public once and
//      private a moment later (DNS rebinding) cannot slip through the gap
//      between the check and the connection. Loopback, RFC1918, link-local
//      (including the 169.254.169.254 metadata service), CGNAT, unique-local
//      and multicast are all refused.
//   3. The byte cap is enforced while the body streams, so an endless response
//      is abandoned mid-download rather than buffered into the function.
//
// Node's fetch() cannot pin a resolved address, which is the whole reason this
// uses node:https directly.
import { request as httpsRequest } from 'node:https';
import { lookup as dnsLookup } from 'node:dns';
import { isIP } from 'node:net';

export function isPrivateAddress(ip) {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127) return true;          // this-host, private, loopback
    if (a === 172 && b >= 16 && b <= 31) return true;           // private
    if (a === 192 && b === 168) return true;                    // private
    if (a === 169 && b === 254) return true;                    // link-local + cloud metadata
    if (a === 100 && b >= 64 && b <= 127) return true;          // CGNAT
    if (a >= 224) return true;                                  // multicast + reserved
    return false;
  }
  if (v !== 6) return true;                                     // unparseable: refuse
  const s = ip.toLowerCase().replace(/^\[|\]$/g, '').split('%')[0];
  if (s === '::1' || s === '::') return true;
  if (s.startsWith('::ffff:')) {
    const mapped = s.slice(7);
    return isIP(mapped) === 4 ? isPrivateAddress(mapped) : true;
  }
  if (/^fe[89ab]/.test(s)) return true;                         // link-local
  if (/^f[cd]/.test(s)) return true;                            // unique-local
  if (s.startsWith('ff')) return true;                          // multicast
  return false;
}

// Resolves, refuses anything private, and returns the approved address to the
// socket — so what is checked is what is connected to.
function guardedLookup(hostname, options, cb) {
  dnsLookup(hostname, { ...options, all: true, verbatim: true }, (err, addresses) => {
    if (err) return cb(err);
    const list = Array.isArray(addresses) ? addresses : [addresses];
    const blocked = list.find((a) => isPrivateAddress(a.address));
    if (blocked) {
      return cb(new Error(`${hostname} resolves to a non-public address (${blocked.address})`));
    }
    if (options.all) return cb(null, list);
    return cb(null, list[0].address, list[0].family);
  });
}

const once = (url, timeoutMs) => new Promise((resolve, reject) => {
  const req = httpsRequest(url, {
    method: 'GET',
    headers: { 'user-agent': 'otra-city-bot/1.0', accept: '*/*' },
    lookup: guardedLookup,
    timeout: timeoutMs,
  }, resolve);
  req.on('timeout', () => req.destroy(new Error('timed out')));
  req.on('error', reject);
  req.end();
});

const size = (n) => (n >= 1 << 20 ? `${(n / 1024 / 1024).toFixed(1)} MiB` : `${(n / 1024).toFixed(0)} KiB`);

const readCapped = (res, maxBytes, label) => new Promise((resolve, reject) => {
  const chunks = [];
  let total = 0;
  res.on('data', (c) => {
    total += c.length;
    if (total > maxBytes) {
      res.destroy();
      reject(new Error(`${label}: larger than its ${size(maxBytes)} cap — download abandoned`));
      return;
    }
    chunks.push(c);
  });
  res.on('end', () => resolve(Buffer.concat(chunks)));
  res.on('error', reject);
});

export async function fetchAsset(rawUrl, { maxBytes, label = 'file', timeoutMs = 20000, maxRedirects = 3 } = {}) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`${label}: "${String(rawUrl).slice(0, 80)}" is not a URL`);
  }
  for (let hop = 0; ; hop++) {
    if (url.protocol !== 'https:') {
      throw new Error(`${label}: https URLs only (got ${url.protocol.replace(':', '')})`);
    }
    // A literal IP never reaches `lookup` — node skips DNS for one — so the
    // same rule has to be applied to the hostname itself. Without this,
    // https://169.254.169.254/ would be dialled straight from the function.
    const literal = url.hostname.replace(/^\[|\]$/g, '');
    if (isIP(literal) && isPrivateAddress(literal)) {
      throw new Error(`${label}: ${literal} is not a public address`);
    }
    let res;
    try {
      res = await once(url, timeoutMs);
    } catch (e) {
      throw new Error(`${label}: could not fetch ${url.origin}${url.pathname} — ${e.message}`);
    }
    const status = res.statusCode;
    if (status >= 300 && status < 400 && res.headers.location) {
      res.resume();
      if (hop >= maxRedirects) throw new Error(`${label}: more than ${maxRedirects} redirects`);
      try {
        url = new URL(res.headers.location, url);
      } catch {
        throw new Error(`${label}: redirect to an unusable location`);
      }
      continue;
    }
    if (status !== 200) {
      res.resume();
      throw new Error(`${label}: GET ${url.origin}${url.pathname} -> ${status}`);
    }
    const declared = Number(res.headers['content-length']);
    if (Number.isFinite(declared) && declared > maxBytes) {
      res.destroy();
      throw new Error(`${label}: ${size(declared)} is over its ${size(maxBytes)} cap`);
    }
    return readCapped(res, maxBytes, label);
  }
}
