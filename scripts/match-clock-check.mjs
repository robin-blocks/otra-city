// The stadium's clock, held to the publisher's real clock block.
//
//   node --test scripts/match-clock-check.mjs
//
// s3-m42's hud.clock as the bundle ships it (cdn.4dgsx.com, read 2026-09-21):
// two halves of 300 s, the half-time buzzer at 300 with the ball at rest at
// 305 and the restart at 317, the full-time buzzer at 617, ball at rest 622.
import test from 'node:test';
import assert from 'node:assert/strict';
import { matchPeriod, mmss, boardClock } from '../public/js/match-clock.mjs';

const HUD = { clock: {
  mode: 'down', duration_s: 600, play_end_s: 622, halves: 2, half_breaks: [300],
  buzzers: [
    { kind: 'half', t: 300, play_end_t: 305, dead_s: 5, ended: 'ball at rest', restart_t: 317 },
    { kind: 'full', t: 617, play_end_t: 622, dead_s: 5, ended: 'ball at rest', restart_t: null },
  ],
} };
const board = (t) => boardClock(matchPeriod(HUD, t), t);
// What the SDK stage's own `clock` reads at the first frame of the track,
// where a seek into the pre-roll clamps: `duration_s - 0.002`, floored.
const stageClockAtFirstFrame = (() => { const o = 600 - 0.002; return `${Math.floor(o / 60)}:${String(Math.floor(o % 60)).padStart(2, '0')}`; })();

test('the SDK stage reads 9:59 through the build-up, which is the number the board must never show', () => {
  assert.equal(stageClockAtFirstFrame, '9:59');
  for (let t = -180; t < 0; t += 0.5) {
    const b = board(t);
    assert.notEqual(b.clock, '09:59', `t=${t}`);
    assert.equal(b.label, 'KICK-OFF IN', `t=${t}`);
  }
});

test('the build-up counts down to the whistle, 03:00 at the stream start and 00:00 at the ball', () => {
  assert.deepEqual(board(-180), { label: 'KICK-OFF IN', clock: '03:00' });
  assert.deepEqual(board(-116), { label: 'KICK-OFF IN', clock: '01:56' });   // m42's mount, +64 s
  assert.deepEqual(board(-20), { label: 'KICK-OFF IN', clock: '00:20' });
  assert.deepEqual(board(-0.4), { label: 'KICK-OFF IN', clock: '00:00' });
});

test('in play the board shows the half and what is left of it', () => {
  assert.deepEqual(board(0), { label: 'FIRST HALF', clock: '05:00' });
  assert.deepEqual(board(1), { label: 'FIRST HALF', clock: '04:59' });
  assert.deepEqual(board(299.6), { label: 'FIRST HALF', clock: '00:00' });
  assert.deepEqual(board(317), { label: 'SECOND HALF', clock: '05:00' });
  assert.deepEqual(board(400), { label: 'SECOND HALF', clock: '03:37' });
});

test('the interval and full time are named, not a clock reading 00:00 twice', () => {
  for (const t of [300, 304.9, 310, 316.9]) assert.deepEqual(board(t), { label: 'HALF TIME', clock: '00:00' }, `t=${t}`);
  for (const t of [617, 621, 622, 700]) assert.deepEqual(board(t), { label: 'FULL TIME', clock: '00:00' }, `t=${t}`);
  // the buzzer stops the clock, not the ball: the period says so
  assert.equal(matchPeriod(HUD, 302).dead, true);
  assert.equal(matchPeriod(HUD, 306).dead, false);
});

test('the board and the scorebug are one function of one time', () => {
  for (let t = -180; t <= 640; t += 0.25) {
    const p = matchPeriod(HUD, t);
    const scorebug = mmss(p.preroll ? -t : p.remain);
    assert.equal(board(t).clock, scorebug, `t=${t}`);
  }
});

test('a bundle without a clock block has no board line, and the stage clock is all that is left', () => {
  assert.equal(matchPeriod({}, 10), null);
  assert.equal(boardClock(null, 10), null);
});


const goal = (t, celebration_s) => ({ type: 'goal', t, celebration_s });
const withGoals = (events, buzzers = HUD.clock.buzzers) => ({ events, clock: { ...HUD.clock, buzzers } });

test('two celebrations freeze the playing clock, not the period, and both buzzer times stay authoritative', () => {
  const hud = withGoals([goal(100, 4), goal(204, 6), goal(400, 10)], [
    { kind: 'half', t: 310, play_end_t: 315, restart_t: 327 },
    { kind: 'full', t: 637, play_end_t: 642 },
  ]);
  for (const [t, remain, celebrating] of [
    [99, 201, false], [100, 200, true], [102, 200, true], [104, 200, false],
    [105, 199, false], [204, 100, true], [207, 100, true], [210, 100, false],
    [300, 10, false], [327, 300, false], [400, 227, true], [405, 227, true],
    [410, 227, false], [411, 226, false],
  ]) {
    const p = matchPeriod(hud, t);
    assert.equal(p.remain, remain, `t=${t}`);
    assert.equal(p.celebrating, celebrating, `t=${t}`);
    assert.equal(p.playing, true, `t=${t}`);
    assert.equal(p.inPlay, true, `t=${t}`);
    assert.notEqual(boardClock(p, t).label, 'HALF TIME');
  }
  assert.equal(matchPeriod(hud, 310).tag, 'Half Time');
  assert.equal(matchPeriod(hud, 312).dead, true);
  assert.equal(matchPeriod(hud, 315).dead, false);
  assert.equal(matchPeriod(hud, 637).tag, 'Full Time');
  assert.equal(matchPeriod(hud, 640).dead, true);
  assert.equal(matchPeriod(hud, 642).inPlay, false);
});

test('nested, duplicated, touching and overlapping celebration intervals subtract their union once', () => {
  const events = [goal(105, 5), goal(100, 20), goal(119, 6), goal(125, 5), goal(100, 20)];
  const hud = withGoals(events);
  assert.equal(matchPeriod(hud, 99).remain, 201);
  for (const t of [100, 105, 109, 111, 120, 125, 129.9, 130]) {
    assert.equal(matchPeriod(hud, t).remain, 200, `t=${t}`);
  }
  assert.equal(matchPeriod(hud, 131).remain, 199);
  assert.equal(matchPeriod(hud, 130).celebrating, false);
  assert.deepEqual(matchPeriod(hud, 115), matchPeriod(withGoals([...events].reverse()), 115));
});

test('celebrations at both buzzers preserve dead-ball truth; nested overlap never subtracts the break twice', () => {
  const events = [goal(298, 5), goal(302, 10), goal(304, 2), goal(310, 12), goal(319, 1),
    goal(619, 10), goal(620, 2)];
  const hud = withGoals(events);
  for (const t of [300, 302, 304.9, 305, 310, 316.9]) {
    const p = matchPeriod(hud, t);
    assert.equal(p.tag, 'Half Time');
    assert.equal(p.playing, false);
    assert.equal(p.remain, 0);
    assert.equal(p.dead, t < 305);
    assert.equal(p.celebrating, true);
  }
  // The union at the interval is [298, 322]. Only [317, 322]
  // belongs to the second half: nested events cannot reduce its right edge.
  for (const t of [317, 319, 321, 322]) assert.equal(matchPeriod(hud, t).remain, 300, `t=${t}`);
  assert.equal(matchPeriod(hud, 323).remain, 299);
  for (const t of [617, 619, 621.9, 622, 628, 629]) {
    const p = matchPeriod(hud, t);
    assert.equal(p.tag, 'Full Time');
    assert.equal(p.over, true);
    assert.equal(p.playing, false);
    assert.equal(p.remain, 0);
    assert.equal(p.dead, t < 622);
    assert.equal(p.inPlay, t < 622);
    assert.equal(p.celebrating, t >= 619 && t < 629);
  }
});

test('malformed celebration fields and clock metadata cannot poison the remaining seconds', () => {
  const invalid = [null, {}, { type: 'shot', t: 100, celebration_s: 4 }];
  for (const bad of [NaN, Infinity, -1, '4', {}, false, null, undefined]) {
    invalid.push(goal(100, bad), goal(bad, 4));
  }
  invalid.push(goal(100, 0), goal(1e308, 1e308));
  for (const events of [invalid, null, {}, 'goals']) {
    for (const t of [0, 100, 103, 299, 300, 317, 400, 617]) {
      assert.deepEqual(matchPeriod(withGoals(events), t), matchPeriod(HUD, t));
      assert.ok(Number.isFinite(matchPeriod(withGoals(events), t).remain));
    }
  }
  const hud = withGoals([], [null, { kind: 'half', t: '100', restart_t: 120 },
    { kind: 'half', t: 100, restart_t: NaN }, { kind: 'half', t: 100, restart_t: 90 },
    { kind: 'full', t: Infinity }, ...HUD.clock.buzzers]);
  assert.deepEqual(matchPeriod(hud, 400), matchPeriod(HUD, 400));
  assert.ok(Number.isFinite(matchPeriod({ clock: { duration_s: NaN, halves: '2' } }, 1).remain));
  assert.equal(matchPeriod(HUD, NaN), null);
  assert.equal(matchPeriod(HUD, Infinity), null);
});
