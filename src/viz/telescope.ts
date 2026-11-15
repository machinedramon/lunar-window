// A planet through a telescope, drawn point by point on a small canvas.
//
// At their true size the planets are points of light: Jupiter, the largest, is forty-five seconds of arc across,
// a fortieth of the width of the Sun. So the 3D view keeps them as points, and this is the instrument that shows
// them as worlds. Everything about the picture is computed for the moment shown, from where the planet, the Sun
// and the Moon are (core/ephemeris.ts, checked against NASA's JPL Horizons): the size of the disc, how much of
// it is lit and from which side, how the planet is tilted and turned, its flattening, and for Saturn the rings,
// their opening, the shadow of the globe on them and their shadow on the globe. Up in the picture is up in the
// sky of the site.
//
// The faces of Jupiter, Saturn and Mars are NASA's maps (tools/build_planets.py). Mars shows the side it really
// turns to the Moon at that moment. The cloud patterns of Jupiter and Saturn are those of the day the
// spacecraft mapped them, not of the date shown: clouds move. Mercury and Venus are drawn plain.
import type { PlanetView, Vec3 } from '../core/ephemeris';

/** A planet without a map: its colour, in linear light. */
const PLAIN: Record<string, [number, number, number]> = {
  Mercury: [0.36, 0.34, 0.32],
  Venus: [0.86, 0.82, 0.66],
};
/** How much light the lit face sends back, relative to the others, so that each is exposed like a photograph of it. */
const GAIN: Record<string, number> = { Mercury: 1.9, Venus: 1.15, Mars: 1.5, Jupiter: 1.35, Saturn: 1.3 };
/** The rings of Saturn, from the planet outwards, in equatorial radii: inner edge, outer edge, how opaque, how bright. */
const RINGS: [number, number, number, number][] = [
  [1.239, 1.527, 0.16, 0.42], // C: thin and dark
  [1.527, 1.951, 0.96, 1.0], // B: the bright one
  [1.951, 2.027, 0.06, 0.3], // the Cassini Division
  [2.027, 2.212, 0.62, 0.78], // A
  [2.212, 2.218, 0.05, 0.3], // the Encke Gap
  [2.218, 2.269, 0.6, 0.76], // A, beyond the gap
];
const RING_COLOUR: [number, number, number] = [0.86, 0.79, 0.66];
const RING_OUT = 2.269;

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: Vec3): Vec3 => {
  const n = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / n, a[1] / n, a[2] / n];
};

const maps = new Map<string, Promise<ImageData | null>>();
/** The map of a planet, read once; null for a planet that has none, or if it cannot be read. */
export function planetMap(name: string): Promise<ImageData | null> {
  let p = maps.get(name);
  if (!p) {
    p =
      name in PLAIN
        ? Promise.resolve(null)
        : new Promise<ImageData | null>((resolve) => {
            const img = new Image();
            img.onload = () => {
              const c = document.createElement('canvas');
              c.width = img.naturalWidth;
              c.height = img.naturalHeight;
              const ctx = c.getContext('2d', { willReadFrequently: true });
              if (!ctx) return resolve(null);
              ctx.drawImage(img, 0, 0);
              resolve(ctx.getImageData(0, 0, c.width, c.height));
            };
            img.onerror = () => resolve(null);
            img.src = `${import.meta.env.BASE_URL}textures/planets/${name.toLowerCase()}.webp`;
          });
    maps.set(name, p);
  }
  return p;
}

/** sRGB byte to linear light, and back. */
const TO_LINEAR = new Float32Array(256);
for (let i = 0; i < 256; i++) TO_LINEAR[i] = Math.pow(i / 255, 2.2);
const toByte = (v: number): number => Math.round(255 * Math.pow(Math.max(0, Math.min(1, v)), 1 / 2.2));

/** How wide the picture is, in equatorial radii of the planet: room for the rings where there are any. */
export const scopeSpan = (name: string): number => (name === 'Saturn' ? 5.5 : 2.9);

/**
 * Draws the planet on the canvas (square; its pixels are used as they are).
 * @param p    the planet at the moment shown
 * @param up   up in the sky of the site, in J2000 equatorial coordinates: it is up in the picture
 * @param map  the planet's map, or null to draw it plain
 */
export function drawPlanet(canvas: HTMLCanvasElement, p: PlanetView, up: Vec3, map: ImageData | null): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const n = canvas.width;
  const out = ctx.createImageData(n, n);
  const px = out.data;
  // The picture plane: the eye looks along `look`; `right` and `top` span the picture.
  const look = p.toPlanet;
  let right = cross(look, up);
  if (Math.hypot(right[0], right[1], right[2]) < 1e-6) right = cross(look, [0, 0, 1]);
  right = unit(right);
  const top = cross(right, look);
  const z = p.north;
  const x0 = p.prime;
  const y0 = cross(z, x0);
  const sun = p.toSun;
  // A flattened globe is a sphere once everything is stretched along the axis by 1 / (1 - f).
  const stretch = 1 / (1 - p.flattening) - 1;
  const tall = (v: Vec3): Vec3 => {
    const k = dot(v, z) * stretch;
    return [v[0] + z[0] * k, v[1] + z[1] * k, v[2] + z[2] * k];
  };
  const lookT = tall(look);
  const sunT = tall(sun);
  const lookZ = dot(look, z);
  const sunZ = dot(sun, z);
  const ringed = p.name === 'Saturn';
  // The rings are seen from their lit side when the Sun and the eye are on the same side of them.
  const ringLit = sunZ * -lookZ > 0;
  const plain = PLAIN[p.name];
  const gain = GAIN[p.name] ?? 1.3;
  const span = scopeSpan(p.name);
  const mw = map ? map.width : 0;
  const mh = map ? map.height : 0;

  /** Where a ray from `o` along `d` (both already stretched) meets the globe: the distance along it, or -1. */
  const hit = (o: Vec3, d: Vec3): number => {
    const b = dot(o, d);
    const dd = dot(d, d);
    const c = dot(o, o) - 1;
    const disc = b * b - dd * c;
    if (disc < 0) return -1;
    return (-b - Math.sqrt(disc)) / dd;
  };
  /** How opaque and how bright the rings are at a distance from the axis, in equatorial radii. */
  const ringAt = (r: number): [number, number] => {
    for (const [a, b, alpha, bright] of RINGS) if (r >= a && r < b) return [alpha, bright];
    return [0, 0];
  };

  for (let j = 0; j < n; j++) {
    const v = (0.5 - (j + 0.5) / n) * span;
    for (let i = 0; i < n; i++) {
      const u = ((i + 0.5) / n - 0.5) * span;
      // A point of the picture plane through the planet's centre; the ray runs along `look` through it.
      const o: Vec3 = [right[0] * u + top[0] * v, right[1] * u + top[1] * v, right[2] * u + top[2] * v];
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      const oT = tall(o);
      const t = hit(oT, lookT);
      const globe = t > -1e8 && dot(oT, oT) - (dot(oT, lookT) * dot(oT, lookT)) / dot(lookT, lookT) <= 1;
      // the rings, where the ray crosses their plane
      let ringT = Infinity;
      let ringAlpha = 0;
      let ringLight = 0;
      if (ringed && Math.abs(lookZ) > 1e-4) {
        const tr = -dot(o, z) / lookZ;
        const q: Vec3 = [o[0] + look[0] * tr, o[1] + look[1] * tr, o[2] + look[2] * tr];
        const rad = Math.hypot(q[0], q[1], q[2]);
        if (rad >= RINGS[0][0] && rad < RING_OUT) {
          const [alpha, bright] = ringAt(rad);
          if (alpha > 0) {
            ringT = tr;
            ringAlpha = alpha;
            // In the shadow of the globe the rings are dark; seen from behind, only what filters through shows.
            const shaded = hit(tall(q), sunT) > 0;
            ringLight = shaded ? 0 : ringLit ? bright : 0.22 * (1 - alpha) + 0.04;
          }
        }
      }
      if (globe) {
        const s: Vec3 = [o[0] + look[0] * t, o[1] + look[1] * t, o[2] + look[2] * t];
        const sT = tall(s);
        // The outward direction of the flattened surface, and the light on it.
        const k = dot(sT, z) * stretch;
        const nrm = unit([sT[0] + z[0] * k, sT[1] + z[1] * k, sT[2] + z[2] * k]);
        let light = Math.max(0, dot(nrm, sun));
        // The shadow of the rings on the globe.
        if (ringed && Math.abs(sunZ) > 1e-4 && light > 0) {
          const ts = -dot(s, z) / sunZ;
          if (ts > 0) {
            const rad = Math.hypot(s[0] + sun[0] * ts, s[1] + sun[1] * ts, s[2] + sun[2] * ts);
            if (rad >= RINGS[0][0] && rad < RING_OUT) light *= 1 - ringAt(rad)[0] * 0.85;
          }
        }
        let cr = 0;
        let cg = 0;
        let cb = 0;
        if (map) {
          const lat = Math.asin(Math.max(-1, Math.min(1, dot(sT, z) / Math.hypot(sT[0], sT[1], sT[2]))));
          const lon = Math.atan2(dot(s, y0), dot(s, x0));
          const mx = Math.min(mw - 1, Math.max(0, Math.floor((lon / (2 * Math.PI) + 0.5) * mw)));
          const my = Math.min(mh - 1, Math.max(0, Math.floor((0.5 - lat / Math.PI) * mh)));
          const at = (my * mw + mx) * 4;
          cr = TO_LINEAR[map.data[at]];
          cg = TO_LINEAR[map.data[at + 1]];
          cb = TO_LINEAR[map.data[at + 2]];
        } else if (plain) [cr, cg, cb] = plain;
        r = cr * light * gain;
        g = cg * light * gain;
        b = cb * light * gain;
        a = 1;
        // The rings pass in front of the globe on the near side.
        if (ringT < t) {
          r = r * (1 - ringAlpha) + RING_COLOUR[0] * ringLight * ringAlpha;
          g = g * (1 - ringAlpha) + RING_COLOUR[1] * ringLight * ringAlpha;
          b = b * (1 - ringAlpha) + RING_COLOUR[2] * ringLight * ringAlpha;
        }
      } else if (ringT < Infinity) {
        r = RING_COLOUR[0] * ringLight;
        g = RING_COLOUR[1] * ringLight;
        b = RING_COLOUR[2] * ringLight;
        a = ringAlpha;
      }
      const at = (j * n + i) * 4;
      px[at] = toByte(r * a);
      px[at + 1] = toByte(g * a);
      px[at + 2] = toByte(b * a);
      px[at + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
}
