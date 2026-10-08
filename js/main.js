// Clean Sweep — bootstrap, input, game loop, director, scoring
import * as THREE from 'three';
import { G, rand } from './state.js';
import { initRender, renderFrame, updateCamera, captureEnvironment, setQuality, setGfx, loadGfx, GFX, GFX_PRESETS, R, ensureEnv, compileScene } from './render.js';
import { initTitle, updateTitle, T } from './title.js';
import { loadModels, buildLevel, updateOccluders, updateWater, L , updateElevators, inElevator, updateGuideArrow, STAIR_DOOR, updateStairDoor, prefetchLevel } from './level.js';
import { initDecals } from './decals.js';
import { initRobberAnims } from './robanim.js';
import { buildCartTools, updateCartTools, nearCart, TOOL_ORDER, buildBarrow, parkBarrow, updateBarrowHops } from './tools.js';
import { chairs } from './destruct.js';
import { initDirt, seedDirt, initPapers, initShards, initParticles, spawnPaper, updateFX, setDirtBaseline, measureDirt, litterCount, FX, bloodPool, cleanAt, initLeaves, seedLeaves, leafCount } from './fx.js';
import { Player, spawnEnemies, Enemy } from './actors.js';
import { BS, buildBasement, seedBasementMess, updateBasement } from './basement.js';
import { TUT, startTutorial, updateTutorial } from './tutorial.js';
import { updateDestructibles } from './destruct.js';
import { HUD } from './hud.js';
import { SFX } from './audio.js';
import { loadProgress, resetProgress, computeStats, renderShop, pointsFor, bank, P as PROG } from './progress.js';

const $ = id => document.getElementById(id);

// ---------------- input ----------------
const Input = {
  down: new Set(), mouseActive: false, mx: 0, my: 0,
  key(c) { return this.down.has(c); },
};
G.input = Input;
addEventListener('keydown', e => {
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
  // Ctrl = mop: swallow the browser shortcuts a page is allowed to block (Ctrl+D bookmark, Ctrl+S save, Ctrl+A ...) while playing
  if (e.ctrlKey && (G.state === 'play' || G.state === 'cleared') && !e.metaKey) e.preventDefault();
  if (e.repeat) return;
  Input.down.add(e.code);
  onKey(e.code);
});
addEventListener('keyup', e => Input.down.delete(e.code));
addEventListener('blur', () => Input.down.clear());
// Ctrl+W can't be blocked by a page; if the browser allows it, ask before the tab closes mid-level
addEventListener('beforeunload', e => { if (G.state === 'play' || G.state === 'cleared') { e.preventDefault(); e.returnValue = ''; } });
addEventListener('mousemove', e => { Input.mx = e.clientX; Input.my = e.clientY; Input.mouseActive = true; });
addEventListener('contextmenu', e => e.preventDefault());
addEventListener('mousedown', e => {
  if ((G.state !== 'play' && G.state !== 'cleared') || G.leaving || G.cine) return;
  if (e.target.closest && e.target.closest('button')) return;
  if (e.button === 0) G.player.tryAttack();
  if (e.button === 2) G.player.trySweep();
});

function onKey(code) {
  if (code === 'KeyM') { const m = SFX.toggleMute(); HUD.toast(m ? 'Sound off' : 'Sound on', 1.2); }
  if (code === 'KeyG') cycleQuality();
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
  const max = aggro > 5 ? 3 : 2;
  if (G.attackers.size >= max || globalCool > 0 || G.player.state === 'dead') return false;
  G.attackers.add(e); globalCool = rand(0.45, 1.0); return true;
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
  if (left === 0) setTimeout(() => lobbyCleared(), 900);
};
G.onPlayerDead = () => {
  G.slowmo(1.2, 0.3);
  setTimeout(() => { G.state = 'dead'; $('dead').classList.add('show'); }, 1300);
};
G.addCombo = (n, keep) => {
  if (n > 0) {
    G.combo += n;
    G.stats.score += Math.round(25 * n * (1 + G.combo * 0.1));
    G.specialProgress += n;
    while (G.specialProgress >= 5) { G.specialProgress -= 5; if (G.specialCharges < 3) { G.specialCharges++; SFX.play('combo', 1.5); } }
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
  return surf + MESS_W.litter * litterCount() + MESS_W.leaf * leafCount() + MESS_W.body * (bodies + rifles);
}
const MESS_W = { litter: 0.004, leaf: 0.0015, body: 0.03 };
G.cleanupProgress = () => {
  const m = messNow();
  G.messAtClear = Math.max(G.messAtClear || 0, m); // (blood still spreading after the fight raises the total, not the bar)
  const m0 = G.messAtClear || 1;
  return Math.max(0, Math.min(1, (m0 - m) / (m0 * 0.97))); // the last 3% (faint residue) doesn't hold the bar back
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
}

// ---------------- leaving: walk into an elevator ----------------
let notYetT = 0;
function updateLeaving(dt) {
  const P = G.player; notYetT -= dt;
  const L0 = G.leaving;
  if (!L0) {
    const e = inElevator(P.pos);
    if (!e || P.hp <= 0) return;
    if (G.state !== 'cleared') { if (notYetT <= 0) HUD.toast('Not yet: there are still robbers in the lobby', 2); notYetT = 4; return; }
    G.leaving = { e, t: 0, phase: 'walk' };
    G.autoWalk = new THREE.Vector3(e.x, 0, e.cabZ + 0.1);
    HUD.setObjective('<b>Good work, Karim.</b>');
    return;
  }
  L0.t += dt;
  if (L0.phase === 'walk' && (P.pos.distanceTo(G.autoWalk) < 0.2 || L0.t > 2.5)) { L0.phase = 'turn'; L0.t = 0; G.autoWalk = null; }
  else if (L0.phase === 'turn' && L0.t > 0.7) { L0.phase = 'close'; L0.t = 0; }
  else if (L0.phase === 'close' && L0.t > 2.3) { L0.phase = 'gone'; showResults(); }
}

// ---------------- results ----------------
function showResults() {
  G.state = 'results';
  const s = G.stats;
  // how much of the post-fight mess got cleaned up (the bar at the bottom of the screen)
  const prog = G.cleanupProgress(), clean = prog >= 0.995 ? 100 : Math.min(99, Math.floor(prog * 100));
  const litter = litterCount();
  const kos = G.enemies.filter(e => e.ko).length;
  const combat = s.score + kos * 100 + s.perfect * 150 + s.ground * 75 + s.maxCombo * 50;
  const tidy = clean * 60 + Math.max(0, 600 - litter * 6);
  const damagePenalty = Math.round(s.damage / 4);
  const spotless = s.damage === 0 ? 1500 : 0;
  const total = Math.max(0, combat + tidy + spotless - damagePenalty);
  // the grade is about the clean-up: beating the robbers alone is a C
  const grade = gradeFor(clean);
  const counts = {}; for (const n of s.ledger) counts[n] = (counts[n] || 0) + 1;
  const ledger = Object.entries(counts).map(([n, c]) => `<li><span>${n}${c > 1 ? ' ×' + c : ''}</span></li>`).join('') || '<li><span>Nothing. Not a single thing.</span></li>';
  $('results-body').innerHTML = `
    <div class="grade g${grade.replace('+', 'p')}">${grade}</div>
    <table>
      <tr><td>Robbers knocked out</td><td>${kos} / ${G.enemies.length}</td></tr>
      <tr><td>Longest combo</td><td>x${s.maxCombo}</td></tr>
      <tr><td>Perfect dodges</td><td>${s.perfect}</td></tr>
      <tr><td>Ground takedowns</td><td>${s.ground}</td></tr>
      <tr class="sub"><td>Combat score</td><td>${combat.toLocaleString()}</td></tr>
      <tr><td>Lobby cleaned up</td><td>${clean}%</td></tr>
      <tr><td>Paper &amp; glass swept up</td><td>${s.papers + s.shards}</td></tr>
      <tr class="sub"><td>Housekeeping score</td><td>${tidy.toLocaleString()}</td></tr>
      ${spotless ? '<tr class="sub"><td>Spotless bonus — nothing broken</td><td>+1,500</td></tr>' : ''}
      <tr class="bad"><td>Property damage</td><td>−$${s.damage.toLocaleString()} <small>(−${damagePenalty.toLocaleString()} pts)</small></td></tr>
      <tr class="total"><td>Total</td><td>${total.toLocaleString()}</td></tr>
    </table>
    <div class="ledger"><h4>Damage report</h4><ul>${ledger}</ul></div>`;
  const pts = pointsFor({ kos, maxCombo: s.maxCombo, perfect: s.perfect, clean, damage: s.damage });
  bank(pts.total, total);
  $('results-body').innerHTML += `<div class="pay"><h4>Upgrade points</h4>
    <div><span>Lobby cleared</span><b>+${pts.base}</b></div>
    <div><span>Robbers handled (${kos})</span><b>+${pts.ko}</b></div>
    <div><span>Combo</span><b>+${pts.combo}</b></div>
    ${pts.perfect ? `<div><span>Perfect dodges</span><b>+${pts.perfect}</b></div>` : ''}
    <div><span>Clean floor</span><b>+${pts.clean}</b></div>
    ${pts.docked ? `<div class="bad"><span>Breakages</span><b>−${pts.docked}</b></div>` : ''}
    <div class="tot"><span>Earned</span><b>★ ${pts.total}</b></div></div>`;
  $('results').classList.add('show');
}
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
function takeNextLevel() {
  let lv = null;
  try { const h = (location.hash || '').slice(1); if (h === 'basement' || h === 'lobby') lv = h; } catch (e) {}
  try { const s = localStorage.getItem(NEXT_KEY); if (!lv && (s === 'basement' || s === 'lobby')) lv = s; localStorage.removeItem(NEXT_KEY); } catch (e) {}
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
  G.level = next === 'basement' ? 'basement' : 'lobby';
  G.direct = !!next; // straight into the level, no title screen
  G.fromStairs = G.direct && G.level === 'lobby'; // (up the stairs from the basement: he comes in through the stairwell doors)
  if (G.level === 'basement') { G.bounds = { ...BS.bounds }; $('loadtext').textContent = 'CLOCKING IN…'; }
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
  if (!G.direct) { let tex = null; L.models.MainChar?.traverse(o => { if (o.isMesh && o.material.map) tex = o.material.map; }); initTitle(tex); }
  if (G.level === 'basement') buildBasement(); else buildLevel();
  initPapers(); initShards(); initParticles(); initLeaves();
  muzzle = new THREE.PointLight(0xffb060, 0, 9, 2); G.scene.add(muzzle);
  initDecals(R.floorMat && R.floorMat.userData.uniforms);
  buildCartTools(); buildBarrow();
  if (G.level === 'basement') seedBasementMess(); else { seedDirt(); seedPapers(); seedLeaves(L.plantSpots); }
  G.player = new Player();
  if (G.level === 'basement') {
    G.player.pos.copy(BS.start); G.player.yaw = BS.startYaw;
    // one robber, waiting on the stairs behind the fire doors until the tutorial lets him in
    G.enemies.push(new Enemy(BS.robber[0], BS.robber[1], 0, 1, { idle: 'guard' }));
  } else spawnEnemies();
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
  await compileScene(G.scene, G.camera); // (every shader once, the way the game draws: much quicker to start)
  mark('shaders');
  captureEnvironment(G.level === 'basement' ? new THREE.Vector3(4, 1.6, 0) : new THREE.Vector3(-1, 2.2, 0));
  mark('envProbe');
  R.camTarget.copy(G.camHold || G.player.pos).setY(0.8);
  updateCamera(1);
  if (T.ready) { T.scene.environment = G.scene.environment; await compileScene(T.scene, T.cam); }
  mark('compile');
  makePortrait();
  mark('portrait');
  bar.style.width = '100%';
  HUD.init();
  mark('hud');
  setDirtBaseline();
  mark('ready');
  window.__bootTimes = TB.map(([n, t], i) => n + ' ' + Math.round(t - (i ? TB[i - 1][1] : t)) + 'ms').join(', ') + ' (from page start ' + Math.round(performance.now()) + 'ms)';
  G.ready = true;
  $('loading').classList.add('done');
  $('startbtn').disabled = false; $('startbtn').textContent = 'Continue';
  // fetch the other level's files in the background, so New game (or the stairs up) starts quickly
  setTimeout(() => prefetchLevel(G.level === 'basement' ? 'lobby' : 'basement'), G.direct ? 6000 : 2500);
  const qs = new URLSearchParams(location.search);
  if (qs.has('manual')) { MANUAL = true; window.__step = (n = 1, dt = 1 / 60, draw = true) => { for (let i = 0; i < n; i++) { fakeDt = dt; loop(i === n - 1 && draw); } return 'ok'; }; }
  else requestAnimationFrame(loop);
  if (qs.has('autostart') || G.direct) startGame();
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

function makePortrait() {
  // render the custodian's face for the HUD
  const P = G.player, r = G.renderer;
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
  G.scene.background = bg; P.rig.weapon.visible = true;
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
function levelCard(on) { const c = $('lvlcard'); if (!c) return; c.classList.toggle('show', on); c.classList.toggle('hide', !on); }
// arriving from the basement: the card over black, then the lobby fades up with the camera already waiting where
// the level begins; Karim runs up the stairs (out of sight, behind the wall) and bursts through the fire doors
function updateArrival(dt) {
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
  }
}

function startGame() {
  if (G.state !== 'title') return;
  SFX.init();
  G.state = 'play';
  computeStats(); G.player.maxHp = G.player.hp = G.ps.hp;
  $('shop').classList.remove('show'); closeMenu();
  if (G.fromStairs) { // up from the dark stairwell: the level card over black, then he runs up the stairs (updateArrival)
    const b = $('blackout'); b.style.transition = 'none'; b.classList.add('on');
    requestAnimationFrame(() => requestAnimationFrame(() => { b.style.transition = ''; }));
  } else { // a white flash carries the studio into the lobby
    $('fade').classList.add('on'); requestAnimationFrame(() => requestAnimationFrame(() => $('fade').classList.remove('on')));
  }
  $('title').classList.add('hide');
  if (G.level === 'lobby') { levelCard(true); if (!G.fromStairs) setTimeout(() => levelCard(false), 3000); }
  if (!G.fromStairs) $('hud').classList.add('show');
  HUD.setObjective('<b>Clean the lobby</b>. (There seem to be some visitors.)');
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
  if (G.state === 'pause' || G.state === 'title' || G.state === 'results') dt = 0;
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
  } else if (G.state === 'title') {
    G.player.update(0.0001); // (keeps his in-game pose ready for the start)
    updateTitle(rdt);
  }
  updateFX(dt);
  muzzle.intensity *= Math.exp(-40 * rdt);
  updateCamera(rdt);
  updateOccluders();
  updateWater(G.time);
  { // mop glow on the floor + blood
    // the mop shows what's left while you mop (Ctrl); the vacuum and polisher show it the whole time they're in his hands
    const showGlow = G.player && G.state !== 'title' && (G.player.cleaning || G.player.tool !== 'mop' || G.tutGlow);
    G.cleanGlow = (G.cleanGlow || 0) + ((showGlow ? 0.7 : 0) - (G.cleanGlow || 0)) * (1 - Math.exp(-5 * rdt));
    const fu = R.floorMat && R.floorMat.userData.uniforms;
    const gc = G.tutGlow || { x: G.player.pos.x, z: G.player.pos.z, r: 3.4 }; // (the tutorial can light up a spot of its own)
    if (fu && fu.uClean) { fu.uClean.value.set(gc.x, gc.z, gc.r, G.cleanGlow); fu.uTime.value = G.time; fu.uTool.value = TOOL_ORDER.indexOf(G.player.tool); }
    updateCartTools(); if (G.barrow && !G.barrow.held) parkBarrow(); updateBarrowHops(dt);
    FX.glow = G.cleanGlow > 0.01 ? [gc.x, gc.z, gc.r, G.cleanGlow] : null;
  }
  updateElevators(dt);
  if (G.level === 'basement') updateBasement(dt);
  else {
    updateStairDoor(dt);
    if (G.arrive && G.state === 'play') updateArrival(rdt);
  }
  updateGuideArrow(rdt);
  if (G.state !== 'title') HUD.update(rdt);
  if (R.grade) { G.dmgFlash = Math.max(0, (G.dmgFlash || 0) - rdt * 2.5); R.grade.uniforms.dmg.value = G.dmgFlash * 0.6; } // (just the brief flash on a hit; no red pulse at low health)
  if (draw !== false) renderFrame(G.state === 'title' ? T : null);
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

$('startbtn').addEventListener('click', startGame);
$('rshop').addEventListener('click', openShop);
$('shopclose').addEventListener('click', () => $('shop').classList.remove('show'));
$('retry').addEventListener('click', () => { $('retry').textContent = 'Back to work…'; goToLevel(G.level); }); // (from the start of this level: the lobby begins at the top of the stairs again)
$('again').addEventListener('click', () => location.reload());
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
window.G = G; window.THREE = THREE; G.__L = L; G.__SFX = SFX; G.__FX = FX; G.__blood = bloodPool; G.__clean = cleanAt; G.__paper = spawnPaper; // debug handles
boot().catch(err => { console.error(err); $('loadtext').textContent = 'Could not start: ' + String(err && err.message || err).slice(0, 140); });
