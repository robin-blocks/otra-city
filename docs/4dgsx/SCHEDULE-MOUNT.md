# otra.city → 4DGSX — the changeover: a stale programme, and a stage we cannot unlock

2026-09-15. For Splat. Two things, both about the one moment `schedule()` is
built to be precise about, and both found while answering a question RFL put to
us tonight: *at `startsAt`, do you start the fetch immediately or on your next
poll?*

The answer is "immediately, in the same turn" — your SDK does it right, and we
were able to show them the arithmetic. Then we measured what that poll actually
reads, and the precision is being spent on stale bytes.

Neither is urgent. Nothing is broken for us.

## 1. `schedule()` aims at `startsAt + 500 ms` and reads a document that can be 93 s old

Your re-arm is exact. We read tonight's deployed bundle
(`4dgsx.com/sdk/v1/three.js`, MD5 `2647a89a…`) and checked it against the
source it is built from — `site/lib/player/three/index.ts`, which is what we
quote here because it is the readable half of the same thing:

```ts
const until = next ? msUntil(p, next) : null;
if (until !== null && until > 0) waitMs = Math.min(waitMs, until + 500);
waitMs = Math.max(2000, waitMs);
```

So a host that has seen a fixture as `upcoming` wakes 500 ms after its
`startsAt`, sees `state: "live"` with a `bundleUrl`, and mounts inside that
same tick. Exactly right.

What it reads there, measured tonight against
`4dgsx.com/api/v1/programme/rfl`:

```
polled every 6 s for 48 s:         age 6 → 12 → 18 → 24 (HIT), then 30 (STALE) and the cycle restarts
two cold browser page loads:       the document's own `now` was 60.0 s and 93.0 s old on arrival
one request after a quiet minute:  MISS, age 0, fresh
```

Our clock agrees with your `date` header to 0.1 s, so those are the document's
ages, not ours. `cache-control: public, max-age=0` reaches the client, but the
edge keeps a copy and serves it stale while it revalidates behind the request.
A host that polls continuously stays within ~30 s of the truth. A host that
polls **once, at the changeover** — which is what your own re-arm arranges —
gets whatever age that copy has reached.

At `startsAt` that is a programme in which the fixture is still `upcoming` and
has no `bundleUrl`. There is nothing to mount.

**And the re-arm compounds it.** `msUntil` (`site/lib/player/core/programme.ts:102`)
measures the wait from the document's timestamp rather than from the clock:

```ts
const skew = Date.now() - Date.parse(p.now);
return Date.parse(item.startsAt) - (Date.now() - skew);   // = startsAt − p.now
```

The name says what it is for — a client whose clock is wrong — but it cannot
tell a wrong clock from a cached response, and one of those we have measured at
93 s. So the stale poll that found nothing then re-arms for 93 s later, and the
fixture starts downloading a minute and a half into its own pre-roll.

### Two SDK-side ways out, if the header below is not wanted

They are independent of each other and of the cache:

1. **Don't correct.** `Date.parse(item.startsAt) - Date.now()`. We made the
   same change on our side today, in the other direction: our countdown boards
   used your `now` and could count down to a kick-off that had already
   happened. Wall clocks are NTP-synced and wrong by seconds; this cache is
   wrong by minutes.
2. **Or expose `age`.** `Access-Control-Expose-Headers: age, date` would let
   `msUntil` subtract the document's real age and keep the skew correction.

RFL timed our deployed stadium tonight: `startsAt` 19:01:42Z, stage up
19:03:22Z. **100 seconds**, of which the bundle's mount-critical 38 MB accounts
for about three (measured, 100 Mbit line) and our own work for 0.1. We are not
claiming the rest is the cache — we did not record the document's age at that
mount, and now we do — but a 60-93 s stale programme is the right shape.

### And the cache header itself

Not `no-store` — the endpoint is polled by every client in a stadium and the
cache is doing real work for the other twenty-three hours. **The document knows
when the next changeover is.** The same `startsAt` your SDK re-arms on can pick
the TTL:

```
next changeover > 2 min away   →  s-maxage=30, as today
within 2 min of a startsAt     →  s-maxage=2, stale-while-revalidate=0
```

Then the one poll that matters reads a document that is current, and the
seventy-odd polls on either side of it still come off the edge.

## 2. `schedule()` cannot hand back an unlocked stage

Your type says this is deliberate, so treat this as a request rather than a bug
report:

```ts
stage?: Omit<StageOpts, "bundleUrl" | "scheduled">;
```

and at the mount:

```ts
const stage = await mountStage({
  ...opts.stage,
  bundleUrl: live.bundleUrl,
  scheduled: live.startsAt ? { startEpochMs: Date.parse(live.startsAt) } : null,
});
```

The lock is right for a host that just wants the match on a wall. It is wrong
for a host that runs the *programme*: RFL pin `startsAt` to the stream start,
so the locked clock is 180 s ahead of kick-off, it skips every goal hold, and
it refuses a seek. The stadium needs the pre-roll on its own screens, kick-off
at +180 with the premix, the holds, the post-roll — so today we keep your stage
untouched and **mount a second, unlocked copy of the same bundle** beside it,
and drive that.

It works, and it is cheaper than we assumed: the files are immutable, so the
second mount is a cache hit and costs 80-190 ms (measured tonight on the real
page). But it also builds a second `<video>` for `panels.video` and a
second set of `<audio>` elements, each `preload="auto"` — in RFL's bundles,
elements pointed at a 157 MB file and 29 MB of stems, buffering for a stage
nobody renders, and starting precisely during the pre-roll we are trying to
keep clear.

### The patch

```diff
-  stage?: Omit<StageOpts, "bundleUrl" | "scheduled">;
+  /**
+   * Options forwarded to `mountStage`. Pass `scheduled: null` to take the
+   * stage unlocked: the host is driving the programme itself and wants a
+   * transport it can seek. The schedule still owns the stage's life.
+   */
+  stage?: Omit<StageOpts, "bundleUrl">;
```

```diff
   const stage = await mountStage({
     ...opts.stage,
     bundleUrl: live.bundleUrl,
-    scheduled: live.startsAt
-      ? { startEpochMs: Date.parse(live.startsAt) } : null,
+    scheduled: opts.stage && "scheduled" in opts.stage
+      ? opts.stage.scheduled ?? null
+      : live.startsAt ? { startEpochMs: Date.parse(live.startsAt) } : null,
   });
```

Default behaviour is unchanged for every host that does not pass the key. We
would drop our second mount the day it ships.

## 3. One thing that is right and that we now depend on

Said out loud because we are relying on it in writing to RFL: `mountStage`
awaits `scene.json`, then `hud.json` / `ui.json` / `geometry.bin` /
`track.bin` / `points.bin`, and returns. The dock `<video>`, the audio
elements, the panel iframes and the textures are all built *after* that and
stream in behind a stage that already exists.

That is why a 290 MB bundle mounts on 38 MB, and we have just told RFL to stop
expecting a smaller video to make their mount land sooner. If you ever move a
media fetch in front of that return, it changes the answer.

(§9.2 of our labels letter still stands, and this is the same 38 MB from the
other end: progressive track streaming would make it a second or two.)

---

> **[ROBIN]** Yours to send, and it pairs with the RFL letter in the same
> build (`docs/broadcast/REPLY-12.md` §4, which tells them we are carrying
> these two rather than asking them for either). §2 is a patch against
> `robin-blocks/4DGSx` at `site/lib/player/three/index.ts` — same question as
> last time: **letter for Splat to apply, or do I open the PR on `4DGSx`
> myself?** §1 is a cache header on their API and needs nothing from us.
