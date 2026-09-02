// Per-plot media: positional ambient audio + video screens, with the client
// enforcing every limit that matters for an infinitely scalable city:
//   * plot audio is positional-ONLY (never global) with a hard rolloff radius,
//     so a shop's music stays in the shop
//   * only the K nearest audio sources / screens actually play; everything
//     else is paused — cost is bounded by proximity, not by city size
//   * screens are always muted (sound lives in the audio slot; this also
//     satisfies browser autoplay policy)
//   * the city's own soundtrack is the single non-positional source, and it
//     yields: it comes and goes in phrases with long silences between, and
//     ducks away entirely on a plot that brought its own ambient audio, so you
//     never hear two loops at once
import * as THREE from 'three';

const AUDIO_REF = 3;      // full volume within this radius (m)
const AUDIO_MAX = 14;     // inaudible beyond this
const AUDIO_PLAY_K = 3;   // max simultaneously playing ambient sources
const SCREEN_RANGE = 20;  // screens farther than this pause
const SCREEN_PLAY_K = 2;  // max simultaneously playing videos
const LOT_HALF = 5;       // plots are a 10 x 10 m envelope (plot-spec size_m)
const DUCK_MARGIN = 0.6;  // you must cross this far past the lot edge either
                          // way, so standing in a doorway can't chatter
const DUCK_FADE_S = 0.9;  // walking onto a lot clears the street loop briskly
const CITY_FADE_S = 3;    // otherwise it drifts, never switches
const CITY_PLAY_S = [30, 50];   // a phrase of the street loop (it is 10 s long)
const CITY_QUIET_S = [60, 150]; // and the silence between phrases

// A named glTF node with multiple primitives imports as a parent Object3D
// with mesh children — resolve to the first actual mesh under the name.
function findMeshByName(root, name) {
  const named = root.getObjectByName(name);
  if (!named) return null;
  let mesh = null;
  named.traverse((o) => { if (!mesh && o.isMesh) mesh = o; });
  return mesh;
}

export function createMediaSystem(camera) {
  const listener = new THREE.AudioListener();
  camera.add(listener);
  const audios = [];   // { sound, worldPos, lotPos }
  const screens = [];  // { video, tex, mesh, worldPos }
  let unlocked = false;
  let muted = false;

  const unlock = () => {
    if (unlocked) return;
    unlocked = true;
    listener.context.resume();
  };
  addEventListener('pointerdown', unlock, { once: false });
  addEventListener('keydown', unlock, { once: false });

  function attachAudio(container, cfg) {
    const anchor = new THREE.Object3D();
    anchor.position.fromArray(cfg.position || [0, 2, 0]);
    container.add(anchor);
    const sound = new THREE.PositionalAudio(listener);
    sound.setRefDistance(AUDIO_REF);
    sound.setMaxDistance(AUDIO_MAX);
    sound.setDistanceModel('exponential');
    sound.setRolloffFactor(1.6);
    sound.setLoop(true);
    sound.setVolume(0.85);
    anchor.add(sound);
    new THREE.AudioLoader().load(cfg.file, (buf) => sound.setBuffer(buf));
    container.updateMatrixWorld(true);
    audios.push({
      sound,
      worldPos: anchor.getWorldPosition(new THREE.Vector3()),
      // the container IS the lot centre — what the duck test needs, and not
      // the same point as the speaker, which the plot may hang anywhere
      lotPos: container.getWorldPosition(new THREE.Vector3()),
    });
  }

  function attachScreens(container, gltfScene, list) {
    for (const cfg of list) {
      const mesh = findMeshByName(gltfScene, cfg.node);
      if (!mesh) {
        console.warn('screen node missing:', cfg.node);
        continue;
      }
      const video = document.createElement('video');
      video.src = cfg.file;
      video.muted = true;          // hard rule: screens are silent
      video.loop = true;
      video.playsInline = true;
      video.preload = 'auto';
      const tex = new THREE.VideoTexture(video);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.flipY = false; // glTF UV convention (media nodes carry full 0..1 UVs)
      mesh.material = new THREE.MeshBasicMaterial({ map: tex });
      container.updateMatrixWorld(true);
      screens.push({ video, tex, mesh, worldPos: mesh.getWorldPosition(new THREE.Vector3()) });
    }
  }

  // Live data feed: the city polls the project's endpoint on a cooldown
  // (server-side in production — sanitized, rate-limited), renders the values
  // in CITY typography, and swaps the texture on a named panel node. The
  // client never runs or fetches agent code; panels stay legible and on-grid.
  function renderFeed(data) {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 384;
    const x = c.getContext('2d');
    x.fillStyle = '#0b0714';
    x.fillRect(0, 0, 512, 384);
    x.strokeStyle = '#2fe0f8';
    x.lineWidth = 6;
    x.strokeRect(8, 8, 496, 368);
    x.fillStyle = '#ff3b30';
    x.fillRect(30, 32, 22, 22);
    x.fillStyle = '#e9edf6';
    x.font = '700 26px Menlo, monospace';
    x.fillText(data.title || 'LIVE', 66, 52);
    x.font = '700 96px Menlo, monospace';
    x.fillText(String(data.big ?? ''), 30, 170);
    x.fillStyle = '#2fe0f8';
    x.font = '24px Menlo, monospace';
    x.fillText(String(data.sub ?? ''), 30, 218);
    const bars = Array.isArray(data.bars) ? data.bars.slice(0, 16) : [];
    const bmax = Math.max(1, ...bars);
    x.fillStyle = '#ff2d95';
    bars.forEach((b, i) => {
      const h = Math.max(4, (b / bmax) * 100);
      x.fillRect(34 + i * 28, 344 - h, 16, h);
    });
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.flipY = false; // glTF UV convention
    return t;
  }

  const feeds = [];
  function attachFeed(gltfScene, cfg) {
    const mesh = findMeshByName(gltfScene, cfg.node);
    if (!mesh) {
      console.warn('feed node missing:', cfg.node);
      return;
    }
    // Fallback semantics (contractual): until the first successful poll the
    // panel shows its AUTHORED texture from the glb; after any later failure
    // it keeps the last good render. A broken feed can never blank a panel.
    // External endpoints are fetched by the browser, so they must send
    // Access-Control-Allow-Origin — checked at submission time.
    const state = { mesh, url: cfg.file, count: 0 };
    const poll = async () => {
      try {
        // NO cache-buster. Every visitor's browser polls this URL directly, so
        // a unique query string per poll would make every one of them a CDN
        // MISS and bill the plot owner a function invocation per visitor per
        // interval, forever. `cache: 'no-store'` keeps the panel current
        // without that: the browser never serves its own stale copy, while the
        // owner's CDN still answers from the edge and their origin sees one
        // request per cache lifetime.
        const r = await fetch(state.url, { cache: 'no-store' });
        if (!r.ok) return;
        const data = await r.json();
        const old = mesh.material;
        mesh.material = new THREE.MeshBasicMaterial({ map: renderFeed(data) });
        if (old.map && old.map.isCanvasTexture) old.map.dispose();
        state.count += 1;
      } catch { /* keep last good texture */ }
    };
    poll();
    state.timer = setInterval(poll, Math.max(60, cfg.interval_s ?? 120) * 1000);
    feeds.push(state);
  }

  // Static pictures — the low-friction way to put real product imagery on a
  // wall: a named flat quad (pic_1..pic_6, full 0..1 UVs) gets the image as
  // an unlit texture, exactly like a screen but with no video pipeline.
  function attachPictures(gltfScene, list) {
    for (const cfg of list.slice(0, 6)) {
      const mesh = findMeshByName(gltfScene, cfg.node);
      if (!mesh) {
        console.warn('picture node missing:', cfg.node);
        continue;
      }
      const tex = new THREE.TextureLoader().load(cfg.file);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.flipY = false; // glTF UV convention
      tex.anisotropy = 4;
      mesh.material = new THREE.MeshBasicMaterial({ map: tex });
    }
  }

  function attach(container, gltfScene, media, base = '') {
    if (!media) return;
    const abs = typeof base === 'function'
      ? base
      : (f) => (f && !f.startsWith('/') && !f.startsWith('http') && !f.startsWith('blob:') ? base + f : f);
    if (media.audio) attachAudio(container, { ...media.audio, file: abs(media.audio.file) });
    if (media.screens) {
      attachScreens(container, gltfScene, media.screens.map((s) => ({ ...s, file: abs(s.file) })));
    }
    if (media.pictures) {
      attachPictures(gltfScene, media.pictures.map((p) => ({ ...p, file: abs(p.file) })));
    }
    if (media.feed) {
      attachFeed(gltfScene, { ...media.feed, file: abs(media.feed.url || media.feed.file) });
    }
  }

  // The city's soundtrack: the one source that is NOT positional, because it
  // belongs to the street rather than to any lot. It is also the one source
  // that knows when to shut up — see updateCitySoundtrack().
  let music = null;
  let musicVolume = 0;
  let gain = 0;        // where the loop is between silent (0) and full (1)
  let phase = 'play';  // 'play' | 'quiet'
  let phaseLeft = 0;   // seconds until this phase ends
  let onLot = false;

  const rand = ([a, b]) => a + Math.random() * (b - a);

  function attachCitySoundtrack(file, volume = 0.22) {
    music = new THREE.Audio(listener);
    musicVolume = volume;
    music.setLoop(true);
    music.setVolume(0);
    phaseLeft = rand(CITY_PLAY_S);   // the city introduces itself, then thins out
    new THREE.AudioLoader().load(file, (buf) => music.setBuffer(buf));
  }

  // The street loop is scored like a game's, not like a lobby's: it plays a
  // phrase, drifts out, and leaves the street quiet for a good while before
  // drifting back. Silence is the default state of a street, and a bed that
  // never stops is the thing you end up muting.
  //
  // Two rules on top of that rhythm:
  //   * standing on a lot whose plot brought its OWN ambient audio cuts the
  //     street loop faster — inside someone's build, their mix is the mix.
  //     A plot with no audio (a garden, a monument) is left alone, so it keeps
  //     whatever the street is doing rather than being forced into silence.
  //   * stepping back out does NOT hand the music straight back. Leaving
  //     starts a fresh silence, so the street you walk back onto is quiet and
  //     the loop returns on its own terms.
  function updateCitySoundtrack(playerPos, dt) {
    if (!music) return;
    // hysteresis: the line you cross to duck sits further in than the one you
    // cross to come back, so a doorway can't flip it every frame
    const half = LOT_HALF + (onLot ? DUCK_MARGIN : -DUCK_MARGIN);
    const nowOnLot = audios.some((a) => a.sound.buffer
      && Math.abs(playerPos.x - a.lotPos.x) <= half
      && Math.abs(playerPos.z - a.lotPos.z) <= half);
    if (onLot && !nowOnLot) {
      phase = 'quiet';
      phaseLeft = rand(CITY_QUIET_S);
    } else if (!nowOnLot) {
      phaseLeft -= dt;
      if (phaseLeft <= 0) {
        phase = phase === 'play' ? 'quiet' : 'play';
        phaseLeft = rand(phase === 'play' ? CITY_PLAY_S : CITY_QUIET_S);
      }
    }
    onLot = nowOnLot;

    const target = !onLot && phase === 'play' ? 1 : 0;
    const fade = onLot ? DUCK_FADE_S : CITY_FADE_S;
    const next = THREE.MathUtils.clamp(gain + Math.sign(target - gain) * (dt / fade), 0, 1);
    if (next !== gain) {   // only touch the gain node while the fade is moving
      gain = next;
      music.setVolume(musicVolume * gain);
    }
    // Autoplay policy: the loop can only start once a gesture has resumed the
    // context. Silent, it STOPS rather than decoding into a muted gain node —
    // and stop (not pause) means each phrase enters at the top of the loop.
    const want = !muted && gain > 0 && !!music.buffer && listener.context.state === 'running';
    if (want && !music.isPlaying) music.play();
    if (!want && music.isPlaying) music.stop();
  }

  const byDistance = (items, p) => items
    .map((it) => ({ it, d: Math.hypot(it.worldPos.x - p.x, it.worldPos.z - p.z) }))
    .sort((a, b) => a.d - b.d);

  function update(playerPos, dt = 1 / 60) {
    const au = byDistance(audios, playerPos);
    au.forEach(({ it, d }, rank) => {
      const want = unlocked && it.sound.buffer && d < AUDIO_MAX + 2 && rank < AUDIO_PLAY_K;
      if (want && !it.sound.isPlaying) it.sound.play();
      if (!want && it.sound.isPlaying) it.sound.pause();
    });
    const sc = byDistance(screens, playerPos);
    sc.forEach(({ it, d }, rank) => {
      const want = d < SCREEN_RANGE && rank < SCREEN_PLAY_K;
      if (want && it.video.paused) it.video.play().catch(() => {});
      if (!want && !it.video.paused) it.video.pause();
    });
    updateCitySoundtrack(playerPos, dt);
  }

  return {
    attach,
    attachCitySoundtrack,
    update,
    listener,
    setMuted(v) { muted = v; listener.setMasterVolume(v ? 0 : 1); },
    get state() {
      return {
        unlocked,
        ctx: listener.context.state,
        audio: audios.map((a) => ({ loaded: !!a.sound.buffer, playing: a.sound.isPlaying })),
        music: music
          ? {
            loaded: !!music.buffer,
            playing: music.isPlaying,
            gain: +gain.toFixed(2),
            phase,
            nextIn: +phaseLeft.toFixed(1),
            onLot,
          }
          : null,
        screens: screens.map((s) => ({ ready: s.video.readyState, playing: !s.video.paused, t: +s.video.currentTime.toFixed(2) })),
        feeds: feeds.map((f) => ({ updates: f.count })),
      };
    },
  };
}
