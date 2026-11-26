import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { Station, chipStack, flyTo, puck } from './common.js';
import { G, mesh } from '../engine/geo.js';
import { M } from '../engine/materials.js';
import { makeCanvas, toTex, cached, feltTexture, normalFromHeight } from '../engine/textures.js';
import { TAU, rand, fmtMoney, clamp, wait } from '../engine/util.js';
import { audio } from '../engine/audio.js';
import { h } from '../ui/ui.js';
import { FELT_COLORS, TABLE_TOP } from './tables.js';

// ============================================================================
//  CRAPS — physically simulated dice in a padded tub.
// ============================================================================

const DIE = 0.034;
// BoxGeometry face order +X,-X,+Y,-Y,+Z,-Z
const FACE_VALUES = [3, 4, 1, 6, 2, 5];
const AXES = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1)];
const TW = 3.6, TD = 1.7, FLOOR = TABLE_TOP - 0.06;

function pipTexture(n) {
  return cached('pip' + n, () => {
    const S = 128; const { c, g } = makeCanvas(S);
    g.fillStyle = '#d8102e'; g.fillRect(0, 0, S, S);
    const P = { 1: [[0.5, 0.5]], 2: [[0.25, 0.25], [0.75, 0.75]], 3: [[0.25, 0.25], [0.5, 0.5], [0.75, 0.75]], 4: [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]], 5: [[0.25, 0.25], [0.75, 0.25], [0.5, 0.5], [0.25, 0.75], [0.75, 0.75]], 6: [[0.25, 0.22], [0.75, 0.22], [0.25, 0.5], [0.75, 0.5], [0.25, 0.78], [0.75, 0.78]] }[n];
    for (const [x, y] of P) { const gr = g.createRadialGradient(x * S - 3, y * S - 3, 1, x * S, y * S, 13); gr.addColorStop(0, '#ffffff'); gr.addColorStop(1, '#d8d8d8'); g.fillStyle = gr; g.beginPath(); g.arc(x * S, y * S, 12, 0, TAU); g.fill(); }
    return toTex(c, { wrap: false });
  });
}
function diceMaterials() {
  return cached('dicemats', () => FACE_VALUES.map((v) => { const m = new THREE.MeshPhysicalMaterial({ map: pipTexture(v), roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.05, sheen: 0.2 }); m.userData.shared = true; return m; }));
}

function diamondWallTexture() {
  return cached('diamondwall', () => {
    const S = 256, n = 8;
    const hf = new Float32Array(S * S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const u = ((x / S) * n) % 1, v = ((y / S) * n) % 1; hf[y * S + x] = 1 - Math.max(Math.abs(u - 0.5), Math.abs(v - 0.5)) * 2; }
    const t = toTex(normalFromHeight(hf, S, S, 6), { srgb: false, repeat: [8, 1] });
    return t;
  });
}

const BETS = [
  { id: 'pass', name: 'Pass Line', odds: '1:1' }, { id: 'dont', name: "Don't Pass", odds: '1:1' }, { id: 'odds', name: 'Pass Odds', odds: 'true odds' },
  { id: 'field', name: 'Field', odds: '1:1 · 2× / 3×' }, { id: 'place6', name: 'Place 6', odds: '7:6' }, { id: 'place8', name: 'Place 8', odds: '7:6' },
  { id: 'hard6', name: 'Hard 6', odds: '9:1' }, { id: 'hard8', name: 'Hard 8', odds: '9:1' }, { id: 'any7', name: 'Any 7', odds: '4:1' }, { id: 'craps', name: 'Any Craps', odds: '7:1' },
];

export class Craps extends Station {
  constructor(ctx, def) {
    super(ctx, def);
    this.label = 'Shoot Craps';
    const k = 1 + (ctx.state.day - 1) * 0.5;
    this.limits = [5 * ctx.state.limitMult(), Math.round(1000 * k * ctx.state.limitMult())];
    this.footprint = { w: TW + 0.3, d: TD + 0.3, ox: 0, oz: 0 };
    this.interactLocal = new THREE.Vector3(0.9, 0, TD / 2 + 0.6);
    this.interactR = 1.5;
    this.camLocal = { pos: new THREE.Vector3(0.95, 1.72, TD / 2 + 0.55), look: new THREE.Vector3(-0.25, TABLE_TOP - 0.05, -0.15) };
    this.bets = {};
    this.chip = this.limits[0];
    this.point = 0;
    this.phase = 'bet';
    this.history = [];
  }
  promptText() { return [this.label, `Roll the bones! · ${fmtMoney(this.limits[0])}–${fmtMoney(this.limits[1])}`]; }

  build() {
    const S = (this.static = new THREE.Group());
    S.position.copy(this.group.position); S.rotation.copy(this.group.rotation);
    this.ctx.director.world.staticRoot.add(S);
    const wood = M.wood('mahogany', 2, 1);
    const theme = this.state.casino.theme;
    // outer body
    mesh(G.rbox(TW + 0.3, TABLE_TOP - 0.2, TD + 0.3, 0.12), wood, 0, (TABLE_TOP - 0.2) / 2 + 0.05, 0, { parent: S, cast: true });
    mesh(G.rbox(TW - 0.2, 0.1, TD - 0.4, 0.03), M.gold(), 0, 0.05, 0, { parent: S });
    // tub floor with layout
    const felt = mesh(G.plane(TW, TD), new THREE.MeshPhysicalMaterial({ map: this.layoutTexture(theme), normalMap: feltTexture(FELT_COLORS[theme]).normalMap, roughness: 0.92, sheen: 0.35, sheenColor: new THREE.Color(FELT_COLORS[theme]).lerp(new THREE.Color(1, 1, 1), 0.15), envMapIntensity: 0.25 }), 0, FLOOR, 0, { rx: -Math.PI / 2, parent: S });
    felt.receiveShadow = true;
    // inner walls with diamond rubber
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x1a1014, roughness: 0.7, normalMap: diamondWallTexture(), normalScale: new THREE.Vector2(1.2, 1.2) });
    const wh = 0.24;
    mesh(G.box(TW, wh, 0.05), wallMat, 0, FLOOR + wh / 2, -TD / 2 - 0.025, { parent: S });
    mesh(G.box(TW, wh, 0.05), wallMat, 0, FLOOR + wh / 2, TD / 2 + 0.025, { parent: S });
    mesh(G.box(0.05, wh, TD), wallMat, -TW / 2 - 0.025, FLOOR + wh / 2, 0, { parent: S });
    mesh(G.box(0.05, wh, TD), wallMat, TW / 2 + 0.025, FLOOR + wh / 2, 0, { parent: S });
    // padded rail with chip groove
    const railPts = [];
    const rx = TW / 2 + 0.1, rz = TD / 2 + 0.1, rr = 0.25;
    const corners = [[rx - rr, rz - rr, 0], [-(rx - rr), rz - rr, Math.PI / 2], [-(rx - rr), -(rz - rr), Math.PI], [rx - rr, -(rz - rr), Math.PI * 1.5]];
    for (const [cx, cz, a0] of corners) for (let i = 0; i <= 6; i++) { const a = a0 + (i / 6) * Math.PI / 2; railPts.push(new THREE.Vector3(cx + Math.cos(a) * rr, FLOOR + wh + 0.04, cz + Math.sin(a) * rr)); }
    const rail = new THREE.CatmullRomCurve3(railPts, true);
    mesh(new THREE.TubeGeometry(rail, 120, 0.07, 12, true), M.leather('#2a0f0a', false, 12, 1), 0, 0, 0, { parent: S, cast: true });
    mesh(new THREE.TubeGeometry(rail, 120, 0.015, 6, true), M.gold(), 0, -0.07, 0, { parent: S });
    // the stickman's stick resting on the rail
    mesh(G.cyl(0.006, 0.006, 1.4, 8), M.wood('oak'), -0.2, FLOOR + wh + 0.13, -TD / 2 - 0.02, { rz: Math.PI / 2, ry: 0.1, parent: S });
    // ---- physics
    const world = (this.physics = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) }));
    world.allowSleep = true;
    const mat = new CANNON.Material('felt'), dmat = new CANNON.Material('die');
    world.addContactMaterial(new CANNON.ContactMaterial(mat, dmat, { friction: 0.3, restitution: 0.35 }));
    world.addContactMaterial(new CANNON.ContactMaterial(dmat, dmat, { friction: 0.2, restitution: 0.4 }));
    const floor = new CANNON.Body({ mass: 0, material: mat }); floor.addShape(new CANNON.Plane()); floor.quaternion.setFromEuler(-Math.PI / 2, 0, 0); floor.position.set(0, FLOOR, 0); world.addBody(floor);
    const wall = (x, z, hx, hz) => { const b = new CANNON.Body({ mass: 0, material: mat }); b.addShape(new CANNON.Box(new CANNON.Vec3(hx, 0.4, hz))); b.position.set(x, FLOOR + 0.4, z); world.addBody(b); };
    wall(0, -TD / 2 - 0.1, TW / 2 + 0.2, 0.1); wall(0, TD / 2 + 0.1, TW / 2 + 0.2, 0.1); wall(-TW / 2 - 0.1, 0, 0.1, TD / 2 + 0.2); wall(TW / 2 + 0.1, 0, 0.1, TD / 2 + 0.2);
    this.dice = [];
    const geo = new RoundedBoxGeometry(DIE, DIE, DIE, 3, DIE * 0.14);
    for (let i = 0; i < 2; i++) {
      const m = new THREE.Mesh(geo, diceMaterials());
      m.castShadow = true;
      this.group.add(m);
      const b = new CANNON.Body({ mass: 0.03, material: dmat, shape: new CANNON.Box(new CANNON.Vec3(DIE / 2, DIE / 2, DIE / 2)), sleepSpeedLimit: 0.05, sleepTimeLimit: 0.3, linearDamping: 0.08, angularDamping: 0.1 });
      b.addEventListener('collide', (e) => { const v = Math.abs(e.contact.getImpactVelocityAlongNormal()); if (v > 0.4 && this.rolling) audio.play('diceHit', { pos: this.worldPos(), vol: clamp(v / 3, 0.2, 1) }); });
      world.addBody(b);
      this.dice.push({ mesh: m, body: b });
    }
    this.resetDice();
    this.chipsGroup = new THREE.Group(); this.group.add(this.chipsGroup);
    this.puck = puck(false); this.puck.position.set(1.68, FLOOR, 0.3); this.group.add(this.puck);
    this.watchSpot = (() => { const w = this.w(-0.8, 0, TD / 2 + 1.0); return { x: w.x, z: w.z, lx: this.group.position.x, lz: this.group.position.z, station: this }; })();
  }

  layoutTexture(theme) {
    return cached('crapslayout' + theme, () => {
      const W = 2048, Hh = Math.round(2048 * TD / TW);
      const { c, g } = makeCanvas(W, Hh);
      const base = feltTexture(FELT_COLORS[theme]).map.image;
      for (let x = 0; x < W; x += 512) for (let y = 0; y < Hh; y += 512) g.drawImage(base, x, y);
      const px = W / TW;
      g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 5; g.textAlign = 'center'; g.textBaseline = 'middle';
      const box = (x, y, w, hh, text, color = '#fff', font = 44) => { g.strokeRect(x * px, y * px, w * px, hh * px); if (text) { g.fillStyle = color; g.font = `bold ${font}px Georgia, serif`; g.fillText(text, (x + w / 2) * px, (y + hh / 2) * px); } };
      // place numbers along the far side (y small = far = -Z)
      const nums = ['4', '5', 'SIX', '8', 'NINE', '10'];
      nums.forEach((n, i) => box(0.25 + i * 0.32, 0.12, 0.32, 0.3, n, n === 'SIX' || n === '8' ? '#ffd24a' : '#fff', 64));
      box(0.25, 0.42, 1.92, 0.12, 'COME', '#ff4a5a', 52);
      box(0.25, 0.54, 1.92, 0.22, 'FIELD  2 · 3 · 4 · 9 · 10 · 11 · 12', '#ffd24a', 48);
      box(0.25, 0.76, 1.92, 0.12, "DON'T PASS BAR", '#fff', 42);
      box(0.25, 0.88, 1.92, 0.16, 'PASS LINE', '#fff', 64);
      // center props
      g.fillStyle = 'rgba(0,0,0,0.15)'; g.fillRect(2.3 * px, 0.12 * px, 1.1 * px, 1.4 * px);
      box(2.3, 0.12, 1.1, 0.2, 'SEVEN 4 TO 1', '#ff4a5a', 46);
      box(2.3, 0.32, 0.55, 0.3, 'HARD 6\n', '#fff', 40); box(2.85, 0.32, 0.55, 0.3, 'HARD 8', '#fff', 40);
      box(2.3, 0.62, 1.1, 0.2, 'ANY CRAPS 7:1', '#ff4a5a', 44);
      g.fillStyle = 'rgba(255,211,106,0.8)'; g.font = 'italic bold 50px Georgia'; g.fillText('C R A P S', 2.85 * px, 1.2 * px);
      g.fillText('ROLL THE BONES', 1.2 * px, 1.35 * px);
      return toTex(c, { wrap: false });
    });
  }

  resetDice() {
    this.dice.forEach((d, i) => {
      d.body.position.set(TW / 2 - 0.5 + i * 0.05, FLOOR + 0.3, TD / 2 - 0.15);
      d.body.velocity.setZero(); d.body.angularVelocity.setZero();
      d.body.type = CANNON.Body.KINEMATIC;
      this.sync(d);
    });
  }
  sync(d) { d.mesh.position.copy(d.body.position); d.mesh.quaternion.copy(d.body.quaternion); }

  spawnStaff(crowd) {
    const p = this.w(0, 0, -TD / 2 - 0.55);
    this.stick = crowd.staff('dealer', { x: p.x, z: p.z, ry: this.group.rotation.y }, (n) => {
      n.jelly.setAction(this.rolling ? 'cheer' : 'talk');
      n.jelly.lookTarget = this.rolling ? this.dice[0].mesh.getWorldPosition(new THREE.Vector3()) : null;
    });
    this.stick.jelly.setAction('talk');
  }

  enter() {
    super.enter();
    const ui = this.ui;
    const p = (this.panel = ui.openPanel({ title: 'Craps', limits: '', onLeave: () => this.ctx.director.leaveStation() }));
    this.chipCtl = ui.betControl({ min: this.limits[0], max: this.limits[1], value: this.chip, getMoney: () => this.state.money, onChange: (v) => (this.chip = v), label: 'Chip' });
    const grid = h('div', 'betgrid compact'); grid.style.gridTemplateColumns = 'repeat(5, 1fr)';
    this.cells = {};
    for (const b of BETS) {
      const cell = h('div', 'betcell interactive', `<div class="nm">${b.name}</div><div class="od">${b.odds}</div>`);
      cell.onclick = () => this.addBet(b.id);
      cell.oncontextmenu = (e) => { e.preventDefault(); this.removeBet(b.id); };
      this.cells[b.id] = cell; grid.append(cell);
    }
    const row = h('div', 'row');
    this.rollBtn = ui.button('Hold to throw', 'big green', () => {}, null);
    this.rollBtn.addEventListener('mousedown', () => this.charge());
    this.rollBtn.addEventListener('touchstart', (e) => { e.preventDefault(); this.charge(); }, { passive: false });
    this.meter = h('div', '', '<div style="width:160px;height:14px;border-radius:8px;background:rgba(255,255,255,.1);overflow:hidden;border:1px solid rgba(255,211,106,.4)"><i style="display:block;height:100%;width:0%;background:linear-gradient(90deg,#4dff9a,#ffd24a,#ff4a5a)"></i></div>');
    this.histEl = h('div', 'history');
    row.append(ui.button('Clear', 'dark small', () => this.clearBets()), this.rollBtn, this.meter, h('span', 'mini', 'or hold SPACE'), this.histEl);
    p.body.append(this.chipCtl.el, grid, row);
    this.keyDown = (e) => { if (e.code === 'Space' && !e.repeat) { e.preventDefault(); this.charge(); } };
    this.keyUp = (e) => { if (e.code === 'Space') this.release(); };
    this.mouseUp = () => this.release();
    window.addEventListener('keydown', this.keyDown); window.addEventListener('keyup', this.keyUp); window.addEventListener('mouseup', this.mouseUp); window.addEventListener('touchend', this.mouseUp);
    this.renderBets();
    if (this.stick) this.stick.say('New shooter coming out!');
  }
  leave() {
    super.leave();
    window.removeEventListener('keydown', this.keyDown); window.removeEventListener('keyup', this.keyUp); window.removeEventListener('mouseup', this.mouseUp); window.removeEventListener('touchend', this.mouseUp);
  }
  canLeave() { return !this.rolling && !this.hasContractBets(); }
  hasContractBets() { return this.point && (this.bets.pass || this.bets.dont || this.bets.odds); }

  totalBet() { return Object.values(this.bets).reduce((a, b) => a + b, 0); }
  addBet(id) {
    if (this.rolling) return;
    if (id === 'odds' && !(this.point && this.bets.pass)) { this.ui.toast('Odds can only be added behind a Pass Line bet once a point is set.', 'bad'); return; }
    if ((id === 'pass' || id === 'dont') && this.point) { this.ui.toast('Line bets are made on the come-out roll.', 'bad'); return; }
    if (id === 'odds' && (this.bets.odds || 0) + this.chip > this.bets.pass * 3) { this.ui.toast('Max 3× odds.', 'bad'); return; }
    if (!this.state.canAfford(this.chip)) { this.ui.toast('Not enough cash.', 'bad'); audio.play('deny'); return; }
    if (this.totalBet() + this.chip > this.limits[1]) { this.ui.toast('Table maximum reached.', 'bad'); return; }
    this.state.wager(this.chip, 'craps');
    this.bets[id] = (this.bets[id] || 0) + this.chip;
    audio.play('chip');
    this.renderBets();
  }
  removeBet(id) {
    if (this.rolling || !this.bets[id]) return;
    if ((id === 'pass' || id === 'dont') && this.point) { this.ui.toast("Contract bets can't be taken down.", 'bad'); return; }
    this.state.payout(this.bets[id], this.bets[id], 'craps', { noBuff: true });
    delete this.bets[id];
    audio.play('chip');
    this.renderBets();
  }
  clearBets() { for (const id of Object.keys(this.bets)) this.removeBet(id); }
  betSpot(id) {
    const spots = { pass: [-0.4, 0.11], dont: [-0.9, -0.03], field: [-0.6, -0.2], odds: [-0.4, 0.25], place6: [-0.75, -0.58], place8: [-0.43, -0.58], hard6: [0.775, -0.38], hard8: [1.325, -0.38], any7: [1.05, -0.63], craps: [1.05, -0.13] };
    return spots[id];
  }
  renderBets() {
    this.chipsGroup.clear();
    for (const [id, amt] of Object.entries(this.bets)) {
      const [x, z] = this.betSpot(id);
      const st = chipStack(amt); st.position.set(x, FLOOR, z); this.chipsGroup.add(st);
    }
    if (!this.panel) return;
    for (const b of BETS) {
      const c = this.cells[b.id];
      c.querySelector('.amt') && c.querySelector('.amt').remove();
      if (this.bets[b.id]) c.insertAdjacentHTML('beforeend', `<span class="amt">${fmtMoney(this.bets[b.id])}</span>`);
      c.classList.toggle('hot', (b.id === 'odds' && this.point && this.bets.pass) || ((b.id === 'pass' || b.id === 'dont') && !this.point));
    }
    this.panel.setLimits(this.point ? `POINT IS ${this.point} · on table ${fmtMoney(this.totalBet())}` : `COME-OUT ROLL · on table ${fmtMoney(this.totalBet())}`);
    this.panel.msg(this.point ? `Point is ${this.point}. Hit it again before a 7!` : 'Come-out roll: bet the Pass Line and hold to throw!');
    this.histEl.innerHTML = this.history.slice(-10).map((r) => `<i style="background:${r === 7 ? '#c81a34' : '#333'}">${r}</i>`).join('');
  }

  charge() {
    if (this.rolling || this.charging) return;
    if (!Object.keys(this.bets).length) { this.panel.msg('Place a bet first!', 'lose'); audio.play('deny'); return; }
    this.charging = true; this.power = 0; this.chargeT = 0;
    audio.play('dice', { vol: 0.6 });
  }
  release() {
    if (!this.charging) return;
    this.charging = false;
    this.throwDice(clamp(this.power, 0.15, 1));
  }

  throwDice(power) {
    this.rolling = true;
    this.rollT = 0;
    this.settleT = 0;
    this.ctx.director.player.poke();
    for (const [i, d] of this.dice.entries()) {
      const b = d.body;
      b.type = CANNON.Body.DYNAMIC; b.wakeUp();
      b.position.set(TW / 2 - 0.55 + i * 0.06, FLOOR + 0.18, TD / 2 - 0.25 - i * 0.04);
      b.quaternion.setFromEuler(rand() * TAU, rand() * TAU, rand() * TAU);
      const sp = 3.2 + power * 3.8;
      const dir = new THREE.Vector3(-1, 0, -0.32 + (rand() - 0.5) * 0.3).normalize();
      b.velocity.set(dir.x * sp, 1.1 + rand() * 0.6, dir.z * sp);
      b.angularVelocity.set((rand() - 0.5) * 40, (rand() - 0.5) * 40, (rand() - 0.5) * 40);
    }
    audio.play('whoosh', { pos: this.worldPos(), vol: 0.6 });
    if (this.stick) this.stick.say(['Dice are out!', 'Here we go!', 'Shooter\'s rolling!'][Math.floor(rand() * 3)]);
    this.ctx.director.player.retarget(this.w(0.2, 1.65, TD / 2 + 0.35), this.w(-1.1, FLOOR, -0.1), 0.6);
  }

  readDie(d) {
    const q = d.mesh.quaternion;
    let best = -2, val = 1;
    AXES.forEach((a, i) => { const y = a.clone().applyQuaternion(q).y; if (y > best) { best = y; val = FACE_VALUES[i]; } });
    return { val, cocked: best < 0.92 };
  }

  async resolveRoll() {
    const a = this.readDie(this.dice[0]), b = this.readDie(this.dice[1]);
    if (a.cocked || b.cocked) {
      this.panel && this.panel.msg('Cocked dice — no roll! Throw again.', 'lose');
      if (this.stick) this.stick.say('No roll! Re-throw.');
      this.rolling = false; this.resetDice();
      return;
    }
    const s = a.val + b.val, hard = a.val === b.val;
    this.history.push(s);
    if (this.stick) this.stick.say(s === 7 ? (this.point ? 'Seven out!' : 'Seven! Winner on the pass!') : s === 11 ? 'Yo-leven!' : s === 2 ? 'Snake eyes!' : s === 12 ? 'Boxcars!' : hard && (s === 6 || s === 8) ? `Hard ${s}!` : `${s}!`);
    audio.play('ding', { pos: this.worldPos(), f: 1200 + s * 60 });
    let gross = 0, stakeResolved = 0, profitTotal = 0;
    const win = (id, mult) => { const amt = this.bets[id]; if (!amt) return; const g = amt * (1 + mult); gross += g; stakeResolved += amt; profitTotal += g - amt; delete this.bets[id]; };
    const lose = (id) => { const amt = this.bets[id]; if (!amt) return; stakeResolved += amt; profitTotal -= amt; delete this.bets[id]; };
    const push = (id) => { const amt = this.bets[id]; if (!amt) return; gross += amt; stakeResolved += amt; delete this.bets[id]; };
    // one-roll bets
    if (this.bets.field) { if ([3, 4, 9, 10, 11].includes(s)) win('field', 1); else if (s === 2) win('field', 2); else if (s === 12) win('field', 3); else lose('field'); }
    if (this.bets.any7) { if (s === 7) win('any7', 4); else lose('any7'); }
    if (this.bets.craps) { if ([2, 3, 12].includes(s)) win('craps', 7); else lose('craps'); }
    // hardways
    for (const n of [6, 8]) { const id = 'hard' + n; if (!this.bets[id]) continue; if (s === n && hard) win(id, 9); else if (s === 7 || (s === n && !hard)) lose(id); }
    // place bets (work when a point is on)
    for (const n of [6, 8]) { const id = 'place' + n; if (!this.bets[id] || !this.point) continue; if (s === n) { const amt = this.bets[id]; const g = amt * 7 / 6; gross += g; profitTotal += g; } else if (s === 7) lose(id); }
    // line bets
    let msg = '';
    if (!this.point) {
      if (s === 7 || s === 11) { win('pass', 1); lose('dont'); msg = `${s} — Natural! Pass wins.`; }
      else if (s === 2 || s === 3) { lose('pass'); win('dont', 1); msg = `${s} — Craps!`; }
      else if (s === 12) { lose('pass'); push('dont'); msg = '12 — Craps! Don\'t Pass pushes.'; }
      else { this.point = s; msg = `Point is ${s}!`; audio.play('bell', { pos: this.worldPos() }); }
    } else {
      if (s === this.point) {
        const oddsPay = { 4: 2, 10: 2, 5: 1.5, 9: 1.5, 6: 1.2, 8: 1.2 }[this.point];
        win('pass', 1); win('odds', oddsPay); lose('dont');
        msg = `${s} — Winner! Point made.`; this.point = 0;
      } else if (s === 7) {
        lose('pass'); lose('odds'); win('dont', 1);
        msg = 'Seven out!'; this.point = 0;
      } else msg = `${s}. Point is still ${this.point}.`;
    }
    gross *= profitTotal > 0 ? this.state.perkMult('craps') : 1;
    if (gross > 0) this.state.payout(gross, Math.min(gross, stakeResolved), 'craps');
    if (profitTotal < 0) { this.state.lost(-profitTotal, 'craps'); this.ctx.director.bigLoss(this.worldPos(), -profitTotal); }
    if (profitTotal > 0) this.celebrate(profitTotal, Math.max(1, stakeResolved));
    // puck
    this.group.remove(this.puck);
    this.puck = puck(!!this.point);
    const px = this.point ? -1.55 + [4, 5, 6, 8, 9, 10].indexOf(this.point) * 0.32 + 0.16 : 1.68;
    this.puck.position.set(px, FLOOR + 0.002, this.point ? -0.7 : 0.3);
    this.group.add(this.puck);
    this.renderBets();
    this.panel && this.panel.msg(msg + (profitTotal > 0 ? ` +${fmtMoney(profitTotal)}` : profitTotal < 0 ? ` -${fmtMoney(-profitTotal)}` : ''), profitTotal > 0 ? 'win' : profitTotal < 0 ? 'lose' : '');
    await wait(1400);
    this.rolling = false;
    this.resetDice();
    const pose = this.camPose();
    if (this.active) this.ctx.director.player.retarget(pose.pos, pose.look, 0.6);
  }

  update(dt) {
    if (this.charging) {
      this.chargeT += dt;
      this.power = 0.5 - Math.cos(this.chargeT * 3.2) * 0.5;
      const bar = this.meter && this.meter.querySelector('i'); if (bar) bar.style.width = (this.power * 100).toFixed(0) + '%';
      // shake dice in hand
      this.dice.forEach((d, i) => { d.mesh.position.set(TW / 2 - 0.5 + i * 0.05 + Math.sin(this.chargeT * 40 + i) * 0.01, FLOOR + 0.3 + Math.cos(this.chargeT * 37) * 0.01, TD / 2 - 0.15); });
      if (Math.random() < 0.1) audio.play('dice', { vol: 0.25 });
    }
    if (this.rolling) {
      this.rollT += dt;
      const steps = Math.ceil(Math.min(dt, 1 / 20) / (1 / 240));
      for (let i = 0; i < steps; i++) this.physics.step(1 / 240);
      for (const d of this.dice) this.sync(d);
      const asleep = this.dice.every((d) => d.body.sleepState === CANNON.Body.SLEEPING || d.body.velocity.length() < 0.02);
      if (asleep && this.rollT > 0.8) this.settleT += dt; else this.settleT = 0;
      if ((this.settleT > 0.35 || this.rollT > 7) && !this.resolving) { this.resolving = true; this.resolveRoll().finally(() => (this.resolving = false)); }
    }
  }
}
