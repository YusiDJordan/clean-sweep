// Effects: floor dirt layer, paper sheets, glass shards, sparks/droplets, tracers, swing trails, floating text
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { G, rand, makeCanvas, clamp, pointInBox } from './state.js';
import { paperAtlas, glowTex } from './textures.js';
import { wipeDecals, decalsToClean, decalDirt, updateDecals, seedDecals, polishAt, dullToPolish, roughLeft, GLOW, GOLD_GLSL } from './decals.js';

export const FX = { dirtCanvas: null, dirtCtx: null, dirtTex: null, dirtDirty: false, cleanPct: 0 };

const B = () => G.bounds;
const PXM = 40; // dirt pixels per metre (crisp enough for boot prints)

// ================= DIRT =================
export function initDirt() {
  const b = B();
  const w = (b.maxX - b.minX) * PXM, h = (b.maxZ - b.minZ) * PXM;
  const c = makeCanvas(w, h);
  FX.dirtCanvas = c; FX.dirtCtx = c.getContext('2d', { willReadFrequently: true });
  FX.dirtTex = new THREE.CanvasTexture(c);
  FX.dirtTex.colorSpace = THREE.SRGBColorSpace;
  FX.dirtTex.flipY = false; // canvas row 0 == minZ
  FX.dirtTex.anisotropy = 8; // the floor is seen at a grazing angle: keep prints sharp
  // wet layer: blood pools (crisp edged, glossy in the floor shader)
  const wc = makeCanvas(4, 4); // (blood is now drawn as decals; this layer stays empty)
  FX.wetCanvas = wc; FX.wetCtx = wc.getContext('2d', { willReadFrequently: true });
  FX.wetTex = new THREE.CanvasTexture(wc); FX.wetTex.colorSpace = THREE.SRGBColorSpace; FX.wetTex.flipY = false;
  FX.small = makeCanvas(w / 8, h / 8); FX.smallCtx = FX.small.getContext('2d', { willReadFrequently: true });
}
const toPx = (x, z) => [(x - B().minX) * PXM, (z - B().minZ) * PXM];

export function dirtBlob(x, z, r, color = '92,70,48', alpha = 0.7, irregular = 1) {
  const ctx = FX.dirtCtx; const [px, py] = toPx(x, z);
  for (let i = 0; i < 4 + irregular * 4; i++) {
    const ox = (Math.random() - 0.5) * r * PXM * irregular, oy = (Math.random() - 0.5) * r * PXM * irregular;
    const rr = r * PXM * (0.35 + Math.random() * 0.6);
    const g = ctx.createRadialGradient(px + ox, py + oy, 0, px + ox, py + oy, rr);
    g.addColorStop(0, `rgba(${color},${alpha})`); g.addColorStop(0.6, `rgba(${color},${alpha * 0.6})`); g.addColorStop(1, `rgba(${color},0)`);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px + ox, py + oy, rr, 0, Math.PI * 2); ctx.fill();
  }
  FX.dirtDirty = true;
}
// a boot print (heel + sole with tread gaps), drawn in metres
export function footprint(x, z, yaw, left, alpha = 0.55, col = '46,36,28') {
  const ctx = FX.dirtCtx; const [px, py] = toPx(x, z);
  ctx.save(); ctx.translate(px, py); ctx.scale(PXM, PXM); ctx.rotate(-yaw);
  ctx.translate(left ? 0.1 : -0.1, 0);
  if (!left) ctx.scale(-1, 1);
  ctx.fillStyle = `rgba(${col},${alpha})`;
  // sole (toe towards +y), slightly turned out
  ctx.rotate(0.06);
  ctx.beginPath(); ctx.ellipse(0.004, 0.075, 0.052, 0.085, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(-0.006, 0.0, 0.04, 0.05, 0, 0, Math.PI * 2); ctx.fill();
  // heel, with a gap before it
  ctx.beginPath(); ctx.ellipse(-0.008, -0.105, 0.042, 0.045, 0, 0, Math.PI * 2); ctx.fill();
  // tread: knock thin gaps out of the print so it reads as a boot, not a blob
  ctx.globalCompositeOperation = 'destination-out'; ctx.fillStyle = `rgba(0,0,0,${0.55})`;
  for (let k = -0.04; k < 0.17; k += 0.034) ctx.fillRect(-0.06, k, 0.12, 0.012);
  ctx.fillRect(-0.06, -0.068, 0.12, 0.012);
  ctx.restore(); FX.dirtDirty = true;
}
// a black rubber scuff (heel drag)
export function scuff(x, z, len, ang, alpha = 0.5) {
  const ctx = FX.dirtCtx; const [px, py] = toPx(x, z);
  ctx.save(); ctx.translate(px, py); ctx.scale(PXM, PXM); ctx.rotate(ang);
  ctx.strokeStyle = `rgba(24,22,22,${alpha})`; ctx.lineCap = 'round';
  for (let i = 0; i < 3; i++) { ctx.lineWidth = 0.012 + Math.random() * 0.012; ctx.beginPath(); ctx.moveTo(-len / 2, (i - 1) * 0.01); ctx.quadraticCurveTo(0, (Math.random() - 0.5) * len * 0.4, len / 2, (i - 1) * 0.012); ctx.stroke(); }
  ctx.restore(); FX.dirtDirty = true;
}
export function trail(points, alpha) {
  // muddy boot trail along a polyline
  let left = false;
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, z0] = points[i], [x1, z1] = points[i + 1];
    const len = Math.hypot(x1 - x0, z1 - z0), yaw = Math.atan2(x1 - x0, z1 - z0);
    for (let d = 0; d < len; d += 0.42) {
      const t = d / len; left = !left;
      const a = alpha * (0.7 + Math.random() * 0.3) * (1 - 0.5 * (i + t) / points.length);
      footprint(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, yaw + (Math.random() - 0.5) * 0.12, left, a);
    }
  }
}
// is there anything for the mop to clean around (x, z)? dirt on the floor, blood, or litter
export function somethingToClean(x, z, r, tool = 'mop') {
  if (tool === 'polisher') return dullToPolish(x, z, r) || decalsToClean(x, z, r, 2);
  if (tool === 'vacuum') {
    for (const p of papers) if (p.rest && !p.neat && p.floorY < 0.1 && Math.hypot(p.x - x, p.z - z) < LITTER_R) return true;
    for (const s of shards) if (s.active && s.rest && Math.hypot(s.x - x, s.z - z) < GLASS_R) return true;
    for (const l of leaves) if (Math.hypot(l.x - x, l.z - z) < LITTER_R) return true;
    return decalsToClean(x, z, r, 1);
  }
  const ctx = FX.dirtCtx, [px, py] = toPx(x, z), R = Math.max(2, r * PXM | 0);
  const x0 = Math.max(0, px - R | 0), y0 = Math.max(0, py - R | 0), w = Math.min(FX.dirtCanvas.width - x0, 2 * R), h = Math.min(FX.dirtCanvas.height - y0, 2 * R);
  if (w > 0 && h > 0) { const d = ctx.getImageData(x0, y0, w, h).data; let n = 0; for (let i = 3; i < d.length; i += 16) if (d[i] > 20) n++; if (n > d.length / 16 * 0.02) return true; }
  for (const p of pools) if (p.amount > 0.05 && Math.hypot(p.x - x, p.z - z) < r + p.r) return true;
  if (decalsToClean(x, z, r, 0) || dullToPolish(x, z, r)) return true;
  return false;
}
// the polisher and the vacuum (the mop is cleanAt)
export function polishFloor(x, z, r, strength) { polishAt(x, z, r, strength); }
// light litter (paper, banknotes, glass) is caught from much further than the grime: it slides in slowly from
// the edge of the draught, then faster and faster, lifting off the floor as it whips into the nozzle
const LITTER_R = 3.8, GLASS_R = 3.4;
export const SUCKED = { paper: 0, glass: 0, leaf: 0 }; // (what the last vacuumAt swallowed: for the sounds)
export function vacuumAt(x, z, r, dt) {
  FX.vacT = G.time; SUCKED.paper = SUCKED.glass = SUCKED.leaf = 0;
  wipeDecals(x, z, r * 0.6, Math.min(1, dt * 9), 1); // grit, soil, dust
  let n = 0;
  const pull = (o, R, rest) => {
    const dx = x - o.x, dz = z - o.z, d = Math.hypot(dx, dz); if (d > R) { o.suck = 0; return false; }
    if (d < 0.28) return true;
    const c = 1 - d / R, v = 0.9 + 11 * Math.pow(c, 2.5); // the closer, the faster
    const step = Math.min(d, v * dt); o.x += dx / d * step; o.z += dz / d * step;
    o.suck = Math.max(0, 1 - d / 1.4); // lift within the last 1.4 m
    return false;
  };
  for (let i = papers.length - 1; i >= 0; i--) {
    const p = papers[i]; if (p.neat || (p.rest && p.floorY > 0.1)) continue;
    if (pull(p, LITTER_R)) { papers.splice(i, 1); G.stats.papers++; n++; SUCKED.paper++; continue; }
    if (p.rest && p.suck > 0) { // flutter up off the floor on the way in
      const k = p.suck * p.suck; p.ph += dt * 18;
      p.y = p.floorY + 0.004 + 0.24 * k + Math.sin(p.ph) * 0.02 * k;
      p.pitch = Math.sin(p.ph * 1.3) * 0.7 * k; p.roll = Math.cos(p.ph) * 0.8 * k;
    }
  }
  for (let i = leaves.length - 1; i >= 0; i--) {
    const l = leaves[i];
    if (pull(l, LITTER_R)) { // (swap-remove keeps each leaf's colour with it)
      const last = leaves.length - 1;
      if (i !== last) { leaves[i] = leaves[last]; leafMesh.getColorAt(last, _lc); leafMesh.setColorAt(i, _lc); leafMesh.instanceColor.needsUpdate = true; }
      leaves.pop(); n++; SUCKED.leaf++; continue;
    }
    if (l.suck > 0) { l.ph = (l.ph || 0) + dt * 20; l.y = 0.006 + 0.22 * l.suck * l.suck; }
  }
  for (const s of shards) {
    if (!s.active) continue;
    if (pull(s, GLASS_R)) { s.active = false; G.stats.shards++; n++; SUCKED.glass++; continue; }
    if (s.rest && s.suck > 0) s.y = (s.fy || 0) + 0.005 + 0.14 * s.suck * s.suck;
  }
  return n;
}
export function cleanAt(x, z, r, strength = 0.35) {
  for (const [ctx, sc] of [[FX.dirtCtx, 1]]) {
    const px = (x - B().minX) * PXM * sc, py = (z - B().minZ) * PXM * sc, rr = r * PXM * sc;
    // nothing there? then don't touch the layer (re-sending the whole floor texture to the GPU for a clean patch
    // of floor was what made mopping choppy)
    const x0 = Math.max(0, px - rr | 0), y0 = Math.max(0, py - rr | 0), w = Math.min(FX.dirtCanvas.width - x0, Math.ceil(2 * rr)), h = Math.min(FX.dirtCanvas.height - y0, Math.ceil(2 * rr));
    if (w <= 0 || h <= 0) continue;
    { const d = ctx.getImageData(x0, y0, w, h).data; let any = false; for (let i = 3; i < d.length; i += 12) if (d[i] > 2) { any = true; break; } if (!any) continue; }
    ctx.save(); ctx.globalCompositeOperation = 'destination-out';
    const g = ctx.createRadialGradient(px, py, 0, px, py, rr);
    g.addColorStop(0, `rgba(0,0,0,${strength})`); g.addColorStop(0.7, `rgba(0,0,0,${strength * 0.7})`); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, py, rr, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    FX.dirtDirty = true;
  }
  wipeDecals(x, z, r, strength, 0); // the mop's kind of grime decals (smears, scuffs, prints...)
  // wipe blood the same way: the mop erases it from each pool's mask where it passes (no shrinking)
  for (const p of pools) {
    const sc = p.mesh.scale.x; if (sc < 0.02) continue;
    const dx = x - p.x, dz = z - p.z; if (Math.hypot(dx, dz) > r + p.R * sc) continue;
    const th = p.mesh.rotation.y, c = Math.cos(th), sn = Math.sin(th);
    const lx = (dx * c - dz * sn) / sc, ly = -(dx * sn + dz * c) / sc; // into the pool's own (shape) space
    const S = p.S, px = (lx / (2 * p.R) + 0.5) * S, py = (0.5 - ly / (2 * p.R)) * S, rr = r / sc / (2 * p.R) * S;
    const ctx = p.ctx, g = ctx.createRadialGradient(px, py, 0, px, py, rr);
    const a = Math.min(1, strength * 0.85);
    g.addColorStop(0, `rgba(0,0,0,${a})`); g.addColorStop(0.7, `rgba(0,0,0,${a * 0.7})`); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, py, rr, 0, Math.PI * 2); ctx.fill();
    p.tex.needsUpdate = true; p.wiped = true;
  }
}

// ---------- blood pools: smooth glossy decals (resolution independent) that grow, then can be mopped away ----------
const pools = [];
let bloodMat = null;
function poolGeometry(r) {
  const n = 14, ctrl = [];
  const a0 = Math.random() * 6.28;
  for (let i = 0; i < n; i++) {
    const a = a0 + (i / n) * Math.PI * 2, rr = r * (0.72 + Math.random() * 0.36 + (i % 4 === 0 ? 0.22 : 0));
    ctrl.push(new THREE.Vector3(Math.cos(a) * rr, Math.sin(a) * rr, 0));
  }
  const curve = new THREE.CatmullRomCurve3(ctrl, true, 'centripetal');
  const outline = curve.getPoints(72).map(p => new THREE.Vector2(p.x, p.y));
  const geos = [new THREE.ShapeGeometry(new THREE.Shape(outline), 1)];
  const sats = [], nS = 2 + (Math.random() * 4 | 0);
  for (let i = 0; i < nS; i++) {
    const a = Math.random() * 6.28, d = r * (1.12 + Math.random() * 0.45), s = r * (0.05 + Math.random() * 0.09);
    sats.push([Math.cos(a) * d, Math.sin(a) * d, s]);
    geos.push(new THREE.CircleGeometry(s, 20).translate(Math.cos(a) * d, Math.sin(a) * d, 0));
  }
  for (const g of geos) { g.deleteAttribute('uv'); }
  const geo = mergeGeometries(geos);
  // UVs over a square of half-size R, for the wipe mask
  const R = r * 1.75, pos = geo.attributes.position, uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) { uv[i * 2] = pos.getX(i) / (2 * R) + 0.5; uv[i * 2 + 1] = pos.getY(i) / (2 * R) + 0.5; }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.rotateX(-Math.PI / 2);
  return { geo, outline, sats, R };
}
// wipe mask: white where there's blood; the mop paints it black (alphaMap reads the green channel)
function poolMask(shape) {
  const R = shape.R, S = Math.min(256, Math.max(32, 2 ** Math.ceil(Math.log2(R * 2 * 110))));
  const c = makeCanvas(S, S), ctx = c.getContext('2d', { willReadFrequently: true });
  const toC = (x, y) => [(x / (2 * R) + 0.5) * S, (0.5 - y / (2 * R)) * S];
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, S, S);
  ctx.fillStyle = '#fff'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.lineJoin = 'round';
  ctx.beginPath(); shape.outline.forEach((p, i) => { const [u, v] = toC(p.x, p.y); i ? ctx.lineTo(u, v) : ctx.moveTo(u, v); }); ctx.closePath(); ctx.fill(); ctx.stroke();
  for (const [x, y, s] of shape.sats) { const [u, v] = toC(x, y); ctx.beginPath(); ctx.arc(u, v, s / (2 * R) * S + 1.5, 0, Math.PI * 2); ctx.fill(); }
  const tex = new THREE.CanvasTexture(c);
  return { S, ctx, tex, full: maskSum(ctx, S) };
}
function maskSum(ctx, S) { const d = ctx.getImageData(0, 0, S, S).data; let t = 0; for (let i = 1; i < d.length; i += 4) t += d[i]; return t; }
function dropPool(p) { G.scene.remove(p.mesh); p.mesh.geometry.dispose(); p.mesh.material.dispose(); p.tex.dispose(); }
export function bloodPool(x, z, r, grow = 1.4) {
  if (!bloodMat) bloodMat = new THREE.MeshPhysicalMaterial({
    color: 0x3a0306, roughness: 0.16, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.7,
    transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  if (pools.length > 140) { const old = pools.findIndex(p => p.r < 0.15); dropPool(pools.splice(old >= 0 ? old : 0, 1)[0]); }
  const shape = poolGeometry(r), mask = poolMask(shape);
  const mat = bloodMat.clone(); mat.alphaMap = mask.tex; mat.alphaTest = 0.05; // wiped-off residue vanishes instead of leaving a pale film
  const mesh = new THREE.Mesh(shape.geo, mat);
  mesh.position.set(x, 0.004 + Math.random() * 0.002, z); mesh.rotation.y = Math.random() * 6.28;
  mesh.scale.setScalar(0.01); mesh.receiveShadow = true; mesh.renderOrder = 1;
  mesh.userData.noAO = true; mesh.userData.noReflect = true; mesh.userData.noProbe = true;
  G.scene.add(mesh);
  pools.push({ mesh, x, z, r, R: shape.R, t: 0, grow, amount: 1, ...mask, measT: 0 });
}
export function bloodDrip(x, z, n = 4, spread = 0.5) {
  for (let i = 0; i < n; i++) bloodPool(x + (Math.random() - 0.5) * spread, z + (Math.random() - 0.5) * spread, 0.03 + Math.random() * 0.06, 0.15);
}
function updatePools(dt) {
  for (let i = pools.length - 1; i >= 0; i--) {
    const p = pools[i];
    p.measT -= dt;
    if (p.wiped && p.measT <= 0) { p.wiped = false; p.measT = 0.25; p.amount = maskSum(p.ctx, p.S) / p.full; }
    if (p.amount <= 0.03) { dropPool(p); pools.splice(i, 1); continue; }
    p.t += dt; const k = Math.min(1, p.t / p.grow), e = 1 - Math.pow(1 - k, 2.2);
    p.mesh.scale.setScalar(Math.max(0.01, e));
  }
}
export function bloodArea() { let a = 0; for (const p of pools) a += Math.PI * p.r * p.r * 0.8 * p.amount * Math.min(1, p.t / p.grow); return a; }
let measureT = 0, baseDirt = 1;
export function measureDirt(force) {
  const s = FX.smallCtx, c = FX.small;
  s.clearRect(0, 0, c.width, c.height);
  s.drawImage(FX.dirtCanvas, 0, 0, c.width, c.height);
  const d = s.getImageData(0, 0, c.width, c.height).data;
  let sum = 0;
  for (let i = 3; i < d.length; i += 4) sum += d[i] > 18 ? d[i] : 0;
  const B0 = G.bounds, area = (B0.maxX - B0.minX) * (B0.maxZ - B0.minZ);
  return sum / (c.width * c.height * 255) + 1.1 * bloodArea() / area + 1.3 * decalDirt() + 0.12 * roughLeft(); // blood, grime decals and dull floor count too
}
export function setDirtBaseline() { baseDirt = Math.max(0.001, measureDirt()); FX.base = baseDirt; FX.dirtLevel = baseDirt; }
export function dirtAmount() { return measureDirt(); }
export function updateDirt(dt) {
  updatePools(dt); updateDecals(dt);
  FX.upT = (FX.upT || 0) - dt;
  if (FX.dirtDirty && FX.upT <= 0) { FX.dirtTex.needsUpdate = true; FX.dirtDirty = false; FX.upT = 0.045; }
  if (FX.wetDirty) { FX.wetTex.needsUpdate = true; FX.wetDirty = false; }
  measureT -= dt;
  if (measureT <= 0) { measureT = 0.4; FX.dirtLevel = measureDirt(); }
}
export function seedDirt() {
  // robbers' muddy boots from the entrance to the vault and the office...
  const trails = [
    [[-17.5, 8.6], [-12, 7], [-6, 4.5], [0, 0], [5, -5], [9.6, -10.6]],
    [[-17.5, 9.4], [-11, 8.5], [-5, 6.0], [1, 1.5], [6.5, -4.5], [10.4, -10.4]],
    [[-17.5, 9.0], [-13, 4.8], [-10.5, -3.5], [-10.5, -6], [-14, -9]],
    [[-1, 0.5], [-1.5, -5], [-1.6, -11.5]],
    [[5, -4], [11, -6.8], [14.6, -8.6]],
  ];
  trails.forEach((t, i) => { if (i !== 1) trail(t, 0.85); }); // (the second, parallel trail is left off: a third less to mop)
  // ...and everyday grime as proper decals: smears, heel marks, scratches, grit, cart tracks, gum, dust
  seedDecals(trails);
  FX.dirtDirty = true;
}

// ================= INSTANCED POOLS =================
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _lc = new THREE.Color();

// ---- PAPER ----
const MAXP = 900;
export const papers = [];
let paperMesh;
// litter, leaves and broken glass light up gold while Karim has the vacuum (red with the other tools)
function vacuumGlow(sh) {
  Object.assign(sh.uniforms, GLOW);
  sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vGW;')
    .replace('#include <project_vertex>', '#include <project_vertex>\nvGW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xz;');
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec4 uClean; uniform float uTime; uniform float uTool; varying vec2 vGW;' + GOLD_GLSL)
    .replace('#include <opaque_fragment>', 'float vac = uTool > 0.5 && uTool < 1.5 ? 1.0 : 0.0;\noutgoingLight = cleanGlow(outgoingLight, vGW, uClean, uTime, vac);\noutgoingLight = wrongGlow(outgoingLight, vGW, uClean, uTime, 1.0 - vac);\n#include <opaque_fragment>');
}
export function initPapers() {
  const geo = new THREE.PlaneGeometry(0.21, 0.297);
  geo.rotateX(-Math.PI / 2);
  const variant = new Float32Array(MAXP);
  geo.setAttribute('aVar', new THREE.InstancedBufferAttribute(variant, 1));
  const mat = new THREE.MeshStandardMaterial({ map: paperAtlas(), roughness: 0.75, side: THREE.DoubleSide, envMapIntensity: 0.5 });
  mat.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aVar;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\nvMapUv.x=(vMapUv.x+aVar)*0.25;\n#endif');
    vacuumGlow(sh);
  };
  paperMesh = new THREE.InstancedMesh(geo, mat, MAXP);
  paperMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  paperMesh.castShadow = true; paperMesh.receiveShadow = true; paperMesh.frustumCulled = false;
  paperMesh.userData.noAO = true;
  paperMesh.count = 0;
  G.scene.add(paperMesh);
}
function surfaceHeight(x, z) {
  let h = 0, s = null;
  for (const b of G.surfaces) if (pointInBox(b, x, z) && b.y > h) { h = b.y; s = b; }
  return h;
}
export function spawnPaper(x, y, z, vx, vy, vz, opts = {}) {
  if (papers.length >= MAXP) { // recycle the oldest resting one
    const i = papers.findIndex(p => p.rest);
    if (i < 0) return; papers.splice(i, 1);
  }
  const money = opts.money ?? Math.random() < 0.12;
  const p = {
    x, y, z, vx, vy, vz, yaw: opts.yaw ?? rand(0, 6.28), pitch: rand(-1, 1), roll: rand(-1, 1), neat: !!opts.neat,
    wy: rand(-6, 6), wp: rand(-8, 8), wr: rand(-8, 8), ph: rand(0, 6), rest: opts.rest || false,
    floorY: 0, var: opts.variant ?? (money ? 3 : Math.floor(Math.random() * 3)), scale: 1, sx: money ? 0.4 : 1, sz: money ? 0.66 : 1, life: 0, // bills: real banknote proportions
  };
  if (p.rest) { p.floorY = surfaceHeight(x, z); p.y = p.floorY + 0.004 + (opts.stack !== undefined ? opts.stack * 0.0028 : Math.random() * 0.006); p.pitch = p.roll = 0; }
  papers.push(p);
  return p;
}
// knock resting papers (e.g. neat stacks on a desk) into the air
export function wakePapers(x, y, z, r, force = 2.5, dirx = 0, dirz = 0) {
  for (const p of papers) {
    if (!p.rest || Math.abs(p.y - y) > 0.6) continue;
    const dx = p.x - x, dz = p.z - z, d = Math.hypot(dx, dz);
    if (d > r) continue;
    const k = force * (1 - d / r * 0.6) * rand(0.5, 1);
    p.rest = false; p.neat = false;
    p.vx = (dx / (d + 0.05)) * k * 0.6 + dirx * k + rand(-0.5, 0.5); p.vz = (dz / (d + 0.05)) * k * 0.6 + dirz * k + rand(-0.5, 0.5); p.vy = rand(1.2, 3) * (force / 2.5);
    p.wy = rand(-6, 6);
  }
}
export function paperBurst(x, y, z, n, dirx = 0, dirz = 0, force = 2.5) {
  wakePapers(x, y, z, 0.7, force, dirx * 0.5, dirz * 0.5);
  for (let i = 0; i < n; i++) {
    const a = rand(0, Math.PI * 2), s = rand(0.3, 1) * force;
    spawnPaper(x + rand(-0.2, 0.2), y + rand(0, 0.3), z + rand(-0.2, 0.2), Math.cos(a) * s + dirx * force, rand(1.5, 3.5) * (force / 2.5), Math.sin(a) * s + dirz * force);
  }
}
// wind/kick from characters moving through resting papers
export function disturbPapers(x, z, r, strength) {
  for (const p of papers) {
    const dx = p.x - x, dz = p.z - z, d2 = dx * dx + dz * dz;
    if (d2 < r * r && p.y < 0.2) {
      const d = Math.sqrt(d2) + 0.05, k = strength * (1 - d / r);
      if (k <= 0.2) continue;
      p.rest = false; p.neat = false; p.vx += dx / d * k; p.vz += dz / d * k; p.vy += k * 0.6; p.wy += rand(-4, 4);
    }
  }
}
// Mop collection: pull papers & shards in a radius toward a point, then collect
export function collectAt(x, z, r) {
  let n = 0;
  for (let i = papers.length - 1; i >= 0; i--) {
    const p = papers[i]; if (!p.rest || p.floorY > 0.1 || p.neat) continue;
    const dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz);
    if (d < r) {
      if (d < 0.35) { papers.splice(i, 1); G.stats.papers++; n++; }
      else { p.x += dx / d * 0.05; p.z += dz / d * 0.05; }
    }
  }
  for (const s of shards) {
    if (!s.active || !s.rest) continue;
    const dx = x - s.x, dz = z - s.z, d = Math.hypot(dx, dz);
    if (d < r) {
      if (d < 0.35) { s.active = false; G.stats.shards++; n++; }
      else { s.x += dx / d * 0.06; s.z += dz / d * 0.06; }
    }
  }
  return n;
}
export function litterCount() {
  let n = 0; for (const p of papers) if (p.floorY < 0.1 && !p.neat) n++;
  for (const s of shards) if (s.active) n++;
  return n;
}
function updatePapers(dt) {
  let k = 0;
  const vacOff = !(G.time - (FX.vacT ?? -9) < 0.1);
  for (const p of papers) {
    if (vacOff && p.suck) { p.suck = 0; if (p.rest) { p.y = p.floorY + 0.004; p.pitch = p.roll = 0; } } // vacuum off: drop back down
    if (!p.rest) {
      p.life += dt;
      p.vy -= 6.0 * dt;
      // flutter + strong drag
      const drag = Math.exp(-1.8 * dt);
      p.vx *= drag; p.vz *= drag;
      if (p.vy < -1.3) p.vy += (-1.3 - p.vy) * (1 - Math.exp(-6 * dt));
      p.ph += dt * 7;
      p.x += (p.vx + Math.sin(p.ph) * 0.9 * (p.vy < 0 ? 1 : 0.2)) * dt;
      p.z += (p.vz + Math.cos(p.ph * 0.8) * 0.6 * (p.vy < 0 ? 1 : 0.2)) * dt;
      p.y += p.vy * dt;
      p.yaw += p.wy * dt; p.pitch += p.wp * dt; p.roll += p.wr * dt;
      p.pitch = Math.sin(p.ph * 0.9) * 0.9; p.roll = Math.cos(p.ph * 0.7) * 0.7;
      const b = G.bounds;
      if (p.x < b.minX + 0.1) { p.x = b.minX + 0.1; p.vx = Math.abs(p.vx) * 0.3; }
      if (p.x > b.maxX - 0.1) { p.x = b.maxX - 0.1; p.vx = -Math.abs(p.vx) * 0.3; }
      if (p.z < b.minZ + 0.1) { p.z = b.minZ + 0.1; p.vz = Math.abs(p.vz) * 0.3; }
      if (p.z > b.maxZ - 0.1) { p.z = b.maxZ - 0.1; p.vz = -Math.abs(p.vz) * 0.3; }
      const fy = surfaceHeight(p.x, p.z);
      if (p.y <= fy + 0.004 && p.vy < 0) {
        p.y = fy + 0.003 + Math.random() * 0.006; p.rest = true; p.floorY = fy; p.pitch = 0; p.roll = 0;
      }
    }
    _e.set(p.pitch, p.yaw, p.roll, 'YXZ'); _q.setFromEuler(_e);
    _s.set(p.scale * (p.sx || 1), 1, p.scale * (p.sz || 1));
    _m.compose(_p.set(p.x, p.y, p.z), _q, _s);
    paperMesh.setMatrixAt(k, _m);
    paperMesh.geometry.attributes.aVar.array[k] = p.var;
    k++;
  }
  paperMesh.count = k;
  paperMesh.instanceMatrix.needsUpdate = true;
  paperMesh.geometry.attributes.aVar.needsUpdate = true;
}

// ---- FALLEN LEAVES (round the plants: the vacuum's job) ----
const MAXLF = 500;
export const leaves = [];
let leafMesh;
function leafTexture() {
  const c = makeCanvas(128, 128), x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, 128, 128);
  const g = x.createRadialGradient(64, 64, 20, 64, 64, 70); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.22)'); x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  x.strokeStyle = 'rgba(40,50,20,0.55)'; x.lineWidth = 3; x.beginPath(); x.moveTo(64, 128); x.lineTo(64, 6); x.stroke(); // midrib
  x.lineWidth = 1.4; x.strokeStyle = 'rgba(40,50,20,0.38)';
  for (let i = 0; i < 7; i++) { const y = 112 - i * 14; for (const s of [-1, 1]) { x.beginPath(); x.moveTo(64, y); x.quadraticCurveTo(64 + s * 18, y - 10, 64 + s * (40 - i * 3), y - 22); x.stroke(); } }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function leafGeometry() {
  // the classic leaf: pointed oval with a little stem, cupped along the midrib
  const sh = new THREE.Shape(); sh.moveTo(0, -0.5); sh.bezierCurveTo(0.36, -0.36, 0.38, 0.12, 0, 0.5); sh.bezierCurveTo(-0.38, 0.12, -0.36, -0.36, 0, -0.5);
  const leaf = new THREE.ShapeGeometry(sh, 10), stem = new THREE.PlaneGeometry(0.035, 0.18).translate(0, -0.58, 0);
  const g = mergeGeometries([leaf.toNonIndexed(), stem.toNonIndexed()].map(q => { q.deleteAttribute('uv'); q.deleteAttribute('normal'); return q; }));
  const pos = g.attributes.position, uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i), py = pos.getY(i);
    uv[i * 2] = px + 0.5; uv[i * 2 + 1] = (py + 0.68) / 1.18;
    pos.setZ(i, px * px * 0.55 + py * py * 0.08); // cup and arch
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.rotateX(-Math.PI / 2); g.computeVertexNormals();
  return g;
}
export function initLeaves() {
  const mat = new THREE.MeshStandardMaterial({ map: leafTexture(), roughness: 0.55, side: THREE.DoubleSide, envMapIntensity: 0.6 });
  mat.onBeforeCompile = sh => vacuumGlow(sh);
  leafMesh = new THREE.InstancedMesh(leafGeometry(), mat, MAXLF);
  leafMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); leafMesh.castShadow = true; leafMesh.receiveShadow = true; leafMesh.frustumCulled = false; leafMesh.userData.noAO = true; leafMesh.count = 0;
  leafMesh.setColorAt(0, new THREE.Color()); // (enables per-leaf colours)
  G.scene.add(leafMesh);
}
const LEAF_COL = [0x5f9e2c, 0x6db338, 0x4c8526, 0x86b232, 0xb9c23c, 0xd2a93a, 0xa87a2e, 0x7f6028];
export function seedLeaves(spots) {
  if (!leafMesh) return;
  const blocked = (x, z) => G.colliders.some(b => b.active && b.y0 < 0.3 && pointInBox(b, x, z, 0.02));
  for (const sp of spots) {
    const n = sp.kind === 'PlantBox' ? 16 : sp.kind === 'SmallerPlantBox' ? 12 : 9;
    const c = Math.cos(sp.yaw), s = Math.sin(sp.yaw);
    for (let i = 0; i < n && leaves.length < MAXLF; i++) {
      for (let tries = 0; tries < 20; tries++) {
        // a point just outside the planter's footprint, mostly close in
        const a = Math.random() * Math.PI * 2, out = 0.06 + Math.pow(Math.random(), 1.6) * 0.9;
        let lx = Math.cos(a), lz = Math.sin(a); const k = 1 / Math.max(Math.abs(lx) / sp.hw, Math.abs(lz) / sp.hd);
        lx = lx * k + Math.cos(a) * out; lz = lz * k + Math.sin(a) * out;
        const x = sp.x + lx * c + lz * s, z = sp.z - lx * s + lz * c;
        if (blocked(x, z)) continue;
        leaves.push({ x, z, y: 0.008 + Math.random() * 0.004, yaw: Math.random() * 6.283, tilt: (Math.random() - 0.5) * 0.25, s: 0.12 + Math.random() * 0.1, rest: true, floorY: 0 });
        leafMesh.setColorAt(leaves.length - 1, new THREE.Color(LEAF_COL[Math.random() * LEAF_COL.length | 0]).multiplyScalar(0.85 + Math.random() * 0.3));
        break;
      }
    }
  }
  leafMesh.instanceColor.needsUpdate = true;
}
export function leafCount() { return leaves.length; }
function updateLeaves() {
  if (!leafMesh) return;
  const vacOff = !(G.time - (FX.vacT ?? -9) < 0.1);
  for (let i = 0; i < leaves.length; i++) {
    const l = leaves[i];
    if (vacOff && l.suck) { l.suck = 0; l.y = 0.006; }
    _e.set(l.tilt + (l.suck ? Math.sin(l.ph || 0) * 0.6 * l.suck : 0), l.yaw, 0, 'YXZ'); _q.setFromEuler(_e);
    _m.compose(_p.set(l.x, l.y, l.z), _q, _s.setScalar(l.s)); leafMesh.setMatrixAt(i, _m);
  }
  leafMesh.count = leaves.length; leafMesh.instanceMatrix.needsUpdate = true;
}

// ---- GLASS SHARDS ----
const MAXS = 1400;
export const shards = [];
let shardMesh;
export function initShards() {
  const shape = new THREE.Shape(); shape.moveTo(0, 0); shape.lineTo(1, 0.15); shape.lineTo(0.35, 0.9); shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.08, bevelEnabled: false });
  geo.translate(-0.45, -0.35, -0.04); geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({ color: 0xd8f0f2, roughness: 0.03, metalness: 0.3, transparent: true, opacity: 0.6, envMapIntensity: 3 });
  mat.onBeforeCompile = sh => vacuumGlow(sh);
  shardMesh = new THREE.InstancedMesh(geo, mat, MAXS);
  shardMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  shardMesh.frustumCulled = false; shardMesh.userData.noAO = true; shardMesh.count = 0;
  G.scene.add(shardMesh);
  for (let i = 0; i < MAXS; i++) shards.push({ active: false });
}
let shardCursor = 0;
export function spawnShard(x, y, z, vx, vy, vz, size) {
  size *= Math.random() < 0.62 ? 0.22 + Math.random() * 0.38 : 0.6 + Math.random() * 0.9; // mostly little bits, a few big pieces
  const s = shards[shardCursor]; shardCursor = (shardCursor + 1) % MAXS;
  Object.assign(s, { active: true, rest: false, x, y, z, vx, vy, vz, size, q: new THREE.Quaternion().setFromEuler(new THREE.Euler(rand(0, 6), rand(0, 6), rand(0, 6))), w: new THREE.Vector3(rand(-15, 15), rand(-15, 15), rand(-15, 15)), fy: 0 });
}
const _w = new THREE.Quaternion(), _axis = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
function updateShards(dt) {
  let k = 0;
  const vacOff = !(G.time - (FX.vacT ?? -9) < 0.1);
  for (const s of shards) {
    if (!s.active) continue;
    if (vacOff && s.suck) { s.suck = 0; if (s.rest) s.y = (s.fy || 0) + 0.005; }
    if (!s.rest) {
      s.vy -= 14 * dt;
      s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
      const sp = s.w.length();
      if (sp > 0) { _axis.copy(s.w).multiplyScalar(1 / sp); _w.setFromAxisAngle(_axis, sp * dt); s.q.premultiply(_w); }
      const fy = surfaceHeight(s.x, s.z);
      if (s.y < fy + 0.005) {
        s.y = fy + 0.005;
        if (Math.abs(s.vy) > 1.5) { s.vy = -s.vy * 0.25; s.vx *= 0.5; s.vz *= 0.5; s.w.multiplyScalar(0.4); }
        else { s.rest = true; s.fy = fy; // lie flat keeping yaw
          const e = new THREE.Euler().setFromQuaternion(s.q, 'YXZ'); s.q.setFromEuler(new THREE.Euler(0, e.y, 0)); }
      }
    }
    _s.setScalar(s.size); _m.compose(_p.set(s.x, s.y, s.z), s.q, _s);
    shardMesh.setMatrixAt(k++, _m);
  }
  shardMesh.count = k; shardMesh.instanceMatrix.needsUpdate = true;
}

// ---- PARTICLES (sparks, water droplets, dust, leaves, soil) as points-like sprites ----
const MAXQ = 700;
const parts = [];
let partMesh;
export function initParticles() {
  const geo = new THREE.PlaneGeometry(1, 1);
  const mat = new THREE.MeshBasicMaterial({ map: glowTex('255,255,255'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, vertexColors: false });
  partMesh = new THREE.InstancedMesh(geo, mat, MAXQ);
  partMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAXQ * 3), 3);
  partMesh.frustumCulled = false; partMesh.userData.noAO = true; partMesh.userData.noReflect = false; partMesh.count = 0;
  G.scene.add(partMesh);
  // non-additive debris (soil, leaves, water)
  const mat2 = new THREE.MeshStandardMaterial({ roughness: 0.6, side: THREE.DoubleSide });
  debrisMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat2, MAXQ);
  debrisMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAXQ * 3), 3);
  debrisMesh.frustumCulled = false; debrisMesh.userData.noAO = true; debrisMesh.count = 0;
  G.scene.add(debrisMesh);
}
let debrisMesh;
const debris = [];
const _c = new THREE.Color();
export function spark(x, y, z, n, color = 0xffc070, speed = 6, life = 0.35, size = 0.12) {
  for (let i = 0; i < n; i++) {
    if (parts.length >= MAXQ) parts.shift();
    const a = rand(0, 6.28), e = rand(-0.2, 1.2);
    parts.push({ x, y, z, vx: Math.cos(a) * Math.cos(e) * speed * rand(0.3, 1), vy: Math.sin(e) * speed * rand(0.3, 1), vz: Math.sin(a) * Math.cos(e) * speed * rand(0.3, 1), life, t: 0, size: size * rand(0.6, 1.3), color, g: 9 });
  }
}
export function flash(x, y, z, size = 1.2, color = 0xffd090, life = 0.07) {
  if (parts.length >= MAXQ) parts.shift();
  parts.push({ x, y, z, vx: 0, vy: 0, vz: 0, life, t: 0, size, color, g: 0 });
}
export function droplets(x, y, z, n, dirx = 0, dirz = 0) {
  for (let i = 0; i < n; i++) {
    if (debris.length >= MAXQ) debris.shift();
    const a = rand(0, 6.28), s = rand(1, 4);
    debris.push({ x, y, z, vx: Math.cos(a) * s + dirx * 3, vy: rand(1, 4), vz: Math.sin(a) * s + dirz * 3, life: 0.6, t: 0, size: rand(0.03, 0.07), color: 0xbfd6e6, flat: false, spin: 0 });
  }
}
export function chunks(x, y, z, n, color, size = 0.08, speed = 3, life = 1.6) {
  for (let i = 0; i < n; i++) {
    if (debris.length >= MAXQ) debris.shift();
    const a = rand(0, 6.28), s = rand(0.3, 1) * speed;
    debris.push({ x, y, z, vx: Math.cos(a) * s, vy: rand(1, 3.5), vz: Math.sin(a) * s, life, t: 0, size: size * rand(0.5, 1.4), color, flat: true, spin: rand(0, 6) });
  }
}
const _camQ = new THREE.Quaternion();
function updateParticles(dt) {
  _camQ.copy(G.camera.quaternion);
  let k = 0;
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i]; p.t += dt;
    if (p.t > p.life) { parts.splice(i, 1); continue; }
    p.vy -= p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    if (p.y < 0.02) { p.y = 0.02; p.vy *= -0.4; }
  }
  for (const p of parts) {
    const f = 1 - p.t / p.life;
    _s.setScalar(p.size * (p.g ? f : 1 + (1 - f)));
    _m.compose(_p.set(p.x, p.y, p.z), _camQ, _s);
    partMesh.setMatrixAt(k, _m);
    _c.set(p.color).multiplyScalar(2 * f);
    partMesh.setColorAt(k, _c);
    k++;
  }
  partMesh.count = k; partMesh.instanceMatrix.needsUpdate = true; if (partMesh.instanceColor) partMesh.instanceColor.needsUpdate = true;
  k = 0;
  for (let i = debris.length - 1; i >= 0; i--) {
    const p = debris[i]; p.t += dt;
    if (p.t > p.life) { debris.splice(i, 1); continue; }
    p.vy -= 9.8 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.spin += dt * 8;
    if (p.y < 0.01) { p.y = 0.01; p.vy = 0; p.vx *= 0.8; p.vz *= 0.8; }
  }
  for (const p of debris) {
    const f = Math.min(1, (p.life - p.t) * 4);
    _s.setScalar(p.size * f);
    if (p.flat) { _e.set(p.spin, p.spin * 0.7, 0); _q.setFromEuler(_e); } else _q.copy(_camQ);
    _m.compose(_p.set(p.x, p.y, p.z), _q, _s);
    debrisMesh.setMatrixAt(k, _m); _c.set(p.color); debrisMesh.setColorAt(k, _c); k++;
  }
  debrisMesh.count = k; debrisMesh.instanceMatrix.needsUpdate = true; if (debrisMesh.instanceColor) debrisMesh.instanceColor.needsUpdate = true;
}

// ---- TRACERS ----
const tracers = [];
let tracerMat;
export function tracer(from, to) {
  if (!tracerMat) tracerMat = new THREE.MeshBasicMaterial({ color: 0xffe0a0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const len = from.distanceTo(to);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, len, 4, 1, true), tracerMat.clone());
  m.position.copy(from).lerp(to, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
  m.material.color.multiplyScalar(3);
  m.userData.noAO = true;
  G.scene.add(m); tracers.push({ m, t: 0 });
}
function updateTracers(dt) {
  for (let i = tracers.length - 1; i >= 0; i--) {
    const t = tracers[i]; t.t += dt;
    t.m.material.opacity = Math.max(0, 1 - t.t / 0.09);
    if (t.t > 0.09) { G.scene.remove(t.m); t.m.geometry.dispose(); t.m.material.dispose(); tracers.splice(i, 1); }
  }
}

// ---- SWING TRAIL (ribbon following the mop head) ----
export class Trail {
  constructor(n = 14, color = 0xdbe8ff) {
    this.n = n; this.pts = [];
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 2 * 3); this.alpha = new Float32Array(n * 2);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('a', new THREE.BufferAttribute(this.alpha, 1));
    const idx = []; for (let i = 0; i < n - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    geo.setIndex(idx);
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      uniforms: { col: { value: new THREE.Color(color) }, k: { value: 0 } },
      vertexShader: 'attribute float a; varying float va; void main(){ va=a; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: 'uniform vec3 col; uniform float k; varying float va; void main(){ gl_FragColor=vec4(col*k*va*1.4, va*k); }',
    });
    this.mesh = new THREE.Mesh(geo, this.mat); this.mesh.frustumCulled = false; this.mesh.userData.noAO = true; this.mesh.userData.noReflect = true;
    G.scene.add(this.mesh);
  }
  push(a, b, on) {
    this.pts.unshift([a.clone(), b.clone()]); if (this.pts.length > this.n) this.pts.pop();
    this.mat.uniforms.k.value += ((on ? 1 : 0) - this.mat.uniforms.k.value) * 0.35;
    for (let i = 0; i < this.n; i++) {
      const p = this.pts[Math.min(i, this.pts.length - 1)];
      this.pos.set([p[0].x, p[0].y, p[0].z], i * 6); this.pos.set([p[1].x, p[1].y, p[1].z], i * 6 + 3);
      const al = Math.max(0, 1 - i / (this.n - 1)); this.alpha[i * 2] = al * 0.15; this.alpha[i * 2 + 1] = al;
    }
    this.mesh.geometry.attributes.position.needsUpdate = true; this.mesh.geometry.attributes.a.needsUpdate = true;
  }
}

// ---- FLOATING TEXT (HTML) ----
const floats = [];
export function floatText(text, pos, cls = '', life = 0.9) {
  const el = document.createElement('div'); el.className = 'ftext ' + cls; el.textContent = text;
  document.getElementById('floaters').appendChild(el);
  floats.push({ el, pos: pos.clone(), t: 0, life, dx: rand(-20, 20) });
}
const _v = new THREE.Vector3();
function updateFloats(dt) {
  for (let i = floats.length - 1; i >= 0; i--) {
    const f = floats[i]; f.t += dt;
    if (f.t > f.life) { f.el.remove(); floats.splice(i, 1); continue; }
    _v.copy(f.pos); _v.y += f.t * 1.2; _v.project(G.camera);
    const x = (_v.x * 0.5 + 0.5) * innerWidth + f.dx * f.t, y = (-_v.y * 0.5 + 0.5) * innerHeight;
    f.el.style.transform = `translate(${x}px,${y}px) translate(-50%,-50%) scale(${1 + Math.max(0, 0.15 - f.t) * 3})`;
    f.el.style.opacity = Math.min(1, (f.life - f.t) * 4);
  }
}

export function updateFX(dt) {
  updatePapers(dt); updateLeaves(); updateShards(dt); updateParticles(dt); updateTracers(dt); updateFloats(dt); updateDirt(dt);
}
