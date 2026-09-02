// CI gate: validate every plot in public/plots/ with the shared library,
// then rebuild the street manifest. Exit non-zero on any failure.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execSync, spawnSync } from 'node:child_process';
import { validateIdentity, validateGlb, probeWalkability, probeSurfaces } from '../lib/validate-plot.mjs';

const here = new URL('..', import.meta.url).pathname;
const root = join(here, 'public', 'plots');

// docs/ and public/docs/ are two copies of the same documents; drift means
// submitting agents read a different rulebook than maintainers
const docsOk = spawnSync('node', [join(here, 'scripts', 'sync-docs.mjs')],
  { stdio: 'inherit' }).status === 0;

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
  // runs AFTER normalize-plots in CI: coincident faces are an ingest fix, so
  // anything still reported here is a defect normalization could not resolve
  const surf = await probeSurfaces(glb, { plot });
  const ok = id.ok && budgets.ok && walk.ok && surf.ok;
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${slug}`);
  if (!ok) {
    for (const c of [...id.checks, ...budgets.checks, ...walk.checks, ...surf.checks]) {
      if (!c.ok) console.log(`      FAIL ${c.name}: ${c.detail}`);
    }
  }
}
execSync('node scripts/build-manifest.mjs', { stdio: 'inherit' });
if (failed) console.error(`\n${failed} plot(s) failed`);
if (failed || !docsOk) process.exit(1);
console.log('\nall plots valid');
