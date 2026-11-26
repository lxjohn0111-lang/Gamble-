// Fast, tileable value-noise helpers used by the procedural texture generator.

function hash(ix, iy, seed) {
  let h = (ix * 374761393 + iy * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const fade = (t) => t * t * (3 - 2 * t);

/** Tileable value noise: period in lattice cells along x and y. */
export function vnoise(x, y, px = 256, py = 256, seed = 0) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = fade(x - x0), fy = fade(y - y0);
  const ax = ((x0 % px) + px) % px, ay = ((y0 % py) + py) % py;
  const bx = (ax + 1) % px, by = (ay + 1) % py;
  const a = hash(ax, ay, seed), b = hash(bx, ay, seed);
  const c = hash(ax, by, seed), d = hash(bx, by, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** Tileable fractal noise in [0,1]. u,v in [0,1) cover one tile; freq is the base lattice count. */
export function fbm(u, v, freq = 4, octaves = 4, seed = 0, gain = 0.5) {
  let amp = 0.5, sum = 0, norm = 0, f = freq;
  for (let o = 0; o < octaves; o++) {
    sum += amp * vnoise(u * f, v * f, f, f, seed + o * 17);
    norm += amp; amp *= gain; f *= 2;
  }
  return sum / norm;
}

/** Ridged turbulence for marble veins etc. */
export function turb(u, v, freq = 4, octaves = 5, seed = 0) {
  let amp = 0.5, sum = 0, norm = 0, f = freq;
  for (let o = 0; o < octaves; o++) {
    sum += amp * Math.abs(vnoise(u * f, v * f, f, f, seed + o * 31) * 2 - 1);
    norm += amp; amp *= 0.5; f *= 2;
  }
  return sum / norm;
}

export function white(ix, iy, seed = 0) { return hash(ix, iy, seed); }
