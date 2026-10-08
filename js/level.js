// Builds the Noon Bank lobby: architecture, lighting, signage, the user's props, colliders
import * as THREE from 'three';
import { GOLD_GLSL, GLOW } from './decals.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { G, makeBox, canvasTex, makeCanvas } from './state.js';
import { buildNoonSign } from './lettering.js';
import { marbleFloor, stonePanels, brushedMetal, signTex, glowTex, fabricTex } from './textures.js';
import { R, shadowSize } from './render.js';
import { addDestructible, addChair } from './destruct.js';
import { FX } from './fx.js';
import { SFX } from './audio.js';
import { fireDoor } from './doors.js';

export const L = { models: {}, gltf: {}, mats: {}, occluders: [], plantSpots: [] };

// normalized extents of the user's models (x, z, height) after their built-in Z-up -> Y-up rotation
const EXT = {
  Cart: [0.904, 0.894, 1.0], CoffeeTable: [1, 1, 0.427], Computer: [1, 0.7, 0.756], Couch: [1, 0.428, 0.383],
  Desk: [1, 0.478, 0.407], OfficeChair: [0.77, 0.75, 1.0], PlantBox: [1, 0.532, 0.439], PottedPlant: [0.888, 0.93, 1.0],
  RAILING: [0.054, 1, 0.331], SmallerPlantBox: [0.95, 0.828, 1.0],
};
const SCALE = { Cart: 1.38, CoffeeTable: 1.5, Computer: 0.62, Couch: 2.75, Desk: 2.1, OfficeChair: 1.12, PlantBox: 2.6, PottedPlant: 0.95, RAILING: 3.0, SmallerPlantBox: 1.8 };

// newer props: normalised at load (centred on x/z, base on the floor) and scaled so one axis matches real life
const FIT = {
  Bench: ['x', 1.7], Shelf: ['z', 1.8], Console: ['x', 1.75], Printer: ['y', 1.2], Bust: ['y', 0.62], Piano: ['x', 1.6],
  Ottoman: ['y', 0.46], Bin: ['y', 0.44], LeatherChair: ['y', 0.95], Door: ['y', 2.2], GoldBar: ['z', 0.3],
};
// the custodian's basement (tutorial): Yusuf's props, normalised the same way
const FIT_BASEMENT = {
  BulletinBoard: ['x', 1.25], Fridge: ['y', 2.0], FireDoors: ['y', 2.25], AirCon: ['x', 0.95], Locker: ['y', 1.95],
  ExitSign: ['z', 0.42], Boxes: ['x', 1.45], Sink: ['x', 1.9], Crates: ['x', 1.55], PanelBoxes: ['z', 1.9], Cabinet: ['x', 1.9], Box: ['y', 0.36], WetSign: ['y', 0.64],
  MilkCrate: ['y', 0.3], FoldChairs: ['y', 0.88], MetalDesk: ['y', 0.76], Buckets: ['y', 0.5], DrainCleaner: ['y', 0.24], Plunger: ['y', 0.5], Grate: ['x', 0.6], FireBox: ['y', 1.45],
};
const LOBBY_SHARED = ['FireDoors', 'ExitSign'];
L.dims = {};
function fitModel(n, scene) {
  scene.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(scene), size = bb.getSize(new THREE.Vector3()), c = bb.getCenter(new THREE.Vector3());
  const [ax, m] = FIT[n], s = m / size[ax];
  const holder = new THREE.Group(); holder.scale.setScalar(s); scene.position.set(-c.x, -bb.min.y, -c.z); holder.add(scene);
  const wrap = new THREE.Group(); wrap.add(holder);
  L.dims[n] = [size.x * s, size.y * s, size.z * s];
  scene.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = true; o.receiveShadow = true;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    mats.forEach(mt => {
      for (const k of ['map', 'normalMap', 'roughnessMap']) if (mt[k]) mt[k].anisotropy = 8;
      mt.envMapIntensity = 0.9;
      if (mt.specularIntensity !== undefined) mt.specularIntensity = Math.min(mt.specularIntensity, 0.6);
      const nm = (mt.name || '').toLowerCase();
      if (n === 'Piano') {
        if (/gold/.test(nm)) { mt.color.set(0xd9b066); mt.metalness = 1; mt.roughness = 0.25; mt.envMapIntensity = 1.4; }
        else if (/black ?piano|blackpiano/.test(nm)) { mt.color.set(0x0c0c0e); mt.roughness = 0.08; mt.metalness = 0; mt.envMapIntensity = 1.5; }
        else if (/white/.test(nm)) { mt.roughness = 0.35; }
        else mt.roughness = Math.max(mt.roughness, 0.4);
      }
      if (!mt.roughnessMap && n !== 'Piano') mt.roughness = Math.max(mt.roughness, 0.35);
    });
  });
  return wrap;
}

// ---------- model files, kept in the browser's cache storage so a reload (New game, the stairs) doesn't download
// them all again; the other level's files are fetched quietly in the background while you play ----------
const MODEL_CACHE = 'cleansweep-models-48'; // (bump this whenever anything in models/ changes)
let cacheP = null;
function modelCache() {
  if (!cacheP) cacheP = (async () => {
    try {
      if (!self.caches) return null;
      const c = await caches.open(MODEL_CACHE);
      caches.keys().then(ks => ks.forEach(k => { if (k.startsWith('cleansweep-models-') && k !== MODEL_CACHE) caches.delete(k); })).catch(() => {});
      return c;
    } catch (e) { return null; }
  })();
  return cacheP;
}
async function fetchModel(path) {
  const c = await modelCache(), url = new URL(path, location.href).href;
  if (c) { try { const hit = await c.match(url); if (hit) return hit; } catch (e) {} }
  const res = await fetch(path);
  if (res.ok && c) { try { await c.put(url, res.clone()); } catch (e) {} }
  return res;
}
async function fetchJSON(path) { try { const r = await fetchModel(path); return r.ok ? await r.json() : null; } catch (e) { return null; } }
// every file a level loads
function levelFiles(level) {
  const base = level === 'basement';
  const names = base ? ['Cart', 'OfficeChair', 'PottedPlant'] : Object.keys(EXT);
  const fits = base ? ['Bin', 'Bench', ...Object.keys(FIT_BASEMENT)] : [...Object.keys(FIT).filter(n => !FIT_BASEMENT[n]), ...LOBBY_SHARED];
  const extra = base ? ['MainChar', 'Karim', 'RobberRig'] : ['MainChar', 'Sign', 'Karim', 'RobberRig'];
  const json = ['Idle_Mop', 'Sweep_Mop', 'Dodge', 'RobberAnims', ...(base ? [] : ['TitlePose'])];
  return { names, fits, extra, json };
}
// fetch the other level's files into the cache, one at a time, while the player is busy
export async function prefetchLevel(level) {
  const f = levelFiles(level), c = await modelCache(); if (!c) return;
  const paths = [...[...f.extra, ...f.fits, ...f.names].map(n => `models/${n}.txt`), ...f.json.map(n => `models/${n}.json`)];
  for (const p of paths) {
    try { if (!(await c.match(new URL(p, location.href).href))) { await fetchModel(p); await new Promise(r => setTimeout(r, 120)); } } catch (e) {}
  }
}

// models ship as base64 text (the host serves .txt but not .glb); decode and parse in memory
async function loadB64(loader, n) {
    const res = await fetchModel(`models/${n}.txt`);
    if (!res.ok) throw new Error(`model ${n} (${res.status})`);
    const b64 = (await res.text()).trim();
    const bin = atob(b64), buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    const g = await new Promise((resolve, reject) => {
      // use <img>-based texture loading (blob: images) instead of fetch-based ImageBitmapLoader
      const cib = window.createImageBitmap; try { window.createImageBitmap = undefined; } catch (e) {}
      try { loader.parse(buf.buffer, '', resolve, reject); }
      finally { try { window.createImageBitmap = cib; } catch (e) {} }
    });
    return g;
}

export async function loadModels(onProgress, level = 'lobby') {
  const base = level === 'basement';
  if (base) Object.assign(FIT, FIT_BASEMENT);
  else for (const n of LOBBY_SHARED) FIT[n] = FIT_BASEMENT[n]; // (the stairwell door up from the basement)
  const loader = new GLTFLoader();
  // authored animations made in Blender (retargeted onto Karim's skeleton)
  [L.idleMop, L.sweepMop, L.dodgeClip, L.robberAnims, L.titlePose] = await Promise.all(['Idle_Mop', 'Sweep_Mop', 'Dodge', 'RobberAnims', base ? null : 'TitlePose'].map(n => n ? fetchJSON(`models/${n}.json`) : null));
  // (the basement only needs the cart, a chair, a bin and its own props)
  const { names, fits, extra } = levelFiles(level);
  let done = 0; const total = names.length + fits.length + extra.length;
  L.rugTex = new THREE.TextureLoader().load('models/rug.jpg', t => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; });
  await Promise.all([...extra.map(async n => { const g = await loadB64(loader, n); L.gltf[n] = g; L.models[n] = g.scene; done++; onProgress && onProgress(done / total); }),
    ...fits.map(async n => { const g = await loadB64(loader, n); L.gltf[n] = g; L.models[n] = fitModel(n, g.scene); done++; onProgress && onProgress(done / total); }),
    ...names.map(async n => {
    const g = await loadB64(loader, n);
    g.scene.traverse(o => {
      if (o.isMesh) {
        o.castShadow = true; o.receiveShadow = true;
        const m = o.material;
        if (m.map) m.map.anisotropy = 8;
        // Tripo exports often have roughness 0 / mirror-like; give each prop a believable surface
        const tune = {
          Cart: [0.55, 0], CoffeeTable: [0.12, 0.1], Computer: [0.35, 0.2], Couch: [0.45, 0], Desk: [0.5, 0], OfficeChair: [0.6, 0],
          PlantBox: [0.7, 0], PottedPlant: [0.6, 0], RAILING: [0.25, 0.85], SmallerPlantBox: [0.7, 0],
        }[n];
        if (!m.roughnessMap) m.roughness = tune[0];
        else m.roughness = Math.max(m.roughness, 0.6);
        if (!m.metalnessMap) m.metalness = tune[1];
        if (m.specularIntensity !== undefined) m.specularIntensity = Math.min(m.specularIntensity ?? 1, 0.6);
        m.envMapIntensity = 0.9;
      }
    });
    L.models[n] = g.scene;
    done++; onProgress && onProgress(done / total);
  })]);
}

// ---------- contact shadows: soft dark footprints under things (works at every quality level) ----------
let contactTex = null;
function getContactTex() {
  if (contactTex) return contactTex;
  const S = 128, c = makeCanvas(S, S), x = c.getContext('2d');
  x.filter = 'blur(14px)'; x.fillStyle = '#000';
  x.beginPath(); x.roundRect(30, 30, S - 60, S - 60, 18); x.fill();
  x.filter = 'blur(5px)'; x.globalAlpha = 0.6; x.beginPath(); x.roundRect(40, 40, S - 80, S - 80, 10); x.fill();
  contactTex = new THREE.CanvasTexture(c); return contactTex;
}
const contactMats = {};
function contactMat(strength) {
  const k = Math.round(strength * 20);
  if (!contactMats[k]) contactMats[k] = new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: getContactTex(), transparent: true, opacity: strength, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  return contactMats[k];
}
// footprint w x d (world metres); attaches to parent (moves with it) or sits in the world
export function contactShadow(w, d, strength = 0.55, parent = null, x = 0, z = 0, yaw = 0, y = 0.006) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), contactMat(strength));
  m.rotation.x = -Math.PI / 2; m.renderOrder = 1;
  m.userData.noAO = true; m.userData.noReflect = true; m.userData.noProbe = true; m.userData.contact = true;
  if (parent) { const s = parent.scale.x; m.scale.set(w * 1.35 / s, d * 1.35 / s, 1); m.position.set(0, y / s, 0); parent.add(m); }
  else { const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = yaw; m.scale.set(w * 1.35, d * 1.35, 1); g.add(m); G.scene.add(g); }
  return m;
}
const CONTACT = { Cart: 0.6, CoffeeTable: 0.45, Computer: 0.45, Couch: 0.7, Desk: 0.55, OfficeChair: 0.5, PlantBox: 0.65, PottedPlant: 0.55, SmallerPlantBox: 0.65 };
const FOOT = { PottedPlant: 0.55, SmallerPlantBox: 0.75, PlantBox: 0.95 }; // pots are narrower than their leaves

// a newer prop (already normalised: base on the floor, real size); optional collider + contact shadow
export function prop2(name, x, z, yaw = 0, o = {}) {
  const obj = L.models[name].clone(); obj.position.set(x, o.y || 0, z); obj.rotation.y = yaw; G.scene.add(obj);
  const [w, h, d] = L.dims[name];
  if (o.contact !== 0) contactShadow(w * (o.fw ?? 1), d * (o.fd ?? 1), o.contact ?? 0.5, obj);
  if (o.col !== false) collider(x, z, w * (o.cw ?? 0.95), d * (o.cd ?? 0.95), yaw, o.y || 0, (o.y || 0) + (o.ch ?? Math.min(h, 1.3)));
  return { obj, w, h, d };
}
// a flat rug using the user's carpet texture (long side along z before yaw)
function rug(x, z, wShort, dLong, yaw = 0) {
  const g = new THREE.Group(); g.position.set(x, 0.003, z); g.rotation.y = yaw; G.scene.add(g);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(wShort, dLong), new THREE.MeshStandardMaterial({ map: L.rugTex, roughness: 0.95, envMapIntensity: 0.35, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
  m.rotation.x = -Math.PI / 2; m.receiveShadow = true; m.userData.noReflect = true; g.add(m);
  return g;
}
// light things you can kick about: bins (spill their rubbish when they go over) and ottoman stools
export const BIN = (x, z) => { const p = prop2('Bin', x, z, Math.random() * 6, { contact: 0.4, col: false }); addChair(p.obj, { r: 0.2, light: true, tipForce: 2.5, tipAngle: Math.PI / 2, tipLift: 0.19, cost: 0, spill: true }); return p; };
const STOOL = (x, z, yaw) => { const p = prop2('Ottoman', x, z, yaw, { contact: 0.45, col: false }); addChair(p.obj, { r: 0.3, light: true, tipForce: 4.5, tipAngle: Math.PI / 2, tipLift: 0.22, cost: 0 }); return p; };
const PLANT = (x, z) => { const p = prop('PottedPlant', x, z, (Math.random() * 4 | 0) * Math.PI / 2); addDestructible({ kind: 'plant', obj: p.obj, box: collider(x, z, 0.45, 0.45, 0, 0, 0.95), cost: 180, name: 'Potted plant', h: p.h }); return p; };

export function prop(name, x, z, yaw = 0, scale = 1, y = 0) {
  const s = SCALE[name] * scale;
  const o = L.models[name].clone();
  o.scale.setScalar(s);
  o.position.set(x, y, z); o.rotation.y = yaw;
  G.scene.add(o);
  const e = EXT[name];
  if (CONTACT[name]) { const f = FOOT[name] || 1; contactShadow(e[0] * s * f, e[1] * s * f, CONTACT[name] * (scale < 0.5 ? 0.6 : 1), o); }
  // plants standing on the floor drop leaves around them
  if (FOOT[name] && y < 0.1) L.plantSpots.push({ x, z, yaw, hw: e[0] * s / 2, hd: e[1] * s / 2, kind: name });
  return { obj: o, w: e[0] * s, d: e[1] * s, h: e[2] * s };
}

// ---------------- materials ----------------
export function mats() {
  const M = L.mats;
  const fl = marbleFloor();
  M.floor = new THREE.MeshStandardMaterial({ map: fl.map, roughnessMap: fl.rough, roughness: 1, metalness: 0, envMapIntensity: 0.35 });
  M.stoneDark = new THREE.MeshStandardMaterial({ map: stonePanels(true), roughness: 0.42, metalness: 0, envMapIntensity: 0.8 });
  M.stoneLight = new THREE.MeshStandardMaterial({ map: stonePanels(false, 1024, 1024, 2, 3), roughness: 0.5, envMapIntensity: 0.8 });
  M.stonePillar = new THREE.MeshStandardMaterial({ map: stonePanels(true, 512, 1024, 1, 4), roughness: 0.35, envMapIntensity: 1 });
  M.darkMetal = new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.38, metalness: 0.85 });
  M.steel = new THREE.MeshStandardMaterial({ color: 0xc9c6c0, roughness: 0.28, metalness: 1, roughnessMap: brushedMetal(), envMapIntensity: 1.4 });
  M.gold = new THREE.MeshStandardMaterial({ color: 0xffc35a, roughness: 0.38, metalness: 1, envMapIntensity: 1.6 });
  M.glass = new THREE.MeshStandardMaterial({ color: 0xb4d2ea, roughness: 0.012, metalness: 0.55, transparent: true, opacity: 0.3, envMapIntensity: 6.2, depthWrite: false, side: THREE.DoubleSide }); // a touch of blue, more mirror
  M.facadeGlass = new THREE.MeshStandardMaterial({ color: 0x88a6bc, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.22, envMapIntensity: 1.6, depthWrite: false, side: THREE.DoubleSide });
  M.wood = new THREE.MeshStandardMaterial({ color: 0x6b4a32, roughness: 0.45, metalness: 0, map: fabricTex('#7a5538', 'rgba(0,0,0,0.08)') });
  M.cap = new THREE.MeshStandardMaterial({ color: 0x1d1f23, roughness: 0.6 });
  M.ceiling = new THREE.MeshStandardMaterial({ color: 0xd8d2c8, roughness: 0.9 });
  M.lightPanel = new THREE.MeshBasicMaterial({ color: 0xfff2d8 });
  M.black = new THREE.MeshStandardMaterial({ color: 0x0b0b0d, roughness: 0.9 });
  M.plaza = new THREE.MeshStandardMaterial({ color: 0x6e665f, roughness: 0.85, map: stonePanels(false, 512, 512, 4, 4) });
  M.plaza.map.repeat.set(60, 60);
  M.white = new THREE.MeshStandardMaterial({ color: 0xe8e4dc, roughness: 0.6 });
}

export function box(w, h, d, mat, x, y, z, o = {}) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  if (o.ry) m.rotation.y = o.ry;
  m.castShadow = o.cast !== false; m.receiveShadow = true;
  if (o.uvScale && o.uvWorld) { // UVs from world position: split wall pieces line up seamlessly
    const uv = m.geometry.attributes.uv, n = m.geometry.attributes.normal, ps = m.geometry.attributes.position;
    for (let i = 0; i < uv.count; i++) {
      const X = ps.getX(i) + x, Y = ps.getY(i) + y, Z = ps.getZ(i) + z;
      const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i));
      const [u, v] = ax > 0.5 ? [Z, Y] : ay > 0.5 ? [X, Z] : [X, Y];
      uv.setXY(i, u / o.uvScale[0], v / o.uvScale[1]);
    }
  } else if (o.uvScale) { // world-ish UVs so panel textures don't stretch
    const uv = m.geometry.attributes.uv, n = m.geometry.attributes.normal;
    for (let i = 0; i < uv.count; i++) {
      const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i));
      const sx = ax > 0.5 ? d : w, sy = ay > 0.5 ? d : h;
      uv.setXY(i, uv.getX(i) * sx / o.uvScale[0], uv.getY(i) * sy / o.uvScale[1]);
    }
  }
  (o.parent || G.scene).add(m);
  return m;
}
export function collider(cx, cz, w, d, yaw = 0, y0 = 0, y1 = 3, extra = {}) {
  const b = makeBox(cx, cz, w, d, yaw, y0, y1, extra);
  G.colliders.push(b); return b;
}
export function plane(w, h, mat, x, y, z, ry = 0, o = {}) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  m.position.set(x, y, z); m.rotation.y = ry; m.receiveShadow = true;
  if (o.rx) m.rotation.x = o.rx;
  (o.parent || G.scene).add(m); return m;
}

// ---------------- floor with planar reflection + dirt layer ----------------
// opts (other levels): mat (floor material), hole (false: no stairwell), refl (reflection strength), uv(x, z) -> [u, v]
export function buildFloor(opts = {}) {
  const B = G.bounds, S = opts.rect || B;
  const shape = new THREE.Shape();
  shape.moveTo(S.minX, -S.minZ); shape.lineTo(S.maxX, -S.minZ); shape.lineTo(S.maxX, -S.maxZ); shape.lineTo(S.minX, -S.maxZ); shape.closePath();
  if (opts.hole !== false) {
    const hole = new THREE.Path(); // stairwell (shape coords use -z)
    hole.moveTo(10.5, -7.5); hole.lineTo(10.5, -12.4); hole.lineTo(16.5, -12.4); hole.lineTo(16.5, -7.5); hole.closePath();
    shape.holes.push(hole);
  }
  const geo = new THREE.ShapeGeometry(shape);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position, uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) { if (opts.uv) uv.setXY(i, ...opts.uv(pos.getX(i), pos.getZ(i))); else uv.setXY(i, pos.getX(i) / 4, pos.getZ(i) / 4); } // 0.5 m tiles
  const mat = opts.mat || L.mats.floor;
  // (a second floor in the same level shares the first one's uniforms: same dirt, polish mask, reflection; its own shine)
  const uniforms = opts.share ? { ...opts.share, reflStrength: { value: opts.refl ?? 1.3 } } : {
    tReflect: { value: R.reflRT.texture }, reflMatrix: { value: new THREE.Matrix4() }, reflStrength: { value: opts.refl ?? 1.3 },
    tDirt: { value: FX.dirtTex }, tWet: { value: FX.wetTex }, tRough: { value: null }, uTool: GLOW.uTool, uClean: GLOW.uClean, uTime: GLOW.uTime, dirtRect: { value: new THREE.Vector4(B.minX, B.minZ, B.maxX - B.minX, B.maxZ - B.minZ) },
  };
  mat.userData.uniforms = uniforms;
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform mat4 reflMatrix; varying vec4 vReflUv; varying vec3 vWPos;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWPos=(modelMatrix*vec4(transformed,1.0)).xyz; vReflUv=reflMatrix*vec4(vWPos,1.0);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D tReflect; uniform sampler2D tDirt; uniform sampler2D tWet; uniform sampler2D tRough; uniform float uTool; uniform vec4 dirtRect; uniform float reflStrength; uniform vec4 uClean; uniform float uTime; varying vec4 vReflUv; varying vec3 vWPos;' + GOLD_GLSL)
      .replace('#include <map_fragment>', `#include <map_fragment>
        vec2 duv=(vWPos.xz-dirtRect.xy)/dirtRect.zw; vec4 dirt=texture2D(tDirt,duv); dirt.a=min(1.0,dirt.a*1.3); // smudges read a little stronger
        diffuseColor.rgb=mix(diffuseColor.rgb,dirt.rgb,dirt.a);
        vec4 wet=texture2D(tWet,duv);
        diffuseColor.rgb=mix(diffuseColor.rgb,wet.rgb,wet.a);
        // worn polish: a faint milky haze where the shine has gone
        float rough=texture2D(tRough,duv).r;
        rough=smoothstep(0.08,0.6,rough); // worn floor is properly dull; buffed floor fully shiny
        { vec2 sp=vWPos.xz*vec2(9.0,2.2); float sw=fract(sin(dot(floor(sp),vec2(127.1,311.7)))*43758.5453); rough*=0.88+0.12*sw; } // scuffed, uneven
        { // worn, dull wax: a duller, greyer, slightly darker surface with buffer swirls and scuffs in it
          vec2 q=vWPos.xz*11.0; float n1=fract(sin(dot(floor(q),vec2(12.9898,78.233)))*43758.5453);
          float sw=0.5+0.5*sin(length(fract(vWPos.xz*0.9)-0.5)*38.0+n1*2.0);
          vec3 worn=diffuseColor.rgb*vec3(0.40,0.38,0.35)+vec3(0.03,0.026,0.02); // old, grimy wax: much darker than the polished stone
          worn*=1.0-0.1*n1-0.07*sw;
          diffuseColor.rgb=mix(diffuseColor.rgb,worn,rough);
        }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor=mix(roughnessFactor,1.0,rough);\nroughnessFactor=mix(roughnessFactor,0.92,dirt.a);\nroughnessFactor=mix(roughnessFactor,0.015,wet.a);')
      .replace('#include <opaque_fragment>', `
        vec2 ruv=vReflUv.xy/vReflUv.w;
        float br=0.004+roughnessFactor*0.035;
        // (each tap clamped: a mirrored glint off the gold bars can be near the half-float limit)
        #define RT(o) min(texture2D(tReflect,ruv+(o)).rgb,vec3(24.0))
        vec3 refl=RT(vec2(0.0))*0.36;
        refl+=RT(vec2(br,0.0))*0.16; refl+=RT(vec2(-br,0.0))*0.16;
        refl+=RT(vec2(0.0,br))*0.16; refl+=RT(vec2(0.0,-br))*0.16;
        float NdV=saturate(dot(normal,normalize(vViewPosition)));
        float fres=0.32+0.68*pow(1.0-NdV,3.0);
        float k=reflStrength*fres*(1.0-roughnessFactor)*(1.0-dirt.a*(1.0-wet.a))*(1.0-rough);
        // blood: deep red body, glossy with angle-dependent shine (like real liquid)
        float kw=wet.a*reflStrength*(0.12+0.88*pow(1.0-NdV,2.0));
        refl=mix(refl,refl*vec3(1.0,0.32,0.3),wet.a*0.7);
        k=mix(k,kw,wet.a);
        outgoingLight=outgoingLight*(1.0-k*0.35)+refl*k;
        // while Karim mops, the mess around him lights up gold so you can see what's left
        // (mop: smudges, prints and the dull patches it buffs back to a shine)
        // gold: what the tool in hand can clean; red: what needs another tool (mop: prints, smudges, dull floor)
        float isMop = uTool < 0.5 ? 1.0 : 0.0, dA = smoothstep(0.05,0.55,dirt.a);
        outgoingLight=cleanGlow(outgoingLight,vWPos.xz,uClean,uTime,max(dA,rough*0.4)*isMop);
        outgoingLight=sheenSweep(outgoingLight,vWPos.xz,uClean,uTime,rough*isMop*0.8); // (the mop buffs dull floor: a sheen sweeps over it)
        outgoingLight=wrongGlow(outgoingLight,vWPos.xz,uClean,uTime,max(dA,rough*0.45)*(1.0-isMop));
        #include <opaque_fragment>`);
  };
  const floor = new THREE.Mesh(geo, mat);
  floor.receiveShadow = true;
  floor.userData.noReflect = true;
  G.scene.add(floor);
  (R.floorUs = R.floorUs || []).push({ u: uniforms, s0: uniforms.reflStrength.value });
  if (!opts.share) { R.floor = floor; R.floorMat = mat; }
  return { mesh: floor, mat, uniforms };
}

// ---------------- the staff stairwell ----------------
export const STAIR_DOOR = { x0: -5.75, x1: -3.55, cx: -4.65 };
// behind the fire doors: a landing, the flight down to the basement on the left, the flight up on the right
function stairwell(SD, wallH) {
  const B = G.bounds, z0 = B.minZ - 0.5, W = 2.7, x0 = SD.cx - W / 2, x1 = SD.cx + W / 2, z1 = z0 - 5.2;
  const conc = new THREE.MeshStandardMaterial({ color: 0x8f8a82, roughness: 0.8 }), wallM = new THREE.MeshStandardMaterial({ color: 0xc8c2b6, roughness: 0.85 });
  const rail = new THREE.MeshStandardMaterial({ color: 0x2c3036, roughness: 0.4, metalness: 0.7 });
  box(W, 0.1, 1.9, conc, SD.cx, -0.05, z0 - 0.95, { cast: false }); // landing
  const hw = W / 2 - 0.08, run = 0.3, rise = 0.18, zs = z0 - 1.9;
  const nose = [], nb = (x, y, z) => { const g = new THREE.BoxGeometry(hw - 0.02, 0.014, 0.05); g.translate(x, y, z); nose.push(g); };
  for (let i = 0; i < 11; i++) {
    box(hw, 0.36, run, conc, x0 + hw / 2 + 0.04, -rise * (i + 1) - 0.18, zs - run * (i + 0.5), { cast: false });            // down
    box(hw, rise * (i + 1), run, conc, x1 - hw / 2 - 0.04, rise * (i + 1) / 2, zs - run * (i + 0.5));                     // up
    nb(x0 + hw / 2 + 0.04, -rise * (i + 1) + 0.007, zs - run * (i + 1) + 0.025);  // metal nosing on each tread's edge (so the steps read)
    nb(x1 - hw / 2 - 0.04, rise * (i + 1) + 0.007, zs - run * i - 0.025);
  }
  { const pos = [], idx = []; let o = 0; // (one mesh for all the nosings)
    for (const g of nose) { const p = g.attributes.position.array, ix = g.index.array; for (const v of p) pos.push(v); for (const k of ix) idx.push(k + o); o += p.length / 3; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xc9ccd0, roughness: 0.35, metalness: 0.7 })); m.receiveShadow = true; G.scene.add(m); }
  const DN = 2.6; // (the walls run on down past the lower flight, so the stairs never float over nothing)
  box(0.12, 1.0 + DN, z0 - 1.9 - z1, wallM, SD.cx, (1.0 - DN) / 2, (zs + z1) / 2); // the wall between the flights, a handrail on it
  box(0.05, 0.05, zs - z1, rail, SD.cx, 1.05, (zs + z1) / 2, { cast: false });
  for (const x of [x0 - 0.1, x1 + 0.1]) box(0.2, wallH + DN, z0 - z1, wallM, x, (wallH - DN) / 2, (z0 + z1) / 2);
  box(W + 0.4, wallH + DN, 0.2, wallM, SD.cx, (wallH - DN) / 2, z1 - 0.1);
  box(W / 2, 0.1, 1.2, conc, x0 + W / 4, -rise * 11 - 0.05, z1 + 0.6, { cast: false }); // the turn at the bottom
  // the handrail down the lower flight (on the outside wall)
  { const g = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, Math.hypot(zs - z1, rise * 11), 8), rail);
    g.rotation.x = Math.PI / 2 - Math.atan2(rise * 11, zs - z1); g.position.set(x0 + 0.06, 0.9 - rise * 5.5, (zs + z1) / 2); G.scene.add(g); }
  const l = new THREE.PointLight(0xffd6a0, 9, 6, 2); l.position.set(SD.cx, 2.3, z0 - 1.2); G.scene.add(l);
  L.stairBar = collider(SD.cx, z0 - 0.95 - 1.1, W, 0.3); collider(x0 - 0.1, (z0 + z1) / 2, 0.2, z0 - z1); collider(x1 + 0.1, (z0 + z1) / 2, 0.2, z0 - z1);
  // (for Karim's arrival: he runs up the lower flight, across the landing and out through the doors)
  L.stairs = { light: l, light0: l.position.clone(), fx: x0 + hw / 2 + 0.04, zTop: zs, zBot: z1, rise, run, steps: 11, z0 };
  L.stairDoor = fireDoor(SD.cx, B.minZ, collider(SD.cx, B.minZ - 0.12, SD.x1 - SD.x0, 0.24), { signY: 2.62 });
}
export function updateStairDoor(dt) { if (L.stairDoor) L.stairDoor.update(dt); }

// ---------------- architecture ----------------
function buildArchitecture() {
  const M = L.mats, B = G.bounds;
  // North wall (with vault opening between x 8.4..11.6, up to 3.4m)
  const wallH = 7;
  box(B.maxX - B.minX + 0.6, 0.15, 0.6, M.cap, 0, wallH + 0.07, B.minZ - 0.3);
  const nw = (x0, x1, y0, y1, mat = M.stoneDark) => box(x1 - x0, y1 - y0, 0.5, mat, (x0 + x1) / 2, (y0 + y1) / 2, B.minZ - 0.25, { uvScale: [3, 3.5], uvWorld: true });
  nw(B.minX - 0.3, -6.5, 0, wallH, M.stoneLight); // office back wall: lighter
  // elevator openings at x -2.4..-0.8 and 0.8..2.4 (2.8 m high)
  // the staff stairwell (fire doors between the offices and the lifts: up to the floors above, down to the basement)
  const SD = STAIR_DOOR;
  nw(-6.5, SD.x0, 0, wallH); nw(SD.x1, -2.4, 0, wallH); nw(SD.x0, SD.x1, 2.45, wallH);
  nw(-0.8, 0.8, 0, wallH); nw(2.4, 8.4, 0, wallH); nw(-2.4, -0.8, 2.8, wallH); nw(0.8, 2.4, 2.8, wallH);
  nw(11.6, B.maxX + 0.3, 0, wallH); nw(8.4, 11.6, 3.4, wallH);
  collider((B.minX - 2 + SD.x0) / 2, B.minZ - 0.25, SD.x0 - B.minX + 2, 0.5); collider((SD.x1 - 2.4) / 2, B.minZ - 0.25, -2.4 - SD.x1, 0.5);
  collider(0, B.minZ - 0.25, 1.6, 0.5); collider(11.2, B.minZ - 0.25, 17.6, 0.5);
  stairwell(SD, wallH);
  // skirting
  box(B.maxX - B.minX, 0.12, 0.04, M.cap, 0, 0.06, B.minZ + 0.02, { cast: false });

  // West facade: mullions + glass + transoms (entrance doors in bay z 7..11)
  const fx = B.minX;
  for (let z = B.minZ; z <= B.maxZ + 0.01; z += 2) {
    box(0.16, wallH, 0.14, M.darkMetal, fx, wallH / 2, z);
  }
  box(0.2, 0.2, B.maxZ - B.minZ, M.darkMetal, fx, wallH, 0);
  box(0.18, 0.16, B.maxZ - B.minZ, M.darkMetal, fx, 3.1, 0);
  box(0.2, 0.1, B.maxZ - B.minZ, M.darkMetal, fx, 0.05, 0);
  for (let z = B.minZ + 1; z < B.maxZ; z += 2) {
    const door = z > 7 && z < 11;
    const up = plane(1.86, wallH - 3.2, M.facadeGlass, fx, 3.2 + (wallH - 3.2) / 2, z, Math.PI / 2); up.userData.noAO = true; up.castShadow = false;
    if (!door) { const lo = plane(1.86, 3.0, M.facadeGlass, fx, 1.55, z, Math.PI / 2); lo.userData.noAO = true; }
  }
  // open entrance door leaves
  for (const [z, s] of [[7.05, 1], [10.95, -1]]) {
    const leaf = new THREE.Group();
    leaf.position.set(fx, 0, z); leaf.rotation.y = s * 1.1;
    G.scene.add(leaf);
    const g = plane(1.0, 2.8, M.facadeGlass, 0, 1.45, 0.5 * s, Math.PI / 2, { parent: leaf }); g.userData.noAO = true;
    box(0.05, 2.9, 0.05, M.darkMetal, 0, 1.45, 0.98 * s, { parent: leaf });
    box(0.03, 0.9, 0.04, M.steel, 0.06, 1.1, 0.85 * s, { parent: leaf });
  }
  collider(fx - 0.3, 0, 0.6, 30);

  // low cut-away walls on camera-facing sides
  box(0.4, 1.0, B.maxZ - B.minZ + 0.4, M.stoneDark, B.maxX + 0.2, 0.5, 0, { uvScale: [3, 1] });
  box(0.48, 0.08, B.maxZ - B.minZ + 0.5, M.cap, B.maxX + 0.2, 1.02, 0);
  box(B.maxX - B.minX, 1.0, 0.4, M.stoneDark, 0, 0.5, B.maxZ + 0.2, { uvScale: [3, 1] });
  box(B.maxX - B.minX + 0.5, 0.08, 0.48, M.cap, 0, 1.02, B.maxZ + 0.2);
  collider(B.maxX + 0.2, 0, 0.4, 30); collider(0, B.maxZ + 0.2, 40, 0.4);

  // Ceiling — only visible to the environment probe (layer 1)
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(36, 26), M.ceiling);
  ceil.rotation.x = Math.PI / 2; ceil.position.y = wallH; ceil.layers.set(1); G.scene.add(ceil);
  for (let x = -14; x <= 14; x += 7) for (let z = -9; z <= 9; z += 6) {
    const lp = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.5), M.lightPanel);
    lp.rotation.x = Math.PI / 2; lp.position.set(x, wallH - 0.02, z); lp.layers.set(1); G.scene.add(lp);
  }

  // slogan wall panel (north wall, east of the elevators)
  const ps = signTex(256, 640, '#22252a', [
    { text: 'STEADFAST', size: 38, color: '#d8c79e', spacing: 4 }, { text: 'SINCE 1924', size: 26, color: '#a99a78', spacing: 6 }, { gap: 70 },
    { text: 'Private Banking', size: 26, color: '#c9c9c9', weight: 400 }, { text: 'Wealth Management', size: 26, color: '#c9c9c9', weight: 400 },
    { text: 'Family Office', size: 26, color: '#c9c9c9', weight: 400 },
  ], { top: 110, draw: (x, w) => { x.strokeStyle = '#b9a57a'; x.lineWidth = 2; x.strokeRect(22, 22, w - 44, 596); x.fillStyle = '#b9a57a'; x.fillRect(w * 0.35, 238, w * 0.3, 2); x.beginPath(); x.moveTo(w / 2, 52); x.lineTo(w / 2 + 16, 76); x.lineTo(w / 2, 100); x.lineTo(w / 2 - 16, 76); x.closePath(); x.stroke(); } });
  box(1.3, 3.4, 0.1, M.stonePillar, 5.6, 2.3, B.minZ + 0.05);
  plane(1.0, 2.5, new THREE.MeshStandardMaterial({ map: ps, roughness: 0.5 }), 5.6, 2.4, B.minZ + 0.11, 0);

  // Sunken reflecting pond (SE), guarded by the railings
  buildPond(10.5, 16.5, 7.5, 12.4);

  // Office glass partitions (destructible) — the expensive stuff
  const runs = [
    { axis: 'x', fixed: -4.5, from: -17.75, to: -11.25, n: 4 }, { axis: 'x', fixed: -4.5, from: -9.75, to: -6.5, n: 2 },
    { axis: 'z', fixed: -6.5, from: -12.95, to: -8.5, n: 3 }, { axis: 'z', fixed: -6.5, from: -7.0, to: -4.5, n: 2 },
    // manager's office (east of vault)
    { axis: 'z', fixed: 12.5, from: -12.95, to: -9.6, n: 2 }, { axis: 'z', fixed: 12.5, from: -8.1, to: -6.0, n: 1 },
    { axis: 'x', fixed: -6.0, from: 12.5, to: 17.95, n: 4 },
  ];
  const frost = makeCanvas(64, 256), fc = frost.getContext('2d');
  fc.fillStyle = '#fff'; fc.fillRect(0, 0, 64, 256);
  fc.fillStyle = '#b8c4c8'; fc.fillRect(0, 256 * (1 - 1.25 / 2.6), 64, 256 * (0.25 / 2.6));
  fc.fillStyle = '#d6dde0'; fc.fillRect(0, 256 * (1 - 0.9 / 2.6), 64, 4);
  const frostTex = canvasTex(frost);
  for (const r of runs) {
    const len = (r.to - r.from) / r.n;
    for (let i = 0; i <= r.n; i++) {
      const t = r.from + len * i;
      const [x, z] = r.axis === 'x' ? [t, r.fixed] : [r.fixed, t];
      box(0.07, 2.75, 0.07, M.darkMetal, x, 1.375, z);
    }
    const [cx, cz] = r.axis === 'x' ? [(r.from + r.to) / 2, r.fixed] : [r.fixed, (r.from + r.to) / 2];
    const rl = r.to - r.from;
    box(r.axis === 'x' ? rl : 0.08, 0.08, r.axis === 'x' ? 0.08 : rl, M.darkMetal, cx, 2.72, cz);
    box(r.axis === 'x' ? rl : 0.06, 0.06, r.axis === 'x' ? 0.06 : rl, M.darkMetal, cx, 0.03, cz, { cast: false });
    for (let i = 0; i < r.n; i++) {
      const t = r.from + len * (i + 0.5);
      const [x, z] = r.axis === 'x' ? [t, r.fixed] : [r.fixed, t];
      const yaw = r.axis === 'x' ? 0 : Math.PI / 2;
      const mat = M.glass.clone(); mat.map = frostTex; mat.opacity = 0.32;
      const pane = new THREE.Mesh(new THREE.BoxGeometry(len - 0.08, 2.6, 0.02), mat);
      pane.position.set(x, 1.36, z); pane.rotation.y = yaw; pane.userData.noAO = true;
      pane.castShadow = false; pane.receiveShadow = false;
      G.scene.add(pane);
      const b = collider(x, z, len - 0.04, 0.12, yaw, 0, 2.7);
      addDestructible({ kind: 'glass', obj: pane, box: b, cost: 2400, name: 'Glass partition', w: len - 0.08, h: 2.6, yaw });
    }
  }
  // doorway headers already covered by top rail; add solid colliders for posts at doorways implicitly via panes

  // Elevators: mirror doors recessed into the wall slide into pockets when Karim walks up; a lit cab waits behind
  const mirror = new THREE.MeshStandardMaterial({ color: 0xe2e0dc, roughness: 0.07, metalness: 1, envMapIntensity: 1.8 });
  const cabMirror = new THREE.MeshStandardMaterial({ color: 0xd8d6d2, roughness: 0.04, metalness: 1, envMapIntensity: 1.3 });
  const cabSteel = new THREE.MeshStandardMaterial({ color: 0xbdb6aa, roughness: 0.3, metalness: 1, roughnessMap: M.steel.roughnessMap, envMapIntensity: 0.9 });
  const cabFloor = new THREE.MeshStandardMaterial({ color: 0x8a8580, roughness: 0.3, map: M.stoneDark.map, envMapIntensity: 0.6 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xd7a85a, roughness: 0.25, metalness: 1, envMapIntensity: 1.3 });
  const surround = M.stonePillar;
  L.elevators = [];
  for (const x of [-1.6, 1.6]) {
    const D = 0.32, zf = B.minZ + D; // surround protrudes D from the wall
    box(0.26, 3.05, D, surround, x - 0.93, 1.525, B.minZ + D / 2);
    box(0.26, 3.05, D, surround, x + 0.93, 1.525, B.minZ + D / 2);
    box(2.12, 0.55, D, surround, x, 3.32, B.minZ + D / 2);
    box(1.62, 0.04, D + 0.5, M.darkMetal, x, 0.02, B.minZ + D / 2 - 0.25, { cast: false }); // sill through the wall
    box(1.62, 0.26, 0.1, M.darkMetal, x, 2.91, B.minZ - 0.01); // door track / transom
    // the two leaves, set 6 cm into the wall
    const zd = B.minZ - 0.06;
    const lw = box(0.8, 2.78, 0.05, mirror, x - 0.405, 1.39, zd), rw = box(0.8, 2.78, 0.05, mirror, x + 0.405, 1.39, zd);
    // dark rubber seals on the meeting edges, proud of the leaf so no faces coincide (coplanar faces flickered as the doors slid)
    box(0.006, 2.776, 0.054, M.darkMetal, 0.401, 0, 0, { parent: lw, cast: false }); // one seal, on the left leaf only
    collider(x - 0.93, B.minZ + D / 2, 0.26, D); collider(x + 0.93, B.minZ + D / 2, 0.26, D);
    const doorCol = collider(x, zd, 1.62, 0.14);
    box(0.42, 0.3, 0.02, M.black, x, 3.32, zf + 0.01, { cast: false });
    const ind = signTex(128, 96, '#0c0c0c', [{ text: 'L', size: 64, color: '#ff3b2e' }], { top: 22 });
    plane(0.36, 0.27, new THREE.MeshBasicMaterial({ map: ind, toneMapped: false }), x, 3.32, zf + 0.022);
    const callMat = new THREE.MeshBasicMaterial({ color: 0x5a3a20, toneMapped: false });
    plane(0.1, 0.24, callMat, x + 0.93, 1.2, zf + 0.005);
    // the cab, behind the wall (front at the wall's back face)
    const c0 = B.minZ - 0.5, dep = 1.75, cz = c0 - dep / 2, cw = 1.9, ch = 2.72;
    box(cw + 0.12, 0.06, dep + 0.02, cabFloor, x, -0.01, cz, { cast: false });
    box(cw + 0.12, ch + 0.1, 0.06, cabSteel, x, ch / 2, c0 - dep - 0.03);
    box(cw - 0.5, 1.35, 0.02, cabMirror, x, 1.62, c0 - dep + 0.01, { cast: false });
    for (const sx of [-1, 1]) {
      box(0.06, ch + 0.1, dep, cabSteel, x + sx * (cw / 2 + 0.03), ch / 2, cz);
      box(0.012, ch, 0.012, M.darkMetal, x + sx * (cw / 2 - 0.004), ch / 2, cz, { cast: false }); // panel seam
      const rail = box(0.035, 0.035, dep - 0.3, brass, x + sx * (cw / 2 - 0.06), 0.92, cz, { cast: false });
    }
    box(cw - 0.3, 0.035, 0.035, brass, x, 0.92, c0 - dep + 0.07, { cast: false });
    box(cw + 0.12, 0.06, dep + 0.02, M.darkMetal, x, ch + 0.03, cz);
    plane(cw - 0.45, dep - 0.45, new THREE.MeshBasicMaterial({ color: 0xc8bba8, toneMapped: false }), x, ch - 0.002, cz, 0, { rx: Math.PI / 2 });
    // button panel on the side wall
    box(0.02, 0.5, 0.16, M.darkMetal, x + cw / 2 - 0.01, 1.25, c0 - 0.3, { cast: false });
    const light = new THREE.PointLight(0xffe8cc, 0, 5, 2); light.position.set(x, ch - 0.35, cz); G.scene.add(light);
    collider(x - (cw / 2 + 0.03), cz, 0.14, dep + 0.2); collider(x + (cw / 2 + 0.03), cz, 0.14, dep + 0.2); collider(x, c0 - dep - 0.03, cw + 0.3, 0.14);
    L.elevators.push({ x, l: lw, r: rw, col: doorCol, light, call: callMat, cabZ: cz, open: 0, chime: false });
  }
  // Bank name over the elevators: halo-lit brass letters, the noon emblem above, the Arabic name below
  G.scene.add(buildNoonSign(0, 4.5, B.minZ + 0.02));
  // Directory sign
  // the user's directory sign model (5 floors, L lobby, B basement)
  {
    const sg = L.models.Sign.clone();
    sg.traverse(o => { if (o.isMesh) {
      o.castShadow = true; o.receiveShadow = true;
      o.material = o.material.clone();
      if (o.material.map) { o.material.emissiveMap = o.material.map; o.material.emissive = new THREE.Color(0xffffff); o.material.emissiveIntensity = 0.45; o.material.metalness = 0.1; o.material.roughness = 0.35; o.material.depthWrite = false; o.renderOrder = 2; }
      else { o.material.roughness = 0.32; o.material.metalness = 0.6; }
    } });
    const bx = new THREE.Box3().setFromObject(sg), sc = 3.4 / (bx.max.y - bx.min.y);
    sg.scale.setScalar(sc);
    sg.position.set(3.75 - (bx.min.x + bx.max.x) / 2 * sc, 0, B.minZ - bx.min.z * sc + 0.02);
    G.scene.add(sg);
  }
  // Motto banner
  const motto = signTex(400, 800, '#d9d6d0', [
    { text: 'PEOPLE', size: 62, color: '#3a3a3a', spacing: 6 }, { text: '·', size: 50, color: '#b39a6a' },
    { text: 'INTEGRITY', size: 62, color: '#3a3a3a', spacing: 4 }, { text: '·', size: 50, color: '#b39a6a' },
    { text: 'PROGRESS', size: 62, color: '#3a3a3a', spacing: 4 },
    { gap: 60 },
    { text: 'SERVING MIAMI', size: 30, color: '#6a6a6a', spacing: 6, weight: 400 }, { text: 'SINCE 1924', size: 30, color: '#6a6a6a', spacing: 6, weight: 400 },
  ], { top: 90 });
  box(1.5, 3.0, 0.08, new THREE.MeshStandardMaterial({ map: motto, roughness: 0.6 }), -4.3 + 0.0, 4.6, B.minZ + 0.05); // (above the stairwell doors)

  // Vault (NE): opening, interior, big round open door
  const vault = new THREE.Group(); G.scene.add(vault);
  box(3.2, 3.4, 0.1, M.black, 10, 1.7, B.minZ - 4.2, { parent: vault, cast: false });
  box(0.1, 3.4, 4, M.stoneDark, 8.4, 1.7, B.minZ - 2.2, { parent: vault });
  box(0.1, 3.4, 4, M.stoneDark, 11.6, 1.7, B.minZ - 2.2, { parent: vault });
  box(3.2, 0.1, 4, M.stoneDark, 10, 3.4, B.minZ - 2.2, { parent: vault, cast: false });
  const bars = []; // [x, y, z, yaw]
  for (let s = 0; s < 3; s++) {
    box(0.5, 0.05, 3.4, M.darkMetal, 8.75, 0.6 + s * 0.8, B.minZ - 2.3, { parent: vault });
    box(0.5, 0.05, 3.4, M.darkMetal, 11.25, 0.6 + s * 0.8, B.minZ - 2.3, { parent: vault });
    for (let k = 0; k < 6; k++) {
      bars.push([8.75 + (Math.random() - 0.5) * 0.2, 0.625 + s * 0.8, B.minZ - 0.9 - k * 0.5, (Math.random() - 0.5) * 0.2]);
      if (k % 2) bars.push([11.25, 0.625 + s * 0.8, B.minZ - 1.1 - k * 0.5, (Math.random() - 0.5) * 0.2]);
    }
  }
  const vfloor = plane(3.2, 4.2, M.stoneDark, 10, 0.002, B.minZ - 2.1, 0, { rx: -Math.PI / 2 });
  const vl = new THREE.PointLight(0xfff0d8, 26, 8, 1.6); vl.position.set(10, 3.0, B.minZ - 2.2); G.scene.add(vl);
  // round door, hinged at x=11.6, swung open to face +x
  const door = new THREE.Group(); door.position.set(11.75, 1.7, B.minZ + 0.05); door.rotation.y = -Math.PI / 2 + 0.25; G.scene.add(door);
  const dmesh = new THREE.Mesh(new THREE.CylinderGeometry(1.55, 1.55, 0.55, 48), M.steel);
  dmesh.rotation.x = Math.PI / 2; dmesh.position.set(-1.6, 0, 0.3); dmesh.castShadow = true; door.add(dmesh);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.2, 24), M.darkMetal); hub.rotation.x = Math.PI / 2; hub.position.set(-1.6, 0, 0.64); door.add(hub);
  for (let i = 0; i < 3; i++) { const sp = box(1.3, 0.08, 0.08, M.steel, -1.6, 0, 0.75, { parent: door }); sp.rotation.z = i * Math.PI / 3; }
  for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.5, 12), M.steel); bolt.rotation.z = a; bolt.position.set(-1.6 + Math.cos(a) * 1.6, Math.sin(a) * 1.6, 0.3); bolt.rotation.set(0, 0, a + Math.PI / 2); door.add(bolt); }
  box(0.4, 1.0, 0.3, M.darkMetal, -0.05, 0.6, 0.25, { parent: door }); box(0.4, 1.0, 0.3, M.darkMetal, -0.05, -0.6, 0.25, { parent: door });
  collider(12.0, B.minZ + 1.55, 0.7, 3.1, 0.25);
  // vault frame ring on wall
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.62, 0.12, 12, 48), M.steel); ring.position.set(10, 1.7, B.minZ + 0.02); G.scene.add(ring);
  // stacked gold bars on the vault floor (pyramids)
  for (const [gx, gz] of [[9.3, -15.6], [10.7, -15.4], [10.0, -16.6]]) {
    // proper bullion stacks: each layer turned 90 degrees to the one below, narrowing towards the top
    for (let l = 0; l < 7; l++) {
      const along = l % 2 === 0, nA = Math.max(1, 4 - (l >> 1)), nB = Math.max(1, 3 - ((l + 1) >> 1));
      for (let i = 0; i < nA; i++) for (let j = 0; j < nB; j++) {
        const u = (i - (nA - 1) / 2) * 0.225, v = (j - (nB - 1) / 2) * 0.31;
        bars.push(along ? [gx + u, l * 0.05, gz + v, (Math.random() - 0.5) * 0.04] : [gx + v, l * 0.05, gz + u, Math.PI / 2 + (Math.random() - 0.5) * 0.04]);
      }
    }
  }
  goldBars(bars);

  // Reception / teller counter (east of atrium): fluted cream stone, black marble ledge, brass trim, glass teller screens
  const rx = 7.6, rz0 = -0.6, rz1 = 4.6, rl = rz1 - rz0, rzc = (rz0 + rz1) / 2;
  {
    // fluted stone texture (vertical flutes, 8 per tile)
    const fc = makeCanvas(256, 256), fx = fc.getContext('2d');
    fx.fillStyle = '#d9d1c3'; fx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 8; i++) {
      const g = fx.createLinearGradient(i * 32, 0, i * 32 + 32, 0);
      g.addColorStop(0, 'rgba(70,55,35,0.30)'); g.addColorStop(0.18, 'rgba(255,255,255,0.10)'); g.addColorStop(0.5, 'rgba(255,255,255,0.22)'); g.addColorStop(0.85, 'rgba(60,45,30,0.12)'); g.addColorStop(1, 'rgba(50,40,25,0.38)');
      fx.fillStyle = g; fx.fillRect(i * 32, 0, 32, 256);
    }
    for (let i = 0; i < 400; i++) { fx.fillStyle = `rgba(120,100,70,${Math.random() * 0.06})`; fx.fillRect(Math.random() * 256, Math.random() * 256, 2, 2 + Math.random() * 6); }
    const fluted = new THREE.MeshStandardMaterial({ map: canvasTex(fc, true, true), roughness: 0.45, envMapIntensity: 0.9 });
    const blackMarble = new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.1, metalness: 0.0, envMapIntensity: 1.6 });
    const brass = new THREE.MeshStandardMaterial({ color: 0xd2a659, roughness: 0.22, metalness: 1, envMapIntensity: 1.5 });
    const walnut = new THREE.MeshStandardMaterial({ color: 0x4a2f1e, roughness: 0.38, map: fabricTex('#5a3a25', 'rgba(0,0,0,0.1)'), envMapIntensity: 0.9 });
    const cabinet = new THREE.MeshStandardMaterial({ color: 0x2a221d, roughness: 0.6 });
    const ledLine = new THREE.MeshBasicMaterial({ color: 0xffd9a0, toneMapped: false });
    const glass = M.glass.clone(); glass.opacity = 0.22;
    // counter body, recessed plinth and warm light strip
    box(0.62, 0.95, rl, fluted, rx, 0.575, rzc, { uvScale: [0.4, 0.95] });
    box(0.5, 0.1, rl - 0.05, M.black, rx + 0.05, 0.05, rzc, { cast: false });
    box(0.02, 0.012, rl - 0.1, ledLine, rx - 0.215, 0.1, rzc, { cast: false });
    // brass trims + black marble transaction ledge (overhangs the customer side)
    box(0.012, 0.03, rl, brass, rx - 0.316, 1.0, rzc);
    box(0.012, 0.03, rl, brass, rx - 0.316, 0.16, rzc);
    box(0.78, 0.05, rl + 0.08, blackMarble, rx - 0.08, 1.075, rzc);
    box(0.79, 0.008, rl + 0.09, brass, rx - 0.08, 1.047, rzc, { cast: false });
    // teller glass screens with brass posts and a gap above the ledge for documents
    for (let i = 0; i <= 3; i++) { const z = rz0 + 0.05 + i * ((rl - 0.1) / 3); box(0.04, 0.62, 0.04, brass, rx + 0.12, 1.41, z); }
    for (let i = 0; i < 3; i++) {
      const z = rz0 + 0.05 + (i + 0.5) * ((rl - 0.1) / 3), w = (rl - 0.1) / 3 - 0.06;
      const p = plane(w, 0.48, glass, rx + 0.12, 1.42, z, Math.PI / 2); p.userData.noAO = true; p.castShadow = false;
    }
    box(0.05, 0.03, rl - 0.06, brass, rx + 0.12, 1.715, rzc);
    // staff workstation behind: cabinets + walnut desk top + modesty panel
    box(0.78, 0.7, rl - 0.4, cabinet, rx + 0.95, 0.35, rzc - 0.2);
    box(0.84, 0.05, rl - 0.36, walnut, rx + 0.95, 0.725, rzc - 0.2);
    // matching end return (replaces the old stone block)
    box(1.55, 0.95, 0.62, fluted, rx + 0.47, 0.575, rz1 + 0.31, { uvScale: [0.4, 0.95] });
    box(1.45, 0.1, 0.5, M.black, rx + 0.5, 0.05, rz1 + 0.31, { cast: false });
    box(1.6, 0.05, 0.7, blackMarble, rx + 0.45, 1.075, rz1 + 0.31);
    box(1.55, 0.03, 0.012, brass, rx + 0.47, 1.0, rz1 + 0.626);
    box(1.55, 0.03, 0.012, brass, rx + 0.47, 0.16, rz1 + 0.626);
    box(1.45, 0.012, 0.02, ledLine, rx + 0.5, 0.1, rz1 + 0.54, { cast: false });
    // brass lettering on the customer-facing front
    const lt = signTex(1024, 160, 'rgba(0,0,0,0)', [
      { text: 'NOON BANK', size: 70, color: '#e0b96a', spacing: 18 },
      { text: 'TELLER SERVICES', size: 34, color: '#c9a35c', spacing: 10, weight: 400 },
    ], { top: 8 });
    plane(2.6, 0.41, new THREE.MeshStandardMaterial({ map: lt, transparent: true, metalness: 0.9, roughness: 0.25, emissive: 0x3a2a10, emissiveMap: lt }), rx - 0.318, 0.66, rzc, -Math.PI / 2);
  }
  collider(rx + 0.5, rzc + 0.3, 1.9, rl + 0.6, 0, 0, 1.15, { surface: 1.1 });
  contactShadow(2.2, rl + 0.9, 0.7, null, rx + 0.55, rzc + 0.25);
  G.surfaces.push(makeBox(rx - 0.08, rzc, 0.78, rl, 0, 0, 1.1, { y: 1.1 }));
  G.surfaces.push(makeBox(rx + 0.95, rzc - 0.2, 0.84, rl - 0.36, 0, 0, 0.75, { y: 0.75 }));

  // Freestanding welcome sign
  const sg = signTex(300, 520, '#2a2d32', [
    { text: 'WELCOME', size: 50, color: '#e0c48a', spacing: 6 },
    { gap: 30 },
    { text: 'BUILDING', size: 40, color: '#cfcfcf', spacing: 3 }, { text: 'A BRIGHTER', size: 40, color: '#cfcfcf', spacing: 3 }, { text: 'TOMORROW,', size: 40, color: '#cfcfcf', spacing: 3 },
    { text: 'TOGETHER', size: 40, color: '#cfcfcf', spacing: 3 },
    { gap: 40 },
    { text: 'NOON BANK · MIAMI', size: 18, color: '#9a9a9a', spacing: 3, weight: 400 },
  ], { top: 50 });
  // (stands just inside the entrance doors, facing the lobby)
  const SX = -17.3, SZ = 5.95, SR = Math.PI / 2;
  box(0.9, 1.6, 0.12, new THREE.MeshStandardMaterial({ color: 0x2a2d32, roughness: 0.5 }), SX, 0.8, SZ, { ry: SR });
  plane(0.8, 1.4, new THREE.MeshStandardMaterial({ map: sg, roughness: 0.5 }), SX + Math.sin(SR) * 0.065, 0.85, SZ + Math.cos(SR) * 0.065, SR);
  collider(SX, SZ, 0.9, 0.3, SR);
  contactShadow(0.95, 0.35, 0.5, null, SX, SZ, SR);

  // ambient occlusion along the bases of the tall walls
  {
    const S = 64, c = makeCanvas(4, S), x = c.getContext('2d'), g = x.createLinearGradient(0, 0, 0, S);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 4, S);
    const t = new THREE.CanvasTexture(c);
    const mat = new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: t, transparent: true, opacity: 0.45, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 });
    const strip = (len, cx, cz, yaw) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(len, 1.1), mat); m.rotation.set(-Math.PI / 2, 0, yaw); m.position.set(cx, 0.005, cz); m.userData.noAO = m.userData.noReflect = m.userData.noProbe = true; m.renderOrder = 1; G.scene.add(m); };
    strip(36, 0, B.minZ + 0.55, 0);              // north wall
    strip(26, B.minX + 0.55, 0, -Math.PI / 2);   // facade base
    for (const ex of [-1.6, 1.6]) contactShadow(2.2, 0.8, 0.55, null, ex, B.minZ + 0.4);
  }

  // Exterior: plaza, sky, distant city
  // outdoor ground with the building's footprint cut out (so the sunken pond isn't covered)
  const gs = new THREE.Shape(); gs.moveTo(-110, -110); gs.lineTo(110, -110); gs.lineTo(110, 110); gs.lineTo(-110, 110); gs.closePath();
  const fh = new THREE.Path(); fh.moveTo(B.minX + 0.05, -(B.minZ - 0.6)); fh.lineTo(B.maxX + 0.5, -(B.minZ - 0.6)); fh.lineTo(B.maxX + 0.5, -(B.maxZ + 0.5)); fh.lineTo(B.minX + 0.05, -(B.maxZ + 0.5)); fh.closePath();
  gs.holes.push(fh);
  const pg = new THREE.ShapeGeometry(gs); pg.rotateX(-Math.PI / 2);
  { const pp = pg.attributes.position, uv = pg.attributes.uv; for (let i = 0; i < pp.count; i++) uv.setXY(i, pp.getX(i) / 220 + 0.5, pp.getZ(i) / 220 + 0.5); }
  const plaza = new THREE.Mesh(pg, M.plaza);
  plaza.position.set(0, -0.03, 0); plaza.receiveShadow = true; plaza.userData.noReflect = false;
  G.scene.add(plaza);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { sunDir: { value: G.sunDir } },
    vertexShader: 'varying vec3 vD; void main(){ vD=normalize((modelMatrix*vec4(position,1.0)).xyz-cameraPosition); gl_Position=projectionMatrix*viewMatrix*modelMatrix*vec4(position,1.0);}',
    fragmentShader: `uniform vec3 sunDir; varying vec3 vD;
      void main(){ float h=max(vD.y,0.0); vec3 top=vec3(0.18,0.27,0.48); vec3 hor=vec3(1.0,0.62,0.36);
        vec3 c=mix(hor,top,pow(h,0.55)); float s=max(dot(vD,sunDir),0.0);
        c+=vec3(1.0,0.75,0.45)*pow(s,40.0)*1.5+vec3(1.0,0.6,0.3)*pow(s,6.0)*0.35+vec3(1.0,0.9,0.7)*smoothstep(0.9993,0.9996,s)*6.0;
        gl_FragColor=vec4(c,1.0); }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(120, 32, 16), skyMat);
  sky.userData.noAO = true; G.scene.add(sky); G.sky = sky;
  const cityMat = new THREE.MeshStandardMaterial({ color: 0x3a3f4a, roughness: 0.8, emissive: 0x24180c });
  for (let i = 0; i < 26; i++) {
    const h = 8 + Math.random() * 30, w = 6 + Math.random() * 10;
    const m = box(w, h, w, cityMat, -46 - Math.random() * 40, h / 2, -60 + i * 5 + Math.random() * 3);
    m.castShadow = false;
  }
  // street lamps & trees outside the facade
  // hedges, bollards and lamp posts outside
  const hedge = new THREE.MeshStandardMaterial({ color: 0x3f5a30, roughness: 0.9 }), post = new THREE.MeshStandardMaterial({ color: 0x24262a, roughness: 0.5, metalness: 0.6 });
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xffe2b0, toneMapped: false });
  for (let z = -12; z <= 12; z += 5) {
    if (z > 5 && z < 12) continue;
    box(0.9, 0.7, 3.4, hedge, -22.6, 0.35, z + 0.5);
    box(0.5, 0.4, 3.6, M.stoneDark, -22.6, 0.2, z + 0.5);
  }
  for (let z = -13; z <= 13; z += 2.2) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.8, 10), post); b.position.set(-21.0, 0.4, z); b.castShadow = true; G.scene.add(b); }
  for (let z = -10; z <= 12; z += 11) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 4.5, 8), post); p.position.set(-24.5, 2.25, z); p.castShadow = true; G.scene.add(p);
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8), lampMat); l.position.set(-24.5, 4.6, z); G.scene.add(l);
  }
  box(4, 0.15, 30, M.stoneLight, -20.2, 0.0, 0, { cast: false });
}

function buildLights() {
  const scene = G.scene;
  const hemi = new THREE.HemisphereLight(0xb8c6e0, 0x7a6450, 0.7); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffb070, 4.8);
  G.sunDir = new THREE.Vector3(-1, 0.42, 0.32).normalize();
  sun.position.copy(G.sunDir).multiplyScalar(45);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(shadowSize(), shadowSize());
  const sc = sun.shadow.camera; sc.left = -27; sc.right = 27; sc.top = 22; sc.bottom = -22; sc.near = 5; sc.far = 100;
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.035; sun.shadow.radius = 3;
  scene.add(sun); scene.add(sun.target); G.sun = sun;
  // warm interior pools
  for (const [x, z, i] of [[0, -10.5, 40], [-12, -8.5, 30], [8.5, 2.0, 30], [14.8, -9.5, 22], [-12.5, 2.5, 25]]) {
    const s = new THREE.SpotLight(0xffd6a0, i, 16, 0.85, 0.9, 1.6);
    s.position.set(x, 6.8, z); s.target.position.set(x, 0, z); scene.add(s); scene.add(s.target);
  }
}

// the user's gold bar model, one instanced draw for every bar in the vault
function goldBars(list) {
  const src = L.models.GoldBar; src.updateMatrixWorld(true);
  let mesh = null; src.traverse(o => { if (o.isMesh && !mesh) mesh = o; });
  const geo = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
  const om = mesh.material;
  const mat = new THREE.MeshStandardMaterial({ color: 0xf6c45c, metalness: 1, roughness: 0.3, normalMap: om.normalMap || null, envMapIntensity: 1.7 });
  const im = new THREE.InstancedMesh(geo, mat, list.length); im.castShadow = true; im.receiveShadow = true;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
  list.forEach(([x, y, z, yaw], i) => { m.compose(p.set(x, y, z), q.setFromAxisAngle(up, yaw), one); im.setMatrixAt(i, m); });
  im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); G.scene.add(im);
}

// ---------------- interior pond ----------------
function waterNormals() {
  const S = 256, c = makeCanvas(S, S), x = c.getContext('2d'), img = x.createImageData(S, S);
  const h = (u, v) => Math.sin(u * 0.098 + Math.sin(v * 0.05) * 2) * 0.5 + Math.sin(v * 0.123 + u * 0.03) * 0.35 + Math.sin((u + v) * 0.21) * 0.15;
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const dx = h(i + 1, j) - h(i - 1, j), dy = h(i, j + 1) - h(i, j - 1), k = (j * S + i) * 4;
    img.data[k] = 128 + dx * 90; img.data[k + 1] = 128 + dy * 90; img.data[k + 2] = 255; img.data[k + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}
// lily pad: a notched disc with a gently upturned, wavy rim (uv = top-down planar)
function lilyPadGeometry(r) {
  const seg = 40, rings = 5, notch = 0.32, pos = [], uv = [], idx = [];
  const ph = Math.random() * 6;
  pos.push(0, 0, 0); uv.push(0.5, 0.5);
  for (let j = 1; j <= rings; j++) for (let i = 0; i <= seg; i++) {
    const a = notch / 2 + (i / seg) * (Math.PI * 2 - notch), rr = r * j / rings, k = j / rings;
    const y = k * k * k * 0.022 + Math.sin(a * 5 + ph) * 0.006 * k * k; // rim curls up and ripples
    pos.push(Math.cos(a) * rr, y, Math.sin(a) * rr); uv.push(0.5 + Math.cos(a) * k * 0.5, 0.5 + Math.sin(a) * k * 0.5);
  }
  for (let i = 0; i < seg; i++) idx.push(0, 1 + i + 1, 1 + i);
  for (let j = 1; j < rings; j++) for (let i = 0; i < seg; i++) {
    const a = 1 + (j - 1) * (seg + 1) + i, b = a + seg + 1;
    idx.push(a, a + 1, b, a + 1, b + 1, b);
  }
  const geo = new THREE.BufferGeometry(); geo.setIndex(idx);
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.computeVertexNormals(); return geo;
}
// dark, veined lily pad colour + a wrinkled normal map built from a height field
function lilyPadTextures() {
  const S = 256, hc = makeCanvas(S, S), h = hc.getContext('2d'), cc = makeCanvas(S, S), c = cc.getContext('2d');
  const C = S / 2;
  const g = c.createRadialGradient(C, C, 4, C, C, C); g.addColorStop(0, '#3d5e22'); g.addColorStop(0.55, '#2a4a1c'); g.addColorStop(1, '#1d3815');
  c.fillStyle = g; c.fillRect(0, 0, S, S);
  for (let i = 0; i < 900; i++) { c.fillStyle = `rgba(${Math.random() < 0.5 ? '10,30,8' : '80,110,40'},${Math.random() * 0.12})`; c.beginPath(); c.arc(Math.random() * S, Math.random() * S, 1 + Math.random() * 5, 0, 6.28); c.fill(); }
  h.fillStyle = '#808080'; h.fillRect(0, 0, S, S);
  for (let i = 0; i < 700; i++) { h.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,255,255'},${Math.random() * 0.18})`; h.beginPath(); h.ellipse(Math.random() * S, Math.random() * S, 2 + Math.random() * 7, 1 + Math.random() * 3, Math.random() * 3, 0, 6.28); h.fill(); }
  // radial veins (raised in the height map, a touch lighter in colour), with forks near the rim
  for (let v = 0; v < 17; v++) {
    let a = v / 17 * Math.PI * 2 + Math.random() * 0.1, x = C, y = C;
    h.strokeStyle = 'rgba(255,255,255,0.75)'; c.strokeStyle = 'rgba(120,150,70,0.45)';
    for (let s = 0; s < 12; s++) {
      const nx = x + Math.cos(a) * C / 12, ny = y + Math.sin(a) * C / 12; a += (Math.random() - 0.5) * 0.12;
      h.lineWidth = 3 - s * 0.18; c.lineWidth = 1.6 - s * 0.08;
      h.beginPath(); h.moveTo(x, y); h.lineTo(nx, ny); h.stroke(); c.beginPath(); c.moveTo(x, y); c.lineTo(nx, ny); c.stroke();
      if (s > 6 && Math.random() < 0.35) { const fa = a + (Math.random() < 0.5 ? -0.5 : 0.5); h.lineWidth = 1.2; h.beginPath(); h.moveTo(nx, ny); h.lineTo(nx + Math.cos(fa) * 14, ny + Math.sin(fa) * 14); h.stroke(); }
      x = nx; y = ny;
    }
  }
  const hd = h.getImageData(0, 0, S, S).data, nd = c.createImageData(S, S), o = nd.data;
  const H = (x, y) => hd[(((y + S) % S) * S + ((x + S) % S)) * 4] / 255;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = (H(x + 1, y) - H(x - 1, y)) * 3.2, dy = (H(x, y + 1) - H(x, y - 1)) * 3.2, l = Math.hypot(dx, dy, 1), i = (y * S + x) * 4;
    o[i] = (-dx / l * 0.5 + 0.5) * 255; o[i + 1] = (dy / l * 0.5 + 0.5) * 255; o[i + 2] = (1 / l * 0.5 + 0.5) * 255; o[i + 3] = 255;
  }
  const nc = makeCanvas(S, S); nc.getContext('2d').putImageData(nd, 0, 0);
  const map = new THREE.CanvasTexture(cc); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4;
  const nrm = new THREE.CanvasTexture(nc); nrm.anisotropy = 4;
  return [map, nrm];
}
// pond bed: irregular faceted rocks of many sizes and tones (a few shared shapes, instanced)
function pondRocks(x0, x1, z0, z1, depth, sx, sz) {
  const shapes = [];
  for (let k = 0; k < 6; k++) {
    const g = new THREE.IcosahedronGeometry(1, 1), p = g.attributes.position, seed = Math.random() * 10;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const n = 1 + 0.22 * Math.sin(x * 3.1 + seed) * Math.cos(z * 2.7 - seed) + 0.14 * Math.sin(y * 4.3 + seed * 2) + (Math.random() - 0.5) * 0.12;
      p.setXYZ(i, x * n, y * n * (y < 0 ? 0.55 : 1), z * n); // flatter underneath
    }
    g.deleteAttribute('normal'); const ng = g.toNonIndexed(); ng.computeVertexNormals(); shapes.push(ng);
  }
  const tones = [0x6d6f68, 0x8a8478, 0x55595a, 0x9a917f, 0x4a4d47, 0x7b7466, 0xa59c8a, 0x5f6660];
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.55, flatShading: true, envMapIntensity: 0.9 });
  const w = x1 - x0, d = z1 - z0, per = 16;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3(), col = new THREE.Color();
  shapes.forEach((geo, k) => {
    const im = new THREE.InstancedMesh(geo, mat, per); im.receiveShadow = true;
    for (let i = 0; i < per; i++) {
      // mostly pebbles, some stones, the odd boulder; a few hug the walls
      const r = Math.random(), size = r < 0.6 ? 0.04 + Math.random() * 0.06 : r < 0.9 ? 0.1 + Math.random() * 0.08 : 0.2 + Math.random() * 0.12;
      let x = x0 + 0.2 + Math.random() * (w - 0.4), z = z0 + 0.2 + Math.random() * (d - 0.4);
      if (Math.random() < 0.3) { if (Math.random() < 0.5) x = Math.random() < 0.5 ? x0 + 0.25 : x1 - 0.25; else z = Math.random() < 0.5 ? z0 + 0.25 : z1 - 0.25; }
      if (Math.hypot(x - sx, z - sz) < 0.55) x -= 0.8;
      s.set(size * (0.8 + Math.random() * 0.6), size * (0.45 + Math.random() * 0.4), size * (0.8 + Math.random() * 0.6));
      p.set(x, -depth + 0.025 + s.y * 0.35, z); q.setFromEuler(e.set((Math.random() - 0.5) * 0.4, Math.random() * 6.28, (Math.random() - 0.5) * 0.4));
      im.setMatrixAt(i, m4.compose(p, q, s));
      im.setColorAt(i, col.setHex(tones[Math.random() * tones.length | 0]).multiplyScalar(0.85 + Math.random() * 0.3));
    }
    G.scene.add(im);
  });
}
function buildPond(x0, x1, z0, z1) {
  const M = L.mats, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, w = x1 - x0, d = z1 - z0, depth = 0.45;
  // basin walls just inside the floor opening (no coplanar faces -> no flicker), dark pebble floor
  const basin = new THREE.MeshStandardMaterial({ color: 0x1d2a2a, roughness: 0.9 });
  box(w - 0.02, depth, 0.1, basin, cx, -depth / 2, z0 + 0.06, { cast: false });
  box(w - 0.02, depth, 0.1, basin, cx, -depth / 2, z1 - 0.06, { cast: false });
  box(0.1, depth, d - 0.02, basin, x0 + 0.06, -depth / 2, cz, { cast: false });
  box(0.1, depth, d - 0.02, basin, x1 - 0.06, -depth / 2, cz, { cast: false });
  box(w, 0.05, d, basin, cx, -depth, cz, { cast: false });
  pondRocks(x0, x1, z0, z1, depth, cx + 1.2, cz + 0.4);
  // polished stone coping around the edge
  const rim = M.stonePillar, rw = 0.28, rh = 0.12;
  box(w + 2 * rw, rh, rw, rim, cx, rh / 2, z0 - rw / 2); box(w + 2 * rw, rh, rw, rim, cx, rh / 2, z1 + rw / 2);
  box(rw, rh, d, rim, x0 - rw / 2, rh / 2, cz); box(rw, rh, d, rim, x1 + rw / 2, rh / 2, cz);
  // water: glossy, slightly see-through, gently rippling
  const nrm = waterNormals(); nrm.repeat.set(w / 2.5, d / 2.5);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.1, d - 0.1), new THREE.MeshStandardMaterial({
    color: 0x0f3437, roughness: 0.03, metalness: 0.1, normalMap: nrm, normalScale: new THREE.Vector2(0.35, 0.35), envMapIntensity: 2.4, transparent: true, opacity: 0.86 }));
  water.rotation.x = -Math.PI / 2; water.position.set(cx, -0.1, cz); water.userData.noAO = true; G.scene.add(water);
  L.water = water;
  // lily pads + a stone sculpture
  const [padMap, padNrm] = lilyPadTextures();
  const pad = new THREE.MeshPhysicalMaterial({ map: padMap, normalMap: padNrm, normalScale: new THREE.Vector2(1.1, 1.1), roughness: 0.26, clearcoat: 0.7, clearcoatRoughness: 0.18, envMapIntensity: 1.3, side: THREE.DoubleSide });
  for (let i = 0; i < 11; i++) {
    const g = new THREE.Mesh(lilyPadGeometry(0.17 + Math.random() * 0.14), pad);
    g.rotation.y = Math.random() * 6; g.position.set(x0 + 0.5 + Math.random() * (w - 1), -0.097, z0 + 0.5 + Math.random() * (d - 1));
    g.receiveShadow = true; G.scene.add(g);
  }
  // sculpture: polished brass ring on a dark stone plinth rising out of the water
  box(0.7, 0.55, 0.5, M.stonePillar, cx + 1.2, -0.2, cz + 0.4);
  const brass = new THREE.MeshStandardMaterial({ color: 0xd9b06a, roughness: 0.18, metalness: 1, envMapIntensity: 1.6 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.07, 20, 64), brass);
  ring.position.set(cx + 1.2, 0.72, cz + 0.4); ring.rotation.y = 0.6; ring.castShadow = true; G.scene.add(ring);
  collider(cx, cz, w + 2 * rw, d + 2 * rw);
}
// elevator doors: open for Karim when he walks up (and while he's inside); G.leaving drives the ride out
export function updateElevators(dt) {
  if (!L.elevators || !G.player) return;
  const P = G.player, z0 = G.bounds.minZ, live = G.state === 'play' || G.state === 'cleared';
  for (const e of L.elevators) {
    const near = live && Math.abs(P.pos.x - e.x) < 1.5 && P.pos.z - z0 < 2.2 && P.hp > 0;
    let want = near ? 1 : 0;
    if (G.leaving) want = G.leaving.e === e && G.leaving.phase !== 'close' && G.leaving.phase !== 'gone' ? 1 : 0;
    if (want && e.open === 0 && !e.chime) { e.chime = true; SFX.play('ding'); }
    if (!want && e.open === 0) e.chime = false;
    e.open = Math.min(1, Math.max(0, e.open + (want ? 1 : -1) * dt / 1.05));
    const k = e.open * e.open * (3 - 2 * e.open);
    e.l.position.x = e.x - 0.405 - 0.79 * k; e.r.position.x = e.x + 0.405 + 0.79 * k;
    e.col.active = k < 0.7;
    e.light.intensity = 5.5 * Math.min(1, e.open * 2.5);
    e.call.color.setHex(want ? 0xffa060 : 0x5a3a20);
  }
}
// ---- gold guide arrow: once the lobby is secured it floats over Karim and points at the nearest elevator ----
let arrow = null;
const _af = new THREE.Vector3(), _ac = new THREE.Vector3(), _an = new THREE.Vector3(), _ax = new THREE.Vector3(), _aup = new THREE.Vector3(0, 1, 0), _am = new THREE.Matrix4();
function makeArrow() {
  const sh = new THREE.Shape();
  // pointing +y: shaft then a broad head
  sh.moveTo(-0.075, -0.34); sh.lineTo(0.075, -0.34); sh.lineTo(0.075, 0.02); sh.lineTo(0.2, 0.02); sh.lineTo(0, 0.34); sh.lineTo(-0.2, 0.02); sh.lineTo(-0.075, 0.02); sh.closePath();
  const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.07, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.024, bevelSegments: 4, curveSegments: 1 });
  geo.translate(0, 0, -0.035); geo.rotateX(Math.PI / 2); // lie flat, pointing along +z
  const mat = new THREE.MeshStandardMaterial({ color: 0xffd47a, metalness: 0.85, roughness: 0.3, envMapIntensity: 1.8, emissive: 0xb07818, emissiveIntensity: 0.5 });
  const root = new THREE.Group(), tilt = new THREE.Group(), mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true; // (in the AO pass on purpose: otherwise the shading of whatever is behind it shows through)
  tilt.add(mesh); root.add(tilt); root.visible = false; root.scale.setScalar(0.001); G.scene.add(root);
  return { root, tilt, mesh, s: 0, yaw: null };
}
export function updateGuideArrow(dt) {
  const custom = G.guideTarget; // (the tutorial points it at the cart, the exit...)
  if (!G.player || (!custom && (!G.guideArrow || !L.elevators))) { if (arrow) { arrow.s = 0; arrow.root.visible = false; } return; }
  if (!arrow) arrow = makeArrow();
  const P = G.player.pos, z0 = G.bounds.minZ;
  let dx, dz, best = 1e9;
  if (custom) { dx = custom.x - P.x; dz = custom.z - P.z; best = Math.hypot(dx, dz); }
  else {
    let tgt = null;
    for (const e of L.elevators) { const d = Math.hypot(e.x - P.x, z0 + 0.4 - P.z); if (d < best) { best = d; tgt = e; } }
    dx = tgt.x - P.x; dz = z0 + 0.4 - P.z;
  }
  const want = custom ? (best < (custom.near ?? 1.8) ? 0 : 1) : (G.leaving || best < 2.4 || G.state !== 'cleared' ? 0 : 1); // tuck away on arrival
  arrow.s += (want - arrow.s) * (1 - Math.exp(-(want ? 5 : 9) * dt));
  const t = G.time, pop = want ? 1 + Math.sin(Math.min(1, arrow.s) * Math.PI) * 0.15 : 1;
  arrow.root.visible = arrow.s > 0.01;
  arrow.root.scale.setScalar(Math.max(0.001, arrow.s * pop));
  const yaw = Math.atan2(dx, dz);
  arrow.yaw = arrow.yaw === null ? yaw : arrow.yaw + Math.atan2(Math.sin(yaw - arrow.yaw), Math.cos(yaw - arrow.yaw)) * (1 - Math.exp(-8 * dt));
  const fx = Math.sin(arrow.yaw), fz = Math.cos(arrow.yaw);
  arrow.root.position.set(P.x + fx * 0.2, 2.12 + Math.sin(t * 2.6) * 0.06, P.z + fz * 0.2);
  // point along the floor, but roll the face part-way towards the camera so it reads as solid gold, not a sticker
  _af.set(fx, 0, fz); _ac.copy(G.camera.position).sub(arrow.root.position).normalize();
  _an.copy(_ac).addScaledVector(_af, -_ac.dot(_af)).normalize().lerp(_aup, 0.45).normalize();
  _an.applyAxisAngle(_af, Math.sin(t * 1.7) * 0.22).normalize(); // slow wobble catches the light
  _ax.crossVectors(_an, _af).normalize(); _an.crossVectors(_af, _ax);
  arrow.root.quaternion.setFromRotationMatrix(_am.makeBasis(_ax, _an, _af));
  arrow.tilt.rotation.set(-0.1 + Math.sin(t * 2.6 + 1) * 0.05, 0, 0);
}
export function inElevator(pos) {
  if (!L.elevators) return null;
  for (const e of L.elevators) if (Math.abs(pos.x - e.x) < 0.85 && pos.z < G.bounds.minZ - 0.45) return e;
  return null;
}
export function updateWater(t) { if (L.water) L.water.material.normalMap.offset.set(t * 0.012, t * 0.008); }

// ---------------- props from the user's Blender models ----------------
function buildProps() {
  const C = (cx, cz, w, d, yaw = 0, h = 1.2, extra) => collider(cx, cz, w, d, yaw, 0, h, extra);
  const B = G.bounds;

  // The custodian's cart at the entrance
  const cart = G.fromStairs ? prop('Cart', -3.15, -10.2, Math.PI * 0.9) : prop('Cart', -15.0, 10.6, Math.PI / 2 + 0.3); // (up from the basement: waiting by the stairwell)
  addChair(cart.obj, { r: 0.62, heavy: true, noTip: true, mass: 2.2 }); // pushable, but it takes some shoving
  G.cart = cart.obj;

  // Lounge (SW)
  const lx = -12.0, lz = 2.6;
  const ct = prop('CoffeeTable', lx, lz, 0);
  const ctBox = C(lx, lz, ct.w * 0.9, ct.d * 0.9, 0, 0.5);
  addDestructible({ kind: 'table', obj: ct.obj, box: ctBox, cost: 900, name: 'Glass coffee table', w: ct.w, h: ct.h, keepCollider: true });
  G.surfaces.push(makeBox(lx, lz, ct.w * 0.95, ct.d * 0.95, 0, 0, ct.h, { y: ct.h }));
  for (const [x, z, yaw] of [[lx, lz - 2.4, 0], [lx, lz + 2.4, Math.PI], [lx - 3.0, lz, Math.PI / 2]]) {
    const c = prop('Couch', x, z, yaw);
    C(x, z, c.w * 0.95, c.d * 0.95, yaw, 1.1);
  }
  rug(lx, lz, 3.4, 5.6, Math.PI / 2);
  PLANT(-14.9, 0.35); PLANT(-14.9, 4.85); // tucked into the corners where the sofas meet
  // console table behind the west sofa, with a little plant and the bust on it
  const con = prop2('Console', -16.45, lz, Math.PI / 2, { contact: 0.45 });
  prop('PottedPlant', -16.45, lz - 0.62, 0, 0.36, con.h);
  prop2('Bust', -16.45, lz + 0.55, Math.PI / 2, { y: con.h, col: false, contact: 0.3 });
  for (const z of [lz - 0.6, lz + 0.6]) STOOL(lx + 2.3, z, Math.PI / 2);
  // divider between the lounge and the atrium: tall planter, long planter, open shelf, a pot to finish it
  { const p = prop('SmallerPlantBox', -7.8, -1.7, 0); addDestructible({ kind: 'plant', obj: p.obj, box: C(-7.8, -1.7, 1.1, 1.0, 0, 1.6), cost: 350, name: 'Planter', h: p.h }); }
  { const p = prop('PlantBox', -7.8, 0.75, Math.PI / 2); C(-7.8, 0.75, p.w * 0.95, p.d * 0.9, Math.PI / 2, 1.2); }
  prop2('Shelf', -7.8, 3.05, 0, { contact: 0.5 });
  PLANT(-7.8, 4.45);

  // Office desks (NW) — chairs on -z side, monitors facing them
  for (const z of [-10.8, -7.0]) for (const x of [-16.0, -13.4, -10.8]) {
    const d = prop('Desk', x, z, 0);
    C(x, z, d.w * 0.98, d.d * 0.98, 0, 0.78, { desk: true });
    G.surfaces.push(makeBox(x, z, d.w * 0.95, d.d * 0.9, 0, 0, d.h, { y: d.h + 0.005, desk: true }));
    const cx = x + (Math.random() - 0.5) * 0.5;
    const comp = prop('Computer', cx, z - 0.05, Math.PI, 1, d.h);
    const cb = makeBox(cx, z - 0.05, comp.w * 0.95, comp.d * 0.9, Math.PI, d.h, d.h + comp.h);
    addDestructible({ kind: 'computer', obj: comp.obj, box: cb, cost: 1200, name: 'Computer', h: comp.h, baseY: d.h });
    // chair tucked in under the desk, facing it
    addChair(prop('OfficeChair', x + (Math.random() - 0.5) * 0.12, z - d.d / 2 + 0.02, (Math.random() - 0.5) * 0.1).obj);
    // a little desk plant on every other desk
    if ((x + z * 3) % 2 < 1) prop('PottedPlant', x + (cx > x ? -0.72 : 0.72), z + 0.18, 0, 0.36, d.h);
  }
  prop2('Printer', -7.2, -9.0, -Math.PI / 2, { contact: 0.55 });
  for (const [x, z] of [[-14.7, -10.2], [-12.1, -6.4], [-9.4, -10.2]]) BIN(x, z);
  prop2('Door', -14.7, B.minZ + 0.11, 0, { contact: 0, col: false });
  prop2('Shelf', -10.3, B.minZ + 0.28, Math.PI / 2, { contact: 0.5 });
  for (const [x, z] of [[-7.6, -12.2], [-16.9, -5.5]]) {
    const p = prop('SmallerPlantBox', x, z, 0);
    const b = C(x, z, 1.1, 1.0, 0, 1.6);
    addDestructible({ kind: 'plant', obj: p.obj, box: b, cost: 350, name: 'Planter', h: p.h });
  }
  // Manager's office (NE)
  {
    const d = prop('Desk', 15.4, -9.4, Math.PI / 2);
    C(15.4, -9.4, d.w * 0.98, d.d * 0.98, Math.PI / 2, 0.78, { desk: true });
    G.surfaces.push(makeBox(15.4, -9.4, d.w * 0.95, d.d * 0.9, Math.PI / 2, 0, d.h, { y: d.h + 0.005, desk: true }));
    const comp = prop('Computer', 15.4, -9.6, -Math.PI / 2, 1, d.h);
    addDestructible({ kind: 'computer', obj: comp.obj, box: makeBox(15.4, -9.6, comp.w * 0.95, comp.d * 0.9, -Math.PI / 2, d.h, d.h + comp.h), cost: 1200, name: 'Computer', h: comp.h, baseY: d.h });
    addChair(prop('OfficeChair', 15.4 - d.d / 2 + 0.02, -9.4, Math.PI / 2).obj);
    const p = prop('PottedPlant', 17.2, -12.3, 1);
    addDestructible({ kind: 'plant', obj: p.obj, box: C(17.2, -12.3, 0.45, 0.45, 0, 0.95), cost: 180, name: 'Potted plant', h: p.h });
    for (const z of [-10.0, -8.8]) prop2('LeatherChair', 16.8, z, -Math.PI / 2, { contact: 0.45, ch: 0.9 });
    prop2('Door', 15.3, B.minZ + 0.11, 0, { contact: 0, col: false });
    BIN(14.4, -10.7);
    const p2 = prop('SmallerPlantBox', 13.4, -12.1, 0);
    addDestructible({ kind: 'plant', obj: p2.obj, box: C(13.4, -12.1, 1.1, 1.0, 0, 1.6), cost: 350, name: 'Planter', h: p2.h });
  }
  // Reception computers + chairs
  for (const z of [0.3, 2.0, 3.7]) {
    const comp = prop('Computer', 8.55, z, Math.PI / 2, 1, 0.75);
    addDestructible({ kind: 'computer', obj: comp.obj, box: makeBox(8.55, z, comp.w * 0.95, comp.d * 0.9, Math.PI / 2, 0.75, 0.75 + comp.h), cost: 1200, name: 'Computer', h: comp.h, baseY: 0.75 });
    addChair(prop('OfficeChair', 9.75, z + 0.1, -Math.PI / 2 + (Math.random() - 0.5) * 0.5).obj);
  }
  // Atrium planters — long boxes along the front edge, smaller ones near elevators
  for (const x of [-8.0, -3.0, 2.0]) { const p = prop('PlantBox', x, 12.0, 0); C(x, 12.0, p.w * 0.95, p.d * 0.9, 0, 1.2); }
  for (const x of [-5.5, -0.5]) prop2('Bench', x, 12.2, Math.PI, { contact: 0.5 });
  PLANT(-10.0, 12.2); PLANT(4.1, 12.2);
  PLANT(-6.1, -12.45); // (by the stairwell doors)
  for (const [x, z] of [[7.6, -12.2]]) {
    const p = prop('SmallerPlantBox', x, z, 0);
    addDestructible({ kind: 'plant', obj: p.obj, box: C(x, z, 1.1, 1.0, 0, 1.6), cost: 350, name: 'Planter', h: p.h });
  }
  // entrance: a bin by the welcome sign
  BIN(-17.25, 5.05);
  // East waiting area
  { const c = prop('Couch', 17.1, 2.4, -Math.PI / 2); C(17.1, 2.4, c.w * 0.95, c.d * 0.95, -Math.PI / 2, 1.1); }
  PLANT(17.15, 0.55); PLANT(17.15, 4.25);
  rug(15.3, 2.4, 2.8, 4.2, 0);
  {
    const ct2 = prop('CoffeeTable', 15.25, 2.4, 0, 0.8);
    const b = C(15.25, 2.4, ct2.w * 0.9, ct2.d * 0.9, 0, 0.45);
    addDestructible({ kind: 'table', obj: ct2.obj, box: b, cost: 900, name: 'Glass coffee table', w: ct2.w, h: ct2.h, keepCollider: true });
    G.surfaces.push(makeBox(15.25, 2.4, ct2.w * 0.95, ct2.d * 0.95, 0, 0, ct2.h, { y: ct2.h }));
  }
  for (const z of [1.65, 3.15]) prop2('LeatherChair', 13.75, z, Math.PI / 2, { contact: 0.45, ch: 0.9 });
  // divider between the tellers' side and the waiting area
  { const p = prop('PlantBox', 11.9, 0.4, Math.PI / 2); C(11.9, 0.4, p.w * 0.95, p.d * 0.9, Math.PI / 2, 1.2); }
  prop2('Shelf', 11.9, 2.7, 0, { contact: 0.5 });
  PLANT(11.9, 4.1);
  // a grand piano by the east wall, keys facing the room, with the ottoman as its stool
  prop2('Piano', 15.4, -2.6, 0, { contact: 0.55, ch: 1.0 });
  STOOL(14.05, -2.75, Math.PI / 2);
  PLANT(17.3, -4.8);
  // pond railings, standing on the stone coping (north + west edges)
  for (const [x, z, yaw, sz] of [[10.36, 8.96, 0, 1], [10.36, 11.43, 0, 0.65], [11.9, 7.36, Math.PI / 2, 1], [15.0, 7.36, Math.PI / 2, 1.06]]) {
    const r = prop('RAILING', x, z, yaw, 1, 0.12);
    r.obj.scale.z *= sz; // stretch along its length only
  }
}

export function buildLevel() {
  mats();
  buildLights();
  buildFloor();
  buildArchitecture();
  buildProps();
}

// Fade tall things that hide the player from the iso camera
const _ray = new THREE.Raycaster();
export function updateOccluders() {
  if (!G.player) return;
  const from = G.camera.position, to = G.player.pos.clone().setY(1.0);
  const dir = to.clone().sub(from); const dist = dir.length(); dir.normalize();
  _ray.set(from, dir); _ray.far = dist;
  for (const o of L.occluders) {
    const hit = _ray.intersectObject(o, false).length > 0;
    if (!o.userData.fadeMat) { o.userData.fadeMat = o.material.clone(); o.userData.fadeMat.transparent = true; o.userData.baseMat = o.material; }
    o.userData.fade = (o.userData.fade ?? 1) + ((hit ? 0.25 : 1) - (o.userData.fade ?? 1)) * 0.15;
    if (o.userData.fade < 0.98) { o.material = o.userData.fadeMat; o.material.opacity = o.userData.fade; o.castShadow = true; }
    else o.material = o.userData.baseMat;
  }
}
