import * as THREE from 'three';
import { G, mesh, batchStatic } from '../engine/geo.js';
import { M } from '../engine/materials.js';
import { makeRng, TAU, disposeObject } from '../engine/util.js';
import { NavGrid } from './nav.js';
import * as P from './props.js';

// ============================================================================
//  Casino builder: turns a day definition (rooms, doors, decor) into a lit,
//  collidable, navigable 3D interior.
// ============================================================================

export const THEMES = {
  western: {
    music: 'western', carpet: { style: 'western', pal: { base: '#3a170b', a: '#c8822a', b: '#1d5a5a', c: '#5a240e', d: '#e8c27a' } },
    floor: 'carpet', altFloor: 'planks', wall: () => M.planks('walnut', 1, 1), wallScale: [3, 3], wainscot: () => M.wood('walnut', 1, 1, false), trim: () => M.wood('rustic', 1, 1, false),
    ceiling: () => M.planks('rustic', 1, 1), ceilScale: [4, 4], beams: () => M.wood('walnut', 1, 4, false), column: 'western', chandelier: 'wagon', sconce: 'iron',
    lightColor: 0xffc080, hemi: [0xffd0a0, 0x120804, 0.18], fog: 0x100804, fogDensity: 0.02, exposure: 0.85, stool: 'wood', stoolSeat: 0x6a2a10, potStyle: 'terracotta', bg: 0x0a0503,
  },
  tiki: {
    music: 'tiki', carpet: { style: 'tropical', pal: { base: '#0d3a3a', a: '#e85a2a', b: '#2a8a4a', c: '#f2b03a', d: '#5ad16a' } },
    floor: 'carpet', altFloor: 'planks', wall: () => M.bamboo(1, 1), wallScale: [2.5, 2.5], wainscot: () => M.wood('walnut', 1, 1, false), trim: () => M.matte(0x4a2e14, 0.8),
    ceiling: () => M.bamboo(1, 1), ceilScale: [3, 3], beams: () => M.wood('rustic', 1, 4, false), column: 'tiki', chandelier: 'tiki', sconce: 'iron',
    lightColor: 0xffa860, hemi: [0xffd0a0, 0x06201a, 0.4], fog: 0x061614, fogDensity: 0.016, exposure: 1.05, stool: 'bamboo', stoolSeat: 0xd2691e, potStyle: 'terracotta', bg: 0x020806,
  },
  palace: {
    music: 'palace', carpet: { style: 'royal', pal: { base: '#4a0a14', a: '#d8a23a', b: '#1d5a5e', c: '#6a0f1f', d: '#f1d27a' } },
    floor: 'carpet', altFloor: 'tiles', wall: () => M.damask('#5a0f1c', '#b8862f', 1, 1), wallScale: [1.6, 1.6], wainscot: () => M.wood('mahogany', 1, 1), trim: () => M.gold(),
    ceiling: () => M.coffer('#2a1810', '#b8913e', 1, 1), ceilScale: [2.2, 2.2], column: 'marble', chandelier: 'crystal', sconce: 'gold', cove: 0xffb060,
    lightColor: 0xffc890, hemi: [0xffe0b0, 0x200808, 0.26], fog: 0x12060a, fogDensity: 0.012, exposure: 0.88, stool: 'gold', stoolSeat: 0x7a1020, potStyle: 'gold', bg: 0x050203,
  },
  neon: {
    music: 'neon', carpet: { style: 'cosmic', pal: { base: '#07051a', a: '#ff2bd6', b: '#2bf0ff', c: '#7a3cff', d: '#fff23b' } },
    floor: 'carpet', altFloor: 'tiles', wall: () => M.starfield(1, 1), wallScale: [6, 4], wainscot: () => M.lacquer(0x0b0b14), trim: () => M.neon(0x2bf0ff, 2.5),
    ceiling: () => M.matte(0x07070c, 0.6), ceilScale: [4, 4], column: 'neon', chandelier: 'neon', sconce: 'gold', neonGrid: true,
    lightColor: 0xc9a0ff, hemi: [0xb0a0ff, 0x100018, 0.35], fog: 0x07041a, fogDensity: 0.014, exposure: 1.1, stool: 'chrome', stoolSeat: 0x4a1a8a, potStyle: 'black', bg: 0x020108,
  },
  monaco: {
    music: 'lounge', carpet: { style: 'deco', pal: { base: '#0b2a22', a: '#d8b24a', b: '#14453a', c: '#0f3a2e', d: '#f6e3a0' } },
    floor: 'carpet', altFloor: 'tiles', wall: () => M.damask('#0d2a24', '#c9a24a', 1, 1), wallScale: [1.6, 1.6], wainscot: () => M.wood('walnut', 1, 1), trim: () => M.gold(),
    ceiling: () => M.coffer('#f0e6d0', '#c9a24a', 1, 1), ceilScale: [2.5, 2.5], column: 'marble', chandelier: 'crystal', sconce: 'gold', cove: 0xffd090,
    lightColor: 0xffd8a8, hemi: [0xfff0d8, 0x0a1a14, 0.28], fog: 0x08120f, fogDensity: 0.01, exposure: 0.88, stool: 'gold', stoolSeat: 0x0f3a2e, potStyle: 'black', bg: 0x030605,
  },
};

const WALL_T = 0.3;

function scaledPlane(w, h, su, sv) {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / su, uv.getY(i) * h / sv);
  return g;
}

export class World {
  constructor(def, quality = 'high') {
    this.def = def;
    this.theme = THEMES[def.theme];
    this.quality = quality;
    this.group = new THREE.Group();
    this.staticRoot = new THREE.Group();
    this.dynamicRoot = new THREE.Group();
    this.group.add(this.staticRoot, this.dynamicRoot);
    this.colliders = [];
    this.updaters = [];
    this.lights = [];
    this.lightSpots = [];
    this.poi = { bar: [], lounge: [], watch: [], wander: [] };
    this.interactables = [];
    this.rng = makeRng(def.seed || 7);
    this.build();
  }

  addCollider(x0, z0, x1, z1, tag) { this.colliders.push({ x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), z1: Math.max(z0, z1), tag }); }
  /** Place a prop group at (x,z) facing rotation ry and register its collider. */
  place(obj, x, z, ry = 0, { dynamic = false, y = 0 } = {}) {
    obj.position.set(x, y, z); obj.rotation.y = ry;
    (dynamic || obj.userData.dynamic ? this.dynamicRoot : this.staticRoot).add(obj);
    const c = obj.userData.collider;
    if (c) {
      const cs = Math.abs(Math.cos(ry)), sn = Math.abs(Math.sin(ry));
      const hw = (c.w * cs + c.d * sn) / 2, hd = (c.w * sn + c.d * cs) / 2;
      const ox = (c.ox || 0) * Math.cos(ry) + (c.oz || 0) * Math.sin(ry), oz = -(c.ox || 0) * Math.sin(ry) + (c.oz || 0) * Math.cos(ry);
      this.addCollider(x + ox - hw, z + oz - hd, x + ox + hw, z + oz + hd, obj.name);
    }
    return obj;
  }
  roomAt(x, z) { return this.def.rooms.find((r) => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1); }

  build() {
    const d = this.def, th = this.theme;
    this.bounds = { x0: Math.min(...d.rooms.map((r) => r.x0)), z0: Math.min(...d.rooms.map((r) => r.z0)), x1: Math.max(...d.rooms.map((r) => r.x1)), z1: Math.max(...d.rooms.map((r) => r.z1)) };
    for (const r of d.rooms) this.buildRoom(r);
    this.buildWalls();
    this.buildLights();
    this.buildDecor();
  }

  floorMat(kind, r) {
    const th = this.theme;
    if (kind === 'planks') return M.planks(this.def.theme === 'western' ? 'rustic' : 'walnut', 1, 1);
    if (kind === 'tiles') return M.tiles('#efe7d8', '#1a1a1e', 1, 1);
    if (kind === 'marble') return M.marble('#f1ece2', '#9a8f7e', 1, 1);
    const c = r.carpet || th.carpet;
    return M.carpet(c.style, c.pal, 1, 1);
  }

  buildRoom(r) {
    const th = this.theme;
    const w = r.x1 - r.x0, dd = r.z1 - r.z0, cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
    const fk = r.floor || th.floor;
    const fs = fk === 'carpet' ? 5 : fk === 'tiles' ? 4 : 3.5;
    const floor = new THREE.Mesh(scaledPlane(w, dd, fs, fs), this.floorMat(fk, r));
    floor.rotation.x = -Math.PI / 2; floor.position.set(cx, 0, cz); floor.receiveShadow = true;
    this.staticRoot.add(floor);
    // ceiling
    const cs = th.ceilScale;
    const ceil = new THREE.Mesh(scaledPlane(w, dd, cs[0], cs[1]), th.ceiling());
    ceil.rotation.x = Math.PI / 2; ceil.position.set(cx, r.h, cz);
    this.staticRoot.add(ceil);
    if (th.beams) {
      const bm = th.beams();
      const n = Math.floor(w / 2.6);
      for (let i = 1; i <= n; i++) mesh(G.box(0.22, 0.3, dd), bm, r.x0 + (i * w) / (n + 1), r.h - 0.15, cz, { parent: this.staticRoot });
      mesh(G.box(w, 0.26, 0.24), bm, cx, r.h - 0.42, cz, { parent: this.staticRoot });
    }
    if (th.cove) {
      // glowing cove around the ceiling edge
      const cm = M.emissive(th.cove, 1.1);
      for (const [x, z, ww, ddd] of [[cx, r.z0 + 0.5, w - 1, 0.08], [cx, r.z1 - 0.5, w - 1, 0.08], [r.x0 + 0.5, cz, 0.08, dd - 1], [r.x1 - 0.5, cz, 0.08, dd - 1]]) mesh(G.box(ww, 0.04, ddd), cm, x, r.h - 0.02, z, { parent: this.staticRoot });
      const tm = th.trim();
      for (const [x, z, ww, ddd] of [[cx, r.z0 + 0.42, w - 0.8, 0.1], [cx, r.z1 - 0.42, w - 0.8, 0.1], [r.x0 + 0.42, cz, 0.1, dd - 0.8], [r.x1 - 0.42, cz, 0.1, dd - 0.8]]) mesh(G.box(ww, 0.25, ddd), tm, x, r.h - 0.15, z, { parent: this.staticRoot });
    }
    if (th.neonGrid) {
      const cols = [0xff2bd6, 0x2bf0ff, 0x7a3cff];
      let k = 0;
      for (let x = r.x0 + 2; x < r.x1 - 1; x += 4) mesh(G.box(0.05, 0.04, dd - 2), M.neon(cols[k++ % 3], 3), x, r.h - 0.03, cz, { parent: this.staticRoot });
      mesh(G.box(w - 2, 0.04, 0.05), M.neon(0xfff23b, 3), cx, r.h - 0.03, r.z0 + 1, { parent: this.staticRoot });
      mesh(G.box(w - 2, 0.04, 0.05), M.neon(0xfff23b, 3), cx, r.h - 0.03, r.z1 - 1, { parent: this.staticRoot });
    }
    // recessed downlights
    if (r.downlights !== false && this.def.theme !== 'western' && this.def.theme !== 'tiki') {
      for (let x = r.x0 + 2; x < r.x1 - 1; x += 3.5) for (let z = r.z0 + 2; z < r.z1 - 1; z += 3.5) {
        const l = P.recessedLight(); l.position.set(x, r.h - 0.01, z); this.staticRoot.add(l);
      }
    }
  }

  buildWalls() {
    const d = this.def, th = this.theme;
    const lines = new Map(); // key -> {axis, c, ivs:[[a,b,h]]}
    const add = (axis, c, a, b, h) => {
      const key = axis + ':' + c.toFixed(2);
      if (!lines.has(key)) lines.set(key, { axis, c, ivs: [] });
      lines.get(key).ivs.push([Math.min(a, b), Math.max(a, b), h]);
    };
    for (const r of d.rooms) {
      add('x', r.z0, r.x0, r.x1, r.h); add('x', r.z1, r.x0, r.x1, r.h);
      add('z', r.x0, r.z0, r.z1, r.h); add('z', r.x1, r.z0, r.z1, r.h);
    }
    const doors = d.doors || [];
    for (const line of lines.values()) {
      // breakpoints from all intervals and doors
      const pts = new Set();
      for (const [a, b] of line.ivs) { pts.add(a); pts.add(b); }
      const lineDoors = doors.filter((dr) => (line.axis === 'x' ? Math.abs(dr.z - line.c) < 0.05 : Math.abs(dr.x - line.c) < 0.05));
      for (const dr of lineDoors) { const m = line.axis === 'x' ? dr.x : dr.z; pts.add(m - dr.w / 2); pts.add(m + dr.w / 2); }
      const sorted = [...pts].sort((p, q) => p - q);
      for (let i = 0; i < sorted.length - 1; i++) {
        const a = sorted[i], b = sorted[i + 1], mid = (a + b) / 2;
        if (b - a < 0.01) continue;
        const covering = line.ivs.filter(([p, q]) => mid > p && mid < q);
        if (!covering.length) continue;
        const h = Math.max(...covering.map((v) => v[2]));
        const door = lineDoors.find((dr) => { const m = line.axis === 'x' ? dr.x : dr.z; return mid > m - dr.w / 2 && mid < m + dr.w / 2; });
        if (door) {
          const dh = door.h || 3.2;
          if (h > dh) this.wallSegment(line, a, b, dh, h);
          this.doorFrame(line, (a + b) / 2, b - a, dh, door);
        } else this.wallSegment(line, a, b, 0, h);
      }
    }
  }

  /** Wall piece between a..b along the line, from y0 to y1, finished on room-facing sides. */
  wallSegment(line, a, b, y0, y1) {
    const th = this.theme;
    const len = b - a, mid = (a + b) / 2, h = y1 - y0;
    const isX = line.axis === 'x';
    const x = isX ? mid : line.c, z = isX ? line.c : mid;
    // core block (collider + top)
    const core = mesh(G.box(isX ? len : WALL_T, h, isX ? WALL_T : len), M.matte(0x120a08, 1), x, y0 + h / 2, z, { parent: this.staticRoot, cast: true });
    core.castShadow = y0 === 0;
    if (y0 === 0) this.addCollider(x - (isX ? len / 2 : WALL_T / 2), z - (isX ? WALL_T / 2 : len / 2), x + (isX ? len / 2 : WALL_T / 2), z + (isX ? WALL_T / 2 : len / 2), 'wall');
    for (const s of [-1, 1]) {
      const nx = isX ? 0 : s, nz = isX ? s : 0;
      const room = this.roomAt(x + nx * 0.5, z + nz * 0.5) || this.roomAt(x + nx * 0.5 + (isX ? Math.min(len / 2 - 0.1, 1) : 0), z + nz * 0.5 + (isX ? 0 : Math.min(len / 2 - 0.1, 1)));
      if (!room) continue;
      const off = WALL_T / 2 + 0.002;
      const ry = isX ? (s > 0 ? 0 : Math.PI) : (s > 0 ? Math.PI / 2 : -Math.PI / 2);
      const wm = room.wall ? room.wall() : th.wall();
      const ws = th.wallScale;
      const face = new THREE.Mesh(scaledPlane(len, h, ws[0], ws[1]), wm);
      face.position.set(x + nx * off, y0 + h / 2, z + nz * off); face.rotation.y = ry; face.receiveShadow = true;
      this.staticRoot.add(face);
      if (y0 > 0) {
        // lintel underside
        const und = new THREE.Mesh(G.plane(isX ? len : WALL_T, isX ? WALL_T : len), th.trim());
        und.rotation.x = Math.PI / 2; und.position.set(x, y0 - 0.001, z); this.staticRoot.add(und);
        continue;
      }
      // wainscot, rails, baseboard, crown molding
      const wn = th.wainscot(), tm = th.trim();
      const put = (w2, h2, d2, yy, mat, inset = 0) => {
        const m = mesh(G.box(isX ? w2 : d2, h2, isX ? d2 : w2), mat, x + nx * (off + d2 / 2 - inset), yy, z + nz * (off + d2 / 2 - inset), { parent: this.staticRoot });
        return m;
      };
      if (len > 0.4) {
        put(len, 1.0, 0.03, 0.5, wn);
        put(len, 0.06, 0.06, 1.03, tm);
        put(len, 0.16, 0.045, 0.08, wn === tm ? M.matte(0x1a1010) : tm === M.gold() ? M.wood('mahogany', 1, 1) : tm);
        put(len, 0.16, 0.12, h - 0.08, tm);
        put(len, 0.05, 0.16, h - 0.2, tm);
        // panel stiles
        const n = Math.floor(len / 1.1);
        for (let i = 1; i < n; i++) {
          const p = a + (i * len) / n;
          const px = isX ? p : line.c, pz = isX ? line.c : p;
          mesh(G.box(isX ? 0.05 : 0.04, 0.9, isX ? 0.04 : 0.05), tm, px + nx * (off + 0.04), 0.5, pz + nz * (off + 0.04), { parent: this.staticRoot });
        }
        // sconces & art
        if (len > 3 && h > 3.2) {
          const k = Math.floor(len / 4.5);
          for (let i = 0; i < k; i++) {
            const p = a + ((i + 0.5) * len) / k;
            const px = isX ? p : line.c, pz = isX ? line.c : p;
            const sc = P.wallSconce(th.sconce);
            sc.position.set(px + nx * off, 2.4, pz + nz * off); sc.rotation.y = ry;
            this.staticRoot.add(sc);
            if (i < k - 1 && this.rng() < 0.6 && this.def.theme !== 'neon') {
              const q = a + ((i + 1) * len) / k;
              const art = this.def.theme === 'western' ? P.wantedPoster(Math.floor(this.rng() * 20)) : P.painting(Math.floor(this.rng() * 30), 1.1, 0.8);
              art.position.set((isX ? q : line.c) + nx * (off + 0.03), 2.3, (isX ? line.c : q) + nz * (off + 0.03)); art.rotation.y = ry;
              this.staticRoot.add(art);
            }
          }
        }
      }
    }
  }

  doorFrame(line, m, w, dh, door) {
    const th = this.theme;
    const isX = line.axis === 'x';
    const x = isX ? m : line.c, z = isX ? line.c : m;
    const tm = th.trim();
    for (const s of [-1, 1]) {
      const px = isX ? x + s * (w / 2) : x, pz = isX ? z : z + s * (w / 2);
      mesh(G.box(isX ? 0.2 : WALL_T + 0.1, dh, isX ? WALL_T + 0.1 : 0.2), tm, px, dh / 2, pz, { parent: this.staticRoot, cast: true });
    }
    mesh(G.box(isX ? w + 0.4 : WALL_T + 0.14, 0.22, isX ? WALL_T + 0.14 : w + 0.4), tm, x, dh + 0.11, z, { parent: this.staticRoot });
    if (door.label) {
      for (const s of [-1, 1]) {
        const sign = P.neonSign(door.label, door.color || '#ffd24a', { height: 0.42 });
        sign.position.set(x + (isX ? 0 : s * (WALL_T / 2 + 0.06)), dh + 0.62, z + (isX ? s * (WALL_T / 2 + 0.06) : 0));
        sign.rotation.y = isX ? (s > 0 ? 0 : Math.PI) : (s > 0 ? Math.PI / 2 : -Math.PI / 2);
        this.dynamicRoot.add(sign);
        this.neonSigns = this.neonSigns || []; this.neonSigns.push(sign);
      }
    }
  }

  buildLights() {
    const d = this.def, th = this.theme;
    const budget = this.quality === 'low' ? 4 : this.quality === 'medium' ? 7 : 10;
    const spots = [];
    for (const r of d.rooms) {
      const w = r.x1 - r.x0, dd = r.z1 - r.z0;
      const pts = r.chandeliers || (() => {
        const nx = Math.max(1, Math.round(w / 8)), nz = Math.max(1, Math.round(dd / 8));
        const out = [];
        for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) out.push([r.x0 + (i + 0.5) * w / nx, r.z0 + (j + 0.5) * dd / nz]);
        return out;
      })();
      for (const [x, z] of pts) {
        const style = r.chandelier || th.chandelier;
        const ch = P.chandelier(style, r.h > 5 ? 1.15 : 0.85);
        const hang = style === 'crystal' ? 1.4 : 1.25;
        ch.position.set(x, r.h - hang + (style === 'wagon' ? 0.4 : 0), z);
        this.staticRoot.add(ch);
        spots.push({ x, z, y: r.h - hang - 0.3, room: r, prio: (r.main ? 2 : 1) + w * dd / 400 });
        // warm pool of light on the floor + faint shaft
        const pool = new THREE.Mesh(G.plane(7, 7), M.lightPool(th.lightColor, 0.22));
        pool.rotation.x = -Math.PI / 2; pool.position.set(x, 0.015, z); this.staticRoot.add(pool);
        if (this.quality !== 'low' && r.h > 4) {
          const shaft = new THREE.Mesh(G.cyl(0.9, 2.6, r.h - hang - 0.3, 20, true), M.shaft(th.lightColor, this.def.theme === 'neon' ? 0.02 : 0.04));
          shaft.position.set(x, (r.h - hang - 0.3) / 2, z); shaft.renderOrder = 5;
          this.staticRoot.add(shaft);
        }
      }
    }
    spots.sort((a, b) => b.prio - a.prio);
    this.lightSpots = spots;
    spots.slice(0, budget).forEach((s) => {
      const l = new THREE.PointLight(th.lightColor, (s.room.lightIntensity || 26) * (s.room.h > 5 ? 1.4 : 1), 16, 1.8);
      l.position.set(s.x, s.y, s.z);
      this.group.add(l); this.lights.push(l);
    });
    // overhead key with soft shadows
    const b = this.bounds;
    const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
    const sun = new THREE.DirectionalLight(th.lightColor, 0.9);
    sun.position.set(cx + 4, 18, cz + 6); sun.target.position.set(cx, 0, cz);
    sun.castShadow = this.quality !== 'low';
    const ext = Math.max(b.x1 - b.x0, b.z1 - b.z0) / 2 + 2;
    Object.assign(sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 1, far: 40 });
    sun.shadow.mapSize.set(this.quality === 'high' ? 4096 : 2048, this.quality === 'high' ? 4096 : 2048);
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03; sun.shadow.radius = 3;
    this.group.add(sun, sun.target); this.sun = sun;
    const hemi = new THREE.HemisphereLight(th.hemi[0], th.hemi[1], th.hemi[2]);
    this.group.add(hemi);
  }

  buildDecor() {
    const d = this.def, th = this.theme;
    const themeName = d.theme;
    for (const it of d.decor || []) {
      let o = null;
      switch (it.type) {
        case 'palm': o = P.pottedPalm(it.h || 2.2, th.potStyle); break;
        case 'monstera': o = P.monstera(); break;
        case 'cactus': o = P.cactus(); break;
        case 'column': o = P.column(th.column, it.h || this.roomAt(it.x, it.z)?.h || 5); break;
        case 'bar': {
          o = P.bar(it.len || 7, themeName);
          const n = Math.floor((it.len || 7) / 0.85);
          for (let i = 0; i < n; i++) {
            const lx = -((it.len || 7) / 2) + 0.5 + i * 0.85;
            const st = P.barStool(th.stool, th.stoolSeat); st.position.set(lx, 0, 0.95); o.add(st);
            const wp = new THREE.Vector3(lx, 0, 0.95).applyAxisAngle(new THREE.Vector3(0, 1, 0), it.rot || 0).add(new THREE.Vector3(it.x, 0, it.z));
            this.poi.bar.push({ x: wp.x, z: wp.z, ry: (it.rot || 0) + Math.PI, seat: 0.78, taken: null });
          }
          const bt = new THREE.Vector3(0, 0, -0.7).applyAxisAngle(new THREE.Vector3(0, 1, 0), it.rot || 0).add(new THREE.Vector3(it.x, 0, it.z));
          this.bartenderSpot = { x: bt.x, z: bt.z, ry: it.rot || 0 };
          const front = new THREE.Vector3(0, 0, 1.4).applyAxisAngle(new THREE.Vector3(0, 1, 0), it.rot || 0).add(new THREE.Vector3(it.x, 0, it.z));
          this.interactables.push({ kind: 'bar', x: front.x, z: front.z, r: 1.6, label: 'Order a drink', y: 1.1 });
          break;
        }
        case 'lounge': {
          o = P.loungeSet(themeName);
          for (const zz of [-1.0, 1.0]) {
            const wp = new THREE.Vector3(0, 0, zz).applyAxisAngle(new THREE.Vector3(0, 1, 0), it.rot || 0).add(new THREE.Vector3(it.x, 0, it.z));
            this.poi.lounge.push({ x: wp.x, z: wp.z, ry: (it.rot || 0) + (zz < 0 ? 0 : Math.PI), seat: 0.48, taken: null });
          }
          this.addCollider(it.x - 1.4, it.z - 1.6, it.x + 1.4, it.z + 1.6, 'lounge');
          break;
        }
        case 'atm': o = P.atm(); this.interactables.push({ kind: 'atm', x: it.x + Math.sin(it.rot || 0) * 0.9, z: it.z + Math.cos(it.rot || 0) * 0.9, r: 1.3, label: 'Emergency cash (watch an ad)', y: 1.3 }); break;
        case 'cashier': o = P.cashierCage(it.w || 4); break;
        case 'exit': o = P.exitDoors(themeName); this.exitPos = { x: it.x, z: it.z, rot: it.rot || 0 };
          this.interactables.push({ kind: 'exit', x: it.x + Math.sin(it.rot || 0) * 0.8, z: it.z + Math.cos(it.rot || 0) * 0.8, r: 2.0, label: 'Leave the casino', y: 1.5 });
          this.addCollider(it.x - 1.8, it.z - 0.4, it.x + 1.8, it.z + 0.4, 'exit');
          break;
        case 'trash': o = P.trashBin(); break;
        case 'statue': o = P.statue(); this.statueSpots = this.statueSpots || []; this.statueSpots.push(it); break;
        case 'fountain': o = P.fountain(); break;
        case 'aquarium': o = P.aquarium(it.w || 4, it.h || 2); break;
        case 'barrel': o = P.barrel(); break;
        case 'torch': o = P.tikiTorch(); break;
        case 'tiki': { o = new THREE.Group(); P.tikiHead(o, 0, 1.0, 0, 0); mesh(G.box(0.3, 0.7, 0.3), M.wood('walnut', 1, 1, false), 0, 0.35, 0, { parent: o }); o.userData.collider = { w: 0.5, d: 0.5 }; break; }
        case 'wheel': o = P.wagonWheel(); o.position.y = 0; break;
        case 'planet': o = P.planetModel(it.r || 0.8, it.color || 0xff8a2a, it.ring !== false); this.place(o, it.x, it.z, 0, { y: it.y || 4 }); this.updaters.push((dt) => (o.rotation.y += dt * 0.15)); continue;
        case 'rocket': o = P.rocketModel(); break;
        case 'jackpot': o = P.jackpotBoard(it.w || 4, it.h || 1.1); this.jackpotBoards = this.jackpotBoards || []; this.jackpotBoards.push(o); this.place(o, it.x, it.z, it.rot || 0, { y: it.y || 3.6, dynamic: true }); continue;
        case 'neon': o = P.neonSign(it.text, it.color, { height: it.size || 0.7 }); this.neonSigns = this.neonSigns || []; this.neonSigns.push(o); this.place(o, it.x, it.z, it.rot || 0, { y: it.y || 3.2, dynamic: true }); continue;
        case 'marquee': o = P.marquee(it.text, it.w || 3, it.h || 0.9, it.color, it.bg); this.marquees = this.marquees || []; this.marquees.push(o); this.place(o, it.x, it.z, it.rot || 0, { y: it.y || 3.3, dynamic: true }); continue;
        case 'rope': { o = P.ropeLine(it.pts.map(([x, z]) => new THREE.Vector3(x, 0, z)), themeName !== 'neon'); this.staticRoot.add(o); continue; }
        case 'rug': { const m = P.rug(it.w, it.d, it.mat === 'velvet' ? M.velvet(it.color || 0x6a0a1a) : this.floorMat(it.mat || 'tiles', {})); m.position.set(it.x, 0.008, it.z); m.rotation.z = it.rot || 0; this.staticRoot.add(m); continue; }
        case 'sofa': o = P.sofa(it.color || '#5c1018', it.len || 2); break;
        case 'painting': { o = P.painting(it.seed || 1, it.w || 1.2, it.h || 0.9); this.place(o, it.x, it.z, it.rot || 0, { y: it.y || 2.2 }); continue; }
        default: continue;
      }
      if (o) this.place(o, it.x, it.z, it.rot || 0);
      if (it.type === 'torch' || it.type === 'rocket') this.flames = (this.flames || []).concat(o.userData.flames);
      if (it.type === 'fountain') this.fountains = (this.fountains || []).concat([o]);
      if (it.type === 'aquarium') this.aquariums = (this.aquariums || []).concat([o]);
    }
    // general wander points
    for (const r of d.rooms) for (let k = 0; k < 6; k++) this.poi.wander.push([r.x0 + 1.5 + this.rng() * (r.x1 - r.x0 - 3), r.z0 + 1.5 + this.rng() * (r.z1 - r.z0 - 3)]);
  }

  /** Must be called after stations registered their colliders. */
  buildNav() {
    const b = this.bounds;
    const nav = (this.nav = new NavGrid(b.x0, b.z0, b.x1, b.z1, 0.4));
    for (const r of this.def.rooms) nav.markRect(r.x0 + 0.45, r.z0 + 0.45, r.x1 - 0.45, r.z1 - 0.45, 1);
    for (const dr of this.def.doors || []) {
      const isX = this.def.rooms.some((r) => Math.abs(r.z0 - dr.z) < 0.05 || Math.abs(r.z1 - dr.z) < 0.05) && !this.def.rooms.some((r) => Math.abs(r.x0 - dr.x) < 0.05 || Math.abs(r.x1 - dr.x) < 0.05);
      if (isX) nav.markRect(dr.x - dr.w / 2 + 0.45, dr.z - 0.6, dr.x + dr.w / 2 - 0.45, dr.z + 0.6, 1);
      else nav.markRect(dr.x - 0.6, dr.z - dr.w / 2 + 0.45, dr.x + 0.6, dr.z + dr.w / 2 - 0.45, 1);
    }
    for (const c of this.colliders) if (c.tag !== 'wall') nav.markRect(c.x0 - 0.3, c.z0 - 0.3, c.x1 + 0.3, c.z1 + 0.3, 0);
    for (const c of this.colliders) if (c.tag === 'wall') nav.markRect(c.x0 - 0.35, c.z0 - 0.35, c.x1 + 0.35, c.z1 + 0.35, 0);
    this.poi.wander = this.poi.wander.filter(([x, z]) => nav.walkableAt(x, z));
  }

  finalize() {
    this.batched = batchStatic(this.staticRoot);
  }

  update(dt, t) {
    for (const u of this.updaters) u(dt, t);
    if (this.flames) for (const f of this.flames) { const k = 1 + Math.sin(t * 17 + f.id) * 0.08 + Math.sin(t * 31 + f.id * 3) * 0.05; f.scale.y = (f.userData.baseY || (f.userData.baseY = f.scale.y)) * k; }
    if (this.marquees) for (const m of this.marquees) { const b = m.userData.bulbs; const step = Math.floor(t * 8); if (step === m.userData.step) continue; m.userData.step = step; for (let i = 0; i < b.count; i++) b.setColorAt(i, (i + step) % 3 !== 2 ? m.userData.on : m.userData.off); b.instanceColor.needsUpdate = true; }
    if (this.neonSigns) for (const s of this.neonSigns) { const m = s.userData.neonMat; if (!m) continue; if (!m.userData.base) m.userData.base = m.color.clone(); const fl = Math.random() < 0.004 ? 0.25 : 1; m.color.copy(m.userData.base).multiplyScalar(fl * (0.92 + 0.08 * Math.sin(t * 3 + s.id))); }
    if (this.fountains) for (const f of this.fountains) for (const [i, j] of f.userData.jets.entries()) { j.scale.y = 0.5 + 0.15 * Math.sin(t * 6 + i); j.material.opacity = 0.4 + 0.1 * Math.sin(t * 9 + i); }
    if (this.aquariums) for (const a of this.aquariums) for (const f of a.userData.fish) {
      const u = f.userData; f.position.x += u.dir * u.speed * dt; if (Math.abs(f.position.x) > u.w * 0.42) { u.dir *= -1; f.position.x = Math.sign(f.position.x) * u.w * 0.42; }
      f.rotation.y = u.dir > 0 ? 0 : Math.PI; f.position.y += Math.sin(t * 2 + u.phase) * 0.002;
    }
  }

  dispose() { disposeObject(this.group); }
}
