// Finds labels that break onto a second line, text cut by its box, and content wider than the window,
// on every screen and at several window sizes.   node tools/wraps.mjs
import { chromium } from 'playwright-core';

const SIZES = [
  [1920, 1080],
  [1440, 900],
  [1366, 768],
  [1280, 800],
  [820, 1180],
  [390, 844],
];
// SIZES=1440x900,390x844 node tools/wraps.mjs checks only those windows
if (process.env.SIZES) SIZES.splice(0, SIZES.length, ...process.env.SIZES.split(',').map((t) => t.split('x').map(Number)));
const VIEWS = [
  ['explore', '#explore?site=malapert&t=2027-01-17T00:00'],
  ['explore, replay', '#explore?site=blue-ghost-1&t=2025-03-14T08:30'],
  ['explore, long name', '#explore?site=chandrayaan-3&t=2023-08-23T12:33'],
  ['explore, custom', '#explore?site=custom&ll=-85,0&t=2027-01-17T00:00'],
  ['explore, panorama', '#explore?site=malapert&t=2027-01-17T00:00&view=panorama'],
  ['plan', '#plan?slip=21'],
  ['plan, detail', '#plan?slip=21&cell=cr1@2027-02-07'],
  ['compare', '#compare'],
  ['missions', '#missions'],
  ['accuracy', '#accuracy'],
];
// Things meant to be read as one line. (Table headings break where their text says; the place-and-moment
// line of Explore may take two lines on a phone.)
const LABELS =
  '.eyebrow, .field > span, .field > label, .btn, .seg button, .tab, .tag, .chip, .site-chip, .three-inset-title, .three-inset-note, .inst-head, .inst-state, .inst-row dt, .inst-row dd, .inst-row small, .inst-lens-note, .where, .next-step, .mission-title, .mission-board-cap, .score-key > *, .mission-map .eyebrow, .mission-spec-row > *, .cmp-site, .cmp-verdict, .cmp-num, .foot-short, .slip-value, .slip-date, .brand-name, .three-label, .stage-note span, .three-hint, .dock-cap > *, .events li > span, .req-label, .profile b, .mission-meta, .mission-n, .unit, .site-meta > *, .metric b, .cmp-date, .replay-item b, .replay-item i';

const browser = await chromium.launch({ channel: 'msedge', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
let total = 0;
for (const [w, h] of SIZES) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  // LANGUAGE=pt node tools/wraps.mjs checks the screens in another language
  if (process.env.LANGUAGE) await page.addInitScript((code) => localStorage.setItem('lunar-window-lang', code), process.env.LANGUAGE);
  for (const [name, hash] of VIEWS) {
    await page.goto(`http://localhost:5700/${hash}`, { waitUntil: 'networkidle' });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(name.startsWith('explore') ? 7000 : 3500);
    const found = await page.evaluate((labels) => {
      const out = [];
      const seen = (e) => {
        const r = e.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) return false;
        const s = getComputedStyle(e);
        if (s.visibility === 'hidden' || Number(s.opacity) === 0) return false;
        for (let p = e; p; p = p.parentElement) if (getComputedStyle(p).display === 'none') return false;
        return true;
      };
      const say = (e) => `${(e.className && String(e.className)) || e.tagName.toLowerCase()} "${e.textContent.trim().replace(/\s+/g, ' ').slice(0, 46)}"`;
      for (const e of document.querySelectorAll(labels)) {
        if (!e.textContent.trim() || !seen(e)) continue;
        const s = getComputedStyle(e);
        const line = s.lineHeight === 'normal' ? parseFloat(s.fontSize) * 1.25 : parseFloat(s.lineHeight);
        // the text itself, without the padding of its box
        const range = document.createRange();
        range.selectNodeContents(e);
        const rects = [...range.getClientRects()].filter((r) => r.width > 1);
        const tops = new Set(rects.map((r) => Math.round(r.top / (line * 0.6))));
        const mayWrap = e.classList.contains('where') && innerWidth < 1100;
        if (!mayWrap && tops.size > 1 && range.getBoundingClientRect().height > line * 1.6) out.push(`two lines: ${say(e)}`);
        if (e.scrollWidth > e.clientWidth + 1 && s.overflow !== 'visible' && s.textOverflow === 'ellipsis') out.push(`cut short: ${say(e)}`);
      }
      const de = document.documentElement;
      if (de.scrollWidth > innerWidth + 1) out.push(`page wider than the window by ${de.scrollWidth - innerWidth}px`);
      // anything sticking out of the window to the right
      for (const e of document.querySelectorAll('body *')) {
        if (!seen(e) || e.closest('.table-wrap, .cal-wrap, .tabs, canvas')) continue;
        const r = e.getBoundingClientRect();
        if (r.right > innerWidth + 2 && r.width < innerWidth && e.children.length === 0 && e.textContent.trim()) out.push(`beyond the right edge: ${say(e)}`);
      }
      return [...new Set(out)];
    }, LABELS);
    if (found.length) {
      total += found.length;
      console.log(`\n${w}x${h} · ${name}`);
      for (const f of found) console.log('  ' + f);
    }
  }
  await page.close();
}
console.log(`\n${total} findings`);
await browser.close();
