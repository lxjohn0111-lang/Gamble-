import * as THREE from 'three';
import { clamp, damp, lerp, easeInOutCubic } from '../engine/util.js';
import { handGeometry } from '../characters/outfits.js';
import { hawaiianTexture, makeCanvas, toTex } from '../engine/textures.js';
import { audio } from '../engine/audio.js';

// ============================================================================
//  First-person player controller with seated "game camera" mode and a
//  viewmodel: your own jelly hand clutching a wad of cash.
// ============================================================================

const EYE = 1.62, RADIUS = 0.32;
const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ');

export class Player {
  constructor(camera, input) {
    this.camera = camera;
    this.input = input;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0;
    this.bob = 0; this.bobAmt = 0; this.stepAcc = 0;
    this.mode = 'walk'; // walk | seat | transition | frozen
    this.seatPose = null;
    this.trans = null;
    this.sway = new THREE.Vector2();
    this.drunk = 0;
    this.roll = 0;
    this.landKick = 0;
    this.floor = 'carpet';
    this.buildViewmodel();
  }

  spawn(x, z, yaw) { this.pos.set(x, 0, z); this.vel.set(0, 0, 0); this.yaw = yaw; this.pitch = -0.05; this.mode = 'walk'; this.applyCamera(0); }

  // -------------------------------------------------------------- viewmodel
  buildViewmodel() {
    const vm = (this.vm = new THREE.Group());
    this.camera.add(vm);
    const jelly = new THREE.MeshPhysicalMaterial({ color: 0x2f6bff, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.1, sheen: 0.3, sheenColor: new THREE.Color(0x6a9aff), emissive: 0x0a1a5a, emissiveIntensity: 0.2, envMapIntensity: 0.6 });
    this.vmMat = jelly;
    const sleeveMat = new THREE.MeshPhysicalMaterial({ map: hawaiianTexture('#ff7a1a', ['#ffffff', '#ffe14d', '#ff3a6a'], '#1f6a3b', 'hibiscus', 3), roughness: 0.8, sheen: 0.5, side: THREE.DoubleSide });
    // right hand + forearm
    const arm = (this.vmArm = new THREE.Group());
    const fore = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.058, 0.42, 16), jelly);
    fore.rotation.x = Math.PI / 2; fore.position.z = 0.17; arm.add(fore);
    const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.078, 0.082, 0.18, 18, 1, true), sleeveMat);
    sleeve.rotation.x = Math.PI / 2; sleeve.position.z = 0.33; arm.add(sleeve);
    const hand = new THREE.Mesh(handGeometry('hold', 1), jelly);
    hand.scale.setScalar(1.15);
    hand.rotation.set(Math.PI, 0, Math.PI / 2 + 0.3);
    hand.position.z = -0.03;
    arm.add(hand);
    // cash wad
    const wad = (this.wad = new THREE.Group());
    const { c, g } = makeCanvas(256, 128);
    g.fillStyle = '#cfe3c0'; g.fillRect(0, 0, 256, 128);
    g.strokeStyle = '#3a6a3a'; g.lineWidth = 6; g.strokeRect(8, 8, 240, 112);
    g.fillStyle = '#2a5a2a'; g.font = 'bold 64px Georgia'; g.textAlign = 'center'; g.fillText('$100', 128, 86);
    g.fillStyle = '#8ab08a'; g.beginPath(); g.arc(40, 64, 24, 0, Math.PI * 2); g.arc(216, 64, 24, 0, Math.PI * 2); g.fill();
    const billTex = toTex(c, { wrap: false });
    const billSide = new THREE.MeshStandardMaterial({ color: 0x9aaa90, roughness: 0.9 });
    const billTop = new THREE.MeshStandardMaterial({ map: billTex, roughness: 0.85, color: 0xb8c8b0 });
    this.wadMesh = new THREE.Mesh(new THREE.BoxGeometry(0.155, 0.02, 0.068), [billSide, billSide, billTop, billSide, billSide, billSide]);
    wad.add(this.wadMesh);
    this.band = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.022, 0.07), new THREE.MeshStandardMaterial({ color: 0xc8a030, roughness: 0.5, metalness: 0.4 }));
    wad.add(this.band);
    wad.position.set(0.0, -0.03, -0.04); wad.rotation.set(0.2, 0.3, -0.25);
    arm.add(wad);
    arm.position.set(0.27, -0.3, -0.5);
    arm.rotation.set(-0.55, -0.35, 0.25);
    arm.scale.setScalar(0.85);
    vm.add(arm);
    // left hand for drinks
    const larm = (this.vmLeft = new THREE.Group());
    const lfore = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.058, 0.42, 16), jelly); lfore.rotation.x = Math.PI / 2; lfore.position.z = 0.17; larm.add(lfore);
    const lsleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.078, 0.082, 0.18, 18, 1, true), sleeveMat); lsleeve.rotation.x = Math.PI / 2; lsleeve.position.z = 0.33; larm.add(lsleeve);
    const lhand = new THREE.Mesh(handGeometry('hold', -1), jelly); lhand.scale.setScalar(1.15); lhand.rotation.set(Math.PI, 0, -Math.PI / 2 - 0.2); lhand.position.z = -0.03; larm.add(lhand);
    this.drinkSlot = new THREE.Group(); this.drinkSlot.position.set(-0.02, 0.02, -0.06); larm.add(this.drinkSlot);
    larm.position.set(-0.26, -0.5, -0.42); larm.rotation.set(0.1, 0.25, -0.1);
    larm.visible = false;
    vm.add(larm);
    vm.traverse((o) => { if (o.isMesh) { o.renderOrder = 10; o.frustumCulled = false; } });
    this.vmOffset = new THREE.Vector3();
    this.reach = 0;
  }
  setWad(money) {
    const thick = clamp(0.006 + Math.log10(Math.max(1, money)) * 0.012, 0.006, 0.08);
    this.wadMesh.scale.y = thick / 0.02;
    this.band.scale.y = (thick + 0.002) / 0.022;
    this.wad.visible = money > 0;
  }
  holdDrink(obj) {
    this.drinkSlot.clear();
    if (obj) { obj.traverse((o) => { if (o.isMesh) { o.renderOrder = 10; o.frustumCulled = false; } }); obj.scale.setScalar(1.6); this.drinkSlot.add(obj); this.vmLeft.visible = true; this.leftT = 0; }
    else this.vmLeft.visible = false;
  }
  poke() { this.reach = 1; }

  // -------------------------------------------------------------- seat transitions
  /** Move the camera to a fixed game pose (world position + look target). */
  sit(pos, look, dur = 0.8) {
    const startQ = this.camera.quaternion.clone();
    const m = new THREE.Matrix4().lookAt(pos, look, new THREE.Vector3(0, 1, 0));
    const endQ = new THREE.Quaternion().setFromRotationMatrix(m);
    this.trans = { from: this.camera.position.clone(), to: pos.clone(), qf: startQ, qt: endQ, t: 0, dur, then: 'seat' };
    this.seatPose = { pos: pos.clone(), q: endQ, look: look.clone() };
    this.mode = 'transition';
  }
  /** Adjust the seated camera (e.g. lean in to look at a wheel). */
  retarget(pos, look, dur = 0.6) {
    if (this.mode !== 'seat' && this.mode !== 'transition') return;
    this.sit(pos, look, dur);
  }
  stand(dur = 0.6) {
    const startQ = this.camera.quaternion.clone();
    // face the station we were looking at
    const look = this.seatPose ? this.seatPose.look : null;
    if (look) { this.yaw = Math.atan2(-(look.x - this.pos.x), -(look.z - this.pos.z)); }
    this.pitch = -0.1;
    _e.set(this.pitch, this.yaw, 0); const endQ = new THREE.Quaternion().setFromEuler(_e);
    this.trans = { from: this.camera.position.clone(), to: new THREE.Vector3(this.pos.x, EYE, this.pos.z), qf: startQ, qt: endQ, t: 0, dur, then: 'walk' };
    this.mode = 'transition';
  }

  // -------------------------------------------------------------- update
  update(dt, colliders, npcs) {
    const inp = this.input;
    if (this.mode === 'transition') {
      const tr = this.trans;
      tr.t += dt / tr.dur;
      const k = easeInOutCubic(Math.min(1, tr.t));
      this.camera.position.lerpVectors(tr.from, tr.to, k);
      this.camera.quaternion.slerpQuaternions(tr.qf, tr.qt, k);
      this.vm.visible = tr.then === 'walk' ? k > 0.6 : k < 0.4;
      if (tr.t >= 1) { this.mode = tr.then; this.trans = null; }
      return;
    }
    if (this.mode === 'seat') {
      const s = this.seatPose;
      const t = performance.now() / 1000;
      this.camera.position.copy(s.pos);
      this.camera.position.y += Math.sin(t * 1.3) * 0.004;
      this.camera.quaternion.copy(s.q);
      if (this.drunk > 0) { _q.setFromAxisAngle(_v.set(0, 0, 1), Math.sin(t * 1.1) * 0.03 * this.drunk); this.camera.quaternion.multiply(_q); }
      this.vm.visible = false;
      return;
    }
    if (this.mode === 'frozen') return;

    // ---- look
    const [mx, my] = inp.consumeMouse();
    const sens = 0.0022;
    this.yaw -= mx * sens; this.pitch -= my * sens;
    this.pitch = clamp(this.pitch, -1.45, 1.45);
    this.sway.x = damp(this.sway.x, clamp(mx * 0.004, -0.06, 0.06), 10, dt);
    this.sway.y = damp(this.sway.y, clamp(my * 0.004, -0.06, 0.06), 10, dt);

    // ---- move
    const [ax, ay] = inp.moveAxis();
    const sprint = inp.down('ShiftLeft') || inp.down('ShiftRight');
    const maxV = sprint ? 6.0 : 3.4;
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    let wx = fx * ay + rx * ax, wz = fz * ay + rz * ax;
    // drunk drift
    if (this.drunk > 0) { const t = performance.now() / 1000; wx += Math.sin(t * 0.9) * 0.25 * this.drunk * (ay || ax ? 1 : 0.2); wz += Math.cos(t * 0.7) * 0.25 * this.drunk * (ay || ax ? 1 : 0.2); }
    const accel = ax || ay ? 28 : 14;
    this.vel.x = damp(this.vel.x, wx * maxV, accel * 0.35, dt);
    this.vel.z = damp(this.vel.z, wz * maxV, accel * 0.35, dt);
    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt;
    this.collide(colliders, npcs);

    // ---- bob & footsteps
    const spd = Math.hypot(this.vel.x, this.vel.z);
    this.bobAmt = damp(this.bobAmt, clamp(spd / 3.4, 0, 1.6), 8, dt);
    this.bob += dt * (6 + spd * 1.6);
    this.stepAcc += spd * dt;
    const stride = sprint ? 0.95 : 0.75;
    if (this.stepAcc > stride) { this.stepAcc = 0; audio.play(this.floor === 'wood' ? 'stepWood' : 'step', { vol: 0.5 + spd * 0.08 }); }
    this.applyCamera(dt);

    // viewmodel
    const t = performance.now() / 1000;
    this.reach = damp(this.reach, 0, 6, dt);
    const bx = Math.cos(this.bob * 0.5) * 0.012 * this.bobAmt, by = -Math.abs(Math.sin(this.bob * 0.5)) * 0.016 * this.bobAmt;
    this.vmArm.position.set(0.27 + bx - this.sway.x * 0.6, -0.3 + by + Math.sin(t * 1.4) * 0.004 + this.sway.y * 0.5 - (sprint && spd > 4 ? 0.08 : 0), -0.5 - this.reach * 0.14);
    this.vmArm.rotation.set(-0.55 + this.reach * 0.4 + this.sway.y * 2, -0.35 - this.sway.x * 2, 0.25 + bx * 2);
    if (this.vmLeft.visible) {
      this.leftT = (this.leftT || 0) + dt;
      const sip = this.leftT > 1.2 && this.leftT < 2.6 ? Math.sin(((this.leftT - 1.2) / 1.4) * Math.PI) : 0;
      this.vmLeft.position.set(-0.26 - bx - this.sway.x * 0.6 + sip * 0.18, -0.3 + by + sip * 0.18, -0.42 + sip * 0.12);
      this.vmLeft.rotation.set(0.1 + sip * 0.6, 0.25, -0.1 + sip * 0.4);
    }
    this.vm.visible = true;
  }

  applyCamera(dt) {
    const t = performance.now() / 1000;
    const bobY = Math.sin(this.bob) * 0.035 * this.bobAmt;
    const bobX = Math.cos(this.bob * 0.5) * 0.025 * this.bobAmt;
    this.roll = damp(this.roll, (this.drunk > 0 ? Math.sin(t * 0.8) * 0.06 * this.drunk : 0) - this.sway.x * 0.3, 4, dt || 0.016);
    this.camera.position.set(this.pos.x + Math.cos(this.yaw) * bobX, EYE + bobY, this.pos.z - Math.sin(this.yaw) * bobX);
    _e.set(this.pitch + (this.drunk ? Math.sin(t * 0.6) * 0.03 * this.drunk : 0), this.yaw, this.roll);
    this.camera.quaternion.setFromEuler(_e);
  }

  collide(colliders, npcs) {
    for (let iter = 0; iter < 2; iter++) {
      for (const c of colliders) {
        const nx = clamp(this.pos.x, c.x0, c.x1), nz = clamp(this.pos.z, c.z0, c.z1);
        const dx = this.pos.x - nx, dz = this.pos.z - nz;
        const d2 = dx * dx + dz * dz;
        if (d2 < RADIUS * RADIUS) {
          if (d2 > 1e-8) { const d = Math.sqrt(d2); this.pos.x += (dx / d) * (RADIUS - d); this.pos.z += (dz / d) * (RADIUS - d); }
          else {
            // inside the box: push out along the shallowest axis
            const l = this.pos.x - c.x0, r = c.x1 - this.pos.x, b = this.pos.z - c.z0, f = c.z1 - this.pos.z;
            const m = Math.min(l, r, b, f);
            if (m === l) this.pos.x = c.x0 - RADIUS; else if (m === r) this.pos.x = c.x1 + RADIUS; else if (m === b) this.pos.z = c.z0 - RADIUS; else this.pos.z = c.z1 + RADIUS;
          }
        }
      }
      if (npcs) for (const n of npcs) {
        const p = n.root.position;
        const dx = this.pos.x - p.x, dz = this.pos.z - p.z, d = Math.hypot(dx, dz), R = RADIUS + 0.28;
        if (d < R && d > 1e-4) { const k = (R - d) * 0.7; this.pos.x += (dx / d) * k; this.pos.z += (dz / d) * k; n.bumped = (n.bumped || 0) + 1; }
      }
    }
  }

  forward(out = new THREE.Vector3()) { return this.camera.getWorldDirection(out); }
}
