// Where a plot's poster lives, and what makes one stale.
//
// Shared by the renderer (which writes them) and the manifest builder (which
// publishes them), so neither can invent a path the other doesn't recognise.
//
// Posters live OUTSIDE the plot folder on purpose. Every submission path —
// fork+PR and /api/plots/submit alike — writes only plot.json, plot.glb and
// media/*, so a directory the submission pipeline never writes to is a
// directory a submitter cannot put an image in. The poster is ours.
export const POSTER_DIR = 'posters';

// Bump when the render changes (framing, size, pipeline) to reshoot every
// plot. It is hashed into the filename, so a bump invalidates the lot.
export const POSTER_HASH_VERSION = 'poster-v1';

export const posterName = (slug, hash) => `${slug}-${hash}.webp`;
export const posterUrl = (file) => `/${POSTER_DIR}/${file}`;

// Anything in the poster directory wearing this shape is pipeline output and
// nothing else; the renderer prunes every file that matches but isn't current.
export const posterPattern = /^[a-z0-9][a-z0-9-]*-[0-9a-f]{12}\.webp$/;

// The current poster for a slug among a directory listing, or null.
export function findPoster(slug, names) {
  const prefix = `${slug}-`;
  const hits = names
    .filter((n) => n.startsWith(prefix) && posterPattern.test(n) &&
      n.slice(prefix.length).length === 17)          // <12 hex>.webp — not a longer slug
    .sort();
  return hits.length ? hits[hits.length - 1] : null;
}
