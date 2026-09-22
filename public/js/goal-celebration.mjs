// Goal events use presentation time (t), but a replay must revisit the shot
// in source time, not the inserted celebration. No renderer or local timers:
// seeking into a hold must produce exactly the same pose as playing into it.
const finiteTime = (t) => Number.isFinite(t) && t >= 0;
const goalsOnly = (events) => (Array.isArray(events) ? events : []).filter((g) => g?.type === 'goal');

function celebrationEnd(goal) {
  if (!finiteTime(goal?.t) || !Number.isFinite(goal.celebration_s) || goal.celebration_s <= 0) return null;
  const sum = goal.t + goal.celebration_s;
  // Exported replay boundaries are decimal-rounded; .8 + 1.6 is not exactly
  // 2.4 in binary. Honour that same boundary so the replay is not a burst.
  const end = finiteTime(goal.replay_t) && Math.abs(goal.replay_t - sum) < 1e-8
    ? goal.replay_t : sum;
  return Number.isFinite(end) && end > goal.t ? end : null;
}

/** Union of celebration seconds inside [start, t]; never count overlaps twice.
 * A half's start is its restart_t, so its preceding buzzer interval is already
 * excluded. Clipping here also handles a celebration straddling that restart.
 */
export function celebrationPause(events, start, t) {
  if (!Number.isFinite(start) || !Number.isFinite(t) || t < start) return { elapsed: 0, celebrating: false };
  const intervals = [];
  let celebrating = false;
  for (const goal of goalsOnly(events)) {
    const end = celebrationEnd(goal);
    if (end === null) continue;
    if (t >= goal.t && t < end) celebrating = true;
    const lo = Math.max(start, goal.t), hi = Math.min(t, end);
    if (hi > lo) intervals.push([lo, hi]);
  }
  intervals.sort((a, b) => a[0] - b[0]);
  let elapsed = 0, edge = start;
  for (const [lo, hi] of intervals) {
    elapsed += Math.max(0, hi - Math.max(lo, edge));
    edge = Math.max(edge, hi);
  }
  return { elapsed, celebrating };
}

/** The programme hold containing p, if its endpoints are valid. */
export function goalHoldAt(map, p) {
  if (!Array.isArray(map) || !Number.isFinite(p)) return null;
  for (let i = 0; i < map.length - 1; i += 1) {
    const a = map[i], b = map[i + 1];
    if (!Array.isArray(a) || !Array.isArray(b)) continue;
    const [t0, p0] = a, [t1, p1] = b;
    if (![t0, p0, t1, p1].every(Number.isFinite)) continue;
    if (t0 === t1 && p1 > p0 && p >= p0 && p < p1) return { t: t0, p0, p1 };
  }
  return null;
}

/** Exact stage seek + scorer diagnostics, or null outside a valid goal hold.
 * Legacy bundles hold at t. Celebrations hold later, at replay_t, but still
 * replay [source_t - replay_s, source_t]. Map EACH source sample back through
 * earlier inserted celebrations: interpolating presentation endpoints would
 * play an earlier explosion if that interval crosses a previous goal.
 */
export function goalReplayAt(events, map, p, minT = 0) {
  const hold = goalHoldAt(map, p);
  if (!hold) return null;
  const goals = goalsOnly(events);
  const goal = goals.find((g) => finiteTime(g.t) && finiteTime(g.replay_t ?? g.t)
    && Math.abs((g.replay_t ?? g.t) - hold.t) < 0.05);
  if (!goal) return null;
  const len = goal.replay_s ?? (hold.p1 - hold.p0);
  if (!Number.isFinite(len) || len <= 0) return null;
  const progress = (p - hold.p0) / (hold.p1 - hold.p0);
  let t;
  if (goal.source_t == null) {
    // Old events lack source_t; t is the scoring frame (NOT replay_t).
    t = goal.t - len + progress * len;
  } else {
    if (!finiteTime(goal.source_t)) return null;
    const source = Math.max(0, goal.source_t - len + progress * len);
    t = source;
    for (const previous of goals) {
      if (previous === goal || !finiteTime(previous.source_t) || celebrationEnd(previous) === null) continue;
      // Strictly before: the scoring sample itself is the pre-explosion pose.
      if (previous.source_t < goal.source_t && previous.source_t < source) t += previous.celebration_s;
    }
  }
  if (!Number.isFinite(t)) return null;
  return { player: goal.player ?? null, team: goal.team ?? null, goalT: hold.t,
    t: Math.max(finiteTime(minT) ? minT : 0, t), progress };
}
