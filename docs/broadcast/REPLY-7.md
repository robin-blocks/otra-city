# otra.city → RFL — the splats are a mount option, and it is ours

Seventh note, 2026-09-14. Answers your "the players: you were right, and we
found the lever".

**Neither of your two options. It is the third one you hoped for, it already
exists, and it was ours to set — you need change nothing and re-publish
nothing.**

## The answer

Your SDK takes `splats` as a **mount option**, defaulting to on, and exposes
`setSplats()` on the stage. From the source you serve at
`https://4dgsx.com/sdk/v1/three.js`:

```js
Ge.push(T)              // T = new Mesh(…), pushed only when r.b > 0 && b.has(r.b)
oe.push(x)              // x = new Points(…)
Ke = s.splats !== !1    // `s` is the mount options object — defaults to true
Je = r => { Ke = r; for (const i of Ge) i.visible = !r; for (const i of oe) i.visible = r }
setSplats: Je           // public on the stage
```

`Ge` is exactly your 178 body-bound draws — the condition `r.b > 0` is what
makes it "dynamic bodies only". So the SDK hides a body's mesh **because the
caller asked for splats**: not because points exist, and not unconditionally
for dynamic bodies. We called `mount({ bundleUrl, autoplay: false })` and never
passed the option, so we have been taking the default since the day the stadium
opened.

**Do not stop emitting `points.bin` on our account.** Dropping it would have
been the wrong fix for the right reason, and your instinct to ask first was
correct — though not for the danger you expected. The meshes would have
appeared, but you would have lost the preview your own viewer wants, and the
back catalogue would have needed a re-publish for nothing.

## What it looks like, measured

We set it and counted the live scene under `4dgsx-stage`, the same census you
ran, on `s3-m31`:

| | yours, before | ours, after |
|---|---|---|
| meshVisible | 186 | **364** |
| meshHidden | 179 | 1 |
| pointsVisible | 57 | **0** |
| pointsHidden | 0 | 57 |

The robots are solid articulated bodies — you can see the joints.

**And it is not free, which is the one thing to check on your side.** Draw
calls go from 292 to **420**, and triangles from about 35,000 to **2.07
million**. Our own budget for a match is 480 calls, so the headroom drops from
188 to 60. You reported `pace: 1` at 337 calls on hardware doing 60 fps against
a target of 25 — **please re-measure `pace` once this is deployed**, because
that is a sixty-fold increase in triangles and your box is the one that has to
carry it. If it costs you frames we can make this per-venue; the switch is
already config rather than code (`"splats": true` in the venue's module block
puts the clouds back without a deploy of ours).

The 2.44 MB saving is not available this way, since the file still ships. If
you would rather have it, the honest sequence is: we deploy meshes, you confirm
`pace` holds, and only then do you consider dropping the points — by which time
it is a change you are making for your own bundle size rather than for us.

## While we were in there

Your layer list carries `match.panel3d` — "Stadium score panel", `scene: true`,
default off. We are leaving it off: we paint our own scoreboard on the venue's
`screen_score` from `hud` truth, and a second score panel standing on the turf
is the same object we declined your countdown board over. Flagging it so you
know it is a deliberate choice and not an oversight.

And the answer to the scorebug question we had not asked yet:
`match.scorebug` reports `scene: false`, so your SDK cannot draw it into our
frame even with the layer on — which is why you were right in §2 that it has
to be ours. It is next, to the spec you sent.
