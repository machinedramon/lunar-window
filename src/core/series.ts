// Time series of what a point on the Moon sees: how much of the Sun is visible and how
// far the Earth is above the terrain. The planner works on these series.
import { EARTH_RADIUS_KM, SUN_RADIUS_KM, eclipseCoverage, look, sky, type SiteFrame } from './ephemeris';
import { discFraction, type Horizon } from './horizon';

export const STEP_MS = 30 * 60 * 1000;
export const STEP_H = 0.5;
export const DAY_STEPS = 48;

export interface TimeGrid {
  startMs: number;
  stepMs: number;
  count: number;
}

/** Sun and Earth positions (Moon-fixed, km) at every step. Computed once, shared by all sites. */
export interface SkySamples {
  grid: TimeGrid;
  sun: Float64Array;
  earth: Float64Array;
}

export function sampleSky(grid: TimeGrid): SkySamples {
  const sun = new Float64Array(grid.count * 3);
  const earth = new Float64Array(grid.count * 3);
  for (let i = 0; i < grid.count; i++) {
    const s = sky(new Date(grid.startMs + i * grid.stepMs));
    sun.set(s.sun, i * 3);
    earth.set(s.earth, i * 3);
  }
  return { grid, sun, earth };
}

export interface PointSeries {
  /** Visible fraction of the solar disc, 0 to 1, after terrain and eclipses. */
  sunFrac: Float32Array;
  /** Elevation of the centre of the Earth above the terrain horizon in its direction, degrees. */
  earthClear: Float32Array;
  /** Elevation of the centre of the Sun above the horizontal, degrees. */
  sunEl: Float32Array;
  /** Fraction of the Sun hidden by the Earth (lunar eclipse), 0 to 1. */
  eclipse: Float32Array;
}

export function pointSeries(samples: SkySamples, frame: SiteFrame, horizon: Horizon, mast: number): PointSeries {
  const n = samples.grid.count;
  const out: PointSeries = {
    sunFrac: new Float32Array(n),
    earthClear: new Float32Array(n),
    sunEl: new Float32Array(n),
    eclipse: new Float32Array(n),
  };
  const { sun, earth } = samples;
  for (let i = 0; i < n; i++) {
    const k = i * 3;
    const s = look(sun[k], sun[k + 1], sun[k + 2], frame, SUN_RADIUS_KM);
    const e = look(earth[k], earth[k + 1], earth[k + 2], frame, EARTH_RADIUS_KM);
    let frac = discFraction(s.az, s.el, s.radius, horizon, mast);
    if (frac > 0) {
      const covered = eclipseCoverage(s, e);
      if (covered > 0) {
        out.eclipse[i] = covered;
        frac *= 1 - covered;
      }
    }
    out.sunFrac[i] = frac;
    out.sunEl[i] = s.el;
    out.earthClear[i] = e.el - horizon.at(e.az, mast);
  }
  return out;
}
