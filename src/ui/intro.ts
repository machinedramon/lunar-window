// The opening screen (its markup and styles are in index.html, so that it is there before any script).
// While the app loads, it says in a few lines what is about to be seen: the problem the tool answers. The lines
// go at reading pace, whatever the speed of the loading (the thin bar under the name shows the real progress);
// the last one is the question, and the opening lifts on it.
import { S } from '../i18n';

const el = document.getElementById('intro');
const bar = el?.querySelector<HTMLElement>('.intro-bar i') ?? null;
const stage = el?.querySelector<HTMLElement>('.intro-stage') ?? null;
let typedAt = 0;
let lifted = false;
/** The line on screen (-1: none yet) and the moment it could first be read. */
let shown = -1;
let shownAt = 0;
let pace = 0;
/** A line is on screen at least this long: time to read it. */
const READ_MS = 2300;
/** While the loading goes on, the next line comes after this long. */
const PACE_MS = 2900;
/** The question stays this long before the opening lifts. */
const LAST_MS = 1700;
/** One line fades out, the next fades in. */
const SWAP_MS = 240;
/** The name and the first line fade in once the typefaces are there. */
const FADE_IN_MS = 500;

function show(i: number): void {
  if (!stage || i === shown) return;
  const first = shown < 0;
  shown = i;
  shownAt = performance.now() + (first ? 0 : SWAP_MS);
  if (first) stage.textContent = S.opening[i];
  else {
    stage.classList.add('swap');
    window.setTimeout(() => {
      stage.textContent = S.opening[i];
      stage.classList.remove('swap');
    }, SWAP_MS);
  }
  follow();
}

/** The story goes on by itself while the app loads; the question, once reached, stays. */
function follow(): void {
  window.clearTimeout(pace);
  if (lifted || shown >= S.opening.length - 1) return;
  pace = window.setTimeout(() => show(shown + 1), Math.max(0, shownAt + PACE_MS - performance.now()));
}

/** The name and the lines come in once the typefaces are loaded: no letter changes shape on screen. */
export function introTyped(): void {
  if (!el || typedAt) return;
  typedAt = performance.now();
  el.classList.add('typed');
  // The first line was written before it could be seen: its time starts now.
  if (shown === 0 && !lifted) {
    shownAt = typedAt + FADE_IN_MS;
    follow();
  }
}

/** How far along the loading is, from 0 to 1. */
export function introStage(share: number): void {
  if (lifted) return;
  if (bar) bar.style.transform = `scaleX(${Math.max(0.04, Math.min(1, share)).toFixed(3)})`;
  if (shown < 0) show(0);
}

/**
 * Lifts the opening: the screen opens like a window, from the mark outwards. Never before the line on screen has
 * been read; and the last line, the question, is always seen. `then` runs as the window starts to open.
 */
export function introLift(then: () => void): void {
  if (lifted) return;
  lifted = true;
  window.clearTimeout(pace);
  if (bar) bar.style.transform = 'scaleX(1)';
  const now = performance.now();
  let wait = el ? Math.max(0, 1500 - now, typedAt ? typedAt + 800 - now : 0) : 0;
  if (el && stage && shown >= 0) {
    const last = S.opening.length - 1;
    // A line not yet seen (the typefaces are still coming) counts from now.
    const readable = typedAt ? shownAt : now + FADE_IN_MS;
    if (shown < last) {
      const swapAt = Math.max(0, readable + READ_MS - now);
      window.setTimeout(() => show(last), swapAt);
      wait = Math.max(wait, swapAt + SWAP_MS + LAST_MS);
    } else wait = Math.max(wait, readable + LAST_MS - now);
  }
  window.setTimeout(() => {
    then();
    el?.classList.add('out');
    window.setTimeout(() => el?.remove(), 1700);
  }, wait);
}
