import './ui/style.css';
import * as THREE from 'three';
import { SDK } from './sdk.js';
import { Renderer } from './engine/renderer.js';
import { Input } from './engine/input.js';
import { audio } from './engine/audio.js';
import { Tweens, nextFrame, wait } from './engine/util.js';
import { UI } from './ui/ui.js';
import { Framing } from './engine/framing.js';
import { Player } from './player/player.js';
import { Director } from './game/director.js';
import { state } from './game/state.js';

// ============================================================================
//  Gamble! — boot sequence and main loop.
//  The game drops you straight onto the casino floor; menus only appear
//  between nights, on game over, or when you pause.
// ============================================================================

const TIPS = [
  'Tip: Any cherry on a classic slot pays something.',
  'Tip: Drinks at the bar give temporary luck buffs.',
  'Tip: Dropped chips sparkle on the carpet. Grab them!',
  'Tip: The loan shark will always lend you money. Tomorrow, you pay 50% more.',
  'Tip: Video slots: 3 BONUS stars trigger free spins at double pay.',
  'Tip: Watch an ad at the ATM for emergency cash once per night.',
  'Tip: Blackjack pays 3 to 2. Dealer stands on all 17s.',
];

const DEV = import.meta.env.DEV;
const FAST = DEV && /[?&]fast/.test(location.search);

class App {
  constructor() {
    this.canvas = document.getElementById('game');
    this.loadingEl = document.getElementById('loading');
    this.muted = false;
  }

  setLoading(p, msg) {
    const bar = this.loadingEl.querySelector('.bar i');
    bar.style.width = Math.round(p * 100) + '%';
    if (msg) this.loadingEl.querySelector('.tip').textContent = msg;
  }
  async showLoading(v) {
    if (v) {
      this.loadingEl.classList.remove('done');
      this.loadingEl.style.display = '';
      this.loadingEl.querySelector('.sub').textContent = TIPS[Math.floor(Math.random() * TIPS.length)];
      SDK.gameplayStop();
      await nextFrame(); await nextFrame();
    } else {
      this.loadingEl.classList.add('done');
      setTimeout(() => { if (this.loadingEl.classList.contains('done')) this.loadingEl.style.display = 'none'; }, 700);
    }
  }

  saveSettings() {
    SDK.setItem('settings', JSON.stringify({ vol: audio.userVolume, music: audio.musicVolume, sens: this.input.sensitivity, quality: this.renderer.autoQuality ? null : this.renderer.quality }));
  }
  loadSettings() {
    try {
      const s = JSON.parse(SDK.getItem('settings') || 'null');
      if (!s) return;
      if (typeof s.vol === 'number') audio.userVolume = s.vol;
      if (typeof s.music === 'number') audio.musicVolume = s.music;
      if (typeof s.sens === 'number') this.input.sensitivity = s.sens;
      if (s.quality) { this.renderer.autoQuality = false; this.renderer.setQuality(s.quality); }
    } catch (e) { /* ignore */ }
  }

  async start() {
    // SDK first (bounded wait so a blocked SDK never stalls the game)
    await Promise.race([SDK.init(), wait(4000)]);
    SDK.loadingStart();
    // Saves are read only now, after SDK.init(), so they come from the CrazyGames data module.
    state.loadBest();
    this.setLoading(0.03, 'Counting chips…');

    const renderer = (this.renderer = new Renderer(this.canvas));
    const scene = (this.scene = new THREE.Scene());
    const camera = (this.camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.03, 140));
    scene.add(camera);
    renderer.setup(scene, camera);
    const gl = renderer.r.getContext();
    const weak = !gl || renderer.r.capabilities.maxTextureSize < 4096 || /Mobi|Android/i.test(navigator.userAgent);
    renderer.setQuality(weak ? 'low' : 'high');
    this.input = new Input(this.canvas);
    this.ui = new UI(document.getElementById('ui'));
    this.ui.setTouch(this.input.isTouch);
    this.framing = new Framing(camera, this.ui, 72);
    this.tweens = new Tweens();
    this.player = new Player(camera, this.input);
    this.loadSettings();
    this.director = new Director(this);
    const d = this.director;

    // SDK hooks
    SDK.onAdStart = () => { this._pausedForAd = !d.paused; d.paused = true; audio.setMuted(true); };
    SDK.onAdEnd = () => { if (this._pausedForAd) d.paused = false; audio.setMuted(this.muted); };
    SDK.onMuteChange = (m) => { this.muted = m; audio.setMuted(m); };
    this.muted = SDK.muteAudioSetting;

    // resume a run in progress or start fresh (no menus: straight into the casino)
    const dayParam = DEV ? +(new URLSearchParams(location.search).get('day') || 0) : 0;
    if (dayParam > 0) { state.newRun(); state.day = dayParam; state.startDay(true); state.money = state.quota * 0.6; }
    else if (!state.loadRun()) { state.newRun(); state.save(); }
    await d.loadDay((p, msg) => this.setLoading(0.05 + p * 0.95, msg));
    this.setLoading(1, 'Let\'s gamble!');
    SDK.loadingStop();
    await wait(250);
    this.showLoading(false);
    SDK.gameplayStart();

    this.bindEvents();
    this.input.setupTouch(document.getElementById('ui'), () => d.touchUse());
    this.ui.onPause = () => { if (d.phase === 'play' && !this.ui.overlayOpen) d.togglePause(); };
    this.loop();
    if (DEV) window.__gamble = this; // handy for automated smoke tests
  }

  bindEvents() {
    const d = this.director, input = this.input;
    const startAudio = () => {
      audio.init();
      audio.setMuted(this.muted);
      if (!audio.music && d.world) audio.startMusic(d.world.theme.music);
    };
    window.addEventListener('pointerdown', startAudio);
    window.addEventListener('keydown', startAudio);
    this.canvas.addEventListener('click', () => {
      if (d.phase === 'play' && !d.paused && !d.station && !this.ui.overlayOpen) input.requestLock(true);
    });
    let lastUnlock = 0;
    input.on('lockchange', (locked) => {
      if (!locked) {
        lastUnlock = performance.now();
        if (d.phase === 'play' && !d.station && !this.ui.overlayOpen && !d.paused && d.player.mode === 'walk') d.togglePause();
      }
    });
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Escape' && e.code !== 'KeyP') return;
      if (e.defaultPrevented) return; // already handled by a UI hotkey (e.g. Leave)
      if (performance.now() - lastUnlock < 300) return;
      if (d.station) return; // the panel's Leave button owns Escape
      if (this.ui.overlayOpen) { if (d.paused && e.code === 'Escape') d.resume(); return; }
      d.togglePause();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { state.flushSave(); audio.suspend(); if (d.phase === 'play' && !d.paused && !this.ui.overlayOpen && !d.station) d.togglePause(); }
      else audio.resume();
    });
    window.addEventListener('pagehide', () => state.flushSave());
    window.addEventListener('beforeunload', () => state.flushSave());
  }

  loop() {
    let last = performance.now(), t = 0;
    const frame = (now) => {
      requestAnimationFrame(frame);
      let dt = (now - last) / 1000; last = now;
      if (!(dt > 0)) dt = 0;
      dt = Math.min(dt, FAST ? 0.25 : 0.05);
      t += dt;
      const d = this.director;
      if (!d.paused) this.tweens.update(dt);
      d.update(dt, t);
      this.ui.tick(dt);
      this.renderer.adapt(dt);
      this.framing.update(dt);
      this.renderer.render(t);
      this.input.endFrame();
    };
    requestAnimationFrame(frame);
  }
}

const app = new App();
app.start().catch((e) => {
  console.error(e);
  const el = document.querySelector('#loading .tip');
  if (el) el.textContent = 'Something went wrong while loading. Please refresh the page.';
});
