import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Geometry helpers + a static batcher that merges world-static meshes by material
// to keep draw calls low while allowing very detailed props.

const gcache = new Map();
function g(key, fn) { if (!gcache.has(key)) { const geo = fn(); geo.userData.shared = true; gcache.set(key, geo); } return gcache.get(key); }

export const G = {
  box: (w, h, d) => g(`box${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d)),
  rbox: (w, h, d, r = 0.02, s = 3) => g(`rbox${w},${h},${d},${r},${s}`, () => new RoundedBoxGeometry(w, h, d, s, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4))),
  cyl: (rt, rb, h, seg = 24, open = false) => g(`cyl${rt},${rb},${h},${seg},${open}`, () => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open)),
  sphere: (r, ws = 24, hs = 16) => g(`sph${r},${ws},${hs}`, () => new THREE.SphereGeometry(r, ws, hs)),
  torus: (r, t, rs = 12, ts = 32, arc = Math.PI * 2) => g(`tor${r},${t},${rs},${ts},${arc}`, () => new THREE.TorusGeometry(r, t, rs, ts, arc)),
  cone: (r, h, seg = 24) => g(`cone${r},${h},${seg}`, () => new THREE.ConeGeometry(r, h, seg)),
  plane: (w, h) => g(`pl${w},${h}`, () => new THREE.PlaneGeometry(w, h)),
  capsule: (r, l, cs = 6, rs = 12) => g(`cap${r},${l},${cs},${rs}`, () => new THREE.CapsuleGeometry(r, l, cs, rs)),
  circle: (r, seg = 32) => g(`circ${r},${seg}`, () => new THREE.CircleGeometry(r, seg)),
  ring: (ri, ro, seg = 48) => g(`ring${ri},${ro},${seg}`, () => new THREE.RingGeometry(ri, ro, seg)),
  octa: (r) => g(`oct${r}`, () => new THREE.OctahedronGeometry(r, 0)),
  ico: (r, d = 0) => g(`ico${r},${d}`, () => new THREE.IcosahedronGeometry(r, d)),
  lathe: (key, pts, seg = 32) => g(`lathe${key}${seg}`, () => new THREE.LatheGeometry(pts.map((p) => new THREE.Vector2(p[0], p[1])), seg)),
  extrude: (key, shape, opts) => g(`ext${key}`, () => new THREE.ExtrudeGeometry(shape, opts)),
};

/** Smooth profile through control points -> lathe geometry. */
export function smoothLathe(key, ctrl, samples = 40, seg = 32) {
  return g(`slathe${key}${samples}${seg}`, () => {
    const curve = new THREE.SplineCurve(ctrl.map((p) => new THREE.Vector2(p[0], p[1])));
    const pts = curve.getPoints(samples).map((p) => new THREE.Vector2(Math.max(0, p.x), p.y));
    return new THREE.LatheGeometry(pts, seg);
  });
}

export function roundedRectShape(w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

/** Quick mesh factory. */
export function mesh(geo, mat, x = 0, y = 0, z = 0, opts = {}) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  if (opts.rx) m.rotation.x = opts.rx;
  if (opts.ry) m.rotation.y = opts.ry;
  if (opts.rz) m.rotation.z = opts.rz;
  if (opts.s) { if (typeof opts.s === 'number') m.scale.setScalar(opts.s); else m.scale.set(...opts.s); }
  m.castShadow = opts.cast ?? false;
  m.receiveShadow = opts.receive ?? true;
  if (opts.parent) opts.parent.add(m);
  return m;
}

/** Remap planar UVs of a geometry to [0,1] over its bounding box in given axes. */
export function planarUV(geo, ax = 'x', ay = 'y', sx = 1, sy = 1) {
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  const p = geo.attributes.position, uv = geo.attributes.uv;
  const minA = bb.min[ax], minB = bb.min[ay], rA = bb.max[ax] - minA || 1, rB = bb.max[ay] - minB || 1;
  for (let i = 0; i < p.count; i++) {
    const a = ax === 'x' ? p.getX(i) : ax === 'y' ? p.getY(i) : p.getZ(i);
    const b = ay === 'x' ? p.getX(i) : ay === 'y' ? p.getY(i) : p.getZ(i);
    uv.setXY(i, ((a - minA) / rA) * sx, ((b - minB) / rB) * sy);
  }
  uv.needsUpdate = true;
  return geo;
}

// ---------------------------------------------------------------------------
// Static batcher
// ---------------------------------------------------------------------------
const KEEP = ['position', 'normal', 'uv'];
function normalizeGeo(src, matrix) {
  let geo = src.index ? src.toNonIndexed() : src.clone();
  for (const k of Object.keys(geo.attributes)) if (!KEEP.includes(k)) geo.deleteAttribute(k);
  if (!geo.attributes.normal) geo.computeVertexNormals();
  if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
  geo.morphAttributes = {};
  geo.clearGroups();
  geo.applyMatrix4(matrix);
  return geo;
}

/**
 * Merge every static Mesh below `root` into one mesh per material.
 * Meshes flagged with userData.dynamic (or below such a node) are left untouched.
 */
export function batchStatic(root, target) {
  root.updateMatrixWorld(true);
  const groups = new Map();
  const remove = [];
  root.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh) return;
    let p = o; while (p) { if (p.userData.dynamic) return; p = p.parent; }
    if (Array.isArray(o.material)) return;
    if (o.material.transparent && o.material.blending === THREE.AdditiveBlending) return;
    const key = o.material.uuid + (o.castShadow ? 'c' : '') + (o.receiveShadow ? 'r' : '');
    if (!groups.has(key)) groups.set(key, { mat: o.material, cast: o.castShadow, recv: o.receiveShadow, geos: [] });
    groups.get(key).geos.push(normalizeGeo(o.geometry, o.matrixWorld));
    remove.push(o);
  });
  for (const o of remove) o.parent && o.parent.remove(o);
  const out = new THREE.Group();
  out.name = 'static-batch';
  for (const { mat, cast, recv, geos } of groups.values()) {
    // split into chunks to keep culling useful and buffer sizes sane
    const CH = 60000;
    let chunk = [], count = 0;
    const flush = () => {
      if (!chunk.length) return;
      const merged = mergeGeometries(chunk, false);
      chunk.forEach((c) => c.dispose());
      if (merged) {
        merged.computeBoundingSphere();
        const m = new THREE.Mesh(merged, mat);
        m.castShadow = cast; m.receiveShadow = recv;
        m.matrixAutoUpdate = false;
        out.add(m);
      }
      chunk = []; count = 0;
    };
    for (const gg of geos) { chunk.push(gg); count += gg.attributes.position.count; if (count > CH) flush(); }
    flush();
  }
  (target || root).add(out);
  return out;
}
