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
function fmt(n) { return Math.round(n).toLocaleString(LANG === 'pt' ? 'pt-BR' : 'en-US'); }
const $ = (id) => document.getElementById(id);
function store(key, val) {
  try {
    if (val === undefined) { const v = localStorage.getItem('emilius.' + key); return v == null ? null : JSON.parse(v); }
    localStorage.setItem('emilius.' + key, JSON.stringify(val));
  } catch (e) { return null; }
  return null;
}

// ------------------------------------------------------------------ worlds
// Every visit starts on a fresh random world; ?seed=N replays a given one.
function urlSeed() {
  try { const m = /[?&#]seed=(\d+)/.exec(location.search + location.hash); return m ? (+m[1] % 1000000) || 1 : 0; } catch (e) { return 0; }
}
function randomSeed() { return 1 + Math.floor(Math.random() * 999999); }
let SEED = urlSeed() || randomSeed();
let TC = makeTerrainCore(SEED);          // main-thread copy of the geography

// sun direction (set per world by applyStyle)
const SUN_DIR = new THREE.Vector3(0, 1, 0);
function sunVector(az, el, out) { return out.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize(); }

// Per-world look: light, season, snow and tree lines, rock colour, wind, haze, clouds
let STYLE = null;
function makeStyle(seed) {
  const r = mulberry32(Math.imul(seed, 7919) + 17);
  const rr = (a, b) => a + (b - a) * r();
  const s = r();
  const season = s < 0.5 ? 'summer' : s < 0.78 ? 'autumn' : 'spring';
  const rocks = ['grey', 'warm', 'dark', 'pale'][Math.floor(r() * 4)];
  const snowLine = season === 'spring' ? rr(2450, 2800) : season === 'autumn' ? rr(2850, 3150) : rr(2950, 3250);
  const windDir = r() * Math.PI * 2, windSpd = rr(0.6, 2.8);
  return {
    season, rocks, snowLine,
    treeLine: rr(1900, 2250),
    sunAz: rr(120, 285) * DEG, sunEl: rr(22, 52) * DEG,
    wind: [Math.cos(windDir) * windSpd, Math.sin(windDir) * windSpd],
    haze: rr(0.72, 1.35),
    clouds: rr(0.45, 1.3),
    larchMix: season === 'autumn' ? rr(0.3, 0.6) : rr(0.12, 0.3),
  };
}

// Alpine-sounding name for the peak of each world
function worldName(seed) {
  const r = mulberry32((Math.imul(seed, 2654435761) ^ 0x51ed27) >>> 0);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const A = ['Ar', 'Bel', 'Cor', 'Dor', 'Em', 'Fal', 'Gran', 'Lau', 'Mar', 'Nev', 'Or', 'Pal', 'Ros', 'Sel', 'Tor', 'Val', 'Ver', 'Zin', 'Aur', 'Cal', 'Fen', 'Lis', 'Mon', 'Riv', 'Sol', 'Tal', 'Bris', 'Clar', 'Gel', 'Oss', 'Nor', 'Sur', 'Ard', 'Vel'];
  const M = ['', '', 'e', 'i', 'o', 'a'];
  const E = ['na', 'lio', 'rena', 'vius', 'dina', 'nello', 'rus', 'tina', 'sio', 'lara', 'mont', 'dora', 'neva', 'rin', 'dal', 'cia', 'lius', 'gna', 'ssa', 'res'];
  const base = pick(A) + pick(M) + pick(E);
  const pre = pick(['Monte', 'Punta', 'Cima', 'Becca', 'Pizzo', 'Mont', 'Pointe', 'Aiguille', 'Dent', 'Piz', 'Corno', 'Testa', 'Grand']);
  const vowel = /^[AEIOU]/.test(base);
  if (['Pointe', 'Aiguille', 'Dent'].includes(pre) && r() < 0.7) return `${pre} ${vowel ? "d'" + base : 'de ' + base}`;
  if (['Punta', 'Cima', 'Becca', 'Testa'].includes(pre) && r() < 0.4) return `${pre} di ${base}`;
  return `${pre} ${base}`;
}

const IS_TOUCH = (('ontouchstart' in window) || navigator.maxTouchPoints > 0) && Math.min(screen.width, screen.height) < 900;
const QUALITY_PRESETS = {
  baixa: { pr: 1.0, lod: 0.65, trees: 0.45, treeDist: 2600, clouds: 0.5 },
  media: { pr: 1.5, lod: 1.0, trees: 0.75, treeDist: 3800, clouds: 0.8 },
  alta: { pr: 2.0, lod: 1.45, trees: 1.0, treeDist: 5200, clouds: 1.0 },
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
