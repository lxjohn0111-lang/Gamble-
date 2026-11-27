// Turns the Vite build in dist/ into self-contained single-file builds:
//   crazygames-upload/index.html            one file, everything inlined (+ CrazyGames SDK tag)
//   crazygames-upload/Gamble-CrazyGames.zip  contains ONLY that index.html (upload this)
//   build/gamble-artifact.html               same game without the SDK tag, for an artifact preview
// Usage: npm run build:crazygames
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const outDir = path.join(root, 'crazygames-upload');
const artifactOut = process.env.ARTIFACT_OUT || path.join(root, 'build', 'gamble-artifact.html');

const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
const scriptRe = /<script type="module" crossorigin src="\.\/(assets\/[^"]+\.js)"><\/script>\s*/;
const cssRe = /<link rel="stylesheet" crossorigin href="\.\/(assets\/[^"]+\.css)">\s*/;
const sm = html.match(scriptRe), cm = html.match(cssRe);
if (!sm || !cm) throw new Error('Could not find the built script/stylesheet tags in dist/index.html');
// "</script" inside the bundle would end the inline script early; escape it defensively.
const js = fs.readFileSync(path.join(dist, sm[1]), 'utf8').replace(/<\/script/gi, () => '<\\/script');
const css = fs.readFileSync(path.join(dist, cm[1]), 'utf8');

// ---------------------------------------------------------------- CrazyGames build
// Use function replacers: the minified bundle contains "$'" / "$`" sequences that a
// string replacement pattern would expand into copies of the surrounding page.
let single = html.replace(scriptRe, () => '').replace(cssRe, () => '');
single = single.replace('</head>', () => `  <style>${css}</style>\n</head>`);
single = single.replace('</body>', () => `  <script type="module">${js}</script>\n</body>`);
if (/src="\.\/assets\//.test(single) || /href="\.\/assets\//.test(single)) throw new Error('A relative asset reference survived inlining');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'index.html'), single);

// ---------------------------------------------------------------- zip with one file
const crcTable = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
function crc32(buf) { let c = -1; for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function zipSingle(name, data) {
  const nameBuf = Buffer.from(name, 'utf8');
  const comp = zlib.deflateRawSync(data, { level: 9 });
  const crc = crc32(data);
  const d = new Date();
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
  local.writeUInt16LE(time, 10); local.writeUInt16LE(date, 12); local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(8, 10);
  central.writeUInt16LE(time, 12); central.writeUInt16LE(date, 14); central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(comp.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt32LE((0o100644 << 16) >>> 0, 38); central.writeUInt32LE(0, 42);
  const cdOffset = local.length + nameBuf.length + comp.length;
  const cdSize = central.length + nameBuf.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(cdSize, 12); end.writeUInt32LE(cdOffset, 16);
  return Buffer.concat([local, nameBuf, comp, central, nameBuf, end]);
}
const zipPath = path.join(outDir, 'Gamble-CrazyGames.zip');
fs.writeFileSync(zipPath, zipSingle('index.html', Buffer.from(single, 'utf8')));

// ---------------------------------------------------------------- artifact page
// The artifact host wraps the page in its own <html>/<head>/<body>, so emit the
// content only, without the CrazyGames SDK (its host is not on the artifact allowlist).
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>')).trim();
const artifact = `<title>Gamble!</title>
<style>:root{color-scheme:dark}html,body{background:#0a0205;margin:0;height:100%;overflow:hidden}${css}</style>
${body}
<script type="module">${js}</script>
`;
fs.mkdirSync(path.dirname(artifactOut), { recursive: true });
fs.writeFileSync(artifactOut, artifact);

const kb = (n) => (n / 1024).toFixed(0) + ' KB';
console.log(`crazygames-upload/index.html       ${kb(single.length)}`);
console.log(`crazygames-upload/Gamble-CrazyGames.zip ${kb(fs.statSync(zipPath).size)}`);
console.log(`${path.relative(root, artifactOut)}  ${kb(artifact.length)}`);
