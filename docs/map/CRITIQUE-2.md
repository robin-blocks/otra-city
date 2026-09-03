# The map — critique 2 (2026-09-03)

Reviewed: the round-1 fixes, uncommitted at the start of this pass and landed
during it as `fcb241b` ("fix: what the critic found — a frozen record of every
held lot, a sign on a claim, a dark kerb, plates you can read from the spawn").
Same rules as round 1: nothing edited, no state-changing git, no `npm run map`
or `manifest`; scratch copies under the session scratchpad for anything that
writes; pictures from my own headless-Chrome script (the Browser pane was
hidden), not the builder's. The builder's walkthrough re-run (`qa4.log`,
`qa-out/report.json`) finished during the pass: 35/35.

## (a) Verdict

**All five blocking criteria still pass, on fresh evidence.** The round-1 top
item is closed the right way: the registry now freezes `placed: { id: { x, z,
yaw } }` at assignment, and `build-map --check`, the manifest builder and
`map-check` all compare the plat against that record — my T3 bypass (delete the
plat, regenerate, `--check`) now fails with ten "was placed at … and this map
puts it at …" lines, and a plat that disagrees with `placed` makes the manifest
builder throw. Of the twelve round-1 items, **ten are closed, two partially**
(the docs' example lot, the plate-post model — see (d)). **Usability now clears
7**: a "SINGULARITY BOULEVARD" plate stands 2 m from the spawn facing the
visitor (at the edge of the default chase-camera frame, fully in view after one
step or a slight orbit), every claimed board carries its address at 24 px
semibold (legible at 3–4 m), `vacant[]` and the claim page read in address
order, a wrong `/lot/<id>` says so, and the plan pans on a phone. Scores: visual
8, usability 7, maintainability 8, accessibility 7. The fixes introduced four
small new issues, none above nice-to-have; the top of the new list is a latent
gap in the plate-clash check the round-1 fix created.

## (b) Blocking criteria (round 2)

| criterion | result | evidence |
|---|---|---|
| Correctness — `map:check` all PASS | **PASS** | `npm run map:check` → 18 PASS, "map ok" (two new checks: "registry: every held lot is frozen where the plat puts it — 10 placed" and "nothing the city puts up stands on a lot"; 135 posts). `node scripts/build-map.mjs --check` → current. `node scripts/sync-docs.mjs` → agree. `node --check` on the six changed scripts → ok. |
| Correctness — `npm run validate` green | **PASS (partially re-verified)** | Not run (it writes). Manifest step: scratch rebuild → `index.json` and `lots.json` **byte-identical** to the committed ones (probe N0), so `npm run manifest` is a no-op with the new `placed` block. Plots: 10/10 load in my headless session, `errors 0`. `map-check`: above. |
| Correctness — every existing plot at the same world position | **PASS** | `public/plots/lots.json` `placed` now records, for all ten, exactly the positions I re-derived in round 1 from the old `x`/`side` + `FRONT_LINE = 6.5` (e.g. `boulevard-8: (0, 11.5, π)`, `boulevard-7: (0, −11.5, 0)`); `map-check` asserts the plat still puts them there. The plat itself did not change in this round (`git diff --stat public/city/lots.json` empty). |
| Walkability — every road end to end, every standing point, real controller | **PASS** | `qa-out/report.json` (builder's re-run on the fixes): 7 roads / 8 segments arrived, 34 standing points clear, `/lot/boulevard-2` lands at (36, 0, 4.8). Re-derived: `map-check` fence checks pass with the bays' new 2 m boxes; both bay lamps are inside the fence (`fenceContains` true at (64.75, ±72.75)); the new sign, both repeaters and the kerb strip are all ≥ 5.9 m from any standing point (numbers in (d)). |
| Walkability — `venue-check` route from the city spawn | **PASS (carried from round 1)** | Not re-run. The round-1 run passed (369 samples, no gap); the only fence change since is the bays' boxes (`city-map.mjs` `fenceShapes`, bays only), which are 60 m off the spawn→forecourt route; the road corridors, the `rb` disc and the west plaza are byte-unchanged. |
| Reliability — no uncaught errors, quiet console, manifest fails loudly | **PASS** | Headless session `stats().errors = 0` after eight teleports; report: "the console stayed quiet". Scratch probes: N1 (plat says boulevard-8 at x = 12, `placed` says 0) → `Error: registry: boulevard-8 (city-hall) was placed at (0, 11.5) and the map now puts it at (12, 11.5). A claimed address never moves`; N6 (registry → `mars-1`) → throws as before. |
| Performance — budgets hold, light count constant, vacant ≤ 12 calls | **PASS** | Report: boulevard 233 calls / 95,288 tris vs 370 / 115,840 (base 12,000 + 10,000 × 10 + 160 × 24); shopfront 82 / 14,260 vs 106 / 23,340; vacant 8 calls; lights 12 and programs 33 constant over the 20 s walk. The two repeater plates and the kerb strip added 1 call and ~100 tris at the shopfront pose (81 → 82, 14,036 → 14,260). Headroom now 18 % and 39 %; a second district like this one (~25 vacant, ~350 m) costs ≈ 4,000 + ~3,500 tris and fits both. |
| Integration — dry run, CI allocation, status endpoint agree; docs describe what runs | **PASS** | Four dry runs against `scripts/dev-api.mjs` with the new registry shape (`registry.lots` is still slug → id; `placed` is ignored by the API as it should be): none → boulevard-1; boulevard-8 → held; boulevard-2 → free; update of signal → kept at boulevard-3. Scratch manifest: N3 request boulevard-13 → assigned and frozen `{x: −36, z: −11.5, yaw: 0}`; N4 plot removed → registry entry and frozen record dropped, lot vacant again; N5 held request → boulevard-1 with the note. `ARCHITECTURE.md` §3 now documents `placed` and §2 the repeater/short-close plate rules; `docs/venues/ARCHITECTURE.md:36` corrected. |

## (c) Scored categories (round 2)

**Visual quality — 8 / 10** (was 7). The dead end now reads as an end: a cyan
emissive strip along the kerb's top spans the road from kerb to kerb, visible
from 7 m (`dead-end-far`) and 4 m (`dead-end-near`) where round 1 saw black.
The "STADIUM →" sign stands past lot 2's east edge on the pavement, the pad
outline clear of it (`stadium-sign`). Each close has one plate (`close-plate`).
The repeaters look like the end plates and sit beside the boards without
crowding them (`board-address`: PromptFrenzy's board and the x = 6 plate side
by side, 2.6 m apart). Still deducted: at street level the ring's asphalt is
invisible at night — the road is dashes, lamp heads and cyan pad outlines
(`gemini-repeater`); a lit kerb line along the ring's outer pavement would do
for the ring what the strip did for the dead end.

**Usability — 7 / 10** (was 6) — **clears the bar.** Why: (1) the road name is
now within 2 m of the spawn — repeater at (−18, −5.6), facing west, i.e. facing
the visitor who spawns at (−20, 0) facing east; in the untouched default frame
(`spawn-default`, camera 4.6 m behind and 0.6 m to the side) it is at the
extreme left edge, ~36° off-axis, and it is fully legible from 4.6 m in
`repeater-close`; one step or a small orbit brings it into view. (2) Every
claimed board now carries its address at 24 px semibold light grey
("7 Singularity Boulevard", "11 Singularity Boulevard" legible at 3–4 m in
`board-address` and `repeater-close`), so the road name is readable at every
lot, claimed or vacant, not only at the ends. (3) `vacant[]`, the claim page's
"Free right now" and the plan's table read boulevard-1, 2, 13, 14, 15, 16 …
(4) `/lot/mars-1` shows "no lot called "mars-1" — this is the boulevard; the map
is at otra.city/map". (5) The claim page's example is `vacant[0]`
(`boulevard-1`), and stays so for an unknown `?lot=`. (6) The plan pans on a
phone with readable numbers. What keeps it from 8: the spawn frame itself does
not contain a readable road name without moving (the HUD title at `/` still
says only "the city agents built" — the builder's own open issue 3), and the
Gemini Gate repeaters are the only ones on the ring (its other three sides are
≤ 70 m and get none, which is the rule working as designed).

**Maintainability — 8 / 10** (unchanged). Better: `placed` is the right state
in the right file (the claim record guards the claim), the manifest builder
freezes on assignment and drops on removal, bay lamps moved into
`city-map.mjs` (`bayLamps`) so the check sees them, and the docs follow.
Deducted: the bay's open side is now inferred from `cz > 0` in **two** files
(`city-map.mjs` `bayLamps` and `roads.js:278`) — a new duplication where round
1 had one; the bay *label* sign is still placed by `roads.js` alone
(`sign([b.min[0] − 0.75, …])`) and is in no check; the example lot
`boulevard-14` remains in three docs; the `64` / `0.28` / `1.34` duplications
stand; `map-check`'s new plate model skips clashes between any two plates of
the same road (new, (d) N1).

**Accessibility — 7 / 10** (unchanged). Boards: address 24 px → ≈ 8 cm line,
≈ 5.6 cm caps, legible at 4 m; vacant boards unchanged (crisp at 4 m). Plates:
unchanged sizes; the repeaters double the chances of one being within 10 m.
Phone plan: the canvas keeps 1200 px inside an `overflow-x: auto` scroller —
measured at a true 375 × 812 viewport: canvas 1202 CSS px in a 339 px wrapper,
4.5 CSS px per metre, lot numbers 7.7 CSS px (screenshots `map-phone`,
`map-phone-scrolled`: numbers and road names readable). Deducted: 7.7 CSS px
labels are still small for a touch screen, and the two **tables under the
plan overflow the page** at 375 px (`table right=411`, `document.scrollWidth
411 > 375`), so the whole page scrolls sideways by 36 px — the wrapper fixed
the canvas, not the page. The canvas still has no `role="img"`/`aria-label`.

## (d) The twelve round-1 items

| # | round-1 finding | status | evidence |
|---|---|---|---|
| 1 | `--check` could not see a moved lot in CI | **closed** | V1/V2: `from_m` 24→12 with the plat deleted and regenerated → plain run refuses (10 FAILs, nothing written), `--check` fails; V5 reversed chain, V7 junction, V6/V8/V9 benign edits behave as before. Residual (V3): a PR that also rewrites `placed` passes — inherent to any in-repo record, and the diff to `placed` is the reviewable tell; a CI line asserting no existing `placed` entry changes against `origin/main` would close even that (nice-to-have). N2: a registry entry with no `placed` is frozen at the next build wherever the plat then says — correct for a new assignment, worth knowing for a hand-edited registry. |
| 2 | STADIUM sign inside boulevard-2 | **closed** | `map.json` `signs[0].at = [43.2, 5.9]`: 5.9 m off the axis (pavement 4–6.5), inside no lot + 1 m margin, 12.2 m from the nearest lamp, 13.1 m from the end plate, 3.8 m from the crossing; `map-check` "nothing the city puts up stands on a lot" PASS with signs and bay lamps in the post list; screenshot `stadium-sign`. Residual: the bay *label* signs (`roads.js`, "COACHES"/"DROP-OFF") are still placed by the renderer only. |
| 3 | Dead-end kerb invisible at night | **closed** | `roads.js` adds a `bollard_cap` strip (emissive cyan, 0.14 × 0.04 × 12.7 m) on the kerb's top; `dead-end-far` / `dead-end-near` show a cyan line across the road where round 1 showed nothing. |
| 4 | Shopfront tris budget 12 % headroom, no term for the map's fixed costs | **closed** | `lib/qa-budgets.mjs`: `perVacant: 160` on both poses, bases 8,000 → 12,000 and 6,000 → 9,500 with the measurements in the comments; `limit(b, lots, vacant)` and the walkthrough passes `vacant.length`. Report: 95,288 / 115,840 and 14,260 / 23,340. |
| 5 | No road name readable from the spawn | **closed** | `namePlates` repeaters at right-kerb lamp positions on the left pavement, ≥ 20 m from an end plate, on segments > 70 m: boulevard (6, −5.6) and (−18, −5.6), Gemini Gate (145.6, ±12) — 18 plates, `roads.plates 18` in the client and in the report. Clearances: nearest board 2.64 m (nearest post 2.61 m), nearest standing point 5.95–6.05 m, nearest lamp 11.8 m. Claimed-board address 24 px `#b9bcd6` semibold. Screenshots `repeater-close`, `board-address`, `gemini-repeater`, `spawn-default` (edge of frame). |
| 6 | Three City Hall scripts read `side` | **closed (not run)** | `grep` for `side` in `poc/city-hall/*.py` → none; `pictures.py` `lot_box(v["x"], v["z"])` + `on_blvd` filter, `film.py` `(lot["x"], −lot["z"], lot["yaw"])`, `assembly_video.py` filters `road == "boulevard"` and signs `z`; `python3 -m py_compile` on all four → clean. Blender not run, as the builder says. |
| 7 | Plan page a thumbnail on a phone | **closed, with a residual** | `.plan-wrap { overflow-x: auto }`, `#plan { min-width: 1200px }`; measured at 375 px (above); the page's tables still overflow the viewport (new item N3). |
| 8 | `rankFree` ties by id string | **closed** | `city-map.mjs:212` `road.localeCompare || n − n`; `vacant[]` = boulevard-1, 2, 13, 14, 15, 16, west-2, west-3, west-1, west-4, north-1, south-4 …; claim page list matches; scratch N0 identical. |
| 9 | Two plates per close | **closed** | `namePlates`: one plate when `tB − tA < 20`; close-n (54.4, 55.5) and close-s (65.6, −55.5) only; screenshot `close-plate`. |
| 10 | Plate modelled as a 0.1 m centre post | **partially closed** | `map-check` `plateParts`: posts at ±0.62 m (r 0.05) and the body (r 0.8) — the clearance test is now right. But the "no post on a post" loop skips any pair whose `what` strings match and start with "plate" (`scripts/map-check.mjs:278`), and `what` is `plate <road>` — so two *different* plates of the same road are never compared (new item N1). No violation today (same-road plates are ≥ 20 m apart by construction). |
| 11 | North-side boards moved 6.8 m, unrecorded | **closed (recorded)** | STATE.md "Not changed, recorded" names the move and why. |
| 12 | `/lot/<unknown>` silent; docs' example is a real free lot | **closed / partially** | Toast verified live: "no lot called "mars-1" — this is the boulevard; the map is at otra.city/map" at the spawn. Claim page example = `vacant[0]` verified. `boulevard-14` remains in `docs/agent-context.md:68,74`, `docs/submission.md:258`, `public/docs/plot-spec.json:46,240` — static docs cannot be dynamic, but the spec's `manifest_example` is the one an agent copies wholesale; a placeholder there (`"<road>-<n>"` in prose, a clearly fake but well-formed id in the example) would finish this. |

Round-1 items 13–14 (duplicated constants, stale venues doc line): the venues
doc line is fixed; the constants stand and gained one (N2).

## (e) New issues introduced by the fixes — ranked

N1. **`map-check` never compares two plates of the same road.** — nice-to-have
    *Where:* `scripts/map-check.mjs:278` (`if (posts[i].what === posts[j].what && posts[i].what.startsWith('plate')) continue;`), `what` = `plate <road id>` for all three parts of every plate of that road.
    *How observed:* code reading; the intent was to skip a plate's own three
    parts, the effect is to skip every plate pair on a road. Latent: the
    repeater rule keeps same-road plates ≥ 20 m apart, but a future `map.json`
    that puts two segments of one road end to end at a plain node (no
    roundabout) would place two end plates 4 m apart and the check would not say.
    *Fix:* give each plate an index (`plate boulevard#3`) and skip only equal
    indices.

N2. **The bay's open side is inferred in two places.** — nice-to-have
    *Where:* `public/js/city-map.mjs` `bayLamps` (`openSouth = (min+max)/2 > 0`) and `public/js/roads.js:278` (`openSouth = cz > 0`).
    *How observed:* diff; the round-1 note about the heuristic now applies twice.
    *Fix:* a `bays[].open: "south"|"north"|…` field, read by both, or export one
    `bayOpenSide(b)` from the module (and place the label sign with it, so the
    check sees it too).

N3. **The plan page's tables push a 375 px page sideways.** — nice-to-have
    *Where:* `public/map.html` `table { width: 100% }` with four columns and `td.id { white-space: nowrap }`.
    *How observed:* headless 375 × 812: `document.documentElement.scrollWidth
    411`, `table right=411`, `a.walk right=403`; `/claim` and `/about` at the
    same width do not overflow. The canvas wrapper is fine (`wrapScroll 1202`
    inside `wrapClient 339`).
    *Fix:* wrap each table in the same `overflow-x: auto` wrapper, or let the
    position column wrap / drop it under 480 px.

N4. **Repeaters stand across the pavement mid-block.** — nice-to-have
    *Where:* `namePlates` repeaters use the same `s.half − 0.9` offset and
    along-road facing as end plates.
    *How observed:* the plate body spans 1.6 m of the 2.5 m pavement; at x = 6
    it leaves 0.8 m at the kerb between PromptFrenzy's and Halberd's frontages
    (`board-address`). Never blocking (the road is walkable), but every visitor
    walking the south kerb line now meets a plate every ~24 m as well as at the
    ends.
    *Fix:* accept (it is what makes the plate face the spawn), or set repeaters
    at the pavement's outer edge (`s.half − 0.8`) to leave 0.9 m.

Also cosmetic: the walkthrough label "a street name plate at both ends of
every segment of every named road (18)" now counts repeaters and single-plate
closes; the number is right, the words are not.

## (f) Not verified, and why

- `npm run validate` and `npm run qa` end to end — as in round 1 (they write);
  the manifest step is proven byte-identical and the builder's re-run report
  was read.
- `venue-check` — not re-run this round; the fence diff is bays-only, off the
  route.
- The Blender lane (`poc/city-hall/*.py`) — compiled, not run.
- Production routing and Vercel bundling — unchanged since round 1.

## Evidence log (abridged)

- Working tree: `npm run map:check` 18/18; `build-map --check` current;
  `sync-docs` agree; `node --check` ×6 ok; `py_compile` ×4 ok.
- Move guard V1–V9 (scratch): V1 refuse; **V2 (T3 repeat) refuse both ways**;
  V3 rewrite-`placed` passes (recorded); V4 no-`placed` registry passes
  `build-map` alone (map-check's frozen check would then demand a manifest
  run, which freezes the plat as is); V5 refuse; V6/V8/V9 stale only; V7
  "no longer affords".
- Manifest N0–N6 (scratch): identical; N1 throw on a disagreeing plat; N2
  freezes 10; N3 freezes on assignment; N4 drops on removal; N5 fallback +
  note; N6 throw.
- Geometry (node, `city-map.mjs`): 18 plates listed with kinds; repeater
  clearances; sign 5.9 m off-axis, outside every lot + margin; bay lamps in
  the fence; `vacant[]` order; one dead end.
- Dry runs ×4 against `dev-api.mjs` on :8792, killed afterwards.
- Dev server (`javascript_tool`): `/lot/mars-1` toast text and spawn position;
  `/claim` example `boulevard-1`; `/claim?lot=mars-1` example unchanged and
  "not a lot on the map"; `/map` `min-width 1200px`, wrapper `overflow-x auto`.
- Headless Chrome (my script, 1280 × 720 and 375 × 812): `spawn-default`,
  `repeater-close`, `dead-end-far`, `dead-end-near`, `stadium-sign`,
  `board-address`, `close-plate`, `gemini-repeater`, `map-phone`,
  `map-phone-scrolled`; `stats`: 18 plates, 37 lamps, 55 sources, pool 8,
  errors 0; overflow probe on `/map`, `/claim`, `/about`.
- Builder's `qa-out/report.json`: 35/35; budget numbers quoted above.
