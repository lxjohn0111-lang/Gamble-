import * as THREE from 'three';
import { Station } from './common.js';
import { G, mesh } from '../engine/geo.js';
import { M } from '../engine/materials.js';
import { makeCanvas, toTex, starfieldTexture } from '../engine/textures.js';
import { TAU, rand, fmtMoney, easeOutCubic } from '../engine/util.js';
import { audio } from '../engine/audio.js';

// ============================================================================
//  PLINKO TOWER — 12 rows, three risk levels, multi-ball.
// ============================================================================

const ROWS = 12;
const TABLES = {
  low: [10, 3, 1.6, 1.4, 1.1, 1, 0.5, 1, 1.1, 1.4, 1.6, 3, 10],
  medium: [33, 11, 4, 2, 1.1, 0.6, 0.3, 0.6, 1.1, 2, 4, 11, 33],
  high: [170, 24, 8.1, 2, 0.7, 0.2, 0.2, 0.2, 0.7, 2, 8.1, 24, 170],
};
const SX = 0.13, SY = 0.15;

function bucketColor(m) { return m >= 10 ? '#ff2b4a' : m >= 3 ? '#ff8a2a' : m >= 1.4 ? '#ffd24a' : m >= 1 ? '#9aff4a' : '#4ad8ff'; }

export class Plinko extends Station {
  constructor(ctx, def) {
    super(ctx, def);
    this.label = 'Play Plinko Tower';
    const k = 1 + (ctx.state.day - 1) * 0.5;
    this.limits = [1, Math.round(100 * k * ctx.state.limitMult())];
    this.footprint = { w: 2.3, d: 0.9, ox: 0, oz: 0 };
    this.interactLocal = new THREE.Vector3(0, 0, 1.35);
    this.interactR = 1.5;
    this.camLocal = { pos: new THREE.Vector3(0, 1.85, 2.75), look: new THREE.Vector3(0, 1.9, 0) };
    this.risk = 'medium';
    this.bet = 5;
    this.balls = [];
    this.pending = 0;
  }
  promptText() { return [this.label, `Drop balls · up to 170× · ${fmtMoney(this.limits[0])}–${fmtMoney(this.limits[1])}`]; }

  build() {
    const S = (this.static = new THREE.Group());
    S.position.copy(this.group.position); S.rotation.copy(this.group.rotation);
    this.ctx.director.world.staticRoot.add(S);
    const body = M.lacquer(0x1a1040);
    const topY = 3.05, boardY0 = 0.95;
    this.boardTop = 2.75;
    // cabinet frame
    mesh(G.rbox(2.2, 0.9, 0.8, 0.05), body, 0, 0.45, 0, { parent: S, cast: true });
    for (const s of [-1, 1]) mesh(G.rbox(0.14, topY, 0.7, 0.04), body, s * 1.05, topY / 2, -0.05, { parent: S, cast: true });
    mesh(G.rbox(2.24, 0.35, 0.74, 0.05), body, 0, topY + 0.1, -0.05, { parent: S });
    // board backplate
    const bt = starfieldTexture().clone(); bt.userData.shared = true; bt.needsUpdate = true;
    mesh(G.plane(1.96, topY - boardY0), new THREE.MeshStandardMaterial({ map: bt, emissiveMap: bt, emissive: 0xffffff, emissiveIntensity: 0.22, roughness: 0.8 }), 0, (topY + boardY0) / 2, -0.2, { parent: S });
    // header sign
    const { c, g } = makeCanvas(1024, 192);
    const gr = g.createLinearGradient(0, 0, 1024, 0); gr.addColorStop(0, '#ff2bd6'); gr.addColorStop(1, '#2bf0ff');
    g.fillStyle = '#0a0418'; g.fillRect(0, 0, 1024, 192);
    g.font = 'bold 130px "Arial Black", Impact, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 12; g.strokeStyle = '#000'; g.strokeText('PLINKO!', 512, 100); g.fillStyle = gr; g.fillText('PLINKO!', 512, 100);
    mesh(G.plane(2.0, 0.32), new THREE.MeshBasicMaterial({ map: toTex(c, { wrap: false }), color: new THREE.Color(1.6, 1.6, 1.6) }), 0, topY + 0.1, 0.33, { parent: S });
    // pegs
    const pegs = [];
    for (let r = 0; r < ROWS; r++) for (let i = 0; i < r + 3; i++) pegs.push([(i - (r + 2) / 2) * SX, this.boardTop - r * SY]);
    const pm = new THREE.InstancedMesh(G.cyl(0.012, 0.012, 0.12, 10), M.brass(), pegs.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
    pegs.forEach(([x, y], i) => { m4.compose(new THREE.Vector3(x, y, -0.13), q, new THREE.Vector3(1, 1, 1)); pm.setMatrixAt(i, m4); });
    this.group.add(pm);
    this.pegs = pegs;
    // peg flash markers (pooled sprites)
    this.flashes = [];
    // buckets
    this.bucketY = this.boardTop - ROWS * SY - 0.02;
    this.bucketMats = [];
    this.buckets = [];
    for (let i = 0; i <= ROWS; i++) {
      const x = (i - ROWS / 2) * SX;
      const m = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const b = mesh(G.rbox(SX * 0.94, 0.13, 0.1, 0.015), m, x, this.bucketY, -0.12, { parent: this.group });
      this.buckets.push(b); this.bucketMats.push(m);
      mesh(G.box(0.008, 0.12, 0.12), M.chrome(), x + SX / 2, this.bucketY + 0.02, -0.12, { parent: S });
    }
    // multiplier labels (one canvas strip)
    const lc = makeCanvas(2048, 128);
    this.labelCtx = lc.g; this.labelTex = toTex(lc.c, { wrap: false });
    this.labelMesh = mesh(G.plane(SX * 13, 0.095), new THREE.MeshBasicMaterial({ map: this.labelTex, transparent: true, depthWrite: false }), 0, this.bucketY, -0.065, { parent: this.group });
    this.drawBuckets();
    // glass front
    const glass = mesh(G.plane(1.96, topY - boardY0), M.glassSubtle(), 0, (topY + boardY0) / 2, 0.02, { parent: this.group });
    glass.renderOrder = 6;
    // drop chute at top
    mesh(G.cyl(0.06, 0.04, 0.2, 16, true), M.chrome(), 0, this.boardTop + 0.22, -0.12, { parent: S });
    // neon trim
    for (const s of [-1, 1]) mesh(G.box(0.03, topY - 0.95, 0.03), M.neon(s > 0 ? 0x2bf0ff : 0xff2bd6, 3), s * 0.98, (topY + 0.95) / 2, 0.03, { parent: S });
    this.ballGeo = G.sphere(0.028, 16, 12);
    this.ballMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xff7ae0, emissiveIntensity: 1.6, roughness: 0.2 });
    this.trailMat = M.glow(0xff7ae0, 0.6);
  }

  drawBuckets() {
    const g = this.labelCtx, mult = TABLES[this.risk];
    g.clearRect(0, 0, 2048, 128);
    const w = 2048 / 13;
    mult.forEach((m, i) => {
      g.fillStyle = '#111'; g.font = `bold ${m >= 100 ? 62 : 72}px "Arial Black", sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(m + '×', i * w + w / 2, 66);
      this.bucketMats[i].color.set(bucketColor(m)).multiplyScalar(1.6);
    });
    this.labelTex.needsUpdate = true;
  }

  enter() {
    super.enter();
    const ui = this.ui;
    const p = (this.panel = ui.openPanel({ title: 'Plinko Tower', limits: 'Every drop is a separate bet', onLeave: () => this.ctx.director.leaveStation() }));
    this.betCtl = ui.betControl({ min: this.limits[0], max: this.limits[1], value: this.bet, getMoney: () => this.state.money, onChange: (v) => (this.bet = v) });
    const row = document.createElement('div'); row.className = 'row';
    const seg = document.createElement('div'); seg.className = 'seg';
    for (const r of ['low', 'medium', 'high']) {
      const b = document.createElement('button'); b.textContent = r.toUpperCase(); if (r === this.risk) b.className = 'on';
      b.onclick = () => { if (this.balls.length) return; this.risk = r; seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); this.drawBuckets(); audio.play('click'); };
      seg.append(b);
    }
    this.dropBtn = ui.button('Drop ball', 'big green', () => this.drop(), 'Space', 'SPACE');
    this.drop5 = ui.button('Drop ×5', 'blue', () => { for (let i = 0; i < 5; i++) setTimeout(() => this.active && this.drop(), i * 160); });
    row.append(h2('Risk'), seg, this.dropBtn, this.drop5);
    p.body.append(this.betCtl.el, row);
    p.msg('Every bounce is 50/50. Edges pay big!');
  }
  canLeave() { return this.balls.length === 0; }

  drop() {
    if (!this.takeBet(this.bet, 'plinko')) return;
    const path = [];
    let rights = 0;
    for (let r = 0; r < ROWS; r++) { const right = rand() < 0.5; path.push(right); if (right) rights++; }
    const mesh0 = new THREE.Mesh(this.ballGeo, this.ballMat);
    const trail = new THREE.Sprite(this.trailMat); trail.scale.set(0.16, 0.16, 1);
    mesh0.add(trail);
    mesh0.position.set((rand() - 0.5) * 0.02, this.boardTop + 0.2, -0.1);
    this.group.add(mesh0);
    audio.play('pop', { pos: this.worldPos(), vol: 0.6 });
    this.balls.push({ mesh: mesh0, path, rights, row: -1, t: 0, x: 0, from: mesh0.position.clone(), to: null, bet: this.bet, risk: this.risk });
  }

  land(b) {
    const mult = TABLES[b.risk][b.rights];
    const gross = Math.round(b.bet * mult * this.state.perkMult('plinko') * 100) / 100;
    const bk = this.buckets[b.rights];
    bk.userData.bump = 1;
    const pitch = { 0.2: 0, 0.3: 1, 0.5: 2, 0.6: 3, 0.7: 3, 1: 4, 1.1: 5, 1.4: 6, 1.6: 7, 2: 8, 3: 9, 4: 10, 8.1: 11, 10: 12, 11: 12, 24: 14, 33: 15, 170: 19 }[mult] || 6;
    audio.play('gem', { pos: this.worldPos(), p: pitch });
    if (gross > 0) this.state.payout(gross, b.bet, 'plinko');
    if (gross < b.bet) this.state.lost(b.bet - gross, 'plinko');
    const profit = gross - b.bet;
    if (this.panel) this.panel.msg(`${mult}× → ${fmtMoney(gross)}`, profit > 0 ? 'win' : profit < 0 ? 'lose' : '');
    if (mult >= 8) this.celebrate(profit, b.bet);
    else if (profit > 0) this.ctx.director.flash(0.08, 0xffd060);
    // screen-space floater near the bucket
    const wp = this.w(bk.position.x, bk.position.y + 0.12, 0);
    const v = wp.project(this.ctx.camera);
    if (this.active && v.z < 1) this.ui.floater(`${mult}×`, ((v.x + 1) / 2) * window.innerWidth, ((1 - v.y) / 2) * window.innerHeight, mult < 1);
  }

  update(dt, t) {
    for (let i = this.balls.length - 1; i >= 0; i--) {
      const b = this.balls[i];
      b.t += dt;
      const hop = 0.13;
      if (b.row === -1) {
        // fall from the chute to the first peg
        const k = Math.min(1, b.t / 0.25);
        b.mesh.position.y = this.boardTop + 0.2 - 0.2 * k * k - 0.02;
        if (k >= 1) { b.row = 0; b.t = 0; b.x = 0; b.from = b.mesh.position.clone(); }
        continue;
      }
      if (b.row < ROWS) {
        if (!b.to) {
          const right = b.path[b.row];
          b.x += right ? 0.5 : -0.5;
          b.to = new THREE.Vector3(b.x * SX + (rand() - 0.5) * 0.012, this.boardTop - b.row * SY - SY + 0.03, -0.1);
          if (b.row === ROWS - 1) b.to.y = this.bucketY + 0.04;
          audio.play('ping', { pos: this.worldPos(), vol: 0.35, f: 900 + b.row * 70 + rand() * 60 });
        }
        const k = Math.min(1, b.t / hop);
        b.mesh.position.lerpVectors(b.from, b.to, k);
        b.mesh.position.y += Math.sin(k * Math.PI) * 0.05;
        if (k >= 1) { b.row++; b.t = 0; b.from = b.to.clone(); b.to = null; }
      } else {
        this.land(b);
        this.group.remove(b.mesh);
        this.balls.splice(i, 1);
      }
    }
    for (const bk of this.buckets) {
      const u = bk.userData;
      if (u.bump > 0) { u.bump = Math.max(0, u.bump - dt * 3); bk.position.y = this.bucketY - Math.sin(u.bump * Math.PI) * 0.03; bk.scale.setScalar(1 + u.bump * 0.15); }
    }
    this.ballMat.emissive.setHSL((t * 0.15) % 1, 0.9, 0.6);
  }
}

function h2(t) { const s = document.createElement('span'); s.className = 'mini'; s.textContent = t; return s; }
