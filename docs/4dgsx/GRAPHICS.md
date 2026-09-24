# otra.city → 4DGSX: making a match look like television

2026-09-24. For Splat. We audited `/broadcast` against broadcast football
footage and against RFL's own offline render of the same match (s3-m51). Most
of the gap was on our side, and we have shipped fixes for it (see "What we did"
below). The rest is in the stage shader and the spec, and it affects every
4DGSX host, not only us. Nothing here is urgent. The requests are in order of
how much each one changes the picture.

All references are to `site/lib/player/three/` at `a0bb4fa`. The shader text
there matches the build we pin, character for character.

---

## What we did on our side, so it isn't done twice

- **Shadows.** We draw them outside the stage. Each frame we build depth maps
  from our floodlight masts using stand-ins for your meshes: one ellipsoid per
  opaque part of each moving body, sized from that part's own index list. The
  static world uses its real geometry. A thin receiver quad at match z = 0.012
  then multiplies the turf. We never touch your shader or its colours. The
  daylight strength comes from your own lighting model:
  `(0.64 / 1.10)^0.9091 = 0.611` of lit.
- **Anti-aliasing and a lens.** We compose the whole frame, stage included,
  offscreen at 2× and finish it in one pass: downsample, depth of field on long
  lenses, sharpening, vignette and seeded grain. Your stage is still drawn
  display-referred and never goes through our tone mapping.

Both are in otra.city's `public/js/broadcast-look.js`, if you want a reference.

## 1. Shadows in the stage itself

`stage.ts:247-265` has no shadow term. Your sun is fixed and almost overhead,
and the pitch is small, so an orthographic depth map along `sun` never needs
refitting, costs one depth pass, and needs 12–16 PCF taps in the fragment
shader. Every host would get grounded players, including your own player.

If you'd rather hosts own shadows, a narrower change would still help: a
documented `uShadowMap` / `uShadowMatrix` / `uShadowStrength` hook in the
fragment shader, so a host's shadow darkens the turf *inside* your lighting
(before `pow 0.9091`) rather than multiplying afterwards as ours has to.

**Cost note.** A mounted RFL match is about 2.27 M triangles: roughly 510k per
G1 robot and 197k for the ball. A full-geometry shadow pass doubles that. This
is why we use stand-ins, and why we have asked RFL to decimate (see their letter).

## 2. Make the specular highlight follow the camera

`stage.ts:263`:

```glsl
float spec = pow(max(dot(reflect(-sun, n), vec3(0,0,1)), 0.0), 8.0) * 0.03;
```

This reflects the sun toward a fixed "up" vector rather than toward the
camera, so the highlight never moves as the shot pans. Painted metal only
reads as metal when its highlight moves. Suggested change: pass the camera
position in match space as a uniform and use the real view vector, raise the
exponent (about 32) and add a small Fresnel term. It costs almost nothing.

## 3. Material and UV fields in the spec

A draw carries `rgba`, `checker` and optionally `tex`, and nothing else. There
are no UVs in `geometry.bin`. We would like:

- **Optional per-draw `roughness`, `metalness` (or `specular`) and
  `emissive`.** Defaults would reproduce today's shading exactly.
- **Optional UVs, or agree RFL's `tex.proj` 0.4 proposal.** RFL has built it
  behind `RFL_4DGSX_SURFACE_TEX` (`volumetric.py:337-401`), but no player
  reads it yet. It is what gets kit artwork and readable hoardings into every
  host. RFL are sending the matching exporter half.

## 4. Let the host set the lighting

Today every stage is lit by `vec3(0.25, 0.15, 1.0)` at a fixed ratio of
ambient to direct light. Could the stage accept these, with today's values as
defaults?

- `sun` direction, colour and intensity
- sky and ground hemisphere colours
- exposure

Optionally, a **linear-output mode** (skip `pow(…, 0.9091)`) so a host can
tone-map the stage together with its own scene. Our stadium is floodlit at
night, and right now nothing we do can change how your match is lit. RFL also
want to export their offline light rig into `scene.json`, and this is the
field it would go in.

## 5. Smoother interpolation between frames

`bundle.ts:353-379` blends linearly between 25 Hz frames. At 50 fps output,
that visibly bends a fast ball's path at every recorded frame. A Catmull-Rom
(or Hermite) curve through the neighbouring frames removes that at almost no
cost. Positions only; rotations can stay nlerp.

## 6. Speech bubbles overlap name plates

A shout bubble is drawn over its player's name plate, and the name shows
faintly through it ("Abyss" under "I've got it" in m51). Stack the bubble
above the plate, or hide the plate while a bubble is up.

(On close shots we now hide both: television puts names in a lower third, not
over heads. We find your label sprites at `renderOrder === 10000`, and we
always leave your attribution mark at 10001 in place. If that ordering
changes, please tell us.)

## 7. Not yet sent: pitch texture colour space

The three.js stage loads `pitchgrass.png` with `SRGBColorSpace`
(`stage.ts:401-404`). Your own WebGL player uploads it as plain `gl.RGBA`, and
the shader is identical in both. So every three.js host draws the pitch
darker than `4dgsx.com/watch` unless it re-tags the texture, as we have done
since 14 September. Dropping the tag, or encoding inside the shader, would
fix it for everyone.

---

Happy to send patches for 2, 5 and 6. Each is only a few lines.
