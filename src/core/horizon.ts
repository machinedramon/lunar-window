// Terrain horizon of a site and how much of a disc shows above it.

/** File written by tools/build_horizon.py: public/data/horizons/<id>.json */
export interface HorizonData {
  siteId: string;
  lat: number;
  lon: number;
  elevationM: number;
  stepDeg: number;
  mastsM: number[];
  /** Horizon elevation in degrees, [mast][azimuth]. Negative values are real: a high site sees the ground below the horizontal. */
  elevDeg: number[][];
  /** Distance in km of the terrain point that sets the horizon, [mast][azimuth]. */
  distKm: number[][];
  dem: string[];
  generated: string;
}

/** File public/data/horizons/<id>.ring.json: eight points around the site, in hundredths of a degree. */
export interface RingData {
  siteId: string;
  radiusM: number;
  stepDeg: number;
  mastsM: number[];
  points: { bearingDeg: number; lat: number; lon: number; elevationM: number; elevCdeg: number[][] }[];
}

export const MAST_HEIGHTS_M = [0, 2, 10] as const;

export class Horizon {
  readonly kind: 'terrain' | 'sphere';
  readonly stepDeg: number;
  readonly count: number;
  readonly min: number[];
  readonly max: number[];
  private readonly profiles: Float32Array[];

  private constructor(kind: 'terrain' | 'sphere', stepDeg: number, profiles: Float32Array[]) {
    this.kind = kind;
    this.stepDeg = stepDeg;
    this.profiles = profiles;
    this.count = profiles[0].length;
    this.min = profiles.map((p) => p.reduce((a, b) => Math.min(a, b), Infinity));
    this.max = profiles.map((p) => p.reduce((a, b) => Math.max(a, b), -Infinity));
  }

  static fromData(d: HorizonData): Horizon {
    return new Horizon('terrain', d.stepDeg, d.elevDeg.map((row) => Float32Array.from(row)));
  }

  static fromDegrees(stepDeg: number, rows: number[][]): Horizon {
    return new Horizon('terrain', stepDeg, rows.map((row) => Float32Array.from(row)));
  }

  static fromCentidegrees(stepDeg: number, rows: number[][]): Horizon {
    return new Horizon('terrain', stepDeg, rows.map((row) => Float32Array.from(row, (v) => v / 100)));
  }

  /** Smooth sphere: the horizon is the horizontal, for every mast height. Used where no terrain profile exists. */
  static sphere(): Horizon {
    return new Horizon('sphere', 360, MAST_HEIGHTS_M.map(() => new Float32Array(1)));
  }

  /** Horizon elevation in a direction, by linear interpolation. `mast` indexes MAST_HEIGHTS_M. */
  at(azDeg: number, mast: number): number {
    const p = this.profiles[mast];
    const n = this.count;
    let x = (azDeg / this.stepDeg) % n;
    if (x < 0) x += n;
    const i = Math.floor(x);
    const a = p[i % n];
    const b = p[(i + 1) % n];
    return a + (b - a) * (x - i);
  }

  profile(mast: number): Float32Array {
    return this.profiles[mast];
  }
}

const D2R = Math.PI / 180;

/**
 * Fraction of a disc above the horizon, 0 to 1.
 * The disc is cut into vertical columns; in each one the horizon is interpolated at the
 * azimuth of the column and the part of the chord above it is measured.
 */
export function discFraction(az: number, el: number, radius: number, horizon: Horizon, mast: number, columns = 11): number {
  if (el - radius >= horizon.max[mast]) return 1;
  if (el + radius <= horizon.min[mast]) return 0;
  const stretch = 1 / Math.max(0.05, Math.cos(el * D2R));
  let visible = 0;
  let total = 0;
  for (let k = 0; k < columns; k++) {
    const x = (((k + 0.5) / columns) * 2 - 1) * radius;
    const half = Math.sqrt(radius * radius - x * x);
    const above = el + half - horizon.at(az + x * stretch, mast);
    visible += above <= 0 ? 0 : above >= 2 * half ? 2 * half : above;
    total += 2 * half;
  }
  return visible / total;
}
