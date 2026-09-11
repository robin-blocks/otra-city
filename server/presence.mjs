// otra.city presence server — the simplest thing that works.
// One process, one room (one street segment), JSON over WebSocket.
//
//   node server/presence.mjs           # listens on :8787 (PORT env to change)
//
// Protocol: client sends {t:'pos', p:[x,y,z,yaw]} at ~10 Hz, optionally with
// observe:true — a broadcast camera, which receives peers but is never sent
// to anyone as one. A camera also says so in its connect URL (?observe=1),
// because the cap has to be decided before the first message arrives.
// Every 100 ms the server sends each client its nearest peers only:
// {t:'peers', peers: [[id, [x,y,z,yaw]], ...]} — capped and range-limited, so
// per-client bandwidth is bounded no matter how many people are in the city.
// Over HARD_CAP concurrent, new joiners get {t:'full'} (they run solo).
//
// Cameras are counted separately and admitted separately. RFL's Twitch channel
// is a continuous capture of /broadcast, and being turned away at the door on
// a busy night would empty the stands of the stream at exactly the moment they
// were worth showing. There are never many cameras, so OBSERVER_CAP is small
// and its own — a flood of them can no more fill the city than fill the room.
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
const OBSERVER_CAP = 8;     // broadcast cameras, admitted past HARD_CAP

const clients = new Map(); // ws -> {id, p:[x,y,z,yaw], dirty}
const wss = new WebSocketServer({ port: PORT });

wss.on('connection', (ws, req) => {
  // A camera declares itself in the URL so the decision can be made here, at
  // the door, rather than after its first position message.
  let observe = false;
  try { observe = new URL(req?.url || '/', 'http://x').searchParams.get('observe') === '1'; } catch { /* not a camera */ }
  const observers = [...clients.values()].filter((c) => c.observe).length;
  const full = observe ? observers >= OBSERVER_CAP : clients.size - observers >= HARD_CAP;
  if (full) {
    ws.send(JSON.stringify({ t: 'full' }));
    ws.close();
    return;
  }
  const id = randomBytes(4).toString('hex');
  clients.set(ws, { id, p: [0, 0, 0, 0], observe });
  ws.send(JSON.stringify({ t: 'hi', id }));
  ws.on('message', (data) => {
    if (data.length > 200) return;
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    if (msg.t === 'pos' && Array.isArray(msg.p) && msg.p.length === 4 &&
        msg.p.every((v) => typeof v === 'number' && Number.isFinite(v))) {
      const me = clients.get(ws);
      me.p = msg.p;
      // A broadcast camera reports where it is looking so interest management
      // can pick the visitors near it, but it is not a citizen: nobody should
      // see an avatar standing on the pitch for the whole match. Still read
      // here so a client that predates the URL flag keeps working — but it
      // can only ever SET the flag: a camera admitted past the house cap must
      // not be able to turn itself into a citizen and put the room over it.
      if (msg.observe === true) me.observe = true;
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
      if (ows === ws || other.observe) continue;
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

console.log(`otra.city presence on :${PORT} (cap ${HARD_CAP} + ${OBSERVER_CAP} cameras, interest ${INTEREST_M} m, nearest ${MAX_PEERS_SENT})`);
