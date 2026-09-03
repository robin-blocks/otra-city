// What the city is allowed to cost, as measured by scripts/qa-walkthrough.mjs.
//
// Draw calls and triangles grow as lots are claimed, so a budget here is a
// LINE, not a number: a base plus what one more plot may add. A fixed ceiling
// would either start failing honest plot PRs or mean nothing a year from now.
//
// Each pose carries its own budget, because a draw call is a fact about where
// the camera stands: the boulevard view sees most of the city, a shopfront
// view sees one plot. Sharing one number between them would leave the tighter
// view toothless.
//
// Raising these is a deliberate commit with a reason in the message, never a
// reaction to a red build — going red before a visitor notices is the whole
// point. The per-plot caps in lib/validate-plot.mjs (50k triangles, 4
// materials, 3 lights) are what keep the slope honest.
//
// Measured on the ten-lot city: boulevard 284 calls / 86,316 triangles,
// shopfront 65 / 6,970. The boulevard base carries the world beyond the
// street — the venues added in #30 cost about 80 draw calls and are a fixed
// cost, not a per-lot one, so they moved the base rather than the slope.
//
// The measurement carries about one draw call and a dozen triangles of jitter:
// the animated props (a vacant lot's marker spins and bobs) cross the frustum
// edge at slightly different phases from run to run, and a box is 12 triangles.
// These are budgets with headroom, not exact expectations — a real regression
// is tens of calls, not one.
export const BUDGETS = {
  poses: {
    'boulevard, looking down the street': {
      x: -20, z: 0, yaw: Math.PI / 2, dist: 6, height: 2.4,
      calls: { base: 110, perLot: 26 },
      // Triangles carry a per-VACANT-lot term since the map (2026-09-03): a
      // vacant lot is a pad, four strips, four posts, a marker and a board —
      // about 160 triangles, instanced and therefore drawn from every pose —
      // and the district's instanced road furniture (~3,500) moved the base.
      // Measured 95,196 here at 10 claimed + 24 vacant (86,316 before).
      tris: { base: 12000, perLot: 10000, perVacant: 160 },
    },
    'standing at a shopfront': {
      x: 0, z: -5.5, yaw: Math.PI, dist: 4.5, height: 1.8,
      // Looser on purpose: this pose exists to catch the whole city being
      // drawn while you stand in one shop, not to police one plot's content.
      // Base raised 30 -> 46 with the map (2026-09-03): road furniture is
      // instanced, one draw call per KIND of thing city-wide, and an
      // InstancedMesh is not frustum-culled piece by piece — so ~16 calls of
      // dashes, lamps, plates and kerbs now draw from every pose. Measured
      // 81 here at 10 lots (65 before), against 233 at the boulevard pose
      // (284 before): the district made the wide view cheaper, not dearer.
      calls: { base: 46, perLot: 6 },
      // Same per-vacant-lot term: measured 14,036 at 10 + 24 (6,970 before),
      // of which ~3,800 is the vacant lots and ~3,300 the instanced furniture.
      tris: { base: 9500, perLot: 1000, perVacant: 160 },
    },
  },
  // A ceiling AND a floor. Content silently failing to load is also a bug, and
  // it shows up as the city getting suspiciously cheap.
  lights: { base: 8, perLot: 3, floor: 5 },
  // Every vacant lot's furniture is instanced and its boards share an atlas
  // (js/street.js), so the whole set costs a fixed handful of draw calls
  // whatever the count. Seven instanced kinds plus one board mesh per 64 lots.
  vacantCalls: 12,
};

export const limit = (b, lots, vacant = 0) => Math.round(b.base + b.perLot * lots + (b.perVacant || 0) * vacant);
