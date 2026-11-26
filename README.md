# Gamble!

A first-person **jelly casino roguelite** for the browser, built for **CrazyGames** (HTML5 SDK v3 integrated).

You owe Big Tony. Every night you wake up in a different casino with a stake in your pocket and one rule:
**make his quota before 4:00 AM**, then walk out through the EXIT. Fail and… well. Nobody likes washing Big Tony's limo.

The game drops you straight onto the casino floor after loading. Menus only appear between nights, on game over, or when you pause.

## The casinos (a new one every night)

| Night | Casino | New games & rooms |
|---|---|---|
| 1 | **The Lucky Horseshoe** (frontier saloon) | Classic slots, Blackjack, Wheel of Jelly, Scratch-O-Matic, Saloon bar |
| 2 | **Tiki Lagoon** | Video slots, Roulette, Plinko Tower, Jelly Pusher arcade, Tiki bar, aquariums |
| 3 | **The Grand Velvet Palace** | Craps (physics dice), Baccarat, Video Poker room, High-Limit room, fountain lobby, Lady Luck statue |
| 4 | **Neon Nebula** (retro space) | Rocket Jelly (crash), Jelly Mines, Sic Bo, arcade, Space Bar |
| 5 | **Château Fortuna** (Riviera) | The Jelly Derby horse race, Salon Privé, everything else |
| 6+ | Endless: casinos rotate with rising quotas and random **night modifiers** (Happy Hour, Full Moon, Gold Rush…) |

## 14 casino games

Slots (classic 3-reel with lever, and 5-reel / 9-line video slots with free spins, scatters, double-up and a progressive jackpot) ·
Blackjack (6-deck shoe, split, double, Perfect Pairs side bet, NPC players) · European Roulette (click the 3D felt: straights, splits, corners, outside bets) ·
Craps (cannon-es physics dice, Pass/Don't Pass, odds, Field, Place, Hardways, props) · Baccarat (third-card rules, card squeezes, bead road) ·
Video Poker (Jacks or Better 9/6, hold hints) · Wheel of Jelly (Big Six) · Scratch cards (scratch the foil with your mouse) · Plinko (3 risk levels) ·
Coin Pusher (custom disc physics, bonus gate, prizes) · Rocket Jelly (crash) · Jelly Mines · Sic Bo · Jelly Derby.

All games use real odds (house edges between ~1% and ~8%), and the slot paytables were verified by simulation (≈97% RTP).

## Progression & addiction loop

* Night quota → pay Big Tony → keep the rest → **Madame Wobble's Charm Shop** (14 stackable lucky charms: Four-Leaf Clover, Card Counter's Monocle, Loaded Dice, Rabbit's Foot…).
* Bar drinks give timed luck buffs (and make the room wobble).
* Dropped chips sparkle on the carpet. Grab them.
* "Fingers" Fontaine, the loan shark, will always lend you money (50% interest, added to tomorrow's quota).
* Big wins trigger banners, coin showers, and the whole crowd of jelly patrons turns around to cheer.

## Controls

* **WASD** move · **Mouse** look (click to capture) · **Shift** run · **E / click** interact
* **Esc** pause / leave a game · game buttons show their hotkeys (e.g. **Space** = spin/deal)
* Basic touch controls are included (joystick, look pad, USE button).

## CrazyGames SDK integration

`src/sdk.js` wraps the v3 SDK (`https://sdk.crazygames.com/crazygames-sdk-v3.js`, included in `index.html`):

* `loadingStart/loadingStop` around asset generation, `gameplayStart/gameplayStop` on play/pause/menus/ads
* **Midgame ads** at natural breaks (between nights, before a retry)
* **Rewarded ads**: ATM emergency cash, doubling Big Tony's nightly stake, bribing the doorman for +1 hour at closing time
* `happytime()` on jackpots and cleared nights
* Audio is muted during ads and follows the platform `muteAudio` setting
* Progress (current run, best night, settings) is saved through `SDK.data` (localStorage fallback when run standalone)

## Tech

Three.js r187 + cannon-es, bundled with Vite. **Zero asset files**: every texture (carpets, felt layouts, wood, marble, damask,
Hawaiian shirt prints, playing cards, slot symbols), every model (jelly people with googly-eye physics and IK rubber-hose limbs,
machines, tables, chandeliers, bottles) and every sound (SFX, crowd ambience and a generative lounge-jazz soundtrack per casino) is generated in code.
The whole production build is ~1.2 MB (~320 KB gzipped).

Rendering: ACES tone mapping, PBR materials with an environment probe captured from each casino interior, soft shadows, bloom,
light shafts, film grain/vignette grade, static mesh batching and instancing, distance LOD for the crowd, and automatic dynamic resolution
plus a Low/Medium/High quality setting in the pause menu.

## Run & build

```bash
npm install
npm run dev      # local dev server
npm run build    # production build into dist/
```

To publish on CrazyGames, upload the **contents of `dist/`** (`index.html` + `assets/`) as an HTML5 game. All paths are relative.
