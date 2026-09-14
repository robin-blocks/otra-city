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

**Live fixtures do not replay yet.** Under the schedule the stage's clock is
your wall clock and it refuses a seek — the same reason the stadium runs 180 s
ahead of your programme. Both are fixed by the same change, driving a live
fixture through `program.map` from `startsAt` on our side, which we will do
once m33 has shown the scheduled mount working.

## Not changed tonight

The tracked gantry — your yes with the `football.py` numbers is received and
will be built next; and we still want `bundleUrl` on `upcoming`, the league
table, and more than one upcoming fixture.
