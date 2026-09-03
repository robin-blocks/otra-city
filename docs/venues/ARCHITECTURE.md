# Venues — architecture (v0.1, 2026-09-02)

The stadium is the first **venue**: a city-owned structure much larger than
a 10 × 10 m plot, with its own function, streamed in and out by distance so
that a visitor who only walks the boulevard pays almost nothing for it. This
document defines the generic system; `docs/stadium/PROJECT.md` is the first
project built on it. It may be challenged by implementation when a reason is
stated and recorded in `docs/stadium/STATE.md`.

## 1. Vocabulary

- **Venue** — a large first-party lot: stadium, park, market, museum. Authored
  by the platform's Blender lane, never submitted through the plot pipeline,
  described by `public/venues/<id>/venue.json`.
- **Footprint** — the venue's box in venue-local metres; **placement** puts it
  in the world (x, z, yaw). Venue-local origin is the venue's natural centre
  (the pitch centre for a stadium).
- **Tier** — how much of a venue is resident for the current visitor:
  - **Tier 0 (far)**: only the impostor (`far.glb`, a few hundred triangles,
    emissive masts that ignore fog so the venue reads as a destination from
    the boulevard). Present from city start.
  - **Tier 1 (near)**: the full asset (`venue.glb`) is loaded and swapped for
    the impostor; collision proxies, gates and declared animations are live;
    screens show their idle content.
  - **Tier 2 (inside)**: the venue's **modules** are active (for the stadium:
    the 4DGSX match, live screens, crowd and commentary audio) and the venue
    owns the audio mix.
- **Module** — a behaviour a venue declares in `venue.json`, resolved by name
  from `public/js/venue-modules/`. Modules never touch the scene outside the
  venue's root and never run agent code.

## 2. Subsystems

| Subsystem | File | Responsibility |
|---|---|---|
| World layout | `public/js/world.js` | Layout truth: the map and the plat (`public/city/`), venue placements, the walkable fence (`contains(x,z)`, built by `js/city-map.mjs`), fog/camera presets, tier geometry (`distanceToBox`, `insideBox`). Everything else reads it; it imports only three and `city-map.mjs`. |
| Roads | `public/js/roads.js` | Renders every road in `public/city/map.json` (chains, roundabouts, plazas, crossings, bays, lamps, signs, name plates, bollards) in the street's box-and-emissive language, instanced; emits colliders; lit lamps register light-pool sources. Static, always resident, small. |
| Venue streamer | `public/js/venues.js` | Reads `public/venues/index.json`; builds impostors; computes tiers per venue per frame with hysteresis and an unload grace; loads/normalises/disposes `venue.glb`; registers and removes colliders, gates, anims, quiet zones; activates/deactivates modules; emits `tier` events; exposes `state()` for tests. |
| Modules | `public/js/venue-modules/<type>.js` | `create(ctx) → { activate(), deactivate(), update(dt, playerPos, time), dispose(), state }`. M1 ships `match-4dgsx`. |
| Match module | `public/js/venue-modules/match-4dgsx.js` | Owns the 4DGSX SDK for one venue: dynamic import on first activation, `schedule(channel)`, countdown board on the pitch between matches, docks to named screens, our own scoreboard canvas from hud truth, audio placement, mute + quiet-zone integration, events, failure states, dispose. |
| Doors | `public/js/doors.js` | The door/gate controller factored out of `index.html`: `add(id, {left, right, at, slide})`, `remove(id)`, `update(dt, playerPos)`. Plots and venue gates share it. |
| Player | `public/js/player.js` | Bounds come from `world.contains` instead of a ±40 clamp; colliders can be added and removed at runtime. |
| Manifest | `scripts/build-manifest.mjs`, `public/plots/lots.json` | `reserved` rules keep the allocator (and vacant boards) out of venue precincts. |
| Venue manifest | `scripts/build-venues.mjs` | Validates every `venue.json` against `docs/venues/venue-schema.json`, computes world-space bounds, writes `public/venues/index.json`. `--check` fails on drift (CI). |
| Fixture | `public/venue.html` | The evidence page: real client pipeline, one venue at a forced tier, optional match bundle, fixed cameras from `venue.json.cameras`, `window.__venue` API. |
| Scripts | `scripts/venue-shot.mjs`, `venue-check.mjs`, `venue-bench.mjs` | Screenshots, deterministic checks (budgets, node contract, tier cycle + memory return, walkability **in both directions — a seat that can be reached but not left is a bug**, match contract with a mocked feed, console errors), GPU frame-time benchmark. |
| CI | `.github/workflows/venues.yml` | Runs build-venues `--check`, venue-check, venue-shot on the paths this system owns. |

## 3. Data

### `public/venues/<id>/venue.json` (authored; schema in `venue-schema.json`)

```json
{
  "id": "stadium", "name": "otra.city Stadium", "kind": "stadium",
  "tagline": "the city's home ground — RFL, live at kick-off",
  "url": "https://otra.city/stadium",
  "placement": { "x": 100, "z": 0, "yaw": 0 },
  "footprint": { "min": [-26, -23], "max": [26, 23] },
  "tiers": { "near_m": 18, "inside_margin_m": 4, "hysteresis_m": 12, "unload_after_s": 20 },
  "assets": { "far": "far.glb", "near": "venue.glb" },
  "collision_prefix": "col_",
  "lights": { "cap": 12000 },
  "spawn": { "x": -34, "z": 0, "yaw": 1.5708 },
  "gates": [ { "id": "west", "left": "gate_w_L", "right": "gate_w_R", "at": [-26, 0, 0], "slide_m": 1.4 } ],
  "anims": [ { "type": "blinker", "node": "mast_beacon", "on": 1, "off": 1.2 } ],
  "audio_zone": { "min": [-24, -21], "max": [24, 21] },
  "seats": [[-14.5, 3.2, -19.6], ...],
  "cameras": { "approach": [[-70, 4, 10], [0, 12, 0]], "stand_high": [[0, 9, -20], [0, 1, 0]] },
  "modules": [ {
    "type": "match-4dgsx", "channel": "rfl", "pitch": "pitch_origin",
    "docks": { "main": "screen_main", "left": "panel_left", "right": "panel_right" },
    "scoreboard": "screen_score",
    "audio": { "crowd": { "at": [0, 8, 14], "ref": 12, "max": 90 },
               "commentary": { "at": [0, 11, -22], "ref": 14, "max": 120 } }
  } ],
  "budgets": { "glb_bytes": 6291456, "tris": 150000, "materials": 12, "meshes": 48, "texture_px": 1024 }
}
```

All positions are venue-local metres, Y-up, until `venues.js` applies the
placement. `seats` and `cameras` are generated by the Blender build script so
they cannot drift from the geometry. Media nodes (screens, panels) carry full
0..1 UVs, the same rule plots follow.

### `public/venues/index.json` (generated)

`{ "venues": [ { ...venue.json, "base": "/venues/stadium/", "bounds": { "min": [x,z], "max": [x,z] } } ] }`
— world-space bounds included so `world.js` needs no maths at load.

### `public/city/map.json` (authored; was `roads.json` until 2026-09-03 — see `docs/map/ARCHITECTURE.md`)

Nodes (named 2-D points), roads (named chains of nodes with `width`,
`pavement`, `dashes`, `lamps_every`, `lit`, and which sides bear lots),
roundabouts (`at`, `island_r`, `outer_r`), aprons (boxes: plazas), bays,
crossings, signs (canvas boards like the info boards), bollards, the spawn.
The boulevard is a road like any other; `street.js` draws only the lots.

### `public/plots/lots.json`

Since the map (2026-09-03) this is a registry of slug → lot id; the plat
(`public/city/lots.json`) never places a lot inside a venue's bounds, so the
old `reserved` rule is gone. Existing assignments are never moved.

## 4. Runtime flow

1. `index.html` loads `world.js` (map.json + the plat + venues/index.json),
   then `street` (lot furniture), `roads`, `venues` (impostors only).
   Fog and camera far come from `world.presets`.
2. Every frame: `venues.update(dt, playerPos)` computes each venue's tier
   from the distance to its world bounds box:
   - d ≤ `near_m` → want Tier 1 (load `venue.glb` once; swap impostor).
   - inside `bounds` expanded by `inside_margin_m` → want Tier 2.
   - Leaving uses `hysteresis_m`; dropping to Tier 0 waits `unload_after_s`
     before disposing, so pacing at the edge cannot thrash the network.
3. Tier 1 entry: GLTF loaded (Draco), lights normalised (× 0.0055, venue
   cap — a bowl needs thousands where a 10 m lot gets 30, because a
   floodlight sits 25 m from what it lights; spots get an 80 m range),
   emissive peak clamped (1.2, same as plots), `col_*` nodes made
   invisible and registered as the only colliders, gates registered with
   the door system, anims attached, modules created (not active).
4. Tier 2 entry: modules `activate()`; the venue's `audio_zone` becomes a
   quiet zone for the city loop; on exit `deactivate()` and the zone is
   released. Modules keep expensive state (a mounted match) through Tier 1
   and drop it only on Tier 0 disposal.
5. Tier 0 (after grace): `dispose()` on modules, anims detached, colliders
   and gates removed, geometries/materials/textures disposed, impostor
   shown again. `renderer.info.memory` must return to its Tier-0 values —
   a test asserts it.

## 5. Interfaces

```js
// world.js
export const BOULEVARD = { xMin: -42, xMax: 42, zMax: 16.5 };
export async function loadWorld() → { roads, venues, presets: { fog: [near, far], cameraFar },
  contains(x, z), boxes, venueFor(x, z), distanceToBox(box, x, z), spawnFor(routeId) }

// venues.js
createVenues(scene, world, { loader, player, doors, anims, media, camera, renderer })
  → { update(dt, playerPos, time), on('tier', fn), state(), get(id), forceTier(id, n) /* fixtures */ }

// venue module contract
export function create(ctx /* { venue, cfg, root, nodes, scene, camera, renderer, media, world, log } */)
  → { activate(), deactivate(), update(dt, playerPos, time), dispose(), state }

// doors.js
createDoorSystem() → { add(id, { left, right, at, slide = 1.2, open = 2.4, close = 3.1 }), remove(id), update(dt, playerPos), state() }

// media.js additions
addQuietZone(id, { min: [x,z], max: [x,z] }), removeQuietZone(id), subscribeMute(fn) → unsubscribe, get muted

// player.js additions
setBounds(fn), addColliders(list), removeColliders(list)

// anims.js addition
detach(container)
```

Events: `venues` emits `tier` `{ id, tier, from }`; the match module emits
nothing outward in M1 (effects stay inside the venue root).

## 6. Error isolation

- Venue GLB fails → the impostor stays, colliders are the impostor's box,
  a console warning names the file. The city never waits on a venue.
- SDK import fails → `screen_score` shows "NO SIGNAL · 4dgsx.com" and the
  module retries on the next activation.
- Programme feed hiccups → the SDK backs off; the last board stays.
- A match bundle fails mid-load → the module logs, the countdown board
  stays, the next poll retries.
- A module throwing in `update` is caught once per frame, logged, and the
  module is deactivated for that visit (the venue still stands).

## 7. Performance design

- **Cost at street level** is the impostor: ≤ 3 draw calls, ≤ 600 tris, 2
  materials, no lights. Verified by `venue-check` at Tier 0.
- **Tier 1** adds ≤ 48 meshes, ≤ 150k tris, ≤ 12 materials, ≤ 8 punctual
  lights (4 floodlight spots + 4 fill), all frustum-culled with correct
  bounds (the venue GLB is split by stand so the far side culls from the
  forecourt).
- **Tier 2** adds the SDK stage (~335 draws, 57 point clouds, its own
  GLSL3 materials) only during a live match, plus one VideoTexture and
  three canvas textures; `stage.update` runs only while inside.
- **Collision** stays cheap: `col_*` proxies are ≤ 40 boxes; the visual
  meshes are never raycast.
- **Lights**: the scene-wide dynamic light count is measured in the check
  (baseline 28) and capped at 40 at Tier 1.
- **Fog/far plane**: presets move fog to [40, 190] and camera far to 260
  so the impostor is visible from spawn; the impostor's emissive material
  has `fog: false` so floodlight glow reads through haze like real lights.
- **Network**: `far.glb` ≤ 60 KB at start; `venue.glb` ≤ 6 MB at Tier 1;
  the match core (~39 MB) only while a match is live and only at Tier 2.
- **Mobile**: the match module refuses to mount on coarse-pointer devices
  (`matchMedia('(pointer: coarse)')`) and shows the countdown instead.

## 8. Verification (details in `docs/stadium/PROJECT.md` §7)

`venue-check.mjs` drives `venue.html` headless and asserts: schema valid;
budgets; node contract (every node the manifest names exists; media nodes
have full UVs; `col_*` present and invisible); tier cycle 0→1→2→1→0 with
`renderer.info.memory` returning to baseline and no console errors;
walkability flood-fill from `spawn` reaches ≥150 `seats` and every gate;
match contract against a local mocked feed (mount, docks attached to the
named nodes, scoreboard text equals hud score/clock, mute silences the
stage, dispose leaves no iframes, media elements or audio nodes). Shots
come from `venue-shot.mjs`; frame time from `venue-bench.mjs` on a GPU.

## 9. Assumptions (2026-09-02)

Learned while building the stadium (2026-09-03), true for every venue:
- The city ground plane sits at y = −0.01: any venue floor authored below
  that is hidden by it. Floors go at or above 0; a plate meant to sit
  under a stage's own ground (y = 0) lives in the 5 mm between.
- Walkability must treat overhangs as layers (a gate lintel is not the
  ground under it); the fixture's flood fill walks (cell, floor) nodes.
- The SDK paints host screens by swapping `material.map` and never sets
  `flipY`; our screens carry glTF UVs, so the module forces `flipY=false`
  and gives screens unlit materials that keep the authored plate as map.
- three.js allocates one shared Sprite geometry on first use, so GPU
  memory assertions compare two cycles, not the pre-first-use baseline.

- One visitor never needs two venues at Tier 1 at once in M1; the streamer
  supports it anyway (per-venue state), but budgets are stated per venue.
- The SDK's `mountStage` exposes no download progress, so the screens show
  an indeterminate "LOADING MATCH" state.
- Presence stays global in M1; venue-aware peers are milestone 2.
- The boulevard is a road in `map.json` like any other (since 2026-09-03); `street.js` draws only the lots.
