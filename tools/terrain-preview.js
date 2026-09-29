// Dev-only: terrain design previews (hillshade + contours + line) and timing.
//   node tools/terrain-preview.js [seed] [cell] [out.png]
// Renders the detailed flight box of that world, prints the gate profile and
// the minimum clearance along each segment of the line.
const fs = require('fs');
const zlib = require('zlib');
const { makeTerrainCore } = require('../src/terrain-core.js');

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function writePNG(file, w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3); }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  fs.writeFileSync(file, png);
}

const args = process.argv.slice(2);
const seed = +(args[0] ?? 1337), cell = +(args[1] ?? 16), out = args[2] ?? 'preview.png';
const T = makeTerrainCore(seed);
const { x0, z0, w: W, h: H } = T.BOX;
const nx = Math.round(W / cell) + 1, nz = Math.round(H / cell) + 1;
const hf = new Float32Array(nx * nz);
let t0 = Date.now();
for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) hf[j * nx + i] = T.height(x0 + i * cell, z0 + j * cell);
const ms = Date.now() - t0;
console.log(`seed ${seed}: ${T.LZ.type} landing, ${T.NOTCH ? 'notch' : 'no notch'}, summit ${T.SUMMIT.h} m, ${T.GATES.length} gates, ${T.LAKES.length} lakes`);
console.log(`samples ${nx}x${nz}=${nx * nz}  time ${ms}ms  (${(ms * 1e6 / (nx * nz)).toFixed(0)} ns/sample)`);

// hillshade, sun from the WSW
const sun = [-0.72, 0.62, 0.31];
const sl = Math.hypot(...sun); sun[0] /= sl; sun[1] /= sl; sun[2] /= sl;
const rgb = Buffer.alloc(nx * nz * 3);
function ramp(h) {
  const stops = [[500, [70, 120, 60]], [900, [90, 140, 70]], [1500, [60, 100, 50]], [2100, [120, 125, 80]], [2600, [150, 130, 105]], [3100, [140, 130, 125]], [3500, [235, 235, 240]]];
  if (h <= stops[0][0]) return stops[0][1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (h <= stops[i + 1][0]) { const t = (h - stops[i][0]) / (stops[i + 1][0] - stops[i][0]); return stops[i][1].map((c, k) => c + (stops[i + 1][1][k] - c) * t); }
  }
  return stops[stops.length - 1][1];
}
let hmin = 1e9, hmax = -1e9;
for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
  const k = j * nx + i;
  const h = hf[k];
  hmin = Math.min(hmin, h); hmax = Math.max(hmax, h);
  const hl = hf[j * nx + Math.max(0, i - 1)], hr = hf[j * nx + Math.min(nx - 1, i + 1)];
  const hd = hf[Math.max(0, j - 1) * nx + i], hu = hf[Math.min(nz - 1, j + 1) * nx + i];
  let n = [-(hr - hl) / (2 * cell), 1, -(hu - hd) / (2 * cell)];
  const nl = Math.hypot(...n); n = n.map(v => v / nl);
  const ndl = Math.max(0, n[0] * sun[0] + n[1] * sun[1] + n[2] * sun[2]);
  const slope = 1 - n[1];
  let base = ramp(h);
  if (slope > 0.35) base = base.map((c, q) => c * 0.6 + [110, 100, 92][q] * 0.4);
  const shade = 0.35 + 0.8 * ndl;
  // contour every 100 m
  const c100 = Math.abs(((h % 100) + 100) % 100 - 50) > 48.5 - cell * 0.25;
  let col = base.map(c => Math.min(255, c * shade));
  if (c100) col = col.map(c => c * 0.55);
  const L = T.lakeAt(x0 + i * cell, z0 + j * cell, 0);
  if (L && h < L.level) col = [40, 180, 175];
  if (Math.abs(z0 + j * cell - T.riverZ(x0 + i * cell)) < 12) col = [60, 120, 150];
  rgb[k * 3] = col[0]; rgb[k * 3 + 1] = col[1]; rgb[k * 3 + 2] = col[2];
}
function plot(x, z, c, r = 1) {
  const i = Math.round((x - x0) / cell), j = Math.round((z - z0) / cell);
  for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) {
    const ii = i + a, jj = j + b; if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) continue;
    const k = jj * nx + ii; rgb[k * 3] = c[0]; rgb[k * 3 + 1] = c[1]; rgb[k * 3 + 2] = c[2];
  }
}
// line
const Ln = T.LINE;
for (let s = 0; s < Ln.length - 1; s++) {
  const a = Ln[s], b = Ln[s + 1]; const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (cell * 0.5));
  for (let q = 0; q <= n; q++) plot(a[0] + (b[0] - a[0]) * q / n, a[1] + (b[1] - a[1]) * q / n, [255, 120, 20], 0);
}
const GATE_COL = [[255, 255, 255], [255, 60, 200], [60, 220, 255], [255, 215, 40]];
for (const g of T.GATES) plot(g[0], g[1], GATE_COL[g[4]], 2);
plot(T.LZ.x, T.LZ.z, [255, 40, 40], 3);
plot(T.SUMMIT.x, T.SUMMIT.z, [255, 255, 0], 3);
writePNG(out, nx, nz, rgb);
console.log('height range', hmin.toFixed(0), hmax.toFixed(0), '->', out);
// profile along gates
const hAt = (x, z) => { const L = T.lakeAt(x, z, 0); return Math.max(T.height(x, z), L ? L.level : -1e9); };
console.log('exit ground', hAt(T.EXIT.x, T.EXIT.z).toFixed(1), 'summit', hAt(0, 0).toFixed(1));
let prev = [T.EXIT.x, T.EXIT.z, hAt(T.EXIT.x, T.EXIT.z) + 1.8];
const KIND = ['gate', 'notch', 'lake', 'gold'];
for (const g of T.GATES) {
  const gh = hAt(g[0], g[1]);
  const d = Math.hypot(g[0] - prev[0], g[1] - prev[1]);
  // min clearance along the straight segment
  let minClr = 1e9, worst = null;
  for (let q = 1; q <= 60; q++) {
    const t = q / 60; const x = prev[0] + (g[0] - prev[0]) * t, z = prev[1] + (g[1] - prev[1]) * t, y = prev[2] + (g[2] - prev[2]) * t;
    const c = y - hAt(x, z); if (c < minClr) { minClr = c; worst = [x.toFixed(0), z.toFixed(0)]; }
  }
  console.log(`${KIND[g[4]].padEnd(5)} (${g[0].toFixed(0)},${g[1].toFixed(0)}) y=${g[2].toFixed(0)} ground=${gh.toFixed(0)} clr=${(g[2] - gh).toFixed(0)}  seg ${d.toFixed(0)}m drop ${(prev[2] - g[2]).toFixed(0)} glide ${(d / (prev[2] - g[2])).toFixed(2)} minClr ${minClr.toFixed(0)} @${worst}`);
  prev = [g[0], g[1], g[2]];
}
console.log(`landing ${T.LZ.type} at (${T.LZ.x.toFixed(0)},${T.LZ.z.toFixed(0)}) h=${T.LZ.h} ground ${hAt(T.LZ.x, T.LZ.z).toFixed(1)}`);
for (const L of T.LAKES) console.log(`lake (${L.x.toFixed(0)},${L.z.toFixed(0)}) r=${L.r.toFixed(0)} level=${L.level.toFixed(0)}${L.lz ? ' (landing)' : L.gate !== undefined ? ' (gate)' : ''}`);
