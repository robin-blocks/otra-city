# The map — state

_Last update: 2026-09-03 (M1 in progress on `claude/city-map-expansion-lots-4ce32d`)_

## Milestone
**M1 — one manual district and the platting system.** Nothing merged.

| component | status | evidence |
|---|---|---|
| Map geometry module (`city-map.mjs`) | implemented | `map-check` passes 17/17 |
| Map + plat (`map.json`, `build-map.mjs`, `lots.json`) | verified | 34 lots on 2 roads, 3 slots given to junctions; boulevard lamps post-for-post with launch |
| Registry migration + manifest (`build-manifest.mjs`) | verified | 10 plots at the same world positions; 24 vacant; `map-check` registry/manifest checks |
| Map check (`map-check.mjs`) | verified | 17 PASS, found 3 real defects before any renderer existed (below) |
| Fixture (`map.html`) | implemented; walkthrough asserts it renders every lot and the vacant count | `qa-out/` "the map page renders" |
| World fence from the map (`world.js`) | implemented | `map-check` fence checks (same module), walkthrough road walks |
| Roads renderer (`roads.js`) | implemented; instanced furniture, plates with the subreddit line, dead-end kerbs | screenshots in this session; walkthrough plate count 16/16 |
| Lot furniture (`street.js`) | implemented; vacant lots ≤ 12 draw calls between them (measured 8) | walkthrough "vacant lots are cheap" |
| Client integration (`index.html`, `/lot/<id>`, `?lot=`) | implemented | walkthrough "/lot/<id> lands you outside that lot" PASS |
| API: `lot` in dry run / status / validator | verified locally | five dry runs (below) |
| Claim page `?lot=`, docs, spec v0.6 | implemented | `sync-docs` clean; claim page reads vacancy from the manifest |
| Walkthrough generalised (35 checks), CI | verified 35/35 | `qa-out/report.json`, screenshots |
| Critic pass | not started | — |

## Decisions
- 2026-09-03 Robin: lot ids `<road>-<n>` numbered from the stadium end (City Hall = `boulevard-8`, PromptFrenzy `boulevard-7`); odd south / even north on the boulevard.
- 2026-09-03 Robin: names **Founders Boulevard** and **Floodlight Circuit**; road ids `boulevard`, `circuit`. **Superseded the same day** (below).
- 2026-09-03 Robin: **streets are named for the subreddits the city wants to reach**, with a little rivalry between them, and one day users will vote on or create names. So: the ring is four named roads — **Claude Terrace** (r/ClaudeAI) and **ChatGPT Terrace** (r/ChatGPT) face each other across the pitch, **Gemini Gate** (r/GoogleGemini) is the far end, **Claude Code Circus** (r/ClaudeCode) is the arrival side through the stadium roundabout; the boulevard is **Singularity Boulevard** (r/singularity); the two coach stubs are **Anthropic Close** (r/Anthropic) and **Artificial Close** (r/artificial). Every plate carries the subreddit on its second line.
- 2026-09-03 (session, because of the above): road IDS are positional and permanent — `boulevard`, `west`, `north`, `east`, `south`, `close-n`, `close-s` — since they are inside every lot id and names will change; `name` and `sub` are display only. Lot ids on the ring are therefore `north-3`, not `claude-3`.
- 2026-09-03 (session): the world is the plan's mirror image (three.js's +z points at the viewer, the plan draws z up); "left/right" in `city-map.mjs` and `map.json` are the plan's, and walking east down the boulevard the +z lots are on the right. Documented, not flipped: every existing lot, lamp and the venue system share the frame.
- 2026-09-03 Robin: default allocation = nearest free lot to City Hall (`map.centre`), ties by address; `vacant[0]` is next.
- 2026-09-03 Robin: a requested lot taken before CI allocates → nearest free lot instead, said so in the CI log, the PR and the status endpoint; never a rejection.
- 2026-09-03 Robin: street name signs are the British two-post white plate with black caps (photo reference), low, at every junction and road end.
- 2026-09-03 (session): every unclaimed lot is shown; `keep_vacant` and `reserved` in the registry are gone (the plat's exclusions replace them).
- 2026-09-03 (session): the coach/drop-off bays move from the main roundabout's arms to stubs off the ring's NW/SW corners, because the ring's west side takes those arms.
- 2026-09-03 (session): the circuit's lots are on its outside only; the inside is the stadium precinct (plazas).

## Architecture challenges recorded
- Lamps were first indexed from the road origin at a fixed phase; on the circuit that put a lamp 0.62 m from three lot boards. Lamps now sit midway between lot slots by construction (`roadLamps`), and their kerb parity counts every candidate so a trim never flips the run. Found by `map-check`.
- Dead ends had the 2 m kerb inside the asphalt inherited from #28 — an invisible wall 2 m before the road ends, and the coach stubs had a 1.5 m gap before their bays (the #35 class). Dead ends are now walkable to the asphalt's end and closed by a visible kerb block (`deadEnds`).

## Assumptions
- See `ARCHITECTURE.md` §8.

## Test results
- 2026-09-03 `node scripts/map-check.mjs`: 17/17 PASS. Longest road route spawn→lot 246 m.
- 2026-09-03 `node scripts/build-map.mjs` (final map): Singularity Boulevard 114 m 16 lots; Claude Code Circus 92 m 4; Claude Terrace 80 m 4; Gemini Gate 92 m 6; ChatGPT Terrace 80 m 4 — 34 lots, 3 slots given to junctions (west-5, north-5, south-5).
- 2026-09-03 `npm run validate`: all plots valid, manifest 10 lots / 24 vacant, map ok.
- 2026-09-03 dry runs against `scripts/dev-api.mjs` (signal's glb): no request → "you would get boulevard-1"; `boulevard-13` → free; `boulevard-8` → held by city-hall (FAIL); `mars-1` → not on the map (FAIL); `BOULEVARD 13` → not a lot id (FAIL at the identity table); an update of `signal` asking for `boulevard-13` → kept at boulevard-3, request ignored.
- 2026-09-03 `npm run qa`, first run on the district: 27 PASS / 8 FAIL, all eight the harness's own conversion — the road walks judged "near the end point" while the avatar runs on into the roundabout (now: progress along the axis); the door-close check stood 1.1 m from the door (now 4.9 m); the boulevard budget was measured with the stadium still resident from the ring walk (now on a fresh page).
- 2026-09-03 CI on PR #37 (`768142c`): city walkthrough, docs in sync, validate plots, venues — all green. The first CI run failed the 34-lot check with Chrome's "Internal error" after 170 s (the stadium mounting inside a 60 s evaluate on the software renderer); venues are now pinned to tier 0 for the walk.
- 2026-09-03 `npm run venue:check` on the new world: all venue checks passed — reachable from the city spawn (369 samples, no gap), 600/600 seats reachable, gates ok.
- 2026-09-03 `npm run qa`, re-run: **35/35 PASS** (`qa-out/report.json`). Every named road walkable end to end by a real controller (7 roads, 8 segments); all 34 lots' standing points clear and frontages walkable; vacant board offers its claim url; `/lot/boulevard-13` lands on its pavement with the address in the HUD; map page renders 34 lots / 24 vacant; console quiet. Budgets: boulevard pose 233 calls / 95,196 tris (limits 370 / 108,000; was 284 / 86,316 before the district — instancing made the wide view cheaper); shopfront pose 81 / 14,036 (65 before: instanced furniture is not culled per piece, base re-based 30 → 46 with the reason in `lib/qa-budgets.mjs`); vacant furniture 8 draw calls for 24 lots; 12 lights and 33 programs constant across a 20 s walk.

## Critic pass 1 (docs/map/CRITIQUE-1.md, 2026-09-03) and what it changed
All five blocking criteria passed on the critic's own evidence (it re-derived
every plot's launch position, re-ran map:check and its own venue-check, and
exercised ten `lot` cases through the API harness). Scores: visual 7,
maintainability 8, accessibility 7, **usability 6** — a cold visitor at the
spawn could not read a road name. Ten ranked issues, none blocking. Verified
each against the source before acting; fixed in the same day:

| # | finding | fix | evidence |
|---|---|---|---|
| 1 | `build-map --check` compared the map against the plat on disk, so a PR that moved a held lot and regenerated the plat passed | the registry now FREEZES `placed: { id: { x, z, yaw } }` at assignment; build-map, build-manifest and map-check compare the plat against it | `map-check` "every held lot is frozen where the plat puts it"; a scratch map with the boulevard's origin moved one pitch fails `--check` |
| 2 | the "STADIUM →" sign stood inside vacant lot boulevard-2 | moved onto the north pavement at (43.2, 5.9); signs and bay lamps are now placed by the shared module and counted by map-check, which also asserts nothing the city puts up stands on a lot | `map-check` "nothing the city puts up stands on a lot" |
| 3 | the dead-end kerb was invisible at night | a lit cyan edge along the top of every kerb block | `roads.js` deadEnds loop |
| 4 | the shopfront triangle budget had no term for what the map added (14,036 of 16,000) | budgets carry `perVacant` (160 tris per vacant lot) and re-based bases with the measurements in the file | `lib/qa-budgets.mjs` |
| 5 | from the spawn nobody could read the road name | repeater plates on long segments where a right-kerb lamp stands (the boulevard gets them at x = 6 and x = −18, 2 m from the spawn); the address on claimed boards is 24 px semibold instead of 18 px grey | `namePlates`, `street.js` |
| 6 | three City Hall authoring scripts still read `side` | `pictures.py`, `film.py`, `assembly_video.py` read `x`/`z`/`yaw`/`lot` and draw the boulevard's lots only where the picture is the boulevard | `py_compile` clean; not re-run in Blender |
| 7 | the plan page was a thumbnail on a phone | the canvas keeps a 1200 px minimum width inside a horizontal scroller | `map.html` |
| 8 | `rankFree` broke ties by id string, not address | ties by (road, number); `vacant[]` is now boulevard-1, 2, 13, 14 … | manifest |
| 9 | two plates 6.5 m apart on each close | a segment shorter than 20 m gets one plate, at the junction | `namePlates` |
| 10 | map-check modelled a plate as one centre post | both posts and the plate body are checked | `map-check` |
| 11 | `/lot/<unknown>` fell through silently | a toast says the lot does not exist and points at the map | `index.html` |
| 12 | the docs' example lot was a real free lot every copy-paster would ask for | the claim page's example is `vacant[0]`, the lot an unrequested claim gets anyway | `claim.html` |

Not changed, recorded: the five north-side claimed boards moved 6.8 m along
the pavement (the board frame is now lot-local `BOARD_LOCAL`, the old code put
both sides' boards at x + 3.4) — the plots themselves did not move; the bay
`openSouth = cz > 0` heuristic and the duplicated 64 / 0.28 / 1.34 constants
are pre-existing and noted.

Also found by the fixes: bay lamps stand on the bays' 1.5 m kerbs, which the
fence did not include (the plat did) — bays now fence their kerbs.

## Scores
- Critic pass 1: correctness PASS, walkability PASS, reliability PASS, performance PASS, integration PASS; visual 7, usability 6, maintainability 8, accessibility 7. Round 2 pending on the fixes above.

## Open issues (ranked)
1. Critic round 2 (re-score usability after the repeater plates and the larger address).
2. The two closes carry a subreddit each but no lots — a name with nothing to claim on it.
3. The road name is not in the HUD; a visitor reads it off plates and boards only.

## Deferred
- Automatic expansion (a script editing `map.json`); side streets; walking-distance allocation; parking.

## Blockers
- None.

## Next action
- Re-run qa on the fixes, push, critic round 2, then Robin reviews PR #37.
