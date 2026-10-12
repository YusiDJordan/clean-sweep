// HUD: portrait, health, special charges, combo, minimap, damage ledger, prompts, enemy indicators
import * as THREE from 'three';
import { G } from './state.js';
import { FX, litterCount, cleanSpots } from './fx.js';
import { chairs } from './destruct.js';
import { nearCart, nearBarrow } from './tools.js';
import { SECRET } from './secret.js';
import { SFX } from './audio.js';

// 100%: a little fanfare and confetti bursting out of the number
function celebrate() {
  const A = SFX;
  if (A.ctx && !A.muted) {
    const t = A.ctx.currentTime + 0.02;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => A.tone(t + i * 0.09, { f, f2: f, type: 'triangle', peak: 0.16, a: 0.005, dec: 0.32 }));
    [1046.5, 1318.5, 1568].forEach(f => A.tone(t + 0.4, { f, f2: f, type: 'sine', peak: 0.1, a: 0.01, dec: 1.3 }));
    for (let i = 0; i < 10; i++) A.noiseHit(t + 0.4 + i * 0.05, { f: 6000 + Math.random() * 3000, q: 8, peak: 0.05, dec: 0.15 });
  }
  const el = document.getElementById('clpct'); if (!el) return;
  el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
  const r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const cols = ['#ffd25a', '#ff6b6b', '#4ecdc4', '#7ee081', '#a78bfa', '#ffffff', '#ff9f43'];
  for (let i = 0; i < 70; i++) {
    const d = document.createElement('i'); d.className = 'confetti';
    const w = 7 + Math.random() * 7; d.style.cssText = `left:${cx}px;top:${cy}px;width:${w}px;height:${w * (0.4 + Math.random() * 0.5)}px;background:${cols[i % cols.length]}`;
    document.body.appendChild(d);
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4, v = 90 + Math.random() * 190, dx = Math.cos(a) * v, dy = Math.sin(a) * v;
    const rot = (Math.random() - 0.5) * 1440, dur = 1300 + Math.random() * 900;
    d.animate([{ transform: 'translate(-50%,-50%) rotate(0deg)', opacity: 1 },
      { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) rotate(${rot * 0.5}deg)`, opacity: 1, offset: 0.35 },
      { transform: `translate(calc(-50% + ${dx * 1.4}px), calc(-50% + ${dy + 260}px)) rotate(${rot}deg)`, opacity: 0 }],
      { duration: dur, easing: 'cubic-bezier(.2,.7,.4,1)', fill: 'forwards' }).onfinish = () => d.remove();
  }
}

const $ = id => document.getElementById(id);
export const HUD = {
  init() {
    this.hp = $('hpfill'); this.hpGhost = $('hpghost'); this.segs = [...document.querySelectorAll('.chg')]; this.en = $('enfill'); this.enBox = $('energy');
    this.combo = $('combo'); this.comboN = $('comboN'); this.comboBar = $('comboBar');
    this.obj = $('objective');
    this.mm = $('minimap'); this.mctx = this.mm.getContext('2d');
    this.ind = $('indicators');
    this.ghost = 100; this.lastCombo = 0; this.lastDmg = 0; this.toastT = 0;
    this.icons = new Map();
    this.tp = $('toolpick'); this.tpSlots = [...document.querySelectorAll('#toolpick .tp')];
  },
  // a speech bubble over someone's head for a few seconds
  say(e, text, t = 2.5) { const b = $('speech'); b.textContent = text; b.classList.add('show'); this.sayE = e; this.sayT = t; this.placeSay(); },
  placeSay() { const e = this.sayE; if (!e) return; const v = new THREE.Vector3(e.pos.x, 2.15, e.pos.z).project(G.camera), b = $('speech'); b.style.left = ((v.x * 0.5 + 0.5) * innerWidth) + 'px'; b.style.top = ((-v.y * 0.5 + 0.5) * innerHeight) + 'px'; },
  toast(text, t = 2.5) { const el = $('toast'); el.textContent = text; el.classList.add('show'); this.toastT = t; },
  setObjective(t) { }, // (no on-screen objective text: the story belongs in cutscenes)
  hideObjective() { this.obj.classList.add('gone'); },
  update(dt) {
    const P = G.player; if (!P) return;
    // tool picker: always on screen while playing. Mop and vacuum swap anywhere; the wheelbarrow only at the cart
    // (or where he left it), so its slot dims when it's out of reach
    const playing = (G.state === 'play' || G.state === 'cleared') && !G.leaving && !G.cine, atCart = playing && nearCart(P.pos);
    const holding = P.tool === 'barrow', b = G.barrow;
    const barrowOK = holding || (b && (b.spot ? nearBarrow(P.pos) : atCart));
    if (playing !== this.tpOn) { this.tpOn = playing; this.tp.classList.toggle('on', playing); }
    const key = P.tool + (barrowOK ? 1 : 0);
    if (playing && this.tpKey !== key) {
      this.tpKey = key; for (const el of this.tpSlots) { el.classList.toggle('sel', el.dataset.t === P.tool); el.classList.toggle('na', el.dataset.t === 'barrow' && !barrowOK); }
      const lb = this.tp.querySelector('[data-t="barrow"] span'); if (lb) lb.textContent = holding ? 'Let go' : 'Barrow';
    }
    const hp = Math.max(0, P.hp / P.maxHp);
    this.hp.style.width = (hp * 100) + '%';
    if (P.maxHp !== this.ticksN) { this.ticksN = P.maxHp; $('hpticks').style.setProperty('--n', P.maxHp); } // one segment per hit
    this.ghost = Math.max(hp * 100, this.ghost - dt * 25);
    this.hpGhost.style.width = this.ghost + '%';
    const en = Math.max(0, P.energy / P.maxEnergy);
    this.en.style.width = (en * 100) + '%'; this.enBox.classList.toggle('low', en < 0.2);
    const maxC = G.ps ? G.ps.charges : 1;
    if (maxC !== this.maxC) { this.maxC = maxC; this.segs.forEach((s, i) => { s.style.display = i < maxC ? '' : 'none'; }); }
    this.segs.forEach((s, i) => {
      s.classList.toggle('full', i < G.specialCharges);
      s.style.setProperty('--p', i === G.specialCharges ? (G.specialProgress / 5) : (i < G.specialCharges ? 1 : 0));
    });
    // combo
    if (G.combo >= 2) {
      this.combo.classList.add('on');
      if (G.combo !== this.lastCombo) { this.comboN.textContent = 'x' + G.combo; this.combo.classList.remove('pop'); void this.combo.offsetWidth; this.combo.classList.add('pop'); }
      this.comboBar.style.width = Math.max(0, G.comboTimer / 2.6 * 100) + '%';
    } else this.combo.classList.remove('on');
    this.lastCombo = G.combo;
    // the clean-up bar: appears once the robbers are dealt with, fills as the whole lobby gets cleaned
    const showBar = (G.state === 'cleared' || G.leaving) && G.cleanupProgress;
    if (!!showBar !== this.cbOn) { this.cbOn = !!showBar; $('cleanbar').classList.toggle('on', this.cbOn); document.body.classList.toggle('cleanup', this.cbOn); }
    if (showBar) {
      const p = G.cleanupProgress(), pct = Math.floor(p * 100);
      if (pct !== this.cbPct) { this.cbPct = pct; $('clfill').style.width = (p * 100).toFixed(1) + '%'; $('clpct').textContent = pct + '%'; $('cleanbar').classList.toggle('done', pct >= 100); if (pct >= 100 && !this.cbDone) { this.cbDone = true; celebrate(); } }
    }
    if (this.sayT > 0) { this.sayT -= dt; this.placeSay(); if (this.sayT <= 0) { $('speech').classList.remove('show'); this.sayE = null; } }
    if (this.toastT > 0) { this.toastT -= dt; if (this.toastT <= 0) $('toast').classList.remove('show'); }
    this.drawMinimap();
    this.updateIndicators();
  },
  drawMinimap() {
    const c = this.mctx, W = this.mm.width, R = W / 2, P = G.player.pos, S = R / 17;
    c.clearRect(0, 0, W, W);
    c.save(); c.beginPath(); c.arc(R, R, R - 2, 0, Math.PI * 2); c.clip();
    c.fillStyle = 'rgba(18,20,24,0.82)'; c.fillRect(0, 0, W, W);
    const m = (x, z) => { const dx = x - P.x, dz = z - P.z; return [R + (dx - dz) * 0.7071 * S, R - (-dx - dz) * 0.7071 * S]; };
    // floor area
    const B = G.bounds; const corners = [[B.minX, B.minZ], [B.maxX, B.minZ], [B.maxX, B.maxZ], [B.minX, B.maxZ]].map(p => m(p[0], p[1]));
    c.fillStyle = 'rgba(70,74,82,0.65)'; c.beginPath(); corners.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); c.closePath(); c.fill();
    for (const b of G.colliders) {
      if (!b.active) continue;
      const pts = [[-b.hx, -b.hz], [b.hx, -b.hz], [b.hx, b.hz], [-b.hx, b.hz]].map(([lx, lz]) => m(b.cx + lx * b.c + lz * b.s, b.cz - lx * b.s + lz * b.c));
      c.fillStyle = b.destructible ? 'rgba(150,200,220,0.75)' : 'rgba(25,27,31,0.9)';
      c.beginPath(); pts.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); c.closePath(); c.fill();
    }
    // everything the tool in his hands can clean, as small gold dots (refreshed a couple of times a second)
    const tool = G.player.tool;
    if (G.state === 'cleared' || (G.state === 'play' && G.level === 'basement')) { // (in the lobby: only once the robbers are dealt with)
      if (tool !== this.spotTool || G.time - (this.spotT || -9) > 0.5) {
        this.spotTool = tool; this.spotT = G.time;
        this.spots = tool === 'barrow' ? [...G.enemies.filter(e => e.ko && !e.gone && !e.loaded).map(e => [e.pos.x, e.pos.z]), ...chairs.filter(c => c.rifle && !c.sucked).map(c => [c.pos.x, c.pos.z])] : cleanSpots(tool);
      }
      // (grouped into patches about 3 m across: one soft dot per patch, bigger where there's more)
      if (this.spotsRaw !== this.spots) {
        this.spotsRaw = this.spots; const cells = new Map(), CS = 3.2;
        for (const [x, z] of this.spots || []) { const k = Math.floor(x / CS) + ',' + Math.floor(z / CS); const v = cells.get(k); if (v) { v[0] += x; v[1] += z; v[2]++; } else cells.set(k, [x, z, 1]); }
        this.patches = [...cells.values()].map(([x, z, n]) => [x / n, z / n, n]);
      }
      for (const [x, z, n] of this.patches || []) {
        const [px, py] = m(x, z); if (px < -6 || py < -6 || px > W + 6 || py > W + 6) continue;
        const r = 4.2; // (every patch the same size)
        c.fillStyle = 'rgba(255,205,80,0.95)'; c.beginPath(); c.arc(px, py, r * 0.62, 0, 6.2832); c.fill(); // (plain dots, no halo)
      }
    }
    // where his cart and the wheelbarrow are
    const icon = (x, z, col, ch) => { const [px, py] = m(x, z); c.fillStyle = col; c.strokeStyle = '#fff'; c.lineWidth = 1.5; c.beginPath(); c.roundRect(px - 6.5, py - 6.5, 13, 13, 3); c.fill(); c.stroke(); c.fillStyle = '#fff'; c.font = 'bold 10px Oswald, Arial'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(ch, px, py + 0.5); };
    if (G.cart) icon(G.cart.position.x, G.cart.position.z, '#2f6fd0', 'C');
    if (SECRET.obj && SECRET.hop < 0) { // the secret: a little green diamond, gently pulsing
      const [px, py] = m(SECRET.x, SECRET.z), r = 4.2 + Math.sin(G.time * 4) * 0.8;
      c.fillStyle = 'rgba(120,220,90,0.95)'; c.strokeStyle = 'rgba(20,70,15,0.9)'; c.lineWidth = 1.2;
      c.beginPath(); c.moveTo(px, py - r); c.lineTo(px + r, py); c.lineTo(px, py + r); c.lineTo(px - r, py); c.closePath(); c.fill(); c.stroke();
    }
    if (G.barrow && !G.barrow.held && G.barrow.spot) { const a = G.barrow.spot.axle; icon(a.x, a.z, '#2f8a48', 'W'); }
    for (const e of G.enemies) {
      if (e.gone || e.loaded || e.hidden) continue; // vacuumed up / in the wheelbarrow / not on stage yet
      const [x, y] = m(e.pos.x, e.pos.z);
      if (e.ko) { c.strokeStyle = 'rgba(160,160,160,0.6)'; c.lineWidth = 2; c.beginPath(); c.moveTo(x - 3, y - 3); c.lineTo(x + 3, y + 3); c.moveTo(x + 3, y - 3); c.lineTo(x - 3, y + 3); c.stroke(); continue; }
      const a = e.yaw; const fx = Math.sin(a), fz = Math.cos(a);
      const [hx, hy] = [(fx - fz) * 0.7071, -(-fx - fz) * 0.7071];
      c.fillStyle = e.aggro ? '#ff3b30' : '#d9a33a';
      c.beginPath(); c.moveTo(x + hx * 7, y + hy * 7); c.lineTo(x - hy * 5 - hx * 4, y + hx * 5 - hy * 4); c.lineTo(x + hy * 5 - hx * 4, y - hx * 5 - hy * 4); c.closePath(); c.fill();
    }
    // player arrow
    const fx = Math.sin(G.player.yaw), fz = Math.cos(G.player.yaw); const hx = (fx - fz) * 0.7071, hy = -(-fx - fz) * 0.7071;
    c.fillStyle = '#fff'; c.beginPath(); c.moveTo(R + hx * 9, R + hy * 9); c.lineTo(R - hy * 6 - hx * 5, R + hx * 6 - hy * 5); c.lineTo(R + hy * 6 - hx * 5, R - hx * 6 - hy * 5); c.closePath(); c.fill();
    c.restore();
    c.strokeStyle = 'rgba(255,255,255,0.85)'; c.lineWidth = 3; c.beginPath(); c.arc(R, R, R - 2, 0, Math.PI * 2); c.stroke();
    // north marker (world -z)
    const nx = R + 0.7071 * (R - 14), ny = R - 0.7071 * (R - 14);
    c.fillStyle = '#fff'; c.font = 'bold 15px Oswald, Arial'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('N', nx, ny);
  },
  updateIndicators() {
    const v = new THREE.Vector3();
    for (const e of G.enemies) {
      let el = this.icons.get(e);
      const show = !e.ko && (e.state === 'melee' && e.t < 0.6 || e.state === 'alert'); // (no marker while they aim: the laser says it)
      if (!show) { if (el) el.style.display = 'none'; continue; }
      if (!el) { el = document.createElement('div'); el.className = 'eicon'; this.ind.appendChild(el); this.icons.set(e, el); }
      el.style.display = 'block';
      const kind = e.state === 'melee' ? 'melee' : e.state === 'aim' ? 'aim' : 'alert';
      if (el.dataset.k !== kind) { el.dataset.k = kind; el.className = 'eicon ' + kind; el.textContent = kind === 'melee' ? '!' : kind === 'aim' ? '' : '?'; }
      v.set(e.pos.x, 0.5 + 1.75 * e.size, e.pos.z).project(G.camera);
      el.style.transform = `translate(${(v.x * 0.5 + 0.5) * innerWidth}px,${(-v.y * 0.5 + 0.5) * innerHeight}px) translate(-50%,-50%)`;
    }
  },
};
