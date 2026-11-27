// Virtual clock for deterministic video capture (injected before the game loads).
// Time only moves when the capture driver calls window.__vclock.advance(ms):
// timers fire in order, rAF callbacks run once, and CSS/WAAPI animations are
// scrubbed to the same virtual time, so every captured frame is exactly 1/fps apart.
(() => {
  const realNow = performance.now.bind(performance);
  let vnow = realNow();
  const dateOffset = Date.now() - vnow;
  let nextId = 1;
  const timers = new Map();
  let raf = [];
  performance.now = () => vnow;
  Date.now = () => Math.floor(vnow + dateOffset);
  window.setTimeout = (cb, ms = 0, ...args) => { const id = nextId++; timers.set(id, { t: vnow + Math.max(0, +ms || 0), cb, args, seq: id }); return id; };
  window.clearTimeout = (id) => { timers.delete(id); };
  window.setInterval = (cb, ms = 0, ...args) => { const id = nextId++; const iv = Math.max(1, +ms || 0); timers.set(id, { t: vnow + iv, cb, args, iv, seq: id }); return id; };
  window.clearInterval = (id) => { timers.delete(id); };
  window.requestAnimationFrame = (cb) => { const id = nextId++; raf.push({ id, cb }); return id; };
  window.cancelAnimationFrame = (id) => { raf = raf.filter((r) => r.id !== id); };
  const started = new WeakMap();
  const run = (fn, ...a) => { try { fn(...a); } catch (e) { console.error(e); } };
  window.__vclock = {
    now: () => vnow,
    advance(ms) {
      const target = vnow + ms;
      for (let guard = 0; guard < 5000; guard++) {
        let best = null;
        for (const [id, tm] of timers) if (tm.t <= target && (!best || tm.t < best[1].t || (tm.t === best[1].t && tm.seq < best[1].seq))) best = [id, tm];
        if (!best) break;
        const [id, tm] = best;
        vnow = Math.max(vnow, tm.t);
        if (tm.iv) tm.t += tm.iv; else timers.delete(id);
        if (typeof tm.cb === 'function') run(tm.cb, ...tm.args);
      }
      vnow = target;
      const q = raf; raf = [];
      for (const r of q) run(r.cb, vnow);
      for (const a of document.getAnimations()) {
        if (!started.has(a)) started.set(a, vnow - (a.currentTime || 0));
        if (a.playState !== 'paused') a.pause();
        const t = vnow - started.get(a);
        const end = a.effect && a.effect.getComputedTiming ? a.effect.getComputedTiming().endTime : Infinity;
        if (Number.isFinite(end) && t >= end) { a.currentTime = end; a.finish(); } else a.currentTime = t;
      }
    },
  };
})();
