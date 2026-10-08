// Floor decals: grime smears, rubber heel marks, scratches, grit, cart tracks, potting soil, dust...
// Painted procedurally into one high-res atlas and laid on the floor as a single instanced mesh.
// The mop wipes them through a shared floor-sized mask (white = still dirty).
import * as THREE from 'three';
import { G, makeCanvas, pointInBox } from './state.js';

const N = 4, CELL = 512, AT = N * CELL, MAXD = 320;
const MPX = 20; // wipe-mask pixels per metre
export const DECALS = { list: [], mesh: null, cover: new Float32Array(N * N), maskDirty: false };

// ---------- noise ----------
function hash(i, j, s) { let h = Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(s, 1442695041) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
// fractal value noise, S x S, base frequencies fx/fy (stretch one to get streaks)
function fbm(S, fx0, fy0, oct, seed) {
  const out = new Float32Array(S * S); let amp = 1, tot = 0;
  for (let o = 0; o < oct; o++) {
    const fx = fx0 * (1 << o), fy = fy0 * (1 << o), gw = Math.ceil(fx) + 2, gh = Math.ceil(fy) + 2;
    const lat = new Float32Array(gw * gh); for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) lat[j * gw + i] = hash(i, j, seed * 31 + o);
    for (let y = 0; y < S; y++) {
      const v = y / S * fy, j = v | 0; let tv = v - j; tv = tv * tv * (3 - 2 * tv);
      for (let x = 0; x < S; x++) {
        const u = x / S * fx, i = u | 0; let tu = u - i; tu = tu * tu * (3 - 2 * tu);
        const a = lat[j * gw + i], b = lat[j * gw + i + 1], c = lat[(j + 1) * gw + i], d = lat[(j + 1) * gw + i + 1];
        out[y * S + x] += amp * ((a + (b - a) * tu) * (1 - tv) + (c + (d - c) * tu) * tv);
      }
    }
    tot += amp; amp *= 0.5;
  }
  for (let k = 0; k < out.length; k++) out[k] /= tot;
  return out;
}
// noise -> a white canvas whose alpha is smoothstep(lo, hi, noise)
function noiseCanvas(field, S, lo, hi) {
  const c = makeCanvas(S, S), x = c.getContext('2d'), im = x.createImageData(S, S), d = im.data;
  for (let k = 0; k < S * S; k++) { let t = (field[k] - lo) / (hi - lo); t = t < 0 ? 0 : t > 1 ? 1 : t; d[k * 4] = d[k * 4 + 1] = d[k * 4 + 2] = 255; d[k * 4 + 3] = t * t * (3 - 2 * t) * 255; }
  x.putImageData(im, 0, 0); return c;
}

// ---------- painting helpers (cell space: 512 px, origin at the centre) ----------
let R = Math.random;
const rnd = (a, b) => a + (b - a) * R();
const gauss = () => (R() + R() + R() - 1.5) / 1.5;
const pick = a => a[(R() * a.length) | 0];
function layer() { const c = makeCanvas(CELL, CELL), x = c.getContext('2d'); x.translate(CELL / 2, CELL / 2); return [c, x]; }
// keep only where the mask is (random offset/scale so each use differs)
function maskWith(x, m, scale = 1.4) {
  x.save(); x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = 'destination-in';
  const s = CELL * scale, ox = -rnd(0, s - CELL), oy = -rnd(0, s - CELL);
  x.drawImage(m, ox, oy, s, s); x.restore();
}
function edgeFade(x, r0 = 0.72) {
  x.save(); x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = 'destination-in';
  const g = x.createRadialGradient(CELL / 2, CELL / 2, CELL / 2 * r0, CELL / 2, CELL / 2, CELL / 2);
  g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(0, 0, CELL, CELL); x.restore();
}
// a tapered stroke along a quadratic curve, built from overlapping discs
function taper(x, x0, y0, cx, cy, x1, y1, w, col, power = 0.6) {
  x.fillStyle = col; const n = Math.max(12, Math.hypot(x1 - x0, y1 - y0) / 1.5 | 0);
  for (let i = 0; i <= n; i++) {
    const t = i / n, a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, c = t * t;
    const px = a * x0 + b * cx + c * x1, py = a * y0 + b * cy + c * y1, r = w / 2 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.15)), power);
    if (r < 0.25) continue; x.beginPath(); x.arc(px, py, r, 0, 6.2832); x.fill();
  }
}
function blob(x, px, py, r, n = 7, j = 0.35) { // irregular little polygon
  x.beginPath(); const a0 = R() * 6.28;
  for (let i = 0; i < n; i++) { const a = a0 + i / n * 6.2832, rr = r * (1 - j / 2 + R() * j); i ? x.lineTo(px + Math.cos(a) * rr, py + Math.sin(a) * rr) : x.moveTo(px + Math.cos(a) * rr, py + Math.sin(a) * rr); }
  x.closePath(); x.fill();
}

// ---------- the decal types (everything is drawn along +x; the instance yaw turns it) ----------
let NZ = null; // shared noise masks
const PAINT = {
  smear(x) { // grimy shoe smear: dragged, streaky, broken up
    const [c, l] = layer();
    l.filter = 'blur(9px)'; l.lineCap = 'round';
    for (let k = 0; k < 6; k++) {
      const y = gauss() * 80, len = rnd(160, 360), x0 = rnd(-220, -20);
      l.strokeStyle = `rgba(50,42,34,${rnd(0.3, 0.5)})`; l.lineWidth = rnd(20, 70);
      l.beginPath(); l.moveTo(x0, y); l.quadraticCurveTo(x0 + len / 2, y + rnd(-30, 30), x0 + len, y + rnd(-26, 26)); l.stroke();
    }
    l.filter = 'none';
    for (let k = 0; k < 60; k++) { // drag striations
      const y = gauss() * 95, x0 = rnd(-230, -20), len = rnd(50, 280);
      l.strokeStyle = `rgba(40,33,27,${rnd(0.18, 0.5)})`; l.lineWidth = rnd(0.7, 2.4);
      l.beginPath(); l.moveTo(x0, y); l.quadraticCurveTo(x0 + len / 2, y + rnd(-6, 6), x0 + len, y + rnd(-8, 8)); l.stroke();
    }
    maskWith(l, NZ.streak, 1.2); maskWith(l, NZ.breakSoft); edgeFade(l, 0.55);
    x.drawImage(c, -CELL / 2, -CELL / 2);
  },
  pivot(x) { // someone turned on the spot: curved rubber/grime arcs round a centre
    const [c, l] = layer(); l.lineCap = 'round';
    const cx = rnd(-30, 30), cy = rnd(-30, 30);
    for (let k = 0; k < 4 + (R() * 4 | 0); k++) {
      const r = rnd(40, 150), a0 = R() * 6.28, span = rnd(0.8, 2.6), w = rnd(5, 16), n = 40;
      for (let i = 0; i <= n; i++) { const t = i / n, a = a0 + span * t, rr = r + rnd(-1.5, 1.5); l.fillStyle = `rgba(30,27,25,${0.42 * Math.sin(Math.PI * t)})`; l.beginPath(); l.arc(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, w / 2 * Math.pow(Math.sin(Math.PI * t), 0.5), 0, 6.2832); l.fill(); }
      for (let j = 0; j < 3; j++) { l.strokeStyle = `rgba(24,22,20,${rnd(0.15, 0.35)})`; l.lineWidth = rnd(0.6, 1.4); const o = rnd(-w / 2, w / 2); l.beginPath(); l.arc(cx, cy, r + o, a0 + 0.1, a0 + span - 0.1); l.stroke(); }
    }
    maskWith(l, NZ.grain, 1.2); maskWith(l, NZ.breakLight); edgeFade(l, 0.7);
    x.filter = 'blur(0.8px)'; x.drawImage(c, -CELL / 2, -CELL / 2); x.filter = 'none';
  },
  heel(x) { // black rubber heel marks: short commas with a soft smudge round them
    const n = 2 + (R() * 3 | 0), [c, l] = layer(), [s, sl] = layer();
    for (let m = 0; m < n; m++) {
      const cx = gauss() * 90, cy = gauss() * 90, a = rnd(-0.6, 0.6) + (R() < 0.3 ? Math.PI / 2 : 0), L = rnd(40, 120), w = rnd(5, 12), bend = rnd(-0.35, 0.35) * L;
      const dx = Math.cos(a) * L / 2, dy = Math.sin(a) * L / 2, nx = -Math.sin(a) * bend, ny = Math.cos(a) * bend;
      taper(l, cx - dx, cy - dy, cx + nx, cy + ny, cx + dx, cy + dy, w, `rgba(16,14,14,${rnd(0.65, 0.9)})`, 0.55);
      taper(sl, cx - dx * 1.2, cy - dy * 1.2, cx + nx, cy + ny, cx + dx * 1.15, cy + dy * 1.15, w * 2.6, 'rgba(24,21,20,0.16)', 0.8);
    }
    maskWith(l, NZ.grain, 1.2);
    x.filter = 'blur(6px)'; x.drawImage(s, -CELL / 2, -CELL / 2); x.filter = 'none'; // soft rubber smudge round each mark
    x.drawImage(c, -CELL / 2, -CELL / 2);
  },
  scratch(x) { // fine scratches in the polish: pale hairlines, mostly one way (a dragged chair), a few strays
    const d0 = rnd(-0.5, 0.5); x.lineCap = 'round';
    const n = 34 + (R() * 34 | 0);
    for (let k = 0; k < n; k++) {
      const stray = R() < 0.22, a = stray ? R() * Math.PI : d0 + rnd(-0.12, 0.12), cx = gauss() * 150, cy = gauss() * 110, L = rnd(30, 250);
      const dx = Math.cos(a) * L / 2, dy = Math.sin(a) * L / 2, b = rnd(-0.06, 0.06) * L;
      const light = R() < 0.82;
      x.strokeStyle = light ? `rgba(128,120,110,${rnd(0.35, 0.75)})` : `rgba(250,248,242,${rnd(0.4, 0.8)})`; // grime caught in the grooves; a few bright fresh ones
      x.lineWidth = rnd(0.6, light ? 1.6 : 1.0);
      if (R() < 0.4) x.setLineDash([rnd(14, 70), rnd(2, 12)]); else x.setLineDash([]);
      x.beginPath(); x.moveTo(cx - dx, cy - dy); x.quadraticCurveTo(cx - Math.sin(a) * b, cy + Math.cos(a) * b, cx + dx, cy + dy); x.stroke();
    }
    x.setLineDash([]);
    edgeFade(x, 0.55);
  },
  grit(x) { // tracked-in sand and grit: clusters of grains and a few pebbles, a faint broken dust haze
    const [h, hl] = layer(); hl.filter = 'blur(18px)';
    const cl = []; for (let k = 0; k < 3 + (R() * 4 | 0); k++) cl.push([gauss() * 120, gauss() * 120, rnd(30, 110)]);
    for (const [cx, cy, sp] of cl) { hl.fillStyle = 'rgba(112,100,84,0.10)'; blob(hl, cx, cy, sp * 1.2, 9, 0.6); }
    maskWith(hl, NZ.breakHard); x.drawImage(h, -CELL / 2, -CELL / 2);
    const pal = [[64, 56, 47], [104, 94, 80], [46, 41, 36], [138, 126, 108], [84, 70, 54]];
    for (const [cx, cy, sp] of cl) for (let i = 0; i < 90 + (R() * 160 | 0); i++) {
      const p = pick(pal), r = 0.5 + Math.pow(R(), 4) * 3.2;
      x.fillStyle = `rgba(${p[0]},${p[1]},${p[2]},${rnd(0.6, 0.95)})`; blob(x, cx + gauss() * sp, cy + gauss() * sp, r, 6, 0.5);
    }
    for (let i = 0; i < 6 + (R() * 8 | 0); i++) {
      const [cx, cy, sp] = pick(cl), px = cx + gauss() * sp, py = cy + gauss() * sp, r = rnd(2.6, 5);
      x.fillStyle = 'rgba(70,62,54,0.95)'; blob(x, px, py, r, 7, 0.4);
      x.fillStyle = 'rgba(190,180,165,0.7)'; blob(x, px - r * 0.3, py - r * 0.3, r * 0.35, 5, 0.3);
    }
    edgeFade(x, 0.7);
  },
  cart(x) { // rubber wheel tracks from a trolley: two curving parallel lines with gaps
    const [c, l] = layer(), sep = rnd(120, 160), A = rnd(10, 40), f = rnd(0.004, 0.009), ph = R() * 6;
    l.lineCap = 'round';
    for (const o of [-sep / 2, sep / 2]) for (const [w, a] of [[rnd(6, 9), 0.5], [2, 0.45]]) {
      l.strokeStyle = `rgba(40,38,36,${a})`; l.lineWidth = w; l.beginPath();
      for (let px = -250; px <= 250; px += 5) { const py = o + A * Math.sin(px * f + ph); px === -250 ? l.moveTo(px, py) : l.lineTo(px, py); }
      l.stroke();
    }
    maskWith(l, NZ.streak, 1.2); maskWith(l, NZ.grain, 1.3); edgeFade(l, 0.5);
    x.drawImage(c, -CELL / 2, -CELL / 2);
  },
  mopstreak(x) { // a dried, dirty mop swipe: faint arcs with striations and a thin tide line
    const [c, l] = layer(), cy = rnd(260, 340), r0 = rnd(250, 300), a0 = -Math.PI / 2 - rnd(0.6, 0.85), a1 = -Math.PI / 2 + rnd(0.6, 0.85);
    for (let k = 0; k < 6; k++) { l.strokeStyle = `rgba(88,76,60,${rnd(0.12, 0.22)})`; l.lineWidth = rnd(10, 28); l.beginPath(); l.arc(0, cy, r0 - k * rnd(8, 16), a0, a1); l.stroke(); }
    for (let k = 0; k < 26; k++) { l.strokeStyle = `rgba(70,60,48,${rnd(0.14, 0.32)})`; l.lineWidth = rnd(0.7, 1.6); l.beginPath(); l.arc(0, cy, r0 - rnd(0, 90), a0 + rnd(0, 0.2), a1 - rnd(0, 0.2)); l.stroke(); }
    l.strokeStyle = 'rgba(66,56,44,0.38)'; l.lineWidth = 2; l.beginPath(); l.arc(0, cy, r0 + 12, a0 + 0.08, a1 - 0.08); l.stroke();
    maskWith(l, NZ.breakSoft); edgeFade(l, 0.6);
    x.drawImage(c, -CELL / 2, -CELL / 2);
  },
  gum(x) { // flattened chewing gum and a few dark specks
    for (let k = 0; k < 1 + (R() < 0.4 ? 1 : 0); k++) {
      const px = gauss() * 70, py = gauss() * 70, r = rnd(16, 26);
      x.fillStyle = `rgba(66,62,60,${rnd(0.85, 0.95)})`; blob(x, px, py, r, 14, 0.25);
      x.fillStyle = 'rgba(40,37,36,0.5)'; for (let i = 0; i < 20; i++) blob(x, px + gauss() * r * 0.5, py + gauss() * r * 0.5, rnd(1, 3), 5, 0.5);
      x.strokeStyle = 'rgba(130,124,118,0.35)'; x.lineWidth = 1.5; x.beginPath(); x.arc(px - r * 0.15, py - r * 0.15, r * 0.7, 3.4, 4.6); x.stroke();
    }
    for (let i = 0; i < 8; i++) { x.fillStyle = `rgba(40,36,32,${rnd(0.4, 0.8)})`; blob(x, gauss() * 160, gauss() * 160, rnd(1.2, 3.5), 6, 0.4); }
    edgeFade(x, 0.8);
  },
  soil(x) { // potting soil: crumbs and clumps, a few white perlite bits
    const cl = []; for (let k = 0; k < 2 + (R() * 3 | 0); k++) cl.push([gauss() * 90, gauss() * 90, rnd(40, 100)]);
    const pal = [[42, 30, 20], [58, 42, 28], [32, 24, 17], [74, 56, 38]];
    const [h, hl] = layer(); hl.filter = 'blur(12px)'; for (const [cx, cy, sp] of cl) { hl.fillStyle = 'rgba(60,44,30,0.16)'; blob(hl, cx, cy, sp, 9, 0.6); }
    maskWith(hl, NZ.breakHard); x.drawImage(h, -CELL / 2, -CELL / 2);
    for (const [cx, cy, sp] of cl) for (let i = 0; i < 160 + (R() * 220 | 0); i++) {
      const p = pick(pal), r = 0.6 + Math.pow(R(), 3) * 5.5;
      x.fillStyle = `rgba(${p[0]},${p[1]},${p[2]},${rnd(0.75, 0.97)})`; blob(x, cx + gauss() * sp, cy + gauss() * sp, r, 6, 0.55);
    }
    for (let i = 0; i < 14; i++) { const [cx, cy, sp] = pick(cl); x.fillStyle = 'rgba(228,226,218,0.85)'; blob(x, cx + gauss() * sp, cy + gauss() * sp, rnd(1, 2.2), 5, 0.4); }
    edgeFade(x, 0.7);
  },
  skid(x) { // one long black rubber skid
    const [c, l] = layer(), W = rnd(14, 24), b = rnd(-60, 60);
    taper(l, -230, rnd(-20, 20), 0, b, 230, rnd(-20, 20), W, 'rgba(22,20,20,0.5)', 0.5);
    l.lineCap = 'round';
    for (let k = 0; k < 7; k++) { const o = rnd(-W / 2, W / 2); l.strokeStyle = `rgba(14,12,12,${rnd(0.15, 0.35)})`; l.lineWidth = rnd(0.8, 2); l.beginPath(); l.moveTo(-200, o * 0.6); l.quadraticCurveTo(0, b + o, 200, o * 0.6); l.stroke(); }
    maskWith(l, NZ.streak, 1.1);
    x.filter = 'blur(1px)'; x.drawImage(c, -CELL / 2, -CELL / 2); x.filter = 'none';
  },
  speckle(x) { // splashed dirty water dried into specks (spray from one direction)
    for (let i = 0; i < 40 + (R() * 60 | 0); i++) {
      const a = rnd(-0.7, 0.7), d = Math.abs(gauss()) * 200, px = Math.cos(a) * d - 120, py = Math.sin(a) * d, r = rnd(1, 4.2) * (1 - d / 400);
      x.fillStyle = `rgba(56,46,37,${rnd(0.45, 0.85)})`; x.beginPath(); x.ellipse(px, py, r * rnd(1, 2.6), r, a, 0, 6.2832); x.fill();
    }
    edgeFade(x, 0.75);
  },
  dust(x) { // dust in a corner: very faint broken haze, hair and fibres, lint
    const [h, hl] = layer(); hl.filter = 'blur(16px)';
    for (let k = 0; k < 8; k++) { hl.fillStyle = 'rgba(100,94,86,0.16)'; blob(hl, gauss() * 120, gauss() * 120, rnd(40, 100), 9, 0.6); }
    maskWith(hl, NZ.breakHard); x.drawImage(h, -CELL / 2, -CELL / 2);
    x.lineCap = 'round';
    for (let k = 0; k < 30 + (R() * 34 | 0); k++) {
      let px = gauss() * 140, py = gauss() * 140, a = R() * 6.28; x.strokeStyle = `rgba(${pick(['70,64,58', '52,48,44', '104,96,86'])},${rnd(0.5, 0.85)})`; x.lineWidth = rnd(0.7, 1.3);
      x.beginPath(); x.moveTo(px, py); for (let s = 0; s < 6; s++) { a += rnd(-0.6, 0.6); px += Math.cos(a) * rnd(5, 14); py += Math.sin(a) * rnd(5, 14); x.lineTo(px, py); } x.stroke();
    }
    for (let i = 0; i < 60; i++) { x.fillStyle = `rgba(92,86,80,${rnd(0.3, 0.6)})`; blob(x, gauss() * 150, gauss() * 150, rnd(0.8, 1.8), 5, 0.4); }
    edgeFade(x, 0.65);
  },
  muddy(x) { // a muddy boot print with a dragged smear trailing off the heel
    const ppm = CELL / 0.8; // pixels per metre in this cell
    const [t, tl] = layer(); tl.lineCap = 'round'; tl.filter = 'blur(2px)';
    for (let k = 0; k < 26; k++) { // the drag: streaks fading back from the heel
      const y = gauss() * 0.03 * ppm, x1 = rnd(-30, 0), x0 = x1 - rnd(60, 200);
      const g = tl.createLinearGradient(x0, 0, x1, 0); g.addColorStop(0, 'rgba(78,60,42,0)'); g.addColorStop(1, `rgba(74,57,40,${rnd(0.25, 0.55)})`);
      tl.strokeStyle = g; tl.lineWidth = rnd(2, 9); tl.beginPath(); tl.moveTo(x0, y + rnd(-6, 6)); tl.lineTo(x1, y); tl.stroke();
    }
    maskWith(tl, NZ.streak, 1.1);
    const [c, l] = layer(); // the print itself (toe towards +x), with tread gaps
    l.save(); l.translate(70, 0); l.scale(ppm, ppm); l.rotate(-Math.PI / 2); l.fillStyle = 'rgba(70,54,38,0.78)';
    l.beginPath(); l.ellipse(0.004, 0.075, 0.052, 0.085, 0, 0, 6.2832); l.fill();
    l.beginPath(); l.ellipse(-0.006, 0.0, 0.04, 0.05, 0, 0, 6.2832); l.fill();
    l.beginPath(); l.ellipse(-0.008, -0.105, 0.042, 0.045, 0, 0, 6.2832); l.fill();
    l.globalCompositeOperation = 'destination-out'; l.fillStyle = 'rgba(0,0,0,0.75)';
    for (let k = -0.035; k < 0.16; k += 0.026) for (let j = -0.05; j < 0.05; j += 0.022) l.fillRect(j + (k * 37 % 0.011), k, 0.012, 0.009); // lugs
    l.fillRect(-0.06, -0.064, 0.12, 0.014); // heel gap
    l.restore();
    maskWith(l, NZ.grain, 1.2);
    x.drawImage(t, -CELL / 2, -CELL / 2); x.drawImage(c, -CELL / 2, -CELL / 2);
    edgeFade(x, 0.7);
  },
};
const CELLS = ['smear', 'pivot', 'heel', 'heel', 'scratch', 'scratch', 'grit', 'grit', 'cart', 'mopstreak', 'gum', 'soil', 'skid', 'speckle', 'dust', 'muddy'];
// which tool deals with which grime: 0 = mop (wet grime, rubber marks), 1 = vacuum (loose grit, soil, dust), 2 = polisher (scratches)
const KIND = { smear: 0, pivot: 0, heel: 0, scratch: 0, grit: 1, cart: 0, mopstreak: 0, gum: 0, soil: 1, skid: 0, speckle: 0, dust: 1, muddy: 0 };
export const TOOL_KIND = { mop: 0, vacuum: 1, polisher: 2 };
const CH = ['0,255,255', '255,0,255', '255,255,0']; // multiply colours that darken just one mask channel (R / G / B)
const CHS = ['255,0,0', '0,255,0', '0,0,255'];    // 'lighten' colours that restore just one channel
const SIZE = { smear: 1.35, pivot: 0.8, heel: 0.65, scratch: 1.1, grit: 1.15, cart: 1.9, mopstreak: 1.6, gum: 0.3, soil: 1.0, skid: 1.4, speckle: 0.8, dust: 1.15, muddy: 0.8 };

function buildAtlas() {
  NZ = {
    breakSoft: noiseCanvas(fbm(CELL, 5, 5, 5, 11), CELL, 0.3, 0.62),
    breakLight: noiseCanvas(fbm(CELL, 6, 6, 5, 17), CELL, 0.18, 0.5),
    breakHard: noiseCanvas(fbm(CELL, 4, 4, 5, 23), CELL, 0.42, 0.68),
    streak: noiseCanvas(fbm(CELL, 1.5, 22, 4, 37), CELL, 0.26, 0.6),
    grain: noiseCanvas(fbm(CELL, 70, 70, 2, 51), CELL, 0.18, 0.55),
  };
  const atlas = makeCanvas(AT, AT), ax = atlas.getContext('2d', { willReadFrequently: true });
  CELLS.forEach((type, i) => {
    const [c, l] = layer(); PAINT[type](l);
    const cx = (i % N) * CELL, cy = (i / N | 0) * CELL;
    ax.drawImage(c, cx, cy);
    const d = ax.getImageData(cx, cy, CELL, CELL).data; let s = 0; for (let k = 3; k < d.length; k += 16) s += d[k];
    DECALS.cover[i] = s / (d.length / 16) / 255;
  });
  return atlas;
}

// ---------- shared GLSL: the shiny-gold 'still to clean' highlight with twinkling glints ----------
export const GOLD_GLSL = `
  vec3 cleanGlow(vec3 col, vec2 wp, vec4 cl, float t, float amt) {
    float cd = length(wp - cl.xy), cf = cl.w * smoothstep(cl.z, cl.z * 0.35, cd) * amt;
    if (cf <= 0.0) return col;
    float pulse = 0.85 + 0.15 * sin(t * 5.0 - cd * 3.0);
    // polished gold, like the arrow over his head: tint what's left to clean a deep, shining gold
    vec3 gold = vec3(1.0, 0.68, 0.14) * (0.95 + 0.6 * pulse) * (0.75 + 0.5 * dot(col, vec3(0.3, 0.5, 0.2)));
    return mix(col, gold, clamp(cf * 1.15, 0.0, 0.92));
  }
  // (experiment) what the tool in hand CAN'T clean glows a dull red
  vec3 wrongGlow(vec3 col, vec2 wp, vec4 cl, float t, float amt) {
    float cd = length(wp - cl.xy), cf = cl.w * smoothstep(cl.z, cl.z * 0.35, cd) * amt;
    if (cf <= 0.0) return col;
    float pulse = 0.85 + 0.15 * sin(t * 5.0 - cd * 3.0);
    vec3 red = vec3(0.95, 0.13, 0.07) * (0.7 + 0.5 * pulse) * (0.7 + 0.5 * dot(col, vec3(0.3, 0.5, 0.2)));
    return mix(col, red, clamp(cf * 0.6, 0.0, 0.45));
  }
  // polisher: a band of golden light sweeps across the dull floor about once a second (a reflection gliding over it)
  vec3 sheenSweep(vec3 col, vec2 wp, vec4 cl, float t, float amt) {
    float cd = length(wp - cl.xy), cf = cl.w * smoothstep(cl.z * 1.6, cl.z * 0.6, cd) * amt;
    if (cf <= 0.0) return col;
    float ph = fract((dot(wp, vec2(0.7071, 0.7071)) - t * 3.6) / 4.2);
    float d = abs(ph - 0.5) * 4.2;
    float band = exp(-d * d / 0.08), core = exp(-d * d / 0.01);
    return col + (vec3(1.0, 0.62, 0.12) * band * 0.9 + vec3(1.0, 0.82, 0.42) * core * 0.45) * cf * 1.3;
  }`;
// one set of glow uniforms shared by the floor, the decals, papers and glass (main loop fills them in)
export const GLOW = { uClean: { value: new THREE.Vector4(0, 0, 3, 0) }, uTime: { value: 0 }, uTool: { value: 0 } };

// ---------- mesh + wipe masks ----------
export function initDecals(floorUniforms) {
  const b = G.bounds, W = (b.maxX - b.minX) * MPX | 0, H = (b.maxZ - b.minZ) * MPX | 0;
  // wipe mask: one channel per tool (R mop, G vacuum, B polisher), white = still dirty
  const mask = makeCanvas(W, H), mx = mask.getContext('2d', { willReadFrequently: true });
  mx.fillStyle = '#fff'; mx.fillRect(0, 0, W, H);
  DECALS.mask = mask; DECALS.mctx = mx; DECALS.W = W; DECALS.H = H;
  DECALS.maskTex = new THREE.CanvasTexture(mask); DECALS.maskTex.flipY = false; // row 0 == minZ
  // dull, scuffed patches of floor (red channel: 1 = no shine) for the polisher
  const rough = makeCanvas(W, H), rx = rough.getContext('2d', { willReadFrequently: true });
  rx.fillStyle = '#000'; rx.fillRect(0, 0, W, H);
  DECALS.rough = rough; DECALS.rctx = rx; DECALS.roughTex = new THREE.CanvasTexture(rough); DECALS.roughTex.flipY = false;
  if (floorUniforms && floorUniforms.tRough) floorUniforms.tRough.value = DECALS.roughTex;
  const atlas = buildAtlas();
  const tex = new THREE.CanvasTexture(atlas); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8; tex.generateMipmaps = true;
  DECALS.atlas = atlas; DECALS.tex = tex;
  const geo = new THREE.PlaneGeometry(1, 1); geo.rotateX(-Math.PI / 2);
  const aCell = new THREE.InstancedBufferAttribute(new Float32Array(MAXD * 4), 4); geo.setAttribute('aCell', aCell);
  const aKind = new THREE.InstancedBufferAttribute(new Float32Array(MAXD), 1); geo.setAttribute('aKind', aKind);
  const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, roughness: 0.9, metalness: 0, envMapIntensity: 0.5,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  const U = { uMask: { value: DECALS.maskTex }, uMaskR: { value: new THREE.Vector4(b.minX, b.minZ, b.maxX - b.minX, b.maxZ - b.minZ) },
    uClean: GLOW.uClean, uTime: GLOW.uTime, uTool: GLOW.uTool };
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aCell; attribute float aKind; varying vec2 vDW; varying float vOp; varying vec3 vSel;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvMapUv = aCell.xy + uv * aCell.z;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvec4 dw = modelMatrix * instanceMatrix * vec4(transformed, 1.0); vDW = dw.xz; vOp = aCell.w; vSel = vec3(aKind < 0.5 ? 1.0 : 0.0, aKind > 0.5 && aKind < 1.5 ? 1.0 : 0.0, aKind > 1.5 ? 1.0 : 0.0);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uMask; uniform vec4 uMaskR; uniform vec4 uClean; uniform float uTime; uniform float uTool; varying vec2 vDW; varying float vOp; varying vec3 vSel;' + GOLD_GLSL)
      .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.a = min(1.0, diffuseColor.a * 1.6) * dot(texture2D(uMask, (vDW - uMaskR.xy) / uMaskR.zw).rgb, vSel) * vOp;')
      .replace('#include <opaque_fragment>', `
        float mine = dot(vSel, vec3(uTool < 0.5 ? 1.0 : 0.0, uTool > 0.5 && uTool < 1.5 ? 1.0 : 0.0, uTool > 1.5 ? 1.0 : 0.0));
        outgoingLight = cleanGlow(outgoingLight, vDW, uClean, uTime, mine);
        outgoingLight = wrongGlow(outgoingLight, vDW, uClean, uTime, 1.0 - mine);
        #include <opaque_fragment>`);
  };
  const mesh = new THREE.InstancedMesh(geo, mat, MAXD); mesh.count = 0;
  mesh.frustumCulled = false; mesh.receiveShadow = true; mesh.renderOrder = 0.5;
  Object.assign(mesh.userData, { noReflect: true, noAO: true, noProbe: true });
  G.scene.add(mesh); DECALS.mesh = mesh; DECALS.aCell = aCell; DECALS.aKind = aKind;
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
// type: one of the names above (a random variant of it); size in metres (defaults to its natural size)
export function addDecal(type, x, z, size, yaw = Math.random() * 6.2832, opacity = 1, aspect = 1) {
  const M = DECALS.mesh; if (!M || M.count >= MAXD) return null;
  const idx = CELLS.map((t, i) => t === type ? i : -1).filter(i => i >= 0); if (!idx.length) return null;
  const cell = idx[(Math.random() * idx.length) | 0], s = size || SIZE[type] * (0.8 + Math.random() * 0.45);
  const i = M.count++, sx = s * aspect, sz = s;
  _m.compose(_p.set(x, 0.0035 + i * 0.000004, z), _q.setFromAxisAngle(_up, yaw), _s.set(sx, 1, sz)); M.setMatrixAt(i, _m); M.instanceMatrix.needsUpdate = true;
  DECALS.aCell.setXYZW(i, (cell % N) / N, 1 - ((cell / N | 0) + 1) / N, 1 / N, opacity); DECALS.aCell.needsUpdate = true;
  const kind = KIND[type] ?? 0; DECALS.aKind.setX(i, kind); DECALS.aKind.needsUpdate = true;
  const d = { x, z, sx, sz, yaw, cell, kind, op: opacity, rad: Math.hypot(sx, sz) / 2, rem: 1 };
  DECALS.list.push(d);
  // a fresh decal is fully dirty, even where the floor was cleaned before (only its own tool's channel)
  const [px, py] = toMask(x, z); const mx = DECALS.mctx;
  mx.save(); mx.globalCompositeOperation = 'lighten'; mx.fillStyle = `rgb(${CHS[kind]})`; mx.beginPath(); mx.arc(px, py, d.rad * MPX * 0.95, 0, 6.2832); mx.fill(); mx.restore();
  DECALS.maskDirty = true;
  return d;
}
const toMask = (x, z) => [(x - G.bounds.minX) * MPX, (z - G.bounds.minZ) * MPX];

// a tool wipes its own kind of grime (only touches the mask where there's actually such a decal)
export function wipeDecals(x, z, r, strength, kind = 0) {
  if (!DECALS.mesh) return;
  let near = false; for (const d of DECALS.list) if (d.kind === kind && Math.hypot(d.x - x, d.z - z) < r + d.rad) { near = true; break; }
  if (!near) return;
  const mx = DECALS.mctx, [px, py] = toMask(x, z), rr = r * MPX, a = Math.min(1, strength * 0.9);
  const g = mx.createRadialGradient(px, py, 0, px, py, rr);
  g.addColorStop(0, `rgba(${CH[kind]},${a})`); g.addColorStop(0.7, `rgba(${CH[kind]},${a * 0.7})`); g.addColorStop(1, `rgba(${CH[kind]},0)`);
  mx.save(); mx.globalCompositeOperation = 'multiply'; mx.fillStyle = g; mx.beginPath(); mx.arc(px, py, rr, 0, 6.2832); mx.fill(); mx.restore();
  DECALS.maskDirty = true;
}
// the polisher buffs dull floor back to a shine (and takes scratches out)
export function polishAt(x, z, r, strength) {
  if (!DECALS.rctx) return;
  const rx = DECALS.rctx, [px, py] = toMask(x, z), rr = r * MPX, a = Math.min(1, strength);
  wipeDecals(x, z, r, strength, 2);
  // (only where the floor is actually dull: otherwise the polish texture would be re-sent to the GPU for nothing)
  const x0 = Math.max(0, px - rr | 0), y0 = Math.max(0, py - rr | 0), w = Math.min(DECALS.W - x0, Math.ceil(2 * rr)), h = Math.min(DECALS.H - y0, Math.ceil(2 * rr));
  if (w <= 0 || h <= 0) return;
  { const d = rx.getImageData(x0, y0, w, h).data; let any = false; for (let i = 0; i < d.length; i += 8) if (d[i] > 2) { any = true; break; } if (!any) return; }
  const g = rx.createRadialGradient(px, py, 0, px, py, rr);
  g.addColorStop(0, `rgba(0,0,0,${a})`); g.addColorStop(0.7, `rgba(0,0,0,${a * 0.7})`); g.addColorStop(1, 'rgba(0,0,0,0)');
  rx.fillStyle = g; rx.beginPath(); rx.arc(px, py, rr, 0, 6.2832); rx.fill();
  DECALS.roughDirty = true;
}
export function dullToPolish(x, z, r) {
  if (!DECALS.rctx) return false;
  const [px, py] = toMask(x, z), R = Math.max(2, r * MPX | 0);
  const x0 = Math.max(0, px - R | 0), y0 = Math.max(0, py - R | 0), w = Math.min(DECALS.W - x0, 2 * R), h = Math.min(DECALS.H - y0, 2 * R);
  if (w <= 0 || h <= 0) return false;
  const d = DECALS.rctx.getImageData(x0, y0, w, h).data; let n = 0; for (let i = 0; i < d.length; i += 16) if (d[i] > 40) n++;
  return n > d.length / 16 * 0.05;
}
// how much of the floor is still dull (fraction of the floor area, weighted)
export function roughLeft() {
  if (!DECALS.rctx) return 0;
  const S = 8, w = DECALS.W / S | 0, h = DECALS.H / S | 0;
  if (!DECALS.rsmall) { DECALS.rsmall = makeCanvas(w, h); DECALS.rsx = DECALS.rsmall.getContext('2d', { willReadFrequently: true }); }
  DECALS.rsx.clearRect(0, 0, w, h); DECALS.rsx.drawImage(DECALS.rough, 0, 0, w, h);
  const d = DECALS.rsx.getImageData(0, 0, w, h).data; let t = 0; for (let i = 0; i < d.length; i += 4) t += d[i];
  return t / (w * h * 255);
}
let upT = 0;
export function updateDecals(dt) {
  upT -= dt;
  if ((DECALS.maskDirty || DECALS.roughDirty) && upT <= 0) {
    if (DECALS.maskDirty) DECALS.maskTex.needsUpdate = true;
    if (DECALS.roughDirty) DECALS.roughTex.needsUpdate = true;
    DECALS.maskDirty = DECALS.roughDirty = false; upT = 0.05;
  }
}
// how much decal grime is left, in the same units as the dirt layer (fraction of the floor area)
export function decalDirt() {
  if (!DECALS.mesh || !DECALS.list.length) return 0;
  const d0 = DECALS.mctx.getImageData(0, 0, DECALS.W, DECALS.H).data, W = DECALS.W, H = DECALS.H;
  const at = (x, z, ch) => { let [px, py] = toMask(x, z); px = Math.max(0, Math.min(W - 1, px | 0)); py = Math.max(0, Math.min(H - 1, py | 0)); return d0[(py * W + px) * 4 + ch] / 255; };
  let sum = 0;
  for (const d of DECALS.list) {
    const c = Math.cos(d.yaw), s = Math.sin(d.yaw); let m = at(d.x, d.z, d.kind), n = 1;
    for (const [u, v] of [[0.28, 0], [-0.28, 0], [0, 0.28], [0, -0.28], [0.2, 0.2], [-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2]]) { m += at(d.x + u * d.sx * c + v * d.sz * s, d.z - u * d.sx * s + v * d.sz * c, d.kind); n++; }
    d.rem = m / n;
    sum += d.rem * d.sx * d.sz * DECALS.cover[d.cell] * d.op;
  }
  const b = G.bounds; return sum / ((b.maxX - b.minX) * (b.maxZ - b.minZ));
}
// anything left to wipe within r of (x, z)?
export function decalsToClean(x, z, r, kind = 0) {
  if (!DECALS.mesh) return false;
  for (const d of DECALS.list) {
    if (d.kind !== kind) continue;
    const dist = Math.hypot(d.x - x, d.z - z); if (dist > r + d.rad * 0.7) continue;
    const k = dist > 1e-3 ? Math.min(1, r / dist) : 0, [px, py] = toMask(x + (d.x - x) * k, z + (d.z - z) * k);
    const v = DECALS.mctx.getImageData(Math.max(0, px | 0), Math.max(0, py | 0), 1, 1).data[kind] / 255;
    if (v > 0.3) return true;
  }
  return false;
}

// scatter the lobby's grime: a busy bank floor, worst at the entrance and along the robbers' route
export function seedDecals(trails = []) {
  const B = G.bounds;
  const free = (x, z, r) => x > B.minX + 0.4 && x < B.maxX - 0.4 && z > B.minZ + 0.4 && z < B.maxZ - 0.4 &&
    !G.colliders.some(b => b.active && b.y0 < 0.4 && pointInBox(b, x, z, r * 0.35));
  const place = (type, fx, fz, size, yaw, op) => { for (let t = 0; t < 24; t++) { const x = fx(), z = fz(); if (free(x, z, (size || SIZE[type]) / 2)) return addDecal(type, x, z, size, yaw ?? Math.random() * 6.2832, op ?? (0.75 + Math.random() * 0.25)); } return null; };
  const anyX = () => B.minX + 0.6 + Math.random() * (B.maxX - B.minX - 1.2), anyZ = () => B.minZ + 0.6 + Math.random() * (B.maxZ - B.minZ - 1.2);
  // entrance: grit, mud and smears where everyone wipes their feet (or doesn't)
  for (let i = 0; i < 4; i++) place('grit', () => -16.4 + Math.random() * 2.6, () => 6.6 + Math.random() * 3.6, 0.8 + Math.random() * 0.5);
  for (let i = 0; i < 2; i++) place('muddy', () => -15.8 + Math.random() * 3, () => 7 + Math.random() * 3, null, Math.PI / 2 + (Math.random() - 0.5) * 0.8);
  for (let i = 0; i < 2; i++) place('smear', () => -15.5 + Math.random() * 3, () => 6.5 + Math.random() * 4);
  // along the robbers' route: heel marks, skids, a smeared print
  for (const tr of trails) for (let i = 0; i < 3; i++) {
    const k = Math.random() * (tr.length - 1), j = k | 0, f = k - j, [x0, z0] = tr[j], [x1, z1] = tr[j + 1];
    const x = x0 + (x1 - x0) * f, z = z0 + (z1 - z0) * f, along = Math.atan2(x1 - x0, z1 - z0) - Math.PI / 2;
    const type = pick(['heel', 'heel', 'skid', 'muddy']);
    place(type, () => x + (Math.random() - 0.5) * 0.8, () => z + (Math.random() - 0.5) * 0.8, null, along + (Math.random() - 0.5) * 0.6);
  }
  // everyday wear all over
  const spread = { smear: 10, pivot: 6, heel: 12, scratch: 10, grit: 4, cart: 3, mopstreak: 4, gum: 6, speckle: 6, skid: 3 }; // (about a third less than before)
  for (const t in spread) for (let i = 0; i < spread[t]; i++) place(t, anyX, anyZ);
  // dull, scuffed lanes where the polish has worn off (the polisher brings the shine back)
  seedDull(trails);
  // dust gathers along the walls
  for (let i = 0; i < 8; i++) {
    const side = Math.random() * 4 | 0;
    const fx = side === 0 ? () => B.minX + 0.5 + Math.random() * 0.4 : side === 1 ? () => B.maxX - 0.5 - Math.random() * 0.4 : anyX;
    const fz = side === 2 ? () => B.minZ + 0.5 + Math.random() * 0.4 : side === 3 ? () => B.maxZ - 0.5 - Math.random() * 0.4 : anyZ;
    place('dust', fx, fz);
  }
}

// worn polish: long, streaky lanes along the busy routes plus patches at the doors and the counter
function seedDull(trails) {
  const lanes = [];
  for (const tr of trails.slice(0, 3)) for (let i = 0; i < tr.length - 1; i++) lanes.push([tr[i][0], tr[i][1], tr[i + 1][0], tr[i + 1][1], rnd(0.8, 1.2), 1]); // (a few of the robbers' routes: the lobby's main walkways)
  paintDull(lanes, [[-15.8, 8.6, 2.2, 1], [-1.5, -8.5, 2.0, 0.9], [9.2, -9.4, 1.8, 0.9], [-11, -7, 1.8, 0.85]]);
}
// paint dull floor into the polish mask: lanes [x0, z0, x1, z1, halfWidth, alpha], patches [x, z, r, alpha]
export function paintDull(lanes, patches, lo = 0.3, hi = 0.46) {
  const rx = DECALS.rctx; if (!rx) return;
  const W = DECALS.W, H = DECALS.H;
  const c = makeCanvas(W, H), x = c.getContext('2d');
  x.filter = 'blur(14px)';
  const lane = (x0, z0, x1, z1, w, a) => {
    const [p0x, p0y] = toMask(x0, z0), [p1x, p1y] = toMask(x1, z1), n = Math.max(2, Math.hypot(p1x - p0x, p1y - p0y) / 12 | 0);
    for (let i = 0; i <= n; i++) { const t = i / n, px = p0x + (p1x - p0x) * t + rnd(-8, 8), py = p0y + (p1y - p0y) * t + rnd(-8, 8);
      x.fillStyle = `rgba(255,255,255,${a * rnd(0.6, 1)})`; x.beginPath(); x.ellipse(px, py, w * MPX * rnd(0.7, 1.2), w * MPX * rnd(0.5, 0.9), Math.atan2(p1y - p0y, p1x - p0x), 0, 6.2832); x.fill(); }
  };
  const patch = (cx, cz, r, a) => { for (let k = 0; k < 7; k++) { const [px, py] = toMask(cx + gauss() * r * 0.5, cz + gauss() * r * 0.5); x.fillStyle = `rgba(255,255,255,${a * rnd(0.5, 1)})`; x.beginPath(); x.ellipse(px, py, r * MPX * rnd(0.4, 0.8), r * MPX * rnd(0.3, 0.6), rnd(0, 3), 0, 6.2832); x.fill(); } };
  for (const l of lanes) lane(...l);
  for (const p of patches) patch(...p);
  x.filter = 'none';
  // break it up so it reads as worn, uneven polish rather than smooth blobs
  const nz = noiseCanvas(fbm(256, 7, 7, 4, 77), 256, lo, hi);
  x.globalCompositeOperation = 'destination-in'; x.drawImage(nz, 0, 0, W, H); x.globalCompositeOperation = 'source-over';
  // white on black, red channel used by the floor shader
  rx.save(); rx.globalCompositeOperation = 'lighten'; rx.drawImage(c, 0, 0); rx.restore();
  DECALS.roughDirty = true;
}
// how dull a rectangle of floor still is: m^2 of floor that still looks dull (thr > 0), or the plain sum of the mask
export function roughIn(r, thr = 0) {
  if (!DECALS.rctx) return 0;
  const [x0, y0] = toMask(r.x0, r.z0), [x1, y1] = toMask(r.x1, r.z1);
  const a = Math.max(0, x0 | 0), b = Math.max(0, y0 | 0), w = Math.min(DECALS.W, x1 | 0) - a, h = Math.min(DECALS.H, y1 | 0) - b;
  if (w <= 0 || h <= 0) return 0;
  const d = DECALS.rctx.getImageData(a, b, w, h).data; let t = 0;
  if (thr > 0) { const k = thr * 255; for (let i = 0; i < d.length; i += 8) if (d[i] > k) t += 255; }
  else for (let i = 0; i < d.length; i += 8) t += d[i];
  return t * 2 / 255 / (MPX * MPX);
}
// the dull floor in a rectangle as a coarse grid (one read of the mask): cell centres with the share still dull
export function roughCells(r, cell = 0.7, thr = 0.2) {
  if (!DECALS.rctx) return [];
  const [x0, y0] = toMask(r.x0, r.z0), [x1, y1] = toMask(r.x1, r.z1);
  const a = Math.max(0, x0 | 0), b = Math.max(0, y0 | 0), w = Math.min(DECALS.W, x1 | 0) - a, h = Math.min(DECALS.H, y1 | 0) - b;
  if (w <= 0 || h <= 0) return [];
  const d = DECALS.rctx.getImageData(a, b, w, h).data, cp = Math.max(2, cell * MPX | 0), k = thr * 255, out = [];
  for (let cy = 0; cy < h; cy += cp) for (let cx = 0; cx < w; cx += cp) {
    let n = 0, t = 0;
    for (let y = cy; y < Math.min(h, cy + cp); y += 2) for (let x = cx; x < Math.min(w, cx + cp); x += 2) { t++; if (d[(y * w + x) * 4] > k) n++; }
    out.push({ x: G.bounds.minX + (a + cx + cp / 2) / MPX, z: G.bounds.minZ + (b + cy + cp / 2) / MPX, f: n / t });
  }
  return out;
}
// fade the dull out of a rectangle a little (the last of it buffed away at once)
export function fadeDull(r, a) {
  if (!DECALS.rctx) return;
  const [x0, y0] = toMask(r.x0, r.z0), [x1, y1] = toMask(r.x1, r.z1);
  const rx = DECALS.rctx; rx.fillStyle = `rgba(0,0,0,${Math.min(1, a)})`; rx.fillRect(x0, y0, x1 - x0, y1 - y0);
  DECALS.roughDirty = true;
}
