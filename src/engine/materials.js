import * as THREE from 'three';
import * as T from './textures.js';

// Shared, time-driven uniforms (neon flicker, jelly wobble, screens...)
export const globalUniforms = {
  uTime: { value: 0 },
};

const cache = new Map();
function get(key, fn) {
  if (!cache.has(key)) {
    const m = fn();
    m.userData.shared = true;
    cache.set(key, m);
  }
  return cache.get(key);
}
export function clearMaterialCache() {
  for (const m of cache.values()) m.dispose();
  cache.clear();
}

const std = (o) => new THREE.MeshStandardMaterial(o);
const phys = (o) => new THREE.MeshPhysicalMaterial(o);

function withRepeat(set, rx, ry) {
  const out = {};
  for (const k in set) {
    const t = set[k].clone();
    t.repeat.set(rx, ry);
    t.userData.shared = true;
    t.needsUpdate = true;
    out[k] = t;
  }
  return out;
}

export const M = {
  gold: () => get('gold', () => std({ color: 0xffc35a, metalness: 1, roughness: 0.22, envMapIntensity: 1.2 })),
  goldBrushed: () => get('goldBrushed', () => std({ color: 0xe9b04d, metalness: 1, roughness: 0.35, normalMap: T.brushedNormal(), normalScale: new THREE.Vector2(0.3, 0.3) })),
  brass: () => get('brass', () => std({ color: 0xc9a050, metalness: 1, roughness: 0.3 })),
  copper: () => get('copper', () => std({ color: 0xd8835a, metalness: 1, roughness: 0.3 })),
  chrome: () => get('chrome', () => std({ color: 0xf2f4f8, metalness: 1, roughness: 0.08, envMapIntensity: 1.3 })),
  steel: () => get('steel', () => std({ color: 0x9aa0a8, metalness: 1, roughness: 0.35, normalMap: T.brushedNormal(), normalScale: new THREE.Vector2(0.4, 0.4) })),
  blackMetal: () => get('blackMetal', () => std({ color: 0x18181c, metalness: 0.8, roughness: 0.35 })),
  iron: () => get('iron', () => std({ color: 0x2a2726, metalness: 0.9, roughness: 0.55 })),
  glass: () => get('glass', () => phys({ color: 0xffffff, metalness: 0, roughness: 0.02, transmission: 0, transparent: true, opacity: 0.18, envMapIntensity: 1.5, depthWrite: false, side: THREE.DoubleSide })),
  glassTint: (hex) => get('glassTint' + hex, () => phys({ color: hex, metalness: 0, roughness: 0.05, transparent: true, opacity: 0.55, envMapIntensity: 1.4, depthWrite: false })),
  crystal: () => get('crystal', () => phys({ color: 0xffffff, metalness: 0.1, roughness: 0.0, transparent: true, opacity: 0.6, envMapIntensity: 2.5, emissive: 0x442a10, emissiveIntensity: 0.4 })),
  bottle: (hex) => get('bottle' + hex, () => phys({ color: hex, metalness: 0, roughness: 0.06, transparent: true, opacity: 0.78, envMapIntensity: 1.6, clearcoat: 1, clearcoatRoughness: 0.05 })),
  liquid: (hex) => get('liquid' + hex, () => phys({ color: hex, metalness: 0, roughness: 0.1, transparent: true, opacity: 0.85, emissive: hex, emissiveIntensity: 0.08 })),
  label: (hex) => get('label' + hex, () => std({ color: hex, roughness: 0.6 })),
  plastic: (hex, rough = 0.35) => get('plastic' + hex + rough, () => phys({ color: hex, roughness: rough, metalness: 0, clearcoat: 0.5, clearcoatRoughness: 0.2 })),
  matte: (hex, rough = 0.85) => get('matte' + hex + rough, () => std({ color: hex, roughness: rough, metalness: 0 })),
  lacquer: (hex) => get('lacquer' + hex, () => phys({ color: hex, roughness: 0.3, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.08 })),
  emissive: (hex, intensity = 2) => get('emis' + hex + intensity, () => new THREE.MeshStandardMaterial({ color: 0x000000, emissive: hex, emissiveIntensity: intensity, roughness: 0.4 })),
  basicGlow: (hex, opacity = 1) => get('bglow' + hex + opacity, () => new THREE.MeshBasicMaterial({ color: hex, transparent: opacity < 1, opacity, toneMapped: false })),
  bulb: (hex = 0xffd9a0, intensity = 4) => get('bulb' + hex + intensity, () => new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: hex, emissiveIntensity: intensity, roughness: 0.2 })),
  neon: (hex, intensity = 3) => get('neon' + hex + intensity, () => {
    const m = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: hex, emissiveIntensity: intensity, roughness: 0.3 });
    m.userData.neon = true;
    return m;
  }),
  rubber: () => get('rubber', () => std({ color: 0x151515, roughness: 0.9 })),
  ceramic: (hex = 0xf6f3ee) => get('ceramic' + hex, () => phys({ color: hex, roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.05 })),

  wood: (style = 'mahogany', rx = 1, ry = 1, gloss = true) => get(`wood:${style}:${rx}:${ry}:${gloss}`, () => {
    const t = withRepeat(T.woodTexture(style), rx, ry);
    return phys({ map: t.map, normalMap: t.normalMap, normalScale: new THREE.Vector2(0.4, 0.4), roughness: gloss ? 0.35 : 0.7, clearcoat: gloss ? 1 : 0, clearcoatRoughness: 0.12 });
  }),
  planks: (style = 'rustic', rx = 4, ry = 4) => get(`planks:${style}:${rx}:${ry}`, () => {
    const t = withRepeat(T.planksTexture(style), rx, ry);
    return phys({ map: t.map, normalMap: t.normalMap, normalScale: new THREE.Vector2(0.8, 0.8), roughness: 0.55, clearcoat: 0.35, clearcoatRoughness: 0.35 });
  }),
  carpet: (style, pal, rx = 6, ry = 6) => get(`carpet:${style}:${JSON.stringify(pal)}:${rx}:${ry}`, () => {
    const t = withRepeat(T.carpetTexture(style, pal), rx, ry);
    return std({ map: t.map, normalMap: t.normalMap, normalScale: new THREE.Vector2(0.9, 0.9), roughness: 0.95, metalness: 0, envMapIntensity: 0.35 });
  }),
  felt: (hex = '#0f5a32') => get('felt' + hex, () => {
    const t = T.feltTexture(hex);
    return new THREE.MeshPhysicalMaterial({ map: t.map, normalMap: t.normalMap, roughness: 0.95, sheen: 1, sheenRoughness: 0.6, sheenColor: new THREE.Color(hex).lerp(new THREE.Color(1, 1, 1), 0.35), envMapIntensity: 0.4 });
  }),
  marble: (base, vein, rx = 1, ry = 1) => get(`marble:${base}:${vein}:${rx}:${ry}`, () => {
    const t = withRepeat(T.marbleTexture(base, vein), rx, ry);
    return phys({ map: t.map, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.04 });
  }),
  tiles: (a, b, rx = 4, ry = 4) => get(`tiles:${a}:${b}:${rx}:${ry}`, () => {
    const t = withRepeat(T.tileFloorTexture(a, b), rx, ry);
    return phys({ map: t.map, normalMap: t.normalMap, roughness: 0.1, clearcoat: 1, clearcoatRoughness: 0.05 });
  }),
  damask: (base, fg, rx = 4, ry = 2) => get(`damask:${base}:${fg}:${rx}:${ry}`, () => {
    const t = withRepeat(T.damaskTexture(base, fg), rx, ry);
    return std({ map: t.map, normalMap: t.normalMap, normalScale: new THREE.Vector2(0.4, 0.4), roughness: 0.65, metalness: 0.15 });
  }),
  leather: (hex = '#5c1018', tufted = true, rx = 1, ry = 1) => get(`leather:${hex}:${tufted}:${rx}:${ry}`, () => {
    const t = withRepeat(T.leatherTexture(hex, tufted), rx, ry);
    return phys({ map: t.map, normalMap: t.normalMap, normalScale: new THREE.Vector2(0.8, 0.8), roughness: 0.4, clearcoat: 0.6, clearcoatRoughness: 0.25, sheen: 0.3 });
  }),
  brick: (hex = '#7a3b26', rx = 4, ry = 2) => get(`brick:${hex}:${rx}:${ry}`, () => {
    const t = withRepeat(T.brickTexture(hex), rx, ry);
    return std({ map: t.map, normalMap: t.normalMap, roughness: 0.9 });
  }),
  coffer: (base, trim, rx = 6, ry = 6) => get(`coffer:${base}:${trim}:${rx}:${ry}`, () => {
    const t = withRepeat(T.cofferTexture(base, trim), rx, ry);
    return std({ map: t.map, normalMap: t.normalMap, roughness: 0.6, metalness: 0.2 });
  }),
  bamboo: (rx = 4, ry = 1) => get(`bamboo:${rx}:${ry}`, () => {
    const t = withRepeat(T.bambooTexture(), rx, ry);
    return phys({ map: t.map, normalMap: t.normalMap, roughness: 0.45, clearcoat: 0.4 });
  }),
  starfield: (rx = 2, ry = 1) => get(`starfield:${rx}:${ry}`, () => {
    const t = T.starfieldTexture().clone(); t.repeat.set(rx, ry); t.userData.shared = true; t.needsUpdate = true;
    return new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 0.6, roughness: 0.8 });
  }),
  velvet: (hex) => get('velvet' + hex, () => phys({ color: hex, roughness: 0.9, sheen: 1, sheenRoughness: 0.4, sheenColor: new THREE.Color(hex).lerp(new THREE.Color(1, 0.9, 0.9), 0.5) })),
  plaster: (hex = 0xd8cbb6) => get('plaster' + hex, () => std({ color: hex, roughness: 0.92, roughnessMap: T.roughnessNoise(3, 0.75, 1) })),
  shadowBlob: () => get('shadowBlob', () => new THREE.MeshBasicMaterial({ map: T.radialTexture('rgba(0,0,0,0.55)', 'rgba(0,0,0,0)', 128, 0.35), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 })),
  lightPool: (hex = 0xffd29a, opacity = 0.35) => get('pool' + hex + opacity, () => new THREE.MeshBasicMaterial({ map: T.radialTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)', 128, 0.2), color: hex, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, toneMapped: true })),
  shaft: (hex = 0xffe2b0, opacity = 0.08) => get('shaft' + hex + opacity, () => new THREE.MeshBasicMaterial({ map: T.shaftTexture(), color: hex, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false })),
  glow: (hex = 0xffc070, opacity = 0.8) => get('glow' + hex + opacity, () => new THREE.SpriteMaterial({ map: T.radialTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)', 64, 0.15), color: hex, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false })),
};

/** A material whose map is a live-updated canvas (screens, displays). Not cached. */
export function screenMaterial(canvasTex, intensity = 1.4) {
  return new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: canvasTex, emissiveIntensity: intensity, roughness: 0.25, metalness: 0 });
}

export function signMaterial(tex, intensity = 2.2, transparent = true) {
  return new THREE.MeshBasicMaterial({ map: tex, transparent, color: new THREE.Color(intensity, intensity, intensity), depthWrite: !transparent, toneMapped: true });
}
