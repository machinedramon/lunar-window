// The 3D view of Explore: stand on the landing site and look around.
// Camera work is deliberate: every move eases in and out, a site opens with an arrival shot and
// a title card, and the view never sits completely still.
import { MAST_HEIGHTS_M } from '../core/horizon';
import { S } from '../i18n/en';
import { FONT } from '../viz/canvas';
import type { LunarScene, SceneSky } from '../viz/scene3d';
import type { LoadedSite } from './data';
import { h, reducedMotion, setText } from './dom';
import type { Moment } from './exploreModel';
import { compass, deg, latLon, pct } from './format';

const T = S.explore.three;

export interface Hero3D {
  el: HTMLElement;
  /** False once WebGL turned out to be unavailable. */
  ok(): boolean;
  setSite(loaded: LoadedSite, mast: number): void;
  setMoment(m: Moment, axes: { north: [number, number, number]; greenwich: [number, number, number] }, stars: SceneSky['starAxes'], when: string): void;
  redraw(): void;
  onFail: (() => void) | null;
}

interface Look {
  az: number;
  pitch: number;
  fov: number;
}

const shortest = (from: number, to: number): number => ((to - from + 540) % 360) - 180;

export function createHero3D(): Hero3D {
  const canvas = h('canvas', { class: 'three-canvas', tabindex: '0', role: 'img', 'aria-label': T.aria });
  const tape = h('canvas', { class: 'three-tape', 'aria-hidden': 'true' });
  const sunLabel = h('div', { class: 'three-label sun', hidden: true });
  const earthLabel = h('div', { class: 'three-label earth', hidden: true });
  const caption = h('div', { class: 'three-caption' });
  const loading = h('div', { class: 'three-loading' }, h('div', { class: 'spinner' }), h('span', null, T.loading));
  const fade = h('div', { class: 'three-fade' });
  const titleName = h('div', { class: 'three-title-name' });
  const titleSub = h('div', { class: 'three-title-sub' });
  const title = h('div', { class: 'three-title', 'aria-hidden': 'true' }, titleName, titleSub);
  const btn = (text: string, tip: string, fn: () => void) => h('button', { class: 'btn ghost three-btn', type: 'button', title: tip, onclick: fn }, text);
  const controls = h(
    'div',
    { class: 'three-controls' },
    btn(T.faceSun, T.faceSunTip, () => face('sun')),
    btn(T.faceEarth, T.faceEarthTip, () => face('earth')),
    btn('−', T.zoomOut, () => zoom(1.25)),
    btn('+', T.zoomIn, () => zoom(0.8)),
  );
  const inset = (cls: string, text: string) => {
    const note = h('span', { class: 'three-inset-note' });
    const frame = h('div', { class: `three-inset ${cls}` }, h('span', { class: 'three-inset-title' }, h('span', { class: `dot ${cls}` }), text), note);
    return { frame, note };
  };
  const sunInset = inset('sun', T.teleSun);
  const earthInset = inset('earth', T.teleEarth);
  const insets = h('div', { class: 'three-insets' }, sunInset.frame, earthInset.frame);
  const el = h('div', { class: 'three' }, canvas, tape, sunLabel, earthLabel, insets, caption, controls, title, fade, loading, h('div', { class: 'three-hint' }, T.hint));

  let scene: LunarScene | null = null;
  let failed = false;
  let starting: Promise<void> | null = null;
  let site: LoadedSite | null = null;
  let mast = 1;
  let terrainKey = '';
  let pendingKey = '';
  let moment: Moment | null = null;
  let sky: SceneSky | null = null;
  let when = '';
  let framed = '';
  let vehicleAz = 0;
  let visible = true;
  let running = 0;
  let last = 0;
  let idleSince = 0;
  let arriving = 0;
  let slow = 0.016;
  let frames = 0;
  const target: Look = { az: 0, pitch: 4, fov: 46 };
  const api: Hero3D = { el, ok: () => !failed, setSite, setMoment, redraw: wake, onFail: null };

  function fail(err: unknown): void {
    console.warn('3D view unavailable:', err);
    failed = true;
    cancelAnimationFrame(running);
    running = 0;
    api.onFail?.();
  }

  function start(): Promise<void> {
    if (!starting) {
      starting = import('../viz/scene3d')
        .then(({ LunarScene }) => {
          scene = new LunarScene(canvas);
          scene.onChange = wake;
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
    const target0 = site;
    const targetMast = mast;
    const newSite = framed !== target0.site.id;
    if (newSite && terrainKey) fade.classList.add('on'); // dip to black between sites
    let tiles: Int16Array | null = null;
    try {
      if (target0.data) {
        if (!terrainKey) loading.hidden = false;
        const res = await fetch(`${import.meta.env.BASE_URL}data/terrain/${target0.site.id}.bin`);
        if (!res.ok) throw new Error(`terrain: HTTP ${res.status}`);
        tiles = new Int16Array(await res.arrayBuffer());
      }
    } catch (err) {
      console.warn(err);
    }
    if (pendingKey !== key || !scene) return;
    const fine = target0.site.horizon === 'lola-5m-80m-240m';
    try {
      scene.setTerrain(tiles, fine, target0.data ? target0.data.elevDeg[targetMast] : null, target0.data ? target0.data.distKm[targetMast] : null, target0.data ? target0.data.stepDeg : 1, MAST_HEIGHTS_M[targetMast]);
    } catch (err) {
      fail(err);
      return;
    }
    terrainKey = key;
    pendingKey = '';
    loading.hidden = true;
    const eye = String(Math.max(1.6, MAST_HEIGHTS_M[targetMast]));
    setText(caption, !target0.data ? T.captionSphere : fine ? T.captionFine(eye) : T.caption(eye));
    if (sky) scene.setSky(sky);
    if (newSite) {
      framed = target0.site.id;
      frame();
      vehicleAz = (target.az - 15 + 360) % 360;
      arrive(target0);
    }
    // Rocks, vehicle and mast: the same arrangement every time for a given site.
    let seed = 7;
    for (const ch of target0.site.id) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
    // NASA's concept rover and our solar mast where a mission is still to come; the Lunar Module at the Apollo
    // sites; only the mast where a real robotic lander stood on real terrain; nothing at the other real sites.
    const s0 = target0.site;
    const kind = s0.category === 'apollo' ? 'apollo' : s0.status === 'candidate' || s0.status === 'planned' ? 'rover' : s0.horizon !== 'sphere' ? 'mast' : 'none';
    void scene.setProps(key, seed, vehicleAz, kind, MAST_HEIGHTS_M[targetMast]);
    wake();
  }

  /** Arrival shot: from the ground at one's feet up to the sky, with the name of the place. */
  function arrive(s: LoadedSite): void {
    if (!scene) return;
    setText(titleName, s.site.name);
    setText(titleSub, `${latLon(s.site.lat, s.site.lon)}${when ? ` · ${when}` : ''}`);
    fade.classList.remove('on');
    if (reducedMotion()) {
      Object.assign(scene.look, target);
      return;
    }
    scene.look.az = (target.az - 22 + 360) % 360;
    scene.look.pitch = -24;
    scene.look.fov = Math.min(62, target.fov + 14);
    arriving = performance.now();
    title.classList.remove('show');
    void title.offsetWidth; // restart the animation
    title.classList.add('show');
  }

  function setMoment(m: Moment, axes: { north: [number, number, number]; greenwich: [number, number, number] }, stars: SceneSky['starAxes'], text: string): void {
    moment = m;
    when = text;
    sky = {
      sunAz: m.sun.az,
      sunEl: m.sun.el,
      sunRadius: m.sun.radius,
      sunFrac: m.sunFrac,
      eclipse: m.eclipse,
      linked: m.earthClear > 0,
      earthAz: m.earth.az,
      earthEl: m.earth.el,
      earthRadius: m.earth.radius,
      earthNorth: axes.north,
      earthGreenwich: axes.greenwich,
      starAxes: stars,
    };
    if (scene && terrainKey) scene.setSky(sky);
    wake();
  }

  const hFov = (fov = target.fov) => {
    const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
    return (2 * Math.atan(Math.tan((fov * Math.PI) / 360) * aspect) * 180) / Math.PI;
  };

  /** Default framing: the Earth in frame over lit ground, leaning towards the Sun as far as the frame allows. */
  function frame(): void {
    if (!moment) return;
    const m = moment;
    const dAz = shortest(m.sun.az, m.earth.az);
    const sunUp = m.sun.el > -3;
    const earthUp = m.earth.el > -6;
    target.fov = 46;
    const half = hFov() / 2;
    if (earthUp && m.earth.el < 22) {
      const lean = sunUp ? Math.max(-half * 0.62, Math.min(half * 0.62, -dAz)) : 0;
      target.az = (m.earth.az + lean * (Math.abs(dAz) < half * 1.5 ? 1 : 0.35) + 360) % 360;
      target.pitch = Math.max(1, Math.min(30, m.earth.el * 0.45 + 1.5));
    } else if (sunUp && m.sun.el > 6) {
      // Away from the poles the Sun and the Earth ride high: frame the ground instead, lit from the side.
      target.az = (m.sun.az + 115) % 360;
      target.pitch = 3;
    } else {
      target.az = m.sun.az;
      target.pitch = Math.max(1.5, Math.min(40, m.sun.el + 3));
    }
    touch();
  }

  function face(which: 'sun' | 'earth'): void {
    if (!moment) return;
    const v = which === 'sun' ? moment.sun : moment.earth;
    target.az = v.az;
    target.pitch = Math.max(-20, Math.min(70, v.el + (which === 'sun' ? 1.5 : 0)));
    touch();
  }

  function zoom(factor: number): void {
    target.fov = Math.max(8, Math.min(75, target.fov * factor));
    touch();
  }

  function touch(): void {
    idleSince = performance.now();
    arriving = 0;
    wake();
  }

  function resize(): void {
    if (!scene) return;
    const w = el.clientWidth;
    const ht = el.clientHeight;
    if (w < 10 || ht < 10) return;
    scene.resize(w, ht);
    wake();
  }

  function wake(): void {
    if (running || failed || !visible) return;
    last = performance.now();
    running = requestAnimationFrame(tick);
  }

  function tick(now: number): void {
    running = 0;
    if (!scene || !terrainKey || !el.isConnected || el.clientWidth < 10 || document.hidden) {
      if (el.isConnected && visible && !document.hidden) running = requestAnimationFrame(tick);
      return;
    }
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    scene.clock += dt;

    // Ease the camera towards where it should look. The arrival shot is slow; a drag follows closely.
    const still = reducedMotion();
    const rate = arriving ? 1.15 : drag ? 18 : 5.5;
    const k = still ? 1 : 1 - Math.exp(-dt * rate);
    let goalAz = target.az;
    let goalPitch = target.pitch;
    if (!still && !drag && !arriving && now - idleSince > 3500) {
      // Never completely still: a slow drift, as a hand-held camera breathes.
      const t = (now - idleSince - 3500) / 1000;
      const ease = Math.min(1, t / 4);
      goalAz += ease * 0.55 * Math.sin(t * 0.21);
      goalPitch += ease * 0.22 * Math.sin(t * 0.33 + 1.3);
    }
    scene.look.az = (scene.look.az + shortest(scene.look.az, goalAz) * k + 360) % 360;
    scene.look.pitch += (goalPitch - scene.look.pitch) * k;
    scene.look.fov += (target.fov - scene.look.fov) * k;
    if (arriving && now - arriving > 5200) arriving = 0;
    // The title card plays over a clean picture; the instruments come in afterwards.
    el.classList.toggle('arriving', arriving > 0 && now - arriving < 3600);

    try {
      scene.render(teleWindows());
    } catch (err) {
      fail(err);
      return;
    }
    // Keep it fluid on slower graphics: lower the resolution a step at a time, and raise it again when there is room.
    slow += (dt - slow) * 0.08;
    if (++frames % 40 === 0) {
      if (slow > 0.045 && scene.quality > 0.5) {
        scene.quality = Math.max(0.5, scene.quality * 0.82);
        resize();
      } else if (slow < 0.019 && scene.quality < 1) {
        scene.quality = Math.min(1, scene.quality / 0.9);
        resize();
      }
    }
    overlay();
    running = requestAnimationFrame(tick);
  }

  /** Where the telephoto windows are, and where each lens points. A body well below the skyline gets no window. */
  function teleWindows(): { x: number; y: number; size: number; az: number; el: number; fov: number }[] {
    if (!moment || !site) return [];
    const box = canvas.getBoundingClientRect();
    const out: { x: number; y: number; size: number; az: number; el: number; fov: number }[] = [];
    const m = moment;
    const one = (frameEl: HTMLElement, note: HTMLElement, az: number, elv: number, radius: number, clear: number, fov: number, widest: number, text: string) => {
      const hiddenDeep = clear < -radius - 1.5;
      frameEl.classList.toggle('off', hiddenDeep);
      setText(note, hiddenDeep ? T.teleBelow : text);
      if (hiddenDeep) return;
      const r = frameEl.getBoundingClientRect();
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
    const span = hFov(scene.look.fov);
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
    canvas.setAttribute('aria-description', T.looking(scene.look.az.toFixed(0), compass(scene.look.az)));
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
    touch();
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
    target.az = (target.az - (ev.clientX - drag.x) * perPx + 360) % 360;
    target.pitch = Math.max(-35, Math.min(80, target.pitch + (ev.clientY - drag.y) * perPx));
    drag.x = ev.clientX;
    drag.y = ev.clientY;
    touch();
  });
  const release = (ev: PointerEvent) => {
    pinch.delete(ev.pointerId);
    if (drag && drag.id === ev.pointerId) drag = null;
    if (!pinch.size) el.classList.remove('dragging');
    idleSince = performance.now();
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
    const stepDeg = target.fov / 10;
    if (ev.key === 'ArrowLeft') target.az = (target.az - stepDeg + 360) % 360;
    else if (ev.key === 'ArrowRight') target.az = (target.az + stepDeg) % 360;
    else if (ev.key === 'ArrowUp') target.pitch = Math.min(80, target.pitch + stepDeg);
    else if (ev.key === 'ArrowDown') target.pitch = Math.max(-35, target.pitch - stepDeg);
    else if (ev.key === '+' || ev.key === '=') return zoom(0.85);
    else if (ev.key === '-') return zoom(1.18);
    else if (ev.key.toLowerCase() === 's') return face('sun');
    else if (ev.key.toLowerCase() === 'e') return face('earth');
    else return;
    ev.preventDefault();
    touch();
  });
  canvas.addEventListener('webglcontextlost', (ev) => {
    ev.preventDefault();
    fail('context lost');
  });
  new ResizeObserver(resize).observe(el);
  // Draw only while the view is on screen.
  new IntersectionObserver((entries) => {
    visible = entries.some((e) => e.isIntersecting);
    if (visible) wake();
  }).observe(el);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) wake();
  });

  if (import.meta.env.DEV) {
    // Lets the development screenshot tool aim the camera.
    (window as unknown as Record<string, unknown>).__lwFace = (which: 'sun' | 'earth', fov: number, lift = 0) => {
      if (!scene || !moment) return;
      const v = which === 'sun' ? moment.sun : moment.earth;
      Object.assign(target, { az: v.az, pitch: v.el + lift, fov });
      Object.assign(scene.look, target);
      idleSince = performance.now() + 1e9;
      arriving = 0;
      wake();
    };
    (window as unknown as Record<string, unknown>).__lwLook = (az: number, pitch: number, fov: number) => {
      if (!scene) return;
      Object.assign(target, { az, pitch, fov });
      Object.assign(scene.look, target);
      idleSince = performance.now() + 1e9;
      arriving = 0;
      wake();
    };
  }

  return api;
}
