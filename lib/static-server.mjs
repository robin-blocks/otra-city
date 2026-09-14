// The one static host for every script that drives a headless browser over
// this site. render-posters and preview-shot each used to carry their own
// copy, character for character, and a third copy is how they drift: a MIME
// type added for one renderer and missing from the other is a black texture
// nobody can explain.
//
// Ephemeral port on the loopback interface only — these servers exist for the
// length of one render and must never be reachable from anywhere else.
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, extname, normalize } from 'node:path';

export const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.css': 'text/css', '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary', '.webp': 'image/webp', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.mp4': 'video/mp4',
  '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg',
};

/**
 * Serve `root` on an ephemeral loopback port.
 *
 * `mounts` maps a url prefix to a resolver, `(relPath) => absolutePath | null`,
 * for content that does not live under `root` — the submitter's unmerged
 * bundle, say. Returning null refuses the request (403), which is how a
 * resolver rejects a path trying to climb out of its own directory; anything
 * not under a mount is served from `root`.
 *
 * @returns {Promise<{server: import('node:http').Server, origin: string}>}
 */
export function serve(root, { mounts = {} } = {}) {
  // An ETag, because production has one and something now depends on it: the
  // live feed notices a new build by watching the page document's etag change.
  // Without one here, that mechanism is untestable locally and CI would be
  // asserting nothing. Content-hashed rather than mtime-based, so two runs of
  // the same tree agree.
  const send = (res, file, req) => {
    const body = readFileSync(file);
    res.writeHead(200, {
      'content-type': MIME[extname(file)] || 'application/octet-stream',
      etag: `"${createHash('md5').update(body).digest('hex')}"`,
      'cache-control': 'public, max-age=0, must-revalidate',
    });
    // A HEAD asks the same question and must not be answered with a body.
    res.end(req?.method === 'HEAD' ? undefined : body);
  };
  const entries = Object.entries(mounts);
  const server = createServer((req, res) => {
    const path = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
    for (const [prefix, resolve] of entries) {
      if (!path.startsWith(prefix)) continue;
      const file = resolve(path.slice(prefix.length));
      if (!file) return res.writeHead(403).end('no');
      if (!existsSync(file) || statSync(file).isDirectory()) return res.writeHead(404).end('not found');
      return send(res, file, req);
    }
    const file = join(root, path === '/' ? 'index.html' : path);
    if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) {
      return res.writeHead(404).end('not found');
    }
    return send(res, file, req);
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(
    { server, origin: `http://127.0.0.1:${server.address().port}` })));
}
