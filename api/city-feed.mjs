// GET /api/city-feed — live city statistics in the plot live-feed shape
// ({title, big, sub, bars[]}) for the City Hall ledger panel. Reads the
// deployed street manifest, so the panel is always as current as the city.
export default async function handler(req, res) {
  res.setHeader('content-type', 'application/json');
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('cache-control', 's-maxage=60, stale-while-revalidate=300');
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  try {
    const index = await (await fetch(`https://${host}/plots/index.json`)).json();
    const lots = (index.lots || []).slice().sort((a, b) => a.x - b.x || a.side - b.side);
    const hostOf = (u) => { try { return new URL(u).host; } catch { return ''; } };
    const civic = lots.filter((l) => /(^|\.)otra\.city$/.test(hostOf(l.url))).length;
    const projects = lots.length - civic;
    const vacant = (index.vacant || []).length;
    // one bar per lot, west to east: how much each build declares
    // (media bindings + animations), so the skyline of effort is visible
    const bars = lots.map((l) => {
      const m = l.media || {};
      const n = (m.audio ? 1 : 0) + (m.screens || []).length + (m.pictures || []).length + (m.feed ? 1 : 0);
      return 1 + n + (l.anims || []).length;
    });
    res.statusCode = 200;
    res.end(JSON.stringify({
      title: 'CITY LEDGER',
      big: `${lots.length} LOTS`,
      sub: `${projects} PROJECTS · ${civic} CIVIC · ${vacant} VACANT`,
      bars,
    }));
  } catch (e) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: String(e.message || e) }));
  }
}
