// The Operations floor boss: "the Contractor". Once every robber on the floor is down, he rides up in the lift,
// steps out and says his piece. He blocks every mop swing (a kick breaks his guard and opens him up for a few
// seconds), and lobs grenades when Karim keeps his distance. Three times a robber's health; his own bar on the HUD.
import * as THREE from 'three';
import { G, rand, resolveCircle, rayBox, canReach } from './state.js';
import { L } from './level.js';
import { SFX } from './audio.js';
import { spark, flash, dirtBlob, disturbPapers, disturbJunk, floatText, tracer } from './fx.js';
import { robberKit } from './robber.js';
import { chairs, knockChair, hitDestructible } from './destruct.js';

const HP = 9;               // (a robber has 3)
const HEIGHT = 1.98;        // a big man in a jump-jet rig
const GUARD_R = 4.2;        // Karim closer than this: guard up
const THROW_R = 6.0;        // Karim further than this: a grenade
const THROW_CD = [3.2, 4.8];
const STUN = 2.8;           // seconds his guard stays broken after a kick
const BLAST_R = 2.7;
const RUN = 3.4;            // he's quick on his feet
const MELEE_R = 2.3;        // Karim this close and not swinging: the rifle butt
const AIM = 0.6, LOCK = 0.22; // half a robber's aim (they take 1.2 s)
const SHOOT_CD = [2.2, 3.6];
const MELEE_SPD = 1.6;      // the butt-stroke, played quicker than authored
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const _v = V(), _v2 = V();

const NUM = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen', 'Twenty'];
const num = n => NUM[n] || String(n);
export const LINES_BOSS = [
  ['What the hell...?', 1.4], [n => `The JANITOR took out ${n} of my men?`, 2.3], ['With a MOP?!', 1.5],
];
const TAUNTS = ['Fetch.', 'Clean THAT up.', 'Wet floor!', 'Catch.', "Here's one for the bin."];
const BLOCKS = ['BLOCKED', 'CLANG!', 'NOPE', 'BLOCKED'];

export class Boss {
  constructor(x, z, yaw) {
    this.isBoss = true; this.name = 'The Contractor';
    this.pos = V(x, 0, z); this.vel = V(); this.yaw = yaw; this.size = 1.1; this.r = 0.42;
    this.hp = HP; this.maxHp = HP; this.ko = false; this.down = false; this.aggro = false; this.group = 99;
    this.state = 'arrive'; this.t = 0; this.threatTime = null; this.burstDodged = false; this.shots = 0;
    this.laser = { visible: false }; this.glint = { visible: false }; this.outline = null;
    this.throwCd = 2.0; this.grenades = []; this.shootCd = 1.5; this.meleeCd = 0.6; this.aimDir = V(0, 0, 1);
    const g = L.gltf.Boss;
    this.root = new THREE.Group(); G.scene.add(this.root);
    const sc = g.scene; this.model = sc; this.root.add(sc);
    sc.traverse(o => { if (o.isMesh) { o.geometry.computeVertexNormals(); o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; o.userData.noProbe = true; if (o.material.map) o.material.map.anisotropy = 8; o.material.color.setScalar(1.35); } }); // (a touch brighter: he reads against the dark lift lobby)
    // scale him to his height (measured off his head bone, standing)
    this.mixer = new THREE.AnimationMixer(sc); this.clips = {};
    for (const c of g.animations) this.clips[c.name] = c;
    // borrowed from the robbers (the same Mixamo skeleton): run, strafe, death (no hip translation: we move him)
    // the robbers' hips track is in their own units: rescale it to his hips (else he sinks to his bind height, half into the floor)
    const hipT = this.clips.Idle.tracks.find(t => t.name.endsWith('Hips.position')), hv = hipT ? hipT.values : [0, 1, 0];
    const ROB_STAND = 0.54, k = hv[1] / ROB_STAND;
    if (L.robberAnims) for (const j of L.robberAnims.clips) {
      const c = THREE.AnimationClip.parse(j); if (!['Run', 'Strafe', 'Death'].includes(c.name)) continue;
      for (const t of c.tracks) if (t.name.endsWith('Hips.position')) { const v = t.values; for (let i = 0; i < v.length; i += 3) { v[i] = hv[0] + v[i] * k; v[i + 1] *= k; v[i + 2] = hv[2] + v[i + 2] * k; } }
      this.clips[c.name] = c;
    }
    this.act = {}; for (const n in this.clips) { const a = this.mixer.clipAction(this.clips[n]); a.play(); a.setEffectiveWeight(0); this.act[n] = a; }
    this.w = {}; for (const n in this.act) this.w[n] = 0; this.w.Idle = 1;
    this.act.Death.setLoop(THREE.LoopOnce); this.act.Death.clampWhenFinished = true;
    this.act.Idle.setEffectiveWeight(1); this.mixer.update(0); sc.updateMatrixWorld(true);
    let head = null; sc.traverse(o => { if (o.isBone && /Head$/.test(o.name)) head = o; this.hand = this.hand || (o.isBone && /RightHand$/.test(o.name) ? o : null); this.handL = this.handL || (o.isBone && /LeftHand$/.test(o.name) ? o : null); this.spine = this.spine || (o.isBone && /Spine2$/.test(o.name) ? o : null); });
    const hy = head ? head.getWorldPosition(V()).y : 1; sc.scale.multiplyScalar(HEIGHT * 0.9 / hy);
    this.rig = { root: this.root, chest: head || this.root }; // (what the rest of the game reaches for)
    this.blob = new THREE.Mesh(new THREE.CircleGeometry(0.55, 24), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }));
    this.buildRifle(); this.buildReticle();
    this.blob.rotation.x = -Math.PI / 2; this.blob.position.y = 0.012; this.blob.userData.noAO = true; this.blob.userData.noReflect = true; this.root.add(this.blob);
    this.sync();
  }
  get guarding() { return this.state === 'guard'; }
  alert() { this.aggro = true; }
  releaseToken() { G.attackers && G.attackers.delete(this); }

  // ----- what Karim's moves do to him -----
  // a mop strike: blocked unless his guard is broken. Returns true if it was blocked (no damage, Karim rebounds)
  blockHit(dir) {
    if (this.ko || this.state === 'stunned') return false;
    if (['throw', 'melee', 'aim', 'fire'].includes(this.state)) { // (caught mid-attack: it lands, and he snaps his guard back up)
      this.interrupt = true; return false;
    }
    this.face(G.player.pos); this.setState('guard'); this.guardT = 1.0; this.blockFlash = 0.25;
    if ((this.blockRun = (this.blockRun || 0) + 1) >= 2) { this.blockRun = 0; this.counter = true; } // (twice into his guard: he answers with the butt)
    const p = this.pos.clone().addScaledVector(dir, -0.45).setY(1.35);
    spark(p.x, p.y, p.z, 14, 0xffd890, 6, 0.22, 0.09); flash(p.x, p.y, p.z, 1.1, 0xfff0c0, 0.06);
    SFX.play('smash', 0.55); SFX.play('hit', 0.7);
    if (!this.blockMsgT || G.time - this.blockMsgT > 0.6) { floatText(BLOCKS[Math.random() * BLOCKS.length | 0], p.clone().setY(2.3), 'onoma', 0.6); this.blockMsgT = G.time; }
    G.hitstop = Math.max(G.hitstop, 0.05); G.shake = Math.max(G.shake, 0.25);
    const P = G.player; P.vel.addScaledVector(dir, 3.2); // (the mop bounces off him)
    if (!this.hintShown && (this.blocked = (this.blocked || 0) + 1) >= 2) { this.hintShown = true; floatText('KICK HIM (right click) TO BREAK HIS GUARD', P.pos.clone().setY(2.6), 'special', 2.2); }
    return true;
  }
  // a kick: breaks his guard (and staggers him back); a kick on an open boss just shoves him
  kicked(dir) {
    if (this.ko) return;
    this.hp -= 0.25 * G.ps.power;
    if (this.hp <= 0.001) { this.knockout(dir, 6); return; }
    this.vel.copy(dir).multiplyScalar(4.5);
    if (this.state !== 'stunned') { floatText('GUARD BROKEN!', this.pos.clone().setY(2.5), 'special', 1.0); SFX.play('heavy', 0.8); }
    this.setState('stunned'); this.stunT = STUN; this.openHits = 0; this.blockRun = 0;
  }
  stagger(dir, kb) { // a hit that landed (guard down)
    if (this.ko) return;
    this.vel.copy(dir).multiplyScalar(Math.min(2.2, kb * 0.45));
    this.flinch = 0.18;
    if (this.interrupt) { this.interrupt = false; this.endAttack(); this.setState('guard'); this.guardT = 1.2; return; }
    if (this.state === 'stunned' && ++this.openHits >= 3) { this.stunT = 0; this.setState('guard'); this.guardT = 1.2; floatText('GUARD UP', this.pos.clone().setY(2.5), 'onoma', 0.8); } // (three hits, then kick him open again)
  }
  trip(dir) { if (!this.ko) this.vel.copy(dir).multiplyScalar(1.2); } // (too heavy to bowl over)
  takedown(dir) { // he's immune to Mop Takedowns: shrugs it off and squares up
    if (this.ko) return;
    this.vel.copy(dir).multiplyScalar(2.5); this.flinch = 0.15;
    if (this.state !== 'throw' && this.state !== 'melee') { this.face(G.player.pos); this.setState('guard'); this.guardT = 1.0; }
    spark(this.pos.x, 1.4, this.pos.z, 10, 0xffe0a0, 3, 0.25); SFX.play('smash', 0.8);
    floatText('IMMUNE', this.pos.clone().setY(2.5), 'special', 1.0);
  }
  knockout(dir) {
    if (this.ko) return;
    this.ko = true; this.down = true; this.hp = 0; this.releaseToken();
    G.stats.kos++; SFX.play('ko'); G.slowmo(1.1, 0.25); G.cinematic = 0.9; G.shake = 1.0;
    this.vel.copy(dir).multiplyScalar(1.5); this.dieYaw = Math.atan2(-dir.x, -dir.z);
    this.setState('dead');
    floatText('CONTRACT TERMINATED', this.pos.clone().setY(2.6), 'special', 2.0);
    G.onKO && G.onKO(this);
  }
  loadInto() {} // (he doesn't fit in the wheelbarrow)

  // ----- brain -----
  setState(s) { if (this.state !== s) { this.state = s; this.t = 0; } }
  face(p, k = 1) { const a = Math.atan2(p.x - this.pos.x, p.z - this.pos.z); let d = a - this.yaw; d -= Math.round(d / (Math.PI * 2)) * Math.PI * 2; this.yaw += d * k; }
  update(dt) {
    this.t += dt; const P = G.player, to = _v.copy(P.pos).sub(this.pos).setY(0), dist = to.length();
    const sel = {}; let speed = 0;
    this.throwCd -= dt; this.shootCd -= dt; this.meleeCd -= dt; if (!['aim', 'fire', 'melee'].includes(this.state)) this.threatTime = null; if (this.blockFlash) this.blockFlash = Math.max(0, this.blockFlash - dt); if (this.flinch) this.flinch = Math.max(0, this.flinch - dt);
    switch (this.state) {
      case 'arrive': sel.Idle = 1; break; // (in the cab: the intro moves him)
      case 'walkout': sel.Run = 1; speed = 2.6; this.face(G.bossOut, 1); this.vel.copy(_v2.copy(G.bossOut).sub(this.pos).setY(0).normalize()).multiplyScalar(speed); break;
      case 'talk': sel.Idle = 1; this.vel.set(0, 0, 0); this.face(P.pos, Math.min(1, dt * 4)); break;
      case 'fight': case 'guard': {
        this.face(P.pos, Math.min(1, dt * 7));
        if (P.state === 'dead') { sel.Idle = 1; this.vel.multiplyScalar(0.8); break; }
        // he only puts his guard up when Karim swings at him (and holds it a moment after)
        const swinging = dist < GUARD_R + 0.8 && (P.state === 'attack' || P.state === 'special');
        if (swinging) this.guardT = 1.0; else this.guardT = Math.max(0, (this.guardT || 0) - dt);
        if (this.opener) { this.opener = false; this.setState('throw'); this.thrown = false; this.vel.set(0, 0, 0); break; } // (he always opens with a grenade)
        if (this.counter) { this.counter = false; if (dist < MELEE_R + 0.6 && canReach(this.pos, P.pos)) { this.setState('melee'); this.meleeDone = false; this.vel.set(0, 0, 0); this.guardT = 0; break; } }
        if (this.guardT > 0 && dist < GUARD_R) { if (this.state !== 'guard') this.setState('guard'); sel.Block = 1; this.vel.set(0, 0, 0); break; }
        if (this.state !== 'fight') this.setState('fight');
        const los = this.hasLOS(P.pos);
        if (dist < MELEE_R && this.meleeCd <= 0 && canReach(this.pos, P.pos)) { this.setState('melee'); this.meleeDone = false; this.vel.set(0, 0, 0); break; }
        if (dist > THROW_R && this.throwCd <= 0 && los && (this.shootCd > 0 || Math.random() < 0.5)) { this.setState('throw'); this.thrown = false; break; }
        if (dist > MELEE_R + 0.6 && dist < 11 && this.shootCd <= 0 && los) { this.setState('aim'); this.aimDir.copy(to).normalize(); this.burstDodged = false; SFX.play('aim'); break; }
        if (dist > 1.7) { sel.Run = 1; speed = RUN; this.vel.copy(to).normalize().multiplyScalar(speed); } // (closing in for the butt-stroke)
        else { sel.Idle = 1; this.vel.set(0, 0, 0); }
        break;
      }
      case 'melee': { // the rifle butt: wind up, drive it in at ~0.6 s
        sel.RifleMelee = 1; this.vel.multiplyScalar(Math.exp(-10 * dt)); if (this.t < 0.28) this.face(P.pos, Math.min(1, dt * 10));
        const HIT = 0.6 / MELEE_SPD; this.threatTime = this.t < HIT ? HIT - this.t : null;
        if (!this.meleeDone && this.t >= HIT) {
          this.meleeDone = true;
          const f = V(Math.sin(this.yaw), 0, Math.cos(this.yaw));
          if (dist < MELEE_R + 0.2 && f.dot(_v2.copy(to).normalize()) > 0.35 && canReach(this.pos, P.pos)) { if (P.hurt(1, _v2.clone(), this)) { SFX.play('heavy'); spark(P.pos.x, 1.3, P.pos.z, 10, 0xffffff, 3, 0.2); P.vel.addScaledVector(_v2, 5); } }
          else SFX.play('whoosh', 0.9);
        }
        if (this.t >= (this.clips.RifleMelee.duration - 0.3) / MELEE_SPD) this.endAttack();
        break;
      }
      case 'aim': { // half a robber's aim time, and a nastier reticle
        sel.Shoot = 1; this.vel.multiplyScalar(Math.exp(-10 * dt));
        const locked = this.t > AIM - LOCK;
        if (!locked) { const a0 = Math.atan2(this.aimDir.x, this.aimDir.z), a1 = Math.atan2(to.x, to.z); let d = a1 - a0; d -= Math.round(d / (Math.PI * 2)) * Math.PI * 2; const na = a0 + THREE.MathUtils.clamp(d, -5 * dt, 5 * dt); this.aimDir.set(Math.sin(na), 0, Math.cos(na)); }
        else if (!this.lockBeep) { this.lockBeep = true; SFX.play('aim'); if (P.state !== 'dodge') floatText('ROLL!', P.pos.clone().setY(2.3), 'cost', 0.5); }
        this.yaw = Math.atan2(this.aimDir.x, this.aimDir.z);
        this.threatTime = AIM - this.t + 0.05;
        if (this.t >= AIM) { this.setState('fire'); this.shots = 0; this.lockBeep = false; }
        break;
      }
      case 'fire': {
        sel.Shoot = 1; this.threatTime = this.shots < 3 ? 0.02 : null;
        while (this.shots < 3 && this.t >= this.shots * 0.08) { this.fire(); this.shots++; }
        if (this.t > 3 * 0.08 + 0.3) this.endAttack();
        break;
      }
      case 'throw': {
        sel.Grenade = 1; this.vel.multiplyScalar(Math.exp(-8 * dt)); this.face(P.pos, Math.min(1, dt * 8));
        if (!this.thrown && this.t >= 1.23) { this.thrown = true; this.throwGrenade(); this.shootCd = Math.max(this.shootCd, 1.25 + 2.0); } // (no shooting until 2 s after it's gone off)
        if (this.t >= this.clips.Grenade.duration - 0.05) { this.throwCd = rand(...THROW_CD); this.setState('fight'); }
        break;
      }
      case 'stunned': {
        sel.Block = 1; this.vel.multiplyScalar(Math.exp(-5 * dt)); this.stunT -= dt;
        if (this.stunT <= 0 && this.state === 'stunned') { this.setState('fight'); this.throwCd = Math.min(this.throwCd, 1.0); }
        break;
      }
      case 'dead': this.reticle.visible = false; sel.Death = 1; this.vel.multiplyScalar(Math.exp(-4 * dt)); break;
    }
    // move (walls and furniture stop him)
    this.pos.addScaledVector(this.vel, dt); resolveCircle(this.pos, this.r);
    if (this.state === 'dead' && this.dieYaw !== undefined) this.yaw = this.dieYaw;
    this.animate(dt, sel, speed);
    this.updateGrenades(dt);
    this.sync();
  }
  hasLOS(to) { const o = V(this.pos.x, 1.4, this.pos.z), d = V(to.x, 1.2, to.z).sub(o), L0 = d.length(); d.normalize(); for (const b of G.colliders) { if (!b.active || b.y1 < 1.3) continue; const r = rayBox(b, o, d, L0); if (r > 0 && r < L0 - 0.5) return false; } return true; }
  animate(dt, sel, speed) {
    const k = 1 - Math.exp(-9 * dt);
    let sum = 0; for (const n in this.w) { this.w[n] += ((sel[n] || 0) - this.w[n]) * (n === 'Death' && sel.Death ? 1 : k); sum += this.w[n]; }
    for (const n in this.w) this.act[n].setEffectiveWeight(sum > 0 ? this.w[n] / sum : 0);
    const B = this.act.Block; B.timeScale = 0; // the guard: raise it and hold it (0.4 s in is fully up); broken: let it drop
    B.time = this.state === 'stunned' ? Math.min(0.9, 0.55 + (STUN - this.stunT) * 0.5) : Math.min(0.4, (this.state === 'guard' ? this.t : 0) * 1.6 + 0.2) - (this.blockFlash || 0) * 0.3;
    const Me = this.act.RifleMelee; Me.timeScale = 0; Me.time = this.state === 'melee' ? Math.min(this.t * MELEE_SPD, this.clips.RifleMelee.duration - 1e-3) : 0;
    const Sh = this.act.Shoot; Sh.timeScale = 0; Sh.time = this.state === 'fire' ? (this.t * 1.6) % this.clips.Shoot.duration : 0;
    const Gr = this.act.Grenade; Gr.timeScale = 0; Gr.time = this.state === 'throw' ? Math.min(this.t, this.clips.Grenade.duration - 1e-3) : 0;
    const D = this.act.Death; D.timeScale = 0; D.time = this.state === 'dead' ? Math.min(this.t * 0.9, this.clips.Death.duration - 1e-3) : 0;
    this.act.Run.timeScale = Math.max(0.8, speed / 2.4); this.act.Idle.timeScale = 1;
    this.mixer.update(dt);
    this.placeRifle(); this.updateReticle(dt);
  }
  sync() { this.root.position.copy(this.pos); this.root.rotation.y = this.yaw + (this.flinch ? Math.sin(this.flinch * 40) * 0.06 : 0); }

  endAttack() { this.threatTime = null; this.reticle.visible = false; if (this.state === 'melee') this.meleeCd = rand(0.9, 1.5); if (this.state === 'aim' || this.state === 'fire') this.shootCd = rand(...SHOOT_CD); if (!this.ko) this.setState('fight'); }
  // ----- the rifle: the robbers' one, laid from his right hand to his left; out only when he's using it -----
  buildRifle() {
    const R = robberKit(); this.rifle = new THREE.Group(); G.scene.add(this.rifle); this.rifle.visible = false;
    if (!R) return;
    const m = new THREE.Mesh(R.rgeo, R.rmat); m.matrixAutoUpdate = false; m.matrix.copy(R.rifleLocal); m.castShadow = true; this.rifle.add(m);
    this.gripDir = R.gripL.clone().normalize(); this.gripLen = R.gripL.length(); this.muzzle = R.muzzle.clone();
    this.upL = V(0, 1, 0).applyQuaternion(new THREE.Quaternion().setFromRotationMatrix(R.rifleLocal)).normalize(); // (the rifle's own up: where the world's up was when the robbers held it)
  }
  orientRifle(d, wantUp) { // barrel (hand to hand) along d, then rolled about it so the rifle's own up (sights) faces wantUp
    const q = new THREE.Quaternion().setFromUnitVectors(this.gripDir, d);
    const up = this.upL.clone().applyQuaternion(q), want = wantUp.clone().addScaledVector(d, -wantUp.dot(d)).normalize();
    q.premultiply(new THREE.Quaternion().setFromAxisAngle(d, Math.atan2(up.clone().cross(want).dot(d), up.dot(want))));
    return q;
  }
  placeRifle() {
    this.rifle.visible = !!this.gripDir && this.root.visible && !(this.ko && this.t > 0.3);
    if (!this.rifle.visible) return;
    this.model.updateMatrixWorld(true);
    const f = V(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    if (this.state === 'throw') { // slung across his back while his hand is busy with the grenade
      const c = (this.spine || this.rig.chest).getWorldPosition(V()), r = V(-f.z, 0, f.x);
      const d = V(0, 1, 0).addScaledVector(r, -0.55).normalize();
      this.rifle.quaternion.copy(this.orientRifle(d, f.clone().negate()));
      this.rifle.position.copy(c).addScaledVector(f, -0.24).addScaledVector(d, -0.35); this.rifle.updateMatrixWorld(true);
      return;
    }
    const a = this.hand.getWorldPosition(V()), b = this.handL.getWorldPosition(V()), d = b.clone().sub(a);
    if (this.state === 'aim' || this.state === 'fire') d.copy(this.aimDir).setY(-0.02); // (aiming: the barrel follows his aim)
    else if (d.length() < 0.12) d.copy(f); // (hands together: carry it pointing ahead)
    d.normalize();
    this.rifle.quaternion.copy(this.orientRifle(d, V(0, 1, 0)));
    this.rifle.position.copy(a); this.rifle.updateMatrixWorld(true);
  }
  fire() {
    const P = G.player, o = this.rifle.localToWorld(this.muzzle.clone()), tgt = P.pos.clone().setY(1.1);
    // the burst goes where he locked on: a roll (or stepping off the line) and it misses
    const along = _v.copy(tgt).sub(o); const dir = this.aimDir.clone().setY(along.y / Math.max(0.5, along.clone().setY(0).length())).normalize();
    const t = Math.max(0, along.dot(dir)), miss = tgt.distanceTo(o.clone().addScaledVector(dir, t));
    const end = o.clone().addScaledVector(dir, miss < 0.55 ? t : 14);
    tracer(o, end); flash(o.x, o.y, o.z, 1.0, 0xffc060, 0.05); SFX.play('gun', 0.9); G.muzzleLight && G.muzzleLight(o);
    if (miss < 0.55 && !this.burstDodged && P.hurt(1, dir.clone().setY(0).normalize(), this)) spark(tgt.x, tgt.y, tgt.z, 8, 0xffffff, 3, 0.2);
  }
  // ----- his reticle on Karim: red, toothed, closing in fast -----
  buildReticle() {
    const g = new THREE.Group(); g.visible = false;
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 0.0, 0.0), transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }); // (over 1: it blooms)
    { const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d'), gr = x.createRadialGradient(64, 64, 20, 64, 64, 64); gr.addColorStop(0, 'rgba(255,0,0,0)'); gr.addColorStop(0.62, 'rgba(255,0,0,0.55)'); gr.addColorStop(0.75, 'rgba(255,0,0,0.25)'); gr.addColorStop(1, 'rgba(255,0,0,0)'); x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
      this.glowMat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending });
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4), this.glowMat); glow.position.z = -0.01; g.add(glow); } // (a red halo on the floor under it)
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.7, 48), mat); g.add(ring);
    const teeth = new THREE.Group(); g.add(teeth);
    for (let i = 0; i < 8; i++) { const s = new THREE.Shape(); s.moveTo(-0.07, 0); s.lineTo(0.07, 0); s.lineTo(0, -0.22); s.closePath(); const m = new THREE.Mesh(new THREE.ShapeGeometry(s), mat); const a = i / 8 * Math.PI * 2; m.position.set(Math.sin(a) * 0.95, Math.cos(a) * 0.95, 0); m.rotation.z = -a; teeth.add(m); }
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.09, 20), mat); g.add(dot);
    g.rotation.x = -Math.PI / 2; g.traverse(o => { o.userData.noAO = true; o.userData.noReflect = true; o.userData.noProbe = true; });
    G.scene.add(g); this.reticle = g; this.reticleTeeth = teeth; this.reticleMat = mat;
  }
  updateReticle(dt) {
    const on = (this.state === 'aim' || this.state === 'fire') && !this.burstDodged; this.reticle.visible = on && !this.ko; // (rolled out of it: gone at once) if (!on) return;
    const P = G.player, u = this.state === 'aim' ? Math.min(1, this.t / AIM) : 1;
    this.reticle.position.set(P.pos.x, 0.04, P.pos.z);
    this.reticleTeeth.scale.setScalar(1.6 - 0.75 * u); this.reticleTeeth.rotation.z += dt * (4 + 10 * u);
    const k = 0.75 + 0.25 * u + 0.15 * Math.sin(G.time * 18); // (a steady red glow, pulsing a little brighter as he locks on)
    this.reticleMat.color.setRGB(1.6 * k, 0, 0); this.reticleMat.opacity = 0.8 + 0.2 * u; this.glowMat.opacity = 0.35 + 0.35 * u;
  }

  // ----- grenades -----
  throwGrenade() {
    const P = G.player; this.hand.updateMatrixWorld(true);
    const from = this.hand.getWorldPosition(V()); from.y = Math.max(from.y, 1.6);
    const aim = P.pos.clone().addScaledVector(P.vel, 0.45).setY(0.08); // (a little ahead of him)
    const T = THREE.MathUtils.clamp(_v2.copy(aim).sub(from).setY(0).length() / 9, 0.55, 1.1), g = 13;
    const vel = aim.clone().sub(from).divideScalar(T); vel.y = (aim.y - from.y + 0.5 * g * T * T) / T;
    const m = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.0375, 14, 10), new THREE.MeshStandardMaterial({ color: 0x3a4630, roughness: 0.55, metalness: 0.3 })); body.scale.set(1, 1.25, 1); body.castShadow = true; m.add(body);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.0175, 0.025, 10), new THREE.MeshStandardMaterial({ color: 0x8a8c90, metalness: 0.9, roughness: 0.3 })); cap.position.y = 0.0525; m.add(cap);
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.3, 0.2), toneMapped: false })); led.position.set(0, 0.03, 0.03); m.add(led);
    const ring = new THREE.Mesh(new THREE.RingGeometry(BLAST_R - 0.12, BLAST_R, 48), new THREE.MeshBasicMaterial({ color: 0xff3020, transparent: true, opacity: 0, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending }));
    ring.rotation.x = -Math.PI / 2; ring.userData.noAO = true; ring.userData.noReflect = true; G.scene.add(ring);
    m.position.copy(from); m.traverse(o => { o.userData.noProbe = true; }); G.scene.add(m);
    this.grenades.push({ m, led, ring, vel, fuse: T + 1.25, spin: V(rand(-9, 9), rand(-9, 9), rand(-9, 9)), landed: false });
    SFX.play('whoosh', 0.9);
    if (Math.random() < 0.6) { G.say && G.say(this, TAUNTS[Math.random() * TAUNTS.length | 0], 1.4); }
  }
  updateGrenades(dt) {
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const n = this.grenades[i], p = n.m.position;
      n.fuse -= dt;
      n.vel.y -= 13 * dt; p.addScaledVector(n.vel, dt);
      if (p.y < 0.045) { p.y = 0.045; if (n.vel.y < -1.5) SFX.play('thud', 0.5); n.vel.y = Math.abs(n.vel.y) * 0.3; n.vel.x *= 0.55; n.vel.z *= 0.55; n.landed = true; }
      const hit = resolveCircle(p, 0.05); if (hit) { const vn = n.vel.x * hit._nx + n.vel.z * hit._nz; if (vn < 0) { n.vel.x -= 1.6 * vn * hit._nx; n.vel.z -= 1.6 * vn * hit._nz; } }
      n.m.rotation.x += n.spin.x * dt * (n.landed ? 0.3 : 1); n.m.rotation.z += n.spin.z * dt * (n.landed ? 0.3 : 1);
      // warning: the light blinks faster as the fuse runs down; a red ring shows the blast
      const rate = n.fuse < 0.5 ? 16 : n.fuse < 1 ? 9 : 5; n.led.visible = Math.sin(G.time * rate * Math.PI) > 0;
      n.ring.position.set(p.x, 0.02, p.z); n.ring.material.opacity = n.landed ? 0.35 + 0.45 * (n.led.visible ? 1 : 0.3) : 0.15;
      if (n.fuse <= 0) { this.explode(p.clone()); G.scene.remove(n.m); G.scene.remove(n.ring); this.grenades.splice(i, 1); }
    }
  }
  explode(at) {
    const x = at.x, z = at.z;
    SFX.play('heavy', 1.4); SFX.play('smash', 1); SFX.play('shatter', 0.5);
    G.shake = Math.max(G.shake, 1.25); G.hitstop = Math.max(G.hitstop, 0.06);
    flash(x, 0.6, z, 5.5, 0xffc070, 0.14); flash(x, 0.5, z, 3, 0xffffff, 0.06);
    spark(x, 0.4, z, 70, 0xffb050, 11, 0.45, 0.14); spark(x, 0.3, z, 30, 0xffffff, 7, 0.25, 0.08);
    G.muzzleLight && G.muzzleLight(at.clone().setY(0.8));
    // soot: a scorched star on the floor (it mops up like any other dirt)
    dirtBlob(x, z, 0.95, '14,12,11', 0.92, 1.0); dirtBlob(x, z, 0.55, '6,5,5', 0.95, 0.6);
    for (let i = 0; i < 9; i++) { const a = rand(0, 6.283), r = rand(0.6, 1.6); dirtBlob(x + Math.cos(a) * r, z + Math.sin(a) * r, rand(0.15, 0.32), '20,18,16', rand(0.5, 0.8), 1.4); }
    // the blast: Karim (unless he's mid-roll), the furniture, the paperwork, the glass
    const P = G.player, d = _v.copy(P.pos).sub(at).setY(0), dl = d.length();
    if (dl < BLAST_R) {
      const dir = dl > 0.01 ? d.clone().normalize() : V(1, 0, 0);
      if (P.hurt(1, dir, 'grenade')) P.vel.addScaledVector(dir, 9 * (1 - dl / BLAST_R) + 3);
    }
    for (const c of chairs) { const cd = Math.hypot(c.pos.x - x, c.pos.z - z); if (cd < BLAST_R + 1) knockChair(c, V(c.pos.x - x, 0, c.pos.z - z).normalize(), 9 * (1 - cd / (BLAST_R + 1)) + 2); }
    disturbPapers(x, z, BLAST_R + 1.5, 9); disturbJunk(x, z, BLAST_R + 1, 7);
    for (const dd of G.destructibles) {
      if (dd.broken || !dd.box) continue;
      const bx = dd.box.cx ?? (dd.obj && dd.obj.position.x), bz = dd.box.cz ?? (dd.obj && dd.obj.position.z); if (bx === undefined) continue;
      const r = Math.hypot(bx - x, bz - z), reach = dd.kind === 'glass' ? 3.2 + (dd.w || 0) / 2 : BLAST_R;
      if (r < reach) { const dir = V(bx - x, 0, bz - z).normalize(); hitDestructible(dd, 'body', V(bx, 1.1, bz), dir); }
    }
  }
}
