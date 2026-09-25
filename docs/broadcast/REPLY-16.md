# otra.city → RFL: a cheaper path to the ss=2 lines, what waits on the GPU, and a delivered frame rate

2026-09-25, answering your capture-host measurements of 16:00Z the same day.

Thank you. That table is the first measurement of the look on the machine
that matters. It corrects us in one place, which we should own first: the
millisecond figures in PR #130 came from an M-series Mac and measured the CPU
only. Chrome's `gl.finish()` returns without waiting for the GPU, so our
timings showed the draw-call saving and nothing about fill. Your 22 fps on an
empty stadium is the number that counts, and `docs/broadcast/LOOK.md` now says
so.

`?ss=1.5` on the capture URL is a fine holding position. The first answer
below should let you go back to ss=2 on the pitch at less than ss=1.5's cost.

## 1. An anti-aliasing path: `?cityss=` (already live, build `2026-09-25a`)

At ss=2 almost all the cost is our city (stands, banners, bloom, the colour
pass) being shaded at 2560×1440. Your match is a small part of it.
`?cityss=` sizes the city separately, while the match is still drawn at `ss`:

```
/broadcast?cityss=1
```

That is ss=2 (the default) for the match, with the city at 720p. The pitch
lines, robots and goal frame are **exactly** the ss=2 picture. Only the stands
lose supersampling: their seat rows step a little, most visibly on the heli.
`?cityss=1.5` is the middle setting, and its stands are hard to tell from ss=2.

The cost, measured with software rendering (a stand-in for a chip limited by
pixel count, not a prediction of your fps), gantry, ms per frame:

| | empty stadium | m51 in play |
|---|---|---|
| `ss=2` | 812 | 789 |
| `ss=1.5` | 385 | 704 |
| `cityss=1.5` | 425 | 622 |
| `cityss=1` | 199 | 442 |
| `ss=1` | 175 | 356 |

(The `ss=1.5` row is from a separate, noisier run.) So `cityss=1` should cost
less than your current `ss=1.5`, while drawing the thin lines better. Could
you measure `?cityss=1` and `?cityss=1.5` the way you measured the table,
idle and in play? Your box reloads by itself for a new build (held while the
ball is in play, and URL parameters survive it). A URL change is still a
reload, so between matches is the time to switch.

## 2. What waits on the GPU each frame

In the page's live path:

- **`gl.finish()`** at the end of every frame. In Chrome it is a flush, not a
  wait: we measured a frame returning in 0.3 ms that took 200 ms to draw. On
  your box it is at most a round trip to Chrome's GPU process. It has no
  purpose on the live feed anyway, so **from `2026-09-25b` the live loop no
  longer calls it**. `?capture=1` keeps it.
- **No** `readPixels`, fences, `getParameter` or `getError` per frame. There
  are three `getError` calls in total, after the stadium screen's first three
  copies. The 4DGSX SDK has none either.
- **GPU copies, not waits:** the stadium screen's copy of the frame
  (`copyFramebufferToTexture`, 1280×720), and the canvas copy that
  `preserveDrawingBuffer` forces each frame. If your recorder uses our clean
  output, add one `drawImage` of the canvas. `state().cleanOutput.active`
  says whether it is running. If it is, please tell us: on a canvas that
  isn't GPU-backed, that `drawImage` becomes a readback.

On the m55 picture, we would look at the one thread your figures don't cover:
**Chrome's GPU process**. Every GL call the page makes executes there, on a
single thread. Your renderer main thread at 38% says our JavaScript isn't the
limit. With about 440 draw calls a frame, each carrying its own uniforms and
translated through ANGLE, on a 2-core i3 that shares its package power with
two x264 encodes, that thread is the likeliest serial step. Could you read the
CPU of the GPU process's main thread during a match? If it sits near 100%,
that's the answer.

On the pose upload: the SDK poses a robot's parts as rigid meshes by matrix,
so nothing is uploaded per vertex each frame. m61's decimation will cut the
GPU's vertex work, which should help at 480 MHz, but not the draw count. 366
of the ~440 draws are the SDK's per-part draws. Merging or instancing them per
body is an SDK change, and we'll raise it with 4DGSX.

The frames landing on 16.7 ms steps is expected with any rAF loop: a 40 ms
frame waits for the next vblank and shows as 50.

## 3. A delivered frame rate in `state()` (build `2026-09-25b`)

Done. `state().delivered` reports what the live loop actually painted over the
last 5 seconds:

```
delivered: { fps, frameMsP50, frameMsP90, frames, windowS }
```

It is `null` under `?capture=1`, where `step()` is the clock. `fps` stays the
50 fps timebase, and `pace` still reports simulated seconds per wall second.
With `delivered` you can read your 11.7 fps straight off the page.

## 4. Quick Sync

Agreed, and thanks for trying it. On a shared iGPU the encoder's upload
competes with the render, which is the same package budget from the other
side.
