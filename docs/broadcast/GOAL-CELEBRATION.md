# RFL goal celebration compatibility — release candidate, 22 September 2026

RFL's approved goal effect inserts a 1.6-second physical celebration before
the replay. The original gameplay recording is unchanged. This host patch is
backward compatible and does not enable the effect or change the schedule.

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

## Verification

16 Node tests pass (goal-celebration-check + match-clock-check), including
legacy, multiple goals, own source mapping, both buzzer kinds, overlapping
pauses, malformed optional data, seek, and decimal-rounded replay boundary.
The SDK browser check passes, including native stage / pure sampler agreement,
FX teleport forward/backward and final endpoint, scheduled mount/disposal,
legacy interpolation and original panel/audio requests.

The exact audited upstream source SHA remains in sdk-provenance.json. The
factory was regenerated with sdkFactorySource and reproduced byte-for-byte;
there is no runtime source rewriting and no upstream repo edit.

## Not yet release acceptance

An isolated second Chrome on the real streaming GPU displayed the exported
synthetic goal in /broadcast, with the clock held and replay delayed. Its
six-second test counted 121 actual draw serial advances (~20.17 fps), both
with and without FX. Calls increased 401 → 474. The existing production
browser/encoder remained running throughout: this is a concurrent-load
measurement, NOT evidence that the effect alone causes 20 fps, and NOT a
50-fps production acceptance. The visitor /venue path costs multiple passes
and also needs a budget decision; its full-scene count is not interchangeable
with the broadcast count.

Remaining: representative real-club geometry/draw headroom, target broadcast
cadence under representative load, complete premix/picture sync, automatic
director goal shot, and deployed-byte adoption. No force reload mid-programme.
The RFL publisher remains fail-closed and match generation default-off.

Per docs/stadium/PROJECT.md, Robin owns the merge to main. This branch is a
review handoff, not permission to auto-merge or deploy an unverified release.
