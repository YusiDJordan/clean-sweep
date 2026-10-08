// Fire doors (Yusuf's model) with the exit sign over them: used by the basement's stairs and the lobby's stairwell.
// The two leaves are one mesh in the model, so they're cut apart and hung on hinges to swing open into the room.
import * as THREE from 'three';
import { G } from './state.js';
import { L, prop2 } from './level.js';
import { SFX } from './audio.js';

// doors centred at x = cx in a north wall whose room-side face is at z = wz; col: the collider that blocks the
// doorway while they're shut. Returns a little controller (open / close / update).
export function fireDoor(cx, wz, col = null, o = {}) {
  const dx = L.dims.FireDoors[0];
  const fd = prop2('FireDoors', cx, wz + dx / 2 - 0.12, Math.PI / 2, { col: false, contact: 0 });
  fd.obj.traverse(m => { if (m.isMesh && /Rear_Doors/.test(m.material.name)) { m.material = m.material.clone(); m.material.color.setHex(0x2e3741); } });
  const leaves = splitDoubleDoor(fd.obj);
  const sign = prop2('ExitSign', cx, wz + 0.1, Math.PI / 2, { y: o.signY ?? 2.5, col: false, contact: 0 });
  exitSignGlow(sign.obj);
  const d = {
    leaves, col, amt: o.open ? 1 : 0, want: o.open ? 1 : 0,
    open(quiet) { if (d.want) return; d.want = 1; if (!quiet) { SFX.play('thud'); SFX.play('heavy'); G.shake = Math.max(G.shake, 0.35); } },
    close() { if (!d.want) return; d.want = 0; setTimeout(() => SFX.play('thud'), 700); },
    update(dt) {
      d.amt += (d.want - d.amt) * (1 - Math.exp(-(d.want ? 7 : 3) * dt));
      const a = d.amt * 1.62; leaves[0].rotation.y = a; leaves[1].rotation.y = -a;
      if (col) col.active = d.amt < 0.6;
    },
  };
  d.update(0);
  return d;
}

// the user's fire doors are one mesh for both leaves: cut it in two (by which side of the centre each triangle is on)
// and hang each half on its own hinge so they can swing open
function splitDoubleDoor(obj) {
  obj.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(obj), cx = (bb.min.x + bb.max.x) / 2, zc = (bb.min.z + bb.max.z) / 2;
  const hinges = [new THREE.Vector3(bb.min.x + 0.02, 0, zc), new THREE.Vector3(bb.max.x - 0.02, 0, zc)];
  const leaves = hinges.map(h => { const g = new THREE.Group(); g.position.copy(h); G.scene.add(g); return g; });
  const meshes = []; obj.traverse(o => { if (o.isMesh) meshes.push(o); });
  for (const o of meshes) {
    const g = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()); g.applyMatrix4(o.matrixWorld);
    const pos = g.attributes.position, n = pos.count / 3, names = Object.keys(g.attributes);
    const parts = [[], []];
    for (let t = 0; t < n; t++) { const mx = (pos.getX(t * 3) + pos.getX(t * 3 + 1) + pos.getX(t * 3 + 2)) / 3; parts[mx < cx ? 0 : 1].push(t); }
    parts.forEach((tris, side) => {
      if (!tris.length) return;
      const ng = new THREE.BufferGeometry();
      for (const nm of names) {
        const a = g.attributes[nm], sz = a.itemSize, arr = new a.array.constructor(tris.length * 3 * sz);
        tris.forEach((t, i) => { for (let v = 0; v < 3; v++) for (let c = 0; c < sz; c++) arr[(i * 3 + v) * sz + c] = a.array[(t * 3 + v) * sz + c]; });
        ng.setAttribute(nm, new THREE.BufferAttribute(arr, sz, a.normalized));
      }
      ng.translate(-hinges[side].x, -hinges[side].y, -hinges[side].z);
      const m = new THREE.Mesh(ng, o.material); m.castShadow = true; m.receiveShadow = true; leaves[side].add(m);
    });
  }
  obj.parent && obj.parent.remove(obj);
  return leaves;
}


export function exitSignGlow(obj) {
  obj.traverse(o => { if (!o.isMesh) return;
    if (/acrylic/.test(o.material.name)) o.material = new THREE.MeshStandardMaterial({ color: 0xd8dde2, transparent: true, opacity: 0.18, roughness: 0.1, depthWrite: false });
    else if (/bagian/.test(o.material.name)) { o.material = o.material.clone(); o.material.emissive = new THREE.Color(0xffffff); o.material.emissiveMap = o.material.map; o.material.emissiveIntensity = 2.2; } });
}
