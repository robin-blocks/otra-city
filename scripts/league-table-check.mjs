// Offline contract tests. Run: node --test scripts/league-table-check.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMatchTable, validateSeason } from '../public/js/league-table-data.mjs';
import { createPostMatchTable, TABLE_DURATION_S } from '../public/js/post-match-table.mjs';

const TEAMS = [
  { slug: 'alpha', code: 'ALP', name: 'Alpha', color: '#aa0000' },
  { slug: 'beta', code: 'BET', name: 'Beta', color: '#00aa00' },
  { slug: 'gamma', code: 'GAM', name: 'Gamma', color: '#0000aa' },
  { slug: 'delta', code: 'DEL', name: 'Delta', color: '#aaaa00' },
];
const clone = (value) => structuredClone(value);
const fixtureId = (n, home, away) => `s9-m${n}_${home}_${away}`;
function fixture(n, home, away, score, status = 'aired') {
  return {
    n, home, away, score, status,
    home_code: TEAMS.find((t) => t.slug === home).code,
    away_code: TEAMS.find((t) => t.slug === away).code,
    aired_at: status === 'aired' ? `2026-01-01T12:00:0${n}Z` : null,
    watch: { id: fixtureId(n, home, away) },
  };
}
function official(slug, P, W, D, L, GF, GA, GD, Pts, pos) {
  return { ...TEAMS.find((t) => t.slug === slug), P, W, D, L, GF, GA, GD, Pts, pos,
    // Deliberately bogus round-level movement must never enter the snapshot.
    prev: 99, move: -99 };
}
function archive() {
  return {
    generated_at: '2026-01-02T00:00:00Z',
    seasons: [{
      season: 9, preseason: false, teams: clone(TEAMS), total_matches: 8,
      aired_count: 6, skipped_count: 1,
      // Deliberately not sorted by fixture number or aired time.
      matches: [
        fixture(4, 'delta', 'alpha', [3, 0]),
        fixture(2, 'gamma', 'delta', [2, 1]),
        fixture(8, 'beta', 'delta', null, 'skipped'),
        fixture(1, 'alpha', 'beta', [1, 0]),
        fixture(6, 'gamma', 'delta', [0, 1]),
        fixture(3, 'beta', 'gamma', [2, 2]),
        fixture(7, 'alpha', 'gamma', null, 'scheduled'),
        fixture(5, 'alpha', 'beta', [1, 0]),
      ],
      // Hand-calculated final standings; no production ranking helper is used.
      table: [
        official('delta', 3, 2, 0, 1, 5, 2, 3, 6, 1),
        official('alpha', 3, 2, 0, 1, 2, 3, -1, 6, 2),
        official('gamma', 3, 1, 1, 1, 4, 4, 0, 4, 3),
        official('beta', 3, 0, 1, 2, 2, 4, -2, 1, 4),
      ],
    }],
  };
}
const matchIn = (doc, n) => doc.seasons[0].matches.find((m) => m.n === n);
function identity(doc = archive(), n = 4) {
  const m = matchIn(doc, n);
  return { matchId: m.watch.id, home: { code: m.home_code }, away: { code: m.away_code }, score: clone(m.score) };
}
function tableFor(doc = archive(), n = 4, changes = {}) {
  const result = buildMatchTable(doc, { ...identity(doc, n), ...changes });
  assert.equal(result.reason, null);
  assert.ok(result.table, 'a verified result must produce a table');
  return result.table;
}
const stats = (table) => table.rows.map((r) => ({
  code: r.code, position: r.position, previousPosition: r.previousPosition,
  played: r.played, previousPlayed: r.previousPlayed, gd: r.gd,
  previousGd: r.previousGd, points: r.points, previousPoints: r.previousPoints,
}));
const row = (code, position, previousPosition, played, previousPlayed, gd, previousGd, points, previousPoints) =>
  ({ code, position, previousPosition, played, previousPlayed, gd, previousGd, points, previousPoints });
function closed(doc, options = identity()) {
  let result;
  assert.doesNotThrow(() => { result = buildMatchTable(doc, options); });
  assert.equal(result.table, null, 'unverified standings must fail closed');
  assert.equal(typeof result.reason, 'string');
  assert.ok(result.reason.length > 0, 'failure must be diagnosable');
}

test('complete ledger reconciles all published statistics and orders unique aired timestamps', () => {
  const doc = archive();
  const before = clone(doc);
  const validated = validateSeason(doc.seasons[0]);
  assert.deepEqual(validated.aired.map((m) => m.n), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(stats(tableFor(doc, 6)), [
    row('DEL', 1, 3, 3, 2, 3, 2, 6, 3),
    row('ALP', 2, 1, 3, 3, -1, -1, 6, 6),
    row('GAM', 3, 2, 3, 2, 0, 1, 4, 4),
    row('BET', 4, 4, 3, 3, -2, -2, 1, 1),
  ]);
  assert.deepEqual(doc, before, 'validation and ranking must not mutate the archive');
});

test('m4 snapshot excludes later results and shows genuine up/down/no movement', () => {
  const table = tableFor();
  assert.equal(table.matchId, 's9-m4_delta_alpha');
  assert.equal(table.label, 'SEASON 9');
  assert.deepEqual(table.score, [3, 0]);
  assert.deepEqual(stats(table), [
    row('GAM', 1, 1, 2, 2, 1, 1, 4, 4),
    row('DEL', 2, 4, 2, 1, 2, -1, 3, 0),
    row('ALP', 3, 2, 2, 1, -2, 1, 3, 3),
    row('BET', 4, 3, 2, 2, -1, -1, 1, 1),
  ]);
});

test('first match starts from configured positions, awards three points, excludes all later games', () => {
  assert.deepEqual(stats(tableFor(archive(), 1)), [
    row('ALP', 1, 1, 1, 0, 1, 0, 3, 0),
    row('GAM', 2, 3, 0, 0, 0, 0, 0, 0),
    row('DEL', 3, 4, 0, 0, 0, 0, 0, 0),
    row('BET', 4, 2, 1, 0, -1, 0, 0, 0),
  ]);
});

test('a draw awards exactly one point and one played match to each participant', () => {
  assert.deepEqual(stats(tableFor(archive(), 3)), [
    row('GAM', 1, 1, 2, 1, 1, 1, 4, 3),
    row('ALP', 2, 2, 1, 1, 1, 1, 3, 3),
    row('BET', 3, 4, 2, 1, -1, -1, 1, 0),
    row('DEL', 4, 3, 1, 1, -1, -1, 0, 0),
  ]);
});

test('equal points and GD use goals for, not alphabetical or configured order', () => {
  const table = tableFor(archive(), 2);
  assert.deepEqual(table.rows.map((r) => r.code), ['GAM', 'ALP', 'DEL', 'BET']);
  assert.deepEqual(table.rows.slice(0, 2).map((r) => [r.points, r.gd]), [[3, 1], [3, 1]]);
  assert.deepEqual(table.rows.slice(2).map((r) => [r.points, r.gd]), [[0, -1], [0, -1]]);
});

test('identical points, GD and GF preserve configured order rather than fixture or published row order', () => {
  const doc = archive();
  const s = doc.seasons[0];
  s.teams = [TEAMS[2], TEAMS[3], TEAMS[0], TEAMS[1]].map(clone);
  s.matches = [fixture(1, 'alpha', 'beta', [1, 0]), fixture(2, 'gamma', 'delta', [1, 0])];
  s.total_matches = s.aired_count = 2;
  s.skipped_count = 0;
  s.table = [
    official('beta', 1, 0, 0, 1, 0, 1, -1, 0, 4),
    official('alpha', 1, 1, 0, 0, 1, 0, 1, 3, 2),
    official('delta', 1, 0, 0, 1, 0, 1, -1, 0, 3),
    official('gamma', 1, 1, 0, 0, 1, 0, 1, 3, 1),
  ];
  assert.deepEqual(tableFor(doc, 2).rows.map((r) => r.code), ['GAM', 'ALP', 'DEL', 'BET']);
});

test('aired chronology, not fixture number, determines the match boundary', () => {
  const doc = archive();
  const first = matchIn(doc, 1), fifth = matchIn(doc, 5);
  [first.aired_at, fifth.aired_at] = [fifth.aired_at, first.aired_at];
  assert.deepEqual(stats(tableFor(doc, 5)), stats(tableFor(archive(), 1)));
});

test('published round prev/move fields are ignored completely', () => {
  const doc = archive();
  for (const r of doc.seasons[0].table) { r.prev = { bogus: true }; r.move = 'UP 700'; }
  assert.deepEqual(stats(tableFor(doc)), stats(tableFor()));
});

test('exact and hash-suffixed direct IDs and bundle folder IDs identify the same known result', () => {
  const expected = tableFor();
  for (const options of [
    { matchId: 's9-m4_delta_alpha-a1b2c3' },
    { matchId: 's9-m4_delta_alpha-ABCDEF0123456789' },
    { matchId: 'direct-sdk', bundleUrl: 'https://invalid.example/bundles/s9-m4_delta_alpha-a1b2c3/?x=1' },
    { matchId: null, bundleUrl: 'https://invalid.example/s9-m4_delta_alpha/' },
  ]) assert.deepEqual(tableFor(archive(), 4, options), expected);
});

for (const badId of ['s9-m41_delta_alpha', 's9-m4', 'm4', 's9-m4_delta_alpha-nothex',
  's9-m4_delta_alpha-abc', `s9-m4_delta_alpha-${'a'.repeat(65)}`, 's9-m4_delta_alpha-deadbeef-extra', '']) {
  test(`unknown/partial identity fails closed: ${JSON.stringify(badId)}`, () => {
    closed(archive(), { ...identity(), matchId: badId });
  });
}

test('conflicting exact ID and bundle ID are ambiguous, not a guess', () => {
  closed(archive(), { ...identity(), bundleUrl: 'https://invalid.example/s9-m5_alpha_beta-deadbeef/' });
});

test('scores and on-air team orientation must agree exactly', () => {
  for (const changes of [
    { score: [0, 3] }, { score: [2, 0] }, { score: ['3', 0] }, { score: null },
    { home: { code: 'ALP' }, away: { code: 'DEL' } },
    { home: { code: 'UNKNOWN' } }, { away: undefined },
  ]) closed(archive(), { ...identity(), ...changes });
});

test('unknown, missing, scheduled and skipped results never produce invented standings', () => {
  closed(undefined);
  closed(null);
  closed({ generated_at: '2026-01-02T00:00:00Z', seasons: [] });
  closed(archive(), {});
  for (const n of [7, 8]) closed(archive(), identity(archive(), n));
  const doc = archive();
  delete matchIn(doc, 4).watch;
  closed(doc);
  const duplicate = archive();
  duplicate.seasons.push(clone(duplicate.seasons[0]));
  closed(duplicate);
});

const malformedCases = [
  ['missing ledger fixture', (s) => s.matches.pop()],
  ['wrong total fixture count', (s) => s.total_matches++],
  ['wrong aired count', (s) => s.aired_count--],
  ['wrong skipped count', (s) => s.skipped_count++],
  ['duplicate fixture number', (s) => { s.matches[1].n = s.matches[0].n; }],
  ['out-of-range fixture number', (s) => { s.matches[1].n = 41; }],
  ['duplicate fixture ID', (s) => { s.matches[1].watch.id = s.matches[0].watch.id; }],
  ['fixture ID disagrees with exact fixture number', (s) => { s.matches[1].watch.id = 's9-m41_gamma_delta'; }],
  ['duplicate team slug', (s) => { s.teams[1].slug = s.teams[0].slug; }],
  ['duplicate team code', (s) => { s.teams[1].code = s.teams[0].code; }],
  ['null team', (s) => { s.teams[1] = null; }],
  ['missing team name', (s) => { delete s.teams[1].name; }],
  ['unknown fixture team', (s) => { s.matches[1].home = 'missing'; }],
  ['same team at home and away', (s) => { s.matches[1].home = s.matches[1].away; }],
  ['team code mismatch', (s) => { s.matches[1].home_code = 'ALP'; }],
  ['unknown fixture status', (s) => { s.matches[1].status = 'complete'; }],
  ['null fixture', (s) => { s.matches[1] = null; }],
  ['negative score', (s) => { s.matches[1].score = [-1, 0]; }],
  ['fractional score', (s) => { s.matches[1].score = [1.5, 0]; }],
  ['nonfinite score', (s) => { s.matches[1].score = [Infinity, 0]; }],
  ['string score', (s) => { s.matches[1].score = ['2', 1]; }],
  ['missing score', (s) => { delete s.matches[1].score; }],
  ['oversized score array', (s) => { s.matches[1].score = [2, 1, 0]; }],
  ['missing published row', (s) => s.table.pop()],
  ['duplicate published row', (s) => { s.table[1] = clone(s.table[0]); }],
  ['unknown published team', (s) => { s.table[1].slug = 'unknown'; }],
  ['published code mismatch', (s) => { s.table[1].code = 'WRONG'; }],
  ['null published row', (s) => { s.table[1] = null; }],
  ['missing aired timestamp', (s) => { delete s.matches[1].aired_at; }],
  ['unparseable aired timestamp', (s) => { s.matches[1].aired_at = 'not-a-dateZ'; }],
  ['timezone-free aired timestamp', (s) => { s.matches[1].aired_at = '2026-01-01T12:00:02'; }],
  ['impossible calendar date', (s) => { s.matches[1].aired_at = '2026-02-30T12:00:02Z'; }],
  ['duplicate aired timestamp', (s) => { s.matches[1].aired_at = s.matches[0].aired_at; }],
  ['equivalent timestamp in another offset', (s) => { s.matches[1].aired_at = '2026-01-01T13:00:04+01:00'; }],
];
for (const [name, mutate] of malformedCases) {
  test(`malformed season fails closed: ${name}`, () => {
    const doc = archive();
    mutate(doc.seasons[0]);
    closed(doc);
    assert.throws(() => validateSeason(doc.seasons[0]));
  });
}
for (const generated_at of [undefined, null, '', 'badZ', '2026-01-02T00:00:00', '2026-02-30T00:00:00Z']) {
  test(`invalid generation timestamp fails closed: ${JSON.stringify(generated_at)}`, () => {
    closed({ ...archive(), generated_at });
  });
}
for (const field of ['P', 'W', 'D', 'L', 'GF', 'GA', 'GD', 'Pts', 'pos']) {
  test(`full reconciliation checks every published field, including ${field}`, () => {
    const doc = archive();
    doc.seasons[0].table.find((r) => r.slug === 'beta')[field]++;
    closed(doc);
  });
}

test('correction to a later result invalidates an earlier snapshot until the entire published table reconciles', () => {
  const doc = archive();
  matchIn(doc, 6).score = [0, 2];
  closed(doc);
  Object.assign(doc.seasons[0].table.find((r) => r.slug === 'delta'), { GF: 6, GD: 4 });
  Object.assign(doc.seasons[0].table.find((r) => r.slug === 'gamma'), { GA: 5, GD: -1 });
  assert.deepEqual(stats(tableFor(doc, 4)), stats(tableFor(archive(), 4)), 'later correction must not leak into m4');
});

test('a fully reconciled earlier correction changes the authentic snapshot, not just the season final', () => {
  const doc = archive();
  matchIn(doc, 1).score = [2, 0];
  closed(doc);
  Object.assign(doc.seasons[0].table.find((r) => r.slug === 'alpha'), { GF: 3, GD: 0 });
  Object.assign(doc.seasons[0].table.find((r) => r.slug === 'beta'), { GA: 5, GD: -3 });
  const alpha = tableFor(doc).rows.find((r) => r.code === 'ALP');
  assert.equal(alpha.gd, -1);
  assert.equal(alpha.previousGd, 2);
  assert.equal(alpha.points, 3);
});

// All controller I/O is injected; setImmediate lets both fetch/json promise
// continuations land without wall-clock sleeps or any real network access.
const flush = () => new Promise((resolve) => setImmediate(resolve));
function liveMatch(n = 4) {
  const info = identity(archive(), n);
  return {
    phase: 'match', loops: 0,
    match: { id: info.matchId, bundleUrl: `https://invalid.example/${info.matchId}-abcdef/` },
    bug: { t: 100, over: true, preroll: false, inPlay: false, replay: false,
      home: info.home, away: info.away, a: info.score[0], b: info.score[1] },
    ball: { speed: 0 }, headcam: false,
    clockPlan: { buzzers: [{ kind: 'full', play_end_t: 100 }] },
  };
}
function harness(fetcher = async () => ({ ok: true, json: async () => archive() })) {
  const calls = [];
  const controller = createPostMatchTable({
    url: 'https://invalid.example/offline-fixture.json',
    fetcher: (...args) => { calls.push(args); return fetcher(...args); },
  });
  const h = {
    controller, calls, match: liveMatch(),
    frame(time, changes = {}) {
      return controller.update({ match: h.match, camera: 'heli', settling: false,
        time, nowMs: 1000 + time * 1000, ...changes });
    },
    async prime() {
      assert.equal(h.frame(0, { match: { ...h.match, bug: { ...h.match.bug, t: 99, over: false } } }), null);
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
async function onAir(h) {
  await h.prime();
  hidden(h, 0);
  const frame = h.frame(0.7);
  assert.ok(frame, 'verified full-time, stopped-ball aerial should show after 0.7s');
  assert.equal(h.controller.state().visible, true);
  return frame;
}

const unsafeGates = [
  ['half-time', (m) => { m.bug.over = false; m.bug.half = 1; }],
  ['pre-roll', (m) => { m.bug.preroll = true; }],
  ['dead ball before full-time', (m) => { m.bug.over = false; m.bug.inPlay = false; }],
  ['active play even when flagged over', (m) => { m.bug.inPlay = true; }],
  ['unknown in-play state', (m) => { delete m.bug.inPlay; }],
  ['fallback camera settling', () => {}, { settling: true }],
  ['moving ball', (m) => { m.ball.speed = 0.61; }],
  ['unmeasured ball before publisher end timestamp', (m) => { delete m.ball; m.clockPlan.buzzers[0].play_end_t = 105; }],
  ['unmeasured ball without publisher end timestamp', (m) => { delete m.ball; delete m.clockPlan; }],
  ['NaN ball speed', (m) => { m.ball.speed = NaN; }],
  ['infinite ball speed', (m) => { m.ball.speed = Infinity; }],
  ['string ball speed', (m) => { m.ball.speed = '0'; }],
  ['replay', (m) => { m.bug.replay = true; }],
  ['headcam', (m) => { m.headcam = true; }],
];
for (const [name, mutate, changes = {}] of unsafeGates) {
  test(`controller never paints during ${name}`, async () => {
    const h = harness();
    await h.prime();
    mutate(h.match);
    hidden(h, 0, changes);
    hidden(h, 0.7, changes);
    hidden(h, 10, changes);
    hidden(h, 30, changes);
  });
}

test('publisher ball-at-rest is the fallback when the picture cannot be measured', async () => {
  for (const ball of [null, { speed: 0, measured: false }]) {
    const h = harness();
    await h.prime();
    h.match.ball = ball;
    hidden(h, 0);
    assert.ok(h.frame(0.7), 'a valid publisher play_end_t independently certifies the ball has stopped');
  }
});

test('an explicitly unmeasured or negative speed is not proof of a stopped ball', async () => {
  for (const ball of [{ speed: 0, measured: false }, { speed: -1, measured: true }]) {
    const h = harness();
    await h.prime();
    h.match.ball = ball;
    delete h.match.clockPlan;
    hidden(h, 0);
    hidden(h, 0.7);
  }
});

test('full-time + stopped ball + heli cues after 0.7s, shows once for 18s, then clears', async () => {
  assert.equal(TABLE_DURATION_S, 18);
  const h = harness();
  await h.prime();
  hidden(h, 0);
  hidden(h, 0.699);
  const first = h.frame(0.7);
  assert.ok(first);
  assert.equal(first.elapsed, 0);
  assert.deepEqual(stats(first.presentation), stats(tableFor()));
  assert.deepEqual(h.controller.state().movements, [
    { code: 'DEL', from: 4, to: 2, change: 2 },
    { code: 'ALP', from: 2, to: 3, change: -1 },
  ]);
  assert.ok(h.frame(18.699));
  hidden(h, 18.7);
  assert.equal(h.controller.state().status, 'complete');
  hidden(h, 19);
  hidden(h, 24);
  hidden(h, 40);
  assert.equal(h.calls.length, 1, 'render frames do not cause repeated fetches');
});

test('wrong camera is hidden; changing camera while on-air clears and does not restart', async () => {
  const h = harness();
  await h.prime();
  hidden(h, 0, { camera: 'wide' });
  hidden(h, 1, { camera: 'follow' });
  assert.ok(h.frame(2, { camera: 'HELI' }));
  hidden(h, 3, { camera: 'wide' });
  hidden(h, 4, { camera: 'heli' });
});

test('unsafe interval breaks the continuous stopped-ball cue delay', async () => {
  const h = harness();
  await h.prime();
  hidden(h, 0);
  hidden(h, 0.5, { settling: true });
  hidden(h, 0.6);
  hidden(h, 1.29);
  assert.ok(h.frame(1.31));
});

test('resuming play immediately hides an on-air table and it never reappears in the same result', async () => {
  const h = harness();
  await onAir(h);
  h.match.bug.inPlay = true;
  hidden(h, 1);
  h.match.bug.inPlay = false;
  hidden(h, 2);
  hidden(h, 3);
});

test('late data cannot flash after the 25-second cue window', async () => {
  let deliver;
  const h = harness(() => new Promise((resolve) => { deliver = resolve; }));
  hidden(h, 0);
  await flush();
  hidden(h, 24.9);
  hidden(h, 25.01);
  deliver({ ok: true, json: async () => archive() });
  await flush();
  hidden(h, 25.1);
  hidden(h, 26);
  hidden(h, 45);
  assert.equal(h.calls.length, 1);
});

test('data arriving within the cue window may show, but a late aerial cannot', async () => {
  let deliver;
  const h = harness(() => new Promise((resolve) => { deliver = resolve; }));
  hidden(h, 0);
  await flush();
  hidden(h, 1);
  deliver({ ok: true, json: async () => archive() });
  await flush();
  assert.ok(h.frame(2));
  const other = harness();
  await other.prime();
  hidden(other, 0, { camera: 'wide' });
  hidden(other, 26, { camera: 'heli' });
});

test('backwards seek clears a visible table and resets the once-only cue', async () => {
  const h = harness();
  h.match.bug.t = 110;
  await onAir(h);
  h.match.bug.t = 100;
  hidden(h, 1);
  hidden(h, 1.69);
  assert.ok(h.frame(1.71));
  h.match.bug.t = 20;
  h.match.bug.over = false;
  hidden(h, 2);
  h.match.bug.t = 100;
  h.match.bug.over = true;
  hidden(h, 3);
  assert.ok(h.frame(3.71));
});

test('a new loop clears the old presentation and permits exactly one fresh delayed cue', async () => {
  const h = harness();
  await onAir(h);
  h.match.loops++;
  hidden(h, 1);
  hidden(h, 1.69);
  assert.ok(h.frame(1.71));
  hidden(h, 20);
  hidden(h, 21);
});

test('match changes clear the old result and reset cueing using the new exact snapshot', async () => {
  const h = harness();
  await onAir(h);
  h.match = liveMatch(5);
  hidden(h, 1);
  const next = h.frame(1.71);
  assert.ok(next);
  assert.equal(next.presentation.matchId, 's9-m5_alpha_beta');
  assert.deepEqual(stats(next.presentation), stats(tableFor(archive(), 5)));
  h.match = { phase: 'loading' };
  hidden(h, 2);
  assert.equal(h.controller.state().status, 'idle');
  h.match = liveMatch(4);
  hidden(h, 3);
  assert.ok(h.frame(3.71));
});

test('a match change to an unknown result cannot retain the previous presentation', async () => {
  const h = harness();
  await onAir(h);
  h.match = liveMatch();
  h.match.match = { id: 's9-m41_delta_alpha', bundleUrl: 'https://invalid.example/unknown/' };
  hidden(h, 1);
  hidden(h, 2);
  hidden(h, 26.1);
});

const fetchFailures = [
  ['network rejection', async () => { throw new Error('offline'); }],
  ['synchronous fetch throw', () => { throw new Error('offline synchronously'); }],
  ['HTTP error', async () => ({ ok: false, status: 503 })],
  ['bad JSON', async () => ({ ok: true, json: async () => { throw new SyntaxError('bad JSON'); } })],
  ['invalid archive shape', async () => ({ ok: true, json: async () => ({}) })],
  ['unknown result', async () => ({ ok: true, json: async () => ({ ...archive(), seasons: [] }) })],
  ['unreconciled standings', async () => {
    const doc = archive(); doc.seasons[0].table[0].Pts++;
    return { ok: true, json: async () => doc };
  }],
];
for (const [name, fetcher] of fetchFailures) {
  test(`fetch failure/unavailable data never throws or paints bogus results: ${name}`, async () => {
    const h = harness(fetcher);
    assert.doesNotThrow(() => hidden(h, 0));
    await flush();
    for (const time of [0.7, 1, 10, 24.9, 26, 59]) {
      assert.doesNotThrow(() => hidden(h, time));
    }
    assert.equal(h.calls.length, 1);
    assert.ok(h.controller.state().reason || h.controller.state().dataError || h.controller.state().status === 'complete');
    hidden(h, 60);
    await flush();
    assert.equal(h.calls.length, 2, 'a retry is bounded to one per minute');
  });
}

test('refresh is bounded per minute and pending requests never stack across match changes', async () => {
  let deliver;
  const h = harness(() => new Promise((resolve) => { deliver = resolve; }));
  h.match.bug.over = false;
  hidden(h, 0);
  await flush();
  for (let t = 1; t <= 120; t++) hidden(h, t);
  h.match = liveMatch(5); h.match.bug.over = false;
  hidden(h, 121);
  assert.equal(h.calls.length, 1, 'pending requests are deduplicated even beyond the refresh interval');
  deliver({ ok: true, json: async () => archive() });
  await flush();
  hidden(h, 122);
  assert.equal(h.calls.length, 2);
  deliver({ ok: true, json: async () => archive() });
  await flush();
  for (const t of [123, 150, 181.999]) hidden(h, t);
  assert.equal(h.calls.length, 2);
  hidden(h, 182);
  assert.equal(h.calls.length, 3);
  deliver({ ok: true, json: async () => archive() });
  await flush();
  const [url, options] = h.calls[0];
  assert.equal(url, 'https://invalid.example/offline-fixture.json');
  assert.equal(options.credentials, 'omit');
  assert.equal(options.cache, 'no-cache');
  assert.ok(options.signal instanceof AbortSignal);
});

test('idle/missing match never fetches and clears any presentation', () => {
  const h = harness();
  hidden(h, 0, { match: null });
  hidden(h, 1, { match: { phase: 'loading' } });
  hidden(h, 2, { match: { phase: 'match', match: { id: 'unknown' } } });
  assert.equal(h.calls.length, 0);
});
