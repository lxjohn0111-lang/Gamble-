import * as THREE from 'three';
import { Station } from './common.js';
import { G, mesh } from '../engine/geo.js';
import { M } from '../engine/materials.js';
import { makeCanvas, toTex } from '../engine/textures.js';
import { TAU, rand, fmtMoney, shuffle, randPick } from '../engine/util.js';
import { audio } from '../engine/audio.js';
import { h } from '../ui/ui.js';

// ============================================================================
//  SCRATCH-O-MATIC kiosk: buy tickets, scratch the foil with your mouse.
// ============================================================================

const TICKETS = [
  { id: 'lucky7', name: 'Lucky 7s', price: 5, color: '#c8102e', accent: '#ffd24a', prizes: [[5, 0.15], [10, 0.08], [20, 0.04], [50, 0.012], [100, 0.006], [500, 0.0008], [2500, 0.00025]], desc: 'Match 3 amounts, win that amount.' },
  { id: 'jelly', name: 'Jelly Jackpot', price: 20, color: '#1f8a5a', accent: '#ff7eb3', prizes: [[20, 0.15], [40, 0.08], [100, 0.04], [200, 0.012], [500, 0.005], [2000, 0.0008], [10000, 0.00017]], desc: 'Find 3 jelly faces to win the prize below them.' },
  { id: 'golden', name: 'Golden Ticket', price: 50, color: '#a8740a', accent: '#fff3b0', prizes: [[50, 0.14], [100, 0.08], [250, 0.035], [500, 0.015], [1000, 0.006], [5000, 0.0009], [25000, 0.00017]], desc: 'Match any of YOUR numbers to a WINNING number.' },
];

function pickPrize(t, luck) {
  let r = rand();
  for (let i = t.prizes.length - 1; i >= 0; i--) { const [amt, p] = t.prizes[i]; const pp = p * luck; if (r < pp) return amt; r -= pp; }
  return 0;
}

export class ScratchKiosk extends Station {
  constructor(ctx, def) {
    super(ctx, def);
    this.label = 'Buy scratch cards';
    this.footprint = { w: 1.2, d: 0.7, ox: 0, oz: -0.05 };
    this.interactLocal = new THREE.Vector3(0, 0, 1.0);
    this.interactR = 1.3;
    this.camLocal = { pos: new THREE.Vector3(0, 1.62, 1.05), look: new THREE.Vector3(0, 1.45, 0) };
    const scale = 1 + Math.floor((ctx.state.day - 1) / 2);
    this.tickets = TICKETS.map((t) => ({ ...t, price: t.price * scale, prizes: t.prizes.map(([a, p]) => [a * scale, p]) }));
    this.card = null;
  }
  promptText() { return [this.label, `Scratch-O-Matic · tickets from ${fmtMoney(this.tickets[0].price)}`]; }

  build() {
    const S = (this.static = new THREE.Group());
    S.position.copy(this.group.position); S.rotation.copy(this.group.rotation);
    this.ctx.director.world.staticRoot.add(S);
    const body = M.lacquer(0x1a3a8a);
    mesh(G.rbox(1.1, 1.9, 0.6, 0.05), body, 0, 0.95, -0.05, { parent: S, cast: true });
    mesh(G.rbox(1.14, 0.3, 0.64, 0.05), M.lacquer(0x8a0a1a), 0, 2.0, -0.05, { parent: S });
    for (const s of [-1, 1]) mesh(G.rbox(0.04, 1.9, 0.62, 0.015), M.chrome(), s * 0.56, 0.95, -0.05, { parent: S });
    // header
    const hc = makeCanvas(512, 128);
    hc.g.fillStyle = '#8a0a1a'; hc.g.fillRect(0, 0, 512, 128);
    hc.g.font = 'bold 50px "Arial Black", Impact, sans-serif'; hc.g.textAlign = 'center'; hc.g.textBaseline = 'middle';
    hc.g.lineWidth = 8; hc.g.strokeStyle = '#2a0005'; hc.g.strokeText('SCRATCH-O-MATIC', 256, 66); hc.g.fillStyle = '#ffd24a'; hc.g.fillText('SCRATCH-O-MATIC', 256, 66);
    mesh(G.plane(1.05, 0.26), new THREE.MeshBasicMaterial({ map: toTex(hc.c, { wrap: false }), color: new THREE.Color(1.05, 1.05, 1.05) }), 0, 2.0, 0.275, { parent: S });
    // display window with tickets
    const dc = makeCanvas(512, 512);
    const g = dc.g;
    g.fillStyle = '#0a0a20'; g.fillRect(0, 0, 512, 512);
    this.tickets.forEach((t, i) => {
      const y = 20 + i * 164;
      g.save(); g.translate(256, y + 72); g.rotate((i - 1) * 0.04);
      g.fillStyle = t.color; g.fillRect(-220, -68, 440, 136);
      g.strokeStyle = t.accent; g.lineWidth = 6; g.strokeRect(-212, -60, 424, 120);
      g.fillStyle = t.accent; g.font = 'bold 44px "Arial Black", sans-serif'; g.textAlign = 'center'; g.fillText(t.name.toUpperCase(), 0, -6);
      g.fillStyle = '#fff'; g.font = 'bold 30px sans-serif'; g.fillText(`${fmtMoney(t.price)} · WIN UP TO ${fmtMoney(t.prizes[t.prizes.length - 1][0])}`, 0, 38);
      g.restore();
    });
    mesh(G.plane(0.86, 0.86), new THREE.MeshBasicMaterial({ map: toTex(dc.c, { wrap: false }), color: new THREE.Color(1.3, 1.3, 1.3) }), 0, 1.42, 0.258, { parent: S });
    mesh(G.plane(0.9, 0.9), M.glass(), 0, 1.42, 0.27, { parent: S });
    // ticket slot + coin slot + buttons
    mesh(G.box(0.4, 0.04, 0.05), M.blackMetal(), 0, 0.82, 0.27, { parent: S });
    mesh(G.box(0.08, 0.12, 0.03), M.chrome(), 0.38, 1.0, 0.27, { parent: S });
    for (let i = 0; i < 3; i++) mesh(G.cyl(0.04, 0.04, 0.03, 16), M.emissive([0xff3a3a, 0x3aff6a, 0xffd24a][i], 1.4), -0.3 + i * 0.12, 0.95, 0.28, { rx: Math.PI / 2, parent: S });
    mesh(G.box(0.7, 0.18, 0.2), M.chrome(), 0, 0.45, 0.32, { parent: S });
    this.lightMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xffd24a, emissiveIntensity: 1 });
    for (const s of [-1, 1]) mesh(G.box(0.03, 1.6, 0.03), this.lightMat, s * 0.5, 1.1, 0.27, { parent: this.group });
  }

  enter() {
    super.enter();
    const ui = this.ui;
    const p = (this.panel = ui.openPanel({ title: 'Scratch-O-Matic', limits: ui.isTouch ? 'Scratch the silver foil with your finger' : 'Scratch the silver foil with your mouse', onLeave: () => this.ctx.director.leaveStation() }));
    this.area = h('div', 'scratch-wrap');
    const buy = h('div', 'row');
    for (const t of this.tickets) {
      const b = ui.button(`${t.name} · ${fmtMoney(t.price)}`, 'small', () => this.buy(t));
      b.style.background = `linear-gradient(180deg, ${t.accent}, ${t.color})`;
      b.style.color = '#fff'; b.style.textShadow = '0 1px 2px #000';
      buy.append(b);
    }
    this.revealBtn = ui.button('Reveal all', 'dark small', () => this.revealAll(), 'Space', 'SPACE');
    buy.append(this.revealBtn);
    p.body.append(this.area, buy);
    p.msg('Pick a ticket!');
    this.ctx.director.player.retarget(this.w(0, 1.9, 1.7), this.w(0, 1.4, 0), 0.6);
  }
  canLeave() { return !this.card || this.card.done; }
  leave() { super.leave(); if (this.card && !this.card.done) this.revealAll(true); this.card = null; }

  buy(t) {
    if (this.card && !this.card.done) { this.ui.toast('Finish scratching this one first!', 'bad'); return; }
    if (!this.takeBet(t.price, 'scratch')) return;
    audio.play('register', { vol: 0.6 });
    const luck = 1 + 0.15 * (this.state.perks.socks || 0) * 1 + (this.state.modifier && this.state.modifier.scratchLuck ? 0.5 : 0);
    const prize = pickPrize(t, luck);
    this.makeCard(t, prize);
  }

  makeCard(t, prize) {
    this.area.innerHTML = '';
    const W = 560, H = 300;
    const wrap = h('div', 'scratch-card interactive');
    const base = makeCanvas(W, H), foil = makeCanvas(W, H);
    base.c.style.width = foil.c.style.width = W + 'px';
    foil.c.className = 'foil';
    wrap.append(base.c, foil.c);
    this.area.append(wrap);
    const g = base.g;
    // ticket background
    const bg = g.createLinearGradient(0, 0, W, H); bg.addColorStop(0, t.color); bg.addColorStop(1, '#1a0a14');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(255,255,255,${rand() * 0.06})`; g.beginPath(); g.arc(rand() * W, rand() * H, rand() * 30, 0, TAU); g.fill(); }
    g.strokeStyle = t.accent; g.lineWidth = 6; g.strokeRect(8, 8, W - 16, H - 16);
    g.fillStyle = t.accent; g.font = 'bold 34px "Arial Black", Impact, sans-serif'; g.textAlign = 'left'; g.fillText(t.name.toUpperCase(), 24, 50);
    g.fillStyle = '#fff'; g.font = 'bold 14px sans-serif'; g.fillText(t.desc, 24, 72);
    g.textAlign = 'right'; g.font = 'bold 22px "Arial Black"'; g.fillStyle = t.accent; g.fillText(fmtMoney(t.price), W - 24, 46);
    // cells
    const cells = [];
    const amounts = t.prizes.map((p) => p[0]);
    let symbols = [];
    if (t.id === 'lucky7' || t.id === 'jelly') {
      const grid = 9;
      if (t.id === 'lucky7') {
        // 9 amounts; exactly three of `prize` if winning, otherwise at most two of any
        if (prize) symbols.push(prize, prize, prize);
        const pool = amounts.filter((a) => a !== prize);
        const counts = {};
        while (symbols.length < grid) { const a = randPick(pool.concat([amounts[amounts.length - 1]])); if ((counts[a] || 0) < 2 && !(a === prize)) { counts[a] = (counts[a] || 0) + 1; symbols.push(a); } }
        shuffle(symbols);
      } else {
        const faces = ['JELLY', '★', '♦', '♣', '♥', '♠'];
        const n = prize ? 3 : rand() < 0.6 ? 2 : 1; // near-misses tease
        symbols = Array(n).fill('JELLY');
        while (symbols.length < grid) symbols.push(randPick(faces.slice(1)));
        shuffle(symbols);
      }
      const cw = t.id === 'jelly' ? 140 : 158, ch = 62, x0 = 24, y0 = 92;
      for (let i = 0; i < grid; i++) {
        const cx = x0 + (i % 3) * (cw + 12), cy = y0 + Math.floor(i / 3) * (ch + 10);
        cells.push({ x: cx, y: cy, w: cw, h: ch });
        g.fillStyle = 'rgba(255,255,255,0.92)'; g.beginPath(); g.roundRect(cx, cy, cw, ch, 10); g.fill();
        const s = symbols[i];
        g.textAlign = 'center'; g.textBaseline = 'middle';
        if (s === 'JELLY') { this.drawJelly(g, cx + cw / 2, cy + ch / 2, 24); }
        else if (typeof s === 'number') { g.fillStyle = s >= amounts[3] ? '#c8102e' : '#1a1a2a'; g.font = `bold ${s >= 1000 ? 26 : 30}px "Arial Black"`; g.fillText(fmtMoney(s), cx + cw / 2, cy + ch / 2 + 2); }
        else { g.font = 'bold 38px "Segoe UI Symbol", "DejaVu Sans", Arial, sans-serif'; g.fillStyle = { '★': '#e8a400', '♦': '#c8102e', '♥': '#c8102e', '♣': '#1a1a2a', '♠': '#1a1a2a' }[s] || '#333'; g.fillText(s, cx + cw / 2, cy + ch / 2 + 2); }
      }
      if (t.id === 'jelly') {
        const show = prize || randPick(amounts.slice(2));
        g.fillStyle = 'rgba(255,255,255,0.92)'; g.beginPath(); g.roundRect(x0 + 3 * (cw + 12) - 2, y0, 60, 3 * ch + 20, 10); g.fill();
        cells.push({ x: x0 + 3 * (cw + 12) - 2, y: y0, w: 60, h: 3 * ch + 20 });
        g.save(); g.translate(x0 + 3 * (cw + 12) + 28, y0 + (3 * ch + 20) / 2); g.rotate(-Math.PI / 2);
        g.fillStyle = '#c8102e'; g.font = 'bold 26px "Arial Black"'; g.fillText('PRIZE ' + fmtMoney(show), 0, 0); g.restore();
      }
    } else {
      // golden: 2 winning numbers + 8 of yours, each with a prize
      const win = [];
      while (win.length < 2) { const n = 1 + Math.floor(rand() * 40); if (!win.includes(n)) win.push(n); }
      const mine = [];
      const prizes = [];
      const winIdx = prize ? Math.floor(rand() * 8) : -1;
      for (let i = 0; i < 8; i++) {
        let n;
        if (i === winIdx) n = randPick(win);
        else do { n = 1 + Math.floor(rand() * 40); } while (win.includes(n) || mine.includes(n));
        mine.push(n);
        prizes.push(i === winIdx ? prize : randPick(amounts));
      }
      g.fillStyle = '#fff'; g.font = 'bold 14px sans-serif'; g.textAlign = 'left'; g.fillText('WINNING NUMBERS', 30, 100); g.fillText('YOUR NUMBERS', 200, 100);
      for (let i = 0; i < 2; i++) { const cx = 30 + i * 78, cy = 110; cells.push({ x: cx, y: cy, w: 70, h: 70 }); g.fillStyle = 'rgba(255,255,255,0.92)'; g.beginPath(); g.roundRect(cx, cy, 70, 70, 35); g.fill(); g.fillStyle = '#a8740a'; g.font = 'bold 34px "Arial Black"'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(win[i], cx + 35, cy + 37); }
      for (let i = 0; i < 8; i++) {
        const cx = 200 + (i % 4) * 86, cy = 110 + Math.floor(i / 4) * 86;
        cells.push({ x: cx, y: cy, w: 80, h: 78 });
        g.fillStyle = 'rgba(255,255,255,0.92)'; g.beginPath(); g.roundRect(cx, cy, 80, 78, 10); g.fill();
        g.fillStyle = '#1a1a2a'; g.font = 'bold 30px "Arial Black"'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(mine[i], cx + 40, cy + 30);
        g.fillStyle = '#c8102e'; g.font = 'bold 14px sans-serif'; g.fillText(fmtMoney(prizes[i]), cx + 40, cy + 62);
      }
    }
    // foil
    const f = foil.g;
    const fg = f.createLinearGradient(0, 0, W, H); fg.addColorStop(0, '#b8bcc8'); fg.addColorStop(0.5, '#e8ecf4'); fg.addColorStop(1, '#9aa0ae');
    for (const c of cells) {
      f.fillStyle = fg; f.beginPath(); f.roundRect(c.x - 3, c.y - 3, c.w + 6, c.h + 6, 10); f.fill();
      for (let k = 0; k < 30; k++) { f.fillStyle = `rgba(255,255,255,${rand() * 0.6})`; f.fillRect(c.x + rand() * c.w, c.y + rand() * c.h, 2, 2); }
      f.fillStyle = 'rgba(80,80,100,0.5)'; f.font = 'bold 12px sans-serif'; f.textAlign = 'center'; f.textBaseline = 'middle';
      f.fillText('SCRATCH', c.x + c.w / 2, c.y + c.h / 2);
    }
    const card = (this.card = { t, prize, cells, foil, done: false, revealed: cells.map(() => false) });
    // scratching
    let down = false, last = null, sndT = 0;
    const scratchAt = (x, y) => {
      f.globalCompositeOperation = 'destination-out';
      f.lineCap = 'round'; f.lineWidth = 34;
      f.beginPath();
      if (last) f.moveTo(last[0], last[1]); else f.moveTo(x - 0.1, y);
      f.lineTo(x, y); f.stroke();
      f.globalCompositeOperation = 'source-over';
      last = [x, y];
      const now = performance.now();
      if (now - sndT > 55) { sndT = now; audio.play('scratch'); }
    };
    const pos = (e) => { const r = foil.c.getBoundingClientRect(); const p = e.touches ? e.touches[0] : e; return [((p.clientX - r.left) / r.width) * W, ((p.clientY - r.top) / r.height) * H]; };
    const start = (e) => { e.preventDefault(); down = true; last = null; scratchAt(...pos(e)); };
    const move = (e) => { if (!down) return; e.preventDefault(); scratchAt(...pos(e)); };
    const end = () => { if (!down) return; down = false; last = null; this.checkReveal(); };
    foil.c.addEventListener('mousedown', start); foil.c.addEventListener('mousemove', move); window.addEventListener('mouseup', end);
    foil.c.addEventListener('touchstart', start, { passive: false }); foil.c.addEventListener('touchmove', move, { passive: false }); window.addEventListener('touchend', end);
    card.cleanup = () => { window.removeEventListener('mouseup', end); window.removeEventListener('touchend', end); };
    this.panel.msg(`${t.name}: scratch all the boxes!`);
    this.lightT = 0;
  }

  drawJelly(g, x, y, r) {
    const gr = g.createRadialGradient(x - r * 0.3, y - r * 0.4, 2, x, y, r * 1.2); gr.addColorStop(0, '#b8ff8a'); gr.addColorStop(1, '#1f9a3a');
    g.fillStyle = gr; g.beginPath(); g.ellipse(x, y, r * 0.8, r, 0, 0, TAU); g.fill();
    for (const s of [-1, 1]) { g.fillStyle = '#fff'; g.beginPath(); g.arc(x + s * r * 0.3, y - r * 0.25, r * 0.25, 0, TAU); g.fill(); g.fillStyle = '#111'; g.beginPath(); g.arc(x + s * r * 0.3, y - r * 0.15, r * 0.12, 0, TAU); g.fill(); }
  }

  checkReveal() {
    const c = this.card;
    if (!c || c.done) return;
    const g = c.foil.g;
    let all = true;
    c.cells.forEach((cell, i) => {
      if (c.revealed[i]) return;
      const d = g.getImageData(cell.x, cell.y, cell.w, cell.h).data;
      let clear = 0, n = 0;
      for (let k = 3; k < d.length; k += 16) { n++; if (d[k] < 40) clear++; }
      if (clear / n > 0.55) { c.revealed[i] = true; g.clearRect(cell.x - 4, cell.y - 4, cell.w + 8, cell.h + 8); audio.play('pop', { vol: 0.4 }); }
      else all = false;
    });
    if (all) this.resolve();
  }
  revealAll(silent) {
    const c = this.card;
    if (!c || c.done) return;
    c.foil.g.clearRect(0, 0, c.foil.c.width, c.foil.c.height);
    c.revealed = c.revealed.map(() => true);
    if (!silent) audio.play('scratch');
    this.resolve(silent);
  }
  resolve(silent) {
    const c = this.card;
    if (c.done) return;
    c.done = true;
    c.cleanup && c.cleanup();
    if (c.prize > 0) {
      const gross = c.prize;
      this.state.payout(gross, c.t.price, 'scratch');
      if (!silent) { this.panel.msg(`WINNER! ${fmtMoney(gross)}`, 'win'); this.celebrate(gross - c.t.price, c.t.price); }
      this.lightT = 3;
    } else {
      this.state.lost(c.t.price, 'scratch');
      if (!silent) { this.panel.msg(randPick(['Not a winner. Try another?', 'So close!', 'Next one\'s the winner…']), 'lose'); audio.play('lose', { vol: 0.4 }); }
    }
  }
  update(dt, t) {
    this.lightT = Math.max(0, (this.lightT || 0) - dt);
    this.lightMat.emissiveIntensity = this.lightT > 0 ? (Math.floor(t * 10) % 2 ? 4 : 0.3) : 0.8 + Math.sin(t * 2) * 0.3;
  }
}
