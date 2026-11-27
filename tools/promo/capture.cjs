// Deterministic promo-video capture: node tools/promo/capture.cjs <width> <height> <plan> <outDir> [maxFrames]
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const [W, H] = [+process.argv[2], +process.argv[3]];
const plan = process.argv[4] || 'landscape';
const outDir = process.argv[5];
const maxFrames = +(process.argv[6] || 1e9);
const FPS = 30, DT = 1000 / FPS;
const PLANS = {
  landscape: ['entrance', 'statue', 'slot777', 'roulette', 'derby'],
  portrait: ['entrance', 'slot777', 'plinko', 'crash'],
  test: ['entrance'],
};

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.log('pageerror:', e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/TUNNEL|Failed to load resource/.test(m.text())) console.log('console:', m.text()); });
  await page.addInitScript({ path: path.join(__dirname, 'vclock.js') });
  await page.goto('http://localhost:5173/?day=3', { waitUntil: 'load' });
  const adv = () => page.evaluate((dt) => window.__vclock.advance(dt), DT);
  const t0 = Date.now();
  for (let i = 0; i < 4000; i++) {
    try {
      const ok = await page.evaluate(() => !!(window.__gamble && window.__gamble.director && window.__gamble.director.phase === 'play'));
      if (ok) break;
      await adv();
    } catch (e) { await new Promise((r) => setTimeout(r, 500)); } // dev-server reload during boot: keep waiting
  }
  console.log('loaded in', ((Date.now() - t0) / 1000).toFixed(1), 's');
  await page.addScriptTag({ path: path.join(__dirname, 'shots.js') });
  await page.evaluate((p) => window.__shots.init(p), H > W);
  for (let i = 0; i < 5; i++) await adv();
  let frame = 0, day = 3;
  const tStart = Date.now();
  for (const name of PLANS[plan] || plan.split(',')) {
    const info = await page.evaluate((n) => window.__shots.info(n), name);
    await page.evaluate(() => window.__shots.render(false));
    if (info.day !== day) {
      await page.evaluate((d) => window.__shots.load(d), info.day);
      for (let i = 0; i < 4000; i++) { if (await page.evaluate(() => window.__shots.loaded)) break; await adv(); }
      for (let i = 0; i < 10; i++) await adv();
      day = info.day;
    }
    await page.evaluate((n) => window.__shots.begin(n), name);
    for (let i = 0; i < Math.round(info.prep * FPS); i++) await page.evaluate((dt) => { window.__shots.step(-1); window.__vclock.advance(dt); }, DT);
    await page.evaluate(() => window.__shots.render(true));
    const n = Math.round(info.dur * FPS);
    // PROBE=1: only render + save two frames per shot (framing check at full resolution)
    const probes = process.env.PROBE ? [Math.floor(n * 0.4), Math.floor(n * 0.85)] : null;
    for (let i = 0; i < n && frame < maxFrames; i++) {
      const cap = !probes || probes.includes(i);
      if (probes) await page.evaluate((on) => window.__shots.render(on), cap);
      await page.evaluate(([t, dt]) => { window.__shots.step(t); window.__vclock.advance(dt); }, [i / FPS, DT]);
      if (!cap) continue;
      await page.screenshot({ path: path.join(outDir, `f${String(frame).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 93 });
      frame++;
      if (frame % 30 === 0) console.log(`${name}: frame ${frame} (${((Date.now() - tStart) / frame / 1000).toFixed(2)} s/frame)`);
    }
    await page.evaluate(() => window.__shots.render(false));
    for (let i = 0; i < Math.round(info.post * FPS); i++) await adv();
    console.log('shot done', name, 'total frames', frame);
  }
  await browser.close();
})();
