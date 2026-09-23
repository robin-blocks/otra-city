// Offline pre-match snapshot lifecycle, shared archive and fixed-slot checks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPostMatchTable, PREROLL_TABLE_DURATION_S, TABLE_DURATION_S } from '../public/js/post-match-table.mjs';
const incident = JSON.parse(readFileSync(new URL('./fixtures/league-first-air-m42.json', import.meta.url)));
const archive = () => structuredClone(incident.archive);
const ITEM = incident.programme.item;
const NOW = Date.parse(ITEM.startsAt) + 30000;
const flush = () => new Promise((resolve) => setImmediate(resolve));
const slot = (key = 'preroll:fixture:table', elapsed = 4) => ({ key, elapsed });
function mounted() {
  return { phase: 'match', source: 'schedule', loops: 0,
    match: { id: ITEM.bundleId, bundleUrl: ITEM.bundleUrl, startsAt: ITEM.startsAt, state: 'live' },
    bug: { home: structuredClone(ITEM.home), away: structuredClone(ITEM.away), t: -50, programmeT: 30,
      a: 90, b: 99, preroll: true, inPlay: false, over: false, replay: false },
  };
}
function harness(fetcher = async () => ({ ok: true, json: async () => archive() })) {
  const calls = [];
  const c = createPostMatchTable({ url: 'https://offline.invalid/archive.json', fetcher: (...args) => { calls.push(args); return fetcher(...args); } });
  const h = { c, calls, match: mounted() };
  h.frame = (changes = {}) => {
    const nowMs = changes.nowMs ?? NOW;
    // This is the programme's mandatory neutral update on EVERY preroll
    // evaluation. It must clear post-match timers without discarding preroll.
    c.update({ match: null, time: 0, nowMs });
    return c.updatePreroll({ match: h.match, slot: slot(), warm: true, nowMs, ...changes });
  };
  return h;
}
async function onAir(h) {
  assert.equal(h.frame(), null); await flush();
  const shown = h.frame(); assert.ok(shown, h.c.state().reason);
  return shown;
}

test('preroll duration is independently 24s, late join uses remaining slot without local cue delay', async () => {
  assert.equal(PREROLL_TABLE_DURATION_S, 24);
  assert.equal(TABLE_DURATION_S, 54);
  const h = harness();
  try {
    assert.equal(h.frame({ slot: null, warm: false }), null);
    assert.equal(h.calls.length, 0);
    assert.equal(h.frame({ slot: null }), null); await flush();
    assert.equal(h.c.state().visible, false);
    const cue = h.frame({ slot: slot(undefined, 19.5), warm: false });
    assert.equal(cue.elapsed, 19.5);
    assert.equal(cue.presentation.mode, 'preroll');
    assert.equal(cue.presentation.basis, 'scheduled-pre-match');
    assert.equal(cue.presentation.score, undefined);
    assert.equal(cue.presentation.rows.find((r) => r.code === 'SGU').points, 10);
    assert.deepEqual(h.c.state().movements, []);
    assert.equal(h.c.state().mode, 'preroll');
    assert.equal(h.c.state().matchId, ITEM.bundleId);
    assert.equal(h.c.state().source, 'https://offline.invalid/archive.json');
    assert.ok(h.frame({ slot: slot(undefined, 23.999) }));
    for (const elapsed of [24, 54, -1, NaN, Infinity, '5']) assert.equal(h.frame({ slot: slot(undefined, elapsed) }), null);
    assert.equal(h.frame({ slot: { elapsed: 4 } }), null, 'a slot requires an identity');
    const [url, opts] = h.calls[0];
    assert.equal(url, 'https://offline.invalid/archive.json');
    assert.equal(opts.credentials, 'omit'); assert.equal(opts.cache, 'no-cache'); assert.ok(opts.signal instanceof AbortSignal);
    assert.equal(h.calls.length, 1);
  } finally { h.c.dispose(); }
});

test('freeze survives neutral updates, score mutations, frame ticks and archive refresh', async () => {
  let doc = archive();
  const h = harness(async () => ({ ok: true, json: async () => structuredClone(doc) }));
  try {
    const first = await onAir(h);
    const originalHome = first.presentation.home.code;
    for (let i = 0; i < 200; i++) {
      h.match.bug.a++; h.match.bug.b++;
      assert.equal(h.frame({ slot: slot(undefined, 4 + i / 100) }).presentation, first.presentation);
    }
    h.match.bug.home.name = 'mutated caller';
    assert.notEqual(first.presentation.home.name, 'mutated caller');
    assert.equal(first.presentation.home.code, originalHome);
    doc.generated_at = new Date(NOW + 60000).toISOString();
    h.frame({ nowMs: NOW + 60000, slot: slot(undefined, 8) }); await flush();
    const held = h.frame({ nowMs: NOW + 61000, slot: slot(undefined, 9) });
    assert.equal(held.presentation, first.presentation);
    assert.equal(held.presentation.generatedAt, incident.archive.generated_at);
    assert.equal(h.calls.length, 2);
    const next = h.frame({ nowMs: NOW + 62000, slot: slot('new-slot', 5) });
    assert.notEqual(next.presentation, first.presentation);
    assert.equal(next.presentation.generatedAt, doc.generated_at);
  } finally { h.c.dispose(); }
});

for (const [label, reset] of [
  ['elapsed seek', (h) => h.frame({ slot: slot(undefined, 2) })],
  ['programme seek', (h) => { h.match.bug.programmeT -= .1; return h.frame(); }],
  ['loop change', (h) => { h.match.loops++; return h.frame(); }],
  ['occurrence change', (h) => { h.match.match.startsAt = new Date(Date.parse(ITEM.startsAt) + 1).toISOString(); return h.frame(); }],
  ['slot change', (h) => h.frame({ slot: slot('other', 5) })],
  ['slot exit and reentry', (h) => { h.frame({ slot: null, warm: false }); return h.frame(); }],
  ['idle exit and reentry', (h) => { h.c.updateIdle(); return h.frame(); }],
  ['actual match exit and reentry', (h) => { const m = mounted(); m.bug.preroll = false; h.c.update({ match: m, time: 0, nowMs: NOW }); return h.frame(); }],
]) test(`snapshot reassesses after ${label}`, async () => {
  const h = harness();
  try {
    const first = await onAir(h), next = reset(h);
    assert.ok(next, h.c.state().reason); assert.notEqual(next.presentation, first.presentation);
    assert.deepEqual(next.presentation.rows, first.presentation.rows);
    assert.equal(h.calls.length, 1);
  } finally { h.c.dispose(); }
});

test('match-time seek also resets when programme clock is absent', async () => {
  const h = harness(); delete h.match.bug.programmeT;
  try { const first = await onAir(h); h.match.bug.t--; assert.notEqual(h.frame().presentation, first.presentation); }
  finally { h.c.dispose(); }
});

for (const [label, mutate] of [
  ['playing', (m) => { m.bug.inPlay = true; }],
  ['not preroll', (m) => { m.bug.preroll = false; }],
  ['full time', (m) => { m.bug.over = true; }],
  ['wrong teams', (m) => { m.bug.home.code = 'UNKNOWN'; }],
  ['different fixture', (m) => { m.match.id = 's3-m4_wrong_fixture'; }],
  ['conflicting bundle', (m) => { m.match.bundleUrl = 'https://offline.invalid/wrong-abcdef'; }],
  ['direct scheduled mount', (m) => { m.source = 'direct'; }],
  ['scheduled replay', (m) => { m.match.state = 'replay'; }],
  ['loading', (m) => { m.phase = 'loading'; }],
]) test(`an existing snapshot cannot leak after ${label}`, async () => {
  const h = harness();
  try {
    const first = await onAir(h); mutate(h.match);
    assert.equal(h.frame(), null); assert.equal(h.c.state().visible, false);
    h.match = mounted(); const recovered = h.frame();
    assert.ok(recovered); assert.notEqual(recovered.presentation, first.presentation);
  } finally { h.c.dispose(); }
});

test('replay mounted fixture gets the published prefix, never its own HUD or published result', async () => {
  const h = harness(), d = archive(), m = d.seasons[0].matches.find((m) => m.n === 1);
  Object.assign(h.match, { source: 'direct' });
  h.match.match = { id: m.watch.id, state: 'replay' };
  h.match.bug.home = { code: m.home_code }; h.match.bug.away = { code: m.away_code };
  try {
    const cue = await onAir(h);
    assert.equal(cue.presentation.basis, 'published-pre-match');
    assert.ok(cue.presentation.rows.every((r) => r.played === 0 && r.points === 0));
    assert.equal(cue.presentation.score, undefined);
  } finally { h.c.dispose(); }
});

test('unavailable evidence is assessed once per revision/second, not every rendered frame', async () => {
  const d = archive(); let validations = 0;
  const s = d.seasons[0], original = s.table;
  Object.defineProperty(s, 'table', { get() { validations++; return original; } });
  original[0].Pts++;
  const h = harness(async () => ({ ok: true, json: async () => d }));
  try {
    h.frame(); await flush(); assert.equal(h.frame(), null);
    const first = validations; assert.ok(first > 0);
    for (let i = 0; i < 100; i++) h.frame({ nowMs: NOW + i / 10 });
    assert.equal(validations, first);
    h.frame({ nowMs: NOW + 1000 }); assert.equal(validations, first * 2);
    assert.ok(h.c.state().reason);
    assert.equal(h.calls.length, 1);
  } finally { h.c.dispose(); }
});

test('late successful refresh retries by revision; shown snapshot stays frozen even if subsequent archive fails', async () => {
  let doc = archive(); doc.seasons[0].table[0].Pts++;
  const h = harness(async () => ({ ok: true, json: async () => structuredClone(doc) }));
  try {
    h.frame(); await flush(); assert.equal(h.frame(), null);
    doc = archive();
    assert.equal(h.frame({ nowMs: NOW + 60000 }), null); await flush();
    const recovered = h.frame({ nowMs: NOW + 60000 }); assert.ok(recovered);
    doc.seasons[0].table[0].Pts++;
    h.frame({ nowMs: NOW + 120000 }); await flush();
    assert.equal(h.frame({ nowMs: NOW + 120001 }).presentation, recovered.presentation);
    assert.equal(h.frame({ nowMs: NOW + 120001, slot: slot('next') }), null);
  } finally { h.c.dispose(); }
});

test('preroll, idle and post-match share one deduplicated minute-bounded request and preserve distinct evidence', async () => {
  let deliver;
  const h = harness(() => new Promise((resolve) => { deliver = resolve; }));
  try {
    h.frame();
    h.c.updateIdle({ slot: null, warm: true, nowMs: NOW + 60000 });
    h.frame({ nowMs: NOW + 120000 }); assert.equal(h.calls.length, 1);
    deliver({ ok: true, json: async () => archive() }); await flush();
    h.frame({ nowMs: NOW + 120001 }); assert.equal(h.calls.length, 2);
    deliver({ ok: true, json: async () => archive() }); await flush();
    const pre = h.frame({ nowMs: NOW + 120002 }); assert.ok(pre);
    const idle = h.c.updateIdle({ slot: slot('idle', 4), warm: true, nowMs: NOW + 120003 });
    assert.equal(idle.presentation.basis, 'published-standings');
    const m = mounted(), final = incident.hud.score.at(-1);
    Object.assign(m.bug, { preroll: false, over: true, t: 622, a: final.a, b: final.b });
    m.ball = { speed: 0, measured: true }; m.clockPlan = incident.hud.clock;
    assert.equal(h.c.update({ match: m, camera: 'heli', time: 0, nowMs: NOW + 120004 }), null);
    const post = h.c.update({ match: m, camera: 'heli', time: .7, nowMs: NOW + 120005 });
    assert.equal(post.presentation.basis, 'first-air-hud');
    assert.deepEqual(post.presentation.score, [3, 6]);
    assert.equal(post.presentation.rows.find((r) => r.code === 'SGU').points, 13);
    const preAgain = h.frame({ nowMs: NOW + 120006 });
    assert.notEqual(preAgain.presentation, pre.presentation);
    assert.equal(preAgain.presentation.rows.find((r) => r.code === 'SGU').points, 10);
    for (const offset of [150000, 179999, 180000]) h.frame({ nowMs: NOW + offset });
    assert.equal(h.calls.length, 2);
    h.frame({ nowMs: NOW + 180001 }); assert.equal(h.calls.length, 3);
    deliver({ ok: true, json: async () => archive() }); await flush();
  } finally { h.c.dispose(); }
});

test('network failures fail closed and retry only after one minute', async () => {
  const h = harness(async () => { throw Error('offline'); });
  try {
    h.frame(); await flush(); assert.equal(h.frame(), null);
    assert.equal(h.c.state().reason, 'offline');
    h.frame({ nowMs: NOW + 59999 }); assert.equal(h.calls.length, 1);
    h.frame({ nowMs: NOW + 60000 }); await flush(); assert.equal(h.calls.length, 2);
  } finally { h.c.dispose(); }
});

test('disposal aborts shared request, clears snapshot and cannot be revived by late resolution', async () => {
  let deliver, signal;
  const h = harness((_url, init) => { signal = init.signal; return new Promise((resolve) => { deliver = resolve; }); });
  h.frame(); assert.equal(signal.aborted, false);
  h.c.dispose(); assert.equal(signal.aborted, true);
  deliver({ ok: true, json: async () => archive() }); await flush();
  assert.equal(h.frame(), null);
  assert.equal(h.c.updateIdle({ warm: true, nowMs: NOW + 120000 }), null);
  assert.equal(h.c.state().status, 'disposed'); assert.equal(h.calls.length, 1);
  const ready = harness(); await onAir(ready); ready.c.dispose(); assert.equal(ready.frame(), null);
});
