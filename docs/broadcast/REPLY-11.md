# otra.city → RFL — both corrections accepted, and we will take the SDK part direct

2026-09-15, answering your letter on the shout bubbles. Short, because most of
what you sent is yours to keep rather than ours to answer.

## Both corrections stand, and the second one was ours to have got right

**`4dgsx.com/watch` is not down — we built the URL wrong.** Confirmed: `/watch`
on its own 404s, `/watch/s2-m11_frontier_manus_frontier_sol` is 200 and 69 KB.
Our question 1 was a bad measurement dressed as a finding, and you answered it
anyway. Thank you.

**The SDK is not yours.** Accepted, and the letter should not have been
addressed to you. We had 4DGSX and the league collapsed into one counterparty
in our own notes, which is exactly the kind of thing that ends with a report
sitting in the wrong inbox.

You do not need to carry it upstream. **We are sending it to 4DGSX directly**,
with your §2 attached as the strongest part of the case, so the one thing we
would ask is that you do not spend your own standing on it.

## Your §3 is confirmed independently

We pulled the watch page's ten chunks and grepped them. `#version 300 es`,
`createShader`, and the DOM classes `fx-plate` and `fx-bubble` are all there in
`35mdln3ndt147.js`, and across 680 KB of chunks there is **no `CanvasTexture`
and no `SpriteMaterial` at all**. So the site player cannot have this bug, for
the reason you gave rather than by luck.

Your framing is the useful one and we have taken it: three implementations of
4DGSX labels exist, two draw them as DOM, one draws them as sprites, and the
sprite one is the SDK. We are the only consumer on that path, which is why
nobody named it in a season of matches.

## One thing to hand back: `last-modified` there means nothing

You cited `last-modified: Mon, 14 Sep 2026 10:17:33 GMT` as today's copy being
built that morning. It was your edge's fetch time. Measured today:

```
09:45:40Z  x-vercel-cache: MISS  last-modified: Tue, 15 Sep 2026 09:45:40 GMT
09:45:50Z  x-vercel-cache: HIT   last-modified: Tue, 15 Sep 2026 09:45:40 GMT  age: 10
```

A miss stamps it with the moment of the request, to the second, and pins it for
the life of the cache entry, so a cold edge anywhere makes the SDK look freshly
built. The ETag is the body's MD5 and is the only header there worth watching.
It has not moved since your fetch, so nothing has shipped yet — which is the
answer to "has it landed", and it is not the answer `last-modified` gives.

Your §4 conclusion is unaffected. `max-age=0, must-revalidate` does mean a fix
reaches us on the next load, and you were right to say only 4DGSX can make that
a contract rather than an observation. We are keeping the `venue-check --match`
gate for the reason you gave: unpinned means we take the regressions too.

## Still yours, unchanged

`bundleUrl` on `upcoming`, the league table, more than one upcoming fixture,
and whether the SDK hides body meshes because points exist. The tracked gantry
is still ours and still next.

---

> **[ROBIN]** Yours to send. Nothing in it needs a decision. It pairs with the
> letter in `docs/4dgsx/SDK-LABELS.md`, which does.
