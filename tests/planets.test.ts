// The planets as a telescope on the Moon sees them, against NASA's JPL Horizons System.
// Reference: Horizons, observer at the centre of the Moon (500@301), 2027-Feb-07 00:00 UTC, quantities
// 10 (illuminated fraction), 13 (angular diameter), 14 (longitude and latitude of the centre of the disc) and
// 20 (distance). Horizons gives the longitude positive to the west, except for Venus, which turns backwards
// and has it positive to the east; ours is positive to the east for all.
import { describe, expect, it } from 'vitest';
import { planetView } from '../src/core/ephemeris';

const WHEN = new Date(Date.UTC(2027, 1, 7));
// name: [illuminated %, diameter in arcseconds, longitude as Horizons gives it, latitude, distance in au]
const HORIZONS: Record<string, [number, number, number, number, number]> = {
  Mercury: [35.85488, 7.90725, 106.369999, -8.143271, 0.85111525764243],
  Venus: [65.52762, 17.96322, 193.951408, -1.608222, 0.92903071905383],
  Mars: [99.15168, 13.38848, 267.939764, 21.254418, 0.6995043193635],
  Jupiter: [99.99424, 45.15555, 340.369813, -0.510796, 4.36592217554602],
  Saturn: [99.82561, 16.69249, 96.719901, -9.292032, 9.95623831927682],
};

describe('planets through the telescope', () => {
  for (const [name, [lit, arcsec, westLon, lat, au]] of Object.entries(HORIZONS)) {
    it(`${name}: size, phase, distance and how it is turned`, () => {
      const p = planetView(name, WHEN)!;
      expect(Math.abs(p.distanceAu / au - 1)).toBeLessThan(2e-4);
      expect(p.arcsec / arcsec).toBeCloseTo(1, 2);
      expect(Math.abs(p.lit * 100 - lit)).toBeLessThan(0.3);
      // Latitude: ours is measured from the centre of the planet, Horizons' from its flattened surface (for Saturn
      // the two are nearly two degrees apart); ours is converted before the two are compared.
      const k = Math.PI / 180;
      const surface = Math.atan(Math.tan(p.subLat * k) / (1 - p.flattening) ** 2) / k;
      expect(Math.abs(surface - lat)).toBeLessThan(0.05);
      const east = name === 'Venus' ? westLon : (360 - westLon) % 360;
      const off = Math.abs(((p.subLon - east + 540) % 360) - 180);
      expect(off).toBeLessThan(1);
    });
  }
});
