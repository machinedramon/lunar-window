// Canvas plumbing shared by the 2D drawings.

export interface Surface {
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
}

/** Sizes the backing store to the CSS width and a fixed CSS height, at the device pixel ratio. */
export function surface(canvas: HTMLCanvasElement, cssHeight: number): Surface {
  const dpr = Math.min(2.5, window.devicePixelRatio || 1);
  const w = Math.max(50, Math.round(canvas.clientWidth || canvas.parentElement?.clientWidth || 600));
  const bw = Math.round(w * dpr);
  const bh = Math.round(cssHeight * dpr);
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }
  canvas.style.height = `${cssHeight}px`;
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, cssHeight);
  return { ctx, w, h: cssHeight };
}

/** Calls `draw` now and whenever the element changes width. Returns a function that stops observing. */
export function onResize(el: Element, draw: () => void): () => void {
  let frame = 0;
  const ro = new ResizeObserver(() => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(draw);
  });
  ro.observe(el);
  return () => {
    cancelAnimationFrame(frame);
    ro.disconnect();
  };
}

export const COLORS = {
  sun: '#ffffff',
  sunDeep: '#d9d9dc',
  earth: '#7db8ff',
  earthDeep: '#2f6fd6',
  both: '#d7e7ff',
  ok: '#ffffff',
  warn: '#a9a9ae',
  bad: '#8f8f96',
  off: '#1d1d20',
  text: '#f6f6f6',
  text2: '#c6c6ca',
  muted: '#8f8f96',
  grid: 'rgba(255,255,255,0.07)',
  gridStrong: 'rgba(255,255,255,0.24)',
};

export const FONT = "'Inter Variable', system-ui, sans-serif";

export function mix(a: [number, number, number], b: [number, number, number], t: number): string {
  const k = Math.max(0, Math.min(1, t));
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * k)},${Math.round(a[1] + (b[1] - a[1]) * k)},${Math.round(a[2] + (b[2] - a[2]) * k)})`;
}
