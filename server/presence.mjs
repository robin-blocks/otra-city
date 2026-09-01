// otra.city presence server — the simplest thing that works.
// One process, one room (one street segment), JSON over WebSocket.
//
//   node server/presence.mjs           # listens on :8787 (PORT env to change)
//
// Protocol: client sends {t:'pos', p:[x,y,z,yaw]} at ~10 Hz.
// Every 100 ms the server sends each client its nearest peers only:
// {t:'peers', peers: [[id, [x,y,z,yaw]], ...]} — capped and range-limited, so
// per-client bandwidth is bounded no matter how many people are in the city.
// Over HARD_CAP concurrent, new joiners get {t:'full'} (they run solo).
//
// Deploy anywhere that runs Node (Fly/Railway/render/VPS) — or wrap in a
// Vercel Function (Fluid Compute WebSockets); note multiple function
// instances shard players into parallel rooms, which is acceptable for v1.
import { WebSocketServer } from 'ws';
import { randomBytes } from 'node:crypto';

const PORT = Number(process.env.PORT || 8787);
const TICK_MS = 100;        // 10 Hz broadcast
const INTEREST_M = 60;      // ignore peers beyond this
const MAX_PEERS_SENT = 32;  // nearest-K per client
const HARD_CAP = 150;       // beyond this, joiners run solo

const clients = new Map(); // ws -> {id, p:[x,y,z,yaw], dirty}
const wss = new WebSocketServer({ port: PORT });

wss.on('connection', (ws) => {
  if (clients.size >= HARD_CAP) {
    ws.send(JSON.stringify({ t: 'full' }));
    ws.close();
    return;
  }
  const id = randomBytes(4).toString('hex');
  clients.set(ws, { id, p: [0, 0, 0, 0] });
  ws.send(JSON.stringify({ t: 'hi', id }));
  ws.on('message', (data) => {
    if (data.length > 200) return;
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    if (msg.t === 'pos' && Array.isArray(msg.p) && msg.p.length === 4 &&
        msg.p.every((v) => typeof v === 'number' && Number.isFinite(v))) {
      clients.get(ws).p = msg.p;
    }
  });
  ws.on('close', () => clients.delete(ws));
  ws.on('error', () => clients.delete(ws));
});

setInterval(() => {
  if (clients.size < 2) return;
  const all = [...clients.entries()];
  for (const [ws, me] of all) {
    if (ws.readyState !== 1) continue;
    const peers = [];
    for (const [ows, other] of all) {
      if (ows === ws) continue;
      const dx = other.p[0] - me.p[0];
      const dz = other.p[2] - me.p[2];
      const d2 = dx * dx + dz * dz;
      if (d2 < INTEREST_M * INTEREST_M) peers.push([d2, other.id, other.p]);
    }
    peers.sort((a, b) => a[0] - b[0]);
    ws.send(JSON.stringify({
      t: 'peers',
      peers: peers.slice(0, MAX_PEERS_SENT).map(([, pid, p]) => [pid, p]),
    }));
  }
}, TICK_MS);

console.log(`otra.city presence on :${PORT} (cap ${HARD_CAP}, interest ${INTEREST_M} m, nearest ${MAX_PEERS_SENT})`);
