// Development helper: frames per second of the 3D view in a few situations.   node tools/fps.mjs
import { chromium } from 'playwright-core';

const browser = await chromium.launch({ channel: 'msedge', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto('http://localhost:5700/#explore?site=malapert&t=2027-01-17T00:00', { waitUntil: 'networkidle' });
await page.waitForTimeout(16000);
const measure = (label, az, pitch, fov) =>
  page
    .evaluate(
      ([a, p, f]) =>
        new Promise((done) => {
          window.__lwQuality(1);
          window.__lwLook(a, p, f);
          let n = 0;
          let worst = 0;
          let last = 0;
          const t0 = performance.now();
          const step = (now) => {
            if (last) worst = Math.max(worst, now - last);
            last = now;
            n++;
            if (now - t0 < 3000) requestAnimationFrame(step);
            else done([Math.round((n / (now - t0)) * 1000), Math.round(worst), window.__lwScene().renderer.info.render.triangles]);
          };
          setTimeout(() => requestAnimationFrame(step), 800);
        }),
      [az, pitch, fov],
    )
    .then(([fps, worst, tris]) => console.log(`${label}: ${fps} frames per second, longest frame ${worst} ms, ${tris} triangles in the last pass`));
await measure('ground at the feet, away from the Sun', 215, -22, 55);
await measure('towards the vehicle', 350, -3, 46);
await measure('sky', 215, 40, 50);
await browser.close();
