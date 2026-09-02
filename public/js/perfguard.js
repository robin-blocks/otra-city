// Boot-time quality pick + a runtime frame-time guard that steps the preset
// down when the machine turns out slower than it looked.
//
// Ported from Fable Cities (github.com/rawprogress/fable-cities,
// src/modules/perfguard/{guard,index}.js, MIT — see THIRD-PARTY-NOTICES.md).
// The guard itself is a pure state machine, copied nearly verbatim; the
// attach() half is rewritten around this client's three knobs.
//
// The guard's design goals, in order:
//   1. Never oscillate. A guard that flips between presets is worse than none.
//   2. Never react to a hitch. Shader compiles, GC, a tab switch and another
//      app stealing the GPU all produce single 100-2000 ms frames that say
//      nothing about the steady state.
//   3. Step down at most twice, then stop measuring and cost nothing.
// How it avoids each failure mode:
//   MEDIAN of a ~2 s window            — one 900 ms hitch cannot move a median
//   frames over `spikeMs` are dropped   — an alt-tab is not a performance signal
//   a DEBT accumulator, two thresholds  — the hysteresis: debt grows only while
//     the median is under `targetFps` and drains only above `recoverFps`;
//     between the two nothing moves. Firing needs `sustainMs` of shortfall.
//   a cooldown after every change       — the frames right after a change are
//     polluted by reallocation and would immediately "prove" it did not help
//   a warm-up after boot                — first seconds are decode and compiles
//
// URL parameters:
//   ?q=low|medium|high   pin a preset: detection is reported but nothing moves
//   ?headless=1          tooling: pinned to `high` unless ?q= says otherwise,
//                        guard off, so a CI frame is the same frame every run
//   ?perfguard=0 / =1    force the guard off / on regardless of the above
//   ?perftarget=N        the guard's target fps, for watching it fire
import { PRESETS, PRESET_ORDER, detectHardware, recommendQuality, describeHardware, isCheaper, stepDown } from './quality.js';

export const GUARD_DEFAULTS = {
  targetFps: 40,      // below this the frame budget is considered missed
  recoverFps: 50,     // above this the debt drains — 40..50 is the dead-band
  windowMs: 2000,     // rolling window the median is taken over
  sustainMs: 4000,    // continuous shortfall required before stepping down
  cooldownMs: 8000,   // ignore everything for this long after a step
  warmupMs: 6000,     // ignore the first frames after the city is ready
  evaluateMs: 250,    // how often the median is recomputed
  spikeMs: 400,       // frames longer than this are hitches, not signal
  maxSteps: 2,        // hard limit on automatic downgrades per visit
};

/** Pure: `sample(nowMs, frameMs)` in, `'stepDown'` or null out. No DOM, no renderer. */
export function createGuard(options = {}) {
  const opt = { ...GUARD_DEFAULTS, ...options };
  const budgetMs = 1000 / opt.targetFps;
  const recoverMs = 1000 / opt.recoverFps;
  const maxDebt = opt.sustainMs * 1.5;
  const times = [];
  const frames = [];
  let debt = 0;
  let steps = 0;
  let lastEval = 0;
  let blockedUntil = opt.warmupMs;
  let t0 = null;
  let lastMedian = 0;
  let dropped = 0;

  function reset(nowMs, holdMs) {
    times.length = 0;
    frames.length = 0;
    debt = 0;
    lastMedian = 0;
    lastEval = 0;   // a simulated clock may run behind a previous one; real time never does
    blockedUntil = (nowMs - t0) + holdMs;
  }

  return {
    get steps() { return steps; },
    get exhausted() { return steps >= opt.maxSteps; },
    get debtMs() { return debt; },
    get medianMs() { return lastMedian; },
    get droppedSpikes() { return dropped; },
    get options() { return { ...opt }; },
    /** Forget the window (tab hidden, resize, a manual quality change). */
    forget(nowMs, holdMs = opt.cooldownMs) {
      if (t0 == null) return;
      reset(nowMs, holdMs);
    },
    sample(nowMs, frameMs) {
      if (t0 == null) t0 = nowMs;
      const t = nowMs - t0;
      if (!(frameMs > 0) || frameMs > opt.spikeMs) { dropped++; return null; }
      if (steps >= opt.maxSteps) return null;
      times.push(nowMs);
      frames.push(frameMs);
      const cutoff = nowMs - opt.windowMs;
      while (times.length && times[0] < cutoff) { times.shift(); frames.shift(); }
      if (t < blockedUntil) return null;
      if (nowMs - lastEval < opt.evaluateMs) return null;
      lastEval = nowMs;
      // a partial window is not evidence
      if (frames.length < 20 || (times[times.length - 1] - times[0]) < opt.windowMs * 0.6) return null;
      const sorted = frames.slice().sort((a, b) => a - b);
      const median = sorted[sorted.length >> 1];
      lastMedian = median;
      const dt = opt.evaluateMs;
      if (median > budgetMs) debt = Math.min(maxDebt, debt + dt);
      else if (median < recoverMs) debt = Math.max(0, debt - dt);
      return debt >= opt.sustainMs ? 'stepDown' : null;
    },
    /** Confirm a step was applied: burn one of the allowed steps, start the cooldown. */
    stepped(nowMs) {
      steps++;
      reset(nowMs, opt.cooldownMs);
      return steps;
    },
  };
}

const STORE_KEY = 'otra_quality';
const store = {
  get() { try { return localStorage.getItem(STORE_KEY); } catch { return null; } },
  set(v) { try { localStorage.setItem(STORE_KEY, v); } catch { /* private mode */ } },
};

/**
 * Wire detection + guard to the client.
 *   renderer, composer   the three.js renderer and its EffectComposer
 *   bloom                the UnrealBloomPass (switched off as the last resort)
 *   lights               the light pool from lights.js (setBudget)
 *   params               URLSearchParams
 *   notify(text)         one quiet line to the visitor when we change something
 * → api: { quality, hardware, recommended, begin(), tick(now), setPreset(), status() }
 */
export function attachPerfGuard({ renderer, composer, bloom, lights, params, notify = () => {} }) {
  let hardware;
  let recommended;
  try {
    hardware = detectHardware(renderer.getContext());
    recommended = recommendQuality(hardware);
  } catch (err) {
    console.warn('[perfguard] hardware detection failed', err);
    hardware = { renderer: 'detection failed', gpuTier: 1, gpuLabel: 'unknown', cores: 0, memoryGB: null, dpr: 1, viewport: [0, 0], mobile: false, gpuConfidence: 'guessed' };
    recommended = { name: 'medium', reasons: ['detection threw: ' + (err && err.message)] };
  }

  const pinned = PRESETS[params.get('q')] ? params.get('q') : null;
  const headless = params.get('headless') === '1';
  const flag = params.get('perfguard');
  const enabled = flag === '1' || (flag !== '0' && !headless);
  const targetFps = Number(params.get('perftarget')) || GUARD_DEFAULTS.targetFps;

  // The boot decision: a pin wins; tooling gets `high` so frames reproduce;
  // otherwise the cheaper of detection and what an earlier visit stepped down
  // to (only step-downs are stored, so the store can only lower the guess).
  let start = pinned || (headless ? 'high' : recommended.name);
  const remembered = store.get();
  if (!pinned && !headless && PRESETS[remembered] && isCheaper(remembered, start)) start = remembered;

  const log = [];
  const guard = createGuard({ targetFps });
  let current = null;
  let bloomOff = false;
  let userOverride = false;
  let sampling = false;
  let lastT = 0;

  function apply(name, why) {
    const p = PRESETS[name];
    const pr = Math.min(window.devicePixelRatio || 1, p.pixelRatio);
    const changed = [];
    if (Math.abs(renderer.getPixelRatio() - pr) > 1e-3) {
      renderer.setPixelRatio(pr);
      composer.setSize(window.innerWidth, window.innerHeight);
      changed.push(`pixelRatio ${pr}`);
    }
    if (lights.budget !== p.lights) { lights.setBudget(p.lights); changed.push(`lights ${p.lights}`); }
    if (bloom.enabled !== !bloomOff) { bloom.enabled = !bloomOff; changed.push(`bloom ${bloom.enabled ? 'on' : 'off'}`); }
    const from = current;
    current = name;
    log.push({ at: +(performance.now() / 1000).toFixed(1), from, to: name, why, changed });
    if (log.length > 20) log.shift();
    if (from !== null) console.info(`[perfguard] ${from} → ${name} (${why}) · ${changed.join(', ') || 'nothing live differed'}`);
  }

  apply(start, pinned ? 'pinned by ?q=' : headless ? 'headless: pinned to high' : `boot: ${describeHardware(hardware)}`);
  console.info(`[perfguard] ${describeHardware(hardware)} → recommends ${recommended.name}; running ${current}` +
    `${pinned ? ' (pinned)' : ''}${enabled ? '' : ' (guard off)'}`);

  // One step: the next preset down, or — already at `low` — bloom off.
  function down(why) {
    const to = stepDown(current, 1);
    if (to !== current) {
      apply(to, why);
      store.set(to);
      notify(`graphics lowered to ${to} — your device was dropping frames`);
      return true;
    }
    if (!bloomOff) {
      bloomOff = true;
      bloom.enabled = false;
      log.push({ at: +(performance.now() / 1000).toFixed(1), from: current, to: current, why, changed: ['bloom off'] });
      console.info(`[perfguard] bloom off (${why})`);
      notify('bloom switched off — your device was dropping frames');
      return true;
    }
    return false;
  }

  function tick(now) {
    if (!enabled || userOverride || guard.exhausted) return;
    if (document.hidden) { guard.forget(now); lastT = 0; return; }
    if (!lastT) { lastT = now; return; }
    const frameMs = now - lastT;
    lastT = now;
    if (!sampling) return;
    if (guard.sample(now, frameMs) !== 'stepDown') return;
    const why = `median ${guard.medianMs.toFixed(1)} ms over ${guard.options.sustainMs / 1000} s (target ${targetFps} fps)`;
    if (!down(why)) return;
    guard.stepped(now);
  }

  const settle = (holdMs) => { lastT = 0; guard.forget(performance.now(), holdMs); };
  addEventListener('resize', () => settle(1500));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) settle(1500); });

  const api = {
    hardware,
    recommended,
    get quality() { return current; },
    get enabled() { return enabled; },
    get pinned() { return !!pinned; },
    presets: PRESET_ORDER,
    log,
    /** Start measuring: call once the city is loaded and the frame is real. */
    begin() { sampling = true; settle(GUARD_DEFAULTS.warmupMs); },
    tick,
    /** A manual pick stops the guard — respect the human. */
    setPreset(name) {
      if (!PRESETS[name]) return null;
      userOverride = true;
      bloomOff = false;
      apply(name, 'set by hand');
      return current;
    },
    /** Verification hook: pretend the machine missed the budget for `seconds`. */
    simulateShortfall(seconds = 6, fps = 20) {
      const step = 1000 / fps;
      let t = performance.now();
      sampling = true;
      guard.forget(t, 0);
      for (let i = 0; i < (seconds * 1000) / step; i++) {
        t += step;
        if (guard.sample(t, step) === 'stepDown') {
          if (down(`simulated shortfall at ${fps} fps`)) guard.stepped(t);
        }
      }
      return api.status();
    },
    /** JSON-safe snapshot — what a check script or the HUD should read. */
    status() {
      return {
        hardware: { ...hardware },
        recommended: recommended.name,
        reasons: recommended.reasons,
        quality: current,
        pinned: !!pinned,
        enabled,
        bloom: bloom.enabled,
        pixelRatio: renderer.getPixelRatio(),
        lights: lights.budget,
        guard: { steps: guard.steps, exhausted: guard.exhausted, sampling, medianMs: +guard.medianMs.toFixed(2), debtMs: Math.round(guard.debtMs) },
        log: log.slice(),
      };
    },
  };
  return api;
}
