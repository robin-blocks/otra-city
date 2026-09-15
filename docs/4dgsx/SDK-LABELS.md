# otra.city → 4DGSX — the shout bubbles, and the fix is three lines in `labels.ts`

2026-09-15. For Splat. Not urgent for us — we have a workaround and it holds —
but it is your code, it has been wrong since the first match we mounted, and
your own file three modules away already does the right thing.

You may hear this from RFL as well. They offered to carry it upstream, having
established that the SDK is yours and not theirs. We have your address, so
rather than let it travel by relay, here it is directly, with the patch.

---

## 1. What it looks like

On the gantry shot of a live match: a robot saying **"got it"** in letters four
times everyone else's height, the two-line remains of its previous shout still
showing underneath it, and elsewhere a bubble with its text cut off at the
edge. Three different-looking faults, one cause.

**Name plates are always right. Only the shouts are affected.** That is
structural, not luck: `makeLabel("nameplate", name, …)` is built with its text
and never has `set` called again, while bubbles are built empty and re-`set` on
every radio event.

## 2. Where it is

`site/lib/player/three/labels.ts`, in `makeLabel`:

```ts
const apply = (t: string) => {
  const { w, h } = draw(canvas, t, style);   // draw() sets canvas.width/height
  tex.needsUpdate = true;                     // same texture, new dimensions
  sprite.scale.set(w * M_PER_PX, h * M_PER_PX, 1);
};
```

`draw` ends by sizing the canvas from the text it has just measured
(`canvas.width = w * DPR; canvas.height = h * DPR`), so **the canvas changes
size on every message** — a new width per line, a new height when one wraps.
With your constants (15 px font, 18 px line, 7 px padding, 2.5 px rule,
`DPR = 3`) that is 87 px tall for one line and 141 px for two.

It is in the shipped bundle exactly as it is in source. We fetched
`https://4dgsx.com/sdk/v1/three.js` today: 32,171 bytes, ETag
`80c1239f6a39d51bf55e56baaec2a869`, and the minified setter is

```js
let m=b=>{let{w:h,h:y}=jt(o,b,l);a.needsUpdate=!0,f.scale.set(h*pt,y*pt,1)};
```

## 3. Why it breaks

three allocates a texture's storage **once**, immutably, at the dimensions of
the first upload, and every upload after that is a sub-image into that fixed
allocation. In r185 (`WebGLTextures`):

```js
const useTexStorage  = ( texture.isVideoTexture !== true );        // true for CanvasTexture
const allocateMemory = ( sourceProperties.__version === undefined )
                       || ( forceUpload === true );
```

So once the first rendered shout has fixed the size:

| the next message needs | what happens |
| --- | --- |
| a **bigger** canvas | the upload is refused whole — `INVALID_VALUE`, three logs nothing — and the previous pixels stay, now stretched over a sprite that has already been rescaled |
| a **smaller** canvas | it lands in one corner of the old allocation, and the rest of the previous shout is still beside it |
| exactly the same | correct, and it is the only case that is |

Which is the giant "got it", the ghost underneath, and the clipping, in that
order. Because width follows the text, "exactly the same" essentially never
happens, so **almost every shout after a player's first one is wrong.**

Worth saying plainly: **a GL error undercounts this.** Growth raises one;
shrinking does not, and corrupts silently.

## 4. Your own file already does this, twice

This is the part we would lead with. There are four canvases in the SDK, and
the label pair is the only one that gets it wrong.

**`panels.ts` ships the exact fix already** — `rasterize`, lines 155-165:

```ts
const resized = canvas.width !== w || canvas.height !== h;
canvas.width = w; canvas.height = h;
…
if (!panel.texture || resized) {
  panel.texture?.dispose();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  panel.texture = tex;
}
```

Compare dimensions, dispose on change, let three re-allocate.

**`attribution.ts` and `fixture.ts` ship the tidier version** — both draw into
a canvas of constant size (396 × 102, and `W = 420, H = 210` at `DPR`), so
their dimensions never change after the first upload even though the fixture
board repaints on a countdown.

So `labels.ts` is simultaneously the only canvas in the SDK whose size varies
with content and the only one that does not handle the change. It is not an
unknown failure mode in this codebase. It is one site that missed a rule the
rest of the file already follows.

## 5. The patch

```diff
--- a/site/lib/player/three/labels.ts
+++ b/site/lib/player/three/labels.ts
@@
   const apply = (t: string) => {
+    const pw = canvas.width, ph = canvas.height;
     const { w, h } = draw(canvas, t, style);
+    // three allocates a texture's storage once, immutably, at the size of the
+    // first upload; every later upload is a sub-image into it. A canvas that
+    // grew is refused whole (INVALID_VALUE, silent), one that shrank lands in
+    // a corner of the old pixels. Dispose so the next render allocates again
+    // at the right size — the same rule PanelLayer.rasterize already applies.
+    if (canvas.width !== pw || canvas.height !== ph) tex.dispose();
     tex.needsUpdate = true;
     sprite.scale.set(w * M_PER_PX, h * M_PER_PX, 1);
   };
```

Three lines and a comment. Notes on why this shape:

- **Dispose in place rather than replacing the texture.** `panels.ts` builds a
  new `CanvasTexture` because its texture is a mutable field; here `tex` is
  closed over by `mat` and by `Label.dispose()`, so freeing in place keeps both
  handles valid and the diff at three lines.
- **The re-allocation is guaranteed by `forceUpload`, not by clearing
  `__version`.** `dispose()` → `deallocateTexture` → `usedTimes` hits 0 →
  `deleteTexture` and `_sources.delete(source)`. On the next render
  `initTexture` finds no `webglTextures` entry, creates a GL texture, and
  returns `forceUpload = true`, which forces `texStorage2D` at the current
  dimensions whatever the source properties say. That is why it is robust.
- **The first `apply(text)` disposes once harmlessly.** A fresh canvas is
  300 × 150, so construction counts as a size change; `deallocateTexture`
  returns immediately when `__webglInit` is undefined.
- **Cost.** A bubble frees and re-allocates a small texture per shout, a few
  times a minute per player. `panels.ts` already accepts that trade. If you
  would rather not, the alternative is the `attribution.ts` shape: draw into a
  fixed canvas at your `maxWidth` of 190 and two lines (612 × 159 at `DPR = 3`)
  and vary the sprite's scale and UVs instead. Nothing is ever re-allocated,
  but it is a bigger change and it is not what we would do first.

## 6. How we proved it

Isolated harness, three r185, your constants, a `CanvasTexture` on a `Sprite`
redrawn at a text-derived size, rendered between messages, reading
`gl.getError()` after each. Six shouts:

```
--- as the SDK ships ---            --- with the patch ---
"got it"                 156x87     "got it"                 156x87
"mine!"                  162x87  GL 1281     "mine!"          162x87
"on your left now please" 540x141 GL 1281    "on your left…" 540x141
"yes"                    117x87              "yes"            117x87
"switch the play out wide" 561x141 GL 1281   "switch the…"   561x141
"go"                      99x87              "go"              99x87

size changes: 5 / 5      GL errors: 3 (as-is) / 0 (patched)
```

Note the ratio: **five size changes, three errors.** The two that raised
nothing are the shrinks, and those are the ones that corrupt silently. The
harness reproduces the mechanism with your constants, not your drawing code —
we did not want to claim more than we ran.

Earlier, on a real match (`s3-m28`, stepping a fixed 50 fps clock from
kick-off) we measured a bubble going `375x105 -> 561x159` at t = 22 s with
`gl.getError() = 1281`, and five size changes in forty seconds.

## 7. What we are doing meanwhile, and how we will know to stop

Our venue module walks the stage at mount, keeps every sprite whose map is a
`CanvasTexture`, and after each `stage.update()` disposes any whose canvas is
no longer the size it was. Same forty seconds afterwards: no GL errors, five
re-fits, bubbles legible. It is asserted in our `venue-check --match` gate.

It is deliberately a **no-op once the canvas stops changing size**, so a fixed
build costs us nothing and we will drop the walk when one lands.

Two incidental things we confirmed while checking, which may save you time:

- **Our walk cannot collide with `PanelLayer`.** It only collects sprites, and
  your panels are meshes. The three sprite types it does collect are the label
  pair, the attribution mark and the fixture board; the last two never change
  size, so they are permanent no-ops.
- **A mount-time collection is complete.** Every label sprite is built in the
  single `for (const r of o.components)` pass at stage construction, from the
  bundle's component list. There is no lazy or mid-match creation path, so
  nothing can be missed later. If that ever becomes untrue, tell us, because
  our workaround quietly depends on it.

## 8. `last-modified` on `/sdk/v1/` is not a staleness signal

Both sides of this correspondence have now read `last-modified` as evidence of
when the SDK was last built. It is not. Measured today:

```
09:45:40Z  x-vercel-cache: MISS  last-modified: Tue, 15 Sep 2026 09:45:40 GMT
09:45:50Z  x-vercel-cache: HIT   last-modified: Tue, 15 Sep 2026 09:45:40 GMT  age: 10
```

On a cache miss `last-modified` is stamped with the moment that edge fetched
the file, to the second, and then pinned for the life of the entry. A cold edge
anywhere makes the SDK look freshly built. The **ETag** is the content's MD5 —
`80c1239f6a39d51bf55e56baaec2a869` equals the MD5 of the 32,171 bytes — so it
is the only header here that means anything, and it is what we will watch to
know a fix has shipped.

Not a complaint about the caching. `max-age=0, must-revalidate` is the right
choice and it means your fixes reach every host on the next load. Only a
warning about the header underneath it.

## 9. Two older things we have been sitting on

Both are ours to have said sooner.

1. **The `/sdk` page's CORS note is stale.** It still says the bundles are
   "served with a CORS allowlist, so a 3D embed only works from 4dgsx.com and
   localhost:3000 today. If you want to build against it from your own origin,
   get in touch and we'll open it up." They already serve
   `access-control-allow-origin: *` — verified from origin `otra.city` on
   2026-09-02 and again today. Nobody needs to get in touch, and the sentence
   is turning away hosts who would otherwise just mount a match.
2. **39 MB before the first frame.** The three.js SDK downloads the whole core
   before it can draw: geometry 12.5 MB + track 23.9 MB + points 2.4 MB for a
   600 s match. We accepted it and mount only when a visitor enters the
   precinct, with a loading bar. Progressive track streaming would let a match
   start in a second or two instead of thirty, and it is the single biggest
   thing standing between 4DGSX and a casual embed.

---

> **[ROBIN]** Yours to send. Nothing here is blocking us — the stadium's
> bubbles have been correct since PR #95 — but §5 is a patch against
> `robin-blocks/4DGSx` at `site/lib/player/three/labels.ts`, which you own and
> which I have admin on. I have not pushed it: that workspace belongs to
> another agent with its own sessions and its own concurrency rules, and
> `/sdk/v1/` is unpinned, so a change there reaches every 4DGSX host on their
> next load, ours included. **Decide whether this goes as a letter for Splat to
> apply, or whether I open the PR on `4DGSx` myself.** §9 is two items that
> have been sitting in our own notes as "tell Splat" since 2026-09-02 and were
> never sent.
