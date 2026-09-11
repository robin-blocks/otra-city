# otra.city → RFL — the stadium owns what it shows

Fifth reply, 2026-09-11. Follows `REPLY-4.md`. Answers "What we need from
otra.city to put matches in the stadium", in your order.

Short version: **you were right about the principle and wrong about where the
split was.** The stadium has been running your schedule since it opened, for
every desktop visitor who walks into the bowl. `/broadcast` — the one page you
capture — was the only thing in the city that had opted out of it. That is
fixed, along with your §2 and §3, and §5's test now has something to trigger.

> **[ROBIN — decide before sending]** Three things in here are yours. The
> replay test in §5 commits us to a time and puts a ~320 MB download in front
> of every visitor while it runs. The presence change in §4 needs a `fly
> deploy`, which is your hands, not CI's. And the standing items from
> `REPLY-4.md` are still standing: the art call, the 45-day season pin, the
> Pollen GLB licence, the credit wording. Delete this block before sending.

---

## 0. The split was on our side, and it was one line

You wrote that you mounted a match into your capture browser with `?bundle=`,
it worked, and a visitor to otra.city still saw an empty stadium. You read that
as "the parameter only changed our browser", which is true, and concluded that
the stadium needed wiring to the schedule. That second part was not true, and
it matters that you know it, because it means less is changing than you think.

**The stadium was already wired.** The venue's match module runs
`sdk.schedule('rfl')` against your programme feed and mounts a fixture when it
goes live, independently, in every desktop client standing inside the bowl.
Measured on production today:

```
https://otra.city/venue.html?venue=stadium   (a real client, parked inside the bowl)

  sdk           ready
  channelTitle  Robot Football League
  next          s3-m28_frontier_muse_synthetic_athletic  2026-09-11T19:01:42Z
  board         "next MSP-SYA in 2:28:05"
  errors        []
```

That client is armed to mount m28 tonight with nothing told to it by us.

**`/broadcast` was not wired, and could not be.** The same probe against the
page your encoder loads:

```
https://otra.city/broadcast     (no parameters, as you are about to run it)

  state().match   null
```

Not "idle". Not "waiting". `null` — there was no match module on the page at
all. `/broadcast` deleted the venue's match module unless a bundle was named in
the URL, on the reasoning that the schedule path polls a feed on a wall clock
and a deterministic capture cannot have that. The reasoning is right for
`?capture=1` and was silently applied to the live feed too. So the parameter
you are about to delete was, on that page, the only thing that could ever put a
match on. Deleting it would have given you an empty pitch three times a day,
for ever, with nothing in any log to say why.

The fix is a filter clause. Capture mode still strips the module; the live feed
keeps it. Everything below follows from that.

---

## 1. Mounting the match, and the timing

**What changes for you: nothing.** Drop `?bundle=`, keep loading
`https://otra.city/broadcast`, and you get whatever the stadium is showing —
because the page is now running the same module, on the same feed, as the
visitor standing next to your camera.

**We do not start the match, and we would rather not.** The SDK mounts it from
your feed and owns its timeline; we mount the stage in the venue and paint a
scoreboard from `hud` truth. That is what makes your audio offset work — you
read `currentTime` off the media element and it already accounts for goal
replays, as you measured. Nothing in this change touches that path.

**We have never had your `channel.json`.** You wrote that the slots are "already
in your `channel.json` as `slotsUTC` with `autoSchedule: true`, so we think you
have the schedule". We do not, and we do not want it: a schedule we hold is a
schedule that can disagree with yours. Everything we know about when a match is
on comes from `https://4dgsx.com/api/v1/programme/rfl`, read fresh.

**Which brings us to the 3-minute offset, where your document and your feed
disagree by 102 seconds.** You wrote:

> real kick-off = slot time + 180 s

Your feed says every item starts at `:01:42` past the slot, without exception:

```
s3-m28   upcoming   startsAt 2026-09-11T19:01:42.000Z   durationS 1041.544
s3-m27   replay     startsAt 2026-09-11T15:01:42.000Z   durationS 1051.544
s3-m26   replay     startsAt 2026-09-11T11:01:42.000Z   durationS 1051.544
s3-m25   replay     startsAt 2026-09-10T19:01:42.000Z   durationS 1044.424
```

`startsAt + durationS == endsAt` exactly, so `startsAt` is the start of the
whole programme — pre-roll included. If the pre-roll is 180 s, kick-off is
`19:04:42Z`, which is slot + 282 s, not slot + 180 s. One of the two is wrong
and we cannot tell which from here.

It cannot bite us, because we never compute kick-off: the SDK mounts on
`startsAt` and you seek to our media element. But something on your side is
computing one of these numbers from the other, and we would rather say so than
let you find out on air. **Which anchor is authoritative?**

Two smaller things we found in the same place:

- **Our scoreboard no longer says "NEXT KICK-OFF".** It counts down to
  `startsAt`, which is when the programme reaches the pitch, not when the
  whistle goes. It says `NEXT MATCH` now. That was ours to fix and it is fixed.
- **`upcoming` items carry no `bundleUrl`.** Only `replay` items do. You wrote
  that the bundle is on the CDN hours early, and the feed agrees it exists —
  m28's `publishedAt` is `12:50:16Z`, which we suspect is the 13:52 you quoted,
  read in London rather than UTC — but the feed does not name its URL until the
  item is live, so nobody downstream can pre-buffer it even though it is
  sitting there. If you want the stadium warm before kick-off rather than
  downloading 320 MB at the whistle, expose `bundleUrl` on `upcoming` and we
  will pull it early. Your call; we are not asking for it, only saying that it
  is currently impossible — and that it is why the pitch will sit empty for the
  first minute or two of a programme.

---

## 2. The cameras cut now, and they cut differently during play

You asked for direction, and for cuts rather than drift because your encoder is
CBR. Both, as separate things:

**Drop `?camera=gantry` and the director takes over.** The locked-off shot of
an empty pitch you have been streaming is that parameter — it turns the
director off. It has always been off for you.

**Between matches, `/broadcast/live-cutlist.json`** — a wide orbit, two pushes
into the stands where the visitors actually are, a pitch-level shot, the
gantry. 140-second loop, deliberately unhurried. It moves, because an empty
bowl that never moves reads as a broken stream and there is no match to spend
bitrate on.

**During a match, `/broadcast/match-cutlist.json` — every shot static, every
change a cut.** 108-second loop, the gantry holding about three quarters of it,
with brief cuts to `stand_low`, `stand_high`, `aerial` and the scoreboard.
Nothing in frame moves except the match. The change of list is itself a cut:
each list restarts on its own first shot rather than joining its loop
mid-orbit.

**A goal takes the scoreboard for four seconds and then cuts back.** The module
already knows — it paints `GOAL` there — so the director goes to it, the way a
gallery would.

That the match list contains no moving shot is now a CI check, made against the
file rather than against a running match: any segment naming a camera that is
not statically authored in `venue.json`, or naming `heli`, `stands` or
`pitchside`, fails the gate. It cannot quietly drift back.

`state().director` reports which list is in force, which shot is on, and
whether a goal has the picture. Naming a `camera` or a `camtrack` still turns
the whole thing off, so nothing you already script changes.

---

## 3. The page is silent, and now it is silent on purpose

You were right to flag this as the one that breaks things, and right about the
mechanism. You were relying on something weaker than you knew.

Until today `/broadcast` emitted nothing **because there was no match module on
it** — the same bug as §0. Silence was a side effect of the pitch being empty.
Restoring the module would have ended it, and the first anyone would have known
is two commentary tracks on the Twitch stream.

So it is a decision now, in one line, at the top of the page: the audio
listener is muted outright before anything can attach to it. The match module's
own audio policy reads that mute and keeps your stems off; the venue's PA is
dropped from the config entirely, so it is not even fetched. It covers whatever
the venue grows next, rather than the sources we happen to have today.

**`state().silent` is `true`.** Assert on it — it is cheaper than measuring the
bus, and it is checked in CI on every change to the page.

**And the promise you asked for: we will not change this without telling you
first.** If the stadium ever has a reason to make noise, it will be in a reply
before it is in a deploy.

---

## 4. The two things you asked us to think about

### The peer cap cannot evict you, and now it cannot even turn you away

`state().live.cap` is not a connection limit. It is `maxRendered` — how many
peer avatars *your own browser draws*. Our fault for reporting it next to
`peers` and `connected` with a name that reads like a door policy. It is
labelled in the payload now:

```json
"live": { "cap": 32, "capIs": "peer avatars this browser draws", "observer": true, … }
```

Raise it with `?live=<n>` up to 256 if you ever want a fuller stand in shot.

There *was* a real door, and you found it by accident. The presence server
turns joiners away past 150 concurrent, and your capture reconnecting during a
busy match could have been one of them. Cameras are now counted and admitted
separately — `?observe=1` at the door, a cap of their own — so a full house can
never take the broadcast off the air.

**But the worst case was never as bad as you feared.** Presence is cosmetic. If
your camera loses it, the stands empty and the match, the stadium, the cameras
and the picture all carry on exactly as before. It reconnects on its own in
5–10 seconds. The Twitch stream does not go down; it just gets lonely.

### What the stadium shows for the other twenty-two hours

**The screens carry the programme now.** Until today the big screen and the two
side panels showed the plates they were painted with in Blender — fine as
scenery, useless as a broadcast — and the only live information in the building
was the scoreboard, which is behind the main camera. So:

| surface | between matches |
|---|---|
| the big screen | **COMING UP** — the next fixture, a live countdown, the London time |
| left panel | **FIXTURES** — the next four, with times |
| right panel | **RESULTS** — the last four, with scores |
| the scoreboard | NEXT MATCH, the countdown, the last result |

All of it from your programme feed, repainted once a second so the countdown
ticks, and handed straight back when the SDK mounts a match on those docks.

**And the ambient cut-list holds on them.** `SCREEN_MAIN` frames the big screen
and both panels in one shot — 12 seconds, twice a loop — and `SCOREBOARD` gets
10. That was the missing piece: there was no shot in the rotation that showed a
viewer arriving between matches when the next one was.

**One thing we could not put up there is the league table, because it is not in
the feed.** `/api/v1/programme/rfl` carries fixtures, results and scores but no
standings, and a table computed here from whichever results the feed happens to
include would be a table that is sometimes wrong with your name on it. If you
publish standings — even as a flat array on the channel object — the right-hand
panel is sized for it and we will put it up.

**A smaller version of the same problem:** the feed lists exactly one
`upcoming` item at a time, so the FIXTURES panel currently has one row on it and
a lot of space underneath. Four would fill it.

`/broadcast/now.json` (below) is the mechanism for anything more — a replay, a
match of the day, a run of last week's goals. We have no view yet on what should
go there. If you have a preference, it is easier to build than to guess.

---

## 5. The test you asked for

**`/broadcast/now.json`** is a document on our origin that says what the city is
showing:

```json
{ "bundle": "https://cdn.4dgsx.com/channels/rfl/bundles/…", "title": "…" }
```

Every client inside the bowl polls it every 60 seconds — the match module only
runs when a client is actually in the stadium — so changing that one file puts
the replay in front of everyone who could see the pitch at all, your capture
browser among them. A live fixture always takes the pitch back from it.
`"bundle": null` takes it down.

This is deliberately not an API. There is no token, no write endpoint and no
way for anyone outside the repository to change what the stadium shows; putting
a match on is a commit and a deploy, in public, with a name on it.

**What we propose.** Name a time. At that time we set `now.json` to
`s3-m27_frontier_gemini_frontier_fable` and deploy. You should see, with no
change on your side and no parameters on your URL:

1. the replay arrive in the stadium within ~60 s of the deploy plus however
   long 320 MB takes to land, for you and for any visitor standing in the bowl;
2. the director switch to the match cut-list — static shots, hard cuts;
3. the scoreboard take the picture for four seconds at each of the twelve
   goals (m27 finished GEM 8 – 4 FAB, so there is plenty to see);
4. your audio line up against the media element as it already does.

Then we set it back to `null` and the stadium empties.

Two honest notes about it. It is a ~320 MB download for every desktop visitor
while it is on, which is why it is not a thing we will leave running. And phones
will not see it: the match core is a ~39 MB stage we do not put on a
coarse-pointer client, so they get the scoreboard and an empty pitch, as they
do for a live fixture.

---

## 6. One thing you did not ask about, which we think you should measure

Watching the replay test run, the match clock advanced **17 seconds in 171
seconds of wall time**. Nothing was wrong with the mount; that is the live
feed's timestep, and it is worth understanding before it happens to you on air.

The live loop advances the world by the elapsed time since the last painted
frame, **clamped to 50 ms**. The clamp is there so that one long stall — a
background tab, a GC pause, a bundle landing — cannot step the world by a
second at once. The cost is that a machine which cannot sustain 20 fps does not
drop frames: **it runs the world slow, permanently**. The match plays in slow
motion while the wall clock carries on, and since you seek your premix to our
media element, your audio would follow it there.

Our measurement was headless software rendering on a laptop, which is the worst
case and not your case — you have real acceleration through ANGLE/EGL, and you
measured 60 fps against a target of 25. **But you measured it on an empty
stadium.** A mounted match adds the SDK's stage: we saw 296 draw calls in the
replay above, and RFL's own arena has run to ~390. That is the number to
re-measure before the first live slot.

So the page now reports it. **`state().pace`** is simulated seconds per wall
second since the live feed started: `1.0` is keeping up, `0.5` is a world at
half speed. Watch it rather than discover it — it is the difference between
"the stream looks a bit odd tonight" and a number.

We have not changed the clamp. Handing the stage a three-second `dt` is its own
kind of failure, and which one is worse depends on whose machine it is running
on. If `pace` sits below 1.0 on your capture box with a match up, tell us and
we will raise it for the live path — but we would rather do that with your
number than with ours.

---

## What we have verified, and what we have not

Verified, today, by measurement rather than reading:

- `/broadcast` with no parameters keeps the stadium's match module, is silent
  (`silent: true`), and runs the ambient cut-list. 21/21 in the broadcast gate,
  including the deterministic-capture contract, which is unchanged: two
  independent browsers still produce identical pixels at frame 60.
- The screens read. Rendered from the `screen_main` and `scoreboard` cameras
  against the live feed: `COMING UP · MSP v SYA · 1:54:27 · on at Fri 20:01
  London` on the big screen, four results on the right panel, and the
  scoreboard counting down with `LAST RESULT GEM 8 – 4 FAB` underneath. The
  first attempt set the panel type at a comfortable size for someone standing
  in the bowl, which was about six pixels on air; it is sized from the frame
  now.
- The goal cut fires. In the replay below, GEM scored at match time 40.6 s and
  the director cut `gantry → scoreboard` on that frame, with `GOAL` and
  `GEM 1 – 0 FAB` filling the board.
- A replay named in `now.json` mounts in the stadium with no URL parameters at
  all. Measured end to end on a local copy of the site, opening a bare
  `/broadcast`: ready at +0 s, `phase: "loading"` at +56 s, and on the pitch at
  **+61 s** —

  ```
  state().match      { source: "now", state: "replay",
                       id: "s3-m27_frontier_gemini_frontier_fable-0e1f53cbbd3d…",
                       title: "RFL S3 M27 — Gemini Flash FC vs AFC Fable (replay)",
                       clock: "9:59", errors: [] }
  state().director   { list: "match", shot: "gantry", goal: false }
  state().silent     true
  296 draw calls
  ```

  The director changed to the match cut-list by itself, on the frame the match
  landed. Nothing in that URL said anything.
- The stadium's scheduled path is live on production and armed for m28 tonight.
- A full house does not turn a camera away: 150 citizens admitted, the 151st
  refused, a camera admitted anyway, and cameras capped separately at 8. That
  is a new gate in CI (`scripts/presence-check.mjs`) because nothing else in CI
  touched `server/`, and a promise with no test behind it is a promise with a
  shelf life.

**The build stamp for all of this is `2026-09-11`.** `state().build` on the
page you are loading will say `2026-09-08` until it is deployed, which is the
fastest way for either of us to tell whether you are looking at this work or
the last lot.

**Not verified: a scheduled fixture mounting at kick-off on the deployed
`/broadcast`.** The next opportunity is 19:01:42Z tonight and this change will
not be deployed by then. We would rather tell you that than let you infer it
from a green tick. The replay test in §5 exercises every part of the path
except the SDK's own decision to mount, which is the part that has been working
in the bowl all along.
