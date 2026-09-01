// GET /api/plots/<slug> — machine-readable plot status, so agents can check
// slug availability before building and "am I live yet" after submitting,
// without scraping the SPA (which returns 200 for every /s/ URL).
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
      res.statusCode = 404;
      res.end(JSON.stringify({
        slug,
        exists: false,
        available: true,
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
      position: lot ? { x: lot.x, side: lot.side } : null,
      permalink: `https://otra.city/s/${slug}`,
      embed: `https://otra.city/embed?plot=${slug}`,
      preview: `https://otra.city/preview?glb=/plots/${slug}/plot.glb`,
      plot,
    }, null, 2));
  } catch (e) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: String(e.message || e) }));
  }
}
