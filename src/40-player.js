// ================================================================ PLAYER
// Wingsuit pilot + ram-air canopy, procedurally built and posed every frame.
// Body frame: +X right, +Y back (up in flight), -Z towards the head.
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const POSE_STAND = {
  head: V3(0, 0.02, -0.78), neck: V3(0, 0, -0.6), sh: V3(0.19, 0, -0.52), el: V3(0.24, -0.02, -0.24), ha: V3(0.25, -0.04, 0.02),
  hip: V3(0.11, 0, 0.13), kn: V3(0.12, -0.02, 0.52), ft: V3(0.13, 0, 0.9),
};
const POSE_FLY = {
  head: V3(0, 0.03, -0.8), neck: V3(0, 0, -0.6), sh: V3(0.19, 0, -0.52), el: V3(0.53, 0.02, -0.46), ha: V3(0.9, 0.03, -0.4),
  hip: V3(0.11, 0, 0.13), kn: V3(0.21, 0.01, 0.52), ft: V3(0.27, 0.03, 0.92),
};
const POSE_HANG = { // under canopy, hands up on the toggles
  head: V3(0, 0.03, -0.78), neck: V3(0, 0, -0.6), sh: V3(0.19, 0, -0.52), el: V3(0.33, -0.06, -0.8), ha: V3(0.3, -0.08, -1.05),
  hip: V3(0.11, 0, 0.13), kn: V3(0.13, -0.16, 0.5), ft: V3(0.14, -0.1, 0.9),
};

function suitTexture() {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 128;
  const g = cv.getContext('2d');
  g.fillStyle = '#e8edf0'; g.fillRect(0, 0, 256, 128);
  g.fillStyle = '#7fb3e4'; g.fillRect(0, 0, 256, 26);            // leading-edge band
  g.fillStyle = '#ff6b1a'; g.fillRect(0, 26, 256, 5);
  g.fillStyle = '#c9d3da';
  for (let i = 0; i < 8; i++) g.fillRect(i * 32 + 14, 30, 2, 98); // inflation ribs
  g.fillStyle = '#2a2f36'; g.fillRect(0, 120, 256, 8);            // trailing edge binding
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
function canopyTexture() {
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 128;
  const g = cv.getContext('2d');
  const cells = 9;
  for (let c = 0; c < cells; c++) {
    const x0 = (c / cells) * 512, w = 512 / cells;
    const center = Math.abs(c - 4);
    g.fillStyle = center === 0 ? '#f2efe8' : center % 2 === 1 ? '#ff6b1a' : '#1d1f24';
    g.fillRect(x0, 0, w + 1, 128);
  }
  g.fillStyle = 'rgba(0,0,0,0.25)';
  for (let c = 0; c <= cells; c++) g.fillRect((c / cells) * 512 - 1, 0, 2, 128);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

class Jumper {
  constructor() {
    this.root = new THREE.Group();
    const suit = stdMat({ color: 0xe9eef2, roughness: 0.62 });
    const dark = stdMat({ color: 0x17191c, roughness: 0.7 });
    const glove = stdMat({ color: 0x23272d, roughness: 0.8 });
    const wingMat = stdMat({ map: suitTexture(), roughness: 0.58, side: THREE.DoubleSide });
    this.mats = { suit, dark, wingMat };
    const add = (m) => { m.castShadow = false; this.root.add(m); return m; };
    // torso
    const torso = add(new THREE.Mesh(new THREE.CapsuleGeometry(0.155, 0.46, 6, 14), suit));
    torso.rotation.x = Math.PI / 2; torso.scale.set(1.2, 1, 0.74); torso.position.set(0, 0, -0.23);
    const pelvis = add(new THREE.Mesh(new THREE.SphereGeometry(0.15, 14, 10), suit));
    pelvis.scale.set(1.15, 0.72, 1.0); pelvis.position.set(0, 0, 0.08);
    // container on the back
    const cont = add(new THREE.Mesh(new THREE.SphereGeometry(1, 18, 12), dark));
    cont.scale.set(0.17, 0.075, 0.27); cont.position.set(0, 0.12, -0.22);
    // helmet, visor, camera
    this.head = new THREE.Group(); this.root.add(this.head);
    const helm = new THREE.Mesh(new THREE.SphereGeometry(0.125, 18, 14), dark); this.head.add(helm);
    const visor = new THREE.Mesh(new THREE.SphereGeometry(0.128, 18, 10, -1.2, 2.4, 1.2, 0.75), stdMat({ color: 0x0f1a24, roughness: 0.15, metalness: 0.6 }));
    visor.rotation.set(Math.PI / 2 + 0.2, 0, Math.PI); this.head.add(visor);
    const cam = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, 0.06), stdMat({ color: 0x1f8f4e, roughness: 0.5 }));
    cam.position.set(0, 0.13, -0.02); this.head.add(cam);
    // limbs
    this.limbs = {};
    const limb = (name, r, mat) => { const m = add(new THREE.Mesh(new THREE.CapsuleGeometry(r, 1, 4, 10), mat)); this.limbs[name] = m; return m; };
    for (const s of ['L', 'R']) {
      limb('ua' + s, 0.052, suit); limb('fa' + s, 0.045, suit); limb('th' + s, 0.07, suit); limb('sh' + s, 0.055, suit);
      const hand = add(new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), glove)); this.limbs['hand' + s] = hand;
      const shoe = add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.09, 0.2), dark)); this.limbs['shoe' + s] = shoe;
    }
    // wing membranes (top + bottom skins)
    this.wings = [];
    const wing = (nu, nv) => {
      const g = new THREE.BufferGeometry();
      const n = (nu + 1) * (nv + 1);
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      const uv = new Float32Array(n * 2);
      for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) { uv[(j * (nu + 1) + i) * 2] = i / nu; uv[(j * (nu + 1) + i) * 2 + 1] = 1 - j / nv; }
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      const idx = [];
      for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
      g.setIndex(idx);
      const m = add(new THREE.Mesh(g, wingMat));
      m.frustumCulled = false;
      return { g, m, nu, nv };
    };
    for (const s of ['L', 'R']) this.wings.push({ side: s, top: wing(10, 6), bot: wing(10, 6), kind: 'arm' });
    this.legWing = { top: wing(6, 8), bot: wing(6, 8) };
    this.J = {};
    for (const k of Object.keys(POSE_FLY)) this.J[k] = new THREE.Vector3();
    this._a = new THREE.Vector3(); this._b = new THREE.Vector3(); this._q = new THREE.Quaternion();
    this.pose = { fly: 0, hang: 0, roll: 0, pitch: 0, speed: 0, brakeL: 0, brakeR: 0, t: 0 };
  }
  setLimb(m, a, b) {
    const d = this._a.subVectors(b, a);
    const L = d.length();
    m.position.addVectors(a, b).multiplyScalar(0.5);
    this._q.setFromUnitVectors(V3(0, 1, 0), d.divideScalar(L || 1));
    m.quaternion.copy(this._q);
    m.scale.set(1, L, 1);
  }
  joints() {
    const P = this.pose, J = this.J;
    const wF = P.fly, wH = P.hang, wS = Math.max(0, 1 - wF - wH);
    for (const k of Object.keys(J)) {
      J[k].set(0, 0, 0).addScaledVector(POSE_STAND[k], wS).addScaledVector(POSE_FLY[k], wF).addScaledVector(POSE_HANG[k], wH);
    }
    return J;
  }
  side(v, s) { return s === 'L' ? this._b.set(-v.x, v.y, v.z) : this._b.copy(v); }
  update(dt) {
    const P = this.pose;
    P.t += dt;
    const J = this.joints();
    const sp = smoothstep(10, 60, P.speed);
    const flut = (i) => Math.sin(P.t * (26 + i * 3) + i * 1.7) * 0.006 * (0.3 + sp);
    // per-side joint positions with control deflection
    const pts = {};
    for (const s of ['L', 'R']) {
      const sg = s === 'L' ? -1 : 1;
      const roll = P.roll * sg;               // +1: this side dips
      const sh = this.side(J.sh, s).clone();
      const el = this.side(J.el, s).clone();
      const ha = this.side(J.ha, s).clone();
      const hip = this.side(J.hip, s).clone();
      const kn = this.side(J.kn, s).clone();
      const ft = this.side(J.ft, s).clone();
      // wingsuit steering: dip one shoulder, sweep arms with pitch
      ha.y += (-roll * 0.1 + flut(1)) * P.fly; el.y -= roll * 0.05 * P.fly;
      ha.z += (P.pitch * 0.1) * P.fly; el.z += P.pitch * 0.05 * P.fly;
      ft.y += (-roll * 0.05 + flut(2)) * P.fly;
      // canopy toggles: pull hands down
      const brake = s === 'L' ? P.brakeL : P.brakeR;
      ha.z += brake * 0.62 * P.hang; el.z += brake * 0.3 * P.hang; ha.y -= brake * 0.12 * P.hang;
      pts[s] = { sh, el, ha, hip, kn, ft };
      this.setLimb(this.limbs['ua' + s], sh, el);
      this.setLimb(this.limbs['fa' + s], el, ha);
      this.setLimb(this.limbs['th' + s], hip, kn);
      this.setLimb(this.limbs['sh' + s], kn, ft);
      this.limbs['hand' + s].position.copy(ha);
      const shoe = this.limbs['shoe' + s];
      shoe.position.copy(ft).add(V3(0, 0, 0.04));
      shoe.quaternion.copy(this.limbs['sh' + s].quaternion);
    }
    this.head.position.copy(J.head);
    this.head.rotation.x = -0.35 * P.fly;
    // arm wings
    const spread = P.fly;
    for (const w of this.wings) {
      const p = pts[w.side], s = w.side === 'L' ? -1 : 1;
      const hipS = p.hip.clone().add(V3(0.02 * s, 0, 0.06));
      for (const skin of [w.top, w.bot]) {
        const pos = skin.g.attributes.position.array;
        const top = skin === w.top;
        for (let j = 0; j <= skin.nv; j++) for (let i = 0; i <= skin.nu; i++) {
          const u = i / skin.nu, v = j / skin.nv;
          // leading edge: shoulder -> elbow -> hand (piecewise)
          const le = u < 0.45 ? this._a.lerpVectors(p.sh, p.el, u / 0.45) : this._a.lerpVectors(p.el, p.ha, (u - 0.45) / 0.55);
          const te = this._b.lerpVectors(hipS, p.ha, Math.pow(u, 1.15));
          const x = le.x + (te.x - le.x) * v, y0 = le.y + (te.y - le.y) * v, z = le.z + (te.z - le.z) * v;
          const inflate = Math.sin(Math.PI * Math.min(1, v * 1.1)) * (1 - u * 0.8) * spread;
          const thick = (top ? 0.055 : -0.02) * inflate;
          const f = Math.sin(P.t * 31 + u * 9 + j) * 0.012 * v * v * (0.3 + sp) * spread;
          const k = (j * (skin.nu + 1) + i) * 3;
          pos[k] = x; pos[k + 1] = y0 + thick + f + 0.012 * s * 0; pos[k + 2] = z;
        }
        skin.g.attributes.position.needsUpdate = true;
        skin.g.computeVertexNormals();
      }
    }
    // leg wing between the legs
    const L = pts.L, Rr = pts.R;
    for (const skin of [this.legWing.top, this.legWing.bot]) {
      const pos = skin.g.attributes.position.array;
      const top = skin === this.legWing.top;
      for (let j = 0; j <= skin.nv; j++) for (let i = 0; i <= skin.nu; i++) {
        const u = i / skin.nu, v = j / skin.nv;
        const aL = v < 0.5 ? this._a.lerpVectors(L.hip, L.kn, v * 2) : this._a.lerpVectors(L.kn, L.ft, v * 2 - 1);
        const ax = aL.x, ay = aL.y, az = aL.z;
        const aR = v < 0.5 ? this._b.lerpVectors(Rr.hip, Rr.kn, v * 2) : this._b.lerpVectors(Rr.kn, Rr.ft, v * 2 - 1);
        let x = ax + (aR.x - ax) * u, y = ay + (aR.y - ay) * u, z = az + (aR.z - az) * u;
        z -= Math.sin(Math.PI * u) * 0.12 * v * v;     // concave trailing edge
        const inflate = Math.sin(Math.PI * u) * Math.sin(Math.PI * Math.min(1, v * 1.05)) * spread;
        y += (top ? 0.05 : -0.015) * inflate + Math.sin(P.t * 28 + u * 7 + j) * 0.01 * v * (0.3 + sp) * spread;
        const k = (j * (skin.nu + 1) + i) * 3;
        pos[k] = x; pos[k + 1] = y; pos[k + 2] = z;
      }
      skin.g.attributes.position.needsUpdate = true;
      skin.g.computeVertexNormals();
    }
  }
}

// ---------------------------------------------------------------- canopy
class Canopy {
  constructor() {
    this.group = new THREE.Group();
    this.span = 7.3; this.chord = 2.85;
    const NU = 36, NV = 10;
    this.NU = NU; this.NV = NV;
    const tex = canopyTexture();
    this.topMat = stdMat({ map: tex, roughness: 0.75, side: THREE.DoubleSide });
    this.botMat = stdMat({ map: tex, color: 0xb9b3aa, roughness: 0.85, side: THREE.DoubleSide });
    const mk = (mat) => {
      const g = new THREE.BufferGeometry();
      const n = (NU + 1) * (NV + 1);
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      const uv = new Float32Array(n * 2);
      for (let j = 0; j <= NV; j++) for (let i = 0; i <= NU; i++) { uv[(j * (NU + 1) + i) * 2] = i / NU; uv[(j * (NU + 1) + i) * 2 + 1] = j / NV; }
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      const idx = [];
      for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) { const a = j * (NU + 1) + i, b = a + 1, c = a + NU + 1, d = c + 1; idx.push(a, b, c, b, d, c); }
      g.setIndex(idx);
      const m = new THREE.Mesh(g, mat); m.frustumCulled = false;
      this.group.add(m);
      return g;
    };
    this.top = mk(this.topMat); this.bot = mk(this.botMat);
    // lines (suspension + brakes) in world space
    const lg = new THREE.BufferGeometry();
    this.nLines = 10 * 4 + 4;
    lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.nLines * 6), 3));
    this.lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x2a2a2a, transparent: true, opacity: 0.75 }));
    this.lines.frustumCulled = false;
    // pilot chute + bridle
    this.pc = new THREE.Mesh(new THREE.SphereGeometry(0.55, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), stdMat({ color: 0xff6b1a, roughness: 0.8, side: THREE.DoubleSide }));
    const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    this.bridle = new THREE.Line(bg, new THREE.LineBasicMaterial({ color: 0xf2efe8 }));
    this.bridle.frustumCulled = false;
    this.attach = [];   // local attachment points on the bottom skin (rows A-D at 10 ribs)
    this.shape(1, 0, 0, 0);
    this.visible(false);
  }
  add(scene) { scene.add(this.group); scene.add(this.lines); scene.add(this.pc); scene.add(this.bridle); }
  visible(v) { this.group.visible = v; this.lines.visible = v; this.pc.visible = v; this.bridle.visible = v; }
  // inflation 0..1, brakes deform the trailing edge
  shape(infl, bL, bR, t) {
    const NU = this.NU, NV = this.NV;
    const span = this.span * lerp(0.18, 1, smoothstep(0, 1, infl));
    const chord = this.chord * lerp(0.45, 1, smoothstep(0, 0.8, infl));
    const thMax = 0.56 * lerp(1.8, 1, infl);
    const Rarc = (this.span / 2) / Math.sin(0.56);
    const tp = this.top.attributes.position.array, bp = this.bot.attributes.position.array;
    this.attach.length = 0;
    for (let j = 0; j <= NV; j++) for (let i = 0; i <= NU; i++) {
      const u = i / NU * 2 - 1, v = j / NV;
      const th = u * thMax * (span / this.span);
      const ax = Math.sin(th) * Rarc * (span / this.span) * 1.0, ay = (Math.cos(th) - 1) * Rarc * 0.9;
      const nx = Math.sin(th), ny = Math.cos(th);
      const cell = (i / NU) * 9, cf = cell - Math.floor(cell);
      const bulge = Math.sin(Math.PI * cf) * 0.07 * infl;
      const thick = 1.5 * (Math.sqrt(v + 0.002) - v) * infl;
      const crumple = (1 - infl) * Math.sin(u * 23 + v * 9 + t * 25) * 0.25;
      // brakes pull the trailing edge down on each side
      const br = (u < 0 ? bL : bR) * smoothstep(0.35, 1, Math.abs(u)) * Math.pow(v, 3) * 0.55;
      const z = (v - 0.32) * chord;
      const yTop = (0.32 * thick + bulge * thick * 3) - br + crumple;
      const yBot = (-0.06 * thick) - br + crumple * 0.8;
      const k = (j * (NU + 1) + i) * 3;
      tp[k] = ax + nx * yTop; tp[k + 1] = ay + ny * yTop; tp[k + 2] = z;
      bp[k] = ax + nx * yBot; bp[k + 1] = ay + ny * yBot; bp[k + 2] = z;
    }
    this.top.attributes.position.needsUpdate = true; this.bot.attributes.position.needsUpdate = true;
    this.top.computeVertexNormals(); this.bot.computeVertexNormals();
    // attachment points (ribs every 4 columns, rows A..D)
    for (let r = 0; r <= 9; r++) {
      const i = Math.round(r / 9 * NU);
      for (const jj of [1, 3, 5, 7]) {
        const k = (jj * (NU + 1) + i) * 3;
        this.attach.push(new THREE.Vector3(bp[k], bp[k + 1], bp[k + 2]));
      }
    }
    // brake line anchors: trailing edge outer thirds
    this.brakeAnchors = [];
    for (const i of [2, 7, NU - 7, NU - 2]) { const k = (NV * (NU + 1) + i) * 3; this.brakeAnchors.push(new THREE.Vector3(bp[k], bp[k + 1], bp[k + 2])); }
  }
  // world-space lines from canopy to the jumper's risers and hands
  updateLines(shL, shR, haL, haR) {
    const arr = this.lines.geometry.attributes.position.array;
    const m = this.group.matrixWorld;
    const tmp = new THREE.Vector3();
    let k = 0;
    const put = (a, b) => { arr[k++] = a.x; arr[k++] = a.y; arr[k++] = a.z; arr[k++] = b.x; arr[k++] = b.y; arr[k++] = b.z; };
    for (let q = 0; q < this.attach.length; q++) {
      tmp.copy(this.attach[q]).applyMatrix4(m);
      const left = q < this.attach.length / 2;
      put(tmp, left ? shL : shR);
    }
    for (let q = 0; q < 4; q++) { tmp.copy(this.brakeAnchors[q]).applyMatrix4(m); put(tmp, q < 2 ? haL : haR); }
    this.lines.geometry.attributes.position.needsUpdate = true;
  }
}
