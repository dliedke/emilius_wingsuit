// ============================================================== WORLD GEN
// Two nested heightfields: L0 = detailed flight corridor (placed by the world
// around its line, TC.BOX), L2 = far terrain.
const L2_DEF = { x0: -19520, z0: -23640, cell: 40, n: 1025 };
const CHUNK_Q = 64;
const WORLD = { L0: null, L2: null, trees: null, treeGrid: null };

function makeLevel(x0, z0, cell, nx, nz) {
  return { x0, z0, cell, nx, nz, x1: x0 + (nx - 1) * cell, z1: z0 + (nz - 1) * cell, h: new Float32Array(nx * nz) };
}

// Worker program: its source is assembled from makeTerrainCore + this body.
function workerBody() {
  let T = null;
  self.onmessage = (ev) => {
    const m = ev.data;
    if (m.type === 'init') { T = makeTerrainCore(m.seed); self.postMessage({ type: 'ready' }); return; }
    if (m.type === 'rows') {
      const { lvl, x0, z0, cell, nx, j0, j1, rect } = m;
      const out = new Float32Array(nx * (j1 - j0));
      let k = 0;
      for (let j = j0; j < j1; j++) {
        const z = z0 + j * cell;
        const zin = rect && z > rect[2] && z < rect[3];
        for (let i = 0; i < nx; i++) {
          const x = x0 + i * cell;
          const coarse = rect ? !(zin && x > rect[0] && x < rect[1]) : false;
          out[k++] = T.height(x, z, coarse);
        }
      }
      self.postMessage({ type: 'rows', lvl, j0, j1, out }, [out.buffer]);
    }
  };
}

function createWorkerPool() {
  return new Promise((resolve) => {
    let url;
    try {
      const src = makeTerrainCore.toString() + '\n(' + workerBody.toString() + ')();';
      url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    } catch (e) { resolve(null); return; }
    const n = clamp((navigator.hardwareConcurrency || 4) - 1, 2, 8);
    const workers = [];
    let ready = 0, settled = false;
    const fail = () => { if (settled) return; settled = true; workers.forEach((w) => w.terminate()); resolve(null); };
    const timer = setTimeout(fail, 4000);
    try {
      for (let i = 0; i < n; i++) {
        const w = new Worker(url);
        w.onmessage = (e) => {
          if (e.data && e.data.type === 'ready') {
            ready++;
            if (ready === n && !settled) { settled = true; clearTimeout(timer); resolve(workers); }
          }
        };
        w.onerror = fail;
        w.postMessage({ type: 'init', seed: SEED });
        workers.push(w);
      }
    } catch (e) { clearTimeout(timer); fail(); }
  });
}

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

async function generateHeights(progress) {
  const B = TC.BOX;
  const L0 = makeLevel(B.x0, B.z0, CELL0, B.w / CELL0 + 1, B.h / CELL0 + 1);
  const L2 = makeLevel(L2_DEF.x0, L2_DEF.z0, L2_DEF.cell, L2_DEF.n, L2_DEF.n);
  const levels = { 0: L0, 2: L2 };
  const fullRect = [L0.x0 - 480, L0.x1 + 480, L0.z0 - 480, L0.z1 + 480];
  const tasks = [];
  for (const lvl of [0, 2]) {
    const L = levels[lvl];
    const rb = Math.max(4, Math.floor(36000 / L.nx));
    for (let j = 0; j < L.nz; j += rb) {
      const j1 = Math.min(L.nz, j + rb);
      tasks.push({ lvl, j0: j, j1, w: L.nx * (j1 - j) * (lvl === 2 ? 0.6 : 1) });
    }
  }
  const total = tasks.reduce((a, t) => a + t.w, 0);
  let done = 0;
  const msgFor = (t) => {
    const L = levels[t.lvl];
    return { type: 'rows', lvl: t.lvl, x0: L.x0, z0: L.z0, cell: L.cell, nx: L.nx, j0: t.j0, j1: t.j1, rect: t.lvl === 2 ? fullRect : null };
  };
  const workers = await createWorkerPool();
  let ok = false;
  if (workers) {
    ok = await new Promise((resolve) => {
      let next = 0, active = 0, failed = false;
      const pump = (w) => {
        if (failed) return;
        if (next >= tasks.length) { if (active === 0) resolve(true); return; }
        const t = tasks[next++]; active++;
        w._task = t;
        w.postMessage(msgFor(t));
      };
      for (const w of workers) {
        w.onmessage = (e) => {
          const d = e.data;
          if (!d || d.type !== 'rows') return;
          levels[d.lvl].h.set(d.out, d.j0 * levels[d.lvl].nx);
          active--; done += w._task.w;
          progress(done / total);
          pump(w);
        };
        w.onerror = () => { failed = true; resolve(false); };
      }
      for (const w of workers) pump(w);
    });
    workers.forEach((w) => w.terminate());
  }
  if (!ok) {
    done = 0;
    let last = performance.now();
    for (const t of tasks) {
      const L = levels[t.lvl];
      const rect = t.lvl === 2 ? fullRect : null;
      let k = t.j0 * L.nx;
      for (let j = t.j0; j < t.j1; j++) {
        const z = L.z0 + j * L.cell;
        const zin = rect && z > rect[2] && z < rect[3];
        for (let i = 0; i < L.nx; i++) {
          const x = L.x0 + i * L.cell;
          L.h[k++] = TC.height(x, z, rect ? !(zin && x > rect[0] && x < rect[1]) : false);
        }
      }
      done += t.w;
      if (performance.now() - last > 40) { progress(done / total); await nextFrame(); last = performance.now(); }
    }
  }
  return { L0, L2 };
}

function levelHeight(L, x, z) {
  let fx = (x - L.x0) / L.cell, fz = (z - L.z0) / L.cell;
  fx = fx < 0 ? 0 : fx > L.nx - 1.0001 ? L.nx - 1.0001 : fx;
  fz = fz < 0 ? 0 : fz > L.nz - 1.0001 ? L.nz - 1.0001 : fz;
  const i = fx | 0, j = fz | 0, u = fx - i, v = fz - j;
  const k = j * L.nx + i, H = L.h;
  const h00 = H[k], h10 = H[k + 1], h01 = H[k + L.nx], h11 = H[k + L.nx + 1];
  // same triangulation as the terrain mesh
  if (u > v) return h00 + (h10 - h00) * u + (h11 - h10) * v;
  return h00 + (h11 - h01) * u + (h01 - h00) * v;
}
function blendEdgeToFar(L0, L2) {
  const B = 120;
  for (let j = 0; j < L0.nz; j++) for (let i = 0; i < L0.nx; i++) {
    const x = L0.x0 + i * L0.cell, z = L0.z0 + j * L0.cell;
    const e = Math.min(x - L0.x0, L0.x1 - x, z - L0.z0, L0.z1 - z);
    if (e >= B) continue;
    const w = smoothstep(0, B, e);
    const k = j * L0.nx + i;
    L0.h[k] = levelHeight(L2, x, z) * (1 - w) + L0.h[k] * w;
  }
}
function inLevel(L, x, z) { return x >= L.x0 && x <= L.x1 && z >= L.z0 && z <= L.z1; }
function groundHeight(x, z) {
  if (inLevel(WORLD.L0, x, z)) return levelHeight(WORLD.L0, x, z);
  if (inLevel(WORLD.L2, x, z)) return levelHeight(WORLD.L2, x, z);
  return 500;
}
// the floating landing platform (lake landing zones)
function onPlatform(x, z) { const L = TC.LZ; return L.plat > 0 && Math.hypot(x - L.x, z - L.z) < L.plat; }
function isWater(x, z) {
  if (onPlatform(x, z)) return null;
  const L = TC.lakeAt(x, z, 2);
  if (L && groundHeight(x, z) < L.level) return 'lake';
  if (Math.abs(z - TC.riverZ(x)) < 11) return 'river';
  return null;
}
function waterLevel(x, z) {
  const L = TC.lakeAt(x, z, 2);
  if (L) return L.level;
  if (Math.abs(z - TC.riverZ(x)) < 11) return TC.mainFloor(x) - 0.9;
  return -1e9;
}
// highest thing you can touch: terrain, lake water or the landing platform
function surfaceHeight(x, z) {
  const g = groundHeight(x, z);
  if (onPlatform(x, z)) return Math.max(g, TC.LZ.h);
  const L = TC.lakeAt(x, z, 0);
  return L && L.level > g ? L.level : g;
}
// distance (in the lake's own units) to the nearest lake shore, for masks
function lakeShoreDist(x, z) {
  let best = 1e9;
  for (const L of TC.LAKES) {
    if (Math.abs(x - L.x) > L.r + 900 || Math.abs(z - L.z) > L.r + 900) continue;
    best = Math.min(best, TC.lakeD(L, x, z) - L.r);
  }
  return best;
}

// ------------------------------------------------------------ baking
function horizonShadow(L, outer) {
  const { nx, nz, cell, h, x0, z0 } = L;
  const hl = Math.hypot(SUN_DIR.x, SUN_DIR.z);
  const hx = SUN_DIR.x / hl, hz = SUN_DIR.z / hl, tanE = SUN_DIR.y / hl;
  const di = hx < 0 ? -1 : 1;                // neighbour column toward the sun
  const dj = hz / Math.abs(hx);              // its row offset in cells
  const rise = cell / Math.abs(hx) * tanE;   // horizon drop per column step
  const H = new Float32Array(nx * nz), S = new Float32Array(nx * nz);
  const soft0 = -0.6 * Math.max(4, cell), soft1 = 2.6 * Math.max(4, cell);
  const iFirst = di < 0 ? 0 : nx - 1, iEnd = di < 0 ? nx : -1, istep = -di;
  for (let i = iFirst; i !== iEnd; i += istep) {
    const iu = i + di;
    const xu = x0 + iu * cell;
    const colOk = iu >= 0 && iu < nx;
    for (let j = 0; j < nz; j++) {
      const k = j * nx + i;
      const ju = j + dj;
      let Hu;
      if (colOk && ju >= 0 && ju <= nz - 1) {
        const j0 = ju | 0, f = ju - j0, j1 = j0 + 1 < nz ? j0 + 1 : j0;
        Hu = H[j0 * nx + iu] * (1 - f) + H[j1 * nx + iu] * f;
      } else Hu = outer ? outer(xu, z0 + ju * cell) : -1e9;
      const hp = Hu - rise;
      S[k] = 1 - smoothstep(soft0, soft1, hp - h[k]);
      H[k] = h[k] > hp ? h[k] : hp;
    }
  }
  return { H, S };
}
function boxBlur(src, nx, nz, r) {
  const tmp = new Float32Array(nx * nz), out = new Float32Array(nx * nz), inv = 1 / (2 * r + 1);
  for (let j = 0; j < nz; j++) {
    const row = j * nx;
    let acc = 0;
    for (let i = -r; i <= r; i++) acc += src[row + clamp(i, 0, nx - 1)];
    for (let i = 0; i < nx; i++) {
      tmp[row + i] = acc * inv;
      acc += src[row + Math.min(nx - 1, i + r + 1)] - src[row + Math.max(0, i - r)];
    }
  }
  const col = new Float32Array(nz), res = new Float32Array(nz);
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) col[j] = tmp[j * nx + i];
    let acc = 0;
    for (let j = -r; j <= r; j++) acc += col[clamp(j, 0, nz - 1)];
    for (let j = 0; j < nz; j++) {
      res[j] = acc * inv;
      acc += col[Math.min(nz - 1, j + r + 1)] - col[Math.max(0, j - r)];
    }
    for (let j = 0; j < nz; j++) out[j * nx + i] = res[j];
  }
  return out;
}

// Pack normal.xz / sun visibility / ambient occlusion into RGBA8, and the
// splat map (forest, snow, scree, wet) into a second RGBA8.
function bakeLevel(L, outerHorizon, isFar) {
  const { nx, nz, cell, h, x0, z0 } = L;
  const { H, S } = horizonShadow(L, outerHorizon);
  L.horizon = H;
  const r1 = Math.max(1, Math.round(14 / cell)), r2 = Math.max(2, Math.round(110 / cell)), r3 = Math.max(3, Math.round(420 / cell));
  const b1 = boxBlur(h, nx, nz, r1), b2 = boxBlur(h, nx, nz, r2), b3 = boxBlur(h, nx, nz, r3);
  const nrm = new Uint8Array(nx * nz * 4);
  const spl = new Uint8Array(nx * nz * 4);
  const LZ = TC.LZ;
  const TL = STYLE.treeLine, SL = STYLE.snowLine, dTL = TL - 2060;
  for (let j = 0; j < nz; j++) {
    const z = z0 + j * cell;
    const ju = j > 0 ? j - 1 : j, jd = j < nz - 1 ? j + 1 : j;
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const x = x0 + i * cell;
      const il = i > 0 ? i - 1 : i, ir = i < nx - 1 ? i + 1 : i;
      const sx = (h[j * nx + ir] - h[j * nx + il]) / ((ir - il) * cell);
      const sz = (h[jd * nx + i] - h[ju * nx + i]) / ((jd - ju) * cell);
      const inv = 1 / Math.sqrt(sx * sx + 1 + sz * sz);
      const nX = -sx * inv, nY = inv, nZ = -sz * inv;
      const c1 = b1[k] - h[k], c2 = b2[k] - h[k], c3 = b3[k] - h[k];
      let ao = 1 - Math.max(0, c1) * 0.035 - Math.max(0, c2) * 0.0065 - Math.max(0, c3) * 0.0012;
      ao += Math.max(0, -c2) * 0.0015;          // ridges catch more sky
      ao = clamp(ao, 0.3, 1);
      nrm[k * 4] = (nX * 0.5 + 0.5) * 255 + 0.5;
      nrm[k * 4 + 1] = (nZ * 0.5 + 0.5) * 255 + 0.5;
      nrm[k * 4 + 2] = S[k] * 255 + 0.5;
      nrm[k * 4 + 3] = ao * 255 + 0.5;

      // ---- splat
      const hh = h[k];
      const slope = 1 - nY;
      const n1 = TC.noise(x / 640 + 3.3, z / 640 - 1.7);
      const n2 = TC.noise(x / 170 - 5.1, z / 170 + 2.2);
      const treeline = TL + n1 * 220;
      let forest = smoothstep(treeline + 70, treeline - 140, hh);
      forest *= 1 - smoothstep(0.3, 0.44, slope + n2 * 0.06);
      const n3 = TC.noise(x / 58 + 1.1, z / 58 - 7.7);
      forest *= smoothstep(-0.42, 0.05, n1 * 0.7 + n2 * 0.5 + n3 * 0.22 + 0.08);
      const dr = Math.abs(z - TC.riverZ(x));
      forest *= 0.08 + 0.92 * smoothstep(640, 900, dr + n2 * 120);
      forest *= smoothstep(150, 330, Math.hypot(x - LZ.x, z - LZ.z));
      forest *= smoothstep(30, 120, lakeShoreDist(x, z));
      forest *= smoothstep(-10, 25, c3 + 40);   // denser in hollows, thin on crests
      // snow: high, sheltered, shaded, not too steep
      let snow = smoothstep(SL - 80, SL + 160, hh + n1 * 160 + n2 * 60);
      snow *= 1 - smoothstep(0.2, 0.36, slope);
      snow *= 0.25 + 0.75 * (1 - S[k]);
      snow *= smoothstep(-0.05, 0.3, -nZ + 0.12 + n2 * 0.3);
      snow = clamp(snow * 1.5 - 0.42 + Math.max(0, c2) * 0.008, 0, 1);
      if (isFar) {   // far giants: glaciers above ~3300 m
        snow = Math.max(snow, smoothstep(SL - 50, SL + 400, hh + n1 * 250) * (1 - smoothstep(0.3, 0.5, slope)));
      }
      // scree / talus: moderate slopes below steep walls, high up
      const scree = smoothstep(0.07, 0.16, slope) * (1 - smoothstep(0.26, 0.36, slope)) * smoothstep(1900 + dTL, 2300 + dTL, hh + n1 * 200) * smoothstep(-8, 12, c2);
      const wet = 1 - smoothstep(10, 40, dr);
      spl[k * 4] = forest * 255 + 0.5;
      spl[k * 4 + 1] = snow * 255 + 0.5;
      spl[k * 4 + 2] = scree * 255 + 0.5;
      spl[k * 4 + 3] = wet * 255 + 0.5;
    }
  }
  L.nrm = nrm; L.spl = spl;
  L.shadow = S;
}

function chunkBounds(L) {
  const cx = (L.nx - 1) / CHUNK_Q, cz = (L.nz - 1) / CHUNK_Q;
  const mn = new Float32Array(cx * cz), mx = new Float32Array(cx * cz);
  for (let c = 0; c < cz; c++) for (let r = 0; r < cx; r++) {
    let a = 1e9, b = -1e9;
    for (let j = c * CHUNK_Q; j <= (c + 1) * CHUNK_Q; j++) for (let i = r * CHUNK_Q; i <= (r + 1) * CHUNK_Q; i++) {
      const v = L.h[j * L.nx + i]; if (v < a) a = v; if (v > b) b = v;
    }
    mn[c * cx + r] = a; mx[c * cx + r] = b;
  }
  L.cx = cx; L.cz = cz; L.cmin = mn; L.cmax = mx;
}

function splatAt(L, x, z, ch) {
  const fx = clamp((x - L.x0) / L.cell, 0, L.nx - 1), fz = clamp((z - L.z0) / L.cell, 0, L.nz - 1);
  const i = Math.min(L.nx - 2, fx | 0), j = Math.min(L.nz - 2, fz | 0), u = fx - i, v = fz - j;
  const s = L.spl, n = L.nx;
  const a = s[(j * n + i) * 4 + ch], b = s[(j * n + i + 1) * 4 + ch], c = s[((j + 1) * n + i) * 4 + ch], d = s[((j + 1) * n + i + 1) * 4 + ch];
  return ((a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v) / 255;
}
function shadowAt(L, x, z) {
  const i = clamp(Math.round((x - L.x0) / L.cell), 0, L.nx - 1), j = clamp(Math.round((z - L.z0) / L.cell), 0, L.nz - 1);
  return L.shadow[j * L.nx + i];
}

// ------------------------------------------------------------ trees
// Instances: x, y, z, height, variation, kind (0 spruce, 1 larch, 2 broadleaf)
function placeTrees(L) {
  const rng = mulberry32(Math.imul(SEED, 31) + 4242);
  const cellT = 10;
  const out = [];
  const LZ = TC.LZ;
  const TL = STYLE.treeLine, floorTop = TC.F0 + 320;
  for (let z = L.z0 + 2; z < L.z1 - 2; z += cellT) {
    for (let x = L.x0 + 2; x < L.x1 - 2; x += cellT) {
      const f = splatAt(L, x + cellT * 0.5, z + cellT * 0.5, 0);
      const dr = Math.abs(z - TC.riverZ(x));
      let expect = f * 1.25;
      // valley floor: hedgerows and groves of broadleaf trees
      if (dr < 820 && dr > 40) {
        const g = TC.noise(x / 90 + 7.7, z / 90 - 3.1);
        const hedge = Math.abs(TC.noise(x / 260 - 1.3, z / 260 + 4.4)) < 0.035 ? 0.9 : 0;
        expect += Math.max(0, g - 0.28) * 1.8 + hedge * 0.5;
        if (Math.hypot(x - LZ.x, z - LZ.z) < 170) expect = 0;
        if (Math.abs(dr - 380 + 60 * Math.sin(x / 1400)) < 9 || Math.abs(dr + 260) < 12) expect = 0; // roads
      }
      let n = Math.floor(expect + rng());
      for (let q = 0; q < n; q++) {
        const px = x + rng() * cellT, pz = z + rng() * cellT;
        const y = levelHeight(L, px, pz);
        if (isWater(px, pz)) continue;
        const nearTreeline = smoothstep(TL - 560, TL + 90, y);
        let kind = 0;
        if (y < floorTop && dr < 900) kind = 2;
        else if (rng() < STYLE.larchMix + 0.35 * nearTreeline) kind = 1;
        let ht = kind === 2 ? 9 + rng() * 9 : 14 + rng() * 17;
        ht *= 1 - 0.5 * nearTreeline;
        out.push(px, y - 0.4, pz, ht, rng(), kind);
      }
    }
  }
  const trees = new Float32Array(out);
  // spatial hash for collision / proximity (32 m cells)
  const G = 32, gx = Math.ceil((L.x1 - L.x0) / G), gz = Math.ceil((L.z1 - L.z0) / G);
  const counts = new Uint32Array(gx * gz + 1);
  const N = trees.length / 6;
  const cellOf = (t) => clamp(Math.floor((trees[t * 6 + 2] - L.z0) / G), 0, gz - 1) * gx + clamp(Math.floor((trees[t * 6] - L.x0) / G), 0, gx - 1);
  for (let t = 0; t < N; t++) counts[cellOf(t) + 1]++;
  for (let c = 1; c <= gx * gz; c++) counts[c] += counts[c - 1];
  const idx = new Uint32Array(N), fill = counts.slice(0, gx * gz);
  for (let t = 0; t < N; t++) idx[fill[cellOf(t)]++] = t;
  return { trees, count: N, grid: { G, gx, gz, start: counts, idx } };
}
function forEachTreeNear(x, z, r, fn) {
  const T = WORLD.trees, L = WORLD.L0;
  if (!T || !inLevel(L, x, z)) return;
  const { G, gx, gz, start, idx } = T.grid;
  const i0 = clamp(Math.floor((x - r - L.x0) / G), 0, gx - 1), i1 = clamp(Math.floor((x + r - L.x0) / G), 0, gx - 1);
  const j0 = clamp(Math.floor((z - r - L.z0) / G), 0, gz - 1), j1 = clamp(Math.floor((z + r - L.z0) / G), 0, gz - 1);
  const tr = T.trees;
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const c = j * gx + i;
    for (let q = start[c]; q < start[c + 1]; q++) { const t = idx[q]; fn(tr[t * 6], tr[t * 6 + 1], tr[t * 6 + 2], tr[t * 6 + 3], tr[t * 6 + 5]); }
  }
}

// ------------------------------------------------------------ noise texture
function makeNoiseTexture(size) {
  const rng = mulberry32(99);
  const P = 256;
  const lat = new Float32Array(P * P);
  for (let i = 0; i < lat.length; i++) lat[i] = rng();
  const lat2 = new Float32Array(P * P);
  for (let i = 0; i < lat2.length; i++) lat2[i] = rng();
  function vn(L, x, y, per) {
    const xi = Math.floor(x), yi = Math.floor(y);
    let fx = x - xi, fy = y - yi;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const x0 = ((xi % per) + per) % per, y0 = ((yi % per) + per) % per, x1 = (x0 + 1) % per, y1 = (y0 + 1) % per;
    const a = L[y0 * P + x0], b = L[y0 * P + x1], c = L[y1 * P + x0], d = L[y1 * P + x1];
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  }
  function fbmT(L, u, v, base, oct) {
    let s = 0, amp = 0.5, norm = 0, per = base;
    for (let o = 0; o < oct; o++) { s += vn(L, u * per, v * per, per) * amp; norm += amp; amp *= 0.5; per *= 2; }
    return s / norm;
  }
  const f1 = new Float32Array(size * size), f2 = new Float32Array(size * size), f3 = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    f1[y * size + x] = fbmT(lat, u, v, 8, 5);
    f2[y * size + x] = fbmT(lat2, u, v, 16, 4);
    f3[y * size + x] = fbmT(lat2, u + 0.5, v + 0.25, 4, 3);
  }
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const k = y * size + x;
    const xr = (x + 1) % size, xl = (x - 1 + size) % size, yd = (y + 1) % size, yu = (y - 1 + size) % size;
    const gx = (f2[y * size + xr] - f2[y * size + xl]) * size * 0.05;
    const gy = (f2[yd * size + x] - f2[yu * size + x]) * size * 0.05;
    data[k * 4] = clamp(f1[k] * 255, 0, 255);
    data[k * 4 + 1] = clamp((0.5 + gx) * 255, 0, 255);
    data[k * 4 + 2] = clamp((0.5 + gy) * 255, 0, 255);
    data[k * 4 + 3] = clamp(f3[k] * 255, 0, 255);
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true; t.anisotropy = 4; t.needsUpdate = true;
  return t;
}
function dataTexRGBA(u8, w, h) {
  const t = new THREE.DataTexture(u8, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true; t.anisotropy = 4; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true;
  return t;
}
function dataTexFloat(f32, w, h) {
  const t = new THREE.DataTexture(f32, w, h, THREE.RedFormat, THREE.FloatType);
  t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true;
  return t;
}

// Rock texture in the geometry: bumps that grow with slope (flats stay smooth)
function addSlopeDetail(L) {
  const { nx, nz, cell, h, x0, z0 } = L;
  const src = h.slice();
  const S = TC.SUMMIT, N = TC.NOTCH || { x: 1e9, z: 1e9 }, LZ = TC.LZ;
  for (let j = 1; j < nz - 1; j++) {
    const z = z0 + j * cell;
    for (let i = 1; i < nx - 1; i++) {
      const k = j * nx + i, x = x0 + i * cell;
      const sx = (src[k + 1] - src[k - 1]) / (2 * cell), sz = (src[k + nx] - src[k - nx]) / (2 * cell);
      const slope = Math.sqrt(sx * sx + sz * sz);           // rise over run
      let amp = 0.6 + 7.5 * smoothstep(0.35, 1.3, slope);
      const dS = Math.hypot(x - S.x, z - S.z), dN = Math.hypot(x - N.x, z - N.z), dL = Math.hypot(x - LZ.x, z - LZ.z);
      amp *= smoothstep(14, 60, dS) * (0.35 + 0.65 * smoothstep(25, 90, dN)) * smoothstep(60, 180, dL);
      if (amp > 0.05 && lakeShoreDist(x, z) < 25) amp = 0;
      if (amp < 0.05) continue;
      const r1 = 1 - Math.abs(TC.noise(x / 46 + 0.7, z / 46 - 3.1) * 1.4);
      const r2 = 1 - Math.abs(TC.noise(x / 19 - 5.2, z / 19 + 2.6) * 1.4);
      const n = (r1 * r1 - 0.45) * 0.7 + (r2 * r2 - 0.45) * 0.35 + TC.noise(x / 9 + 1.9, z / 9 + 8.1) * 0.15;
      h[k] = src[k] + n * amp;
    }
  }
}

async function buildWorld(progress) {
  const t0 = performance.now();
  const { L0, L2 } = await generateHeights((p) => progress(p * 0.8, i18n('load.sculpt')));
  WORLD.L0 = L0; WORLD.L2 = L2;
  progress(0.8, i18n('load.detail')); await nextFrame();
  addSlopeDetail(L0);
  blendEdgeToFar(L0, L2);
  const t1 = performance.now();
  progress(0.82, i18n('load.shadowsnow')); await nextFrame();
  bakeLevel(L2, null, true);
  const L2H = L2.horizon;
  const outer = (x, z) => {
    const fx = clamp((x - L2.x0) / L2.cell, 0, L2.nx - 1.001), fz = clamp((z - L2.z0) / L2.cell, 0, L2.nz - 1.001);
    const i = fx | 0, j = fz | 0, u = fx - i, v = fz - j, n = L2.nx;
    return (L2H[j * n + i] * (1 - u) + L2H[j * n + i + 1] * u) * (1 - v) + (L2H[(j + 1) * n + i] * (1 - u) + L2H[(j + 1) * n + i + 1] * u) * v;
  };
  progress(0.88, i18n('load.shadowsnow')); await nextFrame();
  bakeLevel(L0, outer, false);
  L2.horizon = null; L0.horizon = null;
  chunkBounds(L0); chunkBounds(L2);
  progress(0.95, i18n('load.forest')); await nextFrame();
  WORLD.trees = placeTrees(L0);
  const t2 = performance.now();
  WORLD.genStats = { heights: Math.round(t1 - t0), bake: Math.round(t2 - t1), trees: WORLD.trees.count };
  progress(1, i18n('load.ready'));
}
