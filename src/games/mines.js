import * as THREE from 'three';
import { Station } from './common.js';
import { G, mesh } from '../engine/geo.js';
import { M } from '../engine/materials.js';
import { makeCanvas, toTex } from '../engine/textures.js';
import { rand, fmtMoney, shuffle } from '../engine/util.js';
import { audio } from '../engine/audio.js';
import { h } from '../ui/ui.js';
import { barStool } from '../world/props.js';

// ============================================================================
//  JELLY MINES — pick gems on a 5×5 grid, avoid the bombs, cash out anytime.
// ============================================================================

const N = 25;
export function minesMult(mines, picks) {
  let m = 1;
  for (let i = 0; i < picks; i++) m *= (N - i) / (N - mines - i);
  return m * 1.03; // player-friendly: 3% above fair odds
}

export class Mines extends Station {
  constructor(ctx, def) {
    super(ctx, def);
    this.label = 'Play Jelly Mines';
    const k = 1 + (ctx.state.day - 1) * 0.5;
    this.limits = [1 * ctx.state.limitMult(), Math.round(300 * k * ctx.state.limitMult())];
    this.footprint = { w: 0.95, d: 0.85, ox: 0, oz: 0 };
    this.interactLocal = new THREE.Vector3(0, 0, 1.05);
    this.interactR = 1.15;
    this.camLocal = { pos: new THREE.Vector3(0, 1.74, 0.8), look: new THREE.Vector3(0, 1.0, 0.0) };
    this.bet = 10; this.mines = 3;
    this.phase = 'idle';
    this.picks = 0;
  }
  promptText() { return [this.label, `Avoid the bombs · up to 24 mines · ${fmtMoney(this.limits[0])}–${fmtMoney(this.limits[1])}`]; }

  build() {
    const S = (this.static = new THREE.Group());
    S.position.copy(this.group.position); S.rotation.copy(this.group.rotation);
    this.ctx.director.world.staticRoot.add(S);
    const body = M.lacquer(0x2a0a4a);
    mesh(G.rbox(0.9, 0.95, 0.75, 0.05), body, 0, 0.475, -0.05, { parent: S, cast: true });
    mesh(G.rbox(0.9, 0.8, 0.2, 0.05), body, 0, 1.45, -0.35, { parent: S, cast: true });
    // angled play surface
    mesh(G.rbox(0.86, 0.06, 0.62, 0.02), M.lacquer(0x0a0418), 0, 1.0, 0.02, { rx: -0.35, parent: S });
    const { c, g } = makeCanvas(512, 128);
    g.fillStyle = '#12021e'; g.fillRect(0, 0, 512, 128);
    g.font = 'bold 74px "Arial Black", Impact, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#ff2bd6'; g.shadowColor = '#ff2bd6'; g.shadowBlur = 20; g.fillText('JELLY MINES', 256, 66);
    mesh(G.plane(0.82, 0.2), new THREE.MeshBasicMaterial({ map: toTex(c, { wrap: false }), color: new THREE.Color(1.5, 1.5, 1.5) }), 0, 1.72, -0.245, { parent: S });
    mesh(G.box(0.9, 0.03, 0.03), M.neon(0x2bf0ff, 3), 0, 1.85, -0.25, { parent: S });
    // tiles
    this.tiles = [];
    const surf = (this.surf = new THREE.Group());
    surf.position.set(0, 1.04, 0.02); surf.rotation.x = -0.35;
    this.group.add(surf);
    for (let i = 0; i < N; i++) {
      const x = ((i % 5) - 2) * 0.105, z = (Math.floor(i / 5) - 2) * 0.105;
      const m = new THREE.MeshStandardMaterial({ color: 0x3a1a6a, emissive: 0x6a2aff, emissiveIntensity: 0.4, roughness: 0.3, metalness: 0.2 });
      const t = mesh(G.rbox(0.09, 0.025, 0.09, 0.012), m, x, 0, z, { parent: surf });
      this.tiles.push({ mesh: t, mat: m, state: 'hidden', x, z, flip: 0 });
    }
    this.gemMat = new THREE.MeshPhysicalMaterial({ color: 0x3affb0, emissive: 0x1aa070, emissiveIntensity: 0.8, roughness: 0.05, clearcoat: 1 });
    this.bombMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.4, metalness: 0.4 });
    const st = barStool('chrome', 0x2a0a4a); st.position.set(0, 0, 0.6); S.add(st);
    this.registerSeat(new THREE.Vector3(0, 0, 0.6), 0, { seat: 0.78, standOff: 0.55 });
    this.raycaster = new THREE.Raycaster();
  }

  enter() {
    super.enter();
    const ui = this.ui;
    const p = (this.panel = ui.openPanel({ title: 'Jelly Mines', limits: '', onLeave: () => this.ctx.director.leaveStation() }));
    this.betCtl = ui.betControl({ min: this.limits[0], max: this.limits[1], value: this.bet, getMoney: () => this.state.money, onChange: (v) => (this.bet = v) });
    const row = h('div', 'row');
    const seg = h('div', 'seg');
    for (const m of [1, 3, 5, 10, 24]) {
      const b = document.createElement('button'); b.textContent = `${m} 💣`; if (m === this.mines) b.className = 'on';
      b.onclick = () => { if (this.phase === 'play') return; this.mines = m; seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); this.refresh(); };
      seg.append(b);
    }
    this.startBtn = ui.button('Start', 'big green', () => (this.phase === 'play' ? this.cashOut() : this.start()), 'Space', 'SPACE');
    this.multEl = h('span', 'tag');
    row.append(h('span', 'mini', 'Mines'), seg, this.startBtn, this.multEl);
    // HTML grid mirror
    this.grid = h('div', 'betgrid compact mines');
    this.cells = [];
    for (let i = 0; i < N; i++) { const c = h('div', 'betcell interactive', '<div class="nm">?</div>'); c.onclick = () => this.pick(i); this.cells.push(c); this.grid.append(c); }
    p.body.append(this.betCtl.el, row, this.grid);
    this.onDown = (e) => {
      if (this.phase !== 'play' || e.button !== 0) return;
      const r = this.ctx.director.app.canvas.getBoundingClientRect();
      this.raycaster.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.ctx.camera);
      const hit = this.raycaster.intersectObjects(this.tiles.map((t) => t.mesh))[0];
      if (hit) this.pick(this.tiles.findIndex((t) => t.mesh === hit.object));
    };
    this.ctx.director.app.canvas.addEventListener('pointerdown', this.onDown);
    this.refresh();
    p.msg(`Pick a mine count, bet, then ${ui.isTouch ? 'tap' : 'click'} tiles. Each gem raises the multiplier!`);
  }
  leave() { super.leave(); this.ctx.director.app.canvas.removeEventListener('pointerdown', this.onDown); }
  canLeave() { return this.phase !== 'play'; }

  refresh() {
    if (!this.panel) return;
    const cur = this.picks ? minesMult(this.mines, this.picks) * this.state.perkMult('mines') : 1;
    const next = minesMult(this.mines, this.picks + 1) * this.state.perkMult('mines');
    this.multEl.textContent = this.phase === 'play' ? `Now ${cur.toFixed(2)}× · next gem ${next.toFixed(2)}×` : `First gem pays ${next.toFixed(2)}×`;
    this.startBtn.innerHTML = (this.phase === 'play' ? (this.picks ? `Cash out ${fmtMoney(this.stake * cur)}` : 'Pick a tile…') : 'Start') + '<kbd>SPACE</kbd>';
    this.startBtn.className = 'btn big ' + (this.phase === 'play' ? (this.picks ? 'red pulse' : 'dark') : 'green');
    this.betCtl.disable(this.phase === 'play');
    this.cells.forEach((c, i) => {
      const t = this.tiles[i];
      c.querySelector('.nm').textContent = t.state === 'gem' ? '💎' : t.state === 'bomb' ? '💣' : t.state === 'ghost-gem' ? '·' : '?';
      c.style.opacity = t.state === 'ghost-gem' ? 0.4 : 1;
      c.classList.toggle('win', t.state === 'gem');
    });
  }

  start() {
    if (!this.takeBet(this.bet, 'mines')) return;
    this.stake = this.bet;
    this.layout = shuffle([...Array(N).keys()]).slice(0, this.mines);
    this.picks = 0;
    this.phase = 'play';
    for (const t of this.tiles) { t.state = 'hidden'; t.flip = 0; t.mesh.rotation.z = 0; t.mat.emissive.set(0x6a2aff); t.mat.color.set(0x3a1a6a); if (t.icon) { t.mesh.remove(t.icon); t.icon = null; } }
    audio.play('powerup', { vol: 0.5 });
    this.refresh();
    this.panel.msg(`${this.mines} bomb${this.mines > 1 ? 's' : ''} hidden. Good luck!`);
  }
  icon(t, bomb) {
    const g = new THREE.Group();
    if (bomb) { mesh(G.sphere(0.03, 14, 10), this.bombMat, 0, 0.035, 0, { parent: g }); mesh(G.cyl(0.004, 0.004, 0.025, 6), M.matte(0xaa8855), 0.0, 0.07, 0, { rz: 0.4, parent: g }); }
    else { mesh(G.octa(0.032), this.gemMat, 0, 0.045, 0, { s: [1, 1.3, 1], parent: g }); }
    t.mesh.add(g); t.icon = g;
  }
  pick(i) {
    if (this.phase !== 'play') return;
    const t = this.tiles[i];
    if (t.state !== 'hidden') return;
    t.flip = 1;
    if (this.layout.includes(i)) {
      t.state = 'bomb'; this.icon(t, true); t.mat.emissive.set(0xff2a2a); t.mat.emissiveIntensity = 2;
      audio.play('mineBoom', { pos: this.worldPos() });
      this.ctx.director.flash(0.45, 0xff3020);
      this.phase = 'over';
      this.state.lost(this.stake, 'mines');
      this.ctx.director.bigLoss(this.worldPos(), this.stake);
      this.panel.msg(`💥 BOOM! You lost ${fmtMoney(this.stake)}.`, 'lose');
      this.revealAll();
    } else {
      t.state = 'gem'; this.icon(t, false); t.mat.emissive.set(0x2affb0);
      this.picks++;
      audio.play('gem', { pos: this.worldPos(), p: this.picks * 2 });
      const left = N - this.mines - this.picks;
      if (left === 0) { this.cashOut(); return; }
      this.panel.msg(`💎 Gem! Multiplier ${(minesMult(this.mines, this.picks) * this.state.perkMult('mines')).toFixed(2)}×`, 'win');
    }
    this.refresh();
  }
  cashOut() {
    if (this.phase !== 'play' || !this.picks) return;
    const m = minesMult(this.mines, this.picks) * this.state.perkMult('mines');
    const gross = this.stake * m;
    this.state.payout(gross, this.stake, 'mines');
    this.phase = 'over';
    audio.play('cash', { pos: this.worldPos() });
    this.panel.msg(`Cashed out ${m.toFixed(2)}× → ${fmtMoney(gross)}`, 'win');
    this.celebrate(gross - this.stake, this.stake);
    this.revealAll();
    this.refresh();
  }
  revealAll() {
    this.tiles.forEach((t, i) => {
      if (t.state !== 'hidden') return;
      if (this.layout.includes(i)) { t.state = 'bomb'; this.icon(t, true); t.mat.emissive.set(0x5a1010); }
      else { t.state = 'ghost-gem'; t.mat.emissiveIntensity = 0.15; }
    });
    this.refresh();
  }
  update(dt, t) {
    for (const [i, tl] of this.tiles.entries()) {
      if (tl.flip > 0) { tl.flip = Math.max(0, tl.flip - dt * 4); tl.mesh.position.y = Math.sin(tl.flip * Math.PI) * 0.03; }
      if (tl.state === 'hidden') tl.mat.emissiveIntensity = 0.35 + 0.25 * Math.sin(t * 3 + i * 0.7);
      if (tl.icon) tl.icon.rotation.y += dt * 2;
    }
  }
}
