// Drives the planner through slips, profiles and dates; reports anything that moves, scrolls or is cut.
import { chromium } from 'playwright-core';
const [out, width = '1440', height = '900'] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'msedge', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +width, height: +height }, deviceScaleFactor: 1 });
const problems = [];
page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
await page.goto('http://localhost:5700/#plan', { waitUntil: 'networkidle' });
await page.waitForTimeout(6000);
const boxes = () => page.evaluate(() => {
  const pick = ['.reqs', '.slipbar', '.slip-read', '.summary', '.site-chips', '.map', '.plan-data', '.cal-foot', '.top', '.foot'];
  const o = {};
  for (const sel of pick) { const el = document.querySelector(sel); if (el) { const r = el.getBoundingClientRect(); o[sel] = [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; } }
  o.scroll = [document.documentElement.scrollWidth - innerWidth, document.documentElement.scrollHeight - innerHeight];
  const s = document.querySelector('.summary');
  o.summaryOverflow = s.scrollHeight - s.clientHeight;
  o.clipped = [...document.querySelectorAll('.plan *')].filter((e) => e.children.length === 0 && e.textContent.trim() && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow !== 'visible').map((e) => `${e.className || e.tagName}: ${e.textContent.trim().slice(0, 50)}`);
  const r = document.querySelector('.reqs');
  o.reqsScroll = r.scrollHeight - r.clientHeight;
  return o;
});
const set = (patch) => page.evaluate((p) => window.__lwStore.set(p), patch);
const base = await boxes();
console.log('base', JSON.stringify(base));
const worst = {};
const seen = new Set();
let maxSummary = 0;
const profiles = await page.evaluate(() => [...document.querySelectorAll('.profile')].length);
for (let p = 0; p < profiles; p++) {
  await page.click(`.profile:nth-child(${p + 1})`);
  for (const slip of [0, 1, 3, 7, 12, 21, 30, 45, 60]) {
    await set({ slipDays: slip });
    await page.waitForTimeout(450);
    const b = await boxes();
    for (const k of Object.keys(base)) {
      if (!Array.isArray(base[k]) || k === 'clipped' || k === 'scroll') continue;
      const m = Math.max(...b[k].map((v, i) => Math.abs(v - base[k][i])));
      if (m > 1 && (!worst[k] || m > worst[k].m)) worst[k] = { m, was: base[k], now: b[k], at: { p, slip } };
    }
    for (const t of b.clipped) seen.add(t);
    maxSummary = Math.max(maxSummary, b.summaryOverflow);
    if (b.scroll[0] > 0 || b.scroll[1] > 0) problems.push(`page scrolls at profile ${p} slip ${slip}: ${b.scroll}`);
  }
}
console.log('moved', JSON.stringify(worst));
console.log('summary overflow', maxSummary, 'clipped:', [...seen].join(' | ') || 'none');
console.log(problems.slice(0, 8).join('\n') || 'no errors');
if (out) await page.screenshot({ path: out });
await browser.close();
