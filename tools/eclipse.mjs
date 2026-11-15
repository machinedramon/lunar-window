// Development helper: the Sun coming out from behind the Earth through a long lens, to look for depth artefacts.
// Takes the same picture several times, each with one thing changed, and counts the bright pixels inside the
// Earth's disc (there should be none: the Earth is in front of the Sun).
//   node tools/eclipse.mjs
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

mkdirSync('video/eclipse', { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto('http://localhost:5700/#explore?site=blue-ghost-1&t=2025-03-14T08:58', { waitUntil: 'networkidle' });
await page.waitForTimeout(11000);
await page.addStyleTag({ content: '.hud, .stage-note, .stage-scrim, .dock, .top, .three-label, .three-controls, .three-hint, .three-tape, .three-sky { display: none !important; } .three { position: fixed !important; inset: 0 !important; z-index: 2000; }' });
const aim = () =>
  page.evaluate(() => {
    window.__lwFace('sun', 3.4, 0);
    const s = window.__lwScene();
    window.__lwLook(s.look.az - 2.3, s.look.pitch + 0.4, 3.4);
  });
await aim();
await page.waitForTimeout(1200);
console.log(await page.evaluate(() => {
  const s = window.__lwScene();
  return JSON.stringify(s.scene.children.map((c, i) => `${i}:${c.type}${c.name ? ':' + c.name : ''}${c.visible ? '' : ' (hidden)'} order ${c.renderOrder}`));
}));
const shoot = async (name) => {
  await page.waitForTimeout(500);
  await page.screenshot({ path: `video/eclipse/probe-${name}.png`, clip: { x: 1280, y: 300, width: 640, height: 480 } });
};
await shoot('0-as-is');
for (const [name, code] of Object.entries(JSON.parse(process.env.TRIES ?? '{}'))) {
  await page.evaluate((c) => {
    new Function('s', c)(window.__lwScene());
    window.__lwWake?.();
  }, code);
  await aim();
  await shoot(name);
}
await browser.close();
