// Auto-rigging: binds a static T-pose character mesh to the procedural Rig skeleton,
// so the same procedural animation (IK arms on the mop, stepping legs, rolls, sweeps) drives the real model.
import * as THREE from 'three';
import { G } from './state.js';

// Skeleton dimensions measured from Karim's mesh (scaled to 1.78 m)
export const KARIM_DIMS = { UA: 0.27, FA: 0.24, TH: 0.42, SH: 0.4, shX: 0.19, shY: 0.07, hipX: 0.1, hipY: -0.05, spineY: 0.08, chestY: 0.3, neckY: 0.17, headY: 0.12 };
export const KARIM_HEIGHT = 1.78;

const sm = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

export function skinCharacter(rig, gltfScene, height = KARIM_HEIGHT) {
  // 1) find the mesh and bake its node transform + scale into the geometry (root space, feet at y=0, facing +z)
  let src = null; gltfScene.updateMatrixWorld(true);
  gltfScene.traverse(o => { if (o.isMesh && !src) src = o; });
  const geo = src.geometry.clone();
  geo.applyMatrix4(src.matrixWorld);
  geo.computeBoundingBox();
  const bb = geo.boundingBox, s = height / (bb.max.y - bb.min.y);
  geo.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
  geo.scale(s, s, s);

  // 2) bind pose: rig at origin, arms out to the sides (T-pose), legs straight
  const root = rig.root, saved = { p: root.position.clone(), q: root.quaternion.clone() };
  root.position.set(0, 0, 0); root.quaternion.identity();
  rig.body.position.set(0, 0.95, 0); rig.body.quaternion.identity();
  for (const j of [rig.spine, rig.chest, rig.neck, rig.head, ...rig.el, ...rig.hand, ...rig.hip, ...rig.knee, ...rig.foot]) j.quaternion.identity();
  rig.sh[0].quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);   // left arm -> +x
  rig.sh[1].quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), -Math.PI / 2);  // right arm -> -x
  rig.armRestQ = [rig.sh[0].quaternion.clone(), rig.sh[1].quaternion.clone()];
  root.updateMatrixWorld(true);

  const bones = [rig.body, rig.spine, rig.chest, rig.neck, rig.sh[0], rig.el[0], rig.hand[0], rig.sh[1], rig.el[1], rig.hand[1], rig.hip[0], rig.knee[0], rig.foot[0], rig.hip[1], rig.knee[1], rig.foot[1]];
  const B = { body: 0, spine: 1, chest: 2, neck: 3, sh: [4, 7], el: [5, 8], hand: [6, 9], hip: [10, 13], knee: [11, 14], foot: [12, 15] };
  const wp = o => o.getWorldPosition(new THREE.Vector3());
  const shoulderX = wp(rig.sh[0]).x, elbowX = wp(rig.el[0]).x, wristX = wp(rig.hand[0]).x;
  const hipY = wp(rig.hip[0]).y, kneeY = wp(rig.knee[0]).y, ankleY = wp(rig.foot[0]).y;
  const neckY = wp(rig.neck).y, chestY = wp(rig.chest).y, spineY = wp(rig.spine).y;
  const hemY = 0.39; // kameez hem height

  // 3) skin weights from body regions
  const pos = geo.attributes.position, n = pos.count;
  const idx = new Uint16Array(n * 4), wts = new Float32Array(n * 4);
  const w = new Map();
  const add = (b, v) => { if (v > 1e-4) w.set(b, (w.get(b) || 0) + v); };
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i), y = pos.getY(i); const ax = Math.abs(x), side = x >= 0 ? 0 : 1;
    w.clear();
    const isArm = y > hipY + 0.3 && (ax > 0.3 || (ax > shoulderX - 0.04 && y > chestY - 0.05 && y < neckY));
    if (isArm) {
      const up = sm(shoulderX - 0.05, shoulderX + 0.09, ax), fo = sm(elbowX - 0.05, elbowX + 0.05, ax), ha = sm(wristX - 0.03, wristX + 0.03, ax);
      add(B.chest, 1 - up); add(B.sh[side], up * (1 - fo)); add(B.el[side], fo * (1 - ha)); add(B.hand[side], ha);
    } else if (y >= neckY - 0.04) {
      const k = sm(neckY - 0.04, neckY + 0.04, y); add(B.neck, k); add(B.chest, 1 - k);
    } else if (y >= hipY + 0.02) {
      const c = sm(spineY + 0.08, chestY + 0.02, y), lowBody = 1 - sm(hipY + 0.02, spineY + 0.06, y);
      add(B.body, lowBody); add(B.chest, (1 - lowBody) * c); add(B.spine, (1 - lowBody) * (1 - c));
    } else if (y >= hemY) {
      // kameez skirt: blends from the pelvis into both thighs/knees by side, so it stretches instead of tearing
      const t = Math.min(1, Math.max(0, (hipY + 0.02 - y) / (hipY + 0.02 - hemY))), legW = 0.88 * t;
      const wl = sm(-0.08, 0.08, x), kn = sm(kneeY + 0.12, kneeY - 0.02, y);
      add(B.body, 1 - legW);
      add(B.hip[0], legW * wl * (1 - kn)); add(B.knee[0], legW * wl * kn);
      add(B.hip[1], legW * (1 - wl) * (1 - kn)); add(B.knee[1], legW * (1 - wl) * kn);
    } else {
      // trousers & shoes
      const kn = sm(kneeY + 0.06, kneeY - 0.06, y), ft = sm(ankleY + 0.05, ankleY - 0.01, y);
      add(B.hip[side], (1 - kn)); add(B.knee[side], kn * (1 - ft)); add(B.foot[side], kn * ft);
    }
    const arr = [...w.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const sum = arr.reduce((a, e) => a + e[1], 0) || 1;
    for (let k = 0; k < 4; k++) { idx[i * 4 + k] = arr[k] ? arr[k][0] : 0; wts[i * 4 + k] = arr[k] ? arr[k][1] / sum : 0; }
  }
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(idx, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(wts, 4));

  // 4) material tune (Tripo exports are mirror-shiny)
  const mat = src.material.clone();
  mat.roughness = 0.72; mat.metalness = 0;
  if (mat.specularIntensity !== undefined) mat.specularIntensity = 0.35;
  mat.envMapIntensity = 0.8;
  if (mat.map) mat.map.anisotropy = 8;

  const mesh = new THREE.SkinnedMesh(geo, mat);
  mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
  mesh.userData.noProbe = true;
  G.scene.add(mesh); mesh.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  mesh.bind(skeleton, new THREE.Matrix4());

  // hide the stand-in body parts (keep the mop)
  root.traverse(o => { if (o.isMesh) { let p = o, inWeapon = false; while (p) { if (p === rig.weapon) inWeapon = true; p = p.parent; } if (!inWeapon && !o.userData.keep) o.visible = false; } });
  rig.skirt = null;
  rig.skinned = mesh;
  root.position.copy(saved.p); root.quaternion.copy(saved.q); root.updateMatrixWorld(true);
  return mesh;
}
