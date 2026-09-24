// The badge a listing puts on its own site.
//
// Every submission already has to carry `otra.city/s/<slug>` on the page at
// its url — that is the ownership proof (api/submit.mjs checkBacklink). Plain
// text passes, so most proofs were bare text that nothing gave a reason to
// keep. The badge is the same proof in a form worth leaving up: one paste that
// satisfies the check AND shows the listing's own address, so it reads as
// "where we are", not "featured on".
//
// Nothing a submitter wrote goes into the image or the snippets. The address
// is the city's word (the manifest), the slug is [a-z0-9-] by the time it gets
// here, and the alt text is built from the slug alone — so a hostile name can
// never become markup in somebody's README.
export const ORIGIN = 'https://otra.city';
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

// Removing the badge after listing has no consequence. It is read once, as
// proof, exactly like the plain-text permalink it replaces.
export function badgeSnippets(slug) {
  const img = `${ORIGIN}/badge/${slug}.svg`;
  const link = `${ORIGIN}/s/${slug}`;
  const alt = `${slug} on otra.city`;
  return {
    svg: img,
    permalink: link,
    markdown: `[![${alt}](${img})](${link})`,
    html: `<a href="${link}"><img src="${img}" alt="${alt}" height="28"></a>`,
    note: 'Paste either snippet on the page at your url: it is the permalink the ownership check looks for, ' +
      'and once you are live the badge shows your address. Plain text still passes; taking it down later changes nothing.',
  };
}

const xml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

// Monospace at 11px is ~0.6em a glyph; textLength pins the run to exactly the
// width computed here, so the badge never clips whichever mono font the
// viewer's machine substitutes.
const GLYPH = 6.6;
const H = 28;

/** `address` null → the generic badge (unknown slug, or not live yet). */
export function renderBadge(address) {
  const right = address ? String(address).slice(0, 40) : 'AI directory';
  const label = 'otra.city';
  const lw = Math.round(label.length * GLYPH);
  const rw = Math.round(right.length * GLYPH);
  const leftW = 8 + 14 + 6 + lw + 9;
  const W = leftW + 9 + rw + 9;
  const title = `otra.city · ${right}`;
  // three towers with lit windows: the city at night, 14×16 at (8, 6)
  const skyline = `<g transform="translate(8 6)">
    <rect x="0" y="6" width="4" height="10" fill="#ff2d95"/><rect x="5" y="0" width="4" height="16" fill="#7a3cff"/><rect x="10" y="4" width="4" height="12" fill="#ff2d95"/>
    <rect x="1" y="8" width="2" height="2" fill="#2fe0f8"/><rect x="6" y="3" width="2" height="2" fill="#2fe0f8"/><rect x="6" y="9" width="2" height="2" fill="#ffd166"/><rect x="11" y="7" width="2" height="2" fill="#2fe0f8"/>
  </g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${xml(title)}">
  <title>${xml(title)}</title>
  <clipPath id="r"><rect width="${W}" height="${H}" rx="6"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${W}" height="${H}" fill="#1b1233"/>
    <rect width="${leftW}" height="${H}" fill="#0a0817"/>
  </g>
  <rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="5.5" fill="none" stroke="#31234f"/>
  ${skyline}
  <g font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,'DejaVu Sans Mono',monospace" font-size="11" font-weight="600">
    <text x="28" y="18" fill="#2fe0f8" textLength="${lw}" lengthAdjust="spacingAndGlyphs">${label}</text>
    <text x="${leftW + 9}" y="18" fill="#e9edf6" textLength="${rw}" lengthAdjust="spacingAndGlyphs">${xml(right)}</text>
  </g>
</svg>
`;
}
