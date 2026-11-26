import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { globalUniforms } from '../engine/materials.js';
import { hawaiianTexture, fabricTexture, makeCanvas, toTex } from '../engine/textures.js';
import { clamp, damp, lerp, TAU, makeRng } from '../engine/util.js';
import * as O from './outfits.js';

// ============================================================================
//  JELLY PEOPLE
//  A gummy, wobbling, googly-eyed casino patron built entirely in code.
//  - Body: smooth lathe "bean" (torso + head as one gummy blob) with a GPU
//    deform (lean / twist / squash / surface wobble) mirrored on the CPU so
//    attached parts (face, hat, collar) stay glued to the surface.
//  - Limbs: rubber-hose tubes that bend through 2-bone IK and start inside the
//    torso so they always connect seamlessly. Sleeves / shorts follow them.
//  - Googly eyes: pupils are simulated discs bouncing in a clear dome.
// ============================================================================

export const JELLY_COLORS = {
  lime: '#7ed957', strawberry: '#ff5470', blueberry: '#5b8cff', orange: '#ff9f2e', grape: '#a66bff',
  lemon: '#ffe14d', mint: '#4fe0b6', peach: '#ffb38a', cherry: '#e8233f', cola: '#a0522d', bubblegum: '#ff8fd0',
  sky: '#64d2ff', watermelon: '#ff6b81', apple: '#3ccf4e', tangerine: '#ff7b1c', berry: '#7a3cff', licorice: '#3a3440',
};

const TMPV = [...Array(12)].map(() => new THREE.Vector3());
const TMPQ = [...Array(4)].map(() => new THREE.Quaternion());
const UP = new THREE.Vector3(0, 1, 0);
const _hy = new THREE.Vector3(), _hx = new THREE.Vector3(), _hm = new THREE.Matrix4(), _eul = new THREE.Euler();

// ---------------------------------------------------------------------------
// Shader injection: body deform + fake subsurface scattering
// ---------------------------------------------------------------------------
const DEFORM_HEAD = /* glsl */`
uniform vec3 uBend; uniform vec2 uSquash; uniform float uY0; uniform float uH; uniform float uWobble; uniform float uPhase; uniform float uTime;
vec3 jellyRot(vec3 p, float a){ float c = cos(a), s = sin(a); return vec3(c*p.x + s*p.z, p.y, -s*p.x + c*p.z); }
`;
function injectJelly(mat, U, { deform, sss, sssColor, sssStrength = 1 }) {
  mat.userData.jellyU = U;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = globalUniforms.uTime;
    if (deform) {
      Object.assign(shader.uniforms, { uBend: U.uBend, uSquash: U.uSquash, uY0: U.uY0, uH: U.uH, uWobble: U.uWobble, uPhase: U.uPhase });
      shader.vertexShader = DEFORM_HEAD + shader.vertexShader
        .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
          { float jt = clamp((position.y - uY0) / (uH - uY0), 0.0, 1.0); objectNormal = jellyRot(objectNormal, uBend.y * jt); }`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          {
            float L = uH - uY0;
            float jt = clamp((transformed.y - uY0) / L, 0.0, 1.0);
            float sy = uSquash.x;
            float yy = transformed.y > uY0 ? uY0 + (transformed.y - uY0) * sy : transformed.y;
            float rs = mix(1.0, inversesqrt(max(sy, 0.3)), jt) * (1.0 + uSquash.y * smoothstep(0.0, 0.5, jt) * (1.0 - smoothstep(0.5, 1.0, jt)));
            vec3 p = vec3(transformed.x * rs, yy, transformed.z * rs);
            p = jellyRot(p, uBend.y * jt);
            p.x += uBend.x * jt * jt * L;
            p.z += uBend.z * jt * jt * L;
            float w = sin(uTime * 6.3 + transformed.y * 13.0 + uPhase) * sin(uTime * 4.7 + transformed.x * 11.0 + uPhase * 1.7);
            p += objectNormal * w * uWobble * (0.3 + jt);
            transformed = p;
          }`);
    }
    if (sss) {
      shader.uniforms.uSSS = { value: new THREE.Color(sssColor) };
      shader.uniforms.uSSSk = { value: sssStrength };
      shader.fragmentShader = 'uniform vec3 uSSS; uniform float uSSSk;\n' + shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          vec3 jV = normalize(vViewPosition);
          float jN = clamp(dot(normal, jV), 0.0, 1.0);
          float fres = pow(1.0 - jN, 2.2);
          float core = pow(jN, 3.0);
          totalEmissiveRadiance += uSSS * uSSSk * (0.01 + fres * 0.13 + core * 0.015);
        }`);
    }
  };
  mat.customProgramCacheKey = () => `jelly:${deform ? 1 : 0}:${sss ? 1 : 0}`;
  return mat;
}

function jellyMaterial(color, U, deform) {
  const c = new THREE.Color(color);
  const sss = c.clone().offsetHSL(0, 0.15, 0.08);
  const m = new THREE.MeshPhysicalMaterial({
    color: c, roughness: 0.22, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.06,
    specularIntensity: 1, ior: 1.45, sheen: 0.25, sheenColor: sss, sheenRoughness: 0.3, envMapIntensity: 1.1,
  });
  return injectJelly(m, U, { deform, sss: true, sssColor: sss, sssStrength: 1 });
}
function clothMaterial(map, U, deform, opts = {}) {
  const m = new THREE.MeshPhysicalMaterial(Object.assign({ map, roughness: 0.78, sheen: 0.6, sheenRoughness: 0.5, sheenColor: new THREE.Color(0.6, 0.6, 0.6), side: THREE.DoubleSide, envMapIntensity: 0.6 }, opts));
  return injectJelly(m, U, { deform, sss: false });
}

// Shared materials for eyes etc.
const SHARED = {};
function shared() {
  if (SHARED.ready) return SHARED;
  SHARED.eyeWhite = new THREE.MeshPhysicalMaterial({ color: 0xf4f4f0, roughness: 0.4, clearcoat: 0.3, emissive: 0xffffff, emissiveIntensity: 0.015 });
  SHARED.dome = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.0, metalness: 0, transparent: true, opacity: 0.22, envMapIntensity: 2.2, clearcoat: 1, clearcoatRoughness: 0, depthWrite: false, specularIntensity: 1 });
  SHARED.pupil = new THREE.MeshPhysicalMaterial({ color: 0x050505, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.1 });
  SHARED.mouth = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 });
  SHARED.cheek = new THREE.MeshBasicMaterial({ color: 0xff5a7a, transparent: true, opacity: 0.28, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 });
  SHARED.vcol = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.62, sheen: 0.4, sheenRoughness: 0.6, clearcoat: 0.15 });
  SHARED.vcolGloss = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.28, metalness: 0.25, clearcoat: 1, clearcoatRoughness: 0.12 });
  SHARED.vcolMetal = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.25, metalness: 1 });
  SHARED.glove = new THREE.MeshPhysicalMaterial({ color: 0xfbfbf6, roughness: 0.55, sheen: 0.6, sheenColor: new THREE.Color(1, 1, 1) });
  SHARED.ember = new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff5a10, emissiveIntensity: 3 });
  SHARED.blob = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, map: (() => {
    const { c, g } = makeCanvas(64); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(0,0,0,0.6)'); gr.addColorStop(0.5, 'rgba(0,0,0,0.3)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return toTex(c, { wrap: false });
  })() });
  for (const k in SHARED) if (SHARED[k] && SHARED[k].userData) SHARED[k].userData.shared = true;
  SHARED.ready = true;
  return SHARED;
}

// ---------------------------------------------------------------------------
// TubeSet: several bendy tubes in one dynamic geometry (one draw call)
// ---------------------------------------------------------------------------
class TubeSet {
  constructor(count, radial = 10, segs = 12) {
    this.count = count; this.R = radial; this.S = segs;
    const vpt = (segs + 1) * (radial + 1);
    this.vpt = vpt;
    const pos = new Float32Array(count * vpt * 3), nor = new Float32Array(count * vpt * 3), uv = new Float32Array(count * vpt * 2);
    const idx = [];
    for (let k = 0; k < count; k++) {
      const base = k * vpt;
      for (let s = 0; s <= segs; s++) for (let j = 0; j <= radial; j++) { const i = base + s * (radial + 1) + j; uv[i * 2] = j / radial; uv[i * 2 + 1] = s / segs; }
      for (let s = 0; s < segs; s++) for (let j = 0; j < radial; j++) {
        const a = base + s * (radial + 1) + j, b = a + radial + 1;
        idx.push(a, a + 1, b, b, a + 1, b + 1);
      }
    }
    const g = (this.geometry = new THREE.BufferGeometry());
    this.pos = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.nor = new THREE.BufferAttribute(nor, 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.pos); g.setAttribute('normal', this.nor); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.6);
    this._N = new THREE.Vector3(); this._B = new THREE.Vector3(); this._T = new THREE.Vector3(); this._P = new THREE.Vector3();
  }
  /** Quadratic bezier p0 -> (ctrl c) -> p2 over parameter range [t0,t1]. */
  set(k, p0, c, p2, r0, r1, t0 = 0, t1 = 1, flare = 0, upHint = UP) {
    const { R, S } = this; const P = this.pos.array, Nn = this.nor.array;
    const N = this._N, B = this._B, T = this._T, Pt = this._P;
    let o = k * this.vpt * 3;
    for (let s = 0; s <= S; s++) {
      const u = s / S, t = t0 + (t1 - t0) * u, it = 1 - t;
      Pt.set(it * it * p0.x + 2 * it * t * c.x + t * t * p2.x, it * it * p0.y + 2 * it * t * c.y + t * t * p2.y, it * it * p0.z + 2 * it * t * c.z + t * t * p2.z);
      T.set(2 * it * (c.x - p0.x) + 2 * t * (p2.x - c.x), 2 * it * (c.y - p0.y) + 2 * t * (p2.y - c.y), 2 * it * (c.z - p0.z) + 2 * t * (p2.z - c.z));
      if (T.lengthSq() < 1e-10) T.set(0, -1, 0); T.normalize();
      if (s === 0) { N.copy(upHint).cross(T); if (N.lengthSq() < 1e-6) N.set(1, 0, 0).cross(T); N.normalize(); }
      else { N.addScaledVector(T, -N.dot(T)).normalize(); }
      B.copy(T).cross(N);
      const r = r0 + (r1 - r0) * u + flare * u * u * u * u;
      for (let j = 0; j <= R; j++) {
        const a = (j / R) * TAU, ca = Math.cos(a), sa = Math.sin(a);
        const nx = N.x * ca + B.x * sa, ny = N.y * ca + B.y * sa, nz = N.z * ca + B.z * sa;
        P[o] = Pt.x + nx * r; P[o + 1] = Pt.y + ny * r; P[o + 2] = Pt.z + nz * r;
        Nn[o] = nx; Nn[o + 1] = ny; Nn[o + 2] = nz;
        o += 3;
      }
    }
  }
  commit() { this.pos.needsUpdate = true; this.nor.needsUpdate = true; }
}

/** Degenerate pole triangles can leave zero normals (-> NaN in shaders). */
export function fixZeroNormals(geo, midY = 0) {
  const n = geo.attributes.normal, p = geo.attributes.position;
  for (let i = 0; i < n.count; i++) {
    const x = n.getX(i), y = n.getY(i), z = n.getZ(i);
    if (!(x * x + y * y + z * z > 1e-8)) n.setXYZ(i, 0, p.getY(i) > midY ? 1 : -1, 0);
  }
  n.needsUpdate = true;
}

/** Several rigid parts with their own transforms, drawn as ONE mesh. */
class RigidSet {
  constructor(geos, material) {
    this.parts = geos.map((g) => this._base(g));
    const total = this.parts.reduce((a, p) => a + p.n, 0);
    const g = (this.geometry = new THREE.BufferGeometry());
    this.pos = new THREE.BufferAttribute(new Float32Array(total * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.nor = new THREE.BufferAttribute(new Float32Array(total * 3), 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.pos); g.setAttribute('normal', this.nor);
    if (this.parts[0].col) { this.col = new THREE.BufferAttribute(new Float32Array(total * 3), 3); g.setAttribute('color', this.col); }
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.8);
    let off = 0;
    for (const p of this.parts) { p.off = off; off += p.n; p.m = new THREE.Matrix4(); }
    this.writeColors();
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.frustumCulled = true;
    this._v = new THREE.Vector3(); this._n = new THREE.Matrix3();
  }
  _base(geo) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    return { n: g.attributes.position.count, p: g.attributes.position.array, nn: g.attributes.normal.array, col: g.attributes.color ? g.attributes.color.array : null };
  }
  setGeometry(i, geo) { const b = this._base(geo); const p = this.parts[i]; if (b.n !== p.n) return; p.p = b.p; p.nn = b.nn; if (b.col) { p.col = b.col; this.writeColors(); } }
  writeColors() { if (!this.col) return; for (const p of this.parts) if (p.col) this.col.array.set(p.col, (p.off || 0) * 3); if (this.col) this.col.needsUpdate = true; }
  update() {
    const P = this.pos.array, N = this.nor.array;
    for (const part of this.parts) {
      const e = part.m.elements;
      const n = this._n.getNormalMatrix(part.m).elements;
      let o = part.off * 3;
      const src = part.p, sn = part.nn;
      for (let i = 0; i < part.n * 3; i += 3, o += 3) {
        const x = src[i], y = src[i + 1], z = src[i + 2];
        P[o] = e[0] * x + e[4] * y + e[8] * z + e[12]; P[o + 1] = e[1] * x + e[5] * y + e[9] * z + e[13]; P[o + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
        const a = sn[i], b = sn[i + 1], c = sn[i + 2];
        let nx = n[0] * a + n[3] * b + n[6] * c, ny = n[1] * a + n[4] * b + n[7] * c, nz = n[2] * a + n[5] * b + n[8] * c;
        const l = Math.hypot(nx, ny, nz) || 1; N[o] = nx / l; N[o + 1] = ny / l; N[o + 2] = nz / l;
      }
    }
    this.pos.needsUpdate = true; this.nor.needsUpdate = true;
  }
}

// 2-bone IK: returns elbow position into `out`
const _ikD = new THREE.Vector3(), _ikDir = new THREE.Vector3(), _ikP = new THREE.Vector3();
function solveIK(root, target, a, b, pole, out) {
  const d = _ikD.subVectors(target, root);
  let L = d.length();
  const maxL = (a + b) * 0.999;
  if (L > maxL) { d.multiplyScalar(maxL / L); L = maxL; }
  if (L < 1e-4) { out.copy(root).addScaledVector(_ikP.copy(pole).normalize(), a); return out; }
  const dir = _ikDir.copy(d).divideScalar(L);
  const cosA = clamp((a * a + L * L - b * b) / (2 * a * L), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  const perp = _ikP.copy(pole).addScaledVector(dir, -pole.dot(dir));
  if (perp.lengthSq() < 1e-8) perp.set(0, 0, 1).addScaledVector(dir, -dir.z);
  perp.normalize();
  out.copy(root).addScaledVector(dir, a * cosA).addScaledVector(perp, a * sinA);
  return out;
}

// ---------------------------------------------------------------------------
// Expressions
// ---------------------------------------------------------------------------
export const EXPR = {
  neutral: { w: 0.055, o: 0.004, c: 0.006, a: 0.35, by: 0, ba: 0.05, t: 0 },
  happy: { w: 0.072, o: 0.022, c: 0.014, a: 0.12, by: 0.008, ba: -0.12, t: 1 },
  ecstatic: { w: 0.085, o: 0.062, c: 0.012, a: 0.14, by: 0.03, ba: -0.3, t: 1 },
  sad: { w: 0.05, o: 0.006, c: -0.014, a: 0.35, by: 0.006, ba: 0.45, t: 0 },
  shocked: { w: 0.038, o: 0.055, c: 0.0, a: 0.5, by: 0.035, ba: 0.05, t: 0 },
  angry: { w: 0.062, o: 0.014, c: -0.01, a: 0.45, by: -0.012, ba: -0.5, t: 2 },
  smug: { w: 0.06, o: 0.004, c: 0.016, a: 0.3, by: -0.004, ba: -0.2, t: 0 },
  grimace: { w: 0.08, o: 0.03, c: -0.003, a: 0.5, by: 0.02, ba: 0.35, t: 2 },
  worried: { w: 0.05, o: 0.012, c: -0.006, a: 0.5, by: 0.015, ba: 0.5, t: 0 },
  talk: { w: 0.06, o: 0.02, c: 0.008, a: 0.4, by: 0.006, ba: 0, t: 1 },
  focused: { w: 0.048, o: 0.004, c: -0.002, a: 0.35, by: -0.006, ba: -0.25, t: 0 },
};

// ---------------------------------------------------------------------------
// Random outfit generator
// ---------------------------------------------------------------------------
const SHIRT_BASES = ['#1e7fc2', '#e8323c', '#ffcc33', '#2bb673', '#ff7eb3', '#1c2b5a', '#f7f3e8', '#00a6a6', '#ff8c1a', '#6a3cc9', '#111827'];
const FLOWER_SETS = [['#ff5a7a', '#ffd23f', '#ffffff'], ['#ffffff', '#ff9f1c', '#2ec4b6'], ['#ff006e', '#ffbe0b', '#fb5607'], ['#f72585', '#ffffff', '#4cc9f0'], ['#ffd6a5', '#ff595e', '#ffffff']];
const HAT_COLS = ['#3b2a20', '#1a1a1a', '#7a4b26', '#d9c08c', '#c8102e', '#1b5fc8', '#f0f0f0', '#2bb673', '#ff7eb3', '#ffcc33'];

export function randomOutfit(seed, role = 'patron') {
  const r = makeRng(seed);
  const colors = Object.keys(JELLY_COLORS);
  const o = {
    seed,
    color: JELLY_COLORS[r.pick(colors)],
    scale: r.range(0.92, 1.1),
    girth: r.range(0.92, 1.15),
    belly: r.chance(0.35) ? r.range(0.02, 0.06) : r.range(0, 0.015),
    head: r.range(0.95, 1.12),
    eyeL: r.range(0.062, 0.078), eyeR: 0, eyeSep: r.range(0.33, 0.42),
    nose: r.chance(0.45) ? r.range(0.025, 0.045) : 0,
    cheeks: r.chance(0.6),
    shirt: { type: 'hawaiian', base: r.pick(SHIRT_BASES), flowers: r.pick(FLOWER_SETS), leaf: r.pick(['#1f8a3b', '#0b6e4f', '#2d6a4f', '#3a5a40', '#ffffff']), motif: r.pick(['hibiscus', 'hibiscus', 'pineapple', 'flamingo']), sleeves: 'short' },
    bottom: { type: r.chance(0.75) ? 'shorts' : 'pants', color: r.pick(['#c2a878', '#6b7b8c', '#2f3e46', '#d4c4a8', '#4a5d23', '#f1e7d0', '#1e3a5f']) },
    shoes: { type: r.pick(['sneaker', 'sneaker', 'loafer', 'flipflop', 'boot']), color: r.pick(['#e33', '#2a6', '#33d', '#f5f5f5', '#111', '#ff9900', '#7a4b26']) },
    hat: r.chance(0.85) ? { type: r.pick(['fedora', 'cowboy', 'tophat', 'bowler', 'cap', 'bucket', 'party', 'beanie', 'boater', 'sombrero', 'captain', 'propeller', 'viking', 'drinkhelmet', 'visor', 'fez', 'cap', 'fedora', 'bucket']), main: r.pick(HAT_COLS), band: r.pick(['#151010', '#c8102e', '#1b5fc8', '#ffffff', '#2bb673']), accent: r.pick(['#e8c25a', '#ffffff', '#ff3355', '#2a7de1']), tilt: r.range(-0.18, 0.18) } : null,
    acc: [],
  };
  o.eyeR = r.chance(0.3) ? o.eyeL * r.range(0.78, 1.25) : o.eyeL;
  if (r.chance(0.25)) o.shirt.type = r.pick(['polo', 'bowling', 'tee', 'tank']);
  if (o.shirt.type === 'tank') o.shirt.sleeves = 'none';
  const accPool = ['shades', 'cigar', 'chain', 'lei', 'camera', 'mustache', 'fanny', 'watch', 'earring'];
  for (const a of accPool) if (r.chance(0.17)) o.acc.push(a);
  if (o.hat && o.hat.type === 'sombrero' && !o.acc.includes('mustache')) o.acc.push('mustache');
  if (role === 'dealer') {
    Object.assign(o, { shirt: { type: 'dealer', base: '#f8f8f2', vest: r.pick(['#111111', '#5a0f1c', '#0d2b1e']), sleeves: 'long' }, bottom: { type: 'pants', color: '#151515' }, shoes: { type: 'loafer', color: '#111' }, gloves: true, acc: ['bowtie', 'nametag'] });
    o.hat = r.chance(0.5) ? { type: 'visor', main: '#1a1a1a', accent: '#1a6b3b', band: '#111', tilt: 0 } : null;
  } else if (role === 'bartender') {
    Object.assign(o, { shirt: { type: 'dealer', base: '#f8f8f2', vest: '#1a1a1a', sleeves: 'long' }, bottom: { type: 'pants', color: '#151515' }, shoes: { type: 'loafer', color: '#111' }, acc: ['bowtie', 'mustache'] });
    o.hat = null;
  } else if (role === 'security') {
    Object.assign(o, { shirt: { type: 'suit', base: '#ffffff', jacket: '#16161a', tie: '#111', sleeves: 'long' }, bottom: { type: 'pants', color: '#16161a' }, shoes: { type: 'loafer', color: '#0a0a0a' }, acc: ['shades', 'earpiece'], girth: 1.2, scale: 1.12 });
    o.hat = null;
  } else if (role === 'boss') {
    Object.assign(o, { shirt: { type: 'suit', base: '#1a1a1a', jacket: '#5b2a86', tie: '#e8c25a', sleeves: 'long' }, bottom: { type: 'pants', color: '#2b1540' }, shoes: { type: 'loafer', color: '#e8c25a' }, acc: ['cigar', 'chain', 'mustache', 'watch'], girth: 1.25, belly: 0.07 });
    o.hat = { type: 'fedora', main: '#e9e1d0', band: '#5b2a86', accent: '#e8c25a', tilt: -0.12 };
  } else if (role === 'waitress') {
    Object.assign(o, { shirt: { type: 'polo', base: '#c8102e', stripe: '#e8c25a', sleeves: 'short' }, bottom: { type: 'skirt', color: '#111' }, shoes: { type: 'loafer', color: '#111' }, acc: ['nametag', 'earring'] });
    o.hat = { type: 'party', main: '#c8102e', accent: '#e8c25a', extra: '#ffffff', tilt: 0.25 };
  }
  return o;
}

function shirtTexture(s) {
  switch (s.type) {
    case 'hawaiian': return hawaiianTexture(s.base, s.flowers, s.leaf, s.motif, s.seed || 1);
    case 'polo': return fabricTexture(s.stripe ? 'stripes' : 'solid', s.base, s.stripe || '#fff');
    case 'bowling': return fabricTexture('bowling', s.base, '#f7f3e8');
    case 'tee': return fabricTexture('solid', s.base, '#fff');
    case 'tank': return fabricTexture('vstripes', s.base, '#ffffff');
    case 'dealer': return fabricTexture('solid', s.base, '#fff');
    case 'suit': return fabricTexture('solid', s.base, '#fff');
    default: return fabricTexture('solid', s.base || '#888', '#fff');
  }
}

let vneckAlpha = null;
function vneckAlphaMap() {
  if (vneckAlpha) return vneckAlpha;
  const { c, g } = makeCanvas(256);
  g.fillStyle = '#fff'; g.fillRect(0, 0, 256, 256);
  g.fillStyle = '#000';
  // canvas y=0 is v=1 (top of shirt). Front of lathe is u=0 / u=1.
  g.beginPath(); g.moveTo(0, 0); g.lineTo(24, 0); g.lineTo(0, 78); g.closePath(); g.fill();
  g.beginPath(); g.moveTo(256, 0); g.lineTo(232, 0); g.lineTo(256, 78); g.closePath(); g.fill();
  vneckAlpha = toTex(c, { srgb: false, wrap: false });
  return vneckAlpha;
}

// ---------------------------------------------------------------------------
// The character
// ---------------------------------------------------------------------------
export class Jelly {
  constructor(outfit, opts = {}) {
    const o = (this.o = outfit);
    shared();
    this.root = new THREE.Group();
    this.root.name = 'jelly';
    this.root.scale.setScalar(o.scale);
    this.rng = makeRng(o.seed * 7 + 3);

    // per-character deform uniforms
    this.U = {
      uBend: { value: new THREE.Vector3() }, uSquash: { value: new THREE.Vector2(1, 0) },
      uY0: { value: 0.86 }, uH: { value: 1.75 }, uWobble: { value: 0.0035 }, uPhase: { value: this.rng() * 10 },
    };
    this.matBody = jellyMaterial(o.color, this.U, true);
    this.matLimb = jellyMaterial(o.color, this.U, false);

    this._buildBody();
    this._buildClothes();
    this._buildLimbs();
    this._buildFace();
    this._buildExtras();

    // shadow blob
    if (opts.blob !== false) {
      this.blob = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), SHARED.blob);
      this.blob.rotation.x = -Math.PI / 2; this.blob.position.y = 0.012; this.blob.renderOrder = 1;
      this.root.add(this.blob);
    }

    this._initState();
    this.root.traverse((m) => { if (m.isMesh) { m.receiveShadow = false; } });
    this.body.castShadow = true;
    this.update(0.016, 0, null);
  }

  // -------------------------------------------------------------- body
  _buildBody() {
    const o = this.o;
    const g = o.girth, hd = o.head;
    const headR = 0.205 * hd;
    const neckY = 1.285;
    const hc = neckY + headR * 1.02;
    const top = hc + headR * 1.04;
    this.dims = { headR, neckY, hc, top, y0: 0.86 };
    this.U.uH.value = top;
    const ctrl = [
      [0.0, 0.585], [0.1, 0.597], [0.18, 0.632], [0.212 * g, 0.7], [0.218 * g, 0.78],
      [0.213 * g, 0.86], [(0.226 + o.belly) * g, 0.97], [(0.232 + o.belly * 0.5) * g, 1.07], [0.226 * g, 1.15], [0.205 * g, 1.215],
      [0.168, neckY], [headR * 0.86, hc - headR * 0.72], [headR * 0.985, hc - headR * 0.3], [headR, hc + headR * 0.06],
      [headR * 0.95, hc + headR * 0.42], [headR * 0.76, hc + headR * 0.78], [headR * 0.42, hc + headR * 0.98], [0.0, top],
    ];
    const curve = new THREE.SplineCurve(ctrl.map((p) => new THREE.Vector2(p[0], p[1])));
    const pts = curve.getPoints(46).map((p) => new THREE.Vector2(Math.max(0, p.x), p.y));
    pts[0].x = 0; pts[pts.length - 1].x = 0;
    this.profile = pts;
    const geo = new THREE.LatheGeometry(pts, 34);
    geo.scale(1, 1, 0.86);
    geo.computeVertexNormals();
    fixZeroNormals(geo, (top + 0.585) / 2);
    this.body = new THREE.Mesh(geo, this.matBody);
    this.body.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.1, 0), 1.1);
    this.root.add(this.body);
    this.bodyGroup = this.body; // hips offset applied to the body mesh
  }
  /** Radius of the body surface at height y (pre-deform). */
  radiusAt(y) {
    const p = this.profile;
    for (let i = 1; i < p.length; i++) if (p[i].y >= y) { const a = p[i - 1], b = p[i]; return lerp(a.x, b.x, (y - a.y) / Math.max(1e-5, b.y - a.y)); }
    return 0;
  }
  /** A point on the body surface at height y and horizontal angle a (0 = front). */
  surface(y, a, out = new THREE.Vector3(), push = 0) {
    const r = this.radiusAt(y) + push;
    return out.set(Math.sin(a) * r, y, Math.cos(a) * r * 0.86);
  }

  // -------------------------------------------------------------- clothes
  _buildClothes() {
    const o = this.o, s = o.shirt;
    const tex = shirtTexture(s);
    const shirtTop = s.type === 'tank' ? 1.2 : 1.27;
    const hem = s.type === 'dealer' || s.type === 'suit' ? 0.72 : 0.68;
    const pts = [];
    for (let i = 0; i <= 26; i++) {
      const y = lerp(hem, shirtTop, i / 26);
      let r = this.radiusAt(y) + 0.014;
      if (i < 4) r += (4 - i) * 0.006; // hem flare
      if (s.type !== 'tank' && y > 1.15) r += 0.004;
      pts.push(new THREE.Vector2(r, y));
    }
    const geo = new THREE.LatheGeometry(pts, 32);
    geo.scale(1, 1, 0.86);
    const opts = {};
    if (s.type === 'hawaiian' || s.type === 'bowling') { opts.alphaMap = vneckAlphaMap(); opts.alphaTest = 0.5; }
    this.matShirt = clothMaterial(tex, this.U, true, opts);
    this.matSleeve = clothMaterial(tex, this.U, false);
    this.shirt = new THREE.Mesh(geo, this.matShirt);
    this.root.add(this.shirt);
    this.clothTops = [this.shirt];

    // Vest / jacket for staff
    if (s.type === 'dealer' || s.type === 'suit') {
      const vp = [];
      for (let i = 0; i <= 20; i++) { const y = lerp(hem - 0.02, 1.25, i / 20); vp.push(new THREE.Vector2(this.radiusAt(y) + 0.024 + (s.type === 'suit' ? 0.006 : 0), y)); }
      const open = s.type === 'suit' ? 0.42 : 0.5;
      const vg = new THREE.LatheGeometry(vp, 36, open, TAU - open * 2);
      vg.scale(1, 1, 0.86);
      const vcol = s.vest || s.jacket;
      const vm = clothMaterial(fabricTexture('solid', vcol, '#fff', 3), this.U, true, { roughness: s.type === 'suit' ? 0.55 : 0.6, sheen: 0.8 });
      this.vest = new THREE.Mesh(vg, vm);
      this.root.add(this.vest);
      this.clothTops.push(this.vest);
      if (s.type === 'suit') this.matSleeve = clothMaterial(fabricTexture('solid', s.jacket, '#fff', 3), this.U, false, { roughness: 0.55 });
    }

    // Bottoms
    const b = o.bottom;
    const btex = fabricTexture(b.type === 'pants' ? 'solid' : 'solid', b.color, '#fff', 5);
    const bp = [];
    if (b.type === 'skirt') {
      for (let i = 0; i <= 12; i++) { const y = lerp(0.5, 0.9, i / 12); bp.push(new THREE.Vector2(this.radiusAt(Math.max(y, 0.62)) + 0.02 + (1 - i / 12) * 0.09, y)); }
    } else {
      bp.push(new THREE.Vector2(0.06, 0.585));
      for (let i = 0; i <= 12; i++) { const y = lerp(0.6, 0.9, i / 12); bp.push(new THREE.Vector2(this.radiusAt(y) + 0.018, y)); }
    }
    const bg = new THREE.LatheGeometry(bp, 36); bg.scale(1, 1, 0.86);
    this.matPants = clothMaterial(btex, this.U, true, { roughness: 0.85 });
    this.matPantsLeg = clothMaterial(btex, this.U, false, { roughness: 0.85 });
    this.pants = new THREE.Mesh(bg, this.matPants);
    this.root.add(this.pants);
    // belt (only visible with tucked-in shirts)
    const tucked = ['dealer', 'suit', 'polo'].includes(o.shirt.type) || b.type === 'skirt';
    const belt = new THREE.Mesh(new THREE.TorusGeometry(this.radiusAt(0.88) + 0.02, 0.012, 6, 40), new THREE.MeshPhysicalMaterial({ color: 0x2a1a10, roughness: 0.35, clearcoat: 0.8 }));
    belt.rotation.x = Math.PI / 2; belt.scale.set(1, 0.86, 1); belt.position.y = 0.885;
    belt.userData.followHips = true; belt.userData.baseY = 0.885;
    if (tucked) this.root.add(belt);
    if (tucked && b.type !== 'skirt') {
      const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.03, 0.01), SHARED.vcolMetal);
      buckle.material = new THREE.MeshStandardMaterial({ color: 0xe8c25a, metalness: 1, roughness: 0.2 });
      buckle.position.set(0, 0.885, (this.radiusAt(0.88) + 0.03) * 0.86);
      buckle.userData.followHips = true; buckle.userData.baseY = 0.885;
      this.root.add(buckle);
    }
  }

  // -------------------------------------------------------------- limbs
  _buildLimbs() {
    const o = this.o;
    this.limbs = new TubeSet(4, 10, 12);
    this.limbMesh = new THREE.Mesh(this.limbs.geometry, this.matLimb);
    this.limbMesh.castShadow = false;
    this.root.add(this.limbMesh);
    const sl = o.shirt.sleeves;
    if (sl !== 'none') {
      this.sleeves = new TubeSet(2, 12, sl === 'long' ? 12 : 5);
      this.sleeveMesh = new THREE.Mesh(this.sleeves.geometry, this.matSleeve);
      this.root.add(this.sleeveMesh);
    }
    if (o.bottom.type !== 'skirt') {
      this.legwear = new TubeSet(2, 12, o.bottom.type === 'pants' ? 12 : 6);
      this.legwearMesh = new THREE.Mesh(this.legwear.geometry, this.matPantsLeg);
      this.root.add(this.legwearMesh);
    }
    this.armLen = [0.29, 0.27];
    this.legLen = [0.35, 0.33];
    this.armR = 0.058 * Math.sqrt(o.girth);
    this.legR = 0.07 * Math.sqrt(o.girth);

    // hands
    this.hands = {};
    this.handSet = new RigidSet([O.handGeometry('relaxed', -1), O.handGeometry('relaxed', 1)], o.gloves ? SHARED.glove : this.matLimb);
    this.root.add(this.handSet.mesh);
    for (const side of [-1, 1]) {
      const h = new THREE.Object3D();
      h.scale.setScalar(1.1);
      const hold = new THREE.Object3D(); hold.position.set(0, -0.035, 0.06); h.add(hold);
      this.root.add(h);
      this.hands[side] = { mesh: h, pose: 'relaxed', hold, idx: side < 0 ? 0 : 1 };
      if (o.gloves) { // little cuff
        const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.012, 6, 16), SHARED.glove);
        cuff.position.z = -0.005; h.add(cuff);
        this.detail && this.detail.push(cuff);
      }
    }
    // feet / shoes (both shoes in one draw call)
    this.feet = {};
    this.shoeSet = new RigidSet([O.shoeGeometry(o.shoes.type, o.shoes.color, -1), O.shoeGeometry(o.shoes.type, o.shoes.color, 1)], o.shoes.type === 'loafer' ? SHARED.vcolGloss : SHARED.vcol);
    this.root.add(this.shoeSet.mesh);
    for (const side of [-1, 1]) {
      const sh = new THREE.Object3D();
      this.root.add(sh);
      if (o.shoes.type === 'flipflop') { const f = new THREE.Mesh(O.footGeometry(), this.matLimb); sh.add(f); }
      this.feet[side] = sh;
    }
  }

  // -------------------------------------------------------------- face
  _buildFace() {
    const o = this.o, D = this.dims;
    const head = (this.head = new THREE.Object3D());
    head.position.set(0, D.hc, 0);
    this.root.add(head);
    this.attach = [{ obj: head, base: new THREE.Vector3(0, D.hc, 0), baseQ: new THREE.Quaternion() }];
    this.detail = [];

    // Eyes
    const eyeY = D.hc + D.headR * 0.16;
    this.eyes = [];
    const backs = [], domes = [];
    for (const side of [-1, 1]) {
      const R = side < 0 ? o.eyeL : o.eyeR;
      const ang = side * o.eyeSep * 1.1;
      const p = this.surface(eyeY + (side < 0 ? 0 : (o.eyeR - o.eyeL) * 0.3), ang, new THREE.Vector3(), 0.004);
      const nrm = new THREE.Vector3(Math.sin(ang), 0.12, Math.cos(ang) / 0.86).normalize();
      const frame = new THREE.Object3D();
      frame.position.copy(p).sub(head.position);
      frame.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), nrm);
      head.add(frame);
      frame.updateMatrix();
      const bk = new THREE.CylinderGeometry(R, R * 0.98, 0.012, 24); bk.rotateX(Math.PI / 2); bk.translate(0, 0, 0.004); bk.applyMatrix4(frame.matrix);
      backs.push(bk);
      const dm = new THREE.SphereGeometry(R * 1.02, 22, 6, 0, TAU, 0, Math.PI / 2); dm.rotateX(Math.PI / 2); dm.scale(1, 1, 0.5); dm.translate(0, 0, 0.009); dm.applyMatrix4(frame.matrix);
      domes.push(dm);
      const rp = R * 0.52;
      const pupil = new THREE.Object3D();
      pupil.position.z = 0.0125;
      pupil.userData.geo = new THREE.CylinderGeometry(rp, rp, 0.004, 18).rotateX(Math.PI / 2);
      frame.add(pupil);
      // a tiny specular glint on the pupil plastic
      this.eyes.push({ frame, pupil, R, rp, max: R * 0.9 - rp, p: new THREE.Vector2(0, -(R * 0.9 - rp)), v: new THREE.Vector2(), side });
    }
    head.add(new THREE.Mesh(mergeGeometries(backs.map((g) => g.toNonIndexed())), SHARED.eyeWhite));
    this.pupilSet = new RigidSet(this.eyes.map((e) => e.pupil.userData.geo), SHARED.pupil);
    this.pupilSet.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 0.4);
    head.add(this.pupilSet.mesh);
    const domeMesh = new THREE.Mesh(mergeGeometries(domes.map((g) => g.toNonIndexed())), SHARED.dome);
    domeMesh.renderOrder = 2;
    head.add(domeMesh);
    this.domeMesh = domeMesh;

    // Brows
    const browMat = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(o.color).multiplyScalar(0.35), roughness: 0.4, clearcoat: 0.6 });
    this.brows = [];
    for (const side of [-1, 1]) {
      const R = side < 0 ? o.eyeL : o.eyeR;
      const e = this.eyes[side < 0 ? 0 : 1];
      const b = new THREE.Mesh(new THREE.CapsuleGeometry(0.011, R * 0.75, 4, 8).rotateZ(Math.PI / 2), browMat);
      const base = e.frame.position.clone().add(new THREE.Vector3(0, R + 0.022, 0.006));
      b.position.copy(base);
      b.quaternion.copy(e.frame.quaternion);
      head.add(b);
      this.brows.push({ mesh: b, base, side });
    }

    // Mouth (dynamic strip geometry)
    const mouthY = D.hc - D.headR * 0.36;
    const mp = this.surface(mouthY, 0, new THREE.Vector3(), 0.003);
    this.mouthR = this.radiusAt(mouthY);
    this.mouth = this._makeMouth();
    this.mouth.position.copy(mp).sub(head.position);
    this.mouth.rotation.x = -0.12;
    head.add(this.mouth);

    // Nose
    if (o.nose) {
      const ny = D.hc - D.headR * 0.08;
      const np = this.surface(ny, 0, new THREE.Vector3(), -o.nose * 0.35);
      const nose = new THREE.Mesh(new THREE.SphereGeometry(o.nose, 16, 12), this.matLimb);
      nose.scale.set(1, 0.85, 0.9);
      nose.position.copy(np).sub(head.position);
      head.add(nose);
      this.detail.push(nose);
    }
    // Cheeks
    if (o.cheeks) {
      const parts = [];
      for (const side of [-1, 1]) {
        const a = side * 0.75, y = mouthY + 0.025;
        const p = this.surface(y, a, new THREE.Vector3(), 0.002).sub(head.position);
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(Math.sin(a), 0, Math.cos(a) / 0.86).normalize());
        parts.push(new THREE.CircleGeometry(0.03, 20).applyMatrix4(new THREE.Matrix4().compose(p, q, new THREE.Vector3(1.3, 0.8, 1))));
      }
      const c = new THREE.Mesh(mergeGeometries(parts), SHARED.cheek);
      head.add(c);
      this.detail.push(c);
    }
    // Hat
    if (o.hat) {
      const hat = new THREE.Mesh(O.hatGeometry(o.hat.type, o.hat), o.hat.type === 'crown' ? SHARED.vcolMetal : SHARED.vcol);
      const HAT_Y = { tophat: -0.045, party: -0.045, crown: -0.04, fez: -0.04, chef: -0.04, bucket: -0.015, beanie: -0.035, cap: -0.04, visor: -0.075, propeller: -0.04, drinkhelmet: -0.045, viking: -0.04, sombrero: -0.05, cowboy: -0.045 };
      const hatY = D.top - D.hc + (HAT_Y[o.hat.type] ?? -0.055);
      hat.position.set(0, hatY, -0.01);
      hat.rotation.z = o.hat.tilt || 0;
      hat.rotation.x = -0.06;
      hat.castShadow = false;
      head.add(hat);
      this.hat = hat;
      if (o.hat.type === 'propeller') {
        this.propeller = new THREE.Mesh(O.propellerGeometry(), SHARED.vcol);
        this.propeller.position.set(0, 0.155, 0);
        hat.add(this.propeller);
      }
    }
  }

  _makeMouth() {
    const N = 12;
    this.mouthN = N;
    // vertices: interior top (N+1), interior bottom (N+1), teeth top (2*(N+1)), teeth bottom (2*(N+1))
    const count = (N + 1) * 6;
    const pos = new Float32Array(count * 3), col = new Float32Array(count * 3);
    const idx = [];
    const dark = new THREE.Color('#2a0508'), tongue = new THREE.Color('#c23a4e'), tooth = new THREE.Color('#fffdf3');
    for (let i = 0; i <= N; i++) {
      const set = (k, c) => { col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b; };
      set(i, dark); set(N + 1 + i, tongue);
      set(2 * (N + 1) + i, tooth); set(3 * (N + 1) + i, tooth);
      set(4 * (N + 1) + i, tooth); set(5 * (N + 1) + i, tooth);
    }
    for (let i = 0; i < N; i++) {
      const strip = (a, b) => idx.push(a + i, b + i, a + i + 1, b + i, b + i + 1, a + i + 1);
      strip(0, N + 1); strip(2 * (N + 1), 3 * (N + 1)); strip(4 * (N + 1), 5 * (N + 1));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const nrm = g.attributes.normal; for (let i = 0; i < count; i++) nrm.setXYZ(i, 0, 0, 1);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 0.2);
    return new THREE.Mesh(g, SHARED.mouth);
  }

  _updateMouth(w, open, curve, a, teeth) {
    const N = this.mouthN, P = this.mouth.geometry.attributes.position.array, R = this.mouthR;
    const tH = Math.min(open * 0.38, 0.013);
    for (let i = 0; i <= N; i++) {
      const q = (i / N) * 2 - 1, x = q * w / 2;
      const e = Math.sqrt(Math.max(0, 1 - q * q));
      const base = curve * q * q;
      const top = base + open * a * e + 0.0015, bot = base - open * (1 - a) * e - 0.0015;
      const z = -0.43 * x * x / R;
      const set = (k, y, dz = 0) => { P[k * 3] = x; P[k * 3 + 1] = y; P[k * 3 + 2] = z + dz; };
      set(i, top); set(N + 1 + i, bot);
      const show = teeth >= 1 && open > 0.012 ? 1 : 0;
      set(2 * (N + 1) + i, top, 0.0008); set(3 * (N + 1) + i, top - tH * show * e, 0.0008);
      const showB = teeth >= 2 && open > 0.012 ? 1 : 0;
      set(4 * (N + 1) + i, bot + tH * 0.8 * showB * e, 0.0008); set(5 * (N + 1) + i, bot, 0.0008);
    }
    this.mouth.geometry.attributes.position.needsUpdate = true;
  }

  // -------------------------------------------------------------- extras
  _buildExtras() {
    const o = this.o, D = this.dims;
    const neck = new THREE.Object3D(); neck.position.set(0, 1.235, 0); this.root.add(neck);
    this.attach.push({ obj: neck, base: neck.position.clone(), baseQ: new THREE.Quaternion() });
    const chest = new THREE.Object3D(); chest.position.set(0, 1.05, 0); this.root.add(chest);
    this.attach.push({ obj: chest, base: chest.position.clone(), baseQ: new THREE.Quaternion() });
    const fz = (y, push = 0) => (this.radiusAt(y) + push) * 0.86;
    const s = o.shirt;

    // Collars
    if (s.type === 'hawaiian' || s.type === 'bowling' || s.type === 'polo') {
      const tex = shirtTexture(s);
      const cm = new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.8, side: THREE.DoubleSide, sheen: 0.5 });
      const flaps = [];
      for (const side of [-1, 1]) {
        const sh = new THREE.Shape();
        sh.moveTo(0, 0); sh.lineTo(0.075, 0.02); sh.lineTo(0.06, -0.07); sh.lineTo(0.01, -0.03); sh.closePath();
        const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.006, bevelEnabled: false }).toNonIndexed();
        const y = 1.26 - 1.235;
        geo.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(side * 0.02, y, fz(1.26, 0.012) - 0.02), new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.35, side * 0.55, 0)), new THREE.Vector3(side, 1, 1)));
        flaps.push(geo);
      }
      const fm = new THREE.Mesh(mergeGeometries(flaps), cm);
      neck.add(fm); this.detail.push(fm);
      if (s.type !== 'polo') {
        const bs = [];
        for (let i = 0; i < 4; i++) { const y = 1.08 - i * 0.11; bs.push(new THREE.CylinderGeometry(0.008, 0.008, 0.004, 10).rotateX(Math.PI / 2).translate(0, y - 1.05, fz(y, 0.017))); }
        const bm = new THREE.Mesh(mergeGeometries(bs), SHARED.buttonMat || (SHARED.buttonMat = new THREE.MeshPhysicalMaterial({ color: 0xf5ecd7, roughness: 0.3, clearcoat: 1 })));
        SHARED.buttonMat.userData.shared = true;
        chest.add(bm); this.detail.push(bm);
      }
    } else if (s.type === 'tee' || s.type === 'tank') {
      const t = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.012, 6, 32), new THREE.MeshPhysicalMaterial({ map: shirtTexture(s), roughness: 0.8 }));
      t.rotation.x = Math.PI / 2 + 0.15; t.scale.set(1, 0.86, 1); t.position.set(0, (s.type === 'tank' ? 1.2 : 1.265) - 1.235, 0.01);
      neck.add(t);
      if (s.type === 'tee') {
        // tourist tee print
        const { c, g } = makeCanvas(256, 128);
        g.fillStyle = 'rgba(0,0,0,0)'; g.fillRect(0, 0, 256, 128);
        g.font = 'bold 44px "Arial Black", Impact, sans-serif'; g.textAlign = 'center'; g.fillStyle = '#fff';
        g.fillText('I ♥', 128, 50); g.fillStyle = '#ffd34d'; g.fillText('GAMBLE', 128, 100);
        const pm = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.1), new THREE.MeshStandardMaterial({ map: toTex(c, { wrap: false }), transparent: true, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2 }));
        pm.position.set(0, 0.02, fz(1.07, 0.016)); chest.add(pm);
      }
    }
    if (s.type === 'dealer' || s.type === 'suit') {
      // shirt collar points + tie / bowtie
      const wm = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.6, side: THREE.DoubleSide });
      for (const side of [-1, 1]) {
        const sh = new THREE.Shape(); sh.moveTo(0, 0); sh.lineTo(0.045, 0.012); sh.lineTo(0.03, -0.045); sh.closePath();
        const m = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: 0.004, bevelEnabled: false }), wm);
        m.scale.set(side, 1, 1); m.position.set(side * 0.012, 1.262 - 1.235, fz(1.26, 0.014) - 0.012); m.rotation.set(-0.3, side * 0.4, 0);
        neck.add(m);
      }
      if (s.type === 'suit') {
        const tie = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.24, 0.008), new THREE.MeshPhysicalMaterial({ color: s.tie, roughness: 0.4, sheen: 1 }));
        tie.position.set(0, 1.12 - 1.05, fz(1.12, 0.02)); tie.rotation.x = -0.12; chest.add(tie);
        const knot = new THREE.Mesh(new THREE.SphereGeometry(0.02, 10, 8), tie.material); knot.position.set(0, 1.245 - 1.235, fz(1.245, 0.012)); neck.add(knot);
        // lapels
        const lm = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(s.jacket).multiplyScalar(0.8), roughness: 0.4, sheen: 1, side: THREE.DoubleSide });
        for (const side of [-1, 1]) {
          const sh = new THREE.Shape(); sh.moveTo(0, 0); sh.lineTo(0.06, 0.0); sh.lineTo(0.02, -0.2); sh.closePath();
          const m = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: 0.005, bevelEnabled: false }), lm);
          m.scale.set(side, 1, 1); m.position.set(side * 0.05, 1.2 - 1.05, fz(1.18, 0.03)); m.rotation.set(-0.2, side * 0.25, side * 0.1);
          chest.add(m);
        }
      }
    }
    for (const a of o.acc) {
      const before = this.root.children.length + neck.children.length + chest.children.length + this.head.children.length;
      void before;
      if (a === 'bowtie') { const m = new THREE.Mesh(O.bowTieGeometry(o.bowColor || '#b3122e'), SHARED.vcolGloss); m.position.set(0, 1.25 - 1.235, fz(1.25, 0.03)); neck.add(m); }
      if (a === 'chain') { const m = new THREE.Mesh(O.chainGeometry(), SHARED.vcolMetal); m.position.set(0, 0.0, 0.0); m.scale.set(1.15, 1, 1.12); neck.add(m); }
      if (a === 'lei') { const m = new THREE.Mesh(O.leiGeometry(), SHARED.vcol); m.position.set(0, 0.0, 0); m.scale.set(1.15, 1, 1.15); neck.add(m); }
      if (a === 'camera') { const m = new THREE.Mesh(O.cameraGeometry(), SHARED.vcolGloss); m.position.set(0.04, -0.06, fz(1.0, 0.05)); m.rotation.z = 0.1; chest.add(m); }
      if (a === 'nametag') { const m = new THREE.Mesh(O.nameTagGeometry(), SHARED.vcolMetal); m.position.set(0.09, 0.07, fz(1.12, 0.03)); m.rotation.y = 0.35; chest.add(m); }
      if (a === 'fanny') { const m = new THREE.Mesh(O.fannyPackGeometry(this.rng.pick(['#ff2d95', '#00c2ff', '#ffd400', '#7a3cff'])), SHARED.vcolGloss); m.position.set(0, 0.86, fz(0.86, 0.05)); m.userData.followHips = true; m.userData.baseY = 0.86; this.root.add(m); }
      if (a === 'shades') { const m = new THREE.Mesh(O.sunglassesGeometry(), SHARED.vcolGloss); const top = this.dims.top - this.dims.hc; m.position.set(0, top * 0.72, this.dims.headR * 0.55); m.rotation.x = -0.9; this.head.add(m); }
      if (a === 'mustache') { const m = new THREE.Mesh(O.mustacheGeometry(this.rng.pick(['#3a2414', '#111', '#d9d0c0', '#7a3b12'])), SHARED.vcolGloss); m.position.copy(this.mouth.position).add(new THREE.Vector3(0, 0.03, 0.012)); this.head.add(m); }
      if (a === 'cigar') {
        const m = new THREE.Mesh(O.cigarGeometry(), SHARED.vcol); m.position.copy(this.mouth.position).add(new THREE.Vector3(0.028, 0.0, 0.0)); m.rotation.set(0.25, 0.35, 0); this.head.add(m);
        const ember = new THREE.Mesh(new THREE.CylinderGeometry(0.0115, 0.0115, 0.006, 10).rotateX(Math.PI / 2), SHARED.ember); ember.position.set(0, 0, 0.122); m.add(ember);
        this.ember = ember;
      }
      if (a === 'earring') { const m = new THREE.Mesh(O.earringGeometry(), SHARED.vcolMetal); m.position.set(this.dims.headR * 0.98, -0.07, 0); m.rotation.y = Math.PI / 2; this.head.add(m); }
      if (a === 'earpiece') { const m = new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.004, 6, 12, Math.PI * 1.5), new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.4 })); m.position.set(this.dims.headR * 0.95, -0.02, 0); m.rotation.y = Math.PI / 2; this.head.add(m); }
      if (a === 'watch') { this.watch = new THREE.Mesh(O.watchGeometry(), SHARED.vcolMetal); this.hands[-1].mesh.add(this.watch); this.watch.position.set(0, 0, -0.03); this.watch.rotation.x = Math.PI / 2; this.watch.scale.setScalar(0.75); }
    }
    // small accessories disappear at distance (LOD)
    const keep = new Set([this.body, this.pants, this.shirt, this.vest, this.limbMesh, this.sleeveMesh, this.legwearMesh, this.handSet && this.handSet.mesh, this.shoeSet && this.shoeSet.mesh, this.hat, this.mouth, this.domeMesh, this.pupilSet && this.pupilSet.mesh]);
    for (const parent of [neck, chest, this.head, this.root]) for (const ch of parent.children) {
      if (!ch.isMesh || keep.has(ch) || this.detail.includes(ch)) continue;
      if (parent === this.head && (ch.material === SHARED.eyeWhite || ch.material === SHARED.mouth)) continue;
      if (ch.geometry && ch.geometry.type === 'PlaneGeometry' && parent === this.root) continue;
      if (this.brows.some((b) => b.mesh === ch)) continue;
      this.detail.push(ch);
    }
  }

  // -------------------------------------------------------------- state
  _initState() {
    const mk = () => ({
      handL: new THREE.Vector3(-0.28, 0.8, 0.04), handR: new THREE.Vector3(0.28, 0.8, 0.04),
      palmL: new THREE.Vector3(1, 0, 0), palmR: new THREE.Vector3(-1, 0, 0),
      footL: new THREE.Vector3(-0.11, 0.075, 0.02), footR: new THREE.Vector3(0.11, 0.075, 0.02),
      hips: 0, jump: 0, leanX: 0, leanZ: 0, twist: 0, squash: 1, puff: 0,
      mw: 0.055, mo: 0.004, mc: 0.006, ma: 0.35, by: 0, ba: 0, teeth: 0,
    });
    this.tgt = mk(); this.cur = mk();
    this.poseL = 'relaxed'; this.poseR = 'relaxed';
    this.mode = 'stand';
    this.seatHeight = 0.78;
    this.action = null; this.actionT = 0;
    this.expr = 'neutral'; this.exprUntil = 0;
    this.talking = 0;
    this.lookTarget = null;
    this.reach = { [-1]: null, [1]: null };
    this.phase = 0; this.speed = 0; this.walkW = 0;
    this.prevPos = new THREE.Vector3(); this.vel = new THREE.Vector3(); this.prevVel = new THREE.Vector3();
    this.jig = { x: 0, z: 0, vx: 0, vz: 0, s: 0, vs: 0 };
    this.time = this.rng() * 100;
    this.fidget = { t: 2 + this.rng() * 5, kind: null, dur: 0 };
    this.headWorld = new THREE.Vector3(); this.headPrev = new THREE.Vector3(); this.headVel = new THREE.Vector3(); this.headAcc = new THREE.Vector3();
    this.firstFrame = true;
    this.lod = 0;
    this.stepCb = null;
    this.lastStep = 0;
  }

  setAction(name, opts = {}) {
    if (this.action === name && !opts.restart) return;
    this.action = name; this.actionT = 0; this.actionOpts = opts;
  }
  setExpr(name, dur = 0) { this.expr = name; this.exprUntil = dur ? this.time + dur : 0; }
  say(dur = 1.5) { this.talking = dur; }
  setReach(side, worldPos, pose = 'open', palm = null) {
    if (!worldPos) { this.reach[side] = null; return; }
    this.reach[side] = { pos: worldPos.clone(), pose, palm };
  }
  hold(side, obj) {
    const h = this.hands[side];
    if (h.held) h.hold.remove(h.held);
    h.held = obj || null;
    if (obj) { h.hold.add(obj); this.poseHold = true; }
  }

  // -------------------------------------------------------------- update
  /**
   * @param dt seconds
   * @param camPos camera world position (for LOD) or null
   */
  update(dt, t, camPos) {
    if (!(dt > 0)) dt = 1e-3;
    dt = Math.min(dt, 0.05);
    this.time += dt;
    const T = this.tgt, C = this.cur, root = this.root;
    const tt = this.time;
    let dist = 0;
    if (camPos) { dist = camPos.distanceTo(root.position); this.lod = dist > 18 ? 2 : dist > 9 ? 1 : 0; }

    // ---- locomotion estimation from root motion
    if (this.firstFrame) { this.prevPos.copy(root.position); this.firstFrame = false; }
    const vx = (root.position.x - this.prevPos.x) / Math.max(dt, 1e-4), vz = (root.position.z - this.prevPos.z) / Math.max(dt, 1e-4);
    this.prevPos.copy(root.position);
    this.prevVel.copy(this.vel);
    this.vel.set(damp(this.vel.x, vx, 12, dt), 0, damp(this.vel.z, vz, 12, dt));
    const spd = Math.hypot(this.vel.x, this.vel.z) / this.o.scale;
    this.speed = spd;
    this.walkW = damp(this.walkW, this.mode === 'sit' ? 0 : clamp(spd / 0.9, 0, 1), 8, dt);
    const stride = 0.62;
    this.phase += (spd * dt / stride) * Math.PI;

    // ---- base pose
    const sway = Math.sin(tt * 1.3) * 0.012;
    const breathe = Math.sin(tt * 2.1) * 0.012;
    T.hips = 0; T.jump = 0; T.leanX = sway * 0.5; T.leanZ = 0; T.twist = 0; T.squash = 1 + breathe; T.puff = 0;
    T.handL.set(-0.285, 0.8 + breathe * 0.5, 0.03 + sway); T.handR.set(0.285, 0.8 + breathe * 0.5, 0.03 - sway);
    T.palmL.set(1, 0, 0.2); T.palmR.set(-1, 0, 0.2);
    let pl = 'relaxed', pr = 'relaxed';
    if (this.mode === 'sit') {
      T.hips = this.seatHeight - 0.6;
      const fy = this.seatHeight > 0.6 ? 0.32 : 0.075, fz = this.seatHeight > 0.6 ? 0.3 : 0.36;
      T.footL.set(-0.12, fy, fz); T.footR.set(0.12, fy, fz);
      T.handL.set(-0.2, 0.74 + T.hips, 0.2); T.handR.set(0.2, 0.74 + T.hips, 0.2);
      T.palmL.set(0.3, -1, 0); T.palmR.set(-0.3, -1, 0);
    } else {
      // stand -> walk blend for feet
      const w = this.walkW, p = this.phase;
      const amp = 0.17 * clamp(spd / 1.2, 0.5, 1.4);
      const lift = 0.09;
      const zl = Math.sin(p) * amp, zr = Math.sin(p + Math.PI) * amp;
      const yl = Math.max(0, Math.cos(p)) * lift, yr = Math.max(0, Math.cos(p + Math.PI)) * lift;
      T.footL.set(-0.11, 0.075 + yl * w, lerp(0.02, zl, w));
      T.footR.set(0.11, 0.075 + yr * w, lerp(0.02, zr, w));
      // body bob, lean and counter-rotation
      T.hips += -Math.abs(Math.sin(p)) * 0.035 * w + 0.018 * w;
      T.squash += Math.cos(p * 2) * 0.025 * w;
      T.leanZ += 0.07 * w * clamp(spd / 1.5, 0, 1.3);
      T.leanX += Math.sin(p) * 0.03 * w;
      T.twist += Math.sin(p) * 0.12 * w;
      T.handL.z += -Math.sin(p) * 0.2 * w; T.handR.z += Math.sin(p) * 0.2 * w;
      T.handL.y += Math.max(0, -Math.sin(p)) * 0.06 * w; T.handR.y += Math.max(0, Math.sin(p)) * 0.06 * w;
      // footsteps
      if (w > 0.4) {
        const stepIdx = Math.floor(p / Math.PI);
        if (stepIdx !== this.lastStep) { this.lastStep = stepIdx; this.jig.vs -= 0.6; if (this.stepCb) this.stepCb(this); }
      }
    }

    // ---- fidgets when idle
    if (!this.action && this.walkW < 0.1 && this.mode !== 'sit') {
      this.fidget.t -= dt;
      if (this.fidget.t <= 0 && !this.fidget.kind) {
        this.fidget.kind = this.rng.pick(['look', 'scratch', 'watch', 'shift', 'stretch', 'pockets', 'look']);
        this.fidget.dur = this.fidget.kind === 'stretch' ? 2.4 : 1.8 + this.rng() * 1.5; this.fidget.el = 0;
      }
      if (this.fidget.kind) {
        const f = this.fidget; f.el += dt;
        const k = Math.sin(clamp(f.el / f.dur, 0, 1) * Math.PI);
        if (f.kind === 'scratch') { T.handR.lerp(TMPV[5].set(0.12, this.dims.top - 0.08, 0.06), k); pr = 'relaxed'; T.handR.x += Math.sin(tt * 18) * 0.015 * k; T.palmR.set(0, -1, 0); }
        else if (f.kind === 'watch') { T.handL.lerp(TMPV[5].set(-0.08, 1.05, 0.28), k); T.palmL.set(0, -1, 0); T.leanZ += 0.06 * k; }
        else if (f.kind === 'shift') { T.leanX += 0.05 * k * (this.o.seed % 2 ? 1 : -1); }
        else if (f.kind === 'stretch') { T.handL.lerp(TMPV[5].set(-0.18, 1.85, -0.05), k); T.handR.lerp(TMPV[6].set(0.18, 1.85, -0.05), k); T.leanZ -= 0.1 * k; T.squash += 0.05 * k; pl = pr = 'open'; }
        else if (f.kind === 'pockets') { T.handL.lerp(TMPV[5].set(-0.24, 0.74, 0.1), k); T.handR.lerp(TMPV[6].set(0.24, 0.74, 0.1), k); pl = pr = 'fist'; }
        else if (f.kind === 'look') { T.twist += Math.sin(f.el * 2.2) * 0.5 * k; }
        if (f.el >= f.dur) { f.kind = null; f.t = 3 + this.rng() * 6; }
      }
    }

    // ---- action overlay
    let expr = this.expr;
    if (this.action) {
      this.actionT += dt;
      const r = ACTIONS[this.action];
      if (r) { const res = r(this, this.actionT, T, tt); if (res) { if (res.pl) pl = res.pl; if (res.pr) pr = res.pr; if (res.expr && !this.exprUntil) expr = res.expr; } }
    }
    if (this.exprUntil && tt > this.exprUntil) { this.exprUntil = 0; this.expr = 'neutral'; expr = this.action && ACTION_EXPR[this.action] ? ACTION_EXPR[this.action] : 'neutral'; }

    // ---- reach overrides (world targets -> local)
    for (const side of [-1, 1]) {
      const r = this.reach[side];
      if (!r) continue;
      const lp = root.worldToLocal(TMPV[7].copy(r.pos));
      (side < 0 ? T.handL : T.handR).copy(lp);
      if (r.palm) (side < 0 ? T.palmL : T.palmR).copy(r.palm);
      else (side < 0 ? T.palmL : T.palmR).set(0, -1, 0.3);
      if (side < 0) pl = r.pose; else pr = r.pose;
    }
    if (this.hands[-1].held) pl = this.hands[-1].holdPose || 'hold';
    if (this.hands[1].held) pr = this.hands[1].holdPose || 'hold';

    // ---- look at target -> twist
    if (this.lookTarget) {
      const lp = root.worldToLocal(TMPV[8].copy(this.lookTarget));
      const ang = Math.atan2(lp.x, lp.z);
      T.twist += clamp(ang, -0.9, 0.9) * 0.75;
    }

    // ---- expression targets
    const E = EXPR[expr] || EXPR.neutral;
    T.mw = E.w; T.mo = E.o; T.mc = E.c; T.ma = E.a; T.by = E.by; T.ba = E.ba; T.teeth = E.t;
    if (this.talking > 0) { this.talking -= dt; T.mo = Math.max(T.mo, 0.006 + Math.abs(Math.sin(tt * 13)) * 0.026 * (0.6 + 0.4 * Math.sin(tt * 4.1))); T.ma = 0.4; }

    // ---- smooth
    const k = 14;
    for (const key of ['handL', 'handR', 'palmL', 'palmR']) C[key].lerp(T[key], 1 - Math.exp(-k * dt));
    for (const key of ['footL', 'footR']) C[key].lerp(T[key], 1 - Math.exp(-(this.walkW > 0.3 ? 40 : 12) * dt));
    for (const key of ['hips', 'leanX', 'leanZ', 'twist', 'squash', 'puff', 'jump']) C[key] = damp(C[key], T[key], key === 'jump' ? 18 : 9, dt);
    for (const key of ['mw', 'mo', 'mc', 'ma', 'by', 'ba']) C[key] = damp(C[key], T[key], 16, dt);
    C.teeth = T.teeth;
    if (pl !== this.poseL) { this.poseL = pl; this.handSet.setGeometry(0, O.handGeometry(pl, -1)); }
    if (pr !== this.poseR) { this.poseR = pr; this.handSet.setGeometry(1, O.handGeometry(pr, 1)); }

    // ---- jiggle springs (secondary motion)
    const J = this.jig;
    const ax = (this.vel.x - this.prevVel.x) / Math.max(dt, 1e-4), az = (this.vel.z - this.prevVel.z) / Math.max(dt, 1e-4);
    const yaw = root.rotation.y, cy = Math.cos(yaw), sy = Math.sin(yaw);
    const lax = cy * ax - sy * az, laz = sy * ax + cy * az; // world -> local acceleration
    const stiff = 90, damping = 7;
    J.vx += (-stiff * J.x - damping * J.vx - lax * 0.05) * dt; J.x += J.vx * dt;
    J.vz += (-stiff * J.z - damping * J.vz - laz * 0.05) * dt; J.z += J.vz * dt;
    J.vs += (-140 * J.s - 9 * J.vs) * dt; J.s += J.vs * dt;
    J.x = clamp(J.x, -0.25, 0.25); J.z = clamp(J.z, -0.25, 0.25); J.s = clamp(J.s, -0.2, 0.2);

    const bx = C.leanX + J.x, bz = C.leanZ + J.z, tw = C.twist;
    const sq = C.squash + J.s;
    this.U.uBend.value.set(bx, tw, bz);
    this.U.uSquash.value.set(sq, C.puff);

    // ---- apply body offset (sitting / jumping)
    const hip = C.hips, jump = C.jump;
    const yOff = hip + jump;
    for (const m of [this.body, this.pants, ...this.clothTops]) m.position.y = yOff;
    for (const ch of this.root.children) if (ch.userData.followHips) ch.position.y = ch.userData.baseY + yOff;

    // ---- attachments follow the deform
    for (const a of this.attach) this._deformAttach(a, bx, tw, bz, sq, yOff);

    // ---- limbs
    this._updateLimbs(bx, tw, bz, sq, yOff, jump);

    // ---- face
    if (this.lod < 2 || (Math.floor(tt * 30) % 2 === 0)) {
      this._updateMouth(C.mw, C.mo, C.mc, C.ma, C.teeth);
      for (const b of this.brows) {
        b.mesh.position.set(b.base.x, b.base.y + C.by, b.base.z);
        b.mesh.rotation.z = -b.side * C.ba;
      }
    }
    if (this.lod !== this._lodApplied) {
      this._lodApplied = this.lod;
      for (const b of this.brows) b.mesh.visible = this.lod < 1;
      for (const d of this.detail) d.visible = this.lod < 1;
      this.domeMesh.visible = this.lod < 1;
      this.pupilSet.mesh.visible = this.lod < 2;
      this.mouth.visible = this.lod < 2;
      if (this.sleeveMesh) this.sleeveMesh.castShadow = false;
    }
    this._updateEyes(dt);
    if (this.propeller) this.propeller.rotation.y += dt * (6 + spd * 20);
    if (this.ember) this.ember.material.emissiveIntensity = 2.5 + Math.sin(tt * 3) * 1.2;
    if (this.blob) this.blob.scale.setScalar(1 - Math.min(0.4, jump * 1.5));
    this.jumpH = jump;
  }

  _deformAttach(a, bx, tw, bz, sq, yOff) {
    const D = this.dims, L = D.top - D.y0;
    const p = a.base;
    const t = clamp((p.y - D.y0) / L, 0, 1);
    const yy = p.y > D.y0 ? D.y0 + (p.y - D.y0) * sq : p.y;
    const rs = lerp(1, 1 / Math.sqrt(Math.max(sq, 0.3)), t);
    let x = p.x * rs, z = p.z * rs;
    const ang = tw * t, c = Math.cos(ang), s = Math.sin(ang);
    const rx = c * x + s * z, rz = -s * x + c * z;
    a.obj.position.set(rx + bx * t * t * L, yy + yOff, rz + bz * t * t * L);
    const q = TMPQ[0].setFromAxisAngle(UP, ang);
    const tilt = TMPQ[1].setFromEuler(_eul.set(Math.atan(2 * bz * t), 0, -Math.atan(2 * bx * t)));
    a.obj.quaternion.copy(tilt).multiply(q).multiply(a.baseQ);
  }

  _deformPoint(p, out, bx, tw, bz, sq, yOff) {
    const D = this.dims, L = D.top - D.y0;
    const t = clamp((p.y - D.y0) / L, 0, 1);
    const yy = p.y > D.y0 ? D.y0 + (p.y - D.y0) * sq : p.y;
    const rs = lerp(1, 1 / Math.sqrt(Math.max(sq, 0.3)), t);
    const x = p.x * rs, z = p.z * rs;
    const ang = tw * t, c = Math.cos(ang), s = Math.sin(ang);
    return out.set(c * x + s * z + bx * t * t * L, yy + yOff, -s * x + c * z + bz * t * t * L);
  }

  _updateLimbs(bx, tw, bz, sq, yOff, jump) {
    const C = this.cur;
    const sh = TMPV[2], el = TMPV[3], ctrl = TMPV[4];
    const shoulderY = 1.165, hipY = 0.73;
    const sl = this.o.shirt.sleeves;
    for (const side of [-1, 1]) {
      const i = side < 0 ? 0 : 1;
      // ---- arm
      const rS = this.radiusAt(shoulderY);
      this._deformPoint(TMPV[9].set(side * (rS - 0.045), shoulderY, -0.01), sh, bx, tw, bz, sq, yOff);
      const hand = side < 0 ? C.handL : C.handR;
      const handT = TMPV[10].copy(hand);
      handT.y += C.jump;
      const pole = TMPV[11].set(side * 0.7, -0.35, -1);
      solveIK(sh, handT, this.armLen[0], this.armLen[1], pole, el);
      // stretchy rubber-hose: if the target is further than reach, let the hand stretch there anyway
      const wrist = handT;
      ctrl.copy(el).multiplyScalar(2).addScaledVector(sh, -0.5).addScaledVector(wrist, -0.5);
      this.limbs.set(i, sh, ctrl, wrist, this.armR, this.armR * 0.82, 0, 1, 0, TMPV[9].set(0, 0, 1));
      if (this.sleeves) {
        const len = sl === 'long' ? 0.93 : 0.4;
        this.sleeves.set(i, sh, ctrl, wrist, this.armR + 0.026, this.armR + (sl === 'long' ? 0.008 : 0.024), 0, len, sl === 'long' ? 0 : 0.012, TMPV[9].set(0, 0, 1));
      }
      // hand orientation
      const h = this.hands[side];
      const dir = TMPV[5].subVectors(wrist, ctrl).normalize();
      const palm = TMPV[6].copy(side < 0 ? C.palmL : C.palmR).normalize();
      const yv = _hy.copy(palm).addScaledVector(dir, -palm.dot(dir)).multiplyScalar(-1);
      if (yv.lengthSq() < 1e-6) yv.set(0, 1, 0); yv.normalize();
      const xv = _hx.crossVectors(yv, dir);
      _hm.makeBasis(xv, yv, dir);
      h.mesh.quaternion.setFromRotationMatrix(_hm);
      h.mesh.position.copy(wrist).addScaledVector(dir, -0.012);

      // ---- leg
      const hip = TMPV[7].set(side * 0.1 * this.o.girth, hipY + yOff, 0.0);
      const foot = TMPV[8].copy(side < 0 ? C.footL : C.footR);
      foot.y += jump;
      const kpole = TMPV[0].set(side * 0.15, 0, 1);
      const kneeOut = this._kneeOut || (this._kneeOut = new THREE.Vector3());
      solveIK(hip, foot, this.legLen[0], this.legLen[1], kpole, kneeOut);
      const lctrl = (this._lctrl || (this._lctrl = new THREE.Vector3())).copy(kneeOut).multiplyScalar(2).addScaledVector(hip, -0.5).addScaledVector(foot, -0.5);
      this.limbs.set(2 + i, hip, lctrl, foot, this.legR, this.legR * 0.8, 0, 1, 0, TMPV[9].set(1, 0, 0));
      if (this.legwear) {
        const len = this.o.bottom.type === 'pants' ? 0.97 : 0.46;
        this.legwear.set(i, hip, lctrl, foot, this.legR + 0.03, this.legR + (len > 0.9 ? 0.012 : 0.035), 0, len, len > 0.9 ? 0.01 : 0.01, TMPV[9].set(1, 0, 0));
      }
      // shoe
      const shoe = this.feet[side];
      shoe.position.copy(foot);
      const lift = foot.y - 0.075 - jump;
      const sitting = this.mode === 'sit';
      shoe.rotation.set(sitting ? -0.15 : clamp(lift * 2.4, -0.4, 0.45), side * 0.08, 0);
    }
    this.limbs.commit();
    for (const side of [-1, 1]) {
      const hm = this.hands[side].mesh; hm.updateMatrix(); this.handSet.parts[side < 0 ? 0 : 1].m.copy(hm.matrix);
      const fm = this.feet[side]; fm.updateMatrix(); this.shoeSet.parts[side < 0 ? 0 : 1].m.copy(fm.matrix);
    }
    this.handSet.update(); this.shoeSet.update();
    if (this.sleeves) this.sleeves.commit();
    if (this.legwear) this.legwear.commit();
  }

  _updateEyes(dt) {
    // world-space head acceleration drives the pupils
    this.head.getWorldPosition(this.headWorld);
    if (dt > 0) {
      const vx = (this.headWorld.x - this.headPrev.x) / dt, vy = (this.headWorld.y - this.headPrev.y) / dt, vz = (this.headWorld.z - this.headPrev.z) / dt;
      const ax = (vx - this.headVel.x) / dt, ay = (vy - this.headVel.y) / dt, az = (vz - this.headVel.z) / dt;
      this.headAcc.set(clamp(ax, -60, 60), clamp(ay, -60, 60), clamp(az, -60, 60));
      this.headVel.set(vx, vy, vz);
    }
    this.headPrev.copy(this.headWorld);
    if (this.lod >= 2) return;
    const g = TMPV[0], q = TMPQ[2];
    for (const e of this.eyes) {
      e.frame.getWorldQuaternion(q).invert();
      // effective acceleration in eye space: gravity minus head acceleration
      g.set(-this.headAcc.x * 0.9, -6.5 - this.headAcc.y * 0.9, -this.headAcc.z * 0.9).applyQuaternion(q);
      e.v.x += g.x * dt * 0.55; e.v.y += g.y * dt * 0.55;
      // a dash of personality: random tiny nudges
      if (this.rng() < 0.01) { e.v.x += (this.rng() - 0.5) * 0.4; e.v.y += this.rng() * 0.3; }
      const fr = Math.exp(-2.2 * dt);
      e.v.multiplyScalar(fr);
      e.p.addScaledVector(e.v, dt);
      const l = e.p.length();
      if (l > e.max) {
        const nx = e.p.x / l, ny = e.p.y / l;
        e.p.set(nx * e.max, ny * e.max);
        const vn = e.v.x * nx + e.v.y * ny;
        if (vn > 0) { e.v.x -= (1 + 0.45) * vn * nx; e.v.y -= (1 + 0.45) * vn * ny; e.v.multiplyScalar(0.85); }
      }
      e.pupil.position.x = e.p.x; e.pupil.position.y = e.p.y;
    }
    this.eyes.forEach((e, i) => { e.pupil.updateMatrix(); e.frame.updateMatrix(); this.pupilSet.parts[i].m.multiplyMatrices(e.frame.matrix, e.pupil.matrix); });
    this.pupilSet.update();
  }

  dispose() {
    this.root.traverse((o) => {
      if (o.isMesh) {
        if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
        const ms = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of ms) if (m && !m.userData.shared) m.dispose();
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Upper-body actions. Each writes into the target pose T. Coordinates are in
// unscaled character space (feet at 0, +Z forward, +X = character's left? no:
// +X is the side where `side = +1` limbs live).
// ---------------------------------------------------------------------------
const ACTION_EXPR = { cheer: 'ecstatic', despair: 'sad', clap: 'happy', dance: 'happy', angry: 'angry', shocked: 'shocked', think: 'focused', play: 'focused' };
const ACTIONS = {
  cheer(c, t, T) {
    const k = Math.sin(t * 11);
    T.handL.set(-0.3 + k * 0.03, 1.85 + k * 0.06, 0.06); T.handR.set(0.3 - k * 0.03, 1.85 - k * 0.06, 0.06);
    T.palmL.set(0.2, 0, 1); T.palmR.set(-0.2, 0, 1);
    if (c.mode !== 'sit') T.jump = Math.max(0, Math.sin(t * 7.5)) * 0.16;
    else T.hips += Math.max(0, Math.sin(t * 7.5)) * 0.03;
    T.squash += Math.cos(t * 15) * 0.06; T.leanZ -= 0.05;
    return { pl: 'open', pr: 'open', expr: 'ecstatic' };
  },
  fistpump(c, t, T) {
    const k = Math.max(0, Math.sin(t * 9));
    T.handR.set(0.22, 1.45 + k * 0.4, 0.15); T.palmR.set(-1, 0, 0.3);
    T.squash += k * 0.04;
    return { pr: 'fist', expr: 'ecstatic' };
  },
  despair(c, t, T) {
    T.handL.set(-0.16, c.dims.top - 0.02, 0.05); T.handR.set(0.16, c.dims.top - 0.02, 0.05);
    T.palmL.set(0.6, -0.8, 0); T.palmR.set(-0.6, -0.8, 0);
    T.leanZ += 0.18 + Math.sin(t * 2) * 0.02; T.squash -= 0.06; T.leanX += Math.sin(t * 3) * 0.04;
    return { pl: 'open', pr: 'open', expr: 'sad' };
  },
  facepalm(c, t, T) {
    T.handR.set(0.02, c.dims.hc + 0.02, 0.26); T.palmR.set(0, 0, -1); T.leanZ += 0.12;
    return { pr: 'open', expr: 'sad' };
  },
  clap(c, t, T) {
    const k = Math.abs(Math.sin(t * 9));
    T.handL.set(-0.02 - k * 0.11, 1.1, 0.3); T.handR.set(0.02 + k * 0.11, 1.1, 0.3);
    T.palmL.set(1, 0, 0); T.palmR.set(-1, 0, 0);
    return { pl: 'open', pr: 'open', expr: 'happy' };
  },
  wave(c, t, T) {
    T.handR.set(0.38 + Math.sin(t * 9) * 0.1, 1.72, 0.1); T.palmR.set(0, 0, 1);
    return { pr: 'open', expr: 'happy' };
  },
  dance(c, t, T) {
    const b = Math.sin(t * 6.5);
    T.leanX += b * 0.12; T.twist += Math.sin(t * 3.25) * 0.4; T.squash += Math.abs(b) * 0.06 - 0.02;
    T.handL.set(-0.35, 1.2 + Math.max(0, b) * 0.6, 0.15); T.handR.set(0.35, 1.2 + Math.max(0, -b) * 0.6, 0.15);
    T.palmL.set(0, 0, 1); T.palmR.set(0, 0, 1);
    if (c.mode !== 'sit') { T.footL.y += Math.max(0, b) * 0.08; T.footR.y += Math.max(0, -b) * 0.08; T.jump = Math.abs(b) * 0.03; }
    return { pl: 'peace', pr: 'open', expr: 'happy' };
  },
  drink(c, t, T) {
    const cyc = t % 5, up = cyc > 3.6 && cyc < 4.8;
    if (up) { T.handR.set(0.05, c.dims.hc - 0.06, 0.24); T.leanZ -= 0.08; } else { T.handR.set(0.22, 1.0, 0.25); }
    T.palmR.set(-1, 0, 0);
    c.hands[1].holdPose = 'hold';
    return { expr: up ? 'neutral' : 'happy' };
  },
  polish(c, t, T) {
    T.handL.set(-0.08, 1.05, 0.32); T.palmL.set(1, 0, 0);
    T.handR.set(-0.03 + Math.cos(t * 7) * 0.05, 1.1 + Math.sin(t * 7) * 0.05, 0.34); T.palmR.set(-1, 0, 0);
    return { pl: 'hold', pr: 'open', expr: 'neutral' };
  },
  shake(c, t, T) {
    const k = Math.sin(t * 22) * 0.07;
    T.handL.set(-0.04, 1.35 + k, 0.28); T.handR.set(0.04, 1.45 + k, 0.28);
    T.palmL.set(1, 0, 0); T.palmR.set(-1, 0, 0);
    return { pl: 'hold', pr: 'hold', expr: 'focused' };
  },
  deal(c, t, T) {
    // idle dealer stance: hands near the table edge, occasional tidy-up motions
    const k = Math.sin(t * 1.3);
    T.handL.set(-0.2, 0.98, 0.34 + k * 0.02); T.handR.set(0.2 + Math.sin(t * 0.7) * 0.05, 0.98, 0.36);
    T.palmL.set(0, -1, 0); T.palmR.set(0, -1, 0); T.leanZ += 0.06;
    return { pl: 'relaxed', pr: 'relaxed' };
  },
  shuffle(c, t, T) {
    const k = Math.sin(t * 14) * 0.03;
    T.handL.set(-0.07 - k, 0.99, 0.36); T.handR.set(0.07 + k, 0.99, 0.36);
    T.palmL.set(0.5, -1, 0); T.palmR.set(-0.5, -1, 0); T.leanZ += 0.08;
    return { pl: 'hold', pr: 'hold', expr: 'focused' };
  },
  talk(c, t, T) {
    const a = Math.sin(t * 3.1), b = Math.sin(t * 2.3 + 1);
    T.handL.set(-0.24 - a * 0.05, 1.0 + Math.max(0, a) * 0.12, 0.22); T.handR.set(0.24 + b * 0.05, 1.0 + Math.max(0, b) * 0.14, 0.22);
    T.palmL.set(0.4, 0.6, 0.6); T.palmR.set(-0.4, 0.6, 0.6);
    c.talking = Math.max(c.talking, 0.2);
    return { pl: 'open', pr: 'open', expr: 'talk' };
  },
  think(c, t, T) {
    T.handR.set(0.05, c.dims.hc - 0.14, 0.2); T.palmR.set(-0.5, 1, 0); T.handL.set(-0.12, 1.0, 0.18); T.palmL.set(0.5, 1, 0);
    T.leanX += 0.04;
    return { pr: 'fist', pl: 'relaxed', expr: 'focused' };
  },
  point(c, t, T) {
    T.handR.set(0.25, 1.35, 0.5); T.palmR.set(-1, 0, 0);
    return { pr: 'point', expr: 'happy' };
  },
  shrug(c, t, T) {
    const k = Math.min(1, t * 3);
    T.handL.set(-0.38, 1.05, 0.15); T.handR.set(0.38, 1.05, 0.15); T.palmL.set(0, 1, 0.3); T.palmR.set(0, 1, 0.3);
    T.squash -= 0.05 * k;
    return { pl: 'open', pr: 'open', expr: 'worried' };
  },
  thumbsup(c, t, T) {
    T.handR.set(0.25, 1.25, 0.32); T.palmR.set(-1, 0, 0);
    return { pr: 'thumbsup', expr: 'happy' };
  },
  tray(c, t, T) {
    T.handL.set(-0.28, 1.42, 0.22); T.palmL.set(0, 1, 0);
    return { pl: 'open' };
  },
  phone(c, t, T) {
    T.handR.set(0.2, c.dims.hc, 0.02); T.palmR.set(-1, 0, 0);
    c.talking = Math.max(c.talking, 0.1);
    return { pr: 'hold', expr: 'talk' };
  },
  angry(c, t, T) {
    const k = Math.sin(t * 12);
    T.handL.set(-0.25, 1.25 + k * 0.05, 0.25); T.handR.set(0.25, 1.25 - k * 0.05, 0.25);
    T.leanZ += 0.08; T.squash += Math.abs(k) * 0.03;
    return { pl: 'fist', pr: 'fist', expr: 'angry' };
  },
  shocked(c, t, T) {
    T.handL.set(-0.1, c.dims.hc - 0.12, 0.26); T.handR.set(0.1, c.dims.hc - 0.12, 0.26);
    T.palmL.set(0, 0, -1); T.palmR.set(0, 0, -1); T.leanZ -= 0.08; T.squash += 0.04;
    return { pl: 'open', pr: 'open', expr: 'shocked' };
  },
  play(c, t, T) {
    // seated at a machine: hands near the button deck
    T.handL.set(-0.13, 1.0 + c.cur.hips * 0.6, 0.38); T.handR.set(0.15 + Math.sin(t * 0.8) * 0.02, 1.0 + c.cur.hips * 0.6, 0.4);
    T.palmL.set(0, -1, 0.2); T.palmR.set(0, -1, 0.2); T.leanZ += 0.1;
    return { pl: 'relaxed', pr: 'point', expr: 'focused' };
  },
  sitIdle(c, t, T) {
    T.handL.set(-0.15, 0.85 + c.cur.hips, 0.25); T.handR.set(0.15, 0.85 + c.cur.hips, 0.25);
    return {};
  },
  cards(c, t, T) {
    T.handL.set(-0.1, 1.0, 0.36); T.handR.set(0.12, 0.98, 0.38); T.palmL.set(0.3, -1, 0); T.palmR.set(0, -1, 0);
    T.leanZ += 0.08;
    return { pl: 'hold', pr: 'relaxed', expr: 'focused' };
  },
  count(c, t, T) {
    T.handL.set(-0.08, 1.02, 0.3); T.handR.set(0.06, 1.04 + Math.abs(Math.sin(t * 8)) * 0.03, 0.31);
    T.palmL.set(0, 1, 0); T.palmR.set(0, -1, 0);
    return { pl: 'hold', pr: 'pinch', expr: 'smug' };
  },
  guard(c, t, T) {
    T.handL.set(-0.08, 0.86, 0.2); T.handR.set(0.08, 0.86, 0.22); T.palmL.set(1, 0, 0); T.palmR.set(-1, 0, 0);
    return { pl: 'relaxed', pr: 'fist', expr: 'focused' };
  },
};
export { ACTIONS };
