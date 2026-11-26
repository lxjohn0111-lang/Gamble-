import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { TAU } from '../engine/util.js';

// Hats, shoes, hands and accessories are built from primitives, coloured with
// vertex colours and merged so each item is a single draw call.

const geoCache = new Map();
function cached(key, fn) { if (!geoCache.has(key)) { const g = fn(); g.userData.shared = true; geoCache.set(key, g); } return geoCache.get(key); }

function prep(geo, color, matrix) {
  let g = geo.index ? geo.toNonIndexed() : geo.clone();
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  if (matrix) g.applyMatrix4(matrix);
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}
const M4 = (x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
const lathe = (pts, seg = 28) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);
function merge(parts) { const g = mergeGeometries(parts, false); parts.forEach((p) => p.dispose()); g.computeBoundingSphere(); return g; }

/** Brim ring with optional curl (y offset as a function of local x/z). */
function brim(rIn, rOut, curl = 0, curlFront = 0, seg = 40, thick = 0.008) {
  const top = new THREE.RingGeometry(rIn, rOut, seg, 3);
  top.rotateX(-Math.PI / 2);
  const bot = top.clone(); bot.rotateX(Math.PI); bot.translate(0, -thick, 0);
  const g = mergeGeometries([top.toNonIndexed(), bot.toNonIndexed()]);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    const r = Math.hypot(x, z), k = Math.max(0, (r - rIn) / (rOut - rIn));
    const side = Math.abs(x) / Math.max(r, 1e-4);
    p.setY(i, p.getY(i) + curl * k * k * side * side + curlFront * k * k * (1 - side * side));
  }
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------
// HATS. Origin = top of head; hats sit around y≈0.
// ---------------------------------------------------------------------------
export const HAT_TYPES = ['fedora', 'cowboy', 'tophat', 'bowler', 'cap', 'bucket', 'party', 'beanie', 'boater', 'sombrero', 'captain', 'crown', 'propeller', 'chef', 'viking', 'drinkhelmet', 'visor', 'fez'];

export function hatGeometry(type, col = {}) {
  const c = Object.assign({ main: '#3b2a20', band: '#151010', accent: '#e8c25a', extra: '#d33' }, col);
  return cached('hat:' + type + JSON.stringify(c), () => {
    const P = [];
    switch (type) {
      case 'fedora': {
        P.push(prep(lathe([[0.15, -0.06], [0.155, 0.0], [0.15, 0.06], [0.13, 0.095], [0.07, 0.085], [0.0, 0.07]]), c.main));
        P.push(prep(brim(0.148, 0.27, 0.035, -0.015), c.main, M4(0, -0.055, 0)));
        P.push(prep(new THREE.CylinderGeometry(0.153, 0.157, 0.035, 32, 1, true), c.band, M4(0, -0.035, 0)));
        P.push(prep(new THREE.BoxGeometry(0.012, 0.03, 0.03), c.accent, M4(0.155, -0.03, 0.04, 0, 0.4)));
        break;
      }
      case 'cowboy': {
        P.push(prep(lathe([[0.16, -0.06], [0.165, 0.02], [0.15, 0.1], [0.12, 0.13], [0.05, 0.105], [0.0, 0.1]]), c.main));
        P.push(prep(brim(0.158, 0.36, 0.11, -0.02, 48, 0.01), c.main, M4(0, -0.055, 0)));
        P.push(prep(new THREE.CylinderGeometry(0.163, 0.167, 0.03, 32, 1, true), c.band, M4(0, -0.04, 0)));
        for (let i = 0; i < 10; i++) P.push(prep(new THREE.SphereGeometry(0.008, 6, 4), c.accent, M4(Math.sin(i / 10 * TAU) * 0.168, -0.04, Math.cos(i / 10 * TAU) * 0.168)));
        break;
      }
      case 'tophat': {
        P.push(prep(new THREE.CylinderGeometry(0.135, 0.13, 0.28, 32), c.main, M4(0, 0.08, 0)));
        P.push(prep(brim(0.128, 0.22, 0.03, -0.005), c.main, M4(0, -0.06, 0)));
        P.push(prep(new THREE.CylinderGeometry(0.133, 0.131, 0.05, 32, 1, true), c.band, M4(0, -0.025, 0)));
        break;
      }
      case 'bowler': {
        P.push(prep(new THREE.SphereGeometry(0.155, 28, 14, 0, TAU, 0, Math.PI / 2), c.main, M4(0, -0.03, 0, 0, 0, 0, 1, 1.05, 1)));
        P.push(prep(brim(0.15, 0.21, 0.04, 0.02), c.main, M4(0, -0.03, 0)));
        P.push(prep(new THREE.CylinderGeometry(0.156, 0.156, 0.025, 32, 1, true), c.band, M4(0, -0.015, 0)));
        break;
      }
      case 'cap': {
        P.push(prep(new THREE.SphereGeometry(0.175, 28, 14, 0, TAU, 0, Math.PI / 2), c.main, M4(0, -0.06, 0, 0, 0, 0, 1, 0.8, 1)));
        const bill = new THREE.CylinderGeometry(0.16, 0.16, 0.012, 32, 1, false, -Math.PI / 2, Math.PI);
        P.push(prep(bill, c.accent, M4(0, -0.06, 0.07, 0.12, 0, 0, 1, 1, 0.95)));
        P.push(prep(new THREE.SphereGeometry(0.018, 10, 8), c.accent, M4(0, 0.08, 0)));
        for (let i = 0; i < 6; i++) P.push(prep(new THREE.TorusGeometry(0.176, 0.002, 4, 24, Math.PI / 2), c.band, M4(0, -0.06, 0, Math.PI / 2, 0, (i / 6) * TAU, 1, 1, 0.8)));
        break;
      }
      case 'bucket': {
        P.push(prep(lathe([[0.17, -0.05], [0.16, 0.05], [0.13, 0.08], [0.0, 0.085]]), c.main));
        P.push(prep(lathe([[0.17, -0.05], [0.25, -0.12], [0.252, -0.125]], 32), c.main));
        P.push(prep(lathe([[0.252, -0.125], [0.17, -0.051]], 32), c.band));
        break;
      }
      case 'party': {
        const cone = new THREE.ConeGeometry(0.1, 0.32, 24, 6);
        const g = prep(cone, c.main, M4(0, 0.13, 0));
        const col = g.attributes.color, p = g.attributes.position;
        const a = new THREE.Color(c.main), b = new THREE.Color(c.accent);
        for (let i = 0; i < p.count; i++) { const s = Math.floor((p.getY(i) - 0.0) * 22 + Math.atan2(p.getX(i), p.getZ(i)) * 1.2); const cc = s % 2 ? a : b; col.setXYZ(i, cc.r, cc.g, cc.b); }
        P.push(g);
        P.push(prep(new THREE.IcosahedronGeometry(0.04, 1), c.extra, M4(0, 0.3, 0)));
        break;
      }
      case 'beanie': {
        P.push(prep(new THREE.SphereGeometry(0.18, 28, 14, 0, TAU, 0, Math.PI / 2), c.main, M4(0, -0.07, 0, 0, 0, 0, 1, 1.0, 1)));
        P.push(prep(new THREE.TorusGeometry(0.175, 0.03, 10, 32), c.band, M4(0, -0.06, 0, Math.PI / 2)));
        P.push(prep(new THREE.IcosahedronGeometry(0.055, 2), c.accent, M4(0, 0.13, 0)));
        break;
      }
      case 'boater': {
        P.push(prep(new THREE.CylinderGeometry(0.15, 0.155, 0.09, 32), c.main, M4(0, -0.01, 0)));
        P.push(prep(brim(0.15, 0.25, 0, 0), c.main, M4(0, -0.05, 0)));
        P.push(prep(new THREE.CylinderGeometry(0.157, 0.157, 0.035, 32, 1, true), c.band, M4(0, -0.025, 0)));
        break;
      }
      case 'sombrero': {
        P.push(prep(lathe([[0.15, -0.06], [0.14, 0.08], [0.1, 0.2], [0.04, 0.24], [0.0, 0.245]]), c.main));
        P.push(prep(brim(0.148, 0.48, 0.0, 0.0, 56, 0.01), c.main, M4(0, -0.055, 0)));
        P.push(prep(lathe([[0.48, -0.065], [0.5, -0.02], [0.47, 0.01]], 56), c.accent));
        P.push(prep(new THREE.CylinderGeometry(0.147, 0.15, 0.04, 32, 1, true), c.extra, M4(0, -0.02, 0)));
        for (let i = 0; i < 16; i++) P.push(prep(new THREE.IcosahedronGeometry(0.012, 0), i % 2 ? c.extra : c.band, M4(Math.sin(i / 16 * TAU) * 0.32, -0.05, Math.cos(i / 16 * TAU) * 0.32)));
        break;
      }
      case 'captain': {
        P.push(prep(new THREE.CylinderGeometry(0.19, 0.155, 0.08, 32), '#f4f4f0', M4(0, 0.02, 0)));
        P.push(prep(new THREE.CylinderGeometry(0.156, 0.156, 0.06, 32), '#15152a', M4(0, -0.04, 0)));
        const bill = new THREE.CylinderGeometry(0.15, 0.15, 0.01, 32, 1, false, -Math.PI / 2, Math.PI);
        P.push(prep(bill, '#111', M4(0, -0.07, 0.06, -0.25, 0, 0, 1, 1, 0.7)));
        P.push(prep(new THREE.TorusGeometry(0.157, 0.006, 6, 32), c.accent, M4(0, -0.04, 0, Math.PI / 2)));
        P.push(prep(new THREE.SphereGeometry(0.025, 10, 8), c.accent, M4(0, -0.02, 0.155, 0, 0, 0, 1, 1, 0.4)));
        break;
      }
      case 'crown': {
        const ring = new THREE.CylinderGeometry(0.15, 0.14, 0.07, 32, 1, true);
        P.push(prep(ring, c.accent, M4(0, -0.02, 0)));
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * TAU;
          P.push(prep(new THREE.ConeGeometry(0.03, 0.08, 4), c.accent, M4(Math.sin(a) * 0.145, 0.05, Math.cos(a) * 0.145, 0, a)));
          P.push(prep(new THREE.SphereGeometry(0.012, 8, 6), '#ffffff', M4(Math.sin(a) * 0.145, 0.095, Math.cos(a) * 0.145)));
          P.push(prep(new THREE.OctahedronGeometry(0.016), i % 2 ? '#d1163b' : '#1663d1', M4(Math.sin(a) * 0.152, -0.02, Math.cos(a) * 0.152)));
        }
        P.push(prep(new THREE.SphereGeometry(0.135, 20, 10, 0, TAU, 0, Math.PI / 2), '#8b1020', M4(0, -0.03, 0, 0, 0, 0, 1, 0.5, 1)));
        break;
      }
      case 'propeller': {
        const g = prep(new THREE.SphereGeometry(0.175, 24, 12, 0, TAU, 0, Math.PI / 2), c.main, M4(0, -0.06, 0, 0, 0, 0, 1, 0.85, 1));
        const col = g.attributes.color, p = g.attributes.position;
        const cols = [c.main, c.accent, c.extra, '#2a7de1'].map((x) => new THREE.Color(x));
        for (let i = 0; i < p.count; i++) { const s = Math.floor(((Math.atan2(p.getX(i), p.getZ(i)) + Math.PI) / TAU) * 4) % 4; col.setXYZ(i, cols[s].r, cols[s].g, cols[s].b); }
        P.push(g);
        P.push(prep(new THREE.CylinderGeometry(0.008, 0.008, 0.06, 8), '#ddd', M4(0, 0.12, 0)));
        P.push(prep(new THREE.CylinderGeometry(0.15, 0.15, 0.012, 24, 1, true), c.band, M4(0, -0.055, 0)));
        break;
      }
      case 'chef': {
        P.push(prep(new THREE.CylinderGeometry(0.16, 0.155, 0.12, 28), '#fbfbf8', M4(0, -0.01, 0)));
        for (let i = 0; i < 7; i++) { const a = (i / 7) * TAU; P.push(prep(new THREE.SphereGeometry(0.1, 14, 10), '#ffffff', M4(Math.sin(a) * 0.1, 0.13, Math.cos(a) * 0.1))); }
        P.push(prep(new THREE.SphereGeometry(0.12, 16, 12), '#ffffff', M4(0, 0.17, 0)));
        break;
      }
      case 'viking': {
        P.push(prep(new THREE.SphereGeometry(0.175, 28, 14, 0, TAU, 0, Math.PI / 2), '#8c8f96', M4(0, -0.06, 0)));
        P.push(prep(new THREE.TorusGeometry(0.175, 0.016, 8, 32), '#a67c2e', M4(0, -0.055, 0, Math.PI / 2)));
        P.push(prep(new THREE.BoxGeometry(0.02, 0.17, 0.012), '#a67c2e', M4(0, 0.02, 0.165, -0.2)));
        for (const s of [-1, 1]) {
          const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(s * 0.15, 0.0, 0), new THREE.Vector3(s * 0.32, 0.02, 0), new THREE.Vector3(s * 0.3, 0.22, 0.02));
          const tube = new THREE.TubeGeometry(curve, 16, 0.03, 10, false);
          const p = tube.attributes.position;
          for (let i = 0; i < p.count; i++) {
            const t = Math.floor(i / 11) / 16;
            const ctr = curve.getPoint(t);
            const k = 1 - t * 0.85;
            p.setXYZ(i, ctr.x + (p.getX(i) - ctr.x) * k, ctr.y + (p.getY(i) - ctr.y) * k, ctr.z + (p.getZ(i) - ctr.z) * k);
          }
          tube.computeVertexNormals();
          P.push(prep(tube, '#f1e6cc'));
        }
        break;
      }
      case 'drinkhelmet': {
        P.push(prep(new THREE.SphereGeometry(0.18, 28, 14, 0, TAU, 0, Math.PI / 2), c.main, M4(0, -0.06, 0)));
        P.push(prep(new THREE.TorusGeometry(0.18, 0.012, 8, 32), '#ffffff', M4(0, -0.06, 0, Math.PI / 2)));
        for (const s of [-1, 1]) {
          P.push(prep(new THREE.CylinderGeometry(0.035, 0.035, 0.12, 16), s > 0 ? '#c8102e' : '#1b5fc8', M4(s * 0.19, 0.03, 0, 0, 0, s * 0.1)));
          P.push(prep(new THREE.CylinderGeometry(0.036, 0.036, 0.012, 16), '#d9d9d9', M4(s * 0.193, 0.093, 0, 0, 0, s * 0.1)));
          P.push(prep(new THREE.BoxGeometry(0.03, 0.02, 0.03), '#ffcc00', M4(s * 0.16, 0.03, 0)));
          const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(s * 0.19, 0.08, 0), new THREE.Vector3(s * 0.2, 0.0, 0.12), new THREE.Vector3(s * 0.12, -0.18, 0.22), new THREE.Vector3(s * 0.03, -0.3, 0.22)]);
          P.push(prep(new THREE.TubeGeometry(curve, 24, 0.006, 6, false), s > 0 ? '#ff4f9a' : '#4fd1ff'));
        }
        break;
      }
      case 'visor': {
        P.push(prep(new THREE.TorusGeometry(0.17, 0.016, 8, 32), c.main, M4(0, -0.06, 0, Math.PI / 2, 0, 0, 1, 0.9, 1)));
        const bill = new THREE.CylinderGeometry(0.17, 0.17, 0.01, 32, 1, false, -Math.PI / 2, Math.PI);
        P.push(prep(bill, c.accent, M4(0, -0.065, 0.06, 0.18, 0, 0, 1, 1, 0.8)));
        break;
      }
      case 'fez': {
        P.push(prep(new THREE.CylinderGeometry(0.11, 0.14, 0.17, 28), c.main || '#b3122e', M4(0, 0.02, 0)));
        P.push(prep(new THREE.CylinderGeometry(0.004, 0.004, 0.1, 6), '#111', M4(0.06, 0.07, 0, 0, 0, 1.1)));
        P.push(prep(new THREE.ConeGeometry(0.02, 0.06, 8), '#111', M4(0.11, 0.03, 0)));
        break;
      }
      default:
        return new THREE.BufferGeometry();
    }
    return merge(P);
  });
}

/** Propeller blades (separate so they can spin). */
export function propellerGeometry() {
  return cached('propblades', () => merge([
    prep(new THREE.BoxGeometry(0.24, 0.006, 0.035), '#ff3355', M4(0, 0, 0, 0.25)),
    prep(new THREE.BoxGeometry(0.035, 0.006, 0.24), '#ffd400', M4(0, 0, 0, 0, 0, 0.25)),
    prep(new THREE.SphereGeometry(0.015, 8, 6), '#fff'),
  ]));
}

// ---------------------------------------------------------------------------
// SHOES. Origin = ankle; +Z = toe direction.
// ---------------------------------------------------------------------------
export function shoeGeometry(type = 'sneaker', main = '#e33', side = 1) {
  return cached(`shoe:${type}:${main}:${side}`, () => {
    const P = [];
    if (type === 'sneaker') {
      P.push(prep(new RoundedBoxGeometry(0.11, 0.035, 0.25, 3, 0.015), '#f3f1ea', M4(0, -0.068, 0.04)));
      P.push(prep(new THREE.SphereGeometry(0.06, 14, 9), main, M4(0, -0.04, 0.035, 0, 0, 0, 0.88, 0.7, 2.0)));
      P.push(prep(new THREE.SphereGeometry(0.045, 14, 10), '#f3f1ea', M4(0, -0.045, 0.125, 0, 0, 0, 1.15, 0.65, 0.75)));
      for (let i = 0; i < 3; i++) P.push(prep(new THREE.BoxGeometry(0.06, 0.006, 0.01), '#ffffff', M4(0, -0.0 - i * 0.008, 0.03 + i * 0.03, -0.5)));
      P.push(prep(new THREE.BoxGeometry(0.004, 0.02, 0.09), '#ffffff', M4(side * 0.052, -0.05, 0.02)));
    } else if (type === 'loafer') {
      P.push(prep(new RoundedBoxGeometry(0.1, 0.02, 0.24, 3, 0.008), '#2a1a12', M4(0, -0.075, 0.04)));
      P.push(prep(new THREE.SphereGeometry(0.056, 14, 9), main, M4(0, -0.05, 0.04, 0, 0, 0, 0.9, 0.55, 2.05)));
      P.push(prep(new THREE.BoxGeometry(0.06, 0.008, 0.02), '#c9a24a', M4(0, -0.02, 0.07, -0.3)));
    } else if (type === 'boot') {
      P.push(prep(new RoundedBoxGeometry(0.1, 0.03, 0.25, 3, 0.012), '#2a1a10', M4(0, -0.07, 0.04)));
      P.push(prep(new THREE.SphereGeometry(0.058, 14, 9), main, M4(0, -0.045, 0.06, 0, 0, 0, 0.88, 0.65, 1.9)));
      P.push(prep(new THREE.CylinderGeometry(0.06, 0.055, 0.2, 16), main, M4(0, 0.04, -0.01)));
      P.push(prep(new THREE.TorusGeometry(0.06, 0.006, 6, 20), '#c9a24a', M4(0, 0.13, -0.01, Math.PI / 2)));
      P.push(prep(new THREE.BoxGeometry(0.03, 0.035, 0.03), '#2a1a10', M4(0, -0.085, -0.06)));
    } else if (type === 'flipflop') {
      P.push(prep(new RoundedBoxGeometry(0.1, 0.018, 0.25, 3, 0.008), main, M4(0, -0.078, 0.04)));
      P.push(prep(new THREE.TorusGeometry(0.04, 0.006, 6, 16, Math.PI), '#fffbe6', M4(0, -0.068, 0.05, 0, 0, 0)));
    }
    return merge(P);
  });
}
/** Bare jelly foot for flip-flops (uses the jelly material). */
export function footGeometry() {
  return cached('jellyfoot', () => {
    const P = [prep(new THREE.SphereGeometry(0.05, 16, 10), '#fff', M4(0, -0.055, 0.03, 0, 0, 0, 0.9, 0.45, 1.9))];
    for (let i = 0; i < 4; i++) P.push(prep(new THREE.SphereGeometry(0.014, 8, 6), '#fff', M4(-0.03 + i * 0.02, -0.06, 0.115 - Math.abs(i - 1.5) * 0.006)));
    return merge(P);
  });
}

// ---------------------------------------------------------------------------
// HANDS. Origin = wrist; +Z = along the forearm toward the fingers; palm faces -Y.
// side = +1 right hand (thumb toward -X), -1 left hand.
// ---------------------------------------------------------------------------
const HAND_POSES = {
  open: { curl: [0.05, 0.05, 0.05], tip: 0.1, thumb: 0.15, spread: 0.18 },
  relaxed: { curl: [0.45, 0.55, 0.65], tip: 0.5, thumb: 0.35, spread: 0.08 },
  fist: { curl: [1.45, 1.5, 1.55], tip: 1.3, thumb: 1.0, spread: 0 },
  point: { curl: [0.0, 1.5, 1.55], tip: 1.3, thumb: 0.9, spread: 0, pointTip: 0 },
  hold: { curl: [0.95, 1.0, 1.05], tip: 0.75, thumb: 0.7, spread: 0.03 },
  thumbsup: { curl: [1.5, 1.5, 1.5], tip: 1.3, thumb: -0.6, spread: 0 },
  pinch: { curl: [0.7, 0.9, 1.2], tip: 0.6, thumb: 0.9, spread: 0.05 },
  peace: { curl: [0.0, 0.0, 1.55], tip: 1.3, thumb: 0.9, spread: 0.25 },
};
export function handGeometry(pose = 'relaxed', side = 1) {
  return cached(`hand:${pose}:${side}`, () => {
    const H = HAND_POSES[pose] || HAND_POSES.relaxed;
    const P = [];
    // palm: puffy mitten
    P.push(prep(new THREE.SphereGeometry(0.05, 12, 8), '#fff', M4(0, 0, 0.045, 0, 0, 0, 0.95, 0.55, 1.05)));
    P.push(prep(new THREE.SphereGeometry(0.036, 10, 6), '#fff', M4(0, 0, 0.005, 0, 0, 0, 1.05, 0.9, 0.8)));
    // three chunky fingers
    for (let i = 0; i < 3; i++) {
      const x = (i - 1) * 0.026 * side;
      const curl = H.curl[i], spread = (i - 1) * H.spread * side;
      const tip = i === 0 && H.pointTip !== undefined ? H.pointTip : H.tip;
      const base = new THREE.Vector3(x, -0.002, 0.085);
      const q1 = new THREE.Quaternion().setFromEuler(new THREE.Euler(curl, spread, 0, 'YXZ'));
      const dir1 = new THREE.Vector3(0, 0, 1).applyQuaternion(q1);
      const L1 = 0.03, L2 = 0.028;
      const mid = base.clone().addScaledVector(dir1, L1);
      const seg1 = new THREE.CapsuleGeometry(0.0145, L1, 3, 7); seg1.rotateX(Math.PI / 2); seg1.translate(0, 0, L1 / 2);
      const m1 = new THREE.Matrix4().compose(base, q1, new THREE.Vector3(1, 1, 1));
      P.push(prep(seg1, '#fff', m1));
      const q2 = new THREE.Quaternion().setFromEuler(new THREE.Euler(curl + tip, spread, 0, 'YXZ'));
      const seg2 = new THREE.CapsuleGeometry(0.0135, L2, 3, 7); seg2.rotateX(Math.PI / 2); seg2.translate(0, 0, L2 / 2);
      P.push(prep(seg2, '#fff', new THREE.Matrix4().compose(mid, q2, new THREE.Vector3(1, 1, 1))));
    }
    // thumb
    {
      const base = new THREE.Vector3(-0.04 * side, -0.004, 0.03);
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(H.thumb * 0.8, -side * (0.9 - H.thumb * 0.5), side * -0.5, 'YXZ'));
      const seg = new THREE.CapsuleGeometry(0.016, 0.04, 3, 7); seg.rotateX(Math.PI / 2); seg.translate(0, 0, 0.02);
      P.push(prep(seg, '#fff', new THREE.Matrix4().compose(base, q, new THREE.Vector3(1, 1, 1))));
    }
    return merge(P);
  });
}

// ---------------------------------------------------------------------------
// Accessories
// ---------------------------------------------------------------------------
export function bowTieGeometry(color = '#b3122e') {
  return cached('bowtie' + color, () => {
    const s = new THREE.Shape();
    s.moveTo(0, 0); s.lineTo(0.05, 0.028); s.quadraticCurveTo(0.058, 0, 0.05, -0.028); s.lineTo(0, 0);
    const wing = new THREE.ExtrudeGeometry(s, { depth: 0.016, bevelEnabled: true, bevelSize: 0.004, bevelThickness: 0.004, bevelSegments: 2 });
    return merge([prep(wing, color, M4(0.004, 0, -0.008)), prep(wing, color, M4(-0.004, 0, -0.008, 0, Math.PI)), prep(new THREE.SphereGeometry(0.014, 10, 8), color, M4(0, 0, 0.002, 0, 0, 0, 1, 1.2, 0.8))]);
  });
}
export function mustacheGeometry(color = '#3a2414') {
  return cached('stache' + color, () => {
    const P = [];
    for (const s of [-1, 1]) {
      const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(s * 0.04, -0.01, -0.004), new THREE.Vector3(s * 0.075, 0.004, -0.014), new THREE.Vector3(s * 0.085, 0.024, -0.02), new THREE.Vector3(s * 0.073, 0.03, -0.02)]);
      const tube = new THREE.TubeGeometry(curve, 20, 0.012, 8, false);
      const p = tube.attributes.position;
      for (let i = 0; i < p.count; i++) { const t = Math.floor(i / 9) / 20; const ctr = curve.getPoint(t); const k = 1.2 - t * 0.9; p.setXYZ(i, ctr.x + (p.getX(i) - ctr.x) * k, ctr.y + (p.getY(i) - ctr.y) * k, ctr.z + (p.getZ(i) - ctr.z) * k); }
      tube.computeVertexNormals();
      P.push(prep(tube, color));
    }
    return merge(P);
  });
}
export function chainGeometry() {
  return cached('chain', () => {
    const P = [];
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * TAU;
      P.push(prep(new THREE.TorusGeometry(0.009, 0.0035, 5, 8), '#ffd34d', M4(Math.sin(a) * 0.15, -Math.max(0, Math.cos(a)) * 0.08, Math.cos(a) * 0.13, 0, a, i % 2 ? Math.PI / 2 : 0)));
    }
    P.push(prep(new THREE.CylinderGeometry(0.03, 0.03, 0.008, 20), '#ffd34d', M4(0, -0.11, 0.14, Math.PI / 2)));
    return merge(P);
  });
}
export function leiGeometry() {
  return cached('lei', () => {
    const P = []; const cols = ['#ff4f8b', '#ffd23f', '#ff8a3d', '#ffffff', '#c04fff'];
    for (let i = 0; i < 34; i++) {
      const a = (i / 34) * TAU;
      P.push(prep(new THREE.IcosahedronGeometry(0.024, 0), cols[i % cols.length], M4(Math.sin(a) * 0.17, -Math.max(0, Math.cos(a)) * 0.1, Math.cos(a) * 0.15, a, a * 2, 0)));
    }
    return merge(P);
  });
}
export function sunglassesGeometry() {
  return cached('shades', () => {
    const P = [];
    for (const s of [-1, 1]) {
      P.push(prep(new THREE.CylinderGeometry(0.04, 0.036, 0.008, 20), '#0d0d12', M4(s * 0.05, 0, 0, Math.PI / 2, 0, 0, 1, 1, 0.85)));
      P.push(prep(new THREE.TorusGeometry(0.04, 0.004, 6, 24), '#e0b54a', M4(s * 0.05, 0, 0.002, 0, 0, 0, 1, 0.85, 1)));
      P.push(prep(new THREE.BoxGeometry(0.004, 0.004, 0.14), '#e0b54a', M4(s * 0.09, 0.005, -0.07)));
    }
    P.push(prep(new THREE.BoxGeometry(0.03, 0.004, 0.004), '#e0b54a', M4(0, 0.012, 0.002)));
    return merge(P);
  });
}
export function cigarGeometry() {
  return cached('cigar', () => merge([
    prep(new THREE.CylinderGeometry(0.011, 0.012, 0.12, 12), '#6b3d1f', M4(0, 0, 0.06, Math.PI / 2)),
    prep(new THREE.CylinderGeometry(0.0125, 0.0125, 0.015, 12), '#c9a24a', M4(0, 0, 0.025, Math.PI / 2)),
  ]));
}
export function cameraGeometry() {
  return cached('camera', () => merge([
    prep(new RoundedBoxGeometry(0.11, 0.07, 0.05, 2, 0.01), '#1a1a1a'),
    prep(new THREE.CylinderGeometry(0.025, 0.028, 0.04, 16), '#2a2a2a', M4(0, 0, 0.04, Math.PI / 2)),
    prep(new THREE.CylinderGeometry(0.018, 0.018, 0.002, 16), '#5a88c8', M4(0, 0, 0.061, Math.PI / 2)),
    prep(new THREE.BoxGeometry(0.02, 0.01, 0.015), '#c0c0c0', M4(0.03, 0.04, 0)),
  ]));
}
export function fannyPackGeometry(color = '#ff2d95') {
  return cached('fanny' + color, () => merge([
    prep(new RoundedBoxGeometry(0.17, 0.08, 0.06, 3, 0.025), color),
    prep(new THREE.BoxGeometry(0.12, 0.004, 0.004), '#ddd', M4(0, 0.02, 0.031)),
    prep(new THREE.TorusGeometry(0.245, 0.008, 4, 40), '#222', M4(0, 0, -0.2, Math.PI / 2, 0, 0, 1, 0.85, 1)),
  ]));
}
export function nameTagGeometry() {
  return cached('nametag', () => merge([prep(new RoundedBoxGeometry(0.07, 0.025, 0.006, 2, 0.003), '#e0b54a'), prep(new THREE.BoxGeometry(0.055, 0.012, 0.002), '#1a1a1a', M4(0, 0, 0.0035))]));
}
export function earringGeometry() {
  return cached('earring', () => merge([prep(new THREE.TorusGeometry(0.018, 0.004, 6, 16), '#ffd34d')]));
}
export function watchGeometry() {
  return cached('watch', () => merge([
    prep(new THREE.TorusGeometry(0.05, 0.008, 6, 20), '#ffd34d', M4(0, 0, 0, 0, 0, 0, 1, 0.8, 1)),
    prep(new THREE.CylinderGeometry(0.018, 0.018, 0.008, 16), '#ffd34d', M4(0, 0.042, 0)),
  ]));
}
