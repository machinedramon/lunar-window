// The opening screen (its markup and styles are in index.html, so that it is there before any script).
// The app reports the real stages of its loading here, and lifts the opening when the first view is whole.

const el = document.getElementById('intro');
const bar = el?.querySelector<HTMLElement>('.intro-bar i') ?? null;
const stage = el?.querySelector<HTMLElement>('.intro-stage') ?? null;
let typedAt = 0;
let lifted = false;

/** The name and the stages come in once the typefaces are loaded: no letter changes shape on screen. */
export function introTyped(): void {
  if (!el || typedAt) return;
  typedAt = performance.now();
  el.classList.add('typed');
}

/** A stage of the loading that has just begun, and how far along the whole it is (0 to 1). */
export function introStage(text: string, share: number): void {
  if (lifted) return;
  if (stage) stage.textContent = text;
  if (bar) bar.style.transform = `scaleX(${Math.max(0.04, Math.min(1, share)).toFixed(3)})`;
}

/**
 * Lifts the opening: the screen opens like a window, from the mark outwards. It is never a flash: the name stays
 * long enough to be read. `then` runs as the window starts to open.
 */
export function introLift(then: () => void): void {
  if (lifted) return;
  lifted = true;
  if (bar) bar.style.transform = 'scaleX(1)';
  const now = performance.now();
  const wait = el ? Math.max(0, 2200 - now, typedAt ? typedAt + 1300 - now : 0) : 0;
  window.setTimeout(() => {
    then();
    el?.classList.add('out');
    window.setTimeout(() => el?.remove(), 1700);
  }, wait);
}
