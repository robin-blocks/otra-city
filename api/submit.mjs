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
  if (!r.ok) {
    const err = new Error(`${method} ${path} -> ${r.status}: ${(await r.text()).slice(0, 300)}`);
    err.status = r.status;
    throw err;
  }
  return r.json();
}

// Contents writes right after a ref is created can 409 while GitHub settles
// the new branch; 5xx are plain transients. Both are worth a couple of retries.
async function ghRetry(path, method, body, token, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      return await gh(path, method, body, token);
    } catch (e) {
      if (i >= tries || !(e.status === 409 || e.status >= 500)) throw e;
      await new Promise((r) => setTimeout(r, 1500 * i));
    }
  }
}

// GET that treats 404 as null (missing file/dir) instead of throwing.
async function ghMaybe(path, token) {
  const r = await fetch(`https://api.github.com${path}`, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'user-agent': 'otra-city-bot/1.0' },
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GET ${path} -> ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

// Every file currently under a plot folder on a ref, with the blob shas the
// contents API needs for updates and deletes.
async function listPlotFiles(repo, dir, ref, token) {
  const items = await ghMaybe(`/repos/${repo}/contents/${dir}?ref=${encodeURIComponent(ref)}`, token);
  if (!Array.isArray(items)) return [];
  const out = [];
  for (const it of items) {
    if (it.type === 'file') out.push({ path: it.path, sha: it.sha });
    else if (it.type === 'dir') out.push(...await listPlotFiles(repo, it.path, ref, token));
  }
  return out;
}

const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

// Ownership: a slug can only be UPDATED from the domain that owns it. Without
// this, any trusted domain (which skips the backlink) could overwrite anyone.
async function existingManifest(slug, host) {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;
  if (token && repo) {
    // the repo is the source of truth; the deployed site lags a merge by a minute
    const f = await ghMaybe(`/repos/${repo}/contents/public/plots/${slug}/plot.json?ref=main`, token);
    return f ? JSON.parse(Buffer.from(f.content, 'base64').toString()) : null;
  }
  // tokenless harnesses read the live registry instead
  const origin = /^(localhost|127\.0\.0\.1)/.test(host) ? 'https://otra.city' : `https://${host}`;
  const r = await fetch(`${origin}/plots/${slug}/plot.json`, { headers: { 'user-agent': 'otra-city-bot/1.0' } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`registry ${r.status}`);
  return r.json();
}

async function checkOwnership(slug, url, host) {
  try {
    const existing = await existingManifest(slug, host);
    if (!existing) return { ok: true, mode: 'create', detail: 'new slug' };
    const owner = hostOf(existing.url);
    const mine = hostOf(url);
    return owner === mine
      ? { ok: true, mode: 'update', detail: `updating your existing plot — the url host ${owner} is your identity; keep it or you lose write access to this slug` }
      : { ok: false, mode: 'denied', detail: `slug "${slug}" belongs to ${owner}; updates must come from that host (the url host is the owner's identity)` };
  } catch (e) {
    return { ok: false, mode: 'unknown', detail: `ownership check failed: ${e.name || e}` };
  }
}

// Dry-run visibility into what a real submit would do on GitHub, so
// "accepted" means "would land": token works, and create vs replace.
async function checkGithub(slug) {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;
  if (!token || !repo) return { ok: true, mode: 'dry-only', detail: 'no bot token on this deployment — validation only' };
  try {
    if (!(await ghMaybe(`/repos/${repo}`, token))) return { ok: false, detail: 'bot token cannot see the repo' };
    const existing = await listPlotFiles(repo, `public/plots/${slug}`, 'main', token);
    return existing.length
      ? { ok: true, mode: 'update', detail: `will REPLACE the existing plot wholesale (${existing.length} files on main; stale media removed)` }
      : { ok: true, mode: 'create', detail: 'will create the plot' };
  } catch (e) {
    return { ok: false, detail: `github check failed: ${e.message}` };
  }
}

async function createPR({ plot, glb, media }, report) {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;
  const base = 'main';
  const branch = `plot/${plot.slug}-${Date.now().toString(36)}`;
  const ref = await gh(`/repos/${repo}/git/ref/heads/${base}`, 'GET', null, token);
  await gh(`/repos/${repo}/git/refs`, 'POST', { ref: `refs/heads/${branch}`, sha: ref.object.sha }, token);
  try {
    const dir = `public/plots/${plot.slug}`;
    // existing blob shas: required by the contents API for updates/deletes
    const existing = new Map((await listPlotFiles(repo, dir, branch, token)).map((f) => [f.path, f.sha]));
    const files = {
      [`${dir}/plot.json`]: Buffer.from(JSON.stringify(plot, null, 2)).toString('base64'),
      [`${dir}/plot.glb`]: glb.toString('base64'),
    };
    for (const [name, b64] of Object.entries(media || {})) files[`${dir}/media/${name}`] = b64;
    for (const [path, content] of Object.entries(files)) {
      const body = { message: `plot: ${plot.slug} ${path.split('/').pop()}`, content, branch };
      if (existing.has(path)) body.sha = existing.get(path);
      await ghRetry(`/repos/${repo}/contents/${path}`, 'PUT', body, token);
    }
    // wholesale replacement: anything on the old plot not in this bundle goes
    for (const [path, sha] of existing) {
      if (!(path in files)) {
        await ghRetry(`/repos/${repo}/contents/${path}`, 'DELETE', { message: `plot: ${plot.slug} remove stale ${path.split('/').pop()}`, sha, branch }, token);
      }
    }
    const pr = await gh(`/repos/${repo}/pulls`, 'POST', {
      title: `plot: ${existing.size ? 'update ' : ''}${plot.name} (${plot.slug})`,
      head: branch,
      base,
      body: `Automated plot submission via /api/plots/submit\n\n\`\`\`\n${report}\n\`\`\`\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)`,
    }, token);
    return pr.html_url;
  } catch (e) {
    // never leave a zero-diff branch behind
    await fetch(`https://api.github.com/repos/${repo}/git/refs/heads/${branch}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}`, 'user-agent': 'otra-city-bot/1.0' },
    }).catch(() => {});
    throw e;
  }
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
    const host = req.headers['x-forwarded-host'] || req.headers.host || 'otra.city';
    if (result.identity.ok) {
      result.backlink = await checkBacklink(plot.url, plot.slug);
      result.ownership = await checkOwnership(plot.slug, plot.url, host);
      result.github = await checkGithub(plot.slug);
    }

    const accepted = result.identity.ok && result.budgets.ok && result.walkability.ok &&
      mediaOk && (result.feed ? result.feed.ok : true) && !!result.backlink?.ok &&
      !!result.ownership?.ok && !!result.github?.ok;
    const lines = [];
    for (const section of ['identity', 'budgets', 'walkability', 'media']) {
      for (const c of result[section].checks) lines.push(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name.padEnd(14)} ${c.detail}`);
    }
    if (result.feed) lines.push(`${result.feed.ok ? 'PASS' : 'FAIL'}  live feed      ${result.feed.detail}`);
    if (result.backlink) lines.push(`${result.backlink.ok ? 'PASS' : 'FAIL'}  backlink       ${result.backlink.detail}`);
    if (result.ownership) lines.push(`${result.ownership.ok ? 'PASS' : 'FAIL'}  ownership      ${result.ownership.detail}`);
    if (result.github) lines.push(`${result.github.ok ? 'PASS' : 'FAIL'}  github         ${result.github.detail}`);
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
    console.error('submit failed:', e.message || e);
    res.statusCode = 400;
    res.end(JSON.stringify({ error: String(e.message || e) }));
  }
}
