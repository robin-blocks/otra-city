# BlenderMCP PoC — results & findings (2026-08-31)

**Goal:** prove an agent can drive Blender through the BlenderMCP bridge to
produce a shop-shaped, budget-compliant, Draco-compressed `.glb` that the
otra.city web client would happily serve.

**Result: yes.** A complete fictional-SaaS shop ("PromptFrenzy — A/B test your
prompts") on the standard 10×10×6 m lot:

| metric | value | budget |
|---|---|---|
| .glb size | **34.9 KiB** | 8 MiB |
| triangles | 2,106 | 50,000 |
| materials | 4 | 4 |
| textures | 1024² atlas + 256² palette | ≤1024² |
| draw calls (three.js) | 8 primitives | — |
| punctual lights | 3 | 3 |
| bbox | exactly 10×10×6 | fits |
| three.js load+mesh | **~55–65 ms** (local) | door anim is 700 ms |

All 9 ingest checks pass (`node poc/validate/validate-shop.mjs poc/out/promptfrenzy.glb`).

## What was built and how

- Dedicated Blender 5.2.1 instance launched with the vendored BlenderMCP addon
  (`tools/blender/start_bridge.py`); driven over the addon's JSON/TCP socket on
  9876 via `tools/blender/bridge.py` — the identical protocol the `uvx
  blender-mcp` MCP server speaks. (This session predated MCP registration;
  `claude mcp add blender -- uvx blender-mcp` is now configured, so future
  sessions get native MCP tools.)
- Textures generated locally with a stdlib-only PNG writer + 5×7 pixel font
  (`poc/assets/gen_textures.py`) — no image libraries needed, and the pixel
  look matches the voxel aesthetic.
- Shop geometry: all axis-aligned boxes on a 0.25 m grid (voxel style baked
  into the glTF), merged into 4 buckets (structure / emissive / art / glass)
  plus 2 named door panels → tiny draw-call count.
- Key techniques that should become **the standard shop recipe**:
  - **Palette texture** (16×16 cells at 16 px) + per-face UVs → unlimited voxel
    colors from ONE material.
  - Same palette wired to a second **emissive material** → all neon from one
    more material.
  - **One art atlas** (sign, poster, live panel, link poster, logo) → all
    branded imagery from one material. Slots in the atlas map 1:1 to the
    manifest's image slots.
  - Named nodes `door_panel_L/R` → client animates the sliding door (verified
    in the three.js viewer; ~700 ms ease matches the interior-fetch gate).

## Findings → validator / format spec

1. **Signage needs a protrusion allowance.** Natural storefronts want the sign
   proud of the wall. Solved here by insetting the front wall 0.25 m so signage
   lives inside the lot bbox. Spec either "front wall at y=-4.75, signage zone
   to y=-5" or an explicit small overhang tolerance. The validator's bbox check
   (ε=15 mm) would otherwise reject the most natural agent mistake.
2. **Material budget is the binding constraint, not triangles.** 2.1k of 50k
   tris used; but 4/4 materials consumed instantly (voxel + emissive + art +
   glass). The palette/atlas technique is what makes 4 enough — it must be
   *taught in the agent docs*, or agents will burn one material per color and
   get rejected. (In the manifest-driven voxel path this is moot — the platform
   owns materials — but it's decisive for glTF slots/Tier 2+.)
3. **Light units don't round-trip cleanly.** Blender watts → glTF candela →
   three.js physical units arrived ~100–200× hot; the viewer scales imported
   light intensity by ~0.005. Ingest should normalize: cap light count AND
   clamp/rescale intensity to a house range so no shop nukes the street.
4. **Emissive strength matters.** KHR_materials_emissive_strength (3.0 here)
   survives the full pipeline (Blender → Draco glb → three.js) and drives the
   bloom pass. Cap it (e.g. ≤5) in the validator; it's the "loudness war"
   parameter of a neon city.
5. **Draco worked flawlessly** from Blender 5.2's bundled encoder; decode adds
   ~single-digit ms in the browser for this size. Keep it required.
6. **Alpha-blended glass exports fine** (alphaMode BLEND) but is the one
   sorting hazard; one glass material per shop, single-layer windows only, is a
   good spec rule.
7. **Viewport screenshots work headless-ish** (the addon renders offscreen even
   when Blender isn't frontmost) and Poly Haven integration reports enabled —
   both usable by authoring agents. EEVEE renders (~5 s each) are the better
   sanity-check loop, and could be the basis of a future server-side
   render-check gate.
8. **Blender 5.2 API note:** everything used here (bmesh, Principled BSDF
   "Emission Color"/"Emission Strength", glTF exporter Draco/lights flags)
   works; exporter props were introspected defensively
   (`poc/blender/04_export.py` prints any that go missing in future versions).

## Protocol observations (for agent docs)

- Wall-clock: ~30 min total including all environment setup (installing uv,
  vendoring the addon, launching the dedicated instance) — but the build loop
  itself (edit script → execute via bridge → EEVEE render → inspect → fix) ran
  ~10 min with 2 visual iterations. Free-form tool-call sessions by
  less-scripted agents will land in the "10+ minutes" range the plan expects.
- The winning workflow was **"write one deterministic build script, execute via
  the bridge, iterate on renders"** rather than many small imperative bridge
  calls. Recommend exactly this in agent docs: agents that keep a rebuildable
  script converge; agents poking objects one call at a time drift.
- One bridge client at a time is real; the dedicated-instance pattern (second
  Blender, addon exec'd at launch via `--python`) avoids touching a user's open
  Blender session and is fully scriptable.
- The addon refuses to start its server in `blender --background` (commands
  would never drain), so CI-style validation must use the import/inspect path
  (glTF-Transform, as `poc/validate/` does), not a headless bridge.

## Answering the test protocol's question

"Can an unsupervised agent, given only our constraints as text, produce a
shop-shaped glTF that passes the budget?" — This run says **yes, with the
right scaffolding**: constraints-as-text plus (a) the template with
machine-readable budget custom-props, (b) the palette/atlas recipe, and (c) a
local copy of the validator to self-check before POSTing. Next experiment per
the plan: hand a fresh agent only the template + docs text and grade the
output with `validate-shop.mjs` untouched.

## Step 2 (same day): avatar + WASD controls

Turned the viewer into a first city-client prototype: voxel robot avatar
(~14 boxes, joint-pivoted walk cycle, emissive visor/antenna), third-person
chase camera (OrbitControls target follows the player), WASD/arrows + Shift
run, and the sliding door is now proximity-automated (opens ≤2.4 m, closes
>3.1 m, 700 ms ease — and the shop glb was rebuilt with full-width panels that
actually close; still 35.9 KiB, still ACCEPTED).

Technique findings:

1. **Collision needs no collider data.** The shop is axis-aligned, so per-axis
   movement + 3 raycasts (shin/hip/head heights) against the *rendered meshes*
   gives wall sliding, fixture blocking, and — because the door panels are the
   colliders — a closed door literally blocks entry until it slides open.
   Down-ray ground snap makes the 0.25 m floor slab and runway lip read as
   steps. This should survive into the real client (per-segment BVH later).
2. **Walkable interior is a validator concern.** Nothing in the budget checks
   forces a navigable shop (an agent could fill the doorway). A cheap ingest
   check: raycast a grid at door height from the door line, require some
   walkable area/clearance. Added to the validator backlog.
3. **rAF pauses in hidden tabs** — correct for production, but tests need the
   deterministic `window.__step(frames)` sim hook (drives player/door/render
   without rAF). Kept permanently; it's effectively the start of a headless
   client test harness.
4. Light-unit calibration again: the avatar carries a small fill light so it
   reads at night; glb light scaling (~0.0055) still hand-tuned — reinforces
   "normalize light energy at ingest".

## Step 3 (same day): free-form plots, boulevard, spec-driven validator

Opened the format beyond shops: same envelope + budgets, any content. Built
three free-form plots via the bridge (sculpture plaza 6.0 KiB / 576 tris,
glowing garden 7.9 KiB / 996 tris, relay-tower monolith 6.1 KiB / 660 tris —
each just 2 materials) and a city-owned street layer (`poc/viewer/street.js`):
road, sidewalks with real curb step-ups, lamps, lane dashes, per-plot claim
markers, and a vacant lot with a floating "available" marker. `PLOTS` in
street.js is effectively the first street-segment manifest. Whole scene:
4 plots, ~4.1k tris, ~60 draw calls, loads in ~85 ms. Bloom retuned
(0.3/0.6/0.88 → 0.16/0.35/0.9) — neon keeps tight halos, pixel text stays
crisp, interiors no longer wash out.

Findings:

1. **The validator caught a real breach on the first free-form build** — a
   garden tree tuft + grass patches at x=5.2 (envelope is 5.0). Free-form
   content makes the footprint check earn its keep; agents scattering
   procedural content WILL leak the envelope.
2. **Free-form plots need almost nothing new**: door contract became
   `--require-door` (shops only), everything else identical. Sculpture/garden
   used half the material budget.
3. **Spec is now single-source**: `poc/plot-spec.json` drives the validator
   and the agent docs (`docs/agent-context.md`); the template .blend carries an
   `AVATAR_SCALE_REF` mannequin + budget custom-props. What agents must know,
   beyond budgets: avatar metrics (1.42 m, 0.9 m passages, 0.35 m max step),
   lot orientation (front = -Y), the night/neon viewing context, "your geometry
   is the collision mesh", and the named-node interactivity contract.
4. **Open frontage works**: garden/plaza lots read fine without a street wall;
   sidewalk flows in. Claim markers keep ownership legible.
5. **Camera collision is now the top polish gap** — the chase camera clips
   into geometry (e.g. straight into an emissive backboard = full-screen
   smear). Needs a camera pull-in raycast.
6. Curb step-ups (0.15 m) + slab step-ups (0.25 m) both read correctly through
   the ground-snap; no walkability regressions from the street layer.

## Step 4 (2026-09-01): walkability, media, animations, info boards, spec v0.2

New ingest checks: `walkability.mjs` (voxelized flood-fill from the street
edge; door panels excluded since the client opens them; ASCII plan-view
diagnostic) — proven with a negative control (reference shop + a crate in the
doorway: budgets PASS, walkability FAIL, exactly the gap it closes).
`grade-all.sh` runs budgets + walkability per file, auto-detecting shop vs
free-form by door nodes.

Media + motion (all demoed live in the viewer):

- **Positional ambient audio** (PromptFrenzy: stdlib-synthesized arp loop →
  83 KB m4a): PositionalAudio, ref 3 m / max 14 m exponential — music stays in
  the shop; nearest-K playback caps cost. WebAudio unlock needs a real user
  gesture (CDP clicks count).
- **Video screens** (6 s Blender-rendered mp4, 131 KB): VideoTexture on a
  named node, muted always, nearest-K decode. Blender 5.x gotchas: FFMPEG
  output now gated behind `image_settings.media_type='VIDEO'`;
  `action.fcurves` replaced by layered-action channelbags.
- **Live feed**: city-rendered canvas texture from a polled JSON
  (title/big/sub/bars) onto `panel_live` — updated number verified live.
- **Declared animations**: spinner/bobber/blinker with hard caps (anims.js);
  SIGNAL's rings spin + core bobs from three manifest lines. No agent code.
- **Info boards**: standardized city-placed lectern per lot (canvas texture:
  name/tagline/builder/permalink from the identity block). Vacant lots get a
  claim board. This is the "museum placard" answer to per-lot legibility.

Contract findings the docs now carry:

1. **Media surfaces need full 0–1 UVs** — a video/feed texture on an
   atlas-cell-UV quad renders one texel (or mirrored crops). Spec'd + the
   builder fixed.
2. **UV-less meshes fork materials at export** (found via the negative
   control: +1 phantom material → REJECTED). "Every mesh needs a UV map" is
   now a documented gotcha.
3. **Exact node names are load-bearing**: one agent shipped
   `door_panel_L004` (Blender duplicate suffix) — doors silently dead.
   Validator catches it; spec now warns explicitly.
4. **Content addressing matters even in dev**: browser heuristic cache served
   stale glbs; viewer now cache-busts, production uses immutable URLs.
5. Blender 5.2 removed `blender_mcp`-era assumptions worth documenting for
   authoring docs (see gotchas above) — version-pin advice belongs in
   authoring.md eventually.

Spec v0.2 additions: identity block (drives boards + permalinks), media
budgets (1 audio / 2 screens / 1 feed with size-duration-resolution caps),
animation capabilities (≤8, capped params, envelope rule), Draco now optional
at submission (ingest re-encodes regardless — drops the hardest requirement
for no-Blender authors), walkability thresholds. New docs: `authoring.md`
(three lanes + agent-runnable Blender install + suggested builder prompt),
`submission.md` (ai-directory-style: fork+PR or API endpoint, mechanical
gates, proof-of-control backlink = referral loop bootstrap, allow-first
post-moderation, sanitizing ingest).

## Step 5 (2026-09-01): the unsupervised agent test — results

Four agents (2 shops, 2 free-form), each on an isolated Blender 5.2 + bridge,
given ONLY plot-spec.json + agent-context.md + the template. **4/4 ACCEPTED on
all budget checks and walkability, unaided.** Wall-clock 42–48 min each,
~8–12 build/render iterations. All four independently adopted the documented
palette/atlas architecture and landed on exactly 4/4 materials; every other
budget sat at 3–12 % utilization. One agent shipped `door_panel_L.004`
mid-test, caught it with the validator, and fixed it — the loop works.

Their reports converged hard on the same gaps (all now fixed in docs/spec/
template): door rough-vs-clear ambiguity (template now carries BOTH marker
boxes); floor-at-0.25 convention unstated; punctual-light units unspecified
(now: "normalized at ingest — design on emissive"); the link fixture demanded
but never contracted (now `link_1`/`link_2`, any plot type); free-form
guidance too thin (frontage rule, headroom-vs-elevated-forms, signage strip,
city-furniture placement all now explicit); text-to-texture authoring absent
(two recipes + legibility numbers now in authoring.md); Blender's silent
banned-extension traps (full list documented — transmission/IOR/specular/
sheen/clearcoat/texture-transform/webp); AgX previews lying about neon;
sightlines from avatar eye height; per-material emissive strength forcing
brightness into palette colors; emissive hue clipping (non-dominant channels
< 1/strength).

Validator TODOs from their probing: door check is name-presence only (add
aperture/position assertions); nothing catches a 180°-backwards build (add a
front-half-mass heuristic or an oriented render check); walkability thresholds
could be advertised in the validator output so agents discover the tool.

Verdict on the core question: **the docs alone are sufficient for budget-legal,
walkable, on-brand plots — and agent feedback is the fastest validator-spec
generator we have.** Every one of the ~15 doc fixes above came from one
four-agent run.

## Step 6 (2026-09-01): brightness normalization + first interaction

User feedback: glow still overwhelming, panels unreadable, nothing pressable.
Root cause measured, not guessed: per-plot punctual light totals spanned
**0.7 → 152** (200×) across the 8 plots — every agent's exporter/settings
produced different candela, and the uniform scale was tuned on the hottest
plot. Fixes, all client-side stand-ins for ingest normalization:

1. **Per-plot light energy cap**: after base scale, each plot's total light
   intensity is clamped to 30 (proportional rescale). No plot can nuke the
   street; dim plots stay as authored.
2. **City-wide emissive peak ceiling**: emissiveIntensity × max(emissive
   channel) clamped to 1.2 — nothing clips to white, glow survives as color.
   (Materials driven by emissive *textures* under a white factor are why the
   factor-only clamp had to be this tight.)
3. Bloom now 0.12 strength / 1.0 threshold; avatar fill 0.7.

Result: every panel readable (Fernseed's 99% MATCH display, stake labels,
feed panel) with neon intact but quiet. These three numbers (30 / 1.2 /
0.12@1.0) are the first draft of the ingest "loudness war" constants.

**First interaction shipped**: city info boards (and any plot node named
link_1/link_2) are clickable — PoC shows a toast with the project URL;
production opens it. The board is the guaranteed pressable on every lot,
independent of what the agent built.
