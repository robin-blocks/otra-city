// A distributed public-address system: one commentary feed, several speakers
// around a venue, and the arrival delay that makes a stadium sound like a
// stadium.
//
// In a real ground every horn is wired to the same amplifier and fires at the
// same instant. What reaches your ear is not simultaneous: each horn is a
// different distance away, and sound covers about 343 m in a second, so the
// far side of a 50 m bowl arrives ~150 ms after the near side. That spread —
// not reverb, not an effect — is the slapback you hear at a match, and it
// changes as you walk, because the distances change. WebAudio's PannerNode
// models direction and attenuation but NOT propagation delay, so the delay has
// to be built: one DelayNode per speaker, its time driven by that speaker's
// distance to the listener.
//
// The audio itself belongs to the match publisher. 4DGSX ships commentary as
// an unanchored source, which its format explicitly leaves to the host to
// place ("a source the publisher anchored stays where it was put; everything
// else is yours to position"), so taking it over here is within the contract —
// but the SDK keeps its own sources in WebAudio nodes it does not expose, so
// "taking it over" means playing the stem ourselves and asking the SDK to stop
// playing its copy.
//
// Streaming, never decoded: a 17-minute stem is ~5 MB compressed and about
// 385 MB as float32, so `decodeAudioData` is not an option. A MediaElement
// source streams it, seeks natively, and costs almost nothing.
import * as THREE from 'three';

const SPEED_OF_SOUND = 343;   // m/s, dry air at about 20 °C
const MAX_DELAY_S = 1.0;      // 343 m of headroom; a venue is far smaller
const RESEEK_S = 0.35;        // drift we tolerate before jumping the stem
const RAMP_S = 0.09;          // delay changes ease over this, so walking does
                              // not click; the residual pitch shift IS Doppler

// [match_t, audio_t] breakpoints, slope 1 between, a duplicated match_t means
// inserted media (a goal replay in the broadcast, while match time stands
// still). Maps match time to a position in the stem.
export function mapTime(map, t) {
  if (!map || !map.length) return t;
  if (t <= map[0][0]) return map[0][1];
  for (let i = 1; i < map.length; i++) {
    const [m0, a0] = map[i - 1];
    const [m1, a1] = map[i];
    if (t <= m1) {
      if (m1 === m0) return a1;              // inserted media: take the far side
      return a0 + ((t - m0) * (a1 - a0)) / (m1 - m0);
    }
  }
  return map[map.length - 1][1];
}

/**
 * @param {object}  o
 * @param {THREE.AudioListener} o.listener  the city's listener — we hang off its
 *   input so the one mute button silences the PA too
 * @param {THREE.Object3D} o.root  the venue root; speaker positions are venue-local
 * @param {object} o.cfg  the venue's `pa` block
 */
export function createPA({ listener, root, cfg = {}, log = console }) {
  const ctx = listener.context;
  const speed = cfg.speed_of_sound || SPEED_OF_SOUND;
  const state = {
    ready: false, playing: false, speakers: 0, source: cfg.source || 'commentary',
    spreadMs: 0, nearestMs: 0, farthestMs: 0, drift: 0, error: null,
  };

  const master = ctx.createGain();
  master.gain.value = 0;                     // silent until something plays
  master.connect(listener.getInput());

  // One chain per horn: delay (arrival time) → panner (direction + falloff).
  const speakers = (cfg.speakers || []).map((at) => {
    const delay = ctx.createDelay(MAX_DELAY_S);
    const panner = ctx.createPanner();
    panner.panningModel = cfg.panning || 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = cfg.ref ?? 18;
    panner.maxDistance = cfg.max ?? 140;
    panner.rolloffFactor = cfg.rolloff ?? 0.9;
    master.connect(delay);
    delay.connect(panner);
    panner.connect(listener.getInput());
    return { at: new THREE.Vector3(...at), world: new THREE.Vector3(), delay, panner, lastDelay: -1 };
  });
  state.speakers = speakers.length;

  let el = null;
  let src = null;
  let map = null;
  let gain = cfg.gain ?? 1;

  function placeSpeakers() {
    root.updateMatrixWorld(true);
    for (const s of speakers) {
      s.world.copy(s.at).applyMatrix4(root.matrixWorld);
      if (s.panner.positionX) {
        s.panner.positionX.value = s.world.x;
        s.panner.positionY.value = s.world.y;
        s.panner.positionZ.value = s.world.z;
      } else {
        s.panner.setPosition(s.world.x, s.world.y, s.world.z);   // older Safari
      }
    }
  }
  placeSpeakers();

  /** Fetch the bundle's manifest, find our source, and stream its file. */
  async function load(bundleUrl) {
    if (!speakers.length) { state.error = 'no speakers declared'; return false; }
    try {
      const base = bundleUrl.replace(/\/+$/, '');
      const scene = await (await fetch(`${base}/scene.json`, { credentials: 'omit' })).json();
      const spec = (scene.audio?.sources || []).find((s) => s.id === state.source);
      if (!spec) { state.error = `bundle has no "${state.source}" source`; return false; }
      if (spec.anchor) { state.error = `"${state.source}" is anchored to a body — not ours to place`; return false; }
      map = spec.map || scene.audio?.map || null;
      gain = (cfg.gain ?? 1) * (spec.gain ?? 1);
      el = document.createElement('audio');
      el.crossOrigin = 'anonymous';   // required, or the graph outputs silence
      el.preload = 'auto';
      el.src = `${base}/${spec.file}`;
      await new Promise((done, fail) => {
        el.addEventListener('loadedmetadata', done, { once: true });
        el.addEventListener('error', () => fail(new Error(`cannot load ${spec.file}`)), { once: true });
        setTimeout(() => fail(new Error('timed out loading the stem')), 30000);
      });
      src = ctx.createMediaElementSource(el);
      src.connect(master);
      state.ready = true;
      return true;
    } catch (e) {
      state.error = e.message || String(e);
      log.warn('pa-system:', state.error);
      return false;
    }
  }

  /** Put the stem where the match clock says it should be. */
  function seek(matchT) {
    if (!el) return;
    const want = mapTime(map, matchT);
    if (Number.isFinite(want) && want >= 0) el.currentTime = Math.min(want, el.duration || want);
  }

  async function start(matchT) {
    if (!state.ready || state.playing) return;
    seek(matchT);
    try {
      await el.play();
      state.playing = true;
      master.gain.setTargetAtTime(gain, ctx.currentTime, 0.05);
    } catch (e) {
      state.error = `play refused: ${e.message}`;   // no gesture yet; caller retries
    }
  }

  function stop() {
    if (!el) return;
    state.playing = false;
    master.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
    el.pause();
  }

  /** Keep the stem on the match clock; the broadcast timeline is not linear. */
  function sync(matchT) {
    if (!state.playing || !el) return;
    const want = mapTime(map, matchT);
    state.drift = +(el.currentTime - want).toFixed(3);
    if (Math.abs(state.drift) > RESEEK_S) seek(matchT);
  }

  function setEnabled(on) {
    if (!state.ready) return;
    master.gain.setTargetAtTime(on ? gain : 0, ctx.currentTime, 0.08);
  }

  /**
   * The whole point. Each horn's delay is its own distance to the listener
   * divided by the speed of sound, so the spread between near and far speakers
   * — and therefore the character of the echo — changes as the visitor walks.
   */
  function update() {
    const lp = new THREE.Vector3();
    listener.getWorldPosition(lp);
    let near = Infinity;
    let far = 0;
    for (const s of speakers) {
      const d = lp.distanceTo(s.world) / speed;
      near = Math.min(near, d);
      far = Math.max(far, d);
      if (s.lastDelay < 0 || Math.abs(d - s.lastDelay) > 0.05) {
        s.delay.delayTime.value = d;                       // first frame, or a jump
      } else {
        s.delay.delayTime.linearRampToValueAtTime(d, ctx.currentTime + RAMP_S);
      }
      s.lastDelay = d;
    }
    state.nearestMs = Math.round(near * 1000);
    state.farthestMs = Math.round(far * 1000);
    state.spreadMs = state.farthestMs - state.nearestMs;
  }

  function dispose() {
    stop();
    try { src?.disconnect(); } catch { /* already gone */ }
    for (const s of speakers) { try { s.delay.disconnect(); s.panner.disconnect(); } catch { /* gone */ } }
    try { master.disconnect(); } catch { /* gone */ }
    if (el) { el.removeAttribute('src'); el.load(); el = null; }
    state.ready = false;
    state.playing = false;
  }

  return { load, start, stop, sync, setEnabled, update, dispose, placeSpeakers, get state() { return { ...state }; } };
}
