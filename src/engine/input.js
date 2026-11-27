// Keyboard / mouse / pointer-lock / touch input.

const BLOCK_KEYS = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab']);

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set(); // keys pressed this frame
    this.mouseDX = 0; this.mouseDY = 0;
    this.locked = false;
    this.lookEnabled = true; // false while in a game seat
    this.mouseDown = false;
    this.clicked = false;
    this.dragLook = false; // fallback when pointer lock is unavailable
    this.sensitivity = 1;
    this.listeners = { lockchange: [] };
    this.touch = { active: false, moveX: 0, moveY: 0, lookDX: 0, lookDY: 0 };
    this.isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      if (BLOCK_KEYS.has(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => { this.keys.delete(e.code); });
    window.addEventListener('blur', () => { this.keys.clear(); this.mouseDown = false; });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (this.locked) { this.lockFailed = 0; this._clickLock = false; }
      this.listeners.lockchange.forEach((f) => f(this.locked));
    });
    // A refused lock (e.g. right after Esc) is retried on the next click; only fall back
    // to drag-to-look when the API is missing entirely.
    this.dragLook = !('requestPointerLock' in canvas);
    document.addEventListener('pointerlockerror', () => this._lockRefused());

    window.addEventListener('mousemove', (e) => {
      if (this.locked || (this.dragLook && this.mouseDown)) {
        this.mouseDX += e.movementX || 0;
        this.mouseDY += e.movementY || 0;
        if (this.dragLook && this.mouseDown) { this._dragDist += Math.abs(e.movementX || 0) + Math.abs(e.movementY || 0); if (this._dragDist > 30) this.dragged = true; }
      }
    });
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) { this.mouseDown = true; this.clicked = true; this._dragDist = 0; this._downT = performance.now(); }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button !== 0) return;
      if (this.mouseDown && this._dragDist < 6 && performance.now() - this._downT < 450) this.tapped = true;
      this.mouseDown = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('wheel', (e) => { if (this.locked) e.preventDefault(); }, { passive: false });
  }

  on(ev, fn) { this.listeners[ev].push(fn); }

  /** Ask for pointer lock. If the browser frame refuses it twice after real clicks, fall back to drag-to-look. */
  requestLock(fromClick = false) {
    if (this.isTouch || this.dragLook) return;
    if (document.pointerLockElement === this.canvas) return;
    if (fromClick) {
      this._clickLock = true;
      clearTimeout(this._lockCheck);
      this._lockCheck = setTimeout(() => { if (this._clickLock && document.pointerLockElement !== this.canvas) this._lockRefused(); }, 700);
    }
    try {
      const p = this.canvas.requestPointerLock({ unadjustedMovement: false });
      if (p && p.catch) p.catch(() => {});
    } catch (e) { /* retried on next click */ }
  }
  _lockRefused() {
    if (!this._clickLock) return;
    this._clickLock = false;
    this.lockFailed = (this.lockFailed || 0) + 1;
    if (this.lockFailed >= 2) this.dragLook = true;
  }
  exitLock() { if (document.pointerLockElement) document.exitPointerLock(); }

  down(code) { return this.keys.has(code); }
  hit(code) { return this.pressed.has(code); }
  consumeMouse() {
    const dx = this.mouseDX + this.touch.lookDX, dy = this.mouseDY + this.touch.lookDY;
    this.mouseDX = this.mouseDY = 0; this.touch.lookDX = this.touch.lookDY = 0;
    return [dx * this.sensitivity, dy * this.sensitivity];
  }
  endFrame() { this.pressed.clear(); this.clicked = false; this.tapped = false; }

  /** Movement vector in local space (x right, y forward). */
  moveAxis() {
    let x = 0, y = 0;
    if (this.down('KeyW') || this.down('ArrowUp') || this.down('KeyZ')) y += 1;
    if (this.down('KeyS') || this.down('ArrowDown')) y -= 1;
    if (this.down('KeyA') || this.down('ArrowLeft') || this.down('KeyQ')) x -= 1;
    if (this.down('KeyD') || this.down('ArrowRight')) x += 1;
    x += this.touch.moveX; y += this.touch.moveY;
    const l = Math.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }
    return [x, y];
  }

  /** On-screen joystick + look pad for touch devices. */
  setupTouch(root, onInteract) {
    if (!this.isTouch) return;
    const wrap = document.createElement('div');
    wrap.className = 'touch-ui';
    wrap.innerHTML = `<div class="tstick"><div class="tknob"></div></div><div class="tlook"></div><button class="tbtn tuse">USE</button><button class="tbtn trun">RUN</button>`;
    root.appendChild(wrap);
    const stick = wrap.querySelector('.tstick'), knob = wrap.querySelector('.tknob'), look = wrap.querySelector('.tlook');
    let sid = null, sx = 0, sy = 0, lid = null, lx = 0, ly = 0;
    stick.addEventListener('touchstart', (e) => { const t = e.changedTouches[0]; sid = t.identifier; const r = stick.getBoundingClientRect(); sx = r.left + r.width / 2; sy = r.top + r.height / 2; e.preventDefault(); }, { passive: false });
    look.addEventListener('touchstart', (e) => { const t = e.changedTouches[0]; lid = t.identifier; lx = t.clientX; ly = t.clientY; e.preventDefault(); }, { passive: false });
    window.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === sid) {
          let dx = (t.clientX - sx) / 50, dy = (t.clientY - sy) / 50;
          const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; }
          this.touch.moveX = dx; this.touch.moveY = -dy;
          knob.style.transform = `translate(${dx * 40}px,${dy * 40}px)`;
        } else if (t.identifier === lid) {
          this.touch.lookDX += (t.clientX - lx) * 2.2; this.touch.lookDY += (t.clientY - ly) * 2.2;
          lx = t.clientX; ly = t.clientY;
        }
      }
    }, { passive: true });
    const end = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === sid) { sid = null; this.touch.moveX = this.touch.moveY = 0; knob.style.transform = ''; }
        if (t.identifier === lid) lid = null;
      }
    };
    window.addEventListener('touchend', end); window.addEventListener('touchcancel', end);
    wrap.querySelector('.tuse').addEventListener('touchstart', (e) => { e.preventDefault(); onInteract(); }, { passive: false });
    const run = wrap.querySelector('.trun');
    run.addEventListener('touchstart', (e) => { e.preventDefault(); this.keys.add('ShiftLeft'); }, { passive: false });
    run.addEventListener('touchend', () => this.keys.delete('ShiftLeft'));
    this.touchUI = wrap;
  }
  showTouch(v) { if (this.touchUI) this.touchUI.style.display = v ? '' : 'none'; }
}
