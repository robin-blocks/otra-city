// Offline shared-programme regressions. Run: node --test scripts/broadcast-programme-check.mjs
// The browser .js modules are ESM in a CommonJS package. Load their unchanged
// source through data URLs, rewriting ONLY import URLs (not production logic).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PerspectiveCamera, Vector3 } from 'three';
import { matchPeriod } from '../public/js/match-clock.mjs';
import { goalReplayAt } from '../public/js/goal-celebration.mjs';
import { createPostMatchTable } from '../public/js/post-match-table.mjs';
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const data = (text) => `data:text/javascript;base64,${Buffer.from(text).toString('base64')}`;
const camerasURL = data(read('../public/js/broadcast-cameras.js'));
const { createTrack, CAMERAS } = await import(camerasURL);
const { createBroadcastProgramme, PROGRAMME_TRACK_URLS } = await import(data(
  read('../public/js/broadcast-programme.js')
    .replace("'./broadcast-cameras.js'", JSON.stringify(camerasURL))
    .replace("'./goal-celebration.mjs'", JSON.stringify(new URL('../public/js/goal-celebration.mjs', import.meta.url).href))
    .replace("'./post-match-table.mjs'", JSON.stringify(new URL('../public/js/post-match-table.mjs', import.meta.url).href))));
const venue = { cameras: {
  gantry: [[0, 8.7, -10.6], [0, 0.6, 0]],
  scoreboard: [[1, 2, 3], [4, 5, 6]], screen_main: [[7, 8, 9], [0, 1, 2]],
} };
const docs = Object.fromEntries(Object.entries(PROGRAMME_TRACK_URLS).map(([k, url]) => [k, JSON.parse(read(`../public${url}`))]));
async function tracks() {
  return Object.fromEntries(await Promise.all(Object.entries(docs).map(async ([key, doc]) => [key,
    await createTrack(doc, { named: (n) => venue.cameras[n] && ({ pos: venue.cameras[n][0], lookAt: venue.cameras[n][1] }) }).resolve()])));
}
async function director(options = {}) {
  return createBroadcastProgramme({ venue, tracks: await tracks(), tableController: null, ...options });
}
// A hold at 100 adds eight programme seconds. Full time ends at 622, with a
// long final dwell: programme time continues while the match clock is still.
const programme = { map: [[-180, 0], [100, 280], [100, 288], [622, 810], [622, 910]], duration_s: 910 };
const plan = { buzzers: [{ kind: 'half', t: 300, play_end_t: 305, restart_t: 317 },
  { kind: 'full', t: 617, play_end_t: 622 }] };
const play = { players: [[-2, 0, 1], [3, 0, -2]], ball: [1, 0.2, 1] };
function match(t, p, changes = {}) {
  const base = { phase: 'match', match: { id: 'fixture', startsAt: '2026-09-21T11:00:00Z' },
    programme, programmeT: p, clockPlan: plan, loops: 0, play, ball: { speed: 0, measured: true },
    bug: { t, programmeT: p, inPlay: t >= 0 && (t < 305 || (t >= 317 && t < 622)),
      preroll: t < 0, over: t >= 617, replay: false } };
  return { ...base, ...changes, bug: { ...base.bug, ...changes.bug } };
}
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
function tableStub({ available = true } = {}) {
  const calls = [], presentation = { matchId: 'fixture', rows: [] };
  return { calls, update(input) { calls.push(input); return available && input.time >= 0.7 ? { presentation, elapsed: 0 } : null; },
    state: () => ({ status: available ? 'on-air' : 'waiting-for-table' }) };
}

test('default async loader resolves the existing three tracks; no second scene/stage', async () => {
  const calls = [];
  const p = await createBroadcastProgramme({ venue, tableController: null, fetcher: async (url, options) => {
    calls.push([url, options]); return { ok: true, json: async () => docs[Object.keys(PROGRAMME_TRACK_URLS).find((k) => PROGRAMME_TRACK_URLS[k] === url)] };
  } });
  assert.equal(calls.length, 3);
  assert.ok(calls.every(([, o]) => o.credentials === 'omit'));
  assert.equal(p.evaluate({ nowMs: 0 }).camera.camera, 'heli');
});

test('loader rejects failed tracks instead of silently making new artistic cuts', async () => {
  await assert.rejects(createBroadcastProgramme({ venue, tableController: null,
    fetcher: async () => ({ ok: false, status: 503 }) }), /HTTP 503/);
});

test('idle is a shared epoch, not a page-local arrival phase', async () => {
  const a = await director(), b = await director();
  a.evaluate({ nowMs: 0 }); a.evaluate({ nowMs: 13000 });
  const x = a.evaluate({ nowMs: 48000 }), y = b.evaluate({ nowMs: 48000 });
  assert.deepEqual(x, y); assert.equal(x.camera.camera, 'screen_main');
  assert.equal(x.state.clock, 'idle-epoch');
});

test('preroll late join uses programme origin; play uses latest restart', async () => {
  const a = await director(), b = await director();
  a.evaluate({ match: match(-180, 0), nowMs: 0 });
  assert.deepEqual(a.evaluate({ match: match(-156, 24), nowMs: 24000 }).camera,
    b.evaluate({ match: match(-156, 24), nowMs: 24000 }).camera);
  assert.equal(b.state().camera, 'heli');
  const start = b.evaluate({ match: match(319, 507), nowMs: 507000 });
  assert.equal(start.camera.camera, 'gantry');
  near(start.state.phaseOrigin, 505); near(start.state.phaseElapsed, 2);
});

test('interval and postmatch anchor at latest play-end, including inserted goal holds', async () => {
  const p = await director();
  let out = p.evaluate({ match: match(310, 498), nowMs: 1 });
  assert.equal(out.state.phase, 'interval'); near(out.state.phaseOrigin, 493); near(out.camera.t, 5);
  out = p.evaluate({ match: match(622, 835), nowMs: 2 });
  assert.equal(out.state.phase, 'postmatch'); near(out.state.phaseOrigin, 810); near(out.camera.t, 25);
  assert.notEqual(out.state.phaseOrigin, 493);
});

test('headcam outranks goal; goal outranks play and the league aerial', async () => {
  const p = await director({ tableController: tableStub() });
  const hc = { pos: [1, 2, 3], lookAt: [3, 2, 1], fov: 70 };
  const m = match(622, 860, { board: 'GOAL', headcam: hc, bug: { replay: true } });
  let out = p.evaluate({ match: m });
  assert.equal(out.camera.camera, 'headcam'); assert.deepEqual(out.camera.pos, hc.pos); assert.equal(out.tableCue, null);
  out = p.evaluate({ match: { ...m, headcam: null } });
  assert.equal(out.camera.camera, 'scoreboard'); assert.equal(out.camera.fov, 50); assert.equal(out.tableCue, null);
  out = p.evaluate({ match: match(622, 860, { bug: { inPlay: true } }) });
  assert.equal(out.camera.camera, 'gantry'); assert.equal(out.tableCue, null);
});

test('publisher dead ball and measured rolling fallback retain the gantry; no arrival-based six seconds', async () => {
  const p = await director({ tableController: tableStub() });
  assert.equal(p.evaluate({ match: match(620, 808) }).camera.camera, 'gantry');
  const noRest = { buzzers: [{ kind: 'full', t: 617 }] };
  let out = p.evaluate({ match: match(621, 809, { clockPlan: noRest, bug: { inPlay: false }, ball: { speed: 2 } }) });
  assert.equal(out.state.settling, true); assert.equal(out.camera.camera, 'gantry'); assert.equal(out.tableCue, null);
  out = p.evaluate({ match: match(624, 812, { clockPlan: noRest, bug: { inPlay: false }, ball: { speed: 2 } }) });
  assert.equal(out.state.settling, false); assert.equal(out.camera.camera, 'heli'); assert.equal(out.tableCue, null);
});

test('unknown rest evidence, invalid speeds, pre-roll and replay cannot put a table over football', async () => {
  const p = await director({ tableController: tableStub() });
  for (const changes of [
    { ball: { speed: NaN } }, { ball: { speed: -1 } }, { ball: { speed: 1 } },
    { bug: { inPlay: true } }, { bug: { preroll: true } }, { bug: { replay: true } },
    { clockPlan: { buzzers: [{ kind: 'full', t: 617 }] }, ball: null },
  ]) assert.equal(p.evaluate({ match: match(622, 860, changes) }).tableCue, null);
});

test('54-second table and held animated heli are identical for late join, sparse and continuous clients', async () => {
  const a = await director({ tableController: tableStub() }), b = await director({ tableController: tableStub() });
  a.evaluate({ match: match(622, 810) });
  assert.equal(a.evaluate({ match: match(622, 810.5) }).tableCue, null);
  for (const elapsed of [0.7, 1, 44.9, 45, 50, 54.69]) {
    const m = match(622, 810 + elapsed);
    const x = a.evaluate({ match: m, nowMs: 1234 }), y = b.evaluate({ match: m, nowMs: 1234 });
    assert.deepEqual(x.camera, y.camera); assert.deepEqual(x.tableCue, y.tableCue);
    near(x.tableCue.elapsed, elapsed - 0.7); assert.equal(x.camera.camera, 'heli');
    if (elapsed >= 45) {
      assert.equal(x.camera.held, true);
      const expected = CAMERAS.heli(Math.floor(elapsed * 50 + 1e-7) / 50, 11, docs.ambient.segments[0].params);
      assert.deepEqual(x.camera.pos, expected.pos); assert.deepEqual(x.camera.lookAt, expected.lookAt);
    }
  }
  const x = a.evaluate({ match: match(622, 864.7) }), y = (await director({ tableController: tableStub() })).evaluate({ match: match(622, 864.7) });
  assert.equal(x.tableCue, null); assert.equal(y.tableCue, null);
  assert.equal(x.camera.camera, 'screen_main'); assert.deepEqual(x.camera, y.camera);
  assert.equal(x.state.table.expired, true);
});

test('archive arrival never determines camera phase; missing evidence leaves reserved aerial unobscured', async () => {
  const a = await director({ tableController: tableStub() }), b = await director({ tableController: tableStub({ available: false }) });
  const m = match(622, 860);
  const x = a.evaluate({ match: m }), y = b.evaluate({ match: m });
  assert.deepEqual(x.camera, y.camera); assert.ok(x.tableCue); assert.equal(y.tableCue, null);
});

test('existing evidence controller receives real now/match; joined cue has remaining time, not a restarted 54s', async () => {
  const incident = JSON.parse(read('./fixtures/league-first-air-m42.json'));
  const table = createPostMatchTable({ fetcher: async () => ({ ok: true, json: async () => incident.archive }) });
  const p = await director({ tableController: table });
  const item = incident.programme.item, score = incident.hud.score.at(-1);
  const m = match(622, 860, { source: 'schedule', match: { id: item.bundleId, bundleUrl: item.bundleUrl,
    startsAt: item.startsAt, state: 'live' }, bug: { home: item.home, away: item.away, a: score.a, b: score.b } });
  const nowMs = Date.parse(incident.programme.now);
  assert.equal(p.evaluate({ match: m, nowMs }).tableCue, null, 'no unchecked archive fallback');
  await new Promise(setImmediate);
  const out = p.evaluate({ match: m, nowMs });
  assert.ok(out.tableCue, out.state.table.reason); near(out.tableCue.elapsed, 49.3);
  assert.equal(out.tableCue.presentation.matchId, item.bundleId);
  assert.equal(p.evaluate({ match: { ...m, programmeT: 866, bug: { ...m.bug, programmeT: 866 } }, nowMs }).tableCue, null);
});

test('real validator still rejects unpublished direct/replay and mismatched scores', async () => {
  const incident = JSON.parse(read('./fixtures/league-first-air-m42.json')), item = incident.programme.item;
  for (const source of ['now', 'schedule']) {
    const table = createPostMatchTable({ fetcher: async () => ({ ok: true, json: async () => incident.archive }) });
    const p = await director({ tableController: table });
    const m = match(622, 840, { source, match: { id: item.bundleId, bundleUrl: item.bundleUrl, startsAt: item.startsAt, state: 'replay' },
      bug: { home: item.home, away: item.away, a: 999, b: 0 } });
    const nowMs = Date.parse(incident.programme.now);
    p.evaluate({ match: m, nowMs }); await new Promise(setImmediate);
    assert.equal(p.evaluate({ match: m, nowMs }).tableCue, null);
  }
});

test('bounded gantry history is independent of render cadence/arrival and never reads future samples', async () => {
  const samples = [];
  const samplePlay = (t) => { samples.push(t); return { players: [[Math.sin(t), 0, Math.cos(t)]], ball: [Math.sin(t * 2) * 3, 0.2, 0] }; };
  const a = await director({ samplePlay }), b = await director({ samplePlay });
  a.evaluate({ match: match(200, 388), dt: 0.01 });
  a.evaluate({ match: match(210, 398), dt: 10 }); samples.length = 0;
  const m = match(220.013, 408.013);
  const x = a.evaluate({ match: m, dt: 0.005 }), y = b.evaluate({ match: m, dt: 5 });
  assert.deepEqual(x.camera, y.camera); assert.equal(x.state.gantry, 'bounded-history');
  assert.ok(samples.every((t) => t <= m.bug.t + 1e-9)); assert.ok(samples.length <= 404);
  assert.equal(x.state.gantryHistorySeconds, 4);
});

test('missing sampler explicitly discloses local lag; invalid verified play locks gantry', async () => {
  const p = await director();
  assert.equal(p.evaluate({ match: match(220, 408) }).state.gantry, 'local-lag-fallback');
  const out = p.evaluate({ match: match(221, 409, { play: null }) });
  assert.equal(out.state.gantry, 'locked'); assert.deepEqual(out.camera.lookAt, [0, 0.6, 0]);
});

test('no-map fallback stays in match-clock coordinates and does not subtract buzzers from programme time', async () => {
  const p = await director();
  const out = p.evaluate({ match: match(630, 818, { programme: null }) });
  assert.equal(out.state.clock, 'match-clock-fallback'); near(out.state.phaseElapsed, 8);
});

test('expired first-air evidence is NOT refreshed by a late-join virtual cue timestamp', async () => {
  const incident = JSON.parse(read('./fixtures/league-first-air-m42.json')), item = incident.programme.item, score = incident.hud.score.at(-1);
  const table = createPostMatchTable({ fetcher: async () => ({ ok: true, json: async () => incident.archive }) });
  const p = await director({ tableController: table });
  const m = match(622, 860, { source: 'schedule', match: { id: item.bundleId, bundleUrl: item.bundleUrl,
    startsAt: item.startsAt, state: 'live' }, bug: { home: item.home, away: item.away, a: score.a, b: score.b } });
  const nowMs = Date.parse(item.startsAt) + 24 * 60 * 60 * 1000;
  p.evaluate({ match: m, nowMs }); await new Promise(setImmediate);
  const out = p.evaluate({ match: m, nowMs });
  assert.equal(out.tableCue, null); assert.ok(out.state.table.reason);
});

test('new shared loop resets the slot rather than inheriting its previous completion', async () => {
  const p = await director({ tableController: tableStub() });
  p.evaluate({ match: match(622, 880) });
  p.evaluate({ match: match(-180, 0, { loops: 1 }) });
  const out = p.evaluate({ match: match(622, 815, { loops: 1 }) });
  near(out.tableCue.elapsed, 4.3); assert.ok(out.state.matchKey.endsWith(':1'));
});

test('an actual validated table rejoins global remaining time after a headcam interruption', async () => {
  const incident = JSON.parse(read('./fixtures/league-first-air-m42.json')), item = incident.programme.item, score = incident.hud.score.at(-1);
  const table = createPostMatchTable({ fetcher: async () => ({ ok: true, json: async () => incident.archive }) });
  const p = await director({ tableController: table });
  const m = match(622, 820, { source: 'schedule', match: { id: item.bundleId, bundleUrl: item.bundleUrl,
    startsAt: item.startsAt, state: 'live' }, bug: { home: item.home, away: item.away, a: score.a, b: score.b } });
  const nowMs = Date.parse(incident.programme.now);
  p.evaluate({ match: m, nowMs }); await new Promise(setImmediate);
  assert.ok(p.evaluate({ match: m, nowMs }).tableCue);
  const interrupted = { ...m, headcam: { pos: [1, 1, 1], lookAt: [0, 0, 0] }, bug: { ...m.bug, replay: true } };
  assert.equal(p.evaluate({ match: interrupted, nowMs }).tableCue, null);
  const restored = { ...m, programmeT: 840, bug: { ...m.bug, programmeT: 840 } };
  near(p.evaluate({ match: restored, nowMs }).tableCue.elapsed, 29.3);
});

// The host's public contract contains goal timing/team, but no explosion
// origin. The sampler contains players/ball/anchors, with the ball parked at
// y=-30 during the effect. Deliberately put all players at the WRONG end so
// passing these tests requires framing the goal, not merely naming a gantry.
const celebrationGoals = [
  { t: 100, source_t: 100, team: 'A' },
  { t: 104.6, source_t: 103, team: 'B' },
  { t: 304.2, source_t: 301, team: 0 }, // after half-time buzzer
  { t: 623.8, source_t: 619, team: 1 }, // after full-time buzzer
].map((g) => ({ type: 'goal', ...g, player: `p${g.team}`, celebration_s: 1.6,
  replay_t: +(g.t + 1.6).toFixed(8), replay_s: 5 }));
const celebrationMap = [[-180, 0]];
let replayHolds = 0;
for (const g of celebrationGoals) {
  const p = g.replay_t + 180 + replayHolds;
  celebrationMap.push([g.replay_t, p], [g.replay_t, p + 5]); replayHolds += 5;
}
celebrationMap.push([640, 840], [640, 940]);
function celebrating(g, elapsed = 0.8, changes = {}) {
  const end = g.team === 'A' || g.team === 0 ? 7 : -7;
  const p = g.t + elapsed + 180 + celebrationGoals.indexOf(g) * 5;
  return match(g.t + elapsed, p, {
    programme: { map: celebrationMap }, goals: celebrationGoals, board: 'GOAL',
    play: { players: [[-end, 0.5, 2], [-end, 0.5, -2]], ball: [0, -30, 0] },
    ...changes, bug: { celebrating: true, ...changes.bug },
  });
}
function project(pose, point) {
  const camera = new PerspectiveCamera(pose.fov, 16 / 9, 0.1, 1000);
  camera.position.fromArray(pose.pos); camera.lookAt(new Vector3(...pose.lookAt)); camera.updateMatrixWorld();
  return new Vector3(...point).project(camera).toArray();
}
function inFrame(pose, point) {
  const [x, y, z] = project(pose, point);
  assert.ok(Math.abs(x) < 0.95 && Math.abs(y) < 0.95 && z > -1 && z < 1,
    `effect ${point} clips at NDC ${[x, y, z]}`);
}

test('celebration frames both actual goal ends, not scoreboard, hidden ball or opposite-end players', async () => {
  // Calibrate the projection with the real stadium board: aim is centred,
  // but both goals are outside its picture (the original failure).
  const actualVenue = JSON.parse(read('../public/venues/stadium/venue.json'));
  const board = { pos: actualVenue.cameras.scoreboard[0], lookAt: actualVenue.cameras.scoreboard[1], fov: 50 };
  const centre = project(board, board.lookAt); near(centre[0], 0); near(centre[1], 0);
  for (const x of [-7, 7]) assert.ok(Math.abs(project(board, [x, 0.35, 0])[1]) > 1);
  const p = await director();
  for (const g of celebrationGoals) {
    const m = celebrating(g), snapshot = JSON.stringify(m);
    const out = p.evaluate({ match: m, samplePlay: () => m.play });
    const end = g.team === 'A' || g.team === 0 ? 7 : -7;
    assert.equal(out.state.priority, 'celebration'); assert.equal(out.state.goalCut, false);
    assert.equal(out.camera.camera, 'gantry'); assert.deepEqual(out.camera.pos, venue.cameras.gantry[0]);
    assert.deepEqual(out.camera.lookAt, [end, 0.45, 0]); assert.equal(out.camera.fov, 50);
    // Origin can be anywhere across the goal mouth; ring reaches 3m before
    // disappearing. Include elevated flash/confetti, not just ground centre.
    for (const z of [-1.5, 0, 1.5]) {
      inFrame(out.camera, [end, 0.35, z]); inFrame(out.camera, [end, 2, z]);
      for (let i = 0; i < 40; i++) {
        const theta = i * Math.PI / 20;
        inFrame(out.camera, [end + 3 * Math.cos(theta), 0.04, z + 3 * Math.sin(theta)]);
      }
    }
    assert.equal(JSON.stringify(m), snapshot, 'direction never mutates stage/play');
  }
});

test('celebration overrides interval/postmatch even outside inPlay or the four-second GOAL cue', async () => {
  for (const g of celebrationGoals.slice(2)) {
    const p = await director({ tableController: tableStub() });
    for (const board of ['GOAL', 'FT', null]) {
      const out = p.evaluate({ match: celebrating(g, 0.8, { board, bug: { inPlay: false } }) });
      assert.equal(out.camera.camera, 'gantry'); assert.equal(out.state.priority, 'celebration');
      assert.equal(out.tableCue, null);
    }
  }
  // No goal metadata: still suppress an otherwise valid postmatch table and
  // keep the authored full-pitch wide, rather than infer an end from players.
  const p = await director({ tableController: tableStub() });
  const out = p.evaluate({ match: match(622, 860, { bug: { celebrating: true } }) });
  assert.equal(out.state.priority, 'celebration'); assert.equal(out.tableCue, null);
  assert.deepEqual(out.camera.lookAt, venue.cameras.gantry[1]);
  for (const x of [-7, 7]) inFrame(out.camera, [x, 0.35, 0]);
});

test('repeated goals, reverse seeks, fresh arrivals and render dt choose identical celebration poses', async () => {
  const p = await director();
  for (const i of [0, 1, 2, 3, 1, 0, 3, 2]) {
    const g = celebrationGoals[i];
    for (const elapsed of [0, 0.02, 0.8, 1.58]) {
      const m = celebrating(g, elapsed);
      const a = p.evaluate({ match: m, dt: 0.02, samplePlay: () => m.play });
      const fresh = await director();
      const b = fresh.evaluate({ match: m, dt: 10, samplePlay: () => m.play });
      assert.deepEqual(a.camera, b.camera); assert.equal(a.state.priority, 'celebration');
      fresh.dispose();
    }
  }
});

test('celebration yields immediately to scorer replay; headcam also wins overlapping flags', async () => {
  const p = await director(), hc = { pos: [1, 1.5, 0], lookAt: [7, 0.35, 0], fov: 68 };
  for (const g of celebrationGoals) {
    const hold = celebrationMap.find(([t]) => t === g.replay_t)[1];
    assert.equal(goalReplayAt(celebrationGoals, celebrationMap, hold - 0.02), null);
    for (const elapsed of [0, 0.02, 2, 4.98]) {
      const replay = goalReplayAt(celebrationGoals, celebrationMap, hold + elapsed);
      assert.equal(replay.player, g.player);
      const m = match(g.replay_t, hold + elapsed, { board: 'GOAL', headcam: hc,
        bug: { replay: true, celebrating: elapsed === 0 } });
      const out = p.evaluate({ match: m });
      assert.equal(out.state.priority, 'headcam'); assert.deepEqual(out.camera.pos, hc.pos);
    }
    assert.equal(goalReplayAt(celebrationGoals, celebrationMap, hold + 5), null);
    const out = p.evaluate({ match: match(g.replay_t, hold + 5, { bug: { inPlay: true, celebrating: false } }) });
    assert.equal(out.state.priority, 'play'); assert.equal(out.camera.camera, 'gantry');
  }
});

test('legacy goals keep immediate replay and the existing scoreboard fallback', async () => {
  const legacy = [{ type: 'goal', t: 100, player: 'p0', team: 0, replay_s: 5 }];
  const map = [[-180, 0], [100, 280], [100, 285], [640, 825]];
  assert.equal(goalReplayAt(legacy, map, 280).player, 'p0');
  const p = await director();
  const m = match(100, 280, { goals: legacy, board: 'GOAL', programme: { map },
    headcam: { pos: [1, 1, 1], lookAt: [7, 0.35, 0] }, bug: { replay: true } });
  assert.equal(p.evaluate({ match: m }).state.priority, 'headcam');
  assert.equal(p.evaluate({ match: { ...m, headcam: null } }).camera.camera, 'scoreboard');
});

test('rounded final celebration reaches postmatch immediately after replay, with the original table origin', async () => {
  // Literal endpoints from the isolated delivered four-goal bundle. The last
  // near-flat segment used to leave celebration/dead true for 4.77 seconds.
  const g = { type: 'goal', t: 23.42, source_t: 18.62, replay_t: 25.020000000000003,
    celebration_s: 1.6, replay_s: 5, team: 'A', player: 'r0' };
  const prog = { map: [[-180, 0], [25.02, 208.34], [25.02, 213.34],
    [25.02, 213.34], [25.020000000000003, 222.88], [205.02, 402.88]], duration_s: 402.88 };
  const clock = { halves: 1, duration_s: 6,
    buzzers: [{ kind: 'full', t: 23.11, play_end_t: g.replay_t }] };
  const p = await director({ tableController: tableStub() });
  for (const programmeT of [208.34, 213.339, 213.34, 213.36, 214, 218, 222.88]) {
    const replay = goalReplayAt([g], prog.map, programmeT);
    const t = 25.02; // the rounded held instant, including the entire postlude
    const m = match(t, programmeT, { programme: prog, clockPlan: clock, goals: [g],
      headcam: replay ? { pos: [1, 2, 3], lookAt: [3, 2, 1] } : null,
      bug: { ...matchPeriod({ clock, events: [g] }, t), t, programmeT, replay: !!replay } });
    for (const variant of [m, { ...m, ball: null },
      { ...m, programme: { ...prog, map: prog.map.slice(1) } }]) {
      const out = p.evaluate({ match: variant });
      assert.equal(out.state.priority, replay ? 'headcam' : 'postmatch', `programme ${programmeT}`);
      if (!replay) {
        assert.equal(out.state.phase, 'postmatch');
        assert.equal(out.camera.camera, 'heli');
        near(out.state.phaseOrigin, 208.34); // existing FIRST edge of exact instant
        assert.ok(out.tableCue, 'rest evidence is not rejected by binary rounding');
        near(out.tableCue.elapsed, programmeT - 208.34 - 0.7);
      }
    }
  }
});
