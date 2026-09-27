// ================================================================== SCENE
const R = {
  renderer: null, scene: null, camera: null, clock: null,
  terrain: [], trees: [], clouds: [], gates: [], water: [],
  frustum: new THREE.Frustum(), projScreen: new THREE.Matrix4(),
};
const PAL = {
  rock: 0x7d7872, rock2: 0x5f5b57, rockRed: 0x7f6150, scree: 0x9c8f7d, grass: 0x8c874f, meadow: 0x5c8a35,
  forest: 0x2f4527, snow: 0xf2f5f8, field1: 0x6f9a3f, field2: 0x9aa556, field3: 0x7c8a3c, road: 0x5b5a57,
  spruce: 0x345a31, larch: 0x62843a, leaf: 0x578532, trunk: 0x3b2c22,
};
const col = (hex, s = 1) => new THREE.Color(hex).multiplyScalar(s);

function initRenderer() {
  const canvas = $('c');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', logarithmicDepthBuffer: true, stencil: false });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, QUALITY_PRESETS[SETTINGS.quality].pr));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  R.renderer = renderer;
  R.scene = new THREE.Scene();
  R.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.3, 90000);
  R.scene.add(R.camera);
  // lights for the built-in (standard) materials: player, canopy, props
  const sun = new THREE.DirectionalLight(0xfff0dc, 3.0);
  sun.position.copy(SUN_DIR).multiplyScalar(1000);
  R.scene.add(sun); R.scene.add(sun.target);
  R.sunLight = sun;
  const hemi = new THREE.HemisphereLight(0xa9c8ee, 0x7a6f5c, 1.05);
  R.scene.add(hemi);
  U.uNoise.value = makeNoiseTexture(256);
}

// ---------------------------------------------------------- terrain (LOD)
function makeChunkGeometry(n, step) {
  const pos = [], idx = [];
  const V = (x, z, s) => { pos.push(x, s, z); return pos.length / 3 - 1; };
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) V(i * step, j * step, 0);
  const g = (i, j) => j * (n + 1) + i;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const a = g(i, j), b = g(i, j + 1), c = g(i + 1, j + 1), d = g(i + 1, j);
    idx.push(a, b, c, a, c, d);
  }
  const skirt = (list, ox, oz) => {
    const sk = list.map((gi) => V(pos[gi * 3], pos[gi * 3 + 2], 1));
    for (let q = 0; q < list.length - 1; q++) {
      const p0 = list[q], p1 = list[q + 1], s0 = sk[q], s1 = sk[q + 1];
      const dx = pos[p1 * 3] - pos[p0 * 3], dz = pos[p1 * 3 + 2] - pos[p0 * 3 + 2];
      if (-dz * ox + dx * oz > 0) idx.push(p0, s0, s1, p0, s1, p1);
      else idx.push(p0, s1, s0, p0, p1, s1);
    }
  };
  const north = [], south = [], west = [], east = [];
  for (let i = 0; i <= n; i++) { north.push(g(i, 0)); south.push(g(i, n)); }
  for (let j = 0; j <= n; j++) { west.push(g(0, j)); east.push(g(n, j)); }
  skirt(north, 0, -1); skirt(south, 0, 1); skirt(west, -1, 0); skirt(east, 1, 0);
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  return geo;
}

function terrainMaterial(level, far) {
  const L = level;
  const uni = {
    uSunDir: U.uSunDir, uSunCol: U.uSunCol, uSkyZenith: U.uSkyZenith, uSkyHorizon: U.uSkyHorizon, uHaze: U.uHaze,
    uSkyAmb: U.uSkyAmb, uGround: U.uGround, uFogA: U.uFogA, uFogB: U.uFogB, uTime: U.uTime, uNoise: U.uNoise,
    uHgt: { value: L.hTex }, uNrm: { value: L.nTex }, uSpl: { value: L.sTex },
    uOrigin: { value: new THREE.Vector2(L.x0, L.z0) }, uCell: { value: L.cell }, uDims: { value: new THREE.Vector2(L.nx, L.nz) },
    uSkirt: { value: far ? 180 : 36 }, uIsFar: { value: far ? 1 : 0 },
    uHole: { value: new THREE.Vector4(WORLD.L0.x0, WORLD.L0.z0, WORLD.L0.x1, WORLD.L0.z1) },
    cRock: { value: col(PAL.rock) }, cRock2: { value: col(PAL.rock2) }, cRockRed: { value: col(PAL.rockRed) },
    cScree: { value: col(PAL.scree) }, cGrass: { value: col(PAL.grass) }, cMeadow: { value: col(PAL.meadow) },
    cForest: { value: col(PAL.forest) }, cSnow: { value: col(PAL.snow) }, cField1: { value: col(PAL.field1) },
    cField2: { value: col(PAL.field2) }, cField3: { value: col(PAL.field3) }, cRoad: { value: col(PAL.road) },
    uC0: CASTERS.c0, uC0r: CASTERS.c0r, uC0f: CASTERS.c0f, uC0u: CASTERS.c0u,
    uC1: CASTERS.c1, uC1r: CASTERS.c1r, uC1f: CASTERS.c1f, uC1u: CASTERS.c1u, uC1s: CASTERS.c1s,
    uLZ: MARKS.lz, uPred: MARKS.pred, uPredCol: MARKS.predCol,
  };
  return new THREE.ShaderMaterial({ uniforms: uni, vertexShader: TERRAIN_VS, fragmentShader: TERRAIN_FS });
}
const CASTERS = {
  c0: { value: new THREE.Vector4(0, 0, 0, 0) }, c0r: { value: new THREE.Vector3(1, 0, 0) }, c0f: { value: new THREE.Vector3(0, 0, -1) }, c0u: { value: new THREE.Vector3(0, 1, 0) },
  c1: { value: new THREE.Vector4(0, 0, 0, 0) }, c1r: { value: new THREE.Vector3(1, 0, 0) }, c1f: { value: new THREE.Vector3(0, 0, -1) }, c1u: { value: new THREE.Vector3(0, 1, 0) },
  c1s: { value: new THREE.Vector2(3.6, 1.4) },
};
// landing aids painted by the terrain shader (shared by every terrain material)
const MARKS = {
  lz: { value: new THREE.Vector4(0, 0, 40, 0) },
  pred: { value: new THREE.Vector4(0, 0, 6, 0) },
  predCol: { value: new THREE.Color(1, 0.92, 0.35) },
};

class TerrainLevel {
  constructor(L, far) {
    this.L = L; this.far = far;
    L.hTex = dataTexFloat(L.h, L.nx, L.nz);
    L.nTex = dataTexRGBA(L.nrm, L.nx, L.nz);
    L.sTex = dataTexRGBA(L.spl, L.nx, L.nz);
    this.mat = terrainMaterial(L, far);
    this.box = new THREE.Box3();
    this.lods = [];
    const maxInst = L.cx * L.cz;
    for (let l = 0; l < 5; l++) {
      const geo = makeChunkGeometry(CHUNK_Q >> l, 1 << l);
      const mat = new THREE.ShaderMaterial({
        uniforms: { ...this.mat.uniforms, uStep: { value: 1 << l }, uMorph: { value: new THREE.Vector2(1e9, 1e9 + 1) } },
        vertexShader: TERRAIN_VS, fragmentShader: TERRAIN_FS,
      });
      const arr = new Float32Array(maxInst * 2);
      const attr = new THREE.InstancedBufferAttribute(arr, 2);
      attr.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('aChunk', attr);
      geo.instanceCount = 0;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.matrixAutoUpdate = false;
      R.scene.add(mesh);
      this.lods.push({ mesh, attr, arr, geo, mat });
    }
  }
  update(cam, lodScale) {
    const L = this.L, box = this.box, cs = CHUNK_Q * L.cell, P = cam.position;
    const counts = [0, 0, 0, 0, 0];
    const base = (this.far ? 3200 : 430 * Math.sqrt(L.cell / 4)) * lodScale;
    const H = WORLD.L0;
    const skirt = this.far ? 180 : 36;
    for (let cz = 0; cz < L.cz; cz++) for (let cx = 0; cx < L.cx; cx++) {
      const x0 = L.x0 + cx * cs, z0 = L.z0 + cz * cs;
      if (this.far && x0 >= H.x0 && x0 + cs <= H.x1 && z0 >= H.z0 && z0 + cs <= H.z1) continue;
      const k = cz * L.cx + cx;
      box.min.set(x0, L.cmin[k] - skirt, z0); box.max.set(x0 + cs, L.cmax[k] + 2, z0 + cs);
      if (!R.frustum.intersectsBox(box)) continue;
      const d = box.distanceToPoint(P);
      let lod = d < base ? 0 : Math.min(4, Math.floor(Math.log2(d / base)) + 1);
      // far chunks touching the detailed corridor stay at full resolution so the seam matches
      if (this.far && x0 < H.x1 + 1 && x0 + cs > H.x0 - 1 && z0 < H.z1 + 1 && z0 + cs > H.z0 - 1) lod = 0;
      const m = this.lods[lod];
      m.arr[counts[lod] * 2] = cx * CHUNK_Q; m.arr[counts[lod] * 2 + 1] = cz * CHUNK_Q;
      counts[lod]++;
    }
    for (let l = 0; l < 5; l++) {
      const m = this.lods[l];
      const Rl = base * Math.pow(2, l);
      if (l < 4) m.mat.uniforms.uMorph.value.set(Rl * 0.72, Rl * 0.98); else m.mat.uniforms.uMorph.value.set(1e9, 1e9 + 1);
      m.geo.instanceCount = counts[l];
      if (counts[l]) { m.attr.clearUpdateRanges(); m.attr.addUpdateRange(0, counts[l] * 2); m.attr.needsUpdate = true; }
    }
  }
}

// -------------------------------------------------------------------- sky
function buildSky() {
  const geo = new THREE.SphereGeometry(60000, 48, 24);
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...pickU(), uNoise: U.uNoise },
    vertexShader: SKY_VS, fragmentShader: SKY_FS, side: THREE.BackSide, depthWrite: false, depthTest: false,
  });
  const sky = new THREE.Mesh(geo, mat);
  sky.renderOrder = -1000;
  sky.frustumCulled = false;
  R.scene.add(sky);
  R.sky = sky;
}
function pickU() {
  return {
    uSunDir: U.uSunDir, uSunCol: U.uSunCol, uSkyZenith: U.uSkyZenith, uSkyHorizon: U.uSkyHorizon, uHaze: U.uHaze,
    uSkyAmb: U.uSkyAmb, uGround: U.uGround, uFogA: U.uFogA, uFogB: U.uFogB, uTime: U.uTime,
  };
}

// ------------------------------------------------------------------ water
function buildWater() {
  const L0 = WORLD.L0, LK = TC.LAKE;
  const mk = (river) => new THREE.ShaderMaterial({
    uniforms: {
      ...pickU(), uNoise: U.uNoise, uHgt: { value: L0.hTex }, uOrigin: { value: new THREE.Vector2(L0.x0, L0.z0) },
      uCell: { value: L0.cell }, uDims: { value: new THREE.Vector2(L0.nx, L0.nz) }, uLevel: { value: LK.level },
      uRiver: { value: river ? 1 : 0 }, cDeep: { value: col(river ? 0x2e5d63 : 0x0a5f6c) }, cShallow: { value: col(river ? 0x6f9f98 : 0x39c6bc) },
    },
    vertexShader: WATER_VS, fragmentShader: WATER_FS, transparent: true,
  });
  // lake
  const lg = new THREE.CircleGeometry(LK.r + 40, 128);
  lg.rotateX(-Math.PI / 2);
  lg.scale(1, 1, 1 / LK.sz);
  const lake = new THREE.Mesh(lg, mk(false));
  lake.position.set(LK.x, LK.level, LK.z);
  lake.renderOrder = 2;
  R.scene.add(lake);
  R.water.push(lake);
  // river ribbon along the valley
  const pos = [], idx = [];
  const L2 = WORLD.L2;
  let n = 0;
  for (let x = L2.x0 + 50; x < L2.x1 - 50;) {
    const z = TC.riverZ(x);
    const dzdx = (TC.riverZ(x + 1) - TC.riverZ(x - 1)) / 2;
    const inv = 1 / Math.hypot(1, dzdx);
    const nx = -dzdx * inv, nz = inv;
    const inner = inLevel(L0, x, z);
    const y = inner ? TC.mainFloor(x) - 0.9 : groundHeight(x, z) + 0.6;
    const w = 11 + 2 * Math.sin(x / 700);
    pos.push(x - nx * w, y, z - nz * w, x + nx * w, y, z + nz * w);
    if (n > 0) { const a = (n - 1) * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    n++;
    x += inner ? 16 : 60;
  }
  const rg = new THREE.BufferGeometry();
  rg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  rg.setIndex(idx);
  const river = new THREE.Mesh(rg, mk(true));
  river.frustumCulled = false;
  river.renderOrder = 2;
  R.scene.add(river);
  R.water.push(river);
}

// ------------------------------------------------------------------ trees
function coniferGeometry(lowPoly) {
  const parts = [];
  if (lowPoly) {
    const c = new THREE.ConeGeometry(0.46, 0.92, 4, 1, true); c.translate(0, 0.54, 0); parts.push(c);
  } else {
    const t = new THREE.CylinderGeometry(0.035, 0.05, 0.16, 5, 1, true); t.translate(0, 0.08, 0); parts.push(t);
    const tiers = [[0.5, 0.1, 0.62], [0.39, 0.34, 0.84], [0.26, 0.58, 1.0]];
    for (const [r, y0, y1] of tiers) { const c = new THREE.ConeGeometry(r, y1 - y0, 7, 1, true); c.translate(0, (y0 + y1) / 2, 0); parts.push(c); }
  }
  return mergeGeos(parts);
}
function broadleafGeometry(lowPoly) {
  const parts = [];
  if (lowPoly) {
    const o = new THREE.OctahedronGeometry(0.42, 0); o.scale(1, 0.85, 1); o.translate(0, 0.6, 0); parts.push(o);
  } else {
    const t = new THREE.CylinderGeometry(0.04, 0.06, 0.4, 5, 1, true); t.translate(0, 0.2, 0); parts.push(t);
    const s = new THREE.IcosahedronGeometry(0.42, 1); s.scale(1, 0.82, 1); s.translate(0, 0.62, 0);
    const p = s.attributes.position; // lumpy crown
    for (let i = 0; i < p.count; i++) { const k = 1 + 0.12 * Math.sin(p.getX(i) * 17 + p.getZ(i) * 11) * Math.cos(p.getY(i) * 13); p.setXYZ(i, p.getX(i) * k, 0.62 + (p.getY(i) - 0.62) * k, p.getZ(i) * k); }
    s.computeVertexNormals();
    parts.push(s);
  }
  return mergeGeos(parts);
}
function mergeGeos(list) {
  let nV = 0, nI = 0;
  const geos = list.map((g) => (g.index ? g : g));
  for (const g of geos) { nV += g.attributes.position.count; nI += g.index ? g.index.count : g.attributes.position.count; }
  const pos = new Float32Array(nV * 3), nor = new Float32Array(nV * 3), idx = new Uint32Array(nI);
  let vo = 0, io = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, vo * 3);
    if (g.attributes.normal) nor.set(g.attributes.normal.array, vo * 3);
    if (g.index) { for (let i = 0; i < g.index.count; i++) idx[io + i] = g.index.array[i] + vo; io += g.index.count; }
    else { for (let i = 0; i < g.attributes.position.count; i++) idx[io + i] = vo + i; io += g.attributes.position.count; }
    vo += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

function buildTrees() {
  const T = WORLD.trees, L0 = WORLD.L0, tr = T.trees;
  const CS = 512;
  const gx = Math.ceil((L0.x1 - L0.x0) / CS), gz = Math.ceil((L0.z1 - L0.z0) / CS);
  const buckets = new Map();
  const rng = mulberry32(777);
  for (let t = 0; t < T.count; t++) {
    const x = tr[t * 6], z = tr[t * 6 + 2], kind = tr[t * 6 + 5];
    const key = (clamp(Math.floor((z - L0.z0) / CS), 0, gz - 1) * gx + clamp(Math.floor((x - L0.x0) / CS), 0, gx - 1)) * 2 + (kind > 1.5 ? 1 : 0);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(t);
  }
  const geoms = {
    conN: coniferGeometry(false), conF: coniferGeometry(true),
    leafN: broadleafGeometry(false), leafF: broadleafGeometry(true),
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      ...pickU(), uNrm: { value: L0.nTex }, uOrigin: { value: new THREE.Vector2(L0.x0, L0.z0) }, uCell: { value: L0.cell },
      uDimsF: { value: new THREE.Vector2(L0.nx, L0.nz) }, uFar: { value: 4000 },
      cSpruce: { value: col(PAL.spruce) }, cLarch: { value: col(PAL.larch) }, cLeaf: { value: col(PAL.leaf) }, cTrunk: { value: col(PAL.trunk) },
    },
    vertexShader: TREE_VS, fragmentShader: TREE_FS,
  });
  for (const [key, list] of buckets) {
    // shuffle so a quality subset stays evenly spread
    for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = list[i]; list[i] = list[j]; list[j] = t; }
    const n = list.length;
    const aTree = new Float32Array(n * 4), aVar = new Float32Array(n * 2);
    let cx = 0, cy = 0, cz = 0, maxH = 0;
    for (let q = 0; q < n; q++) {
      const t = list[q];
      aTree[q * 4] = tr[t * 6]; aTree[q * 4 + 1] = tr[t * 6 + 1]; aTree[q * 4 + 2] = tr[t * 6 + 2]; aTree[q * 4 + 3] = tr[t * 6 + 3];
      aVar[q * 2] = tr[t * 6 + 4]; aVar[q * 2 + 1] = tr[t * 6 + 5];
      cx += tr[t * 6]; cy += tr[t * 6 + 1]; cz += tr[t * 6 + 2]; maxH = Math.max(maxH, tr[t * 6 + 3]);
    }
    cx /= n; cy /= n; cz /= n;
    let rad = 0;
    for (let q = 0; q < n; q++) rad = Math.max(rad, Math.hypot(aTree[q * 4] - cx, aTree[q * 4 + 1] - cy, aTree[q * 4 + 2] - cz));
    const ia = new THREE.InstancedBufferAttribute(aTree, 4), iv = new THREE.InstancedBufferAttribute(aVar, 2);
    const leaf = key % 2 === 1;
    const mk = (base) => {
      const g = new THREE.InstancedBufferGeometry();
      g.index = base.index; g.attributes.position = base.attributes.position; g.attributes.normal = base.attributes.normal;
      g.setAttribute('aTree', ia); g.setAttribute('aVar', iv);
      g.instanceCount = n;
      const m = new THREE.Mesh(g, mat);
      m.frustumCulled = false; m.matrixAutoUpdate = false;
      R.scene.add(m);
      return m;
    };
    R.trees.push({
      near: mk(leaf ? geoms.leafN : geoms.conN), far: mk(leaf ? geoms.leafF : geoms.conF),
      n, sphere: new THREE.Sphere(new THREE.Vector3(cx, cy, cz), rad + maxH + 10),
    });
  }
  R.treeMat = mat;
}
function updateTrees(cam) {
  const Q = QUALITY_PRESETS[SETTINGS.quality];
  const nearD = 700 * Q.lod, farD = Q.treeDist;
  if (R.treeMat) R.treeMat.uniforms.uFar.value = farD;
  for (const c of R.trees) {
    const d = Math.max(0, c.sphere.center.distanceTo(cam.position) - c.sphere.radius);
    const vis = d < farD && R.frustum.intersectsSphere(c.sphere);
    const cnt = Math.max(1, Math.floor(c.n * Q.trees));
    c.near.visible = vis && d < nearD;
    c.far.visible = vis && d >= nearD;
    c.near.geometry.instanceCount = cnt;
    c.far.geometry.instanceCount = cnt;
  }
}

// ----------------------------------------------------------------- clouds
function cloudTexture() {
  // four soft puffs (value-noise fBm inside a radial falloff)
  const N = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = N * 2;
  const g = cv.getContext('2d');
  const img = g.createImageData(N * 2, N * 2);
  const rng = mulberry32(31);
  const P = 64, lat = new Float32Array(P * P);
  for (let i = 0; i < lat.length; i++) lat[i] = rng();
  const vn = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y); let fx = x - xi, fy = y - yi;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const a = lat[((yi & 63) * P) + (xi & 63)], b = lat[((yi & 63) * P) + ((xi + 1) & 63)], c = lat[(((yi + 1) & 63) * P) + (xi & 63)], d = lat[(((yi + 1) & 63) * P) + ((xi + 1) & 63)];
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  };
  for (let q = 0; q < 4; q++) {
    const ox = (q % 2) * N, oy = Math.floor(q / 2) * N, sx = q * 17.3, sy = q * 9.1;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const u = (x + 0.5) / N * 2 - 1, v = (y + 0.5) / N * 2 - 1;
      let n = 0, amp = 0.5, f = 3;
      for (let o = 0; o < 5; o++) { n += vn(u * f + sx, v * f + sy) * amp; amp *= 0.5; f *= 2; }
      const r = Math.hypot(u, v * 1.15 + (v > 0 ? v * 0.25 : 0));
      let a = (1 - r * r) * 1.05 + (n - 0.5) * 1.3;
      a = clamp(a, 0, 1); a = a * a * (3 - 2 * a);
      const light = clamp(0.55 + (n - 0.5) * 0.9 - v * 0.25, 0, 1);
      const o = ((oy + y) * N * 2 + ox + x) * 4;
      img.data[o] = light * 255; img.data[o + 1] = light * 255; img.data[o + 2] = light * 255; img.data[o + 3] = a * 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}
function buildClouds() {
  const tex = cloudTexture();
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...pickU(), uTex: { value: tex } },
    vertexShader: CLOUD_VS, fragmentShader: CLOUD_FS, transparent: true, depthWrite: false,
  });
  const quad = new THREE.PlaneGeometry(1, 1);
  const rng = mulberry32(55);
  const Q = QUALITY_PRESETS[SETTINGS.quality];
  // [x, y, z, radiusX, radiusY, puffs, puffSize]
  const clusters = [
    [260, 3420, -40, 260, 70, 34, 95],      // mist beside the exit, like the video
    [520, 3260, -520, 200, 60, 22, 85],
    [-520, 3480, 180, 240, 70, 26, 100],
    [-1900, 3350, -2600, 520, 140, 30, 190],
    [2700, 3550, -1900, 600, 150, 32, 210],
    [-700, 3950, -3900, 700, 160, 30, 240],
    [3300, 3750, -4300, 650, 150, 28, 220],
    [600, 4250, -7300, 900, 200, 30, 300],
    [-4200, 3650, -1200, 900, 220, 30, 320],
    [5200, 3900, -2600, 900, 220, 28, 320],
    [-3000, 3300, 2500, 800, 200, 26, 300],
    [2200, 3500, 2800, 800, 200, 26, 300],
    [-9000, 4200, -8000, 1800, 350, 26, 700],
    [9500, 4400, -7000, 1800, 380, 26, 700],
    [1500, 4600, -16000, 2200, 400, 26, 800],
    [-12000, 4800, 3000, 2200, 400, 24, 800],
    [12000, 4500, 5000, 2200, 400, 24, 800],
  ];
  R.cloudClusters = [];
  for (const [x, y, z, rx, ry, n0, ps] of clusters) {
    const n = Math.max(6, Math.round(n0 * Q.clouds));
    const aPuff = new Float32Array(n * 4), aInfo = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const a = rng() * Math.PI * 2, r = Math.sqrt(rng());
      const ox = Math.cos(a) * r * rx, oz = Math.sin(a) * r * rx * 0.8;
      const oy = (rng() - 0.3) * ry * (1 - r * 0.6);
      aPuff[i * 4] = x + ox; aPuff[i * 4 + 1] = y + oy; aPuff[i * 4 + 2] = z + oz;
      aPuff[i * 4 + 3] = ps * (0.6 + rng() * 0.8) * (1.15 - r * 0.4);
      const dir = new THREE.Vector3(ox, oy * 2.5, oz).normalize();
      const shade = clamp(0.45 + 0.4 * dir.dot(SUN_DIR) + 0.35 * (oy / ry), 0.12, 1);
      aInfo[i * 4] = Math.floor(rng() * 4) + (ps > 400 ? 0.5 : ps > 180 ? 0.25 : 0); aInfo[i * 4 + 1] = (rng() - 0.5) * 0.5; aInfo[i * 4 + 2] = shade; aInfo[i * 4 + 3] = 0.5 + rng() * 0.4;
    }
    const g = new THREE.InstancedBufferGeometry();
    g.index = quad.index; g.attributes.position = quad.attributes.position; g.attributes.uv = quad.attributes.uv;
    g.setAttribute('aPuff', new THREE.InstancedBufferAttribute(aPuff, 4));
    g.setAttribute('aInfo', new THREE.InstancedBufferAttribute(aInfo, 4));
    g.instanceCount = n;
    const m = new THREE.Mesh(g, mat);
    m.frustumCulled = false;
    m.position.set(x, y, z);   // for transparent sorting only (shader uses world attrs)
    m.renderOrder = 5;
    m.onBeforeRender = () => {}; // keep position out of the shader
    R.scene.add(m);
    R.cloudClusters.push({ mesh: m, x, y, z, rx, ry, aPuff, n, g });
  }
}
// sort puffs back-to-front inside each cluster (cheap, a few hundred items)
const _cloudTmp = [];
function sortClouds(cam) {
  const P = cam.position;
  for (const c of R.cloudClusters) {
    const d = Math.hypot(c.x - P.x, c.y - P.y, c.z - P.z);
    if (d > 30000) continue;
    const a = c.aPuff, info = c.g.attributes.aInfo.array, n = c.n;
    _cloudTmp.length = 0;
    for (let i = 0; i < n; i++) _cloudTmp.push({ d: (a[i * 4] - P.x) ** 2 + (a[i * 4 + 1] - P.y) ** 2 + (a[i * 4 + 2] - P.z) ** 2, p: [a[i * 4], a[i * 4 + 1], a[i * 4 + 2], a[i * 4 + 3]], f: [info[i * 4], info[i * 4 + 1], info[i * 4 + 2], info[i * 4 + 3]] });
    _cloudTmp.sort((u, v) => v.d - u.d);
    for (let i = 0; i < n; i++) { const t = _cloudTmp[i]; a.set(t.p, i * 4); info.set(t.f, i * 4); }
    c.g.attributes.aPuff.needsUpdate = true; c.g.attributes.aInfo.needsUpdate = true;
  }
}
function mistAmount(p) {
  let m = 0;
  for (const c of R.cloudClusters) {
    const dx = (p.x - c.x) / (c.rx * 0.9), dy = (p.y - c.y) / (c.ry * 1.2 + 30), dz = (p.z - c.z) / (c.rx * 0.75);
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    m = Math.max(m, 1 - smoothstep(0.35, 1.0, d));
  }
  return m;
}

// ------------------------------------------------------------------ props
function stdMat(opts) { return patchFog(new THREE.MeshStandardMaterial(opts)); }
function rockGeometry(seed, detail = 1) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.attributes.position;
  const rng = mulberry32(seed);
  const a = rng() * 10, b = rng() * 10;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + 0.22 * Math.sin(x * 3.1 + a) * Math.cos(z * 2.7 + b) + 0.12 * Math.sin(y * 5.3 + a * 2);
    p.setXYZ(i, x * k, y * k * 0.72, z * k);
  }
  g.computeVertexNormals();
  return g;
}
function buildProps() {
  const S = TC.SUMMIT, E = TC.EXIT;
  // summit cross
  const metal = stdMat({ color: 0x2b2d30, roughness: 0.55, metalness: 0.7 });
  const cross = new THREE.Group();
  const v = new THREE.Mesh(new THREE.BoxGeometry(0.16, 4.6, 0.16), metal); v.position.y = 2.3; cross.add(v);
  const hbar = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.14, 0.14), metal); hbar.position.y = 3.4; cross.add(hbar);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 0.5, 8), stdMat({ color: 0x6b645c, roughness: 1 })); base.position.y = 0.2; cross.add(base);
  cross.position.set(S.x + 7, groundHeight(S.x + 7, S.z + 6) - 0.1, S.z + 6);
  cross.rotation.y = 0.5;
  R.scene.add(cross);
  // rocks: summit blocks, exit ledge, scree boulders
  const rockMat = stdMat({ color: 0x8a8279, roughness: 0.95, flatShading: true });
  const rockMat2 = stdMat({ color: 0x8c7462, roughness: 0.95, flatShading: true });
  const geoA = rockGeometry(3, 1), geoB = rockGeometry(9, 1);
  const rng = mulberry32(8080);
  const places = [];
  // summit crest blocks (not on the exit path)
  for (let i = 0; i < 46; i++) {
    const a = rng() * Math.PI * 2, r = 7 + rng() * 30;
    const x = S.x + Math.cos(a) * r, z = S.z + Math.sin(a) * r;
    if (Math.hypot(x - E.x, z - E.z) < 11) continue;
    if (Math.abs(x - E.x) < 9 && z > E.z - 4 && z < E.z + 14) continue;   // keep the camera spot clear
    if (z < E.z) continue;                                                  // nothing on the face itself
    places.push([x, z, 0.45 + rng() * 1.3, rng()]);
  }
  // scree boulders around the cirque and the notch
  for (let i = 0; i < 420; i++) {
    const x = -500 + rng() * 1300, z = -1900 + rng() * 1700;
    const Lk = lakeDist(x, z);
    if (Lk < TC.LAKE.r + 8) continue;
    const sp = splatAt(WORLD.L0, x, z, 2);
    if (sp < 0.15 && rng() > 0.25) continue;
    places.push([x, z, 0.6 + Math.pow(rng(), 3) * 5, rng()]);
  }
  const mA = new THREE.InstancedMesh(geoA, rockMat, places.length);
  const mB = new THREE.InstancedMesh(geoB, rockMat2, places.length);
  const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3();
  let na = 0, nb = 0;
  for (const [x, z, s, r] of places) {
    q.setFromEuler(new THREE.Euler(rng() * 0.4, rng() * 6.28, rng() * 0.4));
    sc.set(s * (0.8 + rng() * 0.5), s * (0.6 + rng() * 0.5), s * (0.8 + rng() * 0.5));
    ps.set(x, groundHeight(x, z) + s * 0.15, z);
    mtx.compose(ps, q, sc);
    if (r < 0.7) mA.setMatrixAt(na++, mtx); else mB.setMatrixAt(nb++, mtx);
  }
  mA.count = na; mB.count = nb;
  R.scene.add(mA); R.scene.add(mB);
  // exit ledge: a flat slab jutting over the north face
  const slab = new THREE.Mesh(rockGeometry(21, 2), rockMat);
  slab.scale.set(1.2, 0.45, 1.6);
  slab.rotation.y = 0.3;
  const gy = groundHeight(E.x, E.z + 1.5);
  slab.position.set(E.x, gy - 0.3, E.z - 0.3);
  R.scene.add(slab);
  R.exitY = gy + 0.12;

  buildLandingZone();
  buildVillages();
}
function buildLandingZone() {
  const LZ = TC.LZ;
  const gy = groundHeight(LZ.x, LZ.z);
  // target: painted rings on the meadow
  const cv = document.createElement('canvas'); cv.width = cv.height = 512;
  const g = cv.getContext('2d');
  const rings = ['#ff6b1a', '#f4f1ea', '#ff6b1a', '#f4f1ea', '#ff6b1a'];
  for (let i = 0; i < rings.length; i++) { g.fillStyle = rings[i]; g.beginPath(); g.arc(256, 256, 250 - i * 48, 0, Math.PI * 2); g.fill(); }
  g.strokeStyle = '#1d1f22'; g.lineWidth = 16;
  g.beginPath(); g.moveTo(206, 206); g.lineTo(306, 306); g.moveTo(306, 206); g.lineTo(206, 306); g.stroke();
  const img = g.getImageData(0, 0, 512, 512);
  for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) if (Math.hypot(x - 256, y - 256) > 250) img.data[(y * 512 + x) * 4 + 3] = 0;
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const disk = new THREE.Mesh(new THREE.CircleGeometry(TARGET_R, 64), stdMat({ map: tex, transparent: true, roughness: 0.9, emissive: 0xff5a10, emissiveMap: tex, emissiveIntensity: 0.35, polygonOffset: true, polygonOffsetFactor: -4, depthWrite: false }));
  disk.rotation.x = -Math.PI / 2;
  disk.position.set(LZ.x, gy + 0.12, LZ.z);
  R.scene.add(disk);
  MARKS.lz.value.set(LZ.x, LZ.z, 40, 1);
  buildLzSmoke(LZ.x - 9, groundHeight(LZ.x - 9, LZ.z + 24), LZ.z + 24);
  // windsock
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 6, 8), stdMat({ color: 0xdddddd, roughness: 0.4, metalness: 0.6 }));
  const wx = LZ.x + 26, wz = LZ.z - 14;
  pole.position.set(wx, groundHeight(wx, wz) + 3, wz);
  R.scene.add(pole);
  const cv2 = document.createElement('canvas'); cv2.width = 256; cv2.height = 16;
  const g2 = cv2.getContext('2d');
  for (let i = 0; i < 5; i++) { g2.fillStyle = i % 2 ? '#f4f1ea' : '#ff6b1a'; g2.fillRect(i * 51.2, 0, 51.2, 16); }
  const t2 = new THREE.CanvasTexture(cv2); t2.colorSpace = THREE.SRGBColorSpace;
  const sockGeo = new THREE.CylinderGeometry(0.42, 0.16, 2.6, 16, 8, true);
  sockGeo.rotateZ(Math.PI / 2); sockGeo.translate(1.3, 0, 0);
  const sock = new THREE.Mesh(sockGeo, stdMat({ map: t2, side: THREE.DoubleSide, roughness: 0.8 }));
  sock.position.set(wx, groundHeight(wx, wz) + 5.8, wz);
  R.scene.add(sock);
  R.sock = sock; R.sockBase = sockGeo.attributes.position.array.slice();
  R.lzY = gy;
}
const TARGET_R = 18;
// orange smoke from a ground flare next to the target: marks the spot and shows the wind
function buildLzSmoke(x, y, z) {
  const N = 170;
  const base = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute('position', base.attributes.position);
  geo.setAttribute('uv', base.attributes.uv);
  const seeds = new Float32Array(N * 4);
  const rng = mulberry32(77);
  for (let i = 0; i < N; i++) { seeds[i * 4] = i / N + rng() * 0.004; seeds[i * 4 + 1] = rng(); seeds[i * 4 + 2] = rng(); seeds[i * 4 + 3] = rng(); }
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
  geo.instanceCount = N;
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...pickU(), uNoise: U.uNoise, uBase: { value: new THREE.Vector3(x, y, z) }, uWind: { value: WIND.clone() }, uLife: { value: 22 } },
    vertexShader: SMOKE_VS, fragmentShader: SMOKE_FS, transparent: true, depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  R.scene.add(mesh);
  // the flare canister itself
  const can = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.35, 10), stdMat({ color: 0xff6b1a, emissive: 0xff3a00, emissiveIntensity: 1.5 }));
  can.position.set(x, y + 0.18, z);
  R.scene.add(can);
  R.smoke = mesh;
}
function houseGeometry() {
  const walls = new THREE.BoxGeometry(1, 1, 1); walls.translate(0, 0.5, 0);
  const roof = new THREE.BufferGeometry();
  const h = 0.55, o = 0.08;
  const v = [
    -0.5 - o, 1, -0.5 - o, 0.5 + o, 1, -0.5 - o, 0, 1 + h, -0.5 - o,
    -0.5 - o, 1, 0.5 + o, 0, 1 + h, 0.5 + o, 0.5 + o, 1, 0.5 + o,
    -0.5 - o, 1, -0.5 - o, 0, 1 + h, -0.5 - o, 0, 1 + h, 0.5 + o, -0.5 - o, 1, -0.5 - o, 0, 1 + h, 0.5 + o, -0.5 - o, 1, 0.5 + o,
    0.5 + o, 1, -0.5 - o, 0.5 + o, 1, 0.5 + o, 0, 1 + h, 0.5 + o, 0.5 + o, 1, -0.5 - o, 0, 1 + h, 0.5 + o, 0, 1 + h, -0.5 - o,
  ];
  roof.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  roof.computeVertexNormals();
  const cw = [], cr = [];
  const wc = new THREE.Color(0xe7ddcb), rc = new THREE.Color(0x5d5853);
  for (let i = 0; i < walls.attributes.position.count; i++) cw.push(wc.r, wc.g, wc.b);
  for (let i = 0; i < roof.attributes.position.count; i++) cr.push(rc.r, rc.g, rc.b);
  walls.setAttribute('color', new THREE.Float32BufferAttribute(cw, 3));
  roof.setAttribute('color', new THREE.Float32BufferAttribute(cr, 3));
  const wi = walls.toNonIndexed();
  const out = new THREE.BufferGeometry();
  const pa = new Float32Array([...wi.attributes.position.array, ...roof.attributes.position.array]);
  const na = new Float32Array([...wi.attributes.normal.array, ...roof.attributes.normal.array]);
  const ca = new Float32Array([...wi.attributes.color.array, ...roof.attributes.color.array]);
  out.setAttribute('position', new THREE.BufferAttribute(pa, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(na, 3));
  out.setAttribute('color', new THREE.BufferAttribute(ca, 3));
  return out;
}
function buildVillages() {
  const rng = mulberry32(2024);
  // [x, z, radius, count] — villages at the foot of the massif, a town down the valley
  const spots = [
    [1650, -5150, 170, 26], [820, -5300, 150, 20], [2350, -5250, 180, 24], [-150, -5250, 140, 16],
    [-900, -5600, 260, 60], [-2300, -5950, 520, 220], [-3500, -6100, 420, 140], [3300, -5500, 200, 30],
    [4400, -5750, 260, 50], [600, -6400, 220, 36], [2000, -6500, 200, 28], [1300, -3900, 60, 5], [300, -4450, 70, 6],
  ];
  const list = [];
  for (const [cx, cz, rad, n] of spots) {
    for (let i = 0; i < n * 3 && list.length < 2000; i++) {
      if (list.filter((h) => h.v === cx).length >= n) break;
      const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * rad;
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      const dr = z - TC.riverZ(x);
      if (Math.abs(dr) < 45) continue;
      if (Math.abs(dr + 380 - 60 * Math.sin(x / 1400)) < 10 || Math.abs(dr - 260 - 40 * Math.sin(x / 2100)) < 13) continue;
      if (Math.hypot(x - TC.LZ.x, z - TC.LZ.z) < 140) continue;
      const y = groundHeight(x, z);
      const y2 = groundHeight(x + 6, z + 6);
      if (Math.abs(y2 - y) > 4) continue;
      list.push({ x, y, z, v: cx, w: 7 + rng() * 7, d: 8 + rng() * 9, h: 5 + rng() * (Math.abs(cx + 2300) < 900 ? 9 : 4), rot: Math.round(rng() * 4) * Math.PI / 2 + (rng() - 0.5) * 0.3 });
    }
  }
  const geo = houseGeometry();
  const mat = stdMat({ vertexColors: true, roughness: 0.85 });
  const mesh = new THREE.InstancedMesh(geo, mat, list.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  list.forEach((hs, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), hs.rot);
    s.set(hs.w, hs.h, hs.d); p.set(hs.x, hs.y - 1, hs.z);
    m.compose(p, q, s);
    mesh.setMatrixAt(i, m);
  });
  mesh.frustumCulled = false;
  R.scene.add(mesh);
  WORLD.houses = list;
}

// ------------------------------------------------------------------ gates
const GATE_ORANGE = new THREE.Color(0xff6b1a), GATE_WHITE = new THREE.Color(0xf4f1ea), GATE_LAKE = new THREE.Color(0x3fd0c4);
function buildGates() {
  const G = TC.GATES;
  const pts = [[TC.EXIT.x, TC.EXIT.z, R.exitY], ...G.map((g) => [g[0], g[1], g[2]]), [TC.LZ.x, TC.LZ.z, TC.LZ.h]];
  G.forEach((g, i) => {
    const [x, z, y, r] = g;
    const prev = pts[i], next = pts[i + 2];
    const dir = new THREE.Vector3(next[0] - prev[0], (next[2] - prev[2]) * 0.3, next[1] - prev[1]).normalize();
    const geo = new THREE.TorusGeometry(r, i === 3 ? 0.42 : 0.5, 10, 96);
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...pickU(), uColA: { value: GATE_ORANGE.clone().multiplyScalar(1.2) }, uColB: { value: GATE_WHITE.clone() }, uGlow: { value: 0.3 }, uFade: { value: 1 } },
      vertexShader: GATE_VS, fragmentShader: GATE_FS, transparent: true, depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.lookAt(x + dir.x, y + dir.y, z + dir.z);
    mesh.renderOrder = 6;
    R.scene.add(mesh);
    R.gates.push({ mesh, mat, x, y, z, r, n: dir, state: 0, t: 0, notch: i === 3 });
  });
}

// ------------------------------------------------------------ smoke trail
const TRAIL_N = 200;
function buildTrail() {
  const pos = new Float32Array(TRAIL_N * 2 * 3), age = new Float32Array(TRAIL_N * 2), uv = new Float32Array(TRAIL_N * 2 * 2);
  const idx = [];
  for (let i = 0; i < TRAIL_N - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aAge', new THREE.BufferAttribute(age, 1).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2).setUsage(THREE.DynamicDrawUsage));
  g.setIndex(idx);
  g.setDrawRange(0, 0);
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...pickU(), uNoise: U.uNoise, uColor: { value: new THREE.Color(0xffc9a8) } },
    vertexShader: TRAIL_VS, fragmentShader: TRAIL_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 8;
  R.scene.add(mesh);
  R.trail = { mesh, g, pts: [], t: 0 };
}
function updateTrail(dt, emitPos, emitting, cam, simTime) {
  const T = R.trail;
  const LIFE = 9;
  if (emitting) {
    T.t += dt;
    if (T.t > 0.045 || T.pts.length === 0) { T.t = 0; T.pts.unshift({ p: emitPos.clone(), born: simTime }); }
    else T.pts[0].p.copy(emitPos);
  }
  while (T.pts.length > TRAIL_N || (T.pts.length && simTime - T.pts[T.pts.length - 1].born > LIFE)) T.pts.pop();
  const n = T.pts.length;
  const pos = T.g.attributes.position.array, age = T.g.attributes.aAge.array, uv = T.g.attributes.uv.array;
  const side = new THREE.Vector3(), dir = new THREE.Vector3(), toCam = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const p = T.pts[i].p;
    const a = (simTime - T.pts[i].born) / LIFE;
    const q = T.pts[Math.min(n - 1, i + 1)].p, o = T.pts[Math.max(0, i - 1)].p;
    dir.subVectors(o, q); if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
    toCam.subVectors(cam.position, p);
    side.crossVectors(dir, toCam).normalize();
    const w = 0.25 + a * 5.5;
    // smoke drifts and sinks a little
    const dy = -a * 3.0;
    pos[i * 6] = p.x + side.x * w; pos[i * 6 + 1] = p.y + dy + side.y * w; pos[i * 6 + 2] = p.z + side.z * w;
    pos[i * 6 + 3] = p.x - side.x * w; pos[i * 6 + 4] = p.y + dy - side.y * w; pos[i * 6 + 5] = p.z - side.z * w;
    age[i * 2] = age[i * 2 + 1] = a;
    uv[i * 4] = i / TRAIL_N * 6; uv[i * 4 + 1] = 0; uv[i * 4 + 2] = i / TRAIL_N * 6; uv[i * 4 + 3] = 1;
  }
  T.g.setDrawRange(0, Math.max(0, (n - 1) * 6));
  T.g.attributes.position.needsUpdate = true; T.g.attributes.aAge.needsUpdate = true; T.g.attributes.uv.needsUpdate = true;
}

// ------------------------------------------------------------ speed lines
function buildSpeedLines() {
  const N = 160;
  const pos = new Float32Array(N * 2 * 3);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  const mat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false });
  const lines = new THREE.LineSegments(g, mat);
  lines.frustumCulled = false;
  lines.renderOrder = 9;
  R.scene.add(lines);
  const pts = [];
  const rng = mulberry32(5);
  for (let i = 0; i < N; i++) pts.push(new THREE.Vector3((rng() - 0.5) * 60, (rng() - 0.5) * 40, (rng() - 0.5) * 60));
  R.speed = { lines, g, mat, pts, rng };
}
function updateSpeedLines(cam, vel, dt) {
  const S = R.speed;
  const v = vel.length();
  S.mat.opacity = smoothstep(28, 70, v) * 0.32;
  if (S.mat.opacity < 0.01) { S.lines.visible = false; return; }
  S.lines.visible = true;
  const pos = S.g.attributes.position.array;
  const rel = vel.clone().multiplyScalar(-1);
  const stretch = rel.clone().multiplyScalar(0.045);
  const c = cam.position;
  for (let i = 0; i < S.pts.length; i++) {
    const p = S.pts[i];
    p.addScaledVector(rel, dt);
    const dx = p.x - c.x, dy = p.y - c.y, dz = p.z - c.z;
    if (dx * dx + dy * dy + dz * dz > 40 * 40 || rel.dot(new THREE.Vector3(dx, dy, dz)) > 30 * v) {
      // respawn ahead of the camera, off the centre line
      const fwd = vel.clone().normalize();
      const r = 6 + S.rng() * 26, a = S.rng() * Math.PI * 2;
      const up = Math.abs(fwd.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
      const s1 = new THREE.Vector3().crossVectors(fwd, up).normalize(), s2 = new THREE.Vector3().crossVectors(s1, fwd);
      p.copy(c).addScaledVector(fwd, 20 + S.rng() * 25).addScaledVector(s1, Math.cos(a) * r).addScaledVector(s2, Math.sin(a) * r);
    }
    pos[i * 6] = p.x; pos[i * 6 + 1] = p.y; pos[i * 6 + 2] = p.z;
    pos[i * 6 + 3] = p.x - stretch.x; pos[i * 6 + 4] = p.y - stretch.y; pos[i * 6 + 5] = p.z - stretch.z;
  }
  S.g.attributes.position.needsUpdate = true;
}
