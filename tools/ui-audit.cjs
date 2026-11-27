// UI audit: screenshots of roaming + every game panel + overlays at one viewport, plus an
// automatic overlap / off-screen check of all buttons and HUD blocks.
// node tools/ui-audit.cjs <W> <H> <outDir> [touch=1] [day=5] [only=type,type]   (needs the dev server on :5173)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const [W, H, outDir] = [+process.argv[2], +process.argv[3], process.argv[4]];
const touch = (process.argv[5] || '1') === '1';
const day = +(process.argv[6] || 5);
const only = process.argv[7] ? process.argv[7].split(',') : null;
const DPR = +(process.env.DPR || 1);

const CHECK = () => {
  const vw = innerWidth, vh = innerHeight;
  const vis = (e) => { const s = getComputedStyle(e); if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity === 0) return false; const r = e.getBoundingClientRect(); return r.width > 2 && r.height > 2 && (!e.offsetParent ? s.position === 'fixed' || e.closest('.hud,.touch-ui,.station-panel,.overlay') : true); };
  const name = (e) => (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).join('.') : e.tagName) + (e.textContent ? ` "${e.textContent.trim().slice(0, 18)}"` : '');
  const sel = '#ui button, #ui input, #ui .betcell, #ui .chip, #ui .tstick, #ui .tbtn, #ui .pausebtn, #ui .interactive, #ui .seg';
  const btns = [...document.querySelectorAll(sel)].filter(vis).filter((e) => !e.closest('.seg') || e.classList.contains('seg'));
  const blocks = [...document.querySelectorAll('#ui .money, #ui .quota, #ui .clock, #ui .day-tag, #ui .perkbar, #ui .buffs, #ui .station-panel, #ui .prompt.show, #ui .tstick, #ui .tbtn, #ui .pausebtn, #ui .hint')].filter(vis);
  const issues = [];
  const R = (e) => e.getBoundingClientRect();
  const inter = (a, b) => { const x = Math.min(a.right, b.right) - Math.max(a.left, b.left), y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top); return x > 1 && y > 1 ? x * y : 0; };
  // clipped content inside a scrollable overlay card is fine (it scrolls)
  const scrollParent = (e) => { for (let p = e.parentElement; p; p = p.parentElement) { const s = getComputedStyle(p); if (/(auto|scroll)/.test(s.overflowY + s.overflowX) && (p.scrollHeight > p.clientHeight + 1 || p.scrollWidth > p.clientWidth + 1)) return p; } return null; };
  for (let i = 0; i < btns.length; i++) {
    const a = R(btns[i]);
    if (!scrollParent(btns[i]) && (a.left < -1 || a.top < -1 || a.right > vw + 1 || a.bottom > vh + 1)) issues.push(`offscreen ${name(btns[i])} [${a.left | 0},${a.top | 0},${a.right | 0},${a.bottom | 0}]`);
    for (let j = i + 1; j < btns.length; j++) {
      if (btns[i].contains(btns[j]) || btns[j].contains(btns[i])) continue;
      const stickyI = btns[i].closest('.row') && getComputedStyle(btns[i].closest('.row')).position === 'sticky';
      const stickyJ = btns[j].closest('.row') && getComputedStyle(btns[j].closest('.row')).position === 'sticky';
      if (stickyI !== stickyJ && scrollParent(stickyI ? btns[j] : btns[i])) continue; // content scrolled under the pinned action bar
      const o = inter(a, R(btns[j]));
      if (o > 4) issues.push(`overlap ${name(btns[i])} x ${name(btns[j])} (${o | 0}px²)`);
    }
  }
  for (let i = 0; i < blocks.length; i++) for (let j = i + 1; j < blocks.length; j++) {
    if (blocks[i].contains(blocks[j]) || blocks[j].contains(blocks[i])) continue;
    const o = inter(R(blocks[i]), R(blocks[j]));
    if (o > 4) issues.push(`block-overlap ${name(blocks[i]).slice(0, 40)} x ${name(blocks[j]).slice(0, 40)} (${o | 0}px²)`);
  }
  const p = document.querySelector('#ui .station-panel');
  const cover = p && vis(p) ? (R(p).width * R(p).height) / (vw * vh) : 0;
  return { issues, panelCover: +cover.toFixed(2), nBtns: btns.length };
};

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DPR, hasTouch: touch, isMobile: touch });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/TUNNEL|Failed to load resource|crazygames/i.test(m.text())) errs.push(m.text()); });
  await page.goto(`http://localhost:5173/?day=${day}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__gamble && window.__gamble.director && window.__gamble.director.phase === 'play', null, { timeout: 180000 });
  await page.evaluate(() => { const G = window.__gamble; G.renderer.autoQuality = false; G.renderer.setQuality('low'); document.querySelectorAll('.intro,.toast').forEach((e) => e.remove()); });
  await page.waitForTimeout(800);
  const report = {};
  const frames = (n) => page.evaluate((n) => new Promise((r) => { let i = 0; const f = () => (++i >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
  const snap = async (n) => { await page.screenshot({ path: path.join(outDir, n + '.jpg'), type: 'jpeg', quality: 80, timeout: 180000 }); report[n] = await page.evaluate(CHECK); };
  await snap('00-roam');
  // prompt in front of a machine
  const list = await page.evaluate(() => {
    const D = window.__gamble.director, seen = new Set(), out = [];
    D.stations.forEach((s, i) => { const k = s.type + (s.video ? '-video' : '') + (s.def.high ? '-high' : ''); if (!seen.has(k)) { seen.add(k); out.push([k, i]); } });
    return out;
  });
  for (const [k, i] of list) {
    if (only && !only.some((o) => k.startsWith(o))) continue;
    await page.evaluate((i) => {
      const D = window.__gamble.director, st = D.stations[i];
      if (D.station) D.leaveStation(true);
      const seat = st.npcSeats && st.npcSeats.find((s) => s.kind !== 'table');
      if (seat && seat.taken && seat.taken.leaveSeat) seat.taken.leaveSeat();
      const p = st.interactWorld();
      const yaw = Math.atan2(-(st.worldPos().x - p.x), -(st.worldPos().z - p.z));
      D.player.spawn(p.x, p.z, yaw);
      D.enterStation(st);
      document.querySelectorAll('.toast').forEach((e) => e.remove());
    }, i);
    await page.waitForFunction(() => window.__gamble.director.player.mode === 'seat', null, { timeout: 60000 }).catch(() => {});
    await frames(18);
    await snap('st-' + k);
  }
  await page.evaluate(() => { const D = window.__gamble.director; if (D.station) D.leaveStation(true); });
  await page.waitForTimeout(400);
  await page.evaluate(() => { const D = window.__gamble.director; D.ui.closeOverlay(); D.paused = false; D.togglePause(); });
  await page.waitForTimeout(700);
  await snap('ov-pause');
  await page.evaluate(() => { const D = window.__gamble.director; D.resume(); D.openBar(); });
  await page.waitForTimeout(700);
  await snap('ov-bar');
  await page.evaluate(() => { const D = window.__gamble.director; D.ui.closeOverlay(); D.openShop(); });
  await page.waitForTimeout(900);
  await snap('ov-shop');
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 1));
  let total = 0;
  for (const [k, v] of Object.entries(report)) { total += v.issues.length; console.log(`${k}: cover=${v.panelCover} btns=${v.nBtns} issues=${v.issues.length}`); v.issues.slice(0, 8).forEach((s) => console.log('   ', s)); }
  console.log('TOTAL ISSUES', total);
  if (errs.length) console.log('ERRORS:\n' + errs.slice(0, 10).join('\n'));
  await browser.close();
})();
