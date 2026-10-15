// Shared game state and small helpers
import * as THREE from 'three';

// the clean key: C in a browser (Ctrl+W/S/D next to the movement keys are browser shortcuts a page can't fully block),
// Ctrl in the desktop (Electron) build, where there are no browser shortcuts
export const ELECTRON = typeof navigator !== 'undefined' && /Electron/i.test(navigator.userAgent);
export const CLEAN = ELECTRON ? { codes: ['ControlLeft', 'ControlRight'], label: 'Ctrl' } : { codes: ['KeyC'], label: 'C' };
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
// can a's arm (or mop, or rifle butt) reach b? walls, glass, cabinets: anything waist-high or taller in between says no
export function canReach(a, b) {
  const o = { x: a.x, y: 1.0, z: a.z }, d = { x: b.x - a.x, y: 0, z: b.z - a.z }, L = Math.hypot(d.x, d.z); if (L < 1e-4) return true; d.x /= L; d.z /= L;
  for (const c of G.colliders) { if (!c.active || c.y1 < 0.85) continue; const t = rayBox(c, o, d, L); if (t > 0 && t < L) return false; }
  return true;
}
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

// ---- partial texture uploads: a mop stroke changes a hand-sized patch of a floor-sized canvas; send just that patch
// to the GPU (re-sending the whole 1360x960 layer twenty times a second was what made mopping choppy) ----
export function markRect(o, key, x0, y0, x1, y1) { // grow a pending dirty rectangle (canvas pixels)
  const r = o[key]; if (!r) o[key] = [x0, y0, x1, y1]; else { if (x0 < r[0]) r[0] = x0; if (y0 < r[1]) r[1] = y0; if (x1 > r[2]) r[2] = x1; if (y1 > r[3]) r[3] = y1; }
}
export function uploadRect(tex, ctx, r) { // false: not on the GPU yet (do a full upload instead)
  const R = G.renderer; if (!R) return false;
  const p = R.properties.get(tex);
  if (!p.__webglTexture || p.__version !== tex.version) return false;
  const cv = ctx.canvas, x = Math.max(0, Math.floor(r[0])), y = Math.max(0, Math.floor(r[1]));
  const w = Math.min(cv.width, Math.ceil(r[2])) - x, h = Math.min(cv.height, Math.ceil(r[3])) - y;
  if (w <= 0 || h <= 0) return true;
  const gl = R.getContext(), img = ctx.getImageData(x, y, w, h);
  R.state.bindTexture(gl.TEXTURE_2D, p.__webglTexture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, !!tex.premultiplyAlpha);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4); gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  if (gl.UNPACK_ROW_LENGTH) { gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0); gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0); gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0); }
  gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, img);
  if (tex.generateMipmaps && tex.minFilter !== 1006 && tex.minFilter !== 1003) gl.generateMipmap(gl.TEXTURE_2D); // (Linear / Nearest: no mips)
  return true;
}
