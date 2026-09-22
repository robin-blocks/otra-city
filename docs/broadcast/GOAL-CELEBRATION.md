# RFL goal celebration compatibility — staged release, 22 September 2026

RFL's approved goal effect inserts a 1.6-second physical celebration before
the replay. This host patch is backward compatible and does not enable the
effect or change the schedule. **Robin approved a host-only merge separately
from station activation (22 September, 18:10 BST), once host checks pass.**
The modest 502-vs-480 drawing-budget overage is accepted as follow-up, not a
release veto. Station activation still requires the timing fix. The historical
acceptance findings below are retained; they do not describe a host-only
compatibility deployment as unsafe.

## Contract

- Goal `t` is the presentation scoring instant. The HUD score updates here.
- `celebration_s` is inserted presentation time, not playing-clock time.
- `replay_t` is the later programme-map hold. `source_t` is the original
  physical scoring time. Replay source seconds are mapped through preceding
  celebration inserts, never replaying the insert instead of the shot.
- Source clock metadata `duration_s` is still the amount of football played.
  Pause intervals are unioned within each period, clipped to its restart.
  A celebration after a buzzer does not subtract the interval twice.
- `scene.meta.goal_celebration` opts its Poser into translation jump holds
  (>2 m/sample). Hidden effects and kickoff teleports must not interpolate
  through the floor/pitch. Both live posing and pure sampling use the same
  rule; legacy interpolation is unchanged. New tracks reach the exact last
  sample rather than stopping at nframes-1.001.
- RFL makes the flash opaque so the host's glass-panel filter leaves it alone.
- Automatic priority is headcam → celebration → scoreboard. During a
  celebration the existing gantry aims at the scoring end (RFL A/0 attacks
  +x, B/1 attacks −x); missing end metadata keeps the full-pitch wide. Do not
  follow the parked ball. This also overrides interval/postmatch direction
  and suppresses the table until the celebration has ended.
- Candidate broadcast build is `2026-09-22b`. Changing the document lets the
  existing ETag updater detect these imported-module changes; existing live
  programme and 15-minute pre-start reload guards remain untouched.

## Verification

39 director/goal-clock/replay Node tests pass, including both ends, multiple
goals, buzzer goals, wrong-end players, projection calibration, reverse seek,
fresh arrival and legacy behavior. The pinned-SDK browser check passes with
byte-exact regeneration from the audited upstream source, including native
stage / pure sampler agreement, FX teleport forward/backward/final endpoint,
scheduled mount/disposal and unchanged audio/panel requests.

The exact audited upstream source SHA remains in sdk-provenance.json. There
is no runtime source rewriting, upstream repo edit or licensing change.

## Final acceptance findings

**Automatic director bug fixed:** the original candidate cut to the scoreboard
for the entire explosion. An isolated hardware screenshot confirmed it. The
new celebration priority shows the ring, confetti and reacting robot on pitch,
then hands over to the scorer replay. This was checked in the actual /broadcast
renderer, not just the director's camera name. Existing public schedules and
the production browser were not modified.

**Representative draw budget FAIL:** a scratch-only bundle combines the known
synthetic celebration track with actual Gemini/Sol club geometry. Source
recording/bundle bytes are unchanged; this is NOT league footage or a result.
On the Iris Plus 655, automatic mode used a maximum **429 calls without the
73 effect draws, 502 with them**, beyond the existing 480 per-view ceiling.
Both original-director arms ran ~19.83fps with another production browser
competing. The corrected pitch-shot arm delivered 108 draw advances/~6s
(~17.85fps), still 502 calls. These are concurrent-load measurements, NOT
attribution of production slowdown to FX, and NOT 50fps acceptance. The pinned
SDK sets meshes frustumCulled=false, so parking effects does not remove their
draw submissions. Do not quietly raise the budget to pass this release.

**RFL realtime neutrality FAIL:** a calibrated fake-clock run of the actual
MuJoCo match loop found that added celebration wall work can move the 10s
asynchronous decision watchdog. A replacement request and its next request
then occur earlier in simulation time, despite honest-latency delivery.
Pre-goal poses were identical; subsequent playing poses diverged. This is a
controlled possible timing schedule, not evidence that a shipped result was
changed. Physical clone isolation alone is insufficient. Keep generation and
publication guarded until presentation work is isolated from club timing.

**Offline full-programme A/V PASS, bounded:** actual four-goal MuJoCo video,
real mixer/commentary placement/AAC and 180s pre/post concatenation were checked,
including consecutive and both buzzer goals. Cheer onset was 30–50ms after
actual video PTS, consistent with intentional +50ms plus 25fps quantization;
a deliberate 400ms encoded delay measured 400ms. No accumulating celebration
drift. Premix/stem priming differs by ~23ms, mostly cancelled by video PTS for
the dock video. This does NOT verify delivered host 3D picture plus Pulse/Twitch
premix; that gate remains open.

## Release posture

Host compatibility may merge once host checks pass, independently of station
activation. The first venues CI attempt timed out awaiting a real-bundle
remount after all preceding assertions passed; rerun it, do not bypass it.
RFL has moved expensive celebration simulation/render/encoding after sporting
play using saved integration state. Its calibrated timeout counterexample now
passes exact on/off state/action/scheduling parity. Video inserts preserve
original frame positions before replay. This change is not league activation.

RFL publisher remains fail-closed and match generation default-off. Drawing
cost is accepted follow-up work; verify deployed host adoption and the final
picture/premix path before a separate announced activation.
No force reload during a scheduled programme or its pre-start hold; no changes
to existing results. RFL retains detailed reproducible evidence privately under
`work/evidence/2026-09-22-goal-acceptance/`.
