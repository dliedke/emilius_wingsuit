import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js';

// =============================================================== core utils
const DEG = Math.PI / 180;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function wrapAngle(a) { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; }
function fmt(n) { return Math.round(n).toLocaleString('pt-BR'); }
const $ = (id) => document.getElementById(id);
function store(key, val) {
  try {
    if (val === undefined) { const v = localStorage.getItem('emilius.' + key); return v == null ? null : JSON.parse(v); }
    localStorage.setItem('emilius.' + key, JSON.stringify(val));
  } catch (e) { return null; }
  return null;
}

const SEED = 1337;
const TC = makeTerrainCore(SEED);          // main-thread copy of the geography

// sun: WSW, afternoon (azimuth 245°, elevation 36°)
const SUN_AZ = 245 * DEG, SUN_EL = 36 * DEG;
const SUN_DIR = new THREE.Vector3(Math.sin(SUN_AZ) * Math.cos(SUN_EL), Math.sin(SUN_EL), -Math.cos(SUN_AZ) * Math.cos(SUN_EL)).normalize();

const IS_TOUCH = (('ontouchstart' in window) || navigator.maxTouchPoints > 0) && Math.min(screen.width, screen.height) < 900;
const QUALITY_PRESETS = {
  baixa: { pr: 1.0, lod: 0.65, trees: 0.45, treeDist: 2600, clouds: 0.5, name: 'Baixa' },
  media: { pr: 1.5, lod: 1.0, trees: 0.75, treeDist: 3800, clouds: 0.8, name: 'Média' },
  alta: { pr: 2.0, lod: 1.45, trees: 1.0, treeDist: 5200, clouds: 1.0, name: 'Alta' },
};
const SETTINGS = Object.assign({
  quality: 'alta',
  sound: true,
  invert: false,
  smoke: true,
  assist: true,
  cam: 0,
}, store('settings') || {});
if (!QUALITY_PRESETS[SETTINGS.quality]) SETTINGS.quality = 'media';
function saveSettings() { store('settings', SETTINGS); }
// heightfield resolution is fixed per device class (4 m desktop, 8 m phones)
const CELL0 = IS_TOUCH ? 8 : 4;
