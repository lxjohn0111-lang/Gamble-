import * as THREE from 'three';

// ============================================================================
//  Camera framing: keeps the gambling equipment in the part of the screen the
//  UI leaves free.
//
//  While a game panel is open, the camera's principal point is moved to the
//  centre of the free area (PerspectiveCamera.setViewOffset) and the field of
//  view is chosen so that the station's designed 16:9 shot fits that area.
//  So on a phone the machine sits above the bottom sheet (portrait) or left of
//  the side panel (landscape) instead of behind it. Raycasts (roulette felt,
//  mines tiles) and world labels use the same projection, so they stay exact.
//  Walking in portrait also gets a wider view, or you would only see a sliver.
// ============================================================================
const REF_ASPECT = 16 / 9;
const MIN_WALK_HALF_H = Math.tan(THREE.MathUtils.degToRad(26)); // horizontal half-FOV floor while walking
const SEAT_FIT_W = 0.82; // share of the designed shot's width that must fit the free area
const SEAT_FIT_H = 0.72; // ... and of its height (the old full-screen shots had the panel over their lower part)
const SEAT_DOWN = 0.92; // never show more than this (x designed half-height) below the look direction

export class Framing {
  constructor(camera, ui, baseFov = 72) {
    this.camera = camera;
    this.ui = ui;
    this.baseFov = baseFov;
    this.cur = null;
    this.target = { x: 0, y: 0, w: 1, h: 1 };
    this.seat = 0; // 0 = walking, 1 = seated at a game (blended)
    this.seatTarget = 0;
    this._measureT = 0;
    this._vars = '';
  }

  measure() {
    const W = window.innerWidth, H = window.innerHeight;
    const r = this.ui.freeRect();
    this.target = { x: r.x / W, y: r.y / H, w: r.w / W, h: r.h / H };
    this.seatTarget = r.panel ? 1 : 0;
  }

  update(dt) {
    this._measureT -= dt;
    if (this._measureT <= 0 || !this.cur) { this._measureT = 0.08; this.measure(); }
    const t = this.target;
    if (!this.cur) { this.cur = { ...t }; this.seat = this.seatTarget; }
    const k = dt > 0 ? 1 - Math.exp(-dt * 9) : 1;
    this.cur.x += (t.x - this.cur.x) * k;
    this.cur.y += (t.y - this.cur.y) * k;
    this.cur.w += (t.w - this.cur.w) * k;
    this.cur.h += (t.h - this.cur.h) * k;
    this.seat += (this.seatTarget - this.seat) * k;
    this.apply();
  }

  apply() {
    const W = window.innerWidth, H = window.innerHeight, c = this.cur, cam = this.camera;
    const fx = c.x * W, fy = c.y * H, fw = Math.max(1, c.w * W), fh = Math.max(1, c.h * H);
    const af = fw / fh;
    const T0 = Math.tan(THREE.MathUtils.degToRad(this.baseFov / 2));
    const walk = Math.max(T0, MIN_WALK_HALF_H / af);
    const seated = Math.max(T0 * SEAT_FIT_H, (T0 * REF_ASPECT * SEAT_FIT_W) / af);
    const tv = walk + (seated - walk) * this.seat;
    const fov = THREE.MathUtils.radToDeg(2 * Math.atan(tv));
    // When the seated view is taller than the designed shot (narrow free areas), spend the extra
    // height above the equipment (dealer, signs) rather than below it (stools, the table edge).
    const pSeat = Math.min(0.75, Math.max(0.5, 1 - (T0 * SEAT_DOWN) / (2 * tv)));
    const py = 0.5 + (pSeat - 0.5) * this.seat; // principal point, as a share of the free height from the top
    const full = fx < 0.5 && fy < 0.5 && Math.abs(fw - W) < 0.5 && Math.abs(fh - H) < 0.5 && Math.abs(py - 0.5) < 1e-3;
    if (full) {
      if (cam.view && cam.view.enabled) cam.clearViewOffset();
      if (Math.abs(cam.fov - fov) > 1e-4 || Math.abs(cam.aspect - af) > 1e-6) { cam.fov = fov; cam.aspect = af; cam.updateProjectionMatrix(); }
    } else {
      cam.fov = fov;
      cam.setViewOffset(fw, fh, -fx, -(fy + (py - 0.5) * fh), W, H); // also sets aspect = fw / fh and updates the projection
    }
    const vars = `${fx | 0},${fy | 0},${fw | 0},${fh | 0}`;
    if (vars !== this._vars) { this._vars = vars; this.ui.setFreeVars(fx, fy, fw, fh); }
  }
}
