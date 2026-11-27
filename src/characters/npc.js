import * as THREE from 'three';
import { Jelly, randomOutfit } from './jelly.js';
import { cocktailGlass } from '../world/props.js';
import { clamp, dampAngle, makeRng, wrapAngle } from '../engine/util.js';
import { audio } from '../engine/audio.js';

// ============================================================================
//  Crowd simulation: patrons with simple goals + staff with jobs.
// ============================================================================

const LINES = {
  idle: ['I can feel it... this is the one.', 'My system is foolproof!', 'Just ONE more spin.', 'Have you seen my wife? She\'s lime flavoured.', 'I\'m up! ...I think.', 'Free drinks? FREE drinks!', 'Is it 3 AM already?!', 'The house always wins. Unless...', 'These shoes cost me a jackpot.', 'I put my rent on red. Twice.', 'Big Tony is looking for you, pal.', 'Wobble wobble.', 'Who needs sleep when you have SLOTS?', 'I\'ve got a good feeling about lucky number 7.', 'Did that machine just wink at me?'],
  win: ['YOOOOO!', 'Let\'s GOOO!', 'Teach me your ways!', 'Spin it again!', 'Unbelievable!', 'Buy me a drink!'],
  lose: ['Ouch.', 'Oof, that hurts.', 'Next time, buddy.', 'Brutal.', 'Rough night, huh?'],
  bump: ['Hey, watch it!', 'Excuse YOU!', 'Personal space, jelly!', 'Ow, my wobble!', 'Easy there!'],
  dealer: ['Place your bets!', 'Good luck!', 'Feeling lucky tonight?', 'House rules, friend.'],
  bartender: ['What\'ll it be?', 'Shaken, not stirred.', 'This one\'s my specialty.'],
  security: ['Keep it moving.', 'No funny business.', 'Big Tony says hi.'],
  loan: ['Need a little... loan?', 'My rates are VERY reasonable.', 'Come here, friend.'],
};

let npcSeed = 1000;

export class NPC {
  constructor(crowd, role = 'patron', outfit = null) {
    this.crowd = crowd;
    this.role = role;
    this.jelly = new Jelly(outfit || randomOutfit(npcSeed++ * 17 + 3, role), { blob: false });
    this.root = this.jelly.root;
    this.rng = makeRng(npcSeed * 13);
    this.state = 'idle';
    this.timer = 1 + this.rng() * 3;
    this.path = null; this.pi = 0;
    this.speed = 1.05 + this.rng() * 0.45;
    this.goal = null;
    this.bubble = null; this.bubbleT = 0;
    this.chatCooldown = 5 + this.rng() * 20;
    this.react = 0;
    this.yawTarget = 0;
    this.jelly.stepCb = () => { if (this.crowd.player && this.root.position.distanceToSquared(this.crowd.player.pos) < 36) audio.play('step', { pos: this.root.position, vol: 0.25 }); };
  }

  say(text, dur = 2.6) {
    this.crowd.showBubble(this, text, dur);
    this.jelly.say(Math.min(dur, 1.8));
  }

  goTo(x, z, then) {
    const p = this.root.position;
    const path = this.crowd.world.nav.path(p.x, p.z, x, z);
    if (!path || !path.length) { this.state = 'idle'; this.timer = 1 + this.rng() * 2; return false; }
    this.path = path; this.pi = 0; this.state = 'walk'; this.onArrive = then; this.stuck = 0;
    return true;
  }

  sitAt(seat) {
    const j = this.jelly;
    this.root.position.set(seat.x, 0, seat.z);
    this.root.rotation.y = seat.ry;
    j.mode = 'sit'; j.seatHeight = seat.seat || 0.78;
    this.seat = seat; seat.taken = this;
    j.firstFrame = true;
  }
  standUp() {
    if (!this.seat) return;
    const s = this.seat;
    s.taken = null;
    const back = s.standOff || 0.6;
    this.root.position.x += Math.sin(s.ry) * back; this.root.position.z += Math.cos(s.ry) * back;
    this.jelly.mode = 'stand';
    this.jelly.firstFrame = true;
    this.seat = null;
    this.jelly.hold(1, null);
  }

  update(dt, t) {
    const j = this.jelly, p = this.root.position;
    this.timer -= dt;
    this.chatCooldown -= dt;
    if (this.react > 0) { this.react -= dt; if (this.react <= 0 && this.reactAction) { j.setAction(this.prevAction || null); this.reactAction = null; } }
    switch (this.state) {
      case 'walk': {
        const target = this.path[this.pi];
        const dx = target[0] - p.x, dz = target[1] - p.z, d = Math.hypot(dx, dz);
        if (d < 0.25) {
          this.pi++;
          if (this.pi >= this.path.length) { this.state = 'arrived'; const cb = this.onArrive; this.onArrive = null; cb ? cb() : (this.state = 'idle', this.timer = 2 + this.rng() * 4); break; }
        } else {
          // separation from neighbours + the player
          let sx = 0, sz = 0;
          for (const o of this.crowd.npcs) {
            if (o === this || o.seat) continue;
            const ox = p.x - o.root.position.x, oz = p.z - o.root.position.z, od = ox * ox + oz * oz;
            if (od < 0.5 && od > 1e-4) { sx += ox / od * 0.15; sz += oz / od * 0.15; }
          }
          const pl = this.crowd.player;
          if (pl) { const ox = p.x - pl.pos.x, oz = p.z - pl.pos.z, od = ox * ox + oz * oz; if (od < 0.7 && od > 1e-4) { sx += ox / od * 0.25; sz += oz / od * 0.25; } }
          let vx = (dx / d) * this.speed + clamp(sx, -0.8, 0.8), vz = (dz / d) * this.speed + clamp(sz, -0.8, 0.8);
          const nx = p.x + vx * dt, nz = p.z + vz * dt;
          if (this.crowd.world.nav.walkableAt(nx, nz) || !this.crowd.world.nav.walkableAt(p.x, p.z)) { p.x = nx; p.z = nz; } else { this.stuck += dt; }
          this.yawTarget = Math.atan2(vx, vz);
          if (this.stuck > 2) { this.state = 'idle'; this.timer = 0.5; }
        }
        this.root.rotation.y = dampAngle(this.root.rotation.y, this.yawTarget, 8, dt);
        break;
      }
      case 'idle':
        if (this.timer <= 0) this.think();
        break;
      case 'face':
        this.root.rotation.y = dampAngle(this.root.rotation.y, this.yawTarget, 6, dt);
        if (this.timer <= 0) this.think();
        break;
      case 'slots':
        if (this.timer <= 0) { this.leaveSeat(); break; }
        this.slotT -= dt;
        if (this.slotT <= 0 && this.station) {
          this.slotT = 3.5 + this.rng() * 3;
          j.setAction('play', { restart: true });
          const res = this.station.npcSpin ? this.station.npcSpin(this) : null;
          if (res === 'win') { setTimeout(() => { if (this.state === 'slots') { j.setAction('cheer'); this.react = 2.2; this.reactAction = true; this.prevAction = 'play'; if (this.rng() < 0.5) this.say(this.rng.pick(LINES.win)); } }, 2600); }
          else if (res === 'lose' && this.rng() < 0.15) setTimeout(() => { if (this.state === 'slots') { j.setAction(this.rng() < 0.5 ? 'facepalm' : 'despair'); this.react = 1.6; this.reactAction = true; this.prevAction = 'play'; } }, 2600);
        }
        break;
      case 'bar': case 'lounge': case 'tableSit':
        if (this.timer <= 0) this.leaveSeat();
        break;
      case 'watch':
        this.root.rotation.y = dampAngle(this.root.rotation.y, this.yawTarget, 4, dt);
        if (this.timer <= 0) { j.setAction(null); this.state = 'idle'; this.timer = 0.5; }
        break;
      case 'staff':
        if (this.staffUpdate) this.staffUpdate(dt, t);
        break;
    }
    // chatter when the player is around
    const pl = this.crowd.player;
    if (pl && this.chatCooldown <= 0 && !this.bubble) {
      const d2 = p.distanceToSquared(pl.pos);
      if (d2 < 16 && this.crowd.canChat()) {
        this.chatCooldown = 18 + this.rng() * 25;
        const pool = LINES[this.role === 'patron' ? 'idle' : this.role] || LINES.idle;
        this.say(this.rng.pick(pool));
        if (this.role === 'patron' && this.state !== 'walk' && !this.seat) { this.yawTarget = Math.atan2(pl.pos.x - p.x, pl.pos.z - p.z); this.state = 'face'; this.timer = 2.5; j.setAction(this.rng() < 0.4 ? 'wave' : 'talk'); setTimeout(() => j.action !== 'cheer' && j.setAction(null), 2400); }
      }
    }
    if (this.bumpT > 0) this.bumpT -= dt;
    if (this.bumped && !(this.bumpT > 0)) { this.bumped = 0; this.bumpT = 6; if (this.rng() < 0.6) { this.say(this.rng.pick(LINES.bump), 1.8); j.setAction('angry'); setTimeout(() => j.action === 'angry' && j.setAction(null), 1200); } }
    this.bumped = 0;
    // look at the player when close
    if (pl && !this.seat && this.state !== 'walk') { const d2 = p.distanceToSquared(pl.pos); j.lookTarget = d2 < 9 ? pl.camera.position : null; }
    else if (this.state === 'walk') j.lookTarget = null;
  }

  leaveSeat() {
    this.jelly.setAction(null);
    if (this.station && this.station.npcLeave) this.station.npcLeave(this);
    this.station = null;
    this.standUp();
    this.state = 'idle'; this.timer = 0.3;
  }

  /** Patron decision making. */
  think() {
    const r = this.rng(), c = this.crowd, w = c.world;
    if (this.role !== 'patron') return;
    const freeSlot = () => { const list = c.slotSeats.filter((s) => !s.taken && !s.reserved && (!s.station || !s.station.active)); return list.length ? this.rng.pick(list) : null; };
    const pick = (arr) => { const list = arr.filter((s) => !s.taken && !s.reserved); return list.length ? this.rng.pick(list) : null; };
    if (r < 0.38) {
      const s = freeSlot();
      if (s) { s.reserved = this; if (this.goTo(s.approach.x, s.approach.z, () => { s.reserved = null; if (s.taken || (s.station && s.station.active)) { this.state = 'idle'; this.timer = 1; return; } this.sitAt(s); this.station = s.station; this.state = 'slots'; this.timer = 25 + this.rng() * 50; this.slotT = 1 + this.rng() * 2; this.jelly.setAction('play'); })) return; s.reserved = null; }
    } else if (r < 0.5) {
      const s = pick(w.poi.bar);
      if (s) { s.reserved = this; if (this.goTo(s.x + Math.sin(s.ry) * 0.6, s.z + Math.cos(s.ry) * 0.6, () => { s.reserved = null; if (s.taken) { this.state = 'idle'; this.timer = 1; return; } this.sitAt(s); this.state = 'bar'; this.timer = 20 + this.rng() * 40; this.jelly.hold(1, cocktailGlass(this.rng.pick(['martini', 'tumbler', 'beer', 'tiki']), this.rng.pick([0xff6aa8, 0x7ad1ff, 0xc8701a, 0x9aff6a]))); this.jelly.setAction('drink'); })) return; s.reserved = null; }
    } else if (r < 0.6) {
      const s = pick(w.poi.lounge);
      if (s) { s.reserved = this; if (this.goTo(s.x + Math.sin(s.ry) * 0.7, s.z + Math.cos(s.ry) * 0.7, () => { s.reserved = null; if (s.taken) { this.state = 'idle'; this.timer = 1; return; } s.standOff = 0.7; this.sitAt(s); this.state = 'lounge'; this.timer = 20 + this.rng() * 30; this.jelly.setAction(this.rng() < 0.6 ? 'talk' : 'sitIdle'); })) return; s.reserved = null; }
    } else if (r < 0.72) {
      const s = pick(c.tableSeats);
      if (s) { s.reserved = this; if (this.goTo(s.approach.x, s.approach.z, () => { s.reserved = null; if (s.taken) { this.state = 'idle'; this.timer = 1; return; } this.sitAt(s); this.station = s.station; this.state = 'tableSit'; this.timer = 30 + this.rng() * 50; this.jelly.setAction(s.action || 'cards'); s.station && s.station.npcJoin && s.station.npcJoin(this, s); })) return; s.reserved = null; }
    } else if (r < 0.82 && c.watchSpots.length) {
      const s = this.rng.pick(c.watchSpots);
      const ox = (this.rng() - 0.5) * 1.6, oz = (this.rng() - 0.5) * 0.6;
      if (this.goTo(s.x + ox, s.z + oz, () => { this.state = 'watch'; this.timer = 8 + this.rng() * 15; this.yawTarget = Math.atan2(s.lx - this.root.position.x, s.lz - this.root.position.z); this.watching = s.station; })) return;
    }
    const wp = this.rng.pick(w.poi.wander);
    if (wp && this.goTo(wp[0], wp[1])) return;
    this.state = 'idle'; this.timer = 2 + this.rng() * 3;
  }
}

export class Crowd {
  constructor(scene, world, ui, camera) {
    this.scene = scene; this.world = world; this.ui = ui; this.camera = camera;
    this.npcs = [];
    this.slotSeats = []; this.tableSeats = []; this.watchSpots = [];
    this.bubbles = [];
    this.player = null;
    this._v = new THREE.Vector3();
    this.chatBudget = 0;
    // one instanced draw call for every NPC's contact shadow
    const blobGeo = new THREE.PlaneGeometry(0.9, 0.9).rotateX(-Math.PI / 2);
    const blobMat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, map: (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(0,0,0,0.6)'); gr.addColorStop(0.5, 'rgba(0,0,0,0.3)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })() });
    this.blobs = new THREE.InstancedMesh(blobGeo, blobMat, 64);
    this.blobs.count = 0; this.blobs.frustumCulled = false; this.blobs.renderOrder = 1;
    scene.add(this.blobs);
    this._m4 = new THREE.Matrix4(); this._s3 = new THREE.Vector3(); this._q0 = new THREE.Quaternion();
  }
  canChat() { if (this.chatBudget > 0) return false; this.chatBudget = 3.5; return true; }

  add(role, outfit) {
    const n = new NPC(this, role, outfit);
    this.npcs.push(n);
    this.scene.add(n.root);
    return n;
  }

  spawnPatrons(count) {
    const w = this.world;
    for (let i = 0; i < count; i++) {
      const n = this.add('patron');
      const p = w.nav.randomWalkable() || [0, 0];
      n.root.position.set(p[0], 0, p[1]);
      n.root.rotation.y = Math.random() * Math.PI * 2;
      n.timer = Math.random() * 3;
      // start some already seated so the place feels alive on entry
      if (i % 3 === 0) {
        const s = this.slotSeats.filter((x) => !x.taken)[0 + Math.floor(Math.random() * 3)];
        if (s) { n.sitAt(s); n.station = s.station; n.state = 'slots'; n.timer = 10 + Math.random() * 40; n.slotT = Math.random() * 4; n.jelly.setAction('play'); }
      }
      n.jelly.firstFrame = true;
    }
  }

  /** Place a staff member at a fixed spot with a behaviour. */
  staff(role, spot, behaviour) {
    const n = this.add(role === 'loan' ? 'boss' : role);
    n.role = role;
    n.root.position.set(spot.x, 0, spot.z);
    n.root.rotation.y = spot.ry || 0;
    n.state = 'staff';
    n.home = { ...spot };
    if (behaviour) n.staffUpdate = behaviour.bind(null, n);
    return n;
  }

  /** Nearby NPCs react to something the player did. */
  reactAt(pos, kind, radius = 9) {
    let k = 0;
    for (const n of this.npcs) {
      if (n.role !== 'patron') continue;
      const d = n.root.position.distanceTo(pos);
      if (d > radius) continue;
      const j = n.jelly;
      n.prevAction = j.action; n.reactAction = true;
      n.react = 2.4 + Math.random();
      if (!n.seat && n.state !== 'walk') { n.yawTarget = Math.atan2(pos.x - n.root.position.x, pos.z - n.root.position.z); n.root.rotation.y = n.yawTarget; }
      if (kind === 'win') { j.setAction(Math.random() < 0.6 ? 'cheer' : 'clap'); j.setExpr('ecstatic', 2.5); if (k++ < 2) setTimeout(() => n.say(n.rng.pick(LINES.win), 2), Math.random() * 600); }
      else if (kind === 'lose') { j.setAction(Math.random() < 0.5 ? 'facepalm' : 'shocked'); j.setExpr('shocked', 2); if (k++ < 1) setTimeout(() => n.say(n.rng.pick(LINES.lose), 2), Math.random() * 600); }
    }
  }

  showBubble(npc, text, dur) {
    if (npc.bubble) npc.bubble.remove();
    npc.bubbleSize = null;
    const el = document.createElement('div');
    el.className = 'bubble';
    el.textContent = text;
    this.ui.labelsEl.append(el);
    npc.bubble = el; npc.bubbleT = dur;
    this.bubbles.push(npc);
  }

  update(dt, t) {
    this.chatBudget -= dt;
    const cam = this.camera.position;
    for (const n of this.npcs) {
      n.update(dt, t);
      const d2 = n.root.position.distanceToSquared(cam);
      // cheap LOD: far NPCs animate at a lower rate
      if (d2 > 900) { n._acc = (n._acc || 0) + dt; if (n._acc < 0.1) continue; n.jelly.update(n._acc, t, cam); n._acc = 0; }
      else n.jelly.update(dt, t, cam);
    }
    // contact shadows
    let bi = 0;
    for (const n of this.npcs) {
      if (bi >= 64) break;
      const p = n.root.position, s = n.root.scale.x * (1 - Math.min(0.4, (n.jelly.jumpH || 0) * 1.5));
      this._m4.compose(this._v.set(p.x, 0.012, p.z), this._q0, this._s3.set(s, 1, s));
      this.blobs.setMatrixAt(bi++, this._m4);
    }
    this.blobs.count = bi; this.blobs.instanceMatrix.needsUpdate = true;
    // bubbles
    const w = window.innerWidth, h = window.innerHeight;
    for (let i = this.bubbles.length - 1; i >= 0; i--) {
      const n = this.bubbles[i];
      n.bubbleT -= dt;
      if (n.bubbleT <= 0 || !n.bubble) { if (n.bubble) n.bubble.remove(); n.bubble = null; this.bubbles.splice(i, 1); continue; }
      const v = this._v.set(n.root.position.x, n.root.position.y + (n.jelly.dims.top + 0.35) * n.root.scale.y + n.jelly.cur.hips, n.root.position.z).project(this.camera);
      const vis = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1 && n.root.position.distanceToSquared(cam) < 260;
      let bx = ((v.x + 1) / 2) * w, by = ((1 - v.y) / 2) * h;
      // stay inside the game view: hidden behind the game panel, clear of the HUD corners
      const fr = this.ui.free || { x: 0, y: 0, w, h };
      if (!vis || bx < fr.x - 20 || bx > fr.x + fr.w + 20 || by > fr.y + fr.h + 30) { n.bubble.style.display = 'none'; continue; }
      n.bubble.style.display = '';
      if (!n.bubbleSize) n.bubbleSize = [n.bubble.offsetWidth || 140, n.bubble.offsetHeight || 32];
      const [bw, bh] = n.bubbleSize;
      bx = Math.min(Math.max(bx, fr.x + bw / 2 + 6), fr.x + fr.w - bw / 2 - 6);
      for (const r of this.ui.hudRects || []) {
        if (bx + bw / 2 > r.left - 4 && bx - bw / 2 < r.right + 4 && by - bh < r.bottom + 4 && by > r.top - 4) by = r.bottom + bh + 10;
      }
      n.bubble.style.left = bx + 'px';
      n.bubble.style.top = by + 'px';
    }
  }

  dispose() {
    for (const n of this.npcs) { this.scene.remove(n.root); n.jelly.dispose(); if (n.bubble) n.bubble.remove(); }
    this.npcs = []; this.bubbles = [];
    this.scene.remove(this.blobs); this.blobs.geometry.dispose(); this.blobs.material.map.dispose(); this.blobs.material.dispose();
  }
}

export { LINES, wrapAngle };
