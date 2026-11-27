// Clean key-art frames for the store covers (no HUD): three posed jelly patrons in the casino.
// node tools/promo/cover-shot.cjs <width> <height> <outPrefix> <layout: land|port|square>
const { chromium } = require('playwright');
const path = require('path');

const [W, H, out, layout] = [+process.argv[2], +process.argv[3], process.argv[4], process.argv[5] || 'land'];
const LAYOUTS = {
  // trio on the right two thirds, room for the logo on the left
  land: { cam: [0.15, 1.1, 6.9], look: [-0.95, 1.3, 2.6], fov: 56, spread: 1.2, z: 3.95 },
  // logo on top, trio filling the lower part
  port: { cam: [0.05, 1.05, 7.0], look: [0, 1.62, 2.6], fov: 60, spread: 0.92, z: 3.95 },
  square: { cam: [0.08, 1.08, 7.0], look: [0, 1.48, 2.6], fov: 56, spread: 1.05, z: 3.95 },
};
const L = LAYOUTS[layout];
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.log('pageerror:', e.message));
  await page.addInitScript({ path: path.join(__dirname, 'vclock.js') });
  await page.goto('http://localhost:5173/?day=3', { waitUntil: 'load' });
  for (let i = 0; i < 4000; i++) {
    try {
      if (await page.evaluate(() => !!(window.__gamble && window.__gamble.director && window.__gamble.director.phase === 'play'))) break;
      await page.evaluate(() => window.__vclock.advance(1000 / 30));
    } catch (e) { await new Promise((r) => setTimeout(r, 500)); }
  }
  await page.evaluate(async (L) => {
    const G = window.__gamble, D = G.director, THREE_V = G.camera.position.constructor;
    const J = await import('/src/characters/jelly.js');
    G.renderer.autoQuality = false; G.renderer.setQuality('high');
    G.ui.root.style.visibility = 'hidden';
    D.player.mode = 'frozen'; D.player.vm.visible = false;
    const crowd = D.crowd;
    const camPos = new THREE_V(...L.cam), look = new THREE_V(...L.look);
    // clear the stage area of wandering patrons
    for (const n of crowd.npcs) {
      if (n.seat || n.role !== 'patron') continue;
      const p = n.root.position;
      if (Math.abs(p.x) < 10 && p.z > -1.5 && p.z < 8) { p.set((Math.random() - 0.5) * 10, 0, -6.5 - Math.random() * 3); n.root.rotation.y = Math.random() * 6.28; n.path = null; }
      n.state = 'staff'; n.staffUpdate = null; // background patrons hold still for the photo
    }
    const outfit = (seed, patch) => {
      const o = J.randomOutfit(seed);
      Object.assign(o, patch);
      o.acc = (o.acc || []).filter((a) => !['shades', 'camera', 'cigar', 'fanny'].includes(a));
      return o;
    };
    const cast = [
      { x: 0, z: L.z, action: 'cheer', o: outfit(101, { color: J.JELLY_COLORS.orange, scale: 1.06, girth: 1.08, head: 1.08, eyeL: 0.078, eyeR: 0.07, cheeks: true,
        shirt: { type: 'hawaiian', base: '#1e7fc2', flowers: ['#ff5a7a', '#ffd23f', '#ffffff'], leaf: '#1f8a3b', motif: 'hibiscus', seed: 3, sleeves: 'short' },
        hat: { type: 'tophat', main: '#1a1a1a', band: '#c8102e', accent: '#e8c25a', tilt: -0.12 } }) },
      { x: -L.spread, z: L.z - 0.5, action: 'wave', o: outfit(202, { color: J.JELLY_COLORS.lime, scale: 0.98, eyeL: 0.072, eyeR: 0.072, cheeks: true,
        shirt: { type: 'hawaiian', base: '#ff7eb3', flowers: ['#ffffff', '#ff9f1c', '#2ec4b6'], leaf: '#0b6e4f', motif: 'pineapple', seed: 5, sleeves: 'short' },
        hat: { type: 'party', main: '#ffcc33', band: '#c8102e', accent: '#2a7de1', tilt: 0.15 } }) },
      { x: L.spread, z: L.z - 0.55, action: 'dance', o: outfit(303, { color: J.JELLY_COLORS.grape, scale: 1.0, eyeL: 0.07, eyeR: 0.058, cheeks: true,
        shirt: { type: 'hawaiian', base: '#ffcc33', flowers: ['#ff006e', '#ffbe0b', '#fb5607'], leaf: '#2d6a4f', motif: 'flamingo', seed: 9, sleeves: 'short' },
        hat: { type: 'viking', main: '#9aa3ad', band: '#7a4b26', accent: '#f4ecd8', tilt: 0.08 } }) },
    ];
    for (const c of cast) {
      const n = crowd.add('patron', c.o);
      n.state = 'staff'; n.staffUpdate = null;
      n.root.position.set(c.x, 0, c.z);
      n.root.rotation.y = Math.atan2(camPos.x - c.x, camPos.z - c.z);
      n.jelly.firstFrame = true;
      n.jelly.setAction(c.action);
      n.jelly.setExpr('ecstatic', 999);
    }
    G.camera.fov = L.fov; G.camera.updateProjectionMatrix();
    window.__coverCam = () => { G.camera.position.copy(camPos); G.camera.lookAt(look); };
  }, L);
  const step = () => page.evaluate(() => { window.__coverCam(); window.__vclock.advance(1000 / 30); });
  for (let i = 0; i < 30; i++) await step();
  for (let k = 0; k < 6; k++) {
    for (let i = 0; i < 3; i++) await step();
    await page.screenshot({ path: `${out}-${k}.jpg`, type: 'jpeg', quality: 95 });
    console.log('wrote', `${out}-${k}.jpg`);
  }
  await browser.close();
})();
