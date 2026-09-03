// World layout — the one place that knows where the city is walkable and
// where its large structures stand. Reads the map (city/map.json), the plat
// (city/lots.json) and the venue index; everything else (player bounds, road
// renderer, lot furniture, venue streamer, spawn routes, fog presets) asks
// this module rather than carrying its own numbers. The geometry itself —
// fence shapes, lot frames, lamp positions — lives in js/city-map.mjs so
// node's checks and the browser cannot disagree. See docs/map/ARCHITECTURE.md.
import * as THREE from 'three';
import { fenceShapes, fenceContains, fenceReach, standingPoint, lotToWorld } from '/js/city-map.mjs';

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

// `street` is accepted for callers that still pass it (the venue fixture);
// the fence no longer depends on it — the map is the layout, the manifest
// only says which lots are taken.
export async function loadWorld({ base = '' } = {}) {
  const [map, plat, venueIndex] = await Promise.all([
    fetchJson(`${base}/city/map.json`).catch((e) => { console.warn('otra.city: no map —', e.message); return null; }),
    fetchJson(`${base}/city/lots.json`).catch(() => null),
    fetchJson(`${base}/venues/index.json`).catch(() => ({ venues: [] })),
  ]);
  const venues = venueIndex.venues || [];

  // Walkable ground is a union of simple shapes; the player rejects any axis
  // move that would leave it. Geometry inside a venue is handled by the
  // venue's own colliders — this is only the outer fence. Without a map the
  // city keeps the street it launched with, so a broken fetch is a dark road
  // rather than a visitor who cannot move.
  const shapes = map
    ? fenceShapes(map, plat, venues)
    : [{ kind: 'box', id: 'fallback', min: [-40, -40], max: [40, 40] }];
  const contains = (x, z) => fenceContains(shapes, x, z);
  const reach = fenceReach(shapes);

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

  const lots = plat?.lots || {};
  const spawn = map?.spawn || { x: -20, z: 0, yaw: Math.PI / 2 };
  return {
    map, plat, lots, venues, shapes, presets, reach, spawn, contains, toWorld, venueForPath,
    lotById: (id) => lots[id] || null,
    standingPoint, lotToWorld, distanceToBox, insideBox, THREE,
  };
}
