import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { Station, chipStack, flyTo } from './common.js';
import { G, mesh, smoothLathe } from '../engine/geo.js';
import { M } from '../engine/materials.js';
import { makeCanvas, toTex, cached, feltTexture } from '../engine/textures.js';
import { TAU, rand, fmtMoney, wait, easeOutCubic } from '../engine/util.js';
import { audio } from '../engine/audio.js';
import { h } from '../ui/ui.js';
import { FELT_COLORS, TABLE_TOP } from './tables.js';

// ============================================================================
//  SIC BO — three dice rattled in a glass dome shaker.
// ============================================================================

const DIE = 0.045;
const FACE_VALUES = [3, 4, 1, 6, 2, 5];
const AXES = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1)];
const TOTAL_PAY = { 4: 50, 5: 18, 6: 14, 7: 12, 8: 8, 9: 6, 10: 6, 11: 6, 12: 6, 13: 8, 14: 12, 15: 14, 16: 18, 17: 50 };

function pip(n) {
  return cached('sbpip' + n, () => {
    const S = 128; const { c, g } = makeCanvas(S);
    g.fillStyle = '#fbf8f0'; g.fillRect(0, 0, S, S);
    const P = { 1: [[0.5, 0.5]], 2: [[0.28, 0.28], [0.72, 0.72]], 3: [[0.25, 0.25], [0.5, 0.5], [0.75, 0.75]], 4: [[0.28, 0.28], [0.72, 0.28], [0.28, 0.72], [0.72, 0.72]], 5: [[0.25, 0.25], [0.75, 0.25], [0.5, 0.5], [0.25, 0.75], [0.75, 0.75]], 6: [[0.28, 0.22], [0.72, 0.22], [0.28, 0.5], [0.72, 0.5], [0.28, 0.78], [0.72, 0.78]] }[n];
    for (const [x, y] of P) { g.fillStyle = n === 1 || n === 4 ? '#c8102e' : '#141414'; g.beginPath(); g.arc(x * S, y * S, n === 1 ? 20 : 12, 0, TAU); g.fill(); }
    return toTex(c, { wrap: false });
  });
}
const dieMats = () => cached('sbmats', () => FACE_VALUES.map((v) => { const m = new THREE.MeshPhysicalMaterial({ map: pip(v), roughness: 0.25, clearcoat: 0.8 }); m.userData.shared = true; return m; }));

const BETS = [
  ...['small', 'big'].map((id) => ({ id, name: id === 'small' ? 'SMALL 4-10' : 'BIG 11-17', odds: '1:1 · loses on triples' })),
  { id: 'anytriple', name: 'ANY TRIPLE', odds: '30:1' },
  ...[1, 2, 3, 4, 5, 6].map((n) => ({ id: 'single' + n, name: `⚀ ${n}`, odds: '1/2/3:1' })),
  ...Object.keys(TOTAL_PAY).map((t) => ({ id: 'total' + t, name: `TOTAL ${t}`, odds: `${TOTAL_PAY[t]}:1` })),
  ...[1, 2, 3, 4, 5, 6].map((n) => ({ id: 'triple' + n, name: `${n}-${n}-${n}`, odds: '180:1' })),
];

export class SicBo extends Station {
  constructor(ctx, def) {
    super(ctx, def);
    this.label = 'Play Sic Bo';
    const k = 1 + (ctx.state.day - 1) * 0.5;
    this.limits = [5 * ctx.state.limitMult(), Math.round(1000 * k * ctx.state.limitMult())];
    this.footprint = { w: 2.3, d: 1.3, ox: 0, oz: 0 };
    this.interactLocal = new THREE.Vector3(0, 0, 1.2);
    this.interactR = 1.4;
    this.camLocal = { pos: new THREE.Vector3(0, 1.62, 1.05), look: new THREE.Vector3(0, 0.55, 0.05) };
    this.bets = {}; this.chip = this.limits[0];
    this.phase = 'bet';
    this.history = [];
  }
  promptText() { return [this.label, `Big, Small, triples · ${fmtMoney(this.limits[0])}–${fmtMoney(this.limits[1])}`]; }

  build() {
    const S = (this.static = new THREE.Group());
    S.position.copy(this.group.position); S.rotation.copy(this.group.rotation);
    this.ctx.director.world.staticRoot.add(S);
    const theme = this.state.casino.theme;
    mesh(G.rbox(2.3, TABLE_TOP - 0.05, 1.2, 0.08), M.wood('ebony', 2, 1), 0, (TABLE_TOP - 0.05) / 2, 0, { parent: S, cast: true });
    const ft = feltTexture(theme === 'neon' ? '#1a0f4a' : '#5a0a14');
    const { c, g } = makeCanvas(1024, 512);
    for (let x = 0; x < 1024; x += 512) g.drawImage(ft.map.image, x, 0);
    g.strokeStyle = '#ffd24a'; g.lineWidth = 4; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = 'bold 54px "Arial Black"'; g.fillStyle = '#ffd24a';
    g.strokeRect(40, 260, 300, 200); g.fillText('SMALL', 190, 340); g.font = 'bold 30px Georgia'; g.fillText('4 – 10 · 1 TO 1', 190, 400);
    g.font = 'bold 54px "Arial Black"'; g.strokeRect(684, 260, 300, 200); g.fillText('BIG', 834, 340); g.font = 'bold 30px Georgia'; g.fillText('11 – 17 · 1 TO 1', 834, 400);
    g.font = 'bold 40px "Arial Black"'; g.fillStyle = '#fff'; g.strokeRect(370, 300, 284, 160); g.fillText('ANY TRIPLE', 512, 360); g.font = 'bold 30px Georgia'; g.fillText('30 TO 1', 512, 410);
    g.fillStyle = 'rgba(255,211,106,0.85)'; g.font = 'italic bold 40px Georgia'; g.fillText('大 小  SIC BO', 512, 490);
    mesh(G.plane(2.2, 1.1), new THREE.MeshStandardMaterial({ map: toTex(c, { wrap: false }), roughness: 0.9 }), 0, TABLE_TOP - 0.049, 0, { rx: -Math.PI / 2, parent: S });
    mesh(G.box(2.3, 0.06, 0.08), M.leather('#2a0f0a', false, 4, 1), 0, TABLE_TOP - 0.02, 0.6, { parent: S });
    // shaker base + dome
    const base = (this.base = new THREE.Group());
    base.position.set(0, TABLE_TOP - 0.05, -0.32);
    this.group.add(base);
    mesh(smoothLathe('sbbase', [[0, 0], [0.22, 0], [0.24, 0.04], [0.2, 0.09], [0.0, 0.09]], 12, 40), M.gold(), 0, 0, 0, { parent: base, cast: true });
    mesh(G.cyl(0.19, 0.19, 0.01, 40), M.velvet(0x6a0a1a), 0, 0.092, 0, { parent: base });
    this.domeMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.02, transparent: true, opacity: 0.18, envMapIntensity: 1.6, clearcoat: 1, depthWrite: false, side: THREE.DoubleSide });
    this.dome = mesh(G.sphere(0.2, 32, 16), this.domeMat, 0, 0.095, 0, { parent: base });
    this.dome.scale.set(1, 0.85, 1);
    this.dome.geometry = new THREE.SphereGeometry(0.2, 32, 16, 0, TAU, 0, Math.PI / 2);
    mesh(G.torus(0.2, 0.012, 8, 40), M.gold(), 0, 0.095, 0, { rx: Math.PI / 2, parent: base });
    mesh(G.sphere(0.025, 12, 10), M.gold(), 0, 0.27, 0, { parent: base });
    this.dice = [];
    const geo = new RoundedBoxGeometry(DIE, DIE, DIE, 3, DIE * 0.12);
    for (let i = 0; i < 3; i++) {
      const d = new THREE.Mesh(geo, dieMats());
      const a = (i / 3) * TAU;
      d.position.set(Math.cos(a) * 0.07, 0.12, Math.sin(a) * 0.07);
      d.castShadow = true;
      base.add(d);
      this.dice.push({ mesh: d, home: d.position.clone(), q0: new THREE.Quaternion(), q1: new THREE.Quaternion() });
    }
    // dealer button
    this.btnMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xff3a3a, emissiveIntensity: 1 });
    mesh(G.cyl(0.04, 0.04, 0.03, 20), this.btnMat, 0.5, TABLE_TOP - 0.03, -0.45, { parent: this.group });
    this.chipsGroup = new THREE.Group(); this.group.add(this.chipsGroup);
    this.watchSpot = (() => { const w = this.w(0, 0, 2.2); return { x: w.x, z: w.z, lx: this.group.position.x, lz: this.group.position.z, station: this }; })();
  }
  spawnStaff(crowd) {
    const p = this.w(0.3, 0, -0.95);
    this.dealer = crowd.staff('dealer', { x: p.x, z: p.z, ry: this.group.rotation.y }, (n) => {
      if (!this.reach) n.jelly.setAction(this.phase === 'shake' ? 'cheer' : 'deal');
      n.jelly.lookTarget = this.phase === 'shake' ? this.w(0, 1.0, -0.32) : null;
    });
  }

  enter() {
    super.enter();
    const ui = this.ui;
    const p = (this.panel = ui.openPanel({ title: 'Sic Bo', limits: '', onLeave: () => this.ctx.director.leaveStation() }));
    this.chipCtl = ui.betControl({ min: this.limits[0], max: this.limits[1], value: this.chip, getMoney: () => this.state.money, onChange: (v) => (this.chip = v), label: 'Chip' });
    const grid = ui.grid(9, 6, 'compact'); grid.style.setProperty('--cspan3', 2);
    this.cells = {};
    for (const b of BETS) {
      const cell = h('div', 'betcell interactive', `<div class="nm">${b.name}</div><div class="od">${b.odds}</div>`);
      if (b.id === 'small' || b.id === 'big' || b.id === 'anytriple') cell.classList.add('span3');
      cell.onclick = () => this.addBet(b.id);
      cell.oncontextmenu = (e) => { e.preventDefault(); delete this.bets[b.id]; this.renderBets(); };
      this.cells[b.id] = cell; grid.append(cell);
    }
    const row = h('div', 'row');
    this.histEl = h('div', 'history');
    row.append(ui.button('Clear', 'dark small', () => { this.bets = {}; this.renderBets(); }), ui.button('Rebet', 'dark small', () => { if (this.lastBets) { this.bets = { ...this.lastBets }; this.renderBets(); } }, 'KeyR', 'R'), ui.button('Shake!', 'big green', () => this.shake(), 'Space', 'SPACE'), this.histEl);
    p.body.append(this.chipCtl.el, grid, row);
    this.renderBets();
    p.msg('Bet on the three dice, then shake the dome!');
  }
  canLeave() { return this.phase === 'bet'; }
  totalBet() { return Object.values(this.bets).reduce((a, b) => a + b, 0); }
  addBet(id) {
    if (this.phase !== 'bet') return;
    if (this.totalBet() + this.chip > this.limits[1]) { this.ui.toast('Table maximum reached.', 'bad'); return; }
    if (this.totalBet() + this.chip > this.state.money) { this.ui.toast('Not enough cash.', 'bad'); audio.play('deny'); return; }
    this.bets[id] = (this.bets[id] || 0) + this.chip; audio.play('chip'); this.renderBets();
  }
  renderBets() {
    this.chipsGroup.clear();
    let k = 0;
    for (const [id, amt] of Object.entries(this.bets)) {
      const pos = id === 'small' ? [-0.75, 0.18] : id === 'big' ? [0.75, 0.18] : id === 'anytriple' ? [0, 0.22] : [-0.4 + (k++ % 8) * 0.11, 0.42];
      const st = chipStack(amt); st.position.set(pos[0], TABLE_TOP - 0.049, pos[1]); this.chipsGroup.add(st);
    }
    if (!this.panel) return;
    for (const b of BETS) { const c = this.cells[b.id]; c.querySelector('.amt') && c.querySelector('.amt').remove(); if (this.bets[b.id]) c.insertAdjacentHTML('beforeend', `<span class="amt">${fmtMoney(this.bets[b.id])}</span>`); c.classList.remove('win'); }
    this.panel.setLimits(`Total bet ${fmtMoney(this.totalBet())}`);
    this.histEl.innerHTML = this.history.slice(-8).map((r) => `<i style="background:${r.reduce((a, b) => a + b, 0) >= 11 ? '#c81a34' : '#1a6ad8'}">${r.join('')}</i>`).join('');
  }

  async shake() {
    if (this.phase !== 'bet') return;
    const total = this.totalBet();
    if (!total) { this.panel.msg('Place a bet first!', 'lose'); audio.play('deny'); return; }
    if (!this.takeBet(total, 'sicbo')) return;
    this.lastBets = { ...this.bets };
    this.phase = 'shake';
    const res = [1 + Math.floor(rand() * 6), 1 + Math.floor(rand() * 6), 1 + Math.floor(rand() * 6)];
    this.result = res;
    this.ctx.director.player.retarget(this.w(0, 1.3, 0.35), this.w(0, 0.62, -0.1), 0.6);
    if (this.dealer) { this.dealer.jelly.setReach(1, this.w(0.5, TABLE_TOP + 0.05, -0.45), 'point'); setTimeout(() => this.dealer && this.dealer.jelly.setReach(1, null), 600); }
    // final orientations
    this.dice.forEach((d, i) => {
      const ai = FACE_VALUES.indexOf(res[i]);
      d.q1.setFromUnitVectors(AXES[ai], new THREE.Vector3(0, 1, 0));
      d.q1.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * TAU));
      d.final = new THREE.Vector3(Math.cos((i / 3) * TAU + rand() * 0.6) * 0.075, 0.12, Math.sin((i / 3) * TAU + rand() * 0.6) * 0.075);
    });
    this.shakeT = 0;
    audio.play('dice', { pos: this.worldPos() });
    await wait(2600);
    this.settle();
  }

  settle() {
    const [a, b, c] = this.result;
    const sum = a + b + c, triple = a === b && b === c;
    this.history.push(this.result.slice());
    let gross = 0;
    const total = this.totalBet();
    for (const [id, amt] of Object.entries(this.bets)) {
      let pay = -1;
      if (id === 'small' && sum <= 10 && !triple) pay = 1;
      else if (id === 'big' && sum >= 11 && !triple) pay = 1;
      else if (id === 'anytriple' && triple) pay = 30;
      else if (id.startsWith('single')) { const n = +id.slice(6); const k = this.result.filter((x) => x === n).length; if (k) pay = k; }
      else if (id.startsWith('total') && sum === +id.slice(5)) pay = TOTAL_PAY[sum];
      else if (id.startsWith('triple') && triple && a === +id.slice(6)) pay = 180;
      if (pay > 0) { gross += amt * (pay + 1); this.cells && this.cells[id] && this.cells[id].classList.add('win'); }
    }
    if (gross > total) gross = total + (gross - total) * this.state.perkMult('sicbo');
    if (gross > 0) this.state.payout(gross, total, 'sicbo');
    if (gross < total) this.state.lost(total - gross, 'sicbo');
    const profit = gross - total;
    this.panel && this.panel.msg(`${a} · ${b} · ${c} = ${sum}${triple ? ' TRIPLE!' : sum <= 10 ? ' SMALL' : ' BIG'}${profit > 0 ? ' · +' + fmtMoney(profit) : profit < 0 ? ' · -' + fmtMoney(-profit) : ''}`, profit > 0 ? 'win' : profit < 0 ? 'lose' : '');
    if (this.dealer) this.dealer.say(`${a}, ${b}, ${c}! ${sum} ${triple ? 'triple!' : sum <= 10 ? 'small' : 'big'}!`);
    audio.play('ding', { pos: this.worldPos() });
    if (profit > 0) this.celebrate(profit, total); else if (profit < 0) { audio.play('lose', { vol: 0.5 }); this.ctx.director.bigLoss(this.worldPos(), -profit); }
    setTimeout(() => {
      this.bets = {}; this.phase = 'bet'; this.renderBets();
      const pose = this.camPose(); if (this.active) this.ctx.director.player.retarget(pose.pos, pose.look, 0.6);
    }, 1800);
  }

  update(dt, t) {
    if (this.phase === 'shake') {
      this.shakeT += dt;
      const k = this.shakeT;
      this.base.position.y = TABLE_TOP - 0.05 + (k < 1.6 ? Math.abs(Math.sin(k * 40)) * 0.012 : 0);
      for (const [i, d] of this.dice.entries()) {
        if (k < 1.6) {
          d.mesh.position.set(Math.sin(k * 23 + i * 2) * 0.09, 0.13 + Math.abs(Math.sin(k * 31 + i * 1.7)) * 0.08, Math.cos(k * 19 + i * 2.6) * 0.09);
          d.mesh.rotation.x += dt * (18 + i * 3); d.mesh.rotation.z += dt * (14 + i * 4);
          d.q0.copy(d.mesh.quaternion); d.p0 = d.mesh.position.clone();
          if (Math.random() < 0.3) audio.play('diceHit', { pos: this.worldPos(), vol: 0.4 });
        } else if (k < 2.2) {
          const kk = easeOutCubic((k - 1.6) / 0.6);
          d.mesh.position.lerpVectors(d.p0, d.final, kk); d.mesh.position.y += Math.sin(kk * Math.PI) * 0.04;
          d.mesh.quaternion.slerpQuaternions(d.q0, d.q1, kk);
        } else { d.mesh.position.copy(d.final); d.mesh.quaternion.copy(d.q1); }
      }
    }
    this.btnMat.emissiveIntensity = this.phase === 'bet' ? 0.8 + Math.sin(t * 4) * 0.4 : 2.5;
  }
}
