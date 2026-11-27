// Page-side shot scripts for the promo videos (used with tools/promo/vclock.js + capture.cjs).
(() => {
  const G = () => window.__gamble, D = () => window.__gamble.director;
  const V = (x, y, z) => new (G().camera.position.constructor)(x, y, z);
  const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
  const lerp3 = (a, b, k) => V(a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k);
  const bez3 = (a, b, c, k) => { const u = 1 - k; return V(u * u * a[0] + 2 * u * k * b[0] + k * k * c[0], u * u * a[1] + 2 * u * k * b[1] + k * k * c[1], u * u * a[2] + 2 * u * k * b[2] + k * k * c[2]); };
  let S = null, SM = null, Mod = null;

  function cine(on) {
    const p = D().player;
    p.mode = on ? 'frozen' : 'walk';
    p.vm.visible = !on;
  }
  function fastShadows() {
    const sun = D().world && D().world.sun;
    if (sun && sun.shadow.mapSize.x > 2048) { sun.shadow.mapSize.set(2048, 2048); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } }
  }
  function cam(pos, look) { const c = G().camera; c.position.copy(pos); c.lookAt(look); }
  function forceRand(vals) {
    const q = vals.slice();
    const orig = window.__origGRV || (window.__origGRV = crypto.getRandomValues.bind(crypto));
    crypto.getRandomValues = (arr) => {
      if (q.length) { arr[0] = Math.min(4294967295, Math.floor(q.shift() * 4294967296)); if (!q.length) crypto.getRandomValues = orig; return arr; }
      return orig(arr);
    };
  }
  function clearFx() {
    document.querySelectorAll('.intro, .banner, .coin-fx, .toast, .floater').forEach((e) => e.remove());
    const d = D(); if (d) d.flashA = 0;
  }
  function leaveAny() { if (D().station) D().leaveStation(true); }
  function sitAt(st) {
    leaveAny();
    const seat = st.npcSeats && st.npcSeats.find((s) => s.kind !== 'table');
    if (seat && seat.taken && seat.taken.leaveSeat) seat.taken.leaveSeat();
    const p = st.interactWorld();
    const yaw = Math.atan2(-(st.worldPos().x - p.x), -(st.worldPos().z - p.z));
    D().player.spawn(p.x, p.z, yaw);
    D().enterStation(st);
  }

  const shots = {
    entrance: {
      day: 3, dur: 2.7, prep: 0,
      begin() {
        cine(true);
        document.querySelectorAll('.intro').forEach((e) => e.remove());
        D().intro();
      },
      // curve past the fountain and in through the main doorway (door: x -3..3 at z 8)
      step(t) { const k = ease(Math.max(0, t) / 2.7); cam(bez3([3.3, 1.72, 16.6], [3.0, 1.74, 11.4], [0.9, 1.76, 8.7], k), lerp3([0.6, 2.0, 2], [0, 1.95, -6], k)); },
    },
    statue: {
      day: 3, dur: 1.6, prep: 0.35,
      begin() {
        cine(true);
        clearFx();
        D().crowd.reactAt(V(0, 0, -2.2), 'win', 14);
      },
      step(t) {
        const a = (-28 + Math.max(0, t) / 1.6 * 30) * Math.PI / 180;
        cam(V(Math.sin(a) * 4.6, 2.05, -2.2 + Math.cos(a) * 4.6), V(0, 2.35, -2.2));
      },
    },
    slot777: {
      day: 3, dur: 5.6, prep: 0.95,
      begin() {
        const list = D().stations.filter((s) => s.type === 'slots' && !s.video);
        const st = list[Math.floor(list.length / 2)];
        sitAt(st);
        st.betCtl.set(st.limits[1]);
        this.st = st; this.spun = false;
      },
      step(t) {
        if (t >= 0.3 && !this.spun) {
          this.spun = true;
          const stops = SM.CLASSIC.reels.map((r) => (r.indexOf(SM.SYM.SEVEN) + 0.5) / r.length);
          forceRand(stops);
          this.st.spin();
        }
      },
    },
    roulette: {
      day: 3, dur: 4.0, prep: 0.95, post: 4.5,
      begin() {
        const st = D().stations.find((s) => s.type === 'roulette' && !s.def.high);
        sitAt(st);
        st.chip = Math.max(st.limits[0], 25);
        st.placeBet(st.namedBet('red'));
        const c32 = st.betAt(-0.38 + 0.115 * 10.5, -0.36 + 0.12 * 1.5); // straight-up on 32 (middle row)
        if (c32) { st.placeBet(c32); st.placeBet(c32); }
        st.placeBet(st.namedBet('doz2'));
        this.st = st; this.spun = false;
      },
      step(t) {
        if (t >= 0.25 && !this.spun) {
          this.spun = true;
          forceRand([1.5 / 37, 0.5, 0.5, 0.31, 0.2, 0.42]); // result 32 (pocket 1)
          this.st.spin();
          if (this.st.ballAnim) { this.st.ballAnim.T = 3.0; this.st.ballAnim.turns = 4; }
        }
      },
    },
    derby: {
      day: 5, dur: 6.0, prep: 0.95,
      begin() {
        const st = D().stations.find((s) => s.type === 'derby');
        sitAt(st);
        st.chip = 100;
        const w = st.odds.indexOf(Math.max(...st.odds));
        for (let i = 0; i < 3; i++) st.addBet(w);
        this.st = st; this.w = w; this.raced = false;
      },
      step(t) {
        if (t >= 0.05 && !this.raced) {
          this.raced = true;
          const st = this.st;
          st.race();
          st.winner = this.w;
          let r = 1;
          st.horses.forEach((h) => { if (h.idx === this.w) { h.finishRank = 0; h.finishTime = 3.3; } else { h.finishRank = r; h.finishTime = 3.5 + r * 0.15; r++; } });
        }
      },
    },
    plinko: {
      day: 5, dur: 5.0, prep: 0.95,
      begin() {
        const st = D().stations.find((s) => s.type === 'plinko');
        sitAt(st);
        st.risk = 'medium'; st.drawBuckets();
        st.betCtl.set(20);
        this.st = st; this.dropped = 0;
      },
      step(t) {
        const times = [0.15, 0.45, 0.75, 1.05, 1.35, 1.65];
        while (this.dropped < times.length && t >= times[this.dropped]) {
          this.st.drop();
          const b = this.st.balls[this.st.balls.length - 1];
          if (this.dropped === 2 && b) { b.path = Array(12).fill(true); b.rights = 12; }
          if (this.dropped === 4 && b) { b.path = Array(12).fill(false); b.rights = 0; }
          this.dropped++;
        }
      },
    },
    crash: {
      day: 5, dur: 6.2, prep: 0.95,
      begin() {
        const st = D().stations.find((s) => s.type === 'crash');
        sitAt(st);
        st.myBet = 0; st.cashed = 0;
        st.newRound(); st.countdown = this.prep + 1.0; st.crashAt = 6.5;
        st.betCtl.set(500);
        this.st = st; this.bet = false; this.out = false;
      },
      step(t) {
        const st = this.st;
        if (t >= 0.1 && !this.bet) { this.bet = true; st.mainAction(); }
        if (st.phase === 'fly') st.t += (1 / 30) * 3.2;
        if (!this.out && st.phase === 'fly' && st.mult() >= 5) { this.out = true; st.mainAction(); }
      },
    },
  };

  let current = null;
  window.__shots = {
    loaded: true,
    async init(portrait) {
      S = await import('/src/game/state.js');
      SM = await import('/src/games/slotmath.js');
      Mod = S;
      G().renderer.autoQuality = false;
      G().renderer.setQuality('high');
      G().ui.hint = () => {};
      G().ui.hideHint();
      if (portrait) { G().camera.fov = 92; G().camera.updateProjectionMatrix(); }
      fastShadows();
      return true;
    },
    // skip WebGL work on frames that are not captured (prep, post, day loads)
    render(on) { const r = G().renderer; if (!r._origRender) r._origRender = r.render; r.render = on ? r._origRender : () => {}; },
    info(name) { const s = shots[name]; return { day: s.day, dur: s.dur, prep: s.prep, post: s.post || 0 }; },
    load(day) {
      this.loaded = false;
      leaveAny();
      const st = S.state;
      st.day = day; st.startDay(true); st.money = Math.round(st.quota * 0.6);
      D().loadDay((p, m) => G().setLoading(p, m)).then(() => { G().ui.hint = () => {}; G().ui.hideHint(); fastShadows(); this.loaded = true; });
    },
    begin(name) { current = shots[name]; if (name !== 'entrance') clearFx(); current.begin(); },
    step(t) { if (current && t >= 0) current.step(t); else if (current && current.step && t < 0 && current.prepStep) current.prepStep(); },
  };
  void Mod;
})();
