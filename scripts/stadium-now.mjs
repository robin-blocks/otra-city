// Put a match on in the stadium, or take it down.
//
//   node scripts/stadium-now.mjs s3-m31            # by bundle id, resolved from the feed
//   node scripts/stadium-now.mjs s3-m31 --loop     # ...and send it round again when it ends
//   node scripts/stadium-now.mjs <https url>       # by bundle url
//   node scripts/stadium-now.mjs off               # clear it
//   node scripts/stadium-now.mjs --list            # what is available to show
//
// Writes public/broadcast/now.json and nothing else. The deploy is what puts
// it on air, which is why this is driven from a workflow rather than a web
// endpoint: what the whole city shows stays a commit with a name on it.
import { readFileSync, writeFileSync } from 'node:fs';

const FEED = 'https://4dgsx.com/api/v1/programme/rfl';
// A leaked or mistaken value here would be downloaded and displayed by every
// visitor in the bowl, so the host is not a free field.
const ALLOWED_HOSTS = ['cdn.4dgsx.com'];
const FILE = 'public/broadcast/now.json';

const argv = process.argv.slice(2);
const want = argv.find((a) => !a.startsWith('--'));
const list = argv.includes('--list');
// A replay that runs out leaves the stadium showing a photograph of a match.
// Looping is opt-in because a fixture that is meant to end should end.
const loop = argv.includes('--loop');

async function programme() {
  const r = await fetch(FEED, { headers: { 'user-agent': 'otra-city/1.0' } });
  if (!r.ok) throw new Error(`programme feed ${r.status}`);
  return r.json();
}

/** A bundle a replay may legitimately point at: aired, and with a URL to fetch. */
function playable(items) {
  return items.filter((i) => i.state === 'replay' && i.bundleUrl)
    .sort((a, b) => String(b.publishedAt || '').localeCompare(String(a.publishedAt || '')));
}

if (list) {
  const p = await programme();
  const ok = playable(p.items);
  console.log(`${ok.length} bundle(s) available to put on:\n`);
  for (const i of ok.slice(0, 20)) {
    console.log(`  ${i.bundleId.padEnd(46)} ${String(i.score || '').padEnd(10)} ${i.title}`);
  }
  process.exit(0);
}

if (!want) {
  console.error('usage: stadium-now.mjs <bundle-id | https-url | off> [--list]');
  process.exit(2);
}

const doc = JSON.parse(readFileSync(FILE, 'utf8'));

if (/^(off|none|null|clear)$/i.test(want)) {
  doc.bundle = null;
  doc.title = null;
  doc.loop = false;
  delete doc._put_on;
  writeFileSync(FILE, JSON.stringify(doc, null, 2) + '\n');
  console.log('stadium: nothing on. The pitch goes back to empty at the next poll.');
  process.exit(0);
}

let url = null;
let title = null;

if (/^https?:\/\//i.test(want)) {
  url = want;
} else {
  const p = await programme();
  const hit = playable(p.items).find((i) => i.bundleId === want)
    || playable(p.items).find((i) => i.bundleId.startsWith(want));
  if (!hit) {
    console.error(`no playable bundle matching "${want}". Try --list.`);
    process.exit(1);
  }
  url = hit.bundleUrl;
  title = `${hit.title} (replay)`;
}

const u = new URL(url);
if (u.protocol !== 'https:') { console.error('the bundle must be https'); process.exit(1); }
if (!ALLOWED_HOSTS.includes(u.host)) {
  console.error(`refusing ${u.host}: bundles may only come from ${ALLOWED_HOSTS.join(', ')}`);
  process.exit(1);
}

doc.bundle = u.href;
doc.title = title || doc.title || 'Replay';
doc.loop = loop;
doc._put_on = `${new Date().toISOString().slice(0, 10)} — put on with scripts/stadium-now.mjs. Take it down with: off`;
writeFileSync(FILE, JSON.stringify(doc, null, 2) + '\n');
console.log(`stadium: ${doc.title}${loop ? ' — on a loop' : ''}\n  ${doc.bundle}`);
