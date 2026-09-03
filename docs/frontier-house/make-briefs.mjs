// Render one ready-to-paste brief per entrant: BRIEF.md + roster.json -> briefs/.
//
// The whole experiment rests on every model getting byte-identical text apart
// from its own slug, lot, link and budget, which is exactly the thing a human
// filling in eight placeholders by hand gets wrong. So it is a script, and the
// briefs it writes are committed: adding an entrant is a row in roster.json
// and one run, and the diff shows that nothing else moved.
//
//   node docs/frontier-house/make-briefs.mjs           # write briefs/
//   node docs/frontier-house/make-briefs.mjs --check    # fail if they are stale (CI)
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const check = process.argv.includes('--check');
const outDir = join(here, 'briefs');

const roster = JSON.parse(readFileSync(join(here, 'roster.json'), 'utf8'));
const template = readFileSync(join(here, 'BRIEF.md'), 'utf8');

// The header block is addressed to the organiser ("replace every {{FILL}}"),
// so it never belongs in the copy a builder reads.
const body = template.replace(/^> [^\n]*\n(> [^\n]*\n)*\n---\n\n/m, '');

const fields = (e) => ({
  SLUG: e.slug,
  LOT_ID: e.lot,
  LOT_ADDRESS: e.address,
  URL: e.url ?? roster.defaults.url,
  BUILDER: e.builder ?? `${e.model} · frontier house exhibition`,
  WORKDIR: e.workdir ?? (roster.defaults.workdir || '').replace('<slug>', e.slug),
  EFFORT_BUDGET: e.effort_budget ?? roster.defaults.effort_budget,
  SUBMIT_MODE: e.submit_mode ?? roster.defaults.submit_mode,
});

const render = (e) => {
  const f = fields(e);
  if (f.BUILDER.length > 60) throw new Error(`${e.slug}: builder is ${f.BUILDER.length} chars, the cap is 60`);
  const out = body.replace(/{{([A-Z_]+)}}/g, (m, key) => {
    if (!(key in f)) throw new Error(`${e.slug}: BRIEF.md has {{${key}}} and roster.json has no value for it`);
    return f[key];
  });
  const left = out.match(/{{[A-Z_]+}}/);
  if (left) throw new Error(`${e.slug}: ${left[0]} survived the substitution`);
  return out;
};

const wanted = new Map(roster.entrants.map((e) => [`BRIEF-${e.slug}.md`, render(e)]));

if (check) {
  const have = existsSync(outDir) ? readdirSync(outDir).filter((f) => f.endsWith('.md')) : [];
  const stale = [...wanted].filter(([name, text]) => {
    const path = join(outDir, name);
    return !existsSync(path) || readFileSync(path, 'utf8') !== text;
  }).map(([name]) => name);
  const extra = have.filter((f) => !wanted.has(f));
  if (stale.length || extra.length) {
    console.error(`FAIL  briefs are stale — run \`node docs/frontier-house/make-briefs.mjs\``
      + (stale.length ? `\n      out of date: ${stale.join(', ')}` : '')
      + (extra.length ? `\n      no longer in the roster: ${extra.join(', ')}` : ''));
    process.exit(1);
  }
  console.log(`PASS  ${wanted.size} brief(s) match roster.json and BRIEF.md`);
} else {
  mkdirSync(outDir, { recursive: true });
  for (const f of existsSync(outDir) ? readdirSync(outDir) : []) {
    if (f.endsWith('.md') && !wanted.has(f)) rmSync(join(outDir, f));
  }
  for (const [name, text] of wanted) {
    writeFileSync(join(outDir, name), text);
    console.log(`wrote docs/frontier-house/briefs/${name}  ${text.length} chars`);
  }
}
