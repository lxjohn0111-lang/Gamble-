// Slot payback check: exact classic RTP by enumeration, video RTP by Monte Carlo (incl. free spins).
// node tools/slot-rtp.mjs [spins]
import { CLASSIC, VIDEO, evalClassic, evalVideo, window3 } from '../src/games/slotmath.js';
const N = +(process.argv[2] || 2e6);
// exact classic RTP by enumeration
let sum = 0, cnt = 0, hits = 0, jp = 0;
const [r1, r2, r3] = CLASSIC.reels;
for (const a of r1) for (const b of r2) for (const c of r3) { const e = evalClassic([a, b, c]); sum += e.mult; cnt++; if (e.mult > 0) hits++; if (e.jackpot) jp++; }
console.log('CLASSIC RTP', (sum / cnt).toFixed(4), 'hit rate', (hits / cnt).toFixed(3), 'jackpot 1 in', Math.round(cnt / jp), 'strip len', r1.length);
// video RTP by Monte Carlo incl. free spins
let bet = 0, win = 0, vh = 0, fsTrig = 0;
function spin(mult) {
  const grid = VIDEO.reels.map((r) => window3(r, Math.floor(Math.random() * r.length)));
  const e = evalVideo(grid, mult);
  return e;
}
for (let i = 0; i < N; i++) {
  bet += 1;
  const e = spin(1);
  let w = e.lineMult / 9 + e.scatterPay;
  let fs = e.freeSpins;
  if (fs) fsTrig++;
  while (fs > 0) { fs--; const f = spin(VIDEO.freeMult); w += f.lineMult / 9 + f.scatterPay; fs += f.freeSpins; }
  if (w > 0) vh++;
  win += w;
}
console.log('VIDEO RTP', (win / bet).toFixed(4), 'hit', (vh / N).toFixed(3), 'free spins 1 in', Math.round(N / fsTrig), 'strip', VIDEO.reels.map(r=>r.length).join(','));
