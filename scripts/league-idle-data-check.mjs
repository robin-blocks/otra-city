// Offline contract for between-match standings. No programme/HUD authority,
// live fetches, or production ranking helpers are used to construct expectations.
// Run: node --test scripts/league-idle-data-check.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildIdleTable, buildMatchTable } from '../public/js/league-table-data.mjs';

const NOW = Date.parse('2026-01-02T12:00:00Z');
const TEAMS = [
  { slug: 'alpha', code: 'ALP', name: 'Alpha', color: '#aa0000' },
  { slug: 'beta', code: 'BET', name: 'Beta', color: '#00aa00' },
];
const clone = (x) => structuredClone(x);
function season(id = 3, played = true) {
  const fixture = (n, home, away, status, score) => ({
    n, home: home.slug, away: away.slug, home_code: home.code, away_code: away.code, status, score,
    ...(status === 'aired' ? { aired_at: `2026-01-01T12:00:0${n}Z`, watch: { id: `s${id}-m${n}_${home.slug}_${away.slug}` } } : {}),
  });
  return {
    season: id, name: 'RFL Test League', preseason: id === 0,
    total_matches: 4, aired_count: played ? 2 : 0, skipped_count: 1,
    teams: clone(TEAMS),
    matches: [
      fixture(1, TEAMS[0], TEAMS[1], played ? 'aired' : 'scheduled', played ? [1, 0] : null),
      fixture(2, TEAMS[1], TEAMS[0], played ? 'aired' : 'scheduled', played ? [1, 1] : null),
      fixture(3, TEAMS[0], TEAMS[1], 'scheduled', [99, 0]),
      fixture(4, TEAMS[1], TEAMS[0], 'skipped', [0, 88]),
    ],
    // Hand-worked totals: alpha wins 1-0, then beta draws 1-1 with alpha.
    // Scheduled/skipped scores and the publisher's round movement are NOT evidence.
    table: [
      { ...TEAMS[0], P: played ? 2 : 0, W: played ? 1 : 0, D: played ? 1 : 0, L: 0,
        GF: played ? 2 : 0, GA: played ? 1 : 0, GD: played ? 1 : 0, Pts: played ? 4 : 0, pos: 1, prev: 2, move: 1 },
      { ...TEAMS[1], P: played ? 2 : 0, W: 0, D: played ? 1 : 0, L: played ? 1 : 0,
        GF: played ? 1 : 0, GA: played ? 2 : 0, GD: played ? -1 : 0, Pts: played ? 1 : 0, pos: 2, prev: 1, move: -1 },
    ],
  };
}
const archive = () => ({ generated_at: '2026-01-02T11:59:00Z', current_season: 3, seasons: [season()] });
function accepted(doc = archive(), nowMs = NOW) {
  const result = buildIdleTable(doc, { nowMs });
  assert.equal(result.reason, null, result.reason);
  assert.ok(result.table);
  return result.table;
}
function closed(doc, nowMs = NOW) {
  let result;
  assert.doesNotThrow(() => { result = buildIdleTable(doc, { nowMs }); });
  assert.equal(result.table, null, 'unverified standings must fail closed');
  assert.equal(typeof result.reason, 'string');
  assert.ok(result.reason.length, 'rejection must be diagnosable');
}
const columns = (table) => table.rows.map((r) => [r.code, r.position, r.previousPosition,
  r.played, r.previousPlayed, r.gd, r.previousGd, r.points, r.previousPoints]);
const EXPECTED = [['ALP', 1, 1, 2, 2, 1, 1, 4, 4], ['BET', 2, 2, 2, 2, -1, -1, 1, 1]];

test('idle presentation is a static verified published table, never a fictional latest result', () => {
  const doc = archive(), before = clone(doc), table = accepted(doc);
  assert.equal(table.mode, 'idle');
  assert.equal(table.seasonId, 3);
  assert.equal(table.season, 3, 'retain existing renderer season field');
  assert.equal(table.seasonName, 'RFL Test League');
  assert.equal(table.label, 'SEASON 3');
  assert.equal(table.basis, 'published-standings');
  assert.equal(table.generatedAt, doc.generated_at);
  assert.equal(table.sourceLabel, 'RFL · Published standings');
  assert.deepEqual(columns(table), EXPECTED);
  for (const field of ['matchId', 'home', 'away', 'score', 'fixtureLabel']) assert.equal(Object.hasOwn(table, field), false);
  for (const row of table.rows) {
    assert.equal(Object.hasOwn(row, 'move'), false);
    assert.equal(row.name, TEAMS.find((t) => t.code === row.code).name);
  }
  assert.deepEqual(doc, before, 'construction cannot mutate publisher data');
  table.rows[0].points = -100;
  assert.deepEqual(columns(accepted(doc)), EXPECTED, 'presentation rows must not alias archive rows');
});

test('current season wins over array order, an older season re-air, and a future season', () => {
  const doc = archive(), old = season(2), future = season(4);
  old.matches[0].aired_at = '2026-01-02T11:00:00Z';
  old.matches[1].aired_at = '2026-01-02T11:01:00Z';
  future.matches[0].aired_at = '2026-01-03T11:00:00Z';
  future.matches[1].aired_at = '2026-01-03T11:01:00Z';
  doc.seasons = [future, old, doc.seasons[0], season(0)];
  assert.equal(accepted(doc).seasonId, 3);
  doc.seasons.reverse();
  assert.equal(accepted(doc).seasonId, 3);
});

test('a reconciled unplayed current season falls back to the latest earlier published standings', () => {
  const doc = archive();
  doc.seasons = [season(1), season(4), season(3, false), season(2)];
  assert.equal(accepted(doc).seasonId, 2);
  assert.deepEqual(columns(accepted(doc)), EXPECTED);
});

test('no confirmed results means no table, including scheduled fixtures with scores', () => {
  const doc = archive(); doc.seasons = [season(3, false)]; closed(doc);
});

test('pre-season zero is a valid explicit identity, and absent season names have an honest label fallback', () => {
  const doc = archive(); doc.current_season = 0; doc.seasons = [season(0)];
  delete doc.seasons[0].name;
  assert.equal(accepted(doc).seasonId, 0);
  assert.equal(accepted(doc).seasonName, 'PRE-SEASON');
  assert.equal(accepted(doc).label, 'PRE-SEASON');
});

test('malformed or future-contaminated current standings cannot silently fall back to old seasons', () => {
  for (const corrupt of [
    (s) => { s.table[0].Pts++; },
    (s) => { s.matches[0].aired_at = '2026-01-03T12:00:00Z'; },
    (s) => { s.aired_count = 0; },
  ]) {
    const doc = archive(); doc.seasons.push(season(2)); corrupt(doc.seasons[0]); closed(doc);
  }
});

test('scheduled and skipped scores, predicted kickoff times, and round movement never enter idle totals', () => {
  const doc = archive();
  doc.seasons[0].matches[2].kickoff_utc = '2026-01-01T11:00:00Z';
  doc.seasons[0].matches[2].watch = { id: 's3-m3_alpha_beta' };
  doc.seasons[0].matches[3].aired_at = '2026-01-01T10:00:00Z';
  doc.seasons[0].matches.reverse(); doc.seasons[0].table.reverse();
  assert.deepEqual(columns(accepted(doc)), EXPECTED);
});

test('future aired results fail closed even inside the accepted publication clock skew', () => {
  const doc = archive(); doc.generated_at = new Date(NOW + 60000).toISOString();
  doc.seasons[0].matches[1].aired_at = new Date(NOW + 1).toISOString();
  closed(doc);
});

test('an aired result after the archive publication time is unconfirmed, even if it precedes now', () => {
  const doc = archive(); doc.seasons[0].matches[1].aired_at = new Date(NOW - 1).toISOString(); closed(doc);
});

test('a result exactly at now and publication time is eligible', () => {
  const doc = archive(); doc.generated_at = new Date(NOW).toISOString();
  doc.seasons[0].matches[1].aired_at = doc.generated_at;
  assert.deepEqual(columns(accepted(doc)), EXPECTED);
});

test('freshness uses the existing six-hour archive limit and sixty-second clock-skew allowance', () => {
  for (const offset of [-6 * 3600000, 60000]) {
    const doc = archive(); doc.generated_at = new Date(NOW + offset).toISOString(); accepted(doc);
  }
  for (const offset of [-6 * 3600000 - 1, 60001]) {
    const doc = archive(); doc.generated_at = new Date(NOW + offset).toISOString(); closed(doc);
  }
  // Match age itself is not evidence of a stale archive during a league break.
  assert.deepEqual(columns(accepted()), EXPECTED);
});

for (const nowMs of [null, NaN, Infinity, -Infinity, '2026-01-02T12:00:00Z']) {
  test(`invalid wall clock fails closed: ${String(nowMs)}`, () => closed(archive(), nowMs));
}
for (const generated_at of [undefined, null, '', 'badZ', '2026-01-02T11:59:00', '2026-02-30T11:59:00Z']) {
  test(`invalid publication timestamp fails closed: ${JSON.stringify(generated_at)}`, () => closed({ ...archive(), generated_at }));
}
for (const current_season of [undefined, null, '3', -1, 1.5, Infinity, 999]) {
  test(`untrusted current-season identity fails closed: ${String(current_season)}`, () => closed({ ...archive(), current_season }));
}

test('missing documents, seasons and ambiguous season identities fail closed', () => {
  for (const doc of [undefined, null, {}, { ...archive(), seasons: [] }, { ...archive(), seasons: {} },
    { ...archive(), seasons: [null] }, { ...archive(), seasons: [season(), season()] },
    { ...archive(), seasons: [season(), { season: '4' }] }]) closed(doc);
});

const malformed = [
  ['incomplete ledger', (s) => s.matches.pop()],
  ['wrong fixture total', (s) => s.total_matches++],
  ['wrong aired count', (s) => s.aired_count--],
  ['wrong skipped count', (s) => s.skipped_count--],
  ['duplicate fixture number', (s) => { s.matches[1].n = 1; }],
  ['unknown fixture team', (s) => { s.matches[0].home = 'unknown'; }],
  ['fixture code disagreement', (s) => { s.matches[0].home_code = 'BET'; }],
  ['unknown status', (s) => { s.matches[0].status = 'complete'; }],
  ['missing exact result identity', (s) => { delete s.matches[0].watch; }],
  ['different fixture identity', (s) => { s.matches[0].watch.id = 's3-m11_alpha_beta'; }],
  ['different season identity', (s) => { s.matches[0].watch.id = 's2-m1_alpha_beta'; }],
  ['untrusted result hash identity', (s) => { s.matches[0].watch.id += '-abcdef'; }],
  ['duplicate result identity', (s) => { s.matches[1].watch.id = s.matches[0].watch.id; }],
  ['unknown season name', (s) => { s.name = {}; }],
  ['blank season name', (s) => { s.name = ' '; }],
  ['invalid pre-season flag', (s) => { s.preseason = 'true'; }],
  ['missing final score', (s) => { delete s.matches[0].score; }],
  ['string final score', (s) => { s.matches[0].score = ['1', 0]; }],
  ['negative final score', (s) => { s.matches[0].score = [-1, 0]; }],
  ['fractional final score', (s) => { s.matches[0].score = [1.5, 0]; }],
  ['nonfinite final score', (s) => { s.matches[0].score = [Infinity, 0]; }],
  ['missing chronology', (s) => { delete s.matches[0].aired_at; }],
  ['timezone-free chronology', (s) => { s.matches[0].aired_at = '2026-01-01T12:00:01'; }],
  ['impossible date chronology', (s) => { s.matches[0].aired_at = '2026-02-30T12:00:01Z'; }],
  ['duplicate chronology', (s) => { s.matches[1].aired_at = s.matches[0].aired_at; }],
  ['null team', (s) => { s.teams[0] = null; }],
  ['duplicate team', (s) => { s.teams[1] = clone(s.teams[0]); }],
  ['missing team name', (s) => { delete s.teams[0].name; }],
  ['null fixture', (s) => { s.matches[0] = null; }],
  ['missing published table', (s) => { delete s.table; }],
  ['incomplete published table', (s) => s.table.pop()],
  ['duplicate published team', (s) => { s.table[1] = clone(s.table[0]); }],
  ['unknown published team', (s) => { s.table[0].slug = 'unknown'; }],
  ['published team code disagreement', (s) => { s.table[0].code = 'XXX'; }],
  ['null published row', (s) => { s.table[0] = null; }],
];
for (const field of ['P', 'W', 'D', 'L', 'GF', 'GA', 'GD', 'Pts', 'pos']) {
  malformed.push([`unreconciled published ${field}`, (s) => { s.table[0][field]++; }]);
}
for (const [name, mutate] of malformed) {
  test(`reuse strict season validation: ${name}`, () => { const doc = archive(); mutate(doc.seasons[0]); closed(doc); });
}

test('saved complete M42 first-air archive remains published-only, without HUD score or movement', () => {
  const incident = JSON.parse(readFileSync(new URL('./fixtures/league-first-air-m42.json', import.meta.url), 'utf8'));
  const doc = incident.archive, before = clone(doc);
  const table = accepted(doc, Date.parse(incident.programme.now));
  assert.equal(table.seasonName, 'SEASON 3', 'reduced fixture omits optional publisher name');
  assert.deepEqual(columns(table), [
    ['GEM', 1, 1, 8, 8, 27, 27, 24, 24],
    ['RMA', 2, 2, 9, 9, 35, 35, 21, 21],
    ['DYD', 3, 3, 9, 9, 6, 6, 13, 13],
    ['SYA', 4, 4, 8, 8, 5, 5, 13, 13],
    ['CDX', 5, 5, 8, 8, -7, -7, 12, 12],
    ['SGU', 6, 6, 7, 7, 12, 12, 10, 10],
    ['FAB', 7, 7, 8, 8, -2, -2, 9, 9],
    ['DSK', 8, 8, 8, 8, -11, -11, 9, 9],
    ['MSP', 9, 9, 6, 6, -17, -17, 2, 2],
    ['GLM', 10, 10, 7, 7, -48, -48, 0, 0],
  ]);
  const unconfirmed = doc.seasons[0].matches.find((m) => m.n === 42);
  Object.assign(unconfirmed, { score: [3, 6], watch: { id: incident.programme.item.bundleId } });
  assert.deepEqual(columns(accepted(doc, Date.parse(incident.programme.now))), columns(table));
  delete unconfirmed.score; delete unconfirmed.watch;
  assert.deepEqual(doc, before);
});

test('idle construction leaves match-specific score, basis and movement unchanged', () => {
  const doc = archive(), m = doc.seasons[0].matches[0];
  const options = { matchId: m.watch.id, home: { code: m.home_code }, away: { code: m.away_code }, score: m.score };
  const before = buildMatchTable(doc, options);
  accepted(doc);
  assert.deepEqual(buildMatchTable(doc, options), before);
  assert.equal(before.table.basis, 'published-result');
  assert.deepEqual(before.table.score, [1, 0]);
  assert.equal(before.table.rows[0].previousPlayed, 0);
  assert.equal(before.table.rows[0].played, 1);
});
