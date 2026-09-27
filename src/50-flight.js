// ================================================================ FLIGHT
const WS = {
  m: 85, S: 1.45,
  aTab: [-4, 0, 4, 8, 12, 16, 20, 25, 30, 40],
  clTab: [-0.10, 0.05, 0.22, 0.40, 0.56, 0.68, 0.75, 0.72, 0.62, 0.45],
  cdTab: [0.16, 0.15, 0.15, 0.162, 0.178, 0.212, 0.265, 0.36, 0.47, 0.68],
  aMin: 3, aTrim: 12, aMax: 21, bankMax: 70 * DEG,
};
const WIND = new THREE.Vector3(1.4, 0, 0.5);   // light WSW breeze in the valley
const G = 9.81;
function tab(xs, ys, x) {
  if (x <= xs[0]) return ys[0];
  for (let i = 0; i < xs.length - 1; i++) if (x <= xs[i + 1]) return lerp(ys[i], ys[i + 1], (x - xs[i]) / (xs[i + 1] - xs[i]));
  return ys[ys.length - 1];
}

const SIM = {
  phase: 'menu', time: 0, phaseT: 0,
  pos: new THREE.Vector3(), vel: new THREE.Vector3(), prev: new THREE.Vector3(),
  alpha: 12, bank: 0, heading: 0, inflate: 0,
  deployT: 0, openShock: 0,
  u: 0, w: 0, yawRate: 0, flare: 0, toggleL: 0, toggleR: 0, swingRoll: 0, swingPitch: 0,
  quat: new THREE.Quaternion(), liftDir: new THREE.Vector3(0, 1, 0),
  agl: 0, prox: 999, gLoad: 1, warn: 0, airT: 0, scrapeCool: 0,
  outcome: null, crashCause: null, landing: null,
};
const INPUT = { pitch: 0, roll: 0, brakeL: 0, brakeR: 0, deploy: false, jump: false };

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _m4 = new THREE.Matrix4();
const WORLD_UP = new THREE.Vector3(0, 1, 0);

function headingVec(h, out) { return out.set(Math.sin(h), 0, -Math.cos(h)); }

// flight frame: velocity direction, lift direction (banked), right
function flightFrame(vel, bank, heading, outFwd, outUp, outRight) {
  const V = vel.length();
  if (V > 0.3) outFwd.copy(vel).divideScalar(V); else headingVec(heading, outFwd).multiplyScalar(0.3).add(_v3.set(0, -1, 0)).normalize();
  // "up" perpendicular to the velocity, biased towards 'back' so it stays defined in a vertical dive
  headingVec(heading, _v3).negate();
  outUp.copy(WORLD_UP).addScaledVector(outFwd, -outFwd.y);
  _v3.addScaledVector(outFwd, -_v3.dot(outFwd));
  outUp.addScaledVector(_v3, 0.03);
  outUp.normalize();
  outRight.crossVectors(outFwd, outUp).normalize();
  // bank rotates lift around the velocity
  const c = Math.cos(bank), s = Math.sin(bank);
  const ux = outUp.x * c + outRight.x * s, uy = outUp.y * c + outRight.y * s, uz = outUp.z * c + outRight.z * s;
  const rx = outRight.x * c - outUp.x * s, ry = outRight.y * c - outUp.y * s, rz = outRight.z * c - outUp.z * s;
  outUp.set(ux, uy, uz); outRight.set(rx, ry, rz);
}

const _fwd = new THREE.Vector3(), _up = new THREE.Vector3(), _right = new THREE.Vector3();
function stepWingsuit(dt, inp, liftScale = 1) {
  const s = SIM;
  const V = s.vel.length();
  const rho = 1.225 * Math.exp(-s.pos.y / 8500);
  const p = clamp(inp.pitch, -1, 1);
  const aT = p >= 0 ? lerp(WS.aTrim, WS.aMax, p) : lerp(WS.aTrim, WS.aMin, -p);
  s.alpha = damp(s.alpha, aT, 3.4, dt);
  s.bank = damp(s.bank, clamp(inp.roll, -1, 1) * WS.bankMax, 2.6, dt);
  s.inflate = Math.min(1, s.inflate + dt / 1.6);
  const inf = smoothstep(0, 1, s.inflate) * smoothstep(4, 16, V) * liftScale;
  const sb = Math.abs(Math.sin(s.bank));
  const cl = tab(WS.aTab, WS.clTab, s.alpha) * inf * (1 + 0.5 * sb);
  const cd = lerp(0.36, tab(WS.aTab, WS.cdTab, s.alpha), inf) * (1 + 0.12 * sb);
  const q = 0.5 * rho * V * V * WS.S / WS.m;
  flightFrame(s.vel, s.bank, s.heading, _fwd, _up, _right);
  const aL = q * cl, aD = q * cd;
  s.vel.x += (_up.x * aL - _fwd.x * aD) * dt;
  s.vel.y += (_up.y * aL - _fwd.y * aD - G) * dt;
  s.vel.z += (_up.z * aL - _fwd.z * aD) * dt;
  s.pos.addScaledVector(s.vel, dt);
  s.gLoad = aL / G;
  if (s.vel.x * s.vel.x + s.vel.z * s.vel.z > 1) s.heading = Math.atan2(s.vel.x, -s.vel.z);
  s.liftDir.copy(_up);
}
function wingsuitQuat(out) {
  const s = SIM;
  flightFrame(s.vel, s.bank, s.heading, _fwd, _up, _right);
  const a = s.alpha * DEG * smoothstep(0, 1, s.inflate);
  const ca = Math.cos(a), sa = Math.sin(a);
  const fx = _fwd.x * ca + _up.x * sa, fy = _fwd.y * ca + _up.y * sa, fz = _fwd.z * ca + _up.z * sa;
  const ux = _up.x * ca - _fwd.x * sa, uy = _up.y * ca - _fwd.y * sa, uz = _up.z * ca - _fwd.z * sa;
  _v1.set(fx, fy, fz); _v2.set(ux, uy, uz);
  _v3.crossVectors(_v1, _v2);
  _m4.makeBasis(_v3, _v2, _v1.negate());
  return out.setFromRotationMatrix(_m4);
}
function standQuat(heading, lean, out) {
  // body vertical (head up), facing heading, leaning forward by 'lean'
  const f = headingVec(heading, _v1);
  const bodyAxis = _v2.copy(WORLD_UP).multiplyScalar(Math.cos(lean)).addScaledVector(f, Math.sin(lean)).normalize(); // head direction
  const back = _v3.copy(f).negate().multiplyScalar(Math.cos(lean)).addScaledVector(WORLD_UP, Math.sin(lean)).normalize(); // body +Y
  const right = new THREE.Vector3().crossVectors(bodyAxis, back);
  _m4.makeBasis(right, back, bodyAxis.clone().negate());
  return out.setFromRotationMatrix(_m4);
}

function stepDeploy(dt, inp) {
  const s = SIM;
  s.deployT += dt;
  const d = s.deployT;
  if (d < 0.95) {
    // pilot chute out, bag lifting: the suit still flies, arms coming in
    stepWingsuit(dt, { pitch: 0.2, roll: 0 }, 1 - smoothstep(0.2, 0.95, d) * 0.6);
    const V = s.vel.length();
    const extra = 0.5 * 1.1 * V * V * 0.9 * smoothstep(0.35, 0.95, d) / WS.m;
    s.vel.addScaledVector(_v1.copy(s.vel).normalize(), -extra * dt);
  } else {
    // canopy inflation: decelerate toward flying speed with a capped opening shock
    const h = s.heading;
    const vt = _v1.set(Math.sin(h) * 11 + WIND.x, -5.2, -Math.cos(h) * 11 + WIND.z);
    const diff = _v2.subVectors(vt, s.vel);
    const L = diff.length();
    const aMax = 36 * smoothstep(0.95, 1.35, d) * (1 - smoothstep(1.9, 2.5, d) * 0.6) + 4;
    const step = Math.min(L, aMax * dt);
    if (L > 1e-4) s.vel.addScaledVector(diff, step / L);
    s.openShock = Math.max(s.openShock, (step / dt) / G);
    s.pos.addScaledVector(s.vel, dt);
    s.gLoad = step / dt / G;
  }
  if (s.vel.x * s.vel.x + s.vel.z * s.vel.z > 1) s.heading = Math.atan2(s.vel.x, -s.vel.z);
  if (d >= 2.45) {
    s.phase = 'canopy'; s.phaseT = 0;
    s.u = clamp(Math.hypot(s.vel.x - WIND.x, s.vel.z - WIND.z), 5, 14);
    s.w = clamp(-s.vel.y, 2.5, 8);
    s.yawRate = 0; s.flare = 0;
    EVENTS.push({ type: 'canopyOpen' });
  }
}

function stepCanopy(dt, inp) {
  const s = SIM;
  s.toggleL = damp(s.toggleL, clamp(inp.brakeL, 0, 1), 7, dt);
  s.toggleR = damp(s.toggleR, clamp(inp.brakeR, 0, 1), 7, dt);
  const brake = Math.min(s.toggleL, s.toggleR);
  const turn = s.toggleR - s.toggleL;
  const front = Math.max(0, -inp.pitch);
  const uT = lerp(11.2, 3.8, Math.pow(brake, 0.85)) + front * 2.6;
  const uPrev = s.u;
  s.u = damp(s.u, uT, 1.35, dt);
  const dec = Math.max(0, (uPrev - s.u) / dt);
  s.flare = damp(s.flare, dec * 1.2, 2.6, dt);
  const stall = brake > 0.93 ? (brake - 0.93) * 16 : 0;
  const wSteady = lerp(4.8, 2.7, smoothstep(0, 0.7, brake)) + stall + Math.abs(turn) * 3.4 * (s.u / 11) + front * 1.9;
  s.w = damp(s.w, Math.max(0.15, wSteady - s.flare), 2.4, dt);
  s.yawRate = damp(s.yawRate, turn * 1.1 * (0.35 + 0.65 * s.u / 11), 2.3, dt);
  s.heading = wrapAngle(s.heading + s.yawRate * dt);
  s.vel.set(Math.sin(s.heading) * s.u + WIND.x, -s.w, -Math.cos(s.heading) * s.u + WIND.z);
  s.pos.addScaledVector(s.vel, dt);
  s.swingRoll = damp(s.swingRoll, s.yawRate * s.u * 0.085, 2.0, dt);
  s.swingPitch = damp(s.swingPitch, s.flare * 0.07 - front * 0.12 + (s.toggleL + s.toggleR) * 0.05, 2.6, dt);
  s.gLoad = 1;
}

// distance to terrain in all directions (not just straight down)
const PROX_R = [3, 6, 10, 15, 22, 32, 46, 64];
function proximity(p) {
  const g0 = groundHeight(p.x, p.z);
  let best = p.y - g0;
  for (let k = 0; k < 12; k++) {
    const a = k / 12 * Math.PI * 2;
    const cx = Math.cos(a), cz = Math.sin(a);
    let prevR = 0, prevDh = p.y - g0;
    for (const r of PROX_R) {
      if (r > best * 1.05) break;
      const h = groundHeight(p.x + cx * r, p.z + cz * r);
      const dh = p.y - h;
      if (dh <= 0) {   // a wall: crossing between prevR and r
        const f = prevDh / Math.max(1e-3, prevDh - dh);
        best = Math.min(best, prevR + (r - prevR) * f);
        break;
      }
      best = Math.min(best, Math.hypot(r, dh));
      prevR = r; prevDh = dh;
    }
  }
  let tree = 999;
  forEachTreeNear(p.x, p.z, 24, (tx, ty, tz, th, kind) => {
    const top = ty + th;
    const dxz = Math.hypot(p.x - tx, p.z - tz);
    const r = (kind > 1.5 ? 0.3 : 0.18) * th;
    const dy = p.y - top;
    const d = dy > 0 ? Math.hypot(Math.max(0, dxz - r * 0.3), dy) : Math.max(0, dxz - r * (1 - (p.y - ty) / th));
    if (d < tree) tree = d;
  });
  return Math.max(0, Math.min(best, tree + 0.5));
}
function treeHit(p, pad) {
  let hit = false;
  forEachTreeNear(p.x, p.z, 10, (tx, ty, tz, th, kind) => {
    if (hit) return;
    const rel = (p.y - ty) / th;
    if (rel < -0.05 || rel > 0.97) return;
    const r = (kind > 1.5 ? 0.3 : 0.18) * th * (kind > 1.5 ? 1 - Math.abs(rel - 0.62) * 1.4 : 1 - rel) + pad;
    if (Math.hypot(p.x - tx, p.z - tz) < r) hit = true;
  });
  return hit;
}

const ASSIST_INP = { pitch: 0, roll: 0 };
// 0..1: how soon the current path meets the ground (for the auto pull-up)
function groundDanger(s) {
  let d = 0;
  const agl = s.pos.y - groundHeight(s.pos.x, s.pos.z);
  if (agl < 6) d = 1 - agl / 6 * 0.5;
  for (const t of [0.35, 0.7, 1.05, 1.4, 1.8]) {
    const x = s.pos.x + s.vel.x * t, y = s.pos.y + s.vel.y * t, z = s.pos.z + s.vel.z * t;
    if (y - groundHeight(x, z) < 4) { d = Math.max(d, 1 - t / 2.1); break; }
  }
  return d;
}
function terrainNormal(x, z, out) {
  const e = 2;
  const hx = groundHeight(x + e, z) - groundHeight(x - e, z), hz = groundHeight(x, z + e) - groundHeight(x, z - e);
  return out.set(-hx / (2 * e), 1, -hz / (2 * e)).normalize();
}
// grazing contact: bounce off with a speed penalty instead of dying
function scrape(floor, feet, kind) {
  const s = SIM;
  const n = terrainNormal(s.pos.x, s.pos.z, _v2);
  const vn = s.vel.dot(n);
  if (vn < 0) s.vel.addScaledVector(n, -vn * 1.35);
  s.vel.multiplyScalar(kind === 'tree' ? 0.78 : 0.82);
  if (kind !== 'tree') s.pos.y = Math.max(s.pos.y, floor + feet + 0.9);
  s.scrapeCool = 0.5;
  EVENTS.push({ type: 'scrape', kind });
}

const EVENTS = [];
function physicsStep(dt) {
  const s = SIM;
  s.prev.copy(s.pos);
  s.time += dt; s.phaseT += dt;
  s.warn = 0;
  if (s.phase === 'exit') {
    s.airT += dt;
    stepWingsuit(dt, { pitch: 0.15, roll: 0 });   // body position is automatic on the exit
    if (s.phaseT > 1.15) { s.phase = 'fly'; s.phaseT = 0; }
  } else if (s.phase === 'fly') {
    s.airT += dt;
    // stick input fades in over the first seconds so the exit can't be ruined by a held key
    const ease = smoothstep(0, 1.6, s.phaseT);
    ASSIST_INP.pitch = INPUT.pitch * ease + 0.1 * (1 - ease);
    ASSIST_INP.roll = INPUT.roll * ease;
    if (SETTINGS.assist) {
      const danger = groundDanger(s);
      s.warn = danger;
      if (danger > 0) {
        ASSIST_INP.pitch = Math.max(ASSIST_INP.pitch, lerp(0.35, 1, danger));
        ASSIST_INP.roll *= 1 - danger * 0.6;
        if (s.vel.y < 4) s.vel.y += danger * 6.5 * dt;   // the suit 'digs in' harder than a real one would
      }
    }
    stepWingsuit(dt, ASSIST_INP);
    if (INPUT.deploy) { INPUT.deploy = false; s.phase = 'deploy'; s.phaseT = 0; s.deployT = 0; s.deployAlt = s.agl; EVENTS.push({ type: 'deploy' }); }
  } else if (s.phase === 'deploy') {
    stepDeploy(dt, INPUT);
  } else if (s.phase === 'canopy') {
    stepCanopy(dt, INPUT);
  }
  // collisions
  if (s.phase === 'exit' || s.phase === 'fly' || s.phase === 'deploy' || s.phase === 'canopy') {
    const g = groundHeight(s.pos.x, s.pos.z);
    const feet = s.phase === 'canopy' ? 1.02 : 0.28;
    const water = isWater(s.pos.x, s.pos.z);
    const wl = water === 'lake' ? TC.LAKE.level : water === 'river' ? TC.mainFloor(s.pos.x) - 0.9 : -1e9;
    const floor = Math.max(g, wl);
    s.scrapeCool = Math.max(0, (s.scrapeCool || 0) - dt);
    const grace = (s.phase === 'exit' || s.phase === 'fly') && s.airT < 4.5;
    const assisted = SETTINGS.assist && (s.phase === 'exit' || s.phase === 'fly');
    if (s.pos.y - feet <= floor) {
      if (s.phase === 'canopy') { s.pos.y = floor + feet; land(water, g); }
      else if ((grace || assisted) && !water) {
        const n = terrainNormal(s.pos.x, s.pos.z, _v1);
        const into = -s.vel.dot(n);
        if (grace || (into < 17 && s.vel.length() > 13)) scrape(floor, feet, 'ground');
        else { s.pos.y = floor + feet; crash('terrain'); }
      } else { s.pos.y = floor + feet; crash(water ? 'water' : 'terrain'); }
    } else if ((s.phase !== 'canopy' || s.pos.y - g < 40) && treeHit(s.pos, s.phase === 'canopy' ? 0.6 : 0.25)) {
      if (s.phase === 'canopy') { s.landing = { kind: 'tree' }; land('tree', g); }
      else if (grace || assisted) { if (s.scrapeCool <= 0) scrape(floor, feet, 'tree'); }
      else crash('tree');
    }
  }
}
function crash(cause) {
  const s = SIM;
  s.crashSpeed = s.vel.length();
  s.phase = 'crashed'; s.phaseT = 0; s.crashCause = cause; s.outcome = 'crash';
  EVENTS.push({ type: 'crash', cause });
}
function land(water, g) {
  const s = SIM;
  const vs = Math.max(0, -s.vel.y), hs = Math.hypot(s.vel.x, s.vel.z);
  const nx = (groundHeight(s.pos.x + 2, s.pos.z) - groundHeight(s.pos.x - 2, s.pos.z)) / 4;
  const nz = (groundHeight(s.pos.x, s.pos.z + 2) - groundHeight(s.pos.x, s.pos.z - 2)) / 4;
  const slope = Math.hypot(nx, nz);
  let kind;
  if (water === 'tree') kind = 'tree';
  else if (water) kind = 'water';
  else if (slope > 0.75 || vs > 7.5) kind = 'hard';
  else if (vs < 1.9 && hs < 7) kind = 'perfect';
  else if (vs < 3.1) kind = 'good';
  else kind = 'plf';
  s.landing = { kind, vs, hs, slope, dist: Math.hypot(s.pos.x - TC.LZ.x, s.pos.z - TC.LZ.z) };
  s.phase = 'landed'; s.phaseT = 0;
  s.outcome = (kind === 'hard' || kind === 'tree' || kind === 'water') ? 'bad' : 'landed';
  s.vel.set(0, 0, 0);
  EVENTS.push({ type: 'land', kind });
}

// ------------------------------------------------------------ autopilot
// Flies the line: used for the menu's attract mode and the tests.
const AUTO = { on: false, gate: 0 };
function autopilot(inp, gates, dt) {
  const s = SIM;
  inp.deploy = false;
  if (s.phase === 'fly' || s.phase === 'exit') {
    let g = gates[AUTO.gate];
    if (g) {
      const side = (s.pos.x - g.x) * g.n.x + (s.pos.y - g.y) * g.n.y + (s.pos.z - g.z) * g.n.z;
      if (side > 1) { AUTO.gate++; g = gates[AUTO.gate]; }
    }
    let tx, ty, tz;
    if (g) {
      const dg = Math.hypot(g.x - s.pos.x, g.z - s.pos.z);
      const lead = clamp((dg - 60) * 0.35, 0, 70);
      tx = g.x - g.n.x * lead; ty = g.y - g.n.y * lead - 2; tz = g.z - g.n.z * lead;
    } else { tx = TC.LZ.x; tz = TC.LZ.z; ty = TC.LZ.h + 300; }
    const dx = tx - s.pos.x, dz = tz - s.pos.z, dh = Math.hypot(dx, dz);
    const herr = wrapAngle(Math.atan2(dx, -dz) - s.heading);
    inp.roll = clamp(herr * 2.6 - s.bank * 0.25, -1, 1);
    const V = Math.max(1, s.vel.length());
    const gamD = Math.atan2(ty - s.pos.y, Math.max(25, dh));
    const gam = Math.asin(clamp(s.vel.y / V, -1, 1));
    let p = clamp((gamD - gam) * 4.5 + (V < 36 ? -0.6 : 0) + (V > 62 ? 0.25 : 0), -1, 0.75);
    for (const t of [0.6, 1.2, 2.0]) {
      const fx = s.pos.x + s.vel.x * t, fz = s.pos.z + s.vel.z * t, fy = s.pos.y + s.vel.y * t;
      const clr = fy - groundHeight(fx, fz);
      if (clr < 18) p = Math.max(p, clamp(1 - clr / 18, 0.25, 0.8));
    }
    inp.pitch = p;
    // demo-only assist: nudge the flight path onto the gate centre
    if (g && (AUTO.on || GAME_STATE_IS_MENU())) {
      const ex = g.x - s.pos.x, ey = g.y - s.pos.y, ez = g.z - s.pos.z;
      const along = ex * g.n.x + ey * g.n.y + ez * g.n.z;
      if (along > 0 && along < 260) {
        const px = ex - g.n.x * along, py = ey - g.n.y * along, pz = ez - g.n.z * along;
        const k = 0.9 * (1 - along / 260) + 0.25;
        const ax = clamp(px * k, -7, 7), ay = clamp(py * k, -7, 7), az = clamp(pz * k, -7, 7);
        s.vel.x += ax * dt; s.vel.y += ay * dt; s.vel.z += az * dt;
      }
    }
    if (!g && (s.agl < 290 || (dh < 600 && s.agl < 420))) inp.deploy = true;
  } else if (s.phase === 'canopy') {
    // canopy pattern: S-turns to burn height, orbit the field, final approach, flare
    const LZ = TC.LZ;
    const dx = LZ.x - s.pos.x, dz = LZ.z - s.pos.z, dh = Math.hypot(dx, dz);
    const alt = s.pos.y - 1.02 - LZ.h;
    const reach = alt * 2.2;
    const bearing = Math.atan2(dx - WIND.x * 3, -(dz - WIND.z * 3));
    AUTO.cT = (AUTO.cT || 0) + dt;
    let desired = bearing;
    if (dh > 200) {
      if (reach - dh > 260) desired = bearing + (Math.floor(AUTO.cT / 6.5) % 2 ? 1 : -1) * 1.2;
    } else if (alt > 85) {
      desired = bearing + 1.65;   // orbit around the target
    }
    const herr = wrapAngle(desired - s.heading);
    const t = clamp(herr * 1.0, -0.85, 0.85);
    inp.brakeL = t < 0 ? -t : 0; inp.brakeR = t > 0 ? t : 0;
    inp.pitch = 0;
    const feet = s.pos.y - 1.02 - groundHeight(s.pos.x, s.pos.z);
    if (feet < 4.2) { inp.brakeL = inp.brakeR = clamp(1.45 - feet / 3.6, 0.3, 1); }
  } else { inp.pitch = 0; inp.roll = 0; inp.brakeL = inp.brakeR = 0; }
}
