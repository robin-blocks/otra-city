// The inspector's daily round: knock on every listed shop's door, post a
// notice to quit on the ones whose site has stayed dead, evict the ones whose
// notice has run out. The policy and the state machine are lib/inspector.mjs;
// this is the command line .github/workflows/inspector.yml runs.
//
//   node scripts/inspector.mjs                 knock, record transitions, evict
//   node scripts/inspector.mjs --dry           knock and report; write nothing
//   node scripts/inspector.mjs --save-checks f also write today's knocks to f
//   node scripts/inspector.mjs --checks f      apply the knocks in f instead of
//                                              knocking (the workflow's replay
//                                              after a push race)
//   --now <iso>                                pretend it is then
//   --public <dir>                             a public/ tree other than this repo's
//
// Exit 1 when the circuit breaker trips: more than 30% of the street dead in
// one run is the runner's network, and nothing is recorded.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { inspect, BREAKER } from '../lib/inspector.mjs';

const argv = process.argv.slice(2);
const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
const dry = argv.includes('--dry');
const pub = opt('--public') || join(new URL('..', import.meta.url).pathname, 'public');
const now = opt('--now') ? Date.parse(opt('--now')) : Date.now();
const checks = opt('--checks') ? JSON.parse(readFileSync(opt('--checks'), 'utf8')) : null;

const out = await inspect({ pub, now, dry, checks });
if (opt('--save-checks')) writeFileSync(opt('--save-checks'), JSON.stringify(out.checks, null, 2) + '\n');

const pad = (s, n) => String(s ?? '').padEnd(n);
console.log(`inspector ${dry ? '(dry run) ' : ''}${new Date(now).toISOString()}${checks ? ' — replaying saved knocks' : ''}`);
console.log(`${pad('plot', 18)}${pad('lot', 14)}${pad('knock', 14)}${pad('state', 10)}→ ${pad('now', 12)}reason`);
for (const r of out.rows) {
  console.log(`${pad(r.slug, 18)}${pad(r.lot, 14)}${pad(r.verdict, 14)}${pad(r.was, 10)}→ ${pad(r.now ?? '—', 12)}${r.reason}${r.final && r.final !== new URL(r.url).href ? `  [${r.final}]` : ''}`);
}
const pct = (x) => `${(x * 100).toFixed(0)}%`;
console.log(`\n${out.checked} third-party plots knocked: ${out.deadCount} dead (${pct(out.share)}; the breaker trips above ${pct(BREAKER.deadShare)})`);
if (out.tripped) {
  console.error('CIRCUIT BREAKER: too much of the street is dead at once — that is the runner\'s network, not the street. Nothing recorded.');
  process.exit(1);
}
for (const c of out.changes) console.log(`change: ${c.slug} -> ${c.change}${c.why ? ` (${c.why})` : ''}`);
for (const e of out.evicted) console.log(`evict: ${e.slug} from ${e.lot}${e.touched.length ? ` — removed ${e.touched.join(', ')}` : ''}`);
for (const h of out.held) console.log(`held over: ${h} is due for eviction, but a run evicts at most ${BREAKER.maxEvictions}`);
console.log(out.wrote ? 'wrote public/plots/notices.json (and rebuilt the manifest)' : dry ? 'dry run: nothing written' : 'no transitions: nothing to write');
