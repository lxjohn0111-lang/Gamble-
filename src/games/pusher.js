import * as THREE from 'three';
import { Station } from './common.js';
import { G, mesh } from '../engine/geo.js';
import { M } from '../engine/materials.js';
import { makeCanvas, toTex } from '../engine/textures.js';
import { TAU, rand, fmtMoney, clamp } from '../engine/util.js';
import { audio } from '../engine/audio.js';

// ============================================================================
//  COIN PUSHER — a sliding shelf, piles of coins, a bonus gate and prizes.
//  Lightweight custom disc physics: pushing, separation, stacking, spilling.
// ============================================================================

const R = 0.024, H = 0.0045;
const FIELD = { x0: -0.36, x1: 0.36, zBack: -0.32, zFront: 0.2 };
const MAX = 200;

export class CoinPusher extends Station {
  constructor(ctx, def) {
    super(ctx, def);
    this.label = 'Play the Coin Pusher';
    this.coinValue = [1, 2, 5, 10, 25][Math.min(4, Math.floor((ctx.state.day - 1) / 1.2))];
    this.footprint = { w: 1.1, d: 1.0, ox: 0, oz: -0.05 };
    this.interactLocal = new THREE.Vector3(0, 0, 1.2);
    this.interactR = 1.3;
    this.camLocal = { pos: new THREE.Vector3(0, 1.42, 0.66), look: new THREE.Vector3(0, 0.93, -0.12) };
    this.coins = [];
    this.aimX = 0;
    this.won = 0;
    this.queue = [];
    this.falling = [];
  }
  promptText() { return [this.label, `${fmtMoney(this.coinValue)} tokens · push them over the edge!`]; }

  build() {
    const S = (this.static = new THREE.Group());
    S.position.copy(this.group.position); S.rotation.copy(this.group.rotation);
    this.ctx.director.world.staticRoot.add(S);
    const body = M.lacquer(0xd8102e), chrome = M.chrome();
    this.floorY = 0.95;
    mesh(G.rbox(1.0, 0.9, 0.95, 0.05), body, 0, 0.45, -0.05, { parent: S, cast: true });
    mesh(G.rbox(0.6, 0.12, 0.2, 0.03), chrome, 0, 0.62, 0.44, { parent: S }); // payout tray
    mesh(G.box(0.55, 0.06, 0.16), M.blackMetal(), 0, 0.66, 0.45, { parent: S });
    // playfield floor
    mesh(G.box(0.8, 0.04, 0.75), M.steel(), 0, this.floorY - 0.02, -0.08, { parent: S });
    // side walls (glass) and back
    for (const s of [-1, 1]) { mesh(G.box(0.02, 0.5, 0.75), M.glassSubtle(), s * 0.41, this.floorY + 0.25, -0.08, { parent: this.group }); mesh(G.box(0.06, 1.25, 0.9), body, s * 0.47, this.floorY + 0.4, -0.08, { parent: S, cast: true }); }
    mesh(G.box(0.88, 1.0, 0.04), M.lacquer(0x120408), 0, this.floorY + 0.5, -0.46, { parent: S });
    // roof + marquee
    mesh(G.rbox(1.02, 0.25, 0.95, 0.04), body, 0, this.floorY + 1.15, -0.06, { parent: S });
    const { c, g } = makeCanvas(1024, 256);
    g.fillStyle = '#ffd24a'; g.fillRect(0, 0, 1024, 256);
    g.font = 'bold 120px "Arial Black", Impact, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 14; g.strokeStyle = '#6a0a14'; g.strokeText('JELLY PUSHER', 512, 128); g.fillStyle = '#ff2b4a'; g.fillText('JELLY PUSHER', 512, 128);
    mesh(G.plane(0.96, 0.23), new THREE.MeshBasicMaterial({ map: toTex(c, { wrap: false }), color: new THREE.Color(1.2, 1.2, 1.2) }), 0, this.floorY + 1.15, 0.42, { parent: S });
    // front glass (upper)
    mesh(G.plane(0.82, 0.62), M.glassSubtle(), 0, this.floorY + 0.69, 0.3, { rx: -0.25, parent: this.group });
    // front edge lip + win chute
    mesh(G.box(0.8, 0.02, 0.05), chrome, 0, this.floorY - 0.04, FIELD.zFront + 0.04, { parent: S });
    // bonus gate on the back wall
    mesh(G.torus(0.05, 0.012, 8, 24), M.gold(), 0, this.floorY + 0.38, -0.43, { parent: S });
    this.gateMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0x2bff6a, emissiveIntensity: 1.5 });
    mesh(G.circle(0.045, 24), this.gateMat, 0, this.floorY + 0.38, -0.435, { parent: this.group });
    // LED display
    this.disp = makeCanvas(512, 128);
    this.dispTex = toTex(this.disp.c, { wrap: false });
    mesh(G.plane(0.6, 0.12), new THREE.MeshBasicMaterial({ map: this.dispTex, color: new THREE.Color(1.5, 1.5, 1.5) }), 0, 0.82, 0.452, { parent: this.group });
    // pusher block
    this.pusher = mesh(G.rbox(0.8, 0.07, 0.3, 0.01), M.steel(), 0, this.floorY + 0.035, -0.3, { parent: this.group, cast: true });
    mesh(G.box(0.8, 0.005, 0.3), M.lacquer(0x2a2a3a), 0, 0.037, 0, { parent: this.pusher });
    // dropper carriage
    this.dropper = new THREE.Group();
    mesh(G.box(0.08, 0.05, 0.08), chrome, 0, 0, 0, { parent: this.dropper });
    mesh(G.cyl(0.03, 0.03, 0.06, 16, true), M.blackMetal(), 0, -0.05, 0, { parent: this.dropper });
    mesh(G.box(0.8, 0.02, 0.02), chrome, 0, 0.03, 0, { parent: S, cast: false }).position.set(0, this.floorY + 0.53, -0.25);
    this.dropper.position.set(0, this.floorY + 0.5, -0.25);
    this.group.add(this.dropper);
    // coins (instanced)
    this.coinMat = new THREE.MeshStandardMaterial({ color: 0xffc94a, metalness: 1, roughness: 0.28 });
    this.inst = new THREE.InstancedMesh(G.cyl(R, R, H, 18), this.coinMat, MAX);
    this.inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.inst.frustumCulled = false;
    this.group.add(this.inst);
    // prizes
    this.prizeMat = new THREE.MeshPhysicalMaterial({ color: 0xffd24a, metalness: 1, roughness: 0.2, clearcoat: 1 });
    // seed the field
    for (let i = 0; i < 150; i++) this.addCoin(FIELD.x0 + R + rand() * (FIELD.x1 - FIELD.x0 - 2 * R), -0.05 + rand() * (FIELD.zFront - 0.06 + 0.05), 0);
    for (let i = 0; i < 3; i++) this.addPrize();
    for (let k = 0; k < 60; k++) this.relax(1 / 60);
    this.pz = -0.3;
    this.t = rand() * 10;
    this.registerSeat(new THREE.Vector3(0, 0, 0.75), 0, { seat: 0.78, standOff: 0.55 });
    this.drawDisplay();
  }

  addCoin(x, z, layer = 0, falling = false) {
    if (this.coins.length >= MAX) return null;
    const c = { x, z, layer, y: layer * H, vx: 0, vz: 0, prize: false, fall: falling ? { vy: 0, y: 0.45 } : null, rot: rand() * TAU, tilt: 0 };
    this.coins.push(c);
    return c;
  }
  addPrize() {
    const p = this.addCoin(FIELD.x0 + 0.1 + rand() * 0.5, -0.02 + rand() * 0.15, 1);
    if (!p) return;
    p.prize = true;
    const m = new THREE.Group();
    mesh(G.sphere(0.03, 14, 12), this.prizeMat, 0, 0.035, 0, { s: [0.85, 1.1, 0.85], parent: m });
    for (const s of [-1, 1]) mesh(G.sphere(0.01, 8, 6), M.ceramic(0xffffff), s * 0.012, 0.05, 0.022, { parent: m });
    mesh(G.cyl(0.03, 0.032, 0.01, 16), this.prizeMat, 0, 0.005, 0, { parent: m });
    p.mesh = m; this.group.add(m);
  }

  drawDisplay() {
    const g = this.disp.g;
    g.fillStyle = '#060104'; g.fillRect(0, 0, 512, 128);
    g.font = 'bold 22px "Courier New", monospace'; g.fillStyle = '#ff9a6a'; g.textAlign = 'center';
    g.fillText(`TOKEN ${fmtMoney(this.coinValue)}`, 128, 34); g.fillText('WON TONIGHT', 384, 34);
    g.font = 'bold 54px "Courier New", monospace'; g.fillStyle = '#ff3a2a'; g.shadowColor = '#ff3a2a'; g.shadowBlur = 10;
    g.fillText(String(this.coinsPlayed || 0), 128, 100); g.fillStyle = '#7dff9a'; g.shadowColor = '#7dff9a'; g.fillText(fmtMoney(this.won), 384, 100);
    g.shadowBlur = 0;
    this.dispTex.needsUpdate = true;
  }

  enter() {
    super.enter();
    const ui = this.ui;
    const p = (this.panel = ui.openPanel({ title: 'Jelly Pusher', limits: `Token value ${fmtMoney(this.coinValue)}`, onLeave: () => this.ctx.director.leaveStation() }));
    const row = document.createElement('div'); row.className = 'row';
    row.append(ui.button('◀', 'dark', () => (this.aimX = clamp(this.aimX - 0.08, -0.32, 0.32)), 'KeyA', 'A'));
    row.append(ui.button('Drop token', 'big green', () => this.drop(), 'Space', 'SPACE'));
    row.append(ui.button('▶', 'dark', () => (this.aimX = clamp(this.aimX + 0.08, -0.32, 0.32)), 'KeyD', 'D'));
    row.append(ui.button('Drop ×10', 'blue', () => { for (let i = 0; i < 10; i++) setTimeout(() => this.active && this.drop(), i * 180); }));
    p.body.append(row);
    p.msg('Aim with A / D or the mouse. Hit the glowing gate for a BONUS!');
    this.onMove = (e) => { const r = this.ctx.director.app.canvas.getBoundingClientRect(); this.aimX = clamp(((e.clientX - r.left) / r.width - 0.5) * 1.0, -0.32, 0.32); };
    this.ctx.director.app.canvas.addEventListener('pointermove', this.onMove);
  }
  leave() { super.leave(); this.ctx.director.app.canvas.removeEventListener('pointermove', this.onMove); }

  drop() {
    if (!this.takeBet(this.coinValue, 'pusher')) return;
    this.coinsPlayed = (this.coinsPlayed || 0) + 1;
    audio.play('coin', { pos: this.worldPos() });
    const x = this.aimX + (rand() - 0.5) * 0.01;
    // coins land just in front of the pusher (or bounce through the gate)
    const c = this.addCoin(x, this.pz + 0.15 + R + rand() * 0.04, 2, true);
    if (Math.abs(x) < 0.045 && rand() < 0.45) this.bonus();
    this.drawDisplay();
    void c;
  }
  bonus() {
    this.gateT = 2;
    audio.play('powerup', { pos: this.worldPos() });
    this.ui.toast('🎯 BONUS GATE! 12 free tokens rain down!', 'gold');
    for (let i = 0; i < 12; i++) setTimeout(() => { this.addCoin(FIELD.x0 + 0.05 + rand() * 0.62, this.pz + 0.16 + rand() * 0.08, 2, true); audio.play('coin', { pos: this.worldPos(), vol: 0.5 }); }, 200 + i * 120);
    if (rand() < 0.3) setTimeout(() => this.addPrize(), 1800);
  }

  relax(dt) {
    const cs = this.coins;
    const magnet = this.ctx.state.perks.magnet || 0;
    // pusher contact
    const front = this.pz + 0.15;
    for (const c of cs) {
      if (c.fall || c.gone) continue;
      if (c.layer === 0 && c.z - R < front) { c.z = front + R; c.vz = Math.max(c.vz, this.pv * (1 + magnet * 0.15)); }
      if (c.layer > 0 && c.z - R < front - 0.3) { c.z = front - 0.3 + R; }
    }
    // separation (same layer)
    for (let it = 0; it < 2; it++) {
      for (let i = 0; i < cs.length; i++) {
        const a = cs[i]; if (a.fall || a.gone) continue;
        for (let j = i + 1; j < cs.length; j++) {
          const b = cs[j]; if (b.fall || b.gone || a.layer !== b.layer) continue;
          const dx = b.x - a.x, dz = b.z - a.z, d2 = dx * dx + dz * dz;
          const min = (a.prize || b.prize ? 0.035 : 0) + 2 * R;
          if (d2 < min * min && d2 > 1e-10) {
            const d = Math.sqrt(d2), o = (min - d) / 2;
            const nx = dx / d, nz = dz / d;
            const deep = o > R * 0.45;
            if (deep && it === 1 && a.layer < 2 && !a.prize && !b.prize) { (a.z < b.z ? b : a).layer++; continue; }
            a.x -= nx * o; a.z -= nz * o; b.x += nx * o; b.z += nz * o;
            // transfer push velocity forward
            const vz = Math.max(a.vz, b.vz) * 0.5;
            if (a.z > b.z) a.vz = Math.max(a.vz, vz); else b.vz = Math.max(b.vz, vz);
          }
        }
      }
    }
    // stacked coins fall down when nothing supports them
    for (const c of cs) {
      if (c.fall || c.gone || c.layer === 0) continue;
      let supported = false;
      for (const o of cs) { if (o === c || o.gone || o.fall || o.layer !== c.layer - 1) continue; const dx = o.x - c.x, dz = o.z - c.z; if (dx * dx + dz * dz < (R * 1.6) ** 2) { supported = true; break; } }
      if (!supported) c.layer--;
    }
    // friction & edges
    for (const c of cs) {
      if (c.fall || c.gone) continue;
      c.z += c.vz * dt; c.vz *= Math.exp(-14 * dt);
      const sideLimit = magnet ? 0.004 : 0;
      if (c.x - R < FIELD.x0 - sideLimit || c.x + R > FIELD.x1 + sideLimit) {
        // side gutters: walls keep most coins in, some slip
        if (c.z > FIELD.zFront - 0.12 && rand() < 0.02 && !magnet) this.spill(c, false);
        c.x = clamp(c.x, FIELD.x0 + R, FIELD.x1 - R);
      }
      if (c.z > FIELD.zFront) this.spill(c, true);
      c.y += ((c.layer * H) - c.y) * Math.min(1, dt * 20);
    }
  }

  spill(c, win) {
    if (c.gone) return;
    c.gone = true;
    c.fall = { vy: 0, y: c.y, win, vz: 0.4 };
    if (win && this.active) {
      const value = c.prize ? this.coinValue * 25 : this.coinValue;
      this.pendingWin = (this.pendingWin || 0) + value;
      this.won += value;
      setTimeout(() => audio.play(c.prize ? 'jackpot' : 'coin', { pos: this.worldPos(), vol: 0.7 }), 250);
      if (c.prize) { this.ui.toast(`🏆 Golden Jelly prize! +${fmtMoney(value)}`, 'gold'); this.ctx.director.flash(0.3, 0xffd060); }
    }
  }

  update(dt, t) {
    this.t += dt;
    const prev = this.pz;
    this.pz = -0.32 + (Math.sin(this.t * 1.4) * 0.5 + 0.5) * 0.12;
    this.pv = Math.max(0, (this.pz - prev) / Math.max(dt, 1e-4));
    this.pusher.position.z = this.pz;
    this.dropper.position.x += (this.aimX - this.dropper.position.x) * Math.min(1, dt * 12);
    // incoming coins falling from the dropper
    for (const c of this.coins) {
      if (c.fall && !c.gone) {
        c.fall.vy -= 9.8 * dt; c.fall.y += c.fall.vy * dt;
        if (c.fall.y <= c.layer * H) { c.fall = null; c.y = c.layer * H; audio.play('clack', { pos: this.worldPos(), vol: 0.35 }); }
      }
    }
    // physics substeps (only when someone is near to save CPU)
    const near = this.active || this.ctx.camera.position.distanceToSquared(this.group.position) < 100;
    if (near) this.relax(Math.min(dt, 1 / 30));
    // spilled coins tumble away
    for (let i = this.coins.length - 1; i >= 0; i--) {
      const c = this.coins[i];
      if (c.gone && c.fall) {
        c.fall.vy -= 9.8 * dt; c.fall.y += c.fall.vy * dt; c.z += c.fall.vz * dt; c.tilt += dt * 8;
        if (c.fall.y < -0.32) { if (c.mesh) this.group.remove(c.mesh); this.coins.splice(i, 1); }
      }
    }
    if (this.pendingWin && (this._payT = (this._payT || 0) + dt) > 0.6) {
      this.state.payout(this.pendingWin, 0, 'pusher', { noBuff: false });
      this.pendingWin = 0; this._payT = 0;
      this.drawDisplay();
    }
    // write instance matrices
    const m4 = this._m4 || (this._m4 = new THREE.Matrix4()), q = this._q || (this._q = new THREE.Quaternion()), p = this._p || (this._p = new THREE.Vector3()), s = this._s || (this._s = new THREE.Vector3(1, 1, 1)), e = this._e || (this._e = new THREE.Euler());
    let n = 0;
    for (const c of this.coins) {
      const y = this.floorY + H / 2 + (c.fall ? c.fall.y : c.y);
      if (c.prize) { if (c.mesh) { c.mesh.position.set(c.x, this.floorY + (c.fall ? c.fall.y : c.y), c.z); c.mesh.rotation.y = c.rot; } continue; }
      e.set(c.tilt, c.rot, c.layer > 0 ? 0.08 : 0);
      q.setFromEuler(e);
      m4.compose(p.set(c.x, y, c.z), q, s);
      this.inst.setMatrixAt(n++, m4);
    }
    this.inst.count = n;
    this.inst.instanceMatrix.needsUpdate = true;
    this.gateT = Math.max(0, (this.gateT || 0) - dt);
    this.gateMat.emissiveIntensity = this.gateT > 0 ? (Math.floor(t * 12) % 2 ? 4 : 0.5) : 1.2 + Math.sin(t * 4) * 0.6;
    // keep the field topped up a little for NPC realism
    if (!this.active && this.coins.length < 120 && rand() < dt * 0.5) this.addCoin(FIELD.x0 + 0.05 + rand() * 0.6, this.pz + 0.17, 1, true);
  }
}
