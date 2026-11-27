GAMBLE! - CRAZYGAMES UPLOAD KIT
===============================

What goes where in the CrazyGames developer portal:

  Gamble-CrazyGames.zip ......... Game files (HTML5). It holds ONE file: index.html.
                                  Everything (code, styles, 3D models, textures, sounds)
                                  is generated in code and inlined in it.
  index.html .................... The same file unzipped, for a quick local test
                                  (open it in Chrome). Saves fall back to
                                  localStorage when it runs outside CrazyGames.
  videos/Gamble-landscape-1920x1080.mp4 ... Landscape gameplay video (16:9)
  videos/Gamble-portrait-1080x1920.mp4 .... Portrait gameplay video (9:16)
  covers/Gamble-cover-1920x1080.jpg ....... Landscape cover (16:9)
  covers/Gamble-cover-800x1200.jpg ........ Portrait cover (2:3)
  covers/Gamble-cover-800x800.jpg ......... Square cover (1:1)
  description.txt ............... Short description + full description
  controls.txt .................. Controls text

Videos: H.264 MP4, 30 fps, about 20 seconds, no audio, recorded in-game.
Covers: JPEG. Check the sizes against the current CrazyGames requirements in
the portal before submitting.

SDK
---
index.html loads the CrazyGames HTML5 SDK v3
(https://sdk.crazygames.com/crazygames-sdk-v3.js). The game uses:
  - loadingStart / loadingStop, gameplayStart / gameplayStop
  - midgame ads between nights; rewarded ads (ATM cash, double stake, +1 hour)
  - happytime on jackpots and cleared nights
  - settings.muteAudio and audio muting during ads
  - data module (SDK.data) for ALL progress: current run, best night,
    settings and the tutorial flag. Saves happen as you play and when
    the tab is hidden or closed.

Suggested portal settings
-------------------------
  Category: Casino (or Simulation)      Orientation: Landscape
  Tags: casino, gambling, slots, blackjack, roulette, 3d, first person, funny, roguelite
  Devices: Desktop (mouse + keyboard). Touch controls exist but the game is built for desktop.

Rebuild
-------
  npm install
  npm run build:crazygames
This rewrites index.html and Gamble-CrazyGames.zip in this folder.
