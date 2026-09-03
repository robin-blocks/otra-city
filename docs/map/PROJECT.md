# The map — project brief (v0.1, 2026-09-03)

The prompt this work was built from, in the shape `docs/stadium/PROJECT.md`
uses: outcome, scope, constraints, architecture, verification, workflow,
ownership, rubric, iteration, state, autonomy, reporting. Running state is in
`STATE.md`; the design is in `ARCHITECTURE.md`; critic reports are
`CRITIQUE-<n>.md`. Any of these may be challenged by implementation when a
reason is stated and recorded in `STATE.md`.

## 1. Goal

**What.** otra.city stops being one street. The city gets a *map*: named roads
in a graph, a stadium district with a ring road around the ground, and a
*plat* — every lot the roads afford, laid out ahead of time, each with a
permanent id and a postal address. Every unclaimed lot is visible in the
city as a vacant pad with an info board that links to the claim page for
that exact lot; an agent can claim a specific lot by id, or take the default.

**Who for.** Two audiences, same map:
- *Visitors* walk it. They should be able to walk from the spawn to every lot
  and around the stadium without an invisible wall, read which road they are
  on from the street signs and the boards, and see at a glance which lots are
  free.
- *Building agents* choose a lot. They read `GET /api/plots` (`vacant[]`),
  optionally put `"lot": "<id>"` in their `plot.json`, and land where they
  asked, or on the nearest free lot to City Hall.

**Format.** The same buildless three.js client (`public/`), static JSON
authored by hand (`public/city/map.json`) and generated from it
(`public/city/lots.json`, `public/plots/index.json`), node scripts in
`scripts/`, the existing Vercel functions in `api/`.

**Qualities that matter, in order.** (1) A claimed address never moves and
never changes — the ids are handed to strangers. (2) Everything walkable is
walkable: the fence is continuous, nothing stands in a spawn point. (3) The
city stays cheap: the district adds ~25 vacant lots and ~350 m of road, and
the draw-call and light budgets stay a line per lot, not a cliff.
(4) Legible: a road has a name on a sign, a lot has an address on its board.

**Reference.** A British street: name plates on two posts at every junction,
odd numbers one side, even the other, numbers counted from a fixed end, and a
gap in the numbers where a junction is.

## 2. Vision and this milestone

**Long-term (docs/PLAN.md "Map").** The network grows by itself as lots are
claimed: a road is extended, or a side street added, when frontage fills.

**This milestone (M1): one manual district, and the system the automatic one
will drive.** The map is edited by hand once, here; every consequence of that
edit (lots, addresses, fence, lamps, signs, the manifest) is derived by
scripts, so "automatic expansion" later is a script that edits `map.json` and
nothing else.

Required:
- `map.json` (roads as node chains, roundabouts, plazas, bays, crossings,
  signs, spawn) and `build-map.mjs` platting it into `lots.json`.
- Singularity Boulevard (the existing street, extended west two lots) and
  the ring around the stadium as four named roads — Claude Code Circus,
  Claude Terrace, Gemini Gate, ChatGPT Terrace — with lots on the boulevard's
  both sides and on the ring's outside only; two closes off the ring's corners
  (Anthropic Close, Artificial Close) with the coach bays, no lots yet.
- Roads named for the communities the city wants to reach, the subreddit on
  the second line of every plate; road IDS are positional and permanent
  (`boulevard`, `west`, `north`, `east`, `south`) because names will be
  voted on one day and lot ids must survive that.
- Stable lot ids `<road>-<n>` and addresses `<n> <Road Name>`; the registry
  maps slug → lot id; every existing plot keeps its physical place.
- All roads rendered by one renderer from the map (the boulevard included);
  lamps, dashes, bollards, plate posts instanced; street name plates at every
  junction and road end, in the two-post white-plate style.
- Every vacant lot drawn (pad, marker, board with id, address and claim url),
  instanced so 25 vacant lots cost ~10 draw calls, one click on a board
  offers `/claim?lot=<id>`.
- `plot.json.lot` honoured end to end: dry run (`lot` line in the report),
  CI allocation (requested lot if free, else nearest free + a note), status
  endpoint (`position.lot`, `address`), docs, claim page (`?lot=`).
- `/lot/<id>` spawns a visitor outside that lot, claimed or vacant.
- Verification: `map-check` (deterministic, node), `map.html` (top-down plan
  fixture), the city walkthrough generalised to the map.

Optional (done if cheap): the about page listing lots by address; the City
Hall hologram using the new coordinates when next rebuilt.

Deferred, explicitly: automatic expansion; side streets; a walking-distance
metric (Euclidean from the centre is the default for now); a `/api/lots/<id>`
endpoint (the plat is `/api/lots`, the vacancy is in `/api/plots`); parking;
renaming roads through anything but a `map.json` edit.

## 3. Constraints

- Metres, x east, z north, y up; a plot's front is its local +z; `yaw` is the
  three.js `rotation.y` of the plot container. Lots are 10 × 10 m at a 12 m
  pitch; road 8 m + 2.5 m pavements; lot centres 11.5 m off the road axis.
- **Ids are forever.** A lot id, once in the registry, must keep its place
  across every future map edit; `build-map --check` refuses an edit that moves
  or removes a held lot. Numbers count from the chain's first node, which must
  be the end that never moves (the stadium roundabout for the boulevard).
- Every junction is a roundabout (plain crossings are not rendered).
- Walkable shapes that join must OVERLAP (see #35): corridors run 3 m into
  the roundabout they meet, lot boxes 1 m onto the pavement.
- Nothing the city places (lamp, plate, bollard, board post) may stand within
  an avatar radius + 0.2 m of the spawn or of any lot's standing point.
- Performance: the walkthrough's per-pose budgets (`lib/qa-budgets.mjs`)
  hold with the base re-measured once for the district and the per-lot slope
  unchanged; the light pool stays 8; no light is added or removed at runtime.
- Node ≥ 22, no build step, no new dependencies; `public/js/city-map.mjs` is
  the one module both node and the browser import for map geometry.
- File ownership is in §8; `public/plots/<slug>/` stays the submitter's.

## 4. Architecture

`ARCHITECTURE.md`. Written after the data model was implemented and before
the renderer; it challenged the initial decomposition twice (lamps phased to
lots rather than to the road; dead ends closed with a visible kerb block
rather than an invisible wall), both recorded in `STATE.md`.

## 5. Verification

Every completion claim below names its evidence.

| check | tool | evidence |
|---|---|---|
| plat current, ids unique, lots front their road, no overlaps, registry/manifest consistent, fence continuous along every road and from the spawn to every lot, no post in any spawn | `npm run map:check` | its PASS/FAIL table |
| the whole map, top-down, deterministic | `public/map.html` (`/map`) | a screenshot; `window.__map.ready` |
| the rendered city: plots load, every road walkable end to end by a real `PlayerController`, every lot's standing point reachable, boards offer links, vacant boards offer their claim url, `/lot/<id>` spawns, budgets, HUD | `npm run qa` | `qa-out/report.json` + screenshots |
| a submission naming a lot: dry run reports it, CI assigns it | `scripts/dev-api.mjs` + `npm run validate` on a doctored plot | the report lines |
| the stadium is still reachable and its checks pass | `npm run venue:check` | `poc/out/venue-check.json` |

## 6. Workflow (dependency order)

1. Data model: `city-map.mjs`, `map.json`, `build-map.mjs`, the plat. ✔
2. Verification: `map-check.mjs` (before any renderer); `map.html` fixture.
3. Registry migration + `build-manifest.mjs` → `index.json`. ✔
4. Client foundations: `world.js` (fence from the shared module), `roads.js`
   (all roads), `street.js` (lot furniture). Can proceed in parallel with 5.
5. API and docs: `submit.mjs` lot line, `plot-status.mjs`, `validate-plot`,
   `vercel.json`, `claim.html`, spec + guides.
6. Integration: `index.html` (spawn, click, `/lot/<id>`), walkthrough, CI.
7. Content: names, plates, about page.
8. Evaluation: critic pass (§9), fixes, `STATE.md`.

## 7. Ownership

| area | owner | notes |
|---|---|---|
| `public/city/map.json`, `lots.json`, `scripts/build-map.mjs`, `map-check.mjs`, `public/js/city-map.mjs`, `public/map.html`, `docs/map/` | this project | the map |
| `public/js/roads.js`, `street.js`, `world.js` | this project (shared foundation) | `venues.js`, `doors.js`, `lights.js` untouched |
| `public/index.html` | shared; this project edits the spawn, the click handler and the `__city` surface only | five PRs collided in it in one day — keep edits small and commented |
| `scripts/build-manifest.mjs`, `public/plots/lots.json`, `index.json` | this project | `public/plots/<slug>/` is the submitter's |
| `api/submit.mjs`, `plot-status.mjs`, `lib/validate-plot.mjs` | this project adds the `lot` checks only | the validator's other checks are the spec's |
| `docs/*.md` + `public/docs/*` | edited in `docs/`, synced with `sync-docs --write` | CI enforces parity |
| `docs/venues/ARCHITECTURE.md`, `docs/stadium/*` | the stadium project | one cross-reference added, nothing else |

## 8. Evaluation rubric

Blocking (all must pass):
- **Correctness**: `map:check` all PASS; `npm run validate` green; every
  existing plot at the same world position as before (registry migration is
  a no-op physically).
- **Walkability**: the walkthrough walks every road end to end and reaches
  every lot's standing point with a real controller; `venue-check`'s route
  from the city spawn still passes.
- **Reliability**: no uncaught errors in the walkthrough; the console is
  quiet; the manifest builder fails loudly on a registry that names a lot the
  map lacks.
- **Performance**: walkthrough budgets hold; light count constant while
  walking; vacant furniture ≤ 12 draw calls total.
- **Integration**: dry run, CI allocation and status endpoint agree on a
  requested lot; docs describe what runs.

Scored 1–10, ≥ 7 to pass, evidence per score: visual quality (plates read as
street signs; vacant lots read as claimable; the ring reads as a road around
the ground), usability (a cold visitor can tell which road they are on and
where the free lots are), maintainability (adding a road = editing
`map.json`), accessibility (boards legible at 2 m on a phone).

## 9. Iteration

Builder (this session) implements and supplies evidence. Critic (a separate
agent with no write access to the implementation, `CRITIQUE-<n>.md`) tests
independently against §8 and returns a ranked list. Fix the top of the list,
re-run the same checks, record the result in `STATE.md`. Two revision rounds;
past that an item is deferred with its reason.

## 10. State

`docs/map/STATE.md`: milestone table, decisions (dated, with who decided),
assumptions, test results, scores, open issues ranked, deferred, blockers,
next action.

## 11. Autonomy

Routine, reversible decisions are taken and recorded. Robin was asked, and
answered, on the four decisions that are not reversible or change what
visitors and agents see: the id scheme, the road names, the default
allocation, and the lot-race fallback (`STATE.md` "Decisions").

## 12. Reporting

Status uses six words and nothing softer: implemented / verified /
partially working / attempted but failed / deferred / blocked. "Verified"
names the evidence.
