// Title screen: Karim on a white studio floor, chin up, the camera slowly circling him.
// (Placeholder pose: the authored mop idle with his chest out and head raised, until the posed export arrives.)
import * as THREE from 'three';
import { clone as skClone } from 'three/addons/utils/SkeletonUtils.js';
import { L } from './level.js';
import { KARIM_SCALE } from './mixamo.js';
import { buildDisplayMop, addMopPole } from './tools.js';

export const T = { scene: null, cam: null, ready: false, a: 0.55 };

// a soft round shadow texture (contact shadow under his feet)
function blobTex() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d'), g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(0.45, 'rgba(0,0,0,0.55)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

// call at boot, before the player takes Karim's model over (the clone starts from the clean bind pose)
export function initTitle(tex) {
  const kg = L.gltf.Karim; if (!kg) return;
  const scene = new THREE.Scene(); T.scene = scene;
  scene.background = new THREE.Color(2.6, 2.6, 2.6); // reads as white after tone mapping
  T.cam = new THREE.PerspectiveCamera(27, innerWidth / innerHeight, 0.1, 60);

  // studio lighting: soft fill, a warm key that casts his shadow, a cool rim from behind
  scene.add(new THREE.HemisphereLight(0xffffff, 0xe2dcd2, 1.5));
  const key = new THREE.DirectionalLight(0xfff1df, 3.0); key.position.set(2.2, 5.5, 3.2); key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048); key.shadow.radius = 5; key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02;
  Object.assign(key.shadow.camera, { left: -1.8, right: 1.8, top: 2.6, bottom: -1.2, near: 1, far: 14 });
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xdfe8ff, 2.2); rim.position.set(-3, 3.4, -4); scene.add(rim);
  const fill = new THREE.DirectionalLight(0xffffff, 0.8); fill.position.set(-4, 2, 3); scene.add(fill);
  // a floor that only shows shadows, so the white runs seamlessly into the background
  const floor = new THREE.Mesh(new THREE.CircleGeometry(9, 48), new THREE.ShadowMaterial({ opacity: 0.16 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5), new THREE.MeshBasicMaterial({ map: blobTex(), color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false }));
  blob.rotation.x = -Math.PI / 2; blob.position.y = 0.002; scene.add(blob);

  if (L.titlePose) { posedKarim(scene, kg, tex, L.titlePose); T.ready = true; updateTitle(0); return; }
  // Karim
  const k = skClone(kg.scene), holder = new THREE.Group();
  holder.scale.setScalar(KARIM_SCALE); holder.add(k); scene.add(holder);
  k.traverse(o => { if (o.isSkinnedMesh) { o.material = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.72, metalness: 0, envMapIntensity: 0.6 }); o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
  const B = {}; k.traverse(o => { if (o.isBone) B[o.name.replace(/^mixamorig:?/, '')] = o; });
  T.B = B; T.holder = holder;
  T.mixer = new THREE.AnimationMixer(k);
  const clip = L.idleMop ? THREE.AnimationClip.parse(L.idleMop.clip) : kg.animations.find(c => c.name === 'Idle');
  if (clip) T.mixer.clipAction(clip).play();
  // proud: chest out, chin up (applied on top of the clip each frame, and taken off again before the next)
  T.tweak = [['Spine1', -0.04], ['Spine2', -0.06], ['Neck', -0.06], ['Head', -0.08]].filter(([n]) => B[n])
    .map(([n, a]) => [B[n], new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), a)]);
  // his mop, held as in the authored idle
  if (L.idleMop) {
    T.mop = buildDisplayMop(); T.mop.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } }); scene.add(T.mop);
    // the cart's display mop has stiff strands; here they hang from the head like a real (damp) mop
    T.strands = new THREE.Group(); scene.add(T.strands);
    const strands = T.mop.children.filter(m => m.material && m.material.side === THREE.DoubleSide), up = new THREE.Vector3(0, 1, 0);
    strands.forEach((m, i) => {
      T.mop.remove(m); T.strands.add(m);
      const a = i / strands.length * Math.PI * 2 + (i % 2) * 0.2, r = 0.012 + (i % 3) * 0.011;
      m.position.set(Math.cos(a) * r, 0, Math.sin(a) * r); m.rotation.set(0, 0, 0);
      m.quaternion.setFromUnitVectors(up, new THREE.Vector3(Math.cos(a) * (0.22 + (i % 3) * 0.08), -1, Math.sin(a) * (0.22 + (i % 3) * 0.08)).normalize());
      m.scale.set(1, 1.05 + (i * 7 % 5) * 0.06, 1);
    });
    T.mopT = new THREE.Vector3().fromArray(L.idleMop.mop.t); T.mopQ = new THREE.Quaternion().fromArray(L.idleMop.mop.q);
  }
  T.ready = true;
  updateTitle(0);
}

// Karim frozen mid mop-strike (a frame captured from the game: every bone, the mop, and its flying strands)
function posedKarim(scene, kg, tex, pose) {
  const root = new THREE.Group(); scene.add(root); T.root = root;
  const k = skClone(kg.scene);
  new THREE.Matrix4().fromArray(pose.sceneRel).decompose(k.position, k.quaternion, k.scale);
  root.add(k);
  k.traverse(o => {
    if (o.isSkinnedMesh) { o.material = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.72, metalness: 0, envMapIntensity: 0.6 }); o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; }
    if (o.isBone) { const b = pose.bones[o.name.replace(/^mixamorig:?/, '')]; if (b) { o.quaternion.fromArray(b.q); o.position.fromArray(b.p); } }
  });
  const mop = new THREE.Group(); addMopPole(mop, 1.16);
  const seg = new THREE.CylinderGeometry(0.0095, 0.0115, 1, 7, 1); seg.translate(0, 0.5, 0);
  const im = new THREE.InstancedMesh(seg, new THREE.MeshStandardMaterial({ color: 0xebe5d4, roughness: 0.88 }), pose.count), m4 = new THREE.Matrix4();
  // fan the strands out, the way a mop head bursts open at the fastest part of a swing
  const SEG = 6, n = pose.count / SEG, up = new THREE.Vector3(0, 1, 0), P = new THREE.Vector3(), Q = new THREE.Quaternion(), S = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const segs = [];
    for (let j = 0; j < SEG; j++) { m4.fromArray(pose.strands, (i * SEG + j) * 16).decompose(P, Q, S); segs.push({ p: P.clone(), d: up.clone().applyQuaternion(Q), l: S.y }); }
    const s0 = segs[0].p, last = segs[SEG - 1], end = last.p.clone().addScaledVector(last.d, last.l);
    const D = end.clone().sub(s0), Lt = D.length(); D.normalize();
    const radial = new THREE.Vector3(s0.x, 0, s0.z); if (radial.lengthSq() < 1e-6) radial.set(Math.cos(i * 2.4), 0, Math.sin(i * 2.4)); radial.normalize();
    const out = D.clone().addScaledVector(radial, 0.7 + ((i * 7) % 5) * 0.09).normalize(), len = Lt * (0.95 + ((i * 5) % 4) * 0.09) / SEG;
    const p = s0.clone();
    for (let j = 0; j < SEG; j++) {
      const d = out.clone().lerp(D, j / (SEG + 0.5)).normalize(); // (the tips curl back the way the swing came from)
      im.setMatrixAt(i * SEG + j, m4.compose(p, Q.setFromUnitVectors(up, d), S.set(1, len, 1)));
      p.addScaledVector(d, len);
    }
  }
  im.frustumCulled = false; mop.add(im);
  new THREE.Matrix4().fromArray(pose.weaponRel).decompose(mop.position, mop.quaternion, mop.scale);
  mop.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } }); root.add(mop);
  // stand him in the middle of the stage (hips over the centre)
  root.updateMatrixWorld(true);
  let hips = null; k.traverse(o => { if (o.isBone && /Hips$/.test(o.name)) hips = o; });
  if (hips) { const h = hips.getWorldPosition(new THREE.Vector3()); root.position.x -= h.x; root.position.z -= h.z; }
  T.posed = true;
}

const _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _d = new THREE.Vector3(), _flip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
export function updateTitle(dt) {
  if (!T.ready) return;
  if (T.posed) { orbit(dt); return; }
  if (T.applied) for (const [b, q] of T.tweak) b.quaternion.multiply(_q.copy(q).invert());
  T.mixer.update(dt);
  for (const [b, q] of T.tweak) b.quaternion.multiply(q);
  T.applied = true;
  T.holder.updateMatrixWorld(true);
  if (T.mop) { // same placement as the in-game mop: grip point on the right hand, handle centre along -Y
    const H = T.B.RightHand, len = 1.16;
    _p.copy(T.mopT).applyMatrix4(H.matrixWorld);
    _q.copy(H.getWorldQuaternion(new THREE.Quaternion())).multiply(T.mopQ);
    _d.set(0, -1, 0).applyQuaternion(_q);
    _p.addScaledVector(_d, len / 2 - 0.16 * len / 1.3);
    T.mop.position.copy(_p); T.mop.quaternion.copy(_q).multiply(_flip);
    T.mop.updateMatrixWorld(true); T.strands.position.copy(T.mop.localToWorld(_d.set(0, 0.6, 0)));
  }
  orbit(dt);
}
function orbit(dt) {
  // the camera circles him slowly; on wide screens he stands right of centre, clear of the menu
  T.a += dt * (Math.PI * 2 / 80);
  const r = 5.1, cam = T.cam;
  cam.position.set(Math.sin(T.a) * r, 1.25, Math.cos(T.a) * r);
  cam.lookAt(0, 0.98, 0);
  const W = innerWidth, Hh = innerHeight, wide = W / Hh > 1.15;
  cam.aspect = W / Hh; cam.fov = wide ? 27 : 38;
  if (wide) cam.setViewOffset(W, Hh, -W * 0.17, 0, W, Hh); else cam.clearViewOffset();
  cam.updateProjectionMatrix(); cam.updateMatrixWorld();
}
