import { describe, expect, it } from 'vitest';
import cr1Data from '../../public/data/horizons/cr1.json';
import ringData from '../../public/data/horizons/cr1.ring.json';
import { buildCalendar } from '../../src/core/calendar';
import { siteFrame } from '../../src/core/ephemeris';
import { findEvents, instant } from '../../src/core/events';
import { Horizon, type HorizonData, type RingData } from '../../src/core/horizon';
import { evaluate, prepare, PROFILES, SUN_PRESENT } from '../../src/core/requirements';
import { DAY_STEPS, pointSeries, sampleSky, STEP_MS } from '../../src/core/series';

const data = cr1Data as unknown as HorizonData;
const ring = ringData as unknown as RingData;
const horizon = Horizon.fromData(data);
const frame = siteFrame(data.lat, data.lon, data.elevationM + 2);
const startMs = Date.UTC(2027, 0, 1);

describe('real site: Connecting Ridge, from 1 January 2027', () => {
  const t0 = performance.now();
  const samples = sampleSky({ startMs, stepMs: STEP_MS, count: (365 + 100) * DAY_STEPS });
  const skyMs = performance.now() - t0;
  const series = pointSeries(samples, frame, horizon, 1);

  it('computes a year of Sun and Earth positions quickly enough for the calendar', () => {
    console.log(`sky for ${samples.grid.count} steps: ${skyMs.toFixed(0)} ms`);
    expect(skyMs).toBeLessThan(5000);
  });

  it('finds sunrise and sunset within 10 minutes of a one-minute scan', () => {
    const events = findEvents(series, samples.grid, frame, horizon, 1, 0, 0, samples.grid.count).filter((e) => e.kind === 'sunrise' || e.kind === 'sunset');
    expect(events.length).toBeGreaterThan(2);
    for (const ev of events.slice(0, 4)) {
      // Reference: scan minute by minute around the event. A jagged skyline can make the Sun flicker
      // across the threshold several times within the hour, so compare with the nearest crossing.
      let ref = NaN;
      const from = ev.timeMs - 45 * 60000;
      let prev = instant(from, frame, horizon, 1).sunFrac >= SUN_PRESENT;
      for (let m = 1; m <= 90; m++) {
        const now = instant(from + m * 60000, frame, horizon, 1).sunFrac >= SUN_PRESENT;
        if (now !== prev) {
          const at = from + (m - 0.5) * 60000;
          if (Number.isNaN(ref) || Math.abs(at - ev.timeMs) < Math.abs(ref - ev.timeMs)) ref = at;
        }
        prev = now;
      }
      expect(Math.abs(ev.timeMs - ref)).toBeLessThan(10 * 60000);
    }
  });

  it('builds a calendar that agrees with direct evaluation and is neither empty nor full', () => {
    const req = PROFILES[1].req;
    const points = [prepare(series, req.earthMarginDeg)];
    for (const p of ring.points) {
      const f = siteFrame(p.lat, p.lon, p.elevationM + 2);
      points.push(prepare(pointSeries(samples, f, Horizon.fromCentidegrees(ring.stepDeg, p.elevCdeg), req.mast), req.earthMarginDeg));
    }
    const t1 = performance.now();
    const cal = buildCalendar(points, req, 0, 365);
    console.log(`calendar of 365 days x 9 points: ${(performance.now() - t1).toFixed(1)} ms`);
    const viable = Array.from(cal.status).filter((s) => s > 0).length;
    console.log(`viable landing days in 2027 for "${PROFILES[1].label}": ${viable}`);
    expect(viable).toBeGreaterThan(0);
    expect(viable).toBeLessThan(365);
    expect(cal.points).toBe(9);
    for (let k = 0; k < 100; k++) {
      const d = (k * 37) % 365;
      const direct = evaluate(points[0], d * DAY_STEPS + [0, 12, 24, 36][cal.bestTime[d]], req);
      expect(cal.status[d] > 0).toBe(direct.status !== 'fail');
      expect(cal.robust[d]).toBeLessThanOrEqual(9);
    }
  });
});
