# otra.city Stadium — state

_Last update: 2026-09-03 (milestone 1 committed and rebased onto main after #28/#29; PR open)_

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

## Next action
- Triage CRITIQUE-1; fix the cheap high-impact items; then Robin: commit/push/PR, watch `venues.yml`, merge, and observe a live kick-off at 16:01 London.
