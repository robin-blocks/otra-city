# otra.city → RFL: making the match look like television, and the exporter half

2026-09-24. We audited `/broadcast` against real football footage and against
your own offline render of m51. The biggest differences:

- **No shadows.** Your render has them. Ours had none.
- **No anti-aliasing.** Ours had none at all.
- **One light on everything.** The match was lit by a fixed sun while the
  stadium is floodlit.
- **Flat surfaces.** In the bundle everything except the turf is a single
  colour.

We have fixed the first three on our side, as described below. Nothing
changes in how you capture. The fourth needs your exporter, and we're asking
for six changes, in order of importance.

## 1. What changes on the page (build `2026-09-24a`)

- **The canvas is still exactly 1280 × 720.** `frame()`, `pixels()`,
  `cleanOutput()`, the scorebug, LIVE and the stadium screen are all unchanged.
- The frame is now composed offscreen at 2× and finished in one pass. That
  pass downsamples (the anti-aliasing) and adds depth of field on long lenses,
  a camera's sharpening and gentle vignetting. Sensor grain is off by
  default, because noise that changes every frame costs your constant-bitrate
  encoder bits. `?grain=1` turns it on, seeded from the frame number so
  captures still repeat exactly.
- **Robots and the ball now cast soft shadows from the four floodlight masts.**
  The pitch colours are untouched, only darkened where a shadow falls.
- **New camera, `?camera=iso`:** a long lens at the touchline, held on the
  player nearest the ball, with the stand thrown out of focus behind. Floating
  name plates are hidden on this shot. It is available to camera track files
  now. We have not added it to the live cut-list yet; see §3.
- **Cost:** on our M-series test machine, 3.8 ms per frame against 1.8 ms
  before, well inside the 20 ms a 50 fps frame allows. **We have not measured
  your capture machine.** Please watch `state().pace` for the first hour after
  the deploy. If it drops below 1.0 where it was at 1.0 before, these
  parameters step it down:

  ```
  ?ss=1.5        supersample 1.5× instead of 2× (about half the extra cost)
  ?shadows=0     no pitch shadows
  ?look=0        the page exactly as it was before
  ```

  `state().look` reports what is on.

## 2. Six exporter changes (`gauntlet/volumetric.py`)

**R4, first: decimate the robot and ball meshes.** The G1 parts come straight
from their STL files: about 510k triangles per robot, and one pelvis part alone
is 156k. The ball is 197k (`volumetric_ball.py`, 128 segments per cube face).
At broadcast distance, 10–20k per robot looks the same. Going from 2.27 M
triangles to about 150k is what makes shadows and supersampling cheap for every
host, your own player included. Quadric decimation at export time, or a
shipped low-poly version alongside the full one, would both work.

**R1: stop averaging textures to their mean colour** (`volumetric.py:267-292`).
In your video the kit jerseys, the wall checker and all 26 hoardings carry
their artwork. In the bundle each one is a single flat colour, so the
hoardings show as plain dark violet. This needs UVs or your `tex.proj` 0.4
proposal, so it waits on 4DGSX agreeing the spec. We have asked them to, in the
same round as this letter.

**R2: export material properties.** `mat_specular`, `shininess`, `reflectance`
and `emission` are never read. For example, your hoardings have emission 0.25
in the video and none in the bundle. This also waits on the same spec round.

**R3: keep hard edges on the robot meshes.** Normals are averaged across every
shared vertex (`volumetric.py:225-238`). Splitting vertices where the angle
between faces exceeds about 35° would make the panels read as machined parts
rather than soft shapes.

**R5: record at 50 Hz, or at least the ball.** The broadcast runs at 50 fps
(`TV_FPS`), but the track is recorded at 25 Hz (`football.py:216`), so every
second frame is a linear blend. The ball is where this shows most. Recording
the ball's body at 50 Hz costs very little data.

**R6: export your light setup** (`football.py:604-649`): the overhead
directional light, the light that follows the camera, and the gradient sky.
4DGSX needs a field for it first, and we have asked for one. With it, every
player would light the match the way your video does.

## 3. On the director, for your view

Real coverage cuts from the wide to a tight camera at stoppages (restarts,
goal kicks, fouls) and shows goal replays from behind the goal. `hud.clock`
already marks those dead-ball moments (`play_end_t` / `restart_t`), so a cut
there never interrupts play.

We would like to put the iso into the match cut-list, on dead balls only, and
never while the ball is live. §2 of your earlier brief asked for cuts rather
than drift, and this would be cuts. Is that acceptable? We won't change the
live director until you say yes.

## 4. Separate from the stadium: your own video encode

`render.py:18-26` encodes at CRF 23 with `veryfast`, which comes out at about
1.36 Mb/s for 720p50. That is low for sport and shows as smearing on the turf
whenever the camera pans. CRF 18–20 with `medium` would be a clear improvement
for your uploads. It doesn't affect the stadium at all.
