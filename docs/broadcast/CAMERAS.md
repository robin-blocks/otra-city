# /broadcast — cameras, crowd, and the camera track file

Reference for anyone pointing a capture harness at `otra.city/broadcast`.
Implementation: `public/js/broadcast-cameras.js`, `public/js/crowd.js`.
Gate: `scripts/broadcast-check.mjs`.

## Coordinates

**Everything is venue-local metres.** The origin is the pitch centre spot,
`+x` runs toward the east goal, `+z` toward the north stand (the big-screen
end), `y` is up. This is the same frame RFL's own geometry table uses, so a
track file authored against their arena needs no translation.

The page converts to world space exactly once, when it points the camera. The
stadium's placement in the city (`x = 100`) never appears in a track file.

## Parameters

| parameter | meaning |
|---|---|
| `camera=<name>` | one named camera for the whole capture (default `gantry`) |
| `camtrack=<https url>` | a camera track file; overrides `camera` |
| `bundle=<https url>` | a 4DGSX bundle to play on the pitch; absent means an empty pitch |
| `crowd=0..1` | how full the stands are; `0` (default) is empty |
| `seed=<int>` | selects one of many equally valid versions of the same shot and crowd |
| `t0=<seconds>` | warm the scene to this point before frame 0 |
| `timeofday=0..24` | shift the lighting; see the caveat below |
| `street=0` | drop the city's plots (they load by default) |
| `venue=<id>` | which venue to film (default `stadium`) |
| `live=1` \| `live=<cap>` | **not for capture** — a realtime stream with live visitors; `step()` throws |

Anything the page cannot honour is reported in `state().unimplemented` and
shown on the page rather than silently ignored.

## Named cameras

All are pure functions of `(frame, seed, params)` — no state carries between
frames, so seeking to a frame gives the same view as stepping to it.

### `gantry`
The contracted main position: 10.6 m back from the centre spot, 8.7 m up,
looking north. Static. Authored in `venue.json`, and the gate re-verifies on
every run that nothing otra.city builds obstructs the marked 14 × 9 area from
it. Params: `x`, `back_m`, `height_m`, `vfov_deg`.

### `heli`
Orbiting aircraft. Params: `radius_m` (60), `height_m` (45), `period_s` (90 —
negative orbits the other way), `phase` (0), `turbulence` (1), `bank` (1),
`vfov_deg` (42).

Three things make it read as an aircraft rather than a crane, and they are
worth knowing because they are what `turbulence` scales:

- **Aim wander is angular, not positional.** At 60 m, sliding the body a metre
  barely moves the frame; turning the aim a quarter of a degree moves it eight
  pixels. Wander is specified in radians and converted by distance, so it reads
  the same from 20 m or 200 m.
- **Two bands.** Slow airframe wander around 0.3 Hz is the wind; a small
  5–7 Hz component is the machine the camera is bolted to.
- **Roll.** The camera banks into the turn, and the angle is physics rather
  than taste: a coordinated turn at `v² / rg` gives about **1.7°** at the
  default radius and period. The operator's own horizon wanders on top, so the
  measured roll runs about 1.05°–2.17°. `bank: 0` levels it.

The default look is a **gyro-stabilised aerial** — smooth, slow bank, gentle
drift — because that is what a broadcast helicopter actually delivers. Raise
`turbulence` for a rougher, more hand-held mount.

### `stands`
A slow push toward a cluster of spectators. Params: `side` (0 = west, 1 = east,
2 = north, 3 = south; omitted means the seed picks), `from_m` (16), `period_s`
(40), `height_m` (3.4), `vfov_deg` (24).

### `pitchside`
Low, near a corner, with the drift of a shouldered camera. Params: `x`, `z`,
`height_m` (1.35), `aim_x`, `aim_z`, `vfov_deg` (38).

### `track`
Camera state supplied per frame by the track file. See below.

Every other name in `venue.json` (`approach`, `concourse`, `aerial`,
`stand_high`, `scoreboard`, …) also works as a static view.

## Camera track file

A worked example ships at `/broadcast/camtrack-example.json` and is used as
the CI fixture, so it cannot drift from what the page actually consumes.

```json
{ "fps": 50,
  "segments": [
    { "frames": [0, 750],     "camera": "HELI",   "seed": 7, "params": { "radius_m": 58, "height_m": 40, "period_s": 90 } },
    { "frames": [750, 1250],  "camera": "STANDS", "seed": 3, "params": { "side": 2, "vfov_deg": 26 } },
    { "frames": [1250, 1500], "camera": "TRACK",  "explicit": [ [[x,y,z], [x,y,z], vfov], … ] },
    { "frames": [1500, 1750], "camera": "GANTRY" }
  ] }
```

- `frames` is `[start, end)` in absolute frames, end exclusive.
- `explicit` is either an array of per-frame `[pos_xyz, lookat_xyz, vfov_deg]`
  or an **https URL** returning one. Its frames are indexed from the **start of
  its own segment**, so a tracking shot can be re-cut to a different point in
  the programme without re-exporting it.
- Named-camera segments also run on their own clock from the segment's start,
  so a cut to `HELI` always begins at the same point in the orbit.
- The whole file is validated **before filming starts** — an unknown camera
  name or too few explicit frames fails at load, not at frame 90,000.
- Past the last segment the final framing is held rather than snapping
  somewhere arbitrary.

## Crowd

`crowd=0..1` fills that fraction of the venue's declared seats (600 in the
stadium), chosen by a seeded partial shuffle so density 0.3 and 0.6 agree on
the first 30% rather than reshuffling the stand.

Each fan's seat, clothing, resting posture, idle rate and stand-up schedule
come from the seed. Poses are a pure function of simulated time, so the crowd
seeks correctly and two processes agree. Fans breathe, shift, lean and stand;
roughly one in eight is on its feet at any moment.

It is instanced — ten `InstancedMesh` draws for the whole stand, not ten per
fan. Measured cost of 400 fans from the gantry: about 10 draw calls and
50k triangles on top of the empty stadium.

Match-event reactions are not implemented.

## `timeofday` — read this before using it

It is a **lighting shift, not an art pass.** otra.city is authored for night:
the emissive signage, the floodlights and the bloom are the look of the place.
Raising `timeofday` lifts the ambient, brightens the sky, pushes fog back and
pulls exposure down, which reads as **dusk or an overcast afternoon** rather
than bright daylight. The neon stays lit, because it is painted in.

If a genuine daylight look matters, say so — it is a real art job on the city,
not a parameter.

## What is not built

- Match-event crowd reactions (§6, explicitly a later phase).
- Crowd audio of any kind — no audio at all is produced; the venue PA is
  stripped from the module config on this page.
- A tunnel or behind-goal camera.
