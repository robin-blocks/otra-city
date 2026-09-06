// Local harness for the Vercel functions: node scripts/dev-api.mjs (port 8788)
// Routes the submit endpoint and the server-rendered pages the way
// vercel.json rewrites them, so /lot/<id>, /road/<id> and /directory work
// here exactly as deployed.
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import handler from '../api/submit.mjs';
import pages from '../api/pages.mjs';
import { MIME } from '../lib/static-server.mjs';

// public/ is served too, so a page's poster and pictures resolve here the way
// they do on the deployed host (which serves public/ beside the functions)
const root = new URL('../public', import.meta.url).pathname;

const PORT = Number(process.env.PORT || 8788);
createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/plots/submit')) return handler(req, res);
  if (url.pathname.startsWith('/api/pages')) return pages(req, res);
  let m;
  if ((m = /^\/lot\/([^/]+)$/.exec(url.pathname))) { req.url = `/api/pages?page=lot&id=${m[1]}`; return pages(req, res); }
  if ((m = /^\/road\/([^/]+)$/.exec(url.pathname))) { req.url = `/api/pages?page=road&id=${m[1]}`; return pages(req, res); }
  if (url.pathname === '/directory') { req.url = '/api/pages?page=directory'; return pages(req, res); }
  const file = join(root, normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, ''));
  if (req.method === 'GET' && file.startsWith(root) && existsSync(file) && !statSync(file).isDirectory()) {
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    return res.end(readFileSync(file));
  }
  res.statusCode = 404;
  res.end('not found');
}).listen(PORT, () => console.log(`dev api on :${PORT}`));
