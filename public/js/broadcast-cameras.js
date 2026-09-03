// The named broadcast cameras, and the camera track file that sequences them.
//
// RFL's §5 asks for shots rather than positions: an orbiting helicopter with
// believable turbulence, a slow push across the stands, a low handheld at
// pitch level — each re-running identically under the same seed. So every
// camera here is a pure function of (frame, seed, params). No state carries
// between frames, which means seeking to frame 9000 gives the same view as
// stepping there, and two processes filming the same segment agree.
//
// EVERYTHING IS VENUE-LOCAL. Positions are metres from the pitch centre with
// +z toward the north stand, the same frame RFL's own geometry table uses;
// the caller converts once via world.toWorld. A camera track file written
// against their arena needs no translation to work here.

/** Deterministic value noise in one dimension: smooth, seedable, cheap. */
function noise1(seed, t) {
  // Sum of incommensurable sines — no table, no state, continuous in t, and
  // stable across engines because it is only sin() and multiplication.
  const s = (seed % 1000) * 0.6180339887;
  return (Math.sin(t * 1.000 + s * 1.7) * 0.55
        + Math.sin(t * 2.137 + s * 3.1) * 0.28
        + Math.sin(t * 4.371 + s * 5.9) * 0.13
        + Math.sin(t * 8.933 + s * 9.3) * 0.06) / 1.02;
}

/** Three uncorrelated noise channels — a handheld wobble, not a circle. */
function shake(seed, t, amp) {
  return [noise1(seed * 3 + 1, t) * amp,
          noise1(seed * 3 + 2, t) * amp * 0.7,
          noise1(seed * 3 + 3, t) * amp];
}

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

/**
 * Built-in cameras. Each returns { pos, lookAt, fov? } in venue-local metres.
 * `t` is seconds of simulated time; `seed` selects one of many equally valid
 * versions of the same shot.
 */
export const CAMERAS = {
  /** The main broadcast position: static, and the one shot that never moves. */
  gantry(t, seed, p = {}) {
    return { pos: [p.x ?? 0, p.height_m ?? 8.7, p.back_m ?? -10.6], lookAt: [0, 0.6, 0], fov: p.vfov_deg ?? 50 };
  },

  /** Helicopter orbit with turbulence. radius_m, height_m, period_s. */
  heli(t, seed, p = {}) {
    const r = p.radius_m ?? 60, h = p.height_m ?? 45, period = p.period_s ?? 90;
    const a = (t / period) * Math.PI * 2 + (p.phase ?? 0);
    const pos = [Math.cos(a) * r, h, Math.sin(a) * r];
    // Turbulence grows with height and speed, as a real airframe's does; the
    // look-at wanders less than the body, because the operator is correcting.
    const air = (p.turbulence ?? 1) * (0.5 + h / 90);
    return {
      pos: add(pos, shake(seed, t * 0.35, 0.9 * air)),
      lookAt: add([0, 2, 0], shake(seed + 77, t * 0.21, 1.6 * air)),
      fov: p.vfov_deg ?? 42,
    };
  },

  /**
   * A slow push toward a cluster of spectators. The cluster is chosen from the
   * seed, so a segment can be re-cut without re-filming, and the shot drifts
   * rather than tracks — a long lens on sticks, not a gimbal.
   */
  stands(t, seed, p = {}) {
    const side = (p.side !== undefined ? p.side : Math.floor(Math.abs(noise1(seed, 11)) * 4)) % 4;
    // the four stand fronts, in venue-local metres
    const anchors = [[-12, 2.2, 0], [12, 2.2, 0], [0, 2.2, 9.5], [0, 2.2, -9.5]];
    const target = anchors[side];
    const along = noise1(seed + 5, 3) * (side < 2 ? 6 : 8);
    const aim = side < 2 ? [target[0], target[1], along] : [along, target[1], target[2]];
    // start back and off to one side, then push in over the segment
    const push = Math.min(1, (t % (p.period_s ?? 40)) / (p.period_s ?? 40));
    const dist = (p.from_m ?? 16) * (1 - push * 0.45);
    const dir = side < 2 ? [Math.sign(aim[0] || 1), 0, 0] : [0, 0, Math.sign(aim[2] || 1)];
    const pos = [aim[0] - dir[0] * dist + (side < 2 ? 0 : dist * 0.35),
                 (p.height_m ?? 3.4) + push * 0.5,
                 aim[2] - dir[2] * dist + (side < 2 ? dist * 0.35 : 0)];
    return {
      pos: add(pos, shake(seed + 13, t * 0.13, 0.06)),
      lookAt: add(aim, shake(seed + 29, t * 0.11, 0.25)),
      fov: p.vfov_deg ?? 24,
    };
  },

  /** Low, near a corner, at pitch level, with the drift of a shouldered camera. */
  pitchside(t, seed, p = {}) {
    const cx = p.x ?? -8.5, cz = p.z ?? -8.6;
    return {
      pos: add([cx, p.height_m ?? 1.35, cz], shake(seed + 41, t * 0.5, 0.05)),
      lookAt: add([p.aim_x ?? 2, 0.5, p.aim_z ?? 1], shake(seed + 43, t * 0.4, 0.5)),
      fov: p.vfov_deg ?? 38,
    };
  },
};

/**
 * A camera track file (RFL's §4 schema) turned into a per-frame camera.
 *
 * ```
 * { "fps": 50, "segments": [
 *     { "frames": [0, 1500], "camera": "HELI", "seed": 7, "params": {…} },
 *     { "frames": [1500, 3000], "camera": "TRACK", "explicit": <url | [[pos,lookAt,vfov], …]> } ] }
 * ```
 *
 * `explicit` frames are indexed from the START of their segment, so a tracking
 * shot can be re-cut to a different point in the programme without re-exporting.
 */
export function createTrack(doc, { fetchJson } = {}) {
  const fps = doc.fps || 50;
  const segments = (doc.segments || []).map((s, i) => {
    const [a, b] = s.frames || [0, 0];
    if (!(b > a)) throw new Error(`segment ${i}: frames must be [start, end] with end > start`);
    return { from: a, to: b, camera: String(s.camera || 'gantry').toLowerCase(), seed: s.seed ?? 1,
             params: s.params || {}, explicit: s.explicit ?? null, index: i };
  }).sort((x, y) => x.from - y.from);

  /** Resolve any `explicit` given as a URL, once, before filming starts. */
  async function resolve() {
    for (const s of segments) {
      if (typeof s.explicit === 'string') {
        if (!fetchJson) throw new Error(`segment ${s.index}: explicit is a URL but no loader was given`);
        s.explicit = await fetchJson(s.explicit);
      }
      if (s.explicit && !Array.isArray(s.explicit)) throw new Error(`segment ${s.index}: explicit must be an array of frames`);
      if (s.explicit && s.explicit.length < s.to - s.from) {
        throw new Error(`segment ${s.index}: ${s.explicit.length} explicit frames for ${s.to - s.from} frames of segment`);
      }
      if (s.camera !== 'track' && !CAMERAS[s.camera]) {
        throw new Error(`segment ${s.index}: unknown camera "${s.camera}" — one of ${Object.keys(CAMERAS).join(', ')}, track`);
      }
    }
    return api;
  }

  function segmentAt(frame) {
    for (const s of segments) if (frame >= s.from && frame < s.to) return s;
    return null;
  }

  /** The camera for an absolute frame, or null past the end of the track. */
  function at(frame) {
    const s = segmentAt(frame);
    if (!s) return null;
    if (s.explicit) {
      const row = s.explicit[Math.min(s.explicit.length - 1, frame - s.from)];
      if (!row) return null;
      const [pos, lookAt, fov] = row;
      return { pos, lookAt, fov: fov ?? 50, segment: s.index, camera: 'track' };
    }
    // Named-camera segments run on their own clock from the segment's start,
    // so a cut to HELI always begins at the same point in the orbit.
    const c = CAMERAS[s.camera](( frame - s.from) / fps, s.seed, s.params);
    return { ...c, fov: c.fov ?? 50, segment: s.index, camera: s.camera };
  }

  const api = { at, resolve, fps, get segments() { return segments; },
                get lastFrame() { return segments.length ? segments[segments.length - 1].to : 0; } };
  return api;
}
