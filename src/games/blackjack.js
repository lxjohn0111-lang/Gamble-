import * as THREE from 'three';
import { Station, Card, Shoe, dealCard, flipCard, bjValue, chipStack, flyTo, RANKS } from './common.js';
import { halfMoonTable, curvedText, limitSign, cardShoe, discardTray, TABLE_TOP } from './tables.js';
import { audio } from '../engine/audio.js';
import { fmtMoney, wait, rand, TAU } from '../engine/util.js';

// ============================================================================
//  BLACKJACK — 6-deck shoe, 3:2 blackjack, dealer stands on all 17s,
//  double, split, Perfect Pairs side bet, NPC players, animated dealer.
// ============================================================================

const PP_PAY = { perfect: 25, colored: 12, mixed: 6 };

export class Blackjack extends Station {
  constructor(ctx, def) {
    super(ctx, def);
    this.label = def.high ? 'Play High-Limit Blackjack' : 'Play Blackjack';
    this.footprint = { w: 2.7, d: 1.6, ox: 0, oz: 0.0 };
    this.interactLocal = new THREE.Vector3(0, 0, 1.25);
    this.interactR = 1.5;
    this.camLocal = { pos: new THREE.Vector3(0, 1.3, 0.86), look: new THREE.Vector3(0, 0.76, -0.2) };
    this.shoe = new Shoe(6);
    this.bet = this.limits[0] * 2;
    this.pp = 0;
    this.phase = 'bet';
    this.cards = [];
    this.npcPlayers = new Map();
  }

  promptText() { return [this.label, `Blackjack pays 3:2 · ${fmtMoney(this.limits[0])}–${fmtMoney(this.limits[1])}`]; }

  build() {
    const theme = this.state.casino.theme;
    const table = halfMoonTable(theme, {
      feltDraw: (g, t) => {
        const [cx, cy] = t.toCanvas(0, t.back);
        const px = t.pxPerM;
        curvedText(g, 'BLACKJACK PAYS 3 TO 2', cx, cy, px * 0.92, Math.PI / 2, { font: `bold ${Math.round(px * 0.085)}px Georgia, serif`, color: '#ffd36a', inside: true });
        curvedText(g, 'Dealer must stand on all 17s', cx, cy, px * 0.82, Math.PI / 2, { font: `italic ${Math.round(px * 0.05)}px Georgia, serif`, color: 'rgba(255,255,255,0.85)', inside: true });
        curvedText(g, '— PERFECT PAIRS PAYS 25 TO 1 —', cx, cy, px * 0.42, Math.PI / 2, { font: `bold ${Math.round(px * 0.04)}px Georgia, serif`, color: 'rgba(255,255,255,0.6)', inside: true });
        g.strokeStyle = 'rgba(255,255,255,0.75)'; g.lineWidth = px * 0.006;
        for (const s of t.spots) {
          const [x, y] = t.toCanvas(s.x, s.z);
          g.beginPath(); g.arc(x, y, px * 0.075, 0, TAU); g.stroke();
          const [x2, y2] = t.toCanvas(s.x + Math.sin(s.th) * 0.0 - Math.cos(s.th) * 0.15, s.z + Math.sin(s.th) * 0.15);
          g.beginPath(); g.arc(x2, y2, px * 0.04, 0, TAU); g.stroke();
          g.fillStyle = 'rgba(255,255,255,0.7)'; g.font = `bold ${Math.round(px * 0.022)}px Georgia`; g.textAlign = 'center'; g.fillText('PAIRS', x2, y2 + px * 0.008);
        }
        // dealer card box
        const [dx, dy] = t.toCanvas(-0.2, t.back + 0.14);
        g.strokeStyle = 'rgba(255,211,106,0.6)'; g.strokeRect(dx, dy, px * 0.4, px * 0.15);
        g.fillStyle = 'rgba(255,255,255,0.12)'; g.font = `bold ${Math.round(px * 0.05)}px "Arial Black"`; g.fillText('♠ ♥ ♣ ♦', cx, cy + px * 0.6);
      },
    });
    this.table = table;
    const S = (this.static = table.staticGroup);
    S.position.copy(this.group.position); S.rotation.copy(this.group.rotation);
    this.ctx.director.world.staticRoot.add(S);
    const shoe = cardShoe(); shoe.position.set(0.85, TABLE_TOP, table.back + 0.25); shoe.rotation.y = -0.6; S.add(shoe);
    const tray = discardTray(); tray.position.set(-0.85, TABLE_TOP, table.back + 0.25); tray.rotation.y = 0.5; S.add(tray);
    const sign = limitSign(`${this.def.high ? 'HIGH LIMIT' : 'BLACKJACK'}\n${fmtMoney(this.limits[0])} - ${fmtMoney(this.limits[1])}`); sign.position.set(-0.6, TABLE_TOP, table.back + 0.05); S.add(sign);
    this.shoePos = new THREE.Vector3(0.82, TABLE_TOP + 0.12, table.back + 0.35);
    this.playerSpot = table.spots[2];
    this.spotZ = (s) => s.z;
    // NPC seats at the other spots
    table.seats.forEach((sp, i) => {
      if (i === 2) return;
      const seat = this.registerSeat(new THREE.Vector3(sp.x, 0, sp.z), sp.ry, { kind: 'table', seat: 0.72, action: 'cards', spot: i });
      seat.spotIndex = i;
    });
    this.watchSpot = (() => { const w = this.w(0, 0, 2.4); return { x: w.x, z: w.z, lx: this.group.position.x, lz: this.group.position.z, station: this }; })();
    this.chipsGroup = new THREE.Group(); this.group.add(this.chipsGroup);
    this.cardGroup = new THREE.Group(); this.group.add(this.cardGroup);
  }

  spawnStaff(crowd) {
    const p = this.w(0, 0, this.table.back - 0.42);
    this.dealer = crowd.staff('dealer', { x: p.x, z: p.z, ry: this.group.rotation.y }, (n, dt) => {
      if (!this.dealing) n.jelly.setAction(this.phase === 'bet' && this.active ? 'deal' : this.shuffling ? 'shuffle' : 'deal');
      const pl = crowd.player;
      n.jelly.lookTarget = this.focus || (pl && n.root.position.distanceToSquared(pl.pos) < 25 ? pl.camera.position : null);
    });
  }
  npcJoin(npc, seat) { this.npcPlayers.set(seat.spotIndex, { npc, seat }); }
  npcLeave(npc) { for (const [k, v] of this.npcPlayers) if (v.npc === npc) this.npcPlayers.delete(k); }

  // local spot position helpers
  cardPos(spot, i, hand = 0, handsCount = 1) {
    const s = this.table.spots[spot];
    const off = handsCount > 1 ? (hand === 0 ? -0.09 : 0.09) : 0;
    const ax = Math.cos(s.th), az = -Math.sin(s.th);
    const x = s.x + ax * (off + i * 0.028) - Math.sin(s.th) * (0.11 + i * 0.012);
    const z = s.z + az * (off + i * 0.028) - Math.cos(s.th) * (0.11 + i * 0.012);
    return this.w(x, TABLE_TOP + 0.001 + i * 0.0006, z);
  }
  dealerCardPos(i) { return this.w(-0.12 + i * 0.085, TABLE_TOP + 0.001 + i * 0.0006, this.table.back + 0.22); }
  betPos(spot, hand = 0, handsCount = 1) {
    const s = this.table.spots[spot];
    const off = handsCount > 1 ? (hand === 0 ? -0.09 : 0.09) : 0;
    return this.w(s.x + Math.cos(s.th) * off, TABLE_TOP, s.z - Math.sin(s.th) * off);
  }

  // ---------------------------------------------------------------- UI
  enter() {
    super.enter();
    const ui = this.ui;
    const p = (this.panel = ui.openPanel({ title: this.def.high ? 'High-Limit Blackjack' : 'Blackjack', limits: `${fmtMoney(this.limits[0])}–${fmtMoney(this.limits[1])} · BJ pays 3:2`, onLeave: () => this.ctx.director.leaveStation() }));
    this.betCtl = ui.betControl({ min: this.limits[0], max: this.limits[1], value: this.bet, getMoney: () => this.state.money, onChange: (v) => (this.bet = v) });
    p.body.append(this.betCtl.el);
    const row = document.createElement('div'); row.className = 'row';
    this.ppBtn = ui.button('Pairs side bet: OFF', 'dark small', () => { this.pp = this.pp ? 0 : 1; this.ppBtn.textContent = `Pairs side bet: ${this.pp ? 'ON (10%)' : 'OFF'}`; });
    this.dealBtn = ui.button('Deal', 'big green', () => this.deal(), 'Space', 'SPACE');
    this.hitBtn = ui.button('Hit', 'green', () => this.act('hit'), 'KeyH', 'H');
    this.standBtn = ui.button('Stand', 'red', () => this.act('stand'), 'KeyS', 'S');
    this.dblBtn = ui.button('Double', 'blue', () => this.act('double'), 'KeyD', 'D');
    this.splitBtn = ui.button('Split', 'dark', () => this.act('split'), 'KeyP', 'P');
    this.hintEl = document.createElement('span'); this.hintEl.className = 'tag';
    row.append(this.ppBtn, this.dealBtn, this.hitBtn, this.standBtn, this.dblBtn, this.splitBtn, this.hintEl);
    p.body.append(row);
    this.refreshButtons();
    p.msg('Place your bet and press DEAL.');
    if (this.dealer) this.dealer.say(['Welcome to the table!', 'Feeling lucky?', 'Place your bets!'][Math.floor(rand() * 3)]);
  }
  leave() { super.leave(); this.clearLabels(); }
  canLeave() { return this.phase === 'bet'; }

  refreshButtons() {
    if (!this.panel) return;
    const betting = this.phase === 'bet', playing = this.phase === 'player';
    this.dealBtn.style.display = betting ? '' : 'none';
    this.ppBtn.style.display = betting ? '' : 'none';
    this.betCtl.disable(!betting);
    for (const b of [this.hitBtn, this.standBtn, this.dblBtn, this.splitBtn]) b.style.display = playing ? '' : 'none';
    if (playing) {
      const h = this.hands[this.cur];
      this.dblBtn.disabled = !(h.cards.length === 2 && this.state.canAfford(h.bet));
      this.splitBtn.disabled = !(this.hands.length === 1 && h.cards.length === 2 && Math.min(10, h.cards[0].value) === Math.min(10, h.cards[1].value) && this.state.canAfford(h.bet));
    }
    this.updateHint();
  }

  updateHint() {
    if (!this.hintEl) return;
    if (!this.state.perks.monocle) { this.hintEl.style.display = 'none'; return; }
    this.hintEl.style.display = '';
    const tc = this.shoe.trueCount;
    let txt = `🧐 Count ${this.shoe.count >= 0 ? '+' : ''}${this.shoe.count} (true ${tc.toFixed(1)})`;
    if (this.phase === 'player') txt += ' · Best: ' + this.basicStrategy();
    else if (this.phase === 'bet') txt += tc >= 2 ? ' · Count is HOT — bet big!' : tc <= -1 ? ' · Count is cold — bet small' : '';
    this.hintEl.textContent = txt;
  }
  basicStrategy() {
    const h = this.hands[this.cur];
    const { total, soft } = bjValue(h.cards);
    const up = Math.min(10, this.dealerCards[0].value === 1 ? 11 : this.dealerCards[0].value);
    const canDbl = h.cards.length === 2;
    if (h.cards.length === 2 && this.hands.length === 1 && Math.min(10, h.cards[0].value) === Math.min(10, h.cards[1].value)) {
      const v = Math.min(10, h.cards[0].value);
      if (v === 1 || v === 8) return 'SPLIT';
      if ((v === 9 && ![7, 10, 11].includes(up)) || ((v === 2 || v === 3 || v === 7) && up <= 7) || (v === 6 && up <= 6)) return 'SPLIT';
    }
    if (soft) {
      if (total >= 19) return 'STAND';
      if (total === 18) return up >= 9 ? 'HIT' : canDbl && up >= 3 && up <= 6 ? 'DOUBLE' : 'STAND';
      if (canDbl && ((total >= 15 && up >= 4 && up <= 6) || (total >= 13 && up >= 5 && up <= 6))) return 'DOUBLE';
      return 'HIT';
    }
    if (total >= 17) return 'STAND';
    if (total >= 13) return up <= 6 ? 'STAND' : 'HIT';
    if (total === 12) return up >= 4 && up <= 6 ? 'STAND' : 'HIT';
    if (total === 11) return canDbl ? 'DOUBLE' : 'HIT';
    if (total === 10) return canDbl && up <= 9 ? 'DOUBLE' : 'HIT';
    if (total === 9) return canDbl && up >= 3 && up <= 6 ? 'DOUBLE' : 'HIT';
    return 'HIT';
  }

  // ---------------------------------------------------------------- round
  async dealerReach(worldPos, ms = 260) {
    if (!this.dealer) return;
    this.dealing = true;
    this.dealer.jelly.setAction(null);
    this.dealer.jelly.setReach(1, worldPos.clone().add(new THREE.Vector3(0, 0.05, 0)), 'pinch');
    await wait(ms);
    this.dealer.jelly.setReach(1, null);
    this.dealing = false;
  }
  async give(card, toWorld, faceUp, dur = 0.38) {
    this.dealing = true;
    if (this.dealer) this.dealer.jelly.setReach(1, this.shoePos, 'pinch');
    await wait(140);
    audio.play('card', { pos: this.worldPos() });
    if (this.dealer) this.dealer.jelly.setReach(1, toWorld.clone().add(new THREE.Vector3(0, 0.06, 0)), 'open');
    await dealCard(this.tweens, card, this.cardGroup, this.shoePos, toWorld, { faceUp, dur, rotY: this.group.rotation.y * 0 });
    if (this.dealer) this.dealer.jelly.setReach(1, null);
    this.dealing = false;
  }
  newCard(faceUp = true) {
    const [r, s] = this.shoe.draw();
    const c = new Card(r, s);
    c.obj.rotation.y = 0;
    this.cards.push(c);
    return c;
  }
  placeChips(amount, world, fromPlayer = true) {
    const st = chipStack(amount);
    this.chipsGroup.add(st);
    const from = fromPlayer ? this.w(0, TABLE_TOP + 0.1, 0.75) : this.w(0, TABLE_TOP + 0.05, this.table.back + 0.1);
    st.position.copy(this.chipsGroup.worldToLocal(from.clone()));
    audio.play('chip', { pos: world, count: 3 });
    flyTo(this.tweens, st, world, { dur: 0.4, arc: 0.1 });
    return st;
  }

  async deal() {
    if (this.phase !== 'bet') return;
    const ppAmt = this.pp ? Math.max(1, Math.round(this.bet * 0.1)) : 0;
    if (!this.state.canAfford(this.bet + ppAmt)) { this.ui.toast("You can't cover that bet.", 'bad'); audio.play('deny'); return; }
    this.takeBet(this.bet, 'blackjack');
    if (ppAmt) this.state.wager(ppAmt, 'blackjack');
    this.ppAmt = ppAmt;
    this.phase = 'deal';
    this.clearTable();
    this.refreshButtons();
    this.panel.msg('Dealing…');
    if (this.shoe.needsShuffle) await this.shuffleShoe();
    this.hands = [{ cards: [], bet: this.bet, spot: 2, done: false, doubled: false, chips: null }];
    this.hands[0].chips = this.placeChips(this.bet, this.betPos(2));
    if (ppAmt) this.ppChips = this.placeChips(ppAmt, this.w(this.table.spots[2].x - 0.15, TABLE_TOP, this.table.spots[2].z));
    // NPC players
    this.npcHands = [];
    for (const [spot, v] of this.npcPlayers) {
      const amt = this.limits[0] * (1 + Math.floor(rand() * 4));
      const h = { cards: [], bet: amt, spot, npc: v.npc, chips: this.placeChips(amt, this.betPos(spot), false) };
      this.npcHands.push(h);
    }
    const order = [...this.npcHands, this.hands[0]].sort((a, b) => b.spot - a.spot);
    this.dealerCards = [];
    await wait(450);
    for (let round = 0; round < 2; round++) {
      for (const h of order) { const c = this.newCard(); h.cards.push(c); await this.give(c, this.cardPos(h.spot, h.cards.length - 1), true); }
      const dc = this.newCard(); this.dealerCards.push(dc);
      await this.give(dc, this.dealerCardPos(round), round === 0);
    }
    this.updateLabels();
    // side bet
    if (ppAmt) this.settlePairs();
    // dealer peek for blackjack
    const up = this.dealerCards[0].value;
    const dealerBJ = bjValue(this.dealerCards).total === 21;
    const playerBJ = bjValue(this.hands[0].cards).total === 21;
    if ((up === 1 || Math.min(10, up) === 10) && dealerBJ) {
      this.panel.msg('Dealer checks…');
      await wait(600);
      await flipCard(this.tweens, this.dealerCards[1]);
      this.updateLabels();
      this.panel.msg('Dealer has BLACKJACK!', 'lose');
      if (this.dealer) this.dealer.jelly.setExpr('smug', 2);
      await wait(700);
      return this.settle();
    }
    if (playerBJ) {
      this.panel.msg('BLACKJACK!', 'win');
      audio.play('bell');
      this.hands[0].done = true;
      await wait(500);
      return this.dealerTurn();
    }
    this.cur = 0;
    this.phase = 'player';
    this.panel.msg('Hit or stand?');
    this.refreshButtons();
  }

  settlePairs() {
    const [a, b] = this.hands[0].cards;
    if (a.rank !== b.rank) { this.state.lost(this.ppAmt, 'blackjack'); this.ppChips && this.takeChipsAway(this.ppChips); return; }
    const red = (s) => s === '♥' || s === '♦';
    const kind = a.suit === b.suit ? 'perfect' : red(a.suit) === red(b.suit) ? 'colored' : 'mixed';
    const gross = this.ppAmt * (PP_PAY[kind] + 1);
    this.state.payout(gross, this.ppAmt, 'blackjack');
    this.ui.toast(`🃏 ${kind.toUpperCase()} PAIR! Side bet pays ${PP_PAY[kind]}:1 → ${fmtMoney(gross)}`, 'gold', 3500);
    this.celebrate(gross - this.ppAmt, this.ppAmt);
  }

  async act(a) {
    if (this.phase !== 'player' || this.acting) return;
    this.acting = true;
    const h = this.hands[this.cur];
    if (a === 'hit') {
      const c = this.newCard(); h.cards.push(c);
      await this.give(c, this.cardPos(h.spot, h.cards.length - 1, this.cur, this.hands.length), true);
      const v = bjValue(h.cards).total;
      this.updateLabels();
      if (v > 21) { audio.play('bust'); this.panel.msg('BUST!', 'lose'); this.ctx.director.flash(0.15, 0xff2030); h.done = true; await wait(500); await this.nextHand(); }
      else if (v === 21) { h.done = true; await wait(300); await this.nextHand(); }
    } else if (a === 'stand') {
      h.done = true; await this.nextHand();
    } else if (a === 'double') {
      if (h.cards.length !== 2 || !this.state.canAfford(h.bet)) { this.acting = false; return; }
      this.state.wager(h.bet, 'blackjack');
      h.chips.add(...chipStack(h.bet).children.map((c) => { c.position.y += 0.03; return c; }));
      h.bet *= 2; h.doubled = true;
      audio.play('chipStack');
      const c = this.newCard(); h.cards.push(c);
      await this.give(c, this.cardPos(h.spot, 2, this.cur, this.hands.length), true);
      c.obj.rotation.y = Math.PI / 2;
      this.updateLabels();
      if (bjValue(h.cards).total > 21) { audio.play('bust'); this.panel.msg('BUST!', 'lose'); }
      h.done = true; await wait(400); await this.nextHand();
    } else if (a === 'split') {
      if (!this.state.canAfford(h.bet)) { this.acting = false; return; }
      this.state.wager(h.bet, 'blackjack');
      const second = { cards: [h.cards.pop()], bet: h.bet, spot: 2, done: false, chips: null };
      this.hands.push(second);
      // re-layout
      const move = (card, hand, i) => this.tweens.add(0.3, (k) => card.obj.position.lerpVectors(card.obj.position.clone(), this.cardGroup.worldToLocal(this.cardPos(2, i, hand, 2)), k));
      move(h.cards[0], 0, 0); move(second.cards[0], 1, 0);
      flyTo(this.tweens, h.chips, this.betPos(2, 0, 2), { dur: 0.3, arc: 0.03 });
      second.chips = this.placeChips(h.bet, this.betPos(2, 1, 2));
      await wait(400);
      for (const [hi, hh] of this.hands.entries()) { const c = this.newCard(); hh.cards.push(c); await this.give(c, this.cardPos(2, 1, hi, 2), true); }
      this.updateLabels();
      // split aces get one card each
      if (h.cards[0].rank === 'A') { h.done = second.done = true; await this.nextHand(); }
    }
    this.acting = false;
    this.refreshButtons();
  }

  async nextHand() {
    while (this.cur < this.hands.length && this.hands[this.cur].done) this.cur++;
    if (this.cur < this.hands.length) { this.panel.msg(`Hand ${this.cur + 1}: hit or stand?`); this.refreshButtons(); return; }
    await this.dealerTurn();
  }

  async npcTurns() {
    for (const h of this.npcHands) {
      if (!h.npc || !h.npc.seat) continue;
      this.focus = h.npc.root.position.clone().add(new THREE.Vector3(0, 1.4, 0));
      h.npc.jelly.setAction('think');
      await wait(350);
      while (bjValue(h.cards).total < (rand() < 0.5 ? 17 : 16)) {
        const c = this.newCard(); h.cards.push(c);
        await this.give(c, this.cardPos(h.spot, h.cards.length - 1), true, 0.3);
      }
      h.npc.jelly.setAction('cards');
    }
    this.focus = null;
  }

  async dealerTurn() {
    this.phase = 'dealer';
    this.refreshButtons();
    if (this.npcHands.length) await this.npcTurns();
    this.panel.msg('Dealer reveals…');
    await this.dealerReach(this.dealerCardPos(1), 200);
    await flipCard(this.tweens, this.dealerCards[1]);
    this.updateLabels();
    await wait(450);
    const anyAlive = this.hands.some((h) => bjValue(h.cards).total <= 21 && !(h.cards.length === 2 && bjValue(h.cards).total === 21 && this.hands.length === 1)) || this.npcHands.some((h) => bjValue(h.cards).total <= 21);
    if (anyAlive) {
      while (bjValue(this.dealerCards).total < 17) {
        const c = this.newCard(); this.dealerCards.push(c);
        await this.give(c, this.dealerCardPos(this.dealerCards.length - 1), true);
        this.updateLabels();
        await wait(380);
      }
    }
    await this.settle();
  }

  async settle() {
    this.phase = 'settle';
    const d = bjValue(this.dealerCards).total;
    const dealerBJ = d === 21 && this.dealerCards.length === 2;
    let totalGross = 0, totalStake = 0;
    const lines = [];
    for (const h of this.hands) {
      const v = bjValue(h.cards).total;
      const bj = v === 21 && h.cards.length === 2 && this.hands.length === 1;
      let gross = 0;
      if (v > 21) gross = 0;
      else if (bj && !dealerBJ) gross = h.bet * 2.5;
      else if (dealerBJ && !bj) gross = 0;
      else if (d > 21 || v > d) gross = h.bet * 2;
      else if (v === d) gross = h.bet;
      totalGross += gross; totalStake += h.bet;
      h.result = gross > h.bet ? 'win' : gross === h.bet ? 'push' : 'lose';
      lines.push(bj && gross ? 'BLACKJACK!' : h.result === 'win' ? 'WIN' : h.result === 'push' ? 'PUSH' : v > 21 ? 'BUST' : 'LOSE');
      // chip animations
      if (gross > h.bet) { const pay = this.placeChips(gross - h.bet, this.betPos(2), false); await wait(250); this.sweepToPlayer([pay, h.chips]); }
      else if (gross === h.bet) this.sweepToPlayer([h.chips]);
      else this.takeChipsAway(h.chips);
    }
    // NPC hands
    for (const h of this.npcHands) {
      const v = bjValue(h.cards).total;
      const win = v <= 21 && (d > 21 || v > d);
      if (win) { const pay = this.placeChips(h.bet, this.betPos(h.spot), false); setTimeout(() => { this.takeChipsAway(pay, h.npc); this.takeChipsAway(h.chips, h.npc); }, 400); if (h.npc && rand() < 0.6) { h.npc.jelly.setAction('fistpump'); setTimeout(() => h.npc.jelly.action === 'fistpump' && h.npc.jelly.setAction('cards'), 1800); } }
      else { this.takeChipsAway(h.chips); if (h.npc && v > 21 && rand() < 0.5) { h.npc.jelly.setAction('facepalm'); setTimeout(() => h.npc.jelly.action === 'facepalm' && h.npc.jelly.setAction('cards'), 1600); } }
    }
    const profit = totalGross - totalStake;
    if (totalGross > 0) this.state.payout(totalGross, totalStake, 'blackjack');
    if (profit < 0 || totalGross === 0) this.state.lost(totalStake - totalGross, 'blackjack');
    this.panel.msg(`${lines.join(' / ')} ${profit > 0 ? '+' + fmtMoney(profit) : profit < 0 ? '-' + fmtMoney(-profit) : ''}`, profit > 0 ? 'win' : profit < 0 ? 'lose' : '');
    if (profit > 0) { this.celebrate(profit, totalStake); if (this.dealer) this.dealer.jelly.setExpr('shocked', 1.5); }
    else if (profit < 0) { audio.play('lose', { vol: 0.6 }); this.ctx.director.bigLoss(this.worldPos(), -profit); if (this.dealer) this.dealer.jelly.setExpr('smug', 1.5); }
    await wait(1600);
    this.collectCards();
    this.phase = 'bet';
    this.refreshButtons();
    this.panel && this.panel.msg('Place your bet and press DEAL.');
  }

  sweepToPlayer(stacks) {
    const to = this.w(0, TABLE_TOP + 0.3, 1.2);
    for (const st of stacks) if (st) { audio.play('chip', { count: 4 }); flyTo(this.tweens, st, to, { dur: 0.5, arc: 0.15, onDone: () => this.chipsGroup.remove(st) }); }
  }
  takeChipsAway(st, npc) {
    if (!st) return;
    const to = npc ? npc.root.position.clone().add(new THREE.Vector3(0, 0.9, 0)) : this.w(0, TABLE_TOP + 0.05, this.table.back + 0.1);
    if (!npc && this.dealer) { this.dealer.jelly.setReach(-1, st.getWorldPosition(new THREE.Vector3()), 'open'); setTimeout(() => this.dealer && this.dealer.jelly.setReach(-1, null), 450); }
    flyTo(this.tweens, st, to, { dur: 0.45, arc: 0.05, delay: 0.2, onDone: () => this.chipsGroup.remove(st) });
  }

  collectCards() {
    const to = this.w(-0.85, TABLE_TOP + 0.08, this.table.back + 0.25);
    for (const c of this.cards) {
      const local = this.cardGroup.worldToLocal(to.clone());
      const from = c.obj.position.clone();
      this.tweens.add(0.45, (k) => c.obj.position.lerpVectors(from, local, k), { onDone: () => { this.cardGroup.remove(c.obj); c.dispose(); } });
    }
    audio.play('shuffle', { pos: this.worldPos(), vol: 0.5 });
    this.cards = [];
    this.clearLabels();
  }
  clearTable() { for (const c of this.cards) { this.cardGroup.remove(c.obj); c.dispose(); } this.cards = []; this.chipsGroup.clear(); this.clearLabels(); }

  async shuffleShoe() {
    this.panel && this.panel.msg('Shuffling a fresh shoe…');
    this.shuffling = true;
    audio.play('shuffle', { pos: this.worldPos() });
    await wait(1400);
    this.shoe.reshuffle();
    this.shuffling = false;
  }

  // ---------------------------------------------------------------- labels
  updateLabels() {
    this.clearLabels();
    this.labels = [];
    const add = (cards, world, extra = '') => {
      const vis = cards.filter((c) => c.faceUp !== false);
      if (!vis.length) return;
      const { total, soft } = bjValue(vis);
      let cls = 'wlabel pill', txt = (soft && total < 21 ? `${total - 10}/${total}` : total) + extra;
      if (total > 21) { cls += ' bust'; txt = 'BUST ' + total; } else if (total === 21 && cards.length === 2) { cls += ' bj'; txt = 'BLACKJACK'; }
      const el = this.ui.worldLabel(txt, cls);
      this.labels.push({ el, world });
    };
    if (this.dealerCards) add(this.dealerCards.filter((c, i) => i === 0 || c.faceUp), this.w(0.0, TABLE_TOP + 0.14, this.table.back + 0.22));
    if (this.hands) this.hands.forEach((h, i) => add(h.cards, this.cardPos(2, 0, i, this.hands.length).add(new THREE.Vector3(0, 0.12, 0))));
  }
  clearLabels() { if (this.labels) for (const l of this.labels) l.el.remove(); this.labels = []; }

  update(dt, t, active) {
    if (this.labels && this.labels.length) {
      const cam = this.ctx.camera;
      for (const l of this.labels) {
        const v = l.world.clone().project(cam);
        this.ui.placeLabel(l.el, ((v.x + 1) / 2) * window.innerWidth, ((1 - v.y) / 2) * window.innerHeight, v.z < 1 && active);
      }
    }
    if (active && this.hintEl && this.phase === 'bet' && Math.floor(t * 2) !== this._ht) { this._ht = Math.floor(t * 2); this.updateHint(); }
  }
  dispose() { this.clearLabels(); }
}

export { RANKS };
