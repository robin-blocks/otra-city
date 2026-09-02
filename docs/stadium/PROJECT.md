# otra.city Stadium — project prompt (DRAFT v0.1, 2026-09-02)

Status: **decided 2026-09-02 (all ten questions answered); architecture in
`docs/venues/ARCHITECTURE.md`; building milestone 1**. Progress lives in
`docs/stadium/STATE.md`. This document follows the "strong project prompt" structure
(goal → deliverables → scope → constraints → architecture → verification →
workflow → ownership → evaluation → iteration → state → autonomy →
reporting). Every number in it was read from the two repos or the live
services on 2026-09-02, not assumed; sources are named inline.

---

## 0. Open questions (answer these first)

Each has a recommended default. "Defaults" as a reply accepts all of them.

**Decided 2026-09-02 (Robin):**
- **Q1 → A.** East end, on the boulevard axis; lots at x ≥ 48 are reserved so the boulevard grows west.
- **Q2 → countdown only, no replays.** Between matches the pitch is empty and the SDK's countdown board shows the next kick-off. A match is on the pitch only while it is live. Replay bundles are still used in the fixture page for development and tests, never on the live site.
- **Q3 → C.** Seats for 150 now with today's 32-nearest rendering; zone-aware peers + instanced avatars as milestone 2 (needs a Fly deploy by Robin).
- **Q4 → performance-first and generic.** Tiered streaming with full load/unload, an impostor at street level, culling and LODs; the numbers as proposed. The stadium is the first instance of a reusable **venue** system (`docs/venues/ARCHITECTURE.md`) because more large community lots with other functions are expected.
- **Q5–Q10 → defaults.** Accept the match cost (mount at Tier 2 during live matches only); SDK from 4dgsx.com at runtime; bowl and look as proposed; `/stadium` route; roads as described; Robin merges and deploys.

| # | Question | Recommended default |
|---|----------|---------------------|
| Q1 | **Where does the stadium go?** The boulevard is one 84 m strip (x −42…+42); lots sit at x = 0, ±12, ±24 with vacant lots already advertised at ±36, and the allocator hands out ±48, ±60… next. (A) East end, on the boulevard axis: visitors spawn at x = −20 facing east, so the floodlights are the first thing on the horizon; requires reserving lots at x ≥ 48 so the boulevard grows west. (B) A spur road north from the east end (keeps both sides growing, weaker approach). (C) West end, behind the spawn. | **decided: A** |
| Q2 | **What happens between matches?** The RFL channel airs three ~17-minute matches a day (12:00, 16:00, 20:00 London), so the pitch is idle ~97% of the time. (A) Play the latest replay on a loop with a REPLAY tag and the SDK's countdown board for the next kick-off; live matches take over automatically. (B) SDK default: empty pitch + countdown only. (C) Replay only while a visitor is inside the bowl. | **decided: countdown only** |
| Q3 | **How many spectators does a visitor see?** Today the presence server sends each client its 32 nearest peers within 60 m and the client renders at most 32. "150 in the stands" can mean (A) capacity: ≥150 seat spots exist, rendering stays 32-nearest; (B) everyone visible: server sends all peers inside the stadium zone (up to 149) and avatars are re-rendered as instanced meshes (150 avatars × 12 parts would otherwise be ~1,800 draw calls); (C) A now, B as milestone 2. B needs a presence-server deploy on Fly (your credentials). | **decided: C** |
| Q4 | **Performance target and devices.** Proposed: ≥ 50 FPS median at 1920×1080 on your M-series Mac in the benchmark scene (stadium + a replay playing + 32 spectators), ≤ 400 draw calls scene-wide (baseline 221), ≤ 300k triangles (baseline 85k), ≤ 40 dynamic lights (baseline 28). Mobile: walkable stadium, but the match mounts only on fine-pointer devices (the match core is a ~39 MB download). | **as proposed** |
| Q5 | **Match data cost.** The three.js SDK downloads the whole core before the first frame: geometry 12.5 MB + track 23.9 MB + points 2.4 MB ≈ **39 MB per 600 s match**, plus the broadcast video streamed to the big screen (165 MB, ~2.2 Mbit/s) and audio stems on demand (crowd 21 MB, commentary 6 MB). (A) Accept: mount only when a visitor enters the precinct, once per session, with a loading bar on the screens. (B) Ask the 4DGSX side (Splat) for progressive track streaming first (cross-repo). | **A, and log B as a 4DGSX follow-up** |
| Q6 | **SDK sourcing.** (A) Import `https://4dgsx.com/sdk/v1/three.js` at runtime (this is the embed; v1 is immutable-cached; the stadium degrades to "no signal" screens if it fails). (B) Vendor a copy into otra.city. Note: the /sdk page still says third-party origins must "get in touch", but the bundles already serve `access-control-allow-origin: *` (verified today from origin otra.city), so no CORS change is needed — the page text is stale. | **A; tell Splat the page is stale** |
| Q7 | **Bowl size and look.** The RFL stage is a 20 × 15 m tile (14 × 9 m playing area, 0.9 m boards, ~1.2 m robots, 0.7 m ball). Proposed: a ~52 × 46 m open-roof bowl sized for a 24 × 18 m stage, four stands on raised terraces, ~200 seat spots (150 minimum), 4 corner floodlight masts ~18 m, two giant screens (north/south) plus two fascia panels. Look: the city's voxel language (0.25 m massing, palette + emissive neon, finer 0.1 m fascia detail, City Hall's PBR tile trick) rather than a smooth "real" stadium. | **as proposed** |
| Q8 | **Entry and permalink.** (A) A `/stadium` route that spawns on the plaza with an establishing shot, a signpost at the boulevard's east end, and a HUD hint; the stadium is not a lot, so it does not appear in `/api/plots`. (B) Also list it as a pseudo-plot with a poster for directories. | **A** |
| Q9 | **Road scope.** "Realistic road system" = the boulevard continues east into a plaza/roundabout, a two-lane approach avenue with kerbs, markings, crossings, lamps at the boulevard's 12 m rhythm, a drop-off loop and coach bays at the gates, and directional signage. A ring road and parking are deferred unless you want them now. | **as described** |
| Q10 | **Who merges and deploys.** `claude/` branches are not auto-merged; you merge to main. The presence-server change (Q3-B) is a `fly deploy` from your machine. Blender work runs in a dedicated GUI instance I launch. | **confirm** |

---

## 1. Goal

Build **otra.city Stadium**: a first-party, open-roof arena at the end of
the boulevard where the Robot Football League (RFL) plays inside the city,
rendered live by the 4DGSX three.js SDK (`https://4dgsx.com/sdk`).

- **What**: a stadium precinct (bowl, stands, floodlights, giant screens,
  concourse, gates), a road system connecting it to the existing boulevard,
  and a match integration that mounts 4DGSX matches on the pitch,
  schedules them from the public programme feed, and routes the broadcast,
  stats and line-up docks onto the stadium's own screens.
- **Who for**: visitors of https://otra.city (no accounts; desktop and
  touch), the RFL/4DGSX audience arriving via 4dgsx.com, and the agents that
  build lots (the stadium is the city's first venue, so it must feel like
  the same city).
- **Main use case**: walk east along the boulevard, see the floodlights
  over the fog, cross the plaza, pass the gates, climb to a seat and watch a
  match with up to 149 other citizens — live at kick-off, replays between.
- **Technology**: the existing client (vanilla ES modules, three.js r185
  vendored, import maps, no bundler), Blender 5.2 via the BlenderMCP bridge
  for the asset, the 4DGSX SDK v1 (peer `three`, ESM), the Node presence
  server on Fly, GitHub Actions + Vercel.
- **Qualities** (observable): reads as one city (palette, grid, lamp
  rhythm, boards); legible from spawn as a destination; walkable end to
  end without getting stuck; the match is the brightest, clearest thing in
  the bowl; screens show truth from `hud.json`; frame rate holds the budget
  with a match playing; nothing breaks when the feed or SDK is down.
- **Reference**: 4DGSX's own player at 4dgsx.com/watch for match
  presentation; City Hall (`poc/city-hall/`) for first-party build quality
  and the authoring lane; a modern small football ground (steep stands
  close to the pitch, corner masts) for massing.

## 2. Vision vs this milestone

- **Long-term vision**: a district — the stadium as an anchor, side streets
  with lots that sell on match-day traffic, more channels/sports mounted
  on the same pitch, splat rendering when the SDK ships it, VR.
- **Milestone 1 (this project)**: one stadium, one channel (`rfl`), the
  approach road, replay-between-matches, docks on the screens, seats for
  150, verified and deployed.
- **Required**: §3 "Required". **Optional**: §3 "Optional".
  **Explicitly deferred**: §3 "Deferred".

## 3. Deliverables and scope

### Deliverables (artifacts that must exist at completion)
1. `docs/venues/ARCHITECTURE.md` — the generic venue system: subsystems,
   interfaces, data, events, budgets (written before implementation).
2. `poc/stadium/` — Blender authoring lane: `textures.py`, `build.py`
   (idempotent), `run.py`; exports `public/venues/stadium/venue.glb` and
   `far.glb` (the impostor) and folds the seat list into
   `public/venues/stadium/venue.json` (the venue manifest).
3. `public/js/world.js` (world layout + bounds + road graph),
   `public/js/roads.js` (road renderer), `public/js/venues.js` (the generic
   venue streamer: tiers, colliders, gates, modules, disposal),
   `public/js/doors.js` (doors and gates, shared with plots),
   `public/js/venue-modules/match-4dgsx.js` (4DGSX integration), changes to
   `index.html`, `player.js`, `media.js`, `anims.js`,
   `scripts/build-manifest.mjs` (reserved lots), `vercel.json` (`/stadium`,
   `/v/:id`, `/venue`). Presence is untouched in M1.
4. `public/venue.html` — the generic fixture page (any venue, fixed cameras
   from its manifest, deterministic stepping, `window.__venue` API),
   `scripts/venue-shot.mjs`, `scripts/venue-check.mjs` (schema, budgets, node
   contract, tier cycle + GPU memory, walkability, `--match` contract),
   `scripts/venue-bench.mjs` (frame time on a real GPU, local),
   `scripts/build-venues.mjs`, `.github/workflows/venues.yml`.
5. `docs/stadium/STATE.md` — decisions, assumptions, scores, issues,
   blockers, next action. `docs/stadium/CRITIQUE-*.md` — critic reports.
6. `/about` section + HUD hint + east-end signpost; a memory note.

### Required
- Stadium asset: open-roof bowl, four raised stands with ≥150 seat spots
  (0.6 × 0.8 m cells, risers ≤ 0.35 m, treads ≥ 0.5 m, ≥0.9 m aisles),
  concourse, ≥2 gates using the city's auto-door standard, 4 floodlight
  masts (emissive heads + SpotLights), 2 giant screens (`screen_main`
  16:9 for the broadcast dock; `screen_score` for our own scoreboard),
  2 fascia panels (`panel_left`, `panel_right`, aspect 0.68 for the
  stats/line-up docks), invisible `col_*` collision proxies, a 4DGSX
  attribution spot near the pitch.
- Roads: plaza/roundabout at the boulevard's east end, approach avenue,
  drop-off loop, kerbs, markings, crossings, lamps, signage; colliders.
- Client: world bounds beyond ±40 m, fog/camera far adjusted so the
  stadium reads from spawn, stadium colliders + walkability, seats as
  positions the player can occupy, gates opening, `/stadium` spawn.
- Match: `gsx.schedule('rfl', …)` mounts live matches at kick-off and
  tears them down; between matches the pitch is empty and the SDK's
  countdown board shows what is next (decided: no replays on the live
  site; replays are fixture-only); docks `main/left/right`
  attached to the screens; our scoreboard from `stage.hud/score/clock`;
  crowd and commentary placed in the stands and on tannoy positions;
  the single mute button controls it; the city loop is silent in the
  bowl (the venue owns the mix, same rule as shops); attribution kept;
  degrade to "NO SIGNAL" screens + fixture board on any failure.
- Presence: capacity 150 (Q3-A); zone-aware peers if Q3-B/C.
- Verification infrastructure (§7) before any completion claim; CI.
- Docs, state, /about, memory.

### Optional
- Goal celebrations (`stage.on('event')` → light pulse, screen flash),
  floodlights brighten on `statechange === 'live'`.
- Instanced avatars + zone presence (Q3-B).
- Seated pose when standing in a seat cell; a "sit" affordance.
- Programme ticker on the approach signage; concession kiosks.
- A stadium poster for directories.

### Deferred
- Gaussian-splat rendering (SDK roadmap; points preview now), VR/XR,
  chat/reactions, ticketing or points economics, a second channel, seat
  reservations, ring road/parking, side-street grid, day/night cycle.

## 4. Constraints

- **Stack**: no bundler, no new runtime npm deps in the client; three
  r185 (vendored) is the peer the SDK is tested against (0.185.1); SDK v1
  imported at runtime from 4dgsx.com (Q6). Node 22 for scripts.
- **Coordinates/units**: metres, Y-up, +x east along the boulevard
  (spawn faces +x), z = boulevard side (+1 north). Boulevard occupies
  x ∈ [−42, 42], lots z ∈ ±[6.5, 16.5]; stadium precinct x ≥ 42. The SDK
  stage is Y-up, metres, ground y = 0; its bounds come from `stage.bounds`.
- **Performance** (Q4): ≥ 50 FPS median at 1920×1080 on an M-series Mac in
  the benchmark fixture; ≤ 400 draw calls, ≤ 300k tris, ≤ 40 dynamic lights
  scene-wide; stadium GLB ≤ 6 MB, ≤ 150k tris, ≤ 12 materials, textures
  ≤ 2048²; raycast collision stays cheap (proxies, few meshes); mandatory
  match fetch only on precinct entry; hidden-tab safe (no rAF assumptions
  in tests — use `__step`).
- **Compatibility**: Chrome/Safari/Firefox current; touch stays walkable;
  the HUD invariant (every top-corner element inside `#topbar`) holds.
- **Accessibility**: keyboard + stick; no strobes faster than 1 Hz;
  screen text ≥ 24 px at 512-px canvas scale; contrast on dark plates.
- **Licensing/attribution**: RFL bundles are CC BY 4.0; the 4DGSX mark
  stays (moveable, opacity ≥ 0.25); the SDK's HTML panels stay in its
  `sandbox="allow-scripts"` iframes — never relaxed.
- **Security**: no credentials; the only outbound requests are the public
  feed, the CDN bundles and the SDK; `/claim#safety` stays true (nothing
  agent-facing changes).
- **Reproducibility**: `build.py` rebuilds the stadium from scratch with a
  fixed seed; textures generated by script; every screenshot comes from
  the fixture page with fixed cameras and `__stadium.step()`.
- **Ownership of files**: new directories `public/stadium/`,
  `public/js/{world,roads,stadium,match}.js`, `poc/stadium/`,
  `docs/stadium/`, `scripts/stadium-*.mjs`. Shared foundations edited
  only through the integration owner (§8).
- **Repo rules already in force**: `docs/` ↔ `public/docs/` parity is
  list-based (safe for `docs/stadium/`); `validate plots` CI is
  path-filtered to `public/plots/**`, so this work needs its own workflow;
  never point agents at the repo; don't `npm ci` per worktree; 9 GiB free
  disk — cache one match bundle, never many.

## 5. Architecture (required before substantial implementation)

`docs/stadium/ARCHITECTURE.md` must define, and may challenge, this
decomposition:

- **World layout (`world.js`)** — single source for bounds polygons
  (boulevard box ∪ precinct box), the road graph, precinct radius, spawn
  points, reserved lots (`lots.json` gains `reserved`), fog/camera
  parameters. Everything else reads it.
- **Roads (`roads.js`)** — renders the graph in the street's box/emissive
  language; emits colliders and lamp lights within the light budget
  (lamps beyond a count are emissive-only).
- **Stadium asset (`stadium.js` + `stadium.glb/json`)** — loads the GLB,
  applies the client's light/emissive normalisation, registers `col_*`
  proxies as the only colliders, exposes named nodes (screens, panels,
  seats, gates, masts, attribution anchor, pitch origin), gate controller
  reusing the door system.
- **Match (`match.js`)** — owns the SDK: import, `schedule('rfl')`,
  the countdown board between matches, docks → screens, scoreboard canvas from hud truth, audio
  placement + mute + ducking hooks, events → effects, precinct-gated
  `update()`, failure states. Interface: `createMatchSystem(stadiumNodes,
  camera, mediaSystem)` → `{ update(dt, playerPos), state, dispose }`.
- **Player/world bounds** — `player.js` clamps to `world.bounds` instead
  of ±40; ground snap and rays unchanged.
- **Presence** — zone-aware peers (Q3), instanced avatar renderer.
- **Audio policy** — `media.js` learns "venue zones": inside a zone the
  venue owns the mix (extends the on-lot rule).
- **Verification** — fixture page, shot/check/bench scripts, workflow.
- **Shared data**: `stadium.json` (node names, seat cells, gate positions,
  screen aspects), `world.json` (bounds/roads), `STATE.md`.
- **Events**: `precinct:enter/leave`, `match:state`, `match:event`,
  `audio:mute`. **Dependency direction**: index.html → match → stadium →
  world; roads → world; nothing imports index.html. **Error isolation**:
  each system fails closed (stadium without a match, match without
  screens, city without the stadium). **Persistence**: none client-side
  beyond the SDK's own layer prefs (localStorage). **Budgets** per
  system: stadium ≤ 150k tris/≤ 40 calls; roads ≤ 20k tris/≤ 30 calls;
  match as the SDK ships (~340 draws, 57 point clouds); presence ≤ 12
  calls at 150 avatars if instanced. **Assumptions** listed with dates.

## 6. Components (bounded)

| Component | Responsibility | Inputs → outputs | Test / showcase | Depends on | Done when |
|---|---|---|---|---|---|
| World layout | bounds, roads graph, reserved lots | lots.json, constants → world.json + API | unit: allocator skips reserved; bounds contain both boxes | — | manifest builds; player clamp uses it |
| Fixture + scripts | evidence pipeline | GLB/bundle → PNGs, JSON budgets, pass/fail | self-test on City Hall GLB | headless-chrome.mjs | shots + check + bench run locally and in CI |
| Roads | render + collide | world.json → meshes, lights | fixture cams `approach`, `plaza` | World | walkable spawn → gates |
| Stadium asset | Blender build + export | scripts → stadium.glb/json | Blender QA renders; fixture cams | Blender bridge | budgets met; ≥150 seats reachable |
| Stadium client | load, colliders, seats, gates | glb/json → nodes, colliders | walkability flood-fill ≥150 seats | Asset, World | walk to a seat in ≤ 60 s from spawn |
| Match | SDK integration | feed + stage → screens, audio, effects | contract tests with a mocked feed; a real replay | Stadium client | live+replay verified; failure states shown |
| Presence (Q3) | zone peers + instancing | positions → peers | 150 simulated clients (`ws` script) | Stadium client | ≥149 visible at ≤ 12 calls |
| Polish + docs | signage, /about, HUD, state | — | critic pass | all | rubric thresholds met |

## 7. Verification (built before relying on claims)

- **Fixture page** `public/stadium.html`: loads world + roads + stadium (+
  optional match by `?bundle=`), fixed cameras (`approach`, `plaza`,
  `gate`, `concourse`, `stand_low`, `stand_high`, `pitchside`,
  `screen_main`, `mast_night`, `aerial`), `__stadium.step(frames, dt)`,
  `__stadium.stats()` → tris/calls/lights/ms-per-frame, `__stadium.walk(
  from, to)` for path checks; console errors captured.
- **Screenshots**: `scripts/stadium-shot.mjs --cam all` → content-named
  PNGs; **visual regression**: pixel-diff ratio vs the previous accepted
  set, threshold recorded in STATE.md.
- **Budget + contract checks** `scripts/stadium-check.mjs`: GLB size,
  tris, materials, textures, light count, node contract (all named nodes
  present, screens with full 0..1 UVs), walkability flood-fill from the
  boulevard's east end (≥150 seat cells reachable, every gate passable),
  world bounds sanity, SDK contract with a mocked programme feed (mount /
  unmount / docks / scoreboard equals hud / mute / dispose leaves no
  listeners, iframes or audio nodes).
- **Performance**: `scripts/stadium-bench.mjs` on a real GPU locally
  (Chrome, 1920×1080, 30 s, median frame time) with a match playing;
  CI asserts the deterministic budgets only (SwiftShader has no GPU truth).
- **Runtime capture**: console/page errors fail the check; a 10-minute
  soak in the fixture with a replay looping.
- **Live verification** after deploy: `/stadium` renders, feed polled,
  a real kick-off observed (next RFL slots: 2026-09-03 16:01 and 16:02
  London — two matches overlap; the scheduler picks the one on air).
- **Rule**: every completion claim names its evidence (file path, test
  name, or URL + timestamp).

## 8. Workflow and ownership

**Order** (by dependency): 0 architecture → 1 world layout + fixture +
scripts + CI (verification first) → 2 in parallel: roads · stadium Blender
build · SDK spike inside the fixture → 3 stadium into the client
(colliders, seats, gates, spawn) → 4 match on the screens/audio → 5
presence scaling (if Q3) → 6 content + polish → 7 final evaluation, merge,
deploy, live check. Steps 2a/2b/2c may run as parallel subagents in
worktrees.

**Ownership**: integration owner = the main session (edits shared
foundations: `index.html`, `player.js`, `presence.*`, `media.js`,
`build-manifest.mjs`, `vercel.json`); builders own their new files and
request shared changes through the integration owner; a **critic** agent
never edits, only tests and scores; Robin owns merges to main, Fly
deploys, anything on the 4DGSX side, and the answers in §0. Conflicts:
the integration owner decides, records the decision in STATE.md.

## 9. Evaluation rubric

Scores 1–10 per category with named evidence. **Blocking** (must pass):
no uncaught runtime errors; all contract/budget checks pass; ≥150 seat
cells reachable; benchmark ≥ 50 FPS median; the mute button silences
everything; attribution present. **Desirable**: no visual category below
8/10 at final (7 at interim).

- Correctness — schedule/docks/scoreboard match hud truth; states shown.
- Visual quality — per camera: composition, night atmosphere, material
  coherence with the city, screen legibility, floodlight read from spawn.
- Usability — spawn → seat ≤ 60 s without collision traps; signage; hints.
- Performance — budgets in §4, load time of the stadium ≤ 2 s on the
  boulevard's baseline connection; match loading visible on the screens.
- Reliability — soak clean; feed/SDK outage handled; dispose is clean.
- Maintainability — rebuildable asset; documented lanes; state current.
- Accessibility — keyboard/touch parity; contrast; no strobes.
- Integration consistency — palette, grid, lamps, boards, audio rule.

## 10. Iteration loop

Collect evidence → score → rank issues by impact → fix the top ones →
re-run the same fixture → record the new result in STATE.md. **Limit: 3
revisions per component per milestone**; then mark it blocked or
deferred with the exact reason and move on.

## 11. State

`docs/stadium/STATE.md` holds: current milestone, decisions (dated),
assumptions, test results, scores, open issues (ranked), ownership,
deferred work, blockers, next action. Updated at every checkpoint; the
memory index gets one pointer.

## 12. Autonomy

Routine, reversible decisions are made autonomously and recorded. Ask
before: changing scope or architecture, touching agent-facing docs or the
plot spec, deploying the presence server, anything visible on the
boulevard's existing lots or spawn, spending on infrastructure, deleting
files not created in this project.

## 13. Reporting

Every report classifies each item as Implemented / Verified / Partially
working / Attempted but failed / Deferred / Blocked / Not started, with
evidence for "Verified", and lists remaining limitations.

---

## Appendix A — facts read on 2026-09-02

**otra.city client** (`public/index.html`, `public/js/*`): three r185
vendored; ACES tone mapping, exposure 1.15; EffectComposer with bloom
(0.12 strength, threshold 1.0); fog 32–95 m; camera far 220 m; ground
plane 300 × 300 m; player clamps to ±40 m; step ≤ 0.35 m (shin ray),
radius 0.28 m, walk 3.2 / run 5.6 m/s; colliders are a flat mesh list
raycast 7× per frame; per-plot light cap 30 (× 0.0055), emissive peak
1.2. Live baseline: 10 plots, 221 meshes, ~85k tris, 28 lights, 670 ms
load. Presence: server cap 150, 60 m interest, 32 nearest at 10 Hz;
client renders ≤ 32; Fly `lhr`, 256 MB, auto-stop. Boulevard: asphalt
84 × 8 m, pavements to |z| 6.5, lamps every 12 m (6 PointLights), lots
10 × 10 × 6 m at 12 m pitch, spawn (−20, 0, 0) facing +x. Blender 5.2.1
bridge on :9876 (not running now; launch with `tools/blender/start_bridge.py`).

**4DGSX SDK v1** (`site/lib/player/three/*`, 4dgsx.com/sdk): ESM, 32 KB,
peer `three`; `new FourDGSX()`, `programme(ch)`, `mount(item|{bundleUrl})`,
`schedule(ch, {mount, unmount, onProgramme, showFixture, hideFixture,
stage, pollS})`; stage: `group` (Y-up, metres), `bounds`, `layers/setLayer`,
`docks.attach(slot, mesh|{parent,size_m,position,rotation})`, `audio.{enable,
setOn, place, attachListener}`, `play/pause/seek` (locked while live),
`update(dt, camera, heightPx)`, `setSplats`, `on('event'|'statechange'|
'tick')`, `hud/score/clock/state`, `attribution` (keep, ≥ 0.25 opacity),
`dispose()`. Meshes are GLSL3 ShaderMaterials with their own fixed sun;
frustum culling off; ~335 draws + 57 point clouds per RFL bundle. HTML
panels rasterise in sandboxed iframes; the broadcast dock is a
VideoTexture. No `setActive`; the host simply stops calling `update()`.

**RFL channel** (`/api/v1/programme/rfl`, CORS `*`): 600 s matches
(2 × 300 s), slots 12:00/16:00/20:00 London, states upcoming/live/replay;
bundle URL and score withheld until air/full-time. Per-match fetch for
the three.js path: scene 39 KB, hud 22 KB, ui 4 KB, geometry 12.5 MB,
track 23.9 MB, points 2.4 MB (≈ 39 MB before first frame; fetched whole);
optional crowd 21 MB, commentary 6 MB, pitch 3.8 MB, broadcast.mp4
165 MB (streamed). All served with `access-control-allow-origin: *`
from cdn.4dgsx.com (verified with `Origin: https://otra.city`). Stage
geometry: turf tile 20 × 15 m, playing area 14 × 9 m, boards to 0.9 m,
goals 3.4 m wide, robots ~1.2 m, ball Ø 0.7 m. UI docks: `main` (video
16:9), `left` (stats html, aspect 0.68), `right` (line-up html, 0.68);
a world score panel 4.6 × 1.55 m exists but is off by default; layers
for names, radio bubbles, scorebug, coach strip, banners.
