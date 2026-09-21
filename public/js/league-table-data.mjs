// Match-specific standings from RFL's COMPLETE season archive, never the
// rolling 60-item programme. Ranking verified against rfl-engine/gauntlet/
// league.py _standings at b6ce1ab1c8d6b5a5a9d6df07f0ccf73e9bc1687d:
// 3/1/0 points; points, GD, GF descending; stable configured team order.
// Every load must reconcile ALL rows/stats to the publisher's table. A rules
// change, points deduction, incomplete ledger or ambiguous chronology closes
// the graphic rather than putting an invented position on television.
export const LEAGUE_DATA_URL = 'https://raw.githubusercontent.com/robot-football-league/rfl-league-data/main/site.json';
const STATS = ['P', 'W', 'D', 'L', 'GF', 'GA', 'GD', 'Pts', 'pos'];
const integer = (n) => Number.isSafeInteger(n) && n >= 0;
const scoreOK = (s) => Array.isArray(s) && s.length === 2 && s.every(integer);
function stamp(s) {
  if (typeof s !== 'string') return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(s);
  if (!m || !Number.isFinite(Date.parse(s))) return false;
  // Date.parse silently rolls February 30 into March. Check the local date
  // separately from the offset so impossible dates never reorder results.
  const day = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
  return day.getUTCFullYear() === Number(m[1]) && day.getUTCMonth() + 1 === Number(m[2]) && day.getUTCDate() === Number(m[3]);
}
function require(ok, why) { if (!ok) throw new Error(why); }

function rank(rows) {
  return rows.map((r) => ({ ...r })).sort((a, b) => b.Pts - a.Pts || b.GD - a.GD || b.GF - a.GF || a.order - b.order)
    .map((r, i) => ({ ...r, pos: i + 1 }));
}
function empty(teams) {
  return teams.map((t, order) => ({ ...t, order, P: 0, W: 0, D: 0, L: 0, GF: 0, GA: 0, GD: 0, Pts: 0 }));
}
function apply(rows, m) {
  const home = rows.find((t) => t.slug === m.home), away = rows.find((t) => t.slug === m.away);
  const [a, b] = m.score;
  home.P++; away.P++;
  home.GF += a; home.GA += b; away.GF += b; away.GA += a;
  home.GD = home.GF - home.GA; away.GD = away.GF - away.GA;
  if (a === b) { home.D++; away.D++; home.Pts++; away.Pts++; }
  else { const win = a > b ? home : away, lose = a > b ? away : home; win.W++; win.Pts += 3; lose.L++; }
}

/** Reconcile a complete season and return its unambiguous aired sequence. */
export function validateSeason(season) {
  const { teams, matches, table } = season || {};
  require(Array.isArray(teams) && teams.length >= 2 && teams.length <= 12, 'unsupported team count');
  require(teams.every((t) => typeof t.slug === 'string' && t.slug && typeof t.code === 'string' && t.code && typeof t.name === 'string'), 'invalid team identity');
  require(new Set(teams.map((t) => t.slug)).size === teams.length && new Set(teams.map((t) => t.code)).size === teams.length, 'duplicate teams');
  require(Array.isArray(matches) && matches.length === season.total_matches, 'incomplete fixture ledger');
  const bySlug = new Map(teams.map((t) => [t.slug, t]));
  const numbers = new Set(), ids = new Set();
  for (const m of matches) {
    require(integer(m.n) && m.n > 0 && m.n <= matches.length && !numbers.has(m.n), 'invalid or duplicate fixture number');
    numbers.add(m.n);
    require(bySlug.has(m.home) && bySlug.has(m.away) && m.home !== m.away, 'unknown fixture teams');
    require(m.home_code === bySlug.get(m.home).code && m.away_code === bySlug.get(m.away).code, 'fixture team codes disagree');
    require(['aired', 'scheduled', 'skipped'].includes(m.status), 'unknown fixture status');
    if (m.status !== 'aired') continue;
    require(scoreOK(m.score), 'invalid final score');
    require(stamp(m.aired_at), 'missing aired chronology');
    const expectedId = `s${season.season}-m${m.n}_${m.home}_${m.away}`;
    require(m.watch?.id === expectedId && !ids.has(m.watch.id), 'ambiguous result identity');
    ids.add(m.watch.id);
  }
  const aired = matches.filter((m) => m.status === 'aired').sort((a, b) => Date.parse(a.aired_at) - Date.parse(b.aired_at));
  require(aired.length === season.aired_count && matches.filter((m) => m.status === 'skipped').length === season.skipped_count, 'fixture counts disagree');
  require(new Set(aired.map((m) => Date.parse(m.aired_at))).size === aired.length, 'ambiguous aired chronology');
  require(Array.isArray(table) && table.length === teams.length && new Set(table.map((t) => t.slug)).size === teams.length, 'incomplete published table');
  const totals = empty(teams);
  for (const m of aired) apply(totals, m);
  const ranked = rank(totals);
  for (const r of ranked) {
    const official = table.find((t) => t.slug === r.slug);
    require(official?.code === r.code && STATS.every((s) => official[s] === r[s]), 'archive does not reconcile with the published table');
  }
  return { teams, aired };
}

// A direct SDK mount uses the bundle folder as its id, including a content
// hash. Match only a KNOWN publisher id plus a hex suffix, not a guessed slug
// or a partial fixture-number match (m4 must never match m41).
function identifies(value, id) {
  return value === id || (typeof value === 'string' && value.startsWith(`${id}-`) && /^[a-f\d]{6,64}$/i.test(value.slice(id.length + 1)));
}

const fixtureId = (season, match) => `s${season.season}-m${match.n}_${match.home}_${match.away}`;

// RFL's normal first-air pipeline is ordered: gauntlet/schedule.py explicitly
// assigns ascending fixtures to slots. build_site_data.py emits only the first
// twelve pending slot predictions; an untimed later tail is NOT a missing game.
// This narrower path must never change historical replay ordering by aired_at.
// A reconciled table alone is insufficient: a stale ledger can reconcile too.
const FIRST_AIR_MAX_AGE_MS = 2 * 60 * 60 * 1000;
const ARCHIVE_MAX_AGE_MS = 6 * 60 * 60 * 1000;
function firstAirBoundary(doc, season, match, aired, firstAir) {
  require(firstAir && stamp(firstAir.startsAt) && Number.isFinite(firstAir.nowMs), 'first-air schedule evidence required');
  const start = Date.parse(firstAir.startsAt), now = firstAir.nowMs, generated = Date.parse(doc.generated_at);
  require(start <= now && now - start <= FIRST_AIR_MAX_AGE_MS, 'first-air occurrence is not current');
  require(generated <= now + 60000 && now - generated <= ARCHIVE_MAX_AGE_MS, 'first-air archive is stale or future-dated');
  require(season.season === doc.current_season, 'first-air season is not current');
  require(season.matches.every((m) => m.n >= match.n || m.status === 'aired' || m.status === 'skipped'), 'earlier fixture result is missing');
  require(aired.every((m, i) => m.n < match.n && (!i || aired[i - 1].n < m.n)), 'first-air fixture order is ambiguous');
  require(aired.every((m) => Date.parse(m.aired_at) < start && Date.parse(m.aired_at) <= generated), 'first-air archive crosses the match boundary');
  // These timestamps are rolling SLOT PREDICTIONS, not actual kickoff times.
  // Check contradictions, never equate them to programme startsAt (pre-roll).
  let previousSlot = -Infinity;
  for (const m of season.matches.filter((m) => m.status === 'scheduled').sort((a, b) => a.n - b.n)) {
    if (m.kickoff_utc == null) continue;
    require(stamp(m.kickoff_utc) && Date.parse(m.kickoff_utc) > previousSlot, 'first-air schedule order is ambiguous');
    previousSlot = Date.parse(m.kickoff_utc);
  }
}

/** firstAir is supplied only by a controller which has confirmed final play-end
 * on a mounted scheduled programme. Never authorize it from publication alone.
 * No throwing into the render loop: unavailable data is a diagnostic. */
export function buildMatchTable(doc, { matchId, bundleUrl, home, away, score, firstAir = null } = {}) {
  try {
    require(Array.isArray(doc?.seasons) && stamp(doc.generated_at), 'invalid league archive');
    let folder = null;
    try { folder = new URL(bundleUrl).pathname.split('/').filter(Boolean).pop(); } catch { /* exact id still works */ }
    const candidates = [];
    for (const season of doc.seasons) {
      for (const match of season.matches || []) {
        const id = match.status === 'scheduled' ? fixtureId(season, match) : match.watch?.id;
        if (id && (identifies(matchId, id) || identifies(folder, id))) candidates.push({ season, match, id });
      }
    }
    require(candidates.length === 1, 'result not yet published or match identity unavailable');
    const { season, match, id } = candidates[0];
    require(match.status === 'aired' || (match.status === 'scheduled' && firstAir), 'result not yet published');
    require(home?.code === match.home_code && away?.code === match.away_code, 'on-air teams do not match league result');
    require(scoreOK(score), 'invalid on-air final score');
    // First-air identity is stricter: both mounted identifiers, if present,
    // must refer to this exact fixture. No canonical guess for a re-render id.
    if (match.status === 'scheduled') {
      require((!matchId || identifies(matchId, id)) && (!bundleUrl || (folder && identifies(folder, id))), 'first-air match identity disagrees');
      require(!match.watch || match.watch.id === id, 'first-air published identity disagrees');
    }
    if (match.status === 'aired' || match.score != null)
      require(scoreOK(match.score) && score.every((n, i) => n === match.score[i]), 'on-air score does not match league result');
    const { teams, aired } = validateSeason(season);
    const rows = empty(teams);
    let before = null, after = null;
    const basis = match.status === 'aired' ? 'published-result' : 'first-air-hud';
    if (basis === 'first-air-hud') {
      firstAirBoundary(doc, season, match, aired, firstAir);
      for (const m of aired) apply(rows, m);
      before = rank(rows);
      apply(rows, { ...match, score });
      after = rank(rows);
    } else {
      for (const m of aired) {
        if (m === match) before = rank(rows);
        apply(rows, m);
        if (m === match) { after = rank(rows); break; }
      }
    }
    require(before && after, 'no confirmed result boundary');
    const previous = new Map(before.map((r) => [r.slug, r]));
    return { table: {
      matchId: id, season: season.season, label: season.preseason ? 'PRE-SEASON' : `SEASON ${season.season}`,
      basis, generatedAt: doc.generated_at,
      home, away, score: score.slice(), sourceLabel: basis === 'first-air-hud' ? 'RFL · Including this result' : 'RFL · Aired results',
      rows: after.map((r) => {
        const p = previous.get(r.slug);
        return { code: r.code, name: r.name, color: r.color,
          position: r.pos, previousPosition: p.pos, played: r.P, previousPlayed: p.P,
          gd: r.GD, previousGd: p.GD, points: r.Pts, previousPoints: p.Pts };
      }),
    }, reason: null };
  } catch (e) { return { table: null, reason: e.message || String(e) }; }
}
