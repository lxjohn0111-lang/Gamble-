import * as THREE from 'three';
import { World } from '../world/casino.js';
import { Crowd } from '../characters/npc.js';
import { STATIONS } from '../games/index.js';
import { state, PERKS, DRINKS } from './state.js';
import { audio } from '../engine/audio.js';
import { SDK } from '../sdk.js';
import { fmtMoney, clamp, nextFrame, randPick, rand } from '../engine/util.js';
import { M, globalUniforms } from '../engine/materials.js';
import { G } from '../engine/geo.js';
import { chipStack } from '../games/common.js';
import { cocktailGlass } from '../world/props.js';
import { Jelly, randomOutfit } from '../characters/jelly.js';
import { h } from '../ui/ui.js';
import { quotaFor, casinoFor } from '../world/days.js';

// ============================================================================
//  The Director runs a night at the casino and everything between nights.
// ============================================================================

export class Director {
  constructor(app) {
    this.app = app;
    this.scene = app.scene; this.camera = app.camera; this.ui = app.ui; this.player = app.player; this.input = app.input; this.tweens = app.tweens;
    this.world = null; this.crowd = null; this.stations = [];
    this.station = null;
    this.paused = false;
    this.phase = 'loading';
    this.jackpot = 25000 + Math.floor(rand() * 20000);
    this.flashA = 0; this.flashColor = new THREE.Color(1, 0.8, 0.3);
    this.pickups = [];
    this.ctx = { scene: this.scene, ui: this.ui, state, director: this, tweens: this.tweens, audio, camera: this.camera };

    state.on('money', (m, delta) => {
      this.ui.setMoney(m, delta);
      this.ui.setQuota(m, state.quota);
      this.player.setWad(m);
      if (!this._quotaAnnounced && m >= state.quota && this.phase === 'play') {
        this._quotaAnnounced = true;
        this.ui.banner('QUOTA MET!', 'Leave through the EXIT whenever you like — or keep winning!', 'green', 3200);
        audio.play('powerup'); SDK.happytime();
      }
      if (this._quotaAnnounced && m < state.quota) this._quotaAnnounced = false;
      if (m < 1 && this.phase === 'play' && !this.station) this.checkBroke();
    });
    state.on('toast', (msg, kind) => this.ui.toast(msg, kind));
    state.on('streak', (n, lostAt) => {
      this.ui.setStreak(n);
      if ([3, 5, 8, 12].includes(n)) { this.ui.toast(`🔥 HOT STREAK ×${n}! Wins pay +${Math.min(10, (n - 2) * 2)}%`, 'gold'); audio.play('powerup', { vol: 0.6 }); }
      if (!n && lostAt >= 3) this.ui.toast(`❄️ Streak of ${lostAt} ended.`, 'bad', 1800);
    });
    state.on('buffs', () => this.ui.setBuffs(state.buffs));
    state.on('lastcall', () => { this.ui.banner('LAST CALL!', '60 minutes until closing', 'red', 2600); audio.play('clock'); });
    state.on('closingSoon', () => { this.ui.toast('⏰ 15 minutes until Big Tony comes to collect!', 'bad', 4000); audio.play('heartbeat'); });
    state.on('closing', () => this.closingTime());
  }

  // --------------------------------------------------------------- loading
  async loadDay(onProgress = () => {}) {
    this.phase = 'loading';
    this.leaveStation(true);
    this.disposeDay();
    const def = state.casino;
    const q = this.app.renderer.quality;
    onProgress(0.1, 'Polishing the chandeliers…'); await nextFrame();
    const world = (this.world = new World(def, q));
    this.scene.add(world.group);
    onProgress(0.35, 'Shuffling decks…'); await nextFrame();
    // stations
    this.stations = [];
    for (const sd of def.stations) {
      const C = STATIONS[sd.type];
      if (!C) continue;
      const st = new C(this.ctx, sd);
      st.build();
      world.dynamicRoot.add(st.group);
      st.group.updateMatrixWorld(true);
      const f = st.footprint, ry = st.group.rotation.y;
      const cs = Math.abs(Math.cos(ry)), sn = Math.abs(Math.sin(ry));
      const hw = (f.w * cs + f.d * sn) / 2, hd = (f.w * sn + f.d * cs) / 2;
      const c = st.w(f.ox || 0, 0, f.oz || 0);
      world.addCollider(c.x - hw, c.z - hd, c.x + hw, c.z + hd, 'station');
      this.stations.push(st);
    }
    onProgress(0.55, 'Waking up the jelly people…'); await nextFrame();
    world.buildNav();
    world.finalize();
    // scene look
    const th = world.theme;
    this.scene.background = new THREE.Color(th.bg);
    this.scene.fog = new THREE.FogExp2(th.fog, th.fogDensity);
    this.app.renderer.r.toneMappingExposure = th.exposure;
    // environment probe from the actual casino interior
    onProgress(0.7, 'Lighting the neon…'); await nextFrame();
    if (this.envRT) this.envRT.dispose();
    const pm = this.pmrem || (this.pmrem = new THREE.PMREMGenerator(this.app.renderer.r));
    const b = world.bounds;
    const main = def.rooms.find((r) => r.main) || def.rooms[0];
    this.envRT = pm.fromScene(this.scene, 0.035, 0.1, 80, { size: 256, position: new THREE.Vector3((main.x0 + main.x1) / 2, 2.0, (main.z0 + main.z1) / 2) });
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = 0.65;
    void b;
    // crowd
    onProgress(0.82, 'Seating the high rollers…'); await nextFrame();
    const crowd = (this.crowd = new Crowd(this.scene, world, this.ui, this.camera));
    crowd.player = this.player;
    for (const st of this.stations) for (const s of st.npcSeats) (s.kind === 'table' ? crowd.tableSeats : crowd.slotSeats).push(s);
    for (const st of this.stations) if (st.watchSpot) crowd.watchSpots.push(st.watchSpot);
    for (const st of this.stations) if (st.spawnStaff) st.spawnStaff(crowd);
    this.spawnStaff();
    this.spawnStatues();
    const extra = state.modifier && state.modifier.extraNpcs ? state.modifier.extraNpcs : 0;
    const qMul = q === 'low' ? 0.6 : q === 'medium' ? 0.8 : 1;
    crowd.spawnPatrons(Math.round((def.npcs * 0.8 + extra + Math.min(4, state.day - 1)) * qMul));
    this.spawnPickups(true);
    onProgress(0.95, 'Opening the doors…'); await nextFrame();
    // player
    this.player.spawn(def.spawn.x, def.spawn.z, def.spawn.yaw);
    this.player.floor = def.theme === 'western' ? 'wood' : 'carpet';
    this.player.setWad(state.money);
    this.player.holdDrink(null);
    // HUD
    this.ui.setDay(state.day, def.name, state.modifier);
    this.ui.setMoney(state.money); this.ui.displayMoney = state.money;
    this.ui.setQuota(state.money, state.quota);
    this.ui.setPerks(state.perks, PERKS);
    this.ui.setBuffs([]);
    this._quotaAnnounced = state.money >= state.quota;
    audio.startMusic(th.music);
    this.phase = 'play';
    this.intro();
    // warm-up compile
    this.app.renderer.r.compile(this.scene, this.camera);
  }

  intro() {
    const def = state.casino;
    this.ui.intro(state.day, def.name, state.quota, def.tagline, state.modifier);
    if (state.day === 1 && !this._tutorialShown && SDK.getItem('tutorial') !== '1') {
      this._tutorialShown = true;
      SDK.setItem('tutorial', '1');
      const controls = this.input.isTouch ? '👆 Drag on the right side to look · left stick to walk · <b>USE</b> to play' : '🖱️ Click to look around · <b>WASD</b> to walk · <b>SHIFT</b> to run · <b>E</b> to play';
      setTimeout(() => this.ui.toast(controls, '', 6500), 1500);
      setTimeout(() => this.ui.toast('💰 Make Big Tony\'s quota, then leave through the <b>EXIT</b> before 4:00 AM', 'gold', 6500), 8000);
      setTimeout(() => this.ui.toast('🍸 Drinks at the bar give luck buffs · ✨ Look for dropped chips on the floor', '', 6000), 15000);
    }
    if (state.loanDue > 0) setTimeout(() => this.ui.toast(`🦈 Your loan of ${fmtMoney(state.loanDue)} was added to tonight's quota (+50% interest).`, 'bad', 6000), 6000);
  }

  spawnStaff() {
    const w = this.world, c = this.crowd;
    if (w.bartenderSpot) {
      const b = c.staff('bartender', w.bartenderSpot, (n, dt) => {
        n.t = (n.t || 0) + dt;
        const cyc = Math.floor(n.t / 6) % 3;
        n.jelly.setAction(cyc === 0 ? 'polish' : cyc === 1 ? 'shake' : null);
        const pl = c.player;
        if (pl && n.root.position.distanceToSquared(pl.pos) < 12) n.jelly.lookTarget = pl.camera.position; else n.jelly.lookTarget = null;
      });
      b.jelly.hold(-1, cocktailGlass('tumbler', 0xffffff));
      this.bartender = b;
    }
    if (w.exitPos) {
      const e = w.exitPos;
      const sx = e.x + Math.sin(e.rot) * 2.2 + Math.cos(e.rot) * 2.6, sz = e.z + Math.cos(e.rot) * 2.2 - Math.sin(e.rot) * 2.6;
      c.staff('security', { x: sx, z: sz, ry: e.rot }, (n) => { n.jelly.setAction('guard'); const pl = c.player; n.jelly.lookTarget = pl && n.root.position.distanceToSquared(pl.pos) < 20 ? pl.camera.position : null; });
    }
    // cocktail waitress roams
    const wpts = w.poi.wander;
    if (wpts.length && w.bartenderSpot) {
      const wt = c.staff('waitress', { x: wpts[0][0], z: wpts[0][1], ry: 0 }, (n, dt) => {
        if (n.state !== 'staff') return;
        n.wt = (n.wt || 0) - dt;
        if (n.wt <= 0 && !n.walking) {
          n.walking = true;
          const p = randPick(wpts);
          if (!n.goTo(p[0], p[1], () => { n.state = 'staff'; n.walking = false; n.wt = 3 + Math.random() * 5; n.jelly.setAction('tray'); })) { n.state = 'staff'; n.walking = false; n.wt = 2; }
          else n.jelly.setAction('tray');
        }
      });
      wt.jelly.setAction('tray');
      const tray = new THREE.Group();
      const disc = new THREE.Mesh(G.cyl(0.18, 0.18, 0.012, 24), M.chrome()); tray.add(disc);
      for (let i = 0; i < 3; i++) { const gl = cocktailGlass(['martini', 'champagne', 'tumbler'][i], [0xff6aa8, 0xf3d77a, 0x7ad1ff][i]); gl.position.set(Math.cos(i * 2.1) * 0.09, 0.006, Math.sin(i * 2.1) * 0.09); tray.add(gl); }
      tray.position.set(0, 0.02, 0.02);
      wt.jelly.hold(-1, tray);
      wt.jelly.hands[-1].holdPose = 'open';
    }
  }

  spawnStatues() {
    for (const sp of this.world.statueSpots || []) {
      const j = new Jelly(randomOutfit(4242, 'boss'), { blob: false });
      j.setAction('cheer');
      for (let i = 0; i < 12; i++) j.update(0.05, 0, null);
      j.setAction(null);
      j.actionT = 0;
      const gold = M.gold();
      j.root.traverse((o) => { if (o.isMesh && o.material !== gold) { const keepEyes = o.material && (o.material.transparent || o.material.color?.getHex() === 0xf4f4f0 || o.material.color?.getHex() === 0x050505); if (!keepEyes) o.material = gold; o.castShadow = true; } });
      j.root.position.set(sp.x, 1.0, sp.z);
      j.root.scale.setScalar(1.5);
      j.root.rotation.y = sp.rot || 0;
      this.world.dynamicRoot.add(j.root);
    }
  }

  spawnPickups(initial = false) {
    const w = this.world;
    const n = initial ? 6 + (state.perks.cat || 0) * 4 : 1;
    for (let i = 0; i < n; i++) {
      const p = w.nav.randomWalkable();
      if (!p) continue;
      const base = 5 + Math.floor(rand() * 4) * 5 + (rand() < 0.15 ? 50 : 0);
      const amt = Math.round(base * (1 + (state.perks.cat || 0) * 0.5) * (state.modifier && state.modifier.pickupMult ? state.modifier.pickupMult : 1) * (1 + (state.day - 1) * 0.3));
      const g = new THREE.Group();
      const chip = chipStack(amt >= 50 ? 100 : amt >= 25 ? 25 : 5).children[0];
      chip.scale.setScalar(1.6); chip.rotation.z = 0.15; chip.position.y = 0.006;
      g.add(chip);
      const spark = new THREE.Sprite(M.glow(0xffe08a, 0.8)); spark.scale.set(0.35, 0.35, 1); spark.position.y = 0.06; g.add(spark);
      g.position.set(p[0], 0.002, p[1]);
      this.scene.add(g);
      this.pickups.push({ obj: g, amt, spark, t: rand() * 10 });
    }
  }

  disposeDay() {
    for (const st of this.stations) st.dispose();
    this.stations = [];
    if (this.crowd) { this.crowd.dispose(); this.crowd = null; }
    if (this.world) { this.scene.remove(this.world.group); this.world.dispose(); this.world = null; }
    for (const p of this.pickups) this.scene.remove(p.obj);
    this.pickups = [];
    this.tweens.clear();
  }

  // --------------------------------------------------------------- per frame
  update(dt, t) {
    globalUniforms.uTime.value = t;
    if (this.phase === 'loading' || !this.world) return;
    const running = this.phase === 'play' && !this.paused;
    if (running) {
      state.tick(dt);
      this.ui.setClock(state.clockString(), state.minutesLeft());
      if (state.buffs.length) { this._buffT = (this._buffT || 0) + dt; if (this._buffT > 1) { this._buffT = 0; this.ui.setBuffs(state.buffs); } }
      this.jackpot += dt * (1.7 + state.day * 0.6);
    }
    this.player.drunk = state.drunk();
    this.app.renderer.grade.uniforms.uDrunk.value = this.player.drunk * 0.8;
    if (!this.paused) {
      this.world.update(dt, t);
      this.crowd.update(dt, t);
      for (const st of this.stations) st.update(dt, t, st === this.station);
      this.player.update(dt, this.world.colliders, this.crowd.npcs);
      audio.setListener(this.camera.position, this.player.forward(this._fw || (this._fw = new THREE.Vector3())));
      audio.updateAmbience(dt);
      this.updatePickups(dt, t);
      if (this.world.jackpotBoards) { this._jbT = (this._jbT || 0) + dt; if (this._jbT > 0.12) { this._jbT = 0; for (const jb of this.world.jackpotBoards) jb.userData.draw(this.jackpot, t); } }
    }
    // interaction
    if (running && !this.station && this.player.mode === 'walk' && !this.ui.overlayOpen) this.updateInteraction();
    else this.ui.hidePrompt();
    // flash fade
    this.flashA = Math.max(0, this.flashA - dt * 1.6);
    const f = this.app.renderer.grade.uniforms.uFlash.value;
    f.set(this.flashColor.r, this.flashColor.g, this.flashColor.b, this.flashA);
    // hints
    const free = this.phase === 'play' && !this.paused && !this.station && !this.input.isTouch && !this.ui.overlayOpen;
    if (free && !this.input.locked && !this.input.dragLook) this.ui.hint('<b>Click</b> to look around');
    else if (free && this.input.dragLook && !this.input.dragged) this.ui.hint('Hold the <b>left mouse button</b> and drag to look around');
    else this.ui.hideHint();
  }

  updatePickups(dt, t) {
    const pp = this.player.pos;
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      p.t += dt;
      p.spark.material.opacity = 0.4 + 0.5 * Math.abs(Math.sin(p.t * 3));
      p.spark.scale.setScalar(0.25 + 0.15 * Math.abs(Math.sin(p.t * 2.3)));
      const d = Math.hypot(p.obj.position.x - pp.x, p.obj.position.z - pp.z);
      if (d < 0.9 && this.player.mode === 'walk') {
        this.scene.remove(p.obj);
        this.pickups.splice(i, 1);
        state.gift(p.amt, 'pickup');
        state.stats.pickups++;
        audio.play('coins', { count: 5 });
        this.ui.toast(`✨ Found ${fmtMoney(p.amt)} in dropped chips!`, 'good', 1800);
      }
    }
    this._pickT = (this._pickT || 0) + dt;
    if (this._pickT > 40 / (1 + (state.perks.cat || 0))) { this._pickT = 0; if (this.pickups.length < 10) this.spawnPickups(false); }
  }

  interactables() {
    const out = [];
    for (const st of this.stations) {
      const p = st.interactWorld();
      const [label, sub] = st.promptText();
      out.push({ x: p.x, z: p.z, y: 1.2, r: st.interactR, label, sub, use: () => this.enterStation(st), lookAt: st.worldPos() });
    }
    for (const it of this.world.interactables) {
      const sub = it.kind === 'exit' ? (state.goalMet() ? 'Pay Big Tony and end the night' : `You still owe ${fmtMoney(state.quota - state.money)}`) : it.kind === 'bar' ? 'Drinks give luck buffs' : it.kind === 'atm' ? (state.flags.atmUsed ? 'Already used tonight' : 'Free cash for watching an ad') : '';
      out.push({ x: it.x, z: it.z, y: it.y, r: it.r, label: it.label, sub, use: () => this.useWorld(it), lookAt: null });
    }
    return out;
  }

  updateInteraction() {
    const pp = this.player.pos;
    const fw = this.player.forward(this._fw2 || (this._fw2 = new THREE.Vector3()));
    let best = null, bestScore = -1;
    for (const it of this.interactables()) {
      const dx = it.x - pp.x, dz = it.z - pp.z, d = Math.hypot(dx, dz);
      if (d > it.r) continue;
      const tx = (it.lookAt ? it.lookAt.x : it.x) - pp.x, tz = (it.lookAt ? it.lookAt.z : it.z) - pp.z, tl = Math.hypot(tx, tz) || 1;
      const facing = (fw.x * tx + fw.z * tz) / (tl * Math.hypot(fw.x, fw.z) || 1);
      if (facing < 0.35) continue;
      const score = facing * 2 - d / it.r;
      if (score > bestScore) { bestScore = score; best = it; }
    }
    if (best) {
      this.ui.prompt(best.label, best.sub, this.input.isTouch ? 'USE' : 'E');
      if (this.input.hit('KeyE') || this.input.hit('Enter') || (this.input.clicked && this.input.locked) || (this.input.tapped && this.input.dragLook) || this._touchUse) { this._touchUse = false; best.use(); }
    } else this.ui.hidePrompt();
    this._touchUse = false;
  }
  touchUse() { this._touchUse = true; }

  // --------------------------------------------------------------- stations
  enterStation(st) {
    if (this.station) return;
    if (st.instant) { st.use(); return; }
    if (st.occupiedByNpc && st.occupiedByNpc()) { this.ui.toast('Someone is already playing here.', 'bad'); return; }
    this.station = st;
    this.input.exitLock();
    const pose = st.camPose();
    this.player.sit(pose.pos, pose.look, 0.75);
    this.ui.hidePrompt();
    this.ui.crosshairVisible(false);
    this.input.showTouch(false);
    audio.play('whoosh', { vol: 0.5 });
    st.enter();
  }
  leaveStation(silent = false) {
    const st = this.station;
    if (!st) return;
    if (st.canLeave && !st.canLeave() && !silent) { this.ui.toast('Finish the round first!', 'bad'); audio.play('deny'); return; }
    st.leave();
    this.ui.closePanel();
    this.station = null;
    this.ui.crosshairVisible(true);
    this.input.showTouch(true);
    if (!silent) { this.player.stand(0.6); if (!this.input.isTouch) this.input.requestLock(); }
    if (state.money < 1 && !silent) setTimeout(() => this.checkBroke(), 800);
  }

  // --------------------------------------------------------------- world interactions
  useWorld(it) {
    if (it.kind === 'exit') return this.tryExit();
    if (it.kind === 'bar') return this.openBar();
    if (it.kind === 'atm') return this.useATM();
  }

  openBar() {
    this.input.exitLock();
    if (this.bartender) { this.bartender.say(randPick(['What\'ll it be?', 'Name your poison!', 'Feeling lucky? Drink up!'])); }
    const free = state.modifier && state.modifier.freeDrinks;
    const card = h('div', 'card');
    card.innerHTML = `<h1>🍸 The Bar</h1><p>Every drink gives a temporary luck buff. Don't drink too many — the room starts to wobble.</p>`;
    const grid = h('div', 'drinks');
    for (const d of DRINKS) {
      const price = free ? 0 : d.price * Math.max(1, Math.ceil(state.day / 2));
      const it = h('div', 'item', `<div class="top"><div class="ico">${{ lemonade: '🍋', martini: '🍸', espresso: '☕', tiki: '🌋' }[d.id]}</div><div><div class="nm">${d.name}</div><div class="lv">${price ? fmtMoney(price) : 'FREE (Happy Hour)'}</div></div></div><div class="ds">${d.desc}</div>`);
      const b = this.ui.button('Order', 'small', () => {
        if (price && !state.spend(price, 'drink')) { this.ui.toast('Not enough cash!', 'bad'); audio.play('deny'); return; }
        state.addBuff(d.effect, d.name);
        state.stats.drinks++;
        audio.play('pour'); setTimeout(() => audio.play('gulp'), 900);
        this.player.holdDrink(cocktailGlass(d.glass, d.color));
        clearTimeout(this._drinkT); this._drinkT = setTimeout(() => this.player.holdDrink(null), d.effect.dur * 1000);
        this.ui.toast(`${d.name}! ${d.desc}`, 'good');
        this.ui.closeOverlay();
      });
      it.append(b); grid.append(it);
    }
    card.append(grid);
    const row = h('div', 'center'); row.append(this.ui.button('Back', 'dark', () => this.ui.closeOverlay(), 'Escape', 'Esc')); card.append(row);
    this.ui.overlay(card, { allowHotkeys: true, onClose: () => { if (!this.input.isTouch) this.input.requestLock(); } });
  }

  async useATM() {
    if (state.flags.atmUsed) { this.ui.toast('The ATM is out of emergency cash tonight.', 'bad'); audio.play('deny'); return; }
    const amount = Math.round(stakeBonus() / 10) * 10;
    this.input.exitLock();
    const card = h('div', 'card', `<h1>🏧 Emergency Cash</h1><p>Watch a short ad and the ATM spits out <b style="color:#ffd36a">${fmtMoney(amount)}</b>. One use per night.</p>`);
    const row = h('div', 'center');
    row.append(this.ui.button('📺 Watch ad', 'green big', async () => {
      this.ui.closeOverlay();
      const ok = await this.rewardedAd();
      if (ok) { state.flags.atmUsed = true; state.gift(amount, 'atm'); audio.play('register'); this.ui.banner('+' + fmtMoney(amount), 'Emergency cash!', 'green', 1800); }
      else this.ui.toast('The ad could not be shown. Try again later.', 'bad');
    }), this.ui.button('Not now', 'dark', () => this.ui.closeOverlay(), 'Escape', 'Esc'));
    card.append(row);
    this.ui.overlay(card, { allowHotkeys: true, onClose: () => { if (!this.input.isTouch && !this.station) this.input.requestLock(); } });
  }

  openLoan(npc) {
    this.input.exitLock();
    const max = Math.round(quotaFor(state.day) * 0.5 / 50) * 50;
    const already = state.flags.loanTaken || 0;
    const card = h('div', 'card', `<div class="tony">🦈</div><h1>"Fingers" Fontaine</h1><p>"Short on cash, pal? I can float you a little something. You pay me back tomorrow — with a teeny bit of interest. 50%. Very reasonable."</p><p class="mini">Borrowed tonight: ${fmtMoney(already)} / ${fmtMoney(max)}. Loans are added to tomorrow's quota ×1.5.</p>`);
    const row = h('div', 'center');
    for (const amt of [100, 250, 500, 1000].map((a) => Math.round(a * (1 + (state.day - 1) * 0.5)))) {
      const b = this.ui.button('Borrow ' + fmtMoney(amt), 'red', () => {
        if (already + amt > max) { this.ui.toast("Fingers: \"That's too much, even for me.\"", 'bad'); audio.play('deny'); return; }
        state.flags.loanTaken = already + amt;
        state.loan += amt;
        state.gift(amt, 'loan');
        audio.play('register');
        if (npc) npc.say('Pleasure doing business! Heh heh.');
        this.ui.closeOverlay();
      });
      if (already + amt > max) b.disabled = true;
      row.append(b);
    }
    row.append(this.ui.button('No thanks', 'dark', () => this.ui.closeOverlay(), 'Escape', 'Esc'));
    card.append(row);
    this.ui.overlay(card, { allowHotkeys: true, onClose: () => { if (!this.input.isTouch && !this.station) this.input.requestLock(); } });
  }

  checkBroke() {
    if (this.phase !== 'play' || state.money >= 1 || this.ui.overlayOpen) return;
    const canATM = !state.flags.atmUsed;
    const card = h('div', 'card', `<div class="tony">💸</div><h1>You're Broke!</h1><p>Your pockets are empty and Big Tony still wants <b>${fmtMoney(state.quota)}</b>.</p>`);
    const row = h('div', 'center');
    if (canATM) row.append(this.ui.button('📺 Emergency cash (ad)', 'green', () => { this.ui.closeOverlay(); this.useATM(); }));
    row.append(this.ui.button('🦈 Find the loan shark', 'red', () => { this.ui.closeOverlay(); this.ui.toast('Fingers Fontaine lurks in the back of the bar area…', 'gold', 5000); }));
    row.append(this.ui.button('Give up', 'dark', () => { this.ui.closeOverlay(); this.gameOver('broke'); }));
    card.append(row);
    this.input.exitLock();
    this.ui.overlay(card, { allowHotkeys: true });
  }

  // --------------------------------------------------------------- big moments
  bigWin(title, sub, tier, pos) {
    const kind = tier === 'jackpot' ? '' : tier === 'mega' ? '' : '';
    this.ui.banner(title, sub, kind, tier === 'jackpot' ? 3600 : 2400);
    audio.play(tier === 'big' ? 'winBig' : 'jackpot');
    audio.play('coins', { count: tier === 'big' ? 10 : 24 });
    setTimeout(() => audio.play('cheer', { pos: pos ? pos : undefined, vol: 0.9 }), 250);
    this.flash(tier === 'big' ? 0.35 : 0.6, 0xffd060);
    if (this.crowd && pos) this.crowd.reactAt(pos, 'win', tier === 'big' ? 7 : 12);
    if (tier !== 'big') { SDK.happytime(); state.stats.jackpots++; }
    this.coinShower(tier === 'big' ? 40 : 110);
  }
  bigLoss(pos, amount) {
    if (amount < 200) return;
    audio.play('aww', { pos });
    if (this.crowd) this.crowd.reactAt(pos, 'lose', 6);
    this.flash(0.25, 0xff2030);
  }
  flash(a, color) { this.flashA = Math.max(this.flashA, a); this.flashColor.set(color); }

  coinShower(n) {
    // DOM coin shower: cheap and very satisfying
    const root = this.ui.root;
    for (let i = 0; i < n; i++) {
      const c = document.createElement('div');
      c.className = 'coin-fx';
      const size = 18 + Math.random() * 22;
      c.style.cssText = `position:absolute;left:${Math.random() * 100}vw;top:-40px;width:${size}px;height:${size}px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#fff6b0,#ffc23a 45%,#a86a0a);box-shadow:inset 0 0 0 3px #d8941a,0 3px 8px rgba(0,0,0,.5);z-index:15;pointer-events:none;`;
      root.append(c);
      const dur = 1400 + Math.random() * 1600, delay = Math.random() * 700;
      c.animate([{ transform: `translateY(0) rotateY(0deg)` }, { transform: `translateY(${window.innerHeight + 80}px) rotateY(${720 + Math.random() * 720}deg)` }], { duration: dur, delay, easing: 'cubic-bezier(.4,.1,.8,.6)' }).onfinish = () => c.remove();
    }
  }

  // --------------------------------------------------------------- end of night
  tryExit() {
    if (!state.goalMet()) {
      this.ui.toast(`🚪 Security: "Big Tony said you don't leave until you've got ${fmtMoney(state.quota)}." You need ${fmtMoney(state.quota - state.money)} more.`, 'bad', 4000);
      audio.play('deny');
      return;
    }
    this.endNight(false);
  }

  closingTime() {
    if (this.phase !== 'play') return;
    this.leaveStation(true);
    if (state.goalMet()) this.endNight(true);
    else this.lastChance();
  }

  async lastChance() {
    this.phase = 'menu';
    this.input.exitLock();
    SDK.gameplayStop();
    const short = state.quota - state.money;
    const card = h('div', 'card', `<div class="tony">🕓</div><h1>Closing Time</h1><p>Big Tony's goons are at the door. You're <b style="color:#ff8a8a">${fmtMoney(short)}</b> short.</p>`);
    const row = h('div', 'center');
    if (!state.flags.extraHour) row.append(this.ui.button('📺 Bribe the doorman: +1 hour (ad)', 'green big', async () => {
      this.ui.closeOverlay();
      const ok = await this.rewardedAd();
      if (ok) {
        state.flags.extraHour = true; state.dayLength += 60; this.phase = 'play'; SDK.gameplayStart();
        this.ui.banner('+1 HOUR', 'The doorman looks the other way…', 'green', 2200);
        if (!this.input.isTouch) this.input.requestLock();
      } else { this.ui.toast('The ad could not be shown.', 'bad'); this.gameOver('time'); }
    }));
    row.append(this.ui.button('Face Big Tony', 'red', () => { this.ui.closeOverlay(); this.gameOver('time'); }));
    card.append(row);
    this.ui.overlay(card);
  }

  endNight(auto) {
    if (this.phase !== 'play') return;
    this.phase = 'menu';
    this.leaveStation(true);
    this.input.exitLock();
    SDK.gameplayStop();
    SDK.happytime();
    audio.play('door'); setTimeout(() => audio.play('register'), 600);
    const paid = state.quota;
    const before = state.money;
    state.money -= paid;
    state.stats.daysCleared = (state.stats.daysCleared || 0) + 1;
    state.saveBest();
    const ds = state.dayStats;
    const card = h('div', 'card');
    card.innerHTML = `<h1>Night ${state.day} Survived!</h1><p>${auto ? 'The lights come up at 4:00 AM.' : 'You stroll out with your pockets bulging.'} Big Tony counts his cut and grins.</p>
      <div class="stats">
        <div class="stat"><small>Walked out with</small><b class="y">${fmtMoney(before)}</b></div>
        <div class="stat"><small>Paid to Big Tony</small><b class="r">-${fmtMoney(paid)}</b></div>
        <div class="stat"><small>You keep</small><b class="g">${fmtMoney(state.money)}</b></div>
        <div class="stat"><small>Bets placed</small><b>${ds.hands}</b></div>
        <div class="stat"><small>Biggest win</small><b class="g">${fmtMoney(ds.biggest)}</b></div>
        <div class="stat"><small>Next quota</small><b class="r">${fmtMoney(quotaFor(state.day + 1))}</b></div>
      </div>`;
    const row = h('div', 'center');
    row.append(this.ui.button('Visit the Charm Shop →', 'big pulse', () => this.openShop()));
    card.append(row);
    this.ui.overlay(card);
    this.ui.hudVisible(false);
    state.flushSave();
  }

  openShop() {
    const card = h('div', 'card');
    const render = () => {
      card.innerHTML = `<h1>🔮 Madame Wobble's Charm Shop</h1><p>Lucky charms last for the whole run. You have <b style="color:#ffd36a">${fmtMoney(state.money)}</b>.</p>`;
      const grid = h('div', 'shop');
      for (const p of PERKS) {
        const lvl = state.perks[p.id] || 0;
        const price = Math.round(p.price * Math.pow(1.6, lvl) * (1 + (state.day - 1) * 0.15) / 10) * 10;
        const maxed = lvl >= p.max;
        const it = h('div', 'item' + (maxed ? ' owned' : ''), `<div class="top"><div class="ico">${p.icon}</div><div><div class="nm">${p.name}</div><div class="lv">${maxed ? 'MAXED' : lvl ? `Level ${lvl} → ${lvl + 1}` : 'New'}</div></div></div><div class="ds">${p.desc}</div>`);
        const b = this.ui.button(maxed ? 'Owned' : 'Buy ' + fmtMoney(price), 'small', () => {
          if (!state.spend(price, 'perk')) { this.ui.toast('Not enough cash.', 'bad'); audio.play('deny'); return; }
          state.perks[p.id] = lvl + 1; audio.play('powerup');
          render();
        });
        if (maxed || state.money < price) b.disabled = true;
        it.append(b); grid.append(it);
      }
      card.append(grid);
      const next = casinoFor(state.day + 1);
      const info = h('p', '', `Tomorrow: <b style="color:#ffd36a">${next.name}</b> — Big Tony will want ${fmtMoney(quotaFor(state.day + 1))}. You'll get a fresh stake from him to start.`);
      card.append(info);
      const row = h('div', 'center');
      row.append(this.ui.button('Next Night ▶', 'green big pulse', () => this.nextNight()));
      card.append(row);
    };
    render();
    this.ui.overlay(card);
  }

  async nextNight() {
    this.ui.closeOverlay();
    // natural break: midgame ad
    await this.midgameAd();
    state.day++;
    state.startDay(false);
    state.save();
    await this.app.showLoading(true);
    await this.loadDay((p, msg) => this.app.setLoading(p, msg));
    await this.app.showLoading(false);
    this.ui.hudVisible(true);
    this.offerDoubleStake();
    SDK.gameplayStart();
  }

  offerDoubleStake() {
    if (state.flags.stakeDoubled) return;
    const bonus = state.stake;
    setTimeout(() => {
      if (this.phase !== 'play' || this.ui.overlayOpen || this.station) return;
      const card = h('div', 'card', `<div class="tony">🤌</div><h1>Big Tony's Offer</h1><p>"Here's your stake: <b style="color:#ffd36a">${fmtMoney(bonus)}</b>. Watch a little commercial for my associates and I'll double it."</p>`);
      const row = h('div', 'center');
      row.append(this.ui.button(`📺 Double it (+${fmtMoney(bonus)})`, 'green big', async () => {
        this.ui.closeOverlay();
        const ok = await this.rewardedAd();
        if (ok) { state.flags.stakeDoubled = true; state.gift(bonus, 'stake'); this.ui.banner('STAKE DOUBLED', '+' + fmtMoney(bonus), 'green', 2000); audio.play('register'); }
        else this.ui.toast('The ad could not be shown.', 'bad');
        if (!this.input.isTouch) this.input.requestLock();
      }), this.ui.button('No thanks', 'dark', () => { this.ui.closeOverlay(); if (!this.input.isTouch) this.input.requestLock(); }, 'Escape', 'Esc'));
      card.append(row);
      this.input.exitLock();
      this.ui.overlay(card, { allowHotkeys: true });
    }, 6500);
  }

  gameOver(reason) {
    this.phase = 'over';
    this.leaveStation(true);
    this.input.exitLock();
    SDK.gameplayStop();
    audio.play('lose'); setTimeout(() => audio.play('boom', { vol: 0.5 }), 500);
    state.saveBest();
    state.clearRun();
    const s = state.stats;
    const card = h('div', 'card');
    const title = reason === 'broke' ? 'Busted!' : 'Big Tony Is Not Happy';
    const msg = reason === 'broke' ? 'You lost everything. The goons escort you out by your wobbly ears.' : `It's 4:00 AM and you're ${fmtMoney(Math.max(0, state.quota - state.money))} short. You'll be washing Big Tony's limo for a year.`;
    card.innerHTML = `<div class="tony">${reason === 'broke' ? '💀' : '🕴️'}</div><h1>${title}</h1><p>${msg}</p>
      <div class="stats">
        <div class="stat"><small>Nights survived</small><b class="y">${state.day - 1}</b></div>
        <div class="stat"><small>Biggest win</small><b class="g">${fmtMoney(s.biggestWin)}</b></div>
        <div class="stat"><small>Total wagered</small><b>${fmtMoney(s.totalWagered)}</b></div>
        <div class="stat"><small>Bets placed</small><b>${s.hands}</b></div>
        <div class="stat"><small>Jackpots</small><b class="y">${s.jackpots}</b></div>
        <div class="stat"><small>Best night ever</small><b class="y">${Math.max(state.best.day, state.day)}</b></div>
      </div>`;
    const row = h('div', 'center');
    row.append(this.ui.button('Try Again ↻', 'big pulse', async () => {
      this.ui.closeOverlay();
      await this.midgameAd();
      state.newRun();
      state.save();
      await this.app.showLoading(true);
      await this.loadDay((p, m) => this.app.setLoading(p, m));
      await this.app.showLoading(false);
      this.ui.hudVisible(true);
      SDK.gameplayStart();
    }));
    card.append(row);
    this.ui.hudVisible(false);
    this.ui.overlay(card);
  }

  // --------------------------------------------------------------- ads
  async midgameAd() {
    audio.setMuted(true);
    const ok = await SDK.midgame();
    audio.setMuted(this.app.muted);
    return ok;
  }
  async rewardedAd() {
    const wasPaused = this.paused;
    this.paused = true;
    SDK.gameplayStop();
    audio.setMuted(true);
    const ok = await SDK.rewarded();
    audio.setMuted(this.app.muted);
    this.paused = wasPaused;
    if (this.phase === 'play') SDK.gameplayStart();
    return ok;
  }

  // --------------------------------------------------------------- pause
  togglePause() {
    if (this.phase !== 'play') return;
    if (this.ui.overlayOpen) { if (this.paused) this.resume(); else this.ui.closeOverlay(); return; }
    this.paused = true;
    SDK.gameplayStop();
    this.input.exitLock();
    const card = h('div', 'card');
    card.innerHTML = `<h1>Paused</h1><p>Night ${state.day} · ${state.casino.name} · ${state.clockString()}</p>`;
    const settings = h('div', '');
    const vol = h('div', 'setting', `<span>Master volume</span>`);
    const vr = h('input'); vr.type = 'range'; vr.min = 0; vr.max = 1; vr.step = 0.05; vr.value = audio.userVolume; vr.oninput = () => { audio.setVolume(+vr.value); this.app.saveSettings(); };
    vol.append(vr);
    const mus = h('div', 'setting', `<span>Music volume</span>`);
    const mr = h('input'); mr.type = 'range'; mr.min = 0; mr.max = 1; mr.step = 0.05; mr.value = audio.musicVolume; mr.oninput = () => { audio.setMusicVolume(+mr.value); this.app.saveSettings(); };
    mus.append(mr);
    const sens = h('div', 'setting', `<span>Look sensitivity</span>`);
    const sr = h('input'); sr.type = 'range'; sr.min = 0.3; sr.max = 2.5; sr.step = 0.05; sr.value = this.input.sensitivity; sr.oninput = () => { this.input.sensitivity = +sr.value; this.app.saveSettings(); };
    sens.append(sr);
    const ql = h('div', 'setting', `<span>Graphics quality</span>`);
    const seg = h('div', 'seg');
    for (const q of ['low', 'medium', 'high']) {
      const b = h('button', this.app.renderer.quality === q ? 'on' : '', q.toUpperCase());
      b.onclick = () => { this.app.renderer.autoQuality = false; this.app.renderer.setQuality(q); seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); this.app.saveSettings(); };
      seg.append(b);
    }
    ql.append(seg);
    settings.append(vol, mus, sens, ql);
    card.append(settings);
    const help = h('p', 'mini', this.input.isTouch
      ? 'Left stick: walk · drag on the right: look · USE: play · RUN: hurry. Reach the quota, then walk out the EXIT before 4:00 AM.'
      : 'WASD move · Mouse look · Shift run · E interact · Esc pause/leave a game. Reach the quota, then walk out the EXIT before 4:00 AM.');
    card.append(help);
    const row = h('div', 'center');
    row.append(this.ui.button('Resume', 'big green', () => this.resume()));
    let armed = false;
    const abandon = this.ui.button('Abandon run', 'dark', () => {
      if (!armed) { armed = true; abandon.textContent = this.input.isTouch ? 'Tap again to abandon' : 'Click again to abandon'; setTimeout(() => { armed = false; abandon.textContent = 'Abandon run'; }, 3000); return; }
      this.resume(); this.gameOver('broke');
    });
    row.append(abandon);
    card.append(row);
    this.ui.overlay(card, { allowHotkeys: false });
  }
  resume() {
    this.paused = false;
    this.ui.closeOverlay();
    if (this.phase === 'play') { SDK.gameplayStart(); if (!this.station && !this.input.isTouch) this.input.requestLock(); }
  }
}

function stakeBonus() { return Math.max(150, quotaFor(state.day) * 0.15); }
