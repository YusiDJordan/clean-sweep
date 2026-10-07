// Mixamo-rigged Karim. Clips (idle, walk, run, kicks, hits, deaths...) drive his body;
// the procedural rig keeps control of his arms (both hands on the mop) and anything without a clip (the slide).
// Data flow each frame:  clip -> Mixamo bones -> (read) procedural rig -> IK/mop -> (write) Mixamo bones -> skinned mesh
import * as THREE from 'three';
import { G } from './state.js';
import { RIG } from './rig.js';

export const KARIM_SCALE = 1.78; // Mixamo export is 1 unit tall
const PIV = RIG.PIVOT;
const MAP = [ // procedural joint -> Mixamo bone
  ['body', 'Hips'], ['spine', 'Spine'], ['chest', 'Spine2'], ['neck', 'Neck'],
  ['sh0', 'LeftArm'], ['el0', 'LeftForeArm'], ['hand0', 'LeftHand'], ['sh1', 'RightArm'], ['el1', 'RightForeArm'], ['hand1', 'RightHand'],
  ['hip0', 'LeftUpLeg'], ['knee0', 'LeftLeg'], ['foot0', 'LeftFoot'], ['hip1', 'RightUpLeg'], ['knee1', 'RightLeg'], ['foot1', 'RightFoot'],
];
// bones written from a neighbour's rotation: [bone, source joint(s)]
const DERIVED = [['Spine1', ['spine', 'chest']], ['Head', ['neck']], ['LeftShoulder', ['chest']], ['RightShoulder', ['chest']], ['LeftToeBase', ['foot0']], ['RightToeBase', ['foot1']]];
const ORDER = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand',
  'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase', 'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase'];

function boneMap(root) { const m = {}; root.traverse(o => { if (o.isBone) m[o.name.replace(/^mixamorig:?/, '')] = o; }); return m; }

// skeleton dimensions for the procedural rig, measured from the Mixamo bind pose
export function mixamoDims(gltf) {
  const s = gltf.scene; s.updateMatrixWorld(true);
  const B = boneMap(s), P = n => B[n].getWorldPosition(new THREE.Vector3()).multiplyScalar(KARIM_SCALE);
  const LA = P('LeftArm'), LF = P('LeftForeArm'), LH = P('LeftHand'), LU = P('LeftUpLeg'), LL = P('LeftLeg'), LFt = P('LeftFoot');
  const Sp = P('Spine'), S2 = P('Spine2'), N = P('Neck'), H = P('Head');
  return {
    UA: LA.distanceTo(LF), FA: LF.distanceTo(LH), TH: LU.distanceTo(LL), SH: LL.distanceTo(LFt),
    shX: LA.x, shY: LA.y - S2.y, hipX: LU.x, hipY: LU.y - PIV, spineY: Sp.y - PIV, chestY: S2.y - Sp.y, neckY: N.y - S2.y, headY: H.y - N.y,
  };
}

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion(), _qi = new THREE.Quaternion(), _v = new THREE.Vector3();

export class MixamoBody {
  constructor(rig, gltf, texture, idleMop, sweepMop) {
    this.rig = rig;
    this.holder = new THREE.Group(); this.holder.scale.setScalar(KARIM_SCALE);
    this.holder.add(gltf.scene); rig.root.add(this.holder);
    this.B = boneMap(gltf.scene);
    gltf.scene.traverse(o => {
      if (o.isSkinnedMesh) {
        o.material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.72, metalness: 0, envMapIntensity: 0.8 });
        o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; o.userData.noProbe = true; o.userData.keep = true;
        this.mesh = o;
      }
    });
    this.reweightKameez();
    // hide the stand-in body (keep mop + blob)
    rig.root.traverse(o => { if (o.isMesh && !o.userData.keep) { let p = o, w = false; while (p) { if (p === rig.weapon) w = true; p = p.parent; } if (!w) o.visible = false; } });
    rig.skirt = null;
    this.joints = {
      body: rig.body, spine: rig.spine, chest: rig.chest, neck: rig.neck,
      sh0: rig.sh[0], el0: rig.el[0], hand0: rig.hand[0], sh1: rig.sh[1], el1: rig.el[1], hand1: rig.hand[1],
      hip0: rig.hip[0], knee0: rig.knee[0], foot0: rig.foot[0], hip1: rig.hip[1], knee1: rig.knee[1], foot1: rig.foot[1],
    };
    this.parentOf = { spine: 'body', chest: 'spine', neck: 'chest', sh0: 'chest', el0: 'sh0', hand0: 'el0', sh1: 'chest', el1: 'sh1', hand1: 'el1', hip0: 'body', knee0: 'hip0', foot0: 'knee0', hip1: 'body', knee1: 'hip1', foot1: 'knee1' };
    this.captureBind();
    rig.palmOff = 0.075;
    // animation
    this.mixer = new THREE.AnimationMixer(gltf.scene);
    this.clips = {}; this.actions = {};
    for (const c of gltf.animations) { this.clips[c.name] = c; const a = this.mixer.clipAction(c); a.play(); a.setEffectiveWeight(0); this.actions[c.name] = a; }
    // authored idle (posed in Blender with the mop in hand) replaces the stock idle
    if (idleMop) {
      const clip = THREE.AnimationClip.parse(idleMop.clip);
      this.actions.Idle.stop();
      this.clips.Idle = clip; const a = this.mixer.clipAction(clip); a.play(); a.setEffectiveWeight(0); this.actions.Idle = a;
      this.mopT = new THREE.Vector3().fromArray(idleMop.mop.t); this.mopQ = new THREE.Quaternion().fromArray(idleMop.mop.q);
    }
    // authored mopping (Ctrl): full body while he stands and mops; upper body + arms while he walks and mops
    if (sweepMop) {
      const clip = THREE.AnimationClip.parse(sweepMop.clip);
      this.clips.Sweep = clip; const a = this.mixer.clipAction(clip); a.play(); a.setEffectiveWeight(0); this.actions.Sweep = a;
      this.sweep = { hand: sweepMop.mop.hand, t: new THREE.Vector3().fromArray(sweepMop.mop.t), q: new THREE.Quaternion().fromArray(sweepMop.mop.q) };
      const ip = n => { const t = clip.tracks.find(x => x.name.replace(/^mixamorig:?/, '') === n + '.quaternion'); return t ? t.createInterpolant() : null; };
      this.sweepUpper = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head'].map(n => [n, ip(n)]);
    }
    this.LOCO = this.sweep ? ['Idle', 'Walk', 'Run', 'Sweep'] : ['Idle', 'Walk', 'Run'];
    for (const n of this.LOCO) this.actions[n].setLoop(THREE.LoopRepeat);
    this.w = { Idle: 1, Walk: 0, Run: 0, Sweep: 0 }; this.one = null; this.oneW = 0;
    this.sweepW = 0; this.upperW = 0;
    this.clip = { bodyP: new THREE.Vector3() };
    for (const k in this.joints) if (k !== 'body') this.clip[k] = new THREE.Quaternion();
    this.clip.body = new THREE.Quaternion();
    this.fingers = [];
    for (const side of ['Left', 'Right']) for (const f of ['Index', 'Middle', 'Ring', 'Pinky', 'Thumb']) for (let i = 1; i <= 3; i++) {
      const b = this.B[`${side}Hand${f}${i}`]; if (b) this.fingers.push({ b, rest: b.quaternion.clone(), side, f, i });
    }
    this.grip = 1;
  }

  // Mixamo glues the long kameez to the thighs, so a kick tears it into a flap. Re-weight the skirt so it
  // drapes between the hips and both legs (the trousers underneath keep their own weights).
  reweightKameez() {
    const m = this.mesh, g = m.geometry, pos = g.attributes.position, si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
    const bones = m.skeleton.bones, idx = n => bones.indexOf(this.B[n]);
    const H = idx('Hips'), LU = idx('LeftUpLeg'), LL = idx('LeftLeg'), RU = idx('RightUpLeg'), RL = idx('RightLeg');
    const S = KARIM_SCALE, top = 0.98, hem = 0.39, kneeY = 0.56, legX = 0.117;
    const sm = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) * S, y = pos.getY(i) * S, z = pos.getZ(i) * S;
      if (y < hem || y > top) continue;
      const dLeg = Math.min(Math.hypot(x - legX, z), Math.hypot(x + legX, z));
      if (dLeg < 0.085) continue; // trouser leg inside the kameez
      const t = (top - y) / (top - hem), legW = 0.72 * t;
      const wl = sm(-0.09, 0.09, x), kn = sm(kneeY + 0.12, kneeY - 0.02, y);
      const w = [[H, 1 - legW], [LU, legW * wl * (1 - kn)], [LL, legW * wl * kn], [RU, legW * (1 - wl) * (1 - kn)], [RL, legW * (1 - wl) * kn]]
        .sort((a, b) => b[1] - a[1]).slice(0, 4);
      const sum = w.reduce((a, e) => a + e[1], 0);
      si.setXYZW(i, w[0][0], w[1][0], w[2][0], w[3][0]);
      sw.setXYZW(i, w[0][1] / sum, w[1][1] / sum, w[2][1] / sum, w[3][1] / sum);
    }
    si.needsUpdate = sw.needsUpdate = true;
  }

  // world quaternions/positions in rig.root space, with the rig in T-pose and Mixamo at bind
  captureBind() {
    const rig = this.rig, root = rig.root;
    const sp = root.position.clone(), sq = root.quaternion.clone();
    root.position.set(0, 0, 0); root.quaternion.identity();
    rig.body.position.set(0, PIV, 0); rig.body.quaternion.identity();
    for (const k in this.joints) if (k !== 'body') this.joints[k].quaternion.identity();
    rig.sh[0].quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
    rig.sh[1].quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), -Math.PI / 2);
    rig.armRestQ = [rig.sh[0].quaternion.clone(), rig.sh[1].quaternion.clone()];
    root.updateMatrixWorld(true);
    this.bMy = {}; this.bMix = {};
    for (const k in this.joints) this.bMy[k] = this.joints[k].getWorldQuaternion(new THREE.Quaternion());
    for (const n of ORDER) this.bMix[n] = this.B[n].getWorldQuaternion(new THREE.Quaternion());
    this.bMyBodyP = rig.body.getWorldPosition(new THREE.Vector3());
    this.bHipsP = this.B.Hips.getWorldPosition(new THREE.Vector3());
    this.hipsOff = this.bHipsP.clone().sub(this.bMyBodyP); // in body-bind space (identity)
    this.bindLocal = {}; for (const n of ORDER) this.bindLocal[n] = this.B[n].quaternion.clone();
    root.position.copy(sp); root.quaternion.copy(sq); root.updateMatrixWorld(true);
  }

  // ---------- animation selection ----------
  // loco: {idle, walk, run, walkTS, runTS}; one: {name, time} | null
  update(dt, loco, one) {
    this.undoLookUp();
    const k = 1 - Math.exp(-12 * dt);
    for (const n of this.LOCO) this.w[n] += ((loco[n.toLowerCase()] || 0) - this.w[n]) * k;
    this.actions.Walk.timeScale = loco.walkTS || 1; this.actions.Run.timeScale = loco.runTS || 1;
    if (this.sweep) {
      this.actions.Sweep.timeScale = loco.sweepTS ?? 1;
      if (loco.sweepHold) { // machines held still: ease back to the centre of the stroke (the start of the clip)
        const a = this.actions.Sweep, d = this.clips.Sweep.duration; let t = a.time % d; if (t > d / 2) t -= d;
        a.time = (t * Math.exp(-5 * dt) + d) % d;
      }
      this.sweepW += ((loco.sweepArms || 0) - this.sweepW) * k;   // arms + mop from the authored mopping
      this.upperW += ((loco.sweepUpper || 0) - this.upperW) * k;  // torso too, while walking with the mop down
      if (loco.sweepArms && this.sweepW > 0.02 && !this.sweepOn) this.actions.Sweep.time = 0; // start each mopping bout from the top
      this.sweepOn = !!loco.sweepArms;
    }
    if (one) {
      if (!this.one || this.one.name !== one.name) { if (this.one && this.one.name !== one.name) this.actions[this.one.name].setEffectiveWeight(0); this.one = { name: one.name }; }
      this.oneW = Math.min(1, this.oneW + dt / (one.fade ?? 0.07));
      const a = this.actions[one.name]; a.timeScale = 0; a.time = Math.min(one.time, this.clips[one.name].duration - 1e-3);
    } else this.oneW = Math.max(0, this.oneW - dt / 0.12);
    if (this.one) { this.actions[this.one.name].setEffectiveWeight(this.oneW); if (this.oneW <= 0) this.one = null; }
    const lw = 1 - (this.one ? this.oneW : 0), sum = this.LOCO.reduce((a, n) => a + this.w[n], 0) || 1;
    for (const n of this.LOCO) this.actions[n].setEffectiveWeight(lw * this.w[n] / sum);
    this.idleW = lw * this.w.Idle / sum;
    this.mixer.update(dt);
    if (this.sweep && this.upperW > 0.01) this.sweepTorso(this.upperW * lw);
    if (loco.stride && this.w.Run > 0.01) this.warpStride(1 + (loco.stride - 1) * lw * this.w.Run / sum);
    this.readClip();
    return this.clip;
  }

  // longer strides on the run, so the cycle can play back slower without the feet skating
  warpStride(s) {
    if (!this.runMean) {
      this.runMean = {};
      for (const n of ['LeftUpLeg', 'RightUpLeg', 'LeftLeg', 'RightLeg']) {
        const tr = this.clips.Run.tracks.find(t => t.name.endsWith(n + '.quaternion')); if (!tr || !this.B[n]) continue;
        const v = tr.values, acc = new THREE.Vector4(), q = new THREE.Quaternion(), ref = new THREE.Quaternion().fromArray(v, 0);
        for (let i = 0; i < v.length; i += 4) { q.fromArray(v, i); const sg = q.dot(ref) < 0 ? -1 : 1; acc.x += q.x * sg; acc.y += q.y * sg; acc.z += q.z * sg; acc.w += q.w * sg; }
        acc.normalize(); this.runMean[n] = new THREE.Quaternion(acc.x, acc.y, acc.z, acc.w);
      }
    }
    for (const n in this.runMean) {
      const k = /UpLeg/.test(n) ? s : 1 + (s - 1) * 0.5; // thighs swing further; knees fold a little more
      _q.copy(this.runMean[n]).slerp(this.B[n].quaternion, k); this.B[n].quaternion.copy(_q);
    }
  }

  // walking while mopping: legs + hips from the walk, torso from the authored mopping
  // (the torso is matched in root space, so the clip's hip turn carries over without turning the legs)
  sweepTorso(w) {
    const t = this.actions.Sweep.time, H = this.B.Hips;
    const hipsS = _q.fromArray(this.sweepUpper[0][1].evaluate(t)).normalize();
    // Spine: world(sweep) = hipsS * spineS  ->  local under the walking hips = hipsW^-1 * hipsS * spineS
    for (let i = 1; i < this.sweepUpper.length; i++) {
      const [n, ip] = this.sweepUpper[i]; const b = this.B[n]; if (!b || !ip) continue;
      _q2.fromArray(ip.evaluate(t)).normalize();
      if (n === 'Spine') _q2.premultiply(_q3.copy(H.quaternion).invert().multiply(hipsS));
      b.quaternion.slerp(_q2, w);
    }
  }

  rootSpaceQ(o, out) { o.getWorldQuaternion(out); return out.premultiply(_qi.copy(this.rig.root.quaternion).invert()); }

  // Mixamo pose (just set by the mixer) -> procedural joint targets
  readClip() {
    // keep the clip's own arm + finger rotations so authored poses can bypass the IK entirely
    if (!this.armBones) { this.armBones = []; for (const n in this.B) if (/Shoulder|Arm|Hand/.test(n)) this.armBones.push(this.B[n]); this.armClip = this.armBones.map(() => new THREE.Quaternion()); }
    for (let i = 0; i < this.armBones.length; i++) this.armClip[i].copy(this.armBones[i].quaternion);
    // arms from the authored idle at its current time (so walking keeps the idle hold)
    if (this.mopT) {
      if (!this.idleArm) { this.idleArm = []; const tr = this.clips.Idle.tracks;
        this.armBones.forEach((b, i) => { const t = tr.find(x => x.name === b.name + '.quaternion'); if (t) this.idleArm.push([i, t.createInterpolant()]); }); }
      const it = this.actions.Idle.time;
      for (const [i, ip] of this.idleArm) this.armClip[i].fromArray(ip.evaluate(it)).normalize();
    }
    // ...and from the authored mopping while he mops
    if (this.sweep && this.sweepW > 0.001) {
      if (!this.sweepArm) { this.sweepArm = []; const tr = this.clips.Sweep.tracks;
        this.armBones.forEach((b, i) => { const t = tr.find(x => x.name === b.name + '.quaternion'); if (t) this.sweepArm.push([i, t.createInterpolant()]); }); }
      const st = this.actions.Sweep.time;
      for (const [i, ip] of this.sweepArm) this.armClip[i].slerp(_q.fromArray(ip.evaluate(st)).normalize(), this.mopT ? this.sweepW : 1);
    }
    this.holder.updateMatrixWorld(true);
    const W = {}, C = this.clip;
    for (const [j, n] of MAP) {
      const qm = this.rootSpaceQ(this.B[n], new THREE.Quaternion());
      W[j] = qm.multiply(_q.copy(this.bMix[n]).invert()).multiply(this.bMy[j]); // delta from bind applied to our bind
    }
    C.body.copy(W.body);
    for (const j in this.parentOf) C[j].copy(W[this.parentOf[j]]).invert().multiply(W[j]);
    // body position: hips minus the (rotated) bind offset
    this.B.Hips.getWorldPosition(_v); this.rig.root.worldToLocal(_v);
    const D = _q.copy(W.body).multiply(_q2.copy(this.bMy.body).invert());
    C.bodyP.copy(_v).sub(this.hipsOff.clone().applyQuaternion(D));
  }

  // procedural rig (after IK) -> Mixamo bones
  write(gripAmount = 1, authW = 0) {
    const D = {};
    for (const [j] of MAP) D[j] = this.rootSpaceQ(this.joints[j], new THREE.Quaternion()).multiply(_q.copy(this.bMy[j]).invert());
    const target = {};
    for (const [j, n] of MAP) target[n] = D[j].clone().multiply(this.bMix[n]);
    for (const [n, src] of DERIVED) {
      const d = src.length === 2 ? D[src[0]].clone().slerp(D[src[1]], 0.5) : D[src[0]];
      target[n] = d.clone().multiply(this.bMix[n]);
    }
    const worldQ = {};
    for (const n of ORDER) {
      const b = this.B[n], pn = b.parent && b.parent.isBone ? b.parent.name.replace(/^mixamorig:?/, '') : null;
      const pw = pn && worldQ[pn] ? worldQ[pn] : this.rootSpaceQ(b.parent, new THREE.Quaternion());
      b.quaternion.copy(pw).invert().multiply(target[n]);
      worldQ[n] = target[n];
    }
    // hips position
    _v.copy(this.hipsOff).applyQuaternion(D.body).add(this.rig.body.getWorldPosition(new THREE.Vector3()).applyMatrix4(_m.copy(this.rig.root.matrixWorld).invert()));
    this.rig.root.localToWorld(_v); this.B.Hips.parent.worldToLocal(_v); this.B.Hips.position.copy(_v);
    // fingers curl around the mop handle
    const g = gripAmount;
    for (const f of this.fingers) {
      const amt = (f.f === 'Thumb' ? 0.5 : 1.0) * (f.i === 1 ? 0.9 : 1.1) * g;
      _q2.setFromAxisAngle(FINGER_AXIS[f.side], amt * (f.f === 'Thumb' ? 0.6 : 1));
      f.b.quaternion.copy(f.rest).multiply(_q2);
    }
    // authored animation (posed in Blender with the mop): arms and fingers exactly as animated
    if (authW > 0.001) for (let i = 0; i < this.armBones.length; i++) this.armBones[i].quaternion.slerp(this.armClip[i], authW);
    this.holder.updateMatrixWorld(true);
  }
}
// place the mop exactly where it was in the authored animation (relative to the right hand bone)
const _mp = new THREE.Vector3(), _mq = new THREE.Quaternion(), _md = new THREE.Vector3(), _flip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI), _rq = new THREE.Quaternion();
// tip his head up a little (neck + head pitch, in bone space), a = radians
const _lx = new THREE.Vector3(1, 0, 0), _lq = new THREE.Quaternion();
MixamoBody.prototype.lookUp = function (a) {
  this._look = 0;
  if (Math.abs(a) < 0.001) return;
  if (this.B.Neck) this.B.Neck.quaternion.multiply(_lq.setFromAxisAngle(_lx, -a * 0.4));
  if (this.B.Head) this.B.Head.quaternion.multiply(_lq.setFromAxisAngle(_lx, -a * 0.6));
  this._look = a;
};
// take the tilt back off before the next frame's clip read. (When a clip holds a bone perfectly still the mixer
// doesn't rewrite it, so the tilt used to be read back as part of the pose and pile up: his head turned right over.)
MixamoBody.prototype.undoLookUp = function () {
  const a = this._look; if (!a) return; this._look = 0;
  if (this.B.Neck) this.B.Neck.quaternion.multiply(_lq.setFromAxisAngle(_lx, a * 0.4));
  if (this.B.Head) this.B.Head.quaternion.multiply(_lq.setFromAxisAngle(_lx, a * 0.6));
};
// an extra one-shot clip (e.g. the dodge roll), played by name through update(..., one)
MixamoBody.prototype.addClip = function (json) {
  const c = THREE.AnimationClip.parse(json); this.clips[c.name] = c;
  const a = this.mixer.clipAction(c); a.play(); a.setEffectiveWeight(0); this.actions[c.name] = a;
};
MixamoBody.prototype.placeAuthoredMop = function (weapon, root, w) {
  if (w <= 0.001 || !(this.mopT || this.sweep)) return;
  const len = weapon.userData.len, sw = this.sweep ? this.sweepW : 0;
  if (this.mopT && sw < 0.999) {
    const H = this.B.RightHand; H.updateMatrixWorld(true);
    _mp.copy(this.mopT).applyMatrix4(H.matrixWorld);                 // grip point (placeholder origin)
    _mq.copy(H.getWorldQuaternion(_rq)).multiply(this.mopQ);         // placeholder orientation
    _md.set(0, -1, 0).applyQuaternion(_mq);                          // handle runs down -Y toward the head
    _mp.addScaledVector(_md, len / 2 - 0.16 * len / 1.3);            // grip -> handle centre
    _mq.multiply(_flip);                                             // game mop: +Y toward the head
  }
  if (sw > 0.001) {
    // the mopping mop is stored in the game's own mop frame (handle centre, +Y toward the head)
    const H = this.B[this.sweep.hand]; H.updateMatrixWorld(true);
    _sp.copy(this.sweep.t).applyMatrix4(H.matrixWorld);
    _sq.copy(H.getWorldQuaternion(_rq)).multiply(this.sweep.q);
    if (this.mopT && sw < 0.999) { _mp.lerp(_sp, sw); _mq.slerp(_sq, sw); } else { _mp.copy(_sp); _mq.copy(_sq); }
  }
  root.worldToLocal(_mp); _rq.copy(root.getWorldQuaternion(new THREE.Quaternion())).invert().multiply(_mq);
  weapon.position.lerp(_mp, w); weapon.quaternion.slerp(_rq, w); weapon.updateMatrixWorld(true);
};
const _sp = new THREE.Vector3(), _sq = new THREE.Quaternion();
const _m = new THREE.Matrix4();
export const FINGER_AXIS = { Left: new THREE.Vector3(0, 0, 1), Right: new THREE.Vector3(0, 0, -1) };
