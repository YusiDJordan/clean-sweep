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

// split every edge of the skirt's triangles (and the matching edges of its neighbours, so no cracks open up)
function refineSkirt(g) {
  const A = g.attributes, idx = g.index.array, sk = A.aSkirt, n0 = A.position.count;
  const tri = idx.length / 3, split = new Map(), key = (a, b) => a < b ? a * 1e7 + b : b * 1e7 + a;
  for (let t = 0; t < tri; t++) { const v = [idx[3 * t], idx[3 * t + 1], idx[3 * t + 2]];
    if (v.some(i => sk.getY(i) > 0 || sk.getX(i) > 0)) for (let e = 0; e < 3; e++) split.set(key(v[e], v[(e + 1) % 3]), -1); }
  const names = Object.keys(A), out = {}; let n = n0;
  for (const k of names) out[k] = Array.from(A[k].array);
  const mid = (a, b) => {
    const kk = key(a, b); let m = split.get(kk); if (m === undefined) return -1; if (m >= 0) return m;
    m = n++; split.set(kk, m);
    for (const k of names) { const sz = A[k].itemSize, o = out[k];
      if (k === 'skinIndex') continue;
      if (k === 'skinWeight') { // the bones of both ends, the strongest four, renormalised
        const w = {}; for (const [v, f] of [[a, 0.5], [b, 0.5]]) for (let j = 0; j < 4; j++) { const bi = out.skinIndex[v * 4 + j], bw = out.skinWeight[v * 4 + j] * f; if (bw > 0) w[bi] = (w[bi] || 0) + bw; }
        const top = Object.entries(w).sort((x, y) => y[1] - x[1]).slice(0, 4); while (top.length < 4) top.push([0, 0]);
        const sum = top.reduce((x, e) => x + e[1], 0) || 1;
        for (let j = 0; j < 4; j++) { out.skinIndex.push(+top[j][0]); o.push(top[j][1] / sum); }
        continue;
      }
      for (let j = 0; j < sz; j++) o.push((o[a * sz + j] + o[b * sz + j]) / 2);
      if (k === 'normal') { const i = m * 3, l = Math.hypot(o[i], o[i + 1], o[i + 2]) || 1; o[i] /= l; o[i + 1] /= l; o[i + 2] /= l; }
    }
    return m;
  };
  const ni = [];
  for (let t = 0; t < tri; t++) {
    const [a, b, c] = [idx[3 * t], idx[3 * t + 1], idx[3 * t + 2]], ab = mid(a, b), bc = mid(b, c), ca = mid(c, a), k = (ab >= 0) + (bc >= 0) + (ca >= 0);
    if (k === 0) ni.push(a, b, c);
    else if (k === 3) ni.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
    else if (k === 1) { if (ab >= 0) ni.push(a, ab, c, ab, b, c); else if (bc >= 0) ni.push(a, b, bc, a, bc, c); else ni.push(a, b, ca, ca, b, c); }
    else { // two edges: a corner triangle and a quad
      if (ab < 0) ni.push(c, ca, bc, ca, a, b, ca, b, bc);
      else if (bc < 0) ni.push(a, ab, ca, ab, b, c, ab, c, ca);
      else ni.push(b, bc, ab, a, ab, c, ab, bc, c);
    }
  }
  for (const k of names) { const old = A[k], Arr = old.array.constructor; g.setAttribute(k, new THREE.BufferAttribute(new Arr(out[k]), old.itemSize, old.normalized)); }
  g.setIndex(ni);
}

// cloth: skin the kameez as usual, then let the hem swing and push it out of the leg capsules
const _cm = new THREE.Matrix4(), _cv = new THREE.Vector3(), _cv2 = new THREE.Vector3(), _cv3 = new THREE.Vector3(), _cq = new THREE.Quaternion();
// (one set of cloth uniforms, shared by every material that draws Karim: his own, his shadow, and the AO pass)
let CLOTH_U = null;
export function clothify(mat, faceCam = false) { clothHook(mat, faceCam); return mat; }
function clothHook(mat, faceCam = false) {
  const U = CLOTH_U || (CLOTH_U = { uCapA: { value: [0, 1, 2, 3, 4, 5].map(() => new THREE.Vector3()) }, uCapB: { value: [0, 1, 2, 3, 4, 5].map(() => new THREE.Vector3()) }, uCapR: { value: [0, 0, 0, 0, 0, 0] },
    uPivot: { value: new THREE.Vector3() }, uSway: { value: new THREE.Vector3() }, uTwist: { value: 0 }, uCardZ: { value: 0.12 } });
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
attribute vec2 aSkirt; attribute float aHide; attribute float aKarim; varying float vHide; uniform vec3 uCapA[6]; uniform vec3 uCapB[6]; uniform float uCapR[6]; uniform vec3 uPivot; uniform vec3 uSway; uniform float uTwist; uniform float uCardZ;`)
      .replace('#include <skinning_vertex>', `#include <skinning_vertex>
vHide = aHide;
if (aSkirt.y > 0.0) {
  vec3 rel = transformed - uPivot; float ta = uTwist * aSkirt.y, tc = cos(ta), ts = sin(ta);
  rel.xz = vec2(tc * rel.x - ts * rel.z, ts * rel.x + tc * rel.z);
  transformed = uPivot + rel + uSway * aSkirt.y;
}
if (aSkirt.x > 0.0) for (int i = 0; i < 6; i++) {
  vec3 ab = uCapB[i] - uCapA[i]; float h = clamp(dot(transformed - uCapA[i], ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
  vec3 cp = uCapA[i] + ab * h, d = transformed - cp; float L = length(d);
  if (L < uCapR[i] && L > 1e-5) transformed = mix(transformed, cp + d * (uCapR[i] / L), aSkirt.x);
}`);
    // (for the AO's normal pass: the reshaped kameez reports itself as facing the camera, since its stored normals no
    // longer match its shape and would read as deep creases)
    // (in the AO pass Karim is flattened to a card facing the camera at his own depth: he still hides what's behind
    // him, but has no folds of his own for the AO to darken)
    if (faceCam) sh.vertexShader = sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\nif (aKarim > 0.5) { vec4 pz = modelViewMatrix * vec4(uPivot, 1.0); float fz = pz.z + uCardZ; mvPosition.xy *= fz / mvPosition.z; mvPosition.z = fz; gl_Position = projectionMatrix * mvPosition; /* (slid along the line of sight, so he lands on exactly the same pixels) */\n#ifndef FLAT_SHADED\nvNormal = vec3(0.0, 0.0, 1.0);\n#endif\n}');
    sh.fragmentShader = 'varying float vHide;\n' + sh.fragmentShader
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (vHide > 0.5) discard;');
  };
  const base = mat.customProgramCacheKey.bind(mat); mat.customProgramCacheKey = () => base() + 'karimCloth' + (faceCam ? 'F' : '');
  return U;
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
        this.clothU = clothHook(o.material);
        // (his shadow takes the same shape, so it doesn't show the legs through the dress)
        o.customDepthMaterial = clothify(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }));
        o.customDistanceMaterial = clothify(new THREE.MeshDistanceMaterial());
        o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; o.userData.noProbe = true; o.userData.keep = true;
        this.mesh = o;
      }
    });
    this.reweightKameez();
    for (let k = 0; k < 2; k++) refineSkirt(this.mesh.geometry); // (finer skirt, so the leg capsules have enough cloth to push)
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
    const S = KARIM_SCALE, top = 0.98, hem = 0.39, kneeY = 0.56, legX = 0.117, HIDE_Y = 0.5;
    const sm = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
    const cloth = new Float32Array(pos.count * 2); // (per vertex: [kept off the legs, how freely the hem swings])
    g.setAttribute('aSkirt', new THREE.BufferAttribute(cloth, 2));
    // the thighs never show (the kameez always covers them), so they aren't drawn at all: nothing left to poke through
    const hide = new Float32Array(pos.count); g.setAttribute('aHide', new THREE.BufferAttribute(hide, 1));
    g.setAttribute('aKarim', new THREE.BufferAttribute(new Float32Array(pos.count).fill(1), 1)); // (marks his vertices, for the AO pass)
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) * S, y = pos.getY(i) * S, z = pos.getZ(i) * S;
      if (y < hem - 0.02 || y > top) continue;
      const dLeg = Math.min(Math.hypot(x - legX, z), Math.hypot(x + legX, z));
      if (dLeg < 0.085) { if (y > HIDE_Y) hide[i] = 1; continue; } // trouser leg inside the kameez (above the knee: hidden)
      const dn = (top - y) / (top - hem);
      cloth[i * 2] = sm(top, top - 0.1, y); cloth[i * 2 + 1] = Math.pow(Math.min(1, dn), 1.6);
      if (y < hem) continue;
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

  // the kameez as cloth (cheaply): each thigh and shin is an invisible capsule the skirt is pushed out of
  // (so the legs never poke through), and the hem swings on a spring as he moves and turns
  updateCloth(dt) {
    const U = this.clothU, m = this.mesh; if (!U || !m) return;
    dt = Math.min(Math.max(dt, 1e-4), 1 / 20);
    m.updateMatrixWorld(true);
    const inv = _cm.copy(m.matrixWorld).invert(), sc = m.matrixWorld.getMaxScaleOnAxis();
    const P = (n, out) => this.B[n].getWorldPosition(out).applyMatrix4(inv);
    const legs = [['LeftUpLeg', 'LeftLeg', 0.11], ['LeftLeg', 'LeftFoot', 0.092], ['RightUpLeg', 'RightLeg', 0.11], ['RightLeg', 'RightFoot', 0.092], ['LeftFoot', 'LeftToeBase', 0.08], ['RightFoot', 'RightToeBase', 0.08]];
    legs.forEach(([a, b, r], i) => { P(a, U.uCapA.value[i]); P(b, U.uCapB.value[i]); if (i % 2 === 0 && i < 4) U.uCapA.value[i].lerp(U.uCapB.value[i], 0.12); U.uCapR.value[i] = r / sc; }); // (thighs start a little below the hip joint, so the hips don't puff out)
    // the hem trails the hips: a damped spring on its offset and on its twist
    const hp = this.B.Hips.getWorldPosition(_cv);
    P('Hips', U.uPivot.value);
    U.uCardZ.value += ((G.barrow && G.barrow.held ? -1.1 : 0.12) - U.uCardZ.value) * Math.min(1, dt * 8); // (pushing the barrow: his AO card sits behind it, so it can't shade the tray in front of him)
    const c = this.cloth || (this.cloth = { p: hp.clone(), v: new THREE.Vector3(), o: new THREE.Vector3(), ov: new THREE.Vector3(), yaw: null, w: 0, th: 0, tw: 0 });
    const v = _cv2.copy(hp).sub(c.p).divideScalar(dt).setY(0); c.p.copy(hp);
    if (v.length() > 12) v.set(0, 0, 0); // (a teleport: the lift, a level change)
    const acc = _cv3.copy(v).sub(c.v).divideScalar(dt); c.v.copy(v);
    if (acc.length() > 80) acc.setLength(80);
    c.ov.addScaledVector(c.o, -140 * dt).addScaledVector(c.ov, -11 * dt).addScaledVector(acc, -0.55 * dt);
    c.o.addScaledVector(c.ov, dt); if (c.o.length() > 0.13) c.o.setLength(0.13);
    const f = _cv2.set(0, 0, 1).applyQuaternion(this.B.Hips.getWorldQuaternion(_cq)), yaw = Math.atan2(f.x, f.z);
    if (c.yaw === null) c.yaw = yaw;
    let dy = yaw - c.yaw; dy -= Math.round(dy / (2 * Math.PI)) * 2 * Math.PI; c.yaw = yaw;
    const w = dy / dt, al = Math.max(-400, Math.min(400, (w - c.w) / dt)); c.w = w;
    c.tw += (-130 * c.th - 10 * c.tw - al * 0.5) * dt; c.th = Math.max(-0.55, Math.min(0.55, c.th + c.tw * dt));
    // into the mesh's own space
    U.uSway.value.copy(c.o).transformDirection(inv).multiplyScalar(c.o.length() / sc);
    U.uTwist.value = c.th;
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
    if (this.mopT && !this.authOne) {
      if (!this.idleArm) { this.idleArm = []; const tr = this.clips.Idle.tracks;
        this.armBones.forEach((b, i) => { const t = tr.find(x => x.name === b.name + '.quaternion'); if (t) this.idleArm.push([i, t.createInterpolant()]); }); }
      const it = this.actions.Idle.time;
      const k = this.one && this.authFade ? 1 - this.oneW : 1; // (out of an authored move: from its last pose into the idle hold)
      for (const [i, ip] of this.idleArm) { _q.fromArray(ip.evaluate(it)).normalize(); if (k >= 1) this.armClip[i].copy(_q); else this.armClip[i].slerp(_q, k * k * (3 - 2 * k)); }
    }
    // ...and from the authored mopping while he mops
    if (this.sweep && this.sweepW > 0.001 && !this.authOne) {
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
