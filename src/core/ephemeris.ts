// Where the Sun and the Earth are, seen from a point on the Moon.
//
// The JPL Horizons service cannot be called from a browser (no CORS headers), so the
// positions are computed here with astronomy-engine and checked against Horizons tables
// in tests/golden. Frame: Moon-fixed, built from the IAU north pole and prime-meridian
// angle of the Moon (it matches MOON_ME to a few thousandths of a degree), sphere of
// radius 1737.4 km, the same reference as the LOLA elevation data.
import { Body, GeoMoon, GeoVector, Illumination, MakeTime, RotateVector, Rotation_EQD_EQJ, RotationAxis, SiderealTime, Vector } from 'astronomy-engine';

export type Vec3 = readonly [number, number, number];

export const MOON_RADIUS_KM = 1737.4;
export const SUN_RADIUS_KM = 695700;
export const EARTH_RADIUS_KM = 6378.137;
export const D2R = Math.PI / 180;
const KM_PER_AU = 149597870.7;

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: Vec3): Vec3 => {
  const n = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / n, a[1] / n, a[2] / n];
};

/** Positions of the Sun and the Earth relative to the centre of the Moon, in the Moon-fixed frame, km. */
export interface Sky {
  sun: Vec3;
  earth: Vec3;
}

type Time = ReturnType<typeof MakeTime>;

/** Axes of the Moon-fixed frame, expressed in J2000 equatorial coordinates. */
function moonFrame(time: Time): { x: Vec3; y: Vec3; z: Vec3 } {
  const axis = RotationAxis(Body.Moon, time);
  const z = unit([axis.north.x, axis.north.y, axis.north.z]);
  const node = unit(cross([0, 0, 1], z)); // ascending node of the lunar equator on the J2000 equator
  const m = cross(z, node);
  const w = axis.spin * D2R;
  const cw = Math.cos(w);
  const sw = Math.sin(w);
  const x: Vec3 = [node[0] * cw + m[0] * sw, node[1] * cw + m[1] * sw, node[2] * cw + m[2] * sw];
  return { x, y: cross(z, x), z };
}

/**
 * One call per instant serves every site: the per-site work is only a change of basis.
 */
export function sky(date: Date): Sky {
  const time = MakeTime(date);
  const { x, y, z } = moonFrame(time);
  const moon = GeoMoon(time); // geocentric, J2000 equatorial, au
  const sunGeo = GeoVector(Body.Sun, time, true);
  const s: Vec3 = [(sunGeo.x - moon.x) * KM_PER_AU, (sunGeo.y - moon.y) * KM_PER_AU, (sunGeo.z - moon.z) * KM_PER_AU];
  const e: Vec3 = [-moon.x * KM_PER_AU, -moon.y * KM_PER_AU, -moon.z * KM_PER_AU];
  return { sun: [dot(s, x), dot(s, y), dot(s, z)], earth: [dot(e, x), dot(e, y), dot(e, z)] };
}

/**
 * Orientation of the Earth, in the Moon-fixed frame: its north pole and the point of its
 * equator on the Greenwich meridian. Used to show the right face of the Earth in the 3D view.
 */
export function earthAxes(date: Date): { north: Vec3; greenwich: Vec3 } {
  const time = MakeTime(date);
  const f = moonFrame(time);
  const toJ2000 = Rotation_EQD_EQJ(time);
  const theta = SiderealTime(time) * 15 * D2R; // Greenwich apparent sidereal time
  const inMoon = (vx: number, vy: number, vz: number): Vec3 => {
    const v = RotateVector(toJ2000, new Vector(vx, vy, vz, time));
    const j: Vec3 = [v.x, v.y, v.z];
    return [dot(j, f.x), dot(j, f.y), dot(j, f.z)];
  };
  return { north: inMoon(0, 0, 1), greenwich: inMoon(Math.cos(theta), Math.sin(theta), 0) };
}

/**
 * The local directions of a site (east, north, up) expressed in J2000 equatorial coordinates.
 * With them a star of known right ascension and declination can be placed in the site's sky.
 */
export function localAxesJ2000(date: Date, latDeg: number, lonDeg: number): { east: Vec3; north: Vec3; up: Vec3; planets: Planet[]; timeMs: number } {
  const time = MakeTime(date);
  const f = moonFrame(time);
  const s = siteFrame(latDeg, lonDeg, 0);
  const out = (v: Vec3): Vec3 => [v[0] * f.x[0] + v[1] * f.y[0] + v[2] * f.z[0], v[0] * f.x[1] + v[1] * f.y[1] + v[2] * f.z[1], v[0] * f.x[2] + v[1] * f.y[2] + v[2] * f.z[2]];
  return { east: out(s.east), north: out(s.north), up: out(s.up), planets: planetsFromMoon(time), timeMs: date.getTime() };
}

/** A planet in the lunar sky: unit direction from the Moon in J2000 equatorial coordinates, and visual magnitude. */
export interface Planet {
  name: string;
  dir: Vec3;
  mag: number;
}

const NAKED_EYE_PLANETS: [string, Body][] = [
  ['Mercury', Body.Mercury],
  ['Venus', Body.Venus],
  ['Mars', Body.Mars],
  ['Jupiter', Body.Jupiter],
  ['Saturn', Body.Saturn],
];

/** The five planets visible to the eye, where they stand among the stars as seen from the Moon. */
function planetsFromMoon(time: Time): Planet[] {
  const moon = GeoMoon(time);
  return NAKED_EYE_PLANETS.map(([name, body]) => {
    const g = GeoVector(body, time, true);
    return { name, dir: unit([g.x - moon.x, g.y - moon.y, g.z - moon.z]), mag: Illumination(body, time).mag };
  });
}

/**
 * A planet as a telescope on the Moon sees it at a moment: where it is, how it is lit and how it is turned.
 * Directions are unit vectors in J2000 equatorial coordinates.
 */
export interface PlanetView {
  name: string;
  /** From the Moon to the planet. */
  toPlanet: Vec3;
  /** From the planet to the Sun. */
  toSun: Vec3;
  /** The planet's north pole, and the direction of its prime meridian on its equator (IAU model), when the light left it. */
  north: Vec3;
  prime: Vec3;
  /** Equatorial radius in km, and flattening (1 - polar radius / equatorial radius). */
  radiusKm: number;
  flattening: number;
  distanceKm: number;
  distanceAu: number;
  /** Apparent equatorial diameter, in seconds of arc. */
  arcsec: number;
  /** Share of the disc that is lit, from 0 to 1. */
  lit: number;
  mag: number;
  /** Where the centre of the disc is on the planet: east longitude and planetocentric latitude, degrees. */
  subLon: number;
  subLat: number;
}

const AU_KM = 149597870.7;
/** Days light takes to cross one astronomical unit. */
const LIGHT_DAYS_PER_AU = 499.004784 / 86400;
/** Equatorial radius (km) and flattening, from the IAU report the JPL Horizons System also uses. */
const PLANET_SHAPE: Record<string, [Body, number, number]> = {
  Mercury: [Body.Mercury, 2440.53, 0.0009],
  Venus: [Body.Venus, 6051.8, 0],
  Mars: [Body.Mars, 3396.19, 0.00589],
  Jupiter: [Body.Jupiter, 71492, 0.06487],
  Saturn: [Body.Saturn, 60268, 0.09796],
};
const dot3 = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

export function planetView(name: string, date: Date): PlanetView | null {
  const shape = PLANET_SHAPE[name];
  if (!shape) return null;
  const [body, radiusKm, flattening] = shape;
  const time = MakeTime(date);
  const moon = GeoMoon(time);
  const g = GeoVector(body, time, true);
  const sun = GeoVector(Body.Sun, time, true);
  const rel: Vec3 = [g.x - moon.x, g.y - moon.y, g.z - moon.z];
  const distanceAu = Math.hypot(rel[0], rel[1], rel[2]);
  const toPlanet = unit(rel);
  const toSun = unit([sun.x - g.x, sun.y - g.y, sun.z - g.z]);
  // The planet is seen as it was when the light left it: for Jupiter, forty minutes and a tenth of a turn ago.
  const axis = RotationAxis(body, time.AddDays(-distanceAu * LIGHT_DAYS_PER_AU));
  const north: Vec3 = [axis.north.x, axis.north.y, axis.north.z];
  // IAU: the prime meridian is the angle W east of the node where the planet's equator rises through the Earth's (of J2000).
  const node = unit(cross3([0, 0, 1], north));
  const beside = cross3(north, node);
  const w = axis.spin * D2R;
  const prime: Vec3 = [node[0] * Math.cos(w) + beside[0] * Math.sin(w), node[1] * Math.cos(w) + beside[1] * Math.sin(w), node[2] * Math.cos(w) + beside[2] * Math.sin(w)];
  const toUs: Vec3 = [-toPlanet[0], -toPlanet[1], -toPlanet[2]];
  const east = cross3(north, prime);
  return {
    name,
    toPlanet,
    toSun,
    north,
    prime,
    radiusKm,
    flattening,
    distanceAu,
    distanceKm: distanceAu * AU_KM,
    arcsec: (2 * Math.atan(radiusKm / (distanceAu * AU_KM)) * 3600) / D2R,
    lit: (1 + dot3(toSun, toUs)) / 2,
    mag: Illumination(body, time).mag,
    subLon: ((Math.atan2(dot3(toUs, east), dot3(toUs, prime)) / D2R) % 360 + 360) % 360,
    subLat: Math.asin(Math.max(-1, Math.min(1, dot3(toUs, north)))) / D2R,
  };
}

/** Local directions of a site, in the Moon-fixed frame, and its position in km. */
export interface SiteFrame {
  up: Vec3;
  east: Vec3;
  north: Vec3;
  pos: Vec3;
}

export function siteFrame(latDeg: number, lonDeg: number, heightM = 0): SiteFrame {
  const lat = latDeg * D2R;
  const lon = lonDeg * D2R;
  const up: Vec3 = [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
  const east: Vec3 = [-Math.sin(lon), Math.cos(lon), 0];
  const north: Vec3 = [-Math.sin(lat) * Math.cos(lon), -Math.sin(lat) * Math.sin(lon), Math.cos(lat)];
  const r = MOON_RADIUS_KM + heightM / 1000;
  return { up, east, north, pos: [up[0] * r, up[1] * r, up[2] * r] };
}

/** A body seen from a site. Angles in degrees; azimuth from north towards east. */
export interface View {
  az: number;
  el: number;
  /** Angular radius of the disc. */
  radius: number;
  distKm: number;
}

export function look(x: number, y: number, z: number, frame: SiteFrame, bodyRadiusKm: number): View {
  const vx = x - frame.pos[0];
  const vy = y - frame.pos[1];
  const vz = z - frame.pos[2];
  const d = Math.hypot(vx, vy, vz);
  const ux = vx / d;
  const uy = vy / d;
  const uz = vz / d;
  const sinEl = ux * frame.up[0] + uy * frame.up[1] + uz * frame.up[2];
  const e = ux * frame.east[0] + uy * frame.east[1] + uz * frame.east[2];
  const n = ux * frame.north[0] + uy * frame.north[1] + uz * frame.north[2];
  let az = Math.atan2(e, n) / D2R;
  if (az < 0) az += 360;
  return { az, el: Math.asin(Math.max(-1, Math.min(1, sinEl))) / D2R, radius: Math.asin(bodyRadiusKm / d) / D2R, distKm: d };
}

/** Sun and Earth seen from a site at one instant. */
export function lookAt(s: Sky, frame: SiteFrame): { sun: View; earth: View } {
  return {
    sun: look(s.sun[0], s.sun[1], s.sun[2], frame, SUN_RADIUS_KM),
    earth: look(s.earth[0], s.earth[1], s.earth[2], frame, EARTH_RADIUS_KM),
  };
}

/** Angle between two directions given as azimuth and elevation, degrees. */
export function separation(a: View, b: View): number {
  const c = Math.sin(a.el * D2R) * Math.sin(b.el * D2R) + Math.cos(a.el * D2R) * Math.cos(b.el * D2R) * Math.cos((a.az - b.az) * D2R);
  return Math.acos(Math.max(-1, Math.min(1, c))) / D2R;
}

/**
 * Fraction of the solar disc hidden behind the Earth (a lunar eclipse, seen from the Moon).
 * 0 = no eclipse, 1 = the Sun is entirely behind the Earth.
 */
export function eclipseCoverage(sun: View, earth: View): number {
  const d = separation(sun, earth);
  const r = sun.radius;
  const R = earth.radius;
  if (d >= r + R) return 0;
  if (d <= R - r) return 1;
  const a = r * r * Math.acos((d * d + r * r - R * R) / (2 * d * r)) + R * R * Math.acos((d * d + R * R - r * r) / (2 * d * R));
  const b = 0.5 * Math.sqrt((-d + r + R) * (d + r - R) * (d - r + R) * (d + r + R));
  return Math.max(0, Math.min(1, (a - b) / (Math.PI * r * r)));
}
