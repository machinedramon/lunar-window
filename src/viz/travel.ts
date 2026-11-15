// The journey between two places. Instead of a cut, the Moon is seen as a globe: it turns under the camera from the
// site that is left to the site that is reached, lit by the Sun as it is at that moment, and the camera comes down.
// The picture is NASA's own: the colour map of the Lunar Reconnaissance Orbiter Camera (NASA SVS, CGI Moon Kit).
import * as THREE from 'three';

export interface Place {
  lat: number;
  lon: number;
  name: string;
}

export interface Travel {
  /** Covers the view with the globe, above the place that is left. Resolves when it is on screen. */
  show(from: Place, to: Place, sunMoonFixed: readonly [number, number, number]): Promise<void>;
  /** Turns the Moon to the place that is reached and comes down on it. Resolves on arrival. */
  fly(): Promise<void>;
  /**
   * Draws one moment of the way, from 0 (over the place that is left) to 1 (over the place that is reached).
   * `back` multiplies how far the camera pulls away in the middle (a frame much wider than tall needs more).
   */
  pose(t: number, back?: number): void;
  /** Uncovers the view. */
  hide(): void;
  dispose(): void;
}

const D2R = Math.PI / 180;
const MOON_KM = 1737.4;
/** How close the camera starts and ends, in Moon radii from the centre. */
const NEAR = 1.3;
const FADE_MS = 380;

/** A direction of the Moon-fixed frame (x to 0°E on the equator, z to the north pole) on the textured sphere of three.js. */
const onGlobe = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, z, -y);
const dirOf = (p: { lat: number; lon: number }): THREE.Vector3 => {
  const c = Math.cos(p.lat * D2R);
  return onGlobe(c * Math.cos(p.lon * D2R), c * Math.sin(p.lon * D2R), Math.sin(p.lat * D2R));
};
const ease = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

let texture: Promise<THREE.Texture> | null = null;
/** Reads the map of the Moon ahead of time, so that the first journey does not wait for it. */
export function preloadTravel(): Promise<THREE.Texture> {
  texture ??= new THREE.TextureLoader().loadAsync(`${import.meta.env.BASE_URL}textures/moon-4k.webp`).then((t) => {
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  });
  texture.catch(() => (texture = null));
  return texture;
}

export function createTravel(container: HTMLElement): Travel {
  const el = document.createElement('div');
  el.className = 'travel';
  el.setAttribute('aria-hidden', 'true');
  const canvas = document.createElement('canvas');
  const caption = document.createElement('p');
  caption.className = 'travel-caption';
  el.append(canvas, caption);
  container.append(el);

  let renderer: THREE.WebGLRenderer | null = null;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 2, 0.05, 20);
  const sun = new THREE.DirectionalLight(0xffffff, 2.0);
  // The Sun as it is, and enough fill for the ground to be read where the Sun grazes (the poles, any landing at
  // dawn) or is not up at all: a soft light from where the camera is, and a little from everywhere. This view is a
  // map of the way, not a photograph.
  const fill = new THREE.DirectionalLight(0xffffff, 0.55);
  scene.add(sun, fill, new THREE.AmbientLight(0xffffff, 0.18));
  const globe = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 64), new THREE.MeshLambertMaterial({ color: 0xffffff }));
  scene.add(globe);
  const ringGeo = new THREE.RingGeometry(0.011, 0.0145, 48);
  const markFrom = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
  const markTo = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, side: THREE.DoubleSide }));
  const path = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 }));
  scene.add(markFrom, markTo, path);

  let a = new THREE.Vector3(1, 0, 0);
  let b = new THREE.Vector3(0, 0, 1);
  let up = new THREE.Vector3(0, 1, 0);
  let angle = 0;
  let frame = 0;

  const size = () => {
    if (!renderer) return;
    const w = Math.max(1, container.clientWidth);
    const h = Math.max(1, container.clientHeight);
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };

  /** The camera at fraction `t` of the way: over the great circle from one place to the other, higher in the middle. */
  const place = (t: number, back = 1) => {
    const dir = angle < 1e-4 ? a.clone() : a.clone().multiplyScalar(Math.sin((1 - t) * angle)).addScaledVector(b, Math.sin(t * angle)).divideScalar(Math.sin(angle));
    dir.normalize();
    // A short hop stays low; a journey across the Moon pulls back until the whole globe is in view.
    const far = NEAR + Math.min(2.1, angle * 1.5) * back;
    const d = NEAR + (far - NEAR) * Math.pow(Math.sin(Math.PI * t), 0.85);
    camera.position.copy(dir).multiplyScalar(d);
    fill.position.copy(camera.position);
    // The marks keep a steady size on screen: from close up they would be huge.
    const k = Math.min(1, (d - 1) / 0.75);
    markFrom.scale.setScalar(k);
    markTo.scale.setScalar(k);
    camera.up.copy(up);
    camera.lookAt(0, 0, 0);
    path.geometry.setDrawRange(0, Math.max(2, Math.round(t * 96) + 1));
    (markTo.material as THREE.MeshBasicMaterial).opacity = 0.35 + 0.65 * t;
    renderer?.render(scene, camera);
  };

  const orient = (mesh: THREE.Mesh, dir: THREE.Vector3) => {
    mesh.position.copy(dir).multiplyScalar(1.003);
    mesh.lookAt(dir.clone().multiplyScalar(2));
  };

  return {
    async show(from, to, sunMoonFixed) {
      const map = await preloadTravel();
      if (!renderer) {
        renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
        renderer.setClearColor(0x000000, 1);
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        (globe.material as THREE.MeshLambertMaterial).map = map;
        (globe.material as THREE.MeshLambertMaterial).needsUpdate = true;
      }
      size();
      a = dirOf(from);
      b = dirOf(to);
      angle = a.angleTo(b);
      // The Moon turns about the axis of the journey, which is upright on screen: the way goes across the picture.
      // For a hop too short to have an axis, north is up (or, at a pole, the meridian of 0°E).
      up = angle > 0.03 ? a.clone().cross(b).normalize() : Math.abs(a.y) < 0.98 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
      sun.position.copy(onGlobe(sunMoonFixed[0], sunMoonFixed[1], sunMoonFixed[2]).normalize().multiplyScalar(10));
      orient(markFrom, a);
      orient(markTo, b);
      const points: THREE.Vector3[] = [];
      for (let i = 0; i <= 96; i++) {
        const t = i / 96;
        const p = angle < 1e-4 ? a.clone() : a.clone().multiplyScalar(Math.sin((1 - t) * angle)).addScaledVector(b, Math.sin(t * angle)).divideScalar(Math.sin(angle));
        points.push(p.normalize().multiplyScalar(1.004));
      }
      path.geometry.setFromPoints(points);
      const km = angle * MOON_KM;
      caption.textContent = `${from.name}  →  ${to.name}  ·  ${km >= 100 ? Math.round(km / 10) * 10 : km.toFixed(km < 10 ? 1 : 0)} km`;
      place(0);
      el.classList.add('on');
      await new Promise<void>((resolve) => window.setTimeout(resolve, FADE_MS));
    },
    fly() {
      cancelAnimationFrame(frame);
      const length = Math.max(1300, Math.min(3300, 1300 + 950 * angle));
      return new Promise<void>((resolve) => {
        const t0 = performance.now();
        const step = (now: number) => {
          const t = Math.min(1, (now - t0) / length);
          place(ease(t));
          if (t < 1) frame = requestAnimationFrame(step);
          else resolve();
        };
        frame = requestAnimationFrame(step);
      });
    },
    pose(t, back = 1) {
      cancelAnimationFrame(frame);
      place(Math.max(0, Math.min(1, t)), back);
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
