import * as THREE from 'three';
import { G, mesh, smoothLathe, roundedRectShape } from '../engine/geo.js';
import { M, signMaterial } from '../engine/materials.js';
import { makeCanvas, toTex, textTexture, cached } from '../engine/textures.js';
import { TAU, makeRng } from '../engine/util.js';

// ============================================================================
//  Detailed props. Everything returns a Group whose static meshes get batched
//  later. Footprints for collisions are stored in userData.collider {w,d}.
// ============================================================================

const col = (g, w, d, ox = 0, oz = 0) => { g.userData.collider = { w, d, ox, oz }; return g; };

// ---------------------------------------------------------------- lighting
export function chandelier(style = 'crystal', scale = 1) {
  const g = new THREE.Group();
  const gold = M.gold(), bulb = M.bulb(0xffc98a, 3.2);
  if (style === 'crystal') {
    mesh(G.cyl(0.012, 0.012, 1.2, 8), gold, 0, 0.6, 0, { parent: g });
    mesh(G.sphere(0.09, 16, 12), gold, 0, 0, 0, { parent: g });
    for (let tier = 0; tier < 3; tier++) {
      const r = (0.9 - tier * 0.25) * scale, y = -0.15 - tier * 0.28;
      mesh(G.torus(r, 0.018, 8, 48), gold, 0, y, 0, { rx: Math.PI / 2, parent: g });
      const n = 10 - tier * 2;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU;
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        mesh(G.cyl(0.02, 0.025, 0.06, 10), gold, x, y + 0.04, z, { parent: g });
        mesh(G.cyl(0.012, 0.012, 0.08, 8), M.ceramic(0xfff6e8), x, y + 0.11, z, { parent: g });
        mesh(G.sphere(0.03, 10, 8), bulb, x, y + 0.17, z, { s: [1, 1.5, 1], parent: g });
        // arm curling back to centre
        const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, y + 0.25, 0), new THREE.Vector3(x * 0.6, y + 0.3, z * 0.6), new THREE.Vector3(x, y + 0.02, z));
        mesh(cached('arm' + r.toFixed(2) + i + y, () => new THREE.TubeGeometry(curve, 10, 0.011, 6)), gold, 0, 0, 0, { parent: g });
      }
    }
    // crystal drops (instanced)
    const drops = new THREE.InstancedMesh(G.octa(0.035), M.crystal(), 140);
    const m4 = new THREE.Matrix4(), rng = makeRng(3);
    for (let i = 0; i < 140; i++) {
      const tier = i % 3, r = (0.9 - tier * 0.25) * scale * (0.6 + rng() * 0.45), a = rng() * TAU;
      const y = -0.25 - tier * 0.28 - rng() * 0.35;
      m4.compose(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, a, 0)), new THREE.Vector3(1, 1.8, 1));
      drops.setMatrixAt(i, m4);
    }
    g.add(drops);
    const tip = mesh(G.octa(0.09), M.crystal(), 0, -1.25, 0, { s: [1, 2, 1], parent: g });
    tip.castShadow = false;
  } else if (style === 'wagon') {
    const wood = M.wood('rustic', 1, 1, false);
    mesh(G.torus(0.8, 0.05, 8, 40), wood, 0, 0, 0, { rx: Math.PI / 2, parent: g });
    mesh(G.torus(0.8, 0.02, 6, 40), M.iron(), 0, -0.04, 0, { rx: Math.PI / 2, parent: g });
    mesh(G.cyl(0.1, 0.1, 0.12, 12), wood, 0, 0, 0, { parent: g });
    for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI; mesh(G.box(1.6, 0.04, 0.05), wood, 0, 0, 0, { ry: a, parent: g }); }
    for (const [x, z] of [[0.8, 0], [-0.8, 0], [0, 0.8], [0, -0.8]]) mesh(G.cyl(0.008, 0.008, 1.6, 6), M.iron(), x * 0.5, 0.8, z * 0.5, { rz: x ? -x * 0.45 : 0, rx: z ? z * 0.45 : 0, parent: g });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU, x = Math.cos(a) * 0.8, z = Math.sin(a) * 0.8;
      lantern(g, x, -0.05, z);
    }
  } else if (style === 'tiki') {
    const bam = M.bamboo(1, 1);
    mesh(G.cyl(0.015, 0.015, 1.2, 6), M.matte(0x4a3420), 0, 0.6, 0, { parent: g });
    const shade = mesh(G.sphere(0.45, 20, 14), M.matte(0xe6b46a, 0.8), 0, -0.2, 0, { s: [1, 0.8, 1], parent: g });
    shade.material = new THREE.MeshStandardMaterial({ color: 0x3a2410, emissive: 0xffa040, emissiveIntensity: 1.2, roughness: 0.9 });
    for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; mesh(G.cyl(0.02, 0.02, 0.75, 6), bam, Math.cos(a) * 0.43, -0.2, Math.sin(a) * 0.43, { parent: g }); }
    for (const y of [-0.45, 0.05]) mesh(G.torus(0.36, 0.02, 6, 24), M.matte(0x4a3420), 0, y, 0, { rx: Math.PI / 2, parent: g });
  } else if (style === 'neon') {
    mesh(G.cyl(0.01, 0.01, 1.2, 6), M.blackMetal(), 0, 0.6, 0, { parent: g });
    mesh(G.torus(0.9, 0.035, 8, 64), M.neon(0xff2bd6, 4), 0, 0, 0, { rx: Math.PI / 2, parent: g });
    mesh(G.torus(0.6, 0.035, 8, 48), M.neon(0x2bf0ff, 4), 0, -0.25, 0, { rx: Math.PI / 2, parent: g });
    mesh(G.torus(0.3, 0.035, 8, 32), M.neon(0xfff23b, 4), 0, -0.5, 0, { rx: Math.PI / 2, parent: g });
    for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; mesh(G.cyl(0.006, 0.006, 0.6, 4), M.blackMetal(), Math.cos(a) * 0.6, -0.12, Math.sin(a) * 0.6, { rz: 0.4 * Math.cos(a), rx: 0.4 * Math.sin(a), parent: g }); }
  }
  g.userData.light = true;
  return g;
}

function lantern(g, x, y, z) {
  mesh(G.cyl(0.006, 0.006, 0.12, 4), M.iron(), x, y - 0.06, z, { parent: g });
  mesh(G.cyl(0.06, 0.07, 0.03, 10), M.iron(), x, y - 0.13, z, { parent: g });
  mesh(G.cyl(0.05, 0.05, 0.14, 10), M.glassTint(0xffd9a0), x, y - 0.22, z, { parent: g });
  mesh(G.sphere(0.025, 8, 6), M.bulb(0xff9a40, 7), x, y - 0.22, z, { parent: g });
  mesh(G.cyl(0.07, 0.07, 0.02, 10), M.iron(), x, y - 0.3, z, { parent: g });
}

export function wallSconce(style = 'gold') {
  const g = new THREE.Group();
  const met = style === 'iron' ? M.iron() : M.gold();
  mesh(G.cyl(0.07, 0.07, 0.02, 16), met, 0, 0, 0.01, { rx: Math.PI / 2, parent: g });
  mesh(G.cyl(0.012, 0.012, 0.16, 8), met, 0, 0.02, 0.08, { rx: Math.PI / 2 - 0.5, parent: g });
  mesh(G.cyl(0.03, 0.03, 0.04, 10), met, 0, 0.07, 0.14, { parent: g });
  const shade = mesh(G.cyl(0.05, 0.085, 0.13, 16, true), new THREE.MeshStandardMaterial({ color: 0x5a2a10, emissive: 0xffb36a, emissiveIntensity: 1.6, side: THREE.DoubleSide, roughness: 0.8 }), 0, 0.16, 0.14, { parent: g });
  shade.material.userData.shared = true;
  mesh(G.sphere(0.025, 8, 6), M.bulb(0xffd0a0, 5), 0, 0.13, 0.14, { parent: g });
  return g;
}

export function recessedLight() {
  const g = new THREE.Group();
  mesh(G.torus(0.11, 0.015, 6, 20), M.chrome(), 0, 0, 0, { rx: Math.PI / 2, parent: g });
  mesh(G.circle(0.1, 20), M.bulb(0xfff0d8, 3), 0, -0.005, 0, { rx: Math.PI / 2, parent: g });
  return g;
}

// ---------------------------------------------------------------- plants
let frondTex = null;
function leafMaterial(kind = 'palm') {
  return cached('leafmat' + kind, () => {
    const { c, g } = makeCanvas(256, 512);
    g.clearRect(0, 0, 256, 512);
    if (kind === 'palm') {
      g.strokeStyle = '#3f6b22'; g.lineWidth = 6; g.beginPath(); g.moveTo(128, 512); g.lineTo(128, 0); g.stroke();
      for (let i = 0; i < 26; i++) {
        const y = 500 - i * 19, len = 110 * Math.sin((i / 26) * Math.PI) + 20;
        for (const s of [-1, 1]) {
          const gr = g.createLinearGradient(128, y, 128 + s * len, y - 50);
          gr.addColorStop(0, '#2f6a1e'); gr.addColorStop(1, '#6fae3a');
          g.fillStyle = gr; g.beginPath(); g.moveTo(128, y); g.quadraticCurveTo(128 + s * len * 0.6, y - 10, 128 + s * len, y - 46); g.quadraticCurveTo(128 + s * len * 0.5, y - 4, 128, y - 12); g.fill();
        }
      }
    } else {
      const gr = g.createLinearGradient(0, 0, 256, 0); gr.addColorStop(0, '#1f4d1a'); gr.addColorStop(0.5, '#3f8a2a'); gr.addColorStop(1, '#1f4d1a');
      g.fillStyle = gr; g.beginPath(); g.ellipse(128, 256, 120, 250, 0, 0, TAU); g.fill();
      g.strokeStyle = '#a8d27a'; g.lineWidth = 4; g.beginPath(); g.moveTo(128, 500); g.lineTo(128, 20); g.stroke();
      g.globalCompositeOperation = 'destination-out';
      for (let i = 0; i < 7; i++) { const y = 80 + i * 55; for (const s of [-1, 1]) { g.beginPath(); g.ellipse(128 + s * 85, y, 40, 9, s * 0.5, 0, TAU); g.fill(); } }
      g.globalCompositeOperation = 'source-over';
    }
    const t = toTex(c, { wrap: false });
    const m = new THREE.MeshStandardMaterial({ map: t, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.6 });
    m.userData.shared = true;
    return m;
  });
}
function frondGeometry(len, width, droop) {
  return cached(`frond${len}${width}${droop}`, () => {
    const geo = new THREE.PlaneGeometry(width, len, 2, 10);
    geo.translate(0, len / 2, 0);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i), t = y / len;
      p.setZ(i, droop * t * t * len + Math.abs(p.getX(i)) * 0.4);
      p.setY(i, y * (1 - droop * 0.35 * t));
    }
    geo.computeVertexNormals();
    return geo;
  });
}
export function pottedPalm(h = 2.2, potStyle = 'gold') {
  const g = new THREE.Group();
  const potMat = potStyle === 'terracotta' ? M.matte(0xa4532c, 0.8) : potStyle === 'black' ? M.lacquer(0x111111) : M.lacquer(0x5a1020);
  mesh(smoothLathe('pot', [[0.0, 0], [0.24, 0], [0.3, 0.12], [0.33, 0.42], [0.36, 0.5], [0.33, 0.52]], 20, 24), potMat, 0, 0, 0, { cast: true, parent: g });
  mesh(G.torus(0.335, 0.025, 8, 32), potStyle === 'terracotta' ? potMat : M.gold(), 0, 0.5, 0, { rx: Math.PI / 2, parent: g });
  mesh(G.cyl(0.31, 0.31, 0.02, 24), M.matte(0x2a1a10, 1), 0, 0.47, 0, { parent: g });
  // trunk: stacked rings
  const trunkM = M.matte(0x6b4a2e, 0.95);
  const segs = Math.round(h * 5);
  for (let i = 0; i < segs; i++) mesh(G.cyl(0.055, 0.07, 0.2, 10), trunkM, Math.sin(i * 0.4) * 0.02, 0.55 + i * (h - 0.6) / segs, 0, { parent: g });
  const top = new THREE.Vector3(0, 0.55 + h - 0.6, 0);
  const lm = leafMaterial('palm');
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * TAU + i * 0.3;
    const f = mesh(frondGeometry(1.2 + (i % 3) * 0.15, 0.7, 0.9), lm, top.x, top.y, top.z, { parent: g });
    f.rotation.set(-0.35 - (i % 2) * 0.35, a, 0, 'YXZ');
    f.receiveShadow = false;
  }
  return col(g, 0.7, 0.7);
}
export function monstera() {
  const g = new THREE.Group();
  mesh(smoothLathe('pot2', [[0, 0], [0.2, 0], [0.24, 0.35], [0.25, 0.4]], 16, 24), M.ceramic(0xece6da), 0, 0, 0, { parent: g });
  const lm = leafMaterial('monstera'), rng = makeRng(9);
  for (let i = 0; i < 9; i++) {
    const a = rng() * TAU, h = 0.6 + rng() * 0.7;
    mesh(G.cyl(0.008, 0.01, h, 5), M.matte(0x3a6a22), Math.cos(a) * 0.1, 0.38 + h / 2, Math.sin(a) * 0.1, { rz: Math.cos(a) * 0.3, rx: -Math.sin(a) * 0.3, parent: g });
    const l = mesh(G.plane(0.38, 0.55), lm, Math.cos(a) * (0.1 + h * 0.3), 0.38 + h, Math.sin(a) * (0.1 + h * 0.3), { parent: g });
    l.rotation.set(-0.9, -a + Math.PI / 2, 0, 'YXZ');
  }
  return col(g, 0.5, 0.5);
}
export function cactus() {
  const g = new THREE.Group();
  mesh(smoothLathe('pot3', [[0, 0], [0.22, 0], [0.27, 0.3], [0.28, 0.34]], 16, 20), M.matte(0xa4532c, 0.85), 0, 0, 0, { parent: g });
  const cm = M.plastic(0x3f8a3a, 0.6);
  mesh(G.capsule(0.11, 0.9, 6, 12), cm, 0, 0.85, 0, { parent: g });
  mesh(G.capsule(0.07, 0.3, 6, 10), cm, 0.17, 0.95, 0, { rz: -0.2, parent: g });
  mesh(G.capsule(0.07, 0.2, 6, 10), cm, 0.24, 1.12, 0, { parent: g });
  mesh(G.capsule(0.065, 0.25, 6, 10), cm, -0.16, 0.8, 0, { rz: 0.3, parent: g });
  mesh(G.capsule(0.065, 0.2, 6, 10), cm, -0.23, 0.98, 0, { parent: g });
  mesh(G.sphere(0.05, 10, 8), M.plastic(0xff4f8b), 0, 1.4, 0, { parent: g });
  return col(g, 0.5, 0.5);
}

// ---------------------------------------------------------------- crowd control
export function stanchion(goldTop = true) {
  const g = new THREE.Group();
  const met = goldTop ? M.gold() : M.chrome();
  mesh(G.cyl(0.16, 0.18, 0.04, 24), met, 0, 0.02, 0, { parent: g });
  mesh(G.cyl(0.025, 0.025, 0.92, 12), met, 0, 0.5, 0, { parent: g });
  mesh(G.sphere(0.045, 14, 10), met, 0, 0.98, 0, { parent: g });
  return g;
}
export function velvetRope(a, b, color = 0x8b0a1e) {
  const mid = a.clone().lerp(b, 0.5); mid.y -= 0.22;
  const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
  return new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.022, 8), M.velvet(color));
}

// ---------------------------------------------------------------- architecture
export function column(style = 'marble', h = 5) {
  const g = new THREE.Group();
  if (style === 'marble' || style === 'palace') {
    const marble = M.marble('#f1ece2', '#9a8f7e', 1, 3);
    mesh(G.rbox(0.9, 0.3, 0.9, 0.03), marble, 0, 0.15, 0, { parent: g, cast: true });
    mesh(smoothLathe('colbase', [[0.38, 0], [0.4, 0.06], [0.34, 0.12], [0.36, 0.18], [0.3, 0.24]], 12, 28), M.gold(), 0, 0.3, 0, { parent: g });
    const shaft = mesh(G.cyl(0.28, 0.3, h - 1.1, 28), marble, 0, 0.54 + (h - 1.1) / 2, 0, { parent: g, cast: true });
    shaft.castShadow = true;
    for (let i = 0; i < 16; i++) { const a = (i / 16) * TAU; mesh(G.box(0.03, h - 1.2, 0.02), M.marble('#e6dfd2', '#9a8f7e', 1, 3), Math.cos(a) * 0.29, 0.54 + (h - 1.1) / 2, Math.sin(a) * 0.29, { ry: -a, parent: g }); }
    mesh(smoothLathe('colcap', [[0.3, 0], [0.33, 0.08], [0.42, 0.2], [0.48, 0.3], [0.5, 0.34]], 12, 28), M.gold(), 0, h - 0.56, 0, { parent: g });
    mesh(G.rbox(1.05, 0.22, 1.05, 0.03), M.gold(), 0, h - 0.11, 0, { parent: g });
  } else if (style === 'western') {
    const w = M.wood('rustic', 1, 3, false);
    mesh(G.box(0.32, h, 0.32), w, 0, h / 2, 0, { parent: g, cast: true });
    mesh(G.box(0.42, 0.12, 0.42), w, 0, 0.06, 0, { parent: g });
    for (const s of [-1, 1]) { mesh(G.box(0.1, 0.7, 0.1), w, s * 0.4, h - 0.45, 0, { rz: s * 0.8, parent: g }); }
    for (const y of [1.2, 2.6]) mesh(G.box(0.34, 0.04, 0.34), M.iron(), 0, y, 0, { parent: g });
  } else if (style === 'tiki') {
    const bam = M.bamboo(1, 2);
    for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; mesh(G.cyl(0.08, 0.09, h, 10), bam, Math.cos(a) * 0.16, h / 2, Math.sin(a) * 0.16, { parent: g, cast: true }); }
    for (const y of [0.6, h * 0.5, h - 0.5]) mesh(G.torus(0.26, 0.03, 6, 20), M.matte(0x5a3a1c, 0.9), 0, y, 0, { rx: Math.PI / 2, parent: g });
    tikiHead(g, 0, 1.2, 0.25, 0);
  } else if (style === 'neon') {
    mesh(G.cyl(0.3, 0.3, h, 24), M.blackMetal(), 0, h / 2, 0, { parent: g, cast: true });
    for (let i = 0; i < 4; i++) { const a = (i / 4) * TAU + Math.PI / 4; mesh(G.box(0.04, h - 0.4, 0.04), M.neon(i % 2 ? 0xff2bd6 : 0x2bf0ff, 3.5), Math.cos(a) * 0.3, h / 2, Math.sin(a) * 0.3, { parent: g }); }
    mesh(G.torus(0.33, 0.03, 8, 32), M.neon(0xfff23b, 3), 0, 1.0, 0, { rx: Math.PI / 2, parent: g });
    mesh(G.torus(0.33, 0.03, 8, 32), M.neon(0xfff23b, 3), 0, h - 0.6, 0, { rx: Math.PI / 2, parent: g });
  }
  return col(g, style === 'western' ? 0.45 : 0.8, style === 'western' ? 0.45 : 0.8);
}

export function tikiHead(parent, x, y, z, ry) {
  const g = new THREE.Group();
  const w = M.wood('walnut', 1, 1, false);
  mesh(G.rbox(0.36, 0.6, 0.32, 0.06), w, 0, 0, 0, { parent: g });
  for (const s of [-1, 1]) { mesh(G.sphere(0.06, 10, 8), M.matte(0xf1e6cc), s * 0.09, 0.1, 0.15, { s: [1, 0.7, 0.4], parent: g }); mesh(G.sphere(0.03, 8, 6), M.matte(0x111111), s * 0.09, 0.1, 0.17, { parent: g }); }
  mesh(G.box(0.24, 0.08, 0.06), M.matte(0x2a1a10), 0, -0.13, 0.15, { parent: g });
  for (let i = 0; i < 5; i++) mesh(G.box(0.03, 0.05, 0.02), M.matte(0xf1e6cc), -0.08 + i * 0.04, -0.12, 0.18, { parent: g });
  mesh(G.box(0.08, 0.16, 0.08), w, 0, 0.0, 0.18, { parent: g });
  g.position.set(x, y, z); g.rotation.y = ry;
  parent.add(g);
  return g;
}

export function tikiTorch() {
  const g = new THREE.Group();
  mesh(G.cyl(0.035, 0.045, 1.8, 8), M.bamboo(1, 2), 0, 0.9, 0, { parent: g });
  mesh(G.cyl(0.09, 0.05, 0.25, 10), M.matte(0x8a6a3a), 0, 1.9, 0, { parent: g });
  const flame = new THREE.Sprite(M.glow(0xff8a2a, 0.95)); flame.scale.set(0.35, 0.55, 1); flame.position.y = 2.15; g.add(flame);
  const core = new THREE.Sprite(M.glow(0xfff1a0, 0.9)); core.scale.set(0.15, 0.3, 1); core.position.y = 2.1; g.add(core);
  g.userData.flames = [flame, core];
  g.userData.dynamic = false;
  return col(g, 0.3, 0.3);
}

// ---------------------------------------------------------------- bar & bottles
const BOTTLE_PROFILES = {
  wine: [[0, 0], [0.036, 0], [0.037, 0.01], [0.037, 0.2], [0.03, 0.235], [0.014, 0.262], [0.0125, 0.31], [0.015, 0.316], [0, 0.318]],
  whiskey: [[0, 0], [0.045, 0], [0.047, 0.01], [0.047, 0.16], [0.04, 0.19], [0.016, 0.21], [0.015, 0.25], [0.018, 0.255], [0, 0.258]],
  liqueur: [[0, 0], [0.03, 0], [0.05, 0.04], [0.055, 0.1], [0.045, 0.15], [0.015, 0.18], [0.012, 0.27], [0.016, 0.275], [0, 0.278]],
  beer: [[0, 0], [0.03, 0], [0.031, 0.01], [0.031, 0.12], [0.024, 0.15], [0.012, 0.18], [0.0115, 0.21], [0.013, 0.212], [0, 0.214]],
  champagne: [[0, 0], [0.04, 0], [0.041, 0.012], [0.041, 0.2], [0.032, 0.24], [0.017, 0.27], [0.016, 0.33], [0, 0.335]],
};
export const BOTTLE_TYPES = Object.keys(BOTTLE_PROFILES);
export function bottleGeometry(type) { return smoothLathe('bottle' + type, BOTTLE_PROFILES[type], 12, 10); }
const BOTTLE_COLORS = [0x2a5a1e, 0x6a2a0a, 0x9a5a14, 0x1a3a6a, 0xd8e8e0, 0x5a0a1a, 0xc8a030, 0x0a3a2a, 0xb04a10];
const LABEL_COLORS = [0xf3ead2, 0x111111, 0xc9a24a, 0xb3122e, 0xffffff, 0x1b3d6a];

/** Instanced shelf of bottles along X from -len/2..len/2. Returns group. */
export function bottleShelf(len, rows = 3, seed = 1, rowH = 0.42) {
  const g = new THREE.Group();
  const rng = makeRng(seed);
  const per = Math.floor(len / 0.11);
  const total = per * rows;
  const byType = {};
  for (const t of BOTTLE_TYPES) byType[t] = [];
  for (let r = 0; r < rows; r++) for (let i = 0; i < per; i++) {
    const t = rng.pick(BOTTLE_TYPES);
    byType[t].push({ x: -len / 2 + 0.06 + i * 0.11 + (rng() - 0.5) * 0.02, y: r * rowH + 0.02, z: (rng() - 0.5) * 0.06, c: rng.pick(BOTTLE_COLORS), l: rng.pick(LABEL_COLORS), ry: rng() * TAU, s: 0.9 + rng() * 0.2 });
  }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();
  const glass = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.05, metalness: 0.0, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.8, specularIntensity: 1 });
  const label = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.65 });
  const capM = M.gold();
  for (const t of BOTTLE_TYPES) {
    const list = byType[t]; if (!list.length) continue;
    const b = new THREE.InstancedMesh(bottleGeometry(t), glass, list.length);
    const lb = new THREE.InstancedMesh(G.cyl(1, 1, 1, 10, true), label, list.length);
    const cp = new THREE.InstancedMesh(G.cyl(1, 1, 1, 6), capM, list.length);
    const prof = BOTTLE_PROFILES[t];
    const rmax = Math.max(...prof.map((v) => v[0]));
    const top = prof[prof.length - 1][1];
    list.forEach((it, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), it.ry);
      m4.compose(p.set(it.x, it.y, it.z), q, sc.set(it.s, it.s, it.s)); b.setMatrixAt(i, m4); b.setColorAt(i, c.set(it.c));
      m4.compose(p.set(it.x, it.y + 0.09 * it.s, it.z), q, sc.set(rmax * it.s * 1.02, 0.07 * it.s, rmax * it.s * 1.02)); lb.setMatrixAt(i, m4); lb.setColorAt(i, c.set(it.l));
      m4.compose(p.set(it.x, it.y + top * it.s - 0.012, it.z), q, sc.set(0.017 * it.s, 0.03 * it.s, 0.017 * it.s)); cp.setMatrixAt(i, m4);
    });
    g.add(b, lb, cp);
  }
  void total;
  return g;
}

export function cocktailGlass(kind = 'martini', liquid = 0x7ad1ff) {
  const g = new THREE.Group();
  if (kind === 'martini') {
    mesh(G.cyl(0.035, 0.035, 0.004, 16), M.glass(), 0, 0.002, 0, { parent: g });
    mesh(G.cyl(0.004, 0.004, 0.09, 8), M.glass(), 0, 0.047, 0, { parent: g });
    mesh(G.cone(0.055, 0.07, 20), M.glass(), 0, 0.125, 0, { rx: Math.PI, parent: g });
    mesh(G.cone(0.046, 0.058, 20), M.liquid(liquid), 0, 0.12, 0, { rx: Math.PI, parent: g });
    mesh(G.sphere(0.009, 8, 6), M.plastic(0x2f8a2a), 0.012, 0.15, 0, { parent: g });
    mesh(G.cyl(0.0015, 0.0015, 0.09, 4), M.wood('oak'), 0.0, 0.16, 0, { rz: 0.6, parent: g });
  } else if (kind === 'tumbler') {
    mesh(G.cyl(0.038, 0.034, 0.09, 18, true), M.glass(), 0, 0.045, 0, { parent: g });
    mesh(G.cyl(0.034, 0.034, 0.01, 18), M.glass(), 0, 0.005, 0, { parent: g });
    mesh(G.cyl(0.034, 0.031, 0.05, 18), M.liquid(liquid), 0, 0.03, 0, { parent: g });
    mesh(G.box(0.025, 0.025, 0.025), M.glass(), 0.008, 0.055, 0.005, { rx: 0.4, ry: 0.3, parent: g });
  } else if (kind === 'tiki') {
    mesh(G.cyl(0.042, 0.036, 0.15, 14), M.plastic(0x6a3a1a, 0.6), 0, 0.075, 0, { parent: g });
    mesh(G.cyl(0.04, 0.04, 0.005, 14), M.liquid(liquid), 0, 0.148, 0, { parent: g });
    mesh(G.cone(0.05, 0.05, 8), M.plastic(0xff3a7a), 0.02, 0.2, 0, { rz: -0.5, parent: g });
    mesh(G.cyl(0.0035, 0.0035, 0.2, 6), M.plastic(0x33ccff), -0.012, 0.18, 0, { rz: 0.2, parent: g });
    mesh(G.sphere(0.018, 8, 6), M.plastic(0xffd400), 0.03, 0.16, 0.02, { parent: g });
  } else if (kind === 'beer') {
    mesh(G.cyl(0.04, 0.036, 0.14, 18, true), M.glass(), 0, 0.07, 0, { parent: g });
    mesh(G.cyl(0.036, 0.033, 0.11, 18), M.liquid(0xe0a020), 0, 0.058, 0, { parent: g });
    mesh(G.cyl(0.039, 0.037, 0.025, 18), M.matte(0xfff8e8, 0.6), 0, 0.125, 0, { parent: g });
    mesh(G.torus(0.03, 0.007, 6, 12, Math.PI), M.glass(), 0.045, 0.075, 0, { rz: -Math.PI / 2, parent: g });
  } else if (kind === 'champagne') {
    mesh(G.cyl(0.03, 0.03, 0.004, 16), M.glass(), 0, 0.002, 0, { parent: g });
    mesh(G.cyl(0.003, 0.003, 0.1, 8), M.glass(), 0, 0.05, 0, { parent: g });
    mesh(G.cyl(0.025, 0.015, 0.09, 16), M.liquid(0xf3d77a), 0, 0.145, 0, { parent: g });
  }
  return g;
}

export function barStool(style = 'chrome', seat = 0x7a1020) {
  const g = new THREE.Group();
  const met = style === 'wood' ? M.wood('rustic', 1, 1, false) : style === 'bamboo' ? M.bamboo(1, 1) : style === 'gold' ? M.gold() : M.chrome();
  mesh(G.cyl(0.2, 0.22, 0.03, 24), met, 0, 0.015, 0, { parent: g });
  mesh(G.cyl(0.03, 0.035, 0.68, 12), met, 0, 0.36, 0, { parent: g });
  mesh(G.torus(0.17, 0.012, 8, 28), met, 0, 0.3, 0, { rx: Math.PI / 2, parent: g });
  for (let i = 0; i < 4; i++) { const a = (i / 4) * TAU; mesh(G.cyl(0.01, 0.01, 0.17, 6), met, Math.cos(a) * 0.085, 0.3, Math.sin(a) * 0.085, { rz: Math.PI / 2, ry: -a, parent: g }); }
  mesh(G.cyl(0.21, 0.19, 0.04, 24), met, 0, 0.71, 0, { parent: g });
  mesh(smoothLathe('cushion', [[0, 0], [0.2, 0], [0.225, 0.03], [0.22, 0.07], [0.15, 0.095], [0, 0.1]], 12, 28), M.leather('#' + new THREE.Color(seat).getHexString(), false), 0, 0.73, 0, { parent: g });
  return col(g, 0.45, 0.45);
}

export function chair(fabric = 0x6a0f1c) {
  const g = new THREE.Group();
  const w = M.wood('mahogany');
  for (const [x, z] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) mesh(G.cyl(0.022, 0.017, 0.46, 8), w, x, 0.23, z, { parent: g });
  mesh(G.rbox(0.5, 0.09, 0.5, 0.03), M.velvet(fabric), 0, 0.5, 0, { parent: g });
  mesh(G.rbox(0.5, 0.05, 0.05, 0.02), w, 0, 0.45, 0, { parent: g });
  mesh(G.rbox(0.48, 0.55, 0.07, 0.03), M.velvet(fabric), 0, 0.82, -0.23, { rx: -0.08, parent: g });
  mesh(G.rbox(0.54, 0.06, 0.09, 0.025), w, 0, 1.11, -0.25, { rx: -0.08, parent: g });
  return col(g, 0.5, 0.5);
}

export function sofa(fabric = '#5c1018', len = 2) {
  const g = new THREE.Group();
  const lm = M.leather(fabric, true, len, 1);
  mesh(G.rbox(len, 0.38, 0.85, 0.06), lm, 0, 0.25, 0, { parent: g, cast: true });
  mesh(G.rbox(len, 0.7, 0.22, 0.08), lm, 0, 0.6, -0.33, { parent: g, cast: true });
  for (const s of [-1, 1]) mesh(G.rbox(0.2, 0.55, 0.85, 0.08), lm, s * (len / 2 + 0.05), 0.4, 0, { parent: g, cast: true });
  for (let i = 0; i < Math.round(len / 0.7); i++) mesh(G.rbox(len / Math.round(len / 0.7) - 0.04, 0.14, 0.6, 0.05), lm, -len / 2 + (i + 0.5) * len / Math.round(len / 0.7), 0.5, 0.06, { parent: g });
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) mesh(G.cyl(0.03, 0.02, 0.08, 8), M.gold(), x * (len / 2), 0.04, z * 0.35, { parent: g });
  return col(g, len + 0.3, 0.9);
}

export function coffeeTable() {
  const g = new THREE.Group();
  mesh(G.cyl(0.45, 0.45, 0.04, 32), M.marble('#1a1a1a', '#6a6a6a'), 0, 0.45, 0, { parent: g });
  mesh(G.torus(0.45, 0.012, 6, 40), M.gold(), 0, 0.45, 0, { rx: Math.PI / 2, parent: g });
  mesh(G.cyl(0.05, 0.08, 0.43, 12), M.gold(), 0, 0.215, 0, { parent: g });
  mesh(G.cyl(0.25, 0.28, 0.02, 24), M.gold(), 0, 0.01, 0, { parent: g });
  const drinks = cocktailGlass('martini', 0xff6aa8); drinks.position.set(0.15, 0.47, 0.1); g.add(drinks);
  const d2 = cocktailGlass('tumbler', 0xc8701a); d2.position.set(-0.12, 0.47, -0.08); g.add(d2);
  mesh(G.cyl(0.07, 0.06, 0.03, 16), M.crystal(), -0.1, 0.48, 0.18, { parent: g }); // ashtray
  return col(g, 0.9, 0.9);
}

/** The bar: counter, back bar with mirror + bottle shelves, taps, stools. Local: counter along X, customers at +Z. */
export function bar(len = 7, style = 'palace') {
  const g = new THREE.Group();
  const wood = style === 'western' ? M.wood('rustic', 3, 1) : style === 'tiki' ? M.bamboo(4, 1) : style === 'neon' ? M.lacquer(0x0d0d14) : M.wood('mahogany', 3, 1);
  const top = style === 'western' ? M.wood('walnut', 3, 1) : style === 'neon' ? M.marble('#111118', '#4a4a66', 3, 1) : M.marble('#1d1a18', '#8a7a62', 3, 1);
  // front counter
  mesh(G.rbox(len, 1.05, 0.6, 0.03), wood, 0, 0.525, 0, { parent: g, cast: true });
  for (let i = 0; i < Math.floor(len / 0.9); i++) {
    const x = -len / 2 + 0.45 + i * 0.9 + (len % 0.9) / 2;
    mesh(G.rbox(0.7, 0.7, 0.03, 0.02), style === 'tiki' ? M.matte(0x5a3a1c) : wood, x, 0.55, 0.31, { parent: g });
    if (style === 'neon') mesh(G.box(0.72, 0.02, 0.01), M.neon(i % 2 ? 0xff2bd6 : 0x2bf0ff, 3), x, 0.92, 0.33, { parent: g });
  }
  mesh(G.rbox(len + 0.2, 0.06, 0.8, 0.025), top, 0, 1.08, 0.05, { parent: g });
  mesh(G.cyl(0.03, 0.03, len, 14), M.brass(), 0, 0.2, 0.42, { rz: Math.PI / 2, parent: g });
  for (let i = 0; i <= Math.floor(len / 1.2); i++) mesh(G.box(0.03, 0.14, 0.12), M.brass(), -len / 2 + 0.1 + i * 1.2, 0.13, 0.37, { parent: g });
  mesh(G.cyl(0.035, 0.035, len, 14), style === 'western' ? M.wood('rustic') : M.leather('#3a1a10', false, 4, 1), 0, 1.07, 0.47, { rz: Math.PI / 2, parent: g });
  // back bar
  const bz = -1.25;
  mesh(G.rbox(len, 0.95, 0.5, 0.02), wood, 0, 0.475, bz, { parent: g });
  mesh(G.rbox(len + 0.1, 0.04, 0.55, 0.01), top, 0, 0.97, bz, { parent: g });
  const mirror = mesh(G.plane(len - 0.4, 1.4), new THREE.MeshStandardMaterial({ color: 0x8a8a90, metalness: 1, roughness: 0.04 }), 0, 1.85, bz - 0.24, { parent: g });
  mirror.material.userData.shared = false;
  for (let r = 0; r < 3; r++) mesh(G.box(len - 0.3, 0.03, 0.26), M.glassTint(0xdde8ff), 0, 1.2 + r * 0.45, bz - 0.12, { parent: g });
  const shelf = bottleShelf(len - 0.6, 3, len * 13 + style.length, 0.45);
  shelf.position.set(0, 1.215, bz - 0.12); g.add(shelf);
  const shelf2 = bottleShelf(len - 0.8, 1, 77, 0.45); shelf2.position.set(0, 0.99, bz + 0.05); g.add(shelf2);
  // frame
  for (const s of [-1, 1]) mesh(G.box(0.18, 2.6, 0.6), wood, s * (len / 2 - 0.05), 1.3, bz - 0.05, { parent: g });
  mesh(G.box(len, 0.3, 0.6), wood, 0, 2.7, bz - 0.05, { parent: g });
  for (let i = 0; i < 6; i++) mesh(G.sphere(0.04, 10, 8), M.bulb(0xffd6a0, 5), -len / 2 + 0.6 + i * (len - 1.2) / 5, 2.53, bz + 0.2, { parent: g });
  // beer taps
  for (let i = 0; i < 4; i++) {
    const x = -0.5 + i * 0.3;
    mesh(G.cyl(0.02, 0.02, 0.3, 10), M.chrome(), x, 1.25, -0.12, { parent: g });
    mesh(G.cyl(0.012, 0.012, 0.1, 8), M.chrome(), x, 1.37, -0.06, { rx: Math.PI / 2, parent: g });
    mesh(G.cyl(0.018, 0.014, 0.16, 8), M.lacquer([0xc8102e, 0x1b5fc8, 0xe8c25a, 0x1a1a1a][i]), x, 1.48, -0.12, { parent: g });
  }
  mesh(G.box(1.3, 0.02, 0.18), M.steel(), -0.05, 1.115, -0.12, { parent: g });
  // register
  const reg = new THREE.Group();
  mesh(G.rbox(0.35, 0.2, 0.32, 0.02), M.lacquer(0x1a1a1a), 0, 0.1, 0, { parent: reg });
  mesh(G.rbox(0.25, 0.12, 0.03, 0.01), M.emissive(0x2aff8a, 1.2), 0, 0.27, -0.05, { rx: -0.3, parent: reg });
  reg.position.set(len / 2 - 0.6, 1.11, -0.1); g.add(reg);
  // glasses on counter
  const glassTypes = style === 'tiki' ? ['tiki', 'tiki', 'martini'] : style === 'western' ? ['beer', 'tumbler', 'beer'] : ['martini', 'champagne', 'tumbler'];
  const rng = makeRng(len * 7);
  for (let i = 0; i < 6; i++) {
    const gl = cocktailGlass(glassTypes[i % 3], [0x7ad1ff, 0xff6aa8, 0xc8701a, 0x9aff6a][i % 4]);
    gl.position.set(-len / 2 + 0.6 + rng() * (len - 1.2), 1.11, 0.15 + rng() * 0.2); g.add(gl);
  }
  // napkin holders / bowls of peanuts
  for (let i = 0; i < 3; i++) {
    const x = -len / 3 + i * len / 3;
    mesh(G.sphere(0.07, 14, 8), M.ceramic(0xf3ece0), x, 1.12, 0.3, { s: [1, 0.45, 1], parent: g });
    mesh(G.sphere(0.06, 10, 6), M.matte(0xc8945a, 0.6), x, 1.13, 0.3, { s: [1, 0.35, 1], parent: g });
  }
  g.userData.collider = { w: len + 0.2, d: 2.2, ox: 0, oz: -0.55 };
  return g;
}

// ---------------------------------------------------------------- signage
/** Glowing neon text sign. Returns group with `.userData.mat` for flicker. */
export function neonSign(text, color = '#ff3df0', { height = 0.6, font = 'bold 140px "Arial Black", Impact, sans-serif', backing = true, frame = true } = {}) {
  const g = new THREE.Group();
  const { tex, aspect } = textTexture(text, { font, color: '#ffffff', glow: color, stroke: color, strokeWidth: 10, padding: 50 });
  const w = height * aspect;
  const mat = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(color).multiplyScalar(3.2), transparent: true, depthWrite: false, toneMapped: true });
  const face = new THREE.Mesh(G.plane(w, height), mat);
  face.position.z = 0.04; g.add(face);
  if (backing) mesh(G.rbox(w * 0.92, height * 0.9, 0.05, 0.02), M.blackMetal(), 0, 0, 0, { parent: g });
  if (frame) {
    const fm = M.neon(new THREE.Color(color).getHex(), 2.2);
    mesh(G.box(w * 0.94, 0.02, 0.02), fm, 0, height * 0.46, 0.04, { parent: g });
    mesh(G.box(w * 0.94, 0.02, 0.02), fm, 0, -height * 0.46, 0.04, { parent: g });
  }
  g.userData.neonMat = mat;
  g.userData.w = w;
  return g;
}

/** Marquee panel with chasing bulbs (classic Vegas sign). */
export function marquee(text, w = 3, h = 0.9, color = '#ffd24a', bg = '#7a0a14') {
  const g = new THREE.Group();
  mesh(G.rbox(w, h, 0.15, 0.04), M.lacquer(new THREE.Color(bg).getHex()), 0, 0, 0, { parent: g });
  const { tex } = textTexture(text, { font: 'bold 150px "Arial Black", Impact, sans-serif', color, stroke: '#2a0a00', strokeWidth: 14, padding: 30 });
  const face = new THREE.Mesh(G.plane(w * 0.86, h * 0.62), signMaterial(tex, 1.25));
  face.position.z = 0.08; g.add(face);
  const n = Math.round((w + h) * 2 / 0.14);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = i / n * 2 * (w + h);
    let x, y;
    if (t < w) { x = -w / 2 + t; y = h / 2 - 0.05; } else if (t < w + h) { x = w / 2 - 0.05; y = h / 2 - (t - w); } else if (t < 2 * w + h) { x = w / 2 - (t - w - h); y = -h / 2 + 0.05; } else { x = -w / 2 + 0.05; y = -h / 2 + (t - 2 * w - h); }
    pts.push(new THREE.Vector3(x * 0.97, y * 0.95, 0.08));
  }
  const inst = new THREE.InstancedMesh(G.sphere(0.03, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }), n);
  const m4 = new THREE.Matrix4(); pts.forEach((p, i) => { m4.makeTranslation(p.x, p.y, p.z); inst.setMatrixAt(i, m4); inst.setColorAt(i, new THREE.Color(0xffe08a).multiplyScalar(3)); });
  g.add(inst);
  g.userData.bulbs = inst; g.userData.on = new THREE.Color(0xffe08a).multiplyScalar(3); g.userData.off = new THREE.Color(0x3a2410);
  g.userData.dynamic = true;
  return g;
}

/** Framed painting — procedurally painted jelly portraits and casino scenes. */
export function painting(seed = 1, w = 1.2, h = 0.9) {
  const g = new THREE.Group();
  const tex = cached('painting' + seed, () => {
    const { c, g: x } = makeCanvas(512, 384);
    const r = makeRng(seed);
    const bgc = ['#2a1a3a', '#1a2a3a', '#3a1a1a', '#1a3a2a', '#3a2a1a'][seed % 5];
    const gr = x.createLinearGradient(0, 0, 0, 384); gr.addColorStop(0, bgc); gr.addColorStop(1, '#0a0a0a');
    x.fillStyle = gr; x.fillRect(0, 0, 512, 384);
    // painterly strokes
    for (let i = 0; i < 300; i++) { x.fillStyle = `hsla(${r() * 360},40%,${20 + r() * 20}%,0.08)`; x.beginPath(); x.ellipse(r() * 512, r() * 384, 20 + r() * 50, 5 + r() * 12, r() * TAU, 0, TAU); x.fill(); }
    const kind = seed % 3;
    const jelly = (cx, cy, s, hue, hat) => {
      const bg = x.createRadialGradient(cx - s * 0.2, cy - s * 0.4, s * 0.1, cx, cy, s * 1.1);
      bg.addColorStop(0, `hsl(${hue},80%,72%)`); bg.addColorStop(1, `hsl(${hue},70%,38%)`);
      x.fillStyle = bg; x.beginPath(); x.ellipse(cx, cy, s * 0.55, s, 0, 0, TAU); x.fill();
      for (const sx of [-1, 1]) { x.fillStyle = '#fff'; x.beginPath(); x.arc(cx + sx * s * 0.2, cy - s * 0.45, s * 0.17, 0, TAU); x.fill(); x.fillStyle = '#111'; x.beginPath(); x.arc(cx + sx * s * 0.2 + (r() - 0.5) * s * 0.1, cy - s * 0.4, s * 0.08, 0, TAU); x.fill(); }
      x.strokeStyle = '#3a0a0a'; x.lineWidth = s * 0.04; x.beginPath(); x.arc(cx, cy - s * 0.2, s * 0.15, 0.2, Math.PI - 0.2); x.stroke();
      if (hat) { x.fillStyle = '#1a1a1a'; x.fillRect(cx - s * 0.45, cy - s * 0.98, s * 0.9, s * 0.08); x.fillRect(cx - s * 0.28, cy - s * 1.35, s * 0.56, s * 0.4); }
      x.fillStyle = `hsl(${(hue + 160) % 360},70%,50%)`; x.fillRect(cx - s * 0.55, cy + s * 0.2, s * 1.1, s * 0.8);
    };
    if (kind === 0) { jelly(256, 210, 120, r() * 360, true); }
    else if (kind === 1) {
      x.fillStyle = '#0f4a2a'; x.beginPath(); x.ellipse(256, 300, 230, 70, 0, 0, TAU); x.fill();
      [[110, 200], [256, 170], [400, 200]].forEach(([cx, cy], i) => jelly(cx, cy, 70, (i * 120 + seed * 40) % 360, i === 1));
      for (let i = 0; i < 5; i++) { x.fillStyle = '#fff'; x.fillRect(190 + i * 28, 280, 22, 32); x.fillStyle = '#c00'; x.fillText('♥', 196 + i * 28, 300); }
    } else {
      for (let i = 0; i < 3; i++) { x.fillStyle = `hsl(${r() * 360},70%,55%)`; x.beginPath(); x.arc(130 + i * 130, 190, 55, 0, TAU); x.fill(); x.fillStyle = '#fff'; x.font = 'bold 60px Georgia'; x.textAlign = 'center'; x.fillText(['7', '$', '♣'][i], 130 + i * 130, 210); }
    }
    return toTex(c, { wrap: false });
  });
  const fr = M.gold();
  mesh(G.rbox(w + 0.16, h + 0.16, 0.06, 0.02), fr, 0, 0, 0, { parent: g });
  mesh(G.plane(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55 }), 0, 0, 0.032, { parent: g });
  return g;
}

// ---------------------------------------------------------------- machines & fixtures
export function atm() {
  const g = new THREE.Group();
  mesh(G.rbox(0.8, 1.7, 0.6, 0.04), M.lacquer(0x1a3a6a), 0, 0.85, 0, { parent: g, cast: true });
  mesh(G.rbox(0.82, 0.25, 0.62, 0.04), M.lacquer(0x0d1d3a), 0, 1.83, 0, { parent: g });
  const { tex } = textTexture('CASH $', { font: 'bold 90px "Arial Black", sans-serif', color: '#7dffb0', padding: 20 });
  mesh(G.plane(0.6, 0.18), signMaterial(tex, 2), 0, 1.83, 0.315, { parent: g });
  mesh(G.rbox(0.5, 0.36, 0.05, 0.02), M.blackMetal(), 0, 1.3, 0.3, { rx: -0.2, parent: g });
  const sc = makeCanvas(256, 180);
  const sg = sc.g; const sgr = sg.createLinearGradient(0, 0, 0, 180); sgr.addColorStop(0, '#0a3a6a'); sgr.addColorStop(1, '#021a3a'); sg.fillStyle = sgr; sg.fillRect(0, 0, 256, 180);
  sg.fillStyle = '#fff'; sg.font = 'bold 26px sans-serif'; sg.textAlign = 'center'; sg.fillText('EMERGENCY', 128, 60); sg.fillText('CASH ADVANCE', 128, 95); sg.fillStyle = '#7dffb0'; sg.font = 'bold 22px sans-serif'; sg.fillText('press E', 128, 140);
  mesh(G.plane(0.44, 0.3), signMaterial(toTex(sc.c, { wrap: false }), 1.4, false), 0, 1.3, 0.33, { rx: -0.2, parent: g });
  for (let i = 0; i < 12; i++) mesh(G.rbox(0.07, 0.05, 0.03, 0.01), M.steel(), -0.1 + (i % 3) * 0.1, 0.92 + Math.floor(i / 3) * -0.07 + 0.1, 0.33, { rx: -0.5, parent: g });
  mesh(G.box(0.3, 0.03, 0.04), M.blackMetal(), 0, 0.62, 0.31, { parent: g });
  return col(g, 0.85, 0.65);
}

export function cashierCage(w = 4) {
  const g = new THREE.Group();
  const wood = M.wood('mahogany', 2, 1);
  mesh(G.rbox(w, 1.1, 0.7, 0.03), wood, 0, 0.55, 0, { parent: g, cast: true });
  mesh(G.rbox(w + 0.1, 0.06, 0.8, 0.02), M.marble('#efe6d6', '#8a7a62'), 0, 1.13, 0, { parent: g });
  for (let i = 0; i <= Math.round(w / 0.09); i++) mesh(G.cyl(0.008, 0.008, 1.2, 6), M.gold(), -w / 2 + i * 0.09, 1.76, -0.1, { parent: g });
  mesh(G.box(w, 0.08, 0.06), M.gold(), 0, 2.38, -0.1, { parent: g });
  for (const x of [-w / 4, w / 4]) mesh(G.box(0.6, 0.45, 0.07), M.gold(), x, 1.38, -0.1, { parent: g });
  const sign = marquee('CASHIER', w * 0.6, 0.45, '#ffe08a', '#1a1a1a'); sign.position.set(0, 2.75, -0.1); g.add(sign);
  mesh(G.box(w, 2.5, 0.1), M.damask('#2a1a10', '#8a6a3a', 2, 1), 0, 1.25, -1.0, { parent: g });
  return col(g, w + 0.2, 1.2, 0, -0.3);
}

export function exitDoors(theme = 'palace') {
  const g = new THREE.Group();
  const fr = theme === 'western' ? M.wood('rustic', 1, 2) : M.gold();
  mesh(G.box(3.2, 0.3, 0.4), fr, 0, 3.15, 0, { parent: g });
  for (const s of [-1, 1]) mesh(G.box(0.25, 3.3, 0.4), fr, s * 1.6, 1.65, 0, { parent: g });
  for (const s of [-1, 1]) {
    const door = new THREE.Group();
    const dm = theme === 'western' ? M.wood('walnut', 1, 2) : M.wood('mahogany', 1, 2);
    mesh(G.rbox(1.45, 2.95, 0.08, 0.02), dm, 0, 1.5, 0, { parent: door, cast: true });
    mesh(G.box(1.1, 1.6, 0.02), M.glassTint(0xffe8c0), 0, 1.8, 0.04, { parent: door });
    mesh(G.box(1.1, 0.04, 0.03), fr, 0, 2.62, 0.05, { parent: door });
    mesh(G.box(1.1, 0.04, 0.03), fr, 0, 0.98, 0.05, { parent: door });
    mesh(G.cyl(0.022, 0.022, 0.9, 10), M.brass(), -s * 0.55, 1.15, 0.09, { rz: Math.PI / 2, parent: door });
    door.position.set(s * 0.75, 0, 0);
    g.add(door);
  }
  const ex = neonSign('EXIT', '#38ff6a', { height: 0.45, backing: true, frame: false });
  ex.position.set(0, 3.65, 0.1); g.add(ex);
  // stanchions guiding out
  for (const s of [-1, 1]) { const st = stanchion(theme !== 'neon'); st.position.set(s * 1.8, 0, 1.4); g.add(st); }
  const rope1 = velvetRope(new THREE.Vector3(-1.8, 0.95, 1.4), new THREE.Vector3(-1.8, 0.95, 3.0)); g.add(rope1);
  const rope2 = velvetRope(new THREE.Vector3(1.8, 0.95, 1.4), new THREE.Vector3(1.8, 0.95, 3.0)); g.add(rope2);
  for (const s of [-1, 1]) { const st = stanchion(theme !== 'neon'); st.position.set(s * 1.8, 0, 3.0); g.add(st); }
  // red carpet runner
  mesh(G.plane(2.6, 4), M.velvet(0x8b0a1e), 0, 0.012, 1.8, { rx: -Math.PI / 2, parent: g });
  return g;
}

export function trashBin() {
  const g = new THREE.Group();
  mesh(G.cyl(0.2, 0.18, 0.75, 20), M.goldBrushed(), 0, 0.375, 0, { parent: g });
  mesh(G.cyl(0.21, 0.21, 0.05, 20), M.blackMetal(), 0, 0.77, 0, { parent: g });
  mesh(G.cyl(0.14, 0.14, 0.02, 16), M.matte(0xd8d0c0, 0.95), 0, 0.8, 0, { parent: g });
  return col(g, 0.45, 0.45);
}

export function statue(material) {
  const g = new THREE.Group();
  mesh(G.rbox(1.2, 0.9, 1.2, 0.05), M.marble('#1a1a1a', '#5a5a5a'), 0, 0.45, 0, { parent: g, cast: true });
  mesh(G.rbox(1.3, 0.1, 1.3, 0.03), M.gold(), 0, 0.95, 0, { parent: g });
  const { tex } = textTexture('LADY LUCK', { font: 'bold 70px Georgia, serif', color: '#ffd76a', padding: 16 });
  mesh(G.plane(0.9, 0.2), signMaterial(tex, 1.6), 0, 0.55, 0.605, { parent: g });
  g.userData.statueMat = material;
  return col(g, 1.3, 1.3);
}

export function fountain() {
  const g = new THREE.Group();
  const marble = M.marble('#f3eee6', '#a89a86');
  mesh(smoothLathe('fbasin', [[0, 0], [1.9, 0], [2.0, 0.1], [2.0, 0.55], [1.85, 0.6], [1.8, 0.2], [0, 0.2]], 20, 48), marble, 0, 0, 0, { parent: g, cast: true });
  const water = new THREE.Mesh(G.circle(1.8, 48), new THREE.MeshPhysicalMaterial({ color: 0x1a6a8a, roughness: 0.05, metalness: 0.1, transmission: 0, transparent: true, opacity: 0.85, clearcoat: 1, envMapIntensity: 2 }));
  water.rotation.x = -Math.PI / 2; water.position.y = 0.45; g.add(water);
  mesh(smoothLathe('fstem', [[0.35, 0], [0.25, 0.3], [0.18, 1.0], [0.3, 1.2], [0.9, 1.35], [0.92, 1.45], [0.2, 1.5], [0.12, 2.0], [0.3, 2.3], [0.05, 2.45]], 24, 32), marble, 0, 0.2, 0, { parent: g });
  mesh(G.sphere(0.18, 16, 12), M.gold(), 0, 2.75, 0, { parent: g });
  const jets = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    const jet = new THREE.Sprite(M.glow(0xbfefff, 0.5)); jet.scale.set(0.15, 0.6, 1); jet.position.set(Math.cos(a) * 0.95, 1.35, Math.sin(a) * 0.95); g.add(jet); jets.push(jet);
  }
  g.userData.water = water; g.userData.jets = jets;
  return col(g, 4.0, 4.0);
}

export function aquarium(w = 4, h = 2) {
  const g = new THREE.Group();
  mesh(G.rbox(w + 0.2, 0.6, 0.9, 0.03), M.wood('walnut', 2, 1), 0, 0.3, 0, { parent: g });
  mesh(G.box(w, h, 0.7), new THREE.MeshPhysicalMaterial({ color: 0x0a4a6a, emissive: 0x0a5a8a, emissiveIntensity: 0.6, roughness: 0.05, transparent: true, opacity: 0.55, depthWrite: false }), 0, 0.6 + h / 2, 0, { parent: g });
  mesh(G.box(w + 0.1, 0.1, 0.8), M.blackMetal(), 0, 0.65 + h, 0, { parent: g });
  mesh(G.box(w - 0.1, 0.2, 0.6), M.matte(0xe6d6a0, 0.9), 0, 0.7, 0, { parent: g });
  const fish = [];
  const rng = makeRng(5);
  for (let i = 0; i < 9; i++) {
    const f = new THREE.Group();
    const c = [0xff8a2a, 0xffd400, 0x33ccff, 0xff4f8b, 0xffffff][i % 5];
    mesh(G.sphere(0.08, 12, 8), M.plastic(c, 0.3), 0, 0, 0, { s: [1.6, 1, 0.5], parent: f });
    mesh(G.cone(0.07, 0.1, 4), M.plastic(c, 0.3), -0.16, 0, 0, { rz: Math.PI / 2, s: [1, 1, 0.3], parent: f });
    for (const s of [-1, 1]) mesh(G.sphere(0.02, 6, 6), M.matte(0x111111), 0.08, 0.02, s * 0.035, { parent: f });
    f.position.set((rng() - 0.5) * w * 0.8, 0.9 + rng() * (h - 0.6), (rng() - 0.5) * 0.4);
    f.userData = { speed: 0.3 + rng() * 0.4, dir: rng() < 0.5 ? 1 : -1, phase: rng() * 10, w };
    g.add(f); fish.push(f);
  }
  for (let i = 0; i < 7; i++) { const sw = mesh(G.cone(0.05, 0.6 + rng() * 0.6, 5), M.plastic(0x2a8a3a, 0.6), (rng() - 0.5) * w * 0.9, 1.1, (rng() - 0.5) * 0.4, { parent: g }); sw.userData.sway = rng() * 10; }
  g.userData.fish = fish;
  g.userData.dynamic = true;
  return col(g, w + 0.3, 1.0);
}

export function barrel() {
  const g = new THREE.Group();
  mesh(smoothLathe('barrel', [[0, 0], [0.28, 0], [0.33, 0.25], [0.35, 0.45], [0.33, 0.65], [0.28, 0.9], [0, 0.9]], 16, 20), M.wood('rustic', 1, 1, false), 0, 0, 0, { parent: g, cast: true });
  for (const y of [0.12, 0.3, 0.6, 0.78]) mesh(G.torus(y < 0.2 || y > 0.7 ? 0.3 : 0.345, 0.012, 6, 24), M.iron(), 0, y, 0, { rx: Math.PI / 2, parent: g });
  return col(g, 0.7, 0.7);
}

export function wantedPoster(seed = 1) {
  const tex = cached('wanted' + seed, () => {
    const { c, g } = makeCanvas(256, 360);
    g.fillStyle = '#e8d4a8'; g.fillRect(0, 0, 256, 360);
    for (let i = 0; i < 2000; i++) { g.fillStyle = `rgba(120,80,30,${Math.random() * 0.08})`; g.fillRect(Math.random() * 256, Math.random() * 360, 3, 3); }
    g.fillStyle = '#3a2410'; g.textAlign = 'center'; g.font = 'bold 54px Georgia, serif'; g.fillText('WANTED', 128, 60);
    g.font = 'bold 20px Georgia, serif'; g.fillText('FOR CARD COUNTING', 128, 90);
    const hue = (seed * 77) % 360;
    g.fillStyle = `hsl(${hue},60%,60%)`; g.beginPath(); g.ellipse(128, 200, 60, 90, 0, 0, TAU); g.fill();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(105, 165, 22, 0, TAU); g.arc(151, 165, 22, 0, TAU); g.fill();
    g.fillStyle = '#111'; g.beginPath(); g.arc(108, 175, 10, 0, TAU); g.arc(148, 172, 10, 0, TAU); g.fill();
    g.font = 'bold 34px Georgia, serif'; g.fillStyle = '#3a2410'; g.fillText('$' + (500 + seed * 250) + ' REWARD', 128, 335);
    return toTex(c, { wrap: false });
  });
  return new THREE.Mesh(G.plane(0.5, 0.7), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }));
}

export function wagonWheel() {
  const g = new THREE.Group();
  const w = M.wood('rustic', 1, 1, false);
  mesh(G.torus(0.6, 0.05, 8, 32), w, 0, 0, 0, { parent: g });
  mesh(G.torus(0.6, 0.02, 6, 32), M.iron(), 0, 0, 0.03, { parent: g });
  mesh(G.cyl(0.1, 0.1, 0.12, 12), w, 0, 0, 0, { rx: Math.PI / 2, parent: g });
  for (let i = 0; i < 6; i++) mesh(G.box(1.2, 0.035, 0.04), w, 0, 0, 0, { rz: (i / 6) * Math.PI, parent: g });
  return g;
}

export function planetModel(r = 0.8, color = 0xff8a2a, ring = true) {
  const g = new THREE.Group();
  mesh(G.sphere(r, 32, 20), new THREE.MeshStandardMaterial({ color, roughness: 0.6, emissive: color, emissiveIntensity: 0.25 }), 0, 0, 0, { parent: g });
  if (ring) mesh(G.ring(r * 1.35, r * 1.9, 64), new THREE.MeshStandardMaterial({ color: 0xffe6a0, side: THREE.DoubleSide, transparent: true, opacity: 0.7, emissive: 0xffc070, emissiveIntensity: 0.4 }), 0, 0, 0, { rx: -Math.PI / 2 + 0.35, parent: g });
  g.userData.dynamic = true;
  return g;
}

export function rocketModel() {
  const g = new THREE.Group();
  mesh(smoothLathe('rocket', [[0, 0], [0.32, 0.05], [0.4, 0.6], [0.4, 1.8], [0.3, 2.4], [0.12, 2.8], [0, 2.95]], 32, 28), M.lacquer(0xf2f2f2), 0, 0.3, 0, { parent: g, cast: true });
  for (let i = 0; i < 4; i++) { const a = (i / 4) * TAU; mesh(G.box(0.05, 0.7, 0.45), M.lacquer(0xd9182e), Math.cos(a) * 0.45, 0.65, Math.sin(a) * 0.45, { ry: -a, parent: g }); }
  mesh(G.cyl(0.16, 0.16, 0.05, 20), M.chrome(), 0, 2.0, 0.39, { rx: Math.PI / 2, parent: g });
  mesh(G.cyl(0.13, 0.13, 0.03, 20), M.glassTint(0x6ad1ff), 0, 2.0, 0.41, { rx: Math.PI / 2, parent: g });
  mesh(G.cone(0.3, 0.4, 20), M.steel(), 0, 0.15, 0, { rx: Math.PI, parent: g });
  const flame = new THREE.Sprite(M.glow(0xff8a2a, 0.9)); flame.scale.set(0.6, 1.0, 1); flame.position.y = -0.3; g.add(flame);
  g.userData.flames = [flame];
  return col(g, 1.2, 1.2);
}

export function jackpotBoard(w = 4, h = 1.1) {
  const g = new THREE.Group();
  mesh(G.rbox(w, h, 0.2, 0.05), M.lacquer(0x120408), 0, 0, 0, { parent: g });
  for (const y of [h / 2, -h / 2]) mesh(G.box(w, 0.05, 0.22), M.gold(), 0, y, 0, { parent: g });
  const { c, g: ctx } = makeCanvas(1024, 256);
  const tex = toTex(c, { wrap: false });
  const mat = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(2.2, 2.2, 2.2) });
  const face = mesh(G.plane(w * 0.94, h * 0.84), mat, 0, 0, 0.105, { parent: g });
  face.userData.dynamic = true;
  g.userData.dynamic = true;
  g.userData.draw = (value, t) => {
    ctx.fillStyle = '#050102'; ctx.fillRect(0, 0, 1024, 256);
    // LED dot grid
    ctx.fillStyle = 'rgba(255,60,40,0.08)';
    for (let x = 4; x < 1024; x += 8) for (let y = 4; y < 256; y += 8) ctx.fillRect(x, y, 3, 3);
    ctx.textAlign = 'center';
    const pulse = 0.75 + 0.25 * Math.sin(t * 4);
    ctx.font = 'bold 64px "Arial Black", Impact, sans-serif';
    ctx.fillStyle = `rgba(255,${190 + 40 * pulse},60,1)`;
    ctx.shadowColor = '#ff7a1a'; ctx.shadowBlur = 20;
    ctx.fillText('★ MEGA JACKPOT ★', 512, 84);
    ctx.font = 'bold 110px "Courier New", monospace';
    ctx.fillStyle = '#ff3a2a';
    ctx.fillText('$' + value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), 512, 205);
    ctx.shadowBlur = 0;
    tex.needsUpdate = true;
  };
  return g;
}

export function rug(w, d, mat) {
  const m = new THREE.Mesh(G.plane(w, d), mat);
  m.rotation.x = -Math.PI / 2; m.position.y = 0.006; m.receiveShadow = true;
  return m;
}

export function ropeLine(points, stanchionGold = true) {
  const g = new THREE.Group();
  for (const p of points) { const s = stanchion(stanchionGold); s.position.copy(p); g.add(s); }
  for (let i = 0; i < points.length - 1; i++) g.add(velvetRope(points[i].clone().setY(0.95), points[i + 1].clone().setY(0.95)));
  return g;
}

export function loungeSet(theme) {
  const g = new THREE.Group();
  const fab = theme === 'tiki' ? '#c25a1a' : theme === 'neon' ? '#3a0a5a' : theme === 'western' ? '#6a3a1a' : '#5c1018';
  const s1 = sofa(fab, 2.2); s1.position.set(0, 0, -1.1); g.add(s1);
  const s2 = sofa(fab, 2.2); s2.position.set(0, 0, 1.1); s2.rotation.y = Math.PI; g.add(s2);
  const t = coffeeTable(); g.add(t);
  return g;
}

export function roundedPanel(w, h, r, depth, mat) {
  return new THREE.Mesh(new THREE.ExtrudeGeometry(roundedRectShape(w, h, r), { depth, bevelEnabled: false }), mat);
}
