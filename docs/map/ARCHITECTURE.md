# The map — architecture (v0.1, 2026-09-03)

## 1. Vocabulary

- **Map** — `public/city/map.json`, authored by hand. Named nodes (2-D
  points), **roads** (a chain of nodes walked first to last, with width,
  pavement, dashes, lamp spacing and which sides bear lots), roundabouts,
  plazas (`aprons`), bays, crossings, signs, bollards, the spawn and the city
  centre.
- **Segment** — one node pair of a chain. Trimmed at each end by the
  roundabout there (by its `outer_r`). "Left" and "right" are the walk's sides.
- **Plat** — `public/city/lots.json`, generated: every lot the map affords.
  A **lot** is `{ id, road, n, address, x, z, yaw }` — a 10 × 10 m envelope
  centred `pavement + width/2 + 5` off its road's axis, its front facing the
  road. `yaw` is the plot container's `rotation.y`.
- **Registry** — `public/plots/lots.json`: `{ slug: lotId }`. Written once per
  plot, never moved.
- **Manifest** — `public/plots/index.json`: claimed lots (plot.json fields +
  the lot's geometry + glb/base/poster) and `vacant[]` (every unclaimed lot,
  in default-allocation order, each with its claim url).
- **Set-aside road** — one with `lots.by_request` in the map. Its lots are
  platted, drawn, addressed and claimable as usual, but `rankFree` sorts them
  behind every other street, so they are never allocated to a claim that named
  no lot. This is how a street is held for an event; `reserved` is the other
  tool and stops lots existing at all.
- **Address** — `<n> <Road Name>`; **id** — `<road id>-<n>`. Numbers count
  slots from the chain's first node: left odd / right even when both sides
  bear lots, consecutive when one does. A slot a junction swallows leaves a
  gap. A road may set a slot phase per segment (`lots.from_m`) so each side's
  lots centre on what they face.

## 2. Subsystems

| subsystem | file | responsibility |
|---|---|---|
| Map geometry | `public/js/city-map.mjs` | The one implementation of: segments and trims, the plat, lamp positions (road, roundabout, bay), roundabout arcs, name-plate positions (both ends of every segment, one on a short close, repeaters on long segments where a right-kerb lamp stands), dead ends, the walkable fence and its point test. Imports nothing. Node and the browser import the same file. |
| Plat | `scripts/build-map.mjs` | `map.json` → `lots.json`. `--check` fails on a stale plat, and on any edit that moves (against the registry's `placed` record) or removes a lot the registry holds. |
| Manifest | `scripts/build-manifest.mjs` | Plat + registry + every `plot.json` → `index.json`; allocates lots (requested if free, else the first lot `rankFree` offers); writes the registry back. |
| Map check | `scripts/map-check.mjs` | Deterministic invariants (plat, registry incl. `placed`, manifest, fence continuity along roads / around roundabouts / spawn→every lot, clearance of every spawn point from every lamp, plate post, sign, bollard and board, no post on a post, nothing the city puts up standing on a lot). |
| World | `public/js/world.js` | Loads map, plat, venues; builds the fence via `fenceShapes`; `contains(x,z)`, `reach`, fog/far presets, spawn, `lotById`. |
| Roads | `public/js/roads.js` | Renders every road from the map (asphalt, pavements, instanced dashes/lamps/bollards/stripes, roundabouts with bands and totems, plazas, bays, crossings, directional signs, **name plates**, dead-end kerbs). Registers lamp light sources with the pool. |
| Street | `public/js/street.js` | Lot furniture only: an info board per claimed lot; instanced pads/markers/posts and atlas-textured boards for every vacant lot. |
| Client | `public/index.html` | Places plots by `x, z, yaw`; spawns (`/`, `/s/<slug>`, `/lot/<id>`, `/stadium`); resolves clicks on merged boards; `window.__city.lots/vacant/map`. |
| Fixture | `public/map.html` | The plan view: roads, lots (claimed/vacant), lamps, plates, spawn, fence sampling. Deterministic; `window.__map`. |
| API | `api/submit.mjs`, `api/plot-status.mjs`, `lib/validate-plot.mjs` | `plot.lot` format check; dry-run `lot` line (free / held / unknown / kept on update / default); status `position` = lot geometry + address. |

Dependency direction: `city-map.mjs` ← everything. `world.js` ← `roads.js`,
`street.js`, `index.html`. Scripts ← `city-map.mjs` only.

## 3. Data

### `public/city/map.json` (authored)

```json
{
  "spawn": { "x": -20, "z": 0, "yaw": 1.5708 }, "centre": [0, 0],
  "lot_pitch": 12, "lot_margin": 1,
  "nodes": { "rb": [60, 0], "blvd_w": [-54, 0], "nw": [60, 46], ... },
  "roads": [
    { "id": "boulevard", "name": "Singularity Boulevard", "nodes": ["rb", "blvd_w"],
      "width": 8, "pavement": 2.5, "dashes": true, "lamps_every": 12, "lit": true,
      "lots": { "sides": ["left", "right"], "from_m": 24 } },
    { "id": "north", "name": "Claude Terrace", "sub": "r/ClaudeAI", "nodes": ["nw", "ne"],
      "lots": { "sides": ["left"], "from_m": 22 } },
    { "id": "northwest", "name": "Frontier Mews", "nodes": ["nw", "nw_w"],
      "lots": { "sides": ["left", "right"], "from_m": 24, "by_request": true } },
    { "id": "coach_n", "name": null, "nodes": ["nw", "bay_n"], "lots": null }
  ],
  "roundabouts": [ { "id": "rb", "at": "rb", "island_r": 4, "outer_r": 9, "pavement": 2.5, "lamps": 4, "lit": true, "totem": {...} } ],
  "aprons": [ { "id": "north_plaza", "min": [66.5, 23], "max": [133.5, 39.5], "height": 0.25 } ],
  "bays": [...], "crossings": [...], "signs": [...], "bollards": [...], "reserved": []
}
```

### `public/city/lots.json` (generated)

`{ spawn, centre, roads: { id: { id, name, lots: [ids] } }, lots: { id: { id, road, n, address, x, z, yaw } } }`

### `public/plots/lots.json` (registry, written by the manifest builder)

`{ lots: { "city-hall": "boulevard-8", ... }, placed: { "boulevard-8": { x, z, yaw }, ... } }`

`placed` freezes where each held lot stood when it was assigned. The plat is
regenerated from the map, so a map edit that moved a claimed lot would
regenerate a plat that agrees with itself; `build-map --check`, the manifest
builder and `map-check` all compare the plat against `placed`, never against
the plat on disk (the critic's first finding). A freed lot's record is
dropped, so it may move again.

### `public/plots/index.json` (generated)

`{ version, spawn, roads: [{ id, name, lots }], lots: [ { ...plot.json, lot, address, road, n, x, z, yaw, glb, base, poster } ], vacant: [ { lot, address, road, n, x, z, yaw, claim } ] }`

`plot.json` gains one optional field: `lot` (a lot id). The manifest's `lot`
is the registry's word; a `lot` in plot.json that disagrees is ignored.

## 4. Runtime flow

1. `index.html` → `loadStreet` (fetches the manifest, builds lot furniture)
   → `loadWorld` (map + plat + venues → fence, presets) → `buildRoads`.
2. Plots load into a container at `(x, 0, z)` rotated `yaw`; lights become
   pool sources with the lot centre; doors at `(0, 0, 4.62)` in lot space.
3. Spawn: `/s/<slug>` and `/lot/<id>` use `standingPoint(lot)` — 6.7 m in
   front of the centre (the pavement), facing the lot; `/` uses `map.spawn`.
4. A click on a board: a per-lot board carries `userData.link`; the merged
   vacant board carries `userData.linkAt(faceIndex)`; both feed the existing
   two-step pill.

## 5. Interfaces

```js
// public/js/city-map.mjs (node + browser)
roadSegments(map) → [{ road, index, id, from, to, a, b, L, ux, uz, lx, lz, t0, width, pavement, half, trimA, trimB, endA, endB, lotsFrom }]
platLots(map, venues, trace?) → { roads: { id: { id, name, lots, byRequest? } }, lots: { id: lot } }
rankFree(plat, takenIds, centre) → [lot]            // default allocation order (set-aside roads last)
fenceShapes(map, plat, venues) → shapes; fenceContains(shapes, x, z); fenceReach(shapes)
lotToWorld(lot, lx, lz); lotFront(lot, d); standingPoint(lot, d = 6.7) → { x, z, yaw }
roadLamps(map); roundaboutArcs(map, r); roundaboutLamps(map, r); allLamps(map); namePlates(map); deadEnds(map)
LOT_SIZE, LOT_HALF, LOT_PITCH, BOARD_LOCAL

// public/js/world.js
loadWorld({ base }) → { map, plat, lots, venues, shapes, presets, reach, spawn, contains, lotById, toWorld, venueForPath, ... }
// public/js/roads.js
buildRoads(scene, world) → { group, colliders, interactables, sources }
// public/js/street.js
loadStreet(scene) → { manifest, group, colliders, interactables, sources, update(dt) }
```

## 6. Error isolation

- A registry that names a lot the plat lacks: the manifest builder throws
  (CI red), never silently re-places a plot.
- A `plot.lot` that is unknown or held: assigned the default, logged, reported
  by the status endpoint. The dry run already said so.
- A missing `lots.json`/`map.json` in the browser: `world.js` falls back to an
  empty map (no roads, a small fence around the spawn) and logs; plots still
  load from the manifest, which carries its own geometry.
- A vacant-board atlas larger than the GPU allows: chunked at 64 boards per
  texture (4096 × 2560), so the count is unbounded.

## 7. Performance budgets

- Road furniture is instanced: dashes, lamp posts, lamp heads, bollards,
  crossing stripes, plate posts, plate bodies — one draw call per kind.
- Vacant lots: pad, strips, corner posts, markers, board hardware instanced;
  board faces merged per 64-lot atlas. ≤ 12 draw calls for any number.
- Claimed lots keep their per-lot board (4 draws) inside the per-lot budget.
- Light sources ~60 (lamps) + plot lights; the pool stays 8 lit.
- Walkthrough poses keep their per-lot slope; the base is re-measured once.

## 8. Assumptions (challengeable)

- Roads are straight between nodes; curves are chains of short segments.
- Lots on both sides of a road need the road to be ≥ 13 m from anything
  else; the plat drops what does not fit rather than squeezing it.
- A road's chain origin never moves; growth is at the far end or by new roads.
- The city centre for allocation is `map.centre` (City Hall's x=0).
