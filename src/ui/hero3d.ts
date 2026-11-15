// The 3D view of Explore: stand on the landing site and look around.
// Camera work is deliberate: every move eases in and out, a site opens with an arrival shot and
// a title card, and the view never sits completely still.
import { MAST_HEIGHTS_M } from '../core/horizon';
import { S } from '../i18n';
import { FONT, MONO } from '../viz/canvas';
import { EYE_MIN_M } from '../viz/eye';
import { introStage } from './intro';
import type { LunarScene, SceneSky } from '../viz/scene3d';
import type { LoadedSite } from './data';
import { h, reducedMotion, setText } from './dom';
import type { Moment } from './exploreModel';
import { compass, latLon } from './format';

const T = S.explore.three;

export interface Hero3D {
  el: HTMLElement;
  /** False once WebGL turned out to be unavailable. */
  ok(): boolean;
  setSite(loaded: LoadedSite, mast: number): void;
  setMoment(m: Moment, axes: { north: [number, number, number]; greenwich: [number, number, number] }, stars: SceneSky['starAxes'], when: string): void;
  redraw(): void;
  /**
   * Frames elsewhere on the page, over the picture, in which the telephoto views are drawn when they are
   * visible. When they are not (a phone, where the readings sit below the picture), the view's own windows are used.
   */
  lenses(sun: HTMLElement, earth: HTMLElement): void;
  onFail: (() => void) | null;
  /** Called with true when the camera starts arriving at a place, and with false when the instruments may come in. */
  onArriving: ((on: boolean) => void) | null;
  /** Called once, when the first place is loaded, compiled and drawn: the picture can be uncovered. */
  onReady: (() => void) | null;
  /** True when a place is on screen and the camera is not arriving: the instruments can be shown at once. */
  settled(): boolean;
}

interface Look {
  az: number;
  pitch: number;
  fov: number;
}

const shortest = (from: number, to: number): number => ((to - from + 540) % 360) - 180;

/** Names written on the night sky: the brightest stars and the two Magellanic Clouds. Right ascension and declination, degrees, J2000. */
const NAMED_SKY: [string, number, number][] = [
  ['Sirius', 101.287, -16.716],
  ['Canopus', 95.988, -52.696],
  ['Alpha Centauri', 219.902, -60.834],
  ['Arcturus', 213.915, 19.182],
  ['Vega', 279.235, 38.784],
  ['Capella', 79.172, 45.998],
  ['Rigel', 78.634, -8.202],
  ['Procyon', 114.825, 5.225],
  ['Achernar', 24.429, -57.237],
  ['Betelgeuse', 88.793, 7.407],
  ['Hadar', 210.956, -60.373],
  ['Altair', 297.696, 8.868],
  ['Acrux', 186.65, -63.099],
  ['Aldebaran', 68.98, 16.509],
  ['Antares', 247.352, -26.432],
  ['Spica', 201.298, -11.161],
  ['Pollux', 116.329, 28.026],
  ['Fomalhaut', 344.413, -29.622],
  ['Deneb', 310.358, 45.28],
  ['Regulus', 152.093, 11.967],
  ['Polaris', 37.954, 89.264],
  ['Large Magellanic Cloud', 80.89, -69.76],
  ['Small Magellanic Cloud', 13.19, -72.83],
];
const NAMED_DIRS: [string, number[]][] = NAMED_SKY.map(([name, ra, dec]) => {
  const a = (ra * Math.PI) / 180;
  const d = (dec * Math.PI) / 180;
  return [name, [Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)]];
});

let shared: { api: Hero3D; relabel: () => void } | null = null;

/**
 * The 3D view. There is one for the life of the page: when the screens are rebuilt in another language, the same
 * view, with the same picture, is handed over with its words changed.
 */
export function createHero3D(): Hero3D {
  if (shared) {
    shared.relabel();
    return shared.api;
  }
  const canvas = h('canvas', { class: 'three-canvas', tabindex: '0', role: 'img', 'aria-label': T.aria });
  const tape = h('canvas', { class: 'three-tape', 'aria-hidden': 'true' });
  const skyNames = h('canvas', { class: 'three-sky', 'aria-hidden': 'true' });
  const sunLabel = h('div', { class: 'three-label sun', hidden: true });
  const earthLabel = h('div', { class: 'three-label earth', hidden: true });
  const hint = h('div', { class: 'three-hint' }, T.hint);
  const loadingText = h('span', null, T.loading);
  const loading = h('div', { class: 'three-loading' }, h('div', { class: 'spinner' }), loadingText);
  const fade = h('div', { class: 'three-fade' });
  const titleName = h('div', { class: 'three-title-name' });
  const titleSub = h('div', { class: 'three-title-sub' });
  const title = h('div', { class: 'three-title', 'aria-hidden': 'true' }, titleName, titleSub);
  const btn = (text: string, tip: string, fn: () => void) => h('button', { class: 'btn ghost three-btn', type: 'button', title: tip, onclick: fn }, text);
  const faceSunBtn = btn(T.faceSun, T.faceSunTip, () => face('sun'));
  const faceEarthBtn = btn(T.faceEarth, T.faceEarthTip, () => face('earth'));
  const zoomOutBtn = btn('−', T.zoomOut, () => zoom(1.25));
  const zoomInBtn = btn('+', T.zoomIn, () => zoom(0.8));
  const controls = h('div', { class: 'three-controls' }, faceSunBtn, faceEarthBtn, zoomOutBtn, zoomInBtn);
  const inset = (cls: string, text: string) => {
    const note = h('span', { class: 'three-inset-note' });
    const name = h('span', null, text);
    const frame = h('div', { class: `three-inset ${cls}` }, h('span', { class: 'three-inset-title' }, h('span', { class: `dot ${cls}` }), name), note);
    return { frame, note, name };
  };
  const sunInset = inset('sun', T.teleSun);
  const earthInset = inset('earth', T.teleEarth);
  const insets = h('div', { class: 'three-insets' }, sunInset.frame, earthInset.frame);
  const el = h('div', { class: 'three' }, canvas, skyNames, tape, sunLabel, earthLabel, insets, controls, title, fade, loading, hint);

  let outerSun: HTMLElement | null = null;
  let outerEarth: HTMLElement | null = null;
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
  /** Value of `running` while a frame is being drawn (not a real animation-frame handle). */
  const DRAWING = -1;
  let last = 0;
  let arriving = 0;
  let slow = 0.016;
  let loweredAt = -1e9;
  let raisedAt = -1e9;
  let holdMs = 6000;
  /** Set by the recording tool: the resolution stays put, so that no frame is caught in the middle of a change. */
  let lockedQuality = false;
  let frames = 0;
  const target: Look = { az: 0, pitch: 4, fov: 46 };
  const api: Hero3D = {
    el,
    ok: () => !failed,
    setSite,
    setMoment,
    redraw: wake,
    lenses(sun, earth) {
      outerSun = sun;
      outerEarth = earth;
      wake();
    },
    onFail: null,
    onArriving: null,
    onReady: null,
    settled: () => Boolean(terrainKey) && !arriving,
  };
  let runs = 0;
  let readySaid = false;
  let arrivingSaid = false;
  const ready = () => {
    if (readySaid) return;
    readySaid = true;
    introStage(S.stages.ready, 1);
    api.onReady?.();
  };

  function fail(err: unknown): void {
    console.warn('3D view unavailable:', err);
    failed = true;
    cancelAnimationFrame(running);
    running = 0;
    api.onFail?.();
    ready();
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
    // The same place from another antenna height: the eye and the mast travel there. Nothing is loaded or built again.
    if (!pendingKey && framed === site.site.id && terrainKey.startsWith(`${site.site.id}/`)) {
      const d = site.data;
      scene.setEye(d ? d.elevDeg[mast] : null, d ? d.distKm[mast] : null, d ? d.stepDeg : 1, MAST_HEIGHTS_M[mast]);
      terrainKey = key;
      setText(hint, T.hintEye(String(Math.max(EYE_MIN_M, MAST_HEIGHTS_M[mast]))));
      wake();
      return;
    }
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
    const eye = String(Math.max(EYE_MIN_M, MAST_HEIGHTS_M[targetMast]));
    setText(hint, T.hintEye(eye));
    if (sky) scene.setSky(sky);
    const run = ++runs;
    if (newSite) {
      framed = target0.site.id;
      frame();
      vehicleAz = (target.az - 15 + 360) % 360;
    }
    // Rocks, vehicle and mast: the same arrangement every time for a given site.
    let seed = 7;
    for (const ch of target0.site.id) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
    // NASA's concept rover and our solar mast where a mission is still to come; the Lunar Module at the Apollo
    // sites; only the mast where a real robotic lander stood on real terrain; nothing at the other real sites.
    const s0 = target0.site;
    const kind = s0.category === 'apollo' ? 'apollo' : s0.status === 'candidate' || s0.status === 'planned' ? 'rover' : s0.horizon !== 'sphere' ? 'mast' : 'none';
    // The place is shown whole: the vehicle and the rocks are in, every program is compiled and a frame is drawn
    // before the camera arrives. Until then the picture stays covered (the opening screen, or black between sites).
    introStage(S.stages.scene, 0.6);
    await scene.setProps(target0.site.id, seed, vehicleAz, kind, MAST_HEIGHTS_M[targetMast]);
    if (run !== runs || !scene) return;
    if (newSite) {
      introStage(S.stages.picture, 0.85);
      await scene.warm();
      if (run !== runs || !scene) return;
      arrive(target0);
    }
    ready();
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
      api.onArriving?.(false);
      return;
    }
    arrivingSaid = true;
    api.onArriving?.(true);
    slow = 0.016;
    frames = 0;
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
    // While a frame is being drawn the loop counts as running: anything that asks for a redraw in the
    // meantime (a change of resolution, a model arriving) must not start a second loop beside this one.
    running = DRAWING;
    if (!scene || !terrainKey || !el.isConnected || el.clientWidth < 10 || document.hidden) {
      running = el.isConnected && visible && !document.hidden ? requestAnimationFrame(tick) : 0;
      return;
    }
    // A slow, cinematic picture gains nothing beyond about 80 frames a second: on fast displays every
    // second or third refresh is drawn, which spares the graphics card and the battery.
    if (now - last < 10.5) {
      running = requestAnimationFrame(tick);
      return;
    }
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    scene.clock += dt;
    scene.step(dt);

    // Ease the camera towards where it should look. The arrival shot is slow; a drag follows closely.
    const still = reducedMotion();
    const rate = arriving ? 1.15 : drag ? 18 : 5.5;
    const k = still ? 1 : 1 - Math.exp(-dt * rate);
    // An instrument holds still: left alone, the camera does not move, so the picture is the same frame
    // after frame and nothing fine in it can shimmer. It moves when the visitor moves it or time flows.
    scene.look.az = (scene.look.az + shortest(scene.look.az, target.az) * k + 360) % 360;
    scene.look.pitch += (target.pitch - scene.look.pitch) * k;
    scene.look.fov += (target.fov - scene.look.fov) * k;
    if (arriving && now - arriving > 5200) arriving = 0;
    // The title card plays over a clean picture; the instruments come in afterwards.
    const coming = arriving > 0 && now - arriving < 3600;
    el.classList.toggle('arriving', coming);
    if (arrivingSaid && !coming) {
      arrivingSaid = false;
      api.onArriving?.(false);
    }

    try {
      scene.render(teleWindows());
    } catch (err) {
      fail(err);
      return;
    }
    // Keep it fluid on slower graphics: lower the resolution a step at a time, and raise it again when there is room.
    // A single long frame (a model arriving, a shader compiling) is not a slow machine.
    slow += (Math.min(dt, 0.066) - slow) * 0.08;
    // Not while the camera arrives: the long frames of the loading say nothing about the speed of the machine,
    // and a change of resolution in the middle of that move would be seen.
    if (++frames % 40 === 0 && !lockedQuality && !(arriving && now - arriving < 4200)) {
      if (slow > 0.03 && scene.quality > 0.6) {
        // If raising the resolution is what made it slow again, wait longer before the next try.
        if (now - raisedAt < 5000) holdMs = Math.min(120000, holdMs * 2);
        scene.quality = Math.max(0.6, scene.quality * 0.82);
        loweredAt = now;
        resize();
      } else if (slow < 0.019 && scene.quality < 1 && now - loweredAt > holdMs) {
        scene.quality = Math.min(1, scene.quality / 0.9);
        raisedAt = now;
        resize();
      }
    }
    overlay();
    running = requestAnimationFrame(tick);
  }

  /** Where the telephoto windows are, and where each lens points. A body well below the skyline gets no window. */
  function teleWindows(): { x: number; y: number; size: number; az: number; el: number; fov: number }[] {
    if (!moment || !site) return [];
    // The telephoto views come in with their instruments, a moment after the arrival.
    if (arriving && performance.now() - arriving < 4600) return [];
    const box = canvas.getBoundingClientRect();
    const out: { x: number; y: number; size: number; az: number; el: number; fov: number }[] = [];
    const m = moment;
    const one = (inner: { frame: HTMLElement; note: HTMLElement }, outer: HTMLElement | null, az: number, elv: number, radius: number, clear: number, fov: number, widest: number) => {
      const hiddenDeep = clear < -radius - 1.5;
      inner.frame.classList.toggle('off', hiddenDeep);
      outer?.classList.toggle('off', hiddenDeep);
      // The figures are beside the picture, said once; the window only says when there is nothing to show.
      setText(inner.note, hiddenDeep ? T.teleBelow : '');
      if (hiddenDeep) return;
      // The frame beside the figures when it is on screen and over the picture; the view's own window otherwise.
      let r = outer?.getBoundingClientRect();
      if (!r || r.width < 20 || r.left < box.left || r.right > box.right || r.top < box.top || r.bottom > box.bottom) r = inner.frame.getBoundingClientRect();
      if (r.width < 20) return;
      // Widen the lens until the skyline under the body is in the window; beyond `widest`, show the body alone.
      const need = (Math.abs(clear) + radius * 2.2) * 2.1;
      const lens = need <= widest ? Math.max(fov, need) : fov;
      const aim = need <= widest ? elv - clear / 2 : elv;
      // Measured boxes follow any scaling of the page (a zoomed recording); the picture is drawn in its own pixels.
      const k = box.width / (canvas.clientWidth || box.width) || 1;
      out.push({ x: Math.round((r.left - box.left) / k) + 1, y: Math.round((r.top - box.top) / k) + 1, size: Math.round(r.width / k) - 2, az, el: aim, fov: lens });
    };
    const sunClear = m.sun.el - site.horizon.at(m.sun.az, mast);
    one(sunInset, outerSun, m.sun.az, m.sun.el, m.sun.radius, sunClear, 2.6, 12);
    one(earthInset, outerEarth, m.earth.az, m.earth.el, m.earth.radius, m.earthClear, 5.0, 13);
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

  /** Names of the planets and of the brightest stars, when the night sky shows: proof that it is the real one. */
  function nameSky(): void {
    if (!scene) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = el.clientWidth;
    const ht = el.clientHeight;
    if (skyNames.width !== Math.round(w * dpr) || skyNames.height !== Math.round(ht * dpr)) {
      skyNames.width = Math.round(w * dpr);
      skyNames.height = Math.round(ht * dpr);
    }
    const ctx = skyNames.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, ht);
    const level = scene.starLevel;
    if (level < 0.2 || !sky || !site) return;
    const ax = sky.starAxes;
    const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    // On a wide window the corners belong to the instruments; names keep clear of them.
    const wide = w >= 1100;
    const busy = (x: number, y: number) => wide && ((x < 360 && y < 300) || (x > w - 470 && y < 400) || (x < 660 && y > ht - 240) || (x > w - 480 && y > ht - 240));
    ctx.font = `500 9.5px ${MONO}`;
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 1;
    const one = (name: string, d: readonly number[], strong: boolean) => {
      const up = dot(d, ax.up);
      const elv = (Math.asin(Math.max(-1, Math.min(1, up))) * 180) / Math.PI;
      const az = ((Math.atan2(dot(d, ax.east), dot(d, ax.north)) * 180) / Math.PI + 360) % 360;
      if (elv < site!.horizon.at(az, mast) + 0.4) return;
      const p = scene!.project(az, elv);
      if (!p || p.x < 0.02 || p.x > 0.94 || p.y < 0.07 || p.y > 0.97) return;
      const x = p.x * w;
      const y = p.y * ht;
      if (busy(x, y)) return;
      const a = level * (strong ? 0.85 : 0.5);
      ctx.strokeStyle = `rgba(255,255,255,${(a * 0.7).toFixed(3)})`;
      ctx.beginPath();
      ctx.moveTo(x + 6, y - 6);
      ctx.lineTo(x + 14, y - 14);
      ctx.lineTo(x + 20, y - 14);
      ctx.stroke();
      ctx.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`;
      ctx.fillText(name.toUpperCase().split('').join('\u200a'), x + 24, y - 14);
    };
    for (const [name, d] of NAMED_DIRS) one(name === 'Large Magellanic Cloud' ? S.sky.lmc : name === 'Small Magellanic Cloud' ? S.sky.smc : name, d, false);
    for (const p of ax.planets ?? []) one(p.name, p.dir, true);
  }

  function overlay(): void {
    if (!scene || !moment) return;
    const m = moment;
    nameSky();
    place(sunLabel, m.sun.az, m.sun.el + m.sun.radius, m.eclipse > 0.5 ? T.sunEclipsed : m.sunFrac <= 0 ? T.sunHidden : T.sunLabel);
    place(earthLabel, m.earth.az, m.earth.el + m.earth.radius, m.earthClear > 0 ? T.earthLabel : T.earthHidden);

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
    (window as unknown as Record<string, unknown>).__lwScene = () => scene;
    /** Draws the current state at once: the recording tool grabs the frame right after. */
    (window as unknown as Record<string, unknown>).__lwDraw = () => {
      if (!scene || !terrainKey) return;
      scene.render(teleWindows());
      overlay();
    };
    (window as unknown as Record<string, unknown>).__lwQuality = (q: number) => {
      lockedQuality = true;
      if (scene && scene.quality !== q) {
        scene.quality = q;
        resize();
      }
    };
    (window as unknown as Record<string, unknown>).__lwFace = (which: 'sun' | 'earth', fov: number, lift = 0) => {
      if (!scene || !moment) return;
      const v = which === 'sun' ? moment.sun : moment.earth;
      Object.assign(target, { az: v.az, pitch: v.el + lift, fov });
      Object.assign(scene.look, target);
      arriving = 0;
      wake();
    };
    (window as unknown as Record<string, unknown>).__lwLook = (az: number, pitch: number, fov: number) => {
      if (!scene) return;
      Object.assign(target, { az, pitch, fov });
      Object.assign(scene.look, target);
      arriving = 0;
      wake();
    };
  }

  shared = {
    api,
    // The words that were written once: the per-frame ones (labels, names in the sky) follow by themselves.
    relabel() {
      // the title card of the arrival has played; moved to a new page it must not play again
      title.classList.remove('show');
      canvas.setAttribute('aria-label', T.aria);
      setText(loadingText, T.loading);
      setText(faceSunBtn, T.faceSun);
      faceSunBtn.title = T.faceSunTip;
      setText(faceEarthBtn, T.faceEarth);
      faceEarthBtn.title = T.faceEarthTip;
      zoomOutBtn.title = T.zoomOut;
      zoomInBtn.title = T.zoomIn;
      setText(sunInset.name, T.teleSun);
      setText(earthInset.name, T.teleEarth);
      setText(hint, terrainKey ? T.hintEye(String(Math.max(EYE_MIN_M, MAST_HEIGHTS_M[mast]))) : T.hint);
      wake();
    },
  };
  return api;
}
