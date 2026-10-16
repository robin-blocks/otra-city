#!/usr/bin/env node
// Does any district need a road, and which one? — `npm run growth`.
//
//   npm run growth                    headroom per district, and the plan for any short of lots
//   npm run growth -- --write         build the most urgent plan into public/city/map.json
//   npm run growth -- --write --max 2 ...the two most urgent, each planned on the map the last one left
//   --summary <file>                  also write a markdown account (the pull request's body)
//
// It only ever edits map.json. Re-plat with `npm run map` and rebuild the
// manifest with `npm run validate` afterwards — the workflow does both, and
// build-map's own guard refuses anything that moves a claimed lot. The rules
// live in lib/city-growth.mjs; this is the reader and the writer.
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { platLots } from '../public/js/city-map.mjs';
import { districts, needs, plan, describe, settings } from '../lib/city-growth.mjs';

const root = new URL('..', import.meta.url).pathname;
const pub = join(root, 'public');
const args = process.argv.slice(2);
const value = (n) => { const i = args.indexOf(n); return i === -1 ? null : args[i + 1]; };
const write = args.includes('--write');
const max = Number(value('--max') || 1);
const summaryPath = value('--summary');
const date = new Date().toISOString().slice(0, 10);

const mapPath = join(pub, 'city', 'map.json');
let map = JSON.parse(readFileSync(mapPath, 'utf8'));
const venues = existsSync(join(pub, 'venues', 'index.json'))
  ? JSON.parse(readFileSync(join(pub, 'venues', 'index.json'), 'utf8')).venues || [] : [];
const registry = JSON.parse(readFileSync(join(pub, 'plots', 'lots.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(join(pub, 'plots', 'index.json'), 'utf8'));
const plots = manifest.lots || [];
const taken = Object.values(registry.lots || {});
const S = settings(map);

const name = (plat, id) => plat.roads[id]?.name || id;
let plat = platLots(map, venues);
console.log(`districts (as a template listing sees them; headroom line: ${S.headroom} free)`);
for (const d of districts(plat, taken, plots)) {
  const roads = d.roads.length ? d.roads.map((r) => name(plat, r)).join(' + ') : 'no road';
  const flag = d.free <= S.headroom && (d.roads.length || d.demand) ? '  ← needs room' : '';
  console.log(`  ${d.categories.join(', ').padEnd(64)} ${roads.padEnd(30)} ${String(d.free).padStart(3)} free / ${String(d.total).padStart(3)}  listed ${d.demand}${flag}`);
}

const done = [];
for (let i = 0; i < max; i++) {
  plat = platLots(map, venues);
  const todo = needs(plat, taken, plots, map).filter((n) => !done.some((p) => p.need.categories.join() === n.categories.join()));
  if (!todo.length) break;
  const p = plan(map, todo[0], { venues, plots, date });
  console.log(`\nplan: ${describe(p)}`);
  for (const o of p.options.slice(1, 4)) console.log(`   also possible: ${o.kind} ${o.roadId} ${o.L} m ${o.dir} from ${o.anchor} (+${o.gained.length})`);
  if (!p.best) {
    const why = {};
    for (const r of p.rejected) why[r.why.replace(/ \S+$/, '')] = (why[r.why.replace(/ \S+$/, '')] || 0) + 1;
    console.log(`   rejected: ${Object.entries(why).map(([k, n]) => `${n}× ${k}`).join(', ')}`);
    done.push(p);
    continue;
  }
  done.push(p);
  if (write) map = p.best.map;
}

const planned = done.filter((p) => p.best);
if (!done.length) console.log('\ngrowth: every district has room — nothing to do');
if (write && planned.length) {
  writeFileSync(mapPath, JSON.stringify(map, null, 2) + '\n');
  console.log(`\nwrote public/city/map.json — now \`npm run map\` and \`npm run validate\``);
}

if (summaryPath) {
  const lines = [];
  lines.push(`The city is running out of room, so this proposes ${planned.length === 1 ? 'a road' : `${planned.length} roads`}. Opened by \`.github/workflows/city-growth.yml\`; planned by \`lib/city-growth.mjs\`.`, '');
  for (const p of done) {
    const n = p.need;
    lines.push(`### ${n.categories.join(', ')}`);
    lines.push(`- now: ${n.roads.length ? n.roads.map((r) => name(platLots(JSON.parse(readFileSync(mapPath, 'utf8')), venues), r)).join(' + ') : 'no road a template shopfront may use'} — **${n.free} free** of ${n.total}, ${n.demand} listed`);
    if (p.best) {
      const b = p.best;
      lines.push(`- proposal: ${describe(p).split('→ ')[1]}`);
      lines.push(`- name: **${b.name}**${b.sub ? ` (${b.sub})` : ''} — display only, rename it in \`public/city/map.json\` before merging if you like; the id \`${b.roadId}\` is permanent`);
      lines.push(`- checked: every existing lot keeps its address and position; the road keeps ${S.clearance} m from every lot, venue, bay, plaza, sign and road it does not join`);
    } else {
      lines.push(`- **no plan found** — ${p.rejected.length} candidates rejected; this needs a person with the map open`);
    }
    lines.push('');
  }
  lines.push('Look at `/map` on this branch\'s Vercel preview before merging. Merging this lets the next listing in these categories land on the new road; until then it lands on the last free lot, then the nearest free lot anywhere — permanently.');
  writeFileSync(summaryPath, lines.join('\n') + '\n');
}
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `grew=${write && planned.length ? 'true' : 'false'}\n`);
