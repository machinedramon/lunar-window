// Terrain horizon of any point near the lunar south pole, computed in the browser from NASA's LOLA polar
// elevation models (public/data/polar, written by tools/build_polar.py). It is the same method as the offline
// tool that builds the horizons of the listed sites (tools/lunar.py): the terrain is sampled along great circles
// and the elevation angle of every sample is computed on the sphere, so the curvature of the Moon is included.

export const MOON_RADIUS_M = 1737400;
const D2R = Math.PI / 180;

/** A rectangle of a polar stereographic grid held in memory (pixel registration, north-up). */
export interface Patch {
  /** Heights, in counts of `unitM` above the sphere, row by row. */
  a: Int16Array;
  /** Size in pixels of the whole grid this patch is cut from. */
  n: number;
  stepM: number;
  /** Column and row, in the whole grid, of the first pixel of the patch. */
  oi: number;
  oj: number;
  w: number;
  h: number;
}

/** Bilinear height in counts; NaN outside the patch. */
function sample(p: Patch, x: number, y: number): number {
  const i = x / p.stepM + p.n / 2 - 0.5 - p.oi;
  const j = p.n / 2 - 0.5 - y / p.stepM - p.oj;
  if (!(i >= 0 && j >= 0 && i < p.w - 1 && j < p.h - 1)) return NaN;
  const i0 = Math.floor(i);
  const j0 = Math.floor(j);
  const fi = i - i0;
  const fj = j - j0;
  const k = j0 * p.w + i0;
  const a = p.a;
  return (a[k] * (1 - fi) + a[k + 1] * fi) * (1 - fj) + (a[k + p.w] * (1 - fi) + a[k + p.w + 1] * fi) * fj;
}

/** The elevation model around one point: the dense grid near it, the coarse one for everything farther. */
export class PolarTerrain {
  constructor(
    readonly unitM: number,
    readonly far: Patch,
    readonly near: Patch | null,
  ) {}

  /** Height in metres above the sphere at a point of the projection plane; NaN where the model has no data. */
  height(x: number, y: number): number {
    if (this.near) {
      const v = sample(this.near, x, y);
      if (v === v) return v * this.unitM;
    }
    return sample(this.far, x, y) * this.unitM;
  }

  heightAt(latDeg: number, lonDeg: number): number {
    const [x, y] = toPlane(latDeg, lonDeg);
    return this.height(x, y);
  }
}

/** South polar stereographic projection: x towards 90°E, y towards 0°E, metres. */
export function toPlane(latDeg: number, lonDeg: number): [number, number] {
  const r = 2 * MOON_RADIUS_M * Math.tan((Math.PI / 2 + latDeg * D2R) / 2);
  return [r * Math.sin(lonDeg * D2R), r * Math.cos(lonDeg * D2R)];
}

/** Column and row of the dense-grid tile that holds a point. */
export function tileOf(latDeg: number, lonDeg: number, n: number, stepM: number, tile: number): [number, number] {
  const [x, y] = toPlane(latDeg, lonDeg);
  const i = x / stepM + n / 2 - 0.5;
  const j = n / 2 - 0.5 - y / stepM;
  return [Math.floor(i / tile), Math.floor(j / tile)];
}

/** Point reached from (lat, lon) along a great circle. Degrees. */
export function destination(latDeg: number, lonDeg: number, bearingDeg: number, distanceM: number): [number, number] {
  const lat = latDeg * D2R;
  const d = distanceM / MOON_RADIUS_M;
  const a = bearingDeg * D2R;
  const lat2 = Math.asin(Math.max(-1, Math.min(1, Math.sin(lat) * Math.cos(d) + Math.cos(lat) * Math.sin(d) * Math.cos(a))));
  const lon2 = lonDeg * D2R + Math.atan2(Math.sin(a) * Math.sin(d) * Math.cos(lat), Math.cos(d) - Math.sin(lat) * Math.sin(lat2));
  let lon = (lon2 / D2R) % 360;
  if (lon > 180) lon -= 360;
  if (lon < -180) lon += 360;
  return [lat2 / D2R, lon];
}

// Sampling distances along each direction, as in tools/lunar.py: every 40 m out to 100 km, every 120 m to 300 km.
const DIST = (() => {
  const d: number[] = [];
  for (let x = 40; x < 100e3; x += 40) d.push(x);
  for (let x = 100e3; x <= 300e3; x += 120) d.push(x);
  return Float64Array.from(d);
})();
const COS_D = DIST.map((x) => Math.cos(x / MOON_RADIUS_M));
const SIN_D = DIST.map((x) => Math.sin(x / MOON_RADIUS_M));
const NO_DATA_M = -20000;

/** The pole itself is a singular point of the bearings; 2 m from it is close enough. */
const clampLat = (latDeg: number) => Math.max(-89.99994, Math.min(89.99994, latDeg));

export interface HorizonResult {
  /** Height of the ground at the point, metres above the 1737.4 km sphere. */
  elevationM: number;
  stepDeg: number;
  /** Elevation of the terrain horizon in degrees, [mast][azimuth]; azimuth from true north, clockwise. */
  elevDeg: Float32Array[];
  /** Distance in km of the terrain that sets it, [mast][azimuth]. */
  distKm: Float32Array[];
}

/**
 * Terrain horizon around a point, for observers `mastsM` metres above the ground.
 * The elevation angle of a terrain point at central angle d and radius rho, seen from radius rho0, is
 * atan2(rho·cos d − rho0, rho·sin d). Values are never clamped at zero: a high site sees below the horizontal.
 */
export function horizonAt(t: PolarTerrain, latDeg: number, lonDeg: number, mastsM: readonly number[], stepDeg = 0.25): HorizonResult {
  const lat = clampLat(latDeg) * D2R;
  const lon = lonDeg * D2R;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const sinLon = Math.sin(lon);
  const cosLon = Math.cos(lon);
  const ground = t.heightAt(clampLat(latDeg), lonDeg);
  const h0 = ground === ground ? ground : 0;
  const count = Math.round(360 / stepDeg);
  const m = mastsM.length;
  const rho0 = mastsM.map((mast) => MOON_RADIUS_M + h0 + mast);
  const elevDeg = mastsM.map(() => new Float32Array(count));
  const distKm = mastsM.map(() => new Float32Array(count));
  const best = new Float64Array(m);
  const bestAt = new Int32Array(m);
  const scale = (2 * MOON_RADIUS_M) / cosLat;
  for (let c = 0; c < count; c++) {
    const az = c * stepDeg * D2R;
    const sinA = Math.sin(az);
    const cosA = Math.cos(az);
    best.fill(-Infinity);
    for (let k = 0; k < DIST.length; k++) {
      const cd = COS_D[k];
      const sd = SIN_D[k];
      // The sample on the sphere, then on the projection plane, without a trigonometric call:
      // (u, v) = cos(lat)·cos(lat2)·(sin Δlon, cos Δlon), and the stereographic radius is 2R·cos(lat2)/(1 − sin(lat2)).
      const sinLat2 = sinLat * cd + cosLat * sd * cosA;
      const q = scale / (1 - sinLat2);
      const ex = q * sinA * sd * cosLat;
      const ey = q * (cd - sinLat * sinLat2);
      const h = t.height(ex * cosLon + ey * sinLon, ey * cosLon - ex * sinLon);
      const rho = MOON_RADIUS_M + (h === h ? h : NO_DATA_M);
      // tan(elevation) = (rho·cd − rho0) / (rho·sd): the largest tangent is the horizon.
      const a = cd / sd;
      const b = 1 / (rho * sd);
      for (let i = 0; i < m; i++) {
        const tan = a - rho0[i] * b;
        if (tan > best[i]) {
          best[i] = tan;
          bestAt[i] = k;
        }
      }
    }
    for (let i = 0; i < m; i++) {
      elevDeg[i][c] = Math.atan(best[i]) / D2R;
      distKm[i][c] = DIST[bestAt[i]] / 1000;
    }
  }
  return { elevationM: h0, stepDeg, elevDeg, distKm };
}

// ---------- Terrain of the 3D view: the same four nested grids as tools/build_terrain.py ----------

const N = 257;
const SPACING_M = [5, 50, 400, 2400];
const UNIT_M = [0.0625, 0.25, 0.5, 2.5];
const OVERSAMPLE = [1, 5, 4, 3];

/**
 * Four nested square grids centred on the point, 257 × 257 samples each (5, 50, 400 and 2400 m apart): the height
 * of the ground above the plane tangent to the Moon at the point, so the curvature is in the data. Same layout
 * and units as public/data/terrain/<id>.bin.
 */
export function terrainTiles(t: PolarTerrain, latDeg: number, lonDeg: number): Int16Array {
  const lat = clampLat(latDeg) * D2R;
  const lon = lonDeg * D2R;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const sinLon = Math.sin(lon);
  const cosLon = Math.cos(lon);
  const scale = (2 * MOON_RADIUS_M) / cosLat;
  const ground = t.heightAt(clampLat(latDeg), lonDeg);
  const h0 = ground === ground ? ground : 0;
  const out = new Int16Array(N * N * 4);
  for (let level = 0; level < 4; level++) {
    const over = OVERSAMPLE[level];
    const k = over >> 1;
    const n = (N - 1) * over + 1 + 2 * k;
    const step = SPACING_M[level] / over;
    const y = new Float64Array(n * n);
    let lowest = Infinity;
    let holes = 0;
    for (let r = 0; r < n; r++) {
      const north = (r - (n >> 1)) * step;
      for (let c = 0; c < n; c++) {
        const east = (c - (n >> 1)) * step;
        const dist = Math.hypot(east, north);
        const d = dist / MOON_RADIUS_M;
        const cd = Math.cos(d);
        const sd = Math.sin(d);
        const sinA = dist > 0 ? east / dist : 0;
        const cosA = dist > 0 ? north / dist : 1;
        const sinLat2 = sinLat * cd + cosLat * sd * cosA;
        const q = scale / (1 - sinLat2);
        const ex = q * sinA * sd * cosLat;
        const ey = q * (cd - sinLat * sinLat2);
        const h = t.height(ex * cosLon + ey * sinLon, ey * cosLon - ex * sinLon);
        if (h === h) {
          y[r * n + c] = (MOON_RADIUS_M + h) * cd - (MOON_RADIUS_M + h0);
          if (h < lowest) lowest = h;
        } else {
          y[r * n + c] = NaN;
          holes++;
        }
      }
    }
    if (holes) {
      // Beyond the model (past 75°S): the lowest height seen, as the offline tool does.
      const fill = lowest === Infinity ? 0 : lowest;
      for (let r = 0; r < n; r++) {
        const north = (r - (n >> 1)) * step;
        for (let c = 0; c < n; c++) {
          if (y[r * n + c] === y[r * n + c]) continue;
          const d = Math.hypot((c - (n >> 1)) * step, north) / MOON_RADIUS_M;
          y[r * n + c] = (MOON_RADIUS_M + fill) * Math.cos(d) - (MOON_RADIUS_M + h0);
        }
      }
    }
    const w = 2 * k + 1;
    const base = level * N * N;
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        let sum = 0;
        for (let dr = 0; dr < w; dr++) {
          const row = (r * over + dr) * n + c * over;
          for (let dc = 0; dc < w; dc++) sum += y[row + dc];
        }
        const v = Math.round(sum / (w * w) / UNIT_M[level]);
        out[base + r * N + c] = Math.max(-32767, Math.min(32767, v));
      }
    }
  }
  return out;
}

// ---------- The files of public/data/polar ----------

export interface PolarIndex {
  radiusM: number;
  unitM: number;
  /** The model serves points from the pole to this latitude. */
  minLat: number;
  near: { n: number; stepM: number; tile: number; tiles: string[] };
  far: { n: number; stepM: number };
}

/** Undoes the row-wise differences of a grid file, in place. */
export function undoDifferences(a: Int16Array, width: number): Int16Array {
  for (let row = 0; row < a.length; row += width) {
    for (let i = row + 1; i < row + width; i++) a[i] = a[i] + a[i - 1];
  }
  return a;
}

/** One patch out of the 3 × 3 dense tiles around (ti, tj); tiles the model does not have are left out of the rectangle. */
export function joinTiles(tiles: Map<string, Int16Array>, ti: number, tj: number, index: PolarIndex): Patch | null {
  const size = index.near.tile;
  // The largest rectangle of tiles around the centre in which every tile exists: the centre row and column decide.
  if (!tiles.has(`${ti}_${tj}`)) return null;
  let i0 = ti;
  let i1 = ti;
  let j0 = tj;
  let j1 = tj;
  const full = (a0: number, a1: number, b0: number, b1: number) => {
    for (let j = b0; j <= b1; j++) for (let i = a0; i <= a1; i++) if (!tiles.has(`${i}_${j}`)) return false;
    return true;
  };
  if (full(i0 - 1, i1, j0, j1)) i0--;
  if (full(i0, i1 + 1, j0, j1)) i1++;
  if (full(i0, i1, j0 - 1, j1)) j0--;
  if (full(i0, i1, j0, j1 + 1)) j1++;
  const w = (i1 - i0 + 1) * size;
  const h = (j1 - j0 + 1) * size;
  const a = new Int16Array(w * h);
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const tile = tiles.get(`${i}_${j}`)!;
      for (let r = 0; r < size; r++) a.set(tile.subarray(r * size, (r + 1) * size), ((j - j0) * size + r) * w + (i - i0) * size);
    }
  }
  return { a, n: index.near.n, stepM: index.near.stepM, oi: i0 * size, oj: j0 * size, w, h };
}
