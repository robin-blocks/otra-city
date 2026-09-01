// Local harness for the Vercel function: node scripts/dev-api.mjs (port 8788)
import { createServer } from 'node:http';
import handler from '../api/submit.mjs';

const PORT = Number(process.env.PORT || 8788);
createServer((req, res) => {
  if (req.url.startsWith('/api/plots/submit')) return handler(req, res);
  res.statusCode = 404;
  res.end('not found');
}).listen(PORT, () => console.log(`dev api on :${PORT}`));
