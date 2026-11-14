import { describe, expect, it } from 'vitest';
import { buildCalendar, landingWindows, nextViableDay, STATUS_CODES } from '../../src/core/calendar';
import { evaluate, prepare, windowMetrics, type Requirements } from '../../src/core/requirements';
import type { PointSeries } from '../../src/core/series';

/** A synthetic point: `sun` and `earth` say, per 30-minute step, whether each is up. */
function point(sun: (i: number) => number, earth: (i: number) => boolean, n: number): PointSeries {
  return {
    sunFrac: Float32Array.from({ length: n }, (_, i) => sun(i)),
    earthClear: Float32Array.from({ length: n }, (_, i) => (earth(i) ? 1 : -1)),
    sunEl: new Float32Array(n),
    eclipse: new Float32Array(n),
  };
}

const base: Requirements = {
  durationDays: 2,
  sunAtLanding: true,
  minContinuousSunH: 0,
  maxDarknessH: 6,
  earthAtLanding: true,
  maxBlackoutH: 12,
  mast: 1,
  earthMarginDeg: 0,
};

describe('window metrics on a synthetic series', () => {
  // Sun down during steps 20..29 (5 h) and 60..63 (2 h); Earth down during steps 40..47 (4 h).
  const p = prepare(point((i) => ((i >= 20 && i < 30) || (i >= 60 && i < 64) ? 0 : 1), (i) => !(i >= 40 && i < 48), 200), 0);

  it('measures shares, longest gaps and time until the first gap', () => {
    const m = windowMetrics(p, 0, 96);
    expect(m.sunShare).toBeCloseTo(82 / 96, 6);
    expect(m.earthShare).toBeCloseTo(88 / 96, 6);
    expect(m.bothShare).toBeCloseTo(74 / 96, 6);
    expect(m.longestDarkH).toBe(5);
    expect(m.longestBlackoutH).toBe(4);
    expect(m.continuousSunH).toBe(10);
    expect(m.continuousEarthH).toBe(20);
    expect(m.powerIndex).toBeCloseTo(82 / 96, 6);
  });

  it('clips a gap that straddles the window', () => {
    expect(windowMetrics(p, 25, 62).longestDarkH).toBe(2.5); // steps 25..29, then 60..61
    expect(windowMetrics(p, 25, 62).continuousSunH).toBe(0);
    expect(windowMetrics(p, 30, 60).longestDarkH).toBe(0);
  });
});

describe('verdict', () => {
  const p = prepare(point((i) => ((i >= 20 && i < 30) || (i >= 60 && i < 64) ? 0 : 1), (i) => !(i >= 40 && i < 48), 200), 0);

  it('is viable when every requirement is met with room to spare', () => {
    const r = evaluate(p, 0, base);
    expect(r.status).toBe('ok');
    expect(r.failed).toBeNull();
  });

  it('names the first failed requirement in the fixed order', () => {
    expect(evaluate(p, 22, base).failed).toBe('sunAtLanding');
    expect(evaluate(p, 42, base).failed).toBe('earthAtLanding');
    expect(evaluate(p, 0, { ...base, minContinuousSunH: 11 }).failed).toBe('continuousSun');
    expect(evaluate(p, 0, { ...base, maxDarknessH: 4 }).failed).toBe('maxDarkness');
    expect(evaluate(p, 0, { ...base, maxBlackoutH: 3 }).failed).toBe('maxBlackout');
    // Sun and Earth both missing at landing: the Sun is reported.
    const both = prepare(point(() => 0, () => false, 200), 0);
    expect(evaluate(both, 0, base).failed).toBe('sunAtLanding');
  });

  it('is marginal with less than 10% to spare, or with a low Sun at landing', () => {
    expect(evaluate(p, 0, { ...base, maxDarknessH: 5.4 }).status).toBe('marginal');
    expect(evaluate(p, 0, { ...base, maxDarknessH: 5.4 }).tight).toBe('maxDarkness');
    expect(evaluate(p, 0, { ...base, maxDarknessH: 5.6 }).status).toBe('ok');
    const low = prepare(point((i) => (i === 0 ? 0.6 : 1), () => true, 200), 0);
    expect(evaluate(low, 0, base).status).toBe('marginal');
    expect(evaluate(low, 0, base).tight).toBe('sunAtLanding');
  });

  it('"no darkness at all" fails on a single dark step and is not marginal otherwise', () => {
    const strict = { ...base, maxDarknessH: 0, maxBlackoutH: 0 };
    expect(evaluate(p, 0, strict).failed).toBe('maxDarkness');
    const clear = prepare(point(() => 1, () => true, 200), 0);
    expect(evaluate(clear, 0, strict).status).toBe('ok');
  });

  it('ignores requirements that are switched off', () => {
    const off = { ...base, sunAtLanding: false, earthAtLanding: false, maxDarknessH: null, maxBlackoutH: null };
    expect(evaluate(p, 22, off).status).toBe('ok');
  });

  it('respects the Earth elevation margin', () => {
    const q = prepare(point(() => 1, () => true, 200), 2); // Earth 1 degree above the terrain, 2 required
    expect(evaluate(q, 0, { ...base, earthMarginDeg: 2 }).failed).toBe('earthAtLanding');
  });
});

describe('calendar', () => {
  // Fourteen days. The Sun is down from 06:00 on day 3 until the end of day 4; the ring point is also dark on day 6.
  const n = 48 * 14;
  const down = (i: number) => i >= 3 * 48 + 12 && i < 5 * 48;
  const centre = prepare(point((i) => (down(i) ? 0 : 1), () => true, n), 0);
  const ring = prepare(point((i) => (down(i) || (i >= 6 * 48 && i < 7 * 48) ? 0 : 1), () => true, n), 0);
  const req = { ...base, durationDays: 1, maxDarknessH: 0 };
  const cal = buildCalendar([centre, ring], req, 0, 10);

  it('takes the best of the four landing times of each day', () => {
    expect(Array.from(cal.status).map((s) => STATUS_CODES[s])).toEqual(['ok', 'ok', 'ok', 'fail', 'fail', 'ok', 'ok', 'ok', 'ok', 'ok']);
    expect(cal.timeMask[1]).toBe(0b1111);
    expect(cal.timeMask[2]).toBe(0b0011); // landing at 12:00 or 18:00 on day 2 runs into the dark of day 3
    expect(cal.failed[2]).toBe(0);
    expect(cal.failed[3]).toBe(4); // lands in sunlight at 00:00, then the darkness limit is broken
    expect(cal.failed[4]).toBe(1); // no Sun at landing
  });

  it('agrees with a direct evaluation of every cell', () => {
    for (let d = 0; d < 10; d++) {
      const direct = evaluate(centre, d * 48 + [0, 12, 24, 36][cal.bestTime[d]], req).status;
      expect(STATUS_CODES[cal.status[d]]).toBe(direct);
    }
  });

  it('counts how many points around the site are also viable', () => {
    expect(cal.points).toBe(2);
    expect(cal.robust[0]).toBe(2);
    expect(cal.robust[5]).toBe(2);
    expect(cal.robust[6]).toBe(1); // the ring point has no Sun on day 6
    expect(cal.robust[3]).toBe(0);
  });

  it('lists landing windows and the next viable day', () => {
    expect(landingWindows(cal)).toEqual([{ start: 5, length: 5 }, { start: 0, length: 3 }]);
    expect(nextViableDay(cal, 3)).toBe(5);
    expect(nextViableDay(cal, 0)).toBe(0);
  });
});
