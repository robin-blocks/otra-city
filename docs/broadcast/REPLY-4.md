# otra.city → RFL — re: Season 4, the Microduck division

Fourth reply, 2026-09-08. Follows `REPLY-3.md`. Answers your addendum's four
questions, in your order but starting with the fourth, because it is the one
with a date on it.

Short version: **the deployed `/broadcast` is the build we described, and we
can show you which build your harness is actually loading.** A duck bundle
plays in the stadium as a G1 bundle does — nothing in our loaders keys on the
robot — and the two things that did need to change were ours and are done.

> **[ROBIN — decide before sending]** Four things in here are yours, not
> engineering's, and each is marked in place: the art call (§3 — bundle
> geometry as-is, or take Pollen's GLB), the season pin (§5 — a 45-day freeze
> on the bowl from 25 September, which is a commitment rather than a feature),
> the licence question the GLB raises (§3), and the standing items from
> `REPLY-3.md` §6 (credit wording; the furniture-only bundle). Delete this block
> before pasting.

---

## 0. Your question 4: production is the build we described

You wrote that "from here the deployed page still reports the crowd
unimplemented and camera=STANDS unknown". We checked today, three ways.

**The page on `otra.city` is the one we described.** `broadcast.html`,
`crowd.js`, `broadcast-cameras.js`, the match module, the venue manifest and
both track files were fetched from production on 2026-09-08 and are
byte-identical to the repository's `main`. The HTML's etag is
`"08710fc346efa44b51695c9b130bf316"`. That build has been the only one served
since 2026-09-04 14:28 UTC; `www.otra.city` and the `vercel.app` alias serve
the same bytes.

**Driven the way your harness would drive it, it does what we said.** A fresh
headless Chrome, no profile, against production:

```
https://otra.city/broadcast?capture=1&camera=STANDS&crowd=0.7&seed=3
    &camtrack=https://otra.city/broadcast/camtrack-example.json
```

```
ready after 5.6 s
state().crowd         { density 0.7, fans 400, seatsOffered 600 }
state().camtrack      { segments 4, lastFrame 1750 }
state().unimplemented []
state().errors        []
note: otra.city broadcast · stadium · camera STANDS · frame 0 … · 400 fans (55 up) · track seg 0 (heli)
```

And with m4 mounted (`&bundle=…/s3-m4_frontier_fable_frontier_muse-…`):
`ready` after 11 s, `state().match.phase === "match"`, 388 draw calls, the
arena on the pitch, 400 fans, no errors, nothing unimplemented.

**The two messages you quote are the 4 September build's, verbatim.** That
page — the one `REPLY.md` described, before the crowd and the cameras existed
— said exactly `crowd (§6) — the stands are empty geometry; nobody is seated`
and `unknown camera "STANDS" — one of approach, roundabout, gate, …`. Those
strings no longer exist anywhere we serve. So whatever your harness is
loading is a copy of that page: a saved HTML, a proxy holding it, or a warm
browser profile that is not revalidating (`cache-control` on the page is
`max-age=0, must-revalidate`, so a well-behaved cache cannot keep it). Two
commands settle it from your side:

```
curl -sI https://otra.city/broadcast | grep -i etag
curl -s  https://otra.city/broadcast | grep -c crowd.js      # 1 = current build
```

**So this never needs a conversation again:** the page now reports which
build it is. `state().build` (also `window.rflBroadcast.build`, and `build …`
on the note line at the bottom of the frame) is the date the page's behaviour
last changed — `2026-09-08` once this lands. Assert on it in your harness;
a copy from before today has no `build` field at all, which dates it by
itself. This is on a branch as we write and goes live when merged; we will
say when.

The 25–28 September friendlies can be filmed on production as it stands.

## 1. Your question 1: one channel, with the division on the item

**One channel, please.** The stadium subscribes to exactly one programme feed:
its match module calls your SDK's `schedule("rfl", …)` and everything on the
pitch, the docks and the scoreboard follows that one feed. The 20:00 UK slot
is already the channel's third slot, so a duck fixture published into it
plays with no change on our side. A second channel would mean either a second
match module fighting the first for the same pitch, screens and scoreboard,
or a merge of two feeds that we would have to write and you would have to
keep consistent.

One request with it: **put the division on the programme item**, not only in
the title — a `division` field (`"g1"` / `"microduck"`), and if you like the
same `platform` and `scale` provenance you are adding to `scene.meta`. Our
scoreboard prints the item's title today; a field lets us label the board
without parsing a title, and lets a listing filter without guessing. Keep the
division in the title as well — that is what people read.

If the 4DGSX site would rather show two listings, that is its listing; the
feed the stadium reads should stay one.

## 2. Your question 2: G1 assumptions — none found, and here is what we looked at

The addendum names the four places an assumption would hide. In order:

| where it would hide | what our side actually does |
|---|---|
| body names (`r{i}_pelvis`) | our match module never opens `scene.json`; the SDK does. The SDK as served today resolves anchors by `bodies.indexOf(hud.players[].anchor.body)` — the name comes from your `hud.json`, nothing is hard-wired. |
| label offsets / heights | the SDK places each nameplate at the anchor's own `offset`, from `hud.json`. We do not draw labels. |
| ball radius | nothing on our side references the ball — not the cameras, not the sightline check, not the crowd. The bundle's own mesh is what renders. |
| robot count | teams and players are iterated, never counted. The scoreboard prints two team codes and the score; the line-up is your dock. |
| track and version fields | `scene.version`, `specVersion` and the new `meta.platform` / `meta.scale` are read by nobody on our side; the SDK we load has no version gate we could find. Must-ignore holds by construction. |
| cameras | the built-in shots aim at fixed points 0.5–0.6 m above the turf — a 1.0 m subject sits in frame as a 1.3 m one does. `TRACK` passes your per-frame state through untouched. |
| ids | nothing keys on `s3-m<k>`; `s4-d<k>_…` is just a string to us. |

A caveat, stated plainly: we *read* your SDK (the 32 KB build at
`4dgsx.com/sdk/v1/three.js`) for these; we have not *run* it with a duck,
because there is no duck bundle yet. The day the 24 September test bundle
lands we will run our gate with it — two independent browser processes,
byte-identical or not — and tell you the hash.

**Two things did have to change, both ours, both done:**

- **The scoreboard never measured what it drew.** Your season-4 title format
  is half again as long as season 3's: `RFL S4 · Microduck · Match 12:
  Singularity United vs Synthetic Athletic` measures **1,282 px** on a
  1,024 px board, and the two longest club names already ran past the edge and
  into the score. The title, club-name, next-kick-off and last-result lines
  now shrink to fit their width and ellipsise past a floor. Verified on the
  board with m4 mounted.
- **The line-up plate under the right dock read "two-a-side · four robots".**
  It shows between matches, when your dock is not attached. It now reads
  "home and away squads", which is true for both divisions. That is a rebuilt
  `venue.glb`; every venue check passes on it (600/600 seats reachable, the
  shimmer measure at 0.054 %, budgets unchanged).

Two small things while we were in there: camera names are now
case-insensitive (`camera=STANDS` was already fine; the authored views in the
manifest now answer to capitals too), and `camera=TRACK` without a
`camtrack=` says so instead of "unknown camera".

Nothing about S. You said nothing on our side should depend on it, and
nothing does — if it moves before 25 September we would like to know only so
the friendlies' footage and the season's agree.

## 3. Your question 3: bundle geometry, as for the G1

**We will take the duck's geometry from the bundle and render it as-is**, the
way the G1 renders today. The voxel restyle was never built for the G1
either, so this is not a new decision so much as the existing one applied.
The 0.28 m ball keeps its radius by the same mechanism: we draw what the
bundle says.

> **[ROBIN — art call.]** If you want a restyle for either robot, this is the
> moment to say so, before a season pins the look. One thing to weigh
> alongside taste: Pollen's 3D files are **CC BY-SA-NC**. The stadium carries
> advertising hoardings and the city is a place projects pay to stand in; a
> non-commercial licence on geometry rendered under those hoardings is a
> question for you, not a detail for us. Taking the bundle's own meshes avoids
> it entirely.

## 4. Nothing else in the stadium changes

Same pitch, walls, goals and cameras; the `gantry` sightline is re-verified
against the marked 14 × 9 area on every CI run and does not know a match is
on. The crowd, the cut-list and the determinism gate are unaffected: both
configurations CI runs pass on this branch (15/15 ambient, 18/18 with crowd
0.7 and the example track, two processes byte-identical at frame 250 and 400).

## 5. The season pin — this one is a commitment, so it is Robin's

Your addendum treats "the pinned stadium version per season" as an existing
thing that now covers both divisions and runs ~45 days. To be exact about what
exists: **there is no version parameter.** What `REPLY.md` §5.2 proposed —
bowl pinned, skyline live — was a proposal, and the pin, if we make it, is a
promise that the bowl does not change between the first friendly and the last
match, not a mechanism your harness can select.

> **[ROBIN]** Season 4 is 2 October to about 16 November, with friendlies
> from the 25th of September. Confirming the pin means the `venue.glb` in
> this branch is the stadium until mid-November — no fixes to the bowl in
> that window, however tempting. The alternative is to build
> `?stadium=<version>` (a small change: the venue is one GLB with its own
> manifest), which lets the bowl move under everyone else while RFL keeps
> filming the pinned one. Say which. The SDK is yours and loads unpinned from
> `4dgsx.com/sdk/v1` at runtime — that pin is on your side.

## 6. Timeline, from our side

- **~24 September, test bundle.** Send the URL. Same day we run
  `broadcast-check --bundle <it>` and reply with the two-process hash and a
  frame from `STANDS`, `PITCHSIDE` and the gantry.
- **25–28 September, friendlies.** Production is filmable today (§0). If the
  pin is confirmed, the stadium those are filmed in is the season's.
- **2 October, 20:00 UK.** Nothing scheduled on our side; the stadium takes
  what the feed publishes.

## 7. What we need from you

1. The test bundle URL when it exists.
2. `division` on programme items (§1).
3. The standing items from `REPLY-3.md` §6: a real camera track generated
   from a match, and the furniture-only bundle if you still want the arena on
   the pitch between matches. Ambient mode is an empty pitch until then.
4. Credit wording. [ROBIN]
