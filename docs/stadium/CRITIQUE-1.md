# otra.city Stadium — critique 1 (2026-09-03, ~00:35 London)

Critic pass over branch `claude/otra-city-stadium-f817f1` at HEAD `477a70b`
(rebased onto main `7b284c2` while this pass ran; working tree clean at the
end). Rubric: `docs/stadium/PROJECT.md` §9. The critic edited nothing except
this file.

## What was tested

- Read: PROJECT.md, ARCHITECTURE.md, STATE.md (00:23 version), venue-check.json
  (23:13:40Z, 40 checks incl. `--match`), build.py (00:01 and 00:13 versions),
  textures.py, venues.js, roads.js, match-4dgsx.js, venue.html, world.js,
  doors.js, player.js, street.js, the index.html diff, the SDK source
  (`https://4dgsx.com/sdk/v1/three.js`, 32 KB), posters city-hall/4dgsx/halberd.
- Screenshots: `poc/out/shots/*.png` are a mixed set (approach 00:09,
  roundabout/gate/stair/screen_main/mast_night 00:03 = before the turf fix,
  concourse 00:17, pitchside/stand_low/stand_high/aerial 00:14–00:15). I
  re-shot all 11 cameras from the 00:13:40 GLB (`venue-shot.mjs`, same
  cameras) and score that consistent set; file names below refer to
  `poc/out/shots/stadium-<cam>.png` unless the 00:03 file is stale, which is
  noted. `poc/out/shots-match/*.png` (23:53, older build) for the match state.
- Re-ran independently: `venue-check.mjs` (32/32 PASS before and after the
  rebase); a GPU benchmark that waits for the match to mount (theirs does
  not); a fail-closed probe (SDK URL 404 + feed refused); `index.html` at the
  boulevard spawn and at `/stadium`; a scripted walk of the real
  `PlayerController` from the `/stadium` spawn to a seat and back.
- Pixel sampling of the shots (5×5 means) for exposure claims.

## Blocking criteria (PROJECT §9)

| Criterion | Status | Evidence |
|---|---|---|
| No uncaught runtime errors | PASS | check "no page errors overall: clean"; my city/fixture probes: 0 console errors |
| Contract/budget checks pass | PASS | 40/40 (23:13:40Z incl. match); 32/32 on HEAD 477a70b (critic re-run) |
| ≥150 seat cells reachable | PASS | flood-fill 600/600; real player reached a row-4 seat (0.57 m) in 10.1 s simulated |
| Benchmark ≥ 50 FPS median | PASS | critic run, ANGLE Metal M3 Pro 1080p: idle worst camera 6.9 ms (145 fps); replay mounted, waited for phase `match`: worst 6.7 ms (149 fps), 414 calls at stand_high. Theirs (`poc/out/venue-bench.json`): 3.0–3.9 ms. No spectators in either scene |
| Mute silences everything | PASS (weak) | check asserts the module's `audio: muted` state after `media.setMuted(true)`; no assertion on actual audio output |
| Attribution present | PASS (by eye) | `shots-match/stand_high.png` left-centre and `pitchside.png` right: the SDK's 4DGSX sprite at `attribution_anchor`; SDK `enforce()` keeps opacity ≥ floor; no check asserts it |

Nothing in the blocking list fails. Two usability findings below are, in my
judgement, release-blocking for the main use case even though the rubric's
list does not name them.

## Scores

| Category | Score | Evidence (one line) |
|---|---|---|
| Correctness | 7 | scoreboard = hud truth, docks attach, dispose clean (check); NO SIGNAL path works (critic probe); but no artifact shows the video or panels rendering, the schedule path is untested, SDK failure is sticky, east gate says WEST GATE |
| Visual quality | 6 | bowl cameras 8, exterior 4–5 (per-camera table); approach/mast_night are 84–92 % near-black pixels |
| Usability | 4 | `/stadium` spawn stands inside a lamp post (W for 150 frames: no movement); the seated chase camera is behind the wall; first frame at `/stadium` is a black wall; positives: gate opens, stair climbs, seat in 10 s |
| Performance | 8 | budgets PASS (1.23 MiB, 22k tris, 22 prims, 8 mats, 6 lights, impostor 192 tris); ≥145 fps worst; but 299 calls at the boulevard spawn vs the 221 baseline (roads.js ~85 unmerged boxes; §5 said ≤ 30) |
| Reliability | 7 | memory steady over two cycles, dispose leaves 0 iframes/videos, fail-closed clean; no soak, no mocked feed, SDK import never retried, CI never run |
| Maintainability | 7 | idempotent build.py, seeded textures, schema, STATE current; textures.py has dead code and an overlap bug; PROJECT deliverable names stale; several STATE "Verified" rows name no artifact |
| Accessibility | 5 | no strobes, contrast fine, HUD invariant kept; board text 20–30 px at 1024 (rule: ≥ 24 px at 512 = 48 px); Menlo-only font stack; touch path not assessable from evidence (no coarse-pointer artifact) |
| Integration consistency | 7 | palette, 0.25 grid, lamp rhythm, board style, quiet zone all match the city; bowl is lit brighter and flatter than the city's dark/neon look; impostor from spawn is two small dots |

### Visual quality per camera (countdown state)

| Camera | Score | What the frame shows / what is wrong |
|---|---|---|
| approach | 5 | Sign legible but the roundabout totem hides the "O" of OTRA CITY (it sits on the axis sightline); 92 % of pixels < 12/255; the stadium is a black bar with one cyan line; flood heads are blobs without beams |
| roundabout | 7 | Totem, sign, WEST GATE, bollard caps compose well; the totem's bloom dominates; the wall is featureless |
| gate | 8 | Best exterior: sign hierarchy reads, glass gate, warm floor. Through the gate you see a blank lit slab (the stair balustrade), the floor blows out (106,92,95), and a lamp head hangs over the visitor's head (the post that blocks the spawn) |
| concourse | 7 | Camera moved at 00:17: now a corner view of pitch + scoreboard. The scoreboard is cut by the frame edge, the right third is a blank end wall, and the name no longer matches (it is inside the bowl) |
| stair | 4 | A pale slab (98,104,131) fills 40 % of the frame, the W block letter is blown to (245,245,245), treads are (16,15,23); nothing says where the stair leads |
| stand_low | 8 | Strongest shot: turf, hoardings, three stands, screen + stats panel. Pink seats bloom (191,49,101); the SDK countdown sprite is illegible from here |
| stand_high | 8 | Good bowl overview, scoreboard legible; the back of the main sign floats over the west stand as a grey slab; scoreboard header shimmers (moiré) |
| pitchside | 8 | Hoardings and screen legible; panel_right shows the corrupted plate (signage strips + WEST GATE + STANDS) |
| screen_main | 6 | The camera frames screen_score (south), not screen_main (north). The scoreboard itself reads well. The 00:03 file still has the grey pitch |
| mast_night | 5 | 84 % black; mast heads are blobs, no beams, the wall a black slab; the warm road lamp at left is the one atmospheric element |
| aerial | 7 | Reads as a stadium (four masts, four coloured stands, pitch, board); the concourse ring is black, the forecourt invisible, the SDK board is a white sprite blob at centre |

## Ranked issues

### Blocking (breaks the main use case: walk in, sit, watch)

1. **Seated chase camera ends up behind the stand.** Standing on row 4 of
   the west stand facing the pitch, the 10 m boom (`index.html` venue spawn
   sets `camDist = 10`) puts the camera at x≈73, inside the OTRA CITY sign;
   the frame is giant blurred letters (critic shot `city-seat.png`; reproduce:
   `/?venue=stadium`, walk to any seat). Even the default 4.6 m boom lands in
   the back wall (x 80–80.5). `player.js` has no camera occlusion. Fix: ray
   from `controls.target` to the camera against `player.all`, pull the camera
   to hit − 0.3 m; inside a venue default to ~3 m/1.6 m; optional seated cam.
2. **`/stadium` spawn stands inside a lamp post.** roads.js puts the
   roundabout's east-arc lamp at the arc midpoint (60 + 11.2, 0) = (71.2, 0);
   the spawn is (71, 0). Real player: 150 frames of W, no movement; the
   controller's rays hit `roads` at 0.13 m at all three heights. The post also
   sits on the desire line roundabout → gate. Fix: skip the arc facing a gate
   or place arc lamps at thirds; move the spawn off-axis; add a radius-aware
   walkability check (dilate colliders 0.28 m) or drive the real controller.
3. **First frame at `/stadium` is a black wall, not an establishing shot**
   (`city-forecourt.png`): camera at x=61 in the totem's footprint, 13 m from
   the wall; the sign is off the top of the frame; two 0.6 m glass slivers are
   the only content. Q8 asked for an establishing shot. Fix: spawn ~10 m
   further back and off-axis, camera pitched so sign + one mast are in frame;
   the fixture's `gate` camera is the target composition.
4. **panel_right's idle plate is corrupted.** textures.py draws the four
   hoarding strips (line 205–214) and the WEST GATE / STANDS signs (217–222)
   into the `panel_right` region (348..696 × 480..992), then crops that as
   `plate_panel_right.png`; the LINE-UP plate is gone (see the file and
   `stadium-pitchside.png`, top centre). Between matches — 97 % of the time —
   a dock shows signage junk. Fix: move strips/signs to a free region (e.g.
   824..1024 × 480..736 next to the crest), delete the dead loops 193–204,
   regenerate, rebuild.
5. **No evidence the broadcast or the panels render.** The `screen_main`
   camera aims at the scoreboard; `shots-match/*` show screen_main black and
   the panels hidden (the SDK hides a dock surface until its texture exists;
   check reported `panel_left=none, panel_right=none`). STATE's "video
   1280×720 decoding, HTML panels rasterised" names no artifact. Fix: a camera
   at e.g. `[[0, 3, -8], [0, 8, 17.5]]`, shoot after `video.readyState ≥ 2`
   and panel frames > 0, assert canvas maps on both panels in `--match`.
6. **Stair balustrade is a 5 m solid slab** (build.py line 440,
   `DECK_H..TOP_H + 1.0`): from the gate it hides the W block letter and the
   stair (`stadium-gate.png`; the real player walks 4 m and stops at x 78.02),
   and it is the pale wall in `stadium-stair.png`. Fix: a 1.0–1.1 m rail that
   steps with the stair; put a STANDS ↑ sign at the stair foot facing the gate
   (the current one is 12 m off the path, facing south).
7. **SDK failure is sticky.** `sdkPromise ??= import(url)` (match-4dgsx.js
   line 21) keeps a rejected promise; ARCHITECTURE §6 says the module
   "retries on the next activation" — it does not (critic probe: second
   activation reports the same cached error). Fix:
   `sdkPromise = import(url).catch((e) => { sdkPromise = null; throw e; })`.
8. **East gate is neither a door nor a wall, and is labelled WEST GATE.**
   build.py makes `gate_e_L/R` but venue.json declares only `west`, so the
   east glass is not a collider (a visitor walks into it; only the world
   bounds stop them) and both gate faces use the `sign_gate` region
   (build.py 517–518). PROJECT requires ≥ 2 gates on the auto-door standard.
   Fix: declare `east` at `[26, 0, 0]`, add an EAST GATE atlas region.

### Improvements (ranked)

9. Exterior reads as a black slab; the far read from the boulevard spawn is
   two small white dots and the totem hides the sign (`city-spawn.png`,
   `stadium-approach.png`, `stadium-mast_night.png`). Add emissive banding or
   pier lights at the 12 m rhythm on the outer wall, a lit band under the
   sign, bigger/additive impostor heads, and clear the axis sightline (shift
   the totem board or lower the totem to wall height).
10. Roads draw calls: ~85 separate meshes (dashes, stripes, kerbs, bollards,
    posts) → 299 calls at the boulevard spawn vs the 221 baseline; PROJECT §5
    budgeted roads at ≤ 30 calls. Merge static boxes per material
    (`BufferGeometryUtils.mergeGeometries`), keep the merged meshes as
    colliders.
11. Bowl lighting is flat and over-bright for the city's look: seats
    (191,49,101), balustrade (98,104,131), block letters at (245,245,245) with
    bloom, walls a uniform lavender. Try 3–4 kW spots with a warmer tint,
    darker `rail`/`wall_lt` swatches, art-material emission 0.8 for the
    letters, and one accent (cyan step-edge strips) so the terraces read.
12. Scoreboard typography: "RMA0 — 0SGU" collision (`shots-match/
    screen_main.png`, 140 px score vs 84 px codes at x=160); secondary lines
    22–30 px at 1024 (below the ≥ 24 px @512 rule); Menlo-only font stack (on
    Windows/Linux the layout will differ); header moiré at grazing angles.
    Widen the columns, min 48 px, `ui-monospace, Menlo, Consolas, monospace`,
    anisotropy 8.
13. Verification gaps: no mocked-feed contract (live mount/unmount/outage
    untested — the architecture promised it), no 10-minute soak, no
    attribution or real-audio assertion, `venue-bench.mjs` samples before the
    match mounts, screenshots depend on the live feed clock so the promised
    pixel-diff cannot be stable, "tier 2 modules active" passes even when the
    SDK failed (`active || failed === false`), CI never run, the tier-2 call
    ceiling (480) was raised in code before STATE recorded it (now recorded).
14. Concourse is unlit (aerial: the ring is black) while the gate floor blows
    out under an 18 cd point at 4 m. Stronger `tile_emis` grout, four low
    emissive wall strips instead of one hot point.
15. Docs drift: PROJECT §3 still lists `stadium.js/match.js/stadium.html/
    stadium-*.mjs/stadium.yml` and `docs/stadium/ARCHITECTURE.md` (built as
    `venues.js`, `venue.html`, `venue-*.mjs`, `venues.yml`,
    `docs/venues/ARCHITECTURE.md`); ARCHITECTURE's example `near_m 18` vs 30
    in venue.json; STATE rows "impostor from spawn", "city walkthrough",
    "panels rasterised" cite no file. §7's rule: every claim names its
    evidence.
16. Small: the stair landing's open end is a 3.75 m unguarded drop onto the
    concourse; the back of the main sign reads as a floating slab from
    stand_high; the SDK fixture board is a bright sprite from above; the
    fixture-only bundle path prints a raw CDN URL on the scoreboard;
    `lights.cap: 12000` makes the venue light cap a no-op (say so or drop
    it); `venue.json` inlines 600 seats (3.2k lines) — fine, but generated
    files could live beside, not inside, the authored manifest.

## What holds up

- The bowl from inside (stand_low, stand_high, pitchside) is coherent with
  the city: cyan trims, gold scoreboard frame, magenta/gold/cyan hoardings on
  dark plates, 0.25 m boxes, legible signage from every seat.
- The check pipeline is unusually thorough: GLB budgets, node contract, UV
  orientation, tier cycle with GPU memory compared across two cycles, dock
  and scoreboard truth against a real bundle, dispose leaving no iframes.
- Fail-closed works as designed: NO SIGNAL on the scoreboard, "4dgsx.com is
  not answering — the pitch waits", zero page errors, the venue stands.
- The real player climbs the 0.25 m stair, passes the doorway, walks the
  gangway and the aisles, and reaches a seat in ~10 s; the gate opens at 3 m
  and closes behind.
- Performance headroom is large: ≥145 fps worst camera with a replay on an
  M3 Pro at 1080p; tier 0 costs 2 meshes.

## Not assessable from the evidence

- Touch/coarse-pointer behaviour (countdown-only path): needs a mobile
  emulation run with a screenshot and `state.coarse === true`.
- Live kick-off mount/unmount through `schedule()`: needs the 16:01 London
  slot observed, or a mocked feed in the check.
- Audio placement (crowd/commentary positions, ducking of the city loop):
  needs a run with audio unlocked and the media state captured.
- Presence at 150 (M2 by decision).

## Critic artifacts (session scratchpad, not in the repo)

`shots-now/*.png` (11 cameras, 00:13:40 GLB), `bench` output (idle + match),
`fail-screen_main.png`, `city-spawn.png`, `city-forecourt.png`,
`city-seat.png`, walk logs, `venue-check-critic.json`,
`venue-check-rebased.json`. Reproduction steps for each are in the issue
text above; nothing depends on the scratchpad.
