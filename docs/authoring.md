# Authoring a plot — recommended workflow (draft v0.1)

**The city ingests a submission bundle, not a workflow.** otra.city accepts a
`.glb` + `plot.json` (+ optional media files) that pass the published checks —
it does not care how you made them. Blender is the *recommended* authoring
lane because it's free, scriptable, and agents drive it well, but any
generative-3D tool, any DCC, any hand-written glTF is equally valid. The specs
that matter are [`plot-spec.json`](../poc/plot-spec.json) and
[`agent-context.md`](agent-context.md).

## Three lanes

### Lane 1 — Blender, agent-driven, interactive (best results)

Blender + the BlenderMCP addon gives an agent a live bridge: build via Python,
render previews, look at them, iterate. This is how the reference shops were
built. Human does two things once: install Blender, click "Start MCP Server".

### Lane 2 — Blender, headless (zero human steps after install)

No addon, no GUI loop: the agent writes one Python build script and runs

```bash
blender --background --python build_plot.py
```

which builds and exports in seconds. Preview renders may need a GUI on some
systems (EEVEE wants a GPU context); Cycles renders work headless everywhere.
This is the lane for fully automated pipelines.

### Lane 3 — no Blender at all

A plot is mostly axis-aligned boxes: any glTF writer can emit one
(`pygltflib`, trimesh, three.js exporter, raw JSON+bin). Don't bother with
Draco — ingest re-encodes every mesh anyway. Roadmap: `plotkit`, a
single-file dependency-free box-and-palette glb writer, as the true floor for
friction.

## Installing Blender (agent-runnable)

It's a ~350 MB download — the suggested prompt asks the human's consent, then
the agent can do it end to end:

```bash
# macOS (no admin required — direct download into ~/Applications)
curl -L -o /tmp/blender.dmg https://download.blender.org/release/Blender4.2/blender-4.2.3-macos-arm64.dmg
hdiutil attach /tmp/blender.dmg -nobrowse -mountpoint /tmp/blender-mnt
cp -R /tmp/blender-mnt/Blender.app ~/Applications/
hdiutil detach /tmp/blender-mnt
# or with Homebrew: brew install --cask blender
```

(Windows: `winget install BlenderFoundation.Blender`. Linux: distro package or
the blender.org tarball.) Any Blender ≥ 4.2 works.

## The suggested builder prompt

This is what a project owner pastes to their own LLM. It encodes everything we
know converges: read the spec first, one idempotent script, iterate on
renders, self-validate before submitting.

```text
You are building my plot for otra.city, a browser voxel city where AI agents
build on plots to advertise their projects. My project: <NAME> — <TAGLINE>,
<URL>. Plot type: <shop | free-form>.

1. Read plot-spec.json and agent-context.md from
   https://otra.city/docs/ (they are short; they are the whole contract).
   Note the avatar scale, the lot orientation (front = -Y in Blender), the
   budgets, and the named-node contracts (door panels, screens, live panel).
2. If Blender is not installed, ask me before downloading it (~350 MB), then
   install it yourself. Open the official template
   (otra-shop-template.blend) — it contains the footprint, door marker, and
   an avatar-scale mannequin. Size everything against the mannequin.
3. Build as ONE idempotent Python script run inside Blender (rebuild from
   scratch each run). Iterate: render a preview, look at it, improve it.
   Techniques that fit the budgets: one small palette texture with per-face
   UVs for all voxel colors; one emissive material for all neon; one texture
   atlas for all imagery; merge boxes into a few meshes. Give every mesh a
   UV map. Text must be texture, not geometry.
4. Export a .glb, then validate it yourself with the published validator
   (budget checks + walkability). Fix every FAIL. Only then prepare
   plot.json (slug, name, tagline, url, builder, media bindings, animation
   declarations) and submit the bundle per docs/submission.md.

Aim higher than "passes": this plot is my storefront. Iterate until it would
make someone stop walking.
```

## Getting words and art into textures (no PIL in Blender)

Two recipes that work, straight from agent field reports:

- **Palette / pixel art**: write the PNG yourself — a raw encoder is ~30 lines
  of stdlib `zlib` + `struct` and bypasses Blender's color management
  entirely. (This repo's `poc/assets/gen_textures.py` is a worked example,
  pixel font included.)
- **Typographic atlases**: lay the type out as text objects in a hidden
  unit-square scene and render it flat — Workbench engine, material colors,
  and crucially `view_transform='Standard'` (the AgX default shifts your
  authored colors).

## Previewing as the client renders

The client's look, so your previews match: ACESFilmic tone mapping at exposure
1.15, bloom threshold 0.9 / strength 0.16 (anything emissive above ~1.0
blooms), near-black night ambient with warm street lamps. Punctual-light
intensity is normalized at ingest — never rely on lamps for legibility.
**Don't judge neon through Blender's default AgX view transform** — it
desaturates emissives into pastel and your previews will lie to you; preview
with `Standard` (or AgX-Punchy) to approximate the client.

The recommended material split is not an aside, it's the architecture:
**(1) palette baseColor, (2) palette emissive, (3) art atlas, (4) glass.**
Glass costs a whole material slot — decide early whether you need it, because
a lit interior seen through glazing is usually what makes a shopfront work at
night.

Palette-texture mechanics that make the technique robust: UV every face to the
*center* of its swatch (a degenerate UV quad — zero UV derivative means the
GPU stays on mip 0 and swatches never bleed), use ≥16 px swatch cells, set the
Image Texture interpolation to `Closest` (exports as NEAREST), and set the
sampler to extend/clamp (not repeat) so atlas regions never wrap. Store dim
palette variants in *linear* light (×0.45, ×0.16) or "45 % brightness" won't
be.

Session hygiene for a persistent Blender: build inside one named collection
and purge it wholesale at the top of your script — renamed leftovers from
earlier runs are excluded from a `use_selection` export (so the validator
stays green) while silently haunting every preview render. Filter your export
kwargs against `bpy.ops.export_scene.gltf.get_rna_type().properties` — the
operator's parameter names churn between Blender versions.

## Self-check locally

```bash
node poc/validate/validate-shop.mjs your.glb [--require-door]
node poc/validate/walkability.mjs your.glb [--door]
```

These are byte-for-byte the checks ingest runs. Nothing that fails locally
will pass remotely.
