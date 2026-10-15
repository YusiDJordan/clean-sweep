// One secret per level: a little green ceramic tree frog statue tucked away somewhere (a nod to a certain jungle mission).
// Walk into it (or swing the mop at it) and it croaks, hops and is yours: bonus upgrade points, once per save.
import * as THREE from 'three';
import { G } from './state.js';
import { SFX } from './audio.js';
import { spark, floatText } from './fx.js';
import { P as PROG, saveProgress, addXP } from './progress.js';
import { HUD } from './hud.js';

export const SECRET_PTS = 60; // (a nice bonus, not a level of its own)
const SPOTS = { lobby: [17.5, -6.85, 2.6], ops: [10.8, -11.25, 0.7] }; // x, z, facing
export const SECRET = { obj: null, x: 0, z: 0, found: false, t: 0, hop: -1 };

function buildFrog() {
  const g = new THREE.Group();
  const glaze = new THREE.MeshPhysicalMaterial({ color: 0x4fbf3a, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.08, emissive: 0x13460c, emissiveIntensity: 0.55 });
  const belly = new THREE.MeshPhysicalMaterial({ color: 0xe6f5c8, roughness: 0.3, clearcoat: 1 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x0c0d10, roughness: 0.2 });
  const stone = new THREE.MeshStandardMaterial({ color: 0x8c8a84, roughness: 0.8 });
  const add = (geo, mat, x, y, z, sx = 1, sy = 1, sz = 1) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.castShadow = true; g.add(m); return m; };
  const S = n => new THREE.SphereGeometry(n, 20, 14);
  add(new THREE.CylinderGeometry(0.15, 0.17, 0.05, 24), stone, 0, 0.025, 0);           // plinth
  add(S(0.12), glaze, 0, 0.14, -0.01, 1.05, 0.78, 1.15);                                // body, squat
  add(S(0.09), belly, 0, 0.12, 0.06, 0.95, 0.7, 0.8);
  add(S(0.085), glaze, 0, 0.23, 0.06, 1.15, 0.8, 0.95);                                 // head
  for (const sx of [-1, 1]) {
    add(S(0.038), glaze, sx * 0.055, 0.29, 0.08);                                       // eye bumps
    add(S(0.024), dark, sx * 0.064, 0.3, 0.105);                                        // eyes
    add(S(0.06), glaze, sx * 0.1, 0.09, -0.06, 0.7, 0.55, 1.4);                         // back legs, folded
    add(S(0.028), glaze, sx * 0.07, 0.06, 0.1, 1, 0.6, 1.4);                            // front feet
  }
  add(new THREE.TorusGeometry(0.035, 0.006, 6, 16, Math.PI), dark, 0, 0.215, 0.135, 1, 0.6, 1).rotation.z = Math.PI; // smile
  g.scale.setScalar(1.25);
  g.traverse(o => { if (o.isMesh) o.userData.noProbe = true; });
  return g;
}

export function buildSecret(level) {
  const s = SPOTS[level]; if (!s) return;
  PROG.secrets = PROG.secrets || [];
  SECRET.found = PROG.secrets.includes(level); SECRET.level = level;
  if (SECRET.found) return; // (already found on this save)
  const g = buildFrog(); g.position.set(s[0], 0, s[1]); g.rotation.y = s[2]; G.scene.add(g);
  Object.assign(SECRET, { obj: g, x: s[0], z: s[1], t: 0, hop: -1 });
}

// a bouncy little tune: up, up, hop down, up!
function jingle() {
  const A = SFX; if (!A.ctx || A.muted) return;
  const t0 = A.ctx.currentTime + 0.25, N = [[784, 0], [988, 0.12], [1175, 0.24], [988, 0.36], [1568, 0.5]];
  for (const [f, dt] of N) { A.tone(t0 + dt, { f, f2: f * 1.02, type: 'square', peak: 0.05, a: 0.004, dec: 0.13 }); A.tone(t0 + dt, { f: f / 2, f2: f / 2, type: 'triangle', peak: 0.1, a: 0.004, dec: 0.16 }); }
  A.tone(t0 + 0.62, { f: 1568, f2: 1568, type: 'sine', peak: 0.08, a: 0.01, dec: 0.7 });
}
// on screen: a cartoon frog pops up from the bottom, does a little bounce with the news, and hops away
const FROG_SVG = `<svg viewBox="0 0 120 100" width="150" height="125"><ellipse cx="60" cy="92" rx="40" ry="6" fill="rgba(0,0,0,.25)"/>
<ellipse cx="60" cy="64" rx="42" ry="28" fill="#4fbf3a" stroke="#1f5a16" stroke-width="3"/><ellipse cx="60" cy="72" rx="26" ry="16" fill="#e6f5c8"/>
<circle cx="38" cy="36" r="15" fill="#4fbf3a" stroke="#1f5a16" stroke-width="3"/><circle cx="82" cy="36" r="15" fill="#4fbf3a" stroke="#1f5a16" stroke-width="3"/>
<circle cx="38" cy="36" r="8" fill="#fff"/><circle cx="82" cy="36" r="8" fill="#fff"/><circle cx="40" cy="37" r="4.5" fill="#111"/><circle cx="80" cy="37" r="4.5" fill="#111"/>
<path d="M44 58 Q60 70 76 58" fill="none" stroke="#1f5a16" stroke-width="3" stroke-linecap="round"/><circle cx="34" cy="58" r="4" fill="#ff9fb3" opacity=".7"/><circle cx="86" cy="58" r="4" fill="#ff9fb3" opacity=".7"/>
<ellipse cx="26" cy="86" rx="12" ry="6" fill="#4fbf3a" stroke="#1f5a16" stroke-width="3"/><ellipse cx="94" cy="86" rx="12" ry="6" fill="#4fbf3a" stroke="#1f5a16" stroke-width="3"/></svg>`;
function frogPop() {
  let el = document.getElementById('frogpop');
  if (!el) { el = document.createElement('div'); el.id = 'frogpop'; document.body.appendChild(el); }
  el.innerHTML = `<div class="fp-frog">${FROG_SVG}</div><div class="fp-t">Tree Frog found!</div><div class="fp-s">Secret · +${SECRET_PTS} XP</div>`;
  el.classList.remove('go'); void el.offsetWidth; el.classList.add('go');
  clearTimeout(frogPop.t); frogPop.t = setTimeout(() => el.classList.remove('go'), 3200);
}
function croak() {
  const A = SFX; if (!A.ctx || A.muted) return;
  const t0 = A.ctx.currentTime + 0.01;
  for (let i = 0; i < 2; i++) { const t = t0 + i * 0.2; A.tone(t, { f: 420, f2: 170, type: 'sawtooth', peak: 0.16, a: 0.01, dec: 0.13 }); A.noiseHit(t, { f: 600, q: 3, peak: 0.12, dec: 0.12 }); }
}

export function updateSecret(dt) {
  const o = SECRET.obj; if (!o || !G.player) return;
  SECRET.t += dt;
  if (SECRET.hop >= 0) { // the hop out of sight
    SECRET.hop += dt; const k = SECRET.hop / 0.55;
    o.position.y = Math.sin(Math.min(1, k) * Math.PI) * 0.6; o.rotation.y += dt * 14; o.scale.setScalar(1.25 * Math.max(0, 1 - Math.max(0, k - 0.6) / 0.4));
    if (k >= 1) { G.scene.remove(o); SECRET.obj = null; }
    return;
  }
  const P = G.player, d = Math.hypot(P.pos.x - SECRET.x, P.pos.z - SECRET.z);
  const swing = (P.state === 'attack' || P.state === 'sweep') && d < 1.6;
  if (d < 0.75 || swing) take();
}
function take() {
  SECRET.hop = 0; SECRET.found = true; croak();
  if (!SFX.sample('frogJingle', 0.9, 1, 1)) jingle(); // (Yusuf's jingle if it's there, a little made-up one if not)
  frogPop();
  spark(SECRET.x, 0.4, SECRET.z, 26, 0xb6f08a, 4, 0.6, 0.08);
  floatText('KERO KERO!', new THREE.Vector3(SECRET.x, 1.4, SECRET.z), 'onoma', 1.2);
  floatText('+' + SECRET_PTS + ' XP', new THREE.Vector3(SECRET.x, 1.0, SECRET.z), 'cost', 1.4);
  PROG.secrets = PROG.secrets || []; if (!PROG.secrets.includes(SECRET.level)) PROG.secrets.push(SECRET.level);
  addXP(SECRET_PTS); saveProgress();
}
