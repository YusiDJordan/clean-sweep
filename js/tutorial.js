// The tutorial, played in the custodian's basement: a short script of steps. A callout bubble points into the world
// (like a cursor on a map), the keys for each step sit in the corner, and the gold arrow over Karim shows the way.
import * as THREE from 'three';
import { G, CLEAN } from './state.js';
import { BS, messIn, openFireDoors, closeFireDoors, inStairwell, hallDull, shineHall } from './basement.js';
import { nearCart, nearBarrow } from './tools.js';
import { litterCount } from './fx.js';
import { goldTint } from './actors.js';
import { roughCells } from './decals.js';
import { SFX } from './audio.js';
import { HUD } from './hud.js';

export const TUT = { on: false, i: -1, t: 0, robber: null, done: false };
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const _v = V();
let ui = null, exitT = -1, onExit = null;

const K = {
  move: [['W', 'A', 'S', 'D'], 'Move'], run: [['Hold Shift'], 'Run'], mop: [['Hold ' + CLEAN.label], 'Clean'],
  tools: [['1'], 'Mop', ['2'], 'Vacuum', ['3'], 'Wheelbarrow'], strike: [['Left click', 'J'], 'Mop strike'],
  dodge: [['Space'], 'Dodge roll'], kick: [['Right click', 'K'], 'Front kick'],
};
const barrowLeft = () => !!(G.barrow && G.barrow.spot); // (he parked it somewhere away from the cart)
const cartTop = () => G.cart ? G.cart.position.clone().setY(1.25) : null;
const robberHead = () => TUT.robber ? TUT.robber.pos.clone().setY(TUT.robber.down ? 0.35 : 1.1) : null;
const P = () => G.player;
// the nearest bit of the hall that's still dull (for the arrow): one read of the polish mask, a few times a second
let dullT = -1; const dullAt = V().copy(BS.hall.c);
function dullSpot() {
  if (G.time < dullT) return dullAt;
  dullT = G.time + 0.4;
  let best = null, bd = 1e9; const p = P().pos;
  for (const c of roughCells(BS.hall)) { if (c.f < 0.15) continue; const d = Math.hypot(c.x - p.x, c.z - p.z); if (d < bd) { bd = d; best = c; } }
  if (best) dullAt.set(best.x, 0, best.z);
  return dullAt;
}

// ---- the script ----
const STEPS = [
  { id: 'mop', keys: [K.mop, K.move], target: () => BS.mud.c.clone().setY(0.15), guide: () => BS.mud.c,
    text: () => `Somebody's tracked mud all over the floor. Start with that: hold <kbd>${CLEAN.label}</kbd> and walk over the footprints to <b class="g">mop</b> them up.` + (P().tool !== 'mop' ? `<small>(Switch back to the mop: <kbd>1</kbd>.)</small>` : ''),
    enter(s) { HUD.say(P(), 'Tsk. Look at this floor...', 2.6); s.m0 = Math.max(0.001, messIn(BS.mud, 0)); s.p = 0; s.pt = 0; },
    update(s, dt) { s.pt -= dt; if (s.pt <= 0) { s.pt = 0.25; s.p = Math.max(s.p, 1 - messIn(BS.mud, 0) / s.m0); } },
    progress: s => s.p / 0.88, done: s => s.p >= 0.88 },
  { id: 'red', keys: [K.move], target: () => BS.spill.c.clone().setY(0.1), glow: () => ({ x: BS.spill.c.x, z: BS.spill.c.z, r: 3.4 }), focus: () => ({ x: BS.spill.c.x, z: BS.spill.c.z, w: 0.35 }),
    text: () => `See the papers and broken glass glowing <b class="r">red</b>? Red means the tool in your hands can't clean it. Paper, glass and grit need the <b class="g">vacuum</b>.`,
    done: (s, t) => t > 5.5 || (t > 2.5 && P().tool === 'vacuum') },
  { id: 'vacpick', keys: [K.tools], target: () => P().pos.clone().setY(1.05),
    text: () => `Press <kbd>2</kbd> to switch to the <b class="g">vacuum</b>. You can swap between the mop and the vacuum anywhere.`, done: () => P().tool === 'vacuum' },
  { id: 'vacuum', keys: [K.mop, K.move], target: () => BS.spill.c.clone().setY(0.1), guide: () => BS.spill.c,
    text: () => `Now everything the vacuum can pick up <b class="g">lights up</b>. Hold <kbd>${CLEAN.label}</kbd> near the mess to suck it all up.` + (P().tool !== 'vacuum' ? `<small>(Switch to the vacuum: <kbd>2</kbd>.)</small>` : ''),
    enter(s) { s.l0 = Math.max(1, litterCount()); s.g0 = Math.max(0.001, messIn(BS.spill, 1)); s.p = 0; s.pt = 0; },
    update(s, dt) { s.pt -= dt; if (s.pt <= 0) { s.pt = 0.25; s.p = Math.max(s.p, 0.75 * (1 - litterCount() / s.l0) + 0.25 * (1 - messIn(BS.spill, 1) / s.g0)); } },
    progress: s => s.p / 0.94, done: s => s.p >= 0.94 || (litterCount() === 0 && s.p > 0.8) },
  { id: 'mopswap', keys: [K.tools], target: () => P().pos.clone().setY(1.05), skip: () => P().tool === 'mop',
    text: () => `Spotless. Next door, the bank's marble has gone <b class="r">dull</b>. The <b class="g">mop</b> buffs it back to a shine: switch to it with <kbd>1</kbd>.`,
    done: () => P().tool === 'mop' },
  { id: 'hall', keys: [K.move, K.run], target: () => BS.hall.c.clone().setY(0.1), guide: () => V(BS.hall.x0 + 1.2, 0, 0.4), focus: () => ({ x: BS.hall.c.x, z: BS.hall.c.z, w: 0.45 }),
    text: () => `Through to the <b class="g">staff hall</b>. See where everyone's feet have worn the polish off the marble?`,
    done: (s, t) => P().pos.x > BS.hall.x0 + 0.6 },
  { id: 'polish', keys: [K.mop, K.move], target: () => dullSpot(), guide: () => dullSpot(), glow: () => ({ x: BS.hall.c.x, z: BS.hall.c.z, r: 7.5 }),
    text: () => `Hold <kbd>${CLEAN.label}</kbd> and mop the dull patches, the ones <b class="g">lighting up</b>, until the marble gleams.` + (P().tool !== 'mop' ? `<small>(Switch to the mop: <kbd>1</kbd>.)</small>` : ''),
    enter(s) { s.r0 = Math.max(0.001, hallDull()); s.p = 0; s.pt = 0; },
    update(s, dt) { s.pt -= dt; if (s.pt <= 0) { s.pt = 0.25; s.p = Math.max(s.p, 1 - hallDull() / s.r0); } },
    progress: s => s.p / 0.75, done: s => s.p >= 0.75 },
  { id: 'intruder', allow: [], keys: [], target: robberHead, focus: () => ({ x: (TUT.robber.pos.x + P().pos.x) / 2, z: (TUT.robber.pos.z + P().pos.z) / 2, w: 0.6 }),
    text: () => `Lovely. But someone's followed you in…`,
    enter(s) { const e = TUT.robber; shineHall(); e.pos.set(BS.start.x, 0, BS.start.z); e.vel && e.vel.set(0, 0, 0); e.yaw = Math.PI / 2; e.hidden = false; e.tutHold = false; e.tutNoAttack = true; e.tutIdeal = 4.5; e.alert(0.4); e.tutWalk = null; SFX.play('alert'); // (in the way Karim came, at the bottom left: the fire doors stay shut until he's in the barrow)
      // Karim backs away into the middle of the hall, eyes on him (so the fight happens where we can see it)
      s.said = false; G.autoWalk = V(BS.hall.c.x - 0.6, 0, BS.hall.c.z + 0.6); G.autoFace = e.pos; G.cine = true; },
    update(s) {
      const e = TUT.robber;
      if (!s.said && TUT.t > 0.9) { s.said = true; HUD.say(e, 'Hey, what are you doing here?!', 2.6); }
      if (G.autoWalk && P().pos.distanceTo(G.autoWalk) < 0.3) G.autoWalk = null;
    },
    done: (s, t) => t > 3.0 && (!G.autoWalk || t > 6) && (TUT.robber.pos.distanceTo(P().pos) < 7.5 || t > 9),
    leave() { G.autoWalk = null; G.autoFace = null; G.cine = false; } },
  { id: 'mopback', allow: [], keys: [K.tools], target: () => P().pos.clone().setY(1.05), skip: () => P().tool === 'mop',
    text: () => `A robber! You fight with the <b class="g">mop</b>. Press <kbd>1</kbd> to switch to it.`, done: () => P().tool === 'mop' },
  { id: 'strike', allow: ['attack'], keys: [K.strike], target: robberHead,
    text: () => `<kbd>Left click</kbd> (or <kbd>J</kbd>) swings the mop: Karim lunges at the robber. Hit him <b class="g">3 times</b>, and keep the hits coming for a combo.`,
    enter(s) { s.h0 = G.stats.hits; TUT.robber.tutIdeal = 2.4; s.shut = false; },
    progress: s => (G.stats.hits - s.h0) / 3, done: s => G.stats.hits - s.h0 >= 3 },
  { id: 'dodge', allow: ['dodge'], keys: [K.dodge], target: robberHead,
    text: s => (s.miss ? `<b class="r">Too ${s.miss}.</b> ` : '') + `He's taking aim! When the <b class="r">red laser</b> lands on you, press <kbd>Space</kbd> to roll out of the way.`,
    enter(s) { const e = TUT.robber; e.tutIdeal = 4.8; s.next = 0.5; s.ok = false; s.miss = null; s.aiming = false; s.lb = e.lastBurst; closeFireDoors(); },
    update(s, dt) {
      const e = TUT.robber, d = e.pos.distanceTo(P().pos); s.next -= dt;
      // he backs off a little, then raises the rifle (sooner or later, even if Karim stays close)
      if (s.next <= 0 && e.state === 'combat' && !e.down && (d > 2.6 || s.next < -0.8)) { if (e.forceAim()) { s.next = 1e9; s.aiming = true; } }
      if (s.aiming && (e.down || e.state === 'stagger')) { // knocked out of his aim: rolling into him counts too
        s.aiming = false;
        if (e.burstDodged || P().state === 'dodge') s.ok = true; else s.next = 1.5;
      }
      if (e.lastBurst && e.lastBurst !== s.lb) { // a burst just finished
        s.lb = e.lastBurst; s.aiming = false;
        if (e.lastBurst.dodged) s.ok = true;
        else { s.miss = e.lastBurst.hurt ? 'slow' : 'early'; s.next = 0.9; P().hp = Math.max(P().hp, 1); }
      }
    }, done: s => s.ok },
  { id: 'kick', allow: ['sweep'], keys: [K.kick], target: robberHead,
    text: () => `<kbd>Right click</kbd> (or <kbd>K</kbd>) is a front kick. It knocks a robber flat on his back.`,
    enter() { TUT.robber.tutIdeal = 2.0; }, done: () => TUT.robber.down && !TUT.robber.ko },
  { id: 'finish', allow: ['attack'], keys: [K.strike], target: robberHead,
    text: () => `He's down! Hit him while he's on the floor to put him out for good.`,
    enter() { const e = TUT.robber; e.hp = 1; e.tutDownT = 9; },
    update(s) { const e = TUT.robber; if (!e.down && !e.ko) { TUT.back = true; } }, done: () => TUT.robber.ko },
  { id: 'barrow', keys: [K.tools], target: () => barrowLeft() ? G.barrow.group.position.clone().setY(0.7) : cartTop(), hl: 'cart',
    guide: () => barrowLeft() ? (nearBarrow(P().pos) ? null : G.barrow.group.position) : (nearCart(P().pos) ? null : G.cart.position),
    text: () => `Out cold. Knocked-out robbers go in the <b class="g">wheelbarrow</b>. ` + (barrowLeft()
      ? `Go back to where you left it and press <kbd>3</kbd> to take it.`
      : `It's parked by your <b class="g">cart</b>, where all your tools live. Walk up to it and press <kbd>3</kbd>.`),
    enter() { SFX.play('ding'); }, done: () => P().tool === 'barrow' || TUT.robber.loaded },
  { id: 'scoop', keys: [K.move, K.run], target: robberHead, guide: () => TUT.robber.pos,
    text: () => `Wheel it straight into him to scoop him up.` + (P().tool !== 'barrow' ? `<small>(Take the wheelbarrow again: walk up to it and press <kbd>3</kbd>.)</small>` : `<small>(<kbd>3</kbd> lets go of it, wherever you are.)</small>`),
    done: () => !!TUT.robber.loaded },
  { id: 'exit', keys: [K.move], target: () => V(BS.doors.cx, 1.4, BS.bounds.minZ), guide: () => V(BS.doors.cx, 0, BS.bounds.minZ - 0.4),
    text: () => `Floor clean, marble shining, robber in the barrow. That's the job, Karim. The stairs are open: head up to the <b class="g">lobby</b>.`,
    enter() { openFireDoors(); }, done: () => inStairwell(P().pos) },
];

export function startTutorial(robber, exitFn) {
  TUT.on = true; TUT.robber = robber; onExit = exitFn; G.noDeath = true;
  robber.hidden = true; robber.tutHold = true; robber.tutNoAttack = true; robber.hp = 99;
  if (!ui) makeUI();
  document.body.classList.add('tut');
  TUT.go = go; TUT.steps = STEPS; // (handy for testing)
  go(0);
}
function go(i) {
  const prev = STEPS[TUT.i]; if (prev && prev.leave && prev !== STEPS[i]) prev.leave(prev);
  while (i < STEPS.length && STEPS[i].skip && STEPS[i].skip()) i++;
  TUT.i = i; TUT.t = 0; TUT.back = false;
  const s = STEPS[i]; if (!s) return;
  s.miss = null; s.enter && s.enter(s);
  ui.n.textContent = `${i + 1} / ${STEPS.length}`;
  ui.keys.innerHTML = s.keys.map(k => { let h = ''; for (let j = 0; j < k.length; j += 2) h += `<div class="kr">${k[j].map(x => `<kbd>${x}</kbd>`).join('')}<span>${k[j + 1]}</span></div>`; return h; }).join('');
  ui.keys.style.display = s.keys.length ? '' : 'none';
  ui.bub.classList.remove('pop'); void ui.bub.offsetWidth; ui.bub.classList.add('pop');
  ui.lastHTML = null;
}

export function updateTutorial(dt) {
  if (!TUT.on) return;
  if (exitT >= 0) { exitT += dt; if (exitT > 1.3 && onExit) { const f = onExit; onExit = null; f(); } return; }
  const s = STEPS[TUT.i]; if (!s) return;
  TUT.t += dt;
  s.update && s.update(s, dt);
  if (TUT.back) { go(TUT.i - 1); return; } // (he got up before you finished him: kick him down again)
  // gold arrow, highlight, forced red glow
  const g = s.guide ? s.guide() : null; G.guideTarget = g ? { x: g.x, z: g.z, near: 1.6 } : null;
  const hl = s.hl === 'cart' && !barrowLeft() ? 0.55 + 0.45 * Math.sin(G.time * 5) : 0;
  if (G.cart) goldTint(G.cart, hl, true);
  G.tutGlow = s.glow ? s.glow() : null;
  G.tutAllow = s.allow || null; G.tutTarget = TUT.robber; // (during a fight lesson, only the move being taught works)
  G.camFocus = s.focus ? s.focus() : null;
  // text
  const html = s.text(s);
  if (html !== ui.lastHTML) { ui.text.innerHTML = html; ui.lastHTML = html; }
  const pr = s.progress ? Math.max(0, Math.min(1, s.progress(s))) : null;
  ui.prog.style.display = pr === null ? 'none' : ''; if (pr !== null) ui.fill.style.width = (pr * 100).toFixed(1) + '%';
  placeCallout(dt, s);
  if (s.done(s, TUT.t)) {
    if (TUT.i >= STEPS.length - 1) { exitSequence(); return; }
    SFX.play('collect'); go(TUT.i + 1);
  }
}

function exitSequence() {
  exitT = 0; G.guideTarget = null; G.camFocus = null; G.autoWalk = V(BS.doors.cx, 0, BS.bounds.minZ - 2.4);
  ui.root.classList.add('out'); document.getElementById('blackout').classList.add('on');
  SFX.play('ding');
}

// ---- UI ----
function makeUI() {
  const root = document.createElement('div'); root.id = 'tut';
  root.innerHTML = `<svg id="tutsvg"><defs><marker id="tuthead" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#f2b531"/></marker></defs>
    <path id="tutline2" fill="none"/><path id="tutline" fill="none" marker-end="url(#tuthead)"/><circle id="tutring" r="14" fill="none"/></svg>
    <div id="tutbub"><div class="tk">Tutorial · <span id="tutn"></span></div><div id="tuttext"></div><div id="tutprog"><i></i></div></div>
    <div id="tutkeys"></div>`;
  document.body.appendChild(root);
  ui = { root, bub: root.querySelector('#tutbub'), text: root.querySelector('#tuttext'), n: root.querySelector('#tutn'), prog: root.querySelector('#tutprog'),
    fill: root.querySelector('#tutprog i'), keys: root.querySelector('#tutkeys'), line: root.querySelector('#tutline'), line2: root.querySelector('#tutline2'), ring: root.querySelector('#tutring'),
    x: innerWidth / 2 - 180, y: 90, tx: 0, ty: 0, init: false };
}
function placeCallout(dt, s) {
  const W = innerWidth, H = innerHeight, bw = ui.bub.offsetWidth || 340, bh = ui.bub.offsetHeight || 90, m = 16;
  const tgt = s.target ? s.target() : null;
  let bx, by, show = false, tx = 0, ty = 0;
  if (tgt) {
    _v.copy(tgt).project(G.camera);
    tx = (_v.x * 0.5 + 0.5) * W; ty = (-_v.y * 0.5 + 0.5) * H;
    if (_v.z > 1) { tx = W - tx; ty = H - m; } // (behind the camera)
    tx = Math.max(28, Math.min(W - 28, tx)); ty = Math.max(28, Math.min(H - 28, ty));
    show = true;
    // the bubble sits up and to the left of what it points at (or wherever there's room)
    bx = tx - 70 - bw; by = ty - 90 - bh;
    if (bx < m) bx = tx + 70;
    if (by < m + 70) by = ty + 90;
    if (bx + bw > W - m) bx = W - m - bw;
    if (by + bh > H - m - 120) by = Math.max(m + 70, ty - 90 - bh);
  } else { bx = W / 2 - bw / 2; by = 96; }
  bx = Math.max(m, Math.min(W - m - bw, bx)); by = Math.max(m, Math.min(H - m - bh, by));
  const k = ui.init ? 1 - Math.exp(-10 * dt) : 1; ui.init = true;
  ui.x += (bx - ui.x) * k; ui.y += (by - ui.y) * k; ui.tx += (tx - ui.tx) * (show ? 1 - Math.exp(-18 * dt) : 1); ui.ty += (ty - ui.ty) * (show ? 1 - Math.exp(-18 * dt) : 1);
  ui.bub.style.transform = `translate(${ui.x.toFixed(1)}px,${ui.y.toFixed(1)}px)`;
  if (!show) { ui.line.setAttribute('d', ''); ui.line2.setAttribute('d', ''); ui.ring.style.display = 'none'; return; }
  // line from the nearest point of the bubble's edge, curving a little, stopping short of the target
  const ax = Math.max(ui.x, Math.min(ui.x + bw, ui.tx)), ay = Math.max(ui.y, Math.min(ui.y + bh, ui.ty));
  const dx = ui.tx - ax, dy = ui.ty - ay, L = Math.hypot(dx, dy) || 1, ex = ui.tx - dx / L * 13, ey = ui.ty - dy / L * 13;
  const cx = (ax + ex) / 2 - dy / L * 18, cy = (ay + ey) / 2 + dx / L * 18;
  const d = L > 40 ? `M${ax.toFixed(1)},${ay.toFixed(1)} Q${cx.toFixed(1)},${cy.toFixed(1)} ${ex.toFixed(1)},${ey.toFixed(1)}` : '';
  ui.line.setAttribute('d', d); ui.line2.setAttribute('d', d);
  ui.ring.style.display = ''; ui.ring.setAttribute('cx', ui.tx.toFixed(1)); ui.ring.setAttribute('cy', ui.ty.toFixed(1)); ui.ring.setAttribute('r', (12 + Math.sin(G.time * 5) * 3).toFixed(1));
}
