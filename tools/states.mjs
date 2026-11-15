// Drives the running app through many states and reports layout shifts and clipped content.
import { chromium } from 'playwright-core';
const out = process.argv[2];
const browser = await chromium.launch({ channel: 'msedge', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: Number(process.argv[3] ?? 1440), height: Number(process.argv[4] ?? 900) }, deviceScaleFactor: 1 });
const problems = [];
page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
await page.goto('http://localhost:5700/', { waitUntil: 'networkidle' });
await page.waitForTimeout(9000);
const boxes = () => page.evaluate(() => {
  const pick = ['.hud-site', '.hud-data', '.hud-verdict', '.dock', '.dock-transport', '.dock-time', '.dock-events', '.where', '.hud-verdict h1', '.next-step', '.inst.sun', '.inst.earth', '.inst.sun .inst-nums', '.inst.earth .inst-nums', '.top'];
  const o = {};
  for (const sel of pick) { const el = document.querySelector(sel); if (el) { const r = el.getBoundingClientRect(); o[sel] = [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; } }
  o.scroll = [document.documentElement.scrollWidth - innerWidth, document.documentElement.scrollHeight - innerHeight];
  // text cut by its own box
  o.clipped = [...document.querySelectorAll('.hud *, .dock *, .top *, .foot *')].filter((e) => e.children.length === 0 && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow !== 'visible' && e.textContent.trim()).map((e) => `${e.className || e.tagName}: ${e.textContent.trim().slice(0, 50)}`);
  return o;
});
const set = (patch) => page.evaluate((p) => window.__lwStore.set(p), patch);
const base = await boxes();
console.log('base', JSON.stringify(base));
const H = 3600e3, D = 24 * H;
const t0 = Date.UTC(2027, 0, 17);
const cases = [];
for (const site of ['malapert', 'shackleton-rim', 'haworth', 'apollo-11', 'blue-ghost-1', 'change-6', 'im2-athena', 'cr1', 'chandrayaan-3']) for (const dt of [0, 3.4 * D, 9.1 * D, 15.7 * D, 22.3 * D, 200 * D]) cases.push({ siteId: site, timeMs: t0 + dt });
cases.push({ siteId: 'blue-ghost-1', timeMs: Date.UTC(2025, 2, 14, 8, 30) }); // eclipse
let worst = {};
let seen = new Set();
for (const c of cases) {
  await set(c).catch((e) => problems.push(String(e)));
  await page.waitForTimeout(350);
  const b = await boxes();
  for (const k of Object.keys(base)) {
    if (k === 'clipped' || k === 'scroll') continue;
    if (!b[k]) continue;
    const moved = b[k].map((v, i) => Math.abs(v - base[k][i]));
    const m = Math.max(...moved);
    if (m > 1 && (!worst[k] || m > worst[k].m)) worst[k] = { m, was: base[k], now: b[k], at: c };
  }
  for (const t of b.clipped) seen.add(t);
  if (b.scroll[0] > 0 || b.scroll[1] > 0) problems.push(`page scrolls at ${JSON.stringify(c)}: ${b.scroll}`);
}
console.log('moved', JSON.stringify(worst, null, 1));
console.log('clipped', [...seen].join('\n') || 'none');
console.log(problems.slice(0, 10).join('\n') || 'no errors');
if (out) await page.screenshot({ path: out });
await browser.close();
