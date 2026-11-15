// Development helper: the screens where the three colour roles show (Sun amber, Earth blue, problem red).
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

mkdirSync('video/colour', { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await page.goto('http://localhost:5700/?lang=pt#explore?site=malapert&t=2027-01-17T00:00', { waitUntil: 'load' });
await page.waitForFunction(() => !document.querySelector('.explore.is-arriving') && !document.getElementById('intro'), null, { timeout: 90000 }).catch(() => {});
await page.waitForTimeout(1500);
await page.screenshot({ path: 'video/colour/explore.png' });
await page.evaluate(() => window.__lwStore.set({ hero: 'panorama', timeMs: Date.UTC(2027, 0, 30) }));
await page.waitForTimeout(2500);
await page.screenshot({ path: 'video/colour/panorama.png' });
await page.evaluate(() => window.__lwStore.set({ tab: 'plan', slipDays: 21, detail: { siteId: 'malapert', dayMs: Date.UTC(2027, 1, 7) } }));
await page.waitForTimeout(6000);
await page.screenshot({ path: 'video/colour/plan.png' });
await browser.close();
