// Small DOM helpers.
type Child = Node | string | number | null | undefined | false;
type Props = Record<string, unknown>;

/** Creates an element. Props: `class`, `text`, `on<event>` handlers, `dataset`, anything else as an attribute. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Props | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') el.className = String(value);
      else if (key === 'text') el.textContent = String(value);
      else if (key === 'dataset') Object.assign(el.dataset, value as Record<string, string>);
      else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
      else if (value === true) el.setAttribute(key, '');
      else el.setAttribute(key, String(value));
    }
  }
  add(el, children);
  return el;
}

export function add(parent: Node, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    parent.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
  }
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

/** Sets the text only when it changed, so screen readers and layout are not disturbed needlessly. */
export function setText(el: Element, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

export const reducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
