// CI gate: validate every plot in public/plots/ with the shared library,
// then rebuild the street manifest. Exit non-zero on any failure.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { validateIdentity, validateGlb, probeWalkability } from '../lib/validate-plot.mjs';

const root = join(new URL('..', import.meta.url).pathname, 'public', 'plots');
let failed = 0;
for (const slug of readdirSync(root)) {
  const dir = join(root, slug);
  if (!existsSync(join(dir, 'plot.json'))) continue;
  const plot = JSON.parse(readFileSync(join(dir, 'plot.json')));
  const glb = readFileSync(join(dir, 'plot.glb'));
  const requireDoor = plot.type === 'shop';
  const id = validateIdentity(plot);
  const budgets = await validateGlb(glb, { requireDoor });
  const walk = await probeWalkability(glb, { door: requireDoor });
  const ok = id.ok && budgets.ok && walk.ok;
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${slug}`);
  if (!ok) {
    for (const c of [...id.checks, ...budgets.checks, ...walk.checks]) {
      if (!c.ok) console.log(`      FAIL ${c.name}: ${c.detail}`);
    }
  }
}
execSync('node scripts/build-manifest.mjs', { stdio: 'inherit' });
if (failed) {
  console.error(`\n${failed} plot(s) failed`);
  process.exit(1);
}
console.log('\nall plots valid');
