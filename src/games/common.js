import * as THREE from 'three';
import { G, mesh } from '../engine/geo.js';
import { M } from '../engine/materials.js';
import { makeCanvas, toTex, cached } from '../engine/textures.js';
import { TAU, shuffle, rand, fmtMoney, easeOutCubic, easeInOutCubic } from '../engine/util.js';
import { audio } from '../engine/audio.js';

// ============================================================================
//  Station base class
// ============================================================================
export class Station {
  constructor(ctx, def) {
    this.ctx = ctx;
    this.def = def;
    this.type = def.type;
    this.group = new THREE.Group();
    this.group.name = 'station:' + def.type;
    this.group.position.set(def.x, 0, def.z);
    this.group.rotation.y = def.rot || 0;
    this.footprint = { w: 1, d: 1, ox: 0, oz: 0 };
    this.interactLocal = new THREE.Vector3(0, 0, 1.2);
    this.interactR = 1.3;
    this.camLocal = { pos: new THREE.Vector3(0, 1.5, 1.2), look: new THREE.Vector3(0, 1.1, 0) };
    this.label = 'Play';
    this.npcSeats = [];
    this.active = false;
    this.busy = false;
    const lm = ctx.state.limitMult ? ctx.state.limitMult() : 1;
    this.limits = def.limits ? [def.limits[0] * lm, def.limits[1] * lm] : null;
  }
  get state() { return this.ctx.state; }
  get ui() { return this.ctx.ui; }
  get tweens() { return this.ctx.tweens; }
  /** World position from station-local. */
  w(x, y, z) { return this.group.localToWorld(new THREE.Vector3(x, y, z)); }
  worldPos() { return this.group.position; }
  interactWorld() { return this.w(this.interactLocal.x, 0, this.interactLocal.z); }
  camPose() { this.group.updateMatrixWorld(true); return { pos: this.w(this.camLocal.pos.x, this.camLocal.pos.y, this.camLocal.pos.z), look: this.w(this.camLocal.look.x, this.camLocal.look.y, this.camLocal.look.z) }; }
  promptText() { return [this.label, this.limits ? `Bets ${fmtMoney(this.limits[0])} – ${fmtMoney(this.limits[1])}` : ''] ; }
  registerSeat(local, ry, extra = {}) {
    const wp = this.w(local.x, 0, local.z);
    const ary = this.group.rotation.y + ry;
    const ap = this.w(local.x + Math.sin(ry) * 0.75, 0, local.z + Math.cos(ry) * 0.75);
    const seat = { x: wp.x, z: wp.z, ry: ary, seat: extra.seat || 0.78, station: this, approach: { x: ap.x, z: ap.z }, standOff: 0.75, ...extra };
    this.npcSeats.push(seat);
    return seat;
  }
  build() {}
  enter() { this.active = true; }
  leave() { this.active = false; }
  update() {}
  /** Helper: start a round only if the bet is affordable and within limits. */
  takeBet(amount, game) {
    if (amount <= 0) return false;
    if (!this.state.canAfford(amount)) { this.ui.toast("You can't cover that bet.", 'bad'); audio.play('deny'); return false; }
    return this.state.wager(amount, game || this.type);
  }
  /** Common win celebration with tiered feedback. */
  celebrate(profit, stake, pos) {
    const d = this.ctx.director;
    if (profit <= 0) return;
    const ratio = profit / Math.max(1, stake);
    if (ratio >= 50 || profit >= 5000) { d.bigWin('JACKPOT!', '+' + fmtMoney(profit), 'jackpot', pos || this.worldPos()); }
    else if (ratio >= 10 || profit >= 1500) { d.bigWin('MEGA WIN!', '+' + fmtMoney(profit), 'mega', pos || this.worldPos()); }
    else if (ratio >= 4 || profit >= 400) { d.bigWin('BIG WIN!', '+' + fmtMoney(profit), 'big', pos || this.worldPos()); }
    else { audio.play('winSmall'); d.flash(0.25, 0xffd060); }
  }
  dispose() {}
}

// ============================================================================
//  Chips
// ============================================================================
export const CHIP_COLORS = { 1: ['#f2f2f2', '#2a4ac8'], 5: ['#d8202e', '#ffffff'], 25: ['#1e9a48', '#ffffff'], 100: ['#151515', '#f2f2f2'], 500: ['#7a2ac8', '#ffd24a'], 1000: ['#f2b01e', '#1a1a1a'], 5000: ['#1e8ad8', '#ffffff'] };
export const CHIP_VALUES = [5000, 1000, 500, 100, 25, 5, 1];
const CHIP_R = 0.02, CHIP_H = 0.0036;

function chipMaterials(v) {
  return cached('chipmat' + v, () => {
    const [base, stripe] = CHIP_COLORS[v];
    // edge
    const e = makeCanvas(256, 16);
    e.g.fillStyle = base; e.g.fillRect(0, 0, 256, 16);
    e.g.fillStyle = stripe; for (let i = 0; i < 8; i++) e.g.fillRect(i * 32 + 4, 0, 12, 16);
    // face
    const f = makeCanvas(128, 128);
    const g = f.g;
    g.fillStyle = base; g.beginPath(); g.arc(64, 64, 64, 0, TAU); g.fill();
    g.fillStyle = stripe;
    for (let i = 0; i < 8; i++) { g.save(); g.translate(64, 64); g.rotate((i / 8) * TAU); g.fillRect(-8, -64, 16, 18); g.restore(); }
    g.strokeStyle = stripe; g.lineWidth = 3; g.beginPath(); g.arc(64, 64, 40, 0, TAU); g.stroke();
    g.fillStyle = base === '#f2f2f2' || base === '#f2b01e' ? '#ffffff' : 'rgba(255,255,255,0.15)';
    g.beginPath(); g.arc(64, 64, 37, 0, TAU); g.fill();
    g.fillStyle = base === '#151515' ? '#f2f2f2' : base === '#f2f2f2' ? '#2a4ac8' : '#1a1a1a';
    g.font = `bold ${v >= 1000 ? 26 : 34}px "Arial Black", sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(v >= 1000 ? v / 1000 + 'K' : String(v), 64, 66);
    const side = new THREE.MeshPhysicalMaterial({ map: toTex(e.c, { wrap: true }), roughness: 0.4, clearcoat: 0.6 });
    const face = new THREE.MeshPhysicalMaterial({ map: toTex(f.c, { wrap: false }), roughness: 0.35, clearcoat: 0.8, clearcoatRoughness: 0.2 });
    side.userData.shared = face.userData.shared = true;
    return [side, face, face];
  });
}
const chipGeo = () => cached('chipgeo', () => new THREE.CylinderGeometry(CHIP_R, CHIP_R, CHIP_H, 28, 1));

export function breakdown(amount) {
  const out = [];
  let a = Math.round(amount);
  for (const v of CHIP_VALUES) while (a >= v && out.length < 40) { out.push(v); a -= v; }
  return out;
}
export function chipMesh(v) { const m = new THREE.Mesh(chipGeo(), chipMaterials(v)); m.castShadow = false; return m; }

/** Stack of chips representing an amount. Returns Group with .amount. */
export function chipStack(amount, { scatter = 0.0015 } = {}) {
  const g = new THREE.Group();
  const list = breakdown(amount).reverse();
  // big chips at the bottom
  list.sort((a, b) => b - a);
  list.forEach((v, i) => {
    const m = chipMesh(v);
    m.position.set((Math.random() - 0.5) * scatter, CHIP_H / 2 + i * CHIP_H, (Math.random() - 0.5) * scatter);
    m.rotation.y = Math.random() * TAU;
    g.add(m);
  });
  g.userData.amount = amount;
  return g;
}

/** Animate an object flying in an arc to a world position. */
export function flyTo(tweens, obj, toWorld, { dur = 0.45, arc = 0.12, delay = 0, spin = 0, onDone } = {}) {
  const from = obj.position.clone();
  const to = obj.parent ? obj.parent.worldToLocal(toWorld.clone()) : toWorld.clone();
  const r0 = obj.rotation.y;
  return tweens.add(dur, (k) => {
    obj.position.lerpVectors(from, to, k);
    obj.position.y += Math.sin(k * Math.PI) * arc;
    if (spin) obj.rotation.y = r0 + spin * k;
  }, { ease: easeInOutCubic, delay, onDone });
}

// ============================================================================
//  Cards
// ============================================================================
export const SUITS = ['♠', '♥', '♦', '♣'];
export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const CARD_W = 0.063 * 1.45, CARD_H = 0.088 * 1.45;

function drawPip(g, s, x, y, size, color) { g.fillStyle = color; g.font = `${size}px "Segoe UI Symbol", "DejaVu Sans", Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(s, x, y); }
const PIP_LAYOUT = {
  1: [[0.5, 0.5]], 2: [[0.5, 0.2], [0.5, 0.8]], 3: [[0.5, 0.2], [0.5, 0.5], [0.5, 0.8]],
  4: [[0.3, 0.2], [0.7, 0.2], [0.3, 0.8], [0.7, 0.8]], 5: [[0.3, 0.2], [0.7, 0.2], [0.5, 0.5], [0.3, 0.8], [0.7, 0.8]],
  6: [[0.3, 0.2], [0.7, 0.2], [0.3, 0.5], [0.7, 0.5], [0.3, 0.8], [0.7, 0.8]],
  7: [[0.3, 0.2], [0.7, 0.2], [0.5, 0.35], [0.3, 0.5], [0.7, 0.5], [0.3, 0.8], [0.7, 0.8]],
  8: [[0.3, 0.2], [0.7, 0.2], [0.5, 0.35], [0.3, 0.5], [0.7, 0.5], [0.5, 0.65], [0.3, 0.8], [0.7, 0.8]],
  9: [[0.3, 0.18], [0.7, 0.18], [0.3, 0.39], [0.7, 0.39], [0.5, 0.5], [0.3, 0.61], [0.7, 0.61], [0.3, 0.82], [0.7, 0.82]],
  10: [[0.3, 0.18], [0.7, 0.18], [0.5, 0.29], [0.3, 0.39], [0.7, 0.39], [0.3, 0.61], [0.7, 0.61], [0.5, 0.71], [0.3, 0.82], [0.7, 0.82]],
};

export function cardTexture(rank, suit) {
  return cached(`card:${rank}${suit}`, () => {
    const W = 256, H = 358;
    const { c, g } = makeCanvas(W, H);
    const red = suit === '♥' || suit === '♦';
    const col = red ? '#c8102e' : '#141414';
    g.fillStyle = '#fbf8f1'; g.fillRect(0, 0, W, H);
    // subtle paper texture
    for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(120,100,60,${Math.random() * 0.04})`; g.fillRect(Math.random() * W, Math.random() * H, 2, 2); }
    // corner indices
    const corner = () => {
      g.fillStyle = col; g.font = 'bold 46px Georgia, "Times New Roman", serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(rank, 30, 34);
      drawPip(g, suit, 30, 76, 38, col);
    };
    corner();
    g.save(); g.translate(W, H); g.rotate(Math.PI); corner(); g.restore();
    const ri = RANKS.indexOf(rank) + 1;
    if (ri >= 2 && ri <= 10) {
      for (const [px, py] of PIP_LAYOUT[ri]) {
        const x = 60 + px * 136, y = 46 + py * 266;
        if (py > 0.5) { g.save(); g.translate(x, y); g.rotate(Math.PI); drawPip(g, suit, 0, 0, 56, col); g.restore(); }
        else drawPip(g, suit, x, y, 56, col);
      }
    } else if (ri === 1) {
      drawPip(g, suit, W / 2, H / 2, 150, col);
    } else {
      // face cards: a jelly royal with googly eyes
      g.strokeStyle = col; g.lineWidth = 3; g.strokeRect(58, 52, 140, 254);
      const hue = { J: 200, Q: 330, K: 45 }[rank];
      const grd = g.createLinearGradient(58, 52, 198, 306); grd.addColorStop(0, `hsl(${hue},70%,85%)`); grd.addColorStop(1, `hsl(${hue},60%,60%)`);
      g.fillStyle = grd; g.fillRect(60, 54, 136, 250);
      const jel = g.createRadialGradient(118, 140, 10, 128, 170, 70); jel.addColorStop(0, `hsl(${(hue + 100) % 360},90%,75%)`); jel.addColorStop(1, `hsl(${(hue + 100) % 360},70%,45%)`);
      g.fillStyle = jel; g.beginPath(); g.ellipse(128, 180, 46, 80, 0, 0, TAU); g.fill();
      for (const sx of [-1, 1]) { g.fillStyle = '#fff'; g.beginPath(); g.arc(128 + sx * 17, 148, 14, 0, TAU); g.fill(); g.fillStyle = '#111'; g.beginPath(); g.arc(128 + sx * 17 + 3, 154, 7, 0, TAU); g.fill(); }
      g.strokeStyle = '#3a0a0a'; g.lineWidth = 3; g.beginPath(); g.arc(128, 172, 12, 0.2, Math.PI - 0.2); g.stroke();
      // crown / hat
      g.fillStyle = '#ffcc33';
      if (rank === 'K') { g.beginPath(); g.moveTo(92, 112); g.lineTo(100, 84); g.lineTo(114, 104); g.lineTo(128, 78); g.lineTo(142, 104); g.lineTo(156, 84); g.lineTo(164, 112); g.closePath(); g.fill(); }
      else if (rank === 'Q') { g.beginPath(); g.ellipse(128, 106, 34, 12, 0, 0, TAU); g.fill(); for (let i = 0; i < 5; i++) { g.beginPath(); g.arc(102 + i * 13, 96, 5, 0, TAU); g.fill(); } }
      else { g.fillStyle = '#c8102e'; g.fillRect(96, 92, 64, 18); g.beginPath(); g.ellipse(128, 92, 34, 16, 0, Math.PI, TAU); g.fill(); g.fillStyle = '#ffcc33'; g.beginPath(); g.arc(150, 84, 6, 0, TAU); g.fill(); }
      g.fillStyle = col; g.font = 'bold 40px Georgia, serif'; g.textAlign = 'center'; g.fillText(rank, 128, 285);
      drawPip(g, suit, 180, 280, 26, col);
    }
    g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 2; g.strokeRect(1, 1, W - 2, H - 2);
    const t = toTex(c, { wrap: false });
    t.anisotropy = 8;
    return t;
  });
}
export function cardBackTexture(color = '#8a0f1e') {
  return cached('cardback' + color, () => {
    const W = 256, H = 358;
    const { c, g } = makeCanvas(W, H);
    g.fillStyle = '#fbf8f1'; g.fillRect(0, 0, W, H);
    g.fillStyle = color; g.fillRect(12, 12, W - 24, H - 24);
    g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 2;
    for (let i = -H; i < W + H; i += 14) { g.beginPath(); g.moveTo(i, 12); g.lineTo(i + H, H); g.stroke(); g.beginPath(); g.moveTo(i + H, 12); g.lineTo(i, H); g.stroke(); }
    g.strokeStyle = '#ffd24a'; g.lineWidth = 4; g.strokeRect(22, 22, W - 44, H - 44);
    g.fillStyle = '#ffd24a'; g.font = 'bold 44px "Arial Black", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.save(); g.translate(W / 2, H / 2); g.rotate(-0.35); g.fillText('GAMBLE!', 0, 0); g.restore();
    return toTex(c, { wrap: false });
  });
}
const cardGeos = () => cached('cardgeo', () => {
  const s = new THREE.Shape();
  const w = CARD_W, h = CARD_H, r = 0.006, x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r); s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  const face = new THREE.ShapeGeometry(s, 4);
  const uv = face.attributes.uv, p = face.attributes.position;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (p.getX(i) + w / 2) / w, (p.getY(i) + h / 2) / h);
  const back = face.clone(); back.rotateY(Math.PI);
  const backUV = back.attributes.uv; for (let i = 0; i < backUV.count; i++) backUV.setX(i, 1 - backUV.getX(i));
  face.translate(0, 0, 0.0003); back.translate(0, 0, -0.0003);
  return { face, back };
});

/** A card lying flat (face up when rotation.x = -PI/2 and flipped = false). */
export class Card {
  constructor(rank, suit, backColor) {
    this.rank = rank; this.suit = suit;
    const { face, back } = cardGeos();
    this.obj = new THREE.Group();
    this.inner = new THREE.Group();
    this.obj.add(this.inner);
    this.faceMesh = new THREE.Mesh(face, new THREE.MeshStandardMaterial({ map: cardTexture(rank, suit), roughness: 0.45 }));
    this.backMesh = new THREE.Mesh(back, new THREE.MeshStandardMaterial({ map: cardBackTexture(backColor), roughness: 0.45 }));
    this.inner.add(this.faceMesh, this.backMesh);
    this.inner.rotation.x = -Math.PI / 2; // lie flat, face up
    this.faceUp = true;
  }
  setFaceUp(v) { this.faceUp = v; this.inner.rotation.x = v ? -Math.PI / 2 : Math.PI / 2; this.inner.rotation.z = v ? 0 : Math.PI; }
  get value() { return RANKS.indexOf(this.rank) + 1; }
  dispose() { this.faceMesh.material.dispose(); this.backMesh.material.dispose(); }
}

/** Deal a card from a world point to a world point (lying on felt) with arc + optional flip. */
export function dealCard(tweens, card, parent, fromWorld, toWorld, { faceUp = true, dur = 0.42, delay = 0, rotY = 0, arc = 0.08 } = {}) {
  parent.add(card.obj);
  const from = parent.worldToLocal(fromWorld.clone()), to = parent.worldToLocal(toWorld.clone());
  card.obj.position.copy(from);
  card.setFaceUp(false);
  card.obj.visible = delay <= 0;
  const r0 = card.obj.rotation.y;
  return tweens.add(dur, (k) => {
    card.obj.visible = true;
    card.obj.position.lerpVectors(from, to, k);
    card.obj.position.y += Math.sin(k * Math.PI) * arc;
    card.obj.rotation.y = r0 + (rotY - r0) * k + Math.sin(k * Math.PI) * 0.6;
    if (faceUp) { const f = Math.min(1, Math.max(0, (k - 0.35) / 0.55)); card.inner.rotation.x = Math.PI / 2 - Math.PI * f; card.inner.rotation.z = Math.PI * (1 - f); }
  }, { ease: easeOutCubic, delay, onDone: () => { card.setFaceUp(faceUp); } });
}
export function flipCard(tweens, card, dur = 0.35) {
  audio.play('cardFlip');
  const base = card.obj.position.y;
  return tweens.add(dur, (k) => {
    card.inner.rotation.x = Math.PI / 2 - Math.PI * k; card.inner.rotation.z = Math.PI * (1 - k);
    card.obj.position.y = base + Math.sin(k * Math.PI) * 0.04;
  }, { ease: easeInOutCubic, onDone: () => { card.setFaceUp(true); card.obj.position.y = base; } });
}

export class Shoe {
  constructor(decks = 6) { this.decks = decks; this.reshuffle(); }
  reshuffle() {
    this.cards = [];
    for (let d = 0; d < this.decks; d++) for (const s of SUITS) for (const r of RANKS) this.cards.push([r, s]);
    shuffle(this.cards);
    this.cut = Math.floor(this.cards.length * (0.22 + rand() * 0.08));
    this.count = 0; // hi-lo running count
    this.needsShuffle = false;
  }
  draw() {
    if (this.cards.length <= 1) this.reshuffle();
    const c = this.cards.pop();
    const v = RANKS.indexOf(c[0]) + 1;
    if (v >= 2 && v <= 6) this.count++; else if (v === 1 || v >= 10) this.count--;
    if (this.cards.length < this.cut) this.needsShuffle = true;
    return c;
  }
  get trueCount() { return this.count / Math.max(0.5, this.cards.length / 52); }
}

export function bjValue(cards) {
  let total = 0, aces = 0;
  for (const c of cards) { const v = Math.min(10, RANKS.indexOf(c.rank ?? c[0]) + 1); if (v === 1) aces++; total += v === 1 ? 11 : v; }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return { total, soft: aces > 0 };
}

/** Jacks-or-better evaluation for 5 cards [[rank,suit],...]. */
export function pokerRank(cards) {
  const vals = cards.map((c) => { const i = RANKS.indexOf(c[0]); return i === 0 ? 14 : i + 1; }).sort((a, b) => a - b);
  const suits = cards.map((c) => c[1]);
  const flush = suits.every((s) => s === suits[0]);
  const uniq = [...new Set(vals)];
  let straight = uniq.length === 5 && (vals[4] - vals[0] === 4 || vals.join() === '2,3,4,5,14');
  const counts = {}; vals.forEach((v) => (counts[v] = (counts[v] || 0) + 1));
  const groups = Object.entries(counts).map(([v, n]) => [n, +v]).sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  if (straight && flush && vals[0] === 10) return 'royal';
  if (straight && flush) return 'sflush';
  if (groups[0][0] === 4) return 'quads';
  if (groups[0][0] === 3 && groups[1][0] === 2) return 'full';
  if (flush) return 'flush';
  if (straight) return 'straight';
  if (groups[0][0] === 3) return 'trips';
  if (groups[0][0] === 2 && groups[1][0] === 2) return 'twopair';
  if (groups[0][0] === 2 && groups[0][1] >= 11) return 'jacks';
  return 'nothing';
}

// ============================================================================
//  Canvas "screen" helper for LED / video displays on machines.
// ============================================================================
export class Screen {
  constructor(w = 512, h = 256, intensity = 1.5) {
    const { c, g } = makeCanvas(w, h);
    this.canvas = c; this.g = g; this.w = w; this.h = h;
    this.tex = toTex(c, { wrap: false });
    this.tex.userData.shared = false;
    this.mat = new THREE.MeshBasicMaterial({ map: this.tex, color: new THREE.Color(intensity, intensity, intensity) });
  }
  commit() { this.tex.needsUpdate = true; }
  dispose() { this.tex.dispose(); this.mat.dispose(); }
}

/** Dealer button / puck / marker helpers */
export function puck(on = true) {
  const g = new THREE.Group();
  mesh(G.cyl(0.04, 0.04, 0.014, 24), on ? M.plastic(0xf4f4f4) : M.plastic(0x111111), 0, 0.007, 0, { parent: g });
  const { c, g: x } = makeCanvas(128, 128);
  x.fillStyle = on ? '#f4f4f4' : '#111'; x.fillRect(0, 0, 128, 128);
  x.fillStyle = on ? '#111' : '#f4f4f4'; x.font = 'bold 48px "Arial Black", sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(on ? 'ON' : 'OFF', 64, 66);
  mesh(G.circle(0.039, 24), new THREE.MeshStandardMaterial({ map: toTex(c, { wrap: false }), roughness: 0.4 }), 0, 0.0145, 0, { rx: -Math.PI / 2, parent: g });
  return g;
}

export { CARD_W, CARD_H, CHIP_R, CHIP_H };
