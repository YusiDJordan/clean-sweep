// Shared game state and small helpers
import * as THREE from 'three';

export const G = {
  scene: null, camera: null, renderer: null,
  time: 0, simTime: 0, timeScale: 1, slowmoT: 0, slowmoScale: 1, hitstop: 0,
  shake: 0,
  quality: 'high',
  player: null, enemies: [],
  colliders: [],        // static + destructible obstacles {cx,cz,hx,hz,c,s,y0,y1,dyn,ref}
  surfaces: [],         // horizontal surfaces papers can rest on {cx,cz,hx,hz,c,s,y}
  destructibles: [],
  bounds: { minX: -18, maxX: 18, minZ: -13, maxZ: 13 },
  state: 'title',       // title | play | cleared | results | dead
  stats: { hits: 0, maxCombo: 0, perfect: 0, kos: 0, damage: 0, ledger: [], papers: 0, shards: 0, score: 0, ground: 0, specials: 0 },
  combo: 0, comboTimer: 0, specialCharges: 0, specialProgress: 0,
  input: null,
  mouseGround: new THREE.Vector3(),
  events: [], // misc
};

export const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = t => t * t * (3 - 2 * t);
export const rand = (a, b) => a + Math.random() * (b - a);
export const randi = (a, b) => Math.floor(rand(a, b + 1));
export const pick = arr => arr[Math.floor(Math.random() * arr.length)];
export const angDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
export const dampAngle = (a, b, k, dt) => a + angDiff(a, b) * (1 - Math.exp(-k * dt));
export const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));

// ---- 2D oriented-box colliders on the XZ plane ----
export function makeBox(cx, cz, w, d, yaw = 0, y0 = 0, y1 = 3, extra = {}) {
  return Object.assign({ cx, cz, hx: w / 2, hz: d / 2, c: Math.cos(yaw), s: Math.sin(yaw), y0, y1, active: true }, extra);
}
// world -> box local (x,z)
function toLocal(b, x, z) {
  const dx = x - b.cx, dz = z - b.cz;
  return [dx * b.c - dz * b.s, dx * b.s + dz * b.c];
}
function toWorld(b, lx, lz) {
  return [b.cx + lx * b.c + lz * b.s, b.cz - lx * b.s + lz * b.c];
}
// Push a circle out of all active colliders. Returns the collider hit with the largest push (or null).
export function resolveCircle(pos, r, filter, list = G.colliders) {
  let hit = null, best = 0;
  for (let k = 0; k < 2; k++) {
    for (const b of list) {
      if (!b.active) continue;
      if (filter && !filter(b)) continue;
      if (pos.y + 1.2 < b.y0 || pos.y > b.y1) continue;
      const [lx, lz] = toLocal(b, pos.x, pos.z);
      const qx = clamp(lx, -b.hx, b.hx), qz = clamp(lz, -b.hz, b.hz);
      let dx = lx - qx, dz = lz - qz;
      let d2 = dx * dx + dz * dz;
      if (d2 > r * r) continue;
      let nx, nz, pen;
      if (d2 < 1e-8) { // center inside box: push along smallest axis
        const px = b.hx - Math.abs(lx), pz = b.hz - Math.abs(lz);
        if (px < pz) { nx = Math.sign(lx) || 1; nz = 0; pen = px + r; } else { nx = 0; nz = Math.sign(lz) || 1; pen = pz + r; }
      } else { const d = Math.sqrt(d2); nx = dx / d; nz = dz / d; pen = r - d; }
      const [wx, wz] = [nx * b.c + nz * b.s, -nx * b.s + nz * b.c];
      pos.x += wx * pen; pos.z += wz * pen;
      if (pen > best) { best = pen; hit = b; hit._nx = wx; hit._nz = wz; }
    }
  }
  return hit;
}
export function pointInBox(b, x, z, pad = 0) {
  const [lx, lz] = toLocal(b, x, z);
  return Math.abs(lx) <= b.hx + pad && Math.abs(lz) <= b.hz + pad;
}
// 3D ray vs yaw-rotated box. Returns t or -1
export function rayBox(b, o, d, maxT) {
  const [ox, oz] = toLocal(b, o.x, o.z);
  const dx = d.x * b.c - d.z * b.s, dz = d.x * b.s + d.z * b.c;
  let t0 = 0, t1 = maxT;
  const slab = (oo, dd, mn, mx) => {
    if (Math.abs(dd) < 1e-9) return oo >= mn && oo <= mx;
    let a = (mn - oo) / dd, c = (mx - oo) / dd; if (a > c) [a, c] = [c, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, c); return t0 <= t1;
  };
  if (!slab(ox, dx, -b.hx, b.hx)) return -1;
  if (!slab(oz, dz, -b.hz, b.hz)) return -1;
  if (!slab(o.y, d.y, b.y0, b.y1)) return -1;
  return t0;
}
export function boxCorners(b) {
  return [toWorld(b, -b.hx, -b.hz), toWorld(b, b.hx, -b.hz), toWorld(b, b.hx, b.hz), toWorld(b, -b.hx, b.hz)];
}
// sphere vs box (3D-ish: box is a prism y0..y1)
export function sphereBox(b, p, r) {
  if (p.y + r < b.y0 || p.y - r > b.y1) return false;
  const [lx, lz] = toLocal(b, p.x, p.z);
  const qx = clamp(lx, -b.hx, b.hx), qz = clamp(lz, -b.hz, b.hz);
  return (lx - qx) ** 2 + (lz - qz) ** 2 <= r * r;
}

export function canvasTex(cv, srgb = true, repeat = false) {
  const t = new THREE.CanvasTexture(cv);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = 8;
  return t;
}
export function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
