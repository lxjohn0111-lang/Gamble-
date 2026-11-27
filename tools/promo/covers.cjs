// Compose a store cover: rendered key-art frame + "Gamble!" logo.
// node tools/promo/covers.cjs <frame.jpg> <width> <height> <out.jpg> <logoX%> <logoY%> <fontPx> [bgPosition]
const { chromium } = require('playwright');
const fs = require('fs');
const [img, W, H, out, lx, ly, size, bgPos] = [process.argv[2], +process.argv[3], +process.argv[4], process.argv[5], +process.argv[6], +process.argv[7], +process.argv[8], process.argv[9] || 'center'];
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const bg = 'data:image/jpeg;base64,' + fs.readFileSync(img).toString('base64');
  await page.setContent(`<!doctype html><html><head>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Lilita+One&display=block"><style>
    html,body{margin:0;background:#000}
    #c{width:${W}px;height:${H}px;position:relative;overflow:hidden;background:#000 url("${bg}") ${bgPos}/cover no-repeat}
    .vig{position:absolute;inset:0;background:radial-gradient(ellipse at 50% 55%, rgba(0,0,0,0) 45%, rgba(0,0,0,.45) 100%)}
    .back{position:absolute;left:${lx}%;top:${ly}%;width:${size * 5.6}px;height:${size * 2.1}px;transform:translate(-50%,-50%);
      background:radial-gradient(ellipse closest-side, rgba(30,4,10,.72), rgba(30,4,10,.38) 55%, rgba(30,4,10,0) 100%)}
    .logo{position:absolute;left:${lx}%;top:${ly}%;transform:translate(-50%,-50%) rotate(-4deg);white-space:nowrap;
      font-family:"Lilita One","Arial Black",Impact,sans-serif;font-weight:400;font-size:${size}px;line-height:1;color:#ffd36a;letter-spacing:2px;
      text-shadow:0 ${size * 0.05}px 0 #7a3a08, 0 ${size * 0.09}px 0 #4a2004, 0 0 ${size * 0.3}px rgba(255,170,50,.55), 0 ${size * 0.12}px ${size * 0.35}px rgba(0,0,0,.85);
      -webkit-text-stroke:${Math.max(2, size * 0.025)}px #4a1e02}
    .logo span{color:#ff4a7a;display:inline-block;transform:rotate(12deg) translateY(-${size * 0.06}px);-webkit-text-stroke-color:#5a0a1a}
  </style></head><body><div id="c"><div class="vig"></div><div class="back"></div><div class="logo">Gamble<span>!</span></div></div></body></html>`);
  await page.evaluate(() => document.fonts.ready);
  const fontOk = await page.evaluate(() => document.fonts.check('100px "Lilita One"'));
  if (!fontOk) console.log('warning: Lilita One did not load, using fallback font');
  await page.waitForTimeout(300);
  const box = await page.evaluate(() => { const r = document.querySelector('.logo').getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom].map(Math.round); });
  await page.screenshot({ path: out, type: 'jpeg', quality: 92 });
  await browser.close();
  console.log('wrote', out, 'logo box', box.join(','));
})();
