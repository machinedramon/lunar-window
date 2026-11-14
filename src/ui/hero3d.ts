// The 3D view of Explore: stand on the landing site and look around.
import { MAST_HEIGHTS_M } from '../core/horizon';
import { S } from '../i18n/en';
import { FONT } from '../viz/canvas';
import type { LunarScene, SceneSky } from '../viz/scene3d';
import type { LoadedSite } from './data';
import { h, setText } from './dom';
import type { Moment } from './exploreModel';
import { compass, deg, pct } from './format';

const T = S.explore.three;

export interface Hero3D {
  el: HTMLElement;
  /** False once WebGL turned out to be unavailable. */
  ok(): boolean;
  setSite(loaded: LoadedSite, mast: number): void;
  setMoment(m: Moment, axes: { north: [number, number, number]; greenwich: [number, number, number] }): void;
  /** Aim the camera so that the Sun and the Earth are framed as well as possible. */
  frame(): void;
  redraw(): void;
  onFail: (() => void) | null;
}

export function createHero3D(): Hero3D {
  const canvas = h('canvas', { class: 'three-canvas', tabindex: '0', role: 'img', 'aria-label': T.aria });
  const tape = h('canvas', { class: 'three-tape', 'aria-hidden': 'true' });
  const sunLabel = h('div', { class: 'three-label sun', hidden: true });
  const earthLabel = h('div', { class: 'three-label earth', hidden: true });
  const caption = h('div', { class: 'three-caption' });
  const loading = h('div', { class: 'three-loading' }, h('div', { class: 'spinner' }), h('span', null, T.loading));
  const btn = (text: string, tip: string, fn: () => void) => h('button', { class: 'btn ghost three-btn', type: 'button', title: tip, onclick: fn }, text);
  const controls = h(
    'div',
    { class: 'three-controls' },
    btn(T.faceSun, T.faceSunTip, () => face('sun')),
    btn(T.faceEarth, T.faceEarthTip, () => face('earth')),
    btn('−', T.zoomOut, () => zoom(1.25)),
    btn('+', T.zoomIn, () => zoom(0.8)),
  );
  const inset = (cls: string, title: string) => {
    const note = h('span', { class: 'three-inset-note' });
    const frame = h('div', { class: `three-inset ${cls}` }, h('span', { class: 'three-inset-title' }, h('span', { class: `dot ${cls}` }), title), note);
    return { frame, note };
  };
  const sunInset = inset('sun', T.teleSun);
  const earthInset = inset('earth', T.teleEarth);
  const insets = h('div', { class: 'three-insets' }, sunInset.frame, earthInset.frame);
  const el = h('div', { class: 'three' }, canvas, tape, sunLabel, earthLabel, insets, caption, controls, loading, h('div', { class: 'three-hint' }, T.hint));

  let scene: LunarScene | null = null;
  let failed = false;
  let starting: Promise<void> | null = null;
  let site: LoadedSite | null = null;
  let mast = 1;
  let terrainKey = '';
  let pendingKey = '';
  let moment: Moment | null = null;
  let sky: SceneSky | null = null;
  let queued = 0;
  let framed = '';
  const api: Hero3D = { el, ok: () => !failed, setSite, setMoment, frame, redraw: request, onFail: null };

  function fail(err: unknown): void {
    console.warn('3D view unavailable:', err);
    failed = true;
    api.onFail?.();
  }

  function start(): Promise<void> {
    if (!starting) {
      starting = import('../viz/scene3d')
        .then(({ LunarScene }) => {
          scene = new LunarScene(canvas);
          scene.onChange = request;
          resize();
        })
        .catch(fail);
    }
    return starting;
  }

  function setSite(loaded: LoadedSite, m: number): void {
    site = loaded;
    mast = m;
    void start().then(loadTerrain);
  }

  async function loadTerrain(): Promise<void> {
    if (!scene || !site) return;
    const key = `${site.site.id}/${mast}`;
    if (key === terrainKey || key === pendingKey) return;
    pendingKey = key;
    const target = site;
    const targetMast = mast;
    let tiles: Int16Array | null = null;
    try {
      if (target.data) {
        loading.hidden = false;
        const res = await fetch(`${import.meta.env.BASE_URL}data/terrain/${target.site.id}.bin`);
        if (!res.ok) throw new Error(`terrain: HTTP ${res.status}`);
        tiles = new Int16Array(await res.arrayBuffer());
      }
    } catch (err) {
      console.warn(err);
    }
    if (pendingKey !== key || !scene) return;
    try {
      scene.setTerrain(tiles, target.data ? target.data.elevDeg[targetMast] : null, target.data ? target.data.distKm[targetMast] : null, target.data ? target.data.stepDeg : 1, MAST_HEIGHTS_M[targetMast]);
    } catch (err) {
      fail(err);
      return;
    }
    terrainKey = key;
    pendingKey = '';
    loading.hidden = true;
    setText(caption, target.data ? T.caption(String(Math.max(1.6, MAST_HEIGHTS_M[targetMast]))) : T.captionSphere);
    if (sky) scene.setSky(sky);
    if (framed !== target.site.id) {
      framed = target.site.id;
      frame();
    }
    request();
  }

  function setMoment(m: Moment, axes: { north: [number, number, number]; greenwich: [number, number, number] }): void {
    moment = m;
    sky = {
      sunAz: m.sun.az,
      sunEl: m.sun.el,
      sunRadius: m.sun.radius,
      sunFrac: m.sunFrac,
      eclipse: m.eclipse,
      earthAz: m.earth.az,
      earthEl: m.earth.el,
      earthRadius: m.earth.radius,
      earthNorth: axes.north,
      earthGreenwich: axes.greenwich,
    };
    if (scene && terrainKey) {
      scene.setSky(sky);
      request();
    }
  }

  const hFov = () => {
    if (!scene) return 80;
    const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
    return (2 * Math.atan(Math.tan((scene.look.fov * Math.PI) / 360) * aspect) * 180) / Math.PI;
  };

  function frame(): void {
    if (!scene || !moment) return;
    const m = moment;
    const dAz = ((m.earth.az - m.sun.az + 540) % 360) - 180;
    const sunUp = m.sun.el > -3;
    const earthUp = m.earth.el > -6;
    scene.look.fov = 46;
    const half = hFov() / 2;
    if (earthUp) {
      // The Earth in frame, lit ground in front of it; lean towards the Sun as far as the frame allows.
      const lean = sunUp ? Math.max(-half * 0.62, Math.min(half * 0.62, -dAz)) : 0;
      scene.look.az = (m.earth.az + lean * (Math.abs(dAz) < half * 1.5 ? 1 : 0.35) + 360) % 360;
      scene.look.pitch = Math.max(1, Math.min(30, m.earth.el * 0.45 + 1.5));
    } else {
      scene.look.az = m.sun.az;
      scene.look.pitch = Math.max(1.5, Math.min(40, m.sun.el + 3));
    }
    request();
  }

  function face(which: 'sun' | 'earth'): void {
    if (!scene || !moment) return;
    const v = which === 'sun' ? moment.sun : moment.earth;
    scene.look.az = v.az;
    scene.look.pitch = Math.max(-20, Math.min(70, v.el + (which === 'sun' ? 1.5 : 0)));
    request();
  }

  function zoom(factor: number): void {
    if (!scene) return;
    scene.look.fov = Math.max(8, Math.min(75, scene.look.fov * factor));
    request();
  }

  function resize(): void {
    if (!scene) return;
    const w = el.clientWidth;
    const ht = el.clientHeight;
    if (w < 10 || ht < 10) return;
    scene.resize(w, ht);
    request();
  }

  function request(): void {
    if (queued || !scene || !terrainKey) return;
    queued = requestAnimationFrame(() => {
      queued = 0;
      if (!scene || !el.isConnected || el.clientWidth < 10) return;
      try {
        scene.render(teleWindows());
      } catch (err) {
        fail(err);
        return;
      }
      overlay();
    });
  }

  /** Where the telephoto windows are, and where each lens points. A body well below the skyline gets no window. */
  function teleWindows(): { x: number; y: number; size: number; az: number; el: number; fov: number }[] {
    if (!moment || !site) return [];
    const box = canvas.getBoundingClientRect();
    const out: { x: number; y: number; size: number; az: number; el: number; fov: number }[] = [];
    const m = moment;
    const one = (frame: HTMLElement, note: HTMLElement, az: number, elv: number, radius: number, clear: number, fov: number, widest: number, text: string) => {
      const hiddenDeep = clear < -radius - 1.5;
      frame.classList.toggle('off', hiddenDeep);
      setText(note, hiddenDeep ? T.teleBelow : text);
      if (hiddenDeep) return;
      const r = frame.getBoundingClientRect();
      if (r.width < 20) return;
      // Widen the lens until the skyline under the body is in the window; beyond `widest`, show the body alone.
      const need = (Math.abs(clear) + radius * 2.2) * 2.1;
      const lens = need <= widest ? Math.max(fov, need) : fov;
      const aim = need <= widest ? elv - clear / 2 : elv;
      out.push({ x: Math.round(r.left - box.left) + 1, y: Math.round(r.top - box.top) + 1, size: Math.round(r.width) - 2, az, el: aim, fov: lens });
    };
    const sunClear = m.sun.el - site.horizon.at(m.sun.az, mast);
    one(sunInset.frame, sunInset.note, m.sun.az, m.sun.el, m.sun.radius, sunClear, 2.6, 12, T.teleSunNote(pct(m.sunFrac)));
    one(earthInset.frame, earthInset.note, m.earth.az, m.earth.el, m.earth.radius, m.earthClear, 5.0, 13, T.teleEarthNote(deg(m.earthClear, 1)));
    return out;
  }

  function place(label: HTMLElement, az: number, elv: number, text: string): void {
    const p = scene!.project(az, elv);
    if (!p || p.x < 0.02 || p.x > 0.98 || p.y < 0.08 || p.y > 0.94) {
      label.hidden = true;
      return;
    }
    label.hidden = false;
    setText(label, text);
    label.style.left = `${(p.x * 100).toFixed(2)}%`;
    label.style.top = `${(p.y * 100).toFixed(2)}%`;
  }

  function overlay(): void {
    if (!scene || !moment) return;
    const m = moment;
    place(sunLabel, m.sun.az, m.sun.el + m.sun.radius, m.eclipse > 0.5 ? T.sunEclipsed : m.sunFrac <= 0 ? T.sunHidden : T.sunLabel(pct(m.sunFrac)));
    place(earthLabel, m.earth.az, m.earth.el + m.earth.radius, m.earthClear > 0 ? T.earthLabel(deg(m.earthClear, 1)) : T.earthHidden);

    // Compass tape
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = el.clientWidth;
    const hgt = 30;
    if (tape.width !== Math.round(w * dpr)) {
      tape.width = Math.round(w * dpr);
      tape.height = Math.round(hgt * dpr);
    }
    const ctx = tape.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, hgt);
    const span = hFov();
    const names: Record<number, string> = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };
    const stepTick = span > 60 ? 10 : span > 25 ? 5 : 1;
    const from = Math.floor((scene.look.az - span / 2) / stepTick) * stepTick;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    for (let a = from; a <= scene.look.az + span / 2; a += stepTick) {
      // Rectilinear lens: screen position goes with the tangent of the angle.
      const off = Math.tan(((a - scene.look.az) * Math.PI) / 180) / Math.tan((span * Math.PI) / 360);
      if (Math.abs(off) > 1) continue;
      const x = (off * 0.5 + 0.5) * w;
      const norm = ((a % 360) + 360) % 360;
      const major = norm % (stepTick * (stepTick === 10 ? 3 : stepTick === 5 ? 2 : 5)) === 0 || names[norm] !== undefined;
      ctx.strokeStyle = major ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.35)';
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, major ? 9 : 5);
      ctx.stroke();
      if (major) {
        ctx.font = `${names[norm] ? 700 : 500} 11px ${FONT}`;
        ctx.fillStyle = names[norm] ? '#fff' : 'rgba(255,255,255,0.72)';
        ctx.fillText(names[norm] ?? `${norm}°`, x, 23);
      }
    }
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(w / 2 - 5, 0);
    ctx.lineTo(w / 2 + 5, 0);
    ctx.lineTo(w / 2, 6);
    ctx.closePath();
    ctx.fill();
    el.setAttribute('aria-description', T.looking(scene.look.az.toFixed(0), compass(scene.look.az)));
  }

  // ----- pointer, wheel and keyboard
  let drag: { x: number; y: number; id: number } | null = null;
  const pinch = new Map<number, { x: number; y: number }>();
  let pinchDist = 0;
  canvas.addEventListener('pointerdown', (ev) => {
    canvas.setPointerCapture(ev.pointerId);
    pinch.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (pinch.size === 1) drag = { x: ev.clientX, y: ev.clientY, id: ev.pointerId };
    else {
      drag = null;
      const [a, b] = [...pinch.values()];
      pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
    }
    el.classList.add('dragging');
  });
  canvas.addEventListener('pointermove', (ev) => {
    if (!scene || !pinch.has(ev.pointerId)) return;
    pinch.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (pinch.size >= 2) {
      const [a, b] = [...pinch.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchDist > 0) zoom(pinchDist / d);
      pinchDist = d;
      return;
    }
    if (!drag || drag.id !== ev.pointerId) return;
    const perPx = scene.look.fov / Math.max(1, canvas.clientHeight);
    scene.look.az = (scene.look.az - (ev.clientX - drag.x) * perPx + 360) % 360;
    scene.look.pitch = Math.max(-35, Math.min(80, scene.look.pitch + (ev.clientY - drag.y) * perPx));
    drag.x = ev.clientX;
    drag.y = ev.clientY;
    request();
  });
  const release = (ev: PointerEvent) => {
    pinch.delete(ev.pointerId);
    if (drag && drag.id === ev.pointerId) drag = null;
    if (!pinch.size) el.classList.remove('dragging');
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener(
    'wheel',
    (ev) => {
      ev.preventDefault();
      zoom(Math.exp(ev.deltaY * 0.0012));
    },
    { passive: false },
  );
  canvas.addEventListener('keydown', (ev) => {
    if (!scene) return;
    const stepDeg = scene.look.fov / 12;
    if (ev.key === 'ArrowLeft') scene.look.az = (scene.look.az - stepDeg + 360) % 360;
    else if (ev.key === 'ArrowRight') scene.look.az = (scene.look.az + stepDeg) % 360;
    else if (ev.key === 'ArrowUp') scene.look.pitch = Math.min(80, scene.look.pitch + stepDeg);
    else if (ev.key === 'ArrowDown') scene.look.pitch = Math.max(-35, scene.look.pitch - stepDeg);
    else if (ev.key === '+' || ev.key === '=') return zoom(0.85);
    else if (ev.key === '-') return zoom(1.18);
    else if (ev.key.toLowerCase() === 's') return face('sun');
    else if (ev.key.toLowerCase() === 'e') return face('earth');
    else return;
    ev.preventDefault();
    request();
  });
  canvas.addEventListener('webglcontextlost', (ev) => {
    ev.preventDefault();
    fail('context lost');
  });
  new ResizeObserver(resize).observe(el);
  if (import.meta.env.DEV) {
    // Lets the development screenshot tool aim the camera.
    (window as unknown as Record<string, unknown>).__lwLook = (az: number, pitch: number, fov: number) => {
      if (!scene) return;
      scene.look.az = az;
      scene.look.pitch = pitch;
      scene.look.fov = fov;
      request();
    };
  }

  return api;
}
