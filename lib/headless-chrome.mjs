// Minimal headless-Chrome driver over the DevTools protocol.
//
// The city renders its own images (posters today, dry-run previews next), and
// the only renderer that can be trusted to agree with what a visitor sees is
// the client itself. So instead of a second three.js pipeline in Node — which
// would drift from the city the first time a tone-mapping constant moved —
// we drive the real page in a real browser.
//
// Why not Playwright/Puppeteer: this needs "navigate, evaluate, screenshot"
// and nothing else, `ws` is already a dependency, and the browser we want is
// the one already on the machine. GitHub's runners ship Google Chrome, so CI
// gets H.264 too — a bundled Chromium has no proprietary codecs and would
// render every video screen as a black rectangle.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';

const CANDIDATES = process.platform === 'darwin'
  ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
     '/Applications/Chromium.app/Contents/MacOS/Chromium']
  : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/opt/google/chrome/chrome',
     '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium'];

export function findChrome() {
  const explicit = process.env.OTRA_CHROME;
  if (explicit) return existsSync(explicit) ? explicit : null;
  return CANDIDATES.find((p) => existsSync(p)) || null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Chrome writes the port it actually bound to into the profile directory —
// more reliable than scraping stderr, which is chatty and format-unstable.
async function readEndpoint(profile, child, timeoutMs) {
  const file = join(profile, 'DevToolsActivePort');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`chrome exited (${child.exitCode}) before listening`);
    if (existsSync(file)) {
      const [port, path] = readFileSync(file, 'utf8').split('\n');
      if (port && path) return `ws://127.0.0.1:${port.trim()}${path.trim()}`;
    }
    await sleep(50);
  }
  throw new Error('chrome never wrote DevToolsActivePort');
}

function rpc(url) {
  const ws = new WebSocket(url, { maxPayload: 256 << 20 });
  const pending = new Map();
  const listeners = new Set();
  let nextId = 1;
  const ready = new Promise((res, rej) => {
    ws.once('open', res);
    ws.once('error', rej);
  });
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(`${msg.error.message} (${msg.error.code})`)) : resolve(msg.result);
    } else if (msg.method) {
      for (const fn of listeners) fn(msg);
    }
  });
  ws.on('close', () => {
    for (const { reject } of pending.values()) reject(new Error('devtools socket closed'));
    pending.clear();
  });
  return {
    ready,
    send(method, params = {}, sessionId, timeoutMs = 120000) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`${method} did not answer within ${timeoutMs} ms`));
        }, timeoutMs);
        const done = (fn) => (v) => { clearTimeout(timer); fn(v); };
        pending.set(id, { resolve: done(resolve), reject: done(reject) });
        ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      });
    },
    once(method, sessionId, timeoutMs = 30000) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { listeners.delete(fn); reject(new Error(`timed out waiting for ${method}`)); }, timeoutMs);
        const fn = (msg) => {
          if (msg.method !== method || (sessionId && msg.sessionId !== sessionId)) return;
          clearTimeout(timer);
          listeners.delete(fn);
          resolve(msg.params);
        };
        listeners.add(fn);
      });
    },
    onEvent(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    close() { try { ws.close(); } catch { /* already gone */ } },
  };
}

// One browser, one tab, reused across renders: launching Chrome costs about a
// second and a warm GPU process is most of the render budget.
// gpu: true drops the software-renderer flags (and the frame-rate cap) so a
// benchmark on a real machine measures a real GPU; CI keeps SwiftShader.
export async function launchChrome({ width = 1536, height = 864, timeoutMs = 30000, args = [], gpu = false } = {}) {
  const bin = findChrome();
  if (!bin) {
    throw new Error('no Chrome found — install Google Chrome or set OTRA_CHROME to its binary');
  }
  const profile = mkdtempSync(join(tmpdir(), 'otra-chrome-'));
  // detached so the browser leads its own process group: killing the parent
  // alone leaves Chrome's half-dozen helpers (and a ~130 MB profile) behind
  // when a run is interrupted, which is how a laptop ends up with strays from
  // a render that was Ctrl-C'd hours earlier.
  const child = spawn(bin, [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    `--window-size=${width},${height}`,
    // software WebGL: runners have no GPU, and a poster must not depend on one
    ...(gpu ? ['--disable-frame-rate-limit', '--disable-gpu-vsync'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']),
    '--hide-scrollbars', '--mute-audio', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking', '--disable-sync',
    '--no-sandbox',            // CI containers run as root; the pages are ours
    '--autoplay-policy=no-user-gesture-required',
    // Caller flags last, so a harness can add what it needs (blocking every
    // off-box host, say) without the poster path ever seeing them.
    ...args,
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'], detached: true });
  let stderr = '';
  child.stderr.on('data', (b) => { stderr = (stderr + b).slice(-4000); });

  // Synchronous teardown, safe to call twice, wired to the ways a process
  // actually ends. Everything here must be sync: an 'exit' handler cannot
  // await, and an async cleanup is exactly why the strays survived.
  let torn = false;
  const teardown = () => {
    if (torn) return;
    torn = true;
    try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* gone */ } }
    // Retries cover a helper process still flushing as we walk the tree; the
    // catch matters because an exception here would abandon the rest of the
    // 'exit' handler chain, ours and everybody else's.
    try { rmSync(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 25 }); } catch { /* gone */ }
  };
  // 128 + signal number, so the exit status still reads as "killed by that
  // signal". SIGHUP is in here because closing a terminal on a running render
  // strands a browser exactly the way a Ctrl-C does.
  const CODES = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 };
  const onSignal = (sig) => { teardown(); process.exit(CODES[sig]); };
  const onSigint = () => onSignal('SIGINT');
  const onSigterm = () => onSignal('SIGTERM');
  const onSighup = () => onSignal('SIGHUP');
  // Removed again in close(), because the poster renderer relaunches the
  // browser on retry and would otherwise stack a listener set per launch.
  process.on('exit', teardown);
  process.on('SIGINT', onSigint);
  process.on('SIGTERM', onSigterm);
  process.on('SIGHUP', onSighup);
  const unhook = () => {
    process.off('exit', teardown);
    process.off('SIGINT', onSigint);
    process.off('SIGTERM', onSigterm);
    process.off('SIGHUP', onSighup);
  };

  let conn;
  try {
    conn = rpc(await readEndpoint(profile, child, timeoutMs));
    await conn.ready;
  } catch (e) {
    teardown();
    unhook();
    throw new Error(`${e.message}${stderr ? `\n--- chrome stderr ---\n${stderr}` : ''}`);
  }

  const { targetId } = await conn.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await conn.send('Target.attachToTarget', { targetId, flatten: true });
  await conn.send('Page.enable', {}, sessionId);
  await conn.send('Runtime.enable', {}, sessionId);
  // The window size above sizes the OS window; this pins the CSS viewport, so
  // innerWidth/innerHeight (and therefore the canvas) are exactly 16:9.
  await conn.send('Emulation.setDeviceMetricsOverride',
    { width, height, deviceScaleFactor: 1, mobile: false }, sessionId);

  const evaluate = async (expression, { timeoutMs: t = 60000 } = {}) => {
    const r = await conn.send('Runtime.evaluate', {
      expression, awaitPromise: true, returnByValue: true, timeout: t,
    }, sessionId, t + 5000);
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error(`page error: ${d.exception?.description || d.text}`);
    }
    return r.result.value;
  };

  return {
    evaluate,
    async goto(url, { timeoutMs: t = 90000 } = {}) {
      const loaded = conn.once('Page.loadEventFired', sessionId, t);
      await conn.send('Page.navigate', { url }, sessionId, t);
      await loaded;
    },
    // Composited by the browser, not read back from the canvas: the city's
    // renderer has no preserveDrawingBuffer, so a canvas readback there only
    // yields pixels in the same synchronous turn as a render — and the HUD, the
    // offer pill and the touch stick are DOM that no canvas capture can show.
    async screenshot({ format = 'png', quality, clip, timeoutMs: t = 60000 } = {}) {
      const { data } = await conn.send('Page.captureScreenshot', {
        format,
        ...(quality != null ? { quality } : {}),
        ...(clip ? { clip } : {}),
        captureBeyondViewport: false,
      }, sessionId, t);
      return Buffer.from(data, 'base64');
    },
    // Console output is the only window into a page that failed silently.
    onConsole(fn) {
      return conn.onEvent((msg) => {
        if (msg.sessionId !== sessionId) return;
        if (msg.method === 'Runtime.consoleAPICalled') {
          fn(msg.params.type, msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
        } else if (msg.method === 'Runtime.exceptionThrown') {
          fn('error', msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
        }
      });
    },
    async close() {
      if (torn) return;
      try { conn.close(); } catch { /* already gone */ }
      // An already-exited child never emits 'exit' again, so waiting on a
      // browser that died under us — a crash, or a teardown that already ran —
      // would hang the run rather than end it.
      const exited = child.exitCode === null && child.signalCode === null
        ? new Promise((r) => child.once('exit', r))
        : Promise.resolve();
      teardown();
      await exited;
      unhook();
    },
  };
}
