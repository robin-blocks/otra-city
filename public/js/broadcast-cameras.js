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

  /**
   * Helicopter orbit. radius_m, height_m, period_s (negative orbits the other
   * way), phase, turbulence, bank, vfov_deg.
   *
   * A first version of this moved the camera body around on slow noise and
   * called it turbulence. Measured, it came out at 0.08 Hz and 3 mm per frame
   * with no roll — which is a crane on a calm day, not an aircraft. Three
   * things had to change, and the order matters:
   *
   *   Angle, not position.  At 60 m, sliding the body a metre barely moves the
   *                         frame; turning the aim a quarter of a degree moves
   *                         it eight pixels. Aim wander is specified in radians
   *                         and converted to a target offset by distance, so it
   *                         reads the same from 20 m or 200 m.
   *   Two bands.            Slow airframe wander (~0.3 Hz) is the wind; a small
   *                         5-7 Hz component is the machine the camera is bolted
   *                         to. Either alone reads as wrong — the first as a
   *                         drone, the second as a broken mount.
   *   Roll.                 An orbiting aircraft banks, and the bank angle is
   *                         not a taste question: a coordinated turn at v² / rg
   *                         gives about 1.7° at the default radius and period.
   *                         The operator's own horizon wanders on top of it.
   */
  heli(t, seed, p = {}) {
    const r = p.radius_m ?? 60, h = p.height_m ?? 45;
    const period = p.period_s ?? 90;
    const T = Math.abs(period) || 90;
    const dir = period < 0 ? -1 : 1;                 // which way round the bowl
    const a = (t / T) * Math.PI * 2 * dir + (p.phase ?? 0);
    const air = p.turbulence ?? 1;

    // Body: the airframe moving in air. Metres, slow, plus a slower swell in
    // and out of the orbit so the radius is never exactly constant.
    const body = shake(seed, t * 0.5, 0.55 * air);
    const swell = noise1(seed + 101, t * 0.13) * 1.4 * air;
    const pos = [Math.cos(a) * r + body[0] + Math.cos(a) * swell,
                 h + body[1] + noise1(seed + 103, t * 0.11) * 0.9 * air,
                 Math.sin(a) * r + body[2] + Math.sin(a) * swell];

    // Aim: radians, converted to a target offset by the distance it is thrown
    // over. The tangent to the orbit is the horizontal axis to swing about.
    const dist = Math.hypot(pos[0], pos[2], pos[1] - 2) || 1;
    const drift = 0.0045 * air, buzz = 0.00055 * air;
    const yaw = noise1(seed + 77, t * 0.29) * drift + noise1(seed + 79, t * 6.1) * buzz;
    const pitch = noise1(seed + 81, t * 0.23) * drift + noise1(seed + 83, t * 7.3) * buzz;
    const lookAt = [-Math.sin(a) * yaw * dist, 2 + pitch * dist, Math.cos(a) * yaw * dist];

    // Roll: the coordinated-turn bank for this orbit, then the operator on top.
    const v = (2 * Math.PI * r) / T;
    const bank = Math.atan((v * v) / (r * 9.81)) * (p.bank ?? 1) * dir;
    const roll = bank
      + noise1(seed + 91, t * 0.19) * 0.012 * air
      + noise1(seed + 93, t * 5.7) * 0.0016 * air;

    return { pos, lookAt, roll, fov: p.vfov_deg ?? 42 };
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
 * THE GANTRY, FOLLOWING THE FLOW OF PLAY — RFL's own camera, not an
 * approximation of it.
 *
 * `CAMERAS.gantry` is a fixed framing and stays one: it is the contracted
 * position, the shot every capture and every cut-list resolves, and the one
 * the §3 sightline check proves can see all four corners of the marked area.
 * This is what the LIVE director does on top of it.
 *
 * RFL asked for it (their §4 of 2026-09-14, our REPLY-9 §3) and answered every
 * question in that letter by pointing at `gauntlet/football.py`, which is what
 * renders their own broadcast. This is that block, transposed from their
 * Z-up match space into venue-local metres. Their numbers, not ours:
 *
 *   The target    the mean of the players and the ball COUNTED TWICE — "the
 *                 ball is the story: weight it like two outfield players".
 *                 Not the ball alone: a wide that tracks only the ball swings
 *                 past the play every time it is cleared. Theirs drops FALLEN
 *                 robots first, from a fall tracker their simulation keeps
 *                 and a recording does not carry; every player is passed here,
 *                 which is their own fallback for all of them being down.
 *   The bias      the along-pitch component of that mean is multiplied by
 *                 0.45, "so the camera never swings to an extreme angle for
 *                 one stray robot". The aim height is pinned at 0.45 m.
 *   The lens      sized to hold EVERY player and the ball, with a 1.45 border
 *                 so nobody is clipped to the edge of frame, clamped to
 *                 38°–52°. Vertical fov, with the horizontal spread divided
 *                 by the aspect — the frame is far wider than it is tall, and
 *                 sizing vertically off horizontal spread zooms way out.
 *   The smoothing a first-order lag, 0.06 per frame on the aim and 0.05 on
 *                 the lens at their 50 fps — 0.32 s and 0.39 s. "A camera
 *                 that snaps looks like a bug, and one that lags looks like a
 *                 camera operator."
 *
 * This function is the pure half: the target and the lens the operator is
 * easing TOWARDS. The easing itself carries state from frame to frame and so
 * belongs to the caller, which is also the only place that knows how long a
 * frame actually took.
 *
 * Their §2 asked for cuts rather than drift, because their encoder is CBR and
 * a continuous move costs bitrate on every pixel of every frame. We put the
 * trade to them in REPLY-9 §3 and they said yes. That is the only reason the
 * one shot in the match cut-list is allowed to move at all.
 */
export const GANTRY_AIM_LAG_S = 0.32;    // football.py: 0.06 per frame at 50 fps
export const GANTRY_FOV_LAG_S = 0.39;    // football.py: 0.05 per frame at 50 fps

export function framePlay(base, { players = [], ball = null } = {}, p = {}) {
  const pos = base?.pos || [0, 8.7, -10.6];
  const lo = p.vfov_min_deg ?? 38, hi = p.vfov_max_deg ?? 52;
  const aspect = p.aspect ?? (16 / 9);
  const border = p.border ?? 1.45;
  const bias = p.bias ?? 0.45;
  const aimY = p.aim_height_m ?? 0.45;
  const pts = players.length ? players : (ball ? [ball] : []);
  if (!pts.length) return null;

  // The target: every standing player plus the ball twice, averaged.
  const weighted = ball ? [...pts, ball, ball] : pts;
  let ax = 0, az = 0;
  for (const q of weighted) { ax += q[0]; az += q[2]; }
  const aim = [(ax / weighted.length) * bias, aimY, az / weighted.length];

  // The camera basis at that aim, from a position that never moves.
  const v = [aim[0] - pos[0], aim[1] - pos[1], aim[2] - pos[2]];
  const dist = Math.hypot(v[0], v[1], v[2]) || 1e-9;
  const fwd = [v[0] / dist, v[1] / dist, v[2] / dist];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const right = cross(fwd, [0, 1, 0]);
  const rn = Math.hypot(...right) || 1e-9;
  for (let i = 0; i < 3; i++) right[i] /= rn;
  const up = cross(right, fwd);

  // The lens: the widest angle any player or the ball subtends, plus a border.
  let need = 0;
  for (const q of (ball ? [...pts, ball] : pts)) {
    const off = [q[0] - pos[0], q[1] - pos[1], q[2] - pos[2]];
    const fz = off[0] * fwd[0] + off[1] * fwd[1] + off[2] * fwd[2] || 1e-9;
    const av = Math.abs(off[0] * up[0] + off[1] * up[1] + off[2] * up[2]) / fz;
    const ah = Math.abs(off[0] * right[0] + off[1] * right[1] + off[2] * right[2]) / fz / aspect;
    need = Math.max(need, av, ah);
  }
  const want = Math.min(hi, Math.max(lo, (Math.atan(need) * 360) / Math.PI * border));
  return { aim, fov: +want.toFixed(3) };
}

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
 *
 * `named` lets a caller offer cameras this module does not own — the venue's
 * own authored positions. A cut-list of static shots is the only way to cut
 * without drifting, and every static shot in the stadium is authored in
 * `venue.json` rather than written as a function of time here. Built-in
 * cameras still win on a name they share, so `GANTRY` and `PITCHSIDE` mean in
 * a track file what they mean everywhere else.
 */
export function createTrack(doc, { fetchJson, named = null } = {}) {
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
      if (s.camera !== 'track' && !CAMERAS[s.camera] && !named?.(s.camera)) {
        throw new Error(`segment ${s.index}: unknown camera "${s.camera}" — one of ${Object.keys(CAMERAS).join(', ')}, track`);
      }
    }
    return api;
  }

  // `loop: true` wraps the frame back to the start of the cut-list instead of
  // running off the end. An ambient feed runs for days; without this it would
  // hold the last framing for ever, which is a photograph, not a broadcast.
  const loop = doc.loop === true;
  const span = segments.length ? segments[segments.length - 1].to : 0;

  function segmentAt(frame) {
    for (const s of segments) if (frame >= s.from && frame < s.to) return s;
    return null;
  }

  /** The camera for an absolute frame, or null past the end of a non-looping track. */
  function at(absolute) {
    // Wrap first, so every named camera's own clock restarts with the cut-list
    // and a looped feed repeats exactly rather than drifting.
    const frame = loop && span > 0 ? ((absolute % span) + span) % span : absolute;
    const s = segmentAt(frame);
    if (!s) return null;
    if (s.explicit) {
      const row = s.explicit[Math.min(s.explicit.length - 1, frame - s.from)];
      if (!row) return null;
      const [pos, lookAt, fov] = row;
      return { pos, lookAt, fov: fov ?? 50, segment: s.index, camera: 'track' };
    }
    // Named-camera segments run on their own clock from the segment's start,
    // so a cut to HELI always begins at the same point in the orbit. An
    // authored camera has no clock at all, which is the point of it.
    const c = CAMERAS[s.camera] ? CAMERAS[s.camera]((frame - s.from) / fps, s.seed, s.params) : named?.(s.camera);
    // resolve() proved every name, so this cannot be null — but it is read
    // fifty times a second on a live feed, and a throw here would take the
    // picture down rather than lose a shot.
    if (!c) return null;
    // `seed`, `t` and `params` ride along so a caller can ask the same shot a
    // second question — the live director re-specs a STANDS segment onto a
    // terrace that has somebody sitting in it, which it cannot do from a
    // position and a lookAt. They change nothing for a caller that ignores
    // them: `aim()` reads pos, lookAt, fov and roll.
    return { ...c, fov: c.fov ?? 50, segment: s.index, camera: s.camera,
             seed: s.seed, t: (frame - s.from) / fps, params: s.params };
  }

  const api = { at, resolve, fps, loop, get segments() { return segments; },
                get lastFrame() { return span; } };
  return api;
}
