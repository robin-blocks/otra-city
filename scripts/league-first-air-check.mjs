// Offline regression for the 2026-09-21 S3 M42 archive-publication race.
// Run: node --test scripts/league-first-air-check.mjs
// No live URLs are fetched; the checked-in fixture preserves the COMPLETE
// season ledger, not the rolling programme. Expected standings are hand-worked.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildMatchTable, validateSeason } from '../public/js/league-table-data.mjs';
import { createPostMatchTable, TABLE_DURATION_S } from '../public/js/post-match-table.mjs';

const INCIDENT = JSON.parse(readFileSync(new URL('./fixtures/league-first-air-m42.json', import.meta.url), 'utf8'));
const clone = (x) => structuredClone(x);
const archive = () => clone(INCIDENT.archive);
const season = (doc) => doc.seasons[0];
const fixture = (doc, n = 42) => season(doc).matches.find((m) => m.n === n);
const ITEM = INCIDENT.programme.item;
const NOW = Date.parse(INCIDENT.programme.now);
const FINAL = INCIDENT.hud.score.at(-1);
const FULL = INCIDENT.hud.clock.buzzers.find((b) => b.kind === 'full');
const ID = ITEM.bundleId;
const score = [FINAL.a, FINAL.b];
const evidence = (changes = {}) => ({ startsAt: ITEM.startsAt, nowMs: NOW, ...changes });
function options(changes = {}) {
  return { matchId: ID, bundleUrl: ITEM.bundleUrl, home: clone(ITEM.home), away: clone(ITEM.away),
    score: score.slice(), firstAir: evidence(), ...changes };
}
function accepted(doc = archive(), changes = {}) {
  const result = buildMatchTable(doc, options(changes));
  assert.equal(result.reason, null, result.reason);
  assert.ok(result.table, 'verified first-air result must produce a table');
  return result.table;
}
function closed(doc = archive(), changes = {}) {
  let result;
  assert.doesNotThrow(() => { result = buildMatchTable(doc, options(changes)); });
  assert.equal(result.table, null, 'unverified standings must fail closed');
  assert.equal(typeof result.reason, 'string');
  assert.ok(result.reason.length, 'a rejected archive/evidence must be diagnosable');
}
const columns = (table) => table.rows.map((r) => [r.code, r.position, r.previousPosition,
  r.played, r.previousPlayed, r.gd, r.previousGd, r.points, r.previousPoints]);
// code, position, previous position, P, previous P, GD, previous GD, points, previous points.
// SYA: 8 -> 9 played, GF 44+3=47, GA 39+6=45, GD 5-3=2, points remain 13.
// SGU: 7 -> 8 played, GF 48+6=54, GA 36+3=39, GD 12+3=15, points 10+3=13.
// The 13-point tie is consequently SGU(+15), DYD(+6), SYA(+2).
const EXPECTED = [
  ['GEM', 1, 1, 8, 8, 27, 27, 24, 24],
  ['RMA', 2, 2, 9, 9, 35, 35, 21, 21],
  ['SGU', 3, 6, 8, 7, 15, 12, 13, 10],
  ['DYD', 4, 3, 9, 9, 6, 6, 13, 13],
  ['SYA', 5, 4, 9, 8, 2, 5, 13, 13],
  ['CDX', 6, 5, 8, 8, -7, -7, 12, 12],
  ['FAB', 7, 7, 8, 8, -2, -2, 9, 9],
  ['DSK', 8, 8, 8, 8, -11, -11, 9, 9],
  ['MSP', 9, 9, 6, 6, -17, -17, 2, 2],
  ['GLM', 10, 10, 7, 7, -48, -48, 0, 0],
];
// Independent official table after publication: code, P,W,D,L,GF,GA,GD,Pts,pos.
// Deliberately NOT generated with production validate/rank/apply helpers.
const PUBLISHED_STATS = [
  ['GEM', 8, 8, 0, 0, 59, 32, 27, 24, 1],
  ['RMA', 9, 7, 0, 2, 71, 36, 35, 21, 2],
  ['SGU', 8, 4, 1, 3, 54, 39, 15, 13, 3],
  ['DYD', 9, 4, 1, 4, 56, 50, 6, 13, 4],
  ['SYA', 9, 4, 1, 4, 47, 45, 2, 13, 5],
  ['CDX', 8, 4, 0, 4, 38, 45, -7, 12, 6],
  ['FAB', 8, 2, 3, 3, 41, 43, -2, 9, 7],
  ['DSK', 8, 3, 0, 5, 42, 53, -11, 9, 8],
  ['MSP', 6, 0, 2, 4, 29, 46, -17, 2, 9],
  ['GLM', 7, 0, 0, 7, 18, 66, -48, 0, 10],
];
function published() {
  const doc = archive(), s = season(doc);
  doc.generated_at = '2026-09-21T11:17:00Z';
  Object.assign(fixture(doc), { status: 'aired', score: score.slice(),
    aired_at: '2026-09-21T11:16:00Z', watch: { id: ID } });
  s.aired_count = 40;
  s.table = PUBLISHED_STATS.map(([code, ...values]) => ({
    ...s.table.find((r) => r.code === code),
    ...Object.fromEntries(['P', 'W', 'D', 'L', 'GF', 'GA', 'GD', 'Pts', 'pos'].map((k, i) => [k, values[i]])),
  }));
  return doc;
}
function publishedOptions(doc, n) {
  const m = fixture(doc, n);
  return { matchId: m.watch.id, bundleUrl: undefined, home: { code: m.home_code },
    away: { code: m.away_code }, score: m.score, firstAir: null };
}

// DATA CONTRACT ------------------------------------------------------------
test('saved incident retains all 90 fixtures, 39 results, skips, configured teams and the exporter horizon', () => {
  const doc = archive(), s = season(doc);
  assert.equal(doc.current_season, 3);
  assert.equal(doc.generated_at, '2026-09-21T10:59:49+00:00');
  assert.equal(s.matches.length, 90);
  assert.equal(s.teams.length, 10);
  assert.equal(s.skipped_count, 6);
  assert.equal(validateSeason(s).aired.length, 39);
  assert.equal(fixture(doc).status, 'scheduled');
  assert.equal(fixture(doc).watch, undefined);
  assert.equal(fixture(doc).score, undefined);
  assert.equal(fixture(doc, 40).status, 'skipped');
  const scheduled = s.matches.filter((m) => m.status === 'scheduled');
  assert.equal(scheduled.filter((m) => m.kickoff_utc).length, 12);
  assert.ok(scheduled.some((m) => m.n > 56 && !m.kickoff_utc));
  assert.deepEqual(score, [3, 6]);
  assert.equal(FULL.play_end_t, 622);
  assert.notEqual(ITEM.startsAt, fixture(doc).kickoff_utc, 'programme occurrence is not the predicted kickoff');
});

test('M42 first air gives SGU 6→3 and SYA 4→5 with honest, timestamped provenance', () => {
  const doc = archive(), before = clone(doc), opts = options(), optsBefore = clone(opts);
  const { table, reason } = buildMatchTable(doc, opts);
  assert.equal(reason, null);
  assert.ok(table);
  assert.equal(table.matchId, ID);
  assert.equal(table.basis, 'first-air-hud');
  assert.equal(table.sourceLabel, 'RFL · Including this result');
  assert.equal(table.generatedAt, doc.generated_at);
  assert.equal(table.label, 'SEASON 3');
  assert.deepEqual(table.score, [3, 6]);
  assert.deepEqual(columns(table), EXPECTED);
  assert.deepEqual(doc, before, 'applying the HUD score must not publish it into the archive');
  assert.deepEqual(opts, optsBefore, 'caller evidence and HUD must remain unmodified');
  assert.deepEqual(columns(accepted(doc)), EXPECTED, 'repeated assessment must not count the HUD score twice');
});

test('unsorted ledger and bogus round movements do not change the actual first-air boundary', () => {
  const doc = archive();
  season(doc).matches.reverse();
  for (const r of season(doc).table) { r.prev = 999; r.move = -999; }
  assert.deepEqual(columns(accepted(doc)), EXPECTED);
});

test('scheduled canonical, valid hash and exact bundle folder identities are accepted with evidence', () => {
  for (const changes of [
    { bundleUrl: undefined },
    { matchId: `${ID}-ABCDEF0123456789`, bundleUrl: undefined },
    { matchId: `${ID}-${'a'.repeat(64)}`, bundleUrl: undefined },
    { matchId: null },
    { matchId: undefined, bundleUrl: `https://offline.invalid/bundles/${ID}/?x=1` },
  ]) assert.deepEqual(columns(accepted(archive(), changes)), EXPECTED);
});

for (const firstAir of [undefined, null, false, {}, { startsAt: ITEM.startsAt }, { nowMs: NOW }]) {
  test(`scheduled/no-watch path requires explicit complete firstAir evidence: ${JSON.stringify(firstAir)}`, () => {
    closed(archive(), { firstAir });
  });
}
for (const startsAt of ['', 'badZ', '2026-09-21T11:01:42', '2026-02-30T11:01:42Z', null, NOW]) {
  test(`invalid occurrence timestamp rejected: ${JSON.stringify(startsAt)}`, () => {
    closed(archive(), { firstAir: evidence({ startsAt }) });
  });
}
for (const nowMs of [undefined, null, NaN, Infinity, -Infinity, String(NOW)]) {
  test(`nonfinite/nonnumeric update clock rejected: ${String(nowMs)}`, () => {
    closed(archive(), { firstAir: evidence({ nowMs }) });
  });
}

test('occurrence age boundaries: start now and exactly two hours ago accepted, future/older rejected', () => {
  for (const age of [0, 2 * 3600000]) {
    assert.deepEqual(columns(accepted(archive(), { firstAir: evidence({ startsAt: new Date(NOW - age).toISOString() }) })), EXPECTED);
  }
  for (const age of [-1, 2 * 3600000 + 1]) {
    closed(archive(), { firstAir: evidence({ startsAt: new Date(NOW - age).toISOString() }) });
  }
});

test('archive age boundaries: exactly six hours and 60s future skew accepted, one millisecond beyond rejected', () => {
  for (const delta of [-6 * 3600000, 60000]) {
    const doc = archive(); doc.generated_at = new Date(NOW + delta).toISOString();
    assert.deepEqual(columns(accepted(doc)), EXPECTED);
  }
  for (const delta of [-6 * 3600000 - 1, 60001]) {
    const doc = archive(); doc.generated_at = new Date(NOW + delta).toISOString();
    closed(doc);
  }
});

for (const current of [undefined, null, '3', 2, 4]) {
  test(`first air requires exact current season: ${JSON.stringify(current)}`, () => {
    const doc = archive(); doc.current_season = current; closed(doc);
  });
}

test('missing predicted kickoff on target/all pending tail is permitted; supplied slots remain ordered by n', () => {
  const doc = archive();
  for (const m of season(doc).matches) if (m.status === 'scheduled') delete m.kickoff_utc;
  assert.deepEqual(columns(accepted(doc)), EXPECTED);
});
for (const [name, mutate] of [
  ['bad target date', (d) => { fixture(d).kickoff_utc = 'not-a-date'; }],
  ['timezone-free target date', (d) => { fixture(d).kickoff_utc = '2026-09-21T11:00:00'; }],
  ['impossible tail date', (d) => { fixture(d, 90).kickoff_utc = '2026-02-30T11:00:00Z'; }],
  ['equal later slot', (d) => { fixture(d, 43).kickoff_utc = fixture(d).kickoff_utc; }],
  ['backwards later slot', (d) => { fixture(d, 43).kickoff_utc = '2026-09-21T10:00:00Z'; }],
  ['backwards distant supplied slot', (d) => { fixture(d, 90).kickoff_utc = fixture(d, 56).kickoff_utc; }],
]) test(`contradictory scheduled kickoff fails closed: ${name}`, () => { const doc = archive(); mutate(doc); closed(doc); });

test('another earlier scheduled fixture is a genuine gap even when the official table fully reconciles', () => {
  const doc = archive(), m = fixture(doc, 40);
  m.status = 'scheduled'; delete m.skipped_at; delete m.skipped_reason;
  season(doc).skipped_count--;
  assert.doesNotThrow(() => validateSeason(season(doc)));
  closed(doc);
});

test('later aired fixture invalidates first air despite exact full-season reconciliation', () => {
  const doc = archive(), earlier = fixture(doc, 41), later = fixture(doc, 43);
  // Move the existing, scored RMA/DYD fixture past M42 without altering totals.
  earlier.n = 43; earlier.watch.id = 's3-m43_real_machina_dynamo_datacenter';
  later.n = 41; later.status = 'skipped'; delete later.kickoff_utc;
  season(doc).skipped_count++;
  assert.doesNotThrow(() => validateSeason(season(doc)));
  closed(doc);
});

test('aired chronology must ascend fixture numbers only on first-air path; historical replay keeps aired chronology', () => {
  const doc = archive(), first = fixture(doc, 1), second = fixture(doc, 2);
  [first.aired_at, second.aired_at] = [second.aired_at, first.aired_at];
  assert.doesNotThrow(() => validateSeason(season(doc)));
  closed(doc);
  const result = accepted(doc, publishedOptions(doc, 2));
  assert.equal(result.basis, 'published-result');
  assert.equal(result.rows.reduce((sum, r) => sum + r.played, 0), 2, 'M2 is first in the reordered published chronology');
});

test('a skipped target never becomes an invented HUD result', () => {
  const doc = archive(); fixture(doc).status = 'skipped'; season(doc).skipped_count++;
  closed(doc);
});

test('optional scheduled watch/score may agree, but cannot supply authority without firstAir', () => {
  const doc = archive(); Object.assign(fixture(doc), { watch: { id: ID }, score: [3, 6] });
  assert.deepEqual(columns(accepted(doc)), EXPECTED);
  closed(doc, { firstAir: null });
});
for (const [name, mutate] of [
  ['different score', (m) => { m.score = [3, 5]; }],
  ['reversed score', (m) => { m.score = [6, 3]; }],
  ['string score', (m) => { m.score = ['3', 6]; }],
  ['partial score', (m) => { m.score = [3]; }],
  ['wrong watch id', (m) => { m.watch = { id: 's3-m43_frontier_fable_frontier_deepseek' }; }],
  ['hashed watch id', (m) => { m.watch = { id: `${ID}-abcdef` }; }],
  ['empty watch', (m) => { m.watch = {}; }],
]) test(`supplied scheduled metadata must agree: ${name}`, () => { const doc = archive(); mutate(fixture(doc)); closed(doc); });

for (const badId of ['', 's3-m4_synthetic_athletic_singularity_united', 's3-m420_synthetic_athletic_singularity_united',
  's3-m42', 'm42', `${ID}-abc`, `${ID}-nothex`, `${ID}-${'a'.repeat(65)}`, `${ID}-abcdef-extra`]) {
  test(`partial or invalid scheduled identity rejected: ${JSON.stringify(badId)}`, () => {
    closed(archive(), { matchId: badId, bundleUrl: undefined });
  });
}

test('conflicting/ambiguous IDs and bundle folders cannot choose a first-air fixture', () => {
  const other = fixture(archive(), 43);
  const otherId = `s3-m43_${other.home}_${other.away}`;
  closed(archive(), { bundleUrl: `https://offline.invalid/${otherId}-abcdef/` });
  closed(archive(), { bundleUrl: 'https://offline.invalid/unrelated-abcdef/' });
  closed(archive(), { bundleUrl: 'not a URL' });
  closed(archive(), { matchId: 'direct-sdk' });
  const duplicate = archive(); duplicate.seasons.push(clone(season(duplicate))); closed(duplicate);
});

for (const changes of [
  { score: null }, { score: [-1, 6] }, { score: [3.5, 6] }, { score: [NaN, 6] },
  { score: [Infinity, 6] }, { score: ['3', 6] }, { score: [3, 6, 0] },
  { home: ITEM.away, away: ITEM.home }, { home: { code: 'UNKNOWN' } }, { away: undefined },
]) test(`invalid final HUD fails closed: ${JSON.stringify(changes)}`, () => closed(archive(), changes));

for (const [name, mutate] of [
  ['missing fixture', (s) => s.matches.pop()],
  ['wrong total', (s) => s.total_matches++],
  ['wrong aired count', (s) => s.aired_count++],
  ['wrong skipped count', (s) => s.skipped_count--],
  ['duplicate fixture number', (s) => { s.matches[1].n = s.matches[0].n; }],
  ['bad aired identity', (s) => { s.matches.find((m) => m.status === 'aired').watch.id = 'wrong'; }],
  ['missing aired score', (s) => { delete s.matches.find((m) => m.status === 'aired').score; }],
  ['missing aired date', (s) => { delete s.matches.find((m) => m.status === 'aired').aired_at; }],
  ['duplicate aired dates', (s) => { const [a, b] = s.matches.filter((m) => m.status === 'aired'); b.aired_at = a.aired_at; }],
  ['unknown fixture team', (s) => { s.matches.at(-1).home = 'missing'; }],
  ['duplicate team', (s) => { s.teams[1] = clone(s.teams[0]); }],
  ['missing official row', (s) => s.table.pop()],
]) test(`first air still validates the entire season: ${name}`, () => { const doc = archive(); mutate(season(doc)); closed(doc); });
for (const stat of ['P', 'W', 'D', 'L', 'GF', 'GA', 'GD', 'Pts', 'pos']) {
  test(`first air reconciles official ${stat}, including uninvolved teams`, () => {
    const doc = archive(); season(doc).table.find((r) => r.code === 'GLM')[stat]++; closed(doc);
  });
}

test('published transition uses independent official stats and never double-counts M42', () => {
  const doc = published();
  assert.equal(validateSeason(season(doc)).aired.length, 40);
  for (const firstAir of [null, evidence(), { startsAt: 'invalid', nowMs: NaN }]) {
    const table = accepted(doc, { firstAir });
    assert.equal(table.basis, 'published-result');
    assert.equal(table.sourceLabel, 'RFL · Aired results');
    assert.equal(table.generatedAt, doc.generated_at);
    assert.deepEqual(columns(table), EXPECTED);
  }
});

test('published score mismatch is never bypassed by valid first-air evidence', () => {
  closed(published(), { score: [3, 5] });
  closed(published(), { score: [6, 3] });
});

test('old published/current-season-independent path and direct hash replay stay supported', () => {
  const doc = published(); doc.current_season = 99; doc.generated_at = '2026-09-22T00:00:00Z';
  for (const changes of [
    { firstAir: null, matchId: `${ID}-ABCDEF`, bundleUrl: undefined },
    { firstAir: evidence({ nowMs: NOW + 365 * 86400000 }) },
    { firstAir: null, matchId: 'direct-sdk' },
  ]) {
    const table = accepted(doc, changes);
    assert.equal(table.basis, 'published-result');
    assert.deepEqual(columns(table), EXPECTED);
  }
});

// CONTROLLER CONTRACT ------------------------------------------------------
// Every I/O operation is injected. setImmediate drains fetch + json promises;
// there are no wall-clock waits, browser requirements, or network dependencies.
const flush = () => new Promise((resolve) => setImmediate(resolve));
function mounted() {
  return { phase: 'match', source: 'schedule', loops: 0,
    match: { id: ID, bundleUrl: ITEM.bundleUrl, state: ITEM.state, startsAt: ITEM.startsAt },
    bug: { t: FULL.play_end_t, over: true, preroll: false, inPlay: false, replay: false,
      home: clone(ITEM.home), away: clone(ITEM.away), a: FINAL.a, b: FINAL.b },
    ball: { speed: 0, measured: true }, headcam: false, clockPlan: clone(INCIDENT.hud.clock) };
}
function harness(fetcher = async () => ({ ok: true, json: async () => archive() })) {
  const calls = [];
  const controller = createPostMatchTable({ url: 'https://offline.invalid/league.json',
    fetcher: (...args) => { calls.push(args); return fetcher(...args); } });
  const h = { controller, calls, match: mounted(),
    frame(time, changes = {}) {
      return controller.update({ match: h.match, camera: 'heli', settling: false,
        time, nowMs: NOW + time * 1000, ...changes });
    },
    async prime() {
      assert.equal(h.frame(0, { match: { ...h.match, bug: { ...h.match.bug, over: false, t: 600 } } }), null);
      await flush();
      assert.equal(calls.length, 1);
    },
  };
  return h;
}
function hidden(h, time, changes = {}) {
  assert.equal(h.frame(time, changes), null);
  assert.equal(h.controller.state().visible, false);
}
function visible(h, time, changes = {}) {
  const frame = h.frame(time, changes);
  assert.ok(frame, JSON.stringify(h.controller.state()));
  assert.equal(h.controller.state().visible, true);
  assert.deepEqual(columns(frame.presentation), EXPECTED);
  return frame;
}
async function onAir(h) {
  await h.prime(); hidden(h, 0); return visible(h, 0.7);
}

test('controller cold-loads the incident at full time and waits for the safe aerial cue', async () => {
  const h = harness();
  hidden(h, 0); await flush(); hidden(h, 0.699);
  const frame = visible(h, 0.7);
  assert.equal(frame.presentation.basis, 'first-air-hud');
  assert.equal(h.controller.state().basis, 'first-air-hud');
  assert.equal(h.controller.state().generatedAt, INCIDENT.archive.generated_at);
  assert.deepEqual(h.controller.state().movements, [
    { code: 'SGU', from: 6, to: 3, change: 3 }, { code: 'SYA', from: 4, to: 5, change: -1 },
  ]);
});

test('prime during play then cue only after full publisher play_end_t, once for 54 seconds', async () => {
  const h = harness(); await h.prime();
  hidden(h, 0); hidden(h, 0.699); visible(h, 0.7);
  assert.equal(TABLE_DURATION_S, 54);
  for (const t of [18.7, 25.01, 45.7, 54.699]) visible(h, t);
  hidden(h, 54.7); hidden(h, 59);
  assert.equal(h.calls.length, 1);
});

for (const [name, mutate, changes = {}] of [
  ['pre-roll', (m) => { m.bug.preroll = true; }],
  ['half-time', (m) => { m.bug.over = false; m.bug.half = 1; }],
  ['active play', (m) => { m.bug.inPlay = true; }],
  ['unknown play state', (m) => { delete m.bug.inPlay; }],
  ['moving ball', (m) => { m.ball.speed = 0.61; }],
  ['invalid measurement', (m) => { m.ball.speed = NaN; }],
  ['negative measurement', (m) => { m.ball.speed = -1; }],
  ['replay flag', (m) => { m.bug.replay = true; }],
  ['headcam', (m) => { m.headcam = true; }],
  ['settling camera', () => {}, { settling: true }],
  ['wrong aerial', () => {}, { camera: 'wide' }],
  ['full-time flag early despite stopped measured ball', (m) => { m.bug.t = FULL.play_end_t - 0.001; }],
  ['ordinary buzzer time rather than full play end', (m) => { m.bug.t = FULL.t; }],
  ['missing full publisher cue', (m) => { m.clockPlan.buzzers = m.clockPlan.buzzers.filter((b) => b.kind !== 'full'); }],
  ['missing clock plan', (m) => { delete m.clockPlan; }],
  ['invalid full play end', (m) => { m.clockPlan.buzzers.find((b) => b.kind === 'full').play_end_t = NaN; }],
]) test(`first-air controller cannot paint during ${name}`, async () => {
  const h = harness(); await h.prime(); mutate(h.match);
  for (const t of [0, 0.7, 10, 26]) hidden(h, t, changes);
});

for (const [source, state] of [['now', 'live'], ['direct', 'live'], [undefined, 'live'],
  ['schedule', 'replay'], ['schedule', 'upcoming'], ['schedule', undefined]]) {
  test(`no first-air authority for source=${source}, state=${state}`, async () => {
    const h = harness(); await h.prime(); h.match.source = source; h.match.match.state = state;
    for (const t of [0, 0.7, 10]) hidden(h, t);
  });
}

test('controller requires occurrence startsAt retained on mounted match, not a top-level schedule guess', async () => {
  const h = harness(); await h.prime();
  delete h.match.match.startsAt; h.match.startsAt = ITEM.startsAt;
  hidden(h, 0); hidden(h, 0.7);
});

test('controller uses update nowMs rather than Date.now or the simulation time for occurrence evidence', async () => {
  const h = harness(); await h.prime();
  const beforeOccurrence = Date.parse(ITEM.startsAt) - 1;
  hidden(h, 0, { nowMs: beforeOccurrence }); hidden(h, 0.7, { nowMs: beforeOccurrence });
  // The negative assessment must be reconsidered as wall time becomes valid,
  // even with no archive revision or scoreboard change.
  visible(h, 1, { nowMs: NOW });
});

test('old mounted occurrence is not made current merely by refreshing an archive', async () => {
  const h = harness(); await h.prime();
  h.match.match.startsAt = new Date(NOW - 2 * 3600000 - 1).toISOString();
  hidden(h, 0); hidden(h, 0.7);
});

test('publisher rest is a fallback for absent/unmeasured camera ball speed', async () => {
  for (const ball of [null, undefined, { speed: 0, measured: false }]) {
    const h = harness(); await h.prime(); h.match.ball = ball;
    hidden(h, 0); visible(h, 0.7);
  }
});

test('no measured ball and no supplier rest proof cannot cue even with final HUD flags', async () => {
  const h = harness(); await h.prime(); delete h.match.ball; delete h.match.clockPlan;
  hidden(h, 0); hidden(h, 0.7); hidden(h, 24);
});

test('published result also rejects bug.t before the actual publisher play_end_t', async () => {
  const h = harness(async () => ({ ok: true, json: async () => published() }));
  await h.prime(); h.match.bug.t = FULL.play_end_t - 0.001;
  hidden(h, 0); hidden(h, 0.7); hidden(h, 10);
});

test('published direct/now replay is allowed, but published score mismatch cannot fall through to first air', async () => {
  for (const source of ['direct', 'now', 'schedule']) {
    const h = harness(async () => ({ ok: true, json: async () => published() }));
    h.match.source = source; h.match.match.state = 'replay';
    const frame = await onAir(h);
    assert.equal(frame.presentation.basis, 'published-result');
    assert.equal(h.controller.state().basis, 'published-result');
  }
  const mismatch = harness(async () => ({ ok: true, json: async () => published() }));
  await mismatch.prime(); mismatch.match.bug.b = 5;
  hidden(mismatch, 0); hidden(mismatch, 0.7);
});

test('publishing while first-air table is on-air cannot replace its rows, basis, label or generatedAt', async () => {
  let calls = 0, deliver;
  const h = harness(() => ++calls === 1
    ? Promise.resolve({ ok: true, json: async () => archive() })
    : new Promise((resolve) => { deliver = resolve; }));
  const first = await onAir(h), snapshot = clone(first.presentation);
  visible(h, 1, { nowMs: NOW + 60000 });
  assert.equal(h.calls.length, 2);
  deliver({ ok: true, json: async () => published() }); await flush();
  const held = visible(h, 2, { nowMs: NOW + 61000 });
  assert.deepEqual(held.presentation, snapshot);
  assert.equal(h.controller.state().basis, 'first-air-hud');
  assert.equal(h.controller.state().generatedAt, snapshot.generatedAt);
  assert.equal(held.presentation.sourceLabel, 'RFL · Including this result');
  // A fresh mount after the once-only interval uses the published basis with
  // the same hand-calculated before/after columns, never one extra result.
  h.match.loops++;
  hidden(h, 3, { nowMs: NOW + 62000 });
  const next = visible(h, 3.71, { nowMs: NOW + 62710 });
  assert.equal(next.presentation.basis, 'published-result');
  assert.equal(h.controller.state().generatedAt, published().generated_at);
});

test('source changes after a failed first-air assessment are re-evaluated before the cue window closes', async () => {
  const h = harness(); await h.prime(); h.match.source = 'now';
  hidden(h, 0); hidden(h, 0.7);
  h.match.source = 'schedule'; visible(h, 1);
});

test('unsafe interval resets the cue, and resuming play clears an on-air first-air result', async () => {
  const h = harness(); await h.prime(); hidden(h, 0);
  hidden(h, 0.5, { settling: true }); hidden(h, 0.6); hidden(h, 1.29);
  visible(h, 1.31);
  h.match.bug.inPlay = true; hidden(h, 2);
  h.match.bug.inPlay = false; hidden(h, 3);
});

test('late first-air data never flashes after the 25s cue window', async () => {
  let deliver;
  const h = harness(() => new Promise((resolve) => { deliver = resolve; }));
  hidden(h, 0); await flush(); hidden(h, 25.01);
  deliver({ ok: true, json: async () => archive() }); await flush();
  hidden(h, 26); hidden(h, 30);
});

test('unavailable archive has no synthetic first-air fallback or render-loop retry storm', async () => {
  const h = harness(async () => { throw new Error('offline fixture unavailable'); });
  hidden(h, 0); await flush();
  for (const t of [0.7, 1, 10, 24.9, 26, 59]) hidden(h, t);
  assert.equal(h.calls.length, 1);
  hidden(h, 60); await flush(); assert.equal(h.calls.length, 2);
});

for (const generated_at of [undefined, null, '', 'badZ', '2026-09-21T10:59:49', '2026-02-30T10:59:49Z']) {
  test(`first air rejects invalid archive generation timestamp: ${JSON.stringify(generated_at)}`, () => {
    const doc = archive(); doc.generated_at = generated_at; closed(doc);
  });
}

test('programme feed advancing to the next fixture cannot replace mounted occurrence evidence', async () => {
  const h = harness();
  h.match.live = { bundleId: 's3-m43_frontier_fable_frontier_deepseek', state: 'upcoming',
    startsAt: '2026-09-21T15:01:42.000Z' };
  const frame = await onAir(h);
  assert.equal(frame.presentation.matchId, ID);
  assert.equal(frame.presentation.basis, 'first-air-hud');
});

test('losing live programme authority before the cue invalidates an assessed but not yet on-air table', async () => {
  const h = harness(); await h.prime(); hidden(h, 0);
  h.match.match.state = 'replay'; hidden(h, 0.7);
});

test('changing mounted identity before cue cannot reuse an assessment cached for a different hash folder', async () => {
  const h = harness(); await h.prime(); hidden(h, 0);
  h.match.match.bundleUrl = 'https://offline.invalid/unrelated-abcdef/';
  hidden(h, 0.7);
});

for (const kind of ['occurrence', 'archive']) {
  test(`${kind} evidence expiring within one wall-clock second is rechecked at cue, not rounded/cached`, async () => {
    const doc = archive();
    const now = Math.floor(NOW / 1000) * 1000 + 100;
    const expires = now + 350;
    if (kind === 'archive') doc.generated_at = new Date(expires - 6 * 3600000).toISOString();
    const h = harness(async () => ({ ok: true, json: async () => doc }));
    if (kind === 'occurrence') h.match.match.startsAt = new Date(expires - 2 * 3600000).toISOString();
    // The archive is loaded and the first assessment succeeds 350ms before
    // expiry. A real 700ms cue delay crosses expiry, within the SAME second.
    hidden(h, 0, { nowMs: now }); await flush(); hidden(h, 0, { nowMs: now });
    hidden(h, 0.7, { nowMs: now + 700 });
  });
}
