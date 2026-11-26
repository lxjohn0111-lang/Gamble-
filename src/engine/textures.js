import * as THREE from 'three';
import { fbm, turb, vnoise, white } from './noise.js';
import { makeRng, TAU } from './util.js';

// ---------------------------------------------------------------------------
// Procedural texture factory. Everything is drawn at load time so the build
// ships with zero image assets.
// ---------------------------------------------------------------------------

let maxAniso = 8;
export function setMaxAnisotropy(v) { maxAniso = v; }

const cache = new Map();
export function cached(key, fn) {
  if (!cache.has(key)) cache.set(key, fn());
  return cache.get(key);
}
export function clearTextureCache() {
  for (const v of cache.values()) {
    const list = v && v.isTexture ? [v] : v && typeof v === 'object' ? Object.values(v) : [];
    for (const t of list) if (t && t.isTexture) t.dispose();
  }
  cache.clear();
}

export function makeCanvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: false });
  return { c, g };
}

export function toTex(canvas, { repeat = [1, 1], srgb = true, aniso = true, wrap = true, mips = true } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (wrap) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = aniso ? maxAniso : 1;
  if (!mips) { t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; }
  t.userData.shared = true;
  t.needsUpdate = true;
  return t;
}

/** Iterate pixels writing RGBA into ImageData. fn(u, v, x, y, out) fills out[0..3] (0..255). */
export function pixels(g, w, h, fn) {
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  const out = [0, 0, 0, 255];
  let i = 0;
  for (let y = 0; y < h; y++) {
    const v = y / h;
    for (let x = 0; x < w; x++, i += 4) {
      out[0] = d[i]; out[1] = d[i + 1]; out[2] = d[i + 2]; out[3] = d[i + 3];
      fn(x / w, v, x, y, out);
      d[i] = out[0]; d[i + 1] = out[1]; d[i + 2] = out[2]; d[i + 3] = out[3];
    }
  }
  g.putImageData(img, 0, 0);
}

/** Build a tangent-space normal map from a Float32 height field (tileable). */
export function normalFromHeight(hf, w, h, strength = 2) {
  const { c, g } = makeCanvas(w, h);
  const img = g.createImageData(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    const ym = ((y - 1 + h) % h) * w, yp = ((y + 1) % h) * w, yc = y * w;
    for (let x = 0; x < w; x++) {
      const xm = (x - 1 + w) % w, xp = (x + 1) % w;
      const dx = (hf[yc + xp] - hf[yc + xm]) * strength;
      const dy = (hf[yp + x] - hf[ym + x]) * strength;
      let nx = -dx, ny = dy, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l; ny /= l; nz /= l;
      const i = (yc + x) * 4;
      d[i] = (nx * 0.5 + 0.5) * 255; d[i + 1] = (ny * 0.5 + 0.5) * 255; d[i + 2] = (nz * 0.5 + 0.5) * 255; d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

/** Height field from the luminance of a canvas (for embossed patterns). */
export function heightFromCanvas(c, blur = 0) {
  const g = c.getContext('2d');
  if (blur) { g.filter = `blur(${blur}px)`; g.drawImage(c, 0, 0); g.filter = 'none'; }
  const { width: w, height: h } = c;
  const d = g.getImageData(0, 0, w, h).data;
  const hf = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) hf[i] = (d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11) / 255;
  return hf;
}

const hex = (c) => '#' + new THREE.Color(c).getHexString();
function shade(color, k) {
  const c = new THREE.Color(color);
  if (k > 0) c.lerp(new THREE.Color(1, 1, 1), k); else c.multiplyScalar(1 + k);
  return '#' + c.getHexString();
}

/** Draw fn at (x,y) and at wrapped copies so the tile stays seamless. */
function wrapDraw(w, h, x, y, r, fn) {
  for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) {
    const xx = x + ox, yy = y + oy;
    if (xx + r < 0 || xx - r > w || yy + r < 0 || yy - r > h) continue;
    fn(xx, yy);
  }
}

// ---------------------------------------------------------------------------
// Carpets — the soul of a casino floor.
// ---------------------------------------------------------------------------
function star(g, x, y, n, r1, r2, rot = 0) {
  g.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 ? r2 : r1;
    const a = rot + (i * Math.PI) / n;
    g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  g.closePath();
}
function petalRing(g, x, y, n, len, wid, rot, fill) {
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * TAU;
    g.save(); g.translate(x, y); g.rotate(a);
    g.beginPath();
    g.moveTo(0, 0);
    g.quadraticCurveTo(wid, len * 0.5, 0, len);
    g.quadraticCurveTo(-wid, len * 0.5, 0, 0);
    g.fillStyle = fill; g.fill();
    g.restore();
  }
}
function swirl(g, x, y, s, rot, stroke, width) {
  g.save(); g.translate(x, y); g.rotate(rot); g.scale(s, s);
  g.beginPath();
  g.moveTo(0, 0);
  g.bezierCurveTo(30, -40, 80, -10, 60, 25);
  g.bezierCurveTo(48, 45, 22, 30, 32, 14);
  g.bezierCurveTo(38, 4, 50, 12, 46, 20);
  g.strokeStyle = stroke; g.lineWidth = width / s; g.lineCap = 'round'; g.stroke();
  g.restore();
}

export function carpetTexture(style = 'royal', pal = {}) {
  return cached('carpet:' + style + JSON.stringify(pal), () => {
    const S = 1024;
    const { c, g } = makeCanvas(S);
    const rng = makeRng(style.length * 97 + 13);
    const P = Object.assign({ base: '#4a0d17', a: '#d8a23a', b: '#1d6b6b', c: '#7a1022', d: '#f1d27a' }, pal);
    g.fillStyle = P.base; g.fillRect(0, 0, S, S);

    if (style === 'royal') {
      // Large lattice of medallions with swirling vines between them.
      const cells = 4, cs = S / cells;
      for (let i = 0; i < cells; i++) for (let j = 0; j < cells; j++) {
        const x = i * cs + cs / 2, y = j * cs + cs / 2;
        wrapDraw(S, S, x, y, cs, (xx, yy) => {
          g.fillStyle = P.c; g.beginPath(); g.arc(xx, yy, cs * 0.36, 0, TAU); g.fill();
          petalRing(g, xx, yy, 12, cs * 0.34, cs * 0.07, (i + j) * 0.3, P.b);
          star(g, xx, yy, 8, cs * 0.22, cs * 0.1, 0.2); g.fillStyle = P.a; g.fill();
          g.lineWidth = 4; g.strokeStyle = P.d; g.stroke();
          g.fillStyle = P.base; g.beginPath(); g.arc(xx, yy, cs * 0.07, 0, TAU); g.fill();
          g.fillStyle = P.d; g.beginPath(); g.arc(xx, yy, cs * 0.035, 0, TAU); g.fill();
          g.strokeStyle = P.a; g.lineWidth = 3;
          g.beginPath(); g.arc(xx, yy, cs * 0.4, 0, TAU); g.stroke();
        });
        // vines in between cells
        const vx = i * cs, vy = j * cs;
        wrapDraw(S, S, vx, vy, cs * 0.6, (xx, yy) => {
          for (let k = 0; k < 4; k++) swirl(g, xx, yy, 1.1, k * Math.PI / 2 + 0.3, P.a, 5);
          for (let k = 0; k < 4; k++) swirl(g, xx, yy, 0.7, k * Math.PI / 2 + 1.1, P.b, 4);
          star(g, xx, yy, 4, 26, 8, Math.PI / 4); g.fillStyle = P.d; g.fill();
        });
      }
      // scattered confetti diamonds
      for (let k = 0; k < 220; k++) {
        const x = rng() * S, y = rng() * S, r = 4 + rng() * 6;
        wrapDraw(S, S, x, y, r, (xx, yy) => { star(g, xx, yy, 4, r, r * 0.4, 0); g.fillStyle = rng() < 0.5 ? P.b : P.d; g.fill(); });
      }
    } else if (style === 'cosmic') {
      // Black-light space carpet: planets, rings, comets, stars.
      const cols = [P.a, P.b, P.c, P.d, '#ff4fd8', '#4ff0ff'];
      for (let k = 0; k < 40; k++) {
        const x = rng() * S, y = rng() * S, r = 14 + rng() * 46, col = cols[k % cols.length];
        wrapDraw(S, S, x, y, r * 2.2, (xx, yy) => {
          const gr = g.createRadialGradient(xx - r * 0.3, yy - r * 0.3, r * 0.1, xx, yy, r);
          gr.addColorStop(0, shade(col, 0.4)); gr.addColorStop(1, shade(col, -0.35));
          g.fillStyle = gr; g.beginPath(); g.arc(xx, yy, r, 0, TAU); g.fill();
          if (k % 3 === 0) {
            g.save(); g.translate(xx, yy); g.rotate(rng() * TAU); g.scale(1, 0.32);
            g.strokeStyle = cols[(k + 2) % cols.length]; g.lineWidth = 7;
            g.beginPath(); g.arc(0, 0, r * 1.7, 0, TAU); g.stroke(); g.restore();
          }
        });
      }
      for (let k = 0; k < 26; k++) {
        const x = rng() * S, y = rng() * S, a = rng() * TAU, L = 60 + rng() * 80, col = cols[k % cols.length];
        wrapDraw(S, S, x, y, L, (xx, yy) => {
          g.strokeStyle = col; g.lineWidth = 6; g.lineCap = 'round';
          g.beginPath(); g.moveTo(xx, yy);
          g.quadraticCurveTo(xx + Math.cos(a + 0.4) * L * 0.5, yy + Math.sin(a + 0.4) * L * 0.5, xx + Math.cos(a) * L, yy + Math.sin(a) * L); g.stroke();
          star(g, xx, yy, 5, 14, 6, a); g.fillStyle = '#fff6a8'; g.fill();
        });
      }
      for (let k = 0; k < 600; k++) {
        const x = rng() * S, y = rng() * S, r = 1 + rng() * 3.5;
        g.fillStyle = rng() < 0.3 ? cols[k % cols.length] : '#fdfbe8';
        g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
      }
    } else if (style === 'tropical') {
      const cols = [P.a, P.b, P.c, P.d];
      for (let k = 0; k < 70; k++) {
        const x = rng() * S, y = rng() * S, r = 30 + rng() * 60, rot = rng() * TAU;
        wrapDraw(S, S, x, y, r, (xx, yy) => {
          g.save(); g.translate(xx, yy); g.rotate(rot);
          g.fillStyle = cols[k % 2 ? 1 : 3];
          g.beginPath(); g.moveTo(0, -r); g.bezierCurveTo(r * 0.7, -r * 0.4, r * 0.5, r * 0.6, 0, r);
          g.bezierCurveTo(-r * 0.5, r * 0.6, -r * 0.7, -r * 0.4, 0, -r); g.fill();
          g.strokeStyle = P.base; g.lineWidth = 3; g.beginPath(); g.moveTo(0, -r * 0.9); g.lineTo(0, r * 0.95); g.stroke();
          for (let s = -3; s <= 3; s++) { g.beginPath(); g.moveTo(0, s * r * 0.25); g.lineTo(r * 0.5 * Math.sign(s || 1), s * r * 0.25 - r * 0.18); g.stroke(); }
          g.restore();
        });
      }
      for (let k = 0; k < 40; k++) {
        const x = rng() * S, y = rng() * S, r = 18 + rng() * 20;
        wrapDraw(S, S, x, y, r * 1.6, (xx, yy) => {
          petalRing(g, xx, yy, 5, r * 1.4, r * 0.7, rng() * TAU, cols[(k % 2) * 2]);
          g.fillStyle = P.d; g.beginPath(); g.arc(xx, yy, r * 0.25, 0, TAU); g.fill();
        });
      }
    } else if (style === 'western') {
      // Navajo-inspired stepped diamonds in rows.
      const rows = 8, rh = S / rows;
      for (let j = 0; j < rows; j++) {
        g.fillStyle = j % 2 ? P.c : P.base; g.fillRect(0, j * rh, S, rh);
        g.fillStyle = P.a; g.fillRect(0, j * rh, S, 6); g.fillRect(0, j * rh + rh - 6, S, 6);
        const n = 8;
        for (let i = 0; i < n; i++) {
          const x = (i + (j % 2) * 0.5) * (S / n), y = j * rh + rh / 2;
          wrapDraw(S, S, x, y, rh, (xx, yy) => {
            for (let s = 4; s >= 1; s--) {
              const r = (rh * 0.42 * s) / 4;
              g.fillStyle = [P.d, P.b, P.a, P.base][s - 1];
              g.beginPath(); g.moveTo(xx, yy - r); g.lineTo(xx + r * 1.4, yy); g.lineTo(xx, yy + r); g.lineTo(xx - r * 1.4, yy); g.closePath(); g.fill();
            }
          });
        }
      }
    } else if (style === 'deco') {
      // Art-deco fans in a scale pattern.
      const n = 8, cw = S / n, ch = cw * 0.5;
      for (let j = -1; j < S / ch + 1; j++) for (let i = 0; i <= n; i++) {
        const x = i * cw + (j % 2 ? cw / 2 : 0), y = j * ch;
        wrapDraw(S, S, x, y, cw, (xx, yy) => {
          for (let r = 4; r >= 1; r--) {
            g.fillStyle = [P.base, P.c, P.b, P.a][r - 1];
            g.beginPath(); g.arc(xx, yy, (cw / 2) * (r / 4), 0, Math.PI); g.fill();
          }
          g.strokeStyle = P.d; g.lineWidth = 3;
          for (let a = 0; a <= 8; a++) {
            const an = (a / 8) * Math.PI;
            g.beginPath(); g.moveTo(xx, yy); g.lineTo(xx + Math.cos(an) * cw / 2, yy + Math.sin(an) * cw / 2); g.stroke();
          }
          g.beginPath(); g.arc(xx, yy, cw / 2, 0, Math.PI); g.stroke();
        });
      }
    }

    // Fiber noise + mottling (tufted pile look).
    const hf = new Float32Array(S * S);
    pixels(g, S, S, (u, v, x, y, o) => {
      const n = white(x, y, 7) * 0.5 + white(x >> 1, y >> 1, 3) * 0.5;
      const m = fbm(u, v, 8, 3, 5);
      const k = 0.78 + n * 0.3 + (m - 0.5) * 0.18;
      o[0] = Math.min(255, o[0] * k); o[1] = Math.min(255, o[1] * k); o[2] = Math.min(255, o[2] * k);
      hf[y * S + x] = n * 0.6 + m * 0.4;
    });
    const map = toTex(c);
    const normalMap = toTex(normalFromHeight(hf, S, S, 1.6), { srgb: false });
    return { map, normalMap };
  });
}

// ---------------------------------------------------------------------------
export function feltTexture(color = '#0f5a32', seed = 1) {
  return cached('felt:' + color + seed, () => {
    const S = 512;
    const { c, g } = makeCanvas(S);
    g.fillStyle = color; g.fillRect(0, 0, S, S);
    const hf = new Float32Array(S * S);
    pixels(g, S, S, (u, v, x, y, o) => {
      const n = white(x, y, seed) * 0.6 + fbm(u, v, 16, 2, seed) * 0.4;
      const k = 0.9 + n * 0.18;
      o[0] *= k; o[1] *= k; o[2] *= k;
      hf[y * S + x] = n;
    });
    return { map: toTex(c), normalMap: toTex(normalFromHeight(hf, S, S, 0.7), { srgb: false }) };
  });
}

export function woodTexture(style = 'mahogany') {
  return cached('wood:' + style, () => {
    const S = 512;
    const { c, g } = makeCanvas(S);
    const P = {
      mahogany: [[0.42, 0.13, 0.07], [0.2, 0.05, 0.025]],
      walnut: [[0.36, 0.22, 0.13], [0.15, 0.08, 0.045]],
      oak: [[0.72, 0.52, 0.31], [0.44, 0.28, 0.15]],
      ebony: [[0.12, 0.08, 0.07], [0.04, 0.03, 0.03]],
      rustic: [[0.42, 0.26, 0.14], [0.18, 0.1, 0.05]],
      bamboo: [[0.86, 0.74, 0.45], [0.6, 0.46, 0.22]],
    }[style] || [[0.42, 0.13, 0.07], [0.2, 0.05, 0.025]];
    const hf = new Float32Array(S * S);
    const img = g.createImageData(S, S); const d = img.data;
    const freq = style === 'rustic' ? 11 : 16;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S;
      // grain runs along v (vertical); bands across u, warped by low-frequency noise
      const w = fbm(u, v, 3, 3, 11) * 2.2 + fbm(u, v, 1, 2, 4) * 1.5;
      const gr = u * freq + w;
      const f = gr - Math.floor(gr);
      const band = Math.pow(Math.sin(f * Math.PI), 6);
      const late = Math.min(1, Math.max(0, (f - 0.55) * 3));
      const pores = white(x, (y / 5) | 0, 9) * 0.22 + white(x >> 1, (y / 23) | 0, 3) * 0.12;
      const cloud = fbm(u, v, 6, 3, 5);
      let t = 0.25 + late * 0.35 + band * 0.25 + pores * 0.6 - 0.12 + (cloud - 0.5) * 0.35;
      t = Math.min(1, Math.max(0, t));
      const i = (y * S + x) * 4;
      const a = P[0], b = P[1];
      d[i] = (a[0] + (b[0] - a[0]) * t) * 255; d[i + 1] = (a[1] + (b[1] - a[1]) * t) * 255; d[i + 2] = (a[2] + (b[2] - a[2]) * t) * 255; d[i + 3] = 255;
      hf[y * S + x] = 1 - t * 0.6 - pores * 0.5;
    }
    g.putImageData(img, 0, 0);
    return { map: toTex(c), normalMap: toTex(normalFromHeight(hf, S, S, 0.8), { srgb: false }) };
  });
}

export function planksTexture(style = 'rustic') {
  return cached('planks:' + style, () => {
    const S = 1024;
    const { c, g } = makeCanvas(S);
    const wood = woodTexture(style).map.image;
    // rotate grain so it runs along the plank length (x)
    const rot = makeCanvas(512); rot.g.translate(512, 0); rot.g.rotate(Math.PI / 2); rot.g.drawImage(wood, 0, 0);
    const pat = g.createPattern(rot.c, 'repeat');
    const rng = makeRng(42);
    const rows = 8, rh = S / rows;
    const hf = new Float32Array(S * S).fill(1);
    for (let j = 0; j < rows; j++) {
      let x = -rng() * S * 0.5;
      while (x < S) {
        const len = S * (0.4 + rng() * 0.5);
        g.save();
        g.beginPath(); g.rect(x, j * rh, len, rh); g.clip();
        const m = new DOMMatrix().translate(rng() * 512, rng() * 512).scale(0.5, 0.5);
        pat.setTransform(m);
        g.fillStyle = pat; g.fillRect(x, j * rh, len, rh);
        const tint = 0.8 + rng() * 0.35;
        g.fillStyle = tint > 1 ? `rgba(255,200,140,${(tint - 1) * 0.5})` : `rgba(0,0,0,${(1 - tint) * 0.7})`;
        g.fillRect(x, j * rh, len, rh);
        g.restore();
        g.fillStyle = 'rgba(15,8,3,0.9)'; g.fillRect(x, j * rh, 3, rh);
        for (const ny of [rh * 0.25, rh * 0.75]) {
          g.fillStyle = '#1a1612'; g.beginPath(); g.arc(x + 14, j * rh + ny, 4, 0, TAU); g.fill();
          g.fillStyle = '#6f6a60'; g.beginPath(); g.arc(x + 13, j * rh + ny - 1, 1.6, 0, TAU); g.fill();
        }
        for (let yy = Math.floor(j * rh); yy < Math.min(S, j * rh + rh); yy++) for (let xx = Math.max(0, Math.floor(x)); xx < Math.min(S, x + 3); xx++) hf[yy * S + xx] = 0;
        x += len;
      }
      g.fillStyle = 'rgba(10,5,2,0.95)'; g.fillRect(0, j * rh, S, 3);
      for (let yy = j * rh; yy < j * rh + 3; yy++) for (let xx = 0; xx < S; xx++) hf[yy * S + xx] = 0;
    }
    const lum = heightFromCanvas(c);
    for (let i = 0; i < hf.length; i++) hf[i] = hf[i] * 0.75 + lum[i] * 0.25;
    return { map: toTex(c), normalMap: toTex(normalFromHeight(hf, S, S, 1.6), { srgb: false }) };
  });
}

export function marbleTexture(base = '#efe9df', vein = '#8a7f72', seed = 1) {
  return cached('marble:' + base + vein + seed, () => {
    const S = 1024;
    const { c, g } = makeCanvas(S);
    const B = new THREE.Color(base), V = new THREE.Color(vein);
    const img = g.createImageData(S, S); const d = img.data;
    const half = S / 2;
    // compute at half res and upscale for speed
    const { c: c2, g: g2 } = makeCanvas(half);
    const img2 = g2.createImageData(half, half); const d2 = img2.data;
    for (let y = 0; y < half; y++) for (let x = 0; x < half; x++) {
      const u = x / half, v = y / half;
      const t = turb(u, v, 3, 5, seed);
      const vv = Math.pow(1 - Math.abs(Math.sin((u + v * 0.6 + t * 1.6) * Math.PI * 3)), 10);
      const cloud = fbm(u, v, 4, 4, seed + 4);
      const k = Math.min(1, vv * 0.9 + (1 - cloud) * 0.12);
      const i = (y * half + x) * 4;
      d2[i] = (B.r + (V.r - B.r) * k) * 255; d2[i + 1] = (B.g + (V.g - B.g) * k) * 255; d2[i + 2] = (B.b + (V.b - B.b) * k) * 255; d2[i + 3] = 255;
    }
    g2.putImageData(img2, 0, 0);
    g.imageSmoothingQuality = 'high';
    g.drawImage(c2, 0, 0, S, S);
    void img; void d;
    return { map: toTex(c) };
  });
}

export function damaskTexture(base = '#5a0f1c', fg = '#b8862f') {
  return cached('damask:' + base + fg, () => {
    const S = 512;
    const { c, g } = makeCanvas(S);
    g.fillStyle = base; g.fillRect(0, 0, S, S);
    // subtle vertical stripes
    for (let i = 0; i < 16; i++) { g.fillStyle = i % 2 ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.025)'; g.fillRect(i * 32, 0, 32, S); }
    const motif = (x, y, s) => {
      g.save(); g.translate(x, y); g.scale(s, s);
      g.fillStyle = fg;
      for (const sx of [1, -1]) {
        g.save(); g.scale(sx, 1);
        g.beginPath(); g.moveTo(0, -110);
        g.bezierCurveTo(40, -90, 60, -40, 30, -10);
        g.bezierCurveTo(70, -20, 90, 20, 60, 50);
        g.bezierCurveTo(40, 70, 20, 60, 10, 40);
        g.bezierCurveTo(25, 80, 10, 100, 0, 115);
        g.lineTo(0, -110); g.fill();
        g.restore();
      }
      g.fillStyle = base;
      g.beginPath(); g.ellipse(0, 0, 14, 40, 0, 0, TAU); g.fill();
      g.beginPath(); g.ellipse(24, 30, 8, 14, -0.5, 0, TAU); g.fill();
      g.beginPath(); g.ellipse(-24, 30, 8, 14, 0.5, 0, TAU); g.fill();
      g.fillStyle = fg; g.beginPath(); g.ellipse(0, 0, 5, 20, 0, 0, TAU); g.fill();
      g.restore();
    };
    for (const [x, y] of [[128, 128], [384, 384], [384 - 512, 384], [128 + 512, 128], [128, 128 + 512], [384, 384 - 512]]) motif(x, y, 0.95);
    for (const [x, y] of [[384, 128], [128, 384], [-128, 384], [384, 640], [640, 128]]) {
      g.save(); g.translate(x, y); g.fillStyle = fg; star(g, 0, 0, 4, 30, 9, 0); g.fill(); g.restore();
    }
    const hf = heightFromCanvas(c, 0);
    pixels(g, S, S, (u, v, x, y, o) => { const n = 0.92 + white(x, y, 2) * 0.12; o[0] *= n; o[1] *= n; o[2] *= n; });
    return { map: toTex(c), normalMap: toTex(normalFromHeight(hf, S, S, 2.5), { srgb: false }) };
  });
}

export function leatherTexture(color = '#5c1018', tufted = true) {
  return cached('leather:' + color + tufted, () => {
    const S = 512;
    const { c, g } = makeCanvas(S);
    const hf = new Float32Array(S * S);
    const col = new THREE.Color(color);
    const n = 4, cell = S / n;
    pixels(g, S, S, (u, v, x, y, o) => {
      let h = fbm(u, v, 32, 3, 7) * 0.25;
      if (tufted) {
        // diamond tufting: distance to nearest button in a rotated lattice
        const a = (u + v) * n, b = (u - v) * n;
        const fa = a - Math.floor(a) - 0.5, fb = b - Math.floor(b) - 0.5;
        const dd = Math.sqrt(fa * fa + fb * fb);
        const seam = Math.min(Math.abs(fa), Math.abs(fb));
        h += Math.min(1, dd * 1.6) * 0.6 + Math.min(1, seam * 14) * 0.2;
      }
      hf[y * S + x] = h;
      const k = 0.55 + h * 0.55;
      o[0] = col.r * 255 * k; o[1] = col.g * 255 * k; o[2] = col.b * 255 * k; o[3] = 255;
    });
    if (tufted) {
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        for (const [ox, oy] of [[0, 0], [0.5, 0.5]]) {
          const x = (i + ox) * cell, y = (j + oy) * cell;
          wrapDraw(S, S, x, y, 10, (xx, yy) => {
            const gr = g.createRadialGradient(xx - 2, yy - 2, 1, xx, yy, 7);
            gr.addColorStop(0, shade(color, 0.3)); gr.addColorStop(1, shade(color, -0.6));
            g.fillStyle = gr; g.beginPath(); g.arc(xx, yy, 7, 0, TAU); g.fill();
          });
        }
      }
    }
    void cell;
    return { map: toTex(c), normalMap: toTex(normalFromHeight(hf, S, S, 5), { srgb: false }) };
  });
}

export function brickTexture(base = '#7a3b26') {
  return cached('brick:' + base, () => {
    const S = 512;
    const { c, g } = makeCanvas(S);
    g.fillStyle = '#5b5148'; g.fillRect(0, 0, S, S);
    const rows = 12, rh = S / rows, bw = S / 4;
    const rng = makeRng(3);
    const hf = new Float32Array(S * S);
    for (let j = 0; j < rows; j++) for (let i = -1; i < 5; i++) {
      const x = i * bw + (j % 2) * bw / 2, y = j * rh;
      const col = new THREE.Color(base).multiplyScalar(0.75 + rng() * 0.45);
      g.fillStyle = '#' + col.getHexString();
      g.fillRect(x + 3, y + 3, bw - 6, rh - 6);
    }
    pixels(g, S, S, (u, v, x, y, o) => {
      const n = fbm(u, v, 16, 3, 1);
      const isMortar = o[0] === 0x5b && o[1] === 0x51;
      const k = 0.8 + n * 0.4;
      o[0] *= k; o[1] *= k; o[2] *= k;
      hf[y * S + x] = isMortar ? 0.1 + n * 0.1 : 0.7 + n * 0.3;
    });
    return { map: toTex(c), normalMap: toTex(normalFromHeight(hf, S, S, 3), { srgb: false }) };
  });
}

export function cofferTexture(base = '#2a1c14', trim = '#b28a3e') {
  return cached('coffer:' + base + trim, () => {
    const S = 512;
    const { c, g } = makeCanvas(S);
    g.fillStyle = trim; g.fillRect(0, 0, S, S);
    const inset = (k, col) => { g.fillStyle = col; g.fillRect(k, k, S - 2 * k, S - 2 * k); };
    inset(22, shade(trim, -0.35)); inset(34, shade(base, 0.12)); inset(56, base);
    const gr = g.createRadialGradient(S / 2, S / 2, 20, S / 2, S / 2, S * 0.45);
    gr.addColorStop(0, shade(base, 0.25)); gr.addColorStop(1, base);
    g.fillStyle = gr; g.fillRect(56, 56, S - 112, S - 112);
    g.strokeStyle = trim; g.lineWidth = 4; g.strokeRect(80, 80, S - 160, S - 160);
    star(g, S / 2, S / 2, 8, 50, 22, 0); g.fillStyle = trim; g.fill();
    const hf = heightFromCanvas(c, 2);
    return { map: toTex(c), normalMap: toTex(normalFromHeight(hf, S, S, 3), { srgb: false }) };
  });
}

export function bambooTexture() {
  return cached('bamboo-wall', () => {
    const S = 512;
    const { c, g } = makeCanvas(S);
    const n = 10, w = S / n;
    const rng = makeRng(8);
    for (let i = 0; i < n; i++) {
      const gr = g.createLinearGradient(i * w, 0, i * w + w, 0);
      const base = new THREE.Color(0.78, 0.64, 0.36).multiplyScalar(0.8 + rng() * 0.3);
      gr.addColorStop(0, shade('#' + base.getHexString(), -0.5));
      gr.addColorStop(0.35, shade('#' + base.getHexString(), 0.15));
      gr.addColorStop(1, shade('#' + base.getHexString(), -0.45));
      g.fillStyle = gr; g.fillRect(i * w, 0, w, S);
      const off = rng() * S;
      for (let k = 0; k < 3; k++) {
        const y = (off + k * S / 3) % S;
        g.fillStyle = 'rgba(70,45,15,0.8)'; g.fillRect(i * w, y, w, 5);
        g.fillStyle = 'rgba(255,240,190,0.35)'; g.fillRect(i * w, y + 5, w, 3);
      }
    }
    const hf = heightFromCanvas(c, 1);
    return { map: toTex(c), normalMap: toTex(normalFromHeight(hf, S, S, 3), { srgb: false }) };
  });
}

export function tileFloorTexture(a = '#e9e2d4', b = '#1b1b1f') {
  return cached('tiles:' + a + b, () => {
    const S = 1024;
    const { c, g } = makeCanvas(S);
    const ma = marbleTexture(a, '#a79d8e', 3).map.image;
    const mb = marbleTexture(b, '#5b5860', 5).map.image;
    const n = 4, t = S / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      g.drawImage((i + j) % 2 ? mb : ma, (i * 137) % 512, (j * 211) % 512, 256, 256, i * t, j * t, t, t);
    }
    g.strokeStyle = 'rgba(30,25,20,0.6)'; g.lineWidth = 3;
    for (let i = 0; i <= n; i++) { g.beginPath(); g.moveTo(i * t, 0); g.lineTo(i * t, S); g.stroke(); g.beginPath(); g.moveTo(0, i * t); g.lineTo(S, i * t); g.stroke(); }
    const hf = new Float32Array(S * S).fill(1);
    for (let i = 0; i <= n; i++) for (let k = 0; k < S; k++) for (let w = -2; w <= 2; w++) {
      const p = Math.min(S - 1, Math.max(0, i * t + w));
      hf[k * S + p] = 0; hf[p * S + k] = 0;
    }
    return { map: toTex(c), normalMap: toTex(normalFromHeight(hf, S, S, 1.5), { srgb: false }) };
  });
}

export function roughnessNoise(seed = 1, lo = 0.3, hi = 0.7) {
  return cached('rough:' + seed + lo + hi, () => {
    const S = 256;
    const { c, g } = makeCanvas(S);
    pixels(g, S, S, (u, v, x, y, o) => {
      const n = fbm(u, v, 6, 4, seed);
      const r = (lo + (hi - lo) * n) * 255;
      o[0] = o[1] = o[2] = r; o[3] = 255;
    });
    return toTex(c, { srgb: false });
  });
}

export function brushedNormal() {
  return cached('brushed', () => {
    const S = 256;
    const hf = new Float32Array(S * S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) hf[y * S + x] = vnoise(x * 0.02, y * 2.1, 6, 512, 4) * 0.6 + white(x >> 4, y, 2) * 0.4;
    return toTex(normalFromHeight(hf, S, S, 0.5), { srgb: false });
  });
}

/** Soft radial sprite used for glows, light pools and blob shadows. */
export function radialTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)', size = 128, falloff = 0.5) {
  return cached('radial:' + inner + outer + size + falloff, () => {
    const { c, g } = makeCanvas(size);
    const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gr.addColorStop(0, inner); gr.addColorStop(falloff, inner.replace(/[\d.]+\)$/, '0.45)')); gr.addColorStop(1, outer);
    g.fillStyle = gr; g.fillRect(0, 0, size, size);
    return toTex(c, { wrap: false });
  });
}

export function shaftTexture() {
  return cached('shaft', () => {
    const { c, g } = makeCanvas(64, 256);
    const gr = g.createLinearGradient(0, 0, 0, 256);
    gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 256);
    const gx = g.createLinearGradient(0, 0, 64, 0);
    gx.addColorStop(0, 'rgba(0,0,0,1)'); gx.addColorStop(0.5, 'rgba(0,0,0,0)'); gx.addColorStop(1, 'rgba(0,0,0,1)');
    g.globalCompositeOperation = 'destination-out'; g.fillStyle = gx; g.fillRect(0, 0, 64, 256);
    return toTex(c, { wrap: false });
  });
}

// ---------------------------------------------------------------------------
// Fabric prints for the jelly patrons.
// ---------------------------------------------------------------------------
export function hawaiianTexture(base = '#1e7fc2', colors = ['#ff5a7a', '#ffd23f', '#ffffff'], leaf = '#1f8a3b', motif = 'hibiscus', seed = 1) {
  return cached(`hawaii:${base}${colors.join()}${leaf}${motif}${seed}`, () => {
    const S = 512;
    const { c, g } = makeCanvas(S);
    const rng = makeRng(seed * 31 + 7);
    g.fillStyle = base; g.fillRect(0, 0, S, S);
    const leafShape = (x, y, r, rot, col) => {
      g.save(); g.translate(x, y); g.rotate(rot);
      g.fillStyle = col;
      g.beginPath(); g.moveTo(0, 0);
      g.bezierCurveTo(r * 0.5, -r * 0.3, r * 0.9, -r * 0.1, r, 0);
      g.bezierCurveTo(r * 0.9, r * 0.1, r * 0.5, r * 0.3, 0, 0); g.fill();
      g.strokeStyle = shade(col, -0.35); g.lineWidth = 2; g.beginPath(); g.moveTo(0, 0); g.lineTo(r, 0); g.stroke();
      // fronds
      g.strokeStyle = shade(col, 0.25); g.lineWidth = 1.2;
      for (let k = 1; k < 8; k++) { const t = k / 8; g.beginPath(); g.moveTo(r * t, 0); g.lineTo(r * t + r * 0.06, -r * 0.12 * Math.sin(t * Math.PI)); g.stroke(); }
      g.restore();
    };
    const hibiscus = (x, y, r, rot, col) => {
      for (let p = 0; p < 5; p++) {
        const a = rot + (p / 5) * TAU;
        g.save(); g.translate(x, y); g.rotate(a);
        const gr = g.createRadialGradient(0, 0, r * 0.1, 0, r * 0.5, r * 0.8);
        gr.addColorStop(0, shade(col, -0.45)); gr.addColorStop(0.4, col); gr.addColorStop(1, shade(col, 0.25));
        g.fillStyle = gr;
        g.beginPath(); g.moveTo(0, 0);
        g.bezierCurveTo(r * 0.55, r * 0.2, r * 0.6, r * 0.95, 0, r);
        g.bezierCurveTo(-r * 0.6, r * 0.95, -r * 0.55, r * 0.2, 0, 0); g.fill();
        g.restore();
      }
      g.strokeStyle = '#fff3a0'; g.lineWidth = 3;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(rot) * r * 0.8, y + Math.sin(rot) * r * 0.8); g.stroke();
      g.fillStyle = '#ffd400'; g.beginPath(); g.arc(x + Math.cos(rot) * r * 0.8, y + Math.sin(rot) * r * 0.8, 3, 0, TAU); g.fill();
    };
    const pineapple = (x, y, r, rot) => {
      g.save(); g.translate(x, y); g.rotate(rot);
      g.fillStyle = '#e8a81f'; g.beginPath(); g.ellipse(0, 0, r * 0.45, r * 0.65, 0, 0, TAU); g.fill();
      g.strokeStyle = '#9a5c0c'; g.lineWidth = 1.5;
      for (let k = -3; k <= 3; k++) { g.beginPath(); g.moveTo(-r * 0.5, k * r * 0.2 - r * 0.3); g.lineTo(r * 0.5, k * r * 0.2 + r * 0.3); g.stroke(); g.beginPath(); g.moveTo(r * 0.5, k * r * 0.2 - r * 0.3); g.lineTo(-r * 0.5, k * r * 0.2 + r * 0.3); g.stroke(); }
      g.fillStyle = leaf;
      for (let k = -2; k <= 2; k++) { g.beginPath(); g.moveTo(0, -r * 0.55); g.lineTo(k * r * 0.18, -r * 1.15 + Math.abs(k) * r * 0.12); g.lineTo(k * r * 0.05 + 3, -r * 0.55); g.fill(); }
      g.restore();
    };
    const flamingo = (x, y, r, rot) => {
      g.save(); g.translate(x, y); g.rotate(rot * 0.3);
      g.fillStyle = '#ff7eb3'; g.beginPath(); g.ellipse(0, 0, r * 0.5, r * 0.3, -0.2, 0, TAU); g.fill();
      g.strokeStyle = '#ff7eb3'; g.lineWidth = r * 0.1; g.lineCap = 'round';
      g.beginPath(); g.moveTo(r * 0.35, -r * 0.1); g.bezierCurveTo(r * 0.7, -r * 0.6, r * 0.2, -r * 0.9, r * 0.45, -r * 1.05); g.stroke();
      g.fillStyle = '#222'; g.beginPath(); g.arc(r * 0.52, -r * 1.03, r * 0.06, 0, TAU); g.fill();
      g.strokeStyle = '#d9568f'; g.lineWidth = r * 0.04;
      g.beginPath(); g.moveTo(0, r * 0.25); g.lineTo(0, r * 0.95); g.stroke();
      g.beginPath(); g.moveTo(0, r * 0.55); g.lineTo(r * 0.2, r * 0.45); g.stroke();
      g.restore();
    };
    const items = 26;
    for (let k = 0; k < items; k++) {
      const x = rng() * S, y = rng() * S, r = 30 + rng() * 34, rot = rng() * TAU;
      wrapDraw(S, S, x, y, r * 1.3, (xx, yy) => leafShape(xx, yy, r * 1.25, rot, k % 3 ? leaf : shade(leaf, 0.25)));
    }
    for (let k = 0; k < 16; k++) {
      const x = rng() * S, y = rng() * S, r = 20 + rng() * 20, rot = rng() * TAU, col = colors[k % colors.length];
      wrapDraw(S, S, x, y, r * 1.3, (xx, yy) => {
        if (motif === 'pineapple' && k % 2) pineapple(xx, yy, r, rot * 0.2);
        else if (motif === 'flamingo' && k % 2) flamingo(xx, yy, r * 1.2, rot);
        else hibiscus(xx, yy, r, rot, col);
      });
    }
    pixels(g, S, S, (u, v, x, y, o) => { const n = 0.93 + white(x, y, 4) * 0.1; o[0] *= n; o[1] *= n; o[2] *= n; });
    return toTex(c, { repeat: [2, 2] });
  });
}

/** Simple fabric types: solid with weave, stripes, plaid, tuxedo front etc. */
export function fabricTexture(kind = 'solid', a = '#333', b = '#fff', seed = 1) {
  return cached(`fabric:${kind}${a}${b}${seed}`, () => {
    const S = 256;
    const { c, g } = makeCanvas(S);
    g.fillStyle = a; g.fillRect(0, 0, S, S);
    if (kind === 'stripes') {
      for (let i = 0; i < 8; i++) if (i % 2) { g.fillStyle = b; g.fillRect(0, i * 32, S, 14); }
    } else if (kind === 'vstripes') {
      for (let i = 0; i < 16; i++) if (i % 2) { g.fillStyle = b; g.fillRect(i * 16, 0, 5, S); }
    } else if (kind === 'plaid') {
      g.globalAlpha = 0.45; g.fillStyle = b;
      for (let i = 0; i < 4; i++) { g.fillRect(i * 64 + 10, 0, 22, S); g.fillRect(0, i * 64 + 10, S, 22); }
      g.globalAlpha = 0.8; g.fillStyle = shade(b, -0.4);
      for (let i = 0; i < 4; i++) { g.fillRect(i * 64 + 48, 0, 3, S); g.fillRect(0, i * 64 + 48, S, 3); }
      g.globalAlpha = 1;
    } else if (kind === 'dots') {
      g.fillStyle = b;
      for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) { g.beginPath(); g.arc(i * 32 + (j % 2) * 16 + 8, j * 32 + 8, 5, 0, TAU); g.fill(); }
    } else if (kind === 'bowling') {
      g.fillStyle = b; g.fillRect(S * 0.36, 0, S * 0.28, S);
      g.fillStyle = shade(a, -0.3); g.fillRect(S * 0.36 - 4, 0, 4, S); g.fillRect(S * 0.64, 0, 4, S);
    } else if (kind === 'camo') {
      const rng = makeRng(seed);
      for (let k = 0; k < 60; k++) { g.fillStyle = [b, shade(a, -0.3), shade(b, -0.35)][k % 3]; g.beginPath(); g.ellipse(rng() * S, rng() * S, 10 + rng() * 26, 6 + rng() * 14, rng() * TAU, 0, TAU); g.fill(); }
    }
    pixels(g, S, S, (u, v, x, y, o) => {
      const weave = ((x + y) % 4 < 2 ? 0.94 : 1.04) * (0.95 + white(x, y, seed) * 0.08);
      o[0] *= weave; o[1] *= weave; o[2] *= weave;
    });
    return toTex(c, { repeat: [3, 2] });
  });
}

/** Large painted text texture for signs. Returns texture plus aspect. */
export function textTexture(text, {
  font = 'bold 120px "Arial Black", Impact, sans-serif', color = '#ffd76a', stroke = null, strokeWidth = 8,
  bg = null, padding = 40, glow = null, width = null, height = null, align = 'center',
} = {}) {
  const probe = makeCanvas(8).g;
  probe.font = font;
  const lines = String(text).split('\n');
  const size = parseInt(font.match(/(\d+)px/)[1], 10);
  const tw = Math.max(...lines.map((l) => probe.measureText(l).width));
  const W = width || Math.ceil(tw + padding * 2);
  const H = height || Math.ceil(size * 1.2 * lines.length + padding * 2);
  const { c, g } = makeCanvas(W, H);
  if (bg) { g.fillStyle = bg; g.fillRect(0, 0, W, H); }
  g.font = font; g.textAlign = align; g.textBaseline = 'middle';
  const x = align === 'center' ? W / 2 : padding;
  lines.forEach((l, i) => {
    const y = H / 2 + (i - (lines.length - 1) / 2) * size * 1.2;
    if (glow) { g.shadowColor = glow; g.shadowBlur = size * 0.35; }
    if (stroke) { g.lineJoin = 'round'; g.strokeStyle = stroke; g.lineWidth = strokeWidth; g.strokeText(l, x, y); }
    g.fillStyle = color; g.fillText(l, x, y);
    if (glow) { g.shadowBlur = 0; g.fillText(l, x, y); }
  });
  const t = toTex(c, { wrap: false });
  return { tex: t, aspect: W / H, canvas: c };
}

export function starfieldTexture() {
  return cached('starfield', () => {
    const S = 512;
    const { c, g } = makeCanvas(S);
    const gr = g.createLinearGradient(0, 0, 0, S);
    gr.addColorStop(0, '#0b0420'); gr.addColorStop(1, '#1a0636');
    g.fillStyle = gr; g.fillRect(0, 0, S, S);
    const rng = makeRng(77);
    for (let k = 0; k < 500; k++) {
      g.fillStyle = `rgba(255,255,255,${0.3 + rng() * 0.7})`;
      g.beginPath(); g.arc(rng() * S, rng() * S, rng() * 1.5 + 0.2, 0, TAU); g.fill();
    }
    for (let k = 0; k < 6; k++) {
      const x = rng() * S, y = rng() * S, r = 40 + rng() * 80;
      const ng = g.createRadialGradient(x, y, 0, x, y, r);
      ng.addColorStop(0, `hsla(${280 + rng() * 80},90%,60%,0.25)`); ng.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = ng; g.fillRect(0, 0, S, S);
    }
    return toTex(c);
  });
}

export { hex as colorHex, shade };
