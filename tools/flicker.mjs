// Records every frame the 3D view draws, one after the other, to see what changes while nothing is touched.
//   node tools/flicker.mjs [hash] [frames] [outDir] [x,y,w,h of the region, in page pixels]
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';

const hash = process.argv[2] ?? '';
const count = Number(process.argv[3] ?? 240);
const out = process.argv[4] ?? 'video/flicker';
const box = (process.argv[5] ?? '540,240,560,380').split(',').map(Number);
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await page.addInitScript(() => {
  window.__lwPreserve = true;
});
await page.goto(`http://localhost:5700/${hash}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(Number(process.env.WAIT ?? 10000));
const info = await page.evaluate(
  ([n, box]) =>
    new Promise((done) => {
      const gl = [...document.querySelectorAll('.three canvas')].find((c) => c.getContext('webgl2'));
      const r = gl.getBoundingClientRect();
      const roi = document.createElement('canvas');
      roi.width = box[2];
      roi.height = box[3];
      const ctx = roi.getContext('2d', { willReadFrequently: true });
      const small = document.createElement('canvas');
      small.width = 360;
      small.height = Math.round((360 * r.height) / r.width);
      const sctx = small.getContext('2d', { willReadFrequently: true });
      const store = (window.__frames = []);
      const meta = [];
      const step = () => {
        const k = gl.width / r.width;
        ctx.drawImage(gl, (box[0] - r.left) * k, (box[1] - r.top) * k, box[2] * k, box[3] * k, 0, 0, box[2], box[3]);
        sctx.drawImage(gl, 0, 0, small.width, small.height);
        store.push([ctx.getImageData(0, 0, box[2], box[3]), sctx.getImageData(0, 0, small.width, small.height)]);
        meta.push([Math.round(performance.now()), gl.width]);
        if (store.length < n) requestAnimationFrame(step);
        else done({ meta, small: [small.width, small.height] });
      };
      requestAnimationFrame(step);
    }),
  [count, box],
);
for (let i = 0; i < count; i++) {
  const [a, b] = await page.evaluate((i) => {
    const png = (img) => {
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      c.getContext('2d').putImageData(img, 0, 0);
      return c.toDataURL('image/png').split(',')[1];
    };
    return window.__frames[i].map(png);
  }, i);
  writeFileSync(`${out}/r${String(i).padStart(3, '0')}.png`, Buffer.from(a, 'base64'));
  writeFileSync(`${out}/s${String(i).padStart(3, '0')}.png`, Buffer.from(b, 'base64'));
}
writeFileSync(`${out}/meta.json`, JSON.stringify(info));
const t = info.meta.map((m) => m[0]);
console.log(`${count} frames in ${t[t.length - 1] - t[0]} ms; canvas widths seen: ${[...new Set(info.meta.map((m) => m[1]))].join(', ')}`);
await browser.close();
