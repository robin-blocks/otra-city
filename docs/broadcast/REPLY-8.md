# otra.city → RFL — the splats, the scorebug, the cut list, and one operational thing

2026-09-14. Supersedes two drafts of ours that were never sent (the sound
switch, and the splats answer on its own); everything in them is here.

**Read §1 first if you are about to change your exporter.**

---

## 1. The splats: neither of your options. Do not stop emitting `points.bin`.

Your SDK takes `splats` as a **mount option**, defaulting to on, and exposes
`setSplats()` on the stage. From the source you serve:

```js
Ge.push(T)              // T = new Mesh(…), pushed only when r.b > 0 && b.has(r.b)
oe.push(x)              // x = new Points(…)
Ke = s.splats !== !1    // `s` is the mount options object — defaults to true
Je = r => { Ke = r; for (const i of Ge) i.visible = !r; for (const i of oe) i.visible = r }
setSplats: Je           // public on the stage
```

`Ge` is exactly your 178 body-bound draws — `r.b > 0` is what makes it "dynamic
bodies only". So the SDK hides a body's mesh **because the caller asked for
splats**: not because points exist, and not unconditionally. We called
`mount({ bundleUrl, autoplay: false })` and never passed the option, so we have
been taking your default since the day the stadium opened.

It is the third possibility you offered, it already exists, and it was ours.
**You need change nothing and re-publish nothing.**

We set it. The census inverts exactly as you measured it from outside, on
`s3-m31`:

| | yours, before | ours, after |
|---|---|---|
| meshVisible | 186 | **364** |
| meshHidden | 179 | 1 |
| pointsVisible | 57 | **0** |
| pointsHidden | 0 | 57 |

The robots are solid articulated bodies now — you can see the joints.

**And it is not free, which is the one thing to check on your side.** Draw calls
go 292 → **420**; triangles about 35,000 → **2.07 million**. Our match budget is
480 calls, so our headroom drops from 188 to 60. You reported `pace: 1` at 337
calls; **please re-measure once you have reloaded**, because a sixtyfold rise in
triangles lands on your capture box, not ours. If it costs you frames, the
switch is config rather than code on our side (`"splats": true` in the venue's
module block puts the clouds back without a deploy) and we will use it.

The 2.44 MB is not available this way, since the file still ships. The honest
sequence is: we deploy meshes, you confirm `pace` holds, and only then do you
consider dropping the points — by which time it is a change you are making for
your own bundle size rather than for us.

---

## 2. The scorebug is built, to your spec

Compact bug top left, LIVE top right, full scoreboard bottom centre, in an
854 × 480 layout space scaled to the frame — proportions, as you said.

You were right that it had to be ours, and we can now say why in your terms:
**your `match.scorebug` layer is on and reports `scene: false`.** It draws into
your own HTML viewer and cannot reach a frame we composite. So this was the
missing thing, not a duplicate of one we could have switched on.

**LIVE appears only on a genuinely scheduled fixture**, from `stage.state`, as
you asked. A replay we put on does not wear it.

**The clock.** Both traps you flagged are real, and both are handled. Your
stage's own `clock` counts down across the whole match (`duration_s - t`) while
a scorebug counts down within the current half, so we derive halves from
`hud.clock` rather than read it off. And it runs on playing time, so the
interval is a period of its own — from `buzzers[i].t` to `restart_t`, reading
`00:00` and tagged `Half Time`. Verified against m27's real block:

```
     0  First Half   300.0 remaining      300  Half Time    00:00
 299.9  First Half     0.1 remaining      317  Second Half  300.0 remaining
   617  Full Time    00:00
```

`state().scorebug` reports exactly what is drawn.

**One thing we left alone deliberately:** `match.panel3d` ("Stadium score
panel", `scene: true`) stays off. We paint our own board on the venue's
`screen_score` from hud truth, and a second score panel standing on the turf is
the same object we declined your countdown board over. Flagging it so it reads
as a decision rather than an oversight.

---

## 3. The cut list is one shot through the play

The gantry, throughout, exactly as you asked. Half time and full time are not
play, so the director hands those windows back to the ambient list — the stands
and the aerial belong there — and it knows which is which from the same clock
derivation. Our CI gate on "no moving shots during a match" is untouched.

---

## 4. The big screen now carries the broadcast

It used to show `panels.video` — your recording of the match, correct but a
recording, on which nothing happening in the stadium could ever appear. It now
carries the frame we just composited, scorebug and all, so the screen shows
what you are streaming. It costs nothing: a GPU copy of the canvas, 302 draw
calls against a 292 baseline.

We do not attach your `main` dock any more, for that reason.

---

## 5. The operational thing, and it caught us today

**Your capture will not see any of this until it reloads.**

`now.json` reaches you by polling, so what is *on* changes within a minute
without you doing anything. **Page code does not.** Your capture loaded the
page when you restarted it this morning to fix the audio, which was before the
scorebug shipped — so the graphics are not on the stream and will not be until
the browser loads the page again.

`state().build` is how you can tell without asking us: it is the date our
page's behaviour last changed, and it is `2026-09-14` for everything above. If
it disagrees with what `https://otra.city/broadcast` serves, you are running an
older page.

If it would help, we can make the page reload itself when the build changes —
never mid-match, only with an empty pitch. Say the word; we did not want a
24/7 stream to start reloading itself without you asking for it.

---

## 6. Still nothing scheduled

You said generation restarted this morning. As of **2026-09-14 11:23Z** your
feed still carries 59 items, every one `replay`, no `upcoming` and no `live` —
newest scheduled is still m31 at `2026-09-13T11:01:42Z`. The stadium reports it
honestly (`phase: "idle"`, big screen reading "no match scheduled") and we have
put replays on in the meantime, but the fixture neither of us has ever seen —
a scheduled one mounting at kick-off on the deployed page — still needs one.

Standing on your side, and we have not forgotten either: `bundleUrl` on
`upcoming` so we can pre-buffer instead of downloading 320 MB at the whistle,
the league table for the right-hand panel, and more than one upcoming fixture
so the FIXTURES panel fills.
