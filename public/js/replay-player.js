// The replay RFL render, played full-frame on /broadcast (restart_phase
// bundles, m76 on; RFL's letter of 2026-09-27, docs/broadcast/CAMERAS.md
// "Replays after a goal").
//
// The pitch never re-runs a goal any more: anyone in the stadium sees the
// robots walk home. The television cuts away to RFL's own replay package, a
// 1920×1080 50 fps H.264 file in the bundle, for the event's window, then cuts
// back. The picture goes INTO the canvas, so the scorebug (wearing REPLAY),
// the clean recording output and the stadium screen's copy all carry it, and
// the frame the stadium would have cost is not drawn at all.
//
// Timing is the programme's, not the video's: the file is positioned at
// (match time − window start) and left to play on its own clock, re-seeked
// only when it drifts past REPLAY_SYNC_TOLERANCE_S. The window itself comes
// from the shared director (`state().replay`), so every client cuts together.
// If the file is late, the live stadium stays on air until it has a frame;
// if it fails, the whole window is the live stadium. Nothing here guesses.
import * as THREE from 'three';
import { replayToLoad, replayNeedsSeek } from './replay-media.mjs';

const H264 = 'video/mp4; codecs="avc1.640028"';
const PRIME_S = 3;

export function createReplayPlayer({ width, height, doc = globalThis.document } = {}) {
  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  // Not tone-mapped: the file is a finished picture, and the renderer's ACES
  // would grade it a second time.
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, depthWrite: false, toneMapped: false });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  scene.add(quad);
  const stat = { src: null, loads: 0, cuts: 0, seeks: 0, errors: 0, error: null, onAir: false,
    readyState: 0, lateMs: null, h264: null };
  let video = null, tex = null, onAir = false, windowKey = null, windowSince = 0, primed = false;
  try { stat.h264 = doc?.createElement('video').canPlayType(H264) || ''; } catch { stat.h264 = null; }

  function unload() {
    if (!video) return;
    try { video.pause(); video.removeAttribute('src'); video.load(); } catch { /* already gone */ }
    tex?.dispose();
    video = null; tex = null; mat.map = null; mat.needsUpdate = true;
    stat.src = null; stat.readyState = 0;
  }

  function load(src) {
    unload();
    video = doc.createElement('video');
    // RFL's CDN answers with access-control-allow-origin: *, which is what
    // lets a cross-origin frame be drawn into WebGL at all.
    video.crossOrigin = 'anonymous';
    video.muted = true;            // the commentary stems carry the sound; the file has none
    video.playsInline = true;
    video.preload = 'auto';
    video.addEventListener('error', () => {
      stat.errors += 1;
      stat.error = video?.error ? `media error ${video.error.code}${video.error.message ? `: ${video.error.message}` : ''}` : 'media error';
    });
    video.addEventListener('loadedmetadata', () => fit());
    video.src = src;
    video.load();
    tex = new THREE.VideoTexture(video);
    tex.colorSpace = THREE.SRGBColorSpace;
    mat.map = tex; mat.needsUpdate = true;
    stat.src = src; stat.loads += 1; stat.error = null; primed = false;
  }

  /** Letterbox a file that is not 16:9 rather than stretch it. */
  function fit() {
    const vw = video?.videoWidth, vh = video?.videoHeight;
    if (!vw || !vh) return;
    const a = (vw / vh) / (width / height);
    quad.scale.set(Math.min(1, a), Math.min(1, 1 / a), 1);
  }

  /**
   * Once per live frame. `replays` are the module's events, `t` the programme's
   * match time, `window` the director's `state().replay` (null off air).
   * Returns whether the replay is the picture this frame.
   */
  function update({ replays = null, t = null, window = null } = {}) {
    const want = replayToLoad(replays, t);
    if (want?.src && want.src !== stat.src) load(want.src);
    else if (!want && !window && video) unload();
    const key = window?.src ? `${window.src}@${window.t}` : null;
    if (key !== windowKey) {
      // A new window (or the end of one): cut state starts afresh.
      if (onAir && !window) stat.cuts += 1;
      windowKey = key; onAir = false; windowSince = performance.now(); stat.lateMs = null;
    }
    if (!window || !video || window.src !== stat.src || stat.error) {
      if (video && !video.paused) video.pause();
      onAir = false;
      // Just before the window, have the first frame decoded rather than
      // only the file's header: the cut then lands on its own frame.
      if (video && !window && want && want.t - t < PRIME_S && video.readyState < 2 && !video.seeking && !primed) {
        primed = true; video.currentTime = 0;
      }
    } else {
      const target = Math.max(0, window.elapsed);
      stat.readyState = video.readyState;
      if (video.paused) {
        // Entering the window: a seek costs a frame, and on a slow page a frame
        // is a long time. Within the drift tolerance, just play from here.
        if (replayNeedsSeek(video.currentTime, target)) { video.currentTime = target; stat.seeks += 1; }
        video.play().catch((e) => { stat.error = `play: ${e?.message || e}`; });
      } else if (!video.seeking && replayNeedsSeek(video.currentTime, target)) {
        video.currentTime = target; stat.seeks += 1;
      }
      // On air from the first decoded frame at the right place, and then held
      // to the end of the window: a stall freezes the frame rather than
      // flicking back to the stadium and in again.
      if (!onAir && video.readyState >= 2 && !video.seeking && !replayNeedsSeek(video.currentTime, target, 0.5)) {
        onAir = true; stat.cuts += 1;
        stat.lateMs = Math.round(performance.now() - windowSince);
      }
    }
    stat.onAir = onAir;
    return onAir;
  }

  return {
    update,
    get onAir() { return onAir; },
    /** Draw the replay over the whole canvas, in place of the stadium. */
    render(renderer) {
      renderer.setRenderTarget(null);
      renderer.render(scene, cam);
    },
    // `at` is where the file is right now (null with none loaded): what a
    // check needs to know whether a late join had drifted far enough to seek
    state: () => ({ ...stat, at: video ? +video.currentTime.toFixed(3) : null }),
    dispose() { unload(); quad.geometry.dispose(); mat.dispose(); },
  };
}
