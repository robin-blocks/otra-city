# otra.city → RFL — a sixth thing, and this one is in your SDK

2026-09-14, a few hours after the last letter. Not a correction to any of the
five — new, found this evening while looking at something else.

**The shout bubbles have been wrong since the day we mounted our first match,
and it is a four-line fix in your label code.** We have worked around it at our
end, so nothing is blocked and this is not urgent for us. We are writing because
it is your code, because the fix belongs there rather than in every host's, and
because if your own viewer draws labels this way it has the same bug.

---

## What it looks like

Robin caught it on the gantry shot: a robot saying **"got it"** in letters four
times the height of everyone else's, the two-line remains of its previous shout
still showing underneath, and elsewhere a bubble with its text cut off at the
edge. Three different-looking faults. One cause.

Name plates are always right. Only the shouts are affected.

## Where it is

`https://4dgsx.com/sdk/v1/three.js` — the label pair, minified as `jt` (draws)
and `_e` (builds the sprite). Every label is a `Sprite` with one
`CanvasTexture`, and the setter is:

```js
let m = b => {
    let { w: h, h: y } = jt(o, b, l);        // jt RESIZES o: s.width = S * ve, s.height = H * ve
    a.needsUpdate = !0;                       // same texture, new canvas dimensions
    f.scale.set(h * pt, y * pt, 1)            // sprite rescaled to match
};
```

`jt` sets `canvas.width` / `canvas.height` from the text it just measured, so
the canvas **changes size on every message**: a new width per line of text, and
a new height when one wraps. With your constants — 15 px font, 18 px line, 7 px
padding, 2.5 px accent bar, `ve = 3` — that is 105 px tall for one line and
159 px for two, which is exactly what we measure.

The only caller is the radio event:

```js
if (x.type === "radio") { J.label.set(String(x.text ?? "")), J.until = x.t + (x.dur_s || 3.5) }
```

Name plates escape because `_e("nameplate", name, …)` sets its text once at
construction and nothing calls `set` again. Bubbles are built empty —
`_e("bubble", "", I)` — and invisible, so their allocation is made by the first
shout that actually reaches the screen.

## Why it breaks

three allocates a texture's storage **once**, immutably, with `texStorage2D`, at
the dimensions of the first upload. Every upload after that is a `texSubImage2D`
into that fixed allocation. It has worked this way for years and it is not
specific to our build (we vendor r185); whatever your peer `three` is, it almost
certainly does the same.

So, after the first rendered shout fixes the size:

| next message needs | what happens |
|---|---|
| a **bigger** canvas | upload refused whole — `INVALID_VALUE`, three logs nothing — the previous pixels stay and are stretched over the newly rescaled sprite |
| a **smaller** canvas | lands in one corner of the old allocation; the rest of the previous shout is still there, beside the new one |
| exactly the same | correct, and it is the only case that is |

Which is the giant "got it", the ghost underneath, and the clipping — in that
order. Because width follows the text, "exactly the same" essentially never
happens, so **almost every shout after a player's first one is wrong.**

## What we measured

On `s3-m28`, from kick-off, stepping a fixed 50 fps clock:

```
t = 22 s   a bubble goes 375x105 -> 561x159   gl.getError() = 1281 (INVALID_VALUE)
```

Worth saying plainly: **1281 undercounts it.** Growth raises a GL error, and
shrinking does not — that case corrupts silently. Over 40 seconds of one match
we counted five size changes; only some of them ever showed up as an error.

## What we did, so you can see the shape of the workaround

The SDK is yours and loads from your CDN, so we fixed it from outside: our
venue module walks the stage at mount, keeps every sprite whose map is a
`CanvasTexture`, and after each `stage.update()` disposes any whose canvas is no
longer the size it was. three then re-allocates it at the right size on the next
render, and your own handle to the texture stays valid.

Same 40 seconds afterwards: **no GL errors, five re-fits, and the bubbles read
correctly.** It is in our `venue-check --match` gate now, so it cannot come back
without something going red.

## What we would suggest at your end

The same rule, four lines earlier in the chain, where it costs one comparison
instead of a scene walk:

```js
let m = b => {
    const pw = o.width, ph = o.height;
    const { w: h, h: y } = jt(o, b, l);
    if (o.width !== pw || o.height !== ph) a.dispose();   // storage is immutable; let three re-allocate
    a.needsUpdate = true;
    f.scale.set(h * pt, y * pt, 1);
};
```

The tidier version, if you would rather not free a GPU texture several times a
minute per player: draw into a **fixed-size** canvas — your own `maxWidth` of
190 and two lines is 612 x 159 at `ve = 3` — and vary the sprite's scale and UVs
instead of the canvas. Then nothing is ever re-allocated and the shouts cost one
upload each.

## Two questions

1. **Does your own player show this?** We could not check: `4dgsx.com/watch`
   returns 404 today. If it shares this label code, it does, and nobody watching
   would necessarily have named it as a bug rather than as odd-looking captions.

2. **How does a fixed build reach us?** Our note said `/sdk/v1/` was
   immutable-cached, and that turns out to be stale — it serves
   `cache-control: public, max-age=0, must-revalidate` with an ETag, and today's
   copy is `last-modified` this morning. So we read as if a fix lands the moment
   you ship it, and we would rather hear that confirmed than assume it. Happy to
   drop our workaround and re-run the gate against a new build whenever you have
   one; it is deliberately a no-op once the canvas stops changing size.

---

> **[ROBIN]** Yours to send, as ever. Nothing in here needs a decision from you
> and nothing in it is blocking — the stadium's bubbles are correct as of PR
> #95. The only judgement call is tone on question 1: it is possible we are
> telling them their flagship viewer has been shipping garbled captions all
> season, so it is written as a question rather than a finding.
