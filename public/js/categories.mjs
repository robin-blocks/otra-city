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

// What a category that is NOT one of the ids most likely meant. Agents write
// the category they would write for any directory — "AI Music", "Video",
// "Image Generation", "tools" — and a rejection for that was the one place an
// honest submitter with a working backlink gave up and never came back
// (musci.io sent "AI Music" twice, Oct 2026). So the intake maps a near miss
// instead of refusing it, and says so in the report; the published plot.json
// only ever holds a real id, and the validator stays strict about that.
//
// The order is the priority: the most specific medium wins, so "text to video"
// is video and "text to speech" is voice. A word nothing here claims lands on
// `other` — a vague "tools" or "education" is not a guess worth making for
// someone, and the report tells them how to choose.
const CATEGORY_WORDS = [
  ['voice-cloning', ['voice', 'speech', 'tts', 'dubbing', 'clone', 'cloning']],
  ['video-generation', ['video', 'animation', 'film', 'movie', 'clip']],
  ['audio-generation', ['audio', 'music', 'song', 'sound', 'podcast']],
  ['image-generation', ['image', 'photo', 'picture', 'art', 'illustration', 'avatar', 'graphic']],
  ['code-assist', ['code', 'coding', 'developer', 'programming', 'devtool', 'dev']],
  ['prompt-tools', ['prompt']],
  ['agents', ['agent', 'agentic', 'automation', 'workflow']],
  ['chatbots', ['chatbot', 'chat', 'assistant', 'companion']],
  ['data-analysis', ['data', 'analytics', 'analysis', 'spreadsheet', 'dashboard']],
  ['text-generation', ['text', 'writing', 'writer', 'copywriting', 'content', 'essay']],
  ['productivity', ['productivity', 'notes', 'calendar', 'email', 'task', 'scheduling', 'meeting']],
];

const words = (s) => s.toLowerCase().replace(/&/g, ' and ').split(/[^a-z0-9]+/).filter(Boolean)
  // a plural is the same word: "agents", "videos", "images"
  .map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w));

/** A submitted category, as a real id. `null` for a value that is not text at
 *  all (the validator reports that); otherwise `{ id, exact }`, where `exact`
 *  is false when the city had to map it. An array of strings — some agents
 *  send their directory's multi-select — is read as one phrase. */
export function resolveCategory(raw) {
  const text = Array.isArray(raw) && raw.every((r) => typeof r === 'string') ? raw.join(' ') : raw;
  if (typeof text !== 'string') return null;
  if (CATEGORY_IDS.includes(text)) return { id: text, exact: true };
  const w = words(text);
  const slug = w.join('-');
  const byName = CATEGORIES.find((c) => words(c.id).join('-') === slug || words(c.label).join('-') === slug);
  if (byName) return { id: byName.id, exact: false };
  for (const [id, keys] of CATEGORY_WORDS) if (w.some((x) => keys.includes(x))) return { id, exact: false };
  return { id: DEFAULT_CATEGORY, exact: false };
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
