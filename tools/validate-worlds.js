// Dev-only: checks that generated worlds are flyable, straight from the terrain
// function (no browser needed).
//   node tools/validate-worlds.js [count] [firstSeed]
// For every seed: clearance along each segment of the line, gates above the
// ground, turns along the line, the landing zone flat and inside the detailed
// box, and every lake holding its water (except at its outlet, downstream).
const { makeTerrainCore } = require('../src/terrain-core.js');
const N = +(process.argv[2] || 100), S0 = +(process.argv[3] || 1);
const stats = { types: {}, notch: 0, lakeGate: 0, gold: 0, gates: [], bad: [], sharp: 0, turns: 0 };
for (let seed = S0; seed < S0 + N; seed++) {
  const T = makeTerrainCore(seed);
  const H = (x, z) => T.height(x, z, false);
  const surf = (x, z) => { const L = T.lakeAt(x, z, 0); return Math.max(H(x, z), L ? L.level : -1e9); };
  const issues = [];
  const LZ = T.LZ, B = T.BOX;
  stats.types[LZ.type] = (stats.types[LZ.type] || 0) + 1;
  if (T.NOTCH) stats.notch++;
  if (T.GATES.some((g) => g[4] === 2)) stats.lakeGate++;
  stats.gold += T.GATES.filter((g) => g[4] === 3).length;
  stats.gates.push(T.GATES.length);
  // the line, exit to last gate: clearance on every straight segment
  let prev = [T.EXIT.x, T.EXIT.z, H(T.EXIT.x, T.EXIT.z) + 1];
  let minClr = 1e9, minAt = null;
  T.GATES.forEach((g, i) => {
    if (g[2] - surf(g[0], g[1]) < (g[4] === 2 ? 9 : 12)) issues.push(`gate ${i} only ${(g[2] - surf(g[0], g[1])).toFixed(0)} m above the ground`);
    const d = Math.hypot(g[0] - prev[0], g[1] - prev[1]), n = Math.ceil(d / 8);
    for (let q = 1; q < n; q++) {
      const t = q / n;
      if (i === 0 && t < 0.1) continue;   // leaving the exit ledge
      const x = prev[0] + (g[0] - prev[0]) * t, z = prev[1] + (g[1] - prev[1]) * t, y = prev[2] + (g[2] - prev[2]) * t;
      const c = y - surf(x, z);
      if (c < minClr) { minClr = c; minAt = `segment ${i} at ${Math.round(t * 100)}%`; }
    }
    prev = [g[0], g[1], g[2]];
  });
  if (minClr < 8) issues.push(`line clearance ${minClr.toFixed(1)} m (${minAt})`);
  // turns
  const P = [[T.EXIT.x, T.EXIT.z], ...T.GATES.map((g) => [g[0], g[1]])];
  for (let i = 1; i < P.length - 1; i++) {
    const a = Math.atan2(P[i][0] - P[i - 1][0], -(P[i][1] - P[i - 1][1])), b = Math.atan2(P[i + 1][0] - P[i][0], -(P[i + 1][1] - P[i][1]));
    let deg = Math.abs(b - a) * 180 / Math.PI; if (deg > 180) deg = 360 - deg;
    stats.turns++; if (deg > 60) stats.sharp++;
  }
  // landing zone
  const inBox = (x, z, m) => x > B.x0 + m && x < B.x0 + B.w - m && z > B.z0 + m && z < B.z0 + B.h - m;
  if (!inBox(LZ.x, LZ.z, 500)) issues.push('landing zone near the edge of the detailed box');
  if (LZ.type === 'lake') {
    const L = T.lakeAt(LZ.x, LZ.z, 0);
    if (!L || L.level - H(LZ.x, LZ.z) < 3) issues.push('landing platform not over deep water');
  } else {
    let bump = 0;
    for (const [ox, oz] of [[20, 0], [-20, 0], [0, 20], [0, -20], [30, 30], [-30, -30]]) bump = Math.max(bump, Math.abs(H(LZ.x + ox, LZ.z + oz) - H(LZ.x, LZ.z)));
    if (bump > 3) issues.push(`landing zone bumpy (${bump.toFixed(1)} m)`);
  }
  // lakes hold water: the rim, 8 m out, all round but the outlet
  T.LAKES.forEach((L, li) => {
    let low = 0;
    for (let a = 0; a < 64; a++) {
      const th = a / 64 * Math.PI * 2;
      if (Math.cos(th) > Math.cos(50 * Math.PI / 180)) continue;
      const u = Math.cos(th) * (L.r + 8), v = Math.sin(th) * (L.r + 8) / L.k;
      if (H(L.x + u * L.c - v * L.s, L.z + u * L.s + v * L.c) < L.level - 0.5) low++;
    }
    if (low > 2) issues.push(`lake ${li} leaks on ${low} rim points`);
  });
  if (issues.length) stats.bad.push(`seed ${seed} (${LZ.type}): ${issues.join('; ')}`);
}
const avg = (a) => (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1);
console.log(`${N} worlds from seed ${S0}: landings ${JSON.stringify(stats.types)}, notch ${stats.notch}, lake gates ${stats.lakeGate}, gold rings ${stats.gold}`);
console.log(`gates per world ${Math.min(...stats.gates)}-${Math.max(...stats.gates)} (avg ${avg(stats.gates)}), turns sharper than 60°: ${stats.sharp}/${stats.turns}`);
console.log(`worlds with issues: ${stats.bad.length}`);
for (const b of stats.bad.slice(0, 40)) console.log('  ' + b);
process.exitCode = stats.bad.length ? 1 : 0;
