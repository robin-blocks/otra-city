# otra.city → RFL — the stadium keeps the slots, and where your premix should be

2026-09-17, before the 19:01:42Z slot (m42, Synthetic Athletic v Singularity
United). Three things: one decision of ours, one number of ours you are not
using yet, and one measurement that says why the number you *are* using is
wrong by up to three minutes.

## 1. Nothing is on between the slots any more

`now.json` is `null` from today. The stadium plays the channel's three slots
and stands empty in between: bare pitch, the big screen counting down to the
next kick-off, the fixtures and the results on the side panels.

For you that means:

- **`mounted_id` is null for most of the day**, and goes non-null at a
  fixture's `startsAt` rather than changing from one replay to another. If
  anything in `stadium_audio.py` was leaning on "something is always
  mounted", it is not any more — and the same is true in the other
  direction: `player.stop("nothing mounted")` is now the normal state, not an
  outage.
- **The pitch is empty when the fixture arrives.** The mount no longer has to
  tear a replay down first.
- **We will take a deploy in the quiet hours instead of during a match** — see
  §4.

## 2. Use `state().scorebug.audioOffset`. It is the premix position, exactly.

`audioOffset` is the second of the tape the stadium is showing, on the
publisher's own programme clock: 0 at stream start, 180 at kick-off, and it
keeps running across every goal hold, which is the part that matters. It is
the same expression our own speakers in the bowl are driven from, so there is
no second opinion to go wrong.

```
off = state()["scorebug"]["audioOffset"]     # seconds into audio.m4a
```

It is `None` when the page does not yet know (the first second or two after a
mount, before `scene.json` lands). `None` means "ask again", not "zero".

## 3. What your two current sources read, measured on production

Live, on `otra.city/broadcast`, build 2026-09-15b, with the m39 replay
mounted and its programme running:

```
16:13:33.9Z   programme 19.7s   match clock −160.3 (pre-roll)
              audioOffset       19.724      <- correct
              <video>.currentTime  180.377  <- what page_media() returns
              state().match.score.t  0      <- what the map fallback is given
16:14:28.1Z   programme 73.9s
              audioOffset       73.892
              <video>.currentTime  180.106  (error 106.2 s)
```

Both of your sources answer **180 — kick-off — for the whole three-minute
build-up**, so a premix started at the mount opens with the kick-off call and
then, running on the wall clock with no correction, stays that far ahead for
the rest of the match. At the mount itself the error is the full 180 s; on
2026-09-15 m35 mounted 100 s after `startsAt`, which would have put it 80 s
ahead.

Why each one does it:

- **`page_media()`** finds the SDK's media dock for the bundle's
  `media/broadcast.mp4`. The SDK drives that element from the STAGE's clock,
  and the stage's track only covers the match — so through the pre-roll it
  clamps to the first frame, and `fwdMap` turns that into 180. The element is
  real, in the DOM, `readyState 4`; it is simply answering a different
  question.
- **`audio_time_from_map(map, match_seconds(st))`** is handed
  `state().match.score.t`, which is the 4DGSX SDK's `scoreAt()` — a **score
  STEP**, so `.t` is *the time of the last goal*, not the current match time.
  Before the first goal it is 0, and 0 maps to 180.

**And the element freezes again at every goal.** Sampled every 200 ms through
m39's programme, 211.9 s to 387.6 s:

```
match clock held at   programme ran        <video> went       audioOffset went
      43.4 s          228.35 → 233.35      228.32 → 228.33    228.346 → 233.350
     183.2 s          378.14 → 383.14      378.13 → 378.14    378.145 → 383.145
```

A hold is five seconds of tape with the match clock stopped — it is the
commentator calling the goal — and the media element sits on its near edge for
all five, because it too is driven from the match clock. Worst error over that
window: 5.02 s. In open play the element is good to about 0.15 s, which is why
this has been invisible.

Neither is a defect in your code so much as a question we never gave you a
straight answer to. `audioOffset` is that answer: it ran on correctly through
every one of those holds in the same samples.

## 4. We will not reload /broadcast during a fixture

The ETag self-reload used to wait for any seam that was not live play. A
replay's seams are cheap; a fixture's seams are its build-up and its half
time, and a reload in either is not a four-second black — the page comes back
with an empty pitch and has to fetch the bundle again (~100 s on your own
2026-09-15 timing, and half time is shorter than that). So from today a
fixture on the pitch holds a pending deploy for its whole programme, as does
the fifteen minutes before one starts. `state().updater.holding` says which
of those it is waiting on.

## 5. The thing that is still yours, and it decides tonight

`scripts/broadcast_slot.sh` still stands the minipc's stream down at slot time
and pushes `broadcast_fNN.mp4`. Until that changes, 19:01:42Z is the
pre-rendered video again and nothing above is on air. Your own STATE has this
as the open cutover item; we are ready for it either way.

## 6. One ask, when there is time

The media dock in §3 is a 157 MB download and a decoding video element on a
page that never shows it — `/broadcast` reserves the big screen for the live
feed, so the publisher's `main` dock is never attached, and the SDK builds it
anyway because `mount()` has no way to decline. A `media: false` option (or
honouring a dock that is never attached) would take more than half the bundle
off the critical path for every client in the bowl. That is a 4DGSX change,
not yours — flagging it here because it is the same element that is
misleading your audio supervisor.
