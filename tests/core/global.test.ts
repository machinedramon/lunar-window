import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { geoTilesFor, GeoTerrain, horizonAt, joinGeoTiles, REACH_GLOBAL, terrainTiles, unpackSecond, type GeoPatch, type GlobalIndex } from '../../src/core/polar';

const GLOBAL = 'public/data/global';
const index = JSON.parse(readFileSync(`${GLOBAL}/index.json`, 'utf8')) as GlobalIndex;
const grid = (path: string, width: number): Int16Array => unpackSecond(gunzipSync(readFileSync(path)), width);
const farWidth = 360 * index.far.ppd;
const far: GeoPatch = { a: grid(`${GLOBAL}/far.bin.gz`, farWidth), ppd: index.far.ppd, oi: 0, oj: 0, w: farWidth, h: 180 * index.far.ppd };

/** The model as the page builds it: three rows of dense tiles around the point, the coarse grid beyond. */
function modelAt(lat: number, lon: number): GeoTerrain {
  const { cols, rows } = geoTilesFor(lat, lon, index.near.ppd, index.near.tile);
  const near = joinGeoTiles((c, r) => grid(`${GLOBAL}/near/${c}_${r}.bin.gz`, index.near.tile), cols, rows, index.near.ppd, index.near.tile);
  return new GeoTerrain(index.unitM, far, near);
}

interface Golden {
  lat: number;
  lon: number;
  elevationM: number;
  stepDeg: number;
  mastsM: number[];
  elevDeg: number[][];
  distKm: number[][];
}

describe('terrain horizon of any point of the Moon, from the global model', () => {
  it('matches the offline tool (tools/lunar.py) on NASA LOLA terrain', () => {
    const golden = JSON.parse(readFileSync('tests/terrain/global-horizon.json', 'utf8')) as Golden[];
    expect(golden.length).toBe(5);
    for (const g of golden) {
      const r = horizonAt(modelAt(g.lat, g.lon), g.lat, g.lon, g.mastsM, g.stepDeg, REACH_GLOBAL);
      expect(Math.abs(r.elevationM - g.elevationM)).toBeLessThan(0.01);
      let worst = 0;
      let moved = 0;
      for (let m = 0; m < g.mastsM.length; m++) {
        for (let k = 0; k < g.elevDeg[m].length; k++) {
          worst = Math.max(worst, Math.abs(r.elevDeg[m][k] - g.elevDeg[m][k]));
          if (Math.abs(r.distKm[m][k] - g.distKm[m][k]) > 0.6) moved++;
        }
      }
      expect(worst).toBeLessThan(0.001);
      expect(moved).toBeLessThanOrEqual(2);
    }
  });

  it('reads the whole Moon: the grid wraps at 0°E and holds at the poles', () => {
    const coarse = new GeoTerrain(index.unitM, far, null);
    // The same place named with two longitudes.
    expect(coarse.heightAt(10, 359.99)).toBeCloseTo(coarse.heightAt(10, -0.01), 6);
    // Close to the pole every longitude is nearly the same ground.
    expect(Math.abs(coarse.heightAt(89.99, 0) - coarse.heightAt(89.99, 180))).toBeLessThan(400);
    // Known ground: Mare Crisium lies kilometres below the mean sphere, the far-side highlands kilometres above it.
    expect(coarse.heightAt(17, 59)).toBeLessThan(-2500);
    expect(coarse.heightAt(5, -158)).toBeGreaterThan(3000);
  });

  it('builds the terrain of the 3D view at an Apollo site', () => {
    const lat = 20.19;
    const lon = 30.77;
    const tiles = terrainTiles(modelAt(lat, lon), lat, lon);
    expect(tiles.length).toBe(257 * 257 * 4);
    expect(Math.abs(tiles[128 * 257 + 128] * 0.0625)).toBeLessThan(0.1);
    // Taurus-Littrow is a valley: within 12 km the massifs stand more than a kilometre above the floor.
    let highest = -Infinity;
    for (let k = 2 * 257 * 257; k < 3 * 257 * 257; k++) {
      const r = Math.floor((k - 2 * 257 * 257) / 257) - 128;
      const c = ((k - 2 * 257 * 257) % 257) - 128;
      if (Math.hypot(r, c) * 400 < 12000) highest = Math.max(highest, tiles[k] * 0.5);
    }
    expect(highest).toBeGreaterThan(1000);
  });
});
