// ================================================================ CAMERA
const CAM = {
  mode: 0, nameKeys: ['cam.chase', 'cam.helmet', 'cam.drone', 'cam.cinema'],
  dir: new THREE.Vector3(0, 0, -1), upS: new THREE.Vector3(0, 1, 0),
  pos: new THREE.Vector3(), look: new THREE.Vector3(),
  fov: 70, trauma: 0, t: 0,
  shot: null, shotT: 0, orbitA: 0,
};
const _cq = new THREE.Quaternion(), _ce = new THREE.Vector3(), _cf = new THREE.Vector3(), _cu = new THREE.Vector3(), _cr = new THREE.Vector3();

function camNoise(t, seed) { return TC.noise(t * 1.7 + seed * 13.1, seed * 7.3 - t * 0.6); }
function addTrauma(x) { CAM.trauma = Math.min(1, CAM.trauma + x); }

function camKeepAboveGround(p, clearance) {
  const g = groundHeight(p.x, p.z);
  if (p.y < g + clearance) p.y = g + clearance;
  const water = lakeDist(p.x, p.z) < TC.LAKE.r + 5 ? TC.LAKE.level : -1e9;
  if (p.y < water + 0.6) p.y = water + 0.6;
}

// cinematic shot planner (used by attract mode, replay and the "Cinema" camera)
function planShot(state, forceKind) {
  const kinds = state.phase === 'canopy' ? ['canopyOrbit', 'canopySide', 'chase'] : ['flyby', 'side', 'chase', 'flyby', 'low'];
  const kind = forceKind || kinds[Math.floor(Math.random() * kinds.length)];
  const shot = { kind, t: 0, dur: 5 + Math.random() * 3 };
  const p = state.pos, v = state.vel;
  if (kind === 'flyby' || kind === 'low') {
    const ahead = clamp(v.length() * 2.8, 40, 200);
    const f = _cf.copy(v).normalize();
    const side = _cr.crossVectors(f, WORLD_UP).normalize();
    const s = Math.random() < 0.5 ? -1 : 1;
    const pt = p.clone().addScaledVector(f, ahead).addScaledVector(side, s * (18 + Math.random() * 22));
    pt.y += kind === 'low' ? -6 : 4 + Math.random() * 10;
    camKeepAboveGround(pt, kind === 'low' ? 3 : 8);
    shot.point = pt; shot.dur = clamp(ahead / Math.max(10, v.length()) * 2 + 1.2, 3.5, 7);
    shot.fov = 34 + Math.random() * 12;
  } else if (kind === 'side') { shot.s = Math.random() < 0.5 ? -1 : 1; shot.fov = 55; }
  else if (kind === 'canopyOrbit') { shot.a = Math.random() * 6.28; shot.fov = 50; }
  else if (kind === 'canopySide') { shot.s = Math.random() < 0.5 ? -1 : 1; shot.fov = 48; }
  return shot;
}

// state: { phase, pos, vel, quat, headPos, canopyPos, heading, bank }
function updateCamera(dt, cam, st, mode) {
  CAM.t += dt;
  const P = st.pos, V = st.vel, spd = V.length();
  let fov = 70, look = CAM.look, pos = CAM.pos;
  let upBlend = 0;
  let clear = 1.4;
  const phase = st.phase;
  if (phase === 'ready' || phase === 'menu-stand') {
    CAM.orbitA += dt * 0.05;
    const h = st.heading;
    const f = headingVec(h, _cf);
    const r = _cr.set(-f.z, 0, f.x);
    const sw = Math.sin(CAM.orbitA) * 1.4;
    pos.copy(P).addScaledVector(f, -4.4).addScaledVector(r, 1.7 + sw).add(_ce.set(0, 2.3, 0));
    look.copy(P).addScaledVector(f, 34).add(_ce.set(0, -21, 0)).addScaledVector(r, 3);
    fov = 74;
    CAM.dir.copy(f);
  } else if (phase === 'crashed') {
    fov = 64;
    look.lerp(P, 1 - Math.exp(-dt * 3));
    const back = _cf.copy(pos).sub(P); if (back.length() < 12) pos.addScaledVector(back.normalize(), dt * 8);
    pos.y += dt * 1.5;
  } else if (phase === 'landed') {
    CAM.orbitA += dt * 0.25;
    const r = 7 + Math.min(4, st.phaseT * 0.8);
    const tp = _ce.set(P.x + Math.cos(CAM.orbitA) * r, P.y + 1.6 + Math.min(3, st.phaseT * 0.4), P.z + Math.sin(CAM.orbitA) * r);
    pos.lerp(tp, 1 - Math.exp(-dt * 2));
    look.lerp(_cf.set(P.x, P.y + 0.3, P.z), 1 - Math.exp(-dt * 4));
    fov = 60;
  } else if (mode === 3) {
    // cinema
    if (!CAM.shot || CAM.shot.t > CAM.shot.dur) CAM.shot = planShot(st);
    const S = CAM.shot; S.t += dt;
    const f = _cf.copy(V).normalize();
    if (S.kind === 'flyby' || S.kind === 'low') { pos.copy(S.point); look.lerp(P, 1 - Math.exp(-dt * 12)); fov = S.fov; }
    else if (S.kind === 'side') {
      const side = _cr.crossVectors(f, WORLD_UP).normalize();
      pos.copy(P).addScaledVector(side, S.s * 9).addScaledVector(f, 4).add(_ce.set(0, 1.2, 0));
      look.copy(P).addScaledVector(f, 2); fov = S.fov;
    } else if (S.kind === 'canopyOrbit') {
      S.a += dt * 0.35;
      pos.set(P.x + Math.cos(S.a) * 16, P.y + 4, P.z + Math.sin(S.a) * 16);
      look.copy(st.canopyMid); fov = S.fov;
    } else if (S.kind === 'canopySide') {
      const hf = headingVec(st.heading, _cf);
      const side = _cr.set(-hf.z, 0, hf.x);
      pos.copy(P).addScaledVector(side, S.s * 13).addScaledVector(hf, 6).add(_ce.set(0, 2.5, 0));
      look.copy(st.canopyMid); fov = S.fov;
    } else { mode = 0; }
    clear = 2;
  }
  if ((phase === 'fly' || phase === 'deploy' || phase === 'exit') && (mode === 0 || mode === 2 || (mode === 3 && CAM.shot && CAM.shot.kind === 'chase'))) {
    const vdir = spd > 2 ? _cf.copy(V).divideScalar(spd) : headingVec(st.heading, _cf);
    CAM.dir.lerp(vdir, 1 - Math.exp(-dt * (phase === 'exit' ? 2 : 5))).normalize();
    const d = CAM.dir;
    if (mode === 2) {
      const side = _cr.crossVectors(d, WORLD_UP).normalize();
      pos.copy(P).addScaledVector(side, 7).addScaledVector(d, 2.5).add(_ce.set(0, 1.4, 0));
      look.copy(P).addScaledVector(d, 3);
      fov = 62;
    } else {
      const back = phase === 'deploy' ? 9 : 6.2;
      pos.copy(P).addScaledVector(d, -back).add(_ce.set(0, 1.25 + (phase === 'deploy' ? 1.5 : 0), 0));
      pos.addScaledVector(st.up, 0.55);
      look.copy(P).addScaledVector(d, 14);
      fov = lerp(66, 86, smoothstep(25, 72, spd));
      upBlend = 0.28;
    }
  } else if (phase === 'canopy' && (mode === 0 || mode === 2 || (mode === 3 && CAM.shot && CAM.shot.kind === 'chase'))) {
    // yaw the view part of the way toward the landing target while it's roughly ahead,
    // and look down at the ground ahead while high so the landing area stays in frame
    const tb = Math.atan2(TC.LZ.x - P.x, -(TC.LZ.z - P.z));
    const dh = wrapAngle(tb - st.heading);
    const bias = mode === 2 ? 0 : dh * 0.3 * smoothstep(2.4, 1.3, Math.abs(dh));
    const want = headingVec(st.heading + bias, _cf);
    CAM.dir.lerp(want, 1 - Math.exp(-dt * 2.2)).normalize();
    const hi = smoothstep(12, 70, P.y - groundHeight(P.x, P.z));
    if (mode === 2) {
      const side = _cr.set(-CAM.dir.z, 0, CAM.dir.x);
      pos.copy(P).addScaledVector(side, 16).addScaledVector(CAM.dir, 4).add(_ce.set(0, lerp(3.2, 7, hi), 0));
      look.copy(P).add(_ce.set(0, lerp(3.2, 1, hi), 0));
    } else {
      // stay under the wing (pilot and canopy both in frame) but pitch down toward the ground ahead
      pos.copy(P).addScaledVector(CAM.dir, -lerp(12.5, 19, hi)).add(_ce.set(0, lerp(3.4, 5, hi), 0));
      look.copy(P).addScaledVector(CAM.dir, lerp(5, 14, hi)).add(_ce.set(0, lerp(3.3, -6, hi), 0));
    }
    fov = lerp(64, 70, hi);
    clear = 1.6;
  }
  if (mode === 1 && (phase === 'fly' || phase === 'deploy' || phase === 'canopy' || phase === 'exit')) {
    // helmet cam (GoPro on top of the helmet)
    pos.copy(st.headPos);
    const q = st.quat;
    const bodyFwd = _cf.set(0, 0, -1).applyQuaternion(q);
    const bodyUp = _cu.set(0, 1, 0).applyQuaternion(q);
    if (phase === 'canopy') {
      const hf = headingVec(st.heading, _ce);
      look.copy(pos).addScaledVector(hf, 10).add(_cr.set(0, -4.2, 0));
      pos.addScaledVector(hf, 0.15);
    } else {
      pos.addScaledVector(bodyUp, 0.2).addScaledVector(bodyFwd, 0.05);
      look.copy(pos).addScaledVector(bodyFwd, 10).addScaledVector(bodyUp, -1.6);
    }
    fov = 102;
    upBlend = phase === 'canopy' ? 0 : 1;
    clear = 0.5;
  }
  // camera up vector: partially follow the pilot's bank
  const wantUp = _cu.copy(WORLD_UP).lerp(st.up, upBlend).normalize();
  CAM.upS.lerp(wantUp, 1 - Math.exp(-dt * 6)).normalize();
  if (mode !== 1) camKeepAboveGround(pos, clear);
  // shake
  CAM.trauma = Math.max(0, CAM.trauma - dt * 0.9);
  const buffet = (phase === 'fly' ? smoothstep(45, 80, spd) * 0.22 + (st.prox < 25 ? 0.12 * (1 - st.prox / 25) : 0) : 0);
  const sh = CAM.trauma * CAM.trauma + buffet * buffet;
  const t = CAM.t;
  cam.position.copy(pos);
  cam.position.x += camNoise(t * 9, 1) * sh * 0.5;
  cam.position.y += camNoise(t * 9, 2) * sh * 0.5;
  cam.position.z += camNoise(t * 9, 3) * sh * 0.5;
  cam.up.copy(CAM.upS);
  cam.lookAt(look);
  cam.rotateZ(camNoise(t * 7, 4) * sh * 0.08);
  CAM.fov = damp(CAM.fov, fov, 3, dt);
  if (Math.abs(cam.fov - CAM.fov) > 0.01) { cam.fov = CAM.fov; cam.near = mode === 1 ? 0.12 : 0.3; cam.updateProjectionMatrix(); }
}
