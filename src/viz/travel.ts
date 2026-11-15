// The journey between two places. Instead of a cut, the Moon is seen whole, from space: it turns under the camera
// from the site that is left to the site that is reached, and the camera comes down on it.
//
// The picture is made of NASA's own data: the colour map of the Lunar Reconnaissance Orbiter Camera (NASA SVS, CGI
// Moon Kit) and the slopes of the ground from the LOLA elevation model (tools/build_moon_relief.py). The Sun is
// where it is at that moment, so the line between day and night falls where it does, and where the light grazes
// (that line, the poles) the rims of the craters catch it and their floors stay dark. The lunar dust sends light
// back almost evenly across the lit face, which is why the Moon does not look like a matte ball: the light is
// computed that way (Lommel-Seeliger) rather than as on a plaster sphere. How strongly the slopes are shown, and
// a little light on the night side so that a place in the dark can still be found, are choices of the drawing.
//
// Over the globe: the way as an arc, faint ahead and bright behind a point of light that travels it; a sight on
// the place that is reached; and, above, the two names with a line that fills between them and the kilometres
// counted as they go by.
import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

export interface Place {
  lat: number;
  lon: number;
  name: string;
}

export interface Travel {
  /** Covers the view with the globe, above the place that is left. Resolves when it is on screen. */
  show(from: Place, to: Place, sunMoonFixed: readonly [number, number, number]): Promise<void>;
  /** Turns the Moon to the place that is reached and comes down on it, in `ms` milliseconds if given. Resolves on arrival. */
  fly(ms?: number): Promise<void>;
  /**
   * Draws one moment of the way, from 0 (over the place that is left) to 1 (over the place that is reached).
   * `back` multiplies how far the camera pulls away (a frame much wider than tall needs more).
   */
  pose(t: number, back?: number): void;
  /**
   * For a descent that goes on into the place itself (ui/hero3d.ts): how high above the ground the journey starts
   * and how high it goes, in km; and how tall its picture is and where its middle is on the page, in pixels.
   */
  heights(): { start: number; far: number; tall: number; middle: number };
  /**
   * Draws the way at fraction `turn` of the great circle, seen from `altKm` above the ground, with the globe at
   * opacity `alpha`: below 1 the place itself, drawn underneath, shows through, and the globe dissolves into it.
   * `crop`, from 0 to 1, closes the picture from the whole screen to the frame of the 3D view, as two dark bands
   * coming in: the place is drawn in that frame, and the globe has to be in it too by the time it dissolves.
   */
  frameAt(turn: number, altKm: number, alpha: number, crop?: number): void;
  /** Uncovers the view. */
  hide(): void;
  dispose(): void;
}

/** The lens of the journey: its vertical field of view, in degrees. */
export const TRAVEL_FOV = 30;

const D2R = Math.PI / 180;
const MOON_KM = 1737.4;
/** How close the camera ends, in Moon radii from the centre. */
const NEAR = 1.3;
const FADE_MS = 380;
/** How much steeper than measured the slopes are shown. */
const RELIEF = 2.4;
const SEGMENTS = 128;

/** A direction of the Moon-fixed frame (x to 0°E on the equator, z to the north pole) on the textured sphere of three.js. */
const onGlobe = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, z, -y);
const dirOf = (p: { lat: number; lon: number }): THREE.Vector3 => {
  const c = Math.cos(p.lat * D2R);
  return onGlobe(c * Math.cos(p.lon * D2R), c * Math.sin(p.lon * D2R), Math.sin(p.lat * D2R));
};
const clamp = (v: number): number => Math.max(0, Math.min(1, v));
/** A move that starts and ends at rest. */
const smooth = (t: number): number => {
  const c = clamp(t);
  return c * c * c * (c * (c * 6 - 15) + 10);
};
const thousands = (n: number): string => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

const MOON_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vP;
void main() {
  vUv = uv;
  vP = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const MOON_FRAG = /* glsl */ `
uniform sampler2D map;
uniform sampler2D relief;
uniform float uRelief;
uniform float uFill;
uniform vec3 uSun;
uniform vec3 uEye;
varying vec2 vUv;
varying vec3 vP;
void main() {
  vec3 n = normalize(vP);
  // East and north on the globe (its axis is y), and the ground as it slopes: the measured slopes, shown steeper.
  vec3 east = normalize(cross(vec3(0.0, 1.0, 0.0), n) + vec3(1e-5, 0.0, 0.0));
  vec3 north = cross(n, east);
  // (Not at the very poles, where a map of this kind is pinched to a point and its slopes mean nothing.)
  vec2 slope = (texture2D(relief, vUv).rg - 0.5) / 3.0 * uRelief * (1.0 - smoothstep(0.955, 0.995, abs(n.y)));
  vec3 ground = normalize(n - east * slope.x - north * slope.y);
  vec3 eye = normalize(uEye - vP);
  float mu0 = max(dot(ground, uSun), 0.0);
  float mu = max(dot(n, eye), 0.0);
  // Lunar dust: nearly even across the lit face (Lommel-Seeliger), with a share of plain cosine for the relief.
  float even = 2.0 * mu0 / (mu0 + mu + 0.03);
  float lit = mix(mu0, even, 0.62) * smoothstep(-0.03, 0.05, dot(n, uSun));
  vec3 colour = texture2D(map, vUv).rgb;
  gl_FragColor = vec4(colour * (lit * 2.1 + uFill * (0.3 + 0.7 * mu)), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

let textures: Promise<[THREE.Texture, THREE.Texture | null]> | null = null;
/** Reads the maps of the Moon ahead of time, so that the first journey does not wait for them. */
export function preloadTravel(): Promise<[THREE.Texture, THREE.Texture | null]> {
  if (!textures) {
    const loader = new THREE.TextureLoader();
    const colour = loader.loadAsync(`${import.meta.env.BASE_URL}textures/moon-4k.webp`).then((t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 8;
      return t;
    });
    // Without the relief (an old browser, a file that did not come) the globe is lit as a smooth sphere.
    const relief = loader.loadAsync(`${import.meta.env.BASE_URL}textures/moon-relief.webp`).then(
      (t) => {
        t.colorSpace = THREE.NoColorSpace;
        t.anisotropy = 4;
        return t as THREE.Texture | null;
      },
      () => null,
    );
    textures = Promise.all([colour, relief]);
    textures.catch(() => (textures = null));
  }
  return textures;
}

/** A small picture drawn on a canvas, for a mark that always faces the camera. */
function mark(draw: (ctx: CanvasRenderingContext2D, size: number) => void): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  draw(canvas.getContext('2d')!, 128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false }));
  sprite.renderOrder = 5;
  return sprite;
}

export function createTravel(container: HTMLElement): Travel {
  const el = document.createElement('div');
  el.className = 'travel';
  el.setAttribute('aria-hidden', 'true');
  const canvas = document.createElement('canvas');
  // Above the globe: the name that is left, a line that fills as the way goes, the name that is reached; the kilometres.
  const fromName = document.createElement('span');
  const toName = document.createElement('span');
  const wayFill = document.createElement('b');
  const way = document.createElement('i');
  way.append(wayFill);
  const route = document.createElement('p');
  route.className = 'travel-route';
  route.append(fromName, way, toName);
  const km = document.createElement('p');
  km.className = 'travel-km';
  el.append(canvas, route, km);
  container.append(el);

  let renderer: THREE.WebGLRenderer | null = null;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(TRAVEL_FOV, 2, 0.02, 30);
  const moon = new THREE.ShaderMaterial({
    vertexShader: MOON_VERT,
    fragmentShader: MOON_FRAG,
    uniforms: {
      map: { value: null as THREE.Texture | null },
      relief: { value: null as THREE.Texture | null },
      uRelief: { value: 0 },
      uFill: { value: 0.05 },
      uSun: { value: new THREE.Vector3(1, 0, 0) },
      uEye: { value: new THREE.Vector3(0, 0, 4) },
    },
  });
  const globe = new THREE.Mesh(new THREE.SphereGeometry(1, 192, 96), moon);
  scene.add(globe);

  // The way: faint where it is still to come, bright where it has been flown.
  const ahead = new Line2(new LineGeometry(), new LineMaterial({ color: 0xffffff, linewidth: 1.1, transparent: true, opacity: 0.26, depthWrite: false }));
  const behind = new Line2(new LineGeometry(), new LineMaterial({ color: 0xffffff, linewidth: 1.9, transparent: true, opacity: 0.95, depthWrite: false }));
  ahead.renderOrder = 3;
  behind.renderOrder = 4;
  // The point of light that travels it, the place that is left, and the sight on the place that is reached.
  const head = mark((ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.16, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.3, 'rgba(190,220,255,0.35)');
    g.addColorStop(1, 'rgba(125,184,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });
  const origin = mark((ctx, s) => {
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, s * 0.3, 0, Math.PI * 2);
    ctx.stroke();
  });
  const sight = mark((ctx, s) => {
    const c = s / 2;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(c, c, s * 0.2, 0, Math.PI * 2);
    ctx.stroke();
    // four marks around the ring, as on a sight
    ctx.lineWidth = 4;
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2;
      ctx.beginPath();
      ctx.moveTo(c + Math.cos(a) * s * 0.3, c + Math.sin(a) * s * 0.3);
      ctx.lineTo(c + Math.cos(a) * s * 0.46, c + Math.sin(a) * s * 0.46);
      ctx.stroke();
    }
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(c, c, 5, 0, Math.PI * 2);
    ctx.fill();
  });
  scene.add(ahead, behind, origin, sight, head);

  let a = new THREE.Vector3(1, 0, 0);
  let b = new THREE.Vector3(0, 0, 1);
  let up = new THREE.Vector3(0, 1, 0);
  let angle = 0;
  let lift = 0;
  let frame = 0;
  let wayKm = 0;
  /** Where the middle of the picture is on the page, in pixels from the top. */
  let middle = 0;
  const points: THREE.Vector3[] = [];
  const scratch = new THREE.Vector3();

  /** The direction of the point at fraction `t` of the great circle from one place to the other. */
  const along = (t: number, out: THREE.Vector3): THREE.Vector3 => {
    if (angle < 1e-4) return out.copy(a);
    return out
      .copy(a)
      .multiplyScalar(Math.sin((1 - t) * angle))
      .addScaledVector(b, Math.sin(t * angle))
      .divideScalar(Math.sin(angle))
      .normalize();
  };

  const size = () => {
    if (!renderer) return;
    // The journey covers the 3D view; while the guide has only the picture on, it covers the whole screen.
    const whole = document.body.classList.contains('guide-cine');
    if (whole !== el.classList.contains('whole')) {
      el.classList.toggle('whole', whole);
      (whole ? document.body : container).append(el);
    }
    const w = Math.max(1, el.clientWidth);
    const h = Math.max(1, el.clientHeight);
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // Over the whole screen the middle of the picture stays where the middle of the 3D view is (the foot of the
    // screen belongs to the voice): the place the descent ends on is then drawn where the globe showed it.
    const view = container.getBoundingClientRect();
    const here = el.getBoundingClientRect();
    middle = view.top + view.height / 2;
    const shift = Math.round(here.top + h / 2 - middle);
    if (whole && Math.abs(shift) > 0) camera.setViewOffset(w, h, 0, shift, w, h);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
    for (const line of [ahead, behind]) (line.material as LineMaterial).resolution.set(w, h);
  };

  /**
   * One moment of the way. The Moon is first seen whole, above the place that is left; it turns under the camera
   * along the great circle while the point of light draws the way; over the place that is reached the camera
   * comes down, slowly at first.
   */
  /** How far the journey is seen from, in Moon radii from the centre: at its start, and at its farthest. */
  const reach = (back = 1): { start: number; far: number } => {
    // A short hop stays low; a journey across the Moon is seen from where the whole globe is in view.
    // (Seen whole, the Moon takes two thirds of the height of the picture: the rest is the dark around it.)
    const far = NEAR + Math.min(4.2, angle * 3.3) * back;
    return { start: NEAR + (far - NEAR) * 0.9, far };
  };

  const place = (t: number, back = 1) => {
    const { start, far } = reach(back);
    const turn = smooth(t / 0.76);
    const fall = smooth((t - 0.4) / 0.6);
    const out = smooth(t / 0.3);
    const d = (start + (far - start) * out) * (1 - fall) + NEAR * fall;
    // The last of the descent goes into the dark: the place itself comes out of it, on the ground.
    draw(turn, d, far, 1 - smooth((t - 0.84) / 0.15), 1 - smooth((t - 0.8) / 0.12), 1 - smooth((t - 0.8) / 0.1));
  };

  /**
   * The picture: at fraction `turn` of the way, from `d` Moon radii; the globe at opacity `alpha`, the point of
   * light at `tip`, the words at `words`.
   */
  const draw = (turn: number, d: number, far: number, alpha: number, tip: number, words: number) => {
    along(turn, scratch);
    camera.position.copy(scratch).multiplyScalar(d);
    camera.up.copy(up);
    camera.lookAt(0, 0, 0);
    moon.uniforms.uEye.value.copy(camera.position);
    // A little light on the night side, more as the ground comes near: a place in the dark can still be found.
    moon.uniforms.uFill.value = 0.045 + 0.3 * smooth((far - d) / Math.max(0.2, far - NEAR)) * (far > NEAR + 0.4 ? 1 : 0.6);
    // The way so far, and the point of light at its end.
    const drawn = Math.max(1, Math.round(turn * SEGMENTS));
    (behind.geometry as LineGeometry).instanceCount = drawn;
    behind.visible = turn > 0.004;
    const end = points[Math.min(SEGMENTS, drawn)] ?? points[0];
    // The marks keep their size on screen whatever the distance.
    const px = (pixels: number, at: THREE.Vector3) => (camera.position.distanceTo(at) * 2 * Math.tan((camera.fov * D2R) / 2) * pixels) / Math.max(1, el.clientHeight);
    if (end) {
      head.position.copy(end);
      head.scale.setScalar(px(34, end));
      (head.material as THREE.SpriteMaterial).opacity = tip;
    }
    origin.scale.setScalar(px(15, origin.position));
    const beat = 1 + 0.07 * Math.sin(performance.now() / 260);
    sight.scale.setScalar(px(50, sight.position) * beat);
    (sight.material as THREE.SpriteMaterial).opacity = (0.4 + 0.6 * smooth(turn / 0.6)) * Math.min(1, alpha * 1.4);
    // The words: the line between the two names fills, the kilometres go by.
    wayFill.style.transform = `scaleX(${turn.toFixed(4)})`;
    km.textContent = `${thousands(turn * wayKm)} / ${thousands(wayKm)} km`;
    canvas.style.opacity = alpha.toFixed(3);
    route.style.opacity = km.style.opacity = words.toFixed(3);
    renderer?.render(scene, camera);
  };

  return {
    async show(from, to, sunMoonFixed) {
      const [map, relief] = await preloadTravel();
      if (!renderer) {
        renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
        renderer.setClearColor(0x000000, 1);
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        moon.uniforms.map.value = map;
        moon.uniforms.relief.value = relief ?? map;
        moon.uniforms.uRelief.value = relief ? RELIEF : 0;
      }
      size();
      a = dirOf(from);
      b = dirOf(to);
      angle = a.angleTo(b);
      // The Moon turns about the axis of the journey, which is upright on screen: the way goes across the picture.
      // For a hop too short to have an axis, north is up (or, at a pole, the meridian of 0°E).
      up = angle > 0.03 ? a.clone().cross(b).normalize() : Math.abs(a.y) < 0.98 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
      moon.uniforms.uSun.value.copy(onGlobe(sunMoonFixed[0], sunMoonFixed[1], sunMoonFixed[2])).normalize();
      // The way rises a little above the ground in its middle, as a path flown does.
      lift = Math.min(0.05, angle * 0.03);
      points.length = 0;
      const flat: number[] = [];
      for (let i = 0; i <= SEGMENTS; i++) {
        const t = i / SEGMENTS;
        const p = along(t, new THREE.Vector3()).multiplyScalar(1.006 + lift * Math.sin(Math.PI * t));
        points.push(p);
        flat.push(p.x, p.y, p.z);
      }
      (ahead.geometry as LineGeometry).setPositions(flat);
      (behind.geometry as LineGeometry).setPositions(flat);
      origin.position.copy(a).multiplyScalar(1.006);
      sight.position.copy(b).multiplyScalar(1.006);
      wayKm = angle * MOON_KM;
      fromName.textContent = from.name;
      toName.textContent = to.name;
      el.classList.remove('through');
      el.style.clipPath = '';
      place(0);
      el.classList.add('on');
      await new Promise<void>((resolve) => window.setTimeout(resolve, FADE_MS));
    },
    fly(ms) {
      cancelAnimationFrame(frame);
      const length = ms ?? Math.max(1500, Math.min(3800, 1500 + 1200 * angle));
      return new Promise<void>((resolve) => {
        const t0 = performance.now();
        const step = (now: number) => {
          const t = Math.min(1, (now - t0) / length);
          place(t);
          if (t < 1) frame = requestAnimationFrame(step);
          else resolve();
        };
        frame = requestAnimationFrame(step);
      });
    },
    pose(t, back = 1) {
      cancelAnimationFrame(frame);
      place(clamp(t), back);
    },
    heights() {
      const { start, far } = reach();
      return { start: (start - 1) * MOON_KM, far: (far - 1) * MOON_KM, tall: Math.max(1, el.clientHeight), middle };
    },
    frameAt(turn, altKm, alpha, crop = 0) {
      cancelAnimationFrame(frame);
      // Dissolving: the dark behind the globe goes with it, so that what is underneath shows.
      el.classList.toggle('through', alpha < 1);
      if (crop > 0 && el.classList.contains('whole')) {
        const view = container.getBoundingClientRect();
        const here = el.getBoundingClientRect();
        el.style.clipPath = `inset(${(Math.max(0, view.top - here.top) * crop).toFixed(1)}px 0 ${(Math.max(0, here.bottom - view.bottom) * crop).toFixed(1)}px 0)`;
      } else el.style.clipPath = '';
      draw(clamp(turn), 1 + Math.max(0, altKm) / MOON_KM, reach().far, alpha, alpha, clamp(alpha * 1.6 - 0.6));
    },
    hide() {
      cancelAnimationFrame(frame);
      el.classList.remove('on');
    },
    dispose() {
      cancelAnimationFrame(frame);
      renderer?.dispose();
      el.remove();
    },
  };
}
