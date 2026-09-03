# otra.city Stadium — state

_Last update: 2026-09-03 (M1 MERGED as PR #30 and live on otra.city; critic pass 1 done, its blocking findings fixed on `claude/stadium-critique-fixes`)_

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
4. Live kick-off never observed end to end (next RFL slots today 16:01/16:02 London); only replays were mounted.
5. 4DGSX follow-ups for Splat: the /sdk page's CORS note is stale; progressive track streaming (39 MB before first frame).

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
- Robin: review and merge `claude/stadium-critique-fixes`. Then observe a live kick-off (RFL slots 12:00 / 16:00 / 20:00 London) — no live match has been watched end to end yet, only replays.
