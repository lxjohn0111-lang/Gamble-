import { SDK } from '../sdk.js';
import { quotaFor, stakeFor, casinoFor, MODIFIERS } from '../world/days.js';
import { BALANCE } from './balance.js';
import { makeRng } from '../engine/util.js';

// ============================================================================
//  Run state: money, quota, clock, perks, stats, persistence.
// ============================================================================

export const PERKS = [
  { id: 'clover', name: 'Four-Leaf Clover', icon: '🍀', desc: 'Slot machine wins pay +12% per level.', price: 350, max: 3 },
  { id: 'monocle', name: "Card Counter's Monocle", icon: '🧐', desc: 'Blackjack: shows the Hi-Lo count and the best move.', price: 500, max: 1 },
  { id: 'watch', name: 'Golden Pocket Watch', icon: '⌚', desc: '+60 minutes before closing time each night.', price: 400, max: 2 },
  { id: 'wallet', name: 'Fat Wallet', icon: '👛', desc: '+$200 added to your starting stake every night.', price: 450, max: 3 },
  { id: 'cat', name: 'Lucky Cat', icon: '🐱', desc: 'Dropped chips appear twice as often and are worth more.', price: 300, max: 2 },
  { id: 'dice', name: 'Loaded Dice', icon: '🎲', desc: 'Craps & Sic Bo wins pay +10%.', price: 400, max: 2 },
  { id: 'magnet', name: 'Coin Magnet', icon: '🧲', desc: 'Coin pushers shove harder: more coins spill over.', price: 300, max: 2 },
  { id: 'socks', name: 'Lucky Socks', icon: '🧦', desc: 'Scratch cards hit winning combos more often.', price: 300, max: 2 },
  { id: 'rabbit', name: "Rabbit's Foot", icon: '🐇', desc: 'Your first losing bet each night is refunded (up to $1,000).', price: 550, max: 1 },
  { id: 'eagle', name: 'Eagle Eye', icon: '🦅', desc: 'Plinko & Wheel wins pay +10%.', price: 350, max: 2 },
  { id: 'rocket', name: 'Rocket Fuel', icon: '🚀', desc: 'Crash & Mines multipliers +6%.', price: 400, max: 2 },
  { id: 'tony', name: "Tony's Good Graces", icon: '🤝', desc: "Big Tony's quota is 10% lower every night.", price: 900, max: 2 },
  { id: 'horseshoe', name: 'Golden Horseshoe', icon: '🧿', desc: 'Roulette: a zero refunds half of every losing bet.', price: 450, max: 1 },
  { id: 'cards', name: 'Marked Deck', icon: '🃏', desc: 'Baccarat, Video Poker & Derby pay +8%.', price: 400, max: 2 },
];

export const DRINKS = [
  { id: 'lemonade', name: 'Lucky Lemonade', price: 15, color: 0xfff06a, glass: 'tumbler', desc: '+10% on all wins for 2 minutes.', effect: { luck: 0.1, dur: 120 } },
  { id: 'martini', name: 'Dirty Martini', price: 25, color: 0xd8f0c0, glass: 'martini', desc: 'Liquid courage: +15% wins for 90s, but the room spins.', effect: { luck: 0.15, dur: 90, drunk: 0.8 } },
  { id: 'espresso', name: 'Espresso Shot', price: 20, color: 0x3a1a08, glass: 'tumbler', desc: 'Slows the clock by 30% for 3 minutes.', effect: { slow: 0.3, dur: 180 } },
  { id: 'tiki', name: 'Volcano Bowl', price: 40, color: 0xff5a2a, glass: 'tiki', desc: '+25% wins for 60s. Extremely wobbly.', effect: { luck: 0.25, dur: 60, drunk: 1.4 } },
];

class Emitter {
  constructor() { this.l = {}; }
  on(e, f) { (this.l[e] = this.l[e] || []).push(f); return () => this.off(e, f); }
  off(e, f) { this.l[e] = (this.l[e] || []).filter((x) => x !== f); }
  emit(e, ...a) { (this.l[e] || []).forEach((f) => f(...a)); }
}

export class GameState extends Emitter {
  constructor() {
    super();
    this.best = { day: 0, money: 0, biggestWin: 0 };
    this.newRun();
    this.loadBest();
  }

  newRun() {
    this.day = 1;
    this.money = 0;
    this.perks = {};
    this.stats = { hands: 0, wins: 0, biggestWin: 0, totalWon: 0, totalWagered: 0, jackpots: 0, drinks: 0, pickups: 0 };
    this.loan = 0;
    this.runSeed = Math.floor(Math.random() * 1e9);
    this.startDay(true);
  }

  startDay(first = false) {
    this.casino = casinoFor(this.day);
    const mrng = makeRng(this.runSeed + this.day * 101);
    this.modifier = this.day > 5 ? MODIFIERS[Math.floor(mrng() * MODIFIERS.length)] : null;
    const tony = Math.pow(0.9, this.perks.tony || 0);
    this.quota = Math.round((quotaFor(this.day) * tony + this.loan * 1.5) / 10) * 10;
    this.loanDue = this.loan; this.loan = 0;
    this.stake = stakeFor(this.day) + (this.perks.wallet || 0) * 200;
    if (first) this.money = this.stake; else this.money += this.stake;
    this.dayStartMoney = this.money;
    this.timeMin = 0;
    this.dayLength = BALANCE.nightMinutes + (this.perks.watch || 0) * 60;
    this.flags = { atmUsed: false, stakeDoubled: false, rabbitUsed: false, extraHour: false, loanTaken: 0 };
    this.buffs = [];
    this.streak = 0;
    this.coldStreak = 0;
    this.dayStats = { won: 0, lost: 0, biggest: 0, hands: 0 };
    this.emit('money', this.money, 0);
    this.emit('streak', 0);
  }

  // ------------------------------------------------------------- money
  canAfford(v) { return this.money >= v - 1e-6; }
  /** Take a wager. Returns false if unaffordable. */
  wager(v, game) {
    if (v <= 0 || !this.canAfford(v)) return false;
    this.money -= v;
    this.stats.totalWagered += v;
    this.stats.hands++; this.dayStats.hands++;
    this.emit('money', this.money, -v, game);
    this.save();
    return true;
  }
  /** Pay out a gross amount (stake included). Luck buffs apply to the profit portion. */
  payout(gross, stake, game, { noBuff = false } = {}) {
    let amount = gross;
    if (!noBuff && gross > stake) amount = stake + (gross - stake) * (1 + this.luck());
    amount = Math.round(amount * 100) / 100;
    this.money += amount;
    const profit = amount - stake;
    if (profit > 0) {
      this.coldStreak = 0;
      this.streak++;
      this.emit('streak', this.streak);
      this.stats.wins++; this.stats.totalWon += profit; this.dayStats.won += profit;
      if (profit > this.stats.biggestWin) this.stats.biggestWin = profit;
      if (profit > this.dayStats.biggest) this.dayStats.biggest = profit;
    }
    this.emit('money', this.money, amount, game, profit);
    this.save();
    return amount;
  }
  /** Record a loss (for rabbit's foot & stats). Call after a wager resolves to nothing. */
  lost(stake, game) {
    this.dayStats.lost += stake;
    if (stake > 0 && this.streak) { const s = this.streak; this.streak = 0; this.emit('streak', 0, s); }
    // Lady Luck: a run of losses earns a temporary boost on wins
    if (stake > 0 && ++this.coldStreak >= BALANCE.pityLosses && !this.buffs.some((b) => b.pity)) {
      this.coldStreak = 0;
      this.addBuff({ ...BALANCE.pityBuff, pity: true }, 'Lady Luck');
      this.emit('toast', `🍀 Lady Luck feels sorry for you: wins pay +${Math.round(BALANCE.pityBuff.luck * 100)}% for ${BALANCE.pityBuff.dur} seconds!`, 'gold');
    }
    if (this.perks.rabbit && !this.flags.rabbitUsed && stake > 0) {
      this.flags.rabbitUsed = true;
      const refund = Math.min(stake, 1000);
      this.money += refund;
      this.emit('money', this.money, refund, 'rabbit', 0);
      this.emit('toast', `🐇 Rabbit's Foot refunded ${'$' + refund}!`, 'good');
    }
    this.emit('loss', stake, game);
    this.save();
  }
  gift(v, reason) {
    this.money += v;
    this.emit('money', this.money, v, reason, v);
    this.save();
  }
  spend(v, reason) {
    if (!this.canAfford(v)) return false;
    this.money -= v;
    this.emit('money', this.money, -v, reason);
    this.save();
    return true;
  }

  // ------------------------------------------------------------- perks & buffs
  perkMult(game) {
    const p = this.perks;
    let m = 1;
    if (game === 'slots') m += 0.12 * (p.clover || 0);
    if (game === 'craps' || game === 'sicbo') m += 0.1 * (p.dice || 0);
    if (game === 'plinko' || game === 'wheel') m += 0.1 * (p.eagle || 0);
    if (game === 'crash' || game === 'mines') m += 0.06 * (p.rocket || 0);
    if (game === 'baccarat' || game === 'videopoker' || game === 'derby') m += 0.08 * (p.cards || 0);
    if (this.modifier && this.modifier.slotsMult && game === 'slots') m *= this.modifier.slotsMult;
    return m;
  }
  luck() { let l = BALANCE.houseLuck; for (const b of this.buffs) if (b.luck) l += b.luck; return l + this.streakBonus(); }
  streakBonus() { return Math.min(BALANCE.streakCap, BALANCE.streakStep * Math.max(0, (this.streak || 0) - 2)); }
  drunk() { let d = 0; for (const b of this.buffs) if (b.drunk) d = Math.max(d, b.drunk * Math.min(1, b.left / 15)); return d; }
  timeScale() { let s = 1; for (const b of this.buffs) if (b.slow) s *= 1 - b.slow; return s; }
  addBuff(effect, name) { this.buffs.push({ ...effect, left: effect.dur, name }); this.emit('buffs'); }
  limitMult() { return this.modifier && this.modifier.limitMult ? this.modifier.limitMult : 1; }

  // ------------------------------------------------------------- clock
  tick(dt) {
    const before = this.timeMin;
    this.timeMin += dt * this.timeScale(); // 1 real second = 1 casino minute
    for (const b of this.buffs) b.left -= dt;
    const n = this.buffs.length;
    this.buffs = this.buffs.filter((b) => b.left > 0);
    if (this.buffs.length !== n) this.emit('buffs');
    const left = this.dayLength - this.timeMin;
    if (before < this.dayLength - 60 && this.timeMin >= this.dayLength - 60) this.emit('lastcall');
    if (before < this.dayLength - 15 && this.timeMin >= this.dayLength - 15) this.emit('closingSoon');
    if (left <= 0 && before < this.dayLength) this.emit('closing');
  }
  clockString() {
    const m = Math.floor(this.timeMin) + 28 * 60 - this.dayLength; // the night always ends at 4:00 AM
    let h = Math.floor(m / 60) % 24, mm = m % 60;
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${h}:${mm.toString().padStart(2, '0')} ${ampm}`;
  }
  minutesLeft() { return Math.max(0, this.dayLength - this.timeMin); }
  goalMet() { return this.money >= this.quota; }

  // ------------------------------------------------------------- persistence
  save() {
    const now = performance.now();
    if (this._lastSave && now - this._lastSave < 1500) { this._dirty = true; return; }
    this._lastSave = now; this._dirty = false;
    const data = { v: 2, day: this.day, money: this.money, perks: this.perks, stats: this.stats, loan: this.loan, loanDue: this.loanDue, quota: this.quota, stake: this.stake, timeMin: this.timeMin, dayLength: this.dayLength, flags: this.flags, runSeed: this.runSeed, dayStartMoney: this.dayStartMoney, dayStats: this.dayStats };
    SDK.setItem('run', JSON.stringify(data));
  }
  flushSave() { this._lastSave = 0; this.save(); }
  loadRun() {
    try {
      const raw = SDK.getItem('run');
      if (!raw) return false;
      const d = JSON.parse(raw);
      if (!d || d.v !== 2 || !d.day) return false;
      Object.assign(this, { day: d.day, money: d.money, perks: d.perks || {}, stats: Object.assign(this.stats, d.stats || {}), loan: d.loan || 0, runSeed: d.runSeed || 1 });
      this.casino = casinoFor(this.day);
      const mrng = makeRng(this.runSeed + this.day * 101);
      this.modifier = this.day > 5 ? MODIFIERS[Math.floor(mrng() * MODIFIERS.length)] : null;
      this.quota = d.quota; this.stake = d.stake; this.timeMin = Math.min(d.timeMin || 0, (d.dayLength || 480) - 30); this.dayLength = d.dayLength || 480;
      this.flags = d.flags || { atmUsed: false }; this.loanDue = d.loanDue || 0; this.dayStartMoney = d.dayStartMoney || d.money;
      this.dayStats = d.dayStats || { won: 0, lost: 0, biggest: 0, hands: 0 };
      this.buffs = [];
      return true;
    } catch (e) { return false; }
  }
  clearRun() { SDK.removeItem('run'); }
  loadBest() { try { const b = JSON.parse(SDK.getItem('best') || 'null'); if (b) this.best = Object.assign(this.best, b); } catch (e) { /* ignore */ } }
  saveBest() {
    this.best.day = Math.max(this.best.day, this.day);
    this.best.money = Math.max(this.best.money, this.money);
    this.best.biggestWin = Math.max(this.best.biggestWin, this.stats.biggestWin);
    SDK.setItem('best', JSON.stringify(this.best));
  }
}

export const state = new GameState();
