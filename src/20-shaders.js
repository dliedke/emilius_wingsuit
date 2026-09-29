// ================================================================ SHADERS
// Shared uniforms (same objects referenced by every material)
const U = {
  uSunDir: { value: SUN_DIR.clone() },
  uSunCol: { value: new THREE.Color(0xfff0dc).multiplyScalar(3.3) },
  uSkyZenith: { value: new THREE.Color(0x2c64b4) },
  uSkyHorizon: { value: new THREE.Color(0xb9d2ea) },
  uHaze: { value: new THREE.Color(0xc6d4e1) },
  uSkyAmb: { value: new THREE.Color(0x9fc1ea).multiplyScalar(0.78) },
  uGround: { value: new THREE.Color(0x857a66).multiplyScalar(0.34) },
  uFogA: { value: 0.000085 },
  uFogB: { value: 1 / 2300 },
  uTime: { value: 0 },
  uNoise: { value: null },
  // main river: z0, amp1, period1, phase1 / amp2, period2, phase2
  uRiv0: { value: new THREE.Vector4(-5820, 180, 2600, 0.4) },
  uRiv1: { value: new THREE.Vector4(80, 1050, 1.7, 0) },
  // altitude bands: tree-line shift, snow-line shift (relative to the classic massif)
  uAlt: { value: new THREE.Vector4(0, 0, 0, 0) },
};

const COMMON_GLSL = /* glsl */`
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform vec3 uSkyZenith;
uniform vec3 uSkyHorizon;
uniform vec3 uHaze;
uniform vec3 uSkyAmb;
uniform vec3 uGround;
uniform float uFogA;
uniform float uFogB;
uniform float uTime;
uniform vec4 uRiv0;
uniform vec4 uRiv1;
vec3 skyColor(vec3 v) {
  float y = v.y;
  float t = pow(clamp(y, 0.0, 1.0), 0.42);
  vec3 c = mix(uSkyHorizon, uSkyZenith, t);
  c = mix(c, uHaze, smoothstep(0.03, -0.1, y));
  float sd = max(dot(v, uSunDir), 0.0);
  c += uSunCol * (0.018 * pow(sd, 5.0) + 0.05 * pow(sd, 48.0) + 0.12 * pow(sd, 700.0));
  return c;
}
vec3 hazeColor(vec3 v) {
  float sd = max(dot(v, uSunDir), 0.0);
  vec3 c = mix(uHaze, uSkyHorizon, 0.3 + 0.3 * clamp(v.y * 3.0, 0.0, 1.0));
  c += uSunCol * (0.035 * pow(sd, 4.0) + 0.05 * pow(sd, 24.0));
  return c;
}
float fogFactor(vec3 wp) {
  vec3 d = wp - cameraPosition;
  float dist = length(d);
  float vy = d.y / max(dist, 1e-3);
  float k = uFogB * vy;
  float base = uFogA * exp(-uFogB * cameraPosition.y);
  float od = abs(k) < 1e-6 ? base * dist : base * (1.0 - exp(-k * dist)) / k;
  return 1.0 - exp(-od);
}
vec3 applyFog(vec3 col, vec3 wp) {
  vec3 v = normalize(wp - cameraPosition);
  return mix(col, hazeColor(v), fogFactor(wp));
}
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float riverZ(float x) { return uRiv0.x + uRiv0.y * sin(x / uRiv0.z + uRiv0.w) + uRiv1.x * sin(x / uRiv1.y + uRiv1.z); }
// landing aids, drawn with a minimum on-screen size so they read from altitude:
// a dashed halo around the target, a target dot that never shrinks below a few
// pixels, and the predicted touchdown ring while under canopy
uniform vec4 uLZ;      // target x, z, halo radius, strength
uniform vec4 uPred;    // predicted touchdown x, z, radius, alpha
uniform vec3 uPredCol;
vec3 landingAids(vec3 lit, vec3 world, vec3 V) {
  if (uLZ.w <= 0.0 && uPred.w <= 0.0) return lit;
  vec2 wp = world.xz;
  float fw = max(length(fwidth(wp)), 1e-3) * 0.7;
  float fogK = fogFactor(world) * 0.4;
  vec3 hz = hazeColor(-V);
  vec2 dl = wp - uLZ.xy;
  float d = length(dl);
  if (uLZ.w > 0.0 && d < uLZ.z + 12.0 * fw + 4.0) {
    vec3 orange = mix(vec3(1.0, 0.36, 0.07) * 1.5, hz, fogK);
    vec3 white = mix(vec3(1.0, 0.97, 0.9) * 1.25, hz, fogK);
    float halfW = max(0.9, 1.2 * fw);
    float ring = 1.0 - smoothstep(halfW - fw * 0.5, halfW + fw * 0.5, abs(d - uLZ.z));
    float dash = step(0.4, fract(atan(dl.y, dl.x) / 6.2832 * 24.0 + uTime * 0.05));
    ring *= mix(dash, 1.0, smoothstep(1.2, 3.0, fw));
    float tint = (1.0 - smoothstep(uLZ.z - fw, uLZ.z, d)) * 0.13;
    float dotR = 6.0 * fw;
    float dotA = 1.0 - smoothstep(dotR - fw, dotR + fw, d);
    float core = 1.0 - smoothstep(dotR * 0.4 - fw, dotR * 0.4 + fw, d);
    lit = mix(lit, orange, clamp(tint + ring * 0.95, 0.0, 1.0) * uLZ.w);
    lit = mix(lit, mix(orange, white, core), dotA * uLZ.w);
  }
  if (uPred.w > 0.0) {
    vec2 dp = wp - uPred.xy;
    float dd = length(dp);
    float R = max(uPred.z, 13.0 * fw);
    float halfW = max(0.45, 1.5 * fw);
    float ring = 1.0 - smoothstep(halfW - fw * 0.5, halfW + fw * 0.5, abs(dd - R));
    float edgeO = 1.0 - smoothstep(halfW * 2.2 - fw * 0.5, halfW * 2.2 + fw * 0.5, abs(dd - R));
    float cR = max(0.9, 2.6 * fw);
    float cDot = 1.0 - smoothstep(cR - fw * 0.5, cR + fw * 0.5, dd);
    float cO = 1.0 - smoothstep(cR * 1.7 - fw * 0.5, cR * 1.7 + fw * 0.5, dd);
    // four ticks pointing inward
    float ang = atan(dp.y, dp.x);
    float tick = (1.0 - smoothstep(0.05, 0.1, abs(fract(ang / 1.5708 + 0.5) - 0.5))) * step(R * 0.5, dd) * step(dd, R);
    float fill = (1.0 - smoothstep(R - fw, R, dd)) * 0.16;
    vec3 pc = mix(uPredCol, hz, fogK);
    lit = mix(lit, pc, fill * uPred.w);
    lit = mix(lit, vec3(0.02, 0.03, 0.03), max(edgeO, cO) * 0.55 * uPred.w);
    lit = mix(lit, pc, clamp(ring + cDot + tick * 0.9, 0.0, 1.0) * uPred.w);
  }
  return lit;
}
`;

// --------------------------------------------------------------- terrain
const TERRAIN_VS = /* glsl */`
uniform sampler2D uHgt;
uniform vec2 uOrigin;
uniform float uCell;
uniform ivec2 uDims;
uniform float uSkirt;
uniform float uStep;
uniform vec2 uMorph;
uniform vec4 uHole;
uniform float uIsFar;
attribute vec2 aChunk;
varying vec3 vWorld;
varying vec3 vRel;   // world position relative to the camera: full float precision up close
varying vec2 vUV;
#include <common>
#include <logdepthbuf_pars_vertex>
float hf(ivec2 t) { return texelFetch(uHgt, clamp(t, ivec2(0), uDims - 1), 0).r; }
void main() {
  ivec2 g = ivec2(int(position.x), int(position.z));
  ivec2 t = min(ivec2(aChunk) + g, uDims - 1);
  float h = texelFetch(uHgt, t, 0).r;
  vec3 wp = vec3(uOrigin.x + float(t.x) * uCell, h, uOrigin.y + float(t.y) * uCell);
  // geomorph odd vertices onto the next coarser grid so LOD borders never crack
  float morph = smoothstep(uMorph.x, uMorph.y, distance(wp, cameraPosition));
  if (uIsFar > 0.5) {
    // keep the far terrain at full resolution where it meets the detailed corridor
    vec2 dd = max(max(uHole.xy - wp.xz, wp.xz - uHole.zw), 0.0);
    morph *= smoothstep(80.0, 260.0, length(dd));
  }
  if (morph > 0.0) {
    int s = int(uStep), s2 = s * 2;
    bool ox = (g.x % s2) != 0, oz = (g.y % s2) != 0;
    float hc = h;
    if (ox && oz) hc = 0.5 * (hf(t - ivec2(s, s)) + hf(t + ivec2(s, s)));
    else if (ox) hc = 0.5 * (hf(t - ivec2(s, 0)) + hf(t + ivec2(s, 0)));
    else if (oz) hc = 0.5 * (hf(t - ivec2(0, s)) + hf(t + ivec2(0, s)));
    wp.y = mix(h, hc, morph);
  }
  wp.y -= position.y * uSkirt;
  vWorld = wp;
  vRel = wp - cameraPosition;
  vUV = (vec2(t) + 0.5) / vec2(uDims);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  #include <logdepthbuf_vertex>
}
`;
const TERRAIN_FS = /* glsl */`
${COMMON_GLSL}
uniform sampler2D uNrm;
uniform sampler2D uSpl;
uniform sampler2D uNoise;
uniform float uIsFar;
uniform vec4 uHole;
uniform vec3 cRock, cRock2, cRockRed, cScree, cGrass, cMeadow, cForest, cSnow, cField1, cField2, cField3, cRoad;
uniform vec4 uC0; uniform vec3 uC0r; uniform vec3 uC0f; uniform vec3 uC0u;
uniform vec4 uC1; uniform vec3 uC1r; uniform vec3 uC1f; uniform vec3 uC1u; uniform vec2 uC1s;
uniform vec4 uAlt;
varying vec3 vWorld;
varying vec3 vRel;
varying vec2 vUV;
#include <logdepthbuf_pars_fragment>

float sdSeg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }
float sdTri(vec2 p, vec2 p0, vec2 p1, vec2 p2) {
  vec2 e0 = p1 - p0, e1 = p2 - p1, e2 = p0 - p2;
  vec2 v0 = p - p0, v1 = p - p1, v2 = p - p2;
  vec2 pq0 = v0 - e0 * clamp(dot(v0, e0) / dot(e0, e0), 0.0, 1.0);
  vec2 pq1 = v1 - e1 * clamp(dot(v1, e1) / dot(e1, e1), 0.0, 1.0);
  vec2 pq2 = v2 - e2 * clamp(dot(v2, e2) / dot(e2, e2), 0.0, 1.0);
  float s = sign(e0.x * e2.y - e0.y * e2.x);
  vec2 d = min(min(vec2(dot(pq0, pq0), s * (v0.x * e0.y - v0.y * e0.x)), vec2(dot(pq1, pq1), s * (v1.x * e1.y - v1.y * e1.x))), vec2(dot(pq2, pq2), s * (v2.x * e2.y - v2.y * e2.x)));
  return -sqrt(d.x) * sign(d.y);
}
float sdSuit(vec2 p) {
  p.x = abs(p.x);
  float body = sdSeg(p, vec2(0.0, -0.8), vec2(0.0, 0.86)) - 0.16;
  float arm = sdTri(p, vec2(0.1, 0.56), vec2(0.96, 0.4), vec2(0.1, -0.32));
  float leg = sdTri(p, vec2(0.0, -0.18), vec2(0.3, -0.36), vec2(0.15, -1.06));
  return min(body, min(arm, leg));
}
float caster(vec3 wp, vec4 c, vec3 r, vec3 f, vec3 u, vec2 size) {
  if (c.w < 0.5) return 1.0;
  float den = dot(uSunDir, u);
  if (abs(den) < 0.08) den = den < 0.0 ? -0.08 : 0.08;
  float t = dot(c.xyz - wp, u) / den;
  if (t <= 0.05) return 1.0;
  vec3 q = wp + uSunDir * t - c.xyz;
  vec2 lc = vec2(dot(q, r), dot(q, f));
  float blur = 0.0093 * t + 0.035;
  float d;
  if (c.w < 1.5) d = sdSuit(lc);
  else if (c.w < 2.5) { vec2 dd = abs(lc) - size; d = length(max(dd, 0.0)) + min(max(dd.x, dd.y), 0.0); }
  else d = length(lc) - size.x;
  float occ = 1.0 - smoothstep(-blur, blur, d);
  occ *= 1.0 - smoothstep(280.0, 650.0, t);
  return 1.0 - occ * 0.88;
}

vec3 TW;
vec4 tri4(vec3 p, float s, vec2 off) {
  vec4 a = texture2D(uNoise, p.xz * s + off);
  if (TW.y > 0.96) return a;
  return a * TW.y + texture2D(uNoise, p.zy * s + off + 0.21) * TW.x + texture2D(uNoise, p.xy * s + off + 0.53) * TW.z;
}

void main() {
  #include <logdepthbuf_fragment>
  if (uIsFar > 0.5 && vWorld.x > uHole.x && vWorld.x < uHole.z && vWorld.z > uHole.y && vWorld.z < uHole.w) discard;
  vec4 nt = texture2D(uNrm, vUV);
  // cliffs span few heightfield texels: use a smoother mip there to avoid blocky facets
  float cliff = smoothstep(0.3, 0.55, 1.0 - sqrt(max(0.0, 1.0 - dot(nt.rg * 2.0 - 1.0, nt.rg * 2.0 - 1.0))));
  if (cliff > 0.0) nt = mix(nt, texture2D(uNrm, vUV, 2.5), cliff * 0.85);
  vec3 N = vec3(nt.r * 2.0 - 1.0, 0.0, nt.g * 2.0 - 1.0);
  N.y = sqrt(max(0.0, 1.0 - dot(N.xz, N.xz)));
  float sunVis = nt.b, ao = mix(nt.a, 0.85, cliff * 0.5);
  vec4 sp = texture2D(uSpl, vUV);
  float dist = distance(vWorld, cameraPosition);
  vec2 wp = vWorld.xz;
  float fNear = 1.0 - smoothstep(120.0, 1500.0, dist);
  float fMid = 1.0 - smoothstep(1500.0, 9000.0, dist);
  TW = pow(abs(N), vec3(4.0)); TW /= (TW.x + TW.y + TW.z);
  vec4 n0 = tri4(vWorld, 1.0 / 9.0, vec2(0.13));
  vec4 n1 = tri4(vWorld, 1.0 / 41.0, vec2(0.0));
  vec4 n2 = tri4(vWorld, 1.0 / 233.0, vec2(0.37));
  vec4 n3 = texture2D(uNoise, wp * (1.0 / 1530.0) + 0.71);
  float slope = 1.0 - N.y;
  // bump: layered noise heights (m), turned into a normal with screen derivatives
  // each layer only where its noise texels are no bigger than a pixel or two: magnified
  // up close, their fine octaves tilt the normal by tens of degrees per texel, which
  // turned the ground next to the camera black and speckled
  float f0 = smoothstep(6.0, 25.0, dist) * (1.0 - smoothstep(25.0, 240.0, dist));
  float f1 = smoothstep(40.0, 110.0, dist) * fNear, f2 = smoothstep(200.0, 600.0, dist) * fMid;
  float hb = (n0.r - 0.5) * 0.35 * f0 + (n1.r - 0.5) * 3.0 * f1 + (n2.r - 0.5) * 16.0 * f2;
  hb *= 0.35 + 0.65 * smoothstep(0.05, 0.5, slope);
  // screen derivatives of the camera-relative position: world coordinates (thousands of
  // metres) are too coarse for the millimetre steps between pixels next to the camera,
  // which flipped the bumped normal into dark speckles and rings
  vec3 dpx = dFdx(vRel), dpy = dFdy(vRel);
  float dhx = dFdx(hb), dhy = dFdy(hb);
  vec3 r1 = cross(dpy, N), r2 = cross(N, dpx);
  float det = dot(dpx, r1);
  vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
  vec3 Nd = normalize(abs(det) * N - grad);
  if (dot(Nd, N) < 0.2) Nd = N;
  float h = vWorld.y;
  float nA = n2.r, nB = n3.r, nC = n1.r, nD = n0.r;
  // rock: layered schist with iron-oxide bands
  float strata = sin(h * 0.21 + nA * 7.0 + nB * 11.0);
  vec3 rock = mix(cRock, cRock2, smoothstep(0.35, 0.75, nA + 0.2 * strata));
  rock = mix(rock, cRockRed, smoothstep(0.58, 0.85, nB + 0.18 * n1.a) * 0.7);
  rock *= 0.62 + 0.46 * (strata * 0.5 + 0.5) * (0.4 + nC) + 0.3 * (nD - 0.5);
  rock *= 0.75 + 0.5 * smoothstep(0.25, 0.75, n1.a);
  vec3 scree = mix(cScree, cRockRed * 1.2, 0.3 * smoothstep(0.5, 0.85, nB)) * (0.82 + 0.3 * nC + 0.22 * (nD - 0.5));
  float hT = h - uAlt.x, hS = h - uAlt.y;
  vec3 grass = mix(cMeadow, cGrass, smoothstep(1350.0, 2250.0, hT + (nB - 0.5) * 500.0));
  grass = mix(grass, cMeadow * (0.85 + 0.3 * nA), sp.a * 0.75);   // lush pasture: river banks, around a landing
  grass *= 0.8 + 0.35 * nC + 0.12 * (nD - 0.5);
  float highW = smoothstep(2050.0, 2550.0, hT + (nB - 0.5) * 500.0);
  float alpineBare = smoothstep(2650.0, 2950.0, hS + (nB - 0.5) * 300.0 + (nC - 0.5) * 120.0);
  float rockW = smoothstep(0.27 - 0.07 * highW, 0.4 - 0.08 * highW, slope + (nA - 0.5) * 0.22 + (nC - 0.5) * 0.12);
  float screeW = clamp(max(max(sp.b * 1.2, highW * smoothstep(0.05, 0.14, slope + (nC - 0.5) * 0.12)), alpineBare), 0.0, 1.0);
  rockW = max(rockW, alpineBare * smoothstep(0.55, 0.8, nA + nD * 0.3) * 0.8);
  vec3 col = mix(grass, scree, screeW);
  col = mix(col, rock, rockW);
  vec3 forestC = mix(cForest * (0.7 + 0.55 * nC), cForest * 1.25 + cMeadow * 0.12, smoothstep(600.0, 5000.0, dist));
  col = mix(col, forestC, sp.r * (1.0 - rockW * 0.7));
  // valley floor: fields, hedges, roads, gravel banks
  float dr = vWorld.z - riverZ(vWorld.x);
  float floorW = (1.0 - smoothstep(600.0, 820.0, abs(dr))) * (1.0 - smoothstep(0.02, 0.06, slope));
  if (floorW > 0.002) {
    vec2 q = mat2(0.94, -0.34, 0.34, 0.94) * wp;
    vec2 fq = q / vec2(96.0, 58.0) + vec2(nB, nA) * 0.9;
    vec2 cid = floor(fq);
    float r = hash12(cid);
    vec3 fc = r < 0.4 ? cField1 : (r < 0.75 ? cField2 : cField3);
    fc *= 0.85 + 0.3 * hash12(cid + 7.1) + 0.14 * (nC - 0.5);
    vec2 fr = fract(fq);
    float edge = min(min(fr.x, 1.0 - fr.x) * 96.0, min(fr.y, 1.0 - fr.y) * 58.0);
    fc = mix(cForest * 1.4, fc, smoothstep(0.6, 2.6, edge));
    col = mix(col, fc, floorW * (1.0 - sp.r));
    float r1 = abs(dr + 380.0 - 60.0 * sin(vWorld.x / 1400.0));
    float r2 = abs(dr - 260.0 - 40.0 * sin(vWorld.x / 2100.0));
    float road = max(1.0 - smoothstep(3.0, 4.6, r1), 1.0 - smoothstep(5.5, 7.6, r2));
    col = mix(col, cRoad * (0.88 + 0.24 * nD), road * floorW);
    col = mix(col, cScree * 1.2, (1.0 - smoothstep(13.0, 26.0, abs(dr))) * floorW);
  }
  // fine grain up close (gravel, lichen)
  if (dist < 90.0) {
    vec4 nf = tri4(vWorld, 1.0 / 1.9, vec2(0.61));
    col *= mix(1.0, 0.72 + 0.56 * nf.r, 1.0 - smoothstep(20.0, 90.0, dist));
  }
  float snow = clamp(sp.g + (nD - 0.5) * 0.3 * sp.g, 0.0, 1.0);
  col = mix(col, cSnow, snow);
  // lighting
  float ndl = max(dot(Nd, uSunDir), 0.0);
  float shP = 1.0;
  if (uIsFar < 0.5) shP = caster(vWorld, uC0, uC0r, uC0f, uC0u, vec2(0.0)) * caster(vWorld, uC1, uC1r, uC1f, uC1u, uC1s);
  vec3 sunL = uSunCol * ndl * sunVis * shP;
  vec3 ambL = mix(uGround, uSkyAmb, Nd.y * 0.5 + 0.5) * (ao * ao);
  vec3 lit = col * (sunL + ambL);
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 Hh = normalize(V + uSunDir);
  float nh = max(dot(Nd, Hh), 0.0);
  lit += uSunCol * (snow * pow(nh, 60.0) * 0.22 + rockW * pow(nh, 18.0) * 0.025) * sunVis * shP;
  lit = applyFog(lit, vWorld);
  lit = landingAids(lit, vWorld, V);
  gl_FragColor = vec4(lit, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// ------------------------------------------------------------------ trees
const TREE_VS = /* glsl */`
uniform sampler2D uNrm;
uniform vec2 uOrigin;
uniform float uCell;
uniform vec2 uDimsF;
uniform float uTime;
uniform float uFar;
attribute vec4 aTree;   // base xyz, height
attribute vec2 aVar;    // variation, kind
varying vec3 vWorld;
varying vec3 vN;
varying float vH;
varying float vVar;
varying float vKind;
varying float vSun;
#include <common>
#include <logdepthbuf_pars_vertex>
void main() {
  float a = aVar.x * 6.2831;
  float c = cos(a), s = sin(a);
  vec3 p = position;
  float wid = aVar.y > 1.5 ? 0.62 : (aVar.y > 0.5 ? 0.3 : 0.34);
  p.xz *= wid * (0.85 + 0.3 * fract(aVar.x * 7.3));
  p.xz = mat2(c, -s, s, c) * p.xz;
  float dcam = distance(aTree.xyz, cameraPosition);
  float fade = 1.0 - smoothstep(uFar * 0.7, uFar, dcam);
  vec3 wp = aTree.xyz + p * aTree.w * fade;
  float sway = sin(uTime * 1.1 + aTree.x * 0.05 + aTree.z * 0.07) * 0.012 * position.y * position.y * aTree.w;
  wp.x += sway; wp.z += sway * 0.6;
  vec3 n = normal; n.xz = mat2(c, -s, s, c) * n.xz;
  vN = n;
  vH = position.y;
  vVar = aVar.x;
  vKind = aVar.y;
  vec2 uv = ((aTree.xz - uOrigin) / uCell + 0.5) / uDimsF;
  vSun = texture2D(uNrm, uv).b;
  vWorld = wp;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  #include <logdepthbuf_vertex>
}
`;
const TREE_FS = /* glsl */`
${COMMON_GLSL}
uniform vec3 cSpruce, cLarch, cLeaf, cTrunk;
varying vec3 vWorld;
varying vec3 vN;
varying float vH;
varying float vVar;
varying float vKind;
varying float vSun;
#include <logdepthbuf_pars_fragment>
void main() {
  #include <logdepthbuf_fragment>
  vec3 N = normalize(vN);
  vec3 base = vKind > 1.5 ? cLeaf : (vKind > 0.5 ? cLarch : cSpruce);
  base *= 0.72 + 0.5 * fract(vVar * 13.7);
  if (vH < 0.06) base = cTrunk;
  float ao = 0.35 + 0.65 * smoothstep(0.0, 0.9, vH);
  float ndl = max(dot(N, uSunDir), 0.0) * 0.75 + 0.25;
  vec3 lit = base * (uSunCol * ndl * vSun * 0.95 + mix(uGround, uSkyAmb, N.y * 0.5 + 0.5) * 1.3) * ao;
  lit = applyFog(lit, vWorld);
  gl_FragColor = vec4(lit, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// ------------------------------------------------------------------ water
const WATER_VS = /* glsl */`
varying vec3 vWorld;
#include <common>
#include <logdepthbuf_pars_vertex>
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
  #include <logdepthbuf_vertex>
}
`;
const WATER_FS = /* glsl */`
${COMMON_GLSL}
uniform sampler2D uNoise;
uniform sampler2D uHgt;
uniform vec2 uOrigin;
uniform float uCell;
uniform ivec2 uDims;
uniform float uLevel;
uniform float uRiver;
uniform vec4 uLake;    // x, z, radius along the axis, length / width
uniform vec2 uLakeDir;
uniform vec3 cDeep, cShallow;
varying vec3 vWorld;
#include <logdepthbuf_pars_fragment>
float hAt(vec2 p) {
  vec2 f = (p - uOrigin) / uCell;
  ivec2 i = ivec2(floor(f));
  vec2 t = fract(f);
  ivec2 m = uDims - 1;
  float a = texelFetch(uHgt, clamp(i, ivec2(0), m), 0).r;
  float b = texelFetch(uHgt, clamp(i + ivec2(1, 0), ivec2(0), m), 0).r;
  float c = texelFetch(uHgt, clamp(i + ivec2(0, 1), ivec2(0), m), 0).r;
  float d = texelFetch(uHgt, clamp(i + ivec2(1, 1), ivec2(0), m), 0).r;
  return mix(mix(a, b, t.x), mix(c, d, t.x), t.y);
}
void main() {
  #include <logdepthbuf_fragment>
  vec2 wp = vWorld.xz;
  vec2 flow = uRiver > 0.5 ? vec2(uTime * 0.6, 0.0) : vec2(uTime * 0.9, uTime * 0.5);
  vec4 a = texture2D(uNoise, (wp + flow) / 19.0);
  vec4 b = texture2D(uNoise, (wp - flow * 0.7) / 53.0 + 0.3);
  vec4 c = texture2D(uNoise, wp / 170.0 + uTime * 0.002);
  vec3 N = normalize(vec3((a.g - 0.5) * 0.3 + (b.g - 0.5) * 0.35 + (c.g - 0.5) * 0.4, 1.0, (a.b - 0.5) * 0.3 + (b.b - 0.5) * 0.35 + (c.b - 0.5) * 0.4));
  vec3 V = normalize(cameraPosition - vWorld);
  float fres = 0.025 + 0.975 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  vec3 R = reflect(-V, N); R.y = abs(R.y);
  vec3 refl = skyColor(R) * 0.95;
  float depth = uRiver > 0.5 ? 2.0 : max(uLevel - hAt(wp), 0.0);
  vec3 body = mix(cShallow, cDeep, smoothstep(0.6, 16.0, depth));
  body *= uSunCol * 0.24 + uSkyAmb * 0.8;
  vec3 col = mix(body, refl, fres);
  float spec = pow(max(dot(R, uSunDir), 0.0), 420.0) * 2.6 + pow(max(dot(R, uSunDir), 0.0), 40.0) * 0.06;
  col += uSunCol * spec;
  float alpha = uRiver > 0.5 ? 0.92 : smoothstep(0.0, 1.4, depth) * 0.96;
  if (uRiver < 0.5) {
    vec2 q = wp - uLake.xy;
    float u = dot(q, uLakeDir), v = (q.y * uLakeDir.x - q.x * uLakeDir.y) * uLake.w;
    alpha *= 1.0 - smoothstep(uLake.z + 2.0, uLake.z + 10.0, length(vec2(u, v)));
  }
  col = applyFog(col, vWorld);
  col = landingAids(col, vWorld, V);
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// -------------------------------------------------------------------- sky
const SKY_VS = /* glsl */`
varying vec3 vDir;
#include <common>
#include <logdepthbuf_pars_vertex>
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}
`;
const SKY_FS = /* glsl */`
${COMMON_GLSL}
uniform sampler2D uNoise;
varying vec3 vDir;
#include <logdepthbuf_pars_fragment>
void main() {
  #include <logdepthbuf_fragment>
  vec3 v = normalize(vDir);
  vec3 col = skyColor(v);
  float sd = dot(v, uSunDir);
  col += uSunCol * smoothstep(0.99993, 0.999965, sd) * 14.0;
  if (v.y > 0.0) {
    vec2 uv = v.xz / (v.y + 0.08);
    float c1 = texture2D(uNoise, uv * 0.11 + vec2(uTime * 0.0004, 0.0)).r;
    float c2 = texture2D(uNoise, uv * 0.43 + vec2(0.3, uTime * 0.0007)).a;
    float cir = smoothstep(0.52, 0.8, c1 * 0.75 + c2 * 0.4) * smoothstep(0.02, 0.25, v.y) * 0.55;
    vec3 cc = mix(uSkyHorizon * 1.15, uSunCol * 0.45, 0.35 + 0.5 * pow(max(sd, 0.0), 6.0));
    col = mix(col, cc, cir);
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// ----------------------------------------------------------------- clouds
const CLOUD_VS = /* glsl */`
attribute vec4 aPuff;   // world centre, size
attribute vec4 aInfo;   // atlas index, rotation, sun shade, opacity
varying vec2 vUv;
varying float vShade;
varying float vAlpha;
varying float vIdx;
varying vec3 vWorld;
#include <common>
#include <logdepthbuf_pars_vertex>
void main() {
  vec3 camR = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 camU = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  float c = cos(aInfo.y), s = sin(aInfo.y);
  float stretch = 1.0 + fract(aInfo.x) * 3.2;
  vec2 p = mat2(c, -s, s, c) * position.xy;
  p.x *= stretch;
  vec3 wp = aPuff.xyz + (camR * p.x + camU * p.y) * aPuff.w;
  vWorld = wp;
  vUv = uv;
  vShade = aInfo.z;
  vIdx = floor(aInfo.x);
  float d = distance(aPuff.xyz, cameraPosition);
  vAlpha = aInfo.w * smoothstep(aPuff.w * 0.25, aPuff.w * 1.05, d);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  #include <logdepthbuf_vertex>
}
`;
const CLOUD_FS = /* glsl */`
${COMMON_GLSL}
uniform sampler2D uTex;
varying vec2 vUv;
varying float vShade;
varying float vAlpha;
varying float vIdx;
varying vec3 vWorld;
#include <logdepthbuf_pars_fragment>
void main() {
  #include <logdepthbuf_fragment>
  // vIdx is a whole number per puff, but interpolation can hand back 1.9999999:
  // round it, or neighbouring pixels pick different atlas tiles (blinking blocks)
  float idx = floor(vIdx + 0.5);
  vec2 auv = (vUv + vec2(mod(idx, 2.0), floor(idx * 0.5))) * 0.5;
  vec4 t = texture2D(uTex, auv);
  // a round fade inside the quad: whatever the mip level, never a straight edge
  float a = t.a * vAlpha * (1.0 - smoothstep(0.36, 0.47, length(vUv - 0.5)));
  if (a < 0.004) discard;
  float lit = clamp(vShade * 0.8 + (t.r - 0.5) * 0.7 + 0.1, 0.0, 1.0);
  vec3 col = mix(uSkyAmb * 1.05 + uGround * 0.4, uSunCol * 0.62 + uSkyAmb * 0.35, lit);
  vec3 v = normalize(vWorld - cameraPosition);
  col += uSunCol * 0.08 * pow(max(dot(v, uSunDir), 0.0), 8.0) * (1.0 - t.a);
  col = mix(col, hazeColor(v), fogFactor(vWorld) * 0.9);
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// ------------------------------------------------------------------- gates
const GATE_VS = /* glsl */`
varying vec3 vWorld;
varying vec3 vN;
varying vec2 vUv;
#include <common>
#include <logdepthbuf_pars_vertex>
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * wp;
  #include <logdepthbuf_vertex>
}
`;
const GATE_FS = /* glsl */`
${COMMON_GLSL}
uniform vec3 uColA;
uniform vec3 uColB;
uniform float uGlow;
uniform float uFade;
varying vec3 vWorld;
varying vec3 vN;
varying vec2 vUv;
#include <logdepthbuf_pars_fragment>
void main() {
  #include <logdepthbuf_fragment>
  float seg = step(0.5, fract(vUv.x * 12.0));
  vec3 base = mix(uColA, uColB, seg);
  vec3 V = normalize(cameraPosition - vWorld);
  float rim = pow(1.0 - abs(dot(normalize(vN), V)), 2.0);
  vec3 col = base * (0.6 + 1.6 * uGlow) + base * rim * 1.5 * uGlow;
  float fog = fogFactor(vWorld);
  col = mix(col, hazeColor(-V), fog * 0.7);
  gl_FragColor = vec4(col, uFade);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// ------------------------------------------------------------------ birds
// Instanced: position + scale, heading / pitch / bank / flap phase, kind + flap amplitude.
// aWing: 0 on the body, 1 on the inner wing, 2 on the outer wing (bends more).
const BIRD_VS = /* glsl */`
attribute vec4 aP;
attribute vec4 aQ;
attribute vec2 aK;
attribute float aWing;
uniform float uPx;
varying vec3 vWorld;
varying float vKind;
varying float vUp;
#include <common>
#include <logdepthbuf_pars_vertex>
void main() {
  vec3 p = position;
  if (aWing > 0.5) {
    float flap = sin(aQ.w) * aK.y;
    float th = flap * (aWing > 1.5 ? 1.45 : 1.0);
    float ax = abs(p.x);
    p.y += sin(th) * ax;
    p.x = sign(p.x) * cos(th) * ax;
  }
  vUp = p.y;
  // bank (z), pitch (x), heading (y)
  float cb = cos(aQ.z), sb = sin(aQ.z), cp = cos(aQ.y), sp = sin(aQ.y), ch = cos(aQ.x), sh = sin(aQ.x);
  p = vec3(p.x * cb - p.y * sb, p.x * sb + p.y * cb, p.z);
  p = vec3(p.x, p.y * cp - p.z * sp, p.y * sp + p.z * cp);
  p = vec3(p.x * ch - p.z * sh, p.y, p.x * sh + p.z * ch);   // nose (-z) turns to (sin h, 0, -cos h)
  // never narrower than a few pixels (more for raptors, fewer far away), so the flocks read
  float d = distance(aP.xyz, cameraPosition);
  float sc = max(aP.w, d * uPx * (aK.x > 0.5 ? 13.0 : 8.0) * mix(1.0, 0.45, smoothstep(300.0, 1500.0, d)));
  vec3 wp = aP.xyz + p * sc;
  vWorld = wp;
  vKind = aK.x;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  #include <logdepthbuf_vertex>
}
`;
const BIRD_FS = /* glsl */`
${COMMON_GLSL}
varying vec3 vWorld;
varying float vKind;
varying float vUp;
#include <logdepthbuf_pars_fragment>
void main() {
  #include <logdepthbuf_fragment>
  vec3 N = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  if (dot(N, cameraPosition - vWorld) < 0.0) N = -N;
  vec3 base = vKind > 0.5 ? mix(vec3(0.1, 0.07, 0.045), vec3(0.3, 0.21, 0.13), smoothstep(-0.05, 0.1, vUp)) : vec3(0.035, 0.035, 0.04);
  float ndl = max(dot(N, uSunDir), 0.0);
  vec3 lit = base * (uSunCol * (0.25 + 0.75 * ndl) * 0.6 + mix(uGround, uSkyAmb, N.y * 0.5 + 0.5) * 1.1);
  lit = applyFog(lit, vWorld);
  gl_FragColor = vec4(lit, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// ------------------------------------------------------------ smoke trail
const TRAIL_VS = /* glsl */`
attribute float aAge;
varying float vAge;
varying vec2 vUv;
varying vec3 vWorld;
#include <common>
#include <logdepthbuf_pars_vertex>
void main() {
  vAge = aAge;
  vUv = uv;
  vWorld = position;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}
`;
const TRAIL_FS = /* glsl */`
${COMMON_GLSL}
uniform sampler2D uNoise;
uniform vec3 uColor;
varying float vAge;
varying vec2 vUv;
varying vec3 vWorld;
#include <logdepthbuf_pars_fragment>
void main() {
  #include <logdepthbuf_fragment>
  float across = 1.0 - pow(abs(vUv.y * 2.0 - 1.0), 1.6);
  float n = texture2D(uNoise, vec2(vUv.x * 3.0 - uTime * 0.05, vUv.y * 0.7 + vAge * 0.5)).r;
  float a = across * (1.0 - smoothstep(0.1, 1.0, vAge)) * smoothstep(0.0, 0.03, vAge) * (0.55 + 0.7 * n);
  a *= 0.62;
  if (a < 0.003) discard;
  vec3 col = uColor * (uSunCol * 0.32 + uSkyAmb * 0.85) * (0.8 + 0.3 * n);
  col = applyFog(col, vWorld);
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// ------------------------------------------------- landing-zone smoke column
// fully GPU-animated: every puff's age comes from time + its seed
const SMOKE_VS = /* glsl */`
uniform float uTime;
uniform vec3 uBase;
uniform vec3 uWind;
uniform float uLife;
attribute vec4 aSeed;   // phase, swirl angle, size, spin
varying vec2 vUv;
varying float vA;
varying float vT;
varying vec3 vWorld;
#include <common>
#include <logdepthbuf_pars_vertex>
void main() {
  float age = fract(uTime / uLife + aSeed.x);
  float t = age * uLife;
  float rise = 9.5 * t - 0.21 * t * t;
  float sw = aSeed.y * 6.2832;
  vec3 c = uBase + vec3(0.0, 0.8 + rise, 0.0) + uWind * t * (0.5 + 0.07 * t)
         + vec3(sin(sw + t * 0.7), 0.0, cos(sw + t * 0.55)) * (0.4 + t * 0.4);
  float d = distance(c, cameraPosition);
  // puffs never get thinner than a few pixels, so the column reads from far away
  float size = max((1.6 + t * 1.5) * (0.75 + 0.5 * aSeed.z), d * 0.009 * (0.8 + 0.4 * aSeed.z));
  vec3 camR = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 camU = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  float a = aSeed.w * 6.2832 + t * (aSeed.w - 0.5) * 0.6;
  vec2 p = mat2(cos(a), -sin(a), sin(a), cos(a)) * position.xy;
  vec3 wp = c + (camR * p.x + camU * p.y) * size;
  vWorld = wp;
  vUv = uv;
  vT = age;
  vA = smoothstep(0.0, 0.04, age) * (1.0 - smoothstep(0.5, 1.0, age)) * smoothstep(size * 0.6, size * 2.0, d);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  #include <logdepthbuf_vertex>
}
`;
const SMOKE_FS = /* glsl */`
${COMMON_GLSL}
uniform sampler2D uNoise;
varying vec2 vUv;
varying float vA;
varying float vT;
varying vec3 vWorld;
#include <logdepthbuf_pars_fragment>
void main() {
  #include <logdepthbuf_fragment>
  vec2 q = vUv * 2.0 - 1.0;
  float r2 = dot(q, q);
  if (r2 > 1.0) discard;
  float n = texture2D(uNoise, vUv * 0.6 + vT * 0.3).r;
  float a = pow(1.0 - r2, 1.3) * (0.55 + 0.75 * n) * vA * mix(0.95, 0.6, vT);
  if (a < 0.004) discard;
  // dense orange near the flare, paler and cooler as it spreads
  vec3 base = mix(vec3(1.0, 0.33, 0.05), vec3(1.0, 0.55, 0.32), smoothstep(0.15, 0.9, vT));
  float lit = 0.55 + 0.45 * clamp(-q.y * 0.6 + q.x * 0.3 + 0.5, 0.0, 1.0);
  vec3 col = base * (uSunCol * 0.24 * lit + uSkyAmb * 0.5);
  vec3 v = normalize(vWorld - cameraPosition);
  col = mix(col, hazeColor(v), fogFactor(vWorld) * 0.35);
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// Inject the atmospheric fog into built-in materials (before tone mapping)
function patchFog(mat) {
  mat.onBeforeCompile = (sh) => {
    for (const k of ['uSunDir', 'uSunCol', 'uSkyZenith', 'uSkyHorizon', 'uHaze', 'uSkyAmb', 'uGround', 'uFogA', 'uFogB', 'uTime']) sh.uniforms[k] = U[k];
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFogWorld;')
      .replace('#include <fog_vertex>', `#include <fog_vertex>
      #ifdef USE_INSTANCING
        vFogWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
      #else
        vFogWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
      #endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + COMMON_GLSL + '\nvarying vec3 vFogWorld;')
      .replace('#include <tonemapping_fragment>', 'gl_FragColor.rgb = applyFog(gl_FragColor.rgb, vFogWorld);\n#include <tonemapping_fragment>');
  };
  return mat;
}
