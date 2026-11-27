import { fmtMoney, clamp } from '../engine/util.js';
import { audio } from '../engine/audio.js';

// ============================================================================
//  DOM UI: HUD, prompts, toasts, banners, station panels, overlays.
// ============================================================================

const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
export { h };

const CHIP_DENOMS = [1, 5, 25, 100, 500, 1000, 5000];
const chipLabel = (v) => (v >= 1000 ? v / 1000 + 'K' : String(v));

export class UI {
  constructor(root) {
    this.root = root;
    this.hotkeys = new Map();
    this.displayMoney = 0; this.targetMoney = 0;
    this.build();
    this.updateLayout();
    window.addEventListener('resize', () => this.updateLayout());
    window.addEventListener('orientationchange', () => setTimeout(() => this.updateLayout(), 50));
    window.addEventListener('keydown', (e) => {
      if (this.overlayOpen && !this.overlayAllowsHotkeys) return;
      const k = this.hotkeys.get(e.code);
      if (k && !k.disabled && document.body.contains(k)) { e.preventDefault(); k.click(); }
    });
  }

  build() {
    const r = this.root;
    this.hud = h('div', 'hud');
    const tl = h('div', 'hud-tl');
    this.moneyEl = h('div', 'money', '<div class="coin">$</div><span>$0</span>');
    this.moneyText = this.moneyEl.querySelector('span');
    this.streakEl = h('div', 'streak');
    this.moneyEl.append(this.streakEl);
    this.quotaEl = h('div', 'quota', '<div class="lbl"><span>Big Tony wants</span><b>$0</b></div><div class="track"><div class="fill"></div></div>');
    this.dayEl = h('div', 'day-tag');
    this.modEl = h('div', 'mod-tag');
    tl.append(this.moneyEl, this.quotaEl, this.dayEl, this.modEl);
    const tr = h('div', 'hud-tr');
    const trRow = h('div', 'tr-row');
    this.clockEl = h('div', 'clock', '8:00 PM');
    this.pauseBtn = h('button', 'pausebtn', '<i></i><i></i>');
    this.pauseBtn.setAttribute('aria-label', 'Pause');
    this.pauseBtn.addEventListener('click', (e) => { e.stopPropagation(); audio.play('click'); this.onPause && this.onPause(); });
    trRow.append(this.clockEl, this.pauseBtn);
    this.clockSub = h('div', 'clock-sub', 'closing 4:00 AM');
    this.buffEl = h('div', 'buffs');
    this.perkEl = h('div', 'perkbar');
    tr.append(trRow, this.clockSub, this.buffEl, this.perkEl);
    this.hudTL = tl; this.hudTR = tr;
    this.cross = h('div', 'crosshair');
    this.promptEl = h('div', 'prompt');
    this.toastsEl = h('div', 'toasts');
    this.floatersEl = h('div', 'floaters');
    this.labelsEl = h('div', 'floaters');
    this.hud.append(tl, tr, this.cross, this.promptEl);
    r.append(this.labelsEl, this.hud, this.floatersEl, this.toastsEl);
  }

  /**
   * Layout mode, set as a class on <html>:
   *  ui-wide  - desktop / tablet: game panel docked at the bottom
   *  ui-side  - phone in landscape (short screen): game panel docked on the right
   *  ui-sheet - phone in portrait: game panel is a bottom sheet
   * plus ui-compact for small screens (smaller HUD, chips and buttons).
   */
  updateLayout() {
    const w = window.innerWidth, h = window.innerHeight;
    const mode = w > h && h < 560 ? 'side' : w <= h && w < 700 ? 'sheet' : 'wide';
    const compact = mode !== 'wide' || Math.min(w, h) < 600;
    const de = document.documentElement;
    if (mode !== this.mode) { de.classList.remove('ui-wide', 'ui-side', 'ui-sheet'); de.classList.add('ui-' + mode); this.mode = mode; }
    de.classList.toggle('ui-compact', compact);
    this.compact = compact;
  }
  setTouch(v) { document.documentElement.classList.toggle('is-touch', !!v); this.isTouch = !!v; }
  /** Bottom edge (px) of the top HUD row, so the camera framing can keep the game below it. */
  hudBottom() {
    if (!this.hud || this.hud.style.display === 'none') return 0;
    const a = this.moneyEl.getBoundingClientRect(), b = this.clockEl.getBoundingClientRect();
    return Math.max(a.bottom, b.bottom);
  }
  /** Screen rectangle not covered by the game panel (CSS px). */
  freeRect() {
    const W = window.innerWidth, H = window.innerHeight;
    const r = { x: 0, y: 0, w: W, h: H, panel: false };
    // HUD corner boxes, cached for world labels (speech bubbles keep clear of them)
    this.hudRects = this.hud.style.display === 'none' ? [] : [this.hudTL.getBoundingClientRect(), this.hudTR.getBoundingClientRect()];
    const p = this.panel && this.panel.el;
    if (!p || !p.isConnected) return r;
    const b = p.getBoundingClientRect();
    r.panel = true;
    if (b.left > W * 0.3 && b.height > H * 0.5) r.w = Math.max(W * 0.3, b.left - 4); // docked right
    else r.h = Math.max(H * 0.28, Math.min(H, b.top) - 4); // docked at the bottom
    if (this.mode === 'sheet') { const t = Math.min(this.hudBottom() + 4, r.h * 0.3); r.y = t; r.h -= t; }
    return r;
  }
  /** Publish the free area as CSS variables (banners and toasts centre on it). */
  setFreeVars(x, y, w, h) {
    this.free = { x, y, w, h };
    const st = this.root.style;
    st.setProperty('--free-x', x.toFixed(0) + 'px'); st.setProperty('--free-y', y.toFixed(0) + 'px');
    st.setProperty('--free-w', w.toFixed(0) + 'px'); st.setProperty('--free-h', h.toFixed(0) + 'px');
  }
  /** Bet grid with a desktop column count and a compact (phone) column count. */
  grid(cols, compactCols = cols, extra = '') {
    const g = h('div', 'betgrid' + (extra ? ' ' + extra : ''));
    g.style.setProperty('--cols', cols);
    g.style.setProperty('--ccols', compactCols);
    return g;
  }

  hudVisible(v) { this.hud.style.display = v ? '' : 'none'; }
  crosshairVisible(v) { this.cross.style.display = v ? '' : 'none'; }

  // ------------------------------------------------------------ HUD values
  setMoney(v, delta = 0) {
    this.targetMoney = v;
    if (delta) {
      this.moneyEl.classList.remove('bump', 'loss');
      void this.moneyEl.offsetWidth;
      this.moneyEl.classList.add('bump');
      if (delta < 0) this.moneyEl.classList.add('loss');
      clearTimeout(this._mt); this._mt = setTimeout(() => this.moneyEl.classList.remove('bump', 'loss'), 350);
      const rect = this.moneyEl.getBoundingClientRect();
      this.floater((delta > 0 ? '+' : '') + fmtMoney(delta), rect.left + rect.width * 0.6, rect.bottom + 18, delta < 0);
    }
  }
  tick(dt) {
    const d = this.targetMoney - this.displayMoney;
    if (Math.abs(d) < 0.5) this.displayMoney = this.targetMoney;
    else this.displayMoney += d * Math.min(1, dt * 7) + Math.sign(d) * Math.min(Math.abs(d), dt * 20);
    const txt = fmtMoney(Math.round(this.displayMoney));
    if (txt !== this._lastMoneyTxt) { this.moneyText.textContent = txt; this._lastMoneyTxt = txt; }
  }
  setStreak(n) {
    if (n >= 3) { this.streakEl.innerHTML = `🔥×${n}<small>+${Math.min(10, (n - 2) * 2)}%</small>`; this.streakEl.classList.add('on'); this.streakEl.classList.remove('pop'); void this.streakEl.offsetWidth; this.streakEl.classList.add('pop'); }
    else this.streakEl.classList.remove('on');
  }
  setQuota(money, quota) {
    this.quotaEl.querySelector('b').textContent = fmtMoney(quota);
    const p = clamp(money / quota, 0, 1);
    this.quotaEl.querySelector('.fill').style.width = (p * 100).toFixed(1) + '%';
    const met = money >= quota;
    this.quotaEl.classList.toggle('met', met);
    this.quotaEl.querySelector('.lbl span').textContent = met ? '✔ Quota met — head to the EXIT' : 'Big Tony wants';
  }
  setDay(day, name, mod) {
    this.dayEl.innerHTML = `NIGHT <b>${day}</b> · ${name}`;
    this.modEl.textContent = mod ? `★ ${mod.name}: ${mod.desc}` : '';
  }
  setClock(str, left) {
    this.clockEl.textContent = str;
    this.clockEl.classList.toggle('urgent', left < 30);
    this.clockSub.textContent = left < 60 ? `CLOSING IN ${Math.ceil(left)} MIN` : 'closing 4:00 AM';
  }
  setBuffs(buffs) {
    this.buffEl.innerHTML = '';
    for (const b of buffs) this.buffEl.append(h('div', 'buff', `🍸 ${b.name} <i>${Math.ceil(b.left)}s</i>`));
  }
  setPerks(perks, defs) {
    this.perkEl.innerHTML = '';
    for (const d of defs) if (perks[d.id]) this.perkEl.append(h('span', '', `${d.icon}${perks[d.id] > 1 ? `<sup>${perks[d.id]}</sup>` : ''}`));
    this.perkEl.title = 'Your lucky charms';
  }

  // ------------------------------------------------------------ prompts & feedback
  prompt(text, sub = '', key = 'E') {
    const html = `<kbd>${key}</kbd>${text}${sub ? `<small>${sub}</small>` : ''}`;
    if (this._prompt !== html) { this.promptEl.innerHTML = html; this._prompt = html; }
    this.promptEl.classList.add('show');
    this.cross.classList.add('active');
  }
  hidePrompt() { this.promptEl.classList.remove('show'); this._prompt = null; this.cross.classList.remove('active'); }

  toast(msg, kind = '', dur = 2600) {
    const t = h('div', 'toast ' + kind, msg);
    this.toastsEl.append(t);
    while (this.toastsEl.children.length > 4) this.toastsEl.firstChild.remove();
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 400); }, dur);
  }
  floater(text, x, y, neg = false) {
    const f = h('div', 'floater' + (neg ? ' neg' : ''), text);
    f.style.left = x + 'px'; f.style.top = y + 'px';
    this.floatersEl.append(f);
    setTimeout(() => f.remove(), 1700);
  }
  banner(big, small = '', kind = '', dur = 2200) {
    if (this._banner) this._banner.remove();
    const b = h('div', 'banner ' + kind, `<div class="big">${big}</div>${small ? `<div class="small">${small}</div>` : ''}`);
    this.root.append(b);
    this._banner = b;
    setTimeout(() => { b.classList.add('out'); setTimeout(() => b.remove(), 500); }, dur);
  }
  intro(day, name, quota, tagline, mod) {
    const el = h('div', 'intro', `<div class="k">Night ${day}</div><div class="n">${name}</div><div class="q">${tagline}</div><div class="q">Big Tony wants <b>${fmtMoney(quota)}</b> before 4:00 AM.</div>${mod ? `<div class="q" style="color:#9ad8ff">★ ${mod.name} — ${mod.desc}</div>` : ''}`);
    this.root.append(el);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 1000); }, 5200);
  }
  hint(html) {
    if (!this.hintEl) { this.hintEl = h('div', 'hint'); this.root.append(this.hintEl); }
    this.hintEl.innerHTML = html; this.hintEl.style.display = '';
  }
  hideHint() { if (this.hintEl) this.hintEl.style.display = 'none'; }

  // ------------------------------------------------------------ world-anchored labels
  worldLabel(text, cls = 'wlabel') { const e = h('div', cls, text); this.labelsEl.append(e); return e; }
  placeLabel(el, sx, sy, visible) { if (!visible) { el.style.display = 'none'; return; } el.style.display = ''; el.style.left = sx + 'px'; el.style.top = sy + 'px'; }

  // ------------------------------------------------------------ station panel
  openPanel({ title, limits = '', onLeave }) {
    this.closePanel();
    const p = h('div', 'station-panel');
    const head = h('div', 'ph');
    const t = h('div', 'ph-title', `<h3>${title}</h3><div class="lim">${limits}</div>`);
    const msg = h('div', 'msg');
    const leave = this.button('Leave', 'dark small ph-leave', () => onLeave && onLeave(), 'Escape', 'Esc');
    head.append(t, msg, leave);
    const body = h('div', 'pbody');
    p.append(head, body);
    this.root.append(p);
    document.documentElement.classList.add('panel-open');
    this.panel = { el: p, body, msgEl: msg, setTitle: (s) => { t.querySelector('h3').textContent = s; }, setLimits: (s) => { t.querySelector('.lim').textContent = s; } };
    this.panel.msg = (text, cls = '') => { msg.className = 'msg ' + cls; msg.innerHTML = text; };
    return this.panel;
  }
  closePanel() {
    if (this.panel) { this.panel.el.remove(); this.panel = null; }
    document.documentElement.classList.remove('panel-open');
    for (const [k, b] of [...this.hotkeys]) if (!document.body.contains(b) || b.dataset.panel) this.hotkeys.delete(k);
  }

  button(label, cls = '', onClick, hotkey, keyLabel) {
    const b = h('button', 'btn ' + cls, label + (keyLabel ? `<kbd>${keyLabel}</kbd>` : ''));
    b.addEventListener('click', (e) => { e.stopPropagation(); if (b.disabled) return; audio.play('click'); onClick && onClick(e); });
    b.addEventListener('mouseenter', () => !b.disabled && audio.play('hover', { vol: 0.5 }));
    if (hotkey) { this.hotkeys.set(hotkey, b); b.dataset.panel = '1'; }
    return b;
  }

  /** Chip-based bet selector. */
  betControl({ min = 1, max = 1000, value, onChange, getMoney, label = 'Bet' }) {
    const wrap = h('div', 'row betctl');
    const box = h('div', 'betbox', `<small>${label}</small><b></b>`);
    const bEl = box.querySelector('b');
    let bet = clamp(value ?? min, min, max);
    const set = (v, silent) => {
      const money = getMoney ? getMoney() : Infinity;
      bet = clamp(Math.round(v), min, Math.max(min, Math.min(max, money)));
      bEl.textContent = fmtMoney(bet);
      if (!silent && onChange) onChange(bet);
      chips.forEach(([c, d]) => (c.disabled = d > max));
    };
    const chips = [];
    const denoms = CHIP_DENOMS.filter((d) => d <= max && d >= Math.min(min, 1000) / 5);
    for (const d of denoms.slice(-6)) {
      const c = h('button', 'chip c' + d, `<span>${chipLabel(d)}</span>`);
      c.title = `Add ${fmtMoney(d)}`;
      c.addEventListener('click', (e) => { e.stopPropagation(); audio.play('chip'); set(bet === min && this._freshBet ? d : bet + d); this._freshBet = false; });
      c.addEventListener('contextmenu', (e) => { e.preventDefault(); audio.play('chip'); set(bet - d); });
      chips.push([c, d]);
      wrap.append(c);
    }
    wrap.append(box);
    const half = this.button('½', 'dark small', () => set(bet / 2));
    const dbl = this.button('x2', 'dark small', () => set(bet * 2));
    const mn = this.button('Min', 'dark small', () => set(min));
    const mx = this.button('Max', 'dark small', () => set(max));
    wrap.append(half, dbl, mn, mx);
    this._freshBet = false;
    set(bet, true);
    return { el: wrap, get value() { return bet; }, set, refresh: () => set(bet, true), disable(v) { wrap.querySelectorAll('button').forEach((b) => (b.disabled = v)); if (!v) chips.forEach(([c, d]) => (c.disabled = d > max)); } };
  }

  // ------------------------------------------------------------ overlays
  overlay(content, { allowHotkeys = false, onClose } = {}) {
    this.closeOverlay();
    const o = h('div', 'overlay');
    const c = typeof content === 'string' ? h('div', 'card', content) : content;
    o.append(c);
    this.root.append(o);
    document.documentElement.classList.add('overlay-open');
    this.overlayOpen = { el: o, card: c, onClose };
    this.overlayAllowsHotkeys = allowHotkeys;
    return { el: o, card: c, close: () => this.closeOverlay() };
  }
  closeOverlay() {
    if (this.overlayOpen) { const cb = this.overlayOpen.onClose; this.overlayOpen.el.remove(); this.overlayOpen = null; document.documentElement.classList.remove('overlay-open'); cb && cb(); }
  }
}
