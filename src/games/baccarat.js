import * as THREE from 'three';
import { Station, Card, Shoe, dealCard, chipStack, flyTo, Screen, RANKS } from './common.js';
import { halfMoonTable, curvedText, limitSign, cardShoe, TABLE_TOP } from './tables.js';
import { G, mesh } from '../engine/geo.js';
import { M } from '../engine/materials.js';
import { audio } from '../engine/audio.js';
import { fmtMoney, wait, rand, TAU, easeInOutCubic } from '../engine/util.js';
import { h } from '../ui/ui.js';

// ============================================================================
//  BACCARAT — Punto Banco with card squeezes and a bead-road scoreboard.
// ============================================================================

const BETS = [
  { id: 'player', name: 'PLAYER', pay: 1, color: '#2a7de1' },
  { id: 'banker', name: 'BANKER', pay: 0.95, color: '#e12a3a' },
  { id: 'tie', name: 'TIE', pay: 8, color: '#2ab35a' },
  { id: 'ppair', name: 'P PAIR', pay: 11, color: '#6aa8ff' },
  { id: 'bpair', name: 'B PAIR', pay: 11, color: '#ff6a7a' },
];
const pts = (cards) => cards.reduce((a, c) => a + Math.min(10, RANKS.indexOf(c.rank) + 1) % 10, 0) % 10;

export class Baccarat extends Station {
  constructor(ctx, def) {
    super(ctx, def);
    this.label = 'Play Baccarat';
    const k = 1 + (ctx.state.day - 1) * 0.5;
    this.limits = [10 * ctx.state.limitMult(), Math.round(2000 * k * ctx.state.limitMult())];
    this.footprint = { w: 2.7, d: 1.6, ox: 0, oz: 0 };
    this.interactLocal = new THREE.Vector3(0, 0, 1.25);
    this.interactR = 1.5;
    this.camLocal = { pos: new THREE.Vector3(0, 1.32, 0.88), look: new THREE.Vector3(0, 0.76, -0.22) };
    this.shoe = new Shoe(8);
    this.bets = {};
    this.chip = this.limits[0];
    this.phase = 'bet';
    this.cards = [];
    this.road = [];
  }
  promptText() { return [this.label, `Punto Banco · Banker pays 19:20 · ${fmtMoney(this.limits[0])}–${fmtMoney(this.limits[1])}`]; }

  build() {
    const theme = this.state.casino.theme;
    const table = halfMoonTable(theme, {
      railColor: '#1a0a1a',
      feltDraw: (g, t) => {
        const [cx, cy] = t.toCanvas(0, t.back);
        const px = t.pxPerM;
        curvedText(g, 'BACCARAT · PUNTO BANCO', cx, cy, px * 0.95, Math.PI / 2, { font: `bold ${Math.round(px * 0.08)}px Georgia, serif`, color: '#ffd36a', inside: true });
        // player's betting area
        const boxes = [['PLAYER', '#2a7de1', -0.36, 0.14, 0.24], ['TIE 8:1', '#2ab35a', -0.12, 0.14, 0.24], ['BANKER', '#e12a3a', 0.12, 0.14, 0.24], ['P PAIR', '#6aa8ff', -0.36, 0.38, 0.12], ['B PAIR', '#ff6a7a', 0.24, 0.38, 0.12]];
        for (const [txt, col, x, z, w] of boxes) {
          const [bx, by] = t.toCanvas(x, z);
          g.strokeStyle = col; g.lineWidth = px * 0.008; g.strokeRect(bx, by, w * px, 0.17 * px);
          g.fillStyle = col; g.font = `bold ${Math.round(px * 0.045)}px "Arial Black"`; g.textAlign = 'center'; g.textBaseline = 'middle';
          g.fillText(txt, bx + (w * px) / 2, by + 0.085 * px);
        }
        // card boxes
        for (const [txt, x] of [['PLAYER', -0.32], ['BANKER', 0.12]]) {
          const [bx, by] = t.toCanvas(x, t.back + 0.12);
          g.strokeStyle = 'rgba(255,211,106,0.6)'; g.lineWidth = 4; g.strokeRect(bx, by, 0.2 * px, 0.18 * px);
          g.fillStyle = 'rgba(255,211,106,0.7)'; g.font = `bold ${Math.round(px * 0.03)}px Georgia`; g.fillText(txt, bx + 0.1 * px, by + 0.21 * px);
        }
      },
    });
    this.table = table;
    const S = (this.static = table.staticGroup);
    S.position.copy(this.group.position); S.rotation.copy(this.group.rotation);
    this.ctx.director.world.staticRoot.add(S);
    const shoe = cardShoe(); shoe.position.set(0.85, TABLE_TOP, table.back + 0.25); shoe.rotation.y = -0.6; S.add(shoe);
    const sign = limitSign(`BACCARAT\n${fmtMoney(this.limits[0])} - ${fmtMoney(this.limits[1])}`, '#ff6a7a'); sign.position.set(-0.6, TABLE_TOP, table.back + 0.05); S.add(sign);
    this.shoePos = new THREE.Vector3(0.82, TABLE_TOP + 0.12, table.back + 0.35);
    // scoreboard monitor on a pole
    this.board = new Screen(512, 256, 1.4);
    const pole = new THREE.Group();
    mesh(G.cyl(0.025, 0.03, 1.6, 10), M.chrome(), 0, 0.8, 0, { parent: pole });
    mesh(G.rbox(0.62, 0.34, 0.05, 0.02), M.blackMetal(), 0, 1.75, 0, { parent: pole });
    mesh(G.plane(0.58, 0.29), this.board.mat, 0, 1.75, 0.026, { parent: pole });
    pole.position.set(1.15, 0, table.back - 0.1); pole.rotation.y = -0.5;
    this.group.add(pole);
    this.drawRoad();
    table.seats.forEach((sp, i) => { if (i === 2) return; this.registerSeat(new THREE.Vector3(sp.x, 0, sp.z), sp.ry, { kind: 'table', seat: 0.72, action: 'cards' }); });
    this.watchSpot = (() => { const w = this.w(0, 0, 2.3); return { x: w.x, z: w.z, lx: this.group.position.x, lz: this.group.position.z, station: this }; })();
    this.chipsGroup = new THREE.Group(); this.group.add(this.chipsGroup);
    this.cardGroup = new THREE.Group(); this.group.add(this.cardGroup);
  }

  drawRoad() {
    const { g, w, h: hh } = this.board;
    g.fillStyle = '#f4f1ea'; g.fillRect(0, 0, w, hh);
    g.fillStyle = '#1a1a2a'; g.fillRect(0, 0, w, 36);
    g.fillStyle = '#ffd24a'; g.font = 'bold 22px "Arial Black"'; g.textAlign = 'center'; g.fillText('BEAD ROAD', w / 2, 26);
    g.strokeStyle = '#ccc'; g.lineWidth = 1;
    const cs = 36, rows = 6, cols = 14;
    for (let i = 0; i <= cols; i++) { g.beginPath(); g.moveTo(i * cs + 4, 40); g.lineTo(i * cs + 4, 40 + rows * cs); g.stroke(); }
    for (let j = 0; j <= rows; j++) { g.beginPath(); g.moveTo(4, 40 + j * cs); g.lineTo(4 + cols * cs, 40 + j * cs); g.stroke(); }
    const list = this.road.slice(-rows * cols);
    list.forEach((r, i) => {
      const x = 4 + Math.floor(i / rows) * cs + cs / 2, y = 40 + (i % rows) * cs + cs / 2;
      g.fillStyle = r === 'P' ? '#2a7de1' : r === 'B' ? '#e12a3a' : '#2ab35a';
      g.beginPath(); g.arc(x, y, 15, 0, TAU); g.fill();
      g.fillStyle = '#fff'; g.font = 'bold 16px sans-serif'; g.fillText(r, x, y + 6);
    });
    this.board.commit();
  }

  spawnStaff(crowd) {
    const p = this.w(0, 0, this.table.back - 0.42);
    this.dealer = crowd.staff('dealer', { x: p.x, z: p.z, ry: this.group.rotation.y }, (n) => {
      if (!this.dealing) n.jelly.setAction('deal');
      const pl = crowd.player;
      n.jelly.lookTarget = pl && n.root.position.distanceToSquared(pl.pos) < 25 ? pl.camera.position : null;
    });
  }

  betSpot(id) { return { player: [-0.24, 0.22], tie: [0, 0.22], banker: [0.24, 0.22], ppair: [-0.3, 0.46], bpair: [0.3, 0.46] }[id]; }
  cardSpot(side, i) { const x0 = side === 'P' ? -0.27 : 0.17; return i < 2 ? this.w(x0 + i * 0.085, TABLE_TOP + 0.001, this.table.back + 0.2) : this.w(x0 + 0.04, TABLE_TOP + 0.002, this.table.back + 0.32); }

  enter() {
    super.enter();
    const ui = this.ui;
    const p = (this.panel = ui.openPanel({ title: 'Baccarat', limits: '', onLeave: () => this.ctx.director.leaveStation() }));
    this.chipCtl = ui.betControl({ min: this.limits[0], max: this.limits[1], value: this.chip, getMoney: () => this.state.money, onChange: (v) => (this.chip = v), label: 'Chip' });
    const grid = ui.grid(5, 3);
    this.cells = {};
    for (const b of BETS) {
      const cell = h('div', 'betcell interactive', `<div class="nm" style="color:${b.color}">${b.name}</div><div class="od">${b.pay === 0.95 ? '19:20' : b.pay + ':1'}</div>`);
      cell.onclick = () => this.addBet(b.id);
      cell.oncontextmenu = (e) => { e.preventDefault(); delete this.bets[b.id]; this.renderBets(); };
      this.cells[b.id] = cell; grid.append(cell);
    }
    const row = h('div', 'row');
    this.dealBtn = ui.button('Deal', 'big green', () => this.deal(), 'Space', 'SPACE');
    row.append(ui.button('Clear', 'dark small', () => { this.bets = {}; this.renderBets(); }), ui.button('Rebet', 'dark small', () => { if (this.lastBets) { this.bets = { ...this.lastBets }; this.renderBets(); } }, 'KeyR', 'R'), this.dealBtn);
    p.body.append(this.chipCtl.el, grid, row);
    this.renderBets();
    p.msg('Bet on Player, Banker or Tie — closest to 9 wins.');
  }
  canLeave() { return this.phase === 'bet'; }
  totalBet() { return Object.values(this.bets).reduce((a, b) => a + b, 0); }
  addBet(id) {
    if (this.phase !== 'bet') return;
    if (this.totalBet() + this.chip > this.limits[1]) { this.ui.toast('Table maximum reached.', 'bad'); return; }
    if (this.totalBet() + this.chip > this.state.money) { this.ui.toast('Not enough cash.', 'bad'); audio.play('deny'); return; }
    this.bets[id] = (this.bets[id] || 0) + this.chip;
    audio.play('chip');
    this.renderBets();
  }
  renderBets() {
    this.chipsGroup.clear();
    for (const [id, amt] of Object.entries(this.bets)) { const [x, z] = this.betSpot(id); const st = chipStack(amt); st.position.set(x, TABLE_TOP, z); this.chipsGroup.add(st); }
    if (!this.panel) return;
    for (const b of BETS) { const c = this.cells[b.id]; c.querySelector('.amt') && c.querySelector('.amt').remove(); if (this.bets[b.id]) c.insertAdjacentHTML('beforeend', `<span class="amt">${fmtMoney(this.bets[b.id])}</span>`); c.classList.remove('win'); }
    this.panel.setLimits(`Total bet ${fmtMoney(this.totalBet())} · max ${fmtMoney(this.limits[1])}`);
  }

  async give(card, to, faceUp = false) {
    this.dealing = true;
    if (this.dealer) this.dealer.jelly.setReach(1, this.shoePos, 'pinch');
    await wait(120);
    audio.play('card', { pos: this.worldPos() });
    if (this.dealer) this.dealer.jelly.setReach(1, to.clone().add(new THREE.Vector3(0, 0.06, 0)), 'open');
    await dealCard(this.tweens, card, this.cardGroup, this.shoePos, to, { faceUp, dur: 0.36 });
    if (this.dealer) this.dealer.jelly.setReach(1, null);
    this.dealing = false;
  }
  newCard() { const [r, s] = this.shoe.draw(); const c = new Card(r, s, '#1a3a8a'); this.cards.push(c); return c; }

  /** Dramatic squeeze reveal: lift a corner, pause, then flip. */
  async squeeze(card, slow) {
    const inner = card.inner;
    if (slow) {
      audio.play('heartbeat');
      await this.tweens.add(0.9, (k) => { inner.rotation.x = Math.PI / 2 - 0.35 * Math.sin(k * Math.PI * 0.5); inner.rotation.y = 0.2 * k; }, { ease: easeInOutCubic });
      await wait(400);
    }
    audio.play('cardFlip', { pos: this.worldPos() });
    await this.tweens.add(0.3, (k) => { inner.rotation.x = Math.PI / 2 - Math.PI * k; inner.rotation.z = Math.PI * (1 - k); inner.rotation.y = 0.2 * (1 - k); }, { ease: easeInOutCubic });
    card.setFaceUp(true); inner.rotation.y = 0;
  }

  async deal() {
    if (this.phase !== 'bet') return;
    const total = this.totalBet();
    if (!total) { this.panel.msg('Place a bet first!', 'lose'); audio.play('deny'); return; }
    if (!this.takeBet(total, 'baccarat')) return;
    this.lastBets = { ...this.bets };
    this.phase = 'deal';
    for (const c of this.cards) { this.cardGroup.remove(c.obj); c.dispose(); }
    this.cards = [];
    this.clearLabels();
    if (this.shoe.needsShuffle) { this.panel.msg('Shuffling eight decks…'); audio.play('shuffle', { pos: this.worldPos() }); await wait(1200); this.shoe.reshuffle(); }
    this.panel.msg('Dealing…');
    const P = [], B = [];
    for (let i = 0; i < 2; i++) {
      const pc = this.newCard(); P.push(pc); await this.give(pc, this.cardSpot('P', i));
      const bc = this.newCard(); B.push(bc); await this.give(bc, this.cardSpot('B', i));
    }
    const big = total >= this.limits[0] * 20;
    for (const c of P) await this.squeeze(c, big && c === P[1]);
    this.label3('P', P);
    for (const c of B) await this.squeeze(c, big && c === B[1]);
    this.label3('B', B);
    let p = pts(P), b = pts(B);
    let natural = p >= 8 || b >= 8;
    let p3 = null;
    if (!natural) {
      if (p <= 5) { p3 = this.newCard(); P.push(p3); this.panel.msg('Player draws a third card…'); await this.give(p3, this.cardSpot('P', 2)); p3.obj.rotation.y = Math.PI / 2; await this.squeeze(p3, big); p = pts(P); this.label3('P', P); }
      const p3v = p3 ? Math.min(10, RANKS.indexOf(p3.rank) + 1) % 10 : -1;
      let bankerDraws;
      if (!p3) bankerDraws = b <= 5;
      else if (b <= 2) bankerDraws = true;
      else if (b === 3) bankerDraws = p3v !== 8;
      else if (b === 4) bankerDraws = p3v >= 2 && p3v <= 7;
      else if (b === 5) bankerDraws = p3v >= 4 && p3v <= 7;
      else if (b === 6) bankerDraws = p3v === 6 || p3v === 7;
      else bankerDraws = false;
      if (bankerDraws) { const b3 = this.newCard(); B.push(b3); this.panel.msg('Banker draws…'); await this.give(b3, this.cardSpot('B', 2)); b3.obj.rotation.y = Math.PI / 2; await this.squeeze(b3, big); b = pts(B); this.label3('B', B); }
    }
    const winner = p > b ? 'P' : b > p ? 'B' : 'T';
    this.road.push(winner); this.drawRoad();
    await wait(400);
    // settle
    let gross = 0;
    const res = { P: 'player', B: 'banker', T: 'tie' }[winner];
    for (const [id, amt] of Object.entries(this.bets)) {
      const def = BETS.find((x) => x.id === id);
      let win = false;
      if (id === res) win = true;
      if (id === 'ppair') win = P[0].rank === P[1].rank;
      if (id === 'bpair') win = B[0].rank === B[1].rank;
      if (win) { gross += amt * (1 + def.pay); this.cells && this.cells[id] && this.cells[id].classList.add('win'); }
      else if (winner === 'T' && (id === 'player' || id === 'banker')) gross += amt; // push on tie
    }
    gross = Math.round(gross * 100) / 100;
    const profit = gross - total;
    if (profit > 0) gross = total + profit * this.state.perkMult('baccarat');
    if (gross > 0) this.state.payout(gross, total, 'baccarat');
    if (gross < total) this.state.lost(total - gross, 'baccarat');
    const name = winner === 'P' ? 'PLAYER WINS' : winner === 'B' ? 'BANKER WINS' : 'TIE';
    this.panel && this.panel.msg(`${name} ${p} – ${b}${profit > 0 ? ' · +' + fmtMoney(gross - total) : profit < 0 ? ' · -' + fmtMoney(total - gross) : ''}`, profit > 0 ? 'win' : profit < 0 ? 'lose' : '');
    if (this.dealer) this.dealer.say(`${name.charAt(0) + name.slice(1).toLowerCase()}, ${p} to ${b}.`);
    if (profit > 0) this.celebrate(gross - total, total); else if (profit < 0) { audio.play('lose', { vol: 0.5 }); this.ctx.director.bigLoss(this.worldPos(), total - gross); }
    // chip sweep
    const to = profit >= 0 ? this.w(0, TABLE_TOP + 0.3, 1.1) : this.w(0, TABLE_TOP + 0.05, this.table.back + 0.1);
    for (const st of [...this.chipsGroup.children]) flyTo(this.tweens, st, to, { dur: 0.5, arc: 0.1, delay: 0.6, onDone: () => this.chipsGroup.remove(st) });
    await wait(2200);
    this.bets = {};
    this.clearLabels();
    this.phase = 'bet';
    this.renderBets();
    this.panel && this.panel.msg('Place your bets!');
  }

  label3(side, cards) {
    this.labels = this.labels || [];
    const old = this.labels.find((l) => l.side === side); if (old) { old.el.remove(); this.labels.splice(this.labels.indexOf(old), 1); }
    const el = this.ui.worldLabel(`${side === 'P' ? 'PLAYER' : 'BANKER'} ${pts(cards)}`, 'wlabel pill');
    el.style.color = side === 'P' ? '#6aa8ff' : '#ff6a7a';
    this.labels.push({ el, side, world: this.w(side === 'P' ? -0.2 : 0.22, TABLE_TOP + 0.16, this.table.back + 0.28) });
  }
  clearLabels() { if (this.labels) for (const l of this.labels) l.el.remove(); this.labels = []; }
  leave() { super.leave(); this.clearLabels(); }
  update(dt, t, active) {
    if (this.labels && this.labels.length) {
      for (const l of this.labels) { const v = l.world.clone().project(this.ctx.camera); this.ui.placeLabel(l.el, ((v.x + 1) / 2) * window.innerWidth, ((1 - v.y) / 2) * window.innerHeight, v.z < 1 && active); }
    }
  }
  dispose() { this.board.dispose(); this.clearLabels(); }
}
