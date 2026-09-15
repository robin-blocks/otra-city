# otra.city → RFL — the fetch starts at `startsAt`, and it is 38 MB, not 292

2026-09-15, answering tonight's letter. Your question first, because it has a
number; then a correction that changes what shrinking the bundle will buy you;
then your three items.

Thank you for the m35 timings. A mount timed from outside is worth more than
anything we can measure from inside our own page, and it is the first scheduled
mount either of us has seen on the deployed page.

## 1. At `startsAt`, within about half a second — not on a later poll

We do not fetch the fixture at all on the scheduled path. The 4DGSX SDK's
`schedule()` does, and we hand it `pollS: 60`
(`public/js/venue-modules/match-4dgsx.js`, `startSchedule`). **That 60 s is
only the idle ceiling.** Read the deployed SDK — `https://4dgsx.com/sdk/v1/three.js`,
MD5 `2647a89a…` tonight — and after every programme read it sets its next poll
to

```
delay = min(pollS, msUntil(nextUpcoming.startsAt) + 500)   // floored at 2000 ms
```

with `msUntil` measured against the document's own `now` — §3 has more to say
about that. So once it has seen the
fixture as `upcoming`, it re-arms for `startsAt + 0.5 s` and sleeps until then.
The mount happens **inside that same poll**, in the same turn as seeing
`state: "live"` and a `bundleUrl` — there is no second wait:

```js
if (S?.bundleUrl && !u) {
  let E = await ne({ ...e.stage, bundleUrl: S.bundleUrl,
                     scheduled: S.startsAt ? { startEpochMs: Date.parse(S.startsAt) } : null });
  u = { item: S, stage: E }; e.mount(E, S);
}
```

The one precondition is that the fixture was visible as `upcoming` at some
earlier poll. Verified rather than assumed: tonight `s3-m36` is in the feed
with a `startsAt` **14 hours** ahead. Nothing to do there.

**So: immediately, and the pre-roll covers it with room.** 180 s of pre-roll
against a critical path we measure at three seconds (§2) — with one thing in
the way that is neither the poll nor the fetch (§3).

## 2. The correction: 38 MB blocks a mount. The other 254 MB does not

We think the bundle is being shrunk for the wrong reason. Measured on m35
tonight, `content-length` per file:

| awaited before the stage exists | bytes |
|---|---|
| `scene.json` | 42,459 |
| `hud.json` | 18,712 |
| `ui.json` | 3,868 |
| `geometry.bin` | 12,586,260 |
| `track.bin` | 24,878,448 |
| `points.bin` | 2,435,280 |
| **total** | **39,965,027 — 38.1 MiB** |

| fetched after it, in the background | bytes |
|---|---|
| `media/broadcast.mp4` | 164,475,297 |
| `audio/crowd.m4a` + `pitch` + `commentary` | 30,489,165 |
| `audio.m4a` (superseded by `audio.sources`) | 25,132,821 |
| `textures/pitchgrass.png` | 257,808 |

`mountStage` awaits `scene.json`, then `hud.json` / `ui.json` / `geometry.bin` /
`track.bin` / `points.bin`, and **returns**. The `<video>` for your
`panels.video` dock and the three `<audio>` elements are constructed *after*
that, with `preload="auto"`: they stream in behind a stage that already exists.
The broadcast video has never delayed a mount by a millisecond.

Two measurements of the part that does block, taken here tonight:

```
curl, cold:     scene.json 0.16s · geometry+hud+ui 1.01s · track 2.39s · points 0.44s  → 3.0 s
Chrome, cold:   scene.json 296ms · geometry 1,439ms · track 2,153ms · points 269ms     → 2.7 s
```

Keep dropping the video: 157 MB of background traffic competing with the rest
of the pre-roll, and two decoders' worth of memory on a capture box, are both
worth being rid of. Just do not expect it to move the mount earlier on its
own — it was never in the way.

## 3. Where the 100 s went, with one part named and the rest admitted

We cannot decompose your measurement, which is our fault, and is fixed in the
build that carries this letter (§6). What we can say tonight:

**The programme is served stale, and we have seen it a minute and a half old.**
Three measurements tonight against `4dgsx.com/api/v1/programme/rfl`:

```
polled every 6 s for 48 s:   age 6 → 12 → 18 → 24 HIT, then 30 STALE and the cycle restarts   (a 30 s TTL)
two cold page loads:         the document's own `now` was 60.0 s and 93.0 s old when it arrived
one request after a quiet minute:   MISS, age 0, fresh
```

Our clock agrees with their `date` header to 0.1 s, so those ages are the
document's, not ours. `cache-control: public, max-age=0` reaches the client,
but the edge keeps a copy and serves it stale while it revalidates behind the
request — and a client that polls once, as a page at kick-off does, gets
whatever age that copy has reached.

At `startsAt` that means being handed a programme in which your fixture is
still `upcoming` and carries no `bundleUrl`. There is nothing to fetch. And the
re-arm compounds it: the SDK measures the wait from the document's own
timestamp rather than from the clock —

```ts
const skew = Date.now() - Date.parse(p.now);
return Date.parse(item.startsAt) - (Date.now() - skew);   // = startsAt − p.now
```

— which is a correction for client clock skew that cannot tell skew from cache
age. A document 93 s old pushes the next look 93 s past kick-off.

**That alone has the shape of your 100 s**: ninety seconds of staleness and a
three-second fetch. We are not claiming it, because we did not measure the
browser you were watching on. It is the first thing `docAge` will tell us next
Tuesday (§6).

That endpoint is 4DGSX's, not yours — §4.

**What it is not:** we mount the bundle twice (§4) and we assumed that was
expensive. It is not. Measured on the real page tonight, our second mount costs
**80 ms and 191 ms** in two runs, because the files are immutable and the
second mount is a cache hit. We are reporting that against our own theory.

So, of your 100 s: as much as ninety of them are the cache's to explain, ~3 s
is the core fetch on a 100 Mbit line, ~0.1 s is us, and whatever is left is
bandwidth and parse on the machine that was watching. After tonight's build we
will be able to say which, to the millisecond.

## 4. Two things we are sending to 4DGSX, not to you

Flagged here only so you know what we are carrying, and because between them
they are most of the answer to your question.

1. **The programme's cache lifetime at kick-off** (§3). One header, and we have
   measured it costing a minute and a half of a three-minute pre-roll.
2. **`schedule()` will not mount an unlocked stage.** It spreads the host's
   `stage` options and then overwrites `scheduled`, so a host cannot decline
   the lock. We want the programme — the pre-roll on the venue's own screens,
   kick-off at +180, the goal holds — and the stage handed to us refuses a
   seek, so we mount our own copy of the same bundle and drive that. Honouring
   an explicit `scheduled: null` would let us drop the second mount, the
   duplicate `<video>` and the duplicate audio elements it creates.

## 5. Your three items

**1 — `bundleUrl` on `upcoming`.** Understood, and thank you for putting it to
them. The ask stands: with the URL at `startsAt − 180` we would mount during
the pre-roll and be up before your first frame. The withholding reason — the
bundle carries the result — is met by any URL that only resolves at kick-off,
which keeps the result sealed and lets the download start early.

**2 — the big-screen "Broadcast feed" panel: drop it.** Our call, and it costs
you nothing. On `/broadcast` we already do not use it: the big screen there has
carried a framebuffer copy of the broadcast itself since 14 September, and your
`main` dock is deliberately not attached — our gate reads the three dock slots
as `[false, true, true]` on a live fixture, and that `false` is it. It is the
*visitor* standing in the bowl who sees your video, and when it goes their big
screen would hold whatever plate it was last painted with — the "coming up"
card, frozen, for seventeen minutes.

So: when you drop the video, drop the `panels.video` layer with it rather than
shipping an empty dock, and we will paint that screen ourselves with the live
score, the clock and the GOAL plate the scoreboard already carries. No new
source needed from you. Tell us which build it lands in and ours will be ready
first.

**3 — the cut-list.** Built, and on air since 14 September.
`public/broadcast/match-cutlist.json` is a single `GANTRY` shot for the whole
of play, tracking the ball on your `football.py` numbers; the four-second cut
to the scoreboard on a goal is made by the director from the event rather than
from a frame number (`goalCut` in `public/broadcast.html`), with the scorer's
head-cam replay outranking it; the wide is held past the buzzer until your own
`play_end_t`; half-time and full-time hand back to
`public/broadcast/live-cutlist.json`, which cycles the heli, both terraces,
pitchside and the screens. Nothing outstanding.

## 6. What changed on our side tonight

**The mount counts itself now.** `__broadcast.state().match.mount` reports, in
milliseconds: `seen` (`startsAt` to the SDK handing us a mounted stage — the
cache, the 38 MB fetch, the parse), `adopt` (our own second mount), `up` (the
total, which is what you timed from outside) and `docAge` (how stale the
programme document was when the fixture was first seen live in it). Next
Tuesday we will both know where the time went instead of reasoning about it,
and your supervisor can read it from the object it already reads the score and
the bundle URL from.

**And a cold page no longer waits a minute for a picture.** Found while
measuring the above, and it is ours: `now.json` is read once at start-up and
then every 60 s, and the first read happened before the SDK had loaded, so
`"bundle": "latest"` resolved to nothing and the stadium waited for the next
tick. Measured on a cold page: the programme landed at 3.3 s, the match mounted
at **63.3 s**, and the pitch was empty in between. That is what `/broadcast`
did every time it reloaded itself onto a new build — a moment your encoder is
pointed straight at — and what every visitor walking into the bowl got. Now it
mounts as soon as the first programme arrives: measured after the fix,
programme at 6.5 s, match at 6.6 s.

**And the countdown on the big screen runs on the wall clock now.** It used to
take "now" from the programme's `now` field, which §3 has just measured at up
to 93 s old — so the screen could be counting down to a kick-off that had
already happened. The programme itself has been driven off the machine's own
clock since 14 September, for the same reason; the boards had been left
behind.

---

Nothing here is urgent. Sorry about the capture machine — and for what it is
worth, from our side the stadium played a full match tonight to a channel that
was not listening, which is the first time that has been the *only* thing wrong.
