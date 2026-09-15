# otra.city → RFL — boards, crests and head-cam replays are on

2026-09-14, evening. Three of the four things Robin saw on the stream today,
built on our side. Nothing here needs anything from you, but two of them get
better the moment you publish something, so those are marked.

## 1. The advertising boards are back — yours, put on by us

Your bundles reach us with the boards as flat dark boxes (v0.3; your
`surface_tex` sits behind `RFL_4DGSX_SURFACE_TEX` and the SDK does not draw
`tex.proj` yet). So the stadium dresses them itself, for every client in the
bowl: it finds the boards by shape — thin upright panels 0.78 m tall — and
puts your own LED designs on them from one atlas, laid out as `football.py`
lays them: `url`/`league` alternating along each touchline, the south run
offset by one, the outer face of the south wall in the wider panels, league
above the goal line and URL below it at the ends. One draw call for the ring.

**When you want to change the artwork**, send us the panel PNGs (512 px tall
at each width class is what we have) or, better, ship `tex.proj` and teach the
SDK to draw it — then a bundle whose boards already carry a texture will be
left alone, which is the one change we will make on our side.

## 2. Crests on the scorebug

At 26 x 26 at both ends of the bottom bar, per your spec. You have not
published crest URLs, so we cut them from the badges in `teams/*/identity/`
(eleven clubs; transparent; 128 px) and serve them from our origin, keyed by
club code. **A `crest` URL on the team object outranks ours** the moment you
add one — in hud.json, or on `home`/`away` in the programme feed — provided
it is served with `access-control-allow-origin`, because the scorebug is a
canvas that becomes a texture.

## 3. Head-cam replays

Your programme map holds the match clock at every goal for exactly
`replay_s` (m32: sixteen holds, fifteen goals, every one exactly on its goal,
5.0 s each). On `/broadcast` that hold is now the replay: the stage runs the
last `replay_s` seconds up to the goal again from the scorer's head, looking
at the ball, with the scorebug clock and score held and a REPLAY tag on. The
director cuts to it and hands back when the hold ends. Visitors in the bowl
keep the dwell, as your programme has it.

We reach the scorer's body without a public accessor and without guessing:
your SDK hangs each nameplate on its body group at the player's anchor
offset, so every player's sprite is checked against the group their body
index names before anything is trusted. If that ever stops lining up the
head cam simply does not fire. A `stage.body(name)` would still be welcome
and would let us drop the check.

**Live fixtures replay too**, because of §4 below.

## 4. A live fixture now follows your programme

Your `startsAt` is the stream start — programme time 0 — and the SDK's
schedule puts match t = 0 there, so the stadium has run 180 s ahead of your
broadcast since its first fixture, with no build-up and no holds. From this
build the stadium adopts a live fixture and drives it through the bundle's own
`program.map` from `startsAt` on the wall clock (the SDK's stage is kept
untouched and comes down when your schedule says; ours is mounted from the
same, cached, URL). What the stadium shows is now your programme: the pre-roll
with the players held and the ground's own screens counting down to kick-off,
kick-off at `startsAt` + 180 s, your holds as our replays, the post-roll to the
end. `state().match.drive` reads `wall` while it is on.

**For your supervisor, one thing.** `state().match.audioOffset` is where the
premix should be, on every route, and it is right from the first frame after
the mount. The `<video>` you were reading is the SDK's own dock media: its
clock is set on the stage's first sync, and you sampled it before that — which
is the `offset 0.00s via page media element` in your log tonight, and why the
commentary was three minutes late even though the element read 180.0 a few
seconds later. Take `audioOffset` first; the element only when it is
non-zero. And your fallback through `match.score.t` is the time of the last
goal, not the match clock — `match.t` is the clock.

## What m33 showed, and a fault of ours it exposed

The deployed page mounted m33 from your schedule at 19:02:21Z — the first
scheduled fixture either side has seen land on `/broadcast` at kick-off —
and your supervisor took the bundle from `state().match.bundleUrl` and played
the premix. That path is proven now.

But it played it **from 0.00 s**, and the director flew the helicopter through
a live match. Both were us. Our build of 14 Sep read the match time through
`program.map` for every mounted bundle, while the programme clock behind that
map only advances for a replay the city puts on — so for a scheduled fixture
the scorebug reported *First Half 05:00, playing false, pre-roll, audioOffset
0* for the whole match (measured on production at 19:06Z, 4-1 and five minutes
in). Fixed in the build that carries this letter: the programme clock speaks
only while we drive, a live fixture reports its own clock and its
`audioOffset` through `audio.map` as before, and the gate now asserts it
against a fixture the city did not put on. The `offset 0.00s` in your log
tonight was our field, not your reading of it.

## Not changed tonight

The tracked gantry — your yes with the `football.py` numbers is received and
will be built next; and we still want `bundleUrl` on `upcoming`, the league
table, and more than one upcoming fixture.
