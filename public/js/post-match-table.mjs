// Live-broadcast cueing only. The renderer never chooses when football ends.
// No timer renders frames: time is supplied by /broadcast, and capture mode
// never creates this controller (or fetches the league archive).
import { buildMatchTable, LEAGUE_DATA_URL } from './league-table-data.mjs';

export const TABLE_DURATION_S = 18;
const CUE_DELAY_S = 0.7;
const CUE_WINDOW_S = 25;
const REFRESH_MS = 60000;

export function createPostMatchTable({ fetcher = globalThis.fetch, url = LEAGUE_DATA_URL } = {}) {
  let doc = null, pending = false, attemptedAt = -Infinity, revision = 0;
  let networkError = null;
  let key = null, previousT = null, safeSince = null, startedAt = null;
  let finished = false, presentation = null, assessed = null, assessment = null;
  let status = { visible: false, status: 'idle', reason: null, matchId: null };

  async function refresh(nowMs) {
    if (pending || nowMs - attemptedAt < REFRESH_MS) return;
    pending = true;
    attemptedAt = nowMs;
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 10000);
    try {
      const r = await fetcher(url, { credentials: 'omit', cache: 'no-cache', signal: abort.signal });
      if (!r.ok) throw new Error(`league data HTTP ${r.status}`);
      const next = await r.json();
      if (!Array.isArray(next?.seasons)) throw new Error('league data has no seasons');
      doc = next;
      revision += 1;
      networkError = null;
    } catch (e) { networkError = e?.message || String(e); }
    finally { clearTimeout(timer); pending = false; }
  }

  function reset(nextKey) {
    key = nextKey; previousT = null; safeSince = null; startedAt = null;
    finished = false; presentation = null; assessed = null; assessment = null;
  }

  return {
    /** m is the match module's state, not the public diagnostics subset. */
    update({ match: m, camera, settling = false, time, nowMs = Date.now() }) {
      const bug = m?.bug;
      const id = m?.match?.id;
      const nextKey = m?.phase === 'match' && id ? `${id}:${m.loops ?? 0}` : null;
      if (nextKey !== key || (Number.isFinite(bug?.t) && previousT !== null && bug.t < previousT - 1)) reset(nextKey);
      if (Number.isFinite(bug?.t)) previousT = bug.t;
      const hidden = (state, reason = null) => {
        status = { visible: false, status: state, reason, matchId: id ?? null, dataLoading: pending, dataError: networkError };
        return null;
      };
      if (!nextKey || !bug) return hidden('idle');
      // Warm the archive during play. One bounded request per minute, not per
      // frame; no programme/window-derived standings and no mock fallback.
      void refresh(nowMs);
      if (!bug.over || bug.preroll) return hidden('waiting-for-full-time');
      if (finished) return hidden('complete');
      const full = m.clockPlan?.buzzers?.find((b) => b.kind === 'full');
      const publisherAtRest = Number.isFinite(full?.play_end_t) && bug.t >= full.play_end_t;
      const speedKnown = Number.isFinite(m.ball?.speed) && m.ball?.measured !== false;
      const invalidSpeed = m.ball != null && (!Number.isFinite(m.ball.speed) || m.ball.speed < 0);
      const publisherStillPlaying = Number.isFinite(full?.play_end_t) && bug.t < full.play_end_t;
      const stopped = !publisherStillPlaying && !invalidSpeed && (speedKnown ? m.ball.speed <= 0.6 : publisherAtRest);
      if (bug.inPlay !== false || settling || !stopped || bug.replay || m.headcam) {
        // If play resumes, never cover it, even during the exit animation.
        if (startedAt !== null) finished = true;
        safeSince = null;
        return hidden('waiting-for-ball');
      }
      safeSince ??= time;
      if (startedAt === null && time - safeSince > CUE_WINDOW_S) {
        finished = true;
        return hidden('unavailable', assessment?.reason || networkError || 'table was not ready during the post-match aerial');
      }
      if (String(camera).toLowerCase() !== 'heli') {
        if (startedAt !== null) finished = true;
        return hidden('waiting-for-aerial');
      }
      // Freeze a validated match-specific snapshot once it is on air. A later
      // feed update cannot reshuffle a table while the viewer is reading it.
      if (startedAt === null) {
        // Archive publication normally follows the entire stream. A genuinely
        // scheduled occurrence can instead include this HUD result, but ONLY
        // here, after the publisher's final play-end. A direct/replay mount
        // cannot turn an unpublished future result into a league update.
        const firstAir = m.source === 'schedule' && m.match.state === 'live' && publisherAtRest
          ? { startsAt: m.match.startsAt, nowMs } : null;
        const signature = JSON.stringify([revision, id, m.match.bundleUrl, bug.home?.code, bug.away?.code, bug.a, bug.b,
          // Do not round the freshness clock: evidence can expire inside
          // the 0.7-second cue delay. Validation stops once the snapshot airs.
          firstAir?.startsAt, firstAir?.nowMs]);
        if (signature !== assessed) {
          assessed = signature;
          assessment = doc ? buildMatchTable(doc, { matchId: id, bundleUrl: m.match.bundleUrl,
            home: bug.home, away: bug.away, score: [bug.a, bug.b], firstAir }) : null;
        }
        presentation = assessment?.table ?? null;
      }
      if (!presentation) return hidden('waiting-for-table', assessment?.reason || networkError || 'loading league archive');
      if (time - safeSince < CUE_DELAY_S) return hidden('cueing');
      startedAt ??= time;
      const elapsed = Math.max(0, time - startedAt);
      if (elapsed >= TABLE_DURATION_S) { finished = true; return hidden('complete'); }
      status = {
        visible: true, status: 'on-air', reason: null, matchId: presentation.matchId,
        elapsed: +elapsed.toFixed(3), source: url, generatedAt: presentation.generatedAt, basis: presentation.basis,
        movements: presentation.rows.filter((r) => r.code === bug.home.code || r.code === bug.away.code)
          .map((r) => ({ code: r.code, from: r.previousPosition, to: r.position, change: r.previousPosition - r.position })),
      };
      return { presentation, elapsed };
    },
    state() { return { ...status }; },
  };
}
