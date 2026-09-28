// A goal's replay as a BROADCAST picture (RFL, 2026-09-27; restart_phase
// bundles from m76). The pitch no longer re-runs the goal: the robots walk
// back live, and the television cuts to a video RFL render themselves — two
// or three angles, real 500 Hz slow motion — for a window over that walk-back,
// then cuts back to the stadium.
//
// Pure timing only: which replay is on air at a match time, which to fetch
// ahead of it, and where in its file the picture should be. No DOM, clock or
// renderer, so the director, the page and `node --test` agree on the window.

const finite = Number.isFinite;

/** A replay event usable as a media cut: a positive window and a file in the bundle. */
function usable(r) {
  return r && finite(r.t) && r.t >= 0 && finite(r.dur_s) && r.dur_s > 0 && typeof r.src === 'string' && !!r.src;
}

/**
 * The replay on air at match time t: `[t, t + dur_s)`, or null.
 *
 * A replay without `src` is never on air; RFL: "if one is ever missing,
 * please show the live stadium for that window rather than re-running the
 * goal on the pitch". `elapsed` is where in the file the picture is.
 */
export function replayWindowAt(replays, t) {
  if (!Array.isArray(replays) || !finite(t)) return null;
  let on = null;
  for (const r of replays) {
    if (!usable(r) || t < r.t || t >= r.t + r.dur_s) continue;
    if (!on || r.t > on.t) on = r;   // overlapping windows: the later cut wins
  }
  return on ? { src: on.src, t: on.t, dur_s: on.dur_s, elapsed: t - on.t,
    player: on.player ?? null, goal_t: on.goal_t ?? null, source: on.source ?? null } : null;
}

/**
 * The replay worth fetching at match time t: the next window starting within
 * `leadS`, or the one on air. RFL's windows start about five seconds after
 * the goal, so a lead of 20 s begins the download with the goal itself.
 */
export function replayToLoad(replays, t, leadS = 20) {
  if (!Array.isArray(replays) || !finite(t)) return null;
  const on = replayWindowAt(replays, t);
  if (on) return on;
  let next = null;
  for (const r of replays) {
    if (!usable(r) || r.t <= t || r.t - t > leadS) continue;
    if (!next || r.t < next.t) next = r;
  }
  return next ? { src: next.src, t: next.t, dur_s: next.dur_s, elapsed: 0,
    player: next.player ?? null, goal_t: next.goal_t ?? null, source: next.source ?? null } : null;
}

/**
 * Whether a playing video has drifted far enough from the programme to seek.
 * Playback runs on the media clock between checks; a seek is a stall, so it
 * is only worth one when the picture is visibly off the programme.
 */
export const REPLAY_SYNC_TOLERANCE_S = 0.25;
export function replayNeedsSeek(currentTime, want, tolerance = REPLAY_SYNC_TOLERANCE_S) {
  return !finite(currentTime) || !finite(want) || Math.abs(currentTime - want) > tolerance;
}
