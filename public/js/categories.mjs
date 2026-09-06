// The directory's categories — one per listing, and the axis the city is laid
// out on: every road that takes listings serves one or more categories, so a
// listing lands beside its kind (public/city/map.json `categories` on a road,
// `rankForCategory` in city-map.mjs).
//
// The enum is PromptFrenzy's AI-directory enum, verbatim, so a payload an agent
// already knows how to write for that directory is a valid payload here; the
// two directories share a market, and a second taxonomy would only cost the
// agent a translation step. Add a category here and give it a road in the map
// in the same commit — an unrouted category falls through to `other`.
//
// Shared by node (validator, allocator) and the browser (the plan, the boards).
export const CATEGORIES = [
  { id: 'image-generation', label: 'Image generation', hue: 320 },
  { id: 'video-generation', label: 'Video generation', hue: 20 },
  { id: 'text-generation', label: 'Text generation', hue: 195 },
  { id: 'audio-generation', label: 'Audio & music', hue: 140 },
  { id: 'prompt-tools', label: 'Prompt tools', hue: 50 },
  { id: 'agents', label: 'Agents', hue: 265 },
  { id: 'chatbots', label: 'Chatbots', hue: 215 },
  { id: 'code-assist', label: 'Code assist', hue: 165 },
  { id: 'productivity', label: 'Productivity', hue: 35 },
  { id: 'data-analysis', label: 'Data analysis', hue: 180 },
  { id: 'voice-cloning', label: 'Voice', hue: 340 },
  { id: 'other', label: 'Other', hue: 230 },
];

export const CATEGORY_IDS = CATEGORIES.map((c) => c.id);
export const DEFAULT_CATEGORY = 'other';

export function isCategory(id) {
  return CATEGORY_IDS.includes(id);
}

export function categoryOf(id) {
  return CATEGORIES.find((c) => c.id === id) || null;
}

// HSL -> #rrggbb, so the same hue reads the same on a board, a plan and a
// facade without a colour library on either side.
export function hsl(h, s, l) {
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  const hex = (v) => Math.round(v * 255).toString(16).padStart(2, '0');
  return `#${hex(f(0))}${hex(f(8))}${hex(f(4))}`;
}

// The category's signature colour: neon on the facade, the fill on the plan.
export function categoryColor(id) {
  const c = categoryOf(id) || categoryOf(DEFAULT_CATEGORY);
  return hsl(c.hue, 0.95, 0.6);
}
