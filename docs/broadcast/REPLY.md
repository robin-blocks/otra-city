# otra.city → RFL — re: Stadium broadcast handover

Reply to the handover of 2026-09-03. Written to be pasted into an issue as-is.

Every number below was measured on this branch on 2026-09-03, not estimated;
the command that produced each one is named. Where a decision is ours to make
and hasn't been made, it says so rather than implying agreement.

> **[ROBIN — decide before sending]** Three things in here are yours, not
> engineering's: whether otra.city takes this on at all (§6), the credit
> wording (§7), and the version-pinning commitment (§5.2). They are marked in
> place. Delete this block before pasting.

---

## 1. The short version

The stadium is built, it is live at `otra.city/stadium`, and it already mounts
4DGSX bundles through your SDK — that is what it was built for, in the venue
system that shipped on 2026-09-03. The brief reads as though it is commissioning
a stadium; most of what it commissions is on `main`.

So the answers below are mostly "yes, and here is the measurement", with one
real exception: **the crowd (§6) does not exist.** The stands are 600 seats of
empty geometry.

`/broadcast` now exists too — the bare page your §10 proposes as step one. It
is on this branch, not yet deployed.

## 2. Your four questions

**1 — Is the stadium interior built enough for a fit-out, or is this a fresh build?**

A fit-out, and a smaller one than you expect. The marked playing area is
**already exactly 14 × 9 m** — `PLAY_X, PLAY_Y = 7.0, 4.5` in the Blender
source. That is not luck: the deck was sized around your stage tile when the
stadium was built. On top of that, already present: four stands (6 rows, 600
seats) on all sides, four floodlight masts, a 9.6 × 5.4 m big screen, two dock
panels, a scoreboard, and 0.9 m advertising hoardings on all four sides.

What your §3 asks for that is **not** there:

- **Penalty areas, goal areas, penalty spots.** We have the halfway line, the
  centre circle (r = 1.8 m) and the perimeter of the marked area. Send us the
  exact marking geometry you render and we will lay it in.
- **The rebound walls.** Our hoardings sit at ±10.5 / ±8.0 m — 3.5 m outside
  the marked area. They are scenery, not the arena wall your ball bounces off.
  The real walls, the bevelled corners with push-panels, and the two open goal
  mouths are all new geometry.
- **Nothing else.** There is no roof, which is why nothing can cut into your
  frustum (see below).

**2 — Any objection to headless capture traffic?**

None technically: it is static assets on a CDN, and small. `venue.glb` is
1.3 MB and `far.glb` is 3.5 KB; a capture session's whole footprint is 33
requests, all at page load.

> **[ROBIN]** Commercially your call. Nothing here needs rate limits.

**3 — Splats in a voxel world, or the restyle from day one?**

> **[ROBIN — art direction]** The engineering note is that the A/B is cheap
> because it already works: `sdk.mount({ bundleUrl, autoplay: false })` runs
> today via `?bundle=`. Send a test bundle URL and we can look at both inside
> a day rather than argue about it.

**4 — What can the presence/multiplayer layer break?**

Nothing. Presence was never on this path — `presence.js` is imported by the
city client only, and neither the venue fixture nor `/broadcast` touches it.
A capture run has no socket, no peers and no live citizens by construction,
not by configuration. The seeded synthetic crowd you describe in §6 is the
only crowd that will ever appear in your footage.

Two neighbours were removed from the broadcast path for the same reason, and
both are worth you knowing about because they would each have been a slow,
confusing bug:

- **`perfguard.js`** steps rendering quality down when frame times slip. In a
  10-minute unattended capture that would change the pixels mid-film. It is
  not loaded by `/broadcast`.
- **The programme feed.** Your SDK's `schedule()` path polls
  `4dgsx.com/api/v1/programme/rfl` every 60 s on a wall-clock timer. That is
  both network-after-load and a clock we cannot control, so in ambient mode
  (no `bundle=`) we remove the match module outright rather than let it idle.
  Ambient mode is a genuinely empty, genuinely offline pitch.

## 3. `/broadcast` — what is on the branch now

The page your §10 asked for, at `otra.city/broadcast`, driving the real client
pipeline (world, venues, doors, anims, media). Nothing renders on its own: the
page draws one frame when `ready` resolves so a human sees something, and
after that only `step()` moves time.

```
window.rflBroadcast.ready              → resolves when the venue is at Tier 2
window.rflBroadcast.step(n)            → advance to absolute frame n (50 fps), draw,
                                         resolve after the GPU has finished the frame
window.rflBroadcast.frame()            → PNG data URL
window.rflBroadcast.pixels()           → raw RGBA (Uint8Array), for a harness that
                                         would rather not decode PNG
window.rflBroadcast.camera(name)       → select a named camera
window.rflBroadcast.state()            → frame, tier, dimensions, errors, and every
                                         parameter this build does NOT honour
```

Parameters: `venue`, `camera`, `bundle`, `t0`, `seed`, `street`. Bundle URLs
must be https — this is a public route, and a query parameter must never
become code.

`camtrack`, `crowd` and `timeofday` are **accepted and then reported as
unimplemented**, in `state().unimplemented` and visibly on the page. We would
rather you see that immediately than discover a week of footage with an empty
crowd because a parameter was silently ignored.

`step()` refuses to go backwards rather than silently doing something wrong —
time here has no inverse. Reload with `?t0=` to rewind.

### The determinism claim, measured

`node scripts/broadcast-check.mjs` — in CI on every change to the venue system:

```
contract
  PASS  ready resolves and the venue is loaded — tier 2
  PASS  frame is 1280x720 · pixel ratio locked to 1 · timebase 50 fps
sightline (§3)
  PASS  every corner of the 14 x 9 area is unobstructed — 5 rays clear
  PASS  every corner of the 14 x 9 area is in frame
stepping (§4)
  PASS  step(n) lands on the requested frame — frame 250, t=5s
  PASS  no network after load — 33 resources at ready, 33 after 250 frames
  PASS  stepping backwards is refused, not silently wrong
  PASS  no console errors
determinism (§4 acceptance)
  PASS  two independent runs give the same pixels at frame 250 — cf98f9a2 vs cf98f9a2
```

That last line is the one that matters. It is **two separate browser
processes**, each loading the page cold and stepping 250 frames, hashed over
the raw RGBA buffer — not two loads in one browser. Byte-identical, not
SSIM ≥ 0.999. We test it that way because you film unattended from whatever
process your scheduler starts, and a determinism bug that only appears across
processes is exactly the one that reaches air.

### The performance budget

Your §8 asks for ≤ 40 ms per frame at 1280×720 on an M3 Pro in headless
Chromium. Measured on an M3 Pro (`node scripts/venue-bench.mjs`, real Metal,
not SwiftShader):

| camera | median | p95 | draws | tris |
|---|---|---|---|---|
| pitchside | 1.60 ms | 3.70 ms | 50 | 30,764 |
| stand_high | 2.00 ms | 4.00 ms | 118 | 32,276 |
| aerial | 1.90 ms | 4.30 ms | 89 | 33,324 |

About 20× inside your budget — **but that is the empty stadium with no bundle
mounted.** Your stage adds roughly 335 draws and 57 point clouds on top, and
the crowd is not built yet. We are not going to pretend the final number is
2 ms. What the headroom says is that the crowd and the splats have somewhere
to go, and that a crowd/lighting budget is a thing we can tune to hit 40 ms
rather than a thing we have to fight for.

## 4. Cameras (§5)

Thirteen named cameras exist in `venue.json` today, and `/broadcast` can
select any of them. `gantry` is new and is **your** position: south gantry,
10.6 m back from the centre spot, 8.7 m up, looking north. We verified it
rather than assuming it — five rays from that point to the centre spot and the
four corners of the marked area, all clear, all in frame. There is no roof and
no lighting rig over the bowl, so there is nothing that *can* obstruct it.

The rest of §5 is not built. `HELI`, `STANDS` and `PITCHSIDE` need animation
with seeded noise; `TRACK` needs the camera track file read. The existing
`pitchside`, `stand_high` and `aerial` are static views, useful for framing
conversations but not the shots you described.

## 5. Two things to settle before anyone commits

### 5.1 One clause of the determinism contract is not ours to sign

Everything above is us. But §4's acceptance test covers a match on the pitch,
and the match is your SDK. The shape is right — `stage.update(dt, camera,
height)` takes our timestep rather than reading a clock, which is exactly what
we need. Whether the SDK is internally free of `Date.now()`, and whether it
seeds its own randomness, we cannot see from outside.

So: we will hold byte-identical reruns for the stadium, the cameras and the
crowd. We are not signing an SSIM ≥ 0.999 acceptance test that your renderer
can fail and we cannot fix. Suggest we run the two-process check with a real
bundle mounted early — that is a two-hour experiment and it tells both of us
whether this clause is free or expensive.

### 5.2 Version pinning is the expensive ask, not the pixels

> **[ROBIN — this is the commitment to think hardest about]**

§8 wants the stadium and everything visible from the §5 cameras pinned per
RFL season, ~30 days. Pinning the stadium is easy: it is a venue with its own
GLB and its own manifest, and a `?stadium=<version>` param is a small change.

But §5 also wants "rooftop wide with the city skyline behind the stadium" and
calls the city the establishing shot — and the city is a place agents change
daily. That is the whole premise. Freezing the skyline for 30 days at a time
is a different and much larger commitment than freezing the pitch, and it
works against what otra.city is for.

A middle path, if it suits you: **the bowl is pinned, the skyline is not.**
Everything inside the stadium holds still for a season; shots that include the
city get the city as it is on the day. If a changing skyline is unacceptable,
we should say so now rather than discover it in month two.

## 6. What we have not agreed to

> **[ROBIN — whether otra.city takes this on at all is your call; this
> section is written so that saying yes to some of it is easy.]**

- **The crowd (§6) is a real build**, and it is the thing that makes the
  ambient channel work. Seated citizens, deterministic placement under seed,
  idle behaviour on seeded timers, close-up-proof at `STANDS` distance. It is
  the largest piece of work in the brief and none of it exists.
- **The §3 arena furniture** — rebound walls, bevelled corners, goal mouths,
  the four missing marking types. Small, but it needs your exact geometry.
- **The §5 animated cameras** and the `camtrack` reader.
- **Credit wording** (§10) — [ROBIN].

## 7. Suggested next step

Yours was right, and it is done: the bare page exists with `step()`, `frame()`
and a verified `GANTRY`. So the ball is with you —

1. **Send a test bundle URL.** `?bundle=` works today. That unblocks the
   splat-vs-restyle A/B (your Q3) *and* the SDK determinism experiment (§5.1)
   in the same afternoon.
2. **Send the exact marking geometry** you render, and the arena wall spec
   (wall height, corner bevel dimensions, goal mouth width and height).
3. **Point your harness at `/broadcast`** and film 60 seconds of an empty
   stadium from `gantry`. If our contract is wrong, it will be wrong in a way
   footage shows in a minute and a spec argument would hide for a month.

Issues on the otra-city repo are fine for anything about the page or the
stadium.
