// Fully procedural Web Audio engine: SFX, positional one-shots, crowd ambience
// and a generative lounge-jazz soundtrack. No audio files are shipped.
import { clamp } from './util.js';

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class Audio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.muted = false; // SDK / ad mute
    this.userVolume = 0.8;
    this.musicVolume = 0.5;
    this.listener = { x: 0, y: 1.6, z: 0, fx: 0, fz: -1, rx: 1, rz: 0 };
    this.loops = new Map();
    this.music = null;
  }

  /** Must be called from a user gesture (or will be resumed on first gesture). */
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.enabled = false; return; }
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14; this.comp.ratio.value = 4; this.comp.attack.value = 0.004; this.comp.release.value = 0.2;
    this.master.connect(this.comp).connect(ctx.destination);
    this.sfx = ctx.createGain(); this.sfx.gain.value = 0.9; this.sfx.connect(this.master);
    this.mus = ctx.createGain(); this.mus.gain.value = this.musicVolume * 0.55; this.mus.connect(this.master);
    this.amb = ctx.createGain(); this.amb.gain.value = 0.5; this.amb.connect(this.master);
    // Shared reverb (a short "room") for warmth
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this._impulse(1.6, 2.5);
    this.revSend = ctx.createGain(); this.revSend.gain.value = 0.22;
    this.revSend.connect(this.reverb).connect(this.master);
    this.noiseBuf = this._noise(2);
    this._applyVolume();
    this._startAmbience();
  }

  _impulse(sec, decay) {
    const ctx = this.ctx, len = Math.floor(ctx.sampleRate * sec);
    const b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay); }
    return b;
  }
  _noise(sec) {
    const ctx = this.ctx, len = Math.floor(ctx.sampleRate * sec);
    const b = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  setMuted(m) { this.muted = m; this._applyVolume(); }
  setVolume(v) { this.userVolume = v; this._applyVolume(); }
  setMusicVolume(v) { this.musicVolume = v; if (this.mus) this.mus.gain.value = v * 0.55; }
  _applyVolume() {
    if (!this.ctx) return;
    const v = this.muted ? 0 : this.userVolume;
    this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }
  suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend(); }
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  setListener(pos, forward) {
    const l = this.listener;
    l.x = pos.x; l.y = pos.y; l.z = pos.z;
    const len = Math.hypot(forward.x, forward.z) || 1;
    l.fx = forward.x / len; l.fz = forward.z / len;
    l.rx = -l.fz; l.rz = l.fx;
  }

  /** Returns a destination node for a world position (distance falloff + stereo pan). */
  _spatial(pos, refDist = 2.5, maxDist = 30) {
    const ctx = this.ctx;
    if (!pos) return { node: this.sfx, gain: 1 };
    const l = this.listener;
    const dx = pos.x - l.x, dz = pos.z - l.z;
    const d = Math.hypot(dx, dz, (pos.y || 1.2) - l.y);
    if (d > maxDist) return null;
    const g = clamp(refDist / Math.max(refDist, d), 0, 1) * clamp((maxDist - d) / (maxDist * 0.3), 0, 1);
    const pan = clamp((dx * l.rx + dz * l.rz) / Math.max(1, d), -1, 1) * 0.85;
    const gn = ctx.createGain(); gn.gain.value = g;
    const p = ctx.createStereoPanner(); p.pan.value = pan;
    gn.connect(p).connect(this.sfx);
    return { node: gn, gain: g };
  }

  _env(gainNode, t, a, peak, d, sustain = 0) {
    const g = gainNode.gain;
    g.setValueAtTime(0.0001, t);
    g.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.exponentialRampToValueAtTime(Math.max(0.0001, sustain || 0.0001), t + a + d);
  }

  tone(freq, dur = 0.2, { type = 'sine', gain = 0.3, attack = 0.005, when = 0, dest, slide, detune = 0, reverb = 0.1, filter } = {}) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime + when;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t); o.detune.value = detune;
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
    const g = ctx.createGain();
    this._env(g, t, attack, gain, dur);
    let n = o;
    if (filter) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = filter; o.connect(f); n = f; }
    n.connect(g);
    const out = dest || this.sfx;
    g.connect(out);
    if (reverb) { const s = ctx.createGain(); s.gain.value = reverb; g.connect(s).connect(this.revSend); }
    o.start(t); o.stop(t + attack + dur + 0.05);
  }

  noise(dur = 0.2, { type = 'bandpass', freq = 1000, q = 1, gain = 0.3, attack = 0.003, when = 0, dest, sweep, reverb = 0.05 } = {}) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime + when;
    const s = ctx.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (sweep) f.frequency.exponentialRampToValueAtTime(sweep, t + dur);
    const g = ctx.createGain();
    this._env(g, t, attack, gain, dur);
    s.connect(f).connect(g).connect(dest || this.sfx);
    if (reverb) { const r = ctx.createGain(); r.gain.value = reverb; g.connect(r).connect(this.revSend); }
    s.start(t, Math.random() * 1.5); s.stop(t + attack + dur + 0.05);
  }

  fm(freq, dur, { ratio = 3.5, index = 4, gain = 0.25, when = 0, dest, attack = 0.002, reverb = 0.25 } = {}) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime + when;
    const car = ctx.createOscillator(); car.frequency.value = freq;
    const mod = ctx.createOscillator(); mod.frequency.value = freq * ratio;
    const mg = ctx.createGain(); mg.gain.setValueAtTime(freq * index, t); mg.gain.exponentialRampToValueAtTime(freq * 0.05, t + dur);
    mod.connect(mg).connect(car.frequency);
    const g = ctx.createGain(); this._env(g, t, attack, gain, dur);
    car.connect(g).connect(dest || this.sfx);
    if (reverb) { const r = ctx.createGain(); r.gain.value = reverb; g.connect(r).connect(this.revSend); }
    car.start(t); mod.start(t); car.stop(t + dur + 0.1); mod.stop(t + dur + 0.1);
  }

  // ---------------------------------------------------------------- SFX
  play(name, opts = {}) {
    if (!this.ctx || this.muted) return;
    const sp = this._spatial(opts.pos, opts.ref || 2.5, opts.max || 28);
    if (!sp) return;
    const dest = sp.node;
    const v = opts.vol ?? 1;
    const f = this.sfxLib[name];
    if (f) f.call(this, dest, v, opts);
  }

  get sfxLib() {
    return SFX;
  }

  // Continuous loops (e.g. roulette ball roll, rocket engine)
  loop(name, { pos, vol = 1, freq = 600, type = 'bandpass', q = 1.2, osc = null } = {}) {
    if (!this.ctx) return null;
    this.stopLoop(name);
    const ctx = this.ctx;
    const g = ctx.createGain(); g.gain.value = 0;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    src.connect(f).connect(g);
    let o = null;
    if (osc) { o = ctx.createOscillator(); o.type = osc.type || 'sawtooth'; o.frequency.value = osc.freq || 80; const og = ctx.createGain(); og.gain.value = osc.gain || 0.3; o.connect(og).connect(f); o.start(); }
    const pan = ctx.createStereoPanner();
    g.connect(pan).connect(this.sfx);
    src.start();
    g.gain.setTargetAtTime(this.muted ? 0 : vol, ctx.currentTime, 0.05);
    const h = { src, f, g, o, pan, vol, pos };
    this.loops.set(name, h);
    return h;
  }
  setLoop(name, { vol, freq, oscFreq } = {}) {
    const h = this.loops.get(name); if (!h || !this.ctx) return;
    const t = this.ctx.currentTime;
    if (vol !== undefined) { h.vol = vol; h.g.gain.setTargetAtTime(this.muted ? 0 : vol, t, 0.05); }
    if (freq !== undefined) h.f.frequency.setTargetAtTime(freq, t, 0.05);
    if (oscFreq !== undefined && h.o) h.o.frequency.setTargetAtTime(oscFreq, t, 0.05);
  }
  stopLoop(name) {
    const h = this.loops.get(name); if (!h) return;
    const t = this.ctx.currentTime;
    h.g.gain.setTargetAtTime(0, t, 0.05);
    h.src.stop(t + 0.3); if (h.o) h.o.stop(t + 0.3);
    this.loops.delete(name);
  }

  // ---------------------------------------------------------------- Ambience
  _startAmbience() {
    const ctx = this.ctx;
    // crowd murmur: several band-passed noise voices with slow random amplitude
    this.crowd = [];
    for (let i = 0; i < 4; i++) {
      const src = ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 350 + i * 180; f.Q.value = 2.2;
      const f2 = ctx.createBiquadFilter(); f2.type = 'peaking'; f2.frequency.value = 900 + i * 300; f2.gain.value = 6; f2.Q.value = 3;
      const g = ctx.createGain(); g.gain.value = 0.0;
      src.connect(f).connect(f2).connect(g).connect(this.amb);
      src.start(0, i * 0.37);
      this.crowd.push({ g, f, f2, phase: Math.random() * 10 });
    }
    this.ambTimer = 0;
    this.crowdLevel = 0.5;
  }
  setCrowd(level) { this.crowdLevel = level; }

  updateAmbience(dt) {
    if (!this.ctx || !this.crowd) return;
    const t = this.ctx.currentTime;
    for (const c of this.crowd) {
      c.phase += dt * (0.6 + Math.random() * 0.8);
      const a = (0.5 + 0.5 * Math.sin(c.phase * 1.7) * Math.sin(c.phase * 0.63)) * 0.09 * this.crowdLevel;
      c.g.gain.setTargetAtTime(a, t, 0.15);
      c.f2.frequency.setTargetAtTime(700 + Math.sin(c.phase * 3.1) * 400 + Math.random() * 300, t, 0.08);
    }
    this.ambTimer -= dt;
    if (this.ambTimer <= 0) {
      this.ambTimer = 0.4 + Math.random() * 1.8;
      // distant casino life: slot jingles, chip clacks, coin drops
      const r = Math.random();
      const dest = this.amb;
      if (r < 0.35) {
        const base = 60 + Math.floor(Math.random() * 3) * 5;
        [0, 4, 7, 12, 16].forEach((n, i) => this.tone(mtof(base + 12 + n), 0.12, { type: 'square', gain: 0.012, when: i * 0.07, dest, reverb: 0.5, filter: 2400 }));
      } else if (r < 0.6) {
        for (let i = 0; i < 3 + Math.random() * 4; i++) this.noise(0.03, { freq: 3500 + Math.random() * 2000, q: 8, gain: 0.02, when: i * 0.06 + Math.random() * 0.03, dest, reverb: 0.6 });
      } else if (r < 0.75) {
        for (let i = 0; i < 6; i++) this.tone(2400 + Math.random() * 1600, 0.07, { type: 'triangle', gain: 0.008, when: i * 0.05 + Math.random() * 0.04, dest, reverb: 0.6 });
      } else if (r < 0.82) {
        // distant cheer
        this.noise(1.2, { freq: 1100, q: 1.5, gain: 0.03, attack: 0.15, dest, reverb: 0.5 });
      }
    }
  }

  // ---------------------------------------------------------------- Music
  startMusic(style = 'lounge') {
    if (!this.ctx) return;
    this.stopMusic();
    const STY = {
      lounge: { bpm: 96, key: 53, prog: [[2, 'm7'], [7, '7'], [0, 'maj7'], [9, '7'], [2, 'm7'], [7, '7'], [4, 'm7'], [9, '7']] },
      western: { bpm: 112, key: 55, prog: [[0, 'maj'], [0, 'maj'], [5, 'maj'], [0, 'maj'], [7, '7'], [5, 'maj'], [0, 'maj'], [7, '7']] },
      tiki: { bpm: 100, key: 57, prog: [[0, 'maj7'], [5, 'maj7'], [2, 'm7'], [7, '7'], [0, 'maj7'], [9, 'm7'], [2, 'm7'], [7, '7']] },
      palace: { bpm: 84, key: 50, prog: [[0, 'm9'], [5, 'm7'], [10, '7'], [3, 'maj7'], [8, 'maj7'], [2, 'm7b5'], [7, '7'], [0, 'm9']] },
      neon: { bpm: 108, key: 52, prog: [[0, 'm7'], [8, 'maj7'], [3, 'maj7'], [10, '7'], [0, 'm7'], [8, 'maj7'], [5, 'm7'], [7, '7']] },
    }[style] || null;
    if (!STY) return;
    const Q = { maj: [0, 4, 7, 12], maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10], '7': [0, 4, 7, 10], m9: [0, 3, 7, 14], m7b5: [0, 3, 6, 10] };
    const m = (this.music = { sty: STY, Q, beat: 0, next: this.ctx.currentTime + 0.1, style });
    const spb = 60 / STY.bpm;
    m.timer = setInterval(() => {
      if (!this.ctx || this.music !== m) return;
      const ahead = this.ctx.currentTime + 0.25;
      while (m.next < ahead) {
        this._musicBeat(m, m.next - this.ctx.currentTime, spb);
        m.next += spb; m.beat++;
      }
    }, 60);
  }
  stopMusic() { if (this.music) { clearInterval(this.music.timer); this.music = null; } }

  _musicBeat(m, when, spb) {
    if (this.muted || when < 0) return;
    const { sty, Q } = m;
    const bar = Math.floor(m.beat / 4), b = m.beat % 4;
    const [deg, q] = sty.prog[bar % sty.prog.length];
    const root = sty.key + deg;
    const ivs = Q[q];
    const dest = this.mus;
    const swing = spb * 0.66;
    // Rhodes comping: on beat 0 and the "and" of 2
    if (b === 0 || (b === 2 && Math.random() < 0.6)) {
      const w = b === 2 ? when + swing : when;
      ivs.forEach((iv, i) => this.fm(mtof(root + 12 + iv + (i === 3 && iv < 12 ? 0 : 0)), spb * 1.6, { ratio: 1, index: 1.4, gain: 0.05, when: w + i * 0.008, dest, reverb: 0.4 }));
    }
    // walking bass
    const walk = [0, ivs[1], ivs[2], b === 3 ? 11 : ivs[1] + 2];
    const bn = root - 12 + (b === 3 ? (Math.random() < 0.5 ? -1 : 1) + 12 - 12 : walk[b]);
    this.tone(mtof(bn), spb * 0.85, { type: 'triangle', gain: 0.16, attack: 0.01, when, dest, reverb: 0.05, filter: 700 });
    // brushes + ride
    this.noise(0.12, { type: 'highpass', freq: 6500, gain: 0.03, when, dest, reverb: 0.15 });
    this.noise(0.06, { type: 'highpass', freq: 7500, gain: 0.018, when: when + swing, dest, reverb: 0.1 });
    if (b === 1 || b === 3) this.noise(0.18, { type: 'bandpass', freq: 2200, q: 0.7, gain: 0.03, attack: 0.02, when, dest, reverb: 0.2 });
    if (b === 0) this.tone(70, 0.18, { gain: 0.12, when, dest, slide: 45, reverb: 0 });
    // vibraphone noodling
    if (Math.random() < (sty.bpm > 100 ? 0.45 : 0.35)) {
      const scale = [0, 2, 3, 5, 7, 9, 10, 12, 14, 15];
      const n = root + 24 + (Math.random() < 0.6 ? ivs[Math.floor(Math.random() * 4)] : scale[Math.floor(Math.random() * scale.length)]);
      const w = when + (Math.random() < 0.5 ? 0 : swing);
      this.fm(mtof(n), 0.9, { ratio: 4, index: 0.8, gain: 0.035, when: w, dest, reverb: 0.5 });
    }
  }
}

// ----------------------------------------------------------------------------
// The SFX catalogue. `this` is the Audio instance, `d` the destination node.
// ----------------------------------------------------------------------------
const SFX = {
  click(d, v) { this.noise(0.02, { freq: 3000, q: 4, gain: 0.12 * v, dest: d }); this.tone(1800, 0.03, { type: 'square', gain: 0.02 * v, dest: d, reverb: 0 }); },
  hover(d, v) { this.tone(1400, 0.04, { type: 'sine', gain: 0.03 * v, dest: d, reverb: 0 }); },
  ui(d, v) { this.tone(880, 0.08, { type: 'triangle', gain: 0.08 * v, dest: d }); this.tone(1320, 0.1, { type: 'triangle', gain: 0.06 * v, when: 0.05, dest: d }); },
  deny(d, v) { this.tone(180, 0.18, { type: 'square', gain: 0.06 * v, dest: d, filter: 900 }); this.tone(140, 0.2, { type: 'square', gain: 0.06 * v, when: 0.1, dest: d, filter: 900 }); },
  chip(d, v, o) {
    const n = o.count || 1;
    for (let i = 0; i < Math.min(n, 6); i++) {
      const w = i * (0.035 + Math.random() * 0.02);
      this.noise(0.025, { freq: 3800 + Math.random() * 1500, q: 6, gain: 0.22 * v, when: w, dest: d, reverb: 0.08 });
      this.tone(2600 + Math.random() * 800, 0.04, { type: 'triangle', gain: 0.05 * v, when: w, dest: d, reverb: 0.05 });
    }
  },
  chipStack(d, v) { for (let i = 0; i < 9; i++) this.noise(0.02, { freq: 4200 + i * 120, q: 7, gain: 0.15 * v, when: i * 0.022, dest: d }); },
  card(d, v) { this.noise(0.09, { type: 'bandpass', freq: 2600, q: 0.9, gain: 0.22 * v, dest: d, sweep: 1200, reverb: 0.05 }); },
  cardFlip(d, v) { this.noise(0.05, { freq: 1800, q: 1.2, gain: 0.2 * v, dest: d }); this.noise(0.03, { freq: 4000, q: 2, gain: 0.1 * v, when: 0.04, dest: d }); },
  shuffle(d, v) { for (let i = 0; i < 24; i++) this.noise(0.03, { freq: 2500 + Math.random() * 1500, q: 2, gain: 0.08 * v, when: i * 0.025, dest: d }); },
  coin(d, v) { const f = 2600 + Math.random() * 900; this.tone(f, 0.25, { type: 'sine', gain: 0.07 * v, dest: d, reverb: 0.2 }); this.tone(f * 2.76, 0.12, { type: 'sine', gain: 0.03 * v, dest: d }); this.noise(0.02, { freq: 6000, q: 3, gain: 0.08 * v, dest: d }); },
  coins(d, v, o) { const n = o.count || 8; for (let i = 0; i < n; i++) setTimeout(() => SFX.coin.call(this, d, v * 0.8, {}), i * (40 + Math.random() * 50)); },
  cash(d, v) {
    this.noise(0.05, { freq: 3000, q: 2, gain: 0.15 * v, dest: d });
    this.fm(1760, 0.6, { ratio: 3.01, index: 2, gain: 0.12 * v, when: 0.05, dest: d });
    this.fm(2637, 0.6, { ratio: 3.01, index: 2, gain: 0.08 * v, when: 0.12, dest: d });
  },
  lever(d, v) { this.noise(0.25, { type: 'lowpass', freq: 900, gain: 0.25 * v, dest: d, sweep: 300 }); this.tone(90, 0.12, { type: 'square', gain: 0.08 * v, when: 0.22, dest: d, filter: 500 }); this.noise(0.05, { freq: 1500, q: 3, gain: 0.25 * v, when: 0.25, dest: d }); },
  reelStart(d, v) { this.tone(220, 0.3, { type: 'sawtooth', gain: 0.04 * v, dest: d, slide: 440, filter: 1400 }); },
  reelTick(d, v) { this.noise(0.015, { freq: 2200, q: 5, gain: 0.05 * v, dest: d, reverb: 0 }); },
  reelStop(d, v, o) { this.noise(0.04, { type: 'lowpass', freq: 1200, gain: 0.35 * v, dest: d }); this.tone(130 + (o.i || 0) * 20, 0.08, { type: 'square', gain: 0.05 * v, dest: d, filter: 800 }); },
  anticipation(d, v) { for (let i = 0; i < 14; i++) this.tone(400 + i * 60, 0.08, { type: 'square', gain: 0.025 * v, when: i * 0.09, dest: d, filter: 2500 }); },
  winSmall(d, v) { [0, 4, 7, 12].forEach((n, i) => this.tone(mtof(72 + n), 0.15, { type: 'square', gain: 0.05 * v, when: i * 0.07, dest: d, filter: 3000 })); },
  winBig(d, v) {
    const seq = [0, 4, 7, 12, 7, 12, 16, 19, 24];
    seq.forEach((n, i) => { this.tone(mtof(67 + n), 0.18, { type: 'square', gain: 0.06 * v, when: i * 0.08, dest: d, filter: 3500 }); this.fm(mtof(79 + n), 0.3, { gain: 0.04 * v, when: i * 0.08, dest: d }); });
  },
  jackpot(d, v) {
    for (let k = 0; k < 4; k++) [0, 4, 7, 12, 16].forEach((n, i) => this.fm(mtof(72 + n + k * 2), 0.45, { ratio: 3.5, index: 3, gain: 0.07 * v, when: k * 0.5 + i * 0.07, dest: d }));
    for (let i = 0; i < 40; i++) this.tone(2000 + Math.random() * 3000, 0.1, { type: 'sine', gain: 0.025 * v, when: Math.random() * 2.2, dest: d });
  },
  bell(d, v) { this.fm(1318, 1.2, { ratio: 3.5, index: 5, gain: 0.12 * v, dest: d }); },
  lose(d, v) { this.tone(392, 0.25, { type: 'triangle', gain: 0.08 * v, dest: d }); this.tone(330, 0.25, { type: 'triangle', gain: 0.08 * v, when: 0.2, dest: d }); this.tone(262, 0.5, { type: 'triangle', gain: 0.09 * v, when: 0.4, dest: d, slide: 240 }); },
  bust(d, v) { this.tone(110, 0.5, { type: 'sawtooth', gain: 0.07 * v, dest: d, slide: 60, filter: 600 }); },
  ding(d, v, o) { this.fm(o.f || 1568, 0.5, { ratio: 2, index: 1.5, gain: 0.12 * v, dest: d }); },
  pop(d, v) { this.tone(600, 0.08, { type: 'sine', gain: 0.12 * v, dest: d, slide: 1200 }); },
  whoosh(d, v) { this.noise(0.3, { type: 'bandpass', freq: 400, q: 0.8, gain: 0.15 * v, dest: d, sweep: 2500 }); },
  dice(d, v) { for (let i = 0; i < 4; i++) this.noise(0.03, { freq: 1500 + Math.random() * 1500, q: 3, gain: 0.25 * v, when: i * (0.05 + Math.random() * 0.05), dest: d }); },
  diceHit(d, v) { this.noise(0.03, { freq: 1200 + Math.random() * 1200, q: 2.5, gain: 0.3 * v, dest: d }); this.tone(500 + Math.random() * 300, 0.04, { type: 'triangle', gain: 0.05 * v, dest: d }); },
  clack(d, v) { this.noise(0.02, { freq: 2800 + Math.random() * 1000, q: 6, gain: 0.2 * v, dest: d, reverb: 0.02 }); },
  tick(d, v) { this.noise(0.012, { freq: 3200, q: 4, gain: 0.25 * v, dest: d, reverb: 0 }); this.tone(1100, 0.02, { type: 'square', gain: 0.03 * v, dest: d, reverb: 0 }); },
  ping(d, v, o) { this.fm(o.f || 1200, 0.25, { ratio: 2.7, index: 1.2, gain: 0.07 * v, dest: d, reverb: 0.15 }); },
  scratch(d, v) { this.noise(0.06, { type: 'bandpass', freq: 3500 + Math.random() * 2000, q: 1.5, gain: 0.08 * v, dest: d, reverb: 0 }); },
  step(d, v) { this.noise(0.06, { type: 'lowpass', freq: 380 + Math.random() * 120, gain: 0.18 * v, dest: d, reverb: 0.02 }); },
  stepWood(d, v) { this.noise(0.05, { type: 'bandpass', freq: 650 + Math.random() * 200, q: 1.5, gain: 0.2 * v, dest: d }); this.tone(120, 0.05, { gain: 0.06 * v, dest: d }); },
  cheer(d, v) {
    this.noise(1.6, { type: 'bandpass', freq: 1000, q: 0.8, gain: 0.12 * v, attack: 0.08, dest: d, reverb: 0.4 });
    this.noise(1.2, { type: 'bandpass', freq: 2200, q: 1.5, gain: 0.07 * v, attack: 0.05, dest: d, reverb: 0.4 });
    for (let i = 0; i < 16; i++) this.noise(0.03, { type: 'highpass', freq: 2000, gain: 0.08 * v, when: 0.1 + Math.random() * 1.3, dest: d });
  },
  aww(d, v) { this.noise(1.2, { type: 'bandpass', freq: 700, q: 2, gain: 0.08 * v, attack: 0.1, dest: d, sweep: 380, reverb: 0.4 }); },
  gulp(d, v) { for (let i = 0; i < 3; i++) this.tone(300, 0.08, { type: 'sine', gain: 0.15 * v, when: i * 0.22, dest: d, slide: 150 }); },
  door(d, v) { this.noise(0.6, { type: 'lowpass', freq: 500, gain: 0.25 * v, dest: d, sweep: 200 }); this.tone(60, 0.3, { gain: 0.1 * v, when: 0.5, dest: d }); },
  rocket(d, v) { this.noise(0.8, { type: 'lowpass', freq: 300, gain: 0.3 * v, dest: d, sweep: 1200 }); },
  boom(d, v) { this.noise(1.2, { type: 'lowpass', freq: 800, gain: 0.5 * v, dest: d, sweep: 60, reverb: 0.4 }); this.tone(80, 0.8, { gain: 0.3 * v, dest: d, slide: 30 }); },
  bugle(d, v) { [0, 5, 9, 12, 9, 12, 12].forEach((n, i) => this.tone(mtof(67 + n), i === 6 ? 0.6 : 0.14, { type: 'sawtooth', gain: 0.05 * v, when: i * 0.16, dest: d, filter: 2200, reverb: 0.3 })); },
  gallop(d, v) { for (let i = 0; i < 3; i++) this.noise(0.04, { type: 'lowpass', freq: 500, gain: 0.15 * v, when: i * 0.09, dest: d }); },
  buzzer(d, v) { this.tone(110, 0.6, { type: 'sawtooth', gain: 0.1 * v, dest: d, filter: 1200 }); this.tone(116, 0.6, { type: 'sawtooth', gain: 0.1 * v, dest: d, filter: 1200 }); },
  powerup(d, v) { for (let i = 0; i < 8; i++) this.tone(mtof(60 + i * 3), 0.1, { type: 'square', gain: 0.04 * v, when: i * 0.045, dest: d, filter: 3000 }); },
  register(d, v) { this.noise(0.08, { freq: 2000, q: 2, gain: 0.2 * v, dest: d }); this.fm(2093, 0.9, { ratio: 3.5, index: 4, gain: 0.12 * v, when: 0.1, dest: d }); },
  thud(d, v) { this.tone(90, 0.15, { gain: 0.25 * v, dest: d, slide: 50 }); this.noise(0.05, { type: 'lowpass', freq: 400, gain: 0.2 * v, dest: d }); },
  glass(d, v) { this.fm(3200 + Math.random() * 600, 0.6, { ratio: 2.4, index: 1, gain: 0.05 * v, dest: d }); },
  pour(d, v) { this.noise(0.9, { type: 'bandpass', freq: 1600, q: 3, gain: 0.08 * v, attack: 0.05, dest: d, sweep: 700 }); },
  explode(d, v) { SFX.boom.call(this, d, v); },
  heartbeat(d, v) { this.tone(55, 0.12, { gain: 0.3 * v, dest: d, reverb: 0 }); this.tone(50, 0.14, { gain: 0.25 * v, when: 0.18, dest: d, reverb: 0 }); },
  clock(d, v) { this.fm(880, 1.4, { ratio: 2.76, index: 3, gain: 0.12 * v, dest: d }); this.fm(660, 1.6, { ratio: 2.76, index: 3, gain: 0.1 * v, when: 0.5, dest: d }); },
  mineBoom(d, v) { SFX.boom.call(this, d, v * 0.7); },
  gem(d, v, o) { const p = o.p || 0; this.fm(mtof(76 + p), 0.4, { ratio: 3, index: 1.5, gain: 0.1 * v, dest: d }); this.tone(mtof(88 + p), 0.2, { type: 'triangle', gain: 0.04 * v, when: 0.04, dest: d }); },
};

export const audio = new Audio();
