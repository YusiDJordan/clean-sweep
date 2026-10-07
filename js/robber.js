// Yusuf's robber model, bound to the game's procedural robber rig.
// The model is posed (aiming). We fit the rig's joints onto his anatomy in that pose (the bind pose),
// then every procedural robber animation (walk, aim, fire, melee, stagger, KO...) moves the real mesh.
import * as THREE from 'three';
import { RIG, solveIK } from './rig.js';
import { G } from './state.js';

export const ROBBER_SCALE = 1.8;
const J = ['body', 'spine', 'chest', 'neck', 'head', 'sh0', 'el0', 'hand0', 'sh1', 'el1', 'hand1', 'hip0', 'knee0', 'foot0', 'hip1', 'knee1', 'foot1'];
const UP = new THREE.Vector3(0, 1, 0);
let R = null;

const jointOf = (rig, j) => ({ body: rig.body, spine: rig.spine, chest: rig.chest, neck: rig.neck, head: rig.head,
  sh0: rig.sh[0], el0: rig.el[0], hand0: rig.hand[0], sh1: rig.sh[1], el1: rig.el[1], hand1: rig.hand[1],
  hip0: rig.hip[0], knee0: rig.knee[0], foot0: rig.foot[0], hip1: rig.hip[1], knee1: rig.knee[1], foot1: rig.foot[1] })[j];

export function robberDims() { return R ? R.D : null; }

export function prepareRobber(gltf, RigClass) {
  if (R) return R;
  let rootNode = null, bodyM = null, rifleM = null;
  gltf.scene.traverse(o => { if (o.userData && o.userData.anatomy) rootNode = o; if (o.isMesh && o.name === 'RobberBody') bodyM = o; if (o.isMesh && o.name === 'RobberRifle') rifleM = o; });
  if (!rootNode || !bodyM) return null;
  const S = ROBBER_SCALE, an = rootNode.userData.anatomy;
  const hx = an.hips[0], hz = an.hips[2];
  const T = new THREE.Matrix4().makeScale(S, S, S).multiply(new THREE.Matrix4().makeTranslation(-hx, 0, -hz)); // centre the hips over the origin
  const A = {}; for (const k in an) A[k] = new THREE.Vector3().fromArray(an[k]).applyMatrix4(T);
  // geometry (shared by every robber)
  const geo = bodyM.geometry.clone(); geo.applyMatrix4(T);
  const si = geo.getAttribute('_skinidx'), sw = geo.getAttribute('_skinwt');
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(Uint16Array.from(si.array), 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(Float32Array.from(sw.array), 4));
  geo.deleteAttribute('_skinidx'); geo.deleteAttribute('_skinwt');
  const rgeo = rifleM.geometry.clone(); rgeo.applyMatrix4(T);
  // metalness 0 on cloth: the texture's white UV-border bleeds into the metal channel and made seams glint white
  // unpainted texture areas are black in the roughness map (= mirror); keep cloth matte so hidden inner faces don't flash white
  const tune = (m, metal, minR = 0.62) => { m = m.clone(); m.envMapIntensity = 0.8; m.metalness = metal; m.roughness = 1; m.side = THREE.DoubleSide; if (m.map) m.map.anisotropy = 8;
    m.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = max(roughnessFactor, ' + minR.toFixed(2) + ');'); };
    m.customProgramCacheKey = () => 'robber' + minR; return m; };
  const mat = tune(bodyM.material, 0), matHeavy = tune(bodyM.material, 0); matHeavy.color = new THREE.Color(0x8c8c8c);
  const rmat = tune(rifleM.material, 0.5, 0.35);
  // rig dimensions measured from the model
  const avg = (a, b) => (a + b) / 2, d = (a, b) => a.distanceTo(b);
  const shMid = A.shL.clone().add(A.shR).multiplyScalar(0.5);
  const D = {
    UA: avg(d(A.shL, A.elL), d(A.shR, A.elR)), FA: avg(d(A.elL, A.wrL), d(A.elR, A.wrR)),
    TH: avg(d(A.upL, A.knL), d(A.upR, A.knR)), SH: avg(d(A.knL, A.anL), d(A.knR, A.anR)),
    hipX: d(A.upL, A.upR) / 2, hipY: avg(A.upL.y, A.upR.y) - A.hips.y, spineY: Math.max(0.04, d(A.spine, A.hips)),
    shX: d(A.shL, A.shR) / 2, shY: 0.07,
  };
  const spineP = new THREE.Vector3(0, A.hips.y + D.spineY, 0);
  D.chestY = Math.max(0.1, d(shMid, spineP) - D.shY);
  const headPivot = A.neck.clone().lerp(A.headC, 0.35);
  D.neckY = 0.16; D.headY = d(A.neck, headPivot);
  // ---- fit a reference rig to the bind (aiming) pose ----
  const rig = new RigClass('robber', D);
  const root = rig.root; root.position.set(0, 0, 0); root.quaternion.identity();
  rig.body.position.set(0, A.hips.y, 0);
  const hv = A.upL.clone().sub(A.upR); rig.body.quaternion.setFromAxisAngle(UP, Math.atan2(-hv.z, hv.x));
  root.updateMatrixWorld(true);
  const worldBasisQ = (y, xHint) => { const yy = y.clone().normalize(), xx = xHint.clone().addScaledVector(yy, -xHint.dot(yy)).normalize(), zz = new THREE.Vector3().crossVectors(xx, yy); return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(xx, yy, zz)); };
  const setWorldQ = (obj, wq) => { obj.parent.updateMatrixWorld(true); const pq = obj.parent.getWorldQuaternion(new THREE.Quaternion()); obj.quaternion.copy(pq.invert().multiply(wq)); obj.updateMatrixWorld(true); };
  const spW = rig.spine.getWorldPosition(new THREE.Vector3());
  setWorldQ(rig.spine, worldBasisQ(shMid.clone().sub(spW), A.shL.clone().sub(A.shR)));
  rig.chest.quaternion.identity(); rig.chest.updateMatrixWorld(true);
  const nkW = rig.neck.getWorldPosition(new THREE.Vector3());
  setWorldQ(rig.neck, worldBasisQ(A.headC.clone().sub(nkW), A.shL.clone().sub(A.shR)));
  rig.head.quaternion.identity();
  root.updateMatrixWorld(true);
  for (let i = 0; i < 2; i++) {
    const L = i === 0;
    solveIK(rig.sh[i], rig.el[i], D.UA, D.FA, L ? A.wrL : A.wrR, L ? A.elL : A.elR, null);
    rig.hand[i].quaternion.identity();
    solveIK(rig.hip[i], rig.knee[i], D.TH, D.SH, L ? A.anL : A.anR, L ? A.knL.clone().add(new THREE.Vector3(0, 0, 0.3)) : A.knR.clone().add(new THREE.Vector3(0, 0, 0.3)), null);
    const toe = (L ? A.toeL : A.toeR).clone().sub(L ? A.anL : A.anR); toe.y = 0; toe.normalize();
    setWorldQ(rig.foot[i], new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), toe));
  }
  root.updateMatrixWorld(true);
  const boneInverses = J.map(j => jointOf(rig, j).matrixWorld.clone().invert());
  // rifle: the right wrist is the rig's grip point; barrel along the weapon's +Y
  const dir = A.muzzle.clone().sub(A.stock).normalize();
  const wM = new THREE.Matrix4().compose(A.wrR, new THREE.Quaternion().setFromUnitVectors(UP, dir), new THREE.Vector3(1, 1, 1));
  const wInv = wM.clone().invert();
  R = {
    D, geo, rgeo, mat, matHeavy, rmat, boneInverses,
    rifleLocal: wInv.clone(), gripL: A.wrL.clone().applyMatrix4(wInv),
    muzzle: A.muzzle.clone().applyMatrix4(wInv), laser: A.muzzle.clone().addScaledVector(dir, -0.18).add(new THREE.Vector3(0, -0.04, 0)).applyMatrix4(wInv),
    len: d(A.muzzle, A.stock),
  };
  return R;
}

export function attachRobberBody(enemy) {
  if (!R) return;
  const rig = enemy.rig;
  // hide the stand-in body and rifle, keep the blob shadow
  rig.root.traverse(o => { if (o.isMesh && !o.userData.keep) o.visible = false; });
  const bones = J.map(j => jointOf(rig, j));
  const mesh = new THREE.SkinnedMesh(R.geo, enemy.heavy ? R.matHeavy : R.mat);
  mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false; mesh.userData.noProbe = true;
  G.scene.add(mesh);
  rig.root.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones, R.boneInverses.map(m => m.clone())), new THREE.Matrix4());
  const rifle = new THREE.Mesh(R.rgeo, R.rmat);
  rifle.matrixAutoUpdate = false; rifle.matrix.copy(R.rifleLocal); rifle.castShadow = true; rifle.userData.keep = true;
  rig.weapon.add(rifle);
  rig.weapon.userData.muzzle = R.muzzle.clone(); rig.weapon.userData.laser = R.laser.clone(); rig.weapon.userData.len = R.len;
  rig.gripLocal = [R.gripL.clone(), new THREE.Vector3()];
  enemy.skin = mesh;
}
