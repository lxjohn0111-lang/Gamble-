import * as THREE from 'three';
import { Station, Screen } from './common.js';
import { G, mesh } from '../engine/geo.js';
import { M } from '../engine/materials.js';
import { TAU, rand, fmtMoney, clamp, randPick } from '../engine/util.js';
import { audio } from '../engine/audio.js';
import { h } from '../ui/ui.js';
import { rocketModel } from '../world/props.js';

// ============================================================================
//  ROCKET JELLY (Crash) — cash out before the rocket blows up.
// ============================================================================

const NAMES = ['WobbleKing', 'GummyGuru', 'JellyJim', 'LimeLady', 'SirSquish', 'BeanCounter', 'Grape_Ape', 'CherryBomb', 'MintyFresh', 'ColaCowboy', 'LuckyLemon', 'TikiTom', 'BubbleBabs', 'PeachyPete'];
const RATE = 0.115;

export class Crash extends Station {
  constructor(ctx, def) {
    super(ctx, def);
    this.label = 'Play Rocket Jelly';
    const k = 1 + (ctx.state.day - 1) * 0.5;
    this.limits = [1 * ctx.state.limitMult(), Math.round(500 * k * ctx.state.limitMult())];
    this.footprint = { w: 2.8, d: 1.4, ox: 0, oz: 0 };
    this.interactLocal = new THREE.Vector3(0, 0, 1.6);
    this.interactR = 1.6;
    this.camLocal = { pos: new THREE.Vector3(0, 1.75, 2.45), look: new THREE.Vector3(0, 1.82, 0) };
    this.bet = 10; this.auto = 0;
    this.phase = 'wait'; this.t = 0; this.countdown = 5;
    this.history = [];
    this.players = [];
    this.myBet = 0; this.cashed = 0;
    this.stars = Array.from({ length: 120 }, () => [rand(), rand(), rand()]);
  }
  promptText() { return [this.label, `Crash · cash out before it explodes · ${fmtMoney(this.limits[0])}–${fmtMoney(this.limits[1])}`]; }

  build() {
    const S = (this.static = new THREE.Group());
    S.position.copy(this.group.position); S.rotation.copy(this.group.rotation);
    this.ctx.director.world.staticRoot.add(S);
    const frame = M.lacquer(0x0b0b18);
    mesh(G.rbox(2.7, 1.75, 0.3, 0.06), frame, 0, 2.05, -0.3, { parent: S, cast: true });
    for (const s of [-1, 1]) mesh(G.rbox(0.18, 1.2, 0.4, 0.04), frame, s * 1.1, 0.6, -0.3, { parent: S, cast: true });
    mesh(G.box(2.72, 0.04, 0.32), M.neon(0x2bf0ff, 3), 0, 2.94, -0.28, { parent: S });
    mesh(G.box(2.72, 0.04, 0.32), M.neon(0xff2bd6, 3), 0, 1.16, -0.28, { parent: S });
    // console podium
    mesh(G.rbox(1.4, 0.8, 0.55, 0.06), frame, 0, 0.4, 0.95, { parent: S, cast: true });
    mesh(G.rbox(1.45, 0.05, 0.62, 0.02), M.blackMetal(), 0, 0.82, 0.95, { rx: -0.2, parent: S });
    this.btnMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0x2aff6a, emissiveIntensity: 1.2 });
    mesh(G.cyl(0.09, 0.09, 0.05, 24), this.btnMat, 0.3, 0.86, 1.0, { rx: -0.2, parent: this.group });
    mesh(G.cyl(0.11, 0.11, 0.03, 24), M.chrome(), 0.3, 0.84, 1.0, { rx: -0.2, parent: S });
    // screen
    this.screen = new Screen(1280, 768, 1.5);
    mesh(G.plane(2.5, 1.5), this.screen.mat, 0, 2.05, -0.145, { parent: this.group });
    // a real rocket next to the screen
    const r = rocketModel(); r.position.set(1.65, 0, -0.1); r.scale.setScalar(0.55); r.rotation.z = -0.15; S.add(r);
    this.watchSpot = (() => { const w = this.w(0, 0, 2.6); return { x: w.x, z: w.z, lx: this.group.position.x, lz: this.group.position.z, station: this }; })();
    this.newRound();
  }

  newRound() {
    this.phase = 'wait'; this.countdown = 6; this.t = 0;
    // player-friendly: 3% instant crash, otherwise P(reaching x) = 1.06 / x, so any cash-out target pays back ~103%
    const U = rand();
    this.crashAt = U < 0.03 ? 1 : Math.max(1.06, Math.floor((100 * 1.06) / Math.max(1e-6, 1 - (U - 0.03) / 0.97)) / 100);
    this.players = Array.from({ length: 6 + Math.floor(rand() * 4) }, () => ({ name: randPick(NAMES), bet: Math.round((5 + rand() * 200) / 5) * 5, target: Math.max(1.05, 0.97 / Math.max(0.02, rand())), out: 0 }));
    this.cashed = 0;
    if (this.queuedBet && this.active) this.placeBet(this.queuedBet);
  }
  mult() { return Math.exp(RATE * this.t); }

  enter() {
    super.enter();
    const ui = this.ui;
    const p = (this.panel = ui.openPanel({ title: 'Rocket Jelly', limits: 'Pays back about 103% on average · 3% instant crash', onLeave: () => this.ctx.director.leaveStation() }));
    this.betCtl = ui.betControl({ min: this.limits[0], max: this.limits[1], value: this.bet, getMoney: () => this.state.money, onChange: (v) => (this.bet = v) });
    const row = h('div', 'row');
    this.mainBtn = ui.button('Bet', 'big green', () => this.mainAction(), 'Space', 'SPACE');
    const autoSeg = h('div', 'seg');
    for (const a of [0, 1.5, 2, 3, 5, 10]) {
      const b = document.createElement('button'); b.textContent = a ? a + '×' : 'Manual'; if (a === this.auto) b.className = 'on';
      b.onclick = () => { this.auto = a; autoSeg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); };
      autoSeg.append(b);
    }
    row.append(h('span', 'mini', 'Auto cash-out'), autoSeg, this.mainBtn);
    p.body.append(this.betCtl.el, row);
    this.refreshBtn();
  }
  canLeave() { return !(this.myBet && !this.cashed && this.phase === 'fly'); }
  leave() { super.leave(); this.queuedBet = 0; }

  refreshBtn() {
    if (!this.mainBtn) return;
    let txt, cls;
    if (this.phase === 'fly' && this.myBet && !this.cashed) { txt = `CASH OUT ${fmtMoney(this.myBet * this.mult())}`; cls = 'big red pulse'; }
    else if (this.phase === 'wait' && this.myBet) { txt = `Bet placed (${fmtMoney(this.myBet)})`; cls = 'big dark'; }
    else if (this.phase !== 'wait') { txt = this.queuedBet ? 'Queued for next round' : 'Bet next round'; cls = 'big blue'; }
    else { txt = 'Place bet'; cls = 'big green'; }
    if (this._btxt !== txt) { this.mainBtn.innerHTML = txt + '<kbd>SPACE</kbd>'; this.mainBtn.className = 'btn ' + cls; this._btxt = txt; }
  }
  mainAction() {
    if (this.phase === 'fly' && this.myBet && !this.cashed) return this.cashOut();
    if (this.phase === 'wait' && !this.myBet) return this.placeBet(this.bet);
    if (this.phase !== 'wait') { this.queuedBet = this.queuedBet ? 0 : this.bet; this.refreshBtn(); }
  }
  placeBet(amount) {
    this.queuedBet = 0;
    if (!this.takeBet(amount, 'crash')) return;
    this.myBet = amount;
    audio.play('chip');
    this.refreshBtn();
  }
  cashOut() {
    const m = this.mult();
    const gross = this.myBet * m * this.state.perkMult('crash');
    this.cashed = m;
    this.state.payout(gross, this.myBet, 'crash');
    audio.play('cash', { pos: this.worldPos() });
    this.panel && this.panel.msg(`Cashed out at ${m.toFixed(2)}× → ${fmtMoney(gross)}`, 'win');
    this.celebrate(gross - this.myBet, this.myBet);
    this.refreshBtn();
  }

  update(dt, t) {
    const near = this.active || this.ctx.camera.position.distanceToSquared(this.group.position) < 400;
    if (this.phase === 'wait') {
      this.countdown -= dt;
      if (this.countdown <= 0) { this.phase = 'fly'; this.t = 0; if (this.active) audio.loop('rocket', { vol: 0.25, freq: 300, type: 'lowpass', osc: { type: 'sawtooth', freq: 60, gain: 0.2 } }); this.refreshBtn(); }
    } else if (this.phase === 'fly') {
      this.t += dt;
      const m = this.mult();
      for (const p of this.players) if (!p.out && m >= p.target && p.target < this.crashAt) p.out = p.target;
      if (this.myBet && !this.cashed && this.auto && m >= this.auto && this.auto <= this.crashAt) this.cashOut();
      if (this.active) audio.setLoop('rocket', { freq: 300 + Math.min(3000, m * 160), oscFreq: 60 + m * 8, vol: 0.18 + Math.min(0.2, m * 0.02) });
      if (m >= this.crashAt) {
        this.phase = 'crashed'; this.crashT = 0;
        this.history.push(this.crashAt);
        audio.stopLoop('rocket');
        if (near) audio.play('boom', { pos: this.worldPos(), vol: 0.8 });
        if (this.active && this.myBet && !this.cashed) {
          this.state.lost(this.myBet, 'crash');
          this.panel && this.panel.msg(`💥 Crashed at ${this.crashAt.toFixed(2)}× — you lost ${fmtMoney(this.myBet)}`, 'lose');
          this.ctx.director.flash(0.35, 0xff3020);
          this.ctx.director.bigLoss(this.worldPos(), this.myBet);
        }
        this.refreshBtn();
      }
    } else if (this.phase === 'crashed') {
      this.crashT += dt;
      if (this.crashT > 3) { this.myBet = 0; this.newRound(); this.refreshBtn(); }
    }
    if (this.active && this.phase === 'fly') this.refreshBtn();
    if (near && (this._dt = (this._dt || 0) + dt) > 1 / 30) { this._dt = 0; this.draw(t); }
    this.btnMat.emissive.set(this.phase === 'fly' && this.myBet && !this.cashed ? 0xff3a3a : 0x2aff6a);
    this.btnMat.emissiveIntensity = 1 + Math.sin(t * 8) * 0.5;
  }

  draw(time) {
    const { g, w, h: H } = this.screen;
    const crashed = this.phase === 'crashed';
    const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, crashed ? '#3a0410' : '#070320'); bg.addColorStop(1, crashed ? '#120006' : '#1a0838');
    g.fillStyle = bg; g.fillRect(0, 0, w, H);
    // stars (parallax)
    const speed = this.phase === 'fly' ? this.mult() : 0.3;
    for (const s of this.stars) {
      const x = ((s[0] - time * 0.02 * speed * s[2]) % 1 + 1) % 1;
      g.fillStyle = `rgba(255,255,255,${0.3 + s[2] * 0.7})`; g.fillRect(x * w, s[1] * H, 2 + s[2] * 2, 2);
    }
    // graph area
    const gx = 90, gy = 120, gw = 820, gh = 560;
    g.strokeStyle = 'rgba(255,255,255,0.15)'; g.lineWidth = 2;
    for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(gx, gy + (i * gh) / 4); g.lineTo(gx + gw, gy + (i * gh) / 4); g.stroke(); }
    const m = this.phase === 'fly' ? this.mult() : crashed ? this.crashAt : 1;
    const tMax = Math.max(8, this.t * 1.15), mMax = Math.max(2, m * 1.2);
    const X = (tt) => gx + (tt / tMax) * gw, Y = (mm) => gy + gh - ((mm - 1) / (mMax - 1)) * gh;
    if (this.phase !== 'wait') {
      g.beginPath(); g.moveTo(X(0), Y(1));
      const tEnd = crashed ? Math.log(this.crashAt) / RATE : this.t;
      for (let i = 1; i <= 60; i++) { const tt = (i / 60) * tEnd; g.lineTo(X(tt), Y(Math.exp(RATE * tt))); }
      g.strokeStyle = crashed ? '#ff3a4a' : '#ffd24a'; g.lineWidth = 8; g.shadowColor = g.strokeStyle; g.shadowBlur = 18; g.stroke(); g.shadowBlur = 0;
      // rocket / explosion
      const rx = X(tEnd), ry = Y(Math.exp(RATE * tEnd));
      g.save(); g.translate(rx, ry);
      if (!crashed) {
        g.rotate(-0.6);
        g.fillStyle = '#ff7a2a'; g.beginPath(); g.ellipse(-44, 0, 26 + Math.random() * 10, 10, 0, 0, TAU); g.fill();
        g.fillStyle = '#eee'; g.beginPath(); g.ellipse(0, 0, 34, 16, 0, 0, TAU); g.fill();
        g.fillStyle = '#d9182e'; g.beginPath(); g.moveTo(30, -12); g.lineTo(50, 0); g.lineTo(30, 12); g.fill();
        g.fillStyle = '#7ed957'; g.beginPath(); g.arc(4, -4, 10, 0, TAU); g.fill();
        g.fillStyle = '#fff'; g.beginPath(); g.arc(1, -7, 4, 0, TAU); g.arc(8, -7, 4, 0, TAU); g.fill();
        g.fillStyle = '#000'; g.beginPath(); g.arc(1, -5, 2, 0, TAU); g.arc(8, -5, 2, 0, TAU); g.fill();
      } else {
        const k = Math.min(1, this.crashT * 2);
        for (let i = 0; i < 14; i++) { const a = (i / 14) * TAU; g.fillStyle = i % 2 ? '#ffd24a' : '#ff3a2a'; g.beginPath(); g.arc(Math.cos(a) * 60 * k, Math.sin(a) * 60 * k, 16 * (1 - k * 0.6), 0, TAU); g.fill(); }
      }
      g.restore();
    }
    // big multiplier
    g.textAlign = 'center'; g.textBaseline = 'middle';
    if (this.phase === 'wait') {
      g.font = 'bold 64px "Arial Black", sans-serif'; g.fillStyle = '#fff'; g.fillText('NEXT LAUNCH IN', gx + gw / 2, gy + gh / 2 - 60);
      g.font = 'bold 140px "Arial Black", sans-serif'; g.fillStyle = '#2bf0ff'; g.fillText(Math.max(0, this.countdown).toFixed(1) + 's', gx + gw / 2, gy + gh / 2 + 60);
    } else {
      g.font = 'bold 150px "Arial Black", sans-serif'; g.fillStyle = crashed ? '#ff3a4a' : '#fff';
      g.shadowColor = crashed ? '#ff0000' : '#ffd24a'; g.shadowBlur = 30;
      g.fillText(m.toFixed(2) + '×', gx + gw / 2, gy + 120);
      g.shadowBlur = 0;
      if (crashed) { g.font = 'bold 60px "Arial Black"'; g.fillText('CRASHED!', gx + gw / 2, gy + 230); }
    }
    // history
    const hist = this.history.slice(-9);
    hist.forEach((v, i) => { const x = 100 + i * 92; g.fillStyle = v >= 2 ? '#1a8a4a' : '#8a1a2a'; g.beginPath(); g.roundRect(x, 30, 84, 46, 12); g.fill(); g.fillStyle = '#fff'; g.font = 'bold 26px sans-serif'; g.fillText(v.toFixed(2) + '×', x + 42, 54); });
    // leaderboard
    g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(950, 100, 310, 640);
    g.fillStyle = '#ffd24a'; g.font = 'bold 30px "Arial Black"'; g.fillText('PLAYERS', 1105, 135);
    const rows = this.players.slice(0, 10);
    if (this.myBet) rows.unshift({ name: '★ YOU', bet: this.myBet, out: this.cashed, me: true });
    rows.slice(0, 11).forEach((p, i) => {
      const y = 180 + i * 50;
      g.textAlign = 'left'; g.font = 'bold 24px sans-serif'; g.fillStyle = p.me ? '#ffd24a' : '#fff'; g.fillText(p.name, 965, y);
      g.textAlign = 'right';
      if (p.out) { g.fillStyle = '#4dff9a'; g.fillText(`${p.out.toFixed(2)}× +$${Math.round(p.bet * p.out)}`, 1250, y); }
      else { g.fillStyle = crashed ? '#ff5a6a' : '#aab'; g.fillText(`$${p.bet}`, 1250, y); }
    });
    this.screen.commit();
  }
  dispose() { audio.stopLoop('rocket'); this.screen.dispose(); }
}
