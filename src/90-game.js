// =================================================================== GAME
const PHASES = ['ready', 'exit', 'fly', 'deploy', 'canopy', 'landed', 'crashed'];
function GAME_STATE_IS_MENU() { return GAME.state === 'menu'; }
const GAME = {
  state: 'loading', paused: false,
  score: 0, proxPts: 0, gatePts: 0, mult: 1, streakT: 0, farT: 0, tier: 0, tierT: [0, 0, 0, 0],
  gatesPassed: 0, flightT: 0, maxSpeed: 0, dist: 0, lastPos: new THREE.Vector3(),
  best: store('best') || 0,
  rec: [], recT: 0, replay: null,
  attractT: 0, endT: -1, warn: 0, beepT: 0,
  hudT: 0, lastFrame: 0,
};
let JUMPER = null, CANOPY = null;
const VIS = {
  pos: new THREE.Vector3(), quat: new THREE.Quaternion(), fly: 0, hang: 0, roll: 0, pitch: 0, bl: 0, br: 0,
  canopyOn: false, infl: 0, canopyPos: new THREE.Vector3(), canopyQuat: new THREE.Quaternion(),
  pcOn: false, pcPos: new THREE.Vector3(), bridleFrom: new THREE.Vector3(),
  phase: 'ready', phaseT: 0, heading: 0, vel: new THREE.Vector3(), prox: 999, up: new THREE.Vector3(0, 1, 0),
  headPos: new THREE.Vector3(), canopyMid: new THREE.Vector3(), feet: new THREE.Vector3(), thrust: 0,
};
const _q0 = new THREE.Quaternion(), _q1 = new THREE.Quaternion(), _g1 = new THREE.Vector3(), _g2 = new THREE.Vector3(), _g3 = new THREE.Vector3(), _g4 = new THREE.Vector3(), _gm = new THREE.Matrix4();

// ------------------------------------------------------------ frames
function hangVector(heading, roll, pitch, out) {
  const f = headingVec(heading, _g1);
  const r = _g2.set(-f.z, 0, f.x);
  return out.set(0, 1, 0).addScaledVector(r, roll).addScaledVector(f, -pitch).normalize();
}
function bodyAlong(axis, heading, out) {
  // body vertical along 'axis' (head direction), back facing away from heading
  const f = headingVec(heading, _g1).negate();
  const back = _g2.copy(f).addScaledVector(axis, -f.dot(axis)).normalize();
  const right = _g3.crossVectors(axis, back).normalize();
  _gm.makeBasis(right, back, _g4.copy(axis).negate());
  return out.setFromRotationMatrix(_gm);
}
function canopyFrame(hv, heading, noseUp, out) {
  const f = headingVec(heading, _g1);
  const cf = _g2.copy(f).addScaledVector(hv, -f.dot(hv)).normalize();
  const ca = Math.cos(noseUp), sa = Math.sin(noseUp);
  const fwd = _g3.set(cf.x * ca + hv.x * sa, cf.y * ca + hv.y * sa, cf.z * ca + hv.z * sa);
  const up = _g4.set(hv.x * ca - cf.x * sa, hv.y * ca - cf.y * sa, hv.z * ca - cf.z * sa);
  const right = new THREE.Vector3().crossVectors(fwd, up).normalize();
  _gm.makeBasis(right, up, fwd.clone().negate());
  return out.setFromRotationMatrix(_gm);
}

// ------------------------------------------------------ visual state
function computeVis(dt) {
  const s = SIM;
  VIS.phase = s.phase; VIS.phaseT = s.phaseT; VIS.heading = s.heading; VIS.vel.copy(s.vel); VIS.prox = s.prox;
  VIS.pos.copy(s.pos);
  VIS.roll = damp(VIS.roll, s.phase === 'fly' ? INPUT.roll : 0, 8, dt);
  VIS.pitch = damp(VIS.pitch, s.phase === 'fly' ? INPUT.pitch : 0, 8, dt);
  VIS.bl = s.toggleL; VIS.br = s.toggleR;
  VIS.thrust = s.phase === 'canopy' ? s.thrust : 0;
  VIS.canopyOn = false; VIS.pcOn = false;
  switch (s.phase) {
    case 'ready':
      standQuat(s.heading, 0.03 + 0.015 * Math.sin(s.time * 1.2), VIS.quat);
      VIS.fly = 0; VIS.hang = 0; VIS.up.set(0, 1, 0);
      break;
    case 'exit': {
      const k = smoothstep(0, 1.15, s.phaseT);
      wingsuitQuat(_q1);
      standQuat(s.heading, 0.15 + k * 0.9, _q0);
      VIS.quat.copy(_q0).slerp(_q1, smoothstep(0.1, 1.15, s.phaseT));
      VIS.fly = smoothstep(0.05, 0.85, s.phaseT); VIS.hang = 0;
      VIS.up.copy(s.liftDir).lerp(WORLD_UP, 1 - k).normalize();
      break;
    }
    case 'fly':
      wingsuitQuat(VIS.quat); VIS.fly = 1; VIS.hang = 0; VIS.up.copy(s.liftDir);
      break;
    case 'deploy': {
      const d = s.deployT;
      wingsuitQuat(_q1);
      const hv = hangVector(s.heading, 0, 0, _g4.clone());
      bodyAlong(hv, s.heading, _q0);
      VIS.quat.copy(_q1).slerp(_q0, smoothstep(0.95, 2.1, d));
      VIS.fly = 1 - smoothstep(0.3, 1.4, d); VIS.hang = smoothstep(1.0, 2.2, d);
      VIS.up.copy(s.liftDir).lerp(WORLD_UP, smoothstep(0.9, 2.2, d)).normalize();
      // pilot chute, bag, lines, inflation
      const vhat = _g1.copy(s.vel).normalize();
      const bodyUp = new THREE.Vector3(0, 1, 0).applyQuaternion(_q1);
      const cont = VIS.bridleFrom.copy(s.pos).addScaledVector(bodyUp, 0.18);
      if (d > 0.12) {
        VIS.pcOn = true;
        const e = smoothstep(0.12, 0.55, d);
        VIS.pcPos.copy(cont).addScaledVector(vhat, -lerp(0.6, 12, e)).addScaledVector(bodyUp, lerp(0.3, 2.2, e));
      }
      if (d > 0.35) {
        VIS.canopyOn = true;
        const e = smoothstep(0.35, 0.95, d);
        const trail = new THREE.Vector3().copy(cont).addScaledVector(vhat, -lerp(0.4, 6.8, e)).addScaledVector(bodyUp, lerp(0.2, 1.4, e));
        // trailing orientation: top facing back along the airflow
        const upT = vhat.clone().negate();
        const fT = bodyUp.clone().addScaledVector(upT, -bodyUp.dot(upT)).normalize();
        _gm.makeBasis(new THREE.Vector3().crossVectors(fT, upT), upT, fT.clone().negate());
        _q0.setFromRotationMatrix(_gm);
        const k = smoothstep(0.95, 2.35, d);
        const hvFly = hangVector(s.heading, 0, 0.05, new THREE.Vector3());
        const flyPos = new THREE.Vector3().copy(s.pos).addScaledVector(hvFly, 6.75);
        VIS.canopyPos.copy(trail).lerp(flyPos, k * k * (3 - 2 * k));
        canopyFrame(hvFly, s.heading, -0.08, _q1);
        VIS.canopyQuat.copy(_q0).slerp(_q1, k);
        VIS.infl = d < 0.95 ? 0.02 : Math.min(1, 0.02 + 0.98 * (1 - Math.pow(1 - smoothstep(0.95, 2.3, d), 2.2)));
        VIS.pcPos.lerp(new THREE.Vector3().copy(VIS.canopyPos).addScaledVector(vhat, -4).addScaledVector(WORLD_UP, 1.2), k);
      }
      break;
    }
    case 'canopy': {
      const hv = hangVector(s.heading, s.swingRoll, s.swingPitch, new THREE.Vector3());
      bodyAlong(hv, s.heading, VIS.quat);
      VIS.fly = 0; VIS.hang = 1; VIS.up.copy(WORLD_UP);
      VIS.canopyOn = true; VIS.infl = 1;
      VIS.canopyPos.copy(s.pos).addScaledVector(hv, 6.75);
      canopyFrame(hv, s.heading, -0.1 + (s.toggleL + s.toggleR) * 0.09, VIS.canopyQuat);
      VIS.pcOn = true;
      const cu = new THREE.Vector3(0, 1, 0).applyQuaternion(VIS.canopyQuat), cf = new THREE.Vector3(0, 0, -1).applyQuaternion(VIS.canopyQuat);
      VIS.pcPos.copy(VIS.canopyPos).addScaledVector(cu, 0.55).addScaledVector(cf, -3.1);
      VIS.bridleFrom.copy(VIS.canopyPos).addScaledVector(cu, 0.3).addScaledVector(cf, -0.2);
      break;
    }
    case 'landed': {
      const k = smoothstep(0, 2.2, s.phaseT);
      const L = s.landing || { kind: 'good' };
      standQuat(s.heading, 0, VIS.quat);
      VIS.fly = 0; VIS.hang = Math.max(0, 1 - k * 2); VIS.up.set(0, 1, 0);
      if (L.kind === 'water') VIS.pos.y -= 0.9;
      VIS.canopyOn = true;
      // the canopy sinks down in front of the pilot and settles on the grass
      const f = headingVec(s.heading, new THREE.Vector3());
      const hv = new THREE.Vector3(0, 1, 0);
      const fromP = new THREE.Vector3().copy(s.pos).addScaledVector(hv, 6.75);
      const toP = new THREE.Vector3().copy(s.pos).addScaledVector(f, 6.5);
      toP.y = surfaceHeight(toP.x, toP.z) + 0.5;
      if (L.kind === 'tree') { toP.copy(fromP); toP.y -= 3; }
      const kk = k * k * (3 - 2 * k);
      VIS.canopyPos.copy(fromP).lerp(toP, kk);
      VIS.canopyPos.y += Math.sin(Math.PI * k) * 1.2;
      canopyFrame(hv, s.heading, -0.1, _q0);
      canopyFrame(hv, s.heading, 0.05, _q1);
      VIS.canopyQuat.copy(_q0).slerp(_q1, kk);
      VIS.infl = lerp(1, 0.42, kk);
      VIS.bl = VIS.br = 0.2;
      break;
    }
    case 'crashed': {
      const f = headingVec(s.heading, _g1);
      const right = _g2.set(-f.z, 0, f.x);
      _gm.makeBasis(right, _g3.set(0, 1, 0), _g4.copy(f).negate());
      VIS.quat.setFromRotationMatrix(_gm);
      VIS.pos.y = surfaceHeight(s.pos.x, s.pos.z) + 0.18;
      VIS.fly = 0.35; VIS.hang = 0; VIS.up.set(0, 1, 0);
      break;
    }
  }
}

function applyVis(dt) {
  const J = JUMPER;
  J.root.position.copy(VIS.pos);
  J.root.quaternion.copy(VIS.quat);
  const P = J.pose;
  P.fly = VIS.fly; P.hang = VIS.hang; P.roll = VIS.roll; P.pitch = VIS.pitch; P.speed = VIS.vel.length(); P.brakeL = VIS.bl; P.brakeR = VIS.br; P.thrust = VIS.thrust;
  J.update(dt);
  J.root.updateMatrixWorld(true);
  VIS.headPos.copy(J.head.position); J.root.localToWorld(VIS.headPos);
  VIS.feet.set(0, 0.02, 0.95); J.root.localToWorld(VIS.feet);
  J.head.visible = !(camModeNow() === 1);
  const C = CANOPY;
  C.group.visible = VIS.canopyOn; C.lines.visible = VIS.canopyOn;
  if (VIS.canopyOn) {
    C.group.position.copy(VIS.canopyPos);
    C.group.quaternion.copy(VIS.canopyQuat);
    C.shape(VIS.infl, VIS.bl, VIS.br, U.uTime.value);
    C.group.updateMatrixWorld(true);
    const jj = J.J;
    const shL = new THREE.Vector3(-jj.sh.x, jj.sh.y + 0.12, jj.sh.z); J.root.localToWorld(shL);
    const shR = new THREE.Vector3(jj.sh.x, jj.sh.y + 0.12, jj.sh.z); J.root.localToWorld(shR);
    const haL = J.limbs.handL.position.clone(); J.root.localToWorld(haL);
    const haR = J.limbs.handR.position.clone(); J.root.localToWorld(haR);
    C.updateLines(shL, shR, haL, haR);
    VIS.canopyMid.copy(VIS.canopyPos).lerp(VIS.pos, 0.5);
  } else VIS.canopyMid.copy(VIS.pos);
  C.pc.visible = VIS.pcOn; C.bridle.visible = VIS.pcOn;
  if (VIS.pcOn) {
    C.pc.position.copy(VIS.pcPos);
    const dir = _g1.copy(VIS.pcPos).sub(VIS.bridleFrom);
    if (dir.lengthSq() > 1e-4) C.pc.quaternion.setFromUnitVectors(WORLD_UP, dir.normalize());
    const scale = VIS.phase === 'canopy' ? 0.55 : 1;
    C.pc.scale.setScalar(scale);
    const b = C.bridle.geometry.attributes.position.array;
    b[0] = VIS.bridleFrom.x; b[1] = VIS.bridleFrom.y; b[2] = VIS.bridleFrom.z; b[3] = VIS.pcPos.x; b[4] = VIS.pcPos.y; b[5] = VIS.pcPos.z;
    C.bridle.geometry.attributes.position.needsUpdate = true;
  }
  // analytic shadows on the terrain
  const ph = VIS.phase;
  const c0 = CASTERS.c0.value, c1 = CASTERS.c1.value;
  c0.w = 0; c1.w = 0;
  if (ph === 'exit' || ph === 'fly' || (ph === 'deploy' && VIS.fly > 0.3)) {
    c0.set(VIS.pos.x, VIS.pos.y, VIS.pos.z, 1);
    CASTERS.c0r.value.set(1, 0, 0).applyQuaternion(VIS.quat);
    CASTERS.c0f.value.set(0, 0, -1).applyQuaternion(VIS.quat);
    CASTERS.c0u.value.set(0, 1, 0).applyQuaternion(VIS.quat);
  } else if (ph === 'canopy' || ph === 'deploy' || ph === 'landed') {
    c0.set(VIS.pos.x, VIS.pos.y, VIS.pos.z, 3);
    CASTERS.c0r.value.set(1, 0, 0); CASTERS.c0f.value.set(0, 0, -1); CASTERS.c0u.value.set(0, 1, 0);
    if (VIS.canopyOn && VIS.infl > 0.3) {
      c1.set(VIS.canopyPos.x, VIS.canopyPos.y, VIS.canopyPos.z, 2);
      CASTERS.c1r.value.set(1, 0, 0).applyQuaternion(VIS.canopyQuat);
      CASTERS.c1f.value.set(0, 0, -1).applyQuaternion(VIS.canopyQuat);
      CASTERS.c1u.value.set(0, 1, 0).applyQuaternion(VIS.canopyQuat);
      CASTERS.c1s.value.set(3.5 * VIS.infl, 1.35 * VIS.infl);
    }
  }
  CASTERS.c1s.value.x = Math.max(0.3, CASTERS.c1s.value.x);
}

function camModeNow() {
  if (GAME.state === 'menu' || GAME.state === 'replay') return 3;
  return CAM.mode;
}
function camState() {
  return {
    phase: VIS.phase === 'ready' ? 'ready' : VIS.phase, phaseT: VIS.phaseT, pos: VIS.pos, vel: VIS.vel, quat: VIS.quat,
    headPos: VIS.headPos, canopyMid: VIS.canopyMid, heading: VIS.heading, up: VIS.up, prox: VIS.prox,
  };
}

// ------------------------------------------------------------ run control
function resetRun() {
  const E = TC.EXIT;
  Object.assign(SIM, {
    phase: 'ready', time: 0, phaseT: 0, heading: E.heading, alpha: WS.aTrim, bank: 0, inflate: 0, deployT: 0, openShock: 0,
    u: 0, w: 0, yawRate: 0, flare: 0, toggleL: 0, toggleR: 0, swingRoll: 0, swingPitch: 0, outcome: null, crashCause: null, landing: null,
    agl: 0, prox: 999, gLoad: 1, warn: 0, airT: 0, scrapeCool: 0, thrust: 0, fuel: 1,
  });
  SIM.pos.set(E.x, R.exitY + 0.93, E.z);
  SIM.prev.copy(SIM.pos);
  SIM.vel.set(0, 0, 0);
  SIM.liftDir.set(0, 1, 0);
  EVENTS.length = 0;
  INPUT.pitch = INPUT.roll = INPUT.brakeL = INPUT.brakeR = INPUT.thrust = 0; INPUT.deploy = false;
  IN.pitch = IN.roll = IN.bl = IN.br = 0; IN.touchThrust = false;
  Object.assign(GAME, { scrapes: 0, score: 0, proxPts: 0, gatePts: 0, mult: 1, streakT: 0, farT: 0, tier: 0, gatesPassed: 0, flightT: 0, maxSpeed: 0, dist: 0, endT: -1, warn: 0, beepT: 0, rec: [], recT: 0 });
  GAME.tierT = [0, 0, 0, 0];
  GAME.lastPos.copy(SIM.pos);
  for (const g of R.gates) { g.state = 0; g.t = 0; g.mesh.visible = true; g.mat.uniforms.uFade.value = 1; g.mesh.scale.setScalar(1); }
  AUTO.gate = 0; AUTO.cT = 0; AUTO.hold = null;
  R.trail.pts.length = 0;
  VIS.roll = VIS.pitch = 0;
  CAM.shot = null; CAM.trauma = 0;
  CAM.dir.set(0, 0, -1);
  computeVis(0);
}
function doJump() {
  if (SIM.phase !== 'ready') return;
  SIM.phase = 'exit'; SIM.phaseT = 0;
  const f = headingVec(SIM.heading, new THREE.Vector3());
  SIM.vel.copy(f).multiplyScalar(6.2); SIM.vel.y = 2.0;
  SIM.inflate = 0;
  SFX.jump();
  if (GAME.state === 'play') callout(i18n('callout.exit'), 'orange', true);
}
function action() {
  if (GAME.state !== 'play' || GAME.paused) return;
  if (SIM.phase === 'ready') doJump();
  else if (SIM.phase === 'fly' && SIM.phaseT > 0.4) INPUT.deploy = true;
  else if ((SIM.phase === 'landed' || SIM.phase === 'crashed') && GAME.endT > 1.2) showResults();
}

// ------------------------------------------------------------ gameplay
function callout(text, cls = '', small = false) {
  const box = $('hud-msg');
  while (box.children.length > 2) box.firstChild.remove();
  const el = document.createElement('div');
  el.className = 'callout' + (cls ? ' ' + cls : '') + (small ? ' small' : '');
  el.textContent = text;
  box.appendChild(el);
  setTimeout(() => el.remove(), 1700);
}
function nextGateIndex() { for (let i = 0; i < R.gates.length; i++) if (R.gates[i].state === 0) return i; return -1; }
function gameplay(dt) {
  const s = SIM;
  const live = GAME.state === 'play';
  const flying = s.phase === 'fly' || s.phase === 'exit';
  const spd = s.vel.length();
  // gates: crossing test on the frame's path segment
  const a = GAME.lastPos, b = s.pos;
  for (let i = 0; i < R.gates.length; i++) {
    const g = R.gates[i];
    if (g.state !== 0) continue;
    const da = (a.x - g.x) * g.n.x + (a.y - g.y) * g.n.y + (a.z - g.z) * g.n.z;
    const db = (b.x - g.x) * g.n.x + (b.y - g.y) * g.n.y + (b.z - g.z) * g.n.z;
    if (da < 0 && db >= 0) {
      const t = da / (da - db);
      const hx = a.x + (b.x - a.x) * t - g.x, hy = a.y + (b.y - a.y) * t - g.y, hz = a.z + (b.z - a.z) * t - g.z;
      const r = Math.sqrt(hx * hx + hy * hy + hz * hz);
      if (r <= g.r + 1.2) {
        g.state = 1; g.t = 0;
        for (let j = 0; j < i; j++) if (R.gates[j].state === 0) { R.gates[j].state = 2; R.gates[j].t = 0; }
        const pts = GATE_POINTS[g.kind] * GAME.mult;
        GAME.gatePts += pts; GAME.score += pts; GAME.gatesPassed++;
        SFX.gate(g.kind !== 0);
        if (live) callout(i18n(['callout.gate', 'callout.notch', 'callout.lakegate', 'callout.gold'][g.kind], { pts }), g.kind === 3 ? 'gold' : 'lake', g.kind === 0);
      } else if (r < g.r * 5) {
        g.state = 2; g.t = 0;
        for (let j = 0; j < i; j++) if (R.gates[j].state === 0) { R.gates[j].state = 2; R.gates[j].t = 0; }
        if (live) callout(i18n('callout.gatemissed'), '', true);
      }
    }
  }
  if (flying || s.phase === 'deploy' || s.phase === 'canopy') {
    GAME.maxSpeed = Math.max(GAME.maxSpeed, spd);
  }
  if (flying) {
    GAME.flightT += dt;
    GAME.dist += Math.hypot(b.x - a.x, b.z - a.z);
    // proximity scoring
    const d = s.prox;
    if (s.phase === 'fly' && d < 60) {
      const f = Math.pow(1 - d / 60, 2);
      const pts = 95 * f * (spd * 3.6 / 100) * GAME.mult * dt;
      GAME.proxPts += pts; GAME.score += pts;
    }
    if (s.phase === 'fly') {
      if (d < 30) {
        GAME.streakT += dt; GAME.farT = 0;
        if (GAME.streakT > 3.2 && GAME.mult < 5) { GAME.mult++; GAME.streakT = 0; if (live) callout(i18n('callout.multiplier', { mult: GAME.mult }), 'orange', true); }
      } else {
        GAME.farT += dt;
        if (GAME.farT > 2.6) { if (GAME.mult > 1 && live) callout(i18n('callout.multiplierlost'), '', true); GAME.mult = 1; GAME.streakT = 0; GAME.farT = 0; }
      }
      const tier = d < 5 ? 3 : d < 10 ? 2 : d < 20 ? 1 : 0;
      for (let k = 1; k <= 3; k++) GAME.tierT[k] = Math.max(0, GAME.tierT[k] - dt);
      if (tier > 0 && tier > GAME.tier && GAME.tierT[tier] <= 0 && live) {
        callout(['', i18n('tier.close'), i18n('tier.grazing'), i18n('tier.insane')][tier], tier === 3 ? 'red' : tier === 2 ? 'orange' : '', tier === 1);
        GAME.tierT[tier] = 3;
      }
      GAME.tier = tier;
    }
    // audible altimeter (height above the landing field)
    const alz = s.pos.y - TC.LZ.h;
    if (s.phase === 'fly' && nextGateIndex() === -1 || alz < 700) {
      if (GAME.warn === 0 && alz < 640) { GAME.warn = 1; SFX.beepWarn(); if (live) callout(i18n('callout.altimeter', { m: 640 }), 'orange', true); }
      if (alz < 420) { GAME.beepT -= dt; if (GAME.beepT <= 0) { SFX.beepNow(); GAME.beepT = 1.3; } GAME.warn = 2; }
    }
  }
  GAME.lastPos.copy(s.pos);
}
function handleEvents() {
  const live = GAME.state === 'play';
  while (EVENTS.length) {
    const e = EVENTS.shift();
    if (e.type === 'deploy') { SFX.deploy(); if (live) callout(i18n('callout.opening'), '', true); }
    else if (e.type === 'scrape') {
      GAME.scrapes++;
      const pen = Math.min(GAME.score, 250);
      GAME.score -= pen; GAME.mult = 1; GAME.streakT = 0;
      noiseBurst(0.35, e.kind === 'tree' ? 1500 : 500, 0.5, 'bandpass', 0, 0.9);
      addTrauma(0.55);
      if (live) callout(i18n(e.kind === 'tree' ? 'callout.branches' : 'callout.scraped', { pen }), 'orange', true);
    }
    else if (e.type === 'canopyOpen') { SFX.open(); addTrauma(clamp(SIM.openShock / 5, 0.2, 0.8)); if (live) callout(i18n('callout.canopyopen'), 'lake', true); }
    else if (e.type === 'land') {
      SFX.land(e.kind);
      if (e.kind === 'water') SFX.splash();
      addTrauma(e.kind === 'hard' ? 0.7 : 0.25);
      const splash = SIM.landing && SIM.landing.splash;
      if (live) callout(i18n(splash ? 'land.splash' : 'land.' + e.kind), e.kind === 'perfect' || splash ? 'lake' : e.kind === 'good' ? '' : 'orange');
      GAME.endT = 0;
    } else if (e.type === 'crash') {
      if (e.cause === 'water') SFX.splash(); else SFX.crash();
      addTrauma(1);
      const fl = $('flash'); fl.style.transition = 'none'; fl.style.opacity = 0.85; requestAnimationFrame(() => { fl.style.transition = 'opacity 0.9s'; fl.style.opacity = 0; });
      if (live) callout(i18n('callout.impact'), 'red');
      GAME.endT = 0;
    }
  }
}

// ------------------------------------------------------------ results
function computeScore() {
  const b = { prox: Math.round(GAME.proxPts), gates: GAME.gatePts, speed: Math.round(GAME.maxSpeed * 3.6) * 2, landing: 0, accuracy: 0 };
  const s = SIM;
  const ok = s.outcome === 'landed';
  if (s.landing) {
    const L = s.landing;
    b.landing = L.splash ? 150 : { perfect: 800, good: 400, plf: 100, hard: 0, water: 0, tree: 0 }[L.kind] || 0;
    if (L.kind !== 'water' && L.kind !== 'tree') b.accuracy = L.dist < 3 ? 2000 : Math.max(0, Math.round(1500 - L.dist * 18));
    else if (L.splash) b.accuracy = Math.max(0, Math.round((1500 - L.dist * 18) / 2));
  }
  const total = s.outcome === 'crash' ? b.prox + b.gates : b.prox + b.gates + b.speed + b.landing + b.accuracy;
  return { b, total, ok };
}
function renderResults() {
  const { b, total } = computeScore();
  const s = SIM;
  const T = $('rtitle'), why = $('rwhy');
  T.className = '';
  const kmh = Math.round((s.crashSpeed || 0) * 3.6);
  if (s.outcome === 'crash') {
    T.textContent = { terrain: i18n('callout.impact'), tree: i18n('result.title.tree'), water: i18n('result.title.water') }[s.crashCause] || i18n('callout.impact');
    T.className = 'bad';
    why.textContent = i18n(s.crashCause === 'tree' ? 'result.why.tree' : s.crashCause === 'water' ? 'result.why.water' : 'result.why.terrain', { kmh });
  } else {
    const L = s.landing;
    T.textContent = L.splash ? i18n('land.splash') : { perfect: i18n('land.perfect'), good: i18n('land.good'), plf: i18n('result.title.plf'), hard: i18n('land.hard'), water: i18n('result.title.waterland'), tree: i18n('result.title.treeland') }[L.kind];
    T.className = L.kind === 'perfect' || L.kind === 'good' || L.splash ? 'good' : 'bad';
    why.textContent = L.splash ? i18n('result.why.splash', { dist: Math.round(L.dist) }) : i18n('result.why.landing', { vs: L.vs.toFixed(1), dist: Math.round(L.dist) });
  }
  const mm = Math.floor(GAME.flightT / 60), ss = Math.floor(GAME.flightT % 60).toString().padStart(2, '0');
  const rows = [
    [i18n('result.row.time'), `${mm}:${ss}`],
    [i18n('result.row.distance'), `${(GAME.dist / 1000).toFixed(2)} km`],
    [i18n('result.row.maxspeed'), `${Math.round(GAME.maxSpeed * 3.6)} km/h`],
    [i18n('hud.proximity'), fmt(b.prox)],
    [i18n('result.row.gates', { passed: GAME.gatesPassed, total: R.gates.length }), fmt(b.gates)],
  ];
  if (GAME.scrapes) rows.push([i18n('result.row.scrapes'), String(GAME.scrapes)]);
  if (s.outcome !== 'crash') rows.push([i18n('result.row.speedbonus'), fmt(b.speed)], [i18n('result.row.landing'), fmt(b.landing)], [i18n('result.row.accuracy'), fmt(b.accuracy)]);
  rows.push([i18n('result.row.total'), fmt(total)]);
  $('rtable').innerHTML = rows.map(([k, v], i) => i === rows.length - 1 ? `<span class="tot">${k}</span><span class="tot">${v}</span>` : `<span>${k}</span><span>${v}</span>`).join('');
}
function showResults() {
  if (GAME.state !== 'play') return;
  GAME.state = 'result';
  const { total, ok } = computeScore();
  renderResults();
  const newRec = ok && total > GAME.best;
  if (newRec) { GAME.best = total; store('best', total); }
  $('rnew').hidden = !newRec;
  $('result').hidden = false;
  $('touch').hidden = true;
  setTimeout(() => $('bagain').focus(), 50);
}

// ------------------------------------------------------------ replay
function recordFrame(dt) {
  GAME.recT += dt;
  if (GAME.recT < 1 / 30) return;
  GAME.recT = 0;
  const v = VIS;
  GAME.rec.push([
    SIM.time, v.pos.x, v.pos.y, v.pos.z, v.quat.x, v.quat.y, v.quat.z, v.quat.w, PHASES.indexOf(v.phase), v.fly, v.hang, v.roll, v.pitch, v.bl, v.br,
    v.canopyOn ? 1 : 0, v.infl, v.canopyPos.x, v.canopyPos.y, v.canopyPos.z, v.canopyQuat.x, v.canopyQuat.y, v.canopyQuat.z, v.canopyQuat.w,
    v.pcOn ? 1 : 0, v.pcPos.x, v.pcPos.y, v.pcPos.z, v.vel.x, v.vel.y, v.vel.z, v.heading, v.prox, v.phaseT, v.up.x, v.up.y, v.up.z,
    v.bridleFrom.x, v.bridleFrom.y, v.bridleFrom.z, v.thrust,
  ]);
}
function startReplay() {
  const fr = GAME.rec;
  if (fr.length < 10) return;
  let i0 = fr.findIndex((f) => f[8] >= 1);
  i0 = Math.max(0, i0 - 45);
  GAME.replay = { i: i0, t: fr[i0][0], end: fr[fr.length - 1][0] };
  GAME.state = 'replay';
  $('result').hidden = true;
  $('hud').hidden = false;
  for (const id of ['hud-left', 'hud-right', 'hud-bottom', 'minimap', 'prompt']) $(id).style.visibility = 'hidden';
  $('replaytag').hidden = false;
  R.trail.pts.length = 0;
  CAM.shot = null;
  for (const g of R.gates) { g.state = 0; g.t = 0; g.mesh.visible = true; g.mat.uniforms.uFade.value = 1; g.mesh.scale.setScalar(1); }
  GAME.lastPos.set(fr[i0][1], fr[i0][2], fr[i0][3]);
}
function endReplay() {
  GAME.state = 'play';
  $('replaytag').hidden = true;
  for (const id of ['hud-left', 'hud-right', 'hud-bottom', 'minimap', 'prompt']) $(id).style.visibility = '';
  GAME.state = 'result';
  $('result').hidden = false;
  CAM.shot = null;
  // restore the end-of-run scene
  computeVis(0);
}
function replayUpdate(dt) {
  const RP = GAME.replay, fr = GAME.rec;
  RP.t += dt;
  while (RP.i < fr.length - 2 && fr[RP.i + 1][0] < RP.t) RP.i++;
  const A = fr[RP.i], B = fr[Math.min(fr.length - 1, RP.i + 1)];
  const k = clamp((RP.t - A[0]) / Math.max(1e-4, B[0] - A[0]), 0, 1);
  const L = (i) => A[i] + (B[i] - A[i]) * k;
  VIS.pos.set(L(1), L(2), L(3));
  _q0.set(A[4], A[5], A[6], A[7]); _q1.set(B[4], B[5], B[6], B[7]); VIS.quat.copy(_q0).slerp(_q1, k);
  VIS.phase = PHASES[A[8]]; VIS.fly = L(9); VIS.hang = L(10); VIS.roll = L(11); VIS.pitch = L(12); VIS.bl = L(13); VIS.br = L(14);
  VIS.canopyOn = A[15] > 0.5; VIS.infl = L(16);
  VIS.canopyPos.set(L(17), L(18), L(19));
  _q0.set(A[20], A[21], A[22], A[23]); _q1.set(B[20], B[21], B[22], B[23]); VIS.canopyQuat.copy(_q0).slerp(_q1, k);
  VIS.pcOn = A[24] > 0.5; VIS.pcPos.set(L(25), L(26), L(27));
  VIS.vel.set(L(28), L(29), L(30)); VIS.heading = A[31]; VIS.prox = L(32); VIS.phaseT = L(33); VIS.up.set(L(34), L(35), L(36)).normalize();
  VIS.bridleFrom.set(L(37), L(38), L(39));
  VIS.thrust = L(40) || 0;
  // gates light up as the replay passes them
  const a = GAME.lastPos, b = VIS.pos;
  for (const g of R.gates) {
    if (g.state !== 0) continue;
    const da = (a.x - g.x) * g.n.x + (a.y - g.y) * g.n.y + (a.z - g.z) * g.n.z, db = (b.x - g.x) * g.n.x + (b.y - g.y) * g.n.y + (b.z - g.z) * g.n.z;
    if (da < 0 && db >= 0) { g.state = Math.hypot(b.x - g.x, b.y - g.y, b.z - g.z) < g.r + 3 ? 1 : 2; g.t = 0; }
  }
  GAME.lastPos.copy(VIS.pos);
  if (RP.t > RP.end + 2.5) endReplay();
}

// ------------------------------------------------------------ HUD
const HUD = { tape: null, mm0: null, mm1: null };
function buildHud() {
  HUD.tape = $('tape').getContext('2d');
  HUD.mm1 = $('mm1').getContext('2d');
  // static minimap: hillshade of the flight corridor
  const cv = $('mm0'), g = cv.getContext('2d');
  const W = cv.width, H = cv.height, L = WORLD.L0;
  const img = g.createImageData(W, H);
  const sx = (L.x1 - L.x0) / W, sz = (L.z1 - L.z0) / H;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const wx = L.x0 + (x + 0.5) * sx, wz = L.z0 + (y + 0.5) * sz;
    const i = clamp(Math.round((wx - L.x0) / L.cell), 0, L.nx - 1), j = clamp(Math.round((wz - L.z0) / L.cell), 0, L.nz - 1);
    const k = (j * L.nx + i) * 4;
    const nx = L.nrm[k] / 127.5 - 1, nz = L.nrm[k + 1] / 127.5 - 1, ny = Math.sqrt(Math.max(0, 1 - nx * nx - nz * nz));
    const sh = L.nrm[k + 2] / 255;
    const ndl = Math.max(0, nx * SUN_DIR.x + ny * SUN_DIR.y + nz * SUN_DIR.z);
    const h = L.h[j * L.nx + i];
    const t = clamp((h - 600) / 3000, 0, 1);
    let r = lerp(88, 196, t), gg = lerp(110, 184, t), bb = lerp(84, 170, t);
    const forest = L.spl[k] / 255;
    r = lerp(r, 44, forest * 0.7); gg = lerp(gg, 70, forest * 0.7); bb = lerp(bb, 46, forest * 0.7);
    const light = 0.35 + 0.85 * ndl * (0.35 + 0.65 * sh);
    let R_ = r * light, G_ = gg * light, B_ = bb * light;
    const lk = TC.lakeAt(wx, wz, 0);
    if (lk && h < lk.level) { R_ = 40; G_ = 170; B_ = 165; }
    if (Math.abs(wz - TC.riverZ(wx)) < 14) { R_ = 70; G_ = 120; B_ = 130; }
    const o = (y * W + x) * 4;
    img.data[o] = R_; img.data[o + 1] = G_; img.data[o + 2] = B_; img.data[o + 3] = 235;
  }
  g.putImageData(img, 0, 0);
  const toMM = (x, z) => [(x - L.x0) / sx, (z - L.z0) / sz];
  g.setLineDash([6, 5]); g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 2;
  g.beginPath();
  const line = [[TC.EXIT.x, TC.EXIT.z], ...TC.GATES.map((q) => [q[0], q[1]]), [TC.LZ.x, TC.LZ.z]];
  line.forEach(([x, z], i) => { const [a, b] = toMM(x, z); if (i) g.lineTo(a, b); else g.moveTo(a, b); });
  g.stroke(); g.setLineDash([]);
  const [lx, lz] = toMM(TC.LZ.x, TC.LZ.z);
  g.fillStyle = '#ff6b1a'; g.beginPath(); g.arc(lx, lz, 6, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#0a1418'; g.lineWidth = 2; g.stroke();
  const [ex, ez] = toMM(TC.EXIT.x, TC.EXIT.z);
  g.fillStyle = '#eef3f1'; g.beginPath(); g.moveTo(ex, ez - 7); g.lineTo(ex + 6, ez + 4); g.lineTo(ex - 6, ez + 4); g.closePath(); g.fill();
  HUD.toMM = toMM;
}
function drawTape(alt, ground) {
  const c = HUD.tape, W = 116, H = 520;
  c.clearRect(0, 0, W, H);
  c.fillStyle = 'rgba(7,16,20,0.58)';
  c.beginPath(); c.roundRect ? c.roundRect(0, 0, W, H, 12) : c.rect(0, 0, W, H); c.fill();
  const mPerPx = 1.25, cy = H / 2;
  const y = (a) => cy - (a - alt) / mPerPx;
  // ground below the pilot
  const gy = y(ground);
  if (gy < H) { c.fillStyle = 'rgba(160,138,109,0.55)'; c.fillRect(0, Math.max(0, gy), W, H - Math.max(0, gy)); c.fillStyle = '#c9a77f'; c.fillRect(0, gy - 1.5, W, 3); }
  // deploy band above the landing field
  const lz = TC.LZ.h;
  const d0 = y(lz + 420), d1 = y(lz + 250);
  c.fillStyle = 'rgba(255,107,26,0.22)'; c.fillRect(0, d0, W, d1 - d0);
  c.font = '600 18px "Chivo Mono", monospace'; c.textAlign = 'right'; c.textBaseline = 'middle';
  const a0 = Math.floor((alt - cy * mPerPx) / 10) * 10, a1 = alt + cy * mPerPx;
  for (let a = a0; a <= a1; a += 10) {
    const yy = y(a);
    const big = a % 100 === 0, mid = a % 50 === 0;
    c.fillStyle = 'rgba(238,243,241,' + (big ? 0.85 : 0.45) + ')';
    c.fillRect(W - (big ? 26 : mid ? 18 : 10), yy - 1, big ? 26 : mid ? 18 : 10, 2);
    if (big) { c.fillStyle = 'rgba(238,243,241,0.7)'; c.fillText(String(a), W - 32, yy); }
  }
  const ly = y(lz);
  if (ly > -10 && ly < H + 10) { c.fillStyle = '#ff6b1a'; c.fillRect(0, ly - 2, W, 4); c.textAlign = 'left'; c.fillText('LZ', 8, ly - 14); c.textAlign = 'right'; }
  // pointer
  c.fillStyle = '#eef3f1';
  c.beginPath(); c.moveTo(0, cy - 16); c.lineTo(W - 22, cy - 16); c.lineTo(W - 6, cy); c.lineTo(W - 22, cy + 16); c.lineTo(0, cy + 16); c.closePath(); c.fill();
  c.fillStyle = '#0a1418'; c.font = '700 20px "Chivo Mono", monospace'; c.textAlign = 'center';
  c.fillText(String(Math.round(alt)), (W - 16) / 2, cy + 1);
}
function drawMinimapDyn() {
  const c = HUD.mm1, W = 300, H = 480;
  c.clearRect(0, 0, W, H);
  const gi = nextGateIndex();
  R.gates.forEach((g, i) => {
    const [x, z] = HUD.toMM(g.x, g.z);
    c.beginPath(); c.arc(x, z, i === gi ? 7 : 4, 0, Math.PI * 2);
    c.fillStyle = g.state === 1 ? '#3fd0c4' : g.state === 2 ? 'rgba(160,170,175,0.6)' : i === gi ? '#ff6b1a' : g.kind === 3 ? '#ffc21f' : g.kind === 2 ? '#7fe6de' : 'rgba(255,255,255,0.85)';
    c.fill();
  });
  const [px, pz] = HUD.toMM(VIS.pos.x, VIS.pos.z);
  c.save(); c.translate(px, pz); c.rotate(VIS.heading);
  c.fillStyle = '#ffd24a'; c.strokeStyle = '#0a1418'; c.lineWidth = 2;
  c.beginPath(); c.moveTo(0, -12); c.lineTo(8, 9); c.lineTo(0, 4); c.lineTo(-8, 9); c.closePath(); c.stroke(); c.fill();
  c.restore();
}
function updateHud(dt) {
  GAME.hudT += dt;
  const s = SIM;
  const ground = surfaceHeight(s.pos.x, s.pos.z);
  drawTape(s.pos.y, ground);
  if (GAME.hudT < 0.05) return;
  GAME.hudT = 0;
  const spd = s.vel.length() * 3.6;
  const vs = -s.vel.y * 3.6;
  const hs = Math.hypot(s.vel.x, s.vel.z);
  $('spd').textContent = Math.round(spd);
  $('vs').textContent = Math.round(Math.max(0, vs));
  $('gl').textContent = (s.phase === 'fly' || s.phase === 'deploy' ? s.gLoad : 1).toFixed(1);
  const agl = s.pos.y - ground - (s.phase === 'canopy' ? 1.02 : 0.3);
  $('agl').textContent = Math.max(0, Math.round(agl));
  $('alt').textContent = Math.round(s.pos.y);
  const alz = s.pos.y - TC.LZ.h;
  $('alz').textContent = Math.round(alz);
  $('ro-lz').classList.toggle('warn', (s.phase === 'fly') && alz < 420);
  $('glide').textContent = -s.vel.y > 0.5 ? (hs / -s.vel.y).toFixed(1) : '–';
  $('score').textContent = fmt(GAME.score);
  $('mult').textContent = '×' + GAME.mult;
  $('gates').textContent = `${GAME.gatesPassed}/${R.gates.length}`;
  const t = GAME.flightT;
  $('time').textContent = `${Math.floor(t / 60)}:${Math.floor(t % 60).toString().padStart(2, '0')}`;
  const pr = s.phase === 'fly' || s.phase === 'exit' ? s.prox : 999;
  // under the canopy the proximity bar becomes the motor's fuel gauge
  const motor = s.phase === 'canopy' || (s.phase === 'landed' && s.fuel < 1);
  if (motor !== HUD.motor) {
    HUD.motor = motor;
    $('hud-bottom').classList.toggle('motor', motor);
    $('proxk').textContent = i18n(motor ? 'hud.motor' : 'hud.proximity');
  }
  if (motor) {
    $('proxv').textContent = s.fuel > 0 ? `${Math.round(s.fuel * 100)}%${IS_TOUCH ? '' : ' · E'}` : i18n('hud.empty');
    $('proxbar').style.width = `${s.fuel * 100}%`;
  } else {
    $('proxv').textContent = pr < 200 ? `${Math.round(pr)} m` : '–';
    $('proxbar').style.width = `${clamp(1 - pr / 60, 0, 1) * 100}%`;
  }
  $('btnthr').hidden = !(IS_TOUCH && s.phase === 'canopy');
  $('vignette').style.opacity = Math.max(pr < 12 ? (1 - pr / 12) * 0.9 : 0, (s.warn || 0) * 0.8);
  // prompts
  const P = $('prompt');
  let txt = '', blink = false, top = false;
  if (s.phase === 'ready') txt = i18n(IS_TOUCH ? 'prompt.readyTouch' : 'prompt.readyKey');
  else if ((s.phase === 'fly' || s.phase === 'exit') && s.warn > 0.35) { txt = i18n('prompt.climb'); blink = true; }
  else if ((s.phase === 'exit' || s.phase === 'fly') && s.airT < 7) txt = i18n(IS_TOUCH ? 'prompt.earlyTouch' : 'prompt.earlyKey');
  else if (s.phase === 'fly' && alz < 420 && alz > 0) { txt = i18n(IS_TOUCH ? 'prompt.deployTouch' : 'prompt.deployKey'); blink = true; }
  else if (s.phase === 'canopy') {
    const feet = s.pos.y - 1.02 - ground;
    if (feet < 9 && feet > 1) { txt = i18n(IS_TOUCH ? 'prompt.flareTouch' : 'prompt.flareKey'); blink = true; }
    else if (s.phaseT < 6) { top = true; txt = i18n(IS_TOUCH ? 'prompt.canopyTouch' : 'prompt.canopyKey'); }
  } else if ((s.phase === 'landed' || s.phase === 'crashed') && GAME.endT > 1.2) txt = IS_TOUCH ? '' : i18n('prompt.resultKey');
  if (P.innerHTML !== txt) P.innerHTML = txt;
  P.classList.toggle('blink', blink);
  P.classList.toggle('top', top);
  $('camtag').innerHTML = `${i18n('hud.camera')} <b>${i18n(CAM.nameKeys[CAM.mode])}</b> · C<br>${i18n('hud.smoke')} ${i18n(SETTINGS.smoke ? 'state.on' : 'state.off')} · F`;
  $('btnact').textContent = i18n(s.phase === 'ready' ? 'btn.jump' : s.phase === 'fly' ? 'btn.open' : s.phase === 'canopy' ? 'btn.flare' : 'btn.ok');
  drawMinimapDyn();
}

// ------------------------------------------------------------ landing aids
// predicted touchdown ring on the ground + an on-screen marker that always points at the target
const AID = { px: 0, pz: 0, tx: 0, tz: 0, a: 0, init: false, hintT: 0, cls: '', txt: {}, hint: '', hintCls: '' };
const _ap = new THREE.Vector3();
function predictTouchdown(s) {
  // straight glide at the current ground velocity and sink rate until the feet meet the ground
  let x = s.pos.x, y = s.pos.y - 1.02, z = s.pos.z;
  const vx = s.vel.x, vz = s.vel.z, w = Math.max(0.4, -s.vel.y);
  for (let i = 0; i < 160; i++) {
    const h = y - surfaceHeight(x, z);
    if (h <= 0.05) break;
    const st = clamp(h / w * 0.5, 0.03, 2.0);
    x += vx * st; z += vz * st; y -= w * st;
  }
  AID.tx = x; AID.tz = z;
}
function setText(id, v) { if (AID.txt[id] !== v) { AID.txt[id] = v; $(id).textContent = v; } }
function fmtDist(d) {
  if (d >= 1000) { const km = (d / 1000).toFixed(1); return (LANG === 'pt' ? km.replace('.', ',') : km) + ' km'; }
  return (d >= 100 ? Math.round(d / 10) * 10 : Math.round(d)) + ' m';
}
function updateLandingAids(dt, cam) {
  const s = SIM, LZ = TC.LZ;
  const play = GAME.state === 'play';
  const canopy = play && s.phase === 'canopy';
  const feet = s.pos.y - 1.02 - surfaceHeight(s.pos.x, s.pos.z);
  if (canopy) {
    predictTouchdown(s);
    if (!AID.init) { AID.px = AID.tx; AID.pz = AID.tz; AID.init = true; }
    const k = 1 - Math.exp(-dt * 7);
    AID.px += (AID.tx - AID.px) * k; AID.pz += (AID.tz - AID.pz) * k;
  } else AID.init = false;
  AID.a = damp(AID.a, canopy && feet > 1.5 ? 1 : 0, 4, dt);
  const predErr = Math.hypot(AID.px - LZ.x, AID.pz - LZ.z);
  const onTarget = predErr < TARGET_R;
  MARKS.pred.value.set(AID.px, AID.pz, clamp(3.5 + feet * 0.03, 3.5, 13), AID.a > 0.01 ? AID.a : 0);
  if (onTarget) MARKS.predCol.value.setRGB(0.25, 1.1, 0.3); else MARKS.predCol.value.setRGB(1.25, 0.95, 0.1);

  // on-screen marker
  const el = $('lzmark');
  const alz = s.pos.y - R.lzY;
  const show = play && !GAME.paused && (s.phase === 'deploy' || s.phase === 'canopy' || (s.phase === 'fly' && (nextGateIndex() < 0 || alz < 650)));
  const dH = Math.hypot(LZ.x - s.pos.x, LZ.z - s.pos.z);
  let cls = show ? 'on' : '';
  if (show) {
    const W = window.innerWidth, H = window.innerHeight, m = Math.min(70, Math.min(W, H) * 0.12);
    _ap.set(LZ.x, R.lzY + 1, LZ.z).applyMatrix4(cam.matrixWorldInverse);
    let sx, sy, dx, dy, edge = false, ringD = 38;
    if (_ap.z < -0.5) {
      // ring sized to circle the painted target as it grows on screen
      const focal = H / 2 / Math.tan(cam.fov * DEG / 2);
      ringD = clamp(TARGET_R * focal / -_ap.z * 2 + 16, 38, 320);
      _ap.applyMatrix4(cam.projectionMatrix);
      sx = (_ap.x * 0.5 + 0.5) * W; sy = (0.5 - _ap.y * 0.5) * H;
      dx = sx - W / 2; dy = sy - H / 2;
      edge = sx < m || sx > W - m || sy < m || sy > H - m;
    } else {
      // behind the camera: point sideways toward the turn that brings it into view
      dx = _ap.x; dy = -_ap.y * 0.35;
      if (Math.abs(dx) < 1e-3) dx = 1e-3;
      edge = true;
    }
    if (edge) {
      const t = Math.min((W / 2 - m) / Math.max(1e-6, Math.abs(dx)), (H / 2 - m) / Math.max(1e-6, Math.abs(dy)));
      sx = W / 2 + dx * t; sy = H / 2 + dy * t;
      cls += ' edge';
      if (sy > H * 0.62) cls += ' up';
      el.querySelector('.lzm-arrow').style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
    }
    el.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px)`;
    if (edge) ringD = 38;
    if (Math.abs(ringD - (AID.ringD || 0)) > 1) { AID.ringD = ringD; el.style.setProperty('--rs', ringD.toFixed(0) + 'px'); }
    if (sx < 170) cls += ' al'; else if (sx > W - 170) cls += ' ar';
    // once the target is big on screen the marker steps back so it doesn't cover it
    if (ringD > 130 || (s.phase === 'canopy' && dH < 55 && feet < 45)) cls += ' dim';
    setText('lzm-d', fmtDist(dH));
    setText('lzm-h', alz > 3 ? i18n('aid.above', { m: Math.round(alz) }) : '');
    // glide hint under canopy (updated twice a second so it doesn't flicker)
    AID.hintT -= dt;
    if (AID.hintT <= 0) {
      AID.hintT = 0.5;
      let hint = '', hc = '';
      if (s.phase === 'canopy' && feet > 12) {
        const alt = Math.max(0, s.pos.y - 1.02 - R.lzY);
        const ux = (LZ.x - s.pos.x) / Math.max(1, dH), uz = (LZ.z - s.pos.z) / Math.max(1, dH);
        const reach = alt / 4.8 * (11.2 + WIND.x * ux + WIND.z * uz);   // straight at it, full glide
        if (predErr < TARGET_R * 1.3) { hint = i18n('aid.online'); hc = 'good'; }
        else if (reach < dH * 0.9) { hint = i18n(s.fuel > 0 ? (IS_TOUCH ? 'aid.motorTouch' : 'aid.motor') : 'aid.short'); hc = 'bad'; }
        else if (reach > dH + 220 && alt > 70) { hint = i18n('aid.high'); hc = 'warn'; }
        else { hint = i18n('aid.aim'); hc = ''; }
      }
      AID.hint = hint; AID.hintCls = hc;
      setText('lzm-hint', hint);
      $('lzm-hint').className = hc;
    }
  }
  if (cls !== AID.cls) { AID.cls = cls; el.className = cls; }
}

// ------------------------------------------------------------ gates anim
function updateGates(dt) {
  const gi = nextGateIndex();
  R.gates.forEach((g, i) => {
    const u = g.mat.uniforms;
    if (g.state === 0) {
      const next = i === gi;
      u.uGlow.value = next ? 0.75 + 0.35 * Math.sin(U.uTime.value * 5) : 0.25;
      u.uColA.value.copy(g.col).multiplyScalar(next ? 1.3 : 0.9);
    } else {
      g.t += dt;
      if (g.state === 1) { u.uColA.value.copy(GATE_LAKE).multiplyScalar(1.4); u.uColB.value.copy(GATE_WHITE); u.uGlow.value = 1.4; g.mesh.scale.setScalar(1 + g.t * 0.8); }
      else { u.uColA.value.setRGB(0.3, 0.32, 0.33); u.uGlow.value = 0.1; }
      u.uFade.value = Math.max(0, 1 - g.t / (g.state === 1 ? 0.9 : 1.6));
      g.mesh.visible = u.uFade.value > 0.01;
    }
    if (g.state === 0) { u.uColB.value.copy(GATE_WHITE); u.uFade.value = 1; }
  });
}

// ------------------------------------------------------------ screens
function show(id, on) { $(id).hidden = !on; }
// on phones/tablets, jump straight into fullscreen landscape so the HUD has room to breathe
function goFullscreenLandscape() {
  if (!IS_TOUCH) return;
  const el = document.documentElement;
  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  const lock = () => { try { screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape').catch(() => {}); } catch (e) {} };
  if (req) { try { const p = req.call(el); if (p && p.then) p.then(lock).catch(lock); else lock(); } catch (e) { lock(); } }
  else lock();
}
function updateMenuRecord() {
  $('record').textContent = GAME.best ? i18n('menu.record', { n: fmt(GAME.best) }) : i18n('menu.norecord');
  updateMenuWorld();
}
// the current world in the menu: its peak, season and landing, and the seed to share it
function updateMenuWorld() {
  if (!STYLE) return;
  const lz = TC.LZ;
  $('worldinfo').textContent = `${worldName(SEED)} · ${TC.SUMMIT.h} m · ${i18n('season.' + STYLE.season)} · ${i18n('menu.world')} #${SEED}`;
  const ex = Math.round(R.exitY || TC.SUMMIT.h), lzh = Math.round(lz.h);
  $('st-exit').textContent = ex + ' m';
  $('st-lz').textContent = `${lzh} m · ${i18n('lz.' + lz.type)}`;
  $('st-drop').textContent = (ex - lzh) + ' m';
  $('ngates').textContent = String(TC.GATES.length);
}
function toMenu() {
  GAME.state = 'menu'; GAME.paused = false;
  show('menu', true); show('scrim', true); show('hud', false); show('result', false); show('pause', false); show('touch', false);
  $('replaytag').hidden = true;
  updateMenuRecord();
  resetRun();
  GAME.attractT = 0;
}

// ------------------------------------------------------------ worlds
// Style, heightfields, baking, then every object of the world into R.world.
async function buildWorldScene(progress) {
  STYLE = makeStyle(SEED);
  applyStyle();
  await buildWorld(progress);
  progress(1, i18n('load.scene'));
  await nextFrame();
  R.world = new THREE.Group();
  R.scene.add(R.world);
  R.terrain.push(new TerrainLevel(WORLD.L2, true));
  R.terrain.push(new TerrainLevel(WORLD.L0, false));
  buildWater();
  buildTrees();
  buildClouds();
  buildProps();
  buildGates();
  buildBirds();
  buildHud();
}
// place the pilot at the exit and warm the GPU up for the new scene
function settleWorld() {
  resetRun();
  applyVis(0);
  updateCamera(0.016, R.camera, camState(), 3);
  R.camera.updateMatrixWorld();
  for (const T of R.terrain) T.update(R.camera, 1);
  try { R.renderer.compile(R.scene, R.camera); } catch (e) { /* compile lazily */ }
}
let WORLD_BUSY = false;
async function newWorld(seed, thenPlay) {
  if (WORLD_BUSY) return;
  WORLD_BUSY = true;
  GAME.state = 'loading'; GAME.paused = false;
  for (const id of ['menu', 'scrim', 'hud', 'result', 'pause', 'touch', 'help', 'settings']) show(id, false);
  $('replaytag').hidden = true;
  const bar = $('loadbar'), msg = $('loadmsg');
  bar.style.transition = 'none'; bar.style.width = '0%'; void bar.offsetWidth; bar.style.transition = '';
  SEED = seed || randomSeed();
  $('loadinfo').textContent = `${worldName(SEED)} · #${SEED}`;
  msg.textContent = i18n('load.newworld');
  show('loading', true);
  await nextFrame(); await nextFrame();
  try {
    disposeWorld();
    TC = makeTerrainCore(SEED);
    await buildWorldScene((p, text) => { bar.style.width = `${Math.round(p * 100)}%`; if (text) msg.textContent = text; });
    settleWorld();
    show('loading', false);
    WORLD_BUSY = false;
    if (thenPlay) startPlay(); else toMenu();
  } catch (err) {
    console.error(err);
    WORLD_BUSY = false;
    $('loaderr').hidden = false;
    $('loaderr').textContent = i18n('error.worldbuild') + (err && err.message ? err.message : err);
  }
}
// copy a link that replays this exact world
function shareWorld() {
  const url = location.origin + location.pathname + '?seed=' + SEED;
  const b = $('bshare');
  const say = (key) => { b.textContent = i18n(key); clearTimeout(b._t); b._t = setTimeout(() => { b.textContent = i18n('menu.share'); }, 1800); };
  const fallback = () => { try { history.replaceState(null, '', '?seed=' + SEED); } catch (e) { /* ignore */ } say('menu.inurl'); };
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(() => say('menu.copied'), fallback);
    else fallback();
  } catch (e) { fallback(); }
}
function startPlay() {
  initAudio();
  goFullscreenLandscape();
  GAME.state = 'play'; GAME.paused = false;
  show('menu', false); show('scrim', false); show('hud', true); show('result', false); show('pause', false); show('help', false); show('settings', false);
  $('replaytag').hidden = true;
  for (const id of ['hud-left', 'hud-right', 'hud-bottom', 'minimap', 'prompt']) $(id).style.visibility = '';
  show('touch', IS_TOUCH);
  resetRun();
  $('hud-msg').innerHTML = '';
}
function togglePause(force) {
  if (GAME.state !== 'play') return;
  GAME.paused = force !== undefined ? force : !GAME.paused;
  show('pause', GAME.paused);
  if (GAME.paused) setTimeout(() => $('bresume').focus(), 30);
}
function cycleCam() { CAM.mode = (CAM.mode + 1) % 4; CAM.shot = null; SETTINGS.cam = CAM.mode; saveSettings(); SFX.click(); }
function toggleHelp(on) { const h = $('help'); h.hidden = on !== undefined ? !on : !h.hidden; if (!h.hidden) { if (GAME.state === 'play') togglePause(true); setTimeout(() => $('bhelpclose').focus(), 30); } }
function refreshSettings() {
  $('olang').textContent = LANG === 'pt' ? 'Português' : 'English';
  $('oq').textContent = i18n('quality.' + SETTINGS.quality);
  $('os').textContent = i18n(SETTINGS.sound ? 'state.on' : 'state.off');
  $('oi').textContent = i18n(SETTINGS.invert ? 'state.yes' : 'state.no');
  $('of').textContent = i18n(SETTINGS.smoke ? 'state.on' : 'state.off');
  $('oa').textContent = i18n(SETTINGS.assist ? 'state.on' : 'state.off');
  const st = WORLD.genStats || {};
  $('perfnote').textContent = i18n('set.perfnote', { cell: CELL0, samples: fmt(WORLD.L0.nx * WORLD.L0.nz), time: ((st.heights || 0) / 1000).toFixed(1), trees: fmt(st.trees || 0) });
}
function applyQuality() {
  const Q = QUALITY_PRESETS[SETTINGS.quality];
  PERF.prMax = Math.min(window.devicePixelRatio || 1, Q.pr);
  PERF.pr = PERF.prMax;
  R.renderer.setPixelRatio(PERF.pr);
  R.renderer.setSize(window.innerWidth, window.innerHeight, false);
}
function wireUi() {
  const click = (id, fn) => $(id).addEventListener('click', (e) => { initAudio(); fn(e); });
  click('bplay', startPlay);
  click('bhelp', () => toggleHelp(true));
  click('bhelpclose', () => toggleHelp(false));
  click('bsettings', () => { refreshSettings(); show('settings', true); setTimeout(() => $('bsetclose').focus(), 30); });
  click('bsetclose', () => show('settings', false));
  click('olang', () => setLang(LANG === 'pt' ? 'en' : 'pt'));
  click('oq', () => { const k = Object.keys(QUALITY_PRESETS); SETTINGS.quality = k[(k.indexOf(SETTINGS.quality) + 1) % k.length]; saveSettings(); applyQuality(); refreshSettings(); });
  click('os', () => { setMute(SETTINGS.sound); refreshSettings(); });
  click('oi', () => { SETTINGS.invert = !SETTINGS.invert; saveSettings(); refreshSettings(); });
  click('of', () => { SETTINGS.smoke = !SETTINGS.smoke; saveSettings(); refreshSettings(); });
  click('oa', () => { SETTINGS.assist = !SETTINGS.assist; saveSettings(); refreshSettings(); });
  click('bagain', startPlay);
  click('bnew', () => newWorld(0, false));
  click('bnew2', () => newWorld(0, true));
  click('bshare', shareWorld);
  click('breplay', startReplay);
  click('bmenu', toMenu);
  click('bresume', () => togglePause(false));
  click('brestart', startPlay);
  click('bpmenu', toMenu);
  click('bskip', endReplay);
  click('btncam', cycleCam);
  click('btnpause', () => togglePause());
}
function onKey(code) {
  initAudio();
  if (code === 'KeyH' || code === 'Slash') { toggleHelp(); return; }
  if (!$('help').hidden && (code === 'Escape' || code === 'Enter')) { toggleHelp(false); return; }
  if (!$('settings').hidden && code === 'Escape') { show('settings', false); return; }
  if (code === 'KeyM') { setMute(SETTINGS.sound); return; }
  if (GAME.state === 'loading') return;
  if (GAME.state === 'menu') { if (code === 'Space') startPlay(); else if (code === 'KeyN') newWorld(0, false); return; }
  if (GAME.state === 'result') { if (code === 'KeyR' || code === 'Space') startPlay(); else if (code === 'KeyN') newWorld(0, true); else if (code === 'Escape') toMenu(); return; }
  if (GAME.state === 'replay') { if (code === 'Escape' || code === 'Space') endReplay(); return; }
  if (GAME.state !== 'play') return;
  if (code === 'KeyP' || code === 'Escape') { togglePause(); return; }
  if (GAME.paused) { if (code === 'KeyR') startPlay(); return; }
  if (code === 'Space') { IN.actionHeld = true; action(); }
  else if (code === 'KeyR') startPlay();
  else if (code === 'KeyC') cycleCam();
  else if (code === 'KeyF') { SETTINGS.smoke = !SETTINGS.smoke; saveSettings(); }
}
function onPadButton(i) {
  initAudio();
  if (GAME.state === 'menu' && (i === 0 || i === 9)) { startPlay(); return; }
  if (GAME.state === 'result' && i === 0) { startPlay(); return; }
  if (GAME.state === 'replay' && (i === 0 || i === 1)) { endReplay(); return; }
  if (GAME.state !== 'play') return;
  if (i === 9) togglePause();
  else if (!GAME.paused && i === 0) action();
  else if (!GAME.paused && i === 1) cycleCam();
  else if (!GAME.paused && i === 3) startPlay();
}

// ------------------------------------------------------------ main loop
const PERF = { acc: 0, n: 0, pr: 1, prMax: 1, t: 0 };
let _lastT = 0, _acc = 0, _frameN = 0;
function loop(now) {
  requestAnimationFrame(loop);
  let dt = (now - _lastT) / 1000; _lastT = now;
  if (!(dt > 0)) dt = 1 / 60;
  if (dt > 0.1) dt = 0.1;
  if (GAME.state === 'loading') return;   // a new world is being built
  _frameN++;
  U.uTime.value += dt;
  const gp = pollGamepad(onPadButton);
  const st = GAME.state;
  if ((st === 'menu' || st === 'play' || st === 'result') && !GAME.paused) {
    GAME.lastPos.copy(SIM.pos);
    if (st === 'menu') {
      autopilot(INPUT, R.gates, dt);
      GAME.attractT += dt;
      if (SIM.phase === 'ready' && GAME.attractT > 3.2) doJump();
      if ((SIM.phase === 'landed' || SIM.phase === 'crashed') && SIM.phaseT > 5) { resetRun(); GAME.attractT = 0; }
    } else if (st === 'play') { if (AUTO.on) autopilot(INPUT, R.gates, dt); else readControls(dt, SIM.phase, gp); }
    else { INPUT.pitch = INPUT.roll = 0; INPUT.brakeL = INPUT.brakeR = 0; }
    _acc += dt;
    const h = 1 / 120;
    let n = 0;
    while (_acc >= h && n < 14) { physicsStep(h); _acc -= h; n++; }
    if (n >= 14) _acc = 0;
    const flying = SIM.phase === 'fly' || SIM.phase === 'exit' || SIM.phase === 'deploy' || SIM.phase === 'canopy';
    SIM.prox = flying ? proximity(SIM.pos) : 999;
    handleEvents();
    // gameplay only scores the tracked run; attract mode still passes gates for show
    if (st !== 'result') {
      const savedScore = GAME.score;
      gameplay(dt);
      if (st === 'menu') GAME.score = savedScore;
    }
    computeVis(dt);
    if (st === 'play' && SIM.phase !== 'ready') recordFrame(dt);
    if (GAME.endT >= 0) {
      GAME.endT += dt;
      if (st === 'play' && GAME.endT > (SIM.outcome === 'crash' ? 2.4 : 3.4)) showResults();
    }
  } else if (st === 'replay') replayUpdate(dt);
  applyVis(dt);
  const cam = R.camera;
  updateCamera(dt, cam, camState(), camModeNow());
  if (GAME.debugCam) { cam.position.fromArray(GAME.debugCam.p); cam.up.set(0, 1, 0); cam.lookAt(new THREE.Vector3().fromArray(GAME.debugCam.t)); cam.fov = GAME.debugCam.fov || 60; cam.updateProjectionMatrix(); }
  cam.updateMatrixWorld();
  updateLandingAids(dt, cam);
  R.sky.position.copy(cam.position);
  R.projScreen.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
  R.frustum.setFromProjectionMatrix(R.projScreen);
  const Q = QUALITY_PRESETS[SETTINGS.quality];
  for (const T of R.terrain) T.update(cam, Q.lod);
  updateTrees(cam);
  if (_frameN % 24 === 0) sortClouds(cam);
  const smoke = SETTINGS.smoke && (VIS.phase === 'fly' || VIS.phase === 'exit' || (VIS.phase === 'deploy' && VIS.phaseT < 0.5));
  updateTrail(dt, VIS.feet, smoke || (st === 'menu' && (VIS.phase === 'fly' || VIS.phase === 'exit')), cam, U.uTime.value);
  updateSpeedLines(cam, (VIS.phase === 'fly' || VIS.phase === 'exit') && camModeNow() !== 3 ? VIS.vel : _g1.set(0, 0, 0), dt);
  updateGates(dt);
  const airborne = VIS.phase === 'fly' || VIS.phase === 'exit' || VIS.phase === 'deploy' || VIS.phase === 'canopy';
  updateBirds(dt, airborne ? VIS.pos : null);
  // windsock
  if (R.sock) {
    const p = R.sock.geometry.attributes.position, b = R.sockBase, t = U.uTime.value;
    for (let i = 0; i < p.count; i++) { const x = b[i * 3]; p.setY(i, b[i * 3 + 1] - x * 0.12 + Math.sin(t * 7 + x * 2.2) * 0.05 * x); p.setZ(i, b[i * 3 + 2] + Math.sin(t * 5 + x * 1.7) * 0.06 * x); }
    p.needsUpdate = true;
    R.sock.rotation.y = -Math.atan2(WIND.z, WIND.x);
  }
  $('mist').style.opacity = (mistAmount(cam.position) * 0.92).toFixed(3);
  if (st === 'play') updateHud(dt);
  updateAudio(dt, { phase: st === 'menu' ? 'menu' : VIS.phase, vel: VIS.vel, prox: VIS.prox, bank: SIM.bank, thrust: VIS.thrust });
  R.renderer.render(R.scene, cam);
  // adaptive resolution
  PERF.acc += dt; PERF.n++;
  if (PERF.acc > 2 && !GAME.noAdapt) {
    const avg = PERF.acc / PERF.n;
    let pr = PERF.pr;
    if (avg > 0.026 && pr > 0.6) pr = Math.max(0.6, pr - 0.15);
    else if (avg < 0.0145 && pr < PERF.prMax) pr = Math.min(PERF.prMax, pr + 0.1);
    if (pr !== PERF.pr) { PERF.pr = pr; R.renderer.setPixelRatio(pr); R.renderer.setSize(window.innerWidth, window.innerHeight, false); }
    PERF.acc = 0; PERF.n = 0;
  }
}

// debug/test helper: advance the simulation without rendering
function simulate(sec, log) {
  const h = 1 / 120, n = Math.round(sec / h);
  const out = [];
  for (let i = 0; i < n; i++) {
    GAME.lastPos.copy(SIM.pos);
    autopilot(INPUT, R.gates, h);
    physicsStep(h);
    if (i % 6 === 0) SIM.prox = (SIM.phase === 'fly' || SIM.phase === 'exit' || SIM.phase === 'deploy' || SIM.phase === 'canopy') ? proximity(SIM.pos) : 999;
    handleEvents();
    gameplay(h);
    computeVis(h);
    if (GAME.state === 'play') recordFrame(h);
    if (GAME.endT >= 0) GAME.endT += h;
    if (log && i % 120 === 0) out.push([+SIM.time.toFixed(1), SIM.phase, Math.round(SIM.pos.x), Math.round(SIM.pos.y), Math.round(SIM.pos.z), Math.round(SIM.vel.length() * 3.6), Math.round(SIM.pos.y - groundHeight(SIM.pos.x, SIM.pos.z)), Math.round(SIM.prox), AUTO.gate, GAME.gatesPassed, SIM.alpha.toFixed(1), (SIM.bank / DEG).toFixed(0)]);
    if (SIM.phase === 'landed' || SIM.phase === 'crashed') { if (log) out.push(['end', SIM.phase, SIM.crashCause, SIM.landing && SIM.landing.kind, SIM.landing && Math.round(SIM.landing.dist)]); break; }
  }
  return out;
}

// test helper: fly with a fixed stick input (no autopilot)
function simulateFixed(sec, pitch, roll) {
  const h = 1 / 120, n = Math.round(sec / h), out = [];
  for (let i = 0; i < n; i++) {
    GAME.lastPos.copy(SIM.pos);
    INPUT.pitch = pitch; INPUT.roll = roll || 0; INPUT.deploy = false;
    physicsStep(h);
    if (i % 6 === 0) SIM.prox = (SIM.phase === 'fly' || SIM.phase === 'exit') ? proximity(SIM.pos) : 999;
    handleEvents(); gameplay(h); computeVis(h);
    if (i % 60 === 0) out.push([+SIM.time.toFixed(1), SIM.phase, Math.round(SIM.pos.x), Math.round(SIM.pos.y), Math.round(SIM.pos.z), Math.round(SIM.vel.length() * 3.6), Math.round(SIM.pos.y - groundHeight(SIM.pos.x, SIM.pos.z)), Math.round(SIM.prox)]);
    if (SIM.phase === 'crashed' || SIM.phase === 'landed') { out.push(['end', SIM.phase, SIM.crashCause, +SIM.time.toFixed(1)]); break; }
  }
  return out;
}

// ------------------------------------------------------------ boot
async function boot() {
  const bar = $('loadbar'), msg = $('loadmsg');
  applyI18n();
  $('loadinfo').textContent = `${worldName(SEED)} · #${SEED}`;
  const progress = (p, text) => { bar.style.width = `${Math.round(p * 100)}%`; if (text) msg.textContent = text; };
  try {
    const test = document.createElement('canvas').getContext('webgl2');
    if (!test) throw new Error('webgl2');
    initRenderer();
    applyQuality();
    CAM.mode = SETTINGS.cam || 0;
    // things that outlive a world: sky, smoke trail, speed lines, the pilot and the canopy
    buildSky();
    buildTrail();
    buildSpeedLines();
    JUMPER = new Jumper();
    R.scene.add(JUMPER.root);
    CANOPY = new Canopy();
    CANOPY.add(R.scene);
    await buildWorldScene(progress);
    wireUi();
    initInput(onKey, action);
    window.addEventListener('resize', () => {
      R.camera.aspect = window.innerWidth / window.innerHeight; R.camera.updateProjectionMatrix();
      R.renderer.setSize(window.innerWidth, window.innerHeight, false);
    });
    document.addEventListener('visibilitychange', () => { if (document.hidden && GAME.state === 'play') togglePause(true); });
    settleWorld();
    show('loading', false);
    toMenu();
    _lastT = performance.now();
    requestAnimationFrame(loop);
    window.__emilius = {
      SIM, GAME, VIS, R, WORLD, INPUT, AUTO, AID, MARKS, CAM, BIRDS, SETTINGS_REF: SETTINGS,
      get TC() { return TC; }, get SEED() { return SEED; }, get STYLE() { return STYLE; },
      startPlay, doJump, computeScore, groundHeight, surfaceHeight, simulate, simulateFixed, resetRun, showResults, startReplay, toMenu, newWorld,
      lookFrom: (p, t, fov) => { if (p && p.length === 4) { p = [p[0], groundHeight(p[0], p[2]) + p[3], p[2]]; } GAME.debugCam = p ? { p, t, fov } : null; },
    };
  } catch (err) {
    console.error(err);
    const e = $('loaderr');
    e.hidden = false;
    e.textContent = err && err.message === 'webgl2'
      ? i18n('error.webgl2')
      : i18n('error.worldbuild') + (err && err.message ? err.message : err);
    msg.textContent = '';
  }
}
if (window.claude && window.claude.hot) {
  try { window.claude.hot.snapshot && window.claude.hot.snapshot(() => ({ best: GAME.best })); } catch (e) { /* optional */ }
  if (window.claude.hot.ready) window.claude.hot.ready(() => boot()); else boot();
} else boot();
