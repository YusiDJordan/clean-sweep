// Procedural canvas textures: marble floor, stone walls, signage, paper, cracks, blob shadow
import * as THREE from 'three';
import { makeCanvas, canvasTex, rand } from './state.js';

let seed = 1337;
const srnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

function veins(ctx, x, y, w, h, count, color, width, blur) {
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.filter = blur ? `blur(${blur}px)` : 'none';
  ctx.strokeStyle = color; ctx.lineCap = 'round';
  for (let i = 0; i < count; i++) {
    let px = x + srnd() * w, py = y + srnd() * h;
    let ang = srnd() * Math.PI * 2;
    ctx.lineWidth = width * (0.4 + srnd());
    ctx.beginPath(); ctx.moveTo(px, py);
    const segs = 6 + Math.floor(srnd() * 10);
    for (let s = 0; s < segs; s++) {
      ang += (srnd() - 0.5) * 1.1;
      const L = (w / 6) * (0.4 + srnd());
      const cx = px + Math.cos(ang + 0.6) * L * 0.5, cy = py + Math.sin(ang + 0.6) * L * 0.5;
      px += Math.cos(ang) * L; py += Math.sin(ang) * L;
      ctx.quadraticCurveTo(cx, cy, px, py);
      if (srnd() < 0.25) { // branch
        ctx.stroke(); ctx.lineWidth *= 0.6; ctx.beginPath(); ctx.moveTo(px, py);
      }
    }
    ctx.stroke();
  }
  ctx.restore();
}

// Marble floor: 8x8 tiles of 1m. Returns {map, rough}
export function marbleFloor() {
  const N = 8, P = 256, S = N * P;
  const c = makeCanvas(S, S), x = c.getContext('2d');
  const r = makeCanvas(512, 512), rx = r.getContext('2d');
  rx.fillStyle = '#3a3a3a'; rx.fillRect(0, 0, 512, 512);
  const bases = [[224, 222, 218], [210, 210, 212], [232, 229, 223], [200, 200, 204], [218, 215, 210], [190, 191, 196]];
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const X = i * P, Y = j * P;
    const b = bases[Math.floor(srnd() * bases.length)];
    const k = 0.92 + srnd() * 0.12;
    x.fillStyle = `rgb(${b[0] * k | 0},${b[1] * k | 0},${b[2] * k | 0})`;
    x.fillRect(X, Y, P, P);
    // cloudy blotches
    for (let n = 0; n < 14; n++) {
      const gx = X + srnd() * P, gy = Y + srnd() * P, gr = 30 + srnd() * 110;
      const g = x.createRadialGradient(gx, gy, 0, gx, gy, gr);
      const dark = srnd() < 0.5;
      g.addColorStop(0, dark ? 'rgba(120,120,128,0.10)' : 'rgba(255,255,255,0.14)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g; x.fillRect(X, Y, P, P);
    }
    veins(x, X, Y, P, P, 3, 'rgba(110,110,118,0.35)', 3, 4);
    veins(x, X, Y, P, P, 4, 'rgba(90,90,100,0.45)', 1.2, 0.6);
    veins(x, X, Y, P, P, 2, 'rgba(255,255,255,0.5)', 2, 2);
    // per-tile roughness variation
    const rv = 40 + srnd() * 30 | 0;
    rx.fillStyle = `rgb(${rv},${rv},${rv})`; rx.fillRect(i * 64 + 1, j * 64 + 1, 62, 62);
  }
  // grout
  x.strokeStyle = 'rgba(70,68,66,0.85)'; x.lineWidth = 3;
  for (let i = 0; i <= N; i++) { x.beginPath(); x.moveTo(i * P, 0); x.lineTo(i * P, S); x.stroke(); x.beginPath(); x.moveTo(0, i * P); x.lineTo(S, i * P); x.stroke(); }
  rx.strokeStyle = '#d0d0d0'; rx.lineWidth = 2;
  for (let i = 0; i <= N; i++) { rx.beginPath(); rx.moveTo(i * 64, 0); rx.lineTo(i * 64, 512); rx.stroke(); rx.beginPath(); rx.moveTo(0, i * 64); rx.lineTo(512, i * 64); rx.stroke(); }
  const map = canvasTex(c, true, true);
  const rough = canvasTex(r, false, true);
  return { map, rough };
}

// Large dark stone wall panels
export function stonePanels(dark = false, w = 1024, h = 1024, cols = 2, rows = 3) {
  const c = makeCanvas(w, h), x = c.getContext('2d');
  const base = dark ? [70, 72, 78] : [150, 148, 144];
  const pw = w / cols, ph = h / rows;
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const k = 0.9 + srnd() * 0.15;
    x.fillStyle = `rgb(${base[0] * k | 0},${base[1] * k | 0},${base[2] * k | 0})`;
    x.fillRect(i * pw, j * ph, pw, ph);
    for (let n = 0; n < 10; n++) {
      const gx = i * pw + srnd() * pw, gy = j * ph + srnd() * ph, gr = 40 + srnd() * 140;
      const g = x.createRadialGradient(gx, gy, 0, gx, gy, gr);
      g.addColorStop(0, srnd() < 0.5 ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.06)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g; x.fillRect(i * pw, j * ph, pw, ph);
    }
    veins(x, i * pw, j * ph, pw, ph, 2, dark ? 'rgba(150,150,160,0.25)' : 'rgba(90,90,90,0.25)', 1.5, 1);
  }
  x.strokeStyle = 'rgba(0,0,0,0.6)'; x.lineWidth = 4;
  for (let i = 0; i <= cols; i++) { x.beginPath(); x.moveTo(i * pw, 0); x.lineTo(i * pw, h); x.stroke(); }
  for (let j = 0; j <= rows; j++) { x.beginPath(); x.moveTo(0, j * ph); x.lineTo(w, j * ph); x.stroke(); }
  return canvasTex(c, true, true);
}

export function brushedMetal() {
  const c = makeCanvas(256, 256), x = c.getContext('2d');
  x.fillStyle = '#8a8a8a'; x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1400; i++) {
    const y = Math.random() * 256, a = Math.random() * 0.12;
    x.fillStyle = Math.random() < 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`;
    x.fillRect(0, y, 256, 1);
  }
  return canvasTex(c, false, true);
}

// Signage: lines = [{text, font, color, size}], vertical layout
export function signTex(w, h, bg, lines, opts = {}) {
  const c = makeCanvas(w, h), x = c.getContext('2d');
  x.fillStyle = bg; x.fillRect(0, 0, w, h);
  if (opts.border) { x.strokeStyle = opts.border; x.lineWidth = 6; x.strokeRect(10, 10, w - 20, h - 20); }
  let y = opts.top || h * 0.2;
  for (const L of lines) {
    if (L.gap) { y += L.gap; continue; }
    x.font = `${L.weight || 600} ${L.size}px ${L.font || "'Oswald','Arial Narrow',Arial,sans-serif"}`;
    x.fillStyle = L.color || '#ddd';
    x.textAlign = L.align || 'center';
    x.direction = L.rtl ? 'rtl' : 'ltr';
    const xx = L.align === 'left' ? (L.x || 40) : L.align === 'right' ? w - (L.x || 40) : w / 2;
    if (L.spacing) x.letterSpacing = L.spacing + 'px';
    x.fillText(L.text, xx, y + L.size * 0.8);
    x.letterSpacing = '0px';
    y += L.size * (L.lh || 1.25);
  }
  if (opts.draw) opts.draw(x, w, h);
  return canvasTex(c, true);
}

// A4 paper texture with fake printed lines (atlas: 4 variants: 3 docs + banknote)
export function paperAtlas() {
  const W = 1024, H = 720, c = makeCanvas(W, H), x = c.getContext('2d');
  const cw = W / 4;
  for (let v = 0; v < 4; v++) {
    const X = v * cw;
    if (v === 3) { // a $100-style banknote, drawn landscape and turned to fit the cell (long side along the cell)
      const bw = H, bh = Math.round(H * 0.425), b = makeCanvas(bw, bh), y = b.getContext('2d');
      const bg = y.createLinearGradient(0, 0, bw, bh); bg.addColorStop(0, '#6f7f71'); bg.addColorStop(0.45, '#869487'); bg.addColorStop(0.62, '#8d8f80'); bg.addColorStop(1, '#6a7a6c');
      y.fillStyle = bg; y.fillRect(0, 0, bw, bh);
      y.strokeStyle = 'rgba(40,62,48,0.18)'; y.lineWidth = 1; // fine engraved line-work
      for (let i = -bh; i < bw; i += 5) { y.beginPath(); y.moveTo(i, 0); y.lineTo(i + bh * 0.6, bh); y.stroke(); }
      for (let i = 0; i < 14; i++) { y.beginPath(); y.ellipse(bw * 0.5, bh * 0.5, 40 + i * 12, 22 + i * 7, 0, 0, Math.PI * 2); y.stroke(); }
      y.strokeStyle = '#26382c'; y.lineWidth = 9; y.strokeRect(8, 8, bw - 16, bh - 16); // dark border
      y.strokeStyle = 'rgba(38,56,44,0.7)'; y.lineWidth = 2; y.strokeRect(20, 20, bw - 40, bh - 40);
      // portrait oval with a generic figure
      const ox = bw * 0.5, oy = bh * 0.5;
      y.fillStyle = '#c9cab6'; y.beginPath(); y.ellipse(ox, oy, bh * 0.27, bh * 0.36, 0, 0, Math.PI * 2); y.fill();
      y.strokeStyle = '#2d4234'; y.lineWidth = 5; y.stroke();
      y.fillStyle = '#4c5a50'; y.beginPath(); y.ellipse(ox, oy - bh * 0.06, bh * 0.1, bh * 0.13, 0, 0, Math.PI * 2); y.fill();
      y.beginPath(); y.ellipse(ox, oy + bh * 0.26, bh * 0.22, bh * 0.16, 0, Math.PI, 0); y.fill();
      // blue security ribbon, copper inkwell, colour-shifting 100
      y.fillStyle = '#3f6fc4'; y.fillRect(ox + bh * 0.42, 14, 10, bh - 28);
      y.fillStyle = 'rgba(255,255,255,0.35)'; for (let k = 22; k < bh - 22; k += 16) y.fillRect(ox + bh * 0.42 + 2, k, 6, 7);
      y.fillStyle = '#a5672e'; y.beginPath(); y.roundRect(bw * 0.7, bh * 0.52, bh * 0.2, bh * 0.22, 8); y.fill();
      y.textAlign = 'center'; y.textBaseline = 'middle';
      y.font = `bold ${bh * 0.34 | 0}px Georgia, serif`; y.fillStyle = '#9a6a35'; y.fillText('100', bw * 0.84, bh * 0.72);
      y.font = `bold ${bh * 0.16 | 0}px Georgia, serif`; y.fillStyle = '#26382c';
      y.fillText('100', 62, 46); y.fillText('100', bw - 62, 46); y.fillText('100', 62, bh - 42);
      y.font = `${bh * 0.075 | 0}px Georgia, serif`; y.fillText('FEDERAL RESERVE NOTE', bw * 0.3, bh * 0.16); y.fillText('ONE HUNDRED', bw * 0.27, bh * 0.84);
      x.save(); x.translate(X + cw / 2, H / 2); x.rotate(Math.PI / 2); x.drawImage(b, -bw / 2, -cw / 2, bw, cw); x.restore();
      continue;
    }
    x.fillStyle = v === 1 ? '#f4f1e8' : '#fafafa'; x.fillRect(X, 0, cw, H);
    x.fillStyle = '#3a4a6a'; x.fillRect(X + 24, 28, 80, 20);
    x.fillStyle = 'rgba(40,40,40,0.55)';
    for (let l = 0; l < 22; l++) {
      const w = (cw - 56) * (0.5 + Math.random() * 0.5);
      x.fillRect(X + 24, 80 + l * 26, w, 8);
    }
    if (v === 2) { x.strokeStyle = 'rgba(30,30,30,0.6)'; x.lineWidth = 2; x.strokeRect(X + 24, 300, cw - 48, 240); }
  }
  return canvasTex(c, true);
}

export function crackTex(seedv) {
  const S = 512, c = makeCanvas(S, S), x = c.getContext('2d');
  x.clearRect(0, 0, S, S);
  x.strokeStyle = 'rgba(255,255,255,0.9)'; x.lineCap = 'round';
  const cx = S / 2, cy = S / 2;
  const arms = 9 + Math.floor(Math.random() * 6);
  const pts = [];
  for (let a = 0; a < arms; a++) {
    let ang = (a / arms) * Math.PI * 2 + Math.random() * 0.4, px = cx, py = cy;
    const arr = [];
    x.lineWidth = 2.2; x.beginPath(); x.moveTo(px, py);
    for (let s = 0; s < 8; s++) { ang += (Math.random() - 0.5) * 0.5; px += Math.cos(ang) * 30; py += Math.sin(ang) * 30; x.lineTo(px, py); arr.push([px, py]); }
    x.stroke(); pts.push(arr);
  }
  x.lineWidth = 1.2;
  for (let ring = 1; ring < 6; ring++) {
    x.beginPath();
    for (let a = 0; a <= arms; a++) { const p = pts[a % arms][Math.min(ring, 7)]; if (a === 0) x.moveTo(p[0], p[1]); else x.lineTo(p[0], p[1]); }
    x.stroke();
  }
  const g = x.createRadialGradient(cx, cy, 0, cx, cy, 30); g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c); return t;
}

export function blobTex() {
  const c = makeCanvas(128, 128), x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(0,0,0,0.75)'); g.addColorStop(0.5, 'rgba(0,0,0,0.35)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}
export function glowTex(col = '255,220,160') {
  const c = makeCanvas(128, 128), x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, `rgba(${col},1)`); g.addColorStop(0.25, `rgba(${col},0.5)`); g.addColorStop(1, `rgba(${col},0)`);
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
export function ringTex() {
  const c = makeCanvas(128, 128), x = c.getContext('2d');
  x.strokeStyle = 'rgba(255,255,255,1)'; x.lineWidth = 8; x.beginPath(); x.arc(64, 64, 52, 0, Math.PI * 2); x.stroke();
  return new THREE.CanvasTexture(c);
}

// Knit kufi texture / fabric weave noise
export function fabricTex(base = '#efeae0', lines = 'rgba(0,0,0,0.05)') {
  const c = makeCanvas(128, 128), x = c.getContext('2d');
  x.fillStyle = base; x.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 128; i += 2) { x.fillStyle = lines; x.fillRect(0, i, 128, 1); }
  for (let i = 0; i < 300; i++) { x.fillStyle = `rgba(0,0,0,${Math.random() * 0.04})`; x.fillRect(Math.random() * 128, Math.random() * 128, 2, 2); }
  return canvasTex(c, true, true);
}
