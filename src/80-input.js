// ================================================================= INPUT
const KEYS = new Set();
const IN = {
  pitch: 0, roll: 0, bl: 0, br: 0,
  joy: { id: null, ox: 0, oy: 0, x: 0, y: 0 },
  actionHeld: false, touchAction: false,
  gpPrev: [],
};
function initInput(onKey, onAction) {
  const block = ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
  window.addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
    if (block.includes(e.code)) e.preventDefault();
    if (e.repeat) return;
    KEYS.add(e.code);
    onKey(e.code, e);
  });
  window.addEventListener('keyup', (e) => { KEYS.delete(e.code); if (e.code === 'Space') IN.actionHeld = false; });
  window.addEventListener('blur', () => { KEYS.clear(); IN.actionHeld = false; });
  // touch joystick (left half)
  const zone = $('joyzone'), knob = $('joyknob'), base = $('joybase');
  const R0 = 52;
  const setKnob = () => { knob.style.transform = `translate(${IN.joy.x * R0}px, ${IN.joy.y * R0}px)`; };
  zone.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const t = e.changedTouches[0];
    IN.joy.id = t.identifier; IN.joy.ox = t.clientX; IN.joy.oy = t.clientY; IN.joy.x = IN.joy.y = 0;
    base.style.left = (t.clientX - 64) + 'px'; base.style.top = (t.clientY - 64) + 'px';
    base.classList.add('on'); setKnob();
  }, { passive: false });
  zone.addEventListener('touchmove', (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) if (t.identifier === IN.joy.id) {
      let dx = (t.clientX - IN.joy.ox) / R0, dy = (t.clientY - IN.joy.oy) / R0;
      const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; }
      IN.joy.x = dx; IN.joy.y = dy; setKnob();
    }
  }, { passive: false });
  const end = (e) => { for (const t of e.changedTouches) if (t.identifier === IN.joy.id) { IN.joy.id = null; IN.joy.x = IN.joy.y = 0; base.classList.remove('on'); setKnob(); } };
  zone.addEventListener('touchend', end); zone.addEventListener('touchcancel', end);
  const act = $('btnact');
  act.addEventListener('touchstart', (e) => { e.preventDefault(); IN.touchAction = true; onAction(); }, { passive: false });
  act.addEventListener('touchend', (e) => { e.preventDefault(); IN.touchAction = false; }, { passive: false });
  act.addEventListener('mousedown', () => { IN.touchAction = true; onAction(); });
  act.addEventListener('mouseup', () => { IN.touchAction = false; });
}
function axisRamp(cur, target, dt) {
  const rate = Math.abs(target) > Math.abs(cur) && Math.sign(target) === Math.sign(cur || target) ? 3.2 : 6.5;
  const d = target - cur, m = rate * dt;
  return cur + (d > m ? m : d < -m ? -m : d);
}
function pollGamepad(onButton) {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const gp of pads) {
    if (!gp || !gp.connected) continue;
    const dz = (v) => (Math.abs(v) < 0.14 ? 0 : (v - Math.sign(v) * 0.14) / 0.86);
    const res = { x: dz(gp.axes[0] || 0), y: dz(gp.axes[1] || 0), lt: gp.buttons[6] ? gp.buttons[6].value : 0, rt: gp.buttons[7] ? gp.buttons[7].value : 0, a: gp.buttons[0] && gp.buttons[0].pressed };
    gp.buttons.forEach((b, i) => { const was = IN.gpPrev[i]; if (b.pressed && !was) onButton(i); IN.gpPrev[i] = b.pressed; });
    return res;
  }
  return null;
}
// Build the control input for this frame
function readControls(dt, phase, gp) {
  const k = (a, b) => KEYS.has(a) || KEYS.has(b);
  const up = k('KeyW', 'ArrowUp'), down = k('KeyS', 'ArrowDown'), left = k('KeyA', 'ArrowLeft'), right = k('KeyD', 'ArrowRight');
  const inv = SETTINGS.invert ? -1 : 1;
  let tp = (down ? 1 : 0) - (up ? 1 : 0);
  let tr = (right ? 1 : 0) - (left ? 1 : 0);
  IN.pitch = axisRamp(IN.pitch, tp * inv, dt);
  IN.roll = axisRamp(IN.roll, tr, dt);
  let pitch = IN.pitch, roll = IN.roll;
  // touch joystick: drag down = flare / pull, up = dive
  if (IN.joy.id !== null) { pitch = IN.joy.y * inv; roll = IN.joy.x; }
  if (gp && (gp.x || gp.y)) { pitch = gp.y * inv; roll = gp.x; }
  INPUT.pitch = clamp(pitch, -1, 1);
  INPUT.roll = clamp(roll, -1, 1);
  // canopy toggles
  let bl = left ? 1 : 0, br = right ? 1 : 0;
  if (down || IN.actionHeld || IN.touchAction) { bl = 1; br = 1; }
  if (IN.joy.id !== null) {
    bl = clamp(-IN.joy.x, 0, 1); br = clamp(IN.joy.x, 0, 1);
    const fl = clamp(IN.joy.y, 0, 1) * (SETTINGS.invert ? 0 : 1);
    bl = Math.max(bl, fl); br = Math.max(br, fl);
    if (IN.touchAction) { bl = br = 1; }
  }
  if (gp) {
    bl = Math.max(bl, gp.lt, clamp(-gp.x, 0, 1) * 0.8, clamp(gp.y, 0, 1));
    br = Math.max(br, gp.rt, clamp(gp.x, 0, 1) * 0.8, clamp(gp.y, 0, 1));
    if (gp.a && phase === 'canopy') bl = br = 1;
  }
  IN.bl = damp(IN.bl, bl, 12, dt); IN.br = damp(IN.br, br, 12, dt);
  INPUT.brakeL = IN.bl; INPUT.brakeR = IN.br;
  if (phase === 'canopy') { INPUT.pitch = up ? -1 : 0; if (gp && gp.y < -0.5) INPUT.pitch = -1; if (IN.joy.id !== null && IN.joy.y < -0.5) INPUT.pitch = -1; }
}
