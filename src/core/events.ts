// Rise and set times of the Sun and the Earth at a point, and eclipses.
import { EARTH_RADIUS_KM, SUN_RADIUS_KM, eclipseCoverage, look, sky, type SiteFrame } from './ephemeris';
import { discFraction, type Horizon } from './horizon';
import { SUN_PRESENT } from './requirements';
import type { PointSeries, TimeGrid } from './series';

export type EventKind = 'sunrise' | 'sunset' | 'earthrise' | 'earthset' | 'eclipse-start' | 'eclipse-end';

export interface SkyEvent {
  kind: EventKind;
  /** Milliseconds since the Unix epoch, UTC. */
  timeMs: number;
}

/** What one instant looks like from a point, computed directly (not from a series). */
export interface Instant {
  sunFrac: number;
  earthClear: number;
  eclipse: number;
}

export function instant(timeMs: number, frame: SiteFrame, horizon: Horizon, mast: number): Instant {
  const s = sky(new Date(timeMs));
  const sun = look(s.sun[0], s.sun[1], s.sun[2], frame, SUN_RADIUS_KM);
  const earth = look(s.earth[0], s.earth[1], s.earth[2], frame, EARTH_RADIUS_KM);
  const eclipse = eclipseCoverage(sun, earth);
  return {
    sunFrac: discFraction(sun.az, sun.el, sun.radius, horizon, mast) * (1 - eclipse),
    earthClear: earth.el - horizon.at(earth.az, mast),
    eclipse,
  };
}

/** Time between lo and hi (ms) where f crosses the threshold, by bisection to within a few seconds. */
function bisect(f: (ms: number) => number, lo: number, hi: number, threshold: number): number {
  const rising = f(hi) >= threshold;
  for (let k = 0; k < 9; k++) {
    const mid = (lo + hi) / 2;
    if (f(mid) >= threshold === rising) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Events in a series between step indices `from` and `to`, each refined by bisection
 * inside the 30-minute step where it happens.
 */
export function findEvents(
  series: PointSeries,
  grid: TimeGrid,
  frame: SiteFrame,
  horizon: Horizon,
  mast: number,
  earthMarginDeg: number,
  from: number,
  to: number,
  limit = 64,
): SkyEvent[] {
  const out: SkyEvent[] = [];
  const t = (i: number) => grid.startMs + i * grid.stepMs;
  const end = Math.min(to, series.sunFrac.length - 1);
  for (let i = Math.max(0, from); i < end && out.length < limit; i++) {
    const s0 = series.sunFrac[i] >= SUN_PRESENT;
    const s1 = series.sunFrac[i + 1] >= SUN_PRESENT;
    const inEclipse0 = series.eclipse[i] > 0;
    const inEclipse1 = series.eclipse[i + 1] > 0;
    if (inEclipse0 !== inEclipse1) {
      const at = bisect((ms) => instant(ms, frame, horizon, mast).eclipse, t(i), t(i + 1), 1e-6);
      out.push({ kind: inEclipse1 ? 'eclipse-start' : 'eclipse-end', timeMs: at });
    }
    if (s0 !== s1) {
      const at = bisect((ms) => instant(ms, frame, horizon, mast).sunFrac, t(i), t(i + 1), SUN_PRESENT);
      out.push({ kind: s1 ? 'sunrise' : 'sunset', timeMs: at });
    }
    const e0 = series.earthClear[i] > earthMarginDeg;
    const e1 = series.earthClear[i + 1] > earthMarginDeg;
    if (e0 !== e1) {
      const at = bisect((ms) => instant(ms, frame, horizon, mast).earthClear - earthMarginDeg, t(i), t(i + 1), 0);
      out.push({ kind: e1 ? 'earthrise' : 'earthset', timeMs: at });
    }
  }
  return out.sort((a, b) => a.timeMs - b.timeMs);
}
