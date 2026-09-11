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

## Two modes

**`/broadcast` is a LIVE FEED by default.** Realtime, a directed cut-list, and
every visitor standing in the stadium right now is in shot. It is not
reproducible and does not pretend to be.

**In live mode the page runs the venue's own match module.** The same schedule,
read from the same programme feed, that a visitor standing in the bowl is
watching — so whatever is in the stadium is in the broadcast, without anyone
naming a bundle in a URL. `?bundle=` still works and still wins, but it is no
longer how a scheduled match gets on the air. The live feed is also **silent**:
the audio listener is muted outright and `state().silent` says so.

**Deterministic capture must be asked for: `?capture=1`.** That is the mode
this document's guarantees apply to — fixed timestep, no wall clock, no live
visitors, same inputs and seed giving the same pixels.

The ordering is deliberate. A harness that forgets `capture=1` gets live mode,
where **`step()` throws on the first call** with a message naming the flag —
loud, before a single frame is filmed. The opposite default would have failed
silently: hours of footage that simply never repeats.

`?live=0` is accepted as a synonym for `?capture=1`.

## What is on the pitch, and who decides

Three things can put a match in the stadium. They are listed in the order they
outrank each other.

**1. `?bundle=` — one browser only.** Mounts that bundle here and nowhere else.
Useful for a fixture or a bug; useless for broadcasting, because the stadium
everyone else is looking at does not change. Stripped in capture mode unless it
is the thing being captured.

**2. The RFL channel's own schedule — the normal case.** The venue's match
module runs `sdk.schedule('rfl')` against `https://4dgsx.com/api/v1/programme/rfl`
and mounts a fixture when it goes live, for every client independently: the
visitor in the bowl, the camera on `/broadcast`, all from the same feed on the
same clock. Nothing on our side needs telling when a match starts.

**3. `/broadcast/now.json` — the city's shared override.** A document on our own
origin naming a bundle the city has decided to show:

```json
{ "bundle": "https://cdn.4dgsx.com/channels/rfl/bundles/…", "title": "…" }
```

Every client inside the bowl polls it every 60 s — the match module only runs
at Tier 2 — so changing that one file puts a replay in front of everyone who
could see the pitch at all, the broadcast camera among them. A live fixture
always takes the pitch back from it. `"bundle": null` takes it down. It is a
~320 MB download per client, so it is not something to leave on by accident.

`state().match.source` says which of the three is on: `bundle`, `schedule` or
`now`.

Phones are the exception to all of this: the match core is a ~39 MB download
and the SDK's stage is a desktop-class scene, so a coarse-pointer client gets
the programme on the scoreboard and an empty pitch.

## Parameters

| parameter | meaning |
|---|---|
| `capture=1` | deterministic capture mode; **required** for anything below that mentions frames |
| `camera=<name>` | one named camera for the whole run (default `gantry` in capture mode) |
| `camtrack=<https url>` | a camera track file; overrides `camera` |
| `bundle=<https url>` | a 4DGSX bundle to play on the pitch. In capture mode, absent means an empty pitch. In live mode it overrides what the stadium would otherwise be showing — and because it changes only the browser that asked, it is a debugging tool, not a way to put a match on the air |
| `crowd=0..1` | how full the stands are; `0` (default) is empty |
| `seed=<int>` | selects one of many equally valid versions of the same shot and crowd |
| `t0=<seconds>` | warm the scene to this point before frame 0 |
| `timeofday=0..24` | shift the lighting; see the caveat below |
| `street=0` | drop the city's plots (they load by default) |
| `venue=<id>` | which venue to film (default `stadium`) |
| `live=<cap>` | in live mode, how many visitors to draw at once (default 32, max 256) |

Anything the page cannot honour is reported in `state().unimplemented` and
shown on the page rather than silently ignored.

Camera names are case-insensitive: `camera=STANDS`, `camera=stands` and
`camera=Stands` are the same shot, and the authored views in `venue.json`
answer to capitals too. `window.rflBroadcast.cameras()` lists every name
`camera=` accepts. `camera=TRACK` on its own is refused with a message
saying it needs `camtrack=`, since the track file is what supplies it.

## Which build you are talking to

`state().build` (also `window.rflBroadcast.build`, and `build …` on the note
line at the bottom of the page) is the date the page's behaviour last
changed. A harness that pins a copy of the page, or a proxy that holds one,
will report an older date than `https://otra.city/broadcast` does — so a
"the deployed page still says X" conversation is settled by reading it. The
current build is **2026-09-11** (the live feed runs the stadium's match module,
the director cuts during play, and the page is explicitly silent — before that,
2026-09-08). Bump the constant at the top of
`public/broadcast.html` whenever the page's behaviour changes.

The gate asserts the field exists, and it can be pointed at the deployed
site rather than a local copy of `public/`:

```
node scripts/broadcast-check.mjs --origin https://otra.city --frames 250 \
  --crowd 0.7 --camtrack /broadcast/camtrack-example.json
```

Same checks, same two independent browser processes, against production.

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

## The director

With no `camera` and no `camtrack`, the live feed directs itself, and what it
does depends on whether a match is on the pitch.

**Between matches — `/broadcast/live-cutlist.json`.** A wide orbit of the bowl,
two pushes into the stands where the visitors actually are, a pitch-level shot,
the gantry — and **two holds on the screens**, which are the only shots in it
that carry information rather than atmosphere. It loops every **174 seconds**
and is deliberately unhurried: this runs for days, and a feed that cuts every
few seconds is exhausting rather than alive. Nothing is at stake in an empty
bowl, so the camera is allowed to move.

`SCREEN_MAIN` frames the big screen **and both side panels at once**, so one
shot shows the coming-up card, the fixture list and the results; `SCOREBOARD`
frames the countdown. Both are held long enough to read — 12 s and 10 s.

## What the screens show when there is no match

For roughly twenty-two hours a day the pitch is empty, and for all of them the
big screen and the two side panels used to show the plates they were painted
with in Blender. They now carry the programme instead, from the same feed the
scoreboard reads:

| surface | between matches | during a match |
|---|---|---|
| `screen_main` | coming up: the next fixture, a live countdown, the London time | the SDK's broadcast feed |
| `panel_left` | FIXTURES — the next five, with times | the SDK's line-up panel |
| `panel_right` | RESULTS — the last five, with scores | the SDK's stats panel |
| `screen_score` | NEXT MATCH and the countdown | the live score and clock |

Repainted once a second while the pitch is empty, so the countdown ticks. The
SDK takes the docks over when a match mounts and hands back the *authored*
plate when it unmounts, not ours — so the paint re-applies its own texture
every tick rather than assuming it is still there. `state().match.screens`
says what each one is showing.

**The league table is not among them, because it is not in the feed.**
`/api/v1/programme/rfl` carries fixtures, results and scores but no standings,
and a table computed here from whichever results the feed happens to include
would be a table that is sometimes wrong under somebody else's name. If RFL
publish standings, the right panel is where they go.

**During a match — `/broadcast/match-cutlist.json`. Cuts, never drift.** Every
shot is a static camera authored in `venue.json`, so a change of shot is a cut
and nothing in frame moves except the match. RFL's encoder is CBR and a slow
continuous camera move spends bitrate on every pixel of every frame; the
subject is the football, so the bitrate should be too. The gantry holds about
three quarters of the loop (108 s), with brief cuts to `stand_low`,
`stand_high`, `aerial` and the scoreboard.

**A goal takes the scoreboard for four seconds**, then cuts back — the module
paints `GOAL` there and the director goes to it, the way a gallery would. It
interrupts the cut-list, never an explicitly requested `camera` or `camtrack`.

The change of list is itself a cut: each list restarts on its own first shot
rather than joining wherever its loop happened to be.

`state().director` reports which list is in force, which shot is on, and
whether a goal has the picture. Naming a `camera` or a `camtrack` turns the
director off entirely, and capture mode never has one — a harness says what it
wants.

That a match cut-list contains no moving shot is checked in CI
(`scripts/broadcast-check.mjs`), against the file rather than against a
running match: any segment naming a camera that is not authored in
`venue.json`, or naming `heli`, `stands` or `pitchside`, fails the gate.

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

- `"loop": true` at the top level wraps back to the start instead of running
  off the end — required for an ambient feed, which otherwise holds its last
  framing for ever. Every named camera's own clock restarts with the wrap, so
  a looped feed repeats exactly rather than drifting.
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

**It defaults to 0 in both modes**, so the live feed shows only real visitors
and nobody has to wonder which of the figures in the stands is a person. Add
`?crowd=0.3` if a fuller ground matters more than that.

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

## Season 4: the Microduck division

From 2 October 2026 the RFL runs a second division on the same pitch — a
25 cm biped, published in bundles scaled ×4 into stadium metres, so the
bodies are ~1.0 m tall and the ball 0.28 m. Nothing on this page keys on the
robot: the match module never reads a bundle's `scene.json` (the SDK does),
the cameras aim at fixed points between 0.5 and 0.6 m above the turf, the
track reader passes RFL's per-frame state through untouched, and the crowd
and the sightline check do not know a match is on. A duck bundle plays the
way a G1 bundle does. The one thing that had to change was the scoreboard,
whose title and club-name lines now fit their width instead of running off
the board — season-4 titles are half again as long.

## What is not built

- Match-event crowd reactions (§6, explicitly a later phase).
- Crowd audio of any kind — no audio at all is produced; the venue PA is
  stripped from the module config on this page.
- A tunnel or behind-goal camera.
