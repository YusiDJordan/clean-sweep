// HUD: portrait, health, special charges, combo, minimap, damage ledger, prompts, enemy indicators
import * as THREE from 'three';
import { G } from './state.js';
import { FX, litterCount } from './fx.js';
import { nearCart } from './tools.js';

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
  toast(text, t = 2.5) { const el = $('toast'); el.textContent = text; el.classList.add('show'); this.toastT = t; },
  setObjective(t) { }, // (no on-screen objective text: the story belongs in cutscenes)
  hideObjective() { this.obj.classList.add('gone'); },
  update(dt) {
    const P = G.player; if (!P) return;
    // tool picker: only while he's at the cart
    const atCart = (G.state === 'play' || G.state === 'cleared') && !G.leaving && nearCart(P.pos);
    if (atCart !== this.tpOn) { this.tpOn = atCart; this.tp.classList.toggle('on', atCart); }
    if (atCart && this.tpTool !== P.tool) { this.tpTool = P.tool; for (const el of this.tpSlots) el.classList.toggle('sel', el.dataset.t === P.tool); }
    const hp = Math.max(0, P.hp / P.maxHp);
    this.hp.style.width = (hp * 100) + '%';
    if (P.maxHp !== this.ticksN) { this.ticksN = P.maxHp; $('hpticks').style.setProperty('--n', P.maxHp); } // one segment per hit
    this.ghost = Math.max(hp * 100, this.ghost - dt * 25);
    this.hpGhost.style.width = this.ghost + '%';
    const en = Math.max(0, P.energy / P.maxEnergy);
    this.en.style.width = (en * 100) + '%'; this.enBox.classList.toggle('low', en < 0.2);
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
      if (pct !== this.cbPct) { this.cbPct = pct; $('clfill').style.width = (p * 100).toFixed(1) + '%'; $('clpct').textContent = pct + '%'; $('cleanbar').classList.toggle('done', pct >= 100); }
    }
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
