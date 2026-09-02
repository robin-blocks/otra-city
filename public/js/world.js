// World layout — the one place that knows where the city is walkable and
// where its large structures stand. Reads the road graph and the venue
// index; everything else (player bounds, road renderer, venue streamer,
// spawn routes, fog presets) asks this module rather than carrying its own
// numbers. Imports nothing but three. See docs/venues/ARCHITECTURE.md.
import * as THREE from 'three';

// The boulevard's extent is the STREET's: street.js derives it from the land
// registry (which hands out lots from an endless ring), so anything here that
// re-derived it would be a second opinion waiting to disagree. This is only
// the fallback for a caller with no street — the fixture with ?street=0.
export const BOULEVARD_FALLBACK = { x: 40, z: 40 };

const fetchJson = async (url) => {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
};

export function distanceToBox(b, x, z) {
  const dx = Math.max(b.min[0] - x, 0, x - b.max[0]);
  const dz = Math.max(b.min[1] - z, 0, z - b.max[1]);
  return Math.hypot(dx, dz);
}
export function insideBox(b, x, z, margin = 0) {
  return x >= b.min[0] - margin && x <= b.max[0] + margin &&
         z >= b.min[1] - margin && z <= b.max[1] + margin;
}

export async function loadWorld({ street = null, base = '' } = {}) {
  const [roads, venueIndex] = await Promise.all([
    fetchJson(`${base}/city/roads.json`).catch(() => null),
    fetchJson(`${base}/venues/index.json`).catch(() => ({ venues: [] })),
  ]);
  const venues = venueIndex.venues || [];

  // Walkable ground is a union of simple shapes; the player rejects any
  // axis move that would leave it. Geometry inside a venue is handled by the
  // venue's own colliders — this is only the outer fence.
  const shapes = [];
  const b = street?.bounds || BOULEVARD_FALLBACK;
  shapes.push({ kind: 'box', id: 'boulevard', min: [-b.x, -b.z], max: [b.x, b.z] });
  if (roads) {
    const nodes = roads.nodes || {};
    for (const s of roads.segments || []) {
      const a = nodes[s.from];
      const b = nodes[s.to];
      if (!a || !b) continue;
      shapes.push({ kind: 'obb', id: s.id, a, b, half: (s.width ?? 8) / 2 + (s.pavement ?? 2.5) + 0.5 });
    }
    for (const r of roads.roundabouts || []) {
      const c = nodes[r.at];
      if (c) shapes.push({ kind: 'disc', id: r.id, c, r: r.outer_r + (r.pavement ?? 2.5) + 0.5 });
    }
    for (const a of [...(roads.aprons || []), ...(roads.bays || [])]) {
      shapes.push({ kind: 'box', id: a.id, min: [a.min[0] - 0.5, a.min[1] - 0.5], max: [a.max[0] + 0.5, a.max[1] + 0.5] });
    }
  }
  for (const v of venues) shapes.push({ kind: 'box', id: `venue:${v.id}`, min: v.bounds.min, max: v.bounds.max });

  function contains(x, z) {
    for (const s of shapes) {
      if (s.kind === 'box') {
        if (x >= s.min[0] && x <= s.max[0] && z >= s.min[1] && z <= s.max[1]) return true;
      } else if (s.kind === 'disc') {
        if (Math.hypot(x - s.c[0], z - s.c[1]) <= s.r) return true;
      } else if (s.kind === 'obb') {
        const dx = s.b[0] - s.a[0];
        const dz = s.b[1] - s.a[1];
        const L = Math.hypot(dx, dz) || 1;
        const ux = dx / L;
        const uz = dz / L;
        const px = x - s.a[0];
        const pz = z - s.a[1];
        const t = px * ux + pz * uz;
        const n = -px * uz + pz * ux;
        if (t >= -0.5 && t <= L + 0.5 && Math.abs(n) <= s.half) return true;
      }
    }
    return false;
  }

  // How far the world reaches from the spawn, over every shape: the ground
  // plane and the far plane are sized from this, so neither the street's own
  // growth nor a venue beyond its end can run off the edge of the world.
  const reach = shapes.reduce((m, s) => Math.max(m,
    s.kind === 'disc' ? Math.hypot(s.c[0], s.c[1]) + s.r
      : s.kind === 'obb' ? Math.max(Math.hypot(...s.a), Math.hypot(...s.b)) + s.half
        : Math.max(Math.abs(s.min[0]), Math.abs(s.max[0]), Math.abs(s.min[1]), Math.abs(s.max[1]))), 0);

  // Venues stand beyond the boulevard's fog line, so a city that has one sees
  // further; a city without keeps its original tighter atmosphere.
  const presets = venues.length
    ? { fog: [40, 190], cameraFar: Math.max(260, reach * 2 + 40) }
    : { fog: [32, 95], cameraFar: Math.max(220, reach * 2 + 40) };

  // venue-local -> world, the same rotation the venue root applies
  function toWorld(v, local) {
    const yaw = v.placement.yaw || 0;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    return {
      x: v.placement.x + local.x * c + local.z * s,
      z: v.placement.z - local.x * s + local.z * c,
      yaw: (local.yaw || 0) + yaw,
    };
  }

  function venueForPath(pathname) {
    const p = (pathname || '').replace(/\/$/, '');
    return venues.find((v) => v.route === p || `/v/${v.id}` === p) || null;
  }

  return { roads, venues, shapes, presets, reach, contains, toWorld, venueForPath, distanceToBox, insideBox, THREE };
}
