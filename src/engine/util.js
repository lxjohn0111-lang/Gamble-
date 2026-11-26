import * as THREE from 'three';

export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => clamp((v - a) / (b - a), 0, 1);
export const smoothstep = (a, b, v) => { const t = invLerp(a, b, v); return t * t * (3 - 2 * t); };
/** Frame-rate independent exponential smoothing. */
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const dampAngle = (a, b, lambda, dt) => {
  let d = ((b - a + Math.PI) % TAU + TAU) % TAU - Math.PI;
  return a + d * (1 - Math.exp(-lambda * dt));
};
export const wrapAngle = (a) => ((a + Math.PI) % TAU + TAU) % TAU - Math.PI;

export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOutBack = (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
export const easeOutElastic = (t) => (t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (TAU / 3)) + 1);
export const easeOutBounce = (x) => {
  const n1 = 7.5625, d1 = 2.75;
  if (x < 1 / d1) return n1 * x * x;
  if (x < 2 / d1) return n1 * (x -= 1.5 / d1) * x + 0.75;
  if (x < 2.5 / d1) return n1 * (x -= 2.25 / d1) * x + 0.9375;
  return n1 * (x -= 2.625 / d1) * x + 0.984375;
};

/** Deterministic PRNG (mulberry32). */
export function makeRng(seed = 1) {
  let a = seed >>> 0;
  const rng = () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rng.range = (lo, hi) => lo + (hi - lo) * rng();
  rng.int = (lo, hi) => Math.floor(lo + (hi - lo + 1) * rng());
  rng.pick = (arr) => arr[Math.floor(rng() * arr.length)];
  rng.chance = (p) => rng() < p;
  return rng;
}

/** Crypto-backed uniform random for gameplay outcomes. */
const _buf = new Uint32Array(1);
export function rand() {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(_buf);
    return _buf[0] / 4294967296;
  }
  return Math.random();
}
export const randInt = (lo, hi) => Math.floor(lo + (hi - lo + 1) * rand());
export const randPick = (arr) => arr[Math.floor(rand() * arr.length)];
export function weightedPick(items, weightKey = 'w') {
  let total = 0;
  for (const it of items) total += it[weightKey];
  let r = rand() * total;
  for (const it of items) { r -= it[weightKey]; if (r <= 0) return it; }
  return items[items.length - 1];
}
export function shuffle(arr, r = rand) {
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
}

export function fmtMoney(v, cents = false) {
  const neg = v < 0; v = Math.abs(v);
  const s = cents ? v.toFixed(2) : Math.round(v).toString();
  const [i, d] = s.split('.');
  const withCommas = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (neg ? '-$' : '$') + withCommas + (d ? '.' + d : '');
}
export function fmtShort(v) {
  const a = Math.abs(v);
  if (a >= 1e9) return '$' + (v / 1e9).toFixed(2).replace(/\.?0+$/, '') + 'B';
  if (a >= 1e6) return '$' + (v / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'M';
  if (a >= 1e4) return '$' + (v / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return fmtMoney(v);
}

export const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Simple tween manager driven by the main loop (so it pauses with the game). */
export class Tweens {
  constructor() { this.list = []; }
  add(duration, onUpdate, { ease = (t) => t, delay = 0, onDone } = {}) {
    return new Promise((resolve) => {
      this.list.push({ t: -delay, duration, onUpdate, ease, onDone, resolve });
    });
  }
  delay(sec) { return this.add(sec, () => {}); }
  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const tw = this.list[i];
      tw.t += dt;
      if (tw.t < 0) continue;
      const k = Math.min(1, tw.t / tw.duration);
      tw.onUpdate(tw.ease(k), k);
      if (k >= 1) {
        this.list.splice(i, 1);
        tw.onDone && tw.onDone();
        tw.resolve();
      }
    }
  }
  clear() { this.list.length = 0; }
}

export function disposeObject(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (m.userData && m.userData.shared) continue;
        for (const k in m) {
          const v = m[k];
          if (v && v.isTexture && !(v.userData && v.userData.shared)) v.dispose();
        }
        m.dispose();
      }
    }
  });
}

export const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
export const deg = (d) => (d * Math.PI) / 180;
