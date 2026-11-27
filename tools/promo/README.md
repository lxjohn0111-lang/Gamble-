# Promo videos and store covers

These scripts record the CrazyGames gameplay videos and cover art straight from the game, frame by frame.
They need the dev server (`npx vite --port 5173`) and the Playwright Chromium.

`vclock.js` is injected before the game loads and replaces the page clock (timers, `requestAnimationFrame`,
CSS/WAAPI animations). Time only moves when the capture script advances it, so every saved frame is exactly
1/30 s apart, however slowly the software renderer runs. `shots.js` holds the camera moves and scripted
outcomes for each shot (777 jackpot, roulette 32 red, derby long shot, Plinko 33x ball, Rocket Jelly 5x cash-out).

```bash
node tools/promo/capture.cjs 1920 1080 landscape /tmp/frames-l
```

```bash
node tools/promo/capture.cjs 1080 1920 portrait /tmp/frames-p
```

```bash
ffmpeg -framerate 30 -i /tmp/frames-l/f%05d.jpg -c:v libx264 -preset slow -crf 19 -maxrate 8M -bufsize 16M -pix_fmt yuv420p -movflags +faststart -an crazygames-upload/videos/Gamble-landscape-1920x1080.mp4
```

Add `PROBE=1` to `capture.cjs` to save only two frames per shot (a quick full-resolution framing check).
A comma-separated list of shot names works as the plan, e.g. `slot777,roulette`.

Covers: `cover-shot.cjs` poses three jelly patrons with the HUD hidden (`land`, `port` and `square` layouts),
and `covers.cjs` adds the logo:

```bash
node tools/promo/cover-shot.cjs 1920 1080 /tmp/cover-land land
```

```bash
node tools/promo/covers.cjs /tmp/cover-land-1.jpg 1920 1080 crazygames-upload/covers/Gamble-cover-1920x1080.jpg 22 21 205
```

`tools/test-sdk.cjs <url>` checks a build against a mock CrazyGames SDK: the SDK call order, that saves go
through `SDK.data` only, and that a reload restores the run.
