// POST /api/plots/submit — the no-fork submission path (ai-directory model).
// Accepts JSON { plot: {...}, glb_base64, media?: { "name.ext": base64 } },
// runs the exact published checks, verifies the backlink (unless the domain
// is pre-trusted, e.g. existing PromptFrenzy AI-directory listees), then
// creates the PR with the directory bot's credentials. The submitter needs
// nothing but this one HTTP call.
//
// Env: GITHUB_TOKEN (bot PAT with repo scope), GITHUB_REPO ("owner/name").
// Without a token — or with { dry: true } — it validates and reports only.
import { validateIdentity, validateGlb, probeWalkability, validateMediaDecl, SPEC } from '../lib/validate-plot.mjs';
import { readFileSync } from 'node:fs';

const TRUSTED = JSON.parse(readFileSync(new URL('../trusted.json', import.meta.url)));
const MEDIA_EXT = {
  m4a: 2 << 20, mp3: 2 << 20, ogg: 2 << 20, mp4: 16 << 20, json: 64 << 10,
  png: 2 << 20, jpg: 2 << 20, jpeg: 2 << 20, webp: 2 << 20,
};

// Live-feed dry check: fetch the declared endpoint (or parse the bundled
// file) and validate the shape, so a broken feed fails HERE, not on the lot.
async function checkFeed(feed, media) {
  const shapeOk = (d) => d && typeof d === 'object' &&
    ['title', 'big', 'sub', 'bars'].some((k) => k in d);
  try {
    if (feed.url) {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 8000);
      const r = await fetch(feed.url, { signal: ctl.signal, headers: { 'user-agent': 'otra-city-bot/1.0' } });
      clearTimeout(t);
      if (!r.ok) return { ok: false, detail: `GET ${feed.url} -> ${r.status}` };
      const cors = r.headers.get('access-control-allow-origin');
      const data = await r.json();
      if (!shapeOk(data)) return { ok: false, detail: 'response is not {title, big, sub, bars[]}' };
      return {
        ok: cors === '*',
        detail: cors === '*'
          ? `endpoint OK, shape OK, CORS OK (panel falls back to its authored texture if it ever breaks)`
          : `shape OK but missing "Access-Control-Allow-Origin: *" — the browser polls this URL directly, so without CORS the panel will only ever show its authored texture`,
      };
    }
    const name = (feed.file || '').split('/').pop();
    const b64 = media[name];
    if (!b64) return { ok: false, detail: `bundled feed ${feed.file} not found in media` };
    const data = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
    if (!shapeOk(data)) return { ok: false, detail: 'bundled feed is not {title, big, sub, bars[]}' };
    return { ok: true, detail: `bundled feed OK — update it by resubmitting; upgrade to a live url any time` };
  } catch (e) {
    return { ok: false, detail: `feed check failed: ${e.name || e}` };
  }
}

async function readBody(req) {
  if (req.body) return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function checkBacklink(url, slug) {
  const domain = new URL(url).hostname.replace(/^www\./, '');
  if (TRUSTED.domains.includes(domain)) {
    return { ok: true, mode: 'trusted', detail: `${domain} is pre-trusted (existing directory listing)` };
  }
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 8000);
    const r = await fetch(url, { signal: ctl.signal, redirect: 'follow', headers: { 'user-agent': 'otra-city-bot/1.0' } });
    clearTimeout(t);
    if (!r.ok) return { ok: false, mode: 'fetched', detail: `GET ${url} -> ${r.status}` };
    const html = (await r.text()).slice(0, 512 * 1024);
    const needle = `otra.city/s/${slug}`;
    const found = html.includes(needle);
    return {
      ok: found,
      mode: 'fetched',
      detail: found ? `backlink to ${needle} found` : `page does not contain ${needle} — add your plot permalink first`,
    };
  } catch (e) {
    return { ok: false, mode: 'fetched', detail: `could not fetch ${url}: ${e.name}` };
  }
}

async function gh(path, method, body, token) {
  const r = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'otra-city-bot/1.0',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return r.json();
}

async function createPR({ plot, glb, media }, report) {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;
  const base = 'main';
  const branch = `plot/${plot.slug}-${Date.now().toString(36)}`;
  const ref = await gh(`/repos/${repo}/git/ref/heads/${base}`, 'GET', null, token);
  await gh(`/repos/${repo}/git/refs`, 'POST', { ref: `refs/heads/${branch}`, sha: ref.object.sha }, token);
  const put = (path, contentB64, message) =>
    gh(`/repos/${repo}/contents/${path}`, 'PUT', { message, content: contentB64, branch }, token);
  await put(`public/plots/${plot.slug}/plot.json`,
    Buffer.from(JSON.stringify(plot, null, 2)).toString('base64'), `plot: ${plot.slug} manifest`);
  await put(`public/plots/${plot.slug}/plot.glb`, glb.toString('base64'), `plot: ${plot.slug} model`);
  for (const [name, b64] of Object.entries(media || {})) {
    await put(`public/plots/${plot.slug}/media/${name}`, b64, `plot: ${plot.slug} media ${name}`);
  }
  const pr = await gh(`/repos/${repo}/pulls`, 'POST', {
    title: `plot: ${plot.name} (${plot.slug})`,
    head: branch,
    base,
    body: `Automated plot submission via /api/plots/submit\n\n\`\`\`\n${report}\n\`\`\``,
  }, token);
  return pr.html_url;
}

export default async function handler(req, res) {
  res.setHeader('content-type', 'application/json');
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.end(JSON.stringify({ error: 'POST a submission bundle; see https://otra.city/docs/submission.md' }));
    return;
  }
  try {
    const body = await readBody(req);
    const plot = body.plot || {};
    const result = { spec_version: SPEC.version, identity: null, budgets: null, walkability: null, backlink: null };

    result.identity = validateIdentity(plot);
    if (!body.glb_base64) throw new Error('glb_base64 missing');
    const glb = Buffer.from(body.glb_base64, 'base64');
    const requireDoor = plot.type === 'shop';
    result.budgets = await validateGlb(glb, { requireDoor });
    delete result.budgets.doc;
    result.walkability = await probeWalkability(glb, { door: requireDoor });

    const media = body.media || {};
    const mediaChecks = [];
    let mediaOk = true;
    for (const [name, b64] of Object.entries(media)) {
      const ext = name.split('.').pop().toLowerCase();
      const size = Buffer.from(b64, 'base64').length;
      const ok = !!MEDIA_EXT[ext] && size <= MEDIA_EXT[ext] && /^[a-z0-9._-]+$/i.test(name);
      mediaOk &&= ok;
      mediaChecks.push({ name: `media ${name}`, ok, detail: `${(size / 1024).toFixed(0)} KiB ${ext}` });
    }
    const decl = validateMediaDecl(plot, Object.keys(media));
    mediaChecks.push(...decl.checks);
    mediaOk &&= decl.ok;
    result.media = { checks: mediaChecks, ok: mediaOk };

    if (plot.media?.feed) result.feed = await checkFeed(plot.media.feed, media);
    if (result.identity.ok) result.backlink = await checkBacklink(plot.url, plot.slug);

    const accepted = result.identity.ok && result.budgets.ok && result.walkability.ok &&
      mediaOk && (result.feed ? result.feed.ok : true) && !!result.backlink?.ok;
    const lines = [];
    for (const section of ['identity', 'budgets', 'walkability', 'media']) {
      for (const c of result[section].checks) lines.push(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name.padEnd(14)} ${c.detail}`);
    }
    if (result.feed) lines.push(`${result.feed.ok ? 'PASS' : 'FAIL'}  live feed      ${result.feed.detail}`);
    if (result.backlink) lines.push(`${result.backlink.ok ? 'PASS' : 'FAIL'}  backlink       ${result.backlink.detail}`);
    const report = lines.join('\n') + `\nVERDICT: ${accepted ? 'ACCEPTED' : 'REJECTED'}`;

    let pr_url = null;
    const dry = body.dry === true || !process.env.GITHUB_TOKEN || !process.env.GITHUB_REPO;
    if (accepted && !dry) pr_url = await createPR({ plot, glb, media }, report);

    res.statusCode = accepted ? 200 : 422;
    res.end(JSON.stringify({
      accepted,
      dry,
      pr_url,
      permalink: `https://otra.city/s/${plot.slug}`,
      status_url: `https://otra.city/api/plots/${plot.slug}`,
      embed_url: `https://otra.city/embed?plot=${plot.slug}`,
      preview: 'https://otra.city/preview — drop your glb to see it in the real pipeline',
      report,
      result,
    }, null, 2));
  } catch (e) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: String(e.message || e) }));
  }
}
