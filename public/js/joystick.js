// Fixed virtual thumbstick for touch devices. Pointer Events with capture, so
// a thumb that drifts off the base keeps steering until it lifts. Reports a
// unit-disc vector (x right, y forward) — the player reads it like WASD.
export function createJoystick(el, onChange) {
  const knob = el.querySelector('.knob');
  let id = null;
  let cx = 0, cy = 0;

  const reset = () => {
    id = null;
    knob.style.transform = '';
    onChange(0, 0);
  };

  const steer = (e) => {
    const R = el.clientWidth / 2;                 // full deflection = base radius
    let dx = (e.clientX - cx) / R;
    let dy = (e.clientY - cy) / R;
    const m = Math.hypot(dx, dy);
    if (m > 1) { dx /= m; dy /= m; }
    const travel = R - knob.clientWidth / 2;      // knob stays inside the ring
    knob.style.transform = `translate(${dx * travel}px, ${dy * travel}px)`;
    onChange(dx, -dy);
  };

  el.addEventListener('pointerdown', (e) => {
    if (id !== null) return;                      // one thumb at a time
    id = e.pointerId;
    try { el.setPointerCapture(id); } catch { /* synthetic pointer: no capture */ }
    const r = el.getBoundingClientRect();
    cx = r.left + r.width / 2;
    cy = r.top + r.height / 2;
    el.classList.add('active');
    steer(e);
    e.preventDefault();
  });
  el.addEventListener('pointermove', (e) => { if (e.pointerId === id) steer(e); });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    el.addEventListener(type, (e) => {
      if (e.pointerId !== id) return;
      el.classList.remove('active');
      reset();
    });
  }
  addEventListener('blur', () => { if (id !== null) { el.classList.remove('active'); reset(); } });
}
