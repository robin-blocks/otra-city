// A small JSON-Schema (draft-07 subset) checker for venue manifests: type,
// required, properties, additionalProperties, items, minItems/maxItems,
// minimum/maximum, maxLength, pattern, enum, $ref into #/definitions. No
// dependency, so the CI check and the submit-time tooling can both use it.
import { readFileSync } from 'node:fs';

const here = new URL('..', import.meta.url).pathname;
export const VENUE_SCHEMA = JSON.parse(readFileSync(`${here}docs/venues/venue-schema.json`, 'utf8'));

const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);

export function validateSchema(value, schema, { root = schema, path = '$', errors = [] } = {}) {
  if (schema.$ref) {
    const ref = schema.$ref.replace(/^#\//, '').split('/');
    let s = root;
    for (const k of ref) s = s?.[k];
    if (!s) { errors.push(`${path}: unresolvable $ref ${schema.$ref}`); return errors; }
    return validateSchema(value, s, { root, path, errors });
  }
  if (schema.type) {
    const types = [].concat(schema.type);
    const t = typeOf(value);
    const ok = types.some((x) => (x === 'integer' ? Number.isInteger(value) : x === t));
    if (!ok) { errors.push(`${path}: expected ${types.join('|')}, got ${t}`); return errors; }
  }
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path}: must be one of ${schema.enum.join(', ')}`);
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: ${value} < minimum ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path}: ${value} > maximum ${schema.maximum}`);
  }
  if (typeof value === 'string') {
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${path}: longer than ${schema.maxLength}`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${path}: does not match ${schema.pattern}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${path}: fewer than ${schema.minItems} items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${path}: more than ${schema.maxItems} items`);
    if (schema.items) value.forEach((v, i) => validateSchema(v, schema.items, { root, path: `${path}[${i}]`, errors }));
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const k of schema.required || []) if (!(k in value)) errors.push(`${path}: missing required "${k}"`);
    for (const [k, v] of Object.entries(value)) {
      const sub = schema.properties?.[k];
      if (sub) validateSchema(v, sub, { root, path: `${path}.${k}`, errors });
      else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        validateSchema(v, schema.additionalProperties, { root, path: `${path}.${k}`, errors });
      } else if (schema.additionalProperties === false) errors.push(`${path}: unexpected "${k}"`);
    }
  }
  return errors;
}

export function validateVenue(def) {
  const errors = validateSchema(def, VENUE_SCHEMA);
  // cross-field rules the schema language cannot say
  if (def.footprint && (def.footprint.min[0] >= def.footprint.max[0] || def.footprint.min[1] >= def.footprint.max[1])) {
    errors.push('$.footprint: min must be below max on both axes');
  }
  if (def.audio_zone && def.footprint) {
    const a = def.audio_zone; const f = def.footprint;
    if (a.min[0] < f.min[0] || a.min[1] < f.min[1] || a.max[0] > f.max[0] || a.max[1] > f.max[1]) {
      errors.push('$.audio_zone: must lie inside the footprint');
    }
  }
  for (const [name, cam] of Object.entries(def.cameras || {})) {
    if (!/^[a-z][a-z0-9_]*$/.test(name)) errors.push(`$.cameras.${name}: camera names are lowercase identifiers`);
    if (cam[0][1] < 0.2) errors.push(`$.cameras.${name}: eye height below 0.2 m`);
  }
  return errors;
}

// World-space bounds of a venue's footprint: the AABB of its rotated corners.
export function venueBounds(def) {
  const yaw = def.placement.yaw || 0;
  const c = Math.cos(yaw); const s = Math.sin(yaw);
  const f = def.footprint;
  const pts = [[f.min[0], f.min[1]], [f.max[0], f.min[1]], [f.min[0], f.max[1]], [f.max[0], f.max[1]]]
    .map(([x, z]) => [def.placement.x + x * c + z * s, def.placement.z - x * s + z * c]);
  const r = (v) => Math.round(v * 1000) / 1000;
  return {
    min: [r(Math.min(...pts.map((p) => p[0]))), r(Math.min(...pts.map((p) => p[1])))],
    max: [r(Math.max(...pts.map((p) => p[0]))), r(Math.max(...pts.map((p) => p[1])))],
  };
}
