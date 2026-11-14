import { describe, expect, it } from 'vitest';
import { earthAxes, eclipseCoverage, lookAt, separation, siteFrame, sky, type View } from '../../src/core/ephemeris';

type Row = [string, number, number, number];
interface Golden {
  site: { lat: number; lonE: number };
  sun: Row[];
  earth: Row[];
}

const files = import.meta.glob<Golden>('../golden/*.json', { eager: true, import: 'default' });

describe('Sun and Earth seen from the Moon, against JPL Horizons', () => {
  for (const [path, g] of Object.entries(files)) {
    const name = path.split('/').pop()!.replace('.json', '');
    it(name, () => {
      const frame = siteFrame(g.site.lat, g.site.lonE, 0);
      let maxEl = 0;
      let maxAz = 0;
      let maxDiam = 0;
      for (const body of ['sun', 'earth'] as const) {
        for (const [iso, az, el, diam] of g[body]) {
          const v = lookAt(sky(new Date(iso)), frame)[body];
          maxEl = Math.max(maxEl, Math.abs(v.el - el));
          // Azimuth error measured on the sky: near the zenith a large azimuth change is a tiny angle.
          const dAz = ((v.az - az + 540) % 360) - 180;
          maxAz = Math.max(maxAz, Math.abs(dAz) * Math.cos((el * Math.PI) / 180));
          maxDiam = Math.max(maxDiam, Math.abs((v.radius * 7200) / diam - 1));
        }
      }
      console.log(`${name}: max error elevation ${maxEl.toFixed(4)} deg, azimuth ${maxAz.toFixed(4)} deg, diameter ${(maxDiam * 100).toFixed(3)} %`);
      expect(maxEl).toBeLessThan(0.01);
      expect(maxAz).toBeLessThan(0.01);
      expect(maxDiam).toBeLessThan(0.005);
    });
  }
});

describe('lunar eclipse of 14 March 2025, seen from the Blue Ghost landing site', () => {
  const g = files['../golden/blue-ghost-eclipse-2025.json'];
  const frame = siteFrame(g.site.lat, g.site.lonE, 0);
  const jpl = (row: Row): View => ({ az: row[1], el: row[2], radius: row[3] / 7200, distKm: 0 });

  it('finds the Sun behind the Earth at the same hours as the JPL table', () => {
    let hidden = 0;
    for (let i = 0; i < g.sun.length; i++) {
      const fromJpl = eclipseCoverage(jpl(g.sun[i]), jpl(g.earth[i]));
      const v = lookAt(sky(new Date(g.sun[i][0])), frame);
      const ours = eclipseCoverage(v.sun, v.earth);
      expect(Math.abs(ours - fromJpl)).toBeLessThan(0.03);
      if (ours === 1) hidden++;
    }
    expect(hidden).toBeGreaterThan(0);
  });

  it('is total around 07:00 UTC and absent a day earlier', () => {
    const during = lookAt(sky(new Date('2025-03-14T07:00Z')), frame);
    expect(eclipseCoverage(during.sun, during.earth)).toBe(1);
    expect(separation(during.sun, during.earth)).toBeLessThan(during.earth.radius - during.sun.radius);
    const before = lookAt(sky(new Date('2025-03-13T07:00Z')), frame);
    expect(eclipseCoverage(before.sun, before.earth)).toBe(0);
  });
});

describe('orientation of the Earth', () => {
  it('puts the right part of the Earth under the Moon', () => {
    // 14 March 2025, 06:59 UTC: greatest eclipse, with the Moon overhead in the Pacific off Mexico (about 2.5 N, 105.7 W... the Americas saw it high in the sky).
    const date = new Date('2025-03-14T06:59Z');
    const { north, greenwich } = earthAxes(date);
    const s = sky(date);
    const toMoon = [-s.earth[0], -s.earth[1], -s.earth[2]];
    const len = Math.hypot(toMoon[0], toMoon[1], toMoon[2]);
    const east90 = [north[1] * greenwich[2] - north[2] * greenwich[1], north[2] * greenwich[0] - north[0] * greenwich[2], north[0] * greenwich[1] - north[1] * greenwich[0]];
    const dotv = (a: number[], b: readonly number[]) => (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / len;
    const lat = (Math.asin(dotv(toMoon, north)) * 180) / Math.PI;
    const lon = (Math.atan2(dotv(toMoon, east90), dotv(toMoon, greenwich)) * 180) / Math.PI;
    console.log(`sub-lunar point at greatest eclipse: ${lat.toFixed(1)} deg latitude, ${lon.toFixed(1)} deg longitude`);
    expect(Math.abs(lat)).toBeLessThan(6); // the Moon was close to the equator, opposite the March Sun
    expect(lon).toBeGreaterThan(-125);
    expect(lon).toBeLessThan(-85); // over the eastern Pacific and the Americas
    // The two axes are perpendicular unit vectors.
    expect(Math.hypot(...north)).toBeCloseTo(1, 6);
    expect(north[0] * greenwich[0] + north[1] * greenwich[1] + north[2] * greenwich[2]).toBeCloseTo(0, 6);
  });
});
