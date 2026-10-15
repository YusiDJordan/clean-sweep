// Level 2: Operations, on the bank's first floor. Open-plan office: a cubicle farm on carpet tiles, two glass meeting
// rooms, the manager's corner office, a kitchen and lunch area, the washroom, and windows along the west and north
// walls looking out over Brickell Avenue a storey up (palms, the street, the towers across the road).
// Props: Yusuf's office models, plus computers, plants and a few pieces from the lobby and basement.
import * as THREE from 'three';
import { G, makeBox, makeCanvas, rand } from './state.js';
import { L, box, collider, plane, prop, prop2, contactShadow, buildFloor, mats, BIN, PLANT, rug, elevatorBank } from './level.js';
import { signTex } from './textures.js';
import { shadowSize } from './render.js';
import { addDestructible, addChair, chairs } from './destruct.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Enemy } from './actors.js';
import { trail, dirtBlob, spawnPaper as spawnPaper0, spawnJunk as spawnJunk0, clearDirtZones, FX } from './fx.js';
import { pointInBox } from './state.js';
import { addDecal, paintDull } from './decals.js';

const B0 = { minX: -17, maxX: 17, minZ: -12, maxZ: 12 };
export const OPS = {
  bounds: B0,
  start: new THREE.Vector3(-1.6, 0, B0.minZ - 1.0), // in the left-hand elevator
  out: new THREE.Vector3(-1.6, 0, B0.minZ + 2.3),   // where he walks out to
  cam: [-12.2, 13.0, -9.6, 9.6],
  carpet: [{ x0: -8.4, x1: 8.4, z0: -1.4, z1: 10.6 }, { x0: -17, x1: -10.6, z0: -3.4, z1: 3.4 }, { x0: -10.4, x1: -3.4, z0: -12, z1: -7.2 }],
  bath: { x0: 10, x1: 17, z0: -12, z1: -6.4 },
};
const WH = 3.6; // wall height (an office ceiling)
// litter only lands where it can be reached: not inside desks, walls, cabinets (things up on a desk top are fine)
const reachable = (x, z, y = 0) => y > 0.05 || (x > B0.minX + 0.25 && x < B0.maxX - 0.25 && z > B0.minZ + 0.25 && z < B0.maxZ - 0.25 && !G.colliders.some(b => b.active && b.y0 < 0.3 && pointInBox(b, x, z, 0.12)));
const spawnPaper = (x, y, z, ...a) => { if (reachable(x, z, (a[3] && a[3].y) || y)) spawnPaper0(x, y, z, ...a); };
const spawnJunk = (k, x, z, o = {}) => { if (reachable(x, z, o.y || 0)) spawnJunk0(k, x, z, o); };
const M = {};

// ---------------- textures ----------------
function woodTex() { // warm oak planks, 4 m square
  const S = 1024, c = makeCanvas(S, S), x = c.getContext('2d'), k = S / 4, pw = 0.2 * k;
  x.fillStyle = '#8a6c50'; x.fillRect(0, 0, S, S);
  for (let r = 0; r < S / pw; r++) {
    let u = -Math.random() * 2 * k;
    while (u < S) {
      const len = (1.2 + Math.random() * 1.4) * k, hue = 28 + Math.random() * 8, l = 36 + Math.random() * 11, sat = 22 + Math.random() * 10;
      x.fillStyle = `hsl(${hue},${sat}%,${l}%)`; x.fillRect(u, r * pw, len, pw);
      for (let g = 0; g < 9; g++) { // grain
        x.strokeStyle = `hsla(${hue - 4},${sat}%,${l - 8 - Math.random() * 6}%,${0.25 + Math.random() * 0.3})`; x.lineWidth = 0.6 + Math.random() * 1.4;
        const y = r * pw + Math.random() * pw; x.beginPath(); x.moveTo(u, y);
        for (let t = 0; t <= 1; t += 0.1) x.lineTo(u + t * len, y + Math.sin(t * 6 + g) * (1 + Math.random() * 2));
        x.stroke();
      }
      if (Math.random() < 0.25) { x.fillStyle = `hsla(${hue - 6},40%,${l - 12}%,0.5)`; x.beginPath(); x.ellipse(u + Math.random() * len, r * pw + pw / 2, 5 + Math.random() * 5, 2 + Math.random() * 2, 0, 0, 6.28); x.fill(); } // knot
      x.fillStyle = 'rgba(20,10,4,0.65)'; x.fillRect(u, r * pw, 1.6, pw); // butt joint
      u += len;
    }
    x.fillStyle = 'rgba(20,10,4,0.55)'; x.fillRect(0, r * pw, S, 1.4); // seam
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t;
}
function carpetTex() { // grey-blue carpet tiles, 0.5 m, alternating pile direction
  const S = 512, c = makeCanvas(S, S), x = c.getContext('2d'), n = 4, ts = S / n;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const v = (i + j) % 2 ? 0 : 6; x.fillStyle = `rgb(${66 + v},${74 + v},${86 + v})`; x.fillRect(i * ts, j * ts, ts, ts);
    for (let k = 0; k < 900; k++) { const b = Math.random() * 40 - 20; x.fillStyle = `rgba(${90 + b},${100 + b},${116 + b},0.35)`; x.fillRect(i * ts + Math.random() * ts, j * ts + Math.random() * ts, 2, 2); }
    x.strokeStyle = 'rgba(30,34,40,0.35)'; x.lineWidth = 1;
    for (let k = 0; k < 10; k++) { x.beginPath(); const o = (k + 0.5) * ts / 10; if ((i + j) % 2) { x.moveTo(i * ts + o, j * ts); x.lineTo(i * ts + o, j * ts + ts); } else { x.moveTo(i * ts, j * ts + o); x.lineTo(i * ts + ts, j * ts + o); } x.stroke(); }
  }
  x.strokeStyle = 'rgba(20,22,26,0.6)'; x.lineWidth = 2; for (let i = 0; i <= n; i++) { x.beginPath(); x.moveTo(i * ts, 0); x.lineTo(i * ts, S); x.moveTo(0, i * ts); x.lineTo(S, i * ts); x.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t;
}
function tileTex() { // washroom: white 30 cm tiles, grey grout
  const S = 512, c = makeCanvas(S, S), x = c.getContext('2d'), n = 6, ts = S / n;
  x.fillStyle = '#9a9a98'; x.fillRect(0, 0, S, S);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const v = 228 + Math.random() * 14; x.fillStyle = `rgb(${v},${v},${v - 3})`; x.fillRect(i * ts + 2, j * ts + 2, ts - 4, ts - 4); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}
function paintTex(col) { // a lightly textured painted wall
  const c = makeCanvas(256, 256), x = c.getContext('2d'); x.fillStyle = col; x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2500; i++) { x.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '0,0,0'},0.025)`; x.fillRect(Math.random() * 256, Math.random() * 256, 2, 2); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}
function facadeTex(seed, lit, base) { // a tower across the street: rows of windows, some lit in the dusk
  const W = 256, H = 512, c = makeCanvas(W, H), x = c.getContext('2d');
  x.fillStyle = base; x.fillRect(0, 0, W, H);
  const cols = 6 + (seed % 3), rows = 16, cw = W / cols, rh = H / rows;
  for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) {
    const on = Math.random() < lit;
    x.fillStyle = on ? `rgba(255,${200 + Math.random() * 40},${130 + Math.random() * 50},0.95)` : `rgba(${40 + Math.random() * 30},${60 + Math.random() * 30},${85 + Math.random() * 30},0.95)`;
    x.fillRect(q * cw + cw * 0.14, r * rh + rh * 0.18, cw * 0.72, rh * 0.62);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function skyTex() {
  const c = makeCanvas(8, 256), x = c.getContext('2d'), g = x.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#2d3c63'); g.addColorStop(0.45, '#7b6f8e'); g.addColorStop(0.75, '#e79a68'); g.addColorStop(1, '#f6c98c');
  x.fillStyle = g; x.fillRect(0, 0, 8, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// ---------------- building blocks ----------------
const C = (cx, cz, w, d, yaw = 0, h = 1.2, extra) => collider(cx, cz, w, d, yaw, 0, h, extra);
function glassRun(axis, fixed, from, to, n) { // a run of frosted-band glass partition panes between thin posts (breakable)
  const len = (to - from) / n;
  for (let i = 0; i <= n; i++) { const t = from + len * i; const [x, z] = axis === 'x' ? [t, fixed] : [fixed, t]; box(0.06, 2.6, 0.06, L.mats.darkMetal, x, 1.3, z); }
  const [cx, cz] = axis === 'x' ? [(from + to) / 2, fixed] : [fixed, (from + to) / 2], rl = to - from;
  box(axis === 'x' ? rl : 0.07, 0.07, axis === 'x' ? 0.07 : rl, L.mats.darkMetal, cx, 2.62, cz);
  box(axis === 'x' ? rl : 0.06, 0.05, axis === 'x' ? 0.06 : rl, L.mats.darkMetal, cx, 0.025, cz, { cast: false });
  for (let i = 0; i < n; i++) {
    const t = from + len * (i + 0.5); const [x, z] = axis === 'x' ? [t, fixed] : [fixed, t]; const yaw = axis === 'x' ? 0 : Math.PI / 2;
    const mat = L.mats.glass.clone(); mat.map = M.frost; mat.opacity = 0.42;
    const pane = new THREE.Mesh(new THREE.BoxGeometry(len - 0.07, 2.55, 0.02), mat);
    pane.position.set(x, 1.3, z); pane.rotation.y = yaw; pane.userData.noAO = true; pane.castShadow = false; G.scene.add(pane);
    const b = collider(x, z, len - 0.03, 0.12, yaw, 0, 2.6);
    addDestructible({ kind: 'glass', obj: pane, box: b, cost: 2400, name: 'Glass partition', w: len - 0.07, h: 2.55, yaw });
  }
}
function windowWall(axis, fixed, from, to, face) { // floor-to-ceiling windows: low sill, mullions every ~1.9 m, header
  const len = to - from, n = Math.max(1, Math.round(len / 1.9)), step = len / n, yaw = axis === 'x' ? 0 : Math.PI / 2;
  const at = t => axis === 'x' ? [t, fixed] : [fixed, t];
  const [cx, cz] = at((from + to) / 2), alongX = axis === 'x';
  box(alongX ? len : 0.3, 0.45, alongX ? 0.3 : len, M.sill, cx, 0.225, cz, { uvScale: [2, 1] });
  box(alongX ? len : 0.34, 0.04, alongX ? 0.34 : len, M.stoneCap, cx + (alongX ? 0 : face * 0.02), 0.47, cz + (alongX ? face * 0.02 : 0));
  box(alongX ? len : 0.3, WH - 3.2, alongX ? 0.3 : len, M.paint, cx, 3.2 + (WH - 3.2) / 2, cz);
  for (let i = 0; i <= n; i++) { const [x, z] = at(from + i * step); box(alongX ? 0.09 : 0.14, 2.75, alongX ? 0.14 : 0.09, L.mats.darkMetal, x, 0.45 + 1.375, z); }
  for (let i = 0; i < n; i++) {
    const [x, z] = at(from + (i + 0.5) * step);
    const g = plane(step - 0.09, 2.73, L.mats.facadeGlass, x, 0.47 + 1.365, z, alongX ? 0 : Math.PI / 2); g.userData.noAO = true; g.castShadow = false;
  }
  collider(cx, cz, alongX ? len + 0.4 : 0.4, alongX ? 0.4 : len + 0.4, 0, 0, 3);
}

export function buildOps() {
  mats();
  M.wood = new THREE.MeshStandardMaterial({ map: woodTex(), roughness: 0.42, metalness: 0, envMapIntensity: 0.5 });
  M.carpet = new THREE.MeshStandardMaterial({ map: carpetTex(), roughness: 0.97, metalness: 0, envMapIntensity: 0.15 });
  M.tile = new THREE.MeshStandardMaterial({ map: tileTex(), roughness: 0.18, metalness: 0, envMapIntensity: 0.7 });
  M.paint = new THREE.MeshStandardMaterial({ map: paintTex('#d9d4ca'), roughness: 0.85, envMapIntensity: 0.4 });
  M.paintDk = new THREE.MeshStandardMaterial({ map: paintTex('#4a5560'), roughness: 0.8, envMapIntensity: 0.4 });
  M.sill = L.mats.stoneDark; M.stoneCap = L.mats.cap;
  M.white = new THREE.MeshStandardMaterial({ color: 0xeeeae2, roughness: 0.45 });
  M.counter = new THREE.MeshStandardMaterial({ color: 0x2b2b2e, roughness: 0.25, metalness: 0.1, envMapIntensity: 0.9 });
  M.cabinet = new THREE.MeshStandardMaterial({ color: 0x8e6a48, roughness: 0.5 });
  M.cabIn = new THREE.MeshStandardMaterial({ color: 0x2a1f16, roughness: 0.7 }); // (the cabinets' carcass, seen in the gaps between the doors)
  M.steel = L.mats.steel; M.black = L.mats.black;
  { const fr = makeCanvas(64, 256), fc = fr.getContext('2d'); fc.fillStyle = '#fff'; fc.fillRect(0, 0, 64, 256); fc.fillStyle = '#b8c4c8'; fc.fillRect(0, 256 * (1 - 1.25 / 2.6), 64, 256 * (0.3 / 2.6)); M.frost = new THREE.CanvasTexture(fr); }
  G.scene.background = skyTex();
  const B = B0;

  // ---- floors: oak planks everywhere (the mop's), carpet tiles in the cubicles and meeting rooms (the vacuum's), tiles in the washroom ----
  const fw = buildFloor({ mat: M.wood, hole: false, refl: 0.55, uv: (x, z) => [x / 4, z / 4] });
  for (const r of OPS.carpet) {
    const f = buildFloor({ mat: M.carpet.clone(), hole: false, refl: 0, rect: { minX: r.x0, maxX: r.x1, minZ: r.z0, maxZ: r.z1 }, share: fw.uniforms, uv: (x, z) => [x / 2, z / 2] });
    f.mesh.position.y = 0.004; f.mesh.renderOrder = 0.2;
    (G.noDirt = G.noDirt || []).push(makeBox((r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2, r.x1 - r.x0, r.z1 - r.z0));
    box(r.x1 - r.x0 + 0.02, 0.012, 0.03, M.black, (r.x0 + r.x1) / 2, 0.006, r.z0, { cast: false }); box(r.x1 - r.x0 + 0.02, 0.012, 0.03, M.black, (r.x0 + r.x1) / 2, 0.006, r.z1, { cast: false }); // edge strips
  }
  { const r = OPS.bath; const f = buildFloor({ mat: M.tile, hole: false, refl: 0.9, rect: { minX: r.x0, maxX: r.x1, minZ: r.z0, maxZ: r.z1 }, share: fw.uniforms, uv: (x, z) => [x / 1.8, z / 1.8] }); f.mesh.position.y = 0.003; }

  // ---- outer walls: windows west and north (the city), the lift core, the kitchen and washroom wall; low walls at the front ----
  windowWall('z', B.minX - 0.15, B.minZ, B.maxZ, 1);
  windowWall('x', B.minZ - 0.15, B.minX, -3.3, 1);
  const nw = (x0, x1, y0, y1, mat = L.mats.stonePillar) => box(x1 - x0, y1 - y0, 0.4, mat, (x0 + x1) / 2, (y0 + y1) / 2, B.minZ - 0.2, { uvScale: [2.5, 3.5], uvWorld: true });
  nw(-3.3, -2.4, 0, WH); nw(-0.8, 0.8, 0, WH); nw(2.4, 3.3, 0, WH); nw(-2.4, -0.8, 2.8, WH); nw(0.8, 2.4, 2.8, WH);
  box(B.maxX - 3.3, WH, 0.3, M.paint, (3.3 + B.maxX) / 2, WH / 2, B.minZ - 0.15, { uvScale: [3, 3] });
  collider(-2.85, B.minZ - 0.2, 0.9, 0.4); collider(0, B.minZ - 0.2, 1.6, 0.4); collider((3.3 + B.maxX) / 2 - 0.4, B.minZ - 0.2, B.maxX - 3.3 + 0.8, 0.4);
  elevatorBank([-1.6, 1.6], '2');
  box(B.maxX - B.minX, 0.1, 0.04, M.stoneCap, 0, 0.05, B.minZ + 0.02, { cast: false }); // skirting
  // the floor's name between the lifts
  plane(1.3, 0.62, new THREE.MeshStandardMaterial({ map: signTex(512, 256, '#1c1e22', [{ text: '2', size: 92, color: '#d9b066' }, { text: 'OPERATIONS', size: 44, color: '#ece6da', spacing: 8 }], { top: 50 }), roughness: 0.4, metalness: 0.3 }), 0, 1.95, B.minZ + 0.005);
  // low walls on the camera's sides
  box(0.4, 1.0, B.maxZ - B.minZ + 0.4, L.mats.stoneDark, B.maxX + 0.2, 0.5, 0, { uvScale: [3, 1] }); box(0.48, 0.08, B.maxZ - B.minZ + 0.5, M.stoneCap, B.maxX + 0.2, 1.02, 0);
  box(B.maxX - B.minX, 1.0, 0.4, L.mats.stoneDark, 0, 0.5, B.maxZ + 0.2, { uvScale: [3, 1] }); box(B.maxX - B.minX + 0.5, 0.08, 0.48, M.stoneCap, 0, 1.02, B.maxZ + 0.2);
  collider(B.maxX + 0.2, 0, 0.4, 30); collider(0, B.maxZ + 0.2, 40, 0.4);
  // ceiling (for the environment probe only) with its light panels
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(36, 26), new THREE.MeshStandardMaterial({ color: 0xe6e2da, roughness: 0.9 })); ceil.rotation.x = Math.PI / 2; ceil.position.y = WH; ceil.layers.set(1); G.scene.add(ceil);
  for (let x = -14; x <= 14; x += 4) for (let z = -9; z <= 9; z += 4.5) { const lp = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.6), new THREE.MeshBasicMaterial({ color: 0xfff6e8 })); lp.rotation.x = Math.PI / 2; lp.position.set(x, WH - 0.02, z); lp.layers.set(1); G.scene.add(lp); }

  // beyond the low walls on the camera's sides: the rest of the floor, dark (a cutaway)
  for (const [w, d, x, z] of [[30, 60, B.maxX + 15.4, 0], [80, 30, 0, B.maxZ + 15.4]]) { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ color: 0x0c0d10 })); m.rotation.x = -Math.PI / 2; m.position.set(x, -0.02, z); m.userData.noReflect = true; G.scene.add(m); }
  buildCity();
  buildLights();
  buildRooms();
  buildCubicles();
  buildKitchen();
  buildWashroom();
  buildCorner();
  buildMisc();
  mergeStatics();
  G.camClamp = OPS.cam; G.camZoom = 1.0;
  G.exitView = { pos: [0, 2.3, 5.2], look: [0, 1.85, 0] }; // (the elevator ride out: ease in on the floor's name between the lifts)
}

// ---------------- draw calls: everything that never moves becomes one mesh per material ----------------
// (an office is hundreds of little things: cubicle panels, desks, posts, cabinets, palm fronds...)
function mergeStatics() {
  const dyn = new Set();
  for (const d of G.destructibles) dyn.add(d.obj);
  for (const c of chairs) dyn.add(c.obj);
  for (const o of L.occluders) dyn.add(o);
  for (const e of L.elevators || []) { dyn.add(e.l); dyn.add(e.r); }
  G.scene.updateMatrixWorld(true);
  const groups = new Map(), I = new THREE.Matrix4();
  for (const top of [...G.scene.children]) {
    if (dyn.has(top)) continue;
    let ok = true; top.traverse(o => { if (o.isSkinnedMesh || o.isInstancedMesh || o.isLight || o.isCamera || dyn.has(o)) ok = false; });
    if (!ok) continue;
    top.traverse(o => {
      if (!o.isMesh || Array.isArray(o.material) || o.material.userData.uniforms || o.layers.mask !== 1 || o.material.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile) return;
      const g = o.geometry; if (Object.keys(g.morphAttributes).length) return;
      const u = o.userData, sig = Object.keys(g.attributes).sort().join(',');
      const key = [o.material.uuid, o.castShadow, o.receiveShadow, o.renderOrder, !!u.noAO, !!u.noReflect, !!u.noProbe, !!u.contact, sig].join('|');
      if (!groups.has(key)) groups.set(key, { list: [], o });
      groups.get(key).list.push(o);
    });
  }
  let before = 0, after = 0;
  for (const { list, o: o0 } of groups.values()) {
    before += list.length; if (list.length < 2) { after++; continue; }
    const geos = list.map(o => { let g = o.geometry.clone(); g.applyMatrix4(o.matrixWorld); if (!g.index) { const n = g.attributes.position.count, a = new Uint32Array(n); for (let i = 0; i < n; i++) a[i] = i; g.setIndex(new THREE.BufferAttribute(a, 1)); } return g; });
    const mg = mergeGeometries(geos, false); if (!mg) { after += list.length; continue; }
    const m = new THREE.Mesh(mg, o0.material); m.castShadow = o0.castShadow; m.receiveShadow = o0.receiveShadow; m.renderOrder = o0.renderOrder;
    Object.assign(m.userData, { noAO: o0.userData.noAO, noReflect: o0.userData.noReflect, noProbe: o0.userData.noProbe, contact: o0.userData.contact, merged: true });
    for (const o of list) o.parent.remove(o);
    G.scene.add(m); after++;
  }
  G.__merged = before + ' meshes -> ' + after;
}

// ---------------- the city outside, a storey down ----------------
function buildCity() {
  const GY = -6.2; // street level, below this floor
  const ground = (w, d, x, z, col, y = GY) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ color: col, roughness: 0.95 })); m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); m.receiveShadow = true; G.scene.add(m); return m; };
  // west: pavement, Brickell Avenue, the far pavement; north: a side street
  ground(6, 120, B0.minX - 3.5, 0, 0x8d877d, GY + 0.15); ground(16, 120, B0.minX - 14.5, 0, 0x3a3b3f); ground(6, 120, B0.minX - 25.5, 0, 0x8d877d, GY + 0.15);
  ground(80, 5, -10, B0.minZ - 3, 0x8d877d, GY + 0.15); ground(80, 12, -10, B0.minZ - 11.5, 0x3a3b3f); ground(90, 6, -10, B0.minZ - 20.5, 0x8d877d, GY + 0.15);
  // lane markings
  for (let z = -55; z < 55; z += 6) { const m = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 3), new THREE.MeshBasicMaterial({ color: 0xe8e2c8 })); m.rotation.x = -Math.PI / 2; m.position.set(B0.minX - 14.5, GY + 0.01, z); G.scene.add(m); }
  // the building's own face below the windows
  box(0.4, -GY, B0.maxZ - B0.minZ + 0.8, L.mats.stoneDark, B0.minX - 0.4, GY / 2, 0); box(B0.maxX - B0.minX + 0.8, -GY, 0.4, L.mats.stoneDark, 0, GY / 2, B0.minZ - 0.4);
  // towers across the street
  const bases = ['#5d6573', '#6e6a64', '#4d5564', '#7a7266', '#556070', '#665e58'];
  let seed = 3;
  for (let z = -40; z < 40; z += rand(9, 13)) {
    const w = rand(8, 12), h = rand(18, 60), d = rand(10, 16);
    const mat = new THREE.MeshStandardMaterial({ map: facadeTex(seed++, 0.35, bases[seed % bases.length]), roughness: 0.6, metalness: 0.2, emissive: 0xffffff, emissiveIntensity: 0.12 });
    mat.map.wrapS = mat.map.wrapT = THREE.RepeatWrapping; mat.map.repeat.set(1, h / 30); mat.emissiveMap = mat.map;
    const b = new THREE.Mesh(new THREE.BoxGeometry(d, h, w), mat); b.position.set(B0.minX - 28.5 - d / 2, GY + h / 2, z); G.scene.add(b);
  }
  for (let x = -45; x < 25; x += rand(9, 13)) {
    const w = rand(8, 12), h = rand(14, 45), d = rand(10, 14);
    const mat = new THREE.MeshStandardMaterial({ map: facadeTex(seed++, 0.3, bases[seed % bases.length]), roughness: 0.6, metalness: 0.2, emissive: 0xffffff, emissiveIntensity: 0.12 });
    mat.map.wrapS = mat.map.wrapT = THREE.RepeatWrapping; mat.map.repeat.set(1, h / 30); mat.emissiveMap = mat.map;
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); b.position.set(x, GY + h / 2, B0.minZ - 23.5 - d / 2); G.scene.add(b);
  }
  // royal palms along the avenue, their crowns about level with this floor
  const trunkM = new THREE.MeshStandardMaterial({ color: 0x9a9184, roughness: 0.9 }), frondM = new THREE.MeshStandardMaterial({ color: 0x3f6d2e, roughness: 0.7, side: THREE.DoubleSide });
  const palm = (x, z) => {
    const h = rand(8, 10.5), t = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.24, h, 8), trunkM); t.position.set(x, GY + h / 2, z); G.scene.add(t);
    for (let i = 0; i < 9; i++) {
      const f = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 2.8, 1, 4), frondM); const pos = f.geometry.attributes.position;
      for (let k = 0; k < pos.count; k++) { const y = pos.getY(k); pos.setZ(k, -Math.pow((y + 1.4) / 2.8, 2) * 1.2); pos.setX(k, pos.getX(k) * (1 - Math.abs(y) / 2)); }
      f.geometry.translate(0, 1.4, 0); f.geometry.computeVertexNormals();
      f.position.set(x, GY + h, z); f.rotation.set(-1.1 + rand(-0.2, 0.2), i / 9 * Math.PI * 2, 0, 'YXZ'); f.castShadow = true; G.scene.add(f);
    }
  };
  for (let z = -40; z < 40; z += 9) palm(B0.minX - 5.6, z + rand(-1, 1));
  for (let x = -40; x < 15; x += 10) palm(x + rand(-1, 1), B0.minZ - 4.8);
  // street lamps and a few parked cars
  const lampM = new THREE.MeshStandardMaterial({ color: 0x2a2c30, metalness: 0.6, roughness: 0.4 });
  for (let z = -36; z < 40; z += 18) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 6, 8), lampM); p.position.set(B0.minX - 6.4, GY + 3, z); G.scene.add(p); const h = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffd7a0, toneMapped: false })); h.position.set(B0.minX - 6.4, GY + 6.05, z); G.scene.add(h); }
  const carCols = [0xb8bcc0, 0x1d1f24, 0x8a1e1e, 0x2d4f7c, 0xe6e2d8, 0x55585c];
  for (let i = 0; i < 9; i++) {
    const z = -45 + i * 11 + rand(-2, 2), x = B0.minX - (i % 2 ? 9.5 : 19.5), col = carCols[i % carCols.length];
    const car = new THREE.Group(); car.position.set(x, GY, z); car.rotation.y = (i % 2 ? 0 : Math.PI) + Math.PI / 2 * 0; G.scene.add(car);
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.7, 4.4), new THREE.MeshStandardMaterial({ color: col, roughness: 0.25, metalness: 0.6 })); body.position.y = 0.6; car.add(body);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.6, 2.2), new THREE.MeshStandardMaterial({ color: 0x1a2028, roughness: 0.1, metalness: 0.4 })); cab.position.set(0, 1.2, -0.2); car.add(cab);
  }
}

// ---------------- light: low sun through the west windows, office panels overhead ----------------
function buildLights() {
  const scene = G.scene;
  scene.add(new THREE.HemisphereLight(0xc4cee2, 0x6a5848, 0.75));
  const sun = new THREE.DirectionalLight(0xffb87a, 4.2);
  G.sunDir = new THREE.Vector3(-1, 0.5, 0.25).normalize();
  sun.position.copy(G.sunDir).multiplyScalar(45); sun.target.position.set(0, 0, 0);
  sun.castShadow = true; sun.shadow.mapSize.set(shadowSize(), shadowSize());
  Object.assign(sun.shadow.camera, { left: -27, right: 27, top: 22, bottom: -22, near: 5, far: 100 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.035; sun.shadow.radius = 3;
  scene.add(sun); scene.add(sun.target); G.sun = sun;
  for (const [x, z, i, c] of [[-13.8, 0, 10, 0xfff1dc], [-6.9, -9.6, 10, 0xfff1dc], [-13.8, -9, 20, 0xffe0b4], [0, 4.2, 26, 0xf6f3ec], [-4.5, 8, 18, 0xf6f3ec], [4.5, 8, 18, 0xf6f3ec],
    [6.5, -9, 18, 0xffe6c4], [11.5, -1, 22, 0xffe6c4], [13.5, -9.2, 16, 0xeef4ff], [-1.6, -9, 16, 0xfff1dc], [-13.5, 8, 16, 0xffe6c4], [12, 8, 16, 0xffe6c4]]) {
    const s = new THREE.SpotLight(c, i, 11, 0.95, 0.85, 1.6); s.position.set(x, WH - 0.05, z); s.target.position.set(x, 0, z); scene.add(s); scene.add(s.target);
  }
}

// ---------------- meeting rooms (glass) ----------------
function meetingTable(cx, cz, yaw) {
  dressChairs();
  const t = prop2('MeetTable', cx, cz, yaw, { contact: 0.5, ch: 0.8, cw: 0.97, cd: 0.9 });
  G.surfaces.push(makeBox(cx, cz, t.w * 0.9, t.d * 0.8, yaw, 0, t.h, { y: t.h + 0.004, desk: true }));
  const c = Math.cos(yaw), s = Math.sin(yaw);
  for (const u of [-1.0, 0, 1.0]) for (const side of [-1, 1]) {
    const lx = u, lz = side * (t.d / 2 + 0.28), x = cx + lx * c + lz * s, z = cz - lx * s + lz * c;
    const ch = prop2('MeetChair', x, z, yaw + (side > 0 ? Math.PI : 0) + rand(-0.25, 0.25), { contact: 0.35, col: false });
    addChair(ch.obj, { r: 0.32, name: 'Meeting chair', cost: 260 });
  }
  for (const u of [-1, 1]) { const x = cx + u * (t.w / 2 + 0.32) * c, z = cz - u * (t.w / 2 + 0.32) * s; const ch = prop2('MeetChair', x, z, yaw + (u > 0 ? -Math.PI / 2 : Math.PI / 2), { contact: 0.35, col: false }); addChair(ch.obj, { r: 0.32, name: 'Meeting chair', cost: 260 }); }
  return t;
}
function buildRooms() {
  const B = B0;
  // Meeting room A, against the west windows
  glassRun('x', -3.4, B.minX + 0.15, -10.6, 3);
  glassRun('x', 3.4, B.minX + 0.15, -10.6, 3);
  glassRun('z', -10.6, -3.4, 0.2, 2); glassRun('z', -10.6, 1.6, 3.4, 1); // (door in between)
  meetingTable(-13.9, 0, Math.PI / 2);
  { const tv = prop2('TVStand', -16.45, 0, 0, { contact: 0.45, ch: 0.7 }); /* (screen towards the table) */ addDestructible({ kind: 'computer', obj: tv.obj, box: collider(-16.45, 0, 0.5, 1.9, 0, 0, 1.0), cost: 1600, name: 'Television', h: tv.h, baseY: 0 }); }
  prop2('Whiteboard', -11.6, 2.6, -Math.PI / 4, { contact: 0.4, ch: 1.8 });
  PLANT(-11.3, -2.7);
  // Meeting room B, by the windows north, beside the lifts
  glassRun('x', -7.2, -10.4, -6.0, 2); glassRun('x', -7.2, -4.6, -3.4, 1);
  glassRun('z', -3.4, B.minZ + 0.15, -7.2, 2);
  meetingTable(-6.9, -9.7, 0);
  prop2('Whiteboard', -9.6, -8.0, Math.PI * 0.75, { contact: 0.4, ch: 1.8 });
  PLANT(-4.2, -11.3);
}

// ---------------- the cubicle farm ----------------
function buildCubicles() {
  // two banks, back to back, each cubicle with a desk, a computer, a chair, paperwork and the odd plant or mug
  const rows = [[-0.2, Math.PI], [2.05, 0], [5.6, Math.PI], [7.85, 0]];
  for (const [z, yaw] of rows) for (const x of [-4.5, -1.5, 1.5, 4.5]) {
    const cu = prop2('Cubicle', x, z, yaw, { contact: 0.3, col: false });
    // its panels: back and two sides (open at the front)
    const c = Math.cos(yaw), s = Math.sin(yaw), w = cu.w, d = cu.d, at = (u, v) => [x + u * c + v * s, z - u * s + v * c];
    { const [bx, bz] = at(0, -d / 2 + 0.03); collider(bx, bz, w, 0.08, yaw, 0, 1.4); }
    for (const sd of [-1, 1]) { const [bx, bz] = at(sd * (w / 2 - 0.03), 0); collider(bx, bz, 0.08, d, yaw, 0, 1.4); }
    // desk against the back panel, the screen on it, the chair at the open side
    const [dx, dz] = at(0, -d / 2 + 0.48);
    const desk = prop2('OpsDesk', dx, dz, yaw, { contact: 0.4, ch: 0.76, cw: 0.95, cd: 0.85 });
    G.surfaces.push(makeBox(dx, dz, desk.w * 0.9, desk.d * 0.8, yaw, 0, desk.h, { y: desk.h + 0.004, desk: true }));
    const [mx, mz] = at(rand(-0.3, 0.3), -d / 2 + 0.32);
    const comp = prop('Computer', mx, mz, yaw, 0.92, desk.h); // (screen towards the chair)
    addDestructible({ kind: 'computer', obj: comp.obj, box: makeBox(mx, mz, comp.w * 0.9, comp.d * 0.9, yaw, desk.h, desk.h + comp.h), cost: 1200, name: 'Computer', h: comp.h, baseY: desk.h });
    const [hx, hz] = at(rand(-0.25, 0.25), -d / 2 + 1.25);
    addChair(prop2('OpsChair', hx, hz, yaw + Math.PI + rand(-0.4, 0.4), { contact: 0.4, col: false }).obj);
    const dv = -d / 2 + 0.48 - desk.d / 2; // (the desk's back edge: plants and cups go on its corners, not off the end in mid-air)
    if (Math.random() < 0.35) { const [px, pz] = at(-desk.w / 2 + 0.17, dv + 0.17); prop('PottedPlant', px, pz, 0, 0.32, desk.h); }
    if (Math.random() < 0.5) { const [px, pz] = at(desk.w / 2 - 0.2, dv + 0.3); spawnJunk('cup', px, pz, { y: desk.h + 0.001, up: true }); }
  }
  for (const [x, z] of [[-7.5, 4.0], [7.5, 4.0], [-7.6, 9.8], [7.6, 9.8]]) BIN(x, z);
  for (const [x, z] of [[-7.8, -0.9], [7.8, -0.9]]) PLANT(x, z);
}

// ---------------- kitchen and lunch area ----------------
// the meeting / lunch chairs: brown leather seats on chrome legs (the model ships them plain white)
const WC_YAW = 0;
let chairsDressed = false;
function dressChairs() {
  if (chairsDressed || !L.models.MeetChair) return; chairsDressed = true;
  const c = makeCanvas(512, 512), x = c.getContext('2d');
  x.fillStyle = '#6a3f22'; x.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 9000; i++) { const px = Math.random() * 512, py = Math.random() * 512, r = 1 + Math.random() * 2.6, l = Math.random(); x.fillStyle = l < 0.5 ? `rgba(40,22,10,${0.08 + l * 0.2})` : `rgba(150,96,58,${(l - 0.5) * 0.25})`; x.beginPath(); x.arc(px, py, r, 0, 6.283); x.fill(); } // the pebbled grain
  x.strokeStyle = 'rgba(35,18,8,0.18)'; x.lineWidth = 1; for (let i = 0; i < 70; i++) { let px = Math.random() * 512, py = Math.random() * 512; x.beginPath(); x.moveTo(px, py); for (let k = 0; k < 6; k++) { px += (Math.random() - 0.5) * 30; py += (Math.random() - 0.5) * 30; x.lineTo(px, py); } x.stroke(); } // fine creases
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2, 2); t.anisotropy = 4;
  const leather = new THREE.MeshStandardMaterial({ name: 'Leather', map: t, color: 0xffffff, roughness: 0.55, metalness: 0, envMapIntensity: 0.7 });
  const chrome = new THREE.MeshStandardMaterial({ name: 'ChairMetal', color: 0xb8bbc0, roughness: 0.22, metalness: 1, envMapIntensity: 1.2 });
  L.models.MeetChair.traverse(o => { if (!o.isMesh) return; const n = o.material.name || ''; if (/leather/i.test(n) && !/metal/i.test(n)) o.material = leather; else if (/metal/i.test(n)) o.material = chrome; });
}

// the second floor's own rugs: a hand-knotted look in rust, ivory and charcoal (the lobby keeps its blue one)
let RUG2 = null;
function opsRug() {
  if (RUG2) return RUG2;
  const W = 1024, H = 1448, c = makeCanvas(W, H), x = c.getContext('2d');
  const rust = '#8e3b22', rustD = '#6e2a17', ivory = '#e9dcc3', char = '#2b2522', ochre = '#c48a3a';
  x.fillStyle = rust; x.fillRect(0, 0, W, H);
  const band = (i, col) => { x.strokeStyle = col; x.lineWidth = 2 * i[1]; x.strokeRect(i[0], i[0], W - 2 * i[0], H - 2 * i[0]); };
  // the border: a charcoal frame, an ivory band of little diamonds, then thin lines in
  x.fillStyle = char; x.fillRect(0, 0, W, H); x.fillStyle = rust; x.fillRect(26, 26, W - 52, H - 52);
  x.fillStyle = ivory; x.fillRect(40, 40, W - 80, H - 80); x.fillStyle = rustD; x.fillRect(92, 92, W - 184, H - 184);
  x.fillStyle = char;
  const dia = (cx, cy, r) => { x.beginPath(); x.moveTo(cx, cy - r); x.lineTo(cx + r, cy); x.lineTo(cx, cy + r); x.lineTo(cx - r, cy); x.closePath(); x.fill(); };
  for (let px = 66; px < W - 40; px += 34) { dia(px, 66, 13); dia(px, H - 66, 13); }
  for (let py = 100; py < H - 60; py += 34) { dia(66, py, 13); dia(W - 66, py, 13); }
  band([104, 3], ochre); band([118, 1.5], ivory);
  // the field: a lattice of ivory diamonds outlined in charcoal, an ochre dot in each
  x.save(); x.beginPath(); x.rect(126, 126, W - 252, H - 252); x.clip();
  x.fillStyle = rust; x.fillRect(126, 126, W - 252, H - 252);
  const S = 96;
  for (let gy = 126 - S; gy < H; gy += S) for (let gx = 126 - S; gx < W; gx += S) {
    const cx = gx + S / 2, cy = gy + S / 2;
    x.fillStyle = char; dia(cx, cy, S * 0.5); x.fillStyle = ivory; dia(cx, cy, S * 0.42); x.fillStyle = rust; dia(cx, cy, S * 0.3); x.fillStyle = ochre; dia(cx, cy, S * 0.1);
  }
  x.restore();
  // a central medallion
  const mx = W / 2, my = H / 2; x.fillStyle = char; dia(mx, my, 230); x.fillStyle = ivory; dia(mx, my, 212); x.fillStyle = rustD; dia(mx, my, 190); x.fillStyle = ochre; dia(mx, my, 120); x.fillStyle = char; dia(mx, my, 70); x.fillStyle = ivory; dia(mx, my, 26);
  // wool: fine fibres and a little wear, so it reads as a rug and not a print
  const img = x.getImageData(0, 0, W, H), dd = img.data;
  for (let i = 0; i < dd.length; i += 4) { const n = (Math.random() - 0.5) * 34 + (((i >> 2) % W) % 3 === 0 ? -6 : 0); dd[i] += n; dd[i + 1] += n; dd[i + 2] += n * 0.9; }
  x.putImageData(img, 0, 0);
  x.fillStyle = 'rgba(255,240,220,0.05)'; for (let i = 0; i < 40; i++) { x.beginPath(); x.ellipse(W / 2 + (Math.random() - 0.5) * W * 0.6, H / 2 + (Math.random() - 0.5) * H * 0.6, 60 + Math.random() * 140, 40 + Math.random() * 90, Math.random() * 3, 0, 6.283); x.fill(); }
  RUG2 = new THREE.CanvasTexture(c); RUG2.colorSpace = THREE.SRGBColorSpace; RUG2.anisotropy = 8;
  return RUG2;
}

function buildKitchen() {
  dressChairs();
  const z0 = B0.minZ, D = 0.66, H = 0.92, x0 = 3.6, x1 = 9.6;
  // counter run along the north wall, upper cabinets, a sink, the coffee machine, cups
  // base cabinets: a dark carcass set back, a recessed plinth, then a drawer over a door in every 60 cm bay, with bar handles
  const cx = (x0 + x1) / 2, KICK = 0.1, FZ = z0 + D - 0.02; // (FZ: the doors' front face)
  box(x1 - x0, H - 0.05 - KICK, D - 0.04, M.cabIn, cx, KICK + (H - 0.05 - KICK) / 2, z0 + (D - 0.04) / 2);
  box(x1 - x0 - 0.02, KICK, D - 0.1, M.black, cx, KICK / 2, z0 + (D - 0.1) / 2, { cast: false });
  box(x1 - x0 + 0.04, 0.05, D + 0.04, M.counter, cx, H - 0.025, z0 + D / 2);
  const bays = Math.round((x1 - x0) / 0.6), bw = (x1 - x0) / bays, gap = 0.004, T = 0.02, DRW = 0.17;
  for (let i = 0; i < bays; i++) {
    const bx = x0 + bw * (i + 0.5), top = H - 0.05;
    box(bw - gap * 2, DRW - gap * 2, T, M.cabinet, bx, top - DRW / 2, FZ + T / 2); // drawer front
    box(0.16, 0.014, 0.022, M.steel, bx, top - DRW / 2, FZ + T + 0.011); // its pull
    const dh = top - DRW - KICK; box(bw - gap * 2, dh - gap * 2, T, M.cabinet, bx, KICK + dh / 2, FZ + T / 2); // door
    const hx = bx + (i % 2 ? -1 : 1) * (bw / 2 - 0.05); box(0.014, 0.14, 0.022, M.steel, hx, KICK + dh - 0.11, FZ + T + 0.011); // its handle, by the opening edge
  }
  // wall cabinets: doors with a gap between, pulls along the bottom, and a strip of light underneath
  const UY0 = 1.78, UH = 0.72, UD = 0.36;
  box(x1 - x0, UH, UD - 0.02, M.cabIn, cx, UY0 + UH / 2, z0 + (UD - 0.02) / 2);
  for (let i = 0; i < bays; i++) {
    const bx = x0 + bw * (i + 0.5);
    box(bw - gap * 2, UH - gap * 2, T, M.cabinet, bx, UY0 + UH / 2, z0 + UD - 0.02 + T / 2);
    box(0.014, 0.12, 0.022, M.steel, bx + (i % 2 ? -1 : 1) * (bw / 2 - 0.05), UY0 + 0.1, z0 + UD + 0.011);
  }
  box(x1 - x0 - 0.1, 0.012, 0.03, new THREE.MeshBasicMaterial({ color: 0xfff1d6 }), cx, UY0 - 0.006, z0 + UD - 0.06, { cast: false });
  box(0.6, 0.02, 0.44, M.steel, 5.0, H + 0.001, z0 + 0.33, { cast: false }); // sink
  box(0.03, 0.28, 0.03, M.steel, 5.0, H + 0.14, z0 + 0.12); box(0.03, 0.03, 0.18, M.steel, 5.0, H + 0.28, z0 + 0.2);
  collider((x0 + x1) / 2, z0 + D / 2, x1 - x0, D, 0, 0, H);
  G.surfaces.push(makeBox((x0 + x1) / 2, z0 + D / 2, x1 - x0, D * 0.9, 0, 0, H, { y: H + 0.004 }));
  // coffee machine (Yusuf's model): a black bean-to-cup machine with a glowing panel
  { const cm = prop2('CoffeeMachine', 7.1, z0 + 0.34, 0, { y: H, contact: 0.4, col: false });
    addDestructible({ kind: 'computer', obj: cm.obj, box: makeBox(7.1, z0 + 0.34, cm.w, cm.d, 0, H, H + cm.h), cost: 2200, name: 'Coffee machine', h: cm.h, baseY: H }); }
  // a stack of plastic cups and a few left on the counter
  for (let i = 0; i < 6; i++) spawnJunk('cup', 8.1, z0 + 0.3, { y: H + 0.004 + i * 0.025, up: true, color: 0xf4f4f2, yaw: 0 });
  for (const [x, z] of [[6.4, z0 + 0.5], [8.6, z0 + 0.45], [4.2, z0 + 0.4]]) spawnJunk('cup', x, z, { y: H + 0.004, up: true });
  // the fridge at the end, a microwave, a water cooler
  prop2('Fridge', 10.15 - 0.5, z0 + 0.42, 0, { contact: 0.5 });
  prop2('Microwave', 4.15, z0 + 0.3, 0, { y: H, contact: 0.4 });
  prop2('WaterCooler', 3.3, -9.6, WC_YAW, { contact: 0.45, ch: 1.4 }); // (Yusuf's model)
  // lunch tables: round white tops on a pedestal, meeting chairs round them, cups and a folder or two
  const tableM = new THREE.MeshStandardMaterial({ color: 0x131417, roughness: 0.26, metalness: 0.85, envMapIntensity: 1.1 }), legM = new THREE.MeshStandardMaterial({ color: 0xe2e4e8, roughness: 0.08, metalness: 1, envMapIntensity: 1.4 }); // (black metal tops on mirror-chrome bases)
  for (const [x, z] of [[6.2, -3.4], [10.6, -3.6], [14.6, -3.0], [8.4, 0.9], [12.8, 1.1], [14.8, 6.2], [10.9, 6.6]]) {
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.04, 32), tableM); top.position.set(x, 0.74, z); top.castShadow = true; top.receiveShadow = true; G.scene.add(top);
    box(0.08, 0.72, 0.08, legM, x, 0.36, z); box(0.55, 0.03, 0.55, legM, x, 0.015, z, { cast: false });
    collider(x, z, 0.9, 0.9, 0, 0, 0.76);
    G.surfaces.push(makeBox(x, z, 0.8, 0.8, 0, 0, 0.76, { y: 0.765 }));
    const n = 3 + (Math.random() < 0.5 ? 1 : 0), a0 = rand(0, 6.28);
    for (let i = 0; i < n; i++) { const a = a0 + i / n * Math.PI * 2; const ch = prop2('MeetChair', x + Math.cos(a) * 0.95, z + Math.sin(a) * 0.95, Math.atan2(-Math.cos(a), -Math.sin(a)) + rand(-0.3, 0.3), { contact: 0.35, col: false }); addChair(ch.obj, { r: 0.32, name: 'Chair', cost: 180 }); }
    for (let i = 0; i < 2; i++) spawnJunk('cup', x + rand(-0.35, 0.35), z + rand(-0.35, 0.35), { y: 0.763, up: true });
  }
  // the serving trolley with cups on it
  { const t = prop2('OpsTrolley', 16.4, -5.6, -Math.PI / 2, { contact: 0.4, col: false }); addChair(t.obj, { r: 0.36, name: 'Trolley', cost: 0, light: true, noTip: true }); }
  rug(8.6, -9.6, 2.2, 3.4, Math.PI / 2, opsRug());
  PLANT(16.6, -0.9); PLANT(16.6, 3.4); BIN(9.9, -10.6); BIN(16.4, 8.8);
}

// ---------------- the washroom ----------------
function buildWashroom() {
  const r = OPS.bath, H = WH;
  // west wall (tall; fades when it's in the way), south wall low so the camera sees in, a door gap
  const ww = box(0.16, H, r.z1 - r.z0, M.paintDk, r.x0, H / 2, (r.z0 + r.z1) / 2, { uvScale: [3, 3] }); L.occluders.push(ww);
  collider(r.x0, (r.z0 + r.z1) / 2, 0.2, r.z1 - r.z0, 0, 0, 3);
  const dz0 = r.x0 + 0.5, dz1 = r.x0 + 1.6; // door gap (x)
  box(r.x1 - dz1, 1.1, 0.16, M.paintDk, (dz1 + r.x1) / 2, 0.55, r.z1); box(r.x1 - dz1 + 0.04, 0.05, 0.22, M.stoneCap, (dz1 + r.x1) / 2, 1.12, r.z1);
  box(dz0 - r.x0, 1.1, 0.16, M.paintDk, (r.x0 + dz0) / 2, 0.55, r.z1);
  collider((dz1 + r.x1) / 2, r.z1, r.x1 - dz1, 0.2, 0, 0, 3); collider((r.x0 + dz0) / 2, r.z1, dz0 - r.x0, 0.2, 0, 0, 3);
  { const s = plane(0.5, 0.5, new THREE.MeshStandardMaterial({ map: signTex(256, 256, '#20262e', [{ text: '🚻', size: 120, color: '#ffffff', font: 'Arial' }, { text: 'WASHROOM', size: 30, color: '#e8e2d6', spacing: 4 }], { top: 120 }), roughness: 0.5 }), dz0 - 0.4, 1.6, r.z1 + 0.09); }
  // the stalls along the north wall, sinks and a long mirror on the west wall
  const st = prop2('ToiletStalls', (r.x0 + r.x1) / 2 + 1.0, r.z0 + 0.05, Math.PI, { contact: 0.3, col: false });
  { const d = st.d; collider((r.x0 + r.x1) / 2 + 1.0, r.z0 + d / 2, st.w, d, 0, 0, 2.2); st.obj.position.z += d / 2; }
  box(0.55, 0.85, 3.2, M.counter, r.x0 + 0.36, 0.425, -8.6); collider(r.x0 + 0.36, -8.6, 0.6, 3.2, 0, 0, 0.9);
  for (const z of [-9.6, -8.6, -7.6]) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.14, 0.1, 20), M.white); b.position.set(r.x0 + 0.36, 0.86, z); G.scene.add(b); box(0.03, 0.2, 0.03, M.steel, r.x0 + 0.14, 0.95, z); }
  plane(3.0, 1.0, new THREE.MeshStandardMaterial({ color: 0xd8dde2, roughness: 0.03, metalness: 1, envMapIntensity: 1.6 }), r.x0 + 0.09, 1.7, -8.6, Math.PI / 2);
  // toilet paper everywhere (the robbers had a go at it): the vacuum's job
  for (let i = 0; i < 14; i++) spawnPaper(rand(r.x0 + 1, r.x1 - 0.4), 0, rand(r.z0 + 2.2, r.z1 - 0.4), 0, 0, 0, { rest: true, money: false });
  BIN(r.x1 - 0.4, r.z1 - 0.5);
}

// ---------------- the manager's corner office ----------------
function buildCorner() {
  const B = B0;
  glassRun('z', -10.6, B.minZ + 0.15, -6.0, 3);
  glassRun('x', -6.0, B.minX + 0.15, -13.4, 2); glassRun('x', -6.0, -12.2, -10.6, 1); // (door in between)
  rug(-14.0, -9.0, 3.2, 4.2, Math.PI / 2, opsRug());
  // the big wooden desk facing the door, the leather chairs, a couch by the window, the bust on a pedestal
  const d = prop('Desk', -13.9, -9.6, 0, 1.05);
  C(-13.9, -9.6, d.w * 0.98, d.d * 0.98, 0, 0.78, { desk: true });
  G.surfaces.push(makeBox(-13.9, -9.6, d.w * 0.95, d.d * 0.9, 0, 0, d.h, { y: d.h + 0.005, desk: true }));
  const comp = prop('Computer', -13.4, -9.85, Math.PI, 1, d.h);
  addDestructible({ kind: 'computer', obj: comp.obj, box: makeBox(-13.4, -9.85, comp.w * 0.95, comp.d * 0.9, Math.PI, d.h, d.h + comp.h), cost: 1200, name: 'Computer', h: comp.h, baseY: d.h });
  prop2('LeatherChair', -13.9, -10.95, 0, { contact: 0.45, ch: 0.9 });
  for (const x of [-14.6, -13.1]) prop2('LeatherChair', x, -8.0, Math.PI, { contact: 0.45, ch: 0.9 });
  { const c = prop('Couch', -16.25, -7.6, Math.PI / 2, 0.85); C(-16.25, -7.6, c.w * 0.95, c.d * 0.95, Math.PI / 2, 1.1); }
  box(0.42, 1.05, 0.42, L.mats.stonePillar, -11.3, 0.525, -11.4); prop2('Bust', -11.3, -11.4, -0.6, { y: 1.05, contact: 0, col: false }); collider(-11.3, -11.4, 0.45, 0.45, 0, 0, 1.6);
  prop2('Shelf', -12.0, B.minZ + 0.9, 0, { contact: 0.5 });
  { const p = prop('SmallerPlantBox', -16.3, -11.3, 0); addDestructible({ kind: 'plant', obj: p.obj, box: C(-16.3, -11.3, 1.1, 1.0, 0, 1.6), cost: 350, name: 'Planter', h: p.h }); }
  BIN(-12.6, -10.9);
}

// ---------------- the rest: printers, a lounge by the windows, plants, the cart ----------------
function buildMisc() {
  // the custodian's cart, by the lifts
  const cart = prop('Cart', 4.6, -6.4, Math.PI);
  addChair(cart.obj, { r: 0.62, heavy: true, noTip: true, mass: 2.2 });
  G.cart = cart.obj;
  // printer and copy corner
  prop2('Printer', -16.0, 3.86, 0, { contact: 0.55 }); // (one, in the corner by the windows, its back to the meeting room's glass)
  // lounge by the west windows
  { const c = prop('Couch', -16.2, 8.6, Math.PI / 2); C(-16.2, 8.6, c.w * 0.95, c.d * 0.95, Math.PI / 2, 1.1); }
  rug(-14.4, 8.6, 2.6, 3.8, 0, opsRug());
  { const ct = prop('CoffeeTable', -14.3, 8.6, 0, 0.8); const b = C(-14.3, 8.6, ct.w * 0.9, ct.d * 0.9, 0, 0.45);
    addDestructible({ kind: 'table', obj: ct.obj, box: b, cost: 900, name: 'Glass coffee table', w: ct.w, h: ct.h, keepCollider: true });
    G.surfaces.push(makeBox(-14.3, 8.6, ct.w * 0.95, ct.d * 0.95, 0, 0, ct.h, { y: ct.h })); }
  for (const z of [7.4, 9.8]) prop2('LeatherChair', -12.4, z, -Math.PI / 2, { contact: 0.45, ch: 0.9 });
  PLANT(-16.4, 11.3); PLANT(-16.4, 5.4); PLANT(-10.0, 11.3);
  { const p = prop('PlantBox', 0, 11.6, 0); C(0, 11.6, p.w * 0.95, p.d * 0.9, 0, 1.2); }
  // a whiteboard and a team area by the cubicles
  prop2('Whiteboard', 9.3, 9.6, -Math.PI / 2, { contact: 0.4, ch: 1.8 });
  // by the lifts
  PLANT(-3.8, -11.4); PLANT(3.0, -11.5); /* (beside the kitchen counter, not in it) */
  for (const [x, z] of [[-5.2, 4.0], [-3.8, -4.6]]) BIN(x, z);
}

// ---------------- robbers ----------------
export function spawnOpsEnemies() {
  const E = (x, z, yaw, g, o) => G.enemies.push(new Enemy(x, z, yaw, g, o));
  E(-1.0, -6.6, 0.4, 1, { idle: 'guard' }); E(2.4, -4.2, -0.6, 1, { idle: 'patrol' });               // by the lifts
  E(-3.0, 3.4, 1.6, 2, { idle: 'loot' }); E(3.2, 3.6, -1.4, 2, { idle: 'loot' }); E(0, 9.6, 3.0, 2, { idle: 'guard' }); E(-6.2, 9.5, 2.2, 2, { idle: 'loot' }); // the cubicles
  E(-12.6, -1.9, 1.2, 3, { idle: 'loot' }); E(-8.4, -8.6, 0.8, 3, { idle: 'guard' });                // meeting rooms
  E(-14.9, -7.2, Math.PI, 4, { idle: 'loot' }); E(-11.6, -7.0, 0.6, 4, { heavy: true, idle: 'guard' }); // the corner office
  E(8.6, -2.0, -2.2, 5, { idle: 'patrol' }); E(13.2, -1.2, 2.0, 5, { idle: 'loot' }); E(12.8, 8.6, -2.4, 5, { idle: 'guard' }); // lunch area
  E(14.6, -8.2, Math.PI, 6, { idle: 'loot' });                                                         // the washroom
}

// ---------------- the mess Karim walks in on ----------------
export function seedOpsMess() {
  // muddy boots everywhere the robbers went (on the wood: the mop's job)
  const trails = [
    [[-1.6, -10.5], [-2.0, -6.0], [-9.6, -5.0], [-12.0, -6.4]],
    [[1.6, -10.5], [2.4, -6.0], [8.8, -5.0], [13.0, -5.2], [10.8, -6.7]],
    [[-1.6, -10.5], [-1.0, -4.5], [-9.2, -2.0], [-10.6, 1.0]],
    [[1.6, -10.5], [9.2, -0.6], [9.6, 4.0], [12.5, 10.5]],
    [[-1.6, -10.5], [-9.0, 4.0], [-12.0, 10.5]],
  ];
  for (const t of trails) trail(t, 0.85);
  dirtBlob(7.0, -10.8, 0.5, '62,40,22', 0.85, 1.3); dirtBlob(7.6, -10.2, 0.3, '62,40,22', 0.7, 1.3); // spilled coffee
  dirtBlob(11.4, -2.6, 0.4, '62,40,22', 0.75, 1.3); dirtBlob(-1.6, -8.8, 0.35, '92,70,48', 0.6);
  // scuffs and smears on the wood (never on the carpets, never under the furniture)
  const B = B0, onCarpet = (x, z) => OPS.carpet.some(r => x > r.x0 - 0.3 && x < r.x1 + 0.3 && z > r.z0 - 0.3 && z < r.z1 + 0.3) || (x > OPS.bath.x0 && z < OPS.bath.z1);
  const free = (x, z) => !onCarpet(x, z) && !G.colliders.some(b => b.active && b.y0 < 0.4 && Math.abs(x - b.cx) < b.hx + Math.abs(b.hz) + 0.6 && Math.abs(z - b.cz) < Math.abs(b.hx) + b.hz + 0.6 && Math.hypot(x - b.cx, z - b.cz) < Math.hypot(b.hx, b.hz) + 0.3);
  const spread = { smear: 6, heel: 7, scratch: 6, gum: 3, speckle: 4, skid: 3, pivot: 3 };
  for (const t in spread) for (let i = 0; i < spread[t]; i++) for (let k = 0; k < 24; k++) { const x = rand(B.minX + 0.8, B.maxX - 0.8), z = rand(B.minZ + 0.8, B.maxZ - 0.8); if (free(x, z)) { addDecal(t, x, z); break; } }
  // worn finish along the main walkways (buffs back with the mop)
  paintDull([[-1.6, -9.5, -1.4, -4.6, 0.7, 1], [-1.4, -4.6, -9.6, -4.4, 0.6, 1], [1.6, -9.5, 9.2, -5.0, 0.6, 1]], [[-0.2, -6.4, 1.6, 0.9]], 0.32, 0.46);
  // paper and folders all over the offices (the vacuum's job): far more than downstairs
  for (const r of OPS.carpet) {
    const n = Math.round((r.x1 - r.x0) * (r.z1 - r.z0) * 0.35);
    for (let i = 0; i < n; i++) spawnPaper(rand(r.x0 + 0.3, r.x1 - 0.3), 0, rand(r.z0 + 0.3, r.z1 - 0.3), 0, 0, 0, { rest: true, money: false });
    for (let i = 0; i < n * 0.25; i++) spawnJunk('folder', rand(r.x0 + 0.3, r.x1 - 0.3), rand(r.z0 + 0.3, r.z1 - 0.3));
  }
  for (let i = 0; i < 26; i++) spawnPaper(rand(-16, -10.8), 0, rand(-11.5, -6.4), 0, 0, 0, { rest: true, money: Math.random() < 0.2 }); // the corner office, ransacked
  for (let i = 0; i < 8; i++) spawnJunk('folder', rand(-16, -10.8), rand(-11.5, -6.4));
  // plastic cups dropped round the lunch area
  for (let i = 0; i < 22; i++) spawnJunk('cup', rand(4.5, 16.5), rand(-5.5, 8.5));
  // nothing on the carpets, in the washroom or under the furniture for the mop (the carpets are the vacuum's)
  clearDirtZones([...(G.noDirt || []), ...G.colliders.filter(b => b.active && b.y0 < 0.4 && b.y1 < 2.2)]);
  FX.dirtDirty = true;
}
