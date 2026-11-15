import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { destination, horizonAt, joinTiles, MOON_RADIUS_M, PolarTerrain, terrainTiles, tileOf, toPlane, undoDifferences, type Patch, type PolarIndex } from '../../src/core/polar';

const POLAR = 'public/data/polar';
const index = JSON.parse(readFileSync(`${POLAR}/index.json`, 'utf8')) as PolarIndex;

function grid(path: string, width: number): Int16Array {
  const raw = gunzipSync(readFileSync(path));
  return undoDifferences(new Int16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2).slice(), width);
}

const far: Patch = { a: grid(`${POLAR}/far.bin.gz`, index.far.n), n: index.far.n, stepM: index.far.stepM, oi: 0, oj: 0, w: index.far.n, h: index.far.n };

/** The model as the page builds it: the nine dense tiles around the point, the coarse grid beyond. */
function modelAt(lat: number, lon: number): PolarTerrain {
  const [ti, tj] = tileOf(lat, lon, index.near.n, index.near.stepM, index.near.tile);
  const tiles = new Map<string, Int16Array>();
  for (let j = tj - 1; j <= tj + 1; j++) {
    for (let i = ti - 1; i <= ti + 1; i++) {
      if (index.near.tiles.includes(`${i}_${j}`)) tiles.set(`${i}_${j}`, grid(`${POLAR}/near/${i}_${j}.bin.gz`, index.near.tile));
    }
  }
  return new PolarTerrain(index.unitM, far, joinTiles(tiles, ti, tj, index));
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

describe('terrain horizon of any point near the south pole', () => {
  it('matches the offline tool (tools/lunar.py) on NASA LOLA terrain', () => {
    const golden = JSON.parse(readFileSync('tests/terrain/polar-horizon.json', 'utf8')) as Golden[];
    expect(golden.length).toBe(3);
    for (const g of golden) {
      const r = horizonAt(modelAt(g.lat, g.lon), g.lat, g.lon, g.mastsM, g.stepDeg);
      expect(Math.abs(r.elevationM - g.elevationM)).toBeLessThan(0.01);
      let worst = 0;
      let moved = 0;
      for (let m = 0; m < g.mastsM.length; m++) {
        for (let k = 0; k < g.elevDeg[m].length; k++) {
          worst = Math.max(worst, Math.abs(r.elevDeg[m][k] - g.elevDeg[m][k]));
          if (Math.abs(r.distKm[m][k] - g.distKm[m][k]) > 0.2) moved++;
        }
      }
      expect(worst).toBeLessThan(0.001);
      // The terrain that sets the horizon is the same one (two near-equal ridges may swap in a few directions).
      expect(moved).toBeLessThanOrEqual(2);
    }
  });

  it('gives the dip of the horizon on a smooth sphere', () => {
    const flat: Patch = { a: new Int16Array(64 * 64), n: 64, stepM: 20000, oi: 0, oj: 0, w: 64, h: 64 };
    const r = horizonAt(new PolarTerrain(0.5, flat, null), -88, 40, [0, 2, 1000], 45);
    for (let k = 0; k < 8; k++) {
      // From the ground the nearest sample (40 m away) is the horizon: half the central angle below the horizontal.
      expect(r.elevDeg[0][k]).toBeCloseTo((-(40 / MOON_RADIUS_M) / 2) * (180 / Math.PI), 4);
      expect(r.elevDeg[2][k]).toBeCloseTo(-Math.acos(MOON_RADIUS_M / (MOON_RADIUS_M + 1000)) * (180 / Math.PI), 2);
    }
    expect(r.elevDeg[1][0]).toBeLessThan(r.elevDeg[0][0]);
  });

  it('projects and travels as the NASA grids do', () => {
    const [x, y] = toPlane(-90, 0);
    expect(Math.hypot(x, y)).toBeLessThan(1e-6);
    const [x2, y2] = toPlane(-89, 90);
    expect(x2).toBeCloseTo(2 * MOON_RADIUS_M * Math.tan((Math.PI / 180) / 2), 3);
    expect(Math.abs(y2)).toBeLessThan(1e-6);
    const [lat, lon] = destination(-85, 10, 0, 250);
    expect(lat).toBeCloseTo(-85 + (250 / MOON_RADIUS_M) * (180 / Math.PI), 6);
    expect(lon).toBeCloseTo(10, 6);
  });

  it('builds the four terrain grids of the 3D view around the point', () => {
    const lat = -85.5;
    const lon = 30;
    const model = modelAt(lat, lon);
    const tiles = terrainTiles(model, lat, lon);
    expect(tiles.length).toBe(257 * 257 * 4);
    const centre = 128 * 257 + 128;
    // The point itself is the origin of the tangent plane, at every level (the coarse levels are averages around it).
    expect(Math.abs(tiles[centre] * 0.0625)).toBeLessThan(0.1);
    expect(Math.abs(tiles[257 * 257 + centre] * 0.25)).toBeLessThan(15);
    // 250 m to the north, the level of 50 m spacing agrees with the model sampled directly.
    const [nLat, nLon] = destination(lat, lon, 0, 250);
    const d = 250 / MOON_RADIUS_M;
    const expected = (MOON_RADIUS_M + model.heightAt(nLat, nLon)) * Math.cos(d) - (MOON_RADIUS_M + model.heightAt(lat, lon));
    expect(Math.abs(tiles[257 * 257 + (128 + 5) * 257 + 128] * 0.25 - expected)).toBeLessThan(6);
    // Far away the Moon curves down: 300 km out the ground is tens of kilometres below the tangent plane.
    expect(tiles[3 * 257 * 257 + 128 * 257 + 3] * 2.5).toBeLessThan(-15000);
  });
});
