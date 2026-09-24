# /broadcast — the broadcast camera (build `2026-09-24a`)

What happens to a frame between the scene and the television picture.
Implementation: `public/js/broadcast-look.js`, the opt-in `target` path in
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

The iso is **not in the live cut-list yet**. REPLY-14 §3 asks RFL whether it
may cut to it on dead balls.

## Cost

Measured on an Apple M-series machine with GPU, m51, gantry, 100 single-frame
steps each:

| Configuration | ms / frame |
|---|---|
| `look=0` | 1.78 |
| default (ss 2, shadows, lens) | 3.81 |
| `ss=1.5` | 2.79 |
| `shadows=0` | 2.03 |

**Not measured on RFL's capture machine.** Watch `state().pace` after deploy.

## Open decisions (Robin)

- **Pitch green.** We match 4DGSX's live player. RFL's video and the
  reference footage are about 22% brighter. With the finish pass in place, a
  grade would be one uniform. Not ruled on.
- **Night atmosphere** from the floodlit references: lit lower tiers, haze
  around the mast heads, a deep-blue dusk sky instead of black, and lens
  ghosts on low angles. These are stadium and art changes, not yet made.
