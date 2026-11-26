import * as THREE from 'three';
import { Station, Screen } from './common.js';
import { G, mesh } from '../engine/geo.js';
import { M } from '../engine/materials.js';
import { makeCanvas, toTex } from '../engine/textures.js';
import { TAU, rand, fmtMoney, clamp, shuffle, weightedPick, wait, lerp } from '../engine/util.js';
import { audio } from '../engine/audio.js';
import { h } from '../ui/ui.js';
import { barStool } from '../world/props.js';

// ============================================================================
//  JELLY DERBY — mechanical horse racing with googly-eyed jockeys.
// ============================================================================

const HORSES = [
  { name: 'Wobbly Wonder', color: 0xff5470, silk: '#ff5470' },
  { name: 'Gummy Express', color: 0x5b8cff, silk: '#5b8cff' },
  { name: 'Sir Squishalot', color: 0x7ed957, silk: '#7ed957' },
  { name: 'Grape Expectations', color: 0xa66bff, silk: '#a66bff' },
  { name: 'Lucky Lime', color: 0xffe14d, silk: '#ffe14d' },
  { name: 'Jelly Bean Jr.', color: 0xff9f2e, silk: '#ff9f2e' },
];
const ODDS = [3.1, 4.2, 5.2, 7.2, 10.5, 17]; // gross payout multipliers
const LAPS = 1;
const TRX = 1.25, TRZ = 0.62; // track ellipse radii (lane 0)

function trackPos(s, lane, out = new THREE.Vector3()) {
  // s in [0,1) around the oval, counter-clockwise starting at the front straight
  const a = -Math.PI / 2 + s * TAU;
  const rx = TRX + lane * 0.07, rz = TRZ + lane * 0.07;
  return out.set(Math.cos(a) * rx, 0, -Math.sin(a) * rz);
}

export class Derby extends Station {
  constructor(ctx, def) {
    super(ctx, def);
    this.label = 'Bet on the Jelly Derby';
    const k = 1 + (ctx.state.day - 1) * 0.5;
    this.limits = [5 * ctx.state.limitMult(), Math.round(1000 * k * ctx.state.limitMult())];
    this.footprint = { w: 3.4, d: 2.0, ox: 0, oz: 0 };
    this.interactLocal = new THREE.Vector3(0, 0, 1.55);
    this.interactR = 1.8;
    this.camLocal = { pos: new THREE.Vector3(0, 2.05, 1.8), look: new THREE.Vector3(0, 0.45, -0.2) };
    this.bets = {}; this.chip = this.limits[0];
    this.phase = 'bet';
    this.results = [];
  }
  promptText() { return [this.label, `6 horses · odds from 2/1 to 16/1 · ${fmtMoney(this.limits[0])}–${fmtMoney(this.limits[1])}`]; }

  build() {
    const S = (this.static = new THREE.Group());
    S.position.copy(this.group.position); S.rotation.copy(this.group.rotation);
    this.ctx.director.world.staticRoot.add(S);
    const top = 0.82;
    this.top = top;
    // cabinet table
    mesh(G.rbox(3.3, top - 0.05, 1.9, 0.1), M.wood('walnut', 2, 1), 0, (top - 0.05) / 2, 0, { parent: S, cast: true });
    mesh(G.rbox(3.35, 0.05, 1.95, 0.02), M.gold(), 0, top - 0.04, 0, { parent: S });
    // grass infield + track
    const { c, g } = makeCanvas(1024, 600);
    g.fillStyle = '#2a7a2a'; g.fillRect(0, 0, 1024, 600);
    for (let i = 0; i < 4000; i++) { g.fillStyle = `rgba(${40 + Math.random() * 40},${110 + Math.random() * 60},40,0.5)`; g.fillRect(Math.random() * 1024, Math.random() * 600, 2, 6); }
    for (let i = 0; i < 12; i++) { g.fillStyle = i % 2 ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)'; g.fillRect(i * 86, 0, 86, 600); }
    mesh(G.plane(3.2, 1.8), new THREE.MeshStandardMaterial({ map: toTex(c, { wrap: false }), roughness: 0.95 }), 0, top, 0, { rx: -Math.PI / 2, parent: S });
    // dirt track ring
    const ring = new THREE.Shape();
    const outer = [], inner = [];
    for (let i = 0; i <= 64; i++) { const a = (i / 64) * TAU; outer.push(new THREE.Vector2(Math.cos(a) * (TRX + 0.45), Math.sin(a) * (TRZ + 0.45))); inner.push(new THREE.Vector2(Math.cos(a) * (TRX - 0.08), Math.sin(a) * (TRZ - 0.08))); }
    ring.setFromPoints(outer); ring.holes.push(new THREE.Path(inner.reverse()));
    const dirt = new THREE.Mesh(new THREE.ShapeGeometry(ring, 2), new THREE.MeshStandardMaterial({ color: 0x8a5a2a, roughness: 1 }));
    dirt.rotation.x = -Math.PI / 2; dirt.position.y = top + 0.004; S.add(dirt);
    // white rails
    for (const r of [-0.1, 0.47]) {
      const pts = []; for (let i = 0; i <= 80; i++) { const a = (i / 80) * TAU; pts.push(new THREE.Vector3(Math.cos(a) * (TRX + r), top + 0.035, Math.sin(a) * (TRZ + r))); }
      mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 120, 0.006, 6, true), M.ceramic(0xffffff), 0, 0, 0, { parent: S });
      for (let i = 0; i < 40; i++) { const a = (i / 40) * TAU; mesh(G.cyl(0.004, 0.004, 0.035, 5), M.ceramic(0xffffff), Math.cos(a) * (TRX + r), top + 0.018, Math.sin(a) * (TRZ + r), { parent: S }); }
    }
    // finish line + grandstand + flags
    mesh(G.plane(0.03, 0.5), M.ceramic(0xffffff), 0.0, top + 0.006, TRZ + 0.2, { rx: -Math.PI / 2, parent: S });
    mesh(G.rbox(1.6, 0.18, 0.2, 0.02), M.lacquer(0xf4f0e6), 0, top + 0.09, -TRZ - 0.65, { parent: S });
    mesh(G.box(1.62, 0.02, 0.24), M.lacquer(0xc8102e), 0, top + 0.19, -TRZ - 0.65, { parent: S });
    for (let i = 0; i < 9; i++) mesh(G.cone(0.03, 0.08, 4), M.plastic([0xff5470, 0xffe14d, 0x5b8cff][i % 3]), -0.8 + i * 0.2, top + 0.25, -TRZ - 0.65, { parent: S });
    // tote board
    this.tote = new Screen(1024, 512, 1.4);
    const tb = new THREE.Group();
    mesh(G.rbox(1.9, 0.95, 0.08, 0.03), M.blackMetal(), 0, 0, 0, { parent: tb });
    mesh(G.plane(1.82, 0.9), this.tote.mat, 0, 0, 0.042, { parent: tb });
    for (const s of [-1, 1]) mesh(G.cyl(0.03, 0.03, 1.4, 10), M.chrome(), s * 0.8, -0.95, 0, { parent: tb });
    tb.position.set(0, top + 1.55, -1.05); tb.rotation.x = 0.1;
    this.group.add(tb);
    // horses
    this.horses = HORSES.map((hd, i) => this.makeHorse(hd, i));
    for (let i = 0; i < 6; i++) { const st = barStool('chrome', 0x0b2a22); st.position.set(-1.25 + i * 0.5, 0, 1.25); S.add(st); if (i !== 2 && i !== 3) this.registerSeat(new THREE.Vector3(-1.25 + i * 0.5, 0, 1.25), Math.PI, { kind: 'table', seat: 0.78, action: 'think' }); }
    this.watchSpot = (() => { const w = this.w(1.6, 0, 1.5); return { x: w.x, z: w.z, lx: this.group.position.x, lz: this.group.position.z, station: this }; })();
    this.newRace();
  }

  makeHorse(hd, i) {
    const g = new THREE.Group();
    const jm = new THREE.MeshPhysicalMaterial({ color: hd.color, roughness: 0.2, clearcoat: 1, sheen: 0.3, emissive: hd.color, emissiveIntensity: 0.08 });
    const s = 0.55;
    const body = mesh(G.capsule(0.05 * s * 2, 0.12 * s * 2, 6, 12), jm, 0, 0.17, 0, { rz: Math.PI / 2, parent: g });
    const neck = mesh(G.capsule(0.03, 0.08, 6, 10), jm, 0.11, 0.24, 0, { rz: -0.7, parent: g });
    const head = mesh(G.capsule(0.032, 0.05, 6, 10), jm, 0.16, 0.29, 0, { rz: Math.PI / 2 - 0.3, parent: g });
    for (const sz of [-1, 1]) {
      mesh(G.sphere(0.016, 12, 10), M.ceramic(0xffffff), 0.165, 0.31, sz * 0.024, { parent: g });
      mesh(G.sphere(0.008, 8, 6), M.matte(0x111111, 0.3), 0.175, 0.305, sz * 0.03, { parent: g });
      mesh(G.cone(0.01, 0.03, 6), jm, 0.14, 0.34, sz * 0.015, { parent: g });
    }
    mesh(G.capsule(0.012, 0.06, 4, 6), M.matte(0x3a2410, 0.8), -0.12, 0.2, 0, { rz: 1.1, parent: g }); // tail
    const legs = [];
    for (const [lx, lz] of [[0.07, 0.03], [0.07, -0.03], [-0.07, 0.03], [-0.07, -0.03]]) {
      const pivot = new THREE.Group(); pivot.position.set(lx, 0.14, lz);
      mesh(G.capsule(0.013, 0.09, 4, 6), jm, 0, -0.06, 0, { parent: pivot });
      mesh(G.cyl(0.016, 0.016, 0.012, 8), M.matte(0x222222), 0, -0.115, 0, { parent: pivot });
      g.add(pivot); legs.push(pivot);
    }
    // jockey: a tiny jelly with silks and a cap
    const jk = new THREE.Group(); jk.position.set(0.01, 0.25, 0);
    const silk = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(hd.silk).offsetHSL(0.5, 0, 0), roughness: 0.5, sheen: 1 });
    mesh(G.capsule(0.03, 0.04, 6, 10), silk, 0, 0.03, 0, { parent: jk });
    mesh(G.sphere(0.03, 14, 10), new THREE.MeshPhysicalMaterial({ color: 0xffd0b0, roughness: 0.25, clearcoat: 1 }), 0.005, 0.09, 0, { parent: jk });
    mesh(G.sphere(0.031, 14, 8, ), silk, 0.0, 0.1, 0, { s: [1, 0.6, 1], parent: jk });
    for (const sz of [-1, 1]) { mesh(G.sphere(0.009, 8, 6), M.ceramic(0xffffff), 0.025, 0.095, sz * 0.011, { parent: jk }); mesh(G.sphere(0.0045, 6, 4), M.matte(0x111111), 0.032, 0.092, sz * 0.012, { parent: jk }); }
    g.add(jk);
    // number cloth
    const { c, g: x } = makeCanvas(64, 64); x.fillStyle = '#fff'; x.fillRect(0, 0, 64, 64); x.fillStyle = '#111'; x.font = 'bold 48px Arial'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(String(i + 1), 32, 34);
    for (const sz of [-1, 1]) mesh(G.plane(0.05, 0.04), new THREE.MeshStandardMaterial({ map: toTex(c, { wrap: false }) }), 0, 0.17, sz * 0.056, { ry: sz > 0 ? 0 : Math.PI, parent: g });
    g.scale.setScalar(1.25);
    this.group.add(g);
    return { g, legs, jk, body, lane: i, s: 0, v: 0, phase: rand() * TAU, ...hd, idx: i };
  }

  newRace() {
    this.odds = shuffle(ODDS.slice());
    const probs = this.odds.map((o) => 1 / o);
    const sum = probs.reduce((a, b) => a + b, 0);
    this.probs = probs.map((p) => p / sum);
    this.horses.forEach((h, i) => { h.s = 0; h.v = 0; h.finished = false; const p = trackPos(0, h.lane); h.g.position.set(p.x, this.top, p.z); h.g.rotation.y = 0; });
    this.drawTote();
  }

  drawTote(running = false) {
    const { g, w, h: H } = this.tote;
    g.fillStyle = '#04160e'; g.fillRect(0, 0, w, H);
    g.fillStyle = '#ffd24a'; g.font = 'bold 44px "Arial Black"'; g.textAlign = 'center'; g.fillText(running ? 'AND THEY\'RE OFF!' : 'JELLY DERBY · PLACE YOUR BETS', w / 2, 56);
    this.horses.forEach((hh, i) => {
      const y = 110 + i * 64;
      g.fillStyle = hh.silk; g.fillRect(40, y - 30, 60, 52);
      g.fillStyle = '#111'; g.font = 'bold 40px Arial'; g.fillText(String(i + 1), 70, y + 10);
      g.textAlign = 'left'; g.fillStyle = '#fff'; g.font = 'bold 34px sans-serif'; g.fillText(hh.name, 120, y + 8);
      g.textAlign = 'right'; g.fillStyle = '#7dff9a'; g.font = 'bold 36px "Courier New", monospace';
      const o = this.odds[i] - 1;
      g.fillText(running ? `${Math.round(hh.s * 100)}%` : `${o % 1 ? (o * 10).toFixed(0) + '/10' : o + '/1'}`, w - 40, y + 10);
      g.textAlign = 'center';
    });
    if (this.results.length) { g.fillStyle = '#aaa'; g.font = '22px sans-serif'; g.fillText('Recent winners: ' + this.results.slice(-6).map((r) => '#' + (r + 1)).join('  '), w / 2, H - 14); }
    this.tote.commit();
  }

  enter() {
    super.enter();
    const ui = this.ui;
    const p = (this.panel = ui.openPanel({ title: 'Jelly Derby', limits: '', onLeave: () => this.ctx.director.leaveStation() }));
    this.chipCtl = ui.betControl({ min: this.limits[0], max: this.limits[1], value: this.chip, getMoney: () => this.state.money, onChange: (v) => (this.chip = v), label: 'Chip' });
    this.grid = h('div', 'betgrid'); this.grid.style.gridTemplateColumns = 'repeat(6, 1fr)';
    this.cells = [];
    this.horses.forEach((hh, i) => {
      const cell = h('div', 'betcell interactive', `<div class="nm" style="color:${hh.silk}">#${i + 1} ${hh.name.split(' ')[0]}</div><div class="od"></div>`);
      cell.onclick = () => this.addBet(i);
      cell.oncontextmenu = (e) => { e.preventDefault(); delete this.bets[i]; this.renderBets(); };
      this.cells.push(cell); this.grid.append(cell);
    });
    const row = h('div', 'row');
    row.append(ui.button('Clear', 'dark small', () => { this.bets = {}; this.renderBets(); }), ui.button('Start race!', 'big green', () => this.race(), 'Space', 'SPACE'));
    p.body.append(this.chipCtl.el, this.grid, row);
    this.renderBets();
    p.msg('Pick your horse (or several), then start the race!');
  }
  canLeave() { return this.phase === 'bet'; }
  totalBet() { return Object.values(this.bets).reduce((a, b) => a + b, 0); }
  addBet(i) {
    if (this.phase !== 'bet') return;
    if (this.totalBet() + this.chip > this.limits[1]) { this.ui.toast('Max bet reached.', 'bad'); return; }
    if (this.totalBet() + this.chip > this.state.money) { this.ui.toast('Not enough cash.', 'bad'); audio.play('deny'); return; }
    this.bets[i] = (this.bets[i] || 0) + this.chip; audio.play('chip'); this.renderBets();
  }
  renderBets() {
    if (!this.panel) return;
    this.cells.forEach((c, i) => {
      c.querySelector('.od').textContent = `pays ${this.odds[i].toFixed(1)}×`;
      c.querySelector('.amt') && c.querySelector('.amt').remove();
      if (this.bets[i]) c.insertAdjacentHTML('beforeend', `<span class="amt">${fmtMoney(this.bets[i])}</span>`);
      c.classList.remove('win');
    });
    this.panel.setLimits(`Total bet ${fmtMoney(this.totalBet())}`);
  }

  async race() {
    if (this.phase !== 'bet') return;
    const total = this.totalBet();
    if (!total) { this.panel.msg('Bet on a horse first!', 'lose'); audio.play('deny'); return; }
    if (!this.takeBet(total, 'derby')) return;
    this.phase = 'race';
    // decide the finishing order: winner by true probability, rest random
    const winner = weightedPick(this.horses.map((hh, i) => ({ i, w: this.probs[i] }))).i;
    const order = [winner, ...shuffle(this.horses.map((_, i) => i).filter((i) => i !== winner))];
    this.horses.forEach((hh) => { hh.finishRank = order.indexOf(hh.idx); hh.finishTime = 11 + hh.finishRank * 0.45 + rand() * 0.3; hh.wobble = rand() * TAU; });
    this.winner = winner;
    this.raceT = 0;
    audio.play('bugle', { pos: this.worldPos() });
    this.drawTote(true);
    this.ctx.director.player.retarget(this.w(0.4, 2.15, 1.7), this.w(0, this.top - 0.35, -0.2), 0.8);
    await wait(1200);
    this.phase = 'running';
    audio.loop('gallop', { vol: 0.15, freq: 280, type: 'lowpass' });
  }

  async finish() {
    this.phase = 'done';
    audio.stopLoop('gallop');
    const w = this.winner;
    this.results.push(w);
    const hh = this.horses[w];
    let gross = 0; const total = this.totalBet();
    if (this.bets[w]) gross = this.bets[w] * this.odds[w] * this.state.perkMult('derby');
    if (this.cells && this.cells[w]) this.cells[w].classList.add('win');
    if (gross > 0) { this.state.payout(gross, total, 'derby'); this.celebrate(gross - total, total); }
    if (gross < total) { this.state.lost(total - gross, 'derby'); if (!gross) { audio.play('aww', { pos: this.worldPos() }); this.ctx.director.bigLoss(this.worldPos(), total); } }
    this.panel && this.panel.msg(`#${w + 1} ${hh.name} wins!${gross ? ' You collect ' + fmtMoney(gross) : ''}`, gross > total ? 'win' : 'lose');
    audio.play('cheer', { pos: this.worldPos() });
    await wait(2500);
    this.bets = {};
    this.phase = 'bet';
    this.newRace();
    this.renderBets();
    const pose = this.camPose(); if (this.active) this.ctx.director.player.retarget(pose.pos, pose.look, 0.8);
    this.panel && this.panel.msg('Next race! Place your bets.');
  }

  update(dt, t) {
    if (this.phase === 'running') {
      this.raceT += dt;
      let allDone = true;
      for (const hh of this.horses) {
        // target progress follows a noisy curve that lands exactly at finishTime
        const T = hh.finishTime;
        const k = clamp(this.raceT / T, 0, 1);
        const surge = Math.sin(this.raceT * 0.9 + hh.wobble) * 0.035 * Math.sin(k * Math.PI);
        const target = LAPS * (k * k * (3 - 2 * k) * 0.4 + k * 0.6) + surge;
        const prev = hh.s;
        hh.s = Math.min(LAPS, Math.max(hh.s, target));
        hh.v = (hh.s - prev) / Math.max(dt, 1e-4);
        if (k < 1) allDone = false;
        const p = trackPos(hh.s % 1, hh.lane);
        const p2 = trackPos((hh.s + 0.004) % 1, hh.lane);
        hh.g.position.set(p.x, this.top + Math.abs(Math.sin(t * 16 + hh.wobble)) * 0.012, p.z);
        hh.g.rotation.y = Math.atan2(-(p2.z - p.z), p2.x - p.x);
        const gal = t * 18 + hh.wobble;
        hh.legs.forEach((l, i) => (l.rotation.z = Math.sin(gal + (i < 2 ? 0 : Math.PI) + (i % 2) * 0.6) * 0.7));
        hh.jk.position.y = 0.25 + Math.abs(Math.sin(gal)) * 0.012;
        hh.jk.rotation.z = -0.3;
      }
      if (Math.floor(this.raceT * 2) !== this._tt) { this._tt = Math.floor(this.raceT * 2); this.drawTote(true); }
      if (allDone) this.finish();
    } else {
      for (const hh of this.horses) { hh.legs.forEach((l, i) => (l.rotation.z = Math.sin(t * 2 + i) * 0.08)); hh.g.position.y = this.top + Math.sin(t * 3 + hh.idx) * 0.003; }
    }
  }
  dispose() { audio.stopLoop('gallop'); this.tote.dispose(); }
}
