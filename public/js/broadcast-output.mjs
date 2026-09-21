// Optional second OUTPUT, not a second renderer, clock or programme.
// Copy the shared composited frame before the LIVE-only layer is added.
// No readPixels, PNG encoding, timers or streams unless a consumer asks.
export function createCleanOutput({ source, onError = () => {} }) {
  let active = null, last = null;

  function stop(reason = null) {
    if (!active) return;
    const output = active;
    active = null;
    output.status.active = false;
    output.status.error = reason;
    for (const stream of output.streams) for (const track of stream.getTracks()) track.stop();
    output.streams.clear();
    if (!output.status.copies) output.reject(new Error(reason || 'Clean output stopped before its first frame'));
    // Release the backing store. A restarted output has a NEW canvas/handle.
    output.canvas.width = output.canvas.height = 0;
    last = output.status;
  }

  function start() {
    if (active) return active.handle; // One shared output; starting twice is idempotent.
    const canvas = document.createElement('canvas');
    canvas.width = source.width;
    canvas.height = source.height;
    const context = canvas.getContext('2d', { alpha: false, colorSpace: 'srgb' });
    if (!context) throw new Error('Clean output requires a 2D canvas context');
    let resolve, reject;
    const ready = new Promise((yes, no) => { resolve = yes; reject = no; });
    // The consumer may attach its readiness handler later (or stop immediately).
    ready.catch(() => {});
    const status = { active: true, copies: 0, width: canvas.width, height: canvas.height, frame: null, error: null };
    const output = { canvas, context, status, streams: new Set(), resolve, reject, handle: null };
    const handle = {
      canvas,
      // Resolves after the first NORMAL programme draw, never by redrawing or stepping.
      ready,
      state: () => ({ ...status, frame: status.frame && { ...status.frame } }),
      captureStream(fps = 50) {
        if (active !== output) throw new Error('Clean output is stopped');
        if (!status.copies) throw new Error('Await clean output.ready before capturing');
        if (!Number.isFinite(fps) || fps <= 0 || fps > 60) throw new RangeError('Clean output fps must be > 0 and <= 60');
        // Native canvas capture samples this surface only. No independent scene
        // clock; fps is a ceiling on delivery, not a promise of renderer throughput.
        const stream = canvas.captureStream(fps);
        output.streams.add(stream);
        return stream;
      },
      stop() { if (active === output) stop(); },
    };
    output.handle = handle;
    active = output;
    return handle;
  }

  return {
    start,
    stop,
    get enabled() { return !!active; },
    state() {
      const s = active?.status || last;
      return s ? { ...s, frame: s.frame && { ...s.frame } } : { active: false, copies: 0, frame: null, error: null };
    },
    copy(frame) {
      if (!active) return false;
      try {
        if (source.width !== active.canvas.width || source.height !== active.canvas.height) {
          throw new Error('Broadcast drawing-buffer dimensions changed');
        }
        // Same size, same orientation, already tone mapped: no texture round trip.
        active.context.drawImage(source, 0, 0);
        active.status.copies += 1;
        active.status.frame = { ...frame };
        if (active.status.copies === 1) active.resolve(active.handle.state());
        return true;
      } catch (e) {
        const message = e.message || String(e);
        stop(message);
        // An optional recorder must never interrupt the live render/feed copy.
        onError(message);
        return false;
      }
    },
  };
}
