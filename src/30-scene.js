// ================================================================== SCENE
const R = {
  renderer: null, scene: null, camera: null, clock: null,
  world: null,   // everything that belongs to the current world (rebuilt for a new one)
  terrain: [], trees: [], clouds: [], gates: [], water: [], cloudClusters: [],
  frustum: new THREE.Frustum(), projScreen: new THREE.Matrix4(),
};
const PAL_BASE = {
  rock: 0x7d7872, rock2: 0x5f5b57, rockRed: 0x7f6150, scree: 0x9c8f7d, grass: 0x8c874f, meadow: 0x5c8a35,
  forest: 0x2f4527, snow: 0xf2f5f8, field1: 0x6f9a3f, field2: 0x9aa556, field3: 0x7c8a3c, road: 0x5b5a57,
  spruce: 0x345a31, larch: 0x62843a, leaf: 0x578532, trunk: 0x3b2c22, boulder: 0x8a8279, boulder2: 0x8c7462,
};
// rock types and seasons recolour the world
const PAL_ROCKS = {
  grey: {},
  warm: { rock: 0x86796b, rock2: 0x675c52, rockRed: 0x8f6148, scree: 0xa39079, boulder: 0x8f8274, boulder2: 0x94735c },
  dark: { rock: 0x6c6964, rock2: 0x514e4b, rockRed: 0x6f5849, scree: 0x898176, boulder: 0x73706b, boulder2: 0x79695c },
  pale: { rock: 0x98938a, rock2: 0x78746c, rockRed: 0x8d7a67, scree: 0xaaa190, boulder: 0xa29d94, boulder2: 0x9a8a78 },
};
const PAL_SEASONS = {
  summer: {},
  autumn: { grass: 0xa08c50, meadow: 0x7f8a3e, larch: 0xc99a34, leaf: 0xb9722e, field1: 0x8e9444, field2: 0xb3a35e, field3: 0x94873f },
  spring: { grass: 0x7f9a4a, meadow: 0x5d9a38, larch: 0x7aa04a, leaf: 0x66a03a, field1: 0x72a842, field2: 0x8fb458 },
};
let PAL = { ...PAL_BASE };
const col = (hex, s = 1) => new THREE.Color(hex).multiplyScalar(s);
// textures shared by every world (never disposed with one)
const KEEP_TEX = new Set();

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
  KEEP_TEX.add(U.uNoise.value);
}

// light, colours, wind and the river for the current world
function applyStyle() {
  const st = STYLE;
  sunVector(st.sunAz, st.sunEl, SUN_DIR);
  U.uSunDir.value.copy(SUN_DIR);
  const warm = 1 - smoothstep(18 * DEG, 46 * DEG, st.sunEl);
  const sunTint = new THREE.Color(0xfff0dc).lerp(new THREE.Color(0xffc68c), warm * 0.55);
  U.uSunCol.value.copy(sunTint).multiplyScalar(3.3 - warm * 0.25);
  U.uSkyHorizon.value.set(0xb9d2ea).lerp(new THREE.Color(0xe9d2b4), warm * 0.35);
  U.uHaze.value.set(0xc6d4e1).lerp(new THREE.Color(0xe8d4bf), warm * 0.4);
  U.uFogA.value = 0.000085 * st.haze;
  if (R.sunLight) { R.sunLight.position.copy(SUN_DIR).multiplyScalar(1000); R.sunLight.color.copy(sunTint); }
  WIND.set(st.wind[0], 0, st.wind[1]);
  const V = TC.RIV;
  U.uRiv0.value.set(V.z0, V.a1, V.p1, V.f1);
  U.uRiv1.value.set(V.a2, V.p2, V.f2, 0);
  U.uAlt.value.set(st.treeLine - 2060, st.snowLine - 3020, 0, 0);
  PAL = Object.assign({}, PAL_BASE, PAL_ROCKS[st.rocks], PAL_SEASONS[st.season]);
}

// free the GPU side of the current world before building the next one
function disposeWorld() {
  if (!R.world) return;
  R.scene.remove(R.world);
  const geos = new Set(), mats = new Set(), texs = new Set();
  R.world.traverse((o) => {
    if (o.geometry) geos.add(o.geometry);
    if (o.material) for (const m of Array.isArray(o.material) ? o.material : [o.material]) mats.add(m);
  });
  for (const m of mats) {
    for (const k in m) { const v = m[k]; if (v && v.isTexture) texs.add(v); }
    if (m.uniforms) for (const k in m.uniforms) { const v = m.uniforms[k] && m.uniforms[k].value; if (v && v.isTexture) texs.add(v); }
    m.dispose();
  }
  for (const g of geos) g.dispose();
  for (const t of texs) if (!KEEP_TEX.has(t)) t.dispose();
  R.world = null;
  R.terrain = []; R.trees = []; R.water = []; R.gates = []; R.cloudClusters = [];
  R.treeMat = null; R.sock = null; R.smoke = null; R.prop = null;
  BIRDS.flocks = []; BIRDS.mesh = null;
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
    uRiv0: U.uRiv0, uRiv1: U.uRiv1, uAlt: U.uAlt,
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
      R.world.add(mesh);
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
    uRiv0: U.uRiv0, uRiv1: U.uRiv1, uAlt: U.uAlt,
  };
}

// ------------------------------------------------------------------ water
function buildWater() {
  const L0 = WORLD.L0;
  const mk = (river, L) => new THREE.ShaderMaterial({
    uniforms: {
      ...pickU(), uNoise: U.uNoise, uHgt: { value: L0.hTex }, uOrigin: { value: new THREE.Vector2(L0.x0, L0.z0) },
      uCell: { value: L0.cell }, uDims: { value: new THREE.Vector2(L0.nx, L0.nz) }, uLevel: { value: L ? L.level : 0 },
      uRiver: { value: river ? 1 : 0 }, cDeep: { value: col(river ? 0x2e5d63 : 0x0a5f6c) }, cShallow: { value: col(river ? 0x6f9f98 : 0x39c6bc) },
      uLake: { value: new THREE.Vector4(L ? L.x : 0, L ? L.z : 0, L ? L.r : 0, L ? L.k : 1) }, uLakeDir: { value: new THREE.Vector2(L ? L.c : 1, L ? L.s : 0) },
      uLZ: MARKS.lz, uPred: MARKS.pred, uPredCol: MARKS.predCol,
    },
    vertexShader: WATER_VS, fragmentShader: WATER_FS, transparent: true,
  });
  // lakes: ellipses along their valley, faded at the shore by the shader
  for (const L of TC.LAKES) {
    const lg = new THREE.CircleGeometry(L.r + 14, 96);
    lg.rotateX(-Math.PI / 2);
    lg.scale(1, 1, 1 / L.k);
    const lake = new THREE.Mesh(lg, mk(false, L));
    lake.position.set(L.x, L.level, L.z);
    lake.rotation.y = -Math.atan2(L.s, L.c);
    lake.renderOrder = 2;
    R.world.add(lake);
    R.water.push(lake);
  }
  // river ribbon along the main valley (it ducks under nothing: lakes sit in side valleys)
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
  const river = new THREE.Mesh(rg, mk(true, null));
  river.frustumCulled = false;
  river.renderOrder = 2;
  R.world.add(river);
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
  const rng = mulberry32(Math.imul(SEED, 7) + 777);
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
      R.world.add(m);
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
      // fully clear well inside the tile border: no hard quad edges, no bleeding
      // from the neighbouring puff in the smaller mip levels
      a *= 1 - smoothstep(0.72, 0.9, Math.max(Math.abs(u), Math.abs(v), Math.hypot(u, v) * 0.8));
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
let CLOUD_TEX = null;
// cloud clusters around this world: mist by the exit, banks off the line, far fields
function cloudClusters() {
  const rng = mulberry32(Math.imul(SEED, 13) + 55);
  const rr = (a, b) => a + (b - a) * rng();
  const S = TC.SUMMIT, G = TC.GATES, amt = STYLE.clouds;
  const out = [];   // [x, y, z, radiusX, radiusY, puffs, puffSize]
  const side = rng() < 0.5 ? -1 : 1;
  out.push([side * rr(220, 320), S.h - rr(100, 160), rr(-80, 40), 260, 70, 34, 95]);   // mist beside the exit, like the video
  if (rng() < 0.7) out.push([-side * rr(420, 620), S.h - rr(60, 160), rr(120, 300), 240, 70, 26, 100]);
  // banks beside the flight, well clear of the line
  const nMid = Math.round(rr(3, 6) * amt);
  for (let i = 0; i < nMid; i++) {
    const g = G[Math.floor(rng() * G.length)];
    const sd = rng() < 0.5 ? -1 : 1, off = rr(900, 1700);
    const rx = rr(420, 700);
    out.push([g[0] + sd * off, g[2] + rr(250, 650), g[1] + rr(-300, 300), rx, rx * 0.24, Math.round(rr(24, 32)), rr(180, 240)]);
  }
  // far fields
  const nFar = Math.round(rr(6, 10) * amt);
  for (let i = 0; i < nFar; i++) {
    const a = rng() * Math.PI * 2, d = rr(4200, 16000);
    const rx = rr(900, 2200);
    out.push([Math.cos(a) * d, rr(3500, 4800), -3000 + Math.sin(a) * d, rx, rx * 0.2, Math.round(rr(24, 30)), rr(320, 800)]);
  }
  return out;
}
// A puff is a camera-facing quad: wherever it cuts through a slope the two
// surfaces sit at the same depth and the depth test flickers between them
// (blinking stripes and blocks). Keep every puff's bounding sphere clear of
// the terrain: shrink it until it fits, or drop it (returns 0).
function puffFit(x, y, z, size, stretch) {
  for (const k of [1, 0.8, 0.62, 0.48]) {
    const R0 = 0.5 * size * k * stretch * 1.05;
    let ok = y - R0 > groundHeight(x, z) + 6;
    for (let j = 0; ok && j < 16; j++) {
      const d = R0 * (j < 8 ? 0.55 : 1), a = (j % 8) * Math.PI / 4 + (j < 8 ? 0 : Math.PI / 8);
      ok = y - Math.sqrt(Math.max(0, R0 * R0 - d * d)) > groundHeight(x + Math.cos(a) * d, z + Math.sin(a) * d) + 6;
    }
    if (ok) return size * k;
  }
  return 0;
}
function buildClouds() {
  if (!CLOUD_TEX) { CLOUD_TEX = cloudTexture(); KEEP_TEX.add(CLOUD_TEX); }
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...pickU(), uTex: { value: CLOUD_TEX } },
    vertexShader: CLOUD_VS, fragmentShader: CLOUD_FS, transparent: true, depthWrite: false,
  });
  const quad = new THREE.PlaneGeometry(1, 1);
  const rng = mulberry32(Math.imul(SEED, 3) + 55);
  const Q = QUALITY_PRESETS[SETTINGS.quality];
  const clusters = cloudClusters();
  R.cloudClusters = [];
  for (const [x, y, z, rx, ry, n0, ps] of clusters) {
    const n1 = Math.max(6, Math.round(n0 * Q.clouds));
    const aPuff = new Float32Array(n1 * 4), aInfo = new Float32Array(n1 * 4);
    let n = 0;
    for (let i = 0; i < n1; i++) {
      const a = rng() * Math.PI * 2, r = Math.sqrt(rng());
      const ox = Math.cos(a) * r * rx, oz = Math.sin(a) * r * rx * 0.8;
      const oy = (rng() - 0.3) * ry * (1 - r * 0.6);
      const px = x + ox, py = y + oy, pz = z + oz, stretch = ps > 400 ? 2.6 : ps > 180 ? 1.8 : 1;
      const size = puffFit(px, py, pz, ps * (0.6 + rng() * 0.8) * (1.15 - r * 0.4), stretch);
      const dir = new THREE.Vector3(ox, oy * 2.5, oz).normalize();
      const shade = clamp(0.45 + 0.4 * dir.dot(SUN_DIR) + 0.35 * (oy / ry), 0.12, 1);
      const idx = Math.floor(rng() * 4), rot = (rng() - 0.5) * 0.5, op = 0.5 + rng() * 0.4;
      if (!size) continue;   // no room between the slopes: drop it
      aPuff[n * 4] = px; aPuff[n * 4 + 1] = py; aPuff[n * 4 + 2] = pz; aPuff[n * 4 + 3] = size;
      aInfo[n * 4] = idx + (stretch - 1) / 3.2; aInfo[n * 4 + 1] = rot; aInfo[n * 4 + 2] = shade; aInfo[n * 4 + 3] = op;
      n++;
    }
    if (!n) continue;
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
    R.world.add(m);
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
  const S = TC.SUMMIT, E = TC.EXIT, LZ = TC.LZ, L0 = WORLD.L0;
  // summit cross
  const metal = stdMat({ color: 0x2b2d30, roughness: 0.55, metalness: 0.7 });
  const cross = new THREE.Group();
  const v = new THREE.Mesh(new THREE.BoxGeometry(0.16, 4.6, 0.16), metal); v.position.y = 2.3; cross.add(v);
  const hbar = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.14, 0.14), metal); hbar.position.y = 3.4; cross.add(hbar);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 0.5, 8), stdMat({ color: 0x6b645c, roughness: 1 })); base.position.y = 0.2; cross.add(base);
  cross.position.set(S.x + 7, groundHeight(S.x + 7, S.z + 6) - 0.1, S.z + 6);
  cross.rotation.y = 0.5;
  R.world.add(cross);
  // rocks: summit blocks, exit ledge, scree boulders along the line, a few huge erratics
  const rockMat = stdMat({ color: PAL.boulder, roughness: 0.95, flatShading: true });
  const rockMat2 = stdMat({ color: PAL.boulder2, roughness: 0.95, flatShading: true });
  const geoA = rockGeometry(3, 1), geoB = rockGeometry(9, 1);
  const rng = mulberry32(Math.imul(SEED, 11) + 8080);
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
  // scree boulders on the slopes the line flies past
  const Ln = TC.LINE;
  const clear = (x, z, pad) => inLevel(L0, x, z) && !TC.lakeAt(x, z, pad) && Math.hypot(x - LZ.x, z - LZ.z) > 70 + pad;
  for (let i = 0; i < 1500; i++) {
    const k = Math.floor(rng() * (Ln.length - 1)), t = rng();
    const a = rng() * Math.PI * 2, r = 25 + Math.pow(rng(), 0.7) * 560;
    const x = lerp(Ln[k][0], Ln[k + 1][0], t) + Math.cos(a) * r, z = lerp(Ln[k][1], Ln[k + 1][1], t) + Math.sin(a) * r;
    if (!clear(x, z, 8)) continue;
    const sc = splatAt(L0, x, z, 2), fo = splatAt(L0, x, z, 0), sn = splatAt(L0, x, z, 1);
    if (fo > 0.35 || sn > 0.55) continue;
    if (sc < 0.15 && rng() > 0.22) continue;
    places.push([x, z, 0.6 + Math.pow(rng(), 3) * 5, rng()]);
  }
  // erratics: house-sized boulders left on meadows and lake shores
  for (let i = 0; i < 60; i++) {
    const k = Math.floor(rng() * (Ln.length - 1)), t = rng();
    const a = rng() * Math.PI * 2, r = 80 + rng() * 700;
    const x = lerp(Ln[k][0], Ln[k + 1][0], t) + Math.cos(a) * r, z = lerp(Ln[k][1], Ln[k + 1][1], t) + Math.sin(a) * r;
    if (!clear(x, z, 25) || splatAt(L0, x, z, 0) > 0.2 || splatAt(L0, x, z, 1) > 0.4) continue;
    places.push([x, z, 5 + rng() * 7, rng()]);
  }
  if (LZ.type === 'mountain') {
    for (let i = 0; i < 70; i++) {
      const a = rng() * Math.PI * 2, r = 45 + rng() * 170;
      const x = LZ.x + Math.cos(a) * r, z = LZ.z + Math.sin(a) * r;
      if (inLevel(L0, x, z)) places.push([x, z, 0.5 + Math.pow(rng(), 2.5) * 3.2, rng()]);
    }
  }
  const mA = new THREE.InstancedMesh(geoA, rockMat, places.length);
  const mB = new THREE.InstancedMesh(geoB, rockMat2, places.length);
  const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3();
  let na = 0, nb = 0;
  for (const [x, z, sz, r] of places) {
    q.setFromEuler(new THREE.Euler(rng() * 0.4, rng() * 6.28, rng() * 0.4));
    sc.set(sz * (0.8 + rng() * 0.5), sz * (0.6 + rng() * 0.5), sz * (0.8 + rng() * 0.5));
    ps.set(x, groundHeight(x, z) + sz * 0.15, z);
    mtx.compose(ps, q, sc);
    if (r < 0.7) mA.setMatrixAt(na++, mtx); else mB.setMatrixAt(nb++, mtx);
  }
  mA.count = na; mB.count = nb;
  R.world.add(mA); R.world.add(mB);
  // exit ledge: a flat slab jutting over the north face
  const slab = new THREE.Mesh(rockGeometry(21, 2), rockMat);
  slab.scale.set(1.2, 0.45, 1.6);
  slab.rotation.y = 0.3;
  const gy = groundHeight(E.x, E.z + 1.5);
  slab.position.set(E.x, gy - 0.3, E.z - 0.3);
  R.world.add(slab);
  R.exitY = gy + 0.12;

  buildLandingZone();
  buildVillages();
}
let TARGET_TEX = null;
function targetTexture() {
  if (TARGET_TEX) return TARGET_TEX;
  // target: painted rings
  const cv = document.createElement('canvas'); cv.width = cv.height = 512;
  const g = cv.getContext('2d');
  const rings = ['#ff6b1a', '#f4f1ea', '#ff6b1a', '#f4f1ea', '#ff6b1a'];
  for (let i = 0; i < rings.length; i++) { g.fillStyle = rings[i]; g.beginPath(); g.arc(256, 256, 250 - i * 48, 0, Math.PI * 2); g.fill(); }
  g.strokeStyle = '#1d1f22'; g.lineWidth = 16;
  g.beginPath(); g.moveTo(206, 206); g.lineTo(306, 306); g.moveTo(306, 206); g.lineTo(206, 306); g.stroke();
  const img = g.getImageData(0, 0, 512, 512);
  for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) if (Math.hypot(x - 256, y - 256) > 250) img.data[(y * 512 + x) * 4 + 3] = 0;
  g.putImageData(img, 0, 0);
  TARGET_TEX = new THREE.CanvasTexture(cv); TARGET_TEX.colorSpace = THREE.SRGBColorSpace; TARGET_TEX.anisotropy = 8;
  KEEP_TEX.add(TARGET_TEX);
  return TARGET_TEX;
}
function buildLandingZone() {
  const LZ = TC.LZ;
  const lake = LZ.type === 'lake';
  const gy = lake ? LZ.h : groundHeight(LZ.x, LZ.z);
  const tex = targetTexture();
  if (lake) {
    // floating platform: a timber deck on pontoons, ringed by buoys
    const deck = new THREE.Mesh(new THREE.CylinderGeometry(LZ.plat, LZ.plat + 0.3, 1.1, 48), stdMat({ color: 0x8c6b4c, roughness: 0.9 }));
    deck.position.set(LZ.x, LZ.h - 0.55, LZ.z);
    R.world.add(deck);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(LZ.plat + 0.35, 0.45, 8, 64), stdMat({ color: 0x2b2f33, roughness: 0.8 }));
    rim.rotation.x = Math.PI / 2; rim.position.set(LZ.x, LZ.h - 0.75, LZ.z);
    R.world.add(rim);
    const buoyMat = stdMat({ color: 0xff6b1a, emissive: 0xff3a00, emissiveIntensity: 0.25, roughness: 0.6 });
    const buoys = new THREE.InstancedMesh(new THREE.SphereGeometry(0.7, 12, 8), buoyMat, 16);
    const m = new THREE.Matrix4();
    for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; m.makeTranslation(LZ.x + Math.cos(a) * (LZ.plat + 9), LZ.h - 0.6, LZ.z + Math.sin(a) * (LZ.plat + 9)); buoys.setMatrixAt(i, m); }
    R.world.add(buoys);
  }
  const disk = new THREE.Mesh(new THREE.CircleGeometry(TARGET_R, 64), stdMat({ map: tex, transparent: true, roughness: 0.9, emissive: 0xff5a10, emissiveMap: tex, emissiveIntensity: 0.35, polygonOffset: true, polygonOffsetFactor: -4, depthWrite: false }));
  disk.rotation.x = -Math.PI / 2;
  disk.position.set(LZ.x, gy + (lake ? 0.04 : 0.12), LZ.z);
  R.world.add(disk);
  MARKS.lz.value.set(LZ.x, LZ.z, 40, 1);
  // smoke flare and windsock: on the deck's edge, or on the meadow beside the target
  const sx = lake ? LZ.x - 13 : LZ.x - 9, sz = lake ? LZ.z + 13 : LZ.z + 24;
  buildLzSmoke(sx, lake ? LZ.h : groundHeight(sx, sz), sz);
  const wx = lake ? LZ.x + 15 : LZ.x + 26, wz = lake ? LZ.z - 12 : LZ.z - 14;
  const wy = lake ? LZ.h : groundHeight(wx, wz);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 6, 8), stdMat({ color: 0xdddddd, roughness: 0.4, metalness: 0.6 }));
  pole.position.set(wx, wy + 3, wz);
  R.world.add(pole);
  const cv2 = document.createElement('canvas'); cv2.width = 256; cv2.height = 16;
  const g2 = cv2.getContext('2d');
  for (let i = 0; i < 5; i++) { g2.fillStyle = i % 2 ? '#f4f1ea' : '#ff6b1a'; g2.fillRect(i * 51.2, 0, 51.2, 16); }
  const t2 = new THREE.CanvasTexture(cv2); t2.colorSpace = THREE.SRGBColorSpace;
  const sockGeo = new THREE.CylinderGeometry(0.42, 0.16, 2.6, 16, 8, true);
  sockGeo.rotateZ(Math.PI / 2); sockGeo.translate(1.3, 0, 0);
  const sock = new THREE.Mesh(sockGeo, stdMat({ map: t2, side: THREE.DoubleSide, roughness: 0.8 }));
  sock.position.set(wx, wy + 5.8, wz);
  R.world.add(sock);
  R.sock = sock; R.sockBase = sockGeo.attributes.position.array.slice();
  if (LZ.type === 'mountain') buildHut();
  R.lzY = gy;
}
// mountain landings: an alpine hut and its flag at the edge of the shelf
function buildHut() {
  const LZ = TC.LZ;
  const rng = mulberry32(Math.imul(SEED, 5) + 99);
  let best = null;
  for (let i = 0; i < 24; i++) {
    const a = rng() * Math.PI * 2, r = 42 + rng() * 22;
    const x = LZ.x + Math.cos(a) * r, z = LZ.z + Math.sin(a) * r;
    const y = groundHeight(x, z), rough = Math.abs(groundHeight(x + 6, z + 6) - y) + Math.abs(groundHeight(x - 6, z + 6) - y);
    if (!best || rough < best.rough) best = { x, z, y, rough, a };
  }
  const hut = new THREE.Mesh(houseGeometry(), stdMat({ vertexColors: true, color: 0xc9c0b3, roughness: 0.9 }));
  hut.scale.set(13, 7, 9);
  hut.position.set(best.x, best.y - 1.2, best.z);
  hut.rotation.y = best.a + Math.PI / 2;
  R.world.add(hut);
  const fx = best.x + Math.cos(best.a) * 10, fz = best.z + Math.sin(best.a) * 10, fy = groundHeight(fx, fz);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 9, 8), stdMat({ color: 0xd8d8d8, roughness: 0.5, metalness: 0.5 }));
  pole.position.set(fx, fy + 4.5, fz);
  R.world.add(pole);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.5), stdMat({ color: 0xd4202a, roughness: 0.8, side: THREE.DoubleSide }));
  flag.position.set(fx + 1.2, fy + 8.2, fz);
  flag.rotation.y = -Math.atan2(WIND.z, WIND.x);
  R.world.add(flag);
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
  R.world.add(mesh);
  // the flare canister itself
  const can = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.35, 10), stdMat({ color: 0xff6b1a, emissive: 0xff3a00, emissiveIntensity: 1.5 }));
  can.position.set(x, y + 0.18, z);
  R.world.add(can);
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
  const rng = mulberry32(Math.imul(SEED, 17) + 2024);
  const LZ = TC.LZ;
  // [x, z, radius, count] — villages strung along the main river, a town somewhere down the valley
  const spots = [];
  const town = Math.floor(rng() * 6);
  for (let i = 0; i < 12; i++) {
    const x = LZ.x + (i - 5.5) * 1300 + (rng() - 0.5) * 700;
    const side = rng() < 0.5 ? -1 : 1;
    const z = TC.riverZ(x) + side * (160 + rng() * 380);
    const big = i === town + 3;
    const rad = big ? 380 + rng() * 180 : 110 + rng() * 170;
    spots.push([x, z, rad, big ? 180 : Math.round(rad * rad / 1300)]);
  }
  // a hamlet near a valley landing
  if (LZ.type === 'valley') spots.push([LZ.x + (rng() < 0.5 ? -1 : 1) * (320 + rng() * 150), LZ.z + (rng() - 0.5) * 200, 150, 22]);
  const list = [];
  for (const [cx, cz, rad, n] of spots) {
    let placed = 0;
    for (let i = 0; i < n * 3 && list.length < 2000 && placed < n; i++) {
      const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * rad;
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      const dr = z - TC.riverZ(x);
      if (Math.abs(dr) < 45) continue;
      if (Math.abs(dr + 380 - 60 * Math.sin(x / 1400)) < 10 || Math.abs(dr - 260 - 40 * Math.sin(x / 2100)) < 13) continue;
      if (Math.hypot(x - LZ.x, z - LZ.z) < 140 || TC.lakeAt(x, z, 30)) continue;
      const y = groundHeight(x, z);
      const y2 = groundHeight(x + 6, z + 6);
      if (Math.abs(y2 - y) > 4 || y > TC.F0 + 260) continue;
      list.push({ x, y, z, w: 7 + rng() * 7, d: 8 + rng() * 9, h: 5 + rng() * (rad > 300 ? 9 : 4), rot: Math.round(rng() * 4) * Math.PI / 2 + (rng() - 0.5) * 0.3 });
      placed++;
    }
  }
  const geo = houseGeometry();
  const mat = stdMat({ vertexColors: true, roughness: 0.85 });
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  list.forEach((hs, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), hs.rot);
    s.set(hs.w, hs.h, hs.d); p.set(hs.x, hs.y - 1, hs.z);
    m.compose(p, q, s);
    mesh.setMatrixAt(i, m);
  });
  mesh.count = list.length;
  mesh.frustumCulled = false;
  R.world.add(mesh);
  WORLD.houses = list;
}

// ------------------------------------------------------------------ gates
// kinds: 0 gate, 1 the notch between the towers, 2 over a lake's lip, 3 gold (small)
const GATE_ORANGE = new THREE.Color(0xff6b1a), GATE_WHITE = new THREE.Color(0xf4f1ea), GATE_LAKE = new THREE.Color(0x3fd0c4), GATE_GOLD = new THREE.Color(0xffc21f);
const GATE_POINTS = [250, 750, 500, 500];
function gateColor(kind) { return kind === 2 ? GATE_LAKE : kind === 3 ? GATE_GOLD : GATE_ORANGE; }
function buildGates() {
  const G = TC.GATES;
  const pts = [[TC.EXIT.x, TC.EXIT.z, R.exitY], ...G.map((g) => [g[0], g[1], g[2]]), [TC.LZ.x, TC.LZ.z, TC.LZ.h]];
  G.forEach((g, i) => {
    const [x, z, y, r, kind] = g;
    const prev = pts[i], next = pts[i + 2];
    const dir = new THREE.Vector3(next[0] - prev[0], (next[2] - prev[2]) * 0.3, next[1] - prev[1]).normalize();
    const geo = new THREE.TorusGeometry(r, kind === 1 ? 0.42 : kind === 3 ? 0.38 : 0.5, 10, 96);
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...pickU(), uColA: { value: gateColor(kind).clone().multiplyScalar(1.2) }, uColB: { value: GATE_WHITE.clone() }, uGlow: { value: 0.3 }, uFade: { value: 1 } },
      vertexShader: GATE_VS, fragmentShader: GATE_FS, transparent: true, depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.lookAt(x + dir.x, y + dir.y, z + dir.z);
    mesh.renderOrder = 6;
    R.world.add(mesh);
    R.gates.push({ mesh, mat, x, y, z, r, n: dir, state: 0, t: 0, kind, notch: kind === 1, col: gateColor(kind) });
  });
}

// ------------------------------------------------------------------ birds
// Alpine choughs in flocks in front of the exit and along the line (they scatter,
// calling, when you pass close) and a few raptors circling in thermals over the
// line and the landing.
const BIRDS = { flocks: [], mesh: null, n: 0, aP: null, aQ: null, aK: null };
function birdGeometry() {
  const P = [], W = [];
  const tri = (a, b, c, wa, wb, wc) => { P.push(...a, ...b, ...c); W.push(wa, wb, wc); };
  // body: a slim double pyramid, nose forward (-z)
  const nose = [0, 0, -0.3], tail = [0, 0, 0.26], l = [-0.05, 0, 0], r = [0.05, 0, 0], up = [0, 0.04, -0.02], dn = [0, -0.035, 0];
  tri(nose, l, up, 0, 0, 0); tri(nose, up, r, 0, 0, 0); tri(nose, dn, l, 0, 0, 0); tri(nose, r, dn, 0, 0, 0);
  tri(tail, up, l, 0, 0, 0); tri(tail, r, up, 0, 0, 0); tri(tail, l, dn, 0, 0, 0); tri(tail, dn, r, 0, 0, 0);
  tri([0, 0, 0.2], [-0.09, 0, 0.42], [0.09, 0, 0.42], 0, 0, 0);   // tail fan
  // wings: inner panel to the wrist, swept outer panel to the tip
  for (const sg of [-1, 1]) {
    const a = [sg * 0.04, 0, -0.1], b = [sg * 0.04, 0, 0.1], c = [sg * 0.26, 0, 0.12], d = [sg * 0.26, 0, -0.08], e = [sg * 0.5, 0, 0.07];
    tri(a, b, c, 0, 0, 1); tri(a, c, d, 0, 1, 1); tri(d, c, e, 1, 1, 2);
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('aWing', new THREE.Float32BufferAttribute(W, 1));
  return g;
}
function buildBirds() {
  const rng = mulberry32(Math.imul(SEED, 97) + 5);
  const rr = (a, b) => a + (b - a) * rng();
  const G = TC.GATES, LZ = TC.LZ, E = TC.EXIT;
  const specs = [];
  // a point beside segment k of the line (exit -> gate 0 -> gate 1 ...), t along it, off to one side
  const P0 = [E.x, E.z, groundHeight(E.x, E.z)];
  const beside = (k, t, off, dy) => {
    const a = k ? G[k - 1] : P0, g = G[k];
    const dx = g[0] - a[0], dz = g[1] - a[1], L = Math.hypot(dx, dz) || 1, sd = rng() < 0.5 ? -1 : 1;
    const x = a[0] + dx * t - dz / L * sd * off, z = a[1] + dz * t + dx / L * sd * off;
    return [x, Math.max(a[2] + (g[2] - a[2]) * t + dy, groundHeight(x, z) + 25), z];
  };
  // choughs out in front of the exit, about level with it: you watch them while standing
  // there, then dive under them
  {
    const L0 = Math.hypot(G[0][0] - E.x, G[0][1] - E.z) || 1, c = beside(0, rr(70, 120) / L0, rr(5, 35), 0);
    c[1] = Math.max(P0[2] + rr(-15, 20), groundHeight(c[0], c[2]) + 25);
    specs.push({ kind: 0, c, R: rr(25, 40), n: 14 + Math.floor(rr(0, 8)) });
  }
  // flocks along the line, close enough to fly past (they scatter when you do)
  const nLine = 3 + Math.floor(rng() * 3);
  for (let i = 0; i < nLine; i++) specs.push({ kind: 0, c: beside(1 + Math.floor(rng() * (G.length - 1)), rr(0.25, 0.75), rr(15, 70), rr(-10, 30)), R: rr(25, 45), n: 8 + Math.floor(rr(0, 10)) });
  if (TC.TOWERS.length) { const T = TC.TOWERS[Math.floor(rng() * TC.TOWERS.length)]; specs.push({ kind: 0, c: [T[0], T[2] + rr(20, 60), T[1]], R: rr(40, 70), n: 10 + Math.floor(rr(0, 6)) }); }
  // raptors riding thermals: over the landing (seen under canopy) and above the middle of the line
  { const x = LZ.x + rr(-170, 170), z = LZ.z + rr(-170, 170); specs.push({ kind: 1, c: [x, Math.max(LZ.h + rr(110, 230), groundHeight(x, z) + 70), z], R: rr(55, 90), n: 2 + Math.floor(rng() * 2) }); }
  specs.push({ kind: 1, c: beside(1 + Math.floor(rng() * (G.length - 1)), rr(0.2, 0.8), rr(60, 140), rr(20, 70)), R: rr(70, 110), n: 1 + Math.floor(rng() * 2) });
  const flocks = [];
  let n = 0;
  for (const sp of specs) {
    const raptor = sp.kind === 1;
    const F = { kind: sp.kind, cx: sp.c[0], cy: sp.c[1], cz: sp.c[2], R: sp.R, a: rng() * 6.283, w: (raptor ? rr(7, 10) : rr(9, 13)) / sp.R * (rng() < 0.5 ? -1 : 1), bob: rr(5, 18), e: rr(0.6, 1), birds: [], c: new THREE.Vector3(), alarm: false };
    for (let i = 0; i < sp.n; i++) {
      const off = raptor ? new THREE.Vector3(rr(-40, 40), rr(-25, 25), rr(-40, 40)) : new THREE.Vector3(rr(-24, 24), rr(-8, 8), rr(-24, 24));
      F.birds.push({
        p: new THREE.Vector3(F.cx + off.x, F.cy + off.y, F.cz + off.z), v: new THREE.Vector3(rr(-2, 2), 0, rr(-2, 2)), off,
        ph: rng() * 6.283, rate: raptor ? rr(5, 6.5) : rr(13, 17), flap: raptor ? 0 : 1, scared: 0, bank: 0, hd: 0, pitch: 0,
        size: raptor ? rr(2.8, 3.4) : rr(1.4, 1.7),
      });
      n++;
    }
    flocks.push(F);
  }
  const geo = birdGeometry();
  BIRDS.aP = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4).setUsage(THREE.DynamicDrawUsage);
  BIRDS.aQ = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4).setUsage(THREE.DynamicDrawUsage);
  BIRDS.aK = new THREE.InstancedBufferAttribute(new Float32Array(n * 2), 2);
  geo.setAttribute('aP', BIRDS.aP); geo.setAttribute('aQ', BIRDS.aQ); geo.setAttribute('aK', BIRDS.aK);
  geo.instanceCount = n;
  let k = 0;
  for (const F of flocks) for (let i = 0; i < F.birds.length; i++, k++) { BIRDS.aK.array[k * 2] = F.kind; BIRDS.aK.array[k * 2 + 1] = F.kind ? 0.28 : 0.8; }
  // uPx: radians per screen pixel, so far birds keep a minimum size on screen (set every frame)
  const mat = new THREE.ShaderMaterial({ uniforms: { ...pickU(), uPx: { value: 0.0015 } }, vertexShader: BIRD_VS, fragmentShader: BIRD_FS, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  R.world.add(mesh);
  BIRDS.mesh = mesh; BIRDS.flocks = flocks; BIRDS.n = n;
  updateBirds(0, null);
}
const _bt = new THREE.Vector3(), _bd = new THREE.Vector3();
// returns how many flocks the pilot just startled (for their alarm calls)
function updateBirds(dt, player) {
  if (!BIRDS.mesh) return 0;
  const P = BIRDS.aP.array, Q = BIRDS.aQ.array;
  let k = 0, startled = 0;
  for (const F of BIRDS.flocks) {
    const raptor = F.kind === 1;
    let fear = 0;
    F.a += dt * F.w;
    F.c.set(F.cx + Math.cos(F.a) * F.R, F.cy + Math.sin(F.a * 0.7) * F.bob, F.cz + Math.sin(F.a) * F.R * F.e);
    for (const b of F.birds) {
      if (dt > 0) {
        const spread = 1 + b.scared * 3;
        _bt.set(F.c.x + b.off.x * spread, F.c.y + b.off.y * spread, F.c.z + b.off.z * spread);
        // steer toward the formation slot, flee from the pilot when close
        const acc = _bd.subVectors(_bt, b.p).multiplyScalar(raptor ? 0.25 : 0.9).addScaledVector(b.v, raptor ? -0.12 : -0.5);
        if (player) {
          const dx = b.p.x - player.x, dy = b.p.y - player.y, dz = b.p.z - player.z, d = Math.hypot(dx, dy, dz);
          if (d < 60 && !raptor) { b.scared = Math.min(1, b.scared + dt * 5); const f = (60 - d) * 2.2 / Math.max(d, 1); acc.x += dx * f; acc.y += Math.abs(dy) * f * 0.6 + 4; acc.z += dz * f; }
        }
        b.scared = Math.max(0, b.scared - dt * 0.2);
        fear = Math.max(fear, b.scared);
        b.v.addScaledVector(acc, dt);
        const sp = b.v.length(), vmin = raptor ? 8 : 7, vmax = raptor ? 16 : 13 + b.scared * 11;
        if (sp > vmax) b.v.multiplyScalar(vmax / sp); else if (sp < vmin) b.v.multiplyScalar(vmin / Math.max(sp, 0.01));
        b.p.addScaledVector(b.v, dt);
        const floor = groundHeight(b.p.x, b.p.z) + 6;
        if (b.p.y < floor) { b.p.y = floor; b.v.y = Math.abs(b.v.y); }
        const hd = Math.atan2(b.v.x, -b.v.z);
        const turn = wrapAngle(hd - b.hd) / Math.max(dt, 1e-3);
        b.hd = hd;
        b.bank = damp(b.bank, clamp(-turn * (raptor ? 0.9 : 0.35), -0.9, 0.9), 4, dt);
        b.pitch = damp(b.pitch, Math.atan2(b.v.y, Math.hypot(b.v.x, b.v.z)), 5, dt);
        // choughs flap in bursts and glide; raptors mostly soar
        const wantFlap = raptor ? (b.v.y > 1.5 ? 1 : 0) : (b.scared > 0.2 || b.v.y > 0.5 || Math.sin(b.ph * 0.07 + k) > -0.2 ? 1 : 0);
        b.flap = damp(b.flap, wantFlap, 3, dt);
        b.ph += dt * b.rate * (0.15 + 0.85 * b.flap) * (1 + b.scared * 0.5);
      }
      P[k * 4] = b.p.x; P[k * 4 + 1] = b.p.y; P[k * 4 + 2] = b.p.z; P[k * 4 + 3] = b.size;
      Q[k * 4] = b.hd; Q[k * 4 + 1] = b.pitch; Q[k * 4 + 2] = b.bank; Q[k * 4 + 3] = b.flap > 0.05 ? b.ph : 0.35;
      k++;
    }
    if (fear > 0.3 && !F.alarm) { F.alarm = true; startled++; } else if (fear < 0.05) F.alarm = false;
  }
  BIRDS.aP.needsUpdate = true; BIRDS.aQ.needsUpdate = true;
  return startled;
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
