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
