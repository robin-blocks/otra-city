# otra.city → RFL: the walk-back, the follow and the replay file are built

2026-09-28, answering your letter of 2026-09-27 ("robots walk back after
goals; replays go broadcast-only").

Thank you for the notice and for the format. Everything you asked for is
built. It is in review as build `2026-09-28a` and **not in production yet**.
We'll send the build and the time when it goes out, which will be before
match 76 renders. Your capture box picks up a new build by itself between
matches.

## What we built

- **The walk-back on the pitch.** `meta.restart_phase` turns on the same
  >2 m/sample translation hold as `goal_celebration`. The referee's placement
  is a teleport on the rendered stage and in our director's sampler. Nothing
  on the pitch re-runs a goal: a restart_phase goal has `replay_s` 0 and no
  programme hold, so our head cam never arms for it. A goal after the
  full-time buzzer keeps its 5 s hold and the head cam, as you described.
- **The clock.** We honour `clock.stoppages`: the scorebug and the stadium
  board stand still on `[t, restart_t)`, and the explosion inside it is not
  subtracted twice. The period stays the half; it is not HALF TIME.
  `state().scorebug.stoppage` reads `"restart"` while one runs.
- **The follow.** The explosion framing is unchanged for its 1.6 s. Then the
  gantry pans from that framing onto the scorer, whom we find by the event's
  `player` and their anchor, and zooms in to a medium shot: about 3.2 m of
  height, a robot and the teammate arriving beside it. It holds the scorer
  until `t_end`. It is the same gantry position, so it's a pan and a zoom, not
  a cut. `state().programme.priority` reads `"follow"`.
- **The replay as a media cut.** For the `replay` event's window we play your
  file full-frame into our canvas, with REPLAY on the scorebug and the clock
  held. The stadium is not drawn for those frames. We fetch the file at the
  goal and have its first frame decoded before the window, so the cut lands
  on it. Playback runs on the file's own clock, positioned from the match
  time and re-seeked only if it drifts more than 0.25 s. With no `src`, a
  failed file, or a browser that can't decode H.264, the live stadium stays on
  for the whole window. The stadium itself, and our in-city big screen, show
  the walk-back.

We have run it on the real `/broadcast` page with m62 reshaped into your
format. The flow was: explosion framing, the follow to `t_end`, the file on
air 1 ms after the window opened, the live wide before the whistle, and the
clock held throughout. A second test plays a real H.264 file into WebGL from
another origin with your CDN's headers; both pass.

## 1. Media cut: yes, and please send 1280×720, not 1080

The media cut is our preference. It's cheaper on your minipc, and your 500 Hz
slow motion is something we could not produce from the 25 Hz track.

On size, please send **1280×720 at 50 fps**, H.264, no audio:

- `/broadcast`'s canvas is 1280×720. A 1080p file is decoded at 2.25× the
  pixels and then scaled down by us, which also softens fine detail. 720p maps
  one to one.
- On the minipc the decode may be in software, next to your two x264 encodes.
  `chrome://gpu` shows whether "Video Decode" is hardware accelerated there.
- `state().replayMedia.h264` reports whether that browser can decode H.264 at
  all: `"probably"` means yes, and `""` means it can't. Chromium builds without
  the proprietary codecs can't, and would show the live stadium through every
  replay. Please check it on the capture box before m76.

Two requests for the package itself:

- **Render it clean.** No scorebug, REPLAY tag or clock burned in: we draw ours
  on top, and a second set would double up.
- **Keep text out of the top 60 px.** Our scorebug and REPLAY tag sit there,
  and the scoreboard sits across the bottom-centre 70 px.

## 2. `clock.stoppages`: yes, already. Please don't mirror into `buzzers`

The scorebug honours `stoppages` in `2026-09-28a`. Please don't use the
stopgap: our clock only reads buzzers of kind `"half"` and `"full"`. An entry
of kind `"restart"` would have been ignored, so the clock would have run on
anyway.

## 3. Nothing in the walk-back fights the director

To our director the walk-back is play, so it gets the tracking gantry. The
iso stays for buzzer dead balls only. If you would like the iso on a
walk-back too, say so. The GOAL board's four seconds is outranked by the
follow, so there's no cut to the board, and nothing on our side expects the
old 5 s hold on a restart_phase goal.

We found one thing while checking this. Your explosion parks the ball 30 m
below the pitch. If it were still parked during the walk-back, our gantry
would have counted it and zoomed out to its widest. It now ignores any ball
more than 5 m below the pitch, so wherever the ball is during the walk-back
is fine by us. We'd still like to know where you put it.

## The sample bundle

Please send it as an https URL on your CDN. We'll run it through the real
page with `node scripts/restart-phase-browser.mjs --bundle <url>`, which
checks the explosion, the follow, the held clock, the replay on air and the
live wide before the whistle for one of its goals. Several goals, including
one after the full-time buzzer, would be ideal.

## Also coming: one more second on the wide at half time

Separately, a change in review (PR #136) keeps the first second after the
half-time whistle on the wide before the iso cuts in. Your reset moves every
robot to its kick-off spot within 0.06 s of `play_end_t`, and the iso was
whip-panning across it. The iso now also holds one player for the whole
window. Everything else agreed in REPLY-14/15 is unchanged.
