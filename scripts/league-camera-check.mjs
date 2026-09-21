// Offline regressions for the live director's 54s table / 45s aerial boundary.
// Run: node --test scripts/league-camera-check.mjs
// Execute the actual cameraAt declaration, not a copy of its decision logic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script, createContext } from 'node:vm';

const html = readFileSync(new URL('../public/broadcast.html', import.meta.url), 'utf8');
// Top-level function closing braces are unindented in broadcast.html.
const declarations = [...html.matchAll(/^function cameraAt\(name, frameNo\) \{[\s\S]*?^\}/gm)];
assert.equal(declarations.length, 1, 'extract exactly one production cameraAt declaration');
const cameraScript = new Script(declarations[0][0], { filename: 'broadcast.html:cameraAt' });
const FPS = 50;
const CUT_FRAME = 45 * FPS;
const TABLE_END = 54 * FPS;
const ORIGIN = 500; // Nonzero: an automatic cut-list uses its own clock, not absolute frames.
const CROSSING = ORIGIN + CUT_FRAME;
const PARAMS = Object.freeze({ radius_m: 52, height_m: 30, vfov_deg: 46 });
// Deliberately simple motion makes stale poses / wrong time / seed / params observable.
const pose = (t, seed, p) => ({
  pos: [t, seed, p.radius_m], lookAt: [0, t, p.height_m], fov: p.vfov_deg, roll: t / 100,
});
const shot = (frame) => ({
  ...pose(frame / FPS, 11, PARAMS), camera: 'heli', segment: 0,
  t: frame / FPS, seed: 11, params: PARAMS,
});

function fixture({ visible = true } = {}) {
  const calls = { ambient: [], match: [], track: [], heli: [], directed: [] };
  const screen = { camera: 'screen_main', segment: 1, pos: [1, 2, 3], lookAt: [0, 1, 0] };
  const gantry = { camera: 'gantry', segment: 0, pos: [4, 5, 6], lookAt: [0, 0, 0] };
  const scoreboard = { pos: [7, 8, 9], lookAt: [0, 2, 0] };
  const ambientCut = { at(frame) {
    calls.ambient.push(frame);
    return frame < CUT_FRAME ? shot(frame) : screen;
  } };
  const matchCut = { at(frame) { calls.match.push(frame); return gantry; } };
  const state = {
    visible,
    match: { phase: 'match', bug: { over: true, inPlay: false, preroll: false, replay: false } },
  };
  const context = createContext({
    FPS, DEFAULT_FOV: 50, seed: 99, autoDirect: true, live: true,
    track: null, ambientCut, matchCut, cutNow: ambientCut, cutFrom: ORIGIN,
    lastTrackCam: null, goalCut: false, settleUntil: 0,
    leagueAerial: { ...shot(CUT_FRAME - 1), frame: CROSSING - 1 },
    postMatchTable: { state: () => ({ visible: state.visible }) },
    matchState: () => state.match,
    namedCamera: (name) => ({ scoreboard, screen_main: screen })[String(name).toLowerCase()] ?? null,
    directed: (c) => { calls.directed.push(c); return c; },
    ANIMATED: new Set(['heli', 'stands', 'pitchside']),
    CAMERAS: { heli(t, seed, params) {
      calls.heli.push({ t, seed, params });
      return pose(t, seed, params);
    } },
  });
  cameraScript.runInContext(context, { timeout: 1000 });
  const cameraAt = (frame, name = 'gantry') => context.cameraAt(name, frame);
  // Model only draw()'s previous-frame feedback; all camera/clock decisions
  // above are made by the extracted production function.
  const draw = (frame) => {
    const c = cameraAt(frame);
    context.leagueAerial = state.visible && c?.camera === 'heli' ? { ...c, frame } : null;
    return c;
  };
  return { context, calls, state, screen, gantry, scoreboard, cameraAt, draw };
}

function near(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${message}: ${actual} vs ${expected}`);
}

function assertAnimated(f, c, seconds) {
  assert.equal(c.camera, 'heli');
  assert.equal(c.held, true);
  near(c.t, seconds, 'aerial time keeps advancing');
  near(c.pos[0], seconds, 'position is regenerated');
  near(c.lookAt[1], seconds, 'aim is regenerated');
  near(c.roll, seconds / 100, 'roll is regenerated');
  assert.equal(c.pos[1], 11, 'shot seed, not the global seed');
  assert.equal(c.pos[2], PARAMS.radius_m);
  assert.equal(c.fov, 46);
  assert.equal(c.params, PARAMS);
  assert.equal(c.segment, 0);
  assert.equal(f.calls.heli.at(-1).params, PARAMS);
  near(f.calls.heli.at(-1).t, seconds, 'CAMERAS.heli receives advancing time');
  assert.equal(f.context.lastTrackCam, c);
}

test('without a visible table the ordinary 45s aerial cuts to screen_main', () => {
  const f = fixture({ visible: false });
  assert.equal(f.cameraAt(CROSSING - 1).camera, 'heli');
  assert.equal(f.cameraAt(CROSSING), f.screen);
  assert.deepEqual(f.calls.ambient, [CUT_FRAME - 1, CUT_FRAME]);
  assert.equal(f.context.cutFrom, ORIGIN);
  assert.equal(f.calls.heli.length, 0);
  assert.equal(f.context.lastTrackCam, f.screen);
  assert.equal(f.calls.directed.at(-1), f.screen);
});

test('a visible table does not hold early: the original animated shot runs to its boundary', () => {
  const f = fixture();
  const c = f.cameraAt(CROSSING - 1);
  assert.equal(c.camera, 'heli');
  assert.equal(c.held, undefined);
  assert.equal(f.calls.heli.length, 0);
  assert.equal(f.context.cutFrom, ORIGIN);
  assert.equal(f.calls.directed[0], c);
});

test('first held frame animates the heli but leaves cutFrom AT the pending next shot (no rewind)', () => {
  const f = fixture();
  const c = f.draw(CROSSING);
  assertAnimated(f, c, 45);
  assert.equal(f.context.cutFrom, ORIGIN, 'do not rewind the crossing frame');
  assert.equal(CROSSING - f.context.cutFrom, CUT_FRAME, 'screen_main is already pending');
  assert.deepEqual(f.calls.ambient, [CUT_FRAME]);
  assert.equal(f.calls.directed.length, 0, 'held pose bypasses pending-shot direction');
});

test('subsequent held frames defer the cut clock while aerial time advances, including skipped frames', () => {
  const f = fixture();
  const first = f.draw(CROSSING);
  for (const delta of [1, 7, 100, 449]) {
    const c = f.draw(CROSSING + delta);
    assertAnimated(f, c, 45 + delta / FPS);
    assert.notDeepEqual(c.pos, first.pos, 'not a frozen aerial');
    assert.equal(f.context.cutFrom, ORIGIN + delta);
    assert.equal(CROSSING + delta - f.context.cutFrom, CUT_FRAME, 'pending shot stays parked');
  }
  const clock = f.context.cutFrom;
  assertAnimated(f, f.draw(CROSSING + 449), 53.98);
  assert.equal(f.context.cutFrom, clock, 'redrawing a held frame does not defer twice');
});

test('if the table clears on the first held frame, the same frame selects screen_main, never the old heli', () => {
  const f = fixture();
  f.draw(CROSSING);
  f.state.visible = false; // Keep the previous-frame aerial populated, as draw() does.
  assert.equal(f.cameraAt(CROSSING), f.screen);
  assert.equal(f.context.cutFrom, ORIGIN);
  assert.equal(f.context.lastTrackCam, f.screen);
  assert.equal(f.calls.heli.length, 1);
});

test('the table retains an animated aerial through 53.98s and releases to screen_main at 54s', () => {
  const f = fixture();
  for (let local = CUT_FRAME; local < TABLE_END; local++) {
    assertAnimated(f, f.draw(ORIGIN + local), local / FPS);
    assert.equal(f.context.cutFrom, ORIGIN + local - CUT_FRAME);
  }
  const parked = f.context.cutFrom;
  f.state.visible = false;
  assert.equal(f.draw(ORIGIN + TABLE_END), f.screen, 'no extra aerial on the clearing frame');
  assert.equal(f.context.leagueAerial, null, 'draw feedback drops the expired aerial');
  assert.equal(f.context.cutFrom, parked, 'clearing frame does not defer the cut');
  assert.equal(f.calls.ambient.at(-1), CUT_FRAME + 1);
  assert.equal(f.calls.heli.length, (54 - 45) * FPS);
  assert.equal(f.cameraAt(ORIGIN + TABLE_END + 1), f.screen);
  assert.equal(f.calls.ambient.at(-1), CUT_FRAME + 2, 'normal cut clock resumes');
});

test('play switches to matchCut even with a visible table and a previously held aerial', () => {
  const f = fixture();
  f.draw(CROSSING);
  f.state.match.bug = { over: false, inPlay: true };
  f.context.cutNow = f.context.matchCut;
  f.context.cutFrom = CROSSING; // updateDirector() restarts the selected list.
  assert.equal(f.cameraAt(CROSSING + 1), f.gantry);
  assert.deepEqual(f.calls.match, [1]);
  assert.equal(f.context.cutFrom, CROSSING);
  assert.equal(f.calls.heli.length, 1);
  assert.equal(f.context.lastTrackCam, f.gantry);
});

for (const [name, patch] of [
  ['play', { inPlay: true }], ['not over', { over: false }],
  ['preroll', { preroll: true }], ['replay', { replay: true }],
]) {
  test(`${name} cannot extend the ambient table aerial`, () => {
    const f = fixture();
    Object.assign(f.state.match.bug, patch);
    assert.equal(f.cameraAt(CROSSING), f.screen);
    assert.equal(f.context.cutFrom, ORIGIN);
    assert.equal(f.calls.heli.length, 0);
  });
}

test('headcam overrides both the held aerial and a goal scoreboard cut', () => {
  const f = fixture();
  f.draw(CROSSING);
  const hc = { pos: [10, 11, 12], lookAt: [1, 2, 3], fov: 67 };
  f.state.match.headcam = hc;
  f.context.goalCut = true;
  const c = f.cameraAt(CROSSING + 1);
  assert.equal(c.camera, 'headcam');
  assert.equal(c.pos, hc.pos);
  assert.equal(c.lookAt, hc.lookAt);
  assert.equal(c.fov, 67);
  assert.equal(c.segment, -1);
  assert.equal(f.context.lastTrackCam, c);
  assert.equal(f.context.cutFrom, ORIGIN);
  assert.equal(f.calls.ambient.length, 1);
  assert.equal(f.calls.heli.length, 1);
});

test('goal scoreboard overrides the held aerial and resets its 46-degree FOV', () => {
  const f = fixture();
  f.draw(CROSSING);
  f.context.goalCut = true;
  const c = f.cameraAt(CROSSING + 1);
  assert.equal(c.camera, 'scoreboard');
  assert.equal(c.pos, f.scoreboard.pos);
  assert.equal(c.lookAt, f.scoreboard.lookAt);
  assert.equal(c.fov, 50);
  assert.equal(c.segment, -1);
  assert.equal(f.context.lastTrackCam, c);
  assert.equal(f.context.cutFrom, ORIGIN);
  assert.equal(f.calls.ambient.length, 1);
  assert.equal(f.calls.heli.length, 1);
});

test('an explicit track keeps absolute frame time and bypasses table, headcam, goal and direction', () => {
  const f = fixture();
  f.draw(CROSSING);
  const explicit = { camera: 'custom', pos: [3, 2, 1], fov: 31 };
  f.context.track = { at(frame) { f.calls.track.push(frame); return explicit; } };
  f.context.goalCut = true;
  f.state.match.headcam = { pos: [1, 1, 1], lookAt: [0, 0, 0] };
  assert.equal(f.cameraAt(CROSSING + 1), explicit);
  assert.deepEqual(f.calls.track, [CROSSING + 1]);
  assert.equal(f.context.lastTrackCam, explicit);
  assert.equal(f.context.cutFrom, ORIGIN);
  assert.equal(f.calls.heli.length, 1);
  assert.equal(f.calls.directed.length, 0);
});

test('autoDirect=false never extends an ambient cut even with a stale visible table cue', () => {
  const f = fixture();
  f.context.autoDirect = false;
  assert.equal(f.cameraAt(CROSSING), f.screen);
  assert.equal(f.context.cutFrom, ORIGIN);
  assert.equal(f.calls.heli.length, 0);
});

test('autoDirect=false leaves an explicitly named camera untouched by table and headcam', () => {
  const f = fixture();
  f.context.autoDirect = false;
  f.context.cutNow = null;
  f.state.match.headcam = { pos: [1, 1, 1], lookAt: [0, 0, 0] };
  assert.equal(f.cameraAt(CROSSING, 'SCREEN_MAIN'), f.screen);
  assert.equal(f.context.cutFrom, ORIGIN);
  assert.equal(f.calls.ambient.length, 0);
  assert.equal(f.calls.heli.length, 0);
});

test('settling, absent table controller or absent previous aerial leaves the ordinary cut alone', () => {
  for (const patch of [{ settleUntil: 1 }, { postMatchTable: null }, { leagueAerial: null }]) {
    const f = fixture();
    Object.assign(f.context, patch);
    assert.equal(f.cameraAt(CROSSING), f.screen);
    assert.equal(f.context.cutFrom, ORIGIN);
    assert.equal(f.calls.heli.length, 0);
  }
});
