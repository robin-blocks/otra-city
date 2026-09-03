// Session-based multiplayer presence — no accounts, no chat, just citizens.
// The client sends its quantized position at 10 Hz; the server returns the
// nearest peers only (interest management server-side); this module renders
// at most MAX_RENDERED of them, interpolated. If the server is unreachable
// the city simply runs solo — presence is an enhancement, never a dependency.
import * as THREE from 'three';
import { createAvatar } from './avatar.js';

const SEND_HZ = 10;
const MAX_RENDERED = 32;
const LERP_MS = 130;

const ACCENTS = [0x47f2ff, 0xff2d95, 0xffd23e, 0x7dffa8, 0xa78bff, 0xff8c5a, 0x9fd8ff, 0xff5d8f];

/**
 * `opts.maxRendered` caps how many peers this client draws (default 32 — the
 * same number the server sends). `opts.observe` marks this client as a camera
 * rather than a citizen: it still reports a position, because that is how the
 * server decides which peers are near enough to matter, but it asks not to be
 * shown to anyone else. A server that predates the flag simply ignores it and
 * the observer appears as an ordinary visitor.
 */
export function createPresence(scene, player, urlOverride, opts = {}) {
  const maxRendered = opts.maxRendered ?? MAX_RENDERED;
  const observe = !!opts.observe;
  const peers = new Map(); // id -> {avatar, from, to, t0, speed, yaw}
  let ws = null;
  let connected = false;
  let lastSend = 0;
  let sendBuf = '';

  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  const url = urlOverride ||                         // ?ws= override, for testing
    (local ? `ws://${location.hostname}:8787`        // local dev server
           : 'wss://otra-city-presence.fly.dev');    // production

  function addPeer(id, p) {
    if (peers.has(id)) return peers.get(id);
    const accent = ACCENTS[Math.abs([...id].reduce((a, c) => a * 31 + c.charCodeAt(0), 7)) % ACCENTS.length];
    const avatar = createAvatar(accent);
    avatar.group.position.set(p[0], p[1], p[2]);
    avatar.group.rotation.y = p[3];
    scene.add(avatar.group);
    const peer = { avatar, from: [...p], to: [...p], t0: performance.now(), speed: 0 };
    peers.set(id, peer);
    return peer;
  }

  function dropPeer(id) {
    const peer = peers.get(id);
    if (!peer) return;
    scene.remove(peer.avatar.group);
    peers.delete(id);
  }

  function connect() {
    try {
      ws = new WebSocket(url);
    } catch {
      return; // solo city
    }
    ws.onopen = () => { connected = true; };
    ws.onclose = () => {
      connected = false;
      for (const id of [...peers.keys()]) dropPeer(id);
      setTimeout(connect, 5000 + Math.random() * 5000);
    };
    ws.onerror = () => ws.close();
    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.t === 'peers') {
        const seen = new Set();
        for (const [id, p] of msg.peers.slice(0, maxRendered)) {
          seen.add(id);
          const peer = addPeer(id, p);
          peer.from = [
            peer.avatar.group.position.x, peer.avatar.group.position.y,
            peer.avatar.group.position.z, peer.avatar.group.rotation.y];
          peer.to = p;
          peer.t0 = performance.now();
          peer.speed = Math.hypot(p[0] - peer.from[0], p[2] - peer.from[2]) * SEND_HZ;
        }
        for (const id of [...peers.keys()]) if (!seen.has(id)) dropPeer(id);
      } else if (msg.t === 'full') {
        ws.close(); // over capacity: run solo, retry later
      }
    };
  }
  connect();

  function update(dt, time) {
    // send own position at 10 Hz when it changed
    const now = performance.now();
    if (connected && ws.readyState === 1 && now - lastSend > 1000 / SEND_HZ) {
      const p = player.pos;
      const yaw = player.avatar.group.rotation.y;
      const buf = JSON.stringify({ t: 'pos', p: [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2), +yaw.toFixed(2)],
        ...(observe ? { observe: true } : {}) });
      if (buf !== sendBuf) {
        ws.send(buf);
        sendBuf = buf;
      }
      lastSend = now;
    }
    // interpolate peers
    for (const peer of peers.values()) {
      const k = Math.min((now - peer.t0) / LERP_MS, 1);
      const g = peer.avatar.group;
      g.position.set(
        peer.from[0] + (peer.to[0] - peer.from[0]) * k,
        peer.from[1] + (peer.to[1] - peer.from[1]) * k,
        peer.from[2] + (peer.to[2] - peer.from[2]) * k);
      let dy = peer.to[3] - peer.from[3];
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      g.rotation.y = peer.from[3] + dy * k;
      peer.avatar.update(dt, k < 1 ? peer.speed : 0, time);
    }
  }

  return {
    update,
    get count() { return peers.size; },
    get maxRendered() { return maxRendered; },
    get connected() { return connected; },
    // Live peer positions, for the systems that should react to any visitor
    // rather than only to the one at this keyboard (doors, today).
    get positions() { return [...peers.values()].map((p) => p.avatar.group.position); },
  };
}
