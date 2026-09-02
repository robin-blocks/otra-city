// Keep docs/ and public/docs/ identical — they are two copies of the same
// documents and BOTH are read. public/docs/ is what https://otra.city/docs/
// serves, so it is what a submitting agent actually reads; docs/ is the same
// document for maintainers. Drift here is not cosmetic: an agent cannot follow
// a rule that only the maintainer's copy states.
//
// They have drifted in both directions before — one commit added the surface
// checks to docs/submission.md and public/docs/agent-context.md and missed
// each mirror — which is why this exists.
//
// docs/ is the SOURCE and public/docs/ the published copy: package.json
// already names docs/ as the doc directory, and public/ otherwise holds served
// and generated output.
//
// This CHECKS by default and copies only with --write, instead of syncing
// silently in CI. An automatic copy would DELETE a one-sided edit made on the
// served copy rather than report it — turning the drift that happens here into
// lost work. So it fails loudly and a human picks the direction.
//
// SHARED is an explicit list, not a glob, in both directions: docs/ also holds
// maintainer-only files (PLAN.md, poc-notes.md, directory-upsell.md) that must
// never be published, and public/docs/ holds assets (plot-spec.json,
// feed-example.json, otra-shop-template.blend) with no repo counterpart.
// Publishing a document should be a deliberate line in this list.
//
// Usage: node scripts/sync-docs.mjs [--write]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const SHARED = ['agent-context.md', 'authoring.md', 'submission.md'];

const root = new URL('..', import.meta.url).pathname;
const write = process.argv.includes('--write');
let drifted = 0;

for (const name of SHARED) {
  const from = join(root, 'docs', name);
  const to = join(root, 'public', 'docs', name);
  if (!existsSync(from)) {
    console.log(`MISSING  docs/${name} — the source copy is gone`);
    drifted += 1;
    continue;
  }
  const source = readFileSync(from);
  if (existsSync(to) && source.equals(readFileSync(to))) continue;
  drifted += 1;
  if (write) {
    writeFileSync(to, source);
    console.log(`SYNCED   public/docs/${name} <- docs/${name}`);
  } else if (!existsSync(to)) {
    console.log(`MISSING  public/docs/${name} — not published`);
  } else {
    console.log(`DRIFT    docs/${name} and public/docs/${name} differ`);
    const d = spawnSync('diff', ['-u', '--label', `docs/${name}`,
      '--label', `public/docs/${name}`, from, to], { encoding: 'utf8' });
    process.stdout.write(d.stdout || '');
  }
}

if (!drifted) {
  console.log('docs/ and public/docs/ agree');
} else if (write) {
  console.log(`\n${drifted} document(s) synced from docs/`);
} else {
  console.error(`\n${drifted} document(s) differ. Merge the change into docs/<file>, taking the
newer wording from whichever side has it, then: node scripts/sync-docs.mjs --write
Check which side is newer FIRST — --write copies docs/ over public/docs/ and
would discard an edit made only on the served copy.`);
  process.exit(1);
}
