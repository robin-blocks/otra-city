# otra.city Stadium — state

_Last update: 2026-09-03 (M1 MERGED as PR #30 and live on otra.city; critic pass 1 done, its blocking findings fixed on `claude/stadium-critique-fixes`)_

## Pitchside banners — 2026-09-23

**Live, verified 2026-09-23 at 15:39 London.** Robin approved the local
preview and requested deployment. Commit `ff025a7` was rebased on current
`main` (preserving the newer goal-celebration work and PromptOps submission)
and pushed through the normal Vercel integration. No fixture was active;
the next programme starts at 16:01:42 London, outside the 15-minute hold.

- [Vercel deployment](https://vercel.com/robinblocks/otra-city/2eJJLRGikc23rtjU19t6ZQ2KPaVW)
  succeeded. SHA-256 of the live `venue.glb` and `venues.js` exactly matches
  the committed files; the GLB hash is
  `d38cc36bd13ba9d9be0871d5ba3b2e5abc154912bf56d81b8a443753030b44fd`.
- Production browser check: both blue/yellow halfway boards visually verified,
  unlit material and 8× filtering confirmed, no console/page errors.
  Evidence: `qa-out/stadium-banners/production-{blue,yellow}.png` and
  `production-check.json`.
- Post-rebase local gate: 46 tests passed (hoardings, goal celebration, match
  clock, programme), plus strict venue manifest check. Docs-sync CI passed;
  [venues CI](https://github.com/robin-blocks/otra-city/actions/runs/35875608580)
  and [city walkthrough CI](https://github.com/robin-blocks/otra-city/actions/runs/35875608600)
  were still running at production verification; not claimed as passed.

Robin reported hard-to-read pitchside text and asked for `OTRA.CITY STADIUM`
on the centre boards in front of both the blue and yellow stands.

- **Cause:** 1024×56 artwork (18.3:1) was squeezed onto ~7:1 faces. Long
  slogans became narrow strokes, and four equal touchline panels left a seam
  at halfway rather than a centre board.
- **Fix:** each touchline now has an 8.4 m centre name board and two 6.3 m
  partner boards. The end-wall boards carry `BUILT BY AGENTS` and
  `OTRA.CITY/CLAIM`; partners read `4DGSX` and `RFL.FOOTBALL`. Bold white text
  on near-black, with small accent tabs instead of fine coloured frames.
- **Rendering:** `poc/stadium/hoardings.py` shares layout/copy between the
  artwork generator and Blender. A dedicated 1024px atlas is rasterised at
  the actual face proportions, with mipmap gutters. The ring is one unlit
  mesh; `venues.js` enables up to 8× anisotropic filtering for oblique views.
  The existing 10 mm backing clearance and collision envelope are unchanged.
- **Cost:** rebuilt `venue.glb` is 1,361,556 bytes (+32,240 bytes), 23
  primitives (+1), nine materials; still within all venue budgets. No changes
  to the publisher's inner RFL arena boards, match code, or live programme.
- **Verification:** four `node --test scripts/stadium-hoardings-check.mjs`
  checks inspect the shipped GLB (embedded atlas, UV coverage/aspect, readable
  type size, gutters, one upright/inward/centred name board per stand).
  Included in venues CI. `venue-check` additionally checks unlit material
  and device-capped filtering. Full venue check passed: 600/600 seats reachable
  and escapable, stable GPU memory over two unload cycles, no page errors,
  depth-overlap probe within budget.
- **Visual evidence:** `qa-out/stadium-banners/` holds before/after blue and
  yellow gantry views, an oblique pitchside view, and both sides with a real
  s3-m1 replay mounted (SDK ready, no errors). All reviewed in-browser at
  1280×720. These are local QA files, not public site content.

Rebuild: `python3 poc/stadium/textures.py`, then
`python3 poc/stadium/run.py --headless`. Run the shipped-asset test above and
`node scripts/venue-check.mjs --venue stadium` after rebuilding.

## Milestone
**M1 — foundations + stadium + match integration.** In progress on branch
`claude/otra-city-stadium-f817f1`, nothing merged.

| Component | Status | Evidence |
|---|---|---|
| World layout (`world.js`), reserved lots | Verified | fixture + city: bounds contain boulevard/roundabout/stadium, fence north of lots; `build-manifest` skips x ≥ 48; `npm run validate` green |
| Roads (`roads.json` + `roads.js`) | Verified (seen) | shots `stadium-approach.png`, `stadium-mast_night.png`; city spawn view shows the totem and the crossing |
| Venue streamer (`venues.js`), doors, quiet zones, dynamic colliders | Verified | `venue-check`: tier cycle 0→1→2→0 twice, GPU memory steady, colliders removed, no page errors; city walkthrough: tier 0 at spawn, T2 on the forecourt, west gate opens at 3 m, quiet zone registered |
| Fixture + scripts (`venue.html`, `venue-check/shot/bench`, `build-venues`) | Verified locally | `poc/out/venue-check.json` all PASS incl. `--match`; `poc/out/shots/`; `poc/out/venue-bench.json` |
| CI (`venues.yml`) | Implemented, NOT run | needs a push to run; the docs-sync and validate-plots workflows are untouched |
| Stadium asset (Blender lane `poc/stadium/`) | Verified | 22k tris, 22 prims, 8 materials, 6 lights, 600 seats all reachable, impostor 192 tris; budgets PASS; shots reviewed by eye (turf green after the ground-plane fix) |
| Match module (`match-4dgsx.js`) | Verified | headless contract PASS; real GPU browser: SDK from 4dgsx.com, replay mounted, video 1280×720 decoding on `screen_main`, HTML panels rasterised on the side docks, scoreboard from hud ("RMA 0-1 SGU 9:07"), audio enabled on the first click; mobile emulation: countdown only, no SDK, no iframes |
| /stadium route, HUD link, spawn, /about section | Implemented; spawn verified via `?venue=stadium` locally | Vercel rewrites only testable after deploy |
| Impostor from spawn | Verified (seen) | city spawn screenshot: four flood heads over the boulevard's end |
| Presence M2 (zone peers, instanced avatars) | Not started | — |
| Visual-regression pixel diff (PROJECT §7) | Not implemented | shots exist; no diff script (no PNG decoder in the repo) |

## Critic pass 1 (docs/stadium/CRITIQUE-1.md) and what it changed
The critic scored the merged build against §9 and found all six blocking
criteria passing, but named three usability defects it judged release-blocking
for the main use case. It was right about all of them, and about five more.
Verified each against the source before acting; fixed on
`claude/stadium-critique-fixes`:

| # | Finding | Fix | Evidence |
|---|---|---|---|
| 1 | The seated chase camera ends up inside the stand — no camera occlusion anywhere in the city | `player.js` casts three rays from the visitor to the lens (one ray threads the gaps between treads and reports a clear view from inside a terrace), pulls in at once, eases back out, and remembers the distance the visitor chose | in a row-4 seat the camera went from 4.6 m buried in the terrace to 2.09 m clear, 1 of 6 probe directions blocked (the floor); the boulevard is untouched (`pulled: false`, camera distance unchanged) |
| 2 | `/stadium` spawned the visitor inside a lamp post; 150 frames of walking moved them nowhere | a roundabout arc wider than 1.2 rad gets two lamps at thirds instead of one at its midpoint, which is exactly the line people walk; spawn moved 1 m east | lamps now at (70.8, ±2.8), none within 2.5 m of the gate axis; a real `PlayerController` walks 72 → 78 and through the gate |
| 3 | The first frame at `/stadium` was a wall | spawn on the gate axis at (72, 0) with the camera clear of the roundabout totem | `shots-city/spawn-stadium` |
| 4 | `panel_right`'s idle plate was overwritten by hoarding strips and gate signs | media plates are no longer atlas regions at all — each is its own image, which is what a full-UV media node needs; the atlas was relaid with an overlap assertion | `poc/stadium/plate_panel_right.png` reads LINE-UP; a script asserts no two atlas regions overlap |
| 5 | No artifact showed the broadcast or the dock panels rendering | the `screen_main` camera was aimed at the scoreboard (the big screen is at +z, not −z); fixed, and a `scoreboard` camera added | `shots/stadium-screen_main.png` shows the screen with LINE-UP and GAME STATS legible either side |
| 6 | The stair balustrade was a 3.75 m solid slab hiding the stair and the block letter | a 1.05 m rail that steps with the stair, with a lit cap; the collision proxy stays a full slab so nobody walks off | `shots/stadium-gate.png` now shows the stair through the gate |
| 7 | A failed SDK import was cached forever, contradicting ARCHITECTURE §6 | the rejected promise clears itself | `match-4dgsx.js` |
| 8 | The east gate was neither door nor wall and read WEST GATE | declared in `venue.json`, so it opens and collides; one sign region per gate | check: `gates passable — west:ok, east:ok`, 2 gates registered |

Also from the improvements list: the outer wall grew pilasters and a dim band
(it read as a black slab from the road), the impostor carries its lit top edge
so the far read is a stadium silhouette rather than four dots, and the
scoreboard's type no longer collides at two digits.

**New regression guard**: `venue-check` now asserts the spawn has an avatar
radius of clearance. A flood fill works on cell centres and cannot see a 0.14 m
post, which is exactly how the lamp-post spawn survived a green check.

Not fixed, and why: the roads' ~85 unmerged boxes (measured 299 draw calls at
the boulevard spawn against a 400 budget — real but not pressing), the bowl's
brightness against the city's darker look (a taste call for Robin), and the
soak, mocked-feed and visual-diff gaps in verification.

## Invisible wall between the boulevard and the stadium (reported by Robin, fixed)
Robin could not walk from the stadium back to the main road. Reproduced by
sampling `world.contains` along the axis: a **1 m band at x 40.25–41.25**
belonged to no shape. The boulevard's walkable box ends at `street.bounds.x`,
which is deliberately 2 m INSIDE the end of its own asphalt (#28's kerb), while
a road segment's corridor only ran 0.5 m past its start node at the asphalt's
end. The two met without overlapping.

Road corridors now run 3 m past each end (the 2 m kerb plus a margin), so a
road that joins another walkable area overlaps it. The axis is continuous from
x 34 to 80, and a real `PlayerController` walks the boulevard → roundabout →
forecourt → tier 2 without stopping.

Found while verifying: a visitor walking the centre line climbed the 0.3 m
roundabout kerb (under the 0.35 m step) onto the island and jammed against the
planter. The island kerb is now 0.45 m, above step height, so you flow around
it the way a roundabout is meant to be walked.

**New regression guard**: `venue-check` asserts `reachable from the city spawn`
— it samples the walkable fence along the route a visitor actually takes.
A flood fill inside the venue cannot see a seam in the fence outside it, which
is why this shipped green.

## Robin walked it (2026-09-03) — four things a green check had not caught
He reported them from the live city; all four were real, and all four are
fixed in `poc/stadium/build.py` and the client, with the venue rebuilt:

| what he saw | what it was | fix | evidence |
|---|---|---|---|
| "when the stadium doors open, the central column stays put but people just walk through" | the outer wall's pilaster rhythm (`wy = 0`) put a 0.7 m pilaster in the middle of the GATE, where there is no wall to pilaster — and being decoration it had no collision | pilasters skip any band within the gate opening | `shots/stadium-gate.png`: the opening is clear through to the stair |
| "would it create problems if the doors opened for other players too? … other players appear to walk through the doors" | `doors.update` only ever saw the local player, so a peer walked through closed glass | doors take EVERY position the city knows (`[player.pos, ...presence.positions]`); `presence.positions` is new | a peer alone at a shop door: open01 0 → 1 → 0 when it leaves |
| "on the entrance to the stands, there's a horizontal bar blocking the way (even though you can walk straight through it)" | the parapet's light strip was drawn across the full width INCLUDING the doorway, at 1.05 m above the gangway — and the doorway has only a floor, so you walked through it | the strip stops either side of the doorway | fixture shots `doorway-from-stair`, `doorway-from-gangway` |
| "the steps in the stands are possible to descend but not ascend" | the terrace's half step is 0.25 m deep and an avatar has a 0.28 m radius, so it could never stand on one: the next row's face blocked every ray. You arrived from the rear stair at the top and could never get back up | in the AISLES — the way up a real stand — the half step is carried forward to 0.5 m, making each row two ordinary 0.25 m steps | a real `PlayerController` walks row 0 (y 1.0) to the rear gangway (y 4.0) and back down; through the seats it still cannot climb, which is right |

**New regression guard, and it took two attempts.** The first (a step up must
have a landing wider than a body radius) did not fail the old build, because
the fill only ever went DOWNHILL into the terrace — every seat really was
reachable. What was wrong is that it was a ONE-WAY TRIP. `walkability` now
runs the fill twice, forwards and backwards, testing each edge in the
direction it would really be walked, and `venue-check` asserts every seat can
be LEFT again. Against the old `venue.glb`: **100/600**. Against the new one:
600/600.

## The build no longer needs a Blender window
`poc/stadium/run.py` picks its lane: the BlenderMCP bridge when a Blender
session is listening on 9876, otherwise a HEADLESS `Blender --background`
(`--bridge` / `--headless` force one). The headless lane rebuilt the venue
faithfully — same 22 primitives, same 600 seats, `venue.json` unchanged, only
`venue.glb` moved (1,320,084 → 1,325,424 bytes, the aisle steps) — so a
terminal session, or CI, can now fix venue geometry.

## Rebase onto main (#28 street growth, #29 one static host)
Both landed while this branch was in flight and both overlapped it:
- `player.setBounds` exists on main taking a `{x, z}` box; this branch needed a
  predicate for a world that is no longer a rectangle. Resolved by accepting
  **either**: `inBounds` handles a box or a function, main's default box stays,
  and the city passes `world.contains`.
- The boulevard's extent is now the STREET's (`street.bounds`, derived from the
  land registry). `world.js` no longer re-derives it — it takes `street` and
  builds its fence from that, so the two cannot disagree. `world.reach` sizes
  the ground plane and far plane over every shape, keeping #28's growth
  behaviour for a long street and covering the venue as well.
- `lib/static-server.mjs` is main's one static host; the harness's duplicate
  copy was deleted in favour of it (that refactor's whole point).
- `launchChrome` keeps main's `args` passthrough **and** this branch's `gpu`
  flag.

## m42 AIRED FROM THE STADIUM — 2026-09-17, the first one

The 19:01:42Z fixture (s3-m42, Synthetic Athletic v Singularity United) went to
Twitch **from the stadium**, not from a rendered mp4. First time either side has
seen it. The box's slot timer was `disable --now`'d so it could not stand the
minipc's stream down, and the capture browser simply carried what the stadium
did.

Measured on the capture browser itself, through RFL's CDP:

| | |
|---|---|
| mount | `{ seen: 63897, adopt: 345, up: 64241, docAge: 28843, ours: true }` |
| 19:03:10Z | tag `Kick-off`, clock `01:32`, matchT −91.8, preroll true, live true, drive `wall` |
| | programmeT **88.199**, audioOffset **88.199** — the same second |
| premix | 19:02:49Z "no audioOffset yet (0s), waiting" → 19:02:51Z "offset 69.26s via state().scorebug.audioOffset" |

The clock reading `01:32` at 19:03:10Z puts kick-off at 19:04:42Z, which is
`startsAt + 180.00`. The programme drive (#98) is confirmed on air.

**The grace period earned itself on its first outing.** RFL's supervisor asked
for the offset two seconds before the page could answer, waited rather than
guessing, and then took 69.26 s. Under the code it replaced it would have
started the premix at 180 s — the kick-off call — two minutes early, and never
corrected it.

**Of the 64 s to the picture, 0.345 s was ours.** ~29 s was the programme feed
being served stale at the read (`docAge`), and the rest was 292 MB of bundle.
Both are written up and neither is in this repo: `docs/4dgsx/SCHEDULE-MOUNT.md`
for the cache, `docs/broadcast/REPLY-13.md` §6 for the 157 MB
`media/broadcast.mp4` that `/broadcast` never shows.

### What Robin saw, and the two clocks behind it
"The countdown got to 0 and nothing happened." True, and it was not one bug.
The board counted to the feed's `startsAt` — the STREAM start, programme time 0
— while the mounted card counts the match clock backwards, which is the
WHISTLE. So the number hit zero at 19:01:42, sat there over a bare pitch for
64 s, and then jumped FORWARD three minutes when the picture arrived. Two
clocks, one number.

Both now count to the whistle (`kickOffIso`), so it ticks through the mount
without a jump and reaches zero when the ball is kicked. And the worse half:
the moment the channel flips a fixture to `live`, `state.next` becomes
TOMORROW'S — so during that same minute the screens were about to count down to
a match sixteen hours away. `screenFixture` prefers a live fixture that is not
on our pitch yet. `state().match.kickOff` reports the instant, and the gate
asserts the gap to `streamStartsAt` is the publisher's pre-roll.

**Still owed on the RFL side:** m42 is not in `broadcast.json`'s `streamed`, and
`rfl-broadcast.timer` is disabled — both deliberate, both must be undone
together or the next slot airs m42's mp4 again. The proper stadium slot mode
(the box leaves the minipc up, sets the title, waits out the programme, then
`mark_streamed`) is sketched in rfl-station's orchestration doc and not built.

## The stadium keeps the slots, and stands empty between them (2026-09-17, Robin)

`public/broadcast/now.json` is `null`. The city no longer shows a replay for
the twenty-two hours that are not a fixture: the pitch is bare, the big screen
counts down to the next kick-off, and the side panels carry the fixtures and
the results. Robin's call, for the 19:01:42Z slot.

What it buys, beyond the obvious: the pitch is EMPTY when a fixture arrives, so
`adoptScheduled` has nothing to tear down first; nobody downloads ~320 MB to
watch yesterday; and `/broadcast` can take a pending deploy in the hours when
nothing is on, instead of waiting for a seam inside a looping replay.

**And it took the CI gate's teeth with it, which is the part worth remembering.**
Every assertion `broadcast-check` makes about a mounted match — the arena
boards, the tone-mapping rule, the bodies, the crests, the forced goal replay,
the rehearsed live fixture — is read off the LIVE page, and the live page mounts
whatever `now.json` names. With `null` there, all of them degrade silently to
printed notes. So the gate now serves the live page **its own** `now.json`
(`--now latest`, a one-file overlay on the harness's static host) and CI passes
it: what the city shows and what the gate tests are no longer the same decision.

### The commentary follows the programme, not the match clock
`program.map` and `audio.map` are the SAME array — read off s3-m41, 29
breakpoints each, and RFL's exporter (`gauntlet/volumetric.py: export_audio`)
hands one to both. So programme time IS stem time, and that is the only
unambiguous number: RFL's broadcast stops the match clock and lets the tape run
on in two places — the three-minute build-up, where the whole pre-roll answers
to match t = 0, and every goal, where `replay_s` seconds of replay answer to the
instant the ball crossed the line.

The venue's PA was being positioned by mapping the match clock FORWARD, which
has to pick an edge of such a span. Through every goal hold it returned the same
second while the element played on, and `sync` hauled the playhead back to it
every 0.35 s — a stutter over every goal call in the match, for anyone standing
in the bowl with sound on. `stemSeconds()` in the module is now the single
source for both the PA and the `audioOffset` we publish, and `pa.stemT` reports
where the tape is being driven to even while silent, so the two can be seen to
agree from outside. Guarded in `venue-check --match` (a rehearsed live fixture
polled across its first goal) and in `broadcast-check` (the offset must run on
while the match clock stands still).

`/broadcast` deletes the `pa` block, so none of this is the stream's sound —
that is RFL's premix, and §2 of `docs/broadcast/REPLY-13.md` is where it goes
wrong.

### A fixture holds a deploy for its whole programme
The ETag self-updater waited for any seam that was not live play. A replay's
seams are cheap; a fixture's are its build-up and its half time, and a reload in
either is not a four-second black — the page comes back with an empty pitch and
refetches the bundle, measured at ~100 s on 2026-09-15, which is longer than
half time. A scheduled fixture on the pitch (`drive: 'wall'`) now holds the
change for its whole programme, as does the fifteen minutes before one starts;
`state().updater.holding` says which.

### Measured on production, and it is the number RFL are missing
2026-09-17, build 2026-09-15b, m39's replay in its pre-roll:

| | programme | `audioOffset` | `<video>.currentTime` | `match.score.t` |
|---|---|---|---|---|
| 16:13:33.9Z | 19.7 s | **19.724** | 180.377 | 0 |
| 16:14:28.1Z | 73.9 s | **73.892** | 180.106 | 0 |
| 16:15:22.5Z | 128.2 s | **128.233** | 180.118 | 0 |

`stadium_audio.py` positions RFL's premix from the first `<audio,video>` element
on the page, falling back to `scene.audio.map` at `state().match.score.t`.
**Both answer 180 — kick-off — for the whole build-up.** The element is the
SDK's media dock for the bundle's `media/broadcast.mp4`, driven from the stage's
clock, and the stage's track only covers the match, so it clamps to the first
frame through the pre-roll; `score.t` is a score STEP, the time of the last
goal, which is 0 before the first one. A premix started at the mount therefore
opens with the kick-off call and, running uncorrected on the wall clock, stays
that far ahead all match. `state().scorebug.audioOffset` is exact at every point
of the programme, holds included.

And the element freezes again at every goal — sampled at 200 ms through m39,
the match clock held at 43.4 s while the programme ran 228.35 → 233.35 and the
video moved 228.32 → 228.33, because it is driven from the match clock as well.
Worst error over that window 5.02 s; in open play it is good to 0.15 s, which is
why this has been invisible. Written up as `docs/broadcast/REPLY-13.md`.

Also visible in that measurement: `/broadcast` reserves the big screen for the
live feed, so the publisher's `main` dock is never attached — and the SDK builds
its video element anyway (`readyState 4`, so it is fully fetched). That is 157 MB
of a 292 MB bundle decoded for a surface nobody sees, and `mount()` has no way to
decline it. A 4DGSX ask, in REPLY-13 §6.

## Decisions
- 2026-09-02 Q1 placement: east end on the boulevard axis; lots x ≥ 48 reserved (Robin).
- 2026-09-02 Q2 idle: countdown board only, no replays on the live site (Robin). Replays are fixture-only.
- 2026-09-02 Q3 crowd: seats for 150 now, 32-nearest rendering; zone peers + instanced avatars = M2 (Robin).
- 2026-09-02 Q4 performance: culling/LOD/tiered streaming, full load/unload, generic reusable venue system (Robin's direction); numbers as proposed: ≥50 FPS median 1080p M-series, ≤400 calls, ≤300k tris, ≤40 lights; match only on fine-pointer devices.
- 2026-09-02 Q5 match cost accepted; progressive track streaming logged as a 4DGSX follow-up.
- 2026-09-02 Q6 SDK imported at runtime from 4dgsx.com/sdk/v1; the stale CORS note on /sdk is a note for Splat.
- 2026-09-02 Q7 bowl ~52 × 46 m for a 24 × 18 m stage, ~200 seats, 4 masts, 2 screens + 2 panels, voxel language.
- 2026-09-02 Q8 `/stadium` route; not in /api/plots.
- 2026-09-02 Q9 roads: roundabout at the boulevard's end, short approach, forecourt, drop-off bays, crossings, lamps, signage; ring road/parking deferred.
- 2026-09-02 Q10 Robin merges/deploys; the session launches Blender.
- 2026-09-02 Placement numbers (architecture): pitch centre at world (100, 0); footprint x 74…126, z ±23; roundabout centre (60, 0) outer r 9 / island r 4; short avenue x 42…51; forecourt x 69…74; west gate at x = 74.

## Assumptions
- See `docs/venues/ARCHITECTURE.md` §9.

## Test results
- 2026-09-02 venue-check (build 2): 33 checks, 1 FAIL (seats reachable 0/684). Tier-1 worst camera 129 calls / 22.7k tris (approach); tier-1 scene lights 14.
- 2026-09-03 venue-check --match (build 5, stands shortened, floor-layer flood fill): **ALL PASS** — 600/600 seats reachable, gates ok; match contract: SDK + replay bundle mounted in 6 s, docks main/left/right attached, screen_main = VideoTexture (glTF-oriented), scoreboard "RMA 0-0 SGU 9:58" from hud, 342 draw calls with a match (max 480), mute silences the stage, dispose leaves 0 iframes / 0 videos, GPU memory steady over two cycles (187→188→188 geometries: the +1 is three.js's shared Sprite geometry, allocated once). Report: `poc/out/venue-check.json`.
- 2026-09-03 venue-bench (GPU, Apple M3 Pro, 1920×1080, tier 2 with a replay): approach 3.0 ms median (333 fps), gate 3.6, concourse 3.7, stand_low 3.9 (256 fps, 411 calls), stand_high 3.9, pitchside 3.2; p95 ≤ 7.0 ms everywhere. Target was ≥ 50 fps median. `poc/out/venue-bench.json`.
- 2026-09-03 after the rebase, re-run on the merged tree: `npm run validate` green, `venue-check --match` ALL PASS, GPU memory now returns to the exact baseline over three cycles (31 → 31 textures) after the material-restore fix below.

## Scores
_none yet_

## Open issues (ranked)
1. Nothing committed or pushed; CI (`venues.yml`) has never run — Robin decides on the PR.
2. Critic pass 1 (docs/stadium/CRITIQUE-1.md) pending; its ranked issues go here.
3. Visual-regression diff from PROJECT §7 not implemented (deferred: no PNG decoder in the repo; shots are kept for eye review and CI artifacts).
4. ~~Live kick-off never observed end to end~~ **DONE 2026-09-15.** RFL watched the deployed `/broadcast` through m35's 19:01:42Z premiere from an ordinary browser: the stadium left the m33 replay, mounted `s3-m35` at 19:03:22Z on the programme clock, kicked off in sync at 19:04:42Z, scorebug live, director cutting pre-roll → gantry, zero errors and zero label resizes. **First scheduled mount either side has seen on the deployed page.** The 100 s between `startsAt` and the mount is the subject of `docs/broadcast/REPLY-12.md`: the mount's critical path is 38 MB of a 290 MB bundle (the video and the audio stems stream in behind the stage), `sdk.schedule()` re-arms for `startsAt + 0.5 s` so `pollS: 60` never delays it, and the programme feed is served stale — measured at 60.0 s and 93.0 s old on two cold page loads, which `msUntil` then reads as clock skew and sleeps off. `state().match.mount` now records `{ seen, adopt, up, docAge }` so the next one answers this itself.
5. 4DGSX follow-ups for Splat — written up as one letter, `docs/4dgsx/SDK-LABELS.md`, **SENT by Robin 2026-09-15** (with `docs/broadcast/REPLY-11.md` to RFL): the shout-bubble bug in `labels.ts` (with the three-line patch and a reproduction); the /sdk page's stale CORS note; progressive track streaming (39 MB before first frame). **4DGSX and RFL are different counterparties** — RFL is a producer publishing onto the format, not the SDK's maintainer, and told us so on 2026-09-14 after we sent them an SDK bug. Address SDK matters to Splat. The patch in §5 is against `robin-blocks/4DGSx` `site/lib/player/three/labels.ts`, which Robin owns and we have admin on — it went as a letter rather than a push because that repo is another agent's workspace and `/sdk/v1/` is unpinned. **THE FIX SHIPPED THE SAME DAY.** The SDK's ETag moved from `80c1239f6a39d51bf55e56baaec2a869` (32,171 B) to `2647a89a287b2fc7f4ef6db207bcabbb` (32,241 B) within hours of Robin sending the letter, and the new label setter disposes on a size change — `h=`${o.width}x${o.height}`, … h!==`${o.width}x${o.height}`&&a.dispose()` — which is our patch. Nothing else in the build changed: 3 sprites, 3 meshes, PanelLayer, attribution and fixture board all intact, +70 bytes. **So `refitLabels` is now redundant and can be dropped** — both sides dispose on the same condition, which is harmless but duplicated work; drop it only with `venue-check --match` still green. The way to watch: `curl -s https://4dgsx.com/sdk/v1/three.js | md5` equals the ETag, because the ETag IS the body's MD5 (RFL verified this independently 09-15). `last-modified` there is the edge's fetch time and lies.

## Resolved
- **A texture leaked per load/unload cycle** (found by the post-rebase check, then by registering every texture the renderer gave GPU resources): the match module replaced each screen's material and dropped the original. Once the scoreboard painted over its map, the venue's own plate texture was reachable only through that orphaned material, and venue disposal walks the scene graph — so nothing ever freed it. The module now RESTORES each original material on dispose and drops only its own. Three cycles: textures 31 → 31 → 31.
- Walkability reported more reachable "cells" than existed, because the flood fill counts (cell, floor) nodes and a cell can hold several floors. `reachable` now counts distinct cells, `nodes` reports the surfaces, and the check asserts reachable ≤ walkable.
- Seats unreachable → the flood fill took the first hit from above (lintel top = "ground"); rewritten with per-cell floor layers; plus corner passages (stands shortened 1.5 m per end) and stair doorway floors.
- Over-exposure → spots 5.5 kW, cap 12000, gate points 60 W, voxel material roughness 0.97.
- Grey pitch → the city ground plane (y −0.01) sat above the turf plate (−0.02); turf top now −0.005, lines −0.002, under the SDK stage's 0.
- Screen orientation → the SDK never sets flipY; the module forces flipY=false on dock maps each frame.
- Memory "leak" → three.js's shared Sprite geometry (+1 once); assertions now compare two cycles.
- Draw-call budget with a match: measured 342 (the SDK's own ~390 draws are the floor); tier-2 ceiling recorded as 480 in `venue-check`.

## Ownership
- Integration owner: this session (branch `claude/otra-city-stadium-f817f1`).
- Robin: merge, Fly deploy, 4DGSX side.

## Deferred
- M2 presence: zone-aware peers + instanced avatars.
- 4DGSX: progressive track streaming; /sdk page CORS note is stale.
- Ring road, parking, poster for directories, seated pose.

## Blockers
- None.

## Test results (2026-09-03, after Robin's walkthrough)
- `node scripts/venue-check.mjs --venue stadium`: **all pass**, including the new "every seat can be left again" (600/600) and the unchanged budgets (tier 1: 15 meshes, 21,986 tris, 6 lights).
- `node scripts/venue-shot.mjs --venue stadium`: 12 cameras; gate, stair, stand_low and the two doorway shots reviewed by eye.
- Old-asset control: the same check against the pre-fix `venue.glb` fails "every seat can be left again" at 100/600 — the guard sees the defect it was written for.

## Next action
- Two letters written 2026-09-15 evening and **SENT by Robin the same night**: `docs/broadcast/REPLY-12.md` (RFL: the answer to their mount-timing question, the 38 MB correction, our decision to drop their big-screen video panel, the cut-list confirmed) and `docs/4dgsx/SCHEDULE-MOUNT.md` (Splat: the programme's cache lifetime at a changeover, `msUntil` reading cache age as clock skew, and `schedule()` honouring an explicit `scheduled: null` so we can stop mounting every fixture twice — with the patch). **What to watch, and how:** the SDK's ETag is the body's MD5, so `curl -s https://4dgsx.com/sdk/v1/three.js | md5` moving off `2647a89a287b2fc7f4ef6db207bcabbb` means the `scheduled` change shipped — the label fix landed within hours of the last letter. For the cache, `curl -sI https://4dgsx.com/api/v1/programme/rfl` and watch whether `age` still climbs to 30 near a kick-off. Neither went as a push: `robin-blocks/4DGSx` is another agent's workspace and `/sdk/v1/` is unpinned.
- Not built, and promised in REPLY-12 §5.2: when RFL drop the 157 MB `media/broadcast.mp4`, the visitor's big screen has nothing to show and would freeze on the "coming up" card for a whole match. We said we would paint it ourselves — score, clock, the GOAL plate.
