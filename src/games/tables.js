import * as THREE from 'three';
import { G, mesh } from '../engine/geo.js';
import { M } from '../engine/materials.js';
import { makeCanvas, toTex, feltTexture } from '../engine/textures.js';
import { TAU, rand } from '../engine/util.js';
import { chipStack } from './common.js';
import { barStool } from '../world/props.js';

// Shared builders for felt card tables.

export const FELT_COLORS = { western: '#0f4a2c', tiki: '#0a3f4a', palace: '#0f5a32', neon: '#1a0f4a', monaco: '#0b4a3a' };
export const TABLE_TOP = 0.82;

export function curvedText(g, text, cx, cy, r, center, { font = 'bold 40px Georgia, serif', color = '#ffd36a', spacing = 1, inside = false } = {}) {
  g.save();
  g.font = font; g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'middle';
  const widths = [...text].map((ch) => g.measureText(ch).width * spacing);
  const total = widths.reduce((a, b) => a + b, 0);
  let a = center - (total / r) / 2 * (inside ? -1 : 1);
  for (let i = 0; i < text.length; i++) {
    const w = widths[i] / r;
    const ang = a + (w / 2) * (inside ? -1 : 1);
    g.save();
    g.translate(cx + Math.cos(ang) * r, cy + Math.sin(ang) * r);
    g.rotate(ang + (inside ? -Math.PI / 2 : Math.PI / 2));
    g.fillText(text[i], 0, 0);
    g.restore();
    a += w * (inside ? -1 : 1);
  }
  g.restore();
}

/**
 * Half-moon card table. Local frame: dealer at -Z, players around the arc at +Z.
 * Returns { staticGroup, drawFelt(fn), spots[], seats[], feltMesh, toCanvas(x,z) }.
 */
export function halfMoonTable(theme, { R = 1.2, back = -0.55, seats = 5, spread = 0.98, feltDraw, railColor = '#2a0f0a', chipRack = true } = {}) {
  const S = new THREE.Group();
  const felt = FELT_COLORS[theme] || '#0f5a32';
  const X0 = -R - 0.1, Z0 = back - 0.08, W = 2 * R + 0.2, D = R + 0.2;
  // felt canvas
  const CW = 2048, CH = Math.round(2048 * D / W);
  const { c, g } = makeCanvas(CW, CH);
  const base = feltTexture(felt).map.image;
  for (let x = 0; x < CW; x += 512) for (let y = 0; y < CH; y += 512) g.drawImage(base, x, y);
  const toCanvas = (x, z) => [((x - X0) / W) * CW, ((z - Z0) / D) * CH];
  const pxPerM = CW / W;
  // shape (x, -z)
  const shape = new THREE.Shape();
  shape.moveTo(-R, -back);
  const steps = 48;
  for (let i = 0; i <= steps; i++) { const a = Math.PI - (i / steps) * Math.PI; shape.lineTo(Math.cos(a) * R, -(back + Math.sin(a) * R * 1.0)); }
  shape.lineTo(-R, -back);
  // seats / betting spots
  const spots = [], seatPos = [];
  for (let i = 0; i < seats; i++) {
    const th = seats === 1 ? 0 : (-spread / 2 + (i / (seats - 1)) * spread) * Math.PI * 0.55;
    spots.push({ x: Math.sin(th) * R * 0.66, z: back + Math.cos(th) * R * 0.66, th });
    seatPos.push({ x: Math.sin(th) * (R + 0.42), z: back + Math.cos(th) * (R + 0.42), ry: Math.PI + th });
  }
  if (feltDraw) feltDraw(g, { toCanvas, pxPerM, spots, R, back, CW, CH });
  const tex = toTex(c, { wrap: false });
  tex.anisotropy = 8;
  const feltGeo = new THREE.ShapeGeometry(shape, 24);
  feltGeo.rotateX(-Math.PI / 2);
  const p = feltGeo.attributes.position, uv = feltGeo.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) - X0) / W, 1 - (p.getZ(i) - Z0) / D);
  const feltMat = new THREE.MeshPhysicalMaterial({ map: tex, normalMap: feltTexture(felt).normalMap, roughness: 0.92, sheen: 1, sheenRoughness: 0.6, sheenColor: new THREE.Color(felt).lerp(new THREE.Color(1, 1, 1), 0.3), envMapIntensity: 0.3 });
  const feltMesh = mesh(feltGeo, feltMat, 0, TABLE_TOP, 0, { parent: S });
  feltMesh.receiveShadow = true;
  // wooden body below the felt
  const bodyGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 2, curveSegments: 24 });
  bodyGeo.rotateX(-Math.PI / 2);
  mesh(bodyGeo, M.wood('mahogany', 2, 2), 0, TABLE_TOP - 0.145, 0, { parent: S, cast: true });
  // padded leather rail along the arc
  const arc = new THREE.CatmullRomCurve3(Array.from({ length: 33 }, (_, i) => { const a = Math.PI - (i / 32) * Math.PI; return new THREE.Vector3(Math.cos(a) * (R + 0.02), TABLE_TOP + 0.015, back + Math.sin(a) * (R + 0.02)); }));
  mesh(new THREE.TubeGeometry(arc, 64, 0.065, 12), M.leather(railColor, false, 8, 1), 0, 0, 0, { parent: S, cast: true });
  mesh(new THREE.TubeGeometry(arc, 64, 0.012, 6), M.gold(), 0, -0.07, 0, { parent: S });
  // dealer-side straight edge + chip well
  mesh(G.rbox(2 * R + 0.1, 0.07, 0.12, 0.02), M.wood('mahogany', 2, 1), 0, TABLE_TOP - 0.01, back - 0.02, { parent: S });
  // pedestal
  mesh(G.rbox(1.2, TABLE_TOP - 0.2, 0.5, 0.05), M.wood('mahogany', 1, 1), 0, (TABLE_TOP - 0.2) / 2, back + 0.35, { parent: S, cast: true });
  mesh(G.rbox(1.5, 0.06, 0.7, 0.02), M.gold(), 0, 0.03, back + 0.35, { parent: S });
  mesh(G.box(1.25, 0.03, 0.52), M.gold(), 0, TABLE_TOP - 0.22, back + 0.35, { parent: S });
  // chip rack in front of the dealer
  if (chipRack) {
    mesh(G.rbox(0.62, 0.05, 0.16, 0.01), M.blackMetal(), 0, TABLE_TOP + 0.01, back + 0.1, { parent: S });
    const vals = [1, 5, 25, 100, 500, 1000];
    vals.forEach((v, i) => { const st = chipStack(v * 20); st.rotation.z = Math.PI / 2; st.position.set(-0.25 + i * 0.1, TABLE_TOP + 0.04, back + 0.1); st.scale.set(1, 0.9, 1); S.add(st); });
  }
  // stools
  for (const sp of seatPos) { const st = barStool('chrome', 0x4a0a14); st.position.set(sp.x, 0, sp.z); st.scale.setScalar(0.92); S.add(st); }
  return { staticGroup: S, spots, seats: seatPos, feltMesh, toCanvas, pxPerM, back, R };
}

/** Small acrylic limit sign. */
export function limitSign(text, color = '#ffd36a') {
  const g = new THREE.Group();
  const { c, g: x } = makeCanvas(256, 128);
  x.fillStyle = '#0a0a10'; x.fillRect(0, 0, 256, 128);
  x.strokeStyle = color; x.lineWidth = 6; x.strokeRect(6, 6, 244, 116);
  x.fillStyle = color; x.font = 'bold 26px "Arial Black", sans-serif'; x.textAlign = 'center';
  const lines = text.split('\n');
  lines.forEach((l, i) => x.fillText(l, 128, 52 + i * 36));
  mesh(G.box(0.2, 0.1, 0.01), M.glassTint(0x222233), 0, 0.06, 0, { parent: g });
  mesh(G.plane(0.18, 0.09), new THREE.MeshBasicMaterial({ map: toTex(c, { wrap: false }), color: new THREE.Color(1.6, 1.6, 1.6) }), 0, 0.06, 0.006, { parent: g });
  mesh(G.box(0.12, 0.012, 0.05), M.chrome(), 0, 0.006, 0, { parent: g });
  return g;
}

export function cardShoe() {
  const g = new THREE.Group();
  mesh(G.rbox(0.13, 0.11, 0.3, 0.01), M.lacquer(0x1a1a1a), 0, 0.055, 0, { parent: g });
  mesh(G.box(0.1, 0.1, 0.26), M.matte(0xf2ede0, 0.8), 0, 0.06, 0.02, { parent: g });
  mesh(G.box(0.12, 0.02, 0.05), M.glassTint(0x3a1a1a), 0, 0.1, 0.15, { rx: 0.5, parent: g });
  mesh(G.box(0.13, 0.015, 0.31), M.gold(), 0, 0.115, 0, { parent: g });
  return g;
}

export function discardTray() {
  const g = new THREE.Group();
  mesh(G.box(0.11, 0.08, 0.14), M.glassTint(0x88aaff), 0, 0.04, 0, { parent: g });
  mesh(G.box(0.09, 0.05, 0.12), M.matte(0x8a0f1e, 0.6), 0, 0.03, 0, { parent: g });
  return g;
}

export { rand, TAU };
