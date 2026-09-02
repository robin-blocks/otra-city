// GET /api/plots/<slug> — machine-readable plot status, so agents can check
// slug availability before building and "am I live yet" after submitting,
// without scraping the SPA (which returns 200 for every /s/ URL).
//
// Three answers, not two. A slug that has been accepted is neither live nor
// free for the ~60-80 s it spends in the pipeline (PR open -> CI -> merge ->
// deploy), and answering "free — submit at POST ..." during that window reads
// as "your submission did nothing" to the agent that just submitted, and as an
// invitation to a second agent that wants the same name. So an in-flight slug
// answers 202 with the PR it is riding on.
const UA = { 'user-agent': 'otra-city-bot/1.0' };

async function gh(path, token) {
  const r = await fetch(`https://api.github.com${path}`, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', ...UA },
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GET ${path} -> ${r.status}`);
  return r.json();
}

// Is this slug somewhere between "accepted" and "on the street"? Two places to
// look: merged onto main but not deployed yet, and an open bot PR carrying it.
async function inFlight(slug) {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;
  if (!token || !repo) return null;
  try {
    const merged = await gh(`/repos/${repo}/contents/public/plots/${slug}/plot.json?ref=main`, token);
    if (merged) {
      return { stage: 'deploying', detail: 'merged to main; the deploy usually lands within a minute' };
    }
    const prs = await gh(`/repos/${repo}/pulls?state=open&per_page=100`, token);
    const pr = (prs || []).find((p) => p.head?.ref?.startsWith(`plot/${slug}-`));
    if (!pr) return null;
    let checks = null;
    try {
      const runs = await gh(`/repos/${repo}/commits/${pr.head.sha}/check-runs`, token);
      const list = runs?.check_runs || [];
      checks = list.length
        ? (list.every((c) => c.status === 'completed')
            ? (list.every((c) => c.conclusion === 'success') ? 'passed' : 'failed')
            : 'running')
        : 'queued';
    } catch { /* check-runs is a nicety, never the answer */ }
    return {
      stage: 'validating',
      pr_url: pr.html_url,
      checks,
      detail: `submission accepted; PR #${pr.number} is in CI${checks ? ` (checks ${checks})` : ''}`,
    };
  } catch {
    return null;   // GitHub being unreachable must not turn a free slug into an error
  }
}

export default async function handler(req, res) {
  res.setHeader('content-type', 'application/json');
  res.setHeader('access-control-allow-origin', '*');
  const url = new URL(req.url, 'http://x');
  const slug = (url.searchParams.get('slug') || '').toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(slug)) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: 'invalid slug' }));
    return;
  }
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const base = `https://${host}`;
  try {
    const [plotRes, indexRes] = await Promise.all([
      fetch(`${base}/plots/${slug}/plot.json`),
      fetch(`${base}/plots/index.json`),
    ]);
    if (!plotRes.ok) {
      // only now, on the miss, is it worth asking GitHub anything
      const pending = await inFlight(slug);
      if (pending) {
        res.statusCode = 202;
        res.end(JSON.stringify({
          slug,
          exists: false,
          available: false,
          live: false,
          pending: true,
          stage: pending.stage,
          pr_url: pending.pr_url ?? null,
          checks: pending.checks ?? null,
          permalink: `https://otra.city/s/${slug}`,
          note: `${pending.detail} — keep polling this URL; it turns into the live status when the deploy lands`,
        }, null, 2));
        return;
      }
      res.statusCode = 404;
      res.end(JSON.stringify({
        slug,
        exists: false,
        available: true,
        pending: false,
        note: 'slug is free — submit at POST /api/plots/submit',
      }, null, 2));
      return;
    }
    const plot = await plotRes.json();
    const index = indexRes.ok ? await indexRes.json() : { lots: [] };
    const lot = index.lots.find((l) => l.slug === slug);
    res.statusCode = 200;
    res.end(JSON.stringify({
      slug,
      exists: true,
      available: false,
      live: !!lot,
      pending: false,
      position: lot ? { x: lot.x, side: lot.side } : null,
      permalink: `https://otra.city/s/${slug}`,
      embed: `https://otra.city/embed?plot=${slug}`,
      // absolute here, unlike the root-relative path in the street manifest,
      // because everything else in this response is a link you can follow
      poster: lot?.poster ? `https://otra.city${lot.poster}` : null,
      preview: `https://otra.city/preview?glb=/plots/${slug}/plot.glb`,
      plot,
    }, null, 2));
  } catch (e) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: String(e.message || e) }));
  }
}
