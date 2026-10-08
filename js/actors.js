// Player (the custodian) and robbers: movement, free-flow mop combat, dodge, sweep, cleaning, enemy AI
import * as THREE from 'three';
import { G, clamp, lerp, smooth, rand, pick, angDiff, dampAngle, damp, resolveCircle, rayBox, sphereBox, pointInBox } from './state.js';
import { Rig, RIG } from './rig.js';
import { skinCharacter, KARIM_DIMS } from './skin.js';
import { MixamoBody, mixamoDims } from './mixamo.js';
import { prepareRobber, attachRobberBody, robberDims, outlineMat } from './robber.js';
import { solveIK } from './rig.js';
import { RobberAnim, robberAnimsReady, clipStride, placeRifle } from './robanim.js';
import { attachTools, setTool, toolHead, flattenHead, nearCart, TOOL_ORDER, TOOL_LABEL, pushBarrow, barrowGrips, barrowSlot, barrowFront, loadRifle, updateBarrowHops } from './tools.js';
import { L } from './level.js';
import { blobTex, ringTex } from './textures.js';
import { SFX } from './audio.js';
import { hitDestructible, pushChairs, knockChair, chairs, addChair, suckChair } from './destruct.js';
import { spark, flash, droplets, tracer, paperBurst, disturbPapers, collectAt, cleanAt, floatText, Trail, chunks, spawnPaper, bloodPool, bloodDrip , somethingToClean, vacuumAt, polishFloor } from './fx.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const PIV = RIG.PIVOT;
const ENEMY_SIZE = 0.75; // robbers are 25% smaller than the model's authored scale
const RUN_CLIP = 3.75, STRIDE = 1.08; // run cycle ~24% slower than the raw sync, strides stretched just enough that the feet don't skate // run cycle plays ~28% slower than before; strides warped longer so the planted foot stays put
const RUN = 1.2;      // run speed as a fraction of G.ps.speed (20% calmer than before)
const WALK = 0.525;     // walk speed as a fraction of G.ps.speed (the walk clip plays back in step with it)
let blobMat = null;
function blob(parent, s = 1) {
  if (!blobMat) blobMat = new THREE.MeshBasicMaterial({ map: blobTex(), transparent: true, depthWrite: false, opacity: 0.8 });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.95 * s, 0.95 * s), blobMat);
  m.rotation.x = -Math.PI / 2; m.position.y = 0.012; m.userData.noAO = true; m.userData.keep = true; m.userData.noReflect = true; m.renderOrder = 1;
  parent.add(m); return m;
}

// ---------- keyframe helper: keys [{t, c:[x,y,z], d:[x,y,z], tw, ln, pv}] ----------
function sampleKeys(keys, t, out) {
  let i = 0; while (i < keys.length - 2 && t > keys[i + 1].t) i++;
  const a = keys[i], b = keys[i + 1];
  const u = smooth(clamp((t - a.t) / Math.max(1e-4, b.t - a.t), 0, 1));
  out.c.set(lerp(a.c[0], b.c[0], u), lerp(a.c[1], b.c[1], u), lerp(a.c[2], b.c[2], u));
  out.d.set(lerp(a.d[0], b.d[0], u), lerp(a.d[1], b.d[1], u), lerp(a.d[2], b.d[2], u)).normalize();
  out.tw = lerp(a.tw || 0, b.tw || 0, u); out.ln = lerp(a.ln || 0, b.ln || 0, u); out.pv = lerp(a.pv ?? 0.9, b.pv ?? 0.9, u);
  out.st = lerp(a.st || 0, b.st || 0, u);
  return out;
}
const READY = { c: [-0.347, 0.851, 0.19], d: [-0.109, -0.943, 0.314], tw: 0, ln: 0.02, pv: 0.94 }; // mop upright at his right side in his right hand, head by his right foot // broom stance: top hand at chest, mop head on the floor
// mop strikes (custodian faces +z, his right is -x)
const MOVES = {
  swingR: { dur: 0.4, hit: 0.46, dmg: 1, kb: 3.2, name: 'swing', keys: [
    { t: 0, c: [-0.3, 1.25, -0.02], d: [-0.8, 0.15, -0.55], tw: -0.7, ln: 0.1 },
    { t: 0.3, c: [-0.22, 1.2, 0.25], d: [-0.6, 0.0, 0.8], tw: -0.35, ln: 0.15 },
    { t: 0.5, c: [0.12, 1.15, 0.42], d: [0.55, -0.08, 0.85], tw: 0.4, ln: 0.25, pv: 0.86 },
    { t: 0.72, c: [0.3, 1.18, 0.12], d: [0.95, 0.0, -0.1], tw: 0.7, ln: 0.2 },
    { t: 1, ...READY }] },
  swingL: { dur: 0.4, hit: 0.46, dmg: 1, kb: 3.2, name: 'swing', keys: [
    { t: 0, c: [0.28, 1.25, -0.02], d: [0.8, 0.15, -0.55], tw: 0.7, ln: 0.1 },
    { t: 0.3, c: [0.2, 1.2, 0.25], d: [0.6, 0.0, 0.8], tw: 0.35, ln: 0.15 },
    { t: 0.5, c: [-0.12, 1.15, 0.42], d: [-0.55, -0.08, 0.85], tw: -0.4, ln: 0.25, pv: 0.86 },
    { t: 0.72, c: [-0.3, 1.18, 0.12], d: [-0.95, 0.0, -0.1], tw: -0.7, ln: 0.2 },
    { t: 1, ...READY }] },
  jab: { dur: 0.34, hit: 0.42, dmg: 1, kb: 3.8, name: 'jab', keys: [
    { t: 0, c: [-0.08, 1.2, -0.05], d: [-0.05, 0.05, 1], tw: -0.25, ln: 0.0 },
    { t: 0.4, c: [-0.02, 1.2, 0.62], d: [0.0, -0.06, 1], tw: 0.1, ln: 0.3, pv: 0.84 },
    { t: 0.7, c: [-0.04, 1.18, 0.45], d: [-0.1, -0.2, 1], tw: 0.05, ln: 0.2 },
    { t: 1, ...READY }] },
  slam: { dur: 0.5, hit: 0.5, dmg: 1.5, kb: 4.5, heavy: true, name: 'slam', keys: [
    { t: 0, c: [-0.05, 1.55, -0.12], d: [-0.1, 0.85, -0.5], tw: -0.15, ln: -0.15, pv: 0.95 },
    { t: 0.35, c: [-0.02, 1.62, 0.05], d: [0.0, 0.9, 0.4], tw: 0, ln: -0.1, pv: 0.95 },
    { t: 0.52, c: [0.0, 0.95, 0.5], d: [0.0, -0.55, 0.85], tw: 0, ln: 0.45, pv: 0.78 },
    { t: 0.78, c: [0.0, 0.95, 0.48], d: [-0.1, -0.6, 0.8], tw: 0, ln: 0.4, pv: 0.8 },
    { t: 1, ...READY }] },
  upper: { dur: 0.42, hit: 0.48, dmg: 1, kb: 3.5, launch: true, name: 'uppercut', keys: [
    { t: 0, c: [-0.15, 0.85, 0.15], d: [-0.4, -0.75, 0.5], tw: -0.4, ln: 0.35, pv: 0.82 },
    { t: 0.48, c: [0.0, 1.45, 0.4], d: [0.1, 0.75, 0.65], tw: 0.25, ln: -0.05, pv: 0.95 },
    { t: 0.75, c: [0.05, 1.5, 0.25], d: [0.15, 0.95, 0.2], tw: 0.25, ln: -0.1 },
    { t: 1, ...READY }] },
  spin: { dur: 0.62, hit: 0.55, dmg: 3, kb: 7, heavy: true, finisher: true, spin: true, name: 'finisher', keys: [
    { t: 0, c: [-0.3, 1.2, 0.0], d: [-0.95, 0.05, -0.2], tw: -0.6, ln: 0.1, pv: 0.86 },
    { t: 0.55, c: [0.1, 1.15, 0.4], d: [0.4, -0.05, 0.9], tw: 0.5, ln: 0.25, pv: 0.82 },
    { t: 0.8, c: [0.3, 1.15, 0.1], d: [0.95, 0, -0.1], tw: 0.6, ln: 0.2 },
    { t: 1, ...READY }] },
};
// body motion for each mop strike: [clip, from, to] (arms/mop stay procedural)
const ATTACK_CLIPS = {
  swingR: ['SweepAttack', 0.02, 0.42], swingL: ['Combo_Attack', 0.05, 0.5], jab: ['Combo_Attack', 0.6, 1.0],
  upper: ['Combo_Attack', 1.62, 2.1], slam: ['Finisher', 0.3, 0.85], spin: ['SweepAttack', 0.0, 0.62],
};
const COMBO_SEQ = ['swingR', 'swingL', 'jab', 'swingR', 'upper', 'swingL', 'slam'];

// ================================= PLAYER =================================
// the Mixamo dodge roll is a loop that starts mid-dive: play it from the standing frame before the dive,
// through the roll, until he's back on his feet (seconds of clip), a little quicker than authored
const DODGE = { start: 0.9, span: 0.9, rate: 1.6 }; // straight into the dive
// tint an object's materials gold (its own copies, so other robbers / rifles keep theirs)
export function goldTint(obj, a, good = true) {
  const ud = obj.userData;
  if (!ud.goldMats) {
    if (a <= 0.01) return;
    ud.goldMats = [];
    obj.traverse(o => { if (!o.isMesh || !o.material || !o.material.emissive) return;
      const b = o.material, m = b.clone(); m.onBeforeCompile = b.onBeforeCompile; m.customProgramCacheKey = b.customProgramCacheKey; o.material = m; ud.goldMats.push(m); });
  }
  const k = Math.min(1, a) * 0.32; // a warm gold sheen (the texture still shows through)
  for (const m of ud.goldMats) { if (good) m.emissive.setRGB(1.0 * k, 0.6 * k, 0.08 * k); else m.emissive.setRGB(0.85 * k, 0.07 * k, 0.04 * k); m.emissiveIntensity = 1; }
}
const _m0 = new THREE.Vector3(), _g0 = new THREE.Vector3(), _g1 = new THREE.Vector3(), _s0 = new THREE.Vector3(), _o0 = new THREE.Vector3(), _p0 = new THREE.Vector3(), _f0 = new THREE.Vector3();
// the mop cleans where its head actually swings: a 0.5 m patch that follows the head from side to side
// (the swing is stretched a little so the band is about 2 m wide), stamped every 12 cm along its path
const MOP = { r: 0.55, swing: 2.0, back: 0.2, step: 0.12, clean: 0.35, polish: 0.3 };
const HURT_GRACE = 1.0; // seconds of protection after taking a hit (shown by Karim flickering)
let reticle = null;
function makeReticle() {
  const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d');
  x.strokeStyle = '#fff'; x.lineCap = 'round';
  x.lineWidth = 5; for (let k = 0; k < 4; k++) { x.beginPath(); x.arc(128, 128, 104, k * Math.PI / 2 + 0.22, (k + 1) * Math.PI / 2 - 0.22); x.stroke(); } // broken ring
  x.lineWidth = 7; for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2; x.beginPath(); x.moveTo(128 + Math.cos(a) * 88, 128 + Math.sin(a) * 88); x.lineTo(128 + Math.cos(a) * 120, 128 + Math.sin(a) * 120); x.stroke(); } // ticks
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: tex, color: 0xffe2a0, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  m.rotation.x = -Math.PI / 2; m.renderOrder = 2; m.visible = false;
  Object.assign(m.userData, { noAO: true, noReflect: true, noProbe: true });
  G.scene.add(m); return m;
}
// nothing solid (wall, glass, desk, planter, sofa...) between two points at waist height?
const _cpO = new THREE.Vector3(), _cpD = new THREE.Vector3();
function clearPath(a, b) {
  _cpO.set(a.x, 0.75, a.z); _cpD.set(b.x - a.x, 0, b.z - a.z); const L = _cpD.length(); if (L < 0.8) return true; _cpD.multiplyScalar(1 / L);
  for (const c of G.colliders) {
    if (!c.active || c.y1 < 0.45 || c.y0 > 1.0) continue;
    const t = rayBox(c, _cpO, _cpD, L); if (t > 0.05 && t < L - 0.4) return false;
  }
  return true;
}
// is a robber inside the camera view? (his chest, with a small margin so half-visible robbers at the edge don't count)
const _scr = new THREE.Vector3();
function onScreen(e) {
  if (!G.camera) return true;
  _scr.set(e.pos.x, 0.9 * (e.size || 1), e.pos.z).project(G.camera);
  return _scr.z < 1 && Math.abs(_scr.x) < 0.94 && Math.abs(_scr.y) < 0.92;
}

export class Player {
  constructor() {
    const kg = L.gltf.Karim;
    this.rig = new Rig('custodian', kg ? mixamoDims(kg) : L.models.MainChar ? KARIM_DIMS : {});
    G.scene.add(this.rig.root);
    if (kg) { // Mixamo-rigged Karim driven by animation clips
      let tex = null; L.models.MainChar?.traverse(o => { if (o.isMesh && o.material.map) tex = o.material.map; });
      this.body = new MixamoBody(this.rig, kg, tex, L.idleMop, L.sweepMop);
      if (L.dodgeClip) this.body.addClip(L.dodgeClip);
    } else if (L.models.MainChar) skinCharacter(this.rig, L.models.MainChar);
    this.kickN = 0;
    this.blob = blob(this.rig.root);
    this.pos = V(-16.6, 0, 9.0); this.vel = V(); this.yaw = Math.PI / 2; this.prevVel = V();
    this.hp = (G.ps?.hp) || 3; this.maxHp = this.hp; this.lastHurt = -99;
    this.state = 'move'; this.t = 0; this.phase = 0;
    this.seq = 0; this.queued = null; this.queueT = 0;
    this.trail = new Trail(14, 0xcfe2ff);
    this.headPrev = V(); this.headVel = V();
    this.pose = { c: V(), d: V(), tw: 0, ln: 0, pv: PIV, st: 0 };
    this.cleanPh = 0; this.squeakT = 0; this.wetness = 0;
    this.tools = attachTools(this.rig); this.tool = 'mop'; // mop / vacuum / polisher, swapped at the cart
    this.energy = 100; this.maxEnergy = 100; this.energyIdle = 0; this.running = false;
    this.invuln = false;
    this.r = 0.38;
    this.spinRate = 0;
  }

  // ---------- input-driven actions ----------
  moveInput() {
    if (G.leaving || G.autoWalk) { // leaving: walk into the elevator (or up the stairs) by himself
      if (!G.autoWalk) return V();
      const d = V(G.autoWalk.x - this.pos.x, 0, G.autoWalk.z - this.pos.z); return d.lengthSq() > 0.01 ? d.normalize() : V();
    }
    const inp = G.input; let f = 0, r = 0;
    if (inp.key('KeyW') || inp.key('ArrowUp')) f += 1; if (inp.key('KeyS') || inp.key('ArrowDown')) f -= 1;
    if (inp.key('KeyD') || inp.key('ArrowRight')) r += 1; if (inp.key('KeyA') || inp.key('ArrowLeft')) r -= 1;
    // camera-relative (camera looks along -x,-z)
    const v = V(-f + r, 0, -f - r);
    if (v.lengthSq() > 0) v.normalize();
    return v;
  }
  prefDir() {
    const m = this.moveInput();
    if (m.lengthSq() > 0) return m;
    if (G.input.mouseActive) { const d = _v1.copy(G.mouseGround).sub(this.pos).setY(0); if (d.lengthSq() > 0.25) return d.normalize().clone(); }
    return V(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }
  pickTarget(dir, range = 9) {
    let best = null, bs = 1e9;
    for (const e of G.enemies) {
      if (e.ko) continue;
      if (!onScreen(e)) continue; // only robbers you can actually see when you click
      if (!clearPath(this.pos, e.pos)) continue; // ...and can actually get to (no lunging through walls, glass or furniture)
      const to = _v2.copy(e.pos).sub(this.pos).setY(0); const d = to.length(); if (d > range) continue;
      to.normalize();
      const dot = to.dot(dir);
      if (dot < -0.2 && d > 2.2) continue;
      const s = d * (1 + (1 - dot) * 1.6) + (e.down ? 2.5 : 0) + (e.aggro ? 0 : 1.5);
      if (s < bs) { bs = s; best = e; }
    }
    return best;
  }
  canAct() { return this.state === 'move' || this.state === 'clean'; }
  cancelable() {
    if (this.state === 'attack') return this.phaseName === 'strike' && this.t > this.move.dur * this.move.hit + 0.02;
    if (this.state === 'sweep') return this.kicked && this.t > 0.32;
    if (this.state === 'hurt') return this.t > 0.18;
    return false;
  }

  tryAttack() {
    if (this.tool !== 'mop') return; // only the mop is a weapon
    if (!(this.canAct() || this.cancelable())) { this.queued = 'attack'; this.queueT = 0.35; return; }
    const target = this.pickTarget(this.prefDir(), G.ps.reach);
    let name = COMBO_SEQ[this.seq++ % COMBO_SEQ.length];
    if (target) {
      const remaining = G.enemies.filter(e => !e.ko && e.aggro).length;
      const willKO = target.down || target.hp - MOVES[name].dmg <= 0;
      if (willKO && remaining === 1 && G.enemies.filter(e => !e.ko).length === 1) name = 'spin';
    }
    this.startAttack(name, target);
  }
  startAttack(name, target) {
    this.state = 'attack'; this.move = MOVES[name]; this.target = target; this.t = 0; this.hitDone = false;
    this.phaseName = target && target.pos.distanceTo(this.pos) > 1.55 ? 'travel' : 'strike';
    this.travelT = 0;
    if (this.phaseName === 'strike') SFX.play('whoosh');
    this.envHit = new Set();
  }
  trySweep() {
    if (this.tool !== 'mop') return;
    if (!(this.canAct() || this.cancelable())) { this.queued = 'sweep'; this.queueT = 0.3; return; }
    this.state = 'sweep'; this.t = 0; this.kicked = false;
    // alternate a front kick and a spinning high kick
    this.kickDef = this.body ? (this.kickN++ % 2 === 0 ? { name: 'Kick', t1: 0.72, hit: 0.36 } : { name: 'HighKick', t1: 0.78, hit: 0.27 }) : { name: null, t1: 0.46, hit: 0.18 };
    this.kickTarget = this.pickTarget(this.prefDir(), Math.min(3.2, G.ps.reach));
    SFX.play('whoosh', 1.1);
  }
  tryDodge() {
    if (this.state === 'dodge' || this.state === 'dead' || this.state === 'special' || this.tool === 'barrow') return;
    if (this.state === 'attack' && this.phaseName === 'strike' && this.t < this.move.dur * this.move.hit - 0.02 && this.t > 0.05) { this.queued = 'dodge'; this.queueT = 0.25; return; }
    if (this.energy < 15) { if (!this.tiredT || G.time - this.tiredT > 1) { floatText('Out of breath', this.pos.clone().setY(2.2), 'cost', 0.8); this.tiredT = G.time; } return; }
    this.energy -= 15; this.energyIdle = 0;
    let dir = this.moveInput();
    if (dir.lengthSq() === 0) dir = V(Math.sin(this.yaw), 0, Math.cos(this.yaw)); // slide the way he's facing
    this.state = 'dodge'; this.t = 0; this.dodgeDir = dir; this.invuln = true; this.slid = new Set();
    // rolling away from a laser lock (or a burst already flying) means that burst can't hit him, even once he's back up
    for (const e of G.enemies) if (!e.ko && ((e.state === 'aim' && e.threatTime !== null && e.threatTime < 0.9) || e.state === 'fire')) e.burstDodged = true;
    // perfect dodge: an attack on us is about to land
    const threat = G.enemies.some(e => e.threatTime !== null && e.threatTime < 0.42 && e.threatTime >= 0);
    if (threat) {
      G.stats.perfect++; G.slowmo(0.35, 0.55); SFX.play('perfect');
      floatText('PERFECT DODGE', this.pos.clone().setY(2.2), 'perfect', 1.0);
      G.addCombo(0, true);
    } else SFX.play('dodge');
    this.yawTarget = Math.atan2(dir.x, dir.z);
  }
  trySpecial() {
    if (this.tool !== 'mop') return;
    if (G.specialCharges < 1 || !(this.canAct() || this.cancelable())) return;
    const target = this.pickTarget(this.prefDir(), Math.min(3.5, G.ps.reach)); // close range only
    if (!target) return;
    G.specialCharges--; G.stats.specials++;
    this.state = 'special'; this.t = 0; this.target = target; this.hitDone = false;
    this.invuln = true; // nobody can interrupt a Mop Takedown
    G.slowmo(0.9, 0.3); G.cinematic = 1.0; SFX.play('special');
    floatText('MOP TAKEDOWN', target.pos.clone().setY(2.4), 'special', 1.2);
  }

  hurt(dmg, dir, src) {
    if (this.invuln || this.state === 'dead') return false;
    // health is counted in hits (3 to start); a whole burst or swing only counts once
    if (G.simTime - this.lastHurt < HURT_GRACE) return false;
    this.hp -= 1; this.lastHurt = G.simTime;
    G.resetCombo(); G.shake = Math.max(G.shake, 0.5); G.dmgFlash = 1;
    SFX.play('hurt');
    if (this.state !== 'special') { this.state = 'hurt'; this.t = 0; this.hurtDir = dir.clone(); }
    if (this.hp <= 0 && G.noDeath) this.hp = 1; // (the tutorial: he can't lose)
    if (this.hp <= 0) { this.hp = 0; this.state = 'dead'; this.t = 0; this.deathClip = Math.random() < 0.5 ? 'Deathanim' : 'Deathanim2'; if (this.body) this.dropMop(); G.onPlayerDead(); }
    return true;
  }

  update(dt) {
    const inp = G.input;
    this.t += dt * (this.state === 'attack' && this.phaseName === 'strike' ? G.ps.atk : 1);
    if (this.queued) { this.queueT -= dt; if (this.queueT <= 0) this.queued = null; }
    if (this.queued && (this.canAct() || this.cancelable())) {
      const q = this.queued; this.queued = null;
      if (q === 'attack') this.tryAttack(); else if (q === 'sweep') this.trySweep(); else if (q === 'dodge') this.tryDodge();
    }
    // energy recovers after a short breather
    this.energyIdle = (this.energyIdle || 0) + dt;
    if (this.energyIdle > 0.7) this.energy = Math.min(this.maxEnergy, this.energy + 22 * dt);
    // (no regeneration: health is whole bars, one lost per hit)

    const want = V(); let speedCap = G.ps.speed; let faceDir = null;
    const pose = this.pose;
    let feet = null, legFK = null, bodyQ = null, footYaw = null;
    switch (this.state) {
      case 'move': case 'clean': {
        this.state = 'move';
        const mi = this.moveInput();
        // Shift = run (uses energy)
        const wantRun = (G.input.key('ShiftLeft') || G.input.key('ShiftRight')) && mi.lengthSq() > 0 && !G.leaving;
        if (wantRun && this.energy > (this.running ? 0 : 12)) this.running = true;
        else if (!wantRun || this.energy <= 0) this.running = false;
        if (this.running) { this.energy = Math.max(0, this.energy - 24 * dt); this.energyIdle = 0; }
        this.cleaning = (G.input.key('ControlLeft') || G.input.key('ControlRight') || G.input.key('KeyC')) && !this.running && !G.leaving && this.tool !== 'barrow'; // hold Ctrl (or C) to clean
        speedCap = G.ps.speed * (this.running ? RUN : this.cleaning ? 0.32 : WALK); // careful steps while he cleans (the strokes stay brisk)
        want.copy(mi).multiplyScalar(speedCap);
        if (mi.lengthSq() > 0) faceDir = mi;
        else if (G.leaving) faceDir = V(0, 0, 1); // turn round to face the lobby as the doors close
        else if (G.input.mouseActive && G.anyAggro()) { const d = _v1.copy(G.mouseGround).sub(this.pos).setY(0); if (d.lengthSq() > 1) faceDir = d.normalize().clone(); }
        const moving = mi.lengthSq() > 0 && this.vel.length() > 0.5;
        if (!this.cleaning || this.tool !== 'mop') this.wasMopping = false;
        if (this.cleaning) this.doClean(dt, pose);
        else {
          const k = 1 - Math.exp(-14 * dt);
          pose.c.lerp(_v1.fromArray(READY.c), k); pose.d.lerp(_v2.fromArray(READY.d), k).normalize();
          pose.tw = damp(pose.tw, 0, 10, dt); pose.ln = damp(pose.ln, READY.ln + (this.running ? 0.28 : Math.min(0.2, this.vel.length() * 0.04)), 10, dt); pose.pv = damp(pose.pv, READY.pv, 10, dt);
        }
        break;
      }
      case 'attack': this.doAttack(dt, want, pose); faceDir = this.target ? _v3.copy(this.target.pos).sub(this.pos).setY(0).normalize() : null; speedCap = 20; break;
      case 'sweep': this.doSweep(dt, want, pose); speedCap = 20; faceDir = this.kickTarget && !this.kickTarget.ko ? _v3.copy(this.kickTarget.pos).sub(this.pos).setY(0).normalize() : null; break;
      case 'dodge': {
        if (this.body && this.body.clips.Dodge) { // dodge roll (Yusuf's Mixamo clip): dive, roll over, back on his feet
          const dur = DODGE.span / DODGE.rate, u = Math.min(1, this.t / dur);
          this.rollU = u;
          const sp = 6.2 * G.ps.dodge * smooth(clamp(u / 0.04, 0, 1)) * (1 - smooth(clamp((u - 0.62) / 0.33, 0, 1)));
          want.copy(this.dodgeDir).multiplyScalar(sp); speedCap = 20;
          this.invuln = u < 0.8;
          pose.c.set(0.0, 1.15, 0.26); pose.d.set(1, 0.12, 0.05).normalize(); pose.tw = 0; pose.ln = 0; // mop held across his chest as he rolls
          faceDir = this.dodgeDir;
          disturbPapers(this.pos.x, this.pos.z, 1.1, 3.5);
          // rolling into a robber's legs takes him down
          for (const e of G.enemies) {
            if (e.ko || e.down || this.slid.has(e) || u < 0.1 || u > 0.7) continue;
            if (e.pos.distanceTo(this.pos) < 1.1) {
              this.slid.add(e); e.trip(this.dodgeDir.clone()); G.addCombo(1); G.stats.hits++;
              G.hitstop = Math.max(G.hitstop, 0.04); G.shake = Math.max(G.shake, 0.3); SFX.play('kick');
              floatText(pick(['ROLLED OVER!', 'TAKEN OUT!', 'BOWLED OVER!']), e.pos.clone().setY(1.7), 'onoma', 0.7);
            }
          }
          if (this.t >= dur) { this.state = 'move'; this.invuln = false; }
          break;
        }
        // (fallback without the clip) power slide along the floor
        const dur = 0.68, k = Math.min(1, this.t / dur);
        const sp = (8.2 * Math.pow(1 - k, 1.15) + 0.6) * G.ps.dodge; // ~25% shorter and a calmer top speed
        want.copy(this.dodgeDir).multiplyScalar(sp); speedCap = 20;
        this.invuln = this.t < 0.54;
        const L = smooth(clamp(this.t / 0.12, 0, 1)) * smooth(clamp((dur - this.t) / 0.2, 0, 1)); // drop down, then pop back up
        this.slideL = L;
        bodyQ = new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), -1.15 * L); // lean right back
        pose.pv = lerp(READY.pv, 0.42, L);
        pose.c.set(0.0, 1.22, 0.32); pose.d.set(1, 0.18, 0.08).normalize(); pose.tw = 0; pose.ln = 0;
        legFK = { t: [-0.2 * L, -0.08 * L], k: [0.1 * L, 0.32 * L], s: [0.1 * L, -0.1 * L] }; // both legs out in front, feet first
        faceDir = this.dodgeDir;
        disturbPapers(this.pos.x, this.pos.z, 1.4, 5);
        cleanAt(this.pos.x, this.pos.z, 0.7, Math.min(1, dt * 6));
        if (L > 0.5 && Math.random() < 0.5) spark(this.pos.x + this.dodgeDir.x * 0.6, 0.05, this.pos.z + this.dodgeDir.z * 0.6, 1, 0xffffff, 1.5, 0.35, 0.09);
        // slide tackle: trip any robber in the way
        for (const e of G.enemies) {
          if (e.ko || e.down || this.slid.has(e) || L < 0.4) continue;
          if (e.pos.distanceTo(this.pos) < 1.15) {
            this.slid.add(e); e.trip(this.dodgeDir.clone()); G.addCombo(1); G.stats.hits++;
            G.hitstop = Math.max(G.hitstop, 0.04); G.shake = Math.max(G.shake, 0.3); SFX.play('kick');
            floatText(pick(['SLIDE TACKLE!', 'TAKEN OUT!', 'WHOOSH!']), e.pos.clone().setY(1.7), 'onoma', 0.7);
          }
        }
        if (this.t >= dur) { this.state = 'move'; this.invuln = false; }
        break;
      }
      case 'hurt': {
        want.copy(this.hurtDir).multiplyScalar(Math.max(0, 3 - this.t * 12));
        pose.ln = -0.25; pose.tw = 0.2;
        if (this.t > 0.32) this.state = 'move';
        break;
      }
      case 'special': this.doSpecial(dt, want, pose); speedCap = 30; faceDir = this.target ? _v3.copy(this.target.pos).sub(this.pos).setY(0).normalize() : null; break;
      case 'dead': {
        const k = Math.min(1, this.t / 0.6);
        bodyQ = new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), -Math.PI / 2 * smooth(k));
        pose.pv = lerp(PIV, 0.2, smooth(k));
        legFK = { t: [0.1, -0.1], k: [0.2, 0.3] };
        break;
      }
    }
    // integrate
    if (want.length() > speedCap) want.setLength(speedCap);
    const acc = this.state === 'move' || this.state === 'clean' ? 16 : 30;
    this.prevVel.copy(this.vel);
    this.vel.x = damp(this.vel.x, want.x, acc, dt); this.vel.z = damp(this.vel.z, want.z, acc, dt);
    if (!Number.isFinite(this.vel.x) || !Number.isFinite(this.vel.z)) this.vel.set(0, 0, 0);
    this.pos.addScaledVector(this.vel, dt);
    // collisions
    resolveCircle(this.pos, this.r);
    for (const e of G.enemies) {
      if (e.ko || e.down) continue;
      const dx = this.pos.x - e.pos.x, dz = this.pos.z - e.pos.z, d = Math.hypot(dx, dz), rr = this.r + e.r;
      if (d < rr && d > 0.001) { const p = (rr - d); this.pos.x += dx / d * p * 0.6; this.pos.z += dz / d * p * 0.6; e.pos.x -= dx / d * p * 0.4; e.pos.z -= dz / d * p * 0.4; }
    }
    pushChairs(this.pos, this.r, this.vel, this.state === 'dodge' ? 2 : 1);
    const spd = this.vel.length();
    if (spd > 3.5) disturbPapers(this.pos.x, this.pos.z, 0.55, spd * 0.35);

    // facing
    if (faceDir && faceDir.lengthSq() > 0) this.yaw = dampAngle(this.yaw, Math.atan2(faceDir.x, faceDir.z), this.state === 'attack' ? 30 : this.state === 'dodge' ? 24 : 14, dt);

    // locomotion feet
    if (!feet && !legFK) {
      const lv = _v1.copy(this.vel).applyAxisAngle(V(0, 1, 0), -this.yaw);
      const s = Math.min(1, spd / 5);
      this.phase += dt * spd * 2.7;
      feet = [];
      const fight = this.state !== 'clean';
      const ldir = lv.lengthSq() > 0.01 ? lv.clone().normalize() : V(0, 0, 1);
      for (let i = 0; i < 2; i++) {
        const side = i === 0 ? 1 : -1, ph = this.phase + i * Math.PI;
        const stride = 0.4 * s, lift = 0.2 * s;
        const base = fight ? (i === 0 ? 0.16 : -0.14) : 0.02 * side;
        const sw = Math.sin(ph) * stride;
        feet.push(V(side * (fight ? 0.15 : 0.12) + ldir.x * sw, 0.07 + Math.max(0, Math.cos(ph)) * lift, base * (1 - s) + ldir.z * sw));
      }
      if (this.state === 'sweep') this.sweepFeet(feet);
      if (this.state === 'attack' && this.phaseName === 'strike') { const k = Math.sin(Math.PI * clamp(this.t / this.move.dur, 0, 1)); feet[0].z += 0.25 * k; feet[1].z -= 0.2 * k; }
      pose.pv -= Math.abs(Math.sin(this.phase)) * 0.045 * s - Math.abs(Math.cos(this.phase)) * 0.015 * s; // run bounce: low on contact, up mid-stride
      footYaw = fight ? [0.25, -0.35] : [0.1, -0.1];
    }

    // apply to rig
    const rig = this.rig;
    // (old stand-in body only: Karim's own trousers do the kicking now)
    if (rig.legMeshes && !rig.skinned && !this.body) { const show = this.state === 'sweep'; if (rig.legMeshes[0].visible !== show) rig.legMeshes.forEach(m => m.visible = show); }
    rig.root.position.copy(this.pos); rig.root.rotation.y = this.yaw;
    const accel = _v2.copy(this.vel).sub(this.prevVel).multiplyScalar(1 / Math.max(dt, 1e-3));
    const anim = this.body ? this.pickAnim(dt) : null;
    const barrow = this.tool === 'barrow' && G.barrow && this.state !== 'dead';
    rig.apply({
      gripLow: this.state === 'move' && !this.cleaning ? 1 : 0,
      oneHand: !(this.body && this.body.mopT) && this.state === 'move' && this.vel.length() < 0.5,
      clip: anim && anim.clip, clipW: anim ? anim.w : 0, clipLegW: anim ? anim.legW : 0, clipArmW: anim ? anim.armW : 0,
      pivotY: pose.pv, bodyQ, spine: [pose.ln, pose.tw * 0.5, 0], chest: [pose.ln * 0.5, pose.tw * 0.6, 0], head: [-pose.tw * 0.8, -pose.ln * 0.6],
      wC: pose.c, wD: pose.d, feet, legFK, footYaw, accel, spin: this.state === 'special' ? 10 : 0,
      armFK: barrow ? [[0.2, 0, 0.3, -0.4], [0.2, 0, -0.3, -0.4]] : undefined,
    }, dt);
    if (barrow) this.pushBarrow(dt);
    if (this.body) {
      this.body.write(this.state === 'dead' ? 0.2 : 1, this.authW || 0); this.body.placeAuthoredMop(this.rig.weapon, this.rig.root, this.authW || 0);
      // chin up a touch while he stands, walks and runs (the clips have him eyeing the floor)
      this.lookUpA = damp(this.lookUpA || 0, this.state === 'move' && !this.cleaning ? 0.15 : 0, 6, dt);
      this.body.lookUp(this.lookUpA);
    }
    if (this.droppedMop) this.updateDroppedMop(dt);
    this.updateReticle(dt);
    // after a hit he can't be hurt again for a moment: he flickers until it runs out
    if (this.body && this.body.mesh) {
      const since = G.simTime - this.lastHurt, safe = since < HURT_GRACE && this.state !== 'dead';
      this.body.mesh.visible = !safe || Math.floor(since * 14) % 3 !== 0;
    }
    // machines: heads flat on the floor, the polisher pad spinning, motor noise while they run
    const on = this.cleaning && this.state === 'move';
    if (this.tool === 'vacuum' || this.tool === 'polisher') {
      const t = this.tools[this.tool];
      if (on) { // the motor buzzes through the handle: a small, fast shake of the machine and his hands
        const a = this.tool === 'polisher' ? 1 : 0.6, w = this.rig.weapon, T = G.time;
        w.position.x += (Math.sin(T * 91) + Math.sin(T * 137)) * 0.003 * a; w.position.y += Math.sin(T * 113) * 0.0025 * a; w.position.z += Math.sin(T * 79) * 0.003 * a;
        w.rotateZ(Math.sin(T * 103) * 0.009 * a); w.rotateX(Math.sin(T * 89) * 0.008 * a);
        if (this.body) for (const n of ['LeftHand', 'RightHand', 'LeftForeArm', 'RightForeArm']) { const b = this.body.B[n]; if (b) b.rotateX(Math.sin(T * (97 + n.length * 7)) * 0.018 * a); }
        w.updateMatrixWorld(true);
      }
      flattenHead(t);
      const pad = t.userData.head.userData.pad; if (pad) pad.rotation.y += dt * (on ? 28 : 0);
    }
    // rifles on the floor and knocked-out robbers light up gold while he holds the vacuum
    // rifles and knocked-out robbers: gold if this tool deals with them, red if not
    const gl = G.cleanGlow || 0;
    if (gl > 0.01 || this.vacHL) {
      this.vacHL = gl > 0.01;
      const amt = p => gl * clamp((3.4 - Math.hypot(p.x - this.pos.x, p.z - this.pos.z)) / (3.4 * 0.65), 0, 1);
      for (const c of chairs) if (c.rifle && !c.sucked) goldTint(c.obj, amt(c.pos), this.tool === 'vacuum' || this.tool === 'barrow');
      for (const e of G.enemies) if (e.ko && !e.gone && e.skin) goldTint(e.skin, e.loaded ? 0 : amt(e.pos), this.tool === 'barrow');
    }
    SFX.hum('vacuum', on && this.tool === 'vacuum' ? 1 : 0, this.cleanLoad || 0);
    SFX.hum('polisher', on && this.tool === 'polisher' ? 1 : 0, this.cleanLoad || 0);
    // mop head kinematics + trail
    const head = rig.weaponPoint(0.5, _v1), mid = rig.weaponPoint(0.15, _v3);
    this.headVel.copy(head).sub(this.headPrev).multiplyScalar(1 / Math.max(dt, 1e-3)); this.headPrev.copy(head);
    rig.updateTassel(this.headVel, dt);
    const swinging = (this.state === 'attack' && this.phaseName === 'strike' && this.t > this.move.dur * 0.25 && this.t < this.move.dur * 0.8) || this.state === 'special' || false;
    this.trail.push(mid, head, swinging);
    this.wetness = Math.max(0, this.wetness - dt * 0.05);
  }

  // which Mixamo clip(s) play this frame, and how strongly they drive the body
  pickAnim(dt) {
    const spd = Math.hypot(this.vel.x, this.vel.z);
    const loco = { idle: 1, walk: 0, run: 0, walkTS: 1, runTS: 1 };
    if (spd > 0.5) {
      loco.idle = 0;
      if (this.running || spd > G.ps.speed * 0.9) { loco.run = 1; loco.runTS = clamp(spd / RUN_CLIP, 0.8, 2.4); loco.stride = STRIDE; }
      else { loco.walk = 1; loco.walkTS = clamp(spd / 1.53, 0.7, 2.3); }
    }
    // mopping (Ctrl): Yusuf's Blender sweep. Whole body when he stands still; torso + arms over the walk when he moves
    // (the vacuum and the polisher are always held down at the floor in that stance, ready to go)
    const machine = this.tool === 'vacuum' || this.tool === 'polisher';
    const mopping = (this.cleaning || machine) && this.state === 'move' && this.body.sweep;
    if (mopping) {
      loco.sweepArms = 1;
      if (this.cleaning && !machine) loco.sweepTS = 3.2 + Math.min(spd, 2.5) * 0.2; // brisk mop strokes: about 3x the authored pace
      else { loco.sweepTS = 0; loco.sweepHold = true; } // the vacuum and polisher are held steady (they buzz instead)
      if (spd > 0.5) loco.sweepUpper = 1; else { loco.idle = 0; loco.sweep = 1; }
    }
    let one = null, w = 1, legW = 1, armW = 0;
    switch (this.state) {
      case 'attack': {
        if (this.phaseName === 'travel') { loco.idle = loco.walk = 0; loco.run = 1; loco.runTS = clamp(G.ps.lunge / RUN_CLIP, 1, 2.2); loco.stride = STRIDE; break; }
        const seg = ATTACK_CLIPS[this.move.name === 'finisher' ? 'spin' : Object.keys(MOVES).find(k => MOVES[k] === this.move)];
        if (seg) one = { name: seg[0], time: seg[1] + clamp(this.t / this.move.dur, 0, 1) * (seg[2] - seg[1]), fade: 0.05 };
        break;
      }
      case 'sweep': one = { name: this.kickDef.name, time: this.t * Math.min(1.25, G.ps.atk), fade: 0.05 }; break;
      case 'hurt': one = { name: 'TakeDamage', time: 0.05 + this.t * 1.5, fade: 0.04 }; break;
      case 'special': one = { name: 'Finisher', time: clamp(this.t / 0.75, 0, 1) * 0.9, fade: 0.05 }; break;
      case 'dead': one = { name: this.deathClip || 'Deathanim', time: this.t, fade: 0.12 }; armW = 1; break;
      case 'dodge':
        if (this.body.clips.Dodge) one = { name: 'Dodge', time: (DODGE.start + (this.rollU || 0) * DODGE.span) % this.body.clips.Dodge.duration, fade: 0.035 };
        else w = legW = 1 - (this.slideL || 0);
        break;
    }
    const clip = this.body.update(dt, loco, one);
    // authored idle: arms (and the mop) come straight from Yusuf's Blender idle while standing, walking AND running
    // (legs from the walk / run cycle); not while mopping, fighting or sliding
    this.authBlend = damp(this.authBlend ?? 1, (this.state === 'move' && this.tool !== 'barrow' && (!this.cleaning || this.body.sweep)) ? 1 : 0, 12, dt);
    this.authW = (this.body.mopT || this.body.sweep) ? this.authBlend * (this.body.one ? 1 - this.body.oneW : 1) : 0;
    armW = Math.max(armW, this.authW);
    return { clip, w, legW, armW };
  }
  dropMop() {
    const wpn = this.rig.weapon; if (wpn.parent !== this.rig.root) return;
    const wp = wpn.getWorldPosition(V()), wq = wpn.getWorldQuaternion(new THREE.Quaternion());
    G.scene.attach(wpn); wpn.position.copy(wp); wpn.quaternion.copy(wq);
    this.droppedMop = { v: V(rand(-1, 1), 2, rand(-1, 1)), spin: rand(-8, 8), done: false };
  }
  updateDroppedMop(dt) {
    const d = this.droppedMop, w = this.rig.weapon; if (d.done) return;
    d.v.y -= 12 * dt; w.position.addScaledVector(d.v, dt); w.rotation.x += d.spin * dt;
    if (w.position.y < 0.05) { w.position.y = 0.05; d.done = true; w.rotation.set(Math.PI / 2, w.rotation.y, 0, 'YXZ'); SFX.play('thud'); }
  }

  // the wheelbarrow rolls ahead of him, his hands on its grips; knocked-out robbers he runs into get piled in
  pushBarrow(dt) {
    const rig = this.rig, spd = Math.hypot(this.vel.x, this.vel.z);
    const fwd = _f0.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    // 1) roughly where his hands hang, a little in front of him
    pushBarrow(_m0.copy(this.pos).addScaledVector(fwd, 0.3).setY(0.86 + Math.sin(G.time * 9) * 0.01 * Math.min(1, spd)), this.yaw, spd, dt);
    // 2) reach for the grips
    barrowGrips(_g0, _g1); rig.root.updateMatrixWorld(true);
    for (let i = 0; i < 2; i++) {
      const T = i === 0 ? _g0 : _g1, side = i === 0 ? 1 : -1;
      rig.sh[i].getWorldPosition(_s0);
      _o0.copy(T).sub(_s0); const dl = _o0.length(); if (dl > 0.1) T.addScaledVector(_o0, -0.075 / dl); // palm, not wrist, on the grip
      _p0.set(side * 0.55, -0.6, -0.3).applyQuaternion(rig.root.quaternion).add(_s0);
      solveIK(rig.sh[i], rig.el[i], rig.D.UA, rig.D.FA, T, _p0, rig.armRestQ[i]);
      rig.hand[i].quaternion.identity();
    }
    rig.root.updateMatrixWorld(true);
    // 3) then bring the grips to where his palms actually ended up, so his hands are locked on the handles
    let mx = 0, my = 0, mz = 0;
    for (let i = 0; i < 2; i++) {
      const h = rig.hand[i].getWorldPosition(_s0), e = rig.el[i].getWorldPosition(_o0);
      const d = h.clone().sub(e).normalize(); h.addScaledVector(d, 0.075);
      mx += h.x / 2; my += h.y / 2; mz += h.z / 2;
    }
    pushBarrow(_m0.set(mx, my, mz), this.yaw, spd, 0);
    // scoop: robbers lying in front of the wheel
    if (spd > 0.3) {
      const front = barrowFront(_f0);
      for (const e of G.enemies) {
        if (!e.ko || e.gone || e.loaded || e.sucked || e.state === 'flying' || (e.state === 'dying' && e.t < 1.6)) continue;
        const c = e.rig.chest.getWorldPosition(_s0);
        if (Math.hypot(c.x - front.x, c.z - front.z) < 0.95 || Math.hypot(e.pos.x - front.x, e.pos.z - front.z) < 0.85) {
          e.loadInto(G.barrow); SFX.play('thud'); G.shake = Math.max(G.shake, 0.15);
          floatText(pick(['HUP!', 'IN YOU GO', 'ONE MORE']), e.pos.clone().setY(1.2), 'onoma', 0.7);
        }
      }
      // ...and their rifles
      for (let i = chairs.length - 1; i >= 0; i--) {
        const c = chairs[i]; if (!c.rifle || c.sucked) continue;
        if (Math.hypot(c.pos.x - front.x, c.pos.z - front.z) < 0.9) {
          chairs.splice(i, 1); for (const sh of c.shadows) sh.visible = false;
          goldTint(c.obj, 0); loadRifle(c.obj); SFX.play('kick', 0.6);
        }
      }
    }
  }
  // a faint reticle on the floor under the robber he's going for
  updateReticle(dt) {
    if (!reticle) reticle = makeReticle();
    const st = this.state;
    const tg = st === 'attack' ? this.target : st === 'sweep' ? this.kickTarget : st === 'special' ? this.target : null;
    if (tg && !tg.ko) { this.retT = tg; this.retHold = 0.5; }
    else this.retHold = (this.retHold || 0) - dt;
    const on = this.retT && !this.retT.ko && this.retHold > 0;
    this.retA = clamp((this.retA || 0) + (on ? dt * 9 : -dt * 5), 0, 1);
    reticle.visible = this.retA > 0.01 && !!this.retT;
    // gold outline on the robber he's going for
    for (const e of G.enemies) if (e.outline) e.outline.visible = reticle.visible && e === this.retT && !e.ko;
    const om = outlineMat(); om.opacity = 0.95 * this.retA; om.userData.thick.value = 0.028 + Math.sin(G.time * 9) * 0.005;
    if (!reticle.visible) return;
    const e = this.retT, s = (e.heavy ? 1.15 : 0.95) * (1 + (1 - this.retA) * 0.5);
    reticle.position.set(e.pos.x, 0.025, e.pos.z); reticle.scale.setScalar(s);
    reticle.rotation.z += dt * 1.6; reticle.material.opacity = 0.42 * this.retA;
  }
  // swap tools at the cart (1 / 2 / 3, or E to cycle)
  pickTool(name) {
    if (!nearCart(this.pos) || this.state === 'dead') return false;
    if (name === 'next') name = TOOL_ORDER[(TOOL_ORDER.indexOf(this.tool) + 1) % TOOL_ORDER.length];
    if (!TOOL_ORDER.includes(name) || name === this.tool) return false;
    this.tool = name; setTool(this.tools, name);
    SFX.play('collect'); floatText(TOOL_LABEL[name].toUpperCase(), this.pos.clone().setY(2.2), 'onoma', 0.7);
    return true;
  }
  doClean(dt, pose) {
    const spd = this.vel.length();
    this.cleanPh += dt * (3.2 + spd * 0.7);
    const s = Math.sin(this.cleanPh);
    const H = _v1.set(s * 0.55, 0.06, 0.9 + Math.cos(this.cleanPh * 2) * 0.06);
    const Gp = _v2.set(-0.1 + s * 0.08, 1.12, 0.1);
    const d = _v3.copy(H).sub(Gp).normalize();
    const k = 1 - Math.exp(-16 * dt);
    pose.d.lerp(d, k).normalize();
    pose.c.lerp(H.clone().addScaledVector(pose.d, -this.rig.weapon.userData.len / 2), k);
    pose.tw = damp(pose.tw, s * 0.35, 10, dt); pose.ln = damp(pose.ln, 0.2, 10, dt); pose.pv = damp(pose.pv, 0.92, 10, dt);
    // clean where the working end is
    const tool = this.tool, head = toolHead(this.tools, tool, V());
    if (tool === 'vacuum') {
      if (vacuumAt(head.x, head.z, 2.2, dt)) SFX.play('collect');
      // ...and dropped rifles (knocked-out robbers go in the wheelbarrow)
      for (const c of chairs) if (c.rifle && !c.sucked && Math.hypot(c.pos.x - head.x, c.pos.z - head.z) < 2.4) { suckChair(c, head.clone().setY(0.1)); SFX.play('whoosh', 1.2); }
      this.cleanLoad = damp(this.cleanLoad || 0, somethingToClean(head.x, head.z, 1.8, 'vacuum') ? 1 : 0, 6, dt);
    } else if (tool === 'polisher') {
      polishFloor(head.x, head.z, 1.0, Math.min(1, dt * 2.4));
      const busy = somethingToClean(head.x, head.z, 1.0, 'polisher');
      this.cleanLoad = damp(this.cleanLoad || 0, busy ? 1 : 0, 6, dt);
      if (busy && Math.random() < dt * 10) spark(head.x + rand(-0.3, 0.3), 0.03, head.z + rand(-0.3, 0.3), 1, 0xffffff, 0.8, 0.4, 0.06);
    } else {
      // the mop cleans (and buffs the dull floor back to a shine) along the path of its swinging head
      const f = _f0.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)), rx = f.z, rz = -f.x;
      const hx = head.x - this.pos.x, hz = head.z - this.pos.z;
      const side = (hx * rx + hz * rz) * MOP.swing, ahead = Math.max(0.15, Math.min(0.75, hx * f.x + hz * f.z - MOP.back));
      const cx = this.pos.x + rx * side + f.x * ahead, cz = this.pos.z + rz * side + f.z * ahead;
      const last = this.mopLast || (this.mopLast = new THREE.Vector2(cx, cz));
      if (!this.wasMopping) last.set(cx, cz);
      const dx = cx - last.x, dz = cz - last.y, seg = Math.hypot(dx, dz);
      this.mopIdle = (this.mopIdle || 0) + dt;
      if (seg > 1.5) last.set(cx, cz); // (teleport / pose snap: start over)
      else if (seg >= MOP.step || this.mopIdle > 0.1) {
        const n = Math.max(1, Math.min(8, Math.floor(seg / MOP.step)));
        for (let i = 1; i <= n; i++) { const t = seg >= MOP.step ? i * MOP.step / seg : 1, x = last.x + dx * t, z = last.y + dz * t; cleanAt(x, z, MOP.r, MOP.clean); polishFloor(x, z, MOP.r, MOP.polish); }
        if (seg >= MOP.step) last.set(last.x + dx * n * MOP.step / seg, last.y + dz * n * MOP.step / seg); else last.set(cx, cz);
        this.mopIdle = 0;
      }
      this.wasMopping = true; this.mopCleanT = G.time;
      this.squeakT -= dt;
      if (this.squeakT <= 0) {
        // only squeak when the mop is actually working on something (dirt, blood)
        if (somethingToClean(cx, cz, 1.2)) { this.squeakT = rand(0.25, 0.6); SFX.play('squeak'); if (Math.random() < 0.5) spark(head.x, 0.1, head.z, 2, 0xffffff, 1.2, 0.5, 0.08); }
        else this.squeakT = 0.12;
      }
    }
  }

  doAttack(dt, want, pose) {
    const m = this.move, tg = this.target;
    if (this.phaseName === 'travel') {
      this.travelT += dt;
      sampleKeys(m.keys, 0, pose);
      if (!tg || tg.ko) { this.phaseName = 'strike'; this.t = 0; return; }
      const to = _v1.copy(tg.pos).sub(this.pos).setY(0); const d = to.length();
      want.copy(to.normalize()).multiplyScalar(G.ps.lunge);
      pose.ln = 0.35;
      if (d < 1.5 || this.travelT > G.ps.reach / G.ps.lunge + 0.15) { this.phaseName = 'strike'; this.t = 0; SFX.play('whoosh'); }
      return;
    }
    const T = this.t / m.dur;
    sampleKeys(m.keys, Math.min(1, T), pose);
    if (tg && !tg.ko) {
      const to = _v1.copy(tg.pos).sub(this.pos).setY(0); const d = to.length();
      if (T < m.hit && d > 1.25) want.copy(to.normalize()).multiplyScalar(Math.min(8, (d - 1.2) * 12));
    }
    // environment collateral during the active part of the swing
    if (T > m.hit - 0.18 && T < m.hit + 0.08) this.mopEnvHits();
    if (!this.hitDone && T >= m.hit) {
      this.hitDone = true;
      const head = this.rig.weaponPoint(0.45, V());
      let landed = false;
      if (tg && !tg.ko && tg.pos.distanceTo(this.pos) < 2.3) { this.hitEnemy(tg, m); landed = true; }
      for (const e of G.enemies) if (e !== tg && !e.ko && e.pos.distanceTo(head.clone().setY(0)) < (m.spin ? 2.2 : 0.9)) { this.hitEnemy(e, m, true); landed = true; }
      if (!landed) SFX.play('whoosh', 0.6);
    }
    if (this.t >= m.dur) { this.state = 'move'; }
  }

  mopEnvHits() {
    const head = this.rig.weaponPoint(0.45, V());
    const dir = this.headVel.clone().setY(0); const sp = dir.length(); if (sp < 2) return; dir.normalize();
    for (const d of G.destructibles) {
      if (d.broken || !d.box || this.envHit.has(d)) continue;
      if (sphereBox(d.box, head, 0.22)) { this.envHit.add(d); hitDestructible(d, 'mop', head.clone(), dir); }
    }
    for (const s of G.surfaces) {
      if (!s.desk || this.envHit.has(s)) continue;
      if (head.y < s.y + 0.25 && pointInBox(s, head.x, head.z, 0.05)) { this.envHit.add(s); paperBurst(head.x, s.y + 0.1, head.z, 6, dir.x * 0.5, dir.z * 0.5, 2.4); SFX.play('thud'); }
    }
    for (const c of chairs) if (!this.envHit.has(c) && c.pos.distanceTo(head.clone().setY(0)) < 0.55) { this.envHit.add(c); knockChair(c, dir, 4); }
  }

  hitEnemy(e, m, splash = false) {
    const dir = _v2.copy(e.pos).sub(this.pos).setY(0).normalize().clone();
    const groundTakedown = e.down && !e.ko;
    let ko = false;
    if (groundTakedown) {
      // a robber on the floor takes a few hits to put away (and stays pinned while you work)
      e.hp -= Math.max(1, m.dmg) * (0.8 + 0.4 * G.ps.power) * (splash ? 0.6 : 1);
      if (e.hp <= 0.001) { e.knockout(dir, 1.5, true); ko = true; G.stats.ground++; floatText('GROUND TAKEDOWN', e.pos.clone().setY(1.2), 'special', 1); }
      else { e.t = Math.min(e.t, 0.9); e.vel.copy(dir).multiplyScalar(0.6); }
    }
    else {
      const pw = G.ps.power, kb = m.kb * (0.8 + 0.2 * pw);
      e.hp -= m.dmg * (splash ? 0.6 : 1) * pw;
      if (e.hp <= 0.001) { e.knockout(dir, kb * (m.finisher ? 1.6 : 1.1), false, m.launch); ko = true; }
      else e.stagger(dir, kb);
    }
    G.addCombo(1);
    G.stats.hits++;
    const heavy = m.heavy || ko;
    G.hitstop = Math.max(G.hitstop, heavy ? 0.085 : 0.05);
    G.shake = Math.max(G.shake, heavy ? 0.55 : 0.32);
    const p = e.pos.clone().setY(1.3);
    droplets(p.x, p.y, p.z, 10, dir.x, dir.z);
    spark(p.x, p.y, p.z, 6, 0xffffff, 4, 0.18, 0.1);
    flash(p.x, p.y, p.z, heavy ? 1.6 : 1.0, 0xfff0d0, 0.06);
    SFX.play(heavy ? 'heavy' : 'hit');
    // (no blood from Karim: he knocks robbers out, he doesn't kill)
    if (Math.random() < (heavy ? 0.6 : 0.18)) floatText(pick(heavy ? ['WHAM!', 'SPLAT!', 'THWACK!', 'KRAK!'] : ['SMACK!', 'SLAP!', 'WHAP!', 'THUD!']), p.clone().setY(2.1), 'onoma', 0.7);
    if (m.finisher || (ko && G.enemies.filter(x => !x.ko).length === 0)) { G.slowmo(0.9, 0.18); G.cinematic = 0.9; }
  }

  // Right-click: a straight front kick. Short step in, foot to the chest, robber goes flat on his back.
  doSweep(dt, want, pose) {
    const kd = this.kickDef, dur = kd.t1 / Math.min(1.25, G.ps.atk), k = this.t / dur, HIT = kd.hit / kd.t1;
    const tg = this.kickTarget;
    if (tg && !tg.ko && k < HIT) {
      const to = _v1.copy(tg.pos).sub(this.pos).setY(0); const d = to.length();
      if (d > 1.15) want.copy(to.normalize()).multiplyScalar(Math.min(G.ps.lunge * 0.8, (d - 1.1) * 10));
    }
    // lean back into the kick, mop swung up and back out of the way
    const ext = this.kickExt(k);
    pose.c.set(0.22, 1.28, -0.02); pose.d.set(0.45, 0.85, -0.3).normalize();
    pose.tw = -0.25 * ext; pose.ln = -0.32 * ext; pose.pv = 0.93 - 0.05 * ext;
    if (!this.kicked && k >= HIT) {
      this.kicked = true;
      const fwd = V(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      const foot = this.pos.clone().addScaledVector(fwd, 0.9);
      let landed = false;
      for (const e of G.enemies) {
        if (e.ko || e.down) continue;
        const to = e.pos.clone().sub(this.pos).setY(0), dist = to.length();
        if (dist > 1.9 || to.normalize().dot(fwd) < 0.45) continue;
        const dir = e.pos.clone().sub(this.pos).setY(0).normalize();
        e.hp -= 0.5 * G.ps.power;
        if (e.hp <= 0.001) e.knockout(dir, 6 * (0.8 + 0.2 * G.ps.power));
        else { e.trip(dir); e.vel.copy(dir).multiplyScalar(5.5 * (0.8 + 0.2 * G.ps.power)); }
        G.addCombo(1); G.stats.hits++; landed = true;
        G.hitstop = Math.max(G.hitstop, 0.075); G.shake = Math.max(G.shake, 0.5);
        const p = e.pos.clone().setY(1.1); spark(p.x, p.y, p.z, 10, 0xffffff, 4, 0.2, 0.1); flash(p.x, p.y, p.z, 1.3, 0xfff0d0, 0.06);
        if (Math.random() < 0.5) floatText(pick(['BOOT!', 'KICKED!', 'WHUMP!', 'THOOM!']), p.clone().setY(2.0), 'onoma', 0.7);
      }
      if (landed) SFX.play('heavy'); // (no thump on a miss: just the whoosh)
      for (const c of chairs) if (c.pos.distanceTo(foot) < 0.8) knockChair(c, fwd, 6);
      for (const d of G.destructibles) if (!d.broken && d.box && d.kind !== 'glass' && sphereBox(d.box, foot.clone().setY(0.9), 0.3)) hitDestructible(d, 'body', foot.clone().setY(0.9), fwd);
      disturbPapers(foot.x, foot.z, 1.2, 3);
    }
    if (this.t >= dur) { this.state = 'move'; }
  }
  kickExt(k) { return k < 0.25 ? 0.35 * smooth(k / 0.25) : k < 0.4 ? 0.35 + 0.65 * smooth((k - 0.25) / 0.15) : k < 0.62 ? 1 : 1 - smooth((k - 0.62) / 0.38); }
  sweepFeet(feet) {
    const dur = this.kickDef.t1 / Math.min(1.25, G.ps.atk), k = this.t / dur, ext = this.kickExt(k);
    const chamber = k < 0.4 ? smooth(k / 0.4) : Math.max(0, 1 - (k - 0.4) / 0.5);
    feet[0].set(0.13, 0.07, -0.12); // planted support foot
    // right foot: knee chambers up, then drives straight out at hip height
    feet[1].set(-0.11, 0.07 + chamber * 0.45 + ext * 0.35, 0.05 + ext * 0.78);
  }

  doSpecial(dt, want, pose) {
    const tg = this.target;
    const k = this.t;
    if (tg && !this.hitDone) {
      const to = _v1.copy(tg.pos).sub(this.pos).setY(0); const d = to.length();
      if (d > 1.3) want.copy(to.normalize()).multiplyScalar(Math.min(9, d * 8));
    }
    const T = Math.min(1, k / 0.55);
    sampleKeys(MOVES.slam.keys, T, pose);
    this.spinAng = 0;
    if (!this.hitDone && T >= 0.5) {
      this.hitDone = true;
      if (tg && !tg.ko) {
        const dir = _v2.copy(tg.pos).sub(this.pos).setY(0).normalize().clone();
        tg.knockout(dir, 6, false, true);
        G.addCombo(1); G.stats.hits++;
      }
      for (const e of G.enemies) if (!e.ko && e !== tg && e.pos.distanceTo(this.pos) < 3.0) { e.trip(e.pos.clone().sub(this.pos).setY(0).normalize()); G.addCombo(1); }
      G.hitstop = 0.12; G.shake = 1.0; SFX.play('heavy');
      const p = this.pos.clone(); droplets(p.x, 0.3, p.z, 30); spark(p.x, 0.3, p.z, 30, 0xffffff, 6, 0.3, 0.1);
    }
    if (k > 0.75) { this.state = 'move'; G.cinematic = 0; this.invuln = false; }
  }
}

// ================================= ENEMIES =================================
let laserMat = null, dotMat = null, ringMat = null;
export class Enemy {
  constructor(x, z, yaw, group, opts = {}) {
    this.heavy = !!opts.heavy;
    if (L.gltf.RobberRig) prepareRobber(L.gltf.RobberRig, Rig);
    this.rig = new Rig(this.heavy ? 'heavy' : 'robber', robberDims() || {});
    this.size = ENEMY_SIZE * (this.heavy ? 1.1 : 1);
    this.rig.root.scale.setScalar(this.size);
    G.scene.add(this.rig.root);
    attachRobberBody(this);
    if (this.skin && robberAnimsReady()) this.anim = new RobberAnim(this.rig); // Yusuf's Mixamo rifle clips (run, strafe, shoot, die)
    this.blob = blob(this.rig.root, this.heavy ? 1.2 : 1);
    this.pos = V(x, 0, z); this.vel = V(); this.yaw = yaw; this.prevVel = V();
    this.hp = this.heavy ? 6 : 3; this.group = group; this.idleMode = opts.idle || 'guard';
    this.state = 'idle'; this.t = rand(0, 2); this.phase = rand(0, 6);
    this.aggro = false; this.down = false; this.ko = false; this.r = this.heavy ? 0.38 : 0.33;
    this.cool = rand(0.5, 2.5); this.strafeSign = Math.random() < 0.5 ? -1 : 1; this.strafeT = rand(1, 3);
    this.threatTime = null;
    this.home = V(x, 0, z);
    this.pose = { c: V(-0.12, 1.0, 0.25), d: V(0.25, -0.55, 0.8).normalize(), tw: 0, ln: 0, pv: PIV };
    this.lootT = rand(1, 4);
    if (!laserMat) {
      laserMat = new THREE.MeshBasicMaterial({ color: 0xff2010, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
      dotMat = new THREE.MeshBasicMaterial({ color: 0xff3020, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, map: null });
      ringMat = new THREE.MeshBasicMaterial({ map: ringTex(), color: 0xffd040, transparent: true, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending });
    }
    const lg = new THREE.CylinderGeometry(0.0035, 0.0035, 1, 4, 1, true); lg.translate(0, 0.5, 0); lg.rotateX(Math.PI / 2);
    this.laser = new THREE.Mesh(lg, laserMat.clone()); this.laser.visible = false; this.laser.userData.noAO = true; this.laser.userData.noReflect = true; G.scene.add(this.laser);
    this.dot = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), dotMat); this.dot.visible = false; this.dot.userData.noAO = true; G.scene.add(this.dot);
    this.ring = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6), ringMat); this.ring.rotation.x = -Math.PI / 2; this.ring.position.y = 0.03; this.ring.visible = false; this.ring.userData.noAO = true; this.ring.userData.noReflect = true; G.scene.add(this.ring);
    this.aimDir = V(); this.bodyQ = new THREE.Quaternion(); this.lieQ = new THREE.Quaternion();
  }

  alert(delay = 0) {
    if (this.aggro || this.ko) return;
    this.aggro = true; this.alertT = delay + rand(0.2, 0.6);
    if (this.state === 'idle') { this.state = 'alert'; this.t = 0; }
    G.onAlert && G.onAlert(this);
  }

  // tipped onto the wheelbarrow's pile: a quick hop, then he rides along lying across the tray
  loadInto(barrow) {
    if (this.loaded) return;
    const root = this.rig.root; root.updateMatrixWorld(true);
    // body axis and centre in his own root space
    const h = root.worldToLocal(this.rig.head.getWorldPosition(new THREE.Vector3())), b = root.worldToLocal(this.rig.body.getWorldPosition(new THREE.Vector3()));
    const ax = h.clone().sub(b).setY(0); if (ax.lengthSq() < 1e-4) ax.set(0, 0, 1); ax.normalize();
    const c = h.clone().add(b).multiplyScalar(0.5);
    const n = barrow.load.length, slot = barrowSlot('body'); barrow.load.push(this);
    const yawRel = Math.PI / 2 - Math.atan2(ax.x, ax.z) + (n % 2 ? Math.PI : 0); // lying across the tray, alternating head ends
    const qRel = new THREE.Quaternion().setFromAxisAngle(_UP, yawRel);
    const s = root.scale.x * 0.92;
    const pRel = slot.sub(c.clone().multiplyScalar(s).applyQuaternion(qRel));
    this.loaded = { t: 0, barrow, qRel, pRel, s, p0: root.position.clone(), q0: root.quaternion.clone(), s0: root.scale.x };
    this.state = 'loaded'; this.releaseToken();
    this.blob.visible = false; this.ring.visible = false;
  }
  updateLoaded(dt) {
    const L0 = this.loaded, root = this.rig.root, g = L0.barrow.group;
    if (L0.done) return;
    L0.t += dt; const k = Math.min(1, L0.t / 0.35), e = smooth(k);
    g.updateMatrixWorld(true);
    const pT = L0.pRel.clone().applyMatrix4(g.matrixWorld), qT = g.getWorldQuaternion(new THREE.Quaternion()).multiply(L0.qRel);
    root.position.lerpVectors(L0.p0, pT, e); root.position.y += Math.sin(Math.PI * k) * 0.45;
    root.quaternion.slerpQuaternions(L0.q0, qT, e); root.scale.setScalar(L0.s0 + (L0.s - L0.s0) * e);
    if (k >= 1) { // ride along: parent him to the barrow
      g.attach(root); L0.done = true;
    }
  }

  // up the vacuum: shrink into the nozzle and vanish
  suck(target) {
    if (this.sucked) return;
    this.sucked = { t: 0, from: this.pos.clone(), target: target.clone().setY(0), s0: this.rig.root.scale.x };
    this.state = 'sucked'; this.releaseToken();
    SFX.play('whoosh', 1.4);
  }
  updateSucked(dt) {
    const sk = this.sucked; if (this.gone) return;
    sk.t += dt; const k = Math.min(1, sk.t / 0.5), e = k * k;
    const root = this.rig.root;
    root.position.lerpVectors(sk.from, sk.target, e); root.position.y = Math.sin(Math.PI * k) * 0.3;
    root.scale.setScalar(sk.s0 * Math.max(0.02, 1 - e)); root.rotation.y += dt * 9;
    this.blob.visible = false; this.ring.visible = false; this.laser.visible = false; this.dot.visible = false;
    if (k >= 1) { this.gone = true; root.visible = false; if (this.skin) this.skin.visible = false; SFX.play('collect'); }
  }

  releaseToken() { G.attackers.delete(this); this.threatTime = null; this.laser.visible = false; this.dot.visible = false; }

  stagger(dir, kb) {
    if (this.ko) return;
    this.releaseToken();
    this.state = 'stagger'; this.t = 0; this.vel.copy(dir).multiplyScalar(kb); this.staggerDir = dir.clone();
    this.alert(); this.cool = Math.max(this.cool, rand(0.6, 1.4));
    G.alertGroup(this.group);
  }
  trip(dir) {
    if (this.ko) return;
    this.releaseToken();
    this.hp -= 0.5;
    if (this.hp <= 0) { this.knockout(dir, 2.5); return; }
    this.down = true; this.state = 'down'; this.t = 0; this.vel.copy(dir).multiplyScalar(1.5);
    this.fallSign = -1; // on back
    this.lieQ.setFromAxisAngle(V(1, 0, 0), -Math.PI / 2);
    this.flyQ0 = this.bodyQ.clone();
    this.alert(); G.alertGroup(this.group);
  }
  knockout(dir, force, ground = false, launch = false) {
    if (this.ko) return;
    this.releaseToken();
    this.ko = true; this.down = true; this.aggro = true; this.hp = 0;
    G.stats.kos++; SFX.play('ko');
    this.state = ground ? 'ko' : 'flying'; this.t = 0;
    this.vel.copy(dir).multiplyScalar(force * (ground ? 0.3 : 1.2));
    // ordinary knockouts play Yusuf's death animation (he staggers back and falls); kicks, finishers and takedowns still launch him
    if (this.anim && !ground && !launch && force < 4.5) { this.state = 'dying'; this.vel.copy(dir).multiplyScalar(0.6 + force * 0.25); this.dieYaw = Math.atan2(-dir.x, -dir.z); }
    this.vy = ground ? 0 : (launch ? 5.5 : 2.6 + force * 0.25); this.y = 0;
    this.spinAxis = V(dir.z, 0, -dir.x).normalize();
    // fall on back if hit from the front
    const fwd = V(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const back = fwd.dot(dir) < 0;
    this.lieQ.setFromAxisAngle(V(1, 0, 0), back ? -Math.PI / 2 : Math.PI / 2);
    this.flyQ0 = this.bodyQ.clone();
    this.dropWeapon(dir);
    G.alertGroup(this.group);
    G.onKO && G.onKO(this);
  }
  dropWeapon(dir) {
    const w = this.rig.weapon; if (w.parent !== this.rig.root) return;
    const wp = w.getWorldPosition(V()), wq = w.getWorldQuaternion(new THREE.Quaternion());
    G.scene.attach(w); w.position.copy(wp); w.quaternion.copy(wq);
    this.dropped = { w, v: dir.clone().multiplyScalar(2).setY(2.5), spin: rand(-10, 10), done: false };
  }

  hasLOS(to) {
    const o = V(this.pos.x, 1.35 * this.size, this.pos.z), d = V(to.x, 1.2, to.z).sub(o); const L = d.length(); d.normalize();
    for (const b of G.colliders) { if (!b.active || b.y1 < 1.3) continue; const t = rayBox(b, o, d, L); if (t > 0 && t < L - 0.5) return false; }
    return true;
  }

  update(dt) {
    if (this.sucked) { this.updateSucked(dt); return; }
    if (this.loaded) { this.updateLoaded(dt); return; }
    const P = G.player; this.t += dt;
    const pose = this.pose;
    const want = V(); let faceTo = null; let speedCap = 3.6;
    let legFK = null, bodyQ = null, armFK = null;
    this.threatTime = null;
    const toP = _v1.copy(P.pos).sub(this.pos).setY(0); const dist = toP.length(); const dirP = toP.clone().normalize();

    // detection
    if (!this.aggro && !this.ko && P.state !== 'dead' && !this.tutHold) { // (tutHold: the tutorial says when he comes in)
      const range = this.idleMode === 'loot' ? 5.0 : 7.0;
      if (dist < range && this.hasLOS(P.pos)) { this.alert(); G.alertGroup(this.group); }
    }
    const k8 = 1 - Math.exp(-10 * dt);
    const setW = (c, d) => { pose.c.lerp(_v2.set(...c), k8); pose.d.lerp(_v3.set(...d).normalize(), k8).normalize(); };

    switch (this.state) {
      case 'idle': {
        // looting or guarding
        if (this.idleMode === 'loot') {
          setW([-0.2, 0.95, 0.15], [0.3, -0.6, 0.75]); // rifle slung low
          pose.ln = 0.45 + Math.sin(this.t * 3) * 0.08; pose.tw = Math.sin(this.t * 1.7) * 0.3;
          this.lootT -= dt;
          if (this.lootT <= 0) { this.lootT = rand(1.5, 4); const f = V(Math.sin(this.yaw), 0, Math.cos(this.yaw)); paperBurst(this.pos.x + f.x * 0.7, 1.0, this.pos.z + f.z * 0.7, 3, f.x * 0.3 - f.z * 0.6, f.z * 0.3 + f.x * 0.6, 1.6); }
        } else {
          setW([-0.15, 1.02, 0.25], [0.25, -0.55, 0.8]); pose.ln = 0.05; pose.tw = Math.sin(this.t * 0.4) * 0.4;
          if (this.idleMode === 'patrol') {
            const tgt = V(this.home.x + Math.sin(this.t * 0.25) * 2.5, 0, this.home.z + Math.cos(this.t * 0.25) * 1.5);
            want.copy(tgt.sub(this.pos)).setY(0); if (want.length() > 0.3) { want.setLength(1.1); faceTo = want.clone(); } else want.set(0, 0, 0);
          }
        }
        break;
      }
      case 'alert': {
        faceTo = dirP; setW([-0.12, 1.36, 0.26], [0, 0, 1]); pose.ln = 0;
        if (this.t > this.alertT) { this.state = 'combat'; this.t = 0; }
        break;
      }
      case 'combat': {
        faceTo = dirP;
        setW([-0.14, 1.15, 0.28], [0.15, -0.35, 0.92]); pose.ln = 0.08; pose.tw = 0;
        this.cool -= dt; this.strafeT -= dt;
        if (this.strafeT <= 0) { this.strafeT = rand(1.2, 3); this.strafeSign *= -1; }
        const ideal = this.tutIdeal ?? (this.heavy ? 3.5 : 5.5);
        const radial = dist > ideal + 1.5 ? 1 : dist < ideal - 1.8 ? -0.6 : 0;
        const tang = V(-dirP.z, 0, dirP.x).multiplyScalar(this.strafeSign * 0.8);
        want.copy(dirP).multiplyScalar(radial).add(tang).normalize().multiplyScalar(dist > 10 ? 3.6 : 1.8);
        if (this.tutWalk) { // (the tutorial walks him in through the fire doors)
          const d = V(this.tutWalk.x - this.pos.x, 0, this.tutWalk.z - this.pos.z);
          if (d.length() < 0.4) this.tutWalk = null; else { want.copy(d).setLength(2.6); faceTo = want.clone(); }
        }
        // separation
        for (const o of G.enemies) {
          if (o === this || o.ko) continue;
          const dx = this.pos.x - o.pos.x, dz = this.pos.z - o.pos.z, d = Math.hypot(dx, dz);
          if (d < 2.0 && d > 0.01) { want.x += dx / d * (2 - d) * 2; want.z += dz / d * (2 - d) * 2; }
        }
        // request attack token from the director
        if (this.cool <= 0 && !this.tutNoAttack && G.requestAttack(this)) {
          if (dist < 2.6) { this.state = 'melee'; this.t = 0; SFX.play('alert'); }
          else if (dist < 13 && this.hasLOS(P.pos)) { this.state = 'aim'; this.t = 0; this.aimDir.copy(dirP); this.burstDodged = false; SFX.play('aim'); }
          else G.attackers.delete(this);
        }
        break;
      }
      case 'aim': {
        const AIM = this.heavy ? 1.0 : 1.2, LOCK = 0.35;
        setW([-0.1, 1.36, 0.27], [0, 0, 1]); pose.ln = 0.02; pose.tw = 0;
        const locked = this.t > AIM - LOCK;
        if (!locked) {
          // track the player (with lag) — lead slightly
          const lead = _v2.copy(P.pos).addScaledVector(P.vel, 0.12).sub(this.pos).setY(0).normalize();
          const a0 = Math.atan2(this.aimDir.x, this.aimDir.z), a1 = Math.atan2(lead.x, lead.z);
          const na = a0 + clamp(angDiff(a0, a1), -3.2 * dt, 3.2 * dt);
          this.aimDir.set(Math.sin(na), 0, Math.cos(na));
        } else if (!this.lockBeep) { this.lockBeep = true; SFX.play('aim'); }
        faceTo = this.aimDir;
        this.threatTime = AIM - this.t + 0.05;
        if (dist > 2.6 && !this.anim) want.copy(V(-dirP.z, 0, dirP.x)).multiplyScalar(this.strafeSign * 0.5); // (animated robbers plant their feet to aim)
        this.updateLaser(locked, AIM - this.t <= 0.6); // the laser only lands on Karim in the last 0.6 s before the burst
        if (this.t >= AIM) { this.state = 'fire'; this.t = 0; this.shots = 0; this.lockBeep = false; this.burstHurt = false; }
        break;
      }
      case 'fire': {
        faceTo = this.aimDir; this.threatTime = this.shots < 3 ? 0.02 : null;
        const n = this.heavy ? 5 : 3, interval = 0.085;
        setW([-0.1, 1.36, 0.27 - (this.t % interval < 0.03 ? 0.05 : 0)], [0, 0.04, 1]);
        this.updateLaser(true);
        while (this.shots < n && this.t >= this.shots * interval) { this.fire(); this.shots++; }
        if (this.t > n * interval + 0.25) { this.endAttack(); }
        break;
      }
      case 'melee': {
        faceTo = dirP;
        const WIND = 0.5, STR = 0.62;
        if (this.t < WIND) { setW([0.05, 1.5, -0.08], [-0.55, 0.65, -0.5]); pose.tw = -0.5; this.threatTime = WIND - this.t + 0.12; if (dist > 1.6) want.copy(dirP).multiplyScalar(2.5); }
        else { pose.c.lerp(_v2.set(0.15, 1.2, 0.45), 1 - Math.exp(-30 * dt)); pose.d.lerp(_v3.set(0.75, -0.1, 0.65).normalize(), 1 - Math.exp(-30 * dt)).normalize(); pose.tw = 0.6; }
        if (!this.meleeDone && this.t >= WIND + 0.1) {
          this.meleeDone = true;
          const f = V(Math.sin(this.yaw), 0, Math.cos(this.yaw));
          if (dist < 2.1 && f.dot(dirP) > 0.4) { if (P.hurt(this.heavy ? 16 : 11, dirP, this)) { SFX.play('heavy'); spark(P.pos.x, 1.3, P.pos.z, 8, 0xffffff, 3, 0.2); } }
          else SFX.play('whoosh', 0.8);
        }
        if (this.t > WIND + STR) { this.meleeDone = false; this.endAttack(); }
        break;
      }
      case 'stagger': {
        const k = this.t / 0.45;
        this.vel.multiplyScalar(Math.exp(-6 * dt));
        want.copy(this.vel); speedCap = 10;
        bodyQ = new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), -0.35 * Math.sin(Math.PI * clamp(k, 0, 1)));
        setW([0.1, 1.1, 0.15], [0.6, -0.4, 0.7]);
        this.bodyCollide(Math.hypot(this.vel.x, this.vel.z), 1.0);
        if (this.t > 0.45) { this.state = 'combat'; this.t = 0; }
        break;
      }
      case 'down': {
        const k = Math.min(1, this.t / 0.35);
        this.vel.multiplyScalar(Math.exp(-5 * dt)); want.copy(this.vel); speedCap = 10;
        this.bodyQ.slerpQuaternions(this.flyQ0, this.lieQ, smooth(k)); bodyQ = this.bodyQ;
        pose.pv = lerp(PIV, 0.2, smooth(k));
        legFK = { t: [-0.3, 0.1], k: [0.6, 0.2] };
        setW([0, 1.15, 0.2], [1, 0.1, 0]);
        this.ring.visible = true; this.ring.position.set(this.pos.x, 0.03, this.pos.z); this.ring.scale.setScalar(1 + Math.sin(G.time * 10) * 0.08);
        if (this.t > (this.tutDownT || 2.5)) { this.state = 'getup'; this.t = 0; this.ring.visible = false; }
        break;
      }
      case 'getup': {
        const k = Math.min(1, this.t / 0.7);
        this.bodyQ.slerpQuaternions(this.lieQ, new THREE.Quaternion(), smooth(k)); bodyQ = this.bodyQ;
        pose.pv = lerp(0.2, PIV, smooth(k));
        legFK = k < 0.9 ? { t: [-1.4 * (1 - k), -0.4 * (1 - k)], k: [2.0 * (1 - k), 0.8 * (1 - k)] } : null;
        if (k >= 1) { this.down = false; this.state = 'combat'; this.t = 0; this.cool = rand(0.5, 1.5); }
        break;
      }
      case 'dying': { // Yusuf's death clip drives the body; the hit carries him back a little
        speedCap = 10; this.ring.visible = false;
        this.vel.multiplyScalar(Math.exp(-2.5 * dt)); want.copy(this.vel);
        if (this.t < 0.35) this.yaw = dampAngle(this.yaw, this.dieYaw, 18, dt);
        this.bodyCollide(Math.hypot(this.vel.x, this.vel.z), 0.9);
        if (this.t > 1.4 && !this.thudDone) { this.thudDone = true; SFX.play('thud'); disturbPapers(this.pos.x, this.pos.z, 1.4, 3); }
        if (this.t > 1.9 && this.shotByFriend) this.bleed(); // only a robber's bullet draws blood
        break;
      }
      case 'flying': case 'ko': {
        speedCap = 20;
        this.ring.visible = false;
        if (this.state === 'flying') {
          this.vy -= 14 * dt; this.y += this.vy * dt;
          const sp = Math.hypot(this.vel.x, this.vel.z);
          this.bodyCollide(sp, this.y + 0.8);
          if (this.y <= 0 && this.vy < 0) { this.y = 0; this.state = 'ko'; this.t = 0; SFX.play('thud'); G.shake = Math.max(G.shake, 0.3); chunks(this.pos.x, 0.1, this.pos.z, 6, 0xcfcfcf, 0.04, 1.5, 0.6); disturbPapers(this.pos.x, this.pos.z, 1.6, 4); }
          const k = Math.min(1, this.t / 0.45);
          this.bodyQ.slerpQuaternions(this.flyQ0, this.lieQ, smooth(k));
        } else {
          const k = Math.min(1, this.t / 0.3);
          this.bodyQ.slerp(this.lieQ, smooth(k));
          if (this.t > 0.6 && Math.hypot(this.vel.x, this.vel.z) < 0.6 && this.shotByFriend) this.bleed(); // once settled (only if a robber shot him)
          this.vel.multiplyScalar(Math.exp(-4 * dt));
          this.bodyCollide(Math.hypot(this.vel.x, this.vel.z), 0.4);
        }
        want.copy(this.vel);
        bodyQ = this.bodyQ;
        pose.pv = lerp(PIV, 0.2, smooth(Math.min(1, this.t / 0.35))) * (this.state === 'ko' ? 1 : 0) + (this.state === 'flying' ? lerp(PIV, 0.45, Math.min(1, this.t * 3)) : 0);
        if (this.state === 'ko') pose.pv = lerp(0.45, 0.19, smooth(Math.min(1, this.t / 0.25)));
        legFK = { t: [0.15, -0.25], k: [0.2, 0.5], s: [0.15, -0.1] };
        armFK = [[0.3, 0, 1.3], [-0.2, 0, -1.2]].map(a => [a[0], a[1], a[2], -0.4]);
        break;
      }
    }

    // integrate movement
    if (want.length() > speedCap) want.setLength(speedCap);
    const accel = (this.state === 'flying' || this.state === 'ko' || this.state === 'stagger' || this.state === 'down' || this.state === 'dying') ? 60 : 8;
    this.prevVel.copy(this.vel);
    if (this.state !== 'flying' && this.state !== 'ko' && this.state !== 'stagger' && this.state !== 'down' && this.state !== 'dying') { this.vel.x = damp(this.vel.x, want.x, accel, dt); this.vel.z = damp(this.vel.z, want.z, accel, dt); }
    if (!Number.isFinite(this.vel.x) || !Number.isFinite(this.vel.z)) this.vel.set(0, 0, 0);
    this.pos.addScaledVector(this.vel, dt);
    const hit = resolveCircle(this.pos, this.r);
    if (!this.down) for (const o of G.enemies) {
      if (o === this || o.down) continue;
      const dx = this.pos.x - o.pos.x, dz = this.pos.z - o.pos.z, d = Math.hypot(dx, dz), rr = this.r + o.r;
      if (d < rr && d > 0.001) { const p = (rr - d) * 0.5; this.pos.x += dx / d * p; this.pos.z += dz / d * p; o.pos.x -= dx / d * p; o.pos.z -= dz / d * p; }
    }
    if (!this.down) pushChairs(this.pos, this.r, this.vel, 1);
    if (faceTo && faceTo.lengthSq() > 0.001 && !this.down) this.yaw = dampAngle(this.yaw, Math.atan2(faceTo.x, faceTo.z), this.state === 'aim' || this.state === 'fire' ? 25 : 8, dt);

    // feet
    let feet = null;
    if (!legFK) {
      const spd = Math.hypot(this.vel.x, this.vel.z); const s = Math.min(1, spd / 3.5);
      this.phase += dt * spd * 2.9 / this.size; // shorter legs, quicker steps
      const lv = _v2.copy(this.vel).applyAxisAngle(V(0, 1, 0), -this.yaw); const ldir = lv.lengthSq() > 0.01 ? lv.normalize().clone() : V(0, 0, 1);
      feet = [];
      for (let i = 0; i < 2; i++) {
        const side = i === 0 ? 1 : -1, ph = this.phase + i * Math.PI, sw = Math.sin(ph) * 0.4 * s;
        const stance = this.state === 'aim' || this.state === 'fire' ? (i === 0 ? 0.2 : -0.15) : (i === 0 ? 0.06 : -0.04);
        feet.push(V(side * 0.14 + ldir.x * sw, 0.07 + Math.max(0, Math.cos(ph)) * 0.13 * s, stance * (1 - s) + ldir.z * sw));
      }
      if (pose.pv === undefined || this.state === 'combat' || this.state === 'idle' || this.state === 'alert' || this.state === 'aim' || this.state === 'fire' || this.state === 'melee')
        pose.pv = damp(pose.pv, PIV - 0.03 - Math.abs(Math.sin(this.phase)) * 0.03 * s - (this.state === 'aim' ? 0.04 : 0), 10, dt);
    }
    const rig = this.rig;
    rig.root.position.set(this.pos.x, this.state === 'flying' ? Math.max(0, this.y) : 0, this.pos.z); rig.root.rotation.y = this.yaw;
    // Yusuf's robber model is sculpted in a forward combat crouch: keep that posture so the vest and trousers stay joined
    const crouch = this.skin ? 0.45 : 0, wc = this.skin ? _wc.copy(pose.c).add(_wcOff) : pose.c;
    // Mixamo rifle clips: run / strafe while repositioning, shoulder the rifle to aim and fire, the death fall
    let C = null, cw = 0;
    if (this.anim) {
      const sel = {}, spd = Math.hypot(this.vel.x, this.vel.z), st = this.state;
      if (st === 'dying') { sel.Death = 1; sel.deathT = this.t; }
      else if (st === 'aim' || st === 'alert') sel.Shoot = 1;
      else if (st === 'fire') { sel.Shoot = 1; sel.shootPlay = true; }
      else if (st === 'combat') {
        if (spd > 0.35) {
          const lv = _v2.copy(this.vel).applyAxisAngle(_UP, -this.yaw), unit = this.anim.k * this.size; // local: x = his left, z = ahead
          const ax = Math.abs(lv.x), az = Math.abs(lv.z), sw = ax + az || 1;
          sel.Strafe = ax / sw; sel.Run = az / sw;
          const sgn = v => (v < 0 ? -1 : 1), I = this.anim.info;
          const stride = (sel.Run * clipStride('Run') + sel.Strafe * clipStride('Strafe')) * unit; // metres per gait cycle
          sel.phaseRate = spd / Math.max(0.2, stride);
          sel.runDir = sgn(lv.z); sel.strafeDir = sgn(lv.x * I.strafeDir);
        } else sel.Shoot = 1; // standing his ground, rifle up
      }
      C = this.anim.update(dt, sel); cw = C ? this.anim.W : 0;
    }
    rig.apply({ pivotY: pose.pv - (this.skin ? 0.04 : 0), bodyQ, spine: [pose.ln + crouch, pose.tw * 0.5, 0], chest: [pose.ln * 0.4 + crouch * 0.2, pose.tw * 0.5, 0], head: [0, ((this.state === 'aim' ? 0.12 : 0) - crouch * 0.9) * (1 - cw)],
      wC: wc, wD: pose.d, feet, legFK: cw > 0.99 && feet ? null : legFK, armFK: cw > 0.99 ? null : armFK, footYaw: [0.15, -0.2], clip: C, clipW: cw, clipLegW: cw, clipArmW: cw }, dt);
    if (C && cw > 0.001) placeRifle(rig, cw);
    this.blob.visible = !this.down;
    if (this.down || this.state === 'flying') this.keepAboveFloor();
    // dropped weapon physics
    const dw = this.dropped;
    if (dw && !dw.done) {
      dw.v.y -= 12 * dt; dw.w.position.addScaledVector(dw.v, dt); dw.w.rotation.x += dw.spin * dt;
      if (dw.w.position.y < 0.05) { dw.w.position.y = 0.05; dw.done = true; dw.w.rotation.set(Math.PI / 2, rand(0, 6), 0, 'YXZ'); addChair(dw.w, { r: 0.38, light: true, noTip: true, baseQ: dw.w.quaternion.clone(), y0: 0.05, rifle: true }); SFX.play('thud', 0.6); }
    }
    if (this.ko) { this.laser.visible = false; this.dot.visible = false; }
  }

  // lift the whole body so no part of it pokes through the floor (head, chest, hips, hands, knees, feet)
  keepAboveFloor() {
    const rig = this.rig; rig.root.updateMatrixWorld(true);
    let lift = 0; const s = this.size || 1;
    const chk = (o, r) => { o.getWorldPosition(_v4); lift = Math.max(lift, r * s - _v4.y); };
    chk(rig.head, 0.13); chk(rig.chest, 0.14); chk(rig.spine, 0.13); chk(rig.body, 0.13);
    for (let i = 0; i < 2; i++) { chk(rig.hand[i], 0.06); chk(rig.el[i], 0.06); chk(rig.knee[i], 0.08); chk(rig.foot[i], 0.07); }
    if (lift > 0) { rig.root.position.y += lift; rig.root.updateMatrixWorld(true); }
  }
  bleed() {
    if (this.bled) return; this.bled = true;
    // pool under the head/torso of the lying body
    const h = this.rig.head.getWorldPosition(V()), c = this.rig.chest.getWorldPosition(V());
    bloodPool(h.x * 0.7 + c.x * 0.3, h.z * 0.7 + c.z * 0.3, (0.45 + Math.random() * 0.3) * Math.sqrt(this.size), 1.8);
  }

  endAttack() {
    if (this.state === 'fire') this.lastBurst = { dodged: !!this.burstDodged, hurt: !!this.burstHurt, t: G.time };
    this.releaseToken(); this.state = 'combat'; this.t = 0; this.cool = this.heavy ? rand(1.2, 2.2) : rand(1.8, 3.6);
  }
  // the tutorial asks for a shot (to teach the dodge roll): raise the rifle and aim at Karim now
  forceAim() {
    if (this.ko || this.down || this.state === 'aim' || this.state === 'fire') return false;
    const d = G.player.pos.clone().sub(this.pos).setY(0); if (d.lengthSq() < 1e-4) d.set(0, 0, 1);
    G.attackers.add(this); this.state = 'aim'; this.t = 0; this.aimDir.copy(d.normalize());
    this.burstDodged = false; this.burstHurt = false; this.lockBeep = false; SFX.play('aim');
    return true;
  }

  // knocked-back bodies smash into furniture
  bodyCollide(speed, h) {
    if (speed < 2.5) return;
    const p = V(this.pos.x, h, this.pos.z);
    const dir = V(this.vel.x, 0, this.vel.z).normalize();
    for (const d of G.destructibles) {
      if (d.broken || !d.box) continue;
      if (sphereBox(d.box, p, this.r + 0.1)) { if (hitDestructible(d, 'body', p.clone(), dir)) { this.vel.multiplyScalar(0.55); } }
    }
    for (const s of G.surfaces) {
      if (!s.desk) continue;
      if (pointInBox(s, p.x, p.z, this.r) && (!this._lastDesk || this._lastDesk !== s)) { this._lastDesk = s; paperBurst(p.x, s.y + 0.2, p.z, 10, dir.x * 0.6, dir.z * 0.6, 3); SFX.play('thud'); this.vel.multiplyScalar(0.6); }
    }
    for (const c of chairs) if (c.pos.distanceTo(this.pos) < 0.8) knockChair(c, dir, speed * 0.9);
  }

  updateLaser(locked, show = true) {
    const w = this.rig.weapon;
    const o = w.localToWorld(w.userData.laser.clone());
    const dir = V(this.aimDir.x, 0, this.aimDir.z).normalize();
    const P = G.player;
    // aim height toward player chest
    const dy = (1.2 - o.y) / Math.max(1, Math.hypot(P.pos.x - o.x, P.pos.z - o.z));
    dir.y = dy; dir.normalize();
    const hit = this.castShot(o, dir, 30, true);
    const L = hit.t;
    this.laser.visible = show; this.dot.visible = show;
    this.laser.position.copy(o); this.laser.scale.set(1, 1, L);
    this.laser.lookAt(o.clone().add(dir));
    this.dot.position.copy(o).addScaledVector(dir, L - 0.02);
    const blink = locked ? (Math.sin(G.time * 60) > 0 ? 1 : 0.4) : 0.55;
    this.laser.material.opacity = blink; this.laser.scale.x = this.laser.scale.y = locked ? 1.5 : 1;
    this.shotDir = dir;
  }

  // ray vs world: returns {t, type, ref}
  castShot(o, d, maxT, probe = false) {
    let best = { t: maxT, type: 'none' };
    for (const b of G.colliders) {
      if (!b.active || b.destructible) continue;
      const t = rayBox(b, o, d, best.t); if (t >= 0.3 && t < best.t) best = { t, type: 'wall', ref: b };
    }
    for (const ds of G.destructibles) {
      if (ds.broken || !ds.box) continue;
      const t = rayBox(ds.box, o, d, best.t); if (t >= 0.3 && t < best.t) best = { t, type: 'prop', ref: ds };
    }
    // player capsule
    const P = G.player;
    const pt = rayCircle(o, d, P.pos, 0.42, 0, 1.85, best.t);
    if (pt >= 0 && pt < best.t) best = { t: pt, type: 'player' };
    if (!probe) for (const e of G.enemies) {
      if (e === this || e.ko || e.down) continue;
      const et = rayCircle(o, d, e.pos, 0.36 * e.size, 0, 1.8 * e.size, best.t); if (et >= 0.4 && et < best.t) best = { t: et, type: 'enemy', ref: e };
    }
    // floor / bounds
    if (d.y < 0) { const ft = -o.y / d.y; if (ft < best.t) best = { t: ft, type: 'floor' }; }
    return best;
  }

  fire() {
    const w = this.rig.weapon;
    const o = w.localToWorld(w.userData.muzzle.clone());
    const d = this.shotDir.clone();
    d.x += rand(-0.025, 0.025); d.z += rand(-0.025, 0.025); d.y += rand(-0.01, 0.01); d.normalize();
    const hit = this.castShot(o, d, 30);
    const end = o.clone().addScaledVector(d, hit.t);
    tracer(o, end); flash(o.x, o.y, o.z, 0.9, 0xffc060, 0.05); SFX.play('gun', 0.8);
    G.muzzleLight(o);
    if (hit.type === 'player') { // a whole burst costs Karim one bar at most
      if (!this.burstHurt && !this.burstDodged) this.burstHurt = G.player.hurt(this.heavy ? 8 : 6, d.clone().setY(0).normalize(), this); // (a burst he rolled away from can't catch him afterwards)
      spark(end.x, end.y, end.z, 6, 0xffffff, 3, 0.2);
    }
    else if (hit.type === 'prop') { hitDestructible(hit.ref, 'bullet', end, d.clone().setY(0).normalize()); spark(end.x, end.y, end.z, 8, 0xffd080, 4, 0.25); }
    else if (hit.type === 'enemy') { hit.ref.shotByFriend = true; hit.ref.hp -= 1; if (hit.ref.hp <= 0) hit.ref.knockout(d.clone().setY(0).normalize(), 2); else hit.ref.stagger(d.clone().setY(0).normalize(), 2); floatText('FRIENDLY FIRE', end.clone().setY(2), 'onoma', 0.8); }
    else { spark(end.x, end.y, end.z, 7, 0xffd080, 4, 0.25, 0.08); chunks(end.x, end.y, end.z, 3, 0x777777, 0.03, 2, 0.6); }
    // bullets near desks shower papers
    for (const s of G.surfaces) if (s.desk && pointInBox(s, end.x, end.z, 0.2) && end.y < s.y + 0.6) { paperBurst(end.x, s.y + 0.1, end.z, 3, d.x * 0.5, d.z * 0.5, 2); break; }
  }
}

const _v4 = new THREE.Vector3();
const _wc = new THREE.Vector3(), _wcOff = new THREE.Vector3(0, -0.1, 0.24), _UP = new THREE.Vector3(0, 1, 0);
// ray vs vertical cylinder (xz circle, y range)
function rayCircle(o, d, c, r, y0, y1, maxT) {
  const ox = o.x - c.x, oz = o.z - c.z;
  const a = d.x * d.x + d.z * d.z; if (a < 1e-9) return -1;
  const b = 2 * (ox * d.x + oz * d.z), cc = ox * ox + oz * oz - r * r;
  const disc = b * b - 4 * a * cc; if (disc < 0) return -1;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  if (t < 0 || t > maxT) return -1;
  const y = o.y + d.y * t; if (y < y0 || y > y1) return -1;
  return t;
}

// ---------- spawn layout ----------
export function spawnEnemies() {
  const E = (x, z, yaw, g, o) => G.enemies.push(new Enemy(x, z, yaw, g, o));
  // lounge
  E(-10.2, 5.3, -2.4, 1, { idle: 'guard' }); E(-9.0, 0.6, -1.2, 1, { idle: 'loot' });
  // atrium
  E(-0.8, -1.8, 2.6, 2, { idle: 'patrol' }); E(2.6, 6.4, -1.8, 2, { idle: 'guard' }); E(0.4, -9.8, 0.2, 2, { idle: 'guard' });
  // office
  E(-14.6, -8.6, Math.PI, 3, { idle: 'loot' }); E(-11.8, -5.7, 1.0, 3, { idle: 'guard' }); E(-9.3, -11.6, 0.6, 3, { idle: 'loot' });
  // reception
  E(9.9, 1.0, -Math.PI / 2, 4, { idle: 'loot' }); E(5.6, 6.2, -2.2, 4, { idle: 'guard' });
  // vault + manager office
  E(9.0, -8.2, Math.PI, 5, { idle: 'guard' }); E(14.4, -7.9, -2.0, 5, { idle: 'loot' }); E(10.1, -10.8, 0.0, 5, { heavy: true, idle: 'guard' });
}
