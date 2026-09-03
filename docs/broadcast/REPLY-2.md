# otra.city → RFL — re: your reply, and the m4 experiment

Second reply, 2026-09-03. Follows `REPLY.md`.

Short version: **we ran the §5.1 experiment before answering, with m4 mounted,
and it passes.** Details below, plus one bug your reply caused us to find in
our own contract, and our recommendation on the arena.

> **[ROBIN — decide before sending]** One decision left in here that is
> genuinely yours: §2, the arena. Engineering's recommendation is unambiguous
> and the evidence is in §1, but taking their bundle means the arena in our
> stadium is theirs, permanently. Credit wording (their §6 item 2) is still
> unanswered. Delete this block before pasting.

---

## 1. The determinism experiment: it passes, with a match on the pitch

You asked us to run it before either side builds on top of it. Done, on m4:

```
node scripts/broadcast-check.mjs --frames 250 \
  --bundle https://cdn.4dgsx.com/channels/rfl/bundles/s3-m4_frontier_fable_frontier_muse-d2452e48a6bba26e8b682c6b
```

```
  PASS  the match is mounted before ready resolves — phase "match"
  PASS  nothing the stadium is built from obstructs the 14 x 9 area
  PASS  no network after load — 48 resources at ready, 48 after 250 frames
  PASS  two independent runs give the same pixels at frame 250 — 017a434f vs 017a434f
PASS  15/15 checks
```

Two separate browser processes, each cold-loading, mounting your bundle and
stepping 250 frames on our fixed timestep. **Byte-identical.** Not SSIM.

So the clause we declined to sign in `REPLY.md` §5.1 turns out to be free.
Three things follow, and the third is the one worth your attention:

1. **Your reference player's purity holds in practice, not just in grep.** We
   can confirm from the outside what you confirmed from the inside.
2. **`stage.update(dt, …)` is already enough.** Our module drives your stage
   from our timestep today, and the pixels agree across processes. The
   external-clock entry point you offered is not blocking us. We would still
   like it eventually — right now we are relying on the absence of internal
   clocks rather than on an interface that promises their absence, and those
   are different guarantees — but it is no longer on the critical path.
3. **"No network after load" survives a mounted match.** 48 resources at
   ready, 48 after 250 frames. Your bundle is fully resident before frame 0.

### The bug your reply found for us

The first run of this experiment produced a hash *identical to the empty
stadium*. The match had not rendered at all.

Cause: our `ready` promise resolved when the venue reached Tier 2, which
happens in one tick. Your bundle takes about three seconds of wall time to
arrive. A harness that started stepping at `ready` would have filmed an empty
pitch for the opening seconds of every match — and because `step()` advances
simulated time far faster than real time, *no amount of stepping would have
fixed it*. It would have looked like a content bug, not a timing one.

`ready` now waits for the match module to reach phase `match` before it
resolves, and the check asserts it. Worth knowing for your harness design:
**`await ready` is load-bearing, and it can take tens of seconds** on a cold
bundle. It is not a formality to fire and forget.

The wait is deliberately on the wall clock and advances nothing. A settle loop
that ran "until mounted" would tick a different number of times on a slow
network, and no two runs would agree — which is the whole guarantee.

## 2. The arena: we recommend your furniture-only bundle

**Your §1 claim checks out exactly.** From m4's own `scene.json`: 356 draws,
57 bodies, and **174 draws attached to body index 0** — the world frame —
leaving 182 on the moving bodies. Your numbers, verified against the shipped
artefact rather than taken on trust.

More persuasive than the arithmetic: we mounted it and looked. The arena
arrives complete and lands correctly in our bowl — walls, goal frames with
nets, both corner push-panels, and the full marking set including the penalty
areas, goal areas, the D and the penalty spots from your §3 table. It needed
no adjustment from us.

Our sightline check even measured the overlap for us. From the gantry, the
rays to the four corners of the marked area are now stopped 0.27–0.42 m short,
at a height of 0.17–0.33 m, by geometry under `4dgsx-stage`: **your arena wall
standing exactly on our painted boundary.** Our 14 × 9 markings and your walls
occupy the same line, which is the clearest possible demonstration of your
"doing both is the one outcome that breaks".

So: **please publish the furniture-only bundle.** We will mount it permanently
in ambient mode and swap it for a match bundle at kick-off. One arena, yours,
pixel-identical between ambient and match. We will not build walls, goal
mouths, bevels or the missing markings.

> **[ROBIN]** This is the call to make consciously. It is the right
> engineering answer — one arena, no drift, and it deletes the largest
> remaining piece of work — but it does mean the middle of otra.city's stadium
> is RFL's geometry, arriving at runtime from their CDN, for as long as the
> arrangement lasts. Saying yes is easy; unwinding it later is a rebuild.

We have changed our sightline check to match this split: it now asserts that
**nothing we build** obstructs the frustum, and reports hits on your arena as
what they are rather than failing on them.

### Two things we noticed while looking

- **Two rings of advertising.** Yours on the arena wall, ours at ±10.5 / ±8.0.
  Both are in shot from the gantry. You called this worth a look once there
  was footage — there is footage now, and it reads as a real ground rather
  than a mistake. We would leave it.
- **Our turf deck extends past your walls** and shows as an apron around your
  arena. It looks deliberate. If you would rather it did not, say so.

## 2a. The city is in shot, and the skyline is thinner than you think

`/broadcast` runs the client's real pipeline — the same world, roads, venues
and plots a visitor walks — so your §5 "rooftop wide with the city skyline
behind the stadium" works today. The plots now load by default; `?street=0`
opts out. From a wide camera they cost about 8 draw calls and 4,700 triangles,
which is nothing.

One thing to set expectations on, because it is a fact about the city rather
than about the page: **the stadium sits at x = 100 and the built boulevard
runs x = −42…42.** The lots between are platted but mostly still vacant, so an
establishing shot looking west past the stadium currently shows road, lamps
and empty plot boards, with the built city at the edge of fog (fog ends at
190 m, camera far is 260 m).

That will fill in as agents claim lots — it is the premise of the place — but
if you film the establishing shot this month it will read as a new ground on
the edge of town, not a stadium in a dense city. Worth knowing before you
build a title sequence around it. If you want that shot to land sooner, say
so and we can talk about where the next lots get released.

## 3. On m1/m2

Noted, and we never reached them — we went straight to m4. Thank you for
saying so before we spent a day on a broken fixture. For the record we did not
touch the in-bundle reference player at all: the SDK is its own loader, and
that is the only path `/broadcast` uses.

## 4. Where that leaves the build list

| item | state |
|---|---|
| `/broadcast`, `step()`/`frame()`, GANTRY | done, on branch |
| determinism, empty stadium | passing |
| determinism, m4 mounted | **passing** |
| arena furniture and markings | **dropped**, pending your furniture-only bundle |
| crowd (§6) | not started — now the largest remaining item by a distance |
| animated cameras HELI/STANDS/PITCHSIDE, `camtrack` | not started |
| external-clock SDK entry point | yours, no longer blocking |

The crowd is now essentially the whole remaining brief.

## 5. Still open

- **Credit wording.** Neither side has proposed any. [ROBIN]
- **The furniture-only bundle**, if you accept §2.
- **A real camera track file** from m4, when convenient.
- **Deploying `/broadcast`** so your harness can reach it. It is on a branch;
  it needs Robin to merge and deploy, not more engineering. [ROBIN]
