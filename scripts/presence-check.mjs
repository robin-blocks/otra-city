// The presence gate.
//
// One rule, and it is a promise made to RFL rather than an implementation
// detail: A FULL HOUSE MUST NOT TAKE THE BROADCAST OFF THE AIR. The presence
// server turns citizens away past HARD_CAP so per-client bandwidth stays
// bounded, and their Twitch channel is a continuous capture of /broadcast —
// so a camera queuing behind 150 visitors on the busiest night of the season
// is exactly the failure nobody would notice until it happened. Cameras
// declare themselves at the door with `?observe=1` and are counted and capped
// separately.
//
// Nothing else in CI touches server/, so this is the only thing standing
// between that promise and a quiet regression.
//
//   node scripts/presence-check.mjs [--port 8799]
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const PORT = Number(arg('port', '8799'));
const SERVER = join(dirname(fileURLToPath(import.meta.url)), '..', 'server', 'presence.mjs');
// Read the server's own numbers rather than restating them: a check that keeps
// its own copy of HARD_CAP passes happily after someone changes the server's.
const src = await import('node:fs').then((fs) => fs.readFileSync(SERVER, 'utf8'));
const HARD_CAP = Number(src.match(/const HARD_CAP = (\d+)/)?.[1]);
const OBSERVER_CAP = Number(src.match(/const OBSERVER_CAP = (\d+)/)?.[1]);

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  return ok;
};

console.log(`presence check — cap ${HARD_CAP} citizens + ${OBSERVER_CAP} cameras, on :${PORT}\n`);

const srv = spawn(process.execPath, [SERVER], { env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
const sockets = [];
/** Open one client and wait for the server's verdict: 'hi' (admitted) or 'full'. */
const open = (query = '') => new Promise((res) => {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}${query}`);
  sockets.push(ws);
  const done = (verdict) => res({ ws, verdict });
  ws.on('message', (d) => { try { const m = JSON.parse(d); if (m.t === 'hi' || m.t === 'full') done(m.t); } catch { /* not a verdict */ } });
  ws.on('error', () => done('error'));
  setTimeout(() => done('timeout'), 10000);
});

try {
  // The server binds asynchronously; a client that races it gets 'error'.
  for (let i = 0; i < 50; i++) {
    const probe = await open();
    if (probe.verdict === 'hi') { probe.ws.close(); break; }
    await new Promise((r) => setTimeout(r, 100));
  }

  const citizens = [];
  for (let i = 0; i < HARD_CAP; i++) citizens.push(await open());
  const admitted = citizens.filter((c) => c.verdict === 'hi').length;
  check(`the house holds ${HARD_CAP} citizens`, admitted === HARD_CAP, `${admitted} admitted`);

  const extra = await open();
  check('the next citizen is turned away rather than silently dropped', extra.verdict === 'full', extra.verdict);

  const camera = await open('?observe=1');
  check('a camera is admitted to a full house', camera.verdict === 'hi', camera.verdict);

  const cameras = [];
  for (let i = 0; i < OBSERVER_CAP; i++) cameras.push(await open('?observe=1'));
  const tooMany = await open('?observe=1');
  check('cameras have a cap of their own', tooMany.verdict === 'full',
    `${cameras.filter((c) => c.verdict === 'hi').length + 1} admitted, then ${tooMany.verdict}`);
} finally {
  for (const ws of sockets) { try { ws.close(); } catch { /* already gone */ } }
  srv.kill();
}

const failed = checks.filter((c) => !c.ok).length;
console.log(`\n${failed ? 'FAIL' : 'PASS'}  ${checks.length - failed}/${checks.length} checks`);
process.exit(failed ? 1 : 0);
