// Development helper: the top bar with the language list open, and the sound button in both states.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

mkdirSync('video/topbar', { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto('http://localhost:5700/#explore?site=malapert&t=2027-01-17T00:00', { waitUntil: 'networkidle' });
await page.waitForTimeout(10500);
const clip = { x: 880, y: 0, width: 560, height: 210 };
await page.click('.lang-btn');
await page.waitForTimeout(400);
await page.screenshot({ path: 'video/topbar/open.png', clip });
await page.click('.lang-menu button:nth-child(2)');
await page.waitForTimeout(600);
await page.click('.sound-btn');
await page.waitForTimeout(400);
await page.mouse.move(700, 500);
await page.screenshot({ path: 'video/topbar/pt-sound-on.png', clip });
await page.screenshot({ path: 'video/topbar/pt-full.png' });
await browser.close();
