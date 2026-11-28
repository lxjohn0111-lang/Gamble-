import * as THREE from 'three';
import { Station, BulbArray } from './common.js';
import { G, mesh } from '../engine/geo.js';
import { M } from '../engine/materials.js';
import { makeCanvas, toTex, cached } from '../engine/textures.js';
import { TAU, rand, fmtMoney, clamp, weightedPick } from '../engine/util.js';
import { audio } from '../engine/audio.js';
import { h } from '../ui/ui.js';

// ============================================================================
//  WHEEL OF JELLY — a giant Big-Six money wheel with a leather clapper.
// ============================================================================

const SEGS = [
  // player-friendly pays: every symbol pays back 102-104% (n/54 x (pay + 1))
  { id: '1', label: '$1', pay: 1.3, n: 24, color: '#f2c94c' },
  { id: '2', label: '$2', pay: 3, n: 14, color: '#56ccf2' },
  { id: '5', label: '$5', pay: 6, n: 8, color: '#bb6bd9' },
  { id: '10', label: '$10', pay: 13, n: 4, color: '#27ae60' },
  { id: '20', label: '$20', pay: 27, n: 2, color: '#eb5757' },
  { id: 'J', label: 'JELLY', pay: 55, n: 1, color: '#ff7eb3' },
  { id: 'L', label: 'GAMBLE!', pay: 55, n: 1, color: '#111111' },
];
const N = 54;
function layout() {
  // spread segments around the wheel like a real Big Six
  const order = [];
  const pools = SEGS.map((s) => ({ s, left: s.n, acc: 0 }));
  for (let i = 0; i < N; i++) {
    for (const p of pools) p.acc += p.s.n;
    let best = null;
    for (const p of pools) if (p.left > 0 && (!best || p.acc > best.acc)) best = p;
    best.acc -= N; best.left--;
    order.push(best.s);
  }
  // put the two jackpots opposite each other at the top/bottom
  return order;
}
const ORDER = layout();

function wheelTexture() {
  return cached('bigwheel', () => {
    const S = 2048, c0 = S / 2, R = S / 2 - 8;
    const { c, g } = makeCanvas(S);
    g.fillStyle = '#1a0a04'; g.beginPath(); g.arc(c0, c0, R, 0, TAU); g.fill();
    const step = TAU / N;
    for (let i = 0; i < N; i++) {
      const s = ORDER[i];
      const a0 = -Math.PI / 2 + i * step - step / 2, a1 = a0 + step;
      const gr = g.createRadialGradient(c0, c0, R * 0.3, c0, c0, R);
      gr.addColorStop(0, s.color); gr.addColorStop(1, s.color === '#111111' ? '#333' : s.color);
      g.fillStyle = gr;
      g.beginPath(); g.moveTo(c0, c0); g.arc(c0, c0, R * 0.96, a0, a1); g.closePath(); g.fill();
      g.strokeStyle = '#d8b04a'; g.lineWidth = 6; g.stroke();
      // label along the radius
      g.save(); g.translate(c0, c0); g.rotate(a0 + step / 2);
      g.fillStyle = s.id === 'L' ? '#ffd24a' : '#111'; g.font = `bold ${s.label.length > 3 ? 42 : 72}px "Arial Black", Impact, sans-serif`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.translate(R * 0.8, 0); g.rotate(Math.PI / 2);
      g.fillText(s.label, 0, 0);
      g.restore();
    }
    // hub
    const hub = g.createRadialGradient(c0 - 40, c0 - 40, 20, c0, c0, R * 0.32);
    hub.addColorStop(0, '#fff3b0'); hub.addColorStop(0.6, '#d8a030'); hub.addColorStop(1, '#6a4008');
    g.fillStyle = hub; g.beginPath(); g.arc(c0, c0, R * 0.3, 0, TAU); g.fill();
    g.fillStyle = '#5a0a14'; g.beginPath(); g.arc(c0, c0, R * 0.25, 0, TAU); g.fill();
    g.fillStyle = '#ffd24a'; g.font = 'bold 120px "Arial Black", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('WHEEL', c0, c0 - 60); g.font = 'bold 92px "Arial Black", sans-serif'; g.fillText('OF JELLY', c0, c0 + 70);
    return toTex(c, { wrap: false });
  });
}

export class BigWheel extends Station {
  constructor(ctx, def) {
    super(ctx, def);
    this.label = 'Spin the Wheel of Jelly';
    this.limits = [1 * ctx.state.limitMult(), Math.round(200 * (1 + (ctx.state.day - 1) * 0.5) * ctx.state.limitMult())];
    this.footprint = { w: 2.8, d: 1.3, ox: 0, oz: 0.1 };
    this.interactLocal = new THREE.Vector3(0, 0, 1.6);
    this.interactR = 1.7;
    this.camLocal = { pos: new THREE.Vector3(0, 1.75, 2.2), look: new THREE.Vector3(0, 1.85, 0) };
    this.bets = {}; this.lastBets = {};
    this.chip = this.limits[0] * 5;
    this.angle = 0; this.spinning = false;
    this.history = [];
  }
  promptText() { return [this.label, `Big Six money wheel · up to 55:1 · ${fmtMoney(this.limits[0])}–${fmtMoney(this.limits[1])}`]; }

  build() {
    const S = (this.static = new THREE.Group());
    S.position.copy(this.group.position); S.rotation.copy(this.group.rotation);
    this.ctx.director.world.staticRoot.add(S);
    const wood = M.wood('mahogany', 1, 2), gold = M.gold();
    const cy = 2.0, R = 1.15;
    this.cy = cy; this.R = R;
    // stand
    mesh(G.rbox(1.6, 0.25, 0.8, 0.04), wood, 0, 0.125, -0.2, { parent: S, cast: true });
    for (const s of [-1, 1]) mesh(G.rbox(0.18, cy + 0.2, 0.18, 0.03), wood, s * 0.55, (cy + 0.2) / 2, -0.32, { rz: s * 0.08, parent: S, cast: true });
    mesh(G.cyl(0.08, 0.08, 1.3, 16), gold, 0, cy, -0.32, { rz: Math.PI / 2, parent: S });
    // outer bulb ring frame
    mesh(G.torus(R + 0.12, 0.06, 12, 96), wood, 0, cy, -0.18, { parent: S, cast: true });
    mesh(G.torus(R + 0.19, 0.02, 8, 96), gold, 0, cy, -0.16, { parent: S });
    // marquee header
    const { c, g } = makeCanvas(1024, 192);
    g.fillStyle = '#3a0a10'; g.fillRect(0, 0, 1024, 192);
    g.font = 'bold 110px "Arial Black", Impact, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 12; g.strokeStyle = '#000'; g.strokeText('WHEEL OF JELLY', 512, 100);
    const gg = g.createLinearGradient(0, 40, 0, 160); gg.addColorStop(0, '#fff6b0'); gg.addColorStop(1, '#e8a030'); g.fillStyle = gg; g.fillText('WHEEL OF JELLY', 512, 100);
    mesh(G.rbox(2.3, 0.45, 0.12, 0.04), M.lacquer(0x3a0a10), 0, cy + R + 0.55, -0.2, { parent: S });
    mesh(G.plane(2.2, 0.41), new THREE.MeshBasicMaterial({ map: toTex(c, { wrap: false }), color: new THREE.Color(1.5, 1.5, 1.5) }), 0, cy + R + 0.55, -0.135, { parent: S });
    // betting counter with layout
    const tc = makeCanvas(1024, 320);
    const tg = tc.g; tg.fillStyle = '#0f3a24'; tg.fillRect(0, 0, 1024, 320);
    SEGS.forEach((s, i) => {
      const x = 20 + i * 140, w = 130;
      tg.fillStyle = s.color; tg.fillRect(x, 40, w, 190); tg.strokeStyle = '#ffd24a'; tg.lineWidth = 5; tg.strokeRect(x, 40, w, 190);
      tg.fillStyle = s.id === 'L' ? '#ffd24a' : '#111'; tg.font = `bold ${s.label.length > 3 ? 30 : 56}px "Arial Black"`; tg.textAlign = 'center'; tg.fillText(s.label, x + w / 2, 140);
      tg.fillStyle = '#fff'; tg.font = 'bold 28px Georgia'; tg.fillText(`${s.pay}:1`, x + w / 2, 285);
    });
    mesh(G.rbox(2.5, 0.9, 0.7, 0.04), wood, 0, 0.45, 1.0, { parent: S, cast: true });
    mesh(G.plane(2.4, 0.62), new THREE.MeshStandardMaterial({ map: toTex(tc.c, { wrap: false }), roughness: 0.9 }), 0, 0.905, 1.0, { rx: -Math.PI / 2, parent: S });
    mesh(G.rbox(2.55, 0.05, 0.75, 0.02), gold, 0, 0.88, 1.0, { parent: S });
    // ---- dynamic: wheel, pegs, bulbs, clapper
    const wheel = (this.wheel = new THREE.Group());
    wheel.position.set(0, cy, -0.12);
    this.group.add(wheel);
    mesh(G.cyl(R, R, 0.06, 96), M.wood('walnut', 1, 1), 0, 0, -0.04, { rx: Math.PI / 2, parent: wheel });
    const face = mesh(G.circle(R * 0.985, 96), new THREE.MeshPhysicalMaterial({ map: wheelTexture(), roughness: 0.55, clearcoat: 0.5, clearcoatRoughness: 0.35 }), 0, 0, -0.008, { parent: wheel });
    face.receiveShadow = true;
    const pegs = new THREE.InstancedMesh(G.cyl(0.012, 0.012, 0.09, 8), M.brass(), N);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < N; i++) {
      const a = Math.PI / 2 + (i + 0.5) * (TAU / N);
      m4.compose(new THREE.Vector3(Math.cos(a) * (R - 0.015), Math.sin(a) * (R - 0.015), 0.03), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2), new THREE.Vector3(1, 1, 1));
      pegs.setMatrixAt(i, m4);
    }
    wheel.add(pegs);
    mesh(G.sphere(0.12, 20, 14), gold, 0, 0, 0.02, { s: [1, 1, 0.5], parent: wheel });
    // rim bulbs (static ring, chasing)
    this.bulbs = new BulbArray(Array.from({ length: 40 }, (_, i) => { const a = (i / 40) * TAU; return new THREE.Vector3(Math.cos(a) * (R + 0.12), cy + Math.sin(a) * (R + 0.12), -0.11); }), 0.03, 0xffe08a, 0x3a2410, 3);
    this.group.add(this.bulbs.mesh);
    // clapper at the top
    const cl = (this.clapper = new THREE.Group());
    cl.position.set(0, cy + R + 0.12, 0.0);
    mesh(G.box(0.08, 0.06, 0.08), gold, 0, 0, 0, { parent: cl });
    const flap = (this.flap = new THREE.Group()); cl.add(flap);
    const fm = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.26, 3), M.leather('#5a1010', false));
    fm.rotation.z = Math.PI; fm.position.y = -0.13; fm.scale.set(1, 1, 0.25);
    flap.add(fm);
    this.group.add(cl);
    this.flapV = 0; this.flapA = 0;
    this.watchSpot = (() => { const w = this.w(0, 0, 2.4); return { x: w.x, z: w.z, lx: this.group.position.x, lz: this.group.position.z, station: this }; })();
  }

  spawnStaff(crowd) {
    const p = this.w(1.75, 0, -0.05);
    this.host = crowd.staff('dealer', { x: p.x, z: p.z, ry: this.group.rotation.y - 0.4 }, (n) => {
      if (!this.spinning) n.jelly.setAction(this.active ? 'talk' : 'deal');
      else n.jelly.setAction('cheer');
      const pl = crowd.player; n.jelly.lookTarget = pl && n.root.position.distanceToSquared(pl.pos) < 25 ? pl.camera.position : null;
    });
  }

  totalBet() { return Object.values(this.bets).reduce((a, b) => a + b, 0); }

  enter() {
    super.enter();
    const ui = this.ui;
    const p = (this.panel = ui.openPanel({ title: 'Wheel of Jelly', limits: `Max total ${fmtMoney(this.limits[1])}`, onLeave: () => this.ctx.director.leaveStation() }));
    this.chipCtl = ui.betControl({ min: this.limits[0], max: this.limits[1], value: this.chip, getMoney: () => this.state.money, onChange: (v) => (this.chip = v), label: 'Chip' });
    const grid = ui.grid(7, 4);
    this.cells = {};
    for (const s of SEGS) {
      const cell = h('div', 'betcell interactive', `<div class="nm" style="color:${s.id === 'L' ? '#ffd24a' : s.color}">${s.label}</div><div class="od">${s.pay}:1 · ${s.n}/54</div>`);
      cell.onclick = () => this.addBet(s.id);
      cell.oncontextmenu = (e) => { e.preventDefault(); delete this.bets[s.id]; this.renderBets(); };
      this.cells[s.id] = cell; grid.append(cell);
    }
    const row = h('div', 'row');
    this.spinBtn = ui.button('Spin!', 'big green', () => this.spin(), 'Space', 'SPACE');
    row.append(ui.button('Clear', 'dark small', () => { this.bets = {}; this.renderBets(); }), ui.button('Rebet', 'dark small', () => { this.bets = { ...this.lastBets }; this.renderBets(); }, 'KeyR', 'R'), this.spinBtn);
    this.histEl = h('div', 'history');
    p.body.append(this.chipCtl.el, grid, row, this.histEl);
    this.renderBets();
    p.msg(`${ui.isTouch ? 'Tap' : 'Click'} a symbol to bet on it, then spin!`);
  }
  canLeave() { return !this.spinning; }

  addBet(id) {
    if (this.spinning) return;
    if (this.totalBet() + this.chip > this.limits[1]) { this.ui.toast('Table maximum reached.', 'bad'); return; }
    if (this.totalBet() + this.chip > this.state.money) { this.ui.toast('Not enough cash.', 'bad'); audio.play('deny'); return; }
    this.bets[id] = (this.bets[id] || 0) + this.chip;
    audio.play('chip');
    this.renderBets();
  }
  renderBets() {
    for (const s of SEGS) {
      const c = this.cells[s.id];
      c.querySelector('.amt') && c.querySelector('.amt').remove();
      if (this.bets[s.id]) c.insertAdjacentHTML('beforeend', `<span class="amt">${fmtMoney(this.bets[s.id])}</span>`);
      c.classList.remove('win');
    }
    if (this.panel) this.panel.setLimits(`Total bet ${fmtMoney(this.totalBet())} · max ${fmtMoney(this.limits[1])}`);
    this.histEl.innerHTML = this.history.slice(-14).map((s) => `<i style="background:${s.color};color:${s.id === 'L' ? '#ffd24a' : '#111'}">${s.label}</i>`).join('');
  }

  spin() {
    if (this.spinning) return;
    const total = this.totalBet();
    if (total <= 0) { this.panel.msg('Place a bet first — click a symbol.', 'lose'); audio.play('deny'); return; }
    if (!this.takeBet(total, 'wheel')) return;
    this.lastBets = { ...this.bets };
    this.spinning = true;
    // outcome: uniform over the 54 physical segments
    const idx = Math.floor(rand() * N);
    this.result = ORDER[idx];
    const step = TAU / N;
    const cur = this.angle;
    // wheel angle a shows segment i at the top when a ≡ i*step (counter-rotate)
    let target = idx * step + (rand() - 0.5) * step * 0.7;
    const turns = 3 + Math.floor(rand() * 2);
    let delta = ((target - (cur % TAU)) % TAU + TAU) % TAU + turns * TAU;
    this.spinAnim = { from: cur, delta, t: 0, dur: 7 + rand() * 1.5 };
    this.panel.msg('Round and round it goes…');
    audio.play('whoosh', { pos: this.worldPos() });
    if (this.host) this.host.say(['Round and round!', 'Where she stops, nobody knows!', 'Big money!'][Math.floor(rand() * 3)]);
    this.ctx.director.player.retarget(this.w(0, 1.9, 1.9), this.w(0, 2.3, 0), 0.8);
  }

  finish() {
    this.spinning = false;
    const s = this.result;
    this.history.push(s);
    const stake = this.lastBetTotal = Object.values(this.lastBets).reduce((a, b) => a + b, 0);
    let gross = 0;
    if (this.bets[s.id]) gross = this.bets[s.id] * (s.pay + 1) * this.state.perkMult('wheel');
    if (this.cells && this.cells[s.id]) this.cells[s.id].classList.add('win');
    if (gross > 0) {
      this.state.payout(gross, stake, 'wheel');
      this.panel && this.panel.msg(`${s.label}! You win ${fmtMoney(gross)}`, 'win');
      this.celebrate(gross - stake, stake);
    } else {
      this.state.lost(stake, 'wheel');
      this.panel && this.panel.msg(`${s.label}. No win this time.`, 'lose');
      audio.play('lose', { vol: 0.5 });
      this.ctx.director.bigLoss(this.worldPos(), stake);
    }
    this.flashT = 3;
    setTimeout(() => { if (this.active) { this.renderBets(); const pose = this.camPose(); this.ctx.director.player.retarget(pose.pos, pose.look, 0.8); } }, 1600);
  }

  update(dt, t) {
    const a = this.spinAnim;
    const step = TAU / N;
    const prev = this.angle;
    if (a) {
      a.t += dt;
      const k = Math.min(1, a.t / a.dur);
      const e = 1 - Math.pow(1 - k, 3.2);
      this.angle = a.from + a.delta * e;
      if (k >= 1) { this.spinAnim = null; this.finish(); }
    } else if (!this.spinning) {
      this.angle += dt * 0.05; // lazy idle drift
    }
    this.wheel.rotation.z = this.angle;
    // pegs passing the clapper
    const pegsPrev = Math.floor((prev + step / 2) / step), pegsNow = Math.floor((this.angle + step / 2) / step);
    if (pegsNow !== pegsPrev && this.spinAnim) {
      this.flapV += 7 + Math.min(14, (this.angle - prev) / Math.max(dt, 1e-3) * 1.5);
      audio.play('tick', { pos: this.w(0, this.cy + this.R, 0), vol: 0.9 });
    }
    // clapper spring
    this.flapV += (-60 * this.flapA - 7 * this.flapV) * dt;
    this.flapA = clamp(this.flapA + this.flapV * dt, -0.2, 0.9);
    this.flap.rotation.z = -this.flapA;
    // bulbs
    this.flashT = Math.max(0, (this.flashT || 0) - dt);
    const st = Math.floor(t * (this.spinning ? 18 : this.flashT > 0 ? 8 : 3));
    for (let i = 0; i < this.bulbs.n; i++) this.bulbs.set(i, this.flashT > 0 ? st % 2 === 0 : (i + st) % (this.spinning ? 5 : 10) === 0);
    this.bulbs.commit();
  }
}
