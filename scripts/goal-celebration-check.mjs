// Offline source/presentation/programme regression: node --test scripts/goal-celebration-check.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { goalReplayAt, goalHoldAt, celebrationPause, beforeTime } from '../public/js/goal-celebration.mjs';
import { matchPeriod, mmss } from '../public/js/match-clock.mjs';

const first = { type: 'goal', t: 100, source_t: 100, replay_t: 104, celebration_s: 4, replay_s: 8, player: 'a', team: 0 };
const second = { type: 'goal', t: 107, source_t: 103, replay_t: 111, celebration_s: 4, replay_s: 5, player: 'b', team: 1 };
const goals = [first, second];
const map = [[-180, 0], [104, 284], [104, 292], [111, 299], [111, 307], [630, 826]];
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test('legacy replay holds still use t and replay_s, including the missing-length fallback and track floor', () => {
  const legacy = [{ type: 'goal', t: 100, replay_s: 8 }];
  const oldMap = [[-180, 0], [100, 280], [100, 288], [617, 805]];
  near(goalReplayAt(legacy, oldMap, 280).t, 92);
  near(goalReplayAt(legacy, oldMap, 284).t, 96);
  near(goalReplayAt([{ type: 'goal', t: 100 }], oldMap, 284).t, 96);
  near(goalReplayAt(legacy, oldMap, 280, 94).t, 94);
  assert.equal(goalReplayAt(legacy, oldMap, 288), null);
  assert.equal(goalReplayAt(legacy, oldMap, 279.99), null);
});

test('hold matches replay_t, not the scoring frame; first replay shows the shot, never the explosion', () => {
  assert.equal(goalReplayAt(goals, [[100, 280], [100, 288]], 284), null);
  for (let p = 284; p < 292; p += 0.125) {
    const replay = goalReplayAt(goals, map, p);
    near(replay.t, 92 + p - 284);
    assert.equal(replay.goalT, 104);
    assert.equal(replay.player, 'a');
    assert.ok(replay.t < 100);
  }
  assert.equal(goalReplayAt(goals, map, 292), null);
});

test('second replay maps every source sample through prior celebration shifts, even across the first goal', () => {
  // Five source seconds [98, 103], stretched over the eight-second hold.
  near(goalReplayAt(goals, map, 299).t, 98);
  near(goalReplayAt(goals, map, 302.2).t, 100); // scoring pose, before first insert
  near(goalReplayAt(goals, map, 303).t, 104.5); // source 100.5 + prior four seconds
  for (let p = 299; p < 307; p += 0.125) {
    const r = goalReplayAt([...goals].reverse(), map, p);
    const source = 98 + (p - 299) * 5 / 8;
    near(r.t, source + (source > 100 ? 4 : 0));
    assert.ok(!(r.t > 100 && r.t < 104), 'never revisit the first explosion');
    assert.ok(r.t < 107, 'never revisit the second explosion');
  }
});

test('invalid optional fields are ignored, never coerced into NaN or a replay of the explosion', () => {
  for (const value of [NaN, Infinity, -1, '4', {}, false]) {
    assert.equal(goalReplayAt([{ ...first, replay_t: value }], map, 288), null);
    assert.equal(goalReplayAt([{ ...first, replay_s: value }], map, 288), null);
    assert.equal(goalReplayAt([{ ...first, source_t: value }], map, 288), null);
    assert.deepEqual(celebrationPause([{ ...first, celebration_s: value }], 0, 103), { elapsed: 0, celebrating: false });
  }
  assert.equal(goalReplayAt([{ ...first, replay_s: 0 }], map, 288), null);
  assert.equal(goalReplayAt(null, map, 288), null);
  assert.equal(goalHoldAt([null, {}, [NaN, 1], [0, Infinity]], 1), null);
  assert.equal(goalHoldAt(map, NaN), null);
  assert.deepEqual(celebrationPause([{ ...first, t: NaN }, { ...first, t: 1e308, celebration_s: 1e308 }], 0, 103), { elapsed: 0, celebrating: false });
  // Invalid unrelated events do not affect a valid second replay.
  near(goalReplayAt([null, { ...first, type: 'shot' }, { ...first, source_t: '100' }, second], map, 303).t, 100.5);
});

// Execute the actual host method bodies with an in-memory stage: no copied
// replay/score logic, renderer, network, or SDK needed. Browser absolute imports
// prevent importing the complete module in plain Node (a CommonJS package).
const host = readFileSync(new URL('../public/js/venue-modules/match-4dgsx.js', import.meta.url), 'utf8');
const pa = readFileSync(new URL('../public/js/pa-system.js', import.meta.url), 'utf8');
function method(source, name) {
  const start = source.indexOf(`  function ${name}(`);
  assert.ok(start >= 0, `host method ${name} exists`);
  const end = source.indexOf('\n  }', start);
  assert.ok(end > start);
  return source.slice(start, end + 4);
}
const unmapStart = pa.indexOf('export function unmapTime(');
const unmap = pa.slice(unmapStart, pa.indexOf('\n}', unmapStart) + 2).replace('export ', '');
function hostHarness() {
  const state = { now: { loop: false }, match: { state: 'replay' } };
  const stage = { t0: 0, time: 0, score: { a: 0, b: 0 }, seek(t) { this.time = t; }, hud: {
    teams: [{ code: 'A' }, { code: 'B' }], events: goals,
    score: [{ t: 0, a: 0, b: 0 }, { t: 100, a: 1, b: 0 }, { t: 107, a: 1, b: 1 }],
    clock: { halves: 2, duration_s: 600, buzzers: [{ kind: 'half', t: 308, restart_t: 325 }, { kind: 'full', t: 625 }] },
  } };
  const api = new Function('stage', 'state', 'goals', 'goalReplayAt', 'matchPeriod', 'mmss', 'programme', `
    let programmeT = 0;
    const replayCam = true, wallDrive = null;
    const driving = () => true;
    ${unmap}
    const programmeMatchT = () => unmapTime(programme.map, programmeT);
    const stemSeconds = () => programmeT;
    ${method(host, 'scoreAtT')}
    ${method(host, 'buildBug')}
    ${method(host, 'driveProgramme')}
    return { seek(p) { programmeT = p; driveProgramme(0); return buildBug(); },
      advance(dt) { driveProgramme(dt); return buildBug(); } };
  `)(stage, state, goals, goalReplayAt, matchPeriod, mmss, { map, duration_s: 826 });
  return { ...api, state, stage };
}

test('real driveProgramme/buildBug: replay seeks match continuous playback and retain the postgoal score', () => {
  const running = hostHarness();
  running.seek(283);
  for (const p of [284, 286, 288, 291.9, 292, 298, 299, 301, 303, 306.9, 307]) {
    const joined = hostHarness();
    const expected = joined.seek(p);
    // advance from the exact prior programme position
    const currentP = running.state.bugP ?? 283;
    const actual = running.advance(p - currentP);
    running.state.bugP = p;
    assert.deepEqual(actual, expected, `programme ${p}`);
    near(running.stage.time, joined.stage.time);
    assert.equal(actual.a, 1);
    assert.equal(actual.b, p >= 298 ? 1 : 0);
    if (running.state.replay) {
      assert.equal(actual.replay, true);
      assert.ok(actual.t > running.stage.time);
      assert.ok(actual.playing);
    }
  }
  // Backward/forward seeks have no previous-frame or timer dependency.
  for (const p of [303, 286, 306, 284, 299]) {
    assert.deepEqual(running.seek(p), hostHarness().seek(p));
  }
  const celebration = running.seek(282); // presentation t=102, before the first replay hold
  assert.equal(celebration.celebrating, true);
  assert.equal(celebration.playing, true);
  assert.equal(celebration.clock, '03:20');
  assert.equal(celebration.a, 1);
});

 test('decimal-rounded replay boundary is not still celebrating', () => {
  const goal={type:'goal',t:.8,celebration_s:1.6,replay_t:2.4};
  assert.equal(celebrationPause([goal],0,2.4).celebrating,false);
  assert.equal(celebrationPause([goal],0,2.399).celebrating,true);
  near(celebrationPause([goal],0,2.4).elapsed,1.6);
});

// Real four-goal export: the map is decimal-rounded but the HUD end is a sum.
test('rounded final hold ends celebration and dead ball, without swallowing the last real sample', () => {
  const g = { type: 'goal', t: 23.42, source_t: 18.62, celebration_s: 1.6,
    replay_t: 25.020000000000003, replay_s: 5, team: 'A', player: 'r0' };
  const hud = { events: [g], clock: { halves: 1, duration_s: 6,
    buzzers: [{ kind: 'full', t: 23.11, play_end_t: g.replay_t }] } };
  for (const t of [25.02, g.replay_t, 25.020001]) {
    assert.equal(celebrationPause([g], t, t).celebrating, false, `celebration at ${t}`);
    const p = matchPeriod(hud, t);
    assert.equal(p.celebrating, false);
    assert.equal(p.dead, false);
    assert.equal(p.inPlay, false);
  }
  for (const t of [23.42, 25, 25.019999]) {
    const p = matchPeriod(hud, t);
    assert.equal(p.celebrating, true, `last real celebration sample ${t}`);
    assert.equal(p.dead, true);
  }
  near(celebrationPause([g], 0, 25.02).elapsed, 1.6);
});


test('endpoint equality is arithmetic noise only, not a sample or a millisecond tolerance', () => {
  assert.equal(beforeTime(25.02, 25.020000000000003), false);
  assert.equal(beforeTime(8.100, 8.104), true);
  assert.equal(beforeTime(25.02 - 1e-6, 25.02), true);
  assert.equal(beforeTime(600, 600 + 1e-6), true);
  assert.equal(beforeTime(0, 0.000001), true);
});
