// Web Audio sound effects: Yusuf's recorded sounds (sfx/*.mp3: the vacuum sucking things up, the mop wiping, hitting
// and swishing) plus procedural ones for everything else
const SAMPLE_SETS = { suckPaper: ['SuckPaper', 9], suckGlass: ['SuckGlass', 5], suckLeaf: ['SuckLeaf', 5], hitMop: ['HitMop', 6], swish: ['Swish', 4], swishSlomo: ['SwishSlomo', 0], wipe: ['WipeFloor', 0], pickupBody: ['PickupBody', 4],
  roll: ['RollDodge', 2], kickHit: ['KickHit', 0], kickCloth: ['KickCloth', 2], finisherHit: ['FinisherHitSloMo', 0] };
export const SFX = {
  ctx: null, master: null, muted: false, noise: null, last: {}, raw: {}, buf: {}, lastIdx: {}, loops: {},
  // fetch the sound files straight away (they're decoded once there's an audio context, after the first click)
  preload() {
    if (this.preloading) return; this.preloading = true;
    for (const [k, [base, n]] of Object.entries(SAMPLE_SETS)) {
      const names = n ? Array.from({ length: n }, (_, i) => base + (i + 1)) : [base];
      this.raw[k] = Promise.all(names.map(nm => fetch(`sfx/${nm}.mp3`).then(r => r.ok ? r.arrayBuffer() : null).catch(() => null)));
    }
  },
  async decodeAll() {
    this.preload();
    for (const k of Object.keys(SAMPLE_SETS)) {
      const abs = await this.raw[k];
      const out = [];
      for (const ab of abs) { if (!ab) continue; try { out.push(await this.ctx.decodeAudioData(ab.slice(0))); } catch (e) {} }
      if (k === 'wipe' && out[0]) out[0] = loopable(this.ctx, out[0], 0.14);
      this.buf[k] = out;
    }
  },
  // one of a set of recorded sounds (never the same one twice running), a touch of pitch variety; false if not loaded
  sample(set, vol = 1, rate = 1, gap = 0.03) {
    if (!this.ctx) return false;
    const list = this.buf[set]; if (!list || !list.length) return false;
    if (this.muted) return true;
    const now = this.ctx.currentTime, key = 's:' + set;
    if (this.last[key] && now - this.last[key] < gap) return true; this.last[key] = now;
    let i = Math.random() * list.length | 0; if (list.length > 1 && i === this.lastIdx[set]) i = (i + 1) % list.length; this.lastIdx[set] = i;
    const s = this.ctx.createBufferSource(); s.buffer = list[i]; s.playbackRate.value = rate * (0.96 + Math.random() * 0.08);
    const g = this.ctx.createGain(); g.gain.value = vol; s.connect(g); g.connect(this.master); s.start();
    return true;
  },
  // a recorded loop that plays while level > 0 (fades in and out), e.g. the mop wiping the floor
  loop(set, level, rate = 1) {
    if (!this.ctx) return;
    let L = this.loops[set];
    if (!L) {
      const b = this.buf[set] && this.buf[set][0]; if (!b || level <= 0.001) return;
      const s = this.ctx.createBufferSource(); s.buffer = b; s.loop = true;
      const g = this.ctx.createGain(); g.gain.value = 0; s.connect(g); g.connect(this.master); s.start(0, Math.random() * b.duration);
      L = this.loops[set] = { s, g, on: 0 };
    }
    const t = this.ctx.currentTime, v = this.muted ? 0 : level;
    if (Math.abs(v - L.on) > 0.001) { L.on = v; L.g.gain.setTargetAtTime(v, t, v > 0 ? 0.05 : 0.09); }
    L.s.playbackRate.setTargetAtTime(rate, t, 0.2);
  },
  // everything that runs continuously goes quiet (paused, menus)
  hush() { for (const k in this.loops) this.loop(k, 0); for (const k in (this.hums || {})) this.hum(k, 0); },
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    this.ctx = new AC();
    this.decodeAll();
    this.master = this.ctx.createGain(); this.master.gain.value = 0.55; this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 1.5, buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
    this.startAmbience();
  },
  toggleMute() { this.muted = !this.muted; if (this.master) this.master.gain.value = this.muted ? 0 : 0.55; return this.muted; },
  env(node, t0, a, peak, dec) { const g = node.gain; g.setValueAtTime(0.0001, t0); g.exponentialRampToValueAtTime(peak, t0 + a); g.exponentialRampToValueAtTime(0.0001, t0 + a + dec); },
  noiseHit(t, { f = 1000, q = 1, type = 'bandpass', peak = 0.5, a = 0.003, dec = 0.15, rate = 1 } = {}) {
    const c = this.ctx, s = c.createBufferSource(); s.buffer = this.noise; s.playbackRate.value = rate;
    const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
    const g = c.createGain(); this.env(g, t, a, peak, dec);
    s.connect(fl); fl.connect(g); g.connect(this.master); s.start(t, Math.random()); s.stop(t + a + dec + 0.05);
    return fl;
  },
  tone(t, { f = 200, f2 = 60, type = 'sine', peak = 0.5, a = 0.002, dec = 0.2 } = {}) {
    const c = this.ctx, o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t + a + dec);
    const g = c.createGain(); this.env(g, t, a, peak, dec); o.connect(g); g.connect(this.master); o.start(t); o.stop(t + a + dec + 0.05);
  },
  play(name, vol = 1) {
    if (!this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    if (this.last[name] && now - this.last[name] < 0.025) return; this.last[name] = now;
    const t = now + 0.005, r = (a, b) => a + Math.random() * (b - a);
    switch (name) {
      case 'whoosh': { const fl = this.noiseHit(t, { f: 600, q: 0.8, peak: 0.18 * vol, a: 0.05, dec: 0.18 }); fl.frequency.exponentialRampToValueAtTime(2200, t + 0.2); break; }
      case 'hit': this.noiseHit(t, { f: r(500, 900), q: 1.2, peak: 0.6 * vol, dec: 0.09 }); this.tone(t, { f: r(150, 190), f2: 50, peak: 0.6 * vol, dec: 0.16 }); this.noiseHit(t, { f: 3000, type: 'highpass', peak: 0.08, dec: 0.12 }); break; // wet mop smack
      case 'heavy': this.noiseHit(t, { f: 400, q: 1, peak: 0.8, dec: 0.18 }); this.tone(t, { f: 120, f2: 35, peak: 0.9, dec: 0.3 }); break;
      case 'kick': this.noiseHit(t, { f: 300, q: 1, peak: 0.45, dec: 0.1 }); this.tone(t, { f: 100, f2: 40, peak: 0.6, dec: 0.2 }); break;
      case 'gun': this.noiseHit(t, { f: 1800, q: 0.5, peak: 0.55 * vol, a: 0.001, dec: 0.12 }); this.tone(t, { f: 160, f2: 40, type: 'triangle', peak: 0.5 * vol, dec: 0.12 }); this.noiseHit(t + 0.02, { f: 600, type: 'lowpass', peak: 0.15 * vol, dec: 0.35 }); break;
      case 'shatter': for (let i = 0; i < 14; i++) { const tt = t + i * r(0.008, 0.035); this.noiseHit(tt, { f: r(3000, 8000), q: r(4, 12), peak: r(0.1, 0.3), dec: r(0.05, 0.3) }); this.tone(tt, { f: r(2500, 6000), f2: r(2000, 5000), peak: 0.04, dec: r(0.1, 0.4) }); } this.noiseHit(t, { f: 900, q: 0.6, peak: 0.5, dec: 0.25 }); break;
      case 'crack': this.noiseHit(t, { f: 4000, q: 3, peak: 0.35, dec: 0.08 }); this.tone(t, { f: 3200, f2: 2600, peak: 0.08, dec: 0.15 }); break;
      case 'smash': this.noiseHit(t, { f: 1200, q: 1, peak: 0.5, dec: 0.2 }); for (let i = 0; i < 5; i++) this.noiseHit(t + i * 0.03, { f: r(2000, 5000), q: 6, peak: 0.12, dec: 0.08 }); this.tone(t, { f: 900, f2: 300, type: 'square', peak: 0.05, dec: 0.25 }); break;
      case 'thud': this.tone(t, { f: 90, f2: 40, peak: 0.6, dec: 0.25 }); this.noiseHit(t, { f: 250, type: 'lowpass', peak: 0.3, dec: 0.15 }); break;
      case 'hurt': this.tone(t, { f: 220, f2: 140, type: 'sawtooth', peak: 0.12, dec: 0.22 }); this.noiseHit(t, { f: 700, peak: 0.4, dec: 0.1 }); break;
      case 'dodge': { const fl = this.noiseHit(t, { f: 1500, q: 0.6, peak: 0.12, a: 0.03, dec: 0.25 }); fl.frequency.exponentialRampToValueAtTime(400, t + 0.28); break; }
      case 'perfect': this.tone(t, { f: 880, f2: 1760, type: 'triangle', peak: 0.18, dec: 0.4 }); this.tone(t + 0.06, { f: 1320, f2: 2640, type: 'sine', peak: 0.12, dec: 0.5 }); break;
      case 'alert': this.tone(t, { f: 520, f2: 700, type: 'square', peak: 0.06, dec: 0.12 }); break;
      case 'aim': this.tone(t, { f: 1500, f2: 1500, type: 'sine', peak: 0.04, dec: 0.08 }); break;
      case 'squeak': this.tone(t, { f: r(1800, 2600), f2: r(1200, 3000), type: 'sine', peak: 0.03, dec: 0.12 }); this.noiseHit(t, { f: 2500, q: 2, peak: 0.04, dec: 0.15 }); break;
      case 'collect': this.tone(t, { f: 1100, f2: 1500, type: 'sine', peak: 0.05, dec: 0.08 }); break;
      case 'combo': this.tone(t, { f: 660 * vol, f2: 990 * vol, type: 'triangle', peak: 0.07, dec: 0.15 }); break;
      case 'special': this.tone(t, { f: 200, f2: 1200, type: 'sawtooth', peak: 0.12, dec: 0.5 }); this.noiseHit(t, { f: 1200, q: 0.5, peak: 0.3, a: 0.1, dec: 0.4 }); break;
      case 'ko': this.tone(t, { f: 300, f2: 80, type: 'triangle', peak: 0.3, dec: 0.35 }); break;
      case 'ding': this.tone(t, { f: 1318, f2: 1318, peak: 0.15, dec: 0.8 }); this.tone(t + 0.25, { f: 1046, f2: 1046, peak: 0.15, dec: 1.0 }); break;
    }
  },
  // continuous machine noise for the vacuum / polisher: level 0..1 (0 = off), load raises the pitch a little
  hum(name, level, load = 0) {
    if (!this.ctx) return;
    this.hums = this.hums || {};
    let h = this.hums[name];
    if (!h) {
      if (level <= 0.001) return;
      const c = this.ctx, s = c.createBufferSource(); s.buffer = this.noise; s.loop = true;
      const fl = c.createBiquadFilter(); fl.type = 'bandpass'; fl.Q.value = name === 'vacuum' ? 0.7 : 1.2; fl.frequency.value = name === 'vacuum' ? 1400 : 380;
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = name === 'vacuum' ? 210 : 62;
      const ol = c.createBiquadFilter(); ol.type = 'lowpass'; ol.frequency.value = name === 'vacuum' ? 1100 : 420;
      const og = c.createGain(); og.gain.value = name === 'vacuum' ? 0.18 : 0.5;
      const g = c.createGain(); g.gain.value = 0;
      s.connect(fl); fl.connect(g); o.connect(ol); ol.connect(og); og.connect(g); g.connect(this.master); s.start(); o.start();
      h = this.hums[name] = { s, o, fl, g, base: o.frequency.value, fbase: fl.frequency.value };
    }
    const t = this.ctx.currentTime, peak = name === 'vacuum' ? 0.09 : 0.2; // (vacuum: 5 dB under what it was)
    h.g.gain.setTargetAtTime(this.muted ? 0 : level * peak, t, 0.08);
    h.o.frequency.setTargetAtTime(h.base * (1 + load * 0.12), t, 0.15);
    h.fl.frequency.setTargetAtTime(h.fbase * (1 + load * 0.35), t, 0.15);
  },
  startAmbience() {
    // soft lobby room tone + distant hum
    const c = this.ctx, s = c.createBufferSource(); s.buffer = this.noise; s.loop = true;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 300;
    const g = c.createGain(); g.gain.value = 0.05; s.connect(f); f.connect(g); g.connect(this.master); s.start();
    const o = c.createOscillator(); o.frequency.value = 55; const og = c.createGain(); og.gain.value = 0.012; o.connect(og); og.connect(this.master); o.start();
  },
};

// make a recording loop without a seam: trim the silent edges, then fold the last bit of the sound over the start
// with an equal-power crossfade, so the end runs straight on into the beginning
function loopable(ctx, b, cf = 0.12) {
  const sr = b.sampleRate, ch = b.numberOfChannels, d0 = b.getChannelData(0);
  let a = 0, e = d0.length - 1; while (a < e && Math.abs(d0[a]) < 0.002) a++; while (e > a && Math.abs(d0[e]) < 0.002) e--;
  const L = e - a + 1, C = Math.min(Math.floor(cf * sr), Math.floor(L / 3)), N = L - C;
  if (N < sr * 0.2) return b;
  const out = ctx.createBuffer(ch, N, sr);
  for (let c = 0; c < ch; c++) {
    const src = b.getChannelData(c), dst = out.getChannelData(c);
    for (let i = 0; i < N; i++) dst[i] = src[a + i];
    for (let i = 0; i < C; i++) { const k = i / C; dst[i] = src[a + i] * Math.sin(k * Math.PI / 2) + src[a + N + i] * Math.cos(k * Math.PI / 2); }
  }
  return out;
}
