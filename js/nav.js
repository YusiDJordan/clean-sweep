// Robbers' way around things: a coarse grid over the floor (cells blocked by glass partitions, desks, walls...)
// and a flow field towards Karim, rebuilt a few times a second. When something stands between a robber and Karim,
// he follows the field around it instead of running into the glass.
import { G, pointInBox } from './state.js';

const CS = 0.5, PAD = 0.38; // cell size, and how far to keep clear of obstacles (about a robber's radius)
const NAV = { W: 0, H: 0, x0: 0, z0: 0, blocked: null, dist: null, sig: '', t: 0, q: null };

const solid = b => b.active && b.y1 > 0.5 && b.y0 < 1.2;
function build() {
  const B = G.bounds; NAV.x0 = B.minX; NAV.z0 = B.minZ;
  NAV.W = Math.ceil((B.maxX - B.minX) / CS); NAV.H = Math.ceil((B.maxZ - B.minZ) / CS);
  const n = NAV.W * NAV.H; NAV.blocked = new Uint8Array(n); NAV.dist = new Float32Array(n); NAV.q = new Int32Array(n); NAV.inq = new Uint8Array(n);
  for (const b of G.colliders) {
    if (!solid(b)) continue;
    const r = Math.hypot(b.hx, b.hz) + PAD;
    const i0 = Math.max(0, Math.floor((b.cx - r - NAV.x0) / CS)), i1 = Math.min(NAV.W - 1, Math.floor((b.cx + r - NAV.x0) / CS));
    const j0 = Math.max(0, Math.floor((b.cz - r - NAV.z0) / CS)), j1 = Math.min(NAV.H - 1, Math.floor((b.cz + r - NAV.z0) / CS));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * NAV.W + i; if (NAV.blocked[k]) continue;
      if (pointInBox(b, NAV.x0 + (i + 0.5) * CS, NAV.z0 + (j + 0.5) * CS, PAD)) NAV.blocked[k] = 1;
    }
  }
}
const cellOf = (x, z) => [Math.floor((x - NAV.x0) / CS), Math.floor((z - NAV.z0) / CS)];
const inside = (i, j) => i >= 0 && j >= 0 && i < NAV.W && j < NAV.H;
const free = (i, j) => inside(i, j) && !NAV.blocked[j * NAV.W + i];
const NB = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];

// distances from Karim over the free cells (a simple label-correcting search: the grid is small)
function flood(px, pz) {
  const D = NAV.dist, Q = NAV.q, I = NAV.inq, W = NAV.W; D.fill(1e9); I.fill(0);
  let head = 0, tail = 0;
  const [pi, pj] = cellOf(px, pz);
  for (let r = 0; r <= 3 && tail === 0; r++) // (he may be standing right up against a pane: seed the nearest free cells)
    for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) { const i = pi + di, j = pj + dj; if (free(i, j)) { D[j * W + i] = Math.hypot(di, dj) * 0.5; Q[tail++] = j * W + i; I[j * W + i] = 1; } }
  const n = Q.length;
  while (head !== tail) {
    const k = Q[head]; head = (head + 1) % n; I[k] = 0; const i = k % W, j = (k / W) | 0, d = D[k];
    for (const [di, dj, c] of NB) {
      const a = i + di, b = j + dj; if (!free(a, b)) continue;
      if (di && dj && (!free(i + di, j) || !free(i, j + dj))) continue; // (no cutting corners)
      const kk = b * W + a; if (d + c < D[kk] - 1e-4) { D[kk] = d + c; if (!I[kk]) { I[kk] = 1; Q[tail] = kk; tail = (tail + 1) % n; } }
    }
  }
}

export function updateNav(dt) {
  if (!G.player || !G.colliders.length) return;
  let sig = 0; for (const b of G.colliders) if (solid(b)) sig++;
  if (!NAV.blocked || sig + ':' + G.colliders.length !== NAV.sig) { NAV.sig = sig + ':' + G.colliders.length; build(); NAV.t = 0; }
  NAV.t -= dt; if (NAV.t > 0) return; NAV.t = 0.3;
  flood(G.player.pos.x, G.player.pos.z);
}

// is the straight walk from a to b blocked by something solid? (ignores the first and last bit: robbers and Karim
// can stand close to things)
export function pathBlocked(ax, az, bx, bz) {
  if (!NAV.blocked) return false;
  const L = Math.hypot(bx - ax, bz - az), n = Math.ceil(L / 0.25);
  for (let s = 1; s < n; s++) {
    const t = s / n, d0 = t * L; if (d0 < 0.45 || L - d0 < 0.6) continue;
    const [i, j] = cellOf(ax + (bx - ax) * t, az + (bz - az) * t);
    if (inside(i, j) && NAV.blocked[j * NAV.W + i]) return true;
  }
  return false;
}
// which way to walk to get round to Karim (a unit vector in out), or null if there's no better way
export function flowDir(x, z, out) {
  if (!NAV.dist) return null;
  const W = NAV.W, [i, j] = cellOf(x, z);
  if (!inside(i, j)) return null;
  // the best neighbour, looking a little further than one cell so the route is smooth
  let best = null, bd = free(i, j) ? NAV.dist[j * W + i] : 1e9;
  for (let r = 1; r <= 2; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
    if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
    const a = i + di, b = j + dj; if (!free(a, b)) continue;
    const d = NAV.dist[b * W + a] + Math.hypot(di, dj) * 0.15; // (a nudge towards the nearer of equal cells)
    if (d < bd - 0.2 && !pathBlocked(x, z, NAV.x0 + (a + 0.5) * CS, NAV.z0 + (b + 0.5) * CS)) { bd = d; best = [a, b]; }
  }
  if (!best) return null;
  out.set(NAV.x0 + (best[0] + 0.5) * CS - x, 0, NAV.z0 + (best[1] + 0.5) * CS - z);
  return out.lengthSq() > 1e-6 ? out.normalize() : null;
}
G.__nav = NAV;
