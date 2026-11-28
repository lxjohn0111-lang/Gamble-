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

The casino is player-friendly: every game pays back a little more than it takes on average. Slots, crash, mines,
Plinko, the wheel, the derby and scratch cards are tuned to about 102–105% RTP (slots verified by enumeration and simulation),
and every win's profit gets a +10% "house luck" bonus, which also lifts the classic table games (roulette, blackjack,
craps, baccarat, sic bo, video poker) above 100%. All difficulty knobs live in `src/game/balance.js`.

## Progression & addiction loop

* Night quota → pay Big Tony → keep the rest → **Madame Wobble's Charm Shop** (14 stackable lucky charms: Four-Leaf Clover, Card Counter's Monocle, Loaded Dice, Rabbit's Foot…).
* Bar drinks give timed luck buffs (and make the room wobble).
* Dropped chips sparkle on the carpet. Grab them.
* "Fingers" Fontaine, the loan shark, will always lend you money (50% interest, added to tomorrow's quota).
* Lose 4 bets in a row and **Lady Luck** steps in: wins pay +25% for 75 seconds. Hot streaks add up to +15% more.
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

## Mobile & responsive UI

The game picks a layout from the screen shape (`src/ui/ui.js`, `updateLayout`):

* **Desktop / tablet:** the game panel is docked at the bottom (max 44% of the height, scrolls if needed).
* **Phone in landscape:** the panel is a scrollable column on the right; the game view stays on the left.
* **Phone in portrait:** the panel is a bottom sheet (max half the screen); the game view stays on top.

Small screens also get a compact HUD, smaller chips and wrapping bet grids, and the main action button
(SPIN, DEAL...) is pinned so it never scrolls away. `src/engine/framing.js` moves the camera's view centre into
the part of the screen the panel leaves free and widens the view to fit, so the machine or table is always
visible next to the controls. Touch screens get a joystick, look pad, USE/RUN buttons and a pause button; they
hide while a menu or game panel is open. `tools/ui-audit.cjs` screenshots every game at any screen size and
checks that no buttons overlap; `tools/tap-test.cjs` taps the 3D roulette felt and a mines tile on a phone screen.

## Run & build

```bash
npm install
npm run dev               # local dev server
npm run build             # production build into dist/
npm run build:crazygames  # single-file build: crazygames-upload/index.html + Gamble-CrazyGames.zip
```

## CrazyGames upload kit (`crazygames-upload/`)

| File | Use |
|---|---|
| `Gamble-CrazyGames.zip` | Upload as the HTML5 game. It holds a single `index.html` with all code, styles and the SDK tag inlined. |
| `index.html` | The same file unzipped, for a quick local test. |
| `videos/Gamble-landscape-1920x1080.mp4` | Landscape gameplay video (16:9, 20 s, H.264, silent). |
| `videos/Gamble-portrait-1080x1920.mp4` | Portrait gameplay video (9:16, 20 s, H.264, silent). |
| `covers/Gamble-cover-1920x1080.jpg`, `-800x1200.jpg`, `-800x800.jpg` | Landscape, portrait and square covers. |
| `description.txt`, `controls.txt` | Store-page text. |

The videos and covers are recorded from the game itself with the scripts in `tools/promo/` (see its README).
`tools/test-sdk.cjs` checks a build against a mock CrazyGames SDK, including that progress is saved through `SDK.data`.
