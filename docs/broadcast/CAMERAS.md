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
longer how a scheduled match gets on the air.

**The live feed is silent by default, and the city decides otherwise — never
the URL.** See "Whether the broadcast makes a sound" below. `state().silent`
always says which it is.

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
origin saying what the city has decided to show. Either a standing instruction:

```json
{ "bundle": "latest", "loop": true }
```

or one bundle, pinned:

```json
{ "bundle": "https://cdn.4dgsx.com/channels/rfl/bundles/…", "title": "…" }
```

Every client inside the bowl polls it every 60 s — the match module only runs
at Tier 2 — so changing that one file puts a replay in front of everyone who
could see the pitch at all, the broadcast camera among them. A live fixture
always takes the pitch back from it. `"bundle": null` takes it down. It is a
~320 MB download per client, so it is not something to leave on by accident.

**`"latest"` is the normal posture, and the reason is a bug we shipped.** A
pinned URL never moves: m28 was put on by hand on 14 September and was still
looping the next day with m32 and m33 aired and published behind it, because
nothing in the city advances a constant — and RFL publish a fixture into
`items` only near its kick-off, so for most of any day there is no live match
to outrank the pin either. `"latest"` resolves to the newest `replay` item
carrying a `bundleUrl`, ordered by `publishedAt`. Every client resolves it
against the same feed, so the city still agrees with itself, which is the whole
point of this document.

**A swap waits for a seam.** Following the feed means the bundle changes by
itself, and a swap is a teardown and a fresh 320 MB download for every client
in the bowl. Landing that mid-half would cut the picture at 2–1 in the second
half — the same thing the page's own updater refuses to do, for the same
reason. Every programme passes through a seam once a loop: the build-up, half
time, the outro. And while the feed has not been read yet, "I do not know" is
not "nothing is on": a failed poll leaves what is playing alone rather than
blanking the stadium for a missing HTTP response.

`state().match.now.follow` says whether the city is following or pinned, and
`state().match.latest` what `"latest"` resolves to today.

`state().match.source` says which of the three is on: `bundle`, `schedule` or
`now`.

**A replay can be told to loop:** `"loop": true` alongside the bundle. Without
it a replay runs once and the stage holds on the last frame, which is right for
a fixture that is meant to end and wrong for the stadium — it stops being a
broadcast and becomes a photograph of one. Looping seeks the stage back rather
than re-mounting, so it costs nothing: the bundle is already in memory and
nobody downloads 320 MB again. `state().match.loops` counts the times round.

The flag is read from the poll rather than from the document captured at mount,
so it can be turned on for something already playing.

Phones are the exception to all of this: the match core is a ~39 MB download
and the SDK's stage is a desktop-class scene, so a coarse-pointer client gets
the programme on the scoreboard and an empty pitch.

## The look: the match is a picture, not geometry

The city is rendered scene-referred — HDR floodlights, signs above 1.0 — and
finished by an ACES output pass at exposure 1.15. The 4DGSX stage is not: its
shader lights the match itself and writes a display-ready colour, the same
bytes their own player puts on the canvas. Until 2026-09-14 the stage went
through the city's output pass as well, so the finished picture was tone
mapped and encoded a second time. Measured on s3-m28 from the gantry, the
pitch's light stripe came out `[122,182,119]` where their player draws
`[94,166,96]`: lifted, grey-green, kits desaturated — the "washed out" that
Robin saw against RFL's rendered matches.

Two things fix it, and both were needed. The stage is drawn AFTER the output
pass (`js/after-tonemap.js`): the city goes through the composer without it,
the scene's depth is copied into the canvas, and the stage is drawn straight
to the canvas, depth-tested against the city, with no tone mapping and no
encoding — one full-screen triangle. And the pitch texture is sampled as
stored: their three.js SDK tags it sRGB, which three decodes to linear on the
GPU, while their own player (a hand-written WebGL2 renderer at
`4dgsx.com/watch`, running the identical shader) uploads it as plain RGBA.
Drawn raw with the decode still on, the stripe read `[30,88,31]`; with the
texture retagged, `[95,167,97]` — their player's value to within one level.
`state().afterToneMap.roots` is 1 while a match is mounted,
`state().match.look` says what was retagged, and `broadcast-check --bundle`
reads the pitch back at 36 points and compares each with what their shader
predicts from the texel it samples there.

What this does not do is reproduce RFL's rendered videos exactly: those come
from an offline renderer whose greens run about 20% brighter than their
player's (`[110,208,112]` for the same stripe). The stadium shows the match
as 4DGSX's player shows it, which is the live look their SDK is built for.

**The rule that follows, for anything we put inside their scene.** Their
shader is a raw one three injects nothing into, so it is never tone mapped.
Our own geometry parented into the stage — the advertising boards — is a
stock material, and three tone maps those per material when it draws to the
canvas, which is exactly where this pass draws. A board ACES'd on its own,
against a wall that is not, is the same defect in miniature: measured on
s3-m28, the boards' dark ground came out at 7 against artwork of 15. So
anything in that pass renders as authored. `after-tonemap.js` clears the flag
on every material it draws, including ones that arrive late (the boards are
attached when their atlas finishes downloading), and `broadcast-check
--bundle` walks the live stage and fails if anything in it is still tone
mapped.

Two consequences worth knowing. `timeofday` no longer touches the match — it
was never meant to; their arena is lit by their sun whatever the city's hour.
And the publisher's **glass panels** are not drawn: s3-m28 arrived with twelve
translucent panels standing 1.6 m above the arena wall, put there so a lofted
ball stays in play. A bundle is a recording, so the physics has already
happened; all the panels did here was lie across the lower half of every
gantry frame and lift the near pitch by half. The match module hides every
translucent standing panel it finds (`state().match.glass`), and
`"glass": true` in the venue's module config draws them again.

## Parameters

| parameter | meaning |
|---|---|
| `capture=1` | deterministic capture mode; **required** for anything below that mentions frames |
| `camera=<name>` | one named camera for the whole run (default `gantry` in capture mode) |
| `camtrack=<https url>` | a camera track file; overrides `camera` |
| `bundle=<https url>` | a 4DGSX bundle to play on the pitch. In capture mode, absent means an empty pitch. In live mode it overrides what the stadium would otherwise be showing — and because it changes only the browser that asked, it is a debugging tool, not a way to put a match on the air |
| `crowd=0..1` | how full the stands are; **`0` (default, both modes)** is an empty bowl holding only real visitors — see *Crowd*, and do not change it |
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

## Whether the broadcast makes a sound

**Default: silent.** RFL play the match premix into the audio bus their encoder
records, and that bus also carries this browser — so a page that emits during a
live fixture puts two commentary tracks on air at once. They asked for silence
in writing and asked to be told before it changed.

A **replay the city puts on** is the one exception, because they cannot premix
something they did not schedule and do not know about. `now.json` carries the
switch:

```json
{ "bundle": "https://cdn.4dgsx.com/...", "title": "...", "audio": true }
```

The rule, in full:

| what is on | `source` | sound |
|---|---|---|
| a scheduled fixture | `schedule` | **never** — RFL premix it |
| a bundle named in a URL | `bundle` | never |
| a replay the city put on, `audio` unset or false | `now` | no |
| a replay the city put on, `"audio": true` | `now` | **yes** |
| anything, in `?capture=1` | — | never; an `<audio>` element on the wall clock is a determinism bug |

Both halves are gated in CI: the page is silent unless the city asked, and a
scheduled fixture is never made audible whatever the flag says.

The sound is the publisher's own placed sources — crowd, pitch and commentary
from the bundle. The venue's PA is **not** used on the broadcast: it is a
distributed four-speaker simulation with 180–320 ms arrival delays, which is
right for somebody walking around the bowl and wrong for a television mix.

**A capture browser needs to allow autoplay**, or the audio context never
starts and the page stays silent however the flag is set. Headless Chrome wants
`--autoplay-policy=no-user-gesture-required`.

## Which build you are talking to

`state().build` (also `window.rflBroadcast.build`, and `build …` on the note
line at the bottom of the page) is the date the page's behaviour last
changed. A harness that pins a copy of the page, or a proxy that holds one,
will report an older date than `https://otra.city/broadcast` does — so a
"the deployed page still says X" conversation is settled by reading it. The
current build is **2026-09-15b** (the live feed adds nobody to the stadium
again, and a stand shot is a glance — before that, 2026-09-15a: the tracked
gantry, a pre-roll list, the wide held past the buzzer, and the screens
carrying the channel's timetable when the feed lists no fixture; 2026-09-14c:
a live fixture follows its programme, pre-roll, kick-off, holds, post-roll;
2026-09-14b: crests on the scorebug, the arena boards dressed, head-cam replays
on a replay the city put on; 2026-09-14: the live feed runs the stadium's match
module, the director cuts during play, the sound switch; and 2026-09-11). Bump
the constant at the top of `public/broadcast.html` whenever the page's
behaviour changes.

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

**Asking for it by name always gets the locked shot** — `?camera=gantry`, a
`camtrack` segment naming `GANTRY`, and every capture. Only the live director
tracks with it, and only while a match is on the pitch. See *The tracked
gantry* below.

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
that carry information rather than atmosphere. It loops every **136 seconds**
and is deliberately unhurried: this runs for days, and a feed that cuts every
few seconds is exhausting rather than alive. Nothing is at stake in an empty
bowl, so the camera is allowed to move.

`SCREEN_MAIN` frames the big screen **and both side panels at once**, so one
shot shows the coming-up card, the fixture list and the results; `SCOREBOARD`
frames the countdown. Both are held long enough to read — 12 s and 10 s.

**A stand shot is a glance, not a dwell — six seconds.** It used to be
twenty-five, which on a terrace nobody had walked into was twenty-five seconds
of furniture. Nothing is added to the bowl (see *Crowd*), so between matches
those seats hold whoever actually came, which is usually nobody; the honest
answer is to look briefly rather than to redirect the camera or fake the
people. When visitors **are** in the bowl they are the shot, and six seconds
is long enough to see them. Checked against the files by the gate — *no
cut-list lingers on the stands* — so it holds whether or not anybody is there
on the day.

**During a fixture's build-up — `/broadcast/preroll-cutlist.json`.** RFL run
three minutes of programme before kick-off with the bodies holding the
kick-off pose, and through it the venue's own screens are back on the docks
carrying a countdown. In the build-up "when does this start" *is* the picture,
so **four fifths of this list is those screens** — `SCREEN_MAIN` and
`SCOREBOARD` — with the remaining fifth on the bowl filling up: an aerial,
both terraces, a pitchside. It loops every 120 s, so it does not have to be
exactly as long as the pre-roll; it has to read right wherever inside it a
fixture is picked up. The share is checked in CI against the file.

A **replay the city puts on** has a build-up too, and gets the same treatment:
its programme has the same three segments and a build-up is a build-up whether
the match is happening now or happened yesterday. During it the big screen
belongs to the module, not to the broadcast feed — the countdown is the point,
and painting the feed over it would show a picture of the stadium instead.

## The scorebug

The broadcast graphics — a compact bug top left, a LIVE tag top right, and a
full scoreboard bottom centre. RFL asked us to take these over (their note of
2026-09-14 §2) and sent the spec their own renderer used; it is implemented in
`public/js/scorebug.js` in **an 854 x 480 layout space scaled to the real
frame**, which is how theirs worked and why the spec talks in proportions
rather than pixels.

Their SDK does carry a `match.scorebug` layer, and it is on. It reports
`scene: false` — it draws into their own HTML viewer and cannot reach a frame
we composite — so this is not a duplicate of something we could have switched
on. `match.panel3d` ("Stadium score panel", `scene: true`) is left **off** on
purpose: we paint our own board on `screen_score` from hud truth, and a second
score panel standing on the turf is the thing we declined their countdown board
over.

**It is drawn before the big screen takes its copy**, so the screen carries the
broadcast as broadcast, graphics and all.

**LIVE appears only on a genuinely scheduled fixture.** A replay the city put on
does not wear it. `stage.state` is the publisher's own truth for that, and RFL
asked us to use it rather than infer one.

### The clock

The publisher's `hud.clock` is the whole of it:

```json
{ "mode": "down", "duration_s": 600, "halves": 2, "half_breaks": [300],
  "buzzers": [ {"kind": "half", "t": 300, "restart_t": 317}, {"kind": "full", "t": 617} ] }
```

Two things about it are easy to get wrong, and both are handled by
`matchPeriod()` in the match module rather than in the page:

- **The stage's own `clock` counts down across the whole match** —
  `duration_s - t`, which is what their SDK computes — while a scorebug counts
  down *within the current half*. So the halves are derived, not read off it.
- **It runs on playing time.** It stops at the buzzer and does not move again
  until play restarts, so the interval is a period of its own: from
  `buzzers[i].t` to `restart_t`, reading `00:00` and tagged `Half Time`.

Tags are `First Half`, `Second Half`, `Half Time`, `Full Time`, and
`state().scorebug` reports exactly what is being drawn.

## What the screens show when there is no match

For roughly twenty-two hours a day the pitch is empty, and for all of them the
big screen and the two side panels used to show the plates they were painted
with in Blender. They now carry the programme instead, from the same feed the
scoreboard reads:

| surface | between matches, and through any build-up or outro | while the match is on |
|---|---|---|
| `screen_main` | coming up: the fixture, a live countdown, the London time | the broadcast feed |
| `panel_left` | FIXTURES — the next four, with times | the SDK's line-up panel |
| `panel_right` | RESULTS — the last four, with scores | the SDK's stats panel |
| `screen_score` | NEXT MATCH and the countdown | the live score and clock |

**When the feed lists no fixture at all**, which is most of any day — RFL
publish one close to its kick-off, so `/api/v1/programme/rfl` spends hours
carrying sixty replays and nothing upcoming — the screens fall back to the
channel's own timetable rather than saying NO MATCH SCHEDULED. `channel.slots`
and `channel.timezone` give the next slot; the countdown runs to that, labelled
**NEXT SLOT** and not *next kick-off*, with "the fixture is announced nearer
the time" under it. The FIXTURES panel becomes MATCH DAYS and lists the slots.
If the channel declares no slots either, the big screen says what the stadium
*is* showing instead of what it is not. The gate asserts the card is never a
bare negative while there is anything true to put on it.

Repainted once a second while the pitch is empty, so the countdown ticks. The
SDK takes the docks over when a match mounts and hands back the *authored*
plate when it unmounts, not ours — so the paint re-applies its own texture
every tick rather than assuming it is still there. `state().match.screens`
says what each one is showing.

**The venue's idle screens still do not carry a league table.** The programme
feed has no standings, and its rolling results window is not a whole season.
The **broadcast's post-match overlay** now uses RFL's separate complete-season
archive instead; it does not change the venue's fixtures/results panels.

### Post-match league table — 19 September, first-air fix 21 September 2026

On the automatic live `/broadcast` programme, full time does **not** immediately
cue the table. The scorebug must report `over: true`, `inPlay: false`, the
director's ball-settling hold must have ended, and the actual shot must be
`heli`. A measured ball must be at or below 0.6 m/s; without a measurement we
require the publisher's full-time `play_end_t`. Half time, pre-roll, goal
replays, explicit cameras/tracks and deterministic capture never show it.

After a 0.7-second settling beat: a title-safe navy panel enters over 0.55 s,
shows the **before-match** table until 1.8 s, animates the rows into their new
positions by 3 s, holds, and fades out between 17.4 and 18 s. All clubs remain
visible (2–12 supported). Columns are position, club/crest, played, goal
difference and points. Both match teams are highlighted, with separate cards
showing their new position, places gained/lost, or **NO CHANGE**. Direction is
shown by vector arrows and words, not colour alone. The table carries its own
full-time result strap, temporarily replacing the bottom score bar; the compact
top-left scorebug remains. Everything is composited into the WebGL frame before
`frame()`, `pixels()` and the stadium screen copy, not into a DOM-only overlay.

**Data and honesty.** `js/league-table-data.mjs` reads the public
[RFL league archive](https://raw.githubusercontent.com/robot-football-league/rfl-league-data/main/site.json).
It joins the exact publisher `watch.id` (also accepting its verified hex-suffix
bundle folder), home/away club codes and final score. Complete season fixtures,
unique teams/results, known statuses, valid unique aired timestamps, and status
counts are required. Recomputed **every-row** P/W/D/L/GF/GA/GD/Pts/position must
match the published table before any match-specific graphic is permitted.
Ranking follows the publisher's
[`_standings` implementation](https://github.com/robot-football-league/rfl-engine/blob/b6ce1ab1c8d6b5a5a9d6df07f0ccf73e9bc1687d/gauntlet/league.py#L227-L260):
3/1/0 points, then points/GD/GF descending, then stable configured team order.

There are two result paths; neither uses the archive's `prev`/`move` arrows,
which compare **rounds**, not this match:

- **Published result / historical replay:** only aired results preceding this
  result in the archive's `aired_at` sequence enter its before table; exactly
  this result creates the after table. Later fixtures cannot leak into a replay.
  A published score disagreement fails closed; it never invokes the other path.
- **First broadcast, result not yet archived:** the actual mounted match must
  have `source: schedule`, `state: live` and its original `startsAt`. The
  controller retains this occurrence with the match, not the rolling `live`
  item (which can already name the next fixture). It must cross the publisher's
  full-time `play_end_t` and every ordinary safety gate. Only then can the HUD's
  final score be applied once to the fully reconciled **before** table.
  The exact canonical season/fixture/home/away ID and any supplied bundle
  folder must agree; no re-render suffix or fuzzy club-name guess is allowed.

The first-air boundary follows RFL's documented **ascending fixture order, one
pending fixture per slot**, not an assumed ordering of arbitrary history. The
match must be the smallest still-scheduled fixture in the current season; all
lower numbers must be aired or explicitly skipped, no higher number may be
aired, and existing aired chronology must agree with that order and precede
this occurrence. Otherwise the boundary is ambiguous and we withhold the table.
Slot predictions, where present, must be valid and strictly increasing. Missing
predictions on the later pending tail are normal: RFL's site exporter gives
only its first twelve pending fixtures a `kickoff_utc`. These predictions also
roll forward on each export; they are **not** equated to stream start or actual
kickoff. The mounted occurrence must be no older than two hours and the archive
no older than six hours (at most 60 s future clock skew). These are safety
limits, not a claim that archive generation certifies upstream sync freshness.

Source inspected read-only at `rfl-station` revision
`4984e83f83a5b41de6b614c2d67b94bc4cfc94a1`: `gauntlet/schedule.py:21–22,149–163`
(order), `scripts/build_site_data.py:246–302` (ledger/statuses/twelve-slot
horizon), and `gauntlet/broadcast.py:993–1004` (marking aired after streaming).
The archive can lag the entire post-roll; that is why waiting for `watch.id`
on a first broadcast failed for S3 M42 on 21 September. A manually reordered
or incompletely published season remains unsupported rather than guessed.

The first-air graphic is labelled **“RFL · Including this result”**, with
`basis: first-air-hud` in diagnostics. Published results use
`basis: published-result`. If publication arrives before the cue, that result
is validated normally rather than applied twice. Once on air, the table and
its archive timestamp/provenance are frozen even if the archive refreshes.
`aired_at` orders league results; it is **not a playback-completion clock**:
our full-time and settled-ball gates remain independently necessary. When
`play_end_t` is present, a small measured speed cannot bypass it.

The archive is fetched only on the automatic live page while a match is
mounted, at most once per minute with a ten-second timeout. Missing prior
results, ambiguous chronology, unsupported table sizes or failed reconciliation
retain the ordinary full-time scoreboard. An unpublished result on a direct or
replay mount also stays withheld; first-air permission is not a general score
override. If data is not ready within 25 seconds of the safe post-match cue,
the graphic is skipped for that play. Seasons 1–2 currently lack complete aired
timestamps and deliberately do not qualify.

`js/post-match-table.mjs` owns cue/reset/polling; `js/league-overlay.js` owns the
canvas texture and explicit-time animation. A loop, replacement match or
backward seek resets the cue; a camera cut or return to play clears it.
`state().leagueTable` reports status, withheld reason, source and both clubs'
from/to/change. `npm run league:check` exercises accounting, cueing and actual
browser/WebGL compositing without an external data dependency. For the real
bundle/director path, add `--league` to `scripts/broadcast-check.mjs` with
`--now` pinned to an archived Season 3 bundle. On 19 September, S3 M28 passed
55/55 checks, including no table during 617–622 s dead-ball play, a table on
the settled `heli` shot, SYA 5→3 / MSP 9→9, and clearing on a seek back to play.

The first-air regression uses the saved 21 September M42 incident in
`scripts/fixtures/league-first-air-m42.json`: all 90 fixtures, unchanged official
pre-match table and the publisher's HUD; M42 still has no published result.
`league:check` runs its offline controller/accounting tests alongside the
original tests: **245/245 passed** (106 existing + 139 first-air), plus the
WebGL renderer gate. The real M42 scheduled rehearsal passed with no page
errors; the published M28 broadcast regression also retained **55/55** passes.
The real scheduled browser path is reproduced with:

```sh
node scripts/league-first-air-browser.mjs --gpu --out qa-out/league/first-air-fix/local
# Same rehearsal of deployed code, never touching the public schedule:
node scripts/league-first-air-browser.mjs --gpu --origin https://otra.city --out qa-out/league/first-air-fix/production
```

That harness substitutes only its own browser's clock and feed reads, mounts
the real M42 bundle through `rehearseLive`, crosses full-time dead ball into
post-roll, checks **SGU 6→3 / SYA 4→5** for the 3–6 result, saves the frame,
waits for the 18-second exit and checks suppression on return to play. The
publisher's SDK and bundle must be reachable; the offline tests need neither.
The separate offline gate passed 106 accounting/cue tests and the WebGL pixel,
crest, animation, texture-cache and disposal checks.

**During a match — `/broadcast/match-cutlist.json`. One shot, and it is the
gantry.** RFL asked for the gantry essentially throughout (their §4 of 14 Sep):
two-a-side robot football is small in frame, and every cut away from the wide
costs the viewer the thread of the play. Every shot in the list is a static
camera authored in `venue.json`, so a change of shot is a cut and nothing in
frame moves except the match — and the gantry itself, which tracks.

## The tracked gantry

A locked-off wide of two robots in a fourteen-metre frame is not a broadcast.
RFL's own rendered matches use a gantry that pans and zooms from a fixed
position, we asked to copy it rather than approximate it (REPLY-9 §3), and they
said yes and pointed at `gauntlet/football.py`. **This is that block**,
transposed from their Z-up match space into venue-local metres. Their numbers:

| | |
|---|---|
| **what it aims at** | the mean of the players and the ball **counted twice** — "the ball is the story: weight it like two outfield players". Not the ball alone: a wide that tracks only the ball swings past the play every time it is cleared. |
| **the bias** | the along-pitch component of that mean × **0.45**, "so the camera never swings to an extreme angle for one stray robot". Across the pitch it is unbiased. The aim sits at a fixed **0.45 m** above the turf. |
| **the lens** | sized to hold **every player and the ball** with a **1.45** border, so nobody is clipped to the edge of frame. Vertical fov, horizontal spread divided by the aspect. Clamped **38°–52°**. |
| **the smoothing** | first-order lags — RFL's 0.06 and 0.05 per frame at 50 fps, which is **0.32 s** on the aim and **0.39 s** on the lens. "A camera that snaps looks like a bug, and one that lags looks like a camera operator." |
| **the position** | never moves. A real gantry pans and zooms from one place. |

Measured against their arithmetic: four robots in a scrum on the centre spot
gives **38°**, the tightest it goes; play spread end to end gives **52°**, wider
than the locked 50°; a break to one goal pans the aim about 1.8 m and tightens.
At the 52° ceiling the clamp wins and play spread corner to corner does lose
somebody — their choice, and the gate counts those cases out loud rather than
failing them.

**Two differences from their renderer, both ours and both small.** They drop
*fallen* robots before averaging, from a fall tracker their simulation keeps
and a recording does not carry; every player is used here, which is their own
fallback for the case where all of them are down. And their lags are per frame
at a guaranteed 50 fps; this page paces itself from the wall clock — their own
capture machine has been measured painting at a sixth of real time — so the
constants are applied in seconds.

The tracking needs the bundle's bodies to be reachable by name, which the
module verifies before it uses them. When they are not, the shot is the locked
gantry, exactly as before.

**This is the one place the live feed spends bitrate on movement**, and it was
put to RFL explicitly (REPLY-9 §3) against their §2 ask for cuts and not drift.
They said yes.

**A goal takes the scoreboard for four seconds**, then cuts back — the module
paints `GOAL` there and the director goes to it, the way a gallery would. It
interrupts the cut-list, never an explicitly requested `camera` or `camtrack`.

**The buzzer is not the end of the play.** The half-time and full-time whistles
arrive with the ball still travelling — a shot, a clearance, a save — and the
director used to cut to the helicopter on the buzzer. RFL already measure the
difference: every buzzer in `hud.clock` carries `play_end_t` beside
`"ended": "ball at rest"`, five seconds after the whistle on every bundle we
have looked at. The wide is held across that span, and for a bundle whose clock
does not carry it there is a fallback of our own — hold while the ball is still
moving faster than 0.6 m/s, capped at six seconds. `state().scorebug.inPlay` is
the flag; `state().director.settling` says the fallback is what is holding it.

The change of list is itself a cut: each list restarts on its own first shot
rather than joining wherever its loop happened to be.

`state().director` reports which list is in force, which shot is on, and
whether a goal has the picture. Naming a `camera` or a `camtrack` turns the
director off entirely, and capture mode never has one — a harness says what it
wants.

That a match cut-list contains no moving shot is checked in CI
(`scripts/broadcast-check.mjs`), against the file rather than against a
running match: any segment naming a camera that is not authored in
`venue.json`, or naming `heli`, `stands` or `pitchside`, fails the gate. That
is a property of the **list** — the tracked gantry is the director's, applied
on top, and is checked separately as arithmetic: the bias, the lens range, the
border, and that play which has not moved gives a frame which has not moved.

## Crests

The bottom bar carries each club's crest at 26 x 26, where RFL's spec puts
it, with the kit chip as the fallback while an image loads and for good if a
club has none. Two sources, in order:

1. a `crest` URL on the team object in RFL's data (hud.json or the programme
   feed) — they have not published one yet, and when they do it wins;
2. the city's own copies, `/broadcast/crests/<CODE>.png`, listed in
   `/broadcast/crests.json` and keyed by the three-letter club code both the
   feed and hud.json carry. Eleven clubs today, 128 px, transparent, cut from
   the badges RFL supplied.

A publisher URL has to be served with CORS headers: the scorebug is a canvas
that becomes a texture, and a tainted canvas cannot. `state().crests` reports
the manifest and how many images have landed.

## The arena boards

RFL's bundles carry their advertising boards as flat dark boxes — their
exporter can emit textured faces (scene 0.4 `tex.proj`) but their SDK does
not draw them — so the artwork is put on here, by the match module, for every
client in the bowl and not only the broadcast.

- **Found by shape, not by name.** The SDK's meshes are unnamed. A board is a
  thin upright panel: under 3 cm through, 0.6–1.0 m tall, at least 0.8 m long.
  Bounds are computed per mesh from its own index range, because every prim in
  a bundle shares one vertex buffer and three's bounding box would be the
  whole arena.
- **Dressed with RFL's own panels.** `/broadcast/boards.json` + one atlas
  (`boards/atlas.png`) of the six LED designs their renderer used — `url` and
  `league`, in the touchline (2.12 m), end-wall (1.20 m) and outer (2.26 m)
  widths — laid out as their arena builder lays them: alternating along each
  touchline, the south run offset by one, league above the goal line and URL
  below it at the ends. One mesh, one draw call for the whole ring.
- **Both faces of every board are dressed**, 4 mm proud. The face against the
  wall is inside it and never seen, and drawing both means no rule about which
  way a board faces has to be right. Text reads correctly from in front of
  either face (the reading direction is up × normal).
- `state().match.boards` reports `found`, `textured`, the atlas state and the
  kinds. `"boards": false` in the module config turns it off.

When the SDK learns `tex.proj`, a bundle whose boards already carry a texture
should be left alone; that is the one change this will need.

## The pitch has no goal line, and that is the publisher's

Asked on 2026-09-15 and measured rather than guessed, against
`s3-m28`'s `scene.json` and `geometry.bin`. The bundle carries **124 pitch
markings**, every one a flat quad at z = 0.010–0.012 in rgba
(0.9, 0.95, 0.9, 0.8):

| marking | in the bundle |
|---|---|
| halfway line | **yes** — x = 0, the full 9 m |
| centre circle | **yes** — about 120 arc segments, r ≈ 1.25 m |
| penalty areas | **yes** — x = ±4.8, returning to x = ±7 |
| goal areas | **yes** — x = ±6.27, returning to x = ±7 |
| **goal lines** | **no** — nothing at x = ±7 |
| **touchlines** | **no** — nothing at y = ±4.5 |

The box lines run *into* x = ±7 and stop dead, which is exactly where a goal
line would close them: the boxes are drawn unclosed. Nothing on our side
touches them — the module hides only translucent draws that stand more than
0.3 m tall (the arena's glass panels), and these are 2 mm tall and flat, which
is precisely why that rule is written as a height and not as an alpha.

The boundary is physically there even though it is not painted: the arena wall
stands at y = ±4.5 to ±4.7 and the goal frames at x = ±7, so the ball is
contained. It is a look, not a rule that cannot be applied.

Two ways to fix it, and the choice is not obvious. **Ask 4DGSX** — their arena
builder already emits five kinds of marking and the perimeter is one line of
it, and then every viewer of a bundle gets it, not only ours. Or **draw it
here**, the way the boards are: two quads at x = ±7, 0.08 m wide (the width
every other line in the bundle uses), z = 0.011, in the same colour. That is
about twenty lines in `match-4dgsx.js` and it would be right by construction —
but it is painting a line on somebody else's pitch, and if their arena ever
changes shape we would be the last to know.

## A live fixture follows its programme

RFL pin a fixture's `startsAt` to the STREAM START: programme time 0, the
first frame of the pre-roll, with kick-off 180 s later. The SDK's schedule
hands over a stage locked to the wall clock with match t = 0 at `startsAt`,
which put the stadium 180 s ahead of RFL's broadcast from the first fixture it
ever mounted, skipped every goal hold, and could not be seeked — and on
2026-09-14 (build `2026-09-14`) also made the scorebug read pre-roll for the
whole match, which sent RFL's premix out from 0.00 s.

So the module adopts a live fixture and drives it itself. The SDK's stage is
kept and never posed or shown (the schedule tears it down when the fixture
ends); our own unlocked copy is mounted from the same URL — the bundle's files
are immutable and cached, so that costs no download — and placed every frame at
`unmapTime(program.map, (now − startsAt))`, `now` corrected by the feed's own
clock, so every client agrees the way the lock made them agree. On air:

- **the pre-roll**: the players held at the kick-off pose, the venue's own
  screens up (the big screen counting down to *this* kick-off), the scorebug
  reading `Kick-off 2:31` and LIVE, the director on the ambient list;
- **kick-off at `startsAt` + 180 s**: the publisher's panels take the screens,
  the gantry, `audioOffset` = programme time, so a premix started there has its
  commentary begin with the match;
- **the holds**: on `/broadcast`, the replays from the scorer's head;
- **the post-roll**: Full Time, the screens back to the venue's own, the
  ambient list, until the schedule takes the fixture down.

`state().match.drive` says `wall` for this, `dt` for a replay the city put on,
`null` for a stage on the publisher's own clock. `"live_programme": false` in
the module config restores the SDK's clock. A harness can rehearse the whole
path from any bundle with `rflBroadcast.rehearseLive({ bundleUrl, startsAt })`
and take it down with `rehearseLive(null)` — the gate does, at 60 s (pre-roll),
200 s (play) and on a goal's hold.

## Head-cam replays

RFL's programme holds the match clock for `replay_s` seconds at every goal
(measured on m32: sixteen holds, fifteen goals, each exactly on the goal and
exactly 5.0 s). Their render showed the goal again in that span; the stadium
dwelled. On `/broadcast` the hold is now the replay: the stage runs the last
`replay_s` seconds up to the goal once more, from the scorer's head, while the
programme clock — and so the scorebug's clock and score — stays where the
hold is. The bug wears REPLAY; the director cuts to `headcam`, which outranks
the scoreboard hold, and hands back to the cut-list when the hold ends.

- **The scorer's body is reached by name, and only once verified.** The SDK
  builds one group per body in body order under its match root (static world
  at 0, body *i* at *i* + 1) and hangs each nameplate on its body at the
  player's anchor offset. So every player's sprite must sit where their anchor
  says, on the group their body index names; if all do, the layout is the one
  we think it is and any body — the ball included — is reachable. If any does
  not, the head cam is not used. `state().match.bodies` says which.
- **Head height is RFL's own number**: the anchor offset, 0.62 m up the
  pelvis. It looks at the ball, because the ball is the story and a pelvis has
  no agreed forward axis; the look target is smoothed (τ = 0.12 s). FOV 68°.
- **Live fixtures too.** A scheduled fixture is driven through its programme
  on the wall clock (below), so its holds are replays here as well.
- Visitors' clients keep the dwell: `replayCam(true)` is asked for by the
  broadcast page, not set in the venue config. A capture (`?capture=1`) never
  arms it.

`rflBroadcast.seekMatch(t)` onto a goal's own time is a replay on demand,
which is how the gate proves it without waiting for one.

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

> **THE LIVE STREAM IS EXACTLY WHAT IS IN THE STADIUM. NOTHING IS ADDED TO IT.**
>
> `crowd` **defaults to 0 in both modes**, so the live feed shows only real
> visitors. This is not a tuning choice — it is the point of the thing. Going
> to otra.city puts you on the broadcast, and the figures in the stands are
> people: you can appear in the stream, and see who else is already there. A
> synthetic crowd would mean nobody watching, including the person standing in
> that terrace, could tell which figures were real, and the one promise the
> stream makes would stop being checkable.
>
> This was overturned on 2026-09-15 — the terraces looked empty on air, so the
> live feed was given a crowd — and put back the same day. **They look empty
> because they are, and that is the stream being honest.** The answer is to
> keep a stand shot short (see above), not to fill the seats.
>
> The gate asserts it: *the live feed adds nobody to the stadium*.

`?crowd=0.7` still populates them for a harness that wants a full ground to
measure against, and the gate uses it to exercise the instanced crowd's own
determinism. It is never the default anywhere.

Each fan's seat, clothing, resting posture, idle rate and stand-up schedule
come from the seed. Poses are a pure function of simulated time, so the crowd
seeks correctly and two processes agree. Fans breathe, shift, lean and stand;
roughly one in eight is on its feet at any moment.

It is instanced — ten `InstancedMesh` draws for the whole stand, not ten per
fan. Measured cost of 400 fans from the gantry: about 10 draw calls and
50k triangles on top of the empty stadium.

Match-event reactions are not implemented.

`state().crowd` reports the density, the fans seated and how many are on their
feet — and is **null on the live feed**, which is how the gate knows nobody was
added. `state().director.peers` is the visitor count, which on the live feed is
the whole of the crowd.

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
- Dropping *fallen* robots from the gantry's framing, which RFL's own renderer
  does from a fall tracker a recording does not carry.
- Crowd audio of any kind — no audio at all is produced; the venue PA is
  stripped from the module config on this page.
- A tunnel or behind-goal camera.
