// Yusuf's Mixamo rifle animations for the robbers (made on Karim's Mixamo skeleton): run, strafe, shoot, die.
// Every robber runs a bones-only copy of that skeleton through the clips; the procedural robber rig follows it
// (same idea as Karim's body: clip -> skeleton -> rig joints -> the skinned robber mesh), and the rifle is laid
// between his hands.
import * as THREE from 'three';
import { RIG } from './rig.js';

const PIV = RIG.PIVOT;
const MAP = [
  ['body', 'Hips'], ['spine', 'Spine'], ['chest', 'Spine2'], ['neck', 'Neck'],
  ['sh0', 'LeftArm'], ['el0', 'LeftForeArm'], ['hand0', 'LeftHand'], ['sh1', 'RightArm'], ['el1', 'RightForeArm'], ['hand1', 'RightHand'],
  ['hip0', 'LeftUpLeg'], ['knee0', 'LeftLeg'], ['foot0', 'LeftFoot'], ['hip1', 'RightUpLeg'], ['knee1', 'RightLeg'], ['foot1', 'RightFoot'],
];
const PARENT = { spine: 'body', chest: 'spine', neck: 'chest', sh0: 'chest', el0: 'sh0', hand0: 'el0', sh1: 'chest', el1: 'sh1', hand1: 'el1', hip0: 'body', knee0: 'hip0', foot0: 'knee0', hip1: 'body', knee1: 'hip1', foot1: 'knee1' };
const LOOPS = ['Run', 'Strafe', 'Shoot'];
let PACK = null;
const key = n => n.replace(/^mixamorig:?/, '');

// call once at boot, before anything animates Karim (we copy his skeleton in its bind pose)
export function initRobberAnims(karimGltf, json) {
  if (!karimGltf || !json) return;
  const scene = karimGltf.scene; scene.updateMatrixWorld(true);
  let hips = null; scene.traverse(o => { if (!hips && o.isBone && key(o.name) === 'Hips') hips = o; });
  if (!hips) return;
  const tpl = cloneBones(hips);
  const parentM = hips.parent.matrixWorld.clone();
  const clips = {}; for (const c of json.clips) { const a = THREE.AnimationClip.parse(c); clips[a.name] = a; }
  const B = {}; scene.traverse(o => { if (o.isBone) B[key(o.name)] = o; });
  const wp = n => B[n].getWorldPosition(new THREE.Vector3());
  PACK = { tpl, parentM, clips, info: json.info, hipsY: wp('Hips').y, ankleY: (wp('LeftFoot').y + wp('RightFoot').y) / 2 };
}
export const robberAnimsReady = () => !!PACK;
// ground speed of the in-place loops at timeScale 1, in the skeleton's own units per second (scaled per robber)
export function clipSpeed(name) {
  if (!PACK) return 1;
  const i = PACK.info[name]; return i ? Math.hypot(i.footVx, i.footVz) : 1;
}
// ground covered by one cycle of a loop (skeleton units)
export function clipStride(name) {
  if (!PACK) return 1;
  const i = PACK.info[name]; return i ? Math.hypot(i.footVx, i.footVz) * i.dur : 1;
}
function cloneBones(b) {
  const n = new THREE.Bone(); n.name = b.name; n.position.copy(b.position); n.quaternion.copy(b.quaternion); n.scale.copy(b.scale);
  for (const c of b.children) if (c.isBone) n.add(cloneBones(c));
  return n;
}

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _qi = new THREE.Quaternion(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3();
export class RobberAnim {
  constructor(rig) {
    this.rig = rig;
    const D = rig.D || {};
    this.skel = cloneBones(PACK.tpl);
    const base = new THREE.Group(); PACK.parentM.decompose(base.position, base.quaternion, base.scale); base.add(this.skel);
    // scale the skeleton so its legs match the robber's (hips-to-ankle drop)
    const drop = -(D.hipY ?? -0.08) + (D.TH ?? 0.44) + (D.SH ?? 0.44);
    this.k = drop / Math.max(0.1, PACK.hipsY - PACK.ankleY);
    this.standY = drop + PACK.ankleY * this.k; // his hips height with straight legs and the ankles where Karim's are (feet on the floor)
    this.holder = new THREE.Group(); this.holder.scale.setScalar(this.k); this.holder.add(base); rig.root.add(this.holder);
    this.B = {}; this.skel.traverse(o => { if (o.isBone) this.B[key(o.name)] = o; });
    this.joints = {
      body: rig.body, spine: rig.spine, chest: rig.chest, neck: rig.neck,
      sh0: rig.sh[0], el0: rig.el[0], hand0: rig.hand[0], sh1: rig.sh[1], el1: rig.el[1], hand1: rig.hand[1],
      hip0: rig.hip[0], knee0: rig.knee[0], foot0: rig.foot[0], hip1: rig.hip[1], knee1: rig.knee[1], foot1: rig.foot[1],
    };
    this.captureBind();
    this.mixer = new THREE.AnimationMixer(this.skel); this.actions = {};
    for (const n in PACK.clips) { const a = this.mixer.clipAction(PACK.clips[n]); a.play(); a.setEffectiveWeight(0); this.actions[n] = a; }
    for (const n of LOOPS) this.actions[n].setLoop(THREE.LoopRepeat);
    this.actions.Death.setLoop(THREE.LoopOnce); this.actions.Death.clampWhenFinished = true;
    this.w = { Run: 0, Strafe: 0, Shoot: 0, Death: 0 }; this.W = 0;
    this.C = { bodyP: new THREE.Vector3(), body: new THREE.Quaternion() };
    for (const j in PARENT) this.C[j] = new THREE.Quaternion();
    this.frozen = false;
    // which way the in-place strafe clip carries him (+1 = towards his left), from the planted foot sliding the other way
    this.info = { strafeDir: (PACK.info.Strafe && PACK.info.Strafe.footVx > 0) ? -1 : 1 };
  }
  // rig in its T-pose vs the Mixamo skeleton at bind: the per-joint frames that map one onto the other
  captureBind() {
    const rig = this.rig, root = rig.root;
    const sp = root.position.clone(), sq = root.quaternion.clone(), ss = root.scale.clone();
    const saved = {}; for (const k in this.joints) saved[k] = [this.joints[k].quaternion.clone(), this.joints[k].position.clone()];
    root.position.set(0, 0, 0); root.quaternion.identity();
    rig.body.position.set(0, this.standY, 0); rig.body.quaternion.identity();
    for (const k in this.joints) if (k !== 'body') this.joints[k].quaternion.identity();
    rig.sh[0].quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
    rig.sh[1].quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), -Math.PI / 2);
    root.updateMatrixWorld(true);
    const inv = _qi.copy(root.quaternion).invert();
    this.bMy = {}; this.bMix = {};
    for (const k in this.joints) this.bMy[k] = this.joints[k].getWorldQuaternion(new THREE.Quaternion()).premultiply(inv);
    for (const [, n] of MAP) this.bMix[n] = this.B[n].getWorldQuaternion(new THREE.Quaternion()).premultiply(inv);
    const bodyP = root.worldToLocal(rig.body.getWorldPosition(new THREE.Vector3()));
    this.hipsOff = root.worldToLocal(this.B.Hips.getWorldPosition(new THREE.Vector3())).sub(bodyP);
    for (const k in this.joints) { this.joints[k].quaternion.copy(saved[k][0]); this.joints[k].position.copy(saved[k][1]); }
    root.position.copy(sp); root.quaternion.copy(sq); root.scale.copy(ss); root.updateMatrixWorld(true);
  }
  // sel: { Run, Strafe, Shoot, Death } target weights, phaseRate (gait cycles/s), runDir/strafeDir (+1/-1), shootPlay, deathT
  update(dt, sel) {
    if (this.frozen) return this.C;
    const k = 1 - Math.exp(-10 * dt);
    let sum = 0, tgt = 0;
    for (const n in this.w) { this.w[n] += ((sel[n] || 0) - this.w[n]) * (n === 'Death' && sel.Death ? 1 : k); sum += this.w[n]; tgt = Math.max(tgt, sel[n] || 0); }
    this.W = Math.min(1, sum);
    if (sum < 0.002) return null;
    for (const n in this.w) this.actions[n].setEffectiveWeight(this.w[n] / sum);
    // run + strafe share one gait phase so a diagonal blend keeps both feet in step
    this.ph = (this.ph || 0) + dt * (sel.phaseRate || 0);
    const fr = x => x - Math.floor(x);
    for (const [n, dir] of [['Run', sel.runDir || 1], ['Strafe', sel.strafeDir || 1]]) { const a = this.actions[n]; a.timeScale = 0; a.time = fr(dir * this.ph) * PACK.clips[n].duration; }
    const sh = this.actions.Shoot; if (sel.shootPlay) sh.timeScale = 1; else { sh.timeScale = 0; sh.time = 0; }
    const de = this.actions.Death; de.timeScale = 0; de.time = Math.min(sel.deathT || 0, PACK.clips.Death.duration - 1e-3);
    this.mixer.update(dt);
    this.read();
    if (sel.Death && this.w.Death > 0.999 && (sel.deathT || 0) > PACK.clips.Death.duration + 0.5) this.frozen = true; // lying still: stop animating
    return this.C;
  }
  rootQ(o, out) { o.getWorldQuaternion(out); return out.premultiply(_qi.copy(this.rig.root.quaternion).invert()); }
  read() {
    this.holder.updateMatrixWorld(true);
    const W = {}, C = this.C;
    for (const [j, n] of MAP) W[j] = this.rootQ(this.B[n], new THREE.Quaternion()).multiply(_q.copy(this.bMix[n]).invert()).multiply(this.bMy[j]);
    C.body.copy(W.body);
    for (const j in PARENT) C[j].copy(W[PARENT[j]]).invert().multiply(W[j]);
    const root = this.rig.root; root.updateMatrixWorld(true);
    this.B.Hips.getWorldPosition(_v); root.worldToLocal(_v);
    const D = _q.copy(W.body).multiply(_q2.copy(this.bMy.body).invert());
    C.bodyP.copy(_v).sub(_v2.copy(this.hipsOff).applyQuaternion(D));
  }
}

// lay the rifle between his hands: grip at the right wrist, the line to the left wrist matching the model's own hold
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _mA = new THREE.Matrix4(), _mB = new THREE.Matrix4(), _p = new THREE.Vector3(), _up = new THREE.Vector3();
export function placeRifle(rig, w) {
  const wpn = rig.weapon; if (w <= 0.001 || wpn.parent !== rig.root || !rig.gripLocal) return;
  const gl = rig.gripLocal[0]; // left wrist in rifle space (rifle +Y = barrel, -Z = up)
  // rifle-space basis: a = towards the left hand, b = 'up' made perpendicular
  _a.copy(gl).normalize(); _b.set(0, 0, -1).addScaledVector(_a, _a.z).normalize(); _c.crossVectors(_a, _b);
  _mA.makeBasis(_a, _b, _c);
  // world basis from the hands, 'up' from his chest
  const rh = rig.hand[1].getWorldPosition(_p), lh = rig.hand[0].getWorldPosition(new THREE.Vector3());
  _a.subVectors(lh, rh).normalize();
  _up.set(0, 1, 0).applyQuaternion(rig.chest.getWorldQuaternion(_q)).lerp(new THREE.Vector3(0, 1, 0), 0.5);
  _b.copy(_up).addScaledVector(_a, -_up.dot(_a)).normalize(); _c.crossVectors(_a, _b);
  _mB.makeBasis(_a, _b, _c);
  const qW = new THREE.Quaternion().setFromRotationMatrix(_mB.multiply(_mA.transpose()));
  // into root space
  const root = rig.root; const qR = root.getWorldQuaternion(_q2).invert().multiply(qW);
  root.worldToLocal(rh);
  wpn.position.lerp(rh, w); wpn.quaternion.slerp(qR, w); wpn.updateMatrixWorld(true);
}
