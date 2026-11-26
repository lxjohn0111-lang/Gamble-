import * as THREE from 'three';
import { Station, chipStack, flyTo } from './common.js';
import { G, mesh, smoothLathe } from '../engine/geo.js';
import { M } from '../engine/materials.js';
import { makeCanvas, toTex, cached, feltTexture } from '../engine/textures.js';
import { TAU, rand, fmtMoney, clamp, wait, easeOutCubic } from '../engine/util.js';
import { audio } from '../engine/audio.js';
import { h } from '../ui/ui.js';
import { FELT_COLORS, TABLE_TOP } from './tables.js';
import { barStool } from '../world/props.js';

// ============================================================================
//  EUROPEAN ROULETTE — clickable 3D layout, physical-looking ball.
// ============================================================================

const ORDER = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
const REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const colorOf = (n) => (n === 0 ? 'g' : REDS.has(n) ? 'r' : 'b');

// layout geometry (table-local, on the felt). x along the table, z toward the player.
const CW = 0.115, CH = 0.12;
const LX0 = -0.38, LZ0 = -0.36; // top-left of the number grid (row of 3,6,9…)
const numCell = (n) => { const col = Math.floor((n - 1) / 3), row = n % 3 === 0 ? 0 : n % 3 === 2 ? 1 : 2; return { x: LX0 + col * CW + CW / 2, z: LZ0 + row * CH + CH / 2, col, row }; };

export class Roulette extends Station {
  constructor(ctx, def) {
    super(ctx, def);
    this.label = def.high ? 'Play High-Limit Roulette' : 'Play Roulette';
    this.footprint = { w: 3.3, d: 1.5, ox: 0, oz: -0.05 };
    this.interactLocal = new THREE.Vector3(0.2, 0, 1.25);
    this.interactR = 1.6;
    this.camLocal = { pos: new THREE.Vector3(0.3, 1.55, 0.95), look: new THREE.Vector3(0.25, 0.78, -0.12) };
    this.chip = this.limits[0];
    this.bets = new Map(); this.lastBets = null;
    this.history = [];
    this.phase = 'bet';
    this.rotorAngle = 0; this.rotorV = 0.5;
  }
  promptText() { return [this.label, `European single zero · ${fmtMoney(this.limits[0])}–${fmtMoney(this.limits[1])}`]; }

  build() {
    const S = (this.static = new THREE.Group());
    S.position.copy(this.group.position); S.rotation.copy(this.group.rotation);
    this.ctx.director.world.staticRoot.add(S);
    const theme = this.state.casino.theme;
    const wood = M.wood('mahogany', 2, 1);
    // table body
    mesh(G.rbox(3.3, 0.12, 1.45, 0.05), wood, 0, TABLE_TOP - 0.07, -0.05, { parent: S, cast: true });
    mesh(G.rbox(2.6, TABLE_TOP - 0.2, 0.9, 0.05), wood, 0.1, (TABLE_TOP - 0.2) / 2, -0.1, { parent: S, cast: true });
    mesh(G.rbox(2.9, 0.06, 1.1, 0.02), M.gold(), 0.1, 0.03, -0.1, { parent: S });
    // padded rail around the player side
    const railPts = [new THREE.Vector3(-1.62, TABLE_TOP + 0.02, -0.7), new THREE.Vector3(-1.62, TABLE_TOP + 0.02, 0.6), new THREE.Vector3(1.62, TABLE_TOP + 0.02, 0.6), new THREE.Vector3(1.62, TABLE_TOP + 0.02, -0.7)];
    const rail = new THREE.CatmullRomCurve3(railPts, false, 'catmullrom', 0.02);
    mesh(new THREE.TubeGeometry(rail, 64, 0.05, 10), M.leather('#2a0f0a', false, 8, 1), 0, 0, 0, { parent: S, cast: true });
    // felt with printed layout
    const tex = this.layoutTexture(theme);
    const felt = mesh(G.plane(3.12, 1.25), new THREE.MeshPhysicalMaterial({ map: tex, normalMap: feltTexture(FELT_COLORS[theme]).normalMap, roughness: 0.92, sheen: 0.35, sheenRoughness: 0.7, sheenColor: new THREE.Color(FELT_COLORS[theme]).lerp(new THREE.Color(1, 1, 1), 0.15), envMapIntensity: 0.25 }), 0, TABLE_TOP, -0.05, { rx: -Math.PI / 2, parent: S });
    felt.receiveShadow = true;
    this.feltBounds = { x0: -1.56, z0: -0.675, w: 3.12, d: 1.25 };
    // wheel housing (static bowl)
    const wc = new THREE.Vector3(-1.08, TABLE_TOP, -0.12);
    this.wheelCenter = wc;
    mesh(smoothLathe('rbowl', [[0.0, 0], [0.42, 0], [0.47, 0.02], [0.47, 0.1], [0.44, 0.11], [0.4, 0.07], [0.33, 0.05]], 16, 64), M.wood('walnut', 1, 1), wc.x, wc.y, wc.z, { parent: S, cast: true });
    mesh(G.torus(0.355, 0.012, 8, 72), M.chrome(), wc.x, wc.y + 0.06, wc.z, { rx: Math.PI / 2, parent: S });
    // diamond deflectors on the track
    for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; mesh(G.octa(0.014), M.chrome(), wc.x + Math.cos(a) * 0.37, wc.y + 0.07, wc.z + Math.sin(a) * 0.37, { s: [1, 0.5, 1.8], ry: -a, parent: S }); }
    // stools
    for (let i = 0; i < 5; i++) { const st = barStool('chrome', 0x4a0a14); st.position.set(-0.6 + i * 0.55, 0, 1.0); S.add(st); }
    // limit sign + marquee history board
    this.board = this.makeBoard(); this.board.position.set(-1.45, 0, -0.78); this.group.add(this.board);
    // ---- dynamic: rotor, ball, chips, highlight
    const rotor = (this.rotor = new THREE.Group());
    rotor.position.set(wc.x, wc.y + 0.035, wc.z);
    this.group.add(rotor);
    const pocketTex = this.pocketTexture();
    mesh(smoothLathe('rotor', [[0.0, 0.08], [0.06, 0.075], [0.12, 0.05], [0.2, 0.03], [0.3, 0.015], [0.33, 0.012]], 16, 74), M.wood('walnut', 1, 1), 0, 0, 0, { parent: rotor });
    const ring = mesh(G.ring(0.21, 0.33, 74), new THREE.MeshPhysicalMaterial({ map: pocketTex, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.08 }), 0, 0.028, 0, { rx: -Math.PI / 2, parent: rotor });
    ring.receiveShadow = true;
    const frets = new THREE.InstancedMesh(G.box(0.002, 0.016, 0.06), M.chrome(), 37);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < 37; i++) { const a = (i / 37) * TAU; m4.compose(new THREE.Vector3(Math.cos(a) * 0.245, 0.034, -Math.sin(a) * 0.245), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), a + Math.PI / 2), new THREE.Vector3(1, 1, 1)); frets.setMatrixAt(i, m4); }
    rotor.add(frets);
    // turret
    mesh(smoothLathe('turret', [[0.0, 0.2], [0.02, 0.19], [0.025, 0.12], [0.06, 0.1], [0.09, 0.08], [0.1, 0.07]], 16, 32), M.gold(), 0, 0, 0, { parent: rotor });
    for (let i = 0; i < 4; i++) { const a = (i / 4) * TAU; mesh(G.cyl(0.006, 0.006, 0.11, 8), M.gold(), Math.cos(a) * 0.05, 0.19, Math.sin(a) * 0.05, { rz: Math.PI / 2, ry: -a, parent: rotor }); mesh(G.sphere(0.012, 10, 8), M.gold(), Math.cos(a) * 0.105, 0.19, Math.sin(a) * 0.105, { parent: rotor }); }
    this.ball = mesh(G.sphere(0.0105, 16, 12), M.ceramic(0xfdfdfd), 0, 0, 0, { parent: this.group });
    this.ball.castShadow = true;
    this.ball.visible = false;
    this.chipsGroup = new THREE.Group(); this.group.add(this.chipsGroup);
    this.hl = mesh(G.plane(1, 1), new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.25, depthWrite: false, blending: THREE.AdditiveBlending }), 0, TABLE_TOP + 0.002, 0, { rx: -Math.PI / 2, parent: this.group });
    this.hl.visible = false;
    // dolly (win marker)
    this.dolly = new THREE.Group();
    mesh(G.cyl(0.018, 0.024, 0.05, 16), M.crystal(), 0, 0.025, 0, { parent: this.dolly });
    mesh(G.sphere(0.018, 12, 10), M.gold(), 0, 0.055, 0, { parent: this.dolly });
    this.dolly.visible = false; this.group.add(this.dolly);
    this.watchSpot = (() => { const w = this.w(0, 0, 2.3); return { x: w.x, z: w.z, lx: this.group.position.x, lz: this.group.position.z, station: this }; })();
    for (let i = 0; i < 5; i++) { if (i === 2) continue; this.registerSeat(new THREE.Vector3(-0.6 + i * 0.55, 0, 1.0), Math.PI, { kind: 'table', seat: 0.78, action: 'cards' }); }
    this.raycaster = new THREE.Raycaster();
    this.feltMesh = felt;
  }

  layoutTexture(theme) {
    return cached('roulettelayout' + theme, () => {
      const W = 2048, H = Math.round(2048 * 1.25 / 3.12);
      const { c, g } = makeCanvas(W, H);
      const base = feltTexture(FELT_COLORS[theme]).map.image;
      for (let x = 0; x < W; x += 512) for (let y = 0; y < H; y += 512) g.drawImage(base, x, y);
      const px = W / 3.12;
      const toC = (x, z) => [(x + 1.56) * px, (z + 0.675) * px];
      g.lineWidth = 4; g.strokeStyle = 'rgba(255,255,255,0.85)';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      const cell = (x, z, w, hh, fill, text, textColor = '#fff', font = 46) => {
        const [cx, cy] = toC(x, z);
        if (fill) { g.fillStyle = fill; g.fillRect(cx + 6, cy + 6, w * px - 12, hh * px - 12); }
        g.strokeRect(cx, cy, w * px, hh * px);
        if (text) { g.fillStyle = textColor; g.font = `bold ${font}px Georgia, serif`; g.save(); g.translate(cx + (w * px) / 2, cy + (hh * px) / 2); g.fillText(text, 0, 2); g.restore(); }
      };
      for (let n = 1; n <= 36; n++) { const p = numCell(n); cell(p.x - CW / 2, p.z - CH / 2, CW, CH, REDS.has(n) ? '#b0101e' : '#111', String(n)); }
      // zero
      const [zx, zy] = toC(LX0 - CW, LZ0);
      g.fillStyle = '#0e7a32'; g.beginPath(); g.moveTo(zx + CW * px, zy); g.lineTo(zx + 18, zy); g.lineTo(zx, zy + 1.5 * CH * px); g.lineTo(zx + 18, zy + 3 * CH * px); g.lineTo(zx + CW * px, zy + 3 * CH * px); g.closePath(); g.fill(); g.stroke();
      g.fillStyle = '#fff'; g.font = 'bold 54px Georgia'; g.fillText('0', zx + (CW * px) / 2 + 6, zy + 1.5 * CH * px);
      // columns 2:1
      for (let r = 0; r < 3; r++) cell(LX0 + 12 * CW, LZ0 + r * CH, CW, CH, null, '2:1', '#fff', 36);
      // dozens
      ['1st 12', '2nd 12', '3rd 12'].forEach((t, i) => cell(LX0 + i * 4 * CW, LZ0 + 3 * CH, 4 * CW, 0.1, null, t, '#fff', 42));
      const outs = [['1-18', null], ['EVEN', null], ['', '#b0101e'], ['', '#111'], ['ODD', null], ['19-36', null]];
      outs.forEach(([t, f], i) => {
        cell(LX0 + i * 2 * CW, LZ0 + 3 * CH + 0.1, 2 * CW, 0.1, null, t, '#fff', 40);
        if (f) { const [cx, cy] = toC(LX0 + i * 2 * CW + CW, LZ0 + 3 * CH + 0.15); g.fillStyle = f; g.beginPath(); g.moveTo(cx - 60, cy); g.lineTo(cx, cy - 34); g.lineTo(cx + 60, cy); g.lineTo(cx, cy + 34); g.closePath(); g.fill(); g.stroke(); }
      });
      // decorations
      g.fillStyle = 'rgba(255,211,106,0.85)'; g.font = 'italic bold 44px Georgia';
      const [tx, ty] = toC(0.4, 0.45); g.fillText('ROULETTE · SINGLE ZERO · 35 TO 1', tx, ty);
      return toTex(c, { wrap: false });
    });
  }

  pocketTexture() {
    return cached('pockets', () => {
      const S = 1024, c0 = S / 2;
      const { c, g } = makeCanvas(S);
      const rIn = (0.21 / 0.33) * c0, rOut = c0;
      const step = TAU / 37;
      for (let i = 0; i < 37; i++) {
        const n = ORDER[i];
        // ring UVs: canvas angle a corresponds to local angle (counter-clockwise from +X seen from above)
        const a0 = -(i * step), a1 = a0 - step;
        g.fillStyle = n === 0 ? '#0e7a32' : REDS.has(n) ? '#b0101e' : '#111';
        g.beginPath(); g.arc(c0, c0, rOut, a1, a0); g.arc(c0, c0, rIn, a0, a1, true); g.closePath(); g.fill();
        g.save(); g.translate(c0, c0); g.rotate((a0 + a1) / 2); g.translate(rOut * 0.86, 0); g.rotate(Math.PI / 2);
        g.fillStyle = '#fff'; g.font = 'bold 40px Georgia'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(n), 0, 0); g.restore();
      }
      // pocket floors (inner band slightly darker)
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.beginPath(); g.arc(c0, c0, rOut * 0.74, 0, TAU); g.arc(c0, c0, rIn, 0, TAU, true); g.fill();
      g.strokeStyle = '#d8b04a'; g.lineWidth = 6; g.beginPath(); g.arc(c0, c0, rOut * 0.74, 0, TAU); g.stroke();
      return toTex(c, { wrap: false });
    });
  }

  makeBoard() {
    const g = new THREE.Group();
    mesh(G.cyl(0.03, 0.04, 1.6, 12), M.chrome(), 0, 0.8, 0, { parent: g });
    mesh(G.cyl(0.18, 0.2, 0.04, 20), M.chrome(), 0, 0.02, 0, { parent: g });
    const { c, g: x } = makeCanvas(256, 512);
    this.boardCtx = x; this.boardCanvas = c;
    this.boardTex = toTex(c, { wrap: false });
    mesh(G.rbox(0.36, 0.66, 0.06, 0.02), M.blackMetal(), 0, 1.9, 0, { parent: g });
    mesh(G.plane(0.32, 0.62), new THREE.MeshBasicMaterial({ map: this.boardTex, color: new THREE.Color(1.6, 1.6, 1.6) }), 0, 1.9, 0.031, { parent: g });
    this.drawBoard();
    return g;
  }
  drawBoard() {
    const x = this.boardCtx;
    x.fillStyle = '#050204'; x.fillRect(0, 0, 256, 512);
    x.fillStyle = '#ffd24a'; x.font = 'bold 26px "Arial Black"'; x.textAlign = 'center'; x.fillText('LAST 12', 128, 36);
    const hist = this.history.slice(-12).reverse();
    hist.forEach((n, i) => {
      const col = colorOf(n), xx = col === 'r' ? 70 : col === 'b' ? 186 : 128;
      x.fillStyle = col === 'r' ? '#ff3a3a' : col === 'b' ? '#ffffff' : '#3aff6a';
      x.font = `bold ${i === 0 ? 40 : 30}px "Courier New", monospace`;
      x.fillText(String(n), xx, 80 + i * 36);
    });
    if (this.boardTex) this.boardTex.needsUpdate = true;
  }

  spawnStaff(crowd) {
    const p = this.w(-0.9, 0, -0.9);
    this.croupier = crowd.staff('dealer', { x: p.x, z: p.z, ry: this.group.rotation.y }, (n) => {
      if (!this.reaching) n.jelly.setAction(this.phase === 'spin' ? 'think' : 'deal');
      const pl = crowd.player;
      n.jelly.lookTarget = this.phase === 'spin' ? this.w(this.wheelCenter.x, 1.0, this.wheelCenter.z) : pl && n.root.position.distanceToSquared(pl.pos) < 25 ? pl.camera.position : null;
    });
  }

  // ---------------------------------------------------------------- bets
  /** Resolve a felt position (local x,z) into a bet. */
  betAt(x, z) {
    const gx = (x - LX0) / CW, gz = (z - LZ0) / CH;
    // zero
    if (gx < 0 && gx > -1 && gz >= 0 && gz <= 3) return { key: 'n0', type: 'straight', nums: [0], pay: 35, x: LX0 - CW / 2, z: LZ0 + 1.5 * CH, w: CW, h: 3 * CH };
    if (gx >= 0 && gx < 12 && gz >= 0 && gz < 3) {
      const col = Math.floor(gx), row = Math.floor(gz);
      const fx = gx - col, fz = gz - row;
      const num = (c, r) => c * 3 + (r === 0 ? 3 : r === 1 ? 2 : 1);
      const e = 0.22;
      const nearX = fx < e ? -1 : fx > 1 - e ? 1 : 0, nearZ = fz < e ? -1 : fz > 1 - e ? 1 : 0;
      const c2 = col + nearX, r2 = row + nearZ;
      if (nearX && nearZ && c2 >= 0 && c2 < 12 && r2 >= 0 && r2 < 3) {
        const nums = [num(col, row), num(c2, row), num(col, r2), num(c2, r2)].sort((a, b) => a - b);
        return { key: 'c' + nums.join('-'), type: 'corner', nums, pay: 8, x: LX0 + (col + (nearX > 0 ? 1 : 0)) * CW, z: LZ0 + (row + (nearZ > 0 ? 1 : 0)) * CH, w: 2 * CW, h: 2 * CH, point: true };
      }
      if (nearX && c2 >= 0 && c2 < 12) { const nums = [num(col, row), num(c2, row)].sort((a, b) => a - b); return { key: 's' + nums.join('-'), type: 'split', nums, pay: 17, x: LX0 + (col + (nearX > 0 ? 1 : 0)) * CW, z: LZ0 + (row + 0.5) * CH, w: 2 * CW, h: CH, point: true }; }
      if (nearZ && r2 >= 0 && r2 < 3) { const nums = [num(col, row), num(col, r2)].sort((a, b) => a - b); return { key: 's' + nums.join('-'), type: 'split', nums, pay: 17, x: LX0 + (col + 0.5) * CW, z: LZ0 + (row + (nearZ > 0 ? 1 : 0)) * CH, w: CW, h: 2 * CH, point: true }; }
      const n = num(col, row);
      return { key: 'n' + n, type: 'straight', nums: [n], pay: 35, x: LX0 + (col + 0.5) * CW, z: LZ0 + (row + 0.5) * CH, w: CW, h: CH };
    }
    if (gx >= 12 && gx < 13 && gz >= 0 && gz < 3) {
      const row = Math.floor(gz);
      const nums = []; for (let n = 1; n <= 36; n++) if (numCell(n).row === row) nums.push(n);
      return { key: 'col' + row, type: 'column', nums, pay: 2, x: LX0 + 12.5 * CW, z: LZ0 + (row + 0.5) * CH, w: CW, h: CH };
    }
    const dz = z - (LZ0 + 3 * CH);
    if (gx >= 0 && gx < 12 && dz >= 0 && dz < 0.1) {
      const d = Math.floor(gx / 4);
      const nums = []; for (let n = d * 12 + 1; n <= d * 12 + 12; n++) nums.push(n);
      return { key: 'doz' + d, type: 'dozen', nums, pay: 2, x: LX0 + (d * 4 + 2) * CW, z: LZ0 + 3 * CH + 0.05, w: 4 * CW, h: 0.1 };
    }
    if (gx >= 0 && gx < 12 && dz >= 0.1 && dz < 0.2) {
      const i = Math.floor(gx / 2);
      const defs = [['low', (n) => n >= 1 && n <= 18], ['even', (n) => n > 0 && n % 2 === 0], ['red', (n) => REDS.has(n)], ['black', (n) => n > 0 && !REDS.has(n)], ['odd', (n) => n % 2 === 1], ['high', (n) => n >= 19]];
      const [k, f] = defs[i];
      const nums = []; for (let n = 0; n <= 36; n++) if (f(n)) nums.push(n);
      return { key: k, type: k, nums, pay: 1, even: true, x: LX0 + (i * 2 + 1) * CW, z: LZ0 + 3 * CH + 0.15, w: 2 * CW, h: 0.1 };
    }
    return null;
  }

  totalBet() { let t = 0; for (const b of this.bets.values()) t += b.amount; return t; }

  placeBet(b, amount = this.chip, silent = false) {
    if (this.phase !== 'bet') return;
    const total = this.totalBet();
    if (total + amount > this.limits[1]) { if (!silent) this.ui.toast('Table maximum reached.', 'bad'); return; }
    if (total + amount > this.state.money) { if (!silent) { this.ui.toast('Not enough cash.', 'bad'); audio.play('deny'); } return; }
    const ex = this.bets.get(b.key);
    if (ex) { ex.amount += amount; this.chipsGroup.remove(ex.stack); }
    const bet = ex || { ...b, amount };
    bet.stack = chipStack(bet.amount);
    bet.stack.position.set(b.x, TABLE_TOP, b.z);
    this.chipsGroup.add(bet.stack);
    this.bets.set(b.key, bet);
    if (!silent) audio.play('chip', { count: 2 });
    this.updatePanel();
  }

  updatePanel() {
    if (!this.panel) return;
    this.panel.setLimits(`Total bet ${fmtMoney(this.totalBet())} · ${this.bets.size} bet${this.bets.size === 1 ? '' : 's'} · max ${fmtMoney(this.limits[1])}`);
    this.histEl.innerHTML = this.history.slice(-16).map((n) => `<i class="${colorOf(n)}">${n}</i>`).join('');
  }

  // ---------------------------------------------------------------- input
  onMove = (e) => {
    if (this.phase !== 'bet') { this.hl.visible = false; return; }
    const b = this.pick(e);
    if (b) { this.hl.visible = true; this.hl.position.set(b.x, TABLE_TOP + 0.003, b.z); this.hl.scale.set(b.point ? 0.05 : b.w, b.point ? 0.05 : b.h, 1); this.hoverBet = b; this.ctx.app && 0; document.body.style.cursor = 'pointer'; }
    else { this.hl.visible = false; this.hoverBet = null; document.body.style.cursor = ''; }
  };
  onDown = (e) => {
    if (e.button !== 0 && e.button !== 2) return;
    const b = this.pick(e);
    if (!b) return;
    if (e.button === 2) { const ex = this.bets.get(b.key); if (ex) { this.chipsGroup.remove(ex.stack); this.bets.delete(b.key); audio.play('chip'); this.updatePanel(); } return; }
    this.placeBet(b);
  };
  pick(e) {
    const canvas = this.ctx.director.app.canvas;
    const r = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.ctx.camera);
    const hit = this.raycaster.intersectObject(this.feltMesh, false)[0];
    if (!hit) return null;
    const lp = this.group.worldToLocal(hit.point.clone());
    return this.betAt(lp.x, lp.z);
  }

  enter() {
    super.enter();
    const ui = this.ui;
    const p = (this.panel = ui.openPanel({ title: this.def.high ? 'High-Limit Roulette' : 'Roulette', limits: '', onLeave: () => this.ctx.director.leaveStation() }));
    this.chipCtl = ui.betControl({ min: this.limits[0], max: this.limits[1], value: this.chip, getMoney: () => this.state.money, onChange: (v) => (this.chip = v), label: 'Chip' });
    const quick = h('div', 'row');
    const qb = (label, key) => ui.button(label, 'dark small', () => { const b = this.namedBet(key); if (b) this.placeBet(b); });
    quick.append(qb('RED', 'red'), qb('BLACK', 'black'), qb('ODD', 'odd'), qb('EVEN', 'even'), qb('1-18', 'low'), qb('19-36', 'high'), qb('1st 12', 'doz0'), qb('2nd 12', 'doz1'), qb('3rd 12', 'doz2'));
    const row = h('div', 'row');
    this.spinBtn = ui.button('Spin!', 'big green', () => this.spin(), 'Space', 'SPACE');
    row.append(ui.button('Clear', 'dark small', () => this.clearBets(true)), ui.button('Rebet', 'dark small', () => this.rebet(), 'KeyR', 'R'), ui.button('Double', 'dark small', () => this.doubleBets(), 'KeyD', 'D'), this.spinBtn);
    this.histEl = h('div', 'history');
    p.body.append(this.chipCtl.el, quick, row, this.histEl);
    p.msg('Click the felt to place chips (right-click removes). Splits & corners: click on the lines!');
    this.updatePanel();
    const c = this.ctx.director.app.canvas;
    c.addEventListener('mousemove', this.onMove); c.addEventListener('mousedown', this.onDown);
    if (this.croupier) this.croupier.say('Place your bets, please!');
  }
  leave() {
    super.leave();
    const c = this.ctx.director.app.canvas;
    c.removeEventListener('mousemove', this.onMove); c.removeEventListener('mousedown', this.onDown);
    document.body.style.cursor = '';
    this.hl.visible = false;
    if (this.phase === 'bet') this.clearBets(false);
  }
  canLeave() { return this.phase === 'bet'; }
  namedBet(key) {
    const pts = { red: [LX0 + 5 * CW, LZ0 + 3 * CH + 0.15], black: [LX0 + 7 * CW, LZ0 + 3 * CH + 0.15], odd: [LX0 + 9 * CW, LZ0 + 3 * CH + 0.15], even: [LX0 + 3 * CW, LZ0 + 3 * CH + 0.15], low: [LX0 + CW, LZ0 + 3 * CH + 0.15], high: [LX0 + 11 * CW, LZ0 + 3 * CH + 0.15], doz0: [LX0 + 2 * CW, LZ0 + 3 * CH + 0.05], doz1: [LX0 + 6 * CW, LZ0 + 3 * CH + 0.05], doz2: [LX0 + 10 * CW, LZ0 + 3 * CH + 0.05] };
    const p = pts[key]; return p ? this.betAt(p[0], p[1]) : null;
  }
  clearBets(sound) { for (const b of this.bets.values()) this.chipsGroup.remove(b.stack); this.bets.clear(); if (sound) audio.play('chip', { count: 4 }); this.updatePanel(); }
  rebet() { if (!this.lastBets || this.phase !== 'bet') return; this.clearBets(false); for (const b of this.lastBets) this.placeBet(b, b.amount, true); audio.play('chipStack'); }
  doubleBets() { if (this.phase !== 'bet') return; for (const b of [...this.bets.values()]) this.placeBet(b, b.amount, true); audio.play('chipStack'); }

  // ---------------------------------------------------------------- spin
  async spin() {
    if (this.phase !== 'bet') return;
    const total = this.totalBet();
    if (total <= 0) { this.panel.msg('Place a bet on the felt first!', 'lose'); audio.play('deny'); return; }
    if (!this.takeBet(total, 'roulette')) return;
    this.lastBets = [...this.bets.values()].map((b) => ({ ...b, stack: null }));
    this.phase = 'spin';
    this.hl.visible = false;
    this.dolly.visible = false;
    document.body.style.cursor = '';
    this.panel.msg('No more bets!');
    if (this.croupier) { this.croupier.say('No more bets!'); this.croupier.jelly.setReach(1, this.w(this.wheelCenter.x + 0.1, TABLE_TOP + 0.15, this.wheelCenter.z), 'pinch'); setTimeout(() => this.croupier && this.croupier.jelly.setReach(1, null), 700); }
    // result
    this.result = ORDER[Math.floor(rand() * 37)];
    const pocketIdx = ORDER.indexOf(this.result);
    this.rotorV = 2.6 + rand() * 0.6;
    const T = 7.5 + rand() * 1.5;
    this.ballAnim = { t: 0, T, rel0: rand() * TAU, pocketA: (pocketIdx + 0.5) / 37 * TAU, turns: 9 + Math.floor(rand() * 3), seed: rand() * 100 };
    this.ball.visible = true;
    audio.play('whoosh', { pos: this.worldPos() });
    audio.loop('ball', { vol: 0.12, freq: 2200, q: 0.8 });
    const wc = this.wheelCenter;
    this.ctx.director.player.retarget(this.w(wc.x + 0.55, 1.45, wc.z + 0.65), this.w(wc.x, TABLE_TOP + 0.03, wc.z), 0.9);
  }

  async finish() {
    audio.stopLoop('ball');
    const n = this.result;
    this.history.push(n);
    this.drawBoard();
    const colName = n === 0 ? 'GREEN' : REDS.has(n) ? 'RED' : 'BLACK';
    this.panel && this.panel.msg(`${n} ${colName}!`);
    if (this.croupier) this.croupier.say(`${n} ${colName.toLowerCase()}!`);
    audio.play('ding', { pos: this.worldPos(), f: 1760 });
    await wait(1200);
    const pose = this.camPose();
    if (this.active) this.ctx.director.player.retarget(pose.pos, pose.look, 0.8);
    // dolly on the winning number
    const cell = n === 0 ? { x: LX0 - CW / 2, z: LZ0 + 1.5 * CH } : numCell(n);
    this.dolly.position.set(cell.x, TABLE_TOP, cell.z); this.dolly.visible = true;
    audio.play('clack');
    // settle bets
    let gross = 0, stake = 0, refund = 0;
    const straightPay = this.state.modifier && this.state.modifier.rouletteStraight ? this.state.modifier.rouletteStraight : 35;
    for (const b of this.bets.values()) {
      stake += b.amount;
      if (b.nums.includes(n)) {
        const pay = b.type === 'straight' ? straightPay : b.pay;
        gross += b.amount * (pay + 1);
        b.won = true;
      } else if (n === 0 && this.state.perks.horseshoe) refund += b.amount / 2;
    }
    await wait(600);
    for (const b of this.bets.values()) {
      if (b.won) { audio.play('chipStack'); const win = chipStack(b.amount * (b.type === 'straight' ? straightPay : b.pay)); win.position.set(b.x + 0.04, TABLE_TOP, b.z + 0.02); this.chipsGroup.add(win); b.payStack = win; }
      else flyTo(this.tweens, b.stack, this.w(-0.9, TABLE_TOP + 0.05, -0.6), { dur: 0.5, arc: 0.05, onDone: () => this.chipsGroup.remove(b.stack) });
    }
    await wait(900);
    const total = gross + refund;
    if (total > 0) this.state.payout(total, stake, 'roulette');
    const profit = total - stake;
    if (profit > 0) { this.panel && this.panel.msg(`${n} ${colName}! You win ${fmtMoney(gross)}`, 'win'); this.celebrate(profit, stake); }
    else { this.state.lost(stake - total, 'roulette'); this.panel && this.panel.msg(`${n} ${colName}. ${refund ? `Horseshoe refund ${fmtMoney(refund)}.` : 'No luck this time.'}`, 'lose'); audio.play('lose', { vol: 0.5 }); this.ctx.director.bigLoss(this.worldPos(), stake - total); }
    // sweep winnings to player
    const to = this.w(0.3, TABLE_TOP + 0.3, 1.1);
    for (const b of this.bets.values()) if (b.won) { for (const st of [b.stack, b.payStack]) flyTo(this.tweens, st, to, { dur: 0.5, arc: 0.12, delay: 0.3, onDone: () => this.chipsGroup.remove(st) }); }
    this.bets.clear();
    await wait(900);
    this.phase = 'bet';
    this.ball.visible = false;
    this.updatePanel();
    if (this.panel) this.panel.msg('Place your bets! (R to rebet)');
  }

  update(dt, t) {
    // rotor
    this.rotorV = Math.max(0.35, this.rotorV - dt * 0.12);
    this.rotorAngle += this.rotorV * dt;
    this.rotor.rotation.y = this.rotorAngle;
    const a = this.ballAnim;
    if (a) {
      a.t += dt;
      const k = Math.min(1, a.t / a.T);
      const wc = this.wheelCenter;
      // relative angle (ball vs rotor) spins down to the target pocket
      const f = Math.pow(1 - k, 2.2);
      let rel = a.pocketA - a.turns * TAU * f + (a.rel0 * f);
      let r, y;
      const drop = 0.62;
      if (k < drop) { r = 0.38 - k * 0.01; y = 0.075; }
      else {
        const kk = (k - drop) / (1 - drop);
        r = 0.38 - (0.38 - 0.27) * easeOutCubic(Math.min(1, kk * 1.4));
        const bounce = Math.abs(Math.sin(kk * 18 + a.seed)) * 0.02 * Math.pow(1 - kk, 2);
        y = 0.075 - 0.035 * Math.min(1, kk * 1.6) + bounce;
        rel += Math.sin(kk * 25 + a.seed) * 0.25 * Math.pow(1 - kk, 3);
        if (bounce > 0.012 && Math.random() < 0.3) audio.play('clack', { pos: this.worldPos(), vol: 0.7 });
      }
      const ang = this.rotorAngle + rel;
      this.ball.position.set(wc.x + Math.cos(ang) * r, TABLE_TOP + 0.035 + y, wc.z - Math.sin(ang) * r);
      audio.setLoop('ball', { vol: k < drop ? 0.14 * (1 - k) : 0.02, freq: 1400 + (1 - k) * 1600 });
      if (k >= 1) { this.ballAnim = null; this.ballLocked = { rel: a.pocketA }; this.finish(); }
    } else if (this.ballLocked && this.ball.visible) {
      const wc = this.wheelCenter, ang = this.rotorAngle + this.ballLocked.rel;
      this.ball.position.set(wc.x + Math.cos(ang) * 0.27, TABLE_TOP + 0.075, wc.z - Math.sin(ang) * 0.27);
    }
  }
  dispose() { audio.stopLoop('ball'); }
}
