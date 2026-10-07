// Destructible props: glass partitions, computers, plants, coffee table; pushable office chairs
import * as THREE from 'three';
import { G, rand, clamp, resolveCircle, makeBox, pointInBox } from './state.js';
// chairs may tuck under a desk (knee space) but can't pass through it: they collide with a slimmer inner box
let deskInner = null;
function getDeskInner() {
  if (!deskInner) deskInner = G.colliders.filter(b => b.desk).map(b => makeBox(b.cx, b.cz, 2 * (b.hx - 0.04), 2 * Math.max(0.06, b.hz - 0.4), Math.atan2(b.s, b.c), 0, 1.2));
  return deskInner;
}
import { spawnShard, spark, chunks, dirtBlob, paperBurst, floatText, flash } from './fx.js';
import { addDecal } from './decals.js';
import { SFX } from './audio.js';

export function addDestructible(d) {
  if (d.kind === 'plant') return d; // planters & pots: solid, can't be knocked over
  Object.assign(d, { hp: d.kind === 'glass' ? 2 : 1, broken: false, cracked: false, anim: null });
  if (d.box) d.box.destructible = d;
  G.destructibles.push(d);
  return d;
}

function charge(d) {
  G.stats.damage += d.cost;
  G.stats.ledger.push(d.name);
  const p = d.obj.getWorldPosition(new THREE.Vector3()); p.y += 1.5;
  floatText(`-$${d.cost.toLocaleString()}`, p, 'cost', 1.3);
  G.onDamage && G.onDamage(d);
}

// source: 'mop' | 'bullet' | 'body' ; dir: THREE.Vector3 (horizontal push direction)
G.hitDestructible = (...a) => hitDestructible(...a); // test hook
export function hitDestructible(d, src, point, dir) {
  if (d.broken) return false;
  if (d.kind === 'glass') {
    if (src === 'body' || d.cracked) { shatterGlass(d, point, dir); return true; }
    d.cracked = true; d.hp--;
    crack(d, point, dir);
    SFX.play('crack');
    return true;
  }
  if (d.kind === 'computer') { if (src === 'body' || src === 'mop' || src === 'bullet') { toppleComputer(d, dir); return true; } }
  if (d.kind === 'plant') {
    if (src === 'bullet') { chunks(point.x, point.y, point.z, 6, 0x4a7a32, 0.07, 2); return false; }
    tipPlant(d, dir); return true;
  }
  if (d.kind === 'table') {
    if (src === 'bullet') return false;
    if (src === 'body') { d.broken = true; charge(d); SFX.play('shatter');
      const p = d.obj.position; for (let i = 0; i < 85; i++) spawnShard(p.x + rand(-0.5, 0.5), d.h, p.z + rand(-0.5, 0.5), rand(-2, 2), rand(0.5, 2.5), rand(-2, 2), rand(0.05, 0.16));
      d.obj.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.material.color.multiplyScalar(0.6); } });
      return true; }
  }
  return false;
}

// ---------- cracked glass: the pane is rebuilt as real fractured pieces ----------
// Radial cracks run out from the impact, broken concentric cracks join them, and every piece is tilted a few
// degrees and pushed in near the hit, so the reflections break up the way real cracked glass does.
function clipRect(poly, x0, x1, y0, y1) {
  const clip = (pts, inside, cut) => { const out = []; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length], ia = inside(a), ib = inside(b); if (ia) out.push(a); if (ia !== ib) out.push(cut(a, b)); } return out; };
  const lerpAt = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  let p = poly;
  p = clip(p, q => q[0] >= x0, (a, b) => lerpAt(a, b, (x0 - a[0]) / (b[0] - a[0]))); if (p.length < 3) return p;
  p = clip(p, q => q[0] <= x1, (a, b) => lerpAt(a, b, (x1 - a[0]) / (b[0] - a[0]))); if (p.length < 3) return p;
  p = clip(p, q => q[1] >= y0, (a, b) => lerpAt(a, b, (y0 - a[1]) / (b[1] - a[1]))); if (p.length < 3) return p;
  p = clip(p, q => q[1] <= y1, (a, b) => lerpAt(a, b, (y1 - a[1]) / (b[1] - a[1])));
  return p;
}
function fracturePane(w, h, cx, cy, dent) {
  const x0 = -w / 2, x1 = w / 2, y0 = -h / 2, y1 = h / 2;
  const K = 12 + (Math.random() * 6 | 0), base = Math.random() * Math.PI * 2;
  const RS = [0, 0.015, 0.03, 0.05, 0.08, 0.12, 0.17, 0.24, 0.33, 0.45, 0.6, 0.8, 1.05, 1.4, 1.9, 2.6, 3.5];
  // jagged arms: each wanders a little as it runs out
  const arms = [];
  for (let k = 0; k < K; k++) {
    const a0 = base + (k + (Math.random() - 0.5) * 0.6) * Math.PI * 2 / K; const off = [0]; let o = 0;
    for (let i = 1; i < RS.length; i++) { o += (Math.random() - 0.5) * (i < 6 ? 0.22 : 0.1); off.push(o); }
    arms.push({ a0, off });
  }
  arms.sort((p, q) => p.a0 - q.a0);
  const armPt = (k, r) => {
    const A = arms[k % K], wrap = k >= K ? Math.PI * 2 : 0;
    let i = 1; while (i < RS.length - 1 && RS[i] < r) i++;
    const t = clamp((r - RS[i - 1]) / (RS[i] - RS[i - 1]), 0, 1), th = A.a0 + wrap + A.off[i - 1] + (A.off[i] - A.off[i - 1]) * t;
    return [cx + Math.cos(th) * r, cy + Math.sin(th) * r];
  };
  const armRun = (k, ra, rb) => { const out = [armPt(k, ra)]; for (const r of RS) if (r > ra + 1e-4 && r < rb - 1e-4) out.push(armPt(k, r)); out.push(armPt(k, rb)); return out; };
  const arcs = new Map();
  const arc = (k, r) => { // ring crack across gap k at radius r (shared by the cells either side of it)
    const key = k + ':' + r; if (arcs.has(key)) return arcs.get(key);
    const p0 = armPt(k, r), p1 = armPt(k + 1, r), mid = [];
    for (const f of [0.25, 0.5, 0.75]) { const th = Math.atan2(p0[1] - cy, p0[0] - cx) * (1 - f) + (Math.atan2(p1[1] - cy, p1[0] - cx) + (Math.atan2(p1[1] - cy, p1[0] - cx) < Math.atan2(p0[1] - cy, p0[0] - cx) ? Math.PI * 2 : 0)) * f, rr = r * (1 + (Math.random() - 0.5) * 0.3); mid.push([cx + Math.cos(th) * rr, cy + Math.sin(th) * rr]); }
    const res = [p0, ...mid, p1]; arcs.set(key, res); return res;
  };
  const pos = [], nrm = [], uv = [], crush = [], lines = [];
  const NZ = new THREE.Vector3(), Q = new THREE.Quaternion(), V3 = new THREE.Vector3(), AX = new THREE.Vector3();
  const addCell = (poly, inner) => {
    let p = clipRect(poly, x0 + 0.002, x1 - 0.002, y0 + 0.002, y1 - 0.002);
    p = p.filter((q, i) => { const n = p[(i + 1) % p.length]; return Math.hypot(q[0] - n[0], q[1] - n[1]) > 1e-4; });
    if (p.length < 3) return;
    let mx = 0, my = 0; for (const q of p) { mx += q[0]; my += q[1]; } mx /= p.length; my /= p.length;
    let size = 0; for (const q of p) size = Math.max(size, Math.hypot(q[0] - mx, q[1] - my));
    const dist = Math.hypot(mx - cx, my - cy);
    // tilt about a random in-plane axis through the piece's centre; smaller pieces near the hit tilt more
    const ang = rand(0.04, 0.11) * clamp(0.3 / Math.max(0.05, size), 0.35, 1.6) * (1 + 1.2 * Math.exp(-dist / 0.18));
    const phi = Math.random() * Math.PI * 2; AX.set(Math.cos(phi), Math.sin(phi), 0); Q.setFromAxisAngle(AX, ang);
    NZ.set(0, 0, 1).applyQuaternion(Q);
    const dz = dent * Math.exp(-dist / 0.22);
    const tris = THREE.ShapeUtils.triangulateShape(p.map(q => new THREE.Vector2(q[0], q[1])), []);
    const dst = inner ? crush : pos;
    for (const t of tris) for (const i of t) {
      V3.set(p[i][0] - mx, p[i][1] - my, 0).applyQuaternion(Q);
      dst.push(V3.x + mx, V3.y + my, V3.z + dz);
      if (!inner) { nrm.push(NZ.x, NZ.y, NZ.z); uv.push(p[i][0] / w + 0.5, p[i][1] / h + 0.5); }
    }
  };
  const Rmax = Math.hypot(w, h) + 0.5;
  for (let k = 0; k < K; k++) {
    // which ring cracks cross this gap (dense near the hit, sparse further out)
    const rings = [0, rand(0.018, 0.032)];
    if (Math.random() < 0.6) rings.push(rand(0.045, 0.09));
    if (Math.random() < 0.35) rings.push(rand(0.11, 0.21));
    if (Math.random() < 0.14) rings.push(rand(0.24, 0.42));
    rings.push(Rmax);
    for (let j = 0; j < rings.length - 1; j++) {
      const ra = rings[j], rb = rings[j + 1];
      const outer = arc(k, rb), innerArc = ra > 0 ? arc(k, ra).slice().reverse() : [[cx, cy]];
      const poly = [...armRun(k, ra, rb), ...outer.slice(1, -1), ...armRun(k + 1, ra, rb).reverse(), ...innerArc.slice(1, -1)];
      if (ra > 0) poly.push(innerArc[innerArc.length - 1]);
      addCell(poly, rb < 0.035);
      if (rb < Rmax) { const a = arc(k, rb), al = rand(0.1, 0.4); for (let i = 0; i < a.length - 1; i++) if (Math.random() < 0.85) lines.push(a[i], a[i + 1], al); }
    }
  }
  // radial cracks: brightness varies along them (they catch the light in places); some fade out before the frame
  for (let k = 0; k < K; k++) {
    const end = Math.random() < 0.35 ? rand(0.35, 1.4) : Rmax, a = armRun(k, 0, end);
    for (let i = 0; i < a.length - 1; i++) { const r = Math.hypot(a[i][0] - cx, a[i][1] - cy); lines.push(a[i], a[i + 1], rand(0.08, 0.42) * (0.45 + 0.55 * Math.exp(-r / 0.5)) * (end < Rmax ? clamp(1.2 - r / end, 0, 1) : 1)); }
  }
  // branches splitting off the radial cracks
  for (let n = 0; n < K; n++) {
    if (Math.random() < 0.4) continue;
    const k = Math.random() * K | 0, r0 = rand(0.12, 0.9); let p = armPt(k, r0);
    let th = Math.atan2(p[1] - cy, p[0] - cx) + (Math.random() < 0.5 ? -1 : 1) * rand(0.25, 0.6); const L = rand(0.15, 0.6), al = rand(0.06, 0.3);
    for (let d = 0; d < L; d += 0.06) { th += rand(-0.2, 0.2); const q = [p[0] + Math.cos(th) * 0.06, p[1] + Math.sin(th) * 0.06]; lines.push(p, q, al * (1 - d / L)); p = q; }
  }
  // hairline micro-cracks in the crushed core
  for (let i = 0; i < 46; i++) { const r = rand(0.005, 0.07), th = rand(0, 6.28), l = rand(0.008, 0.03), t2 = th + rand(-1, 1); const p = [cx + Math.cos(th) * r, cy + Math.sin(th) * r]; lines.push(p, [p[0] + Math.cos(t2) * l, p[1] + Math.sin(t2) * l], rand(0.3, 0.7)); }
  // clip crack lines to the pane
  const lp = [], lc = [];
  for (let i = 0; i < lines.length; i += 3) {
    let [a, b] = [lines[i], lines[i + 1]]; const al = lines[i + 2];
    const inside = q => q[0] > x0 && q[0] < x1 && q[1] > y0 && q[1] < y1;
    if (!inside(a) && !inside(b)) continue;
    if (!inside(b)) { const c = clipRect([a, b, a], x0, x1, y0, y1); if (c.length >= 2) b = c.find(q => q !== a) || b; }
    if (!inside(a)) { const c = clipRect([b, a, b], x0, x1, y0, y1); if (c.length >= 2) a = c.find(q => q !== b) || a; }
    const da = dent * Math.exp(-Math.hypot(a[0] - cx, a[1] - cy) / 0.22), db = dent * Math.exp(-Math.hypot(b[0] - cx, b[1] - cy) / 0.22);
    lp.push(a[0], a[1], da, b[0], b[1], db); lc.push(0.86, 0.9, 0.92, al, 0.86, 0.9, 0.92, al);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  const cg = new THREE.BufferGeometry(); cg.setAttribute('position', new THREE.Float32BufferAttribute(crush, 3)); cg.computeVertexNormals();
  const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3)); lg.setAttribute('color', new THREE.Float32BufferAttribute(lc, 4));
  return { geo, crush: cg, lines: lg };
}
let crackLineMat = null, crushMat = null;
function crack(d, point, dir) {
  const o = d.obj, local = o.worldToLocal(point.clone());
  const cx = clamp(local.x, -d.w / 2 + 0.12, d.w / 2 - 0.12), cy = clamp(local.y, -d.h / 2 + 0.25, d.h / 2 - 0.25);
  // dent the glass away from whoever hit it
  const ld = dir ? dir.clone().transformDirection(new THREE.Matrix4().extractRotation(o.matrixWorld).invert()) : new THREE.Vector3(0, 0, -1);
  const dent = (ld.z > 0 ? 1 : -1) * 0.01;
  const f = fracturePane(d.w, d.h, cx, cy, dent);
  o.geometry.dispose(); o.geometry = f.geo;
  if (!crackLineMat) {
    crackLineMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, toneMapped: false });
    crushMat = new THREE.MeshStandardMaterial({ color: 0xf2f6f6, roughness: 0.55, metalness: 0, transparent: true, opacity: 0.72, depthWrite: false, side: THREE.DoubleSide });
  }
  const ln = new THREE.LineSegments(f.lines, crackLineMat); ln.userData.noAO = true; ln.renderOrder = 3; o.add(ln);
  const cr = new THREE.Mesh(f.crush, crushMat); cr.userData.noAO = true; cr.renderOrder = 3; o.add(cr);
  o.material.opacity = Math.min(0.5, o.material.opacity + 0.06); // a cracked pane catches a little more light
  spark(point.x, point.y, point.z, 6, 0xffffff, 3, 0.25, 0.06);
}

function shatterGlass(d, point, dir) {
  d.broken = true; d.obj.visible = false; if (d.box) d.box.active = false;
  charge(d); SFX.play('shatter'); G.shake = Math.max(G.shake, 0.6);
  const n = Math.round(d.w * 80); // (lots of little bits)
  const c = Math.cos(d.yaw), s = Math.sin(d.yaw);
  for (let i = 0; i < n; i++) {
    const u = rand(-d.w / 2, d.w / 2), v = rand(0.1, 2.6);
    const x = d.obj.position.x + u * c, z = d.obj.position.z - u * s;
    const push = dir ? 1 : 0;
    spawnShard(x, v, z, (dir?.x || 0) * rand(1, 4) + rand(-1.5, 1.5), rand(-0.5, 2), (dir?.z || 0) * rand(1, 4) + rand(-1.5, 1.5), rand(0.06, 0.24));
  }
  spark(point.x, point.y, point.z, 20, 0xe8ffff, 5, 0.4, 0.07);
}

function toppleComputer(d, dir) {
  d.broken = true; if (d.box) d.box.active = false;
  charge(d); SFX.play('smash');
  const o = d.obj;
  const dx = dir ? dir.x : rand(-1, 1), dz = dir ? dir.z : rand(-1, 1);
  const L = Math.hypot(dx, dz) || 1;
  d.anim = { t: 0, vx: dx / L * rand(1.2, 2.2), vz: dz / L * rand(1.2, 2.2), vy: rand(1, 2.2), ax: rand(-1, 1), y: o.position.y, spin: rand(-6, 6) };
  const p = o.position.clone(); p.y += 0.35;
  spark(p.x, p.y, p.z, 22, 0x9fd8ff, 5, 0.4, 0.08);
  flash(p.x, p.y, p.z, 1.0, 0x9fd8ff);
  paperBurst(p.x, p.y, p.z, 5, dx / L * 0.4, dz / L * 0.4, 2.0);
  if (shatterComputer(d, new THREE.Vector3(dx / L, 0, dz / L))) { d.anim = null; return; }
  // darken screen
  o.traverse(m => { if (m.isMesh) { m.material = m.material.clone(); m.material.color.multiplyScalar(0.55); } });
}

function tipPlant(d, dir) {
  d.broken = true; if (d.box) d.box.active = false;
  charge(d); SFX.play('thud');
  const o = d.obj;
  const dx = dir ? dir.x : 1, dz = dir ? dir.z : 0, L = Math.hypot(dx, dz) || 1;
  d.anim = { t: 0, plant: true, dx: dx / L, dz: dz / L, base: o.quaternion.clone(), pos: o.position.clone() };
  const p = o.position;
  chunks(p.x, 0.5, p.z, 22, 0x3b2a1c, 0.06, 2.5); chunks(p.x, 0.9, p.z, 14, 0x4f7f34, 0.1, 2.0, 2.2);
  addDecal('soil', p.x + dx / L * 0.9, p.z + dz / L * 0.9, 1.2, Math.atan2(dx, dz)); // spilled potting soil
}

const _q = new THREE.Quaternion(), _axis = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _bb = new THREE.Box3(), _bb2 = new THREE.Box3();
// ---------- computers fall apart: monitor, stand, keyboard and a few loose keys tumble separately ----------
const partCache = new Map(), debris = [];
function computerParts(geo) {
  if (partCache.has(geo.uuid)) return partCache.get(geo.uuid);
  const pos = geo.attributes.position, nor = geo.attributes.normal, uv = geo.attributes.uv, idx = geo.index;
  const triCount = (idx ? idx.count : pos.count) / 3, vi = i => idx ? idx.getX(i) : i;
  // weld by position, then flood the triangles into connected pieces
  const weld = new Int32Array(pos.count), map = new Map();
  for (let i = 0; i < pos.count; i++) { const k = Math.round(pos.getX(i) * 1e4) + ',' + Math.round(pos.getY(i) * 1e4) + ',' + Math.round(pos.getZ(i) * 1e4); let w = map.get(k); if (w === undefined) { w = map.size; map.set(k, w); } weld[i] = w; }
  const par = new Int32Array(map.size); for (let i = 0; i < par.length; i++) par[i] = i;
  const find = x => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  for (let t = 0; t < triCount; t++) { const a = find(weld[vi(3 * t)]), b = find(weld[vi(3 * t + 1)]); par[b] = a; par[find(weld[vi(3 * t + 2)])] = a; }
  const comps = new Map();
  for (let t = 0; t < triCount; t++) { const r = find(weld[vi(3 * t)]); if (!comps.has(r)) comps.set(r, []); comps.get(r).push(t); }
  // sort pieces: keyboard side (+y in model space), monitor (high), stand; some keys pop off on their own
  const groups = [[], [], []], keys = [];
  for (const tris of comps.values()) {
    let cy = 0, cz = 0; for (const t of tris) for (let k = 0; k < 3; k++) { const i = vi(3 * t + k); cy += pos.getY(i); cz += pos.getZ(i); }
    cy /= tris.length * 3; cz /= tris.length * 3;
    if (cy > 0.05) { if (tris.length <= 12 && keys.length < 9 && Math.random() < 0.6) keys.push(tris); else groups[2].push(...tris); }
    else if (cz < -0.17) groups[0].push(...tris); else groups[1].push(...tris);
  }
  const parts = [...groups, ...keys].filter(t => t.length).map(tris => {
    const P = [], N = [], U = [], c = new THREE.Vector3();
    for (const t of tris) for (let k = 0; k < 3; k++) { const i = vi(3 * t + k); P.push(pos.getX(i), pos.getY(i), pos.getZ(i)); if (nor) N.push(nor.getX(i), nor.getY(i), nor.getZ(i)); if (uv) U.push(uv.getX(i), uv.getY(i)); c.x += pos.getX(i); c.y += pos.getY(i); c.z += pos.getZ(i); }
    c.multiplyScalar(1 / (tris.length * 3));
    for (let i = 0; i < P.length; i += 3) { P[i] -= c.x; P[i + 1] -= c.y; P[i + 2] -= c.z; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    if (N.length) g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); if (U.length) g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
    g.computeBoundingBox(); return { geo: g, c, small: tris.length <= 12 };
  });
  partCache.set(geo.uuid, parts); return parts;
}
function shatterComputer(d, dir) {
  const o = d.obj; o.updateMatrixWorld(true);
  let mesh = null; o.traverse(m => { if (m.isMesh && !m.userData.contact && !mesh) mesh = m; });
  if (!mesh || !mesh.geometry.attributes.position) return false;
  const parts = computerParts(mesh.geometry);
  if (parts.length < 2) return false;
  const mat = mesh.material.clone(); mat.color.multiplyScalar(0.6);
  const M = new THREE.Matrix4(), T = new THREE.Matrix4();
  parts.forEach((pt, i) => {
    const m = new THREE.Mesh(pt.geo, mat); m.castShadow = !pt.small; m.receiveShadow = true;
    M.copy(mesh.matrixWorld).multiply(T.makeTranslation(pt.c.x, pt.c.y, pt.c.z)); M.decompose(m.position, m.quaternion, m.scale);
    G.scene.add(m);
    const sp = pt.small ? rand(1.5, 3.2) : rand(0.9, 2.2), side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(rand(-1, 1) * (pt.small ? 1.6 : 0.7));
    debris.push({ m, v: dir.clone().multiplyScalar(sp).add(side).setY(rand(1.2, pt.small ? 3.4 : 2.4)), w: new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(pt.small ? 16 : 6), settle: 0, rest: false });
  });
  o.visible = false;
  return true;
}
function updateDebris(dt) {
  for (const p of debris) {
    if (p.rest) continue;
    p.v.y -= 9.8 * dt; p.m.position.addScaledVector(p.v, dt);
    _q.setFromAxisAngle(_axis.copy(p.w).normalize(), p.w.length() * dt); if (p.w.lengthSq() > 1e-6) p.m.quaternion.premultiply(_q);
    const c = { x: p.m.position.x, y: 0, z: p.m.position.z }; resolveCircle(c, 0.12); p.m.position.x = c.x; p.m.position.z = c.z;
    p.m.updateMatrixWorld(true); _bb.copy(p.m.geometry.boundingBox).applyMatrix4(p.m.matrixWorld);
    // land on the floor, or back on the desk it fell from
    let floor = 0; for (const s of G.surfaces) if (s.y > floor && _bb.min.y > s.y - 0.06 && pointInBox(s, p.m.position.x, p.m.position.z, 0)) floor = s.y;
    if (_bb.min.y < floor) {
      p.m.position.y += floor - _bb.min.y;
      if (p.v.y < 0) { p.v.y *= -0.22; p.v.x *= 0.55; p.v.z *= 0.55; p.w.multiplyScalar(0.45); }
      if (Math.abs(p.v.y) < 0.5 && Math.hypot(p.v.x, p.v.z) < 0.35) { p.settle += dt; p.v.multiplyScalar(0.5); p.w.multiplyScalar(0.6); if (p.settle > 0.35) p.rest = true; }
    }
  }
}
export function updateDestructibles(dt) {
  updateDebris(dt);
  for (const d of G.destructibles) {
    const a = d.anim; if (!a || a.done) continue;
    a.t += dt;
    const o = d.obj;
    if (a.plant) {
      const k = Math.min(1, a.t / 0.55), e = k * k;
      _axis.set(a.dz, 0, -a.dx).normalize();
      _q.setFromAxisAngle(_axis, e * 1.45);
      o.quaternion.copy(_q).multiply(a.base);
      o.position.set(a.pos.x + a.dx * e * 0.25, 0, a.pos.z + a.dz * e * 0.25);
      if (k >= 1) { a.done = true; chunks(o.position.x + a.dx, 0.1, o.position.z + a.dz, 10, 0x3b2a1c, 0.06, 1.5); }
    } else {
      // computer: flies off desk, tumbles, lands on its back
      a.vy -= 9.8 * dt;
      o.position.x += a.vx * dt; o.position.z += a.vz * dt; o.position.y += a.vy * dt;
      o.rotation.x += a.spin * dt * 0.6; o.rotation.z += a.spin * dt * 0.3;
      const p = { x: o.position.x, y: 0, z: o.position.z };
      resolveCircle(p, 0.3); o.position.x = p.x; o.position.z = p.z;
      if (o.position.y <= 0) {
        o.position.y = 0; a.done = true;
        o.rotation.set(-Math.PI / 2 * Math.sign(a.spin || 1), o.rotation.y, 0);
        o.position.y = 0.12;
        spark(o.position.x, 0.2, o.position.z, 10, 0x9fd8ff, 3, 0.3, 0.06); SFX.play('thud');
      }
    }
  }
  updateChairs(dt);
}

// ---------- chairs: pushable dynamic circles ----------
export const chairs = []; G.chairs = chairs;
// pushable things: office chairs, the cart, bins, ottomans, dropped rifles
// o: { r, heavy, noTip, tipForce, tipAngle, tipLift, cost, name, spill, light, baseQ, y0 }
export function addChair(obj, o = {}) {
  const shadows = []; obj.traverse(m => { if (m.userData.contact) shadows.push(m); });
  chairs.push({ obj, pos: obj.position.clone(), vel: new THREE.Vector3(), yaw: o.baseQ ? 0 : obj.rotation.y, wy: 0, tipped: false, tip: 0, tipDir: new THREE.Vector3(), r: o.r || 0.36, heavy: !!o.heavy, noTip: !!o.noTip,
    tipForce: o.tipForce ?? 5, tipAngle: o.tipAngle ?? 1.4, tipLift: o.tipLift ?? 0.3, cost: o.cost ?? 120, name: o.name || 'Office chair', spill: !!o.spill, light: !!o.light,
    baseQ: o.baseQ || null, y0: o.y0 || 0, shadows, mass: o.mass || 1, rifle: !!o.rifle });
}
export function pushChairs(pos, r, vel, strength = 1) {
  for (const c of chairs) {
    if (c.sucked) continue;
    const dx = c.pos.x - pos.x, dz = c.pos.z - pos.z, d = Math.hypot(dx, dz), rr = r + c.r;
    if (d < rr && d > 0.001) {
      const pen = rr - d;
      const share = (c.heavy ? 0.45 : 0.7) / c.mass; // the cart pushes back more (it's heavy)
      c.pos.x += dx / d * pen * share; c.pos.z += dz / d * pen * share;
      pos.x -= dx / d * pen * (1 - share); pos.z -= dz / d * pen * (1 - share);
      const v = Math.hypot(vel.x, vel.z), k = (c.heavy ? 0.25 : c.light ? 0.8 : 0.5) / c.mass;
      c.vel.x += dx / d * v * k * strength; c.vel.z += dz / d * v * k * strength; c.wy += (Math.random() - 0.5) * v * (c.heavy ? 0.4 : c.light ? 3 : 2);
      if (c.light && !c.noTip && v * strength > 4.5) knockChair(c, new THREE.Vector3(dx / d, 0, dz / d), v * strength); // run or slide into a bin and over it goes
    }
  }
}
export function knockChair(c, dir, force) {
  const k = (c.heavy ? 0.45 : 1) / c.mass;
  c.vel.x += dir.x * force * k; c.vel.z += dir.z * force * k; c.wy += rand(-8, 8) * k;
  if (force > c.tipForce && !c.tipped && !c.noTip) {
    c.tipped = true; c.tipDir.copy(dir);
    if (c.cost) {
      G.stats.damage += c.cost; G.stats.ledger.push(c.name);
      floatText('-$' + c.cost, c.pos.clone().setY(1.4), 'cost', 1.2); G.onDamage && G.onDamage({ cost: c.cost });
    }
    if (c.spill) paperBurst(c.pos.x + dir.x * 0.3, 0.25, c.pos.z + dir.z * 0.3, 6, dir.x * 0.8, dir.z * 0.8, 2.2); // the bin's rubbish goes everywhere
    SFX.play('thud');
  }
}
// the vacuum swallows a dropped rifle: it shrinks into the nozzle and is gone
export function suckChair(c, target) { if (!c.sucked) { c.sucked = { t: 0, from: c.obj.position.clone(), s0: c.obj.scale.clone(), target: target.clone() }; } }
function updateChairs(dt) {
  for (let i = chairs.length - 1; i >= 0; i--) {
    const c = chairs[i], sk = c.sucked; if (!sk) continue;
    sk.t += dt; const k = Math.min(1, sk.t / 0.35);
    c.obj.position.lerpVectors(sk.from, sk.target, k * k); c.obj.position.y = sk.from.y + Math.sin(Math.PI * k) * 0.25;
    c.obj.scale.copy(sk.s0).multiplyScalar(Math.max(0.01, 1 - k)); c.obj.rotation.y += dt * 12;
    for (const sh of c.shadows) sh.visible = false;
    if (k >= 1) { c.obj.parent && c.obj.parent.remove(c.obj); chairs.splice(i, 1); }
  }
  for (const c of chairs) {
    if (c.sucked) continue;
    c.pos.x += c.vel.x * dt; c.pos.z += c.vel.z * dt; c.yaw += c.wy * dt;
    const f = Math.exp(-(c.heavy ? 2.2 * c.mass : c.light ? 2.6 : 3.5) * dt); c.vel.multiplyScalar(f); c.wy *= f;
    const p = { x: c.pos.x, y: 0, z: c.pos.z };
    const hit = resolveCircle(p, c.r, b => !b.desk);
    resolveCircle(p, c.r, null, getDeskInner());
    if (hit && hit.destructible && Math.hypot(c.vel.x, c.vel.z) > 4) hitDestructible(hit.destructible, 'body', new THREE.Vector3(p.x, 0.8, p.z), c.vel.clone().normalize());
    c.pos.x = p.x; c.pos.z = p.z;
    // chairs vs other chairs
    for (const o of chairs) if (o !== c) {
      const dx = c.pos.x - o.pos.x, dz = c.pos.z - o.pos.z, d = Math.hypot(dx, dz);
      const rr = c.r + o.r; if (d < rr && d > 0.001) { const k = (rr - d) * 0.5; c.pos.x += dx / d * k; c.pos.z += dz / d * k; o.pos.x -= dx / d * k; o.pos.z -= dz / d * k; }
    }
    if (c.tipped) c.tip = Math.min(1, c.tip + dt * 3);
    c.obj.position.set(c.pos.x, c.y0, c.pos.z);
    if (c.baseQ) c.obj.quaternion.setFromAxisAngle(_up, c.yaw).multiply(c.baseQ); // lies flat (dropped rifles)
    else c.obj.rotation.set(0, c.yaw, 0);
    if (c.tip > 0) {
      _axis.set(c.tipDir.z, 0, -c.tipDir.x).normalize();
      _q.setFromAxisAngle(_axis, c.tip * c.tip * c.tipAngle);
      c.obj.quaternion.premultiply(_q);
      c.obj.position.y = c.y0 + c.tip * c.tipLift;
      for (const s of c.shadows) s.visible = false;
      // never let a toppled thing dip into the floor
      c.obj.updateMatrixWorld(true); _bb.makeEmpty();
      c.obj.traverse(m => { if (m.isMesh && !m.userData.contact) { if (!m.geometry.boundingBox) m.geometry.computeBoundingBox(); _bb2.copy(m.geometry.boundingBox).applyMatrix4(m.matrixWorld); _bb.union(_bb2); } });
      if (_bb.min.y < 0.004) c.obj.position.y += 0.004 - _bb.min.y;
    }
  }
}
