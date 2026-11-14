// Where the Sun and the Earth are, seen from a point on the Moon.
//
// The JPL Horizons service cannot be called from a browser (no CORS headers), so the
// positions are computed here with astronomy-engine and checked against Horizons tables
// in tests/golden. Frame: Moon-fixed, built from the IAU north pole and prime-meridian
// angle of the Moon (it matches MOON_ME to a few thousandths of a degree), sphere of
// radius 1737.4 km, the same reference as the LOLA elevation data.
import { Body, GeoMoon, GeoVector, MakeTime, RotateVector, Rotation_EQD_EQJ, RotationAxis, SiderealTime, Vector } from 'astronomy-engine';

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
export function localAxesJ2000(date: Date, latDeg: number, lonDeg: number): { east: Vec3; north: Vec3; up: Vec3 } {
  const f = moonFrame(MakeTime(date));
  const s = siteFrame(latDeg, lonDeg, 0);
  const out = (v: Vec3): Vec3 => [v[0] * f.x[0] + v[1] * f.y[0] + v[2] * f.z[0], v[0] * f.x[1] + v[1] * f.y[1] + v[2] * f.z[1], v[0] * f.x[2] + v[1] * f.y[2] + v[2] * f.z[2]];
  return { east: out(s.east), north: out(s.north), up: out(s.up) };
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
