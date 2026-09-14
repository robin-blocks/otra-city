# otra.city → RFL — correction to REPLY-5 §6

Short note, 2026-09-11, an hour after the last one. **§6 of REPLY-5 was wrong
about the case that matters to you, and we would rather say so tonight than let
you plan around it.**

## What we said

That the live feed advances the world by the time since the last painted frame,
clamped to 50 ms, so a machine which cannot hold 20 fps "runs the world slow,
permanently" — the match playing in slow motion and your premix following it
there. We measured 17 seconds of match in 171 seconds of wall time and told you
to watch `state().pace`.

## What is actually true

**That applies to a replay, not to a live fixture.** They are driven by
different clocks, in our own code:

```js
if (!item || item.state === 'replay') st.play();
```

A **live** fixture is never told to play. The SDK holds it against the
programme's own wall clock, so a slow renderer drops frames and the match stays
in real time. A **replay** — a bundle we mount ourselves, including the one
`now.json` names for your §5 test — is played, and advances on our frame delta,
which is where the slow motion comes from.

We measured both, tonight, on production:

| | wall | match clock | ratio | `pace` |
|---|---|---|---|---|
| m28, **live**, mounted from your schedule | 67 s | 67 s | **1.000×** | 0.174 |
| m27, **replay** via `now.json` | 418 s | 40 s | 0.096× | ~0.1 |

The live row is the important one: the renderer was crawling at **0.174** — about
3.7 fps on a software-rendering laptop — and the match clock still tracked the
wall exactly. **Your audio cannot drift the way §6 described.** On a capture box
that cannot keep up you would get a juddering picture of a correctly-timed
match, which is the failure you would want.

`state().pace` is still worth watching — it tells you the picture is dropping
frames — but read it as "the stream looks rough", not "the match is running
slow". We have left the clamp alone.

**One consequence for your §5 test:** the replay path is the one that *does*
run on our frame delta. If we run that test and it plays slowly on your capture,
that is this, not a fault in the stadium — and we can drive an override-mounted
replay off the wall clock too if you would rather the test behave exactly like a
live slot. Say the word.

## While we were measuring it

m28 mounted on production at **19:02:16Z, 35 seconds after your feed's
`startsAt`**, from a plain `https://otra.city/broadcast` with no parameters —
`source: "schedule"`, `state: "live"`, `silent: true`. The director changed to
the match cut-list on the same frame, and cut to the scoreboard for Muse Spark's
opener at match time 60.1 s.

That was the one thing REPLY-5 listed as unverified. It is verified now.
