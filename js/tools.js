// Karim's cleaning tools, kept on his cart: the mop (smudges, prints, rubber marks, blood), an upright vacuum
// (papers, grit, broken glass, dropped rifles... and knocked-out robbers) and a floor polisher (dull, worn patches
// and scratches back to a shine). Walk up to the cart and press 1 / 2 / 3 (or E to cycle).
// Every tool is built in the mop's frame: handle along +Y (grips at the -Y end), the working end towards +Y,
// so all of Karim's poses, swings and the Blender mopping animation work with any of them.
import * as THREE from 'three';
import { G } from './state.js';

export const TOOL_ORDER = ['mop', 'vacuum', 'barrow']; // (the mop also polishes now: no separate polisher)
export const TOOL_LABEL = { mop: 'Mop', vacuum: 'Vacuum', polisher: 'Polisher', barrow: 'Wheelbarrow' };
const HEAD_Y = 0.82; // where the vacuum head / polisher sit on the handle (the floor, in the mopping pose)

const std = (color, rough, metal = 0, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...o });
const phys = (color, rough, o = {}) => new THREE.MeshPhysicalMaterial({ color, roughness: rough, clearcoat: 0.8, clearcoatRoughness: 0.15, ...o });
let MATS = null;
function mats() {
  if (MATS) return MATS;
  MATS = {
    red: phys(0xa8231b, 0.35), blue: phys(0x2a5d8f, 0.32), dark: std(0x1c1d20, 0.65), rubber: std(0x101112, 0.9),
    steel: std(0xc3c8cd, 0.28, 1), chrome: std(0xe6e9ec, 0.12, 1), grey: std(0x5b5f64, 0.5, 0.3),
    bin: new THREE.MeshPhysicalMaterial({ color: 0xb8c4cc, roughness: 0.08, transmission: 0.0, transparent: true, opacity: 0.45, clearcoat: 1 }),
    dust: std(0x8a8176, 1), pad: std(0x2b2b2d, 0.95), wood: std(0xc08a50, 0.6), strands: std(0xe6e0cf, 0.9, 0, { side: THREE.DoubleSide }),
  };
  return MATS;
}
const add = (parent, geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
};

// ---- upright vacuum ----
export function buildVacuum() {
  const M = mats(), g = new THREE.Group(); g.name = 'vacuum';
  add(g, new THREE.CylinderGeometry(0.015, 0.015, 0.6, 10), M.steel, 0, -0.27, 0);                  // handle tube
  add(g, new THREE.CylinderGeometry(0.021, 0.021, 0.16, 12), M.rubber, 0, -0.5, 0);                   // grip
  add(g, new THREE.TorusGeometry(0.055, 0.013, 8, 18, Math.PI), M.dark, 0, -0.58, 0, 0, 0, Math.PI);   // loop handle
  add(g, new THREE.CylinderGeometry(0.02, 0.02, 0.05, 8), M.dark, 0, -0.03, 0);                        // collar
  // body: rounded motor/bag housing with a clear dust bin on the front
  const body = add(g, new THREE.CapsuleGeometry(0.085, 0.3, 6, 16), M.red, 0, 0.24, -0.005);
  body.scale.set(1.15, 1, 0.82);
  add(g, new THREE.CylinderGeometry(0.056, 0.056, 0.2, 18), M.bin, 0, 0.2, 0.072);
  add(g, new THREE.CylinderGeometry(0.05, 0.05, 0.08, 14), M.dust, 0, 0.27, 0.072);
  add(g, new THREE.CylinderGeometry(0.06, 0.06, 0.025, 18), M.dark, 0, 0.09, 0.072);
  add(g, new THREE.BoxGeometry(0.03, 0.05, 0.03), M.dark, 0, 0.02, -0.085);                           // cord hooks
  add(g, new THREE.BoxGeometry(0.03, 0.05, 0.03), M.dark, 0, 0.36, -0.085);
  add(g, new THREE.CylinderGeometry(0.045, 0.055, 0.14, 14), M.dark, 0, 0.5, 0);                      // motor neck
  add(g, new THREE.CylinderGeometry(0.022, 0.022, HEAD_Y - 0.56, 10), M.grey, 0, (0.56 + HEAD_Y) / 2, 0);
  // floor head: stays flat on the floor whatever the handle angle (like the real swivel)
  const head = new THREE.Group(); head.position.y = HEAD_Y; g.add(head);
  add(head, new THREE.BoxGeometry(0.36, 0.055, 0.21), M.dark, 0, -0.07, 0.05);
  add(head, new THREE.BoxGeometry(0.33, 0.04, 0.15), M.red, 0, -0.03, 0.06);
  add(head, new THREE.BoxGeometry(0.34, 0.012, 0.02), M.rubber, 0, -0.095, 0.145);                    // bristle strip
  for (const sx of [-1, 1]) add(head, new THREE.CylinderGeometry(0.03, 0.03, 0.025, 14), M.rubber, sx * 0.15, -0.075, -0.06, 0, 0, Math.PI / 2);
  add(head, new THREE.SphereGeometry(0.035, 12, 8), M.grey, 0, -0.01, -0.04);                          // swivel
  head.userData.hb = 0.1; // pivot to the floor
  g.userData.head = head;
  return g;
}

// ---- floor polisher (rotary buffer) ----
export function buildPolisher() {
  const M = mats(), g = new THREE.Group(); g.name = 'polisher';
  add(g, new THREE.CylinderGeometry(0.018, 0.018, 1.2, 10), M.steel, 0, 0.0, 0);                    // shaft
  add(g, new THREE.CylinderGeometry(0.016, 0.016, 0.44, 10), M.chrome, 0, -0.6, 0, 0, 0, Math.PI / 2); // T-bar
  for (const sx of [-1, 1]) add(g, new THREE.CylinderGeometry(0.022, 0.022, 0.12, 12), M.rubber, sx * 0.17, -0.6, 0, 0, 0, Math.PI / 2);
  add(g, new THREE.BoxGeometry(0.1, 0.05, 0.05), M.dark, 0, -0.55, 0.03);                            // switch box
  add(g, new THREE.BoxGeometry(0.2, 0.012, 0.03), M.dark, 0, -0.57, 0.06);                           // paddle
  add(g, new THREE.CylinderGeometry(0.03, 0.03, 0.08, 10), M.dark, 0, 0.5, 0);                        // yoke
  const head = new THREE.Group(); head.position.y = HEAD_Y; g.add(head);
  add(head, new THREE.CylinderGeometry(0.16, 0.18, 0.14, 28), M.blue, 0, -0.06, 0);                  // motor housing
  add(head, new THREE.SphereGeometry(0.16, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2), M.blue, 0, 0.01, 0).scale.y = 0.45;
  add(head, new THREE.CylinderGeometry(0.235, 0.235, 0.03, 32), M.dark, 0, -0.135, 0);               // skirt
  add(head, new THREE.TorusGeometry(0.236, 0.012, 8, 40), M.rubber, 0, -0.135, 0, Math.PI / 2);     // bumper
  const pad = add(head, new THREE.CylinderGeometry(0.225, 0.225, 0.025, 32), M.pad, 0, -0.163, 0);    // spinning pad
  for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; add(pad, new THREE.BoxGeometry(0.16, 0.004, 0.012), M.grey, Math.cos(a) * 0.1, 0.013, Math.sin(a) * 0.1, 0, -a, 0); }
  for (const sx of [-1, 1]) add(head, new THREE.CylinderGeometry(0.035, 0.035, 0.03, 14), M.rubber, sx * 0.12, -0.12, -0.2, 0, 0, Math.PI / 2);
  head.userData.hb = 0.175; head.userData.pad = pad;
  g.userData.head = head;
  return g;
}

// ---- a plain mop for the cart (the one in his hands has the swinging strands) ----
// the mop's pole: thin blue plastic, a black grip in the middle and black plastic ends (Swiffer-style).
// Along +Y, centred on the origin, length ML; the head end is +Y.
let POLE = null;
export function addMopPole(g, ML) {
  if (!POLE) POLE = {
    blue: new THREE.MeshStandardMaterial({ color: 0x1d62c8, roughness: 0.3, metalness: 0, envMapIntensity: 1.1 }),
    black: new THREE.MeshStandardMaterial({ color: 0x141518, roughness: 0.55, metalness: 0, envMapIntensity: 0.8 }),
    grip: new THREE.MeshStandardMaterial({ color: 0x0e0f11, roughness: 0.85, metalness: 0 }),
  };
  return [
    add(g, new THREE.CylinderGeometry(0.019, 0.019, ML, 12), POLE.blue, 0, 0, 0),
    add(g, new THREE.CylinderGeometry(0.0235, 0.0235, 0.17, 12), POLE.grip, 0, -0.02, 0),       // rubber grip, middle
    add(g, new THREE.CylinderGeometry(0.0245, 0.0215, 0.02, 12), POLE.black, 0, 0.075, 0),      // grip collars
    add(g, new THREE.CylinderGeometry(0.0215, 0.0245, 0.02, 12), POLE.black, 0, -0.115, 0),
    add(g, new THREE.CylinderGeometry(0.023, 0.03, 0.08, 12), POLE.black, 0, ML / 2 + 0.005, 0), // head connector
    add(g, new THREE.CylinderGeometry(0.022, 0.021, 0.035, 12), POLE.black, 0, -ML / 2 + 0.012, 0), // end cap
  ];
}
export function buildDisplayMop() {
  const M = mats(), g = new THREE.Group(); g.name = 'mop';
  addMopPole(g, 1.16);
  const sg = new THREE.CylinderGeometry(0.01, 0.012, 0.25, 6); sg.translate(0, 0.125, 0);
  for (let i = 0; i < 26; i++) { const a = i / 26 * Math.PI * 2, r = 0.012 + (i % 3) * 0.012; const s = add(g, sg, M.strands, Math.cos(a) * r, 0.61, Math.sin(a) * r); s.rotation.set(Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35); }
  return g;
}

// keep a tool's head flat on the floor, facing along the handle
const _up = new THREE.Vector3(0, 1, 0), _f = new THREE.Vector3(), _x = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _pq = new THREE.Quaternion(), _hp = new THREE.Vector3();
export function flattenHead(tool) {
  const head = tool.userData.head; if (!head) return;
  tool.updateMatrixWorld(true);
  _f.set(0, 1, 0).transformDirection(tool.matrixWorld); _f.y = 0;
  if (_f.lengthSq() < 1e-4) _f.set(0, 0, 1).transformDirection(tool.matrixWorld).setY(0);
  _f.normalize(); _x.crossVectors(_up, _f).normalize();
  _m.makeBasis(_x, _up, _f); _q.setFromRotationMatrix(_m);
  head.quaternion.copy(tool.getWorldQuaternion(_pq).invert().multiply(_q));
  // never through the floor
  head.position.set(0, HEAD_Y, 0); head.updateMatrixWorld(true);
  head.getWorldPosition(_hp); const lift = head.userData.hb - _hp.y;
  if (lift > 0) { _hp.y += lift; head.position.copy(tool.worldToLocal(_hp)); }
}

// ---- Karim's set: the rig's own mop parts plus the two machines, toggled ----
export function attachTools(rig) {
  const w = rig.weapon, mopParts = [...w.children];
  const vacuum = buildVacuum(), polisher = buildPolisher();
  for (const t of [vacuum, polisher]) { t.visible = false; t.traverse(o => { if (o.isMesh) o.userData.isChar = true; }); w.add(t); }
  return { mopParts, vacuum, polisher, rig };
}
export function setTool(set, name) {
  for (const o of set.mopParts) o.visible = name === 'mop';
  set.vacuum.visible = name === 'vacuum'; set.polisher.visible = name === 'polisher';
  if (G.cartTools) for (const n of ['mop', 'vacuum']) G.cartTools[n].visible = n !== name;
  if (G.barrow) G.barrow.held = name === 'barrow';
}
// the working end of the held tool, in world space
export function toolHead(set, name, out) {
  if (name === 'mop') return set.rig.weaponPoint(0.6, out);
  const head = set[name].userData.head; head.updateMatrixWorld(true);
  return head.getWorldPosition(out).setY(0);
}

// ---- the three tools on the cart ----
// (cart-local metres: the cart's +x/+z sides face into the lobby)
const SPOTS = { vacuum: [0.98, -0.22, 0.2], polisher: [1.02, 0.42, -0.3], mop: [-0.05, 0.86, 0.15] };
export function buildCartTools() {
  if (!G.cart) return;
  const grp = new THREE.Group(); G.scene.add(grp);
  const tools = { mop: buildDisplayMop(), vacuum: buildVacuum() };
  for (const n of ['mop', 'vacuum']) {
    const t = tools[n], s = SPOTS[n], holder = new THREE.Group();
    holder.position.set(s[0], 0, s[1]); holder.rotation.y = s[2]; grp.add(holder);
    t.rotation.x = Math.PI; // working end down, handle up
    t.position.y = n === 'mop' ? 0.87 : HEAD_Y + t.userData.head.userData.hb;
    holder.add(t);
  }
  G.cartTools = tools; G.cartToolGroup = grp;
  grp.updateMatrixWorld(true);
  updateCartTools();
  flattenHead(tools.vacuum);
  tools.mop.visible = false; // he starts with it
}
export function updateCartTools() {
  const g = G.cartToolGroup, c = G.cart; if (!g || !c) return;
  g.position.set(c.position.x, 0, c.position.z); g.rotation.y = c.rotation.y;
}
export function nearCart(pos, r = 2.1) { return !!G.cart && Math.hypot(pos.x - G.cart.position.x, pos.z - G.cart.position.z) < r; }

// ================= wheelbarrow: collects knocked-out robbers, stacked up in the tray =================
// local frame: +Z towards the wheel, origin on the floor; at rest it stands on its wheel and two legs
const B_AXLE = new THREE.Vector3(0, 0.2, 0.62), B_GRIP = new THREE.Vector3(0, 0.6, -0.95);
function trayGeometry() {
  // tapered open tray: bottom 0.5 x 0.42 at y 0.36, rim 0.86 x 0.7 at y 0.64
  const b = [[-0.21, 0.36, -0.22], [0.21, 0.36, -0.22], [0.21, 0.36, 0.28], [-0.21, 0.36, 0.28]];
  const t = [[-0.35, 0.64, -0.38], [0.35, 0.64, -0.38], [0.35, 0.64, 0.5], [-0.35, 0.64, 0.5]];
  const quads = [[b[0], b[1], b[2], b[3]], [b[0], t[0], t[1], b[1]], [b[1], t[1], t[2], b[2]], [b[2], t[2], t[3], b[3]], [b[3], t[3], t[0], b[0]]];
  const pos = [];
  for (const [a, c, d, e] of quads) pos.push(...a, ...c, ...d, ...a, ...d, ...e);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
  return g;
}
export function buildWheelbarrow() {
  const M = mats(), g = new THREE.Group(); g.name = 'barrow';
  const paint = phys(0x2f6e3c, 0.45), tube = std(0x2b2d30, 0.45, 0.6);
  const tray = add(g, trayGeometry(), new THREE.MeshPhysicalMaterial({ color: 0x2f6e3c, roughness: 0.45, clearcoat: 0.6, side: THREE.DoubleSide }));
  // rim
  const rim = (x0, z0, x1, z1) => { const L = Math.hypot(x1 - x0, z1 - z0); add(g, new THREE.CylinderGeometry(0.016, 0.016, L, 8), tube, (x0 + x1) / 2, 0.645, (z0 + z1) / 2, Math.PI / 2, Math.atan2(x1 - x0, z1 - z0), 0); };
  rim(-0.35, -0.38, 0.35, -0.38); rim(0.35, -0.38, 0.35, 0.5); rim(0.35, 0.5, -0.35, 0.5); rim(-0.35, 0.5, -0.35, -0.38);
  // frame rails running from the wheel fork back to the handles
  for (const sx of [-1, 1]) {
    const a = new THREE.Vector3(sx * 0.1, 0.24, 0.6), c = new THREE.Vector3(sx * 0.29, 0.6, -1.0), d = c.clone().sub(a), L = d.length();
    const rail = add(g, new THREE.CylinderGeometry(0.019, 0.019, L, 10), tube, (a.x + c.x) / 2, (a.y + c.y) / 2, (a.z + c.z) / 2);
    rail.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    add(g, new THREE.CylinderGeometry(0.024, 0.024, 0.16, 12), M.rubber, sx * 0.29, 0.6, -0.95, Math.PI / 2 - 0.22, 0, 0); // grips
    // legs
    const leg = add(g, new THREE.CylinderGeometry(0.016, 0.016, 0.36, 8), tube, sx * 0.17, 0.18, -0.36); leg.rotation.z = sx * 0.12;
    add(g, new THREE.BoxGeometry(0.06, 0.02, 0.08), M.rubber, sx * 0.19, 0.01, -0.36);
  }
  // wheel
  const wheel = new THREE.Group(); wheel.position.copy(B_AXLE); g.add(wheel);
  add(wheel, new THREE.TorusGeometry(0.16, 0.045, 12, 28), M.rubber, 0, 0, 0, 0, Math.PI / 2, 0);
  add(wheel, new THREE.CylinderGeometry(0.12, 0.12, 0.05, 20), std(0xb8bcc0, 0.35, 0.8), 0, 0, 0, 0, 0, Math.PI / 2);
  add(wheel, new THREE.CylinderGeometry(0.012, 0.012, 0.22, 8), tube, 0, 0, 0, 0, 0, Math.PI / 2);
  g.userData.wheel = wheel; g.userData.paint = paint;
  return g;
}
// the barrow object (one in the world): parked at the cart, or pushed by Karim. Holds its load of robbers.
export function buildBarrow() {
  if (!G.cart) return;
  const grp = buildWheelbarrow(); G.scene.add(grp);
  G.barrow = { group: grp, held: false, load: [], pitch: 0, roll: 0 };
  parkBarrow();
}
const _bq = new THREE.Quaternion(), _by = new THREE.Quaternion(), _bp = new THREE.Vector3(), _ax = new THREE.Vector3(1, 0, 0), _yv = new THREE.Vector3(0, 1, 0);
function placeBarrow(axle, yaw, pitch) {
  const g = G.barrow.group;
  _by.setFromAxisAngle(_yv, yaw); _bq.setFromAxisAngle(_ax, pitch); // (positive pitch lifts the handles, tips the tray forward)
  g.quaternion.copy(_by).multiply(_bq);
  // keep the axle where it should be: position = axle - R * B_AXLE
  _bp.copy(B_AXLE).applyQuaternion(g.quaternion); g.position.copy(axle).sub(_bp);
  g.updateMatrixWorld(true);
}
export function parkBarrow() {
  const c = G.cart, b = G.barrow; if (!b || !c) return;
  const spot = new THREE.Vector3(1.15, 0, 1.25).applyAxisAngle(_yv, c.rotation.y).add(c.position); // beside the cart
  placeBarrow(spot.setY(B_AXLE.y), c.rotation.y + Math.PI * 0.25, 0);
}
// pushed: grips at his hands' height just in front of him, the wheel rolling ahead
// pushed: place it so its grips (midpoint) are at `grip` (world), facing `yaw`; the wheel stays on the floor
export function pushBarrow(grip, yaw, speed, dt) {
  const b = G.barrow; if (!b) return;
  const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  const v = B_GRIP.clone().sub(B_AXLE), L = v.length(), a0 = Math.atan2(v.y, -v.z);
  const pitch = Math.asin(Math.max(-0.2, Math.min(0.95, (grip.y - B_AXLE.y) / L))) - a0, horiz = L * Math.cos(a0 + pitch);
  placeBarrow(grip.clone().addScaledVector(fwd, horiz).setY(B_AXLE.y), yaw, pitch);
  if (dt) b.group.userData.wheel.rotation.x += speed * dt / 0.2;
}
// world positions of the two grips (for his hands)
export function barrowGrips(out0, out1) {
  const g = G.barrow.group; g.updateMatrixWorld(true);
  out0.set(0.29, 0.6, -0.95).applyMatrix4(g.matrixWorld); out1.set(-0.29, 0.6, -0.95).applyMatrix4(g.matrixWorld);
}
// where the next thing goes on the pile (barrow-local): robbers are thick, rifles thin
export function barrowSlot(kind) {
  const b = G.barrow; b.stackH = b.stackH || 0; const n = b.load.length;
  const v = new THREE.Vector3((n % 2 ? 0.04 : -0.04), (kind === 'rifle' ? 0.46 : 0.5) + b.stackH, kind === 'rifle' ? 0.02 + ((n * 0.37) % 0.24) - 0.12 : 0.06);
  b.stackH += kind === 'rifle' ? 0.05 : 0.16;
  return v;
}
// a dropped rifle hops onto the pile and rides along
const _rq = new THREE.Quaternion(), _rz = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -Math.PI / 2);
export function loadRifle(obj) {
  const b = G.barrow; if (!b) return;
  const pRel = barrowSlot('rifle'); b.load.push(obj);
  const qRel = new THREE.Quaternion().setFromAxisAngle(_yv, (Math.random() - 0.5) * 0.5).multiply(_rz); // barrel across the tray
  obj.updateMatrixWorld(true);
  (b.hops = b.hops || []).push({ obj, t: 0, p0: obj.getWorldPosition(new THREE.Vector3()), q0: obj.getWorldQuaternion(new THREE.Quaternion()), pRel, qRel });
}
export function updateBarrowHops(dt) {
  const b = G.barrow; if (!b || !b.hops || !b.hops.length) return;
  const g = b.group; g.updateMatrixWorld(true);
  for (let i = b.hops.length - 1; i >= 0; i--) {
    const h = b.hops[i]; h.t += dt; const k = Math.min(1, h.t / 0.32), e = k * k * (3 - 2 * k);
    const pT = h.pRel.clone().applyMatrix4(g.matrixWorld), qT = g.getWorldQuaternion(_rq).multiply(h.qRel);
    if (h.obj.parent !== G.scene) G.scene.attach(h.obj);
    h.obj.position.lerpVectors(h.p0, pT, e); h.obj.position.y += Math.sin(Math.PI * k) * 0.4;
    h.obj.quaternion.slerpQuaternions(h.q0, qT, e);
    if (k >= 1) { g.attach(h.obj); b.hops.splice(i, 1); }
  }
}
export function barrowFront(out) { return out.set(0, 0.45, 0.35).applyMatrix4(G.barrow.group.matrixWorld).setY(0); }
