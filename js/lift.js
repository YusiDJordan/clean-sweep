// Between levels: the elevator ride up. Darkness all round, one lit cab, Karim idling in it (one of Yusuf's six
// elevator idles, a different one every ride), elevator music, and the supply menu on the left where his
// upgrades are bought: a new mop handle, more health, more takedowns... each one landing with a beam of light.
import * as THREE from 'three';
import { clone as skClone } from 'three/addons/utils/SkeletonUtils.js';
import { G } from './state.js';
import { L } from './level.js';
import { KARIM_SCALE } from './mixamo.js';
import { buildDisplayMop } from './tools.js';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { UPGRADES, HANDLES, P as PROG, buy, computeStats, levelInfo } from './progress.js';
import { SFX } from './audio.js';

export const LIFT = { scene: null, cam: null, ready: false, bloom: true, vig: 0.5, on: false, t: 0 };
const IDLE_KEY = 'cleansweep.idle';
const $ = id => document.getElementById(id);

// ---------------- icons (24x24, drawn with strokes) ----------------
const ICON = {
  mop: '<path d="M16 3 9.5 14.5"/><path d="M7 13.5l5 3-1.6 2.6c-.6 1-2 1.6-3.2 1.2L5 19.4"/><path d="M6 18l-2 3M8.3 19.4 7 22.5M10.6 19.8 10 23"/>',
  heart: '<path d="M12 20.5s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.7c0 5.6-7.5 10.2-7.5 10.2z"/><path d="M12 10.5v5M9.5 13h5"/>',
  takedown: '<path d="M12 3l3.2 5.6L21 12l-5.8 3.4L12 21l-3.2-5.6L3 12l5.8-3.4z"/><path d="M12 8.5v7M8.5 12h7"/>',
  shoe: '<path d="M3 16.5h16.5a1.5 1.5 0 0 0 1.5-1.5c0-1.6-1.6-2.4-3.4-2.9l-3.6-1-2-3.6H8.5L7.6 9H3z"/><path d="M3 19.5h18M10 10.5l1.5 1.8M12.5 10l1.4 1.8"/>',
  leap: '<path d="M4 18c2.5-8 9-11 15-9"/><path d="M15.5 5.5 19.5 9l-4.3 2.6"/><circle cx="5" cy="19" r="1.4"/>',
  bolt: '<path d="M13 2.5 5.5 13.5H11l-1 8L18.5 10H13z"/>',
};
// an upgrade point: a gold arrow pointing up
export const UPI = '<svg class="upi" viewBox="0 0 24 24"><path d="M12 3.5l7.5 8.5h-4.6v8.5H9.1V12H4.5z" fill="currentColor"/></svg>';
const icon = k => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICON[k] || ''}</svg>`;

// ---------------- the cab ----------------
function brushed(w, h, base = 150) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d');
  x.fillStyle = `rgb(${base},${base},${base + 4})`; x.fillRect(0, 0, w, h);
  for (let i = 0; i < 1400; i++) { const y = Math.random() * h, v = base + (Math.random() - 0.5) * 40; x.fillStyle = `rgba(${v},${v},${v + 4},0.5)`; x.fillRect(0, y, w, 1); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function buildCab(scene) {
  const W = 2.1, D = 1.8, H = 2.55;
  const steel = new THREE.MeshStandardMaterial({ map: brushed(256, 512, 120), color: 0xb9b4aa, metalness: 0.85, roughness: 0.38 });
  const panel = new THREE.MeshStandardMaterial({ color: 0x3a2a20, roughness: 0.55, metalness: 0.1 }); // dark wood panels
  const floorM = new THREE.MeshStandardMaterial({ color: 0x1b1b1e, roughness: 0.35, metalness: 0.2 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xd9b066, metalness: 1, roughness: 0.25 });
  const add = (geo, m, x, y, z, o = {}) => { const me = new THREE.Mesh(geo, m); me.position.set(x, y, z); me.receiveShadow = true; me.castShadow = !!o.cast; scene.add(me); return me; };
  // walls are one-sided planes facing in: seen from outside (the camera, up high like the game's) the near ones vanish
  // and you look down into the cab like a diorama
  const wall = (m, w, h, x, y, z, ry, rx = 0) => { const me = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m); me.position.set(x, y, z); me.rotation.set(rx, ry, 0, 'YXZ'); me.receiveShadow = true; scene.add(me); return me; };
  // a polished floor: a real reflection under a pattern of dark stone tiles (the gloss shows between and through them)
  const fl = new Reflector(new THREE.PlaneGeometry(W, D), { textureWidth: 512, textureHeight: 512, color: 0x4c4a47, clipBias: 0.003 });
  fl.rotation.x = -Math.PI / 2; scene.add(fl); LIFT.reflectors = [fl];
  { const c = document.createElement('canvas'); c.width = c.height = 512; const x = c.getContext('2d');
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) { const v = (i + j) % 2 ? 22 : 34; x.fillStyle = `rgba(${v},${v - 2},${v - 4},0.62)`; x.fillRect(i * 128, j * 128, 128, 128);
      for (let k = 0; k < 40; k++) { x.strokeStyle = `rgba(255,255,255,${0.02 + Math.random() * 0.04})`; x.beginPath(); const sx = i * 128 + Math.random() * 128, sy = j * 128 + Math.random() * 128; x.moveTo(sx, sy); x.lineTo(sx + (Math.random() - 0.5) * 60, sy + (Math.random() - 0.5) * 60); x.stroke(); } }
    x.strokeStyle = 'rgba(200,170,110,0.55)'; x.lineWidth = 3; for (let i = 0; i <= 4; i++) { x.beginPath(); x.moveTo(i * 128, 0); x.lineTo(i * 128, 512); x.moveTo(0, i * 128); x.lineTo(512, i * 128); x.stroke(); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const ov = wall(new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: 0.15, metalness: 0.1, depthWrite: false }), W, D, 0, 0.002, 0, 0, -Math.PI / 2); ov.renderOrder = 1; }
  wall(steel, W, D, 0, H, 0, 0, Math.PI / 2);
  wall(steel, W, H, 0, H / 2, -D / 2, 0);
  wall(steel, D, H, -W / 2, H / 2, 0, Math.PI / 2);
  wall(steel, D, H, W / 2, H / 2, 0, -Math.PI / 2);
  // the doorway's brass threshold
  add(new THREE.BoxGeometry(W - 0.56, 0.02, 0.1), brass, 0, 0.01, D / 2); // threshold
  // the back wall: a big mirror in a brass frame between two wood panels, and a brass handrail
  const mirror = new Reflector(new THREE.PlaneGeometry(1.1, 1.5), { textureWidth: 512, textureHeight: 768, color: 0xb8bcc2, clipBias: 0.003 });
  mirror.position.set(0, 1.42, -D / 2 + 0.03); scene.add(mirror); LIFT.reflectors.push(mirror);
  for (const [w, h, x, y] of [[1.18, 0.04, 0, 2.19], [1.18, 0.04, 0, 0.65], [0.04, 1.58, -0.57, 1.42], [0.04, 1.58, 0.57, 1.42]]) add(new THREE.BoxGeometry(w, h, 0.03), brass, x, y, -D / 2 + 0.035);
  for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.36, 1.6, 0.02), panel, s * 0.82, 1.3, -D / 2 + 0.04);
  const rail = add(new THREE.CylinderGeometry(0.022, 0.022, W - 0.25, 12), brass, 0, 0.95, -D / 2 + 0.12); rail.rotation.z = Math.PI / 2;
  for (const s of [-1, 1]) add(new THREE.CylinderGeometry(0.014, 0.014, 0.1, 8), brass, s * (W / 2 - 0.25), 0.95, -D / 2 + 0.07).rotation.x = Math.PI / 2;
  // the left wall: the button panel (one lit up), a capacity plaque and a warm wall light
  add(new THREE.BoxGeometry(0.02, 0.62, 0.2), steel, -W / 2 + 0.02, 1.25, D / 2 - 0.3);
  { // numbered buttons (B, 1-7): the floor he's heading to is lit
    const c = document.createElement('canvas'); c.width = 128; c.height = 384; const x = c.getContext('2d'), lbl = ['B', '1', '2', '3', '4', '5', '6', '7'];
    x.fillStyle = '#8f8b84'; x.fillRect(0, 0, 128, 384);
    lbl.forEach((t, i) => { const cx = 36 + (i % 2) * 56, cy = 330 - (i >> 1) * 82, on = t === String(LIFT.floorTo || 2);
      if (on) { x.shadowColor = '#ff9a30'; x.shadowBlur = 22; }
      x.fillStyle = on ? '#ffb45a' : '#2a2a2c'; x.beginPath(); x.arc(cx, cy, 20, 0, 6.2832); x.fill(); x.shadowBlur = 0;
      x.strokeStyle = '#d8d2c6'; x.lineWidth = 3; x.stroke();
      x.fillStyle = on ? '#3a1c00' : '#e8e2d6'; x.font = 'bold 22px Oswald, Arial'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(t, cx, cy + 1); });
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    wall(new THREE.MeshStandardMaterial({ map: t, metalness: 0.6, roughness: 0.35, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.25 }), 0.2, 0.6, -W / 2 + 0.032, 1.25, D / 2 - 0.3, Math.PI / 2); }
  { const c = document.createElement('canvas'); c.width = 256; c.height = 96; const x = c.getContext('2d'); x.fillStyle = '#c9a45e'; x.fillRect(0, 0, 256, 96); x.fillStyle = '#2b2214'; x.font = 'bold 22px Oswald, Arial'; x.textAlign = 'center'; x.fillText('NOON BANK', 128, 34); x.font = '18px Oswald, Arial'; x.fillText('CAPACITY 8 PERSONS · 630 KG', 128, 66);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; const pl = wall(new THREE.MeshStandardMaterial({ map: t, metalness: 0.7, roughness: 0.3 }), 0.34, 0.13, -W / 2 + 0.015, 1.62, D / 2 - 0.3, Math.PI / 2); }
  const sconce = add(new THREE.SphereGeometry(0.07, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffd9a0, toneMapped: false }), -W / 2 + 0.03, 1.95, -0.25); sconce.rotation.z = -Math.PI / 2;
  const sl = new THREE.PointLight(0xffc98a, 1.6, 2.5, 2); sl.position.set(-W / 2 + 0.25, 1.95, -0.25); scene.add(sl);
  // a security camera in the corner, and a wet-floor sign
  const cam = add(new THREE.SphereGeometry(0.07, 16, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x111114, roughness: 0.1, metalness: 0.5 }), -W / 2 + 0.12, H - 0.02, -D / 2 + 0.12);
  const yellow = new THREE.MeshStandardMaterial({ color: 0xf2c21b, roughness: 0.45 });
  const sign = new THREE.Group(); sign.position.set(-0.68, 0, 0.45); sign.rotation.y = 0.5; scene.add(sign);
  { const c = document.createElement('canvas'); c.width = 128; c.height = 192; const x = c.getContext('2d'); x.fillStyle = '#f2c21b'; x.fillRect(0, 0, 128, 192); x.fillStyle = '#1a1a1a'; x.font = 'bold 22px Oswald, Arial'; x.textAlign = 'center'; x.fillText('CAUTION', 64, 40); x.font = '17px Oswald, Arial'; x.fillText('WET FLOOR', 64, 66);
    x.beginPath(); x.moveTo(64, 92); x.lineTo(100, 156); x.lineTo(28, 156); x.closePath(); x.lineWidth = 6; x.stroke(); x.fillText('!', 64, 146);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; const sm = new THREE.MeshStandardMaterial({ map: t, roughness: 0.5, side: THREE.DoubleSide });
    for (const s of [-1, 1]) { const pnl = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.5), sm); pnl.position.set(0, 0.24, s * 0.07); pnl.rotation.set(-0.28, s < 0 ? Math.PI : 0, 0, 'YXZ'); /* (an A-frame: tops together, both faces outward and upright) */ pnl.castShadow = true; sign.add(pnl); } }
  // the lit ceiling panel and the little floor display
  const lamp = wall(new THREE.MeshBasicMaterial({ color: 0xfff1d8, toneMapped: false }), 1.2, 0.8, 0, H - 0.01, 0, 0, Math.PI / 2); // (faces down: invisible from up here)
  lamp.material.color.multiplyScalar(2.2);
  for (const r of LIFT.reflectors || []) { const o = r.onBeforeRender; r.onBeforeRender = (...a) => { lamp.visible = false; o.apply(r, a); lamp.visible = true; }; } // (the lamp's glare stays out of the floor and mirror)
  const disp = add(new THREE.BoxGeometry(0.34, 0.14, 0.02), new THREE.MeshBasicMaterial({ color: 0x220a04 }), 0.62, 2.2, -D / 2 + 0.035);
  const c = document.createElement('canvas'); c.width = 128; c.height = 52; LIFT.dispCtx = c.getContext('2d'); LIFT.dispTex = new THREE.CanvasTexture(c);
  add(new THREE.PlaneGeometry(0.32, 0.13), new THREE.MeshBasicMaterial({ map: LIFT.dispTex, toneMapped: false, transparent: true }), 0.62, 2.2, -D / 2 + 0.047);
  // light
  const key = new THREE.SpotLight(0xffe7c4, 9, 6, 0.95, 0.6, 1.6); key.position.set(0, H - 0.05, 0.25); key.target.position.set(0, 0.6, -0.1);
  key.castShadow = true; key.shadow.mapSize.set(1024, 1024); key.shadow.bias = -0.0005; scene.add(key, key.target);
  scene.add(new THREE.HemisphereLight(0xffe8d0, 0x101014, 0.35));
  const rim = new THREE.PointLight(0x9fb4ff, 1.4, 5, 2); rim.position.set(-0.8, 1.9, 1.4); scene.add(rim);
  // the mop, leaning in the corner (its handle shows the upgrade he's bought)
  const mop = buildDisplayMop(); mop.rotation.set(Math.PI, 0, 0.16); mop.position.set(0.86, 0.87 * Math.cos(0.16) + 0.02, -D / 2 + 0.2);
  mop.traverse(o => { if (o.isMesh) { o.castShadow = true; } }); scene.add(mop);
  LIFT.H = H;
}
function drawDisplay(text) {
  const x = LIFT.dispCtx; if (!x) return;
  x.clearRect(0, 0, 128, 52); x.fillStyle = '#ff7a2a'; x.shadowColor = '#ff5a10'; x.shadowBlur = 8;
  x.font = 'bold 34px Oswald, Arial'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(text, 64, 28);
  LIFT.dispTex.needsUpdate = true;
}

// the upgrade 'beam': a cone of light from the ceiling, a ring on the floor and sparks rising round him
function buildFlair(scene) {
  const g = new THREE.CylinderGeometry(0.28, 0.75, LIFT.H, 32, 1, true); g.translate(0, LIFT.H / 2, 0);
  const tex = (() => { const c = document.createElement('canvas'); c.width = 4; c.height = 128; const x = c.getContext('2d'), gr = x.createLinearGradient(0, 0, 0, 128); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = gr; x.fillRect(0, 0, 4, 128); return new THREE.CanvasTexture(c); })();
  const beam = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xffd98a, map: tex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
  beam.position.set(0, 0, 0.05); scene.add(beam);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.42, 48), new THREE.MeshBasicMaterial({ color: 0xffd98a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  const N = 70, pos = new Float32Array(N * 3), pts = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ color: 0xffe2a0, size: 0.045, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  pts.geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3)); scene.add(pts);
  const light = new THREE.PointLight(0xffd48a, 0, 4, 2); light.position.set(0, 1.4, 0.5); scene.add(light);
  LIFT.flair = { beam, ring, pts, light, t: 9, seeds: Array.from({ length: N }, () => [Math.random() * 6.28, 0.25 + Math.random() * 0.4, Math.random(), 0.6 + Math.random() * 1.2]) };
}
function updateFlair(dt) {
  const F = LIFT.flair; if (!F) return;
  F.t += dt; const t = F.t, k = t < 0.15 ? t / 0.15 : Math.max(0, 1 - (t - 0.15) / 1.4);
  F.beam.material.opacity = 0.32 * k; F.beam.scale.set(1 + 0.25 * (1 - k), 1, 1 + 0.25 * (1 - k));
  F.light.intensity = 7 * k;
  F.pts.material.opacity = Math.min(1, k * 1.5);
  const p = F.pts.geometry.attributes.position;
  F.seeds.forEach(([a, r, ph, sp], i) => { const y = ((ph + t * sp * 0.6) % 1) * 2.2; p.setXYZ(i, Math.cos(a + t * 1.5) * r, y, Math.sin(a + t * 1.5) * r + 0.05); });
  p.needsUpdate = true;
  if (LIFT.mats) for (const m of LIFT.mats) m.emissiveIntensity = 0.45 * k;
}

// ---------------- Karim ----------------
async function buildKarim(scene) {
  const kg = L.gltf.Karim; if (!kg) return;
  const k = L.karimClean || skClone(kg.scene), holder = new THREE.Group();
  holder.scale.setScalar(KARIM_SCALE); holder.add(k); scene.add(holder); holder.position.set(-0.12, 0, -0.15);
  holder.visible = false; // (until his idle is playing: never a T-pose)
  LIFT.mats = [];
  k.traverse(o => { if (o.isSkinnedMesh) { const m = new THREE.MeshStandardMaterial({ map: L.karimTex || null, roughness: 0.72, metalness: 0, envMapIntensity: 0.6, emissive: 0xffc870, emissiveIntensity: 0 }); o.material = m; LIFT.mats.push(m); o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
  LIFT.mixer = new THREE.AnimationMixer(k); LIFT.karim = k; LIFT.holder = holder;
  // a different idle every ride
  let n = 0; try { n = (parseInt(localStorage.getItem(IDLE_KEY) || '0', 10) || 0) % 6; localStorage.setItem(IDLE_KEY, String(n + 1)); } catch (e) { n = Math.random() * 6 | 0; }
  { const qi = +new URLSearchParams(location.search).get('idle'); if (qi >= 1 && qi <= 6) n = qi - 1; } // (?idle=N: a given one, for testing)
  LIFT.idle = n + 1;
  // the two wall-leaning idles lean on the button wall, back to it (4: standing against it, 3: sat down against it)
  if (LIFT.idle === 4) { holder.rotation.y = Math.PI / 2; holder.position.set(-0.78, 0, 0.05); }
  if (LIFT.idle === 3) { holder.rotation.y = Math.PI / 2; holder.position.set(-0.47, 0, -0.1); }
  try {
    const json = await (await fetch(`models/ElevIdle${n + 1}.json`)).json();
    const clip = THREE.AnimationClip.parse(json);
    LIFT.mixer.clipAction(clip).play();
  } catch (e) { const c = kg.animations[0]; if (c) LIFT.mixer.clipAction(c).play(); }
  LIFT.mixer.update(0.001); holder.visible = true;
}

export async function initLift() {
  if (LIFT.scene) return;
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x020203); LIFT.scene = scene;
  scene.fog = new THREE.Fog(0x020203, 11, 22);
  LIFT.cam = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.1, 40);
  buildCab(scene); buildFlair(scene);
  await buildKarim(scene);
  drawDisplay('▲ 2');
  LIFT.ready = true;
  frame();
}
function frame() {
  const cam = LIFT.cam, W = innerWidth, H = innerHeight, wide = W / H > 1.15;
  cam.aspect = W / H;
  // Karim on the right, the menu on the left: shift the picture right
  if (wide) cam.setViewOffset(W, H, -W * 0.2, 0, W, H); else cam.clearViewOffset();
  cam.updateProjectionMatrix();
}
addEventListener('resize', () => { if (LIFT.cam) frame(); });

export function updateLift(dt) {
  if (!LIFT.ready) return;
  LIFT.t += dt;
  LIFT.mixer && LIFT.mixer.update(dt);
  // a slow drift of the camera, and the cab humming upwards (a gentle sway)
  const t = LIFT.t, cam = LIFT.cam;
  // up and away, at the game's isometric angle (he's smaller, the cab reads as a little lit box in the dark)
  const a = 0.52 + Math.sin(t * 0.11) * 0.05, r = 8.6;
  cam.position.set(Math.sin(a) * r * 0.72, 6.6 + Math.sin(t * 0.21) * 0.04, Math.cos(a) * r * 0.72 + 0.2);
  cam.lookAt(0, 0.85 + Math.sin(t * 0.9) * 0.004, 0);
  if (LIFT.dbg) { cam.position.copy(LIFT.dbg[0]); cam.lookAt(LIFT.dbg[1]); }
  if (LIFT.shake > 0) { LIFT.shake -= dt; cam.position.x += (Math.random() - 0.5) * LIFT.shake * 0.08; cam.position.y += (Math.random() - 0.5) * LIFT.shake * 0.08; }
  updateFlair(dt);
}

// ---------------- the menu ----------------
function hpRow() {
  const hp = G.ps.hp, ch = G.ps.charges;
  return `<div class="lf-stat"><span class="lf-lab">Health</span><div class="lf-hp" id="lfhp">${Array.from({ length: hp }, (_, i) => `<i class="${i === hp - 1 && LIFT.slam === 'grit' ? 'slam' : ''}"></i>`).join('')}</div></div>
    <div class="lf-stat"><span class="lf-lab">Takedowns</span><div class="lf-td" id="lftd">${Array.from({ length: ch }, (_, i) => `<i class="${i === ch - 1 && LIFT.slam === 'takedown' ? 'slam' : ''}"></i>`).join('')}</div></div>`;
}
function setWallet(points, xp) {
  $('liftpts').innerHTML = UPI + ' ' + points;
  const L = levelInfo(xp); $('liftlvl').textContent = 'Level ' + L.level; $('liftxp').textContent = `${Math.round(L.into)} / ${L.need} XP`;
  $('liftxpfill').style.width = (L.into / L.need * 100).toFixed(1) + '%';
}
function render() {
  const el = $('liftbody'); if (!el) return;
  setWallet(PROG.points, PROG.xp);
  $('liftstat').innerHTML = hpRow();
  el.innerHTML = UPGRADES.map(u => {
    const lv = PROG.lv[u.id] | 0, max = u.cost.length, cost = lv < max ? u.cost[lv] : null, can = cost !== null && PROG.points >= cost;
    const pips = Array.from({ length: max + 1 }, (_, i) => `<i class="${i <= lv ? 'on' : ''}"></i>`).join('');
    const now = u.tiers[lv], next = cost !== null ? u.tiers[lv + 1] : null;
    return `<div class="lf-up ${can ? 'can' : ''} ${cost === null ? 'max' : ''} ${LIFT.flash === u.id ? 'flash' : ''}" data-id="${u.id}">
      <div class="lf-ic ic-${u.icon}">${icon(u.icon)}</div>
      <div class="lf-info"><b>${u.name}</b><span>${u.desc}</span><div class="lf-pips">${pips}</div>
        <small>${now}${next ? ` <em>→ ${next}</em>` : ''}</small></div>
      <button data-buy="${u.id}" ${can ? '' : 'disabled'}>${cost === null ? 'Maxed' : UPI + ' ' + cost}</button></div>`;
  }).join('');
  el.querySelectorAll('[data-buy]').forEach(b => b.addEventListener('click', () => purchase(b.dataset.buy)));
  LIFT.slam = null; LIFT.flash = null;
}
function purchase(id) {
  const u = UPGRADES.find(x => x.id === id);
  if (!buy(id)) return;
  computeStats();
  LIFT.flair.t = 0; // the beam
  if (!SFX.sample('upgrade', 1, 1, 0.1)) SFX.play('perfect'); // (every upgrade: Yusuf's upgrade sound)
  if (u.slam) { // health and takedowns: the new segment slams into place
    LIFT.slam = id; LIFT.shake = 0.45;
    const p = $('liftpanel'); p.classList.remove('slamshake'); void p.offsetWidth; p.classList.add('slamshake');
  }
  if (id === 'power') toast(`New handle: ${HANDLES[PROG.lv.power]}`);
  LIFT.flash = id;
  render();
}
function levelUp() {
  if (!SFX.sample('upgrade', 1, 1, 0.15)) SFX.play('perfect');
  const w = $('liftwallet'); w.classList.remove('lvup'); void w.offsetWidth; w.classList.add('lvup');
  LIFT.flair.t = 0; toast('Level up! +1 upgrade point');
}
function toast(t) { const e = $('lifttoast'); e.textContent = t; e.classList.remove('show'); void e.offsetWidth; e.classList.add('show'); }

// ---------------- the report: every number counted up, then the points earned, then on to the upgrades ----------------
const sleep = ms => new Promise(r => setTimeout(r, LIFT.skip ? 0 : ms));
function tick(k) { // a little counting blip, rising in pitch as the number climbs
  const A = SFX; if (!A.ctx || A.muted || LIFT.skip) return;
  const f = 1100 + k * 900; A.tone(A.ctx.currentTime + 0.003, { f, f2: f, type: 'square', peak: 0.025, a: 0.002, dec: 0.035 });
}
function fmt(r, v) { return (r.prefix || '') + Math.round(v).toLocaleString() + (r.suffix || ''); }
async function countRow(box, r) {
  const el = document.createElement('div'); el.className = 'lf-row ' + (r.cls || '');
  el.innerHTML = `<span>${r.label}</span><b>${fmt(r, 0)}</b>${r.note ? `<small>${r.note}</small>` : ''}`;
  box.appendChild(el); box.scrollTop = box.scrollHeight;
  const b = el.querySelector('b'), dur = r.v ? Math.min(900, 260 + Math.log10(r.v + 1) * 180) : 120;
  const t0 = performance.now(); let lastTick = 0;
  while (!LIFT.skip) {
    const k = Math.min(1, (performance.now() - t0) / dur), e = 1 - Math.pow(1 - k, 3);
    b.textContent = fmt(r, r.v * e);
    if (performance.now() - lastTick > 45 && k < 1 && r.v) { lastTick = performance.now(); tick(e); }
    if (k >= 1) break;
    await new Promise(res => setTimeout(res, 16));
  }
  b.textContent = fmt(r, r.v);
  if (!LIFT.skip) SFX.play(r.cls && r.cls.includes('total') ? 'combo' : 'collect');
  await sleep(r.cls && r.cls.includes('dmg') ? 140 : 230);
}
async function playReport(rep) {
  const P = $('liftpanel'), box = $('liftreport');
  P.classList.add('reporting'); LIFT.skip = false;
  $('liftk').textContent = 'Going up · End of shift'; $('lifth').textContent = rep.title;
  setWallet(rep.before.points, rep.before.xp);
  box.innerHTML = '<div id="liftrows"></div>'; $('liftgrade').className = 'lf-grade';
  P.onclick = e => { if (!e.target.closest('button')) LIFT.skip = true; }; // (click to skip the counting)
  await sleep(500);
  const rows = $('liftrows');
  for (const r of rep.rows) await countRow(rows, r);
  // the grade, stamped
  const g = $('liftgrade'); g.textContent = rep.grade; g.className = 'lf-grade show g' + rep.grade.replace('+', 'p');
  SFX.play('heavy'); LIFT.shake = 0.3; await sleep(700);
  // what it's worth in upgrade points
  const h = document.createElement('h4'); h.className = 'lf-payh'; h.textContent = 'Experience earned'; rows.appendChild(h);
  for (const r of rep.pay) await countRow(rows, { ...r, cls: 'pay ' + (r.cls || '') });
  // the XP bar fills; every level up is an upgrade point (with Yusuf's upgrade sound, slammed into the wallet)
  const x0 = rep.before.xp, x1 = rep.after.xp, t0 = performance.now(), dur = Math.min(2600, 700 + (x1 - x0) * 2.2);
  let lvl = levelInfo(x0).level, pts = rep.before.points;
  while (true) {
    const k = LIFT.skip ? 1 : Math.min(1, (performance.now() - t0) / dur), xp = x0 + (x1 - x0) * k, L = levelInfo(xp);
    if (L.level > lvl) { pts += L.level - lvl; lvl = L.level; levelUp(); }
    setWallet(pts, xp); if (!LIFT.skip) tick(L.into / L.need);
    if (k >= 1) break; await new Promise(res => setTimeout(res, 45));
  }
  setWallet(rep.after.points, rep.after.xp);
  if (rep.ups) { const n = document.createElement('div'); n.className = 'lf-row pay tot'; n.innerHTML = `<span>Upgrade points gained</span><b>${UPI} +${rep.ups}</b>`; rows.appendChild(n); box.scrollTop = box.scrollHeight; }
  SFX.play('perfect');
  LIFT.skip = false; P.onclick = null;
  const go = document.createElement('button'); go.id = 'liftgo'; go.textContent = 'To the upgrades ▸'; rows.appendChild(go); box.scrollTop = box.scrollHeight;
  await new Promise(res => { go.onclick = res; LIFT.goT = setTimeout(res, 4500); });
  clearTimeout(LIFT.goT);
  P.classList.remove('reporting'); $('liftgrade').className = 'lf-grade'; $('liftk').textContent = 'Going up · Supply break'; $('lifth').textContent = 'The Elevator';
  SFX.play('ding'); render();
}

export async function enterLift(onNext, onRetry, report) {
  G.state = 'lift';
  $('hud').classList.remove('show');
  for (const id of ['results', 'dead', 'shop', 'pause', 'lvlcard', 'jobcard', 'banner']) $(id) && $(id).classList.remove('show');
  const bo = $('blackout'); bo.classList.add('on');
  await initLift();
  computeStats();
  $('lift').classList.add('show');
  render();
  if (report) playReport(report);
  $('liftnext').onclick = () => { $('liftnext').textContent = 'Going up…'; SFX.muzak(false); onNext && onNext(); };
  $('liftretry').onclick = () => { $('liftretry').textContent = 'Going down…'; SFX.muzak(false); onRetry && onRetry(); };
  SFX.init(); SFX.muzak(true); SFX.play('ding');
  setTimeout(() => bo.classList.remove('on'), 120);
}
LIFT.render = render; G.__lift = LIFT;
