// Procedural stand-in characters: jointed humanoid with 2-bone IK arms/legs, cheap robe cloth, mop & rifle
import * as THREE from 'three';
import { fabricTex } from './textures.js';
import { clamp } from './state.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { addMopPole } from './tools.js';

const DOWN = new THREE.Vector3(0, -1, 0), UP = new THREE.Vector3(0, 1, 0);
const UA = 0.29, FA = 0.27, TH = 0.44, SH = 0.44, PIVOT = 0.95;
export const RIG = { PIVOT };

let MAT = null;
function mats() {
  if (MAT) return MAT;
  const std = (o) => new THREE.MeshStandardMaterial(Object.assign({ roughness: 0.75, metalness: 0 }, o));
  MAT = {
    robe: std({ map: fabricTex('#f2eee6', 'rgba(0,0,0,0.035)'), roughness: 0.85 }),
    kufi: std({ map: fabricTex('#fbfbf7', 'rgba(0,0,0,0.08)'), roughness: 0.9 }),
    skin: std({ color: 0xa9765a, roughness: 0.6 }),
    beard: std({ color: 0x8e8a86, roughness: 0.95 }),
    hairDark: std({ color: 0x2a2522, roughness: 0.9 }),
    shoe: std({ color: 0x3b2c22, roughness: 0.6 }),
    eye: std({ color: 0x111111, roughness: 0.3 }),
    black: std({ color: 0x18191c, roughness: 0.85 }),
    pants: std({ color: 0x23252a, roughness: 0.85 }),
    vest: std({ color: 0x5a5440, roughness: 0.8 }),
    vestDark: std({ color: 0x3a3a30, roughness: 0.8 }),
    boot: std({ color: 0x141414, roughness: 0.5 }),
    gun: std({ color: 0x1c1d20, roughness: 0.45, metalness: 0.6 }),
    gunTan: std({ color: 0x8a7a5c, roughness: 0.7 }),
    wood: std({ color: 0xc08a50, roughness: 0.45 }),
    metal: std({ color: 0xb0b4b8, roughness: 0.3, metalness: 1 }),
    mopHead: std({ color: 0xe6e0cf, roughness: 0.95 }),
    helmet: std({ color: 0x2c2f2a, roughness: 0.6 }),
    laser: new THREE.MeshBasicMaterial({ color: 0xff2a1a, toneMapped: false }),
  };
  return MAT;
}

function mesh(geo, mat, parent, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
}
const cap = (r, len) => { const g = new THREE.CapsuleGeometry(r, Math.max(0.001, len - 2 * r), 4, 10); g.translate(0, -len / 2, 0); return g; };

export class Rig {
  constructor(kind = 'custodian', dims = {}) {
    const M = mats();
    this.kind = kind;
    const D = this.D = Object.assign({ UA, FA, TH, SH, shX: 0.2, shY: 0.14, hipX: 0.1, hipY: -0.04, spineY: 0.08, chestY: 0.3, neckY: 0.2, headY: 0.13 }, dims);
    this.armRestQ = [null, null];
    this.root = new THREE.Group();
    this.body = new THREE.Group(); this.body.position.y = PIVOT; this.root.add(this.body);
    this.spine = new THREE.Group(); this.spine.position.y = D.spineY; this.body.add(this.spine);
    this.chest = new THREE.Group(); this.chest.position.y = D.chestY; this.spine.add(this.chest);
    this.neck = new THREE.Group(); this.neck.position.y = D.neckY; this.chest.add(this.neck);
    this.sh = [], this.el = [], this.hand = [], this.hip = [], this.knee = [], this.foot = [];
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1; // 0 = left (+x), 1 = right (-x)
      const s = new THREE.Group(); s.position.set(D.shX * side, D.shY, 0); this.chest.add(s);
      const e = new THREE.Group(); e.position.y = -D.UA; s.add(e);
      const h = new THREE.Group(); h.position.y = -D.FA; e.add(h);
      const hp = new THREE.Group(); hp.position.set(D.hipX * side, D.hipY, 0); this.body.add(hp);
      const k = new THREE.Group(); k.position.y = -D.TH; hp.add(k);
      const f = new THREE.Group(); f.position.y = -D.SH; k.add(f);
      this.sh.push(s); this.el.push(e); this.hand.push(h); this.hip.push(hp); this.knee.push(k); this.foot.push(f);
    }
    if (kind === 'custodian') this.buildCustodian(M); else this.buildRobber(M, kind === 'heavy');
    this.root.traverse(o => { if (o.isMesh) o.userData.isChar = true; });
    this.footRest = [new THREE.Vector3(D.hipX, D.hipY - D.TH - D.SH, 0), new THREE.Vector3(-D.hipX, D.hipY - D.TH - D.SH, 0)];
    this.sway = new THREE.Vector3(); this.swayV = new THREE.Vector3(); this.spin = 0;
  }

  buildCustodian(M) {
    // torso (thobe)
    const torso = new THREE.CylinderGeometry(0.17, 0.2, 0.56, 16); torso.translate(0, 0.2, 0);
    const t = mesh(torso, M.robe, this.spine); t.scale.z = 0.72;
    const shoulders = mesh(new THREE.SphereGeometry(0.21, 16, 10), M.robe, this.chest, 0, 0.06, 0); shoulders.scale.set(1.05, 0.55, 0.72);
    // collar + neck
    mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.12, 10), M.skin, this.neck, 0, 0.0, 0);
    // head
    this.head = new THREE.Group(); this.head.position.y = this.D.headY; this.neck.add(this.head);
    const hd = mesh(new THREE.SphereGeometry(0.105, 18, 14), M.skin, this.head); hd.scale.set(0.92, 1.08, 1.0);
    const beard = mesh(new THREE.SphereGeometry(0.1, 16, 12), M.beard, this.head, 0, -0.045, 0.025); beard.scale.set(0.9, 0.85, 0.9);
    mesh(new THREE.SphereGeometry(0.014, 6, 6), M.eye, this.head, 0.035, 0.02, 0.092); mesh(new THREE.SphereGeometry(0.014, 6, 6), M.eye, this.head, -0.035, 0.02, 0.092);
    const nose = mesh(new THREE.ConeGeometry(0.02, 0.05, 6), M.skin, this.head, 0, 0.0, 0.105); nose.rotation.x = Math.PI / 2;
    const kufi = mesh(new THREE.CylinderGeometry(0.098, 0.106, 0.075, 18), M.kufi, this.head, 0, 0.075, -0.005);
    mesh(new THREE.SphereGeometry(0.098, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), M.kufi, this.head, 0, 0.11, -0.005).scale.y = 0.35;
    // arms (sleeves) + hands
    for (let i = 0; i < 2; i++) {
      mesh(cap(0.058, UA + 0.04), M.robe, this.sh[i], 0, 0.02, 0);
      mesh(cap(0.05, FA), M.robe, this.el[i]);
      mesh(new THREE.SphereGeometry(0.045, 10, 8), M.skin, this.hand[i], 0, 0.0, 0).scale.set(0.8, 1.1, 1);
      this.legMeshes = this.legMeshes || [];
      this.legMeshes.push(mesh(cap(0.05, TH), M.robe, this.hip[i]), mesh(cap(0.045, SH), M.robe, this.knee[i]));
      const shoe = mesh(new THREE.BoxGeometry(0.09, 0.06, 0.24), M.shoe, this.foot[i], 0, -0.045, 0.05);
    }
    // robe skirt (cheap cloth: driven by legs + inertia)
    const g = new THREE.CylinderGeometry(0.2, 0.36, 0.9, 22, 7, true);
    g.translate(0, 0.07 - 0.45, 0);
    this.skirt = mesh(g, M.robe, this.body);
    this.skirt.material = M.robe.clone(); this.skirt.material.side = THREE.DoubleSide;
    this.skirtRest = Float32Array.from(g.attributes.position.array);
    this.skirtTop = 0.07; this.skirtH = 0.9;
    // mop
    this.weapon = this.buildMop(M);
    this.root.add(this.weapon);
    this.gripOffsets = [0.0, -0.36]; // left hand, right hand along weapon axis
  }

  buildMop(M) {
    const g = new THREE.Group();
    const ML = 1.16; // mop handle length (matches the mop Yusuf posed in Blender)
    addMopPole(g, ML); // blue plastic pole with a black grip (tools.js)
    const tassel = new THREE.Group(); tassel.position.y = ML / 2 + 0.025; g.add(tassel);
    // 40 strands, each a 4-segment chain (verlet physics), drawn as one instanced mesh
    const NS = 40, SEG = 6;
    const segGeo = new THREE.CylinderGeometry(0.0095, 0.0115, 1, 7, 1); segGeo.translate(0, 0.5, 0);
    const inst = new THREE.InstancedMesh(segGeo, M.mopHead, NS * SEG);
    inst.castShadow = true; inst.receiveShadow = true; inst.frustumCulled = false; inst.userData.isChar = true;
    g.add(inst);
    const strands = [], _m4 = new THREE.Matrix4(), _qq = new THREE.Quaternion(), _sc = new THREE.Vector3();
    for (let i = 0; i < NS; i++) {
      const a = (i / NS) * Math.PI * 2 + (Math.random() - 0.5) * 0.25, r = 0.008 + (i % 3) * 0.011 + Math.random() * 0.005;
      const base = new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
      const dir = new THREE.Vector3(Math.cos(a) * (0.18 + r * 4), 1, Math.sin(a) * (0.18 + r * 4)).normalize();
      const L = 0.21 + Math.random() * 0.06;
      strands.push({ base, dir, seg: L / SEG, p: null, o: null, stiff: [0.32 + Math.random() * 0.1, 0.09, 0.045, 0.025, 0.014, 0.008] });
      // rest pose so the mop looks right before the first physics step
      for (let j = 0; j < SEG; j++) {
        const p0 = base.clone().addScaledVector(dir, (L / SEG) * j).add(tassel.position);
        _qq.setFromUnitVectors(UP, dir); _m4.compose(p0, _qq, _sc.set(1, L / SEG, 1)); inst.setMatrixAt(i * SEG + j, _m4);
      }
    }
    this.tassel = tassel; this.strands = strands; this.strandMesh = inst; this.SEG = SEG;
    this.mopHeadMat = M.mopHead;
    g.userData.len = ML;
    return g;
  }

  buildRobber(M, heavy) {
    const bulk = heavy ? 1.18 : 1;
    const torso = new THREE.CylinderGeometry(0.17 * bulk, 0.17, 0.56, 14); torso.translate(0, 0.2, 0);
    mesh(torso, M.black, this.spine).scale.z = 0.7;
    const vg = [new THREE.BoxGeometry(0.36 * bulk, 0.36, 0.27 * bulk).translate(0, 0.28, 0)];
    for (let i = -1; i <= 1; i++) vg.push(new THREE.BoxGeometry(0.085, 0.1, 0.05).translate(i * 0.105, 0.19, 0.15 * bulk));
    vg.push(new THREE.BoxGeometry(0.06, 0.05, 0.3 * bulk).translate(0.13 * bulk, 0.44, 0), new THREE.BoxGeometry(0.06, 0.05, 0.3 * bulk).translate(-0.13 * bulk, 0.44, 0));
    mesh(mergeGeometries(vg), heavy ? M.vestDark : M.vest, this.spine);
    mesh(new THREE.SphereGeometry(0.2 * bulk, 14, 10), M.black, this.chest, 0, 0.06, 0).scale.set(1.05, 0.55, 0.72);
    mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.12, 12), M.black, this.body, 0, 0.05, 0).scale.z = 0.75; // hips
    mesh(new THREE.CylinderGeometry(0.06, 0.065, 0.12, 10), M.black, this.neck);
    this.head = new THREE.Group(); this.head.position.y = this.D.headY; this.neck.add(this.head);
    const hd = mesh(new THREE.SphereGeometry(0.108, 16, 12), M.black, this.head); hd.scale.set(0.95, 1.08, 1.02);
    mesh(new THREE.BoxGeometry(0.13, 0.035, 0.04), M.skin, this.head, 0, 0.02, 0.085);
    if (heavy) { const h = mesh(new THREE.SphereGeometry(0.125, 16, 10, 0, Math.PI * 2, 0, Math.PI / 1.8), M.helmet, this.head, 0, 0.02, -0.005); }
    for (let i = 0; i < 2; i++) {
      mesh(cap(0.06 * bulk, UA + 0.04), M.black, this.sh[i], 0, 0.02, 0);
      mesh(cap(0.052 * bulk, FA), M.black, this.el[i]);
      mesh(new THREE.SphereGeometry(0.048, 10, 8), M.black, this.hand[i]).scale.set(0.8, 1.1, 1);
      mesh(cap(0.075 * bulk, TH), M.pants, this.hip[i]);
      mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), M.vestDark, this.knee[i], 0, 0, 0.04); // knee pad
      mesh(cap(0.06 * bulk, SH), M.pants, this.knee[i]);
      mesh(new THREE.BoxGeometry(0.11, 0.09, 0.26), M.boot, this.foot[i], 0, -0.04, 0.05);
    }
    this.weapon = this.buildRifle(M, heavy);
    this.root.add(this.weapon);
    this.gripOffsets = [0.3, 0]; // left (foregrip), right (pistol grip)
  }

  buildRifle(M, heavy) {
    const g = new THREE.Group();
    const dark = [
      new THREE.BoxGeometry(0.06, 0.34, 0.09).translate(0, 0.12, 0.03), // receiver
      new THREE.CylinderGeometry(0.014, 0.014, 0.36, 6).translate(0, 0.45, 0.04), // barrel
      new THREE.BoxGeometry(0.04, 0.08, 0.17).rotateX(0.25).translate(0, 0.13, -0.08), // magazine
      new THREE.BoxGeometry(0.04, 0.05, 0.1).translate(0, 0.0, -0.04), // grip
      new THREE.BoxGeometry(0.03, 0.05, 0.03).translate(0, 0.3, 0.1), // laser module
    ];
    const furn = [new THREE.BoxGeometry(0.05, 0.22, 0.07).translate(0, 0.37, 0.035), new THREE.BoxGeometry(0.05, 0.2, 0.08).translate(0, -0.13, 0.02)];
    if (heavy) dark.push(...furn);
    mesh(mergeGeometries(dark), M.gun, g);
    if (!heavy) mesh(mergeGeometries(furn), M.gunTan, g);
    g.userData.muzzle = new THREE.Vector3(0, 0.64, 0.04);
    g.userData.laser = new THREE.Vector3(0, 0.33, 0.115);
    g.userData.len = 0.8;
    return g;
  }

  // ---------- per-frame pose application ----------
  // pose: { pivotY, bodyRot:Euler, spine:[x,y,z], chest:[x,y,z], head:[x,y], wC, wD, wRoll, feet:[v,v]|null, legFK:{t:[a,a],k:[a,a]}, armFK, handsFree }
  apply(pose, dt) {
    const b = this.body;
    b.position.set(0, pose.pivotY ?? PIVOT, 0);
    if (pose.bodyQ) b.quaternion.copy(pose.bodyQ); else b.quaternion.identity();
    const sp = pose.spine || [0, 0, 0], ch = pose.chest || [0, 0, 0], hd = pose.head || [0, 0];
    this.spine.rotation.set(sp[0], sp[1], sp[2]);
    this.chest.rotation.set(ch[0], ch[1], ch[2]);
    this.neck.rotation.set(hd[1] || 0, hd[0] || 0, 0);
    // animation clip (Mixamo) drives hips + torso when given
    const C = pose.clip;
    if (C && pose.clipW > 0) {
      const w = pose.clipW;
      b.position.lerp(C.bodyP, w); b.quaternion.slerp(C.body, w);
      this.spine.quaternion.slerp(C.spine, w); this.chest.quaternion.slerp(C.chest, w); this.neck.quaternion.slerp(C.neck, w);
    }
    this.root.updateMatrixWorld(true);
    // weapon: given relative to rest pivot in root space, carried by body rotation
    if (pose.wC && this.weapon.parent === this.root) {
      _c.copy(pose.wC); _d.copy(pose.wD).normalize();
      if (this.kind === 'custodian') { this.gripWant = pose.gripLow || 0; this.freeW = (this.freeW ?? 0) + ((pose.oneHand ? 1 : 0) - (this.freeW ?? 0)) * Math.min(1, dt * 10); this.fitWeapon(_c, _d, b.position.y); }
      _c.sub(_piv.set(0, PIVOT, 0)).applyQuaternion(b.quaternion).add(b.position);
      _d.applyQuaternion(b.quaternion);
      this.weapon.position.copy(_c);
      this.weapon.quaternion.setFromUnitVectors(UP, _d);
      if (pose.wRoll) { _qr.setFromAxisAngle(_d, pose.wRoll); this.weapon.quaternion.premultiply(_qr); }
      this.weapon.updateMatrixWorld(true);
    }
    // arms
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1;
      if (pose.armFK) {
        const a = pose.armFK[i];
        this.sh[i].rotation.set(a[0], a[1], a[2]); this.el[i].rotation.set(a[3], 0, 0);
        continue;
      }
      if (this.weapon.parent !== this.root || !pose.wC) { this.sh[i].rotation.set(0.1, 0, side * 0.15); this.el[i].rotation.set(-0.3, 0, 0); continue; }
      if (this.gripLocal) _t.copy(this.gripLocal[i]); else _t.set(0, this.gripOffsets[i], 0); this.weapon.localToWorld(_t);
      if (this.kind !== 'custodian' && i === 0) _t.add(_off.set(0, -0.0, 0));
      this.sh[i].getWorldPosition(_s);
      // aim the wrist short of the handle so the palm (not the wrist) wraps around it
      if (this.palmOff) { _off.copy(_t).sub(_s); const dl = _off.length(); if (dl > 0.1) _t.addScaledVector(_off, -this.palmOff / dl); }
      _p.set(side * 0.55, -0.55, -0.35).applyQuaternion(this.root.quaternion).add(_s);
      solve(this.sh[i], this.el[i], this.D.UA, this.D.FA, _t, _p, this.armRestQ[i]);
    }
    // one-handed rest: the left arm lets go and follows the idle animation
    if (C && this.freeW > 0.001 && !(pose.clipArmW > 0)) {
      this.sh[0].quaternion.slerp(C.sh0, this.freeW); this.el[0].quaternion.slerp(C.el0, this.freeW); this.hand[0].quaternion.slerp(C.hand0, this.freeW);
    }
    if (C && pose.clipArmW > 0) for (let i = 0; i < 2; i++) {
      this.sh[i].quaternion.slerp(C['sh' + i], pose.clipArmW); this.el[i].quaternion.slerp(C['el' + i], pose.clipArmW); this.hand[i].quaternion.slerp(C['hand' + i], pose.clipArmW);
    }
    // legs
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1;
      if (pose.legFK) {
        const L = pose.legFK;
        this.hip[i].rotation.set(L.t[i], 0, (L.s ? L.s[i] : 0)); this.knee[i].rotation.set(L.k[i], 0, 0); this.foot[i].rotation.set(0, 0, 0);
        continue;
      }
      _t.copy(pose.feet[i]); this.root.localToWorld(_t);
      this.hip[i].getWorldPosition(_s);
      _p.set(side * 0.12, 0.2, 1.0).applyQuaternion(this.root.quaternion).add(_s);
      solve(this.hip[i], this.knee[i], this.D.TH, this.D.SH, _t, _p);
      // keep foot flat & facing root forward
      this.knee[i].getWorldQuaternion(_q1).invert();
      _q2.copy(this.root.quaternion);
      if (pose.footYaw) { _qr.setFromAxisAngle(UP, pose.footYaw[i]); _q2.multiply(_qr); }
      this.foot[i].quaternion.copy(_q1.multiply(_q2));
    }
    if (C && pose.clipLegW > 0) for (let i = 0; i < 2; i++) {
      this.hip[i].quaternion.slerp(C['hip' + i], pose.clipLegW); this.knee[i].quaternion.slerp(C['knee' + i], pose.clipLegW); this.foot[i].quaternion.slerp(C['foot' + i], pose.clipLegW);
    }
    this.root.updateMatrixWorld(true);
    if (this.skirt) this.updateSkirt(pose, dt);
  }

  updateSkirt(pose, dt) {
    // inertia sway (spring) in body space
    const k = 60, damp = 9;
    _a.copy(pose.accel || _zero).multiplyScalar(-0.012);
    this.root.worldToLocal(_tmp.copy(_a).add(this.root.position)); // to root space (rotation only)
    _a.copy(_tmp);
    this.swayV.addScaledVector(this.sway, -k * dt).addScaledVector(this.swayV, -damp * dt).addScaledVector(_a, 60 * dt);
    this.sway.addScaledVector(this.swayV, dt);
    this.sway.clampLength(0, 0.25);
    const spin = Math.min(1, Math.abs(pose.spin || 0) / 12);
    const fl = [], inv = _m.copy(this.body.matrixWorld).invert();
    for (let i = 0; i < 2; i++) { this.foot[i].getWorldPosition(_s).applyMatrix4(inv); fl.push(_s.clone().sub(this.footRest[i])); }
    const pos = this.skirt.geometry.attributes.position, R = this.skirtRest;
    for (let v = 0; v < pos.count; v++) {
      const x = R[v * 3], y = R[v * 3 + 1], z = R[v * 3 + 2];
      const t = clamp((this.skirtTop - y) / this.skirtH, 0, 1), te = Math.pow(t, 1.4);
      const r = Math.hypot(x, z) || 1;
      const wl = clamp(0.5 + (x / r) * 0.9, 0, 1), wr = 1 - wl;
      const dx = (fl[0].x * wl + fl[1].x * wr) * te * 0.95, dy = Math.max(0, (fl[0].y * wl + fl[1].y * wr)) * te * 0.6, dz = (fl[0].z * wl + fl[1].z * wr) * te * 0.95;
      const flare = 1 + spin * 0.6 * te;
      pos.setXYZ(v, x * flare + dx + this.sway.x * te, y + dy + spin * 0.15 * te, z * flare + dz + this.sway.z * te);
    }
    pos.needsUpdate = true;
    this.skirt.geometry.computeVertexNormals();
  }

  // Fit the mop to Karim's hands: the hand on the side of the handle's top end grips high (no crossed arms),
  // both hands must be within arm's reach, and the handle stays in front of the chest.
  fitWeapon(c, d, pivotY) {
    const D = this.D, shY = PIVOT + D.spineY + D.chestY + D.shY, reach = D.UA + D.FA + 0.08; // to the palm
    const half = this.weapon.userData.len / 2;
    // grip position along the handle eases between poses (low "leaning" hold at rest, near the end for strikes)
    const want = this.gripWant ?? 0; this.gripCur = (this.gripCur ?? want) + (want - (this.gripCur ?? want)) * 0.25;
    const TOP = -(half - 0.16) + this.gripCur * 0.33, LOW = -(half - 0.36) + this.gripCur * 0.21;
    const buttX = c.x - d.x * half;
    this.gripOffsets = (buttX >= 0 && !(this.freeW > 0.5)) ? [TOP, LOW] : [LOW, TOP]; // [left, right]; one-handed: right hand holds
    for (let it = 0; it < 6; it++) {
      this.clearTorso(c, d, pivotY);
      let worst = 0, mx = 0, my = 0, mz = 0;
      for (let i = (this.freeW > 0.5 ? 1 : 0); i < 2; i++) {
        const side = i === 0 ? 1 : -1, u = this.gripOffsets[i];
        const gx = c.x + d.x * u - D.shX * side, gy = c.y + d.y * u - shY, gz = c.z + d.z * u;
        const dist = Math.hypot(gx, gy, gz), ex = dist - reach;
        if (ex > worst) { worst = ex; mx = -gx / dist * ex; my = -gy / dist * ex; mz = -gz / dist * ex; }
      }
      if (worst <= 0.002) break;
      c.x += mx; c.y += my; c.z += mz;
    }
    this.clearTorso(c, d, pivotY);
    this.clearFloor(c, d, pivotY, half);
  }

  // never let the mop (or its strands) go through the floor
  clearFloor(c, d, pivotY, half) {
    const floor = PIVOT - pivotY; // floor height in weapon-pose space
    const head = c.y + d.y * half - 0.17, butt = c.y - d.y * half - 0.03;
    const low = Math.min(head, butt);
    if (low < floor) c.y += floor - low;
  }

  // keep the handle and both hands in front of the torso (no arms/mop through the body)
  clearTorso(c, d, pivotY) {
    const y0 = 0.88, y1 = 1.58, R = 0.27; // torso in rest-pose coordinates (weapon pose space)
    let push = 0;
    for (let k = 0; k <= 8; k++) {
      const half = this.weapon.userData.len / 2, u = -half + k * (1.0 / 8); // butt end up to just past the lower hand
      const x = c.x + d.x * u, y = c.y + d.y * u, z = c.z + d.z * u;
      if (y >= y0 && y <= y1 && Math.abs(x) < R) {
        const need = Math.sqrt(R * R - x * x) - z; if (need > push) push = need;
      } else if (y > y1 && y < 1.9 && Math.abs(x) < 0.17) { // keep it off his face
        const need = 0.03 + Math.sqrt(0.17 * 0.17 - x * x) - z; if (need > push) push = need;
      }
    }
    c.z += push;
  }

  // world-space points along the weapon (u in -0.5..0.5 of length, 0.5 = head/muzzle end)
  weaponPoint(u, out) { out.set(0, u * this.weapon.userData.len, 0); return this.weapon.localToWorld(out); }

  // tassel flop for mop
  // each mop strand is a little pendulum: gravity, inertia from the mop's motion, a soft pull back to its
  // rest splay, and the floor (strands drag and fan out when the head is down)
  updateTassel(vel, dt) {
    if (!this.strands) return;
    dt = Math.min(dt, 1 / 30); if (dt <= 0) return;
    this.weapon.updateMatrixWorld(true);
    const tm = this.tassel.matrixWorld, tq = this.tassel.getWorldQuaternion(_q1);
    const axis = _d.set(0, 1, 0).applyQuaternion(tq);
    const f = dt * 60, damp = Math.pow(0.93, f), g = 9.8 * dt * dt, SEG = this.SEG;
    const inv = _m.copy(this.weapon.matrixWorld).invert(), inst = this.strandMesh;
    const fl = this.root.position.y + 0.01; // (his own floor: on the stairs it isn't at 0)
    let k = 0;
    for (const st of this.strands) {
      const base = _s.copy(st.base).applyMatrix4(tm);
      const restW = _a.copy(st.dir).applyQuaternion(tq);
      if (!st.p || st.p[0].distanceTo(base) > 1) {
        st.p = []; st.o = [];
        for (let j = 0; j <= SEG; j++) { const v = base.clone().addScaledVector(restW, st.seg * j); st.p.push(v); st.o.push(v.clone()); }
      }
      const P = st.p, O = st.o;
      P[0].copy(base); O[0].copy(base);
      for (let j = 1; j <= SEG; j++) {
        const p = P[j], o = O[j];
        _tmp.copy(p).sub(o).multiplyScalar(damp); o.copy(p); p.add(_tmp); p.y -= g;
        // fibre memory: each segment leans toward continuing its parent's rest direction (strong at the root, loose at the tip)
        _t.copy(P[j - 1]).addScaledVector(restW, st.seg);
        p.lerp(_t, 1 - Math.pow(1 - st.stiff[j - 1], f));
      }
      for (let it = 0; it < 2; it++) for (let j = 1; j <= SEG; j++) {
        const p = P[j], q = P[j - 1];
        _p.copy(p).sub(q); let len = _p.length() || 1; _p.multiplyScalar(1 / len);
        if (j === 1) { const dp = _p.dot(axis); if (dp < -0.75) _p.addScaledVector(axis, -0.75 - dp).normalize(); }
        p.copy(q).addScaledVector(_p, st.seg);
        if (p.y < fl) { p.y = fl; O[j].x += (p.x - O[j].x) * 0.45; O[j].z += (p.z - O[j].z) * 0.45; O[j].y = p.y; }
      }
      // write segment instances in weapon space
      for (let j = 1; j <= SEG; j++) {
        _c.copy(P[j - 1]).applyMatrix4(inv); _off.copy(P[j]).applyMatrix4(inv).sub(_c);
        const len = _off.length() || 1e-4;
        _q2.setFromUnitVectors(UP, _off.multiplyScalar(1 / len));
        _mw.compose(_c, _q2, _sc2.set(1, len * 1.12, 1)); inst.setMatrixAt(k++, _mw);
      }
    }
    inst.instanceMatrix.needsUpdate = true;
  }
}

const _c = new THREE.Vector3(), _d = new THREE.Vector3(), _piv = new THREE.Vector3(), _t = new THREE.Vector3(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _off = new THREE.Vector3();
const _mw = new THREE.Matrix4(), _sc2 = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _qr = new THREE.Quaternion(), _a = new THREE.Vector3(), _tmp = new THREE.Vector3(), _zero = new THREE.Vector3(), _m = new THREE.Matrix4();

// analytic two-bone IK (world target + pole), writes joint quaternions in parent space
const _S = new THREE.Vector3(), _dir = new THREE.Vector3(), _pp = new THREE.Vector3(), _u = new THREE.Vector3(), _E = new THREE.Vector3(), _f = new THREE.Vector3(), _pq = new THREE.Quaternion();
const _rd = new THREE.Vector3(), _rq = new THREE.Quaternion();
export function solveIK(upper, lower, a, b, T, pole, restQ) { return solve(upper, lower, a, b, T, pole, restQ); }
function solve(upper, lower, a, b, T, pole, restQ) {
  upper.getWorldPosition(_S);
  // limb lengths are in rig units: convert to world units if the rig is scaled (e.g. smaller robbers)
  const ws = upper.parent.matrixWorld.getMaxScaleOnAxis(); if (Math.abs(ws - 1) > 1e-4) { a *= ws; b *= ws; }
  _dir.subVectors(T, _S);
  let d = _dir.length();
  d = clamp(d, 0.05, a + b - 0.002);
  _dir.normalize();
  const cosA = clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1), A = Math.acos(cosA);
  _pp.subVectors(pole, _S); _pp.addScaledVector(_dir, -_pp.dot(_dir));
  if (_pp.lengthSq() < 1e-6) _pp.set(0, 0, 1); _pp.normalize();
  _u.copy(_dir).multiplyScalar(Math.cos(A)).addScaledVector(_pp, Math.sin(A)).normalize();
  _E.copy(_S).addScaledVector(_u, a);
  _f.copy(_S).addScaledVector(_dir, d).sub(_E).normalize();
  upper.parent.getWorldQuaternion(_pq).invert();
  if (restQ) { // rotate minimally away from the bind pose (avoids arm twisting on skinned meshes)
    _rd.copy(DOWN).applyQuaternion(restQ);
    upper.quaternion.setFromUnitVectors(_rd, _u.applyQuaternion(_pq)).multiply(restQ);
  } else upper.quaternion.setFromUnitVectors(DOWN, _u.applyQuaternion(_pq));
  upper.updateMatrixWorld(true);
  upper.getWorldQuaternion(_pq).invert();
  lower.quaternion.setFromUnitVectors(DOWN, _f.applyQuaternion(_pq));
  lower.updateMatrixWorld(true);
}
