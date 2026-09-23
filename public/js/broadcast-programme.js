// Shared automatic television direction. No renderer, scene, stage, audio or
// page-arrival clock lives here. Explicit cameras/capture must bypass this API.
import { CAMERAS, createTrack, framePlay, GANTRY_AIM_LAG_S, GANTRY_FOV_LAG_S } from './broadcast-cameras.js';
import { beforeTime } from './goal-celebration.mjs';
import { createPostMatchTable, TABLE_DURATION_S } from './post-match-table.mjs';
import { PREROLL_TABLE_DURATION_S } from './league-timing.mjs';

export const PROGRAMME_IDLE_EPOCH_MS = 0;
export const PROGRAMME_TRACK_URLS = Object.freeze({
  ambient: '/broadcast/live-cutlist.json',
  match: '/broadcast/match-cutlist.json',
  preroll: '/broadcast/preroll-cutlist.json',
});
const DEFAULT_FOV = 50;
const BALL_STILL_MS = 0.6;
const BALL_SETTLE_S = 6;
const CUE_DELAY_S = 0.7;
// One standings segment on every other idle cut-list lap. Extend only that
// lap's opening aerial to fit the existing 54s reading hold; retain every
// other authored shot. With today's 136s list: 54 / 281.7 = 19.2% airtime.
export const IDLE_TABLE_EVERY_LAPS = 2;
export const IDLE_TABLE_LEAD_IN_S = 60;
// Absolute pre-roll offsets, not recurring laps or per-browser timers. The
// first starts on the authored aerial; a second read leaves the whistle clear.
export const PREROLL_TABLE_STARTS_S = Object.freeze([22, 112]);
export const PREROLL_TABLE_LEAD_IN_S = 30;
const HISTORY_S = 4;
const HISTORY_FPS = 50;
const finite = Number.isFinite;
const seconds = (value) => finite(value) ? value : null;
const frameOf = (t, fps) => Math.floor(Math.max(0, t) * fps + 1e-7);

// Same [match seconds, programme seconds] map as pa-system. Keep the FIRST
// edge of an exact match instant: a full-time dwell belongs to the outro, not
// to play. Intervening goal holds are included when mapping later instants.
function mapAt(map, t) {
  if (!map?.length) return t;
  if (!beforeTime(map[0][0], t)) return map[0][1];
  for (let i = 1; i < map.length; i++) {
    const [m0, p0] = map[i - 1], [m1, p1] = map[i];
    if (!beforeTime(m1, t)) {
      // Snap arithmetic-equivalent endpoints BEFORE interpolation. Otherwise
      // a near-flat full-time dwell sends the table origin to its far edge.
      if (!beforeTime(t, m1)) return p1;
      return m1 === m0 ? p1 : p0 + (t - m0) * (p1 - p0) / (m1 - m0);
    }
  }
  return map.at(-1)[1];
}
function unmapAt(map, p) {
  if (!map?.length) return p;
  if (p <= map[0][1]) return map[0][0];
  for (let i = 1; i < map.length; i++) {
    const [m0, p0] = map[i - 1], [m1, p1] = map[i];
    if (p <= p1) return p1 === p0 ? m1 : m0 + (p - p0) * (m1 - m0) / (p1 - p0);
  }
  return map.at(-1)[0];
}
function validMap(map) {
  return Array.isArray(map) && map.length > 1 && map.every((row, i) =>
    Array.isArray(row) && finite(row[0]) && finite(row[1]) &&
    (!i || (row[0] >= map[i - 1][0] && row[1] >= map[i - 1][1]))) ? map : null;
}
function clockOf(m, programme, nowMs, idleEpochMs) {
  const map = validMap(programme?.map);
  const t = seconds(m?.bug?.t);
  if (m?.phase !== 'match') return { t: null, p: (nowMs - idleEpochMs) / 1000, map: null, source: 'idle-epoch' };
  const p = seconds(m?.bug?.programmeT) ?? seconds(m?.programmeT);
  if (p !== null && map) return { t, p, map, source: 'programme' };
  // Without a map the programme contains unknown inserted holds. Do not
  // subtract a match-time buzzer from programme time: use one coordinate.
  if (map && m?.drive === 'wall' && finite(Date.parse(m?.match?.startsAt))) {
    return { t, p: Math.max(0, (nowMs - Date.parse(m.match.startsAt)) / 1000), map, source: 'wall-programme' };
  }
  return { t, p: t ?? (nowMs - idleEpochMs) / 1000, map: null,
    source: t === null ? 'missing-match-clock' : 'match-clock-fallback' };
}
function at(track, t) {
  if (!track) return null;
  const frame = frameOf(t, track.fps || 50);
  // A non-looping list holds its own last pose, NOT a page's previous pose.
  return track.at(frame) || (!track.loop && track.lastFrame > 0 ? track.at(track.lastFrame - 1) : null);
}
function stopped(m, full) {
  const ball = m?.ball;
  const publisherAtRest = finite(full?.play_end_t) && finite(m?.bug?.t) && !beforeTime(m.bug.t, full.play_end_t);
  const speedKnown = finite(ball?.speed) && ball?.measured !== false;
  const invalid = ball != null && (!finite(ball.speed) || ball.speed < 0);
  return !(finite(full?.play_end_t) && beforeTime(m?.bug?.t, full.play_end_t)) && !invalid &&
    (speedKnown ? ball.speed <= BALL_STILL_MS : publisherAtRest);
}
function ease(previous, target, dt) {
  const ka = 1 - Math.exp(-Math.max(0, dt) / GANTRY_AIM_LAG_S);
  const kf = 1 - Math.exp(-Math.max(0, dt) / GANTRY_FOV_LAG_S);
  return { aim: previous.aim.map((v, i) => v + (target.aim[i] - v) * ka),
    fov: previous.fov + (target.fov - previous.fov) * kf };
}

/**
 * @param {object} options
 * @param {object} options.venue Venue definition with authored cameras.
 * @param {object} [options.tracks] Resolved {ambient, match, preroll} tracks;
 * omit to fetch the three existing cut-lists. An injected null disables one.
 * @param {function} [options.samplePlay] Pure verified body sampler(matchT).
 * @param {object|null} [options.tableController] Existing post-match controller;
 * null disables the table. Its validator remains the sole standings authority.
 *
 * evaluate({match, nowMs, dt, programme?, samplePlay?}) returns
 * {camera, tableCue, state}. All camera coordinates are venue-local metres.
 * The owner must arm replayCam(true) on its EXISTING match module, then tick
 * that module before evaluating. This module never rewinds/mounts the stage.
 */
export async function createBroadcastProgramme({ venue, fetcher = globalThis.fetch,
  tracks, tableController, idleEpochMs = PROGRAMME_IDLE_EPOCH_MS, samplePlay = null,
  preRollSeconds = 180 } = {}) {
  if (!finite(idleEpochMs)) throw new TypeError('idleEpochMs must be a shared finite timestamp');
  const named = (name) => {
    const c = venue?.cameras?.[name] ?? venue?.cameras?.[String(name).toLowerCase()];
    return c ? { pos: c[0], lookAt: c[1], fov: DEFAULT_FOV } : null;
  };
  async function json(url) {
    const response = await fetcher(url, { credentials: 'omit' });
    if (!response.ok) throw new Error(`broadcast programme HTTP ${response.status}: ${url}`);
    return response.json();
  }
  async function load(url) {
    return createTrack(await json(url), { named, fetchJson: async (url) => {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('explicit frames must be an https URL');
      return json(parsed.href);
    } }).resolve();
  }
  const cuts = tracks ?? Object.fromEntries(await Promise.all(Object.entries(PROGRAMME_TRACK_URLS)
    .map(async ([key, url]) => [key, await load(url)])));
  const table = tableController === undefined ? createPostMatchTable({ fetcher }) : tableController;
  let gantry = null, previousKey = null, previousP = null;
  let diagnostics = { phase: 'uninitialised', visible: false };

  function gantryAt(m, clock, dt, sampler) {
    const target = m?.phase === 'match' ? framePlay(CAMERAS.gantry(0, 0, {}), m?.play || {}) : null;
    if (!target) { gantry = null; return { pose: null, mode: 'locked' }; }
    if (typeof sampler === 'function' && clock.t !== null) {
      // Fixed, bounded 50Hz integration on the PROGRAMME clock. Identical
      // history inputs give identical camera poses regardless of render FPS,
      // seek order or arrival. Never sample future bodies or mutate the stage.
      const end = Math.floor(clock.p * HISTORY_FPS + 1e-7);
      const begin = end - HISTORY_S * HISTORY_FPS;
      let pose = null, last = begin / HISTORY_FPS, complete = true;
      try {
        for (let f = begin; f <= end; f++) {
          const p = f / HISTORY_FPS;
          const sample = sampler(unmapAt(clock.map, p), { programmeT: p, match: m });
          const want = sample && framePlay(CAMERAS.gantry(0, 0, {}), sample);
          if (!want) { complete = false; break; }
          pose = pose ? ease(pose, want, p - last) : want;
          last = p;
        }
        if (complete && pose) {
          const tail = clock.p - last;
          if (tail > 1e-9) {
            const sample = sampler(unmapAt(clock.map, clock.p), { programmeT: clock.p, match: m });
            const want = sample && framePlay(CAMERAS.gantry(0, 0, {}), sample);
            if (!want) complete = false;
            else pose = ease(pose, want, tail);
          }
          if (complete) { gantry = pose; return { pose, mode: 'bounded-history' }; }
        }
      } catch { /* Missing/unverified history: disclose the local fallback. */ }
    }
    gantry = gantry ? ease(gantry, target, finite(dt) ? dt : 0) : target;
    return { pose: gantry, mode: 'local-lag-fallback' };
  }

  function evaluate({ match: m = null, nowMs = Date.now(), dt = 0,
    programme = m?.programme, samplePlay: sampler = samplePlay } = {}) {
    if (!finite(nowMs)) throw new TypeError('nowMs must be finite');
    const clock = clockOf(m, programme, nowMs, idleEpochMs);
    const onAir = m?.phase === 'match';
    const key = onAir ? `${m?.match?.id ?? ''}:${m?.match?.startsAt ?? ''}:${m?.loops ?? 0}` : null;
    if (key !== previousKey || (previousP !== null && clock.p < previousP - 1)) {
      gantry = null;
    }
    previousKey = key; previousP = clock.p;
    const bug = m?.bug;
    const buzzers = (m?.clockPlan?.buzzers || []).filter((b) => finite(b?.t)).slice().sort((a, b) => a.t - b.t);
    const latest = buzzers.filter((b) => clock.t !== null && b.t <= clock.t).at(-1);
    const full = buzzers.find((b) => b.kind === 'full');
    const endT = latest ? (finite(latest.play_end_t) ? latest.play_end_t : latest.t) : null;
    const intervalT = endT === null ? null : mapAt(clock.map, endT);
    const sinceEnd = intervalT === null ? null : Math.max(0, clock.p - intervalT);
    const ballLive = onAir && bug?.inPlay !== false;
    // A six-second fallback is anchored at the publisher's end, never at the
    // frame a page first saw the whistle. Unknown speed is not guessed moving.
    const settling = onAir && !ballLive && !bug?.preroll && latest &&
      (m?.ball?.speed ?? 0) > BALL_STILL_MS && sinceEnd < BALL_SETTLE_S;
    const inPlay = ballLive || !!settling;
    const preroll = onAir && bug?.preroll === true && !inPlay;
    const phase = inPlay ? 'play' : preroll ? 'preroll' : onAir ? (bug?.over ? 'postmatch' : 'interval') : 'idle';
    let origin = 0;
    if (inPlay) {
      const restart = buzzers.filter((b) => finite(b.restart_t) && b.restart_t <= clock.t).at(-1)?.restart_t ?? 0;
      origin = mapAt(clock.map, restart);
    } else if (preroll) origin = clock.map?.[0]?.[1] ?? -preRollSeconds;
    else if (onAir && intervalT !== null) origin = intervalT;
    const elapsed = Math.max(0, clock.p - origin);
    const cut = (inPlay ? cuts.match : preroll ? (cuts.preroll || cuts.ambient) : cuts.ambient) || cuts.ambient || cuts.match;
    let c = at(cut, elapsed);

    // Reserve one deterministic post-match table slot, independent of archive
    // fetch timing. The original 45s orbit continues moving to 54.7s, then the
    // pending authored shot resumes at its beginning. A late join can compute
    // this without lastTrackCam/cutFrom or knowing whether another page's
    // graphic has loaded. Unavailable evidence means an unobscured aerial.
    const first = cuts.ambient?.segments?.[0];
    const fullT = full && (finite(full.play_end_t) ? full.play_end_t : full.t);
    const postElapsed = finite(fullT) ? clock.p - mapAt(clock.map, fullT) : null;
    const hasSlot = !!table && phase === 'postmatch' && cut === cuts.ambient &&
      first?.camera === 'heli' && first.from === 0 && postElapsed !== null && postElapsed >= 0;
    const slotEnd = CUE_DELAY_S + TABLE_DURATION_S;
    let held = false;
    if (hasSlot) {
      const fps = cut.fps || 50, end = first.to / fps;
      const extension = Math.max(0, slotEnd - end);
      if (postElapsed >= end && postElapsed < end + extension) {
        const t = frameOf(postElapsed, fps) / fps;
        c = { ...CAMERAS.heli(t, first.seed, first.params), camera: 'heli', segment: first.index ?? 0,
          seed: first.seed, params: first.params, t, held: true };
        held = true;
      } else c = at(cut, postElapsed >= slotEnd ? postElapsed - extension : postElapsed);
    }
    // Pre-match snapshots have their own fixed slots and never use the final
    // score/HUD to build standings. A missing archive still reserves the SAME
    // moving aerial, so download/arrival timing cannot change the director.
    // A supplied map that was rejected, or lacks a usable programme clock,
    // is NOT evidence for the default 180s layout. Only genuinely unmapped
    // legacy match-time playback may use the configured pre-roll duration.
    const preDuration = clock.map
      ? (clock.map[0][0] < 0 && clock.map.at(-1)[0] >= 0 ? mapAt(clock.map, 0) - origin : null)
      : (programme?.map == null && clock.t !== null && finite(preRollSeconds) && preRollSeconds > 0 ? preRollSeconds : null);
    const preReady = phase === 'preroll' && bug?.inPlay === false && clock.t !== null && clock.t < 0 &&
      !bug?.over && !bug?.replay && !bug?.celebrating && !m?.headcam && m?.board !== 'GOAL';
    const preLayout = !!table?.updatePreroll && first?.camera === 'heli' && first.from === 0;
    let prerollSlot = null, prerollSegment = null;
    if (preLayout && preReady && finite(preDuration)) {
      for (const [index, start] of PREROLL_TABLE_STARTS_S.entries()) {
        const end = start + CUE_DELAY_S + PREROLL_TABLE_DURATION_S;
        // Skip the whole appearance if a shorter programme cannot fit the
        // read plus a clean final 30s. Never clamp/extend over kickoff.
        if (beforeTime(preDuration, end + PREROLL_TABLE_LEAD_IN_S) || beforeTime(elapsed, start) || !beforeTime(elapsed, end)) continue;
        const t = frameOf(elapsed - start, cuts.ambient.fps || 50) / (cuts.ambient.fps || 50);
        c = { ...CAMERAS.heli(t, first.seed, first.params), camera: 'heli', segment: first.index ?? 0,
          seed: first.seed, params: first.params, t };
        prerollSegment = index;
        if (!beforeTime(elapsed, start + CUE_DELAY_S)) prerollSlot = {
          key: `preroll:${key}:${index}`, elapsed: Math.max(0, elapsed - (start + CUE_DELAY_S)),
        };
      }
    }
    // Never mistake a loading bundle or a live programme awaiting its stage
    // for between games.
    const idleReady = phase === 'idle' && ['idle', 'countdown'].includes(m?.phase) && !m?.live;
    const idleLayout = !!table?.updateIdle && phase === 'idle' && cuts.ambient?.loop &&
      first?.camera === 'heli' && first.from === 0 && cuts.ambient.lastFrame > 0;
    let idleSlot = null, idlePeriod = null, idleSlotElapsed = null, idleBlocked = null;
    if (idleLayout) {
      const fps = cuts.ambient.fps || 50;
      const lap = cuts.ambient.lastFrame / fps;
      const end = first.to / fps;
      const extension = Math.max(0, slotEnd - end);
      idlePeriod = IDLE_TABLE_EVERY_LAPS * lap + extension;
      const periodMs = Math.round(idlePeriod * 1000);
      const cycle = Math.floor((nowMs - idleEpochMs) / periodMs);
      const slotStartMs = idleEpochMs + cycle * periodMs;
      const t = (nowMs - slotStartMs) / 1000;
      const nextAt = m?.next ? Date.parse(m.next.startsAt) : Infinity;
      // Reserve enough space for the ENTIRE segment and a clean final minute
      // before stream start (not kickoff). Unknown/malformed timing fails shut.
      const enoughRoom = nextAt >= slotStartMs + (slotEnd + IDLE_TABLE_LEAD_IN_S) * 1000;
      idleBlocked = !idleReady ? 'not-between-matches' : !enoughRoom ? 'next-programme' : null;
      if (idleReady && enoughRoom) {
        idleSlotElapsed = t;
        if (t >= end && t < end + extension) {
          const cameraT = frameOf(t, fps) / fps;
          c = { ...CAMERAS.heli(cameraT, first.seed, first.params), camera: 'heli',
            segment: first.index ?? 0, seed: first.seed, params: first.params, t: cameraT, held: true };
          held = true;
        } else c = at(cuts.ambient, t >= slotEnd ? t - extension : t);
        if (t >= CUE_DELAY_S && t < slotEnd) idleSlot = {
          key: `idle:${idleEpochMs}:${cycle}`, elapsed: t - CUE_DELAY_S,
        };
      }
    }
    const tracking = gantryAt(m, clock, dt, sampler);
    if (c?.camera === 'gantry' && tracking.pose) c = { ...c,
      lookAt: tracking.pose.aim.map((v) => +v.toFixed(3)), fov: +tracking.pose.fov.toFixed(3) };
    let priority = inPlay ? 'play' : phase;
    if (onAir && m?.headcam?.pos && m.headcam.lookAt) {
      c = { ...m.headcam, fov: m.headcam.fov || DEFAULT_FOV, segment: -1, camera: 'headcam' }; priority = 'headcam';
    } else if (onAir && bug?.celebrating === true) {
      // Keep the actual effect on the pitch, even after a buzzer. The body
      // sampler parks the ball at y=-30 and exposes no explosion origin.
      // Team A/0 scores at +7m, B/1 at -7m (including own goals). Use that
      // known end, NOT the scorer's location or a lagged/hidden-ball target.
      const goal = (m?.goals || []).filter((g) => finite(g?.t) && finite(g?.celebration_s) &&
        g.celebration_s > 0 && clock.t >= g.t && clock.t < g.t + g.celebration_s)
        .sort((a, b) => a.t - b.t).at(-1);
      const end = goal?.team === 'A' || goal?.team === 0 ? 7
        : goal?.team === 'B' || goal?.team === 1 ? -7 : null;
      const wide = named('gantry') || CAMERAS.gantry(0, 0, {});
      // A fixed cut from the existing gantry, no invented camera movement.
      // Missing end metadata retains the authored full-pitch wide.
      c = { ...wide, lookAt: end === null ? wide.lookAt : [end, 0.45, 0],
        segment: -1, camera: 'gantry' }; priority = 'celebration';
    } else if (onAir && m?.board === 'GOAL' && named('scoreboard')) {
      c = { ...named('scoreboard'), segment: -1, camera: 'scoreboard' }; priority = 'goal';
    }
    c ??= { ...(named('gantry') || CAMERAS.gantry(0, 0, {})), camera: 'gantry', segment: -1 };

    // The old controller combines evidence and page-local cue timers. Keep its
    // evidence validation/snapshot freeze intact, but give that timer a tiny
    // virtual clock: prime at 0, open at .7. The OUTER programme owns elapsed
    // and expiry. Both calls receive the actual match and actual wall time;
    // no future score, fictional first-air timestamp or relaxed validation.
    // This deliberately permits a late join / late archive within the fixed
    // slot to show its remaining time, not a new 54s show or local 25s window.
    let tableCue = null;
    if (table && !onAir) {
      table.update({ match: null, time: 0, nowMs });
      tableCue = table.updateIdle?.({ slot: idleSlot, warm: idleReady, nowMs }) ?? null;
    }
    const safe = hasSlot && !inPlay && !bug?.preroll && !bug?.replay && !bug?.celebrating && !m?.headcam &&
      bug?.inPlay === false && stopped(m, full) && priority !== 'goal';
    if (table && preroll && table.updatePreroll) {
      table.update({ match: null, time: 0, nowMs });
      tableCue = table.updatePreroll({ match: m, slot: prerollSlot, warm: true, nowMs });
    }
    if (table && onAir && !(preroll && table.updatePreroll)) {
      // The wrapper, not the old page-local controller, owns interruption.
      // Clear its finished/safe timer after a protected cut so clients that
      // witnessed a headcam/goal can rejoin the same remaining global slot
      // as clients arriving afterwards. No match/evidence is synthesized.
      if (!safe && table.state?.().visible) table.update({ match: null, time: 0, nowMs });
      const input = { match: m, camera: c.camera, settling: !!settling, nowMs };
      table.update({ ...input, time: 0 });
      const cue = safe && postElapsed >= CUE_DELAY_S && postElapsed < slotEnd
        ? table.update({ ...input, time: CUE_DELAY_S }) : null;
      if (safe && postElapsed >= CUE_DELAY_S && postElapsed < slotEnd && cue) {
        tableCue = { ...cue, elapsed: postElapsed - CUE_DELAY_S };
      }
    }
    diagnostics = {
      phase, priority, clock: clock.source, programmeT: clock.p, phaseOrigin: origin, phaseElapsed: elapsed,
      cutFrame: frameOf(elapsed, cut?.fps || 50), matchKey: key, settling: !!settling,
      goalCut: priority === 'goal', headcam: priority === 'headcam', camera: c.camera,
      gantry: tracking.mode, gantryHistorySeconds: tracking.mode === 'bounded-history' ? HISTORY_S : null,
      table: { ...(table?.state?.() || { status: 'disabled' }), visible: !!tableCue,
        elapsed: tableCue?.elapsed ?? null, slotElapsed: hasSlot ? postElapsed : null,
        duration: preroll ? PREROLL_TABLE_DURATION_S : TABLE_DURATION_S, held, expired: hasSlot && postElapsed >= slotEnd,
        idlePeriod, idleSlotElapsed, idleBlocked,
        prerollSegment, prerollDuration: preroll ? preDuration : null,
        status: !table ? 'disabled' : hasSlot && postElapsed >= slotEnd ? 'complete'
          : tableCue ? 'on-air' : table?.state?.().status || 'idle' },
    };
    return { camera: c, tableCue, state: diagnostics };
  }
  return { evaluate, state: () => diagnostics, dispose: () => table?.dispose?.() };
}
