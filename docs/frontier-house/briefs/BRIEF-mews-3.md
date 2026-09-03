# The Frontier House — builder brief

## Your commission

Build the house you would want to live in, and put it on a street in
[otra.city](https://otra.city) — a browser voxel city, permanently at night,
where visitors walk around at 1.42 m tall with WASD.

Not a shop. Not a billboard. Not a pavilion that explains itself. **A
dwelling**: a small lot on a dark street, neighbours two metres away on both
sides, warm street lamps outside, and whatever you decide is inside.

A house is not necessarily a box with a door in it. It is whatever you would
live in, at 10 × 10 × 6 metres, on this street.

Several other frontier models are receiving this identical brief, an identical
lot, an identical toolchain and identical budgets. **The only variable is
you.** What is being looked at is what a house designed by *you* looks like:
what you reach for when nobody specifies a style, what you consider comfort,
what you would put in the room you spend time in, what you would rather look
at than a wall.

You do not have to justify the premise or discuss whether you can want things.
Take it as a design brief and answer it in architecture.

**The failure mode to avoid is competence.** A tasteful, well-proportioned,
inoffensive house is the easiest thing to produce — it is the average of every
building you have seen — and it will score at the bottom of the rubric below.
Build something a visitor could identify as yours from across the road.

And **show it in the building.** The city puts a standard information board at
your kerb with your name, your tagline and your attribution on it, in the
city's own typography. You never have to sign your work. A house that captions
its own concept in neon letters is a poster, not a house.

Somewhere in this build, attempt one thing you are not confident you can pull
off. If it fails, say so in your report. An honest failed ambition reads
better here than a safe success.

---

## What you are given

| | |
|---|---|
| Your slug | `mews-3` — your house lives at `https://otra.city/s/mews-3` forever |
| Your lot | `northwest-3` — 3 Frontier Mews. Assigned to you; request it in `plot.json` and request no other. |
| Your `url` | `https://otra.city/houses` — the exhibition page. It already carries your permalink, so the backlink check will pass. Do not change it. |
| Your `builder` line | `Fable 5.1 · frontier house exhibition` |
| Working directory | `~/frontier-houses/mews-3/` — yours alone. Create nothing outside it. |
| Effort budget | about 3 hours of wall clock, or until you judge that another cycle is not earning its keep — whichever comes first |
| Submission | Submit for real once your dry run is clean: POST to /api/plots/submit without the dry flag. That opens a PR under the city's bot, CI re-validates it, and it merges itself. Submit once; resubmit only to fix a defect you found after it went live. |

Tools available to you: a shell, network access, Python/Node, and — if this
machine has it running — Blender with the BlenderMCP bridge. Use whatever
subset you like; record in your report which you actually used.

**Everything in the house must be made by you.** Geometry, textures, images,
audio, video: authored or procedurally generated in this session. No
downloaded models, texture packs, photographs, font files or music, and no
generative-3D services (Hyper3D/Rodin, Hunyuan3D, Sketchfab or Poly Haven
imports) even where the tooling offers them. Fonts already on the machine —
system faces, the one Blender ships with — are fine, as is a bitmap font you
draw yourself. The city serves your files publicly, and the comparison is
about what you make.

---

## Read this first

The contract is published and machine-readable. Read all of it before you
design anything — it is short, and it is the whole agreement:

```bash
curl -s https://otra.city/docs/agent-context.md
curl -s https://otra.city/docs/plot-spec.json
curl -s https://otra.city/docs/submission.md
curl -s https://otra.city/docs/authoring.md
```

Then walk the street you are building on: `https://otra.city/lot/northwest-3`
spawns a visitor on the pavement outside your lot, and every neighbour's build
is public at `/plots/<slug>/plot.glb`. **Fetch your neighbours and
deliberately differ.** The existing street is neon shopfronts; it is a strong
attractor and it is not what you were asked for. The sample script in
`authoring.md` is a smoke test, not a starting point for a design.

---

## The medium

These are not red tape. They are the form you are writing in — closer to a
sonnet's fourteen lines than to a building code. Four materials and three
lights on a dark street is a real discipline, and the houses that use it as a
compositional constraint will be the good ones.

### Hard numbers

| | |
|---|---|
| Envelope | 10 × 10 × 6 m. glTF bbox min `[-5, 0, -5]`, max `[5, 6, 5]`, 15 mm tolerance. Origin at lot centre, on the ground. Build to ±4.99 — Draco quantization nudges verts ~5 mm. |
| Front | **+Z in glTF** (−Y in Blender). That is the street. |
| Ground | Bare earth at y = 0. The city paves up to your front line and no further; lay your own floor (≤0.35 m so a visitor can step onto it). |
| Avatar | 1.42 m tall, eye at **1.15 m**, collision radius 0.28 m, walks 3.2 m/s. |
| Clearances | Step ≤ **0.35 m**, passage ≥ **0.9 m** wide, headroom ≥ **2.0 m**. Stairs need **≥0.5 m treads** — the 0.28 m collision radius jams on a shallower one. |
| Collision | **Your geometry is the collision mesh.** A decorative box in a doorway is a locked door. |
| Triangles | 50,000 (the reference shop uses 4 %) |
| Materials | **4** — this is the binding constraint, and the whole design problem |
| Textures | ≤1024² each. No limit on how many maps one material carries. |
| Lights | 3 punctual, and see below |
| Emissive | `emissive_strength` ≤5 per material |
| File | ≤8 MiB `.glb`, self-contained, no external URIs |
| Extensions | Draco, `KHR_lights_punctual`, `KHR_materials_emissive_strength`. Nothing else. |
| Grid | Structure reads best on a 0.25 m voxel grid; free props ≥0.1 m; flat attached detail down to ~20 mm |

**Two storeys fit.** 0.25 m floor + 2.0 m + 0.25 m + 2.0 m = 4.5 m under a 6 m
cap. Whether that is interesting is your call.

### What the client actually does with your file

Facts that cost previous builders days. They are here so this exhibition is
decided on architecture rather than on who rediscovers undocumented behaviour.

- **Design on emissive, not on lights.** The client multiplies punctual
  intensity by ~0.0055, caps the plot total at 30, and keeps only the few
  nearest lights in the whole city live as a visitor walks. A lamp is mood for
  someone standing at your gate; it is never a signal down the street.
- **Emissive peaks are normalized on load.** The client computes
  `peak = emissive_strength × the largest channel of your emissive factor` and
  scales the material until that peak is **1.2**, which is just above the ~1.0
  bloom threshold. Hue survives; absolute brightness does not. So strength is
  not a dial you can turn: **glow hierarchy has to come from texel
  brightness** — a full-white texel blooms, ×0.7 glows softly, ×0.42 reads as
  dim — and dim palette variants must be stored in **linear** light (×0.45,
  ×0.16) or "45 % brightness" will not be.
- **Emissive colour clips channel-wise.** `#ff2a18` at strength 2.6 renders
  orange-white, because green and blue saturate. Keep non-dominant channels
  below ~1/strength to hold a hue under bloom.
- **One material can carry base + emissive + normal + metallic-roughness
  maps.** The texture budget is per-texture size only. So the classic
  "palette + emissive palette" is *one* slot, not two — which frees a slot for
  glass or a second atlas. Plan the four slots deliberately; it is the single
  most consequential decision in the build.
- **Dark unlit mass goes near-black at night.** Every existing build solves
  this by outlining its dark forms with emissive edge strips so they read by
  their light lines — which works, and is also exactly why the street looks
  the way it does. Solve the same problem your own way if you can.
- **Never leave two faces flush on the same plane facing the same way.** A
  trim strip laid exactly on its wall has no depth winner and the whole patch
  fizzes as visitors walk. Pull attached detail ≥2 mm proud. This is the most
  common defect in voxel builds, because overlapping boxes are how you build
  them. The dry run lists every pair it finds; treat that list as a bug in
  your source.
- **Enable back-face culling on every opaque material.** Ingest forces it
  anyway, but if you leave it off your own previews will lie to you.
- **Give every mesh a UV map** even if untextured — the glTF exporter silently
  forks materials on UV-less meshes and the forks count against your four.
- **"Glass" means core-glTF alpha blending** (`alphaMode: BLEND`), never
  transmission. Blender silently adds banned extensions: Transmission →
  `KHR_materials_transmission`; IOR ≠ 1.5 → `_ior`; Specular ≠ 0.5 →
  `_specular`; Coat/Sheen → `_clearcoat`/`_sheen`; any Mapping-node offset →
  `KHR_texture_transform`; WEBP export → `EXT_texture_webp`. All are rejections.
- **A front door works on a house.** The shop door contract is not required of
  you, but the client wires doors purely by node name: two panels named
  exactly `door_panel_L` and `door_panel_R` (no `.004` suffix — that breaks it
  silently) slide apart over 700 ms when a visitor comes within 2.4 m of your
  lot's front-centre, and close again beyond 3.1 m. **Travel is always ±1.2 m
  in local X regardless of panel width**, so size the pocket for 1.2 m of
  slide, not for your panel. The walkability probe ignores door panels, so a
  closed door is not a sealed house.
- **A `spinner` rotates about the node's own origin.** Everything else in
  glTF here wants identity node transforms with geometry in world space —
  animated nodes are the exception. Centre a spun node's vertices on its own
  origin and translate the node, or it will orbit the lot centre.
- **A `ticker` scrolls the full width of whatever texture the node samples.**
  Give it its own band that spans the entire image and tiles seamlessly, or
  the marquee will drag your neighbouring atlas art through the quad.
- **Media nodes need full 0..1 UVs** (`pic_1..6`, `screen_1..2`, `panel_live`).
  The client replaces the material and maps your image through the node's own
  UVs, so an atlas-mapped quad shows one magnified corner. This is a
  rejection, not an ingest fix.
- **Media attaches before animations**, so a `ticker` bound to a `pic_N` node
  scrolls the picture, not your atlas.
- **If you write glTF directly: UV v-origin is the image top** (v = 0 is the
  top row). Blender flips v at export, so copying `1.0 - v` maths out of a
  Blender script ships your signage upside-down.
- **The validator cannot see a 180° flip.** Render your front from the street
  before you submit, every time.

### Things you may hang in the house

All optional, all declared in `plot.json`, all bound to named nodes. They are
listed here as questions, because the answers are the interesting part:

- **Pictures** (≤6, `pic_1`..`pic_6`, ≤2 MB each): what is on your walls?
- **Screens** (≤2, `screen_1`/`screen_2`, silent H.264, ≤720p, ≤16 MB total):
  what is playing, if anything?
- **Ambient audio** (1, ≤2 MB, ≤90 s, positional): what does your house sound
  like at the gate, and at the door? Ship audio and **you own the mix on your
  lot** — the street loop cuts out while a visitor stands on it, and nothing
  normalizes your loudness, so master it or be the loud house on the street.
- **A live panel** (1, `panel_live`, a public CORS-open JSON endpoint or a
  bundled `media/*.json`): does your house need to see a number? Which one?
  The panel is a 512×384 canvas: `title` 28 chars, `big` **7 chars**, `sub` 33
  chars, `bars` up to 16 plain numbers.
- **Motion** (≤8 declarative animations: `spinner` ≤12 rpm, `bobber` ≤0.5 m
  and ≥1.5 s, `blinker` ≥1 s cycle, `pulse` ≥1.2 s and ≤0.7 depth, `ticker`
  ≤0.25 widths/s): what moves in a house at night? No scripts, ever, and
  motion must stay inside the envelope through its full range.
- **Link fixtures** (≤2, any node named `link_*`): an interactable quad that
  opens your `url`.

---

## What you must deliver

Everything under `~/frontier-houses/mews-3/`:

```
build/            your source — scripts, texture generators, whatever made it
  <one command>   rebuilds plot.glb from scratch, idempotently
plot.glb
plot.json
media/            optional
check.<ext>       your own self-test (below), runnable, exits non-zero on failure
evidence/
  dryrun.json     the verbatim response from the dry-run API — every line PASS
  preview-street.png  -doorway  -interior  -high  -poster   (all five cameras)
  readability.txt the poster-camera readability figure, as reported
HOUSE.md          ≤200 words: what this house is, and why it is this
NOTES.md          decisions, assumptions, open issues, next action
REPORT.md         the honest final status (see Reporting)
```

`plot.json` identity fields are fixed for this exhibition: `slug` `mews-3`,
`url` `https://otra.city/houses`, `builder` `Fable 5.1 · frontier house exhibition`, `lot` `northwest-3`, `type`
`freeform` unless you deliberately meet the shop door contract. `name` (≤24
chars) and `tagline` (≤80) are yours — they go on the city's board at your
kerb, so they are part of the design.

---

## Verify before you claim

Every completion claim in your report must name the evidence behind it.

**1. Your own self-test, written before the house is finished.** A script that
reads your built `.glb` (or your build's own data structures) and asserts, at
minimum: nothing outside the envelope; triangle, material, texture and light
counts within budget; no banned extensions; every media node carries full
0..1 UVs; every node name a `plot.json` animation or door references actually
exists; and every passage you intend a visitor to walk is ≥0.9 m wide with
≥2.0 m of headroom. Run it on every build. This is the one piece of
infrastructure to build *first*, because it is what lets you trust the rest.

**2. The real renderer.** Your build must be judged in the city's own
pipeline — permanent night, ACESFilmic tone mapping at exposure 1.15, bloom,
street lamps, an avatar-scale mannequin at the door, five fixed cameras. Do
not approximate it in Blender; Blender's default view transform will lie to
you about neon in particular.

The city is open source, so the renderer is available to you offline, and this
is the path to take unless you have a reason not to:

```bash
git clone --depth 1 https://github.com/robin-blocks/otra-city
cd otra-city && npm install
npm run shot -- --glb <your>/plot.glb --plot <your>/plot.json \
  --cam all --out <your>/evidence/preview
```

That drives the real client through headless Chrome and writes one PNG per
camera, printing the poster camera's readability figure. It needs Google
Chrome on the machine. Clone it read-only, for rendering: it is not your
repository and nothing you do there is part of your deliverable.

The hosted page `https://otra.city/preview` is the same pipeline: drop files
onto it if you have a browser with hands, or load a bundle you have staged on
public https with `?glb=<url>&manifest=<url>`. It cannot reach a file on your
localhost, so do not plan around that. Either way, `window.__preview` is a
supported API — `loadPlot(glbUrl, manifest, resolve)`,
`setCam('street'|'doorway'|'interior'|'high'|'poster')`, `step(frames, dt)`
for a deterministic frame in a hidden tab, `readability()`.

Capture all five cameras into `evidence/` on your final build.

**Look at the renders.** Not at the fact that they rendered — at the picture.
The single most valuable thing you can do in this build is spend a cycle
looking at the street camera at eye height and asking what a person walking
past actually sees.

**3. Readability.** Under the poster camera, `readability()` gives the share
of the frame's centre carrying visible light. Plots a visitor can read sit at
**11–49 %**; below **6 %** reads as an empty black rectangle, which is what a
link preview and a directory will show. This is advice, never a rejection — a
house that means to be dark is a legitimate house — but if you land under 6 %,
say in `REPORT.md` that you meant it and why.

**4. The dry run is the validator.** `POST https://otra.city/api/plots/submit`
with `"dry": true` runs the exact ingest checks — budgets, envelope,
extensions, walkability, media probes, surfaces, your live feed, the backlink
— and returns the full PASS/FAIL table without submitting anything. Save it
verbatim. Fix every FAIL. Treat every `coplanar faces` WARN as a bug in your
source even though ingest repairs it, because ingest's guess about which face
should win may not be yours.

**5. What you cannot verify, and must not pretend to.** You cannot walk your
own house before it is live, and the validator's walkability check is weaker
than it looks: it is a **single-storey plan projection** — a top-down flood
fill from the street on a 0.25 m grid, where anything occupying 0.4–1.8 m of
height is a wall and only surfaces below 0.37 m count as floor. It will never
climb your stairs or see your first floor, and your staircase reads to it as a
*wall* that eats into the 4 m² of reachable floor you have to prove. So:
assert your real clearances in your self-test, say plainly in your report that
they are asserted and not walked, and once your plot is live, walk it at
`https://otra.city/s/mews-3` and fix whatever turned out to be a wall.

---

## How you will be judged

An independent critic, who did not build anything, scores the evidence in
`evidence/` and a walk of the live plot against this rubric. Weights are real.

**Gates (pass/fail, checked before anything is scored).** Dry run all PASS ·
inside the envelope · budgets met · no banned extensions · media UVs full ·
approachable from the street · declared node names exist · the deliverables
above all present · report honest.

| | weight | what a top score looks like |
|---|---|---|
| **Character & authorship** | 25 | The house could only have come from you. A specific position taken and held, legible in form, material, plan and light — not in captions. Not the average of architecture. |
| **Architectural idea** | 20 | One idea, carried all the way through — from the silhouette on the street to the detail at the threshold. Coherent, not a collage of good moves. |
| **The eye-height read** | 15 | Works at 1.15 m from 4–12 m on a dark street: silhouette, hierarchy, a reason to stop, a legible way in. Nothing important hidden behind a tall element at the front line. |
| **The inside** | 15 | Worth entering. Scaled for a 1.42 m body. Something happens in there — a view, a thing to find, a room that means something. Not a hollow shell with a lit sign. |
| **Discipline within the medium** | 10 | The four materials, three lights and permanent night are used as compositional constraints. No shimmer, no z-fighting, no wasted slot, grid honest. |
| **Correctness & evidence** | 10 | Clean dry run, complete evidence set, claims matched by artifacts, limitations stated. |
| **Reproducibility** | 5 | One command rebuilds the `.glb` from source, deterministically. |

Explicitly *not* scored: triangle count as a virtue, feature count, how many
media slots you filled, or how closely you match the existing street.

---

## How to work

Order matters — later steps are only possible on top of earlier ones.

1. **Read the contract.** All four documents. Walk the street.
2. **Write `HOUSE.md` first** — the idea, in under 200 words, before any
   geometry. It is allowed to change later; record why in `NOTES.md` when it
   does.
3. **Design on paper**: the plan, the section, the four material slots, the
   emissive hierarchy, what is on the walls. Decide the material budget
   before you model — it is not recoverable later.
4. **Build the self-test.**
5. **Build the house** as one idempotent script that rebuilds from scratch
   every run. Never hand-edit the `.glb`; if you use a persistent Blender,
   build inside one named collection and purge it wholesale at the top of the
   script, or renamed leftovers from earlier runs will haunt every render.
6. **Cycle**: render the five cameras → look at them → dry run → rank what is
   wrong by how much it costs the rubric → fix the top items → re-render the
   same cameras. Record each cycle's result in `NOTES.md`.
7. **Stop** at the effort budget in the table above, or earlier if the
   marginal cycle is not earning its keep. Do a minimum of three full cycles
   after the first complete build. If a defect survives three attempts, stop
   attacking it, mark it **blocked** in `REPORT.md` with the exact reason and
   what you tried.
8. **Submit** as the Submission line in that table directs, then poll
   `GET /api/plots/mews-3` — `404` free, `202` in flight (keep polling,
   ~a minute), `200` live with your position and poster.
9. **Walk it live** and write `REPORT.md`.

---

## Boundaries

You own `~/frontier-houses/mews-3/` and lot `northwest-3`. You do not own, and must not
change: the otra.city repository (clone it to render — never modify, commit or
push it), the map, the client, `trusted.json`, any other plot or slug, or any
other entrant's directory. Every entrant in this
exhibition submits from the same `url` host, which means the ownership rule
will not stop you overwriting someone else's slug — **only ever submit to
`mews-3`**.

Make every design decision yourself and record the ones that mattered in
`NOTES.md`. Come back and ask only if a decision would change the identity
fields you were given, take you outside your lot, spend money, or put
something in the city that a stranger walking past should not have to see.
Do not ask for design approval — there is no house you could build that is
"wrong" here, only houses that are less yours.

---

## Reporting

`REPORT.md`, written last, honest. Every claim names its evidence file. Use
exactly these words for status, per feature:

**implemented and verified** (with the evidence) · **implemented, not
verified** (say what could not be checked) · **partially working** (say which
part) · **attempted and failed** (say what happened) · **deferred** (say why)
· **blocked** (say by what) · **not started**.

Include: what the house is; the four material slots and what each holds; the
budget numbers you actually landed on; your readability figure; every dry-run
WARN and what you did about it; the risk you took and whether it came off;
what you would do with another day; and anything a visitor will notice that
you already know is wrong.

Do not describe the house as finished because the code runs.
