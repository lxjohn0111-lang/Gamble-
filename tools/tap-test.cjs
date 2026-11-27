// Tap 3D game equipment (roulette felt, mines tile) on a phone-sized touch screen and check the game registers it.
// node tools/tap-test.cjs   (needs the dev server on :5173)
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto('http://localhost:5173/?day=5', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__gamble && window.__gamble.director && window.__gamble.director.phase === 'play', null, { timeout: 180000 });
  const sit = (type) => page.evaluate((type) => {
    const D = window.__gamble.director, st = D.stations.find((s) => s.type === type && !(s.def && s.def.high));
    if (D.station) D.leaveStation(true);
    const p = st.interactWorld(); D.player.spawn(p.x, p.z, Math.atan2(-(st.worldPos().x - p.x), -(st.worldPos().z - p.z)));
    D.enterStation(st); window.__st = st;
  }, type);
  const settle = async () => { await page.waitForFunction(() => window.__gamble.director.player.mode === 'seat', null, { timeout: 60000 }); await page.evaluate(() => new Promise((r) => { let i = 0; const f = () => (++i >= 25 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); })); };
  const screenOf = (fn) => page.evaluate((src) => { const st = window.__st, G = window.__gamble; const p = eval(src)(st); const v = p.clone().project(G.camera); return [((v.x + 1) / 2) * innerWidth, ((1 - v.y) / 2) * innerHeight]; }, fn.toString());

  // roulette: tap the middle of the felt layout
  await sit('roulette'); await settle();
  const before = await page.evaluate(() => window.__st.totalBet ? window.__st.totalBet() : Object.keys(window.__st.bets || {}).length);
  const [rx, ry] = await screenOf((st) => { const b = st.betAt(-0.38 + 0.115 * 5.5, -0.36 + 0.12 * 1.5); const fy = st.group.worldToLocal(st.feltMesh.getWorldPosition(st.feltMesh.position.clone())).y; return st.w(b.x, fy, b.z); });
  await page.touchscreen.tap(rx, ry);
  await page.waitForTimeout(600);
  const after = await page.evaluate(() => window.__st.totalBet ? window.__st.totalBet() : Object.keys(window.__st.bets || {}).length);
  console.log(`roulette: tapped felt at (${rx | 0},${ry | 0}) bet ${before} -> ${after}`);

  // mines: start a round, then tap a 3D tile
  await sit('mines'); await settle();
  await page.evaluate(() => window.__st.start());
  await page.waitForTimeout(300);
  const [mx, my] = await screenOf((st) => st.tiles[12].mesh.getWorldPosition(st.tiles[12].mesh.position.clone()));
  const st0 = await page.evaluate(() => window.__st.tiles[12].state);
  await page.touchscreen.tap(mx, my);
  await page.waitForTimeout(800);
  const st1 = await page.evaluate(() => window.__st.tiles[12].state);
  console.log(`mines: tapped tile 12 at (${mx | 0},${my | 0}) state ${st0} -> ${st1}`);
  console.log(errs.length ? 'ERRORS ' + errs.join(' | ') : 'no page errors');
  await browser.close();
})();
