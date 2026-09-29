// ================================================================= AUDIO
// Everything is synthesized: wind from filtered noise, beeps for the audible
// altimeter, chimes for the gates, a thump for the canopy opening, whistles
// from startled choughs.
const AUDIO = { ctx: null, ready: false, master: null, lastBeepAlt: 1e9, lastProx: 999, whooshT: 0 };
function initAudio() {
  if (AUDIO.ctx) { if (AUDIO.ctx.state === 'suspended') AUDIO.ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  const ctx = new AC();
  AUDIO.ctx = ctx;
  const master = ctx.createGain(); master.gain.value = SETTINGS.sound ? 0.8 : 0;
  const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
  master.connect(comp); comp.connect(ctx.destination);
  AUDIO.master = master;
  const len = ctx.sampleRate * 3;
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      // pinkish noise
      b0 = 0.997 * b0 + w * 0.029591; b1 = 0.985 * b1 + w * 0.032534; b2 = 0.95 * b2 + w * 0.048056;
      d[i] = (b0 + b1 + b2 + w * 0.04) * 1.6;
    }
  }
  AUDIO.noise = buf;
  const src = (rate = 1) => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.playbackRate.value = rate; s.start(0, Math.random() * 2); return s; };
  // main wind body
  const w = src(1);
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 400; bp.Q.value = 0.7;
  const wg = ctx.createGain(); wg.gain.value = 0;
  const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
  w.connect(bp); bp.connect(wg); wg.connect(pan); pan.connect(master);
  // high hiss at speed
  const h = src(1.3);
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2400;
  const hg = ctx.createGain(); hg.gain.value = 0;
  h.connect(hp); hp.connect(hg); hg.connect(master);
  // low rumble / buffeting
  const r = src(0.6);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 140;
  const rg = ctx.createGain(); rg.gain.value = 0;
  const trem = ctx.createGain(); trem.gain.value = 1;
  r.connect(lp); lp.connect(rg); rg.connect(trem); trem.connect(master);
  // fabric flutter (canopy)
  const fl = src(1);
  const fbp = ctx.createBiquadFilter(); fbp.type = 'bandpass'; fbp.frequency.value = 900; fbp.Q.value = 2;
  const fg = ctx.createGain(); fg.gain.value = 0;
  fl.connect(fbp); fbp.connect(fg); fg.connect(master);
  // paramotor: a sawtooth two-stroke buzz plus propeller wash
  const mo = ctx.createOscillator(); mo.type = 'sawtooth'; mo.frequency.value = 70;
  const mlp = ctx.createBiquadFilter(); mlp.type = 'lowpass'; mlp.frequency.value = 900; mlp.Q.value = 1.5;
  const mg = ctx.createGain(); mg.gain.value = 0;
  mo.connect(mlp); mlp.connect(mg); mg.connect(master); mo.start();
  const pw = src(1.6);
  const pbp = ctx.createBiquadFilter(); pbp.type = 'bandpass'; pbp.frequency.value = 1300; pbp.Q.value = 0.9;
  const pg = ctx.createGain(); pg.gain.value = 0;
  pw.connect(pbp); pbp.connect(pg); pg.connect(master);
  AUDIO.n = { bp, wg, pan, hg, rg, trem, fg, fbp, lp, mo, mlp, mg, pg };
  AUDIO.ready = true;
}
function setMute(muted) {
  SETTINGS.sound = !muted; saveSettings();
  if (AUDIO.master) AUDIO.master.gain.setTargetAtTime(muted ? 0 : 0.8, AUDIO.ctx.currentTime, 0.05);
}
function updateAudio(dt, st) {
  if (!AUDIO.ready) return;
  const ctx = AUDIO.ctx, t = ctx.currentTime, n = AUDIO.n;
  const phase = st.phase;
  const spd = st.vel.length();
  const air = phase === 'fly' || phase === 'deploy' || phase === 'exit' ? 1 : 0;
  const canopy = phase === 'canopy' ? 1 : 0;
  const amb = phase === 'ready' || phase === 'menu-stand' ? 1 : 0;
  const k = smoothstep(5, 75, spd);
  const prox = st.prox;
  const near = air * (prox < 30 ? 1 - prox / 30 : 0);
  const wGain = air * (0.05 + 0.5 * k * k + near * 0.18) + canopy * 0.08 + amb * 0.05 + (phase === 'menu' ? 0.05 : 0);
  n.wg.gain.setTargetAtTime(wGain, t, 0.08);
  n.bp.frequency.setTargetAtTime(220 + 900 * k + 500 * near, t, 0.1);
  n.hg.gain.setTargetAtTime(air * k * k * 0.14 + near * 0.08, t, 0.08);
  n.rg.gain.setTargetAtTime(air * (0.1 + k * 0.7) + canopy * 0.12, t, 0.1);
  n.trem.gain.setTargetAtTime(0.7 + 0.3 * Math.sin(t * (9 + k * 12)) * (0.4 + near), t, 0.02);
  n.fg.gain.setTargetAtTime(canopy * 0.05 + (phase === 'deploy' ? 0.2 : 0), t, 0.1);
  n.fbp.frequency.setTargetAtTime(700 + 400 * Math.sin(t * 13), t, 0.05);
  const th = canopy * (st.thrust || 0);
  n.mg.gain.setTargetAtTime(th * 0.075, t, 0.12);
  n.pg.gain.setTargetAtTime(th * 0.06, t, 0.12);
  n.mo.frequency.setTargetAtTime(58 + 62 * th + 3 * Math.sin(t * 17), t, 0.08);
  n.mlp.frequency.setTargetAtTime(500 + 1300 * th, t, 0.1);
  if (n.pan.pan) n.pan.pan.setTargetAtTime(clamp(-st.bank * 0.5, -0.7, 0.7), t, 0.1);
  // whoosh when skimming terrain
  AUDIO.whooshT -= dt;
  if (air && prox < 14 && AUDIO.lastProx - prox > 0.5 && AUDIO.whooshT <= 0 && spd > 30) { whoosh(0.35 * (1 - prox / 14) + 0.1); AUDIO.whooshT = 0.45; }
  AUDIO.lastProx = prox;
}
function tone(freq, dur, type = 'sine', vol = 0.2, when = 0, attack = 0.005) {
  if (!AUDIO.ready) return;
  const ctx = AUDIO.ctx, t = ctx.currentTime + when;
  const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  o.connect(g); g.connect(AUDIO.master); o.start(t); o.stop(t + dur + 0.05);
}
function noiseBurst(dur, freq, vol, type = 'lowpass', when = 0, q = 0.8) {
  if (!AUDIO.ready) return;
  const ctx = AUDIO.ctx, t = ctx.currentTime + when;
  const s = ctx.createBufferSource(); s.buffer = AUDIO.noise;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  s.connect(f); f.connect(g); g.connect(AUDIO.master); s.start(t, Math.random()); s.stop(t + dur + 0.05);
  return f;
}
// a short whistle that jumps up and slides down (alpine chough call)
function chirp(f0, f1, dur, vol, when = 0) {
  if (!AUDIO.ready) return;
  const ctx = AUDIO.ctx, t = ctx.currentTime + when;
  const o = ctx.createOscillator(); o.type = 'sine';
  o.frequency.setValueAtTime(f0 * 0.8, t); o.frequency.linearRampToValueAtTime(f0, t + 0.025); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  o.connect(g); g.connect(AUDIO.master); o.start(t); o.stop(t + dur + 0.05);
}
function whoosh(v) {
  if (!AUDIO.ready) return;
  const f = noiseBurst(0.5, 600, v, 'bandpass', 0, 1.2);
  if (f) { f.frequency.setValueAtTime(1800, AUDIO.ctx.currentTime); f.frequency.exponentialRampToValueAtTime(260, AUDIO.ctx.currentTime + 0.45); }
}
const SFX = {
  gate(notch) {
    tone(880, 0.35, 'sine', 0.16); tone(1318.5, 0.5, 'sine', 0.12, 0.07);
    if (notch) { tone(1760, 0.7, 'sine', 0.1, 0.14); tone(2637, 0.5, 'triangle', 0.04, 0.2); }
  },
  beepWarn() { for (let i = 0; i < 2; i++) tone(2400, 0.12, 'square', 0.06, i * 0.18); },
  beepNow() { for (let i = 0; i < 6; i++) tone(2900, 0.07, 'square', 0.07, i * 0.1); },
  jump() { noiseBurst(0.25, 500, 0.15, 'bandpass'); },
  deploy() { noiseBurst(0.35, 1400, 0.12, 'bandpass', 0, 2); },
  open() { noiseBurst(0.5, 260, 0.9, 'lowpass', 0); noiseBurst(0.9, 900, 0.18, 'bandpass', 0.05, 1.5); tone(70, 0.4, 'sine', 0.35); },
  land(k) { noiseBurst(0.3, 300, k === 'perfect' ? 0.25 : 0.5, 'lowpass'); },
  crash() { noiseBurst(0.9, 180, 1.0, 'lowpass'); noiseBurst(0.5, 1200, 0.3, 'bandpass', 0.02); tone(55, 0.8, 'sine', 0.5); },
  splash() { noiseBurst(1.2, 1600, 0.5, 'bandpass', 0, 0.6); noiseBurst(0.6, 300, 0.4, 'lowpass'); },
  click() { tone(1200, 0.05, 'triangle', 0.05); },
  birds() {
    const n = 4 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) chirp(2500 + Math.random() * 900, 1500 + Math.random() * 500, 0.1 + Math.random() * 0.08, 0.03 + Math.random() * 0.02, i * 0.09 + Math.random() * 0.1);
  },
};
