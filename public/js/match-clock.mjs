// The match clock as a broadcast reads it — which half, how long is left of
// it, whether the whistle has gone — and the two lines a scoreboard draws
// from that. Pure: hud truth and a match time in, strings out. It lives on
// its own so the stadium's boards and the scorebug cannot disagree, and so
// `node --test` can hold it to the publisher's real clock block without a
// three.js renderer in the room (scripts/match-clock-check.mjs).

export const HALF_NAMES = ['First Half', 'Second Half', 'Third Period', 'Fourth Period'];

/**
 * Where a match is in its own programme: which half, how long is left of it,
 * and whether the whistle has gone.
 *
 * The publisher's `hud.clock` block is the whole of it. From m27:
 *
 *   { mode:"down", duration_s:600, halves:2, half_breaks:[300],
 *     buzzers:[ {kind:"half", t:300, play_end_t:305, restart_t:317},
 *               {kind:"full", t:617, …} ] }
 *
 * Two things about it are easy to get wrong, and RFL warned about both.
 *
 * The stage's own `clock` counts down across the WHOLE match — `duration_s - t`,
 * which we read out of their SDK — while a scorebug counts down within the
 * current half. So the halves are derived here rather than taken from it.
 *
 * And the clock runs on PLAYING time: it stops at the buzzer and does not move
 * again until play restarts. The break is therefore a period of its own, from
 * `buzzers[i].t` to `restart_t`, during which the clock reads nothing left.
 */
export function matchPeriod(hud, t) {
  const p = periodOf(hud, t);
  if (!p) return null;
  // THE WHISTLE IS NOT THE END OF THE PLAY, and the publisher has already
  // measured the difference. Each buzzer carries `play_end_t` with
  // `"ended": "ball at rest"` beside it — on m28, five seconds after both the
  // half-time and the full-time buzzer. The clock stops at the buzzer, which
  // is what a clock does; the ball is still travelling, which is what the
  // director needs to know before it cuts away from the wide.
  const dead = (Array.isArray(hud?.clock?.buzzers) ? hud.clock.buzzers : [])
    .some((b) => Number.isFinite(b?.t) && Number.isFinite(b?.play_end_t) && t >= b.t && t < b.play_end_t);
  return { ...p, dead, inPlay: p.playing || dead };
}

/** Which period the clock is in, ignoring the dead ball after a buzzer. */
export function periodOf(hud, t) {
  const c = hud?.clock;
  if (!c || !Number.isFinite(t)) return null;
  const halves = Math.max(1, c.halves || 1);
  const halfLen = (c.duration_s || 0) / halves;
  // Before kick-off the clock has not started. Without this the first half
  // reads 8:00 at t = -180, because the arithmetic is happy to count a half
  // that has not begun.
  if (t < 0) return { tag: HALF_NAMES[0], remain: halfLen, half: 1, over: false, playing: false, preroll: true };
  const buzzers = Array.isArray(c.buzzers) ? c.buzzers : [];
  const breaks = buzzers.filter((b) => b.kind === 'half').sort((a, b) => a.t - b.t);
  const full = buzzers.find((b) => b.kind === 'full');

  if (full && t >= full.t) return { tag: 'Full Time', remain: 0, half: halves, over: true, playing: false };

  for (let i = 0; i < halves; i += 1) {
    const start = i === 0 ? 0 : (breaks[i - 1]?.restart_t ?? 0);
    const end = breaks[i]?.t ?? (full?.t ?? Infinity);
    if (t < end) {
      return { tag: HALF_NAMES[i] || `Period ${i + 1}`, remain: Math.max(0, halfLen - (t - start)),
               half: i + 1, over: false, playing: true };
    }
    // between the buzzer and the restart: the interval
    const restart = breaks[i]?.restart_t;
    if (restart !== undefined && t < restart) {
      return { tag: 'Half Time', remain: 0, half: i + 1, over: false, playing: false };
    }
  }
  return { tag: 'Full Time', remain: 0, half: halves, over: true, playing: false };
}

/** m:ss, the way a clock is read rather than the way a duration is written. */
export function mmss(seconds) {
  const s = Math.max(0, Math.round(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * The scoreboard's two lines for a period: a heading and the number under it.
 *
 * ONE CLOCK, READ FROM ONE PLACE. Until 2026-09-21 the stadium scoreboard
 * painted the SDK stage's own `clock` string once a match was mounted, and
 * the scorebug painted the programme's. Through the build-up those are not
 * the same number: the stage's track starts at the first frame of the match,
 * a seek into the pre-roll clamps to it, and `duration_s - 0.002` floors to
 * "9:59" — which is what the board said, without moving, for the three
 * minutes the scorebug beside it counted down to the whistle. Robin watched
 * it do that on m42, 2026-09-21 12:00.
 *
 * So the board takes the period the scorebug already derives, and reads it
 * the same way: a countdown to KICK-OFF through the pre-roll, the half's own
 * clock in play, and the interval and full time named for what they are.
 * The number is the scorebug's number, to the second, because it is the same
 * function of the same programme time.
 */
export function boardClock(period, t) {
  if (!period) return null;
  if (period.preroll) return { label: 'KICK-OFF IN', clock: mmss(-t) };
  if (period.over) return { label: 'FULL TIME', clock: mmss(0) };
  if (!period.playing) return { label: 'HALF TIME', clock: mmss(0) };
  return { label: String(period.tag || '').toUpperCase(), clock: mmss(period.remain) };
}
