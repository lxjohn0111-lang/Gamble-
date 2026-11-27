// Verifies the single-file CrazyGames build against a mock CrazyGames SDK v3.
const { chromium } = require('playwright');
const MOCK = `
(() => {
  window.__cgLog = [];
  const log = (x) => window.__cgLog.push(x);
  const store = { get: (k) => localStorage.getItem('mockcg:' + k), set: (k, v) => { if (!localStorage.getItem('mockcg:__freeze')) localStorage.setItem('mockcg:' + k, v); }, rm: (k) => localStorage.removeItem('mockcg:' + k) };
  window.CrazyGames = { SDK: {
    environment: 'crazygames',
    init: async () => { log('init'); localStorage.removeItem('mockcg:__freeze'); },
    game: { loadingStart() { log('loadingStart'); }, loadingStop() { log('loadingStop'); }, gameplayStart() { log('gameplayStart'); }, gameplayStop() { log('gameplayStop'); }, happytime() { log('happytime'); },
      settings: { muteAudio: false, disableChat: false }, addSettingsChangeListener() { log('settingsListener'); } },
    ad: { requestAd(type, cb) { log('ad:' + type); cb.adStarted && cb.adStarted(); setTimeout(() => cb.adFinished && cb.adFinished(), 50); } },
    data: { getItem(k) { log('get:' + k); return store.get(k); }, setItem(k, v) { log('set:' + k); store.set(k, v); }, removeItem(k) { log('rm:' + k); store.rm(k); }, clear() {} },
  } };
})();`;
(async () => {
  const url = process.argv[2];
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.addInitScript(MOCK);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/TUNNEL|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__cgLog.includes('gameplayStart'), null, { timeout: 120000 });
  await page.waitForTimeout(2500);
  const first = await page.evaluate(() => ({
    log: [...new Set(window.__cgLog)],
    plainKeys: Object.keys(localStorage).filter((k) => k.startsWith('gamble_')),
    mockKeys: Object.keys(localStorage).filter((k) => k.startsWith('mockcg:')),
    hud: document.querySelector('.money span') && document.querySelector('.money span').textContent,
    day: document.querySelector('.day-tag') && document.querySelector('.day-tag').textContent,
  }));
  console.log('FIRST LOAD', JSON.stringify(first));
  // Edit the save inside the SDK data store, then reload: the game must resume from it.
  await page.evaluate(() => { const r = JSON.parse(localStorage.getItem('mockcg:gamble_run')); r.day = 2; r.money = 4321; r.quota = 2000; localStorage.setItem('mockcg:gamble_run', JSON.stringify(r)); localStorage.setItem('mockcg:__freeze', '1'); });
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__cgLog.includes('gameplayStart'), null, { timeout: 120000 });
  await page.waitForTimeout(3000);
  const second = await page.evaluate(() => ({ hud: document.querySelector('.money span').textContent, day: document.querySelector('.day-tag').textContent, plainKeys: Object.keys(localStorage).filter((k) => k.startsWith('gamble_')) }));
  console.log('AFTER RELOAD', JSON.stringify(second));
  await page.screenshot({ path: process.argv[3] });
  console.log('ERRORS', JSON.stringify(errors));
  await browser.close();
})();
