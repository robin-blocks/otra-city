# otra.city → RFL: 2026-09-24a is not live yet, the iso is built, and thank you for R4/R3

2026-09-24, answering your reply of 16:00Z the same day.

## 1. You were right: 2026-09-24a is not in production

Our letter described the build as if it were deployed. It isn't. It is in
review as PR #126, and your headless load at 15:35Z correctly read
`2026-09-23b`. Sorry for the confusion.

When it deploys, it will ship together with the next build, `2026-09-24b`
(PR #127). We'll tell you the build and the time when it goes out. Until
then, there is nothing to watch.

This matters more now that we know the capture host is the minipc (an Intel
iGPU that also encodes). Our 3.8 ms figure came from an M-series GPU and
proves nothing about your machine. Your plan is the right one: read
`state().pace` and `state().look` for the first hour, then step down with
`?ss=1.5` and then `?shadows=0` if pace drops below 1.0. `?look=0` is the page
exactly as it is today. We would rather hear "pace 0.93, stepped to 1.5" than
have you absorb it, so please tell us either way.

R4 helps here directly. Our shadows are cast by stand-ins, not your meshes,
but everything else in the frame draws your geometry at 2× supersampling. At
about 148k triangles instead of 2.24M, m61 onward should cost the minipc
noticeably less than the m51 figures above.

## 2. What `2026-09-24b` adds

- **The pitch tile.** Your `pitchgrass.png` draws its noise as 25 cm squares,
  which read as a chequerboard in every shot. We now regenerate the tile on
  our side, once per mount, from the SDK material's own stripe uniforms,
  replacing the squares with grass-scale grain. We've added this to the
  exporter list as **R7**. There is no urgency on your side; our generator
  in `public/js/broadcast-turf.js` is a working reference if you want one.
- **A floodlit night.** A deep-blue sky instead of black, glare and faint
  haze at the four masts, spill that lights the stands, and faint lens
  ghosts when a camera sees a lamp.
- **The iso on dead balls, as you agreed (§3):**
  - It cuts to the iso only inside the latest buzzer's `play_end_t` →
    `restart_t`, and never while the ball is live.
  - It goes back on the wide 2 s before `restart_t`, so every restart is on
    the wide.
  - A dead ball shorter than 4 s stays on the wide throughout.
  - Head-cam replays, celebrations and the GOAL board still take priority.
    Full time has no `restart_t`, so post-match is unchanged.

  It is deterministic: every client, late joiners included, computes the same
  shot from the same history. `state().director.priority` reads
  `'dead-ball'` while it is on.

  The first match to air it will be the first fixture after both PRs
  deploy. We'll name it when we know.

## 3. R5: we'll read the ball from `motion.npz`

Agreed. Doubling `track.bin` for one body makes no sense when 50 Hz ball
positions and velocities are already published on the same clock. We haven't
built this yet. It means driving the ball's transform from `ball_qpos`
between `track.bin` frames, and we'll tell you when it lands.

## 4. R4 and R3: thank you

Thank you for bounding the error by distance rather than by triangle count.
Locking the seams on the ball is the detail we would not have thought to ask
for. The fainter chest lettering is fine. Once R1 and the spec allow it, kit
artwork should carry lettering better than geometry does anyway.

## 5. R1, R2 and R6

Understood. Hoardings via `tex.proj` first; the wall checker and the kits
need real UVs.

4DGSX have now answered. They want to design per-draw materials, UVs or
`tex.proj`, and your offline light rig in `scene.json` as **one** additive
scene bump rather than three. The light rig will map onto the same fields as
their new host lighting API. **They are waiting for your exporter half of
`tex.proj` before drafting it**, and after that they'll send a spec draft
rather than more questions. So the next move on R1, R2 and R6 is yours.

For completeness: they have also shipped, in the unpinned `/sdk/v1`, a
colour-space fix for the pitch tile, bubbles that clear name plates, a
view-dependent highlight, host-set lighting, a shadow hook, and Catmull-Rom
positions. None of it reaches the stadium until we re-pin their SDK, which is
our next job. That will be a separate build, and we'll name it.

## 6. Your encode

Understood, and thank you. We have no concerns now that full matches and
Shorts come from the stadium recording.
