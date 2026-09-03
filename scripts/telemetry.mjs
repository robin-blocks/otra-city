#!/usr/bin/env node
// What the drain has kept — `npm run telemetry`.
//
// The dataset is the point of draining, and a dataset nobody can read is just
// a slower way of throwing it away. This is the reader: it lists what the
// drain has written and answers the questions the retrospective says are worth
// asking — how many attempts, how many were REJECTED and on what, who is
// submitting, and whether they arrive as a browser or as a bare API call.
//
//   npm run telemetry               the summary
//   npm run telemetry -- --raw      every record as JSONL, for your own tools
//   npm run telemetry -- --since 2026-09-01
//
// Needs BLOB_READ_WRITE_TOKEN. `vercel env pull` puts it in .env.local, which
// this reads if the variable is not already set.
import { list, get } from '@vercel/blob';
import { readFileSync, existsSync } from 'node:fs';

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const value = (n) => { const i = args.indexOf(n); return i === -1 ? null : args[i + 1]; };

if (!process.env.BLOB_READ_WRITE_TOKEN) {
  const envFile = new URL('../.env.local', import.meta.url).pathname;
  if (existsSync(envFile)) {
    const m = readFileSync(envFile, 'utf8').match(/^BLOB_READ_WRITE_TOKEN="?([^"\n]+)"?/m);
    if (m) process.env.BLOB_READ_WRITE_TOKEN = m[1];
  }
}
if (!process.env.BLOB_READ_WRITE_TOKEN) {
  console.error('BLOB_READ_WRITE_TOKEN is not set. Run: vercel env pull');
  process.exit(1);
}

const since = value('--since');
const records = [];
let cursor;
let objects = 0;
do {
  const page = await list({ prefix: 'submissions/', cursor, limit: 1000 });
  cursor = page.cursor;
  for (const b of page.blobs) {
    objects++;
    const r = await get(b.pathname, { access: 'private' });
    const text = await new Response(r.stream ?? r.body ?? r).text();
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const rec = JSON.parse(line);
        if (since && (rec.at || '') < since) continue;
        records.push(rec);
      } catch { /* a truncated object must not stop the read */ }
    }
  }
} while (cursor);

records.sort((a, b) => String(a.at).localeCompare(String(b.at)));

if (flag('--raw')) {
  for (const r of records) console.log(JSON.stringify(r));
  process.exit(0);
}

const tally = (key, filter = () => true) => {
  const m = new Map();
  for (const r of records) {
    if (!filter(r)) continue;
    for (const v of [].concat(key(r) ?? [])) m.set(v, (m.get(v) || 0) + 1);
  }
  return [...m].sort((a, b) => b[1] - a[1]);
};
const show = (title, rows, note = '') => {
  console.log(`\n${title}${note ? `  ${note}` : ''}`);
  if (!rows.length) return console.log('  (none)');
  const w = Math.max(...rows.map(([k]) => String(k).length));
  for (const [k, n] of rows) console.log(`  ${String(k).padEnd(w)}  ${n}`);
};

const attempts = records.filter((r) => r.kind === 'attempt' || r.kind === 'attempt-unparsed');
const platform = records.filter((r) => r.kind === 'platform');
const accepted = attempts.filter((r) => String(r.outcome).startsWith('accepted'));

console.log(`${records.length} record(s) in ${objects} object(s)` +
  (records.length ? `, ${records[0].at} .. ${records[records.length - 1].at}` : ''));
console.log(`${attempts.length} attempt(s) reached the endpoint; ${platform.length} never did ` +
  `(rejected or failed before the function ran — the half a self-logging endpoint cannot see)`);
if (attempts.length) {
  console.log(`completion: ${accepted.length}/${attempts.length} ` +
    `(${Math.round((accepted.length / attempts.length) * 100)}%)`);
}
show('outcome', tally((r) => r.outcome));
show('why rejected', tally((r) => r.failed, (r) => r.outcome === 'rejected'),
  '— the denominator that was being thrown away');
show('identity', tally((r) => r.owner));
show('builder', tally((r) => r.builder));
show('url tier', tally((r) => r.url_tier));
show('transport', tally((r) => r.transport));
show('caller user-agent', tally((r) => r.caller?.['user-agent']));
show('browser or bare API call', tally((r) => r.caller?.origin ? 'has an Origin (browser)' : 'no Origin (server-side call)'),
  '— the distinction that decides what the lesson is');
if (platform.length) show('never reached the code', tally((r) => `${r.request?.status ?? r.level ?? '?'}`));
