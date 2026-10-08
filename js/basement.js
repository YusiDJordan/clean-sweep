// The custodian's basement: the tutorial level. A concrete work room where Karim starts his shift (his cart in its
// painted bay, a desk under the notice board, lockers, the sink), and through it the bank's marble staff hall, gone
// dull along the path everyone walks, with the fire doors to the stairs up to the lobby at the far end.
// Props are Yusuf's models; walls, floors, shelving and pipes are built here.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { G, makeBox, canvasTex, makeCanvas, rand, pick } from './state.js';
import { L, box, collider, plane, prop, prop2, contactShadow, BIN, buildFloor, mats } from './level.js';
import { addChair } from './destruct.js';
import { FX, trail, dirtBlob, spawnPaper, spawnShard, litterCount, spark, floatText } from './fx.js';
import { addDecal, decalDirt, DECALS, paintDull, roughIn, fadeDull } from './decals.js';
import { SFX } from './audio.js';
import { shadowSize } from './render.js';
import { fireDoor } from './doors.js';

const B0 = { minX: -7, maxX: 19, minZ: -5.5, maxZ: 5.5 };
const RA = { x0: -7, x1: 7 }, HB = { x0: 7, x1: 19 }; // the concrete room, the marble hall
export const BS = {
  bounds: B0,
  start: new THREE.Vector3(-6.0, 0, 2.95), startYaw: Math.PI / 2,
  cart: [2.8, 0.8], cartYaw: Math.PI / 2 + 0.3,
  doors: { x0: 15.6, x1: 17.7, cx: 16.65 },    // fire doors up to the lobby (north wall, far end of the hall)
  robber: [16.65, -6.9],                       // waiting on the stair landing behind them
  mud: { x0: -7, x1: -2.0, z0: 1.3, z1: 4.4, c: new THREE.Vector3(-4.7, 0, 2.75) },
  spill: { x0: -6.4, x1: -3.4, z0: -3.4, z1: 0.9, c: new THREE.Vector3(-4.9, 0, -0.9) },
  gap: { z0: -1.4, z1: 2.2 },                  // the opening from the work room into the hall (x = 7)
  hall: { x0: 7.3, x1: 19, z0: -5.5, z1: 5.5, c: new THREE.Vector3(12.4, 0, -0.9) }, // the marble (gone dull along the staff's path)
  cam: [-2.6, 14.6, -2.4, 2.2],                // camera target clamp (x0, x1, z0, z1)
};
const WALL_H = 3.2, T = 0.3, LOW_H = 0.78;
const M = {};
const LV = { door: null, acMixer: null, doorCol: null };

// ---------------- textures ----------------
let sd = 7;
const sr = () => { sd = (sd * 16807) % 2147483647; return (sd - 1) / 2147483646; };
function noiseLayer(x, w, h, cells, alpha, light = false) {
  const n = makeCanvas(cells, Math.max(2, Math.round(cells * h / w))), nx = n.getContext('2d'), id = nx.createImageData(n.width, n.height);
  for (let i = 0; i < id.data.length; i += 4) { const v = sr() * 255; id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255; }
  nx.putImageData(id, 0, 0);
  x.save(); x.globalAlpha = alpha; x.globalCompositeOperation = light ? 'soft-light' : 'overlay'; x.imageSmoothingEnabled = true; x.drawImage(n, 0, 0, w, h); x.restore();
}
// concrete floor for the whole room (k px per metre), with the painted bay lines, hatching and stains baked in
function floorTex(k = 150) {
  const W = (RA.x1 - RA.x0) * k | 0, H = (B0.maxZ - B0.minZ) * k | 0, c = makeCanvas(W, H), x = c.getContext('2d');
  const P = (wx, wz) => [(wx - RA.x0) * k, (wz - B0.minZ) * k];
  x.fillStyle = '#76716a'; x.fillRect(0, 0, W, H);
  noiseLayer(x, W, H, 18, 0.16); noiseLayer(x, W, H, 70, 0.12); noiseLayer(x, W, H, 380, 0.1);
  for (let i = 0; i < 160; i++) { // faint trowel marks and wear
    const px = sr() * W, py = sr() * H, r = 30 + sr() * 200, g = x.createRadialGradient(px, py, 0, px, py, r);
    g.addColorStop(0, sr() < 0.5 ? `rgba(20,16,12,${0.015 + sr() * 0.035})` : `rgba(255,248,236,${0.015 + sr() * 0.03})`); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.fillRect(px - r, py - r, r * 2, r * 2);
  }
  for (let i = 0; i < 26000; i++) { x.fillStyle = sr() < 0.5 ? `rgba(30,26,22,${0.06 + sr() * 0.12})` : `rgba(220,214,204,${0.04 + sr() * 0.08})`; x.fillRect(sr() * W, sr() * H, 1 + sr() * 1.6, 1 + sr() * 1.6); }
  // saw-cut joints
  x.lineWidth = 2.5;
  for (const jx of [-3.5, 0, 3.5]) { const [a] = P(jx, 0); x.strokeStyle = 'rgba(25,22,19,0.75)'; x.beginPath(); x.moveTo(a, 0); x.lineTo(a, H); x.stroke(); x.strokeStyle = 'rgba(230,225,215,0.18)'; x.beginPath(); x.moveTo(a + 2, 0); x.lineTo(a + 2, H); x.stroke(); }
  for (const jz of [-1.8, 1.9]) { const [, b] = P(0, jz); x.strokeStyle = 'rgba(25,22,19,0.75)'; x.beginPath(); x.moveTo(0, b); x.lineTo(W, b); x.stroke(); x.strokeStyle = 'rgba(230,225,215,0.18)'; x.beginPath(); x.moveTo(0, b + 2); x.lineTo(W, b + 2); x.stroke(); }
  // hairline cracks
  x.strokeStyle = 'rgba(28,24,20,0.55)'; x.lineWidth = 1.3;
  for (let i = 0; i < 9; i++) { let px = sr() * W, py = sr() * H, a = sr() * 6.28; x.beginPath(); x.moveTo(px, py); for (let s = 0; s < 14; s++) { a += (sr() - 0.5) * 0.9; px += Math.cos(a) * 18; py += Math.sin(a) * 18; x.lineTo(px, py); } x.stroke(); }
  // old stains: oil under the cart bay, damp by the sink, rust by the cabinet
  x.save(); x.filter = 'blur(10px)';
  const stain = (wx, wz, rx, rz, col) => { const [px, py] = P(wx, wz); x.fillStyle = col; x.beginPath(); x.ellipse(px, py, rx * k, rz * k, sr() * 3, 0, 6.28); x.fill(); };
  stain(2.4, 1.2, 0.5, 0.3, 'rgba(18,14,10,0.30)'); stain(3.4, 0.2, 0.3, 0.2, 'rgba(18,14,10,0.25)'); stain(0.9, -4.6, 0.9, 0.5, 'rgba(30,34,38,0.28)');
  stain(6.2, -2.6, 0.5, 0.7, 'rgba(70,40,20,0.22)'); stain(-6.2, -3.6, 0.6, 0.4, 'rgba(20,16,12,0.2)'); stain(-1.2, 3.8, 0.7, 0.4, 'rgba(20,16,12,0.16)');
  x.restore();
  // painted lines (worn): the cart bay, a lane line, keep-clear hatching at the fire doors
  const paint = makeCanvas(W, H), p = paint.getContext('2d');
  p.strokeStyle = '#d6a21c'; p.lineWidth = 0.085 * k; p.lineCap = 'square';
  const line = (pts) => { p.beginPath(); pts.forEach(([wx, wz], i) => { const [px, py] = P(wx, wz); i ? p.lineTo(px, py) : p.moveTo(px, py); }); p.stroke(); };
  line([[1.35, -0.6], [4.25, -0.6], [4.25, 2.25], [1.35, 2.25], [1.35, -0.6]]);
  line([[1.35, -0.6], [-3.4, -0.6]]);
  { // stencilled CART in the bay
    const [px, py] = P(2.8, 2.0); p.save(); p.translate(px, py); p.fillStyle = '#d6a21c'; p.font = `700 ${0.3 * k}px Oswald, 'Arial Narrow', Arial`; p.textAlign = 'center'; p.textBaseline = 'middle';
    p.fillText('CART', 0, 0); p.restore();
  }
  p.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 9000; i++) { p.fillStyle = `rgba(0,0,0,${0.3 + sr() * 0.7})`; const r = 1 + sr() * 4; p.fillRect(sr() * W, sr() * H, r, r * (0.5 + sr())); }
  x.globalAlpha = 0.88; x.drawImage(paint, 0, 0); x.globalAlpha = 1;
  noiseLayer(x, W, H, 160, 0.06);
  const t = canvasTex(c, true, false); t.flipY = false; t.anisotropy = 8; return t;
}
// painted concrete block wall (4 m tile): grey blocks above a darker painted dado, grime streaks
function wallTex() {
  const S = 1024, c = makeCanvas(S, S), x = c.getContext('2d'), bw = S / 10, bh = S / 20;
  x.fillStyle = '#4c4b47'; x.fillRect(0, 0, S, S); // (mortar)
  for (let r = 0; r < 20; r++) for (let i = -1; i < 11; i++) {
    const ox = (r % 2) * bw / 2, k = 0.92 + sr() * 0.1;
    const g = x.createLinearGradient(0, r * bh, 0, r * bh + bh);
    g.addColorStop(0, `rgb(${122 * k | 0},${120 * k | 0},${114 * k | 0})`); g.addColorStop(1, `rgb(${104 * k | 0},${102 * k | 0},${97 * k | 0})`);
    x.fillStyle = g; x.fillRect(i * bw + ox + 3, r * bh + 3, bw - 5, bh - 5);
  }
  noiseLayer(x, S, S, 256, 0.08); noiseLayer(x, S, S, 64, 0.06);
  const dado = S * (1.05 / 4);
  x.save(); x.globalCompositeOperation = 'multiply'; x.fillStyle = '#5d6670'; x.fillRect(0, S - dado, S, dado); x.restore();
  x.fillStyle = 'rgba(30,34,40,0.35)'; x.fillRect(0, S - dado, S, dado);
  x.fillStyle = 'rgba(210,205,190,0.25)'; x.fillRect(0, S - dado - 6, S, 5);
  for (let i = 0; i < 40; i++) { // streaks and damp
    const px = sr() * S, w = 6 + sr() * 30, h = 80 + sr() * 360, g = x.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, `rgba(25,22,18,${0.08 + sr() * 0.12})`); g.addColorStop(1, 'rgba(25,22,18,0)'); x.fillStyle = g; x.fillRect(px, 0, w, h);
  }
  x.save(); x.filter = 'blur(12px)'; for (let i = 0; i < 10; i++) { x.fillStyle = `rgba(25,24,20,${0.1 + sr() * 0.15})`; x.beginPath(); x.ellipse(sr() * S, S - sr() * 120, 40 + sr() * 120, 20 + sr() * 50, 0, 0, 6.28); x.fill(); } x.restore();
  return canvasTex(c, true, true);
}
function hazardTex() {
  const c = makeCanvas(256, 256), x = c.getContext('2d');
  x.fillStyle = '#e0a816'; x.fillRect(0, 0, 256, 256); x.fillStyle = '#18171a';
  for (let t = -256; t < 512; t += 64) { x.beginPath(); x.moveTo(t, 0); x.lineTo(t + 32, 0); x.lineTo(t + 32 - 256, 256); x.lineTo(t - 256, 256); x.closePath(); x.fill(); }
  noiseLayer(x, 256, 256, 64, 0.35);
  x.globalCompositeOperation = 'destination-out'; for (let i = 0; i < 600; i++) { x.fillStyle = `rgba(0,0,0,${sr() * 0.5})`; x.fillRect(sr() * 256, sr() * 256, 2 + sr() * 5, 2 + sr() * 4); }
  return canvasTex(c, true, true);
}
function chainTex() {
  const c = makeCanvas(128, 128), x = c.getContext('2d');
  x.strokeStyle = '#c9ccd0'; x.lineWidth = 3.2;
  for (let i = -2; i < 6; i++) { x.beginPath(); x.moveTo(i * 32, 0); x.lineTo(i * 32 + 128, 128); x.stroke(); x.beginPath(); x.moveTo(i * 32 + 128, 0); x.lineTo(i * 32, 128); x.stroke(); }
  const t = canvasTex(c, true, true); return t;
}
function signTexture(lines, bg = '#f2efe6', fg = '#1d1d1f', w = 512, h = 256) {
  const c = makeCanvas(w, h), x = c.getContext('2d'); x.fillStyle = bg; x.fillRect(0, 0, w, h);
  x.fillStyle = fg; x.textAlign = 'center'; x.textBaseline = 'middle';
  lines.forEach(([t, size, y, col]) => { x.fillStyle = col || fg; x.font = `700 ${size}px Oswald, 'Arial Narrow', Arial`; x.fillText(t, w / 2, y); });
  return canvasTex(c, true);
}

// ---------------- geometry batching (static clutter: one draw per material) ----------------
const batch = new Map();
function addGeo(mat, g) { if (!batch.has(mat)) batch.set(mat, []); batch.get(mat).push(g.index ? g : g); }
function sbox(mat, w, h, d, x, y, z, ry = 0) { const g = new THREE.BoxGeometry(w, h, d); if (ry) g.rotateY(ry); g.translate(x, y, z); addGeo(mat, g); }
function scyl(mat, rt, rb, h, x, y, z, seg = 10, rotZ = 0, rotX = 0) { const g = new THREE.CylinderGeometry(rt, rb, h, seg); if (rotZ) g.rotateZ(rotZ); if (rotX) g.rotateX(rotX); g.translate(x, y, z); addGeo(mat, g); }
function flushBatch() {
  for (const [mat, list] of batch) {
    const geo = mergeGeometries(list.map(g => g.index ? g.toNonIndexed() : g), false); if (!geo) continue;
    const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true; G.scene.add(m);
  }
  batch.clear();
}

// ---------------- helpers ----------------
const WB = (w, h, d, x, y, z, mat = M.wall) => box(w, h, d, mat, x, y, z, { uvScale: [4, 4], uvWorld: true });
// a model standing against a wall: 'n' (north wall, facing +z) or 'w' (west wall, facing +x). fr = the model's own front direction
function onWall(name, side, along, o = {}) {
  const [dx, dy, dz] = L.dims[name], fr = o.front || 'z';
  // rotation that turns the model's front (+z, -z, +x, -x) to face into the room
  const face = side === 'n' ? 0 : Math.PI / 2; // +z or +x
  const base = { z: 0, '-z': Math.PI, x: -Math.PI / 2, '-x': Math.PI / 2 }[fr];
  const yaw = face + base, depth = (fr === 'x' || fr === '-x') ? dx : dz, width = (fr === 'x' || fr === '-x') ? dz : dx;
  const off = depth / 2 + (o.gap ?? 0.01);
  const x = side === 'n' ? along : B0.minX + off, z = side === 'n' ? B0.minZ + off : along;
  const p = prop2(name, x, z, yaw, { y: o.y || 0, contact: o.contact ?? 0.45, col: o.col, ch: o.ch, cw: o.cw, cd: o.cd });
  return { ...p, x, z, yaw, width, depth };
}

// ---------------- the room ----------------
export function buildBasement() {
  mats();
  const base = L.mats;
  M.wall = new THREE.MeshStandardMaterial({ map: wallTex(), roughness: 0.88, envMapIntensity: 0.5 });
  M.cap = new THREE.MeshStandardMaterial({ color: 0x17181b, roughness: 0.8 });
  M.concrete = new THREE.MeshStandardMaterial({ map: floorTex(), roughness: 0.62, metalness: 0, envMapIntensity: 0.45 });
  M.plain = new THREE.MeshStandardMaterial({ color: 0x55524c, roughness: 0.9 });
  M.metal = new THREE.MeshStandardMaterial({ color: 0x80868d, roughness: 0.42, metalness: 0.7, envMapIntensity: 0.9 });
  M.dark = new THREE.MeshStandardMaterial({ color: 0x2a2d32, roughness: 0.5, metalness: 0.6 });
  M.pipe = new THREE.MeshStandardMaterial({ color: 0x41454b, roughness: 0.45, metalness: 0.75 });
  M.rust = new THREE.MeshStandardMaterial({ color: 0x6a4a35, roughness: 0.7, metalness: 0.4 });
  M.white = new THREE.MeshStandardMaterial({ color: 0xe8e6e0, roughness: 0.55 });
  M.hazard = new THREE.MeshStandardMaterial({ map: hazardTex(), roughness: 0.7 });
  M.chain = new THREE.MeshStandardMaterial({ map: chainTex(), alphaTest: 0.45, side: THREE.DoubleSide, metalness: 0.7, roughness: 0.4, transparent: false });
  M.door = new THREE.MeshStandardMaterial({ color: 0x3c4652, roughness: 0.45, metalness: 0.5 });
  M.tube = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4e0, emissiveIntensity: 2.4 });
  M.jugs = [0xf2f0ea, 0x2d6fc2, 0xc23a2d, 0xe8c22a, 0x3d9b54].map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.4 }));
  M.tp = new THREE.MeshStandardMaterial({ color: 0xf4f2ee, roughness: 0.8 });
  M.wood = base.wood;
  M.stone = base.stoneLight; M.stoneDk = base.stoneDark; M.pillar = base.stonePillar;
  M.brass = new THREE.MeshStandardMaterial({ color: 0xd2a659, roughness: 0.24, metalness: 1, envMapIntensity: 1.4 });
  G.scene.background = new THREE.Color(0x050608);

  // floors: bare concrete in the work room, the bank's marble in the staff hall (one shared dirt / polish layer, each its own shine)
  const Wd = B0.maxX - B0.minX, Hd = B0.maxZ - B0.minZ, CX = (B0.minX + B0.maxX) / 2;
  const fA = buildFloor({ mat: M.concrete, hole: false, refl: 0.5, rect: { minX: RA.x0, maxX: RA.x1, minZ: B0.minZ, maxZ: B0.maxZ }, uv: (x, z) => [(x - RA.x0) / (RA.x1 - RA.x0), (z - B0.minZ) / Hd] });
  buildFloor({ mat: base.floor, hole: false, refl: 1.3, rect: { minX: HB.x0, maxX: HB.x1, minZ: B0.minZ, maxZ: B0.maxZ }, share: fA.uniforms });

  // ---- walls: tall at the back (north, west), cut low at the front so the camera sees in ----
  const H2 = WALL_H / 2, dz = BS.doors, door = { z0: 2.35, z1: 3.55 }, PZ = BS.gap;
  // west wall, with the doorway Karim came in by
  WB(T, WALL_H, door.z0 - (B0.minZ - T), B0.minX - T / 2, H2, (B0.minZ - T + door.z0) / 2);
  WB(T, WALL_H, B0.maxZ + T - door.z1, B0.minX - T / 2, H2, (door.z1 + B0.maxZ + T) / 2);
  WB(T, WALL_H - 2.2, door.z1 - door.z0, B0.minX - T / 2, 2.2 + (WALL_H - 2.2) / 2, (door.z0 + door.z1) / 2);
  // north wall: painted block along the work room...
  WB(RA.x1 - (B0.minX - T), WALL_H, T, (B0.minX - T + RA.x1) / 2, H2, B0.minZ - T / 2);
  // ...dressed stone along the hall (a dark wainscot with a brass rail), the fire doors near the far end
  const SW = (x0, x1, y0 = 0, y1 = WALL_H, mat = M.stone) => box(x1 - x0, y1 - y0, T, mat, (x0 + x1) / 2, (y0 + y1) / 2, B0.minZ - T / 2, { uvScale: [3, 3.5], uvWorld: true });
  SW(RA.x1, dz.x0); SW(dz.x1, HB.x1 + T); SW(dz.x0, dz.x1, 2.3, WALL_H);
  for (const [a, b] of [[HB.x0 + 0.25, dz.x0 - 0.14], [dz.x1 + 0.14, HB.x1]]) {
    box(b - a, 1.0, 0.04, M.stoneDk, (a + b) / 2, 0.5, B0.minZ + 0.02, { uvScale: [3, 1], uvWorld: true });
    box(b - a, 0.035, 0.06, M.brass, (a + b) / 2, 1.0, B0.minZ + 0.03, { cast: false });
  }
  for (const x of [dz.x0 - 0.07, dz.x1 + 0.07]) box(0.14, 2.42, 0.08, M.pillar, x, 1.21, B0.minZ + 0.04); // door surround
  box(dz.x1 - dz.x0 + 0.28, 0.12, 0.08, M.pillar, dz.cx, 2.36, B0.minZ + 0.04);
  // the partition between the work room and the hall: a wide opening, the front stub kept low like the other front walls
  const PW = 0.5, px = RA.x1;
  WB(PW, WALL_H, PZ.z0 - B0.minZ, px, H2, (B0.minZ + PZ.z0) / 2);
  box(0.03, WALL_H - 0.02, PZ.z0 - B0.minZ, M.stone, px + PW / 2 + 0.015, H2, (B0.minZ + PZ.z0) / 2, { uvScale: [3, 3.5], uvWorld: true }); // (stone facing on the hall side)
  box(PW + 0.04, 1.0, B0.maxZ + T - PZ.z1, M.stoneDk, px, 0.5, (PZ.z1 + B0.maxZ + T) / 2, { uvScale: [3, 1] });
  box(PW + 0.12, 0.08, B0.maxZ + T - PZ.z1 + 0.06, M.cap, px, 1.04, (PZ.z1 + B0.maxZ + T) / 2);
  box(PW + 0.08, 0.1, PZ.z0 - B0.minZ + T + 0.04, M.cap, px, WALL_H + 0.05, (B0.minZ - T + PZ.z0) / 2);
  box(0.07, 0.012, PZ.z1 - PZ.z0, M.brass, px, 0.006, (PZ.z0 + PZ.z1) / 2, { cast: false }); // brass threshold strip
  // front (south) and east walls, low
  WB(RA.x1 - (B0.minX - T), LOW_H, T, (B0.minX - T + RA.x1) / 2, LOW_H / 2, B0.maxZ + T / 2);
  box(HB.x1 + T - RA.x1, 1.0, T, M.stoneDk, (RA.x1 + HB.x1 + T) / 2, 0.5, B0.maxZ + T / 2, { uvScale: [3, 1] });
  box(T, 1.0, Hd + T, M.stoneDk, HB.x1 + T / 2, 0.5, (B0.minZ + B0.maxZ + T) / 2, { uvScale: [3, 1] });
  // dark caps along the wall tops
  box(T + 0.08, 0.1, Hd + 2 * T + 0.08, M.cap, B0.minX - T / 2, WALL_H + 0.05, 0);
  box(Wd + 2 * T + 0.08, 0.1, T + 0.08, M.cap, CX, WALL_H + 0.05, B0.minZ - T / 2);
  box(RA.x1 - B0.minX + T + 0.04, 0.1, T + 0.08, M.cap, (B0.minX - T + RA.x1) / 2, LOW_H + 0.05, B0.maxZ + T / 2);
  box(HB.x1 - RA.x1 + T + 0.08, 0.08, T + 0.1, M.cap, (RA.x1 + HB.x1 + T) / 2, 1.04, B0.maxZ + T / 2);
  box(T + 0.1, 0.08, Hd + 2 * T + 0.08, M.cap, HB.x1 + T / 2, 1.04, 0);
  // skirting shadow strip so the walls sit on the floor
  for (const [w, d, x, z] of [[0.02, Hd, B0.minX + 0.01, 0], [Wd, 0.02, CX, B0.minZ + 0.01]]) box(w, 0.08, d, M.cap, x, 0.04, z, { cast: false });
  contactShadow(Wd, 0.7, 0.35, null, CX, B0.minZ + 0.25); contactShadow(0.7, Hd, 0.35, null, B0.minX + 0.25, 0);
  // wall colliders (the doorways stay open; the fire doors get their own)
  collider(B0.minX - T / 2, (B0.minZ + door.z0) / 2 - 0.15, T, door.z0 - B0.minZ + 0.3);
  collider(B0.minX - T / 2, (door.z1 + B0.maxZ) / 2 + 0.15, T, B0.maxZ - door.z1 + 0.3);
  collider(B0.minX - T - 0.2, (door.z0 + door.z1) / 2, 0.3, door.z1 - door.z0 + 0.1); // (nobody leaves by the way they came in)
  collider((B0.minX + dz.x0) / 2, B0.minZ - T / 2, dz.x0 - B0.minX + 0.3, T);
  collider((dz.x1 + B0.maxX) / 2, B0.minZ - T / 2, B0.maxX - dz.x1 + 0.3, T);
  collider(CX, B0.maxZ + T / 2, Wd + 0.6, T, 0, 0, 3); collider(B0.maxX + T / 2, 0, T, Hd + 0.6, 0, 0, 3);
  collider(px, (B0.minZ + PZ.z0) / 2, PW, PZ.z0 - B0.minZ); collider(px, (PZ.z1 + B0.maxZ) / 2, PW, B0.maxZ - PZ.z1);
  LV.doorCol = collider(dz.cx, B0.minZ - 0.12, dz.x1 - dz.x0, 0.24);

  // ---- the corridor Karim came in from (behind the open west door) ----
  const cor = new THREE.MeshStandardMaterial({ color: 0x8d8a83, roughness: 0.8 });
  box(3.0, 0.05, 2.9, cor, B0.minX - T - 1.5, -0.025, (door.z0 + door.z1) / 2, { cast: false });
  box(3.0, WALL_H, 0.2, M.wall, B0.minX - T - 1.5, H2, door.z0 - 0.35); box(3.0, WALL_H, 0.2, M.wall, B0.minX - T - 1.5, H2, door.z1 + 0.35);
  box(0.2, WALL_H, 2.9, M.wall, B0.minX - T - 3.0, H2, (door.z0 + door.z1) / 2);
  { // the door itself, swung back into the corridor
    const g = new THREE.Group(); g.position.set(B0.minX - T + 0.02, 0, door.z1 - 0.02); g.rotation.y = 1.75; G.scene.add(g);
    box(0.05, 2.12, 1.14, M.door, 0, 1.06, -0.58, { parent: g }); box(0.07, 0.04, 0.5, M.metal, 0.03, 1.02, -0.85, { parent: g });
    box(0.06, 0.25, 1.1, M.dark, 0, 0.15, -0.58, { parent: g });
  }
  for (const [w, h, d, x, y, z] of [[T + 0.06, 0.08, 1.28, B0.minX - T / 2, 2.2, (door.z0 + door.z1) / 2], [T + 0.06, 2.2, 0.06, B0.minX - T / 2, 1.1, door.z0 - 0.03], [T + 0.06, 2.2, 0.06, B0.minX - T / 2, 1.1, door.z1 + 0.03]]) box(w, h, d, M.dark, x, y, z);

  // ---- the stairwell behind the fire doors (where the robber waits, and the way up to the lobby) ----
  const sw0 = dz.x0 - 0.1, sw1 = dz.x1 + 0.1, sz0 = B0.minZ - T, sz1 = B0.minZ - 4.4;
  box(sw1 - sw0, 0.05, sz0 - sz1, cor, dz.cx, -0.025, (sz0 + sz1) / 2, { cast: false });
  box(0.2, WALL_H, sz0 - sz1, M.wall, sw0 - 0.1, H2, (sz0 + sz1) / 2); box(0.2, WALL_H, sz0 - sz1, M.wall, sw1 + 0.1, H2, (sz0 + sz1) / 2);
  box(sw1 - sw0 + 0.4, WALL_H, 0.2, M.wall, dz.cx, H2, sz1 - 0.1);
  for (let i = 0; i < 12; i++) box(sw1 - sw0, 0.18 * (i + 1), 0.24, M.plain, dz.cx, 0.09 * (i + 1), sz0 - 1.9 - i * 0.18 - 0.12);
  collider(sw0 - 0.1, (sz0 + sz1) / 2, 0.2, sz0 - sz1); collider(sw1 + 0.1, (sz0 + sz1) / 2, 0.2, sz0 - sz1); collider(dz.cx, sz0 - 2.6, sw1 - sw0, 2.6);

  // ---- lights: dim and warm in the work room, pools of light where the work is; softer, warmer light in the hall ----
  const hemi = new THREE.HemisphereLight(0xaab4c6, 0x3e3328, 0.7); G.scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffe6c8, 1.35);
  G.sunDir = new THREE.Vector3(0.45, 1, 0.55).normalize(); sun.position.copy(G.sunDir).multiplyScalar(20).add(new THREE.Vector3(CX, 0, 0)); sun.target.position.set(CX, 0, 0);
  sun.castShadow = true; sun.shadow.mapSize.set(shadowSize(), shadowSize());
  Object.assign(sun.shadow.camera, { left: -17, right: 17, top: 12, bottom: -12, near: 2, far: 50 });
  sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.03; sun.shadow.radius = 4;
  G.scene.add(sun); G.scene.add(sun.target); G.sun = sun;
  for (const [x, z, i, c, d] of [[-4.6, -0.4, 24, 0xffdcaa], [2.4, 0.8, 24, 0xffe2b4], [-0.4, -3.6, 18, 0xe4ecff], [-1.6, 3.4, 16, 0xffdcaa], [5.2, -3.2, 14, 0xffe2b4],
    [9.6, -0.6, 22, 0xffe6c4, 10], [13.4, 0.4, 22, 0xffe6c4, 10], [17.0, -1.6, 20, 0xffe0b8, 10]]) {
    const s = new THREE.SpotLight(c, i, d || 9, 0.95, 0.75, 1.6); s.position.set(x, 3.6, z); s.target.position.set(x, 0, z); G.scene.add(s); G.scene.add(s.target);
  }
  const pt = (c, i, d, x, y, z) => { const l = new THREE.PointLight(c, i, d, 2); l.position.set(x, y, z); G.scene.add(l); return l; };
  pt(0xcfe0ff, 9, 6, B0.minX - T - 1.4, 2.4, (door.z0 + door.z1) / 2); // corridor
  LV.stairLight = pt(0xffc98a, 10, 6, dz.cx, 2.6, sz0 - 1.4);           // stairwell
  // a fluorescent tube over the sink (it flickers now and then)
  box(1.3, 0.06, 0.12, M.dark, 0.95, 2.28, B0.minZ + 0.12); const tube = box(1.2, 0.035, 0.05, M.tube, 0.95, 2.245, B0.minZ + 0.14, { cast: false });
  LV.tube = { mesh: tube, light: pt(0xeaf2ff, 7, 4.5, 0.95, 2.0, B0.minZ + 0.5), t: 0 };
  // ceiling for the environment probe only
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(Wd + 1, Hd + 1), new THREE.MeshStandardMaterial({ color: 0x3a3936, roughness: 0.9 }));
  ceil.rotation.x = Math.PI / 2; ceil.position.set(CX, WALL_H, 0); ceil.layers.set(1); G.scene.add(ceil);

  buildProps(door, pt);
  buildHall(pt);
  flushBatch();
  G.camClamp = BS.cam; G.camZoom = 0.92;
}

function buildProps(door) {
  const dz = BS.doors;
  // ---- the cart in its bay ----
  const cart = prop('Cart', BS.cart[0], BS.cart[1], BS.cartYaw);
  addChair(cart.obj, { r: 0.62, heavy: true, noTip: true, mass: 2.2 });
  G.cart = cart.obj;

  // ---- west wall: shelving, the desk under the notice board, the fire cabinet, crates by the door ----
  for (const zc of [-4.45, -2.75]) shelving(B0.minX + 0.3, zc);
  const desk = onWall('MetalDesk', 'w', -0.6, { front: 'z', contact: 0.55, ch: 0.78 });
  G.surfaces.push(makeBox(desk.x, desk.z, desk.depth * 0.95, desk.width * 0.95, 0, 0, 0.76, { y: 0.765, desk: true }));
  onWall('BulletinBoard', 'w', -0.6, { front: 'z', y: 1.18, col: false, contact: 0 });
  deskLamp(B0.minX + 0.3, 0.05);
  { const c = prop('OfficeChair', -5.7, -0.85, -Math.PI / 2 + 0.35); addChair(c.obj); }
  BIN(-6.55, 0.55);
  onWall('FireBox', 'w', 1.45, { front: 'z', col: true, ch: 0.6, contact: 0.3 });
  prop2('Crates', B0.minX + 0.32, 4.6, Math.PI / 2, { contact: 0.55, ch: 0.9 });
  // ---- north wall: buckets in the corner, electrical boxes, lockers, the drinks fridge, sink + AC, boxes, the big cabinet ----
  prop2('Buckets', -5.95, -4.75, 0.4, { contact: 0.4, ch: 0.5 });
  { const p = prop2('Plunger', -5.35, -5.2, 0, { contact: 0.2, col: false }); p.obj.rotation.z = 0.18; }
  onWall('PanelBoxes', 'n', -4.25, { front: 'x', col: false, contact: 0 });
  collider(-4.25, B0.minZ + 0.1, 1.9, 0.2, 0, 0, 2.2);
  onWall('Locker', 'n', -2.3, { front: 'z', ch: 1.95 });
  const fridge = onWall('Fridge', 'n', -0.8, { front: '-z', ch: 2.0 });
  { const l = new THREE.PointLight(0xbfe2ff, 2.2, 2.6, 2); l.position.set(-0.8, 1.2, fridge.z + 0.6); G.scene.add(l); }
  onWall('Sink', 'n', 0.95, { front: 'z', ch: 1.0 });
  prop2('DrainCleaner', 0.3, B0.minZ + 0.2, 0.3, { y: 0.9, col: false, contact: 0 });
  prop2('DrainCleaner', 1.75, B0.minZ + 0.22, -0.4, { y: 0.9, col: false, contact: 0 });
  const ac = L.models.AirCon; // (skinned: placed once, not cloned, so its fan can spin)
  { const d = L.dims.AirCon[2]; ac.position.set(2.95, 1.98, B0.minZ + d / 2 + 0.03); G.scene.add(ac);
    const g = L.gltf.AirCon; if (g && g.animations.length) { LV.acMixer = new THREE.AnimationMixer(g.scene); LV.acMixer.clipAction(g.animations[0]).play(); } }
  prop2('Boxes', 2.95, B0.minZ + 0.6, 0.05, { contact: 0.5, ch: 0.85 });
  onWall('Cabinet', 'n', 5.2, { front: 'z', contact: 0.55, ch: 1.1 });
  prop2('MilkCrate', 6.3, -2.35, 0.1, { contact: 0.4 }); prop2('MilkCrate', 6.28, -2.33, -0.12, { y: 0.3, col: false, contact: 0 });
  prop2('Box', 6.25, -1.75, 0.15, { contact: 0.4 });

  // ---- front-right (kept low, so it never hides Karim from the camera): boxes and crates ----
  prop2('Boxes', 5.5, 4.75, Math.PI + 0.1, { contact: 0.5, ch: 0.85 });
  prop2('MilkCrate', 3.9, 5.05, 0.25, { contact: 0.4 }); prop2('MilkCrate', 3.95, 5.08, -0.1, { y: 0.3, col: false, contact: 0 });
  // ---- front-left: a big column with hazard stripes, folding chairs, the floor drain ----
  { const x = -2.75, z = 4.65;
    const lo = box(0.62, 1.1, 0.62, M.hazard, x, 0.55, z), hi = WB(0.6, WALL_H - 1.1, 0.6, x, 1.1 + (WALL_H - 1.1) / 2, z);
    L.occluders.push(lo, hi); collider(x, z, 0.66, 0.66); contactShadow(0.8, 0.8, 0.5, null, x, z); }
  prop2('FoldChairs', -0.6, 4.75, Math.PI + 0.2, { contact: 0.45, ch: 0.9 });
  prop2('Grate', 0.9, 3.3, 0.0, { y: -0.032, col: false, contact: 0 });
  prop2('Box', -4.9, 5.0, 0.4, { contact: 0.4 });
  prop2('WetSign', -1.8, 3.95, Math.PI / 4, { contact: 0.3, cw: 0.5, cd: 0.4, ch: 0.6 }); // (someone's been here before)

  // ---- pipes along the back walls of the work room ----
  pipeRun('x', B0.minX, RA.x1 - 0.25, 2.72, B0.minZ + 0.2, 0.07); pipeRun('x', B0.minX, RA.x1 - 0.25, 2.95, B0.minZ + 0.14, 0.045);
  pipeRun('z', B0.minZ, B0.maxZ, 2.85, B0.minX + 0.18, 0.06);
  for (const x of [-5.6, 3.95]) { scyl(M.pipe, 0.05, 0.05, 2.72, x, 1.36, B0.minZ + 0.2); scyl(M.pipe, 0.065, 0.065, 0.08, x, 0.3, B0.minZ + 0.2); }
  scyl(M.pipe, 0.04, 0.04, 1.8, 2.05, 1.85, B0.minZ + 0.14);
}

// ---- the staff hall: the bank's marble (gone dull), paintings, sconces, benches and plants; the fire doors up to the lobby ----
function buildHall(pt) {
  const dz = BS.doors, wz = B0.minZ;
  LV.door = fireDoor(dz.cx, wz, LV.doorCol); // (the fire doors to the stairs, with the exit sign over them)
  // paintings over the benches, sconces between them
  for (const [x, kind] of [[9.3, 0], [12.5, 1]]) {
    painting(x, 1.92, wz, 1.55, 1.02, kind);
    onWall('Bench', 'n', x, { front: 'z', contact: 0.5, ch: 0.5, gap: 0.08 });
  }
  for (const x of [7.75, 10.9, 14.2]) sconce(x, 2.05, wz, pt, x !== 7.75);
  painting(18.35, 1.75, wz, 0.72, 0.95, 2);
  // a brass plaque by the doors
  { const t = signTexture([['STAFF STAIRS', 54, 92, '#d9b46a'], ['LOBBY  ▲', 40, 170, '#cdb98e']], '#1d2024', '#d9b46a', 512, 256);
    box(0.62, 0.32, 0.03, M.brass, 15.05, 1.62, wz + 0.015, { cast: false });
    plane(0.58, 0.28, new THREE.MeshStandardMaterial({ map: t, roughness: 0.45, metalness: 0.2 }), 15.05, 1.62, wz + 0.032); }
  // plants in the corners and by the doors
  for (const [x, z] of [[7.95, wz + 0.5], [15.0, wz + 0.5], [18.45, wz + 0.5], [8.0, B0.maxZ - 0.5], [18.45, B0.maxZ - 0.5]]) {
    prop('PottedPlant', x, z, (sr() * 4 | 0) * Math.PI / 2); collider(x, z, 0.45, 0.45, 0, 0, 0.95);
  }
  // a bench along the front wall, facing in
  prop2('Bench', 13.2, B0.maxZ - L.dims.Bench[2] / 2 - 0.08, Math.PI, { contact: 0.5, ch: 0.5 });
}
// a framed oil painting on the wall (painted here: dunes at noon, an arcade in gold, a palm)
function painting(x, y, wz, w, h, kind) {
  const k = 300, W = w * k | 0, H = h * k | 0, c = makeCanvas(W, H), g = c.getContext('2d');
  if (kind === 0) { // dunes under the noon sun
    let gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#7fb3cf'); gr.addColorStop(0.55, '#e9d6ae'); gr.addColorStop(1, '#e9c58a'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(255,248,222,0.95)'; g.beginPath(); g.arc(W * 0.68, H * 0.2, H * 0.08, 0, 6.28); g.fill();
    const dune = (y0, amp, f, ph, c0, c1) => { const d = g.createLinearGradient(0, y0 - amp, 0, H); d.addColorStop(0, c0); d.addColorStop(1, c1); g.fillStyle = d; g.beginPath(); g.moveTo(0, H);
      for (let i = 0; i <= 60; i++) { const u = i / 60; g.lineTo(u * W, y0 + Math.sin(u * f + ph) * amp + Math.sin(u * f * 2.3 + ph * 1.7) * amp * 0.3); } g.lineTo(W, H); g.fill(); };
    dune(H * 0.52, H * 0.05, 5, 1, '#d9a35f', '#b9773d'); dune(H * 0.64, H * 0.07, 4, 2.5, '#e8b36c', '#c2803f'); dune(H * 0.8, H * 0.06, 3, 0.4, '#f0c47e', '#cf8d48');
    g.strokeStyle = 'rgba(120,70,30,0.35)'; g.lineWidth = 2; g.beginPath(); for (let i = 0; i <= 40; i++) { const u = i / 40; g.lineTo(u * W, H * 0.64 + Math.sin(u * 4 + 2.5) * H * 0.07 + 4); } g.stroke();
  } else if (kind === 1) { // an arcade of arches in gold leaf on deep teal
    g.fillStyle = '#163a40'; g.fillRect(0, 0, W, H);
    const n = 5, aw = W / (n + 0.6);
    for (let i = 0; i < n; i++) { const cx = aw * (0.8 + i), top = H * 0.26, bot = H * 0.84, r = aw * 0.36;
      g.strokeStyle = '#d6aa55'; g.lineWidth = 7; g.beginPath(); g.moveTo(cx - r, bot); g.lineTo(cx - r, top + r); g.quadraticCurveTo(cx - r, top - r * 0.2, cx, top - r * 0.75); g.quadraticCurveTo(cx + r, top - r * 0.2, cx + r, top + r); g.lineTo(cx + r, bot); g.stroke();
      g.fillStyle = 'rgba(214,170,85,0.16)'; g.fill(); }
    g.fillStyle = '#d6aa55'; g.fillRect(W * 0.08, H * 0.86, W * 0.84, 6);
  } else { // a date palm, loose and warm
    let gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#f1dcb2'); gr.addColorStop(1, '#d7b07a'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
    g.strokeStyle = '#6b4a2c'; g.lineWidth = 10; g.beginPath(); g.moveTo(W * 0.45, H); g.quadraticCurveTo(W * 0.55, H * 0.6, W * 0.52, H * 0.32); g.stroke();
    g.strokeStyle = '#3f6b3c'; g.lineWidth = 6; for (let i = 0; i < 9; i++) { const a = -Math.PI + i * Math.PI / 8 - 0.2, L0 = W * 0.42; g.beginPath(); g.moveTo(W * 0.52, H * 0.32); g.quadraticCurveTo(W * 0.52 + Math.cos(a) * L0 * 0.6, H * 0.32 + Math.sin(a) * L0 * 0.4 - 20, W * 0.52 + Math.cos(a) * L0, H * 0.32 + Math.sin(a) * L0 * 0.5 + 30); g.stroke(); }
  }
  noiseLayer(g, W, H, 120, 0.12, true); // canvas weave
  const tex = canvasTex(c, true);
  const fr = 0.07;
  box(w + fr * 2, h + fr * 2, 0.05, M.brass, x, y, wz + 0.025, { cast: false });
  box(w + 0.02, h + 0.02, 0.02, M.cap, x, y, wz + 0.055, { cast: false });
  plane(w, h, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }), x, y, wz + 0.067);
}
// a brass wall sconce with a frosted glass shade (and its warm light on the wall)
function sconce(x, y, wz, pt, light = true) {
  box(0.12, 0.26, 0.03, M.brass, x, y, wz + 0.015, { cast: false });
  scyl(M.brass, 0.012, 0.012, 0.14, x, y, wz + 0.09, 8, 0, Math.PI / 2);
  const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.055, 0.2, 16), new THREE.MeshStandardMaterial({ color: 0xfff3dc, emissive: 0xffd9a0, emissiveIntensity: 2.2, roughness: 0.4 }));
  glass.position.set(x, y + 0.08, wz + 0.17); G.scene.add(glass);
  if (light) pt(0xffc98a, 6, 4.2, x, y + 0.1, wz + 0.45);
}

function pipeRun(axis, a0, a1, y, w, r) {
  const len = a1 - a0, mid = (a0 + a1) / 2;
  if (axis === 'x') { scyl(M.pipe, r, r, len, mid, y, w, 12, Math.PI / 2); for (let a = a0 + 0.7; a < a1; a += 1.6) { scyl(M.pipe, r * 1.35, r * 1.35, 0.07, a, y, w, 12, Math.PI / 2); sbox(M.dark, 0.05, 0.05, w - B0.minZ, a, y + r + 0.02, (w + B0.minZ) / 2); } }
  else { scyl(M.pipe, r, r, len, w, y, mid, 12, 0, Math.PI / 2); for (let a = a0 + 0.7; a < a1; a += 1.6) { scyl(M.pipe, r * 1.35, r * 1.35, 0.07, w, y, a, 12, 0, Math.PI / 2); sbox(M.dark, w - B0.minX, 0.05, 0.05, (w + B0.minX) / 2, y + r + 0.02, a); } }
}

// grey steel shelving, loaded with boxes, jugs, toilet paper and bottles
function shelving(x0, zc) {
  const D = 0.55, Wz = 1.6, Ht = 2.0;
  const cx = B0.minX + D / 2 + 0.03;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) sbox(M.metal, 0.035, Ht, 0.035, cx + sx * (D / 2 - 0.02), Ht / 2, zc + sz * (Wz / 2 - 0.02));
  const levels = [0.1, 0.62, 1.14, 1.66];
  for (const y of levels) { sbox(M.metal, D, 0.025, Wz, cx, y, zc); sbox(M.dark, 0.03, 0.05, Wz, cx + D / 2 - 0.01, y - 0.01, zc); }
  collider(cx, zc, D + 0.05, Wz + 0.05, 0, 0, Ht);
  contactShadow(D + 0.1, Wz + 0.1, 0.5, null, cx, zc);
  for (const y of levels) {
    let z = zc - Wz / 2 + 0.06;
    while (z < zc + Wz / 2 - 0.2) {
      const kind = sr();
      if (kind < 0.34 && y < 1.5) { // a cardboard box (Yusuf's model)
        const s = 0.62 + sr() * 0.3, [bx, by, bz] = L.dims.Box, w = bx * s;
        if (z + w > zc + Wz / 2 - 0.04) break;
        const b = L.models.Box.clone(); b.scale.setScalar(s); b.rotation.y = Math.PI / 2 + (sr() - 0.5) * 0.15; b.position.set(cx - 0.02, y + 0.013, z + w / 2); G.scene.add(b);
        z += w + 0.04;
      } else if (kind < 0.62) { // jugs
        const mat = M.jugs[sr() * M.jugs.length | 0], n = 2 + (sr() * 2 | 0), r = 0.065 + sr() * 0.02, h = 0.24 + sr() * 0.08;
        for (let i = 0; i < n && z + r * 2 < zc + Wz / 2; i++) { scyl(mat, r, r, h, cx - 0.1 + (i % 2) * 0.12, y + 0.013 + h / 2, z + r, 12); scyl(M.jugs[3], 0.025, 0.025, 0.04, cx - 0.1 + (i % 2) * 0.12, y + h + 0.03, z + r * 0.6, 8); z += r * 2 + 0.02; }
        z += 0.05;
      } else if (kind < 0.85) { // a pack of toilet rolls
        for (let i = 0; i < 2; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 2; k++) scyl(M.tp, 0.055, 0.055, 0.11, cx - 0.12 + j * 0.115, y + 0.068 + k * 0.112, z + 0.06 + i * 0.115, 12);
        z += 0.27;
      } else { // spray bottles
        for (let i = 0; i < 3; i++) { const mat = pick(M.jugs); scyl(mat, 0.035, 0.04, 0.2, cx + 0.1 - i * 0.08, y + 0.113, z + 0.05, 10); sbox(M.dark, 0.03, 0.06, 0.07, cx + 0.1 - i * 0.08, y + 0.25, z + 0.05); }
        z += 0.14;
      }
    }
  }
}

function deskLamp(x, z) {
  const y = 0.765, green = new THREE.MeshStandardMaterial({ color: 0x1f5c3c, roughness: 0.35, metalness: 0.5, side: THREE.DoubleSide });
  scyl(M.dark, 0.07, 0.08, 0.025, x, y + 0.013, z, 16);         // base
  scyl(M.metal, 0.01, 0.01, 0.36, x, y + 0.2, z, 8);            // post
  const arm = new THREE.CylinderGeometry(0.009, 0.009, 0.2, 8); arm.rotateZ(Math.PI / 2); arm.translate(x + 0.1, y + 0.37, z); addGeo(M.metal, arm);
  const shade = new THREE.CylinderGeometry(0.075, 0.075, 0.28, 16, 1, true, Math.PI / 2, Math.PI); shade.rotateX(Math.PI / 2); shade.translate(x + 0.2, y + 0.36, z); addGeo(green, shade);
  const bulb = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.22, 8), new THREE.MeshBasicMaterial({ color: 0xfff1cc, toneMapped: false }));
  bulb.rotation.x = Math.PI / 2; bulb.position.set(x + 0.2, y + 0.33, z); G.scene.add(bulb);
  const l = new THREE.PointLight(0xffc27a, 4, 3.5, 2); l.position.set(x + 0.25, y + 0.25, z); G.scene.add(l);
  scyl(M.white, 0.04, 0.038, 0.09, x + 0.2, y + 0.045, z + 0.45, 12); // a mug
}

// ---------------- the mess Karim walks in on ----------------
export function seedBasementMess() {
  // muddy boots in from the corridor (the mop's job)
  trail([[-7.4, 3.05], [-6.0, 2.85], [-4.6, 2.55], [-3.1, 2.05]], 0.95);
  trail([[-7.4, 2.75], [-5.8, 3.25], [-4.2, 3.35], [-2.8, 3.0]], 0.8);
  dirtBlob(-6.55, 3.0, 0.42, '74,56,38', 0.75, 1.4); dirtBlob(-5.3, 3.25, 0.3, '74,56,38', 0.55, 1.4);
  addDecal('muddy', -6.1, 3.15, 0.85, Math.PI / 2, 1); addDecal('muddy', -4.9, 2.55, 0.8, Math.PI / 2 + 0.3, 0.9);
  addDecal('smear', -3.9, 3.0, 1.2, 0.5, 0.95); addDecal('heel', -3.4, 2.4, 0.6, 1.2, 0.9);
  // paper everywhere by the desk, a smashed bottle by the shelves, grit (the vacuum's job)
  const sc = BS.spill.c;
  for (let i = 0; i < 18; i++) { const a = rand(0, 6.28), r = Math.sqrt(Math.random()) * 1.25; spawnPaper(sc.x + Math.cos(a) * r * 1.1, 0, sc.z + Math.sin(a) * r, 0, 0, 0, { rest: true, money: false }); }
  for (let i = 0; i < 4; i++) spawnPaper(-6.6 + rand(-0.05, 0.05), 0.77, -0.95 + rand(-0.05, 0.05), 0, 0, 0, { rest: true, neat: true, stack: i, yaw: Math.PI / 2 + rand(-0.05, 0.05), variant: 1 });
  for (let i = 0; i < 16; i++) spawnShard(-5.55 + rand(-0.4, 0.4), 0.05, -2.55 + rand(-0.45, 0.45), rand(-0.3, 0.3), 0, rand(-0.3, 0.3), rand(0.05, 0.13));
  addDecal('grit', -4.4, -1.6, 1.1, 0.3, 1); addDecal('grit', -5.4, -2.2, 0.9, 1.4, 0.9); addDecal('dust', -3.9, -0.2, 1.0, 0.8, 0.9);
  FX.dirtDirty = true;
  // the hall's marble: worn dull along the path everyone takes from the work room to the stairs, and in front of the benches
  paintDull([[7.3, 0.5, 10.5, 0.2, 0.75, 1], [10.5, 0.2, 13.6, -0.3, 0.75, 1], [13.6, -0.3, 15.8, -2.0, 0.72, 1], [15.8, -2.0, 16.6, -4.9, 0.7, 1]],
    [[9.3, -4.0, 1.1, 0.95], [12.5, -4.0, 1.0, 0.9], [16.6, -4.6, 1.0, 0.9]], 0.26, 0.42);
}
// the polish lesson is done: the rest of the dull buffs away in a shimmer, so the hall ends up gleaming
export function shineHall() {
  if (LV.shine) return; LV.shine = 1.4; SFX.play('ding');
  floatText('GLEAMING!', G.player.pos.clone().setY(2.3), 'onoma', 1.1);
}
export function hallDull() { return roughIn(BS.hall, 0.2); } // (m^2 of marble that still looks dull)

// how much is left of a kind of mess in a rectangle (dirt layer + decals), in arbitrary units
export function messIn(r, kind = 0) {
  let sum = 0;
  if (kind === 0) {
    const PXM = 40, c = FX.dirtCtx, x0 = (r.x0 - B0.minX) * PXM | 0, y0 = (r.z0 - B0.minZ) * PXM | 0, w = (r.x1 - r.x0) * PXM | 0, h = (r.z1 - r.z0) * PXM | 0;
    const d = c.getImageData(Math.max(0, x0), Math.max(0, y0), w, h).data; for (let i = 3; i < d.length; i += 16) sum += d[i] / 255;
    sum /= 400;
  }
  decalDirt(); // (refreshes each decal's remaining amount)
  for (const dd of DECALS.list) if (dd.kind === kind && dd.x > r.x0 && dd.x < r.x1 && dd.z > r.z0 && dd.z < r.z1) sum += dd.rem * dd.sx * dd.sz * dd.op;
  return sum;
}
export function litterIn() { return litterCount(); }

// ---------------- the fire doors and other small life ----------------
export function openFireDoors() { LV.door && LV.door.open(); }
export function closeFireDoors() { LV.door && LV.door.close(); }
export function fireDoorsOpen() { return !!LV.door && LV.door.amt > 0.85; }
export function inStairwell(p) { return p.z < B0.minZ - 0.35 && p.x > BS.doors.x0 && p.x < BS.doors.x1; }
export function updateBasement(dt) {
  if (LV.acMixer) LV.acMixer.update(dt);
  if (LV.shine > 0) {
    LV.shine -= dt; fadeDull(BS.hall, dt * 2.2);
    for (let i = 0; i < 3; i++) if (Math.random() < dt * 30) spark(rand(BS.hall.x0 + 0.5, BS.hall.x1 - 0.5), 0.04, rand(-4.6, 4.6), 1, 0xfff2cc, 0.6, 0.5, 0.07);
  }
  if (LV.door) LV.door.update(dt);
  if (LV.tube) { // a tired fluorescent tube
    const t = LV.tube; t.t -= dt;
    if (t.t <= 0) {
      if (t.on === false) { t.on = true; t.t = Math.random() < 0.4 ? rand(0.05, 0.15) : rand(2, 7); } // (sometimes a double blink)
      else if (Math.random() < 0.6) { t.on = false; t.t = rand(0.04, 0.12); } else t.t = rand(0.6, 3);
    }
    const on = t.on !== false; t.light.intensity = on ? 7 : 1.2; t.mesh.material.emissiveIntensity = on ? 2.4 : 0.3;
  }
}
