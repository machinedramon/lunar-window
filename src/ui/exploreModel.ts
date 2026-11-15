// Numbers behind the Explore screen: one instant, and the weeks that follow it.
import { EARTH_RADIUS_KM, SUN_RADIUS_KM, eclipseCoverage, look, lookAt, sky, type View } from '../core/ephemeris';
import { findEvents, type SkyEvent } from '../core/events';
import { discFraction } from '../core/horizon';
import { DAY_STEPS, pointSeries, sampleSky, STEP_MS, type PointSeries, type TimeGrid } from '../core/series';
import { frameOf, type LoadedSite } from './data';
import { DAY_MS } from './format';

export const EXPLORE_DAYS = 30;

export interface Moment {
  sun: View;
  earth: View;
  /** Visible fraction of the solar disc after terrain and eclipse. */
  sunFrac: number;
  /** Fraction of the Sun hidden by the Earth. */
  eclipse: number;
  /** Centre of the Earth above the terrain in its direction, degrees. */
  earthClear: number;
}

export function momentAt(loaded: LoadedSite, mast: number, timeMs: number): Moment {
  const v = lookAt(sky(new Date(timeMs)), frameOf(loaded.site, mast));
  const eclipse = eclipseCoverage(v.sun, v.earth);
  return {
    sun: v.sun,
    earth: v.earth,
    eclipse,
    sunFrac: discFraction(v.sun.az, v.sun.el, v.sun.radius, loaded.horizon, mast) * (1 - eclipse),
    earthClear: v.earth.el - loaded.horizon.at(v.earth.az, mast),
  };
}

export interface Outlook {
  key: string;
  grid: TimeGrid;
  series: PointSeries;
  events: SkyEvent[];
  /** [az, el, ...] every two hours */
  sunPath: Float32Array;
  earthPath: Float32Array;
  /** Mean azimuth of the Earth over the period: a stable centre for the panorama. */
  earthAz: number;
  sunElMax: number;
}

/** The last few outlooks, most recent last: going back to a height or a day already seen costs nothing. */
const kept = new Map<string, Outlook>();
/** Where the Sun and the Earth are over the period does not depend on the site: computed once per starting day. */
let sampled: { startMs: number; samples: ReturnType<typeof sampleSky> } | null = null;

/** The 30 days starting at 00:00 UTC of the day of `timeMs`. Cached: moving within the day costs nothing. */
export function outlookFor(loaded: LoadedSite, mast: number, timeMs: number): Outlook {
  const startMs = Math.floor(timeMs / DAY_MS) * DAY_MS;
  const key = `${loaded.site.id}/${loaded.site.lat}/${loaded.site.lon}/${mast}/${startMs}`;
  const have = kept.get(key);
  if (have) {
    kept.delete(key);
    kept.set(key, have);
    return have;
  }
  const grid: TimeGrid = { startMs, stepMs: STEP_MS, count: (EXPLORE_DAYS + 1) * DAY_STEPS };
  if (!sampled || sampled.startMs !== startMs) sampled = { startMs, samples: sampleSky(grid) };
  const samples = sampled.samples;
  const frame = frameOf(loaded.site, mast);
  const series = pointSeries(samples, frame, loaded.horizon, mast);
  const events = findEvents(series, grid, frame, loaded.horizon, mast, 0, 0, grid.count);
  const every = 4;
  const count = Math.floor(grid.count / every);
  const sunPath = new Float32Array(count * 2);
  const earthPath = new Float32Array(count * 2);
  let sx = 0;
  let sy = 0;
  let sunElMax = -90;
  for (let i = 0; i < count; i++) {
    const k = i * every * 3;
    const s = look(samples.sun[k], samples.sun[k + 1], samples.sun[k + 2], frame, SUN_RADIUS_KM);
    const e = look(samples.earth[k], samples.earth[k + 1], samples.earth[k + 2], frame, EARTH_RADIUS_KM);
    sunPath[i * 2] = s.az;
    sunPath[i * 2 + 1] = s.el;
    earthPath[i * 2] = e.az;
    earthPath[i * 2 + 1] = e.el;
    sx += Math.cos((e.az * Math.PI) / 180);
    sy += Math.sin((e.az * Math.PI) / 180);
    sunElMax = Math.max(sunElMax, s.el);
  }
  const made = { key, grid, series, events, sunPath, earthPath, earthAz: ((Math.atan2(sy, sx) * 180) / Math.PI + 360) % 360, sunElMax };
  kept.set(key, made);
  if (kept.size > 9) kept.delete(kept.keys().next().value as string);
  return made;
}

/**
 * Prepares, while the browser has nothing else to do, the outlook of the other antenna heights: a change of
 * height then answers at once.
 */
export function warmOutlooks(loaded: LoadedSite, masts: number[], timeMs: number): void {
  const idle = (window as unknown as { requestIdleCallback?: (fn: () => void, options?: { timeout: number }) => number }).requestIdleCallback;
  const later = (fn: () => void) => (idle ? idle(fn, { timeout: 2000 }) : window.setTimeout(fn, 300));
  // Not while the camera is arriving at the place: a pause in the middle of that move would be seen.
  window.setTimeout(() => {
    for (const mast of masts) later(() => void outlookFor(loaded, mast, timeMs));
  }, 7000);
}

/** Vertical range of the panorama, in degrees: tight around the horizon at the pole, the whole sky elsewhere. */
export function elevationRange(loaded: LoadedSite, mast: number): [number, number] {
  if (loaded.horizon.kind === 'sphere') return [-10, 90];
  // Highest the Sun (1.6 degrees of lunar tilt) and the Earth (about 8 degrees of libration, plus its radius) can climb here.
  const colat = 90 - Math.abs(loaded.site.lat);
  const top = Math.ceil(Math.max(8, loaded.horizon.max[mast] + 1.5, colat + 8.5));
  const bottom = Math.min(-6, Math.floor(loaded.horizon.min[mast]) - 1);
  return [bottom, top];
}
