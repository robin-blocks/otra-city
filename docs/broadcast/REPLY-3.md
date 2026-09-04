# otra.city → RFL — §5 and §6 are built

Third reply, 2026-09-04. Follows `REPLY.md` and `REPLY-2.md`.

Short version: rather than wait on decisions, we built the rest of the brief.
**The crowd, the named cameras and the camera track reader are done and
deterministic.** Reference: `docs/broadcast/CAMERAS.md`.

> **[ROBIN — decide before sending]** Two things are still yours and neither is
> engineering: the arena (their furniture-only bundle vs a native build — see
> `REPLY-2.md` §2, recommendation is take the bundle) and credit wording, which
> neither side has proposed. Delete this block before pasting.

---

## 1. What is live now

`otra.city/broadcast` is deployed. Everything below is on it today.

| your ask | state |
|---|---|
| §4 `step()`/`frame()`, determinism | done, and holding with everything below added |
| §4 `camtrack` | **done** — your schema, with a worked example you can fetch |
| §4 `t0`, `seed` | done |
| §4 `timeofday` | done, with a caveat worth reading (§4 below) |
| §5 `GANTRY` | done, sightline re-verified every CI run |
| §5 `HELI`, `STANDS`, `PITCHSIDE` | **done** |
| §5 `TRACK` | **done** |
| §6 crowd | **done**, except match-event reactions, which you called a later phase |
| §3 arena furniture | **dropped**, pending your bundle — `REPLY-2.md` §2 |
| §9 no audio | the venue PA is stripped from this page entirely |

## 2. The determinism still holds, with all of it running

```
node scripts/broadcast-check.mjs --frames 900 --crowd 0.7 \
  --camtrack /broadcast/camtrack-example.json
```

```
  PASS  the crowd is seated — 400 of 600 seats at density 0.7
  PASS  the camera track loaded — 4 segments to frame 1750
  PASS  nothing the stadium is built from obstructs the 14 x 9 area
  PASS  no network after load — 37 resources at ready, 37 after 900 frames
  PASS  the crowd is not a still photograph — frame 1 6da937fc vs frame 900 09655062
  PASS  two independent runs give the same pixels at frame 900 — 09655062 vs 09655062
PASS  18/18 checks
```

Two of those are new and deliberate.

**"Not a still photograph"** is there because the cheapest way to pass a
determinism test is to render a crowd that never moves. It hashes frame 1
against frame 900 and fails if they match — so the suite cannot be satisfied
by the exact failure you named in §6.

**The empty stadium still hashes to `cf98f9a2`**, byte for byte, the same as
before any of this existed. None of it perturbs the capture path when it is
not asked for.

Both run in CI on every change, on a completely different rasteriser
(SwiftShader) from the machine we develop on — so the determinism claim is not
an artefact of one GPU.

## 2a. Something in your SDK worth knowing about

While tightening the above we found a second late-loading bug, and this one is
in your court rather than ours.

**`mount()` resolving is not the end of a bundle's loading.** After it
resolves, the SDK fetches its dock panels — we saw
`…/ui/lineup.html` arrive about a second later, on the wall clock, with no
promise exposed to wait on. So a capture that started at mount would film the
line-up panel blank, then populated, at a moment determined by network speed
rather than by frame number.

It did not show up as a determinism failure at first, because on a fast link
both runs had the panel well before the frame we hash. That is the
uncomfortable part: **it is a bug that passes a determinism test on a good
network and fails on a bad one**, which is the kind that reaches air rather
than CI.

Our fix is general rather than aimed at this one file: `ready` now also waits
for the page to stop fetching anything at all — 1.5 s of quiet, wall-clock,
advancing nothing. That covers `lineup.html` and whatever else the SDK pulls
after mount, now or later.

You may still want a promise on your side that covers dock-panel loading, for
consumers who are not us. And it strengthens the case for the external-clock
entry point you offered: an interface that promises "everything is loaded and
nothing moves except by my timestep" is a much better guarantee than our
current one, which is an observation about quiet.

## 3. Coordinates — the one interop detail

**Everything is venue-local metres: origin at the centre spot, +x toward the
east goal, +z toward the north stand, y up.** That is your §3 frame exactly.
The stadium's placement in the city never appears in a track file, and the page
converts to world space once, when it points the camera.

So a track file your tooling generates against the RFL arena should work here
unmodified. If your exporter emits anything else — z-up, or y-forward — tell us
now rather than after the first cut looks wrong.

A worked example is served at **`https://otra.city/broadcast/camtrack-example.json`**.
It is the CI fixture as well as the documentation, so it cannot drift from what
the page actually consumes. Diff your generator's output against it.

Two details in the schema that are ours, and that you may want to rely on:

- `explicit` frames are indexed **from the start of their own segment**, so a
  tracking shot can be re-cut to a different point in the programme without
  re-exporting it. Named-camera segments likewise run on their own clock, so a
  cut to `HELI` always begins at the same point in the orbit.
- **The whole file is validated before filming starts.** An unknown camera name
  or too few explicit frames fails at load, not at frame 90,000.

## 4. The crowd, and one thing to look at

`crowd=0..1` fills that fraction of the stadium's 600 seats. Seat, clothing,
posture, idle rate and stand-up schedule all come from the seed; poses are a
pure function of simulated time, so the crowd seeks correctly rather than
drifting out of step when you jump a capture.

It is instanced — **ten draw calls for the whole stand, not ten per fan**. 400
fans from the gantry cost about 10 draw calls and 50k triangles on top of the
empty stadium, so crowd density is not where your 40 ms goes.

Fans breathe, shift, lean and stand; roughly one in eight is on its feet.
Match-event reactions are not built, as agreed.

**Please look at a `STANDS` close-up early and tell us if it holds.** You wrote
"not static mannequins at 5 m" and that is the one requirement in the brief we
cannot verify with a hash — it is a judgement, and it is yours. We got two
things wrong before it read correctly (fans sitting 33 cm too high, and legs
pushing through the front wall of the terrace's first row), both found by
looking rather than by testing, which is why we would rather you looked too.

## 4a. `HELI` was wrong the first time, and here is what it is now

Worth flagging because you asked for "believable handheld/turbulence shake"
and the first version only delivered the "seeded, not random" half of it.

Measured, that version came out at **0.08 Hz and 3 mm of movement per frame,
with no roll at all** — which is a crane on a calm day, not an aircraft. It
would have passed every determinism test we have and looked wrong on air.

Rebuilt around three things:

- **Aim wander is angular, not positional.** At 60 m, sliding the body a metre
  barely moves the frame; turning the aim a quarter of a degree moves it eight
  pixels. It is specified in radians now, so it reads the same at any radius.
- **Two bands** — slow airframe wander (~0.3 Hz, the wind) and a small 5–7 Hz
  component (the machine the camera is bolted to). Either alone reads wrong:
  the first as a drone, the second as a broken mount.
- **Roll**, which was simply absent. The camera banks into the turn, and the
  angle is physics rather than taste: a coordinated turn at `v² / rg` is
  **1.68°** at the default radius and period, with the operator's horizon
  wandering on top of it (measured range 1.05°–2.17°).

The default is a **gyro-stabilised aerial** — smooth, slow bank, gentle drift
— because that is what a broadcast helicopter actually delivers; visible rotor
buzz in a Cineflex shot would be a fault, not realism. `turbulence` scales it
up if you want a rougher mount, and `bank: 0` levels the horizon.

This is exactly the kind of thing footage settles faster than we can. Tell us
if you want it looser.

## 5. `timeofday` — read the caveat

It works, and it is a **lighting shift, not an art pass.** otra.city is
authored for night: the emissive signage, the floodlights and the bloom are the
look of the place. Raising `timeofday` lifts the ambient, brightens the sky,
pushes fog back and pulls exposure down. It reads as **dusk or an overcast
afternoon**, not bright daylight, and the neon stays lit because it is painted
in rather than lit.

If genuine daylight matters to the programme, say so — it is a real art job on
the city, not a parameter, and better scoped now than discovered in a title
sequence.

## 6. What we need from you

1. **The furniture-only bundle**, if you are taking that path (`REPLY-2.md` §2).
   It is the last thing blocking the arena, and we have built nothing that
   would collide with it.
2. **A real camera track generated from m4**, whenever convenient. Ours is
   synthetic; yours will find the disagreement between our reader and your
   exporter, and it is much cheaper to find now.
3. **Point your harness at `/broadcast` and film 60 seconds.** It is deployed,
   the contract is stable, and every remaining question about feel — the crowd
   close-up, the helicopter's turbulence, whether two rings of advertising is
   one too many — is answered faster by footage than by us guessing.
4. **Credit wording.** [ROBIN]

## 7. What is still not built

- Match-event crowd reactions (§6, a later phase by your own framing).
- A tunnel or behind-goal camera (§5, "your ideas welcome" — not yet).
- The arena furniture, pending §6.1 above.
- Genuine daylight, per §5.
