// Validate every public/venues/<id>/venue.json against docs/venues/venue-schema.json
// and write public/venues/index.json, the manifest the client streams venues
// from — each entry carries its base path and world-space bounds so world.js
// needs no maths at load. `--check` fails instead of writing when the index
// is stale or a manifest is invalid (CI); `--strict` also fails on a missing
// near asset (a venue cannot be served without one).
import { readFileSync, readdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { validateVenue, venueBounds } from '../lib/venue-schema.mjs';

const root = new URL('..', import.meta.url).pathname;
const dir = join(root, 'public', 'venues');
const check = process.argv.includes('--check');
const strict = process.argv.includes('--strict');
let failed = 0;
const venues = [];

for (const id of readdirSync(dir).sort()) {
  const file = join(dir, id, 'venue.json');
  if (!existsSync(file)) continue;
  let def;
  try { def = JSON.parse(readFileSync(file, 'utf8')); } catch (e) {
    console.log(`FAIL  ${id}: venue.json is not JSON (${e.message})`); failed += 1; continue;
  }
  const errors = validateVenue(def);
  if (def.id !== id) errors.push(`$.id: "${def.id}" must equal the directory name "${id}"`);
  for (const [k, name] of Object.entries(def.assets || {})) {
    const p = join(dir, id, name);
    if (!existsSync(p)) {
      const msg = `assets.${k}: ${name} is missing`;
      if (k === 'near' && strict) errors.push(msg); else console.log(`warn  ${id}: ${msg}`);
    } else if (def.budgets) {
      const bytes = statSync(p).size;
      const cap = k === 'near' ? def.budgets.glb_bytes : def.budgets.far_bytes;
      if (cap && bytes > cap) errors.push(`assets.${k}: ${bytes} bytes exceeds budget ${cap}`);
    }
  }
  if (errors.length) {
    failed += 1;
    console.log(`FAIL  ${id}`);
    for (const e of errors) console.log(`      ${e}`);
    continue;
  }
  venues.push({ ...def, base: `/venues/${id}/`, bounds: venueBounds(def) });
  console.log(`PASS  ${id}  bounds x ${venues.at(-1).bounds.min[0]}..${venues.at(-1).bounds.max[0]}  z ${venues.at(-1).bounds.min[1]}..${venues.at(-1).bounds.max[1]}`);
}

const out = JSON.stringify({ version: '0.1', venues }, null, 2) + '\n';
const indexPath = join(dir, 'index.json');
if (check) {
  const current = existsSync(indexPath) ? readFileSync(indexPath, 'utf8') : '';
  if (current !== out) { console.log('FAIL  public/venues/index.json is stale — run `npm run venues`'); failed += 1; }
} else {
  writeFileSync(indexPath, out);
  console.log(`wrote public/venues/index.json (${venues.length} venue${venues.length === 1 ? '' : 's'})`);
}
if (failed) process.exit(1);
