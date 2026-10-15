// ================================================================= RIVAL
// An AI wingsuit pilot races you down the line, from the exit to the last gate.
// It runs the very same physics and autopilot as the player: its own flight
// state, autopilot memory, visual state, pilot and canopy are swapped in for
// each step and each frame.
const RACE_BONUS = 1000;
const CUTAWAY_BONUS = 500;
const RIVAL_DELAY = 1.5;   // the rival jumps this long after you
// a finish closer than the tenth of a second the results show goes to you: never "lost by 0.0 s"
const RACE_TIE = 0.05;
function raceWon(me, it) { return me >= 0 && (it < 0 || me < it + RACE_TIE); }
const RIVAL = {
  on: false,
  sim: makeSim(), inp: makeInput(), vis: null,
  // nudged onto the gate centres so it rarely misses one, but no jetpack and a floaty, slower line:
  // a clean flight (or a few jetpack bursts) beats it
  auto: { on: false, gate: 0, hold: null, cT: 0, nudge: true, jetV: 0, pace: 0.2 },
  jumper: null, canopy: null, trail: null,
  next: 0, gates: 0, t0: 0, jumpT: -1, finishT: -1, out: false, lead: 0, hudT: 0,
};
RIVAL.sim.forceAssist = true;   // the rival always flies with the assist, so it rarely just dies

function asRival(fn) {
  const s = SIM, a = AUTO, v = VIS, j = JUMPER, c = CANOPY;
  SIM = RIVAL.sim; AUTO = RIVAL.auto; VIS = RIVAL.vis; JUMPER = RIVAL.jumper; CANOPY = RIVAL.canopy;
  try { return fn(); } finally { SIM = s; AUTO = a; VIS = v; JUMPER = j; CANOPY = c; }
}
function buildRival() {
  RIVAL.vis = makeVis();
  RIVAL.jumper = new Jumper(LOOK_RIVAL);
  R.scene.add(RIVAL.jumper.root);
  RIVAL.canopy = new Canopy(LOOK_RIVAL.canopy);
  RIVAL.canopy.add(R.scene);
  RIVAL.trail = buildTrail(0xff8c8c);
  showRival(false);
}
function showRival(on) {
  RIVAL.jumper.root.visible = on;
  RIVAL.trail.mesh.visible = on;
  if (!on) RIVAL.canopy.visible(false);
}
// the rival stands on the exit ledge a couple of metres to the player's side
function resetRival() {
  RIVAL.on = SETTINGS.race && GAME.state === 'play';
  const E = TC.EXIT, f = headingVec(E.heading, new THREE.Vector3());
  const x = E.x - f.z * 2.4, z = E.z + f.x * 2.4;
  resetSim(RIVAL.sim, x, Math.max(R.exitY, surfaceHeight(x, z)) + 0.93, z, E.heading);
  Object.assign(RIVAL.auto, { gate: 0, hold: null, cT: 0 });
  Object.assign(RIVAL.inp, makeInput());
  Object.assign(RIVAL, { next: 0, gates: 0, t0: 0, jumpT: -1, finishT: -1, out: false, lead: 0, hudT: 0 });
  RIVAL.trail.pts.length = 0;
  asRival(() => computeVis(0, RIVAL.inp));
  showRival(RIVAL.on);
  $('raceline').hidden = !RIVAL.on;
}
function rivalJump() {
  const s = RIVAL.sim;
  s.phase = 'exit'; s.phaseT = 0; s.inflate = 0;
  headingVec(s.heading, s.vel).multiplyScalar(6.2);
  s.vel.y = 2.0;
}
// once per frame, like the player's controls
function rivalControl(dt) {
  if (!RIVAL.on) return;
  if (RIVAL.jumpT > 0) { RIVAL.jumpT -= dt; if (RIVAL.jumpT <= 0) rivalJump(); }
  asRival(() => autopilot(RIVAL.inp, R.gates, dt));
}
// once per physics step, right after the player's
function rivalStep(h) {
  if (!RIVAL.on) return;
  const clock = SIM.time - RIVAL.t0;   // race time runs from the player's jump
  const n0 = EVENTS.length;
  asRival(() => {
    physicsStep(h, RIVAL.inp);
    const s = SIM;
    if (s.phase !== 'fly' && s.phase !== 'exit') return;
    const g = R.gates[RIVAL.next];
    if (g) {
      const r = ringCross(g, s.prev, s.pos);
      if (r >= 0 && r < g.r * 5) { if (r <= g.r + 1.2) RIVAL.gates++; RIVAL.next++; }
    }
    if (AUTO.gate > RIVAL.next) RIVAL.next = AUTO.gate;   // never lag behind the autopilot's own count
    for (const b of R.boosts) {
      if (b.rival) continue;
      const r = ringCross(b, s.prev, s.pos);
      if (r >= 0 && r <= b.r + 1.5) { b.rival = true; applyBoost(s); }
    }
  });
  const live = GAME.state === 'play';
  for (const e of EVENTS.splice(n0)) {
    if (e.type === 'crash' && !RIVAL.out) { RIVAL.out = true; if (live && GAME.raceT < 0) callout(i18n('callout.rivalcrash'), 'gold', true); }
  }
  if (RIVAL.finishT < 0 && !RIVAL.out && RIVAL.next >= R.gates.length) {
    RIVAL.finishT = clock;
    if (live && GAME.raceT < 0) callout(i18n('callout.rivalfinish'), 'orange', true);
  }
}
function rivalVisual(dt) {
  const show = RIVAL.on && (GAME.state === 'play' || GAME.state === 'result');
  if (RIVAL.jumper.root.visible !== show) showRival(show);
  if (!show) return;
  asRival(() => { computeVis(dt, RIVAL.inp); applyVis(dt, false); });
}

// ------------------------------------------------------------ race standing
let RACE_LINE = null, RACE_LINE_OF = null;
// the flight line (exit, gates, landing) with the distance flown along it at each point
function raceLine() {
  if (RACE_LINE_OF === R.gates) return RACE_LINE;
  const pts = [{ x: TC.EXIT.x, z: TC.EXIT.z }, ...R.gates.map((g) => ({ x: g.x, z: g.z })), { x: TC.LZ.x, z: TC.LZ.z }];
  let cum = 0;
  pts.forEach((p, i) => { if (i) cum += Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z); p.cum = cum; });
  RACE_LINE = pts; RACE_LINE_OF = R.gates;
  return pts;
}
// how far along the line a position is
function lineProgress(p) {
  const L = raceLine();
  let best = 1e18, prog = 0;
  for (let i = 0; i < L.length - 1; i++) {
    const a = L[i], b = L[i + 1];
    const dx = b.x - a.x, dz = b.z - a.z, len2 = Math.max(1, dx * dx + dz * dz);
    const t = clamp(((p.x - a.x) * dx + (p.z - a.z) * dz) / len2, 0, 1);
    const ex = a.x + dx * t - p.x, ez = a.z + dz * t - p.z, d = ex * ex + ez * ez;
    if (d < best) { best = d; prog = a.cum + Math.sqrt(len2) * t; }
  }
  return prog;
}
function raceResult() {
  if (!RIVAL.on) return { on: false, won: false, margin: -1 };
  const me = GAME.raceT, it = RIVAL.finishT;
  const won = raceWon(me, it);
  // a dead heat reads as a plain win
  const margin = me >= 0 && it >= 0 && Math.abs(it - me) >= RACE_TIE ? Math.abs(it - me) : -1;
  return { on: true, won, margin };
}
function updateRaceHud() {
  if (!RIVAL.on) return;
  const el = $('race');
  let txt, cls = '';
  const me = GAME.raceT, it = RIVAL.finishT;
  if (me >= 0) {
    const won = raceWon(me, it);
    txt = i18n(won ? 'race.first' : 'race.second') + (it >= 0 && Math.abs(it - me) >= RACE_TIE ? ` · ${won ? '−' : '+'}${Math.abs(it - me).toFixed(1)} s` : '');
    cls = won ? 'ahead' : 'behind';
  } else if (it >= 0) { txt = i18n('race.second'); cls = 'behind'; }
  else if (RIVAL.out) { txt = i18n('race.out'); cls = 'ahead'; }
  else if (SIM.phase === 'ready') txt = '–';
  else {
    const gap = lineProgress(SIM.pos) - lineProgress(RIVAL.sim.pos);
    txt = `${gap >= 0 ? '+' : '−'}${Math.round(Math.abs(gap))} m`;
    cls = gap >= 0 ? 'ahead' : 'behind';
    // overtakes, with some hysteresis so a side-by-side duel doesn't spam
    const flying = SIM.phase === 'fly' && RIVAL.sim.phase === 'fly';
    if (flying && gap > 20 && RIVAL.lead <= 0) { if (RIVAL.lead < 0) callout(i18n('callout.overtook'), 'lake', true); RIVAL.lead = 1; }
    else if (flying && gap < -20 && RIVAL.lead >= 0) { if (RIVAL.lead > 0) callout(i18n('callout.passed'), 'red', true); RIVAL.lead = -1; }
  }
  if (el.textContent !== txt) el.textContent = txt;
  if (el.className !== cls) el.className = cls;
}
// a label over the rival so you can find it in the sky
const _rt = new THREE.Vector3();
function rivalTag(cam) {
  const el = $('rivaltag');
  const V = RIVAL.vis;
  let on = RIVAL.on && GAME.state === 'play' && !GAME.paused && V.phase !== 'ready';
  const d = on ? cam.position.distanceTo(V.pos) : 0;
  if (on && d > 8 && d < 2500) {
    _rt.copy(V.pos); _rt.y += 1.6 + d * 0.012;
    _rt.applyMatrix4(cam.matrixWorldInverse);
    if (_rt.z < -1) {
      _rt.applyMatrix4(cam.projectionMatrix);
      const W = window.innerWidth, H = window.innerHeight;
      const x = (_rt.x * 0.5 + 0.5) * W, y = (0.5 - _rt.y * 0.5) * H;
      if (x > -50 && x < W + 50 && y > -30 && y < H + 30) {
        el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
        setText('rivald', fmtDist(d));
      } else on = false;
    } else on = false;
  } else on = false;
  if (el.classList.contains('on') !== on) el.classList.toggle('on', on);
}

// --------------------------------------------------------- cut-away canopy
// After a cutaway the main canopy flies off on its own: it drifts with the wind,
// sinks, tumbles and deflates, and ends up crumpled on the ground.
const FREE = { on: false, t: 0, canopy: null, pos: new THREE.Vector3(), vel: new THREE.Vector3(), quat: new THREE.Quaternion(), axis: new THREE.Vector3() };
const _fq = new THREE.Quaternion(), _fa = new THREE.Vector3(), _fb = new THREE.Vector3();
function spawnFreeCanopy() {
  FREE.on = true; FREE.t = 0;
  FREE.pos.copy(VIS.canopyOn ? VIS.canopyPos : SIM.pos);
  FREE.quat.copy(VIS.canopyQuat);
  // freed of the pilot's weight it surges forward and up for a moment
  FREE.vel.copy(SIM.vel).multiplyScalar(0.8); FREE.vel.y = 2.5;
  FREE.axis.set(Math.random() - 0.5, 0.2, Math.random() - 0.5).normalize();
  FREE.canopy.visible(true);
}
function updateFreeCanopy(dt) {
  if (!FREE.on) return;
  FREE.t += dt;
  const ground = surfaceHeight(FREE.pos.x, FREE.pos.z) + 0.6;
  const down = FREE.pos.y <= ground;
  if (!down) {
    _fa.set(WIND.x, -3.4, WIND.z);
    FREE.vel.lerp(_fa, 1 - Math.exp(-dt * 0.8));
    FREE.pos.addScaledVector(FREE.vel, dt);
    FREE.quat.premultiply(_fq.setFromAxisAngle(FREE.axis, dt * 0.7 * smoothstep(0.5, 3, FREE.t))).normalize();
  } else FREE.pos.y = ground;
  const C = FREE.canopy;
  C.group.position.copy(FREE.pos);
  C.group.quaternion.copy(FREE.quat);
  C.shape(down ? 0.3 : lerp(1, 0.35, smoothstep(0, 5, FREE.t)), 0.3, 0.3, U.uTime.value);
  C.group.updateMatrixWorld(true);
  // the risers dangle under it
  const sway = Math.sin(FREE.t * 1.7) * 1.2;
  _fb.copy(FREE.pos); _fb.x += sway; _fb.y -= down ? 0.2 : 5.5; _fb.z += sway * 0.6;
  C.updateLines(_fb, _fb, _fb, _fb);
  const cu = _fa.set(0, 1, 0).applyQuaternion(FREE.quat);
  C.pc.position.copy(FREE.pos).addScaledVector(cu, 0.6);
  C.pc.quaternion.setFromUnitVectors(WORLD_UP, cu);
  C.pc.scale.setScalar(0.55);
  const b = C.bridle.geometry.attributes.position.array;
  b[0] = FREE.pos.x; b[1] = FREE.pos.y; b[2] = FREE.pos.z; b[3] = C.pc.position.x; b[4] = C.pc.position.y; b[5] = C.pc.position.z;
  C.bridle.geometry.attributes.position.needsUpdate = true;
  if (FREE.t > 90) { FREE.on = false; C.visible(false); }
}
