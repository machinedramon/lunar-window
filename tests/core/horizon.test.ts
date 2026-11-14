import { describe, expect, it } from 'vitest';
import { discFraction, Horizon, type HorizonData } from '../../src/core/horizon';

function flat(elevation: number, step = 0.25): Horizon {
  const n = Math.round(360 / step);
  const row = new Array<number>(n).fill(elevation);
  return Horizon.fromData({ stepDeg: step, elevDeg: [row, row, row] } as HorizonData);
}

describe('visible fraction of a disc', () => {
  const r = 0.27;
  it('is one half when a straight horizon cuts the disc through its centre', () => {
    expect(discFraction(123, 0, r, flat(0), 0)).toBeCloseTo(0.5, 2);
  });

  it('matches the area of a circular segment', () => {
    // Horizon half a radius below the centre: visible share = 1 - (acos(1/2) - (1/2)*sqrt(3)/2) / pi
    const expected = 1 - (Math.acos(0.5) - 0.5 * Math.sqrt(0.75)) / Math.PI;
    expect(Math.abs(discFraction(10, r / 2, r, flat(0), 0) - expected)).toBeLessThan(0.01);
    expect(Math.abs(discFraction(10, -r / 2, r, flat(0), 0) - (1 - expected))).toBeLessThan(0.01);
  });

  it('is 1 fully above and 0 fully below', () => {
    expect(discFraction(0, r + 0.01, r, flat(0), 0)).toBe(1);
    expect(discFraction(0, -r - 0.01, r, flat(0), 0)).toBe(0);
  });

  it('keeps a negative horizon negative', () => {
    // A site high above its surroundings sees the ground below the horizontal.
    const h = flat(-2.4);
    expect(h.at(77, 0)).toBeCloseTo(-2.4, 5);
    expect(discFraction(77, -1, r, h, 0)).toBe(1);
  });
});

describe('horizon profile', () => {
  const row = Array.from({ length: 1440 }, (_, i) => (i === 0 ? 4 : i === 1439 ? 2 : 0));
  const h = Horizon.fromData({ stepDeg: 0.25, elevDeg: [row, row, row] } as HorizonData);

  it('interpolates linearly and wraps around north', () => {
    expect(h.at(0, 0)).toBeCloseTo(4, 5);
    expect(h.at(0.125, 0)).toBeCloseTo(2, 5);
    expect(h.at(359.875, 0)).toBeCloseTo(3, 5); // between the last sample (2) and the first (4)
    expect(h.at(360, 0)).toBeCloseTo(4, 5);
    expect(h.at(-0.25, 0)).toBeCloseTo(2, 5);
    expect(h.at(720.125, 0)).toBeCloseTo(2, 5);
  });

  it('a smooth sphere has a level horizon', () => {
    const s = Horizon.sphere();
    expect(s.kind).toBe('sphere');
    expect(s.at(211.3, 1)).toBe(0);
    expect(discFraction(40, 0, 0.27, s, 2)).toBeCloseTo(0.5, 2);
  });

  it('reads ring profiles stored in hundredths of a degree', () => {
    const ring = Horizon.fromCentidegrees(90, [[100, -250, 0, 50], [0, 0, 0, 0], [0, 0, 0, 0]]);
    expect(ring.at(90, 0)).toBeCloseTo(-2.5, 5);
    expect(ring.at(45, 0)).toBeCloseTo(-0.75, 5);
  });
});
