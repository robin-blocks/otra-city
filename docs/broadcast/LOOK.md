# /broadcast — the broadcast camera (builds `2026-09-24a`, `2026-09-24b`)

What happens to a frame between the scene and the television picture.
Implementation: `public/js/broadcast-look.js`, `public/js/broadcast-turf.js`,
`public/js/broadcast-night.js`, the opt-in `target` path in
`public/js/after-tonemap.js`, and `draw()` in `public/broadcast.html`.
Background: the graphics audit of 24 September 2026, the reference frames
Robin supplied (gantry, pitchside, behind-goal, floodlit grounds), and the
letters it produced (`docs/4dgsx/GRAPHICS.md`, `docs/broadcast/REPLY-14.md`).

## The pipeline

```
composer: city → RenderPass → bloom → OutputPass (ACES 1.15, sRGB)
   │  finished picture + scene depth, one quad
   ▼
frame target (2560×1440, half float, display values, depth)
   ← 4DGSX stage, our boards, the pitch-shadow receiver   (not tone mapped)
   ▼
finish pass → canvas 1280×720
   downsample · depth of field · sharpen · vignette · (grain, opt-in)
   ▼
scorebug · league table · LIVE   (unchanged, drawn after)
```

The stage is still display-referred, drawn after ACES exactly as since #97.
The frame target is flagged `isXRRenderTarget` so three encodes stock
materials (the SDK's label sprites, our boards) as it would for the canvas.
Without the flag they render a gamma too dark. The header of
`broadcast-look.js` explains why it is safe in r185.

## Parameters

| Parameter | Default | Effect |
|---|---|---|
| `?look=0` | on | the page exactly as before (canvas-direct) |
| `?ss=1\|1.5\|2` | 2 | supersampling factor; this is the anti-aliasing |
| `?shadows=0` | on | pitch shadows |
| `?dof=0` | on | depth of field (only a long lens produces visible blur) |
| `?lens=0` | on | sharpening and vignette |
| `?grain=1` | off | seeded sensor grain (costs a CBR encoder bits every frame) |
| `?turf=0` | on | keep RFL's own pitch tile instead of the generated turf |
| `?night=0` | on | no sky dome, mast glare, haze or flood spill (also off with `?timeofday=`) |

**No GPU, no supersampling.** On a software rasteriser (`quality.js` tier 0:
SwiftShader, llvmpipe) `ss` defaults to 1 and shadows to off, because every
pixel is paid for on the CPU. On CI's SwiftShader the full look doubled the
idle-standings harness (91 s → 193 s) and took the pre-roll harness past its
450 s budget. Explicit `?ss=` / `?shadows=` still win, and `state().look.auto`
says when the rule applied. The capture host has a GPU and gets the full look.
Local gates with `--gpu`, or with explicit parameters, exercise `ss=2`.

`state().look` reports each part, the shadow rig (`floodlights` or `sun`),
caster counts, focus distance and the maximum circle of confusion.

## Shadows

- **Casters.** Each opaque part of each moving 4DGSX body casts as an
  ellipsoid inscribed in that part's bounds. The bounds come from the part's
  own index list, because the SDK shares one vertex buffer across every part
  and `computeBoundingBox` would measure the whole bundle. All ellipsoids go
  in one instanced draw per light. The static world casts with its real
  geometry. On m51 that is 180 stand-ins and 56 static meshes.
- **Lights.** The venue's SpotLights (the four masts), keeping each mast's
  bearing but cast from 55° elevation. The modelled masts sit about 17 m up at
  about 32°, which threw two-metre shadows. Each mast darkens by 0.84,
  compounding where shadows overlap. With no floodlights present, the SDK's
  sun is used instead, at 0.611, derived from their shader.
- **Receiver.** A quad at match z = 0.012 (above the markings), renderOrder
  9000 (after the markings, before the SDK labels at 10000), multiplying the
  turf. Depth-tested, so a robot in front of its own shadow still occludes it.

## Turf (`broadcast-turf.js`, build `2026-09-24b`)

RFL's pitch tile (`textures/pitchgrass.png`, 512² over 4 m, from
`_stripe_texture` in football.py) carries its "noise" as 32-pixel squares,
each a random shade: a 25 cm chequerboard in every shot. That was the
pixelated pitch. Once per mounted stage, the pitch material's `uTex` is
swapped for a 2048² tile generated on the GPU:
- **Stripes:** the SDK's own `band()`, fed from the material's own `uG1`,
  `uG2` and `uMow`, so colours, phase, period and seam match the publisher's.
- **Grain:** zero-mean, tile-periodic noise at four scales, aligned with the
  mowing direction. Blades are 4 mm × 3 cm, streaks 2.5 × 35 cm, clumps
  25–50 cm with a slight yellow/blue drift.

The tile is written raw (NoColorSpace), as their player samples the original,
with anisotropy 8, the SDK's own value (16 cost about a millisecond more on a
frame-filling pitch). A tile that isn't a whole number of stripe periods is left
alone and reported in `state().look.turf.skipped`. **Trap:** the SDK holds
`uG1`/`uG2` as `THREE.Color`. `Vector3.copy(Color)` reads `.x` and gives a
black pitch, so copy the components instead.

## Night (`broadcast-night.js`, build `2026-09-24b`)

Robin's floodlit references showed that a bright, even pitch in a dark bowl is
correct. What was missing was everything around it:
- **Sky dome:** zenith `#03050d`, horizon `#142043`, plus a low violet
  light-pollution band. Fog and background are set to the horizon colour so
  the city fades into it. The dome sits on the far plane.
- **Masts:** a bright core sprite (gain 6, which bloom spreads) and a 9 m
  halo per floodlight, plus an additive haze cone toward the pitch (0.1,
  brightest at the lamp and along its axis). **Trap:** GLTF spot targets sit
  one metre down the beam, so they give a direction and never a length.
- **Spill:** floodlight cones widened from 0.8 to 1.15 rad, penumbra 0.75, so
  the stands and concourse are lit. Only uniforms change; no light is added,
  so nothing recompiles.
- **Lens ghosts** (in the finish pass, under `?lens`): four tinted discs and
  a ring on the line from each visible lamp through the centre of frame.
  Visibility is tested against the frame's depth in metres with 2 m of
  tolerance, because the lamp's own housing sits in front of the light.

## Lens

- **Depth of field.** Thin-lens circle of confusion from the real field of view.
  By default the sensor is 2/3-inch broadcast (5.39 mm tall) at f/2.8, so the
  gantry gets well under a pixel of blur. A shot may carry
  `lens: { sensor_mm, fstop }`; the iso uses full-frame 24 mm at f/2.8. The
  circle of confusion is capped at 12 output pixels. A sample counts only if
  its own circle reaches back to the pixel, so a sharp subject does not bleed
  into the blurred background.
- **Sharpen** 0.22 against the four neighbouring output pixels.
- **Vignette** 0.11.
- **Grain**, opt-in (`?grain=1`): 1.6/255, weighted to the mid-tones and hashed
  from (pixel, frame). Off by default because noise that changes every frame
  is what a CBR stream encoder spends bits on.

## The iso (`?camera=iso`)

A long lens at the near touchline (`z = -8.4`, 2.2 m up, sliding along its rail
at 0.35 × the subject's x). It frames the player nearest the ball, with 0.8 m of
hysteresis so it doesn't flick between players, and sizes the lens so 1.9 m of
height fills the frame. The pure framing is `frameIso()` in
`broadcast-cameras.js`. The easing lives in the page:
- aim 0.22 s
- rail 0.8 s
- zoom 0.6 s

A seek, a rewind, a first subject or a jump of more than 2.5 m is a cut.
Floating name plates and bubbles (SDK sprites at renderOrder 10000) are hidden
on this shot; the 4DGSX attribution (10001) stays.

**On dead balls, in the live director** (build `2026-09-24b`, agreed by RFL on
24 September in reply to REPLY-14 §3). `broadcast-programme.js` cuts to the iso
only inside the latest buzzer's `play_end_t` → `restart_t − 2 s`
(`ISO_WIDE_LEAD_S`), and only when that dead ball lasts at least 4 s
(`ISO_MIN_WINDOW_S`). It is never used while the ball is live. For the last 2 s
it is on the tracking wide, so play restarts on the wide. Head-cam replays,
celebrations and the GOAL board still outrank it, and full time has no
`restart_t`, so post-match is unchanged.

The director's iso is pure: `frameIso` over the sampled bodies at 50 Hz from
the window's start (capped at 8 s), eased with the iso's lags. Every client,
late joiners included, computes the same shot. `state().director` reports
`priority: 'dead-ball'` and `iso: 'bounded-history' | 'unsmoothed' |
'wide-before-restart'`. The page's own stateful `isoShot()` serves only an
explicit `?camera=iso`.

## Cost

Measured on an Apple M-series machine with GPU, m51, gantry, 100 single-frame
steps each:

| Configuration | ms / frame |
|---|---|
| `look=0` | 1.78 |
| default (ss 2, shadows, lens) | 3.81 |
| `ss=1.5` | 2.79 |
| `shadows=0` | 2.03 |
| build `b` (turf and night added), gantry: `look=0` / `night=0&turf=0` / default | 1.68 / 2.65 / 2.37 |
| build `b`, heli: `look=0` / `night=0&turf=0` / default | 1.58 / 3.21 / 3.01 |

Turf and night are within run-to-run noise.

**Not measured on RFL's capture machine.** Watch `state().pace` after deploy.

## Upstream: 4DGSX's answer (not yet in our pinned SDK)

On 24 September, 4DGSX answered `docs/4dgsx/GRAPHICS.md` and shipped the
following in the **unpinned** `https://4dgsx.com/sdk/v1/three.js`. We vendor a
reviewed copy (`public/vendor/4dgsx/broadcast-factory.js`), so **none of it is
live here until we re-pin**:
- `stage.setShadow({ map, matrix, strength, bias, bodies })`. It applies our
  depth map inside their lighting, before the display curve. On re-pin it
  replaces our receiver quad. `bodies` stays false for our stand-in map,
  which would blotch the real meshes.
- `stage.setLighting({ sun, sunColor, sunIntensity, sky, ground, exposure, output })`.
  `output: 'linear'` is an exact sRGB decode, meant for our offscreen pass.
- A view-dependent highlight (exponent 32, Fresnel; the turf keeps a fixed
  sheen), bubbles that clear name plates, and Catmull-Rom positions.
- Pitch tiles are no longer sRGB-tagged. Our re-tag becomes a no-op; our
  generated turf is untagged either way.

Re-pinning changes the look for every page, so it's its own build with its own
evidence: provenance, `broadcast-sdk-check`, and the pitch-colour and shadow
comparisons.

## Open decisions (Robin)

- **Pitch green.** We match 4DGSX's live player. RFL's video and the
  reference footage are about 22% brighter. With the finish pass in place, a
  grade would be one uniform. Not ruled on.
- **Night atmosphere:** built in `2026-09-24b` (see above). Not yet done:
  roof-underside lights in the stands and rain.
