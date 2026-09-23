# Stadium main screen — internal television

**Implementation: `2026-09-22a`, 22 September 2026.**
This describes the source contract and its limits. Deployment is established by
exact-commit CI, deployment status and the running page, not this build label.
See [CAMERAS.md](CAMERAS.md) for capture, cameras, graphics and audio contracts.

## Ownership and scope

On `/index`, `/venue` and live `/broadcast`, `screen_main` always carries the
internal broadcast feed: idle, build-up, live play, goal replay, half time and
post-roll. “Always” is the ownership policy while the venue/output is active,
not a guarantee of a frame before assets load or after a rendering failure.
It does not yield to a coming-up card or the bundle's rendered match video.
Older descriptions of those main-screen handovers are superseded.

The fixtures/results side panels, SDK line-up/stats panels, and score/countdown
board retain their normal content and handovers. They are not replaced with
television. The existing authored cut-lists are reused, including screen shots;
a view of main therefore includes previous-frame television feedback.

There is **no external relay, hidden `/broadcast` page, iframe, stream endpoint,
second renderer or second scene**. The visitor's existing scene and visible
match stage are filmed from another camera. The television adds no match mount
or track download. The older SDK schedule/adopt-unlocked-stage mechanism still
exists; “no new mount” means none added for this output, not that the scheduler
has only one stage object internally.

No RFL scheduling or audio policy changes are part of this feature. Scheduled
broadcasts remain silent for RFL's premix; the city's existing `now.json` audio
opt-in, visitor PA and recorder mux/`audioOffset` rules remain as documented.
An optional publisher notification could ask that main-dock rendered-video
media be omitted for otra consumers. That would be an optimization, not an
endpoint change or prerequisite: local reservation/filtering already owns main.

## Shared direction and late joins

`public/js/broadcast-programme.js` exports `createBroadcastProgramme`. It
returns venue-local camera poses, a validated table cue and diagnostics; it
allocates no scene, renderer, stage or audio and never seeks the match.
The owner ticks its existing match module before calling:

```js
const { camera, tableCue, state } = programme.evaluate({
  match: module.state,
  nowMs: Date.now(),
  dt,
  samplePlay: module.samplePlay,
});
```

Both automatic output paths use the same evaluator and three authored lists.
Priority is headcam, GOAL scoreboard, play/rolling-ball gantry, then
preroll/ambient direction. Explicit `/broadcast` cameras/tracks and deterministic
capture bypass this automatic director.

- **Idle is epoch-relative, not page-relative:** `(nowMs - idleEpochMs) / 1000`,
  with the default fixed Unix epoch `0`. Reloading does not restart the orbit.
- **Match phases use programme time:** the publisher map accounts for build-up,
  goal holds and play-end/restart boundaries. The precise `bug.programmeT` is
  preferred, with the map, occurrence identity and loop count from the owner.
  A late arrival joins the current phase/shot, not its first frame.
- Scheduled playback uses `startsAt` and the client wall clock. It does not
  subtract the programme feed's cached generation time. Shared direction is
  not clock synchronization: clock skew, different match/feed arrival and
  missing assets can still differ between clients. In particular a replay
  driven only by local `dt` is **not** made globally synchronous by using this
  evaluator; the owner must supply shared programme time and loop identity.
  Without a usable map, diagnostics disclose `match-clock-fallback` rather
  than pretending a frozen final match clock advances the outro.
- Verified loaded-track sampling reconstructs gantry lag over the preceding
  four programme seconds on a fixed 50 Hz grid (at most 202 samples). This is
  bounded history, not mathematically exact infinite filter memory. Missing
  verified history is explicitly `local-lag-fallback`, not pixel identity.
- Visitors now arm replay presentation on the **existing** match module.
  A headcam goal replay poses that same stage for television and the walking
  view; no private clone remains at a different time. The scorer's head and
  ball are sampled from loaded tracks; aim uses bounded ~0.72 s/60 Hz history
  rather than the last page frame. The viewer's own avatar/first-person-hidden
  parts are made visible for the television pass and restored afterwards.

These are shared programme/camera semantics, not a promise that independent
clients show identical whole-world pixels: visitors, asset/evidence arrival,
previous-frame screen feedback, clock skew and device rendering can differ.

### The 54-second table is a fixed slot

The slot is `[0.7, 54.7)` programme seconds after the publisher's full play-end,
mapped through earlier goal holds. A join at +50 s uses elapsed 49.3 and gets
only the remainder, never a fresh 54 seconds. At +54.7 s the slot has expired.
The ambient list's moving heli extends from its normal 45 s end to +54.7 s,
even without archive evidence; then `SCREEN_MAIN` starts at its beginning.
Network arrival therefore cannot choose the camera cut.

The existing post-match validator remains the evidence/snapshot authority.
The wrapper passes it the actual match and actual `nowMs`, adapting only its
local cue timer, and applies global elapsed/expiry outside it. No future score,
fictional timestamp or relaxed first-air eligibility is introduced. The old
local 25-second readiness window is superseded: valid late evidence can show
only the remaining slot. Missing/invalid evidence stays hidden. Football,
headcam/goal and other safety conditions still suppress the graphic.

An uninterrupted cue freezes its validated revision. A protected interruption
resets local cue state and may validate a newer snapshot when rejoining the
remaining slot. Two clients with different archive availability/revisions need
not have identical graphics. The archive's freshness and first-air limits in
[CAMERAS.md](CAMERAS.md#post-match-league-table--19-september-first-air-fix-21-september-2026)
still apply; none are replaced with an unbounded late-join promise.

### Occasional standings between matches

The shared director also reserves a **current-standings segment on every other
idle cut-list lap**. It uses the same 54-second reading hold, with a 0.7-second
lead-in. The opening moving helicopter shot is extended from 45 to 54.7 seconds
on that lap; all the other authored screen, stand, pitchside and gantry shots
remain, and the next lap is unobstructed. With the current 136-second list,
that is **54 seconds per 281.7 seconds (19.2% of eligible idle airtime)**.
No per-frame randomness or page-arrival timer is involved. Period boundaries
use integer wall-clock milliseconds against the same Unix epoch as idle
camera direction, so the broadcast and stadium television join the same slot.

Only an `idle`/`countdown` match module with no live programme is eligible.
Loading, build-up, play, replays and half-time cannot use this graphic. A slot
is skipped if its complete segment plus a **60-second clear lead-in** does not
fit before the next programme's `startsAt` (stream start, not kickoff).
Malformed or overdue next-start metadata also suppresses it. Starting match
coverage removes the idle table immediately. Explicit cameras/tracks and
fixed-step capture still bypass automatic cueing. Missing archive evidence
leaves the reserved aerial unobscured; it does not choose a different cut.

`buildIdleTable` uses the same complete RFL archive, reconciliation, identity,
chronology and ranking rules, never a fabricated match/HUD score. The archive
must be at most six hours old, with at most 60 seconds of publication clock
skew; every included aired result must precede both publication and wall time.
It prefers the current season, falling back to a correctly labelled earlier
season only when the newer season validates and has no aired results. A bad
current ledger is not an excuse to fall back. Future seasons, scheduled and
skipped results do not contribute. With no confirmed standings it hides.

Idle, pre-match and post-match share one bounded archive request/cache (at most one
request per minute, ten-second abort, disposed with the output). Each displayed
idle segment freezes its validated snapshot; late evidence or a late join gets
only the remaining slot. Different archive revisions/network arrival can still
produce different tables on independent clients, as for post-match graphics.
The idle graphic says **CURRENT STANDINGS / BETWEEN GAMES**, shows static
positions plus the published leader and season totals, and contains no FT score,
match highlights, movement arrows or before/after-match animation. Post-match
cueing and its 54-second result animation are unchanged.

Tests: `npm run league:check`, `npm run stadium-screen:check`, and
`node scripts/league-idle-browser.mjs` (browser-local fixture/time overrides,
actual broadcast and visitor render paths; never changes public feeds).

### Pre-match standings windows

**23 September source addition; no live/deployed status is implied.** The same
shared automatic evaluator reserves two aerial reads during fixture build-up,
measured from pre-roll start, not from page arrival:

- Aerial starts **22 s**, graphic **[22.7, 46.7) s**.
- Aerial starts **112 s**, graphic **[112.7, 136.7) s**.

Each is the ambient list's first moving helicopter segment (same seed and
parameters), with 0.7 seconds to settle before a **24-second** graphic. The
other authored pre-roll shots remain between/after these reservations. Camera
windows are fixed even if evidence is unavailable; there is no frozen aerial,
network-triggered cut or additional render/match mount. With 180 seconds of
pre-roll the second read ends **43.3 seconds before kickoff**. A reservation
is skipped in full unless its end leaves **at least 30 seconds clear**; shorter
build-ups do not truncate/restart the graphic or push it toward kickoff.

Shared programme time and occurrence/slot identity make late joins and seeks
join the appropriate remaining window on `/broadcast` and stadium television.
Missing, non-finite or invalid times fail closed. Live play, replay/headcam,
goal and protected camera states suppress the graphic immediately; explicit
camera/track and fixed-step capture bypasses are unchanged. A late archive
response can use only the current slot's remainder, never extend it. As with
other graphics, different archive arrival/revisions can affect availability;
this is deterministic timing, not a whole-frame cross-client pixel promise.

The renderer accepts only `mode: preroll` with explicit validated provenance:

- **`published-pre-match`**: reconcile the whole published season, then rank
  only results preceding the exact aired fixture. Neither its own result nor
  any later result appears in its table, including during a historical build-up.
- **`scheduled-pre-match`**: use validated published rows before the exact
  scheduled fixture. The scheduled occurrence and strict first-pending/freshness
  boundary must validate; direct/unpublished replay sources do not qualify.

The evidence controller supplies season/label, rows, archive generation time,
source label and validated home/away identity (optional renderer match ID).
There is **no score field**. Static rows must have equal current/previous
positions, played, goal difference and points; invalid provenance or incomplete
rows hide rather than fall back to a post-match result. Future scores are never
projected from HUD, the programme's rolling results or a later archive row.
The existing bounded shared archive cache still permits at most one request
per minute, uses a ten-second abort and is disposed with the output. Each
uninterrupted cue freezes its validated snapshot; interruption/replacement/seek
can revalidate without restarting the shared slot.

The graphic reads **LEAGUE TABLE / BEFORE THE MATCH**, highlights the two
fixture clubs and shows their pre-match position/points in the side cards.
No FT, score, last-result strap, row movement or no-change arrows are painted.
It uses `PREROLL_TABLE_DURATION_S = 24` from `league-timing.mjs`, with the
original 0.55-second entrance and 0.6-second fade at 23.4–24 s; animations are
not stretched. Idle/post-match remain 54 seconds and preserve their appearance.
`node scripts/league-overlay-check.mjs --shots /tmp/preroll-standings` captures
entry/hold/fade/expiry and checks static rows/cards, labels/highlights, strict
invalid rejection, frame caching and exact restoration of the other modes.
This is a local renderer check, not evidence of a public broadcast or deployment.

`node scripts/league-preroll-browser.mjs` is the required software-browser gate:
21 paired visitor/broadcast samples of the real saved M42, including both cue
boundaries, fade/expiry, a fresh-document late join and kickoff. The browser-only
archive/clock overrides leave publisher bundle bytes untouched. It verifies
all pre-M42 rows/highlights, retained main-screen output, zero video/writes and
same-frame clean pixels outside the existing LIVE badge. `--gpu` is an optional
local run, not a substitute for the default gate. Evidence is written under
`qa-out/league-preroll/integration/`; no public feed is changed.

A supplied map that is malformed or lacks a usable programme clock cannot fall
back to the default 180-second table layout. That fallback is only for genuinely
unmapped legacy match-time playback; otherwise the pre-match cue fails closed.

## Pinned SDK adapter: prevent allocation, not just attachment

`public/js/venue-modules/broadcast-sdk.mjs` loads the same-origin prebuilt
`public/vendor/4dgsx/broadcast-factory.js`. It does **not** fetch, hash or
transform upstream JavaScript at runtime. The audited source is pinned by
SHA-256 in `scripts/fixtures/sdk-provenance.json`:

```
18525ca0abe3b920232b6c74ab76d55de0a4d25684a31477c421131ad5027e6f
```

Regeneration is build/test-only via `sdkFactorySource(reviewedSource)`, with a
separate expected factory digest. A different upstream build requires review;
a fixture override must be same-origin, prebuilt factory ESM.

Each mount has an isolated lexical fetch adapter, including mounts initiated
inside the scheduler. Requests are forwarded unchanged. Only `.json()` of
that mount's exactly declared UI document is filtered, including the SDK's
known CDN fallback path. It immutably removes media/video components whose
anchor is the reserved main dock, **before SDK video element, decoder, texture
or media fetch allocation**. Omitting a dock attachment alone would leave the
hidden decoder running and is not the implementation here. Adapter failure
does not silently fall back to unfiltered main video.

Other UI components, images, panels, audio and bundle payloads remain intact;
the caller's publisher document is not mutated. There is no global fetch
interception or broad filename filter. The added read-only metadata/body
sampler shares the already-loaded track ArrayBuffer using a separate Poser;
it does not copy the track, seek the live stage, or trigger stage events/audio.
Its lazy workspace and bounded small-pose cache are cleared on stage disposal.

**Licensing:** Robin Spottiswoode / 4DGSX attribution is retained. Vendoring a
pinned upstream source does **not** automatically make it MIT-licensed under
this repository's license. The provenance review found no upstream LICENSE in
repository root/site; the fixture records that uncertainty, not permission or
relicensing. Retain attribution/provenance and review licensing separately.

## Render order, colour and lifecycle

`public/js/broadcast-screen.js` builds a broadcast camera and small composer
around the existing renderer and scene. For each active visitor frame:

1. World/match updates happen once.
2. The existing canvas is GPU scratch for the television camera: the same
   city/bloom/output pass, after-tonemap match pass, scorebug and league overlay
   pipeline as the broadcast. A differently colour-managed offscreen scene
   render target is deliberately not substituted for this final canvas path.
3. `copyFramebufferToTexture` copies the finished frame on the GPU. Runtime
   does not read pixels to the CPU, encode PNG/video or transport a stream.
4. Renderer viewport/scissor/target/clear state and avatar visibility are
   restored. The **full normal visitor draw runs last**, overwriting scratch
   before the browser presents the canvas. No television viewport is presented
   as the walking view, and there is no second render loop.

The screen surface is an RGBA8/`NoColorSpace` `FramebufferTexture` with a raw
sampling shader, drawn among the after-tonemap roots. Those are already
encoded display pixels: do not ACES-tone-map or sRGB-encode/decode them again.
The raw shader also supplies the required vertical orientation. This avoids
both the double-tone-map washout and driver errors from copying into an sRGB
framebuffer texture. During the television pass it samples the previous copy;
there is no recursive same-frame render.

The feed uses a 16:9 backing buffer at most 1280×720, bounded by the actual
visitor drawing buffer; it never resizes the visible canvas for television.
`venues.renderBroadcasts()` runs only for a near Tier 2 venue with an active
module. Leaving Tier 2 suspends extra rendering; the existing image/resources
may remain through the venue grace period. Re-entry rejoins current programme
time. A changed buffer size recreates the output at the required size, and
venue unload disposes it before unloading the glTF. Texture/material, graphics,
composer passes and programme resources are released; late readiness cannot
resurrect a disposed output. Failures are diagnosed without intentionally
preventing the final visitor draw. Initial cut-list loading failures do not
retry automatically: resize or unload/re-entry recreates the output and retries.

Live `/broadcast` already renders the television view, so it copies that one
frame to main instead of adding a visitor-style second scene view. Its screen
uses the same raw surface. Deterministic capture retains its existing path.

## Cost and capture limits

A real local M42 sample on Apple M3 Pro / ANGLE Metal recorded approximately:

| view work | draw calls |
|---|---:|
| ordinary visitor view | 417 |
| additional internal television view | 408 |
| combined frame | **825** |

Source: `qa-out/stadium-screen/stadium-programme-browser.json`, `benchmark`.
The **480-call per-view budget is not a combined-frame budget**: both sample
views fit it separately; 825 does not fit it as a total. This output is not
free just because it reuses geometry and avoids a video decoder/download.
In 60 alternating paired whole-frame samples, median submission time was
4.30 ms with television versus 2.00 ms without; median paired overhead was
2.20 ms. Submission timings are not completed GPU timings or a sustained FPS test.
Measure the actual device, viewport, crowd and enabled recording workload;
there is no exact FPS or cross-device performance guarantee.

Existing `/broadcast` `frame()`/`pixels()` and visible-canvas output remain as
before, including LIVE when scheduled. `cleanOutput()` still opts into the
same live programme with only the top-right LIVE overlay omitted, not another
scene render, match seek or clock. The stadium copy remains the original
LIVE-bearing feed; a tiny LIVE inside a filmed screen can remain. The clean
output is lazy, page-owned, video-only, not zero-copy, and unavailable in
`?capture=1`/`?live=0`. All stop/readiness/stream and premix integration rules in
[CAMERAS.md](CAMERAS.md#clean-recording-output--same-live-programme-without-the-live-badge)
remain in force. Explicit cameras/tracks, fixed-step capture and capture audio
silence are not changed by the automatic visitor-screen path.

## Evidence and verification status

Implementation references: `broadcast-screen.js`, `broadcast-programme.js`,
`venue-modules/broadcast-sdk.mjs`, `venue-modules/match-4dgsx.js`, `venues.js`,
and the three host pages. The local API note is
`qa-out/stadium-screen/programme-api.md`; SDK provenance is the checked-in
`scripts/fixtures/sdk-provenance.json`.

Relevant gates/rehearsals are `scripts/broadcast-programme-check.mjs`,
`scripts/broadcast-sdk-check.mjs`, `scripts/stadium-screen-check.mjs`,
`scripts/stadium-programme-browser.mjs`, and existing broadcast/clean-output/
league checks. Local artifacts under `qa-out/stadium-screen/` include pixel,
DPR, lifecycle, programme and real-bundle observations. They are snapshots of
individual runs and can be superseded during integration; inspect their scope,
failures and timestamps rather than inferring that all tests passed or that
production has this code.

Final local integration evidence for this build:

- 291 unit tests, including 18 shared-programme regressions.
- Stadium pixel/lifecycle smoke: 287/287; SDK direct, scheduled and concurrent
  mount isolation, reserved-video filtering and pure loaded-track sampling pass.
- Clean recording: 10 byte-exact cases and 3 native video frames; ambient
  broadcast: 39/39; mounted venue: 54/54 plus the index lifecycle.
- Actual saved M42: ten paired visitor/broadcast phases on GPU and software,
  with no video allocations, MP4 requests or console errors.
- Final first-air M42: seven samples, five exact clean-output comparisons,
  54-second table hold and reset pass.

The M42 rehearsals override feeds/time only inside their own QA browser; they
do not alter the public schedule or establish what an external encoder aired.
See exact-head CI for the full latest-match broadcast and remaining legacy gates.
