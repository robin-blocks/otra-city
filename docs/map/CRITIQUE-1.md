# The map — critique 1 (2026-09-03)

Reviewed: commit `6d90b4a` on `claude/city-map-expansion-lots-4ce32d` (PR #37). The
builder landed `768142c` while this ran (STATE.md + the walkthrough forcing venues
to tier 0); nothing below changes because of it. Rubric: `PROJECT.md` §8. Nothing
in this report is taken from `STATE.md`; every claim names the command, the page or
the file:line it was re-derived from. Scratch runs used copies of the scripts under
the session scratchpad and never touched the working tree (`git status` clean
throughout).

## (a) Verdict

**All five blocking criteria pass on independent evidence**: `map:check` 17/17,
the manifest rebuild is byte-identical on the current tree, every one of the ten
plots is at its launch position (old `x`/`side` → new `x`/`z`/`yaw` re-derived from
the old `FRONT_LINE = 6.5`), the light pool holds at 8 lit / 45 programs across
four road walks, vacant furniture costs 8 draw calls, the dry run / manifest
allocation / status endpoint say the same thing about a requested lot in ten
cases, and my own `venue-check` run reaches the forecourt from the city spawn (369
samples, no gap). Three of the four scored categories clear 7 (visual 7,
maintainability 8, accessibility 7); **usability scores 6** because a cold visitor
at the spawn cannot read which road they are on — the boulevard's two plates are
30 m away and the ten claimed boards between them carry the address at 4 cm.
The highest-impact finding is that the one promise the brief ranks first, "a
claimed address never moves", is enforced only against a stale plat on the
developer's disk: in CI, `build-map --check` compares a PR's map against the PR's
own `lots.json`, so a moved lot committed with its regenerated plat passes
(demonstrated below). Five should-fixes, all small; no blocker.

## (b) Blocking criteria

| criterion | result | evidence |
|---|---|---|
| Correctness — `map:check` all PASS | **PASS** | `npm run map:check` → 17 PASS, "map ok" (34 lots, 10 held, 24 vacant, longest route 246 m, 93 posts). `node scripts/build-map.mjs --check` → "lots.json is current". `node scripts/sync-docs.mjs` → "docs/ and public/docs/ agree". |
| Correctness — `npm run validate` green | **PASS (partially re-verified)** | Not run by me (it writes). Its three parts: per-plot GLB checks — all 10 plots load in the client (`stats().plots 10/10`, `errors 0`); the manifest step — `build-manifest.mjs` run on a scratch copy of the tree produces an `index.json` and a `lots.json` **byte-identical** to the committed ones (probe M0), so `npm run manifest` is a no-op; `map-check` — above. |
| Correctness — every existing plot at the same world position | **PASS** | `git show HEAD~1:public/plots/lots.json` (x, side) vs `public/plots/index.json` (x, z, yaw): all 10 map as `z = side × 11.5`, `yaw = side > 0 ? π : 0`, which is exactly the old client's `p.side * (FRONT_LINE + 5)` / `rotation.y = p.side > 0 ? Math.PI : 0` with `FRONT_LINE = 6.5` (old `street.js:6`). Launch lamps re-derived from old `street.js:130-131`: x = ±6, ±18, ±30 on the same kerbs; the map adds ±42. Caveat recorded as issue 11: the five north-side **info boards** moved 6.8 m (old `street.js:143` put every board at `x + 3.4`; `BOARD_LOCAL` is lot-local, so `yaw = π` mirrors it to `x − 3.4`). |
| Walkability — every road end to end, every standing point, real controller | **PASS** | `qa-out/report.json`: 7 roads / 8 segments "arrived: true", "every lot's standing point is clear and its frontage is walkable (34 lots)" blockedCount 0. Re-derived in the live client: `teleport('east-3')` lands at (144.8, 0.29, 6) on the pavement facing the lot; `/lot/west-2` lands at (55.2, 0.3, −16) with "2 Claude Code Circus — vacant · claim it at …" in the HUD; `/lot/boulevard-8` at (0, 0.26, 4.8) with City Hall's tagline. The boulevard's west walk stops at x = −53.12 = kerb face −53.4 + avatar 0.28 (report leg `to: [-53.12, 0]`), so the dead-end kerb is a real collider. |
| Walkability — `venue-check` route from the city spawn | **PASS (verified)** | My run: `node scripts/venue-check.mjs --out <scratch>/venue-check.json` → "reachable from the city spawn — 369 samples from [-20,0] to [72,0], no gap in the walkable fence"; 600/600 seats; gates west:ok east:ok; "all venue checks passed". (`poc/out/venue-check.json` named in STATE.md does not exist in this checkout; the result matches STATE's numbers.) |
| Reliability — no uncaught errors, quiet console, manifest fails loudly | **PASS** | Live client `stats().errors = 0` after every walk; console: only the intentional dead presence socket (`ws://127.0.0.1:1`) and hidden-pane GL warnings, nothing from the map code. Scratch probe M1: registry `signal → mars-1` → `Error: registry: signal holds "mars-1", which city/lots.json does not afford`; M2: two slugs on `boulevard-8` → `Error: registry: lot boulevard-8 is held by more than one plot`. |
| Performance — budgets hold, light count constant, vacant ≤ 12 calls | **PASS** | Report: boulevard pose 233 calls / 95,196 tris (limits 370 / 108,000); shopfront 81 / 14,036 (90→106 / 16,000); vacant 8 calls (`inst:pad strip post marker board_post board_cube backing` + `vacant_boards:0`). My walks (4 s at full stick on the boulevard, west road, Claude Terrace, Gemini Gate, then the forecourt at tier 2): point 11 / spot 6 / lit 8 / pool 8 / programs 45 at every sample — constant; the +2/+4/+16 over the load-time 9/2/29 are the stadium's tier-1 lights, pre-existing and outside this PR. Headroom warning: issue 4. |
| Integration — dry run, CI allocation, status endpoint agree; docs describe what runs | **PASS** | Ten dry runs against `scripts/dev-api.mjs` on :8792 (signal's glb, new slugs): none → "you would get boulevard-1"; `boulevard-13` → free; `west-2` → free; `boulevard-8` → held by city-hall (FAIL); `mars-1` → not on the map (FAIL); `"BOULEVARD 13"`, `5`, `""` → "not a lot id" at the identity table; `boulevard-01` → not on the map; update of `signal` asking `boulevard-13` → kept at boulevard-3, "boulevard-13" ignored. Scratch manifest probes: M3 held request → `boulevard-1 … requested boulevard-8 is held by city-hall; nearest free lot instead`; M4 free request → `boulevard-13 … as requested`; M5 two requesters → alphabetical first wins, second falls back with the note; M6 unknown → fallback with the note; M7 a registry entry for a vanished plot is dropped and its lot returns to `vacant[]`. `api/plot-status.mjs:115-116` reports `position.{lot,address,road,x,z,yaw}` + `lot_url` from the manifest (read, not exercised — needs the deployed host). `agent-context.md`, `submission.md`, `plot-spec.json`, `claim.html`, the API strings and the manifest builder all state the same rule (requested if free, else nearest free + a note, update keeps). |

## (c) Scored categories

**Visual quality — 7 / 10.** Plates read as street signs: white plate, black
capitals, two black posts, subreddit on line 2 — "SINGULARITY BOULEVARD" and
"CLAUDE CODE CIRCUS" both legible from the stadium roundabout at ~7 m, and unlit
(`MeshBasicMaterial`) so they pop at night. Vacant lots read as claimable: cyan
pad outline, a spinning cyan marker at 1.9 m visible across the district, and a
board that says VACANT LOT / address / `lot west-2` / `otra.city/claim?lot=west-2`
(crisp at 4 m). The ring reads as a road around the ground from above (aerial
from (100, 75, −70): dashes and lamps trace all four sides, the lots outline it,
the lit pitch sits inside). Deductions: the dead-end kerb is invisible at night
(issue 3); the "STADIUM →" sign stands in vacant lot boulevard-2 (issue 2); at
street level the ring's asphalt is not visible at all — the road is a line of
dashes and lamp heads in the dark; each close carries two identical plates 6.5 m
apart (issue 9).

**Usability — 6 / 10.** Where the free lots are: yes — markers and cyan pads from
afar, boards with the id and claim url up close, the `map` link in the HUD, and
`/lot/<id>` puts the address in the HUD title. Which road you are on: not from the
spawn. The boulevard is plated only at its ends (x = 49.5 and x = −52,
`namePlates`, `city-map.mjs:342-353`); the spawn at x = −20 is 30 m from the
nearest; lots 3–12 around it are all claimed and their boards carry the address at
18 px (≈4 cm caps, `street.js:81-84`) — unreadable beyond ~2 m. The map page is
clear on desktop; on a phone it is a thumbnail (issue 7). The "Free right now"
list on `/claim` reads `boulevard-1 · boulevard-13 · boulevard-14 · boulevard-2`
(issue 8). A wrong `/lot/<id>` silently lands you at the spawn (issue 12).

**Maintainability — 8 / 10.** Adding a road is a `map.json` edit: T6 (move
`blvd_w` to −66) plats 18 boulevard lots with 1–16 unchanged; a new road is a node
pair + a road entry + a roundabout entry, and lamps, plates, dead ends, the fence,
the plat, the QA expectations and the plan all derive from it (re-derived every
one in node from `city-map.mjs` and matched the client: 37 lamps, 16 plates, 1 dead
end). The guard refuses the edits it should (T1 phase shift, T4 reversed chain, T5
renamed id, T7 a junction swallowing held lots 11/12) and allows the ones it should
(T8 rename, T9 bigger roundabout). Deductions: hand-placed absolute coordinates for
`signs`, `bollards`, `crossings`, `aprons`, `bays` do not follow the roads, and
`roads.js` places two things (`signs`, bay lamps) that `city-map.mjs` does not know
about, contradicting its own header (issue 2); `from_m` is hand-tuned per road; the
bay's open side is inferred from `cz > 0` (`roads.js:278`); `64` per atlas is
duplicated (`street.js:22` vs `qa-walkthrough.mjs:224`), `0.28` avatar radius
(`map-check.mjs:240` vs `player.js:30`), `1.34` board height (`street.js:107` vs
`qa-walkthrough.mjs:360`); three `poc/city-hall` scripts still read `side`
(issue 6); the plan's "left" is the visitor's right everywhere — documented in
three places, still a tax on every reader.

**Accessibility — 7 / 10.** Text sizes in metres (plate 1024 × 192 px on
1.6 × 0.3 m; board 512 × 320 px on 1.7 × 1.06 m): plate name ≈ 9.6 cm caps,
subreddit ≈ 3.7 cm; board heading ≈ 12 cm, address ≈ 6 cm, claim url ≈ 5 cm,
claimed board's address ≈ 4 cm. Observed: at ~4 m every line of a vacant board is
crisp; at the `/lot/<id>` landing distance (camera 10 m back) the heading and the
address read, the url does not; the plate name reads at 7 m, the subreddit only
within ~3 m. Contrast is high everywhere (black on off-white; cyan/white on
near-black). The walkthrough's phone HUD check passes (stick in view, no
horizontal overflow). The plan canvas has no `aria-label`/`role="img"`; the tables
under it carry the same data, which is what a screen reader gets. On a 375 px
phone the plan is illegible (issue 7).

## (d) Ranked issues

1. **`build-map --check` cannot see a moved lot in CI.** — should-fix
   *Where:* `scripts/build-map.mjs:32-42` (`before` = the plat on disk).
   *How observed:* scratch copy of `scripts/build-map.mjs`, `public/js/city-map.mjs`,
   `public/city/*`, `public/plots/lots.json`, `public/venues/index.json`. T1
   (`from_m` 24 → 12) and T2 (plain run): ten "would move" FAILs, nothing written —
   correct. **T3**: delete `lots.json`, plain run → "wrote public/city/lots.json (34
   lots on 5 roads)" with every held lot one pitch east; then `--check` → "lots.json
   is current", exit 0. That is the state a PR is in: its map and its regenerated
   plat agree with each other, and nothing compares them to `main`. `map-check`'s
   "manifest lots agree with the plat" only forces the PR to regenerate the manifest
   too, after which the moved positions ship.
   *Fix:* freeze the position with the claim — write `{ lot, x, z, yaw }` per slug
   into the registry at assignment and have `--check` and `map-check` compare the
   plat to the registry's frozen `x/z/yaw` (the file that records the claim guards
   the claim, whatever is on disk). Alternative with no format change: the
   walkthrough workflow fetches `origin/main:public/city/lots.json` and passes it as
   `--base=<file>`.

2. **The "STADIUM →" sign stands inside vacant lot boulevard-2.** — should-fix
   *Where:* `public/city/map.json:365-372` (`signs[0].at = [40.6, 7.4]`);
   `public/city/lots.json:89` (`boulevard-2` at (36, 11.5), yaw π → envelope
   [31, 41] × [6.5, 16.5]); `scripts/map-check.mjs:234-239` (posts list has no
   signs); `public/js/roads.js:284` (bay lamps placed by the renderer).
   *How observed:* node one-liner over `lotRect(boulevard-2)`: the sign is inside
   the envelope, 5.3 m from the lot's standing point; client view from (46, 0)
   facing NW shows the sign at the pad's corner. The old street had no lot at
   x = 36 (old registry: vacant only at x = −36); the plat now affords
   `boulevard-1/2` there, and `boulevard-1` is `vacant[0]` — so the next unrequested
   claim lands beside the crossing and its twin holds the sign. When boulevard-2 is
   claimed the sign is inside the building. `signs` are excluded by neither the
   plat nor `map-check`; nor are the two bay lamps `roads.js` invents at
   (64.75, ±72.75).
   *Fix:* move the sign east of the lot (e.g. `[42.5, 7.4]` clears boulevard-2's
   1 m margin and west-3), and add `signs` and the bay lamps to `map-check`'s post
   list and to the plat's exclusion boxes (or move their placement into
   `city-map.mjs` so the header comment in `roads.js` is true). Decide whether
   boulevard-1/2 are wanted at all — the brief said "extended west two lots"; the
   plat also added two east. A `reserved` box is one line if not.

3. **The dead-end kerb is invisible at night.** — should-fix
   *Where:* `public/js/roads.js:213-215` (kerb block, paving colour 0x24222c,
   `MeshStandardMaterial`); `public/js/city-map.mjs:290` (a lamp keeps 4 m from a
   trimmed end, so the last boulevard lamp is at x = −42, 11.7 m from the kerb at
   −53.7).
   *How observed:* client at (−46, −2) and (−50.5, 0) facing west: the plate and
   the lot-15/16 boards render; the kerb does not — the frame is black where it
   stands. `qa-out/02-…png` (the walk's end) is black for the same reason. The
   visitor is stopped at x = −53.12 by something they cannot see: the #35 class of
   bug in a new costume. The decision recorded in ARCHITECTURE §4 was "a visible
   kerb block rather than an invisible wall".
   *Fix:* an emissive strip on the kerb's top (the vacant lots' `strip` kind is
   already a cyan emissive box), or let `roadLamps` place a lamp 2 m before an
   `end` end, or both.

4. **Shopfront triangle budget has 12 % headroom and the next district will breach it.** — should-fix
   *Where:* `lib/qa-budgets.mjs:44-45` (calls re-based 30 → 46 with a reason; tris
   base left at 6000 + 1000/lot).
   *How observed:* report: shopfront 14,036 tris vs limit 16,000 (was 6,970 before
   the map). The +7,066 is instanced furniture drawn from every pose (an
   `InstancedMesh`'s bounding sphere spans the city): ~80 dashes, 37 lamps, 16
   plates, crossings, kerb ≈ 3,000 tris, plus 24 vacant lots × ~158 tris ≈ 3,800.
   Nothing in the per-*claimed*-lot slope covers either. A second district like this
   one (~25 vacant lots, ~350 m of road) adds ≈ 5,900 tris with zero claimed lots →
   19,900 > 16,000: red. The boulevard pose (95,196 / 108,000) survives one such
   district, not two. The calls re-base itself is justified: the measured 65 → 81 is
   exactly the ~16 always-drawn instanced kinds and the reasoning in the file is
   right.
   *Fix:* re-base tris the same way (6000 → ~12,000) with the reason, and add a
   per-vacant-lot term (`vacantTris ≈ 160`) so a map edit and a claim are both
   accounted for.

5. **From the spawn a cold visitor cannot read which road they are on.** — should-fix
   *Where:* `public/js/city-map.mjs:342-353` (`namePlates`: ends of segments only);
   `public/js/street.js:81-84` (claimed board address 18 px);
   `public/index.html:407-420` (HUD title carries no road at `/`).
   *How observed:* spawn (−20, 0): nearest plate 30 m (x = 49.5 and −52); lots 3–12
   around the spawn are all claimed; their boards' address is ≈4 cm caps, illegible
   beyond ~2 m in the client. The road name is readable only after walking to a
   vacant board (x = ±36) or a plate.
   *Fix:* repeat a plate pair every ~60 m on a segment longer than that
   (`namePlates` already knows `s.L`), draw the address on claimed boards at the
   vacant boards' 26 px, and/or name the road in the HUD tagline at the default
   spawn.

6. **Three City Hall authoring scripts still read `side`.** — should-fix (small)
   *Where:* `poc/city-hall/pictures.py:336,345,347,548,552`, `film.py:97-98,111-112`,
   `assembly_video.py:123,134,238,321` — all index `lot["side"]` from
   `public/plots/index.json` (`pictures.py:28`, `film.py:18`), which no longer has
   it. `build.py` was migrated; these were not.
   *How observed:* `git grep -n '\.side\b\|"side"'`; the manifest diff shows `side`
   gone from every lot. Next rebuild of City Hall's pictures/film → `KeyError`.
   *Fix:* derive as `build.py:596` does (`lot["z"]`, `yaw`), or a two-line shim.

7. **The plan page is a thumbnail on a phone.** — nice-to-have
   *Where:* `public/map.html:17,36` (1400 × 900 canvas at `width: 100%`).
   *How observed:* `resize_window mobile` (375 × 812): canvas 341 CSS px wide,
   1.3 CSS px per metre, lot numbers 2.2 CSS px, road names ≈ 4 px — illegible
   (screenshot); the tables below are fine; no horizontal overflow.
   *Fix:* `min-width: 900px` on the canvas inside an `overflow-x: auto` wrapper, or
   draw at a device-scaled size.

8. **`rankFree` breaks ties by id string, not by address.** — nice-to-have
   *Where:* `public/js/city-map.mjs:207` (`a.l.id.localeCompare(b.l.id)`) vs the
   comment at `:201` and `scripts/build-manifest.mjs:15` ("ties broken by address").
   *How observed:* `vacant[]` order: boulevard-1, boulevard-13, boulevard-14,
   boulevard-2 (all 37.8 m from the centre) — "13" < "2" as strings. The second
   unrequested claim lands at x = −36 while boulevard-1's twin at x = +36 stays
   empty; `/claim`'s "Free right now" list reads the same way.
   *Fix:* tie-break on `(road, n)` numerically.

9. **Each close carries two identical plates 6.5 m apart.** — nice-to-have
   *Where:* `public/js/city-map.mjs:349-350` (a plate at both ends of every
   segment); `map.json` closes are 18 m stubs with `lots: null`.
   *How observed:* `namePlates` → close-n at (54.4, 55.5) and (54.4, 62.0), close-s
   likewise; `qa-out/03-…png` shows both "ANTHROPIC CLOSE" plates side by side.
   *Fix:* skip the dead-end plate when the trimmed segment is shorter than ~20 m, or
   plate only the junction end of `kind: "bay"` roads.

10. **`map-check` models a plate as a 0.1 m post at its centre.** — nice-to-have
    *Where:* `scripts/map-check.mjs:236` (`r: 0.1`) vs `public/js/roads.js:34,316`
    (posts at ±0.62 m, body 1.6 m).
    *How observed:* the clearance test needs 0.58 m from the plate's *centre*; a
    standing point 0.6 m from the centre along the plate's width axis would pass
    while standing inside a post. No current violation (nearest standing point to
    any plate post is 4.0 m, boulevard-15; nearest lamp 6.16 m, boulevard-1) — a
    latent gap, not a bug today.
    *Fix:* check both posts and the body as a segment.

11. **Five claimed boards moved 6.8 m and STATE.md calls the migration a physical no-op.** — nice-to-have (record it)
    *Where:* old `public/js/street.js:143` (`p.x + 3.4` for both sides) vs
    `public/js/city-map.mjs:27` `BOARD_LOCAL = [3.4, 5.45]` (lot-local; `yaw = π`
    mirrors x).
    *How observed:* `git show bc9d5f0:public/js/street.js`; the boards of 4dgsx,
    fernseed, city-hall, lattice and archive-9 are now at `x − 3.4`. Consistent
    (every board is on the visitor's right when facing its lot) and clear of every
    lamp by construction, but it is a change to the city's own furniture on five
    lots that nobody recorded; the City Hall poster/hologram lane may assume the
    old spot.
    *Fix:* a line in STATE.md "Decisions"; re-render the affected posters if they
    show the board.

12. **`/lot/<unknown>` falls through silently.** — nice-to-have
    *Where:* `public/index.html:200,407` (`lotById` null → default spawn).
    *How observed:* `/lot/mars-1` → position (−20, 0.01, 0), tagline "the city
    agents built", no console note.
    *Fix:* tagline "no lot mars-1 — see otra.city/map" and a `console.warn`.

13. **The example lot in the docs is a real free lot.** — nice-to-have
    *Where:* `public/claim.html:141` and `public/docs/plot-spec.json:240` hard-code
    `"lot": "boulevard-14"`; `claim.html:220` only replaces it for `?lot=`.
    *How observed:* boulevard-14 is vacant; every agent that copies the example asks
    for it — the first wins, the rest fall back with a note.
    *Fix:* the claim page already fetches the manifest: show `vacant[0]` when no
    `?lot=`; in the spec use a placeholder id and say so.

14. **Duplicated constants and a stale doc line.** — nice-to-have
    *Where:* `64` (`street.js:22` `ATLAS_COLS²` vs `qa-walkthrough.mjs:224`),
    `0.28` (`map-check.mjs:240` vs `player.js:30`), `1.34` (`street.js:107` vs
    `qa-walkthrough.mjs:360`), `roads.js:278` (`openSouth = cz > 0` — a bay east or
    west of a road opens the wrong side); `docs/venues/ARCHITECTURE.md:36` still says
    `world.js` holds "boulevard constants, road graph" and "imports nothing but
    three" (it now imports `city-map.mjs` and holds no constants).
    *Fix:* export `BOARDS_PER_ATLAS`, `AVATAR_RADIUS`, `BOARD_Y` from the modules
    that own them; give bays an `open` side; one line in the venues doc.

## (e) Not verified, and why

- `npm run validate` end to end — it writes `public/plots/index.json` and
  `public/plots/lots.json`; I verified the manifest step is byte-identical in a
  scratch copy and that every plot loads, not the per-plot GLB checks.
- `npm run qa` — not re-run (five minutes, and the report plus screenshots were
  consistent with everything I drove by hand). The builder's `768142c` changes what
  it measures (venues forced to tier 0 for the whole walk); the budget numbers
  quoted above are from the run before that change.
- `api/plot-status.mjs` live — it fetches `/plots/index.json` from its own host;
  read only. `api/submit.mjs`'s `readFileSync(new URL('../public/city/lots.json',
  import.meta.url))` in the Vercel bundle — same pattern as the existing
  `trusted.json` read that works in production, but not exercised here.
- Production routing — `vercel.json` carries `/lot/:id`, `/map`, `/api/lots`;
  the dev server applies the same rules (all 200 here); not tested on Vercel.
- Board legibility on a real phone — the phone HUD check passes and the boards'
  angular size at 2 m is the same as on desktop; not measured on a device.

## Evidence log (abridged)

- `npm run map:check` → 17 PASS; `node scripts/build-map.mjs --check` → current;
  `node scripts/sync-docs.mjs` → agree; `node --check` on the seven changed
  scripts → ok.
- Move-guard probes T1–T9 (scratch copy): T1/T2 refuse (10 "would move"); **T3
  bypass**; T4 refuse (reversed chain); T5 refuse (10 "no longer affords"); T6
  extend west → 18 lots, ids 1–16 stable; T7 junction at x = −30 → refuses
  (holds 11/12 "no longer affords"); T8 rename → only "stale"; T9 `outer_r` 9 → 12
  → only "stale".
- Manifest probes M0–M7 (scratch copy of the builder with every plot.json and a
  touched glb): M0 identical; M1/M2 throw; M3 held → boulevard-1 + note; M4 free →
  as requested; M5 alphabetical wins; M6 unknown → fallback + note; M7 ghost
  dropped.
- Dry runs (ten) against `PORT=8792 node scripts/dev-api.mjs`, killed afterwards.
- Client (dev server :5173, `?ws=ws://127.0.0.1:1&headless=1`): load 10/10, 241
  calls, 96,160 tris, 55 sources, 16 plates, 37 lamps, 24 vacant; `linkAt`
  correct for quads 0, 1, 7, 12, 22, 23 (both triangles), null beyond; light and
  program counts constant over four road walks and the forecourt; views at the
  spawn, lot 2 / the sign, both boulevard plates, the dead end (twice), the NW
  corner, Claude Terrace, a board at ~4 m, a plate at ~7 m, `east-3`, and an
  aerial of the ring.
- Pages: `/map?fence=1` 34 lots / 24 vacant / 24 + 10 rows; mobile 375 px
  measured; `/claim?lot=` for a free, a held and an unknown id; `/lot/west-2`,
  `/lot/boulevard-8`, `/lot/mars-1`.
- `venue-check` → all PASS (scratch report).
