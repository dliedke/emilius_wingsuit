// ============================================================================
// terrain-core.js — self-contained procedural geography for "Emilius".
// Pure JS, no dependencies: this function's source is also shipped to Web
// Workers (via Function.prototype.toString), so it must not reference anything
// outside itself.
// Coordinates: x = east, z = south (north is -z), y = up, meters.
//
// Terrain model: the landscape is "carved": an upper bound (massif dome or
// regional noise mountains) is cut down by a drainage network (valley
// profiles, min-combined), which leaves sharp ridges where valleys meet.
// Ridge caps set crest heights (towers, the notch), then local "decals" sculpt
// the summit exit, the lake cirque and the landing meadow exactly.
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
  function sstep(e0, e1, x) { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); }
  function smin(a, b, k) { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; }
  function bbDist(x, z, bb) {
    const dx = x < bb[0] ? bb[0] - x : x > bb[1] ? x - bb[1] : 0;
    const dz = z < bb[2] ? bb[2] - z : z > bb[3] ? z - bb[3] : 0;
    return Math.sqrt(dx * dx + dz * dz);
  }

  // ---------------------------------------------------- designed geography
  const SUMMIT = { x: 0, z: 0, h: 3559 };
  const EXIT = { x: 0, z: -6.2, heading: 0 };     // heading 0 = facing north (-z)
  const LAKE = { x: -270, z: -880, r: 215, sz: 1.12, level: 2862, depth: 24 };
  const NOTCH = { x: 602, z: -1553, h: 2530 };
  const LZ = { x: 1270, z: -5230, h: 596 };

  // Main river (Dora Baltea) centreline
  function riverZ(x) { return -5820 + 180 * Math.sin(x / 2600 + 0.4) + 80 * Math.sin(x / 1050 + 1.7); }
  function mainFloor(x) { return 588 + 0.0022 * Math.max(0, -x) - 0.0008 * Math.max(0, x); }

  // Drainage network: [x, z, floor, halfWidth, wallSlope, wallCurv]
  const VALLEYS = [
    { name: 'V1', k: 60, pts: [ // scree cirque below the face -> the lake -> north
      [-40, -240, 3175, 60, 0.62, 0.0004],
      [-200, -640, 2900, 90, 0.6, 0.0004],
      [-290, -1105, 2857, 24, 0.7, 0.00045],
      [-300, -1300, 2722, 26, 0.85, 0.00045],
      [-320, -1600, 2600, 34, 0.75, 0.00042],
      [-350, -2100, 2390, 40, 0.72, 0.0004],
      [-380, -2800, 2080, 45, 0.7, 0.00038],
      [-400, -3500, 1720, 50, 0.66, 0.00036],
      [-420, -4200, 1320, 60, 0.6, 0.00034],
      [-430, -4800, 700, 80, 0.5, 0.0003],
      [-440, -5350, 610, 140, 0.35, 0.00025],
    ]},
    { name: 'V2', k: 60, pts: [ // the gully (the line's lower half)
      [1320, -420, 2780, 40, 0.75, 0.00045],
      [1200, -1000, 2580, 36, 0.78, 0.00045],
      [1110, -1650, 2385, 32, 0.8, 0.00045],
      [1060, -2300, 2090, 32, 0.82, 0.00045],
      [1140, -3000, 1780, 36, 0.8, 0.00042],
      [1190, -3700, 1430, 40, 0.74, 0.0004],
      [1235, -4350, 1000, 55, 0.62, 0.00035],
      [1250, -4850, 680, 90, 0.45, 0.0003],
      [1265, -5250, 612, 160, 0.3, 0.00025],
      [1280, -5600, 598, 220, 0.2, 0.0002],
    ]},
    { name: 'V0', k: 60, pts: [ // west of R2
      [-1500, -900, 2700, 40, 0.7, 0.0004],
      [-1350, -1800, 2350, 45, 0.7, 0.0004],
      [-1250, -2900, 1850, 50, 0.65, 0.00038],
      [-1200, -4000, 1300, 60, 0.6, 0.00035],
      [-1250, -4900, 700, 90, 0.45, 0.0003],
      [-1300, -5500, 612, 160, 0.3, 0.00025],
    ]},
    { name: 'V3', k: 60, pts: [ // east of R5
      [3000, -900, 2650, 40, 0.7, 0.0004],
      [2950, -1800, 2350, 45, 0.7, 0.0004],
      [2900, -2900, 1900, 50, 0.65, 0.00038],
      [2880, -4000, 1350, 60, 0.6, 0.00035],
      [2900, -4900, 680, 90, 0.45, 0.0003],
      [2950, -5450, 600, 160, 0.3, 0.00025],
    ]},
    { name: 'VS3', k: 60, pts: [ // cirque south-west of the summit
      [-420, 330, 3170, 60, 0.7, 0.00045],
      [-760, 900, 2880, 50, 0.72, 0.00042],
      [-900, 1600, 2600, 50, 0.7, 0.0004],
    ]},
    { name: 'VS4', k: 60, pts: [ // cirque south-east of the summit
      [470, 380, 3160, 60, 0.7, 0.00045],
      [900, 950, 2890, 50, 0.72, 0.00042],
      [1300, 1700, 2620, 50, 0.7, 0.0004],
    ]},
    { name: 'VS1', k: 60, pts: [ // south-west, behind the summit
      [-700, 650, 2950, 40, 0.75, 0.00045],
      [-900, 1600, 2600, 50, 0.7, 0.0004],
      [-1300, 2800, 2200, 60, 0.65, 0.0004],
      [-1700, 4200, 1800, 80, 0.6, 0.0004],
    ]},
    { name: 'VS2', k: 60, pts: [ // south-east, behind the summit
      [800, 720, 2980, 40, 0.75, 0.00045],
      [1300, 1700, 2620, 50, 0.7, 0.0004],
      [1900, 2900, 2200, 60, 0.65, 0.0004],
      [2500, 4200, 1800, 80, 0.6, 0.0004],
    ]},
    { name: 'VW', k: 60, pts: [ // far west side valley
      [-2800, -1500, 2500, 50, 0.7, 0.0004],
      [-2700, -3000, 1900, 60, 0.65, 0.0004],
      [-2600, -4500, 1150, 80, 0.55, 0.00035],
      [-2550, -5500, 620, 160, 0.3, 0.00025],
    ]},
  ];
  function mainValley(x, z) {
    const d = Math.abs(z - riverZ(x)) * 0.985;
    const e = Math.max(0, d - 600);
    const u = Math.min(d, 600) / 600;
    return mainFloor(x) + u * u * 10 + 0.2 * e + 0.00105 * e * e;
  }

  // The flight corridor: guarantees the line is flyable (carve) and builds the
  // face you traverse on the right before the notch (fill).
  // [x, z, floor, halfWidth, slopeLeft, slopeRight, wallRight(0/1)]
  const CORRIDOR = { name: 'LN', pts: [
    [2, -95, 3400, 12, 2.5, 2.5, 0],
    [8, -170, 3290, 18, 1.4, 1.4, 0],
    [10, -330, 3130, 40, 0.8, 0.9, 0],
    [120, -820, 2944, 34, 0.55, 1.1, 1],
    [290, -1250, 2758, 30, 0.6, 1.15, 1],
    [420, -1520, 2626, 26, 0.75, 1.1, 0],
    [602, -1553, 2530, 9, 2.5, 2.5, 0],
    [720, -1575, 2478, 16, 1.8, 1.8, 0],
    [880, -1600, 2400, 30, 0.95, 0.95, 0],
    [1070, -2300, 2092, 32, 0.8, 0.8, 0],
  ]};
  {
    const r = CORRIDOR;
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (const p of r.pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
    r.bb = [x0, x1, z0, z1];
  }
  // returns [carveHeight, wallFillHeight or -1e9]
  const CORR_OUT = [0, 0];
  CORRIDOR.cum = [0];
  for (let i = 1; i < CORRIDOR.pts.length; i++) CORRIDOR.cum.push(CORRIDOR.cum[i - 1] + Math.hypot(CORRIDOR.pts[i][0] - CORRIDOR.pts[i - 1][0], CORRIDOR.pts[i][1] - CORRIDOR.pts[i - 1][1]));
  function corridor(x, z) {
    CORR_OUT[0] = 1e9; CORR_OUT[1] = -1e9; CORR_OUT.wallW = 0;
    if (bbDist(x, z, CORRIDOR.bb) > 900) return CORR_OUT;
    const pts = CORRIDOR.pts;
    let carve = 1e9, bestD = 1e9;
    let wallW = 0, wallF = -1e9;
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
      const left = ex * pz - ez * px < 0;
      const s = left ? a[4] + (b[4] - a[4]) * t : a[5] + (b[5] - a[5]) * t;
      const e = Math.max(0, d - w);
      const u = Math.min(d, w) / w;
      let v = floor + u * u * 3 + s * e + 0.0005 * e * e;
      if (e > 0) {
        const sArc = CORRIDOR.cum[i] + t * Math.sqrt(L2);
        const g = noise(sArc / 120 + (left ? 3.3 : 71.9), e / 520) + 0.5 * noise(sArc / 48 - 9.1, e / 230 + (left ? 1.7 : 5.3));
        v += g * Math.min(e * 0.35, 90);
      }
      carve = carve > 1e8 ? v : smin(carve, v, 45);
      if (d < bestD) bestD = d;
      const wall = a[6] + (b[6] - a[6]) * t;
      if (!left && wall > 0.01 && d < 300 && tRaw > 0 && tRaw < 1) {
        const q = Math.max(0, d - 30);
        const f = floor + 1.12 * q + 0.0006 * q * q;
        const ww = wall * (1 - sstep(170, 290, d)) * sstep(20, 45, d);
        if (ww > wallW) { wallW = ww; wallF = f; }
      }
    }
    CORR_OUT[0] = carve;
    CORR_OUT[1] = wallF;
    CORR_OUT.wallW = wallW;
    return CORR_OUT;
  }

  // Ridge caps: [x, z, crestHeight, capSlope]  — the terrain can't rise above
  // crest + capSlope * distance, which sets crest profiles (towers, notch).
  const RIDGES = [
    { name: 'R1', pts: [
      [0, 0, 3559, 2.2],
      [150, -350, 3380, 2.1],
      [330, -800, 3150, 2.0],
      [480, -1250, 2960, 2.0],
      [555, -1400, 2885, 3.4],   // tower A
      [602, -1553, 2530, 3.0],   // the notch
      [650, -1720, 2860, 3.4],   // tower B
      [720, -1980, 2760, 2.0],
      [790, -2500, 2590, 1.9],
      [860, -3120, 2330, 1.8],
      [910, -3800, 1910, 1.7],
      [960, -4420, 1420, 1.5],
      [995, -4880, 1000, 1.2],
    ]},
    { name: 'R2', pts: [
      [0, 0, 3559, 2.0],
      [-420, -200, 3420, 2.0],
      [-900, -520, 3235, 1.9],
      [-1400, -1000, 3010, 1.8],
      [-1760, -1700, 2800, 1.8],
      [-1960, -2600, 2520, 1.7],
      [-2150, -3500, 2150, 1.6],
      [-2300, -4400, 1650, 1.4],
    ]},
    { name: 'R4', pts: [
      [0, 0, 3559, 2.0],
      [480, 80, 3380, 2.0],
      [1100, 40, 3210, 1.9],
      [1950, -200, 3000, 1.8],
      [2700, -500, 2830, 1.8],
      [3400, -900, 2620, 1.7],
    ]},
    { name: 'R5', pts: [
      [1950, -200, 3000, 1.8],
      [2080, -850, 2900, 1.8],
      [2150, -1600, 2720, 1.8],
      [2120, -2400, 2480, 1.7],
      [2050, -3200, 2130, 1.6],
      [1980, -4000, 1650, 1.5],
      [1930, -4700, 1150, 1.3],
    ]},
  ];

  function prep(list, idx, fn) {
    for (const r of list) {
      let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
      for (const p of r.pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
      r.bb = [x0, x1, z0, z1];
      r.ext = fn(...r.pts.map(p => p[idx]));
    }
  }
  prep(VALLEYS, 2, Math.min);
  prep(RIDGES, 2, Math.min);
  for (const v of VALLEYS) {
    v.minWall = Math.min(...v.pts.map(p => p[4]));
    v.cum = [0];
    for (let i = 1; i < v.pts.length; i++) v.cum.push(v.cum[i - 1] + Math.hypot(v.pts[i][0] - v.pts[i - 1][0], v.pts[i][1] - v.pts[i - 1][1]));
    v.seed = v.cum.length * 13.1 + v.pts[0][0] * 0.001;
  }
  for (const r of RIDGES) r.minSlope = Math.min(...r.pts.map(p => p[3]));

  // valley profile: floor + wall(e); sets VFLOOR to the winning floor height
  let VFLOOR = 0;
  let GULLY = 1.05;
  function valleyValue(x, z, v, hNow) {
    if (v.ext + v.minWall * bbDist(x, z, v.bb) > hNow + v.k) return 1e9;
    const pts = v.pts, last = pts.length - 2;
    let best = 1e9, bestF = 0, bi = -1, bt = 0, be = 0, bside = 1;
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
      if (val < best) { bestF = floor; bi = i; bt = t; be = e; bside = ex * pz - ez * px < 0 ? 1 : -1; }
      best = best > 1e8 ? val : smin(best, val, 50);
    }
    // spurs & gullies running down the walls: noise stretched across the valley axis
    if (be > 0 && !v.smooth && bi >= 0) {
      let sArc = v.cum[bi] + bt * (v.cum[bi + 1] - v.cum[bi]);
      sArc += 110 * noise(sArc / 420 + v.seed * 0.3, be / 500 + bside * 2.1);
      const g = noise(sArc / 170 + v.seed + bside * 50.3, be / 800 + bside * 7.1) + 0.5 * noise(sArc / 64 - v.seed, be / 300 - bside * 3.3);
      best += g * Math.min(be * 0.55, 220) * GULLY;
    }
    VFLOOR = bestF;
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

  // The flight line (for calming random noise near it)
  const LINE = [[0, -20], [10, -330], [120, -820], [290, -1250], [420, -1520], [602, -1553], [880, -1600], [1070, -2300], [1140, -3000], [1190, -3700], [1230, -4350], [1270, -5230]];
  const LINE_BB = [-1e9, 1e9, -1e9, 1e9];
  {
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (const p of LINE) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
    LINE_BB[0] = x0; LINE_BB[1] = x1; LINE_BB[2] = z0; LINE_BB[3] = z1;
  }
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
  function upper(x, z, dl) {
    const ds = Math.hypot(x - SUMMIT.x, z - SUMMIT.z);
    const mw = 1 - sstep(3500, 7000, ds);
    let h = 0, dome = 0;
    if (mw < 1) {
      const zr = riverZ(x);
      const d = z - zr;
      const ad = Math.abs(d);
      const floor = mainFloor(x);
      if (d > 0) h = floor + 1500 * sstep(500, 2600, ad) + 1300 * sstep(2000, 7500, ad);
      else h = floor + 1600 * sstep(500, 2500, ad) + 1700 * sstep(2000, 9500, ad);
      const mount = sstep(600, 3000, ad);
      if (mount > 0) {
        const e = fbmEroded(x / 5200 + 3.1, z / 5200 - 7.3, 4, 0.5);
        const r = ridged(x / 3100 - 1.7, z / 3100 + 4.2, 4, 0.5);
        const calm = 0.2 + 0.8 * sstep(1200, 4000, dl);
        h += (e * 1100 + (r - 0.3) * 1300) * mount * calm;
      }
    }
    if (mw > 0) {
      // the Emilius massif: a dome broken up by eroded noise
      const dc = Math.min(ds, 3750);
      dome = SUMMIT.h + 60 - 0.45 * dc + 0.00006 * dc * dc - 0.05 * Math.max(0, ds - 3750);
      const sub = fbmEroded(x / 2300 + 0.7, z / 2300 - 2.3, 4, 0.5);
      dome += sub * 650 * (0.35 + 0.65 * sstep(250, 1400, dl)) * sstep(250, 900, ds);
    }
    return h * (1 - mw) + dome * mw;
  }

  // ---------------------------------------------------------------- height
  function height(x, z, coarse) {
    const dl = distToLine(x, z);
    let h = upper(x, z, dl);
    { const mv = mainValley(x, z); if (mv < h + 120) h = smin(h, mv, 120); }

    // valley carving (min); remember the floor of the deepest valley nearby
    let floorNear = h, hBefore = h;
    for (let i = 0; i < VALLEYS.length; i++) {
      const V = VALLEYS[i];
      const v = valleyValue(x, z, V, h);
      if (v < 1e8) {
        if (v < h + V.k) { const nh = smin(h, v, V.k); if (v < h) floorNear = VFLOOR; h = nh; }
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
    const dNotch = Math.hypot(x - NOTCH.x, z - NOTCH.z);
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

    // ---- lake: carved basin with sloping banks and a thin rim that holds the water
    {
      const dx = x - LAKE.x, dz = (z - LAKE.z) * LAKE.sz;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < LAKE.r + 700) {
        if (d < LAKE.r) {
          const bed = LAKE.level - 1.5 - LAKE.depth * (1 - (d / LAKE.r) * (d / LAKE.r));
          h = Math.min(h, bed);
        } else {
          const e2 = d - LAKE.r;
          const bank = LAKE.level + 0.8 + 0.42 * e2 + 0.0006 * e2 * e2 + e * 20 * sstep(40, 200, e2);
          if (bank < h + 30) h = smin(h, bank, 30);
          const rim = LAKE.level + 0.8 + 0.25 * e2;
          if (e2 < 60 && h < rim) h += (rim - h) * (1 - sstep(20, 60, e2));
        }
      }
    }
    // outlet: re-cut V1 through the rim
    {
      const v = valleyValue(x, z, VALLEYS[0], h);
      if (v < 1e8 && v < h + 30) h = smin(h, v, 30);
    }
    // flight corridor: carve the line clear, then build the traverse face
    {
      const C = corridor(x, z);
      if (C[0] < 1e8 && C[0] < h + 40) h = smin(h, C[0] + e * 6, 26);
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

    // ---- decal: landing meadow
    if (dLZ < 320) {
      const plane = LZ.h + (z - LZ.z) * -0.012 + (x - LZ.x) * 0.003;
      const w = 1 - sstep(90, 310, dLZ);
      h += (plane - h) * w * w * (3 - 2 * w);
    }

    // ---- fine grain (skip on the water and the meadow)
    if (coarse) return h;
    const dLake = Math.hypot(x - LAKE.x, (z - LAKE.z) * LAKE.sz);
    const f = fbm(x / 55 + 1.9, z / 55 - 4.4, 2, 0.5);
    h += f * (2.5 + 9 * relief) * sstep(18, 60, dSum) * sstep(LAKE.r - 6, LAKE.r + 30, dLake) * (0.3 + 0.7 * sstep(100, 380, dLZ));
    return h;
  }

  // Gates along the line: [x, z, y, radius]
  const GATES = [
    [10, -330, 3200, 22],
    [120, -820, 2990, 20],
    [290, -1250, 2800, 18],
    [420, -1520, 2666, 17],
    [602, -1553, 2566, 14],   // the notch between the towers
    [880, -1600, 2440, 18],
    [1070, -2300, 2150, 18],
    [1140, -3000, 1830, 18],
    [1190, -3700, 1510, 18],
    [1230, -4350, 1214, 20],
  ];

  return {
    height, riverZ, mainFloor, noise, fbm, ridged, sstep, distToLine,
    SUMMIT, EXIT, LAKE, NOTCH, LZ, GATES, LINE, RIDGES, VALLEYS, CORRIDOR,
  };
}
if (typeof module !== 'undefined') module.exports = { makeTerrainCore };
