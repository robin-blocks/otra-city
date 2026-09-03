// Whose site is this? — the ONE implementation the submit API, CI and any
// future tool call, so "passes locally" always means "passes remotely".
//
// A plot's `url` host is its identity: it is what the backlink is checked
// against and what grants write access to the slug forever. Three questions
// are asked of it here and nowhere else:
//
//   ownerKey(url)      who may update this slug
//   sameSite(a, b)     did a redirect leave the domain that was claimed
//   classifyUrl(url)   is this address stable enough to stand in the city
//
// Everything is DERIVED FROM THE URL at check time and nothing is stored, so
// editing a list below re-classifies every future submission with no
// migration. The lists are deliberately short: each entry is a host we can
// justify, not a best-effort mirror of the public suffix list.

// Suffixes under which each SUBDOMAIN is a different owner — either a country
// registry (co.uk) or a platform's publish domain (github.io). The rule that
// keeps the platform half honest, learned from PromptFrenzy's directory: add
// the domain a builder PUBLISHES to, never the builder's own homepage.
// `bolt.host` yes, `bolt.new` no — otherwise you demote Bolt itself.
const MULTI_LABEL_SUFFIXES = new Set([
  // country registries
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'net.uk',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au',
  'co.nz', 'net.nz', 'org.nz', 'co.za', 'org.za',
  'co.jp', 'or.jp', 'ne.jp', 'ac.jp', 'co.kr', 'or.kr',
  'com.br', 'net.br', 'org.br', 'com.mx', 'com.ar',
  'co.in', 'net.in', 'org.in', 'com.sg', 'com.hk', 'com.tw',
  'com.cn', 'net.cn', 'org.cn', 'com.tr', 'com.pl', 'com.ua',
  'co.il', 'com.my', 'com.ph', 'com.vn', 'com.ng',
  // platform PUBLISH domains: <you>.<suffix> is your site, not theirs
  'github.io', 'gitlab.io', 'pages.dev', 'workers.dev', 'vercel.app',
  'netlify.app', 'web.app', 'firebaseapp.com', 'herokuapp.com', 'fly.dev',
  'deno.dev', 'onrender.com', 'railway.app', 'surge.sh', 'glitch.me',
  'replit.app', 'repl.co', 'streamlit.app', 'hf.space', 'bolt.host',
  'lovable.app', 'notion.site', 'framer.website', 'framer.app', 'webflow.io',
  'wixsite.com', 'myshopify.com', 'substack.com', 'bubbleapps.io',
  'hashnode.dev', 'itch.io', 'gumroad.com', 'blogspot.com', 'wordpress.com',
]);

// Hosts where the identity lives in the PATH, not the hostname. These are not
// refused — a repo can be a real project — but the owner key includes the
// first path segment, so github.com/alice cannot overwrite github.com/bob.
// Without this, ownership by bare hostname hands every github.com submitter
// write access to every other github.com plot.
const SHARED_HOSTS = new Set([
  'github.com', 'gitlab.com', 'bitbucket.org', 'huggingface.co',
  'medium.com', 'dev.to', 'hashnode.com', 'substack.com',
  'x.com', 'twitter.com', 'linkedin.com', 'facebook.com', 'instagram.com',
  'reddit.com', 'youtube.com', 'tiktok.com', 'twitch.tv',
  'linktr.ee', 'bio.link', 'carrd.co', 'about.me',
  'notion.so', 'producthunt.com', 'npmjs.com', 'pypi.org', 'crates.io',
  'replit.com', 'codepen.io', 'codesandbox.io', 'stackblitz.com',
  'patreon.com', 'ko-fi.com', 'discord.gg', 't.me', 'itch.io',
]);

// Addresses that cannot hold an identity for as long as a plot stands.
// A plot's url is on its information board forever; these all stop resolving
// (or start resolving to somebody else) long before the plot comes down.
const EPHEMERAL_HOSTS = [
  // developer tunnels — alive while a laptop is awake
  { suffix: 'ngrok.io', why: 'a tunnel' }, { suffix: 'ngrok.app', why: 'a tunnel' },
  { suffix: 'ngrok-free.app', why: 'a tunnel' }, { suffix: 'ngrok.dev', why: 'a tunnel' },
  { suffix: 'trycloudflare.com', why: 'a tunnel' }, { suffix: 'loca.lt', why: 'a tunnel' },
  { suffix: 'serveo.net', why: 'a tunnel' }, { suffix: 'localhost.run', why: 'a tunnel' },
  { suffix: 'lhr.life', why: 'a tunnel' }, { suffix: 'devtunnels.ms', why: 'a tunnel' },
  { suffix: 'pinggy.link', why: 'a tunnel' }, { suffix: 'bore.pub', why: 'a tunnel' },
  { suffix: 'tunnelmole.net', why: 'a tunnel' },
  // link shorteners — an indirection somebody else can re-point
  { suffix: 'bit.ly', why: 'a link shortener' }, { suffix: 'tinyurl.com', why: 'a link shortener' },
  { suffix: 't.co', why: 'a link shortener' }, { suffix: 'goo.gl', why: 'a link shortener' },
  { suffix: 'rb.gy', why: 'a link shortener' }, { suffix: 'is.gd', why: 'a link shortener' },
  { suffix: 'cutt.ly', why: 'a link shortener' }, { suffix: 'shorturl.at', why: 'a link shortener' },
  { suffix: 'ow.ly', why: 'a link shortener' }, { suffix: 'buff.ly', why: 'a link shortener' },
  { suffix: 'lnkd.in', why: 'a link shortener' }, { suffix: 'rebrand.ly', why: 'a link shortener' },
  { suffix: 't.ly', why: 'a link shortener' }, { suffix: 'short.io', why: 'a link shortener' },
];

const isLocal = (host) => /^(localhost|127\.0\.0\.1)(:|$)/.test(host);
const isIpLiteral = (host) => /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith('[');

/** Hostname, lowercased, without a leading `www.` or a port. '' if unparseable. */
export function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
}

/**
 * The registrable domain — `blog.example.co.uk` -> `example.co.uk`,
 * `alice.github.io` -> `alice.github.io`. Not a full public-suffix lookup:
 * a suffix missing from MULTI_LABEL_SUFFIXES collapses one label too far,
 * which can only ever make sameSite() more permissive between two hosts that
 * already share a registry, never between unrelated domains.
 */
export function apexHost(url) {
  const host = hostOf(url);
  if (!host || isIpLiteral(host) || isLocal(host)) return host;
  const parts = host.split('.');
  if (parts.length <= 2) return host;
  const lastTwo = parts.slice(-2).join('.');
  return MULTI_LABEL_SUFFIXES.has(lastTwo) ? parts.slice(-3).join('.') : lastTwo;
}

/** Do two urls belong to the same site? Used to catch a redirect off-domain. */
export function sameSite(a, b) {
  const x = apexHost(a);
  return !!x && x === apexHost(b);
}

/**
 * Who may update the slug this url claims. The hostname, except on a
 * multi-tenant host where the first path segment is the tenant.
 */
export function ownerKey(url) {
  const host = hostOf(url);
  if (!host) return '';
  if (!SHARED_HOSTS.has(host)) return host;
  let seg = '';
  try { seg = (new URL(url).pathname.split('/').filter(Boolean)[0] || '').toLowerCase(); } catch { /* host only */ }
  return seg ? `${host}/${seg}` : host;
}

/**
 * Is this address stable enough to stand on a lot? Derived live, never
 * persisted, so widening or narrowing the lists takes effect on the next
 * submission with nothing to backfill.
 *
 * -> { ok, tier: 'permanent'|'ephemeral'|'invalid'|'local', detail }
 */
export function classifyUrl(url) {
  const host = hostOf(url);
  if (!host) return { ok: false, tier: 'invalid', detail: `${url} is not a url we can read a host from` };
  if (isLocal(host)) return { ok: true, tier: 'local', detail: `${host} — local test rig` };
  if (isIpLiteral(host)) {
    return { ok: false, tier: 'invalid', detail:
      `${host} is a bare IP address. A plot's url is on its information board for as long as the plot stands, ` +
      `and it is the identity that lets you update the plot later — use a domain name you control.` };
  }
  const bad = EPHEMERAL_HOSTS.find((e) => host === e.suffix || host.endsWith(`.${e.suffix}`));
  if (bad) {
    return { ok: false, tier: 'ephemeral', detail:
      `${host} is ${bad.why}. Your url goes on the information board at your street edge and is the identity ` +
      `that lets you update this plot later, so it has to outlive the session that submitted it — ` +
      `send the address you want visitors to have in a year.` };
  }
  const owner = ownerKey(url);
  return { ok: true, tier: 'permanent',
    detail: owner.includes('/')
      ? `${host} is shared, so your identity is ${owner} — only that path may update this slug`
      : `${host} — this host is your identity; keep it or you lose write access to this slug` };
}
