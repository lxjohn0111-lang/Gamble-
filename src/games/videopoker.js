import * as THREE from 'three';
import { Station, Screen, Shoe, pokerRank, cardTexture, cardBackTexture, RANKS } from './common.js';
import { G, mesh } from '../engine/geo.js';
import { M } from '../engine/materials.js';
import { rand, fmtMoney, wait } from '../engine/util.js';
import { audio } from '../engine/audio.js';
import { barStool } from '../world/props.js';

// ============================================================================
//  VIDEO POKER — Jacks or Better 9/6 with hold hints and double-up.
// ============================================================================

const PAYS = [
  ['royal', 'ROYAL FLUSH', [250, 500, 750, 1000, 4000]], ['sflush', 'STRAIGHT FLUSH', [50, 100, 150, 200, 250]], ['quads', '4 OF A KIND', [25, 50, 75, 100, 125]],
  ['full', 'FULL HOUSE', [9, 18, 27, 36, 45]], ['flush', 'FLUSH', [6, 12, 18, 24, 30]], ['straight', 'STRAIGHT', [4, 8, 12, 16, 20]],
  ['trips', '3 OF A KIND', [3, 6, 9, 12, 15]], ['twopair', 'TWO PAIR', [2, 4, 6, 8, 10]], ['jacks', 'JACKS OR BETTER', [1, 2, 3, 4, 5]],
];
const val = (c) => { const i = RANKS.indexOf(c[0]); return i === 0 ? 14 : i + 1; };

export class VideoPoker extends Station {
  constructor(ctx, def) {
    super(ctx, def);
    this.label = 'Play Video Poker';
    this.denom = [1, 1, 5, 5, 10, 25][Math.min(5, ctx.state.day - 1)] * ctx.state.limitMult();
    this.coins = 5;
    this.footprint = { w: 0.7, d: 0.62, ox: 0, oz: 0 };
    this.interactLocal = new THREE.Vector3(0, 0, 1.0);
    this.interactR = 1.1;
    this.camLocal = { pos: new THREE.Vector3(0, 1.44, 0.8), look: new THREE.Vector3(0, 1.3, 0) };
    this.phase = 'idle';
    this.hand = []; this.held = [false, false, false, false, false];
    this.shoe = new Shoe(1);
    this.win = 0;
    this.hintOn = false;
  }
  promptText() { return [this.label, `Jacks or Better 9/6 · ${fmtMoney(this.denom)} per coin`]; }

  build() {
    const S = (this.static = new THREE.Group());
    S.position.copy(this.group.position); S.rotation.copy(this.group.rotation);
    this.ctx.director.world.staticRoot.add(S);
    const body = M.lacquer(0x0d1a3a), chrome = M.chrome();
    mesh(G.rbox(0.66, 0.78, 0.58, 0.03), M.lacquer(0x0a0a10), 0, 0.39, 0, { parent: S, cast: true });
    mesh(G.rbox(0.64, 0.12, 0.5, 0.03), body, 0, 0.84, -0.02, { parent: S });
    mesh(G.rbox(0.64, 0.62, 0.12, 0.03), body, 0, 1.25, -0.22, { parent: S, cast: true });
    for (const s of [-1, 1]) mesh(G.rbox(0.05, 0.86, 0.5, 0.02), body, s * 0.32, 1.3, -0.04, { parent: S });
    mesh(G.rbox(0.66, 0.2, 0.5, 0.03), body, 0, 1.68, -0.04, { parent: S });
    mesh(G.rbox(0.66, 0.08, 0.24, 0.02), M.lacquer(0x0a0a10), 0, 0.94, 0.17, { rx: -0.3, parent: S });
    // header
    const hdr = new Screen(512, 96, 1.6);
    hdr.g.fillStyle = '#0a1a4a'; hdr.g.fillRect(0, 0, 512, 96);
    hdr.g.font = 'bold 46px "Arial Black", sans-serif'; hdr.g.textAlign = 'center'; hdr.g.textBaseline = 'middle'; hdr.g.fillStyle = '#ffd24a'; hdr.g.fillText('JACKS OR BETTER', 256, 50); hdr.commit();
    mesh(G.plane(0.58, 0.11), hdr.mat, 0, 1.69, 0.213, { parent: S });
    // screen
    this.screen = new Screen(1024, 768, 1.35);
    this.screenMesh = mesh(G.plane(0.56, 0.42), this.screen.mat, 0, 1.27, -0.155, { rx: -0.08, parent: this.group });
    mesh(G.box(0.6, 0.46, 0.02), M.blackMetal(), 0, 1.27, -0.17, { rx: -0.08, parent: S });
    // buttons
    this.buttons = [];
    const names = ['HOLD', 'HOLD', 'HOLD', 'HOLD', 'HOLD', 'BET', 'DEAL'];
    names.forEach((n, i) => {
      const m = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: n === 'DEAL' ? 0x2aff6a : n === 'BET' ? 0xff3a3a : 0xffd24a, emissiveIntensity: 0.8 });
      const b = mesh(G.rbox(n === 'DEAL' ? 0.07 : 0.055, 0.02, 0.04, 0.006), m, -0.26 + i * 0.085, 0.985, 0.2, { rx: -0.3, parent: this.group });
      this.buttons.push({ b, m });
    });
    const st = barStool('chrome', 0x0d1a3a); st.position.set(0, 0, 0.6); S.add(st);
    this.registerSeat(new THREE.Vector3(0, 0, 0.6), 0, { seat: 0.78, standOff: 0.55 });
    this.raycaster = new THREE.Raycaster();
    this.draw();
  }

  draw() {
    const { g, w, h } = this.screen;
    const bg = g.createLinearGradient(0, 0, 0, h); bg.addColorStop(0, '#081a6a'); bg.addColorStop(1, '#020a30');
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    // paytable
    g.font = 'bold 26px "Arial Black", sans-serif';
    const rank = this.phase !== 'idle' && this.hand.length ? pokerRank(this.hand) : null;
    PAYS.forEach(([id, name, pays], i) => {
      const y = 30 + i * 32;
      const hit = rank === id && this.phase === 'done';
      g.fillStyle = hit ? '#ff3a3a' : '#ffd24a'; g.textAlign = 'left'; g.fillText(name, 24, y + 12);
      for (let c = 0; c < 5; c++) {
        const x = 470 + c * 110;
        if (c === this.coins - 1) { g.fillStyle = 'rgba(255,40,40,0.55)'; g.fillRect(x - 50, y - 10, 104, 30); }
        g.fillStyle = hit && c === this.coins - 1 ? '#fff' : '#ffd24a'; g.textAlign = 'right'; g.fillText(String(pays[c]), x + 46, y + 12);
      }
    });
    // cards
    const cw = 170, ch = 238, y0 = 330;
    for (let i = 0; i < 5; i++) {
      const x = 32 + i * (cw + 25);
      const c = this.hand[i];
      const img = c && this.faceUp[i] ? cardTexture(c[0], c[1]).image : cardBackTexture('#1a3a8a').image;
      g.save(); g.shadowColor = 'rgba(0,0,0,0.6)'; g.shadowBlur = 12; g.drawImage(img, x, y0, cw, ch); g.restore();
      if (this.held[i]) { g.fillStyle = '#ffd24a'; g.font = 'bold 34px "Arial Black"'; g.textAlign = 'center'; g.fillText('HELD', x + cw / 2, y0 - 14); g.strokeStyle = '#ffd24a'; g.lineWidth = 5; g.strokeRect(x - 3, y0 - 3, cw + 6, ch + 6); }
      if (this.hint && this.hint[i] && this.phase === 'dealt' && !this.held[i]) { g.strokeStyle = 'rgba(77,255,154,0.8)'; g.setLineDash([10, 8]); g.lineWidth = 4; g.strokeRect(x - 6, y0 - 6, cw + 12, ch + 12); g.setLineDash([]); }
    }
    // footer
    g.font = 'bold 30px "Courier New", monospace'; g.textAlign = 'left'; g.fillStyle = '#7dff9a';
    g.fillText(`WIN ${fmtMoney(this.win)}`, 30, 720);
    g.textAlign = 'center'; g.fillStyle = '#fff'; g.fillText(this.msg || '', 512, 620 - 30 + 34);
    g.textAlign = 'right'; g.fillStyle = '#ffd24a'; g.fillText(`BET ${this.coins} × ${fmtMoney(this.denom)}   CREDIT ${fmtMoney(this.state.money)}`, 1000, 720);
    this.screen.commit();
  }

  enter() {
    super.enter();
    const ui = this.ui;
    const p = (this.panel = ui.openPanel({ title: 'Video Poker', limits: `Jacks or Better · ${fmtMoney(this.denom)}/coin · Royal pays 4000 at 5 coins`, onLeave: () => this.ctx.director.leaveStation() }));
    const row1 = document.createElement('div'); row1.className = 'row';
    this.holdBtns = [];
    for (let i = 0; i < 5; i++) { const b = ui.button(`Hold ${i + 1}`, 'dark', () => this.toggleHold(i), 'Digit' + (i + 1), String(i + 1)); this.holdBtns.push(b); row1.append(b); }
    const row2 = document.createElement('div'); row2.className = 'row';
    this.betBtn = ui.button('Bet one', 'red', () => { if (this.phase !== 'idle' && this.phase !== 'done') return; this.coins = (this.coins % 5) + 1; audio.play('tick'); this.draw(); }, 'KeyB', 'B');
    this.maxBtn = ui.button('Bet max', 'red', () => { if (this.phase !== 'idle' && this.phase !== 'done') return; this.coins = 5; this.deal(); }, 'KeyM', 'M');
    this.dealBtn = ui.button('Deal', 'big green', () => (this.phase === 'dealt' ? this.drawCards() : this.deal()), 'Space', 'SPACE');
    this.hintBtn = ui.button('Hints: off', 'dark small', () => { this.hintOn = !this.hintOn; this.hintBtn.textContent = `Hints: ${this.hintOn ? 'on' : 'off'}`; this.computeHint(); this.draw(); });
    row2.append(this.betBtn, this.maxBtn, this.dealBtn, this.hintBtn);
    p.body.append(row1, row2);
    p.msg('Deal, hold the cards you want, then draw.');
    this.onDown = (e) => {
      if (this.phase !== 'dealt' || e.button !== 0) return;
      const r = this.ctx.director.app.canvas.getBoundingClientRect();
      this.raycaster.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.ctx.camera);
      const hit = this.raycaster.intersectObject(this.screenMesh)[0];
      if (!hit) return;
      const u = hit.uv.x * 1024, v = (1 - hit.uv.y) * 768;
      if (v > 320 && v < 580) { const i = Math.floor((u - 20) / 195); if (i >= 0 && i < 5) this.toggleHold(i); }
    };
    this.ctx.director.app.canvas.addEventListener('pointerdown', this.onDown);
    this.refresh();
  }
  leave() { super.leave(); this.ctx.director.app.canvas.removeEventListener('pointerdown', this.onDown); }
  canLeave() { return this.phase === 'idle' || this.phase === 'done'; }
  refresh() {
    if (!this.panel) return;
    this.dealBtn.innerHTML = this.phase === 'dealt' ? 'Draw<kbd>SPACE</kbd>' : 'Deal<kbd>SPACE</kbd>';
    this.holdBtns.forEach((b, i) => { b.disabled = this.phase !== 'dealt'; b.className = 'btn ' + (this.held[i] ? '' : 'dark'); b.innerHTML = (this.held[i] ? 'HELD' : `Hold ${i + 1}`) + `<kbd>${i + 1}</kbd>`; });
  }
  toggleHold(i) {
    if (this.phase !== 'dealt') return;
    this.held[i] = !this.held[i];
    this.buttons[i].press = 0.15;
    audio.play('click');
    this.draw(); this.refresh();
  }

  async deal() {
    if (this.phase === 'dealing' || this.phase === 'drawing' || this.phase === 'dealt') return;
    const bet = this.coins * this.denom;
    if (!this.takeBet(bet, 'videopoker')) return;
    this.bet = bet;
    this.buttons[6].press = 0.15;
    this.shoe.reshuffle();
    this.hand = []; this.faceUp = [false, false, false, false, false]; this.held = [false, false, false, false, false]; this.win = 0; this.msg = '';
    this.phase = 'dealing';
    for (let i = 0; i < 5; i++) this.hand.push(this.shoe.draw());
    for (let i = 0; i < 5; i++) { await wait(90); this.faceUp[i] = true; audio.play('cardFlip', { pos: this.worldPos(), vol: 0.6 }); this.draw(); }
    this.phase = 'dealt';
    const r = pokerRank(this.hand);
    this.msg = r !== 'nothing' ? PAYS.find((p) => p[0] === r)[1] + '!' : 'Hold cards, then DRAW';
    this.computeHint();
    this.draw(); this.refresh();
  }

  computeHint() {
    this.hint = null;
    if (!this.hintOn || this.phase !== 'dealt') return;
    const H = this.hand, r = pokerRank(H);
    const pick = (f) => H.map((c, i) => f(c, i));
    if (['royal', 'sflush', 'quads', 'full', 'flush', 'straight'].includes(r)) { this.hint = pick(() => true); return; }
    const counts = {}; H.forEach((c) => (counts[val(c)] = (counts[val(c)] || 0) + 1));
    if (r === 'trips' || r === 'twopair' || r === 'jacks') { this.hint = pick((c) => counts[val(c)] >= 2); return; }
    const bySuit = {}; H.forEach((c, i) => (bySuit[c[1]] = (bySuit[c[1]] || []).concat(i)));
    const big = Object.values(bySuit).find((l) => l.length >= 4);
    if (big) { this.hint = pick((c, i) => big.includes(i)); return; }
    const vals = [...new Set(H.map(val))].sort((a, b) => a - b);
    for (let s = 0; s + 3 < vals.length; s++) if (vals[s + 3] - vals[s] === 3) { const keep = vals.slice(s, s + 4); const used = new Set(); this.hint = pick((c) => { const v = val(c); if (keep.includes(v) && !used.has(v)) { used.add(v); return true; } return false; }); return; }
    if (Object.values(counts).some((n) => n === 2)) { this.hint = pick((c) => counts[val(c)] === 2); return; }
    const highs = H.map((c, i) => [c, i]).filter(([c]) => val(c) >= 11);
    if (highs.length) { this.hint = pick((c, i) => highs.slice(0, 2).some(([, j]) => j === i)); return; }
    this.hint = pick(() => false);
  }

  async drawCards() {
    if (this.phase !== 'dealt') return;
    this.phase = 'drawing';
    this.buttons[6].press = 0.15;
    for (let i = 0; i < 5; i++) if (!this.held[i]) { this.faceUp[i] = false; }
    this.draw();
    for (let i = 0; i < 5; i++) if (!this.held[i]) { await wait(110); this.hand[i] = this.shoe.draw(); this.faceUp[i] = true; audio.play('cardFlip', { pos: this.worldPos(), vol: 0.6 }); this.draw(); }
    const r = pokerRank(this.hand);
    const row = PAYS.find((p) => p[0] === r);
    this.phase = 'done';
    if (row) {
      const gross = row[2][this.coins - 1] * this.denom * this.state.perkMult('videopoker');
      this.win = gross;
      this.msg = `${row[1]}! WIN ${fmtMoney(gross)}`;
      this.state.payout(gross, this.bet, 'videopoker');
      this.panel && this.panel.msg(this.msg, 'win');
      this.celebrate(gross - this.bet, this.bet);
      this.flashT = 2;
    } else {
      this.msg = 'GAME OVER';
      this.state.lost(this.bet, 'videopoker');
      this.panel && this.panel.msg('No win. Deal again?', 'lose');
    }
    this.held = [false, false, false, false, false];
    this.draw(); this.refresh();
  }

  update(dt, t, active) {
    this.flashT = Math.max(0, (this.flashT || 0) - dt);
    for (const [i, x] of this.buttons.entries()) {
      x.press = Math.max(0, (x.press || 0) - dt);
      x.b.position.y = 0.985 - (x.press > 0 ? 0.006 : 0);
      x.m.emissiveIntensity = (i < 5 ? (this.held[i] ? 2 : 0.5) : 0.8) + (this.flashT > 0 && Math.floor(t * 10) % 2 ? 2 : 0);
    }
    // attract mode for idle machines
    if (!active && Math.floor(t) !== this._at && this.ctx.camera.position.distanceToSquared(this.group.position) < 60) {
      this._at = Math.floor(t);
      if (this.phase === 'idle' && !this.hand.length) { const s = new Shoe(1); this.hand = [s.draw(), s.draw(), s.draw(), s.draw(), s.draw()]; this.faceUp = [true, true, true, true, true]; this.msg = 'PRESS DEAL'; this.draw(); }
    }
  }
  dispose() { this.screen.dispose(); }
}
