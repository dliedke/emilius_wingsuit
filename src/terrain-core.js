// ============================================================================
// terrain-core.js — self-contained procedural geography for "Emilius".
// Pure JS, no dependencies: this function's source is also shipped to Web
// Workers (via Function.prototype.toString), so it must not reference anything
// outside itself.
// Coordinates: x = east, z = south (north is -z), y = up, meters.
//
// Every seed builds a different massif. The layout is decided first: a spine
// ridge runs north from the summit, the flight line traverses its flank and
// (in most worlds) crosses it through a notch between two towers, then dives
// down a gully to the landing zone — a meadow in the main valley, a floating
// platform on a lake, or a shelf high on the mountain. Lakes sit on steps of
// the valley floors.
//
// Terrain model: the landscape is "carved": an upper bound (massif dome or
// regional noise mountains) is cut down by a drainage network (valley
// profiles, min-combined), which leaves sharp ridges where valleys meet.
// Ridge caps set crest heights (towers, the notch), then local "decals" sculpt
// the summit exit, the lakes and the landing meadow exactly.
// ============================================================================
function makeTerrainCore(SEED) {
  'use strict';
  // ---------------------------------------------------------------- PRNG
  let _s = (SEED >>> 0) || 1;
  function rnd() {
    _s = (_s + 0x6D2B79F5) | 0;
    let t = Math.imul(_s ^ (_s >>> 15), 1 | _s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  const P = new Uint16Array(512);
  const GX = new Float64Array(256), GY = new Float64Array(256);
  {
    const p = new Uint16Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
    for (let i = 0; i < 512; i++) P[i] = p[i & 255];
    for (let i = 0; i < 256; i++) { const a = rnd() * Math.PI * 2; GX[i] = Math.cos(a); GY[i] = Math.sin(a); }
  }

  // ------------------------------------------- gradient noise (+ derivatives)
  let NDX = 0, NDY = 0;
  function noised(x, y) {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const ix = x0 & 255, iy = y0 & 255;
    const fx = x - x0, fy = y - y0;
    const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10), uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
    const dux = 30 * fx * fx * (fx * (fx - 2) + 1), duy = 30 * fy * fy * (fy * (fy - 2) + 1);
    const pa = P[ix], pb = P[ix + 1];
    const a = P[pa + iy], b = P[pb + iy], c = P[pa + iy + 1], d = P[pb + iy + 1];
    const gax = GX[a], gay = GY[a], gbx = GX[b], gby = GY[b], gcx = GX[c], gcy = GY[c], gdx = GX[d], gdy = GY[d];
    const va = gax * fx + gay * fy;
    const vb = gbx * (fx - 1) + gby * fy;
    const vc = gcx * fx + gcy * (fy - 1);
    const vd = gdx * (fx - 1) + gdy * (fy - 1);
    const k = va - vb - vc + vd;
    NDX = gax + ux * (gbx - gax) + uy * (gcx - gax) + ux * uy * (gax - gbx - gcx + gdx) + dux * (uy * k + vb - va);
    NDY = gay + ux * (gby - gay) + uy * (gcy - gay) + ux * uy * (gay - gby - gcy + gdy) + duy * (ux * k + vc - va);
    return va + ux * (vb - va) + uy * (vc - va) + ux * uy * k;
  }
  function noise(x, y) {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const ix = x0 & 255, iy = y0 & 255;
    const fx = x - x0, fy = y - y0;
    const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10), uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
    const pa = P[ix], pb = P[ix + 1];
    const a = P[pa + iy], b = P[pb + iy], c = P[pa + iy + 1], d = P[pb + iy + 1];
    const va = GX[a] * fx + GY[a] * fy;
    const vb = GX[b] * (fx - 1) + GY[b] * fy;
    const vc = GX[c] * fx + GY[c] * (fy - 1);
    const vd = GX[d] * (fx - 1) + GY[d] * (fy - 1);
    return va + ux * (vb - va) + uy * (vc - va) + ux * uy * (va - vb - vc + vd);
  }
  // Eroded fBm (derivative-damped, after I. Quilez): gullies on slopes,
  // smooth valleys, sharp crests. Roughly [-0.9, 0.9].
  function fbmEroded(x, y, oct, gain) {
    let a = 0, b = 1, dx = 0, dy = 0, px = x, py = y;
    for (let i = 0; i < oct; i++) {
      const n = noised(px, py);
      dx += NDX; dy += NDY;
      a += b * n / (1 + dx * dx + dy * dy);
      b *= gain;
      const nx = 1.6 * px - 1.2 * py, ny = 1.2 * px + 1.6 * py;
      px = nx + 31.7; py = ny - 11.3;
    }
    return a;
  }
  // Ridged multifractal, 0..~1
  function ridged(x, y, oct, gain) {
    let sum = 0, amp = 0.55, w = 1, px = x, py = y, norm = 0;
    for (let i = 0; i < oct; i++) {
      let n = 1 - Math.abs(noise(px, py) * 1.45);
      if (n < 0) n = 0;
      n *= n;
      sum += n * amp * w; norm += amp;
      w = Math.min(1, n * 1.6);
      amp *= gain;
      const nx = 1.7 * px - 1.1 * py, ny = 1.1 * px + 1.7 * py;
      px = nx + 5.3; py = ny + 9.1;
    }
    return sum / norm;
  }
  function fbm(x, y, oct, gain) {
    let a = 0, b = 0.5, px = x, py = y;
    for (let i = 0; i < oct; i++) {
      a += b * noise(px, py);
      b *= gain;
      const nx = 1.6 * px - 1.2 * py, ny = 1.2 * px + 1.6 * py;
      px = nx + 3.1; py = ny + 7.7;
    }
    return a;
  }

  // ------------------------------------------------------------- helpers
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const mix = (a, b, t) => a + (b - a) * t;
  function sstep(e0, e1, x) { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); }
  function smin(a, b, k) { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; }
  function bbDist(x, z, bb) {
    const dx = x < bb[0] ? bb[0] - x : x > bb[1] ? x - bb[1] : 0;
    const dz = z < bb[2] ? bb[2] - z : z > bb[3] ? z - bb[3] : 0;
    return Math.sqrt(dx * dx + dz * dz);
  }
  function bboxOf(pts) {
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (const p of pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
    return [x0, x1, z0, z1];
  }

  // =================================================================== LAYOUT
  // A second random stream decides the geography, so the noise and the layout
  // vary independently.
  let _g = (Math.imul((SEED >>> 0) ^ 0x2545F491, 0x9E3779B1) >>> 0) || 7;
  function lr() {
    _g = (_g + 0x6D2B79F5) | 0;
    let t = Math.imul(_g ^ (_g >>> 15), 1 | _g);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  const rr = (a, b) => a + (b - a) * lr();
  const chance = (p) => lr() < p;

  // side of the spine the line finishes on (+1 = east)
  const SIDE = chance(0.5) ? 1 : -1;
  const roll = lr();
  const LZTYPE = roll < 0.38 ? 'valley' : roll < 0.7 ? 'lake' : 'mountain';
  const lakeHigh = LZTYPE === 'lake' && chance(0.5);   // hanging-valley lake vs. lake at the valley mouth

  // main valley, running east-west north of the massif
  const F0 = rr(470, 860);
  const RIV = { z0: 0, a1: rr(110, 230), p1: rr(1900, 3300), f1: rr(0, 6.2832), a2: rr(40, 100), p2: rr(800, 1400), f2: rr(0, 6.2832), k: rr(-0.0015, 0.0015) };
  function riverZ(x) { return RIV.z0 + RIV.a1 * Math.sin(x / RIV.p1 + RIV.f1) + RIV.a2 * Math.sin(x / RIV.p2 + RIV.f2); }
  function mainFloor(x) { return F0 - RIV.k * clamp(x, -20000, 20000); }

  // planned landing height, then the summit above it
  const LZH0 = Math.round(LZTYPE === 'mountain' ? F0 + rr(1150, 1550) : LZTYPE === 'lake' ? F0 + (lakeHigh ? rr(320, 720) : rr(40, 90)) : F0 + 7);
  const SUMMIT = { x: 0, z: 0, h: Math.round(clamp(LZH0 + (LZTYPE === 'mountain' ? rr(1700, 2100) : rr(2350, 2950)), 2950, 4250)) };
  const EXIT = { x: 0, z: -6.2, heading: 0 };     // heading 0 = facing north (-z)
  const exitY = SUMMIT.h - 3.2;
  const RS = (SUMMIT.h - F0) / 2971;               // relief, relative to the classic Emilius massif

  // ---- the spine: a ridge running north from the summit, bending toward SIDE
  // t = distance north of the summit; spineX(t) = its east-west position
  const SP = { a0: rr(300, 520), k0: 1, a1: rr(60, 190), p1: rr(1300, 2000), f1: rr(0, 6.2832), a2: rr(20, 60), p2: rr(600, 900), f2: rr(0, 6.2832) };
  SP.k0 = SP.a0 / rr(0.33, 0.45);
  function spineX(t) {
    return SIDE * SP.a0 * (1 - Math.exp(-t / SP.k0)) + SP.a1 * (Math.sin(t / SP.p1 + SP.f1) - Math.sin(SP.f1)) + SP.a2 * (Math.sin(t / SP.p2 + SP.f2) - Math.sin(SP.f2));
  }
  function spineDX(t) { return (spineX(t + 2) - spineX(t - 2)) / 4; }
  // the spine must leave the summit away from the exit face
  if (spineDX(0) * SIDE < 0.3) { SP.f1 += Math.PI; if (spineDX(0) * SIDE < 0.3) { SP.a1 *= 0.3; SP.a2 *= 0.3; } }
  // point at lateral offset d (> 0 = east side) from the spine at t
  function offPt(t, d) { const s = spineDX(t), L = Math.sqrt(1 + s * s); return [spineX(t) + d / L, -t + d * s / L]; }

  // ---- the flight line: gates [x, z, y, radius, kind]
  //  kind 0 = gate, 1 = the notch between the towers, 2 = over the lip of a lake, 3 = gold (small)
  const GATES = [], GT = [];                       // GT: spine parameter of each gate
  let gx = EXIT.x, gz = EXIT.z, gy = exitY, T = 0;
  function putGateXY(x, z, t, glide, r, kind, yFix) {
    const y = yFix !== undefined ? yFix : gy - Math.hypot(x - gx, z - gz) / glide;
    GATES.push([x, z, y, r, kind]); GT.push(t);
    gx = x; gz = z; gy = y; T = t;
    return y;
  }
  function putGate(t, off, glide, r, kind, yFix) {
    const [x, z] = offPt(t, off);
    return putGateXY(x, z, t, glide, r, kind, yFix);
  }
  const yG1 = exitY - rr(330, 370);
  const yLast = LZH0 + rr(570, 640);
  const horiz = (yG1 - yLast) * 2.2;             // horizontal budget below the first gate
  const spacing = clamp(horiz / 3600, 0.75, 1);  // short drops get tighter gates
  let NOTCHED = chance(0.72);
  const tNotchMax = Math.min(2050, 330 + 0.8 * (horiz - 1300));
  if (tNotchMax < 850) NOTCHED = false;
  const tNotch = NOTCHED ? rr(Math.min(1250, tNotchMax - 120), tNotchMax) : 0;
  // 1. straight down the exit face
  {
    const t1 = rr(305, 345);
    putGate(t1, SIDE * rr(-15, 25) - spineX(t1), 0, 22, 0, yG1);
  }
  // 2. traverse along the spine's flank
  const tFlankEnd = NOTCHED ? tNotch - rr(380, 480) : Math.min(rr(1350, 2050), 330 + 0.8 * (horiz - 1400));
  for (;;) {
    const dt = rr(400, 510) * spacing;
    if (T + dt > tFlankEnd) break;
    putGate(T + dt, -SIDE * rr(160, 240), rr(2.2, 2.4), rr(18, 21), 0);
  }
  // 3. through the notch to the other side — or down into the valley below the traverse
  let NOTCH = null, vOff;
  if (NOTCHED) {
    // cross the spine on a diagonal: the approach gate, the slot and the exit gate
    // sit on a line through the notch, so no turn on the way is sharper than ~55°
    const sN = spineDX(tNotch), LN = Math.sqrt(1 + sN * sN);
    const along = [sN / LN, -1 / LN], across = [SIDE / LN, SIDE * sN / LN];
    const [nx, nz] = offPt(tNotch, 0);
    const dirAt = (phi) => [along[0] * Math.cos(phi) + across[0] * Math.sin(phi), along[1] * Math.cos(phi) + across[1] * Math.sin(phi)];
    const dA = dirAt(rr(38, 52) * Math.PI / 180), back = rr(170, 230);
    putGateXY(nx - dA[0] * back, nz - dA[1] * back, tNotch - back * 0.7, rr(2.1, 2.3), rr(17, 19), 0);
    const yN = putGateXY(nx, nz, tNotch, rr(1.95, 2.1), 14, 1);
    NOTCH = { x: gx, z: gz, h: yN - 36, y: yN, t: tNotch, i: GATES.length - 1 };
    const dQ = dirAt(rr(45, 62) * Math.PI / 180), fwd = rr(170, 240);
    putGateXY(nx + dQ[0] * fwd, nz + dQ[1] * fwd, tNotch + fwd * 0.6, rr(2.1, 2.3), 18, 0);
    vOff = SIDE * rr(270, 340);
  } else {
    vOff = -SIDE * rr(380, 500);
    putGate(T + rr(470, 560), vOff * 0.75, rr(2.15, 2.35), 19, 0);
  }
  const firstGully = GATES.length;
  // 4. down the gully to the last gate, ~600 m above the landing
  const wantLakeGate = chance(0.55);
  let lakeGate = -1;
  for (;;) {
    const dt = rr(580, 720) * spacing;
    const off = vOff + rr(-45, 45);
    const [x, z] = offPt(T + dt, off);
    const d = Math.hypot(x - gx, z - gz), g = rr(2.1, 2.3);
    const y = gy - d / g;
    if (y < yLast + 170) {
      const need = (gy - yLast) * g;
      if (need > 330) putGate(T + dt * need / d, off, g, 20, 0, yLast);
      break;
    }
    const k = GATES.length;
    const isLake = wantLakeGate && lakeGate < 0 && k >= firstGully && y - yLast > 380;
    putGate(T + dt, off, g, isLake ? 18 : rr(18, 21), isLake ? 2 : 0);
    if (isLake) lakeGate = k;
  }
  // gold rings: smaller, worth more
  {
    const cand = [];
    for (let i = 1; i < GATES.length - 1; i++) {
      if (GATES[i][4] !== 0) continue;
      if (NOTCH && Math.abs(i - NOTCH.i) <= 1) continue;
      if (lakeGate >= 0 && Math.abs(i - lakeGate) <= 1) continue;
      cand.push(i);
    }
    const r0 = lr();
    let n = Math.min(cand.length, r0 < 0.15 ? 0 : r0 < 0.7 ? 1 : 2);
    while (n-- > 0) { const i = cand.splice(Math.floor(lr() * cand.length), 1)[0]; GATES[i][4] = 3; GATES[i][3] = 11; }
  }
  const GL = GATES[GATES.length - 1];
  const dirTo = (a, b) => { const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1; return [dx / L, dz / L]; };

  // ---- landing zone and where the valley meets the river
  const tL = T + rr(720, 940);
  const LZ = { x: 0, z: 0, h: LZH0, type: LZTYPE, tx: rr(-0.01, 0.01), tz: rr(-0.012, 0.012), plat: 0 };
  [LZ.x, LZ.z] = offPt(tL, vOff + rr(-110, 110));
  const LAKES = [];
  // lake: {x, z, r (along its axis), k (length / width), c, s (axis direction), level, depth, valley}
  function lakeD(L, x, z) {
    const dx = x - L.x, dz = z - L.z;
    const u = dx * L.c + dz * L.s, v = (dz * L.c - dx * L.s) * L.k;
    return Math.sqrt(u * u + v * v);
  }
  let lzLake = null;
  let tRiver, floorPastLZ;
  if (LZTYPE === 'valley') {
    tRiver = tL + rr(430, 600);
  } else if (LZTYPE === 'lake') {
    const a = rr(200, 310), k = rr(1.1, 1.45);
    const dir = dirTo(GL, [LZ.x, LZ.z]);
    lzLake = { x: LZ.x + dir[0] * a * 0.15, z: LZ.z + dir[1] * a * 0.15, r: a, k, c: dir[0], s: dir[1], level: LZH0 - 0.5, depth: rr(12, 22), valley: -1, lz: true };
    LZ.h = LZH0; LZ.plat = 21;
    // the low lake still sits inside the side valley, where its walls can hold the water
    tRiver = lakeHigh ? tL + a + (lzLake.level - F0) / rr(0.17, 0.26) : tL + a * 1.1 + rr(700, 950);
  } else {
    floorPastLZ = LZH0 - rr(170, 260);
    tRiver = tL + (floorPastLZ - F0) / rr(0.17, 0.26);
  }
  {
    const [xr, zr] = offPt(tRiver, vOff);
    RIV.z0 = zr - (riverZ(xr) - RIV.z0);
  }

  // =============================================================== VALLEYS
  // Drainage network: [x, z, floor, halfWidth, wallSlope, wallCurv]
  const VALLEYS = [];
  const addValley = (name, pts, extra) => { VALLEYS.push(Object.assign({ name, k: 60, pts }, extra || {})); return VALLEYS.length - 1; };
  // descend from the last point of pts along offFn(t) to the main river
  function runToRiver(pts, t0, offFn, p, step, w0) {
    const f0 = pts[pts.length - 1][2];
    let tEnd = t0;
    for (let q = 0; q < 200; q++) { tEnd += 80; const [x, z] = offPt(tEnd, offFn(tEnd)); if (z < riverZ(x) + 170) break; }
    const n = Math.max(2, Math.round((tEnd - t0) / step));
    for (let i = 1; i <= n; i++) {
      const u = i / n, t = t0 + (tEnd - t0) * u;
      const [x, z] = offPt(t, offFn(t));
      const f = mainFloor(x) + 2 + (f0 - F0 - 2) * (1 - Math.pow(u, p));
      pts.push([x, z, f, mix(w0, 160, u * u), mix(0.72, 0.3, u * u), mix(0.00042, 0.00025, u)]);
    }
    return tEnd;
  }
  // a small lake on a flat step of a valley: returns the lake, pushes shore points.
  // The step sits well above the water: valleyValue smooth-mins its segments,
  // which dips each joint by up to 12 m, and a dip below the water would breach
  // the rim. Only the outlet, downstream, drops below the lake level.
  function stepLake(pts, cx, cz, dir, a, k, level, depth) {
    const b = a / k;
    pts.push([cx - dir[0] * a * 1.12, cz - dir[1] * a * 1.12, level + 20, b * 0.8, 0.62, 0.00045]);
    pts.push([cx, cz, level + 18, b * 0.8, 0.6, 0.00045]);
    pts.push([cx + dir[0] * a * 1.06, cz + dir[1] * a * 1.06, level - 1.5, 26, 0.7, 0.00045]);
    const L = { x: cx, z: cz, r: a, k, c: dir[0], s: dir[1], level, depth, valley: VALLEYS.length };
    LAKES.push(L);
    return L;
  }

  // ---- the line valley: under the gully gates, then out to the landing zone
  const VL = [];
  if (NOTCHED) {
    // head on the far side of the spine, down to the gully below the notch
    const tHB = Math.min(rr(380, 520), tNotch - 380);
    const fN = NOTCH.y - rr(150, 200);
    const fHead = Math.max(fN + 120, Math.min(SUMMIT.h - rr(740, 860), fN + 520));
    let [x, z] = offPt(tHB, SIDE * rr(950, 1250));
    VL.push([x, z, fHead, 40, 0.75, 0.00045]);
    [x, z] = offPt((tHB + tNotch) / 2, SIDE * rr(650, 850));
    VL.push([x, z, mix(fHead, fN, 0.55), 36, 0.78, 0.00045]);
    [x, z] = offPt(tNotch + 60, SIDE * rr(430, 520));
    VL.push([x, z, fN, 32, 0.8, 0.00045]);
  } else {
    // valley A: the cirque under the face, then under the traverse
    let [x, z] = offPt(240, -SIDE * rr(110, 170));
    const f0 = SUMMIT.h - rr(360, 420);
    VL.push([x, z, f0, 60, 0.62, 0.0004]);
    [x, z] = offPt(640, -SIDE * rr(430, 520));
    const f1 = SUMMIT.h - rr(610, 680);
    VL.push([x, z, f1, 90, 0.6, 0.0004]);
    if (chance(0.6) && GT[firstGully - 1] > 1450) {
      // cirque lake beside the traverse
      const tT = rr(850, 980), a = rr(140, 200);
      const [cx, cz] = offPt(tT, -SIDE * rr(560, 640));
      stepLake(VL, cx, cz, dirTo([x, z], [cx, cz]), a, rr(1.05, 1.4), f1 - rr(25, 45), rr(14, 24));
    }
  }
  const vlIndex = VALLEYS.length;   // (added below, after the lakes that refer to it)
  for (let i = firstGully; i < GATES.length; i++) {
    const G = GATES[i];
    const last = i === GATES.length - 1;
    if (G[4] === 2) {
      // lake gate: the gate hangs over the outlet lip, the lake just upstream of it
      const prev = GATES[i - 1];
      const dir = dirTo(prev, G);
      const a = rr(95, 140), k = rr(1.15, 1.6), level = G[2] - rr(12, 15);
      const L = stepLake(VL, G[0] - dir[0] * a, G[1] - dir[1] * a, dir, a, k, level, rr(9, 16));
      L.valley = vlIndex; L.gate = i;
      continue;
    }
    const c = last ? rr(170, 240) : i === firstGully ? rr(55, 75) : rr(45, 68);
    VL.push([G[0], G[1], G[2] - c, last ? 55 : rr(32, 40), last ? 0.62 : rr(0.74, 0.82), last ? 0.00035 : 0.00045]);
  }
  {
    const dir = dirTo(GL, [LZ.x, LZ.z]);
    const mid = [mix(GL[0], LZ.x, 0.55), mix(GL[1], LZ.z, 0.55)];
    if (LZTYPE === 'valley') {
      VL.push([mid[0], mid[1], LZH0 + rr(50, 110), 90, 0.45, 0.0003]);
      VL.push([LZ.x, LZ.z, LZH0 - 4, 160, 0.3, 0.00025]);
      runToRiver(VL, tL, () => vOff, 1, 250, 200);
    } else if (LZTYPE === 'lake') {
      VL.push([mid[0], mid[1], lzLake.level + rr(60, 120), 70, 0.55, 0.00035]);
      const L = stepLake(VL, lzLake.x, lzLake.z, dir, lzLake.r, lzLake.k, lzLake.level, lzLake.depth);
      L.valley = vlIndex; L.lz = true;
      lzLake = L;
      runToRiver(VL, tL + lzLake.r * 1.1, () => vOff, rr(1, 1.4), 700, 90);
    } else {
      VL.push([mid[0], mid[1], mix(GL[2] - 200, floorPastLZ, 0.6), 60, 0.62, 0.00035]);
      const [x, z] = offPt(tL, vOff);
      VL.push([x, z, floorPastLZ, 70, 0.6, 0.00035]);
      runToRiver(VL, tL, () => vOff, rr(1, 1.35), 700, 90);
    }
  }
  addValley('VL', VL);

  // ---- valley A (the other side of the spine) — or valley B when the line stays west
  if (NOTCHED) {
    const pts = [];
    let [x, z] = offPt(240, -SIDE * rr(110, 170));
    pts.push([x, z, SUMMIT.h - rr(360, 420), 60, 0.62, 0.0004]);
    [x, z] = offPt(640, -SIDE * rr(430, 520));
    const f1 = SUMMIT.h - rr(610, 680);
    pts.push([x, z, f1, 90, 0.6, 0.0004]);
    let t0 = 640;
    const dA = rr(850, 1150);
    if (chance(0.72)) {
      // cirque lake below the face, beside the traverse
      const tT = rr(850, 980), a = rr(150, 220);
      const [cx, cz] = offPt(tT, -SIDE * rr(570, 680));
      const dir = dirTo([x, z], [cx, cz]);
      stepLake(pts, cx, cz, dir, a, rr(1.05, 1.4), f1 - rr(25, 45), rr(14, 26));
      t0 = tT + a * 1.1;
    }
    const pA = rr(1.1, 1.8);
    runToRiver(pts, t0, (t) => -SIDE * mix(560, dA, sstep(700, 2600, t)), pA, 680, 40);
    addValley('VA', pts);
  } else {
    const pts = [];
    const tH = rr(380, 520);
    let [x, z] = offPt(tH, SIDE * rr(950, 1250));
    pts.push([x, z, SUMMIT.h - rr(740, 860), 40, 0.75, 0.00045]);
    runToRiver(pts, tH, (t) => SIDE * mix(1100, 800, sstep(500, 2500, t)), rr(1.1, 1.6), 680, 40);
    addValley('VB', pts);
  }
  // ---- outer valleys, both sides
  for (const [name, sd, o0, o1, th] of [['VC', -SIDE, 1650, 2000, rr(700, 1100)], ['VD', SIDE, 2350, 2700, rr(750, 1150)], ['VW', -SIDE, 2750, 3100, rr(1300, 1700)], ['VE', SIDE, 3500, 3900, rr(1400, 1900)]]) {
    const pts = [];
    const off = sd * rr(o0, o1), wob = rr(-220, 220), ma = rr(60, 220), mp = rr(1400, 2800), mf = rr(0, 6.2832);
    const offFn = (t) => off + wob * sstep(th, th + 3000, t) + ma * (Math.sin(t / mp + mf) - Math.sin(th / mp + mf));
    const [x, z] = offPt(th, off);
    const dSum = Math.hypot(x, z);
    const dome = SUMMIT.h + 60 - 0.45 * Math.min(dSum, 3750) + 0.00006 * Math.min(dSum, 3750) ** 2;
    // start below the dome, and never so high that the run to the river gets steeper than ~0.45
    const head = Math.min(dome - rr(260, 420) * RS, mainFloor(x) + Math.abs(z - riverZ(x)) * rr(0.38, 0.46));
    pts.push([x, z, head, 45, 0.72, 0.0004]);
    if (chance(0.4) && dSum < 3400) {
      // a tarn near the head
      const tc = th + rr(420, 560);
      const [cx, cz] = offPt(tc, offFn(tc));
      const a = rr(110, 190);
      stepLake(pts, cx, cz, dirTo([x, z], [cx, cz]), a, rr(1.05, 1.5), head - rr(80, 140), rr(10, 22));
      runToRiver(pts, th + 700, offFn, rr(1.1, 1.8), 700, 45);
    } else runToRiver(pts, th, offFn, rr(1.1, 1.8), 700, 45);
    addValley(name, pts);
  }
  // ---- behind the summit: two cirques and two long valleys heading south
  {
    const m = chance(0.5) ? 1 : -1, sc = rr(0.85, 1.2);
    const H = SUMMIT.h;
    const S = (x, z) => [x * m * sc, z * sc];
    const sv = (name, list) => addValley(name, list.map(([x, z, f, w, s, c]) => [...S(x, z), H - (3559 - f) * RS, w, s, c]));
    sv('VS3', [[-420, 330, 3170, 60, 0.7, 0.00045], [-760, 900, 2880, 50, 0.72, 0.00042], [-900, 1600, 2600, 50, 0.7, 0.0004]]);
    sv('VS4', [[470, 380, 3160, 60, 0.7, 0.00045], [900, 950, 2890, 50, 0.72, 0.00042], [1300, 1700, 2620, 50, 0.7, 0.0004]]);
    sv('VS1', [[-700, 650, 2950, 40, 0.75, 0.00045], [-900, 1600, 2600, 50, 0.7, 0.0004], [-1300, 2800, 2200, 60, 0.65, 0.0004], [-1700, 4200, 1800, 80, 0.6, 0.0004]]);
    sv('VS2', [[800, 720, 2980, 40, 0.75, 0.00045], [1300, 1700, 2620, 50, 0.7, 0.0004], [1900, 2900, 2200, 60, 0.65, 0.0004], [2500, 4200, 1800, 80, 0.6, 0.0004]]);
  }

  function mainValley(x, z) {
    const d = Math.abs(z - riverZ(x)) * 0.985;
    const e = Math.max(0, d - 600);
    const u = Math.min(d, 600) / 600;
    return mainFloor(x) + u * u * 10 + 0.2 * e + 0.00105 * e * e;
  }

  // ================================================================ RIDGES
  // Ridge caps: [x, z, crestHeight, capSlope] — the terrain can't rise above
  // crest + capSlope * distance, which sets crest profiles (towers, notch).
  function lineYAtT(t) {
    if (t <= GT[0]) return mix(exitY, GATES[0][2], t / GT[0]);
    for (let i = 0; i < GATES.length - 1; i++) {
      const t0 = GT[i], t1 = GT[i + 1];
      if (t <= t1) return mix(GATES[i][2], GATES[i + 1][2], clamp((t - t0) / Math.max(1, t1 - t0), 0, 1));
    }
    return GATES[GATES.length - 1][2] - (t - GT[GATES.length - 1]) * 0.45;
  }
  const RIDGES = [];
  const TOWERS = [];
  {
    const pts = [[0, 0, SUMMIT.h, 2.2]];
    const tEndR1 = Math.min(tL + 300, tRiver - 900);
    const above = rr(180, 260);
    const add = (t, crest, slope) => { const [x, z] = offPt(t, 0); pts.push([x, z, crest, slope]); };
    let t = 350;
    add(t, SUMMIT.h - rr(160, 200) * RS, 2.1);
    const tStop = NOTCHED ? tNotch - 330 : 1e9;
    for (t += rr(400, 480); t < Math.min(tStop, tEndR1); t += rr(420, 520)) add(t, Math.max(lineYAtT(t) + above * sstep(0, 700, t), SUMMIT.h - 0.5 * t - 60), 2.0);
    if (NOTCHED) {
      const ta = tNotch - rr(135, 175), tb = tNotch + rr(150, 190);
      const ca = NOTCH.y + rr(250, 340), cb = NOTCH.y + rr(230, 320);
      add(ta, ca, 3.4); TOWERS.push([...offPt(ta, 0), ca]);
      add(tNotch, NOTCH.h, 3.0);
      add(tb, cb, 3.4); TOWERS.push([...offPt(tb, 0), cb]);
      t = tb + rr(230, 300);
      add(t, lineYAtT(t) + rr(250, 320), 2.0);
      t += rr(480, 560);
    }
    for (; t < tEndR1; t += rr(520, 640)) add(t, lineYAtT(t) + rr(260, 360) * (1 - 0.5 * sstep(tEndR1 - 1200, tEndR1, t)), mix(1.9, 1.5, sstep(1500, tEndR1, t)));
    add(tEndR1, Math.max(F0 + 320, Math.min(pts[pts.length - 1][2] - 150, lineYAtT(tEndR1) + 120)), 1.3);
    RIDGES.push({ name: 'R1', pts });
  }
  {
    // summit arms: R2 away from the line's finish, R4 toward it; R5 branches north off R4
    const H = SUMMIT.h, s = -SIDE;
    const R2 = [[0, 0, H, 2.0], [s * 420, -200, H - 139 * RS, 2.0], [s * 900, -520, H - 324 * RS, 1.9], [s * 1400, -1000, H - 549 * RS, 1.8]];
    const o2 = rr(2150, 2450);
    let t = 1700;
    for (const dh of [759, 1039, 1409, 1909]) { const [x, z] = offPt(t, s * o2); if (z < riverZ(x) + 900) break; R2.push([x, z, H - dh * RS, dh > 1400 ? 1.4 : 1.7]); t += 900; }
    RIDGES.push({ name: 'R2', pts: R2 });
    const e = SIDE;
    const R4 = [[0, 0, H, 2.0], [e * 480, 80, H - 179 * RS, 2.0], [e * 1100, 40, H - 349 * RS, 1.9]];
    const o5 = rr(1500, 1750);
    const root = offPt(200, e * o5);
    R4.push([root[0], root[1], H - 559 * RS, 1.8], [e * 2700 + root[0] * 0.2, -500, H - 729 * RS, 1.8], [e * 3400 + root[0] * 0.2, -900, H - 939 * RS, 1.7]);
    RIDGES.push({ name: 'R4', pts: R4 });
    const R5 = [[root[0], root[1], H - 559 * RS, 1.8]];
    t = 850;
    for (const dh of [659, 839, 1079, 1429, 1909, 2409]) { const [x, z] = offPt(t, e * (o5 + rr(-60, 60))); if (z < riverZ(x) + 700) break; R5.push([x, z, H - dh * RS, dh > 1800 ? 1.3 : dh > 1300 ? 1.5 : 1.8]); t += rr(700, 800); }
    if (R5.length > 1) RIDGES.push({ name: 'R5', pts: R5 });
  }

  function prep(list, idx, fn) {
    for (const r of list) {
      r.bb = bboxOf(r.pts);
      r.ext = fn(...r.pts.map(p => p[idx]));
    }
  }
  prep(VALLEYS, 2, Math.min);
  prep(RIDGES, 2, Math.min);
  for (const v of VALLEYS) {
    v.minWall = Math.min(...v.pts.map(p => p[4]));
    v.minCurv = Math.min(...v.pts.map(p => p[5]));
    v.cum = [0];
    for (let i = 1; i < v.pts.length; i++) v.cum.push(v.cum[i - 1] + Math.hypot(v.pts[i][0] - v.pts[i - 1][0], v.pts[i][1] - v.pts[i - 1][1]));
    v.seed = v.cum.length * 13.1 + v.pts[0][0] * 0.001;
  }
  for (const r of RIDGES) r.minSlope = Math.min(...r.pts.map(p => p[3]));
  for (const L of LAKES) { L.bb = [L.x - L.r - 720, L.x + L.r + 720, L.z - L.r - 720, L.z + L.r + 720]; }

  // valley profile: floor + wall(e); sets VFLOOR to the winning floor height
  let VFLOOR = 0;
  const GULLY = 1.05;
  // per-segment scratch, so the gully pattern can blend where segments trade places
  const SEG_V = new Float64Array(256), SEG_T = new Float64Array(256), SEG_E = new Float64Array(256), SEG_Q = new Float64Array(256), SEG_F = new Float64Array(256);
  // spurs & gullies running down the walls: noise stretched across the valley axis
  // (q = signed distance to the segment's line, continuous on both sides of it)
  function gully(v, i, t, e, q) {
    let sArc = v.cum[i] + t * (v.cum[i + 1] - v.cum[i]);
    sArc += 110 * noise(sArc / 420 + v.seed * 0.3, q / 500 + 2.1);
    const g = noise(sArc / 170 + v.seed, q / 800 + 7.1) + 0.5 * noise(sArc / 64 - v.seed, q / 300 - 3.3);
    return g * Math.min(e * 0.55, 220) * GULLY;
  }
  function valleyValue(x, z, v, hNow) {
    // lower bound of the profile (walls minus the deepest gully) — skip valleys that can't reach us
    const D = bbDist(x, z, v.bb);
    if (v.ext + v.minWall * D + v.minCurv * D * D - Math.min(D * 0.87, 346) > hNow + v.k) return 1e9;
    const pts = v.pts, last = pts.length - 2;
    let best = 1e9, vmin = 1e9;
    for (let i = 0; i <= last; i++) {
      const a = pts[i], b = pts[i + 1];
      const ex = b[0] - a[0], ez = b[1] - a[1];
      const px = x - a[0], pz = z - a[1];
      const L2 = ex * ex + ez * ez;
      let t = (px * ex + pz * ez) / L2;
      let cap = 0;
      if (i === 0 && t < 0) cap = -t * Math.sqrt(L2);
      if (i === last && t > 1) cap = (t - 1) * Math.sqrt(L2) * 0.5;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = px - ex * t, dz = pz - ez * t;
      const floor = a[2] + (b[2] - a[2]) * t;
      const d = Math.sqrt(dx * dx + dz * dz);
      const w = a[3] + (b[3] - a[3]) * t;
      const s = a[4] + (b[4] - a[4]) * t;
      const c = a[5] + (b[5] - a[5]) * t;
      const e = d > w ? d - w : 0;
      const u = d < w ? d / w : 1;
      const val = floor + u * u * 4 + s * e + c * e * e + cap * 1.2;
      SEG_V[i] = val; SEG_T[i] = t; SEG_E[i] = e; SEG_Q[i] = (ex * pz - ez * px) / Math.sqrt(L2); SEG_F[i] = floor;
      if (val < vmin) vmin = val;
      best = best > 1e8 ? val : smin(best, val, 50);
    }
    // gullies and the floor from every segment within the blend band, weighted like the
    // smooth min, so nothing jumps where two segments trade places
    let gs = 0, ws = 0, fs = 0;
    for (let i = 0; i <= last; i++) {
      const k = 1 - (SEG_V[i] - vmin) / 50;
      if (k <= 0) continue;
      const wk = k * k;
      if (SEG_E[i] > 0) gs += wk * gully(v, i, SEG_T[i], SEG_E[i], SEG_Q[i]);
      fs += wk * SEG_F[i]; ws += wk;
    }
    best += gs / ws;
    VFLOOR = fs / ws;
    return best;
  }
  function ridgeCap(x, z, r, hNow) {
    if (r.ext + r.minSlope * bbDist(x, z, r.bb) > hNow + 40) return 1e9;
    const pts = r.pts;
    let best = 1e9;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const ex = b[0] - a[0], ez = b[1] - a[1];
      const px = x - a[0], pz = z - a[1];
      let t = (px * ex + pz * ez) / (ex * ex + ez * ez);
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = px - ex * t, dz = pz - ez * t;
      const d = Math.sqrt(dx * dx + dz * dz);
      const v = a[2] + (b[2] - a[2]) * t + (a[3] + (b[3] - a[3]) * t) * d;
      if (v < best) best = v;
    }
    return best;
  }

  // ======================================================= FLIGHT CORRIDOR
  // Guarantees the line is flyable (carve) and builds the face you traverse
  // along the spine (fill). [x, z, floor, halfWidth, slopeLeft, slopeRight, wall]
  // wall: +1 builds a face on the right of the line, -1 on the left.
  const CORRIDOR = { name: 'LN', pts: [] };
  {
    const C = CORRIDOR.pts, G0 = GATES[0];
    const H = SUMMIT.h;
    C.push([EXIT.x + G0[0] * 0.2, -95, H - 159, 12, 2.5, 2.5, 0]);
    C.push([EXIT.x + G0[0] * 0.8, -170, H - 269, 18, 1.4, 1.4, 0]);
    C.push([G0[0], G0[1], G0[2] - 70, 40, 0.8, 0.9, 0]);
    // the spine side of the traverse is the steep one
    const spineL = SIDE < 0 ? 1.1 : 0.55, spineR = SIDE > 0 ? 1.1 : 0.55;
    const apL = SIDE < 0 ? 1.1 : 0.75, apR = SIDE > 0 ? 1.1 : 0.75;
    for (let i = 1; i < GATES.length; i++) {
      const [x, z, y, , kind] = GATES[i];
      const last = i === GATES.length - 1;
      if (kind === 1) {
        C.push([x, z, y - 36, 9, 2.5, 2.5, 0]);
        const n = GATES[i + 1];
        C.push([mix(x, n[0], 0.45), mix(z, n[1], 0.45), mix(y, n[2], 0.45) - 38, 16, 1.8, 1.8, 0]);
      } else if (kind === 2) {
        const L = LAKES.find((q) => q.gate === i);
        C.push([x, z, L.level + 2, 34, 0.7, 0.7, 0]);
      } else if (NOTCH && i === NOTCH.i - 1) {
        C.push([x, z, y - 40, 26, apL, apR, 0]);
      } else if (NOTCH && i === NOTCH.i + 1) {
        C.push([x, z, y - 40, 30, 0.95, 0.95, 0]);
      } else if (i < firstGully - 1) {
        // traverse: a face on the spine side (wall = SIDE: +1 right, -1 left of the line)
        C.push([x, z, y - rr(42, 48), rr(30, 36), spineL, spineR, SIDE]);
      } else if (i === firstGully - 1) {
        C.push([x, z, y - 44, 32, 0.8, 0.8, 0]);
      } else {
        C.push([x, z, y - (last ? 55 : rr(46, 52)), last ? 36 : rr(30, 36), 0.8, 0.8, 0]);
      }
    }
    CORRIDOR.bb = bboxOf(C);
    CORRIDOR.cum = [0];
    for (let i = 1; i < C.length; i++) CORRIDOR.cum.push(CORRIDOR.cum[i - 1] + Math.hypot(C[i][0] - C[i - 1][0], C[i][1] - C[i - 1][1]));
  }
  // returns [carveHeight, wallFillHeight or -1e9]
  const CORR_OUT = [0, 0];
  function corridor(x, z) {
    CORR_OUT[0] = 1e9; CORR_OUT[1] = -1e9; CORR_OUT.wallW = 0;
    if (bbDist(x, z, CORRIDOR.bb) > 900) return CORR_OUT;
    const pts = CORRIDOR.pts;
    let carve = 1e9;
    let wallW = 0, wallAcc = 0, wallSum = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const ex = b[0] - a[0], ez = b[1] - a[1];
      const px = x - a[0], pz = z - a[1];
      const L2 = ex * ex + ez * ez;
      const tRaw = (px * ex + pz * ez) / L2;
      const t = tRaw < 0 ? 0 : tRaw > 1 ? 1 : tRaw;
      const dx = px - ex * t, dz = pz - ez * t;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d > 900) continue;
      const floor = a[2] + (b[2] - a[2]) * t;
      const w = a[3] + (b[3] - a[3]) * t;
      const L = Math.sqrt(L2);
      const qs = (ex * pz - ez * px) / L;           // signed distance to the segment's line (< 0: left)
      const side = clamp(0.5 + 1.5 * qs / Math.max(d, 1e-3), 0, 1);   // 0 left, 1 right, blended past the ends
      const s = mix(a[4] + (b[4] - a[4]) * t, a[5] + (b[5] - a[5]) * t, side);
      const e = Math.max(0, d - w);
      const u = Math.min(d, w) / w;
      let v = floor + u * u * 3 + s * e + 0.0005 * e * e;
      if (e > 0) {
        const sArc = CORRIDOR.cum[i] + t * L;
        const g = noise(sArc / 120 + 3.3, qs / 520) + 0.5 * noise(sArc / 48 - 9.1, qs / 230 + 1.7);
        v += g * Math.min(e * 0.35, 90);
      }
      carve = carve > 1e8 ? v : smin(carve, v, 45);
      // the traverse face on the wall side, fading out beyond the segment's ends
      const wall = (a[6] + (b[6] - a[6]) * t) * (side * 2 - 1);
      if (wall > 0.01 && d < 300) {
        const along = tRaw * L;
        const q = Math.max(0, d - 30);
        const f = floor + 1.12 * q + 0.0006 * q * q;
        const ww = wall * (1 - sstep(170, 290, d)) * sstep(20, 45, d) * sstep(-70, 0, along) * sstep(L + 70, L, along);
        if (ww > 0) { wallW = Math.max(wallW, ww); wallAcc += ww * f; wallSum += ww; }
      }
    }
    CORR_OUT[0] = carve;
    CORR_OUT[1] = wallSum > 0 ? wallAcc / wallSum : -1e9;
    CORR_OUT.wallW = wallW;
    return CORR_OUT;
  }

  // The flight line (for calming random noise near it)
  const LINE = [[EXIT.x, EXIT.z - 14], ...GATES.map((g) => [g[0], g[1]]), [LZ.x, LZ.z]];
  const LINE_BB = bboxOf(LINE);
  function distToLine(x, z) {
    const bd = bbDist(x, z, LINE_BB);
    if (bd > 4000) return bd;
    let best = 1e18;
    for (let i = 0; i < LINE.length - 1; i++) {
      const a = LINE[i], b = LINE[i + 1];
      const ex = b[0] - a[0], ez = b[1] - a[1];
      const px = x - a[0], pz = z - a[1];
      let t = (px * ex + pz * ez) / (ex * ex + ez * ez);
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = px - ex * t, dz = pz - ez * t;
      const d = dx * dx + dz * dz;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  }

  // Upper bound of the landscape before carving.
  //  - massif dome around the summit (drops ~0.3/m with distance)
  //  - random noise mountains elsewhere (the far ranges)
  const REG = { s1: rr(1300, 1700), s2: rr(1100, 1500), n1: rr(1400, 1800), n2: rr(1500, 1950), eA: rr(950, 1250), rA: rr(1100, 1500) };
  function upper(x, z, dl) {
    const ds = Math.hypot(x - SUMMIT.x, z - SUMMIT.z);
    const mw = 1 - sstep(3500, 7000, ds);
    let h = 0, dome = 0;
    if (mw < 1) {
      const zr = riverZ(x);
      const d = z - zr;
      const ad = Math.abs(d);
      const floor = mainFloor(x);
      if (d > 0) h = floor + REG.s1 * sstep(500, 2600, ad) + REG.s2 * sstep(2000, 7500, ad);
      else h = floor + REG.n1 * sstep(500, 2500, ad) + REG.n2 * sstep(2000, 9500, ad);
      const mount = sstep(600, 3000, ad);
      if (mount > 0) {
        const e = fbmEroded(x / 5200 + 3.1, z / 5200 - 7.3, 4, 0.5);
        const r = ridged(x / 3100 - 1.7, z / 3100 + 4.2, 4, 0.5);
        const calm = 0.2 + 0.8 * sstep(1200, 4000, dl);
        h += (e * REG.eA + (r - 0.3) * REG.rA) * mount * calm;
      }
    }
    if (mw > 0) {
      // the massif: a dome broken up by eroded noise
      const dc = Math.min(ds, 3750);
      dome = SUMMIT.h + 60 - 0.45 * dc + 0.00006 * dc * dc - 0.05 * Math.max(0, ds - 3750);
      const sub = fbmEroded(x / 2300 + 0.7, z / 2300 - 2.3, 4, 0.5);
      dome += sub * 650 * (0.35 + 0.65 * sstep(250, 1400, dl)) * sstep(250, 900, ds);
    }
    return h * (1 - mw) + dome * mw;
  }

  // ---------------------------------------------------------------- height
  let LZ_READY = false;
  function height(x, z, coarse) {
    const dl = distToLine(x, z);
    let h = upper(x, z, dl);
    // the towers either side of the notch always stand proud
    for (let i = 0; i < TOWERS.length; i++) {
      const Tw = TOWERS[i], d = Math.hypot(x - Tw[0], z - Tw[1]);
      if (d < 320) { const f = Tw[2] - 1.25 * d; if (f > h) h += (f - h) * (1 - sstep(220, 320, d)); }
    }
    { const mv = mainValley(x, z); if (mv < h + 120) h = smin(h, mv, 120); }

    // valley carving (min); remember the floor of the deepest valley nearby, easing in
    // as a valley starts to cut (so the detail below never switches on abruptly)
    let floorNear = h, hBefore = h;
    for (let i = 0; i < VALLEYS.length; i++) {
      const V = VALLEYS[i];
      const v = valleyValue(x, z, V, h);
      if (v < 1e8 && v < h + V.k) {
        floorNear = Math.min(floorNear, hBefore + (VFLOOR - hBefore) * sstep(h + V.k, h - 20, v));
        h = smin(h, v, V.k);
      }
    }
    // ridge caps
    for (let i = 0; i < RIDGES.length; i++) {
      const c = ridgeCap(x, z, RIDGES[i], h);
      if (c < 1e8) h = smin(h, c, 30);
    }

    // relief above the local valley floor drives the detail amplitude
    const above = Math.max(0, h - Math.min(floorNear, hBefore));
    const relief = sstep(0, 260, above);

    // ---- detail: gullies & ribs on the walls (masked near critical spots)
    const dSum = Math.hypot(x - SUMMIT.x, z - SUMMIT.z);
    const dNotch = NOTCH ? Math.hypot(x - NOTCH.x, z - NOTCH.z) : 1e9;
    const dLZ = Math.hypot(x - LZ.x, z - LZ.z);
    const mask = sstep(30, 260, dSum) * (0.3 + 0.7 * sstep(40, 220, dNotch)) * sstep(80, 320, dLZ);
    const e = fbmEroded(x / 700 + 11.3, z / 700 - 2.9, 5, 0.5);
    const qx = x + e * 160, qz = z - e * 160;
    const r = ridged(qx / 420 + 7.7, qz / 420 + 1.3, coarse ? 2 : 3, 0.5);
    h += (e * 95 + (r - 0.32) * 120) * relief * mask;
    // rock strata: terraces on high rugged walls
    if (h > 1900 && relief > 0.3) {
      const step = 18, tv = h / step, fl = Math.floor(tv), fr = tv - fl;
      const terr = (fl + sstep(0.55, 1, fr)) * step;
      h += (terr - h) * 0.35 * relief * sstep(1900, 2500, h) * mask;
    }

    // ---- lakes: carved basins with sloping banks and a thin rim that holds the water
    let lakeF = 1, rimGuard = -1e9;
    for (let i = 0; i < LAKES.length; i++) {
      const L = LAKES[i];
      if (x < L.bb[0] || x > L.bb[1] || z < L.bb[2] || z > L.bb[3]) continue;
      const d = lakeD(L, x, z);
      lakeF = Math.min(lakeF, sstep(L.r - 6, L.r + 30, d));
      if (d > L.r + 700) continue;
      if (d < L.r) {
        const bed = L.level - 1.5 - L.depth * (1 - (d / L.r) * (d / L.r));
        h = Math.min(h, bed);
      } else {
        const e2 = d - L.r;
        // (climbs away steeply past ~400 m, so it has let go long before the 700 m cut-off)
        const far = Math.max(0, e2 - 400);
        const bank = L.level + 0.8 + 0.42 * e2 + 0.0006 * e2 * e2 + 0.02 * far * far + e * 20 * sstep(40, 200, e2);
        if (bank < h + 30) h = smin(h, bank, 30);
        // the rim holds the water everywhere but the outlet, straight downstream, where the
        // valley (and the line, over a lake gate) carries on down past the lip
        const outlet = L.valley >= 0 ? sstep(0.78, 0.93, ((x - L.x) * L.c + (z - L.z) * L.s) / Math.max(d, 1e-3)) : 0;
        const rim = L.level + 0.8 + 0.25 * e2;
        if (e2 < 60 && h < rim) h += (rim - h) * (1 - sstep(20, 60, e2)) * (1 - outlet);
        if (e2 < 60 && outlet < 0.5) rimGuard = Math.max(rimGuard, L.level + 1);
      }
    }
    // flight corridor: carve the line clear (never through a lake's rim), then build the traverse face
    if (dl < 950) {
      const C = corridor(x, z);
      if (C[0] < 1e8 && C[0] < h + 40) {
        const cv = C[0] + e * 6;
        h = rimGuard > -1e8 ? Math.min(h, Math.max(cv, rimGuard)) : smin(h, cv, 26);
      }
      if (C.wallW > 0 && C[1] > h) h += (C[1] + e * 10 * relief - h) * C.wallW;
    }
    // ---- decal: summit block with the north-face exit cliff
    if (dSum < 420) {
      const dz = z - SUMMIT.z;
      const north = dSum > 1e-3 ? -dz / dSum : 1;
      const faceW = sstep(0.25, 0.75, north);
      const dd = Math.max(0, dSum - 6);
      const wall = Math.min(6.2 * dd, 95 + 3.0 * Math.max(0, dd - 15.3), 255 + 1.05 * Math.max(0, dd - 68));
      const faceH = SUMMIT.h - 2 - wall;
      const knobs = (ridged(x / 36 + 3.3, z / 36 - 1.1, 3, 0.5) - 0.45) * 9 * sstep(6, 40, dSum);
      const roundH = SUMMIT.h - 2 - 1.35 * dd - 0.0022 * dd * dd + knobs;
      let s = faceW * faceH + (1 - faceW) * roundH;
      if (dSum < 6) s = SUMMIT.h - 1 - 2.2 * (dSum / 6) * (dSum / 6) + knobs * 0.25;
      const w = (1 - sstep(60 + 110 * faceW, 150 + 260 * faceW, dSum));
      h += (s - h) * w;
    }

    // ---- decal: landing meadow (valley floor or mountain shelf)
    if (LZ_READY && LZ.type !== 'lake' && dLZ < 330) {
      const mtn = LZ.type === 'mountain';
      // a mountain shelf is a small alpine meadow that rolls a little, not a flat pad
      const roll = mtn ? fbm(x / 70 + 4.1, z / 70 - 2.7, 2, 0.5) * 6 * sstep(35, 110, dLZ) : 0;
      const plane = LZ.h + (z - LZ.z) * LZ.tz + (x - LZ.x) * LZ.tx + roll;
      const w = 1 - sstep(mtn ? 50 : 90, mtn ? 210 : 310, dLZ);
      h += (plane - h) * w * w * (3 - 2 * w);
    }

    // ---- fine grain (skip on the water and the meadow)
    if (coarse) return h;
    const f = fbm(x / 55 + 1.9, z / 55 - 4.4, 2, 0.5);
    h += f * (2.5 + 9 * relief) * sstep(18, 60, dSum) * lakeF * (0.3 + 0.7 * (LZ.type === 'mountain' ? sstep(35, 160, dLZ) : sstep(100, 380, dLZ)));
    return h;
  }

  // ---- drop tarns that would hang above their surroundings (on a steep valley step)
  for (let i = LAKES.length - 1; i >= 0; i--) {
    const L = LAKES[i];
    if (L.lz || L.gate !== undefined) continue;
    let low = 0;
    for (let a = 0; a < 24; a++) {
      const th = a / 24 * Math.PI * 2;
      if (Math.cos(th) > 0.64) continue;   // the outlet, downstream
      for (const e2 of [45, 90]) {
        const u = Math.cos(th) * (L.r + e2), v = Math.sin(th) * (L.r + e2) / L.k;
        if (height(L.x + u * L.c - v * L.s, L.z + u * L.s + v * L.c, true) < L.level + 1) low++;
      }
    }
    if (low > 1) LAKES.splice(i, 1);
  }

  // ---- mountain landing: find a gentle shelf on the gully's side at the planned height
  if (LZTYPE === 'mountain') {
    let best = null;
    const ring = [[0, 0], [70, 0], [-70, 0], [0, 70], [0, -70], [50, 50], [-50, -50], [50, -50], [-50, 50]];
    const outer = [[150, 0], [-150, 0], [0, 150], [0, -150], [106, 106], [-106, -106], [106, -106], [-106, 106]];
    for (const dt of [-240, -160, -80, 0, 80, 160]) for (let e = 100; e <= 620; e += 40) for (const sg of [-1, 1]) {
      const [cx, cz] = offPt(tL + dt, vOff + sg * e);
      let sum = 0, mn = 1e9, mx = -1e9, mn2 = 1e9, mx2 = -1e9;
      for (const [ox, oz] of ring) { const hh = height(cx + ox, cz + oz, true); sum += hh; if (hh < mn) mn = hh; if (hh > mx) mx = hh; }
      const mean = sum / ring.length;
      for (const [ox, oz] of outer) { const hh = height(cx + ox, cz + oz, true) - mean; if (hh < mn2) mn2 = hh; if (hh > mx2) mx2 = hh; }
      // near the planned height, flat close in, and gentle out to 150 m (no mesa or pit)
      const off = Math.abs(mean - LZH0);
      const score = off * 0.6 + Math.max(0, off - 140) * 3 + (mx - mn) * 1.6 + (mx2 - mn2) * 0.6 + Math.abs(dt) * 0.1;
      if (!best || score < best.score) best = { score, x: cx, z: cz, h: mean };
    }
    LZ.x = best.x; LZ.z = best.z; LZ.h = Math.round(best.h);
    LINE[LINE.length - 1] = [LZ.x, LZ.z];
    const bb = bboxOf(LINE);
    for (let i = 0; i < 4; i++) LINE_BB[i] = bb[i];
  } else if (LZTYPE === 'valley') {
    LZ.h = Math.round(mainFloor(LZ.x) + 7);
  }
  LZ_READY = true;

  // the detailed heightfield (5120 x 8192 m) is centred on the flight
  const BOX = { x0: 0, z0: -7160, w: 5120, h: 8192 };
  {
    let x0 = Math.min(0, LZ.x), x1 = Math.max(0, LZ.x);
    for (const g of GATES) { x0 = Math.min(x0, g[0]); x1 = Math.max(x1, g[0]); }
    BOX.x0 = Math.round(clamp((x0 + x1) / 2 - 2560, -4200, -900) / 64) * 64;
  }
  function lakeAt(x, z, pad) {
    for (let i = 0; i < LAKES.length; i++) if (lakeD(LAKES[i], x, z) < LAKES[i].r + (pad || 0)) return LAKES[i];
    return null;
  }

  return {
    height, riverZ, mainFloor, noise, fbm, ridged, sstep, distToLine, lakeD, lakeAt,
    SEED, SIDE, F0, RIV, BOX, SUMMIT, EXIT, LAKES, NOTCH, LZ, GATES, LINE, RIDGES, VALLEYS, CORRIDOR, TOWERS,
  };
}
if (typeof module !== 'undefined') module.exports = { makeTerrainCore };
