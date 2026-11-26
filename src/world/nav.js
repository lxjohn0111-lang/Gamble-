// Grid navigation (A*) over the casino floor with line-of-sight smoothing.

export class NavGrid {
  constructor(minX, minZ, maxX, maxZ, cell = 0.5) {
    this.minX = minX; this.minZ = minZ; this.cell = cell;
    this.w = Math.ceil((maxX - minX) / cell); this.h = Math.ceil((maxZ - minZ) / cell);
    this.walk = new Uint8Array(this.w * this.h); // 0 blocked, 1 walkable
  }
  idx(ix, iz) { return iz * this.w + ix; }
  toCell(x, z) { return [Math.floor((x - this.minX) / this.cell), Math.floor((z - this.minZ) / this.cell)]; }
  center(ix, iz) { return [this.minX + (ix + 0.5) * this.cell, this.minZ + (iz + 0.5) * this.cell]; }
  ok(ix, iz) { return ix >= 0 && iz >= 0 && ix < this.w && iz < this.h && this.walk[iz * this.w + ix] === 1; }
  walkableAt(x, z) { const [i, j] = this.toCell(x, z); return this.ok(i, j); }

  markRect(x0, z0, x1, z1, v) {
    const [a, b] = this.toCell(x0, z0), [c, d] = this.toCell(x1, z1);
    for (let j = Math.max(0, b); j <= Math.min(this.h - 1, d); j++) for (let i = Math.max(0, a); i <= Math.min(this.w - 1, c); i++) this.walk[j * this.w + i] = v;
  }

  nearestWalkable(x, z) {
    let [i, j] = this.toCell(x, z);
    if (this.ok(i, j)) return [i, j];
    for (let r = 1; r < 12; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      if (Math.abs(di) !== r && Math.abs(dj) !== r) continue;
      if (this.ok(i + di, j + dj)) return [i + di, j + dj];
    }
    return null;
  }

  los(x0, z0, x1, z1) {
    const d = Math.hypot(x1 - x0, z1 - z0), n = Math.ceil(d / (this.cell * 0.5));
    for (let k = 1; k < n; k++) { const t = k / n; if (!this.walkableAt(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t)) return false; }
    return true;
  }

  randomWalkable(rng = Math.random) {
    for (let k = 0; k < 200; k++) {
      const i = Math.floor(rng() * this.w), j = Math.floor(rng() * this.h);
      if (this.ok(i, j)) return this.center(i, j);
    }
    return null;
  }

  /** A* path from world (x0,z0) to (x1,z1). Returns array of [x,z] or null. */
  path(x0, z0, x1, z1, maxIter = 6000) {
    const s = this.nearestWalkable(x0, z0), e = this.nearestWalkable(x1, z1);
    if (!s || !e) return null;
    const W = this.w, N = W * this.h;
    const g = new Float32Array(N).fill(Infinity), came = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
    const si = s[1] * W + s[0], ei = e[1] * W + e[0];
    g[si] = 0;
    const open = [[this._h(s[0], s[1], e), si]];
    let it = 0;
    while (open.length && it++ < maxIter) {
      // pop lowest f (small binary heap)
      let bi = 0; for (let k = 1; k < open.length; k++) if (open[k][0] < open[bi][0]) bi = k;
      const [, cur] = open[bi]; open[bi] = open[open.length - 1]; open.pop();
      if (closed[cur]) continue; closed[cur] = 1;
      if (cur === ei) break;
      const cx = cur % W, cz = (cur / W) | 0;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const nx = cx + dx, nz = cz + dz;
        if (!this.ok(nx, nz)) continue;
        if (dx && dz && (!this.ok(cx + dx, cz) || !this.ok(cx, cz + dz))) continue;
        const ni = nz * W + nx;
        if (closed[ni]) continue;
        const ng = g[cur] + (dx && dz ? 1.414 : 1);
        if (ng < g[ni]) { g[ni] = ng; came[ni] = cur; open.push([ng + this._h(nx, nz, e), ni]); }
      }
    }
    if (came[ei] === -1 && si !== ei) return null;
    const cells = [];
    for (let c = ei; c !== -1; c = came[c]) { cells.push(c); if (c === si) break; }
    cells.reverse();
    const pts = cells.map((c) => this.center(c % W, (c / W) | 0));
    pts[pts.length - 1] = [x1, z1];
    // smooth with line of sight
    const out = [[x0, z0]];
    let anchor = 0;
    for (let k = 1; k < pts.length; k++) {
      const a = k === 1 ? [x0, z0] : pts[anchor];
      if (!this.los(a[0], a[1], pts[k][0], pts[k][1])) { out.push(pts[k - 1]); anchor = k - 1; }
    }
    out.push(pts[pts.length - 1]);
    return out.slice(1);
  }
  _h(x, z, e) { const dx = Math.abs(x - e[0]), dz = Math.abs(z - e[1]); return dx + dz - 0.586 * Math.min(dx, dz); }
}
