// `npm run dev`: the client on http://127.0.0.1:5173 (PORT=… moves it).
//
// Deliberately NOT lib/static-server.mjs, which is the ephemeral host the
// headless tools share. A dev server has two jobs that one must not:
//   * it sends `no-store`. python's http.server sent no Cache-Control, so
//     Chrome heuristically cached /js/*.js and a reload KEPT RUNNING THE OLD
//     MODULE while the server answered 200 and curl showed the new bytes —
//     a fix looked like it had failed.
//   * it applies vercel.json's static rewrites, so /s/<slug>, /embed, /preview
//     and /about work here the way they do in production. Function routes
//     (/api/…) are left alone — scripts/dev-api.mjs is the harness for those.
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { MIME } from '../lib/static-server.mjs';

const root = new URL('../public', import.meta.url).pathname;
const TYPES = {
  ...MIME,
  '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.blend': 'application/octet-stream', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};
// a `:param` in a rewrite source is one path segment
const rules = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')).rewrites
  .filter((r) => !r.destination.startsWith('/api/'))
  .map((r) => ({ re: new RegExp('^' + r.source.replace(/:[A-Za-z_]+/g, '[^/]+') + '/?$'), to: r.destination }));

const server = createServer((req, res) => {
  let path = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  const rule = rules.find((r) => r.re.test(path));
  if (rule) path = rule.to;
  let file = join(root, path === '/' ? 'index.html' : path);
  if (!file.startsWith(root)) return res.writeHead(403).end('no');
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file) || statSync(file).isDirectory()) return res.writeHead(404).end('not found');
  res.writeHead(200, {
    'content-type': TYPES[extname(file)] || 'application/octet-stream',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
  });
  res.end(readFileSync(file));
});
const port = Number(process.env.PORT || 5173);
server.listen(port, '127.0.0.1', () => {
  console.log(`otra.city client on http://127.0.0.1:${port}  (public/, no-store, vercel.json clean URLs)`);
});
