// Clean Sweep — bootstrap, input, game loop, director, scoring
import * as THREE from 'three';
import { G, rand, CLEAN, ELECTRON, pointInBox } from './state.js';
import { initRender, renderFrame, updateCamera, captureEnvironment, setQuality, setGfx, loadGfx, GFX, GFX_PRESETS, R, ensureEnv, compileScene } from './render.js';
import { initTitle, updateTitle, T } from './title.js';
import { loadModels, buildLevel, updateOccluders, updateWater, L , updateElevators, inElevator, updateGuideArrow, STAIR_DOOR, updateStairDoor, prefetchLevel } from './level.js';
import { initDecals } from './decals.js';
import { initRobberAnims } from './robanim.js';
import { buildCartTools, updateCartTools, nearCart, TOOL_ORDER, buildBarrow, parkBarrow, updateBarrowHops } from './tools.js';
import { chairs } from './destruct.js';
import { initDirt, seedDirt, initPapers, initShards, initParticles, spawnPaper, updateFX, setDirtBaseline, measureDirt, litterCount, FX, bloodPool, cleanAt, initLeaves, seedLeaves, leafCount, initJunk, junkCount, vacuumAt, polishFloor, papers, junk } from './fx.js';
import { Player, spawnEnemies, Enemy } from './actors.js';
import { Boss, LINES_BOSS } from './boss.js';
import { BS, buildBasement, seedBasementMess, updateBasement } from './basement.js';
import { OPS, buildOps, spawnOpsEnemies, seedOpsMess } from './ops.js';
import { TUT, startTutorial, updateTutorial } from './tutorial.js';
import { updateDestructibles } from './destruct.js';
import { HUD } from './hud.js';
import { SFX } from './audio.js';
import { buildSecret, updateSecret } from './secret.js';
import { updateNav } from './nav.js';
import { enterLift, updateLift, LIFT } from './lift.js';
import { clone as skClone } from 'three/addons/utils/SkeletonUtils.js';
import { loadProgress, resetProgress, computeStats, renderShop, pointsFor, bank, P as PROG, hasSave, saveProgress } from './progress.js';

const $ = id => document.getElementById(id);

// ---------------- input ----------------
const Input = {
  down: new Set(), mouseActive: false, mx: 0, my: 0,
  key(c) { return this.down.has(c); },
};
G.input = Input;
{ const k = document.getElementById('cleankey'); if (k) k.textContent = 'Hold ' + CLEAN.label; }
addEventListener('keydown', e => {
  if (ELECTRON && e.ctrlKey && !e.metaKey) e.preventDefault(); // (desktop build: Ctrl is the clean key, never a shortcut)
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  Input.down.add(e.code);
  onKey(e.code);
});
addEventListener('keyup', e => Input.down.delete(e.code));
addEventListener('blur', () => Input.down.clear());
addEventListener('mousemove', e => { Input.mx = e.clientX; Input.my = e.clientY; Input.mouseActive = true; });
addEventListener('contextmenu', e => e.preventDefault());
// Takedown: both mouse buttons together (left + right within a moment of each other), or Q
const btnT = [-9, -9, -9];
addEventListener('mousedown', e => {
  const now = performance.now() / 1000; if (e.button < 3) btnT[e.button] = now;
  const chord = (e.button === 0 || e.button === 2) && (e.buttons & 3) === 3 && Math.abs(btnT[0] - btnT[2]) < 0.25;
  if (G.freeze && chord) { introTakedown(); return; }
  if ((G.state !== 'play' && G.state !== 'cleared') || G.leaving || G.cine) return;
  if (e.target.closest && e.target.closest('button')) return;
  if (chord && G.specialCharges > 0 && G.player.trySpecial(true)) return; // (cuts the strike or kick the first button just started)
  if (e.button === 0) G.player.tryAttack();
  if (e.button === 2) G.player.trySweep();
});

function onKey(code) {
  if (code === 'KeyM') { const m = SFX.toggleMute(); HUD.toast(m ? 'Sound off' : 'Sound on', 1.2); }
  if (code === 'KeyG') cycleQuality();
  if (G.freeze && code === 'KeyQ') { introTakedown(); return; }
  if ((G.state === 'play' || G.state === 'cleared') && (G.leaving || G.cine)) return;
  if (G.state === 'play' || G.state === 'cleared') {
    const P = G.player;
    if (code === 'KeyJ') P.tryAttack();
    if (code === 'KeyK') P.trySweep();
    if (code === 'Space' || code === 'KeyL') P.tryDodge();
    if (code === 'KeyQ') P.trySpecial();
    // tools at the cart
    if (code === 'Digit1' || code === 'Numpad1') P.pickTool('mop');
    if (code === 'Digit2' || code === 'Numpad2') P.pickTool('vacuum');
    if (code === 'Digit3' || code === 'Numpad3') P.pickTool('barrow');
    if (code === 'KeyE') P.pickTool('next');
    if (code === 'Escape' || code === 'KeyP') pause(true);
  } else if (G.state === 'pause' && (code === 'Escape' || code === 'KeyP')) pause(false);
  else if (G.state === 'dead' && (code === 'Enter' || code === 'Space') && $('dead').classList.contains('show')) $('retry').click();
  else if (G.state === 'title' && code === 'Escape' && openMenu) closeMenu();
  else if (G.state === 'title' && (code === 'Enter' || code === 'Space') && G.ready && !openMenu) startGame();
}

function cycleQuality() {
  const order = ['high', 'medium', 'low'];
  const q = order[(order.indexOf(GFX.preset) + 1) % 3];
  setQuality(q); HUD.toast('Graphics: ' + q.toUpperCase(), 1.5); renderGfx();
}

// ---------------- title menus: Controls, Graphics ----------------
let openMenu = null;
function showMenu(id) { closeMenu(); openMenu = id; $(id).classList.add('show'); if (id === 'gfxov') renderGfx(); }
function closeMenu() { if (openMenu) $(openMenu).classList.remove('show'); openMenu = null; }
const GFX_ROWS = [
  ['preset', 'Preset', '', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']]],
  ['aa', 'Anti-aliasing', 'Smooths jagged edges', [['off', 'Off'], ['fxaa', 'FXAA'], ['msaa4', 'MSAA 4×'], ['msaa8', 'MSAA 8×']]],
  ['ao', 'Ambient occlusion', 'Soft shadows in corners and under things', [['off', 'Off'], ['low', 'Low'], ['high', 'High']]],
  ['refl', 'Reflections', 'The polished floor', [['off', 'Off'], ['low', 'Low'], ['high', 'High'], ['ultra', 'Ultra']]],
  ['shadows', 'Shadows', 'Shadow sharpness', [['low', 'Low'], ['high', 'High'], ['ultra', 'Ultra']]],
  ['bloom', 'Bloom', 'Glow around bright lights', [['off', 'Off'], ['on', 'On']]],
  ['scale', 'Resolution', 'Lower runs faster', [['50', '50%'], ['75', '75%'], ['100', '100%'], ['150', '150%']]],
];
function renderGfx() {
  const el = $('gfx-body'); if (!el) return;
  el.innerHTML = GFX_ROWS.map(([k, label, hint, opts]) => `<div class="grow"><span>${label}${k === 'preset' && GFX.preset === 'custom' ? ' <small>Custom</small>' : hint ? `<small>${hint}</small>` : ''}</span>
    <div class="seg">${opts.map(([v, t]) => `<button data-k="${k}" data-v="${v}" class="${GFX[k] === v ? 'on' : ''}">${t}</button>`).join('')}</div></div>`).join('');
}
$('gfx-body').addEventListener('click', e => {
  const b = e.target.closest('button[data-k]'); if (!b) return;
  if (b.dataset.k === 'preset') setQuality(b.dataset.v); else setGfx(b.dataset.k, b.dataset.v);
  autoQ = false; renderGfx();
});
$('ctrlbtn').addEventListener('click', () => showMenu('controlsov'));
$('gfxbtn').addEventListener('click', () => showMenu('gfxov'));
$('ctrlclose').addEventListener('click', closeMenu);
$('gfxclose').addEventListener('click', closeMenu);
for (const id of ['controlsov', 'gfxov']) $(id).addEventListener('click', e => { if (e.target.id === id) closeMenu(); });

// ---------------- director & game hooks ----------------
G.attackers = new Set(); let globalCool = 1.5;
G.requestAttack = e => {
  const aggro = G.enemies.filter(x => x.aggro && !x.ko).length;
  const max = 2; // (never more than two at once)
  if (G.attackers.size >= max || globalCool > 0 || G.player.state === 'dead') return false;
  G.attackers.add(e); globalCool = rand(0.3, 0.65); return true;
};
G.alertGroup = g => { for (const e of G.enemies) if (e.group === g && !e.aggro) e.alert(rand(0.1, 0.5)); };
G.anyAggro = () => G.enemies.some(e => e.aggro && !e.ko);
let alertedOnce = false;
G.onAlert = e => {
  if (!alertedOnce) { alertedOnce = true; HUD.hideObjective(); } // the fight speaks for itself
};
G.onDamage = d => {
  // loud destruction draws attention
  if (!d || !d.obj) return;
  const p = d.obj.position || d.obj.getWorldPosition(new THREE.Vector3());
  for (const e of G.enemies) if (!e.aggro && e.pos.distanceTo(p) < 11) G.alertGroup(e.group);
};
G.onKO = e => {
  if (G.level === 'basement') return; // (the tutorial runs its own ending)
  const left = G.enemies.filter(x => !x.ko).length;
  if (left === 0 && G.level === 'ops' && !G.boss && L.gltf.Boss) { setTimeout(startBoss, 1500); return; } // (the floor's boss rides up)
  if (left === 0) setTimeout(() => lobbyCleared(), e.isBoss ? 2400 : 900);
};
G.say = (e, text, t = 2.4) => { say(e, text); G.sayT = t; G.sayE = e; };
// ---------------- the boss: the lift dings, the doors part, the Contractor steps out and says his piece ----------------
function startBoss() {
  if (G.state !== 'play' || G.boss) return;
  const z0 = G.bounds.minZ, P = G.player;
  let el = null, bd = -1; for (const e of L.elevators || []) { const d = Math.abs(e.x - P.pos.x); if (d > bd) { bd = d; el = e; } }
  if (!el) return;
  const b = G.bossPre || new Boss(el.x, el.cabZ, 0); b.pos.set(el.x, 0, el.cabZ); b.yaw = 0; b.root.visible = true; b.sync(); G.boss = b; G.enemies.push(b);
  G.bossOut = new THREE.Vector3(el.x, 0, z0 + 5.0); // (well out of the lift, into the room)
  G.bossIntro = { phase: 'doors', t: 0, el, line: 0 }; el.force = true;
  SFX.play('ding'); HUD.toast && HUD.toast('The lift is coming up...', 1.6);
}
function updateBossIntro(dt) {
  const I = G.bossIntro, b = G.boss; if (!I || !b) return;
  I.t += dt;
  if (I.phase === 'doors') {
    G.camFocus = { x: b.pos.x, z: b.pos.z + 2, w: Math.min(0.6, I.t * 0.6) };
    if (I.t > 1.3) { I.phase = 'walk'; I.t = 0; b.setState('walkout'); G.cine = true; }
  } else if (I.phase === 'walk') {
    G.camFocus = { x: b.pos.x, z: b.pos.z, w: Math.min(1, 0.6 + I.t * 0.4) };
    if (b.pos.distanceTo(G.bossOut) < 0.3 || I.t > 5) { I.phase = 'talk'; I.t = 0; b.setState('talk'); G.say(b, bossLine(0), LINES_BOSS[0][1]); }
  } else if (I.phase === 'talk') {
    G.camFocus = { x: b.pos.x, z: b.pos.z + 0.6, w: 1 }; // (all on him: his lines stay on screen wherever Kareem is)
    if (I.t > LINES_BOSS[I.line][1] + 0.15) {
      I.line++; I.t = 0;
      if (I.line < LINES_BOSS.length) G.say(b, bossLine(I.line), LINES_BOSS[I.line][1]);
      else { I.phase = 'beat'; I.t = 0; G.cine = false; G.camFocus = null; I.el.force = false; $('bossrow').classList.add('on'); } // (a beat: Kareem can move, the bar is up, he hasn't started yet)
    }
  } else if (I.phase === 'beat') {
    if (I.t > 1.3) { G.bossIntro = null; b.aggro = true; b.opener = true; b.setState('fight'); } // (and he opens with a grenade)
  }
}
const bossLine = i => { const l = LINES_BOSS[i][0]; return typeof l === 'function' ? l(G.enemies.filter(e => !e.isBoss).length) : l; };
function updateBossBar() {
  const b = G.boss; if (!b) return;
  const f = Math.max(0, b.hp) / b.maxHp; $('bossfill').style.width = (f * 100).toFixed(1) + '%';
  G.bossGhost = Math.max(f, (G.bossGhost ?? 1) - 0.004); $('bossghost').style.width = (G.bossGhost * 100).toFixed(1) + '%'; // (the lost chunk lingers, then drains)
  if (b.ko && !G.bossBarGone) { G.bossBarGone = true; setTimeout(() => $('bossrow').classList.remove('on'), 1800); }
}
G.onPlayerDead = () => {
  G.slowmo(1.2, 0.3);
  setTimeout(() => { G.state = 'dead'; $('dead').classList.add('show'); }, 1300);
};
G.addCombo = (n, keep) => {
  if (n > 0) {
    G.combo += n;
    G.stats.score += Math.round(25 * n * (1 + G.combo * 0.1));
    G.specialProgress += n;
    while (G.specialProgress >= 5) { G.specialProgress -= 5; if (G.specialCharges < (G.ps ? G.ps.charges : 1)) { G.specialCharges++; SFX.play('combo', 1.5); } }
    if (G.combo > G.stats.maxCombo) G.stats.maxCombo = G.combo;
    if (G.combo % 5 === 0) SFX.play('combo', 1 + G.combo / 20);
  }
  G.comboTimer = 2.6;
};
G.resetCombo = () => { G.combo = 0; G.comboTimer = 0; G.specialProgress = 0; };
G.slowmo = (dur, scale) => { G.slowmoT = Math.max(G.slowmoT, dur); G.slowmoScale = Math.min(scale, G.slowmoT > 0 ? G.slowmoScale : 1); G.slowmoScale = scale; };
let muzzle;
G.muzzleLight = p => { muzzle.position.copy(p); muzzle.intensity = 25; };
G.cleanPercent = () => {
  const lvl = FX.dirtLevel ?? 0, base = FX.base || 1;
  // the lobby starts ~74% clean; every visible trace of dirt counts
  return Math.max(0, Math.min(100, Math.floor(100 - 26 * lvl / base + 0.4)));
};

// how much mess is left anywhere (floor grime + blood + dull floor, litter and glass, bodies and rifles)
function messNow() {
  const surf = (FX.dirtLevel ?? 0) / (FX.base || 1);
  let bodies = 0; for (const e of G.enemies) if (e.ko && !e.gone && !e.loaded) bodies++;
  let rifles = 0; for (const c of chairs) if (c.rifle && !c.sucked) rifles++;
  return surf + MESS_W.litter * (litterCount() + junkCount()) + MESS_W.leaf * leafCount() + MESS_W.body * (bodies + rifles);
}
const MESS_W = { litter: 0.003, leaf: 0.0011, body: 0.03 }; // (litter counts a little less, so floor-cleaning is a fair share of the bar)
G.cleanupProgress = () => {
  const m = messNow();
  G.messAtClear = Math.max(G.messAtClear || 0, m); // (blood still spreading after the fight raises the total, not the bar)
  const m0 = G.messAtClear || 1;
  return Math.max(0, Math.min(1, (m0 - m) / (m0 * 0.95))); // the last 5% (faint residue) doesn't hold the bar back
};
G.__mess = () => ({ now: messNow(), atClear: G.messAtClear, surf: (FX.dirtLevel ?? 0) / (FX.base || 1), litter: litterCount() });

function lobbyCleared() {
  if (G.state !== 'play') return;
  G.state = 'cleared';
  G.messAtClear = messNow();
  SFX.play('ding');
  HUD.hideObjective(); G.guideArrow = true; // a gold arrow over Karim points to the elevators
  $('banner').classList.add('show');
  setTimeout(() => $('banner').classList.remove('show'), 3200);
  setTimeout(() => { if (G.state === 'cleared' && !G.leaving) $('jobcard').classList.add('show'); }, 3600); // (then: don't just leave, do the job)
  setTimeout(() => $('jobcard').classList.remove('show'), 11600);
}

// ---------------- leaving: walk into an elevator ----------------
let notYetT = 0;
function updateLeaving(dt) {
  const P = G.player; notYetT -= dt;
  const L0 = G.leaving;
  if (!L0) {
    const e = inElevator(P.pos);
    if (!e || P.hp <= 0 || G.arrive) return;
    if (G.state !== 'cleared') { if (notYetT <= 0) HUD.toast('Not yet: there are still robbers in ' + LV[G.level].place, 2); notYetT = 4; return; }
    G.leaving = { e, t: 0, phase: 'walk' };
    G.autoWalk = new THREE.Vector3(e.x, 0, e.cabZ + 0.1);
    HUD.setObjective('<b>Good work, Karim.</b>');
    return;
  }
  L0.t += dt;
  if (L0.phase === 'walk' && (P.pos.distanceTo(G.autoWalk) < 0.2 || L0.t > 2.5)) { L0.phase = 'turn'; L0.t = 0; G.autoWalk = null; }
  else if (L0.phase === 'turn' && L0.t > 0.7) { L0.phase = 'close'; L0.t = 0; }
  else if (L0.phase === 'close' && L0.t > 1.35) { L0.phase = 'pan'; L0.t = 0; }   // (the camera stays on him until the doors meet)
  else if (L0.phase === 'pan' && L0.t > 3.0) { L0.phase = 'fade'; L0.t = 0; $('blackout').classList.add('on'); } // (then eases up to the bank's name)
  else if (L0.phase === 'fade' && L0.t > 1.2) { L0.phase = 'gone'; showResults(); }
}

// ---------------- results: the level report (shown, counted up, in the elevator) ----------------
function levelReport() {
  const s = G.stats;
  // how much of the post-fight mess got cleaned up (the bar at the bottom of the screen)
  const prog = G.cleanupProgress ? G.cleanupProgress() : 0, clean = prog >= 0.995 ? 100 : Math.min(99, Math.floor(prog * 100));
  const litter = litterCount();
  const kos = G.enemies.filter(e => e.ko).length;
  const combat = s.score + kos * 100 + s.perfect * 150 + s.ground * 75 + s.maxCombo * 50;
  const tidy = clean * 60 + Math.max(0, 600 - litter * 6);
  const damagePenalty = Math.round(s.damage / 4);
  const spotless = s.damage === 0 ? 1500 : 0;
  const total = Math.max(0, combat + tidy + spotless - damagePenalty);
  const grade = gradeFor(clean); // (the grade is about the clean-up: beating the robbers alone is a C)
  const counts = {}; for (const n of s.ledger) counts[n] = (counts[n] || 0) + 1;
  const damages = Object.entries(counts).map(([n, c]) => ({ name: n + (c > 1 ? ' ×' + c : ''), cost: (s.costs && s.costs[n]) || 0 }));
  const pts = pointsFor({ kos, total: G.enemies.length, maxCombo: s.maxCombo, perfect: s.perfect, clean, damage: s.damage });
  const before = { xp: PROG.xp, points: PROG.points };
  const ups = bank(pts.total, total);
  return { title: LV[G.level].name + ' report', grade, before, after: { xp: PROG.xp, points: PROG.points }, ups, total, pts,
    rows: [
      { label: 'Robbers knocked out', v: kos, suffix: ' / ' + G.enemies.length },
      { label: 'Longest combo', v: s.maxCombo, prefix: 'x' },
      { label: 'Perfect dodges', v: s.perfect },
      { label: 'Ground takedowns', v: s.ground },
      { label: 'Combat score', v: combat, cls: 'sub' },
      { label: LV[G.level].name + ' cleaned up', v: clean, suffix: '%' },
      { label: 'Paper & glass swept up', v: s.papers + s.shards },
      { label: 'Housekeeping score', v: tidy, cls: 'sub' },
      ...(spotless ? [{ label: 'Spotless bonus: nothing broken', v: 1500, prefix: '+', cls: 'sub' }] : []),
      ...damages.map(d => ({ label: d.name, v: d.cost, prefix: '−$', cls: 'bad dmg' })),
      { label: 'Property damage', v: s.damage, prefix: '−$', cls: 'bad', note: damagePenalty ? ` (−${damagePenalty.toLocaleString()} pts)` : '' },
      { label: 'Total', v: total, cls: 'total' },
    ],
    pay: [
      { label: LV[G.level].name + ' cleared', v: pts.base, prefix: '+' },
      { label: `Robbers handled (${kos})`, v: pts.ko, prefix: '+' },
      { label: 'Combo', v: pts.combo, prefix: '+' },
      ...(pts.perfect ? [{ label: 'Perfect dodges', v: pts.perfect, prefix: '+' }] : []),
      { label: 'Clean floor', v: pts.clean, prefix: '+' },
      ...(pts.docked ? [{ label: 'Breakages', v: pts.docked, prefix: '−', cls: 'bad' }] : []),
      { label: 'Experience earned', v: pts.total, prefix: '+', suffix: ' XP', cls: 'tot' },
    ] };
}
function showResults() { G.state = 'results'; rideLift(levelReport()); }
function gradeFor(clean) {
  return clean >= 100 ? 'S+' : clean >= 95 ? 'S' : clean >= 90 ? 'A' : clean >= 60 ? 'B' : 'C';
}
G.__grade = gradeFor;
function openShop() {
  renderShop($('shop-body'), () => { if (G.state === 'title' && G.player) { G.player.maxHp = G.player.hp = G.ps.hp; } });
  $('shop').classList.add('show');
}

function pause(on) {
  if (on && (G.state === 'play' || G.state === 'cleared')) { G.prevState = G.state; G.state = 'pause'; $('pause').classList.add('show'); }
  else if (!on && G.state === 'pause') { G.state = G.prevState; $('pause').classList.remove('show'); }
}

// ---------------- levels ----------------
// One level per page load. New game reloads into the basement (the tutorial); its stairs reload into the lobby.
const NEXT_KEY = 'cleansweep.next';
const LEVELS = ['basement', 'lobby', 'ops'];
// per-level words: the report, the banner, the objective
const LV = {
  basement: { no: 0, name: 'Basement', place: 'the basement' },
  lobby: { no: 1, name: 'Lobby', place: 'the lobby' },
  ops: { no: 2, name: 'Operations', place: 'Operations' },
};
G.LV = LV;
function takeNextLevel() {
  let lv = null;
  try { const h = (location.hash || '').slice(1); if (LEVELS.includes(h)) lv = h; } catch (e) {}
  try { const s = localStorage.getItem(NEXT_KEY); if (!lv && LEVELS.includes(s)) lv = s; localStorage.removeItem(NEXT_KEY); } catch (e) {}
  try { if (location.hash) history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
  return lv;
}
function goToLevel(lv) {
  try { localStorage.setItem(NEXT_KEY, lv); } catch (e) {}
  try { history.replaceState(null, '', location.pathname + location.search + '#' + lv); } catch (e) { try { location.hash = lv; } catch (e2) {} }
  location.reload();
}
G.goToLevel = goToLevel;

// ---------------- boot ----------------
async function boot() {
  SFX.preload();
  let hadGfx = loadGfx();
  try { // (v47 fixed a slowdown on Windows that made the game drop itself to Low: give the better settings another try, once)
    if (hadGfx && GFX.preset === 'low' && !localStorage.getItem('cleansweep.gfx47')) { Object.assign(GFX, GFX_PRESETS.high, { preset: 'high' }); hadGfx = false; localStorage.removeItem('cleansweep.gfx'); }
    localStorage.setItem('cleansweep.gfx47', '1');
  } catch (e) {}
  const q0 = new URLSearchParams(location.search).get('q');
  if (q0) Object.assign(GFX, GFX_PRESETS[q0] || GFX_PRESETS.medium, { preset: GFX_PRESETS[q0] ? q0 : 'medium' });
  G.quality = GFX.preset; autoQ = !hadGfx && !q0; // first visit: settle the quality automatically during play
  loadProgress();
  const qs0 = new URLSearchParams(location.search);
  const next = qs0.get('level') || takeNextLevel();
  G.level = LEVELS.includes(next) ? next : 'lobby'; G.levelNo = LV[G.level].no;
  G.direct = !!next; // straight into the level, no title screen
  G.fromStairs = G.direct && G.level === 'lobby'; // (up the stairs from the basement: he comes in through the stairwell doors)
  G.fromLift = G.direct && G.level === 'ops'; // (up in the elevator: he walks out of it onto the floor)
  if (G.level === 'basement') { G.bounds = { ...BS.bounds }; $('loadtext').textContent = 'CLOCKING IN…'; }
  else if (G.level === 'ops') { G.bounds = { ...OPS.bounds }; $('loadtext').textContent = 'UP TO OPERATIONS…'; }
  else if (next) $('loadtext').textContent = 'UP TO THE LOBBY…';
  if (G.direct) $('title').classList.add('hide');
  const TB = [['start', performance.now()]], mark = n => TB.push([n, performance.now()]); // (boot timings: window.__bootTimes)
  initRender();
  initDirt();
  const bar = $('loadbar');
  // make sure sign fonts are ready before textures are painted
  try { await Promise.race([Promise.all(["600 40px Oswald", "400 40px 'Permanent Marker'", "700 40px 'Noto Kufi Arabic'"].map(f => document.fonts.load(f))), new Promise(r => setTimeout(r, 3000))]); } catch (e) {}
  mark('fonts');
  await loadModels(p => bar.style.width = (p * 80) + '%', G.level);
  mark('models');
  initRobberAnims(L.gltf.Karim, L.robberAnims); // (before anything animates Karim's skeleton)
  { let tex = null; L.models.MainChar?.traverse(o => { if (o.isMesh && o.material.map) tex = o.material.map; }); L.karimTex = tex;
    if (L.gltf.Karim) L.karimClean = skClone(L.gltf.Karim.scene); // (a clean copy for the elevator, before the player takes the model over)
    if (!G.direct) initTitle(tex); }
  if (G.level === 'basement') buildBasement(); else if (G.level === 'ops') buildOps(); else buildLevel();
  initPapers(); initShards(); initParticles(); initLeaves(); initJunk();
  muzzle = new THREE.PointLight(0xffb060, 0, 9, 2); G.scene.add(muzzle);
  initDecals(R.floorMat && R.floorMat.userData.uniforms);
  buildCartTools(); buildBarrow(); buildSecret(G.level);
  if (G.level === 'basement') seedBasementMess(); else if (G.level === 'ops') { seedPapers(); seedOpsMess(); seedLeaves(L.plantSpots); } else { seedDirt(); seedPapers(); seedLeaves(L.plantSpots); }
  G.player = new Player();
  if (G.level === 'basement') {
    G.player.pos.copy(BS.start); G.player.yaw = BS.startYaw;
    // one robber, waiting on the stairs behind the fire doors until the tutorial lets him in
    G.enemies.push(new Enemy(BS.robber[0], BS.robber[1], 0, 1, { idle: 'guard' }));
  } else if (G.level === 'ops') {
    spawnOpsEnemies(); for (const e of G.enemies) e.tutHold = true; // (they carry on looting until he steps out of the lift)
    G.player.pos.copy(OPS.start); G.player.yaw = 0;
    if (G.fromLift || !G.direct) { G.arrive = { t: 0, lift: true }; G.cine = true; }
  } else { spawnEnemies(); for (const e of G.enemies) e.tutHold = true; G.introPending = true; } // (they wait for the opening scene)
  if (G.fromStairs) { // at the foot of the stairs up from the basement: he runs up them into the lobby
    const S = L.stairs;
    G.player.pos.set(S.fx, -S.rise * S.steps, S.zBot + 0.45); G.player.yaw = 0;
    G.arrive = { t: 0, wp: 0, walk: new THREE.Vector3() }; G.cine = true; L.stairBar.active = false;
    G.camHold = new THREE.Vector3(STAIR_DOOR.cx, 0.8, G.bounds.minZ + 1.9); // (the camera waits where he'll come out)
    for (const [x, z, nx, nz] of [[0.4, -9.8, 1.6, -6.8], [-9.3, -11.6, -11.2, -11.4]]) { // (nobody waiting right by the doors)
      const g = G.enemies.find(e => Math.hypot(e.pos.x - x, e.pos.z - z) < 0.5); if (g) { g.pos.set(nx, 0, nz); g.home && g.home.copy(g.pos); }
    }
  }
  mark('build');
  bar.style.width = '90%';
  // let the GPU compile, then bake the environment probe (characters hidden)
  for (const o of [G.player.rig.root, ...G.enemies.map(e => e.rig.root)]) o.traverse(m => { if (m.isMesh) m.userData.noProbe = true; });
  ensureEnv(); R.camTarget.copy(G.camHold || G.player.pos).setY(0.8); updateCamera(1);
  // the boss is built now, in plain sight of the shader compile (and his textures sent to the GPU), then hidden until
  // the lift brings him up: no hitch when he arrives
  if (G.level === 'ops' && L.gltf.Boss) { const b = new Boss(R.camTarget.x, R.camTarget.z + 1, 0); G.bossPre = b; b.model.traverse(o => { if (o.isMesh) for (const k of ['map', 'normalMap']) if (o.material[k]) G.renderer.initTexture(o.material[k]); }); }
  await compileScene(G.scene, G.camera); // (every shader once, the way the game draws: much quicker to start)
  if (G.bossPre) { G.renderer.render(G.scene, G.camera); bossPortrait(G.bossPre); G.bossPre.root.visible = false; G.bossPre.rifle.visible = false; } // (his rifle too: it lives in the scene, not on him)
  mark('shaders');
  captureEnvironment(G.level === 'basement' ? new THREE.Vector3(4, 1.6, 0) : G.level === 'ops' ? new THREE.Vector3(0, 1.8, 2) : new THREE.Vector3(-1, 2.2, 0));
  mark('envProbe');
  R.camTarget.copy(G.camHold || G.player.pos).setY(0.8);
  updateCamera(1);
  if (T.ready) { T.scene.environment = G.scene.environment; await compileScene(T.scene, T.cam); }
  mark('compile');
  makePortrait();
  mark('portrait');
  bar.style.width = '100%';
  HUD.init(); setLevelCard();
  mark('hud');
  setDirtBaseline();
  mark('ready');
  window.__bootTimes = TB.map(([n, t], i) => n + ' ' + Math.round(t - (i ? TB[i - 1][1] : t)) + 'ms').join(', ') + ' (from page start ' + Math.round(performance.now()) + 'ms)';
  G.ready = true;
  $('loading').classList.add('done');
  $('startbtn').disabled = false; $('startbtn').textContent = 'Continue';
  if (!hasSave()) { $('startbtn').style.display = 'none'; $('newbtn').classList.remove('tbtn'); $('newbtn').classList.add('primary'); } // (nothing to continue yet: New game leads)
  // fetch the other level's files in the background, so New game (or the stairs up) starts quickly
  setTimeout(() => prefetchLevel(G.level === 'basement' ? 'lobby' : G.level === 'lobby' ? 'ops' : 'basement'), G.direct ? 6000 : 2500);
  const qs = new URLSearchParams(location.search);
  if (qs.has('manual')) { MANUAL = true; window.__step = (n = 1, dt = 1 / 60, draw = true) => { for (let i = 0; i < n; i++) { fakeDt = dt; loop(i === n - 1 && draw); } return 'ok'; }; }
  else requestAnimationFrame(loop);
  if (qs.has('autostart') || G.direct) startGame();
  if (qs.has('lift')) rideLift(qs.has('report') ? levelReport() : null);
  window.__ready = true;
}

function seedPapers() {
  // mess left by the robbers: around desks, reception, vault and the atrium
  // before the fight everything is tidy: neat stacks of paperwork on the desks and counters
  const stack = (x, z, yaw, n, variant, money = false) => {
    for (let i = 0; i < n; i++) spawnPaper(x + rand(-0.008, 0.008), 0, z + rand(-0.008, 0.008), 0, 0, 0, { rest: true, neat: true, stack: i, yaw: yaw + rand(-0.04, 0.04), variant, money });
  };
  for (const s of G.surfaces) {
    const yaw = Math.atan2(s.s, s.c); // follow the desk's orientation
    const along = (u, v) => [s.cx + u * s.c + v * s.s, s.cz - u * s.s + v * s.c];
    const k = Math.max(1, Math.floor(s.hx * 2 / 0.8));
    for (let i = 0; i < k; i++) {
      if (Math.random() < 0.3) continue;
      const u = -s.hx + 0.3 + (i + 0.5) * ((s.hx * 2 - 0.6) / k), v = rand(-s.hz * 0.3, s.hz * 0.3);
      const [x, z] = along(u, v);
      stack(x, z, yaw + (Math.random() < 0.5 ? 0 : Math.PI / 2), 6 + (Math.random() * 12 | 0), Math.floor(Math.random() * 3));
    }
  }

}

function bossPortrait(b) { // (the Contractor's mugshot for his health bar, shot once while he's prewarmed)
  try {
    b.pos.set(OPS.out ? OPS.out.x : b.pos.x, 0, OPS.out ? OPS.out.z : b.pos.z); b.yaw = 0; b.sync(); b.root.visible = true;
    b.animate(1, { Idle: 1 }, 0);
    b.root.updateMatrixWorld(true);
    const head = b.rig.chest.getWorldPosition(new THREE.Vector3()), fwd = new THREE.Vector3(0, 0, 1);
    snapFace(head.add(new THREE.Vector3(0, 0.04, 0)), fwd, -0.32, 1.05, 'bossportrait', [b.rig.chest]);
  } catch (e) { console.warn('boss portrait', e); }
}

function snapFace(head, fwd, side, dist, id) {
  const r = G.renderer, rt = new THREE.WebGLRenderTarget(160, 160);
  const cam = new THREE.PerspectiveCamera(22, 1, 0.05, 10);
  cam.position.copy(head).addScaledVector(fwd, dist).add(new THREE.Vector3(0, 0.05, 0)).addScaledVector(new THREE.Vector3(fwd.z, 0, -fwd.x), side);
  cam.lookAt(head.clone().add(new THREE.Vector3(0, -0.02, 0)));
  const bg = G.scene.background; G.scene.background = new THREE.Color(0x160d0b);
  r.setRenderTarget(rt); r.render(G.scene, cam); r.setRenderTarget(null); G.scene.background = bg;
  const px = new Uint8Array(160 * 160 * 4); r.readRenderTargetPixels(rt, 0, 0, 160, 160, px);
  const cv = document.createElement('canvas'); cv.width = cv.height = 160; const cx = cv.getContext('2d'), img = cx.createImageData(160, 160);
  for (let y = 0; y < 160; y++) for (let x = 0; x < 160; x++) {
    const si = ((159 - y) * 160 + x) * 4, di = (y * 160 + x) * 4;
    for (let k = 0; k < 3; k++) { const v = px[si + k] / 255; img.data[di + k] = Math.min(255, Math.pow(v * 1.25 / (1 + v * 0.35), 1 / 2.2) * 255); }
    img.data[di + 3] = 255;
  }
  cx.putImageData(img, 0, 0); $(id).src = cv.toDataURL(); rt.dispose();
}

function makePortrait() {
  // render the custodian's face for the HUD
  const P = G.player, r = G.renderer;
  const p0 = P.pos.clone(); if (G.arrive && G.arrive.lift) P.pos.copy(OPS.out); // (not shut in the lift for his photo)
  const rt = new THREE.WebGLRenderTarget(160, 160);
  const cam = new THREE.PerspectiveCamera(22, 1, 0.05, 10);
  P.update(0.016);
  const head = P.rig.head.getWorldPosition(new THREE.Vector3());
  const fwd = new THREE.Vector3(Math.sin(P.yaw), 0, Math.cos(P.yaw));
  cam.position.copy(head).addScaledVector(fwd, 0.85).add(new THREE.Vector3(0, 0.05, 0)).addScaledVector(new THREE.Vector3(fwd.z, 0, -fwd.x), 0.3);
  cam.lookAt(head.clone().add(new THREE.Vector3(0, -0.02, 0)));
  const bg = G.scene.background; G.scene.background = new THREE.Color(0x101216);
  P.rig.weapon.visible = false;
  r.setRenderTarget(rt); r.render(G.scene, cam); r.setRenderTarget(null);
  G.scene.background = bg; P.rig.weapon.visible = true; P.pos.copy(p0); P.update(0.016);
  const px = new Uint8Array(160 * 160 * 4); r.readRenderTargetPixels(rt, 0, 0, 160, 160, px);
  const cv = document.createElement('canvas'); cv.width = cv.height = 160; const cx = cv.getContext('2d');
  const img = cx.createImageData(160, 160);
  for (let y = 0; y < 160; y++) for (let x = 0; x < 160; x++) {
    const si = ((159 - y) * 160 + x) * 4, di = (y * 160 + x) * 4;
    for (let k = 0; k < 3; k++) { const v = px[si + k] / 255; img.data[di + k] = Math.min(255, Math.pow(v * 1.25 / (1 + v * 0.35), 1 / 2.2) * 255); }
    img.data[di + 3] = 255;
  }
  cx.putImageData(img, 0, 0);
  $('portrait').src = cv.toDataURL();
  rt.dispose();
}

// the level card: LEVEL 1 · BANK LOBBY
function setLevelCard() { // (and the rest of the words on screen that name the floor)
  if (G.level !== 'ops') return;
  const c = $('lvlcard'); c.querySelector('.lc-k span').textContent = 'Level 2'; c.querySelector('.lc-t').textContent = 'Operations';
  c.querySelector('.lc-s').innerHTML = 'Noon Bank &middot; 2nd floor &middot; Brickell Avenue';
  $('cleanbar').querySelector('.cl-label').textContent = 'Operations clean-up';
  $('banner').textContent = 'FLOOR SECURED';
  $('jobcard').querySelector('.ic-t').innerHTML = 'Operations secured. The <b>gold arrow</b> points to the elevators. But you\'re the custodian, Karim: <b>clean up this floor first</b>.';
  $('jobcard').querySelector('.ic-s').textContent = 'A cleaner floor earns a better grade and more XP for upgrades.';
}
function levelCard(on) { const c = $('lvlcard'); if (!c) return; c.classList.toggle('show', on); c.classList.toggle('hide', !on); }
// arriving from the basement: the card over black, then the lobby fades up with the camera already waiting where
// the level begins; Karim runs up the stairs (out of sight, behind the wall) and bursts through the fire doors
function updateArrival(dt) {
  if (G.arrive.lift) return updateLiftArrival(dt);
  const a = G.arrive, S = L.stairs, P = G.player, D = STAIR_DOOR, zw = G.bounds.minZ;
  a.t += dt;
  if (!a.lit && a.t > 2.3) { a.lit = true; $('blackout').classList.remove('on'); levelCard(false); }
  const WP = [[S.fx, S.zTop + 0.35], [D.cx - 0.1, zw - 0.95], [D.cx, zw + 1.9]];
  if (a.t > 2.2) {
    G.autoRun = true;
    const w = WP[a.wp]; G.autoWalk = a.walk.set(w[0], 0, w[1]);
    if (a.wp < WP.length - 1 && Math.hypot(P.pos.x - w[0], P.pos.z - w[1]) < 0.5) a.wp++;
  }
  // up the steps (a smooth ramp, half a step up so his feet stay on the treads)
  P.pos.y = P.pos.z < S.zTop && P.pos.x < D.cx ? Math.min(0, Math.max(-S.rise * S.steps, (P.pos.z - S.zTop) / S.run * S.rise + S.rise * 0.5)) : 0;
  if (!a.opened && P.pos.z > zw - 1.7) { a.opened = true; L.stairDoor.open(); }
  if (P.pos.z > zw + 1.5 || a.t > 11) {
    G.autoWalk = null; G.autoRun = false; G.arrive = null; G.cine = false; G.camHold = null; P.pos.y = 0;
    L.stairDoor.close(); L.stairBar.active = true;
    $('hud').classList.add('show');
    G.introDelay = 0.6;
  }
}

// up to Operations: the level card over black, the doors part and he walks out onto the floor; the nearest robber clocks him
function updateLiftArrival(dt) {
  const a = G.arrive, P = G.player; a.t += dt;
  if (!a.lit && a.t > 2.3) { a.lit = true; $('blackout').classList.remove('on'); levelCard(false); }
  if (a.t > 3.4 && !a.out) { a.out = true; G.autoWalk = OPS.out.clone(); }
  if (a.out && (P.pos.distanceTo(OPS.out) < 0.25 || a.t > 8)) {
    G.autoWalk = null; G.arrive = null; G.cine = false;
    $('hud').classList.add('show');
    for (const e of G.enemies) e.tutHold = false;
    let e = null, bd = 1e9; for (const o of G.enemies) { const d = o.pos.distanceTo(P.pos); if (d < bd) { bd = d; e = o; } }
    if (e) { e.alert(0.2); say(e, LINES_OPS[Math.random() * LINES_OPS.length | 0]); SFX.play('alert'); G.sayT = 2.4; G.sayE = e; }
  }
}
const LINES_OPS = ['The janitor?! Again?!', 'Who let HIM up here?!', 'It\'s the mop guy! Get him!'];

// the lobby's opening: the nearest robber comes over ("Get in the vault!"), everything freezes while a card says the
// takedown is ready, Q smashes him, and then the rest of the gang comes for Karim
function updateIntro(dt) {
  const P = G.player;
  if (G.introPending) {
    G.introDelay = (G.introDelay ?? 1.4) - dt; if (G.introDelay > 0) return;
    G.introPending = false;
    // the nearest robber who can walk straight up to him (nobody stuck behind a glass partition)
    const clear = o => { const dx = P.pos.x - o.pos.x, dz = P.pos.z - o.pos.z, L = Math.hypot(dx, dz), n = Math.ceil(L / 0.2);
      for (let i = 1; i < n; i++) { const x = o.pos.x + dx * i / n, z = o.pos.z + dz * i / n; if (G.colliders.some(b => b.active && b.y1 > 0.5 && b.y0 < 1.2 && pointInBox(b, x, z, 0.3))) return false; } return true; };
    let e = null, bd = 1e9;
    for (const pass of [true, false]) { for (const o of G.enemies) { const d = o.pos.distanceTo(P.pos); if (!o.ko && d < bd && (!pass || clear(o))) { bd = d; e = o; } } if (e) break; }
    G.__introPick = e && [e.pos.x.toFixed(1), e.pos.z.toFixed(1), bd.toFixed(1)].join(',');
    if (!e) return releaseIntro();
    G.intro = { t: 0, e, phase: 'walk' }; G.cine = true;
    e.tutHold = false; e.tutNoAttack = true; e.tutIdeal = 2.2; e.alert(0);
    e.tutWalk = P.pos.clone().add(e.pos.clone().sub(P.pos).setY(0).normalize().multiplyScalar(2.2));
    return;
  }
  const I = G.intro, e = I.e; I.t += dt;
  const d = e.pos.distanceTo(P.pos);
  if (I.phase !== 'strike') { G.camFocus = { x: (P.pos.x + e.pos.x) / 2, z: (P.pos.z + e.pos.z) / 2, w: 0.5 }; /* (he stays facing the way he came up the stairs: no turning, by mouse or otherwise) */ }
  if (I.phase === 'walk' && (d < 2.9 || I.t > 4.5)) { I.phase = 'talk'; I.t = 0; say(e, 'Hey! Get in the vault with the other hostages!'); SFX.play('alert'); }
  else if (I.phase === 'talk' && I.t > 2.4) { // freeze: the takedown is ready
    I.phase = 'freeze'; G.freeze = true; G.specialCharges = Math.max(1, G.specialCharges); G.introTarget = e;
    $('introcard').classList.add('show'); SFX.play('special');
  } else if (I.phase === 'strike' && (e.ko || I.t > 3)) releaseIntro();
  if (I.phase === 'talk' || I.phase === 'freeze') placeSpeech(e); else say(null);
}
// nobody's fighting him but some robbers are still on their feet somewhere: after a few calm seconds the nearest
// ones come looking for him (so he doesn't settle into cleaning with one forgotten in a back office)
function updateHunt(dt) {
  const left = G.enemies.filter(e => !e.ko && !e.gone); if (!left.length) return;
  if (left.some(e => e.aggro)) { G.calmT = 0; return; }
  G.calmT = (G.calmT || 0) + dt; if (G.calmT < 4) return;
  G.calmT = -8;
  const P = G.player.pos; left.sort((a, b) => a.pos.distanceTo(P) - b.pos.distanceTo(P));
  for (const e of left.slice(0, 2)) { e.tutHold = false; e.alert(rand(0.2, 0.9)); }
  HUD.toast('Footsteps… more of them are coming', 2.6); SFX.play('alert');
}
function introTakedown() {
  const I = G.intro; if (!I || I.phase !== 'freeze') return;
  G.freeze = false; G.cine = false; $('introcard').classList.remove('show'); say(null);
  I.phase = 'strike'; I.t = 0; G.camFocus = null;
  G.player.trySpecial();
}
function releaseIntro() {
  const e = G.intro && G.intro.e;
  G.intro = null; G.introPending = false; G.freeze = false; G.cine = false; G.camFocus = null; G.introTarget = null; say(null); $('introcard').classList.remove('show');
  for (const o of G.enemies) { o.tutHold = false; o.tutNoAttack = false; o.tutWalk = null; }
  if (e) for (const o of G.enemies) if (!o.ko && o.pos.distanceTo(e.pos) < 11) o.alert(rand(0.2, 0.9)); // (they heard that)
}
// a speech bubble over a robber's head
function say(e, text) { const b = $('speech'); if (!e) { b.classList.remove('show'); return; } b.textContent = text; b.classList.add('show'); placeSpeech(e); }
const _sp = new THREE.Vector3();
function placeSpeech(e) {
  const b = $('speech'); _sp.copy(e.pos).setY(2.35).project(G.camera);
  b.style.left = ((_sp.x * 0.5 + 0.5) * innerWidth) + 'px'; b.style.top = ((-_sp.y * 0.5 + 0.5) * innerHeight) + 'px';
}

function startGame() {
  if (G.state !== 'title') return;
  SFX.init();
  G.state = 'play';
  computeStats(); G.player.maxHp = G.player.hp = G.ps.hp; G.player.maxEnergy = G.player.energy = G.ps.stamina;
  $('shop').classList.remove('show'); closeMenu();
  if (G.fromStairs || G.arrive) { // up from the dark stairwell (or the lift): the level card over black, then he runs up the stairs (updateArrival)
    const b = $('blackout'); b.style.transition = 'none'; b.classList.add('on');
    requestAnimationFrame(() => requestAnimationFrame(() => { b.style.transition = ''; }));
  } else { // a white flash carries the studio into the lobby
    $('fade').classList.add('on'); requestAnimationFrame(() => requestAnimationFrame(() => $('fade').classList.remove('on')));
  }
  $('title').classList.add('hide');
  if (G.level !== 'basement') { levelCard(true); if (!G.fromStairs && !G.arrive) setTimeout(() => levelCard(false), 3000); }
  if (!G.fromStairs && !G.arrive) $('hud').classList.add('show');
  HUD.setObjective(G.level === 'ops' ? '<b>Clean up Operations</b>. (The visitors made it upstairs.)' : '<b>Clean the lobby</b>. (There seem to be some visitors.)');
  if (G.level === 'lobby' && !PROG.reached) { PROG.reached = 'lobby'; saveProgress(); }
  if (G.level === 'ops' && PROG.reached !== 'ops') { PROG.reached = 'ops'; saveProgress(); }
  if (G.level === 'basement') startTutorial(G.enemies[0], () => goToLevel('lobby'));
  perfT = 0; perfN = 0; perfSum = 0;
}

// ---------------- loop ----------------
let lastT = performance.now();
let perfT = 0, perfSum = 0, perfN = 0;
var autoQ = true; // (var: boot sets it before the loop's declarations run)
let MANUAL = false, fakeDt = 1 / 60;
function loop(draw = true) {
  if (!MANUAL) requestAnimationFrame(loop);
  const nowT = performance.now(); const rdt = MANUAL ? fakeDt : Math.min((nowT - lastT) / 1000, 0.05); lastT = nowT;
  G.time += rdt;
  const active = G.state === 'play' || G.state === 'cleared' || (G.state === 'dead');
  if (G.state !== 'play' && G.state !== 'cleared') SFX.hush(); // (no wiping or vacuum hum carrying on under a menu)
  // time scaling
  if (G.slowmoT > 0) { G.slowmoT -= rdt; G.timeScale = G.slowmoScale; } else G.timeScale += (1 - G.timeScale) * (1 - Math.exp(-6 * rdt));
  let dt = rdt * G.timeScale;
  if (G.hitstop > 0) { G.hitstop -= rdt; dt = 0; }
  if (G.freeze) dt = 0; // (the lobby intro holds the moment while it tells you about the takedown)
  if (G.state === 'pause' || G.state === 'title' || G.state === 'results' || G.state === 'lift') dt = 0;
  if (G.cinematic > 0) G.cinematic = Math.max(0, G.cinematic - rdt * 0.9);

  if (active && dt > 0) {
    G.simTime += dt;
    // mouse -> ground
    if (Input.mouseActive) {
      const ndc = new THREE.Vector2(Input.mx / innerWidth * 2 - 1, -(Input.my / innerHeight) * 2 + 1);
      const ray = new THREE.Raycaster(); ray.setFromCamera(ndc, G.camera);
      ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), G.mouseGround);
    }
    globalCool -= dt;
    if (G.comboTimer > 0) { G.comboTimer -= dt; if (G.comboTimer <= 0) G.resetCombo(); }
    G.player.update(dt);
    for (const e of G.enemies) e.update(dt);
    updateDestructibles(dt);
    if (G.level === 'basement') updateTutorial(dt); else updateLeaving(dt);
  } else if (G.state === 'lift') updateLift(rdt);
  else if (G.state === 'title') {
    G.player.update(0.0001); // (keeps his in-game pose ready for the start)
    updateTitle(rdt);
  }
  updateFX(dt); updateSecret(dt); if (G.state === 'play') updateNav(dt);
  muzzle.intensity *= Math.exp(-40 * rdt);
  updateCamera(rdt);
  updateOccluders();
  updateWater(G.time);
  { // mop glow on the floor + blood
    // the mop shows what's left while you mop (C); the vacuum and polisher show it the whole time they're in his hands
    const showGlow = G.player && G.state !== 'title' && (G.player.cleaning || G.player.tool !== 'mop' || G.tutGlow);
    G.cleanGlow = (G.cleanGlow || 0) + ((showGlow ? 0.7 : 0) - (G.cleanGlow || 0)) * (1 - Math.exp(-5 * rdt));
    const fu = R.floorMat && R.floorMat.userData.uniforms;
    const gc = G.tutGlow || { x: G.player.pos.x, z: G.player.pos.z, r: 4.5 }; // (the tutorial can light up a spot of its own)
    if (fu && fu.uClean) { fu.uClean.value.set(gc.x, gc.z, gc.r, G.cleanGlow); fu.uTime.value = G.time; fu.uTool.value = TOOL_ORDER.indexOf(G.player.tool); }
    updateCartTools(); if (G.barrow && !G.barrow.held) parkBarrow(); else if (G.barrow && G.barrow.col) G.barrow.col.active = false; updateBarrowHops(dt);
    { // the wheelbarrow rumbling along while he pushes it (slower and lower with a load in it)
      const B = G.barrow, live = G.state === 'play' || G.state === 'cleared', v = live && B && B.held ? G.player.vel.length() : 0;
      SFX.loop('rollBarrow', Math.min(1, v / 2.4) * 0.55, Math.max(0.5, 0.65 + Math.min(v, 5) * 0.12 - (B && B.load.length ? 0.08 : 0)));
    }
    FX.glow = G.cleanGlow > 0.01 ? [gc.x, gc.z, gc.r, G.cleanGlow] : null;
  }
  updateElevators(dt);
  if (G.level === 'basement') updateBasement(dt);
  else {
    updateStairDoor(dt);
    if (G.arrive && G.state === 'play') updateArrival(rdt);
    else if (G.state === 'play' && (G.introPending || G.intro)) updateIntro(rdt);
    else if (G.state === 'play') updateHunt(rdt);
    if (G.bossIntro && G.state === 'play') updateBossIntro(dt); if (G.boss) updateBossBar();
    if (G.sayT > 0) { G.sayT -= rdt; if (G.sayT <= 0 || G.sayE.ko) { G.sayT = 0; say(null); } else placeSpeech(G.sayE); }
  }
  updateGuideArrow(rdt);
  if (G.state !== 'title' && G.state !== 'lift') HUD.update(rdt);
  if (R.grade) { G.dmgFlash = Math.max(0, (G.dmgFlash || 0) - rdt * 2.5); R.grade.uniforms.dmg.value = G.dmgFlash * 0.6; } // (just the brief flash on a hit; no red pulse at low health)
  if (draw !== false) renderFrame(G.state === 'title' ? T : G.state === 'lift' ? LIFT : null);
  // auto quality during the first seconds of play
  if (autoQ && !MANUAL && G.state === 'play') {
    perfT += rdt; if (perfT > 1.5) { perfSum += rdt; perfN++; }
    if (perfN > 90) {
      const avg = perfSum / perfN;
      if (avg > 0.03 && G.quality !== 'low') { setQuality(G.quality === 'high' ? 'medium' : 'low'); HUD.toast('Graphics lowered to ' + G.quality + ' for smoother play (change it under Graphics)', 2.5); perfN = 0; perfSum = 0; if (G.quality === 'low') autoQ = false; }
      else autoQ = false;
    }
  }
}

$('startbtn').addEventListener('click', () => { if (!G.direct && PROG.reached === 'ops' && G.level !== 'ops') { $('startbtn').textContent = 'Going up…'; goToLevel('ops'); } else startGame(); }); // (Continue: back to the highest floor reached)

$('shopclose').addEventListener('click', () => $('shop').classList.remove('show'));
$('retry').addEventListener('click', () => { $('retry').textContent = 'Back to work…'; goToLevel(G.level); }); // (from the start of this level: the lobby begins at the top of the stairs again)
$('again').addEventListener('click', () => rideLift());
// the elevator between levels: upgrades, then on to the next level (the lobby again until the next floor is built) or a retry
function rideLift(report) {
  const next = G.level === 'basement' ? 'lobby' : 'ops'; // (Operations is the top floor so far: it comes round again)
  LIFT.floorTo = LV[next].no; LIFT.nextName = LV[next].name;
  enterLift(() => goToLevel(next), () => goToLevel(G.level), report);
}
G.rideLift = rideLift; G.__report = levelReport;
$('resume').addEventListener('click', () => pause(false));
// New game: wipes points and upgrades (asks once more first)
let newArm = 0;
$('newbtn').addEventListener('click', () => {
  const b = $('newbtn');
  const fresh = PROG.points === 0 && PROG.runs === 0 && Object.values(PROG.lv).every(v => !v); // (nothing to lose: no need to ask)
  if (!fresh && !b.classList.contains('armed')) { b.classList.add('armed'); b.textContent = 'Erase all progress?'; clearTimeout(newArm); newArm = setTimeout(() => { b.classList.remove('armed'); b.textContent = 'New game'; }, 3500); return; }
  clearTimeout(newArm); resetProgress();
  b.classList.remove('armed'); b.textContent = 'Clocking in…';
  goToLevel('basement'); // a fresh start begins in the basement, with the tutorial
});
$('menubtn').addEventListener('click', () => location.reload()); // back to the title screen
window.G = G; window.THREE = THREE; G.__L = L; G.__SFX = SFX; G.__FX = FX; G.__blood = bloodPool; G.__clean = cleanAt; G.__paper = spawnPaper; G.__vac = vacuumAt; G.__LIFT = LIFT; G.__papers = papers; G.__junk = junk; G.__polish = polishFloor; // debug handles
boot().catch(err => { console.error(err); const w = $('loadword'); w.classList.add('err'); w.textContent = 'Could not start: ' + String(err && err.message || err).slice(0, 140); });
