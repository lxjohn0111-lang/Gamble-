import * as THREE from 'three';
import { Station } from './common.js';
import { G, mesh } from '../engine/geo.js';
import { M } from '../engine/materials.js';
import { chipStack } from './common.js';
import { audio } from '../engine/audio.js';

// "Fingers" Fontaine's loan desk: an instant-interaction station.
export class LoanDesk extends Station {
  constructor(ctx, def) {
    super(ctx, def);
    this.instant = true;
    this.label = 'Talk to "Fingers" the loan shark';
    this.footprint = { w: 1.5, d: 0.8, ox: 0, oz: 0 };
    this.interactLocal = new THREE.Vector3(0, 0, 1.0);
    this.interactR = 1.6;
  }
  promptText() { return [this.label, 'Borrow cash · paid back tomorrow +50%']; }
  build() {
    const S = (this.static = new THREE.Group());
    S.position.copy(this.group.position); S.rotation.copy(this.group.rotation);
    this.ctx.director.world.staticRoot.add(S);
    const wood = M.wood('ebony', 1, 1);
    mesh(G.rbox(1.4, 0.08, 0.75, 0.02), wood, 0, 0.78, 0, { parent: S, cast: true });
    mesh(G.rbox(1.3, 0.72, 0.05, 0.01), wood, 0, 0.38, 0.33, { parent: S });
    for (const s of [-1, 1]) mesh(G.rbox(0.06, 0.74, 0.7, 0.01), wood, s * 0.65, 0.37, 0, { parent: S });
    mesh(G.box(1.36, 0.01, 0.7), M.leather('#0d2a1a', false), 0, 0.825, 0, { parent: S });
    // banker's lamp
    mesh(G.cyl(0.07, 0.08, 0.02, 16), M.brass(), -0.45, 0.83, -0.15, { parent: S });
    mesh(G.cyl(0.008, 0.008, 0.28, 8), M.brass(), -0.45, 0.97, -0.15, { parent: S });
    const shade = mesh(G.cyl(0.03, 0.09, 0.08, 16, true), M.glassTint(0x1a8a3a), -0.45, 1.12, -0.12, { rx: 0.25, parent: S });
    shade.material = new THREE.MeshStandardMaterial({ color: 0x0d4a20, emissive: 0x1aa040, emissiveIntensity: 0.6, side: THREE.DoubleSide, roughness: 0.2 });
    mesh(G.sphere(0.025, 8, 6), M.bulb(0xfff0c0, 6), -0.45, 1.09, -0.11, { parent: S });
    // cash + ledger
    for (let i = 0; i < 3; i++) { const st = chipStack(500 + i * 1000); st.position.set(0.25 + i * 0.07, 0.83, -0.1); S.add(st); }
    mesh(G.box(0.24, 0.03, 0.32), M.leather('#3a1a0a', false), 0.0, 0.84, 0.05, { ry: 0.2, parent: S });
    for (let i = 0; i < 4; i++) mesh(G.box(0.16, 0.012, 0.07), M.matte(0x9ac88a), 0.45, 0.84 + i * 0.013, 0.12, { ry: 0.1 * i, parent: S });
    // chair behind
    mesh(G.rbox(0.55, 0.1, 0.5, 0.04), M.leather('#3a0a0a', true), 0, 0.5, -0.75, { parent: S });
    mesh(G.rbox(0.55, 0.7, 0.1, 0.04), M.leather('#3a0a0a', true), 0, 0.9, -1.0, { parent: S });
    mesh(G.cyl(0.03, 0.03, 0.45, 8), M.chrome(), 0, 0.23, -0.75, { parent: S });
    this.footprint = { w: 1.5, d: 1.6, ox: 0, oz: -0.4 };
  }
  spawnStaff(crowd) {
    const p = this.w(0, 0, -0.75);
    this.npc = crowd.staff('loan', { x: p.x, z: p.z, ry: this.group.rotation.y, seat: 0.5 }, (n) => {
      n.jelly.mode = 'sit'; n.jelly.seatHeight = 0.55;
      n.jelly.setAction('count');
      const pl = crowd.player;
      if (pl && n.root.position.distanceToSquared(pl.pos) < 16) {
        n.jelly.lookTarget = pl.camera.position;
        n.beckon = (n.beckon || 0) - 1 / 60;
        if (n.beckon <= 0) { n.beckon = 12; n.say(['Psst! Need cash?', 'Come here, friend…', 'Low, low interest!'][Math.floor(Math.random() * 3)]); }
      } else n.jelly.lookTarget = null;
    });
  }
  use() { audio.play('ui'); this.ctx.director.openLoan(this.npc); }
}
