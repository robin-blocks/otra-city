// Offline pre-match evidence contract. No scores from this fixture or later
// fixtures may enter the static presentation, even in an already-aired replay.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildPreMatchTable, validateSeason } from '../public/js/league-table-data.mjs';

const NOW = Date.parse('2026-09-21T12:05:00Z');
const START = '2026-09-21T12:00:00Z';
const TEAMS = ['alpha', 'beta', 'gamma'].map((slug) => ({ slug, code: slug.slice(0, 3).toUpperCase(), name: slug, color: '#123456' }));
const id = (m) => `s3-m${m.n}_${m.home}_${m.away}`;
function fixture(n, h, a, score) {
  const m = { n, home: TEAMS[h].slug, away: TEAMS[a].slug,
    home_code: TEAMS[h].code, away_code: TEAMS[a].code, status: score ? 'aired' : 'scheduled' };
  if (score) Object.assign(m, { score, aired_at: `2026-09-21T10:0${n}:00Z`, watch: { id: id(m) } });
  return m;
}
function archive() {
  const stats = [
    [2, 1, 0, 1, 2, 3, -1, 3, 2],
    [2, 0, 1, 1, 1, 3, -2, 1, 3],
    [2, 1, 1, 0, 4, 1, 3, 4, 1],
  ];
  return { generated_at: '2026-09-21T11:59:00Z', current_season: 3, seasons: [{ season: 3,
    teams: structuredClone(TEAMS), total_matches: 4, aired_count: 3, skipped_count: 0,
    matches: [fixture(3, 2, 0, [3, 0]), fixture(1, 0, 1, [2, 0]), fixture(4, 0, 2), fixture(2, 1, 2, [1, 1])],
    table: TEAMS.map((t, i) => ({ ...t, ...Object.fromEntries(['P', 'W', 'D', 'L', 'GF', 'GA', 'GD', 'Pts', 'pos'].map((key, k) => [key, stats[i][k]])), prev: 99, move: 99 })),
  }] };
}
const season = (d) => d.seasons[0];
const match = (d, n = 4) => season(d).matches.find((m) => m.n === n);
function options(d = archive(), n = 4, changes = {}) {
  const m = match(d, n);
  return { matchId: id(m), home: { code: m.home_code }, away: { code: m.away_code }, startsAt: START, nowMs: NOW, ...changes };
}
function accepted(d = archive(), n = 4, changes = {}) {
  const result = buildPreMatchTable(d, options(d, n, changes));
  assert.equal(result.reason, null, result.reason);
  assert.ok(result.table);
  return result.table;
}
function closed(d = archive(), changes = {}, opts = options()) {
  let result;
  assert.doesNotThrow(() => { result = buildPreMatchTable(d, { ...opts, ...changes }); });
  assert.equal(result.table, null);
  assert.ok(result.reason);
}
const columns = (t) => t.rows.map((r) => [r.code, r.position, r.played, r.gd, r.points]);
function staticOnly(t) {
  assert.equal(t.mode, 'preroll');
  for (const field of ['score', 'result', 'movements']) assert.equal(field in t, false);
  assert.equal('score' in t.home, false);
  for (const r of t.rows) {
    for (const field of ['position', 'played', 'gd', 'points'])
      assert.equal(r[field], r[`previous${field[0].toUpperCase()}${field.slice(1)}`]);
    for (const field of ['score', 'result', 'move', 'movement']) assert.equal(field in r, false);
  }
}

test('replay reconstructs BEFORE the exact fixture, excluding its result and every later result', () => {
  const d = archive(), before = structuredClone(d);
  const t = accepted(d, 2, { score: [999, 0], source: 'direct', home: { code: 'BET', score: 999 } });
  assert.deepEqual(columns(t), [['ALP', 1, 1, 2, 3], ['GAM', 2, 0, 0, 0], ['BET', 3, 1, -2, 0]]);
  assert.equal(t.basis, 'published-pre-match');
  assert.equal(t.matchId, 's3-m2_beta_gamma');
  assert.deepEqual(d, before);
  staticOnly(t);
  assert.deepEqual(columns(accepted(d, 3)), [['ALP', 1, 1, 2, 3], ['GAM', 2, 1, 0, 1], ['BET', 3, 2, -2, 1]]);
});

test('scheduled first air shows reconciled prior standings without using any caller or scheduled score', () => {
  const d = archive(), m = match(d);
  m.score = ['not', 'a result']; // Non-aired scores carry no authority at all.
  m.watch = { id: id(m) };
  const t = accepted(d, 4, { score: [-1, Infinity], source: 'schedule' });
  assert.equal(t.basis, 'scheduled-pre-match');
  assert.equal(t.generatedAt, d.generated_at);
  assert.deepEqual(columns(t), [['GAM', 1, 2, 3, 4], ['ALP', 2, 2, -1, 3], ['BET', 3, 2, -2, 1]]);
  staticOnly(t);
});

test('first ever aired replay and first scheduled fixture both permit valid zero standings', () => {
  const d = archive();
  const expected = [['ALP', 1, 0, 0, 0], ['BET', 2, 0, 0, 0], ['GAM', 3, 0, 0, 0]];
  assert.deepEqual(columns(accepted(d, 1)), expected);
  const s = season(d);
  for (const m of s.matches) { m.status = 'scheduled'; delete m.score; delete m.watch; delete m.aired_at; }
  s.aired_count = 0;
  s.table = TEAMS.map((t, i) => ({ ...t, P: 0, W: 0, D: 0, L: 0, GF: 0, GA: 0, GD: 0, Pts: 0, pos: i + 1 }));
  const t = accepted(d, 1); staticOnly(t);
  assert.deepEqual(columns(t), expected);
  closed(d, {}, options(d, 2)); // A later unplayed fixture is not an opening boundary.
});

test('aired chronology, not fixture number, orders replay prefixes; scheduled order remains strict', () => {
  const d = archive(), first = match(d, 1), second = match(d, 2);
  [first.aired_at, second.aired_at] = [second.aired_at, first.aired_at];
  assert.doesNotThrow(() => validateSeason(season(d)));
  assert.deepEqual(columns(accepted(d, 1)), [['BET', 1, 1, 0, 1], ['GAM', 2, 1, 0, 1], ['ALP', 3, 0, 0, 0]]);
  closed(d);
});

test('replay may use an old reconciled season/archive; never the current-season table', () => {
  const d = archive(); d.current_season = 4;
  assert.ok(accepted(d, 2, { nowMs: NOW + 10 * 86400000, startsAt: undefined }));
  closed(d);
});

for (const n of [2, 4]) test(`exact canonical/hash/folder identity accepted; conflicts rejected (${n})`, () => {
  const d = archive(), opts = options(d, n), canonical = opts.matchId;
  for (const changes of [
    { matchId: `${canonical}-ABCDEF012345` },
    { matchId: null, bundleUrl: `https://offline.invalid/${canonical}-abcdef/?x=1` },
    { bundleUrl: `https://offline.invalid/${canonical}/` },
  ]) assert.ok(accepted(d, n, changes));
  for (const changes of [
    { matchId: null }, { matchId: '' }, { matchId: canonical.slice(0, 6) }, { matchId: `${canonical}-abc` },
    { matchId: `${canonical}-nothex` }, { matchId: `${canonical}-${'a'.repeat(65)}` },
    { matchId: 'SDK', bundleUrl: `https://offline.invalid/${canonical}/` },
    { bundleUrl: 'not a URL' }, { bundleUrl: 'https://offline.invalid/wrong-abcdef' },
    { bundleUrl: `https://offline.invalid/${id(match(d, 1))}` },
    { home: opts.away, away: opts.home }, { home: { code: 'UNKNOWN' } }, { away: null },
  ]) closed(d, changes, opts);
});

for (const [label, mutate] of [
  ['stale', (d) => { d.generated_at = new Date(NOW - 21600001).toISOString(); }],
  ['future publication', (d) => { d.generated_at = new Date(NOW + 60001).toISOString(); }],
  ['unpublished prior result', (d) => { match(d, 3).aired_at = '2026-09-21T11:59:01Z'; }],
  ['future result', (d) => { match(d, 3).aired_at = new Date(NOW + 1).toISOString(); }],
  ['result crosses occurrence', (d) => { match(d, 3).aired_at = START; d.generated_at = START; }],
  ['not current season', (d) => { d.current_season = 2; }],
  ['missing current season', (d) => { delete d.current_season; }],
  ['string current season', (d) => { d.current_season = '3'; }],
  ['scheduled watch conflicts', (d) => { match(d).watch = { id: 'wrong' }; }],
  ['invalid slot prediction', (d) => { match(d).kickoff_utc = '2026-02-30T12:00:00Z'; }],
  ['corrupt published table', (d) => { season(d).table[0].Pts++; }],
  ['missing ledger item', (d) => { season(d).matches.pop(); }],
  ['invalid later result', (d) => { match(d, 3).score = [-1, 3]; }],
  ['duplicate season', (d) => { d.seasons.push(structuredClone(season(d))); }],
  ['duplicate team', (d) => { season(d).teams[1].code = 'ALP'; }],
  ['duplicate timestamp', (d) => { match(d, 3).aired_at = match(d, 1).aired_at; }],
  ['skipped target', (d) => { match(d).status = 'skipped'; season(d).skipped_count++; }],
  ['bad season type', (d) => { season(d).preseason = 'yes'; }],
]) test(`scheduled evidence fails closed: ${label}`, () => { const d = archive(); mutate(d); closed(d); });

test('later aired result fails scheduled boundary even when the full ledger still reconciles', () => {
  const d = archive(), s = season(d), later = match(d, 3);
  later.n = 5; later.watch.id = id(later);
  s.matches.push({ ...fixture(3, 1, 0), status: 'skipped' });
  s.total_matches++; s.skipped_count++;
  assert.doesNotThrow(() => validateSeason(s));
  closed(d);
});

test('replay also fails closed for corrupt full ledger, unpublished or future results, and bad identity', () => {
  for (const mutate of [
    (d) => { season(d).table[0].Pts++; },
    (d) => { match(d, 3).aired_at = '2026-09-21T11:59:01Z'; },
    (d) => { match(d, 3).aired_at = new Date(NOW + 1).toISOString(); d.generated_at = new Date(NOW + 1000).toISOString(); },
    (d) => { match(d, 3).watch.id = 'wrong'; },
    (d) => { d.generated_at = new Date(NOW + 60001).toISOString(); },
  ]) { const d = archive(); mutate(d); closed(d, {}, options(d, 2)); }
});

test('occurrence/clock/source evidence is required for scheduled first air', () => {
  for (const startsAt of [undefined, null, '', 'bad', '2026-02-30T12:00:00Z', '2026-09-21T12:00:00', new Date(NOW + 1).toISOString(), new Date(NOW - 7200001).toISOString()]) closed(archive(), { startsAt });
  for (const nowMs of [null, NaN, Infinity, String(NOW)]) closed(archive(), { nowMs });
  for (const source of ['direct', 'replay', null, 'unknown']) closed(archive(), { source });
  for (const age of [0, 7200000]) {
    // Keep existing aired results strictly before the occurrence boundary.
    const d = archive(); for (const m of season(d).matches) if (m.status === 'aired') m.aired_at = m.aired_at.replace('10:', '09:');
    assert.ok(accepted(d, 4, { startsAt: new Date(NOW - age).toISOString() }));
  }
});

test('archive skew/freshness boundaries are exact and allowed old results need no recent games', () => {
  for (const offset of [-21600000, 60000]) {
    const d = archive(); d.generated_at = new Date(NOW + offset).toISOString();
    for (const m of season(d).matches) if (m.status === 'aired') m.aired_at = m.aired_at.replace('10:', '05:');
    assert.ok(accepted(d));
  }
});

test('real complete M42 incident yields only pre-fixture standings; untimed scheduled tail is valid', () => {
  const incident = JSON.parse(readFileSync(new URL('./fixtures/league-first-air-m42.json', import.meta.url)));
  const d = incident.archive, item = incident.programme.item;
  const opts = { matchId: item.bundleId, bundleUrl: item.bundleUrl, home: item.home, away: item.away,
    startsAt: item.startsAt, nowMs: Date.parse(incident.programme.now), source: 'schedule' };
  const result = buildPreMatchTable(d, opts); assert.equal(result.reason, null);
  staticOnly(result.table);
  assert.deepEqual(result.table.rows.map((r) => [r.code, r.played, r.gd, r.points]), [
    ['GEM', 8, 27, 24], ['RMA', 9, 35, 21], ['DYD', 9, 6, 13], ['SYA', 8, 5, 13], ['CDX', 8, -7, 12],
    ['SGU', 7, 12, 10], ['FAB', 8, -2, 9], ['DSK', 8, -11, 9], ['MSP', 6, -17, 2], ['GLM', 7, -48, 0],
  ]);
  const gap = structuredClone(d), skipped = gap.seasons[0].matches.find((m) => m.n === 40);
  skipped.status = 'scheduled'; gap.seasons[0].skipped_count--;
  assert.doesNotThrow(() => validateSeason(gap.seasons[0]));
  assert.equal(buildPreMatchTable(gap, opts).table, null);
  const badSlots = structuredClone(d), pending = badSlots.seasons[0].matches.filter((m) => m.status === 'scheduled');
  pending[1].kickoff_utc = pending[0].kickoff_utc;
  assert.equal(buildPreMatchTable(badSlots, opts).table, null);
});

test('malformed input returns diagnostics, never throws into a render loop', () => {
  for (const d of [null, {}, { seasons: null }, { generated_at: START, seasons: [null] }]) closed(d);
  assert.equal(buildPreMatchTable(archive()).table, null);
});
