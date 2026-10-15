// Sounds made in code (no recordings needed): rendered once into audio buffers when the audio starts.
// Rolling loops (office-chair casters, the wheelbarrow), paper rustle and flutter, plastic cups, metal bins.
const rnd = (a, b) => a + Math.random() * (b - a);

// RBJ biquad, run over a buffer in place
function biquad(x, sr, type, f, q = 0.707) {
  const w = 2 * Math.PI * f / sr, cs = Math.cos(w), al = Math.sin(w) / (2 * q);
  let b0, b1, b2, a0, a1, a2;
  if (type === 'lp') { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0; }
  else if (type === 'hp') { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0; }
  else { b0 = al; b1 = 0; b2 = -al; } // band-pass (0 dB peak)
  a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al;
  b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) { const y = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x[i]; y2 = y1; y1 = y; x[i] = y; }
  return x;
}
const white = n => { const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = Math.random() * 2 - 1; return a; };
function brown(n) { const a = new Float32Array(n); let v = 0; for (let i = 0; i < n; i++) { v = (v + (Math.random() * 2 - 1) * 0.02) * 0.998; a[i] = v * 8; } return a; }
function mix(dst, src, g = 1, at = 0) { for (let i = 0; i < src.length && at + i < dst.length; i++) if (at + i >= 0) dst[at + i] += src[i] * g; }
function norm(a, peak = 0.9) { let m = 0; for (const v of a) m = Math.max(m, Math.abs(v)); if (m > 0) for (let i = 0; i < a.length; i++) a[i] *= peak / m; return a; }
// a short decaying sum of sine partials (struck things)
function partials(sr, dur, list) { // list: [freq, amp, decay(s)]
  const n = Math.floor(dur * sr), a = new Float32Array(n);
  for (const [f, amp, dec] of list) { const ph = Math.random() * 6.28; for (let i = 0; i < n; i++) { const t = i / sr; a[i] += Math.sin(ph + 2 * Math.PI * f * t) * amp * Math.exp(-t / dec); } }
  return a;
}
function burst(sr, dur, f, q, dec, type = 'bp') { const n = Math.floor(dur * sr), a = white(n); biquad(a, sr, type, f, q); for (let i = 0; i < n; i++) a[i] *= Math.exp(-i / sr / dec); return a; }
// fold the tail over the head so it loops without a seam
function loopify(a, sr, cf = 0.25) {
  const C = Math.floor(cf * sr), N = a.length - C, out = new Float32Array(N);
  for (let i = 0; i < N; i++) out[i] = a[i];
  for (let i = 0; i < C; i++) { const k = i / C; out[i] = a[i] * Math.sin(k * Math.PI / 2) + a[N + i] * Math.cos(k * Math.PI / 2); }
  return out;
}
function toBuf(ctx, a) { const b = ctx.createBuffer(1, a.length, ctx.sampleRate); b.getChannelData(0).set(a); return b; }

// office chair / cart casters on a hard floor: a soft rumble, fine grit, and the little ticks of five small wheels
function rollChair(sr) {
  const n = Math.floor(2.6 * sr), a = new Float32Array(n);
  mix(a, biquad(biquad(brown(n), sr, 'lp', 220), sr, 'hp', 40), 0.55);
  const grit = biquad(white(n), sr, 'bp', 1600, 0.6); let env = 0.5;
  for (let i = 0; i < n; i++) { if (i % 400 === 0) env = 0.35 + Math.random() * 0.65; grit[i] *= env; }
  mix(a, grit, 0.14);
  for (let w = 0; w < 5; w++) { const per = rnd(0.13, 0.19); for (let t = rnd(0, per); t < 2.6; t += per * rnd(0.92, 1.08)) mix(a, burst(sr, 0.03, rnd(1400, 2400), 3, 0.006), rnd(0.06, 0.15), Math.floor(t * sr)); }
  return norm(loopify(a, sr, 0.3), 0.8);
}
// the wheelbarrow: one big tyre rolling (a low drone and a soft bump once a turn)
function rollBarrow(sr) {
  const n = Math.floor(3.0 * sr), a = new Float32Array(n);
  mix(a, biquad(biquad(brown(n), sr, 'lp', 140), sr, 'hp', 30), 0.8);
  const per = 0.68;
  for (let t = 0.1; t < 3.0; t += per) {
    const at = Math.floor(t * sr);
    mix(a, partials(sr, 0.12, [[72, 1, 0.05], [110, 0.4, 0.03]]), 0.35, at); // the bump of the tyre
    mix(a, burst(sr, 0.05, 320, 1, 0.02), 0.25, at);
  }
  return norm(loopify(a, sr, 0.3), 0.8);
}
// paper: dry crinkle (sparse crackles through a bright band) under a soft swish
function paperRustle(sr) {
  const dur = rnd(0.28, 0.5), n = Math.floor(dur * sr), a = new Float32Array(n);
  const hiss = biquad(biquad(white(n), sr, 'hp', 1200), sr, 'bp', rnd(2600, 4000), 0.7);
  for (let i = 0; i < n; i++) { const k = i / n; hiss[i] *= Math.min(1, k * 12) * Math.pow(1 - k, 1.6); }
  mix(a, hiss, 0.5);
  const crack = new Float32Array(n);
  for (let i = 0; i < n; i++) { const k = i / n, rate = 900 * Math.pow(1 - k, 1.4); if (Math.random() < rate / sr) crack[i] = (Math.random() * 2 - 1) * rnd(0.3, 1); }
  biquad(crack, sr, 'hp', 1200); biquad(crack, sr, 'bp', rnd(2600, 4200), 0.9);
  mix(a, crack, 2.2);
  return norm(a, 0.85);
}
// paper in the air: fluttering (amplitude beating at a few tens of hertz) with the odd crackle
function paperFlutter(sr) {
  const n = Math.floor(2.2 * sr), a = biquad(biquad(white(n), sr, 'hp', 900), sr, 'bp', 2600, 0.6);
  let ph = 0, f = 14;
  for (let i = 0; i < n; i++) { if (i % 2000 === 0) f = rnd(9, 22); ph += 2 * Math.PI * f / sr; a[i] *= 0.25 + 0.75 * Math.pow(0.5 + 0.5 * Math.sin(ph), 3); }
  const crack = new Float32Array(n); for (let i = 0; i < n; i++) if (Math.random() < 140 / sr) crack[i] = (Math.random() * 2 - 1);
  biquad(crack, sr, 'bp', 3800, 1); mix(a, crack, 1.5);
  return norm(loopify(a, sr, 0.3), 0.8);
}
// a thin plastic cup: a quick hollow "tok" (bright, fast-dying modes) with a tiny click
function cupHit(sr) {
  const f0 = rnd(900, 1350), a = partials(sr, 0.12, [[f0, 1, 0.022], [f0 * 1.71, 0.7, 0.016], [f0 * 2.83, 0.45, 0.01], [rnd(420, 560), 0.5, 0.03]]);
  mix(a, burst(sr, 0.02, 5000, 1.5, 0.003), 0.6);
  return norm(a, 0.8);
}
// up the vacuum hose: a pop, then the cup rattling up the tube in a rising whoosh
function cupSuck(sr) {
  const dur = 0.42, n = Math.floor(dur * sr), a = new Float32Array(n);
  const wh = white(n), out = new Float32Array(n); // swept band-pass (piecewise)
  for (let s = 0; s < 8; s++) { const i0 = Math.floor(s * n / 8), i1 = Math.floor((s + 1) * n / 8), seg = wh.slice(i0, i1); biquad(seg, sr, 'bp', 600 * Math.pow(5, s / 7), 1.2); out.set(seg, i0); }
  for (let i = 0; i < n; i++) { const k = i / n; out[i] *= Math.min(1, k * 8) * (1 - k); }
  mix(a, out, 0.5);
  mix(a, cupHit(sr), 0.8, 0);
  for (let t = 0.05, gap = 0.06; t < dur - 0.04; t += gap, gap = Math.max(0.014, gap * 0.8)) mix(a, partials(sr, 0.05, [[rnd(1300, 1800) * (1 + t * 2), 1, 0.01], [rnd(2600, 3200) * (1 + t), 0.5, 0.007]]), 0.35 * (1 - t / dur), Math.floor(t * sr));
  return norm(a, 0.8);
}
// a steel office bin: inharmonic ringing partials of a thin cylinder, a bright strike on top
function binClang(sr) {
  const f0 = rnd(330, 460), R = [1, 1.59, 2.38, 3.13, 4.22, 5.61, 7.1];
  const list = []; R.forEach((r, i) => { const amp = 1 / (1 + i * 0.6), dec = rnd(0.25, 0.7) / (1 + i * 0.25); list.push([f0 * r, amp, dec], [f0 * r * 1.004, amp * 0.6, dec]); }); // (beating pairs)
  const a = partials(sr, 1.3, list);
  mix(a, burst(sr, 0.04, 3200, 1.2, 0.008), 1.4);
  mix(a, partials(sr, 0.2, [[rnd(110, 150), 1, 0.06]]), 0.5); // the body thump
  return norm(a, 0.85);
}

// [sound set, how many variants, generator]: rendered one buffer at a time between frames (no hitch at the first click)
export const SYNTH_JOBS = [['rollChair', 1, rollChair], ['rollBarrow', 1, rollBarrow], ['paperFlutter', 1, paperFlutter], ['paperRustle', 6, paperRustle],
  ]; // (cups and bins: Yusuf's recordings now)
export function synthInto(ctx, buf) {
  const q = []; for (const [k, n, fn] of SYNTH_JOBS) for (let i = 0; i < n; i++) q.push([k, fn]);
  const step = () => { const j = q.shift(); if (!j) return; try { (buf[j[0]] = buf[j[0]] || []).push(toBuf(ctx, j[1](ctx.sampleRate))); } catch (e) { console.warn('synth', j[0], e); } setTimeout(step, 16); };
  setTimeout(step, 30);
}
export const SYNTH_RAW = { rollChair, rollBarrow, paperFlutter, paperRustle, cupHit, cupSuck, binClang }; // (for previews)
