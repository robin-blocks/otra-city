# otra.city → RFL — five things we need from you

2026-09-14, later the same day. Follows the letter you have. Everything here is
something we cannot do from our side, with what we already tried in each case so
you can see the shape of it.

**§5 is the one to read first.** It is a timing discrepancy we have measured,
it explains the late audio you and we have both been chasing, and it is the
difference between the stadium showing your programme and the stadium showing
half of it.

---

## 1. Club crests

`{ id, name, code, color }` is the whole of a team, in the programme feed and in
`hud.json` alike. We searched both for `badge`, `crest`, `logo` and `emblem`:
nothing. So the scoreboard draws your spec's own fallback — the 14 px kit chip —
at both ends of the bottom bar, and will keep doing so until crests exist.

**What we need:** a URL per club. Ideally on the team object in both places, so
the scorebug does not have to care which route put the match on:

```json
{ "id": "A", "name": "Muse Spark FC", "code": "MSP",
  "color": [0.02, 0.45, 0.95, 1.0],
  "crest": "https://cdn.4dgsx.com/clubs/muse_spark.png" }
```

Square PNG with transparency, 128 px or better, served with the
`access-control-allow-origin` your bundles already carry. We will draw it at
26 x 26 where the spec says, and keep the chip as the fallback for any club
without one.

---

## 2. The advertising boards on your arena

Your rendered videos carried boards. The bundles do not, and we would rather
show yours than invent something.

Measured on `s3-m30`, and `s3-m27` before it:

```
every texture path referenced anywhere in scene.json:  ["textures/pitchgrass.png"]
371 draws, exactly 1 of them textured
186 static (body 0) draws — 17 distinct colours, no checker except the pitch
```

So the arena, hoardings included, reaches us as flat colour. Nothing of yours is
going undrawn at our end; it is not in what you publish.

**What we need, and there are two ways:**

- **The exporter emits them.** The format already does this — the pitch draw
  carries `tex: { src, scale_m, offset_m }`, so a hoarding draw with a texture
  needs no format change, only for the exporter to stop flattening them.
- **Or send us the artwork and where it goes**, and we will put it on our own
  geometry just inside your arena wall.

If neither is quick, say so and we will put **our** boards there instead — we
have a stadium full of them already. We would just rather the arena looked like
your arena.

---

## 3. The tracked gantry, which we would like to copy

Your rendered matches used a gantry that tracked the play and sat slightly
zoomed in, and it read as a real broadcast in a way a locked-off wide does not.
We would like to reproduce it rather than approximate it.

**What we need:** the parameters, as precisely as you have them.

- what it tracks — the ball, the centroid of the players, something weighted
- the smoothing: time constant, or the filter itself if it is not a simple lag
- the zoom: the field-of-view range, and what drives it (distance? spread of
  play? possession?)
- the limits: how far it will pan, what it does when the ball leaves the pitch,
  and whether there is a dead zone it will not follow inside
- how it behaves at a buzzer, and during a goal replay

`gauntlet/football.py` was where you pointed us for the scorebug and that worked
well — a pointer is as good as a spec here.

**One thing you should say no to if you want to.** Your §2 asked for cuts and
not drift, because your encoder is CBR and a slow continuous move costs far more
bitrate than a cut. A gantry that follows the play is exactly that move. We
think it is worth it and Robin thinks it looks materially better, but it is your
bitrate — tell us if the trade is wrong and we will leave the gantry locked.

---

## 4. Head-cam replays — we have the data, we cannot reach the bodies

We want to cut to the scorer's own head camera the moment a goal is given, run
the replay there, and cut back. In the stadium the players simply wait for the
replay to finish, as they already do; on the broadcast, and on the big screen
inside the ground, it is the replay.

**You have already given us almost all of it**, which we only found by looking:

```json
{ "t": 60.1, "type": "goal", "team": "A", "player": "r1", "replay_s": 5.0 }
players[1].anchor = { "body": "r1_pelvis", "offset": [0.0, 0.0, 0.62] }
```

Who scored, how long the replay runs, and a mount point at head height. That is
the whole of what a head cam needs.

**The one thing missing is a way to reach the body.** `scene.json`'s `bodies` is
an ordered list of names — `["corner_0", …, "ball", "r0_pelvis", …]` — and your
SDK resolves an anchor with `bodies.indexOf(anchor.body)` internally. But the
objects it builds are unnamed in the scene graph (we counted: zero named objects
under `4dgsx-stage`), and neither the array nor an accessor is on the stage.

**What we need:** a supported way to go from a body name to its transform. Any
of these does it —

```js
stage.body('r1_pelvis')     // an Object3D, or a matrix
stage.bodies                // the name list, so we can index group.children ourselves
stage.playerAnchor('r1')    // the anchor already resolved, offset applied
```

We can make it work by guessing that `stage.group.children` is in body order.
We would rather not ship a guess about your internals into a live broadcast.

While you are there: **your own head-cam spec**, if the rendered videos had one.
Field of view, the exact offset you used, and in particular whether the pelvis
body's forward axis is the player's facing — we would otherwise have to infer
it from velocity, which is wrong the moment a robot walks backwards.

---

## 5. The pre-roll is not reaching the stadium, and the stadium is 180 s ahead of you

This is the important one.

**Measured, on your m28, on the deployed page, on 2026-09-11:**

```
startsAt            19:01:42Z   (your feed)
first "match" read  19:02:16Z   — 34 s later
match clock then    9:25        — i.e. t = 35 s

so t = 0 at startsAt, within a second.
```

Your own record says `kickoff = startsAt + 180 s`, and `stream_start_utc()` is
documented as the first frame of the pre-roll card. So **the stadium puts the
whistle where your broadcast puts the beginning of the build-up.** The stadium
has been running three minutes ahead of your programme since the day it mounted
its first fixture.

Two consequences, one of which we have both been chasing all day:

- **There is no build-up in the stadium.** The programme in the bundle spans
  `t: [-180, 802]`, so the content exists; we are simply never positioned in it.
  A viewer arriving at the top of the hour should see the ground waiting, the
  pre-roll on the big screen and the scoreboard counting down, and the players
  standing about — then a kick-off. They currently see football immediately.
- **It is half of the audio problem.** If your premix starts at stem 0 while our
  picture is already at kick-off, commentary lands about three minutes late,
  which is exactly what we observed this afternoon. The other half was ours and
  is fixed: `state().match.audioOffset` now reports where the premix should be,
  through your map, replay holds included.

**What we need:** confirmation of the intent, and then the mechanism.

Our reading is that a live fixture should be positioned at **t = -180 at
`startsAt`**, play the build-up, kick off at `startsAt + 180`, and run the
post-roll after the full-time buzzer — so that the stadium and the Twitch feed
are the same programme, on the same clock, which is the whole point of the
arrangement.

If that is right, where should it come from? `stage.t0` is exposed and the
stage clearly knows its own window, so this may be a property of how the
scheduled mount is positioned rather than anything either of us does at the
call site. If it is a mount option, name it and we will pass it. If we should
seek after mounting, say so and we will — but we would rather not fight your
scheduler for the timeline it owns.

And the post-roll: the full buzzer is at `t = 617` with `play_end_t = 622`,
while the programme runs to `802`. We would like to stay in it to the end rather
than cut away at the whistle.

---

## Still outstanding from before, so they are not lost

`bundleUrl` on `upcoming` items, so we can pre-buffer instead of downloading
320 MB at the whistle — which is also what leaves the pitch empty for the first
minute of a programme. The league table, for the panel that is sized for it. And
more than one `upcoming` fixture, so the FIXTURES panel has something to list.
