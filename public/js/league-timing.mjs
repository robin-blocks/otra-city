// Shared by the cue controller and the renderer: extend the reading hold,
// never slow down the entrance, row movement or final fade.
export const TABLE_DURATION_S = 54;
// Two short pre-match reads; idle and post-match retain the full 54 seconds.
export const PREROLL_TABLE_DURATION_S = 24;
export const TABLE_FADE_S = 0.6;
export const TABLE_FADE_START_S = TABLE_DURATION_S - TABLE_FADE_S;
