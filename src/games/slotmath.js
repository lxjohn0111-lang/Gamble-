// Pure slot-machine math (no three.js) so it can be RTP-tested in Node.
// Symbol ids map to the atlas drawn in slots.js.
export const SYM = { WILD: 0, SCATTER: 1, SEVEN: 2, DIAMOND: 3, BAR3: 4, BAR2: 5, BAR: 6, BELL: 7, CHERRY: 8, LEMON: 9, MELON: 10, SHOE: 11, BLANK: 12 };
export const SYM_NAMES = ['WILD', 'BONUS', '7', 'DIAMOND', 'BAR3', 'BAR2', 'BAR', 'BELL', 'CHERRY', 'LEMON', 'MELON', 'HORSESHOE', ''];

function strip(weights) {
  // spread symbols evenly so identical symbols rarely clump
  const out = [];
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  const entries = Object.entries(weights).map(([s, w]) => ({ s: +s, w, acc: 0 }));
  for (let i = 0; i < total; i++) {
    for (const e of entries) e.acc += e.w;
    let best = entries[0];
    for (const e of entries) if (e.acc > best.acc) best = e;
    best.acc -= total;
    out.push(best.s);
  }
  return out;
}

// ---------------------------------------------------------------- classic 3-reel, 1 line
const classicStrip = () => {
  // player-friendly tuning (see src/game/balance.js): RTP 102.9%, a win on 27% of spins, low variance
  const sy = strip({ [SYM.WILD]: 1, [SYM.SEVEN]: 1, [SYM.BAR3]: 2, [SYM.BAR2]: 2, [SYM.BAR]: 3, [SYM.BELL]: 2, [SYM.CHERRY]: 3, [SYM.LEMON]: 2 });
  const out = []; for (const x of sy) out.push(x, SYM.BLANK); return out; // symbols separated by blanks
};
export const CLASSIC = {
  reels: [classicStrip(), classicStrip(), classicStrip()],
  // value sits in frequent small wins rather than rare jackpots, so a typical session ends ahead more often
  pays: { [SYM.SEVEN]: 60, [SYM.BAR3]: 30, [SYM.BAR2]: 20, [SYM.BAR]: 12, [SYM.BELL]: 15, [SYM.CHERRY]: 12, [SYM.LEMON]: 8 },
  wildWild: 300, // three wilds (plus progressive at max bet)
  anyBar: 5,
  cherry2: 5, cherry1: 2,
};

const isBar = (s) => s === SYM.BAR || s === SYM.BAR2 || s === SYM.BAR3;

/** Evaluate a classic center line. Returns {mult, wilds, label}. */
export function evalClassic(line) {
  const P = CLASSIC.pays;
  const wilds = line.filter((s) => s === SYM.WILD).length;
  if (wilds === 3) return { mult: CLASSIC.wildWild, wilds, label: 'TRIPLE JELLY!', jackpot: true };
  const nonWild = line.filter((s) => s !== SYM.WILD);
  const wildMult = Math.pow(2, wilds);
  // three of a kind (wild substitutes)
  if (nonWild.every((s) => s === nonWild[0]) && P[nonWild[0]]) return { mult: P[nonWild[0]] * wildMult, wilds, label: `3 × ${label(nonWild[0])}` };
  if (nonWild.every(isBar)) return { mult: CLASSIC.anyBar * wildMult, wilds, label: 'ANY BAR' };
  const ch = line.filter((s) => s === SYM.CHERRY || s === SYM.WILD).length;
  const realCh = line.filter((s) => s === SYM.CHERRY).length;
  if (realCh >= 1 && ch >= 2) return { mult: CLASSIC.cherry2 * (wilds ? 2 : 1), wilds, label: 'CHERRIES' };
  if (realCh === 1) return { mult: CLASSIC.cherry1, wilds, label: 'CHERRY' };
  return { mult: 0, wilds, label: '' };
}

// ---------------------------------------------------------------- video 5x3, 9 lines
export const LINES = [
  [1, 1, 1, 1, 1], [0, 0, 0, 0, 0], [2, 2, 2, 2, 2], [0, 1, 2, 1, 0], [2, 1, 0, 1, 2],
  [0, 0, 1, 2, 2], [2, 2, 1, 0, 0], [1, 0, 0, 0, 1], [1, 2, 2, 2, 1],
];
const vw = (o) => strip(o);
export const VIDEO = {
  reels: [
    vw({ [SYM.WILD]: 2, [SYM.SCATTER]: 1, [SYM.SEVEN]: 2, [SYM.DIAMOND]: 3, [SYM.BELL]: 4, [SYM.MELON]: 4, [SYM.SHOE]: 5, [SYM.CHERRY]: 5, [SYM.LEMON]: 5 }),
    vw({ [SYM.WILD]: 2, [SYM.SCATTER]: 1, [SYM.SEVEN]: 2, [SYM.DIAMOND]: 3, [SYM.BELL]: 4, [SYM.MELON]: 4, [SYM.SHOE]: 5, [SYM.CHERRY]: 5, [SYM.LEMON]: 5 }),
    vw({ [SYM.WILD]: 2, [SYM.SCATTER]: 1, [SYM.SEVEN]: 2, [SYM.DIAMOND]: 3, [SYM.BELL]: 4, [SYM.MELON]: 4, [SYM.SHOE]: 5, [SYM.CHERRY]: 5, [SYM.LEMON]: 5 }),
    vw({ [SYM.WILD]: 2, [SYM.SCATTER]: 1, [SYM.SEVEN]: 2, [SYM.DIAMOND]: 3, [SYM.BELL]: 4, [SYM.MELON]: 4, [SYM.SHOE]: 5, [SYM.CHERRY]: 5, [SYM.LEMON]: 5 }),
    vw({ [SYM.WILD]: 2, [SYM.SCATTER]: 1, [SYM.SEVEN]: 2, [SYM.DIAMOND]: 3, [SYM.BELL]: 4, [SYM.MELON]: 4, [SYM.SHOE]: 5, [SYM.CHERRY]: 5, [SYM.LEMON]: 5 }),
  ],
  // pays per line bet for 3/4/5 of a kind (player-friendly tuning: RTP ~104%, a win on 35% of spins, low variance)
  pays: {
    [SYM.WILD]: [40, 150, 800], [SYM.SEVEN]: [25, 90, 350], [SYM.DIAMOND]: [18, 60, 200], [SYM.BELL]: [13, 36, 110],
    [SYM.MELON]: [11, 30, 85], [SYM.SHOE]: [9, 24, 65], [SYM.CHERRY]: [8, 20, 52], [SYM.LEMON]: [7, 16, 44],
  },
  scatter: { 3: 4, 4: 18, 5: 70 }, // × total bet
  freeSpins: { 3: 8, 4: 12, 5: 20 },
  freeMult: 2,
};

/** grid[reel][row] → wins. lineBet = total / 9. */
export function evalVideo(grid, freeMult = 1) {
  const wins = [];
  let total = 0;
  LINES.forEach((L, li) => {
    const syms = L.map((r, i) => grid[i][r]);
    // leading symbol (first non-wild), wilds substitute except for scatter
    let base = syms.find((s) => s !== SYM.WILD);
    if (base === undefined) base = SYM.WILD;
    if (base === SYM.SCATTER) return;
    let n = 0;
    for (const s of syms) { if (s === base || s === SYM.WILD) n++; else break; }
    // pure wild run may beat the substituted symbol
    let wn = 0; for (const s of syms) { if (s === SYM.WILD) wn++; else break; }
    let best = 0, bestSym = base, bestN = n;
    if (n >= 3 && VIDEO.pays[base]) best = VIDEO.pays[base][n - 3];
    if (wn >= 3 && VIDEO.pays[SYM.WILD][wn - 3] > best) { best = VIDEO.pays[SYM.WILD][wn - 3]; bestSym = SYM.WILD; bestN = wn; }
    if (best > 0) { wins.push({ line: li, sym: bestSym, n: bestN, mult: best * freeMult }); total += best * freeMult; }
  });
  let scat = 0;
  for (const reel of grid) for (const s of reel) if (s === SYM.SCATTER) scat++;
  const scatterPay = VIDEO.scatter[Math.min(5, scat)] || 0;
  const free = VIDEO.freeSpins[Math.min(5, scat)] || 0;
  return { lineMult: total, wins, scatters: scat, scatterPay: scatterPay * freeMult, freeSpins: free, jackpot: wins.some((w) => w.sym === SYM.WILD && w.n === 5) };
}

export function label(s) { return SYM_NAMES[s]; }

/** Random stop index for a reel strip. */
export function spinReel(reel, rnd = Math.random) { return Math.floor(rnd() * reel.length); }
export function window3(reel, stop) {
  const n = reel.length;
  return [reel[(stop + 1) % n], reel[stop], reel[(stop - 1 + n) % n]]; // top, mid, bottom
}
