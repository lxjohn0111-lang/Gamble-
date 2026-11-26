import * as THREE from 'three';
import { Station, Screen } from './common.js';
import { G, mesh, roundedRectShape } from '../engine/geo.js';
import { M } from '../engine/materials.js';
import { makeCanvas, toTex, cached } from '../engine/textures.js';
import { TAU, rand, fmtMoney, clamp, easeOutCubic, easeInOutCubic } from '../engine/util.js';
import { audio } from '../engine/audio.js';
import { CLASSIC, VIDEO, SYM, LINES, evalClassic, evalVideo, spinReel, window3 } from './slotmath.js';
import { barStool } from '../world/props.js';

// ============================================================================
//  SLOT MACHINES: classic 3-reel with a pull lever, and 5-reel video slots
//  with 9 paylines, free spins, scatters, a double-up gamble and progressive.
// ============================================================================

const THEMES = {
  western: { classic: ['GOLD RUSH 7s', '#8a1a0a', '#ffcc33'], video: ['WILD WEST WOBBLE', '#3a1a0a', '#ff9a2a'] },
  tiki: { classic: ['TIKI SEVENS', '#0a5a4a', '#ffd24a'], video: ['TIKI TREASURE', '#1a3a5a', '#ff7a3a'] },
  palace: { classic: ['ROYAL SEVENS', '#5a0a1a', '#ffd24a'], video: ['CROWN JEWELS', '#2a0a3a', '#ff4fa0'] },
  neon: { classic: ['COSMIC 7s', '#1a0a3a', '#2bf0ff'], video: ['NEBULA CASH', '#0a0a2a', '#ff2bd6'] },
  monaco: { classic: ['RIVIERA 7s', '#0b2a22', '#f6e3a0'], video: ['FORTUNA DELUXE', '#14203a', '#ffd24a'] },
};

// ---------------------------------------------------------------- symbol atlas
function drawSymbol(g, id, x, y, s, video) {
  g.save(); g.translate(x + s / 2, y + s / 2);
  const k = s / 256;
  g.scale(k, k);
  const gold = (y0, y1) => { const gr = g.createLinearGradient(0, y0, 0, y1); gr.addColorStop(0, '#fff6b0'); gr.addColorStop(0.45, '#ffc93a'); gr.addColorStop(1, '#a8640a'); return gr; };
  g.lineJoin = 'round';
  switch (id) {
    case SYM.WILD: {
      const gr = g.createRadialGradient(-20, -30, 10, 0, 0, 110); gr.addColorStop(0, '#b8ff8a'); gr.addColorStop(1, '#1f9a3a');
      g.fillStyle = gr; g.beginPath(); g.ellipse(0, 6, 78, 96, 0, 0, TAU); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.35)'; g.beginPath(); g.ellipse(-30, -40, 18, 30, -0.4, 0, TAU); g.fill();
      for (const sx of [-1, 1]) { g.fillStyle = '#fff'; g.beginPath(); g.arc(sx * 30, -22, 26, 0, TAU); g.fill(); g.strokeStyle = '#222'; g.lineWidth = 3; g.stroke(); g.fillStyle = '#111'; g.beginPath(); g.arc(sx * 30 + sx * 6, -12, 12, 0, TAU); g.fill(); }
      g.fillStyle = '#4a0a14'; g.beginPath(); g.arc(0, 22, 24, 0, Math.PI); g.fill();
      g.fillStyle = '#ff3a6a'; g.fillRect(-92, 52, 184, 46); g.strokeStyle = '#fff'; g.lineWidth = 5; g.strokeRect(-92, 52, 184, 46);
      g.fillStyle = '#fff'; g.font = 'bold 44px "Arial Black", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('WILD', 0, 77);
      break;
    }
    case SYM.SCATTER: {
      g.fillStyle = gold(-100, 100);
      g.beginPath(); for (let i = 0; i < 10; i++) { const r = i % 2 ? 46 : 104, a = -Math.PI / 2 + (i * Math.PI) / 5; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); } g.closePath(); g.fill();
      g.strokeStyle = '#7a4a00'; g.lineWidth = 6; g.stroke();
      g.fillStyle = '#c8102e'; g.font = 'bold 40px "Arial Black", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.strokeStyle = '#fff'; g.lineWidth = 8; g.strokeText('BONUS', 0, 6); g.fillText('BONUS', 0, 6);
      break;
    }
    case SYM.SEVEN: {
      g.font = 'bold 210px "Arial Black", Impact, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = '#000'; g.globalAlpha = 0.35; g.fillText('7', 8, 16); g.globalAlpha = 1;
      g.lineWidth = 18; g.strokeStyle = gold(-90, 90); g.strokeText('7', 0, 8);
      const rg = g.createLinearGradient(0, -90, 0, 90); rg.addColorStop(0, '#ff5a5a'); rg.addColorStop(1, '#a8001a');
      g.fillStyle = rg; g.fillText('7', 0, 8);
      break;
    }
    case SYM.DIAMOND: {
      const pts = [[-90, -30], [-50, -80], [50, -80], [90, -30], [0, 95]];
      g.fillStyle = '#5ad8ff'; g.beginPath(); pts.forEach(([a, b]) => g.lineTo(a, b)); g.closePath(); g.fill();
      g.fillStyle = '#b8f2ff'; g.beginPath(); g.moveTo(-50, -80); g.lineTo(-20, -30); g.lineTo(20, -30); g.lineTo(50, -80); g.closePath(); g.fill();
      g.fillStyle = '#2a9ad8'; g.beginPath(); g.moveTo(-90, -30); g.lineTo(0, 95); g.lineTo(-20, -30); g.closePath(); g.fill();
      g.fillStyle = '#8ae6ff'; g.beginPath(); g.moveTo(90, -30); g.lineTo(0, 95); g.lineTo(20, -30); g.closePath(); g.fill();
      g.strokeStyle = '#0a4a7a'; g.lineWidth = 5; g.beginPath(); pts.forEach(([a, b]) => g.lineTo(a, b)); g.closePath(); g.stroke();
      g.fillStyle = '#fff'; g.beginPath(); g.arc(-40, -55, 9, 0, TAU); g.fill();
      break;
    }
    case SYM.BAR3: case SYM.BAR2: case SYM.BAR: {
      const n = id === SYM.BAR3 ? 3 : id === SYM.BAR2 ? 2 : 1;
      const hh = 56, gap = 10, tot = n * hh + (n - 1) * gap;
      for (let i = 0; i < n; i++) {
        const yy = -tot / 2 + i * (hh + gap);
        g.fillStyle = '#111'; g.beginPath(); g.roundRect(-100, yy, 200, hh, 14); g.fill();
        g.strokeStyle = id === SYM.BAR3 ? '#ffcc33' : id === SYM.BAR2 ? '#ff5a5a' : '#5ad8ff'; g.lineWidth = 6; g.stroke();
        g.fillStyle = '#fff'; g.font = 'bold 44px "Arial Black", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('BAR', 0, yy + hh / 2 + 2);
      }
      break;
    }
    case SYM.BELL: {
      g.fillStyle = gold(-90, 80);
      g.beginPath(); g.moveTo(-80, 60); g.quadraticCurveTo(-70, -10, -50, -50); g.quadraticCurveTo(0, -110, 50, -50); g.quadraticCurveTo(70, -10, 80, 60); g.closePath(); g.fill();
      g.strokeStyle = '#7a4a00'; g.lineWidth = 6; g.stroke();
      g.fillStyle = '#a86a0a'; g.fillRect(-90, 55, 180, 18);
      g.fillStyle = '#7a4a00'; g.beginPath(); g.arc(0, 82, 16, 0, TAU); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.6)'; g.beginPath(); g.ellipse(-30, -20, 10, 36, 0.3, 0, TAU); g.fill();
      break;
    }
    case SYM.CHERRY: {
      g.strokeStyle = '#3a6a1a'; g.lineWidth = 9; g.lineCap = 'round';
      g.beginPath(); g.moveTo(-45, 30); g.quadraticCurveTo(-20, -60, 30, -85); g.stroke();
      g.beginPath(); g.moveTo(45, 40); g.quadraticCurveTo(40, -40, 30, -85); g.stroke();
      g.fillStyle = '#3aa83a'; g.beginPath(); g.ellipse(55, -85, 40, 18, -0.4, 0, TAU); g.fill();
      for (const [cx, cy] of [[-48, 50], [48, 58]]) {
        const rg = g.createRadialGradient(cx - 14, cy - 14, 4, cx, cy, 46); rg.addColorStop(0, '#ff8a8a'); rg.addColorStop(1, '#8a0010');
        g.fillStyle = rg; g.beginPath(); g.arc(cx, cy, 44, 0, TAU); g.fill();
        g.fillStyle = 'rgba(255,255,255,0.7)'; g.beginPath(); g.ellipse(cx - 16, cy - 16, 8, 13, -0.6, 0, TAU); g.fill();
      }
      break;
    }
    case SYM.LEMON: {
      const rg = g.createRadialGradient(-20, -20, 10, 0, 0, 100); rg.addColorStop(0, '#fff7a0'); rg.addColorStop(1, '#e8b800');
      g.fillStyle = rg; g.beginPath(); g.ellipse(0, 0, 100, 70, -0.25, 0, TAU); g.fill();
      g.beginPath(); g.ellipse(-95, 22, 18, 12, -0.25, 0, TAU); g.fill(); g.beginPath(); g.ellipse(95, -22, 18, 12, -0.25, 0, TAU); g.fill();
      g.fillStyle = 'rgba(160,110,0,0.35)'; for (let i = 0; i < 40; i++) { g.beginPath(); g.arc((Math.random() - 0.5) * 150, (Math.random() - 0.5) * 90, 2, 0, TAU); g.fill(); }
      break;
    }
    case SYM.MELON: {
      g.fillStyle = '#2a8a3a'; g.beginPath(); g.arc(0, -10, 105, 0.1, Math.PI - 0.1); g.closePath(); g.fill();
      g.fillStyle = '#e8ffd0'; g.beginPath(); g.arc(0, -10, 90, 0.1, Math.PI - 0.1); g.closePath(); g.fill();
      g.fillStyle = '#ff3a5a'; g.beginPath(); g.arc(0, -10, 80, 0.1, Math.PI - 0.1); g.closePath(); g.fill();
      g.fillStyle = '#1a1a1a'; for (const [sx, sy] of [[-40, 15], [0, 30], [40, 15], [-20, 45], [20, 45]]) { g.beginPath(); g.ellipse(sx, sy, 6, 10, 0, 0, TAU); g.fill(); }
      break;
    }
    case SYM.SHOE: {
      g.strokeStyle = gold(-90, 90); g.lineWidth = 40; g.lineCap = 'round';
      g.beginPath(); g.arc(0, -5, 70, Math.PI * 0.85, Math.PI * 2.15, true); g.stroke();
      g.lineWidth = 6; g.strokeStyle = '#7a4a00'; g.beginPath(); g.arc(0, -5, 90, Math.PI * 0.85, Math.PI * 2.15, true); g.stroke();
      g.fillStyle = '#7a4a00'; for (let i = 0; i < 6; i++) { const a = Math.PI * 0.95 + (i / 5) * Math.PI * 1.1; g.beginPath(); g.arc(Math.cos(a) * 70, -5 - Math.sin(a) * 70, 7, 0, TAU); g.fill(); }
      break;
    }
    default: break;
  }
  g.restore();
}

function atlas(video) {
  return cached('slotatlas' + video, () => {
    const S = 1024, c = 256;
    const { c: cv, g } = makeCanvas(S);
    for (let id = 0; id < 16; id++) {
      const x = (id % 4) * c, y = Math.floor(id / 4) * c;
      if (video) {
        const bg = g.createRadialGradient(x + c / 2, y + c / 2, 10, x + c / 2, y + c / 2, c * 0.7); bg.addColorStop(0, '#3a1a5a'); bg.addColorStop(1, '#0a0418');
        g.fillStyle = bg; g.fillRect(x, y, c, c);
      } else {
        const bg = g.createLinearGradient(x, y, x, y + c); bg.addColorStop(0, '#fbf6ea'); bg.addColorStop(0.5, '#ffffff'); bg.addColorStop(1, '#efe6d2');
        g.fillStyle = bg; g.fillRect(x, y, c, c);
      }
      drawSymbol(g, id, x + 22, y + 22, c - 44, video);
    }
    const sharp = toTex(cv, { wrap: false });
    sharp.anisotropy = 8;
    // motion-blurred copy for fast spinning
    const { c: bc, g: bg } = makeCanvas(S);
    bg.globalAlpha = 1 / 9;
    for (let i = -4; i <= 4; i++) bg.drawImage(cv, 0, i * 14);
    bg.globalAlpha = 1;
    const blur = toTex(bc, { wrap: false });
    return { sharp, blur };
  });
}

function topperTexture(title, bg, fg) {
  return cached('topper' + title, () => {
    const { c, g } = makeCanvas(512, 256);
    const gr = g.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, bg); gr.addColorStop(1, '#000');
    g.fillStyle = gr; g.fillRect(0, 0, 512, 256);
    for (let i = 0; i < 24; i++) { g.strokeStyle = `rgba(255,255,255,${0.05 + (i % 2) * 0.04})`; g.lineWidth = 10; g.beginPath(); g.moveTo(256, 300); g.lineTo(256 + Math.cos(-Math.PI * i / 23) * 600, 300 + Math.sin(-Math.PI * i / 23) * 600); g.stroke(); }
    g.font = 'bold 64px "Arial Black", Impact, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const words = title.split(' ');
    const lines = words.length > 2 ? [words.slice(0, Math.ceil(words.length / 2)).join(' '), words.slice(Math.ceil(words.length / 2)).join(' ')] : [title];
    lines.forEach((l, i) => {
      const y = 128 + (i - (lines.length - 1) / 2) * 76;
      g.lineWidth = 14; g.strokeStyle = '#000'; g.strokeText(l, 256, y);
      const fg2 = g.createLinearGradient(0, y - 30, 0, y + 30); fg2.addColorStop(0, '#fff'); fg2.addColorStop(0.5, fg); fg2.addColorStop(1, '#a86a0a');
      g.fillStyle = fg2; g.fillText(l, 256, y);
    });
    return toTex(c, { wrap: false });
  });
}

function bellyTexture(video, fg) {
  return cached('belly' + video + fg, () => {
    const { c, g } = makeCanvas(512, 256);
    g.fillStyle = '#120812'; g.fillRect(0, 0, 512, 256);
    g.font = 'bold 30px "Arial Black", sans-serif'; g.textAlign = 'center'; g.fillStyle = fg;
    if (video) {
      g.fillText('5 × WILD = PROGRESSIVE', 256, 50);
      g.font = 'bold 24px sans-serif'; g.fillStyle = '#fff';
      g.fillText('3+ BONUS STARS = FREE SPINS ×2', 256, 100);
      g.fillText('9 LINES · WILD SUBSTITUTES', 256, 140);
      g.fillStyle = fg; g.fillText('DOUBLE-UP AFTER ANY WIN', 256, 190);
    } else {
      const rows = [['JELLY JELLY JELLY', 'JACKPOT'], ['7 7 7', '140×'], ['BAR3 ×3', '70×'], ['BAR2 ×3', '35×'], ['BELL ×3', '30×'], ['ANY CHERRY', '2×'], ['WILD = ×2 EACH', '']];
      g.font = 'bold 22px sans-serif';
      rows.forEach(([a, b], i) => { g.textAlign = 'left'; g.fillStyle = '#fff'; g.fillText(a, 60, 36 + i * 32); g.textAlign = 'right'; g.fillStyle = fg; g.fillText(b, 452, 36 + i * 32); });
    }
    return toTex(c, { wrap: false });
  });
}

let _slotGlass = null;
function slotGlass() {
  if (!_slotGlass) { _slotGlass = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.08, transparent: true, opacity: 0.08, envMapIntensity: 0.5, specularIntensity: 0.25, depthWrite: false }); _slotGlass.userData.shared = true; }
  return _slotGlass;
}

// ---------------------------------------------------------------- drum reel
const FACES = 12, SUB = 3;
class Reel {
  constructor(strip, width, radius, mat) {
    this.strip = strip; this.N = strip.length; this.w = width; this.r = radius;
    const verts = FACES * (SUB + 1) * 2;
    const pos = new Float32Array(verts * 3), nor = new Float32Array(verts * 3), uv = new Float32Array(verts * 2);
    const idx = [];
    const step = TAU / FACES;
    for (let f = 0; f < FACES; f++) {
      for (let s = 0; s <= SUB; s++) {
        const a = f * step - step / 2 + (s / SUB) * step;
        for (let e = 0; e < 2; e++) {
          const i = (f * (SUB + 1) + s) * 2 + e;
          pos[i * 3] = (e - 0.5) * width; pos[i * 3 + 1] = Math.sin(a) * radius; pos[i * 3 + 2] = Math.cos(a) * radius;
          nor[i * 3] = 0; nor[i * 3 + 1] = Math.sin(a); nor[i * 3 + 2] = Math.cos(a);
        }
      }
      for (let s = 0; s < SUB; s++) {
        const a = (f * (SUB + 1) + s) * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const g = (this.geo = new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    this.uv = new THREE.BufferAttribute(uv, 2).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('uv', this.uv);
    g.setIndex(idx);
    this.mesh = new THREE.Mesh(g, mat);
    this.p = Math.floor(rand() * this.N);
    this.P = -1;
    this.v = 0;
    this.anim = null;
    this.spinning = false;
    this.apply();
  }
  mapFaces() {
    const P = Math.floor(this.p);
    if (P === this.P) return;
    this.P = P;
    const U = this.uv.array;
    for (let f = 0; f < FACES; f++) {
      const off = f <= FACES / 2 ? f : f - FACES;
      const sym = this.strip[(((P + off) % this.N) + this.N) % this.N];
      const col = sym % 4, row = Math.floor(sym / 4);
      const u0 = col / 4 + 0.004, u1 = (col + 1) / 4 - 0.004;
      const v0 = 1 - (row + 1) / 4, v1 = 1 - row / 4;
      for (let s = 0; s <= SUB; s++) {
        const v = v0 + (v1 - v0) * (s / SUB);
        const i = (f * (SUB + 1) + s) * 2;
        U[i * 2] = u0; U[i * 2 + 1] = v; U[i * 2 + 2] = u1; U[i * 2 + 3] = v;
      }
    }
    this.uv.needsUpdate = true;
  }
  apply() {
    this.mapFaces();
    const f = this.p - Math.floor(this.p);
    this.mesh.rotation.x = f * (TAU / FACES);
  }
  start(delay = 0) { this.spinning = true; this.anim = { kind: 'start', t: -delay, base: this.p }; }
  stopAt(stop, extra = 4) {
    let target = Math.ceil(this.p) + extra;
    target += (((stop - target) % this.N) + this.N) % this.N;
    this.anim = { kind: 'stop', t: 0, from: this.p, to: target, dur: 0.38 + extra * 0.02 };
  }
  update(dt) {
    const a = this.anim;
    if (a) {
      a.t += dt;
      if (a.kind === 'start') {
        if (a.t < 0) { /* waiting */ }
        else if (a.t < 0.14) this.p = a.base - Math.sin((a.t / 0.14) * Math.PI) * 0.25;
        else { this.v = Math.min(22, this.v + dt * 90); this.p += this.v * dt; }
      } else if (a.kind === 'stop') {
        const k = Math.min(1, a.t / a.dur);
        if (k < 0.82) { const kk = k / 0.82; this.p = a.from + (a.to + 0.14 - a.from) * easeOutCubic(kk); }
        else { const kk = (k - 0.82) / 0.18; this.p = a.to + 0.14 * (1 - easeInOutCubic(kk)); }
        if (k >= 1) { this.p = a.to; this.anim = null; this.spinning = false; this.v = 0; this.onStop && this.onStop(); }
      }
    }
    this.apply();
  }
  get fast() { return this.anim && this.anim.kind === 'start' && this.v > 12; }
  get stop() { return ((Math.round(this.p) % this.N) + this.N) % this.N; }
}

// ---------------------------------------------------------------- the machine
export class SlotMachine extends Station {
  constructor(ctx, def) {
    super(ctx, def);
    this.video = def.variant === 'video';
    this.math = this.video ? VIDEO : CLASSIC;
    const themeName = ctx.state.casino.theme;
    const th = THEMES[themeName][this.video ? 'video' : 'classic'];
    this.title = th[0]; this.color = th[1]; this.accent = th[2];
    this.label = `Play ${this.title}`;
    const dayK = 1 + (ctx.state.day - 1) * 0.5;
    this.limits = this.video ? [5, Math.round(250 * dayK * ctx.state.limitMult())] : [1, Math.round(100 * dayK * ctx.state.limitMult())];
    this.footprint = { w: 0.74, d: 0.66, ox: 0, oz: -0.02 };
    this.interactLocal = new THREE.Vector3(0, 0, 1.05);
    this.interactR = 1.15;
    this.camLocal = { pos: new THREE.Vector3(0, 1.44, 0.86), look: new THREE.Vector3(0, 1.2, 0) };
    this.bet = this.limits[0] * (this.video ? 2 : 5);
    this.freeSpins = 0;
    this.win = 0;
    this.auto = 0;
    this.phase = 'idle';
  }

  build() {
    const g = this.group;
    const S = (this.static = new THREE.Group());
    S.position.copy(g.position); S.rotation.copy(g.rotation);
    this.ctx.director.world.staticRoot.add(S);
    const body = M.lacquer(new THREE.Color(this.color).getHex());
    const dark = M.lacquer(0x0c0a0e);
    const chrome = M.chrome();
    // pedestal + kick plate
    mesh(G.rbox(0.72, 0.74, 0.62, 0.03), dark, 0, 0.37, 0, { parent: S, cast: true });
    mesh(G.box(0.7, 0.08, 0.02), chrome, 0, 0.06, 0.31, { parent: S });
    // coin tray
    mesh(G.rbox(0.46, 0.09, 0.14, 0.02), chrome, 0, 0.62, 0.32, { parent: S });
    mesh(G.box(0.42, 0.05, 0.11), M.blackMetal(), 0, 0.65, 0.33, { parent: S });
    // main cabinet: built as a frame around a recessed reel window
    const winW = this.video ? 0.56 : 0.5, winH = 0.34, winY = 1.38;
    this.winY = winY;
    const yLow = winY - winH / 2 - 0.05, yHigh = winY + winH / 2 + 0.17;
    mesh(G.rbox(0.7, yLow - 0.72, 0.54, 0.03), body, 0, (0.72 + yLow) / 2, -0.03, { parent: S, cast: true });
    mesh(G.rbox(0.7, 1.86 - yHigh, 0.54, 0.03), body, 0, (yHigh + 1.86) / 2, -0.03, { parent: S, cast: true });
    const sideW = (0.7 - winW) / 2;
    for (const sx of [-1, 1]) mesh(G.rbox(sideW, yHigh - yLow + 0.02, 0.54, 0.015), body, sx * (winW / 2 + sideW / 2), (yLow + yHigh) / 2, -0.03, { parent: S, cast: true });
    mesh(G.box(winW, yHigh - yLow, 0.02), M.matte(0x050505, 1), 0, (yLow + yHigh) / 2, -0.27, { parent: S });
    for (const s2 of [-1, 1]) mesh(G.rbox(0.05, 1.14, 0.56, 0.02), chrome, s2 * 0.36, 1.29, -0.03, { parent: S });
    // belly glass with paytable
    const bellyMat = new THREE.MeshBasicMaterial({ map: bellyTexture(this.video, this.accent), color: new THREE.Color(1.4, 1.4, 1.4) });
    bellyMat.userData.shared = false;
    mesh(G.rbox(0.6, 0.27, 0.03, 0.01), chrome, 0, 0.88, 0.25, { parent: S });
    mesh(G.plane(0.56, 0.24), bellyMat, 0, 0.88, 0.268, { parent: S });
    // button deck (angled shelf)
    mesh(G.rbox(0.66, 0.06, 0.22, 0.02), dark, 0, 1.06, 0.3, { rx: -0.25, parent: S });
    // reel window bezel
    mesh(G.box(winW + 0.06, 0.035, 0.05), chrome, 0, winY + winH / 2 + 0.017, 0.25, { parent: S });
    mesh(G.box(winW + 0.06, 0.035, 0.05), chrome, 0, winY - winH / 2 - 0.017, 0.25, { parent: S });
    for (const s of [-1, 1]) mesh(G.box(0.035, winH + 0.07, 0.05), chrome, s * (winW / 2 + 0.017), winY, 0.25, { parent: S });
    // topper
    const topperShape = new THREE.Shape();
    topperShape.moveTo(-0.35, 0); topperShape.lineTo(-0.35, 0.2); topperShape.quadraticCurveTo(0, 0.42, 0.35, 0.2); topperShape.lineTo(0.35, 0); topperShape.closePath();
    const tg = G.extrude('slotTopper', topperShape, { depth: 0.4, bevelEnabled: true, bevelSize: 0.015, bevelThickness: 0.015, bevelSegments: 3, curveSegments: 16 });
    mesh(tg, body, 0, 1.84, -0.24, { parent: S, cast: true });
    const topMat = new THREE.MeshBasicMaterial({ map: topperTexture(this.title, this.color, this.accent), color: new THREE.Color(1.6, 1.6, 1.6) });
    mesh(G.plane(0.62, 0.3), topMat, 0, 2.0, 0.19, { parent: S });
    mesh(G.torus(0.33, 0.012, 6, 32, Math.PI), chrome, 0, 1.86, 0.19, { parent: S });
    // speaker grills
    for (const s of [-1, 1]) for (let i = 0; i < 5; i++) mesh(G.box(0.06, 0.006, 0.01), M.blackMetal(), s * 0.24, 1.62 + i * 0.022, 0.24, { parent: S });
    // stool
    const stool = barStool('chrome', new THREE.Color(this.color).getHex());
    stool.position.set(0, 0, 0.62); S.add(stool);

    // ---- dynamic parts
    const at = atlas(this.video);
    this.reelMat = new THREE.MeshStandardMaterial({ map: at.sharp, roughness: 0.75, emissive: 0xffffff, emissiveMap: at.sharp, emissiveIntensity: this.video ? 0.75 : 0.1 });
    this.reelMatBlur = new THREE.MeshStandardMaterial({ map: at.blur, roughness: 0.75, emissive: 0xffffff, emissiveMap: at.blur, emissiveIntensity: this.video ? 0.75 : 0.1 });
    const n = this.video ? 5 : 3;
    const rw = this.video ? 0.1 : 0.145, gap = this.video ? 0.008 : 0.02;
    this.reels = [];
    const R = 0.19;
    for (let i = 0; i < n; i++) {
      const r = new Reel(this.math.reels[i], rw, R, this.reelMat);
      r.mesh.position.set((i - (n - 1) / 2) * (rw + gap), winY, 0.21 - R);
      r.mesh.castShadow = false;
      g.add(r.mesh);
      this.reels.push(r);
    }
    // payline marker(s)
    this.lineMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.3, 0.3), transparent: true, opacity: 0.0, depthWrite: false });
    this.lineMesh = mesh(G.box(winW - 0.02, 0.006, 0.002), this.lineMat, 0, winY, 0.222, { parent: g });
    this.lineMesh.renderOrder = 3;
    this.videoLines = this.video ? this.makeVideoLines(rw, gap) : null;
    // glass
    const glass = mesh(G.plane(winW, winH), slotGlass(), 0, winY, 0.235, { parent: g });
    glass.renderOrder = 4;
    // LED display
    this.screen = new Screen(512, 96, 1.6);
    mesh(G.plane(winW, 0.09), this.screen.mat, 0, winY + winH / 2 + 0.09, 0.258, { parent: g });
    mesh(G.box(winW + 0.04, 0.11, 0.02), M.blackMetal(), 0, winY + winH / 2 + 0.09, 0.246, { parent: g });
    // buttons
    this.btnMats = [];
    this.buttons = [];
    const btnDefs = this.video ? [['BET', 0xff3a3a], ['LINES', 0xffd24a], ['AUTO', 0x3a8aff], ['MAX', 0xff7a1a], ['SPIN', 0x2aff6a]] : [['BET', 0xff3a3a], ['MAX', 0xff7a1a], ['CASH', 0x3a8aff], ['SPIN', 0x2aff6a]];
    btnDefs.forEach(([name, col], i) => {
      const big = name === 'SPIN';
      const m = new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.6, roughness: 0.3 });
      const b = new THREE.Group();
      mesh(G.cyl(big ? 0.035 : 0.026, big ? 0.035 : 0.026, 0.012, 20), chrome, 0, 0, 0, { parent: b });
      const cap = mesh(G.cyl(big ? 0.03 : 0.021, big ? 0.03 : 0.021, 0.016, 20), m, 0, 0.008, 0, { parent: b });
      b.position.set(-0.24 + i * (0.48 / (btnDefs.length - 1)), 1.1, 0.33);
      b.rotation.x = -0.25;
      g.add(b);
      this.btnMats.push(m); this.buttons.push({ name, g: b, cap, m, base: 0.6 });
    });
    // classic lever
    if (!this.video) {
      const lever = (this.lever = new THREE.Group());
      lever.position.set(0.4, 1.3, 0.0);
      mesh(G.cyl(0.04, 0.04, 0.05, 16), chrome, 0, 0, 0, { rz: Math.PI / 2, parent: lever });
      mesh(G.cyl(0.012, 0.014, 0.42, 10), chrome, 0.03, 0.21, 0, { parent: lever });
      mesh(G.sphere(0.042, 18, 14), M.plastic(0xd81020, 0.25), 0.03, 0.44, 0, { parent: lever });
      g.add(lever);
      this.lever.rotation.x = -0.1;
    }
    // candle light on top
    this.candleMat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: new THREE.Color(this.accent), emissiveIntensity: 0.6, roughness: 0.3, transparent: true, opacity: 0.9 });
    mesh(G.cyl(0.045, 0.045, 0.16, 16), this.candleMat, 0, 2.3, -0.05, { parent: g });
    mesh(G.cyl(0.05, 0.05, 0.02, 16), chrome, 0, 2.21, -0.05, { parent: g });
    mesh(G.sphere(0.03, 10, 8), chrome, 0, 2.39, -0.05, { parent: g });
    // side chaser lights
    this.chaser = [];
    for (const s of [-1, 1]) for (let i = 0; i < 8; i++) {
      const b = mesh(G.sphere(0.012, 8, 6), M.bulb(0x553311, 0.3), s * 0.385, 0.8 + i * 0.13, 0.22, { parent: g });
      this.chaser.push(b);
    }
    this.bulbOn = M.bulb(0xffe08a, 2.2); this.bulbOff = M.bulb(0x553311, 0.25);
    this.coinsInTray = [];
    // seat for NPC patrons
    this.registerSeat(new THREE.Vector3(0, 0, 0.62), 0, { seat: 0.78, standOff: 0.55 });
    this.drawScreen();
  }

  makeVideoLines(rw, gap) {
    const cols = [0xff3a3a, 0x3aff6a, 0x3a8aff, 0xffd24a, 0xff3af0, 0x3affff, 0xff8a1a, 0xb04aff, 0xffffff];
    const rowY = [0.105, 0, -0.105];
    return LINES.map((L, i) => {
      const pts = L.map((r, k) => new THREE.Vector3((k - 2) * (rw + gap), this.winY + rowY[r], 0.223));
      pts.unshift(pts[0].clone().add(new THREE.Vector3(-0.04, 0, 0)));
      pts.push(pts[pts.length - 1].clone().add(new THREE.Vector3(0.04, 0, 0)));
      const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.05);
      const m = new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.004, 4), new THREE.MeshBasicMaterial({ color: new THREE.Color(cols[i]).multiplyScalar(2.5), transparent: true, opacity: 0.95, depthWrite: false }));
      m.visible = false; m.renderOrder = 3;
      this.group.add(m);
      return m;
    });
  }

  drawScreen(extra) {
    const { g, w, h } = this.screen;
    g.fillStyle = '#060104'; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,40,30,0.06)'; for (let x = 2; x < w; x += 6) for (let y = 2; y < h; y += 6) g.fillRect(x, y, 3, 3);
    g.font = 'bold 15px "Courier New", monospace'; g.fillStyle = '#ff9a6a'; g.textAlign = 'center';
    const cols = [['CREDIT', fmtMoney(this.state.money)], ['BET', fmtMoney(this.bet)], [this.freeSpins ? 'FREE' : 'WIN', this.freeSpins ? String(this.freeSpins) : fmtMoney(this.shownWin || 0)]];
    cols.forEach(([a, b], i) => {
      const x = (i + 0.5) * (w / 3);
      g.fillStyle = '#ff9a6a'; g.fillText(a, x, 22);
      g.font = 'bold 36px "Courier New", monospace'; g.fillStyle = i === 2 && (this.shownWin > 0 || this.freeSpins) ? '#7dff9a' : '#ff3a2a';
      g.shadowColor = g.fillStyle; g.shadowBlur = 10;
      g.fillText(b, x, 68);
      g.shadowBlur = 0; g.font = 'bold 15px "Courier New", monospace';
    });
    if (extra) extra(g, w, h);
    this.screen.commit();
  }

  promptText() { return [this.label, `${this.video ? '5 reels · 9 lines' : '3 reels · pull the lever'} · ${fmtMoney(this.limits[0])}–${fmtMoney(this.limits[1])}`]; }
  occupiedByNpc() { return this.npcSeats[0].taken; }

  // ---------------------------------------------------------------- UI
  enter() {
    super.enter();
    const ui = this.ui;
    const p = (this.panel = ui.openPanel({ title: this.title, limits: this.video ? '9 lines · Free spins · Double-up' : 'Classic 3-reel · Wilds double wins', onLeave: () => this.ctx.director.leaveStation() }));
    const body = p.body;
    this.betCtl = ui.betControl({ min: this.limits[0], max: this.limits[1], value: this.bet, getMoney: () => this.state.money, onChange: (v) => { this.bet = v; this.drawScreen(); audio.play('tick', { vol: 0.6 }); }, label: this.video ? 'Total bet' : 'Bet' });
    body.append(this.betCtl.el);
    const row = document.createElement('div'); row.className = 'row';
    this.spinBtn = ui.button(this.video ? 'SPIN' : 'PULL!', 'big green', () => this.spin(), 'Space', 'SPACE');
    this.autoBtn = ui.button('Auto ×10', 'blue', () => this.toggleAuto());
    this.redBtn = ui.button('♥ RED', 'red', () => this.gamble('red'));
    this.blackBtn = ui.button('♠ BLACK', 'dark', () => this.gamble('black'));
    this.collectBtn = ui.button('Collect', 'green', () => this.collect(), 'KeyC', 'C');
    this.gambleLbl = document.createElement('span'); this.gambleLbl.className = 'mini';
    row.append(this.spinBtn, this.autoBtn, this.gambleLbl, this.redBtn, this.blackBtn, this.collectBtn);
    body.append(row);
    this.setGambleUI(false);
    p.msg(this.video ? 'Line up 3+ symbols from the left. 3 ★ BONUS = free spins!' : 'Line up three on the center line. Any cherry pays!');
    this.drawScreen();
  }
  leave() { super.leave(); this.auto = 0; if (this.gambleState) this.collect(); }
  canLeave() { return this.phase === 'idle' || this.phase === 'gamble'; }

  setGambleUI(on) {
    this.redBtn.style.display = this.blackBtn.style.display = this.collectBtn.style.display = on ? '' : 'none';
    this.gambleLbl.style.display = on ? '' : 'none';
    this.spinBtn.style.display = on ? 'none' : '';
    this.autoBtn.style.display = on ? 'none' : '';
  }
  toggleAuto() {
    this.auto = this.auto ? 0 : 10;
    this.autoBtn.textContent = this.auto ? `Stop (${this.auto})` : 'Auto ×10';
    if (this.auto && this.phase === 'idle') this.spin();
  }

  pressButton(name) {
    const b = this.buttons.find((x) => x.name === name);
    if (!b) return;
    b.pressT = 0.18;
  }

  // ---------------------------------------------------------------- spinning
  spin(npc = null) {
    if (this.phase === 'gamble' && !npc) this.collect();
    if (this.phase !== 'idle') { if (this.phase === 'rollup' && !npc) this.skipRollup = true; return false; }
    const free = this.freeSpins > 0 && !npc;
    if (!npc) {
      if (!free) {
        if (!this.takeBet(this.bet, 'slots')) { this.auto = 0; if (this.autoBtn) this.autoBtn.textContent = 'Auto ×10'; return false; }
        this.ctx.director.jackpot += this.bet * 0.04;
        this.spinBet = this.bet; this.isFree = false;
      } else { this.freeSpins--; this.spinBet = this.freeBet || this.bet; this.isFree = true; }
      this.panel && this.panel.msg(free ? `FREE SPIN! ${this.freeSpins} left · wins ×${VIDEO.freeMult}` : 'Good luck…');
      this.betCtl && this.betCtl.disable(true);
    }
    this.npcSpinner = npc;
    this.phase = 'spin';
    this.shownWin = 0;
    this.clearWinLines();
    const pos = this.worldPos();
    const vol = npc ? 0.35 : 1;
    // outcome
    const stops = this.reels.map((r) => spinReel(r.strip, rand));
    this.result = stops;
    // lever / button
    if (!this.video) {
      audio.play('lever', { pos, vol });
      this.leverT = 0;
    } else { this.pressButton('SPIN'); audio.play('click', { pos, vol }); }
    if (!npc) this.ctx.director.player.poke();
    setTimeout(() => audio.play('reelStart', { pos, vol }), this.video ? 0 : 250);
    const t0 = this.video ? 0 : 0.28;
    this.reels.forEach((r, i) => r.start(t0 + i * 0.06));
    // anticipation check (two jackpot-ish symbols already on the line)
    const grid = this.reels.map((r, i) => window3(r.strip, stops[i]));
    let antic = false;
    if (!this.video) {
      const mids = grid.map((c) => c[1]);
      const hot = (s) => s === SYM.WILD || s === SYM.SEVEN;
      antic = hot(mids[0]) && hot(mids[1]);
    } else {
      let sc = 0; for (let i = 0; i < 4; i++) sc += grid[i].filter((s) => s === SYM.SCATTER).length;
      antic = sc >= 2;
    }
    const base = (this.video ? 0.9 : 1.1) * (this.turbo ? 0.5 : 1);
    this.stopTimes = this.reels.map((_, i) => base + i * (this.video ? 0.28 : 0.42) + (antic && i === this.reels.length - 1 ? 1.4 : 0));
    this.spinT = 0;
    this.antic = antic;
    this.stopped = 0;
    if (antic) setTimeout(() => this.active && this.phase === 'spin' && (audio.play('anticipation', { pos, vol }), (this.anticFlash = true)), (this.stopTimes[this.reels.length - 2] + 0.2) * 1000);
    this.reels.forEach((r, i) => { r.onStop = () => { audio.play('reelStop', { pos, vol, i }); this.stopped++; if (this.stopped === this.reels.length) this.resolve(); }; });
    return true;
  }

  npcSpin(npc) {
    if (this.active || this.phase !== 'idle') return null;
    this.spin(npc);
    // pre-compute win class for the NPC reaction
    const grid = this.reels.map((r, i) => window3(r.strip, this.result[i]));
    if (this.video) { const e = evalVideo(grid); return e.lineMult / 9 + e.scatterPay >= 5 ? 'win' : 'lose'; }
    return evalClassic(grid.map((c) => c[1])).mult >= 10 ? 'win' : 'lose';
  }
  npcLeave() {}

  resolve() {
    const grid = this.reels.map((r, i) => window3(r.strip, this.result[i]));
    this.anticFlash = false;
    const npc = this.npcSpinner;
    const pos = this.worldPos();
    let gross = 0, label = '', jackpot = false;
    if (this.video) {
      const free = this.isFree && !npc;
      const e = evalVideo(grid, free ? VIDEO.freeMult : 1);
      const lineBet = (this.spinBet || this.bet) / 9;
      gross = e.lineMult * lineBet + e.scatterPay * (this.spinBet || this.bet);
      this.winLines = e.wins.map((w) => w.line);
      if (e.freeSpins && !npc) {
        if (!this.isFree) this.freeBet = this.spinBet;
        this.freeSpins += e.freeSpins; this.freeSpinsActive = true;
        setTimeout(() => { this.ui.banner('FREE SPINS!', `${e.freeSpins} spins · all wins ×${VIDEO.freeMult}`, 'green', 2400); audio.play('powerup'); }, 300);
      }
      label = e.wins.length ? `${e.wins.length} winning line${e.wins.length > 1 ? 's' : ''}` : '';
      if (e.scatters >= 3) label += (label ? ' + ' : '') + `${e.scatters} BONUS`;
      jackpot = e.jackpot;
    } else {
      const e = evalClassic(grid.map((c) => c[1]));
      gross = e.mult * (this.spinBet || this.bet);
      label = e.label; jackpot = !!e.jackpot;
      this.winLines = e.mult > 0 ? [0] : [];
    }
    if (npc) {
      if (gross > 0) { this.flashT = gross > 0 ? 1.6 : 0; audio.play('winSmall', { pos, vol: 0.4 }); }
      this.phase = 'idle'; this.npcSpinner = null;
      return;
    }
    const stake = this.isFree ? 0 : (this.spinBet || this.bet);
    if (jackpot) {
      const share = Math.min(1, (this.spinBet || this.bet) / this.limits[1]);
      const jp = Math.round(this.ctx.director.jackpot * share);
      gross += jp;
      this.ctx.director.jackpot = 20000 + rand() * 10000;
      label = `PROGRESSIVE JACKPOT ${fmtMoney(jp)}!`;
    }
    gross *= this.state.perkMult('slots');
    if (gross > 0) {
      this.win = gross;
      this.winStake = stake;
      this.flashT = 2.5;
      this.panel.msg(`${label} — WIN ${fmtMoney(gross)}!`, 'win');
      this.showWinLines();
      this.rollup(gross, () => {
        if (this.freeSpins > 0) { this.payWin(); this.phase = 'idle'; setTimeout(() => this.active && this.spin(), 900); return; }
        if (this.freeSpinsActive && this.freeSpins === 0) this.freeSpinsActive = false;
        if (this.auto > 0) { this.payWin(); this.phase = 'idle'; this.nextAuto(); return; }
        this.offerGamble();
      });
      this.celebrate(gross - stake, Math.max(stake, this.spinBet || 1), pos);
      this.dropCoins(Math.min(30, 3 + Math.floor(gross / stake)));
    } else {
      this.win = 0;
      this.state.lost(stake, 'slots');
      this.panel.msg(this.antic ? 'Sooo close!' : this.rngTaunt(), 'lose');
      this.phase = 'idle';
      this.betCtl.disable(false);
      if (this.freeSpins > 0) { setTimeout(() => this.active && this.spin(), 700); return; }
      if (this.freeSpinsActive) this.freeSpinsActive = false;
      this.nextAuto();
    }
    this.spinBet = undefined;
    this.drawScreen();
  }
  rngTaunt() { const l = ['No luck. Spin again?', 'The next one feels lucky…', 'Almost!', 'Keep going…', 'So close!']; return l[Math.floor(rand() * l.length)]; }
  nextAuto() {
    if (this.auto > 0) {
      this.auto--;
      this.autoBtn.textContent = this.auto ? `Stop (${this.auto})` : 'Auto ×10';
      if (this.auto > 0) setTimeout(() => this.active && this.phase === 'idle' && this.spin(), 500);
    }
  }

  rollup(amount, done) {
    this.phase = 'rollup';
    this.skipRollup = false;
    const dur = clamp(0.5 + Math.log10(Math.max(1, amount / this.bet)) * 1.2, 0.5, 4);
    const t0 = performance.now();
    const pos = this.worldPos();
    const step = () => {
      if (!this.active && !this.npcSpinner) { this.shownWin = amount; this.drawScreen(); done(); return; }
      const k = this.skipRollup ? 1 : Math.min(1, (performance.now() - t0) / 1000 / dur);
      this.shownWin = Math.round(amount * k * 100) / 100;
      this.drawScreen();
      if (Math.random() < 0.5) audio.play('tick', { pos, vol: 0.4 });
      if (k < 1) requestAnimationFrame(step); else { audio.play('ding', { pos, f: 2093 }); done(); }
    };
    step();
  }

  payWin() {
    if (this.win > 0) { this.state.payout(this.win, this.winStake || 0, 'slots'); this.win = 0; }
    this.betCtl && this.betCtl.disable(false);
    this.drawScreen();
  }

  // ---------------------------------------------------------------- double-up
  offerGamble() {
    this.phase = 'gamble';
    this.gambleState = { level: 0, card: null };
    this.setGambleUI(true);
    this.gambleLbl.innerHTML = `Double up <b>${fmtMoney(this.win)}</b>? Guess the card color →`;
    this.drawGambleCard(null);
  }
  gamble(color) {
    if (this.phase !== 'gamble' || this.gambleBusy) return;
    this.gambleBusy = true;
    const red = rand() < 0.5;
    const suit = red ? (rand() < 0.5 ? '♥' : '♦') : (rand() < 0.5 ? '♠' : '♣');
    const rank = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'][Math.floor(rand() * 13)];
    audio.play('cardFlip');
    let t = 0;
    const anim = () => {
      t += 1 / 30;
      this.drawGambleCard(t < 0.4 ? null : { rank, suit, red });
      if (t < 0.6) requestAnimationFrame(anim);
      else {
        const ok = (color === 'red') === red;
        this.gambleBusy = false;
        if (ok) {
          this.win *= 2; this.gambleState.level++;
          audio.play('winSmall'); this.ctx.director.flash(0.2, 0x60ff90);
          this.shownWin = this.win; this.drawScreen((g, w, h) => this.gambleOverlay(g, w, h, { rank, suit, red }));
          if (this.gambleState.level >= 5) { this.ui.toast('Max double-up reached!', 'gold'); this.collect(); return; }
          this.gambleLbl.innerHTML = `✔ ${fmtMoney(this.win)}! Double again? (${5 - this.gambleState.level} left)`;
          if (this.win - this.winStake > this.winStake * 8) this.celebrate(this.win - this.winStake, this.winStake, this.worldPos());
        } else {
          audio.play('lose');
          this.ctx.director.flash(0.25, 0xff2030);
          this.panel.msg(`Lost the double-up (${fmtMoney(this.win)})`, 'lose');
          this.ctx.director.bigLoss(this.worldPos(), this.win);
          this.state.lost(this.winStake, 'slots');
          this.win = 0; this.shownWin = 0;
          this.endGamble();
        }
      }
    };
    anim();
  }
  drawGambleCard(card) { this.drawScreen((g, w, h) => this.gambleOverlay(g, w, h, card)); }
  gambleOverlay(g, w, h, card) {
    g.fillStyle = 'rgba(0,0,0,0.75)'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffd24a'; g.font = 'bold 22px "Courier New", monospace'; g.textAlign = 'left'; g.fillText('DOUBLE UP?', 12, 36);
    g.fillStyle = '#7dff9a'; g.fillText(fmtMoney(this.win), 12, 70);
    const cx = w - 70, cy = h / 2;
    g.fillStyle = card ? '#fff' : '#8a0f1e'; g.fillRect(cx - 30, cy - 40, 60, 80);
    g.strokeStyle = '#ffd24a'; g.lineWidth = 3; g.strokeRect(cx - 30, cy - 40, 60, 80);
    if (card) { g.fillStyle = card.red ? '#c8102e' : '#111'; g.font = 'bold 30px Georgia'; g.textAlign = 'center'; g.fillText(card.rank, cx, cy - 4); g.fillText(card.suit, cx, cy + 30); }
    else { g.fillStyle = '#ffd24a'; g.font = 'bold 36px Georgia'; g.textAlign = 'center'; g.fillText('?', cx, cy + 12); }
  }
  collect() {
    if (this.phase !== 'gamble') return;
    if (this.win > 0) { audio.play('coins', { count: 6 }); this.payWin(); }
    this.endGamble();
  }
  endGamble() {
    this.gambleState = null;
    this.phase = 'idle';
    this.setGambleUI(false);
    this.betCtl.disable(false);
    this.drawScreen();
    this.nextAuto();
  }

  // ---------------------------------------------------------------- feedback
  showWinLines() {
    if (this.video) { this.winLineIdx = 0; this.winLineT = 0; }
    else this.lineMat.opacity = 1;
  }
  clearWinLines() {
    this.winLines = [];
    this.lineMat.opacity = 0;
    if (this.videoLines) this.videoLines.forEach((l) => (l.visible = false));
  }
  dropCoins(n) {
    const pos = this.worldPos();
    for (let i = 0; i < n; i++) {
      setTimeout(() => {
        if (this.coinsInTray.length > 40) { const old = this.coinsInTray.shift(); this.group.remove(old); }
        const c = new THREE.Mesh(G.cyl(0.013, 0.013, 0.003, 14), M.gold());
        c.position.set((rand() - 0.5) * 0.36, 0.78, 0.31);
        c.rotation.set(rand() * 3, rand() * 3, rand() * 3);
        c.userData.vy = 0; c.userData.rest = 0.668 + this.coinsInTray.length * 0.0007;
        this.group.add(c); this.coinsInTray.push(c);
        audio.play('coin', { pos, vol: 0.6 });
      }, i * 70);
    }
  }

  update(dt, t, active) {
    let anyFast = false;
    for (const r of this.reels) { r.update(dt); if (r.fast) anyFast = true; }
    // blurred strip while spinning fast
    for (const r of this.reels) r.mesh.material = r.fast ? this.reelMatBlur : this.reelMat;
    if (this.phase === 'spin') {
      this.spinT += dt;
      this.reels.forEach((r, i) => { if (r.anim && r.anim.kind === 'start' && this.spinT >= this.stopTimes[i]) r.stopAt(this.result[i], 3 + (i === this.reels.length - 1 && this.antic ? 2 : 0)); });
      if (anyFast && Math.random() < 0.35) audio.play('reelTick', { pos: this.worldPos(), vol: this.npcSpinner ? 0.2 : 0.5 });
    }
    // lever
    if (this.lever && this.leverT !== undefined) {
      this.leverT += dt;
      const k = this.leverT;
      this.lever.rotation.x = k < 0.22 ? -0.1 + (k / 0.22) * 1.25 : k < 0.6 ? 1.15 - Math.sin(((k - 0.22) / 0.38) * Math.PI * 0.5) * 1.25 + Math.sin(k * 30) * 0.03 * (0.6 - k) : -0.1;
      if (k > 0.8) this.leverT = undefined;
    }
    // buttons
    for (const b of this.buttons) {
      if (b.pressT > 0) { b.pressT -= dt; b.cap.position.y = 0.002; } else b.cap.position.y = 0.008;
      b.m.emissiveIntensity = 0.5 + (this.phase === 'idle' && b.name === 'SPIN' ? 0.6 + Math.sin(t * 5) * 0.4 : 0);
    }
    // lights
    this.flashT = Math.max(0, (this.flashT || 0) - dt);
    const chase = this.phase === 'spin' || this.flashT > 0 || this.anticFlash;
    const step = Math.floor(t * (this.flashT > 0 ? 14 : 9));
    const n = this.chaser.length / 2;
    for (let i = 0; i < this.chaser.length; i++) {
      const k = i % n;
      const on = chase ? (this.flashT > 0 ? step % 2 === 0 : (k + step) % 4 === 0) : (k + Math.floor(t * 2)) % 8 === 0;
      this.chaser[i].material = on ? this.bulbOn : this.bulbOff;
    }
    this.candleMat.emissiveIntensity = this.flashT > 0 ? (step % 2 ? 4 : 0.4) : this.anticFlash ? 2 + Math.sin(t * 20) * 1.5 : 0.6 + Math.sin(t * 1.5) * 0.2;
    // win lines
    if (this.lineMat.opacity > 0 && !this.video) this.lineMat.opacity = this.phase === 'spin' ? 0 : 0.6 + 0.4 * Math.sin(t * 10);
    if (this.video && this.winLines && this.winLines.length && this.phase !== 'spin') {
      this.winLineT += dt;
      if (this.winLineT > 0.9) { this.winLineT = 0; this.winLineIdx = (this.winLineIdx + 1) % this.winLines.length; }
      this.videoLines.forEach((l, i) => (l.visible = i === this.winLines[this.winLineIdx] || (this.winLineT < 0.3 && this.winLines.includes(i) && false)));
    }
    // tray coins settle
    for (const c of this.coinsInTray) {
      const u = c.userData;
      if (c.position.y > u.rest) { u.vy -= 9.8 * dt; c.position.y = Math.max(u.rest, c.position.y + u.vy * dt); if (c.position.y === u.rest) { c.rotation.x = Math.PI / 2 * 0 + (rand() - 0.5) * 0.2; c.rotation.z = (rand() - 0.5) * 0.2; } }
    }
    if (active && this.phase === 'idle' && this._lastMoney !== this.state.money) { this._lastMoney = this.state.money; this.drawScreen(); }
  }

  dispose() { this.screen.dispose(); }
}
