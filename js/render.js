// Renderer, camera, planar floor reflections, scene-captured environment, post-processing
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { G } from './state.js';

// ---- graphics settings (saved in this browser; everything works without storage) ----
export const GFX_PRESETS = {
  low:    { aa: 'fxaa',  ao: 'off',  refl: 'low',  shadows: 'low',  bloom: 'on', scale: '75' },
  medium: { aa: 'msaa4', ao: 'low',  refl: 'low',  shadows: 'high', bloom: 'on', scale: '100' },
  high:   { aa: 'msaa4', ao: 'high', refl: 'high', shadows: 'high', bloom: 'on', scale: '100' },
};
export const GFX = { preset: 'high', ...GFX_PRESETS.high };
const GFX_KEY = 'cleansweep.gfx';
export function loadGfx() {
  try { const s = JSON.parse(localStorage.getItem(GFX_KEY) || 'null'); if (s && typeof s === 'object') { for (const k in GFX) if (typeof s[k] === 'string') GFX[k] = s[k]; return true; } } catch (e) {}
  return false;
}
function saveGfx() { try { localStorage.setItem(GFX_KEY, JSON.stringify(GFX)); } catch (e) {} }
const REFL = { off: 0, low: 0.3, high: 0.5, ultra: 0.75 }, SHADOW = { low: 1024, high: 2048, ultra: 4096 };
function basePixelRatio() { return Math.max(0.5, Math.min(2, Math.min(devicePixelRatio, 1.5) * (+GFX.scale || 100) / 100)); }

// FXAA (after tone mapping), for when MSAA is off
const FXAAShader = {
  uniforms: { tDiffuse: { value: null }, inv: { value: new THREE.Vector2(1 / 1024, 1 / 768) } },
  vertexShader: 'varying vec2 vUv; void main(){vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
  fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 inv; varying vec2 vUv;
    void main(){
      vec3 nw=texture2D(tDiffuse,vUv+vec2(-1.0,-1.0)*inv).rgb, ne=texture2D(tDiffuse,vUv+vec2(1.0,-1.0)*inv).rgb;
      vec3 sw=texture2D(tDiffuse,vUv+vec2(-1.0,1.0)*inv).rgb, se=texture2D(tDiffuse,vUv+vec2(1.0,1.0)*inv).rgb;
      vec4 mC=texture2D(tDiffuse,vUv); vec3 L=vec3(0.299,0.587,0.114);
      float lnw=dot(nw,L), lne=dot(ne,L), lsw=dot(sw,L), lse=dot(se,L), lm=dot(mC.rgb,L);
      float lmin=min(lm,min(min(lnw,lne),min(lsw,lse))), lmax=max(lm,max(max(lnw,lne),max(lsw,lse)));
      vec2 dir=vec2(-((lnw+lne)-(lsw+lse)), (lnw+lsw)-(lne+lse));
      float red=max((lnw+lne+lsw+lse)*(0.25/8.0),1.0/128.0), rcp=1.0/(min(abs(dir.x),abs(dir.y))+red);
      dir=clamp(dir*rcp,vec2(-8.0),vec2(8.0))*inv;
      vec3 a=0.5*(texture2D(tDiffuse,vUv+dir*(1.0/3.0-0.5)).rgb+texture2D(tDiffuse,vUv+dir*(2.0/3.0-0.5)).rgb);
      vec3 b=a*0.5+0.25*(texture2D(tDiffuse,vUv-dir*0.5).rgb+texture2D(tDiffuse,vUv+dir*0.5).rgb);
      float lb=dot(b,L);
      gl_FragColor=vec4((lb<lmin||lb>lmax)?a:b, mC.a);
    }`,
};

export const R = {
  composer: null, gtao: null, bloom: null, reflRT: null, reflCam: new THREE.PerspectiveCamera(),
  reflMatrix: new THREE.Matrix4(), reflScale: 0.5, floor: null, cubeRT: null, envTex: null,
  camTarget: new THREE.Vector3(), camOffset: new THREE.Vector3(6.3, 6.2, 6.3), zoom: 1,
};

export function initRender() {
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
  renderer.setPixelRatio(basePixelRatio());
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  document.getElementById('game').appendChild(renderer.domElement);
  G.renderer = renderer;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1c22);
  G.scene = scene;

  const cam = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 1, 140);
  cam.layers.enable(0);
  G.camera = cam;

  // Planar reflection target (HDR)
  R.reflRT = new THREE.WebGLRenderTarget(16, 16, { type: THREE.HalfFloatType, samples: 0 });
  R.reflRT.texture.generateMipmaps = false;
  R.reflCam.layers.enable(0);

  buildComposer();
  addEventListener('resize', onResize);
  onResize();
}

function buildComposer() {
  const renderer = G.renderer;
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const maxS = renderer.capabilities.maxSamples || 4;
  const samples = GFX.aa === 'msaa8' ? Math.min(8, maxS) : GFX.aa === 'msaa4' ? Math.min(4, maxS) : 0;
  // (stencil: the target outline. Only the scene pass uses depth and stencil, so they're never copied out of the
  // multisampled buffer: resolving stencil is very slow on Windows' D3D backend and was dragging the frame rate down)
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples, stencilBuffer: true, resolveDepthBuffer: false, resolveStencilBuffer: false });
  const composer = new EffectComposer(renderer, rt);
  R.renderPass = new RenderPass(G.scene, G.camera);
  composer.addPass(R.renderPass);
  // keep the HDR image finite before AO and glow: a single overflowed highlight (Inf) would otherwise be blurred
  // across the screen by the bloom and turn whole frames black
  const safe = new ShaderPass({
    uniforms: { tDiffuse: { value: null } },
    vertexShader: 'varying vec2 vUv; void main(){vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
      void main(){ vec4 c=texture2D(tDiffuse,vUv); vec3 v=c.rgb;
        if(any(isnan(v))) v=vec3(0.0);
        v=clamp(v,0.0,48.0); // (clamp also turns +Inf into 48)
        gl_FragColor=vec4(v,isnan(c.a)?1.0:c.a); }`,
  });
  composer.addPass(safe);
  if (GFX.ao !== 'off') {
    const gtao = new GTAOPass(G.scene, G.camera, size.x, size.y);
    gtao.output = GTAOPass.OUTPUT.Default;
    gtao.blendIntensity = 1.0;
    gtao.updateGtaoMaterial({ radius: 0.75, distanceExponent: 1.8, thickness: 1.2, scale: 1.7, samples: GFX.ao === 'high' ? 16 : 8 });
    gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
    // skip glass / particles / fx in the AO gbuffer
    const orig = gtao._overrideVisibility.bind(gtao);
    gtao._overrideVisibility = function () {
      orig();
      G.scene.traverse(o => { if (o.userData.noAO && o.visible) { o.visible = false; this._visibilityCache.push(o); } });
    };
    composer.addPass(gtao);
    R.gtao = gtao;
  } else R.gtao = null;
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.32, 0.55, 0.92);
  composer.addPass(bloom); R.bloom = bloom; bloom.enabled = GFX.bloom !== 'off';
  composer.addPass(new OutputPass());
  // vignette + slight warm grade
  const grade = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, vig: { value: 0.35 }, flash: { value: 0 }, dmg: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader: `uniform sampler2D tDiffuse; uniform float vig; uniform float flash; uniform float dmg; varying vec2 vUv;
      void main(){ vec4 c=texture2D(tDiffuse,vUv); vec2 d=vUv-0.5; float v=1.0-dot(d,d)*vig*2.2;
        c.rgb*=v; c.rgb=mix(c.rgb, c.rgb*vec3(1.04,1.0,0.95), 0.6);
        c.rgb+=flash; float e=smoothstep(0.25,0.75,length(d)); c.rgb=mix(c.rgb, vec3(0.6,0.02,0.02), e*dmg);
        gl_FragColor=c; }`
  });
  composer.addPass(grade); R.grade = grade;
  if (GFX.aa === 'fxaa') { R.fxaa = new ShaderPass(FXAAShader); composer.addPass(R.fxaa); } else R.fxaa = null;
  if (R.composer) R.composer.dispose();
  R.composer = composer;
}

// a whole preset (low / medium / high)
export function setQuality(q, save = true) {
  if (!GFX_PRESETS[q]) return;
  Object.assign(GFX, GFX_PRESETS[q], { preset: q });
  applyGfx(save);
}
// one setting; the preset becomes 'custom' unless the result matches one
export function setGfx(key, value) {
  GFX[key] = value;
  GFX.preset = Object.keys(GFX_PRESETS).find(p => Object.entries(GFX_PRESETS[p]).every(([k, v]) => GFX[k] === v)) || 'custom';
  applyGfx(true);
}
export function shadowSize() { return SHADOW[GFX.shadows] || 2048; }
export function applyGfx(save = true) {
  G.quality = GFX.preset;
  G.renderer.setPixelRatio(basePixelRatio());
  R.reflScale = REFL[GFX.refl] ?? 0.5;
  const sm = shadowSize();
  if (G.sun && G.sun.shadow.mapSize.x !== sm) { G.sun.shadow.mapSize.set(sm, sm); if (G.sun.shadow.map) { G.sun.shadow.map.dispose(); G.sun.shadow.map = null; } }
  buildComposer();
  onResize();
  if (save) saveGfx();
}

function onResize() {
  const r = G.renderer;
  r.setSize(innerWidth, innerHeight);
  G.camera.aspect = innerWidth / innerHeight;
  // keep a consistent view width on narrow screens
  G.camera.fov = innerWidth / innerHeight < 1.2 ? 42 : 30;
  G.camera.updateProjectionMatrix();
  const s = r.getDrawingBufferSize(new THREE.Vector2());
  R.composer.setSize(innerWidth, innerHeight);
  const rs = R.reflScale || 0.05; // (reflections off: keep a tiny target around)
  R.reflRT.setSize(Math.max(16, s.x * rs | 0), Math.max(16, s.y * rs | 0));
  if (R.fxaa) R.fxaa.uniforms.inv.value.set(1 / s.x, 1 / s.y);
}

// Mirror the main camera about the floor plane y=0 and render into reflRT
const _n = new THREE.Vector3(0, 1, 0), _view = new THREE.Vector3(), _look = new THREE.Vector3(), _target = new THREE.Vector3();
const _rot = new THREE.Matrix4(), _plane = new THREE.Plane(), _clip = new THREE.Vector4(), _q = new THREE.Vector4(), _camPos = new THREE.Vector3();
export function renderReflection() {
  const cam = G.camera, rc = R.reflCam;
  _camPos.setFromMatrixPosition(cam.matrixWorld);
  _view.set(_camPos.x, -_camPos.y, _camPos.z);
  _rot.extractRotation(cam.matrixWorld);
  _look.set(0, 0, -1).applyMatrix4(_rot).add(_camPos);
  _target.set(_look.x, -_look.y, _look.z);
  rc.position.copy(_view);
  rc.up.set(0, 1, 0).applyMatrix4(_rot).reflect(_n);
  rc.lookAt(_target);
  rc.far = cam.far; rc.near = cam.near;
  rc.updateMatrixWorld();
  rc.projectionMatrix.copy(cam.projectionMatrix);
  R.reflMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
  R.reflMatrix.multiply(rc.projectionMatrix).multiply(rc.matrixWorldInverse);
  // oblique near plane clipping at y=0.002
  _plane.setFromNormalAndCoplanarPoint(_n, new THREE.Vector3(0, 0.002, 0));
  _plane.applyMatrix4(rc.matrixWorldInverse);
  _clip.set(_plane.normal.x, _plane.normal.y, _plane.normal.z, _plane.constant);
  const pm = rc.projectionMatrix.elements;
  _q.x = (Math.sign(_clip.x) + pm[8]) / pm[0];
  _q.y = (Math.sign(_clip.y) + pm[9]) / pm[5];
  _q.z = -1; _q.w = (1 + pm[10]) / pm[14];
  _clip.multiplyScalar(2 / _clip.dot(_q));
  pm[2] = _clip.x; pm[6] = _clip.y; pm[10] = _clip.z + 1; pm[14] = _clip.w;
  rc.projectionMatrixInverse.copy(rc.projectionMatrix).invert();

  const r = G.renderer;
  const hidden = [];
  G.scene.traverse(o => { if (o.userData.noReflect && o.visible) { o.visible = false; hidden.push(o); } });
  r.setRenderTarget(R.reflRT);
  r.clear();
  r.render(G.scene, rc);
  r.setRenderTarget(null);
  for (const o of hidden) o.visible = true;
}

// One-time environment capture of the finished level (fake 1-bounce GI + local reflections)
// a stand-in (black) environment map of the same size as the real one, so every material is compiled once, in the
// variant the game actually draws with, before the real probe exists
let dummyEnv = null;
export function ensureEnv() {
  if (G.scene.environment) return;
  const pm = new THREE.PMREMGenerator(G.renderer); dummyEnv = pm.fromScene(new THREE.Scene(), 0, 0.1, 1, { size: 256 }); pm.dispose();
  G.scene.environment = dummyEnv.texture;
}
// compile every material of a scene for the composer's HDR target (that's where the game draws, never straight to
// the screen), letting the browser compile them in parallel where it can
export async function compileScene(scene, cam) {
  const r = G.renderer, prev = r.getRenderTarget();
  r.setRenderTarget(R.composer.renderTarget1);
  try { await r.compileAsync(scene, cam); } catch (e) { r.compile(scene, cam); }
  r.setRenderTarget(prev);
}
export function captureEnvironment(pos) {
  const r = G.renderer;
  ensureEnv();
  const cubeRT = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType });
  const cc = new THREE.CubeCamera(0.3, 80, cubeRT);
  cc.layers.enable(1); // ceiling only visible to the probe
  cc.position.copy(pos);
  G.scene.add(cc);
  const hidden = [];
  G.scene.traverse(o => { if (o.userData.noProbe && o.visible) { o.visible = false; hidden.push(o); } });
  const pm = new THREE.PMREMGenerator(r);
  // two bounces: the second capture sees surfaces lit by the first
  for (let b = 0; b < 2; b++) {
    r.shadowMap.needsUpdate = true;
    cc.update(r, G.scene);
    if (R.envTex) R.envTex.dispose();
    R.envTex = pm.fromCubemap(cubeRT.texture).texture;
    G.scene.environment = R.envTex;
  }
  for (const o of hidden) o.visible = true;
  G.scene.remove(cc);
  cubeRT.dispose(); pm.dispose();
  if (dummyEnv) { dummyEnv.dispose(); dummyEnv = null; }
}

const _shake = new THREE.Vector3();
const _lv = new THREE.Vector3(), _lt = new THREE.Vector3();
export function updateCamera(dt) {
  const p = G.player;
  if (!p) return;
  if (G.debugCam) { G.camera.position.copy(G.debugCam[0]); G.camera.lookAt(G.debugCam[1]); G.camera.updateMatrixWorld(); return; }
  if (G.cineCam) { // a cinematic shot (the arrival up the stairs): its own position, target and lens
    const c = G.cineCam; if (!R.fov0) R.fov0 = G.camera.fov;
    if (G.camera.fov !== c.fov) { G.camera.fov = c.fov; G.camera.updateProjectionMatrix(); }
    G.camera.position.copy(c.pos); G.camera.lookAt(c.look); G.camera.updateMatrixWorld(); return;
  }
  if (R.fov0) { G.camera.fov = R.fov0; R.fov0 = 0; G.camera.updateProjectionMatrix(); }
  // leaving: swing round to face the elevator so we see Karim turn and the doors close on him
  if (G.leaving) {
    const e = G.leaving.e, z0 = G.bounds.minZ, k = 1 - Math.exp(-(G.leaving.phase === 'close' ? 1.6 : 2.4) * dt);
    _lv.set(e.x + 0.9, 2.4, z0 + 5.4); _lt.set(e.x, 1.2, z0 - 1.1);
    // as the doors close, ease back and tilt up to the bank's name over the elevators
    if (G.leaving.phase === 'close' || G.leaving.phase === 'gone') { _lv.set(e.x * 0.4 + 0.6, 2.0, z0 + 9.5); _lt.set(e.x * 0.3, 4.0, z0); }
    if (!R.leaveLook) R.leaveLook = R.camTarget.clone();
    G.camera.position.lerp(_lv, k); R.leaveLook.lerp(_lt, k);
    G.camera.lookAt(R.leaveLook); G.camera.updateMatrixWorld(); return;
  }
  const want = (G.camHold || p.pos).clone(); // (camHold: the camera waits somewhere, e.g. for him to come through a door)
  want.y = 0.8;
  // lead toward movement + nearby fight centroid
  if (!G.camHold) { want.x += p.vel.x * 0.18; want.z += p.vel.z * 0.18; }
  let aggro = 0; const cen = new THREE.Vector3();
  for (const e of G.enemies) if (e.aggro && !e.ko && e.pos.distanceTo(p.pos) < 12) { cen.add(e.pos); aggro++; }
  if (aggro) { cen.multiplyScalar(1 / aggro); want.lerp(cen.setY(0.8), 0.25); }
  const zw = (aggro > 2 ? 1.12 : 1.0) * (G.cinematic ? 0.72 : 1) * (G.camZoom || 1);
  R.zoom += (zw - R.zoom) * (1 - Math.exp(-2 * dt));
  if (G.camFocus) { const f = G.camFocus; want.x += (f.x - want.x) * f.w; want.z += (f.z - want.z) * f.w; } // (the tutorial looks at things)
  const cc = G.camClamp || [-12.2, 13.5, -9.8, 9.6]; // (each level keeps the camera over its own floor)
  want.x = Math.max(cc[0], Math.min(cc[1], want.x)); want.z = Math.max(cc[2], Math.min(cc[3], want.z));
  R.camTarget.lerp(want, 1 - Math.exp(-5 * dt));
  const off = R.camOffset.clone().multiplyScalar(R.zoom);
  G.camera.position.copy(R.camTarget).add(off);
  if (G.shake > 0) {
    const s = G.shake * G.shake * 0.35;
    _shake.set((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
    G.camera.position.add(_shake);
    G.shake = Math.max(0, G.shake - dt * 3.5);
  }
  G.camera.lookAt(R.camTarget);
  G.camera.updateMatrixWorld();
}

export function renderFrame(title) {
  const r = G.renderer;
  r.info.autoReset = false; r.info.reset();
  r.shadowMap.needsUpdate = true;
  if (title && title.ready) {
    // the title's white studio: same post chain, minus AO and bloom (the white would bloom over him), lighter vignette
    if (!title.scene.environment) title.scene.environment = G.scene.environment;
    R.renderPass.scene = title.scene; R.renderPass.camera = title.cam;
    if (R.gtao) R.gtao.enabled = false; R.bloom.enabled = false; R.grade.uniforms.vig.value = 0.12;
    R.composer.render();
    R.renderPass.scene = G.scene; R.renderPass.camera = G.camera;
    if (R.gtao) R.gtao.enabled = true; R.bloom.enabled = GFX.bloom !== 'off'; R.grade.uniforms.vig.value = 0.35;
    return;
  }
  if (R.reflScale > 0) renderReflection();
  for (const f of R.floorUs || []) { // (every floor: the basement has concrete and marble)
    f.u.reflMatrix.value.copy(R.reflMatrix);
    f.u.reflStrength.value = R.reflScale > 0 ? f.s0 : 0;
  }
  R.composer.render();
}
